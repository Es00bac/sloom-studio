import { describe, expect, it } from 'vitest';
import { advanceShuttleCursor, stepShuttleRate, toggleShuttlePlay } from './timelineTransport';

describe('timeline transport (JKL shuttle)', () => {
  it('L ramps forward 1x -> 2x -> 4x -> 8x and caps at 8x', () => {
    expect(stepShuttleRate(0, 1)).toBe(1);
    expect(stepShuttleRate(1, 1)).toBe(2);
    expect(stepShuttleRate(2, 1)).toBe(4);
    expect(stepShuttleRate(4, 1)).toBe(8);
    expect(stepShuttleRate(8, 1)).toBe(8);
  });

  it('J ramps reverse and a direction change resets to 1x in the new direction', () => {
    expect(stepShuttleRate(0, -1)).toBe(-1);
    expect(stepShuttleRate(-1, -1)).toBe(-2);
    expect(stepShuttleRate(-4, -1)).toBe(-8);
    // direction flips always restart at 1x — L while reversing plays forward at 1x
    expect(stepShuttleRate(-8, 1)).toBe(1);
    expect(stepShuttleRate(4, -1)).toBe(-1);
  });

  it('space toggles play/pause and always resumes FORWARD', () => {
    expect(toggleShuttlePlay(0)).toBe(1);
    expect(toggleShuttlePlay(1)).toBe(0);
    expect(toggleShuttlePlay(-4)).toBe(0);
  });

  it('advances by rate * dt and stops cleanly at the sequence ends', () => {
    expect(advanceShuttleCursor(1, 2, 500, 10)).toEqual({ nextSeconds: 2, stopped: false });
    expect(advanceShuttleCursor(9.9, 1, 500, 10)).toEqual({ nextSeconds: 10, stopped: true });
    expect(advanceShuttleCursor(0.05, -1, 500, 10)).toEqual({ nextSeconds: 0, stopped: true });
    // clamping at an end while moving AWAY from it does not stop the transport
    expect(advanceShuttleCursor(0, 1, 100, 10)).toEqual({ nextSeconds: 0.1, stopped: false });
  });
});
