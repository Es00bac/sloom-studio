import spectral from 'spectral.js';

export type SpectralColor = [number, number, number, number]; // r,g,b,a each 0..255

/**
 * Mix two colours using spectral (Kubelka-Munk) pigment blending for the RGB channels; alpha is
 * linearly interpolated. t=0 => a, t=1 => b. Clamps t to [0,1]. Returns integer channels 0..255.
 */
export function mixSpectral(a: SpectralColor, b: SpectralColor, t: number): SpectralColor {
  t = t < 0 ? 0 : t > 1 ? 1 : t;

  if (t <= 0) return [...a];
  if (t >= 1) return [...b];

  const colorA = new spectral.Color([a[0], a[1], a[2]]);
  const colorB = new spectral.Color([b[0], b[1], b[2]]);

  const mixed = spectral.mix([colorA, 1 - t], [colorB, t]);
  const sRGB = mixed.sRGB as number[];

  const aOut = Math.round(a[3] * (1 - t) + b[3] * t);

  return [
    Math.round(sRGB[0]),
    Math.round(sRGB[1]),
    Math.round(sRGB[2]),
    aOut,
  ];
}
