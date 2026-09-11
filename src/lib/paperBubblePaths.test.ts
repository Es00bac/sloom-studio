import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../types/paper';
import { buildPaperBubblePath, resolveBubbleTailCurveHandle } from './paperBubblePaths';

function bubbleFrame(overrides: Partial<PaperFrame> = {}): PaperFrame {
  return {
    id: 'bubble-1',
    kind: 'speechBubble',
    label: 'Speech Bubble',
    xMm: 0,
    yMm: 0,
    widthMm: 50,
    heightMm: 30,
    rotationDeg: 0,
    locked: false,
    fit: 'cover',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    columns: 1,
    typography: {
      fontFamily: 'Inter',
      fontSizePt: 10,
      leadingPt: 13,
      tracking: 0,
      align: 'center',
      hyphenate: false,
      color: '#111827',
      fontWeight: '400',
      fontStyle: 'normal',
    },
    fillColor: '#ffffff',
    fillOpacity: 1,
    strokeColor: '#111827',
    strokeOpacity: 1,
    strokeWidthMm: 0.35,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity: 1,
    textBoxXPercent: 12,
    textBoxYPercent: 18,
    textBoxWidthPercent: 76,
    textBoxHeightPercent: 48,
    textRotationDeg: 0,
    textVerticalAlign: 'middle',
    zIndex: 0,
    ...overrides,
  };
}

describe('paper bubble paths', () => {
  it('preserves tail coordinates outside the bubble viewbox', () => {
    expect(buildPaperBubblePath(bubbleFrame({
      tailXPercent: 160,
      tailYPercent: -90,
    }))).toContain('160 -90');
  });

  it('builds speech tails as a continuous curved outline instead of straight funnel lines', () => {
    const path = buildPaperBubblePath(bubbleFrame({
      bubblePinchXPercent: 58,
      bubblePinchYPercent: 75,
      bubbleTailCurvePercent: 82,
      tailXPercent: 72,
      tailYPercent: 92,
    }));

    expect(path).toContain('C');
    expect(path).not.toContain('L 72 92');
    expect(path.trim().endsWith('Z')).toBe(true);
  });

  it('uses cubic body curves instead of arc commands whose sweep can escape the resize box', () => {
    const path = buildPaperBubblePath(bubbleFrame({
      bubblePinchXPercent: 58,
      bubblePinchYPercent: 75,
      tailXPercent: 72,
      tailYPercent: 92,
    }));

    expect(path).toContain(' C ');
    expect(path).not.toContain(' A ');
    expect(path).not.toMatch(/\sL\s/);
  });

  it('uses the tail curve amount for speech and thought bubble stems', () => {
    const speechStraight = buildPaperBubblePath(bubbleFrame({
      bubbleTailCurvePercent: 50,
    }));
    const speechCurved = buildPaperBubblePath(bubbleFrame({
      bubbleTailCurvePercent: 90,
    }));
    const thoughtStraight = buildPaperBubblePath(bubbleFrame({
      kind: 'thoughtBubble',
      bubbleTailCurvePercent: 50,
    }));
    const thoughtCurved = buildPaperBubblePath(bubbleFrame({
      kind: 'thoughtBubble',
      bubbleTailCurvePercent: 90,
    }));

    expect(speechCurved).not.toBe(speechStraight);
    expect(thoughtCurved).not.toBe(thoughtStraight);
  });

  it('resolves a tail curve handle on the curved stem', () => {
    expect(resolveBubbleTailCurveHandle(bubbleFrame({
      bubblePinchXPercent: 58,
      bubblePinchYPercent: 75,
      bubbleTailCurvePercent: 80,
      tailXPercent: 72,
      tailYPercent: 92,
    }))).toEqual({
      x: 65.872,
      y: 91.137,
    });
  });

  // The user's complaint: the four side handles all "did the same thing to the entire bubble". Each side
  // must now move its own edge, so warping one side produces a distinct outline from warping any other.
  it('warps each bubble side independently', () => {
    const tail = {
      tailXPercent: 72,
      tailYPercent: 92,
      bubblePinchXPercent: 58,
      bubblePinchYPercent: 75,
    } as const;
    const base = buildPaperBubblePath(bubbleFrame({ ...tail }));
    const leftOnly = buildPaperBubblePath(bubbleFrame({ ...tail, bubbleWarpLeft: 0.8 }));
    const rightOnly = buildPaperBubblePath(bubbleFrame({ ...tail, bubbleWarpRight: 0.8 }));
    const topOnly = buildPaperBubblePath(bubbleFrame({ ...tail, bubbleWarpTop: 0.8 }));
    const bottomOnly = buildPaperBubblePath(bubbleFrame({ ...tail, bubbleWarpBottom: 0.8 }));

    // Every side actually reshapes the outline...
    expect(leftOnly).not.toBe(base);
    expect(rightOnly).not.toBe(base);
    expect(topOnly).not.toBe(base);
    expect(bottomOnly).not.toBe(base);
    // ...and no two sides produce the same outline (they are no longer one shared control).
    expect(new Set([leftOnly, rightOnly, topOnly, bottomOnly]).size).toBe(4);
  });

  // Byte-identity guard: a bubble with no per-side fields renders from the symmetric fallback. Setting all
  // four sides to that same fallback magnitude (0.18 = the default bubbleWarp) must reproduce the exact
  // same path, proving pre-existing (symmetric) bubbles are untouched by the per-side code path.
  it('keeps symmetric bubbles byte-identical to the legacy fallback path', () => {
    const viaFallback = buildPaperBubblePath(bubbleFrame());
    const viaEqualSides = buildPaperBubblePath(bubbleFrame({
      bubbleWarpLeft: 0.18,
      bubbleWarpRight: 0.18,
      bubbleWarpTop: 0.18,
      bubbleWarpBottom: 0.18,
    }));
    expect(viaEqualSides).toBe(viaFallback);
  });
});
