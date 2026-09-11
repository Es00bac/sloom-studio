// Deliberate capability boundary for Paper's browser raster paths.  Paper can place a PDF for
// live/print HTML, but this build does not contain a bounded PDF-page renderer (pdf-lib writes
// PDFs; it does not render pages).  Never hand a placed document to HTMLImageElement and hope it
// decodes: every raster target must stop before it starts a page transaction.

import type { PaperDocument, PaperFrame } from '../types/paper';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import { resolvePaperPageFramesForOutput } from './paperDocument';
import {
  buildPaperPlacedSourceItemMimeTypeLookup,
  classifyPaperPlacedPdf,
  type PaperPlacedDocumentClassificationOptions,
  type PaperPlacedPdfClassification,
} from './paperPlacedPdf';

export interface PaperPlacedDocumentRasterizationIssue {
  code: 'paper-placed-document-rasterization-unsupported';
  pageId: string;
  pageNumber: number;
  frameId: string;
  frameLabel: string;
  mimeType?: string;
  /** A conservatively detected PDF is useful context; the current capability boundary blocks PDFs. */
  isPdf: boolean;
  message: string;
}

export type PaperPlacedSourceItem = Pick<SourceBinLibraryItem, 'id' | 'mimeType' | 'assetUrl' | 'createdAt'>;

/**
 * A raster transaction owns one immutable view of every linked Source Library item it may
 * materialize. Calling the guard proves those same item revisions are still current; `sourceItems`
 * is the exact snapshot callers must pass to materialization so validation and bytes cannot drift.
 */
export interface PaperPlacedDocumentRasterizationGuard {
  (): void;
  readonly sourceItems: readonly PaperPlacedSourceItem[];
}

/** Typed, actionable failure shared by PNG/CBZ/KDP/PDF/X and soft-proof raster routes. */
export class PaperPlacedDocumentRasterizationError extends Error {
  readonly code = 'paper-placed-document-rasterization-unsupported' as const;
  readonly issues: readonly PaperPlacedDocumentRasterizationIssue[];

  constructor(issues: readonly PaperPlacedDocumentRasterizationIssue[]) {
    super(formatPlacedDocumentRasterizationIssues(issues));
    this.name = 'PaperPlacedDocumentRasterizationError';
    this.issues = issues;
  }
}

/**
 * Returns every placement that must not be passed through the image-only flatten adapter. Classification
 * is metadata-only and bounded, so this inspection never materializes document bytes.
 */
export function collectPaperPlacedDocumentRasterizationIssues(
  document: PaperDocument,
  pageIds: readonly string[] = document.pages.map((page) => page.id),
  options: PaperPlacedDocumentClassificationOptions = {},
): PaperPlacedDocumentRasterizationIssue[] {
  const requested = validatePaperRasterPageIds(document, pageIds);
  const issues: PaperPlacedDocumentRasterizationIssue[] = [];

  for (const page of document.pages) {
    if (!requested.has(page.id)) continue;
    for (const frame of resolvePaperPageFramesForOutput(document, page)) {
      const classification = classifyPaperPlacedPdf(frame, options);
      if (!classification.blocksRasterization) continue;
      issues.push(createIssue(page.id, page.pageNumber, frame, classification));
    }
  }
  return issues;
}

/** Throws before materialization, fetch, decode, canvas allocation, or a partial multi-page output. */
export function assertPaperDocumentSupportsRasterization(
  document: PaperDocument,
  pageIds?: readonly string[],
  options: PaperPlacedDocumentClassificationOptions = {},
): void {
  // Raster output is transactional. A supplied id proves that the requested page exists, but never
  // narrows the capability pass: a PDF on a later page must block before page one has side effects.
  if (pageIds) validatePaperRasterPageIds(document, pageIds);
  const issues = collectPaperPlacedDocumentRasterizationIssues(document, undefined, options);
  if (issues.length > 0) throw new PaperPlacedDocumentRasterizationError(issues);
}

/**
 * Starts a current-source raster transaction and returns its repeatable compatibility assertion.
 * Only linked items that existed at the start become required, so an unrelated Source Library
 * change cannot cancel the operation and an older dangling link keeps its existing fallback path.
 */
export function createPaperPlacedDocumentRasterizationGuard(
  document: PaperDocument,
  readSourceItems: () => readonly PaperPlacedSourceItem[],
  pageIds?: readonly string[],
): PaperPlacedDocumentRasterizationGuard {
  const linkedSourceIds = collectPaperLinkedSourceItemIds(document);
  const initialSourceItems = Object.freeze(readSourceItems()
    .filter((item) => linkedSourceIds.has(item.id))
    .map(snapshotPaperPlacedSourceItem));
  const initialSourceItemsById = new Map(initialSourceItems.map((item) => [item.id, item]));
  const initiallyAvailableIds = new Set(initialSourceItemsById.keys());

  const assertAgainstSourceItems = (sourceItems: readonly PaperPlacedSourceItem[]): void => {
    const currentSourceItemsById = new Map(sourceItems
      .filter((item) => linkedSourceIds.has(item.id))
      .map((item) => [item.id, item]));
    const currentIds = new Set(currentSourceItemsById.keys());
    assertPaperDocumentSupportsRasterization(document, pageIds, {
      resolveSourceItemMimeType: buildPaperPlacedSourceItemMimeTypeLookup(sourceItems),
      isSourceItemMissing: (sourceBinItemId) => (
        initiallyAvailableIds.has(sourceBinItemId) && !currentIds.has(sourceBinItemId)
      ),
    });

    const changedSourceItemIds = new Set<string>();
    for (const sourceItemId of linkedSourceIds) {
      const initialItem = initialSourceItemsById.get(sourceItemId);
      const currentItem = currentSourceItemsById.get(sourceItemId);
      if ((!initialItem && currentItem)
        || (initialItem && currentItem && !paperPlacedSourceItemRevisionMatches(initialItem, currentItem))) {
        changedSourceItemIds.add(sourceItemId);
      }
    }
    if (changedSourceItemIds.size > 0) {
      throw new PaperPlacedDocumentRasterizationError(
        collectPaperChangedSourceRevisionIssues(document, changedSourceItemIds, currentSourceItemsById),
      );
    }
  };

  assertAgainstSourceItems(initialSourceItems);
  const guard = (() => assertAgainstSourceItems(readSourceItems())) as PaperPlacedDocumentRasterizationGuard;
  Object.defineProperty(guard, 'sourceItems', {
    value: initialSourceItems,
    enumerable: true,
  });
  return guard;
}

/**
 * Identity-only pinned snapshot for non-raster deliverables (print packages). Placed PDFs are
 * legitimate package content, so unlike the raster guard this never asserts rasterizability.
 * `sourceItems` is the frozen full-record snapshot the delivery must consume; calling the guard
 * proves symmetric presence and the exact {id, mimeType, assetUrl, createdAt} revision tuple for
 * every linked id. Unrelated Source Library changes never fail it.
 */
export interface PaperLinkedSourceIdentityGuard<TItem extends PaperPlacedSourceItem = PaperPlacedSourceItem> {
  (): void;
  readonly sourceItems: readonly Readonly<TItem>[];
}

/** Typed, actionable failure for a delivery whose pinned linked sources are no longer current. */
export class PaperLinkedSourceRevisionError extends Error {
  readonly code = 'paper-linked-source-revision-changed' as const;
  readonly changedSourceItemIds: readonly string[];

  constructor(changedSourceItemIds: readonly string[]) {
    const count = changedSourceItemIds.length;
    super(
      `${count} linked Source Library item${count === 1 ? '' : 's'} (${changedSourceItemIds.join(', ')}) `
      + 'changed while this output was being prepared. Retry the export so it delivers one current source revision.',
    );
    this.name = 'PaperLinkedSourceRevisionError';
    this.changedSourceItemIds = changedSourceItemIds;
  }
}

export function createPaperLinkedSourceIdentityGuard<TItem extends PaperPlacedSourceItem>(
  document: PaperDocument,
  readSourceItems: () => readonly TItem[],
): PaperLinkedSourceIdentityGuard<TItem> {
  const linkedSourceIds = collectPaperLinkedSourceItemIds(document);
  const initialItems = Object.freeze(readSourceItems()
    .filter((item) => linkedSourceIds.has(item.id))
    .map((item) => Object.freeze({ ...item })));
  const initialItemsById = new Map<string, Readonly<TItem>>(initialItems.map((item) => [item.id, item]));

  const guard = (() => {
    const currentItemsById = new Map(readSourceItems()
      .filter((item) => linkedSourceIds.has(item.id))
      .map((item) => [item.id, item]));
    const changedSourceItemIds: string[] = [];
    for (const sourceItemId of linkedSourceIds) {
      const initialItem = initialItemsById.get(sourceItemId);
      const currentItem = currentItemsById.get(sourceItemId);
      if (Boolean(initialItem) !== Boolean(currentItem)
        || (initialItem && currentItem && !paperPlacedSourceItemRevisionMatches(initialItem, currentItem))) {
        changedSourceItemIds.push(sourceItemId);
      }
    }
    if (changedSourceItemIds.length > 0) {
      throw new PaperLinkedSourceRevisionError(changedSourceItemIds.sort());
    }
  }) as PaperLinkedSourceIdentityGuard<TItem>;
  Object.defineProperty(guard, 'sourceItems', {
    value: initialItems,
    enumerable: true,
  });
  return guard;
}

export function isPaperPlacedDocumentRasterizationError(value: unknown): value is PaperPlacedDocumentRasterizationError {
  return value instanceof PaperPlacedDocumentRasterizationError
    || (Boolean(value) && typeof value === 'object'
      && (value as { code?: unknown }).code === 'paper-placed-document-rasterization-unsupported');
}

function createIssue(
  pageId: string,
  pageNumber: number,
  frame: PaperFrame,
  classification: PaperPlacedPdfClassification,
): PaperPlacedDocumentRasterizationIssue {
  if (classification.sourceItemMissing) {
    return {
      code: 'paper-placed-document-rasterization-unsupported',
      pageId,
      pageNumber,
      frameId: frame.id,
      frameLabel: frame.asset?.label || frame.label,
      mimeType: classification.mimeType,
      isPdf: classification.isPdf,
      message: `Page ${pageNumber}, frame "${frame.asset?.label || frame.label}" cannot rasterize because its linked Source Library item is no longer available. Restore or relink the source item, or replace the placement with a raster image before raster export.`,
    };
  }
  const livePrintRemediation = classification.canEmbedForLivePrint
    ? 'Print HTML/live print will emit this URL-backed PDF as a real <object>; use that route or replace it with a raster image before raster export.'
    : 'Restore or relink this PDF to a URL-backed asset before live print, or replace it with a raster image before raster export.';
  return {
    code: 'paper-placed-document-rasterization-unsupported',
    pageId,
    pageNumber,
    frameId: frame.id,
    frameLabel: frame.asset?.label || frame.label,
    mimeType: classification.mimeType,
    isPdf: true,
    message: `Page ${pageNumber}, frame "${frame.asset?.label || frame.label}" places a PDF that this browser build cannot rasterize. ${livePrintRemediation}`,
  };
}

function snapshotPaperPlacedSourceItem(item: PaperPlacedSourceItem): PaperPlacedSourceItem {
  return Object.freeze({
    id: item.id,
    mimeType: item.mimeType,
    assetUrl: item.assetUrl,
    createdAt: item.createdAt,
  });
}

function paperPlacedSourceItemRevisionMatches(
  initialItem: PaperPlacedSourceItem,
  currentItem: PaperPlacedSourceItem,
): boolean {
  return initialItem.id === currentItem.id
    && initialItem.mimeType === currentItem.mimeType
    && initialItem.assetUrl === currentItem.assetUrl
    && initialItem.createdAt === currentItem.createdAt;
}

function collectPaperLinkedSourceItemIds(document: PaperDocument): Set<string> {
  const linkedSourceIds = new Set<string>();
  for (const page of document.pages) {
    for (const frame of resolvePaperPageFramesForOutput(document, page)) {
      if (frame.asset?.sourceBinItemId) linkedSourceIds.add(frame.asset.sourceBinItemId);
    }
  }
  return linkedSourceIds;
}

function collectPaperChangedSourceRevisionIssues(
  document: PaperDocument,
  changedSourceItemIds: ReadonlySet<string>,
  currentSourceItemsById: ReadonlyMap<string, PaperPlacedSourceItem>,
): PaperPlacedDocumentRasterizationIssue[] {
  const issues: PaperPlacedDocumentRasterizationIssue[] = [];
  for (const page of document.pages) {
    for (const frame of resolvePaperPageFramesForOutput(document, page)) {
      const sourceItemId = frame.asset?.sourceBinItemId;
      if (!sourceItemId || !changedSourceItemIds.has(sourceItemId)) continue;
      const currentSourceItem = currentSourceItemsById.get(sourceItemId);
      const classification = classifyPaperPlacedPdf(frame, {
        resolveSourceItemMimeType: buildPaperPlacedSourceItemMimeTypeLookup(
          currentSourceItem ? [currentSourceItem] : [],
        ),
      });
      issues.push({
        code: 'paper-placed-document-rasterization-unsupported',
        pageId: page.id,
        pageNumber: page.pageNumber,
        frameId: frame.id,
        frameLabel: frame.asset?.label || frame.label,
        mimeType: classification.mimeType,
        isPdf: classification.isPdf,
        message: `Page ${page.pageNumber}, frame "${frame.asset?.label || frame.label}" cannot rasterize because its linked Source Library item changed while this output was being prepared. Retry the export so it uses one current source revision from materialization through delivery.`,
      });
    }
  }
  return issues;
}

function validatePaperRasterPageIds(document: PaperDocument, pageIds: readonly string[]): Set<string> {
  const knownPageIds = new Set(document.pages.map((page) => page.id));
  for (const pageId of pageIds) {
    if (!knownPageIds.has(pageId)) {
      throw new Error(`Unknown Paper page id "${pageId}" requested for raster export.`);
    }
  }
  return new Set(pageIds);
}

function formatPlacedDocumentRasterizationIssues(issues: readonly PaperPlacedDocumentRasterizationIssue[]): string {
  const summary = issues.slice(0, 3).map((issue) => issue.message).join(' ');
  const more = issues.length > 3
    ? issues.every((issue) => issue.isPdf)
      ? ` ${issues.length - 3} more placed document frame${issues.length === 4 ? '' : 's'} also need a PDF page rasterizer.`
      : ` ${issues.length - 3} more linked placement${issues.length === 4 ? '' : 's'} also changed during this raster output transaction.`
    : '';
  return `${summary}${more}`;
}
