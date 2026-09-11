import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import { encodeExr } from './codecs/exr';
import { encodePng16Rgba } from './codecs/png16';
import { encodeHighBitTiff } from './codecs/tiffHighBit';
import { assertPixelBufferShape, MAX_PIXEL_BUFFER_BYTES } from './pixels/PixelBuffer';

export const IMAGE_EXR_MIME_TYPE = 'image/x-exr';
const MAX_NATIVE_EXPORT_BYTES = 512 * 1024 * 1024;

export type NativeHighBitExportFormat = 'png' | 'tif' | 'exr';

/**
 * Encode the one-layer native authority subset without reading the 8-bit proxy.
 * A null result means the document is an ordinary 8-bit document and should
 * continue through the established browser export path.
 */
export function encodeNativeHighBitDocument(
  document: ImageDocument,
  mimeType: string,
): Uint8Array | null {
  const workingDepth = document.metadata?.bitDepth;
  if (workingDepth !== 16 && workingDepth !== 32) return null;

  const layer = getNativeExportLayer(document);
  const pixels = layer.pixels;
  if (!pixels) throw new Error('Native high-bit export refused: the document has no pixel authority.');
  assertPixelBufferShape(pixels);
  if (pixels.depth !== (workingDepth === 16 ? 'u16' : 'f32')) {
    throw new Error(`Native high-bit export refused: document depth ${workingDepth} does not match layer authority ${pixels.depth}.`);
  }
  if (pixels.data.byteLength > MAX_NATIVE_EXPORT_BYTES || pixels.data.byteLength > MAX_PIXEL_BUFFER_BYTES) {
    throw new Error(`Native high-bit export refused: authority payload exceeds the ${MAX_NATIVE_EXPORT_BYTES}-byte export bound.`);
  }
  if (pixels.depth === 'f32' && [...pixels.data].some((sample) => !Number.isFinite(sample))) {
    throw new Error('Native high-bit export refused: float authority contains a non-finite sample.');
  }

  switch (mimeType) {
    case 'image/png':
      if (pixels.depth !== 'u16') {
        throw new Error('Native PNG export refused: PNG16 preserves u16 authority only; use TIFF32f or OpenEXR for f32 data.');
      }
      return encodePng16Rgba({ width: pixels.width, height: pixels.height, data: pixels.data as Uint16Array });
    case 'image/tiff':
      return pixels.depth === 'u16'
        ? encodeHighBitTiff({ width: pixels.width, height: pixels.height, depth: 'u16', data: pixels.data as Uint16Array })
        : encodeHighBitTiff({ width: pixels.width, height: pixels.height, depth: 'f32', data: pixels.data as Float32Array });
    case IMAGE_EXR_MIME_TYPE:
    case 'image/exr':
      if (pixels.depth !== 'f32') {
        throw new Error('Native OpenEXR export refused: this route preserves f32 authority only; use PNG16 or TIFF16 for u16 data.');
      }
      return encodeExr({ width: pixels.width, height: pixels.height, depth: 'f32', data: pixels.data as Float32Array });
    default:
      throw new Error(`Native high-bit export refused: ${mimeType} cannot preserve ${workingDepth}-bit authority without an 8-bit conversion.`);
  }
}

function getNativeExportLayer(document: ImageDocument): ImageLayer {
  if (!Number.isSafeInteger(document.width) || !Number.isSafeInteger(document.height)
    || document.width < 1 || document.height < 1) {
    throw new Error('Native high-bit export refused: document dimensions are invalid.');
  }
  const visible = document.layers.filter((layer) => layer.visible);
  if (visible.length !== 1 || visible[0]?.type !== 'image') {
    throw new Error('Native high-bit export refused: only one visible raster layer can be exported without a precision-losing composite.');
  }
  const layer = visible[0];
  if (!layer || layer.x !== 0 || layer.y !== 0 || layer.rotationDeg || layer.skewXDeg || layer.skewYDeg
    || layer.perspectiveX || layer.perspectiveY || layer.warp || layer.warpMesh || layer.cornerOffsets
    || layer.mask || layer.opacity !== 1 || layer.blendMode !== 'normal' || layer.effects?.length || layer.filters?.length) {
    throw new Error('Native high-bit export refused: transformed, masked, styled, filtered, or blended layers need a depth-aware composite first.');
  }
  if (!layer.pixels || layer.pixels.width !== document.width || layer.pixels.height !== document.height) {
    throw new Error('Native high-bit export refused: authority dimensions must exactly match the document.');
  }
  return layer;
}
