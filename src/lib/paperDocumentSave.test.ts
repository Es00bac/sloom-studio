import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPaperDocument } from './paperDocument';
import { savePaperDocumentEditable } from './paperDocumentSave';
import { usePaperStore } from '../store/paperStore';

function resetPaper() {
  const document = createDefaultPaperDocument({ title: 'Editable save' });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
}

beforeEach(resetPaper);

describe('savePaperDocumentEditable', () => {
  it('clears only the target tab after native Save As acknowledges a durable path', async () => {
    const firstId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    usePaperStore.getState().createNewDocument({ title: 'Other dirty tab' });
    const secondId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().setActiveDocument(firstId);
    const savePaperDocumentFileAs = vi.fn().mockResolvedValue({
      canceled: false,
      path: '/layouts/editable-save.slppr',
    });

    const result = await savePaperDocumentEditable(firstId, {}, {
      bridge: { savePaperDocumentFileAs },
      serialize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    });

    expect(result).toEqual({ status: 'success', path: '/layouts/editable-save.slppr' });
    expect(usePaperStore.getState().isDocumentDirty(firstId)).toBe(false);
    expect(usePaperStore.getState().isDocumentDirty(secondId)).toBe(true);
  });

  it('uses acknowledged overwrite for a known standalone path', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().markDocumentSaved(documentId, {
      kind: 'standalone',
      path: '/layouts/existing.slppr',
    });
    usePaperStore.getState().addPage();
    const writePaperDocumentFile = vi.fn().mockResolvedValue({ ok: true, path: '/layouts/existing.slppr' });
    const savePaperDocumentFileAs = vi.fn();

    const result = await savePaperDocumentEditable(documentId, {}, {
      bridge: { savePaperDocumentFileAs, writePaperDocumentFile },
      serialize: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    });

    expect(writePaperDocumentFile).toHaveBeenCalledWith('/layouts/existing.slppr', expect.any(Uint8Array));
    expect(savePaperDocumentFileAs).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(usePaperStore.getState().isDocumentDirty(documentId)).toBe(false);
  });

  it('keeps edits made during an acknowledged write dirty against the exact serialized baseline', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().markDocumentSaved(documentId, {
      kind: 'standalone',
      path: '/layouts/in-flight.slppr',
    });
    usePaperStore.getState().addPage();
    const serializedPageCount = usePaperStore.getState().document.pages.length;
    const writePaperDocumentFile = vi.fn().mockImplementation(async () => {
      usePaperStore.getState().addPage();
      return { ok: true, path: '/layouts/in-flight.slppr' };
    });

    const result = await savePaperDocumentEditable(documentId, {}, {
      bridge: { savePaperDocumentFileAs: vi.fn(), writePaperDocumentFile },
      serialize: vi.fn().mockImplementation(async (document) => {
        expect(document.pages).toHaveLength(serializedPageCount);
        return new Uint8Array([4, 5, 6]);
      }),
    });

    expect(result.status).toBe('success');
    expect(usePaperStore.getState().isDocumentDirty(documentId)).toBe(true);
  });

  it.each([
    ['cancel', { canceled: true }],
    ['missing path', { canceled: false }],
  ])('leaves exact live state dirty when native Save As returns %s', async (_label, nativeResult) => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    const before = usePaperStore.getState();

    const result = await savePaperDocumentEditable(documentId, {}, {
      bridge: { savePaperDocumentFileAs: vi.fn().mockResolvedValue(nativeResult) },
      serialize: vi.fn().mockResolvedValue(new Uint8Array([7])),
    });

    const after = usePaperStore.getState();
    expect(result.status).toBe('canceled');
    expect(after.document).toBe(before.document);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.activeDocumentId).toBe(before.activeDocumentId);
    expect(after.isDocumentDirty(documentId)).toBe(true);
  });

  it('does not claim that an unacknowledged browser download made the tab clean', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    const download = vi.fn();

    const result = await savePaperDocumentEditable(documentId, {
      allowUnacknowledgedDownload: true,
    }, {
      download,
      serialize: vi.fn().mockResolvedValue(new Uint8Array([8, 9])),
    });

    expect(download).toHaveBeenCalledTimes(1);
    const downloadedBlob = download.mock.calls[0]?.[0] as Blob;
    expect(Array.from(new Uint8Array(await downloadedBlob.arrayBuffer()))).toEqual([8, 9]);
    expect(result.status).toBe('unacknowledged');
    expect(usePaperStore.getState().isDocumentDirty(documentId)).toBe(true);
  });

  it('leaves the tab dirty when serialization or native write fails', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();

    const result = await savePaperDocumentEditable(documentId, {}, {
      bridge: { savePaperDocumentFileAs: vi.fn() },
      serialize: vi.fn().mockRejectedValue(new Error('Missing managed asset')),
    });

    expect(result).toEqual({ status: 'failed', error: 'Missing managed asset' });
    expect(usePaperStore.getState().isDocumentDirty(documentId)).toBe(true);
  });
});
