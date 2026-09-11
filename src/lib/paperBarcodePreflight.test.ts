import { describe, expect, it } from 'vitest';
import type { PaperManagedIccProfile } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup } from './paperDocument';
import { analyzePaperPreflight } from './paperPreflight';
import { preflightPaperProduction } from './paperProductionPreflight';
import { paperBarcodeSymbolSizeMm } from './paperBarcode';

const SHA = 'd'.repeat(64);

function exactProfile(): PaperManagedIccProfile {
  const asset: BinaryAssetRef = { id: `sha256:${SHA}`, sha256: SHA, mimeType: 'application/vnd.iccprofile', byteLength: 8 };
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

function productionDocument() {
  const profile = exactProfile();
  return updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Barcode preflight' }), {
    printProduction: {
      pdfStandard: 'pdf-x-4',
      outputIntentProfileId: 'pso-coated-v3-fogra51',
      outputIntentProfileAssetId: profile.id,
      spotColorPolicy: 'preserve-named',
      totalInkLimitPercent: 300,
    },
    managedIccProfiles: [profile],
  });
}

function addBarcode(
  document: ReturnType<typeof productionDocument>,
  overrides: Record<string, unknown> = {},
) {
  const nominal = paperBarcodeSymbolSizeMm(1, true);
  return addFrameToPaperPage(document, document.pages[0].id, {
    kind: 'barcode',
    label: 'Cover ISBN',
    xMm: 20,
    yMm: 20,
    widthMm: nominal.widthMm,
    heightMm: nominal.heightMm,
    barcode: { symbology: 'ean13', value: '9780306406157', showHumanReadable: true },
    ...overrides,
  });
}

function addPanel(document: ReturnType<typeof productionDocument>, overrides: Record<string, unknown> = {}) {
  return addFrameToPaperPage(document, document.pages[0].id, {
    kind: 'panel',
    label: 'Art panel',
    xMm: 100,
    yMm: 100,
    widthMm: 40,
    heightMm: 40,
    fillColor: '#111827',
    strokeColor: 'transparent',
    strokeWidthMm: 0,
    ...overrides,
  });
}

function workspaceCodes(document: ReturnType<typeof productionDocument>): string[] {
  return analyzePaperPreflight(document).issues.map((issue) => issue.code).filter(Boolean) as string[];
}

function productionCodes(document: ReturnType<typeof productionDocument>): Promise<string[]> {
  return preflightPaperProduction(document, { standard: 'pdf-x-4' })
    .then((report) => report.issues.map((issue) => issue.code));
}

describe('workspace barcode preflight', () => {
  it('raises no barcode issue for a valid nominal ISBN placement', () => {
    const { document: withBarcode } = addBarcode(productionDocument());
    const codes = workspaceCodes(withBarcode);
    expect(codes).not.toContain('paper-barcode-value-invalid');
    expect(codes).not.toContain('paper-barcode-magnification');
    expect(codes).not.toContain('paper-barcode-truncated-height');
    expect(codes).not.toContain('paper-barcode-quiet-zone-obstructed');
  });

  it('errors on an unresolved ISBN value with the expected check digit in the detail', () => {
    const { document: withBarcode } = addBarcode(productionDocument(), {
      barcode: { symbology: 'ean13', value: '9780306406158', showHumanReadable: true },
    });
    const issue = analyzePaperPreflight(withBarcode).issues.find((candidate) => candidate.code === 'paper-barcode-value-invalid');
    expect(issue).toMatchObject({ severity: 'error', frameId: withBarcode.pages[0].frames.find((frame) => frame.kind === 'barcode')!.id });
    expect(issue!.detail).toContain('check digit should be 7');
  });

  it('errors on magnification outside the GS1 80-200% window and warns on truncation', () => {
    const tiny = addBarcode(productionDocument(), { widthMm: 20, heightMm: 15 });
    const codes = workspaceCodes(tiny.document);
    expect(codes).toContain('paper-barcode-magnification');

    const truncated = addBarcode(productionDocument(), { heightMm: 14 });
    const issues = analyzePaperPreflight(truncated.document).issues
      .filter((candidate) => candidate.code === 'paper-barcode-truncated-height');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('warns when neighbouring ink prints inside the reserved quiet zone', () => {
    const withBarcode = addBarcode(productionDocument());
    // A dark panel overlapping the left quiet zone (x 20..23.63).
    const obstructed = addPanel(withBarcode.document, { xMm: 18, yMm: 18, widthMm: 6, heightMm: 6 });
    const issues = analyzePaperPreflight(obstructed.document).issues
      .filter((candidate) => candidate.code === 'paper-barcode-quiet-zone-obstructed');
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');

    // The same panel moved fully clear of the symbol raises nothing.
    const clear = addPanel(withBarcode.document, { xMm: 2, yMm: 2, widthMm: 6, heightMm: 6 });
    expect(workspaceCodes(clear.document)).not.toContain('paper-barcode-quiet-zone-obstructed');
  });

  it('ignores ink-free neighbours and notes a general (non-Bookland) EAN prefix', () => {
    const withBarcode = addBarcode(productionDocument(), {
      barcode: { symbology: 'ean13', value: '4901234567894', showHumanReadable: true },
    });
    const ghost = addPanel(withBarcode.document, { xMm: 18, yMm: 18, widthMm: 6, heightMm: 6, fillColor: 'transparent' });
    const issues = analyzePaperPreflight(ghost.document).issues;
    expect(issues.some((issue) => issue.code === 'paper-barcode-quiet-zone-obstructed')).toBe(false);
    expect(issues.some((issue) => issue.title === 'Barcode is a general EAN-13, not an ISBN')).toBe(true);
  });

  it('warns when the human-readable digits are hidden, including for a general EAN prefix', () => {
    const hidden = addBarcode(productionDocument(), {
      heightMm: paperBarcodeSymbolSizeMm(1, false).heightMm,
      barcode: { symbology: 'ean13', value: '9780306406157', showHumanReadable: false },
    });
    const issue = analyzePaperPreflight(hidden.document).issues
      .find((candidate) => candidate.code === 'paper-barcode-hri-hidden');
    expect(issue).toMatchObject({
      severity: 'warning',
      frameId: hidden.document.pages[0].frames.find((frame) => frame.kind === 'barcode')!.id,
    });
    expect(issue!.detail).toContain('GS1 requires all 13 digits');

    const generalHidden = addBarcode(productionDocument(), {
      heightMm: paperBarcodeSymbolSizeMm(1, false).heightMm,
      barcode: { symbology: 'ean13', value: '4901234567894', showHumanReadable: false },
    });
    expect(workspaceCodes(generalHidden.document)).toContain('paper-barcode-hri-hidden');
  });

  it('raises no hidden-digit warning when the digits are shown', () => {
    const { document: withBarcode } = addBarcode(productionDocument());
    expect(workspaceCodes(withBarcode)).not.toContain('paper-barcode-hri-hidden');
  });
});

describe('production barcode preflight', () => {
  it('raises no barcode blocker for a valid nominal ISBN placement', async () => {
    const { document: withBarcode } = addBarcode(productionDocument());
    const codes = await productionCodes(withBarcode);
    expect(codes).not.toContain('BARCODE_VALUE_INVALID');
    expect(codes).not.toContain('BARCODE_PHYSICAL_SIZE_INVALID');
    expect(codes).not.toContain('BARCODE_QUIET_ZONE_INSUFFICIENT');
    expect(codes).not.toContain('BARCODE_HEIGHT_TRUNCATED');
  });

  it('blocks export on an unresolved value and on magnification outside 80-200%', async () => {
    const invalid = addBarcode(productionDocument(), {
      barcode: { symbology: 'ean13', value: '9780306406158', showHumanReadable: true },
    });
    expect(await productionCodes(invalid.document)).toContain('BARCODE_VALUE_INVALID');

    const undersized = addBarcode(productionDocument(), { widthMm: 20, heightMm: 15 });
    expect(await productionCodes(undersized.document)).toContain('BARCODE_PHYSICAL_SIZE_INVALID');
  });

  it('warns — not blocks — on a truncated bar height', async () => {
    const truncated = addBarcode(productionDocument(), { heightMm: 14 });
    const report = await preflightPaperProduction(truncated.document, { standard: 'pdf-x-4' });
    const issue = report.issues.find((candidate) => candidate.code === 'BARCODE_HEIGHT_TRUNCATED');
    expect(issue).toMatchObject({ severity: 'warning', fixAction: 'select-object' });
  });

  it('blocks export when neighbouring ink prints inside the reserved quiet zone', async () => {
    const withBarcode = addBarcode(productionDocument());
    const obstructed = addPanel(withBarcode.document, { xMm: 18, yMm: 18, widthMm: 6, heightMm: 6 });
    const report = await preflightPaperProduction(obstructed.document, { standard: 'pdf-x-4' });
    const issue = report.issues.find((candidate) => candidate.code === 'BARCODE_QUIET_ZONE_INSUFFICIENT');
    expect(issue).toMatchObject({ severity: 'blocker', fixAction: 'select-object' });
    expect(issue!.message).toContain('quiet zone');
  });

  it('blocks strict export when the human-readable digits are hidden', async () => {
    const hidden = addBarcode(productionDocument(), {
      heightMm: paperBarcodeSymbolSizeMm(1, false).heightMm,
      barcode: { symbology: 'ean13', value: '9780306406157', showHumanReadable: false },
    });
    const report = await preflightPaperProduction(hidden.document, { standard: 'pdf-x-4' });
    const issue = report.issues.find((candidate) => candidate.code === 'BARCODE_HRI_HIDDEN');
    expect(issue).toMatchObject({ severity: 'blocker', fixAction: 'select-object' });
    expect(issue!.message).toContain('all 13 digits');

    // With the digits shown at the nominal size, the blocker is absent.
    const { document: withBarcode } = addBarcode(productionDocument());
    const shown = await preflightPaperProduction(withBarcode, { standard: 'pdf-x-4' });
    expect(shown.issues.some((candidate) => candidate.code === 'BARCODE_HRI_HIDDEN')).toBe(false);
  });
});
