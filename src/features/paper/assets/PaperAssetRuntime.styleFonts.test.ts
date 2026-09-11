import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import { addFrameToPaperPage, addFrameToPaperParentPage, assignPaperParentPage, createDefaultPaperDocument } from '../../../lib/paperDocument';
import { addPaperLayer, updatePaperLayer } from '../../../lib/paperLayers';
import type { PaperDocument, PaperManagedFontFace } from '../../../types/paper';
import {
  paperManagedFontFamilyAlias,
  readPaperManagedFontManifest,
} from '../../../lib/paperExactManagedFonts';
import {
  buildFlattenedPaperPageSvgExport,
  rasterizeFlattenedPaperPageToPng,
} from '../../../lib/paperPageFlattenExport';
import { buildPaperDocumentExactManagedFontOutput, paperAssetRepository } from './PaperAssetRuntime';

afterEach(() => {
  vi.unstubAllGlobals();
});

let faceSeed = 0;

async function importManagedFace(
  overrides: Partial<PaperManagedFontFace> & { familyName: string },
): Promise<PaperManagedFontFace> {
  faceSeed += 1;
  const record = await createBinaryAssetRecord(
    Uint8Array.from([faceSeed, faceSeed + 1, faceSeed + 2, faceSeed + 3]),
    { mimeType: 'font/ttf' },
  );
  await paperAssetRepository.put(record);
  return {
    id: `style-face-${faceSeed}`,
    familyId: overrides.familyName,
    postscriptName: `${overrides.familyName.replaceAll(' ', '')}-${faceSeed}`,
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [],
    format: 'truetype',
    fontAsset: record.ref,
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
    ...overrides,
  };
}

function loadedFontsFor(aliases: readonly string[]) {
  return {
    ready: Promise.resolve(),
    load: async (descriptor: string) => new Set(
      aliases
        .filter((alias) => descriptor.includes(alias))
        .map((alias) => ({ family: alias, status: 'loaded' })),
    ),
    check: () => true,
  };
}

function rasterBrowserDocument(aliases: readonly string[]): Document {
  const context = { drawImage: vi.fn() };
  return {
    fonts: loadedFontsFor(aliases),
    createElement: vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/png;base64,styled-page'),
    })),
  } as unknown as Document;
}

describe('style-applied exact managed font output', () => {
  it.each([
    ['hidden', { visible: false, printable: true }],
    ['non-printing', { visible: true, printable: false }],
  ] as const)('does not load a missing exact font used only on a %s layer', async (_label, layerState) => {
    const face = await importManagedFace({ familyName: 'Excluded Output Exact' });
    let document = createDefaultPaperDocument({ title: 'Excluded managed font' });
    const addedLayer = addPaperLayer({ ...document, importedFonts: [face] }, 'Output-excluded');
    document = updatePaperLayer(addedLayer.document, addedLayer.layerId!, layerState);
    document = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text',
      layerId: addedLayer.layerId,
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 20,
      text: 'Retained but not painted',
      typography: { fontFamily: face.familyName },
    }).document;
    await paperAssetRepository.delete(face.fontAsset.id);

    const exact = await buildPaperDocumentExactManagedFontOutput(document);

    expect(exact.fontFaceCss).toBeUndefined();
    expect(exact.document.pages[0].frames[0].text).toBe('Retained but not painted');
    expect(() => buildFlattenedPaperPageSvgExport(exact.document, exact.document.pages[0].id))
      .not.toThrow();
  });

  it.each([
    ['missing payload', { visible: false, printable: true }, 'missing'],
    ['collection member', { visible: true, printable: false }, 'collection'],
    ['unauthorized face', { visible: false, printable: true }, 'unauthorized'],
    ['descriptor collision', { visible: true, printable: false }, 'collision'],
  ] as const)(
    'keeps an excluded %s authored and unaliased while a printable exact face succeeds',
    async (_label, layerState, badFaceKind) => {
      const printableFace = await importManagedFace({ familyName: `Printable Exact ${badFaceKind}` });
      const excludedFace = await importManagedFace({
        familyName: `Excluded Exact ${badFaceKind}`,
        ...(badFaceKind === 'collection'
          ? { format: 'collection' as const, collectionIndex: 1 }
          : {}),
        ...(badFaceKind === 'unauthorized'
          ? { embeddability: 'restricted' as const, canSubset: false }
          : {}),
      });
      const collisionFace = badFaceKind === 'collision'
        ? await importManagedFace({
            familyName: excludedFace.familyName,
            familyId: excludedFace.familyId,
            postscriptName: `${excludedFace.postscriptName}-Collision`,
          })
        : undefined;
      if (badFaceKind === 'missing') await paperAssetRepository.delete(excludedFace.fontAsset.id);

      let document = createDefaultPaperDocument({ title: `Mixed output ${badFaceKind}` });
      document = {
        ...document,
        importedFonts: [printableFace, excludedFace, ...(collisionFace ? [collisionFace] : [])],
        styles: {
          ...document.styles,
          paragraph: [
            ...document.styles.paragraph,
            {
              id: `excluded-style-${badFaceKind}`,
              name: `Excluded ${badFaceKind}`,
              typography: { fontFamily: excludedFace.familyName, fontWeight: '400' },
            },
          ],
        },
      };
      const pageId = document.pages[0].id;
      document = addFrameToPaperPage(document, pageId, {
        kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
        text: `Printable exact ${badFaceKind}`,
        typography: { fontFamily: printableFace.familyName },
      }).document;
      const excludedLayer = addPaperLayer(document, `Excluded ${badFaceKind}`);
      document = updatePaperLayer(excludedLayer.document, excludedLayer.layerId!, layerState);
      document = addFrameToPaperPage(document, pageId, {
        kind: 'text', layerId: excludedLayer.layerId,
        xMm: 10, yMm: 40, widthMm: 80, heightMm: 20,
        text: `Must not print ${badFaceKind}`,
        typography: { fontFamily: 'Authored excluded fallback' },
        paragraphStyleId: `excluded-style-${badFaceKind}`,
      }).document;
      const authoredExcludedFrame = document.pages[0].frames[1];

      const exact = await buildPaperDocumentExactManagedFontOutput(document);
      const printableAlias = paperManagedFontFamilyAlias(printableFace);

      expect(readPaperManagedFontManifest(exact.fontFaceCss)?.faces).toHaveLength(1);
      expect(readPaperManagedFontManifest(exact.fontFaceCss)?.faces[0].familyAlias).toBe(printableAlias);
      expect(exact.document.pages[0].frames[0].typography.fontFamily).toBe(printableAlias);
      expect(exact.document.pages[0].frames[1]).toBe(authoredExcludedFrame);
      expect(exact.document.pages[0].frames[1]).toMatchObject({
        paragraphStyleId: `excluded-style-${badFaceKind}`,
        typography: { fontFamily: 'Authored excluded fallback' },
      });
      expect(exact.document.importedFonts).toBe(document.importedFonts);
      expect(exact.document.styles).toBe(document.styles);

      const svg = buildFlattenedPaperPageSvgExport(exact.document, pageId, {
        fontFaceCss: exact.fontFaceCss,
      }).svg;
      expect(svg).toContain(`Printable exact ${badFaceKind}`);
      expect(svg).not.toContain(`Must not print ${badFaceKind}`);

      await paperAssetRepository.delete(printableFace.fontAsset.id);
      await paperAssetRepository.delete(excludedFace.fontAsset.id);
      if (collisionFace) await paperAssetRepository.delete(collisionFace.fontAsset.id);
    },
  );

  it('does not resolve a managed typography field on a printable frame that cannot paint text', async () => {
    const printableFace = await importManagedFace({ familyName: 'Printable Text Exact' });
    const inertCollectionFace = await importManagedFace({
      familyName: 'Inert Shape Collection',
      format: 'collection',
      collectionIndex: 1,
    });
    let document: PaperDocument = {
      ...createDefaultPaperDocument({ title: 'Inert frame typography' }),
      importedFonts: [printableFace, inertCollectionFace],
    };
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
      text: 'This face paints ',
      richText: [{ runs: [
        { text: 'This face paints', fontFamily: printableFace.familyName },
        { text: ' ', fontFamily: inertCollectionFace.familyName },
      ] }],
      typography: { fontFamily: printableFace.familyName },
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'shape', xMm: 10, yMm: 40, widthMm: 40, heightMm: 20,
      typography: { fontFamily: inertCollectionFace.familyName },
    }).document;
    const authoredShape = document.pages[0].frames[1];

    const exact = await buildPaperDocumentExactManagedFontOutput(document);

    expect(readPaperManagedFontManifest(exact.fontFaceCss)?.faces.map((entry) => entry.familyAlias))
      .toEqual([paperManagedFontFamilyAlias(printableFace)]);
    expect(exact.document.pages[0].frames[0].richText?.[0].runs[1].fontFamily)
      .toBe(inertCollectionFace.familyName);
    expect(exact.document.pages[0].frames[1]).toBe(authoredShape);

    await paperAssetRepository.delete(printableFace.fontAsset.id);
    await paperAssetRepository.delete(inertCollectionFace.fontAsset.id);
  });

  it('does not resolve an exact face used only by an unused parent page', async () => {
    const unusedFace = await importManagedFace({
      familyName: 'Unused Parent Collection',
      format: 'collection',
      collectionIndex: 1,
    });
    let document: PaperDocument = {
      ...createDefaultPaperDocument({ title: 'Unused parent face' }),
      importedFonts: [unusedFace],
    };
    const parentId = document.parentPages[0].id;
    document = addFrameToPaperParentPage(document, parentId, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
      text: 'Not applied to a page', typography: { fontFamily: unusedFace.familyName },
    }).document;
    const authoredParentFrame = document.parentPages[0].frames[0];

    const exact = await buildPaperDocumentExactManagedFontOutput(document);

    expect(exact.fontFaceCss).toBeUndefined();
    expect(exact.document.parentPages[0].frames[0]).toBe(authoredParentFrame);
    expect(exact.compositionDocument.parentPages[0].frames[0]).toBe(authoredParentFrame);

    await paperAssetRepository.delete(unusedFace.fontAsset.id);
  });

  it('collects and splits browser/native identities once a page applies a parent face', async () => {
    const face = await importManagedFace({ familyName: 'Applied Parent Exact' });
    let document: PaperDocument = {
      ...createDefaultPaperDocument({ title: 'Applied parent face' }),
      importedFonts: [face],
    };
    const parentId = document.parentPages[0].id;
    document = addFrameToPaperParentPage(document, parentId, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
      text: 'Applied parent text', typography: { fontFamily: face.familyName },
    }).document;
    document = assignPaperParentPage(document, document.pages[0].id, parentId);

    const exact = await buildPaperDocumentExactManagedFontOutput(document);

    expect(readPaperManagedFontManifest(exact.fontFaceCss)?.faces.map((entry) => entry.familyAlias))
      .toEqual([paperManagedFontFamilyAlias(face)]);
    expect(exact.document.parentPages[0].frames[0].typography.fontFamily)
      .toBe(paperManagedFontFamilyAlias(face));
    expect(exact.compositionDocument.parentPages[0].frames[0].typography.fontFamily)
      .toBe(face.familyName);

    await paperAssetRepository.delete(face.fontAsset.id);
  });

  it('collects, aliases, and rasterizes a paragraph-style-supplied managed face absent from raw frame typography', async () => {
    const face = await importManagedFace({ familyName: 'Style Serif Exact' });
    let document = createDefaultPaperDocument({ title: 'Styled managed output' });
    document = {
      ...document,
      importedFonts: [face],
      styles: {
        ...document.styles,
        paragraph: [
          ...document.styles.paragraph,
          { id: 'para-style-exact', name: 'Style Exact', typography: { fontFamily: face.familyName, fontWeight: '400' } },
        ],
      },
    };
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'caption',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 20,
      text: 'Styled exact text',
      paragraphStyleId: 'para-style-exact',
    }).document;

    const exact = await buildPaperDocumentExactManagedFontOutput(document);
    const alias = paperManagedFontFamilyAlias(face);

    // The effective face comes from the paragraph style, so the exact payload must exist and
    // name exactly that face.
    expect(exact.fontFaceCss).toBeDefined();
    const manifest = readPaperManagedFontManifest(exact.fontFaceCss);
    expect(manifest?.faces.map((entry) => entry.familyAlias)).toEqual([alias]);

    // The export-only document carries the aliased effective family; the authored document is untouched.
    const exportFrame = exact.document.pages[0].frames[0];
    expect(exportFrame.typography.fontFamily).toBe(alias);
    expect(exportFrame.paragraphStyleId).toBeUndefined();
    const compositionFrame = exact.compositionDocument.pages[0].frames[0];
    expect(compositionFrame.typography.fontFamily).toBe(face.familyName);
    expect(compositionFrame.paragraphStyleId).toBeUndefined();
    const authoredFrame = document.pages[0].frames[0];
    expect(authoredFrame.paragraphStyleId).toBe('para-style-exact');
    expect(authoredFrame.typography.fontFamily).not.toBe(alias);

    // The flattened SVG paints the alias (never the raw style family), and the raster completes
    // through exact-face verification.
    const svgExport = buildFlattenedPaperPageSvgExport(exact.document, pageId, { fontFaceCss: exact.fontFaceCss });
    expect(svgExport.svg).toContain(alias);
    expect(svgExport.svg).not.toContain('Style Serif Exact');
    vi.stubGlobal('Image', class {
      decoding = '';
      src = '';
      decode() { return Promise.resolve(); }
    });
    const raster = await rasterizeFlattenedPaperPageToPng(svgExport, rasterBrowserDocument([alias]));
    expect(raster.mimeType).toBe('image/png');

    await paperAssetRepository.delete(face.fontAsset.id);
  });

  it('collects a character-style-supplied face alongside a paragraph-style face', async () => {
    const regular = await importManagedFace({ familyName: 'Style Duo Exact' });
    const boldItalic = await importManagedFace({
      familyName: 'Style Duo Exact',
      weight: 700,
      style: 'italic',
    });
    let document = createDefaultPaperDocument({ title: 'Styled duo output' });
    document = {
      ...document,
      importedFonts: [regular, boldItalic],
      styles: {
        ...document.styles,
        paragraph: [
          ...document.styles.paragraph,
          { id: 'para-duo', name: 'Duo Paragraph', typography: { fontFamily: regular.familyName, fontWeight: '400' } },
        ],
        character: [
          ...document.styles.character,
          {
            id: 'char-duo',
            name: 'Duo Character',
            typography: { fontFamily: boldItalic.familyName, fontWeight: '700', fontStyle: 'italic' },
          },
        ],
      },
    };
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
      text: 'Paragraph styled', paragraphStyleId: 'para-duo',
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'caption', xMm: 10, yMm: 40, widthMm: 80, heightMm: 20,
      text: 'Character styled', characterStyleId: 'char-duo',
    }).document;

    const exact = await buildPaperDocumentExactManagedFontOutput(document);
    const manifest = readPaperManagedFontManifest(exact.fontFaceCss);

    expect(manifest?.faces.map((entry) => entry.familyAlias).sort()).toEqual(
      [paperManagedFontFamilyAlias(regular), paperManagedFontFamilyAlias(boldItalic)].sort(),
    );
    const [paragraphFrame, characterFrame] = exact.document.pages[0].frames;
    expect(paragraphFrame.typography.fontFamily).toBe(paperManagedFontFamilyAlias(regular));
    expect(characterFrame.typography.fontFamily).toBe(paperManagedFontFamilyAlias(boldItalic));
    expect(characterFrame.characterStyleId).toBeUndefined();

    await paperAssetRepository.delete(regular.fontAsset.id);
    await paperAssetRepository.delete(boldItalic.fontAsset.id);
  });

  it('keeps mixed styled rich runs on their exact distinct face identities', async () => {
    const base = await importManagedFace({ familyName: 'Mixed Run Exact' });
    const bold = await importManagedFace({ familyName: 'Mixed Run Exact', weight: 700 });
    const condensed = await importManagedFace({
      familyName: 'Mixed Run Second',
      stretchPercent: 75,
    });
    const oblique = await importManagedFace({
      familyName: 'Mixed Run Exact',
      style: 'oblique',
      obliqueAngleDeg: 8,
    });
    const variable = await importManagedFace({
      familyName: 'Mixed Run Variable',
      variableAxes: { wght: { min: 100, max: 900, default: 400 } },
      variationSettings: { wght: 640 },
    });
    let document = createDefaultPaperDocument({ title: 'Mixed styled runs' });
    document = {
      ...document,
      importedFonts: [base, bold, condensed, oblique, variable],
      styles: {
        ...document.styles,
        paragraph: [
          ...document.styles.paragraph,
          { id: 'para-mixed', name: 'Mixed Paragraph', typography: { fontFamily: base.familyName, fontWeight: '400' } },
        ],
      },
    };
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 90, heightMm: 60,
      paragraphStyleId: 'para-mixed',
      richText: [{
        runs: [
          { text: 'style-base ' },
          { text: 'run-bold ', fontWeight: '700' },
          { text: 'run-condensed ', fontFamily: condensed.familyName, fontStretch: '75%' },
          { text: 'run-oblique ', fontStyle: 'oblique 8deg' },
          { text: 'run-variable', fontFamily: variable.familyName, fontVariationSettings: { wght: 640 } },
        ],
      }],
    }).document;

    const exact = await buildPaperDocumentExactManagedFontOutput(document);
    const manifest = readPaperManagedFontManifest(exact.fontFaceCss);

    expect(manifest?.faces.map((entry) => entry.familyAlias).sort()).toEqual([
      paperManagedFontFamilyAlias(base),
      paperManagedFontFamilyAlias(bold),
      paperManagedFontFamilyAlias(condensed),
      paperManagedFontFamilyAlias(oblique),
      paperManagedFontFamilyAlias(variable),
    ].sort());
    const variableManifestFace = manifest?.faces.find(
      (entry) => entry.familyAlias === paperManagedFontFamilyAlias(variable),
    );
    expect(variableManifestFace?.variationSettings).toEqual({ wght: 640 });
    const obliqueManifestFace = manifest?.faces.find(
      (entry) => entry.familyAlias === paperManagedFontFamilyAlias(oblique),
    );
    expect(obliqueManifestFace).toMatchObject({ style: 'oblique', obliqueAngleDeg: 8 });
    const condensedManifestFace = manifest?.faces.find(
      (entry) => entry.familyAlias === paperManagedFontFamilyAlias(condensed),
    );
    expect(condensedManifestFace?.stretchPercent).toBe(75);

    const runs = exact.document.pages[0].frames[0].richText?.[0].runs ?? [];
    expect(runs.map((run) => run.fontFamily)).toEqual([
      paperManagedFontFamilyAlias(base),
      paperManagedFontFamilyAlias(bold),
      paperManagedFontFamilyAlias(condensed),
      paperManagedFontFamilyAlias(oblique),
      paperManagedFontFamilyAlias(variable),
    ]);
    // Run-level overrides that select the face stay authored exactly.
    expect(runs[1].fontWeight).toBe('700');
    expect(runs[2].fontStretch).toBe('75%');
    expect(runs[3].fontStyle).toBe('oblique 8deg');
    expect(runs[4].fontVariationSettings).toEqual({ wght: 640 });

    for (const face of [base, bold, condensed, oblique, variable]) {
      await paperAssetRepository.delete(face.fontAsset.id);
    }
  });

  it('does not demand an exact payload when a style overrides a managed raw family with a system family', async () => {
    const face = await importManagedFace({ familyName: 'Raw Only Exact' });
    let document = createDefaultPaperDocument({ title: 'Style override to system family' });
    document = {
      ...document,
      importedFonts: [face],
      styles: {
        ...document.styles,
        paragraph: [
          ...document.styles.paragraph,
          { id: 'para-system', name: 'System Body', typography: { fontFamily: 'Georgia, serif' } },
        ],
      },
    };
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
      text: 'Effectively unmanaged',
      typography: { fontFamily: face.familyName },
      paragraphStyleId: 'para-system',
    }).document;

    const exact = await buildPaperDocumentExactManagedFontOutput(document);

    // The rendered face is the style's system family, so no exact managed payload may be demanded
    // and the flattened export must not be blocked on a face that never paints.
    expect(exact.fontFaceCss).toBeUndefined();
    const svgExport = buildFlattenedPaperPageSvgExport(exact.document, pageId, {});
    expect(svgExport.svg).toContain('Georgia');

    await paperAssetRepository.delete(face.fontAsset.id);
  });
});
