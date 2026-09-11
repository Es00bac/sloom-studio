import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createMask, setRect } from './SelectionMask';
import {
  IMAGE_EXPORT_FORMATS,
  buildImageDocumentExportLabel,
  buildImageDocumentExportReadinessDescriptor,
  buildImageDocumentExportReadinessSignature,
  describeImageDocumentExportPolicyDescriptor,
  describeImageDocumentExportPlan,
  flattenImageDocumentToBitmap,
  imageDocumentToBlob,
  imageDocumentToDataUrl,
  normalizeImageExportMimeType,
  renderSelectionMaskToBitmap,
} from './ImageDocumentExport';

class FakeContext {
  drawImageCalls: Array<{
    image: unknown;
    dx: number;
    dy: number;
    alpha: number;
    composite: string;
  }> = [];
  lastImageData: ImageData | null = null;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle = '#000000';
  private stack: Array<{ alpha: number; composite: string }> = [];

  save() {
    this.stack.push({
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
    });
  }

  restore() {
    const next = this.stack.pop();
    if (!next) return;
    this.globalAlpha = next.alpha;
    this.globalCompositeOperation = next.composite;
  }

  drawImage(image: unknown, dx = 0, dy = 0) {
    this.drawImageCalls.push({
      image,
      dx,
      dy,
      alpha: this.globalAlpha,
      composite: this.globalCompositeOperation,
    });
  }

  createImageData(width: number, height: number) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.lastImageData = {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    } as ImageData;
  }

  clearRect() {}
  fillRect() {}

  getImageData(_x = 0, _y = 0, width = 1, height = 1) {
    void _x;
    void _y;
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context = new FakeContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob(options?: { type?: string }) {
    return new Blob([`fake:${this.width}x${this.height}`], {
      type: options?.type ?? 'image/png',
    });
  }
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Portrait',
    width: 12,
    height: 8,
    layers: [],
    activeLayerId: null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
  };
}

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(3, 2) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

describe('ImageDocumentExport', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('flattens visible layers into a transparent document-sized bitmap', () => {
    const base = makeLayer({
      id: 'base',
      x: 1,
      y: 2,
      opacity: 0.5,
      blendMode: 'multiply',
    });
    const hidden = makeLayer({ id: 'hidden', visible: false });
    const masked = makeLayer({
      id: 'masked',
      x: 4,
      y: 5,
      mask: new OffscreenCanvas(3, 2) as LayerBitmap,
    });
    const doc = makeDoc({ layers: [base, hidden, masked] });

    const bitmap = flattenImageDocumentToBitmap(doc);

    expect(bitmap.width).toBe(12);
    expect(bitmap.height).toBe(8);
    const calls = (bitmap as unknown as FakeOffscreenCanvas).context.drawImageCalls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      image: base.bitmap,
      dx: 1,
      dy: 2,
      alpha: 0.5,
      composite: 'multiply',
    });
    expect(calls[1]).toMatchObject({
      dx: 4,
      dy: 5,
      alpha: 1,
      composite: 'source-over',
    });

    const maskedComposite = calls[1].image as FakeOffscreenCanvas;
    expect(maskedComposite.width).toBe(3);
    expect(maskedComposite.height).toBe(2);
    expect(maskedComposite.context.lastImageData).toMatchObject({
      width: 3,
      height: 2,
    });
  });

  it('renders the current selection as a white alpha mask bitmap', () => {
    const mask = createMask(6, 4);
    setRect(mask, 2, 1, 2, 2, 255, false);

    const bitmap = renderSelectionMaskToBitmap(mask);

    const imageData = (bitmap as unknown as FakeOffscreenCanvas).context.lastImageData;
    expect(imageData?.data[(1 * 6 + 2) * 4]).toBe(255);
    expect(imageData?.data[(1 * 6 + 2) * 4 + 1]).toBe(255);
    expect(imageData?.data[(1 * 6 + 2) * 4 + 2]).toBe(255);
    expect(imageData?.data[(1 * 6 + 2) * 4 + 3]).toBe(255);
    expect(imageData?.data[3]).toBe(0);
  });

  it('builds duplicate-safe edited image and mask labels', () => {
    const doc = makeDoc({ title: 'Untitled' });
    const existingItems = [
      { label: 'Portrait edit' },
      { label: 'Portrait edit 2' },
      { label: 'Portrait mask' },
    ];

    expect(buildImageDocumentExportLabel({
      doc,
      sourceLabel: 'Portrait.png',
      existingItems,
      suffix: 'edit',
    })).toBe('Portrait edit 3');
    expect(buildImageDocumentExportLabel({
      doc,
      sourceLabel: 'Portrait.png',
      existingItems,
      suffix: 'mask',
    })).toBe('Portrait mask 2');
  });

  it('supports explicit visible-export image formats', async () => {
    expect(IMAGE_EXPORT_FORMATS.map((format) => format.mimeType)).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/avif',
      'image/bmp',
      'image/gif',
      'image/tiff',
      'image/x-exr',
      'image/svg+xml',
    ]);
    expect(normalizeImageExportMimeType('image/jpeg')).toBe('image/jpeg');
    expect(normalizeImageExportMimeType('image/bmp')).toBe('image/bmp');
    expect(normalizeImageExportMimeType('image/gif')).toBe('image/gif');
    expect(normalizeImageExportMimeType('image/tiff')).toBe('image/tiff');
    expect(normalizeImageExportMimeType('image/x-exr')).toBe('image/x-exr');

    const dataUrl = await imageDocumentToDataUrl(makeDoc(), 'image/jpeg');

    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('describes visible export output dimensions and flattening warnings deterministically', () => {
    const doc = makeDoc({
      width: 48,
      height: 32,
      layers: [
        makeLayer({
          id: 'base',
          name: 'Base',
          opacity: 0.5,
          blendMode: 'multiply',
        }),
        makeLayer({
          id: 'masked',
          name: 'Masked',
          mask: new OffscreenCanvas(3, 2) as LayerBitmap,
          effects: [{
            id: 'stroke-1',
            kind: 'stroke',
            enabled: true,
            color: '#ffffff',
            opacity: 1,
            size: 2,
            position: 'outside',
          }],
          filters: [{
            id: 'blur-1',
            kind: 'blur',
            enabled: true,
            amount: 4,
            opacity: 0.75,
            blendMode: 'normal',
          }],
        }),
        makeLayer({
          id: 'hidden',
          name: 'Hidden',
          visible: false,
        }),
      ],
    });

    expect(describeImageDocumentExportPlan(doc, 'image/jpeg')).toEqual({
      kind: 'visible-export',
      format: { label: 'JPEG', mimeType: 'image/jpeg', extension: 'jpg' },
      sourceDimensions: { width: 48, height: 32 },
      outputDimensions: { width: 48, height: 32 },
      flattening: {
        required: true,
        preservesLayers: false,
        includesHiddenLayers: false,
        visibleLayerIds: ['base', 'masked'],
        omittedHiddenLayerIds: ['hidden'],
        flattenedLayerCount: 2,
        featureCounts: {
          masks: 1,
          effects: 1,
          filters: 1,
          adjustments: 0,
          textLayers: 0,
          vectorLayers: 0,
          nonNormalBlendModes: 1,
          partialOpacity: 1,
          sourceLinks: 0,
        },
        caveats: [
          {
            code: 'hidden-layers-omitted',
            layerIds: ['hidden'],
            message: 'Hidden layers are not included in the flattened visible export.',
          },
          {
            code: 'layer-masks-baked',
            layerIds: ['masked'],
            message: 'Layer masks become baked alpha/pixel results in the output bitmap.',
          },
          {
            code: 'layer-effects-rasterized',
            layerIds: ['masked'],
            message: 'Layer effects are rasterized and cannot be edited after export.',
          },
          {
            code: 'layer-filters-rasterized',
            layerIds: ['masked'],
            message: 'Layer filters are rasterized and cannot be adjusted after export.',
          },
        ],
      },
      warnings: [
        {
          code: 'visible-export-flattens-layers',
          severity: 'warning',
          formatExtension: 'jpg',
          layerIds: ['base', 'masked'],
          message: 'JPEG export writes a flattened visible bitmap and does not preserve editable Image layers.',
        },
        {
          code: 'hidden-layers-omitted',
          severity: 'warning',
          formatExtension: 'jpg',
          layerIds: ['hidden'],
          message: 'Hidden layers are omitted from the visible export.',
        },
        {
          code: 'layer-masks-flattened',
          severity: 'warning',
          formatExtension: 'jpg',
          layerIds: ['masked'],
          message: 'Layer masks are baked into the exported pixels.',
        },
        {
          code: 'layer-effects-flattened',
          severity: 'warning',
          formatExtension: 'jpg',
          layerIds: ['masked'],
          message: 'Layer effects are rasterized into the flattened export.',
        },
        {
          code: 'layer-filters-flattened',
          severity: 'warning',
          formatExtension: 'jpg',
          layerIds: ['masked'],
          message: 'Layer filter stacks are rasterized into the flattened export.',
        },
        {
          code: 'layer-compositing-flattened',
          severity: 'warning',
          formatExtension: 'jpg',
          layerIds: ['base'],
          message: 'Layer opacity and blend modes are composited into the flattened export.',
        },
      ],
    });
  });

  it('plans print/proof export readiness with DPI, profile, and stable preview signatures', () => {
    const doc = makeDoc({
      id: 'doc-print',
      title: 'Poster',
      width: 1200,
      height: 900,
      metadata: {
        colorProof: {
          mode: 'cmyk-soft-proof',
          intent: 'relative-colorimetric',
          profileLabel: 'US Web Coated SWOP',
        },
      },
      layers: [
        makeLayer({ id: 'base' }),
        makeLayer({
          id: 'vector-logo',
          type: 'vector',
          metadata: {
            vectorShape: {
              kind: 'rect',
              width: 100,
              height: 60,
              fillColor: '#ffffff',
              fillOpacity: 1,
              strokeColor: '#000000',
              strokeOpacity: 1,
              strokeWidth: 0,
            },
          },
        }),
      ],
    });

    const descriptor = buildImageDocumentExportReadinessDescriptor(doc, {
      mimeType: 'image/tiff',
      intent: 'print',
      targetDpi: 300,
      colorProfileLabel: 'US Web Coated SWOP',
      previewTag: 'main',
    });

    expect(descriptor).toMatchObject({
      kind: 'export-readiness',
      format: { label: 'TIFF', mimeType: 'image/tiff', extension: 'tif' },
      intent: 'print',
      print: {
        targetDpi: 300,
        widthInches: 4,
        heightInches: 3,
        meetsTargetDpi: true,
      },
      proof: {
        mode: 'cmyk-soft-proof',
        intent: 'relative-colorimetric',
        profileLabel: 'US Web Coated SWOP',
        nativeCmykExport: false,
        outputColorSpace: 'RGB',
      },
      profile: {
        requestedProfileLabel: 'US Web Coated SWOP',
        embeddedProfile: false,
        conversionApplied: false,
      },
      preview: {
        tag: 'main',
        dimensions: { width: 1200, height: 900 },
        flattenedLayerIds: ['base', 'vector-logo'],
        omittedHiddenLayerIds: [],
      },
    });
    expect(descriptor.preview.signature).toBe(
      'image-export:v1|doc=doc-print|fmt=tif|intent=print|size=1200x900|layers=base,vector-logo|hidden=none|dpi=300|proof=cmyk-soft-proof:relative-colorimetric:US Web Coated SWOP|profile=US Web Coated SWOP|tag=main',
    );
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'visible-export-flattens-layers',
      'editable-layer-state-flattened',
      'tiff-export-8bit-rgba',
      'color-profile-not-embedded',
      'cmyk-proof-not-separated',
    ]);
  });

  it('warns when print export target DPI exceeds actual document resolution', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-low-res',
      width: 600,
      height: 400,
      layers: [makeLayer({ id: 'background' })],
    }), {
      mimeType: 'image/png',
      intent: 'print',
      targetDpi: 300,
      printWidthInches: 4,
      printHeightInches: 3,
      previewTag: 'proof-a',
    });

    expect(descriptor.print).toMatchObject({
      targetDpi: 300,
      actualPpiX: 150,
      actualPpiY: 133.3333,
      meetsTargetDpi: false,
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toContain('print-resolution-below-target');
    expect(descriptor.preview.signature).toContain('print=4x3in');
  });

  it('describes press-ready export caveats without claiming native ICC or CMYK separations', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-press-caveats',
      width: 1200,
      height: 900,
      metadata: {
        colorProof: {
          mode: 'cmyk-soft-proof',
          intent: 'relative-colorimetric',
          profileLabel: 'US Web Coated SWOP',
        },
      },
      layers: [makeLayer({ id: 'plate-preview' })],
    }), {
      mimeType: 'image/tiff',
      intent: 'print',
      targetDpi: 300,
      printWidthInches: 6,
      printHeightInches: 4.5,
      colorProfileLabel: 'US Web Coated SWOP',
    });

    expect(descriptor.pressReady).toEqual({
      pressReady: false,
      outputPixelSpace: 'RGB',
      nativeCmyk: false,
      embeddedIccProfile: false,
      minTargetDpi: 300,
      dpiReady: false,
      profileReady: false,
      unsupportedSeparations: [
        {
          code: 'process-cmyk-separations',
          supported: false,
          message: 'Process CMYK separations are unsupported; visible export writes flattened RGB/RGBA pixels.',
        },
        {
          code: 'spot-color-plates',
          supported: false,
          message: 'Spot-color plates are unsupported; spot and proof intent must be handled by external prepress tooling.',
        },
        {
          code: 'icc-output-profile-conversion',
          supported: false,
          message: 'ICC output-profile conversion and embedding are unsupported in the visible export path.',
        },
        {
          code: 'printer-marks-pdfx',
          supported: false,
          message: 'Printer marks, output intents, and PDF/X packaging are outside Image visible export planning.',
        },
      ],
      caveats: [
        'Print size resolves below 300 DPI; resize/upscale or reduce physical print size before press handoff.',
        'Requested profile "US Web Coated SWOP" is recorded as intent metadata only; ICC conversion and embedding are unsupported.',
        'CMYK soft proof is a preview/metadata state only and does not create process-color separations.',
        'Press-ready separations, spot plates, output intents, printer marks, and PDF/X packaging require external prepress tooling.',
      ],
      signature: 'image-export-press-ready:v1|fmt=tif|intent=print|dpi=300|actual=200x200|dpiReady=false|profile=US Web Coated SWOP|profileReady=false|separations=process-cmyk-separations,spot-color-plates,icc-output-profile-conversion,printer-marks-pdfx',
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'print-resolution-below-target',
      'color-profile-not-embedded',
      'cmyk-proof-not-separated',
    ]));
  });

  it('adds deterministic print-proof route warnings for DPI, profiles, and true contract proof gaps', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-print-proof-route',
      width: 900,
      height: 600,
      metadata: {
        colorProof: {
          mode: 'cmyk-soft-proof',
          intent: 'relative-colorimetric',
          profileLabel: 'US Web Coated SWOP',
        },
      },
      layers: [makeLayer({ id: 'proof-layer' })],
    }), {
      mimeType: 'image/tiff',
      intent: 'print',
      targetDpi: 300,
      printWidthInches: 6,
      printHeightInches: 4,
      colorProfileLabel: 'US Web Coated SWOP',
    });

    expect(descriptor.printProof).toEqual({
      mode: 'flattened-rgb-proof-derivative',
      truePrintProof: false,
      dpiReady: false,
      profileReady: false,
      softProofMode: 'cmyk-soft-proof',
      profileLabel: 'US Web Coated SWOP',
      warnings: [
        'Print proof output resolves below the 300 DPI target.',
        'US Web Coated SWOP is recorded as proof intent metadata only; ICC conversion and embedding are not applied.',
        'CMYK soft proof does not create process separations in the flattened export route.',
        'True contract proof calibration, printer marks, output intents, and PDF/X packaging require external prepress tooling.',
      ],
      unsupportedStates: [
        {
          code: 'contract-proof-calibration',
          supported: false,
          message: 'Hardware-calibrated contract proof output is unsupported by Image visible export.',
        },
        {
          code: 'icc-profile-conversion',
          supported: false,
          message: 'ICC output-profile conversion and embedding are unsupported by Image visible export.',
        },
        {
          code: 'pdfx-printer-marks',
          supported: false,
          message: 'PDF/X output intents, registration marks, crop marks, and color bars are not generated.',
        },
      ],
      signature: 'image-export-print-proof:v1|fmt=tif|intent=print|dpiReady=false|profileReady=false|profile=US Web Coated SWOP|trueProof=false|unsupported=contract-proof-calibration,icc-profile-conversion,pdfx-printer-marks',
    });
  });

  it('adds deterministic format warnings for SVG vector flattening and static GIF export limits', () => {
    const vectorDoc = makeDoc({
      id: 'doc-vector-export',
      layers: [
        makeLayer({
          id: 'shape',
          type: 'vector',
          metadata: {
            vectorShape: {
              kind: 'ellipse',
              width: 6,
              height: 4,
              fillColor: '#00ffff',
              fillOpacity: 1,
              strokeColor: '#000000',
              strokeOpacity: 1,
              strokeWidth: 0,
            },
          },
        }),
      ],
    });
    const svg = buildImageDocumentExportReadinessDescriptor(vectorDoc, { mimeType: 'image/svg+xml' });
    const gif = buildImageDocumentExportReadinessDescriptor(vectorDoc, { mimeType: 'image/gif' });

    expect(svg.warnings.map((warning) => warning.code)).toEqual([
      'visible-export-flattens-layers',
      'editable-layer-state-flattened',
      'svg-vector-state-flattened',
    ]);
    expect(gif.warnings.map((warning) => warning.code)).toEqual([
      'visible-export-flattens-layers',
      'editable-layer-state-flattened',
      'gif-export-static-only',
    ]);
  });

  it('describes format capabilities, save-for-web implications, scale metadata, and preset readiness', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-web-export',
      width: 2048,
      height: 1024,
      layers: [
        makeLayer({
          id: 'base',
          opacity: 0.75,
          metadata: {
            sourceLink: {
              id: 'linked-source',
              label: 'Hero.psd',
              status: 'linked',
              relinkHistory: [],
            },
          },
        }),
        makeLayer({
          id: 'headline',
          type: 'text',
          text: {
            content: 'Sloom Studio',
            fontFamily: 'Inter',
            fontSize: 48,
            fontWeight: '700',
            fontStyle: 'normal',
            fontKerning: 'auto',
            fontVariantCaps: 'normal',
            baselineShift: 0,
            boxWidth: null,
            boxHeight: null,
            wrap: false,
            color: '#ffffff',
            letterSpacing: 0,
            lineHeight: 1.2,
            align: 'center',
            verticalAlign: 'top',
            warp: 'none',
          },
        }),
      ],
    }), {
      mimeType: 'image/webp',
      intent: 'screen',
      workflow: 'save-for-web',
      scale: 0.5,
      targetDpi: 144,
      requestedAnimation: true,
      exportPreset: {
        id: 'webp-half',
        label: 'WebP half',
        quality: 82,
        metadataPolicy: 'strip',
      },
      batch: {
        enabled: true,
        itemCount: 3,
        nameTemplate: '{document}-{preset}-{index}',
      },
    });

    expect(descriptor.workflow).toBe('save-for-web');
    expect(descriptor.status).toBe('blocked');
    expect(descriptor.capability).toEqual({
      formatExtension: 'webp',
      transparency: 'alpha',
      animation: 'unsupported',
      vector: 'rasterized',
      text: 'rasterized',
      layers: 'flattened',
      colorProfile: 'not-embedded',
      metadata: 'stripped',
      browserEncoder: true,
    });
    expect(descriptor.scale).toEqual({
      factor: 0.5,
      sourceDimensions: { width: 2048, height: 1024 },
      outputDimensions: { width: 1024, height: 512 },
      metadataDpi: 144,
      dpiEmbedded: false,
      resampling: 'browser-bitmap-resample',
    });
    expect(descriptor.implications.map((implication) => implication.code)).toEqual([
      'alpha-preserved',
      'animation-unsupported',
      'vector-rasterized',
      'text-rasterized',
      'layers-flattened',
      'metadata-stripped',
    ]);
    expect(descriptor.exportPreset).toEqual({
      ready: true,
      id: 'webp-half',
      label: 'WebP half',
      quality: 82,
      metadataPolicy: 'strip',
      signature: 'preset=webp-half|quality=82|metadata=strip',
    });
    expect(descriptor.batch).toEqual({
      ready: true,
      enabled: true,
      itemCount: 3,
      nameTemplate: '{document}-{preset}-{index}',
      warnings: [],
      signature: 'batch=on|items=3|template={document}-{preset}-{index}',
    });
    expect(descriptor.sourceBinHandoff).toMatchObject({
      target: 'source-bin',
      safe: false,
      sourceItemId: null,
      sourceUrlKind: 'durable',
      packageFlattenedDerivative: true,
      preserveOriginalSourceReference: true,
      caveats: [
        {
          code: 'flattened-derivative-required',
          message: 'Handoff should package the exported flattened derivative as a new asset, not overwrite the editable Image document.',
        },
        {
          code: 'source-link-editability-not-preserved',
          message: 'Source-linked layer editability is not preserved in the flattened derivative; package originals separately when provenance matters.',
        },
        {
          code: 'source-id-missing',
          message: 'A durable Source Library item id is needed before Flow, Video, or Paper can safely reference the exported derivative.',
        },
      ],
    });
    expect(descriptor.blockers.map((blocker) => blocker.code)).toEqual(['animation-export-unsupported']);
    expect(descriptor.unsupportedStates.map((state) => state.code)).toEqual(['animated-webp-export']);
    expect(descriptor.signature).toBe(
      'image-export-readiness:v1|doc=doc-web-export|workflow=save-for-web|status=blocked|fmt=webp|scale=0.5|size=1024x512|dpi=144|bitDepth=8to8|preset=webp-half|batch=3|handoff=caveat|warnings=visible-export-flattens-layers,editable-layer-state-flattened,layer-compositing-flattened,source-links-flattened|blockers=animation-export-unsupported|unsupported=animated-webp-export',
    );
  });

  it('blocks empty batch exports and reports unsupported palette/color-profile states deterministically', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-gif-palette',
      width: 300,
      height: 200,
      layers: [makeLayer({ id: 'only' })],
    }), {
      mimeType: 'image/gif',
      workflow: 'export-as',
      targetDpi: 96,
      colorProfileLabel: 'Display P3',
      requestedTransparency: true,
      batch: {
        enabled: true,
        itemCount: 0,
        nameTemplate: '',
      },
    });

    expect(descriptor.status).toBe('blocked');
    expect(descriptor.capability).toMatchObject({
      formatExtension: 'gif',
      transparency: 'binary',
      animation: 'static-only',
      colorProfile: 'not-embedded',
    });
    expect(descriptor.batch).toEqual({
      ready: false,
      enabled: true,
      itemCount: 0,
      nameTemplate: '',
      warnings: [
        'Batch export needs at least one target item.',
        'Batch export needs a non-empty file-name template.',
      ],
      signature: 'batch=on|items=0|template=none',
    });
    expect(descriptor.blockers.map((blocker) => blocker.code)).toEqual(['batch-empty', 'batch-template-missing']);
    expect(descriptor.unsupportedStates.map((state) => state.code)).toEqual([
      'gif-alpha-quantized',
      'indexed-palette-editor',
      'icc-profile-embedding',
    ]);
    expect(descriptor.implications.map((implication) => implication.code)).toContain('alpha-quantized');
  });

  it('describes source-bin handoff safety for flattened derivatives and blob-only outputs', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-source-handoff',
      width: 1600,
      height: 900,
      layers: [
        makeLayer({ id: 'visible' }),
        makeLayer({
          id: 'linked-logo',
          metadata: {
            smartLinkedSourceId: 'logo-original',
          },
        }),
        makeLayer({ id: 'hidden-notes', visible: false }),
      ],
    }), {
      mimeType: 'image/png',
      colorProfileLabel: 'Display P3',
      sourceBinHandoff: {
        target: 'video',
        sourceItemId: 'exported-still',
        sourceUrlKind: 'blob',
        preserveOriginalSourceReference: false,
      },
    });

    expect(descriptor.flattening.caveats.map((caveat) => caveat.code)).toEqual([
      'hidden-layers-omitted',
      'source-links-derived-only',
    ]);
    expect(descriptor.sourceBinHandoff).toEqual({
      target: 'video',
      safe: false,
      sourceItemId: 'exported-still',
      sourceUrlKind: 'blob',
      packageFlattenedDerivative: true,
      preserveOriginalSourceReference: false,
      caveats: [
        {
          code: 'flattened-derivative-required',
          message: 'Handoff should package the exported flattened derivative as a new asset, not overwrite the editable Image document.',
        },
        {
          code: 'hidden-layers-not-packaged',
          message: 'Hidden layers are omitted from the derivative and remain available only in the Image document.',
        },
        {
          code: 'source-link-editability-not-preserved',
          message: 'Source-linked layer editability is not preserved in the flattened derivative; package originals separately when provenance matters.',
        },
        {
          code: 'blob-url-not-durable',
          message: 'Blob URLs are session-local; persist the exported derivative into project scratch or native media before cross-workspace handoff.',
        },
        {
          code: 'profile-intent-metadata-only',
          message: 'Color profile intent is metadata-only for this export path and should not be treated as embedded ICC data.',
        },
        {
          code: 'video-handoff-still-frame-only',
          message: 'Video handoff receives a still flattened frame; print-proof metadata does not become timeline-aware video output.',
        },
      ],
      signature: 'image-export-source-bin-handoff:v1|target=video|safe=false|source=exported-still|url=blob|preserveOriginal=false|caveats=flattened-derivative-required,hidden-layers-not-packaged,source-link-editability-not-preserved,blob-url-not-durable,profile-intent-metadata-only,video-handoff-still-frame-only',
    });
  });

  it('builds deterministic per-format warning summary groups for flattened export limitations', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-warning-summary',
      width: 800,
      height: 600,
      layers: [
        makeLayer({
          id: 'text-headline',
          type: 'text',
          text: {
            content: 'Headline',
            fontFamily: 'Inter',
            fontSize: 48,
            fontWeight: '700',
            fontStyle: 'normal',
            fontKerning: 'auto',
            fontVariantCaps: 'normal',
            baselineShift: 0,
            boxWidth: null,
            boxHeight: null,
            wrap: false,
            color: '#ffffff',
            letterSpacing: 0,
            lineHeight: 1.2,
            align: 'left',
            verticalAlign: 'top',
            warp: 'none',
          },
        }),
        makeLayer({
          id: 'vector-badge',
          type: 'vector',
          metadata: {
            vectorShape: {
              kind: 'rect',
              width: 160,
              height: 64,
              fillColor: '#ff00ff',
              fillOpacity: 1,
              strokeColor: '#000000',
              strokeOpacity: 1,
              strokeWidth: 2,
            },
          },
        }),
        makeLayer({
          id: 'fx-layer',
          mask: new OffscreenCanvas(3, 2) as LayerBitmap,
          effects: [{
            id: 'shadow-1',
            kind: 'dropShadow',
            enabled: true,
            color: '#000000',
            opacity: 0.5,
            distance: 4,
            size: 6,
            angle: 135,
          }],
        }),
      ],
    }), {
      mimeType: 'image/tiff',
      intent: 'print',
      targetDpi: 300,
      colorProfileLabel: 'Display P3',
    });

    expect(descriptor.warningSummaryGroups).toEqual([
      {
        code: 'flattened-text',
        formatExtension: 'tif',
        warningCodes: ['editable-layer-state-flattened'],
        layerIds: ['text-headline'],
        message: 'TIFF export rasterizes editable text into the flattened output.',
      },
      {
        code: 'flattened-vector',
        formatExtension: 'tif',
        warningCodes: ['editable-layer-state-flattened'],
        layerIds: ['vector-badge'],
        message: 'TIFF export rasterizes editable vector content into the flattened output.',
      },
      {
        code: 'flattened-effects',
        formatExtension: 'tif',
        warningCodes: ['layer-effects-flattened'],
        layerIds: ['fx-layer'],
        message: 'TIFF export rasterizes layer effects into the flattened output.',
      },
      {
        code: 'flattened-masks',
        formatExtension: 'tif',
        warningCodes: ['layer-masks-flattened'],
        layerIds: ['fx-layer'],
        message: 'TIFF export bakes layer masks into flattened alpha and pixels.',
      },
      {
        code: 'color-profile',
        formatExtension: 'tif',
        warningCodes: ['color-profile-not-embedded'],
        layerIds: ['text-headline', 'vector-badge', 'fx-layer'],
        message: 'TIFF export records Display P3 as metadata intent only and does not embed an ICC profile.',
      },
      {
        code: 'high-bit-depth',
        formatExtension: 'tif',
        warningCodes: ['tiff-export-8bit-rgba'],
        layerIds: ['text-headline', 'vector-badge', 'fx-layer'],
        message: 'TIFF export writes flattened 8-bit RGBA output and does not preserve high-bit-depth document data.',
      },
    ]);
  });

  it('reports source high-bit-depth documents as 8-bit visible export derivatives for any target format', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-high-bit-source',
      width: 1600,
      height: 900,
      metadata: {
        sourceFormat: 'EXR',
        sourceMimeType: 'image/exr',
        sourceBitDepth: 32,
      },
      layers: [makeLayer({ id: 'base' })],
    }), {
      mimeType: 'image/png',
      intent: 'print',
      targetDpi: 300,
    });

    expect(descriptor.bitDepth).toEqual({
      sourceFormat: 'EXR',
      sourceBitDepth: 32,
      exportBitDepth: 8,
      preservesSourceBitDepth: false,
      highBitDepthCaveats: [
        'EXR source precision is represented by the editable Image document as 8-bit RGBA canvas data.',
        'PNG export writes a flattened 8-bit RGB/RGBA derivative; keep the EXR source master for 32-bit print, archive, or VFX handoff.',
      ],
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toContain('source-high-bit-depth-downsampled');
    expect(descriptor.warningSummaryGroups).toContainEqual({
      code: 'high-bit-depth',
      formatExtension: 'png',
      warningCodes: ['source-high-bit-depth-downsampled'],
      layerIds: ['base'],
      message: 'PNG export writes flattened 8-bit RGB/RGBA output and does not preserve 32-bit EXR source data.',
    });
    expect(descriptor.signature).toContain('bitDepth=32to8');
  });

  it('builds deterministic blocker summaries for missing durable source handoff state', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-blocker-summary',
      width: 640,
      height: 480,
      layers: [makeLayer({ id: 'base' })],
    }), {
      mimeType: 'image/png',
      sourceBinHandoff: {
        target: 'flow',
        sourceUrlKind: 'blob',
        sourceItemId: null,
      },
    });

    expect(descriptor.blockerSummaries).toEqual([
      {
        code: 'source-id-missing',
        formatExtension: 'png',
        caveatCodes: ['source-id-missing'],
        message: 'PNG handoff needs a durable Source Library item id before Flow can safely reference the exported derivative.',
      },
      {
        code: 'blob-url-not-durable',
        formatExtension: 'png',
        caveatCodes: ['blob-url-not-durable'],
        message: 'PNG handoff cannot rely on blob URLs for Flow because blob-backed exports are session-local and not durable.',
      },
    ]);
  });

  it('builds typed export policy descriptors with stable signatures for format, proof, preset, and handoff risk', () => {
    const descriptor = describeImageDocumentExportPolicyDescriptor(makeDoc({
      id: 'doc-policy',
      width: 2400,
      height: 1200,
      metadata: {
        sourceFormat: 'PSD',
        sourceBitDepth: 16,
        colorProof: {
          mode: 'cmyk-soft-proof',
          intent: 'relative-colorimetric',
          profileLabel: 'GRACoL 2013',
        },
      },
      layers: [
        makeLayer({
          id: 'title',
          type: 'text',
          text: {
            content: 'Policy',
            fontFamily: 'Inter',
            fontSize: 48,
            fontWeight: '700',
            fontStyle: 'normal',
            fontKerning: 'auto',
            fontVariantCaps: 'normal',
            baselineShift: 0,
            boxWidth: null,
            boxHeight: null,
            wrap: false,
            color: '#ffffff',
            letterSpacing: 0,
            lineHeight: 1.2,
            align: 'left',
            verticalAlign: 'top',
            warp: 'none',
          },
        }),
        makeLayer({
          id: 'badge',
          type: 'vector',
          metadata: {
            vectorShape: {
              kind: 'rect',
              width: 200,
              height: 80,
              fillColor: '#ff00ff',
              fillOpacity: 1,
              strokeColor: '#000000',
              strokeOpacity: 1,
              strokeWidth: 2,
            },
          },
        }),
      ],
    }), {
      mimeType: 'image/gif',
      intent: 'print',
      targetDpi: 300,
      printWidthInches: 12,
      printHeightInches: 8,
      colorProfileLabel: 'GRACoL 2013',
      sourceBitDepth: 16,
      requestedAnimation: true,
      requestedTransparency: true,
      exportPreset: {
        id: 'legacy-gif',
        label: 'Legacy GIF',
        quality: 70,
        metadataPolicy: 'strip',
      },
      sourceBinHandoff: {
        target: 'paper',
        sourceItemId: null,
        sourceUrlKind: 'blob',
      },
    });

    expect(descriptor.descriptorId).toBe('image-export-policy:v1');
    expect(descriptor.formatPolicy).toMatchObject({
      signature: 'image-export-format-policy:v1|fmt=gif|transparency=binary|animation=static-only|vector=rasterized|text=rasterized|layers=flattened|profile=not-embedded|metadata=stripped|browserEncoder=false',
      unsupportedStateCodes: [
        'animated-gif-export',
        'gif-alpha-quantized',
        'indexed-palette-editor',
        'icc-profile-embedding',
        'icc-profile-conversion',
        'pdfx-printer-marks',
        'live-native-vector-preservation',
        'live-native-text-preservation',
        'native-layer-effect-preservation',
        'true-cmyk-separations',
        'spot-color-separations',
        'high-bit-depth-output',
      ],
    });
    expect(descriptor.flatteningRisk).toEqual({
      signature: 'image-export-flattening-risk:v1|required=true|layers=title,badge|hidden=none|text=1|vector=1|effects=0|masks=0|sourceLinks=0',
      nativeConstructRiskCodes: [
        'live-native-vector-preservation',
        'live-native-text-preservation',
      ],
      flattenedFeatureCounts: descriptor.readiness.flattening.featureCounts,
    });
    expect(descriptor.proofPressPolicy.signatures).toEqual({
      printProof: 'image-export-print-proof:v1|fmt=gif|intent=print|dpiReady=false|profileReady=false|profile=GRACoL 2013|trueProof=false|unsupported=contract-proof-calibration,icc-profile-conversion,pdfx-printer-marks',
      pressReady: 'image-export-press-ready:v1|fmt=gif|intent=print|dpi=300|actual=200x150|dpiReady=false|profile=GRACoL 2013|profileReady=false|separations=process-cmyk-separations,spot-color-plates,icc-output-profile-conversion,printer-marks-pdfx',
    });
    expect(descriptor.presetCompatibility).toEqual({
      ready: false,
      presetSignature: 'preset=legacy-gif|quality=70|metadata=strip',
      compatibilitySignature: 'image-export-preset-compat:v1|preset=legacy-gif|fmt=gif|ready=false|metadata=strip|quality=70|warnings=animated-gif-export,gif-alpha-quantized,indexed-palette-editor,icc-profile-embedding,live-native-vector-preservation,live-native-text-preservation,native-layer-effect-preservation,true-cmyk-separations,spot-color-separations,high-bit-depth-output|blockers=none',
      warningCodes: [
        'animated-gif-export',
        'gif-alpha-quantized',
        'indexed-palette-editor',
        'icc-profile-embedding',
        'live-native-vector-preservation',
        'live-native-text-preservation',
        'native-layer-effect-preservation',
        'true-cmyk-separations',
        'spot-color-separations',
        'high-bit-depth-output',
      ],
      blockerCodes: [],
    });
    expect(descriptor.sourceBinHandoffRisk).toEqual({
      safe: false,
      signature: 'image-export-source-bin-handoff:v1|target=paper|safe=false|source=missing|url=blob|preserveOriginal=true|caveats=flattened-derivative-required,blob-url-not-durable,source-id-missing,profile-intent-metadata-only,paper-proof-routing-review-only',
      riskSignature: 'image-export-source-handoff-risk:v1|target=paper|safe=false|url=blob|source=missing|caveats=flattened-derivative-required,blob-url-not-durable,source-id-missing,profile-intent-metadata-only,paper-proof-routing-review-only',
      caveatCodes: [
        'flattened-derivative-required',
        'blob-url-not-durable',
        'source-id-missing',
        'profile-intent-metadata-only',
        'paper-proof-routing-review-only',
      ],
    });
    expect(descriptor.stableSignatures).toEqual({
      formatPolicy: descriptor.formatPolicy.signature,
      exportPresetCompatibility: descriptor.presetCompatibility.compatibilitySignature,
      printProof: descriptor.proofPressPolicy.signatures.printProof,
      pressReady: descriptor.proofPressPolicy.signatures.pressReady,
      sourceBinHandoffRisk: descriptor.sourceBinHandoffRisk.riskSignature,
      readiness: descriptor.readiness.signature,
    });
  });

  it('builds a stable readiness signature from descriptor state', () => {
    const descriptor = buildImageDocumentExportReadinessDescriptor(makeDoc({
      id: 'doc-signature',
      width: 400,
      height: 300,
      layers: [makeLayer({ id: 'base' })],
    }), {
      mimeType: 'image/png',
      workflow: 'export-as',
      scale: 2,
      targetDpi: 300,
      exportPreset: { id: 'retina', label: 'Retina', metadataPolicy: 'preserve' },
    });

    expect(buildImageDocumentExportReadinessSignature(descriptor)).toBe(descriptor.signature);
    expect(descriptor.signature).toBe(
      'image-export-readiness:v1|doc=doc-signature|workflow=export-as|status=ready|fmt=png|scale=2|size=800x600|dpi=300|bitDepth=8to8|preset=retina|batch=off|handoff=caveat|warnings=none|blockers=none|unsupported=none',
    );
  });

  it('adds target-specific Paper and Video handoff warnings without changing preview signatures', () => {
    const doc = makeDoc({
      id: 'doc-handoff-routing',
      width: 1600,
      height: 900,
      metadata: {
        colorProof: {
          mode: 'cmyk-soft-proof',
          intent: 'relative-colorimetric',
          profileLabel: 'FOGRA39',
        },
      },
      layers: [
        makeLayer({
          id: 'linked',
          metadata: {
            sourceLink: {
              id: 'src-1',
              label: 'Linked.psd',
              status: 'linked',
              relinkHistory: [],
            },
          },
        }),
      ],
    });

    const paper = buildImageDocumentExportReadinessDescriptor(doc, {
      mimeType: 'image/png',
      intent: 'print',
      targetDpi: 300,
      previewTag: 'handoff',
      sourceBinHandoff: {
        target: 'paper',
        sourceItemId: 'paper-asset-1',
        sourceUrlKind: 'durable',
      },
    });
    const video = buildImageDocumentExportReadinessDescriptor(doc, {
      mimeType: 'image/png',
      intent: 'proof',
      targetDpi: 144,
      previewTag: 'handoff',
      sourceBinHandoff: {
        target: 'video',
        sourceItemId: 'video-asset-1',
        sourceUrlKind: 'durable',
      },
    });

    expect(paper.sourceBinHandoff.target).toBe('paper');
    expect(paper.sourceBinHandoff.caveats.map((caveat) => caveat.code)).toContain('paper-proof-routing-review-only');
    expect(paper.sourceBinHandoff.caveats.map((caveat) => caveat.message).join(' ')).toContain(
      'Paper handoff receives a flattened page/placeable asset',
    );
    expect(video.sourceBinHandoff.target).toBe('video');
    expect(video.sourceBinHandoff.caveats.map((caveat) => caveat.code)).toContain('video-handoff-still-frame-only');
    expect(video.sourceBinHandoff.caveats.map((caveat) => caveat.message).join(' ')).toContain(
      'Video handoff receives a still flattened frame',
    );
    expect(paper.preview.signature).toBe(
      'image-export:v1|doc=doc-handoff-routing|fmt=png|intent=print|size=1600x900|layers=linked|hidden=none|dpi=300|proof=cmyk-soft-proof:relative-colorimetric:FOGRA39|profile=FOGRA39|tag=handoff',
    );
    expect(video.preview.signature).toBe(
      'image-export:v1|doc=doc-handoff-routing|fmt=png|intent=proof|size=1600x900|layers=linked|hidden=none|dpi=144|proof=cmyk-soft-proof:relative-colorimetric:FOGRA39|profile=FOGRA39|tag=handoff',
    );
  });

  it('encodes BMP and static GIF exports without relying on browser canvas MIME support', async () => {
    const bmp = new Uint8Array(await (await imageDocumentToBlob(makeDoc({ width: 2, height: 2 }), 'image/bmp')).arrayBuffer());
    const gif = new Uint8Array(await (await imageDocumentToBlob(makeDoc({ width: 2, height: 2 }), 'image/gif')).arrayBuffer());

    expect(String.fromCharCode(...bmp.slice(0, 2))).toBe('BM');
    expect(String.fromCharCode(...gif.slice(0, 6))).toBe('GIF89a');
  });

  it('exports native u16/f32 authority directly for PNG16, TIFF, and OpenEXR', async () => {
    const u16 = makeDoc({
      width: 2,
      height: 1,
      metadata: { bitDepth: 16, sourceBitDepth: 16, sourceFormat: 'PNG' },
      layers: [makeLayer({
        bitmap: new OffscreenCanvas(2, 1) as LayerBitmap,
        pixels: {
          width: 2, height: 1, model: 'rgb', depth: 'u16',
          data: new Uint16Array([1001, 2002, 3003, 65535, 4004, 5005, 6006, 32768]),
        },
      })],
    });
    const pngBytes = new Uint8Array(await (await imageDocumentToBlob(u16, 'image/png')).arrayBuffer());
    const { decodePngRaster } = await import('./codecs/png16');
    expect(decodePngRaster(pngBytes).data).toEqual(u16.layers[0]!.pixels!.data);

    const f32 = makeDoc({
      width: 1,
      height: 1,
      metadata: { bitDepth: 32, sourceBitDepth: 32, sourceFormat: 'OpenEXR' },
      layers: [makeLayer({
        bitmap: new OffscreenCanvas(1, 1) as LayerBitmap,
        pixels: { width: 1, height: 1, model: 'rgb', depth: 'f32', data: new Float32Array([4, -1, 0.5, 1]) },
      })],
    });
    const tiffBytes = new Uint8Array(await (await imageDocumentToBlob(f32, 'image/tiff')).arrayBuffer());
    const { decodeHighBitTiff } = await import('./codecs/tiffHighBit');
    expect(decodeHighBitTiff(tiffBytes).data).toEqual(f32.layers[0]!.pixels!.data);
    const exrBytes = new Uint8Array(await (await imageDocumentToBlob(f32, 'image/x-exr')).arrayBuffer());
    const { decodeExr } = await import('./codecs/exr');
    expect(decodeExr(exrBytes).data).toEqual(f32.layers[0]!.pixels!.data);
  });

  it('refuses native exports that would silently downgrade depth or composite unsupported layers', async () => {
    const f32 = makeDoc({
      width: 1,
      height: 1,
      metadata: { bitDepth: 32, sourceBitDepth: 32, sourceFormat: 'OpenEXR' },
      layers: [makeLayer({
        bitmap: new OffscreenCanvas(1, 1) as LayerBitmap,
        pixels: { width: 1, height: 1, model: 'rgb', depth: 'f32', data: new Float32Array([0, 0, 0, 1]) },
      })],
    });
    await expect(imageDocumentToBlob(f32, 'image/png')).rejects.toThrow(/PNG16|f32/i);
    await expect(imageDocumentToBlob({ ...f32, layers: [...f32.layers, makeLayer({ id: 'second', bitmap: new OffscreenCanvas(1, 1) as LayerBitmap, pixels: f32.layers[0]!.pixels })] }, 'image/x-exr')).rejects.toThrow(/one visible raster layer|composite/i);
    const hostile = { ...f32, layers: [{ ...f32.layers[0]!, pixels: { ...f32.layers[0]!.pixels!, data: new Float32Array([Number.NaN, 0, 0, 1]) } }] };
    await expect(imageDocumentToBlob(hostile, 'image/x-exr')).rejects.toThrow(/non-finite/i);
  });

  it('does not invent an EXR encoder for ordinary 8-bit documents', async () => {
    await expect(imageDocumentToBlob(makeDoc(), 'image/x-exr')).rejects.toThrow(/native 32-bit float|not converted/i);
  });

  it('describes native depth-preserving export and refusal boundaries in readiness policy', () => {
    const native16 = buildImageDocumentExportReadinessDescriptor(makeDoc({
      metadata: { sourceFormat: 'PNG', sourceBitDepth: 16, bitDepth: 16 },
    }), { mimeType: 'image/png' });
    expect(native16.bitDepth).toMatchObject({
      sourceBitDepth: 16,
      exportBitDepth: 16,
      preservesSourceBitDepth: true,
    });
    expect(native16.bitDepth.highBitDepthCaveats.join(' ')).toMatch(/native 16-bit.*directly/i);

    const refused32 = buildImageDocumentExportReadinessDescriptor(makeDoc({
      metadata: { sourceFormat: 'OpenEXR', sourceBitDepth: 32, bitDepth: 32 },
    }), { mimeType: 'image/png' });
    expect(refused32.bitDepth).toMatchObject({
      sourceBitDepth: 32,
      exportBitDepth: 8,
      preservesSourceBitDepth: false,
    });
    expect(refused32.bitDepth.highBitDepthCaveats.join(' ')).toMatch(/refuses rather than routing through the 8-bit proxy/i);
  });
});
