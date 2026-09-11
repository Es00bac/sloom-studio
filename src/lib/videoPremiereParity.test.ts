import { describe, expect, it } from 'vitest';
import type { EditorVisualClip } from '../types/flow';
import {
  buildVideoSequenceSummary,
  buildVideoParityDiagnostics,
  getVideoExportPresetOption,
  getVideoExportPresetAvailability,
  getVideoExportPresetFrameRateAvailability,
  getHighPriorityVideoParityRows,
  getVideoMonitorParityNotices,
  VIDEO_EXPORT_PRESET_OPTIONS,
} from './videoPremiereParity';

function makeVisualClip(patch: Partial<EditorVisualClip> = {}): EditorVisualClip {
  return {
    id: 'clip-1',
    sourceNodeId: 'source-1',
    sourceKind: 'image',
    trackIndex: 0,
    startMs: 0,
    sourceInMs: 0,
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
    transitionIn: 'none',
    transitionOut: 'none',
    transitionDurationMs: 0,
    textFontFamily: 'Inter, system-ui, sans-serif',
    textSizePx: 72,
    textColor: '#ffffff',
    textEffect: 'none',
    textBackgroundOpacityPercent: 0,
    ...patch,
  };
}

describe('video premiere parity helpers', () => {
  it('keeps high-priority comparison rows focused on generative media workflow gaps', () => {
    const rows = getHighPriorityVideoParityRows();

    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.map((row) => row.priority)).toEqual(rows.map(() => 'high'));
    expect(rows.some((row) => row.workflowImpact.includes('Flow/Image/Paper'))).toBe(true);
  });

  it('summarizes sequence settings from supported aspect ratio, resolution, and duration', () => {
    expect(buildVideoSequenceSummary('9:16', '1080p', { width: 1080, height: 1920 }, 7.25, 24)).toMatchObject({
      frameShapeLabel: 'Vertical 9:16',
      sizeLabel: '1080 x 1920 (1080p)',
      frameRateLabel: '24 fps timebase',
      durationLabel: '7.3s timeline',
    });
  });

  it('flags parity-sensitive clips and executable export presets', () => {
    const notices = getVideoMonitorParityNotices({
      visualClips: [makeVisualClip({ cropLeftPercent: 12 })],
      stageObjects: [],
      exportPresetPlan: { presetId: 'social-vertical-h264' },
    });

    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain('Export diagnostics');
    expect(notices[1]).toContain('browser FFmpeg');
  });

  it('resolves executable export preset metadata and ffmpeg args', () => {
    const preset = getVideoExportPresetOption('archive-high-quality');

    expect(preset.extension).toBe('mp4');
    expect(preset.mimeType).toBe('video/mp4');
    expect(preset.videoCodecArgs).toContain('libx264');
    expect(preset.audioCodecArgs).toContain('320k');
    expect(preset.crf).toBe(18);
  });

  it('lists expanded export presets with output metadata and availability flags', () => {
    expect(VIDEO_EXPORT_PRESET_OPTIONS.map((preset) => preset.id)).toEqual(expect.arrayContaining([
      'webm-vp9-opus',
      'gif-preview',
      'prores-mov',
      'hevc-h265-mp4',
      'hevc-h265-mov',
      'broadcast-mxf',
      'png-image-sequence',
      'jpeg-image-sequence',
    ]));

    const webm = getVideoExportPresetOption('webm-vp9-opus');
    expect(webm.extension).toBe('webm');
    expect(webm.mimeType).toBe('video/webm');
    expect(webm.audioCodecArgs).toContain('libopus');
    expect(webm.nativeMapping?.cpu?.videoCodecArgs).toContain('libvpx-vp9');
  });

  it('exposes a browser/CPU alpha preset and refuses hardware alpha claims', () => {
    const alpha = getVideoExportPresetOption('webm-vp9-alpha');
    expect(alpha.preservesAlpha).toBe(true);
    expect(alpha.videoCodecArgs).toEqual(expect.arrayContaining(['-pix_fmt', 'yuva420p', '-auto-alt-ref', '0']));
    expect(getVideoExportPresetAvailability(alpha, 'browser')).toMatchObject({ available: true });
    expect(getVideoExportPresetAvailability(alpha, 'native-cpu')).toMatchObject({ available: true });
    expect(getVideoExportPresetAvailability(alpha, 'native-amd-vaapi').reason).toContain('not mapped');
    expect(getVideoExportPresetAvailability(alpha, 'native-nvidia-nvenc').reason).toContain('not mapped');
  });

  it('reports UI availability per render target', () => {
    const prores = getVideoExportPresetOption('prores-mov');
    const imageSequence = getVideoExportPresetOption('png-image-sequence');

    expect(getVideoExportPresetAvailability(prores, 'browser')).toMatchObject({ available: false });
    expect(getVideoExportPresetAvailability(prores, 'native-cpu')).toMatchObject({ available: true });
    expect(getVideoExportPresetAvailability(prores, 'native-amd-vaapi').reason).toContain('VAAPI');
    expect(getVideoExportPresetAvailability(imageSequence, 'browser')).toMatchObject({ available: true });
    expect(getVideoExportPresetAvailability(imageSequence, 'native-cpu').reason).toContain('Native image sequence ZIP export');
    expect(imageSequence.mimeType).toBe('image/png');
    expect(imageSequence.capabilities).toMatchObject({ browser: true, nativeCpu: false, nativeVaapi: false });
  });

  it('maps the bounded MXF broadcast handoff to native CPU only and refuses unsupported timebases', () => {
    const mxf = getVideoExportPresetOption('broadcast-mxf');

    expect(mxf).toMatchObject({ extension: 'mxf', mimeType: 'application/mxf', capabilities: { browser: false, nativeCpu: true, nativeVaapi: false } });
    expect(mxf.nativeMapping?.cpu?.videoCodecArgs).toEqual(expect.arrayContaining(['mpeg2video', 'yuv422p']));
    expect(mxf.nativeMapping?.cpu?.audioCodecArgs).toEqual(expect.arrayContaining(['pcm_s24le', '48000']));
    expect(mxf.caveat).toMatch(/without enabled audio produce video-only MXF/);
    expect(mxf.containerArgs).toEqual(['-f', 'mxf']);
    expect(getVideoExportPresetFrameRateAvailability(mxf, 25)).toEqual({ available: true });
    expect(getVideoExportPresetFrameRateAvailability(mxf, 30)).toEqual({ available: true });
    expect(getVideoExportPresetFrameRateAvailability(mxf, 29.97)).toMatchObject({ available: false, reason: expect.stringMatching(/non-drop 25 or 30/) });
  });

  it('builds parity diagnostics from shared computed clip values', () => {
    const diagnostics = buildVideoParityDiagnostics({
      visualClips: [makeVisualClip({
        positionX: 32,
        scalePercent: 125,
        opacityPercent: 70,
        cropLeftPercent: 10,
        keyframes: [
          { timePercent: 0, positionX: 32, positionY: 0, scalePercent: 125, rotationDeg: 0, opacityPercent: 70 },
          { timePercent: 100, positionX: 64, positionY: 12, scalePercent: 140, rotationDeg: 8, opacityPercent: 100 },
        ],
      })],
      stageObjects: [],
    });

    expect(diagnostics[0]).toMatchObject({ severity: 'attention' });
    expect(diagnostics[0].detail).toContain('pos 32, 0');
    expect(diagnostics[0].detail).toContain('scale 125%');
    expect(diagnostics[0].detail).toContain('crop L10%');
    expect(diagnostics[0].detail).toContain('frame');
    expect(diagnostics[0].descriptor?.keyframeCount).toBe(2);
  });

  it('returns pass diagnostics when descriptors do not need attention', () => {
    const diagnostics = buildVideoParityDiagnostics({
      visualClips: [makeVisualClip()],
      stageObjects: [],
    });

    expect(diagnostics[0]).toMatchObject({ severity: 'pass' });
    expect(diagnostics[0].detail).toContain('Descriptor values');
  });

  it('marks completed Video parity rows accurately', () => {
    const rows = getHighPriorityVideoParityRows();

    expect(rows.find((row) => row.id === 'monitor-render-parity')?.status).toBe('done');
  });
});
