import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../types/paper';
import {
  buildPaperBubbleConnectorSegments,
  buildPaperCompoundBubbleShapes,
  getPaperBubbleChainFrames,
  paperBubbleConnectorHandlePatch,
} from './paperBubbleChains';

function frame(overrides: Partial<PaperFrame>): PaperFrame {
  return {
    id: 'bubble',
    kind: 'speechBubble',
    label: 'Bubble',
    xMm: 10,
    yMm: 10,
    widthMm: 40,
    heightMm: 20,
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

describe('paper bubble chains', () => {
  it('orders chain frames by chain order before geometry fallback', () => {
    const frames = [
      frame({ id: 'third', xMm: 0, yMm: 0, bubbleChainId: 'line-a', bubbleChainOrder: 3 }),
      frame({ id: 'first', xMm: 120, yMm: 80, bubbleChainId: 'line-a', bubbleChainOrder: 1 }),
      frame({ id: 'second', xMm: 60, yMm: 20, bubbleChainId: 'line-a', bubbleChainOrder: 2 }),
      frame({ id: 'other-chain', bubbleChainId: 'line-b', bubbleChainOrder: 1 }),
    ];

    expect(getPaperBubbleChainFrames(frames, 'line-a').map((candidate) => candidate.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('builds connector segments between adjacent bubbles in each chain', () => {
    const segments = buildPaperBubbleConnectorSegments([
      frame({ id: 'a', xMm: 10, yMm: 20, widthMm: 30, heightMm: 18, bubbleChainId: 'line-a', bubbleChainOrder: 1 }),
      frame({ id: 'b', xMm: 62, yMm: 24, widthMm: 30, heightMm: 18, bubbleChainId: 'line-a', bubbleChainOrder: 2 }),
      frame({ id: 'c', xMm: 110, yMm: 50, widthMm: 30, heightMm: 18, bubbleChainId: 'line-a', bubbleChainOrder: 3, bubbleConnectorStyle: 'thought-dots' }),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      id: 'line-a:a:b',
      chainId: 'line-a',
      fromFrameId: 'a',
      toFrameId: 'b',
      style: 'line',
    });
    // Automatic anchors land on the actual organic body, not its rectangular frame bounds.
    expect(segments[0].from.xMm).toBeGreaterThan(38);
    expect(segments[0].from.xMm).toBeLessThan(40);
    expect(segments[0].to.xMm).toBeGreaterThan(62);
    expect(segments[0].to.xMm).toBeLessThan(64);
    expect(segments[1]).toMatchObject({
      id: 'line-a:b:c',
      style: 'thought-dots',
      fromFrameId: 'b',
      toFrameId: 'c',
    });
    expect(segments[1].dots.length).toBeGreaterThanOrEqual(3);
  });

  it('builds an organic cubic ribbon and one continuous compound outline for a same-speaker bridge', () => {
    const frames = [
      frame({ id: 'a', xMm: 10, yMm: 20, widthMm: 30, heightMm: 18, bubbleChainId: 'spk', bubbleChainOrder: 1, bubbleConnectorStyle: 'bridge' }),
      frame({ id: 'b', xMm: 60, yMm: 20, widthMm: 30, heightMm: 18, bubbleChainId: 'spk', bubbleChainOrder: 2, bubbleConnectorStyle: 'bridge' }),
    ];
    const segments = buildPaperBubbleConnectorSegments(frames);

    expect(segments).toHaveLength(1);
    expect(segments[0].style).toBe('bridge');
    const polygon = segments[0].bridgePolygon;
    expect(polygon.length).toBeGreaterThan(50);
    const xs = polygon.map((point) => point.xMm);
    const ys = polygon.map((point) => point.yMm);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(2);
    expect(segments[0].control1.yMm).not.toBeCloseTo(segments[0].from.yMm, 2);

    const compounds = buildPaperCompoundBubbleShapes(frames);
    expect(compounds).toHaveLength(1);
    expect(compounds[0].memberFrameIds).toEqual(['a', 'b']);
    expect(compounds[0].segmentIds).toEqual(['spk:a:b']);
    expect(compounds[0].outline.length).toBeGreaterThan(100);
    expect(compounds[0].path).toMatch(/^M .+ Z$/);
    expect((compounds[0].path.match(/\bM\b/g) ?? [])).toHaveLength(1);
  });

  it('stores dragged endpoints and independent cubic controls on the incoming link owner', () => {
    const from = frame({ id: 'a', xMm: 10, yMm: 20, bubbleChainId: 'spk', bubbleChainOrder: 1, bubbleConnectorStyle: 'bridge' });
    const to = frame({ id: 'b', xMm: 70, yMm: 30, bubbleChainId: 'spk', bubbleChainOrder: 2, bubbleConnectorStyle: 'bridge' });
    const segment = buildPaperBubbleConnectorSegments([from, to])[0];
    const endpointPatch = paperBubbleConnectorHandlePatch(segment, from, to, 'from-anchor', {
      xMm: from.xMm + from.widthMm / 2,
      yMm: from.yMm,
    });
    expect(endpointPatch.bubbleConnectorGeometry?.fromAngleDeg).toBeCloseTo(270, 1);

    const controlPatch = paperBubbleConnectorHandlePatch(segment, from, to, 'control-1', {
      xMm: (segment.from.xMm + segment.to.xMm) / 2,
      yMm: segment.from.yMm - 12,
    });
    expect(controlPatch.bubbleConnectorGeometry?.control1AlongPercent).toBeGreaterThan(30);
    expect(controlPatch.bubbleConnectorGeometry?.control1OffsetPercent).toBeLessThan(0);
  });

  it('keeps one speaker tail on the final balloon instead of cutting intermediate tails into the neck', () => {
    const compounds = buildPaperCompoundBubbleShapes([
      frame({
        id: 'first', xMm: 10, yMm: 20, widthMm: 30, heightMm: 18,
        tailXPercent: 50, tailYPercent: 220,
        bubbleChainId: 'tail-owner', bubbleChainOrder: 1, bubbleConnectorStyle: 'bridge',
      }),
      frame({
        id: 'final', xMm: 60, yMm: 20, widthMm: 30, heightMm: 18,
        tailXPercent: 72, tailYPercent: 92,
        bubbleChainId: 'tail-owner', bubbleChainOrder: 2, bubbleConnectorStyle: 'bridge',
      }),
    ]);

    expect(compounds).toHaveLength(1);
    expect(Math.max(...compounds[0].outline.map((point) => point.yMm))).toBeLessThan(50);
  });
});
