import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument, exportPaperDocumentToPrintHtml, resolvePaperPageFramesForCanvas, resolvePaperPageFramesForOutput } from './paperDocument';
import {
  addPaperLayer,
  assignPaperFramesToLayer,
  DEFAULT_PAPER_LAYER,
  movePaperLayer,
  normalizePaperLayers,
  renamePaperLayer,
  updatePaperLayer,
} from './paperLayers';

describe('Paper persistent layers', () => {
  it('normalizes untrusted records and always retains one usable layer', () => {
    expect(normalizePaperLayers(undefined)).toEqual([DEFAULT_PAPER_LAYER]);
    expect(normalizePaperLayers([
      { id: 'art', name: ' Art ', visible: false, printable: false, locked: true },
      { id: 'art', name: 'duplicate', visible: true },
      { id: '', name: 'missing id' },
      null,
    ])).toEqual([{
      id: 'art',
      name: 'Art',
      visible: false,
      printable: false,
      locked: true,
    }]);
  });

  it('orders layers back-to-front while retaining z-order inside each layer', () => {
    let document = createDefaultPaperDocument();
    const pageId = document.pages[0].id;
    const artLayer = addPaperLayer(document, 'Artwork');
    document = artLayer.document;
    const first = addFrameToPaperPage(document, pageId, {
      kind: 'shape', xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, zIndex: 50,
    });
    document = first.document;
    const second = addFrameToPaperPage(document, pageId, {
      kind: 'shape', xMm: 0, yMm: 0, widthMm: 10, heightMm: 10, zIndex: 1, layerId: artLayer.layerId,
    });
    document = second.document;

    expect(resolvePaperPageFramesForCanvas(document, document.pages[0]).map((frame) => frame.id))
      .toEqual([first.frameId, second.frameId]);

    document = movePaperLayer(document, artLayer.layerId!, 'backward');
    expect(resolvePaperPageFramesForCanvas(document, document.pages[0]).map((frame) => frame.id))
      .toEqual([second.frameId, first.frameId]);
  });

  it('keeps non-printing layers on canvas but excludes hidden and non-printable layers from output', () => {
    let document = createDefaultPaperDocument();
    const pageId = document.pages[0].id;
    const notes = addPaperLayer(document, 'Notes');
    document = notes.document;
    const placed = addFrameToPaperPage(document, pageId, {
      kind: 'text', xMm: 0, yMm: 0, widthMm: 20, heightMm: 10, text: 'Editorial note', layerId: notes.layerId,
    });
    document = updatePaperLayer(placed.document, notes.layerId!, { printable: false });

    expect(resolvePaperPageFramesForCanvas(document, document.pages[0]).map((frame) => frame.id))
      .toContain(placed.frameId);
    expect(resolvePaperPageFramesForOutput(document, document.pages[0]).map((frame) => frame.id))
      .not.toContain(placed.frameId);
    expect(exportPaperDocumentToPrintHtml(document)).not.toContain('Editorial note');

    document = updatePaperLayer(document, notes.layerId!, { visible: false });
    expect(resolvePaperPageFramesForCanvas(document, document.pages[0]).map((frame) => frame.id))
      .not.toContain(placed.frameId);
  });

  it('renames and assigns editable frames while locked layers fail closed', () => {
    let document = createDefaultPaperDocument();
    const pageId = document.pages[0].id;
    const placed = addFrameToPaperPage(document, pageId, {
      kind: 'text', xMm: 0, yMm: 0, widthMm: 20, heightMm: 10,
    });
    document = placed.document;
    const copyLayer = addPaperLayer(document, 'Copy');
    document = renamePaperLayer(copyLayer.document, copyLayer.layerId!, 'Lettering');
    document = assignPaperFramesToLayer(document, pageId, [placed.frameId], copyLayer.layerId!);
    expect(document.layers.at(-1)?.name).toBe('Lettering');
    expect(document.pages[0].frames[0].layerId).toBe(copyLayer.layerId);

    const lockedDocument = updatePaperLayer(document, copyLayer.layerId!, { locked: true });
    const unchanged = assignPaperFramesToLayer(
      lockedDocument,
      pageId,
      [placed.frameId],
      lockedDocument.layers[0].id,
    );
    expect(unchanged).toBe(lockedDocument);
  });
});
