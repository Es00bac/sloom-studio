import { describe, expect, it } from 'vitest';
import type { SourceBin, SourceBinLibraryItem } from '../store/sourceBinStore';
import {
  applySourceLibraryNativeChange,
  buildSourceLibraryNativeSyncStatus,
  shouldAcceptSourceLibraryNativeVersion,
  shouldRepairSourceLibraryNativeVersionGap,
  sourceLibraryNativeAckNeedsRepair,
} from './sourceLibraryNativeSync';

const imageItem: SourceBinLibraryItem = {
  id: 'image-1',
  label: 'Panel 1',
  kind: 'image',
  mimeType: 'image/png',
  assetUrl: 'signal-loom-asset:///tmp/panel-1.png',
  createdAt: 1,
  sourceKey: 'node-1:run-1',
};

const makeBins = (items: SourceBinLibraryItem[] = [imageItem]): SourceBin[] => [{
  id: 'default',
  name: 'Source Library',
  collapsed: false,
  createdAt: 1,
  items,
}];

describe('source library native sync', () => {
  it('classifies native ACK failures as snapshot-repair candidates', () => {
    expect(sourceLibraryNativeAckNeedsRepair(undefined)).toBe(true);
    expect(sourceLibraryNativeAckNeedsRepair({ ok: false, error: 'IPC failed' })).toBe(true);
    expect(sourceLibraryNativeAckNeedsRepair({ ok: true, version: 4 })).toBe(false);
  });

  it('builds runtime-only source-library native sync statuses', () => {
    expect(buildSourceLibraryNativeSyncStatus('synced', {
      lastAckVersion: 7,
      message: 'Source Library synced.',
      now: 1000,
    })).toEqual({
      state: 'synced',
      lastAckVersion: 7,
      message: 'Source Library synced.',
      updatedAt: 1000,
    });
    expect(buildSourceLibraryNativeSyncStatus('degraded', {
      error: new Error('native bridge unavailable'),
      expectedNativeVersion: 11,
      now: 1100,
      repairDirection: 'pull-native-snapshot',
    })).toMatchObject({
      state: 'degraded',
      message: 'native bridge unavailable',
      expectedNativeVersion: 11,
      repairDirection: 'pull-native-snapshot',
      updatedAt: 1100,
    });
  });

  it('detects native version gaps that need authoritative snapshot repair', () => {
    expect(shouldRepairSourceLibraryNativeVersionGap(0, 3)).toBe(false);
    expect(shouldRepairSourceLibraryNativeVersionGap(3, 4)).toBe(false);
    expect(shouldRepairSourceLibraryNativeVersionGap(3, 5)).toBe(true);
    expect(shouldRepairSourceLibraryNativeVersionGap(5, 4)).toBe(false);
  });

  it('accepts only strictly newer valid native versions', () => {
    expect(shouldAcceptSourceLibraryNativeVersion(0, 1)).toBe(true);
    expect(shouldAcceptSourceLibraryNativeVersion(3, 3)).toBe(false);
    expect(shouldAcceptSourceLibraryNativeVersion(3, 2)).toBe(false);
    expect(shouldAcceptSourceLibraryNativeVersion(3, 4)).toBe(true);
  });

  it('replaces renderer bins from an authoritative native snapshot', () => {
    const next = applySourceLibraryNativeChange(
      { bins: makeBins([]), dismissedSourceKeys: ['old'] },
      {
        type: 'source-library-snapshot',
        snapshot: {
          bins: makeBins([imageItem]),
          dismissedSourceKeys: ['removed-source'],
        },
      },
    );

    expect(next.bins[0].items).toEqual([imageItem]);
    expect(next.dismissedSourceKeys).toEqual(['removed-source']);
  });

  it('ignores transient recovered scratch items from native snapshots', () => {
    const next = applySourceLibraryNativeChange(
      { bins: makeBins([]), dismissedSourceKeys: [] },
      {
        type: 'source-library-snapshot',
        snapshot: {
          dismissedSourceKeys: [],
          bins: [
            {
              id: 'default',
              name: 'Source Library',
              collapsed: false,
              createdAt: 1,
              items: [
                imageItem,
                {
                  ...imageItem,
                  id: 'recovered-inline',
                  label: 'Recovered Inline',
                  sourceKey: 'recovered-scratch:orphan-inline.png',
                  scratchFileName: 'orphan-inline.png',
                },
              ],
            },
            {
              id: 'recovered-scratch-assets',
              name: 'Recovered Scratch Assets',
              collapsed: true,
              createdAt: 2,
              items: [
                {
                  ...imageItem,
                  id: 'recovered-orphan',
                  label: 'Recovered Orphan',
                  sourceKey: 'recovered-scratch:orphan.png',
                  scratchFileName: 'orphan.png',
                },
              ],
            },
          ],
        },
      },
    );

    expect(next.bins.map((bin) => bin.id)).toEqual(['default']);
    expect(next.bins[0].items.map((item) => item.id)).toEqual(['image-1']);
  });

  it('merges newly added native items without duplicating existing source ids', () => {
    const addedItem = { ...imageItem, id: 'image-2', label: 'Panel 2', sourceKey: 'node-2:run-1' };
    const next = applySourceLibraryNativeChange(
      { bins: makeBins([imageItem]), dismissedSourceKeys: [] },
      {
        type: 'source-bin-items-added',
        items: [imageItem, addedItem],
      },
    );

    expect(next.bins[0].items.map((item) => item.id)).toEqual(['image-2', 'image-1']);
  });

  it('renames and removes native items using the same rules as workspace commands', () => {
    const renamed = applySourceLibraryNativeChange(
      { bins: makeBins([imageItem]), dismissedSourceKeys: [] },
      {
        type: 'source-bin-item-renamed',
        itemId: 'image-1',
        label: 'Renamed panel',
      },
    );

    expect(renamed.bins[0].items[0].label).toBe('Renamed panel');

    const removed = applySourceLibraryNativeChange(renamed, {
      type: 'source-bin-item-removed',
      itemId: 'image-1',
      sourceKey: 'node-1:run-1',
    });

    expect(removed.bins[0].items).toEqual([]);
    expect(removed.dismissedSourceKeys).toEqual(['node-1:run-1']);
  });
});
