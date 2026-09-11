import { describe, expect, it } from 'vitest';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import {
  applyImageColorProofSetup,
  buildImageColorProofPlanningDescriptor,
  buildImageColorProofWorkflowDescriptor,
  buildImageColorProofStatus,
  describeImageColorProofReadOnlyState,
  describeImageColorProofHighBitImplications,
  describeImageColorProofOperationalReadiness,
  describeImageColorProofReadiness,
  IMAGE_COLOR_PROOF_MODES,
  IMAGE_COLOR_PROOF_SETUP_PRESETS,
  normalizeImageColorProofSetup,
} from './ImageColorProof';

describe('ImageColorProof', () => {
  it('defaults documents to native RGB with honest soft-proof limitations', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-proof-rgb',
      title: 'RGB document',
      width: 4,
      height: 4,
    });

    const status = buildImageColorProofStatus(doc);

    expect(status.modeLabel).toBe('RGB');
    expect(status.proofLabel).toBe('Screen RGB');
    expect(status.nativeWorkingSpace).toBe('RGB');
    expect(status.canExportNativeCmyk).toBe(false);
    expect(status.warnings).toContain('Image currently composites and exports pixels through the RGB renderer.');
  });

  it('normalizes CMYK proof setup as metadata-only intent without claiming conversion', () => {
    const setup = normalizeImageColorProofSetup({
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'US Web Coated SWOP',
    });

    expect(setup).toEqual({
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'US Web Coated SWOP',
    });
  });

  it('names the persisted CMYK proof selection as legacy metadata and separates it from the live ICC route', () => {
    const doc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-legacy-metadata',
      title: 'Legacy proof metadata',
      width: 1,
      height: 1,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'FOGRA39',
    });
    const descriptor = buildImageColorProofWorkflowDescriptor(doc);

    expect(IMAGE_COLOR_PROOF_MODES.find((mode) => mode.value === 'cmyk-soft-proof')?.label).toBe('CMYK proof setup (legacy metadata)');
    expect(descriptor.preview.pipeline).toBe('rgb-cmyk-proof-metadata');
    expect(descriptor.warnings).toContain('This saved CMYK proof setup is legacy metadata only; run the live ICC proof and gamut check in CMYK document mode to render a read-only LCMS preview.');
  });

  it('exposes deterministic proof setup presets with honest workflow summaries', () => {
    expect(IMAGE_COLOR_PROOF_SETUP_PRESETS).toEqual([
      {
        id: 'screen-rgb',
        label: 'Screen RGB',
        setup: {
          mode: 'rgb',
          intent: 'screen-rgb',
        },
        summary: 'Native editable RGB canvas with no ICC proof transform.',
      },
      {
        id: 'grayscale-soft-proof',
        label: 'Luminance Grayscale Proof',
        setup: {
          mode: 'grayscale-soft-proof',
          intent: 'grayscale-luminance',
        },
        summary: 'Read-only luminance proof; edits stay RGB and grayscale conversion/export remain external.',
      },
      {
        id: 'cmyk-soft-proof-relative',
        label: 'CMYK Proof Setup (Legacy Metadata)',
        setup: {
          mode: 'cmyk-soft-proof',
          intent: 'relative-colorimetric',
        },
        summary: 'Legacy proof metadata only; run the live ICC proof and gamut check for a rendered read-only LCMS preview. CMYK separation/export remain external.',
      },
      {
        id: 'cmyk-soft-proof-perceptual',
        label: 'CMYK Proof Setup Perceptual (Legacy Metadata)',
        setup: {
          mode: 'cmyk-soft-proof',
          intent: 'perceptual',
        },
        summary: 'Legacy perceptual-intent metadata only; live ICC proof must be run separately. Exports stay RGB plus proof labels.',
      },
    ]);
  });

  it('persists proof setup in document metadata and marks the document dirty', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-proof-cmyk',
      title: 'Print handoff',
      width: 8,
      height: 8,
    });

    const nextDoc = applyImageColorProofSetup(doc, {
      mode: 'cmyk-soft-proof',
      intent: 'perceptual',
      profileLabel: 'Generic CMYK proof',
    });
    const status = buildImageColorProofStatus(nextDoc);

    expect(nextDoc.metadata?.colorProof).toEqual({
      mode: 'cmyk-soft-proof',
      intent: 'perceptual',
      profileLabel: 'Generic CMYK proof',
    });
    expect(nextDoc.dirty).toBe(true);
    expect(status.modeLabel).toBe('CMYK proof setup (legacy metadata)');
    expect(status.proofLabel).toBe('Perceptual CMYK proof');
    expect(status.warnings).toContain('This saved CMYK proof setup is legacy metadata only; run the live ICC proof and gamut check in CMYK document mode to render a read-only LCMS preview.');
  });

  it('keeps grayscale proof honest as a preview intent, not destructive conversion', () => {
    const doc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-gray',
      title: 'Grayscale check',
      width: 8,
      height: 8,
    }), {
      mode: 'grayscale-soft-proof',
      intent: 'grayscale-luminance',
    });

    const status = buildImageColorProofStatus(doc);

    expect(status.modeLabel).toBe('Grayscale Soft Proof');
    expect(status.proofLabel).toBe('Luminance grayscale proof');
    expect(status.warnings).toContain('Grayscale proof does not destructively convert layer pixels.');
  });

  it('builds deterministic soft-proof workflow descriptors with profile and print limits', () => {
    const doc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-workflow',
      title: 'Press handoff',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'Coated FOGRA39',
    });

    const descriptor = buildImageColorProofWorkflowDescriptor(doc);

    expect(descriptor).toMatchObject({
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      preview: {
        label: 'CMYK proof setup (legacy metadata)',
        pipeline: 'rgb-cmyk-proof-metadata',
        nativeWorkingSpace: 'RGB',
        iccTransformAvailable: false,
      },
      profile: {
        requestedProfileLabel: 'Coated FOGRA39',
        appliedPolicy: 'label-only',
        iccTransformAvailable: false,
      },
      operations: {
        paint: {
          supported: true,
          workingSpace: 'RGB',
          proofPolicy: 'preview-only',
        },
        export: {
          supported: true,
          workingSpace: 'RGB',
          proofPolicy: 'metadata-only',
        },
      },
      print: {
        pressReady: false,
        nativeCmykExport: false,
      },
    });
    expect(descriptor.profile.limitations).toContain('Requested proof profiles are stored as handoff labels only; ICC profile transforms are not applied.');
    expect(descriptor.print.warnings).toContain('CMYK soft proof is not a press-ready separation; exported pixels remain RGB.');
    expect(descriptor.warnings).toContain('This saved CMYK proof setup is legacy metadata only; run the live ICC proof and gamut check in CMYK document mode to render a read-only LCMS preview.');
  });

  it('builds deterministic proof planning summaries for gamut, profile, flattening, and preview signatures', () => {
    const cmykDoc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-plan-cmyk',
      title: 'CMYK planning',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'perceptual',
      profileLabel: 'Coated FOGRA39',
    });
    const grayscaleDoc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-plan-gray',
      title: 'Gray planning',
      width: 8,
      height: 8,
    }), {
      mode: 'grayscale-soft-proof',
      intent: 'grayscale-luminance',
      profileLabel: 'Gray Gamma 2.2',
    });

    const cmyk = buildImageColorProofPlanningDescriptor(cmykDoc);
    const grayscale = buildImageColorProofPlanningDescriptor(grayscaleDoc);

    expect(cmyk).toMatchObject({
      mode: 'cmyk-soft-proof',
      intent: 'perceptual',
      preview: {
        pipeline: 'rgb-cmyk-proof-metadata',
        signature: 'proof:cmyk-soft-proof:perceptual:Coated FOGRA39:rgb-cmyk-proof-metadata',
      },
      gamut: {
        warningAvailable: false,
        summary: 'Gamut warnings are not computed by the saved CMYK proof metadata; run the live ICC proof and gamut check for the rendered warning overlay.',
      },
      profileWarnings: [
        'Requested proof profile "Coated FOGRA39" is retained as metadata only; ICC proof transforms are not applied.',
      ],
      softProofSummary: {
        destructiveConversion: false,
        nativeWorkingSpace: 'RGB',
        nativeCmykExport: false,
        proofAccuracy: 'metadata-only',
      },
      conversion: {
        flatteningRequiredForPress: true,
        limitations: [
          'Press handoff requires external flattening and ICC-managed CMYK separation; Sloom Studio exports RGB pixels plus proof metadata.',
        ],
      },
      signature: 'proof-plan:cmyk-soft-proof:perceptual:Coated FOGRA39:metadata-only',
    });
    expect(cmyk.warnings).toContain('Gamut warnings are not computed by the saved CMYK proof metadata; run the live ICC proof and gamut check for the rendered warning overlay.');

    expect(grayscale).toMatchObject({
      mode: 'grayscale-soft-proof',
      intent: 'grayscale-luminance',
      gamut: {
        warningAvailable: false,
        summary: 'Gamut warnings are not computed for grayscale proof; preview uses luminance only.',
      },
      softProofSummary: {
        destructiveConversion: false,
        proofAccuracy: 'luminance-preview',
      },
      conversion: {
        flatteningRequiredForPress: true,
      },
    });
    expect(grayscale.profileWarnings).toContain('Requested proof profile "Gray Gamma 2.2" is retained as metadata only; ICC proof transforms are not applied.');
  });

  it('adds deterministic proof parity metadata for profile transforms, operation compatibility, preview IDs, and print warnings', () => {
    const cmykDoc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-plan-output',
      title: 'Output proof planning',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'US Web Coated SWOP',
    });

    const descriptor = buildImageColorProofPlanningDescriptor(cmykDoc);

    expect(descriptor.profileTransform).toEqual({
      status: 'unsupported',
      requestedProfileLabel: 'US Web Coated SWOP',
      iccConversionAvailable: false,
      transformIntentSupport: 'metadata-only',
      blockerCodes: [
        'icc-proof-transform-unavailable',
        'cmyk-proof-separation-external',
      ],
      limitations: [
        'Proof profiles are retained as labels only; ICC soft-proof transforms are not applied to preview pixels.',
        'CMYK rendering intents, gamut mapping, black generation, and TAC checks require an external proofing workflow.',
      ],
    });
    expect(descriptor.preview).toEqual({
      id: 'proof-preview:cmyk-soft-proof:relative-colorimetric:US Web Coated SWOP',
      pipeline: 'rgb-cmyk-proof-metadata',
      signature: 'proof:cmyk-soft-proof:relative-colorimetric:US Web Coated SWOP:rgb-cmyk-proof-metadata',
    });
    expect(descriptor.operationMatrix.export).toMatchObject({
      operation: 'export',
      supported: true,
      workingSpace: 'RGB',
      proofPolicy: 'metadata-only',
      previewImplication: 'cmyk-proof-metadata-preview',
      exportImplication: 'rgb-pixels-plus-proof-metadata',
      profileTransformBlockers: [
        'icc-proof-transform-unavailable',
        'cmyk-proof-separation-external',
      ],
      previewId: 'proof-op:cmyk-soft-proof:relative-colorimetric:export:metadata-only',
    });
    expect(descriptor.printOutputWarnings).toEqual([
      'Print/output warning: CMYK soft proof is not a press-ready separation; exported pixels remain RGB.',
      'Print/output warning: embed or assign press ICC profiles in an external prepress application before production handoff.',
    ]);
    expect(descriptor.warnings).toContain('Print/output warning: CMYK soft proof is not a press-ready separation; exported pixels remain RGB.');
  });

  it('exposes a deterministic ICC/proof handoff contract for external workflows and print readiness', () => {
    const doc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-contract',
      title: 'Proof contract',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'perceptual',
      profileLabel: 'Coated FOGRA39',
    });

    const descriptor = buildImageColorProofPlanningDescriptor(doc);

    expect(descriptor).toMatchObject({
      mode: 'cmyk-soft-proof',
      intent: 'perceptual',
      profileTransform: {
        status: 'unsupported',
      },
    });
    expect(descriptor.iccHandoffContract).toEqual({
      metadataOnly: true,
      externalIccRequired: true,
      printReady: false,
      handoffPolicy: 'icc-profile-metadata-only',
      warnings: [
        'Proof setup/profile labels are carried as handoff metadata only.',
        'ICC-converted proof and separations require an external color-managed workflow.',
        'Press conversions are not performed in-editor for CMYK soft-proof mode.',
      ],
    });
  });

  it('reports RGB screen-proof readiness separately from press/output readiness', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-proof-readiness-rgb',
      title: 'RGB readiness',
      width: 8,
      height: 8,
    });

    const readiness = describeImageColorProofReadiness(doc);

    expect(readiness).toMatchObject({
      descriptorId: 'image-color-proof-readiness:v1',
      ready: true,
      previewReady: true,
      pressReady: false,
      mode: 'rgb',
      intent: 'screen-rgb',
      profileLabel: null,
      previewState: {
        id: 'image-color-proof-readiness-preview:rgb:screen-rgb:unmanaged',
        pipeline: 'browser-rgb-canvas',
        readOnly: false,
        deterministic: true,
        gamutWarningAvailable: false,
        signature: 'image-color-proof-readiness-preview:v1:rgb:screen-rgb:browser-rgb-canvas:unmanaged:editable',
      },
      profile: {
        profileLabel: null,
        metadataOnly: false,
        iccTransformAvailable: false,
      },
      blockers: [],
    });
    expect(readiness.printExport).toEqual({
      exportPixelSpace: 'RGB',
      proofMetadataEmbedded: false,
      nativeCmykExport: false,
      pressReady: false,
      implications: [
        'RGB screen proof exports RGB pixels; press-managed CMYK or grayscale conversion remains external.',
      ],
    });
    expect(readiness.previewSignature).toBe('image-color-proof-readiness:v1:{"mode":"rgb","intent":"screen-rgb","profileLabel":"unmanaged","previewReadOnly":false,"gamutWarningAvailable":false,"blockers":[]}');
  });

  it('reports soft-proof readiness blockers for profile metadata, gamut warnings, read-only previews, conversion, and export', () => {
    const cmykDoc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-readiness-cmyk',
      title: 'CMYK readiness',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'US Web Coated SWOP',
    });
    const grayDoc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-readiness-gray',
      title: 'Gray readiness',
      width: 8,
      height: 8,
    }), {
      mode: 'grayscale-soft-proof',
      intent: 'grayscale-luminance',
      profileLabel: 'Gray Gamma 2.2',
    });

    const cmyk = describeImageColorProofReadiness(cmykDoc);
    const gray = describeImageColorProofReadiness(grayDoc);

    expect(cmyk).toMatchObject({
      descriptorId: 'image-color-proof-readiness:v1',
      ready: false,
      previewReady: true,
      pressReady: false,
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'US Web Coated SWOP',
      previewState: {
        id: 'image-color-proof-readiness-preview:cmyk-soft-proof:relative-colorimetric:US Web Coated SWOP',
        pipeline: 'rgb-cmyk-proof-metadata',
        readOnly: true,
        deterministic: true,
        gamutWarningAvailable: false,
        signature: 'image-color-proof-readiness-preview:v1:cmyk-soft-proof:relative-colorimetric:rgb-cmyk-proof-metadata:US Web Coated SWOP:read-only',
      },
      profile: {
        profileLabel: 'US Web Coated SWOP',
        metadataOnly: true,
        iccTransformAvailable: false,
      },
    });
    expect(cmyk.conversionBlockers).toEqual([
      {
        code: 'external-proof-conversion-required',
        category: 'conversion',
        message: 'CMYK soft proof requires external ICC-managed conversion/separation for press-ready output.',
      },
    ]);
    expect(cmyk.metadataOnlyBlockers).toEqual([
      {
        code: 'proof-profile-metadata-only',
        category: 'metadata-only',
        message: 'Proof profile "US Web Coated SWOP" is stored as metadata only; preview pixels are not ICC transformed.',
      },
      {
        code: 'gamut-warning-unavailable',
        category: 'metadata-only',
        message: 'Gamut warning state is unavailable for CMYK soft proof previews.',
      },
      {
        code: 'export-proof-metadata-only',
        category: 'metadata-only',
        message: 'Export keeps RGB pixels and stores CMYK proof setup as metadata only.',
      },
    ]);
    expect(cmyk.printExport).toEqual({
      exportPixelSpace: 'RGB',
      proofMetadataEmbedded: true,
      nativeCmykExport: false,
      pressReady: false,
      implications: [
        'CMYK soft proof is not a press-ready separation; exported pixels remain RGB.',
        'Embed or assign press ICC profiles in an external prepress application before production handoff.',
      ],
    });
    expect(cmyk.blockers.map((blocker) => blocker.code)).toEqual([
      'external-proof-conversion-required',
      'proof-profile-metadata-only',
      'gamut-warning-unavailable',
      'export-proof-metadata-only',
      'native-proof-export-unavailable',
    ]);
    expect(cmyk.previewSignature).toBe('image-color-proof-readiness:v1:{"mode":"cmyk-soft-proof","intent":"relative-colorimetric","profileLabel":"US Web Coated SWOP","previewReadOnly":true,"gamutWarningAvailable":false,"blockers":["external-proof-conversion-required","proof-profile-metadata-only","gamut-warning-unavailable","export-proof-metadata-only","native-proof-export-unavailable"]}');

    expect(gray.previewState).toMatchObject({
      pipeline: 'rgb-luminance-soft-proof',
      readOnly: true,
      gamutWarningAvailable: false,
    });
    expect(gray.conversionBlockers).toEqual([
      {
        code: 'external-proof-conversion-required',
        category: 'conversion',
        message: 'Grayscale soft proof requires external ICC-managed grayscale conversion for press-ready output.',
      },
    ]);
    expect(gray.printExport.implications).toContain('Grayscale soft proof is not a press-managed grayscale conversion; exported pixels remain RGB.');
  });

  it('exposes proof action and batch suitability with print handoff caveats', () => {
    const doc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-operational-cmyk',
      title: 'CMYK proof operations',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'perceptual',
      profileLabel: 'Coated FOGRA39',
    });
    const rgbDoc = createEmptyImageDocument({
      id: 'doc-proof-operational-rgb',
      title: 'RGB proof operations',
      width: 8,
      height: 8,
    });

    const cmyk = describeImageColorProofOperationalReadiness(doc);
    const rgb = describeImageColorProofOperationalReadiness(rgbDoc);

    expect(cmyk).toMatchObject({
      descriptorId: 'image-color-proof-operational-readiness:v1',
      state: {
        mode: 'cmyk-soft-proof',
        intent: 'perceptual',
        proofLabel: 'Perceptual CMYK proof',
        profileLabel: 'Coated FOGRA39',
        nativeWorkingSpace: 'RGB',
      },
      policy: {
        previewPolicy: 'preview-only',
        conversionPolicy: 'external-proof-conversion-required',
        profilePolicy: 'metadata-only',
        exportPolicy: 'rgb-pixels-plus-proof-metadata',
      },
      actionSuitability: {
        recordable: true,
        deterministic: true,
        destructiveRisk: 'metadata-only-proof',
      },
      batchSuitability: {
        suitable: false,
        reason: 'Batch proof handoff requires external ICC-managed conversion/separation before production output.',
      },
    });
    expect(cmyk.iccProfileLimitations).toContain('Proof profile "Coated FOGRA39" is stored as metadata only; preview pixels are not ICC transformed.');
    expect(cmyk.previewAndGamutCaveats).toContain('Gamut warnings are not computed by the saved CMYK proof metadata; run the live ICC proof and gamut check for the rendered warning overlay.');
    expect(cmyk.exportPrintCaveats).toContain('CMYK soft proof is not a press-ready separation; exported pixels remain RGB.');
    expect(cmyk.unsupportedPhotoshopStates).toEqual([
      'ICC soft-proof transforms',
      'out-of-gamut warning overlay',
      'native CMYK proof export/separations',
      'black generation/TAC proof checks',
    ]);
    expect(cmyk.suiteHandoffGuidance).toEqual([
      'Keep proof presets attached as metadata when handing work to Flow, Video, or external print apps.',
      'Run final ICC conversion and CMYK separation outside Sloom Studio before production handoff.',
      'Do not treat the soft-proof preview as native CMYK evidence in automated suites.',
    ]);
    expect(cmyk.signature).toBe('image-color-proof-operational-readiness:v1:cmyk-soft-proof:perceptual:Coated FOGRA39:blocked');

    expect(rgb).toMatchObject({
      ready: true,
      policy: {
        previewPolicy: 'native',
        conversionPolicy: 'none',
        profilePolicy: 'browser-rgb-only',
      },
      batchSuitability: {
        suitable: true,
        reason: 'RGB screen-proof metadata is deterministic and can be included in recorded actions.',
      },
      unsupportedPhotoshopStates: [
        'custom display-profile transforms',
      ],
    });
    expect(rgb.suiteHandoffGuidance).toEqual([
      'RGB proof stays editable in-suite; downstream consumers can reuse the same 8-bit RGB pixels.',
      'Attach any display/profile labels as guidance only because preview pixels are not ICC transformed.',
    ]);
  });

  it('adds bounded proof operation descriptors for preview/export implications and profile transform blockers', () => {
    const grayscaleDoc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-bounded-gray',
      title: 'Gray bounded proof',
      width: 8,
      height: 8,
    }), {
      mode: 'grayscale-soft-proof',
      intent: 'grayscale-luminance',
      profileLabel: 'Gray Gamma 2.2',
    });
    const rgbDoc = createEmptyImageDocument({
      id: 'doc-proof-bounded-rgb',
      title: 'RGB bounded proof',
      width: 8,
      height: 8,
    });

    const grayscalePlanning = buildImageColorProofPlanningDescriptor(grayscaleDoc);
    const grayscaleOperational = describeImageColorProofOperationalReadiness(grayscaleDoc);
    const rgbPlanning = buildImageColorProofPlanningDescriptor(rgbDoc);

    expect(grayscalePlanning.profileTransform.blockerCodes).toEqual([
      'icc-proof-transform-unavailable',
      'grayscale-proof-conversion-external',
    ]);
    expect(grayscalePlanning.operationMatrix.paint).toMatchObject({
      previewImplication: 'luminance-soft-proof-preview',
      exportImplication: 'rgb-pixels-only',
      profileTransformBlockers: [
        'icc-proof-transform-unavailable',
        'grayscale-proof-conversion-external',
      ],
    });
    expect(grayscaleOperational.exportPrintCaveats).toEqual([
      'Grayscale soft proof is not a press-managed grayscale conversion; exported pixels remain RGB.',
      'Convert grayscale through an external ICC-managed workflow before production handoff.',
    ]);
    expect(rgbPlanning.profileTransform.blockerCodes).toEqual([
      'browser-rgb-proof-only',
    ]);
    expect(rgbPlanning.operationMatrix.export).toMatchObject({
      previewImplication: 'native-rgb-preview',
      exportImplication: 'rgb-pixels-only',
      profileTransformBlockers: ['browser-rgb-proof-only'],
    });
  });

  it('carries proof readiness operation caveats and honest unsupported proof states', () => {
    const cmykDoc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-caveats-cmyk',
      title: 'CMYK proof caveats',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'US Web Coated SWOP',
    });

    const readiness = describeImageColorProofReadiness(cmykDoc);

    expect(readiness.operationCaveats.paint).toEqual([
      'Paint edits RGB pixels while the saved CMYK proof selection remains legacy metadata.',
      'No ICC proof transform, gamut clipping, black generation, or TAC check is applied by this saved setup before paint.',
      'Proof profile "US Web Coated SWOP" remains metadata-only; preview pixels are not ICC transformed.',
    ]);
    expect(readiness.operationCaveats.export).toEqual([
      'Export writes RGB pixels plus CMYK proof metadata only; no ICC separation, black generation, TAC check, or native CMYK file is produced.',
      'Proof profile "US Web Coated SWOP" remains metadata-only; no ICC profile is embedded or converted on export.',
    ]);
    expect(readiness.unsupportedStates).toEqual([
      {
        code: 'icc-proof-transform',
        message: 'The saved CMYK proof setup does not execute ICC transforms; run the live ICC proof and gamut check for a rendered read-only LCMS preview.',
      },
      {
        code: 'gamut-warning-overlay',
        message: 'Out-of-gamut warning overlays are unsupported; gamutWarningAvailable stays false.',
      },
      {
        code: 'native-cmyk-proof-export',
        message: 'Native CMYK proof export/separations are unsupported; exports remain RGB plus proof metadata.',
      },
      {
        code: 'black-generation-tac-check',
        message: 'Black generation and total area coverage checks are unsupported in CMYK soft proof mode.',
      },
    ]);
  });

  it('describes unsupported press-ready separations as typed proof readiness metadata', () => {
    const cmykDoc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-separation-readiness',
      title: 'Separation readiness',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'US Web Coated SWOP',
    });

    const readiness = describeImageColorProofReadiness(cmykDoc);

    expect(readiness.separations).toEqual({
      requested: 'process-cmyk',
      nativeSeparationAvailable: false,
      outputPixelSpace: 'RGB',
      pressReady: false,
      externalRequired: true,
      unsupported: [
        {
          code: 'process-cmyk-separations',
          message: 'CMYK process plates are not generated; this saved proof selection is legacy metadata, not a rendered ICC preview.',
        },
        {
          code: 'spot-color-plates',
          message: 'Spot-color plates are unsupported by color proof readiness and must be produced externally.',
        },
        {
          code: 'icc-output-profile-conversion',
          message: 'ICC output-profile conversion is unavailable; requested proof profiles remain metadata only.',
        },
        {
          code: 'black-generation-tac-check',
          message: 'Black generation and total area coverage checks are not computed for press readiness.',
        },
      ],
      signature: 'image-color-proof-separations:v1|mode=cmyk-soft-proof|intent=relative-colorimetric|profile=US Web Coated SWOP|requested=process-cmyk|supported=false|unsupported=process-cmyk-separations,spot-color-plates,icc-output-profile-conversion,black-generation-tac-check',
    });
    expect(readiness.blockers.map((blocker) => blocker.code)).toContain('native-proof-export-unavailable');
  });

  it('describes high-bit source implications for soft proofing without overstating proof accuracy', () => {
    const doc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-high-bit',
      title: 'High-bit proof',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'perceptual',
      profileLabel: 'Coated FOGRA39',
    });

    const descriptor = describeImageColorProofHighBitImplications(doc, {
      sourceFormat: '16-bit TIFF',
      sourceBitDepth: 16,
    });

    expect(descriptor).toEqual({
      descriptorId: 'image-color-proof-high-bit-implications:v1',
      proofMode: 'cmyk-soft-proof',
      proofIntent: 'perceptual',
      profileLabel: 'Coated FOGRA39',
      sourceFormat: '16-bit TIFF',
      sourceBitDepth: 16,
      proofPreviewBitDepth: 8,
      exportBitDepth: 8,
      proofDoesNotPreserveHighBitDepth: true,
      proofMetadataOnly: true,
      exportPixelSpace: 'RGB',
      implicationMatrix: {
        preview: {
          supported: true,
          precision: '8-bit legacy CMYK proof metadata',
          caveat: 'The saved CMYK proof setup does not render source pixels; 16-bit source precision and ICC gamut mapping require the live ICC proof or external proofing.',
        },
        export: {
          supported: true,
          precision: '8-bit RGB export plus proof metadata',
          caveat: 'Export writes RGB pixels plus CMYK proof metadata only; no 16-bit CMYK separation or ICC proof transform is produced.',
        },
        gamutWarning: {
          supported: false,
          precision: 'unavailable',
          caveat: 'Gamut warnings are unavailable for high-bit CMYK proof handoff; use an external color-managed proofing tool.',
        },
      },
      fallbackRecommendations: [
        {
          route: 'external-high-bit-color-managed-proof',
          label: 'External high-bit proof',
          preserves: '16-bit precision, ICC soft-proof transform, gamut warning, and press separation checks',
          recommendedFor: 'Production print proofing, archive masters, and color-critical review.',
          caveat: 'Sloom Studio proof metadata can guide setup, but it is not production proof evidence.',
        },
        {
          route: '8bit-rgb-proof-derivative',
          label: '8-bit RGB proof derivative',
          preserves: 'screen-visible approximation for Image, Flow, Video, and Paper handoff',
          recommendedFor: 'Suite preview or storyboard review after accepting high-bit precision loss.',
          caveat: 'Derivative proof cannot validate out-of-gamut colors, TAC, black generation, or high-bit gradients.',
        },
        {
          route: 'keep-high-bit-master',
          label: 'Keep high-bit master',
          preserves: 'the original 16-bit TIFF source for re-proofing and final output',
          recommendedFor: 'Any downstream workflow that may need revised color management.',
          caveat: 'Image edits do not update the retained high-bit master automatically.',
        },
      ],
      unsupportedStates: [
        {
          code: 'high-bit-proof-transform',
          message: '16-bit ICC proof transforms are unsupported; previews use an 8-bit RGB derivative.',
        },
        {
          code: 'high-bit-proof-export',
          message: '16-bit proof export/separations are unsupported; exports remain 8-bit RGB plus metadata.',
        },
        {
          code: 'high-bit-gamut-warning',
          message: 'High-bit gamut warning overlays are unsupported in Image proof readiness.',
        },
      ],
      stableSignature: 'image-color-proof-high-bit-implications:v1|mode=cmyk-soft-proof|intent=perceptual|profile=Coated FOGRA39|format=16-bit TIFF|bits=16|preview=8|export=8|unsupported=high-bit-proof-transform,high-bit-proof-export,high-bit-gamut-warning',
    });
  });

  it('describes read-only proof state without implying destructive conversion or press checks', () => {
    const cmykDoc = applyImageColorProofSetup(createEmptyImageDocument({
      id: 'doc-proof-read-only-cmyk',
      title: 'Read-only CMYK proof',
      width: 8,
      height: 8,
    }), {
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'US Web Coated SWOP',
    });
    const rgbDoc = createEmptyImageDocument({
      id: 'doc-proof-read-only-rgb',
      title: 'Read-only RGB proof',
      width: 8,
      height: 8,
    });

    const cmyk = describeImageColorProofReadOnlyState(cmykDoc);
    const rgb = describeImageColorProofReadOnlyState(rgbDoc);

    expect(cmyk).toEqual({
      descriptorId: 'image-color-proof-read-only-state:v1',
      mode: 'cmyk-soft-proof',
      intent: 'relative-colorimetric',
      profileLabel: 'US Web Coated SWOP',
      state: {
        readOnly: true,
        deterministic: true,
        editablePixelSpace: 'RGB',
        proofChangesPixels: false,
        previewAccuracy: 'metadata-only',
        gamutWarningAvailable: false,
        signature: 'image-color-proof-read-only-state-preview:v1:cmyk-soft-proof:relative-colorimetric:US Web Coated SWOP:read-only:metadata-only',
      },
      separations: {
        nativeSeparationAvailable: false,
        outputPixelSpace: 'RGB',
        blackGenerationAvailable: false,
        totalAreaCoverageCheckAvailable: false,
        dotGainCheckAvailable: false,
        overprintSimulationAvailable: false,
        caveats: [
          'CMYK process plates are not generated; this saved proof selection remains legacy metadata until a live ICC proof is run.',
          'Black generation and total area coverage checks are not computed for press readiness.',
          'Overprint simulation is unavailable; validate overprint and ink limits externally.',
        ],
      },
      operationMatrix: {
        paint: {
          operation: 'paint',
          editsPixelSpace: 'RGB',
          proofReadOnly: true,
          proofPolicy: 'preview-only',
          actionRecordable: true,
          batchSuitable: false,
          caveats: [
            'Paint edits RGB pixels while the saved CMYK proof selection remains legacy metadata.',
            'No ICC proof transform, gamut clipping, black generation, or TAC check is applied by this saved setup before paint.',
            'Proof profile "US Web Coated SWOP" remains metadata-only; preview pixels are not ICC transformed.',
          ],
        },
        adjustments: {
          operation: 'adjustments',
          editsPixelSpace: 'RGB',
          proofReadOnly: true,
          proofPolicy: 'preview-only',
          actionRecordable: true,
          batchSuitable: false,
          caveats: [
            'Adjustments edits RGB pixels while the saved CMYK proof selection remains legacy metadata.',
            'No ICC proof transform, gamut clipping, black generation, or TAC check is applied by this saved setup before adjustments.',
            'Proof profile "US Web Coated SWOP" remains metadata-only; preview pixels are not ICC transformed.',
          ],
        },
        filters: {
          operation: 'filters',
          editsPixelSpace: 'RGB',
          proofReadOnly: true,
          proofPolicy: 'preview-only',
          actionRecordable: true,
          batchSuitable: false,
          caveats: [
            'Filters edits RGB pixels while the saved CMYK proof selection remains legacy metadata.',
            'No ICC proof transform, gamut clipping, black generation, or TAC check is applied by this saved setup before filters.',
            'Proof profile "US Web Coated SWOP" remains metadata-only; preview pixels are not ICC transformed.',
          ],
        },
        export: {
          operation: 'export',
          editsPixelSpace: 'RGB',
          proofReadOnly: true,
          proofPolicy: 'metadata-only',
          actionRecordable: true,
          batchSuitable: false,
          caveats: [
            'Export writes RGB pixels plus CMYK proof metadata only; no ICC separation, black generation, TAC check, or native CMYK file is produced.',
            'Proof profile "US Web Coated SWOP" remains metadata-only; no ICC profile is embedded or converted on export.',
          ],
        },
      },
      actionSuitability: {
        suitable: false,
        recordable: true,
        deterministic: true,
        destructiveRisk: 'metadata-only-proof',
      },
      batchSuitability: {
        suitable: false,
        reason: 'Batch proof handoff requires external ICC-managed conversion/separation before production output.',
      },
      stableSignature: 'image-color-proof-read-only-state:v1|mode=cmyk-soft-proof|intent=relative-colorimetric|profile=US Web Coated SWOP|readOnly=true|accuracy=metadata-only|ops=paint:preview-only:read-only,adjustments:preview-only:read-only,filters:preview-only:read-only,export:metadata-only:read-only',
    });

    expect(rgb.state).toMatchObject({
      readOnly: false,
      editablePixelSpace: 'RGB',
      proofChangesPixels: false,
      previewAccuracy: 'native-rgb',
      gamutWarningAvailable: false,
    });
    expect(rgb.batchSuitability).toEqual({
      suitable: true,
      reason: 'RGB screen-proof metadata is deterministic and can be included in recorded actions.',
    });
  });
});
