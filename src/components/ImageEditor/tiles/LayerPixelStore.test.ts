import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasPixelStore, TiledPixelStore } from './LayerPixelStore';

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
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    }
  }
}

class FakeContext {
  private readonly data: Uint8ClampedArray;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  putImageData(image: FakeImageData, dx: number, dy: number): void {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const targetX = dx + x;
        const targetY = dy + y;
        if (targetX < 0 || targetY < 0 || targetX >= this.width || targetY >= this.height) continue;
        const sourceOffset = (y * image.width + x) * 4;
        const targetOffset = (targetY * this.width + targetX) * 4;
        this.data.set(image.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
  }

  getImageData(x: number, y: number, width: number, height: number): FakeImageData {
    const output = new Uint8ClampedArray(width * height * 4);
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const sourceX = x + px;
        const sourceY = y + py;
        if (sourceX < 0 || sourceY < 0 || sourceX >= this.width || sourceY >= this.height) continue;
        const sourceOffset = (sourceY * this.width + sourceX) * 4;
        const targetOffset = (py * width + px) * 4;
        output.set(this.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
    return new FakeImageData(output, width, height);
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(width, height);
  }

  getContext(kind: string): FakeContext | null {
    return kind === '2d' ? this.context : null;
  }
}

function solid(width: number, height: number, rgba: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set(rgba, index * 4);
  return new ImageData(data, width, height);
}

beforeEach(() => {
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CanvasPixelStore', () => {
  it('wraps the current canvas backend behind revisioned region reads and writes', () => {
    const store = new CanvasPixelStore(new OffscreenCanvas(8, 6), { tileSize: 4 });

    const mutation = store.writeRegion(
      { x: 2, y: 1, width: 2, height: 2 },
      solid(2, 2, [11, 22, 33, 255]),
    );

    expect(mutation).toMatchObject({ revision: 1, touchedTileCount: 1, prunedTileCount: 0 });
    expect(store.revision).toBe(1);
    expect(store.getTileRevision(0, 0)).toBe(1);
    expect(Array.from(store.readRegion({ x: 2, y: 1, width: 1, height: 1 }).data)).toEqual([11, 22, 33, 255]);
  });

  it('restores an opaque snapshot and releases its retained bytes on disposal', () => {
    const store = new CanvasPixelStore(new OffscreenCanvas(8, 6), { tileSize: 4 });
    store.writeRegion({ x: 1, y: 1, width: 1, height: 1 }, solid(1, 1, [1, 2, 3, 255]));
    const snapshot = store.snapshot();
    expect('pixels' in snapshot).toBe(false);
    expect(store.estimateRetainedBytes()).toBe(8 * 6 * 4 * 2);

    store.writeRegion({ x: 1, y: 1, width: 1, height: 1 }, solid(1, 1, [9, 9, 9, 255]));
    store.restore(snapshot);
    expect(Array.from(store.readRegion({ x: 1, y: 1, width: 1, height: 1 }).data)).toEqual([1, 2, 3, 255]);

    snapshot.dispose();
    expect(store.estimateRetainedBytes()).toBe(8 * 6 * 4);
  });
});

describe('TiledPixelStore', () => {
  it('provides sparse revisioned region I/O and revision-keyed canvas materialization', () => {
    const store = new TiledPixelStore(300, 200, { tileSize: 128 });

    const mutation = store.writeRegion(
      { x: 120, y: 10, width: 20, height: 20 },
      solid(20, 20, [70, 80, 90, 255]),
    );

    expect(store.kind).toBe('tiled');
    expect(mutation).toMatchObject({ revision: 1, touchedTileCount: 2, prunedTileCount: 0 });
    expect(store.tileCount).toBe(2);
    expect(store.getTileRevision(0, 0)).toBe(1);
    expect(store.getTileRevision(1, 0)).toBe(1);
    expect(Array.from(store.readRegion({ x: 125, y: 15, width: 1, height: 1 }).data)).toEqual([70, 80, 90, 255]);

    const firstMaterialization = store.materializeCanvas();
    expect(store.materializeCanvas()).toBe(firstMaterialization);
    store.writeRegion({ x: 0, y: 0, width: 1, height: 1 }, solid(1, 1, [1, 2, 3, 255]));
    expect(store.materializeCanvas()).not.toBe(firstMaterialization);
  });

  it('includes retained materialization-cache pixels in its byte estimate', () => {
    const store = new TiledPixelStore(300, 200, { tileSize: 128 });
    store.writeRegion({ x: 10, y: 10, width: 1, height: 1 }, solid(1, 1, [1, 2, 3, 255]));
    const tileBytes = 128 * 128 * 4;
    expect(store.estimateRetainedBytes()).toBe(tileBytes);

    store.materializeCanvas({ x: 0, y: 0, width: 20, height: 10 });

    expect(store.estimateRetainedBytes()).toBe(tileBytes + 20 * 10 * 4);
  });

  it('reports tile-bounded dirtiness when restoring a local snapshot', () => {
    const store = new TiledPixelStore(1024, 1024, { tileSize: 128 });
    store.writeRegion({ x: 10, y: 10, width: 1, height: 1 }, solid(1, 1, [1, 2, 3, 255]));
    store.writeRegion({ x: 900, y: 900, width: 1, height: 1 }, solid(1, 1, [4, 5, 6, 255]));
    const snapshot = store.snapshot();
    store.writeRegion({ x: 20, y: 20, width: 1, height: 1 }, solid(1, 1, [9, 8, 7, 255]));

    const mutation = store.restore(snapshot);

    expect(mutation.dirtyRect).toEqual({ x: 0, y: 0, width: 128, height: 128 });
    snapshot.dispose();
  });

  it('retains only unique COW tile buffers and releases them with snapshot history', () => {
    const store = new TiledPixelStore(1024, 1024, { tileSize: 128 });
    const tileBytes = 128 * 128 * 4;
    store.writeRegion({ x: 10, y: 10, width: 1, height: 1 }, solid(1, 1, [1, 2, 3, 255]));
    const snapshot = store.snapshot();

    expect(store.estimateRetainedBytes()).toBe(tileBytes);
    store.writeRegion({ x: 10, y: 10, width: 1, height: 1 }, solid(1, 1, [9, 8, 7, 255]));
    expect(store.estimateRetainedBytes()).toBe(tileBytes * 2);

    snapshot.dispose();
    expect(store.estimateRetainedBytes()).toBe(tileBytes);
    store.dispose();
    expect(store.estimateRetainedBytes()).toBe(0);
  });

  it('keeps a 4K local stroke history proportional to touched tiles', () => {
    const store = new TiledPixelStore(3840, 2160, { tileSize: 256 });
    const tileBytes = 256 * 256 * 4;
    const documentBytes = 3840 * 2160 * 4;
    store.writeRegion({ x: 100, y: 100, width: 32, height: 32 }, solid(32, 32, [10, 20, 30, 255]));
    const before = store.snapshot();

    store.writeRegion({ x: 110, y: 110, width: 16, height: 16 }, solid(16, 16, [40, 50, 60, 255]));

    expect(store.tileCount).toBe(1);
    expect(store.estimateRetainedBytes()).toBe(tileBytes * 2);
    expect(store.estimateRetainedBytes()).toBeLessThan(documentBytes / 50);
    before.dispose();
  });
});

describe('LayerPixelStore parity', () => {
  it.each(['canvas', 'tiled'] as const)('keeps %s revisions stable for byte-identical writes', (backend) => {
    const store = backend === 'canvas'
      ? new CanvasPixelStore(new OffscreenCanvas(32, 32), { tileSize: 16 })
      : new TiledPixelStore(32, 32, { tileSize: 16 });
    const rect = { x: 2, y: 2, width: 2, height: 2 };

    expect(store.writeRegion(rect, solid(2, 2, [0, 0, 0, 0]))).toMatchObject({ revision: 0, touchedTileCount: 0 });
    const paint = solid(2, 2, [1, 2, 3, 255]);
    store.writeRegion(rect, paint);
    expect(store.writeRegion(rect, paint)).toMatchObject({ previousRevision: 1, revision: 1, touchedTileCount: 0 });
  });

  it.each(['canvas', 'tiled'] as const)('treats restoring an unchanged %s snapshot as a no-op', (backend) => {
    const store = backend === 'canvas'
      ? new CanvasPixelStore(new OffscreenCanvas(32, 32), { tileSize: 16 })
      : new TiledPixelStore(32, 32, { tileSize: 16 });
    store.writeRegion({ x: 1, y: 1, width: 1, height: 1 }, solid(1, 1, [1, 2, 3, 255]));
    const snapshot = store.snapshot();

    expect(store.restore(snapshot)).toMatchObject({ dirtyRect: null, previousRevision: 1, revision: 1, touchedTileCount: 0 });
    snapshot.dispose();
  });

  it.each([128, 256])('keeps Canvas and tiled stores byte-identical across random writes at %ipx', (tileSize) => {
    const width = 320;
    const height = 240;
    const canvas = new CanvasPixelStore(new OffscreenCanvas(width, height), { tileSize });
    const tiled = new TiledPixelStore(width, height, { tileSize });
    let seed = tileSize;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    for (let index = 0; index < 120; index += 1) {
      const regionWidth = 1 + Math.floor(random() * 40);
      const regionHeight = 1 + Math.floor(random() * 40);
      const rect = {
        x: Math.floor(random() * (width - regionWidth)),
        y: Math.floor(random() * (height - regionHeight)),
        width: regionWidth,
        height: regionHeight,
      };
      const pixels = solid(regionWidth, regionHeight, [
        Math.floor(random() * 256),
        Math.floor(random() * 256),
        Math.floor(random() * 256),
        index % 5 === 0 ? 0 : 255,
      ]);
      canvas.writeRegion(rect, pixels);
      tiled.writeRegion(rect, pixels);
    }

    const rect = { x: 0, y: 0, width, height };
    expect(Array.from(tiled.readRegion(rect).data)).toEqual(Array.from(canvas.readRegion(rect).data));
  });
});
