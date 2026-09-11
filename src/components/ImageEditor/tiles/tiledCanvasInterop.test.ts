import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TiledBitmap } from './TiledBitmap';
import { tiledBitmapToCanvas } from './tiledCanvasInterop';

// ---------------------------------------------------------------------------
// Pixel-correct OffscreenCanvas + ImageData stubs for the Node test environment.
// These mirror the pattern used across the project (selfTest.test.ts, etc.) and
// are installed/uninstalled around every test via vi.stubGlobal.
// ---------------------------------------------------------------------------

class FakeImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  constructor(dataOrWidth: Uint8ClampedArray | number, widthOrUndefined?: number, heightOrUndefined?: number) {
    if (dataOrWidth instanceof Uint8ClampedArray) {
      this.data = new Uint8ClampedArray(dataOrWidth);
      this.width = widthOrUndefined!;
      this.height = heightOrUndefined ?? dataOrWidth.length / 4 / widthOrUndefined!;
    } else {
      this.width = dataOrWidth;
      this.height = widthOrUndefined!;
      this.data = new Uint8ClampedArray(dataOrWidth * widthOrUndefined! * 4);
    }
  }
}

class FakeCtx {
  private readonly buf: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buf = new Uint8ClampedArray(width * height * 4);
  }
  putImageData(img: FakeImageData, dx: number, dy: number): void {
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const tx = dx + x;
        const ty = dy + y;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue;
        const src = (y * img.width + x) * 4;
        const dst = (ty * this.width + tx) * 4;
        this.buf[dst]     = img.data[src];
        this.buf[dst + 1] = img.data[src + 1];
        this.buf[dst + 2] = img.data[src + 2];
        this.buf[dst + 3] = img.data[src + 3];
      }
    }
  }
  getImageData(x: number, y: number, w: number, h: number): FakeImageData {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let py = 0; py < h; py += 1) {
      for (let px = 0; px < w; px += 1) {
        const src = ((y + py) * this.width + (x + px)) * 4;
        const dst = (py * w + px) * 4;
        out[dst]     = this.buf[src];
        out[dst + 1] = this.buf[src + 1];
        out[dst + 2] = this.buf[src + 2];
        out[dst + 3] = this.buf[src + 3];
      }
    }
    return new FakeImageData(out, w, h);
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly ctx: FakeCtx;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = new FakeCtx(width, height);
  }
  getContext(kind: string): FakeCtx | null {
    return kind === '2d' ? this.ctx : null;
  }
}

beforeEach(() => {
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Shared helper — used by all three tasks
// ---------------------------------------------------------------------------

function solid(w: number, h: number, rgba: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) data.set(rgba, i * 4);
  return new ImageData(data, w, h);
}

// ---------------------------------------------------------------------------
// Task 1
// ---------------------------------------------------------------------------

describe('tiledCanvasInterop', () => {
  it('tiledBitmapToCanvas writes tile pixels onto a canvas of the bitmap size', () => {
    const bmp = new TiledBitmap(300, 200);
    bmp.applyRegion(260, 10, solid(20, 20, [40, 80, 120, 255]));
    const canvas = tiledBitmapToCanvas(bmp);
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(200);
    const px = canvas.getContext('2d')!.getImageData(265, 15, 1, 1).data;
    expect(Array.from(px)).toEqual([40, 80, 120, 255]);
  });

  it('uses each bitmap\'s persisted tile size during canvas interop', () => {
    const bmp = new TiledBitmap(300, 200, 128);
    bmp.applyRegion(130, 10, solid(20, 20, [90, 80, 70, 255]));

    const canvas = tiledBitmapToCanvas(bmp);
    const px = canvas.getContext('2d')!.getImageData(135, 15, 1, 1).data;
    expect(Array.from(px)).toEqual([90, 80, 70, 255]);
  });

  // -------------------------------------------------------------------------
  // Task 2
  // -------------------------------------------------------------------------

  it('canvasToTiledBitmap captures a canvas into tiles', async () => {
    const { canvasToTiledBitmap } = await import('./tiledCanvasInterop');
    const src = new OffscreenCanvas(260, 100);
    src.getContext('2d')!.putImageData(solid(10, 10, [7, 8, 9, 255]), 250, 40);
    const bmp = canvasToTiledBitmap(src);
    expect(bmp.width).toBe(260);
    expect(Array.from(bmp.materializeRegion(255, 45, 1, 1).data)).toEqual([7, 8, 9, 255]);
  });

  it('canvasToTiledBitmap preserves a selected backend tile size', async () => {
    const { canvasToTiledBitmap } = await import('./tiledCanvasInterop');
    const source = new OffscreenCanvas(260, 100);
    const bitmap = canvasToTiledBitmap(source, 128);

    expect(bitmap.tileSize).toBe(128);
    expect(bitmap.tilesWide).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Task 3
  // -------------------------------------------------------------------------

  it('canvas -> tiled -> canvas is pixel-identical', async () => {
    const { canvasToTiledBitmap, tiledBitmapToCanvas: toBitmapCanvas } = await import('./tiledCanvasInterop');
    const src = new OffscreenCanvas(500, 400);
    const sctx = src.getContext('2d')!;
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let n = 0; n < 60; n += 1) {
      const w = 1 + Math.floor(rnd() * 90);
      const h = 1 + Math.floor(rnd() * 90);
      sctx.putImageData(solid(w, h, [Math.floor(rnd()*256), Math.floor(rnd()*256), Math.floor(rnd()*256), 255]), Math.floor(rnd()*(500-w)), Math.floor(rnd()*(400-h)));
    }
    const before = sctx.getImageData(0, 0, 500, 400).data;
    const after = toBitmapCanvas(canvasToTiledBitmap(src)).getContext('2d')!.getImageData(0, 0, 500, 400).data;
    let mismatches = 0;
    for (let i = 0; i < before.length; i += 1) if (before[i] !== after[i]) mismatches += 1;
    expect(mismatches).toBe(0);
  });
});
