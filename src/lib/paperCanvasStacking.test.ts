import { describe, expect, it } from 'vitest';
import type { PaperFrame } from '../types/paper';
import {
  PAPER_CANVAS_FRAME_Z_START,
  PAPER_CANVAS_GUIDE_Z,
  buildPaperCanvasBubbleConnectorLayers,
  buildPaperCanvasFrameLayers,
  resolvePaperCanvasFrameOpacity,
} from './paperCanvasStacking';

function frame(id: string, zIndex: number): PaperFrame {
  return {
    id,
    kind: 'caption',
    label: id,
    xMm: 0,
    yMm: 0,
    widthMm: 20,
    heightMm: 10,
    rotationDeg: 0,
    locked: false,
    text: id,
    typography: {
      fontFamily: 'Inter',
      fontSizePt: 10,
      leadingPt: 12,
      tracking: 0,
      align: 'left',
      hyphenate: true,
      color: '#111827',
      fontWeight: '400',
      fontStyle: 'normal',
    },
    columns: 1,
    fillColor: '#ffffff',
    fillOpacity: 1,
    strokeColor: '#111827',
    strokeOpacity: 1,
    strokeWidthMm: 0.25,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity: 1,
    fit: 'cover',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    textBoxXPercent: 0,
    textBoxYPercent: 0,
    textBoxWidthPercent: 100,
    textBoxHeightPercent: 100,
    textRotationDeg: 0,
    textVerticalAlign: 'top',
    zIndex,
  };
}

describe('paperCanvasStacking', () => {
  it('maps canonical back-to-front input into positive local canvas layers below Paper overlays', () => {
    const layers = buildPaperCanvasFrameLayers([
      frame('inherited-low', -100000),
      frame('caption-mid', 0),
      frame('local-high', 400),
    ]);

    expect(layers.map((layer) => [layer.frame.id, layer.canvasZIndex])).toEqual([
      ['inherited-low', PAPER_CANVAS_FRAME_Z_START],
      ['caption-mid', PAPER_CANVAS_FRAME_Z_START + 1],
      ['local-high', PAPER_CANVAS_FRAME_Z_START + 2],
    ]);
    expect(layers.every((layer) => layer.canvasZIndex > 0)).toBe(true);
    expect(layers.every((layer) => layer.canvasZIndex < PAPER_CANVAS_GUIDE_Z)).toBe(true);
  });

  it('does not destroy document-layer order by globally re-sorting frame z-indexes', () => {
    const layers = buildPaperCanvasFrameLayers([
      { ...frame('back-layer-high-z', 900), layerId: 'back' },
      { ...frame('front-layer-low-z', 1), layerId: 'front' },
    ]);
    expect(layers.map((layer) => layer.frame.id)).toEqual([
      'back-layer-high-z',
      'front-layer-low-z',
    ]);
  });

  it('shows inherited artwork at its authored opacity so the canvas matches export', () => {
    expect(resolvePaperCanvasFrameOpacity(frame('parent-rule', 0))).toBe(1);
    const translucentParent: PaperFrame = { ...frame('parent-overlay', 0), inherited: true, opacity: 0.42 };
    const solidParent: PaperFrame = { ...frame('parent-solid', 0), inherited: true, opacity: 1 };
    expect(resolvePaperCanvasFrameOpacity(translucentParent)).toBe(0.42);
    expect(resolvePaperCanvasFrameOpacity(solidParent)).toBe(1);
  });

  it('layers bubble connectors above preceding artwork and below both linked bubbles', () => {
    const layers = buildPaperCanvasBubbleConnectorLayers([
      { ...frame('panel-art', 0), kind: 'image' },
      {
        ...frame('bubble-a', 1),
        kind: 'speechBubble',
        bubbleChainId: 'dialogue',
        bubbleChainOrder: 1,
        bubbleConnectorStyle: 'bridge',
      },
      {
        ...frame('bubble-b', 2),
        kind: 'speechBubble',
        xMm: 35,
        bubbleChainId: 'dialogue',
        bubbleChainOrder: 2,
        bubbleConnectorStyle: 'bridge',
      },
    ]);

    expect(layers).toHaveLength(1);
    expect(layers[0].canvasZIndex).toBe(PAPER_CANVAS_FRAME_Z_START + 1);
    expect(layers[0].canvasZIndex).toBeGreaterThan(PAPER_CANVAS_FRAME_Z_START);
    expect(layers[0].segments).toEqual([]);
    expect(layers[0].compoundShapes).toEqual([
      expect.objectContaining({
        memberFrameIds: ['bubble-a', 'bubble-b'],
        segmentIds: [expect.stringContaining('bubble-a:bubble-b')],
      }),
    ]);
  });

  it('uses separate connector layers when a chain crosses different bubble stack levels', () => {
    const layers = buildPaperCanvasBubbleConnectorLayers([
      {
        ...frame('bubble-low', 0),
        kind: 'speechBubble',
        bubbleChainId: 'low-chain',
        bubbleChainOrder: 1,
      },
      {
        ...frame('bubble-low-next', 1),
        kind: 'speechBubble',
        xMm: 30,
        bubbleChainId: 'low-chain',
        bubbleChainOrder: 2,
      },
      { ...frame('foreground-art', 2), kind: 'image' },
      {
        ...frame('bubble-high', 3),
        kind: 'speechBubble',
        yMm: 30,
        bubbleChainId: 'high-chain',
        bubbleChainOrder: 1,
      },
      {
        ...frame('bubble-high-next', 4),
        kind: 'speechBubble',
        xMm: 30,
        yMm: 30,
        bubbleChainId: 'high-chain',
        bubbleChainOrder: 2,
      },
    ]);

    expect(layers.map((layer) => layer.canvasZIndex)).toEqual([
      PAPER_CANVAS_FRAME_Z_START,
      PAPER_CANVAS_FRAME_Z_START + 3,
    ]);
  });
});
