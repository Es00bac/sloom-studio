import { describe, expect, it } from 'vitest';
import { normalizeBrushSettings } from './ImageBrushEngine';
import { EXPANDED_IMAGE_BRUSH_PRESETS } from './ImageBrushMediaLibrary';

function family(name: string) {
  return EXPANDED_IMAGE_BRUSH_PRESETS
    .filter((preset) => preset.group === name)
    .map((preset) => ({ ...preset, resolved: normalizeBrushSettings(preset.settings) }));
}

describe('professional media brush calibration', () => {
  it('gives every family nine distinct, deterministic tools', () => {
    const byFamily = new Map<string, typeof EXPANDED_IMAGE_BRUSH_PRESETS>();
    for (const preset of EXPANDED_IMAGE_BRUSH_PRESETS) {
      byFamily.set(preset.group, [...(byFamily.get(preset.group) ?? []), preset]);
    }

    expect(byFamily.size).toBe(16);
    for (const presets of byFamily.values()) {
      expect(presets).toHaveLength(9);
      expect(new Set(presets.map((preset) => preset.id)).size).toBe(9);
      expect(new Set(presets.map((preset) => JSON.stringify(normalizeBrushSettings(preset.settings)))).size).toBe(9);
    }
  });

  it('keeps graphite granular, pressure-darkened, and materially separate from ink', () => {
    const pencils = family('Graphite & Pencil');

    for (const pencil of pencils) {
      expect(pencil.resolved.texture).toBe('fine-grain');
      expect(pencil.resolved.textureDepth).toBeGreaterThanOrEqual(0.48);
      expect(pencil.resolved.hardness).toBeLessThanOrEqual(0.4);
      expect(pencil.resolved.opacity).toBeLessThanOrEqual(0.84);
      expect(pencil.resolved.flow).toBeLessThanOrEqual(0.6);
      expect(pencil.resolved.pressureOpacity).toBeGreaterThanOrEqual(0.68);
      expect(pencil.resolved.pressureSize).toBeLessThanOrEqual(0.24);
      expect(pencil.resolved.scatter).toBeGreaterThan(0);
      expect(pencil.resolved.mixerEnabled).toBe(false);
      expect(pencil.resolved.wetMedia).toBe(false);
    }
  });

  it('models dry sticks with paper breakup and deposit-first pressure response', () => {
    for (const preset of [...family('Charcoal & Conté'), ...family('Pastel & Chalk')]) {
      expect(preset.resolved.texture).toBe('chalk');
      expect(preset.resolved.textureDepth).toBeGreaterThanOrEqual(0.34);
      expect(preset.resolved.scatter).toBeGreaterThan(0);
      if (preset.resolved.mixerEnabled) {
        expect(preset.resolved.colorRate).toBeLessThanOrEqual(0.08);
      } else {
        expect(preset.resolved.pressureOpacity).toBeGreaterThanOrEqual(0.56);
      }
      expect(preset.resolved.pressureSize).toBeLessThanOrEqual(0.76);
      expect(preset.resolved.wetMedia).toBe(false);
    }
  });

  it('keeps ink and manga tools crisp, opaque, closely spaced, and free of wet-paint leakage', () => {
    const lineTools = [
      ...family('Ink & Calligraphy').filter((preset) => !preset.id.includes('dry-sumi') && !preset.id.includes('splatter')),
      ...family('Comic & Manga Pro').filter((preset) => !preset.id.includes('tone-')),
    ];

    for (const preset of lineTools) {
      expect(preset.resolved.opacity).toBeGreaterThanOrEqual(0.94);
      expect(preset.resolved.hardness).toBeGreaterThanOrEqual(0.78);
      expect(preset.resolved.spacing).toBeLessThanOrEqual(0.04);
      expect(preset.resolved.mixerEnabled).toBe(false);
      expect(preset.resolved.wetMedia).toBe(false);
      expect(preset.resolved.textureDepth).toBe(0);
    }
  });

  it('makes marker pressure change deposit or nib shape without unintended hue drift', () => {
    const markers = family('Markers');
    for (const marker of markers) {
      expect(marker.resolved.pressureColor).toBe(0);
      expect(marker.resolved.tiltColor).toBe(0);
      expect(marker.resolved.wetEdges || marker.id.includes('paint-opaque')).toBe(true);
      expect(marker.resolved.scatter).toBeLessThanOrEqual(0.12);
    }
  });

  it('gives watercolor low-deposit wet mixing while preserving a deliberately dry brush', () => {
    const watercolors = family('Watercolor');
    for (const watercolor of watercolors) {
      expect(watercolor.resolved.wetMedia).toBe(true);
      expect(watercolor.resolved.wetEdges).toBe(true);
      expect(watercolor.resolved.opacity).toBeLessThanOrEqual(0.42);
      expect(watercolor.resolved.flow).toBeLessThanOrEqual(0.34);
      expect(watercolor.resolved.hardness).toBeLessThanOrEqual(0.38);
      expect(watercolor.resolved.pressureFlow).toBeGreaterThanOrEqual(0.8);
      expect(watercolor.resolved.pressureColor).toBe(0);
      expect(watercolor.resolved.tiltColor).toBe(0);
      expect(watercolor.resolved.mixerEnabled).toBe(!watercolor.id.includes('drybrush'));
    }
  });

  it('separates pigment mixing in oils from quick-drying acrylic and gouache behavior', () => {
    for (const preset of family('Oils & Acrylics')) {
      expect(preset.resolved.pressureColor).toBe(0);
      expect(preset.resolved.tiltColor).toBe(0);
      if (preset.id.includes('oil-') && !preset.id.includes('glaze')) {
        expect(preset.resolved.mixerEnabled).toBe(true);
        expect(preset.resolved.mixMode).toBe('spectral');
      }
      if (preset.id.includes('acrylic-') || preset.id.includes('glaze')) {
        expect(preset.resolved.mixerEnabled).toBe(false);
      }
    }

    for (const preset of family('Gouache & Tempera')) {
      expect(preset.resolved.pressureColor).toBe(0);
      expect(preset.resolved.tiltColor).toBe(0);
      expect(preset.resolved.wetMedia).toBe(false);
    }
  });

  it('requires dry-bristle tools to carry grain, breakup, and finite paint load', () => {
    for (const preset of family('Bristle & Dry Media')) {
      expect(preset.resolved.texture).toBeTruthy();
      expect(preset.resolved.textureDepth).toBeGreaterThanOrEqual(0.46);
      expect(preset.resolved.dualBrush).toBe(true);
      expect(preset.resolved.paintLoad).toBeLessThanOrEqual(0.9);
      expect(preset.resolved.loadFalloff).toBeGreaterThan(0);
      expect(preset.resolved.pressureFlow).toBeGreaterThanOrEqual(0.68);
    }
  });

  it('keeps airbrushes soft, low-deposit, velocity-sensitive, and free of accidental color dynamics', () => {
    for (const preset of family('Airbrush & Glaze')) {
      expect(preset.resolved.opacity).toBeLessThanOrEqual(0.32);
      expect(preset.resolved.hardness).toBeLessThanOrEqual(0.28);
      expect(preset.resolved.flow).toBeLessThanOrEqual(0.26);
      expect(preset.resolved.spacing).toBeLessThanOrEqual(0.12);
      expect(preset.resolved.pressureColor).toBe(0);
      expect(preset.resolved.tiltColor).toBe(0);
      expect(preset.resolved.velocityOpacity).toBeGreaterThan(0);
    }
  });

  it('keeps texture, organic, effect, and mixer families honest about their operative engine', () => {
    for (const preset of family('Texture & Stamps')) {
      expect(preset.resolved.texture).toBeTruthy();
      expect(preset.resolved.textureDepth).toBeGreaterThan(0);
    }
    for (const preset of family('Nature & Organic')) {
      expect(preset.resolved.scatter).toBeGreaterThan(0);
      expect(preset.resolved.sizeJitter).toBeGreaterThan(0);
    }
    for (const preset of family('FX & Light')) {
      expect(
        preset.resolved.scatter > 0
        || (preset.resolved.velocitySize ?? 0) > 0
        || (preset.resolved.pressureColor ?? 0) > 0
        || preset.resolved.hardness < 0.2
        || (Boolean(preset.settings.color) && preset.resolved.smoothing > 0.4),
      ).toBe(true);
    }
    for (const preset of family('Blend & Smudge')) {
      expect(preset.resolved.mixerEnabled).toBe(true);
      expect(preset.resolved.smudgeLength).toBeGreaterThan(0.4);
      expect(preset.resolved.smudgeRadius).toBeGreaterThanOrEqual(12);
    }
  });
});
