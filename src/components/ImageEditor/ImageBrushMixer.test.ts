import { describe, expect, it } from 'vitest';
import { mixDabColor, mixerStep, updateSmudgeState, type MixerColor } from './ImageBrushMixer';

const BLUE: MixerColor = [0, 0, 255, 255];
const YELLOW: MixerColor = [255, 255, 0, 255];

describe('ImageBrushMixer', () => {
  it('updateSmudgeState with smudgeLength 0 adopts the sampled colour', () => {
    expect(updateSmudgeState(BLUE, YELLOW, 0)).toEqual(YELLOW);
  });
  it('updateSmudgeState with smudgeLength 1 keeps the previous state (full drag)', () => {
    expect(updateSmudgeState(BLUE, YELLOW, 1)).toEqual(BLUE);
  });
  it('updateSmudgeState halfway blends the two', () => {
    expect(updateSmudgeState([0, 0, 0, 0], [200, 100, 50, 255], 0.5)).toEqual([100, 50, 25, 127.5]);
  });
  it('mixDabColor 0 is pure smudge, 1 is pure foreground', () => {
    expect(mixDabColor(BLUE, YELLOW, 0)).toEqual(BLUE);
    expect(mixDabColor(BLUE, YELLOW, 1)).toEqual(YELLOW);
  });
  it('mixerStep clamps params and returns updated state + dab', () => {
    const r = mixerStep({ prevState: BLUE, sampled: YELLOW, fg: [255, 0, 0, 255], smudgeLength: 2, colorRate: -1 });
    // smudgeLength clamps to 1 => state stays BLUE; colorRate clamps to 0 => dab = state = BLUE
    expect(r.state).toEqual(BLUE);
    expect(r.dab).toEqual(BLUE);
  });
  it('mixerStep with smudgeLength 0, colorRate 0.5 picks up canvas then half-mixes with fg', () => {
    const r = mixerStep({ prevState: [0, 0, 0, 0], sampled: YELLOW, fg: BLUE, smudgeLength: 0, colorRate: 0.5 });
    expect(r.state).toEqual(YELLOW);              // adopted the canvas
    expect(r.dab).toEqual([127.5, 127.5, 127.5, 255]); // half yellow, half blue
  });
});
