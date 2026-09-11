// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TiltmarkBrushDab } from '../../../components/ImageEditor/tiltmark/TiltmarkTypes';
import { useHaneStrokePreviewStore } from '../../../lib/haneStrokePreview';
import type { PaperFrame } from '../../../types/paper';
import { PaperHaneStrokePreviewCanvas } from './PaperHaneStrokePreviewCanvas';

vi.mock('../../../components/ImageEditor/tiltmark/TiltmarkRenderer', () => ({
  renderTiltmarkDabs: vi.fn(),
}));

const frame = {
  id: 'frame-4',
  kind: 'image',
  fit: 'cover',
  widthMm: 120,
  heightMm: 80,
  imageScale: 1,
  imageOffsetXPercent: 0,
  imageOffsetYPercent: 0,
  imageRotationDeg: 0,
  imageFlipX: false,
  imageFlipY: false,
  asset: {
    label: 'Linked art',
    kind: 'image',
    pixelWidth: 600,
    pixelHeight: 400,
  },
} as PaperFrame;

const dab = {
  index: 0,
  x: 12,
  y: 18,
  width: 8,
  height: 4,
  rotationRad: 0,
  shape: 'ellipse',
  color: '#315c9c',
  opacity: 0.8,
  flow: 0.5,
  hardness: 0.4,
  grain: 0,
  wetness: 0,
  solvent: 0,
  strandCount: 0,
  particleCount: 0,
  spread: 0,
  interaction: 'paint',
  pickup: 0,
  colorMix: 0,
  bristleBend: 0,
  bristleSplay: 0,
  bristleCohesion: 1,
  paintLoad: 1,
  seed: 1,
  eraser: false,
} satisfies TiltmarkBrushDab;

afterEach(() => {
  useHaneStrokePreviewStore.setState({
    status: 'idle',
    sessionId: null,
    targetId: null,
    version: 0,
    installedRasterEpoch: 0,
    documentWidth: 1,
    documentHeight: 1,
    overlays: [],
    error: null,
  });
});

describe('Paper Hane stroke-preview overlay', () => {
  it('mounts only on the leased frame at the durable image pixel dimensions', () => {
    useHaneStrokePreviewStore.setState({
      status: 'streaming',
      sessionId: 'paper-session',
      targetId: 'page-2:frame-4',
      version: 12,
      installedRasterEpoch: 8,
      documentWidth: 1200,
      documentHeight: 800,
      overlays: [{
        strokeId: 'stroke-1',
        dabs: [dab],
        pendingAcceptedRasterEpoch: null,
      }],
      error: null,
    });

    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(<PaperHaneStrokePreviewCanvas frame={frame} pageId="page-2" />);
    });
    const canvas = container.querySelector('canvas');
    expect(canvas?.dataset.haneStrokePreview).toBe('ephemeral');
    expect(canvas?.dataset.haneStrokePreviewVersion).toBe('12');
    expect(canvas?.width).toBe(1200);
    expect(canvas?.height).toBe(800);

    act(() => {
      root.render(<PaperHaneStrokePreviewCanvas frame={frame} pageId="page-9" />);
    });
    expect(container.innerHTML).toBe('');
    act(() => root.unmount());
  });
});
