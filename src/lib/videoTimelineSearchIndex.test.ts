import { describe, expect, it } from 'vitest';
import {
  buildVideoTimelineSearchDocuments,
  buildVideoTimelineSearchDocumentsWithReport,
  createVideoTimelineSearchIndex,
  MAX_VIDEO_TIMELINE_SEARCH_CONSTRUCTION_DOCUMENTS,
  MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS_PER_SHARD,
  MAX_VIDEO_TIMELINE_SEARCH_RESULTS,
  searchVideoTimelineIndex,
  updateVideoTimelineSearchShard,
  type VideoTimelineSearchDocument,
} from './videoTimelineSearchIndex';

describe('Video timeline search index', () => {
  it('indexes clips, logging, captions, transcripts, markers, effects, online and proxy state', () => {
    const documents = buildVideoTimelineSearchDocuments({
      clips: [{
        id: 'clip-a', label: 'Interview closeup', sequenceId: 'sequence-a', sourceItemId: 'source-a',
        trackId: 'v1', startMs: 1_000, endMs: 5_000, effectNames: ['Lumetri Warm'], onlineState: 'offline', proxyState: 'ready',
      }],
      logging: [{ sourceItemId: 'source-a', fileName: 'A001.mov', scene: 'Kitchen', tags: ['select'], rating: 5, status: 'select', subclips: [] }],
      captions: [{ id: 'caption-a', trackId: 'cc1', sequenceId: 'sequence-a', startMs: 1_500, endMs: 2_500, text: 'Welcome home', speaker: 'Host' }],
      transcripts: [{ id: 'word-a', sourceItemId: 'source-a', text: 'documentary interview', speaker: 'Guest' }],
      markers: [{ id: 'marker-a', name: 'Director note', notes: 'Use alternate take', kind: 'edit', color: '#22d3ee', target: { kind: 'point', timeMs: 2_000 }, createdAt: 1, updatedAt: 1 }],
      sequenceIdForMarkers: 'sequence-a',
    });
    const index = updateVideoTimelineSearchShard(createVideoTimelineSearchIndex(), { shardId: 'sequence-a', revision: 'rev-1', documents });
    expect(searchVideoTimelineIndex(index, { text: 'welcome host' })[0]?.document.entityKind).toBe('caption');
    expect(searchVideoTimelineIndex(index, { text: 'kitchen select' })[0]?.document.entityKind).toBe('media-log');
    expect(searchVideoTimelineIndex(index, { text: 'interview', entityKinds: ['transcript'] })[0]?.document.entityKind).toBe('transcript');
    expect(searchVideoTimelineIndex(index, { text: 'alternate', entityKinds: ['marker'] })[0]?.document.entityKind).toBe('marker');
    expect(searchVideoTimelineIndex(index, { text: 'closeup', onlineStates: ['offline'], proxyStates: ['ready'], effectNames: ['Lumetri Warm'] })[0]?.document.clipId).toBe('clip-a');
  });

  it('reuses unchanged revisions and replaces only the updated shard', () => {
    const first = updateVideoTimelineSearchShard(createVideoTimelineSearchIndex(), {
      shardId: 'clips-0', revision: 'one', documents: [{ id: 'a', entityKind: 'clip', label: 'Alpha' }],
    });
    expect(updateVideoTimelineSearchShard(first, { shardId: 'clips-0', revision: 'one', documents: [] })).toBe(first);
    const second = updateVideoTimelineSearchShard(first, {
      shardId: 'clips-0', revision: 'two', documents: [{ id: 'b', entityKind: 'clip', label: 'Beta' }],
    });
    expect(second).not.toBe(first);
    expect(searchVideoTimelineIndex(second, { text: 'alpha' })).toEqual([]);
    expect(searchVideoTimelineIndex(second, { text: 'beta' })[0]?.document.id).toBe('b');
  });

  it('caps result materialization at 500', () => {
    const documents: VideoTimelineSearchDocument[] = Array.from({ length: 650 }, (_, index) => ({
      id: `clip-${index}`, entityKind: 'clip', label: `Shared token ${index}`, startMs: index,
    }));
    const index = updateVideoTimelineSearchShard(createVideoTimelineSearchIndex(), { shardId: 'many', revision: 'one', documents });
    expect(searchVideoTimelineIndex(index, { text: 'shared', limit: 10_000 })).toHaveLength(MAX_VIDEO_TIMELINE_SEARCH_RESULTS);
  });

  it('bounds aggregate construction and reports deterministic per-kind truncation', () => {
    const clips = Array.from({ length: 60_000 }, (_, index) => ({
      id: `clip-${index}`, label: `Clip ${index}`, sequenceId: 'sequence-a', sourceItemId: `source-${index}`,
      trackId: 'video:0', startMs: index, endMs: index + 1,
    }));
    const captions = Array.from({ length: 60_000 }, (_, index) => ({
      id: `cue-${index}`, trackId: 'cc1', sequenceId: 'sequence-a', startMs: index, endMs: index + 1, text: `Cue ${index}`,
    }));
    const result = buildVideoTimelineSearchDocumentsWithReport({ clips, captions });
    expect(result.documents).toHaveLength(MAX_VIDEO_TIMELINE_SEARCH_CONSTRUCTION_DOCUMENTS);
    expect(result.report).toEqual({
      inputDocumentCount: 120_000,
      constructedDocumentCount: MAX_VIDEO_TIMELINE_SEARCH_CONSTRUCTION_DOCUMENTS,
      droppedDocumentCount: 20_000,
      truncated: true,
      droppedByEntityKind: { caption: 20_000 },
      reasons: ['construction-limit'],
    });
  });

  it('truncates oversized shard updates with a report instead of throwing synchronously', () => {
    const documents: VideoTimelineSearchDocument[] = Array.from(
      { length: MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS_PER_SHARD + 1 },
      (_, index) => ({ id: `clip-${index}`, entityKind: 'clip', label: `Clip ${index}` }),
    );
    const index = updateVideoTimelineSearchShard(createVideoTimelineSearchIndex(), {
      shardId: 'oversized', revision: 'one', documents,
    });
    expect(index.documentCount).toBe(MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS_PER_SHARD);
    expect(index.lastUpdateReport).toMatchObject({
      inputDocumentCount: MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS_PER_SHARD + 1,
      indexedDocumentCount: MAX_VIDEO_TIMELINE_SEARCH_DOCUMENTS_PER_SHARD,
      droppedDocumentCount: 1,
      truncated: true,
      reasons: ['shard-document-limit'],
    });
  });
});
