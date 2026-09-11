import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function makeNode(id: string): AppNode {
  return {
    id,
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: {},
  };
}

function makePortalNode(id: string, role: 'entry' | 'exit', pairId: string, x = 0): AppNode {
  return {
    id,
    type: 'portal',
    position: { x, y: 0 },
    data: {
      portalRole: role,
      portalPairId: pairId,
      portalLabel: 'Portal pair',
    },
  } as AppNode;
}

describe('flow store node bookmark actions', () => {
  let useFlowStore: Awaited<typeof import('./flowStore')>['useFlowStore'];
  let useSourceBinStore: Awaited<typeof import('./sourceBinStore')>['useSourceBinStore'];
  let sanitizePersistedFlowState: Awaited<typeof import('./flowStore')>['sanitizePersistedFlowState'];

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      localStorage: makeMemoryStorage(),
      removeEventListener: vi.fn(),
    });

    ({ useFlowStore, sanitizePersistedFlowState } = await import('./flowStore'));
    ({ useSourceBinStore } = await import('./sourceBinStore'));
    useFlowStore.setState({
      nodes: [makeNode('node-1')],
      edges: [],
      bookmarkSidebarOpen: false,
    });
    useSourceBinStore.setState({
      bins: [],
      dismissedSourceKeys: [],
      sidebarOpen: true,
      scratchDirectoryHandle: undefined,
      nativeScratchDirectoryPath: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renames a node bookmark and opens the bookmark sidebar', () => {
    useFlowStore.getState().renameNodeBookmark('node-1', '  Hero image  ');

    const state = useFlowStore.getState();
    expect(state.nodes[0].data.customTitle).toBe('Hero image');
    expect(state.bookmarkSidebarOpen).toBe(true);
  });

  it('clears a node bookmark when the submitted title is blank', () => {
    useFlowStore.setState({
      nodes: [{ ...makeNode('node-1'), data: { customTitle: 'Hero image' } }],
      bookmarkSidebarOpen: true,
    });

    useFlowStore.getState().clearNodeBookmark('node-1');

    const state = useFlowStore.getState();
    expect(state.nodes[0].data.customTitle).toBeUndefined();
    expect(state.bookmarkSidebarOpen).toBe(true);
  });

  it('ignores node data patches that do not change any values', () => {
    useFlowStore.setState({
      nodes: [{
        ...makeNode('node-1'),
        data: {
          aspectRatio: '1:1',
          nodeInstanceId: 'stable-instance',
          inputRevision: 'stable-revision',
        },
      }],
      edges: [],
      bookmarkSidebarOpen: false,
    });
    useFlowStore.getState().patchNodeData('node-1', { aspectRatio: '1:1' });
    const initialNodes = useFlowStore.getState().nodes;
    const notifications: AppNode[][] = [];
    const unsubscribe = useFlowStore.subscribe((state) => {
      notifications.push(state.nodes);
    });

    useFlowStore.getState().patchNodeData('node-1', { aspectRatio: '1:1' });

    unsubscribe();
    expect(useFlowStore.getState().nodes).toBe(initialNodes);
    expect(notifications).toHaveLength(0);
    expect(useFlowStore.getState().nodes[0]?.data).toMatchObject({
      nodeInstanceId: 'stable-instance',
      inputRevision: 'stable-revision',
    });
  });

  it('assigns new identities only to nodes created by paste', () => {
    useFlowStore.setState({
      nodes: [
        {
          ...makeNode('existing'),
          selected: true,
          data: { nodeInstanceId: 'existing-instance', inputRevision: 'existing-revision' },
        },
        {
          ...makeNode('untouched'),
          data: { nodeInstanceId: 'untouched-instance', inputRevision: 'untouched-revision' },
        },
      ],
      edges: [],
    });

    expect(useFlowStore.getState().copySelection()).toBe(true);
    expect(useFlowStore.getState().pasteClipboard({ x: 400, y: 200 })).toBe(true);

    const nodes = useFlowStore.getState().nodes;
    expect(nodes.find((node) => node.id === 'existing')?.data).toMatchObject({
      nodeInstanceId: 'existing-instance',
      inputRevision: 'existing-revision',
    });
    expect(nodes.find((node) => node.id === 'untouched')?.data).toMatchObject({
      nodeInstanceId: 'untouched-instance',
      inputRevision: 'untouched-revision',
    });
    const pasted = nodes.find((node) => node.id !== 'existing' && node.id !== 'untouched');
    expect(pasted?.data.nodeInstanceId).toBeTruthy();
    expect(pasted?.data.nodeInstanceId).not.toBe('existing-instance');
    expect(pasted?.data.inputRevision).not.toBe('existing-revision');
  });

  it('hydrates malformed persisted flow arrays to safe defaults', () => {
    useFlowStore.setState(sanitizePersistedFlowState({
      nodes: null,
      edges: { bad: true },
      bookmarkSidebarOpen: 'yes',
    }));

    useFlowStore.getState().hydratePersistedState();

    expect(useFlowStore.getState().nodes).toEqual([]);
    expect(useFlowStore.getState().edges).toEqual([]);
    expect(useFlowStore.getState().bookmarkSidebarOpen).toBe(true);
  });

  it('adds portal nodes as an entrance and exit pair', () => {
    const entryId = useFlowStore.getState().addNode('portal', { x: 100, y: 200 });
    const state = useFlowStore.getState();
    const portals = state.nodes.filter((node) => node.type === 'portal');
    const entry = state.nodes.find((node) => node.id === entryId);
    const exit = portals.find((node) => node.id !== entryId);

    expect(portals).toHaveLength(2);
    expect(entry?.data.portalRole).toBe('entry');
    expect(exit?.data.portalRole).toBe('exit');
    expect(exit?.data.portalPairId).toBe(entry?.data.portalPairId);
    expect(exit?.position.x).toBeGreaterThan(entry!.position.x);
  });

  it('removes the paired portal exit connector when deleting the entry lead', () => {
    const pairId = 'pair-1';
    const edges: Edge[] = [
      { id: 'portal-in', source: 'node-1', target: 'portal-entry', targetHandle: 'portal-entry' },
      { id: 'portal-out', source: 'portal-exit', sourceHandle: 'portal-exit', target: 'target-1' },
    ];

    useFlowStore.setState({
      nodes: [
        makeNode('node-1'),
        makePortalNode('portal-entry', 'entry', pairId),
        makePortalNode('portal-exit', 'exit', pairId, 320),
        makeNode('target-1'),
      ],
      edges,
      bookmarkSidebarOpen: false,
    });

    useFlowStore.getState().onEdgesChange([{ id: 'portal-in', type: 'remove' }]);

    expect(useFlowStore.getState().edges.map((edge) => edge.id)).not.toContain('portal-out');
  });

  it('restores dropped Source Bin media nodes from the reopened source-bin item', async () => {
    useSourceBinStore.setState({
      bins: [
        {
          id: 'bin-1',
          name: 'Source Library',
          items: [
            {
              id: 'source-image-1',
              label: 'Restored still.png',
              kind: 'image',
              assetId: 'asset-restored',
              assetUrl: 'data:image/png;base64,RESTORED',
              mimeType: 'image/png',
              createdAt: 1,
            },
          ],
          collapsed: false,
          createdAt: 1,
        },
      ],
    });
    useFlowStore.setState({
      nodes: [
        {
          ...makeNode('image-1'),
          data: {
            mediaMode: 'import',
            sourceBinItemId: 'source-image-1',
            sourceAssetUrl: 'blob:dead-from-previous-session',
            sourceAssetName: 'Dropped still.png',
          },
        },
      ],
      edges: [],
      bookmarkSidebarOpen: false,
    });

    await useFlowStore.getState().restoreImportedAssets();

    expect(useFlowStore.getState().nodes[0].data).toEqual(expect.objectContaining({
      mediaMode: 'import',
      sourceBinItemId: 'source-image-1',
      sourceAssetId: 'asset-restored',
      sourceAssetUrl: 'data:image/png;base64,RESTORED',
      sourceAssetName: 'Restored still.png',
      sourceAssetMimeType: 'image/png',
    }));
  });

  it('relinks older dropped Source Bin media nodes that predate durable source-bin ids', async () => {
    useSourceBinStore.setState({
      bins: [
        {
          id: 'bin-1',
          name: 'Source Library',
          items: [
            {
              id: 'source-image-1',
              label: 'Dropped still.png',
              kind: 'image',
              assetUrl: 'data:image/png;base64,RESTORED',
              mimeType: 'image/png',
              createdAt: 1,
            },
          ],
          collapsed: false,
          createdAt: 1,
        },
      ],
    });
    useFlowStore.setState({
      nodes: [
        {
          ...makeNode('image-1'),
          data: {
            mediaMode: 'import',
            sourceAssetUrl: 'blob:dead-from-previous-session',
            sourceAssetName: 'Dropped still.png',
            sourceAssetMimeType: 'image/png',
          },
        },
      ],
      edges: [],
      bookmarkSidebarOpen: false,
    });

    await useFlowStore.getState().restoreImportedAssets();

    expect(useFlowStore.getState().nodes[0].data).toEqual(expect.objectContaining({
      mediaMode: 'import',
      sourceBinItemId: 'source-image-1',
      sourceAssetUrl: 'data:image/png;base64,RESTORED',
      sourceAssetName: 'Dropped still.png',
      sourceAssetMimeType: 'image/png',
    }));
  });

  it('rebuilds generated node result history from reopened Source Library media', async () => {
    useSourceBinStore.setState({
      bins: [
        {
          id: 'bin-1',
          name: 'Generated',
          items: [
            {
              id: 'source-run-1',
              label: 'Run 1.png',
              kind: 'image',
              assetUrl: 'data:image/png;base64,ONE',
              mimeType: 'image/png',
              createdAt: 10,
              originNodeId: 'image-1',
            },
            {
              id: 'source-run-2',
              label: 'Run 2.png',
              kind: 'image',
              assetUrl: 'data:image/png;base64,TWO',
              mimeType: 'image/png',
              createdAt: 20,
              originNodeId: 'image-1',
            },
          ],
          collapsed: false,
          createdAt: 1,
        },
      ],
    });
    useFlowStore.setState({
      nodes: [
        {
          ...makeNode('image-1'),
          data: {
            result: 'blob:dead-from-previous-session',
            resultType: 'image',
            selectedResultId: 'stale-blob',
            resultHistory: [
              {
                id: 'stale-blob',
                result: 'blob:dead-from-previous-session',
                resultType: 'image',
                statusMessage: 'Previous session output',
                createdAt: '2026-05-20T00:00:00.000Z',
              },
            ],
          },
        },
      ],
      edges: [],
      bookmarkSidebarOpen: false,
    });

    await useFlowStore.getState().restoreImportedAssets();

    expect(useFlowStore.getState().nodes[0].data.resultHistory).toEqual([
      expect.objectContaining({ id: 'source-source-run-1', result: 'data:image/png;base64,ONE', resultType: 'image' }),
      expect.objectContaining({ id: 'source-source-run-2', result: 'data:image/png;base64,TWO', resultType: 'image' }),
    ]);
    expect(useFlowStore.getState().nodes[0].data).toEqual(expect.objectContaining({
      selectedResultId: 'source-source-run-2',
      result: 'data:image/png;base64,TWO',
      resultType: 'image',
    }));
  });

  it('restores generated batch envelope media from reopened Source Library children', async () => {
    useSourceBinStore.setState({
      bins: [
        {
          id: 'bin-1',
          name: 'Generated',
          items: [
            {
              id: 'batch-a',
              label: 'Batch A',
              kind: 'image',
              assetUrl: 'data:image/png;base64,A',
              mimeType: 'image/png',
              createdAt: 10,
              originNodeId: 'batch-1:0',
              envelopeId: 'batch-1',
              envelopeLabel: 'Batch images',
              envelopeIndex: 0,
            },
            {
              id: 'batch-b',
              label: 'Batch B',
              kind: 'image',
              assetUrl: 'data:image/png;base64,B',
              mimeType: 'image/png',
              createdAt: 20,
              originNodeId: 'batch-1:1',
              envelopeId: 'batch-1',
              envelopeLabel: 'Batch images',
              envelopeIndex: 1,
            },
          ],
          collapsed: false,
          createdAt: 1,
        },
      ],
    });
    useFlowStore.setState({
      nodes: [
        {
          ...makeNode('batch-1'),
          data: {
            resultHistory: [],
            envelopeItems: [],
          },
        },
      ],
      edges: [],
      bookmarkSidebarOpen: false,
    });

    await useFlowStore.getState().restoreImportedAssets();

    expect(useFlowStore.getState().nodes[0].data.resultHistory).toEqual([
      expect.objectContaining({ id: 'source-batch-a', result: 'data:image/png;base64,A', resultType: 'image' }),
      expect.objectContaining({ id: 'source-batch-b', result: 'data:image/png;base64,B', resultType: 'image' }),
    ]);
    expect(useFlowStore.getState().nodes[0].data.envelopeItems).toEqual([
      expect.objectContaining({ id: 'batch-a', index: 0, kind: 'image', label: 'Batch A', value: 'data:image/png;base64,A', sourceNodeId: 'batch-1:0' }),
      expect.objectContaining({ id: 'batch-b', index: 1, kind: 'image', label: 'Batch B', value: 'data:image/png;base64,B', sourceNodeId: 'batch-1:1' }),
    ]);
    expect(useFlowStore.getState().nodes[0].data).toEqual(expect.objectContaining({
      selectedResultId: 'source-batch-b',
      result: 'data:image/png;base64,B',
      resultType: 'image',
    }));
  });
});
