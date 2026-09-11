import { describe, expect, it } from 'vitest';
import { TILE_SIZE, TiledBitmap } from './TiledBitmap';

function solid(w: number, h: number, rgba: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) data.set(rgba, i * 4);
  return typeof ImageData !== 'undefined'
    ? new ImageData(data, w, h)
    : ({ width: w, height: h, data } as ImageData);
}

describe('TiledBitmap', () => {
  it('uses 256px tiles and materializes an empty bitmap as transparent', () => {
    expect(TILE_SIZE).toBe(256);
    const bmp = new TiledBitmap(300, 200);
    const region = bmp.materializeRegion(0, 0, 300, 200);
    expect(region.width).toBe(300);
    expect(region.height).toBe(200);
    expect(region.data.length).toBe(300 * 200 * 4);
    expect(Array.from(region.data.slice(0, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('supports persisted 128px tiles for mobile and low-memory backends', () => {
    const bmp = new TiledBitmap(300, 260, 128);

    expect(bmp.tileSize).toBe(128);
    expect(bmp.tilesWide).toBe(3);
    expect(bmp.tilesHigh).toBe(3);
    expect(() => new TiledBitmap(10, 10, 0)).toThrow('tileSize must be a positive integer');
  });

  it('writes a region spanning a tile boundary and reads it back exactly', () => {
    const bmp = new TiledBitmap(600, 300); // tiles 0..2 x 0..1
    bmp.applyRegion(200, 100, solid(160, 80, [10, 20, 30, 255])); // x=200..360 crosses the 256 border
    const back = bmp.materializeRegion(200, 100, 160, 80);
    expect(Array.from(back.data.slice(0, 4))).toEqual([10, 20, 30, 255]);
    const outside = bmp.materializeRegion(360, 100, 1, 1);
    expect(Array.from(outside.data)).toEqual([0, 0, 0, 0]);
  });

  it('snapshot is copy-on-write: later writes do not change the snapshot, and restore brings old pixels back', () => {
    const bmp = new TiledBitmap(300, 300);
    bmp.applyRegion(10, 10, solid(20, 20, [1, 2, 3, 255]));
    const snap = bmp.snapshot();

    bmp.applyRegion(10, 10, solid(20, 20, [9, 9, 9, 255]));
    expect(Array.from(bmp.materializeRegion(10, 10, 1, 1).data)).toEqual([9, 9, 9, 255]);

    bmp.restore(snap);
    expect(Array.from(bmp.materializeRegion(10, 10, 1, 1).data)).toEqual([1, 2, 3, 255]);

    TiledBitmap.disposeSnapshot(snap);
  });

  it('keeps snapshots opaque, audits COW references, accounts unique buffers, and disposes deterministically', () => {
    const bmp = new TiledBitmap(300, 300, 128);
    const tileBytes = 128 * 128 * 4;
    bmp.applyRegion(10, 10, solid(20, 20, [1, 2, 3, 255]));
    const snap = bmp.snapshot();

    expect('tiles' in snap).toBe(false);
    expect(snap).toMatchObject({ width: 300, height: 300, tileSize: 128, revision: 1 });
    expect(bmp.estimateRetainedBytes()).toBe(tileBytes);

    bmp.applyRegion(10, 10, solid(20, 20, [9, 8, 7, 255]));
    expect(bmp.estimateRetainedBytes()).toBe(tileBytes * 2);
    expect(bmp.auditReferences()).toMatchObject({ ok: true, uniqueBufferCount: 2, retainedBytes: tileBytes * 2 });

    const beforeRestoreRevision = bmp.revision;
    bmp.restore(snap);
    expect(bmp.revision).toBe(beforeRestoreRevision + 1);
    expect(bmp.getTileRevision(0, 0)).toBe(bmp.revision);
    expect(Array.from(bmp.materializeRegion(10, 10, 1, 1).data)).toEqual([1, 2, 3, 255]);

    snap.dispose();
    expect(bmp.auditReferences().ok).toBe(true);
    expect(bmp.estimateRetainedBytes()).toBe(tileBytes);

    bmp.dispose();
    expect(bmp.estimateRetainedBytes()).toBe(0);
    expect(() => bmp.materializeRegion(0, 0, 1, 1)).toThrow('TiledBitmap has been disposed');
  });

  it('forEachTile visits exactly the touched tiles', () => {
    const bmp = new TiledBitmap(1024, 1024); // 4x4 tiles
    bmp.applyRegion(0, 0, solid(2, 2, [5, 5, 5, 255])); // tile (0,0)
    bmp.applyRegion(300, 300, solid(2, 2, [6, 6, 6, 255])); // tile (1,1)
    const seen: Array<[number, number]> = [];
    bmp.forEachTile((tx, ty) => seen.push([tx, ty]));
    seen.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(seen).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('iterates edge tiles as bounded revisioned regions', () => {
    const bmp = new TiledBitmap(300, 200, 128);
    bmp.applyRegion(290, 190, solid(2, 2, [7, 8, 9, 255]));
    const regions: Array<{ rect: { x: number; y: number; width: number; height: number }; revision: number; pixel: number[] }> = [];

    bmp.forEachTileRegion((region) => {
      const paintedOffset = (62 * region.rect.width + 34) * 4;
      regions.push({
        rect: region.rect,
        revision: region.revision,
        pixel: Array.from(region.pixels.data.slice(paintedOffset, paintedOffset + 4)),
      });
    });

    expect(regions).toEqual([{
      rect: { x: 256, y: 128, width: 44, height: 72 },
      revision: 1,
      pixel: [7, 8, 9, 255],
    }]);
  });

  it('tracks store and tile revisions and prunes a tile after it becomes fully transparent', () => {
    const bmp = new TiledBitmap(512, 512);

    const painted = bmp.applyRegion(10, 10, solid(20, 20, [4, 5, 6, 255]));
    expect(painted).toMatchObject({ previousRevision: 0, revision: 1, touchedTileCount: 1, prunedTileCount: 0 });
    expect(bmp.revision).toBe(1);
    expect(bmp.getTileRevision(0, 0)).toBe(1);
    expect(bmp.tileCount).toBe(1);

    const erased = bmp.applyRegion(0, 0, solid(256, 256, [0, 0, 0, 0]));
    expect(erased).toMatchObject({ previousRevision: 1, revision: 2, touchedTileCount: 1, prunedTileCount: 1 });
    expect(bmp.getTileRevision(0, 0)).toBe(2);
    expect(bmp.tileCount).toBe(0);
    expect(Array.from(bmp.materializeRegion(10, 10, 1, 1).data)).toEqual([0, 0, 0, 0]);
  });

  it('does not revise, allocate, or break COW sharing for byte-identical writes', () => {
    const bmp = new TiledBitmap(512, 512);
    const transparent = solid(20, 20, [0, 0, 0, 0]);

    expect(bmp.applyRegion(10, 10, transparent)).toMatchObject({
      previousRevision: 0,
      revision: 0,
      touchedTileCount: 0,
      prunedTileCount: 0,
    });
    expect(bmp.tileCount).toBe(0);

    const paint = solid(20, 20, [1, 2, 3, 255]);
    bmp.applyRegion(10, 10, paint);
    const snapshot = bmp.snapshot();
    const retainedBefore = bmp.estimateRetainedBytes();
    expect(bmp.applyRegion(10, 10, paint)).toMatchObject({ revision: 1, touchedTileCount: 0 });
    expect(bmp.estimateRetainedBytes()).toBe(retainedBefore);
    snapshot.dispose();
  });

  it('matches a full reference buffer across 500 random region writes (byte-identical)', () => {
    const W = 700;
    const H = 500;
    const bmp = new TiledBitmap(W, H);
    const ref = new Uint8ClampedArray(W * H * 4);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    for (let n = 0; n < 500; n += 1) {
      const rw = 1 + Math.floor(rnd() * 80);
      const rh = 1 + Math.floor(rnd() * 80);
      const x = Math.floor(rnd() * (W - rw));
      const y = Math.floor(rnd() * (H - rh));
      const rgba: [number, number, number, number] = [
        Math.floor(rnd() * 256),
        Math.floor(rnd() * 256),
        Math.floor(rnd() * 256),
        Math.floor(rnd() * 256),
      ];
      bmp.applyRegion(x, y, solid(rw, rh, rgba));
      for (let py = y; py < y + rh; py += 1) {
        for (let px = x; px < x + rw; px += 1) {
          ref.set(rgba, (py * W + px) * 4);
        }
      }
    }

    const full = bmp.materializeRegion(0, 0, W, H).data;
    let mismatches = 0;
    for (let i = 0; i < ref.length; i += 1) if (full[i] !== ref[i]) mismatches += 1;
    expect(mismatches).toBe(0);
  });
});
