/**
 * Bounded, project-safe metadata for logging feature-length source libraries.
 *
 * This module never reads, copies, or mutates source media. Subclips are durable source ranges
 * only, smart bins are saved predicates, and duplicate results are suggestions for a human to
 * review rather than destructive deduplication decisions.
 */

export const MAX_VIDEO_MEDIA_LOG_ITEMS = 10_000;
export const MAX_VIDEO_SMART_BINS = 100;
export const MAX_VIDEO_SUBCLIPS_PER_ITEM = 500;
export const MAX_VIDEO_TOTAL_SUBCLIPS = 20_000;
export const MAX_VIDEO_LOG_TAGS = 64;
export const MAX_VIDEO_DUPLICATE_SUGGESTIONS = 5_000;

export type VideoMediaLogStatus = 'unreviewed' | 'select' | 'hold' | 'reject' | 'approved';

export interface VideoLoggedSubclip {
  id: string;
  name: string;
  sourceInMs: number;
  sourceOutMs: number;
  notes?: string;
  tags: string[];
}

export interface VideoMediaLogRecord {
  sourceItemId: string;
  fileName?: string;
  sourceFingerprint?: string;
  durationMs?: number;
  scene?: string;
  shot?: string;
  take?: string;
  reel?: string;
  camera?: string;
  recordedOn?: string;
  notes?: string;
  labelColor?: string;
  tags: string[];
  rating: number;
  status: VideoMediaLogStatus;
  subclips: VideoLoggedSubclip[];
}

type VideoSmartBinTextField = 'fileName' | 'scene' | 'shot' | 'take' | 'reel' | 'camera' | 'recordedOn' | 'notes';

export type VideoSmartBinPredicate =
  | { field: VideoSmartBinTextField; operator: 'contains' | 'equals' | 'starts-with'; value: string }
  | { field: 'tag'; operator: 'includes'; value: string }
  | { field: 'rating'; operator: 'at-least' | 'at-most' | 'equals'; value: number }
  | { field: 'status'; operator: 'equals'; value: VideoMediaLogStatus }
  | { field: 'has-subclips'; operator: 'equals'; value: boolean };

export interface VideoSmartBin {
  id: string;
  name: string;
  match: 'all' | 'any';
  predicates: VideoSmartBinPredicate[];
}

export interface VideoMediaLoggingState {
  records: VideoMediaLogRecord[];
  smartBins: VideoSmartBin[];
}

export interface VideoMediaLogBatchPatch {
  scene?: string;
  shot?: string;
  take?: string;
  reel?: string;
  camera?: string;
  recordedOn?: string;
  notes?: string;
  labelColor?: string;
  rating?: number;
  status?: VideoMediaLogStatus;
  addTags?: string[];
  removeTags?: string[];
}

export interface VideoMediaLogBatchResult {
  records: VideoMediaLogRecord[];
  updatedSourceItemIds: string[];
  missingSourceItemIds: string[];
}

export interface VideoDuplicateSuggestion {
  sourceItemIds: [string, string];
  confidence: 'exact' | 'probable';
  reason: 'matching-fingerprint' | 'matching-file-and-duration' | 'matching-slate';
}

const MEDIA_LOG_STATUSES = new Set<VideoMediaLogStatus>(['unreviewed', 'select', 'hold', 'reject', 'approved']);
const TEXT_FIELDS = new Set<VideoSmartBinTextField>(['fileName', 'scene', 'shot', 'take', 'reel', 'camera', 'recordedOn', 'notes']);

export function normalizeVideoMediaLoggingState(value: unknown): VideoMediaLoggingState {
  const input = isRecord(value) ? value : {};
  const records = Array.isArray(input.records)
    ? normalizeMediaLogRecordsBounded(input.records)
    : [];
  const smartBins = Array.isArray(input.smartBins)
    ? input.smartBins.slice(0, MAX_VIDEO_SMART_BINS).map(normalizeSmartBin).filter(isDefined)
    : [];
  return {
    records: dedupeBy(records, (record) => record.sourceItemId),
    smartBins: dedupeBy(smartBins, (bin) => bin.id),
  };
}

export function createVideoMediaLogRecord(
  sourceItemId: string,
  initial: Partial<VideoMediaLogRecord> = {},
): VideoMediaLogRecord {
  const id = requiredText(sourceItemId, 'sourceItemId');
  return normalizeMediaLogRecord({ ...initial, sourceItemId: id }) ?? {
    sourceItemId: id,
    tags: [],
    rating: 0,
    status: 'unreviewed',
    subclips: [],
  };
}

export function createVideoLoggedSubclip(input: {
  id: string;
  name: string;
  sourceInMs: number;
  sourceOutMs: number;
  sourceDurationMs?: number;
  notes?: string;
  tags?: string[];
}): VideoLoggedSubclip {
  const sourceInMs = finiteNonNegativeInteger(input.sourceInMs);
  const durationLimit = optionalFiniteNonNegativeInteger(input.sourceDurationMs);
  const sourceOutMs = durationLimit === undefined
    ? finiteNonNegativeInteger(input.sourceOutMs)
    : Math.min(durationLimit, finiteNonNegativeInteger(input.sourceOutMs));
  if (sourceOutMs <= sourceInMs) throw new Error('A subclip source range must have a positive duration.');
  return {
    id: requiredText(input.id, 'subclip id'),
    name: boundedText(input.name, 160) || 'Subclip',
    sourceInMs,
    sourceOutMs,
    notes: optionalText(input.notes, 4_000),
    tags: normalizeTags(input.tags),
  };
}

export function addVideoLoggedSubclip(
  record: VideoMediaLogRecord,
  subclip: VideoLoggedSubclip,
): VideoMediaLogRecord {
  const normalized = createVideoLoggedSubclip({ ...subclip, sourceDurationMs: record.durationMs });
  const existingIndex = record.subclips.findIndex((candidate) => candidate.id === normalized.id);
  const subclips = existingIndex >= 0
    ? record.subclips.map((candidate, index) => index === existingIndex ? normalized : candidate)
    : [...record.subclips, normalized].slice(0, MAX_VIDEO_SUBCLIPS_PER_ITEM);
  return { ...record, subclips: sortSubclips(subclips) };
}

export function batchPatchVideoMediaLogs(
  records: readonly VideoMediaLogRecord[],
  sourceItemIds: readonly string[],
  patch: VideoMediaLogBatchPatch,
): VideoMediaLogBatchResult {
  const wanted = new Set(sourceItemIds.map((id) => id.trim()).filter(Boolean));
  const found = new Set<string>();
  const removeTags = new Set(normalizeTags(patch.removeTags).map(normalizedText));
  const addTags = normalizeTags(patch.addTags);
  const normalizedPatch = normalizeBatchPatch(patch);
  const nextRecords = records.map((record) => {
    if (!wanted.has(record.sourceItemId)) return cloneRecord(record);
    found.add(record.sourceItemId);
    const retainedTags = record.tags.filter((tag) => !removeTags.has(normalizedText(tag)));
    return normalizeMediaLogRecord({
      ...record,
      ...normalizedPatch,
      tags: normalizeTags([...retainedTags, ...addTags]),
    }) ?? cloneRecord(record);
  });
  const updatedSourceItemIds = [...found].sort();
  const missingSourceItemIds = [...wanted].filter((id) => !found.has(id)).sort();
  return { records: nextRecords, updatedSourceItemIds, missingSourceItemIds };
}

export function matchesVideoSmartBin(record: VideoMediaLogRecord, bin: VideoSmartBin): boolean {
  if (bin.predicates.length === 0) return false;
  const matcher = bin.match === 'all' ? 'every' : 'some';
  return bin.predicates[matcher]((predicate) => matchesPredicate(record, predicate));
}

export function filterVideoMediaLogsBySmartBin(
  records: readonly VideoMediaLogRecord[],
  bin: VideoSmartBin,
): VideoMediaLogRecord[] {
  return records.filter((record) => matchesVideoSmartBin(record, bin)).map(cloneRecord);
}

/**
 * Parse the compact saved-query syntax used by the Video UI. Clauses are joined with `and`, `&&`,
 * commas, or semicolons. Unknown clauses remain useful as notes searches instead of being ignored.
 */
export function parseVideoSmartBinQuery(id: string, name: string, query: string): VideoSmartBin {
  const predicates: VideoSmartBinPredicate[] = [];
  const clauses = query.split(/\s+(?:and|&&)\s+|[,;]/iu).map((clause) => clause.trim()).filter(Boolean).slice(0, 32);
  for (const clause of clauses) {
    const rating = /^rating\s*(>=|<=|=)\s*([0-5])$/iu.exec(clause);
    if (rating) {
      predicates.push({
        field: 'rating',
        operator: rating[1] === '>=' ? 'at-least' : rating[1] === '<=' ? 'at-most' : 'equals',
        value: Number(rating[2]),
      });
      continue;
    }
    const tag = /^tag\s*:\s*(.+)$/iu.exec(clause);
    if (tag) {
      predicates.push({ field: 'tag', operator: 'includes', value: unquoteQueryValue(tag[1]) });
      continue;
    }
    const status = /^status\s*:\s*(unreviewed|select|hold|reject|approved)$/iu.exec(clause);
    if (status) {
      predicates.push({ field: 'status', operator: 'equals', value: status[1].toLocaleLowerCase() as VideoMediaLogStatus });
      continue;
    }
    const subclips = /^has-subclips\s*:\s*(true|false)$/iu.exec(clause);
    if (subclips) {
      predicates.push({ field: 'has-subclips', operator: 'equals', value: subclips[1].toLocaleLowerCase() === 'true' });
      continue;
    }
    const text = /^(fileName|scene|shot|take|reel|camera|recordedOn|notes)\s*(?::|=|~=)\s*(.+)$/iu.exec(clause);
    const textField = text ? normalizeSmartBinTextField(text[1]) : undefined;
    if (text && textField) {
      predicates.push({
        field: textField,
        operator: clause.includes('=') && !clause.includes('~=') ? 'equals' : 'contains',
        value: unquoteQueryValue(text[2]),
      });
      continue;
    }
    predicates.push({ field: 'notes', operator: 'contains', value: unquoteQueryValue(clause) });
  }
  return {
    id: requiredText(id, 'smart bin id'),
    name: boundedText(name, 200) || 'Smart bin',
    match: 'all',
    predicates: predicates.filter((predicate) => typeof predicate.value !== 'string' || predicate.value.length > 0).slice(0, 32),
  };
}

export function suggestVideoMediaDuplicates(
  records: readonly VideoMediaLogRecord[],
  maxSuggestions = MAX_VIDEO_DUPLICATE_SUGGESTIONS,
): VideoDuplicateSuggestion[] {
  const limit = clampInteger(maxSuggestions, 0, MAX_VIDEO_DUPLICATE_SUGGESTIONS);
  const suggestions = new Map<string, VideoDuplicateSuggestion>();
  collectDuplicateGroups(records, (record) => optionalNormalized(record.sourceFingerprint), 'exact', 'matching-fingerprint', suggestions, limit);
  collectDuplicateGroups(
    records,
    (record) => record.fileName && record.durationMs !== undefined
      ? `${normalizedText(record.fileName)}\u0000${record.durationMs}`
      : undefined,
    'probable',
    'matching-file-and-duration',
    suggestions,
    limit,
  );
  collectDuplicateGroups(
    records,
    (record) => record.reel && record.scene && record.shot && record.take
      ? [record.reel, record.scene, record.shot, record.take, record.camera ?? ''].map(normalizedText).join('\u0000')
      : undefined,
    'probable',
    'matching-slate',
    suggestions,
    limit,
  );
  return [...suggestions.values()]
    .sort((left, right) => suggestionSortKey(left).localeCompare(suggestionSortKey(right)))
    .slice(0, limit);
}

function normalizeMediaLogRecord(
  value: unknown,
  remainingSubclips = MAX_VIDEO_SUBCLIPS_PER_ITEM,
): VideoMediaLogRecord | undefined {
  if (!isRecord(value)) return undefined;
  const sourceItemId = optionalText(value.sourceItemId, 300);
  if (!sourceItemId) return undefined;
  const durationMs = optionalFiniteNonNegativeInteger(value.durationMs);
  const subclipLimit = Math.min(MAX_VIDEO_SUBCLIPS_PER_ITEM, Math.max(0, remainingSubclips));
  const subclips = Array.isArray(value.subclips)
    ? value.subclips.slice(0, subclipLimit).map((candidate) => normalizeSubclip(candidate, durationMs)).filter(isDefined)
    : [];
  return {
    sourceItemId,
    fileName: optionalText(value.fileName, 500),
    sourceFingerprint: optionalText(value.sourceFingerprint, 500),
    durationMs,
    scene: optionalText(value.scene, 160),
    shot: optionalText(value.shot, 160),
    take: optionalText(value.take, 160),
    reel: optionalText(value.reel, 160),
    camera: optionalText(value.camera, 160),
    recordedOn: optionalText(value.recordedOn, 80),
    notes: optionalText(value.notes, 4_000),
    labelColor: normalizeColor(value.labelColor),
    tags: normalizeTags(value.tags),
    rating: clampInteger(value.rating, 0, 5),
    status: isMediaLogStatus(value.status) ? value.status : 'unreviewed',
    subclips: sortSubclips(dedupeBy(subclips, (subclip) => subclip.id)),
  };
}

function normalizeMediaLogRecordsBounded(values: readonly unknown[]): VideoMediaLogRecord[] {
  const records: VideoMediaLogRecord[] = [];
  let remainingSubclips = MAX_VIDEO_TOTAL_SUBCLIPS;
  for (const value of values.slice(0, MAX_VIDEO_MEDIA_LOG_ITEMS)) {
    const record = normalizeMediaLogRecord(value, remainingSubclips);
    if (!record) continue;
    records.push(record);
    remainingSubclips -= record.subclips.length;
  }
  return records;
}

function normalizeSubclip(value: unknown, sourceDurationMs?: number): VideoLoggedSubclip | undefined {
  if (!isRecord(value)) return undefined;
  try {
    return createVideoLoggedSubclip({
      id: String(value.id ?? ''),
      name: String(value.name ?? ''),
      sourceInMs: Number(value.sourceInMs),
      sourceOutMs: Number(value.sourceOutMs),
      sourceDurationMs,
      notes: typeof value.notes === 'string' ? value.notes : undefined,
      tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    });
  } catch {
    return undefined;
  }
}

function normalizeSmartBin(value: unknown): VideoSmartBin | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalText(value.id, 200);
  const name = optionalText(value.name, 200);
  if (!id || !name) return undefined;
  const predicates = Array.isArray(value.predicates)
    ? value.predicates.slice(0, 32).map(normalizePredicate).filter(isDefined)
    : [];
  return { id, name, match: value.match === 'any' ? 'any' : 'all', predicates };
}

function normalizePredicate(value: unknown): VideoSmartBinPredicate | undefined {
  if (!isRecord(value) || typeof value.field !== 'string' || typeof value.operator !== 'string') return undefined;
  if (TEXT_FIELDS.has(value.field as VideoSmartBinTextField)) {
    if (!['contains', 'equals', 'starts-with'].includes(value.operator) || typeof value.value !== 'string') return undefined;
    return {
      field: value.field as VideoSmartBinTextField,
      operator: value.operator as 'contains' | 'equals' | 'starts-with',
      value: boundedText(value.value, 300),
    };
  }
  if (value.field === 'tag' && value.operator === 'includes' && typeof value.value === 'string') {
    return { field: 'tag', operator: 'includes', value: boundedText(value.value, 100) };
  }
  if (value.field === 'rating' && ['at-least', 'at-most', 'equals'].includes(value.operator)) {
    return { field: 'rating', operator: value.operator as 'at-least' | 'at-most' | 'equals', value: clampInteger(value.value, 0, 5) };
  }
  if (value.field === 'status' && value.operator === 'equals' && isMediaLogStatus(value.value)) {
    return { field: 'status', operator: 'equals', value: value.value };
  }
  if (value.field === 'has-subclips' && value.operator === 'equals' && typeof value.value === 'boolean') {
    return { field: 'has-subclips', operator: 'equals', value: value.value };
  }
  return undefined;
}

function matchesPredicate(record: VideoMediaLogRecord, predicate: VideoSmartBinPredicate): boolean {
  if (predicate.field === 'rating') {
    if (predicate.operator === 'at-least') return record.rating >= predicate.value;
    if (predicate.operator === 'at-most') return record.rating <= predicate.value;
    return record.rating === predicate.value;
  }
  if (predicate.field === 'status') return record.status === predicate.value;
  if (predicate.field === 'has-subclips') return (record.subclips.length > 0) === predicate.value;
  if (predicate.field === 'tag') return record.tags.some((tag) => normalizedText(tag) === normalizedText(predicate.value));
  const haystack = normalizedText(record[predicate.field] ?? '');
  const needle = normalizedText(predicate.value);
  if (predicate.operator === 'equals') return haystack === needle;
  if (predicate.operator === 'starts-with') return haystack.startsWith(needle);
  return haystack.includes(needle);
}

function normalizeBatchPatch(patch: VideoMediaLogBatchPatch): Omit<VideoMediaLogBatchPatch, 'addTags' | 'removeTags'> {
  return {
    ...(patch.scene !== undefined ? { scene: boundedText(patch.scene, 160) } : {}),
    ...(patch.shot !== undefined ? { shot: boundedText(patch.shot, 160) } : {}),
    ...(patch.take !== undefined ? { take: boundedText(patch.take, 160) } : {}),
    ...(patch.reel !== undefined ? { reel: boundedText(patch.reel, 160) } : {}),
    ...(patch.camera !== undefined ? { camera: boundedText(patch.camera, 160) } : {}),
    ...(patch.recordedOn !== undefined ? { recordedOn: boundedText(patch.recordedOn, 80) } : {}),
    ...(patch.notes !== undefined ? { notes: boundedText(patch.notes, 4_000) } : {}),
    ...(patch.labelColor !== undefined ? { labelColor: normalizeColor(patch.labelColor) } : {}),
    ...(patch.rating !== undefined ? { rating: clampInteger(patch.rating, 0, 5) } : {}),
    ...(patch.status !== undefined && isMediaLogStatus(patch.status) ? { status: patch.status } : {}),
  };
}

function collectDuplicateGroups(
  records: readonly VideoMediaLogRecord[],
  keyOf: (record: VideoMediaLogRecord) => string | undefined,
  confidence: VideoDuplicateSuggestion['confidence'],
  reason: VideoDuplicateSuggestion['reason'],
  suggestions: Map<string, VideoDuplicateSuggestion>,
  limit: number,
): void {
  if (suggestions.size >= limit) return;
  const groups = new Map<string, string[]>();
  for (const record of records.slice(0, MAX_VIDEO_MEDIA_LOG_ITEMS)) {
    const key = keyOf(record);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(record.sourceItemId);
    groups.set(key, group);
  }
  for (const ids of groups.values()) {
    const uniqueIds = [...new Set(ids)].sort();
    if (uniqueIds.length < 2) continue;
    const anchor = uniqueIds[0];
    for (let index = 1; index < uniqueIds.length && suggestions.size < limit; index += 1) {
      const pair: [string, string] = [anchor, uniqueIds[index]];
      const pairKey = pair.join('\u0000');
      if (!suggestions.has(pairKey)) suggestions.set(pairKey, { sourceItemIds: pair, confidence, reason });
    }
  }
}

function cloneRecord(record: VideoMediaLogRecord): VideoMediaLogRecord {
  return { ...record, tags: [...record.tags], subclips: record.subclips.map((subclip) => ({ ...subclip, tags: [...subclip.tags] })) };
}

function sortSubclips(subclips: VideoLoggedSubclip[]): VideoLoggedSubclip[] {
  return [...subclips].sort((left, right) => left.sourceInMs - right.sourceInMs || left.id.localeCompare(right.id));
}

function suggestionSortKey(suggestion: VideoDuplicateSuggestion): string {
  return `${suggestion.sourceItemIds.join('\u0000')}\u0000${suggestion.reason}`;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value.map((tag) => typeof tag === 'string' ? boundedText(tag, 100) : '').filter(Boolean);
  return dedupeBy(tags, normalizedText).slice(0, MAX_VIDEO_LOG_TAGS);
}

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const color = value.trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : undefined;
}

function isMediaLogStatus(value: unknown): value is VideoMediaLogStatus {
  return typeof value === 'string' && MEDIA_LOG_STATUSES.has(value as VideoMediaLogStatus);
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function optionalNormalized(value: string | undefined): string | undefined {
  const normalized = value ? normalizedText(value) : '';
  return normalized || undefined;
}

function requiredText(value: string, field: string): string {
  const normalized = boundedText(value, 300);
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return boundedText(value, maxLength) || undefined;
}

function unquoteQueryValue(value: string): string {
  const normalized = boundedText(value, 300);
  return normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')
    ? normalized.slice(1, -1).trim()
    : normalized;
}

function normalizeSmartBinTextField(value: string): VideoSmartBinTextField | undefined {
  const normalized = value.toLocaleLowerCase();
  const canonical = normalized === 'filename' ? 'fileName' : normalized === 'recordedon' ? 'recordedOn' : normalized;
  return TEXT_FIELDS.has(canonical as VideoSmartBinTextField) ? canonical as VideoSmartBinTextField : undefined;
}

function finiteNonNegativeInteger(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('Source range values must be finite.');
  return Math.max(0, Math.round(number));
}

function optionalFiniteNonNegativeInteger(value: unknown): number | undefined {
  return value === undefined ? undefined : finiteNonNegativeInteger(value);
}

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.max(minimum, Math.min(maximum, number));
}

function dedupeBy<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
