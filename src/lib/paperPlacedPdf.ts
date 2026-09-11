import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperFrame } from '../types/paper';

/** PDF MIME types commonly emitted by browsers, DAMs, and older Acrobat integrations. */
export const PAPER_PDF_MIME_TYPES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/acrobat',
]);

export interface PaperPlacedPdfClassification {
  isPdf: boolean;
  /** A resolved image MIME must use the ordinary Paper image path, even with a stale PDF label. */
  isImage: boolean;
  /** A linked item that existed when output began but disappeared before the next boundary. */
  sourceItemMissing: boolean;
  /** A confirmed or conservatively PDF-like placement must not reach the image-only flatten path. */
  blocksRasterization: boolean;
  mimeType?: string;
  /** A URL-backed placement can be emitted as a real HTML object in live-print HTML. */
  canEmbedForLivePrint: boolean;
}

export interface PaperPlacedDocumentClassificationOptions {
  /**
   * Definitive media type of the CURRENT Source Library item behind a `sourceBinItemId` link.
   * An in-place source replacement changes the payload without rewriting persisted frame state,
   * so a decisive current-source MIME outranks every persisted frame metadata field.
   */
  resolveSourceItemMimeType?: (sourceBinItemId: string) => string | undefined;
  /** Marks a linked item that disappeared during the current output transaction. */
  isSourceItemMissing?: (sourceBinItemId: string) => boolean;
}

/**
 * Classify only bounded metadata. In particular, never decode a data URL or inspect its payload:
 * the media type is confined to the short header before its first comma.
 */
export function classifyPaperPlacedPdf(
  frame: Pick<PaperFrame, 'kind' | 'label' | 'asset'>,
  options?: PaperPlacedDocumentClassificationOptions,
): PaperPlacedPdfClassification {
  if (frame.kind !== 'document' && frame.kind !== 'image') {
    return { isPdf: false, isImage: false, sourceItemMissing: false, blocksRasterization: false, canEmbedForLivePrint: false };
  }

  const asset = frame.asset;
  const sourceItemMissing = Boolean(
    asset?.sourceBinItemId && options?.isSourceItemMissing?.(asset.sourceBinItemId),
  );
  // The current linked Source Library item is what materialization will actually hand to output
  // work, so its media type outranks everything the frame persisted. Below it, the managed
  // reference is content-addressed and verified before export materialization, and a valid data
  // URL carries the media type of its concrete payload. All of these outrank loose asset metadata
  // and retained format/name hints from an asset that has since been replaced.
  const resolvedMimeType = [
    asset?.sourceBinItemId ? normalizeMimeType(options?.resolveSourceItemMimeType?.(asset.sourceBinItemId)) : undefined,
    normalizeMimeType(asset?.locator?.kind === 'managed' ? asset.locator.ref.mimeType : undefined),
    mimeTypeFromBoundedDataUrl(asset?.locator?.kind === 'external' ? asset.locator.url : undefined),
    normalizeMimeType(asset?.mimeType),
  ].find(isDecisivePlacedAssetMimeType);
  const isImage = isPaperImageMimeType(resolvedMimeType);
  const isPdf = isPaperPdfMimeType(resolvedMimeType)
    || (!resolvedMimeType && (
      normalizeBoundedText(asset?.format) === 'pdf'
      || hasPdfFileLabel(asset?.label)
      || hasPdfFileLabel(frame.label)
    ));

  return {
    isPdf,
    isImage,
    sourceItemMissing,
    blocksRasterization: isPdf || sourceItemMissing,
    mimeType: resolvedMimeType,
    canEmbedForLivePrint: isPdf && isUsableLivePrintPdfUrl(asset?.locator?.kind === 'external' ? asset.locator.url : undefined),
  };
}

/**
 * Definitive media type of a current Source Library item: the bounded header of its concrete
 * data-URL payload first, then its maintained MIME record. Returns undefined when neither is a
 * decisive placed-asset type, so callers fall back to persisted frame metadata conservatively.
 */
export function resolvePaperSourceItemMimeType(
  item: Pick<SourceBinLibraryItem, 'mimeType' | 'assetUrl'> | undefined,
): string | undefined {
  if (!item) return undefined;
  return [
    mimeTypeFromBoundedDataUrl(item.assetUrl),
    normalizeMimeType(item.mimeType),
  ].find(isDecisivePlacedAssetMimeType);
}

/** Current-source MIME lookup over a Source Library snapshot, for the whole-document boundary. */
export function buildPaperPlacedSourceItemMimeTypeLookup(
  sourceItems: readonly Pick<SourceBinLibraryItem, 'id' | 'mimeType' | 'assetUrl'>[],
): (sourceBinItemId: string) => string | undefined {
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  return (sourceBinItemId) => resolvePaperSourceItemMimeType(sourceById.get(sourceBinItemId));
}

export function isPaperPdfMimeType(value: string | undefined): boolean {
  return Boolean(value && PAPER_PDF_MIME_TYPES.has(value));
}

export function isPaperImageMimeType(value: string | undefined): boolean {
  return Boolean(value && value.startsWith('image/'));
}

function isDecisivePlacedAssetMimeType(value: string | undefined): value is string {
  return isPaperPdfMimeType(value) || isPaperImageMimeType(value);
}

function normalizeMimeType(value: string | undefined): string | undefined {
  const normalized = normalizeBoundedText(value);
  if (!normalized) return undefined;
  return normalized.split(';', 1)[0]?.trim() || undefined;
}

function mimeTypeFromBoundedDataUrl(value: string | undefined): string | undefined {
  // RFC 3986 schemes are case-insensitive: `DATA:APPLICATION/PDF,...` names the same resource
  // class as its lowercase form and must not slip past whole-document classification.
  if (typeof value !== 'string' || !/^data:/i.test(value)) return undefined;
  const boundedHeader = value.slice(0, 512);
  const comma = boundedHeader.indexOf(',');
  const header = boundedHeader.slice(5, comma < 0 ? undefined : comma);
  const mimeType = normalizeMimeType(header);
  // An incomplete image data URL remains unusable image input. An explicit PDF claim is still
  // definitive for the capability boundary, however, so stale image metadata cannot route it to
  // HTMLImageElement merely because its comma/payload separator is missing.
  return comma >= 0 || isPaperPdfMimeType(mimeType) ? mimeType : undefined;
}

function isUsableLivePrintPdfUrl(value: string | undefined): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/^data:/i.test(value)) {
    const boundedHeader = value.slice(0, 512);
    return boundedHeader.includes(',') && isPaperPdfMimeType(mimeTypeFromBoundedDataUrl(value));
  }
  // Blob/object URLs have no inspectable header. Their MIME was already resolved from the current
  // asset metadata above; retain them for the browser's compatible <object> path.
  return /^(?:blob:|https?:|file:|signal-loom-asset:)/i.test(value);
}

function hasPdfFileLabel(value: string | undefined): boolean {
  const label = normalizeBoundedText(value);
  return Boolean(label && /\.pdf(?:\s|$)/i.test(label));
}

function normalizeBoundedText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const bounded = value.slice(0, 512).trim().toLowerCase();
  return bounded || undefined;
}
