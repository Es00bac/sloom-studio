import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperDocument } from '../types/paper';
import {
  inferMimeTypeFromFile,
  inferSourceKindFromFile,
} from './mediaFormatRegistry';
import type { PaperPoint } from './paperLayoutTools';

export const PAPER_PAGE_IMPORT_SOURCE_DRAG_TYPE = 'application/x-flow-source-bin-item';
const PAPER_PAGE_IMPORT_ENVELOPE_PREFIX = 'paper-page-imports';
const PAPER_PAGE_IMPORT_SOURCE_PREFIX = 'paper-page-import';
const DEFAULT_IMPORT_OFFSET_MM = 4;

export interface PaperPageImportFileLike {
  name: string;
  type?: string;
  size: number;
  lastModified: number;
}

export interface PaperPageImageImportPlanItem<TFile extends PaperPageImportFileLike = PaperPageImportFileLike> {
  file: TFile;
  label: string;
  kind: 'image';
  mimeType: string;
  sourceKey: string;
  envelopeId: string;
  envelopeLabel: string;
  envelopeIndex: number;
  envelopeCollapsed: boolean;
  placementPoint?: PaperPoint;
}

export interface PaperPageImageImportPlan<TFile extends PaperPageImportFileLike = PaperPageImportFileLike> {
  pageId: string;
  pageNumber: number;
  envelopeId: string;
  envelopeLabel: string;
  items: Array<PaperPageImageImportPlanItem<TFile>>;
}

export function filterPaperPageImageImportFiles<TFile extends PaperPageImportFileLike>(
  files: Iterable<TFile> | ArrayLike<TFile> | null | undefined,
): TFile[] {
  return toArray(files).filter((file) => inferSourceKindFromFile(file.name, file.type) === 'image');
}

export function hasPaperPageImageFileDrag<TFile extends PaperPageImportFileLike>(
  dataTransfer: {
    types?: Iterable<string> | ArrayLike<string>;
    files?: Iterable<TFile> | ArrayLike<TFile>;
  } | null | undefined,
): boolean {
  if (!dataTransfer) {
    return false;
  }

  const types = toArray(dataTransfer.types);
  if (types.includes(PAPER_PAGE_IMPORT_SOURCE_DRAG_TYPE)) {
    return false;
  }

  const rawFiles = toArray(dataTransfer.files);
  if (rawFiles.length) {
    return filterPaperPageImageImportFiles(rawFiles).length > 0;
  }

  return types.includes('Files');
}

export function buildPaperPageImportEnvelopeId(
  document: Pick<PaperDocument, 'id'>,
  pageId: string,
): string {
  return `${PAPER_PAGE_IMPORT_ENVELOPE_PREFIX}:${document.id}:${pageId}`;
}

export function buildPaperPageImportEnvelopeLabel(pageNumber: number): string {
  return `Page ${pageNumber} imports`;
}

export function buildPaperPageImageImportSourceKey(
  document: Pick<PaperDocument, 'id'>,
  pageId: string,
  file: PaperPageImportFileLike,
): string {
  return `${PAPER_PAGE_IMPORT_SOURCE_PREFIX}:${document.id}:${pageId}:${file.name}:${file.size}:${file.lastModified}`;
}

export function buildPaperPageImageImportPlan<TFile extends PaperPageImportFileLike>({
  document,
  existingItems = [],
  files,
  pageId,
  placementOffsetMm = DEFAULT_IMPORT_OFFSET_MM,
  point,
}: {
  document: Pick<PaperDocument, 'id' | 'pages'>;
  existingItems?: readonly Pick<SourceBinLibraryItem, 'envelopeId' | 'envelopeIndex' | 'sourceKey'>[];
  files: Iterable<TFile> | ArrayLike<TFile> | null | undefined;
  pageId: string;
  placementOffsetMm?: number;
  point?: PaperPoint;
}): PaperPageImageImportPlan<TFile> {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    throw new Error('Paper image drop import could not find the target page.');
  }

  const envelopeId = buildPaperPageImportEnvelopeId(document, page.id);
  const envelopeLabel = buildPaperPageImportEnvelopeLabel(page.pageNumber);
  let nextEnvelopeIndex = existingItems.reduce((max, item) => {
    if (item.envelopeId !== envelopeId || typeof item.envelopeIndex !== 'number') {
      return max;
    }
    return Math.max(max, item.envelopeIndex);
  }, -1) + 1;

  const items = filterPaperPageImageImportFiles(files).map((file, index) => {
    const sourceKey = buildPaperPageImageImportSourceKey(document, page.id, file);
    const existingItem = existingItems.find((item) => item.sourceKey === sourceKey);
    const envelopeIndex = typeof existingItem?.envelopeIndex === 'number'
      ? existingItem.envelopeIndex
      : nextEnvelopeIndex++;

    return {
      file,
      label: file.name,
      kind: 'image' as const,
      mimeType: file.type || inferMimeTypeFromFile(file.name, 'image') || 'image/png',
      sourceKey,
      envelopeId,
      envelopeLabel,
      envelopeIndex,
      envelopeCollapsed: false,
      placementPoint: point
        ? {
            xMm: point.xMm + index * placementOffsetMm,
            yMm: point.yMm + index * placementOffsetMm,
          }
        : undefined,
    };
  });

  return {
    pageId: page.id,
    pageNumber: page.pageNumber,
    envelopeId,
    envelopeLabel,
    items,
  };
}

function toArray<T>(value: Iterable<T> | ArrayLike<T> | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (typeof (value as Iterable<T>)[Symbol.iterator] === 'function') {
    return Array.from(value as Iterable<T>);
  }
  return Array.from(value as ArrayLike<T>);
}
