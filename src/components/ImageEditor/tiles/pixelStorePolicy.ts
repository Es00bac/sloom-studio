import { TILE_SIZE, TiledBitmap, type TiledSnapshot } from './TiledBitmap';

export type LayerPixelBackend = 'canvas' | 'tiled';

export interface PixelStoreDeviceProfile {
  isMobile: boolean;
  deviceMemoryGb: number | null;
}

export interface PixelStoreBackendGate {
  tiledRolloutEnabled: boolean;
  selfTestPassed: boolean;
}

export interface PixelStoreSelfTestResult {
  passed: boolean;
  reason: string | null;
}

export function choosePixelStoreTileSize(profile: PixelStoreDeviceProfile): number {
  return profile.isMobile || (profile.deviceMemoryGb !== null && profile.deviceMemoryGb <= 4)
    ? 128
    : TILE_SIZE;
}

/** Canvas remains the automatic fallback until both the rollout and startup gates pass. */
export function choosePixelStoreBackend(gate: PixelStoreBackendGate): LayerPixelBackend {
  return gate.tiledRolloutEnabled && gate.selfTestPassed ? 'tiled' : 'canvas';
}

function imageData(width: number, height: number, rgba: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set(rgba, index * 4);
  return { width, height, data } as ImageData;
}

/** Small deterministic startup check for cross-tile writes, COW restore, and reference accounting. */
export function runTiledPixelStoreSelfTest(tileSize: number): PixelStoreSelfTestResult {
  let bitmap: TiledBitmap | null = null;
  let snapshot: TiledSnapshot | null = null;
  try {
    bitmap = new TiledBitmap(tileSize * 2, tileSize, tileSize);
    bitmap.applyRegion(tileSize - 1, 0, imageData(2, 1, [12, 34, 56, 255]));
    if (bitmap.tileCount !== 2) throw new Error('cross-tile write did not retain two tiles');
    snapshot = bitmap.snapshot();
    bitmap.applyRegion(tileSize - 1, 0, imageData(1, 1, [99, 88, 77, 255]));
    bitmap.restore(snapshot);
    const restored = bitmap.materializeRegion(tileSize - 1, 0, 2, 1).data;
    if (
      restored[0] !== 12 || restored[1] !== 34 || restored[2] !== 56 || restored[3] !== 255
      || restored[4] !== 12 || restored[5] !== 34 || restored[6] !== 56 || restored[7] !== 255
    ) {
      throw new Error('snapshot restore did not reproduce the original bytes');
    }
    const audit = bitmap.auditReferences();
    if (!audit.ok) throw new Error(audit.issues.join('; '));
    return { passed: true, reason: null };
  } catch (error) {
    return { passed: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    snapshot?.dispose();
    bitmap?.dispose();
  }
}
