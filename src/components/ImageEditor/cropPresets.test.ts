import { describe, expect, it } from 'vitest';
import {
  createCropPreset,
  cropCustomPresetValue,
  formatCropRatioLabel,
  parseCropCustomPresetRatio,
  parseCropRatioInput,
  renameCropPreset,
  sanitizeCropPresets,
} from './cropPresets';

describe('parseCropRatioInput', () => {
  it('parses W:H, WxH and decimal forms', () => {
    expect(parseCropRatioInput('16:9')).toBeCloseTo(16 / 9, 3);
    expect(parseCropRatioInput('4x5')).toBeCloseTo(0.8, 3);
    expect(parseCropRatioInput('4 × 5')).toBeCloseTo(0.8, 3);
    expect(parseCropRatioInput('1.85')).toBe(1.85);
  });

  it('rejects junk and non-positive values', () => {
    expect(parseCropRatioInput('')).toBeNull();
    expect(parseCropRatioInput('abc')).toBeNull();
    expect(parseCropRatioInput('0:9')).toBeNull();
    expect(parseCropRatioInput('-2')).toBeNull();
    expect(parseCropRatioInput('16:0')).toBeNull();
  });
});

describe('custom preset encoding', () => {
  it('round-trips a ratio through the custom: aspect-preset value', () => {
    const value = cropCustomPresetValue(16 / 9);
    expect(value).toBe('custom:1.7778');
    expect(parseCropCustomPresetRatio(value)).toBe(1.7778);
  });

  it('returns null for non-custom presets', () => {
    expect(parseCropCustomPresetRatio('16:9')).toBeNull();
    expect(parseCropCustomPresetRatio('free')).toBeNull();
    expect(parseCropCustomPresetRatio('custom:nope')).toBeNull();
  });
});

describe('preset list management', () => {
  it('creates presets with unique ids and a ratio-label fallback', () => {
    const a = createCropPreset('Cinemascope', 2.39, []);
    expect(a).toMatchObject({ id: 'crop-preset-1', label: 'Cinemascope', ratio: 2.39 });
    const b = createCropPreset('  ', 1.85, [a.id]);
    expect(b.id).toBe('crop-preset-2');
    expect(b.label).toBe(formatCropRatioLabel(1.85));
  });

  it('renames, keeping the old label when blank', () => {
    const a = createCropPreset('Wide', 2, []);
    expect(renameCropPreset(a, 'Ultrawide').label).toBe('Ultrawide');
    expect(renameCropPreset(a, '   ').label).toBe('Wide');
  });

  it('sanitizes malformed persisted entries', () => {
    const cleaned = sanitizeCropPresets([
      { id: 'a', label: 'Good', ratio: 1.5 },
      { id: 'a', label: 'Dup id', ratio: 2 },
      { id: 'b', ratio: 0 },
      { id: 'c', ratio: 2 },
      null,
      'nope',
    ]);
    expect(cleaned.map((p) => p.id)).toEqual(['a', 'c']);
    expect(cleaned[1].label).toBe(formatCropRatioLabel(2));
  });
});
