import { describe, expect, it } from 'vitest';
import {
  buildVideoRuntimeCacheKey,
  compileVideoRuntimeAdapterPlan,
  compileVideoRuntimeIr,
  createVideoRuntimeRational,
  getVideoRuntimeActiveVisualClipIds,
  hashVideoRuntimeIr,
  videoRuntimeRationalFromMilliseconds,
  videoRuntimeRationalToMilliseconds,
  type VideoRuntimeCompileInput,
  type VideoRuntimeIr,
} from './videoRuntimeIr';
import {
  buildVideoRuntimeRenderDirtyPlan,
  diffVideoRuntimeIr,
  projectVideoRuntimeNestedInvalidation,
} from './videoRuntimeInvalidation';

function visual(
  id: string,
  sourceNodeId: string,
  startMs: number,
  durationMs: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    clip: {
      id,
      sourceNodeId,
      sourceKind: 'video' as const,
      trackIndex: 0,
      startMs,
      sourceInMs: 0,
      sourceOutMs: durationMs,
      playbackRate: 1,
      transitionIn: 'none' as const,
      transitionOut: 'none' as const,
      transitionDurationMs: 0,
      ...overrides,
    },
    durationMs,
    sourceInMs: 0,
    sourceOutMs: durationMs,
  };
}

function compile(overrides: Partial<VideoRuntimeCompileInput> = {}): VideoRuntimeIr {
  const result = compileVideoRuntimeIr({
    sequenceId: 'sequence-main',
    canvas: { width: 1920, height: 1080 },
    durationMs: 10_000,
    frameRate: 30,
    visualClips: [visual('clip-a', 'source-a', 0, 5_000)],
    audioClips: [],
    ...overrides,
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.ir;
}

describe('Video Runtime IR', () => {
  it('normalizes rational time exactly and rejects unsafe rationals', () => {
    expect(createVideoRuntimeRational(30_000, 1_001)).toEqual({ numerator: 30_000, denominator: 1_001 });
    expect(videoRuntimeRationalFromMilliseconds(1_500)).toEqual({ numerator: 3, denominator: 2 });
    expect(videoRuntimeRationalToMilliseconds({ numerator: 3, denominator: 2 })).toBe(1_500);
    expect(() => createVideoRuntimeRational(1, 0)).toThrow(/non-zero/u);
    expect(() => createVideoRuntimeRational(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow(/safe integer/u);
  });

  it('is deterministic across input order and excludes renderer locators', () => {
    const first = compile({
      visualClips: [
        visual('clip-b', 'source-b', 5_000, 5_000),
        {
          ...visual('clip-a', 'source-a', 0, 5_000),
          clip: {
            ...visual('clip-a', 'source-a', 0, 5_000).clip,
            assetUrl: 'file:///private/camera.mov',
            nativeFilePath: '/private/camera.mov',
          } as never,
        },
      ],
    });
    const second = compile({
      visualClips: [
        visual('clip-a', 'source-a', 0, 5_000),
        visual('clip-b', 'source-b', 5_000, 5_000),
      ],
    });
    expect(hashVideoRuntimeIr(first)).toBe(hashVideoRuntimeIr(second));
    expect(JSON.stringify(first)).not.toMatch(/file:\/\/|\/private\/camera/u);
    expect(first.visualClips.map((clip) => clip.id)).toEqual(['clip-a', 'clip-b']);
  });

  it('keeps preview rendition choice separate from original-only export truth', () => {
    const ir = compile({
      visualClips: [{
        ...visual('clip-a', 'source-a', 0, 5_000),
        hasPreviewRendition: true,
        sourceFingerprint: 'sha256:original',
        previewFingerprint: 'sha256:proxy',
      }],
    });
    const preview = compileVideoRuntimeAdapterPlan(ir, { target: 'preview', atMilliseconds: 1_000 });
    const exported = compileVideoRuntimeAdapterPlan(ir, { target: 'export' });
    expect(preview.ok && preview.sourceSelections[0]).toMatchObject({ role: 'preview' });
    expect(exported.ok && exported.sourceSelections[0]).toMatchObject({ role: 'original' });
    expect(ir.sources[0]?.renditions.map((rendition) => rendition.fingerprint)).toEqual([
      'sha256:original',
      'sha256:proxy',
    ]);
  });

  it('fails adapters closed when the worker cannot execute required semantics', () => {
    const ir = compile({
      visualClips: [visual('nested', 'child-sequence', 0, 5_000, {
        sourceKind: 'composition',
        professional: {
          nestedSequenceId: 'child-sequence',
          retime: [{
            id: 'speed',
            timelineStartMs: 0,
            timelineEndMs: 5_000,
            speedPercent: 50,
            interpolation: 'optical-flow',
          }],
        },
      })],
    });
    expect(ir.requiredCapabilities).toEqual(['minterpolate', 'runtime:nested-sequence', 'runtime:retime']);
    expect(compileVideoRuntimeAdapterPlan(ir, {
      target: 'export',
      availableCapabilities: [],
    })).toMatchObject({
      ok: false,
      missingCapabilities: ['minterpolate', 'runtime:nested-sequence', 'runtime:retime'],
    });
    expect(compileVideoRuntimeAdapterPlan(ir, { target: 'preview' })).toMatchObject({
      ok: false,
      missingCapabilities: ['minterpolate', 'runtime:nested-sequence', 'runtime:retime'],
    });
  });

  it('uses the shared active range for edit-point dissolve pre-roll', () => {
    const ir = compile({
      visualClips: [
        visual('outgoing', 'source-a', 0, 5_000, {
          transitionOut: 'fade',
          transitionDurationMs: 1_000,
        }),
        visual('incoming', 'source-b', 5_000, 5_000, {
          transitionIn: 'fade',
          transitionDurationMs: 1_000,
        }),
      ],
    });
    expect(getVideoRuntimeActiveVisualClipIds(ir, 4_500)).toEqual(['outgoing', 'incoming']);
    expect(ir.visualClips.find((clip) => clip.id === 'incoming')?.transitions.editPointDissolve).toBe(true);
  });

  it('uses half-open clip ranges at hard cuts while retaining the final sequence frame', () => {
    const ir = compile({
      visualClips: [
        visual('outgoing', 'source-a', 0, 5_000),
        visual('incoming', 'source-b', 5_000, 5_000),
      ],
    });
    expect(getVideoRuntimeActiveVisualClipIds(ir, 4_999)).toEqual(['outgoing']);
    expect(getVideoRuntimeActiveVisualClipIds(ir, 5_000)).toEqual(['incoming']);
    expect(getVideoRuntimeActiveVisualClipIds(ir, 10_000)).toEqual(['incoming']);
  });

  it('keeps per-clip stream selection deterministic when clips share one source', () => {
    const clips = [
      { ...visual('stream-zero', 'multi-stream', 0, 5_000), videoStreamIndex: 0 },
      { ...visual('stream-two', 'multi-stream', 5_000, 5_000), videoStreamIndex: 2 },
    ];
    const first = compile({ visualClips: clips });
    const second = compile({ visualClips: [...clips].reverse() });
    expect(hashVideoRuntimeIr(first)).toBe(hashVideoRuntimeIr(second));
    expect(first.sources[0]?.streams.video).toEqual([0, 2]);
    expect(first.visualClips.map((clip) => clip.streamIndex)).toEqual([0, 2]);
    expect(first.requiredCapabilities).toContain('runtime:stream-selection');
  });

  it('requires executable capabilities for retime, managed color, and non-default audio routing', () => {
    const professionalState = {
      version: 1 as const,
      proxyPlaybackEnabled: true,
      tracks: [],
      sequences: [],
      multicamSources: [],
      audioBuses: [{
        id: 'dialogue',
        name: 'Dialogue',
        kind: 'submix' as const,
        gainDb: -1,
        muted: false,
        solo: false,
      }],
      loudnessNormalization: {
        enabled: false,
        targetLufs: -14,
        loudnessRangeLu: 7,
        truePeakCeilingDbtp: -1,
      },
      workingColorSpace: 'rec2020-pq' as const,
      toneMapping: 'hdr-to-sdr' as const,
      adjustmentLayerClipIds: [],
      transcriptRemovedCueIds: [],
      interchangeHistory: [],
    };
    const ir = compile({
      professionalState,
      visualClips: [visual('retimed', 'source-a', 0, 5_000, {
        professional: {
          retime: [{
            id: 'ramp',
            timelineStartMs: 0,
            timelineEndMs: 5_000,
            speedPercent: 75,
            interpolation: 'blend',
          }],
        },
      })],
      audioClips: [{
        clip: {
          id: 'dialogue',
          sourceNodeId: 'dialogue-source',
          sourceKind: 'audio',
          trackIndex: 0,
          offsetMs: 0,
          enabled: true,
          professional: { pan: 0.25, busId: 'dialogue' },
        },
        durationMs: 5_000,
      }],
    });
    expect(ir.requiredCapabilities).toEqual(expect.arrayContaining([
      'runtime:audio-routing',
      'runtime:color-management',
      'runtime:retime',
      'zscale',
    ]));
    expect(compileVideoRuntimeAdapterPlan(ir, { target: 'export' }).ok).toBe(false);
  });

  it('requires audio-processing only when a DSP stage is actually enabled', () => {
    const neutralProcessing = {
      processingEnabled: true,
      highPassEnabled: false,
      highPassHz: 80,
      lowPassEnabled: false,
      lowPassHz: 18_000,
      gateEnabled: false,
      gateThresholdDbfs: -45,
      gateRangeDb: -24,
      gateRatio: 3,
      gateAttackMs: 5,
      gateReleaseMs: 150,
      compressorEnabled: false,
      compressorThresholdDbfs: -18,
      compressorRatio: 3,
      compressorAttackMs: 10,
      compressorReleaseMs: 120,
      compressorMakeupGainDb: 0,
      limiterEnabled: false,
      limiterCeilingDbfs: -1,
      limiterReleaseMs: 50,
    };
    const audioClip = (audioProcessing: typeof neutralProcessing) => ({
      clip: {
        id: 'dialogue',
        sourceNodeId: 'dialogue-source',
        sourceKind: 'audio' as const,
        trackIndex: 0,
        offsetMs: 0,
        enabled: true,
        audioProcessing,
      },
      durationMs: 1_000,
    });

    const neutral = compile({ audioClips: [audioClip(neutralProcessing)] });
    const filtered = compile({
      audioClips: [audioClip({ ...neutralProcessing, highPassEnabled: true })],
    });

    expect(neutral.requiredCapabilities).not.toContain('runtime:audio-processing');
    expect(filtered.requiredCapabilities).toContain('runtime:audio-processing');
  });

  it('binds render cache identity to IR, worker capabilities, sources, and settings', () => {
    const ir = compile();
    const base = buildVideoRuntimeCacheKey(ir, {
      workerCapabilityFingerprint: 'ffmpeg-build-a',
      sourceDigests: { 'source-a': 'sha256:a' },
      renderSettings: { codec: 'h264', width: 1920 },
    });
    expect(buildVideoRuntimeCacheKey(ir, {
      workerCapabilityFingerprint: 'ffmpeg-build-b',
      sourceDigests: { 'source-a': 'sha256:a' },
      renderSettings: { width: 1920, codec: 'h264' },
    })).not.toBe(base);
    expect(buildVideoRuntimeCacheKey(ir, {
      workerCapabilityFingerprint: 'ffmpeg-build-a',
      sourceDigests: { 'source-a': 'sha256:b' },
      renderSettings: { codec: 'h264', width: 1920 },
    })).not.toBe(base);
    expect(buildVideoRuntimeCacheKey(ir, {
      workerCapabilityFingerprint: 'ffmpeg-build-a',
      sourceDigests: { 'source-a': 'sha256:a' },
      renderSettings: { width: 1920, codec: 'h264' },
    })).toBe(base);
  });

  it('rejects duplicate timeline ids, direct nesting cycles, and invalid timing', () => {
    const result = compileVideoRuntimeIr({
      sequenceId: 'sequence-main',
      canvas: { width: 1920, height: 1080 },
      durationMs: 10_000,
      frameRate: 30,
      visualClips: [visual('duplicate', 'source-a', 0, 5_000, {
        sourceKind: 'composition',
        professional: { nestedSequenceId: 'sequence-main' },
      })],
      audioClips: [{
        clip: {
          id: 'duplicate',
          sourceNodeId: 'audio-a',
          sourceKind: 'audio',
          trackIndex: 0,
          offsetMs: 0,
        },
        durationMs: -1,
      }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(/Duplicate timeline clip id 'duplicate'/u);
    expect(result.errors.join('\n')).toMatch(/direct sequence cycle/u);
    expect(result.errors.join('\n')).toMatch(/audio clip 'duplicate' duration is outside/u);
  });

  it('carries stream selection, color, routing, caption, and generator semantics', () => {
    const ir = compile({
      visualClips: [{
        ...visual('title', 'title-source', 0, 2_000, {
          sourceKind: 'text',
          textContent: 'Hello',
          textFontFamily: 'Inter',
          textSizePx: 64,
          professional: {
            color: {
              exposureStops: 1,
              contrast: 1,
              temperature: 0,
              tint: 0,
              saturation: 1,
              lift: [0, 0, 0],
              gamma: [1, 1, 1],
              gain: [1, 1, 1],
            },
          },
        }),
        videoStreamIndex: 2,
      }],
      audioClips: [{
        clip: {
          id: 'dialogue',
          sourceNodeId: 'source-dialogue',
          sourceKind: 'audio',
          trackIndex: 1,
          offsetMs: 1_000,
          volumePercent: 80,
          enabled: true,
          professional: { pan: -0.25, busId: 'dialogue', channelMap: [1, 0] },
        },
        durationMs: 3_000,
        sourceInMs: 500,
        sourceOutMs: 3_500,
        audioStreamIndex: 3,
      }],
      captionTracks: [{
        id: 'captions-en',
        name: 'English',
        language: 'en',
        service: 'captions',
        style: {
          fontFamily: 'Inter',
          fontSizePx: 48,
          textColor: '#fff',
          backgroundOpacityPercent: 50,
          safeAreaPercent: 10,
        },
        cues: [{ id: 'cue-1', startMs: 1_000, endMs: 2_000, text: 'Hello', position: 'bottom' }],
      }],
    });
    expect(ir.visualClips[0]).toMatchObject({
      streamIndex: 2,
      role: 'generator',
      generator: { kind: 'text', parameters: { text: 'Hello' } },
      color: { exposureStops: 1 },
    });
    expect(ir.audioClips[0]).toMatchObject({
      streamIndex: 3,
      routing: { pan: -0.25, busId: 'dialogue', channelMap: [1, 0] },
    });
    expect(ir.captionTracks[0]?.cues[0]).toMatchObject({ text: 'Hello', position: 'bottom' });
    expect(ir.requiredCapabilities).toContain('runtime:captions');
    expect(ir.requiredCapabilities).toContain('runtime:color-correction');
  });
});

describe('Video Runtime IR invalidation', () => {
  it('invalidates only lower-track intersections for an adjustment-layer change', () => {
    const baseVisuals = [
      visual('base-a', 'source-a', 0, 4_000),
      visual('base-b', 'source-b', 6_000, 4_000),
      visual('adjustment', 'adjustment-source', 2_000, 6_000, {
        sourceKind: 'shape',
        trackIndex: 1,
        professional: { adjustmentLayer: true },
        filterStack: [{ id: 'contrast', kind: 'contrast', amount: 10, enabled: true }],
      }),
    ];
    const previous = compile({ visualClips: baseVisuals });
    const next = compile({
      visualClips: baseVisuals.map((entry) => entry.clip.id === 'adjustment'
        ? {
          ...entry,
          clip: {
            ...entry.clip,
            filterStack: [{ id: 'contrast', kind: 'contrast', amount: 20, enabled: true }],
          },
        }
        : entry),
    });
    expect(diffVideoRuntimeIr(previous, next).ranges).toEqual([
      {
        startMs: 2_000,
        endMs: 4_000,
        reasons: ['visual clip changed'],
        entityIds: ['adjustment'],
      },
      {
        startMs: 6_000,
        endMs: 8_000,
        reasons: ['visual clip changed'],
        entityIds: ['adjustment'],
      },
    ]);

    const initialPlan = buildVideoRuntimeRenderDirtyPlan({
      ir: previous,
      previousSegmentSignatures: {},
      workerCapabilityFingerprint: 'worker-a',
    });
    const nextPlan = buildVideoRuntimeRenderDirtyPlan({
      ir: next,
      previousSegmentSignatures: initialPlan.segmentSignatures,
      workerCapabilityFingerprint: 'worker-a',
    });
    expect(nextPlan.dirtySegments.map(({ startMs, endMs }) => ({ startMs, endMs }))).toEqual([
      { startMs: 2_000, endMs: 4_000 },
      { startMs: 6_000, endMs: 8_000 },
    ]);
  });

  it('projects exact child dirty ranges through forward and reverse nested references', () => {
    const forward = compile({
      durationMs: 20_000,
      visualClips: [visual('nested', 'child-sequence', 10_000, 5_000, {
        sourceKind: 'composition',
        sourceInMs: 0,
        sourceOutMs: 5_000,
        professional: { nestedSequenceId: 'child-sequence' },
      })],
    });
    expect(projectVideoRuntimeNestedInvalidation(forward, 'child-sequence', [{ startMs: 1_000, endMs: 2_000 }]))
      .toEqual([{
        startMs: 11_000,
        endMs: 12_000,
        reasons: ["nested sequence 'child-sequence' changed"],
        entityIds: ['nested'],
      }]);

    const reverse = compile({
      durationMs: 20_000,
      visualClips: [visual('nested', 'child-sequence', 10_000, 5_000, {
        sourceKind: 'composition',
        sourceInMs: 0,
        sourceOutMs: 5_000,
        reversePlayback: true,
        professional: { nestedSequenceId: 'child-sequence' },
      })],
    });
    expect(projectVideoRuntimeNestedInvalidation(reverse, 'child-sequence', [{ startMs: 1_000, endMs: 2_000 }])[0])
      .toMatchObject({ startMs: 13_000, endMs: 14_000 });
  });

  it('uses localized child invalidation when only a nested revision changes', () => {
    const nestedClip = visual('nested', 'child-sequence', 10_000, 5_000, {
      sourceKind: 'composition',
      sourceInMs: 0,
      sourceOutMs: 5_000,
      professional: { nestedSequenceId: 'child-sequence' },
    });
    const previous = compile({
      durationMs: 20_000,
      visualClips: [nestedClip],
      nestedSequenceRevisions: { 'child-sequence': 'revision-a' },
    });
    const next = compile({
      durationMs: 20_000,
      visualClips: [nestedClip],
      nestedSequenceRevisions: { 'child-sequence': 'revision-b' },
    });
    expect(diffVideoRuntimeIr(previous, next, {
      nestedInvalidations: [{ sequenceId: 'child-sequence', ranges: [{ startMs: 1_000, endMs: 2_000 }] }],
    }).ranges).toEqual([{
      startMs: 11_000,
      endMs: 12_000,
      reasons: ["nested sequence 'child-sequence' changed"],
      entityIds: ['nested'],
    }]);
  });

  it('produces no ranges for structurally equal revisions', () => {
    const ir = compile();
    expect(diffVideoRuntimeIr(ir, structuredClone(ir))).toMatchObject({
      ranges: [],
      changedEntityIds: [],
      totalDirtyDurationMs: 0,
    });
  });

  it('invalidates every cache span when the worker capability fingerprint changes', () => {
    const ir = compile({
      audioClips: [{
        clip: {
          id: 'audio-only',
          sourceNodeId: 'audio-source',
          sourceKind: 'audio',
          trackIndex: 0,
          offsetMs: 5_000,
          enabled: true,
        },
        durationMs: 2_000,
      }],
    });
    const first = buildVideoRuntimeRenderDirtyPlan({
      ir,
      previousSegmentSignatures: {},
      workerCapabilityFingerprint: 'worker-a',
    });
    const same = buildVideoRuntimeRenderDirtyPlan({
      ir,
      previousSegmentSignatures: first.segmentSignatures,
      workerCapabilityFingerprint: 'worker-a',
    });
    const changed = buildVideoRuntimeRenderDirtyPlan({
      ir,
      previousSegmentSignatures: first.segmentSignatures,
      workerCapabilityFingerprint: 'worker-b',
    });
    expect(same.dirtySegments).toEqual([]);
    expect(changed.dirtySegments).toHaveLength(first.segments.length);
    expect(first.segments.some((segment) => segment.activeClipIds.includes('audio-only'))).toBe(true);
  });
});
