import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addFrameToPaperPage,
  createDefaultPaperDocument,
  updatePaperDocumentSetup,
} from './paperDocument';
import {
  buildFlattenedPaperPageSourcePayload,
  buildFlattenedPaperPageSvgExport,
  buildRasterizedPaperPageSourcePayload,
  buildFlattenedPaperPageSvgExportWithEmbeddedAssets,
  getPaperPageExportDimensions,
  publishRasterizedPaperPageSourcePayload,
  publishRasterizedPaperPagesSourcePayloads,
  rasterizeFlattenedPaperPageToPng,
} from './paperPageFlattenExport';
import type { BinaryAssetId } from '../shared/assets/contentAddressedAsset';
import type { PaperManagedFontFace } from '../types/paper';
import {
  aliasPaperDocumentManagedFontFamilies,
  buildExactPaperManagedFontCss,
  PaperExactManagedFontError,
  readPaperManagedFontManifest,
} from './paperExactManagedFonts';

afterEach(() => {
  vi.unstubAllGlobals();
});

function exactFace(): PaperManagedFontFace {
  const sha256 = 'c'.repeat(64);
  return {
    id: 'source-exact', familyId: 'source-exact', familyName: 'Source Exact', postscriptName: 'SourceExact-Regular',
    weight: 400, style: 'normal', stretchPercent: 100, collectionIndex: 0, variableAxes: {}, unicodeRanges: [],
    format: 'truetype', fontAsset: { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 3 },
    embeddability: 'installable', canSubset: true, source: { kind: 'user-import' }, license: {},
  };
}

describe('paperPageFlattenExport', () => {
  it('decodes flattened SVGs from their data URL so foreignObject canvases stay origin-clean', async () => {
    const imageSources: string[] = [];
    class MockImage {
      decoding = '';
      private source = '';

      get src() {
        return this.source;
      }

      set src(value: string) {
        this.source = value;
        imageSources.push(value);
      }

      decode() {
        return Promise.resolve();
      }
    }
    const createObjectURL = vi.fn(() => 'blob:flattened-paper-page');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const context = { drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,page'),
    };
    const browserDocument = {
      createElement: vi.fn(() => canvas),
    } as unknown as Document;

    await rasterizeFlattenedPaperPageToPng({
      pageId: 'page-1',
      pageNumber: 1,
      label: 'Large image page',
      mimeType: 'image/svg+xml',
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject>${'x'.repeat(1024)}</foreignObject></svg>`,
      dataUrl: 'data:image/svg+xml;charset=utf-8,oversized',
      widthMm: 210,
      heightMm: 297,
      widthPx: 1600,
      heightPx: 2263,
      scale: 2,
      includeBleed: false,
    }, browserDocument);

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(imageSources).toEqual(['data:image/svg+xml;charset=utf-8,oversized']);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('blocks an isolated SVG before decode when an exact managed alias did not load', async () => {
    const image = vi.fn();
    vi.stubGlobal('Image', class { decoding = ''; set src(_value: string) { image(); } decode() { return Promise.resolve(); } });
    const css = await buildExactPaperManagedFontCss([exactFace()], async () => Uint8Array.from([1, 2, 3]));
    const alias = readPaperManagedFontManifest(css)?.faces[0].familyAlias;
    const browserDocument = {
      fonts: { ready: Promise.resolve(), load: async () => new Set(), check: () => false },
      createElement: vi.fn(),
    } as unknown as Document;
    await expect(rasterizeFlattenedPaperPageToPng({
      pageId: 'page-1', pageNumber: 1, label: 'Exact page', mimeType: 'image/svg+xml',
      svg: `<svg><style>${css}</style><text>${alias}</text></svg>`, dataUrl: 'data:image/svg+xml,exact', exactManagedFontCss: css,
      widthMm: 10, heightMm: 10, widthPx: 10, heightPx: 10, scale: 1, includeBleed: false,
    }, browserDocument)).rejects.toThrow(/requested identity|did not load/i);
    expect(image).not.toHaveBeenCalled();
  });

  it('allows a page to embed a complete-document font payload containing an unused face', async () => {
    const regular = exactFace();
    const italic: PaperManagedFontFace = {
      ...exactFace(),
      id: 'source-exact-italic',
      postscriptName: 'SourceExact-Italic',
      style: 'italic',
      fontAsset: {
        ...exactFace().fontAsset,
        id: `sha256:${'d'.repeat(64)}` as BinaryAssetId,
        sha256: 'd'.repeat(64),
      },
    };
    const css = await buildExactPaperManagedFontCss([regular, italic], async () => Uint8Array.from([1, 2, 3]));
    const manifest = readPaperManagedFontManifest(css)!;
    const usedAlias = manifest.faces.find((face) => face.style === 'normal')!.familyAlias;
    const loadedFaces = new Set(manifest.faces.map((face) => ({ family: face.familyAlias, status: 'loaded' })));
    vi.stubGlobal('Image', class { decoding = ''; src = ''; decode() { return Promise.resolve(); } });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toDataURL: vi.fn(() => 'data:image/png;base64,page'),
    };
    const browserDocument = {
      fonts: { ready: Promise.resolve(), load: async () => loadedFaces, check: () => true },
      createElement: vi.fn(() => canvas),
    } as unknown as Document;

    await expect(rasterizeFlattenedPaperPageToPng({
      pageId: 'page-1', pageNumber: 1, label: 'Exact page', mimeType: 'image/svg+xml',
      svg: `<svg><style>${css}</style><text style="font-family: &quot;${usedAlias}&quot;">Exact</text></svg>`,
      dataUrl: 'data:image/svg+xml,exact', exactManagedFontCss: css,
      widthMm: 10, heightMm: 10, widthPx: 10, heightPx: 10, scale: 1, includeBleed: false,
    }, browserDocument)).resolves.toEqual(expect.objectContaining({ mimeType: 'image/png' }));
  });

  it('blocks a page body that requests an alias absent from its embedded manifest', async () => {
    const css = await buildExactPaperManagedFontCss([exactFace()], async () => Uint8Array.from([1, 2, 3]));
    const manifest = readPaperManagedFontManifest(css)!;
    const loadedFaces = new Set(manifest.faces.map((face) => ({ family: face.familyAlias, status: 'loaded' })));
    const image = vi.fn();
    vi.stubGlobal('Image', class { decoding = ''; set src(_value: string) { image(); } decode() { return Promise.resolve(); } });
    const browserDocument = {
      fonts: { ready: Promise.resolve(), load: async () => loadedFaces, check: () => true },
      createElement: vi.fn(),
    } as unknown as Document;

    await expect(rasterizeFlattenedPaperPageToPng({
      pageId: 'page-1', pageNumber: 1, label: 'Undeclared page', mimeType: 'image/svg+xml',
      svg: `<svg><style>${css}</style><text style="font-family: &quot;sloom-managed-not-declared-0000000000000000&quot;">Wrong</text></svg>`,
      dataUrl: 'data:image/svg+xml,undeclared', exactManagedFontCss: css,
      widthMm: 10, heightMm: 10, widthPx: 10, heightPx: 10, scale: 1, includeBleed: false,
    }, browserDocument)).rejects.toThrow(/requests undeclared managed alias/i);
    expect(image).not.toHaveBeenCalled();
  });

  it('keeps Source Library publication side-effect free when exact readiness rejects', async () => {
    const managed = exactFace();
    let sourceDocument = createDefaultPaperDocument({ title: 'Exact Source' });
    sourceDocument = addFrameToPaperPage(sourceDocument, sourceDocument.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 60, heightMm: 20, text: 'Exact source asset',
      typography: { fontFamily: managed.familyName, fontWeight: '400' },
    }).document;
    sourceDocument.importedFonts = [managed];
    const outputDocument = aliasPaperDocumentManagedFontFamilies(sourceDocument);
    const css = await buildExactPaperManagedFontCss([managed], async () => Uint8Array.from([1, 2, 3]));
    const browserDocument = {
      fonts: { ready: Promise.resolve(), load: async () => new Set(), check: () => false },
      createElement: vi.fn(),
    } as unknown as Document;
    const publish = vi.fn(async () => ({ id: 'must-not-exist' }));

    await expect(publishRasterizedPaperPageSourcePayload(
      outputDocument,
      outputDocument.pages[0].id,
      { fontFaceCss: css, browserDocument },
      publish,
    )).rejects.toBeInstanceOf(PaperExactManagedFontError);
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns a typed actionable error and publishes nothing when page SVG decode rejects', async () => {
    vi.stubGlobal('Image', class {
      decoding = '';
      src = '';
      decode() { return Promise.reject(new Error('hostile SVG decode')); }
    });
    const outputDocument = createDefaultPaperDocument({ title: 'Decode Failure' });
    const publish = vi.fn(async () => ({ id: 'must-not-exist' }));

    await expect(publishRasterizedPaperPageSourcePayload(
      outputDocument,
      outputDocument.pages[0].id,
      { browserDocument: { createElement: vi.fn() } as unknown as Document },
      publish,
    )).rejects.toMatchObject({
      name: 'PaperPageOutputError',
      code: 'PAPER_PAGE_OUTPUT_FAILED',
      message: expect.stringMatching(/no Source Library or Video asset was published.*hostile SVG decode/i),
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('preserves the typed placed-document error contract through the rasterized payload builder', async () => {
    const doc = createDefaultPaperDocument({ title: 'Placed PDF payload' });
    const pageId = doc.pages[0].id;
    const { document: withPdf } = addFrameToPaperPage(doc, pageId, {
      kind: 'document', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
      asset: {
        label: 'spec.pdf',
        kind: 'document',
        mimeType: 'application/pdf',
        locator: { kind: 'external', url: 'data:application/pdf;base64,AAAA' },
      },
    });

    await expect(buildRasterizedPaperPageSourcePayload(withPdf, pageId, {
      browserDocument: { createElement: vi.fn() } as unknown as Document,
    })).rejects.toMatchObject({
      name: 'PaperPlacedDocumentRasterizationError',
      code: 'paper-placed-document-rasterization-unsupported',
      issues: [expect.objectContaining({
        code: 'paper-placed-document-rasterization-unsupported',
        pageNumber: 1,
        frameLabel: 'spec.pdf',
        isPdf: true,
      })],
    });
  });

  it('publishes nothing and keeps the placed-document code/issues on the publish path', async () => {
    const doc = createDefaultPaperDocument({ title: 'Placed PDF publish' });
    const pageId = doc.pages[0].id;
    const { document: withPdf } = addFrameToPaperPage(doc, pageId, {
      kind: 'document', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
      asset: {
        label: 'insert.pdf',
        kind: 'document',
        mimeType: 'application/pdf',
        locator: { kind: 'external', url: 'data:application/pdf;base64,AAAA' },
      },
    });
    const publish = vi.fn(async () => ({ id: 'must-not-exist' }));

    await expect(publishRasterizedPaperPageSourcePayload(withPdf, pageId, {
      browserDocument: { createElement: vi.fn() } as unknown as Document,
    }, publish)).rejects.toMatchObject({
      code: 'paper-placed-document-rasterization-unsupported',
      message: expect.stringMatching(/cannot rasterize|replace it with a raster image/i),
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('prepares every page before publishing a multi-page Source Library envelope', async () => {
    let decodeCount = 0;
    vi.stubGlobal('Image', class {
      decoding = '';
      src = '';
      decode() {
        decodeCount += 1;
        return decodeCount === 2 ? Promise.reject(new Error('page two decode failed')) : Promise.resolve();
      }
    });
    const first = createDefaultPaperDocument({ title: 'Atomic Pages' });
    const outputDocument = {
      ...first,
      pages: [first.pages[0], { ...first.pages[0], id: 'page-2', pageNumber: 2 }],
    };
    const context = { drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,page'),
    };
    const browserDocument = { createElement: vi.fn(() => canvas) } as unknown as Document;
    const publish = vi.fn(async () => ({ id: 'must-not-exist' }));

    await expect(publishRasterizedPaperPagesSourcePayloads(
      outputDocument,
      outputDocument.pages.map((page, envelopeIndex) => ({
        pageId: page.id,
        options: { browserDocument, envelopeId: 'atomic-envelope', envelopeIndex },
      })),
      publish,
    )).rejects.toMatchObject({ code: 'PAPER_PAGE_OUTPUT_FAILED' });

    expect(decodeCount).toBe(2);
    expect(publish).not.toHaveBeenCalled();
  });

  it('escapes quoted font-family values so the flattened SVG stays valid XML', () => {
    const doc = createDefaultPaperDocument({ title: 'Quoted font family' });
    const pageId = doc.pages[0].id;
    const { document: withFrame } = addFrameToPaperPage(doc, pageId, {
      kind: 'caption',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 30,
      text: 'XML-safe typography',
      typography: { fontFamily: 'Arial, "Liberation Sans", sans-serif' },
    });

    const exported = buildFlattenedPaperPageSvgExport(withFrame, pageId);

    expect(exported.svg).toContain('font-family: Arial, &quot;Liberation Sans&quot;, sans-serif');
  });

  it('builds a selected-page SVG export at document DPI with bleed included', () => {
    let doc = updatePaperDocumentSetup(createDefaultPaperDocument({
      title: 'Issue 01',
      preset: 'custom',
      dpi: 300,
    }), {
      widthMm: 100,
      heightMm: 150,
      bleedMm: 5,
      background: {
        type: 'linear-gradient',
        fromColor: '#fef3c7',
        toColor: '#67e8f9',
        angleDeg: 135,
      },
    });
    const firstPageId = doc.pages[0].id;
    doc = addFrameToPaperPage(doc, firstPageId, {
      kind: 'caption',
      xMm: 10,
      yMm: 12,
      widthMm: 80,
      heightMm: 20,
      text: 'First page only',
    }).document;

    const second = addFrameToPaperPage({ ...doc, pages: [...doc.pages, { ...doc.pages[0], id: 'page-2', pageNumber: 2, frames: [] }] }, 'page-2', {
      kind: 'caption',
      xMm: 10,
      yMm: 12,
      widthMm: 80,
      heightMm: 20,
      text: 'Second page hidden',
    }).document;

    const exported = buildFlattenedPaperPageSvgExport(second, firstPageId);

    expect(exported.label).toBe('Issue 01 - Page 1');
    expect(exported.mimeType).toBe('image/svg+xml');
    expect(exported.widthPx).toBe(1299);
    expect(exported.heightPx).toBe(1890);
    expect(exported.svg).toContain('foreignObject');
    expect(exported.svg).toContain('linear-gradient(135deg, #fef3c7, #67e8f9)');
    expect(exported.svg).toContain('First page only');
    expect(exported.svg).not.toContain('Second page hidden');
    expect(exported.dataUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });

  it('can build source-library payloads with envelope metadata for flattened page groups', () => {
    const doc = createDefaultPaperDocument({ title: 'Manga Layout', preset: 'manga-digest', dpi: 600 });
    const payload = buildFlattenedPaperPageSourcePayload(doc, doc.pages[0].id, {
      envelopeId: 'paper-envelope-1',
      envelopeLabel: 'Chapter 3 pages',
      envelopeIndex: 2,
    });

    expect(payload).toMatchObject({
      label: 'Manga Layout - Page 1',
      kind: 'image',
      mimeType: 'image/svg+xml',
      envelopeId: 'paper-envelope-1',
      envelopeLabel: 'Chapter 3 pages',
      envelopeIndex: 2,
    });
    expect(payload.dataUrl).toContain('data:image/svg+xml');
  });

  it('produces a stable per-page sourceKey so re-sending the same page replaces rather than duplicates the library item', () => {
    const doc = createDefaultPaperDocument({ title: 'Motion Comic', preset: 'comic-book', dpi: 300 });
    const pageId = doc.pages[0].id;

    const first = buildFlattenedPaperPageSourcePayload(doc, pageId);
    const second = buildFlattenedPaperPageSourcePayload(doc, pageId, {
      envelopeId: 'paper-envelope-9',
      envelopeLabel: 'Chapter pages',
      envelopeIndex: 0,
    });

    expect(first.sourceKey).toMatch(new RegExp(`^paper-page:${doc.id}:${pageId}:\\d+x\\d+:(bleed|trim)$`));
    // Identity is anchored on the document/page (not envelope grouping), so the
    // dedupe key stays constant across re-exports and addAssetItem replaces in place.
    expect(second.sourceKey).toBe(first.sourceKey);
  });

  it('can inline placed image assets before building the flattened SVG snapshot', async () => {
    const doc = createDefaultPaperDocument({ title: 'Inline Assets' });
    const pageId = doc.pages[0].id;
    const { document: withImage, frameId } = addFrameToPaperPage(doc, pageId, {
      kind: 'image',
      xMm: 10,
      yMm: 20,
      widthMm: 40,
      heightMm: 30,
      label: 'Blob-backed panel',
    });
    const sourceDoc = {
      ...withImage,
      pages: withImage.pages.map((page) => page.id === pageId
        ? {
            ...page,
            frames: page.frames.map((frame) => frame.id === frameId
              ? {
                  ...frame,
                  asset: {
                    sourceBinItemId: 'image-1',
                    label: 'Blob-backed panel',
                    kind: 'image' as const,
                    locator: { kind: 'external' as const, url: 'blob:http://127.0.0.1:5175/panel-art' },
                    mimeType: 'image/png',
                  },
                }
              : frame),
          }
        : page),
    };

    const exported = await buildFlattenedPaperPageSvgExportWithEmbeddedAssets(sourceDoc, pageId, {
      resolveImageSrc: async (src) => src === 'blob:http://127.0.0.1:5175/panel-art'
        ? 'data:image/png;base64,embedded'
        : src,
    });

    expect(exported.svg).toContain('data:image/png;base64,embedded');
    expect(exported.svg).not.toContain('blob:http://127.0.0.1:5175/panel-art');
  });

  it('pre-decodes embedded artwork before wrapping it in the foreignObject page SVG', async () => {
    let finishDecode: (() => void) | undefined;
    const decoded = new Promise<void>((resolve) => { finishDecode = resolve; });
    const imageSources: string[] = [];
    class MockImage {
      decoding = '';
      set src(value: string) { imageSources.push(value); }
      decode() { return decoded; }
    }
    vi.stubGlobal('Image', MockImage);
    const doc = createDefaultPaperDocument({ title: 'Decoded Assets' });
    const pageId = doc.pages[0].id;
    const placed = addFrameToPaperPage(doc, pageId, {
      kind: 'image', xMm: 10, yMm: 20, widthMm: 40, heightMm: 30, label: 'Hero artwork',
    });
    const sourceDoc = {
      ...placed.document,
      pages: placed.document.pages.map((page) => page.id === pageId
        ? {
            ...page,
            frames: page.frames.map((frame) => frame.id === placed.frameId
              ? {
                  ...frame,
                  asset: {
                    label: 'Hero artwork',
                    kind: 'image' as const,
                    locator: { kind: 'external' as const, url: 'blob:hero-artwork' },
                    mimeType: 'image/png',
                  },
                }
              : frame),
          }
        : page),
    };
    let settled = false;
    const exportPromise = buildFlattenedPaperPageSvgExportWithEmbeddedAssets(sourceDoc, pageId, {
      resolveImageSrc: () => 'data:image/png;base64,hero',
    }).then((value) => {
      settled = true;
      return value;
    });

    await Promise.resolve();
    expect(imageSources).toEqual(['data:image/png;base64,hero']);
    expect(settled).toBe(false);
    finishDecode?.();
    const exported = await exportPromise;
    expect(exported.svg).toContain('data:image/png;base64,hero');
  });

  it('fails instead of silently replacing an unmaterialized managed image with its frame fill', async () => {
    const doc = createDefaultPaperDocument({ title: 'Managed artwork must render' });
    const pageId = doc.pages[0].id;
    const placed = addFrameToPaperPage(doc, pageId, {
      kind: 'image', xMm: 10, yMm: 20, widthMm: 40, heightMm: 30, label: 'Managed hero',
    });
    const sha256 = 'a'.repeat(64);
    const sourceDoc = {
      ...placed.document,
      pages: placed.document.pages.map((page) => page.id === pageId
        ? {
            ...page,
            frames: page.frames.map((frame) => frame.id === placed.frameId
              ? {
                  ...frame,
                  asset: {
                    label: 'Managed hero',
                    kind: 'image' as const,
                    locator: {
                      kind: 'managed' as const,
                      ref: {
                        id: `sha256:${sha256}` as BinaryAssetId,
                        sha256,
                        mimeType: 'image/png',
                        byteLength: 4,
                      },
                    },
                  },
                }
              : frame),
          }
        : page),
    };

    await expect(buildFlattenedPaperPageSvgExportWithEmbeddedAssets(sourceDoc, pageId, {
      resolveImageSrc: vi.fn(),
    })).rejects.toThrow(/Managed hero.*materialized/i);
  });

  it('does not bake screen-only margin guides into flattened page snapshots', () => {
    const doc = createDefaultPaperDocument({
      title: 'Clean Snapshot',
      preset: 'comic-book',
      dpi: 300,
    });

    const exported = buildFlattenedPaperPageSvgExport(doc, doc.pages[0].id, {
      includeBleed: false,
    });

    expect(exported.svg).not.toContain('.paper-page::after');
    expect(exported.svg).not.toContain('rgba(6, 182, 212');
  });

  it('excludes only the named text frames from the raster (keeps display-font frames baked in)', () => {
    const base = createDefaultPaperDocument({ title: 'Mixed', preset: 'comic-book', dpi: 150 });
    const pageId = base.pages[0].id;
    const withBody = addFrameToPaperPage(base, pageId, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 60, heightMm: 20, text: 'SELECTABLE-BODY',
      typography: { fontFamily: 'Georgia', color: '#111111' },
    }).document;
    const withSfx = addFrameToPaperPage(withBody, pageId, {
      kind: 'caption', xMm: 10, yMm: 60, widthMm: 60, heightMm: 20, text: 'RASTER-SFX',
      typography: { fontFamily: 'Impact, Haettenschweiler, sans-serif', color: '#111111' },
    }).document;
    const bodyId = withSfx.pages[0].frames.find((frame) => frame.text === 'SELECTABLE-BODY')!.id;

    // The vectorized body frame is dropped from the raster; the display SFX frame stays baked in.
    const exported = buildFlattenedPaperPageSvgExport(withSfx, pageId, { excludeTextFrameIds: [bodyId] });
    expect(exported.svg).not.toContain('SELECTABLE-BODY');
    expect(exported.svg).toContain('RASTER-SFX');

    // With no exclusion both are present (default full raster).
    const full = buildFlattenedPaperPageSvgExport(withSfx, pageId);
    expect(full.svg).toContain('SELECTABLE-BODY');
    expect(full.svg).toContain('RASTER-SFX');
  });

  it('renders only a requested flatten group without repainting native siblings or the page background', () => {
    let document = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Flatten group only' }), {
      background: { type: 'solid', color: '#1a2b3c' },
    });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 60, heightMm: 20, text: 'NATIVE-ONLY',
    }).document;
    const flattened = addFrameToPaperPage(document, pageId, {
      kind: 'caption', xMm: 10, yMm: 40, widthMm: 60, heightMm: 20, text: 'FLATTEN-ONLY',
    });

    const exported = buildFlattenedPaperPageSvgExport(flattened.document, pageId, {
      renderFrameIds: [flattened.frameId],
      includePageBackground: false,
    });

    expect(exported.svg).toContain('FLATTEN-ONLY');
    expect(exported.svg).not.toContain('NATIVE-ONLY');
    expect(exported.svg).not.toContain('#1a2b3c');
    expect(exported.svg).toContain('background:transparent');
  });

  it('knocks the fill out of excludeFrameFillIds frames (spot fill drawn as a plate on top)', () => {
    const base = createDefaultPaperDocument({ title: 'SpotKnock', preset: 'comic-book', dpi: 150 });
    const pageId = base.pages[0].id;
    const added = addFrameToPaperPage(base, pageId, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 60, heightMm: 20, text: 'ON-SPOT', fillColor: '#e30613',
    });
    const frameId = added.frameId;

    // Full raster keeps the fill colour; the knockout removes it (paper) but keeps the frame's text.
    expect(buildFlattenedPaperPageSvgExport(added.document, pageId).svg).toContain('#e30613');
    const knocked = buildFlattenedPaperPageSvgExport(added.document, pageId, { excludeFrameFillIds: [frameId] });
    expect(knocked.svg).not.toContain('#e30613');
    expect(knocked.svg).toContain('ON-SPOT');
  });

  it('can compute export dimensions with or without bleed', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ preset: 'custom', dpi: 300 }), {
      widthMm: 25.4,
      heightMm: 50.8,
      bleedMm: 3,
    });

    expect(getPaperPageExportDimensions(doc, { includeBleed: true })).toMatchObject({
      widthPx: 371,
      heightPx: 671,
      widthMm: 31.4,
      heightMm: 56.8,
    });
    expect(getPaperPageExportDimensions(doc, { includeBleed: false })).toMatchObject({
      widthPx: 300,
      heightPx: 600,
      widthMm: 25.4,
      heightMm: 50.8,
    });
  });

  it('expands an explicitly marked print raster while keeping isolated PDF/X rasters mark-free by default', () => {
    const doc = updatePaperDocumentSetup(createDefaultPaperDocument({ preset: 'custom', dpi: 300 }), {
      widthMm: 100,
      heightMm: 150,
      bleedMm: 3,
      printProduction: { marks: { cropMarks: true, slugAreaMm: 12 } },
    });

    expect(getPaperPageExportDimensions(doc, { includeBleed: true })).toMatchObject({ widthMm: 106, heightMm: 156 });
    expect(getPaperPageExportDimensions(doc, { includeBleed: true, includeProductionMarks: true })).toMatchObject({
      widthMm: 120,
      heightMm: 182,
    });
    const marked = buildFlattenedPaperPageSvgExport(doc, doc.pages[0].id, {
      includeBleed: true,
      includeProductionMarks: true,
    });
    expect(marked.svg.match(/data-production-mark=/g)).toHaveLength(8);
    expect(marked.svg).toContain('data-slug-area-mm="12"');
  });

  // The PNG/webcomic/KDP raster export and the PDF/X raster backdrop all rasterize this same flattened-page
  // SVG (it embeds the print HTML in a <foreignObject>) — so proving richText survives HERE proves it for
  // every raster consumer, not just one format. See docs/notes/850-paper-rich-text.md task #56 and
  // paperPdfxVectorTextFrames.ts's "falls back to raster, where the HTML print render draws every run
  // correctly" comment — a claim that only became true once renderPrintFrame actually consumed richText.
  it('bakes rich-text run styling and paragraph formatting into the flattened page SVG', () => {
    const doc = createDefaultPaperDocument({ title: 'Rich Raster Export', preset: 'comic-book' });
    const pageId = doc.pages[0].id;
    const { document: withFrame } = addFrameToPaperPage(doc, pageId, {
      kind: 'text',
      xMm: 15,
      yMm: 15,
      widthMm: 80,
      heightMm: 40,
      richText: [
        { runs: [{ text: 'Plain ' }, { text: 'bold', fontWeight: '700' }] },
      ],
    });

    const exported = buildFlattenedPaperPageSvgExport(withFrame, pageId);

    expect(exported.mimeType).toBe('image/svg+xml');
    expect(exported.svg).toContain('<span style="font-weight: 700">bold</span>');
    expect(exported.svg).toContain('<span>Plain </span>');
  });

  it('produces raster HTML that differs from the plain-text-only rendering of the same words', () => {
    const richDoc = createDefaultPaperDocument({ title: 'Rich vs Plain A', preset: 'comic-book' });
    const richPageId = richDoc.pages[0].id;
    const { document: withRichFrame } = addFrameToPaperPage(richDoc, richPageId, {
      kind: 'text',
      xMm: 15,
      yMm: 15,
      widthMm: 80,
      heightMm: 40,
      richText: [{ runs: [{ text: 'Plain ' }, { text: 'bold', fontWeight: '700' }] }],
    });

    const plainDoc = createDefaultPaperDocument({ title: 'Rich vs Plain B', preset: 'comic-book' });
    const plainPageId = plainDoc.pages[0].id;
    const { document: withPlainFrame } = addFrameToPaperPage(plainDoc, plainPageId, {
      kind: 'text',
      xMm: 15,
      yMm: 15,
      widthMm: 80,
      heightMm: 40,
      // Same flattened characters a rich frame's `text` mirror would carry, but authored as plain text
      // (no richText) — this is what the bug used to render for BOTH cases (rich text silently flattened).
      text: 'Plain bold',
    });

    const richExport = buildFlattenedPaperPageSvgExport(withRichFrame, richPageId);
    const plainExport = buildFlattenedPaperPageSvgExport(withPlainFrame, plainPageId);

    // The rich export carries real per-run styling; the plain export never does — so the two rasters differ.
    expect(richExport.svg).not.toBe(plainExport.svg);
    expect(richExport.svg).toContain('font-weight: 700');
    expect(plainExport.svg).not.toContain('font-weight: 700');
  });

  it('keeps a plain-text frame\'s flattened export unchanged when richText is absent (regression)', () => {
    const doc = createDefaultPaperDocument({ title: 'Plain Raster Regression', preset: 'comic-book' });
    const pageId = doc.pages[0].id;
    const { document: withFrame } = addFrameToPaperPage(doc, pageId, {
      kind: 'text',
      xMm: 15,
      yMm: 15,
      widthMm: 80,
      heightMm: 40,
      text: 'Plain frame, no rich runs.',
    });

    const exported = buildFlattenedPaperPageSvgExport(withFrame, pageId);

    expect(exported.svg).toContain('<div class="frame-text-content" style="">Plain frame, no rich runs.</div>');
    expect(exported.svg).not.toContain('class="paper-dropcap"');
  });

  it('keeps a plain-text frame drop cap in flattened page output', () => {
    const doc = createDefaultPaperDocument({ title: 'Plain Raster Drop Cap', preset: 'comic-book' });
    const { document: withFrame } = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'text',
      xMm: 15,
      yMm: 15,
      widthMm: 80,
      heightMm: 40,
      text: 'The opening letter spans three lines.',
      typography: { dropCapLines: 3 },
    });

    const exported = buildFlattenedPaperPageSvgExport(withFrame, withFrame.pages[0].id);

    expect(exported.svg).toContain('class="paper-dropcap"');
    expect(exported.svg).toContain('--sl-dropcap-lines: 3');
  });
});
