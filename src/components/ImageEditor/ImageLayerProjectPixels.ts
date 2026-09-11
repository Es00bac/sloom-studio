import type { ImageDocumentSnapshot, ImageLayer, LayerBitmap, SelectionMaskSnapshot } from '../../types/imageEditor';
import { bitmapFromUrl, bitmapToPngDataUrl } from './LayerBitmap';
import {
  decodePixelBufferTransport,
  encodePixelBufferTransport,
} from './pixels/PixelBuffer';
import {
  assertImageDocumentSnapshotDecodeBounds,
  buildImageDocumentSnapshotIntegrity,
  markImageDocumentSnapshotVerifiedOwned,
  verifyImageDocumentSnapshotIntegrity,
} from './ImageSnapshots';
import { decodeImageTiltmarkSimulation } from './tiltmark/ImageTiltmarkLayer';
import {
  decodeImageCmykPixelBuffer,
  encodeImageCmykPixelBuffer,
} from './cmyk/ImageCmykDocument';

/**
 * Pixel codec used to move an image layer's live OffscreenCanvas buffers (`bitmap`/`mask`)
 * in and out of the serializable base64 payloads stored in a project file. Injectable so the
 * round-trip wiring can be tested without a real canvas backend.
 */
export interface ImageLayerPixelCodec {
  encode: (bitmap: LayerBitmap) => Promise<string>;
  decode: (dataUrl: string, expected?: { width: number; height: number }) => Promise<LayerBitmap>;
}

export const defaultImageLayerPixelCodec: ImageLayerPixelCodec = {
  encode: bitmapToPngDataUrl,
  decode: bitmapFromUrl,
};

/**
 * Encode a layer's live pixel buffers into serializable base64 PNG payloads
 * and null the live buffers. This is how the active image canvas is persisted into a `.sloom`
 * (and `.slimg`) — previously the bitmaps were stripped to null with no persistence, silently
 * wiping the image on the next open.
 */
export async function encodeImageLayerProjectPixels(
  layer: ImageLayer,
  codec: ImageLayerPixelCodec = defaultImageLayerPixelCodec,
): Promise<ImageLayer> {
  const bitmapData = layer.bitmap ? await codec.encode(layer.bitmap) : undefined;
  const maskData = layer.mask ? await codec.encode(layer.mask) : undefined;
  const tiltmarkBaseBitmapData = layer.tiltmarkBaseBitmap
    ? await codec.encode(layer.tiltmarkBaseBitmap)
    : undefined;
  // MH-009: the high-bit authority rides in its own self-describing bounded
  // payload; the runtime typed array never enters the JSON document.
  const pixelsData = layer.pixels ? encodePixelBufferTransport(layer.pixels) : undefined;
  const cmykPixelsData = layer.cmykPixels ? encodeImageCmykPixelBuffer(layer.cmykPixels) : layer.cmykPixelsData;
  return {
    ...layer,
    bitmap: null,
    mask: null,
    tiltmarkBaseBitmap: null,
    pixels: undefined,
    cmykPixels: undefined,
    bitmapData,
    maskData,
    tiltmarkBaseBitmapData,
    pixelsData,
    cmykPixelsData,
  };
}

/**
 * Rebuild a layer's live `bitmap`/`mask` from its serialized `bitmapData`/`maskData`, then clear
 * the payload fields. Decode failure throws so the caller can keep the existing editable project.
 */
export async function decodeImageLayerProjectPixels(
  layer: ImageLayer,
  codec: ImageLayerPixelCodec = defaultImageLayerPixelCodec,
  expected?: {
    bitmap?: { width: number; height: number };
    mask?: { width: number; height: number };
  },
): Promise<ImageLayer> {
  let bitmap = layer.bitmap;
  let mask = layer.mask;
  let tiltmarkBaseBitmap = layer.tiltmarkBaseBitmap;
  let pixels: ImageLayer['pixels'];
  let cmykPixels: ImageLayer['cmykPixels'];
  const decodedOwned = new Set<LayerBitmap>();
  try {
    if (layer.bitmapData) {
      bitmap = await codec.decode(layer.bitmapData, expected?.bitmap);
      decodedOwned.add(bitmap);
    }
    if (layer.maskData) {
      mask = await codec.decode(layer.maskData, expected?.mask);
      decodedOwned.add(mask);
    }
    if (layer.tiltmarkBaseBitmapData) {
      tiltmarkBaseBitmap = await codec.decode(layer.tiltmarkBaseBitmapData);
      decodedOwned.add(tiltmarkBaseBitmap);
    }
    // MH-009: restore the high-bit authority from its self-describing payload.
    // Malformed payloads throw so the caller keeps the existing editable project.
    pixels = layer.pixelsData ? decodePixelBufferTransport(layer.pixelsData) : undefined;
    if (pixels) {
      const ownerWidth = bitmap?.width ?? expected?.bitmap?.width;
      const ownerHeight = bitmap?.height ?? expected?.bitmap?.height;
      if (!ownerWidth || !ownerHeight) {
        throw new Error('High-bit pixel payload has no owning layer raster dimensions.');
      }
      if (pixels.width !== ownerWidth || pixels.height !== ownerHeight) {
        throw new Error(
          `High-bit pixel payload dimensions ${pixels.width}x${pixels.height} do not match the owning layer raster ${ownerWidth}x${ownerHeight}.`,
        );
      }
    }
    cmykPixels = layer.cmykPixelsData ? decodeImageCmykPixelBuffer(layer.cmykPixelsData) : layer.cmykPixels;
    if (cmykPixels) {
      const ownerWidth = bitmap?.width ?? expected?.bitmap?.width;
      const ownerHeight = bitmap?.height ?? expected?.bitmap?.height;
      if (!ownerWidth || !ownerHeight || cmykPixels.width !== ownerWidth || cmykPixels.height !== ownerHeight) {
        throw new Error('CMYK pixel payload dimensions do not match the owning layer raster.');
      }
    }
    if (layer.metadata?.tiltmark?.role === 'surface' && layer.tiltmarkSimulationData) {
      const stateWidth = bitmap?.width ?? tiltmarkBaseBitmap?.width;
      const stateHeight = bitmap?.height ?? tiltmarkBaseBitmap?.height;
      if (!stateWidth || !stateHeight
        || !decodeImageTiltmarkSimulation(layer.tiltmarkSimulationData, stateWidth, stateHeight)) {
        throw new Error('Image project contains an invalid Tiltmark simulation checkpoint.');
      }
    }
    return {
      ...layer,
      bitmap,
      mask,
      tiltmarkBaseBitmap,
      pixels,
      cmykPixels,
      pixelsVersion: layer.pixelsVersion,
      bitmapData: undefined,
      maskData: undefined,
      tiltmarkBaseBitmapData: undefined,
      pixelsData: undefined,
      cmykPixelsData: undefined,
    };
  } catch (error) {
    for (const decoded of decodedOwned) {
      if (decoded.width !== 0 || decoded.height !== 0) {
        decoded.width = 0;
        decoded.height = 0;
      }
    }
    throw error;
  }
}

function bytesToBase64(bytes: Uint8ClampedArray): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8ClampedArray {
  const binary = atob(value);
  const bytes = new Uint8ClampedArray(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeImageSelectionMaskProjectData(selection: SelectionMaskSnapshot): string {
  return bytesToBase64(selection.data);
}

export function decodeImageSelectionMaskProjectData(
  dataBase64: string,
  width: number,
  height: number,
): SelectionMaskSnapshot {
  const data = base64ToBytes(dataBase64);
  if (width <= 0 || height <= 0 || data.byteLength !== width * height) {
    throw new Error('Image selection mask payload dimensions do not match its byte length.');
  }
  return { width, height, data };
}

function unavailableSnapshot(snapshot: ImageDocumentSnapshot): ImageDocumentSnapshot {
  return {
    ...snapshot,
    layers: snapshot.layers.map((layer) => ({
      ...layer,
      bitmap: null,
      mask: null,
      tiltmarkBaseBitmap: null,
      bitmapData: undefined,
      maskData: undefined,
      tiltmarkBaseBitmapData: undefined,
    })),
    hasSelection: false,
    selectionMask: undefined,
    selectionMaskData: undefined,
    pixelState: 'unavailable',
  };
}

/** Persist a bounded named snapshot through the same lossless PNG layer transport as the live document. */
export async function encodeImageDocumentSnapshotProjectPixels(
  snapshot: ImageDocumentSnapshot,
  codec: ImageLayerPixelCodec = defaultImageLayerPixelCodec,
): Promise<ImageDocumentSnapshot> {
  assertImageDocumentSnapshotDecodeBounds([snapshot], { transport: 'runtime' });
  if (!verifyImageDocumentSnapshotIntegrity(snapshot).complete) {
    return unavailableSnapshot(snapshot);
  }
  const layers = await Promise.all(snapshot.layers.map((layer) => encodeImageLayerProjectPixels(layer, codec)));
  const selectionMaskData = snapshot.selectionMask
    ? encodeImageSelectionMaskProjectData(snapshot.selectionMask)
    : undefined;
  // Recompute after payload production at the persistence boundary. Never copy a caller-supplied
  // digest into a new file without proving the exact canonical runtime bytes again.
  const integrity = buildImageDocumentSnapshotIntegrity(snapshot.layers, snapshot.selectionMask);
  return {
    ...snapshot,
    layers,
    selectionMask: undefined,
    selectionMaskData,
    pixelState: 'complete',
    integrity,
  };
}

/** Decode snapshot pixels and fail it closed unless every manifest-advertised byte is present and exact. */
export async function decodeImageDocumentSnapshotProjectPixels(
  snapshot: ImageDocumentSnapshot,
  codec: ImageLayerPixelCodec = defaultImageLayerPixelCodec,
): Promise<ImageDocumentSnapshot> {
  if (snapshot.pixelState !== 'complete' || !snapshot.integrity || snapshot.integrity.version !== 2) {
    return unavailableSnapshot(snapshot);
  }
  assertImageDocumentSnapshotDecodeBounds([snapshot], { transport: 'project' });
  const decodedLayers: ImageLayer[] = [];
  try {
    const proofById = new Map(snapshot.integrity.layers.map((proof) => [proof.layerId, proof] as const));
    if (proofById.size !== snapshot.layers.length || snapshot.integrity.layers.length !== snapshot.layers.length) {
      throw new Error('Snapshot layer manifest does not match its layer graph.');
    }
    for (const layer of snapshot.layers) {
      const proof = proofById.get(layer.id);
      if (!proof) throw new Error(`Snapshot layer ${layer.id} has no integrity proof.`);
      if (proof.bitmap.present !== Boolean(layer.bitmapData)) {
        throw new Error(`Snapshot layer ${layer.id} bitmap payload presence mismatch.`);
      }
      if (proof.mask.present !== Boolean(layer.maskData)) {
        throw new Error(`Snapshot layer ${layer.id} mask payload presence mismatch.`);
      }
      const decoded = await decodeImageLayerProjectPixels(layer, codec, {
        ...(proof.bitmap.present ? { bitmap: { width: proof.bitmap.width, height: proof.bitmap.height } } : {}),
        ...(proof.mask.present ? { mask: { width: proof.mask.width, height: proof.mask.height } } : {}),
      });
      if (
        (proof.bitmap.present && (!decoded.bitmap || decoded.bitmap.width !== proof.bitmap.width || decoded.bitmap.height !== proof.bitmap.height))
        || (!proof.bitmap.present && decoded.bitmap)
        || (proof.mask.present && (!decoded.mask || decoded.mask.width !== proof.mask.width || decoded.mask.height !== proof.mask.height))
        || (!proof.mask.present && decoded.mask)
      ) {
        throw new Error(`Snapshot layer ${layer.id} decoded dimensions do not match its integrity proof.`);
      }
      decodedLayers.push(decoded);
    }

    const selectionProof = snapshot.integrity.selection;
    if (selectionProof.present !== snapshot.hasSelection || selectionProof.present !== Boolean(snapshot.selectionMaskData)) {
      throw new Error('Snapshot selection payload presence does not match its integrity proof.');
    }
    const selectionMask = selectionProof.present
      ? decodeImageSelectionMaskProjectData(snapshot.selectionMaskData!, selectionProof.width, selectionProof.height)
      : undefined;
    const decoded = {
      ...snapshot,
      layers: decodedLayers,
      selectionMask,
      selectionMaskData: undefined,
      pixelState: 'complete' as const,
    };
    if (!verifyImageDocumentSnapshotIntegrity(decoded).complete) {
      throw new Error('Decoded snapshot does not match its integrity proof.');
    }
    return markImageDocumentSnapshotVerifiedOwned(decoded);
  } catch (error) {
    const unique = new Set<LayerBitmap>();
    for (const layer of decodedLayers) {
      if (layer.bitmap) unique.add(layer.bitmap);
      if (layer.mask) unique.add(layer.mask);
      if (layer.tiltmarkBaseBitmap) unique.add(layer.tiltmarkBaseBitmap);
    }
    for (const bitmap of unique) {
      if (bitmap.width !== 0 || bitmap.height !== 0) {
        bitmap.width = 0;
        bitmap.height = 0;
      }
    }
    throw new Error('Snapshot project pixel content integrity verification failed.', { cause: error });
  }
}
