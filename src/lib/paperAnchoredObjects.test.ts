import { describe, expect, it } from 'vitest';
import {
  addFrameToPaperPage,
  createDefaultPaperDocument,
  parsePaperDocument,
  resolvePaperPageFramesForCanvas,
  resolvePaperPageFramesForOutput,
  serializePaperDocument,
  updatePaperDocumentSetup,
  updatePaperFrame,
} from './paperDocument';
import { addPaperLayer, updatePaperLayer } from './paperLayers';
import {
  normalizePaperAnchoredObjects,
  removePaperAnchoredObjectsForFrames,
  resolvePaperAnchoredObjectPlacements,
} from './paperAnchoredObjects';

describe('Paper anchored objects', () => {
  it('normalizes ownership, offsets, duplicate ids, and bounded text positions', () => {
    expect(normalizePaperAnchoredObjects([
      { id: 'figure-1', objectFrameId: 'figure', anchorFrameId: 'story', textOffset: 99.9, offsetMm: { x: 3, y: -2 } },
      { id: 'figure-1', objectFrameId: 'other', anchorFrameId: 'story', textOffset: 1 },
      { id: 'bad id', objectFrameId: 'figure', anchorFrameId: 'story', textOffset: 1 },
      { id: 'figure-2', objectFrameId: 'figure-2', anchorFrameId: 'story', textOffset: -10 },
    ])).toEqual([
      { id: 'figure-1', objectFrameId: 'figure', anchorFrameId: 'story', textOffset: 99, offsetMm: { x: 3, y: -2 }, missingAnchorPolicy: 'hide' },
      { id: 'figure-2', objectFrameId: 'figure-2', anchorFrameId: 'story', textOffset: 0, missingAnchorPolicy: 'hide' },
    ]);
  });

  it('follows the owning text frame when reflow changes the anchor line', () => {
    let document = createDocument();
    const page = document.pages[0];
    const story = addFrameToPaperPage(document, page.id, {
      id: 'story', kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 80,
      text: 'A short story',
    });
    document = story.document;
    document = updatePaperDocumentSetup(document, {
      anchoredObjects: [{ id: 'figure-anchor', objectFrameId: 'figure', anchorFrameId: 'story', textOffset: 50 }],
    });
    const first = resolvePaperAnchoredObjectPlacements(document, document.pages[0]);
    expect(first[0].resolved).toBe(true);
    const firstY = first[0].yMm;
    document = updatePaperFrame(document, page.id, 'story', { text: 'A short story '.repeat(30) });
    const second = resolvePaperAnchoredObjectPlacements(document, document.pages[0]);
    expect(second[0].yMm).toBeGreaterThan(firstY!);
    const canvasObject = resolvePaperPageFramesForCanvas(document, document.pages[0]).find((frame) => frame.id === 'figure');
    const outputObject = resolvePaperPageFramesForOutput(document, document.pages[0]).find((frame) => frame.id === 'figure');
    expect(canvasObject?.xMm).toBe(outputObject?.xMm);
    expect(canvasObject?.yMm).toBe(outputObject?.yMm);
  });

  it('hides deleted/missing anchors by default and can retain an object as an explicit fallback', () => {
    const document = updatePaperDocumentSetup(createDocument(), {
      anchoredObjects: [
        { id: 'hidden', objectFrameId: 'figure', anchorFrameId: 'missing', textOffset: 0 },
        { id: 'retained', objectFrameId: 'figure', anchorFrameId: 'missing', textOffset: 0, missingAnchorPolicy: 'retain' },
      ],
    });
    const placements = resolvePaperAnchoredObjectPlacements(document, document.pages[0]);
    expect(placements[0].resolved).toBe(false);
    expect(placements[0].reason).toBe('missing-anchor');
    expect(placements[1].resolved).toBe(true);
    expect(placements[1].reason).toBe('missing-anchor');
    const retained = placements[1];
    expect(retained.xMm).toBe(90);
    expect(retained.yMm).toBe(90);
    const filtered = removePaperAnchoredObjectsForFrames(document, new Set(['figure']));
    expect(filtered.anchoredObjects).toEqual([]);
  });

  it('uses a non-printing text owner for geometry while the object layer controls output', () => {
    let document = createDocument();
    const pageId = document.pages[0].id;
    const ownerLayer = addPaperLayer(document, 'Editorial owner');
    document = ownerLayer.document;
    const owner = addFrameToPaperPage(document, pageId, {
      id: 'story', kind: 'text', xMm: 12, yMm: 18, widthMm: 30, heightMm: 40,
      text: 'Anchor geometry remains available to printable objects.', layerId: ownerLayer.layerId,
    });
    document = updatePaperLayer(owner.document, ownerLayer.layerId!, { printable: false });
    document = updatePaperDocumentSetup(document, {
      anchoredObjects: [{ id: 'figure-anchor', objectFrameId: 'figure', anchorFrameId: 'story', textOffset: 10 }],
    });

    const canvas = resolvePaperPageFramesForCanvas(document, document.pages[0]);
    const output = resolvePaperPageFramesForOutput(document, document.pages[0]);
    expect(canvas.find((frame) => frame.id === 'story')).toBeDefined();
    expect(output.find((frame) => frame.id === 'story')).toBeUndefined();
    expect(output.find((frame) => frame.id === 'figure')).toMatchObject({
      xMm: canvas.find((frame) => frame.id === 'figure')?.xMm,
      yMm: canvas.find((frame) => frame.id === 'figure')?.yMm,
    });

    const objectLayer = addPaperLayer(document, 'Non-printing object');
    document = objectLayer.document;
    document = updatePaperFrame(document, pageId, 'figure', { layerId: objectLayer.layerId });
    document = updatePaperLayer(document, objectLayer.layerId!, { printable: false });
    expect(resolvePaperPageFramesForOutput(document, document.pages[0]).find((frame) => frame.id === 'figure')).toBeUndefined();
  });

  it('round-trips relationships through Paper JSON without moving authored coordinates', () => {
    let document = createDocument();
    document = addFrameToPaperPage(document, document.pages[0].id, {
      id: 'story', kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 80, text: 'Story',
    }).document;
    document = updatePaperDocumentSetup(document, {
      anchoredObjects: [{ id: 'figure-anchor', objectFrameId: 'figure', anchorFrameId: 'story', textOffset: 2 }],
    });
    const reopened = parsePaperDocument(serializePaperDocument(document));
    expect(reopened.anchoredObjects).toEqual(document.anchoredObjects);
    expect(reopened.pages[0].frames.find((frame) => frame.id === 'figure')?.xMm).toBe(90);
  });
});

function createDocument() {
  let document = createDefaultPaperDocument({ title: 'Anchors' });
  document = addFrameToPaperPage(document, document.pages[0].id, {
    id: 'figure', kind: 'image', xMm: 90, yMm: 90, widthMm: 10, heightMm: 10,
  }).document;
  return document;
}
