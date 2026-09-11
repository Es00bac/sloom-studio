import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup, updatePaperFrame } from './paperDocument';
import type { PaperDocument, PaperFrame } from '../types/paper';
import type { PaperSwatch } from './paperSwatches';
import { collectSpotFills, collectSpotStrokes, findPaperSpotAlternateConflicts } from './paperPdfxSpotFills';

const PT_PER_MM = 72 / 25.4;
const spotSwatch: PaperSwatch = {
  id: 'sw-spot', name: 'Brand Red', type: 'spot', model: 'cmyk', spotName: 'PANTONE 185 C',
  rgb: { r: 227, g: 6, b: 19 }, cmyk: { c: 0, m: 90, y: 85, k: 0 },
};
const processSwatch: PaperSwatch = {
  id: 'sw-proc', name: 'Teal', type: 'process', model: 'cmyk', rgb: { r: 40, g: 160, b: 170 }, cmyk: { c: 80, m: 0, y: 40, k: 0 },
};

function docWithSpotFrame(patch: Partial<PaperFrame> = {}, swatchId = 'sw-spot'): { doc: PaperDocument; frameId: string } {
  let doc = createDefaultPaperDocument({ title: 'spot', preset: 'us-letter' });
  doc = updatePaperDocumentSetup(doc, { bleedMm: 0 });
  doc = { ...doc, swatches: [spotSwatch, processSwatch] };
  const pageId = doc.pages[0].id;
  const added = addFrameToPaperPage(doc, pageId, { kind: 'caption', xMm: 20, yMm: 30, widthMm: 60, heightMm: 40, strokeWidthMm: 0, strokeColor: 'transparent', cornerRadiusMm: 0, ...patch });
  doc = updatePaperFrame(added.document, pageId, added.frameId, { fillColor: '#e30613', fillSwatchId: swatchId });
  return { doc, frameId: added.frameId };
}

describe('collectSpotFills', () => {
  it('rejects duplicate spot names with different alternate CMYK recipes before native PDF/X output', () => {
    const conflict: PaperSwatch = { ...spotSwatch, id: 'sw-spot-conflict', cmyk: { c: 0, m: 80, y: 85, k: 0 } };
    expect(findPaperSpotAlternateConflicts([spotSwatch, conflict])).toEqual([{
      name: 'PANTONE 185 C', firstSwatchId: 'sw-spot', conflictingSwatchId: 'sw-spot-conflict',
    }]);
  });

  it('turns a plain solid spot-swatch fill into a /Separation spec + knockout', () => {
    const { doc, frameId } = docWithSpotFrame();
    const plan = collectSpotFills(doc.pages[0], doc);
    expect(plan.spotFills).toHaveLength(1);
    const fill = plan.spotFills[0];
    expect(fill.name).toBe('PANTONE 185 C');
    expect(fill.cmyk).toEqual({ c: 0, m: 0.9, y: 0.85, k: 0 });
    expect(fill.tint).toBe(1);
    expect(fill.xPt).toBeCloseTo(20 * PT_PER_MM, 4);
    expect(fill.yTopPt).toBeCloseTo(30 * PT_PER_MM, 4);
    expect(fill.widthPt).toBeCloseTo(60 * PT_PER_MM, 4);
    expect(fill.heightPt).toBeCloseTo(40 * PT_PER_MM, 4);
    expect(plan.knockoutFrameIds).toEqual([frameId]);
    expect(plan.preservedSpotNames).toEqual(['PANTONE 185 C']);
  });

  it('offsets the spot rect by the page bleed', () => {
    let doc = createDefaultPaperDocument({ title: 'spot', preset: 'us-letter' });
    doc = updatePaperDocumentSetup(doc, { bleedMm: 3 });
    doc = { ...doc, swatches: [spotSwatch] };
    const pageId = doc.pages[0].id;
    const added = addFrameToPaperPage(doc, pageId, { kind: 'caption', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20, strokeWidthMm: 0, strokeColor: 'transparent', cornerRadiusMm: 0 });
    doc = updatePaperFrame(added.document, pageId, added.frameId, { fillColor: '#e30613', fillSwatchId: 'sw-spot' });
    const [fill] = collectSpotFills(doc.pages[0], doc).spotFills;
    expect(fill.xPt).toBeCloseTo((3 + 10) * PT_PER_MM, 4);
    expect(fill.yTopPt).toBeCloseTo((3 + 10) * PT_PER_MM, 4);
  });

  it('leaves a process-swatch fill as process (no spot plate)', () => {
    const { doc } = docWithSpotFrame({}, 'sw-proc');
    expect(collectSpotFills(doc.pages[0], doc).spotFills).toHaveLength(0);
  });

  it.each([
    ['a visible stroke', { strokeWidthMm: 0.5, strokeColor: '#000000', strokeOpacity: 1 }],
    ['a fully transparent fill', { fillOpacity: 0 }],
    ['a gradient fill', { fillGradient: { type: 'linear', fromColor: '#000000', toColor: '#ffffff', angleDeg: 0 } as PaperFrame['fillGradient'] }],
  ])('leaves a spot fill with %s as process (not faithfully a plateable rectangle)', (_label, patch) => {
    const { doc } = docWithSpotFrame(patch);
    expect(collectSpotFills(doc.pages[0], doc).spotFills).toHaveLength(0);
  });

  it('plates a ROUNDED-corner spot rect, carrying the corner radius', () => {
    const { doc } = docWithSpotFrame({ cornerRadiusMm: 3 });
    const plan = collectSpotFills(doc.pages[0], doc);
    expect(plan.spotFills).toHaveLength(1);
    expect(plan.spotFills[0].cornerRadiusPt).toBeCloseTo(3 * PT_PER_MM, 4);
  });

  it('plates a POLYGON spot shape from vertex percentages of the frame box', () => {
    // A triangle: top-centre, bottom-right, bottom-left (percentages of the 60×40mm box at 20,30mm; bleed 0).
    const { doc } = docWithSpotFrame({ vertices: [{ xPercent: 50, yPercent: 0 }, { xPercent: 100, yPercent: 100 }, { xPercent: 0, yPercent: 100 }] });
    const plan = collectSpotFills(doc.pages[0], doc);
    expect(plan.spotFills).toHaveLength(1);
    const poly = plan.spotFills[0].polygon!;
    expect(poly).toHaveLength(3);
    // Apex = (20 + 0.5×60, 30 + 0×40) = (50, 30) mm.
    expect(poly[0].xPt).toBeCloseTo(50 * PT_PER_MM, 4);
    expect(poly[0].yTopPt).toBeCloseTo(30 * PT_PER_MM, 4);
    // Bottom-left = (20, 30 + 40) = (20, 70) mm.
    expect(poly[2].xPt).toBeCloseTo(20 * PT_PER_MM, 4);
    expect(poly[2].yTopPt).toBeCloseTo(70 * PT_PER_MM, 4);
  });

  it('leaves a degenerate 2-vertex "polygon" as process', () => {
    const { doc } = docWithSpotFrame({ vertices: [{ xPercent: 0, yPercent: 0 }, { xPercent: 100, yPercent: 100 }] });
    expect(collectSpotFills(doc.pages[0], doc).spotFills).toHaveLength(0);
  });

  it('plates a ROTATED spot rect, carrying the angle + frame-centre pivot', () => {
    const { doc, frameId } = docWithSpotFrame({ rotationDeg: 15 });
    const frame = doc.pages[0].frames.find((f) => f.id === frameId)!;
    const plan = collectSpotFills(doc.pages[0], doc);
    expect(plan.spotFills).toHaveLength(1);
    const fill = plan.spotFills[0];
    expect(fill.rotationDeg).toBe(15);
    const bleedMm = doc.page.bleedMm;
    expect(fill.centerXPt).toBeCloseTo((bleedMm + frame.xMm + frame.widthMm / 2) * PT_PER_MM, 4);
    expect(fill.centerYTopPt).toBeCloseTo((bleedMm + frame.yMm + frame.heightMm / 2) * PT_PER_MM, 4);
  });

  it('keeps a partial-opacity spot fill as a TINTED plate (fill opacity → spot screen density)', () => {
    const { doc } = docWithSpotFrame({ fillOpacity: 0.4 });
    const plan = collectSpotFills(doc.pages[0], doc);
    expect(plan.spotFills).toHaveLength(1);
    expect(plan.spotFills[0].tint).toBeCloseTo(0.4, 6);
    expect(plan.knockoutFrameIds).toHaveLength(1); // still knocked out of the process raster
  });

  it('returns nothing when the document has no spot swatches', () => {
    let doc = createDefaultPaperDocument({ title: 'nospot', preset: 'us-letter' });
    const pageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, pageId, { kind: 'caption', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20 }).document;
    expect(collectSpotFills(doc.pages[0], doc)).toEqual({ spotFills: [], knockoutFrameIds: [], preservedSpotNames: [] });
  });
});

function docWithSpotStrokeFrame(patch: Partial<PaperFrame> = {}): { doc: PaperDocument; frameId: string } {
  let doc = createDefaultPaperDocument({ title: 'spot-stroke', preset: 'us-letter' });
  doc = updatePaperDocumentSetup(doc, { bleedMm: 0 });
  doc = { ...doc, swatches: [spotSwatch, processSwatch] };
  const pageId = doc.pages[0].id;
  const added = addFrameToPaperPage(doc, pageId, {
    kind: 'shape', xMm: 20, yMm: 30, widthMm: 60, heightMm: 40,
    strokeWidthMm: 2, strokeColor: '#e30613', strokeOpacity: 1, strokeStyle: 'solid', cornerRadiusMm: 0, ...patch,
  });
  const doc2 = updatePaperFrame(added.document, pageId, added.frameId, { strokeColor: '#e30613', strokeSwatchId: 'sw-spot' });
  return { doc: doc2, frameId: added.frameId };
}

describe('collectSpotStrokes', () => {
  it('turns a solid spot-swatch border into a stroked /Separation spec + stroke knockout', () => {
    const { doc, frameId } = docWithSpotStrokeFrame();
    const plan = collectSpotStrokes(doc.pages[0], doc);
    expect(plan.spotFills).toHaveLength(1);
    const s = plan.spotFills[0];
    expect(s.name).toBe('PANTONE 185 C');
    expect(s.cmyk).toEqual({ c: 0, m: 0.9, y: 0.85, k: 0 });
    expect(s.stroke?.widthPt).toBeCloseTo(2 * PT_PER_MM, 4);
    expect(s.widthPt).toBeCloseTo(60 * PT_PER_MM, 4);
    expect(plan.knockoutFrameIds).toEqual([frameId]);
    expect(plan.preservedSpotNames).toEqual(['PANTONE 185 C']);
  });

  it('does NOT plate a dashed/dotted/double border (a solid /Separation stroke would mismatch)', () => {
    for (const strokeStyle of ['dashed', 'dotted', 'double'] as const) {
      const { doc } = docWithSpotStrokeFrame({ strokeStyle });
      expect(collectSpotStrokes(doc.pages[0], doc).spotFills).toHaveLength(0);
    }
  });

  it('does NOT plate an invisible (0-width / transparent / 0-opacity) border', () => {
    expect(collectSpotStrokes(docWithSpotStrokeFrame({ strokeWidthMm: 0 }).doc.pages[0], docWithSpotStrokeFrame({ strokeWidthMm: 0 }).doc).spotFills).toHaveLength(0);
    expect(collectSpotStrokes(docWithSpotStrokeFrame({ strokeOpacity: 0 }).doc.pages[0], docWithSpotStrokeFrame({ strokeOpacity: 0 }).doc).spotFills).toHaveLength(0);
  });

  it('plates a rotated spot border about the frame centre', () => {
    const { doc } = docWithSpotStrokeFrame({ rotationDeg: 25 });
    const s = collectSpotStrokes(doc.pages[0], doc).spotFills[0];
    expect(s.rotationDeg).toBe(25);
    expect(s.centerXPt).toBeCloseTo((20 + 30) * PT_PER_MM, 4);
    expect(s.centerYTopPt).toBeCloseTo((30 + 20) * PT_PER_MM, 4);
  });

  it('a process fill with a spot border: the border plates, the fill is not knocked out', () => {
    const { doc, frameId } = docWithSpotStrokeFrame();
    // fill stays process (no fillSwatchId) — only the stroke is a spot.
    expect(collectSpotFills(doc.pages[0], doc).knockoutFrameIds).toEqual([]);
    expect(collectSpotStrokes(doc.pages[0], doc).knockoutFrameIds).toEqual([frameId]);
  });
});
