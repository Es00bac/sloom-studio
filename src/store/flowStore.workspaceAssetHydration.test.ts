import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode } from '../types/flow';

const assetMocks = vi.hoisted(() => ({ loadImportedAsset: vi.fn() }));

vi.mock('../lib/assetStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/assetStore')>(),
  loadImportedAsset: assetMocks.loadImportedAsset,
}));

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function node(workspaceId: string): AppNode {
  return {
    id: 'shared-node-id',
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: {
      sourceAssetId: `asset-${workspaceId}`,
      sourceAssetName: `${workspaceId}.png`,
      sourceAssetMimeType: 'image/png',
      sourceAssetUrl: `data:image/png;base64,${workspaceId}`,
    },
  } as AppNode;
}

describe('Flow workspace asset hydration ownership (AUD-027)', () => {
  beforeEach(() => {
    vi.resetModules();
    assetMocks.loadImportedAsset.mockReset();
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      localStorage: makeMemoryStorage(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not apply delayed A asset bytes to a replacement B canvas that reuses the node id', async () => {
    const { useFlowWorkspaceStore } = await import('./flowWorkspaceStore');
    useFlowWorkspaceStore.getState().hydrateProjectSnapshot({
      activeWorkspaceId: 'A',
      workspaces: [
        { id: 'A', name: 'A', createdAt: 1, updatedAt: 1, flow: { version: 3, nodes: [node('A')], edges: [] } },
        { id: 'B', name: 'B', createdAt: 1, updatedAt: 1, flow: { version: 3, nodes: [node('B')], edges: [] } },
      ],
    });
    const { useFlowStore } = await import('./flowStore');
    const { useSourceBinStore } = await import('./sourceBinStore');
    useSourceBinStore.setState({ bins: [], dismissedSourceKeys: [] });
    useFlowStore.getState().replaceFlowSnapshot({ version: 3, nodes: [node('A')], edges: [] });

    let resolveA!: () => void;
    assetMocks.loadImportedAsset.mockImplementationOnce(() => new Promise((resolve) => {
      resolveA = () => resolve({
        id: 'asset-A',
        name: 'A-restored.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,RESTORED-A',
      });
    }));
    const restoreA = useFlowStore.getState().restoreImportedAssets();
    await vi.waitFor(() => expect(assetMocks.loadImportedAsset).toHaveBeenCalledWith('asset-A'));

    useFlowWorkspaceStore.getState().setActiveWorkspaceId('B');
    const next = useFlowWorkspaceStore.getState().consumePendingWorkspaceSwitch(
      useFlowStore.getState().exportProjectFlowSnapshot(),
    );
    expect(next).toBeDefined();
    useFlowStore.getState().replaceFlowSnapshot(next!);
    resolveA();
    await restoreA;

    expect(useFlowWorkspaceStore.getState().hydratedWorkspaceId).toBe('B');
    expect(useFlowStore.getState().nodes[0]?.data).toMatchObject({
      sourceAssetId: 'asset-B',
      sourceAssetName: 'B.png',
      sourceAssetUrl: 'data:image/png;base64,B',
    });
  });
});
