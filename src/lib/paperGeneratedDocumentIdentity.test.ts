import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { freshenGeneratedPaperDocumentIdentity } from './paperGeneratedDocumentIdentity';

describe('freshenGeneratedPaperDocumentIdentity', () => {
  it('remaps document-scoped identities and their references while preserving managed asset identity', () => {
    let source = createDefaultPaperDocument({ title: 'Generated proposal' });
    source = {
      ...source,
      swatches: [{
        id: 'accent', name: 'Accent', type: 'process', model: 'rgb', rgb: { r: 0, g: 128, b: 255 },
      }],
    };
    const pageId = source.pages[0].id;
    source = addFrameToPaperPage(source, pageId, {
      id: 'story-a',
      kind: 'text',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 30,
      text: 'One',
      threadId: 'story-thread',
      fillSwatchId: 'accent',
      typography: { ...source.styles.paragraph[0].typography, colorSwatchId: 'accent' },
    }).document;
    source = addFrameToPaperPage(source, pageId, {
      id: 'story-b',
      kind: 'text',
      xMm: 10,
      yMm: 50,
      widthMm: 80,
      heightMm: 30,
      text: 'Two',
      threadId: 'story-thread',
    }).document;
    let sequence = 0;
    const fresh = freshenGeneratedPaperDocumentIdentity(source, {
      createId: (kind) => `fresh-${kind}-${sequence += 1}`,
      timestamp: 1234,
    });

    expect(fresh.id).not.toBe(source.id);
    expect(fresh.pages[0].id).not.toBe(source.pages[0].id);
    expect(fresh.pages[0].frames.map((frame) => frame.id)).not.toEqual(source.pages[0].frames.map((frame) => frame.id));
    expect(new Set(fresh.pages[0].frames.map((frame) => frame.threadId)).size).toBe(1);
    expect(fresh.pages[0].frames[0].fillSwatchId).toBe(fresh.swatches?.[0].id);
    expect(fresh.pages[0].frames[0].typography.colorSwatchId).toBe(fresh.swatches?.[0].id);
    expect(fresh.createdAt).toBe(1234);
    expect(fresh.updatedAt).toBe(1234);
  });
});
