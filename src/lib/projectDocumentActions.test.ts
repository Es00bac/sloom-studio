import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '../store/flowStore';
import { useEditorStore } from '../store/editorStore';
import { useProjectUsageStore } from '../store/projectUsageStore';
import { useSourceBinStore } from '../store/sourceBinStore';
import { useFlowWorkspaceStore } from '../store/flowWorkspaceStore';
import {
  buildCurrentProjectDocument,
  captureProjectReplacementAuthorization,
  prepareProjectDocumentTransaction,
  replaceProjectDocument,
  resetProjectDocument,
  restoreProjectDocument,
} from './projectDocumentActions';
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectSchema';
import { useImageEditorStore } from '../store/imageEditorStore';
import type { ImageDocument, LayerBitmap } from '../types/imageEditor';
import { usePaperStore } from '../store/paperStore';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { paperAssetRepository } from '../features/paper/assets/PaperAssetRuntime';
import { defaultImageLayerPixelCodec } from '../components/ImageEditor/ImageLayerProjectPixels';
import { createMask } from '../components/ImageEditor/SelectionMask';
import { getSelection, setSelection } from '../components/ImageEditor/selectionRegistry';

const originalRestoreSourceBinSnapshot = useSourceBinStore.getState().restoreProjectSnapshot;
const originalPrepareSourceBinSnapshot = useSourceBinStore.getState().prepareProjectSnapshot;
const originalCommitSourceBinSnapshot = useSourceBinStore.getState().commitPreparedProjectSnapshot;
const originalReplaceFlowSnapshot = useFlowStore.getState().replaceFlowSnapshot;
const originalRestoreImportedAssets = useFlowStore.getState().restoreImportedAssets;
const originalPrepareImageSnapshot = useImageEditorStore.getState().prepareProjectSnapshotWithPixels;

function sourceSnapshot(items: Array<{
  id: string;
  assetUrl: string;
  nativeFilePath?: string;
}>) {
  return {
    bins: [{
      id: 'default',
      name: 'Source Library',
      collapsed: false,
      createdAt: 1,
      items: items.map((item) => ({
        ...item,
        label: item.id,
        kind: 'image' as const,
        mimeType: 'image/png',
        createdAt: 1,
      })),
    }],
    dismissedSourceKeys: [],
  };
}

function projectWithSource(id: string, sourceBin: ReturnType<typeof sourceSnapshot>) {
  return {
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id,
    name: id,
    savedAt: 1,
    flow: { version: 3 as const, nodes: [], edges: [] },
    sourceBin,
  };
}

function installLiveSource(items: Parameters<typeof sourceSnapshot>[0]): void {
  useSourceBinStore.getState().commitPreparedProjectSnapshot(sourceSnapshot(items), { publishNative: false });
}

function countRevocations(revokeObjectUrl: ReturnType<typeof vi.fn>, url: string): number {
  return revokeObjectUrl.mock.calls.filter(([revokedUrl]) => revokedUrl === url).length;
}

beforeEach(() => {
  // The persistence-fingerprint dirty model treats a `kind: 'new'` tab as unsaved, so every
  // test starts from an explicit clean project baseline instead of the pristine default tab.
  const document = createDefaultPaperDocument({ title: 'Clean project baseline' });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
});

afterEach(() => {
  useSourceBinStore.setState({
    restoreProjectSnapshot: originalRestoreSourceBinSnapshot,
    prepareProjectSnapshot: originalPrepareSourceBinSnapshot,
    commitPreparedProjectSnapshot: originalCommitSourceBinSnapshot,
  });
  useFlowStore.setState({
    replaceFlowSnapshot: originalReplaceFlowSnapshot,
    restoreImportedAssets: originalRestoreImportedAssets,
  });
  useFlowStore.getState().replaceFlowSnapshot({ nodes: [], edges: [] });
  useFlowWorkspaceStore.getState().reset();
  useProjectUsageStore.getState().restoreSnapshot(undefined);
  useImageEditorStore.getState().restoreProjectSnapshot(undefined);
  useImageEditorStore.setState({ prepareProjectSnapshotWithPixels: originalPrepareImageSnapshot });
  usePaperStore.getState().restoreSnapshot(undefined);
  vi.restoreAllMocks();
});

describe('restoreProjectDocument', () => {
  it('fails closed before project replacement when a dirty Image document is open', async () => {
    const liveDocument: ImageDocument = {
      id: 'dirty-live-image',
      title: 'Unsaved layers',
      width: 10,
      height: 10,
      layers: [],
      activeLayerId: null,
      hasSelection: true,
      selectionVersion: 3,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: true,
    };
    useImageEditorStore.setState({
      documents: [liveDocument],
      activeDocId: liveDocument.id,
      undoStacks: {
        [liveDocument.id]: [{ kind: 'selection', docId: liveDocument.id, before: null, after: null }],
      },
    });

    await expect(restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'incoming-project',
      name: 'Incoming',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
    })).rejects.toThrow('dirty Image document');

    expect(useImageEditorStore.getState().documents).toEqual([liveDocument]);
    expect(useImageEditorStore.getState().activeDocId).toBe(liveDocument.id);
    expect(useImageEditorStore.getState().undoStacks[liveDocument.id]).toHaveLength(1);
  });

  it('requires explicit discard authorization before resetting a dirty Image project', async () => {
    const liveDocument = {
      id: 'dirty-reset-image',
      title: 'Unsaved reset layers',
      width: 10,
      height: 10,
      layers: [],
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: true,
    } satisfies ImageDocument;
    useImageEditorStore.setState({ documents: [liveDocument], activeDocId: liveDocument.id });

    await expect(resetProjectDocument()).rejects.toThrow('dirty Image document');
    expect(useImageEditorStore.getState().documents).toEqual([liveDocument]);

    await resetProjectDocument({
      imageAuthorization: captureProjectReplacementAuthorization().image,
    });
    expect(useImageEditorStore.getState().documents).toEqual([]);
  });

  it('fails closed before project replacement when an unsaved Paper document is active', async () => {
    const paperStore = usePaperStore.getState();
    paperStore.addPage();
    expect(usePaperStore.getState().undoStack).not.toHaveLength(0);
    const before = usePaperStore.getState().document;

    await expect(restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'incoming-paper-project',
      name: 'Incoming Paper',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
    })).rejects.toThrow('Paper document');

    expect(usePaperStore.getState().document).toEqual(before);
    await restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'incoming-paper-project',
      name: 'Incoming Paper',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
    }, { paperAuthorization: captureProjectReplacementAuthorization().paper });
  });

  it('blocks replacement for a dirty inactive Paper tab, not merely the active undo stack', async () => {
    const paperStore = usePaperStore.getState();
    paperStore.createNewDocument({ title: 'Edited inactive tab' });
    const editedDocumentId = usePaperStore.getState().activeDocumentId;
    paperStore.createNewDocument({ title: 'Clean active tab' });
    // Treat the two-tab project as a saved baseline, then edit the first tab and leave the
    // second active. The historical active undo stack is intentionally empty after switching.
    paperStore.restoreSnapshot(paperStore.exportSnapshot());
    paperStore.setActiveDocument(editedDocumentId);
    paperStore.addPage();
    paperStore.setActiveDocument(usePaperStore.getState().documents.find((document) => document.id !== editedDocumentId)!.id);
    expect(usePaperStore.getState().activeDocumentId).not.toBe(editedDocumentId);
    expect(usePaperStore.getState().undoStack).toHaveLength(0);

    await expect(restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'incoming-inactive-paper-project',
      name: 'Incoming Paper',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
    })).rejects.toThrow('Edited inactive tab');
  });

  it('captures dirty Paper recovery before a user-initiated project replacement', async () => {
    const current = createDefaultPaperDocument({ title: 'Dirty outgoing Paper' });
    usePaperStore.getState().restoreSnapshot({ document: current, tool: 'select', zoom: 0.8 });
    usePaperStore.setState({ discardedDocumentRecoveries: [] });
    usePaperStore.getState().addPage();
    const incoming = createDefaultPaperDocument({ title: 'Incoming saved Paper' });

    const replaced = await replaceProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'incoming-project',
      name: 'Incoming Project',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
      sourceBin: { dismissedSourceKeys: [] },
      paper: { document: incoming, tool: 'select', zoom: 0.8 },
    }, {
      save: async () => ({ status: 'failed', error: 'not selected in automation' }),
    });

    expect(replaced).toBe(true);
    expect(usePaperStore.getState().document.title).toBe('Incoming saved Paper');
    expect(usePaperStore.getState().isDocumentDirty()).toBe(false);
    expect(usePaperStore.getState().discardedDocumentRecoveries.at(-1)).toMatchObject({
      reason: 'project-replacement',
      snapshot: { document: { title: 'Dirty outgoing Paper' } },
    });
  });

  it('serializes Image documents as a clean saved baseline without clearing live dirty state', async () => {
    const liveDocument = {
      id: 'dirty-project-save-image',
      title: 'Saved in project',
      width: 10,
      height: 10,
      layers: [],
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: true,
    } satisfies ImageDocument;
    useImageEditorStore.setState({ documents: [liveDocument], activeDocId: liveDocument.id });

    const saved = await buildCurrentProjectDocument({ id: 'saved-project', name: 'Saved Project' });

    expect(saved.imageEditor?.documents[0]?.dirty).toBe(false);
    expect(useImageEditorStore.getState().documents[0]?.dirty).toBe(true);
  });

  it('saves the current flow as the default main Flow workspace snapshot', async () => {
    useFlowStore.getState().replaceFlowSnapshot({
      nodes: [{ id: 'main-node', type: 'textNode', position: { x: 5, y: 6 }, data: { prompt: 'hello' } }],
      edges: [],
    });

    const saved = await buildCurrentProjectDocument({ id: 'project-1', name: 'Workspace Save' });

    expect(saved.flow.nodes.map((node) => node.id)).toEqual(['main-node']);
    expect(saved).toMatchObject({
      activeFlowWorkspaceId: 'main',
      flowWorkspaces: [
        expect.objectContaining({
          id: 'main',
          name: 'Main Flow',
          flow: {
            version: 3,
            nodes: [expect.objectContaining({ id: 'main-node' })],
            edges: [],
          },
        }),
      ],
    });
  });

  it('saves inactive Flow workspaces from the registry while using the active runtime snapshot for the selected workspace', async () => {
    useFlowWorkspaceStore.getState().hydrateProjectSnapshot({
      activeWorkspaceId: 'alt',
      workspaces: [
        {
          id: 'main',
          name: 'Main Flow',
          createdAt: 1,
          updatedAt: 2,
          flow: {
            version: 3,
            nodes: [{ id: 'main-node', type: 'textNode', position: { x: 1, y: 2 }, data: {} }],
            edges: [],
          },
        },
        {
          id: 'alt',
          name: 'Alt Flow',
          createdAt: 3,
          updatedAt: 4,
          flow: {
            version: 3,
            nodes: [{ id: 'stale-alt-node', type: 'textNode', position: { x: 3, y: 4 }, data: {} }],
            edges: [],
          },
        },
      ],
    });
    useFlowStore.getState().replaceFlowSnapshot({
      nodes: [{ id: 'runtime-alt-node', type: 'textNode', position: { x: 7, y: 8 }, data: { prompt: 'runtime' } }],
      edges: [],
    });

    const saved = await buildCurrentProjectDocument({ id: 'project-2', name: 'Registry Save' });

    expect(saved.activeFlowWorkspaceId).toBe('alt');
    expect(saved.flowWorkspaces?.map((workspace) => workspace.id)).toEqual(['main', 'alt']);
    expect(saved.flowWorkspaces?.find((workspace) => workspace.id === 'main')?.flow.nodes.map((node) => node.id)).toEqual(['main-node']);
    expect(saved.flowWorkspaces?.find((workspace) => workspace.id === 'alt')?.flow.nodes.map((node) => node.id)).toEqual(['runtime-alt-node']);
  });

  it('prepares source-bin media before synchronously committing the Flow snapshot', async () => {
    const calls: string[] = [];
    useSourceBinStore.setState({
      prepareProjectSnapshot: async () => {
        calls.push('sourceBin');
        return { bins: [], dismissedSourceKeys: [] };
      },
    });
    useFlowStore.setState({
      replaceFlowSnapshot: (snapshot) => {
        calls.push('flow');
        originalReplaceFlowSnapshot(snapshot);
      },
    });

    await restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'p1',
      name: 'Restore Order',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [{ id: 'incoming', type: 'imageGen', position: { x: 1, y: 2 }, data: {} }],
        edges: [],
      },
      sourceBin: { dismissedSourceKeys: [] },
    });

    expect(calls).toEqual(['sourceBin', 'flow']);
  });

  it('migrates legacy inline Paper assets before restoring the Paper workspace', async () => {
    const base = createDefaultPaperDocument({ title: 'Legacy restore' });
    const legacyDocument = addFrameToPaperPage(base, base.pages[0].id, {
      id: 'legacy-panel',
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 30,
      asset: {
        label: 'Legacy panel',
        kind: 'image',
        src: 'data:image/png;base64,AQID',
      },
    } as never).document;

    await restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'paper-legacy-project',
      name: 'Legacy Paper Restore',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
      sourceBin: { dismissedSourceKeys: [] },
      paper: {
        document: legacyDocument,
        selectedPageId: legacyDocument.pages[0].id,
        tool: 'select',
        zoom: 0.8,
      },
    });

    const asset = usePaperStore.getState().document.pages[0].frames.find((frame) => frame.id === 'legacy-panel')?.asset;
    expect(asset?.locator).toMatchObject({ kind: 'managed' });
    expect(JSON.stringify(usePaperStore.getState().document)).not.toMatch(/data:image|base64/i);
    const ref = asset?.locator?.kind === 'managed' ? asset.locator.ref : undefined;
    expect(ref).toBeDefined();
    expect(await paperAssetRepository.get(ref!.id)).toMatchObject({ bytes: new Uint8Array([1, 2, 3]) });
    await paperAssetRepository.delete(ref!.id);
  });

  it('reopens a saved project without blanking Paper after normalization remaps a migrated managed image', async () => {
    const base = createDefaultPaperDocument({ title: 'Migrated Link' });
    const legacyDocument = addFrameToPaperPage(base, base.pages[0].id, {
      id: 'linked-panel',
      kind: 'image',
      xMm: 5,
      yMm: 5,
      widthMm: 40,
      heightMm: 30,
      asset: {
        sourceBinItemId: 'source-image-1',
        label: 'Linked panel',
        kind: 'image',
        src: 'data:image/png;base64,AQID',
      },
    } as never).document;
    let managedRefId: string | undefined;

    try {
      // A pre-normalization save: the linked Source Library item has no durable URL yet,
      // so the inline bytes migrate into the managed repository on restore.
      await restoreProjectDocument({
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        id: 'fbl-001-project',
        name: 'Managed Link Round Trip',
        savedAt: 1,
        flow: { version: 3, nodes: [], edges: [] },
        sourceBin: {
          bins: [{
            id: 'default',
            name: 'Source Library',
            collapsed: false,
            createdAt: 1,
            items: [{
              id: 'source-image-1',
              label: 'Linked panel',
              kind: 'image',
              mimeType: 'image/png',
              nativeFilePath: '/tmp/sloom-tests/panel-one.png',
              createdAt: 1,
            }],
          }],
          dismissedSourceKeys: [],
        },
        paper: {
          document: legacyDocument,
          selectedPageId: legacyDocument.pages[0].id,
          tool: 'select',
          zoom: 0.8,
        },
      });

      const migratedAsset = usePaperStore.getState().document.pages[0].frames
        .find((frame) => frame.id === 'linked-panel')?.asset;
      expect(migratedAsset?.locator?.kind).toBe('managed');
      expect(migratedAsset?.sourceBinItemId).toBe('source-image-1');
      managedRefId = migratedAsset?.locator?.kind === 'managed' ? migratedAsset.locator.ref.id : undefined;

      // The linked item later gains a durable external URL (ingest / native reconcile).
      useSourceBinStore.setState((state) => ({
        bins: state.bins.map((bin) => ({
          ...bin,
          items: bin.items.map((item) => item.id === 'source-image-1'
            ? { ...item, assetUrl: 'signal-loom-asset://file/panel-one' }
            : item),
        })),
      }));

      const saved = await buildCurrentProjectDocument({ id: 'fbl-001-project', name: 'Managed Link Round Trip' });
      await restoreProjectDocument(JSON.parse(JSON.stringify(saved)));

      const reopenedDocument = usePaperStore.getState().document;
      expect(reopenedDocument.title).toBe('Migrated Link');
      const reopenedAsset = reopenedDocument.pages[0]?.frames.find((frame) => frame.id === 'linked-panel')?.asset;
      expect(reopenedAsset?.sourceBinItemId).toBe('source-image-1');
      expect(reopenedAsset?.locator).toEqual({ kind: 'external', url: 'signal-loom-asset://file/panel-one' });

      // A second save/reopen after the remap must stay intact as well.
      const savedAgain = await buildCurrentProjectDocument({ id: 'fbl-001-project', name: 'Managed Link Round Trip' });
      await restoreProjectDocument(JSON.parse(JSON.stringify(savedAgain)));
      expect(usePaperStore.getState().document.title).toBe('Migrated Link');
      expect(usePaperStore.getState().document.pages[0]?.frames.some((frame) => frame.id === 'linked-panel')).toBe(true);
    } finally {
      if (managedRefId) await paperAssetRepository.delete(managedRefId as never).catch(() => undefined);
      usePaperStore.getState().restoreSnapshot(undefined);
      await useSourceBinStore.getState().restoreProjectSnapshot(undefined).catch(() => undefined);
    }
  });

  it('preserves valid Paper tabs plus recovery info across reopen and a second save when one tab is corrupt', async () => {
    const documentA = { ...createDefaultPaperDocument({ title: 'Tab A' }), id: 'paper-a' };
    const documentB = { ...createDefaultPaperDocument({ title: 'Tab B' }), id: 'paper-b' };

    try {
      await restoreProjectDocument({
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        id: 'fbl-002-project',
        name: 'Quarantine Round Trip',
        savedAt: 1,
        flow: { version: 3, nodes: [], edges: [] },
        sourceBin: { dismissedSourceKeys: [] },
        paper: {
          document: documentA,
          documents: [
            { id: 'tab-a', document: documentA, tool: 'select', zoom: 0.8 },
            { id: 'tab-broken', document: { id: 'paper-broken', title: 'Broken tab', pages: 'not-an-array' }, tool: 'select', zoom: 0.8 },
            { id: 'tab-b', document: documentB, tool: 'select', zoom: 0.8 },
          ],
          activeDocumentId: 'tab-a',
        },
      });

      const paperState = usePaperStore.getState();
      expect(paperState.documents.map((candidate) => candidate.id)).toEqual(['tab-a', 'tab-b']);
      expect(paperState.document.title).toBe('Tab A');
      expect(paperState.recovery?.quarantinedDocuments).toHaveLength(1);
      expect(paperState.recovery?.quarantinedDocuments[0]).toMatchObject({
        id: 'tab-broken',
        reason: 'malformed-document',
      });
      expect(paperState.recovery?.quarantinedDocuments[0]?.payloadJson).toContain('Broken tab');

      // A resave after recovery must keep the valid tabs and carry the quarantined
      // payload so the corrupt tab remains recoverable instead of silently destroyed.
      const savedAfterRecovery = await buildCurrentProjectDocument({ id: 'fbl-002-project', name: 'Quarantine Round Trip' });
      expect(savedAfterRecovery.paper?.documents?.map((candidate) => candidate.id)).toEqual(['tab-a', 'tab-b']);
      expect(savedAfterRecovery.paper?.recovery?.quarantinedDocuments).toHaveLength(1);

      await restoreProjectDocument(JSON.parse(JSON.stringify(savedAfterRecovery)));
      expect(usePaperStore.getState().documents.map((candidate) => candidate.id)).toEqual(['tab-a', 'tab-b']);
      expect(usePaperStore.getState().document.title).toBe('Tab A');
      expect(usePaperStore.getState().recovery?.quarantinedDocuments).toHaveLength(1);
    } finally {
      usePaperStore.getState().restoreSnapshot(undefined);
    }
  });

  it('does not republish a restored project snapshot back to the native Source Library bridge', async () => {
    const calls: unknown[][] = [];
    useSourceBinStore.setState({
      commitPreparedProjectSnapshot: (...args: unknown[]) => {
        calls.push(args);
      },
    });

    await restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'p1',
      name: 'Native Restore',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
      sourceBin: {
        bins: [{
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: 1,
          items: [],
        }],
        dismissedSourceKeys: [],
      },
    });

    expect(calls[0]?.[1]).toEqual({ publishNative: false });
  });

  it('leaves every live store untouched when Source preparation fails', async () => {
    useFlowStore.getState().replaceFlowSnapshot({
      nodes: [{ id: 'existing', type: 'textNode', position: { x: 5, y: 6 }, data: { prompt: 'keep' } }],
      edges: [],
    });
    useSourceBinStore.setState({
      prepareProjectSnapshot: async () => {
        throw new Error('source bin failed');
      },
    });

    await expect(restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'p1',
      name: 'Rollback',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [{ id: 'incoming', type: 'imageGen', position: { x: 1, y: 2 }, data: {} }],
        edges: [],
      },
      sourceBin: { dismissedSourceKeys: [] },
    })).rejects.toThrow('source bin failed');

    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['existing']);
  });

  it('preserves a concurrent Flow edit when Source reset preparation fails', async () => {
    useFlowStore.getState().replaceFlowSnapshot({
      nodes: [{ id: 'before-reset', type: 'textNode', position: { x: 1, y: 1 }, data: {} }],
      edges: [],
    });
    useSourceBinStore.setState({
      prepareProjectSnapshot: async () => {
        useFlowStore.getState().replaceFlowSnapshot({
          nodes: [{ id: 'concurrent-edit', type: 'textNode', position: { x: 9, y: 9 }, data: { prompt: 'keep me' } }],
          edges: [],
        });
        throw new Error('late Source reset failed');
      },
    });

    await expect(resetProjectDocument()).rejects.toThrow('late Source reset failed');

    expect(useFlowStore.getState().exportProjectFlowSnapshot().nodes.map((node) => node.id)).toEqual(['concurrent-edit']);
  });

  it('keeps live Image bitmaps when Image decoding fails during preparation', async () => {
    // A failed restore must put back the EXACT live document objects — a
    // pixel-stripped snapshot rollback would blank every open Image canvas.
    const liveBitmap = { __live: 'pixels' } as unknown as NonNullable<ImageDocument['layers'][number]['bitmap']>;
    const liveDocument = {
      id: 'doc-live',
      title: 'Live Art',
      // The fail-closed authorization projection requires inspectable own dirty/title data
      // properties before any replacement (even a clean one) may proceed.
      dirty: false,
      width: 64,
      height: 64,
      activeLayerId: 'layer-live',
      layers: [{
        id: 'layer-live', name: 'Layer 1', type: 'image', visible: true, locked: false,
        opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: liveBitmap, bitmapVersion: 3, mask: null,
      }],
      snapshots: [],
    } as unknown as ImageDocument;
    useImageEditorStore.setState({ documents: [liveDocument], activeDocId: 'doc-live' });
    useImageEditorStore.setState({
      prepareProjectSnapshotWithPixels: async () => {
        throw new Error('image decode failed');
      },
    });

    await expect(restoreProjectDocument({
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        id: 'p2',
        name: 'Image Rollback',
        savedAt: 1,
        flow: { version: 3, nodes: [], edges: [] },
        sourceBin: { dismissedSourceKeys: [] },
      })).rejects.toThrow('image decode failed');

    const documents = useImageEditorStore.getState().documents;
    expect(documents).toHaveLength(1);
    expect(documents[0].id).toBe('doc-live');
    expect(documents[0].layers[0].bitmap).toBe(liveBitmap);
    expect(useImageEditorStore.getState().activeDocId).toBe('doc-live');
  });

  it('rejects corrupt live Image layer payloads before replacement and preserves pixels, history, and selection', async () => {
    const liveBitmap = { width: 9, height: 7, __live: 'editable' } as unknown as NonNullable<ImageDocument['layers'][number]['bitmap']>;
    const liveDocument = {
      id: 'project-corruption-live',
      title: 'Keep this edit',
      width: 9,
      height: 7,
      activeLayerId: 'live-layer',
      layers: [{
        id: 'live-layer', name: 'Live', type: 'image', visible: true, locked: false,
        opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: liveBitmap, bitmapVersion: 1, mask: null,
      }],
      hasSelection: true,
      selectionVersion: 2,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: false,
      snapshots: [],
    } as ImageDocument;
    const selection = createMask(9, 7);
    selection.data.set([0, 255, 17, 99], 12);
    setSelection(liveDocument.id, selection);
    const historyEntry = { kind: 'selection', docId: liveDocument.id, before: null, after: null } as const;
    useImageEditorStore.setState({
      documents: [liveDocument],
      activeDocId: liveDocument.id,
      undoStacks: { [liveDocument.id]: [historyEntry] },
      redoStacks: {},
    });
    const originalDecode = defaultImageLayerPixelCodec.decode;
    defaultImageLayerPixelCodec.decode = async () => {
      throw new Error('corrupt incoming bitmap');
    };

    try {
      await expect(restoreProjectDocument({
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        id: 'corrupt-image-project',
        name: 'Corrupt Image',
        savedAt: 1,
        flow: { version: 3, nodes: [], edges: [] },
        sourceBin: { dismissedSourceKeys: [] },
        imageEditor: {
          activeDocId: 'incoming-image',
          documents: [{
            id: 'incoming-image', title: 'Incoming', width: 2, height: 2,
            layers: [{
              id: 'incoming-layer', name: 'Incoming', type: 'image', visible: true, locked: false,
              opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, mask: null,
              bitmapData: 'data:image/png;base64,corrupt', bitmapVersion: 0,
            }],
            activeLayerId: 'incoming-layer', hasSelection: false, selectionVersion: 0,
            viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
          }],
        },
      })).rejects.toThrow('corrupt incoming bitmap');

      const restoredState = useImageEditorStore.getState();
      expect(restoredState.documents).toEqual([liveDocument]);
      expect(restoredState.documents[0].layers[0].bitmap).toBe(liveBitmap);
      expect(restoredState.undoStacks[liveDocument.id]).toEqual([historyEntry]);
      expect(Array.from(getSelection(liveDocument.id)?.data ?? [])).toEqual(Array.from(selection.data));
    } finally {
      defaultImageLayerPixelCodec.decode = originalDecode;
    }
  });

  it('rejects a history-only concurrent Image edit before project commit', async () => {
    const liveDocument = {
      id: 'history-identity-a', title: 'History A', width: 4, height: 3, layers: [], activeLayerId: null,
      hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
    } satisfies ImageDocument;
    useImageEditorStore.setState({
      documents: [liveDocument],
      activeDocId: liveDocument.id,
      undoStacks: {},
      redoStacks: {},
    });
    const transaction = await prepareProjectDocumentTransaction({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'history-identity-b',
      name: 'History B',
      savedAt: 2,
      flow: { version: 3, nodes: [], edges: [] },
      imageEditor: { documents: [], activeDocId: null },
    });
    useImageEditorStore.setState({
      undoStacks: {
        [liveDocument.id]: [{ kind: 'selection', docId: liveDocument.id, before: null, after: null }],
      },
    });

    expect(() => transaction.assertCanCommit()).toThrow('workspace changed while project replacement was prepared');
    expect(() => transaction.commit()).toThrow('workspace changed while project replacement was prepared');
    transaction.rollback();
    expect(useImageEditorStore.getState().documents[0]).toBe(liveDocument);
    expect(useImageEditorStore.getState().undoStacks[liveDocument.id]).toHaveLength(1);
  });

  it('disposes prepared Image pixels on precommit rollback while preserving live Image pixels', async () => {
    const livePixels = { width: 4, height: 3 } as LayerBitmap;
    const preparedPixels = { width: 4, height: 3 } as LayerBitmap;
    const liveDocument = {
      id: 'precommit-image-a', title: 'Image A', width: 4, height: 3,
      layers: [{
        id: 'layer-a', name: 'Layer A', type: 'image', visible: true, locked: false,
        opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: livePixels, mask: null, bitmapVersion: 0,
      }],
      activeLayerId: 'layer-a', hasSelection: false, selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
    } satisfies ImageDocument;
    useImageEditorStore.setState({ documents: [liveDocument], activeDocId: liveDocument.id });
    const originalDecode = defaultImageLayerPixelCodec.decode;
    defaultImageLayerPixelCodec.decode = async () => preparedPixels;
    try {
      const transaction = await prepareProjectDocumentTransaction({
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        id: 'precommit-image-b',
        name: 'Image B',
        savedAt: 2,
        flow: { version: 3, nodes: [], edges: [] },
        imageEditor: {
          documents: [{
            ...liveDocument,
            id: 'precommit-image-b',
            title: 'Image B',
            activeLayerId: 'layer-b',
            layers: [{
              ...liveDocument.layers[0],
              id: 'layer-b',
              name: 'Layer B',
              bitmap: null,
              bitmapData: 'data:image/png;base64,AA==',
            }],
          }],
          activeDocId: 'precommit-image-b',
        },
      });

      transaction.rollback();
      transaction.rollback();
      expect(preparedPixels.width).toBe(0);
      expect(livePixels.width).toBe(4);
      expect(useImageEditorStore.getState().documents[0]).toBe(liveDocument);
    } finally {
      defaultImageLayerPixelCodec.decode = originalDecode;
    }
  });

  it('disposes prepared B URLs when a later preparation fails without touching live A URLs', async () => {
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    installLiveSource([{ id: 'prepare-a', assetUrl: 'blob:prepare-a' }]);
    useImageEditorStore.setState({
      prepareProjectSnapshotWithPixels: async () => {
        throw new Error('late image preparation failed');
      },
    });

    await expect(prepareProjectDocumentTransaction(projectWithSource('prepare-b', sourceSnapshot([
      { id: 'prepare-b-1', assetUrl: 'blob:prepare-b-1' },
      { id: 'prepare-b-2', assetUrl: 'blob:prepare-b-2' },
    ])))).rejects.toThrow('late image preparation failed');

    expect(useSourceBinStore.getState().getAllItems()[0]?.assetUrl).toBe('blob:prepare-a');
    expect(countRevocations(revokeObjectUrl, 'blob:prepare-a')).toBe(0);
    expect(countRevocations(revokeObjectUrl, 'blob:prepare-b-1')).toBe(1);
    expect(countRevocations(revokeObjectUrl, 'blob:prepare-b-2')).toBe(1);

    installLiveSource([]);
    expect(countRevocations(revokeObjectUrl, 'blob:prepare-a')).toBe(1);
  });

  it('keeps shared and multiple Source URLs alive until the last successful-project owner releases them', async () => {
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    installLiveSource([
      { id: 'success-a-only', assetUrl: 'blob:success-a-only' },
      { id: 'success-a-shared-1', assetUrl: 'blob:success-shared' },
      { id: 'success-a-shared-2', assetUrl: 'blob:success-shared' },
      { id: 'success-a-data', assetUrl: 'data:image/png;base64,AA==' },
      { id: 'success-a-native', assetUrl: 'file:///project/a.png', nativeFilePath: '/project/a.png' },
    ]);
    const transaction = await prepareProjectDocumentTransaction(projectWithSource('success-b', sourceSnapshot([
      { id: 'success-b-shared', assetUrl: 'blob:success-shared' },
      { id: 'success-b-only', assetUrl: 'blob:success-b-only' },
      { id: 'success-b-data', assetUrl: 'data:image/png;base64,BB==' },
      { id: 'success-b-native', assetUrl: 'file:///project/b.png', nativeFilePath: '/project/b.png' },
    ])));

    transaction.commit();
    expect(countRevocations(revokeObjectUrl, 'blob:success-a-only')).toBe(0);
    transaction.finalize();

    expect(countRevocations(revokeObjectUrl, 'blob:success-a-only')).toBe(1);
    expect(countRevocations(revokeObjectUrl, 'blob:success-shared')).toBe(0);
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('data:image/png;base64,AA==');
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('data:image/png;base64,BB==');
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('file:///project/a.png');
    expect(revokeObjectUrl).not.toHaveBeenCalledWith('file:///project/b.png');

    installLiveSource([]);
    expect(countRevocations(revokeObjectUrl, 'blob:success-shared')).toBe(1);
    expect(countRevocations(revokeObjectUrl, 'blob:success-b-only')).toBe(1);
  });

  it('retains an unregistered live A URL when a concurrent edit rejects the transaction before Source commit', async () => {
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const liveA = sourceSnapshot([{ id: 'assert-a', assetUrl: 'blob:assert-a' }]);
    useSourceBinStore.setState({ bins: liveA.bins, dismissedSourceKeys: [] });
    const transaction = await prepareProjectDocumentTransaction(projectWithSource(
      'assert-b',
      sourceSnapshot([{ id: 'assert-b', assetUrl: 'blob:assert-b' }]),
    ));
    useFlowStore.getState().replaceFlowSnapshot({
      version: 3,
      nodes: [{ id: 'assert-concurrent', type: 'textNode', position: { x: 1, y: 1 }, data: {} }],
      edges: [],
    });

    expect(() => transaction.assertCanCommit()).toThrow('workspace changed while project replacement was prepared');
    transaction.rollback();

    expect(useSourceBinStore.getState().getAllItems()[0]?.assetUrl).toBe('blob:assert-a');
    expect(countRevocations(revokeObjectUrl, 'blob:assert-a')).toBe(0);
    expect(countRevocations(revokeObjectUrl, 'blob:assert-b')).toBe(1);

    installLiveSource([]);
    expect(countRevocations(revokeObjectUrl, 'blob:assert-a')).toBe(1);
  });

  it.each(['source', 'workspaces', 'flow', 'editor', 'usage', 'paper', 'image'] as const)(
    'preserves usable A URLs and disposes B when the later %s stage fails',
    async (failingStore) => {
      const aUrl = `blob:stage-url-a-${failingStore}`;
      const bUrl = `blob:stage-url-b-${failingStore}`;
      const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      const liveA = sourceSnapshot([{ id: `stage-url-a-${failingStore}`, assetUrl: aUrl }]);
      if (failingStore === 'source') {
        // Reproduce direct import/live-sync fallbacks that can put a blob URL in Zustand before
        // the runtime handle registry has adopted it.
        useSourceBinStore.setState({ bins: liveA.bins, dismissedSourceKeys: [] });
      } else {
        installLiveSource([{ id: `stage-url-a-${failingStore}`, assetUrl: aUrl }]);
      }
      const transaction = await prepareProjectDocumentTransaction(projectWithSource(
        `stage-url-project-b-${failingStore}`,
        sourceSnapshot([{ id: `stage-url-b-${failingStore}`, assetUrl: bUrl }]),
      ));
      const injectedFailure = () => {
        throw new Error(`${failingStore} URL stage failed`);
      };
      let restoreInjectedMethod: () => void;
      switch (failingStore) {
        case 'source': {
          const state = useSourceBinStore.getState();
          const original = state.commitPreparedProjectSnapshot;
          state.commitPreparedProjectSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.commitPreparedProjectSnapshot = original; };
          break;
        }
        case 'workspaces': {
          const state = useFlowWorkspaceStore.getState();
          const original = state.hydrateProjectSnapshot;
          state.hydrateProjectSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.hydrateProjectSnapshot = original; };
          break;
        }
        case 'flow': {
          const state = useFlowStore.getState();
          const original = state.replaceFlowSnapshot;
          state.replaceFlowSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.replaceFlowSnapshot = original; };
          break;
        }
        case 'editor': {
          const state = useEditorStore.getState();
          const original = state.restoreWorkspaceSnapshot;
          state.restoreWorkspaceSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.restoreWorkspaceSnapshot = original; };
          break;
        }
        case 'usage': {
          const state = useProjectUsageStore.getState();
          const original = state.restoreSnapshot;
          state.restoreSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.restoreSnapshot = original; };
          break;
        }
        case 'paper': {
          const state = usePaperStore.getState();
          const original = state.restoreSnapshot;
          state.restoreSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.restoreSnapshot = original; };
          break;
        }
        case 'image': {
          const state = useImageEditorStore.getState();
          const original = state.commitPreparedProjectSnapshotWithPixels;
          state.commitPreparedProjectSnapshotWithPixels = injectedFailure;
          restoreInjectedMethod = () => { state.commitPreparedProjectSnapshotWithPixels = original; };
          break;
        }
      }

      expect(() => transaction.commit()).toThrow(`${failingStore} URL stage failed`);
      restoreInjectedMethod();

      expect(useSourceBinStore.getState().getAllItems()[0]?.assetUrl).toBe(aUrl);
      expect(countRevocations(revokeObjectUrl, aUrl)).toBe(0);
      expect(countRevocations(revokeObjectUrl, bUrl)).toBe(1);
      expect(() => transaction.commit()).toThrow('already been settled');

      installLiveSource([]);
      expect(countRevocations(revokeObjectUrl, aUrl)).toBe(1);
    },
  );

  it('retains A across repeated native-stage failures, then releases superseded URLs once on success', async () => {
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const aUrl = 'blob:native-stage-a';
    installLiveSource([{ id: 'native-stage-a', assetUrl: aUrl }]);

    for (const attempt of [1, 2]) {
      const bUrl = `blob:native-stage-b-${attempt}`;
      const transaction = await prepareProjectDocumentTransaction(projectWithSource(
        `native-stage-project-b-${attempt}`,
        sourceSnapshot([
          { id: attempt === 1 ? 'native-stage-a' : `native-stage-b-${attempt}`, assetUrl: bUrl },
          { id: `native-stage-shared-${attempt}`, assetUrl: aUrl },
        ]),
      ));
      transaction.commit();
      expect(countRevocations(revokeObjectUrl, aUrl)).toBe(0);

      // Models commitProjectSwitch rejecting after all renderer stores committed.
      transaction.rollback();
      transaction.rollback();

      expect(useSourceBinStore.getState().getAllItems()[0]?.assetUrl).toBe(aUrl);
      expect(countRevocations(revokeObjectUrl, aUrl)).toBe(0);
      expect(countRevocations(revokeObjectUrl, bUrl)).toBe(1);
    }

    const successfulBUrl = 'blob:native-stage-b-success';
    const successful = await prepareProjectDocumentTransaction(projectWithSource(
      'native-stage-project-b-success',
      sourceSnapshot([{ id: 'native-stage-b-success', assetUrl: successfulBUrl }]),
    ));
    successful.commit();
    expect(countRevocations(revokeObjectUrl, aUrl)).toBe(0);
    successful.finalize();
    successful.finalize();

    expect(countRevocations(revokeObjectUrl, aUrl)).toBe(1);
    expect(countRevocations(revokeObjectUrl, successfulBUrl)).toBe(0);

    installLiveSource([]);
    expect(countRevocations(revokeObjectUrl, successfulBUrl)).toBe(1);
  });

  it('keeps rollback observable and idempotent when URL cleanup itself throws', async () => {
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      if (url === 'blob:cleanup-b') throw new Error('cleanup failed');
    });
    installLiveSource([{ id: 'cleanup-a', assetUrl: 'blob:cleanup-a' }]);
    const transaction = await prepareProjectDocumentTransaction(projectWithSource(
      'cleanup-b',
      sourceSnapshot([{ id: 'cleanup-b', assetUrl: 'blob:cleanup-b' }]),
    ));
    transaction.commit();

    expect(() => transaction.rollback()).not.toThrow();
    expect(() => transaction.rollback()).not.toThrow();
    expect(useSourceBinStore.getState().getAllItems()[0]?.assetUrl).toBe('blob:cleanup-a');
    expect(countRevocations(revokeObjectUrl, 'blob:cleanup-a')).toBe(0);
    expect(countRevocations(revokeObjectUrl, 'blob:cleanup-b')).toBe(1);

    installLiveSource([]);
    expect(countRevocations(revokeObjectUrl, 'blob:cleanup-a')).toBe(1);
  });

  it('restores the declared active Flow workspace instead of a stale top-level flow snapshot', async () => {
    await restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'p1',
      name: 'Active Workspace Restore',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [{ id: 'stale-node', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      },
      activeFlowWorkspaceId: 'alt',
      flowWorkspaces: [
        {
          id: 'main',
          name: 'Main Flow',
          createdAt: 10,
          updatedAt: 11,
          flow: {
            version: 3,
            nodes: [{ id: 'main-node', type: 'textNode', position: { x: 10, y: 20 }, data: {} }],
            edges: [],
          },
        },
        {
          id: 'alt',
          name: 'Alt Flow',
          createdAt: 20,
          updatedAt: 21,
          flow: {
            version: 3,
            nodes: [{ id: 'alt-node', type: 'textNode', position: { x: 30, y: 40 }, data: {} }],
            edges: [],
          },
        },
      ],
      sourceBin: { dismissedSourceKeys: [] },
    });

    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['alt-node']);
    expect(useFlowWorkspaceStore.getState().activeWorkspaceId).toBe('alt');
    expect(useFlowWorkspaceStore.getState().workspaces.map((workspace) => workspace.id)).toEqual(['main', 'alt']);
  });

  it.each(['flow', 'workspaces', 'editor', 'source', 'usage', 'paper', 'image'] as const)(
    'rolls back only transaction-owned %s state while preserving that store\'s concurrent edit',
    async (concurrentStore) => {
      const flowA = { version: 3 as const, nodes: [{ id: 'flow-a', type: 'textNode' as const, position: { x: 1, y: 1 }, data: {} }], edges: [] };
      useFlowStore.getState().replaceFlowSnapshot(flowA);
      useFlowWorkspaceStore.getState().hydrateProjectSnapshot({
        activeWorkspaceId: 'workspace-a',
        workspaces: [{ id: 'workspace-a', name: 'Workspace A', createdAt: 1, updatedAt: 1, flow: flowA }],
      });
      useEditorStore.getState().restoreWorkspaceSnapshot(undefined);
      const editorA = useEditorStore.getState().exportWorkspaceSnapshot();
      useSourceBinStore.setState({
        bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 1, items: [{ id: 'source-a', label: 'A', kind: 'text', text: 'A', createdAt: 1 }] }],
        dismissedSourceKeys: [],
      });
      useProjectUsageStore.getState().restoreSnapshot(undefined);
      useProjectUsageStore.getState().recordUsage({
        nodeId: 'usage-a', workspace: 'flow', createdAt: 1,
        usage: { source: 'actual', confidence: 'measured', provider: 'test', modelId: 'a', costUsd: 1 },
      });
      usePaperStore.getState().restoreSnapshot({ document: createDefaultPaperDocument({ title: 'Paper A' }) });
      const imageA = {
        id: 'image-a', title: 'Image A', width: 10, height: 10, layers: [], activeLayerId: null,
        hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
      } satisfies ImageDocument;
      useImageEditorStore.setState({ documents: [imageA], activeDocId: imageA.id, quickActionMacros: [] });

      const flowB = { version: 3 as const, nodes: [{ id: 'flow-b', type: 'textNode' as const, position: { x: 2, y: 2 }, data: {} }], edges: [] };
      const imageB = { ...imageA, id: 'image-b', title: 'Image B' };
      const transaction = await prepareProjectDocumentTransaction({
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        id: 'project-b',
        name: 'Project B',
        savedAt: 2,
        flow: flowB,
        activeFlowWorkspaceId: 'workspace-b',
        flowWorkspaces: [{ id: 'workspace-b', name: 'Workspace B', createdAt: 2, updatedAt: 2, flow: flowB }],
        editor: { ...editorA, sourceMonitorVisible: !editorA.sourceMonitorVisible },
        sourceBin: {
          bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 2, items: [{ id: 'source-b', label: 'B', kind: 'text', text: 'B', createdAt: 2 }] }],
          dismissedSourceKeys: [],
        },
        paper: { document: createDefaultPaperDocument({ title: 'Paper B' }) },
        imageEditor: { documents: [imageB], activeDocId: imageB.id },
      });
      transaction.commit();

      switch (concurrentStore) {
        case 'flow':
          useFlowStore.getState().replaceFlowSnapshot({ version: 3, nodes: [{ id: 'flow-concurrent', type: 'textNode', position: { x: 9, y: 9 }, data: {} }], edges: [] });
          break;
        case 'workspaces':
          useFlowWorkspaceStore.getState().createWorkspace('Concurrent Workspace');
          break;
        case 'editor':
          useEditorStore.getState().restoreWorkspaceSnapshot({
            ...useEditorStore.getState().exportWorkspaceSnapshot(),
            programMonitorVisible: !useEditorStore.getState().programMonitorVisible,
          });
          break;
        case 'source':
          useSourceBinStore.setState({
            bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 3, items: [{ id: 'source-concurrent', label: 'Concurrent', kind: 'text', text: 'C', createdAt: 3 }] }],
          });
          break;
        case 'usage':
          useProjectUsageStore.getState().recordUsage({
            nodeId: 'usage-concurrent', workspace: 'flow', createdAt: 3,
            usage: { source: 'actual', confidence: 'measured', provider: 'test', modelId: 'c', costUsd: 2 },
          });
          break;
        case 'paper':
          usePaperStore.getState().addPage();
          break;
        case 'image':
          useImageEditorStore.getState().setDocumentTitle('image-b', 'Image Concurrent');
          break;
      }
      transaction.rollback();

      expect(useFlowStore.getState().nodes[0]?.id).toBe(concurrentStore === 'flow' ? 'flow-concurrent' : 'flow-a');
      expect(useFlowWorkspaceStore.getState().workspaces.some((workspace) => workspace.name === 'Concurrent Workspace')).toBe(concurrentStore === 'workspaces');
      expect(useEditorStore.getState().programMonitorVisible).toBe(
        concurrentStore === 'editor' ? !editorA.programMonitorVisible : editorA.programMonitorVisible,
      );
      expect(useSourceBinStore.getState().bins[0]?.items[0]?.id).toBe(concurrentStore === 'source' ? 'source-concurrent' : 'source-a');
      expect(useProjectUsageStore.getState().ledger.entries[0]?.nodeId).toBe(concurrentStore === 'usage' ? 'usage-concurrent' : 'usage-a');
      expect(usePaperStore.getState().document.title).toBe(concurrentStore === 'paper' ? 'Paper B' : 'Paper A');
      expect(useImageEditorStore.getState().documents[0]?.title).toBe(concurrentStore === 'image' ? 'Image Concurrent' : 'Image A');
    },
  );

  it.each(['source', 'workspaces', 'flow', 'editor', 'usage', 'paper', 'image'] as const)(
    'unwinds earlier renderer stages when the %s store fails before mutation',
    async (failingStore) => {
      const flowA = { version: 3 as const, nodes: [{ id: 'stage-flow-a', type: 'textNode' as const, position: { x: 1, y: 1 }, data: {} }], edges: [] };
      useFlowStore.getState().replaceFlowSnapshot(flowA);
      useFlowWorkspaceStore.getState().hydrateProjectSnapshot({
        activeWorkspaceId: 'stage-workspace-a',
        workspaces: [{ id: 'stage-workspace-a', name: 'Stage Workspace A', createdAt: 1, updatedAt: 1, flow: flowA }],
      });
      const editorA = useEditorStore.getState().exportWorkspaceSnapshot();
      useSourceBinStore.setState({
        bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 1, items: [{ id: 'stage-source-a', label: 'A', kind: 'text', text: 'A', createdAt: 1 }] }],
        dismissedSourceKeys: [],
      });
      useProjectUsageStore.getState().restoreSnapshot(undefined);
      useProjectUsageStore.getState().recordUsage({
        nodeId: 'stage-usage-a', workspace: 'flow', createdAt: 1,
        usage: { source: 'actual', confidence: 'measured', provider: 'test', modelId: 'a', costUsd: 1 },
      });
      usePaperStore.getState().restoreSnapshot({ document: createDefaultPaperDocument({ title: 'Stage Paper A' }) });
      const imageA = {
        id: 'stage-image-a', title: 'Stage Image A', width: 10, height: 10, layers: [], activeLayerId: null,
        hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
      } satisfies ImageDocument;
      useImageEditorStore.setState({ documents: [imageA], activeDocId: imageA.id, quickActionMacros: [] });

      const flowB = { version: 3 as const, nodes: [{ id: 'stage-flow-b', type: 'textNode' as const, position: { x: 2, y: 2 }, data: {} }], edges: [] };
      const transaction = await prepareProjectDocumentTransaction({
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        id: 'stage-project-b',
        name: 'Stage Project B',
        savedAt: 2,
        flow: flowB,
        activeFlowWorkspaceId: 'stage-workspace-b',
        flowWorkspaces: [{ id: 'stage-workspace-b', name: 'Stage Workspace B', createdAt: 2, updatedAt: 2, flow: flowB }],
        editor: { ...editorA, sourceMonitorVisible: !editorA.sourceMonitorVisible },
        sourceBin: {
          bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 2, items: [{ id: 'stage-source-b', label: 'B', kind: 'text', text: 'B', createdAt: 2 }] }],
          dismissedSourceKeys: [],
        },
        paper: { document: createDefaultPaperDocument({ title: 'Stage Paper B' }) },
        imageEditor: { documents: [{ ...imageA, id: 'stage-image-b', title: 'Stage Image B' }], activeDocId: 'stage-image-b' },
      });

      const injectedFailure = () => {
        // Simulate an unrelated edit arriving from another workspace while this exact stage
        // fails. For the first (Source) stage use Image; after Source has committed, edit Source
        // itself so its transaction inverse must decline to overwrite the concurrent value.
        if (failingStore === 'source') {
          useImageEditorStore.getState().setDocumentTitle('stage-image-a', 'Concurrent Image Edit');
        } else {
          useSourceBinStore.setState({
            bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 3, items: [{ id: 'stage-source-concurrent', label: 'Concurrent', kind: 'text', text: 'C', createdAt: 3 }] }],
          });
        }
        throw new Error(`${failingStore} stage failed`);
      };
      let restoreInjectedMethod: () => void;
      switch (failingStore) {
        case 'source': {
          const state = useSourceBinStore.getState();
          const original = state.commitPreparedProjectSnapshot;
          state.commitPreparedProjectSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.commitPreparedProjectSnapshot = original; };
          break;
        }
        case 'workspaces': {
          const state = useFlowWorkspaceStore.getState();
          const original = state.hydrateProjectSnapshot;
          state.hydrateProjectSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.hydrateProjectSnapshot = original; };
          break;
        }
        case 'flow': {
          const state = useFlowStore.getState();
          const original = state.replaceFlowSnapshot;
          state.replaceFlowSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.replaceFlowSnapshot = original; };
          break;
        }
        case 'editor': {
          const state = useEditorStore.getState();
          const original = state.restoreWorkspaceSnapshot;
          state.restoreWorkspaceSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.restoreWorkspaceSnapshot = original; };
          break;
        }
        case 'usage': {
          const state = useProjectUsageStore.getState();
          const original = state.restoreSnapshot;
          state.restoreSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.restoreSnapshot = original; };
          break;
        }
        case 'paper': {
          const state = usePaperStore.getState();
          const original = state.restoreSnapshot;
          state.restoreSnapshot = injectedFailure;
          restoreInjectedMethod = () => { state.restoreSnapshot = original; };
          break;
        }
        case 'image': {
          const state = useImageEditorStore.getState();
          const original = state.commitPreparedProjectSnapshotWithPixels;
          state.commitPreparedProjectSnapshotWithPixels = injectedFailure;
          restoreInjectedMethod = () => { state.commitPreparedProjectSnapshotWithPixels = original; };
          break;
        }
      }

      expect(() => transaction.commit()).toThrow(`${failingStore} stage failed`);
      restoreInjectedMethod();
      expect(useFlowStore.getState().nodes[0]?.id).toBe('stage-flow-a');
      expect(useFlowWorkspaceStore.getState().activeWorkspaceId).toBe('stage-workspace-a');
      expect(useEditorStore.getState().sourceMonitorVisible).toBe(editorA.sourceMonitorVisible);
      expect(useSourceBinStore.getState().bins[0]?.items[0]?.id).toBe(
        failingStore === 'source' ? 'stage-source-a' : 'stage-source-concurrent',
      );
      expect(useProjectUsageStore.getState().ledger.entries[0]?.nodeId).toBe('stage-usage-a');
      expect(usePaperStore.getState().document.title).toBe('Stage Paper A');
      expect(useImageEditorStore.getState().documents[0]?.title).toBe(
        failingStore === 'source' ? 'Concurrent Image Edit' : 'Stage Image A',
      );
    },
  );

  it('continues every prepared store commit when a Source observer throws', async () => {
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    installLiveSource([{ id: 'observer-source-a', assetUrl: 'blob:observer-source-a' }]);
    const transaction = await prepareProjectDocumentTransaction({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'observer-b',
      name: 'Observer B',
      savedAt: 2,
      flow: { version: 3, nodes: [{ id: 'observer-flow-b', type: 'textNode', position: { x: 1, y: 1 }, data: {} }], edges: [] },
      sourceBin: sourceSnapshot([{ id: 'observer-source-b', assetUrl: 'blob:observer-source-b' }]),
      paper: { document: createDefaultPaperDocument({ title: 'Observer Paper B' }) },
    });
    const unsubscribe = useSourceBinStore.subscribe(() => {
      throw new Error('throwing Source observer');
    });
    expect(() => transaction.commit()).not.toThrow();
    unsubscribe();
    transaction.finalize();
    expect(useFlowStore.getState().nodes[0]?.id).toBe('observer-flow-b');
    expect(usePaperStore.getState().document.title).toBe('Observer Paper B');
    expect(useSourceBinStore.getState().getAllItems()[0]?.assetUrl).toBe('blob:observer-source-b');
    expect(countRevocations(revokeObjectUrl, 'blob:observer-source-a')).toBe(1);
    expect(countRevocations(revokeObjectUrl, 'blob:observer-source-b')).toBe(0);

    installLiveSource([]);
    expect(countRevocations(revokeObjectUrl, 'blob:observer-source-b')).toBe(1);
  });

  it('saves and restores the project-level usage ledger', async () => {
    useProjectUsageStore.getState().recordUsage({
      nodeId: 'image-1',
      nodeType: 'imageGen',
      nodeData: { imageOperation: 'mask-inpaint' },
      workspace: 'flow',
      usage: {
        source: 'actual',
        confidence: 'measured',
        provider: 'bfl',
        modelId: 'flux-2-pro',
        costUsd: 0.05,
      },
      createdAt: 100,
    });

    const saved = await buildCurrentProjectDocument({ id: 'project-1', name: 'Spend Test' });
    expect(saved.usageLedger?.entries).toHaveLength(1);

    useProjectUsageStore.getState().restoreSnapshot(undefined);
    await restoreProjectDocument({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      id: 'project-1',
      name: 'Spend Test',
      savedAt: 1,
      flow: { version: 3, nodes: [], edges: [] },
      sourceBin: { dismissedSourceKeys: [] },
      usageLedger: saved.usageLedger,
    });

    expect(useProjectUsageStore.getState().summary.totalKnownCostUsd).toBe(0.05);
  });
});
