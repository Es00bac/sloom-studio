import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import { composeSequenceMedia } from './mediaComposition';
import { renderStageFrameSequence } from './stageFrameExport';
import type { ManualEditorVisualSequenceClip } from './manualEditorSequence';
import type { AppNode, RuntimeSettingsSnapshot, VideoRenderAssemblyManifestData } from '../types/flow';

vi.mock('./mediaComposition', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mediaComposition')>();
  return {
    ...actual,
    composeSequenceMedia: vi.fn(),
  };
});

// The frame-server export (stageFrameExport.ts) is tried BEFORE the legacy path this test exercises
// (see flowExecution.ts's `executeCompositionNode`). It's DOM-dependent (canvas/Image/<video>), and
// this test file runs in a non-DOM environment, so it's mocked to return `null` — the engine's own
// "not applicable here, fall back to legacy" signal — exactly like it would when no native render
// service is reachable, letting this test exercise the (mocked) legacy metadata passthrough as before.
vi.mock('./stageFrameExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./stageFrameExport')>();
  return {
    ...actual,
    renderStageFrameSequence: vi.fn().mockResolvedValue(null),
  };
});

const mockedComposeSequenceMedia = vi.mocked(composeSequenceMedia);
const mockedRenderStageFrameSequence = vi.mocked(renderStageFrameSequence);

const settings = {
  apiKeys: {},
  defaultModels: {},
  providerSettings: {
    renderBackendPreference: 'native-cpu',
    localNativeRenderUrl: 'http://127.0.0.1:41736',
    batchMaxRetries: 0,
    batchRetryBaseDelayMs: 1,
  },
} as RuntimeSettingsSnapshot;

const compositionNode = {
  id: 'composition-1',
  type: 'composition',
  position: { x: 0, y: 0 },
  data: {},
} as AppNode;

const visualClip = {
  sourceNodeId: 'clip-dirty',
  sourceKind: 'image',
  trackIndex: 0,
  startMs: 0,
  assetUrl: 'data:image/png;base64,UE5H',
  sourceInMs: 0,
  durationSeconds: 2,
  trimStartMs: 0,
  trimEndMs: 0,
  playbackRate: 1,
  reversePlayback: false,
  fitMode: 'contain',
  scalePercent: 100,
  scaleMotionEnabled: false,
  endScalePercent: 100,
  opacityPercent: 100,
  rotationDeg: 0,
  rotationMotionEnabled: false,
  endRotationDeg: 0,
  flipHorizontal: false,
  flipVertical: false,
  positionX: 0,
  positionY: 0,
  motionEnabled: false,
  endPositionX: 0,
  endPositionY: 0,
  cropLeftPercent: 0,
  cropRightPercent: 0,
  cropTopPercent: 0,
  cropBottomPercent: 0,
  cropPanXPercent: 0,
  cropPanYPercent: 0,
  cropRotationDeg: 0,
  filterStack: [],
  blendMode: 'normal',
  transitionIn: 'none',
  transitionOut: 'none',
  transitionDurationMs: 0,
  textFontFamily: 'Inter, system-ui, sans-serif',
  textSizePx: 64,
  textColor: '#f3f4f6',
  textEffect: 'shadow',
  textBackgroundOpacityPercent: 0,
} satisfies ManualEditorVisualSequenceClip;

describe('executeNodeRequest composition metadata', () => {
  beforeEach(() => {
    mockedComposeSequenceMedia.mockReset();
    mockedRenderStageFrameSequence.mockReset().mockResolvedValue(null);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sequence-output');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails closed before either compositor can render a rejected nested or adjustment plan', async () => {
    await expect(executeNodeRequest(
      compositionNode,
      {
        prompt: '',
        config: DEFAULT_EXECUTION_CONFIG,
        videoRuntimeError: 'Nested sequence cycle refused: intro → intro.',
      },
      settings,
    )).rejects.toThrow('Video Runtime IR refused this monitor/export plan');

    expect(mockedRenderStageFrameSequence).not.toHaveBeenCalled();
    expect(mockedComposeSequenceMedia).not.toHaveBeenCalled();
  });

  it('keeps native segment artifacts on composition output metadata', async () => {
    const segmentArtifacts = [
      {
        key: '1000-2000',
        signature: 'sig-dirty',
        startMs: 1000,
        endMs: 2000,
        fileName: 'segment-1000-2000.mp4',
        mimeType: 'video/mp4',
        base64: 'AQID',
      },
    ];
    const nativeAssemblyManifest = {
      version: 1,
      kind: 'video-render-segment-assembly',
      mode: 'safe-artifact-assembly',
      segments: [
        {
          key: '1000-2000',
          startMs: 1000,
          endMs: 2000,
          activeClipIds: ['clip-dirty'],
          signature: 'sig-dirty',
          action: 'render-dirty-span',
          reason: 'timeline span changed',
        },
      ],
    } satisfies VideoRenderAssemblyManifestData;
    mockedComposeSequenceMedia.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }),
      mimeType: 'video/mp4',
      extension: 'mp4',
      fileName: 'sequence-output.mp4',
      renderBackend: 'cpu',
      segmentArtifacts,
      assemblyResult: {
        assembledFromSegments: false,
        assemblyUnavailableReason: 'Cached segment 0-1000 must be a materialized data URL for native assembly.',
      },
    });

    const result = await executeNodeRequest(
      compositionNode,
      {
        prompt: '',
        config: DEFAULT_EXECUTION_CONFIG,
        visualSequenceClips: [visualClip],
        sequenceAudioInputs: [],
        nativeAssemblyManifest,
      },
      settings,
    );

    expect(result.outputMetadata).toEqual({
      segmentArtifacts,
      assemblyResult: {
        assembledFromSegments: false,
        assemblyUnavailableReason: 'Cached segment 0-1000 must be a materialized data URL for native assembly.',
      },
    });
    expect(result.blob).toBeInstanceOf(Blob);
    expect(mockedComposeSequenceMedia).toHaveBeenCalledWith(expect.objectContaining({
      nativeAssemblyManifest,
    }));
  });

  it('passes one persisted bounded mixer state to both stage-frame and fallback sequence export', async () => {
    const audioMixerBuses = [
      { id: 'master', name: 'Master', kind: 'master' as const, gainDb: 0, pan: 0, muted: false, solo: false },
      { id: 'dialogue', name: 'Dialogue', kind: 'submix' as const, outputBusId: 'master', gainDb: -3, pan: 0.25, muted: false, solo: false },
    ];
    mockedComposeSequenceMedia.mockResolvedValue({
      blob: new Blob([new Uint8Array([1])], { type: 'video/mp4' }),
      mimeType: 'video/mp4', extension: 'mp4', fileName: 'sequence-output.mp4', renderBackend: 'cpu',
    });

    await executeNodeRequest(
      compositionNode,
      {
        prompt: '', config: DEFAULT_EXECUTION_CONFIG, visualSequenceClips: [visualClip],
        sequenceAudioInputs: [], sequenceAudioMixerBuses: audioMixerBuses,
      },
      settings,
    );

    expect(mockedRenderStageFrameSequence).toHaveBeenCalledWith(expect.objectContaining({ audioMixerBuses }));
    expect(mockedComposeSequenceMedia).toHaveBeenCalledWith(expect.objectContaining({ audioMixerBuses }));
  });

  it('cancels an in-flight mixer export before any composition result can publish', async () => {
    let resolveRender!: (value: Awaited<ReturnType<typeof composeSequenceMedia>>) => void;
    const pendingRender = new Promise<Awaited<ReturnType<typeof composeSequenceMedia>>>((resolve) => { resolveRender = resolve; });
    mockedComposeSequenceMedia.mockReturnValueOnce(pendingRender);
    const controller = new AbortController();
    const request = executeNodeRequest(
      compositionNode,
      {
        prompt: '', config: DEFAULT_EXECUTION_CONFIG, visualSequenceClips: [visualClip], sequenceAudioInputs: [],
        sequenceAudioMixerBuses: [{ id: 'master', name: 'Master', kind: 'master', gainDb: 0, pan: 0, muted: false, solo: false }],
      },
      { ...settings, providerSettings: { ...settings.providerSettings, exportCompositorPreference: 'legacy' } },
      undefined,
      { signal: controller.signal },
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockedComposeSequenceMedia).toHaveBeenCalledTimes(1);
    resolveRender({
      blob: new Blob([new Uint8Array([1])], { type: 'video/mp4' }),
      mimeType: 'video/mp4', extension: 'mp4', fileName: 'late.mp4', renderBackend: 'cpu',
    });
    await pendingRender;
  });

  it('publishes a feature-length native file reference without creating an output Blob URL', async () => {
    mockedComposeSequenceMedia.mockResolvedValue({
      nativeFilePath: '/project/movie.sloom-scratch/sequence-output-render-42.mp4',
      mimeType: 'video/mp4',
      extension: 'mp4',
      fileName: 'sequence-output-render-42.mp4',
      renderBackend: 'cpu',
    });

    const result = await executeNodeRequest(
      compositionNode,
      {
        prompt: '',
        config: DEFAULT_EXECUTION_CONFIG,
        visualSequenceClips: [{ ...visualClip, durationSeconds: 2 * 60 * 60 }],
        sequenceAudioInputs: [],
        nativeOutputDirectoryPath: '/project/movie.sloom-scratch',
      },
      settings,
    );

    expect(result).toMatchObject({
      result: '/project/movie.sloom-scratch/sequence-output-render-42.mp4',
      nativeFilePath: '/project/movie.sloom-scratch/sequence-output-render-42.mp4',
      resultType: 'video',
    });
    expect(result.blob).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(mockedComposeSequenceMedia).toHaveBeenCalledWith(expect.objectContaining({
      nativeOutputDirectoryPath: '/project/movie.sloom-scratch',
    }));
  });

  it('passes an explicit saved loudness intent to render and reports only completed measured delivery', async () => {
    mockedComposeSequenceMedia.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }),
      mimeType: 'video/mp4', extension: 'mp4', fileName: 'sequence-output.mp4', renderBackend: 'cpu',
    });
    const loudnessNormalization = { enabled: true, targetLufs: -14, loudnessRangeLu: 7, truePeakCeilingDbtp: -1 };

    const result = await executeNodeRequest(compositionNode, {
      prompt: '', config: DEFAULT_EXECUTION_CONFIG, visualSequenceClips: [visualClip], sequenceAudioInputs: [],
      sequenceLoudnessNormalization: loudnessNormalization,
    }, settings);

    expect(mockedComposeSequenceMedia).toHaveBeenCalledWith(expect.objectContaining({ loudnessNormalization }));
    expect(result.statusMessage).toContain('Final mix normalized by measured two-pass FFmpeg loudnorm to -14 LUFS and -1 dBTP.');
  });

  it('does NOT retry a failed render, even when batchMaxRetries allows many retries for other node types', async () => {
    // Regression test for the incident where a killed local render service auto-resurrected: the
    // generic exponential-backoff retry (src/lib/exponentialBackoff.ts, wired in
    // executeNodeRequest) is meant for flaky AI provider APIs, not a local, deterministic,
    // operator-cancellable render. `batchMaxRetries` is set high here deliberately — if composition
    // nodes were still routed through that wrapper, this failure would be retried many times before
    // the caller ever saw it.
    const retryableSettings = {
      ...settings,
      providerSettings: {
        ...settings.providerSettings,
        batchMaxRetries: 10,
        batchRetryBaseDelayMs: 1,
      },
    } as RuntimeSettingsSnapshot;
    const renderFailure = new Error('The local native render service is unavailable at http://127.0.0.1:41736.');
    mockedComposeSequenceMedia.mockRejectedValue(renderFailure);

    await expect(executeNodeRequest(
      compositionNode,
      {
        prompt: '',
        config: DEFAULT_EXECUTION_CONFIG,
        visualSequenceClips: [visualClip],
        sequenceAudioInputs: [],
      },
      retryableSettings,
    )).rejects.toThrow(renderFailure.message);

    expect(mockedRenderStageFrameSequence).toHaveBeenCalledTimes(1);
    expect(mockedComposeSequenceMedia).toHaveBeenCalledTimes(1);
  });

  it('routes an approved embedded-caption plan to the legacy final mux and reports its bounded styling boundary', async () => {
    mockedComposeSequenceMedia.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }),
      mimeType: 'video/mp4', extension: 'mp4', fileName: 'sequence-output.mp4', renderBackend: 'cpu',
    });
    const captionEmbedding = {
      format: 'mov_text' as const,
      inputName: 'sequence-embedded-captions.srt' as const,
      srt: '1\n00:00:00,000 --> 00:00:01,000\nCaption\n',
      language: 'eng', trackId: 'english', cueCount: 1,
      styleBoundary: 'plain-timing-and-text-only' as const,
    };

    const result = await executeNodeRequest(
      compositionNode,
      {
        prompt: '', config: DEFAULT_EXECUTION_CONFIG, visualSequenceClips: [visualClip], sequenceAudioInputs: [],
        captionEmbedding: { ok: true, value: captionEmbedding },
      },
      { ...settings, providerSettings: { ...settings.providerSettings, exportCompositorPreference: 'stage' } } as RuntimeSettingsSnapshot,
    );

    expect(mockedRenderStageFrameSequence).toHaveBeenCalledWith(expect.objectContaining({ captionEmbedding }));
    expect(mockedComposeSequenceMedia).toHaveBeenCalledWith(expect.objectContaining({ captionEmbedding }));
    expect(result.statusMessage).toContain('Embedded 1 plain timed-text cue as one mov_text track');
    expect(result.statusMessage).toContain('styling is not encoded');
  });
});
