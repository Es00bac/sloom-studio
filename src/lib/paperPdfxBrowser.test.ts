import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { PaperPlacedDocumentRasterizationError } from './paperPlacedDocumentRasterization';

const mocks = vi.hoisted(() => ({
  resolveProfile: vi.fn(),
  materialize: vi.fn(),
  exact: vi.fn(),
  exportPdfx: vi.fn(),
  buildPage: vi.fn(),
  rasterize: vi.fn(),
  sourceItems: [] as Array<{ id: string; label: string; kind: string; mimeType?: string; assetUrl?: string; createdAt: number }>,
}));

vi.mock('./paperPageFlattenExport', () => ({
  buildFlattenedPaperPageSvgExportWithEmbeddedAssets: mocks.buildPage,
  imageSourceToDataUrl: vi.fn(),
  rasterizeFlattenedPaperPageToRgba: mocks.rasterize,
}));
vi.mock('./paperIccEngine', () => ({ createRgbToCmykTransform: vi.fn() }));
vi.mock('./paperPdfxPipeline', () => ({ exportPaperDocumentToPdfx: mocks.exportPdfx }));
vi.mock('./paperManagedIccProfiles', () => ({ resolveExactPaperOutputProfile: mocks.resolveProfile }));
vi.mock('../features/paper/assets/PaperAssetRuntime', () => ({
  buildPaperDocumentExactManagedFontOutput: mocks.exact,
  materializePaperDocumentAssetUrls: mocks.materialize,
  paperAssetRepository: { get: vi.fn() },
}));
vi.mock('../store/sourceBinStore', () => ({
  useSourceBinStore: { getState: () => ({ getAllItems: () => mocks.sourceItems }) },
}));

import { exportPaperDocumentToPdfxInBrowser } from './paperPdfxBrowser';

describe('exportPaperDocumentToPdfxInBrowser placed-document boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sourceItems = [];
    mocks.exact.mockImplementation(async (document) => ({ document, compositionDocument: document }));
  });

  it('returns the same typed capability outcome before profile/materialization/raster work', async () => {
    const base = createDefaultPaperDocument({ title: 'PDF/X placed PDF boundary' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'document', label: 'Press reference.pdf', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
      asset: { label: 'Press reference.pdf', kind: 'document', mimeType: 'application/pdf', locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' } },
    });

    await expect(exportPaperDocumentToPdfxInBrowser(document, { standard: 'pdf-x-4' })).rejects.toThrow(PaperPlacedDocumentRasterizationError);
    expect(mocks.resolveProfile).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
    expect(mocks.buildPage).not.toHaveBeenCalled();
    expect(mocks.rasterize).not.toHaveBeenCalled();
    expect(mocks.exportPdfx).not.toHaveBeenCalled();
  });

  it('blocks a linked frame whose current Source Library item is now a PDF before profile or materialization work', async () => {
    mocks.sourceItems = [{
      id: 'replaced', label: 'Panel art', kind: 'document', mimeType: 'application/pdf',
      assetUrl: 'blob:https://app.test/replaced-pdf', createdAt: 1,
    }];
    const base = createDefaultPaperDocument({ title: 'Current source PDF boundary' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Panel art', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
      asset: { sourceBinItemId: 'replaced', label: 'panel.png', kind: 'image', mimeType: 'image/png' },
    });

    await expect(exportPaperDocumentToPdfxInBrowser(document, { standard: 'pdf-x-4' })).rejects.toThrow(PaperPlacedDocumentRasterizationError);
    expect(mocks.resolveProfile).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
    expect(mocks.exportPdfx).not.toHaveBeenCalled();
  });

  it('does not falsely block stale persisted PDF metadata when the current linked item is an image', async () => {
    mocks.sourceItems = [{
      id: 'replaced', label: 'Reference art', kind: 'image', mimeType: 'image/png',
      assetUrl: 'blob:https://app.test/current-image', createdAt: 1,
    }];
    const base = createDefaultPaperDocument({ title: 'Current source image pass' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'document', label: 'Reference.pdf', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
      asset: { sourceBinItemId: 'replaced', label: 'Reference.pdf', kind: 'document', mimeType: 'application/pdf' },
    });
    mocks.resolveProfile.mockResolvedValue({ status: 'ready', bytes: new Uint8Array([1]) });
    mocks.materialize.mockResolvedValue(document);
    const exported = { bytes: new Uint8Array([2]) };
    mocks.exportPdfx.mockResolvedValue(exported);

    await expect(exportPaperDocumentToPdfxInBrowser(document, { standard: 'pdf-x-4' })).resolves.toBe(exported);
    expect(mocks.materialize).toHaveBeenCalledWith(document, [{
      id: 'replaced', mimeType: 'image/png',
      assetUrl: 'blob:https://app.test/current-image', createdAt: 1,
    }]);
    expect(mocks.exportPdfx).toHaveBeenCalledTimes(1);
  });

  it('keeps browser font aliases out of native PDF/X composition', async () => {
    const document = createDefaultPaperDocument({ title: 'Split exact font projections' });
    const browserDocument = { ...document, title: 'Browser aliases' };
    const compositionDocument = { ...document, title: 'Native family identities' };
    const exported = { bytes: new Uint8Array([9]) };
    mocks.resolveProfile.mockResolvedValue({ status: 'ready', bytes: new Uint8Array([1]) });
    mocks.materialize.mockResolvedValue(document);
    mocks.exact.mockResolvedValue({ document: browserDocument, compositionDocument, fontFaceCss: '@font-face{}' });
    mocks.exportPdfx.mockResolvedValue(exported);

    await expect(exportPaperDocumentToPdfxInBrowser(document, { standard: 'pdf-x-4' })).resolves.toBe(exported);

    expect(mocks.exportPdfx.mock.calls[0]?.[0]).toBe(compositionDocument);
    expect(mocks.exportPdfx.mock.calls[0]?.[0]).not.toBe(browserDocument);
  });

  it('rejects a same-id same-MIME URL replacement that lands during materialization', async () => {
    mocks.sourceItems = [{
      id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
      assetUrl: 'blob:https://app.test/old-image', createdAt: 1,
    }];
    const base = createDefaultPaperDocument({ title: 'PDF/X revision race' });
    const document = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
      asset: { sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png' },
    }).document;
    mocks.resolveProfile.mockResolvedValue({ status: 'ready', bytes: new Uint8Array([1]) });
    mocks.materialize.mockImplementationOnce(async () => {
      mocks.sourceItems = [{
        id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
        assetUrl: 'blob:https://app.test/new-image', createdAt: 1,
      }];
      return document;
    });

    await expect(exportPaperDocumentToPdfxInBrowser(document, { standard: 'pdf-x-4' }))
      .rejects.toThrow(/changed while this output was being prepared/i);
    expect(mocks.exportPdfx).not.toHaveBeenCalled();
    expect(mocks.buildPage).not.toHaveBeenCalled();
  });
});
