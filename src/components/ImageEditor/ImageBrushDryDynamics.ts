const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fade-in ramp over the first `fadeLength` dabs of a stroke (taper start by dab count).
 *  Returns 0 at dab 0 rising linearly to 1 at dab `fadeLength`. fadeLength<=0 disables it (returns 1). */
export function fadeInFactor(dabIndex: number, fadeLength: number): number {
  return fadeLength <= 0 ? 1 : clamp01(dabIndex / fadeLength);
}

/** Symmetric stroke taper: `progress` is 0..1 along the stroke. Ramps up over the first
 *  `taperFraction` of the stroke and down over the last `taperFraction`, 1 in the middle.
 *  taperFraction<=0 disables it (returns 1). */
export function strokeTaperFactor(progress: number, taperFraction: number): number {
  return taperFraction <= 0 ? 1 : clamp01(Math.min(progress, 1 - progress) / taperFraction);
}

/** Paint-load depletion (dry brush "runs out"): exponential decay of `initialLoad` (0..1) over
 *  `distancePx`, rate `falloff` per pixel. distance 0 => initialLoad; falloff<=0 => initialLoad. */
export function depletePaintLoad(initialLoad: number, distancePx: number, falloff: number): number {
  return falloff <= 0 ? clamp01(initialLoad) : clamp01(initialLoad * Math.exp(-falloff * distancePx));
}
