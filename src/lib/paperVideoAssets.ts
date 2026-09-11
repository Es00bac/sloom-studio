import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperDocument, PaperPage } from '../types/paper';
import {
  buildRasterizedPaperPageSourcePayload,
  getPaperPageExportDimensions,
  imageSourceToDataUrl,
  type FlattenedPaperPageSourcePayload,
  type PaperPageEmbeddedAssetExportOptions,
} from './paperPageFlattenExport';

export interface PaperStoryboardPageDescriptor {
  pageId: string;
  pageNumber: number;
  label: string;
  sourceKey: string;
  envelopeId: string;
  envelopeLabel: string;
  envelopeIndex: number;
}

export interface PaperStoryboardAssetOptions extends Omit<PaperPageEmbeddedAssetExportOptions, 'resolveImageSrc'> {
  resolveImageSrc?: PaperPageEmbeddedAssetExportOptions['resolveImageSrc'];
}

export function buildPaperStoryboardPageDescriptors(
  document: PaperDocument,
  options: PaperStoryboardAssetOptions = {},
): PaperStoryboardPageDescriptor[] {
  const exportOptions = normalizePaperStoryboardAssetOptions(options);
  const envelopeId = buildPaperStoryboardEnvelopeId(document, exportOptions);
  const envelopeLabel = buildPaperStoryboardEnvelopeLabel(document);

  return document.pages.map((page, index) => ({
    pageId: page.id,
    pageNumber: page.pageNumber,
    label: buildPaperStoryboardPageAssetLabel(document, page),
    sourceKey: buildPaperStoryboardSourceKey(document, page.id, exportOptions),
    envelopeId,
    envelopeLabel,
    envelopeIndex: index,
  }));
}

export function buildPaperStoryboardPageAssetLabel(document: Pick<PaperDocument, 'title'>, page: PaperPage): string {
  return `${getPaperStoryboardDocumentTitle(document)} - Storyboard Page ${page.pageNumber}`;
}

export function buildPaperStoryboardSourceKey(
  document: PaperDocument,
  pageId: string,
  options: PaperStoryboardAssetOptions = {},
): string {
  const exportOptions = normalizePaperStoryboardAssetOptions(options);
  const dimensions = getPaperPageExportDimensions(document, exportOptions);
  return `paper-page:${document.id}:${pageId}:${dimensions.widthPx}x${dimensions.heightPx}:${dimensions.includeBleed ? 'bleed' : 'trim'}`;
}

export async function buildPaperStoryboardPageSourcePayload(
  document: PaperDocument,
  pageId: string,
  options: PaperStoryboardAssetOptions = {},
): Promise<FlattenedPaperPageSourcePayload> {
  const exportOptions = normalizePaperStoryboardAssetOptions(options);
  const descriptor = buildPaperStoryboardPageDescriptors(document, exportOptions)
    .find((candidate) => candidate.pageId === pageId);

  if (!descriptor) {
    throw new Error('Paper storyboard export could not find the requested page.');
  }

  const payload = await buildRasterizedPaperPageSourcePayload(document, pageId, {
    ...exportOptions,
    resolveImageSrc: options.resolveImageSrc ?? ((src) => imageSourceToDataUrl(src)),
  });

  return {
    ...payload,
    label: descriptor.label,
    sourceKey: descriptor.sourceKey,
    envelopeId: descriptor.envelopeId,
    envelopeLabel: descriptor.envelopeLabel,
    envelopeIndex: descriptor.envelopeIndex,
  };
}

export async function buildPaperStoryboardPageSourcePayloads(
  document: PaperDocument,
  options: PaperStoryboardAssetOptions = {},
): Promise<FlattenedPaperPageSourcePayload[]> {
  const payloads: FlattenedPaperPageSourcePayload[] = [];

  for (const page of document.pages) {
    payloads.push(await buildPaperStoryboardPageSourcePayload(document, page.id, options));
  }

  return payloads;
}

/**
 * Prepare every raster first, then publish; a failure on any page leaves the caller with zero new
 * assets. `assertBeforePublish` runs after the complete batch exists and before the first Source
 * write, so a caller's pinned linked-source transaction can refuse a stale publication outright.
 */
export async function publishPaperStoryboardPageSourcePayloads<T>(
  document: PaperDocument,
  options: PaperStoryboardAssetOptions,
  publish: (payload: FlattenedPaperPageSourcePayload) => Promise<T>,
  assertBeforePublish?: () => void,
): Promise<T[]> {
  const payloads = await buildPaperStoryboardPageSourcePayloads(document, options);
  assertBeforePublish?.();
  const published: T[] = [];
  for (const payload of payloads) published.push(await publish(payload));
  return published;
}

export function getPaperStoryboardExistingItemIds(
  items: SourceBinLibraryItem[],
  descriptors: PaperStoryboardPageDescriptor[],
): Set<string> {
  const sourceKeys = new Set(descriptors.map((descriptor) => descriptor.sourceKey));
  return new Set(
    items
      .filter((item) => item.sourceKey && sourceKeys.has(item.sourceKey))
      .map((item) => item.id),
  );
}

function buildPaperStoryboardEnvelopeId(
  document: PaperDocument,
  options: PaperStoryboardAssetOptions,
): string {
  const dimensions = getPaperPageExportDimensions(document, options);
  return `paper-storyboard:${document.id}:${dimensions.widthPx}x${dimensions.heightPx}:${dimensions.includeBleed ? 'bleed' : 'trim'}`;
}

function buildPaperStoryboardEnvelopeLabel(document: Pick<PaperDocument, 'title'>): string {
  return `${getPaperStoryboardDocumentTitle(document)} storyboard pages`;
}

function getPaperStoryboardDocumentTitle(document: Pick<PaperDocument, 'title'>): string {
  const title = document.title.trim();
  return title || 'Paper Layout';
}

function normalizePaperStoryboardAssetOptions(
  options: PaperStoryboardAssetOptions,
): PaperStoryboardAssetOptions {
  return {
    ...options,
    includeBleed: options.includeBleed ?? false,
  };
}
