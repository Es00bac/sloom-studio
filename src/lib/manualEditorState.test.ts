import { describe, expect, it } from 'vitest';
import {
  getEditorVisualClips,
  getEditorAudioClips,
  getEditorAudioTrackVolumes,
  getEditorVisualTrackKinds,
  migrateComicPolarTailToBezierTip,
  selectOverlayTrackIndexForNewClip,
  toggleEditorVisualTrackKind,
  createEditorAudioClip,
} from './manualEditorState';
import type { EditorVisualTrackKind, NodeData } from '../types/flow';

describe('getEditorVisualClips', () => {
  it('normalizes saved visual keyframes and syncs opacity automation from them', () => {
    const clips = getEditorVisualClips({
      editorVisualClips: [
        {
          id: 'visual-1',
          sourceNodeId: 'source-1',
          sourceKind: 'image',
          trackIndex: 0,
          startMs: 0,
          sourceInMs: 0,
          durationSeconds: 4,
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
          keyframes: [
            {
              timePercent: 50,
              positionX: 20,
              positionY: 10,
              scalePercent: 150,
              rotationDeg: 45,
              opacityPercent: 35,
            },
          ],
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
          transitionDurationMs: 500,
          textFontFamily: 'Inter',
          textSizePx: 64,
          textColor: '#fff',
          textEffect: 'shadow',
          textBackgroundOpacityPercent: 0,
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(clips[0].keyframes?.map((keyframe) => keyframe.timePercent)).toEqual([0, 50, 100]);
    expect(clips[0].opacityAutomationPoints).toEqual([
      { timePercent: 0, valuePercent: 100 },
      { timePercent: 50, valuePercent: 35 },
      { timePercent: 100, valuePercent: 100 },
    ]);
  });

  it('normalizes saved chroma key, stroke, and expanded filter settings', () => {
    const clips = getEditorVisualClips({
      editorVisualClips: [
        {
          id: 'visual-effects',
          sourceNodeId: 'source-1',
          sourceKind: 'video',
          trackIndex: 0,
          startMs: 0,
          sourceInMs: 0,
          trimStartMs: 0,
          trimEndMs: 0,
          playbackRate: 1,
          reversePlayback: false,
          fitMode: 'contain',
          scalePercent: 100,
          opacityPercent: 100,
          rotationDeg: 0,
          flipHorizontal: false,
          flipVertical: false,
          positionX: 0,
          positionY: 0,
          cropLeftPercent: 0,
          cropRightPercent: 0,
          cropTopPercent: 0,
          cropBottomPercent: 0,
          cropPanXPercent: 0,
          cropPanYPercent: 0,
          cropRotationDeg: 0,
          filterStack: [
            { id: 'sepia', kind: 'sepia', amount: 120, enabled: true },
            { id: 'bad', kind: 'warp', amount: 100, enabled: true },
          ],
          chromaKey: {
            enabled: true,
            color: 'green',
            similarityPercent: 140,
            blendPercent: -8,
          },
          stroke: {
            enabled: true,
            color: '#ff00cc',
            widthPx: 240,
            opacityPercent: 140,
          },
          transitionIn: 'none',
          transitionOut: 'none',
          transitionDurationMs: 500,
          textFontFamily: 'Inter',
          textSizePx: 64,
          textColor: '#fff',
          textEffect: 'shadow',
          textBackgroundOpacityPercent: 0,
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(clips[0].filterStack).toEqual([
      { id: 'sepia', kind: 'sepia', amount: 100, enabled: true },
    ]);
    expect(clips[0].chromaKey).toEqual({
      enabled: true,
      color: '#00ff00',
      similarityPercent: 100,
      blendPercent: 0,
    });
    expect(clips[0].stroke).toEqual({
      enabled: true,
      color: '#ff00cc',
      widthPx: 80,
      opacityPercent: 100,
    });
  });
});

describe('migrateComicPolarTailToBezierTip', () => {
  it('returns undefined when no polar tail data is present', () => {
    expect(migrateComicPolarTailToBezierTip(undefined, undefined)).toBeUndefined();
  });

  it('converts a downward polar tail (90deg) to a below-center bezier tip', () => {
    // distance = 30 + 50 * 0.2 = 40; tipX = 50 + cos(90deg)*40 ≈ 50; tipY = 50 + sin(90deg)*40 = 90.
    const tip = migrateComicPolarTailToBezierTip(90, 50);

    expect(tip?.tipXPercent).toBeCloseTo(50, 5);
    expect(tip?.tipYPercent).toBe(90);
  });

  it('clamps a long rightward tail inside the 0..100 frame', () => {
    // angle 0 = right; distance = 30 + 500*0.2 clamps to 72; tipX = 50 + 72 = 122 -> clamped 100.
    const tip = migrateComicPolarTailToBezierTip(0, 500);

    expect(tip?.tipXPercent).toBe(100);
    expect(tip?.tipYPercent).toBeCloseTo(50, 5);
  });
});

describe('getEditorVisualClips comic tail migration', () => {
  it('migrates a legacy polar comic tail to a bezier tip while keeping the polar fields', () => {
    const clips = getEditorVisualClips({
      editorVisualClips: [
        {
          id: 'comic-1',
          sourceNodeId: 'source-1',
          sourceKind: 'comic',
          comicKind: 'speech-bubble',
          comicTailAngleDeg: 90,
          comicTailLengthPx: 50,
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(clips[0].comicTailTipXPercent).toBeCloseTo(50, 5);
    expect(clips[0].comicTailTipYPercent).toBe(90);
    // Legacy polar fields are preserved for back-compat.
    expect(clips[0].comicTailAngleDeg).toBe(90);
    expect(clips[0].comicTailLengthPx).toBe(50);
  });

  it('prefers an explicit bezier tip over the legacy polar tail', () => {
    const clips = getEditorVisualClips({
      editorVisualClips: [
        {
          id: 'comic-2',
          sourceNodeId: 'source-1',
          sourceKind: 'comic',
          comicKind: 'speech-bubble',
          comicTailAngleDeg: 90,
          comicTailLengthPx: 50,
          comicTailTipXPercent: 33,
          comicTailTipYPercent: 66,
          comicTailCurvePercent: 70,
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(clips[0].comicTailTipXPercent).toBe(33);
    expect(clips[0].comicTailTipYPercent).toBe(66);
    expect(clips[0].comicTailCurvePercent).toBe(70);
  });

  it('leaves the bezier tail unset for clips with no tail data', () => {
    const clips = getEditorVisualClips({
      editorVisualClips: [
        {
          id: 'image-1',
          sourceNodeId: 'source-1',
          sourceKind: 'image',
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(clips[0].comicTailTipXPercent).toBeUndefined();
    expect(clips[0].comicTailTipYPercent).toBeUndefined();
  });

  it('normalizes rich text typography and drops invalid fields', () => {
    const clips = getEditorVisualClips({
      editorVisualClips: [
        {
          id: 'text-1',
          sourceNodeId: 'source-1',
          sourceKind: 'text',
          textTypography: {
            fontWeight: 700,
            fontStyle: 'italic',
            fontKerning: 'none',
            lineHeightPercent: 120,
            letterSpacingPx: 2,
            textAlign: 'justify',
            strokeColor: '#000000',
            strokeWidthPx: 3,
            shadowColor: '#101010',
            shadowBlurPx: 6,
            shadowOffsetXPx: 1,
            shadowOffsetYPx: 2,
            arcPercent: 25,
            bogusField: 'ignored',
            fontStyleInvalid: 'oblique',
            fontKerningInvalid: 'loose',
          },
        },
      ],
    } as unknown as NodeData);

    expect(clips[0].textTypography).toEqual({
      fontWeight: 700,
      fontStyle: 'italic',
      fontKerning: 'none',
      lineHeightPercent: 120,
      letterSpacingPx: 2,
      textAlign: 'justify',
      strokeColor: '#000000',
      strokeWidthPx: 3,
      shadowColor: '#101010',
      shadowBlurPx: 6,
      shadowOffsetXPx: 1,
      shadowOffsetYPx: 2,
      arcPercent: 25,
    });
  });
});

describe('getEditorAudioClips', () => {
  it('keeps a bounded selected-clip mixer route when creating or restoring audio', () => {
    const created = createEditorAudioClip('source-1', 0, {
      professional: { busId: 'dialogue', pan: 3 },
    });
    const restored = getEditorAudioClips({ editorAudioClips: [created] } as Partial<NodeData> as NodeData);

    expect(created.professional).toMatchObject({ busId: 'dialogue', pan: 1 });
    expect(restored[0]?.professional).toMatchObject({ busId: 'dialogue', pan: 1 });
  });

  it('normalizes audio volume automation points from saved node data', () => {
    const clips = getEditorAudioClips({
      editorAudioClips: [
        {
          id: 'audio-1',
          sourceNodeId: 'source-1',
          offsetMs: 0,
          trackIndex: 0,
          volumePercent: 80,
          volumeAutomationPoints: [
            { timePercent: 50, valuePercent: 25 },
          ],
          fadeInSeconds: -2,
          fadeOutSeconds: 9,
          enabled: true,
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(clips[0].volumeAutomationPoints).toEqual([
      { timePercent: 0, valuePercent: 80 },
      { timePercent: 50, valuePercent: 25 },
      { timePercent: 100, valuePercent: 80 },
    ]);
    expect(clips[0]).toMatchObject({ fadeInSeconds: 0, fadeOutSeconds: 5 });
  });

  it('normalizes saved audio volume keyframes and syncs volume automation from them', () => {
    const clips = getEditorAudioClips({
      editorAudioClips: [
        {
          id: 'audio-1',
          sourceNodeId: 'source-1',
          offsetMs: 0,
          trackIndex: 0,
          volumePercent: 100,
          volumeKeyframes: [
            { timePercent: 50, volumePercent: 40 },
          ],
          enabled: true,
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(clips[0].volumeKeyframes).toEqual([
      { timePercent: 0, volumePercent: 100 },
      { timePercent: 50, volumePercent: 40 },
      { timePercent: 100, volumePercent: 100 },
    ]);
    expect(clips[0].volumeAutomationPoints).toEqual([
      { timePercent: 0, valuePercent: 100 },
      { timePercent: 50, valuePercent: 40 },
      { timePercent: 100, valuePercent: 100 },
    ]);
  });

  it('preserves bounded source ranges and measured speech-level metadata', () => {
    const clips = getEditorAudioClips({
      editorAudioClips: [{
        id: 'clean-1', sourceNodeId: 'clean-source', offsetMs: 500, trackIndex: 1,
        sourceInMs: 1_000, sourceOutMs: 4_000, volumePercent: 100, enabled: true,
        measuredMatchGainDb: 20, loudnessReferenceClipId: 'original-1',
        loudnessReferenceSourceNodeId: 'original-source',
        loudnessReferenceSourceInMs: 1_000, loudnessReferenceSourceOutMs: 4_000,
        audioProcessing: { highPassEnabled: true, highPassHz: 120, compressorEnabled: true, compressorRatio: 4 },
      }],
    } as Partial<NodeData> as NodeData);

    expect(clips[0]).toMatchObject({
      sourceInMs: 1_000,
      sourceOutMs: 4_000,
      measuredMatchGainDb: 12,
      loudnessReferenceClipId: 'original-1',
      loudnessReferenceSourceNodeId: 'original-source',
      audioProcessing: expect.objectContaining({ highPassEnabled: true, highPassHz: 120, compressorEnabled: true, compressorRatio: 4 }),
    });
  });

  it('persists bounded auto-ducking settings across save/reopen normalization', () => {
    const clips = getEditorAudioClips({
      editorAudioClips: [{
        id: 'music-1', sourceNodeId: 'music-source', offsetMs: 0, trackIndex: 1, volumePercent: 100, enabled: true,
        audioDucking: {
          enabled: true, controlClipId: 'dialogue-1', depthPercent: 180, thresholdDbfs: -100, attackMs: 0, releaseMs: 50_000,
        },
      }],
    } as Partial<NodeData> as NodeData);

    expect(clips[0].audioDucking).toEqual({
      enabled: true,
      controlClipId: 'dialogue-1',
      depthPercent: 100,
      thresholdDbfs: -60,
      attackMs: 1,
      releaseMs: 2_000,
    });
  });
});

describe('getEditorAudioTrackVolumes', () => {
  it('returns clamped per-track timeline volume controls with defaults', () => {
    expect(
      getEditorAudioTrackVolumes({
        editorAudioTrackVolumes: [100, 25, -10, 140],
      } as Partial<NodeData> as NodeData, 5),
    ).toEqual([100, 25, 0, 100, 100]);
  });
});

describe('getEditorVisualTrackKinds', () => {
  it('defaults every track to standard when the field is absent', () => {
    expect(getEditorVisualTrackKinds({} as NodeData, 4)).toEqual([
      'standard',
      'standard',
      'standard',
      'standard',
    ]);
  });

  it('never crashes on a short array and pads the rest with standard', () => {
    expect(
      getEditorVisualTrackKinds({ editorVisualTrackKinds: ['overlay'] } as Partial<NodeData> as NodeData, 4),
    ).toEqual(['overlay', 'standard', 'standard', 'standard']);
  });

  it('drops invalid/unknown entries back to standard', () => {
    expect(
      getEditorVisualTrackKinds(
        { editorVisualTrackKinds: ['overlay', 'bogus', null, 42] } as unknown as NodeData,
        4,
      ),
    ).toEqual(['overlay', 'standard', 'standard', 'standard']);
  });

  it('never crashes when the stored value is not an array', () => {
    expect(
      getEditorVisualTrackKinds({ editorVisualTrackKinds: 'overlay' } as unknown as NodeData, 2),
    ).toEqual(['standard', 'standard']);
  });
});

describe('toggleEditorVisualTrackKind', () => {
  it('flips a standard track to overlay, leaving the others untouched', () => {
    const kinds: EditorVisualTrackKind[] = ['standard', 'standard', 'standard', 'standard'];
    expect(toggleEditorVisualTrackKind(kinds, 2)).toEqual(['standard', 'standard', 'overlay', 'standard']);
  });

  it('flips an overlay track back to standard', () => {
    const kinds: EditorVisualTrackKind[] = ['standard', 'overlay', 'standard', 'standard'];
    expect(toggleEditorVisualTrackKind(kinds, 1)).toEqual(['standard', 'standard', 'standard', 'standard']);
  });
});

describe('selectOverlayTrackIndexForNewClip', () => {
  it('returns undefined for non text/comic source kinds regardless of overlay tracks', () => {
    expect(selectOverlayTrackIndexForNewClip('image', ['overlay', 'standard'])).toBeUndefined();
    expect(selectOverlayTrackIndexForNewClip('video', ['overlay', 'standard'])).toBeUndefined();
  });

  it('returns undefined for text/comic when no overlay track exists (keep todays default)', () => {
    expect(selectOverlayTrackIndexForNewClip('text', ['standard', 'standard'])).toBeUndefined();
    expect(selectOverlayTrackIndexForNewClip('comic', ['standard', 'standard'])).toBeUndefined();
  });

  it('returns the first overlay track index for a new comic clip', () => {
    expect(selectOverlayTrackIndexForNewClip('comic', ['standard', 'overlay', 'overlay'])).toBe(1);
  });

  it('returns the first overlay track index for a new text clip', () => {
    expect(selectOverlayTrackIndexForNewClip('text', ['overlay', 'standard'])).toBe(0);
  });
});

describe('normalizeEditorTextTypography', () => {
  it('preserves text typography weight/style and clamps out-of-range weights', () => {
    const underweight = getEditorVisualClips({
      editorVisualClips: [
        {
          id: 'visual-1',
          sourceNodeId: 'source-1',
          sourceKind: 'text',
          textFontFamily: 'Inter',
          textTypography: { fontWeight: -100, fontStyle: 'italic', fontKerning: 'normal' },
        },
      ],
    } as Partial<NodeData> as NodeData);
    const overweight = getEditorVisualClips({
      editorVisualClips: [
        {
          id: 'visual-2',
          sourceNodeId: 'source-2',
          sourceKind: 'text',
          textFontFamily: 'Inter',
          textTypography: { fontWeight: 1500, fontStyle: 'normal' },
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(underweight[0].textTypography).toEqual({ fontWeight: 1, fontStyle: 'italic', fontKerning: 'normal' });
    expect(overweight[0].textTypography).toEqual({ fontWeight: 1000, fontStyle: 'normal' });
  });

  it('preserves kerning choices through normalization (FBL-014)', () => {
    const clips = getEditorVisualClips({
      editorVisualClips: [
        {
          id: 'visual-1',
          sourceNodeId: 'source-1',
          sourceKind: 'text',
          textFontFamily: 'Inter',
          textTypography: { fontKerning: 'none' },
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(clips[0].textTypography?.fontKerning).toBe('none');
  });
});
