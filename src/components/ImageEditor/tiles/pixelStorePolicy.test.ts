import { describe, expect, it } from 'vitest';
import {
  choosePixelStoreBackend,
  choosePixelStoreTileSize,
  runTiledPixelStoreSelfTest,
} from './pixelStorePolicy';

describe('pixelStorePolicy', () => {
  it('selects 128px tiles for mobile or devices reporting at most 4GB', () => {
    expect(choosePixelStoreTileSize({ isMobile: true, deviceMemoryGb: 8 })).toBe(128);
    expect(choosePixelStoreTileSize({ isMobile: false, deviceMemoryGb: 4 })).toBe(128);
    expect(choosePixelStoreTileSize({ isMobile: false, deviceMemoryGb: 8 })).toBe(256);
    expect(choosePixelStoreTileSize({ isMobile: false, deviceMemoryGb: null })).toBe(256);
  });

  it('keeps Canvas as the permanent fallback until rollout and self-test gates pass', () => {
    expect(choosePixelStoreBackend({ tiledRolloutEnabled: false, selfTestPassed: true })).toBe('canvas');
    expect(choosePixelStoreBackend({ tiledRolloutEnabled: true, selfTestPassed: false })).toBe('canvas');
    expect(choosePixelStoreBackend({ tiledRolloutEnabled: true, selfTestPassed: true })).toBe('tiled');
  });

  it.each([128, 256])('passes the deterministic tiled COW startup self-test at %ipx', (tileSize) => {
    expect(runTiledPixelStoreSelfTest(tileSize)).toEqual({ passed: true, reason: null });
  });
});
