import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import * as xcfInterop from './ImageXcfInterop';
import {
  describeImageDocumentXcfExportCompatibility,
  describeXcfImportReadinessPolicy,
  detectXcfSourceIdentity,
  imageDocumentToXcfBlob,
  IMAGE_XCF_MIME_TYPE,
} from './ImageXcfInterop';

class FakeContext {
  imageData: ImageData;

  constructor(width: number, height: number) {
    this.imageData = makeImageData(width, height, [0, 0, 0, 0]);
  }

  getImageData(_x = 0, _y = 0, width = this.imageData.width, height = this.imageData.height) {
    void _x;
    void _y;
    return makeImageData(width, height, [12, 34, 56, 255]);
  }

  createImageData(width: number, height: number) {
    return makeImageData(width, height, [0, 0, 0, 0]);
  }

  putImageData(imageData: ImageData) {
    this.imageData = imageData;
  }

  drawImage() {}
  clearRect() {}
  fillRect() {}
  translate() {}
  rotate() {}
  scale() {}
  transform() {}
  setTransform() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  clip() {}
  save() {}
  restore() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function makeImageData(width: number, height: number, fill: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = fill[0];
    data[index + 1] = fill[1];
    data[index + 2] = fill[2];
    data[index + 3] = fill[3];
  }
  return { width, height, data } as ImageData;
}

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Ink Layer',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(2, 2) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc-xcf',
    title: 'Storyboard',
    width: 2,
    height: 2,
    layers: [makeLayer()],
    activeLayerId: 'layer-1',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
  };
}

describe('ImageXcfInterop', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
  });

  it('serializes the active image document as a GIMP XCF blob with layer names', async () => {
    const blob = await imageDocumentToXcfBlob(makeDoc());
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);

    expect(blob.type).toBe(IMAGE_XCF_MIME_TYPE);
    expect(text.startsWith('gimp xcf')).toBe(true);
    expect(text).toContain('Ink Layer');
  });

  it('detects XCF source identity from extension and MIME without claiming decode support', () => {
    expect(detectXcfSourceIdentity({
      fileName: 'Poster.XCF',
      mimeType: ' IMAGE/X-XCF ',
    })).toEqual({
      extension: 'xcf',
      mimeType: 'image/x-xcf',
      isXcfExtension: true,
      isXcfMimeType: true,
      isXcf: true,
      confidence: 'extension-and-mime',
    });

    expect(detectXcfSourceIdentity({
      fileName: 'flat-preview.png',
      mimeType: 'image/png',
    })).toEqual({
      extension: 'png',
      mimeType: 'image/png',
      isXcfExtension: false,
      isXcfMimeType: false,
      isXcf: false,
      confidence: 'none',
    });

    expect(detectXcfSourceIdentity({
      fileName: 'no-extension',
      mimeType: 'image/x-gimp-xcf',
    })).toMatchObject({
      extension: null,
      mimeType: 'image/x-gimp-xcf',
      isXcf: true,
      confidence: 'mime',
    });
  });

  it('describes bounded XCF raster import readiness with native-state caveats', () => {
    const policy = describeXcfImportReadinessPolicy({
      fileName: 'comic-page.xcf',
      mimeType: 'application/octet-stream',
      sourceLibraryItemId: 'source-xcf-1',
    });

    expect(policy).toMatchObject({
      version: 1,
      kind: 'signal-loom-xcf-import-readiness',
      detection: {
        extension: 'xcf',
        mimeType: 'application/octet-stream',
        isXcfExtension: true,
        isXcfMimeType: false,
        isXcf: true,
        confidence: 'extension',
      },
      import: {
        supported: true,
        status: 'bounded-raster-import',
        canOpenAsPixels: true,
        message: 'GIMP XCF workfiles are detected and import as layered raster documents within the documented limits; native XCF edit state is not reconstructed.',
      },
      fallbackRoutes: [
        { route: 'png', label: 'PNG visible composite', preserves: 'flattened pixels and transparency', recommendedFor: 'Preview or lightweight flattened exchange.', caveat: 'Loses layers, masks, text editability, effects, and source links.' },
        { route: 'tiff', label: 'TIFF visible composite', preserves: 'flattened print-oriented pixels', recommendedFor: 'Visible composite handoff after editing elsewhere.', caveat: 'Use 8-bit uncompressed TIFF; layered/native XCF state, text editability, effects, and source links are not reconstructed.' },
        { route: 'psd', label: 'PSD layered handoff', preserves: 'best-effort layers and metadata', recommendedFor: 'Best route when you still need a layered document Image can reopen.', caveat: 'Still may flatten native XCF text, masks, effects, groups, source links, and blend behavior depending on GIMP export.' },
        { route: 'source-library', label: 'Keep original in Source Library', preserves: 'the original XCF file as a managed source asset', recommendedFor: 'Archive provenance while using converted derivatives in Image.', caveat: 'Stored for handoff/reference only; it is not decoded into an editable Image document.' },
      ],
      fallbackRecommendations: [
        { rank: 1, route: 'psd', action: 'convert-layered-handoff' },
        { rank: 2, route: 'tiff', action: 'convert-visible-composite' },
        { rank: 3, route: 'png', action: 'convert-visible-preview' },
        { rank: 4, route: 'source-library', action: 'archive-original' },
      ],
      nativeDecodeState: {
        version: 1,
        kind: 'signal-loom-xcf-native-decode-state',
        detection: {
          extension: 'xcf',
          mimeType: 'application/octet-stream',
          isXcfExtension: true,
          isXcfMimeType: false,
          isXcf: true,
          confidence: 'extension',
        },
        header: {
          provided: false,
          recognized: false,
          signature: 'not-provided',
          version: null,
          state: 'missing-header-bytes',
        },
        decode: {
          status: 'bounded-import',
          canDecodePixels: true,
          canDecodeNativeEditState: false,
          unsupportedReason: null,
          blockedOperations: [
            'reconstruct-editable-text',
            'reconstruct-groups',
            'reconstruct-filter-stacks',
            'reconstruct-source-links',
          ],
        },
        recommendedAction: 'open-as-pixels',
        stableSignature: 'xcf-native-decode:v1|detected=extension|header=not-provided|status=bounded-import|pixels=true|8bit|none-rle-zlib|editState=false|fallbacks=psd,tiff,png,source-library',
      },
      exportCompatibilityLevel: 'layered-raster-export-only',
      caveats: {
        layers: 'XCF raster layers import as layered Image documents within the documented pixel, layer, and compression limits.',
        masks: 'XCF layer masks import as real Image masks when the source applied them.',
        groups: 'Native XCF group folders are flattened to a flat layer list with an explicit warning; child layers keep their stack order.',
        text: 'Editable XCF text is imported as raster pixels with an explicit per-layer warning.',
        effects: 'Native GIMP effects are not reconstructed; effect state imports as the pixels GIMP rendered.',
        filters: 'GIMP filter/plugin state is not reconstructed as native editable filters.',
        sourceLinks: 'Source-linked layers and Smart Object-like relationships are not reconstructed as native XCF links.',
      },
      sourcePolicy: {
        importSignature: 'xcf-import:v1|detected=extension|status=bounded-raster-import|pixels=8bit-none-rle-zlib|fallbacks=png,tiff,psd,source-library|source=source-xcf-1',
        exportSignature: 'xcf-export:v1|level=layered-raster-export-only|nativeRoundtrip=unsupported',
        nativeRoundtrip: 'unsupported',
      },
      compatibilitySignature: 'xcf-import-compatibility:v1|detected=extension|import=bounded-raster|export=layered-raster-export-only|fallbacks=png,tiff,psd,source-library',
      roundTripRisk: {
        level: 'high',
        nativeReopenSupported: false,
        sourceEditStatePreserved: false,
        summary: 'XCF pixels, layers, and masks import into Image, but native XCF edit state (text, groups, filters, effects, source links) cannot round-trip through Image.',
        affectedConstructs: [
          'xcf-document',
          'text',
          'layer-effects',
          'layer-mask',
          'source-link',
          'filter-stack',
          'adjustment-layer',
          'layer-group',
        ],
        recommendedFallbackRoutes: ['psd', 'tiff', 'png', 'source-library'],
        blockers: [
          'no native XCF text/effect reconstruction',
          'no native XCF group/filter/source-link roundtrip',
        ],
      },
      policyWarnings: [
        {
          descriptorId: 'xcf-policy-warning:v1|scope=import|code=xcf-editable-state-loss',
          scope: 'import',
          code: 'xcf-editable-state-loss',
          nativeConstruct: 'xcf-document',
          affectedLayerIds: [],
          preservation: 'flattened-raster',
          nativeRoundtrip: 'unsupported',
          fallbackRoute: 'png',
          message: 'Imported XCF layers are raster pixels: editable text, groups, filters, effects, and source links are not reconstructed as native Image constructs.',
        },
      ],
    });
  });

  it('publishes bounded native XCF decode states from header bytes with edit-state limits', () => {
    const describeDecodeState = (xcfInterop as typeof xcfInterop & {
      describeXcfNativeDecodeState?: (input: {
        fileName?: string;
        mimeType?: string;
        bytes?: Uint8Array;
        sourceLibraryItemId?: string;
      }) => unknown;
    }).describeXcfNativeDecodeState;

    expect(describeDecodeState).toBeTypeOf('function');

    const state = describeDecodeState?.({
      fileName: 'mystery.bin',
      mimeType: 'application/octet-stream',
      bytes: new TextEncoder().encode('gimp xcf v011\0'),
      sourceLibraryItemId: 'source-xcf-2',
    });

    expect(state).toMatchObject({
      version: 1,
      kind: 'signal-loom-xcf-native-decode-state',
      detection: {
        extension: 'bin',
        mimeType: 'application/octet-stream',
        isXcfExtension: false,
        isXcfMimeType: false,
        isXcf: false,
        confidence: 'none',
      },
      header: {
        provided: true,
        recognized: true,
        signature: 'gimp-xcf',
        version: 'v011',
        state: 'recognized-xcf-header',
      },
      decode: {
        status: 'bounded-import',
        canDecodePixels: true,
        canDecodeNativeEditState: false,
        unsupportedReason: null,
        unsupportedStates: [
          { code: 'native-edit-state-decode-unavailable' },
        ],
      },
      recommendedAction: 'open-as-pixels',
      fallbackRecommendations: [
        { rank: 1, route: 'psd', action: 'convert-layered-handoff' },
        { rank: 2, route: 'tiff', action: 'convert-visible-composite' },
        { rank: 3, route: 'png', action: 'convert-visible-preview' },
        { rank: 4, route: 'source-library', action: 'archive-original' },
      ],
      stableSignature: 'xcf-native-decode:v1|detected=none|header=gimp-xcf-v011|status=bounded-import|pixels=true|8bit|none-rle-zlib|editState=false|fallbacks=psd,tiff,png,source-library',
    });
  });

  it('describes deterministic XCF export compatibility losses without changing export bytes', () => {
    const describeXcfExport = (xcfInterop as typeof xcfInterop & {
      describeImageDocumentXcfExportCompatibility?: (doc: ImageDocument) => unknown;
    }).describeImageDocumentXcfExportCompatibility;
    const textLayer = makeLayer({
      id: 'caption',
      name: 'Caption Type',
      type: 'text',
      text: {
        content: 'Dialog',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: '700',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: 120,
        boxHeight: 32,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'none',
      },
      effects: [
        { id: 'fx-shadow', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.5, angle: 135, distance: 7, size: 9 },
      ],
    });
    const adjustmentLayer = makeLayer({
      id: 'adjust',
      name: 'Print Curve',
      type: 'adjustment',
      bitmap: null,
      adjustment: { kind: 'levels', channel: 'rgb', inputBlack: 8, inputWhite: 245, gamma: 1, outputBlack: 0, outputWhite: 255 },
    });
    const doc = makeDoc({
      layers: [
        makeLayer({ id: 'paint', name: 'Paint' }),
        textLayer,
        adjustmentLayer,
      ],
      activeLayerId: 'caption',
    });

    expect(describeXcfExport).toBeTypeOf('function');
    if (!describeXcfExport) return;

    const descriptor = describeXcfExport(doc);
    expect(descriptor).toMatchObject({
      version: 1,
      kind: 'signal-loom-xcf-export-compatibility',
      format: { label: 'XCF', mimeType: 'image/x-xcf', extension: 'xcf' },
      import: {
        supported: true,
        status: 'bounded-raster-import',
        canOpenAsPixels: true,
        recommendedHandoffFormats: ['PSD', 'TIFF', 'PNG', 'JPEG'],
        message: 'GIMP XCF workfiles import as layered raster documents: 8-bit RGB, grayscale, and indexed layers and masks with uncompressed, RLE, or zlib tiles. Editable text, groups, filters, and source links are not reconstructed.',
      },
      export: {
        supported: true,
        status: 'layered-raster-export-only',
        layerOrder: 'bottom-to-top',
        xcfLayerOrder: 'bottom-to-top',
        preservesRasterLayers: true,
        preservesEditableText: false,
        preservesAdjustmentLayers: false,
        preservesLayerEffects: false,
        preservesLayerMasks: false,
        preservesLayerGroups: false,
        preservesSourceLinks: false,
      },
      summary: {
        layerCount: 3,
        exportedRasterLayerCount: 2,
        skippedLayerCount: 1,
        flattenedLayerCount: 1,
        textLayerCount: 1,
        adjustmentLayerCount: 1,
        effectLayerCount: 1,
        maskLayerCount: 0,
        groupCount: 0,
        sourceLinkedLayerCount: 0,
        warningCount: 3,
      },
      warnings: [
        {
          code: 'editable-text-flattened',
          severity: 'warning',
          layerIds: ['caption'],
          message: 'Editable text layers are exported to XCF as raster pixels; text content and style remain editable only in the Image document.',
        },
        {
          code: 'layer-effects-flattened',
          severity: 'warning',
          layerIds: ['caption'],
          message: 'Layer effects are rasterized into XCF layer pixels instead of native editable GIMP effects.',
        },
        {
          code: 'adjustment-layers-omitted',
          severity: 'warning',
          layerIds: ['adjust'],
          message: 'Adjustment layers are not written as native XCF layers; export a visible flattened format for baked color adjustments.',
        },
      ],
      sourcePolicy: {
        signature: 'xcf-interop:v1|import=bounded-raster|export=layered-raster-export-only|layers=3|exported=2|omitted=2|warnings=editable-text-flattened,layer-effects-flattened,adjustment-layers-omitted',
        importAction: 'open-as-pixels',
        exportAction: 'export-layered-raster',
        nativeRoundtrip: 'unsupported',
      },
      compatibilitySummary: 'XCF raster layers and masks export from and re-open in Image; editable text, effects, filters, groups, and source links stay raster or metadata-only.',
      roundTripCaveats: [
        'Imported XCF raster layers and masks re-open in Image; native XCF edit state does not round-trip.',
        'Editable text, adjustment layers, layer effects, masks, groups, and source links are not round-tripped as native XCF edit state.',
        'Layer masks, layer effects, source links, and filter stacks are flattened into exported pixels.',
      ],
      layers: [
        {
          id: 'paint',
          name: 'Paint',
          type: 'image',
          order: 0,
          xcfLayerIndex: 0,
          exportMode: 'native-raster',
          flattened: false,
          omitted: false,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          warningCodes: [],
        },
        {
          id: 'caption',
          name: 'Caption Type',
          type: 'text',
          order: 1,
          xcfLayerIndex: 1,
          exportMode: 'flattened-raster',
          flattened: true,
          omitted: false,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          text: {
            contentLength: 6,
            fontFamily: 'Inter',
            fontSize: 18,
            nativeEditableText: false,
          },
          effects: {
            count: 1,
            kinds: ['dropShadow'],
            enabledKinds: ['dropShadow'],
            nativeLayerEffects: false,
          },
          warningCodes: ['editable-text-flattened', 'layer-effects-flattened'],
        },
        {
          id: 'adjust',
          name: 'Print Curve',
          type: 'adjustment',
          order: 2,
          xcfLayerIndex: null,
          exportMode: 'omitted-unsupported',
          flattened: false,
          omitted: true,
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          adjustment: {
            kind: 'levels',
            nativeAdjustmentLayer: false,
          },
          warningCodes: ['adjustment-layers-omitted'],
        },
      ],
    });
    expect(descriptor.compatibilitySignature).toBe(
      'xcf-compatibility:v1|import=bounded-raster|export=layered-raster-export-only|layers=3|exported=2|omitted=1|flattened=1|warnings=editable-text-flattened,layer-effects-flattened,adjustment-layers-omitted',
    );
    expect(descriptor.retainedMetadata).toEqual({
      textLayerIds: ['caption'],
      effectLayerIds: ['caption'],
      sourceLinkedLayerIds: [],
      filterLayerIds: [],
    });
    expect(descriptor.policyWarnings).toEqual([
      {
        descriptorId: 'xcf-policy-warning:v1|scope=export|code=editable-text-flattened',
        scope: 'export',
        code: 'editable-text-flattened',
        nativeConstruct: 'text',
        affectedLayerIds: ['caption'],
        preservation: 'flattened-raster',
        nativeRoundtrip: 'unsupported',
        fallbackRoute: 'psd',
        message: 'Editable text layers are exported to XCF as raster pixels; text content and style remain editable only in the Image document.',
      },
      {
        descriptorId: 'xcf-policy-warning:v1|scope=export|code=layer-effects-flattened',
        scope: 'export',
        code: 'layer-effects-flattened',
        nativeConstruct: 'layer-effects',
        affectedLayerIds: ['caption'],
        preservation: 'flattened-raster',
        nativeRoundtrip: 'unsupported',
        fallbackRoute: 'psd',
        message: 'Layer effects are rasterized into XCF layer pixels instead of native editable GIMP effects.',
      },
      {
        descriptorId: 'xcf-policy-warning:v1|scope=export|code=adjustment-layers-omitted',
        scope: 'export',
        code: 'adjustment-layers-omitted',
        nativeConstruct: 'adjustment-layer',
        affectedLayerIds: ['adjust'],
        preservation: 'omitted',
        nativeRoundtrip: 'unsupported',
        fallbackRoute: 'tiff',
        message: 'Adjustment layers are not written as native XCF layers; export a visible flattened format for baked color adjustments.',
      },
    ]);
    expect(descriptor.recommendedFallbackRoutes.map((route) => route.route)).toEqual([
      'png',
      'tiff',
      'psd',
      'source-library',
    ]);
    expect(descriptor.layerWarnings.map((layer) => ({
      layerId: layer.layerId,
      warningCodes: layer.warnings.map((warning) => warning.code),
    }))).toEqual([
      { layerId: 'caption', warningCodes: ['editable-text-flattened', 'layer-effects-flattened'] },
      { layerId: 'adjust', warningCodes: ['adjustment-layers-omitted'] },
    ]);
    expect(describeXcfExport(doc)).toEqual(descriptor);
  });

  it('publishes XCF readiness, policy signature, and round-trip caveats for UI parity rows', () => {
    const describeXcfExport = (xcfInterop as typeof xcfInterop & {
      describeImageDocumentXcfExportCompatibility?: (doc: ImageDocument) => unknown;
    }).describeImageDocumentXcfExportCompatibility;
    expect(describeXcfExport).toBeTypeOf('function');
    if (!describeXcfExport) return;

    const doc = makeDoc({
      layers: [
        makeLayer({ id: 'paint', name: 'Paint' }),
        makeLayer({
          id: 'linked',
          name: 'Linked Masked FX',
          mask: new OffscreenCanvas(2, 2) as LayerBitmap,
          metadata: {
            smartLinkedSourceId: 'source-1',
            sourceLabel: 'Reference.png',
          },
          effects: [
            { id: 'fx-shadow', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.5, angle: 135, distance: 7, size: 9 },
          ],
        }),
        makeLayer({ id: 'group', name: 'Folder', type: 'group', bitmap: null }),
      ],
    });

    expect(describeXcfExport(doc)).toMatchObject({
      import: {
        supported: true,
        status: 'bounded-raster-import',
        canOpenAsPixels: true,
        recommendedHandoffFormats: ['PSD', 'TIFF', 'PNG', 'JPEG'],
      },
      export: {
        supported: true,
        status: 'layered-raster-export-only',
        preservesLayerMasks: false,
        preservesLayerEffects: false,
        preservesSourceLinks: false,
      },
      sourcePolicy: {
        signature: 'xcf-interop:v1|import=bounded-raster|export=layered-raster-export-only|layers=3|exported=2|omitted=2|warnings=layer-effects-flattened,layer-masks-flattened,source-links-flattened,layer-groups-omitted',
        importAction: 'open-as-pixels',
        exportAction: 'export-layered-raster',
        nativeRoundtrip: 'unsupported',
      },
      compatibilitySummary: 'XCF raster layers and masks export from and re-open in Image; editable text, effects, filters, groups, and source links stay raster or metadata-only.',
      roundTripCaveats: [
        'Imported XCF raster layers and masks re-open in Image; native XCF edit state does not round-trip.',
        'Layer masks, layer effects, source links, and filter stacks are flattened into exported pixels.',
        'Layer groups are omitted as native folders; exported raster layers remain flat.',
      ],
    });
  });

  it('describes XCF native-construct risk with signatures, per-layer warnings, and fallback routes', () => {
    const importPolicy = describeXcfImportReadinessPolicy({
      fileName: 'page.xcf',
      mimeType: 'image/x-xcf',
      sourceLibraryItemId: 'source-xcf',
    }) as ReturnType<typeof describeXcfImportReadinessPolicy> & {
      compatibilitySignature?: string;
    };
    const caption = makeLayer({
      id: 'caption',
      name: 'Caption',
      type: 'text',
      text: {
        content: 'Dialog',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: '700',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: 120,
        boxHeight: 32,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'none',
      },
      mask: new OffscreenCanvas(2, 2) as LayerBitmap,
      effects: [
        { id: 'fx-shadow', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.5, angle: 135, distance: 7, size: 9 },
      ],
      filters: [
        { id: 'filter-blur', kind: 'blur', enabled: true, amount: 4, opacity: 0.75, blendMode: 'normal' },
      ],
      metadata: {
        smartLinkedSourceId: 'source-1',
        sourceLabel: 'Reference.png',
      },
    });
    const adjustmentLayer = makeLayer({
      id: 'adjust',
      name: 'Print Curve',
      type: 'adjustment',
      bitmap: null,
      adjustment: { kind: 'levels', channel: 'rgb', inputBlack: 8, inputWhite: 245, gamma: 1, outputBlack: 0, outputWhite: 255 },
    });

    const descriptor = describeImageDocumentXcfExportCompatibility(makeDoc({
      layers: [
        makeLayer({ id: 'paint', name: 'Paint' }),
        caption,
        adjustmentLayer,
      ],
      activeLayerId: 'caption',
    })) as ReturnType<typeof describeImageDocumentXcfExportCompatibility> & {
      compatibilitySignature?: string;
      recommendedFallbackRoutes?: Array<{ route: string }>;
      retainedMetadata?: {
        textLayerIds: string[];
        effectLayerIds: string[];
        sourceLinkedLayerIds: string[];
        filterLayerIds: string[];
      };
      layerWarnings?: Array<{
        layerId: string;
        layerName: string;
        exportMode: string;
        flattened: boolean;
        omitted: boolean;
        warnings: Array<{ code: string; fallbackRoute: string; message: string }>;
      }>;
    };

    expect(importPolicy.compatibilitySignature).toContain('import=bounded-raster');
    expect(descriptor.compatibilitySignature).toContain('import=bounded-raster');
    expect(descriptor.recommendedFallbackRoutes?.map((route) => route.route)).toEqual([
      'png',
      'tiff',
      'psd',
      'source-library',
    ]);
    expect(descriptor.retainedMetadata).toEqual({
      textLayerIds: ['caption'],
      effectLayerIds: ['caption'],
      sourceLinkedLayerIds: ['caption'],
      filterLayerIds: ['caption'],
    });
    expect(descriptor.summary).toMatchObject({
      filterLayerCount: 1,
      warningCount: 6,
    });
    expect(descriptor.layers[1]).toMatchObject({
      id: 'caption',
      exportMode: 'flattened-raster',
      filters: {
        count: 1,
        enabledCount: 1,
        kinds: ['blur'],
        nativeSmartFilters: false,
      },
      warningCodes: [
        'editable-text-flattened',
        'layer-effects-flattened',
        'layer-masks-flattened',
        'source-links-flattened',
        'filter-metadata-flattened',
      ],
    });
    expect(descriptor.layerWarnings?.map((layer) => ({
      layerId: layer.layerId,
      exportMode: layer.exportMode,
      flattened: layer.flattened,
      omitted: layer.omitted,
      warningCodes: layer.warnings.map((warning) => warning.code),
    }))).toEqual([
      {
        layerId: 'caption',
        exportMode: 'flattened-raster',
        flattened: true,
        omitted: false,
        warningCodes: [
          'editable-text-flattened',
          'layer-effects-flattened',
          'layer-masks-flattened',
          'source-links-flattened',
          'filter-metadata-flattened',
        ],
      },
      {
        layerId: 'adjust',
        exportMode: 'omitted-unsupported',
        flattened: false,
        omitted: true,
        warningCodes: ['adjustment-layers-omitted'],
      },
    ]);
    expect(descriptor.layerWarnings?.find((layer) => layer.layerId === 'caption')?.warnings[4]).toMatchObject({
      code: 'filter-metadata-flattened',
      fallbackRoute: 'psd',
    });
    expect(descriptor.policyWarnings?.find((warning) => warning.code === 'source-links-flattened')).toMatchObject({
      descriptorId: 'xcf-policy-warning:v1|scope=export|code=source-links-flattened',
      nativeConstruct: 'source-link',
      affectedLayerIds: ['caption'],
      preservation: 'flattened-raster',
      nativeRoundtrip: 'unsupported',
      fallbackRoute: 'source-library',
    });
    expect(describeImageDocumentXcfExportCompatibility(makeDoc({
      layers: [
        makeLayer({ id: 'paint', name: 'Paint' }),
        caption,
        adjustmentLayer,
      ],
      activeLayerId: 'caption',
    }))).toMatchObject({
      compatibilitySignature: descriptor.compatibilitySignature,
      layerWarnings: descriptor.layerWarnings,
    });
  });

  it('marks filter-only XCF layers as flattened raster exports', () => {
    const descriptor = describeImageDocumentXcfExportCompatibility(makeDoc({
      layers: [
        makeLayer({
          id: 'filtered-paint',
          name: 'Filtered Paint',
          filters: [
            { id: 'filter-blur', kind: 'blur', enabled: true, amount: 4, opacity: 0.75, blendMode: 'normal' },
          ],
        }),
      ],
      activeLayerId: 'filtered-paint',
    }));

    expect(descriptor.layers[0]).toMatchObject({
      id: 'filtered-paint',
      exportMode: 'flattened-raster',
      flattened: true,
      filters: {
        count: 1,
        enabledCount: 1,
        kinds: ['blur'],
        nativeSmartFilters: false,
      },
      warningCodes: ['filter-metadata-flattened'],
    });
    expect(descriptor.compatibilitySignature).toBe(
      'xcf-compatibility:v1|import=bounded-raster|export=layered-raster-export-only|layers=1|exported=1|omitted=0|flattened=1|warnings=filter-metadata-flattened',
    );
  });

  it('summarizes XCF export round-trip risk and layer construct warning coverage', () => {
    const caption = makeLayer({
      id: 'caption',
      name: 'Caption',
      type: 'text',
      text: {
        content: 'Dialog',
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: '700',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: 120,
        boxHeight: 32,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'center',
        verticalAlign: 'middle',
        warp: 'none',
      },
      mask: new OffscreenCanvas(2, 2) as LayerBitmap,
      effects: [
        { id: 'fx-shadow', kind: 'dropShadow', enabled: true, color: '#000000', opacity: 0.5, angle: 135, distance: 7, size: 9 },
      ],
      filters: [
        { id: 'filter-blur', kind: 'blur', enabled: true, amount: 4, opacity: 0.75, blendMode: 'normal' },
      ],
      metadata: {
        smartLinkedSourceId: 'source-1',
        sourceLabel: 'Reference.png',
      },
    });
    const adjustmentLayer = makeLayer({
      id: 'adjust',
      name: 'Print Curve',
      type: 'adjustment',
      bitmap: null,
      adjustment: { kind: 'levels', channel: 'rgb', inputBlack: 8, inputWhite: 245, gamma: 1, outputBlack: 0, outputWhite: 255 },
    });
    const groupLayer = makeLayer({
      id: 'group',
      name: 'Folder',
      type: 'group',
      bitmap: null,
    });

    const descriptor = describeImageDocumentXcfExportCompatibility(makeDoc({
      layers: [
        makeLayer({ id: 'paint', name: 'Paint' }),
        caption,
        adjustmentLayer,
        groupLayer,
      ],
      activeLayerId: 'caption',
    }));

    expect(descriptor.roundTripRisk).toMatchObject({
      level: 'high',
      nativeReopenSupported: false,
      sourceEditStatePreserved: false,
      affectedConstructs: [
        'text',
        'layer-effects',
        'layer-mask',
        'source-link',
        'filter-stack',
        'adjustment-layer',
        'layer-group',
      ],
      recommendedFallbackRoutes: ['psd', 'tiff', 'png', 'source-library'],
    });
    expect(descriptor.fallbackRecommendations.map((route) => [route.rank, route.route, route.action])).toEqual([
      [1, 'psd', 'convert-layered-handoff'],
      [2, 'tiff', 'convert-visible-composite'],
      [3, 'png', 'convert-visible-preview'],
      [4, 'source-library', 'archive-original'],
    ]);
    expect(descriptor.layerConstructWarnings.map((warning) => ({
      layerId: warning.layerId,
      code: warning.code,
      nativeConstruct: warning.nativeConstruct,
      preservation: warning.preservation,
      fallbackRoute: warning.fallbackRoute,
      exportMode: warning.exportMode,
    }))).toEqual([
      {
        layerId: 'caption',
        code: 'editable-text-flattened',
        nativeConstruct: 'text',
        preservation: 'flattened-raster',
        fallbackRoute: 'psd',
        exportMode: 'flattened-raster',
      },
      {
        layerId: 'caption',
        code: 'layer-effects-flattened',
        nativeConstruct: 'layer-effects',
        preservation: 'flattened-raster',
        fallbackRoute: 'psd',
        exportMode: 'flattened-raster',
      },
      {
        layerId: 'caption',
        code: 'layer-masks-flattened',
        nativeConstruct: 'layer-mask',
        preservation: 'flattened-raster',
        fallbackRoute: 'psd',
        exportMode: 'flattened-raster',
      },
      {
        layerId: 'caption',
        code: 'source-links-flattened',
        nativeConstruct: 'source-link',
        preservation: 'flattened-raster',
        fallbackRoute: 'source-library',
        exportMode: 'flattened-raster',
      },
      {
        layerId: 'caption',
        code: 'filter-metadata-flattened',
        nativeConstruct: 'filter-stack',
        preservation: 'flattened-raster',
        fallbackRoute: 'psd',
        exportMode: 'flattened-raster',
      },
      {
        layerId: 'adjust',
        code: 'adjustment-layers-omitted',
        nativeConstruct: 'adjustment-layer',
        preservation: 'omitted',
        fallbackRoute: 'tiff',
        exportMode: 'omitted-unsupported',
      },
      {
        layerId: 'group',
        code: 'layer-groups-omitted',
        nativeConstruct: 'layer-group',
        preservation: 'omitted',
        fallbackRoute: 'psd',
        exportMode: 'omitted-unsupported',
      },
    ]);
  });
});
