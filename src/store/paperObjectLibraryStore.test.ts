import { beforeEach, describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from '../lib/paperDocument';
import { usePaperObjectLibraryStore } from './paperObjectLibraryStore';

function frame() {
  const document = createDefaultPaperDocument();
  return addFrameToPaperPage(document, document.pages[0].id, {
    kind: 'shape',
    xMm: 10,
    yMm: 10,
    widthMm: 20,
    heightMm: 20,
  }).document.pages[0].frames[0];
}

describe('paper object library store', () => {
  beforeEach(() => {
    usePaperObjectLibraryStore.getState().clear();
  });

  it('saves and removes a reusable frame through the independent store', () => {
    const id = usePaperObjectLibraryStore.getState().saveFrame(frame(), { name: 'Badge', id: 'badge-1', now: 10 });
    expect(id).toBe('badge-1');
    expect(usePaperObjectLibraryStore.getState().items).toHaveLength(1);
    usePaperObjectLibraryStore.getState().removeItem('badge-1');
    expect(usePaperObjectLibraryStore.getState().items).toEqual([]);
  });

  it('does not persist unsupported frames', () => {
    const source = frame();
    const id = usePaperObjectLibraryStore.getState().saveFrame({ ...source, kind: 'image' }, { name: 'Asset' });
    expect(id).toBeUndefined();
    expect(usePaperObjectLibraryStore.getState().items).toEqual([]);
  });
});
