import type { LayerBitmap } from '../../types/imageEditor';

interface ImmutableBitmapRecord {
  context: OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  getContextDescriptor?: PropertyDescriptor;
  widthDescriptor?: PropertyDescriptor;
  heightDescriptor?: PropertyDescriptor;
  transferDescriptor?: PropertyDescriptor;
}

const immutableBitmaps = new WeakMap<LayerBitmap, ImmutableBitmapRecord>();

export class UnsupportedLayerBitmapPlatformError extends Error {
  readonly code = 'LAYER_BITMAP_UNSUPPORTED_PLATFORM' as const;

  constructor(operation: string) {
    super(
      `OffscreenCanvas is required to ${operation}. `
      + 'Run Sloom Studio in a supported browser or desktop runtime with OffscreenCanvas enabled.',
    );
    this.name = 'UnsupportedLayerBitmapPlatformError';
  }
}

/**
 * Thin wrappers over OffscreenCanvas for use as raster layer buffers.
 * These delegate directly to the native API; they exist to give the rest of
 * the editor a single import surface and to keep test code free of
 * `OffscreenCanvas` references when not strictly needed.
 */

export function createBitmap(width: number, height: number): LayerBitmap {
  return new OffscreenCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
}

export function cloneBitmap(src: LayerBitmap): LayerBitmap {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new UnsupportedLayerBitmapPlatformError('clone an Image layer bitmap');
  }
  const dest = createBitmap(src.width, src.height);
  const ctx = getCtx(dest);
  ctx.drawImage(src, 0, 0);
  return dest;
}

export function clearBitmap(bitmap: LayerBitmap): void {
  const ctx = getWritableCtx(bitmap);
  ctx.clearRect(0, 0, bitmap.width, bitmap.height);
}

export function fillBitmap(bitmap: LayerBitmap, color: string): void {
  const ctx = getWritableCtx(bitmap);
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  ctx.restore();
}

export function getBitmapImageData(bitmap: LayerBitmap): ImageData {
  return getCtx(bitmap).getImageData(0, 0, bitmap.width, bitmap.height);
}

export function putBitmapImageData(
  bitmap: LayerBitmap,
  imageData: ImageData,
  dx = 0,
  dy = 0,
): void {
  // Defensive coercion: code across the editor sometimes builds a plain {width,height,data} object
  // cast `as ImageData` (looks correct to TypeScript). The browser's putImageData() rejects those
  // ("parameter 1 is not of type 'ImageData'"), silently breaking whatever tool/effect produced it.
  // Wrap such an object in a real ImageData here so every caller routed through this helper is safe.
  const like = imageData as { data: Uint8ClampedArray; width: number; height: number };
  const real = typeof ImageData !== 'undefined' && !(imageData instanceof ImageData)
    ? new ImageData(new Uint8ClampedArray(like.data), like.width, like.height)
    : imageData;
  getWritableCtx(bitmap).putImageData(real, dx, dy);
}

export function blitInto(
  dest: LayerBitmap,
  src: CanvasImageSource,
  dx = 0,
  dy = 0,
): void {
  getWritableCtx(dest).drawImage(src, dx, dy);
}

/**
 * Named snapshots expose their canvases for read/encode/clone operations, but
 * never expose a writable 2D context. This makes a successfully verified
 * snapshot resource immutable for the lifetime of its verification cache.
 */
export function makeBitmapImmutable(bitmap: LayerBitmap): void {
  if (immutableBitmaps.has(bitmap)) return;
  const context = getCtx(bitmap);
  const record: ImmutableBitmapRecord = {
    context,
    width: bitmap.width,
    height: bitmap.height,
    getContextDescriptor: Object.getOwnPropertyDescriptor(bitmap, 'getContext'),
    widthDescriptor: Object.getOwnPropertyDescriptor(bitmap, 'width'),
    heightDescriptor: Object.getOwnPropertyDescriptor(bitmap, 'height'),
    transferDescriptor: Object.getOwnPropertyDescriptor(bitmap, 'transferToImageBitmap'),
  };
  immutableBitmaps.set(bitmap, record);
  try {
    Object.defineProperties(bitmap, {
      getContext: {
        configurable: true,
        value: () => null,
      },
      width: {
        configurable: true,
        get: () => record.width,
        set: () => {
          throw new Error('Verified Image snapshot bitmaps are immutable.');
        },
      },
      height: {
        configurable: true,
        get: () => record.height,
        set: () => {
          throw new Error('Verified Image snapshot bitmaps are immutable.');
        },
      },
      transferToImageBitmap: {
        configurable: true,
        value: () => {
          throw new Error('Verified Image snapshot bitmaps cannot be transferred.');
        },
      },
    });
  } catch (error) {
    immutableBitmaps.delete(bitmap);
    throw new Error('Image snapshot bitmap could not be made immutable.', { cause: error });
  }
}

export function isBitmapImmutable(bitmap: LayerBitmap): boolean {
  return immutableBitmaps.has(bitmap);
}

/** Remove the read-only facade immediately before the owning snapshot releases the canvas. */
export function releaseImmutableBitmap(bitmap: LayerBitmap): void {
  const record = immutableBitmaps.get(bitmap);
  if (!record) return;
  restoreOwnDescriptor(bitmap, 'getContext', record.getContextDescriptor);
  restoreOwnDescriptor(bitmap, 'width', record.widthDescriptor);
  restoreOwnDescriptor(bitmap, 'height', record.heightDescriptor);
  restoreOwnDescriptor(bitmap, 'transferToImageBitmap', record.transferDescriptor);
  immutableBitmaps.delete(bitmap);
}

export async function bitmapToBlob(
  bitmap: LayerBitmap,
  type: string = 'image/png',
): Promise<Blob> {
  return bitmap.convertToBlob({ type });
}

/**
 * Encode a layer bitmap to a base64 PNG data URL for serialization into a project file
 * (.sloom / .slimg). Chunked base64 so multi-megabyte 4K layers don't blow the call stack.
 * Decode the result back into a live bitmap with `bitmapFromUrl`.
 */
export async function bitmapToPngDataUrl(bitmap: LayerBitmap): Promise<string> {
  const blob = await bitmap.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export async function bitmapFromImageSource(image: CanvasImageSource): Promise<LayerBitmap> {
  const width = (image as { width?: number }).width ?? 0;
  const height = (image as { height?: number }).height ?? 0;
  const bitmap = createBitmap(width || 1, height || 1);
  getCtx(bitmap).drawImage(image, 0, 0);
  return bitmap;
}

export async function bitmapFromUrl(
  url: string,
  expected?: { width: number; height: number },
): Promise<LayerBitmap> {
  if (expected) assertBoundedPngDataUrl(url, expected.width, expected.height);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);
  try {
    if (expected && (imageBitmap.width !== expected.width || imageBitmap.height !== expected.height)) {
      throw new Error('Image snapshot PNG decoded dimensions do not match its integrity proof.');
    }
    return await bitmapFromImageSource(imageBitmap);
  } finally {
    imageBitmap.close();
  }
}

export function assertPngBytesMatchDimensions(bytes: Uint8Array, width: number, height: number): void {
  if (bytes.byteLength < 24) throw new Error('Image snapshot PNG is missing its IHDR dimensions.');
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw new Error('Image snapshot payload is not a PNG.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR'
    || view.getUint32(16, false) !== width
    || view.getUint32(20, false) !== height
  ) {
    throw new Error('Image snapshot PNG dimensions do not match its integrity proof.');
  }
  const rawBytes = width * height * 4;
  const maxPngBytes = rawBytes + Math.max(1024 * 1024, Math.ceil(rawBytes / 8));
  if (!Number.isSafeInteger(rawBytes) || bytes.byteLength > maxPngBytes) {
    throw new Error('Image snapshot PNG exceeds its proven pixel allocation budget.');
  }
}

function assertBoundedPngDataUrl(url: string, width: number, height: number): void {
  const prefix = 'data:image/png;base64,';
  if (!url.startsWith(prefix)) throw new Error('Image snapshot project payload is not a PNG data URL.');
  const payload = url.slice(prefix.length);
  const decodedByteLength = Math.floor(payload.length * 3 / 4)
    - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
  const rawBytes = width * height * 4;
  const maxPngBytes = rawBytes + Math.max(1024 * 1024, Math.ceil(rawBytes / 8));
  if (!Number.isSafeInteger(decodedByteLength) || decodedByteLength > maxPngBytes) {
    throw new Error('Image snapshot project PNG exceeds its proven pixel allocation budget.');
  }
  const headerPayload = payload.slice(0, 32);
  let header: Uint8Array;
  try {
    header = Uint8Array.from(atob(headerPayload), (character) => character.charCodeAt(0));
  } catch (error) {
    throw new Error('Image snapshot project PNG header is malformed.', { cause: error });
  }
  assertPngBytesMatchDimensions(header, width, height);
}

function getCtx(bitmap: LayerBitmap): OffscreenCanvasRenderingContext2D {
  const immutable = immutableBitmaps.get(bitmap);
  if (immutable) return immutable.context;
  const ctx = bitmap.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D context for layer bitmap');
  }
  return ctx;
}

function getWritableCtx(bitmap: LayerBitmap): OffscreenCanvasRenderingContext2D {
  if (immutableBitmaps.has(bitmap)) {
    throw new Error('Verified Image snapshot bitmaps are immutable.');
  }
  return getCtx(bitmap);
}

function restoreOwnDescriptor(
  bitmap: LayerBitmap,
  property: 'getContext' | 'width' | 'height' | 'transferToImageBitmap',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(bitmap, property, descriptor);
  } else {
    delete (bitmap as unknown as Record<string, unknown>)[property];
  }
}
