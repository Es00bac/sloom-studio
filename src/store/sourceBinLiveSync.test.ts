import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteImportedAsset: vi.fn(),
  loadImportedAsset: vi.fn(),
  loadImportedAssetAsDataUrl: vi.fn(),
  loadImportedAssetBlob: vi.fn(),
  loadScratchAssetBlob: vi.fn(),
  localizeAssetForProject: vi.fn(),
  postWorkspaceWindowCommand: vi.fn(),
  saveDataUrlAsset: vi.fn(),
  saveImportedAsset: vi.fn(),
  storeScratchAssetBlob: vi.fn(),
}));

vi.mock('../lib/assetStore', () => ({
  deleteImportedAsset: mocks.deleteImportedAsset,
  loadImportedAsset: mocks.loadImportedAsset,
  loadImportedAssetAsDataUrl: mocks.loadImportedAssetAsDataUrl,
  loadImportedAssetBlob: mocks.loadImportedAssetBlob,
  saveDataUrlAsset: mocks.saveDataUrlAsset,
  saveImportedAsset: mocks.saveImportedAsset,
}));

vi.mock('../lib/fileSystemWorkspace', () => ({
  loadScratchAssetBlob: mocks.loadScratchAssetBlob,
  storeScratchAssetBlob: mocks.storeScratchAssetBlob,
}));

vi.mock('../lib/sourceBinPersistence', () => ({
  localizeAssetForProject: mocks.localizeAssetForProject,
}));

vi.mock('../lib/workspaceWindowCommands', () => ({
  postWorkspaceWindowCommand: mocks.postWorkspaceWindowCommand,
}));

import { useSourceBinStore } from './sourceBinStore';
import { setCurrentProjectAuthorityClaim } from '../lib/nativeApp';

const TEST_AUTHORITY = { authorityId: 'source-test-authority', version: 3 };

describe('source bin live workspace sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.deleteImportedAsset.mockReset();
    mocks.loadImportedAsset.mockReset();
    mocks.loadImportedAssetAsDataUrl.mockReset();
    mocks.loadImportedAssetBlob.mockReset();
    mocks.loadScratchAssetBlob.mockReset();
    mocks.localizeAssetForProject.mockReset();
    mocks.postWorkspaceWindowCommand.mockReset();
    mocks.saveDataUrlAsset.mockReset();
    mocks.saveImportedAsset.mockReset();
    mocks.storeScratchAssetBlob.mockReset();
    mocks.localizeAssetForProject.mockImplementation(async (assetUrl: string, mimeType?: string) => ({
      dataUrl: assetUrl,
      mimeType: mimeType ?? 'application/octet-stream',
    }));
    mocks.saveDataUrlAsset.mockImplementation(async ({ dataUrl, mimeType, name }) => ({
      id: `stored-${name}`,
      dataUrl,
      mimeType,
    }));
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
      dismissedSourceKeys: [],
      sidebarOpen: true,
      scratchDirectoryHandle: undefined,
      nativeScratchDirectoryPath: undefined,
      nativeSyncStatus: { state: 'idle' },
    });
    setCurrentProjectAuthorityClaim(TEST_AUTHORITY);
  });

  it('reconciles a freshly-restored window with the authoritative native snapshot (recovers cross-window generated assets)', async () => {
    // Reproduce the post-restore state of a workspace window opened *after* another window
    // generated an asset: restoreProjectSnapshot replaced the Source Library with the saved
    // project bin, which is missing the unsaved generated asset.
    useSourceBinStore.setState({
      bins: [{
        id: 'default', name: 'Source Library', collapsed: false, createdAt: 1,
        items: [{ id: 'saved-1', label: 'Saved.png', kind: 'image', mimeType: 'image/png', assetUrl: 'signal-loom-asset://file/saved', createdAt: 1 }],
      }],
    });

    // The native main process holds the live snapshot: the saved asset + the generated one.
    const getSourceLibrarySnapshot = vi.fn().mockResolvedValue({
      version: 7,
      authority: TEST_AUTHORITY,
      snapshot: {
        bins: [{
          id: 'default', name: 'Source Library', collapsed: false, createdAt: 1,
          items: [
            { id: 'gen-1', label: 'Flux result.png', kind: 'image', mimeType: 'image/png', assetUrl: 'signal-loom-asset://file/gen', nativeFilePath: '/p/gen.png', scratchFileName: 'gen.png', isGenerated: true, envelopeId: 'env-1', createdAt: 2 },
            { id: 'saved-1', label: 'Saved.png', kind: 'image', mimeType: 'image/png', assetUrl: 'signal-loom-asset://file/saved', createdAt: 1 },
          ],
        }],
        dismissedSourceKeys: [],
      },
    });
    vi.stubGlobal('window', { signalLoomNative: { getSourceLibrarySnapshot } });

    await useSourceBinStore.getState().reconcileWithNativeSourceLibrarySnapshot();

    const ids = useSourceBinStore.getState().bins.flatMap((bin) => bin.items).map((item) => item.id);
    expect(getSourceLibrarySnapshot).toHaveBeenCalled();
    expect(ids).toContain('gen-1'); // cross-window generated asset recovered
    expect(ids).toContain('saved-1'); // saved asset retained
  });

  it('reconcile is a no-op without the native source-library bridge (web / mobile single-window)', async () => {
    vi.stubGlobal('window', {});
    await expect(useSourceBinStore.getState().reconcileWithNativeSourceLibrarySnapshot()).resolves.toBeUndefined();
    const ids = useSourceBinStore.getState().bins.flatMap((bin) => bin.items).map((item) => item.id);
    expect(ids).toEqual([]);
  });

  it('broadcasts directly added source-library assets to other workspace windows', async () => {
    await useSourceBinStore.getState().addAssetItem({
      id: 'direct-image-1',
      label: 'Paper reference.png',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,DIRECT',
    });

    expect(mocks.postWorkspaceWindowCommand).toHaveBeenCalledWith({
      type: 'source-bin-items-added',
      items: [
        // 811 F3: the broadcast carries the durable pointer, never the bytes — the receiving
        // window re-resolves through its own hydrateAssets (shared IndexedDB / scratch dir).
        expect.objectContaining({
          id: 'direct-image-1',
          label: 'Paper reference.png',
          kind: 'image',
          assetId: 'stored-Paper reference.png',
          assetUrl: undefined,
        }),
      ],
    });
  });

  it('repairs a failed native add ACK by syncing the current source-library snapshot', async () => {
    const applySourceLibraryChange = vi.fn().mockResolvedValue({ ok: false, error: 'stale native version' });
    const syncSourceLibrarySnapshot = vi.fn().mockResolvedValue({ ok: true, version: 9 });
    vi.stubGlobal('window', {
      signalLoomNative: {
        applySourceLibraryChange,
        syncSourceLibrarySnapshot,
      },
    });

    await useSourceBinStore.getState().addAssetItem({
      id: 'direct-image-1',
      label: 'Paper reference.png',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,DIRECT',
    });

    await vi.waitFor(() => {
      expect(syncSourceLibrarySnapshot).toHaveBeenCalledWith(expect.objectContaining({
        snapshot: expect.objectContaining({
          bins: [
            expect.objectContaining({
              items: [
                expect.objectContaining({ id: 'direct-image-1', label: 'Paper reference.png' }),
              ],
            }),
          ],
        }),
      }));
    });
    expect(useSourceBinStore.getState().nativeSyncStatus).toMatchObject({
      state: 'synced',
      lastAckVersion: 9,
    });
  });

  it('marks native source-library sync as degraded when change ACK and snapshot repair both fail', async () => {
    const applySourceLibraryChange = vi.fn().mockRejectedValue(new Error('IPC apply failed'));
    const syncSourceLibrarySnapshot = vi.fn().mockResolvedValue({ ok: false, error: 'snapshot rejected' });
    vi.stubGlobal('window', {
      signalLoomNative: {
        applySourceLibraryChange,
        syncSourceLibrarySnapshot,
      },
    });

    await useSourceBinStore.getState().addAssetItem({
      id: 'direct-image-1',
      label: 'Paper reference.png',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,DIRECT',
    });

    await vi.waitFor(() => {
      expect(useSourceBinStore.getState().nativeSyncStatus).toMatchObject({
        state: 'degraded',
        message: expect.stringContaining('snapshot rejected'),
      });
    });
  });

  it('does not publish or repair a Source delta without exact authority, and drops old completions after a switch', async () => {
    let resolveApply!: (value: { ok: false; error: string }) => void;
    const applySourceLibraryChange = vi.fn(() => new Promise<{ ok: false; error: string }>((resolve) => {
      resolveApply = resolve;
    }));
    const syncSourceLibrarySnapshot = vi.fn().mockResolvedValue({ ok: true, version: 99 });
    vi.stubGlobal('window', { signalLoomNative: { applySourceLibraryChange, syncSourceLibrarySnapshot } });

    await useSourceBinStore.getState().addAssetItem({
      id: 'old-project-item', label: 'Old.png', kind: 'image', mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,OLD',
    });
    expect(applySourceLibraryChange).toHaveBeenCalledWith(expect.objectContaining({ claim: TEST_AUTHORITY }));
    setCurrentProjectAuthorityClaim({ authorityId: 'project-b', version: 1 });
    resolveApply({ ok: false, error: 'old project rejected' });
    await Promise.resolve();
    await Promise.resolve();
    expect(syncSourceLibrarySnapshot).not.toHaveBeenCalled();

    applySourceLibraryChange.mockClear();
    setCurrentProjectAuthorityClaim(undefined);
    await useSourceBinStore.getState().addAssetItem({
      id: 'claimless-item', label: 'Claimless.png', kind: 'image', mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,NONE',
    });
    expect(applySourceLibraryChange).not.toHaveBeenCalled();
  });

  it('drops an asset hydration completion when the project authority changes mid-await', async () => {
    let resolveStoredAsset!: (value: { dataUrl: string; mimeType: string; name: string }) => void;
    mocks.loadImportedAsset.mockImplementation(() => new Promise((resolve) => {
      resolveStoredAsset = resolve;
    }));
    vi.stubGlobal('window', { signalLoomNative: {} });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'shared-id',
          label: 'Project A.png',
          kind: 'image',
          mimeType: 'image/png',
          assetId: 'asset-a',
          assetUrl: 'signal-loom-asset://asset/asset-a',
          createdAt: 1,
        }],
      }],
    });

    const hydration = useSourceBinStore.getState().hydrateAssets();
    await vi.waitFor(() => expect(mocks.loadImportedAsset).toHaveBeenCalledWith('asset-a'));
    setCurrentProjectAuthorityClaim({ authorityId: 'project-b', version: 1 });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 2,
        items: [{
          id: 'shared-id',
          label: 'Project B.png',
          kind: 'image',
          mimeType: 'image/png',
          assetId: 'asset-b',
          assetUrl: 'signal-loom-asset://asset/asset-b',
          createdAt: 2,
        }],
      }],
    });
    resolveStoredAsset({ dataUrl: 'data:image/png;base64,PROJECT_A', mimeType: 'image/png', name: 'Project A.png' });
    await hydration;

    expect(useSourceBinStore.getState().bins[0].items[0]).toMatchObject({
      label: 'Project B.png',
      assetId: 'asset-b',
      assetUrl: 'signal-loom-asset://asset/asset-b',
    });
  });

  it('retries version-gap repairs by pulling the native snapshot instead of pushing stale renderer state', async () => {
    const getSourceLibrarySnapshot = vi.fn().mockResolvedValue({
      version: 7,
      authority: TEST_AUTHORITY,
      snapshot: {
        bins: [{
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [{
            id: 'native-authoritative',
            label: 'Native authoritative panel.png',
            kind: 'image',
            mimeType: 'image/png',
            assetUrl: 'signal-loom-asset://asset/native-authoritative',
            createdAt: 4,
          }],
        }],
        dismissedSourceKeys: ['native-removed'],
      },
    });
    const syncSourceLibrarySnapshot = vi.fn();
    vi.stubGlobal('window', {
      signalLoomNative: {
        getSourceLibrarySnapshot,
        syncSourceLibrarySnapshot,
      },
    });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        items: [{
          id: 'stale-renderer',
          label: 'Stale renderer panel.png',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'data:image/png;base64,STALE',
          createdAt: 2,
        }],
        collapsed: false,
        createdAt: 1,
      }],
      dismissedSourceKeys: [],
      nativeSyncStatus: {
        state: 'degraded',
        expectedNativeVersion: 7,
        repairDirection: 'pull-native-snapshot',
      },
    });

    useSourceBinStore.getState().retryNativeSourceLibrarySync();

    await vi.waitFor(() => {
      expect(useSourceBinStore.getState().bins[0].items.map((item) => item.id)).toEqual(['native-authoritative']);
    });
    expect(syncSourceLibrarySnapshot).not.toHaveBeenCalled();
    expect(useSourceBinStore.getState().dismissedSourceKeys).toEqual(['native-removed']);
    expect(useSourceBinStore.getState().nativeSyncStatus).toMatchObject({
      state: 'synced',
      lastAckVersion: 7,
      repairDirection: 'pull-native-snapshot',
    });
  });

  it('keeps degraded state when a pulled native repair snapshot is older than the missed version', async () => {
    vi.stubGlobal('window', {
      signalLoomNative: {
        getSourceLibrarySnapshot: vi.fn().mockResolvedValue({
          version: 6,
          authority: TEST_AUTHORITY,
          snapshot: {
            bins: [{
              id: 'default',
              name: 'Source Library',
              collapsed: false,
              createdAt: 1,
              items: [{
                id: 'too-old',
                label: 'Too old panel.png',
                kind: 'image',
                mimeType: 'image/png',
                assetUrl: 'signal-loom-asset://asset/too-old',
                createdAt: 3,
              }],
            }],
            dismissedSourceKeys: [],
          },
        }),
        syncSourceLibrarySnapshot: vi.fn(),
      },
    });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        items: [{
          id: 'local-current',
          label: 'Current local panel.png',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'data:image/png;base64,CURRENT',
          createdAt: 2,
        }],
        collapsed: false,
        createdAt: 1,
      }],
      dismissedSourceKeys: [],
      nativeSyncStatus: {
        state: 'degraded',
        expectedNativeVersion: 7,
        repairDirection: 'pull-native-snapshot',
      },
    });

    useSourceBinStore.getState().retryNativeSourceLibrarySync();

    await vi.waitFor(() => {
      expect(useSourceBinStore.getState().nativeSyncStatus).toMatchObject({
        state: 'degraded',
        expectedNativeVersion: 7,
        repairDirection: 'pull-native-snapshot',
      });
    });
    expect(useSourceBinStore.getState().bins[0].items.map((item) => item.id)).toEqual(['local-current']);
  });

  it('keeps pull repair status degraded when native snapshot retry is unavailable', () => {
    vi.stubGlobal('window', {
      signalLoomNative: {
        syncSourceLibrarySnapshot: vi.fn(),
      },
    });
    useSourceBinStore.setState({
      nativeSyncStatus: {
        state: 'degraded',
        expectedNativeVersion: 7,
        repairDirection: 'pull-native-snapshot',
      },
    });

    useSourceBinStore.getState().retryNativeSourceLibrarySync();

    expect(useSourceBinStore.getState().nativeSyncStatus).toMatchObject({
      state: 'degraded',
      expectedNativeVersion: 7,
      message: 'Native Source Library snapshot retry is unavailable.',
      repairDirection: 'pull-native-snapshot',
    });
  });

  it('materializes generated assets through the native scratch bridge before broadcasting them', async () => {
    const materializeSourceAsset = vi.fn().mockResolvedValue({
      item: {
        id: 'direct-image-1',
        label: 'Paper print upscale.png',
        kind: 'image',
        mimeType: 'image/png',
        assetUrl: 'signal-loom-asset://file/upscaled',
        nativeFilePath: '/project/project.signal-loom-scratch/direct-image-1.png',
        scratchFileName: 'direct-image-1.png',
        pixelWidth: 1200,
        pixelHeight: 800,
        createdAt: 10,
      },
    });
    vi.stubGlobal('window', {
      signalLoomNative: {
        materializeSourceAsset,
      },
    });

    const item = await useSourceBinStore.getState().addAssetItem({
      id: 'direct-image-1',
      label: 'Paper print upscale.png',
      kind: 'image',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,DIRECT',
      pixelWidth: 1200,
      pixelHeight: 800,
    });

    expect(materializeSourceAsset).toHaveBeenCalledWith(expect.objectContaining({
      id: 'direct-image-1',
      dataUrl: 'data:image/png;base64,DIRECT',
      kind: 'image',
    }));
    expect(item).toMatchObject({
      assetUrl: 'signal-loom-asset://file/upscaled',
      scratchFileName: 'direct-image-1.png',
      nativeFilePath: '/project/project.signal-loom-scratch/direct-image-1.png',
    });
    expect(mocks.saveDataUrlAsset).not.toHaveBeenCalled();
    expect(mocks.postWorkspaceWindowCommand).toHaveBeenCalledWith({
      type: 'source-bin-items-added',
      items: [
        expect.objectContaining({
          id: 'direct-image-1',
          assetUrl: 'signal-loom-asset://file/upscaled',
          scratchFileName: 'direct-image-1.png',
        }),
      ],
    });
  });

  it('sends blob-backed generated video bytes through the native scratch bridge without re-fetching the renderer blob url', async () => {
    const materializeSourceAsset = vi.fn().mockResolvedValue({
      item: {
        id: 'direct-video-1',
        label: 'composition result.mp4',
        kind: 'video',
        mimeType: 'video/mp4',
        assetUrl: 'signal-loom-asset://asset/direct-video-1',
        nativeFilePath: '/project/project.signal-loom-scratch/direct-video-1-composition-result.mp4',
        scratchFileName: 'direct-video-1-composition-result.mp4',
        createdAt: 11,
      },
    });
    const fetchMock = vi.fn();
    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'video/mp4' });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      signalLoomNative: {
        materializeSourceAsset,
      },
    });

    await useSourceBinStore.getState().addAssetItem({
      id: 'direct-video-1',
      label: 'composition result.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      dataUrl: 'blob:file:///rendered-video-preview',
      blob,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(materializeSourceAsset).toHaveBeenCalledWith(expect.objectContaining({
      id: 'direct-video-1',
      kind: 'video',
      mimeType: 'video/mp4',
      dataUrl: 'blob:file:///rendered-video-preview',
      binaryData: expect.any(Uint8Array),
    }));
    const materializeRequest = materializeSourceAsset.mock.calls[0]?.[0];
    expect(materializeRequest.binaryData).toBeInstanceOf(Uint8Array);
    expect(Array.from(materializeRequest.binaryData)).toEqual([0, 1, 2, 3]);
    expect(mocks.saveImportedAsset).not.toHaveBeenCalled();
  });

  it('broadcasts Flow-generated connected media after source-library ingestion', async () => {
    await useSourceBinStore.getState().ingestConnectedItems([
      {
        id: 'source-image-1',
        nodeId: 'flow-image-node-1',
        label: 'Generated panel option',
        kind: 'image',
        assetUrl: 'data:image/png;base64,GENERATED',
        mimeType: 'image/png',
      },
    ]);

    expect(mocks.postWorkspaceWindowCommand).toHaveBeenCalledWith({
      type: 'source-bin-items-added',
      items: [
        // 811 F3: bytes stripped — the durable assetId travels; receivers re-resolve locally.
        expect.objectContaining({
          label: 'Generated panel option',
          kind: 'image',
          assetId: 'stored-Generated panel option.png',
          assetUrl: undefined,
          originNodeId: 'flow-image-node-1',
          sourceKey: 'image:flow-image-node-1:data:image/png;base64,GENERATED',
        }),
      ],
    });
  });

  it('broadcasts imported native source-library descriptors', async () => {
    await useSourceBinStore.getState().importNativeFiles([
      {
        id: 'native-image-1',
        label: 'native-panel.png',
        kind: 'image',
        mimeType: 'image/png',
        assetUrl: 'signal-loom-asset://file/native-panel',
        nativeFilePath: '/project/native-panel.png',
        createdAt: 2,
      },
    ]);

    expect(mocks.postWorkspaceWindowCommand).toHaveBeenCalledWith({
      type: 'source-bin-items-added',
      items: [
        expect.objectContaining({
          id: 'native-image-1',
          label: 'native-panel.png',
          assetUrl: 'signal-loom-asset://file/native-panel',
          nativeFilePath: '/project/native-panel.png',
        }),
      ],
    });
  });

  it('broadcasts source-library removals so other open workspaces drop stale assets', () => {
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        items: [{
          id: 'remove-me',
          label: 'Old generated image',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'data:image/png;base64,OLD',
          createdAt: 1,
          sourceKey: 'image:flow-image-node:data:image/png;base64,OLD',
        }],
        collapsed: false,
        createdAt: 1,
      }],
      dismissedSourceKeys: [],
    });

    useSourceBinStore.getState().removeItem('remove-me');

    expect(mocks.postWorkspaceWindowCommand).toHaveBeenCalledWith({
      type: 'source-bin-item-removed',
      itemId: 'remove-me',
      sourceKey: 'image:flow-image-node:data:image/png;base64,OLD',
    });
  });

  it('broadcasts same-id source-library asset updates so peer windows replace stale media', async () => {
    mocks.saveDataUrlAsset.mockResolvedValueOnce({
      id: 'updated-asset',
      dataUrl: 'data:image/png;base64,UPDATED',
      mimeType: 'image/png',
    });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        items: [{
          id: 'update-me',
          label: 'Old panel.png',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: 'data:image/png;base64,OLD',
          createdAt: 1,
        }],
        collapsed: false,
        createdAt: 1,
      }],
      dismissedSourceKeys: [],
      nativeSyncStatus: { state: 'idle' },
    });

    await useSourceBinStore.getState().updateAssetItemData('update-me', {
      label: 'New panel.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,UPDATED',
      pixelWidth: 1200,
      pixelHeight: 800,
    });

    expect(mocks.postWorkspaceWindowCommand).toHaveBeenCalledWith({
      type: 'source-bin-items-added',
      items: [
        expect.objectContaining({
          id: 'update-me',
          label: 'New panel.png',
          assetId: 'updated-asset',
          assetUrl: undefined,
          pixelWidth: 1200,
          pixelHeight: 800,
        }),
      ],
    });
  });
});
