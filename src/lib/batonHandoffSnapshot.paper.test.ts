import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAPER_BATON_HANDOFF_SOURCE_KEY_PREFIX,
  SLPPR_HANDOFF_MIME_TYPE,
  captureBatonHandoffSnapshots,
  listFreshPaperBatonHandoffItems,
  openPaperBatonHandoffItem,
} from './batonHandoffSnapshot';
import { createDefaultPaperDocument } from './paperDocument';
import { usePaperStore } from '../store/paperStore';
import { useSourceBinStore } from '../store/sourceBinStore';
import { useImageEditorStore } from '../store/imageEditorStore';
const originalAddAssetItem = useSourceBinStore.getState().addAssetItem;

beforeEach(async () => {
  const document = createDefaultPaperDocument({ title: 'Baton Paper' });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
  useImageEditorStore.setState({ documents: [], activeDocId: null });
  await useSourceBinStore.getState().restoreProjectSnapshot(undefined);
});
afterEach(async () => {
  useSourceBinStore.setState({ addAssetItem: originalAddAssetItem });
  await useSourceBinStore.getState().restoreProjectSnapshot(undefined);
  vi.restoreAllMocks();
});

function seedManyPaperTabs(count: number, cleanIndexes: ReadonlySet<number> = new Set()): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index === 0) {
      usePaperStore.getState().addFrame('text', { id: `baton-frame-${index}`, text: `tab ${index}` });
    } else {
      usePaperStore.getState().createNewDocument({ title: `Baton tab ${index}` });
      usePaperStore.getState().addFrame('text', { id: `baton-frame-${index}`, text: `tab ${index}` });
    }
    const id = usePaperStore.getState().activeDocumentId;
    ids.push(id);
    if (cleanIndexes.has(index)) {
      usePaperStore.getState().markDocumentSaved(id, {
        kind: 'standalone',
        path: `/tmp/baton-tab-${index}.slppr`,
      });
    }
  }
  return ids;
}

describe('Paper baton handoff recovery', () => {
  it('does not publish clean Paper tabs', async () => {
    await captureBatonHandoffSnapshots();

    expect(listFreshPaperBatonHandoffItems(useSourceBinStore.getState().getAllItems())).toHaveLength(0);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });

  it('publishes each dirty Paper tab as editable .slppr plus a bounded local recovery', async () => {
    usePaperStore.getState().addPage();
    usePaperStore.getState().createNewDocument({ title: 'Second baton tab' });

    await captureBatonHandoffSnapshots();

    const handoffs = listFreshPaperBatonHandoffItems(useSourceBinStore.getState().getAllItems());
    expect(handoffs).toHaveLength(2);
    expect(handoffs.map((item) => item.mimeType)).toEqual([SLPPR_HANDOFF_MIME_TYPE, SLPPR_HANDOFF_MIME_TYPE]);
    expect(handoffs.every((item) => item.sourceKey?.startsWith(PAPER_BATON_HANDOFF_SOURCE_KEY_PREFIX))).toBe(true);
    expect(usePaperStore.getState().discardedDocumentRecoveries.map((entry) => entry.reason))
      .toEqual(['baton-handoff', 'baton-handoff']);
  });

  it('opens a handed-off .slppr additively with a clean editable baseline', async () => {
    usePaperStore.getState().addFrame('text', { id: 'handoff-copy', text: 'Continue this copy' });
    await captureBatonHandoffSnapshots();
    const item = listFreshPaperBatonHandoffItems(useSourceBinStore.getState().getAllItems())[0];
    const tabCount = usePaperStore.getState().documents.length;

    expect(await openPaperBatonHandoffItem(item)).toBe(true);

    expect(usePaperStore.getState().documents).toHaveLength(tabCount + 1);
    expect(usePaperStore.getState().document.pages[0].frames)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'handoff-copy' })]));
    expect(usePaperStore.getState().isDocumentDirty()).toBe(false);
  });

  it('captures and transports all 20+ dirty tabs as one ordered batch', async () => {
    const ids = seedManyPaperTabs(21);
    usePaperStore.getState().setActiveDocument(ids[12]);

    await captureBatonHandoffSnapshots();

    const recoveries = usePaperStore.getState().discardedDocumentRecoveries
      .filter((entry) => entry.reason === 'baton-handoff');
    expect(recoveries).toHaveLength(21);
    expect(new Set(recoveries.map((entry) => entry.batchId))).toHaveLength(1);
    expect(recoveries.map((entry) => entry.originalIndex)).toEqual([...Array(21).keys()]);
    expect(recoveries.filter((entry) => entry.wasActive).map((entry) => entry.snapshot.id)).toEqual([ids[12]]);

    const handoffs = listFreshPaperBatonHandoffItems(useSourceBinStore.getState().getAllItems());
    expect(handoffs).toHaveLength(21);
    expect(new Set(handoffs.map((item) => item.envelopeId))).toHaveLength(1);
    expect(handoffs.map((item) => item.envelopeIndex)).toEqual([...Array(21).keys()]);
  });

  it('keeps mixed clean tabs out while preserving every dirty tab index and local restore', async () => {
    const cleanIndexes = new Set([1, 4, 7, 13, 19]);
    const ids = seedManyPaperTabs(22, cleanIndexes);
    usePaperStore.getState().setActiveDocument(ids[17]);
    await captureBatonHandoffSnapshots();

    const recoveries = usePaperStore.getState().discardedDocumentRecoveries
      .filter((entry) => entry.reason === 'baton-handoff');
    const dirtyIndexes = [...Array(22).keys()].filter((index) => !cleanIndexes.has(index));
    expect(recoveries.map((entry) => entry.originalIndex)).toEqual(dirtyIndexes);
    expect(recoveries.filter((entry) => entry.wasActive)).toHaveLength(1);
    expect(listFreshPaperBatonHandoffItems(useSourceBinStore.getState().getAllItems())).toHaveLength(dirtyIndexes.length);

    usePaperStore.getState().restoreSnapshot(undefined);
    for (const recovery of [...recoveries].sort((left, right) => left.originalIndex - right.originalIndex)) {
      expect(usePaperStore.getState().restoreDiscardedDocument(recovery.id)).toBeTruthy();
    }
    const restoredTitles = usePaperStore.getState().documents.map((document) => document.document.title);
    for (const recovery of recoveries) {
      expect(restoredTitles).toContain(recovery.snapshot.document.title);
    }
  });

  it('removes a partially published transport batch while retaining all local recoveries', async () => {
    seedManyPaperTabs(20);
    let calls = 0;
    useSourceBinStore.setState({
      addAssetItem: async (...args: Parameters<typeof originalAddAssetItem>) => {
        calls += 1;
        if (calls === 7) throw new Error('transport interrupted');
        const item = await originalAddAssetItem(...args);
        expect(listFreshPaperBatonHandoffItems(useSourceBinStore.getState().getAllItems())).toHaveLength(0);
        return item;
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await captureBatonHandoffSnapshots();

    expect(calls).toBe(7);
    expect(usePaperStore.getState().discardedDocumentRecoveries
      .filter((entry) => entry.reason === 'baton-handoff')).toHaveLength(20);
    expect(listFreshPaperBatonHandoffItems(useSourceBinStore.getState().getAllItems())).toHaveLength(0);
  });
});
