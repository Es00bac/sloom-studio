import type {
  PaperCrossReference,
  PaperDocument,
  PaperFrame,
  PaperIndexMarker,
  PaperPublicationReferences,
  PaperRichParagraph,
  PaperTableOfContentsEntry,
} from '../types/paper';

export const PAPER_PUBLICATION_REFERENCE_LIMITS = {
  maxTocEntries: 256,
  maxIndexMarkers: 1_024,
  maxCrossReferences: 512,
  maxIdLength: 96,
  maxLabelLength: 256,
  maxTermLength: 128,
  maxTextOffset: 1_000_000,
} as const;

export interface PaperResolvedTocEntry extends PaperTableOfContentsEntry {
  pageNumber?: number;
  missing: boolean;
}

export interface PaperResolvedIndexEntry {
  term: string;
  pageNumbers: number[];
  markerIds: string[];
  missingMarkerIds: string[];
}

export interface PaperResolvedCrossReference extends PaperCrossReference {
  pageNumber?: number;
  missing: boolean;
}

export interface PaperPublicationReferenceResolution {
  toc: PaperResolvedTocEntry[];
  index: PaperResolvedIndexEntry[];
  crossReferences: PaperResolvedCrossReference[];
  missingTargetIds: string[];
}

export interface PaperPublicationTextResult {
  text: string;
  changed: boolean;
  resolvedIds: string[];
  missingIds: string[];
}

const TOKEN = /\{\{\s*(page|ref)\s*:\s*([a-zA-Z0-9:_-]{1,96})\s*\}\}/gu;

function cleanId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > PAPER_PUBLICATION_REFERENCE_LIMITS.maxIdLength) return undefined;
  const id = value.trim();
  return /^[a-zA-Z0-9:_-]+$/.test(id) ? id : undefined;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/\s+/g, ' ');
  return text && text.length <= maxLength ? text : text.slice(0, maxLength) || undefined;
}

function cleanPageTarget(entry: Record<string, unknown>): { targetPageId: string; targetFrameId?: string } | undefined {
  const targetPageId = cleanId(entry.targetPageId);
  if (!targetPageId) return undefined;
  const targetFrameId = cleanId(entry.targetFrameId);
  return targetFrameId ? { targetPageId, targetFrameId } : { targetPageId };
}

function normalizeTocEntry(value: unknown): PaperTableOfContentsEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id);
  const label = cleanText(raw.label, PAPER_PUBLICATION_REFERENCE_LIMITS.maxLabelLength);
  const target = cleanPageTarget(raw);
  if (!id || !label || !target) return undefined;
  const level = typeof raw.level === 'number' && Number.isFinite(raw.level)
    ? Math.max(0, Math.min(8, Math.floor(raw.level)))
    : undefined;
  return { id, label, ...target, ...(level === undefined ? {} : { level }) };
}

function normalizeIndexMarker(value: unknown): PaperIndexMarker | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id);
  const term = cleanText(raw.term, PAPER_PUBLICATION_REFERENCE_LIMITS.maxTermLength);
  const target = cleanPageTarget(raw);
  if (!id || !term || !target) return undefined;
  const textOffset = typeof raw.textOffset === 'number' && Number.isFinite(raw.textOffset)
    ? Math.max(0, Math.min(PAPER_PUBLICATION_REFERENCE_LIMITS.maxTextOffset, Math.floor(raw.textOffset)))
    : undefined;
  return { id, term, ...target, ...(textOffset === undefined ? {} : { textOffset }) };
}

function normalizeCrossReference(value: unknown): PaperCrossReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = cleanId(raw.id);
  const label = cleanText(raw.label, PAPER_PUBLICATION_REFERENCE_LIMITS.maxLabelLength);
  const target = cleanPageTarget(raw);
  return id && label && target ? { id, label, ...target } : undefined;
}

/** Sanitize persisted publication references and enforce deterministic collection bounds. */
export function normalizePaperPublicationReferences(value: unknown): PaperPublicationReferences | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const tocEntries: PaperTableOfContentsEntry[] = [];
  const indexMarkers: PaperIndexMarker[] = [];
  const crossReferences: PaperCrossReference[] = [];
  const ids = new Set<string>();
  const add = <T extends { id: string }>(target: T[], entry: T | undefined, limit: number) => {
    if (!entry || target.length >= limit || ids.has(entry.id)) return;
    ids.add(entry.id);
    target.push(entry);
  };
  for (const entry of Array.isArray(raw.tocEntries) ? raw.tocEntries : []) add(tocEntries, normalizeTocEntry(entry), PAPER_PUBLICATION_REFERENCE_LIMITS.maxTocEntries);
  for (const entry of Array.isArray(raw.indexMarkers) ? raw.indexMarkers : []) add(indexMarkers, normalizeIndexMarker(entry), PAPER_PUBLICATION_REFERENCE_LIMITS.maxIndexMarkers);
  for (const entry of Array.isArray(raw.crossReferences) ? raw.crossReferences : []) add(crossReferences, normalizeCrossReference(entry), PAPER_PUBLICATION_REFERENCE_LIMITS.maxCrossReferences);
  return { version: 1, tocEntries, indexMarkers, crossReferences };
}

function pagesById(document: PaperDocument): Map<string, number> {
  return new Map(document.pages.map((page, index) => [page.id, Number.isFinite(page.pageNumber) ? page.pageNumber : index + 1]));
}

/** Resolve authored targets to current page numbers without changing document state. */
export function resolvePaperPublicationReferences(document: PaperDocument): PaperPublicationReferenceResolution {
  const references = document.publicationReferences ?? { version: 1, tocEntries: [], indexMarkers: [], crossReferences: [] };
  const pageNumbers = pagesById(document);
  const toc = references.tocEntries.map((entry) => ({ ...entry, pageNumber: pageNumbers.get(entry.targetPageId), missing: !pageNumbers.has(entry.targetPageId) }));
  const crossReferences = references.crossReferences.map((entry) => ({ ...entry, pageNumber: pageNumbers.get(entry.targetPageId), missing: !pageNumbers.has(entry.targetPageId) }));
  const grouped = new Map<string, PaperResolvedIndexEntry>();
  for (const marker of references.indexMarkers) {
    const existing = grouped.get(marker.term.toLocaleLowerCase()) ?? { term: marker.term, pageNumbers: [], markerIds: [], missingMarkerIds: [] };
    existing.markerIds.push(marker.id);
    const pageNumber = pageNumbers.get(marker.targetPageId);
    if (pageNumber === undefined) existing.missingMarkerIds.push(marker.id);
    else if (!existing.pageNumbers.includes(pageNumber)) existing.pageNumbers.push(pageNumber);
    existing.pageNumbers.sort((left, right) => left - right);
    grouped.set(marker.term.toLocaleLowerCase(), existing);
  }
  const index = [...grouped.values()].sort((left, right) => left.term.localeCompare(right.term));
  const missingTargetIds = [
    ...toc.filter((entry) => entry.missing).map((entry) => entry.id),
    ...crossReferences.filter((entry) => entry.missing).map((entry) => entry.id),
    ...index.flatMap((entry) => entry.missingMarkerIds),
  ];
  return { toc, index, crossReferences, missingTargetIds };
}

/** Replace only known `{{page:id}}` and `{{ref:id}}` tokens; missing targets remain visible and reported. */
export function resolvePaperPublicationText(text: string, document: PaperDocument): PaperPublicationTextResult {
  const resolution = resolvePaperPublicationReferences(document);
  const pages = new Map(resolution.toc.map((entry) => [entry.id, entry.pageNumber]));
  const refs = new Map(resolution.crossReferences.map((entry) => [entry.id, entry]));
  const resolvedIds: string[] = [];
  const missingIds: string[] = [];
  const output = text.replace(TOKEN, (token, kind: 'page' | 'ref', id: string) => {
    if (kind === 'page') {
      const page = pages.get(id);
      if (page === undefined) {
        if (!missingIds.includes(id)) missingIds.push(id);
        return token;
      }
      if (!resolvedIds.includes(id)) resolvedIds.push(id);
      return String(page);
    }
    const reference = refs.get(id);
    if (!reference || reference.pageNumber === undefined) {
      if (!missingIds.includes(id)) missingIds.push(id);
      return token;
    }
    if (!resolvedIds.includes(id)) resolvedIds.push(id);
    return `${reference.label} (p. ${reference.pageNumber})`;
  });
  return { text: output, changed: output !== text, resolvedIds, missingIds };
}

function resolveFrame(frame: PaperFrame, document: PaperDocument): PaperFrame {
  const text = frame.text === undefined ? undefined : resolvePaperPublicationText(frame.text, document).text;
  const richText = frame.richText?.map((paragraph: PaperRichParagraph) => ({
    ...paragraph,
    runs: paragraph.runs.map((run) => ({ ...run, text: resolvePaperPublicationText(run.text, document).text })),
    ...(paragraph.listMarker === undefined ? {} : { listMarker: resolvePaperPublicationText(paragraph.listMarker, document).text }),
  }));
  return {
    ...frame,
    ...(richText ? { richText, text: richText.flatMap((paragraph) => paragraph.runs.map((run) => run.text)).join('\n') } : text === undefined ? {} : { text }),
  };
}

/** Resolve text on the same frame list used by both canvas and print output. */
export function resolvePaperPublicationFrames(frames: PaperFrame[], document: PaperDocument): PaperFrame[] {
  return frames.map((frame) => resolveFrame(frame, document));
}

export function createPaperPageReferenceToken(id: string): string | undefined {
  const clean = cleanId(id);
  return clean ? `{{page:${clean}}}` : undefined;
}

export function createPaperCrossReferenceToken(id: string): string | undefined {
  const clean = cleanId(id);
  return clean ? `{{ref:${clean}}}` : undefined;
}
