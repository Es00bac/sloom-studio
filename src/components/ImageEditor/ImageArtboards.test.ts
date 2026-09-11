import { describe, expect, it } from 'vitest';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import {
  applyImageArtboardsMetadata,
  buildImageArtboardPrintProofDescriptor,
  buildImageArtboardsExportPlan,
  buildImageArtboardsPrintExportReadiness,
  buildImageArtboardsPrintStatus,
  computeImageArtboardPrintBounds,
  getImageArtboardsMetadata,
  pixelsToMm,
} from './ImageArtboards';

describe('ImageArtboards', () => {
  it('defaults to a whole-document artboard with print bounds derived from document pixels', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-default',
      title: 'Poster',
      width: 2400,
      height: 3000,
    });

    const metadata = getImageArtboardsMetadata(doc);
    const status = buildImageArtboardsPrintStatus(doc);

    expect(metadata.artboards).toHaveLength(1);
    expect(metadata.artboards[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 2400,
      height: 3000,
      page: expect.objectContaining({
        preset: 'custom',
        dpi: 300,
        bleedMm: 3,
      }),
    });
    expect(status.artboards[0]?.actualPpi).toBe(300);
    expect(status.artboards[0]?.bounds.trimWidthPx).toBe(2400);
    expect(status.artboards[0]?.bounds.trimHeightPx).toBe(3000);
  });

  it('persists bounded artboard print metadata and warns when requested output exceeds source pixels', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-proof',
      title: 'Cover',
      width: 1800,
      height: 2400,
    });

    const nextDoc = applyImageArtboardsMetadata(doc, {
      activeArtboardId: 'cover-front',
      artboards: [
        {
          id: 'cover-front',
          name: 'Cover Front',
          x: 50,
          y: 75,
          width: 1400,
          height: 2000,
          proofLabel: 'Press proof',
          page: {
            preset: 'a4',
            widthMm: 210,
            heightMm: 297,
            bleedMm: 0,
            dpi: 350,
          },
        },
      ],
    });
    const status = buildImageArtboardsPrintStatus(nextDoc);

    expect(nextDoc.metadata?.artboards?.artboards[0]).toMatchObject({
      proofLabel: 'Press proof',
      page: expect.objectContaining({
        preset: 'a4',
        bleedMm: 0,
        dpi: 350,
      }),
    });
    expect(nextDoc.dirty).toBe(true);
    expect(status.artboards[0]?.warnings).toContain('Bleed is 0 mm; edge-to-edge trims may expose white edges.');
    expect(status.artboards[0]?.warnings.join(' ')).toContain('below the 350 DPI target');
  });

  it('computes trim and bleed pixel bounds from page millimeters and DPI', () => {
    expect(computeImageArtboardPrintBounds({
      preset: 'custom',
      widthMm: 210,
      heightMm: 297,
      bleedMm: 3,
      dpi: 300,
    })).toEqual({
      trimWidthPx: 2480,
      trimHeightPx: 3508,
      bleedWidthPx: 2550,
      bleedHeightPx: 3578,
      bleedInsetPx: 35,
    });
  });

  it('builds print-proof descriptors with trim, safe-area, and bleed checks', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-descriptor',
      title: 'Trim safety',
      width: 2400,
      height: 3200,
    });
    const nextDoc = applyImageArtboardsMetadata(doc, {
      activeArtboardId: 'cover',
      artboards: [
        {
          id: 'cover',
          name: 'Cover',
          x: 10,
          y: 20,
          width: 1200,
          height: 1800,
          proofLabel: 'Press proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1200, 300),
            heightMm: pixelsToMm(1800, 300),
            bleedMm: 5,
            dpi: 300,
          },
        },
      ],
    });
    const artboard = getImageArtboardsMetadata(nextDoc).artboards[0];
    const descriptor = buildImageArtboardPrintProofDescriptor(nextDoc, artboard);

    expect(descriptor.trim.documentRect).toEqual({
      x: 10,
      y: 20,
      width: 1200,
      height: 1800,
      right: 1210,
      bottom: 1820,
    });
    expect(descriptor.safeArea.insetPx).toBe(35);
    expect(descriptor.safeArea.documentRect).toEqual({
      x: 45,
      y: 55,
      width: 1130,
      height: 1730,
      right: 1175,
      bottom: 1785,
    });
    expect(descriptor.bleed.insetPx).toBe(59);
    expect(descriptor.bleed.requestedDocumentRect).toEqual({
      x: -49,
      y: -39,
      width: 1318,
      height: 1918,
      right: 1269,
      bottom: 1879,
    });
    expect(descriptor.bleed.clippedDocumentRect).toEqual({
      x: 0,
      y: 0,
      width: 1269,
      height: 1879,
      right: 1269,
      bottom: 1879,
    });
    expect(descriptor.pageBoxes).toEqual({
      mediaBox: {
        label: 'Media Box',
        documentRect: {
          x: 0,
          y: 0,
          width: 1269,
          height: 1879,
          right: 1269,
          bottom: 1879,
        },
        clipped: true,
      },
      bleedBox: {
        label: 'Bleed Box',
        documentRect: {
          x: -49,
          y: -39,
          width: 1318,
          height: 1918,
          right: 1269,
          bottom: 1879,
        },
        clipped: true,
      },
      trimBox: {
        label: 'Trim Box',
        documentRect: {
          x: 10,
          y: 20,
          width: 1200,
          height: 1800,
          right: 1210,
          bottom: 1820,
        },
        clipped: false,
      },
      safeBox: {
        label: 'Safe Box',
        documentRect: {
          x: 45,
          y: 55,
          width: 1130,
          height: 1730,
          right: 1175,
          bottom: 1785,
        },
        clipped: false,
      },
    });
    expect(descriptor.checks).toMatchObject({
      trimInsideDocument: true,
      safeAreaInsideTrim: true,
      bleedInsideDocument: false,
      meetsTargetDpi: true,
    });
    expect(descriptor.warnings).toContain('Bleed area extends beyond the current Image document pixels; export will need clipping or extended edges.');
  });

  it('creates deterministic layout ordering and batch export groups for multiple artboards', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-batch-plan',
      title: 'Batch export',
      width: 3200,
      height: 3200,
    });
    const nextDoc = applyImageArtboardsMetadata(doc, {
      activeArtboardId: 'web-banner',
      artboards: [
        {
          id: 'web-banner',
          name: 'Web Banner',
          x: 0,
          y: 2100,
          width: 1600,
          height: 600,
          proofLabel: 'Screen proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1600, 144),
            heightMm: pixelsToMm(600, 144),
            bleedMm: 0,
            dpi: 144,
          },
        },
        {
          id: 'cover-back',
          name: 'Cover Back',
          x: 1300,
          y: 0,
          width: 1200,
          height: 1800,
          proofLabel: 'Press proof',
          page: {
            preset: 'a4',
            widthMm: 210,
            heightMm: 297,
            bleedMm: 3,
            dpi: 300,
          },
        },
        {
          id: 'cover-front',
          name: 'Cover Front',
          x: 0,
          y: 0,
          width: 1200,
          height: 1800,
          proofLabel: 'Press proof',
          page: {
            preset: 'a4',
            widthMm: 210,
            heightMm: 297,
            bleedMm: 3,
            dpi: 300,
          },
        },
      ],
    });
    const plan = buildImageArtboardsExportPlan(nextDoc);

    expect(plan.artboards.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      filenameStem: entry.filenameStem,
      x: entry.layout.documentRect.x,
      y: entry.layout.documentRect.y,
    }))).toEqual([
      { id: 'cover-front', sequence: 1, filenameStem: '01-cover-front', x: 0, y: 0 },
      { id: 'cover-back', sequence: 2, filenameStem: '02-cover-back', x: 1300, y: 0 },
      { id: 'web-banner', sequence: 3, filenameStem: '03-web-banner', x: 0, y: 2100 },
    ]);
    expect(plan.groups.map((group) => ({
      label: group.label,
      ids: group.artboards.map((entry) => entry.id),
    }))).toEqual([
      { label: 'Press proof - A4 - 300 DPI - 3 mm bleed', ids: ['cover-front', 'cover-back'] },
      { label: 'Screen proof - Custom - 144 DPI - 0 mm bleed', ids: ['web-banner'] },
    ]);
    expect(new Set(plan.artboards.map((entry) => entry.groupKey)).size).toBe(2);
    expect(plan.groups[0]?.warnings.join(' ')).toContain('below the 300 DPI target');
    expect(plan.warnings).toContain('Bleed is 0 mm; edge-to-edge trims may expose white edges.');
  });

  it('adds deterministic preview and signature descriptors to artboard export plans', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-preview-plan',
      title: 'Preview signatures',
      width: 2600,
      height: 2200,
    });
    const nextDoc = applyImageArtboardsMetadata(doc, {
      activeArtboardId: 'inside-page',
      artboards: [
        {
          id: 'inside-page',
          name: 'Inside Page',
          x: 1250,
          y: 0,
          width: 1000,
          height: 1500,
          proofLabel: 'Reader proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1000, 250),
            heightMm: pixelsToMm(1500, 250),
            bleedMm: 2,
            dpi: 250,
          },
        },
        {
          id: 'cover-front',
          name: 'Cover Front',
          x: 0,
          y: 0,
          width: 1200,
          height: 1800,
          proofLabel: 'Press proof',
          page: {
            preset: 'a4',
            widthMm: 210,
            heightMm: 297,
            bleedMm: 3,
            dpi: 300,
          },
        },
      ],
    });
    const plan = buildImageArtboardsExportPlan(nextDoc) as ReturnType<typeof buildImageArtboardsExportPlan> & {
      previewSignature?: string;
      artboards: Array<ReturnType<typeof buildImageArtboardsExportPlan>['artboards'][number] & {
        preview?: {
          id: string;
          signature: string;
          label: string;
          trimCssRect: { x: number; y: number; width: number; height: number };
          bleedCssRect: { x: number; y: number; width: number; height: number };
        };
      }>;
    };

    expect(plan.previewSignature).toBe('artboards:v1|2600x2200|cover-front@0,0,1200x1800/a4/300/3|inside-page@1250,0,1000x1500/custom/250/2');
    expect(plan.artboards.map((entry) => entry.preview)).toEqual([
      {
        id: 'artboard-preview-01-cover-front',
        signature: 'cover-front|01|0,0,1200x1800|a4|300dpi|3mm|press-proof',
        label: '01 Cover Front - Press proof',
        trimCssRect: { x: 0, y: 0, width: 1200, height: 1800 },
        bleedCssRect: { x: 0, y: 0, width: 1235, height: 1835 },
      },
      {
        id: 'artboard-preview-02-inside-page',
        signature: 'inside-page|02|1250,0,1000x1500|custom|250dpi|2mm|reader-proof',
        label: '02 Inside Page - Reader proof',
        trimCssRect: { x: 1250, y: 0, width: 1000, height: 1500 },
        bleedCssRect: { x: 1230, y: 0, width: 1040, height: 1520 },
      },
    ]);
  });

  it('surfaces unsupported imposition and package warnings without changing export behavior', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-unsupported-plan',
      title: 'Package warnings',
      width: 3600,
      height: 2400,
    });
    const nextDoc = applyImageArtboardsMetadata(doc, {
      activeArtboardId: 'left',
      artboards: [
        {
          id: 'left',
          name: 'Left',
          x: 0,
          y: 0,
          width: 1200,
          height: 1800,
          proofLabel: 'Press proof',
          page: {
            preset: 'a4',
            widthMm: 210,
            heightMm: 297,
            bleedMm: 3,
            dpi: 300,
          },
        },
        {
          id: 'right',
          name: 'Right',
          x: 1300,
          y: 0,
          width: 1200,
          height: 1800,
          proofLabel: 'Press proof',
          page: {
            preset: 'a4',
            widthMm: 210,
            heightMm: 297,
            bleedMm: 3,
            dpi: 300,
          },
        },
      ],
    });
    const plan = buildImageArtboardsExportPlan(nextDoc) as ReturnType<typeof buildImageArtboardsExportPlan> & {
      printProduction?: {
        pageCount: number;
        supportsMultiArtboardExport: boolean;
        unsupported: {
          imposition: { supported: boolean; warnings: string[] };
          packageForPrint: { supported: boolean; warnings: string[] };
        };
      };
    };

    expect(plan.printProduction).toEqual({
      pageCount: 2,
      supportsMultiArtboardExport: true,
      unsupported: {
        imposition: {
          supported: false,
          warnings: ['Printer spreads, n-up layouts, and booklet imposition are not generated by Image artboard export planning.'],
        },
        packageForPrint: {
          supported: false,
          warnings: ['Image artboard planning does not collect fonts, linked assets, ICC profiles, or packaged print folders.'],
        },
      },
    });
    expect(plan.warnings).toContain('Unsupported: printer spreads, n-up layouts, and booklet imposition are planning-only gaps.');
    expect(plan.warnings).toContain('Unsupported: packaged print handoff must be assembled outside Image artboard export planning.');
  });

  it('summarizes print and export readiness for artboard package handoff planning', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-readiness',
      title: 'Readiness',
      width: 4000,
      height: 3400,
    });
    const nextDoc = applyImageArtboardsMetadata(doc, {
      activeArtboardId: 'back-cover',
      artboards: [
        {
          id: 'inside-page',
          name: 'Inside Page',
          x: 0,
          y: 2700,
          width: 1200,
          height: 600,
          proofLabel: 'Reader proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1200, 150),
            heightMm: pixelsToMm(600, 150),
            bleedMm: 0,
            dpi: 150,
          },
        },
        {
          id: 'back-cover',
          name: 'Back Cover',
          x: 1900,
          y: 50,
          width: 1800,
          height: 2500,
          proofLabel: 'Press proof',
          page: {
            preset: 'a5',
            widthMm: 148,
            heightMm: 210,
            bleedMm: 3,
            dpi: 300,
          },
        },
        {
          id: 'front-cover',
          name: 'Front Cover',
          x: 50,
          y: 50,
          width: 1800,
          height: 2500,
          proofLabel: 'Press proof',
          page: {
            preset: 'a5',
            widthMm: 148,
            heightMm: 210,
            bleedMm: 3,
            dpi: 300,
          },
        },
      ],
    });

    const readiness = buildImageArtboardsPrintExportReadiness(nextDoc);

    expect(readiness.summary).toEqual({
      artboardCount: 3,
      blockedArtboardCount: 0,
      activeArtboardId: 'back-cover',
      documentBounds: { x: 0, y: 0, width: 4000, height: 3400, right: 4000, bottom: 3400 },
      combinedTrimBounds: { x: 0, y: 50, width: 3700, height: 3250, right: 3700, bottom: 3300 },
      combinedBleedBounds: { x: 0, y: 15, width: 3735, height: 3285, right: 3735, bottom: 3300 },
    });
    expect(readiness.artboards.map((artboard) => ({
      id: artboard.id,
      filenameStem: artboard.exportName.filenameStem,
      basename: artboard.exportName.recommendedBasename,
      active: artboard.active,
      printReady: artboard.readiness.printReady,
      paperReady: artboard.handoff.paper.ready,
      packageReady: artboard.handoff.packageForPrint.ready,
    }))).toEqual([
      {
        id: 'front-cover',
        filenameStem: '01-front-cover',
        basename: '01-front-cover-a5-300dpi-3mm-bleed',
        active: false,
        printReady: true,
        paperReady: true,
        packageReady: false,
      },
      {
        id: 'back-cover',
        filenameStem: '02-back-cover',
        basename: '02-back-cover-a5-300dpi-3mm-bleed',
        active: true,
        printReady: true,
        paperReady: true,
        packageReady: false,
      },
      {
        id: 'inside-page',
        filenameStem: '03-inside-page',
        basename: '03-inside-page-custom-150dpi-0mm-bleed',
        active: false,
        printReady: false,
        paperReady: false,
        packageReady: false,
      },
    ]);
    expect(readiness.artboards[0]?.readiness).toMatchObject({
      trimReady: true,
      bleedReady: true,
      safeAreaReady: true,
      dpiReady: true,
    });
    expect(readiness.artboards[2]?.readiness).toMatchObject({
      trimReady: true,
      bleedReady: false,
      safeAreaReady: true,
      dpiReady: false,
    });
    expect(readiness.handoff.paper).toEqual({
      ready: false,
      mode: 'export-artboards-as-paper-page-assets',
      pageCount: 3,
      warnings: ['Paper handoff should treat this artboard as review-only until bleed coverage and 300 DPI print readiness pass.'],
    });
    expect(readiness.handoff.packageForPrint.ready).toBe(false);
    expect(readiness.handoff.packageForPrint.warnings).toContain('Package for Print is planning-only: fonts, linked assets, ICC profiles, and packaged output folders are not collected.');
    expect(readiness.caveats.imposition.warnings).toContain('Printer spreads, n-up layouts, signatures, and booklet imposition are not generated by Image artboard planning.');
    expect(readiness.caveats.nativePsdArtboards.warnings).toContain('Native multi-page PSD/artboard constructs are unsupported; Sloom Studio preserves artboard intent as metadata and flattened/exported artboard outputs.');
  });

  it('builds stable readiness signatures from planning-relevant artboard fields', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-readiness-signature',
      title: 'Readiness signatures',
      width: 2400,
      height: 1800,
    });
    const nextDoc = applyImageArtboardsMetadata(doc, {
      activeArtboardId: 'poster',
      artboards: [
        {
          id: 'poster',
          name: 'Poster / Proof',
          x: 100,
          y: 100,
          width: 1200,
          height: 1600,
          proofLabel: 'Press proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1200, 300),
            heightMm: pixelsToMm(1600, 300),
            bleedMm: 6,
            dpi: 300,
          },
        },
      ],
    });

    const readiness = buildImageArtboardsPrintExportReadiness(nextDoc);

    expect(readiness.signature).toBe('artboard-readiness:v2|2400x1800|profile=artboard-proof-profile:v1|mode=rgb|intent=screen-rgb|profile=none|embedded=false|conversion=false|unsupported=auto-bleed-extension,image-slices,printer-marks-pdfx,true-contract-proof|poster@100,100,1200x1600|custom|300dpi|6mm|press-proof|ready=true|file=01-poster-proof-custom-300dpi-6mm-bleed');
    expect(readiness.artboards[0]?.signature).toBe('artboard:poster|order=1|rect=100,100,1200x1600|page=custom|dpi=300|bleed=6mm|print=true|paper=true|sourceBin=true|package=false');
    expect(buildImageArtboardsPrintExportReadiness(nextDoc)).toEqual(readiness);
  });

  it('describes Source Bin handoff safety and action suitability for artboard exports', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-handoff-actions',
      title: 'Handoff actions',
      width: 2600,
      height: 2200,
    });
    const nextDoc = applyImageArtboardsMetadata(doc, {
      activeArtboardId: 'screen-card',
      artboards: [
        {
          id: 'press-cover',
          name: 'Press Cover',
          x: 120,
          y: 80,
          width: 1500,
          height: 1900,
          proofLabel: 'Press proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1500, 300),
            heightMm: pixelsToMm(1900, 300),
            bleedMm: 4,
            dpi: 300,
          },
        },
        {
          id: 'screen-card',
          name: 'Screen Card',
          x: 1700,
          y: 120,
          width: 700,
          height: 500,
          proofLabel: 'Screen proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(700, 144),
            heightMm: pixelsToMm(500, 144),
            bleedMm: 0,
            dpi: 144,
          },
        },
      ],
    });

    const readiness = buildImageArtboardsPrintExportReadiness(nextDoc);

    expect(readiness.artboards.map((artboard) => ({
      id: artboard.id,
      sourceBinMode: artboard.handoff.sourceBin.mode,
      sourceBinReady: artboard.handoff.sourceBin.ready,
      actionReplay: artboard.actions.recordable,
      batchExport: artboard.batch.exportSelected.ready,
      batchPrintProof: artboard.batch.printProof.ready,
    }))).toEqual([
      {
        id: 'press-cover',
        sourceBinMode: 'flattened-artboard-asset',
        sourceBinReady: true,
        actionReplay: true,
        batchExport: true,
        batchPrintProof: true,
      },
      {
        id: 'screen-card',
        sourceBinMode: 'flattened-artboard-asset',
        sourceBinReady: true,
        actionReplay: true,
        batchExport: true,
        batchPrintProof: false,
      },
    ]);
    expect(readiness.artboards[0]?.handoff.sourceBin.warnings).toEqual([
      'Source Bin handoff should register a flattened artboard asset plus artboard metadata; it does not preserve native multi-artboard editability.',
    ]);
    expect(readiness.artboards[1]?.handoff.paper).toEqual({
      ready: false,
      mode: 'export-artboard-as-paper-page-asset',
      warnings: ['Paper handoff should treat this artboard as review-only until bleed coverage and 300 DPI print readiness pass.'],
    });
    expect(readiness.artboards[1]?.batch.printProof.warnings).toContain('Batch print proof should skip or flag this artboard until bleed and DPI readiness pass.');
    expect(readiness.actions.recordable).toEqual({
      ready: true,
      mode: 'record-artboard-export-settings',
      warnings: ['Actions can replay deterministic artboard export settings, but cannot record arbitrary manual imposition or package-for-print steps.'],
    });
    expect(readiness.batch.exportAll.ready).toBe(true);
    expect(readiness.batch.printProof.ready).toBe(false);
    expect(readiness.batch.printProof.warnings).toContain('Batch print proof contains artboards that are not fully print ready.');
  });

  it('builds concrete batch artboard export items with print-proof disposition signatures', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-batch-readiness-plan',
      title: 'Batch readiness',
      width: 2600,
      height: 2200,
    });
    const nextDoc = applyImageArtboardsMetadata(doc, {
      activeArtboardId: 'screen-card',
      artboards: [
        {
          id: 'press-cover',
          name: 'Press Cover',
          x: 120,
          y: 80,
          width: 1500,
          height: 1900,
          proofLabel: 'Press proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1500, 300),
            heightMm: pixelsToMm(1900, 300),
            bleedMm: 4,
            dpi: 300,
          },
        },
        {
          id: 'screen-card',
          name: 'Screen Card',
          x: 1700,
          y: 120,
          width: 700,
          height: 500,
          proofLabel: 'Screen proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(700, 144),
            heightMm: pixelsToMm(500, 144),
            bleedMm: 0,
            dpi: 144,
          },
        },
      ],
    });

    const readiness = buildImageArtboardsPrintExportReadiness(nextDoc);

    expect(readiness.batchPlan).toEqual({
      mode: 'batch-export-artboards',
      formats: ['png', 'jpg', 'webp'],
      outputPattern: '{basename}.{ext}',
      totalCount: 2,
      exportableCount: 2,
      printProofReadyCount: 1,
      blockedCount: 0,
      groups: [
        {
          key: 'proof=press-proof|page=custom|dpi=300|bleed=4mm',
          label: 'Press proof - Custom - 300 DPI - 4 mm bleed',
          itemIds: ['press-cover'],
          exportableCount: 1,
          printProofReadyCount: 1,
        },
        {
          key: 'proof=screen-proof|page=custom|dpi=144|bleed=0mm',
          label: 'Screen proof - Custom - 144 DPI - 0 mm bleed',
          itemIds: ['screen-card'],
          exportableCount: 1,
          printProofReadyCount: 0,
        },
      ],
      items: [
        {
          artboardId: 'press-cover',
          sequence: 1,
          filenameStem: '01-press-cover',
          recommendedBasename: '01-press-cover-custom-300dpi-4mm-bleed',
          resolvedBasename: '01-press-cover-custom-300dpi-4mm-bleed',
          filenamePolicy: {
            strategy: 'sequence-prefix-then-numeric-suffix',
            candidateBasename: '01-press-cover-custom-300dpi-4mm-bleed',
            resolvedBasename: '01-press-cover-custom-300dpi-4mm-bleed',
            collisionIndex: 0,
            reservedBasenames: [],
            warnings: [],
            signature: 'artboard-filename:v1|candidate=01-press-cover-custom-300dpi-4mm-bleed|resolved=01-press-cover-custom-300dpi-4mm-bleed|collision=0|reserved=none',
          },
          formats: ['png', 'jpg', 'webp'],
          outputs: [
            { format: 'png', filename: '01-press-cover-custom-300dpi-4mm-bleed.png' },
            { format: 'jpg', filename: '01-press-cover-custom-300dpi-4mm-bleed.jpg' },
            { format: 'webp', filename: '01-press-cover-custom-300dpi-4mm-bleed.webp' },
          ],
          exportReady: true,
          printProofReady: true,
          disposition: 'export-print-proof',
          warnings: [],
          signature: 'artboard-batch-item:v1|press-cover|seq=1|basename=01-press-cover-custom-300dpi-4mm-bleed|export=true|printProof=true',
        },
        {
          artboardId: 'screen-card',
          sequence: 2,
          filenameStem: '02-screen-card',
          recommendedBasename: '02-screen-card-custom-144dpi-0mm-bleed',
          resolvedBasename: '02-screen-card-custom-144dpi-0mm-bleed',
          filenamePolicy: {
            strategy: 'sequence-prefix-then-numeric-suffix',
            candidateBasename: '02-screen-card-custom-144dpi-0mm-bleed',
            resolvedBasename: '02-screen-card-custom-144dpi-0mm-bleed',
            collisionIndex: 0,
            reservedBasenames: [],
            warnings: [],
            signature: 'artboard-filename:v1|candidate=02-screen-card-custom-144dpi-0mm-bleed|resolved=02-screen-card-custom-144dpi-0mm-bleed|collision=0|reserved=none',
          },
          formats: ['png', 'jpg', 'webp'],
          outputs: [
            { format: 'png', filename: '02-screen-card-custom-144dpi-0mm-bleed.png' },
            { format: 'jpg', filename: '02-screen-card-custom-144dpi-0mm-bleed.jpg' },
            { format: 'webp', filename: '02-screen-card-custom-144dpi-0mm-bleed.webp' },
          ],
          exportReady: true,
          printProofReady: false,
          disposition: 'export-review-only',
          warnings: ['Batch print proof should skip or flag this artboard until bleed and DPI readiness pass.'],
          signature: 'artboard-batch-item:v1|screen-card|seq=2|basename=02-screen-card-custom-144dpi-0mm-bleed|export=true|printProof=false',
        },
      ],
      warnings: ['Batch print proof should skip or flag this artboard until bleed and DPI readiness pass.'],
      signature: 'image-artboard-batch-export:v1|items=2|exportable=2|printProof=1|blocked=0|press-cover:1:true:true|screen-card:2:true:false',
    });
  });

  it('resolves artboard filenames, raster export bounds, profile proof warnings, and unsupported production states deterministically', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-artboard-proof-production',
      title: 'Proof production',
      width: 2800,
      height: 2000,
    });
    const nextDoc = applyImageArtboardsMetadata({
      ...doc,
      metadata: {
        colorProof: {
          mode: 'cmyk-soft-proof',
          intent: 'relative-colorimetric',
          profileLabel: 'FOGRA39',
        },
      },
    }, {
      activeArtboardId: 'cover-a',
      artboards: [
        {
          id: 'cover-a',
          name: 'Cover',
          x: 100,
          y: 100,
          width: 1200,
          height: 1600,
          proofLabel: 'Press proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1200, 300),
            heightMm: pixelsToMm(1600, 300),
            bleedMm: 3,
            dpi: 300,
          },
        },
        {
          id: 'cover-b',
          name: 'Cover',
          x: 1400,
          y: 100,
          width: 1200,
          height: 1600,
          proofLabel: 'Press proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1200, 300),
            heightMm: pixelsToMm(1600, 300),
            bleedMm: 3,
            dpi: 300,
          },
        },
      ],
    });

    const readiness = buildImageArtboardsPrintExportReadiness(nextDoc, {
      reservedBasenames: ['01-cover-custom-300dpi-3mm-bleed'],
    });

    expect(readiness.proofProfile).toEqual({
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'FOGRA39',
      embeddedIccProfile: false,
      conversionApplied: false,
      warnings: [
        'FOGRA39 is recorded as artboard proof intent metadata only; ICC conversion and embedding are not applied to artboard exports.',
        'CMYK soft proof remains a preview/metadata state; artboard exports are flattened RGB derivatives, not process-color separations.',
      ],
      signature: 'artboard-proof-profile:v1|mode=cmyk-soft-proof|intent=relative-colorimetric|profile=FOGRA39|embedded=false|conversion=false',
    });
    expect(readiness.unsupportedStates.map((state) => state.code)).toEqual([
      'auto-bleed-extension',
      'image-slices',
      'printer-marks-pdfx',
      'true-contract-proof',
    ]);
    expect(readiness.artboards[0]?.exportBounds).toEqual({
      sourceTrimRect: { x: 100, y: 100, width: 1200, height: 1600, right: 1300, bottom: 1700 },
      sourceBleedRect: { x: 65, y: 65, width: 1270, height: 1670, right: 1335, bottom: 1735 },
      outputTrimSizePx: { width: 1200, height: 1600 },
      outputBleedSizePx: { width: 1270, height: 1670 },
      bleedClipped: false,
      trimScale: { x: 1, y: 1 },
      cropPolicy: 'clip-bleed-to-document-pixels',
      backgroundPolicy: 'transparent-extended-bleed-required',
      signature: 'artboard-export-bounds:v1|trim=100,100,1200x1600|bleed=65,65,1270x1670|out=1200x1600/1270x1670|scale=1x1|clipped=false',
    });
    expect(readiness.artboards.map((artboard) => ({
      id: artboard.id,
      recommendedBasename: artboard.exportName.recommendedBasename,
      resolvedBasename: artboard.filenamePolicy.resolvedBasename,
      collisionIndex: artboard.filenamePolicy.collisionIndex,
      warnings: artboard.filenamePolicy.warnings,
    }))).toEqual([
      {
        id: 'cover-a',
        recommendedBasename: '01-cover-custom-300dpi-3mm-bleed',
        resolvedBasename: '01-cover-custom-300dpi-3mm-bleed-2',
        collisionIndex: 2,
        warnings: ['Resolved duplicate artboard export basename "01-cover-custom-300dpi-3mm-bleed" to "01-cover-custom-300dpi-3mm-bleed-2".'],
      },
      {
        id: 'cover-b',
        recommendedBasename: '02-cover-custom-300dpi-3mm-bleed',
        resolvedBasename: '02-cover-custom-300dpi-3mm-bleed',
        collisionIndex: 0,
        warnings: [],
      },
    ]);
    expect(readiness.batchPlan.items[0]).toMatchObject({
      artboardId: 'cover-a',
      resolvedBasename: '01-cover-custom-300dpi-3mm-bleed-2',
      outputs: [
        { format: 'png', filename: '01-cover-custom-300dpi-3mm-bleed-2.png' },
        { format: 'jpg', filename: '01-cover-custom-300dpi-3mm-bleed-2.jpg' },
        { format: 'webp', filename: '01-cover-custom-300dpi-3mm-bleed-2.webp' },
      ],
    });
    expect(readiness.signature).toBe('artboard-readiness:v2|2800x2000|profile=artboard-proof-profile:v1|mode=cmyk-soft-proof|intent=relative-colorimetric|profile=FOGRA39|embedded=false|conversion=false|unsupported=auto-bleed-extension,image-slices,printer-marks-pdfx,true-contract-proof|cover-a@100,100,1200x1600|custom|300dpi|3mm|press-proof|ready=true|file=01-cover-custom-300dpi-3mm-bleed-2|cover-b@1400,100,1200x1600|custom|300dpi|3mm|press-proof|ready=true|file=02-cover-custom-300dpi-3mm-bleed');
  });

  it('adds per-artboard page boxes, suitability summaries, and blockers for missing or invalid print-ready artboards', () => {
    const defaultDoc = createEmptyImageDocument({
      id: 'doc-artboard-default-blocker',
      title: 'Untitled',
      width: 2400,
      height: 3000,
    });
    const defaultReadiness = buildImageArtboardsPrintExportReadiness(defaultDoc);

    expect(defaultReadiness.summary).toMatchObject({
      artboardCount: 1,
      blockedArtboardCount: 1,
    });
    expect(defaultReadiness.artboards[0]?.blockers).toEqual([
      {
        code: 'missing-artboard-metadata',
        severity: 'blocker',
        summary: 'Print/export proofing is blocked until explicit artboard metadata is confirmed instead of relying on the whole-document fallback artboard.',
      },
    ]);
    expect(defaultReadiness.artboards[0]?.suitability).toEqual({
      export: 'Blocked for export proofing until explicit artboard metadata is confirmed.',
      proof: 'Screen review proof is blocked until explicit artboard metadata is confirmed.',
    });

    const boundedDoc = applyImageArtboardsMetadata(createEmptyImageDocument({
      id: 'doc-artboard-invalid-blocker',
      title: 'Catalog',
      width: 1800,
      height: 2200,
    }), {
      activeArtboardId: 'cover',
      artboards: [
        {
          id: 'cover',
          name: 'Cover',
          x: -40,
          y: 30,
          width: 1600,
          height: 2100,
          proofLabel: 'Press proof',
          page: {
            preset: 'custom',
            widthMm: pixelsToMm(1600, 300),
            heightMm: pixelsToMm(2100, 300),
            bleedMm: 5,
            dpi: 300,
          },
        },
      ],
    });
    const boundedReadiness = buildImageArtboardsPrintExportReadiness(boundedDoc);

    expect(boundedReadiness.summary.blockedArtboardCount).toBe(1);
    expect(boundedReadiness.artboards[0]?.pageBoxes).toEqual({
      mediaBox: {
        label: 'Media Box',
        documentRect: { x: 0, y: 0, width: 1619, height: 2189, right: 1619, bottom: 2189 },
        clipped: true,
      },
      bleedBox: {
        label: 'Bleed Box',
        documentRect: { x: -99, y: -29, width: 1718, height: 2218, right: 1619, bottom: 2189 },
        clipped: true,
      },
      trimBox: {
        label: 'Trim Box',
        documentRect: { x: -40, y: 30, width: 1600, height: 2100, right: 1560, bottom: 2130 },
        clipped: true,
      },
      safeBox: {
        label: 'Safe Box',
        documentRect: { x: -5, y: 65, width: 1530, height: 2030, right: 1525, bottom: 2095 },
        clipped: true,
      },
    });
    expect(boundedReadiness.artboards[0]?.blockers).toEqual([
      {
        code: 'artboard-trim-outside-document',
        severity: 'blocker',
        summary: 'Trim Box extends outside the current Image document bounds.',
      },
      {
        code: 'artboard-bleed-outside-document',
        severity: 'blocker',
        summary: 'Bleed Box extends outside the current Image document bounds and would export clipped edges.',
      },
      {
        code: 'artboard-safe-box-outside-document',
        severity: 'blocker',
        summary: 'Safe Box extends outside the current Image document bounds.',
      },
    ]);
    expect(boundedReadiness.artboards[0]?.suitability).toEqual({
      export: 'Flattened export remains possible, but Trim Box and Bleed Box blockers must be resolved first.',
      proof: 'Press proof is flagged because trim or bleed boxes fall outside the Image document.',
    });
  });
});
