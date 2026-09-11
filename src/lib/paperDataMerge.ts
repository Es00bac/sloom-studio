// Bounded, document-local data merge for Paper. The authored document is a template; every
// preview/batch result is a derived copy and never rewrites the source document.

import type {
  PaperDataMergeColumn,
  PaperDataMergeRecord,
  PaperDataMergeSource,
  PaperDocument,
  PaperFrame,
  PaperRichParagraph,
} from '../types/paper';
import { flattenPaperRichText } from './paperRichText';

export const PAPER_DATA_MERGE_LIMITS = {
  maxColumns: 64,
  maxRecords: 500,
  maxSourceNameLength: 96,
  maxColumnNameLength: 48,
  maxColumnLabelLength: 96,
  maxRecordIdLength: 96,
  maxValueLength: 2_048,
  maxTotalValueLength: 1_048_576,
  maxCsvLength: 4_194_304,
  maxCsvRows: 501,
  maxCsvColumns: 64,
  maxTemplateLength: 131_072,
} as const;

const FIELD_NAME = /^[a-z][a-z0-9_-]*$/;
const MERGE_TOKEN = /\{\{\s*merge\s*:\s*([a-z][a-z0-9_-]*)\s*\}\}/giu;

export interface PaperDataMergePreview {
  document: PaperDocument;
  recordId: string;
  resolvedFields: string[];
  missingFields: string[];
}

export interface PaperDataMergeBatchItem extends PaperDataMergePreview {
  index: number;
}

export type PaperDataMergeBatchResult = {
  items: PaperDataMergeBatchItem[];
};

export type PaperDataMergeCsvResult =
  | { ok: true; source: PaperDataMergeSource }
  | {
    ok: false;
    error:
      | 'empty'
      | 'too-large'
      | 'invalid-quote'
      | 'invalid-header'
      | 'too-many-columns'
      | 'duplicate-column'
      | 'too-many-records'
      | 'ragged-row'
      | 'value-too-long'
      | 'value-budget-exceeded';
  };

export type PaperDataMergeTextResult = {
  text: string;
  changed: boolean;
  fields: string[];
  missingFields: string[];
};

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  let output = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      if (output.length + character.length > maxLength) break;
      output += character;
    }
  }
  return output;
}

export function normalizePaperDataMergeName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > PAPER_DATA_MERGE_LIMITS.maxColumnNameLength) return undefined;
  const name = value.trim().toLowerCase();
  return FIELD_NAME.test(name) ? name : undefined;
}

function cleanSourceName(value: unknown): string {
  return cleanText(value, PAPER_DATA_MERGE_LIMITS.maxSourceNameLength)?.trim() ?? '';
}

function cleanColumnLabel(value: unknown): string | undefined {
  const label = cleanText(value, PAPER_DATA_MERGE_LIMITS.maxColumnLabelLength)?.trim();
  return label || undefined;
}

function cleanRecordId(value: unknown, index: number, used: Set<string>): string {
  const raw = typeof value === 'string'
    ? value.slice(0, PAPER_DATA_MERGE_LIMITS.maxRecordIdLength).trim().replace(/[^a-zA-Z0-9:_-]/g, '')
    : '';
  const base = raw || `record-${index + 1}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}

/** Normalize persisted or imported data, dropping malformed values and enforcing hard bounds. */
export function normalizePaperDataMergeSource(value: unknown): PaperDataMergeSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const rawColumns = Array.isArray(raw.columns) ? raw.columns : [];
  const columns: PaperDataMergeColumn[] = [];
  const names = new Set<string>();
  for (const entry of rawColumns) {
    if (columns.length >= PAPER_DATA_MERGE_LIMITS.maxColumns) break;
    const candidate = typeof entry === 'string' ? { name: entry } : entry && typeof entry === 'object' ? entry as Record<string, unknown> : undefined;
    const name = normalizePaperDataMergeName(candidate?.name);
    if (!name || names.has(name)) continue;
    names.add(name);
    const label = cleanColumnLabel(candidate?.label);
    columns.push(label ? { name, label } : { name });
  }
  const records: PaperDataMergeRecord[] = [];
  const usedIds = new Set<string>();
  let totalValueLength = 0;
  const rawRecords = Array.isArray(raw.records) ? raw.records : [];
  for (let index = 0; index < rawRecords.length && records.length < PAPER_DATA_MERGE_LIMITS.maxRecords; index += 1) {
    const entry = rawRecords[index];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rawRecord = entry as Record<string, unknown>;
    const rawValues = rawRecord.values && typeof rawRecord.values === 'object' && !Array.isArray(rawRecord.values)
      ? rawRecord.values as Record<string, unknown>
      : {};
    const values: Record<string, string> = {};
    for (const column of columns) {
      const cleanValue = cleanText(rawValues[column.name], PAPER_DATA_MERGE_LIMITS.maxValueLength);
      if (cleanValue === undefined) continue;
      if (totalValueLength + cleanValue.length > PAPER_DATA_MERGE_LIMITS.maxTotalValueLength) break;
      values[column.name] = cleanValue;
      totalValueLength += cleanValue.length;
    }
    records.push({ id: cleanRecordId(rawRecord.id, index, usedIds), values });
  }
  // A source with no columns and no records carries no recoverable user intent; treating it as
  // absent lets a saved empty object rehydrate as removable rather than permanent.
  if (!columns.length && !records.length) return undefined;
  return {
    version: 1,
    name: cleanSourceName(raw.name),
    columns,
    records,
  };
}

/** Build the deterministic truncation-proof derived identity for one merged record. */
function paperDataMergeDerivedDocumentId(documentId: string, recordId: string): string {
  const combined = `${documentId}\u0000${recordId}`;
  // Layout budget: 120 + "-merge-" (7) + 48 + "-" + two 8-char digests = exactly 192. Truncation
  // alone can collapse distinct long identities onto one prefix; appending independent 32-bit
  // digests of both full ids keeps distinct records on distinct derived ids.
  return `${documentId.slice(0, 120)}-merge-${recordId.slice(0, 48)}-${
    fnv1a32(combined, 0x811c9dc5)
  }${fnv1a32(combined, 0x9dc5811c)}`;
}

function fnv1a32(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function parseCsvRows(source: string): string[][] | 'invalid-quote' {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let quoteClosed = false;
  let rowHasExplicitQuotedCell = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (quoted) {
        quoted = false;
        quoteClosed = true;
      } else if (quoteClosed || cell.length > 0) {
        return 'invalid-quote';
      } else {
        quoted = true;
        rowHasExplicitQuotedCell = true;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
      quoteClosed = false;
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (quoteClosed || cell.length > 0 || row.length > 0) {
        row.push(cell);
      }
      // Keep multi-cell rows even when every cell is empty: an all-empty data row still describes
      // one recipient. Only genuinely blank separator lines vanish.
      if (row.length > 1 || row.some((value) => value.length > 0) || rowHasExplicitQuotedCell) rows.push(row);
      row = [];
      cell = '';
      quoteClosed = false;
      rowHasExplicitQuotedCell = false;
      if (character === '\r' && source[index + 1] === '\n') index += 1;
    } else if (quoteClosed) {
      return 'invalid-quote';
    } else {
      cell += character;
    }
    if (rows.length > PAPER_DATA_MERGE_LIMITS.maxCsvRows) return rows;
  }
  if (quoted) return 'invalid-quote';
  if (cell.length || row.length || rowHasExplicitQuotedCell) {
    row.push(cell);
    if (row.length > 1 || row.some((value) => value.length > 0) || rowHasExplicitQuotedCell) rows.push(row);
  }
  return rows;
}

/** Parse a bounded RFC-4180-style CSV with its first non-empty row as the field header. */
export function parsePaperDataMergeCsv(csv: string, sourceName = 'CSV data'): PaperDataMergeCsvResult {
  if (!csv.trim()) return { ok: false, error: 'empty' };
  if (csv.length > PAPER_DATA_MERGE_LIMITS.maxCsvLength) return { ok: false, error: 'too-large' };
  const rows = parseCsvRows(csv);
  if (rows === 'invalid-quote') return { ok: false, error: 'invalid-quote' };
  if (!rows.length) return { ok: false, error: 'empty' };
  const headerCells = rows[0];
  if (headerCells.length > PAPER_DATA_MERGE_LIMITS.maxCsvColumns) return { ok: false, error: 'too-many-columns' };
  const headers = headerCells.map((value) => normalizePaperDataMergeName(value));
  if (headers.some((value) => !value)) {
    // Invalid or empty header names are a header problem, not a column-count problem; report the
    // code the message actually describes.
    return { ok: false, error: 'invalid-header' };
  }
  if (new Set(headers).size !== headers.length) return { ok: false, error: 'duplicate-column' };
  const dataRows = rows.slice(1);
  if (dataRows.length > PAPER_DATA_MERGE_LIMITS.maxRecords) return { ok: false, error: 'too-many-records' };
  if (dataRows.some((row) => row.length > headers.length)) return { ok: false, error: 'ragged-row' };
  let totalValueLength = 0;
  for (const row of dataRows) {
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const cleaned = cleanText(row[columnIndex] ?? '', Number.MAX_SAFE_INTEGER) ?? '';
      if (cleaned.length > PAPER_DATA_MERGE_LIMITS.maxValueLength) {
        // One oversized cell would otherwise be silently capped during normalization.
        return { ok: false, error: 'value-too-long' };
      }
      totalValueLength += cleaned.length;
    }
  }
  if (totalValueLength > PAPER_DATA_MERGE_LIMITS.maxTotalValueLength) {
    // Every input inside the declared per-file/record/column/value limits must keep all of its
    // values, so an import that cannot is an explicit failure — never a successful truncation.
    return { ok: false, error: 'value-budget-exceeded' };
  }
  const records = dataRows.map((row, index) => ({
    id: cleanRecordId(row[0], index, new Set()),
    values: Object.fromEntries(headers.map((header, columnIndex) => [
      header!,
      cleanText(row[columnIndex] ?? '', PAPER_DATA_MERGE_LIMITS.maxValueLength) ?? '',
    ])),
  }));
  const source = normalizePaperDataMergeSource({ version: 1, name: sourceName, columns: headers.map((name) => ({ name })), records });
  return source ? { ok: true, source } : { ok: false, error: 'empty' };
}

export function createPaperDataMergeToken(fieldName: string): string | undefined {
  const name = normalizePaperDataMergeName(fieldName);
  return name ? `{{merge:${name}}}` : undefined;
}

export function resolvePaperDataMergeText(source: string, record: PaperDataMergeRecord): PaperDataMergeTextResult {
  if (source.length > PAPER_DATA_MERGE_LIMITS.maxTemplateLength) {
    return { text: source, changed: false, fields: [], missingFields: [] };
  }
  const fields: string[] = [];
  const missingFields: string[] = [];
  const text = source.replace(MERGE_TOKEN, (token, rawName: string) => {
    const name = rawName.toLowerCase();
    if (!fields.includes(name)) fields.push(name);
    const value = Object.prototype.hasOwnProperty.call(record.values, name)
      ? record.values[name]
      : undefined;
    if (value === undefined) {
      if (!missingFields.includes(name)) missingFields.push(name);
      return token;
    }
    return value;
  });
  return { text, changed: text !== source, fields, missingFields };
}

function resolveRichParagraph(paragraph: PaperRichParagraph, record: PaperDataMergeRecord): { paragraph: PaperRichParagraph; fields: string[]; missingFields: string[] } {
  const fields: string[] = [];
  const missingFields: string[] = [];
  const resolve = (value: string) => {
    const result = resolvePaperDataMergeText(value, record);
    for (const field of result.fields) if (!fields.includes(field)) fields.push(field);
    for (const field of result.missingFields) if (!missingFields.includes(field)) missingFields.push(field);
    return result.text;
  };
  const runs = paragraph.runs.map((run) => ({ ...run, text: resolve(run.text) }));
  const listMarker = paragraph.listMarker === undefined ? undefined : resolve(paragraph.listMarker);
  return {
    paragraph: {
      ...paragraph,
      runs,
      ...(listMarker === undefined ? {} : { listMarker }),
    },
    fields,
    missingFields,
  };
}

function resolveFrame(frame: PaperFrame, record: PaperDataMergeRecord): { frame: PaperFrame; fields: string[]; missingFields: string[] } {
  const fields: string[] = [];
  const missingFields: string[] = [];
  const text = frame.text === undefined ? undefined : resolvePaperDataMergeText(frame.text, record);
  if (text) {
    fields.push(...text.fields);
    missingFields.push(...text.missingFields);
  }
  const richText = frame.richText?.map((paragraph) => {
    const resolved = resolveRichParagraph(paragraph, record);
    fields.push(...resolved.fields);
    missingFields.push(...resolved.missingFields);
    return resolved.paragraph;
  });
  const uniqueFields = [...new Set(fields)];
  const uniqueMissing = [...new Set(missingFields)];
  return {
    frame: {
      ...frame,
      ...(text && text.text !== frame.text ? { text: text.text } : {}),
      ...(richText ? { richText, text: flattenPaperRichText(richText) } : {}),
    },
    fields: uniqueFields,
    missingFields: uniqueMissing,
  };
}

/** Return a derived preview for one record while preserving the authored source document. */
export function previewPaperDataMerge(document: PaperDocument, record: PaperDataMergeRecord): PaperDataMergePreview {
  const fields: string[] = [];
  const missingFields: string[] = [];
  const mapFrames = (frames: PaperFrame[]) => frames.map((frame) => {
    const resolved = resolveFrame(frame, record);
    fields.push(...resolved.fields);
    missingFields.push(...resolved.missingFields);
    return resolved.frame;
  });
  const pages = document.pages.map((page) => ({ ...page, frames: mapFrames(page.frames) }));
  const parentPages = document.parentPages.map((page) => ({ ...page, frames: mapFrames(page.frames) }));
  return {
    document: { ...document, pages, parentPages },
    recordId: record.id,
    resolvedFields: [...new Set(fields)],
    missingFields: [...new Set(missingFields)],
  };
}

/** Generate bounded derived documents with stable per-record identities for downstream print/PDF export. */
export function buildPaperDataMergeBatch(document: PaperDocument, source: PaperDataMergeSource): PaperDataMergeBatchResult {
  const normalized = normalizePaperDataMergeSource(source);
  if (!normalized) return { items: [] };
  const items: PaperDataMergeBatchItem[] = [];
  normalized.records.forEach((record, index) => {
    items.push({
      ...derivePaperDataMergeRecordDocument(document, record),
      index,
    });
  });
  return { items };
}

/** Return one record's derived document with the exact identity the batch builder gives it. */
export function derivePaperDataMergeRecordDocument(
  document: PaperDocument,
  record: PaperDataMergeRecord,
): PaperDataMergePreview {
  const preview = previewPaperDataMerge(document, record);
  return {
    ...preview,
    document: {
      ...preview.document,
      id: paperDataMergeDerivedDocumentId(document.id, record.id),
      title: `${document.title} — ${record.id}`.slice(0, 256),
    },
  };
}

/** Serialize derived batch documents as deterministic line-delimited JSON for downstream export. */
export function exportPaperDataMergeJsonl(document: PaperDocument, source: PaperDataMergeSource): string {
  return buildPaperDataMergeBatch(document, source).items.map((item) => JSON.stringify({
    index: item.index,
    recordId: item.recordId,
    resolvedFields: item.resolvedFields,
    missingFields: item.missingFields,
    document: item.document,
  })).join('\n');
}

/** Find merge fields authored in plain or rich Paper text. */
export function collectPaperDataMergeFields(document: PaperDocument): string[] {
  const fields: string[] = [];
  const collect = (value: string | undefined) => {
    if (!value) return;
    for (const match of value.matchAll(MERGE_TOKEN)) {
      const name = match[1].toLowerCase();
      if (!fields.includes(name)) fields.push(name);
    }
  };
  const collectFrames = (frames: PaperFrame[]) => frames.forEach((frame) => {
    collect(frame.text);
    frame.richText?.forEach((paragraph) => {
      collect(paragraph.listMarker);
      paragraph.runs.forEach((run) => collect(run.text));
    });
  });
  document.pages.forEach((page) => collectFrames(page.frames));
  document.parentPages.forEach((page) => collectFrames(page.frames));
  return fields;
}
