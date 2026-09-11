import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_CAPTION_CUES,
  MAX_VIDEO_DELIVERY_JOBS,
  MAX_VIDEO_EDITORIAL_TRACKS,
  MAX_VIDEO_PROJECT_DURATION_MS,
  MAX_VIDEO_REVIEW_ANNOTATIONS,
  MAX_VIDEO_REVIEW_REPLIES,
  MAX_VIDEO_REVIEW_TOTAL_REPLIES,
  MAX_VIDEO_SMART_BINS,
  mergeVideoDecodedSignalQcReport,
  sanitizeEditorProfessionalWorkflowState,
} from './videoProductionState';

describe('videoProductionState', () => {
  it('supplies a backwards-compatible bounded default', () => {
    const state = sanitizeEditorProfessionalWorkflowState(undefined);
    expect(state.version).toBe(2);
    expect(state.timebase).toMatchObject({ numerator: 30, denominator: 1, dropFrame: false });
    expect(state.deliveryProfiles[0]?.id).toBe('standard-delivery');
    expect(state.captionEmbedding).toEqual({ enabled: false });
    expect(state.editorial).toEqual({
      sourcePatches: [],
      recordTargetTrackIds: [],
      syncLockedTrackIds: [],
      sequenceBins: [],
      sequenceViewStates: [],
    });
  });

  it('bounds long-form collections and rejects drop-frame on unsupported rates', () => {
    const state = sanitizeEditorProfessionalWorkflowState({
      timebase: { numerator: 24, denominator: 1, dropFrame: true },
      smartBins: Array.from({ length: MAX_VIDEO_SMART_BINS + 10 }, (_, index) => ({
        id: `bin-${index}`,
        name: `Bin ${index}`,
        query: 'rating:5',
      })),
      reviewAnnotations: Array.from({ length: MAX_VIDEO_REVIEW_ANNOTATIONS + 10 }, (_, index) => ({
        id: `note-${index}`,
        target: 'sequence-point',
        startMs: index,
        author: 'Reviewer',
        text: 'Check this frame',
        status: 'open',
        priority: 'normal',
        createdAt: index,
        updatedAt: index,
        replies: index === 0
          ? Array.from({ length: MAX_VIDEO_REVIEW_REPLIES + 10 }, (_, replyIndex) => ({
              id: `reply-${replyIndex}`,
              author: 'Reviewer',
              text: 'Bounded reply',
              createdAt: replyIndex,
            }))
          : [],
      })),
      captionTracks: [{
        id: 'captions',
        name: 'English',
        language: 'en',
        service: 'captions',
        style: {},
        cues: Array.from({ length: MAX_VIDEO_CAPTION_CUES + 10 }, (_, index) => ({
          id: `cue-${index}`,
          startMs: index * 1_000,
          endMs: index * 1_000 + 900,
          text: 'Caption',
        })),
      }, {
        id: 'captions-2',
        name: 'Second language',
        language: 'ja',
        service: 'subtitles',
        style: {},
        cues: Array.from({ length: MAX_VIDEO_CAPTION_CUES }, (_, index) => ({
          id: `cue-ja-${index}`,
          startMs: index * 1_000,
          endMs: index * 1_000 + 900,
          text: 'Caption',
        })),
      }],
      deliveryJobs: Array.from({ length: MAX_VIDEO_DELIVERY_JOBS + 10 }, (_, index) => ({
        id: `job-${index}`,
        profileId: 'standard-delivery',
        compositionSignature: 'signature',
        status: 'planned',
        createdAt: index,
        updatedAt: index,
        hostDurability: 'browser-session-only',
      })),
    });

    expect(state.timebase.dropFrame).toBe(false);
    expect(state.smartBins).toHaveLength(MAX_VIDEO_SMART_BINS);
    expect(state.reviewAnnotations).toHaveLength(MAX_VIDEO_REVIEW_ANNOTATIONS);
    expect(state.reviewAnnotations[0]?.replies).toHaveLength(MAX_VIDEO_REVIEW_REPLIES);
    expect(state.captionTracks[0]?.cues).toHaveLength(MAX_VIDEO_CAPTION_CUES);
    expect(state.captionTracks[1]?.cues).toHaveLength(0);
    expect(state.captionTracks.reduce((total, track) => total + track.cues.length, 0)).toBe(MAX_VIDEO_CAPTION_CUES);
    expect(state.deliveryJobs).toHaveLength(MAX_VIDEO_DELIVERY_JOBS);
    expect(state.deliveryJobs[0]?.id).toBe('job-10');
  });

  it('preserves valid 29.97 drop-frame and sanitizes local review fields', () => {
    const state = sanitizeEditorProfessionalWorkflowState({
      timebase: { numerator: 30_000, denominator: 1_001, dropFrame: true, mixedRatePolicy: 'reject' },
      reviewAnnotations: [{
        id: 'note-1',
        target: 'sequence-range',
        startMs: 1_000,
        endMs: 2_000,
        author: 'Editor',
        text: 'Tighten this beat.',
        status: 'in-progress',
        priority: 'blocking',
        createdAt: 1,
        updatedAt: 2,
        replies: [{ id: 'reply-1', author: 'Director', text: 'Agreed', createdAt: 3 }],
      }],
    });

    expect(state.timebase).toMatchObject({ numerator: 30_000, denominator: 1_001, dropFrame: true });
    expect(state.reviewAnnotations[0]).toMatchObject({
      text: 'Tighten this beat.',
      status: 'in-progress',
      priority: 'blocking',
    });
    expect(state.reviewAnnotations[0]?.replies[0]?.text).toBe('Agreed');
  });

  it('caps persisted local-review replies in aggregate', () => {
    const replies = Array.from({ length: MAX_VIDEO_REVIEW_REPLIES }, (_, index) => ({
      id: `reply-${index}`,
      author: 'Reviewer',
      text: 'Bounded reply',
      createdAt: index,
    }));
    const state = sanitizeEditorProfessionalWorkflowState({
      reviewAnnotations: Array.from({ length: 21 }, (_, index) => ({
        id: `note-${index}`,
        text: 'Review note',
        replies,
      })),
    });

    expect(state.reviewAnnotations.reduce((total, item) => total + item.replies.length, 0)).toBe(MAX_VIDEO_REVIEW_TOTAL_REPLIES);
    expect(state.reviewAnnotations.at(-1)?.replies).toHaveLength(0);
  });

  it('preserves immutable delivery output codec and durability intent', () => {
    const state = sanitizeEditorProfessionalWorkflowState({
      deliveryJobs: [{
        id: 'job-1', profileId: 'standard-delivery', compositionSignature: 'sha256:frozen', status: 'planned',
        createdAt: 1, updatedAt: 1, hostDurability: 'browser-session-only',
        outputs: [{
          id: 'review', label: 'Review', fileName: 'review.mp4', extension: 'mp4', container: 'mp4', codec: 'h264',
          target: 'browser', status: 'queued', missingCapabilities: [], checksumIntent: 'sha256',
          manifestIntent: 'write-json', executionDurability: 'browser-session-only', truthfulnessNote: 'Session only.',
        }],
      }],
    });
    expect(state.deliveryJobs[0]?.outputs?.[0]).toMatchObject({
      extension: 'mp4', container: 'mp4', codec: 'h264', checksumIntent: 'sha256',
      manifestIntent: 'write-json', executionDurability: 'browser-session-only',
    });
  });

  it('persists only compact bounded decoded-signal QC evidence', () => {
    const state = sanitizeEditorProfessionalWorkflowState({
      decodedSignalQcReport: {
        scope: 'decoded-sampled',
        createdAt: 42,
        sourceResults: [{
          sourceId: 'camera-a', label: 'Camera A', kind: 'video', status: 'analyzed',
          decodedFrameSamples: 3, decodedAudioWindows: 2,
        }],
        issues: [{
          id: 'qc-1', code: 'black-frame-run', severity: 'warning', title: 'Black', detail: 'Sampled',
          navigation: { sourceId: 'camera-a', timeMs: 1_000 },
        }],
        // The persisted source must not be trusted for status accounting.
        summary: { errors: 99, warnings: 0, info: 0, blocking: true },
      },
    });
    expect(state.decodedSignalQcReport).toMatchObject({
      scope: 'decoded-sampled', createdAt: 42,
      sourceResults: [{ sourceId: 'camera-a', decodedFrameSamples: 3 }],
      summary: { errors: 0, warnings: 1, blocking: false, analyzedSources: 1 },
    });
    expect(JSON.stringify(state.decodedSignalQcReport)).not.toContain('assetUrl');
  });

  it('merges a completed QC report into the latest workflow state without reverting concurrent review, caption, work-area, or sync-lock edits', () => {
    const clickTimeState = {
      reviewAnnotations: [],
      captionTracks: [],
      editorial: { syncLockedTrackIds: [], sequenceViewStates: [] },
    };
    const latestState = {
      ...clickTimeState,
      reviewAnnotations: [{ id: 'review-new', target: 'sequence-point', startMs: 100, author: 'Ava', text: 'Keep this edit', status: 'open', priority: 'normal', createdAt: 1, updatedAt: 1, replies: [] }],
      captionTracks: [{ id: 'captions-new', name: 'English', language: 'en', service: 'captions', style: {}, cues: [{ id: 'cue-new', startMs: 0, endMs: 1_000, text: 'Keep this caption' }] }],
      editorial: {
        syncLockedTrackIds: ['video:0'],
        sequenceViewStates: [{ sequenceId: 'composition-a', zoomPercent: 175, scrollLeftPx: 25, workArea: { inMs: 1_000, outMs: 4_000, loopEnabled: true } }],
      },
    };
    const merged = mergeVideoDecodedSignalQcReport(latestState, {
      scope: 'decoded-sampled', createdAt: 9,
      sourceResults: [{ sourceId: 'camera-a', label: 'Camera A', kind: 'video', status: 'analyzed', decodedFrameSamples: 1, decodedAudioWindows: 1 }],
      issues: [],
    });

    expect(merged.reviewAnnotations).toEqual([expect.objectContaining({ id: 'review-new', text: 'Keep this edit' })]);
    expect(merged.captionTracks[0]).toMatchObject({ id: 'captions-new', cues: [expect.objectContaining({ id: 'cue-new', text: 'Keep this caption' })] });
    expect(merged.editorial).toMatchObject({ syncLockedTrackIds: ['video:0'], sequenceViewStates: [expect.objectContaining({ workArea: { inMs: 1_000, outMs: 4_000, loopEnabled: true } })] });
    expect(merged.decodedSignalQcReport).toMatchObject({ createdAt: 9, sourceResults: [expect.objectContaining({ sourceId: 'camera-a' })] });
  });

  it('preserves a retained embedded-caption selection and disables a stale explicit track selection', () => {
    const persisted = {
      captionTracks: [{
        id: 'english', name: 'English', language: 'eng', service: 'captions', style: {},
        cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Caption' }],
      }],
    };
    expect(sanitizeEditorProfessionalWorkflowState({
      ...persisted,
      captionEmbedding: { enabled: true, trackId: 'english' },
    }).captionEmbedding).toEqual({ enabled: true, trackId: 'english' });
    expect(sanitizeEditorProfessionalWorkflowState({
      ...persisted,
      captionEmbedding: { enabled: true, trackId: 'removed' },
    }).captionEmbedding).toEqual({ enabled: false });
  });

  it('migrates and bounds third-program editorial state without persisting transient UI data', () => {
    const state = sanitizeEditorProfessionalWorkflowState({
      version: 1,
      editorial: {
        sourcePatches: Array.from({ length: MAX_VIDEO_EDITORIAL_TRACKS + 4 }, (_, index) => ({
          id: `patch-${index}`,
          sourceKind: index % 2 ? 'audio' : 'video',
          sourceTrackIndex: index,
          targetTrackId: index % 2 ? `audio:${Math.floor(index / 2)}` : `video:${Math.floor(index / 2)}`,
          enabled: true,
        })),
        recordTargetTrackIds: ['video:0', 'video:0', 'audio:0'],
        syncLockedTrackIds: ['video:0'],
        sequenceBins: [{ id: 'bin-1', name: 'Act 1', sequenceIds: ['sequence-a'] }],
        sequenceViewStates: [{
          sequenceId: 'sequence-a',
          zoomPercent: 250,
          scrollLeftPx: 12_000,
          workArea: { inMs: 1_000, outMs: MAX_VIDEO_PROJECT_DURATION_MS + 1_000, loopEnabled: true },
          openTabs: ['must-not-persist'],
        }],
        clipboard: { mediaBytes: 'must-not-persist' },
      },
    });

    expect(state.version).toBe(2);
    expect(state.editorial.sourcePatches).toHaveLength(MAX_VIDEO_EDITORIAL_TRACKS);
    expect(state.editorial.recordTargetTrackIds).toEqual(['video:0', 'audio:0']);
    expect(state.editorial.sequenceBins[0]).toEqual({ id: 'bin-1', name: 'Act 1', sequenceIds: ['sequence-a'] });
    expect(state.editorial.sequenceViewStates[0]).toEqual({
      sequenceId: 'sequence-a',
      zoomPercent: 250,
      scrollLeftPx: 12_000,
      workArea: { inMs: 1_000, outMs: MAX_VIDEO_PROJECT_DURATION_MS, loopEnabled: true },
    });
    expect(state.editorial).not.toHaveProperty('clipboard');
  });

  it('validates target IDs against authoritative tracks and one combined 64-track budget', () => {
    const trackIds = Array.from({ length: MAX_VIDEO_EDITORIAL_TRACKS }, (_, index) => `video:${index}`);
    const state = sanitizeEditorProfessionalWorkflowState({
      editorial: {
        sourcePatches: [
          ...trackIds.slice(0, 62).map((targetTrackId, index) => ({ id: `patch-${index}`, sourceKind: 'video', sourceTrackIndex: index, targetTrackId })),
          { id: 'missing', sourceKind: 'video', sourceTrackIndex: 0, targetTrackId: 'missing-track' },
          { id: 'unsafe', sourceKind: 'video', sourceTrackIndex: 0, targetTrackId: '../video:0' },
        ],
        recordTargetTrackIds: ['video:0', 'missing-track', 'video:62', 'video:63'],
        syncLockedTrackIds: ['video:1', 'audio:0'],
      },
    }, { validTargetTrackIds: trackIds });

    const combined = new Set([
      ...state.editorial.sourcePatches.map((patch) => patch.targetTrackId),
      ...state.editorial.recordTargetTrackIds,
      ...state.editorial.syncLockedTrackIds,
    ]);
    expect(state.editorial.sourcePatches).toHaveLength(62);
    expect(combined.size).toBe(MAX_VIDEO_EDITORIAL_TRACKS);
    expect(state.editorial.recordTargetTrackIds).toEqual(['video:0', 'video:62', 'video:63']);
    expect(state.editorial.syncLockedTrackIds).toEqual(['video:1']);
    expect(state.editorial.sourcePatches.some((patch) => patch.id === 'missing' || patch.id === 'unsafe')).toBe(false);

    const mismatched = sanitizeEditorProfessionalWorkflowState({
      editorial: { sourcePatches: [{ id: 'wrong-kind', sourceKind: 'video', sourceTrackIndex: 0, targetTrackId: 'audio:0' }] },
    }, { validTargetTrackIds: ['audio:0'] });
    expect(mismatched.editorial.sourcePatches).toEqual([]);
  });
});
