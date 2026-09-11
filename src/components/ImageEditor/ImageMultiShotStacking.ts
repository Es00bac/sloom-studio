import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import { createBitmap, putBitmapImageData } from './LayerBitmap';

/** The local multi-shot tool deliberately keeps all work inside one bounded CPU pass. */
export const IMAGE_MULTI_SHOT_LIMITS = {
  maxInputs: 6,
  maxPixelsPerInput: 2_000_000,
  maxSide: 2_048,
  minimumPanoramaOverlap: 0.2,
  minimumPanoramaDetail: 10,
} as const;

export type ImageMultiShotMode = 'hdr' | 'panorama' | 'focus';

export interface ImageMultiShotPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface ImageMultiShotSource {
  id: string;
  title: string;
  pixels: ImageMultiShotPixels;
  /** Open Image documents are currently 8-bit raster documents. Refuse future precision routes explicitly. */
  bitDepth?: 8 | 16 | 32;
}

export interface ImageMultiShotSelection {
  id: string;
  width: number;
  height: number;
  bitDepth?: 8 | 16 | 32;
}

export interface ImageMultiShotResult {
  mode: ImageMultiShotMode;
  pixels: ImageMultiShotPixels;
  description: string;
  sourceIds: string[];
  alignment?: { x: number; y: number; overlap: number; score: number }[];
}

export class ImageMultiShotCancelledError extends Error {
  constructor() {
    super('Multi-shot processing was cancelled before it changed any document.');
    this.name = 'ImageMultiShotCancelledError';
  }
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ImageMultiShotCancelledError();
}

function assertPixels(pixels: ImageMultiShotPixels): void {
  if (!Number.isInteger(pixels.width) || !Number.isInteger(pixels.height) || pixels.width < 1 || pixels.height < 1) {
    throw new Error('Each source must have finite positive dimensions.');
  }
  if (pixels.width > IMAGE_MULTI_SHOT_LIMITS.maxSide || pixels.height > IMAGE_MULTI_SHOT_LIMITS.maxSide
    || pixels.width * pixels.height > IMAGE_MULTI_SHOT_LIMITS.maxPixelsPerInput) {
    throw new Error(`Sources are limited to ${IMAGE_MULTI_SHOT_LIMITS.maxSide}px per side and ${IMAGE_MULTI_SHOT_LIMITS.maxPixelsPerInput.toLocaleString()} pixels.`);
  }
  if (pixels.data.length !== pixels.width * pixels.height * 4) {
    throw new Error('A source raster has an invalid pixel payload.');
  }
}

export function validateImageMultiShotSelections(mode: ImageMultiShotMode, sources: readonly ImageMultiShotSelection[]): string | null {
  if (sources.length < 2) return 'Choose at least two open Image documents.';
  if (sources.length > IMAGE_MULTI_SHOT_LIMITS.maxInputs) return `Choose no more than ${IMAGE_MULTI_SHOT_LIMITS.maxInputs} source documents.`;
  const first = sources[0];
  for (const source of sources) {
    if ((source.bitDepth ?? 8) !== 8) return 'This bounded local stacker supports 8-bit RGB documents only.';
    if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width < 1 || source.height < 1) {
      return 'Each source must have finite positive dimensions.';
    }
    if (source.width > IMAGE_MULTI_SHOT_LIMITS.maxSide || source.height > IMAGE_MULTI_SHOT_LIMITS.maxSide
      || source.width * source.height > IMAGE_MULTI_SHOT_LIMITS.maxPixelsPerInput) {
      return `Sources are limited to ${IMAGE_MULTI_SHOT_LIMITS.maxSide}px per side and ${IMAGE_MULTI_SHOT_LIMITS.maxPixelsPerInput.toLocaleString()} pixels.`;
    }
    if (source.width !== first.width || source.height !== first.height) {
      return `${mode === 'panorama' ? 'Panorama' : 'HDR and focus stacking'} needs same-sized source images in this bounded local workflow.`;
    }
  }
  return null;
}

export function validateImageMultiShotSources(mode: ImageMultiShotMode, sources: readonly ImageMultiShotSource[]): string | null {
  const selectionError = validateImageMultiShotSelections(mode, sources.map((source) => ({
    id: source.id,
    width: source.pixels.width,
    height: source.pixels.height,
    bitDepth: source.bitDepth,
  })));
  if (selectionError) return selectionError;
  try {
    for (const source of sources) assertPixels(source.pixels);
  } catch (error) {
    return error instanceof Error ? error.message : 'The selected images are not compatible.';
  }
  return null;
}

function luma(data: Uint8ClampedArray, offset: number): number {
  return (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255;
}

function writePixel(data: Uint8ClampedArray, offset: number, r: number, g: number, b: number, a = 255): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(r)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(g)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(b)));
  data[offset + 3] = Math.max(0, Math.min(255, Math.round(a)));
}

/**
 * Exposure fusion weights pixels near the usable middle of each source's range, so a blown or
 * crushed exposure cannot contribute as much as a source that retains local information.
 */
export function mergeHdrExposure(sources: readonly ImageMultiShotSource[], signal?: AbortSignal): ImageMultiShotResult {
  const message = validateImageMultiShotSources('hdr', sources);
  if (message) throw new Error(message);
  const { width, height } = sources[0].pixels;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if ((pixel & 0x1fff) === 0) assertNotCancelled(signal);
    const offset = pixel * 4;
    let weightTotal = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let alpha = 0;
    for (const source of sources) {
      const input = source.pixels.data;
      if (input[offset + 3] === 0) continue;
      const luminance = luma(input, offset);
      // Gaussian well-exposedness deliberately diverges from an arithmetic image average.
      const exposureWeight = 0.015 + Math.exp(-12 * (luminance - 0.5) * (luminance - 0.5));
      const chroma = Math.max(input[offset], input[offset + 1], input[offset + 2])
        - Math.min(input[offset], input[offset + 1], input[offset + 2]);
      const weight = exposureWeight * (0.75 + chroma / 1020);
      weightTotal += weight;
      r += input[offset] * weight;
      g += input[offset + 1] * weight;
      b += input[offset + 2] * weight;
      alpha = Math.max(alpha, input[offset + 3]);
    }
    if (weightTotal > 0) writePixel(out, offset, r / weightTotal, g / weightTotal, b / weightTotal, alpha);
  }
  return {
    mode: 'hdr',
    pixels: { width, height, data: out },
    sourceIds: sources.map((source) => source.id),
    description: `Exposure fusion from ${sources.length} sources, weighted toward locally usable exposure values.`,
  };
}

interface Translation { x: number; y: number; overlap: number; score: number }

function sampleLuma(pixels: ImageMultiShotPixels, x: number, y: number): number {
  return luma(pixels.data, (y * pixels.width + x) * 4);
}

function sourceDetail(pixels: ImageMultiShotPixels): number {
  const stride = Math.max(2, Math.floor(Math.min(pixels.width, pixels.height) / 24));
  let total = 0;
  let count = 0;
  for (let y = stride; y < pixels.height - stride; y += stride) {
    for (let x = stride; x < pixels.width - stride; x += stride) {
      total += Math.abs(sampleLuma(pixels, x + 1, y) - sampleLuma(pixels, x - 1, y));
      total += Math.abs(sampleLuma(pixels, x, y + 1) - sampleLuma(pixels, x, y - 1));
      count += 2;
    }
  }
  return count ? total * 255 / count : 0;
}

/** Estimate a translation by matching a coarse luminance grid over meaningful overlap. */
export function estimatePanoramaTranslation(reference: ImageMultiShotPixels, next: ImageMultiShotPixels, signal?: AbortSignal): Translation {
  if (reference.width !== next.width || reference.height !== next.height) {
    throw new Error('Panorama sources must be the same size in this bounded local workflow.');
  }
  if (sourceDetail(reference) < IMAGE_MULTI_SHOT_LIMITS.minimumPanoramaDetail || sourceDetail(next) < IMAGE_MULTI_SHOT_LIMITS.minimumPanoramaDetail) {
    throw new Error('Panorama refused: the selected images do not contain enough measurable detail for alignment.');
  }
  const width = reference.width;
  const height = reference.height;
  const maxX = Math.max(1, Math.floor(width * 0.55));
  const maxY = Math.max(0, Math.floor(height * 0.18));
  const step = Math.max(1, Math.floor(Math.min(width, height) / 72));
  let best: Translation | null = null;
  let candidateCount = 0;
  for (let dy = -maxY; dy <= maxY; dy += Math.max(1, Math.floor(step / 2))) {
    for (let dx = -maxX; dx <= maxX; dx += step) {
      candidateCount += 1;
      if ((candidateCount & 0x7f) === 0) assertNotCancelled(signal);
      const left = Math.max(0, dx);
      const right = Math.min(width, width + dx);
      const top = Math.max(0, dy);
      const bottom = Math.min(height, height + dy);
      const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
      const overlap = overlapArea / (width * height);
      if (overlap < IMAGE_MULTI_SHOT_LIMITS.minimumPanoramaOverlap) continue;
      let error = 0;
      let samples = 0;
      for (let y = top + step; y < bottom - step; y += step) {
        for (let x = left + step; x < right - step; x += step) {
          error += Math.abs(sampleLuma(reference, x, y) - sampleLuma(next, x - dx, y - dy));
          samples += 1;
        }
      }
      if (samples < 16) continue;
      const score = error / samples;
      if (!best || score < best.score) best = { x: dx, y: dy, overlap, score };
    }
  }
  if (!best || best.overlap < IMAGE_MULTI_SHOT_LIMITS.minimumPanoramaOverlap || best.score > 0.22) {
    throw new Error('Panorama refused: no reliable bounded overlap was found between the selected images.');
  }
  return best;
}

function copyPixel(source: ImageMultiShotPixels, x: number, y: number, target: Uint8ClampedArray, targetOffset: number): void {
  const offset = (y * source.width + x) * 4;
  writePixel(target, targetOffset, source.data[offset], source.data[offset + 1], source.data[offset + 2], source.data[offset + 3]);
}

function featherWeight(x: number, y: number, width: number, height: number): number {
  return Math.max(1, Math.min(x + 1, y + 1, width - x, height - y));
}

function stitchPair(base: ImageMultiShotPixels, next: ImageMultiShotPixels, translation: Translation, signal?: AbortSignal): ImageMultiShotPixels {
  const minX = Math.min(0, translation.x);
  const minY = Math.min(0, translation.y);
  const maxX = Math.max(base.width, translation.x + next.width);
  const maxY = Math.max(base.height, translation.y + next.height);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width > IMAGE_MULTI_SHOT_LIMITS.maxSide || height > IMAGE_MULTI_SHOT_LIMITS.maxSide || width * height > IMAGE_MULTI_SHOT_LIMITS.maxPixelsPerInput) {
    throw new Error('Panorama refused: the aligned result exceeds the bounded local canvas limit.');
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    if ((y & 0x3f) === 0) assertNotCancelled(signal);
    for (let x = 0; x < width; x += 1) {
      const baseX = x + minX;
      const baseY = y + minY;
      const nextX = baseX - translation.x;
      const nextY = baseY - translation.y;
      const baseInside = baseX >= 0 && baseX < base.width && baseY >= 0 && baseY < base.height;
      const nextInside = nextX >= 0 && nextX < next.width && nextY >= 0 && nextY < next.height;
      const target = (y * width + x) * 4;
      if (baseInside && nextInside) {
        const a = (baseY * base.width + baseX) * 4;
        const b = (nextY * next.width + nextX) * 4;
        const baseWeight = featherWeight(baseX, baseY, base.width, base.height);
        const nextWeight = featherWeight(nextX, nextY, next.width, next.height);
        const sum = baseWeight + nextWeight;
        writePixel(out, target,
          (base.data[a] * baseWeight + next.data[b] * nextWeight) / sum,
          (base.data[a + 1] * baseWeight + next.data[b + 1] * nextWeight) / sum,
          (base.data[a + 2] * baseWeight + next.data[b + 2] * nextWeight) / sum,
          Math.max(base.data[a + 3], next.data[b + 3]));
      } else if (baseInside) {
        copyPixel(base, baseX, baseY, out, target);
      } else if (nextInside) {
        copyPixel(next, nextX, nextY, out, target);
      }
    }
  }
  return { width, height, data: out };
}

export function stitchPanorama(sources: readonly ImageMultiShotSource[], signal?: AbortSignal): ImageMultiShotResult {
  const message = validateImageMultiShotSources('panorama', sources);
  if (message) throw new Error(message);
  let stitched = sources[0].pixels;
  // The next pairwise estimate is relative to the preceding source, not to the accumulated
  // canvas. Keep that source's origin in the current canvas coordinate system. A stitch that
  // extends left or upward shifts every existing origin, so advance the reference origin by the
  // same normalization offset before the next pair.
  let referenceOrigin = { x: 0, y: 0 };
  const alignment: Translation[] = [];
  for (let index = 1; index < sources.length; index += 1) {
    assertNotCancelled(signal);
    // Each later source is aligned against the original-size preceding source. This keeps the
    // correlation window bounded and deterministic; the accumulated image is then feathered in.
    const reference = index === 1 ? sources[0].pixels : sources[index - 1].pixels;
    const estimated = estimatePanoramaTranslation(reference, sources[index].pixels, signal);
    const accumulatedTranslation = {
      ...estimated,
      x: referenceOrigin.x + estimated.x,
      y: referenceOrigin.y + estimated.y,
    };
    const normalization = {
      x: -Math.min(0, accumulatedTranslation.x),
      y: -Math.min(0, accumulatedTranslation.y),
    };
    stitched = stitchPair(stitched, sources[index].pixels, accumulatedTranslation, signal);
    alignment.push(accumulatedTranslation);
    referenceOrigin = {
      x: accumulatedTranslation.x + normalization.x,
      y: accumulatedTranslation.y + normalization.y,
    };
  }
  return {
    mode: 'panorama',
    pixels: stitched,
    sourceIds: sources.map((source) => source.id),
    alignment,
    description: `Translation-aligned panorama with ${alignment.length} measured overlap seam${alignment.length === 1 ? '' : 's'}.`,
  };
}

function sharpnessAt(pixels: ImageMultiShotPixels, x: number, y: number): number {
  const center = sampleLuma(pixels, x, y);
  return Math.abs(4 * center
    - sampleLuma(pixels, x - 1, y)
    - sampleLuma(pixels, x + 1, y)
    - sampleLuma(pixels, x, y - 1)
    - sampleLuma(pixels, x, y + 1));
}

/** Locally select the highest-frequency source and clean one-pixel label noise before copying. */
export function stackFocus(sources: readonly ImageMultiShotSource[], signal?: AbortSignal): ImageMultiShotResult {
  const message = validateImageMultiShotSources('focus', sources);
  if (message) throw new Error(message);
  const { width, height } = sources[0].pixels;
  const rawLabels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    if ((y & 0x3f) === 0) assertNotCancelled(signal);
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
      let bestSource = 0;
      let bestSharpness = -1;
      for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
        const sharpness = sharpnessAt(sources[sourceIndex].pixels, x, y);
        if (sharpness > bestSharpness) {
          bestSharpness = sharpness;
          bestSource = sourceIndex;
        }
      }
      rawLabels[y * width + x] = bestSource;
    }
  }
  const labels = new Uint8Array(rawLabels);
  for (let y = 1; y < height - 1; y += 1) {
    if ((y & 0x3f) === 0) assertNotCancelled(signal);
    for (let x = 1; x < width - 1; x += 1) {
      const votes = new Uint16Array(sources.length);
      for (let by = -1; by <= 1; by += 1) for (let bx = -1; bx <= 1; bx += 1) votes[rawLabels[(y + by) * width + x + bx]] += 1;
      let selected = rawLabels[y * width + x];
      for (let index = 0; index < votes.length; index += 1) if (votes[index] > votes[selected]) selected = index;
      labels[y * width + x] = selected;
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    if ((pixel & 0x1fff) === 0) assertNotCancelled(signal);
    const offset = pixel * 4;
    const source = sources[labels[pixel]].pixels.data;
    writePixel(out, offset, source[offset], source[offset + 1], source[offset + 2], source[offset + 3]);
  }
  return {
    mode: 'focus',
    pixels: { width, height, data: out },
    sourceIds: sources.map((source) => source.id),
    description: `Local sharpness focus stack from ${sources.length} sources with one-pixel seam cleanup.`,
  };
}

export function runImageMultiShotStack(mode: ImageMultiShotMode, sources: readonly ImageMultiShotSource[], signal?: AbortSignal): ImageMultiShotResult {
  assertNotCancelled(signal);
  switch (mode) {
    case 'hdr': return mergeHdrExposure(sources, signal);
    case 'panorama': return stitchPanorama(sources, signal);
    case 'focus': return stackFocus(sources, signal);
  }
}

export function paintImageMultiShotPreview(
  context: Pick<CanvasRenderingContext2D, 'createImageData' | 'putImageData'>,
  result: ImageMultiShotResult,
): void {
  // Canvas WebIDL rejects a structurally compatible plain object. Ask the target context for a
  // genuine ImageData instance, then copy the bounded result bytes into it before painting.
  const imageData = context.createImageData(result.pixels.width, result.pixels.height);
  imageData.data.set(result.pixels.data);
  context.putImageData(imageData, 0, 0);
}

export function createImageMultiShotDocument(result: ImageMultiShotResult, title?: string): ImageDocument {
  const id = `doc-stack-${result.mode}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const doc = createEmptyImageDocument({
    id,
    title: title?.trim() || `${result.mode === 'hdr' ? 'HDR Merge' : result.mode === 'panorama' ? 'Panorama' : 'Focus Stack'}`,
    width: result.pixels.width,
    height: result.pixels.height,
  });
  return {
    ...doc,
    dirty: true,
    metadata: {
      sourceFormat: 'signal-loom-multishot-v1',
      sourceMimeType: 'image/png',
      sourceBitDepth: 8,
      warnings: [result.description],
    },
  };
}

export function createImageMultiShotLayer(result: ImageMultiShotResult): ImageLayer {
  const bitmap = createBitmap(result.pixels.width, result.pixels.height);
  putBitmapImageData(bitmap, result.pixels as unknown as ImageData);
  return {
    id: `layer-stack-${result.mode}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: result.mode === 'hdr' ? 'HDR exposure fusion' : result.mode === 'panorama' ? 'Aligned panorama' : 'Focus stack',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap,
    bitmapVersion: 1,
    mask: null,
    metadata: {
      sourceFormat: 'signal-loom-multishot-v1',
      sourceMimeType: 'image/png',
      sourceWarnings: [result.description],
    },
  };
}

/**
 * Install a generated result by the same tab/layer/history route used by ordinary Image edits.
 * Source documents are intentionally untouched; undo only affects the newly opened result tab.
 */
export function openImageMultiShotResult(result: ImageMultiShotResult): ImageDocument {
  const store = useImageEditorStore.getState();
  const doc = createImageMultiShotDocument(result);
  const layer = createImageMultiShotLayer(result);
  store.openDocument(doc);
  store.setLayers(doc.id, [layer], layer.id);
  store.pushOperation({ kind: 'layerOp', docId: doc.id, before: [], after: [layer] });
  return doc;
}
