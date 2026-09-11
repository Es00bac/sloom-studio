import type {
  ImageDocument,
  ImageLayer,
  PixelBuffer,
} from '../../../types/imageEditor';
import type {
  SlimgV2AssetRecord,
  SlimgV2BitmapAssetRef,
  SlimgV2HighBitLayerPixels,
} from '../../../lib/slimgV2';
import {
  decodePixelBufferPayload,
  decodePixelBufferTransport,
  encodePixelBufferPayload,
  encodePixelBufferTransport,
} from './PixelBuffer';
import { normalizeWorkingDepth } from './ImageHighBitDocument';

/**
 * MH-009 A1 persistence helpers. Shared save/reopen surfaces call these so
 * the high-bit logic lives in the lane's exclusive directory and the shared
 * files keep only small fenced call sites.
 */

export function stripHighBitRuntimePixels(document: ImageDocument): ImageDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => {
      if (!layer.pixels && !layer.pixelsData) return layer;
      return {
        ...layer,
        pixels: undefined,
        pixelsData: layer.pixels
          ? encodePixelBufferTransport(layer.pixels)
          : layer.pixelsData,
      };
    }),
  };
}

export function restoreHighBitRuntimePixels(document: ImageDocument): ImageDocument {
  return {
    ...document,
    layers: document.layers.map((layer) => {
      if (!layer.pixelsData) return layer;
      const pixels = decodePixelBufferTransport(layer.pixelsData);
      return {
        ...layer,
        pixels,
        pixelsVersion: layer.pixelsVersion,
        pixelsData: undefined,
      };
    }),
  };
}

export async function buildHighBitSection(
  document: ImageDocument,
  addAsset: (
    bytes: Uint8Array,
    metadata: Pick<SlimgV2AssetRecord, 'mimeType' | 'role' | 'fileName'>,
    extension: string,
  ) => Promise<SlimgV2AssetRecord>,
): Promise<{ version: 1; bitDepth: 16 | 32; layers: SlimgV2HighBitLayerPixels[]; diverged?: boolean } | undefined> {
  const workingDepth = normalizeWorkingDepth(document.metadata?.bitDepth);
  if (workingDepth !== 16 && workingDepth !== 32) return undefined;
  const isU16 = workingDepth === 16;
  const entries: SlimgV2HighBitLayerPixels[] = [];
  for (const layer of document.layers) {
    if (!layer.pixels) continue;
    const record = await addAsset(
      encodePixelBufferPayload(layer.pixels),
      {
        mimeType: isU16 ? 'application/x-sloom-pixels-u16' : 'application/x-sloom-pixels-f32',
        role: isU16 ? 'layer-pixels-u16' : 'layer-pixels-f32',
      },
      isU16 ? 'pxu16' : 'pxf32',
    );
    entries.push({
      layerId: layer.id,
      pixels: { assetId: record.id, width: layer.pixels.width, height: layer.pixels.height },
      encoding: isU16 ? 'srgb-u16-le' : 'linear-f32-le',
      sourceBitmapVersion: layer.pixelsVersion ?? 0,
    });
  }
  if (entries.length === 0) return undefined;
  return {
    version: 1,
    bitDepth: workingDepth,
    layers: entries,
    diverged: entries.some((entry) => {
      const layer = document.layers.find((candidate) => candidate.id === entry.layerId);
      return Boolean(layer && layer.pixelsVersion !== layer.bitmapVersion);
    }),
  };
}

/** True when the reopened document carries proxy edits newer than its authority. */
export function highBitSectionDiverged(document: { highBit?: { diverged?: boolean } }): boolean {
  return document.highBit?.diverged === true;
}

/** Divergence disclosure appended to metadata.warnings on reopen. */
export const HIGH_BIT_DIVERGENCE_REOPEN_WARNING =
  'This document high-bit pixel authority predates later 8-bit proxy edits; converting back to '
  + '8 bits keeps the visible proxy pixels.';

export interface HighBitLayerRestoreContext {
  records: ReadonlyMap<string, { role: string }>;
  assets: ReadonlyMap<string, Uint8Array>;
  highBitByLayer: ReadonlyMap<string, {
    pixels: SlimgV2BitmapAssetRef;
    encoding: string;
    sourceBitmapVersion: number;
  }>;
  depth: PixelBuffer['depth'];
}

/**
 * Attach one restored layer's high-bit authority inside the generic v2
 * decoder. Throws fail-closed on missing payloads; also binds the restored
 * proxy's bitmapVersion to the authority's source version.
 */
export function applyHighBitLayerRestore(
  base: ImageLayer,
  highBit: { pixels: SlimgV2BitmapAssetRef; encoding: string; sourceBitmapVersion: number },
  context: Pick<HighBitLayerRestoreContext, 'records' | 'assets' | 'depth'>,
): void {
  const record = context.records.get(highBit.pixels.assetId);
  const bytes = context.assets.get(highBit.pixels.assetId);
  if (!record || !bytes) {
    throw new Error(`.slimg missing high-bit pixels ${highBit.pixels.assetId}.`);
  }
  if (!base.bitmap) {
    throw new Error(`.slimg high-bit pixels ${highBit.pixels.assetId} have no owning layer raster.`);
  }
  if (highBit.pixels.width !== base.bitmap.width || highBit.pixels.height !== base.bitmap.height) {
    throw new Error(
      `.slimg high-bit pixel dimensions ${highBit.pixels.width}x${highBit.pixels.height} do not match the owning layer raster ${base.bitmap.width}x${base.bitmap.height}.`,
    );
  }
  base.pixels = decodePixelBufferPayload(bytes, {
    width: highBit.pixels.width,
    height: highBit.pixels.height,
    depth: context.depth,
  });
  base.pixelsVersion = highBit.sourceBitmapVersion;
  base.bitmapVersion = highBit.sourceBitmapVersion;
}
