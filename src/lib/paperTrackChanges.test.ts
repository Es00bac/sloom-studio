import { describe, expect, it } from 'vitest';
import { createDefaultPaperDocument, parsePaperDocument, serializePaperDocument } from './paperDocument';
import { applyPaperTrackChange, normalizePaperTrackChanges } from './paperTrackChanges';
import type { PaperDocument } from '../types/paper';

describe('Paper track changes', () => {
  it('bounds hostile persisted revisions and keeps author/timestamp metadata', () => {
    const changes = normalizePaperTrackChanges([{ id: 'x', pageId: 'p', frameId: 'f', kind: 'insert', beforeText: '', afterText: 'new', author: '', createdAt: 42, status: 'pending' }, { id: 'x', pageId: 'p', frameId: 'f', kind: 'delete' }]);
    expect(changes).toEqual([{ id: 'x', pageId: 'p', frameId: 'f', kind: 'insert', beforeText: '', afterText: 'new', author: 'Anonymous', createdAt: 42, status: 'pending' }]);
  });

  it('accepts or rejects a revision through the same persisted document shape', () => {
    const document = createDefaultPaperDocument({ title: 'Redline' });
    const page = document.pages[0];
    const frame = { id: 'frame-1', kind: 'text', text: 'Before' } as PaperDocument['pages'][number]['frames'][number];
    page.frames = [frame];
    const change = { id: 'change-1', pageId: page.id, frameId: frame.id, kind: 'insert' as const, beforeText: frame.text ?? '', afterText: 'Accepted', author: 'Maya', createdAt: 7, status: 'pending' as const };
    const accepted = applyPaperTrackChange({ ...document, trackChanges: [change] }, change, 'accept');
    expect(accepted.pages[0].frames[0].text).toBe('Accepted');
    expect(accepted.pages[0].frames[0].richText).toBeUndefined();
    expect(accepted.trackChanges?.[0].status).toBe('accepted');
    const reopened = parsePaperDocument(serializePaperDocument(accepted));
    expect(reopened.trackChanges?.[0]).toMatchObject({ author: 'Maya', status: 'accepted' });
  });
});
