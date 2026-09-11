import { TILE_SIZE, TiledBitmap, type TiledSnapshot } from './TiledBitmap';

const snapshotBrand: unique symbol = Symbol('LayerPixelSnapshot');
const mutationBrand: unique symbol = Symbol('PixelMutation');

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelMutation {
  readonly [mutationBrand]: true;
  readonly dirtyRect: PixelRect | null;
  readonly previousRevision: number;
  readonly revision: number;
  readonly touchedTileCount: number;
  readonly prunedTileCount: number;
}

export interface LayerPixelSnapshot {
  readonly [snapshotBrand]: true;
  readonly width: number;
  readonly height: number;
  readonly revision: number;
  readonly retainedBytes: number;
  dispose(): void;
}

export interface LayerPixelStore {
  readonly kind: 'canvas' | 'tiled';
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly revision: number;
  readRegion(rect: PixelRect): ImageData;
  writeRegion(rect: PixelRect, pixels: ImageData): PixelMutation;
  snapshot(): LayerPixelSnapshot;
  restore(snapshot: LayerPixelSnapshot): PixelMutation;
  materializeCanvas(rect?: PixelRect): OffscreenCanvas;
  getTileRevision(tx: number, ty: number): number;
  estimateRetainedBytes(): number;
  dispose(): void;
}

interface CanvasSnapshotState {
  owner: CanvasPixelStore | null;
  pixels: ImageData | null;
  disposed: boolean;
}

const canvasSnapshotStates = new WeakMap<LayerPixelSnapshot, CanvasSnapshotState>();

class CanvasSnapshotHandle implements LayerPixelSnapshot {
  readonly [snapshotBrand] = true as const;
  readonly width: number;
  readonly height: number;
  readonly revision: number;
  readonly retainedBytes: number;

  constructor(
    width: number,
    height: number,
    revision: number,
    retainedBytes: number,
  ) {
    this.width = width;
    this.height = height;
    this.revision = revision;
    this.retainedBytes = retainedBytes;
  }

  dispose(): void {
    canvasSnapshotStates.get(this)?.owner?.releaseSnapshot(this);
  }
}

function validateRect(rect: PixelRect): void {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every(Number.isInteger) || rect.width < 0 || rect.height < 0) {
    throw new Error('PixelRect values must be integers with non-negative width and height');
  }
}

function clipRect(rect: PixelRect, width: number, height: number): PixelRect | null {
  validateRect(rect);
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(width, rect.x + rect.width);
  const y1 = Math.min(height, rect.y + rect.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function makeMutation(
  dirtyRect: PixelRect | null,
  previousRevision: number,
  revision: number,
  touchedTileCount: number,
  prunedTileCount: number,
): PixelMutation {
  return {
    [mutationBrand]: true,
    dirtyRect,
    previousRevision,
    revision,
    touchedTileCount,
    prunedTileCount,
  };
}

function tileKeysForRect(rect: PixelRect | null, tileSize: number, tilesWide: number): number[] {
  if (!rect) return [];
  const keys: number[] = [];
  const tx0 = Math.floor(rect.x / tileSize);
  const ty0 = Math.floor(rect.y / tileSize);
  const tx1 = Math.floor((rect.x + rect.width - 1) / tileSize);
  const ty1 = Math.floor((rect.y + rect.height - 1) / tileSize);
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) keys.push(ty * tilesWide + tx);
  }
  return keys;
}

function context2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('CanvasPixelStore requires a Canvas2D context');
  return context;
}

export interface CanvasPixelStoreOptions {
  tileSize?: number;
}

/** Compatibility backend that keeps one OffscreenCanvas authoritative behind the region API. */
export class CanvasPixelStore implements LayerPixelStore {
  readonly kind = 'canvas' as const;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;

  private readonly canvas: OffscreenCanvas;
  private readonly context: OffscreenCanvasRenderingContext2D;
  private readonly tilesWide: number;
  private readonly tileRevisions = new Map<number, number>();
  private readonly snapshots = new Set<CanvasSnapshotHandle>();
  private currentRevision = 0;
  private disposed = false;

  constructor(canvas: OffscreenCanvas, options: CanvasPixelStoreOptions = {}) {
    const tileSize = options.tileSize ?? TILE_SIZE;
    if (!Number.isInteger(tileSize) || tileSize <= 0) {
      throw new Error('tileSize must be a positive integer');
    }
    this.canvas = canvas;
    this.context = context2d(canvas);
    this.width = canvas.width;
    this.height = canvas.height;
    this.tileSize = tileSize;
    this.tilesWide = Math.max(1, Math.ceil(this.width / tileSize));
  }

  get revision(): number {
    return this.currentRevision;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('CanvasPixelStore has been disposed');
  }

  readRegion(rect: PixelRect): ImageData {
    this.assertActive();
    validateRect(rect);
    return this.context.getImageData(rect.x, rect.y, rect.width, rect.height);
  }

  writeRegion(rect: PixelRect, pixels: ImageData): PixelMutation {
    this.assertActive();
    validateRect(rect);
    if (pixels.width !== rect.width || pixels.height !== rect.height) {
      throw new Error('writeRegion pixels must match PixelRect dimensions');
    }
    const dirtyRect = clipRect(rect, this.width, this.height);
    const previousRevision = this.currentRevision;
    if (!dirtyRect) return makeMutation(null, previousRevision, previousRevision, 0, 0);
    if (!this.regionDiffers(rect, dirtyRect, pixels)) {
      return makeMutation(null, previousRevision, previousRevision, 0, 0);
    }

    this.context.putImageData(pixels, rect.x, rect.y);
    this.currentRevision += 1;
    const keys = tileKeysForRect(dirtyRect, this.tileSize, this.tilesWide);
    for (const key of keys) this.tileRevisions.set(key, this.currentRevision);
    return makeMutation(dirtyRect, previousRevision, this.currentRevision, keys.length, 0);
  }

  private regionDiffers(sourceRect: PixelRect, dirtyRect: PixelRect, pixels: ImageData): boolean {
    const current = this.context.getImageData(
      dirtyRect.x,
      dirtyRect.y,
      dirtyRect.width,
      dirtyRect.height,
    );
    const sourceX = dirtyRect.x - sourceRect.x;
    const sourceY = dirtyRect.y - sourceRect.y;
    for (let y = 0; y < dirtyRect.height; y += 1) {
      const currentRow = y * dirtyRect.width * 4;
      const sourceRow = ((sourceY + y) * sourceRect.width + sourceX) * 4;
      for (let offset = 0; offset < dirtyRect.width * 4; offset += 1) {
        if (current.data[currentRow + offset] !== pixels.data[sourceRow + offset]) return true;
      }
    }
    return false;
  }

  snapshot(): LayerPixelSnapshot {
    this.assertActive();
    const pixels = this.context.getImageData(0, 0, this.width, this.height);
    const snapshot = new CanvasSnapshotHandle(
      this.width,
      this.height,
      this.currentRevision,
      pixels.data.byteLength,
    );
    canvasSnapshotStates.set(snapshot, { owner: this, pixels, disposed: false });
    this.snapshots.add(snapshot);
    return snapshot;
  }

  restore(snapshot: LayerPixelSnapshot): PixelMutation {
    this.assertActive();
    const state = canvasSnapshotStates.get(snapshot);
    if (!state || state.owner !== this || state.disposed || !state.pixels) {
      throw new Error('Snapshot does not belong to this CanvasPixelStore or has been disposed');
    }
    const previousRevision = this.currentRevision;
    const fullRect = { x: 0, y: 0, width: this.width, height: this.height };
    if (!this.regionDiffers(fullRect, fullRect, state.pixels)) {
      return makeMutation(null, previousRevision, previousRevision, 0, 0);
    }
    this.context.putImageData(state.pixels, 0, 0);
    this.currentRevision += 1;
    const keys = tileKeysForRect(fullRect, this.tileSize, this.tilesWide);
    for (const key of keys) this.tileRevisions.set(key, this.currentRevision);
    return makeMutation(fullRect, previousRevision, this.currentRevision, keys.length, 0);
  }

  releaseSnapshot(snapshot: LayerPixelSnapshot): void {
    const state = canvasSnapshotStates.get(snapshot);
    if (!state || state.owner !== this || state.disposed) return;
    state.pixels = null;
    state.disposed = true;
    state.owner = null;
    this.snapshots.delete(snapshot as CanvasSnapshotHandle);
  }

  materializeCanvas(rect: PixelRect = { x: 0, y: 0, width: this.width, height: this.height }): OffscreenCanvas {
    this.assertActive();
    const output = new OffscreenCanvas(rect.width, rect.height);
    context2d(output).putImageData(this.readRegion(rect), 0, 0);
    return output;
  }

  getTileRevision(tx: number, ty: number): number {
    return this.tileRevisions.get(ty * this.tilesWide + tx) ?? 0;
  }

  estimateRetainedBytes(): number {
    if (this.disposed) return 0;
    let bytes = this.width * this.height * 4;
    for (const snapshot of this.snapshots) bytes += snapshot.retainedBytes;
    return bytes;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const snapshot of [...this.snapshots]) this.releaseSnapshot(snapshot);
    this.tileRevisions.clear();
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.disposed = true;
  }
}

interface TiledStoreSnapshotState {
  owner: TiledPixelStore | null;
  snapshot: TiledSnapshot | null;
  disposed: boolean;
}

const tiledStoreSnapshotStates = new WeakMap<LayerPixelSnapshot, TiledStoreSnapshotState>();

class TiledStoreSnapshotHandle implements LayerPixelSnapshot {
  readonly [snapshotBrand] = true as const;
  readonly width: number;
  readonly height: number;
  readonly revision: number;
  readonly retainedBytes: number;

  constructor(
    width: number,
    height: number,
    revision: number,
    retainedBytes: number,
  ) {
    this.width = width;
    this.height = height;
    this.revision = revision;
    this.retainedBytes = retainedBytes;
  }

  dispose(): void {
    tiledStoreSnapshotStates.get(this)?.owner?.releaseSnapshot(this);
  }
}

export interface TiledPixelStoreOptions {
  tileSize?: number;
}

interface CanvasMaterializationCache {
  revision: number;
  rectKey: string;
  canvas: OffscreenCanvas;
}

/** Sparse tile-backed implementation of the same region-first layer pixel contract. */
export class TiledPixelStore implements LayerPixelStore {
  readonly kind = 'tiled' as const;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;

  private readonly bitmap: TiledBitmap;
  private readonly snapshots = new Set<TiledStoreSnapshotHandle>();
  private materializationCache: CanvasMaterializationCache | null = null;
  private disposed = false;

  constructor(width: number, height: number, options: TiledPixelStoreOptions = {}) {
    this.bitmap = new TiledBitmap(width, height, options.tileSize ?? TILE_SIZE);
    this.width = width;
    this.height = height;
    this.tileSize = this.bitmap.tileSize;
  }

  get revision(): number {
    return this.bitmap.revision;
  }

  get tileCount(): number {
    return this.bitmap.tileCount;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('TiledPixelStore has been disposed');
  }

  private invalidateMaterialization(): void {
    this.materializationCache = null;
  }

  readRegion(rect: PixelRect): ImageData {
    this.assertActive();
    validateRect(rect);
    return this.bitmap.materializeRegion(rect.x, rect.y, rect.width, rect.height);
  }

  writeRegion(rect: PixelRect, pixels: ImageData): PixelMutation {
    this.assertActive();
    validateRect(rect);
    if (pixels.width !== rect.width || pixels.height !== rect.height) {
      throw new Error('writeRegion pixels must match PixelRect dimensions');
    }
    const result = this.bitmap.applyRegion(rect.x, rect.y, pixels);
    if (result.revision !== result.previousRevision) this.invalidateMaterialization();
    return makeMutation(
      result.dirtyRect,
      result.previousRevision,
      result.revision,
      result.touchedTileCount,
      result.prunedTileCount,
    );
  }

  snapshot(): LayerPixelSnapshot {
    this.assertActive();
    const tiledSnapshot = this.bitmap.snapshot();
    const snapshot = new TiledStoreSnapshotHandle(
      tiledSnapshot.width,
      tiledSnapshot.height,
      tiledSnapshot.revision,
      tiledSnapshot.retainedBytes,
    );
    tiledStoreSnapshotStates.set(snapshot, { owner: this, snapshot: tiledSnapshot, disposed: false });
    this.snapshots.add(snapshot);
    return snapshot;
  }

  restore(snapshot: LayerPixelSnapshot): PixelMutation {
    this.assertActive();
    const state = tiledStoreSnapshotStates.get(snapshot);
    if (!state || state.owner !== this || state.disposed || !state.snapshot) {
      throw new Error('Snapshot does not belong to this TiledPixelStore or has been disposed');
    }
    const result = this.bitmap.restore(state.snapshot);
    this.invalidateMaterialization();
    return makeMutation(
      result.dirtyRect,
      result.previousRevision,
      result.revision,
      result.touchedTileCount,
      result.prunedTileCount,
    );
  }

  releaseSnapshot(snapshot: LayerPixelSnapshot): void {
    const state = tiledStoreSnapshotStates.get(snapshot);
    if (!state || state.owner !== this || state.disposed) return;
    state.snapshot?.dispose();
    state.snapshot = null;
    state.disposed = true;
    state.owner = null;
    this.snapshots.delete(snapshot as TiledStoreSnapshotHandle);
  }

  materializeCanvas(rect: PixelRect = { x: 0, y: 0, width: this.width, height: this.height }): OffscreenCanvas {
    this.assertActive();
    validateRect(rect);
    const rectKey = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
    if (
      this.materializationCache
      && this.materializationCache.revision === this.revision
      && this.materializationCache.rectKey === rectKey
    ) {
      return this.materializationCache.canvas;
    }
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    context2d(canvas).putImageData(this.readRegion(rect), 0, 0);
    this.materializationCache = { revision: this.revision, rectKey, canvas };
    return canvas;
  }

  getTileRevision(tx: number, ty: number): number {
    return this.bitmap.getTileRevision(tx, ty);
  }

  estimateRetainedBytes(): number {
    if (this.disposed) return 0;
    const cacheBytes = this.materializationCache
      ? this.materializationCache.canvas.width * this.materializationCache.canvas.height * 4
      : 0;
    return this.bitmap.estimateRetainedBytes() + cacheBytes;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const snapshot of [...this.snapshots]) this.releaseSnapshot(snapshot);
    this.bitmap.dispose();
    this.materializationCache = null;
    this.disposed = true;
  }
}
