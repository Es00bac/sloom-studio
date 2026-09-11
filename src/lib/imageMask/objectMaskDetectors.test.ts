import { describe, expect, it } from 'vitest';
import {
  compositeBoxesToCanonicalAlpha,
  listConfiguredDetectors,
  parseGeminiSegments,
} from './objectMaskDetectors';
import type { RuntimeSettingsSnapshot } from '../../types/flow';

describe('compositeBoxesToCanonicalAlpha', () => {
  it('marks the box region opaque (edit) and the rest transparent (keep)', () => {
    // 10x10 image; box covering the top-left quadrant in 0-1000 space
    const alpha = compositeBoxesToCanonicalAlpha(
      [{ label: 'cat', box: [0, 0, 500, 500] }],
      10,
      10,
    );
    expect(alpha[0 * 10 + 0]).toBe(255);  // inside box
    expect(alpha[9 * 10 + 9]).toBe(0);    // outside box
  });
  it('returns all-transparent when there are no objects', () => {
    const alpha = compositeBoxesToCanonicalAlpha([], 4, 4);
    expect(Array.from(alpha).every((v) => v === 0)).toBe(true);
  });
});

function settingsWith(geminiKey: string): RuntimeSettingsSnapshot {
  return { apiKeys: { gemini: geminiKey } } as unknown as RuntimeSettingsSnapshot;
}

describe('listConfiguredDetectors', () => {
  it('includes the Gemini detector when a Gemini key is set', () => {
    const ids = listConfiguredDetectors(settingsWith('k')).map((d) => d.id);
    expect(ids).toContain('gemini-segmentation');
  });
  it('excludes it when no Gemini key is set', () => {
    const ids = listConfiguredDetectors(settingsWith('')).map((d) => d.id);
    expect(ids).not.toContain('gemini-segmentation');
  });
});

describe('parseGeminiSegments', () => {
  it('parses box_2d records from a fenced JSON reply', () => {
    const out = parseGeminiSegments('```json\n[{"label":"cat","box_2d":[10,20,30,40]}]\n```');
    expect(out).toEqual([{ label: 'cat', box: [10, 20, 30, 40] }]);
  });
  it('returns [] when no JSON array is present', () => {
    expect(parseGeminiSegments('no objects found')).toEqual([]);
  });
  it('captures a per-object segmentation mask when present', () => {
    const out = parseGeminiSegments('[{"label":"sky","box_2d":[0,0,500,1000],"mask":"iVBORw0KGgo="}]');
    expect(out).toEqual([{ label: 'sky', box: [0, 0, 500, 1000], mask: 'iVBORw0KGgo=' }]);
  });
  it('leaves mask undefined when the model returns only a box', () => {
    const [obj] = parseGeminiSegments('[{"label":"cat","box_2d":[10,20,30,40]}]');
    expect(obj.mask).toBeUndefined();
  });
});
