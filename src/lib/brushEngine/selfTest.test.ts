import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCpuBrushBackend } from './cpuBackend';
import { backendProducesCorrectOutput, maxBackendChannelDiff } from './selfTest';
import type { BrushBackend } from './backend';
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

/** Wraps a backend so its committed output is corrupted, simulating a GPU that computes garbage. */
function corruptingBackend(inner: BrushBackend, addToRed: number): BrushBackend {
  return {
    id: inner.id,
    beginStroke(params) {
      const session = inner.beginStroke(params);
      const { width, height } = params;
      const commit = (target: LayerBitmap) => {
        const rect = session.commit(target);
        const ctx = target.getContext('2d');
        if (ctx && rect) {
          const img = ctx.getImageData(0, 0, width, height);
          for (let i = 0; i < img.data.length; i += 4) img.data[i] = Math.min(255, img.data[i] + addToRed);
          ctx.putImageData(img, 0, 0);
        }
        return rect;
      };
      return { ...session, commit, previewInto: commit };
    },
  };
}

describe('brush backend self-test', () => {
  it('reports zero difference when comparing the CPU reference against itself', () => {
    expect(maxBackendChannelDiff(createCpuBrushBackend(), createCpuBrushBackend())).toBe(0);
  });

  it('trusts a backend whose output matches the reference', () => {
    expect(backendProducesCorrectOutput(createCpuBrushBackend(), createCpuBrushBackend())).toBe(true);
  });

  it('rejects a backend that produces grossly wrong output', () => {
    const broken = corruptingBackend(createCpuBrushBackend(), 100);
    expect(maxBackendChannelDiff(broken, createCpuBrushBackend())).toBeGreaterThan(16);
    expect(backendProducesCorrectOutput(broken, createCpuBrushBackend())).toBe(false);
  });

  it('tolerates small differences within the rounding budget', () => {
    const slightlyOff = corruptingBackend(createCpuBrushBackend(), 3);
    expect(backendProducesCorrectOutput(slightlyOff, createCpuBrushBackend())).toBe(true);
  });
});
