import { describe, expect, it, vi } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup } from './paperDocument';
import {
  buildPaperWebcomicImageArchiveExport,
  buildPaperWebcomicImageExportPlan,
  safePaperWebcomicPathPart,
} from './paperWebcomicExport';

describe('paperWebcomicExport', () => {
  it('builds safe named-directory and per-page image filenames', () => {
    const doc = createDefaultPaperDocument({
      title: 'Chronicle: Test 3 / Web?',
      preset: 'comic-book',
      dpi: 300,
    });
    const secondPage = {
      ...doc.pages[0],
      id: 'page-two',
      pageNumber: 2,
      frames: [],
    };

    const plan = buildPaperWebcomicImageExportPlan({
      ...doc,
      pages: [doc.pages[0], secondPage],
    }, {
      format: 'png',
      includeBleed: false,
      outputWidthPx: 1600,
    });

    expect(plan.directoryName).toBe('Chronicle-Test-3-Web-webcomic-png');
    expect(plan.pages.map((page) => page.fileName)).toEqual([
      'Chronicle-Test-3-Web-Page-001.png',
      'Chronicle-Test-3-Web-Page-002.png',
    ]);
    expect(plan.pages[0]).toEqual(expect.objectContaining({
      widthPx: 1600,
      heightPx: 2447,
      includeBleed: false,
      mimeType: 'image/png',
    }));
  });

  it('uses DPI when a width override is not supplied', () => {
    const doc = createDefaultPaperDocument({
      title: 'DPI Proof',
      preset: 'custom',
      dpi: 300,
    });
    const plan = buildPaperWebcomicImageExportPlan(doc, {
      format: 'jpeg',
      includeBleed: true,
      outputDpi: 144,
      quality: 0.72,
    });

    expect(plan.format).toBe('jpeg');
    expect(plan.mimeType).toBe('image/jpeg');
    expect(plan.quality).toBe(0.72);
    expect(plan.pages[0].widthPx).toBe(1258);
    expect(plan.pages[0].heightPx).toBe(1618);
    expect(plan.pages[0].fileName).toBe('DPI-Proof-Page-001.jpg');
  });

  it('can plan the expanded production sheet for the ordinary raster PDF adapter', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ preset: 'custom', dpi: 300 }), {
      widthMm: 100,
      heightMm: 150,
      bleedMm: 3,
      printProduction: { marks: { cropMarks: true, slugAreaMm: 12 } },
    });
    const page = buildPaperWebcomicImageExportPlan(doc, {
      includeBleed: true,
      includeProductionMarks: true,
    }).pages[0];

    expect(page).toMatchObject({ widthMm: 120, heightMm: 182, includeBleed: true });
  });

  it('builds a ZIP fallback containing page images inside the named export directory', async () => {
    let doc = createDefaultPaperDocument({ title: 'Archive Proof', preset: 'comic-book' });
    doc = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'caption',
      text: 'Archive page',
      xMm: 8,
      yMm: 8,
      widthMm: 70,
      heightMm: 16,
    }).document;

    const rasterize = vi.fn().mockResolvedValue('data:image/png;base64,UE5H');
    const archive = await buildPaperWebcomicImageArchiveExport(doc, {
      format: 'png',
      includeBleed: false,
      outputWidthPx: 800,
      rasterize,
    });

    expect(archive.fileName).toBe('Archive-Proof-webcomic-png.zip');
    expect(archive.entries).toEqual(['Archive-Proof-webcomic-png/Archive-Proof-Page-001.png']);
    expect(archive.blob.type).toBe('application/zip');
    expect(rasterize).toHaveBeenCalledWith(expect.objectContaining({
      pageNumber: 1,
      widthPx: 800,
      mimeType: 'image/png',
    }));
  });

  it('sanitizes path parts without producing empty filenames', () => {
    expect(safePaperWebcomicPathPart('  /bad:name?  ', 'fallback')).toBe('bad-name');
    expect(safePaperWebcomicPathPart('***', 'fallback')).toBe('fallback');
  });
});
