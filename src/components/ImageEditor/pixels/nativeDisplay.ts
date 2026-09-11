import type { ImageDocument, ImageLayer, LayerBitmap, PixelBuffer } from '../../../types/imageEditor';
import { createBitmap, getBitmapImageData, putBitmapImageData } from '../LayerBitmap';
import { documentWorkingDepth, rgbaProxyBytesFromPixelBuffer } from './ImageHighBitDocument';
import { HIGH_BIT_ADMISSION_BUDGET_BYTES, HIGH_BIT_RUNTIME_RESERVE_BYTES } from './admission';
import {
  compositePixelBuffersForTarget,
  NativeCompositeRefusal,
  type NativeCompositeLayer,
} from './compositeBuffers';

export interface NativeDisplayResult {
  bitmap: LayerBitmap;
  refusal?: NativeCompositeRefusal;
}

export interface NativeWorkerMemoryAdmission {
  admitted: boolean;
  estimatedBytes: number;
  budgetBytes: number;
  reason?: string;
}

/** Account for structured-clone authority copies and worker/display outputs before dispatch. */
export function checkNativeWorkerMemoryAdmission(doc: ImageDocument, budgetBytes = HIGH_BIT_ADMISSION_BUDGET_BYTES): NativeWorkerMemoryAdmission {
  const invalid = (): NativeWorkerMemoryAdmission => ({
    admitted: false,
    estimatedBytes: Number.POSITIVE_INFINITY,
    budgetBytes,
    reason: 'Native high-bit worker refused before cloning: document dimensions or payload byte counts are not finite positive safe sizes.',
  });
  if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 0
    || !Number.isSafeInteger(doc.width) || !Number.isSafeInteger(doc.height)
    || doc.width < 1 || doc.height < 1 || !Array.isArray(doc.layers)) return invalid();

  let authorityBytes = 0;
  let maskBytes = 0;
  for (const layer of doc.layers) {
    const authority = layer.pixels?.data.byteLength ?? 0;
    if (!Number.isSafeInteger(authority) || authority < 0) return invalid();
    authorityBytes += authority;
    if (!Number.isSafeInteger(authorityBytes)) return invalid();
    if (layer.mask) {
      if (!Number.isSafeInteger(layer.mask.width) || !Number.isSafeInteger(layer.mask.height)
        || layer.mask.width < 1 || layer.mask.height < 1) return invalid();
      const bytes = layer.mask.width * layer.mask.height * 4;
      if (!Number.isSafeInteger(bytes)) return invalid();
      maskBytes += bytes;
      if (!Number.isSafeInteger(maskBytes)) return invalid();
    }
  }
  const pixels = doc.width * doc.height;
  const outputBytes = pixels * 4 * (documentWorkingDepth(doc) === 16 ? 2 : 4);
  const displayBytes = pixels * 4;
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(outputBytes) || !Number.isSafeInteger(displayBytes)) return invalid();
  const estimatedBytes = authorityBytes + maskBytes + authorityBytes + outputBytes + displayBytes + HIGH_BIT_RUNTIME_RESERVE_BYTES;
  if (!Number.isSafeInteger(estimatedBytes)) return invalid();
  const admitted = Number.isSafeInteger(estimatedBytes) && estimatedBytes <= budgetBytes;
  return admitted
    ? { admitted, estimatedBytes, budgetBytes }
    : {
        admitted,
        estimatedBytes,
        budgetBytes,
        reason: `Native high-bit worker refused before cloning: estimated authority/clone/output/display cost ${String(estimatedBytes)} bytes exceeds the ${String(budgetBytes)}-byte admission budget.`,
      };
}

function layerHasUnsupportedGeometry(layer: ImageLayer): boolean {
  return layer.x !== 0 || layer.y !== 0
    || layer.rotationDeg !== undefined && layer.rotationDeg !== 0
    || layer.skewXDeg !== undefined && layer.skewXDeg !== 0
    || layer.skewYDeg !== undefined && layer.skewYDeg !== 0
    || layer.perspectiveX !== undefined && layer.perspectiveX !== 0
    || layer.perspectiveY !== undefined && layer.perspectiveY !== 0
    || layer.warp !== undefined && layer.warp !== null
    || layer.warpMesh !== undefined && layer.warpMesh !== null
    || layer.cornerOffsets !== undefined && layer.cornerOffsets !== null;
}

function maskPixelBuffer(mask: LayerBitmap): PixelBuffer {
  const imageData = getBitmapImageData(mask);
  const pixels: PixelBuffer = {
    width: imageData.width,
    height: imageData.height,
    model: 'rgb',
    depth: 'u8',
    data: new Uint8Array(imageData.data),
  };
  return pixels;
}

/** Build the serializable native layer payload; no authority proxy is read. */
export function prepareNativeCompositeLayers(doc: ImageDocument): NativeCompositeLayer[] {
  const layers: NativeCompositeLayer[] = [];
  for (const layer of doc.layers) {
    if (layer.type !== 'image') {
      throw new NativeCompositeRefusal(
        'unsupported-state',
        `Native high-bit render refused before mutation: layer type "${layer.type}" has no native compositor payload; the 8-bit display proxy would lose precision.`,
      );
    }
    if (!layer.pixels) {
      throw new NativeCompositeRefusal(
        'unsupported-state',
        'Native high-bit render refused before mutation: an image layer has no PixelBuffer authority; the 8-bit display proxy would lose precision.',
      );
    }
    layers.push({
      pixels: layer.pixels,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      mask: layer.mask ? maskPixelBuffer(layer.mask) : null,
      hasTransform: layerHasUnsupportedGeometry(layer),
      hasEffects: Boolean(
        layer.effects?.some((effect) => effect.enabled)
        || layer.filters?.some((filter) => filter.enabled)
        || layer.blendIf
        || layer.clippingMask
        || layer.maskLinkSourceLayerId,
      ),
      hasAdjustment: Boolean(layer.adjustment),
    });
  }
  return layers;
}

function emptyBitmap(doc: ImageDocument): LayerBitmap {
  const bitmap = createBitmap(doc.width, doc.height);
  const context = bitmap.getContext('2d');
  context?.clearRect(0, 0, bitmap.width, bitmap.height);
  return bitmap;
}

/** Return a bounded transparent placeholder after a pre-dispatch refusal. */
export function createNativeRefusalDisplay(_doc: ImageDocument): LayerBitmap {
  return createBitmap(1, 1);
}

/** Compose a mounted high-bit document and expose only a derived display bitmap. */
export function renderNativeHighBitDocument(doc: ImageDocument): NativeDisplayResult {
  try {
    const layers = prepareNativeCompositeLayers(doc);
    const pixels = compositePixelBuffersForTarget(layers, doc.width, doc.height);
    const bitmap = emptyBitmap(doc);
    const proxy = rgbaProxyBytesFromPixelBuffer(pixels);
    const imageBytes = new Uint8ClampedArray(new ArrayBuffer(proxy.byteLength));
    imageBytes.set(proxy);
    putBitmapImageData(bitmap, new ImageData(imageBytes, pixels.width, pixels.height));
    return { bitmap };
  } catch (error) {
    const refusal = error instanceof NativeCompositeRefusal
      ? error
      : new NativeCompositeRefusal('unsupported-state', error instanceof Error ? error.message : 'Native high-bit render refused.');
    return { bitmap: emptyBitmap(doc), refusal };
  }
}

export function isHighBitDocument(doc: ImageDocument): boolean {
  return documentWorkingDepth(doc) !== 8;
}

export function dispatchNativeRenderRefusal(refusal: NativeCompositeRefusal): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('sloom-high-bit-render-refused', {
    detail: {
      code: refusal.code,
      disclosure: `${refusal.message} No pixels were changed.`,
    },
  }));
}
