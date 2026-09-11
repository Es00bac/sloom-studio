import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppNode } from '../types/flow';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import {
  setCurrentProjectAuthorityClaim,
  type NativeVideoMediaRelinkResult,
  type SignalLoomNativeBridge,
} from './nativeApp';
import {
  collectUsedVideoMediaItemIds,
  consolidateVideoMediaItems,
  relinkVideoMediaItem,
} from './videoMediaManagementNative';

afterEach(() => {
  setCurrentProjectAuthorityClaim(undefined);
  vi.unstubAllGlobals();
});

function installBridge(bridge: Partial<SignalLoomNativeBridge>): void {
  vi.stubGlobal('window', { signalLoomNative: bridge });
}

describe('native Video media management client', () => {
  it('passes the exact current project claim to a relink and returns its committed item', async () => {
    const relinkVideoMedia = vi.fn(async (): Promise<NativeVideoMediaRelinkResult> => ({
      ok: true,
      canceled: false,
      item: sourceItem('camera-a', 'video'),
      version: 8,
    }));
    installBridge({ relinkVideoMedia });
    setCurrentProjectAuthorityClaim({ authorityId: 'project-a', version: 7 });

    await expect(relinkVideoMediaItem(' camera-a ')).resolves.toMatchObject({ ok: true, version: 8 });
    expect(relinkVideoMedia).toHaveBeenCalledWith({
      itemId: 'camera-a',
      claim: { authorityId: 'project-a', version: 7 },
    });
  });

  it('deduplicates consolidation identities without letting the renderer supply any filesystem path', async () => {
    const consolidateVideoMedia = vi.fn(async () => ({
      ok: true,
      canceled: false,
      items: [],
      targetDirectory: '/chosen/by/main',
      version: 9,
    }));
    installBridge({ consolidateVideoMedia });
    setCurrentProjectAuthorityClaim({ authorityId: 'project-a', version: 8 });

    await expect(consolidateVideoMediaItems([' camera-a ', 'music-a', 'camera-a', '']))
      .resolves.toMatchObject({ ok: true, targetDirectory: '/chosen/by/main' });
    expect(consolidateVideoMedia).toHaveBeenCalledWith({
      itemIds: ['camera-a', 'music-a'],
      claim: { authorityId: 'project-a', version: 8 },
    });
  });

  it('rejects a delayed native result after the renderer adopts another project', async () => {
    let finish!: (result: NativeVideoMediaRelinkResult) => void;
    const relinkVideoMedia = vi.fn(() => new Promise<NativeVideoMediaRelinkResult>((resolve) => {
      finish = resolve;
    }));
    installBridge({ relinkVideoMedia });
    setCurrentProjectAuthorityClaim({ authorityId: 'project-a', version: 1 });

    const pending = relinkVideoMediaItem('camera-a');
    setCurrentProjectAuthorityClaim({ authorityId: 'project-b', version: 1 });
    finish({ ok: true, canceled: false, version: 2 });

    await expect(pending).rejects.toThrow(/active project changed/);
  });

  it('fails closed when the desktop bridge or current project authority is absent', async () => {
    installBridge({});
    await expect(relinkVideoMediaItem('camera-a')).rejects.toThrow(/desktop app/);

    installBridge({ relinkVideoMedia: vi.fn() });
    await expect(relinkVideoMediaItem('camera-a')).rejects.toThrow(/current edit authority/);
    await expect(consolidateVideoMediaItems([])).rejects.toThrow(/No used native media/);
  });
});

describe('used Video media collection', () => {
  it('collects project-wide visual and audio references, including origin and image-asset aliases', () => {
    const items = [
      sourceItem('camera-a', 'video', { originNodeId: 'camera-node' }),
      sourceItem('panel-a', 'image'),
      sourceItem('music-a', 'audio'),
      sourceItem('nested-a', 'composition'),
      sourceItem('unused-a', 'video'),
      sourceItem('caption-a', 'subtitle'),
    ];
    const composition = {
      id: 'composition-1',
      type: 'composition',
      position: { x: 0, y: 0 },
      data: {
        editorAssets: [{
          id: 'asset-panel',
          kind: 'image',
          label: 'Panel',
          createdAt: 1,
          updatedAt: 1,
          imageSourceId: 'panel-a',
        }],
        editorVisualClips: [
          { id: 'v1', sourceNodeId: 'camera-node', sourceKind: 'video', trackIndex: 0, startMs: 0 },
          { id: 'v2', sourceNodeId: 'asset-panel', sourceKind: 'image', trackIndex: 1, startMs: 0 },
          { id: 'v3', sourceNodeId: 'nested-a', sourceKind: 'composition', trackIndex: 0, startMs: 1_000 },
          { id: 'v4', sourceNodeId: 'caption-a', sourceKind: 'text', trackIndex: 2, startMs: 0 },
        ],
        editorAudioClips: [
          { id: 'a1', sourceNodeId: 'music-a', trackIndex: 0, offsetMs: 0 },
          { id: 'a2', sourceNodeId: 'camera-node', trackIndex: 1, offsetMs: 0 },
        ],
      },
    } as AppNode;
    const unrelatedNode = {
      id: 'not-a-composition',
      type: 'textNode',
      position: { x: 0, y: 0 },
      data: {
        editorAudioClips: [{
          id: 'ignored',
          sourceNodeId: 'unused-a',
          trackIndex: 0,
          offsetMs: 0,
          volumePercent: 100,
          enabled: true,
        }],
      },
    } as AppNode;

    expect(collectUsedVideoMediaItemIds([composition, unrelatedNode], items)).toEqual([
      'camera-a',
      'panel-a',
      'music-a',
      'nested-a',
    ]);
  });
});

function sourceItem(
  id: string,
  kind: SourceBinLibraryItem['kind'],
  overrides: Partial<SourceBinLibraryItem> = {},
): SourceBinLibraryItem {
  return {
    id,
    label: id,
    kind,
    mimeType: kind === 'audio' ? 'audio/wav' : kind === 'image' ? 'image/png' : 'video/mp4',
    assetUrl: `signal-loom-asset://asset/${id}`,
    nativeFilePath: `/media/${id}`,
    createdAt: 1,
    ...overrides,
  };
}
