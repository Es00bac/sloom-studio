import { describe, expect, it } from 'vitest';
import {
  addFrameToPaperPage,
  addPaperPage,
  createDefaultPaperDocument,
  parsePaperDocument,
  resolvePaperPageFramesForCanvas,
  resolvePaperPageFramesForOutput,
  serializePaperDocument,
  updatePaperDocumentSetup,
} from './paperDocument';
import {
  createPaperCrossReferenceToken,
  createPaperPageReferenceToken,
  normalizePaperPublicationReferences,
  resolvePaperPublicationReferences,
  resolvePaperPublicationText,
} from './paperPublicationReferences';

describe('Paper publication references', () => {
  it('normalizes bounded TOC, index, and cross-reference collections', () => {
    expect(normalizePaperPublicationReferences({
      version: 99,
      tocEntries: [{ id: 'toc-1', label: 'Intro', targetPageId: 'page-1', level: 2 }, { id: 'toc-1', label: 'Duplicate', targetPageId: 'page-2' }],
      indexMarkers: [{ id: 'idx-1', term: '  Apple  ', targetPageId: 'page-1', textOffset: 9.9 }],
      crossReferences: [{ id: 'ref-1', label: 'See intro', targetPageId: 'page-1' }],
    })).toEqual({
      version: 1,
      tocEntries: [{ id: 'toc-1', label: 'Intro', targetPageId: 'page-1', level: 2 }],
      indexMarkers: [{ id: 'idx-1', term: 'Apple', targetPageId: 'page-1', textOffset: 9 }],
      crossReferences: [{ id: 'ref-1', label: 'See intro', targetPageId: 'page-1' }],
    });
  });

  it('resolves page targets, groups index terms, and reports missing targets', () => {
    let document = createDefaultPaperDocument({ title: 'Reference book' });
    const firstPageId = document.pages[0].id;
    document = addPaperPage(document);
    const secondPageId = document.pages[1].id;
    document = updatePaperDocumentSetup(document, {
      publicationReferences: {
        tocEntries: [{ id: 'toc-intro', label: 'Introduction', targetPageId: firstPageId }],
        indexMarkers: [
          { id: 'idx-a', term: 'Apple', targetPageId: secondPageId },
          { id: 'idx-b', term: 'apple', targetPageId: firstPageId },
          { id: 'idx-missing', term: 'Missing', targetPageId: 'not-a-page' },
        ],
        crossReferences: [{ id: 'ref-intro', label: 'Introduction', targetPageId: firstPageId }],
      },
    });
    const resolved = resolvePaperPublicationReferences(document);
    expect(resolved.toc[0]).toMatchObject({ pageNumber: 1, missing: false });
    expect(resolved.index.find((entry) => entry.term === 'Apple')).toMatchObject({ pageNumbers: [1, 2], markerIds: ['idx-a', 'idx-b'] });
    expect(resolved.missingTargetIds).toContain('idx-missing');
    expect(resolvePaperPublicationText(
      `Read ${createPaperPageReferenceToken('toc-intro')} and ${createPaperCrossReferenceToken('ref-intro')}. {{page:missing}}`,
      document,
    )).toEqual({
      text: 'Read 1 and Introduction (p. 1). {{page:missing}}',
      changed: true,
      resolvedIds: ['toc-intro', 'ref-intro'],
      missingIds: ['missing'],
    });
  });

  it('keeps canvas and print text in parity for plain and rich frames', () => {
    let document = createDefaultPaperDocument({ title: 'Reference template' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      id: 'plain', kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
      text: 'See {{page:toc}}',
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'rich', kind: 'text', xMm: 10, yMm: 40, widthMm: 80, heightMm: 20,
      richText: [{ runs: [{ text: '{{ref:related}}' }] }],
    }).document;
    document = updatePaperDocumentSetup(document, {
      publicationReferences: {
        tocEntries: [{ id: 'toc', label: 'Contents', targetPageId: pageId }],
        indexMarkers: [],
        crossReferences: [{ id: 'related', label: 'Related section', targetPageId: pageId }],
      },
    });
    const canvas = resolvePaperPageFramesForCanvas(document, document.pages[0]);
    const output = resolvePaperPageFramesForOutput(document, document.pages[0]);
    expect(canvas.find((frame) => frame.id === 'plain')?.text).toBe('See 1');
    expect(output.find((frame) => frame.id === 'rich')?.text).toBe('Related section (p. 1)');
    expect(canvas.find((frame) => frame.id === 'rich')?.text).toBe(output.find((frame) => frame.id === 'rich')?.text);
  });

  it('persists references and preserves missing targets for later relinking', () => {
    const document = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Persist references' }), {
      publicationReferences: {
        tocEntries: [{ id: 'toc', label: 'Chapter', targetPageId: 'deleted-page' }],
        indexMarkers: [],
        crossReferences: [],
      },
    });
    const reopened = parsePaperDocument(serializePaperDocument(document));
    expect(reopened.publicationReferences?.tocEntries[0].targetPageId).toBe('deleted-page');
    expect(resolvePaperPublicationReferences(reopened).missingTargetIds).toEqual(['toc']);
  });
});
