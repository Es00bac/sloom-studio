import { describe, expect, it, vi } from 'vitest';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperDocument, PaperManagedFontFace, PaperManagedIccProfile } from '../types/paper';
import { addFrameToPaperPage, addFrameToPaperParentPage, assignPaperParentPage, createDefaultPaperDocument, updatePaperDocumentSetup, updatePaperFrame } from './paperDocument';
import { collectReachablePaperAssetIds } from '../features/paper/assets/PaperDocumentAssets';
import { addPaperLayer, updatePaperLayer } from './paperLayers';
import type { PdfxExportResult } from './paperPdfxExport';
import type { PdfxValidationReport } from './paperPdfxValidate';
import type { PaperRenderPlan } from './paperRenderPlan';
import { exportValidatedPaperPdfx, preflightPaperProduction } from './paperProductionPreflight';

const SHA = 'a'.repeat(64);

function assetRef(mimeType = 'application/vnd.iccprofile'): BinaryAssetRef {
  const sha256 = mimeType === 'application/vnd.iccprofile' ? SHA : 'b'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType, byteLength: 8 };
}

function exactProfile(): PaperManagedIccProfile {
  const asset = assetRef();
  return {
    id: asset.id,
    asset,
    description: 'Exact FOGRA51 profile',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'FOGRA51',
    source: { kind: 'user-import' },
  };
}

function productionDocument(standard: 'pdf-x-1a' | 'pdf-x-4' = 'pdf-x-4') {
  const profile = exactProfile();
  return updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Production gate' }), {
    printProduction: {
      pdfStandard: standard,
      outputIntentProfileId: 'pso-coated-v3-fogra51',
      outputIntentProfileAssetId: profile.id,
      spotColorPolicy: 'preserve-named',
      totalInkLimitPercent: 300,
    },
    managedIccProfiles: [profile],
  });
}

function managedFace(overrides: Partial<PaperManagedFontFace> = {}): PaperManagedFontFace {
  const sha256 = 'c'.repeat(64);
  return {
    id: 'preflight-face',
    familyId: 'Preflight Exact',
    familyName: 'Preflight Exact',
    postscriptName: 'PreflightExact-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [],
    format: 'truetype',
    fontAsset: { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 8 },
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
    ...overrides,
  };
}

function generatedPdf(): PdfxExportResult {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    standard: 'pdf-x-4',
    pageCount: 1,
    profileName: 'Exact FOGRA51 profile',
    approximateColor: false,
    nativeEvidence: {
      processObjectIds: [],
      spotPlates: [],
      embeddedFontIds: [],
      outlinedObjectIds: [],
      flattenedObjectIds: [],
      overprintObjectIds: [],
    },
  };
}

function validation(pass = true): PdfxValidationReport {
  return {
    standard: 'pdf-x-4',
    headerVersion: '1.6',
    pass,
    checks: [{ id: 'no-rgb', label: 'No RGB color', pass }],
  };
}

function planFor(document: { id: string; updatedAt: number }, nodes: PaperRenderPlan['pages'][number]['nodes']): PaperRenderPlan {
  return {
    documentId: document.id,
    revision: document.updatedAt,
    pages: [{
      pageId: 'page-1',
      pageNumber: 1,
      trimWidthPt: 100,
      trimHeightPt: 100,
      bleedPt: 0,
      nodes,
    }],
  };
}

describe('Paper production preflight', () => {
  it.each([
    ['hidden', { visible: false, printable: true }],
    ['non-printing', { visible: true, printable: false }],
  ] as const)('ignores missing assets and fonts used only on a %s layer while project inventory retains them', async (_label, layerState) => {
    const missingImage = assetRef('image/png');
    let document = productionDocument();
    const addedLayer = addPaperLayer(document, 'Output-excluded');
    document = updatePaperLayer(addedLayer.document, addedLayer.layerId!, layerState);
    document = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'image',
      layerId: addedLayer.layerId,
      xMm: 10,
      yMm: 10,
      widthMm: 100,
      heightMm: 100,
      opacity: 0.5,
      asset: {
        label: 'Unavailable retained art',
        kind: 'image',
        locator: { kind: 'managed', ref: missingImage },
        pixelWidth: 10,
        pixelHeight: 10,
      },
    }).document;
    document = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text',
      layerId: addedLayer.layerId,
      xMm: 10,
      yMm: 120,
      widthMm: 80,
      heightMm: 20,
      text: 'Unmanaged but not painted',
      typography: { fontFamily: 'Missing Output Face' },
    }).document;
    const checkedAssets: string[] = [];

    const report = await preflightPaperProduction(document, {
      standard: 'pdf-x-4',
      assetExists: async (reference) => {
        checkedAssets.push(reference.id);
        return reference.id !== missingImage.id;
      },
    });

    expect(report.issues.filter((issue) => [
      'MISSING_MANAGED_ASSET',
      'MISSING_MANAGED_FONT',
      'INSUFFICIENT_PPI',
      'PDFX1A_TRANSPARENCY_UNSUPPORTED',
    ].includes(issue.code))).toEqual([]);
    expect(checkedAssets).not.toContain(missingImage.id);
    expect(report.assetIds).not.toContain(missingImage.id);
    expect(collectReachablePaperAssetIds(document)).toContain(missingImage.id);
  });

  it('ignores managed assets and fonts on a parent page that no output page applies', async () => {
    const missingImage = assetRef('image/png');
    const unusedCollectionFace = managedFace({
      id: 'unused-parent-collection',
      familyId: 'Unused Parent Collection',
      familyName: 'Unused Parent Collection',
      format: 'collection',
      collectionIndex: 1,
    });
    let document: PaperDocument = { ...productionDocument(), importedFonts: [unusedCollectionFace] };
    const parentId = document.parentPages[0].id;
    document = addFrameToPaperParentPage(document, parentId, {
      kind: 'image', xMm: 10, yMm: 10, widthMm: 100, heightMm: 100,
      asset: {
        label: 'Unused unavailable art', kind: 'image', locator: { kind: 'managed', ref: missingImage },
        pixelWidth: 10, pixelHeight: 10,
      },
    }).document;
    document = addFrameToPaperParentPage(document, parentId, {
      kind: 'text', xMm: 10, yMm: 120, widthMm: 80, heightMm: 20,
      text: 'Unused collection face', typography: { fontFamily: unusedCollectionFace.familyName },
    }).document;
    const checkedAssets: string[] = [];

    const report = await preflightPaperProduction(document, {
      standard: 'pdf-x-4',
      assetExists: async (reference) => {
        checkedAssets.push(reference.id);
        return reference.id !== missingImage.id && reference.id !== unusedCollectionFace.fontAsset.id;
      },
    });

    expect(report.issues.filter((issue) => ['MISSING_MANAGED_ASSET', 'MISSING_MANAGED_FONT', 'INSUFFICIENT_PPI'].includes(issue.code))).toEqual([]);
    expect(checkedAssets).not.toContain(missingImage.id);
    expect(checkedAssets).not.toContain(unusedCollectionFace.fontAsset.id);
    expect(report.assetIds).not.toContain(missingImage.id);
    expect(report.assetIds).not.toContain(unusedCollectionFace.fontAsset.id);

    checkedAssets.length = 0;
    const applied = assignPaperParentPage(document, document.pages[0].id, parentId);
    const appliedReport = await preflightPaperProduction(applied, {
      standard: 'pdf-x-4',
      assetExists: async (reference) => {
        checkedAssets.push(reference.id);
        return reference.id !== missingImage.id && reference.id !== unusedCollectionFace.fontAsset.id;
      },
    });
    expect(appliedReport.issues).toContainEqual(expect.objectContaining({
      code: 'MISSING_MANAGED_FONT',
      objectId: document.parentPages[0].frames[1].id,
    }));
    expect(checkedAssets).toEqual(expect.arrayContaining([
      missingImage.id,
      unusedCollectionFace.fontAsset.id,
    ]));
  });

  it.each([
    ['a missing requested descriptor', managedFace(), { fontFamily: 'Preflight Exact', fontWeight: '700' }],
    ['a font collection member', managedFace({ format: 'collection', collectionIndex: 1 }), { fontFamily: 'Preflight Exact' }],
    ['a face without production rights', managedFace({ embeddability: 'restricted', canSubset: false }), { fontFamily: 'Preflight Exact' }],
  ] as const)('reports %s as a managed-font blocker instead of throwing during asset inventory', async (_label, face, typography) => {
    let document: PaperDocument = { ...productionDocument(), importedFonts: [face] };
    document = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
      text: 'Preflight this face', typography,
    }).document;

    const report = await preflightPaperProduction(document, { standard: 'pdf-x-4' });

    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'MISSING_MANAGED_FONT',
      severity: 'blocker',
    }));
  });

  it('does not mistake unused transparent text or image box paint for PDF/X-1a live transparency', async () => {
    let document = productionDocument('pdf-x-1a');
    const text = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 60, heightMm: 20, text: 'Managed text',
      fillColor: 'transparent', fillOpacity: 0, strokeColor: 'transparent', strokeOpacity: 0, strokeWidthMm: 0,
    });
    document = text.document;
    const image = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'image', xMm: 10, yMm: 40, widthMm: 60, heightMm: 20,
      fillColor: 'transparent', fillOpacity: 0, strokeColor: 'transparent', strokeOpacity: 0, strokeWidthMm: 0,
    });

    const report = await preflightPaperProduction(image.document, { standard: 'pdf-x-1a' });

    expect(report.issues.filter((issue) => issue.code === 'PDFX1A_TRANSPARENCY_UNSUPPORTED')).toEqual([]);
  });

  it('does not mistake an absent native stroke for PDF/X-1a live transparency', async () => {
    const document = productionDocument('pdf-x-1a');
    const report = await preflightPaperProduction(document, {
      standard: 'pdf-x-1a',
      renderPlan: planFor(document, [{
        kind: 'path', objectId: 'opaque-fill-only', path: 'M 0 0 L 10 0 L 10 10 Z',
        fill: { kind: 'process-cmyk', c: 0.1, m: 0.2, y: 0.3, k: 0.4, tint: 1 },
        opacity: 1, fillOpacity: 1, strokeOpacity: 0, strokeWidthPt: 0, strokeStyle: 'solid', overprint: false,
        boundsPt: { x: 0, y: 0, width: 10, height: 10 },
      }]),
    });

    expect(report.issues.filter((issue) => issue.code === 'PDFX1A_TRANSPARENCY_UNSUPPORTED')).toEqual([]);
  });

  it('does not download bytes when PDF/X validation fails', async () => {
    const document = productionDocument();
    const download = vi.fn();
    const generate = vi.fn(async () => generatedPdf());

    const result = await exportValidatedPaperPdfx(document, {
      standard: 'pdf-x-4',
      generate,
      validate: async () => validation(false),
      download,
    });

    expect(result.status).toBe('blocked');
    expect(generate).toHaveBeenCalledOnce();
    expect(download).not.toHaveBeenCalled();
  });

  it('freezes the document passed to the generator before generating bytes', async () => {
    const document = productionDocument();
    const generate = vi.fn(async (frozenDocument) => {
      expect(frozenDocument).not.toBe(document);
      expect(frozenDocument.printProduction).toEqual(document.printProduction);
      return generatedPdf();
    });

    const result = await exportValidatedPaperPdfx(document, {
      standard: 'pdf-x-4',
      generate,
      validate: async () => validation(),
      download: vi.fn(),
    });

    expect(result.status).toBe('saved');
  });

  it('blocks missing exact managed profile and asset records before generation', async () => {
    const missingProfile = createDefaultPaperDocument({ title: 'Missing profile' });
    const profileReport = await preflightPaperProduction(missingProfile, { standard: 'pdf-x-4' });
    expect(profileReport.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_EXACT_PROFILE', severity: 'blocker' }));

    const assetReport = await preflightPaperProduction(productionDocument(), {
      standard: 'pdf-x-4',
      assetExists: async () => false,
    });
    expect(assetReport.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_MANAGED_ASSET', severity: 'blocker' }));
  });

  it('blocks browser fallback faces, including rich text run faces', async () => {
    const base = productionDocument();
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'caption',
      xMm: 10,
      yMm: 10,
      widthMm: 60,
      heightMm: 20,
      text: 'Managed type only',
      richText: [{ runs: [{ text: 'Managed ', fontFamily: 'Unmanaged Display' }, { text: 'type', fontFamily: 'Another Missing Face' }] }],
    });

    const report = await preflightPaperProduction(document, { standard: 'pdf-x-4' });
    expect(report.issues.filter((issue) => issue.code === 'MISSING_MANAGED_FONT')).toHaveLength(2);
  });

  it('inspects the effective style-applied managed face, not raw frame typography', async () => {
    const fontSha = 'b'.repeat(64);
    const styledFace: PaperManagedFontFace = {
      id: 'style-preflight-face',
      familyId: 'Style Gate Exact',
      familyName: 'Style Gate Exact',
      postscriptName: 'StyleGateExact-Regular',
      weight: 400,
      style: 'normal',
      stretchPercent: 100,
      collectionIndex: 0,
      variableAxes: {},
      unicodeRanges: [],
      format: 'truetype',
      fontAsset: { id: `sha256:${fontSha}`, sha256: fontSha, mimeType: 'font/ttf', byteLength: 8 },
      embeddability: 'installable',
      canSubset: true,
      source: { kind: 'user-import' },
      license: {},
    };
    const base = productionDocument();
    const styled = {
      ...base,
      importedFonts: [styledFace],
      styles: {
        ...base.styles,
        paragraph: [
          ...base.styles.paragraph,
          { id: 'para-preflight-style', name: 'Preflight Style', typography: { fontFamily: styledFace.familyName, fontWeight: '400' } },
        ],
      },
    };
    const { document } = addFrameToPaperPage(styled, styled.pages[0].id, {
      kind: 'caption',
      xMm: 10,
      yMm: 10,
      widthMm: 60,
      heightMm: 20,
      text: 'Style-face body',
      typography: { fontFamily: 'Unmanaged Raw Family' },
      paragraphStyleId: 'para-preflight-style',
    });

    const report = await preflightPaperProduction(document, { standard: 'pdf-x-4' });

    // The paragraph style supplies the face the output paints, so strict preflight must approve
    // and expect exactly that face — never the raw frame family the render never uses.
    expect(report.issues.filter((issue) => issue.code === 'MISSING_MANAGED_FONT')).toEqual([]);
    expect(report.expectedFontIds).toEqual([styledFace.id]);
  });

  it('blocks a requested spot that the render plan would flatten instead of plate', async () => {
    const base = productionDocument();
    const { document: added, frameId } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'shape',
      xMm: 10,
      yMm: 10,
      widthMm: 50,
      heightMm: 30,
    });
    const document = updatePaperFrame({
      ...added,
      swatches: [{
        id: 'spot-red',
        name: 'PANTONE 185 C',
        type: 'spot',
        model: 'cmyk',
        rgb: { r: 228, g: 0, b: 43 },
        cmyk: { c: 0, m: 100, y: 81, k: 4 },
        spotName: 'PANTONE 185 C',
      }],
    }, added.pages[0].id, frameId, { fillSwatchId: 'spot-red', fillColor: '#e4002b' });
    const report = await preflightPaperProduction(document, {
      standard: 'pdf-x-4',
      renderPlan: planFor(document, [{
        kind: 'flatten-group',
        objectId: frameId,
        sourceFrameIds: [frameId],
        reasonCodes: ['unsupported-fill-paint'],
        boundsPt: { x: 0, y: 0, width: 100, height: 100 },
        children: [],
      }]),
    });

    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'UNPLATEABLE_REQUESTED_SPOT', severity: 'blocker' }));
  });

  it('blocks a render plan from a different frozen revision of the same document', async () => {
    const document = productionDocument();
    const stalePlan = {
      ...planFor(document, []),
      revision: document.updatedAt + 1,
    } as unknown as PaperRenderPlan;

    const report = await preflightPaperProduction(document, {
      standard: 'pdf-x-4',
      renderPlan: stalePlan,
    });

    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'STALE_RENDER_PLAN', severity: 'blocker' }));
  });

  it('blocks authored TAC overages and insufficient image resolution', async () => {
    const document = productionDocument();
    const tacReport = await preflightPaperProduction(document, {
      standard: 'pdf-x-4',
      renderPlan: planFor(document, [{
        kind: 'path',
        objectId: 'rich-panel',
        path: 'M 0 0 L 1 0 L 1 1 Z',
        fill: { kind: 'process-cmyk', c: 1, m: 1, y: 1, k: 1, tint: 1 },
        opacity: 1,
        fillOpacity: 1,
        strokeOpacity: 0,
        strokeWidthPt: 0,
        strokeStyle: 'solid',
        overprint: false,
        boundsPt: { x: 0, y: 0, width: 1, height: 1 },
      }]),
    });
    expect(tacReport.issues).toContainEqual(expect.objectContaining({ code: 'TOTAL_INK_LIMIT_EXCEEDED', severity: 'blocker' }));

    const image = assetRef('image/png');
    const { document: withImage } = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 100,
      heightMm: 100,
      asset: {
        label: 'Low resolution art',
        kind: 'image',
        locator: { kind: 'managed', ref: image },
        pixelWidth: 100,
        pixelHeight: 100,
      },
    });
    const ppiReport = await preflightPaperProduction(withImage, { standard: 'pdf-x-4' });
    expect(ppiReport.issues).toContainEqual(expect.objectContaining({ code: 'INSUFFICIENT_PPI', severity: 'blocker' }));
  });

  it('blocks live transparency for PDF/X-1a before generation', async () => {
    const base = productionDocument('pdf-x-1a');
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'shape',
      xMm: 10,
      yMm: 10,
      widthMm: 20,
      heightMm: 20,
      opacity: 0.5,
    });

    const report = await preflightPaperProduction(document, { standard: 'pdf-x-1a' });
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'PDFX1A_TRANSPARENCY_UNSUPPORTED', severity: 'blocker' }));
  });

  it('allows an explicit full-page KDP flatten while retaining low source PPI as a warning', async () => {
    let document = productionDocument('pdf-x-1a');
    document = updatePaperDocumentSetup(document, {
      printProduction: { spotColorPolicy: 'convert-process' },
    });
    const text = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 30,
      text: 'Rasterized KDP text',
      opacity: 0.5,
      typography: { fontFamily: 'Unmanaged Display', fontSizePt: 20 },
    });
    const image = assetRef('image/png');
    const placed = addFrameToPaperPage(text.document, text.document.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 50,
      widthMm: 100,
      heightMm: 100,
      asset: {
        label: 'Low resolution art',
        kind: 'image',
        locator: { kind: 'managed', ref: image },
        pixelWidth: 100,
        pixelHeight: 100,
      },
    });

    const report = await preflightPaperProduction(placed.document, {
      standard: 'pdf-x-1a',
      allowFullPageFlatten: true,
    });

    expect(report.issues.filter((issue) => issue.code === 'MISSING_MANAGED_FONT')).toEqual([]);
    expect(report.issues.filter((issue) => issue.code === 'PDFX1A_TRANSPARENCY_UNSUPPORTED')).toEqual([]);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: 'INSUFFICIENT_PPI',
      severity: 'warning',
    }));
    expect(report.pass).toBe(true);
  });
});
