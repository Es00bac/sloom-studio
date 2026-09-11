import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import { createAdjustmentLayer } from './ImageAdjustmentLayer';

/** Camera Raw-style controls are deliberately bounded to the existing 8-bit RGB compositor. */
export const CAMERA_RAW_DEVELOPMENT_MAX_PIXELS = 32 * 1024 * 1024;

export interface CameraRawDevelopmentDraft {
  temperature: number;
  tint: number;
  exposure: number;
  brightness: number;
  contrast: number;
}

export const DEFAULT_CAMERA_RAW_DEVELOPMENT_DRAFT: CameraRawDevelopmentDraft = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  brightness: 0,
  contrast: 0,
};

export type CameraRawDevelopmentRefusal =
  | 'no-photographic-pixels'
  | 'unsafe-document-bounds'
  | 'high-bit-adjustment-unsupported';

export function normalizeCameraRawDevelopmentDraft(
  input: Partial<CameraRawDevelopmentDraft> | null | undefined,
): CameraRawDevelopmentDraft {
  return {
    temperature: normalize(input?.temperature, -100, 100, 0),
    tint: normalize(input?.tint, -100, 100, 0),
    exposure: normalize(input?.exposure, -5, 5, 0),
    brightness: normalize(input?.brightness, -100, 100, 0),
    contrast: normalize(input?.contrast, -100, 100, 0),
  };
}

export function getCameraRawDevelopmentRefusal(doc: ImageDocument): CameraRawDevelopmentRefusal | null {
  if (!Number.isFinite(doc.width) || !Number.isFinite(doc.height)
    || doc.width < 1 || doc.height < 1 || doc.width * doc.height > CAMERA_RAW_DEVELOPMENT_MAX_PIXELS) {
    return 'unsafe-document-bounds';
  }
  return doc.layers.some(hasPhotographicPixels) ? null : 'no-photographic-pixels';
}

/**
 * Builds only ordinary non-destructive Image adjustments. It never attempts to decode a sensor RAW
 * file; the source image pixels must already be present in the open document.
 */
export function createCameraRawDevelopmentLayers(
  doc: ImageDocument,
  input: Partial<CameraRawDevelopmentDraft> | null | undefined,
): ImageLayer[] {
  const draft = normalizeCameraRawDevelopmentDraft(input);
  const whiteBalance = createAdjustmentLayer(doc, 'temperatureTint', 'Camera Raw — White balance');
  const exposure = createAdjustmentLayer(doc, 'exposure', 'Camera Raw — Exposure');
  const tone = createAdjustmentLayer(doc, 'brightnessContrast', 'Camera Raw — Tone');
  return [
    { ...whiteBalance, adjustment: { kind: 'temperatureTint', temperature: draft.temperature, tint: draft.tint } },
    { ...exposure, adjustment: { kind: 'exposure', exposure: draft.exposure, offset: 0, gamma: 1 } },
    { ...tone, adjustment: { kind: 'brightnessContrast', brightness: draft.brightness, contrast: draft.contrast } },
  ];
}

function hasPhotographicPixels(layer: ImageLayer): boolean {
  return layer.type === 'image' && Boolean(layer.bitmap || layer.bitmapData);
}

function normalize(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}
