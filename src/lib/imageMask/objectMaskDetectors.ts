import type { RuntimeSettingsSnapshot } from '../../types/flow';
import { blobToBase64 } from '../imageEditorAi/blobUtils';

export interface DetectedObject {
  label: string;
  /** Gemini box_2d: [ymin, xmin, ymax, xmax] in 0-1000 normalized space. */
  box: [number, number, number, number];
  /**
   * Optional Gemini segmentation mask: a base64 PNG (bare base64 or a `data:` URL) probability map
   * sized to the object's bounding box. When present we composite it for a pixel-precise mask; when
   * absent we fall back to filling the box rectangle.
   */
  mask?: string;
}

export interface DetectedMask {
  /** Canonical RGBA PNG data URL (opaque = detected/edit). */
  maskDataUrl: string;
  objects: DetectedObject[];
}

export interface ObjectMaskDetectInput {
  sourceImageDataUrl: string;
  phrase: string;
  width: number;
  height: number;
  signal?: AbortSignal;
}

export interface ObjectMaskDetector {
  id: string;
  label: string;
  isConfigured(settings: RuntimeSettingsSnapshot): boolean;
  detect(input: ObjectMaskDetectInput): Promise<DetectedMask>;
}

/** Returns a width*height alpha map (0 or 255) with each box filled opaque. Canvas-free, pure. */
export function compositeBoxesToCanonicalAlpha(
  objects: DetectedObject[],
  width: number,
  height: number,
): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(width * height);
  for (const obj of objects) {
    const [ymin, xmin, ymax, xmax] = obj.box;
    const x0 = Math.max(0, Math.floor((xmin / 1000) * width));
    const x1 = Math.min(width, Math.ceil((xmax / 1000) * width));
    const y0 = Math.max(0, Math.floor((ymin / 1000) * height));
    const y1 = Math.min(height, Math.ceil((ymax / 1000) * height));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        alpha[y * width + x] = 255;
      }
    }
  }
  return alpha;
}

const GEMINI_SEGMENTATION_MODEL = 'gemini-2.5-flash';

interface GeminiSegmentRecord {
  label?: string;
  box_2d?: [number, number, number, number];
  mask?: string;
}

// The detector reads the key via a module-level setter so it has no store import cycle.
let detectorGeminiKey = '';
export function configureDetectorKeys(settings: RuntimeSettingsSnapshot): void {
  detectorGeminiKey = settings.apiKeys?.gemini?.trim() ?? '';
}
function requireDetectorGeminiKey(): string {
  if (!detectorGeminiKey) throw new Error('Configure a Gemini API key to use object detection.');
  return detectorGeminiKey;
}

export function parseGeminiSegments(text: string): DetectedObject[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let records: GeminiSegmentRecord[] = [];
  try { records = JSON.parse(match[0]) as GeminiSegmentRecord[]; } catch { return []; }
  return records
    .filter((r) => Array.isArray(r.box_2d) && r.box_2d.length === 4)
    .map((r) => ({
      label: r.label ?? 'object',
      box: r.box_2d as [number, number, number, number],
      mask: typeof r.mask === 'string' && r.mask.trim() ? r.mask.trim() : undefined,
    }));
}

function decodeMaskImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to decode segmentation mask.'));
    img.src = src.startsWith('data:') ? src : `data:image/png;base64,${src}`;
  });
}

/**
 * Pixel-precise alpha from Gemini segmentation masks: each object's mask PNG (a grayscale probability
 * map sized to its bounding box) is drawn — scaled — into the box and thresholded. Objects WITHOUT a
 * mask fall back to a filled box so the result is never empty. Browser-only (needs canvas + Image).
 */
async function compositeSegmentationMasksToAlpha(
  objects: DetectedObject[],
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const alpha = new Uint8ClampedArray(width * height);
  for (const obj of objects) {
    const [ymin, xmin, ymax, xmax] = obj.box;
    const x0 = Math.max(0, Math.floor((xmin / 1000) * width));
    const x1 = Math.min(width, Math.ceil((xmax / 1000) * width));
    const y0 = Math.max(0, Math.floor((ymin / 1000) * height));
    const y1 = Math.min(height, Math.ceil((ymax / 1000) * height));
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 0 || bh <= 0) continue;

    if (!obj.mask) {
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) alpha[y * width + x] = 255;
      continue;
    }
    let maskData: Uint8ClampedArray;
    try {
      const img = await decodeMaskImage(obj.mask);
      const tmp = document.createElement('canvas');
      tmp.width = bw;
      tmp.height = bh;
      const tctx = tmp.getContext('2d');
      if (!tctx) throw new Error('mask canvas unavailable');
      tctx.drawImage(img, 0, 0, bw, bh);
      maskData = tctx.getImageData(0, 0, bw, bh).data;
    } catch {
      // Mask failed to decode — fall back to the box for this object.
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) alpha[y * width + x] = 255;
      continue;
    }
    for (let yy = 0; yy < bh; yy += 1) {
      for (let xx = 0; xx < bw; xx += 1) {
        const i = (yy * bw + xx) * 4;
        // Probability lives in luminance (R≈G≈B for a grayscale map); the alpha channel also carries it.
        const prob = Math.max(maskData[i], maskData[i + 3]);
        if (prob > 127) alpha[(y0 + yy) * width + (x0 + xx)] = 255;
      }
    }
  }
  return alpha;
}

function alphaToCanonicalPng(alpha: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable for detection mask.');
  const imageData = ctx.createImageData(width, height);
  for (let p = 0; p < alpha.length; p += 1) {
    imageData.data[p * 4] = 255;
    imageData.data[p * 4 + 1] = 255;
    imageData.data[p * 4 + 2] = 255;
    imageData.data[p * 4 + 3] = alpha[p];
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

async function buildMaskDataUrl(objects: DetectedObject[], width: number, height: number): Promise<string> {
  // Pixel-precise when Gemini returned segmentation masks; otherwise the proven box-fill path.
  const alpha = objects.some((obj) => obj.mask)
    ? await compositeSegmentationMasksToAlpha(objects, width, height)
    : compositeBoxesToCanonicalAlpha(objects, width, height);
  return alphaToCanonicalPng(alpha, width, height);
}

export const geminiSegmentationDetector: ObjectMaskDetector = {
  id: 'gemini-segmentation',
  label: 'Gemini object detection',
  isConfigured: (settings) => Boolean(settings.apiKeys?.gemini?.trim()),
  detect: async (input) => {
    const apiKey = requireDetectorGeminiKey();
    const { GoogleGenAI } = await import('@google/genai');
    const client = new GoogleGenAI({ apiKey });
    // fetch handles data:, blob:, and http(s) source URLs uniformly.
    const sourceResponse = await fetch(input.sourceImageDataUrl, { signal: input.signal });
    const base64 = await blobToBase64(await sourceResponse.blob());
    const response = await client.models.generateContent({
      model: GEMINI_SEGMENTATION_MODEL,
      contents: [{
        parts: [
          { text: `Give the segmentation masks for "${input.phrase}". Return ONLY a JSON array; each item has "label", "box_2d" ([ymin,xmin,ymax,xmax] scaled 0-1000), and "mask" (a base64-encoded PNG segmentation mask for that object, sized to its bounding box). If you cannot produce a per-pixel mask, omit "mask" and the box will be used.` },
          { inlineData: { mimeType: 'image/png', data: base64 } },
        ],
      }],
    });
    const objects = parseGeminiSegments(response.text ?? '');
    return { maskDataUrl: await buildMaskDataUrl(objects, input.width, input.height), objects };
  },
};

export const OBJECT_MASK_DETECTORS: ObjectMaskDetector[] = [geminiSegmentationDetector];

export function listConfiguredDetectors(settings: RuntimeSettingsSnapshot): ObjectMaskDetector[] {
  return OBJECT_MASK_DETECTORS.filter((detector) => detector.isConfigured(settings));
}
