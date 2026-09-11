import { describe, expect, it } from 'vitest';
import { PAPER_BUBBLE_PRESETS } from './paperBubblePresets';

describe('paper bubble presets', () => {
  it('exposes uniquely-identified presets with a name and a patch', () => {
    const ids = PAPER_BUBBLE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PAPER_BUBBLE_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(PAPER_BUBBLE_PRESETS.every((preset) => preset.name.length > 0 && preset.patch)).toBe(true);
  });

  it('only uses supported bubble shapes', () => {
    const shapes = new Set(['oval', 'organic', 'squircle', 'cloud']);
    expect(PAPER_BUBBLE_PRESETS.every((preset) => !preset.patch.bubbleShape || shapes.has(preset.patch.bubbleShape))).toBe(true);
  });
});
