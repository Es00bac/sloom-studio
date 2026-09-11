import { describe, expect, it } from 'vitest';
import type { ManagedBundledFontFaceReference } from '../types/managedFont';
import { buildVideoRenderDirtyPlan } from './videoRenderSegments';
import {
  buildVideoRenderCachedSegmentArtifactsFromNativePayload,
  buildVideoRenderSegmentArtifactsForCompletedRender,
  buildVideoCompositionRenderCacheSignature,
  buildVideoRenderAssemblyManifest,
  buildVideoRenderSegmentReusePlan,
  formatVideoRenderAssemblyManifestDetails,
  formatVideoRenderAssemblyResultDetail,
  normalizeVideoRenderCacheSegmentSignatures,
  retainReusableVideoRenderSegmentArtifacts,
  resolveVideoRenderCacheAction,
} from './videoRenderCache';

describe('video render cache helpers', () => {
  it('normalizes persisted segment signatures to string records', () => {
    expect(
      normalizeVideoRenderCacheSegmentSignatures({
        '0-1000': 'sig-a',
        '1000-2000': 'sig-b',
        badNumber: 12,
        badNull: null,
      }),
    ).toEqual({
      '0-1000': 'sig-a',
      '1000-2000': 'sig-b',
    });
  });

  it('reuses the previous rendered output when no timeline spans changed', () => {
    const firstPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v1' },
      ],
      previousSegmentSignatures: {},
    });
    const nextPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v1' },
      ],
      previousSegmentSignatures: firstPlan.segmentSignatures,
    });

    expect(
      resolveVideoRenderCacheAction({
        dirtyPlan: nextPlan,
        cachedResultUrl: 'blob:previous-render',
      }),
    ).toEqual({
      kind: 'reuse-cache',
      summary: 'Render cache hit: no timeline spans changed; reused the previous rendered preview.',
    });
  });

  it('renders again when matching signatures have no cached output to reuse', () => {
    const firstPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
      ],
      previousSegmentSignatures: {},
    });
    const nextPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
      ],
      previousSegmentSignatures: firstPlan.segmentSignatures,
    });

    expect(
      resolveVideoRenderCacheAction({
        dirtyPlan: nextPlan,
        cachedResultUrl: undefined,
      }),
    ).toEqual({
      kind: 'render',
      summary: 'Render cache unavailable: previous preview missing; 1 timeline span queued.',
    });
  });

  it('explains stale full-composition cache misses when a previous render exists', () => {
    const dirtyPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v2' },
      ],
      previousSegmentSignatures: {},
    });

    expect(
      resolveVideoRenderCacheAction({
        dirtyPlan,
        cachedResultUrl: 'blob:previous-render',
        cacheInvalidationReason: 'composition inputs changed',
      }),
    ).toEqual({
      kind: 'render',
      summary: 'Render cache invalidated: composition inputs changed; 1 timeline span queued.',
    });
  });

  it('plans reusable cached segment artifacts separately from dirty spans', () => {
    const firstPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v1' },
      ],
      previousSegmentSignatures: {},
    });
    const nextPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v2' },
      ],
      previousSegmentSignatures: firstPlan.segmentSignatures,
    });
    const [heroSegment] = nextPlan.segments;

    expect(buildVideoRenderSegmentReusePlan({
      dirtyPlan: nextPlan,
      cachedArtifacts: {
        [heroSegment.key]: {
          key: heroSegment.key,
          signature: heroSegment.signature,
          url: 'blob:segment-hero',
          startMs: heroSegment.startMs,
          endMs: heroSegment.endMs,
        },
      },
    })).toEqual({
      items: [
        {
          key: '0-1000',
          startMs: 0,
          endMs: 1000,
          activeClipIds: ['hero'],
          signature: heroSegment.signature,
          action: 'reuse',
          cachedUrl: 'blob:segment-hero',
        },
        {
          key: '1000-2000',
          startMs: 1000,
          endMs: 2000,
          activeClipIds: ['title'],
          signature: nextPlan.segments[1].signature,
          action: 'render',
          reason: 'timeline span changed',
        },
      ],
      reusedSegments: 1,
      renderSegments: 1,
      reusableDurationMs: 1000,
      renderDurationMs: 1000,
      summary: 'Segment artifact reuse: 1 reusable cached span, 1 queued dirty span.',
    });
  });

  it('queues clean spans when cached segment artifacts are missing or stale', () => {
    const firstPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v1' },
      ],
      previousSegmentSignatures: {},
    });
    const nextPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v1' },
      ],
      previousSegmentSignatures: firstPlan.segmentSignatures,
    });

    expect(buildVideoRenderSegmentReusePlan({
      dirtyPlan: nextPlan,
      cachedArtifacts: {},
    }).items.map((item) => ({ key: item.key, action: item.action, reason: item.reason }))).toEqual([
      { key: '0-1000', action: 'render', reason: 'missing cached segment artifact' },
      { key: '1000-2000', action: 'render', reason: 'missing cached segment artifact' },
    ]);

    expect(buildVideoRenderSegmentReusePlan({
      dirtyPlan: nextPlan,
      cachedArtifacts: {
        '0-1000': {
          key: '0-1000',
          signature: 'stale-signature',
          url: 'blob:segment-hero',
          startMs: 0,
          endMs: 1000,
        },
      },
    }).items[0]).toMatchObject({
      key: '0-1000',
      action: 'render',
      reason: 'cached segment signature mismatch',
    });
  });

  it('builds a native assembly manifest that names safe artifact assembly without claiming dirty-span-only rendering', () => {
    const firstPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v1' },
      ],
      previousSegmentSignatures: {},
    });
    const nextPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v2' },
      ],
      previousSegmentSignatures: firstPlan.segmentSignatures,
    });
    const reusePlan = buildVideoRenderSegmentReusePlan({
      dirtyPlan: nextPlan,
      cachedArtifacts: {
        '0-1000': {
          key: '0-1000',
          signature: nextPlan.segments[0].signature,
          url: 'blob:cached-segment-hero',
          startMs: 0,
          endMs: 1000,
        },
      },
    });

    expect(buildVideoRenderAssemblyManifest(reusePlan)).toEqual({
      version: 1,
      kind: 'video-render-segment-assembly',
      mode: 'safe-artifact-assembly',
      summary: 'Segment artifact reuse: 1 reusable cached span, 1 queued dirty span.',
      segments: [
        {
          key: '0-1000',
          startMs: 0,
          endMs: 1000,
          activeClipIds: ['hero'],
          signature: nextPlan.segments[0].signature,
          action: 'reuse-cached-segment',
          cachedUrl: 'blob:cached-segment-hero',
        },
        {
          key: '1000-2000',
          startMs: 1000,
          endMs: 2000,
          activeClipIds: ['title'],
          signature: nextPlan.segments[1].signature,
          action: 'render-dirty-span',
          reason: 'timeline span changed',
        },
      ],
      caveat: 'Native artifact assembly can reuse materialized cached spans; dirty spans are still extracted from a full render until dirty-span-only rendering lands.',
    });
  });

  it('formats native assembly manifest details for Program Monitor inspection', () => {
    expect(formatVideoRenderAssemblyManifestDetails({
      version: 1,
      kind: 'video-render-segment-assembly',
      mode: 'safe-artifact-assembly',
      summary: 'Segment artifact reuse: 1 reusable cached span, 1 queued dirty span.',
      segments: [
        {
          key: '0-1000',
          startMs: 0,
          endMs: 1000,
          activeClipIds: ['hero'],
          signature: 'sig-hero',
          action: 'reuse-cached-segment',
          cachedUrl: 'blob:segment-hero',
        },
        {
          key: '1000-2500',
          startMs: 1000,
          endMs: 2500,
          activeClipIds: ['title', 'overlay'],
          signature: 'sig-title-overlay',
          action: 'render-dirty-span',
          reason: 'timeline span changed',
        },
      ],
      caveat: 'Native artifact assembly can reuse materialized cached spans; dirty spans are still extracted from a full render until dirty-span-only rendering lands.',
    })).toEqual([
      'Reuse 0.0s-1.0s from cached segment (1 clip).',
      'Extract 1.0s-2.5s from the new full render because timeline span changed (2 clips).',
    ]);
  });

  it('retains only proven reusable cached segment artifacts after a full render', () => {
    const firstPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v1' },
      ],
      previousSegmentSignatures: {},
    });
    const nextPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v2' },
      ],
      previousSegmentSignatures: firstPlan.segmentSignatures,
    });
    const cachedArtifacts = {
      '0-1000': {
        key: '0-1000',
        signature: nextPlan.segments[0].signature,
        url: 'blob:cached-segment-hero',
        startMs: 0,
        endMs: 1000,
        updatedAt: '2026-06-04T15:00:00Z',
      },
      '1000-2000': {
        key: '1000-2000',
        signature: 'stale-title-signature',
        url: 'blob:stale-title',
        startMs: 1000,
        endMs: 2000,
        updatedAt: '2026-06-04T15:00:00Z',
      },
    };
    const reusePlan = buildVideoRenderSegmentReusePlan({
      dirtyPlan: nextPlan,
      cachedArtifacts,
    });

    expect(retainReusableVideoRenderSegmentArtifacts({
      reusePlan,
      cachedArtifacts,
    })).toEqual({
      '0-1000': cachedArtifacts['0-1000'],
    });
  });

  it('converts native segment artifact payloads into cached data-url artifacts', () => {
    expect(buildVideoRenderCachedSegmentArtifactsFromNativePayload({
      segmentArtifacts: [
        {
          key: '1000-2000',
          signature: 'sig-title',
          startMs: 1000,
          endMs: 2000,
          mimeType: 'video/mp4',
          base64: 'AQID',
        },
        {
          key: 'bad-time',
          signature: 'sig-bad-time',
          startMs: 2000,
          endMs: 1000,
          mimeType: 'video/mp4',
          base64: 'BAUG',
        },
        {
          key: 'missing-base64',
          signature: 'sig-missing',
          startMs: 0,
          endMs: 1000,
          mimeType: 'video/mp4',
        },
      ],
      updatedAt: '2026-06-04T15:55:00Z',
    })).toEqual({
      '1000-2000': {
        key: '1000-2000',
        signature: 'sig-title',
        startMs: 1000,
        endMs: 2000,
        url: 'data:video/mp4;base64,AQID',
        updatedAt: '2026-06-04T15:55:00Z',
      },
    });
  });

  it('merges retained reusable artifacts with native artifacts produced by the completed render', () => {
    const firstPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v1' },
      ],
      previousSegmentSignatures: {},
    });
    const nextPlan = buildVideoRenderDirtyPlan({
      clips: [
        { id: 'hero', trackIndex: 0, startMs: 0, durationMs: 1000, signature: 'hero-v1' },
        { id: 'title', trackIndex: 1, startMs: 1000, durationMs: 1000, signature: 'title-v2' },
      ],
      previousSegmentSignatures: firstPlan.segmentSignatures,
    });
    const cachedArtifacts = {
      '0-1000': {
        key: '0-1000',
        signature: nextPlan.segments[0].signature,
        url: 'blob:cached-hero',
        startMs: 0,
        endMs: 1000,
      },
      '1000-2000': {
        key: '1000-2000',
        signature: 'stale-title',
        url: 'blob:stale-title',
        startMs: 1000,
        endMs: 2000,
      },
    };
    const reusePlan = buildVideoRenderSegmentReusePlan({
      dirtyPlan: nextPlan,
      cachedArtifacts,
    });

    expect(buildVideoRenderSegmentArtifactsForCompletedRender({
      reusePlan,
      cachedArtifacts,
      segmentArtifacts: [
        {
          key: '1000-2000',
          signature: nextPlan.segments[1].signature,
          startMs: 1000,
          endMs: 2000,
          mimeType: 'video/mp4',
          base64: 'TkVX',
        },
      ],
      updatedAt: '2026-06-04T15:56:00Z',
    })).toEqual({
      '0-1000': cachedArtifacts['0-1000'],
      '1000-2000': {
        key: '1000-2000',
        signature: nextPlan.segments[1].signature,
        startMs: 1000,
        endMs: 2000,
        url: 'data:video/mp4;base64,TkVX',
        updatedAt: '2026-06-04T15:56:00Z',
      },
    });
  });

  it('formats native segment assembly result disclosure lines', () => {
    expect(formatVideoRenderAssemblyResultDetail({
      assembledFromSegments: true,
    })).toBe('Native segment assembly: assembled final output from reusable cached spans and newly rendered dirty-span artifacts.');

    expect(formatVideoRenderAssemblyResultDetail({
      assembledFromSegments: false,
      assemblyUnavailableReason: 'Cached segment 0-1000 must be a materialized data URL for native assembly.',
    })).toBe('Native segment assembly fallback: used the full rendered output because Cached segment 0-1000 must be a materialized data URL for native assembly.');
  });

  it('changes the full composition cache signature when audio, stage objects, or export settings change', () => {
    const baseInput = {
      aspectRatio: '16:9',
      videoResolution: '720p',
      frameRate: 30,
      timelineDurationSeconds: 4,
      exportPresetPlan: { presetId: 'review-h264-1080p' },
      visualClips: [{
        id: 'visual-1',
        sourceNodeId: 'camera-a',
        trackIndex: 0,
        startMs: 0,
        durationSeconds: 4,
        sourceInMs: 0,
        sourceOutMs: 4_000,
      }],
      sourceMedia: [{
        id: 'camera-a',
        nativeFilePath: '/camera/card/A001.mov',
        sourceFingerprint: `sha256:${'a'.repeat(64)}`,
        onlineState: 'online',
      }],
      audioClips: [
        {
          id: 'audio-1',
          sourceNodeId: 'voiceover',
          sourceKind: 'audio',
          trackIndex: 0,
          startMs: 0,
          durationSeconds: 4,
          offsetMs: 0,
          volumePercent: 100,
          enabled: true,
        },
      ],
      stageObjects: [
        {
          id: 'bug',
          kind: 'text',
          x: 20,
          y: 24,
          width: 200,
          height: 80,
          rotationDeg: 0,
          opacityPercent: 100,
          blendMode: 'normal',
          text: 'Scene 1',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSizePx: 32,
          color: '#ffffff',
        },
      ],
    };

    const base = buildVideoCompositionRenderCacheSignature(baseInput);
    expect(base).toMatch(/^video-composition-v2:[0-9a-f]{64}$/u);

    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      visualClips: [{ ...baseInput.visualClips[0], startMs: 500 }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      sourceMedia: [{ ...baseInput.sourceMedia[0], nativeFilePath: '/project/Media/A001.mov' }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      audioClips: [{ ...baseInput.audioClips[0], volumePercent: 50 }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      audioClips: [{ ...baseInput.audioClips[0], fadeInSeconds: 0.75, fadeOutSeconds: 1.25 }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      audioClips: [{ ...baseInput.audioClips[0], sourceInMs: 500, sourceOutMs: 3_500 }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      audioClips: [{ ...baseInput.audioClips[0], measuredMatchGainDb: 2.5 }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      audioClips: [{ ...baseInput.audioClips[0], audioProcessing: { processingEnabled: true, highPassEnabled: true, highPassHz: 80 } }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      audioClips: [{
        ...baseInput.audioClips[0],
        audioDucking: { enabled: true, controlClipId: 'dialogue', depthPercent: 60, thresholdDbfs: -30, attackMs: 10, releaseMs: 250 },
      }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      stageObjects: [{ ...baseInput.stageObjects[0], text: 'Scene 2' }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      stageObjects: [{
        ...baseInput.stageObjects[0],
        managedFace: {
          kind: 'bundled', schemaVersion: 2, faceId: 'liberation:regular', family: 'Liberation Sans',
          weight: 400, style: 'normal', stretchPercent: 100, collectionIndex: 0,
          sha256: 'a'.repeat(64), byteLength: 123,
        },
      }],
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      exportPresetPlan: { presetId: 'png-image-sequence' },
    })).not.toBe(base);
    expect(buildVideoCompositionRenderCacheSignature({
      ...baseInput,
      visualClips: [{
        ...baseInput.visualClips[0],
        professional: {
          masks: [{
            id: 'mask-1', kind: 'rectangle', points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }],
            featherPercent: 0, opacityPercent: 100, inverted: false,
            tracking: { status: 'ready', keyframes: [{ timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 }] },
          }],
        },
      }],
    })).not.toBe(base);
  });

  it('invalidates the full composition cache for each persisted audio-track authority change', () => {
    const baseInput = {
      aspectRatio: '16:9',
      videoResolution: '720p',
      frameRate: 30,
      timelineDurationSeconds: 4,
      visualClips: [{ id: 'visual-1', startMs: 0, durationSeconds: 4 }],
      audioClips: [{ id: 'audio-1', trackIndex: 0, offsetMs: 0, durationSeconds: 4, volumePercent: 100, enabled: true }],
      editorMutedAudioTracks: [] as number[],
      editorSoloAudioTracks: [] as number[],
      editorAudioTrackVolumes: [100, 100, 100, 100],
    };
    const signatureFor = (input: typeof baseInput) => buildVideoCompositionRenderCacheSignature(input);
    const firstSignature = signatureFor(baseInput);

    expect(signatureFor({ ...baseInput })).toBe(firstSignature);
    expect(signatureFor({ ...baseInput, editorMutedAudioTracks: [0] })).not.toBe(firstSignature);
    expect(signatureFor({ ...baseInput, editorSoloAudioTracks: [1] })).not.toBe(firstSignature);
    expect(signatureFor({ ...baseInput, editorAudioTrackVolumes: [100, 35, 100, 100] })).not.toBe(firstSignature);
  });

  it('keeps approval signatures stable across review and delivery metadata while tracking render-affecting workflow state', () => {
    const renderState = {
      timebase: { numerator: 30_000, denominator: 1_001, dropFrame: true },
      captionTracks: [{ id: 'captions', cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Hello' }] }],
      reviewAnnotations: [{ id: 'note-1', text: 'Tighten the cut' }],
      reviewApprovals: [{ id: 'approval-1', status: 'approved', compositionSignature: 'prior' }],
      smartBins: [{ id: 'selects', query: 'rating >= 4' }],
      deliveryJobs: [{ id: 'job-1', status: 'planned' }],
    };
    const signatureFor = (professionalWorkflowState: unknown) => buildVideoCompositionRenderCacheSignature({
      visualClips: [{ id: 'visual-1', startMs: 0, durationSeconds: 1 }],
      professionalWorkflowState,
    });
    const base = signatureFor(renderState);

    expect(signatureFor({
      ...renderState,
      reviewAnnotations: [{ id: 'note-2', text: 'Approved locally' }],
      reviewApprovals: [{ id: 'approval-2', status: 'changes-requested', compositionSignature: base }],
      smartBins: [{ id: 'alternates', query: 'status:hold' }],
      deliveryJobs: [{ id: 'job-1', status: 'cancelled' }, { id: 'job-2', status: 'planned' }],
    })).toBe(base);
    expect(signatureFor({
      ...renderState,
      captionTracks: [{ id: 'captions', cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Changed' }] }],
    })).not.toBe(base);
    expect(signatureFor({
      ...renderState,
      timebase: { numerator: 24, denominator: 1, dropFrame: false },
    })).not.toBe(base);
  });

  it('varies the full-composition cache signature for complete managed-face identity changes', () => {
    const managedFace = {
      kind: 'bundled' as const, schemaVersion: 2 as const, faceId: 'face-a', family: 'Duplicate Family',
      weight: 400, style: 'normal' as const, stretchPercent: 100, collectionIndex: 0,
      sha256: 'a'.repeat(64), byteLength: 100,
    };
    const signatureFor = (reference: ManagedBundledFontFaceReference) => buildVideoCompositionRenderCacheSignature({
      stageObjects: [{ id: 'title', kind: 'text', managedFace: reference }],
    });
    const base = signatureFor(managedFace);
    for (const changed of [
      { ...managedFace, faceId: 'face-b' }, { ...managedFace, family: 'Other Family' },
      { ...managedFace, weight: 500 }, { ...managedFace, style: 'italic' as const },
      { ...managedFace, stretchPercent: 87.5 }, { ...managedFace, collectionIndex: 1 },
      { ...managedFace, sha256: 'b'.repeat(64) }, { ...managedFace, byteLength: 101 },
    ]) expect(signatureFor(changed)).not.toBe(base);
  });
});
