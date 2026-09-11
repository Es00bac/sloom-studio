import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultPaperDocument } from './paperDocument';
import { protectDirtyPaperBeforeUnload } from './paperBeforeUnload';
import { usePaperStore } from '../store/paperStore';

beforeEach(() => {
  const document = createDefaultPaperDocument({ title: 'Shutdown contract' });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
});
describe('protectDirtyPaperBeforeUnload', () => {
  it('does nothing for a clean project-backed Paper workspace', () => {
    const event = { preventDefault: vi.fn(), returnValue: 'untouched' };

    expect(protectDirtyPaperBeforeUnload(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.returnValue).toBe('untouched');
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });

  it('captures every dirty tab before requesting the platform Leave/Cancel prompt', () => {
    usePaperStore.getState().addPage();
    usePaperStore.getState().createNewDocument({ title: 'Second unsaved' });
    const event = { preventDefault: vi.fn(), returnValue: 'untouched' };

    expect(protectDirtyPaperBeforeUnload(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe('');
    expect(usePaperStore.getState().discardedDocumentRecoveries.map((entry) => entry.reason))
      .toEqual(['shutdown', 'shutdown']);
    expect(usePaperStore.getState().discardedDocumentRecoveries.map((entry) => entry.snapshot.document.title))
      .toEqual(['Shutdown contract', 'Second unsaved']);
  });

  it('deduplicates repeated shutdown attempts for unchanged content', () => {
    usePaperStore.getState().addPage();
    const firstEvent = { preventDefault: vi.fn(), returnValue: '' };
    const secondEvent = { preventDefault: vi.fn(), returnValue: '' };

    protectDirtyPaperBeforeUnload(firstEvent);
    protectDirtyPaperBeforeUnload(secondEvent);

    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(1);
  });
});
