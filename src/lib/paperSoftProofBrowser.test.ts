import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { PaperPlacedDocumentRasterizationError } from './paperPlacedDocumentRasterization';

const mocks = vi.hoisted(() => ({
  buildPage: vi.fn(),
  exact: vi.fn(),
  createProof: vi.fn(),
  materialize: vi.fn(),
  rasterize: vi.fn(),
  resolveProfile: vi.fn(),
  softProof: vi.fn(),
  sourceItems: [] as Array<{ id: string; label: string; kind: string; mimeType?: string; assetUrl?: string; createdAt: number }>,
}));

vi.mock('./paperPageFlattenExport', () => ({
  buildFlattenedPaperPageSvgExportWithEmbeddedAssets: mocks.buildPage,
  imageSourceToDataUrl: vi.fn(),
  rasterizeFlattenedPaperPageToRgba: mocks.rasterize,
}));
vi.mock('./paperIccEngine', () => ({ createSoftProofTransform: mocks.createProof }));
vi.mock('./paperManagedIccProfiles', () => ({ resolveExactPaperOutputProfile: mocks.resolveProfile }));
vi.mock('./paperSoftProofImage', () => ({ softProofRgba: mocks.softProof }));
vi.mock('../features/paper/assets/PaperAssetRuntime', () => ({
  buildPaperDocumentExactManagedFontOutput: mocks.exact,
  materializePaperDocumentAssetUrls: mocks.materialize,
  paperAssetRepository: { get: vi.fn() },
}));
vi.mock('../store/sourceBinStore', () => ({
  useSourceBinStore: { getState: () => ({ getAllItems: () => mocks.sourceItems }) },
}));

import { softProofPaperPageInBrowser } from './paperSoftProofBrowser';
import { getPaperResourceCleanupError } from './paperColorManagement';

describe('softProofPaperPageInBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sourceItems = [];
    mocks.resolveProfile.mockResolvedValue({ status: 'ready', bytes: new Uint8Array([1, 2, 3]) });
    mocks.createProof.mockResolvedValue({ profileName: 'FOGRA39L Coated', dispose: vi.fn() });
    mocks.exact.mockImplementation(async (document) => ({ document }));
    mocks.buildPage.mockResolvedValue({ widthPx: 1, heightPx: 1 });
    mocks.rasterize.mockResolvedValue({ rgba: new Uint8ClampedArray([20, 30, 40, 255]), widthPx: 1, heightPx: 1 });
    mocks.softProof.mockImplementation((rgba) => rgba);
    const context = {
      createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
      putImageData: vi.fn(),
    };
    vi.stubGlobal('window', {
      document: {
        createElement: vi.fn(() => ({
          width: 0,
          height: 0,
          getContext: vi.fn(() => context),
          toDataURL: vi.fn(() => 'data:image/png;base64,proof'),
        })),
      },
    });
  });

  it('materializes managed artwork before flattening the page for CMYK simulation', async () => {
    const document = createDefaultPaperDocument({ title: 'Managed artwork proof' });
    const materialized = { ...document, title: 'Materialized artwork proof' };
    mocks.materialize.mockResolvedValue(materialized);

    const result = await softProofPaperPageInBrowser(document, document.pages[0].id);

    expect(mocks.materialize).toHaveBeenCalledWith(document, []);
    expect(mocks.exact).toHaveBeenCalledWith(materialized);
    expect(mocks.buildPage).toHaveBeenCalledWith(
      materialized,
      document.pages[0].id,
      expect.objectContaining({ includeBleed: false, outputDpi: 150 }),
    );
    expect(result.dataUrl).toBe('data:image/png;base64,proof');
  });

  it('passes the shared exact managed-font payload into the raster proof', async () => {
    const document = createDefaultPaperDocument();
    mocks.exact.mockResolvedValueOnce({ document, fontFaceCss: '/* exact managed payload */ @font-face{}' });
    await softProofPaperPageInBrowser(document, document.pages[0].id);
    expect(mocks.buildPage.mock.calls[0]?.[2]).toMatchObject({ fontFaceCss: '/* exact managed payload */ @font-face{}' });
  });

  it('returns the shared placed-document capability error before profile, fetch, decode, or raster work', async () => {
    const base = createDefaultPaperDocument({ title: 'Soft proof PDF boundary' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'document', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40, label: 'Proof reference.pdf',
      asset: { label: 'Proof reference.pdf', kind: 'document', mimeType: 'application/pdf', locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' } },
    });

    await expect(softProofPaperPageInBrowser(document, document.pages[0].id)).rejects.toThrow(PaperPlacedDocumentRasterizationError);
    expect(mocks.resolveProfile).not.toHaveBeenCalled();
    expect(mocks.createProof).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
    expect(mocks.buildPage).not.toHaveBeenCalled();
    expect(mocks.rasterize).not.toHaveBeenCalled();
  });

  it('rejects a same-id same-MIME URL replacement that lands during materialization', async () => {
    mocks.sourceItems = [{
      id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
      assetUrl: 'blob:https://app.test/old-image', createdAt: 1,
    }];
    const base = createDefaultPaperDocument({ title: 'Soft-proof revision race' });
    const document = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
      asset: { sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png' },
    }).document;
    mocks.materialize.mockImplementationOnce(async () => {
      mocks.sourceItems = [{
        id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
        assetUrl: 'blob:https://app.test/new-image', createdAt: 1,
      }];
      return document;
    });

    await expect(softProofPaperPageInBrowser(document, document.pages[0].id))
      .rejects.toThrow(/changed while this output was being prepared/i);
    expect(mocks.buildPage).not.toHaveBeenCalled();
    expect(mocks.rasterize).not.toHaveBeenCalled();
  });

  it('releases each owned proof exactly once across repeated successful previews', async () => {
    const document = createDefaultPaperDocument({ title: 'Repeated proof ownership' });
    const proofs: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    mocks.createProof.mockImplementation(async () => {
      const proof = { profileName: 'FOGRA39L Coated', dispose: vi.fn() };
      proofs.push(proof);
      return proof;
    });

    for (let index = 0; index < 4; index += 1) {
      await softProofPaperPageInBrowser(document, document.pages[0].id);
      expect(proofs[index]?.dispose).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['materialize', 'build', 'rasterize', 'proof'] as const)(
    'releases the owned proof when %s fails after transform creation',
    async (step) => {
      const document = createDefaultPaperDocument({ title: `Failed ${step} proof` });
      const failure = new Error(`${step} failed`);
      if (step === 'materialize') mocks.materialize.mockRejectedValueOnce(failure);
      if (step === 'build') mocks.buildPage.mockRejectedValueOnce(failure);
      if (step === 'rasterize') mocks.rasterize.mockRejectedValueOnce(failure);
      if (step === 'proof') mocks.softProof.mockImplementationOnce(() => { throw failure; });

      await expect(softProofPaperPageInBrowser(document, document.pages[0].id)).rejects.toThrow(failure);
      expect(mocks.createProof.mock.results[0]?.value).toBeDefined();
      const proof = await mocks.createProof.mock.results[0]?.value;
      expect(proof.dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves a proof rendering error and retains a proof-dispose failure', async () => {
    const document = createDefaultPaperDocument({ title: 'Proof cleanup error' });
    const workFailure = new Error('raster failed');
    const cleanupFailure = new Error('dispose failed');
    mocks.rasterize.mockRejectedValueOnce(workFailure);
    mocks.createProof.mockResolvedValueOnce({
      profileName: 'FOGRA39L Coated',
      dispose: vi.fn(() => { throw cleanupFailure; }),
    });

    let thrown: unknown;
    try {
      await softProofPaperPageInBrowser(document, document.pages[0].id);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(workFailure);
    expect(getPaperResourceCleanupError(thrown)?.failures).toEqual([cleanupFailure]);
  });
});
