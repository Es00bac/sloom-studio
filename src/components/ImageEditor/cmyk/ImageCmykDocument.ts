import type {
  ImageCmykDocumentMetadata,
  ImageCmykPixelBuffer,
  ImageDocument,
  LayerBitmap,
} from '../../../types/imageEditor';
import {
  createImageCmykaToDisplayTransform,
  createImageRgbToCmykaTransform,
  type ImageCmykProfileInfo,
} from '../../../lib/iccTransforms';
import { cloneBitmap, getBitmapImageData, putBitmapImageData } from '../LayerBitmap';
import { encodeImageCmykTiff, type ImageCmykTiffExport } from './cmykTiff';
import type { ImageCmykProfileIdentity } from './cmykProfiles';

export const IMAGE_CMYK_DOCUMENT_MAX_PIXELS = 8_388_608;
export const IMAGE_CMYK_CHANNELS = 5 as const;
export type ImageCmykPlate = 'c' | 'm' | 'y' | 'k';

function assertDimensions(width: number, height: number): number {
  const count = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(count) || count > IMAGE_CMYK_DOCUMENT_MAX_PIXELS) {
    throw new Error(`CMYK documents are limited to ${IMAGE_CMYK_DOCUMENT_MAX_PIXELS.toLocaleString()} pixels.`);
  }
  return count;
}

export function createImageCmykPixelBuffer(width: number, height: number, data?: Uint8Array): ImageCmykPixelBuffer {
  const count = assertDimensions(width, height);
  if (data && data.byteLength !== count * IMAGE_CMYK_CHANNELS) {
    throw new Error('CMYK authority data does not match its dimensions.');
  }
  return {
    model: 'cmyk',
    depth: 'u8',
    width,
    height,
    data: data ? new Uint8Array(data) : new Uint8Array(count * IMAGE_CMYK_CHANNELS),
  };
}

export function assertImageCmykPixelBuffer(buffer: ImageCmykPixelBuffer): void {
  if (!buffer || buffer.model !== 'cmyk' || buffer.depth !== 'u8') throw new Error('CMYK authority must be an interleaved u8 CMYKA buffer.');
  const count = assertDimensions(buffer.width, buffer.height);
  if (!(buffer.data instanceof Uint8Array) || buffer.data.byteLength !== count * IMAGE_CMYK_CHANNELS) {
    throw new Error('CMYK authority data does not match its dimensions.');
  }
}

export function cloneImageCmykPixelBuffer(buffer: ImageCmykPixelBuffer): ImageCmykPixelBuffer {
  assertImageCmykPixelBuffer(buffer);
  return createImageCmykPixelBuffer(buffer.width, buffer.height, buffer.data);
}

export function imageCmykPixelBufferEquals(left: ImageCmykPixelBuffer, right: ImageCmykPixelBuffer): boolean {
  assertImageCmykPixelBuffer(left);
  assertImageCmykPixelBuffer(right);
  if (left.width !== right.width || left.height !== right.height) return false;
  if (left.data.byteLength !== right.data.byteLength) return false;
  return left.data.every((value, index) => value === right.data[index]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) throw new Error('CMYK authority payload is malformed.');
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeImageCmykPixelBuffer(buffer: ImageCmykPixelBuffer): string {
  assertImageCmykPixelBuffer(buffer);
  return `sloom-cmyka-u8-${buffer.width}x${buffer.height}:${bytesToBase64(buffer.data)}`;
}

export function decodeImageCmykPixelBuffer(value: string): ImageCmykPixelBuffer {
  const match = /^sloom-cmyka-u8-(\d{1,5})x(\d{1,5}):/.exec(value);
  if (!match) throw new Error('CMYK authority payload header is malformed.');
  const width = Number(match[1]);
  const height = Number(match[2]);
  const data = base64ToBytes(value.slice(match[0].length));
  return createImageCmykPixelBuffer(width, height, data);
}

function assertSupportedDocument(document: ImageDocument): void {
  assertDimensions(document.width, document.height);
  if ((document.metadata?.bitDepth ?? 8) !== 8) {
    throw new Error('Native CMYK conversion is currently limited to 8-bit RGB documents; MH-009 u16/f32 authority was not downcast.');
  }
}

function rgbaBytes(bitmap: LayerBitmap): Uint8Array {
  const image = getBitmapImageData(bitmap);
  return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
}

function bitmapFromRgba(source: LayerBitmap, rgba: Uint8Array): LayerBitmap {
  const bitmap = cloneBitmap(source);
  const bytes = new Uint8ClampedArray(rgba.byteLength);
  bytes.set(rgba);
  putBitmapImageData(bitmap, new ImageData(bytes, bitmap.width, bitmap.height));
  return bitmap;
}

export interface ImageCmykConversionResult {
  document: ImageDocument;
  profile: ImageCmykProfileInfo;
  convertedLayerIds: string[];
}

/** Canvas-free ICC conversion seam used by import/export workers and deterministic tests. */
export async function convertImageRgbaBytesToCmyka(
  rgba: Uint8Array,
  width: number,
  height: number,
  profileBytes: Uint8Array,
  options: { intent?: ImageCmykDocumentMetadata['intent']; blackPointCompensation?: boolean } = {},
): Promise<ImageCmykPixelBuffer> {
  const count = assertDimensions(width, height);
  if (rgba.byteLength !== count * 4) throw new Error('RGB pixels do not match their dimensions.');
  const transform = await createImageRgbToCmykaTransform(profileBytes, 'u8', options);
  try {
    return createImageCmykPixelBuffer(width, height, transform.transformImage(rgba, width, height));
  } finally {
    transform.dispose();
  }
}

export async function convertImageCmykaBytesToRgba(
  cmyka: ImageCmykPixelBuffer,
  profileBytes: Uint8Array,
  options: { intent?: ImageCmykDocumentMetadata['intent']; blackPointCompensation?: boolean } = {},
): Promise<Uint8Array> {
  assertImageCmykPixelBuffer(cmyka);
  const transform = await createImageCmykaToDisplayTransform(profileBytes, options);
  try {
    return transform.transformImage(cmyka.data, cmyka.width, cmyka.height);
  } finally {
    transform.dispose();
  }
}

/** Convert every raster layer to native CMYKA while retaining an ICC-rendered RGB display proxy. */
export async function convertImageDocumentToCmyk(
  document: ImageDocument,
  metadata: ImageCmykDocumentMetadata,
  profileBytes: Uint8Array,
): Promise<ImageCmykConversionResult> {
  assertSupportedDocument(document);
  const transform = await createImageRgbToCmykaTransform(profileBytes, 'u8', {
    intent: metadata.intent,
    blackPointCompensation: metadata.blackPointCompensation,
  });
  try {
    const layers = document.layers.map((layer) => {
      if (!layer.bitmap || layer.type !== 'image') return layer;
      const rgba = rgbaBytes(layer.bitmap);
      const data = transform.transformImage(rgba, layer.bitmap.width, layer.bitmap.height);
      const cmykPixels = createImageCmykPixelBuffer(layer.bitmap.width, layer.bitmap.height, data);
      return { ...layer, cmykPixels, cmykPixelsData: undefined };
    });
    const retainedMetadata: ImageCmykDocumentMetadata = {
      ...metadata,
      profileSource: metadata.profileSource ?? { kind: 'bundled', id: metadata.profileId },
      // Imported profiles are retained byte-for-byte in the document payload. Bundled identities
      // resolve from the shipped asset and do not duplicate their bytes in metadata.
      ...(metadata.profileSource?.kind === 'imported' && !metadata.profileBytesData
        ? { profileBytesData: bytesToBase64(profileBytes) }
        : {}),
    };
    const converted = {
      ...document,
      metadata: { ...document.metadata, colorMode: 'cmyk' as const, cmyk: retainedMetadata },
      layers,
      dirty: true,
    };
    const displayed = await renderImageDocumentCmykPreview(converted, profileBytes);
    return {
      document: displayed,
      profile: transform.profile,
      convertedLayerIds: layers.filter((layer) => Boolean(layer.cmykPixels)).map((layer) => layer.id),
    };
  } finally {
    transform.dispose();
  }
}

/** Render CMYKA authorities back to sRGB display proxies using the same ICC profile used for conversion. */
export async function renderImageDocumentCmykPreview(
  document: ImageDocument,
  profileBytes: Uint8Array,
): Promise<ImageDocument> {
  const metadata = document.metadata?.cmyk;
  if (document.metadata?.colorMode !== 'cmyk' || !metadata) throw new Error('The document is not a native CMYK document.');
  const transform = await createImageCmykaToDisplayTransform(profileBytes, {
    intent: metadata.intent,
    blackPointCompensation: metadata.blackPointCompensation,
  });
  try {
    return {
      ...document,
      layers: document.layers.map((layer) => {
        if (!layer.cmykPixels || !layer.bitmap) return layer;
        assertImageCmykPixelBuffer(layer.cmykPixels);
        // ICC paper-white simulation is a display-only operation. Transparent
        // CMYKA samples are rendered as the selected profile's zero-ink paper
        // colour; authority bytes retain their original alpha untouched.
        const proofPixels = metadata.paperWhiteSimulation
          ? (() => {
              const output = new Uint8Array(layer.cmykPixels.data);
              for (let offset = 4; offset < output.length; offset += IMAGE_CMYK_CHANNELS) {
                if (output[offset] === 0) output[offset] = 255;
              }
              return output;
            })()
          : layer.cmykPixels.data;
        const rgba = transform.transformImage(proofPixels, layer.cmykPixels.width, layer.cmykPixels.height);
        return { ...layer, bitmap: bitmapFromRgba(layer.bitmap, rgba) };
      }),
    };
  } finally {
    transform.dispose();
  }
}

/** Convert CMYKA authorities back to the sRGB working space through Little-CMS. */
export async function convertImageDocumentToRgb(
  document: ImageDocument,
  profileBytes: Uint8Array,
): Promise<ImageDocument> {
  if (document.metadata?.colorMode !== 'cmyk' || !document.metadata.cmyk) {
    throw new Error('The document is not a native CMYK document.');
  }
  const rendered = await renderImageDocumentCmykPreview(document, profileBytes);
  return {
    ...rendered,
    metadata: {
      ...rendered.metadata,
      colorMode: 'rgb',
      cmyk: undefined,
    },
    layers: rendered.layers.map((layer) => ({
      ...layer,
      cmykPixels: undefined,
      cmykPixelsData: undefined,
    })),
    dirty: true,
  };
}

/** Edit exactly one process plate; all other ink and alpha samples remain bit-exact. */
export function editImageCmykPlate(
  buffer: ImageCmykPixelBuffer,
  plate: ImageCmykPlate,
  edit: (value: number, pixel: number) => number,
): ImageCmykPixelBuffer {
  assertImageCmykPixelBuffer(buffer);
  const channel = ({ c: 0, m: 1, y: 2, k: 3 } as const)[plate];
  const output = cloneImageCmykPixelBuffer(buffer);
  for (let pixel = 0; pixel < buffer.width * buffer.height; pixel += 1) {
    const index = pixel * IMAGE_CMYK_CHANNELS + channel;
    const next = edit(buffer.data[index]!, pixel);
    output.data[index] = Number.isFinite(next) ? Math.max(0, Math.min(255, Math.round(next))) : 0;
  }
  return output;
}

/** Separate an authoritative process plate as a grayscale byte image, without formula conversion. */
export function extractImageCmykPlate(buffer: ImageCmykPixelBuffer, plate: ImageCmykPlate): Uint8Array {
  assertImageCmykPixelBuffer(buffer);
  const channel = ({ c: 0, m: 1, y: 2, k: 3 } as const)[plate];
  const output = new Uint8Array(buffer.width * buffer.height);
  for (let pixel = 0; pixel < output.length; pixel += 1) output[pixel] = buffer.data[pixel * IMAGE_CMYK_CHANNELS + channel]!;
  return output;
}

/** Composite compatible CMYKA raster layers in ink space for native DeviceCMYK output. */
export function compositeImageCmykLayers(document: ImageDocument): ImageCmykPixelBuffer {
  const visibleLayers = document.layers.filter((layer) => layer.visible !== false);
  const unsupported = visibleLayers.find((layer) => {
    // The canvas proxy supports a much broader compositing model than the native
    // ink compositor.  Never silently substitute the proxy's result for CMYK
    // authority: until each operation has an ink-space implementation, export
    // the simple full-canvas normal-raster subset only.
    if (!layer.cmykPixels || layer.type !== 'image') return true;
    if ((layer.x ?? 0) !== 0 || (layer.y ?? 0) !== 0 || layer.mask || layer.rotationDeg || layer.skewXDeg || layer.skewYDeg || layer.warpMesh) return true;
    if ((layer.blendMode ?? 'normal') !== 'normal') return true;
    return Boolean(layer.filters?.some((filter) => filter.enabled));
  });
  if (unsupported) {
    throw new Error(`CMYK TIFF export refuses layer "${unsupported.name}": positioned, masked, transformed, filtered, grouped, or non-normal-blend composition has no native ink-space exporter.`);
  }
  const layers = visibleLayers.filter((layer) => layer.cmykPixels);
  if (layers.length === 0) throw new Error('Native CMYK export requires at least one CMYK raster layer.');
  const first = layers[0]!.cmykPixels!;
  assertImageCmykPixelBuffer(first);
  const output = createImageCmykPixelBuffer(first.width, first.height);
  for (const layer of layers) {
    const source = layer.cmykPixels!;
    assertImageCmykPixelBuffer(source);
    if (source.width !== first.width || source.height !== first.height) throw new Error('CMYK export requires matching raster layer dimensions.');
    const opacity = Math.max(0, Math.min(1, Number.isFinite(layer.opacity) ? layer.opacity : 0));
    for (let pixel = 0; pixel < first.width * first.height; pixel += 1) {
      const offset = pixel * IMAGE_CMYK_CHANNELS;
      const sa = source.data[offset + 4]! / 255 * opacity;
      const ba = output.data[offset + 4]! / 255;
      const alpha = sa + ba * (1 - sa);
      if (alpha <= 0) continue;
      const multiply = layer.blendMode === 'multiply';
      for (let channel = 0; channel < 4; channel += 1) {
        const s = source.data[offset + channel]! / 255;
        const b = output.data[offset + channel]! / 255;
        const ink = multiply ? (s + b - s * b) : s;
        output.data[offset + channel] = Math.round(((ink * sa + b * ba * (1 - sa)) / alpha) * 255);
      }
      output.data[offset + 4] = Math.round(alpha * 255);
    }
  }
  return output;
}

export function exportImageDocumentCmykTiff(
  document: ImageDocument,
  profile: ImageCmykProfileIdentity,
  profileBytes: Uint8Array,
): ImageCmykTiffExport {
  if (document.metadata?.colorMode !== 'cmyk') throw new Error('CMYK TIFF export requires a native CMYK document.');
  return encodeImageCmykTiff(compositeImageCmykLayers(document), profile, profileBytes);
}

export function imageCmykDocumentUsesNativeAuthority(document: ImageDocument): boolean {
  return document.metadata?.colorMode === 'cmyk'
    && Boolean(document.metadata.cmyk)
    && document.layers.some((layer) => Boolean(layer.cmykPixels || layer.cmykPixelsData));
}
