import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolEnv } from './types';
import type { ImageDocument } from '../../../types/imageEditor';

let sampleBitmap = { width: 10, height: 10 };
type DrawImageArgs = Parameters<CanvasRenderingContext2D['drawImage']>;

vi.mock('../ImageAdjustmentLayer', () => ({
  renderImageDocumentLayersToBitmap: () => sampleBitmap,
}));

vi.mock('../ImageLayerEffects', () => ({
  renderLayerWithEffects: () => ({ bitmap: sampleBitmap, offsetX: 0, offsetY: 0 }),
}));

let drawImageArgs: DrawImageArgs | undefined;

const sampleContext = {
  drawImage: vi.fn((...args: DrawImageArgs) => {
    drawImageArgs = args;
  }),
  getImageData: vi.fn(() => {
    const x = drawImageArgs?.[1] === 2 && drawImageArgs?.[2] === 3 ? 2 : 0;
    const y = drawImageArgs?.[1] === 2 && drawImageArgs?.[2] === 3 ? 3 : 0;
    if (x === 2 && y === 3) {
      return { data: new Uint8ClampedArray([18, 52, 86, 255]) };
    }
    return { data: new Uint8ClampedArray([18, 52, 86, 0]) };
  }),
};

class FakeSampleCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return sampleContext;
  }
}

describe('eyedropperTool', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeSampleCanvas as unknown as typeof OffscreenCanvas;
    drawImageArgs = undefined;
    vi.clearAllMocks();
  });

  it('samples the current canvas pixel (floored point) into the foreground brush color', async () => {
    const setBrushSettings = vi.fn();
    const { eyedropperTool } = await import('./eyedropperTool');
    sampleBitmap = { width: 10, height: 10 };
    const doc = {
      width: 10,
      height: 10,
      layers: [],
    } as unknown as ImageDocument;

    sampleContext.drawImage.mockClear();
    sampleContext.getImageData.mockClear();
    const env = {
      doc,
      activeLayer: null,
      store: { setBrushSettings },
    } as unknown as ToolEnv;

    eyedropperTool.onPointerDown?.(
      env,
      { x: 2.8, y: 3.1 },
      { shift: false, alt: false, ctrl: false, meta: false },
      { buttons: 1 } as PointerEvent,
    );

    expect(setBrushSettings).toHaveBeenCalledWith({ color: '#123456' });
    expect(sampleContext.drawImage).toHaveBeenCalledWith(sampleBitmap, 2, 3, 1, 1, 0, 0, 1, 1);
  });

  it('does not apply an opaque brush color when the sampled pixel is fully transparent', async () => {
    const setBrushSettings = vi.fn();
    const { eyedropperTool } = await import('./eyedropperTool');
    sampleBitmap = { width: 10, height: 10 };
    const doc = {
      width: 10,
      height: 10,
      layers: [],
    } as unknown as ImageDocument;

    sampleContext.drawImage.mockClear();
    sampleContext.getImageData.mockClear();
    const env = {
      doc,
      activeLayer: null,
      store: { setBrushSettings },
    } as unknown as ToolEnv;

    eyedropperTool.onPointerDown?.(
      env,
      { x: 4.2, y: 5.8 },
      { shift: false, alt: false, ctrl: false, meta: false },
      { buttons: 1 } as PointerEvent,
    );

    expect(setBrushSettings).not.toHaveBeenCalled();
  });
});
