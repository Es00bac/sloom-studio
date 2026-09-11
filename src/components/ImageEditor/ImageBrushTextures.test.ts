import { describe, expect, it } from 'vitest';
import {
  BRUSH_TEXTURE_PRESETS,
  DEFAULT_BRUSH_TEXTURE_ID,
  isBuiltInBrushTexture,
  resolveBrushTextureId,
  sampleBrushTexture,
} from './ImageBrushTextures';

function sampleSequence(textureId: string, count = 32): number[] {
  return Array.from({ length: count }, (_, index) => sampleBrushTexture(textureId, 1234, index, 1, false));
}

describe('ImageBrushTextures', () => {
  it('publishes built-in presets including the canvas-grain default', () => {
    expect(BRUSH_TEXTURE_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(BRUSH_TEXTURE_PRESETS.map((preset) => preset.id)).toContain(DEFAULT_BRUSH_TEXTURE_ID);
    expect(BRUSH_TEXTURE_PRESETS.map((preset) => preset.id)).toContain('canvas-grain');
    for (const preset of BRUSH_TEXTURE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it('recognises built-in ids and resolves unknown/custom ids to the default', () => {
    expect(isBuiltInBrushTexture('chalk')).toBe(true);
    expect(isBuiltInBrushTexture('not-a-texture')).toBe(false);
    expect(isBuiltInBrushTexture(undefined)).toBe(false);
    expect(resolveBrushTextureId('chalk')).toBe('chalk');
    expect(resolveBrushTextureId('imported-from-abr')).toBe(DEFAULT_BRUSH_TEXTURE_ID);
    expect(resolveBrushTextureId(undefined)).toBe(DEFAULT_BRUSH_TEXTURE_ID);
  });

  it('keeps every sample within [0,1] and is deterministic for the same inputs', () => {
    for (const preset of BRUSH_TEXTURE_PRESETS) {
      for (const value of sampleSequence(preset.id)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    expect(sampleBrushTexture('chalk', 7, 3, 1, false)).toBe(sampleBrushTexture('chalk', 7, 3, 1, false));
  });

  it('produces a distinct modulation pattern per named texture', () => {
    const canvas = sampleSequence('canvas-grain');
    const chalk = sampleSequence('chalk');
    const dots = sampleSequence('dots');
    const hatch = sampleSequence('hatch');
    // Different textures should not collapse to the same sequence.
    expect(canvas).not.toEqual(chalk);
    expect(canvas).not.toEqual(dots);
    expect(chalk).not.toEqual(hatch);
    // Halftone dots alternate between a high "on" band and a low "off" band.
    const dotSpread = Math.max(...dots) - Math.min(...dots);
    const fineSpread = Math.max(...sampleSequence('fine-grain')) - Math.min(...sampleSequence('fine-grain'));
    expect(dotSpread).toBeGreaterThan(0.5);
    expect(fineSpread).toBeGreaterThan(0);
  });

  it('blends a second octave when dual-brush is enabled', () => {
    const single = sampleBrushTexture('fine-grain', 99, 5, 1, false);
    const dual = sampleBrushTexture('fine-grain', 99, 5, 1, true);
    expect(single).not.toBe(dual);
  });
});
