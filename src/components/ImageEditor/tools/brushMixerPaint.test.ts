import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paintMixerDabs, sampleCanvasAverage, type MixerDabInput } from './brushMixerPaint';
import type { MixerColor } from '../ImageBrushMixer';

// ---------------------------------------------------------------------------
// Pixel-correct OffscreenCanvas + ImageData stubs for the Node test environment.
// These mirror the pattern used across the project (tiledCanvasInterop.test.ts)
// and are installed/uninstalled around every test via vi.stubGlobal.
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
// Helpers
// ---------------------------------------------------------------------------

function fill(ctx: FakeCtx, w: number, h: number, rgba: [number, number, number, number]): void {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) data.set(rgba, i * 4);
  ctx.putImageData(new FakeImageData(data, w, h), 0, 0);
}

/** Parse the `rgba(r,g,b,a)` strings emitted by paintMixerDabs back into a MixerColor (0..255). */
function parseRgba(css: string): MixerColor {
  const m = /rgba\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/.exec(css);
  if (!m) throw new Error(`unparseable css: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Math.round(Number(m[4]) * 255)];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sampleCanvasAverage', () => {
  it('returns the fill colour of a uniformly-coloured canvas', () => {
    const canvas = new OffscreenCanvas(40, 40);
    const ctx = canvas.getContext('2d')!;
    fill(ctx as unknown as FakeCtx, 40, 40, [10, 120, 230, 255]);
    const avg = sampleCanvasAverage(ctx, 20, 20, 8, 40, 40);
    expect(avg.map((c) => Math.round(c))).toEqual([10, 120, 230, 255]);
  });

  it('clamps the sampling box to the canvas and still averages the fill colour at a corner', () => {
    const canvas = new OffscreenCanvas(30, 30);
    const ctx = canvas.getContext('2d')!;
    fill(ctx as unknown as FakeCtx, 30, 30, [200, 50, 25, 255]);
    const avg = sampleCanvasAverage(ctx, 0, 0, 10, 30, 30);
    expect(avg.map((c) => Math.round(c))).toEqual([200, 50, 25, 255]);
  });

  it('returns transparent black when the sampling box is fully outside the canvas', () => {
    const canvas = new OffscreenCanvas(20, 20);
    const ctx = canvas.getContext('2d')!;
    fill(ctx as unknown as FakeCtx, 20, 20, [255, 255, 255, 255]);
    expect(sampleCanvasAverage(ctx, 100, 100, 4, 20, 20)).toEqual([0, 0, 0, 0]);
  });
});

describe('paintMixerDabs', () => {
  function newCanvas(w: number, h: number, rgba: [number, number, number, number]): OffscreenCanvas {
    const canvas = new OffscreenCanvas(w, h);
    fill(canvas.getContext('2d')! as unknown as FakeCtx, w, h, rgba);
    return canvas;
  }

  it('with smudgeLength 0 and colorRate 0 paints the sampled canvas colour (pure smudge)', () => {
    const canvas = newCanvas(40, 40, [30, 90, 150, 255]);
    const ctx = canvas.getContext('2d')!;
    const captured: string[] = [];
    const dabs: MixerDabInput[] = [{ x: 20, y: 20, index: 0 }];
    paintMixerDabs(ctx, dabs, {
      state: [0, 0, 0, 0],
      fg: [255, 0, 0, 255],
      smudgeLength: 0,
      colorRate: 0,
      smudgeRadius: 6,
      mixMode: 'rgb',
      layerX: 0, layerY: 0, width: 40, height: 40,
      paintDab: (_c, _dab, css) => captured.push(css),
    });
    expect(captured).toHaveLength(1);
    const [r, g, b, a] = parseRgba(captured[0]);
    expect([r, g, b]).toEqual([30, 90, 150]);
    expect(a).toBe(255);
  });

  it('with colorRate 1 paints the foreground colour (pure paint)', () => {
    const canvas = newCanvas(40, 40, [30, 90, 150, 255]);
    const ctx = canvas.getContext('2d')!;
    const captured: string[] = [];
    paintMixerDabs(ctx, [{ x: 20, y: 20 }], {
      state: [0, 0, 0, 0],
      fg: [255, 200, 10, 255],
      smudgeLength: 0,
      colorRate: 1,
      smudgeRadius: 6,
      mixMode: 'rgb',
      layerX: 0, layerY: 0, width: 40, height: 40,
      paintDab: (_c, _dab, css) => captured.push(css),
    });
    const [r, g, b] = parseRgba(captured[0]);
    expect([r, g, b]).toEqual([255, 200, 10]);
  });

  it('returns an updated smudge state that carries into the next call', () => {
    const canvas = newCanvas(40, 40, [100, 100, 100, 255]);
    const ctx = canvas.getContext('2d')!;
    const next = paintMixerDabs(ctx, [{ x: 20, y: 20 }], {
      state: [0, 0, 0, 0],
      fg: [0, 0, 0, 0],
      smudgeLength: 0,
      colorRate: 0,
      smudgeRadius: 6,
      mixMode: 'rgb',
      layerX: 0, layerY: 0, width: 40, height: 40,
      paintDab: () => {},
    });
    // smudgeLength 0 => state adopts the sampled colour immediately.
    expect(next.map((c) => Math.round(c))).toEqual([100, 100, 100, 255]);
  });

  it('smudgeMode "smearing" and "dulling" produce different sampled colours on a spot-vs-disc canvas', () => {
    // Canvas: a tiny bright-red centre spot (3×3 px centred at 20,20) surrounded by pure blue.
    // Dulling samples a large disc → average skews heavily toward blue.
    // Smearing samples only ≤2 px → picks up mostly the red centre spot.
    const W = 40, H = 40;
    const canvas = newCanvas(W, H, [0, 0, 255, 255]); // fill blue
    const ctx = canvas.getContext('2d')! as unknown as FakeCtx;
    // Paint red 3×3 patch centred at (20,20)
    const spot = new Uint8ClampedArray(3 * 3 * 4);
    for (let i = 0; i < 9; i++) spot.set([255, 0, 0, 255], i * 4);
    ctx.putImageData(new FakeImageData(spot, 3, 3), 19, 19);

    const baseParams = {
      state: [0, 0, 0, 0] as MixerColor,
      fg: [0, 0, 0, 255] as MixerColor,
      smudgeLength: 0,
      colorRate: 0,
      smudgeRadius: 15, // large disc for dulling; capped to 2 for smearing
      mixMode: 'rgb' as const,
      layerX: 0, layerY: 0, width: W, height: H,
    };

    const capturedDulling: string[] = [];
    paintMixerDabs(canvas.getContext('2d')!, [{ x: 20, y: 20 }], {
      ...baseParams,
      smudgeMode: 'dulling',
      paintDab: (_c, _dab, css) => capturedDulling.push(css),
    });

    const capturedSmearing: string[] = [];
    paintMixerDabs(canvas.getContext('2d')!, [{ x: 20, y: 20 }], {
      ...baseParams,
      smudgeMode: 'smearing',
      paintDab: (_c, _dab, css) => capturedSmearing.push(css),
    });

    const [rD, , bD] = parseRgba(capturedDulling[0]);
    const [rS, , bS] = parseRgba(capturedSmearing[0]);

    // Dulling averages a large disc → blue dominant
    expect(bD).toBeGreaterThan(rD);
    // Smearing samples only the tiny centre → red dominant
    expect(rS).toBeGreaterThan(bS);
    // The two modes must yield different colours
    expect(capturedDulling[0]).not.toBe(capturedSmearing[0]);
  });

  it('mixMode "spectral" with blue state + yellow fg at colorRate 0.5 yields a green-dominant colour', () => {
    // Blue canvas, yellow foreground. Spectral (pigment) mix of blue + yellow is green.
    const canvas = newCanvas(40, 40, [0, 0, 255, 255]);
    const ctx = canvas.getContext('2d')!;
    const captured: string[] = [];
    paintMixerDabs(ctx, [{ x: 20, y: 20 }], {
      state: [0, 0, 0, 0],
      fg: [255, 255, 0, 255],
      smudgeLength: 0, // state adopts the sampled blue
      colorRate: 0.5,
      smudgeRadius: 6,
      mixMode: 'spectral',
      layerX: 0, layerY: 0, width: 40, height: 40,
      paintDab: (_c, _dab, css) => captured.push(css),
    });
    const [r, g, b] = parseRgba(captured[0]);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
});
