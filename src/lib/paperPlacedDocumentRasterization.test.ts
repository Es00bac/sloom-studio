import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BinaryAssetId } from '../shared/assets/contentAddressedAsset';
import { addFrameToPaperPage, addFrameToPaperParentPage, assignPaperParentPage, createDefaultPaperDocument, exportPaperDocumentToPrintHtml } from './paperDocument';
import { buildPaperCbzRasterExport } from './paperDocumentFormats';
import { buildPaperKdpImageArchiveExport } from './paperKdpExport';
import {
  assertPaperDocumentSupportsRasterization,
  collectPaperPlacedDocumentRasterizationIssues,
  createPaperPlacedDocumentRasterizationGuard,
  PaperPlacedDocumentRasterizationError,
} from './paperPlacedDocumentRasterization';
import { buildFlattenedPaperPageSvgExport, buildFlattenedPaperPageSvgExportWithEmbeddedAssets } from './paperPageFlattenExport';
import { buildPaperPlacedSourceItemMimeTypeLookup } from './paperPlacedPdf';
import { buildPaperWebcomicImageDataPages } from './paperWebcomicExport';

afterEach(() => vi.unstubAllGlobals());

function placedDocument(
  kind: 'inline' | 'managed' | 'source' | 'remote-wrong-mime' = 'inline',
) {
  const base = createDefaultPaperDocument({ title: 'Placed PDF boundary' });
  const sha256 = 'a'.repeat(64);
  const asset = kind === 'managed'
    ? {
        label: 'Managed reference.pdf', kind: 'document' as const, mimeType: 'application/pdf',
        locator: { kind: 'managed' as const, ref: {
          id: `sha256:${sha256}` as BinaryAssetId, sha256, mimeType: 'application/pdf', byteLength: 4,
        } },
      }
    : kind === 'source'
      ? { label: 'Source reference.pdf', kind: 'document' as const, sourceBinItemId: 'source-pdf', mimeType: 'application/pdf' }
      : kind === 'remote-wrong-mime'
        ? { label: 'Remote unknown.pdf', kind: 'document' as const, locator: { kind: 'external' as const, url: 'https://example.invalid/reference.pdf' }, mimeType: 'application/octet-stream' }
        : { label: 'Inline reference.pdf', kind: 'document' as const, locator: { kind: 'external' as const, url: 'data:application/pdf;base64,JVBERi0=' }, mimeType: 'application/pdf' };
  return addFrameToPaperPage(base, base.pages[0].id, {
    kind: 'document', label: asset.label, xMm: 11, yMm: 12, widthMm: 80, heightMm: 45,
    rotationDeg: 17, fit: 'cover', imageOffsetXPercent: 25, imageOffsetYPercent: 75, asset,
  }).document;
}

describe('placed-document rasterization capability boundary', () => {
  it.each(['inline', 'managed', 'source', 'remote-wrong-mime'] as const)(
    'reports %s records before fetch, decode, or canvas work',
    (record) => {
      const document = placedDocument(record);
      const [issue] = collectPaperPlacedDocumentRasterizationIssues(document);

      expect(issue).toMatchObject({
        code: 'paper-placed-document-rasterization-unsupported', pageNumber: 1,
        frameLabel: expect.stringContaining('.pdf'),
      });
      expect(() => assertPaperDocumentSupportsRasterization(document)).toThrow(PaperPlacedDocumentRasterizationError);
      expect(() => assertPaperDocumentSupportsRasterization(document)).toThrow(/Print HTML\/live print|replace it with a raster image/);
    },
  );

  it('blocks corrupt/wrong-MIME inline data and missing source records before resolver/decode cancellation can begin', async () => {
    const wrongMime = placedDocument('inline');
    const wrongMimeFrame = wrongMime.pages[0].frames.find((frame) => frame.kind === 'document')!;
    const corruptInline = {
      ...wrongMime,
      pages: wrongMime.pages.map((page) => ({
        ...page,
        frames: page.frames.map((frame) => frame.id === wrongMimeFrame.id ? {
          ...frame,
          asset: { ...frame.asset!, mimeType: 'image/png', locator: { kind: 'external' as const, url: 'data:application/pdf;base64,corrupt' } },
        } : frame),
      })),
    };
    const missingSource = placedDocument('source');
    const resolveImageSrc = vi.fn(() => { throw new Error('resolver must not run'); });
    class DecodeMustNotRun {
      decoding = '';
      set src(_value: string) { throw new Error('decode must not run'); }
    }
    vi.stubGlobal('Image', DecodeMustNotRun);

    await expect(buildFlattenedPaperPageSvgExportWithEmbeddedAssets(corruptInline, corruptInline.pages[0].id, { resolveImageSrc }))
      .rejects.toThrow(PaperPlacedDocumentRasterizationError);
    await expect(buildFlattenedPaperPageSvgExportWithEmbeddedAssets(missingSource, missingSource.pages[0].id, { resolveImageSrc }))
      .rejects.toThrow(PaperPlacedDocumentRasterizationError);
    expect(resolveImageSrc).not.toHaveBeenCalled();
  });

  it('blocks every flattened multi-page transaction before the first raster, including later-page PDFs', async () => {
    const first = createDefaultPaperDocument({ title: 'Mixed pages' });
    const second = { ...first.pages[0], id: 'page-2', pageNumber: 2, frames: [] };
    const withSecondPage = { ...first, pages: [first.pages[0], second] };
    const document = addFrameToPaperPage(withSecondPage, second.id, {
      kind: 'document', label: 'Page two.pdf', xMm: 10, yMm: 10, widthMm: 50, heightMm: 50,
      asset: { label: 'Page two.pdf', kind: 'document', mimeType: 'application/pdf', locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' } },
    }).document;
    const rasterize = vi.fn();

    await expect(buildPaperWebcomicImageDataPages(document, { rasterize })).rejects.toThrow(PaperPlacedDocumentRasterizationError);
    await expect(buildPaperCbzRasterExport(document, { rasterize })).rejects.toThrow(PaperPlacedDocumentRasterizationError);
    await expect(buildPaperKdpImageArchiveExport(document, { rasterize })).rejects.toThrow(PaperPlacedDocumentRasterizationError);
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('rejects an uppercase DATA: scheme PDF in a mixed document before any page raster callback', async () => {
    const first = createDefaultPaperDocument({ title: 'Mixed scheme casing' });
    const second = { ...first.pages[0], id: 'page-2', pageNumber: 2, frames: [] };
    const withSecondPage = { ...first, pages: [first.pages[0], second] };
    const withImage = addFrameToPaperPage(withSecondPage, first.pages[0].id, {
      kind: 'image', label: 'Page one art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 50,
      asset: { label: 'Page one art', kind: 'image', mimeType: 'image/png', locator: { kind: 'external', url: 'data:image/png;base64,iVBORw0KGgo=' } },
    }).document;
    const document = addFrameToPaperPage(withImage, second.id, {
      kind: 'image', label: 'Shouted casing.jpg', xMm: 10, yMm: 10, widthMm: 50, heightMm: 50,
      asset: { label: 'Shouted casing.jpg', kind: 'image', mimeType: 'image/png', locator: { kind: 'external', url: 'DATA:APPLICATION/X-PDF;base64,JVBERi0=' } },
    }).document;
    const rasterize = vi.fn();

    expect(collectPaperPlacedDocumentRasterizationIssues(document)).toMatchObject([
      { pageNumber: 2, mimeType: 'application/x-pdf', isPdf: true },
    ]);
    await expect(buildPaperWebcomicImageDataPages(document, { rasterize })).rejects.toThrow(PaperPlacedDocumentRasterizationError);
    await expect(buildPaperCbzRasterExport(document, { rasterize })).rejects.toThrow(PaperPlacedDocumentRasterizationError);
    await expect(buildPaperKdpImageArchiveExport(document, { rasterize })).rejects.toThrow(PaperPlacedDocumentRasterizationError);
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('classifies linked frames by the current Source Library item in both replacement directions', () => {
    const base = createDefaultPaperDocument({ title: 'Replaced source links' });
    const staleImage = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Replaced with PDF', xMm: 10, yMm: 10, widthMm: 40, heightMm: 30,
      asset: { sourceBinItemId: 'now-pdf', label: 'panel.png', kind: 'image', mimeType: 'image/png' },
    }).document;
    const document = addFrameToPaperPage(staleImage, staleImage.pages[0].id, {
      kind: 'document', label: 'Replaced with image', xMm: 60, yMm: 10, widthMm: 40, heightMm: 30,
      asset: { sourceBinItemId: 'now-image', label: 'reference.pdf', kind: 'document', mimeType: 'application/pdf' },
    }).document;
    const resolveSourceItemMimeType = buildPaperPlacedSourceItemMimeTypeLookup([
      { id: 'now-pdf', mimeType: 'application/pdf', assetUrl: 'blob:https://app.test/now-pdf' },
      { id: 'now-image', mimeType: 'image/jpeg', assetUrl: 'blob:https://app.test/now-image' },
    ]);

    const issues = collectPaperPlacedDocumentRasterizationIssues(document, undefined, { resolveSourceItemMimeType });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ frameLabel: 'panel.png', mimeType: 'application/pdf', isPdf: true });
    expect(() => assertPaperDocumentSupportsRasterization(document, undefined, { resolveSourceItemMimeType }))
      .toThrow(PaperPlacedDocumentRasterizationError);
  });

  it('pins the linked item URL and revision even when its id and compatible MIME stay the same', () => {
    const base = createDefaultPaperDocument({ title: 'Same MIME replacement transaction' });
    const document = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 40, heightMm: 30,
      asset: { sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png' },
    }).document;
    let sourceItems = [{
      id: 'linked-art', mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,OLD', createdAt: 1,
    }];
    const guard = createPaperPlacedDocumentRasterizationGuard(document, () => sourceItems);

    expect(guard.sourceItems).toEqual(sourceItems);
    sourceItems = [{
      id: 'linked-art', mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,NEW', createdAt: 1,
    }];

    expect(guard).toThrow(PaperPlacedDocumentRasterizationError);
    expect(guard).toThrow(/changed while this output was being prepared/i);
  });

  it('keeps compatible vector/live-print HTML available with the native PDF object placement', () => {
    const document = placedDocument();
    const html = exportPaperDocumentToPrintHtml(document);

    expect(html).toContain('<object data="data:application/pdf;base64,JVBERi0=" type="application/pdf"');
    expect(html).toContain('PDF-capable print viewer required for Inline reference.pdf');
  });

  it.each(['application/pdf', 'application/x-pdf', 'application/acrobat'] as const)(
    'blocks %s on image frames before any resolver/decode work and keeps it as a live-print object',
    async (mimeType) => {
      const base = createDefaultPaperDocument({ title: 'Image-frame PDF alias' });
      const { document } = addFrameToPaperPage(base, base.pages[0].id, {
        kind: 'image', label: 'Placed artwork', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
        asset: { label: 'Placed artwork', kind: 'image', mimeType, locator: { kind: 'external', url: `data:${mimeType};base64,JVBERi0=` } },
      });
      const resolveImageSrc = vi.fn(() => { throw new Error('resolver must not run'); });

      await expect(buildFlattenedPaperPageSvgExportWithEmbeddedAssets(document, document.pages[0].id, { resolveImageSrc }))
        .rejects.toThrow(PaperPlacedDocumentRasterizationError);
      expect(resolveImageSrc).not.toHaveBeenCalled();
      expect(exportPaperDocumentToPrintHtml(document)).toContain(`<object data="data:${mimeType};base64,JVBERi0=" type="application/pdf"`);
    },
  );

  it('detects managed aliases and PDF-labelled missing assets without reading payload bytes or promising a placeholder', () => {
    const base = createDefaultPaperDocument({ title: 'Managed and missing PDFs' });
    const sha256 = 'b'.repeat(64);
    const managed = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Misfiled image', xMm: 10, yMm: 10, widthMm: 40, heightMm: 40,
      asset: { label: 'Misfiled image', kind: 'image', locator: { kind: 'managed', ref: {
        id: `sha256:${sha256}` as BinaryAssetId, sha256, mimeType: 'application/acrobat', byteLength: 12,
      } } },
    }).document;
    const document = addFrameToPaperPage(managed, managed.pages[0].id, {
      kind: 'document', label: 'Missing-but-labelled.PDF', xMm: 55, yMm: 10, widthMm: 40, heightMm: 40,
    }).document;

    const issues = collectPaperPlacedDocumentRasterizationIssues(document);
    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.mimeType)).toContain('application/acrobat');
    expect(issues.find((issue) => issue.frameLabel === 'Missing-but-labelled.PDF')?.message).toContain('Restore or relink');
    expect(exportPaperDocumentToPrintHtml(document)).toContain('PDF asset unavailable: relink Missing-but-labelled.PDF');
  });

  it('classifies a bounded data URL header and leaves non-PDF vectors available', () => {
    const base = createDefaultPaperDocument({ title: 'Bounded PDF classification' });
    const hugePayload = `data:application/x-pdf;base64,${'x'.repeat(1024 * 1024)}`;
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Huge placed payload', xMm: 10, yMm: 10, widthMm: 40, heightMm: 40,
      asset: { label: 'Huge placed payload', kind: 'image', locator: { kind: 'external', url: hugePayload } },
    });
    expect(collectPaperPlacedDocumentRasterizationIssues(document)[0]).toMatchObject({ mimeType: 'application/x-pdf', isPdf: true });

    const vectorBase = createDefaultPaperDocument({ title: 'SVG remains available' });
    const vector = addFrameToPaperPage(vectorBase, vectorBase.pages[0].id, {
      kind: 'image', label: 'Vector art', xMm: 10, yMm: 10, widthMm: 40, heightMm: 40,
      asset: { label: 'Vector art', kind: 'image', mimeType: 'image/svg+xml', locator: { kind: 'external', url: 'data:image/svg+xml,%3Csvg/%3E' } },
    }).document;
    expect(() => assertPaperDocumentSupportsRasterization(vector)).not.toThrow();
  });

  it('preflights all pages for a selected-page flatten and rejects unknown page ids without falling back', async () => {
    const first = createDefaultPaperDocument({ title: 'Selected page transaction' });
    const second = { ...first.pages[0], id: 'page-2', pageNumber: 2, frames: [] };
    const withSecondPage = { ...first, pages: [first.pages[0], second] };
    const document = addFrameToPaperPage(withSecondPage, second.id, {
      kind: 'document', label: 'Later.pdf', xMm: 10, yMm: 10, widthMm: 50, heightMm: 50,
      asset: { label: 'Later.pdf', kind: 'document', mimeType: 'application/pdf', locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' } },
    }).document;
    const resolver = vi.fn();

    expect(() => buildFlattenedPaperPageSvgExport(document, document.pages[0].id)).toThrow(PaperPlacedDocumentRasterizationError);
    await expect(buildFlattenedPaperPageSvgExportWithEmbeddedAssets(document, document.pages[0].id, { resolveImageSrc: resolver }))
      .rejects.toThrow(PaperPlacedDocumentRasterizationError);
    expect(resolver).not.toHaveBeenCalled();
    expect(() => buildFlattenedPaperPageSvgExport(first, 'missing-page')).toThrow(/Unknown Paper page id/);
  });

  it('preflights inherited/grouped, off-page, duplicated, and render-excluded PDF frames before any selected output', () => {
    let document = createDefaultPaperDocument({ title: 'Complete frame graph' });
    const pageId = document.pages[0].id;
    const parentId = document.parentPages[0].id;
    document = addFrameToPaperParentPage(document, parentId, {
      id: 'grouped-parent-pdf', kind: 'image', label: 'parent.pdf', xMm: 10, yMm: 10, widthMm: 20, heightMm: 20,
      asset: { label: 'parent.pdf', kind: 'image', mimeType: 'application/pdf', locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' } },
    }).document;
    document = assignPaperParentPage(document, pageId, parentId);
    document = addFrameToPaperPage(document, pageId, {
      id: 'off-page-pdf', kind: 'image', label: 'off-page.pdf', xMm: -1000, yMm: -1000, widthMm: 20, heightMm: 20,
      asset: { label: 'off-page.pdf', kind: 'image', mimeType: 'application/pdf', locator: { kind: 'external', url: 'blob:https://app.test/off-page' } },
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'duplicate-pdf', kind: 'image', label: 'duplicate.pdf', xMm: 50, yMm: 50, widthMm: 20, heightMm: 20,
      asset: { label: 'duplicate.pdf', kind: 'image', mimeType: 'application/pdf', locator: { kind: 'external', url: 'blob:https://app.test/off-page' } },
    }).document;

    const issues = collectPaperPlacedDocumentRasterizationIssues(document);
    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.frameId)).toEqual(expect.arrayContaining([
      `inherited-${parentId}-grouped-parent-pdf-${pageId}`,
      'off-page-pdf',
      'duplicate-pdf',
    ]));
    // A caller may hide/exclude frames in a flatten group, but cannot narrow the whole-document
    // capability transaction and leak a partial output around a placed PDF.
    expect(() => buildFlattenedPaperPageSvgExport(document, pageId, { renderFrameIds: ['not-a-pdf'] }))
      .toThrow(PaperPlacedDocumentRasterizationError);
  });
});
