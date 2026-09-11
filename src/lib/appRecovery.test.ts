import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearNonSecretPersistedRecoveryState,
  CONFIRMED_CRASH_RECOVERY_RESET,
  NON_SECRET_RECOVERY_STORAGE_KEYS,
  SECRET_PERSISTED_STORAGE_KEYS,
  resetProjectToBlank,
  safeRemoveLocalStorageKeys,
} from './appRecovery';
import { createDefaultPaperDocument } from './paperDocument';
import { usePaperStore } from '../store/paperStore';
import { useImageEditorStore } from '../store/imageEditorStore';
import type { ImageDocument } from '../types/imageEditor';
import { useFlowStore } from '../store/flowStore';

const originalPrepareImageRecovery = useImageEditorStore.getState().prepareDocumentRecovery;
const originalDisposePreparedImageRecovery = useImageEditorStore.getState().disposePreparedDocumentRecovery;

afterEach(() => {
  usePaperStore.getState().restoreSnapshot(undefined);
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
  useImageEditorStore.getState().restoreProjectSnapshot(undefined);
  useImageEditorStore.setState({
    discardedDocumentRecoveries: [],
    prepareDocumentRecovery: originalPrepareImageRecovery,
    disposePreparedDocumentRecovery: originalDisposePreparedImageRecovery,
  });
  useFlowStore.getState().replaceFlowSnapshot({ nodes: [], edges: [] });
});

describe('appRecovery helpers', () => {
  it('removes requested storage keys without throwing when one key fails', () => {
    const removeItem = vi.fn((key: string) => {
      if (key === 'broken') {
        throw new Error('quota blocked');
      }
    });

    const results = safeRemoveLocalStorageKeys(['flow-canvas-storage', 'broken'], { removeItem });

    expect(removeItem).toHaveBeenCalledWith('flow-canvas-storage');
    expect(removeItem).toHaveBeenCalledWith('broken');
    expect(results).toEqual([
      { key: 'flow-canvas-storage', removed: true },
      { key: 'broken', removed: false, error: 'quota blocked' },
    ]);
  });

  it('keeps provider/API key storage out of non-secret recovery removal', () => {
    for (const secretKey of SECRET_PERSISTED_STORAGE_KEYS) {
      expect(NON_SECRET_RECOVERY_STORAGE_KEYS).not.toContain(secretKey);
    }
  });

  it('keeps authored workspace storage out of layout-state recovery removal', () => {
    expect(NON_SECRET_RECOVERY_STORAGE_KEYS).not.toContain('signal-loom-paper-workspace');
    expect(NON_SECRET_RECOVERY_STORAGE_KEYS).not.toContain('flow-canvas-storage');
    expect(NON_SECRET_RECOVERY_STORAGE_KEYS).not.toContain('flow-global-source-bin');
    expect(NON_SECRET_RECOVERY_STORAGE_KEYS).not.toContain('flow-editor-workspace');
  });

  it('reports unavailable storage instead of throwing', () => {
    expect(safeRemoveLocalStorageKeys(['flow-canvas-storage'], null)).toEqual([
      { key: 'flow-canvas-storage', removed: false, error: 'localStorage unavailable' },
    ]);
  });

  it('clears only layout/recovery preferences without blanking live Paper or Image documents', () => {
    const paper = createDefaultPaperDocument({ title: 'Keep live Paper' });
    usePaperStore.getState().restoreSnapshot({ document: paper, tool: 'select', zoom: 0.8 });
    usePaperStore.getState().addPage();
    const image: ImageDocument = {
      id: 'keep-live-image',
      title: 'Keep live Image',
      width: 10,
      height: 10,
      layers: [],
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: true,
    };
    useImageEditorStore.setState({ documents: [image], activeDocId: image.id });

    clearNonSecretPersistedRecoveryState({ removeItem: vi.fn() });

    expect(usePaperStore.getState().document.title).toBe('Keep live Paper');
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
    expect(useImageEditorStore.getState().documents).toEqual([image]);
  });

  it('rejects an unconfirmed blank reset without changing Image or Paper state', async () => {
    const paper = createDefaultPaperDocument({ title: 'Unconfirmed Paper' });
    usePaperStore.getState().restoreSnapshot({ document: paper, tool: 'select', zoom: 0.8 });
    usePaperStore.getState().addPage();
    const image: ImageDocument = {
      id: 'unconfirmed-image',
      title: 'Unconfirmed Image',
      width: 10,
      height: 10,
      layers: [],
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: true,
    };
    useImageEditorStore.setState({ documents: [image], activeDocId: image.id });
    const paperBefore = usePaperStore.getState();
    const imageBefore = useImageEditorStore.getState();

    await expect((resetProjectToBlank as unknown as (decision?: string) => Promise<unknown>)())
      .rejects.toThrow('requires an explicit Reset with Recovery decision');

    expect(usePaperStore.getState()).toBe(paperBefore);
    expect(useImageEditorStore.getState()).toBe(imageBefore);
  });

  it('revalidates every project store after awaited Image recovery encoding and before recovery mutation', async () => {
    const image: ImageDocument = {
      id: 'awaited-recovery-image',
      title: 'Awaited recovery Image',
      width: 10,
      height: 10,
      layers: [],
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: true,
    };
    useImageEditorStore.setState({ documents: [image], activeDocId: image.id });
    let entered!: () => void;
    let release!: () => void;
    const recoveryEntered = new Promise<void>((resolve) => { entered = resolve; });
    const recoveryBlocked = new Promise<void>((resolve) => { release = resolve; });
    let preparedRecoveries: Awaited<ReturnType<typeof originalPrepareImageRecovery>> = [];
    const disposePreparedDocumentRecovery = vi.fn(originalDisposePreparedImageRecovery);
    useImageEditorStore.setState({
      prepareDocumentRecovery: async (ids, reason) => {
        const prepared = await originalPrepareImageRecovery(ids, reason);
        preparedRecoveries = prepared;
        entered();
        await recoveryBlocked;
        return prepared;
      },
      disposePreparedDocumentRecovery,
    });
    const operation = resetProjectToBlank(CONFIRMED_CRASH_RECOVERY_RESET);
    await recoveryEntered;
    useFlowStore.getState().replaceFlowSnapshot({
      nodes: [{ id: 'newer-recovery-flow', type: 'textNode', position: { x: 5, y: 0 }, data: {} }],
      edges: [],
    });
    const imageStateAfterEdit = useImageEditorStore.getState();
    release();

    await expect(operation).rejects.toThrow('workspace changed while project replacement was prepared');
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['newer-recovery-flow']);
    expect(useImageEditorStore.getState()).toBe(imageStateAfterEdit);
    expect(useImageEditorStore.getState().documents[0]).toBe(image);
    expect(useImageEditorStore.getState().discardedDocumentRecoveries).toEqual([]);
    expect(disposePreparedDocumentRecovery).toHaveBeenCalledTimes(1);
    expect(disposePreparedDocumentRecovery).toHaveBeenCalledWith(preparedRecoveries);
  });

  it('disposes the exact partial Image recovery batch once when the prepared count is incomplete', async () => {
    const first: ImageDocument = {
      id: 'partial-recovery-1', title: 'Partial 1', width: 10, height: 10, layers: [],
      activeLayerId: null, hasSelection: false, selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: true,
    };
    const second = { ...first, id: 'partial-recovery-2', title: 'Partial 2' };
    useImageEditorStore.setState({ documents: [first, second], activeDocId: first.id });
    let preparedRecoveries: Awaited<ReturnType<typeof originalPrepareImageRecovery>> = [];
    const disposePreparedDocumentRecovery = vi.fn(originalDisposePreparedImageRecovery);
    useImageEditorStore.setState({
      prepareDocumentRecovery: async (ids, reason) => {
        preparedRecoveries = await originalPrepareImageRecovery(ids.slice(0, 1), reason);
        return preparedRecoveries;
      },
      disposePreparedDocumentRecovery,
    });

    await expect(resetProjectToBlank(CONFIRMED_CRASH_RECOVERY_RESET))
      .rejects.toThrow('not every dirty Image document could be captured');

    expect(disposePreparedDocumentRecovery).toHaveBeenCalledTimes(1);
    expect(disposePreparedDocumentRecovery).toHaveBeenCalledWith(preparedRecoveries);
    expect(useImageEditorStore.getState().discardedDocumentRecoveries).toEqual([]);
    expect(useImageEditorStore.getState().documents).toEqual([first, second]);
  });

  it('captures every dirty Paper tab in one bounded crash-recovery batch before blank reset', async () => {
    const first = createDefaultPaperDocument({ title: 'Dirty Paper 1' });
    usePaperStore.getState().restoreSnapshot({ document: first, tool: 'select', zoom: 0.8 });
    usePaperStore.setState({ discardedDocumentRecoveries: [] });
    usePaperStore.getState().addPage();
    for (let index = 2; index <= 10; index += 1) {
      usePaperStore.getState().createNewDocument({ title: `Dirty Paper ${index}` });
    }

    await expect(resetProjectToBlank(CONFIRMED_CRASH_RECOVERY_RESET)).resolves.toEqual({
      capturedDirtyImageDocuments: 0,
      capturedDirtyPaperDocuments: 10,
    });

    const recoveries = usePaperStore.getState().discardedDocumentRecoveries;
    expect(recoveries).toHaveLength(10);
    expect(new Set(recoveries.map((recovery) => recovery.batchId)).size).toBe(1);
    expect(recoveries.map((recovery) => recovery.snapshot.document.title)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Dirty Paper ${index + 1}`),
    );
    expect(recoveries.every((recovery) => recovery.reason === 'crash-recovery')).toBe(true);
    expect(usePaperStore.getState().document.title).toBe('Untitled Paper Layout');
  });

  it('captures every dirty Image and Paper tab in bounded recoverable batches before blank reset', async () => {
    const paper = createDefaultPaperDocument({ title: 'Recoverable Paper' });
    usePaperStore.getState().restoreSnapshot({ document: paper, tool: 'select', zoom: 0.8 });
    usePaperStore.setState({ discardedDocumentRecoveries: [] });
    usePaperStore.getState().addPage();
    const firstImage: ImageDocument = {
      id: 'recoverable-image-1',
      title: 'Recoverable Image 1',
      width: 10,
      height: 10,
      layers: [],
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: true,
    };
    const secondImage = { ...firstImage, id: 'recoverable-image-2', title: 'Recoverable Image 2' };
    useImageEditorStore.setState({ documents: [firstImage, secondImage], activeDocId: secondImage.id });

    await expect(resetProjectToBlank(CONFIRMED_CRASH_RECOVERY_RESET)).resolves.toEqual({
      capturedDirtyImageDocuments: 2,
      capturedDirtyPaperDocuments: 1,
    });

    const imageRecoveryState = useImageEditorStore.getState() as unknown as {
      discardedDocumentRecoveries: Array<{
        batchId: string;
        reason: string;
        snapshot: ImageDocument;
      }>;
    };
    expect(imageRecoveryState.discardedDocumentRecoveries).toHaveLength(2);
    expect(new Set(imageRecoveryState.discardedDocumentRecoveries.map((recovery) => recovery.batchId)).size).toBe(1);
    expect(imageRecoveryState.discardedDocumentRecoveries.map((recovery) => recovery.snapshot.title)).toEqual([
      'Recoverable Image 1',
      'Recoverable Image 2',
    ]);
    expect(imageRecoveryState.discardedDocumentRecoveries.every((recovery) => recovery.reason === 'crash-recovery')).toBe(true);
    expect(usePaperStore.getState().discardedDocumentRecoveries.at(-1)?.snapshot.document.title).toBe('Recoverable Paper');
    expect(useImageEditorStore.getState().documents).toEqual([]);

    const imageRecoveryId = useImageEditorStore.getState().discardedDocumentRecoveries.at(-1)!.id;
    const paperRecoveryId = usePaperStore.getState().discardedDocumentRecoveries.at(-1)!.id;
    await expect(useImageEditorStore.getState().restoreDiscardedDocument(imageRecoveryId))
      .resolves.toBe('recoverable-image-2');
    expect(usePaperStore.getState().restoreDiscardedDocument(paperRecoveryId)).toBeTruthy();
    expect(useImageEditorStore.getState().documents.at(-1)?.title).toBe('Recoverable Image 2');
    expect(useImageEditorStore.getState().documents.at(-1)?.dirty).toBe(true);
    expect(usePaperStore.getState().documents.some((document) => (
      document.document.title === 'Recoverable Paper'
    ))).toBe(true);
  });

  it('bounds Image and Paper crash recovery by the newest eight action batches', async () => {
    for (let index = 1; index <= 9; index += 1) {
      const paper = createDefaultPaperDocument({ title: `Bounded Paper ${index}` });
      usePaperStore.getState().restoreSnapshot({ document: paper, tool: 'select', zoom: 0.8 });
      usePaperStore.getState().addPage();
      const image: ImageDocument = {
        id: `bounded-image-${index}`,
        title: `Bounded Image ${index}`,
        width: 10,
        height: 10,
        layers: [],
        activeLayerId: null,
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: true,
      };
      useImageEditorStore.setState({ documents: [image], activeDocId: image.id });
      await resetProjectToBlank(CONFIRMED_CRASH_RECOVERY_RESET);
    }

    const imageRecoveries = useImageEditorStore.getState().discardedDocumentRecoveries;
    const paperRecoveries = usePaperStore.getState().discardedDocumentRecoveries
      .filter((recovery) => recovery.reason === 'crash-recovery');
    expect(new Set(imageRecoveries.map((recovery) => recovery.batchId)).size).toBe(8);
    expect(new Set(paperRecoveries.map((recovery) => recovery.batchId)).size).toBe(8);
    expect(imageRecoveries.map((recovery) => recovery.snapshot.title)).toEqual(
      Array.from({ length: 8 }, (_, index) => `Bounded Image ${index + 2}`),
    );
    expect(paperRecoveries.map((recovery) => recovery.snapshot.document.title)).toEqual(
      Array.from({ length: 8 }, (_, index) => `Bounded Paper ${index + 2}`),
    );
  });
});
