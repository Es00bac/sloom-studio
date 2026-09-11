import { describe, expect, it } from 'vitest';
import {
  buildColorModeConversionWarnings,
  buildRgbCmykSeparationPreview,
  convertRgbToGrayscalePreview,
  describeImageBitDepthDocumentReadiness,
  describeImageHighBitWorkflowSupportMatrix,
  describeColorModePlanningDescriptor,
  describeImageColorModeOperationalReadiness,
  describeImageColorModeReadiness,
  describeImageNonRgbColorModeSupportMatrix,
  describeColorModeWorkflow,
  describeColorModeChannels,
  getColorModeOperationPolicy,
} from './ImageColorModes';

describe('ImageColorModes', () => {
  it('converts RGB pixels to deterministic luminance grayscale while preserving alpha', () => {
    const preview = convertRgbToGrayscalePreview({
      width: 3,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 255, 0, 128,
        0, 0, 255, 0,
      ]),
    });

    expect(preview).toMatchObject({
      width: 3,
      height: 1,
      colorMode: 'grayscale-preview',
      channelLabel: 'Luminance Gray',
    });
    expect(Array.from(preview.data)).toEqual([
      54, 54, 54, 255,
      182, 182, 182, 128,
      18, 18, 18, 0,
    ]);
    expect(Array.from(preview.gray)).toEqual([54, 182, 18]);
    expect(preview.warnings).toContain('Grayscale preview uses deterministic RGB luminance and does not apply an ICC grayscale profile.');
  });

  it('builds deterministic CMYK separation preview channels from RGB pixels without claiming native CMYK export', () => {
    const preview = buildRgbCmykSeparationPreview({
      width: 4,
      height: 1,
      data: new Uint8ClampedArray([
        255, 0, 0, 255,
        255, 255, 255, 255,
        0, 0, 0, 255,
        64, 128, 192, 200,
      ]),
    });

    expect(preview).toMatchObject({
      width: 4,
      height: 1,
      colorMode: 'cmyk-separation-preview',
      nativeCmykExport: false,
      profileLabel: 'Device RGB formula preview',
    });
    expect(preview.channels.map((channel) => channel.id)).toEqual(['cyan', 'magenta', 'yellow', 'black']);
    expect(preview.channels.map((channel) => channel.label)).toEqual(['Cyan', 'Magenta', 'Yellow', 'Black']);
    expect(preview.unsupportedModes).toEqual(['lab', 'indexed']);
    expect(preview.warnings).toContain('CMYK separations are formula previews from RGB pixels; ICC transforms and native CMYK export remain unavailable.');
    expect(Array.from(preview.channels[0].data)).toEqual([0, 0, 0, 170]);
    expect(Array.from(preview.channels[1].data)).toEqual([255, 0, 0, 85]);
    expect(Array.from(preview.channels[2].data)).toEqual([255, 0, 0, 0]);
    expect(Array.from(preview.channels[3].data)).toEqual([0, 0, 255, 63]);
    expect(Array.from(preview.alpha)).toEqual([255, 255, 255, 200]);
  });

  it('describes channel previews without overstating native non-RGB color mode support', () => {
    expect(describeColorModeChannels('rgb')).toMatchObject({
      colorMode: 'rgb',
      previewKind: 'native',
      channels: [
        { id: 'composite', label: 'Composite RGB', previewRole: 'composite' },
        { id: 'red', label: 'Red', previewRole: 'channel' },
        { id: 'green', label: 'Green', previewRole: 'channel' },
        { id: 'blue', label: 'Blue', previewRole: 'channel' },
      ],
    });

    expect(describeColorModeChannels('grayscale')).toMatchObject({
      colorMode: 'grayscale',
      previewKind: 'rgb-preview-only',
      channels: [
        { id: 'gray', label: 'Luminance Gray', previewRole: 'channel' },
      ],
      warnings: [
        'Grayscale mode is previewed through RGB luminance only; no native grayscale document mode or ICC grayscale conversion is available.',
      ],
    });

    expect(describeColorModeChannels('cmyk')).toMatchObject({
      colorMode: 'cmyk',
      previewKind: 'rgb-preview-only',
      channels: [
        { id: 'cyan', label: 'Cyan', previewRole: 'channel' },
        { id: 'magenta', label: 'Magenta', previewRole: 'channel' },
        { id: 'yellow', label: 'Yellow', previewRole: 'channel' },
        { id: 'black', label: 'Black', previewRole: 'channel' },
      ],
      warnings: [
        'CMYK channels are formula previews from RGB pixels; no ICC CMYK conversion or native CMYK document mode is available.',
      ],
    });

    expect(describeColorModeChannels('lab')).toMatchObject({
      colorMode: 'lab',
      previewKind: 'unsupported',
      channels: [],
      warnings: ['Lab channel previews are not available because Sloom Studio does not implement native Lab conversion or editing.'],
    });

    expect(describeColorModeChannels('indexed')).toMatchObject({
      colorMode: 'indexed',
      previewKind: 'unsupported',
      channels: [],
      warnings: ['Indexed color preview is not available because palette-preserving indexed workflows are not implemented.'],
    });
  });

  it('reports operation workflow policy for RGB, grayscale, CMYK, Lab, indexed, and high-bit-depth sources', () => {
    expect(getColorModeOperationPolicy({ colorMode: 'rgb', bitDepth: 8, operation: 'paint' })).toMatchObject({
      colorMode: 'rgb',
      bitDepth: 8,
      operation: 'paint',
      supported: true,
      workflow: 'native',
      constraintCode: 'native-8bit-rgb',
      externalConversionRequired: false,
      exportImplication: 'native-rgb-export',
      warnings: [],
    });

    expect(getColorModeOperationPolicy({ colorMode: 'rgb', bitDepth: 16, operation: 'adjustments' })).toMatchObject({
      colorMode: 'rgb',
      bitDepth: 16,
      operation: 'adjustments',
      supported: false,
      workflow: 'convert-to-8bit-rgb',
      constraintCode: 'high-bit-rgb-downsample',
      externalConversionRequired: false,
      exportImplication: 'downgraded-rgb-export',
      warnings: ['16-bit RGB sources must be reduced to 8-bit RGB before adjustments run; highlight and gradient precision will be lost.'],
    });

    expect(getColorModeOperationPolicy({ colorMode: 'rgb', bitDepth: 32, operation: 'filters' })).toMatchObject({
      colorMode: 'rgb',
      bitDepth: 32,
      operation: 'filters',
      supported: false,
      workflow: 'convert-to-8bit-rgb',
      constraintCode: 'high-bit-rgb-downsample',
      externalConversionRequired: false,
      exportImplication: 'downgraded-rgb-export',
      warnings: ['32-bit RGB sources must be tone-mapped down to 8-bit RGB before filters run; HDR and floating-point precision will be lost.'],
    });

    expect(getColorModeOperationPolicy({ colorMode: 'grayscale', bitDepth: 8, operation: 'paint' })).toMatchObject({
      colorMode: 'grayscale',
      bitDepth: 8,
      operation: 'paint',
      supported: false,
      workflow: 'convert-to-8bit-rgb',
      constraintCode: 'grayscale-rgb-conversion',
      externalConversionRequired: true,
      exportImplication: 'rgb-export-after-conversion',
      warnings: ['Grayscale documents are edited through RGB conversion only; native grayscale paint and channel math are unavailable.'],
    });

    expect(getColorModeOperationPolicy({ colorMode: 'cmyk', bitDepth: 8, operation: 'paint' })).toMatchObject({
      colorMode: 'cmyk',
      bitDepth: 8,
      operation: 'paint',
      supported: false,
      workflow: 'rgb-preview-only',
      constraintCode: 'cmyk-proof-preview-only',
      externalConversionRequired: true,
      exportImplication: 'rgb-export-with-proof-metadata',
      warnings: ['CMYK editing is unavailable; only RGB-based soft proof metadata and formula channel previews exist.'],
    });

    expect(getColorModeOperationPolicy({ colorMode: 'lab', bitDepth: 8, operation: 'export' })).toMatchObject({
      colorMode: 'lab',
      bitDepth: 8,
      operation: 'export',
      supported: false,
      workflow: 'unsupported',
      constraintCode: 'lab-external-conversion',
      externalConversionRequired: true,
      exportImplication: 'external-export-required',
      warnings: ['Lab workflows are not implemented, so exports must convert elsewhere before entering Sloom Studio.'],
    });

    expect(getColorModeOperationPolicy({ colorMode: 'indexed', bitDepth: 8, operation: 'paint' })).toMatchObject({
      colorMode: 'indexed',
      bitDepth: 8,
      operation: 'paint',
      supported: false,
      workflow: 'convert-to-8bit-rgb',
      constraintCode: 'indexed-palette-expansion',
      externalConversionRequired: true,
      exportImplication: 'rgb-export-after-conversion',
      warnings: ['Indexed color is not preserved during editing; convert to RGB first and expect palette loss.'],
    });
  });

  it('builds explicit conversion and export warnings for unsupported modes and bit-depth loss', () => {
    expect(buildColorModeConversionWarnings({
      fromMode: 'cmyk',
      toMode: 'rgb',
      fromBitDepth: 8,
      toBitDepth: 8,
    })).toEqual([
      'CMYK to RGB conversion inside Sloom Studio is only a formula preview; use an external ICC-aware tool for press-accurate conversion.',
    ]);

    expect(buildColorModeConversionWarnings({
      fromMode: 'grayscale',
      toMode: 'rgb',
      fromBitDepth: 16,
      toBitDepth: 8,
    })).toEqual([
      'Grayscale sources convert through luminance-only RGB preview data; no ICC grayscale transform is applied.',
      'Converting from 16-bit to 8-bit discards high-bit-depth precision and can introduce banding in soft gradients.',
    ]);

    expect(buildColorModeConversionWarnings({
      fromMode: 'indexed',
      toMode: 'rgb',
      fromBitDepth: 8,
      toBitDepth: 8,
    })).toEqual([
      'Indexed color conversion expands palette entries into flat RGB pixels; palette tables and exact index values are not preserved.',
    ]);

    expect(buildColorModeConversionWarnings({
      fromMode: 'rgb',
      toMode: 'rgb',
      fromBitDepth: 32,
      toBitDepth: 8,
    })).toEqual([
      'Converting from 32-bit to 8-bit removes HDR/floating-point precision and clamps the workflow to standard dynamic range RGB.',
    ]);

    expect(buildColorModeConversionWarnings({
      fromMode: 'lab',
      toMode: 'rgb',
      fromBitDepth: 8,
      toBitDepth: 8,
    })).toEqual([
      'Lab conversion is not implemented in Sloom Studio; move the document through an external color-managed app before editing here.',
    ]);
  });

  it('adds suite-safe handoff guidance for unsupported native color modes and high-bit workflows', () => {
    const cmyk = describeImageColorModeOperationalReadiness({
      colorMode: 'cmyk',
      bitDepth: 16,
      profileLabel: 'Coated FOGRA39',
    });
    const lab = describeImageColorModeOperationalReadiness({
      colorMode: 'lab',
      bitDepth: 32,
      profileLabel: 'Lab D50',
    });

    expect(cmyk.state).toMatchObject({
      nativeDocumentMode: false,
      modeLabel: 'CMYK',
      bitDepth: 16,
    });
    expect(cmyk.bitDepthPreservation).toEqual({
      sourceBitDepth: 16,
      preserved: false,
      blockers: [
        '16-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.',
        '16-bit editing and export are unsupported; edits and exported files use 8-bit RGB precision.',
      ],
    });
    expect(cmyk.suiteHandoffGuidance).toEqual([
      'Convert documents to 8-bit RGB before recording shared Image actions for other workspaces.',
      'Treat CMYK proof/profile labels as handoff metadata only; downstream apps must perform real separations.',
      'Keep a native master outside Sloom Studio when 16-bit precision must survive handoff.',
    ]);

    expect(lab.state).toMatchObject({
      nativeDocumentMode: false,
      modeLabel: 'Lab',
      bitDepth: 32,
    });
    expect(lab.actionSuitability.destructiveRisk).toBe('unsupported');
    expect(lab.suiteHandoffGuidance).toEqual([
      'Convert documents to 8-bit RGB before recording shared Image actions for other workspaces.',
      'Lab documents must be converted in an external color-managed app before suite handoff.',
      'Keep a native master outside Sloom Studio when 32-bit precision must survive handoff.',
    ]);
  });

  it('builds deterministic workflow descriptors for preview, ICC limits, operations, and print handoff', () => {
    const rgb = describeColorModeWorkflow({
      colorMode: 'rgb',
      bitDepth: 8,
      profileLabel: 'sRGB IEC61966-2.1',
    });
    const grayscale = describeColorModeWorkflow({
      colorMode: 'grayscale',
      bitDepth: 16,
      profileLabel: 'Gray Gamma 2.2',
    });
    const cmyk = describeColorModeWorkflow({
      colorMode: 'cmyk',
      bitDepth: 8,
      profileLabel: 'Coated FOGRA39',
    });

    expect(rgb).toMatchObject({
      colorMode: 'rgb',
      bitDepth: 8,
      preview: {
        colorMode: 'rgb',
        previewKind: 'native',
        pipeline: 'browser-rgb-canvas',
      },
      profile: {
        requestedProfileLabel: 'sRGB IEC61966-2.1',
        iccTransformAvailable: false,
        appliedPolicy: 'browser-rgb-only',
      },
      operations: {
        paint: { supported: true, workflow: 'native' },
        export: { supported: true, workflow: 'native' },
      },
      print: {
        pressReady: false,
      },
    });
    expect(rgb.profile.limitations).toContain('ICC profiles are retained as labels only; browser canvas compositing does not apply custom profile transforms.');
    expect(rgb.print.warnings).toContain('RGB output is screen-oriented; make press CMYK separations in an external ICC-managed print workflow.');

    expect(grayscale).toMatchObject({
      colorMode: 'grayscale',
      bitDepth: 16,
      preview: {
        colorMode: 'grayscale',
        previewKind: 'rgb-preview-only',
        pipeline: 'rgb-luminance-preview',
      },
      profile: {
        requestedProfileLabel: 'Gray Gamma 2.2',
        iccTransformAvailable: false,
        appliedPolicy: 'label-only',
      },
      operations: {
        paint: { supported: false, workflow: 'convert-to-8bit-rgb' },
        adjustments: { supported: false, workflow: 'convert-to-8bit-rgb' },
      },
      print: {
        pressReady: false,
      },
    });
    expect(grayscale.profile.limitations).toContain('Grayscale ICC profiles are not applied; previews use deterministic RGB luminance.');
    expect(grayscale.print.warnings).toContain('Grayscale preview is not a press-managed grayscale conversion; export RGB and convert externally for print.');

    expect(cmyk).toMatchObject({
      colorMode: 'cmyk',
      bitDepth: 8,
      preview: {
        colorMode: 'cmyk',
        previewKind: 'rgb-preview-only',
        pipeline: 'rgb-formula-cmyk-preview',
      },
      profile: {
        requestedProfileLabel: 'Coated FOGRA39',
        iccTransformAvailable: false,
        appliedPolicy: 'label-only',
      },
      operations: {
        paint: { supported: false, workflow: 'rgb-preview-only' },
        export: { supported: false, workflow: 'rgb-preview-only' },
      },
      print: {
        pressReady: false,
      },
    });
    expect(cmyk.profile.limitations).toContain('CMYK ICC profiles are not applied; separations use a deterministic Device RGB formula preview.');
    expect(cmyk.print.warnings).toContain('CMYK preview is not a press-ready separation; use an external ICC-managed CMYK export for production print.');
  });

  it('summarizes per-mode capability, flattening, precision, preview, and signature fields for future UI planning', () => {
    const rgb = describeColorModePlanningDescriptor({
      colorMode: 'rgb',
      bitDepth: 8,
      profileLabel: 'sRGB IEC61966-2.1',
    });
    const cmyk = describeColorModePlanningDescriptor({
      colorMode: 'cmyk',
      bitDepth: 16,
      profileLabel: 'Coated FOGRA39',
    });
    const lab = describeColorModePlanningDescriptor({
      colorMode: 'lab',
      bitDepth: 32,
      profileLabel: 'Lab D50',
    });
    const indexed = describeColorModePlanningDescriptor({
      colorMode: 'indexed',
      bitDepth: 8,
    });

    expect(rgb).toMatchObject({
      modeLabel: 'RGB',
      capability: {
        status: 'native',
        canEditPixels: true,
        canPreviewComposite: true,
        canExportWithoutConversion: true,
        channelCount: 3,
      },
      conversion: {
        required: false,
        flatteningRequired: false,
        targetMode: 'rgb',
        targetBitDepth: 8,
      },
      precision: {
        sourceBitDepth: 8,
        workingBitDepth: 8,
        channelPrecision: '8-bit integer channels',
      },
      preview: {
        pipeline: 'browser-rgb-canvas',
        signature: 'rgb:8:browser-rgb-canvas:sRGB IEC61966-2.1',
      },
      signature: 'mode-plan:rgb:8:sRGB IEC61966-2.1:native',
    });

    expect(cmyk).toMatchObject({
      modeLabel: 'CMYK',
      capability: {
        status: 'preview-only',
        canEditPixels: false,
        canPreviewComposite: true,
        canExportWithoutConversion: false,
        channelCount: 4,
      },
      conversion: {
        required: true,
        flatteningRequired: true,
        targetMode: 'rgb',
        targetBitDepth: 8,
        limitations: [
          'CMYK conversion is a flattened RGB formula preview; spot inks, overprint, black generation, and ICC intents are not preserved.',
          'Flatten before handoff because layered CMYK separations are not represented in the editor document model.',
        ],
      },
      precision: {
        sourceBitDepth: 16,
        workingBitDepth: 8,
        channelPrecision: '16-bit source is downgraded to 8-bit preview channels',
      },
      profileWarnings: [
        'Requested ICC/profile "Coated FOGRA39" is retained as a label only; no ICC transform is applied.',
      ],
    });
    expect(cmyk.warnings).toContain('Converting from 16-bit to 8-bit discards high-bit-depth precision and can introduce banding in soft gradients.');
    expect(cmyk.signature).toBe('mode-plan:cmyk:16:Coated FOGRA39:preview-only');

    expect(lab).toMatchObject({
      capability: {
        status: 'unsupported',
        canEditPixels: false,
        canPreviewComposite: false,
        channelCount: 3,
      },
      conversion: {
        required: true,
        flatteningRequired: true,
        targetMode: 'rgb',
        targetBitDepth: 8,
      },
      preview: {
        pipeline: 'unsupported',
        signature: 'lab:32:unsupported:Lab D50',
      },
    });
    expect(lab.warnings).toContain('Lab conversion is not implemented in Sloom Studio; move the document through an external color-managed app before editing here.');
    expect(lab.warnings).toContain('Converting from 32-bit to 8-bit removes HDR/floating-point precision and clamps the workflow to standard dynamic range RGB.');

    expect(indexed).toMatchObject({
      capability: {
        status: 'conversion-required',
        canEditPixels: false,
        canPreviewComposite: false,
        channelCount: 1,
      },
      conversion: {
        required: true,
        flatteningRequired: true,
        limitations: [
          'Indexed palettes expand to flat RGB pixels; palette tables, exact indices, and palette animation metadata are not preserved.',
          'Flatten before conversion because indexed-layer palette compositing is not modeled.',
        ],
      },
      precision: {
        channelPrecision: '8-bit palette indices expanded to 8-bit RGB channels',
      },
    });
  });

  it('adds deterministic parity metadata for unsupported ICC conversion, high-bit storage, operation compatibility, and output warnings', () => {
    const cmyk = describeColorModePlanningDescriptor({
      colorMode: 'cmyk',
      bitDepth: 16,
      profileLabel: 'Coated FOGRA39',
    });
    const lab = describeColorModePlanningDescriptor({
      colorMode: 'lab',
      bitDepth: 32,
      profileLabel: 'Lab D50',
    });
    const indexed = describeColorModePlanningDescriptor({
      colorMode: 'indexed',
      bitDepth: 8,
      profileLabel: 'Web 216',
    });

    expect(cmyk.profileTransform).toEqual({
      status: 'unsupported',
      requestedProfileLabel: 'Coated FOGRA39',
      iccConversionAvailable: false,
      transformIntentSupport: 'none',
      blockerCodes: [
        'icc-transform-unavailable',
        'cmyk-external-prepress-required',
      ],
      limitations: [
        'ICC transforms are not available; profile labels are retained only for handoff metadata.',
        'CMYK profile conversion, black generation, TAC limits, and rendering intents require an external color-managed tool.',
      ],
    });
    expect(cmyk.nativeExport).toEqual({
      canExportNative: false,
      exportColorMode: 'rgb',
      limitations: [
        'Native CMYK export is unavailable; exports remain flattened 8-bit RGB pixels with CMYK planning metadata.',
      ],
    });
    expect(cmyk.bitDepthPlan).toEqual({
      sourceBitDepth: 16,
      storageBitDepth: 8,
      editBitDepth: 8,
      exportBitDepth: 8,
      highBitStorageSupported: false,
      highBitEditingSupported: false,
      highBitExportSupported: false,
      warnings: [
        '16-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.',
        '16-bit editing and export are unsupported; edits and exported files use 8-bit RGB precision.',
      ],
    });
    expect(cmyk.operationsMatrix.export).toMatchObject({
      operation: 'export',
      supported: false,
      workflow: 'rgb-preview-only',
      constraintCode: 'cmyk-proof-preview-only',
      exportImplication: 'rgb-export-with-proof-metadata',
      previewId: 'mode-op:cmyk:16:export:rgb-preview-only',
    });
    expect(cmyk.preview).toMatchObject({
      id: 'mode-preview:cmyk:16:Coated FOGRA39',
      signature: 'cmyk:16:rgb-formula-cmyk-preview:Coated FOGRA39',
    });
    expect(cmyk.outputWarnings).toContain('Print/output warning: CMYK output is planning metadata only; create press-ready separations outside Sloom Studio.');

    expect(lab.modeWorkflowLimitations).toEqual([
      'Lab workflows cannot be previewed, edited, stored, or exported natively in this Image editor.',
      'Convert Lab documents to RGB in an external ICC-aware application before using Sloom Studio.',
    ]);
    expect(lab.operationsMatrix.paint).toMatchObject({
      operation: 'paint',
      supported: false,
      workflow: 'unsupported',
      constraintCode: 'lab-external-conversion',
      exportImplication: 'external-export-required',
      previewId: 'mode-op:lab:32:paint:unsupported',
    });
    expect(lab.outputWarnings).toContain('Print/output warning: Lab output is unsupported; no Lab profile, channels, or native export are produced.');

    expect(indexed.modeWorkflowLimitations).toEqual([
      'Indexed workflows do not preserve palette tables, exact indices, transparency tables, or palette animation metadata.',
      'Indexed sources expand to 8-bit RGB before editing; re-index externally after export if palette fidelity matters.',
    ]);
    expect(indexed.nativeExport).toMatchObject({
      canExportNative: false,
      exportColorMode: 'rgb',
    });
    expect(indexed.outputWarnings).toContain('Print/output warning: indexed output is not native; exported pixels are expanded RGB.');
  });

  it('exposes bounded operation-policy descriptors for conversion, proof-preview, and export implications', () => {
    const grayscaleAdjustments = getColorModeOperationPolicy({
      colorMode: 'grayscale',
      bitDepth: 16,
      operation: 'adjustments',
    });
    const cmykExport = describeColorModePlanningDescriptor({
      colorMode: 'cmyk',
      bitDepth: 8,
      profileLabel: 'Coated FOGRA39',
    }).operationsMatrix.export;
    const rgbHighBitExport = getColorModeOperationPolicy({
      colorMode: 'rgb',
      bitDepth: 32,
      operation: 'export',
    });

    expect(grayscaleAdjustments).toMatchObject({
      constraintCode: 'grayscale-rgb-conversion',
      externalConversionRequired: true,
      exportImplication: 'rgb-export-after-conversion',
    });
    expect(cmykExport).toMatchObject({
      constraintCode: 'cmyk-proof-preview-only',
      externalConversionRequired: true,
      exportImplication: 'rgb-export-with-proof-metadata',
    });
    expect(rgbHighBitExport).toMatchObject({
      constraintCode: 'high-bit-rgb-downsample',
      externalConversionRequired: false,
      exportImplication: 'downgraded-rgb-export',
    });
  });

  it('reports a deterministic bit-depth pipeline contract for 8-bit, 16-bit, and 32-bit sources', () => {
    const bit8 = describeColorModePlanningDescriptor({
      colorMode: 'rgb',
      bitDepth: 8,
      profileLabel: 'sRGB IEC61966-2.1',
    });
    const bit16 = describeColorModePlanningDescriptor({
      colorMode: 'rgb',
      bitDepth: 16,
      profileLabel: 'Adobe RGB (1998)',
    });
    const bit32 = describeColorModePlanningDescriptor({
      colorMode: 'rgb',
      bitDepth: 32,
      profileLabel: 'Linear RGB',
    });

    expect(bit8.bitDepthPipelineContract).toEqual({
      sourceBits: 8,
      workingBits: 8,
      convertedBits: 8,
      lossSurface: 'none',
      warnings: [],
    });

    expect(bit16.bitDepthPipelineContract).toEqual({
      sourceBits: 16,
      workingBits: 8,
      convertedBits: 8,
      lossSurface: 'quantization-banding',
      warnings: [
        '16-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.',
        '16-bit source editing and export are unsupported; edits and exported files use 8-bit RGB precision.',
        'Converting from 16-bit to 8-bit discards high-bit-depth precision and can introduce banding in soft gradients.',
      ],
    });

    expect(bit32.bitDepthPipelineContract).toEqual({
      sourceBits: 32,
      workingBits: 8,
      convertedBits: 8,
      lossSurface: 'dynamic-range-clamp',
      warnings: [
        '32-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.',
        '32-bit source editing and export are unsupported; edits and exported files use 8-bit RGB precision.',
        'Converting from 32-bit to 8-bit removes HDR/floating-point precision and clamps the workflow to standard dynamic range RGB.',
      ],
    });
  });

  it('describes document-level bit-depth readiness without pretending high-bit pixels survive the canvas pipeline', () => {
    const bit16 = describeImageBitDepthDocumentReadiness({
      documentId: 'doc-high-16',
      sourceFormat: 'TIFF',
      sourceBitDepth: 16,
      requestedOperations: ['paint', 'filters', 'export'],
    });
    const bit32 = describeImageBitDepthDocumentReadiness({
      documentId: 'doc-hdr-32',
      sourceFormat: 'EXR',
      sourceBitDepth: 32,
      requestedOperations: ['adjustments', 'export'],
    });

    expect(bit16).toEqual({
      descriptorId: 'image-bit-depth-document-readiness:v1',
      documentId: 'doc-high-16',
      sourceFormat: 'TIFF',
      sourceBitDepth: 16,
      storageBitDepth: 8,
      editBitDepth: 8,
      exportBitDepth: 8,
      highBitStorageSupported: false,
      highBitEditingSupported: false,
      highBitExportSupported: false,
      lossSurface: 'quantization-banding',
      operationPolicies: [
        {
          operation: 'paint',
          supported: false,
          blockerCode: 'high-bit-depth-downsample',
          processingSurface: '8-bit-rgba-canvas',
          sourceSamplePolicy: 'downsampled-to-8bit',
          message: 'Paint runs on downgraded 8-bit RGBA canvas data; 16-bit source samples are not preserved.',
          printExportWarning: 'Paint output is an 8-bit RGB derivative; keep a high-bit master for print, archive, or VFX handoff.',
        },
        {
          operation: 'filters',
          supported: false,
          blockerCode: 'high-bit-depth-downsample',
          processingSurface: '8-bit-rgba-canvas',
          sourceSamplePolicy: 'downsampled-to-8bit',
          message: 'Filters run on downgraded 8-bit RGBA canvas data; 16-bit source samples are not preserved.',
          printExportWarning: 'Filters output is an 8-bit RGB derivative; keep a high-bit master for print, archive, or VFX handoff.',
        },
        {
          operation: 'export',
          supported: false,
          blockerCode: 'high-bit-depth-export-unavailable',
          processingSurface: '8-bit-visible-export',
          sourceSamplePolicy: 'external-high-bit-master-required',
          message: 'Export writes 8-bit RGB/RGBA derivatives; 16-bit output requires an external high-bit master.',
          printExportWarning: 'Export is an 8-bit RGB/RGBA derivative; use an external high-bit master for print, archive, or VFX handoff.',
        },
      ],
      exportCaveats: [
        'Visible exports are flattened 8-bit RGB/RGBA derivatives, not high-bit TIFF/PSD/EXR masters.',
        'Keep the original TIFF high-bit master outside Sloom Studio when 16-bit precision must survive print or archive handoff.',
      ],
      warnings: [
        '16-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.',
        '16-bit source editing and export are unsupported; edits and exported files use 8-bit RGB precision.',
        'Converting from 16-bit to 8-bit discards high-bit-depth precision and can introduce banding in soft gradients.',
      ],
      signature: 'image-bit-depth-document-readiness:v1:doc-high-16:TIFF:16:paint,filters,export:8',
    });

    expect(bit32.lossSurface).toBe('dynamic-range-clamp');
    expect(bit32.operationPolicies.map((policy) => policy.operation)).toEqual(['adjustments', 'export']);
    expect(bit32.warnings).toContain('Converting from 32-bit to 8-bit removes HDR/floating-point precision and clamps the workflow to standard dynamic range RGB.');
    expect(bit32.exportCaveats).toContain('Keep the original EXR high-bit master outside Sloom Studio when 32-bit precision must survive print or archive handoff.');
    expect(bit32.signature).toBe('image-bit-depth-document-readiness:v1:doc-hdr-32:EXR:32:adjustments,export:8');
  });

  it('reports deterministic color-mode readiness with conversion, metadata-only, and print/export blockers', () => {
    const rgb = describeImageColorModeReadiness({
      colorMode: 'rgb',
      bitDepth: 8,
    });
    const cmyk = describeImageColorModeReadiness({
      colorMode: 'cmyk',
      bitDepth: 16,
      profileLabel: 'Coated FOGRA39',
    });

    expect(rgb).toMatchObject({
      descriptorId: 'image-color-mode-readiness:v1',
      ready: true,
      status: 'ready',
      policy: {
        nativeDocumentMode: true,
        editPolicy: 'native',
        profilePolicy: 'browser-rgb-only',
        conversionPolicy: 'none',
      },
      previewState: {
        id: 'image-color-mode-readiness-preview:rgb:8:unmanaged',
        pipeline: 'browser-rgb-canvas',
        previewKind: 'native',
        readOnly: false,
        deterministic: true,
        signature: 'image-color-mode-readiness-preview:v1:rgb:8:browser-rgb-canvas:unmanaged:editable',
      },
      blockers: [],
    });
    expect(rgb.printExport).toEqual({
      exportColorMode: 'rgb',
      exportsWithoutModeConversion: true,
      nativeModeExportReady: true,
      pressReady: false,
      implications: [
        'RGB export can remain RGB without mode conversion, but press separations still require an external ICC-managed workflow.',
      ],
    });
    expect(rgb.previewSignature).toBe('image-color-mode-readiness:v1:{"colorMode":"rgb","bitDepth":8,"profileLabel":"unmanaged","status":"ready","previewReadOnly":false,"blockers":[]}');

    expect(cmyk).toMatchObject({
      descriptorId: 'image-color-mode-readiness:v1',
      ready: false,
      status: 'preview-only',
      policy: {
        nativeDocumentMode: false,
        editPolicy: 'rgb-preview-only',
        profilePolicy: 'label-only',
        conversionPolicy: 'external-conversion-required',
      },
      previewState: {
        id: 'image-color-mode-readiness-preview:cmyk:16:Coated FOGRA39',
        pipeline: 'rgb-formula-cmyk-preview',
        previewKind: 'rgb-preview-only',
        readOnly: true,
        deterministic: true,
        signature: 'image-color-mode-readiness-preview:v1:cmyk:16:rgb-formula-cmyk-preview:Coated FOGRA39:read-only',
      },
      bitDepthCaveats: [
        '16-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.',
        '16-bit source editing and export are unsupported; edits and exported files use 8-bit RGB precision.',
        'Converting from 16-bit to 8-bit discards high-bit-depth precision and can introduce banding in soft gradients.',
      ],
    });
    expect(cmyk.conversionBlockers).toEqual([
      {
        code: 'color-conversion-required',
        category: 'conversion',
        message: 'CMYK requires external ICC-managed conversion/flattening before native RGB editing.',
      },
      {
        code: 'high-bit-depth-downsample',
        category: 'conversion',
        message: '16-bit sources are downgraded to 8-bit RGB canvas data before Image editing/export.',
      },
    ]);
    expect(cmyk.metadataOnlyBlockers).toEqual([
      {
        code: 'icc-profile-metadata-only',
        category: 'metadata-only',
        message: 'ICC/profile "Coated FOGRA39" is retained as metadata only; preview pixels are not ICC transformed.',
      },
    ]);
    expect(cmyk.printExport).toEqual({
      exportColorMode: 'rgb',
      exportsWithoutModeConversion: false,
      nativeModeExportReady: false,
      pressReady: false,
      implications: [
        'CMYK output is planning metadata only; exported pixels remain flattened 8-bit RGB.',
        'Create press-ready CMYK separations in an external ICC-managed prepress workflow.',
      ],
    });
    expect(cmyk.blockers.map((blocker) => blocker.code)).toEqual([
      'color-conversion-required',
      'high-bit-depth-downsample',
      'icc-profile-metadata-only',
      'native-export-unavailable',
    ]);
    expect(cmyk.previewSignature).toBe('image-color-mode-readiness:v1:{"colorMode":"cmyk","bitDepth":16,"profileLabel":"Coated FOGRA39","status":"preview-only","previewReadOnly":true,"blockers":["color-conversion-required","high-bit-depth-downsample","icc-profile-metadata-only","native-export-unavailable"]}');
  });

  it('classifies RGB, grayscale, CMYK, indexed, and Lab readiness policies without native support overclaiming', () => {
    const policies = ([
      ['rgb', 8],
      ['grayscale', 8],
      ['cmyk', 8],
      ['indexed', 8],
      ['lab', 32],
    ] as const).map(([colorMode, bitDepth]) => describeImageColorModeReadiness({ colorMode, bitDepth }));

    expect(policies.map((policy) => policy.status)).toEqual([
      'ready',
      'conversion-required',
      'preview-only',
      'conversion-required',
      'unsupported',
    ]);
    expect(policies.map((policy) => policy.previewState.readOnly)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(policies[3].blockers.map((blocker) => blocker.code)).toEqual([
      'color-conversion-required',
      'native-export-unavailable',
    ]);
    expect(policies[4].blockers.map((blocker) => blocker.code)).toEqual([
      'unsupported-color-mode',
      'color-conversion-required',
      'high-bit-depth-downsample',
      'native-export-unavailable',
    ]);
    expect(policies[4].previewState.signature).toBe('image-color-mode-readiness-preview:v1:lab:32:unsupported:unmanaged:read-only');
  });

  it('exposes color-mode action and batch suitability with Photoshop-equivalent unsupported states', () => {
    const cmyk = describeImageColorModeOperationalReadiness({
      colorMode: 'cmyk',
      bitDepth: 16,
      profileLabel: 'Coated FOGRA39',
    });
    const rgb = describeImageColorModeOperationalReadiness({
      colorMode: 'rgb',
      bitDepth: 8,
    });

    expect(cmyk).toMatchObject({
      descriptorId: 'image-color-mode-operational-readiness:v1',
      state: {
        colorMode: 'cmyk',
        modeLabel: 'CMYK',
        bitDepth: 16,
        profileLabel: 'Coated FOGRA39',
        nativeDocumentMode: false,
      },
      policy: {
        previewPolicy: 'rgb-preview-only',
        conversionPolicy: 'external-conversion-required',
        profilePolicy: 'label-only',
        exportPolicy: 'flattened-rgb-with-metadata',
      },
      bitDepthPreservation: {
        sourceBitDepth: 16,
        preserved: false,
        blockers: [
          '16-bit source storage is not preserved; imported pixels are represented as 8-bit RGBA canvas data.',
          '16-bit editing and export are unsupported; edits and exported files use 8-bit RGB precision.',
        ],
      },
      actionSuitability: {
        recordable: true,
        deterministic: true,
        destructiveRisk: 'requires-conversion',
      },
      batchSuitability: {
        suitable: false,
        reason: 'Batch color-mode processing requires external ICC conversion before native Image editing/export.',
      },
    });
    expect(cmyk.iccProfileLimitations).toContain('ICC/profile "Coated FOGRA39" is retained as metadata only; preview pixels are not ICC transformed.');
    expect(cmyk.exportPrintCaveats).toContain('CMYK output is planning metadata only; exported pixels remain flattened 8-bit RGB.');
    expect(cmyk.unsupportedPhotoshopStates).toEqual([
      'native CMYK document editing',
      'ICC-managed CMYK conversion intents',
      'native CMYK export/separations',
      '16-bit/32-bit channel preservation',
    ]);
    expect(cmyk.signature).toBe('image-color-mode-operational-readiness:v1:cmyk:16:Coated FOGRA39:preview-only:blocked');

    expect(rgb).toMatchObject({
      ready: true,
      actionSuitability: {
        suitable: true,
        destructiveRisk: 'none',
      },
      batchSuitability: {
        suitable: true,
        reason: 'Native 8-bit RGB operations can be recorded and replayed without mode conversion.',
      },
      unsupportedPhotoshopStates: [
        'custom display-profile transforms',
      ],
    });
  });

  it('exposes per-operation high-bit policies without claiming native high-bit storage or export', () => {
    const descriptor = describeImageBitDepthDocumentReadiness({
      documentId: 'doc-print-master',
      sourceFormat: 'PSD',
      sourceBitDepth: 16,
      requestedOperations: ['paint', 'adjustments', 'filters', 'export'],
    });

    expect(descriptor.operationPolicies).toEqual([
      {
        operation: 'paint',
        supported: false,
        blockerCode: 'high-bit-depth-downsample',
        processingSurface: '8-bit-rgba-canvas',
        sourceSamplePolicy: 'downsampled-to-8bit',
        message: 'Paint runs on downgraded 8-bit RGBA canvas data; 16-bit source samples are not preserved.',
        printExportWarning: 'Paint output is an 8-bit RGB derivative; keep a high-bit master for print, archive, or VFX handoff.',
      },
      {
        operation: 'adjustments',
        supported: false,
        blockerCode: 'high-bit-depth-downsample',
        processingSurface: '8-bit-rgba-canvas',
        sourceSamplePolicy: 'downsampled-to-8bit',
        message: 'Adjustments run on downgraded 8-bit RGBA canvas data; 16-bit source samples are not preserved.',
        printExportWarning: 'Adjustments output is an 8-bit RGB derivative; keep a high-bit master for print, archive, or VFX handoff.',
      },
      {
        operation: 'filters',
        supported: false,
        blockerCode: 'high-bit-depth-downsample',
        processingSurface: '8-bit-rgba-canvas',
        sourceSamplePolicy: 'downsampled-to-8bit',
        message: 'Filters run on downgraded 8-bit RGBA canvas data; 16-bit source samples are not preserved.',
        printExportWarning: 'Filters output is an 8-bit RGB derivative; keep a high-bit master for print, archive, or VFX handoff.',
      },
      {
        operation: 'export',
        supported: false,
        blockerCode: 'high-bit-depth-export-unavailable',
        processingSurface: '8-bit-visible-export',
        sourceSamplePolicy: 'external-high-bit-master-required',
        message: 'Export writes 8-bit RGB/RGBA derivatives; 16-bit output requires an external high-bit master.',
        printExportWarning: 'Export is an 8-bit RGB/RGBA derivative; use an external high-bit master for print, archive, or VFX handoff.',
      },
    ]);
  });

  it('publishes a high-bit operation and export support matrix with stable fallbacks', () => {
    const matrix = describeImageHighBitWorkflowSupportMatrix({
      sourceFormat: 'Camera Raw derivative',
      colorMode: 'rgb',
      sourceBitDepth: 16,
      profileLabel: 'ProPhoto RGB',
    });

    expect(matrix).toMatchObject({
      descriptorId: 'image-high-bit-workflow-support-matrix:v1',
      sourceFormat: 'Camera Raw derivative',
      colorMode: 'rgb',
      sourceBitDepth: 16,
      workingBitDepth: 8,
      profileLabel: 'ProPhoto RGB',
      operationMatrix: {
        paint: {
          operation: 'paint',
          status: 'downsample-required',
          supportedInEditor: false,
          sourcePrecisionPreserved: false,
          processingSurface: '8-bit-rgba-canvas',
          fallbackRoute: '8bit-rgb-working-derivative',
        },
        export: {
          operation: 'export',
          status: 'external-required',
          supportedInEditor: false,
          sourcePrecisionPreserved: false,
          processingSurface: '8-bit-visible-export',
          fallbackRoute: 'external-high-bit-master',
        },
      },
      exportMatrix: {
        png: {
          target: 'png',
          status: '8bit-derivative',
          supported: true,
          highBitPreserved: false,
          colorModePreserved: true,
          fallbackRoute: 'external-high-bit-master',
        },
        tiff: {
          target: 'tiff',
          status: '8bit-derivative',
          supported: true,
          highBitPreserved: false,
        },
        psd: {
          target: 'psd',
          status: '8bit-layered-metadata',
          supported: true,
          highBitPreserved: false,
        },
        exr: {
          target: 'exr',
          status: 'unsupported',
          supported: false,
          highBitPreserved: false,
        },
        cameraRaw: {
          target: 'cameraRaw',
          status: 'unsupported',
          supported: false,
          highBitPreserved: false,
        },
      },
      fallbackRecommendations: [
        {
          route: 'external-high-bit-master',
          label: 'Keep external high-bit master',
          preserves: '16-bit source precision, ICC-managed profile transforms, and archive/print latitude',
          recommendedFor: 'Print, archive, VFX, or any workflow where high-bit precision must survive.',
          caveat: 'Image edits apply to an 8-bit RGB derivative and do not update the high-bit master.',
        },
        {
          route: '8bit-rgb-working-derivative',
          label: 'Create 8-bit RGB working derivative',
          preserves: 'visible pixel intent for Image paint, adjustments, filters, and suite handoff',
          recommendedFor: 'Interactive Image editing after accepting precision loss.',
          caveat: 'Quantization, banding, and HDR clamp risk are baked into the derivative.',
        },
        {
          route: 'psd-metadata-working-copy',
          label: 'PSD metadata working copy',
          preserves: 'Image layer metadata and visible 8-bit RGB edit state',
          recommendedFor: 'Layered Sloom Studio reopening after high-bit conversion.',
          caveat: 'PSD output is not a native high-bit master and profile transforms remain metadata-only.',
        },
      ],
      unsupportedStates: [
        {
          code: 'native-high-bit-storage',
          message: 'Native 16-bit document storage is unsupported; Image stores editable pixels as 8-bit RGBA canvas data.',
        },
        {
          code: 'native-high-bit-editing',
          message: 'Native 16-bit paint, adjustment, and filter processing is unsupported.',
        },
        {
          code: 'native-high-bit-export',
          message: 'Native 16-bit export is unsupported; visible exports are 8-bit derivatives.',
        },
        {
          code: 'icc-profile-transform',
          message: 'Profile "ProPhoto RGB" is metadata only; no ICC transform is applied to the high-bit derivative.',
        },
      ],
    });
    expect(matrix.stableSignature).toBe('image-high-bit-workflow-support-matrix:v1|format=Camera Raw derivative|mode=rgb|bits=16|profile=ProPhoto RGB|ops=paint:downsample-required,adjustments:downsample-required,filters:downsample-required,export:external-required|exports=png:8bit-derivative,jpeg:8bit-derivative,webp:8bit-derivative,avif:8bit-derivative,tiff:8bit-derivative,psd:8bit-layered-metadata,exr:unsupported,cameraRaw:unsupported|unsupported=native-high-bit-storage,native-high-bit-editing,native-high-bit-export,icc-profile-transform');
  });

  it('carries readiness operation caveats and unsupported states for color/profile/high-bit gaps', () => {
    const readiness = describeImageColorModeReadiness({
      colorMode: 'cmyk',
      bitDepth: 16,
      profileLabel: 'Coated FOGRA39',
    });

    expect(readiness.operationCaveats.paint).toEqual([
      'Paint cannot run in a native CMYK/ICC working space; convert externally to 8-bit RGB before editing.',
      'Paint operates only on the downgraded 8-bit RGB canvas derivative; 16-bit samples are not preserved.',
      'Profile "Coated FOGRA39" remains metadata-only; no ICC transform is applied before paint.',
    ]);
    expect(readiness.operationCaveats.export).toEqual([
      'Export produces flattened 8-bit RGB pixels with CMYK/profile labels only; native CMYK separations are unsupported.',
      'Export cannot preserve 16-bit source precision; keep a high-bit master outside Sloom Studio.',
      'Profile "Coated FOGRA39" remains metadata-only; no ICC conversion or embedded output profile is produced.',
    ]);
    expect(readiness.unsupportedStates).toEqual([
      {
        code: 'native-cmyk-document',
        message: 'Native CMYK document editing/storage is unsupported; CMYK state is preview/planning metadata only.',
      },
      {
        code: 'native-cmyk-export',
        message: 'Native CMYK export and separations are unsupported; visible exports remain 8-bit RGB.',
      },
      {
        code: 'native-high-bit-document',
        message: '16-bit document storage/editing/export is unsupported; the Image editor keeps an 8-bit RGB canvas derivative.',
      },
      {
        code: 'icc-profile-transform',
        message: 'ICC profile transforms and embedded output profiles are unsupported; profile labels are metadata only.',
      },
    ]);
  });

  it('publishes a dedicated CMYK, Lab, and indexed support matrix with conversion/export blockers and stable signatures', () => {
    const cmyk = describeImageNonRgbColorModeSupportMatrix({
      colorMode: 'cmyk',
      bitDepth: 16,
      profileLabel: 'Coated FOGRA39',
    });
    const lab = describeImageNonRgbColorModeSupportMatrix({
      colorMode: 'lab',
      bitDepth: 8,
      profileLabel: 'Lab D50',
    });
    const indexed = describeImageNonRgbColorModeSupportMatrix({
      colorMode: 'indexed',
      bitDepth: 8,
      profileLabel: 'Web 216',
    });

    expect(cmyk).toMatchObject({
      descriptorId: 'image-non-rgb-color-mode-support-matrix:v1',
      colorMode: 'cmyk',
      modeLabel: 'CMYK',
      nativeDocumentMode: false,
      previewState: {
        pipeline: 'rgb-formula-cmyk-preview',
        previewKind: 'rgb-preview-only',
        readOnly: true,
        deterministic: true,
        computedFromRgb: true,
        channelLabels: ['Cyan', 'Magenta', 'Yellow', 'Black'],
      },
      operationMatrix: {
        paint: {
          operation: 'paint',
          status: 'preview-only-blocked',
          supportedInEditor: false,
          actionRecordable: true,
          batchSuitable: false,
          requiredRoute: 'external-icc-to-rgb',
          blockers: [
            'native-cmyk-editing',
            'icc-transform-unavailable',
            'black-generation-unavailable',
            'total-area-coverage-unavailable',
            'high-bit-depth-downsample',
          ],
        },
        export: {
          operation: 'export',
          status: 'external-required',
          outputPixelSpace: 'RGB',
          blockers: [
            'native-cmyk-export-unavailable',
            'icc-transform-unavailable',
            'black-generation-unavailable',
            'total-area-coverage-unavailable',
            'high-bit-depth-downsample',
          ],
        },
      },
      prepressChecks: {
        gamutWarningAvailable: false,
        blackGenerationAvailable: false,
        totalAreaCoverageCheckAvailable: false,
        overprintSimulationAvailable: false,
      },
      actionSuitability: {
        suitable: false,
        deterministic: true,
        destructiveRisk: 'requires-external-conversion',
      },
      batchSuitability: {
        suitable: false,
        reason: 'Batch CMYK processing is blocked until an external ICC conversion/separation step creates an 8-bit RGB derivative.',
      },
    });
    expect(cmyk.conversionBlockers.map((blocker) => blocker.code)).toEqual([
      'native-cmyk-editing',
      'icc-transform-unavailable',
      'black-generation-unavailable',
      'total-area-coverage-unavailable',
      'high-bit-depth-downsample',
    ]);
    expect(cmyk.exportBlockers.map((blocker) => blocker.code)).toEqual([
      'native-cmyk-export-unavailable',
      'icc-transform-unavailable',
      'black-generation-unavailable',
      'total-area-coverage-unavailable',
      'high-bit-depth-downsample',
    ]);
    expect(cmyk.stableSignature).toBe('image-non-rgb-color-mode-support-matrix:v1|mode=cmyk|bits=16|profile=Coated FOGRA39|preview=rgb-formula-cmyk-preview|ops=paint:preview-only-blocked,adjustments:preview-only-blocked,filters:preview-only-blocked,export:external-required|conversion=native-cmyk-editing,icc-transform-unavailable,black-generation-unavailable,total-area-coverage-unavailable,high-bit-depth-downsample|export=native-cmyk-export-unavailable,icc-transform-unavailable,black-generation-unavailable,total-area-coverage-unavailable,high-bit-depth-downsample');

    expect(lab.previewState).toMatchObject({
      pipeline: 'unsupported',
      previewKind: 'unsupported',
      readOnly: true,
      computedFromRgb: false,
      channelLabels: ['Lightness', 'a', 'b'],
    });
    expect(lab.operationMatrix.paint.blockers).toEqual([
      'native-lab-preview-unavailable',
      'native-lab-editing',
      'lab-conversion-external',
      'icc-transform-unavailable',
    ]);
    expect(lab.exportBlockers.map((blocker) => blocker.code)).toEqual([
      'native-lab-export-unavailable',
      'lab-conversion-external',
      'icc-transform-unavailable',
    ]);

    expect(indexed.previewState).toMatchObject({
      pipeline: 'unsupported',
      previewKind: 'unsupported',
      readOnly: true,
      computedFromRgb: false,
      channelLabels: ['Palette index'],
    });
    expect(indexed.operationMatrix.filters.blockers).toEqual([
      'indexed-palette-preservation',
      'native-indexed-editing',
      'indexed-reindex-required',
    ]);
    expect(indexed.exportBlockers.map((blocker) => blocker.code)).toEqual([
      'native-indexed-export-unavailable',
      'indexed-palette-preservation',
      'indexed-reindex-required',
    ]);
    expect(indexed.stableSignature).toBe('image-non-rgb-color-mode-support-matrix:v1|mode=indexed|bits=8|profile=Web 216|preview=unsupported|ops=paint:conversion-required,adjustments:conversion-required,filters:conversion-required,export:external-required|conversion=indexed-palette-preservation,native-indexed-editing,indexed-reindex-required|export=native-indexed-export-unavailable,indexed-palette-preservation,indexed-reindex-required');
  });
});
