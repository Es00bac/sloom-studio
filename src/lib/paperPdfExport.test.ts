import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup } from './paperDocument';
import { buildPaperBookletProofPdfExportRequest, buildPaperPdfExportRequest, buildPaperRasterBookletProofPdfExportRequest, buildPaperRasterPdfExportRequest, buildPaperRasterReaderSpreadPdfExportRequest, buildPaperReaderSpreadHtmlExportRequest, buildPaperReaderSpreadPdfExportRequest, safePaperHtmlFileName, safePaperPdfFileName } from './paperPdfExport';

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

describe('paperPdfExport', () => {
  it('builds a native PDF export request from a Paper document', () => {
    let doc = createDefaultPaperDocument({
      title: 'Comic Issue #1 / Final',
      preset: 'comic-book',
      dpi: 600,
    });
    doc = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'caption',
      xMm: 10,
      yMm: 12,
      widthMm: 80,
      heightMm: 20,
      text: 'Narration box',
    }).document;

    const request = buildPaperPdfExportRequest(doc);

    expect(request.title).toBe('Comic Issue #1 / Final');
    expect(request.fileName).toBe('Comic-Issue-1-Final.pdf');
    expect(request.page).toEqual({
      widthMm: 170,
      heightMm: 260,
      bleedMm: 3.175,
      dpi: 600,
    });
    expect(request.production).toEqual(expect.objectContaining({
      pdfStandard: 'browser-pdf',
      outputIntentProfileId: 'srgb',
      browserPdfIsPressCertified: false,
    }));
    expect(request.html).toContain('@page');
    expect(request.html).toContain('size: 170mm 260mm');
    expect(request.html).toContain('bleed: 3.175mm');
    expect(request.html).toContain('left: 0mm;');
    expect(request.html).toContain('top: 0mm;');
    expect(request.html).toContain('data-bleed="3.175mm"');
    expect(request.html).toContain('Narration box');
  });

  it('uses the expanded canonical sheet for an opt-in marks/slug browser PDF request', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ preset: 'custom' }), {
      widthMm: 100,
      heightMm: 150,
      bleedMm: 3,
      printProduction: { marks: { cropMarks: true, slugAreaMm: 12 } },
    });

    const request = buildPaperPdfExportRequest(doc);

    expect(request.page).toMatchObject({ widthMm: 120, heightMm: 182, bleedMm: 3 });
    expect(request.html).toContain('size: 120mm 182mm');
    expect(request.html.match(/data-production-mark=/g)).toHaveLength(8);
    expect(request.html).toContain('data-slug-area-mm="12"');
  });

  it('sanitizes unsafe PDF filenames and always adds the PDF extension', () => {
    expect(safePaperPdfFileName('  My/Layout: Final?  ')).toBe('My-Layout-Final.pdf');
    expect(safePaperPdfFileName('')).toBe('paper-document.pdf');
    expect(safePaperPdfFileName('cover.pdf')).toBe('cover.pdf');
  });

  it('builds a fully-raster page PDF request with exactly one page image and no live author overlay', () => {
    // AUD-020: a "-raster" mode must ship only the flattened page image. Author text/shapes belong
    // baked into that image once, never re-drawn as a live vector frame on top (which changes
    // opacity/compositing and makes the mode dishonest).
    let doc = createDefaultPaperDocument({
      title: 'Raster Text Proof',
      preset: 'comic-book',
      dpi: 300,
    });
    doc = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'shape',
      shapeKind: 'ellipse',
      fillColor: '#3366ff',
      fillOpacity: 0.5,
      xMm: 12,
      yMm: 14,
      widthMm: 40,
      heightMm: 40,
    }).document;
    doc = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'speechBubble',
      xMm: 20,
      yMm: 25,
      widthMm: 58,
      heightMm: 28,
      text: 'This line must not be reflowed by PDF text layout.',
    }).document;

    const request = buildPaperRasterPdfExportRequest(doc, [{
      pageId: doc.pages[0].id,
      pageNumber: 1,
      widthMm: doc.page.widthMm,
      heightMm: doc.page.heightMm,
      widthPx: 2008,
      heightPx: 3071,
      dataUrl: 'data:image/png;base64,flattened-page',
    }]);

    expect(request.mode).toBe('pages-raster');
    expect(request.html).toContain('data-signal-loom-paper-raster-pdf="true"');
    expect(request.html).toContain('src="data:image/png;base64,flattened-page"');
    expect(request.html).toContain('width: 170mm;');
    expect(request.html).toContain('height: 260mm;');
    // The supplied page image appears exactly once for its one page placement.
    expect(countOccurrences(request.html, 'data:image/png;base64,flattened-page')).toBe(1);
    // No live author text is re-emitted into the PDF HTML; it is only in the page image.
    expect(request.html).not.toContain('This line must not be reflowed by PDF text layout.');
    // No live authored frame overlay markup at all (the shape is not double-painted).
    expect(request.html).not.toContain('class="frame');
    expect(request.html).not.toContain('frame-shape');
    expect(request.html).not.toContain('paper-page');
  });

  it('builds a browser-safe reader-spread HTML export request', () => {
    const doc = createDefaultPaperDocument({ title: 'Issue 01: Proof', preset: 'comic-book' });

    const request = buildPaperReaderSpreadHtmlExportRequest(doc);

    expect(request.mode).toBe('reader-spreads');
    expect(request.fileName).toBe('Issue-01-Proof-reader-spreads.html');
    expect(request.html).toContain('signal-loom-paper-export');
    expect(request.html).toContain('reader-spreads');
  });

  it('builds PDF requests for reader spreads and booklet proofs without changing page PDF default', () => {
    const doc = createDefaultPaperDocument({ title: 'Issue Proof', preset: 'comic-book' });

    const pages = buildPaperPdfExportRequest(doc);
    const spreads = buildPaperReaderSpreadPdfExportRequest(doc);
    const booklet = buildPaperBookletProofPdfExportRequest(doc);

    expect(pages.mode).toBe('pages');
    expect(pages.page.widthMm).toBe(170);
    expect(spreads.mode).toBe('reader-spreads');
    expect(spreads.page.widthMm).toBe(340);
    expect(booklet.mode).toBe('booklet-proof');
    expect(booklet.html).toContain('booklet-proof');
  });

  it('builds rasterized reader-spread and booklet PDF requests from page snapshots', () => {
    let doc = createDefaultPaperDocument({ title: 'Raster Proof', preset: 'comic-book' });
    doc = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'caption',
      xMm: 10,
      yMm: 12,
      widthMm: 60,
      heightMm: 16,
      text: 'Do not keep this live in spread PDFs.',
    }).document;
    doc = {
      ...doc,
      pages: [
        doc.pages[0],
        { ...doc.pages[0], id: 'page-2', pageNumber: 2, frames: [] },
      ],
    };
    const pages = [
      { pageId: doc.pages[0].id, pageNumber: 1, widthMm: 170, heightMm: 260, widthPx: 2008, heightPx: 3071, dataUrl: 'data:image/png;base64,page-one' },
      { pageId: doc.pages[1].id, pageNumber: 2, widthMm: 170, heightMm: 260, widthPx: 2008, heightPx: 3071, dataUrl: 'data:image/png;base64,page-two' },
    ];

    const spreads = buildPaperRasterReaderSpreadPdfExportRequest(doc, pages);
    const booklet = buildPaperRasterBookletProofPdfExportRequest(doc, pages);

    expect(spreads.mode).toBe('reader-spreads-raster');
    expect(spreads.page.widthMm).toBe(340);
    expect(spreads.html).toContain('data-signal-loom-paper-raster-pdf="reader-spreads"');
    expect(spreads.html).toContain('data:image/png;base64,page-one');
    expect(spreads.html).toContain('data:image/png;base64,page-two');
    expect(spreads.html).not.toContain('paper-raster-gutter');
    expect(spreads.html).not.toContain('rgba(239, 68, 68');
    expect(spreads.html).not.toContain('Blank left');
    // Each supplied page image appears exactly once in its single reader-spread slot.
    expect(countOccurrences(spreads.html, 'data:image/png;base64,page-one')).toBe(1);
    expect(countOccurrences(spreads.html, 'data:image/png;base64,page-two')).toBe(1);
    // AUD-020: reader spreads ship only the page images; no live authored frame overlay/text.
    expect(spreads.html).not.toContain('class="frame');
    expect(spreads.html).not.toContain('paper-page');
    expect(spreads.html).not.toContain('Do not keep this live in spread PDFs.');
    expect(booklet.mode).toBe('booklet-proof-raster');
    expect(booklet.html).toContain('data-signal-loom-paper-raster-pdf="booklet-proof"');
    expect(booklet.html).not.toContain('paper-raster-gutter');
    expect(booklet.html).not.toContain('aria-label="Fold"');
    expect(booklet.html).not.toContain('>Blank<');
    // Booklet imposition places each page image once (blank slots pad the signature).
    expect(countOccurrences(booklet.html, 'data:image/png;base64,page-one')).toBe(1);
    expect(countOccurrences(booklet.html, 'data:image/png;base64,page-two')).toBe(1);
    expect(booklet.html).not.toContain('class="frame');
    expect(booklet.html).not.toContain('paper-page');
    expect(booklet.html).not.toContain('Do not keep this live in spread PDFs.');
  });

  it('sanitizes unsafe HTML filenames and always adds the HTML extension', () => {
    expect(safePaperHtmlFileName('  My/Layout: Spreads?  ')).toBe('My-Layout-Spreads.html');
    expect(safePaperHtmlFileName('')).toBe('paper-document.html');
    expect(safePaperHtmlFileName('spreads.htm')).toBe('spreads.htm');
  });
});
