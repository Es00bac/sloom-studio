import { describe, expect, it } from 'vitest';
import { computeFitToTextFrameHeightMm, DEFAULT_FRAME_OVERSET_EPSILON_PX, isFrameContentOverset } from './frameOverflow';

describe('isFrameContentOverset', () => {
  it('is false when content fits exactly within the box', () => {
    expect(isFrameContentOverset(200, 200)).toBe(false);
  });

  it('is false when content is smaller than the box', () => {
    expect(isFrameContentOverset(150, 200)).toBe(false);
  });

  it('is true when content clearly exceeds the box', () => {
    expect(isFrameContentOverset(260, 200)).toBe(true);
  });

  it('tolerates the default epsilon (1px) of subpixel jitter without flagging overset', () => {
    expect(isFrameContentOverset(201, 200, DEFAULT_FRAME_OVERSET_EPSILON_PX)).toBe(false);
    expect(isFrameContentOverset(200 + DEFAULT_FRAME_OVERSET_EPSILON_PX, 200)).toBe(false);
  });

  it('flags overset just past the epsilon tolerance', () => {
    expect(isFrameContentOverset(200 + DEFAULT_FRAME_OVERSET_EPSILON_PX + 0.01, 200)).toBe(true);
  });

  it('honours a custom epsilon', () => {
    expect(isFrameContentOverset(205, 200, 10)).toBe(false);
    expect(isFrameContentOverset(211, 200, 10)).toBe(true);
  });
});

describe('computeFitToTextFrameHeightMm', () => {
  it('grows the frame to the measured content height when the text box has no inset (heightPercent 100, the plain text/caption case)', () => {
    const result = computeFitToTextFrameHeightMm({
      contentBoxHeightMm: 50,
      textBoxHeightPercent: 100,
      currentHeightMm: 30,
    });
    expect(result).toBe(50);
  });

  it('never shrinks below the current height when the content already fits', () => {
    const result = computeFitToTextFrameHeightMm({
      contentBoxHeightMm: 20,
      textBoxHeightPercent: 100,
      currentHeightMm: 30,
    });
    expect(result).toBe(30);
  });

  it('divides by the textBox height inset so the inset proportions survive the grow (e.g. a 50%-tall text box)', () => {
    const result = computeFitToTextFrameHeightMm({
      contentBoxHeightMm: 20,
      textBoxHeightPercent: 50,
      currentHeightMm: 10,
    });
    // The text box only occupies half the frame's height, so the frame must be twice the content height.
    expect(result).toBe(40);
  });

  it('clamps an out-of-range heightPercent (<=0) instead of dividing by zero', () => {
    const result = computeFitToTextFrameHeightMm({
      contentBoxHeightMm: 10,
      textBoxHeightPercent: 0,
      currentHeightMm: 1,
    });
    expect(Number.isFinite(result)).toBe(true);
    // Clamped to the 1% floor: 10 / 0.01 = 1000.
    expect(result).toBe(1000);
  });

  it('clamps an out-of-range heightPercent (>100) back down to 100', () => {
    const result = computeFitToTextFrameHeightMm({
      contentBoxHeightMm: 50,
      textBoxHeightPercent: 150,
      currentHeightMm: 1,
    });
    expect(result).toBe(50);
  });

  it('rounds the result to a stable mm precision', () => {
    const result = computeFitToTextFrameHeightMm({
      contentBoxHeightMm: 10.000123456,
      textBoxHeightPercent: 100,
      currentHeightMm: 1,
    });
    expect(result).toBe(10);
  });
});
