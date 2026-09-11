import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperFrame } from '../../../lib/paperDocument';
import { collectPaperStoryEditorEntries, paperStoryEntryForFrame } from './paperStoryEditorModel';

describe('paperStoryEditorModel', () => {
  it('collects a threaded story once, using its ordered head as the authoritative source', () => {
    let document = createDefaultPaperDocument({ title: 'Threaded story' });
    const pageId = document.pages[0].id;
    const head = addFrameToPaperPage(document, pageId, {
      kind: 'text',
      label: 'Chapter opening',
      text: 'One contiguous story across two frames.',
      xMm: 10,
      yMm: 10,
      widthMm: 30,
      heightMm: 15,
    });
    document = head.document;
    const tail = addFrameToPaperPage(document, pageId, {
      kind: 'text',
      label: 'Continuation',
      text: 'This stale continuation is not authoritative.',
      xMm: 50,
      yMm: 10,
      widthMm: 30,
      heightMm: 15,
    });
    document = tail.document;
    document = updatePaperFrame(document, pageId, head.frameId, { threadId: 'story-a', threadOrder: 1 });
    document = updatePaperFrame(document, pageId, tail.frameId, { threadId: 'story-a', threadOrder: 2 });

    const entries = collectPaperStoryEditorEntries(document);
    const story = entries.find((entry) => entry.id === 'thread:story-a');

    expect(story).toMatchObject({
      label: 'Chapter opening',
      text: 'One contiguous story across two frames.',
      hasRichText: false,
      editable: true,
    });
    expect(story?.frames.map((item) => item.frame.id)).toEqual([head.frameId, tail.frameId]);
    expect(paperStoryEntryForFrame(entries, tail.frameId)?.id).toBe('thread:story-a');
  });

  it('exposes rich text as readable story text and makes locked heads read-only', () => {
    let document = createDefaultPaperDocument({ title: 'Rich story' });
    const pageId = document.pages[0].id;
    const added = addFrameToPaperPage(document, pageId, {
      kind: 'caption',
      label: 'Rich caption',
      locked: true,
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 30,
      richText: [{ runs: [{ text: 'Bold', fontWeight: '700' }, { text: ' copy' }] }],
      text: 'stale',
    });
    document = added.document;

    expect(collectPaperStoryEditorEntries(document)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `frame:${added.frameId}`,
        text: 'Bold copy',
        hasRichText: true,
        editable: false,
      }),
    ]));
  });
});
