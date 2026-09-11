import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_RETOUCH_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
} from '../../types/imageEditor';
import {
  clearMaskedLayerCache,
  compositeLayerRangeInto,
  setLiveMaskBypassLayer,
} from './ImageAdjustmentLayer';
import { createBitmap } from './LayerBitmap';
import { eraserTool } from './tools/brushTool';
import { blurBrushTool } from './tools/blurBrushTool';
import type { ToolEnv } from './tools/types';

/**
 * Verifies the follow-up from docs/notes/715 (dirty-rect compositing): the layer-mask paint path
 * and the retouch-brush paint paths now report a touched region through `env.markDirty`, so
 * `CompositeRenderer.compositeActiveAware` can recomposite only that rect instead of the whole
 * document. This test proves the fast (dirty-rect-clipped) path is BYTE-IDENTICAL to a full
 * recomposite for both a real layer-mask stroke and a real retouch (blur) stroke — mirroring
 * `compositeActiveAware`'s exact incremental-branch sequence (clip → clearRect → drawImage(backdrop)
 * → compositeLayerRangeInto) against the same production `compositeLayerRangeInto` used by the
 * renderer, rather than re-deriving the algorithm.
 *
 * `CompositeRenderer` itself can't be instantiated in this test environment (no real
 * HTMLCanvasElement/ResizeObserver in the default Node/vitest environment), so this drives the
 * exact same compositing primitives it calls, through a minimal clip-aware Fake canvas (2D context
 * with save/restore/clip/clearRect/drawImage/getImageData/putImageData — the only context methods
 * the code paths under test ever call for unrotated, unscaled, effect-free layers).
 */

// ---------------------------------------------------------------------------------------------
// Minimal clip-aware Fake OffscreenCanvas 2D context.
// ---------------------------------------------------------------------------------------------

interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersectClip(a: ClipRect | null, b: ClipRect): ClipRect {
  if (!a) return { ...b };
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

interface FakeCtxState {
  globalAlpha: number;
  globalCompositeOperation: string;
  clip: ClipRect | null;
}

class FakeOffscreenCanvasContext {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle = '#000000';
  private clipRect: ClipRect | null = null;
  private pendingRect: ClipRect | null = null;
  private stack: FakeCtxState[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  save(): void {
    this.stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation, clip: this.clipRect });
  }

  restore(): void {
    const prev = this.stack.pop();
    if (!prev) return;
    this.globalAlpha = prev.globalAlpha;
    this.globalCompositeOperation = prev.globalCompositeOperation;
    this.clipRect = prev.clip;
  }

  // Every call site exercised by this test resets to the identity transform (CompositeRenderer's
  // incremental branch) or takes drawLayerBitmapTransformed's no-rotation/no-skew/no-perspective
  // fast path (a plain `ctx.drawImage(source, drawLeft, drawTop)` with no matrix calls at all) —
  // so no matrix state is needed here.
  setTransform(): void {}
  transform(): void {}
  translate(): void {}

  beginPath(): void {
    this.pendingRect = null;
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.pendingRect = { x, y, width, height };
  }

  clip(): void {
    if (!this.pendingRect) return;
    this.clipRect = intersectClip(this.clipRect, this.pendingRect);
  }

  private effectiveClip(): ClipRect {
    return this.clipRect ?? { x: 0, y: 0, width: this.width, height: this.height };
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    const target = intersectClip(this.effectiveClip(), { x, y, width, height });
    this.fillRectRaw(target, 0, 0, 0, 0);
  }

  fillRect(): void {
    // Unused by the code paths under test (backgrounds/checkerboards are drawn by
    // CompositeRenderer.draw(), which is not exercised here).
  }

  private fillRectRaw(rect: ClipRect, r: number, g: number, b: number, a: number): void {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(this.width, Math.ceil(rect.x + rect.width));
    const y1 = Math.min(this.height, Math.ceil(rect.y + rect.height));
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        const offset = (py * this.width + px) * 4;
        this.data[offset] = r;
        this.data[offset + 1] = g;
        this.data[offset + 2] = b;
        this.data[offset + 3] = a;
      }
    }
  }

  drawImage(image: FakeOffscreenCanvas, dx = 0, dy = 0): void {
    const source = image.context;
    const clip = this.effectiveClip();
    for (let sy = 0; sy < source.height; sy += 1) {
      const ty = dy + sy;
      if (ty < clip.y || ty >= clip.y + clip.height || ty < 0 || ty >= this.height) continue;
      for (let sx = 0; sx < source.width; sx += 1) {
        const tx = dx + sx;
        if (tx < clip.x || tx >= clip.x + clip.width || tx < 0 || tx >= this.width) continue;
        const sOffset = (sy * source.width + sx) * 4;
        this.blendSourceOver(tx, ty, source.data[sOffset] ?? 0, source.data[sOffset + 1] ?? 0, source.data[sOffset + 2] ?? 0, source.data[sOffset + 3] ?? 0);
      }
    }
  }

  private blendSourceOver(tx: number, ty: number, r: number, g: number, b: number, a: number): void {
    const offset = (ty * this.width + tx) * 4;
    const srcA = (a / 255) * this.globalAlpha;
    if (srcA <= 0) return;
    const dstA = (this.data[offset + 3] ?? 0) / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) {
      this.data[offset] = 0;
      this.data[offset + 1] = 0;
      this.data[offset + 2] = 0;
      this.data[offset + 3] = 0;
      return;
    }
    const dstWeight = dstA * (1 - srcA);
    this.data[offset] = Math.round((r * srcA + (this.data[offset] ?? 0) * dstWeight) / outA);
    this.data[offset + 1] = Math.round((g * srcA + (this.data[offset + 1] ?? 0) * dstWeight) / outA);
    this.data[offset + 2] = Math.round((b * srcA + (this.data[offset + 2] ?? 0) * dstWeight) / outA);
    this.data[offset + 3] = Math.round(outA * 255);
  }

  getImageData(x = 0, y = 0, width = this.width, height = this.height): ImageData {
    const out = new Uint8ClampedArray(width * height * 4);
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const sx = x + px;
        const sy = y + py;
        if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) continue;
        const sOffset = (sy * this.width + sx) * 4;
        const dOffset = (py * width + px) * 4;
        out[dOffset] = this.data[sOffset] ?? 0;
        out[dOffset + 1] = this.data[sOffset + 1] ?? 0;
        out[dOffset + 2] = this.data[sOffset + 2] ?? 0;
        out[dOffset + 3] = this.data[sOffset + 3] ?? 0;
      }
    }
    return { width, height, data: out } as ImageData;
  }

  putImageData(
    imageData: ImageData,
    dx = 0,
    dy = 0,
    dirtyX = 0,
    dirtyY = 0,
    dirtyWidth = imageData.width,
    dirtyHeight = imageData.height,
  ): void {
    const x0 = Math.max(0, dirtyX);
    const y0 = Math.max(0, dirtyY);
    const x1 = Math.min(imageData.width, dirtyX + dirtyWidth);
    const y1 = Math.min(imageData.height, dirtyY + dirtyHeight);
    for (let sy = y0; sy < y1; sy += 1) {
      const ty = dy + sy;
      if (ty < 0 || ty >= this.height) continue;
      for (let sx = x0; sx < x1; sx += 1) {
        const tx = dx + sx;
        if (tx < 0 || tx >= this.width) continue;
        const sOffset = (sy * imageData.width + sx) * 4;
        const tOffset = (ty * this.width + tx) * 4;
        this.data[tOffset] = imageData.data[sOffset] ?? 0;
        this.data[tOffset + 1] = imageData.data[sOffset + 1] ?? 0;
        this.data[tOffset + 2] = imageData.data[sOffset + 2] ?? 0;
        this.data[tOffset + 3] = imageData.data[sOffset + 3] ?? 0;
      }
    }
  }

  createImageData(width: number, height: number): ImageData {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeOffscreenCanvasContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeOffscreenCanvasContext(width, height);
  }

  getContext(kind: string): FakeOffscreenCanvasContext | null {
    return kind === '2d' ? this.context : null;
  }
}

function installCanvasStub(): void {
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
}

// ---------------------------------------------------------------------------------------------
// Doc/layer/pixel helpers.
// ---------------------------------------------------------------------------------------------

function fillSolid(bitmap: LayerBitmap, rgba: [number, number, number, number], width: number, height: number): void {
  const ctx = bitmap.getContext('2d') as unknown as FakeOffscreenCanvasContext;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      ctx.data[offset] = rgba[0];
      ctx.data[offset + 1] = rgba[1];
      ctx.data[offset + 2] = rgba[2];
      ctx.data[offset + 3] = rgba[3];
    }
  }
}

function cloneFakeBitmap(bitmap: LayerBitmap): LayerBitmap {
  const clone = createBitmap(bitmap.width, bitmap.height);
  const src = bitmap.getContext('2d') as unknown as FakeOffscreenCanvasContext;
  const dst = clone.getContext('2d') as unknown as FakeOffscreenCanvasContext;
  dst.data.set(src.data);
  return clone;
}

function makeImageLayer(overrides: Partial<ImageLayer> & { id: string }): ImageLayer {
  return {
    name: overrides.id,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeDoc(overrides: Partial<ImageDocument> & { layers: ImageLayer[]; width: number; height: number }): ImageDocument {
  return {
    id: 'doc-1',
    title: 'doc',
    activeLayerId: null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
  };
}

function pointerEvent(): PointerEvent {
  return { pointerType: 'mouse', pressure: 0.5, tiltX: 0, tiltY: 0, timeStamp: 0 } as PointerEvent;
}

function makeEnv(doc: ImageDocument, activeLayer: ImageLayer, markDirty: (rect: { x: number; y: number; width: number; height: number }) => void): ToolEnv {
  return {
    doc,
    activeLayer,
    brushSettings: { ...DEFAULT_BRUSH_SETTINGS, size: 10, opacity: 1, hardness: 1, flow: 1, gpuBrushEngine: false },
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    retouchToolSettings: { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' },
    selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS },
    screenToDoc: (point) => point,
    docToScreen: (point) => point,
    pushOperation: vi.fn(),
    requestRender: vi.fn(),
    markDirty,
    resolveSelectionMode: () => 'replace',
    store: {
      quickMaskSettings: { enabled: false, viewMode: 'maskedAreas', overlayOpacity: 0.5 },
      updateLayer: vi.fn(),
      bumpLayerBitmapVersion: vi.fn(),
      markDocumentDirty: vi.fn(),
      setPaintingStroke: vi.fn(),
    } as unknown as ToolEnv['store'],
  };
}

// ---------------------------------------------------------------------------------------------
// Composite helpers — mirror CompositeRenderer.compositeActiveAware exactly (same production
// compositeLayerRangeInto calls, same clip → clearRect → drawImage(backdrop) → recomposite
// sequence for the incremental branch), so this is a faithful re-drive of the real mechanism.
// ---------------------------------------------------------------------------------------------

function fullComposite(layers: ImageLayer[], width: number, height: number): ImageData {
  clearMaskedLayerCache();
  const bitmap = createBitmap(width, height);
  compositeLayerRangeInto(bitmap, layers, width, height, 0, layers.length, null);
  return (bitmap.getContext('2d') as unknown as FakeOffscreenCanvasContext).getImageData(0, 0, width, height);
}

function incrementalComposite(
  beforeLayers: ImageLayer[],
  afterLayers: ImageLayer[],
  activeIndex: number,
  activeLayerId: string,
  dirty: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
): ImageData {
  clearMaskedLayerCache();

  // Backdrop: layers below the active one — unaffected by a mask/retouch stroke on the active layer.
  const backdrop = createBitmap(width, height);
  const backdropState = compositeLayerRangeInto(backdrop, beforeLayers, width, height, 0, activeIndex, null);

  // Scratch starts as a full composite of the BEFORE state — models the persistent "projection"
  // CompositeRenderer already holds from the previous (valid) frame.
  const scratch = createBitmap(width, height);
  compositeLayerRangeInto(scratch, beforeLayers, width, height, 0, beforeLayers.length, null);

  const x = Math.max(0, Math.floor(dirty.x));
  const y = Math.max(0, Math.floor(dirty.y));
  const right = Math.min(width, Math.ceil(dirty.x + dirty.width));
  const bottom = Math.min(height, Math.ceil(dirty.y + dirty.height));
  const rectWidth = right - x;
  const rectHeight = bottom - y;
  expect(rectWidth).toBeGreaterThan(0);
  expect(rectHeight).toBeGreaterThan(0);

  const ctx = scratch.getContext('2d') as unknown as FakeOffscreenCanvasContext;
  setLiveMaskBypassLayer(activeLayerId);
  try {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, rectWidth, rectHeight);
    ctx.clip();
    ctx.clearRect(x, y, rectWidth, rectHeight);
    ctx.drawImage(backdrop as unknown as FakeOffscreenCanvas, 0, 0);
    compositeLayerRangeInto(scratch, afterLayers, width, height, activeIndex, afterLayers.length, backdropState);
    ctx.restore();
  } finally {
    setLiveMaskBypassLayer(null);
  }
  return ctx.getImageData(0, 0, width, height);
}

function countMismatches(a: ImageData, b: ImageData): { mismatched: number; maxDiff: number } {
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  let mismatched = 0;
  let maxDiff = 0;
  for (let i = 0; i < a.data.length; i += 1) {
    const diff = Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0));
    if (diff !== 0) {
      mismatched += 1;
      if (diff > maxDiff) maxDiff = diff;
    }
  }
  return { mismatched, maxDiff };
}

function unionRects(
  a: { x: number; y: number; width: number; height: number } | null,
  b: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

describe('CompositeRenderer dirty-rect extension: mask + retouch strokes', () => {
  const WIDTH = 24;
  const HEIGHT = 16;

  beforeEach(() => {
    installCanvasStub();
    clearMaskedLayerCache();
    setLiveMaskBypassLayer(null);
  });

  it('mask-paint stroke (eraser on a layer mask): dirty-rect recomposite is byte-identical to a full recomposite', () => {
    // Two layers: a solid-red backdrop layer and a solid-blue active layer whose mask starts fully
    // revealing (alpha 255 everywhere). The stroke conceals (alpha 0) a circular region of the
    // mask, which should reveal red underneath — an unambiguous, easy-to-verify change.
    const lowerBitmap = createBitmap(WIDTH, HEIGHT);
    fillSolid(lowerBitmap, [200, 30, 30, 255], WIDTH, HEIGHT);
    const lower = makeImageLayer({ id: 'lower', bitmap: lowerBitmap });

    const activeBitmapLive = createBitmap(WIDTH, HEIGHT);
    fillSolid(activeBitmapLive, [30, 30, 200, 255], WIDTH, HEIGHT);
    const activeMaskBefore = createBitmap(WIDTH, HEIGHT);
    fillSolid(activeMaskBefore, [255, 255, 255, 255], WIDTH, HEIGHT);
    const activeMaskLive = createBitmap(WIDTH, HEIGHT);
    fillSolid(activeMaskLive, [255, 255, 255, 255], WIDTH, HEIGHT);

    const activeBefore = makeImageLayer({ id: 'active', bitmap: cloneFakeBitmap(activeBitmapLive), mask: activeMaskBefore });
    const activeLive = makeImageLayer({ id: 'active', bitmap: activeBitmapLive, mask: activeMaskLive });

    const beforeLayers = [lower, activeBefore];
    const liveLayers = [lower, activeLive];

    const doc = makeDoc({
      id: 'doc-mask-stroke',
      width: WIDTH,
      height: HEIGHT,
      layers: liveLayers,
      activeLayerId: 'active',
      activeLayerEditTarget: 'mask',
    });

    let dirtyUnion: { x: number; y: number; width: number; height: number } | null = null;
    const env = makeEnv(doc, activeLive, (rect) => {
      dirtyUnion = unionRects(dirtyUnion, rect);
    });

    eraserTool.onPointerDown?.(env, { x: 8, y: 8 }, { shift: false, alt: false, ctrl: false, meta: false }, pointerEvent());
    eraserTool.onPointerMove?.(env, { x: 13, y: 9 }, { shift: false, alt: false, ctrl: false, meta: false }, pointerEvent());

    // Regression guard: before the fix, mask painting never called markDirty at all.
    expect(dirtyUnion).not.toBeNull();

    // Sanity: the mask actually changed somewhere (else the composite-equality check below would
    // be vacuous — a no-op stroke trivially produces identical composites).
    const maskBeforeData = (activeMaskBefore.getContext('2d') as unknown as FakeOffscreenCanvasContext).getImageData(0, 0, WIDTH, HEIGHT);
    const maskAfterData = (activeMaskLive.getContext('2d') as unknown as FakeOffscreenCanvasContext).getImageData(0, 0, WIDTH, HEIGHT);
    const maskDiff = countMismatches(maskBeforeData, maskAfterData);
    expect(maskDiff.mismatched).toBeGreaterThan(0);

    const afterLayers = [lower, activeLive];
    const full = fullComposite(afterLayers, WIDTH, HEIGHT);
    const incremental = incrementalComposite(beforeLayers, afterLayers, 1, 'active', dirtyUnion!, WIDTH, HEIGHT);

    const { mismatched, maxDiff } = countMismatches(full, incremental);
    expect({ mismatched, maxDiff }).toEqual({ mismatched: 0, maxDiff: 0 });
  });

  it('blur retouch stroke: dirty-rect recomposite is byte-identical to a full recomposite', () => {
    // Two layers: a solid-green backdrop and an active layer with a hard vertical colour split
    // (so blurring has a visible, easy-to-verify effect). No mask — isolates the retouch-bitmap
    // dirty-rect path from the mask path exercised above.
    const lowerBitmap = createBitmap(WIDTH, HEIGHT);
    fillSolid(lowerBitmap, [30, 180, 60, 255], WIDTH, HEIGHT);
    const lower = makeImageLayer({ id: 'lower', bitmap: lowerBitmap });

    const activeBitmapLive = createBitmap(WIDTH, HEIGHT);
    const activeCtx = activeBitmapLive.getContext('2d') as unknown as FakeOffscreenCanvasContext;
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const offset = (y * WIDTH + x) * 4;
        const isLeft = x < WIDTH / 2;
        activeCtx.data[offset] = isLeft ? 250 : 10;
        activeCtx.data[offset + 1] = isLeft ? 10 : 250;
        activeCtx.data[offset + 2] = 10;
        activeCtx.data[offset + 3] = 255;
      }
    }

    const activeBefore = makeImageLayer({ id: 'active', bitmap: cloneFakeBitmap(activeBitmapLive) });
    const activeLive = makeImageLayer({ id: 'active', bitmap: activeBitmapLive });

    const beforeLayers = [lower, activeBefore];
    const liveLayers = [lower, activeLive];

    const doc = makeDoc({
      id: 'doc-blur-stroke',
      width: WIDTH,
      height: HEIGHT,
      layers: liveLayers,
      activeLayerId: 'active',
      activeLayerEditTarget: 'layer',
    });

    let dirtyUnion: { x: number; y: number; width: number; height: number } | null = null;
    const env = makeEnv(doc, activeLive, (rect) => {
      dirtyUnion = unionRects(dirtyUnion, rect);
    });

    blurBrushTool.onPointerDown?.(env, { x: 12, y: 8 }, { shift: false, alt: false, ctrl: false, meta: false }, pointerEvent());
    blurBrushTool.onPointerMove?.(env, { x: 15, y: 8 }, { shift: false, alt: false, ctrl: false, meta: false }, pointerEvent());

    // Regression guard: before the fix, blur/sharpen never forwarded the controller's dirty rect.
    expect(dirtyUnion).not.toBeNull();

    const bitmapBeforeData = (activeBefore.bitmap!.getContext('2d') as unknown as FakeOffscreenCanvasContext).getImageData(0, 0, WIDTH, HEIGHT);
    const bitmapAfterData = (activeLive.bitmap!.getContext('2d') as unknown as FakeOffscreenCanvasContext).getImageData(0, 0, WIDTH, HEIGHT);
    const pixelDiff = countMismatches(bitmapBeforeData, bitmapAfterData);
    expect(pixelDiff.mismatched).toBeGreaterThan(0);

    const afterLayers = [lower, activeLive];
    const full = fullComposite(afterLayers, WIDTH, HEIGHT);
    const incremental = incrementalComposite(beforeLayers, afterLayers, 1, 'active', dirtyUnion!, WIDTH, HEIGHT);

    const { mismatched, maxDiff } = countMismatches(full, incremental);
    expect({ mismatched, maxDiff }).toEqual({ mismatched: 0, maxDiff: 0 });
  });
});
