// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addFrameToPaperPage, addPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup } from './paperDocument';
import {
  buildPaperStoryboardPageAssetLabel,
  buildPaperStoryboardPageDescriptors,
  buildPaperStoryboardSourceKey,
  publishPaperStoryboardPageSourcePayloads,
} from './paperVideoAssets';
import type { PaperManagedFontFace } from '../types/paper';
import {
  aliasPaperDocumentManagedFontFamilies,
  buildExactPaperManagedFontCss,
  PaperExactManagedFontError,
} from './paperExactManagedFonts';
import {
  createPaperPlacedDocumentRasterizationGuard,
  type PaperPlacedSourceItem,
} from './paperPlacedDocumentRasterization';
import {
  buildPaperDocumentExactManagedFontOutput,
  materializePaperDocumentAssetUrls,
} from '../features/paper/assets/PaperAssetRuntime';

afterEach(() => {
  Reflect.deleteProperty(document, 'fonts');
  vi.unstubAllGlobals();
});

function exactStoryboardFace(): PaperManagedFontFace {
  const sha256 = 'd'.repeat(64);
  return {
    id: 'storyboard-exact', familyId: 'storyboard-exact', familyName: 'Storyboard Exact', postscriptName: 'StoryboardExact-Regular',
    weight: 400, style: 'normal', stretchPercent: 100, collectionIndex: 0, variableAxes: {}, unicodeRanges: [],
    format: 'truetype', fontAsset: { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 3 },
    embeddability: 'installable', canSubset: true, source: { kind: 'user-import' }, license: {},
  };
}

function linkedTwoPageStoryboardDocument() {
  vi.stubGlobal('Image', class {
    decoding = '';
    src = '';
    decode() { return Promise.resolve(); }
  });
  const context = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => 'data:image/png;base64,cGFnZQ=='),
  };
  const realCreateElement = document.createElement.bind(document);
  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
    tagName === 'canvas' ? canvas as unknown as HTMLElement : realCreateElement(tagName)
  ));

  let storyboardDocument = createDefaultPaperDocument({ title: 'Linked Boards' });
  storyboardDocument = addFrameToPaperPage(storyboardDocument, storyboardDocument.pages[0].id, {
    kind: 'image', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40,
    asset: { sourceBinItemId: 'board-art', label: 'Board art', kind: 'image', mimeType: 'image/png' },
  }).document;
  storyboardDocument = addPaperPage(storyboardDocument);

  return {
    document: storyboardDocument,
    restoreCreateElement: () => createElementSpy.mockRestore(),
  };
}

describe('paperVideoAssets', () => {
  it('describes every Paper page as a stable storyboard image asset', () => {
    let document = createDefaultPaperDocument({ title: 'Opening Boards', preset: 'custom', dpi: 144 });
    document = updatePaperDocumentSetup(document, {
      widthMm: 100,
      heightMm: 50,
      bleedMm: 5,
    });
    document = addPaperPage(document);

    const descriptors = buildPaperStoryboardPageDescriptors(document);

    expect(descriptors).toHaveLength(2);
    expect(descriptors[0]).toMatchObject({
      pageId: document.pages[0].id,
      pageNumber: 1,
      label: 'Opening Boards - Storyboard Page 1',
      envelopeId: `paper-storyboard:${document.id}:567x283:trim`,
      envelopeLabel: 'Opening Boards storyboard pages',
      envelopeIndex: 0,
      sourceKey: `paper-page:${document.id}:${document.pages[0].id}:567x283:trim`,
    });
    expect(descriptors[1]).toMatchObject({
      pageId: document.pages[1].id,
      pageNumber: 2,
      label: 'Opening Boards - Storyboard Page 2',
      envelopeIndex: 1,
    });
  });

  it('uses trim-box source keys by default so video storyboards do not include print bleed', () => {
    const document = updatePaperDocumentSetup(createDefaultPaperDocument({
      title: '',
      preset: 'custom',
      dpi: 300,
    }), {
      widthMm: 25.4,
      heightMm: 50.8,
      bleedMm: 3,
    });

    expect(buildPaperStoryboardPageAssetLabel(document, document.pages[0])).toBe('Paper Layout - Storyboard Page 1');
    expect(buildPaperStoryboardSourceKey(document, document.pages[0].id)).toBe(
      `paper-page:${document.id}:${document.pages[0].id}:300x600:trim`,
    );
    expect(buildPaperStoryboardSourceKey(document, document.pages[0].id, { includeBleed: true })).toBe(
      `paper-page:${document.id}:${document.pages[0].id}:371x671:bleed`,
    );
  });

  it('writes zero Source items when a same-ID same-MIME linked replacement lands before publish', async () => {
    const { document: storyboardDocument, restoreCreateElement } = linkedTwoPageStoryboardDocument();
    const linkedV1: PaperPlacedSourceItem = {
      id: 'board-art', mimeType: 'image/png', assetUrl: 'data:image/png;base64,djE=', createdAt: 1,
    };
    const unrelated: PaperPlacedSourceItem = {
      id: 'unrelated-item', mimeType: 'image/png', assetUrl: 'data:image/png;base64,dW4=', createdAt: 1,
    };
    let items: readonly PaperPlacedSourceItem[] = [linkedV1, unrelated];
    try {
      const guard = createPaperPlacedDocumentRasterizationGuard(storyboardDocument, () => items);
      const materialized = await materializePaperDocumentAssetUrls(storyboardDocument, guard.sourceItems);
      const exact = await buildPaperDocumentExactManagedFontOutput(materialized);
      items = [
        { id: 'board-art', mimeType: 'image/png', assetUrl: 'data:image/png;base64,djI=', createdAt: 2 },
        unrelated,
      ];
      const publish = vi.fn(async () => ({ id: 'must-not-exist' }));

      await expect(publishPaperStoryboardPageSourcePayloads(
        exact.document,
        { resolveImageSrc: async () => 'data:image/png;base64,YXJ0' },
        publish,
        guard,
      )).rejects.toMatchObject({
        code: 'paper-placed-document-rasterization-unsupported',
        issues: [expect.objectContaining({
          message: expect.stringMatching(/changed while this output was being prepared/i),
        })],
      });
      expect(publish).not.toHaveBeenCalled();
    } finally {
      restoreCreateElement();
    }
  });

  it('still publishes every page in order when only an unrelated Source item changes during preparation', async () => {
    const { document: storyboardDocument, restoreCreateElement } = linkedTwoPageStoryboardDocument();
    const linkedV1: PaperPlacedSourceItem = {
      id: 'board-art', mimeType: 'image/png', assetUrl: 'data:image/png;base64,djE=', createdAt: 1,
    };
    let items: readonly PaperPlacedSourceItem[] = [
      linkedV1,
      { id: 'unrelated-item', mimeType: 'image/png', assetUrl: 'data:image/png;base64,dW4=', createdAt: 1 },
    ];
    try {
      const guard = createPaperPlacedDocumentRasterizationGuard(storyboardDocument, () => items);
      const materialized = await materializePaperDocumentAssetUrls(storyboardDocument, guard.sourceItems);
      const exact = await buildPaperDocumentExactManagedFontOutput(materialized);
      items = [
        linkedV1,
        { id: 'unrelated-item', mimeType: 'image/jpeg', assetUrl: 'data:image/jpeg;base64,djI=', createdAt: 9 },
      ];
      const published: Array<{ label: string; envelopeIndex?: number }> = [];
      const publish = vi.fn(async (payload: { label: string; envelopeIndex?: number }) => {
        published.push({ label: payload.label, envelopeIndex: payload.envelopeIndex });
        return { id: `asset-${published.length}` };
      });

      await publishPaperStoryboardPageSourcePayloads(
        exact.document,
        { resolveImageSrc: async () => 'data:image/png;base64,YXJ0' },
        publish,
        guard,
      );

      expect(published).toEqual([
        { label: 'Linked Boards - Storyboard Page 1', envelopeIndex: 0 },
        { label: 'Linked Boards - Storyboard Page 2', envelopeIndex: 1 },
      ]);
    } finally {
      restoreCreateElement();
    }
  });

  it('prepares every Video storyboard raster before publishing and leaves zero assets when exact readiness rejects', async () => {
    const managed = exactStoryboardFace();
    let documentWithText = createDefaultPaperDocument({ title: 'Exact Video Boards' });
    documentWithText = addFrameToPaperPage(documentWithText, documentWithText.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20, text: 'Exact storyboard',
      typography: { fontFamily: managed.familyName, fontWeight: '400' },
    }).document;
    documentWithText = addPaperPage(documentWithText);
    documentWithText.importedFonts = [managed];
    const outputDocument = aliasPaperDocumentManagedFontFamilies(documentWithText);
    const css = await buildExactPaperManagedFontCss([managed], async () => Uint8Array.from([1, 2, 3]));
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve(), load: async () => new Set(), check: () => false },
    });
    const publish = vi.fn(async () => ({ id: 'must-not-exist' }));

    await expect(publishPaperStoryboardPageSourcePayloads(
      outputDocument,
      { fontFaceCss: css },
      publish,
    )).rejects.toBeInstanceOf(PaperExactManagedFontError);
    expect(publish).not.toHaveBeenCalled();
  });
});
