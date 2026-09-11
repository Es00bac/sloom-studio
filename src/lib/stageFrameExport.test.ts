import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedBundledFontFaceReference } from '../types/managedFont';
import type { ComposeSequenceVisualClip } from './mediaComposition';
import { renderTextCard } from './mediaComposition';
import { getVideoExportPresetOption } from './videoPremiereParity';
import { createEditorVisualClip } from './manualEditorState';
import { buildVideoRenderClipSignature } from './videoRenderSegments';
import { bundledFontFaceRuntimeFamilyName } from './bundledFontLibrary';
import {
  computeStageFrameCount,
  computeStageFrameTimestamps,
  renderStageFrameSequence,
  buildDirectNativeVideoRenderPlan,
  buildStageFrameStreamMiddleArgs,
  applyStageFrameAdjustmentLayer,
  resolveStageFrameTextClipDimensions,
  supportsStageFrameExportDuration,
} from './stageFrameExport';

const fontRegistration = vi.hoisted(() => ({
  ensure: vi.fn<(...args: unknown[]) => Promise<unknown>>(
    () => Promise.resolve({ ready: true, registeredFaceIds: [], registeredIdentities: [] }),
  ),
}));

vi.mock('./bundledFontLibrary', async (importOriginal) => ({
  ...await importOriginal<typeof import('./bundledFontLibrary')>(),
  ensureBundledFontDependenciesReady: fontRegistration.ensure,
}));

function managedReference(): ManagedBundledFontFaceReference {
  return {
    kind: 'bundled',
    schemaVersion: 2,
    faceId: 'same-name-oblique-530',
    family: 'Same Named Family',
    weight: 530,
    style: 'oblique',
    stretchPercent: 82,
    collectionIndex: 0,
    sha256: 'a'.repeat(64),
    byteLength: 1234,
  };
}

function textClip(reference = managedReference()): ComposeSequenceVisualClip {
  return {
    sourceNodeId: 'title',
    sourceKind: 'text',
    trackIndex: 0,
    startMs: 0,
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
    transitionIn: 'none',
    transitionOut: 'none',
    transitionDurationMs: 0,
    textContent: 'Metric proof',
    textFontFamily: 'Same Named Family, sans-serif',
    textSizePx: 64,
    textColor: '#ffffff',
    textEffect: 'none',
    textBackgroundOpacityPercent: 0,
    textTypography: {
      fontWeight: reference.weight,
      fontStyle: reference.style,
      managedFace: reference,
      fontKerning: 'none',
      lineHeightPercent: 137,
      letterSpacingPx: 3.5,
      textAlign: 'center',
    },
  };
}

function untouchedVideoClip(overrides: Partial<ComposeSequenceVisualClip> = {}): ComposeSequenceVisualClip {
  return {
    sourceNodeId: 'camera-a',
    sourceKind: 'video',
    trackIndex: 0,
    startMs: 0,
    assetUrl: 'signal-loom-asset://asset/camera-a',
    nativeFilePath: '/media/camera-a.mp4',
    sourceInMs: 0,
    sourceOutMs: 10_000,
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
    textFontFamily: 'Inter',
    textSizePx: 64,
    textColor: '#ffffff',
    textEffect: 'none',
    textBackgroundOpacityPercent: 0,
    ...overrides,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('computeStageFrameCount (deterministic stepper)', () => {
  it('is ceil(duration * fps)', () => {
    expect(computeStageFrameCount(2, 30)).toBe(60);
    expect(computeStageFrameCount(2.5, 30)).toBe(75);
    // 2.51 * 30 = 75.3 -> ceil = 76, not a round 75 -- proves this isn't just duration*fps truncated.
    expect(computeStageFrameCount(2.51, 30)).toBe(76);
    expect(computeStageFrameCount(1, 24)).toBe(24);
    expect(computeStageFrameCount(1 / 3, 60)).toBe(20);
  });

  it('floors at 1 frame for a zero or negative duration (never an empty/invalid render)', () => {
    expect(computeStageFrameCount(0, 30)).toBe(1);
    expect(computeStageFrameCount(-5, 30)).toBe(1);
  });

  it('defaults a non-finite or non-positive fps to 30', () => {
    expect(computeStageFrameCount(2, 0)).toBe(computeStageFrameCount(2, 30));
    expect(computeStageFrameCount(2, -10)).toBe(computeStageFrameCount(2, 30));
    expect(computeStageFrameCount(2, Number.NaN)).toBe(computeStageFrameCount(2, 30));
  });

  it('has no wall-clock dependence: identical inputs always produce identical output regardless of "now"', () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    const performanceNowSpy = vi.spyOn(performance, 'now');

    try {
      dateNowSpy.mockReturnValue(1_000);
      const first = computeStageFrameCount(2.7, 25);
      const firstTimestamps = computeStageFrameTimestamps(2.7, 25);

      dateNowSpy.mockReturnValue(999_999_999);
      performanceNowSpy.mockReturnValue(123_456);
      const second = computeStageFrameCount(2.7, 25);
      const secondTimestamps = computeStageFrameTimestamps(2.7, 25);

      expect(second).toBe(first);
      expect(secondTimestamps).toEqual(firstTimestamps);
    } finally {
      dateNowSpy.mockRestore();
      performanceNowSpy.mockRestore();
    }
  });
});

describe('computeStageFrameTimestamps (deterministic stepper)', () => {
  it('produces t = n / fps for every n in [0, frameCount)', () => {
    const timestamps = computeStageFrameTimestamps(1, 4);
    expect(timestamps).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('array length always matches computeStageFrameCount for the same inputs', () => {
    for (const [duration, fps] of [[2, 30], [2.5, 30], [2.51, 30], [1, 24], [0, 30]] as const) {
      expect(computeStageFrameTimestamps(duration, fps)).toHaveLength(computeStageFrameCount(duration, fps));
    }
  });

  it('never produces a timestamp at or beyond the total duration', () => {
    for (const [duration, fps] of [[2.51, 30], [0.1, 3], [10 / 3, 29.97]] as const) {
      const timestamps = computeStageFrameTimestamps(duration, fps);
      for (const timestamp of timestamps) {
        expect(timestamp).toBeLessThan(duration + 1e-9);
      }
    }
  });

  it('is independent of requestAnimationFrame / any timer callback ever firing', () => {
    // No rAF/setTimeout stub is installed at all — if the stepper secretly depended on either, this
    // test would hang or throw ReferenceError in this environment rather than returning synchronously.
    const timestamps = computeStageFrameTimestamps(3, 30);
    expect(timestamps).toHaveLength(90);
  });
});

describe('stage-frame export duration routing', () => {
  it('routes feature-length sequences away from per-frame RGBA browser compositing', () => {
    expect(supportsStageFrameExportDuration((30 * 60) - 0.001)).toBe(true);
    expect(supportsStageFrameExportDuration(30 * 60)).toBe(false);
    expect(supportsStageFrameExportDuration(2 * 60 * 60)).toBe(false);
  });

  it('returns the explicit legacy-fallback signal for a validated caption mux instead of silently streaming video without it', async () => {
    await expect(renderStageFrameSequence({
      visualClips: [textClip()],
      audioTracks: [],
      captionEmbedding: {
        format: 'mov_text', inputName: 'sequence-embedded-captions.srt', srt: 'caption', language: 'eng',
        trackId: 'english', cueCount: 1, styleBoundary: 'plain-timing-and-text-only',
      },
    })).resolves.toBeNull();
  });
});

describe('direct native one-video fast path', () => {
  const common = {
    visualClipCount: 1,
    enabledAudioTrackCount: 0,
    stageObjectCount: 0,
    sourceWidth: 1280,
    sourceHeight: 720,
    sourceDurationSeconds: 10,
    clipDurationSeconds: 10,
    canvas: { width: 1920, height: 1080 },
    timelineDurationSeconds: 10,
    frameRate: 30,
    backend: 'amd-vaapi' as const,
    exportPreset: getVideoExportPresetOption('review-h264-1080p'),
  };

  it('uses the linked source directly with VAAPI scale and encode, never raw browser frames', () => {
    const plan = buildDirectNativeVideoRenderPlan({
      ...common,
      clip: untouchedVideoClip(),
    });

    expect(plan).not.toBeNull();
    expect(plan?.inputName).toBe('sequence-direct-video-source.mp4');
    expect(plan?.outputName).toBe('sequence-output.mp4');
    expect(plan?.command).toEqual(expect.arrayContaining([
      '-vaapi_device', '/dev/dri/renderD128',
      '-i', 'sequence-direct-video-source.mp4',
      '-vf', 'tpad=stop_mode=clone:stop_duration=10.000,format=nv12,hwupload,scale_vaapi=w=1920:h=1080:format=nv12:mode=hq:reset_sar=1',
      '-r', '30', '-t', '10.000', '-c:v', 'h264_vaapi',
    ]));
    expect(plan?.command).not.toContain('rawvideo');
    expect(plan?.command).not.toContain('-filter_complex');
    expect(plan?.command.some((entry) => entry.includes('color=c=black'))).toBe(false);
  });

  it('accepts the real untouched product defaults and an asset-backed import without a native path', () => {
    const productClip: ComposeSequenceVisualClip = {
      ...createEditorVisualClip('camera-a', 'video', { sourceInMs: 0, sourceOutMs: 10_000 }),
      assetUrl: 'signal-loom-asset://asset/camera-a',
      nativeFilePath: undefined,
    };
    const plan = buildDirectNativeVideoRenderPlan({ ...common, clip: productClip });

    expect(productClip.opacityAutomationPoints).toEqual([
      { timePercent: 0, valuePercent: 100 },
      { timePercent: 100, valuePercent: 100 },
    ]);
    expect(productClip.keyframes).toHaveLength(2);
    expect(plan).not.toBeNull();
  });

  it('refuses an explicit one-millisecond source-out trim even when it is shorter than one frame', () => {
    expect(buildDirectNativeVideoRenderPlan({
      ...common,
      clip: untouchedVideoClip({ sourceOutMs: 9_999, trimEndMs: 0 }),
    })).toBeNull();
  });

  it('refuses compound, edited, non-native, and aspect-changing timelines', () => {
    expect(buildDirectNativeVideoRenderPlan({ ...common, clip: untouchedVideoClip(), visualClipCount: 2 })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({ ...common, clip: untouchedVideoClip(), enabledAudioTrackCount: 1 })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({ ...common, clip: untouchedVideoClip(), stageObjectCount: 1 })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({ ...common, clip: untouchedVideoClip({ positionX: 1 }) })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({ ...common, clip: untouchedVideoClip({ sourceInMs: 1 }) })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({ ...common, clip: untouchedVideoClip({ trimStartMs: 1 }) })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({ ...common, clip: untouchedVideoClip({ trimEndMs: 1 }) })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({
      ...common,
      clip: untouchedVideoClip({ opacityAutomationPoints: [{ timePercent: 50, valuePercent: 90 }] }),
    })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({
      ...common,
      clip: untouchedVideoClip({
        keyframes: [{ timePercent: 50, positionX: 1, positionY: 0, scalePercent: 100, rotationDeg: 0, opacityPercent: 100 }],
      }),
    })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({
      ...common,
      clip: untouchedVideoClip({
        professional: {
          retime: [{ id: 'ramp', timelineStartMs: 0, timelineEndMs: 10_000, speedPercent: 50, interpolation: 'blend' }],
        },
      }),
    })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({
      ...common,
      clip: untouchedVideoClip({ filterStack: [{ id: 'mono', kind: 'grayscale', amount: 100, enabled: true }] }),
    })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({ ...common, clip: untouchedVideoClip(), sourceWidth: 1919 })).toBeNull();
    expect(buildDirectNativeVideoRenderPlan({ ...common, clip: untouchedVideoClip(), backend: 'cpu' })).toBeNull();
  });
});

describe('native stage-frame wrapper command', () => {
  it('keeps the native MXF muxer, 4:2:2 filter, and PCM audio in the stage-frame route', () => {
    const { middleArgs } = buildStageFrameStreamMiddleArgs({
      backend: 'cpu',
      exportPreset: getVideoExportPresetOption('broadcast-mxf'),
      preparedAudioTracks: [{
        inputName: 'program.wav',
        sourceUrl: 'file:///program.wav',
        durationSeconds: 2,
        track: { url: 'file:///program.wav', sourceNodeId: 'audio-1', sourceKind: 'audio', offsetMs: 0, trackIndex: 0, volumePercent: 100, enabled: true },
      }],
      timelineDurationSeconds: 2,
    });

    expect(middleArgs).toEqual(expect.arrayContaining(['-vf', 'format=yuv422p', '-c:v', 'mpeg2video', '-c:a', 'pcm_s24le', '-ar', '48000', '-f', 'mxf']));
  });
});

describe('stage-frame adjustment passes', () => {
  it('filters the accumulated lower canvas and never resolves an adjustment source bitmap', () => {
    const snapshotContext = { drawImage: vi.fn() };
    const snapshot = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => snapshotContext),
    };
    const originalDocument = globalThis.document;
    vi.stubGlobal('document', { createElement: vi.fn(() => snapshot) });
    const context = {
      canvas: { width: 1280, height: 720 },
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      filter: 'none',
    } as unknown as CanvasRenderingContext2D;

    try {
      applyStageFrameAdjustmentLayer(context, {
        ...textClip(),
        runtimeRole: 'adjustment',
        filterStack: [{ id: 'monochrome', kind: 'grayscale', amount: 100, enabled: true }],
      });

      expect(snapshot.width).toBe(1280);
      expect(snapshot.height).toBe(720);
      expect(snapshotContext.drawImage).toHaveBeenCalledWith(context.canvas, 0, 0);
      expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1280, 720);
      expect(context.drawImage).toHaveBeenCalledWith(snapshot, 0, 0);
      expect(context.filter).toBe('grayscale(1)');
      expect(context.restore).toHaveBeenCalledOnce();
    } finally {
      vi.stubGlobal('document', originalDocument);
    }
  });
});

describe('native frame-export text pre-layout', () => {
  it('waits for registration and gives pre-layout/card paint the same exact alias and descriptors', async () => {
    const reference = managedReference();
    const alias = bundledFontFaceRuntimeFamilyName(reference);
    const clip = textClip(reference);
    const registration = deferred();
    fontRegistration.ensure.mockImplementationOnce(() => registration.promise);

    type FontSnapshot = {
      font: string;
      fontStretch: string;
      fontKerning: string;
      letterSpacing: string;
    };
    const measured: FontSnapshot[] = [];
    const painted: FontSnapshot[] = [];

    class TextContext {
      font = '';
      fontStretch = '';
      fontKerning = '';
      letterSpacing = '';
      fillStyle = '';
      strokeStyle = '';
      lineWidth = 0;
      lineJoin = 'round';
      textAlign = 'left';
      textBaseline = 'alphabetic';
      globalAlpha = 1;
      shadowColor = '';
      shadowBlur = 0;
      shadowOffsetX = 0;
      shadowOffsetY = 0;

      measureText() {
        measured.push(this.snapshot());
        // A same-named system face is deliberately much wider. Exact sizing must never observe it.
        return { width: this.font.includes(alias) ? 120 : 1200 };
      }

      fillText() { painted.push(this.snapshot()); }
      strokeText() { painted.push(this.snapshot()); }
      save() {}
      restore() {}
      translate() {}
      rotate() {}

      private snapshot(): FontSnapshot {
        return {
          font: this.font,
          fontStretch: this.fontStretch,
          fontKerning: this.fontKerning,
          letterSpacing: this.letterSpacing,
        };
      }
    }

    class TextCanvas {
      width = 0;
      height = 0;
      readonly context = new TextContext();
      getContext() { return this.context; }
      toDataURL() { return 'data:image/png;base64,exact'; }
    }

    const canvases: TextCanvas[] = [];
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        const canvas = new TextCanvas();
        canvases.push(canvas);
        return canvas;
      }),
    });

    const pendingDimensions = resolveStageFrameTextClipDimensions(clip);
    await Promise.resolve();
    expect(fontRegistration.ensure).toHaveBeenCalledWith([
      { reference },
    ]);
    expect(measured).toHaveLength(0);

    registration.resolve();
    const dimensions = await pendingDimensions;
    expect(measured.length).toBeGreaterThan(0);
    expect(dimensions.width).toBeLessThan(500);

    const card = await renderTextCard({
      text: clip.textContent ?? '',
      fontFamily: clip.textFontFamily,
      fontSizePx: clip.textSizePx,
      color: clip.textColor,
      effect: clip.textEffect,
      opacityPercent: 100,
      typography: clip.textTypography,
    });

    expect(card).toBe('data:image/png;base64,exact');
    expect(canvases.at(-1)).toMatchObject({ width: dimensions.width, height: dimensions.height });
    const expectedFont = `oblique 530 64px "${alias}"`;
    expect(measured.every((entry) => entry.font === expectedFont)).toBe(true);
    expect(measured.every((entry) => entry.fontStretch === 'semi-condensed')).toBe(true);
    expect(measured.every((entry) => entry.fontKerning === 'none')).toBe(true);
    expect(measured.every((entry) => entry.letterSpacing === '3.5px')).toBe(true);
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.every((entry) => entry.font === expectedFont)).toBe(true);
    expect(painted.every((entry) => entry.fontStretch === 'semi-condensed')).toBe(true);
    expect(painted.every((entry) => entry.fontKerning === 'none')).toBe(true);
    expect(painted.every((entry) => entry.letterSpacing === '3.5px')).toBe(true);
    expect(measured.some((entry) => entry.font.includes('Same Named Family'))).toBe(false);

    const baseSignature = buildVideoRenderClipSignature(clip);
    const typography = clip.textTypography!;
    const metricVariants = [
      { ...typography, fontKerning: 'normal' as const },
      { ...typography, lineHeightPercent: 138 },
      { ...typography, letterSpacingPx: 4.5 },
      { ...typography, managedFace: { ...reference, weight: 531 }, fontWeight: 531 },
      { ...typography, managedFace: { ...reference, style: 'italic' as const }, fontStyle: 'italic' as const },
      { ...typography, managedFace: { ...reference, stretchPercent: 83 } },
    ];
    for (const variant of metricVariants) {
      expect(buildVideoRenderClipSignature({ ...clip, textTypography: variant })).not.toBe(baseSignature);
    }
  });

  it('keeps family-only legacy text honest and blocks a managed issue before sizing', async () => {
    const issue = {
      kind: 'bundled-font-issue' as const,
      reason: 'invalid-reference' as const,
      message: 'The exact face identity is malformed.',
      original: { family: 'Same Named Family' },
    };
    const clip = textClip();
    clip.textTypography = { managedFaceIssue: issue };
    fontRegistration.ensure.mockRejectedValueOnce(new Error(`${issue.message} Exact managed typography is blocked.`));

    await expect(resolveStageFrameTextClipDimensions(clip)).rejects.toThrow(/exact face identity is malformed/i);
    expect(fontRegistration.ensure).toHaveBeenCalledWith([{ issue }]);

    // Content that never claimed a managed identity remains a normal human-family request.
    const legacyClip = textClip();
    legacyClip.textTypography = { fontWeight: 500, fontStyle: 'italic' };
    await expect(resolveStageFrameTextClipDimensions(legacyClip)).resolves.toEqual(
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
  });
});

afterEach(() => {
  fontRegistration.ensure.mockReset();
  fontRegistration.ensure.mockResolvedValue({ ready: true, registeredFaceIds: [], registeredIdentities: [] });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
