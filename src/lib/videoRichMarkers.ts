/** Bounded, media-free marker authoring and exchange for professional Video timelines. */

import {
  MAX_TIMELINE_MARKERS,
  MAX_TIMELINE_MARKER_SECONDS,
  type TimelineMarker,
} from './editorTimelineMarkers';

export const VIDEO_RICH_MARKERS_VERSION = 1 as const;
export const MAX_VIDEO_RICH_MARKERS = MAX_TIMELINE_MARKERS;
export const MAX_VIDEO_RICH_MARKER_TIME_MS = MAX_TIMELINE_MARKER_SECONDS * 1_000;
export const MAX_VIDEO_MARKER_IMPORT_CHARACTERS = 16 * 1024 * 1024;
export const MAX_VIDEO_MARKER_IMPORT_BYTES = 16 * 1024 * 1024;
export const MAX_VIDEO_RICH_MARKER_ID_CHARACTERS = 128;
export const MAX_VIDEO_RICH_SEQUENCE_ID_CHARACTERS = 128;
export const VIDEO_RICH_MARKER_LEGACY_INTEGRATION_BOUNDARY =
  'Callers must pass legacy marker kinds through unchanged; pre-normalizing review/export to comment loses project truth.' as const;

/** Exact superset of the legacy TimelineMarker kinds; conversion must never collapse these. */
export type VideoRichMarkerKind = 'comment' | 'chapter' | 'review' | 'sync' | 'export' | 'edit' | 'qc';

export type VideoRichMarkerTarget =
  | { kind: 'point'; timeMs: number }
  | { kind: 'range'; startMs: number; endMs: number }
  | { kind: 'clip'; clipId: string; timeMs: number; offsetMs?: number };

export interface VideoRichMarker {
  id: string;
  name: string;
  notes: string;
  kind: VideoRichMarkerKind;
  color: string;
  target: VideoRichMarkerTarget;
  createdAt: number;
  updatedAt: number;
}

export interface VideoRichMarkerDocument {
  version: typeof VIDEO_RICH_MARKERS_VERSION;
  sequenceId: string;
  markers: VideoRichMarker[];
}

export interface VideoRichMarkerImportResult {
  markers: VideoRichMarker[];
  droppedRows: number;
  truncatedRows: number;
  truncated: boolean;
}

export interface VideoRichMarkerImportReview {
  requiresConfirmation: boolean;
  issues: string[];
  message: string;
}

export interface VideoRichMarkerImportFile {
  size: number;
  text: () => Promise<string>;
}

export interface VideoRichMarkerNormalizationOptions {
  outOfRangeTime?: 'clamp' | 'reject';
}

const MARKER_KINDS = new Set<VideoRichMarkerKind>(['comment', 'chapter', 'review', 'sync', 'export', 'edit', 'qc']);
const DEFAULT_MARKER_COLOR = '#22d3ee';

export function normalizeVideoRichMarkers(
  value: unknown,
  options: VideoRichMarkerNormalizationOptions = {},
): VideoRichMarkerImportResult {
  const rows = Array.isArray(value) ? value : [];
  const markers: VideoRichMarker[] = [];
  const seen = new Set<string>();
  let droppedRows = 0;
  let truncatedRows = 0;
  for (const row of rows) {
    const marker = normalizeMarker(row, options.outOfRangeTime ?? 'clamp');
    if (!marker || seen.has(marker.id)) {
      droppedRows += 1;
      continue;
    }
    seen.add(marker.id);
    if (markers.length < MAX_VIDEO_RICH_MARKERS) markers.push(marker);
    else truncatedRows += 1;
  }
  return {
    markers: sortVideoRichMarkers(markers),
    droppedRows,
    truncatedRows,
    truncated: truncatedRows > 0,
  };
}

export function upsertVideoRichMarker(
  markers: readonly VideoRichMarker[],
  marker: VideoRichMarker,
): VideoRichMarker[] {
  const normalized = normalizeMarker(marker, 'clamp');
  if (!normalized) throw new Error('The marker is invalid.');
  const existingIndex = markers.findIndex((candidate) => candidate.id === normalized.id);
  if (existingIndex < 0 && markers.length >= MAX_VIDEO_RICH_MARKERS) {
    throw new Error(`A sequence supports at most ${MAX_VIDEO_RICH_MARKERS.toLocaleString('en-US')} markers.`);
  }
  const next = existingIndex < 0
    ? [...markers.map(cloneMarker), normalized]
    : markers.map((candidate, index) => index === existingIndex ? normalized : cloneMarker(candidate));
  return sortVideoRichMarkers(next);
}

export function removeVideoRichMarker(
  markers: readonly VideoRichMarker[],
  markerId: string,
): VideoRichMarker[] {
  return markers.filter((marker) => marker.id !== markerId).map(cloneMarker);
}

export function sortVideoRichMarkers(markers: readonly VideoRichMarker[]): VideoRichMarker[] {
  return markers.map(cloneMarker).sort((left, right) => markerTimeMs(left) - markerTimeMs(right) || left.id.localeCompare(right.id));
}

/** Uses a lower-bound binary search after one deterministic sort. */
export function navigateVideoRichMarkers(
  markers: readonly VideoRichMarker[],
  fromTimeMs: number,
  direction: 'previous' | 'next',
  wrap = false,
): VideoRichMarker | undefined {
  if (markers.length === 0) return undefined;
  const sorted = sortVideoRichMarkers(markers);
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (markerTimeMs(sorted[middle]) <= fromTimeMs) low = middle + 1;
    else high = middle;
  }
  if (direction === 'next') {
    return sorted[low] ? cloneMarker(sorted[low]) : wrap ? cloneMarker(sorted[0]) : undefined;
  }
  const previousIndex = low - 1;
  const strictlyPreviousIndex = previousIndex >= 0 && markerTimeMs(sorted[previousIndex]) === fromTimeMs
    ? previousIndex - 1
    : previousIndex;
  return sorted[strictlyPreviousIndex]
    ? cloneMarker(sorted[strictlyPreviousIndex])
    : wrap ? cloneMarker(sorted[sorted.length - 1]) : undefined;
}

export function exportVideoRichMarkersJson(sequenceId: string, markers: readonly VideoRichMarker[]): string {
  const document: VideoRichMarkerDocument = {
    version: VIDEO_RICH_MARKERS_VERSION,
    sequenceId: requiredText(sequenceId, 'sequenceId'),
    markers: normalizeVideoRichMarkers(markers).markers,
  };
  return JSON.stringify(document, null, 2);
}

export function importVideoRichMarkersJson(data: string): VideoRichMarkerDocument & VideoRichMarkerImportResult {
  ensureBoundedImport(data);
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new Error('The marker package is not valid JSON.');
  }
  if (!isRecord(value)) throw new Error('The marker package must be a JSON object.');
  if (value.version !== VIDEO_RICH_MARKERS_VERSION) {
    throw new Error(`Marker JSON version ${String(value.version ?? 'missing')} is unsupported; expected version ${VIDEO_RICH_MARKERS_VERSION}.`);
  }
  const sequenceId = requiredText(typeof value.sequenceId === 'string' ? value.sequenceId : '', 'sequenceId');
  if (!Array.isArray(value.markers)) {
    throw new Error('Marker JSON markers must be an array.');
  }
  const normalized = normalizeVideoRichMarkers(value.markers, { outOfRangeTime: 'reject' });
  return {
    version: VIDEO_RICH_MARKERS_VERSION,
    sequenceId,
    ...normalized,
  };
}

export function exportVideoRichMarkersCsv(markers: readonly VideoRichMarker[]): string {
  const header = ['id', 'name', 'notes', 'kind', 'color', 'target', 'start_ms', 'end_ms', 'clip_id', 'clip_offset_ms', 'created_at', 'updated_at'];
  const rows = sortVideoRichMarkers(markers).map((marker) => {
    const startMs = markerTimeMs(marker);
    const endMs = marker.target.kind === 'range' ? marker.target.endMs : '';
    const clipId = marker.target.kind === 'clip' ? marker.target.clipId : '';
    const clipOffsetMs = marker.target.kind === 'clip' && marker.target.offsetMs !== undefined ? marker.target.offsetMs : '';
    return [
      safeSpreadsheetText(marker.id),
      safeSpreadsheetText(marker.name),
      safeSpreadsheetText(marker.notes),
      safeSpreadsheetText(marker.kind),
      safeSpreadsheetText(marker.color),
      safeSpreadsheetText(marker.target.kind),
      startMs,
      endMs,
      safeSpreadsheetText(clipId),
      clipOffsetMs,
      marker.createdAt,
      marker.updatedAt,
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

export function importVideoRichMarkersCsv(data: string): VideoRichMarkerImportResult {
  ensureBoundedImport(data);
  const rows = parseCsv(data);
  if (rows.length === 0) throw new Error('Marker CSV must include a header row.');
  const header = rows[0].map((cell) => cell.trim().toLocaleLowerCase());
  const fieldIndex = new Map(header.map((field, index) => [field, index]));
  for (const required of ['id', 'kind', 'target', 'start_ms'] as const) {
    if (!fieldIndex.has(required)) throw new Error(`Marker CSV is missing the ${required} column.`);
  }
  const values = rows.slice(1).map((row) => {
    const cell = (name: string): string => row[fieldIndex.get(name) ?? -1] ?? '';
    const targetKind = restoreSpreadsheetText(cell('target')).trim().toLocaleLowerCase();
    const startText = cell('start_ms').trim();
    const endText = cell('end_ms').trim();
    const offsetText = cell('clip_offset_ms').trim();
    const startMs = startText ? Number(startText) : Number.NaN;
    const endMs = endText ? Number(endText) : Number.NaN;
    // A present-but-unparseable offset fails the row closed rather than being rewritten to zero.
    const target: unknown = targetKind === 'point'
      ? { kind: 'point', timeMs: startMs }
      : targetKind === 'range'
        ? { kind: 'range', startMs, endMs }
        : targetKind === 'clip'
          ? {
            kind: 'clip',
            clipId: restoreSpreadsheetText(cell('clip_id')),
            timeMs: startMs,
            ...(offsetText ? { offsetMs: Number(offsetText) } : {}),
          }
          : undefined;
    return {
      id: restoreSpreadsheetText(cell('id')),
      name: restoreSpreadsheetText(cell('name')),
      notes: restoreSpreadsheetText(cell('notes')),
      kind: restoreSpreadsheetText(cell('kind')),
      color: restoreSpreadsheetText(cell('color')),
      target,
      createdAt: Number(cell('created_at')),
      updatedAt: Number(cell('updated_at')),
    };
  });
  return normalizeVideoRichMarkers(values, { outOfRangeTime: 'reject' });
}

/** Reject an oversized browser File before allocating its text payload. */
export async function readVideoRichMarkerImportFile(file: VideoRichMarkerImportFile): Promise<string> {
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_VIDEO_MARKER_IMPORT_BYTES) {
    throw new Error(`Marker import files must be ${MAX_VIDEO_MARKER_IMPORT_BYTES.toLocaleString('en-US')} bytes or smaller.`);
  }
  return file.text();
}

export function markerTimeMs(marker: VideoRichMarker): number {
  return marker.target.kind === 'range' ? marker.target.startMs : marker.target.timeMs;
}

export function timelineMarkerToVideoRichMarker(marker: TimelineMarker): VideoRichMarker {
  return {
    id: marker.id,
    name: marker.label || 'Marker',
    notes: marker.notes ?? '',
    kind: marker.kind ?? 'comment',
    color: marker.color,
    target: marker.endSeconds !== undefined
      ? { kind: 'range', startMs: Math.round(marker.seconds * 1_000), endMs: Math.round(marker.endSeconds * 1_000) }
      : marker.clipId
        ? marker.clipOffsetMs !== undefined
          ? { kind: 'clip', clipId: marker.clipId, timeMs: Math.round(marker.seconds * 1_000), offsetMs: marker.clipOffsetMs }
          : { kind: 'clip', clipId: marker.clipId, timeMs: Math.round(marker.seconds * 1_000) }
        : { kind: 'point', timeMs: Math.round(marker.seconds * 1_000) },
    createdAt: marker.createdAt ?? 0,
    updatedAt: marker.updatedAt ?? marker.createdAt ?? 0,
  };
}

export function videoRichMarkerToTimelineMarker(marker: VideoRichMarker): TimelineMarker {
  return {
    id: marker.id,
    seconds: markerTimeMs(marker) / 1_000,
    endSeconds: marker.target.kind === 'range' ? marker.target.endMs / 1_000 : undefined,
    label: marker.name,
    color: marker.color,
    kind: marker.kind,
    notes: marker.notes || undefined,
    clipId: marker.target.kind === 'clip' ? marker.target.clipId : undefined,
    clipOffsetMs: marker.target.kind === 'clip' && marker.target.offsetMs !== undefined ? marker.target.offsetMs : undefined,
    createdAt: marker.createdAt,
    updatedAt: marker.updatedAt,
  };
}

export function reviewVideoRichMarkerImport(
  result: VideoRichMarkerImportResult,
  options: { importedSequenceId?: string; expectedSequenceId?: string } = {},
): VideoRichMarkerImportReview {
  const issues: string[] = [];
  const importedSequenceId = options.importedSequenceId?.trim();
  const expectedSequenceId = options.expectedSequenceId?.trim();
  if (importedSequenceId && expectedSequenceId && importedSequenceId !== expectedSequenceId) {
    issues.push(`The package targets sequence "${importedSequenceId}", but the active sequence is "${expectedSequenceId}".`);
  }
  if (result.droppedRows > 0) {
    issues.push(`${result.droppedRows.toLocaleString('en-US')} invalid or duplicate marker row${result.droppedRows === 1 ? ' was' : 's were'} rejected.`);
  }
  if (result.truncatedRows > 0) {
    issues.push(`${result.truncatedRows.toLocaleString('en-US')} marker row${result.truncatedRows === 1 ? ' exceeds' : 's exceed'} the ${MAX_VIDEO_RICH_MARKERS.toLocaleString('en-US')} marker capacity.`);
  }
  return {
    requiresConfirmation: issues.length > 0,
    issues,
    message: issues.length > 0
      ? `${issues.join(' ')} Continue and replace the active sequence marker set with the ${result.markers.length.toLocaleString('en-US')} accepted marker${result.markers.length === 1 ? '' : 's'}?`
      : '',
  };
}

function normalizeMarker(value: unknown, outOfRangeTime: 'clamp' | 'reject'): VideoRichMarker | undefined {
  if (!isRecord(value)) return undefined;
  const id = boundedText(value.id, MAX_VIDEO_RICH_MARKER_ID_CHARACTERS);
  const kind = typeof value.kind === 'string' && MARKER_KINDS.has(value.kind as VideoRichMarkerKind)
    ? value.kind as VideoRichMarkerKind
    : undefined;
  const target = normalizeTarget(value.target, outOfRangeTime);
  if (!id || !kind || !target) return undefined;
  const createdAt = finiteNonNegativeInteger(value.createdAt) ?? 0;
  const updatedAt = finiteNonNegativeInteger(value.updatedAt) ?? createdAt;
  return {
    id,
    name: boundedText(value.name, 240) || 'Marker',
    notes: boundedText(value.notes, 8_000),
    kind,
    color: normalizeColor(value.color),
    target,
    createdAt,
    updatedAt,
  };
}

function normalizeTarget(value: unknown, outOfRangeTime: 'clamp' | 'reject'): VideoRichMarkerTarget | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
  if (value.kind === 'point') {
    const timeMs = normalizeMarkerTimeMs(value.timeMs, outOfRangeTime);
    return timeMs === undefined ? undefined : { kind: 'point', timeMs };
  }
  if (value.kind === 'range') {
    const startMs = normalizeMarkerTimeMs(value.startMs, outOfRangeTime);
    const endMs = normalizeMarkerTimeMs(value.endMs, outOfRangeTime);
    return startMs === undefined || endMs === undefined || endMs <= startMs
      ? undefined
      : { kind: 'range', startMs, endMs };
  }
  if (value.kind === 'clip') {
    const clipId = boundedText(value.clipId, MAX_VIDEO_RICH_MARKER_ID_CHARACTERS);
    const timeMs = normalizeMarkerTimeMs(value.timeMs, outOfRangeTime);
    if (!clipId || timeMs === undefined) return undefined;
    // An absent offset stays absent (legacy clip markers adopt one when their clip is edited);
    // a present-but-invalid or out-of-range offset fails closed instead of being rewritten.
    const offsetProvided = value.offsetMs !== undefined;
    const offsetMs = offsetProvided ? normalizeMarkerTimeMs(value.offsetMs, outOfRangeTime) : undefined;
    if (offsetProvided && offsetMs === undefined) return undefined;
    return offsetMs === undefined ? { kind: 'clip', clipId, timeMs } : { kind: 'clip', clipId, timeMs, offsetMs };
  }
  return undefined;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/u, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('Marker CSV contains an unterminated quoted field.');
  if (field || row.length > 0) {
    row.push(field.replace(/\r$/u, ''));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((cell) => cell.trim()));
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/gu, '""')}"`;
}

function safeSpreadsheetText(value: string): string {
  return value.startsWith("'") || /^[\t\r ]*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function restoreSpreadsheetText(value: string): string {
  return value.startsWith("''") || /^'[\t\r ]*[=+\-@]/u.test(value) ? value.slice(1) : value;
}

function ensureBoundedImport(data: string): void {
  if (data.length > MAX_VIDEO_MARKER_IMPORT_CHARACTERS) {
    throw new Error('Marker import exceeds the 16 MiB text limit.');
  }
}

function cloneMarker(marker: VideoRichMarker): VideoRichMarker {
  return { ...marker, target: { ...marker.target } };
}

function normalizeColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value.trim())
    ? value.trim().toLocaleLowerCase()
    : DEFAULT_MARKER_COLOR;
}

function boundedText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function normalizeMarkerTimeMs(value: unknown, outOfRangeTime: 'clamp' | 'reject'): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (outOfRangeTime === 'reject' && (value < 0 || value > MAX_VIDEO_RICH_MARKER_TIME_MS)) return undefined;
  return Math.round(Math.min(MAX_VIDEO_RICH_MARKER_TIME_MS, Math.max(0, value)));
}

function requiredText(value: string, field: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${field} is required.`);
  if (clean.length > MAX_VIDEO_RICH_SEQUENCE_ID_CHARACTERS) {
    throw new Error(`${field} must be ${MAX_VIDEO_RICH_SEQUENCE_ID_CHARACTERS} characters or fewer.`);
  }
  return clean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
