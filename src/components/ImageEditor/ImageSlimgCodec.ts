import type { ImageDocument, LayerBitmap } from '../../types/imageEditor';
import { assertPngBytesMatchDimensions, createBitmap } from './LayerBitmap';
import type { SlimgCodec } from './ImageSlimgFormat';
import {
  deserializeSlimgAnyVersion,
  serializeSlimgV1Compatibility,
  serializeSlimgV2,
  type SerializedSlimgV1Compatibility,
} from './ImageSlimgV2Format';

/**
 * The real (browser) pixel codec for `.slimg`: layer bitmaps are stored as PNG inside the zip
 * container. This is thin glue over the canvas APIs; the structural serialization it drives
 * (`ImageSlimgFormat`) is unit-tested with an injected codec, so this module just supplies the
 * PNG encode/decode. Runs identically in Electron and Android/ALOS/DeX WebView (OffscreenCanvas +
 * createImageBitmap are available in all of them).
 */
async function encodeBitmapToPng(bitmap: LayerBitmap): Promise<Uint8Array> {
  const blob = await bitmap.convertToBlob({ type: 'image/png' });
  return new Uint8Array(await blob.arrayBuffer());
}

async function decodePngToBitmap(bytes: Uint8Array, width: number, height: number): Promise<LayerBitmap> {
  assertPngBytesMatchDimensions(bytes, width, height);
  const blob = new Blob([bytes as BlobPart], { type: 'image/png' });
  const image = await createImageBitmap(blob);
  try {
    if (image.width !== width || image.height !== height) {
      throw new Error('.slimg PNG decoded dimensions do not match its integrity proof.');
    }
    const canvas = createBitmap(width, height);
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    return canvas;
  } finally {
    image.close?.();
  }
}

export const slimgPixelCodec: SlimgCodec = {
  encode: encodeBitmapToPng,
  decode: decodePngToBitmap,
};

/** Serialize the active Image document to `.slimg` container bytes (ready to write to a file). */
export function saveImageDocumentAsSlimg(doc: ImageDocument): Promise<Uint8Array> {
  return serializeSlimgV2(doc, slimgPixelCodec);
}

/** Parse `.slimg` container bytes back into a layered ImageDocument. */
export function openSlimgDocument(bytes: Uint8Array): Promise<ImageDocument> {
  return deserializeSlimgAnyVersion(bytes, slimgPixelCodec);
}

/** Explicit flattened export for applications that only understand `.slimg` v1. */
export function saveImageDocumentAsSlimgV1Compatibility(
  doc: ImageDocument,
): Promise<SerializedSlimgV1Compatibility> {
  return serializeSlimgV1Compatibility(doc, slimgPixelCodec);
}
