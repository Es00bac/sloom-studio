import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteImportedAsset: vi.fn(),
  loadImportedAsset: vi.fn(),
  loadImportedAssetAsDataUrl: vi.fn(),
  loadImportedAssetBlob: vi.fn(),
  loadScratchAssetBlob: vi.fn(),
  localizeAssetForProject: vi.fn(),
  materializeAndroidSourceAsset: vi.fn(),
  isAndroidSourceAssetPermissionError: vi.fn(),
  saveDataUrlAsset: vi.fn(),
  saveImportedAsset: vi.fn(),
  showAlertDialog: vi.fn(),
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

vi.mock('../lib/androidSourceAssetStorage', () => ({
  materializeAndroidSourceAsset: mocks.materializeAndroidSourceAsset,
  isAndroidSourceAssetPermissionError: mocks.isAndroidSourceAssetPermissionError,
}));

vi.mock('./alertDialogStore', () => ({
  showAlertDialog: mocks.showAlertDialog,
}));

import { useSourceBinStore } from './sourceBinStore';
import type { SourceBinLibraryItem } from './sourceBinStore';

function libraryItem(overrides: Partial<SourceBinLibraryItem> & { id: string }): SourceBinLibraryItem {
  return {
    label: overrides.id,
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: `signal-loom-asset://asset/${overrides.id}`,
    createdAt: 1,
    isGenerated: true,
    ...overrides,
  };
}

describe('ingestConnectedItems stale-envelope cleanup scope', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.localizeAssetForProject.mockImplementation(async (assetUrl: string, mimeType?: string) => ({
      dataUrl: assetUrl,
      mimeType: mimeType ?? 'application/octet-stream',
    }));
    mocks.materializeAndroidSourceAsset.mockResolvedValue(undefined);
    mocks.isAndroidSourceAssetPermissionError.mockReturnValue(false);
    mocks.showAlertDialog.mockResolvedValue(undefined);
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        items: [
          // Ingested by an envelope that lives in ANOTHER flow-workspace tab — its envelope
          // node is neither connected here nor part of this graph.
          libraryItem({ id: 'other-tab-item', envelopeId: 'envelope-other-tab', sourceKey: 'image:envelope-other-tab:0:sig-a' }),
          // Ingested by an envelope in THIS graph that has since been disconnected.
          libraryItem({ id: 'local-stale-item', envelopeId: 'envelope-local-stale', sourceKey: 'image:envelope-local-stale:0:sig-b' }),
          // Plain import, never envelope-ingested.
          libraryItem({ id: 'plain-item', envelopeId: undefined }),
        ],
        collapsed: false,
        createdAt: 1,
      }],
      dismissedSourceKeys: [],
      sidebarOpen: true,
      scratchDirectoryHandle: undefined,
      nativeScratchDirectoryPath: undefined,
    });
  });

  const connectedCoverItems = [{
    id: 'connected-cover-0',
    nodeId: 'sourceBin-node-1',
    label: 'cover · cover',
    kind: 'image' as const,
    assetUrl: 'data:image/png;base64,AAAA',
    mimeType: 'image/png',
    envelopeId: 'envelope-cover',
    envelopeLabel: 'COVER (1)',
    envelopeIndex: 0,
  }];

  it('keeps items ingested from envelopes that belong to other flow workspaces', async () => {
    await useSourceBinStore.getState().ingestConnectedItems(connectedCoverItems, 'default', {
      graphNodeIds: new Set(['envelope-cover', 'envelope-local-stale', 'sourceBin-node-1']),
    });

    const ids = useSourceBinStore.getState().bins.flatMap((bin) => bin.items).map((item) => item.id);
    expect(ids).toContain('other-tab-item');
    expect(ids).toContain('plain-item');
  });

  it('still prunes items whose envelope exists in this graph but is disconnected', async () => {
    await useSourceBinStore.getState().ingestConnectedItems(connectedCoverItems, 'default', {
      graphNodeIds: new Set(['envelope-cover', 'envelope-local-stale', 'sourceBin-node-1']),
    });

    const ids = useSourceBinStore.getState().bins.flatMap((bin) => bin.items).map((item) => item.id);
    expect(ids).not.toContain('local-stale-item');
  });

  it('does not duplicate items whose stored sourceKey lacks the media-signature suffix', async () => {
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        items: [
          // Written by older builds/tooling: sourceKey has no media-signature part and the
          // item id doubles as the asset id.
          libraryItem({
            id: 'legacy-item',
            sourceKey: 'image:gen-node:0',
            assetUrl: 'signal-loom-asset://asset/legacy-item',
            envelopeId: 'envelope-page1',
          }),
        ],
        collapsed: false,
        createdAt: 1,
      }],
      dismissedSourceKeys: [],
    });

    await useSourceBinStore.getState().ingestConnectedItems([{
      id: 'connected-0',
      nodeId: 'gen-node:0',
      label: 'p01-panel-01',
      kind: 'image',
      assetUrl: 'signal-loom-asset://asset/legacy-item',
      mimeType: 'image/png',
      envelopeId: 'envelope-page1',
      envelopeLabel: 'PAGE 1',
      envelopeIndex: 0,
    }], 'default', { graphNodeIds: new Set(['envelope-page1', 'gen-node']) });

    const items = useSourceBinStore.getState().bins.flatMap((bin) => bin.items);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('legacy-item');
    // Self-heal: the stored key is upgraded to the full format so every later
    // exact-match path (dedupe, cleanup, live sync) agrees.
    expect(items[0].sourceKey).toBe('image:gen-node:0:signal-loom-asset://asset/legacy-item');
  });

  it('still replaces a legacy-keyed item when its envelope re-runs with a new asset', async () => {
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        items: [
          libraryItem({
            id: 'legacy-item',
            sourceKey: 'image:gen-node:0',
            assetUrl: 'signal-loom-asset://asset/legacy-item',
            envelopeId: 'envelope-page1',
          }),
        ],
        collapsed: false,
        createdAt: 1,
      }],
      dismissedSourceKeys: [],
    });

    await useSourceBinStore.getState().ingestConnectedItems([{
      id: 'connected-0',
      nodeId: 'gen-node:0',
      label: 'p01-panel-01',
      kind: 'image',
      assetUrl: 'signal-loom-asset://asset/regenerated-asset',
      mimeType: 'image/png',
      envelopeId: 'envelope-page1',
      envelopeLabel: 'PAGE 1',
      envelopeIndex: 0,
    }], 'default', { graphNodeIds: new Set(['envelope-page1', 'gen-node']) });

    const items = useSourceBinStore.getState().bins.flatMap((bin) => bin.items);
    expect(items).toHaveLength(1);
    expect(items[0].assetUrl).toBe('signal-loom-asset://asset/regenerated-asset');
  });

  it('removes nothing when the caller provides no graph context', async () => {
    await useSourceBinStore.getState().ingestConnectedItems(connectedCoverItems, 'default');

    const ids = useSourceBinStore.getState().bins.flatMap((bin) => bin.items).map((item) => item.id);
    expect(ids).toContain('other-tab-item');
    expect(ids).toContain('local-stale-item');
    expect(ids).toContain('plain-item');
  });
});
