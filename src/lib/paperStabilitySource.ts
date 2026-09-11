import type { PaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import { resolvePaperFrameAssetUrl } from './paperAssetReferences';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperFrameAsset } from '../types/paper';
import {
  createBinaryAssetRecord,
  verifyBinaryAssetRecord,
  type BinaryAssetRecord,
  type BinaryAssetRef,
} from '../shared/assets/contentAddressedAsset';
import type { PaperStabilityImageMetadata } from './paperStabilityUpscale';

type PaperStabilitySourceItem = Pick<
  SourceBinLibraryItem,
  'id' | 'assetUrl' | 'mimeType' | 'pixelWidth' | 'pixelHeight'
>;

export interface ResolvedPaperStabilitySource {
  source: BinaryAssetRecord;
  sourceDimensions: PaperStabilityImageMetadata;
}

export interface ResolvePaperStabilitySourceInput {
  asset: PaperFrameAsset;
  sourceItem?: PaperStabilitySourceItem;
  repository: PaperAssetRepository;
  fetchImpl?: typeof fetch;
}

function normalizedMimeType(value: string | undefined): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function positivePixelDimension(...candidates: Array<number | undefined>): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return Math.round(candidate);
    }
  }
  return undefined;
}

function sourceDimensions(
  asset: PaperFrameAsset,
  sourceItem: PaperStabilitySourceItem | undefined,
  mimeType: string,
): PaperStabilityImageMetadata {
  const widthPx = positivePixelDimension(asset.pixelWidth, sourceItem?.pixelWidth);
  const heightPx = positivePixelDimension(asset.pixelHeight, sourceItem?.pixelHeight);
  if (!widthPx || !heightPx) {
    throw new Error(`Paper image "${asset.label}" needs known pixel dimensions before Stability upscale.`);
  }
  return { widthPx, heightPx, mimeType };
}

function matchingReferences(left: BinaryAssetRef, right: BinaryAssetRef): boolean {
  return left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength
    && left.fileName === right.fileName;
}

export async function resolvePaperStabilitySource(
  input: ResolvePaperStabilitySourceInput,
): Promise<ResolvedPaperStabilitySource> {
  const { asset, sourceItem, repository } = input;
  if (asset.kind !== 'image') {
    throw new Error('Stability print upscale requires a placed image frame.');
  }

  if (asset.locator?.kind === 'managed') {
    const record = await repository.get(asset.locator.ref.id);
    if (!record) {
      throw new Error(`Paper managed asset ${asset.locator.ref.id} is unavailable.`);
    }
    if (!matchingReferences(record.ref, asset.locator.ref)) {
      throw new Error(`Paper managed asset ${asset.locator.ref.id} does not match its document reference.`);
    }
    if (!(await verifyBinaryAssetRecord(record))) {
      throw new Error(`Paper managed asset ${asset.locator.ref.id} fails content-hash verification.`);
    }
    return {
      source: record,
      sourceDimensions: sourceDimensions(asset, sourceItem, record.ref.mimeType),
    };
  }

  const url = resolvePaperFrameAssetUrl(asset, sourceItem);
  if (!url) {
    throw new Error(`Paper image "${asset.label}" has no readable source bytes for Stability upscale.`);
  }
  const declaredMimeType = normalizedMimeType(asset.mimeType ?? sourceItem?.mimeType);
  const dimensions = sourceDimensions(asset, sourceItem, declaredMimeType || 'application/octet-stream');
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url);
  } catch {
    throw new Error(`Paper image "${asset.label}" could not be read for Stability upscale.`);
  }
  if (!response.ok) {
    throw new Error(`Paper image "${asset.label}" could not be read for Stability upscale (HTTP ${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) {
    throw new Error(`Paper image "${asset.label}" has no source bytes for Stability upscale.`);
  }
  const mimeType = normalizedMimeType(response.headers.get('content-type') ?? undefined)
    || declaredMimeType
    || 'application/octet-stream';
  const source = await createBinaryAssetRecord(bytes, { mimeType });
  return {
    source,
    sourceDimensions: { ...dimensions, mimeType },
  };
}
