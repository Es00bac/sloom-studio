import type { VideoMediaLogRecord } from './videoMediaLogging';
import type { VideoRichMarker } from './videoRichMarkers';
import { markerTimeMs } from './videoRichMarkers';

/** Incremental, revision-sharded metadata index. No media bytes or decoded frames are indexed. */
export const VIDEO_TIMELINE_SEARCH_INDEX_VERSION = 1 as const;
export const MAX_VIDEO_TIMELINE_SEARCH_RESULTS = 500;
export const MAX_VIDEO_TIMELINE_SEARCH_SHARDS = 256;
export const MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS = 500_000;
export const MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS_PER_SHARD = 100_000;
export const MAX_VIDEO_TIMELINE_SEARCH_CONSTRUCTION_DOCUMENTS = 100_000;
export const VIDEO_TIMELINE_SEARCH_INTEGRATION_BOUNDARY =
  'Callers should use the construction report and avoid allocating unbounded source projections before this module.' as const;

export type VideoTimelineSearchEntityKind = 'clip' | 'media-log' | 'caption' | 'transcript' | 'marker';
export type VideoTimelineSearchOnlineState = 'online' | 'offline' | 'stale';
export type VideoTimelineSearchProxyState = 'none' | 'queued' | 'building' | 'ready' | 'failed';

export interface VideoTimelineSearchDocument {
  id: string;
  entityKind: VideoTimelineSearchEntityKind;
  label: string;
  text?: string;
  sequenceId?: string;
  sourceItemId?: string;
  clipId?: string;
  startMs?: number;
  endMs?: number;
  trackId?: string;
  tags?: string[];
  effectNames?: string[];
  onlineState?: VideoTimelineSearchOnlineState;
  proxyState?: VideoTimelineSearchProxyState;
}

export interface VideoTimelineSearchShardInput {
  shardId: string;
  revision: string;
  documents: readonly VideoTimelineSearchDocument[];
}

export interface VideoTimelineSearchIndexedDocument extends VideoTimelineSearchDocument {
  normalizedText: string;
}

export interface VideoTimelineSearchShard {
  shardId: string;
  revision: string;
  documents: Record<string, VideoTimelineSearchIndexedDocument>;
  orderedDocumentIds: string[];
  postings: Record<string, string[]>;
}

export interface VideoTimelineSearchIndex {
  version: typeof VIDEO_TIMELINE_SEARCH_INDEX_VERSION;
  shards: Record<string, VideoTimelineSearchShard>;
  documentCount: number;
  totalDroppedDocuments: number;
  lastUpdateReport?: VideoTimelineSearchUpdateReport;
}

export type VideoTimelineSearchTruncationReason =
  | 'construction-limit'
  | 'shard-limit'
  | 'shard-document-limit'
  | 'index-document-limit'
  | 'invalid-or-duplicate-document';

export interface VideoTimelineSearchUpdateReport {
  shardId: string;
  revision: string;
  inputDocumentCount: number;
  indexedDocumentCount: number;
  droppedDocumentCount: number;
  truncated: boolean;
  reasons: VideoTimelineSearchTruncationReason[];
}

export interface VideoTimelineSearchConstructionReport {
  inputDocumentCount: number;
  constructedDocumentCount: number;
  droppedDocumentCount: number;
  truncated: boolean;
  droppedByEntityKind: Partial<Record<VideoTimelineSearchEntityKind, number>>;
  reasons: VideoTimelineSearchTruncationReason[];
}

export interface VideoTimelineSearchConstructionResult {
  documents: VideoTimelineSearchDocument[];
  report: VideoTimelineSearchConstructionReport;
}

export interface VideoTimelineSearchQuery {
  text?: string;
  entityKinds?: readonly VideoTimelineSearchEntityKind[];
  sequenceId?: string;
  trackIds?: readonly string[];
  onlineStates?: readonly VideoTimelineSearchOnlineState[];
  proxyStates?: readonly VideoTimelineSearchProxyState[];
  effectNames?: readonly string[];
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

export interface VideoTimelineSearchResult {
  document: VideoTimelineSearchDocument;
  score: number;
  matchedFields: Array<'label' | 'text' | 'tags' | 'effects' | 'online' | 'proxy'>;
}

export interface VideoSearchClipSource {
  id: string;
  label: string;
  sequenceId: string;
  sourceItemId: string;
  trackId: string;
  startMs: number;
  endMs: number;
  notes?: string;
  tags?: string[];
  effectNames?: string[];
  onlineState?: VideoTimelineSearchOnlineState;
  proxyState?: VideoTimelineSearchProxyState;
}

export interface VideoSearchCaptionSource {
  id: string;
  trackId: string;
  sequenceId: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  language?: string;
}

export interface VideoSearchTranscriptSource {
  id: string;
  sourceItemId: string;
  text: string;
  startMs?: number;
  endMs?: number;
  speaker?: string;
  language?: string;
}

export function createVideoTimelineSearchIndex(): VideoTimelineSearchIndex {
  return {
    version: VIDEO_TIMELINE_SEARCH_INDEX_VERSION,
    shards: {},
    documentCount: 0,
    totalDroppedDocuments: 0,
  };
}

/** Returns the same object when a shard revision is already current. */
export function updateVideoTimelineSearchShard(
  index: VideoTimelineSearchIndex,
  input: VideoTimelineSearchShardInput,
): VideoTimelineSearchIndex {
  const shardId = requiredText(input.shardId, 'shardId');
  const revision = requiredText(input.revision, 'revision');
  const current = index.shards[shardId];
  if (current?.revision === revision) return index;
  if (!current && Object.keys(index.shards).length >= MAX_VIDEO_TIMELINE_SEARCH_SHARDS) {
    const report: VideoTimelineSearchUpdateReport = {
      shardId,
      revision,
      inputDocumentCount: input.documents.length,
      indexedDocumentCount: 0,
      droppedDocumentCount: input.documents.length,
      truncated: input.documents.length > 0,
      reasons: ['shard-limit'],
    };
    return {
      ...index,
      totalDroppedDocuments: index.totalDroppedDocuments + report.droppedDocumentCount,
      lastUpdateReport: report,
    };
  }
  const existingOtherDocumentCount = index.documentCount - (current?.orderedDocumentIds.length ?? 0);
  const availableIndexSlots = Math.max(0, MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS - existingOtherDocumentCount);
  const acceptedInputCount = Math.min(
    input.documents.length,
    MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS_PER_SHARD,
    availableIndexSlots,
  );
  const shard = buildShard(shardId, revision, input.documents.slice(0, acceptedInputCount));
  const documentCount = existingOtherDocumentCount + shard.orderedDocumentIds.length;
  const reasons = new Set<VideoTimelineSearchTruncationReason>();
  if (input.documents.length > MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS_PER_SHARD) reasons.add('shard-document-limit');
  if (input.documents.length > availableIndexSlots) reasons.add('index-document-limit');
  if (shard.orderedDocumentIds.length < acceptedInputCount) reasons.add('invalid-or-duplicate-document');
  const droppedDocumentCount = input.documents.length - shard.orderedDocumentIds.length;
  const report: VideoTimelineSearchUpdateReport = {
    shardId,
    revision,
    inputDocumentCount: input.documents.length,
    indexedDocumentCount: shard.orderedDocumentIds.length,
    droppedDocumentCount,
    truncated: droppedDocumentCount > 0,
    reasons: [...reasons],
  };
  return {
    version: VIDEO_TIMELINE_SEARCH_INDEX_VERSION,
    shards: { ...index.shards, [shardId]: shard },
    documentCount,
    totalDroppedDocuments: index.totalDroppedDocuments + droppedDocumentCount,
    lastUpdateReport: report,
  };
}

export function removeVideoTimelineSearchShard(
  index: VideoTimelineSearchIndex,
  shardId: string,
): VideoTimelineSearchIndex {
  const current = index.shards[shardId];
  if (!current) return index;
  const { [shardId]: _removed, ...shards } = index.shards;
  return {
    version: VIDEO_TIMELINE_SEARCH_INDEX_VERSION,
    shards,
    documentCount: index.documentCount - current.orderedDocumentIds.length,
    totalDroppedDocuments: index.totalDroppedDocuments,
    lastUpdateReport: index.lastUpdateReport,
  };
}

export function searchVideoTimelineIndex(
  index: VideoTimelineSearchIndex,
  query: VideoTimelineSearchQuery,
): VideoTimelineSearchResult[] {
  const tokens = tokenize(query.text ?? '').slice(0, 16);
  const limit = Math.max(1, Math.min(MAX_VIDEO_TIMELINE_SEARCH_RESULTS, Math.floor(query.limit ?? MAX_VIDEO_TIMELINE_SEARCH_RESULTS)));
  const results: VideoTimelineSearchResult[] = [];
  const seen = new Set<string>();
  for (const shard of Object.values(index.shards).sort((left, right) => left.shardId.localeCompare(right.shardId))) {
    const candidateIds = candidateDocumentIds(shard, tokens);
    for (const id of candidateIds) {
      const uniqueKey = `${shard.shardId}\u0000${id}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      const document = shard.documents[id];
      if (!document || !matchesFilters(document, query) || !tokens.every((token) => document.normalizedText.includes(token))) continue;
      const matchedFields = getMatchedFields(document, tokens);
      results.push({
        document: clonePublicDocument(document),
        score: scoreDocument(document, tokens, matchedFields),
        matchedFields,
      });
    }
  }
  return results
    .sort((left, right) => right.score - left.score
      || (left.document.startMs ?? Number.POSITIVE_INFINITY) - (right.document.startMs ?? Number.POSITIVE_INFINITY)
      || left.document.label.localeCompare(right.document.label)
      || left.document.id.localeCompare(right.document.id))
    .slice(0, limit);
}

export function buildVideoTimelineSearchDocuments(input: {
  clips?: readonly VideoSearchClipSource[];
  logging?: readonly VideoMediaLogRecord[];
  captions?: readonly VideoSearchCaptionSource[];
  transcripts?: readonly VideoSearchTranscriptSource[];
  markers?: readonly VideoRichMarker[];
  sequenceIdForMarkers?: string;
}): VideoTimelineSearchDocument[] {
  return buildVideoTimelineSearchDocumentsWithReport(input).documents;
}

export function buildVideoTimelineSearchDocumentsWithReport(input: {
  clips?: readonly VideoSearchClipSource[];
  logging?: readonly VideoMediaLogRecord[];
  captions?: readonly VideoSearchCaptionSource[];
  transcripts?: readonly VideoSearchTranscriptSource[];
  markers?: readonly VideoRichMarker[];
  sequenceIdForMarkers?: string;
}): VideoTimelineSearchConstructionResult {
  const documents: VideoTimelineSearchDocument[] = [];
  const droppedByEntityKind: Partial<Record<VideoTimelineSearchEntityKind, number>> = {};
  const append = <T,>(
    entityKind: VideoTimelineSearchEntityKind,
    values: readonly T[],
    project: (value: T) => VideoTimelineSearchDocument,
  ) => {
    const available = Math.max(0, MAX_VIDEO_TIMELINE_SEARCH_CONSTRUCTION_DOCUMENTS - documents.length);
    const accepted = Math.min(available, values.length);
    for (let index = 0; index < accepted; index += 1) documents.push(project(values[index]));
    const dropped = values.length - accepted;
    if (dropped > 0) droppedByEntityKind[entityKind] = (droppedByEntityKind[entityKind] ?? 0) + dropped;
  };

  append('clip', input.clips ?? [], (clip) => ({
      id: `clip:${clip.id}`,
      entityKind: 'clip',
      label: clip.label,
      text: clip.notes,
      sequenceId: clip.sequenceId,
      sourceItemId: clip.sourceItemId,
      clipId: clip.id,
      trackId: clip.trackId,
      startMs: clip.startMs,
      endMs: clip.endMs,
      tags: clip.tags,
      effectNames: clip.effectNames,
      onlineState: clip.onlineState,
      proxyState: clip.proxyState,
    }));
  append('media-log', input.logging ?? [], (record) => ({
      id: `media-log:${record.sourceItemId}`,
      entityKind: 'media-log',
      label: record.fileName || record.sourceItemId,
      text: [record.scene, record.shot, record.take, record.reel, record.camera, record.notes, record.status]
        .filter(Boolean).join(' '),
      sourceItemId: record.sourceItemId,
      tags: record.tags,
    }));
  append('caption', input.captions ?? [], (cue) => ({
      id: `caption:${cue.trackId}:${cue.id}`,
      entityKind: 'caption',
      label: cue.speaker ? `${cue.speaker}: ${cue.text}` : cue.text,
      text: [cue.text, cue.speaker, cue.language].filter(Boolean).join(' '),
      sequenceId: cue.sequenceId,
      trackId: cue.trackId,
      startMs: cue.startMs,
      endMs: cue.endMs,
    }));
  append('transcript', input.transcripts ?? [], (transcript) => ({
      id: `transcript:${transcript.sourceItemId}:${transcript.id}`,
      entityKind: 'transcript',
      label: transcript.speaker ? `${transcript.speaker}: ${transcript.text}` : transcript.text,
      text: [transcript.text, transcript.speaker, transcript.language].filter(Boolean).join(' '),
      sourceItemId: transcript.sourceItemId,
      startMs: transcript.startMs,
      endMs: transcript.endMs,
    }));
  append('marker', input.markers ?? [], (marker) => ({
      id: `marker:${marker.id}`,
      entityKind: 'marker',
      label: marker.name,
      text: [marker.notes, marker.kind, marker.color].filter(Boolean).join(' '),
      sequenceId: input.sequenceIdForMarkers,
      clipId: marker.target.kind === 'clip' ? marker.target.clipId : undefined,
      startMs: markerTimeMs(marker),
      endMs: marker.target.kind === 'range' ? marker.target.endMs : undefined,
      tags: [marker.kind],
    }));
  const inputDocumentCount = (input.clips?.length ?? 0)
    + (input.logging?.length ?? 0)
    + (input.captions?.length ?? 0)
    + (input.transcripts?.length ?? 0)
    + (input.markers?.length ?? 0);
  const droppedDocumentCount = inputDocumentCount - documents.length;
  return {
    documents,
    report: {
      inputDocumentCount,
      constructedDocumentCount: documents.length,
      droppedDocumentCount,
      truncated: droppedDocumentCount > 0,
      droppedByEntityKind,
      reasons: droppedDocumentCount > 0 ? ['construction-limit'] : [],
    },
  };
}

function buildShard(
  shardId: string,
  revision: string,
  source: readonly VideoTimelineSearchDocument[],
): VideoTimelineSearchShard {
  const documents: Record<string, VideoTimelineSearchIndexedDocument> = {};
  const postings: Record<string, string[]> = {};
  for (const raw of source) {
    const document = normalizeDocument(raw);
    if (!document || documents[document.id]) continue;
    documents[document.id] = document;
    for (const token of new Set(tokenize(document.normalizedText).slice(0, 64))) {
      (postings[token] ??= []).push(document.id);
    }
  }
  const orderedDocumentIds = Object.keys(documents).sort((left, right) => {
    const leftDocument = documents[left];
    const rightDocument = documents[right];
    return (leftDocument.startMs ?? Number.POSITIVE_INFINITY) - (rightDocument.startMs ?? Number.POSITIVE_INFINITY)
      || leftDocument.label.localeCompare(rightDocument.label)
      || left.localeCompare(right);
  });
  return { shardId, revision, documents, orderedDocumentIds, postings };
}

function normalizeDocument(value: VideoTimelineSearchDocument): VideoTimelineSearchIndexedDocument | undefined {
  const id = value.id.trim().slice(0, 240);
  const label = value.label.trim().slice(0, 1_000);
  if (!id || !label) return undefined;
  const text = value.text?.trim().slice(0, 32_000);
  const tags = normalizeStrings(value.tags, 64, 120);
  const effectNames = normalizeStrings(value.effectNames, 64, 160);
  const normalizedText = normalizeSearchText([
    label,
    text,
    ...tags,
    ...effectNames,
    value.onlineState,
    value.proxyState,
  ].filter(Boolean).join(' '));
  return {
    ...value,
    id,
    label,
    text,
    tags,
    effectNames,
    startMs: normalizeOptionalTime(value.startMs),
    endMs: normalizeOptionalTime(value.endMs),
    normalizedText,
  };
}

function candidateDocumentIds(shard: VideoTimelineSearchShard, tokens: readonly string[]): readonly string[] {
  if (tokens.length === 0) return shard.orderedDocumentIds;
  const postingLists = tokens.map((token) => shard.postings[token] ?? []);
  return postingLists.reduce((smallest, current) => current.length < smallest.length ? current : smallest);
}

function matchesFilters(document: VideoTimelineSearchIndexedDocument, query: VideoTimelineSearchQuery): boolean {
  if (query.entityKinds?.length && !query.entityKinds.includes(document.entityKind)) return false;
  if (query.sequenceId && document.sequenceId !== query.sequenceId) return false;
  if (query.trackIds?.length && (!document.trackId || !query.trackIds.includes(document.trackId))) return false;
  if (query.onlineStates?.length && (!document.onlineState || !query.onlineStates.includes(document.onlineState))) return false;
  if (query.proxyStates?.length && (!document.proxyState || !query.proxyStates.includes(document.proxyState))) return false;
  const wantedEffects = normalizeStrings(query.effectNames, 64, 160).map(normalizeSearchText);
  if (wantedEffects.length > 0) {
    const effects = new Set((document.effectNames ?? []).map(normalizeSearchText));
    if (!wantedEffects.every((effect) => effects.has(effect))) return false;
  }
  if (query.fromMs !== undefined && (document.endMs ?? document.startMs ?? 0) < query.fromMs) return false;
  if (query.toMs !== undefined && (document.startMs ?? 0) > query.toMs) return false;
  return true;
}

function getMatchedFields(
  document: VideoTimelineSearchIndexedDocument,
  tokens: readonly string[],
): VideoTimelineSearchResult['matchedFields'] {
  if (tokens.length === 0) return [];
  const fields: Array<[VideoTimelineSearchResult['matchedFields'][number], string]> = [
    ['label', document.label],
    ['text', document.text ?? ''],
    ['tags', (document.tags ?? []).join(' ')],
    ['effects', (document.effectNames ?? []).join(' ')],
    ['online', document.onlineState ?? ''],
    ['proxy', document.proxyState ?? ''],
  ];
  return fields
    .filter(([, value]) => tokens.some((token) => normalizeSearchText(value).includes(token)))
    .map(([field]) => field);
}

function scoreDocument(
  document: VideoTimelineSearchIndexedDocument,
  tokens: readonly string[],
  fields: VideoTimelineSearchResult['matchedFields'],
): number {
  if (tokens.length === 0) return 0;
  const label = normalizeSearchText(document.label);
  const exactLabel = label === tokens.join(' ') ? 1_000 : 0;
  const prefix = tokens.every((token) => label.startsWith(token)) ? 200 : 0;
  const fieldScore = fields.reduce((score, field) => score + (field === 'label' ? 80 : field === 'effects' ? 40 : 20), 0);
  return exactLabel + prefix + fieldScore + tokens.length;
}

function clonePublicDocument(document: VideoTimelineSearchIndexedDocument): VideoTimelineSearchDocument {
  const { normalizedText: _normalizedText, ...publicDocument } = document;
  return {
    ...publicDocument,
    tags: publicDocument.tags ? [...publicDocument.tags] : undefined,
    effectNames: publicDocument.effectNames ? [...publicDocument.effectNames] : undefined,
  };
}

function tokenize(value: string): string[] {
  return normalizeSearchText(value).split(/\s+/u).filter(Boolean);
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKD').replace(/\p{Mark}/gu, '').toLocaleLowerCase().trim();
}

function normalizeStrings(values: readonly string[] | undefined, max: number, length: number): string[] {
  return [...new Set((values ?? []).map((value) => value.trim().slice(0, length)).filter(Boolean))].slice(0, max);
}

function normalizeOptionalTime(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function requiredText(value: string, field: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${field} is required.`);
  return clean;
}
