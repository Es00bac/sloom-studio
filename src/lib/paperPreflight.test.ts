import { describe, expect, it } from 'vitest';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperManagedIccProfile } from '../types/paper';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup, updatePaperFrame } from './paperDocument';
import { PAPER_PREFLIGHT_PROFILES, analyzePaperPreflight, collectPaperLinkedAssets, summarizePaperPreflightStatus, summarizePreflightForExport } from './paperPreflight';

function fontRef(byteLength = 4): BinaryAssetRef {
  const sha256 = '2'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength };
}

function exactIccProfile(outputConditionId = 'FOGRA51'): PaperManagedIccProfile {
  const sha256 = '3'.repeat(64);
  const asset: BinaryAssetRef = { id: `sha256:${sha256}`, sha256, mimeType: 'application/vnd.iccprofile', byteLength: 8 };
  return {
    id: asset.id,
    asset,
    description: 'Exact press profile',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId,
    source: { kind: 'user-import' },
  };
}

function sourceItem(id = 'image-1'): SourceBinLibraryItem {
  return {
    id,
    label: 'Panel Art',
    kind: 'image',
    assetUrl: 'data:image/png;base64,abc',
    createdAt: 1,
  };
}

describe('paperPreflight', () => {
  it('turns placed PDFs into a typed, actionable raster preflight error without claiming live print is unavailable', () => {
    const base = createDefaultPaperDocument({ title: 'PDF capability preflight' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'document', xMm: 10, yMm: 10, widthMm: 70, heightMm: 40, label: 'Reference.pdf',
      asset: {
        label: 'Reference.pdf', kind: 'document', mimeType: 'application/pdf',
        locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' },
      },
    });

    expect(analyzePaperPreflight(document).issues).toContainEqual(expect.objectContaining({
      severity: 'error', category: 'links', pageNumber: 1,
      code: 'paper-placed-document-rasterization-unsupported',
      title: 'Placed PDF cannot be flattened in this build',
      detail: expect.stringContaining('Print HTML/live print'),
    }));
  });
  it('trusts the current Source Library item over stale persisted frame MIME in both replacement directions', () => {
    const capabilityCode = 'paper-placed-document-rasterization-unsupported';
    const staleImageBase = createDefaultPaperDocument({ title: 'Replaced with PDF preflight' });
    const { document: staleImageDocument } = addFrameToPaperPage(staleImageBase, staleImageBase.pages[0].id, {
      kind: 'image', xMm: 10, yMm: 10, widthMm: 70, heightMm: 40, label: 'Linked art',
      asset: { sourceBinItemId: 'linked-item', label: 'panel.png', kind: 'image', mimeType: 'image/png' },
    });
    const stalePdfBase = createDefaultPaperDocument({ title: 'Replaced with image preflight' });
    const { document: stalePdfDocument } = addFrameToPaperPage(stalePdfBase, stalePdfBase.pages[0].id, {
      kind: 'document', xMm: 10, yMm: 10, widthMm: 70, heightMm: 40, label: 'Reference.pdf',
      asset: { sourceBinItemId: 'linked-item', label: 'Reference.pdf', kind: 'document', mimeType: 'application/pdf' },
    });

    const replacedWithPdf = analyzePaperPreflight(staleImageDocument, [{
      id: 'linked-item', label: 'Linked art', kind: 'document', mimeType: 'application/pdf',
      assetUrl: 'blob:https://app.test/current-pdf', createdAt: 1,
    }]);
    const replacedWithImage = analyzePaperPreflight(stalePdfDocument, [{
      id: 'linked-item', label: 'Reference art', kind: 'image', mimeType: 'image/png',
      assetUrl: 'blob:https://app.test/current-image', createdAt: 1,
    }]);

    expect(replacedWithPdf.issues).toContainEqual(expect.objectContaining({ severity: 'error', code: capabilityCode }));
    expect(replacedWithImage.issues.filter((issue) => issue.code === capabilityCode)).toHaveLength(0);
  });
  it('flags missing image links, empty text, bleed, margin, and comic page-count risks', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Preflight', preset: 'comic-book' }), {
      bleedMm: 0,
      marginsMm: { top: 3 },
    });
    const pageId = base.pages[0].id;
    const { document: withImage } = addFrameToPaperPage(base, pageId, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 70,
      heightMm: 50,
      asset: { sourceBinItemId: 'missing-image', label: 'Missing Panel', kind: 'image' },
    });
    const { document } = addFrameToPaperPage(withImage, pageId, {
      kind: 'caption',
      xMm: 10,
      yMm: 70,
      widthMm: 60,
      heightMm: 20,
      text: '',
    });

    const report = analyzePaperPreflight(document, [sourceItem()]);

    expect(report.counts.error).toBe(1);
    expect(report.counts.warning).toBeGreaterThanOrEqual(3);
    expect(report.counts.info).toBeGreaterThanOrEqual(1);
    expect(report.issues.map((issue) => issue.title)).toEqual(expect.arrayContaining([
      'Missing linked asset',
      'Empty text frame',
      'No bleed configured',
      'Margins may be unsafe',
      'Comic page count is not printer-friendly',
    ]));
  });

  it('warns about unknown image resolution even when the linked source exists', () => {
    const base = createDefaultPaperDocument({ title: 'Resolution' });
    const item = sourceItem('image-ok');
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 70,
      heightMm: 50,
      asset: { sourceBinItemId: item.id, label: item.label, kind: item.kind },
    });

    const report = analyzePaperPreflight(document, [item]);

    expect(report.counts.error).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'info',
      title: 'Image resolution unknown',
    }));
  });

  it('uses Paper frame pixel metadata for effective PPI checks', () => {
    const base = createDefaultPaperDocument({ title: 'Frame PPI' });
    const item = sourceItem('image-ok');
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 100,
      heightMm: 80,
      asset: { sourceBinItemId: item.id, label: item.label, kind: item.kind, pixelWidth: 1200, pixelHeight: 900 },
    });

    const report = analyzePaperPreflight(document, [item]);
    const assets = collectPaperLinkedAssets(document, [item]);

    expect(assets[0]).toEqual(expect.objectContaining({ status: 'ok', effectivePpi: 286, pixelWidth: 1200, pixelHeight: 900 }));
    expect(report.issues.some((issue) => issue.title === 'Image resolution unknown')).toBe(false);
  });

  it('uses Source Bin pixel metadata when frame metadata is absent', () => {
    const base = createDefaultPaperDocument({ title: 'Source PPI' });
    const item = { ...sourceItem('image-ok'), pixelWidth: 400, pixelHeight: 300 } as SourceBinLibraryItem & { pixelWidth: number; pixelHeight: number };
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 100,
      heightMm: 80,
      asset: { sourceBinItemId: item.id, label: item.label, kind: item.kind },
    });

    const report = analyzePaperPreflight(document, [item]);
    const assets = collectPaperLinkedAssets(document, [item]);

    expect(assets[0].effectivePpi).toBe(95);
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      title: 'Image resolution is low',
    }));
  });

  it('reports actual Stability output PPI without treating a requested target as print-ready', () => {
    const base = createDefaultPaperDocument({ title: 'Stability resolution' });
    const sha256 = '4'.repeat(64);
    const asset: BinaryAssetRef = { id: `sha256:${sha256}`, sha256, mimeType: 'image/png', byteLength: 64 };
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 420,
      heightMm: 280,
      asset: {
        label: 'Stability panel',
        kind: 'image',
        locator: { kind: 'managed', ref: asset },
        mimeType: asset.mimeType,
        pixelWidth: 2449,
        pixelHeight: 1633,
        printUpscale: {
          provider: 'stability',
          mode: 'conservative',
          providerWidthPx: 2449,
          providerHeightPx: 1633,
          effectivePpi: 148,
          requiredPpi: 300,
          printReady: false,
        },
      },
    });

    const report = analyzePaperPreflight(document, [], 'comic-print');

    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      title: 'Stability image remains below print PPI',
      detail: expect.stringContaining('148 effective PPI'),
    }));
    expect(report.issues.some((entry) => entry.title === 'Stability image is print-ready')).toBe(false);
  });

  it('summarizes export-gate warnings and errors but ignores info-only reports', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Export Gate' }), { bleedMm: 0 });
    const warningReport = analyzePaperPreflight(base, []);
    const infoOnlyReport = {
      issues: [{ id: 'i', severity: 'info' as const, title: 'FYI', detail: 'Only info.' }],
      counts: { error: 0, warning: 0, info: 1 },
    };

    expect(summarizePreflightForExport(warningReport)).toContain('warning');
    expect(summarizePreflightForExport(infoOnlyReport)).toBeUndefined();
  });

  it('summarizes persistent status for the Paper workspace topbar', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Topbar Preflight', preset: 'comic-book' }), {
      bleedMm: 0,
    });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 70,
      heightMm: 50,
      asset: { sourceBinItemId: 'missing-image', label: 'Missing Panel', kind: 'image' },
    });

    expect(summarizePaperPreflightStatus(analyzePaperPreflight(document, []))).toEqual(expect.objectContaining({
      tone: 'error',
      label: '1 error',
      detail: expect.stringContaining('Missing linked asset'),
      countsLabel: expect.stringContaining('warning'),
    }));
    expect(summarizePaperPreflightStatus({
      issues: [],
      counts: { error: 0, warning: 0, info: 0 },
    })).toEqual({
      tone: 'ready',
      label: 'Ready',
      detail: 'No Paper preflight issues detected.',
      countsLabel: '0 issues',
    });
  });

  it('returns profile, grouped issues, font inventory, and RGB print color warnings', () => {
    const base = createDefaultPaperDocument({ title: 'Profiled', preset: 'comic-book' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'caption',
      xMm: 10,
      yMm: 10,
      widthMm: 50,
      heightMm: 20,
      text: 'Caption',
      fillColor: '#ff0000',
      typography: { fontFamily: 'Inter', color: '#111111' },
    });

    const report = analyzePaperPreflight(document, [], 'comic-print');

    expect(Object.keys(PAPER_PREFLIGHT_PROFILES)).toEqual(expect.arrayContaining(['generic-pdf', 'comic-print', 'manga-print', 'webtoon']));
    expect(report.profile.id).toBe('comic-print');
    expect(report.groups.map((group) => group.category)).toEqual(expect.arrayContaining(['color']));
    expect(report.fontInventory).toContainEqual(expect.objectContaining({ family: 'Inter' }));
    expect(report.colorInventory).toContainEqual(expect.objectContaining({ value: '#ff0000', rgbLike: true }));
    expect(report.issues).toContainEqual(expect.objectContaining({ title: 'RGB color used for print', category: 'color' }));
  });

  it('describes a selected exact PDF/X profile and still flags RGB colors for CMYK proofing', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Press Target', preset: 'comic-book' }), {
      printProduction: {
        pdfStandard: 'pdf-x-4',
        outputIntentProfileId: 'pso-coated-v3-fogra51',
        totalInkLimitPercent: 280,
        blackPolicy: 'force-100k-text',
        spotColorPolicy: 'convert-process',
        overprintPreview: true,
      },
    });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'caption',
      xMm: 10,
      yMm: 10,
      widthMm: 50,
      heightMm: 20,
      text: 'Caption',
      fillColor: '#ff0000',
      typography: { color: '#111111' },
    });

    const managedProfile = exactIccProfile();
    const report = analyzePaperPreflight({
      ...document,
      managedIccProfiles: [managedProfile],
      printProduction: { ...document.printProduction, outputIntentProfileAssetId: managedProfile.id },
    }, [], 'comic-print');

    expect(report.groups.map((group) => group.category)).toEqual(expect.arrayContaining(['production', 'color']));
    // The export is real now — no false "not certified" claim; an accurate info note instead.
    expect(report.issues.some((i) => i.title === 'Browser PDF export is not PDF/X-certified')).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'info',
      title: 'PDF/X export embeds a real ICC output intent',
      category: 'production',
    }));
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'warning',
      title: 'RGB colors need CMYK proofing',
      category: 'color',
    }));
  });

  it('blocks PDF/X browser/system font fallback rather than describing substitutions', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Font subst', preset: 'comic-book' }), {
      printProduction: { pdfStandard: 'pdf-x-4', outputIntentProfileId: 'pso-coated-v3-fogra51' },
    });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 50, heightMm: 20, text: 'Hello',
      typography: { fontFamily: 'Georgia', color: '#111111' },
    });

    const pdfxReport = analyzePaperPreflight(document, []);
    const missing = pdfxReport.issues.find((i) => i.title === 'PDF/X requires exact managed font faces');
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe('error');
    expect(missing?.category).toBe('fonts');
    expect(missing?.detail).toContain('Georgia');

    // Browser PDF remains a separate proof path and does not advertise a managed production embedding.
    const browserDoc = updatePaperDocumentSetup(document, { printProduction: { pdfStandard: 'browser-pdf' } });
    const browserReport = analyzePaperPreflight(browserDoc, []);
    expect(browserReport.issues.some((i) => i.title === 'PDF/X requires exact managed font faces')).toBe(false);
  });

  it('describes an authorized managed font as the only PDF/X text source', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Imported', preset: 'comic-book' }), {
      printProduction: { pdfStandard: 'pdf-x-4', outputIntentProfileId: 'pso-coated-v3-fogra51' },
    });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 50, heightMm: 20, text: 'Hello',
      typography: { fontFamily: 'Georgia', color: '#111111' },
    });
    const withFont: typeof document = {
      ...document,
      importedFonts: [{
        id: 'geo', familyId: 'georgia', familyName: 'Georgia', postscriptName: 'Georgia-Regular',
        weight: 400, style: 'normal', stretchPercent: 100, collectionIndex: 0, variableAxes: {},
        unicodeRanges: [{ start: 0x20, end: 0x7e }], format: 'truetype', fontAsset: fontRef(),
        embeddability: 'installable', canSubset: true, source: { kind: 'user-import' }, license: {},
      }],
    };

    const report = analyzePaperPreflight(withFont, []);
    const real = report.issues.find((i) => i.title === 'PDF/X will embed exact managed font faces');
    expect(real).toBeDefined();
    expect(real?.severity).toBe('info');
    expect(real?.detail).toContain('Georgia');
    expect(report.issues.some((i) => i.title === 'PDF/X requires exact managed font faces')).toBe(false);
  });

  it('preflights the effective managed face supplied by a linked paragraph style', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Styled face', preset: 'comic-book' }), {
      printProduction: { pdfStandard: 'pdf-x-4', outputIntentProfileId: 'pso-coated-v3-fogra51' },
    });
    const styleId = 'paragraph-managed-georgia';
    const styled = {
      ...base,
      styles: {
        ...base.styles,
        paragraph: [{
          ...base.styles.paragraph[0],
          id: styleId,
          name: 'Managed Georgia',
          typography: {
            ...base.styles.paragraph[0].typography,
            fontFamily: 'Georgia',
            fontWeight: '400',
            fontStyle: 'normal' as const,
          },
        }],
      },
      importedFonts: [{
        id: 'geo', familyId: 'georgia', familyName: 'Georgia', postscriptName: 'Georgia-Regular',
        weight: 400, style: 'normal' as const, stretchPercent: 100, collectionIndex: 0, variableAxes: {},
        unicodeRanges: [{ start: 0x20, end: 0x7e }], format: 'truetype' as const, fontAsset: fontRef(),
        embeddability: 'installable' as const, canSubset: true, source: { kind: 'user-import' as const }, license: {},
      }],
    };
    const { document } = addFrameToPaperPage(styled, styled.pages[0].id, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 50, heightMm: 20, text: 'Styled text',
      paragraphStyleId: styleId,
      typography: { fontFamily: 'Unmanaged Placeholder', color: '#111111' },
    });

    const report = analyzePaperPreflight(document, []);
    expect(report.issues).toContainEqual(expect.objectContaining({
      title: 'PDF/X will embed exact managed font faces',
      detail: expect.stringContaining('Georgia'),
    }));
    expect(report.issues.some((issue) => issue.title === 'PDF/X requires exact managed font faces')).toBe(false);
  });

  it('does not rasterize display fonts as a production fallback', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'SFX subst', preset: 'comic-book' }), {
      printProduction: { pdfStandard: 'pdf-x-4', outputIntentProfileId: 'pso-coated-v3-fogra51' },
    });
    const { document: withBody } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 60, heightMm: 20, text: 'Narration',
      typography: { fontFamily: 'Georgia', color: '#111111' },
    });
    const { document } = addFrameToPaperPage(withBody, withBody.pages[0].id, {
      kind: 'caption', xMm: 10, yMm: 60, widthMm: 60, heightMm: 20, text: 'KA-BOOM',
      typography: { fontFamily: 'Impact, Haettenschweiler, sans-serif', color: '#111111' },
    });

    const report = analyzePaperPreflight(document, []);
    const missing = report.issues.find((i) => i.title === 'PDF/X requires exact managed font faces');
    expect(missing?.severity).toBe('error');
    expect(missing?.detail).toContain('Georgia');
    expect(missing?.detail).toContain('Impact');
    expect(report.issues.some((i) => /Liberation|raster/i.test(i.title))).toBe(false);
  });

  it('describes named spots as a requested native-plate check rather than a completed plate claim', () => {
    const spotSwatch = {
      id: 'spot-1', name: 'PANTONE 485 C', type: 'spot' as const, model: 'cmyk' as const,
      rgb: { r: 218, g: 41, b: 28 }, cmyk: { c: 0, m: 95, y: 100, k: 0 }, spotName: 'PANTONE 485 C',
    };
    let document = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Spot', preset: 'comic-book' }), {
      printProduction: { pdfStandard: 'pdf-x-4', outputIntentProfileId: 'pso-coated-v3-fogra51', spotColorPolicy: 'preserve-named' },
    });
    document = { ...document, swatches: [spotSwatch] };
    const added = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'caption', xMm: 10, yMm: 10, widthMm: 50, heightMm: 20, text: 'Ink',
    });
    document = updatePaperFrame(added.document, document.pages[0].id, added.frameId, { fillColor: '#da291c', fillSwatchId: 'spot-1' });

    const titles = analyzePaperPreflight(document, []).issues.map((issue) => issue.title);
    expect(titles).toContain('Spot colors requested for native plates');
    expect(titles).not.toContain('Spot colors kept as separation plates');
  });

  it('flags invalid PDF/X output intent combinations before export', () => {
    const document = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Bad PDFX Target' }), {
      printProduction: {
        pdfStandard: 'pdf-x-4',
        outputIntentProfileId: 'srgb',
      },
    });

    const report = analyzePaperPreflight(document, [], 'comic-print');

    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      title: 'PDF/X target needs a press output intent',
      category: 'production',
    }));
  });

  it('blocks PDF/X when the selected output condition has no exact managed ICC asset', () => {
    const document = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Exact profile required' }), {
      printProduction: {
        pdfStandard: 'pdf-x-4',
        outputIntentProfileId: 'pso-coated-v3-fogra51',
      },
    });

    const report = analyzePaperPreflight(document, [], 'comic-print');

    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      title: 'Exact managed CMYK profile is required',
      category: 'production',
    }));
  });

  it('blocks a restored custom target when its selected ICC names another output condition', () => {
    const managedProfile = exactIccProfile('Printer B Coated');
    const document = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Mismatched custom profile' }), {
      printProduction: {
        pdfStandard: 'pdf-x-4',
        outputIntentProfileId: 'custom',
        customOutputIntentName: 'Printer A Coated',
        outputIntentProfileAssetId: managedProfile.id,
      },
      managedIccProfiles: [managedProfile],
    });

    const report = analyzePaperPreflight(document, [], 'comic-print');

    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      title: 'Managed ICC output condition does not match',
      category: 'production',
    }));
  });
});
