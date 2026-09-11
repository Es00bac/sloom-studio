import { describe, expect, it } from 'vitest';
import { buildClipEffectDescriptor } from './editorClipEffects';
import { createEditorHistorySnapshot } from './editorHistory';
import { createEditorVisualClip } from './manualEditorState';
import {
  buildPrimaryColorCorrectionPatch,
  hasPrimaryColorCorrection,
  resetPrimaryColorCorrection,
} from './videoPrimaryColor';

describe('executable Video primary colour correction', () => {
  it('projects only the supported primary controls into the shared preview and FFmpeg effect chain', () => {
    const patch = buildPrimaryColorCorrectionPatch([
      { id: 'editorial-contrast', kind: 'contrast', amount: 12, enabled: true },
      { id: 'professional-color-exposure', kind: 'brightness', amount: -50, enabled: true },
    ], {
      temperature: 35,
      tint: -10,
      lift: [0.2, 0, -0.2],
      gamma: [0, 0.1, 0],
      gain: [0, 0, 0.3],
    }, {
      exposureStops: 1.5,
      contrast: 20,
      saturation: 130,
    });

    expect(patch.color).toMatchObject({
      exposureStops: 1.5,
      contrast: 20,
      saturation: 130,
      temperature: 35,
      lift: [0.2, 0, -0.2],
    });
    expect(patch.filterStack).toEqual([
      { id: 'editorial-contrast', kind: 'contrast', amount: 12, enabled: true },
      { id: 'professional-primary-exposure', kind: 'brightness', amount: 15, enabled: true },
      { id: 'professional-primary-contrast', kind: 'contrast', amount: 20, enabled: true },
      { id: 'professional-primary-saturation', kind: 'saturation', amount: 30, enabled: true },
    ]);

    const descriptor = buildClipEffectDescriptor({
      cropLeftPercent: 0,
      cropRightPercent: 0,
      cropTopPercent: 0,
      cropBottomPercent: 0,
      cropPanXPercent: 0,
      cropPanYPercent: 0,
      cropRotationDeg: 0,
      filterStack: patch.filterStack,
    });
    expect(descriptor.cssFilter).toBe('contrast(1.12) brightness(1.15) contrast(1.2) saturate(1.3)');
    expect(descriptor.ffmpegFilters).toEqual(expect.arrayContaining([
      'eq=brightness=0.1500',
      'eq=contrast=1.2000',
      'eq=saturation=1.3000',
    ]));
  });

  it('bounds hostile values and reset removes only the primary-owned filters', () => {
    const patch = buildPrimaryColorCorrectionPatch([], {
      exposureStops: Number.POSITIVE_INFINITY,
      contrast: -500,
      saturation: 900,
      lift: [9, -9, 0.1234],
    }, {});
    expect(patch.color).toMatchObject({ exposureStops: 0, contrast: -100, saturation: 200, lift: [2, -2, 0.12] });
    expect(hasPrimaryColorCorrection(patch.color)).toBe(true);

    const reset = resetPrimaryColorCorrection([
      ...patch.filterStack,
      { id: 'kept-hue', kind: 'hue-rotate', amount: 10, enabled: true },
    ], patch.color);
    expect(reset.color).toMatchObject({ exposureStops: 0, contrast: 0, saturation: 100, lift: [2, -2, 0.12] });
    expect(reset.filterStack).toEqual([{ id: 'kept-hue', kind: 'hue-rotate', amount: 10, enabled: true }]);
    expect(hasPrimaryColorCorrection(reset.color)).toBe(false);
  });

  it('round-trips the one persisted clip record through the composition history patch', () => {
    const primary = buildPrimaryColorCorrectionPatch([], { temperature: 22 }, {
      exposureStops: 0.5,
      contrast: -15,
      saturation: 115,
    });
    const clip = {
      ...createEditorVisualClip('source-primary', 'video', {
        filterStack: primary.filterStack,
      }),
      id: 'primary-clip',
      professional: { color: primary.color },
    };
    const patch = createEditorHistorySnapshot({ editorVisualClips: [clip] }).toPatch();
    const reopened = createEditorHistorySnapshot(patch).toPatch().editorVisualClips?.[0];

    expect(reopened).toMatchObject({
      id: 'primary-clip',
      filterStack: primary.filterStack,
      professional: { color: { exposureStops: 0.5, contrast: -15, saturation: 115, temperature: 22 } },
    });
  });
});
