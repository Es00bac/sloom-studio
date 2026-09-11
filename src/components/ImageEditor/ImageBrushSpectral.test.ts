import { describe, expect, it } from 'vitest';
import { mixSpectral, type SpectralColor } from './ImageBrushSpectral';

const BLUE: SpectralColor = [0, 33, 133, 255];   // a saturated blue
const YELLOW: SpectralColor = [252, 210, 0, 255]; // a saturated yellow

describe('ImageBrushSpectral', () => {
  it('t=0 returns the first colour, t=1 returns the second', () => {
    expect(mixSpectral(BLUE, YELLOW, 0)).toEqual(BLUE);
    expect(mixSpectral(BLUE, YELLOW, 1)).toEqual(YELLOW);
  });
  it('blue + yellow mixes toward GREEN (green is the dominant channel) — the whole point of spectral', () => {
    const mid = mixSpectral(BLUE, YELLOW, 0.5);
    // a real pigment mix is green: G clearly the largest channel, and not a muddy gray.
    expect(mid[1]).toBeGreaterThan(mid[0]); // G > R
    expect(mid[1]).toBeGreaterThan(mid[2]); // G > B
    expect(mid[1]).toBeGreaterThan(110);
  });
  it('alpha interpolates linearly', () => {
    expect(mixSpectral([0, 0, 0, 0], [0, 0, 0, 200], 0.5)[3]).toBe(100);
  });
  it('mixing a grey with itself stays that grey (no colour shift)', () => {
    const g: SpectralColor = [128, 128, 128, 255];
    const r = mixSpectral(g, g, 0.5);
    // allow tiny rounding from the spectral round-trip
    expect(Math.abs(r[0] - 128)).toBeLessThanOrEqual(3);
    expect(Math.abs(r[1] - 128)).toBeLessThanOrEqual(3);
    expect(Math.abs(r[2] - 128)).toBeLessThanOrEqual(3);
  });
});
