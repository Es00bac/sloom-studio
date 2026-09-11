export type MixerColor = [number, number, number, number];

/**
 * Update the running smudge state as the brush moves over `sampled` canvas colour.
 * `smudgeLength` (0..1) is how much the brush REMEMBERS its previous state: 0 = adopt the
 * freshly-sampled colour immediately (no drag), 1 = keep the old state (infinite drag/trail).
 * newState = prev*smudgeLength + sampled*(1-smudgeLength), per channel.
 */
export function updateSmudgeState(prev: MixerColor, sampled: MixerColor, smudgeLength: number): MixerColor {
  const s = smudgeLength < 0 ? 0 : smudgeLength > 1 ? 1 : smudgeLength;
  return [
    prev[0] * s + sampled[0] * (1 - s),
    prev[1] * s + sampled[1] * (1 - s),
    prev[2] * s + sampled[2] * (1 - s),
    prev[3] * s + sampled[3] * (1 - s),
  ];
}

/**
 * Mix the smudge state with the foreground colour to get the dab colour.
 * `colorRate` (0..1): 0 = pure smudge (dab = state), 1 = pure paint (dab = fg).
 * dab = state*(1-colorRate) + fg*colorRate, per channel.
 */
export function mixDabColor(state: MixerColor, fg: MixerColor, colorRate: number): MixerColor {
  const c = colorRate < 0 ? 0 : colorRate > 1 ? 1 : colorRate;
  return [
    state[0] * (1 - c) + fg[0] * c,
    state[1] * (1 - c) + fg[1] * c,
    state[2] * (1 - c) + fg[2] * c,
    state[3] * (1 - c) + fg[3] * c,
  ];
}

/**
 * Convenience: one mixer step. Returns the updated state and the dab colour to stamp.
 * Clamps smudgeLength and colorRate to [0,1].
 */
export function mixerStep(args: {
  prevState: MixerColor;
  sampled: MixerColor;
  fg: MixerColor;
  smudgeLength: number;
  colorRate: number;
}): { state: MixerColor; dab: MixerColor } {
  const { prevState, sampled, fg, smudgeLength, colorRate } = args;
  const state = updateSmudgeState(prevState, sampled, smudgeLength);
  const dab = mixDabColor(state, fg, colorRate);
  return { state, dab };
}
