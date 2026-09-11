import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { LayerBitmap } from '../../types/imageEditor';
import { createMask } from './SelectionMask';
import { deserializeSlimg, serializeSlimg, type SlimgCodec } from './ImageSlimgFormat';
import { clearAllSelections, getSelection, setSelection } from './selectionRegistry';

const codec: SlimgCodec = {
  encode: async () => new Uint8Array(),
  decode: async (_bytes, width, height) => ({ width, height } as LayerBitmap),
};

function makeDocument(id: string, hasSelection = false) {
  return {
    ...createEmptyImageDocument({ id, title: id, width: 3, height: 2 }),
    hasSelection,
  };
}

describe('selectionRegistry document lifecycle', () => {
  beforeEach(() => {
    useImageEditorStore.getState().restoreProjectSnapshot(undefined);
    clearAllSelections();
  });

  it('clears a stale reused id before opening a no-selection .slimg without touching another open document', async () => {
    const other = makeDocument('other-doc');
    useImageEditorStore.getState().openDocument(other);
    const otherSelection = createMask(3, 2);
    otherSelection.data[2] = 255;
    setSelection(other.id, otherSelection);

    const stale = createMask(3, 2);
    stale.data[0] = 255;
    setSelection('reused-doc', stale);
    const reopened = await deserializeSlimg(
      await serializeSlimg(makeDocument('reused-doc'), codec),
      codec,
    );
    useImageEditorStore.getState().openDocument(reopened);

    expect(getSelection('reused-doc')).toBeUndefined();
    expect(getSelection(other.id)).toBe(otherSelection);
    expect(useImageEditorStore.getState().documents.find((doc) => doc.id === 'reused-doc')?.hasSelection).toBe(false);
  });

  it('restores exact persisted live selection bytes from .slimg into a fresh registry mask', async () => {
    const live = makeDocument('persisted-selection', true);
    const selection = createMask(3, 2);
    selection.data.set([0, 255, 12, 3, 88, 199]);
    setSelection(live.id, selection);
    const bytes = await serializeSlimg(live, codec);
    clearAllSelections();

    const reopened = await deserializeSlimg(bytes, codec);
    useImageEditorStore.getState().openDocument(reopened);

    expect(Array.from(getSelection(live.id)?.data ?? [])).toEqual([0, 255, 12, 3, 88, 199]);
    expect(getSelection(live.id)?.data).not.toBe(selection.data);
    expect(useImageEditorStore.getState().getActiveDocument()?.hasSelection).toBe(true);
  });

  it('clears reused ids during project reset/replacement unless exact persisted selection bytes exist', async () => {
    const stale = createMask(3, 2);
    stale.data[4] = 255;
    setSelection('project-doc', stale);

    await useImageEditorStore.getState().restoreProjectSnapshotWithPixels({
      activeDocId: 'project-doc',
      documents: [makeDocument('project-doc')],
    });
    expect(getSelection('project-doc')).toBeUndefined();

    const persisted = createMask(3, 2);
    persisted.data.set([1, 2, 3, 4, 5, 6]);
    await useImageEditorStore.getState().restoreProjectSnapshotWithPixels({
      activeDocId: 'project-doc',
      documents: [{
        ...makeDocument('project-doc', true),
        selectionMaskData: btoa(String.fromCharCode(...persisted.data)),
      }],
    });
    expect(Array.from(getSelection('project-doc')?.data ?? [])).toEqual([1, 2, 3, 4, 5, 6]);

    useImageEditorStore.getState().restoreProjectSnapshot(undefined);
    expect(getSelection('project-doc')).toBeUndefined();
  });
});
