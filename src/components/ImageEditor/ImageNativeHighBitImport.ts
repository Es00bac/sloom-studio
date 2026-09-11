import type { LayerBitmap, PixelBuffer } from '../../types/imageEditor';
import { createBitmap } from './LayerBitmap';
import { decodeExr } from './codecs/exr';
import { decodePngRaster } from './codecs/png16';
import { decodeHighBitTiff } from './codecs/tiffHighBit';
import { createPixelBuffer, assertPixelBufferShape } from './pixels/PixelBuffer';
import { syncPixelBufferProxy } from './pixels/highBitTools';
import type { SourceImageFormatPolicy } from './ImageFileFormats';

export interface NativeHighBitImport {
  width: number;
  height: number;
  depth: 'u16' | 'f32';
  pixels: PixelBuffer;
  bitmap: LayerBitmap;
}

/**
 * Decode one of the reviewed high-bit codec subsets and mount its authority
 * together with a derived browser proxy. A null result means the policy is a
 * normal 8-bit/browser-raster route; recognized native formats throw their
 * codec's typed refusal rather than falling through to lossy decoding.
 */
export function decodeNativeHighBitImport(
  bytes: Uint8Array,
  policy: SourceImageFormatPolicy,
): NativeHighBitImport | null {
  let width: number;
  let height: number;
  let depth: NativeHighBitImport['depth'];
  let data: Uint16Array | Float32Array;

  if (policy.kind === 'tiff' && policy.highBitDepth) {
    const decoded = decodeHighBitTiff(bytes);
    width = decoded.width;
    height = decoded.height;
    depth = decoded.depth;
    data = decoded.data;
  } else if (policy.kind === 'exr') {
    const decoded = decodeExr(bytes);
    width = decoded.width;
    height = decoded.height;
    depth = 'f32';
    data = decoded.data;
  } else if (policy.kind === 'raster' && policy.highBitDepth && policy.sourceFormatLabel === 'PNG') {
    const decoded = decodePngRaster(bytes);
    if (decoded.bitDepth !== 16 || !(decoded.data instanceof Uint16Array)) {
      throw new Error('PNG native import refused: expected a 16-bit/channel PNG raster.');
    }
    width = decoded.width;
    height = decoded.height;
    depth = 'u16';
    data = decoded.data;
  } else {
    return null;
  }

  const pixels = createPixelBuffer({ width, height, depth });
  pixels.data.set(data);
  assertPixelBufferShape(pixels);
  const bitmap = createBitmap(width, height);
  if (!syncPixelBufferProxy(pixels, bitmap)) {
    throw new Error('Native high-bit import refused: browser proxy derivation is unavailable.');
  }
  return { width, height, depth, pixels, bitmap };
}
