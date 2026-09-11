import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  broadcastableSourceBinItem,
  buildPersistedSourceBinState,
  createQuotaSafeJSONStorage,
  persistableSourceBinAssetUrl,
  recoverSourceBinStorageValueAfterQuotaFailure,
  sanitizePersistedSourceBinState,
  useSourceBinStore,
} from './sourceBinStore';
import { fetchRemoteHostSourceAssetDataUrl, isServedLanSession } from '../lib/remoteHostClient';

// hydrateAssets dynamically imports the remote-host client to resolve a served desktop session's
// thumbnails through the phone. Mock it so the served-client branch is exercised deterministically;
// the default impl (not served) leaves every other test on the unchanged local-hydration path.
vi.mock('../lib/remoteHostClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/remoteHostClient')>();
  return {
    ...actual,
    isServedLanSession: vi.fn(() => false),
    fetchRemoteHostSourceAssetDataUrl: vi.fn(async () => null),
  };
});

// 811 F2: hydrateAssets must not re-read + re-mint scratch-backed items that are already resolved.
vi.mock('../lib/fileSystemWorkspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/fileSystemWorkspace')>();
  return {
    ...actual,
    loadScratchAssetBlob: vi.fn(async () => new File(['pixel bytes'], 'hero.png', { type: 'image/png' })),
  };
});
import { loadScratchAssetBlob } from '../lib/fileSystemWorkspace';

const originalRevokeObjectUrl = URL.revokeObjectURL;

describe('persistableSourceBinAssetUrl (quota-safe persistence)', () => {
  // Regression: on a phone-served desktop session, hydrateAssets replaces a native-file item's
  // unreachable capacitor assetUrl with the multi-MB `data:` thumbnail streamed from the host (the
  // nativeFilePath stays set). Persisting those base64 thumbnails blew the localStorage 5MB quota,
  // and the setItem throw cascaded out of every setState — surfacing as broken live-sync AND an
  // "Image Export Failed — The quota has been exceeded." dialog. The persisted payload must never
  // include a re-derivable `data:`/`blob:` URL; those are streamed back via /source-asset/:itemId.
  it('persists a native item\'s stable (non-data) capacitor URL', () => {
    expect(
      persistableSourceBinAssetUrl({
        nativeFilePath: 'file:///storage/emulated/0/Pictures/Untitled-1.png',
        assetUrl: 'https://localhost/_capacitor_file_/storage/emulated/0/Pictures/Untitled-1.png',
      }),
    ).toBe('https://localhost/_capacitor_file_/storage/emulated/0/Pictures/Untitled-1.png');
  });

  it('drops a multi-MB data: thumbnail so it can never blow the persist quota', () => {
    expect(
      persistableSourceBinAssetUrl({
        nativeFilePath: 'file:///storage/emulated/0/Pictures/Untitled-1.png',
        assetUrl: 'data:image/png;base64,AAAA'.padEnd(2_000_000, 'A'),
      }),
    ).toBeUndefined();
  });

  it('drops a blob: URL (process-local, not persistable)', () => {
    expect(
      persistableSourceBinAssetUrl({
        nativeFilePath: 'file:///storage/emulated/0/Pictures/Untitled-1.png',
        assetUrl: 'blob:https://localhost/8f3c-7a21',
      }),
    ).toBeUndefined();
  });

  it('keeps inline recovery bytes when no other durable copy exists', () => {
    expect(persistableSourceBinAssetUrl({
      assetUrl: 'data:image/png;base64,UkVDT1ZFUlY=',
      durability: 'recovery-inline',
    })).toBe('data:image/png;base64,UkVDT1ZFUlY=');
  });

  it('persists nothing for an item without a nativeFilePath', () => {
    expect(
      persistableSourceBinAssetUrl({
        nativeFilePath: undefined,
        assetUrl: 'https://localhost/_capacitor_file_/whatever.png',
      }),
    ).toBeUndefined();
    expect(
      persistableSourceBinAssetUrl({ nativeFilePath: undefined, assetUrl: undefined }),
    ).toBeUndefined();
  });
});

describe('Source Library quota recovery restart payload (AUD-031)', () => {
  it('keeps the item and degraded state when inline recovery bytes cannot fit', () => {
    const compact = recoverSourceBinStorageValueAfterQuotaFailure(JSON.stringify({
      version: 1,
      state: {
        bins: [{
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [{
            id: 'quota-recovery',
            label: 'Quota recovery image',
            kind: 'image',
            mimeType: 'image/png',
            assetUrl: 'data:image/png;base64,VE9PLUxBUkdF',
            durability: 'recovery-inline',
            createdAt: 2,
          }],
        }],
        dismissedSourceKeys: [],
        durabilityStatus: { state: 'ready' },
      },
    }));

    expect(compact).toBeDefined();
    const parsed = JSON.parse(compact!) as { state: unknown };
    const reloaded = sanitizePersistedSourceBinState(parsed.state);
    expect(reloaded.bins?.[0].items).toEqual([
      expect.objectContaining({
        id: 'quota-recovery',
        assetUrl: undefined,
        durability: 'unavailable',
        durabilityMessage: expect.stringContaining('must be regenerated or reimported'),
      }),
    ]);
    expect(reloaded.durabilityStatus).toMatchObject({
      state: 'degraded',
      message: expect.stringContaining('storage is degraded'),
    });
  });

  it('retries the actual persistence write with compact recoverable metadata after quota failure', async () => {
    const persisted = new Map<string, string>();
    const quotaError = Object.assign(new Error('quota exhausted'), { name: 'QuotaExceededError' });
    const localStorage = {
      getItem: vi.fn((name: string) => persisted.get(name) ?? null),
      setItem: vi.fn((name: string, value: string) => {
        if (value.includes('VE9PLUxBUkdF')) throw quotaError;
        persisted.set(name, value);
      }),
      removeItem: vi.fn((name: string) => persisted.delete(name)),
      clear: vi.fn(() => persisted.clear()),
      key: vi.fn(() => null),
      get length() {
        return persisted.size;
      },
    } satisfies Storage;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', { localStorage });

    try {
      useSourceBinStore.setState({ durabilityStatus: { state: 'ready' } });
      const storage = createQuotaSafeJSONStorage();
      expect(storage).toBeDefined();
      storage!.setItem('source-library', {
        version: 1,
        state: {
          bins: [{
            id: 'default',
            name: 'Source Library',
            collapsed: false,
            createdAt: 1,
            items: [{
              id: 'quota-recovery',
              label: 'Quota recovery image',
              kind: 'image',
              mimeType: 'image/png',
              assetUrl: 'data:image/png;base64,VE9PLUxBUkdF',
              durability: 'recovery-inline',
              createdAt: 2,
            }],
          }],
          dismissedSourceKeys: [],
          durabilityStatus: { state: 'ready' },
        },
      });
      await Promise.resolve();

      expect(localStorage.setItem).toHaveBeenCalledTimes(2);
      const stored = JSON.parse(persisted.get('source-library')!) as { state: unknown };
      const reloaded = sanitizePersistedSourceBinState(stored.state);
      expect(reloaded.bins?.[0].items[0]).toMatchObject({
        id: 'quota-recovery',
        assetUrl: undefined,
        durability: 'unavailable',
      });
      expect(useSourceBinStore.getState().durabilityStatus.state).toBe('degraded');
    } finally {
      vi.unstubAllGlobals();
      warning.mockRestore();
    }
  });

  it('does not let unavailable browser storage reads or removals escape into callers', () => {
    const localStorage = {
      getItem: vi.fn(() => {
        throw new Error('storage disabled');
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(() => {
        throw new Error('storage disabled');
      }),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    } satisfies Storage;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', { localStorage });

    try {
      const storage = createQuotaSafeJSONStorage();
      expect(storage?.getItem('source-library')).toBeNull();
      expect(() => storage?.removeItem('source-library')).not.toThrow();
      expect(warning).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      warning.mockRestore();
    }
  });
});

describe('broadcastableSourceBinItem (811 F3 — no bytes on the broadcast bus)', () => {
  const base = {
    id: 'item-1',
    label: 'Generated hero',
    kind: 'image' as const,
    createdAt: 1,
  };

  it('strips a data: URL when the item has durable backing to re-resolve from', () => {
    expect(broadcastableSourceBinItem({ ...base, assetUrl: 'data:image/png;base64,AAAA', assetId: 'asset-1' }).assetUrl).toBeUndefined();
    expect(broadcastableSourceBinItem({ ...base, assetUrl: 'data:image/png;base64,AAAA', scratchFileName: 'x.png' }).assetUrl).toBeUndefined();
    expect(broadcastableSourceBinItem({ ...base, assetUrl: 'data:image/png;base64,AAAA', nativeFilePath: '/x.png' }).assetUrl).toBeUndefined();
  });

  it('keeps a data: URL on a fallback-only item — it is the only copy of the bytes', () => {
    const fallback = { ...base, assetUrl: 'data:image/png;base64,AAAA' };
    expect(broadcastableSourceBinItem(fallback)).toBe(fallback);
  });

  it('always strips blob: URLs — they can never load in another document', () => {
    expect(broadcastableSourceBinItem({ ...base, assetUrl: 'blob:null/xyz' }).assetUrl).toBeUndefined();
    expect(broadcastableSourceBinItem({ ...base, assetUrl: 'blob:null/xyz', assetId: 'asset-1' }).assetUrl).toBeUndefined();
  });

  it('passes stable non-byte URLs through untouched', () => {
    const native = { ...base, assetUrl: 'signal-loom-asset://file/encoded', nativeFilePath: '/x.png' };
    expect(broadcastableSourceBinItem(native)).toBe(native);
  });
});

describe('hydrateAssets re-resolution guard (811 F2)', () => {
  it('mints a scratch blob once and skips the disk read on every later pass', async () => {
    let mintCount = 0;
    const originalCreateObjectUrl = URL.createObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => {
        mintCount += 1;
        return `blob:mock-${mintCount}`;
      },
    });

    try {
      useSourceBinStore.setState({
        bins: [{
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: Date.now(),
          items: [{
            id: 'scratch-1',
            label: 'hero.png',
            kind: 'image',
            scratchFileName: 'hero.png',
            createdAt: 1,
          }],
        }],
        scratchDirectoryHandle: {} as FileSystemDirectoryHandle,
      });
      vi.mocked(loadScratchAssetBlob).mockClear();

      await useSourceBinStore.getState().hydrateAssets();
      const afterFirst = useSourceBinStore.getState().getAllItems()[0].assetUrl;
      expect(afterFirst).toBe('blob:mock-1');
      expect(vi.mocked(loadScratchAssetBlob)).toHaveBeenCalledTimes(1);

      // Any add/broadcast/reconcile fires hydrateAssets again — the resolved item must be skipped.
      await useSourceBinStore.getState().hydrateAssets();
      await useSourceBinStore.getState().hydrateAssets();
      expect(useSourceBinStore.getState().getAllItems()[0].assetUrl).toBe('blob:mock-1');
      expect(vi.mocked(loadScratchAssetBlob)).toHaveBeenCalledTimes(1);
      expect(mintCount).toBe(1);
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectUrl,
      });
      useSourceBinStore.setState({ scratchDirectoryHandle: undefined });
    }
  });
});

describe('source bin native file integration', () => {
  beforeEach(() => {
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: Date.now() }],
      dismissedSourceKeys: [],
      sidebarOpen: true,
      scratchDirectoryHandle: undefined,
      nativeScratchDirectoryPath: undefined,
    });
    vi.mocked(isServedLanSession).mockReturnValue(false);
    vi.mocked(fetchRemoteHostSourceAssetDataUrl).mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  });

  it('imports native media descriptors without converting them into browser asset records', async () => {
    await useSourceBinStore.getState().importNativeFiles([
      {
        id: 'native-video-1',
        label: 'clip.mp4',
        kind: 'video',
        mimeType: 'video/mp4',
        assetUrl: 'signal-loom-asset://file/encoded-path',
        nativeFilePath: '/mnt/xtra/project/clip.mp4',
        isGenerated: false,
        createdAt: 1,
      },
    ]);

    const allItems = useSourceBinStore.getState().bins.flatMap((bin) => bin.items);
    expect(allItems).toEqual([
      expect.objectContaining({
        id: 'native-video-1',
        assetUrl: 'signal-loom-asset://file/encoded-path',
        nativeFilePath: '/mnt/xtra/project/clip.mp4',
      }),
    ]);
  });

  it('does not resurrect a user-deleted item while its node is still wired (811 F1)', async () => {
    const connected = [{
      id: 'source-image-1',
      nodeId: 'image-node-1',
      kind: 'image' as const,
      label: 'Generated hero',
      assetUrl: 'data:image/png;base64,aGVybw==',
      mimeType: 'image/png',
      isGenerated: true,
    }];

    await useSourceBinStore.getState().ingestConnectedItems(connected);
    const ingested = useSourceBinStore.getState().getAllItems();
    expect(ingested).toHaveLength(1);

    useSourceBinStore.getState().removeItem(ingested[0].id);
    expect(useSourceBinStore.getState().getAllItems()).toHaveLength(0);
    expect(useSourceBinStore.getState().dismissedSourceKeys).toContain(ingested[0].sourceKey);

    // The ingest effect re-runs on any graph change — the deleted item must stay deleted.
    await useSourceBinStore.getState().ingestConnectedItems(connected);
    expect(useSourceBinStore.getState().getAllItems()).toHaveLength(0);

    // An explicit re-add with the same sourceKey is intentional: it lands and un-dismisses.
    await useSourceBinStore.getState().addAssetItem({
      label: 'Generated hero',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,aGVybw==',
      sourceKey: ingested[0].sourceKey,
    });
    expect(useSourceBinStore.getState().getAllItems()).toHaveLength(1);
    expect(useSourceBinStore.getState().dismissedSourceKeys).not.toContain(ingested[0].sourceKey);
  });

  it('places browser file imports into the shared Project imports envelope', async () => {
    const file = new File(['image bytes'], 'imported-panel.png', { type: 'image/png', lastModified: 1710000000000 });

    await useSourceBinStore.getState().importFiles([file]);

    const allItems = useSourceBinStore.getState().getAllItems();
    expect(allItems).toHaveLength(1);
    expect(allItems[0]).toMatchObject({
      label: 'imported-panel.png',
      kind: 'image',
      mimeType: 'image/png',
      envelopeId: 'project-imports',
      envelopeLabel: 'Project imports',
      envelopeIndex: 0,
      isGenerated: false,
    });
  });

  it('continues Project imports envelope indexes across browser and native imports', async () => {
    await useSourceBinStore.getState().importFiles([
      new File(['image a'], 'first-import.png', { type: 'image/png', lastModified: 1710000000000 }),
    ]);

    await useSourceBinStore.getState().importNativeFiles([
      {
        id: 'native-image-2',
        label: 'second-import.png',
        kind: 'image',
        mimeType: 'image/png',
        assetUrl: 'signal-loom-asset://file/second-import',
        nativeFilePath: '/project/second-import.png',
        createdAt: 2,
      },
    ]);

    const imports = useSourceBinStore.getState()
      .getAllItems()
      .filter((item) => item.envelopeId === 'project-imports')
      .sort((left, right) => (left.envelopeIndex ?? 0) - (right.envelopeIndex ?? 0));

    expect(imports.map((item) => [item.label, item.envelopeIndex])).toEqual([
      ['first-import.png', 0],
      ['second-import.png', 1],
    ]);
  });

  it('keeps embedded asset data for browser file imports in native save snapshots', async () => {
    const file = new File(['image bytes'], 'saved-panel.png', { type: 'image/png', lastModified: 1710000000000 });

    await useSourceBinStore.getState().importFiles([file]);

    const snapshot = await useSourceBinStore.getState().exportProjectSnapshot({
      includeAssetData: true,
    });

    expect(snapshot.bins?.[0]?.items[0]).toEqual(expect.objectContaining({
      label: 'saved-panel.png',
      assetUrl: expect.stringMatching(/^data:image\/png;base64,/),
      envelopeId: 'project-imports',
      envelopeLabel: 'Project imports',
      envelopeIndex: 0,
    }));
  });

  it('keeps mounted Hane provider bins out of local persistence and project snapshots', async () => {
    const localBin = {
      id: 'default',
      name: 'Source Library',
      collapsed: false,
      createdAt: 1,
      items: [],
    };
    const haneBin = {
      id: 'hane:gallery',
      name: 'Hane Gallery',
      collapsed: false,
      createdAt: 2,
      items: [{
        id: 'hane:art-1',
        label: 'Phone art',
        kind: 'image' as const,
        mimeType: 'image/png',
        assetUrl: 'data:image/png;base64,SEFORQ==',
        createdAt: 3,
      }],
    };
    useSourceBinStore.setState({ bins: [localBin, haneBin] });

    const persisted = buildPersistedSourceBinState(useSourceBinStore.getState());
    const project = await useSourceBinStore.getState().exportProjectSnapshot({
      includeAssetData: true,
    });

    expect(persisted.bins?.map((bin) => bin.id) ?? []).toEqual(['default']);
    expect(project.bins?.map((bin) => bin.id) ?? []).toEqual(['default']);
  });

  it('preserves a live Hane provider mount when a local project snapshot replaces local bins', () => {
    useSourceBinStore.setState({
      bins: [{
        id: 'hane:gallery',
        name: 'Hane Gallery',
        collapsed: false,
        createdAt: 2,
        items: [],
      }],
    });

    useSourceBinStore.getState().commitPreparedProjectSnapshot({
      bins: [{
        id: 'new-local',
        name: 'New local project',
        collapsed: false,
        createdAt: 4,
        items: [],
      }],
      dismissedSourceKeys: [],
    }, { publishNative: false });

    expect(useSourceBinStore.getState().bins.map((bin) => bin.id)).toEqual([
      'new-local',
      'hane:gallery',
    ]);
  });

  it('updates an existing asset item in place and revokes the old object URL', async () => {
    const revokeMock = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeMock,
    });

    await useSourceBinStore.getState().addAssetItem({
      id: 'update-test-1',
      label: 'initial.png',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'blob:test-initial-data',
    });

    expect(useSourceBinStore.getState().getAllItems()[0].label).toBe('initial.png');

    await useSourceBinStore.getState().updateAssetItemData('update-test-1', {
      label: 'updated.png',
      mimeType: 'image/jpeg',
      dataUrl: 'blob:test-updated-data',
    });

    const allItems = useSourceBinStore.getState().getAllItems();
    expect(allItems.length).toBe(1);
    expect(allItems[0].id).toBe('update-test-1');
    expect(allItems[0].label).toBe('updated.png');
    expect(allItems[0].mimeType).toBe('image/jpeg');
    expect(revokeMock).toHaveBeenCalledWith('blob:test-initial-data');
  });

  it('upserts deterministic asset payloads by source key without changing the item id', async () => {
    const firstItem = await useSourceBinStore.getState().addAssetItem({
      label: 'Paper Page 1',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,Zmlyc3Q=',
      sourceKey: 'paper-page:doc-1:page-1:1920x1080:trim',
      envelopeId: 'paper-storyboard:doc-1',
      envelopeLabel: 'Paper storyboard pages',
      envelopeIndex: 0,
    });

    const secondItem = await useSourceBinStore.getState().addAssetItem({
      label: 'Paper Page 1 refreshed',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,c2Vjb25k',
      sourceKey: 'paper-page:doc-1:page-1:1920x1080:trim',
      envelopeId: 'paper-storyboard:doc-1',
      envelopeLabel: 'Paper storyboard pages',
      envelopeIndex: 0,
    });

    const allItems = useSourceBinStore.getState().getAllItems();

    expect(secondItem.id).toBe(firstItem.id);
    expect(allItems).toHaveLength(1);
    expect(allItems[0]).toMatchObject({
      id: firstItem.id,
      label: 'Paper Page 1 refreshed',
      sourceKey: 'paper-page:doc-1:page-1:1920x1080:trim',
      envelopeId: 'paper-storyboard:doc-1',
      envelopeIndex: 0,
    });
  });

  it('never gives a deferred run ownership of an existing deduplicated asset', async () => {
    const firstItem = await useSourceBinStore.getState().addAssetItem({
      label: 'Published source',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,UFVCTElTSEVE',
      sourceKey: 'deduplicated:source',
    });

    const deferredResult = await useSourceBinStore.getState().addAssetItem({
      label: 'Stale replacement',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,U1RBTEU=',
      sourceKey: 'deduplicated:source',
    }, undefined, { deferPublication: true });

    expect(deferredResult).toEqual(firstItem);
    expect(useSourceBinStore.getState().discardProvisionalAssetItem(firstItem.id)).toBeUndefined();
    expect(useSourceBinStore.getState().getAllItems()).toEqual([firstItem]);
  });

  it('stores native document, subtitle, and package descriptors as source-bin assets', async () => {
    await useSourceBinStore.getState().importNativeFiles([
      {
        id: 'native-doc-1',
        label: 'layout.idml',
        kind: 'document',
        mimeType: 'application/vnd.adobe.indesign-idml-package',
        assetUrl: 'signal-loom-asset://file/doc-path',
        nativeFilePath: '/mnt/xtra/project/layout.idml',
        createdAt: 1,
      },
      {
        id: 'native-sub-1',
        label: 'captions.vtt',
        kind: 'subtitle',
        mimeType: 'text/vtt',
        assetUrl: 'signal-loom-asset://file/sub-path',
        nativeFilePath: '/mnt/xtra/project/captions.vtt',
        createdAt: 2,
      },
      {
        id: 'native-package-1',
        label: 'project.sloom',
        kind: 'package',
        mimeType: 'application/vnd.signal-loom.project+json',
        assetUrl: 'signal-loom-asset://file/package-path',
        nativeFilePath: '/mnt/xtra/project/project.sloom',
        createdAt: 3,
      },
    ]);

    expect(useSourceBinStore.getState().bins[0].items.map((item) => item.kind)).toEqual([
      'document',
      'subtitle',
      'package',
    ]);
  });

  it('preserves native asset URLs in project snapshots so reopen can find local media', async () => {
    await useSourceBinStore.getState().importNativeFiles([
      {
        id: 'native-audio-1',
        label: 'sound.wav',
        kind: 'audio',
        mimeType: 'audio/wav',
        assetUrl: 'signal-loom-asset://file/audio-path',
        nativeFilePath: '/mnt/xtra/project/sound.wav',
        scratchFileName: 'sound.wav',
        createdAt: 2,
      },
    ]);

    const snapshot = await useSourceBinStore.getState().exportProjectSnapshot();

    expect(snapshot.bins?.[0]?.items[0]).toMatchObject({
      id: 'native-audio-1',
      assetUrl: 'signal-loom-asset://file/audio-path',
      nativeFilePath: '/mnt/xtra/project/sound.wav',
      scratchFileName: 'sound.wav',
    });
  });

  it('persists starred and collapsed source-bin item state through project snapshots', async () => {
    useSourceBinStore.setState({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: Date.now(),
          items: [
            {
              id: 'clip-1',
              label: 'clip.mp4',
              kind: 'video',
              mimeType: 'video/mp4',
              assetUrl: 'signal-loom-asset://file/clip',
              nativeFilePath: '/mnt/xtra/project/clip.mp4',
              createdAt: 3,
              starred: true,
              collapsed: true,
            },
          ],
        },
      ],
    });

    const snapshot = await useSourceBinStore.getState().exportProjectSnapshot();
    await useSourceBinStore.getState().restoreProjectSnapshot(undefined);
    await useSourceBinStore.getState().restoreProjectSnapshot(snapshot);

    expect(useSourceBinStore.getState().bins[0].items[0]).toMatchObject({
      id: 'clip-1',
      starred: true,
      collapsed: true,
    });
  });

  it('keeps native scratch descriptors visible when the linked file is missing or empty', async () => {
    await useSourceBinStore.getState().restoreProjectSnapshot({
      dismissedSourceKeys: [],
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            {
              id: 'panel-image-1',
              label: 'Panel image 1',
              kind: 'image',
              mimeType: 'image/png',
              nativeFilePath: '/project/Issue 1.signal-loom-scratch/panel-image-1.png',
              scratchFileName: 'panel-image-1.png',
              createdAt: 2,
              envelopeId: 'panel-envelope',
              envelopeLabel: 'Panel envelope',
              envelopeIndex: 0,
            },
          ],
        },
      ],
    });

    expect(useSourceBinStore.getState().bins[0].items).toEqual([
      expect.objectContaining({
        id: 'panel-image-1',
        label: 'Panel image 1',
        kind: 'image',
        assetUrl: undefined,
        nativeFilePath: '/project/Issue 1.signal-loom-scratch/panel-image-1.png',
        scratchFileName: 'panel-image-1.png',
        envelopeId: 'panel-envelope',
      }),
    ]);
  });

  it('does not let a stale async asset hydration overwrite a newer restored project snapshot', async () => {
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [
          { id: 'stale-1', label: 'Stale image', kind: 'image', mimeType: 'image/png', createdAt: 1 },
        ],
      }],
      dismissedSourceKeys: [],
    });

    const hydration = useSourceBinStore.getState().hydrateAssets();

    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 2,
        items: [
          { id: 'restored-1', label: 'Restored image', kind: 'image', mimeType: 'image/png', createdAt: 2 },
        ],
      }],
      dismissedSourceKeys: [],
    });

    await hydration;

    expect(useSourceBinStore.getState().bins[0].items.map((item) => item.id)).toEqual(['restored-1']);
  });

  it('served LAN client resolves a native-file-backed item through the host source-asset endpoint', async () => {
    // A phone-native item carries an unreachable phone-local capacitor assetUrl and has no assetId,
    // so its thumbnail <img> fails with ERR_CONNECTION_REFUSED in the served desktop browser. The
    // served-client hydration path must stream the bytes from the phone instead.
    vi.mocked(isServedLanSession).mockReturnValue(true);
    vi.mocked(fetchRemoteHostSourceAssetDataUrl).mockImplementation(async (itemId) =>
      itemId === 'native-1' ? 'data:image/png;base64,HOSTEDBYTES' : null,
    );

    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'native-1',
          label: 'Phone image',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'https://localhost/_capacitor_file_/storage/emulated/0/native-1.png',
          nativeFilePath: '/storage/emulated/0/native-1.png',
          createdAt: 1,
        }],
      }],
      dismissedSourceKeys: [],
    });

    await useSourceBinStore.getState().hydrateAssets();

    expect(vi.mocked(fetchRemoteHostSourceAssetDataUrl)).toHaveBeenCalledWith('native-1');
    expect(useSourceBinStore.getState().bins[0].items[0].assetUrl).toBe('data:image/png;base64,HOSTEDBYTES');
  });

  it('served LAN client does not re-stream an item already resolved to a hosted data URL', async () => {
    vi.mocked(isServedLanSession).mockReturnValue(true);
    vi.mocked(fetchRemoteHostSourceAssetDataUrl).mockResolvedValue('data:image/png;base64,SHOULDNOTBEUSED');

    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'already-1',
          label: 'Resolved image',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'data:image/png;base64,ALREADYHOSTED',
          createdAt: 1,
        }],
      }],
      dismissedSourceKeys: [],
    });

    await useSourceBinStore.getState().hydrateAssets();

    expect(vi.mocked(fetchRemoteHostSourceAssetDataUrl)).not.toHaveBeenCalled();
    expect(useSourceBinStore.getState().bins[0].items[0].assetUrl).toBe('data:image/png;base64,ALREADYHOSTED');
  });

  it('treats an unavailable phone-host response as retryable rather than permanent legacy loss', async () => {
    vi.mocked(isServedLanSession).mockReturnValue(true);
    vi.mocked(fetchRemoteHostSourceAssetDataUrl).mockResolvedValue(null);
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'phone-temporary',
          label: 'Phone image',
          kind: 'image',
          assetUrl: 'signal-loom-asset://asset/phone-temporary',
          createdAt: 1,
        }],
      }],
      durabilityStatus: { state: 'ready' },
      dismissedSourceKeys: [],
    });

    await useSourceBinStore.getState().hydrateAssets();

    expect(useSourceBinStore.getState().bins[0].items[0]).toMatchObject({
      assetUrl: undefined,
      durability: 'unavailable',
      durabilityMessage: expect.stringContaining('retry automatically'),
    });
    expect(useSourceBinStore.getState().durabilityStatus).toEqual({ state: 'ready' });
  });

  it('recovers a legacy named asset id or reports one stable unavailable item without retrying the native URL', async () => {
    vi.mocked(isServedLanSession).mockReturnValue(false);
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'legacy-item',
          label: 'Legacy panel',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'signal-loom-asset://asset/legacy-item',
          createdAt: 1,
        }],
      }],
      durabilityStatus: { state: 'ready' },
      dismissedSourceKeys: [],
    });

    await useSourceBinStore.getState().hydrateAssets();

    expect(useSourceBinStore.getState().bins[0].items[0]).toEqual(expect.objectContaining({
      id: 'legacy-item',
      assetId: 'legacy-item',
      assetUrl: undefined,
      durability: 'unavailable',
      durabilityMessage: expect.stringContaining('Relink or reimport'),
    }));
    expect(useSourceBinStore.getState().durabilityStatus).toEqual(expect.objectContaining({
      state: 'degraded',
      affectedItemIds: ['legacy-item'],
    }));
  });

  it('served LAN client still resolves a newly added native-file item when a concurrent bins change lands during hydration', async () => {
    // Live-sync path (an item drawn in Image and exported to Flow on the phone AFTER pairing):
    // `applyHostSourceLibraryEvent` fires `hydrateAssets()` on every event, and those overlap. While
    // the new native-file item's bytes are being streamed from the host (a real LAN round-trip), a
    // second live event lands and changes the bins signature. The all-or-nothing stale guard used to
    // discard the WHOLE resolved pass, so the new item kept its unreachable phone-local capacitor
    // assetUrl -> no thumbnail + "Preview unavailable" on open. The resolution must survive a
    // concurrent change as long as the item still exists with the same pre-resolution assetUrl.
    vi.mocked(isServedLanSession).mockReturnValue(true);

    let resolveHostFetch: () => void = () => {};
    let signalFetchStarted: () => void = () => {};
    const fetchStarted = new Promise<void>((resolve) => {
      signalFetchStarted = resolve;
    });
    vi.mocked(fetchRemoteHostSourceAssetDataUrl).mockImplementation((itemId) => {
      if (itemId !== 'native-D') return Promise.resolve(null);
      signalFetchStarted();
      return new Promise<string>((resolve) => {
        resolveHostFetch = () => resolve('data:image/png;base64,DRAWNBYTES');
      });
    });

    const capacitorUrl = 'https://localhost/_capacitor_file_/storage/emulated/0/native-D.png';
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'native-D',
          label: 'Drawn export',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: capacitorUrl,
          nativeFilePath: '/storage/emulated/0/native-D.png',
          createdAt: 1,
        }],
      }],
      dismissedSourceKeys: [],
    });

    const hydration = useSourceBinStore.getState().hydrateAssets();

    // Wait until hydrateAssets is mid-flight on the host fetch, then land a concurrent bins change
    // (a second live event appended item E) that shifts the hydration signature.
    await fetchStarted;
    useSourceBinStore.setState((state) => ({
      bins: state.bins.map((bin) => ({
        ...bin,
        items: [
          ...bin.items,
          {
            id: 'native-E',
            label: 'Second export',
            kind: 'image' as const,
            mimeType: 'image/png',
            assetUrl: 'data:image/png;base64,ALREADYHOSTED-E',
            createdAt: 2,
          },
        ],
      })),
    }));

    resolveHostFetch();
    await hydration;

    const items = useSourceBinStore.getState().bins[0].items;
    const drawn = items.find((item) => item.id === 'native-D');
    const second = items.find((item) => item.id === 'native-E');
    expect(drawn?.assetUrl).toBe('data:image/png;base64,DRAWNBYTES');
    // The concurrent change must not be lost either.
    expect(second?.assetUrl).toBe('data:image/png;base64,ALREADYHOSTED-E');
  });

  it('persists envelope grouping metadata through project snapshots', async () => {
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'item-1',
          label: 'Generated image 1',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'data:image/png;base64,AAA',
          createdAt: 2,
          envelopeId: 'image-node-1',
          envelopeLabel: 'Image Generation Envelope',
          envelopeIndex: 0,
        }],
      }],
      dismissedSourceKeys: [],
    });

    const snapshot = await useSourceBinStore.getState().exportProjectSnapshot({ includeAssetData: true });
    await useSourceBinStore.getState().restoreProjectSnapshot(undefined);
    await useSourceBinStore.getState().restoreProjectSnapshot(snapshot);

    expect(useSourceBinStore.getState().bins[0].items[0]).toMatchObject({
      envelopeId: 'image-node-1',
      envelopeLabel: 'Image Generation Envelope',
      envelopeIndex: 0,
    });
  });

  it('can star and collapse individual source-bin items plus collapse or expand all items', () => {
    useSourceBinStore.setState({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: Date.now(),
          items: [
            { id: 'a', label: 'A', kind: 'video', createdAt: 1 },
            { id: 'b', label: 'B', kind: 'audio', createdAt: 2 },
          ],
        },
      ],
    });

    useSourceBinStore.getState().toggleItemStarred('b');
    useSourceBinStore.getState().setItemCollapsed('a', true);
    useSourceBinStore.getState().setAllItemsCollapsed(true);

    expect(useSourceBinStore.getState().bins[0].items).toEqual([
      expect.objectContaining({ id: 'a', collapsed: true }),
      expect.objectContaining({ id: 'b', starred: true, collapsed: true }),
    ]);

    useSourceBinStore.getState().toggleItemStarred('b');
    useSourceBinStore.getState().setAllItemsCollapsed(false);

    expect(useSourceBinStore.getState().bins[0].items).toEqual([
      expect.objectContaining({ id: 'a', collapsed: false }),
      expect.objectContaining({ id: 'b', starred: false, collapsed: false }),
    ]);
  });

  it('renames source-bin items without losing their durable asset metadata', () => {
    useSourceBinStore.setState({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            {
              id: 'image-1',
              label: 'Old panel.png',
              kind: 'image',
              mimeType: 'image/png',
              assetId: 'asset-1',
              assetUrl: 'data:image/png;base64,AAA',
              createdAt: 2,
            },
          ],
        },
      ],
    });

    useSourceBinStore.getState().renameItem('image-1', '  New panel.png  ');

    expect(useSourceBinStore.getState().bins[0].items[0]).toEqual(expect.objectContaining({
      id: 'image-1',
      label: 'New panel.png',
      assetId: 'asset-1',
      assetUrl: 'data:image/png;base64,AAA',
    }));
  });

  it('updates bounded professional logging metadata without losing media identity', () => {
    useSourceBinStore.setState({
      bins: [{
        id: 'rushes', name: 'Rushes', collapsed: false, createdAt: 1,
        items: [{
          id: 'camera-a', label: 'A001.mov', kind: 'video', createdAt: 2,
          nativeFilePath: '/media/A001.mov',
          professional: { version: 1, origin: 'imported' },
        }],
      }],
    });

    useSourceBinStore.getState().updateItemProfessional('camera-a', {
      version: 1,
      origin: 'imported',
      tags: ['interview', 'hero'],
      rating: 5,
      logging: { scene: '12', take: '3', camera: 'A', status: 'selected', notes: 'Primary take' },
    });

    expect(useSourceBinStore.getState().bins[0].items[0]).toMatchObject({
      id: 'camera-a',
      nativeFilePath: '/media/A001.mov',
      professional: {
        tags: ['interview', 'hero'],
        rating: 5,
        logging: { scene: '12', take: '3', camera: 'A', status: 'selected', notes: 'Primary take' },
      },
    });
  });

  it('batch-updates professional metadata across bins in one bounded state transaction', () => {
    useSourceBinStore.setState({
      bins: [
        { id: 'rushes-a', name: 'Rushes A', collapsed: false, createdAt: 1, items: [
          { id: 'camera-a', label: 'A.mov', kind: 'video', createdAt: 2 },
          { id: 'untouched', label: 'Keep.mov', kind: 'video', createdAt: 3 },
        ] },
        { id: 'rushes-b', name: 'Rushes B', collapsed: false, createdAt: 4, items: [
          { id: 'camera-b', label: 'B.mov', kind: 'video', createdAt: 5 },
        ] },
      ],
    });

    useSourceBinStore.getState().updateItemsProfessional([
      { id: 'camera-a', professional: { version: 1, origin: 'imported', rating: 5, tags: ['select'] } },
      { id: 'camera-b', professional: { version: 1, origin: 'imported', rating: 4, tags: ['alternate'] } },
      { id: 'missing', professional: { version: 1, origin: 'imported', rating: 1 } },
    ]);

    const items = useSourceBinStore.getState().bins.flatMap((bin) => bin.items);
    expect(items.find((item) => item.id === 'camera-a')?.professional).toMatchObject({ rating: 5, tags: ['select'] });
    expect(items.find((item) => item.id === 'camera-b')?.professional).toMatchObject({ rating: 4, tags: ['alternate'] });
    expect(items.find((item) => item.id === 'untouched')?.professional).toBeUndefined();
  });

  it('collapses envelope groups by marking every item in that source-library envelope', async () => {
    useSourceBinStore.setState({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            {
              id: 'env-a',
              label: 'Frame A',
              kind: 'image',
              assetUrl: 'data:image/png;base64,AAA',
              createdAt: 2,
              envelopeId: 'env-1',
              envelopeLabel: 'Storyboard envelope',
            },
            {
              id: 'env-b',
              label: 'Frame B',
              kind: 'image',
              assetUrl: 'data:image/png;base64,BBB',
              createdAt: 3,
              envelopeId: 'env-1',
              envelopeLabel: 'Storyboard envelope',
            },
            {
              id: 'solo',
              label: 'Solo',
              kind: 'image',
              assetUrl: 'data:image/png;base64,CCC',
              createdAt: 4,
            },
          ],
        },
      ],
    });

    useSourceBinStore.getState().setEnvelopeCollapsed('env-1', true);

    expect(useSourceBinStore.getState().bins[0].items).toEqual([
      expect.objectContaining({ id: 'env-a', envelopeCollapsed: true }),
      expect.objectContaining({ id: 'env-b', envelopeCollapsed: true }),
      expect.objectContaining({ id: 'solo' }),
    ]);
    expect(useSourceBinStore.getState().bins[0].items[2]).not.toHaveProperty('envelopeCollapsed');

    const snapshot = await useSourceBinStore.getState().exportProjectSnapshot({ includeAssetData: true });
    await useSourceBinStore.getState().restoreProjectSnapshot(undefined);
    await useSourceBinStore.getState().restoreProjectSnapshot(snapshot);

    expect(useSourceBinStore.getState().bins[0].items.filter((item) => item.envelopeId === 'env-1')).toEqual([
      expect.objectContaining({ id: 'env-a', envelopeCollapsed: true }),
      expect.objectContaining({ id: 'env-b', envelopeCollapsed: true }),
    ]);
  });

  it('sanitizes null source-bin bins and items without flatMap assumptions', () => {
    const sanitized = sanitizePersistedSourceBinState({
      bins: [
        null,
        {
          id: 'bin-1',
          name: 'Recovered',
          items: null,
          collapsed: 'no',
          createdAt: Number.NaN,
        },
        {
          id: 'bin-2',
          name: 'Mixed',
          items: [
            null,
            { id: 'bad-kind', label: 'Bad', kind: 'other' },
            { id: 'text-1', label: 42, kind: 'text', text: 'hello', createdAt: Number.POSITIVE_INFINITY },
          ],
        },
      ],
      items: null,
      dismissedSourceKeys: ['source-a', 7],
    });

    expect(sanitized.dismissedSourceKeys).toEqual(['source-a']);
    expect(sanitized.bins).toHaveLength(2);
    expect(sanitized.bins?.[0]).toMatchObject({ id: 'bin-1', items: [] });
    expect(sanitized.bins?.[1].items).toEqual([
      expect.objectContaining({ id: 'text-1', label: 'Untitled Source', kind: 'text', text: 'hello' }),
    ]);
  });

  it('removes transient recovered scratch items from persisted snapshots', () => {
    const sanitized = sanitizePersistedSourceBinState({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          items: [
            {
              id: 'panel-1',
              label: 'Panel 1',
              kind: 'image',
              mimeType: 'image/png',
              scratchFileName: 'panel-1.png',
              createdAt: 1,
            },
            {
              id: 'recovered-inline',
              label: 'Recovered Inline',
              kind: 'image',
              mimeType: 'image/png',
              scratchFileName: 'orphan-inline.png',
              sourceKey: 'recovered-scratch:orphan-inline.png',
              createdAt: 2,
            },
          ],
          collapsed: false,
          createdAt: 1,
        },
        {
          id: 'recovered-scratch-assets',
          name: 'Recovered Scratch Assets',
          items: [
            {
              id: 'recovered-orphan',
              label: 'Recovered Orphan',
              kind: 'image',
              mimeType: 'image/png',
              scratchFileName: 'orphan.png',
              sourceKey: 'recovered-scratch:orphan.png',
              createdAt: 3,
            },
          ],
          collapsed: true,
          createdAt: 3,
        },
      ],
      dismissedSourceKeys: [],
    });

    expect(sanitized.bins?.map((bin) => bin.id)).toEqual(['default']);
    expect(sanitized.bins?.[0].items.map((item) => item.id)).toEqual(['panel-1']);
  });

  it('revokes object URLs when blob-backed source-bin items are removed', () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    useSourceBinStore.setState({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            {
              id: 'scratch-preview',
              label: 'Scratch preview',
              kind: 'image',
              mimeType: 'image/png',
              assetUrl: 'blob:scratch-preview',
              createdAt: 2,
            },
          ],
        },
      ],
      dismissedSourceKeys: [],
    });

    useSourceBinStore.getState().removeItem('scratch-preview');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:scratch-preview');
  });

  it('revokes stale blob URLs when restoring a different project snapshot', async () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    useSourceBinStore.setState({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            {
              id: 'old-preview',
              label: 'Old preview',
              kind: 'image',
              mimeType: 'image/png',
              assetUrl: 'blob:old-preview',
              createdAt: 2,
            },
            {
              id: 'durable-preview',
              label: 'Durable preview',
              kind: 'image',
              mimeType: 'image/png',
              assetUrl: 'signal-loom-asset://file/durable-preview',
              nativeFilePath: '/project/durable-preview.png',
              createdAt: 3,
            },
          ],
        },
      ],
      dismissedSourceKeys: [],
    });

    await useSourceBinStore.getState().restoreProjectSnapshot({
      dismissedSourceKeys: [],
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 4,
          items: [
            {
              id: 'new-preview',
              label: 'New preview',
              kind: 'image',
              mimeType: 'image/png',
              assetUrl: 'data:image/png;base64,AAAA',
              createdAt: 5,
            },
          ],
        },
      ],
    });

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:old-preview');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('signal-loom-asset://file/durable-preview');
  });

  it('repairs duplicate source-bin envelope item indexes without dropping generated images', () => {
    const sanitized = sanitizePersistedSourceBinState({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            {
              id: 'panel-a',
              label: 'Panel A',
              kind: 'image',
              mimeType: 'image/png',
              scratchFileName: 'panel-a.png',
              sourceKey: 'image:envelope-1:0:signal-loom-asset://file/panel-a',
              originNodeId: 'envelope-1:0',
              envelopeId: 'envelope-1',
              envelopeIndex: 0,
              createdAt: 1,
            },
            {
              id: 'panel-b',
              label: 'Panel B',
              kind: 'image',
              mimeType: 'image/png',
              scratchFileName: 'panel-b.png',
              sourceKey: 'image:envelope-1:0:signal-loom-asset://file/panel-b',
              originNodeId: 'envelope-1:0',
              envelopeId: 'envelope-1',
              envelopeIndex: 0,
              createdAt: 2,
            },
          ],
        },
      ],
      dismissedSourceKeys: [],
    });

    expect(sanitized.bins?.[0].items).toEqual([
      expect.objectContaining({
        id: 'panel-a',
        envelopeIndex: 0,
        originNodeId: 'envelope-1:0',
        sourceKey: 'image:envelope-1:0:signal-loom-asset://file/panel-a',
      }),
      expect.objectContaining({
        id: 'panel-b',
        envelopeIndex: 1,
        originNodeId: 'envelope-1:1',
        sourceKey: 'image:envelope-1:1:signal-loom-asset://file/panel-b',
      }),
    ]);
  });

  it('repairs collided originNodeId and sourceKey for generated envelope items instead of discarding them', () => {
    const sanitized = sanitizePersistedSourceBinState({
      bins: [
        {
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [
            {
              id: 'gen-1',
              label: 'Gen Result 1',
              kind: 'image',
              mimeType: 'image/png',
              assetUrl: 'signal-loom-asset://file/result-1.png',
              sourceKey: 'image:imageGen-1:1:signal-loom-asset://file/result-1.png',
              originNodeId: 'imageGen-1:1',
              envelopeId: 'envelope-f15',
              envelopeIndex: 0,
              isGenerated: true,
              createdAt: 1,
            },
            {
              id: 'gen-2',
              label: 'Gen Result 2',
              kind: 'image',
              mimeType: 'image/png',
              assetUrl: 'signal-loom-asset://file/result-2.png',
              sourceKey: 'image:imageGen-1:1:signal-loom-asset://file/result-2.png',
              originNodeId: 'imageGen-1:1',
              envelopeId: 'envelope-f15',
              envelopeIndex: 0,
              isGenerated: true,
              createdAt: 2,
            },
          ],
        },
      ],
      dismissedSourceKeys: [],
    });

    expect(sanitized.bins?.[0].items).toEqual([
      expect.objectContaining({
        id: 'gen-1',
        envelopeIndex: 0,
        originNodeId: 'imageGen-1:0',
        sourceKey: 'image:imageGen-1:0:signal-loom-asset://file/result-1.png',
      }),
      expect.objectContaining({
        id: 'gen-2',
        envelopeIndex: 1,
        originNodeId: 'imageGen-1:1',
        sourceKey: 'image:imageGen-1:1:signal-loom-asset://file/result-2.png',
      }),
    ]);
  });
});
