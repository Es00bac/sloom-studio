import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, addFrameToPaperParentPage, assignPaperParentPage, createDefaultPaperDocument } from '../../../lib/paperDocument';
import { addPaperLayer, updatePaperLayer } from '../../../lib/paperLayers';
import { resolvePaperSmartGuideCandidates, resolvePaperSmartGuideSnap } from './paperSmartGuides';

describe('Paper smart guides', () => {
  it('uses the visible canvas projection, including inherited items and excluding hidden layers', () => {
    let document = createDefaultPaperDocument({ title: 'Smart guide projection' });
    const pageId = document.pages[0].id;
    const parentId = document.parentPages[0].id;
    document = assignPaperParentPage(document, pageId, parentId);
    document = addFrameToPaperParentPage(document, parentId, {
      id: 'parent-target', kind: 'shape', xMm: 20, yMm: 20, widthMm: 20, heightMm: 20,
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'moving', kind: 'shape', xMm: 50, yMm: 20, widthMm: 20, heightMm: 20,
    }).document;
    const hiddenLayer = addPaperLayer(document, 'Hidden');
    document = updatePaperLayer(hiddenLayer.document, hiddenLayer.layerId!, { visible: false });
    document = addFrameToPaperPage(document, pageId, {
      id: 'hidden-target', kind: 'shape', layerId: hiddenLayer.layerId,
      xMm: 80, yMm: 20, widthMm: 20, heightMm: 20,
    }).document;

    const candidates = resolvePaperSmartGuideCandidates(document, document.pages[0], new Set(['moving']));

    expect(candidates.map((frame) => frame.id)).toEqual([
      expect.stringContaining('parent-target'),
    ]);
  });

  it('snaps a moving edge to a neighboring object and returns a live guide extent', () => {
    const result = resolvePaperSmartGuideSnap({
      moving: { id: 'moving', xMm: 39.4, yMm: 35, widthMm: 20, heightMm: 10 },
      candidates: [{ id: 'target', xMm: 60, yMm: 20, widthMm: 30, heightMm: 40 }],
      pageWidthMm: 210,
      pageHeightMm: 297,
      toleranceMm: 1,
    });

    expect(result.deltaXMm).toBe(0.6);
    expect(result.guides).toContainEqual({
      orientation: 'vertical',
      positionMm: 60,
      startMm: 20,
      endMm: 60,
      target: 'object',
    });
  });

  it('snaps centers to page and margin geometry but ignores distant targets', () => {
    const pageCenter = resolvePaperSmartGuideSnap({
      moving: { id: 'moving', xMm: 94.6, yMm: 80, widthMm: 20, heightMm: 20 },
      candidates: [],
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginsMm: { top: 15, right: 15, bottom: 15, left: 15 },
      toleranceMm: 0.5,
    });
    expect(pageCenter.deltaXMm).toBe(0.4);
    expect(pageCenter.guides[0]).toMatchObject({ positionMm: 105, target: 'page' });

    const none = resolvePaperSmartGuideSnap({
      moving: { id: 'moving', xMm: 33, yMm: 44, widthMm: 20, heightMm: 20 },
      candidates: [],
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginsMm: { top: 15, right: 15, bottom: 15, left: 15 },
      toleranceMm: 0.2,
    });
    expect(none).toEqual({ deltaXMm: 0, deltaYMm: 0, guides: [] });
  });
});
