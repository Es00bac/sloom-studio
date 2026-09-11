export const TILE_SIZE = 256;

interface TileBuffer {
  data: Uint8ClampedArray;
  refs: number;
  nonZeroBytes: number;
}

export interface TiledSnapshot {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly revision: number;
  readonly retainedBytes: number;
  dispose(): void;
}

export interface TiledBitmapMutation {
  dirtyRect: { x: number; y: number; width: number; height: number } | null;
  previousRevision: number;
  revision: number;
  touchedTileCount: number;
  prunedTileCount: number;
}

export interface TiledBitmapReferenceAudit {
  ok: boolean;
  uniqueBufferCount: number;
  retainedBytes: number;
  issues: string[];
}

export interface TiledTileRegion {
  tx: number;
  ty: number;
  rect: { x: number; y: number; width: number; height: number };
  revision: number;
  pixels: ImageData;
}

interface SnapshotState {
  owner: TiledBitmap | null;
  tiles: Map<number, TileBuffer>;
  disposed: boolean;
}

const snapshotStates = new WeakMap<TiledSnapshot, SnapshotState>();

class TiledSnapshotHandle implements TiledSnapshot {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly revision: number;
  readonly retainedBytes: number;

  constructor(
    width: number,
    height: number,
    tileSize: number,
    revision: number,
    retainedBytes: number,
  ) {
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.revision = revision;
    this.retainedBytes = retainedBytes;
  }

  dispose(): void {
    snapshotStates.get(this)?.owner?.releaseSnapshot(this);
  }
}

/** Real ImageData where available (browser/jsdom), else a plain shape for Node tests/workers. */
function makeImageData(data: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): ImageData {
  if (typeof ImageData !== 'undefined') return new ImageData(data, width, height);
  return { width, height, data } as ImageData;
}

function countNonZeroBytes(data: Uint8ClampedArray): number {
  let count = 0;
  for (const value of data) if (value !== 0) count += 1;
  return count;
}

/**
 * Sparse, copy-on-write RGBA8 storage. Missing tiles read as transparent. Snapshots are opaque,
 * share buffers until the next write, and must be disposed when their history entry is evicted.
 */
export class TiledBitmap {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly tilesWide: number;
  readonly tilesHigh: number;

  private tiles = new Map<number, TileBuffer>();
  private readonly tileRevisions = new Map<number, number>();
  private readonly snapshots = new Set<TiledSnapshotHandle>();
  private currentRevision = 0;
  private disposed = false;

  constructor(width: number, height: number, tileSize = TILE_SIZE) {
    if (!Number.isInteger(tileSize) || tileSize <= 0) {
      throw new Error('tileSize must be a positive integer');
    }
    this.width = width;
    this.height = height;
    this.tileSize = tileSize;
    this.tilesWide = Math.max(1, Math.ceil(width / tileSize));
    this.tilesHigh = Math.max(1, Math.ceil(height / tileSize));
  }

  get revision(): number {
    return this.currentRevision;
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('TiledBitmap has been disposed');
  }

  private key(tx: number, ty: number): number {
    return ty * this.tilesWide + tx;
  }

  private releaseBuffer(buffer: TileBuffer): void {
    buffer.refs -= 1;
    if (buffer.refs < 0) throw new Error('TiledBitmap reference count underflow');
  }

  /** Compose [x, y, x+w, y+h) into fresh ImageData; out-of-bounds pixels stay transparent. */
  materializeRegion(x: number, y: number, w: number, h: number): ImageData {
    this.assertActive();
    const out = new Uint8ClampedArray(w * h * 4);
    const tx0 = Math.max(0, Math.floor(x / this.tileSize));
    const ty0 = Math.max(0, Math.floor(y / this.tileSize));
    const tx1 = Math.min(this.tilesWide - 1, Math.floor((x + w - 1) / this.tileSize));
    const ty1 = Math.min(this.tilesHigh - 1, Math.floor((y + h - 1) / this.tileSize));
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const tile = this.tiles.get(this.key(tx, ty));
        if (!tile) continue;
        const tileX = tx * this.tileSize;
        const tileY = ty * this.tileSize;
        const ix0 = Math.max(x, tileX);
        const iy0 = Math.max(y, tileY);
        const ix1 = Math.min(x + w, tileX + this.tileSize);
        const iy1 = Math.min(y + h, tileY + this.tileSize);
        const len = (ix1 - ix0) * 4;
        for (let py = iy0; py < iy1; py += 1) {
          const srcRow = ((py - tileY) * this.tileSize + (ix0 - tileX)) * 4;
          const dstRow = ((py - y) * w + (ix0 - x)) * 4;
          out.set(tile.data.subarray(srcRow, srcRow + len), dstRow);
        }
      }
    }
    return makeImageData(out, w, h);
  }

  /** Write an ImageData region, cloning only shared tiles and pruning tiles that become all-zero. */
  applyRegion(x: number, y: number, image: ImageData): TiledBitmapMutation {
    this.assertActive();
    const { width: w, height: h } = image;
    const previousRevision = this.currentRevision;
    if (w <= 0 || h <= 0 || x >= this.width || y >= this.height || x + w <= 0 || y + h <= 0) {
      return { dirtyRect: null, previousRevision, revision: previousRevision, touchedTileCount: 0, prunedTileCount: 0 };
    }

    const dirtyX = Math.max(0, x);
    const dirtyY = Math.max(0, y);
    const dirtyX1 = Math.min(this.width, x + w);
    const dirtyY1 = Math.min(this.height, y + h);

    const tx0 = Math.max(0, Math.floor(x / this.tileSize));
    const ty0 = Math.max(0, Math.floor(y / this.tileSize));
    const tx1 = Math.min(this.tilesWide - 1, Math.floor((x + w - 1) / this.tileSize));
    const ty1 = Math.min(this.tilesHigh - 1, Math.floor((y + h - 1) / this.tileSize));
    const changedTiles: Array<[tx: number, ty: number]> = [];
    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        if (this.tileRegionDiffers(tx, ty, x, y, image)) changedTiles.push([tx, ty]);
      }
    }
    if (changedTiles.length === 0) {
      return {
        dirtyRect: null,
        previousRevision,
        revision: previousRevision,
        touchedTileCount: 0,
        prunedTileCount: 0,
      };
    }

    this.currentRevision += 1;
    let prunedTileCount = 0;
    for (const [tx, ty] of changedTiles) {
      const tile = this.ensureWritable(tx, ty);
      const tileKey = this.key(tx, ty);
      const tileX = tx * this.tileSize;
      const tileY = ty * this.tileSize;
      const ix0 = Math.max(x, tileX);
      const iy0 = Math.max(y, tileY);
      const ix1 = Math.min(x + w, tileX + this.tileSize);
      const iy1 = Math.min(y + h, tileY + this.tileSize);

      for (let py = iy0; py < iy1; py += 1) {
        const srcRow = ((py - y) * w + (ix0 - x)) * 4;
        const dstRow = ((py - tileY) * this.tileSize + (ix0 - tileX)) * 4;
        const len = (ix1 - ix0) * 4;
        for (let offset = 0; offset < len; offset += 1) {
          const previous = tile.data[dstRow + offset];
          const next = image.data[srcRow + offset];
          if (previous === 0 && next !== 0) tile.nonZeroBytes += 1;
          else if (previous !== 0 && next === 0) tile.nonZeroBytes -= 1;
          tile.data[dstRow + offset] = next;
        }
      }

      this.tileRevisions.set(tileKey, this.currentRevision);
      if (tile.nonZeroBytes === 0) {
        this.releaseBuffer(tile);
        this.tiles.delete(tileKey);
        prunedTileCount += 1;
      }
    }

    return {
      dirtyRect: { x: dirtyX, y: dirtyY, width: dirtyX1 - dirtyX, height: dirtyY1 - dirtyY },
      previousRevision,
      revision: this.currentRevision,
      touchedTileCount: changedTiles.length,
      prunedTileCount,
    };
  }

  private tileRegionDiffers(tx: number, ty: number, x: number, y: number, image: ImageData): boolean {
    const tile = this.tiles.get(this.key(tx, ty));
    const tileX = tx * this.tileSize;
    const tileY = ty * this.tileSize;
    const ix0 = Math.max(x, tileX);
    const iy0 = Math.max(y, tileY);
    const ix1 = Math.min(x + image.width, tileX + this.tileSize);
    const iy1 = Math.min(y + image.height, tileY + this.tileSize);
    for (let py = iy0; py < iy1; py += 1) {
      const srcRow = ((py - y) * image.width + (ix0 - x)) * 4;
      const tileRow = ((py - tileY) * this.tileSize + (ix0 - tileX)) * 4;
      const len = (ix1 - ix0) * 4;
      for (let offset = 0; offset < len; offset += 1) {
        if ((tile?.data[tileRow + offset] ?? 0) !== image.data[srcRow + offset]) return true;
      }
    }
    return false;
  }

  private ensureWritable(tx: number, ty: number): TileBuffer {
    const tileKey = this.key(tx, ty);
    const existing = this.tiles.get(tileKey);
    if (!existing) {
      const buffer: TileBuffer = {
        data: new Uint8ClampedArray(this.tileSize * this.tileSize * 4),
        refs: 1,
        nonZeroBytes: 0,
      };
      this.tiles.set(tileKey, buffer);
      return buffer;
    }
    if (existing.refs > 1) {
      this.releaseBuffer(existing);
      const clone: TileBuffer = {
        data: new Uint8ClampedArray(existing.data),
        refs: 1,
        nonZeroBytes: existing.nonZeroBytes,
      };
      this.tiles.set(tileKey, clone);
      return clone;
    }
    return existing;
  }

  getTileRevision(tx: number, ty: number): number {
    return this.tileRevisions.get(this.key(tx, ty)) ?? 0;
  }

  /** Capture current pixels copy-on-write. The returned handle owns a reference until disposed. */
  snapshot(): TiledSnapshot {
    this.assertActive();
    const tiles = new Map(this.tiles);
    for (const buffer of tiles.values()) buffer.refs += 1;
    const snapshot = new TiledSnapshotHandle(
      this.width,
      this.height,
      this.tileSize,
      this.currentRevision,
      tiles.size * this.tileSize * this.tileSize * 4,
    );
    snapshotStates.set(snapshot, { owner: this, tiles, disposed: false });
    this.snapshots.add(snapshot);
    return snapshot;
  }

  /** Restore pixels from a live snapshot while keeping revisions monotonic for cache invalidation. */
  restore(snapshot: TiledSnapshot): TiledBitmapMutation {
    this.assertActive();
    const state = snapshotStates.get(snapshot);
    if (!state || state.owner !== this || state.disposed) {
      throw new Error('Snapshot does not belong to this TiledBitmap or has been disposed');
    }

    const previousRevision = this.currentRevision;
    const candidateKeys = new Set([...this.tiles.keys(), ...state.tiles.keys()]);
    const affectedKeys = new Set(
      [...candidateKeys].filter((key) => this.tiles.get(key) !== state.tiles.get(key)),
    );
    const prunedTileCount = [...affectedKeys].filter(
      (key) => this.tiles.has(key) && !state.tiles.has(key),
    ).length;
    if (affectedKeys.size === 0) {
      return {
        dirtyRect: null,
        previousRevision,
        revision: previousRevision,
        touchedTileCount: 0,
        prunedTileCount: 0,
      };
    }
    for (const buffer of this.tiles.values()) this.releaseBuffer(buffer);
    this.tiles = new Map(state.tiles);
    for (const buffer of this.tiles.values()) buffer.refs += 1;
    this.currentRevision += 1;
    for (const key of affectedKeys) this.tileRevisions.set(key, this.currentRevision);
    const affected = [...affectedKeys];
    const txValues = affected.map((key) => key % this.tilesWide);
    const tyValues = affected.map((key) => Math.floor(key / this.tilesWide));
    const tx0 = affected.length > 0 ? Math.min(...txValues) : 0;
    const ty0 = affected.length > 0 ? Math.min(...tyValues) : 0;
    const tx1 = affected.length > 0 ? Math.max(...txValues) : -1;
    const ty1 = affected.length > 0 ? Math.max(...tyValues) : -1;
    const dirtyRect = affected.length > 0
      ? {
          x: tx0 * this.tileSize,
          y: ty0 * this.tileSize,
          width: Math.min(this.width, (tx1 + 1) * this.tileSize) - tx0 * this.tileSize,
          height: Math.min(this.height, (ty1 + 1) * this.tileSize) - ty0 * this.tileSize,
        }
      : null;
    return {
      dirtyRect,
      previousRevision,
      revision: this.currentRevision,
      touchedTileCount: affectedKeys.size,
      prunedTileCount,
    };
  }

  /** Release a snapshot's references. Calling this more than once is safe. */
  releaseSnapshot(snapshot: TiledSnapshot): void {
    const state = snapshotStates.get(snapshot);
    if (!state || state.owner !== this || state.disposed) return;
    for (const buffer of state.tiles.values()) this.releaseBuffer(buffer);
    state.tiles.clear();
    state.disposed = true;
    state.owner = null;
    this.snapshots.delete(snapshot as TiledSnapshotHandle);
  }

  static disposeSnapshot(snapshot: TiledSnapshot): void {
    snapshot.dispose();
  }

  /** Pixel-buffer bytes retained by the live bitmap and all of its undisposed snapshots. */
  estimateRetainedBytes(): number {
    const unique = new Set<TileBuffer>(this.tiles.values());
    for (const snapshot of this.snapshots) {
      const state = snapshotStates.get(snapshot);
      if (!state || state.disposed) continue;
      for (const buffer of state.tiles.values()) unique.add(buffer);
    }
    let bytes = 0;
    for (const buffer of unique) bytes += buffer.data.byteLength;
    return bytes;
  }

  /** Verify every reachable buffer's ref count and cached non-zero byte count. */
  auditReferences(): TiledBitmapReferenceAudit {
    const expected = new Map<TileBuffer, number>();
    const add = (buffer: TileBuffer) => expected.set(buffer, (expected.get(buffer) ?? 0) + 1);
    for (const buffer of this.tiles.values()) add(buffer);
    for (const snapshot of this.snapshots) {
      const state = snapshotStates.get(snapshot);
      if (!state || state.disposed) continue;
      for (const buffer of state.tiles.values()) add(buffer);
    }

    const issues: string[] = [];
    for (const [buffer, refs] of expected) {
      if (buffer.refs !== refs) issues.push(`buffer refs ${buffer.refs} != reachable refs ${refs}`);
      const actualNonZeroBytes = countNonZeroBytes(buffer.data);
      if (buffer.nonZeroBytes !== actualNonZeroBytes) {
        issues.push(`buffer nonZeroBytes ${buffer.nonZeroBytes} != actual ${actualNonZeroBytes}`);
      }
    }
    return {
      ok: issues.length === 0,
      uniqueBufferCount: expected.size,
      retainedBytes: [...expected.keys()].reduce((sum, buffer) => sum + buffer.data.byteLength, 0),
      issues,
    };
  }

  /** Visit every retained tile coordinate. */
  forEachTile(callback: (tx: number, ty: number) => void): void {
    this.assertActive();
    for (const key of this.tiles.keys()) {
      callback(key % this.tilesWide, Math.floor(key / this.tilesWide));
    }
  }

  /** Visit every retained tile as a bounded, read-only-by-convention region copy. */
  forEachTileRegion(callback: (region: TiledTileRegion) => void): void {
    this.forEachTile((tx, ty) => {
      const x = tx * this.tileSize;
      const y = ty * this.tileSize;
      const rect = {
        x,
        y,
        width: Math.min(this.tileSize, this.width - x),
        height: Math.min(this.tileSize, this.height - y),
      };
      callback({
        tx,
        ty,
        rect,
        revision: this.getTileRevision(tx, ty),
        pixels: this.materializeRegion(rect.x, rect.y, rect.width, rect.height),
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    for (const buffer of this.tiles.values()) this.releaseBuffer(buffer);
    this.tiles.clear();
    for (const snapshot of [...this.snapshots]) this.releaseSnapshot(snapshot);
    this.tileRevisions.clear();
    this.disposed = true;
  }
}
