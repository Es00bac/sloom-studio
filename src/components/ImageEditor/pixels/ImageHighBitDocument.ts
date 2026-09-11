import type {
  EditorOperation,
  ImageDocument,
  ImageLayer,
  LayerBitmap,
  PixelBuffer,
  PixelDepth,
} from '../../../types/imageEditor';
import {
  convertPixelBuffer,
  createPixelBuffer,
  pixelBufferSampleCount,
} from './PixelBuffer';
import {
  checkHighBitAdmission,
  describeHighBitAdmissionRefusal,
} from './admission';

/**
 * MH-009 A1 working-depth conversion planning. Pure and canvas-free: bitmap
 * access is injected through `PixelBitmapBridge` so conversion, admission and
 * history planning are testable without a browser canvas backend.
 */

export type DocumentWorkingDepth = 8 | 16 | 32;

export const SUPPORTED_WORKING_DEPTHS: readonly DocumentWorkingDepth[] = [8, 16, 32];

export function normalizeWorkingDepth(value: unknown): DocumentWorkingDepth {
  return value === 16 || value === 32 ? value : 8;
}

export function documentWorkingDepth(document: ImageDocument): DocumentWorkingDepth {
  return normalizeWorkingDepth(document.metadata?.bitDepth);
}

export function describeWorkingDepth(depth: DocumentWorkingDepth): string {
  switch (depth) {
    case 8: return '8-bit integer per channel (8-bit RGBA canvas working surface)';
    case 16: return '16-bit integer per channel (u16 pixel authority, sRGB-encoded)';
    case 32: return '32-bit float per channel (f32 pixel authority, linear)';
  }
}

/**
 * A1 truth boundary: storage, conversion, history and persistence run at the
 * working depth; visible editing still happens on the byte-identical 8-bit
 * proxy until the A3/A4 compositor and tool slices land. Every surface that
 * describes A1 behavior must carry this disclosure.
 */
export const HIGH_BIT_PROXY_EDIT_DISCLOSURE =
  'Visible paint, adjustments, filters and exports still use the 8-bit display proxy in this '
  + 'stage; the high-bit authority is converted, undone and persisted bit-exactly, and proxy '
  + 'edits made after a conversion stay out of the authority until depth-aware tools land.';

export interface PixelBitmapBridge {
  readBitmapRgba(bitmap: LayerBitmap): Uint8ClampedArray;
  createBitmapFromRgba(bytes: Uint8ClampedArray, width: number, height: number): LayerBitmap;
}

const defaultBridge: PixelBitmapBridge = {
  readBitmapRgba: (bitmap) => {
    const ctx = bitmap.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D context for layer bitmap');
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  },
  createBitmapFromRgba: (bytes, width, height) => {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to acquire 2D context for layer bitmap');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0);
    return canvas;
  },
};

let activeBridge = defaultBridge;

/** Test seam: route bitmap access through a fake canvas implementation. */
export function setPixelBitmapBridge(bridge: PixelBitmapBridge | null): void {
  activeBridge = bridge ?? defaultBridge;
}

export function getPixelBitmapBridge(): PixelBitmapBridge {
  return activeBridge;
}

/** Build a pixel authority from straight RGBA canvas bytes at a target depth. */
export function pixelBufferFromRgbaBytes(
  bytes: Uint8ClampedArray,
  width: number,
  height: number,
  depth: PixelDepth,
): PixelBuffer {
  const u8 = createPixelBuffer({ width, height, depth: 'u8' });
  (u8.data as Uint8Array).set(bytes.subarray(0, pixelBufferSampleCount(u8)));
  return depth === 'u8' ? u8 : convertPixelBuffer(u8, depth);
}

/** Regenerate the 8-bit display proxy bytes of an authority (sRGB encode for f32). */
export function rgbaProxyBytesFromPixelBuffer(buffer: PixelBuffer): Uint8ClampedArray {
  const u8 = buffer.depth === 'u8' ? buffer : convertPixelBuffer(buffer, 'u8');
  return new Uint8ClampedArray(
    (u8.data as Uint8Array).buffer,
    (u8.data as Uint8Array).byteOffset,
    (u8.data as Uint8Array).byteLength,
  );
}

/** Read a live bitmap canvas into a u8 authority and convert it to the target depth. */
export function pixelBufferFromBitmap(
  bitmap: LayerBitmap,
  depth: Exclude<PixelDepth, 'u8'>,
): PixelBuffer {
  const bytes = activeBridge.readBitmapRgba(bitmap);
  return pixelBufferFromRgbaBytes(bytes, bitmap.width, bitmap.height, depth);
}

export type ConvertDepthOperation = Extract<EditorOperation, { kind: 'convertDepth' }>;

export type ConvertDepthPlan =
  | {
      ok: true;
      targetDepth: DocumentWorkingDepth;
      convertedLayerIds: string[];
      operation: ConvertDepthOperation;
    }
  | { ok: false; code: ConvertDepthRefusalCode; message: string };

export type ConvertDepthRefusalCode =
  | 'unknown-document'
  | 'unsupported-depth'
  | 'already-at-depth'
  | 'no-raster-layers'
  | 'budget-exceeded';

interface ConvertDepthLayerState {
  pixels: PixelBuffer | null;
  pixelsVersion: number | undefined;
}

function isConvertibleLayer(layer: ImageLayer): boolean {
  return layer.type === 'image' && (Boolean(layer.bitmap) || Boolean(layer.pixels));
}

/**
 * Plan a whole-document working-depth conversion. The admission gate runs
 * before any allocation; a refusal never mutates the document.
 */
export function planConvertDocumentDepth(
  document: ImageDocument,
  targetDepth: number,
  options?: { budgetBytes?: number },
): ConvertDepthPlan {
  if (!SUPPORTED_WORKING_DEPTHS.includes(targetDepth as DocumentWorkingDepth)) {
    return {
      ok: false,
      code: 'unsupported-depth',
      message: `Working depth ${String(targetDepth)} is unsupported; supported depths are 8, 16 and 32 bits.`,
    };
  }
  const currentDepth = documentWorkingDepth(document);
  const target = targetDepth as DocumentWorkingDepth;
  if (currentDepth === target) {
    return {
      ok: false,
      code: 'already-at-depth',
      message: `Document is already at ${describeWorkingDepth(target)}.`,
    };
  }
  const convertible = document.layers.filter(isConvertibleLayer);
  if (convertible.length === 0) {
    return {
      ok: false,
      code: 'no-raster-layers',
      message: 'Document has no raster layers to convert.',
    };
  }

  if (target !== 8) {
    const admission = checkHighBitAdmission({
      depth: target === 16 ? 'u16' : 'f32',
      layers: convertible.map((layer) => ({
        width: layer.pixels?.width ?? layer.bitmap?.width ?? 1,
        height: layer.pixels?.height ?? layer.bitmap?.height ?? 1,
      })),
      ...(options?.budgetBytes !== undefined ? { budgetBytes: options.budgetBytes } : {}),
    });
    if (!admission.admitted) {
      return {
        ok: false,
        code: 'budget-exceeded',
        message: describeHighBitAdmissionRefusal(admission),
      };
    }
  }

  const beforeLayers: Record<string, ConvertDepthLayerState> = {};
  const afterLayers: Record<string, ConvertDepthLayerState> = {};
  for (const layer of convertible) {
    const beforePixels = layer.pixels ?? null;
    beforeLayers[layer.id] = {
      pixels: beforePixels,
      pixelsVersion: layer.pixelsVersion,
    };
    if (target === 8) {
      // Collapsing to 8-bit: the byte-identical display proxy becomes the
      // working surface and the high-bit authority is released.
      afterLayers[layer.id] = { pixels: null, pixelsVersion: undefined };
      continue;
    }
    const depth = target === 16 ? 'u16' : 'f32';
    const authority = beforePixels
      ? convertPixelBuffer(beforePixels, depth)
      : pixelBufferFromBitmap(layer.bitmap!, depth);
    afterLayers[layer.id] = {
      pixels: authority,
      pixelsVersion: layer.bitmapVersion,
    };
  }

  return {
    ok: true,
    targetDepth: target,
    convertedLayerIds: convertible.map((layer) => layer.id),
    operation: {
      kind: 'convertDepth',
      docId: document.id,
      before: { bitDepth: currentDepth, layers: beforeLayers },
      after: { bitDepth: target, layers: afterLayers },
    },
  };
}
