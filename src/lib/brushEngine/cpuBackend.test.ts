import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCpuBrushBackend } from './cpuBackend';
import type { LayerBitmap } from '../../types/imageEditor';

class FakeCtx {
  readonly imageData: ImageData;
  constructor(width: number, height: number) {
    this.imageData = { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }
  getImageData(): ImageData {
    return { width: this.imageData.width, height: this.imageData.height, data: new Uint8ClampedArray(this.imageData.data) } as ImageData;
  }
  putImageData(img: ImageData, dx: number, dy: number, dirtyX = 0, dirtyY = 0, dirtyW = img.width, dirtyH = img.height): void {
    for (let y = dirtyY; y < dirtyY + dirtyH; y += 1) {
      for (let x = dirtyX; x < dirtyX + dirtyW; x += 1) {
        const so = (y * img.width + x) * 4;
        const to = ((dy + y) * this.imageData.width + (dx + x)) * 4;
        this.imageData.data.set(img.data.subarray(so, so + 4), to);
      }
    }
  }
}

class FakeOffscreenCanvas {
  readonly context: FakeCtx;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeCtx(width, height);
  }
  getContext(kind: string): FakeCtx | null {
    return kind === '2d' ? this.context : null;
  }
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function seedImageData(): ImageData {
  return {
    width: 4,
    height: 1,
    data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 200, 200, 200, 255, 200, 200, 200, 255]),
  } as ImageData;
}

describe('createCpuBrushBackend', () => {
  it('applies dabs to a resident buffer and writes back only on commit', () => {
    const backend = createCpuBrushBackend();
    const layer = new OffscreenCanvas(4, 1) as unknown as LayerBitmap;
    const seed = seedImageData();
    const session = backend.beginStroke({ source: seed, sampleSource: { imageData: seedImageData() }, width: 4, height: 1 });

    session.stampDab({ op: 'smudge', from: { x: 1, y: 0 }, to: { x: 2, y: 0 }, size: 2, strength: 1 });
    expect(session.dirtyRect()).not.toBeNull();

    // Nothing is written to the layer until commit.
    const ctx = (layer as unknown as FakeOffscreenCanvas).getContext('2d')!;
    expect(ctx.imageData.data[2 * 4]).toBe(0);

    const rect = session.commit(layer);
    expect(rect).not.toBeNull();
    expect(ctx.imageData.data[2 * 4]).toBeLessThan(200); // x2 smudged toward the dark drag origin
  });

  it('reports id cpu and a null dirty rect before any dab', () => {
    const backend = createCpuBrushBackend();
    expect(backend.id).toBe('cpu');
    const session = backend.beginStroke({ source: seedImageData(), sampleSource: { imageData: seedImageData() }, width: 4, height: 1 });
    expect(session.dirtyRect()).toBeNull();
  });
});
