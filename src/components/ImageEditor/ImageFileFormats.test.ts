import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { LayerBitmap } from '../../types/imageEditor';
import {
  decodeTiffToImageData,
  describeCameraRawOpenPolicy,
  describePhotoshopDocumentSizePolicy,
  detectSourceImageFormatPolicy,
  describeCameraRawImportReadiness,
  describeCameraRawDevelopFirstMetadata,
  describeSourceImageFileOpenReadiness,
  describeSourceImageFormatPolicy,
  describeSourceImageFormatExportReadiness,
  encodeImageDataToTiff,
  isCameraRawExtension,
  isCameraRawMimeType,
  isAnimatedGif,
  createSvgImageDocument,
  createTiffImageDocument,
} from './ImageFileFormats';
import { createImageCmykPixelBuffer } from './cmyk/ImageCmykDocument';
import { encodeImageCmykTiff } from './cmyk/cmykTiff';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const fogra39Identity = {
  source: { kind: 'bundled' as const, id: 'fogra39' },
  id: 'fogra39',
  label: 'FOGRA39',
  url: '/icc/FOGRA39L_coated.icc',
  outputConditionId: 'FOGRA39',
};

class FakeContext {
  drawn: unknown[] = [];
  imageData: ImageData | null = null;

  drawImage(image: unknown) {
    this.drawn.push(image);
  }

  putImageData(imageData: ImageData) {
    this.imageData = imageData;
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
}

function makeImageData(width: number, height: number, data: number[]): ImageData {
  return { width, height, data: new Uint8ClampedArray(data) } as ImageData;
}

describe('ImageFileFormats', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    globalThis.createImageBitmap = vi.fn(async () => ({
      width: 32,
      height: 16,
      close: vi.fn(),
    })) as unknown as typeof createImageBitmap;
  });

  it('encodes and decodes uncompressed 8-bit RGBA TIFF data', () => {
    const input = makeImageData(2, 1, [255, 0, 0, 255, 0, 128, 255, 64]);
    const encoded = encodeImageDataToTiff(input);
    const decoded = decodeTiffToImageData(copyToArrayBuffer(encoded));

    expect(encoded[0]).toBe(0x49);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect([...decoded.data]).toEqual([...input.data]);
  });

  it('reports unsupported TIFF compression clearly', () => {
    const input = makeImageData(1, 1, [1, 2, 3, 4]);
    const encoded = encodeImageDataToTiff(input);
    const view = new DataView(encoded.buffer);
    const compressionEntry = 8 + 2 + 3 * 12;
    view.setUint16(compressionEntry + 8, 5, true);

    expect(() => decodeTiffToImageData(copyToArrayBuffer(encoded))).toThrow(/compressed TIFF/);
  });

  it('opens an ordinary DeviceCMYK TIFF through native CMYKA authority instead of RGBA channel reinterpretation', async () => {
    const authority = createImageCmykPixelBuffer(1, 1, new Uint8Array([12, 34, 56, 78, 255]));
    const encoded = encodeImageCmykTiff(authority, fogra39Identity, fogra39);
    await expect(createTiffImageDocument(copyToArrayBuffer(encoded.bytes), {
      id: 'device-cmyk', title: 'press.tif', sourceMimeType: 'image/tiff',
    })).resolves.toMatchObject({
      metadata: { colorMode: 'cmyk', cmyk: { profileSource: { kind: 'imported' } } },
      layers: [{ cmykPixels: { data: authority.data } }],
    });
    expect(() => decodeTiffToImageData(copyToArrayBuffer(encoded.bytes))).toThrow(/native CMYK importer/i);
  });

  it('detects SVG, animated GIF, PSB, XCF, EXR, and Camera Raw policies', () => {
    const psb = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 2]);
    const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 0, 0, 0, 0, 0, 0, 0, 0x2c, 0, 0x2c]);

    expect(detectSourceImageFormatPolicy({ fileName: 'icon.svg', bytes: new TextEncoder().encode('<svg />') })).toEqual({ kind: 'svg' });
    expect(detectSourceImageFormatPolicy({ fileName: 'large.psb', bytes: psb })).toMatchObject({ kind: 'psb' });
    expect(detectSourceImageFormatPolicy({ fileName: 'gimp.xcf' })).toMatchObject({ kind: 'xcf' });
    expect(detectSourceImageFormatPolicy({ fileName: 'linear.exr' })).toMatchObject({ kind: 'exr' });
    expect(detectSourceImageFormatPolicy({ fileName: 'capture.NEF', mimeType: 'image/x-nikon-nef' })).toMatchObject({
      kind: 'cameraRaw',
      message: expect.stringMatching(/Camera Raw|RAW|demosaic/i),
    });
    expect(detectSourceImageFormatPolicy({ fileName: 'archive.dng' })).toMatchObject({ kind: 'cameraRaw' });
    expect(isAnimatedGif(gif)).toBe(true);
    expect(detectSourceImageFormatPolicy({ fileName: 'loop.gif', bytes: gif })).toMatchObject({
      kind: 'gif',
      animated: true,
      warning: expect.stringMatching(/first frame/),
    });
  });

  it('describes honest PSD and PSB interoperability policies', () => {
    const psd = describeSourceImageFormatPolicy({ kind: 'psd' });
    const psb = describeSourceImageFormatPolicy({
      kind: 'psb',
      message: 'PSB large-document files are not supported in Image yet. Convert to PSD, TIFF, PNG, or JPEG before opening.',
    });

    expect(psd.importSummary).toMatch(/layered PSD import/i);
    expect(psd.exportSummary).toMatch(/PSD export/i);
    expect(psd.exportSummary).toMatch(/metadata-only|flattened/i);
    expect(psd.limitations.join(' ')).toMatch(/smart object|editable text|adjustment|layer effect/i);

    expect(psb.importSummary).toMatch(/not supported|not decoded|cannot open/i);
    expect(psb.exportSummary).toMatch(/convert|PSD|TIFF|PNG|JPEG/i);
    expect(psb.limitations.join(' ')).toMatch(/large document|PSB/i);
  });

  it('describes bounded XCF raster import and animated GIF limits', () => {
    const xcf = describeSourceImageFormatPolicy({
      kind: 'xcf',
      message: 'XCF export is available, but importing GIMP XCF workfiles is not decoded in Image yet. Open the XCF in GIMP and export PSD, TIFF, PNG, or JPEG before opening here.',
    });
    const gif = describeSourceImageFormatPolicy({
      kind: 'gif',
      animated: true,
      warning: 'Animated GIF opened as the first frame only. Use Video for animation/timing work.',
    });

    expect(xcf.importSummary).toMatch(/layered raster|bounded|XCF/i);
    expect(xcf.exportSummary).toMatch(/XCF.*raster|raster.*XCF/i);
    expect(xcf.limitations.join(' ')).toMatch(/text|group|filter|native/i);

    expect(gif.importSummary).toMatch(/first frame/i);
    expect(gif.exportSummary).toMatch(/static GIF|single frame|flattened/i);
    expect(gif.warnings).toContain('Animated GIF opened as the first frame only. Use Video for animation/timing work.');
    expect(gif.limitations.join(' ')).toMatch(/animation|timing/i);
  });

  it('publishes deterministic format warning codes and import/export support states', () => {
    const xcf = describeSourceImageFormatPolicy({
      kind: 'xcf',
      message: 'XCF export is available, but importing GIMP XCF workfiles is not decoded in Image yet. Open the XCF in GIMP and export PSD, TIFF, PNG, or JPEG before opening here.',
    });
    const svg = describeSourceImageFormatPolicy({ kind: 'svg' });
    const gif = describeSourceImageFormatPolicy({
      kind: 'gif',
      animated: true,
      warning: 'Animated GIF opened as the first frame only. Use Video for animation/timing work.',
    });
    const raw = describeSourceImageFormatPolicy({
      kind: 'cameraRaw',
      message: 'Camera Raw files are detected, but Image does not currently include a RAW demosaic/development pipeline. Develop the RAW file in a camera raw processor and export 8-bit TIFF, PSD, PNG, or JPEG before opening here.',
    });

    expect(xcf).toMatchObject({
      importStatus: 'unsupported',
      exportStatus: 'layered-export-only',
      warningCodes: ['xcf-import-unsupported', 'xcf-editable-state-loss'],
      compatibility: {
        importSupported: false,
        exportSupported: true,
        nativeRoundtrip: 'unsupported',
        preservesEditableLayers: false,
        preservesAnimation: false,
        flattenedExport: false,
      },
    });
    expect(svg).toMatchObject({
      importStatus: 'rasterized',
      exportStatus: 'flattened-raster',
      warningCodes: ['svg-rasterized-import', 'svg-flattened-export'],
    });
    expect(gif).toMatchObject({
      importStatus: 'first-frame-only',
      exportStatus: 'flattened-raster',
      warningCodes: ['gif-animation-first-frame', 'gif-static-flattened-export'],
    });
    expect(raw).toMatchObject({
      importStatus: 'unsupported',
      exportStatus: 'unsupported',
      warningCodes: ['camera-raw-import-unsupported'],
      compatibility: {
        importSupported: false,
        exportSupported: false,
        nativeRoundtrip: 'unsupported',
      },
    });
  });

  it('describes TIFF, SVG, and RAW format limitations without faking unsupported decoding', () => {
    const tiff = describeSourceImageFormatPolicy({ kind: 'tiff' });
    const svg = describeSourceImageFormatPolicy({ kind: 'svg' });
    const raw = describeSourceImageFormatPolicy({
      kind: 'cameraRaw',
      message: 'Camera Raw files are detected, but Image does not currently include a RAW demosaic/development pipeline. Develop the RAW file in a camera raw processor and export 8-bit TIFF, PSD, PNG, or JPEG before opening here.',
    });

    expect(tiff.importSummary).toMatch(/TIFF/i);
    expect(tiff.limitations.join(' ')).toMatch(/8-bit|BigTIFF|compressed|planar/i);
    expect(tiff.exportSummary).toMatch(/TIFF export/i);

    expect(svg.importSummary).toMatch(/rasterized|opened as pixels/i);
    expect(svg.exportSummary).toMatch(/flattened|raster/i);
    expect(svg.limitations.join(' ')).toMatch(/editable vector|browser rasterization|SVG/i);

    expect(raw.importSummary).toMatch(/does not currently include a RAW demosaic|develop/i);
    expect(raw.exportSummary).toMatch(/export 8-bit TIFF, PSD, PNG, or JPEG|develop first/i);
    expect(raw.limitations.join(' ')).toMatch(/RAW|demosaic|non-destructive/i);
  });

  it('describes native PNG16 authority with a derived 8-bit display proxy', () => {
    const policy = detectSourceImageFormatPolicy({
      fileName: 'grade-plate.png',
      mimeType: 'image/png',
      bytes: makePngHeader({ bitDepth: 16, colorType: 6 }),
    });
    const description = describeSourceImageFormatPolicy(policy);
    const baseline = describeSourceImageFormatPolicy({ kind: 'raster' });

    expect(policy).toMatchObject({
      kind: 'raster',
      sourceFormatLabel: 'PNG',
      sourceMimeType: 'image/png',
      sourceExtension: 'png',
      sourceBitsPerChannel: 16,
      highBitDepth: true,
    });
    expect(description).toMatchObject({
      formatLabel: 'PNG',
      sourceMimeType: 'image/png',
      sourceExtension: 'png',
      importStatus: 'supported',
      bitDepth: {
        status: 'native-high-bit-supported',
        sourceBitsPerChannel: 16,
        editorBitsPerChannel: 16,
        browserDecodedTo: 'native u16/f32 PixelBuffer authority',
        preservesHighBitDepth: true,
      },
    });
    expect(description.warningCodes).not.toContain('high-bit-depth-raster-loss');
    expect(description.warnings).toEqual([]);
    expect(description.sourceFormatLimits.join(' ')).toMatch(/PNG16.*native.*u16|u16.*authority/i);

    expect(baseline.bitDepth).toMatchObject({
      status: 'browser-8-bit-rgba',
      sourceBitsPerChannel: 'unknown',
      editorBitsPerChannel: 8,
      browserDecodedTo: '8-bit RGBA canvas pixels',
      preservesHighBitDepth: false,
    });
    expect(baseline.sourceFormatLimits.join(' ')).toMatch(/browser.*8-bit RGBA/i);
  });

  it('describes supported high-bit TIFF authority before decode', () => {
    const policy = detectSourceImageFormatPolicy({
      fileName: 'scan-16.tif',
      mimeType: 'image/tiff',
      bytes: rewriteTiffBitsPerSample(encodeImageDataToTiff(makeImageData(1, 1, [10, 20, 30, 255])), 16),
    });
    const description = describeSourceImageFormatPolicy(policy);

    expect(policy).toMatchObject({
      kind: 'tiff',
      sourceBitsPerChannel: 16,
      highBitDepth: true,
    });
    expect(description).toMatchObject({
      formatLabel: 'TIFF',
      importStatus: 'supported',
      compatibility: {
        importSupported: true,
        nativeRoundtrip: 'none',
      },
      bitDepth: {
        status: 'native-high-bit-supported',
        sourceBitsPerChannel: 16,
        editorBitsPerChannel: 16,
        browserDecodedTo: 'native u16/f32 PixelBuffer authority',
        preservesHighBitDepth: true,
      },
    });
    expect(description.warningCodes).toContain('tiff-format-limits');
    expect(description.warnings).toEqual([]);
  });

  it('publishes stable source policy signatures for RAW, PSB, SVG, TIFF, and GIF handoff planning', () => {
    const raw = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'capture.cr3',
      mimeType: 'image/x-canon-cr3',
    }));
    const psb = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'large.psb',
    }));
    const svg = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'logo.svg',
      mimeType: 'image/svg+xml',
    }));
    const tiff = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'scan.tif',
      mimeType: 'image/tiff',
    }));
    const gif = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'loop.gif',
      bytes: new Uint8Array([71, 73, 70, 56, 57, 97, 0, 0, 0, 0, 0, 0, 0, 0x2c, 0, 0x2c]),
    }));

    expect(raw.policySignature).toBe('source-format:v1|format=Camera Raw|ext=cr3|mime=image/x-canon-cr3|import=unsupported|export=unsupported|bitDepth=camera-raw|warnings=camera-raw-import-unsupported');
    expect(raw.importPolicy).toMatchObject({
      status: 'unsupported',
      requiresExternalProcessor: true,
      canOpenAsPixels: false,
      recommendedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
    });
    expect(psb.policySignature).toContain('format=PSB');
    expect(psb.importPolicy.status).toBe('unsupported');
    expect(psb.warnings.join(' ')).toMatch(/large-document|large document|PSB/i);

    expect(svg.policySignature).toContain('warnings=svg-rasterized-import,svg-flattened-export');
    expect(svg.importPolicy).toMatchObject({
      status: 'rasterized',
      vectorStatePreserved: false,
      canOpenAsPixels: true,
    });
    expect(tiff.importPolicy.limitations.join(' ')).toMatch(/BigTIFF|compressed|8-bit/i);
    expect(gif.importPolicy).toMatchObject({
      status: 'first-frame-only',
      animationPreserved: false,
      canOpenAsPixels: true,
    });
  });

  it('publishes typed readiness descriptors for RAW develop-first and TIFF/GIF/SVG interop limits', () => {
    const raw = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'capture.nef',
      mimeType: 'image/x-nikon-nef',
    }));
    const tiff = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'scan.tif',
      mimeType: 'image/tiff',
    }));
    const gif = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'loop.gif',
      bytes: new Uint8Array([71, 73, 70, 56, 57, 97, 0, 0, 0, 0, 0, 0, 0, 0x2c, 0, 0x2c]),
    }));
    const svg = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'logo.svg',
      mimeType: 'image/svg+xml',
    }));

    expect(raw.readiness).toMatchObject({
      status: 'handoff-required',
      importAction: 'develop-first',
      exportAction: 'unsupported',
      userSummary: 'Camera Raw requires external RAW development before Image can edit pixels.',
    });
    expect(raw.readiness.roundTripCaveats).toContain('RAW demosaic, camera profiles, and non-destructive RAW settings are not represented in Image documents.');
    expect(raw.compatibilityWarnings).toContainEqual({
      code: 'camera-raw-import-unsupported',
      category: 'raw-development',
      severity: 'warning',
      summary: 'Develop Camera Raw externally before opening in Image.',
    });

    expect(tiff.readiness).toMatchObject({
      status: 'limited',
      importAction: 'open-as-pixels',
      exportAction: 'flattened-raster',
      userSummary: 'TIFF opens for bounded classic uncompressed grayscale/RGB/RGBA data, including the supported native u16/f32 high-bit subset; other layouts refuse before lossy conversion.',
    });
    expect(tiff.compatibilityWarnings).toContainEqual({
      code: 'tiff-format-limits',
      category: 'layer-mask-effect-loss',
      severity: 'warning',
      summary: 'TIFF interoperability is flattened; native layer, mask, and effect structures are not round-tripped.',
    });

    expect(gif.readiness).toMatchObject({
      status: 'limited',
      importAction: 'first-frame-only',
      exportAction: 'flattened-raster',
      userSummary: 'Animated GIF opens as the first frame only; GIF export is flattened and static.',
    });
    expect(gif.compatibilityWarnings).toContainEqual({
      code: 'gif-animation-first-frame',
      category: 'animation-loss',
      severity: 'warning',
      summary: 'GIF animation frames and timing are not preserved in Image.',
    });

    expect(svg.readiness).toMatchObject({
      status: 'limited',
      importAction: 'rasterize',
      exportAction: 'flattened-raster',
      userSummary: 'SVG opens as rasterized pixels; export is a flattened raster snapshot, not editable vector artwork.',
    });
    expect(svg.compatibilityWarnings).toContainEqual({
      code: 'svg-rasterized-import',
      category: 'vector-rasterized',
      severity: 'warning',
      summary: 'SVG vector objects are rasterized on import.',
    });
    expect(svg.roundTripCaveats.join(' ')).toMatch(/vector.*raster/i);
  });

  it('publishes explicit edit-state loss warnings and workflow-safe fallback routes for layered and limited image interop', () => {
    const psd = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'layout.psd',
      mimeType: 'image/vnd.adobe.photoshop',
    })) as ReturnType<typeof describeSourceImageFormatPolicy> & {
      editStateLoss?: {
        layers: string;
        text: string;
        effects: string;
        sourceLinks: string;
      };
      importPolicy: ReturnType<typeof describeSourceImageFormatPolicy>['importPolicy'] & {
        recommendedFallbackRoutes?: Array<{
          route: string;
          label: string;
          recommendedFor: string;
          caveat: string;
        }>;
      };
    };
    const raw = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'capture.cr3',
      mimeType: 'image/x-canon-cr3',
    })) as typeof psd;
    const psb = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'campaign.psb',
    })) as typeof psd;
    const xcf = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'poster.xcf',
      mimeType: 'image/x-gimp-xcf',
    })) as typeof psd;
    const tiff = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'scan.tif',
      mimeType: 'image/tiff',
    })) as typeof psd;
    const gif = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'loop.gif',
      bytes: new Uint8Array([71, 73, 70, 56, 57, 97, 0, 0, 0, 0, 0, 0, 0, 0x2c, 0, 0x2c]),
    })) as typeof psd;
    const svg = describeSourceImageFormatPolicy(detectSourceImageFormatPolicy({
      fileName: 'mark.svg',
      mimeType: 'image/svg+xml',
    })) as typeof psd;

    expect(psd.editStateLoss).toMatchObject({
      layers: expect.stringMatching(/layers?/i),
      text: expect.stringMatching(/metadata|flatten/i),
      effects: expect.stringMatching(/flatten/i),
      sourceLinks: expect.stringMatching(/source-?link|smart object/i),
    });
    expect(psd.importPolicy.recommendedFallbackRoutes?.map((route) => route.route)).toEqual([
      'psd-signal-loom-metadata',
      'source-library-package',
      'tiff-visible-composite',
      'png-visible-composite',
    ]);
    expect(psd.importPolicy.recommendedFallbackRoutes?.[0]).toMatchObject({
      recommendedFor: expect.stringMatching(/working master|signal loom/i),
      caveat: expect.stringMatching(/text|effects|source links?|metadata-only|flatten/i),
    });

    expect(raw.editStateLoss).toMatchObject({
      layers: expect.stringMatching(/developed raster|single image/i),
      sourceLinks: expect.stringMatching(/source library|provenance|original raw/i),
    });
    expect(raw.importPolicy.recommendedFallbackRoutes?.map((route) => route.route)).toEqual([
      'external-raw-development',
      'psd-developed-derivative',
      'tiff-developed-derivative',
      'source-library-original',
    ]);

    expect(psb.editStateLoss?.layers).toMatch(/convert/i);
    expect(psb.importPolicy.recommendedFallbackRoutes?.map((route) => route.route)).toEqual([
      'psd-conversion',
      'tiff-visible-composite',
      'png-jpeg-preview',
      'source-library-original',
    ]);

    expect(xcf.editStateLoss).toMatchObject({
      text: expect.stringMatching(/text/i),
      effects: expect.stringMatching(/effects/i),
      sourceLinks: expect.stringMatching(/source-?link/i),
    });
    expect(xcf.importPolicy).toMatchObject({
      status: 'supported',
      canOpenAsPixels: true,
    });

    expect(tiff.editStateLoss).toMatchObject({
      layers: expect.stringMatching(/flatten/i),
      text: expect.stringMatching(/flatten/i),
      effects: expect.stringMatching(/flatten/i),
    });
    expect(tiff.importPolicy.recommendedFallbackRoutes?.map((route) => route.route)).toEqual([
      'psd-layered-working-master',
      'tiff-visible-composite',
      'png-preview-handoff',
    ]);

    expect(gif.editStateLoss?.layers).toMatch(/single frame|flatten/i);
    expect(gif.importPolicy.recommendedFallbackRoutes?.map((route) => route.route)).toEqual([
      'video-animation-workflow',
      'png-single-frame',
      'tiff-single-frame',
    ]);

    expect(svg.editStateLoss).toMatchObject({
      text: expect.stringMatching(/raster/i),
      effects: expect.stringMatching(/filter|effect|raster/i),
      sourceLinks: expect.stringMatching(/source library|original svg/i),
    });
    expect(svg.importPolicy.recommendedFallbackRoutes?.map((route) => route.route)).toEqual([
      'source-library-original-svg',
      'png-visible-composite',
      'psd-raster-working-file',
    ]);
  });

  it('summarizes deterministic export readiness for TIFF, GIF, and SVG flattening limits', () => {
    const tiff = describeSourceImageFormatExportReadiness(detectSourceImageFormatPolicy({
      fileName: 'scan.tif',
      mimeType: 'image/tiff',
    }));
    const gif = describeSourceImageFormatExportReadiness(detectSourceImageFormatPolicy({
      fileName: 'loop.gif',
      bytes: new Uint8Array([71, 73, 70, 56, 57, 97, 0, 0, 0, 0, 0, 0, 0, 0x2c, 0, 0x2c]),
    }));
    const svg = describeSourceImageFormatExportReadiness(detectSourceImageFormatPolicy({
      fileName: 'logo.svg',
      mimeType: 'image/svg+xml',
    }));

    expect(tiff).toMatchObject({
      formatLabel: 'TIFF',
      layerPolicy: {
        importPreservesLayers: false,
        exportPreservesLayers: false,
        flattening: 'flattens-on-export',
      },
      colorProfilePolicy: {
        preservesEmbeddedProfiles: false,
      },
      bitDepthPolicy: {
        sourceBitsPerChannel: 'unknown',
        editorBitsPerChannel: 8,
      },
      warningCodes: ['tiff-format-limits'],
      recommendedHandoffFormats: [],
    });
    expect(tiff.layerPolicy.summary).toMatch(/flattened.*layer/i);
    expect(tiff.stableSignature).toBe('source-export-readiness:v1|format=TIFF|import=open-as-pixels|export=flattened-raster|layers=flattened|frames=none|bitDepth=unknown|warnings=tiff-format-limits');

    expect(gif).toMatchObject({
      formatLabel: 'Animated GIF',
      animationPolicy: {
        importFrameLimit: 1,
        exportFrameLimit: 1,
        preservesAnimation: false,
      },
      warningCodes: ['gif-animation-first-frame', 'gif-static-flattened-export'],
    });
    expect(gif.animationPolicy.summary).toMatch(/first frame.*single-frame/i);

    expect(svg).toMatchObject({
      formatLabel: 'SVG',
      layerPolicy: {
        importPreservesLayers: false,
        exportPreservesLayers: false,
      },
      vectorPolicy: {
        importPreservesVectorState: false,
        exportPreservesVectorState: false,
      },
      warningCodes: ['svg-rasterized-import', 'svg-flattened-export'],
    });
    expect(svg.vectorPolicy.summary).toMatch(/rasterized.*editable vector/i);
  });

  it('summarizes RAW develop-first and PSB conversion thresholds without claiming decoders', () => {
    const raw = describeSourceImageFormatExportReadiness(detectSourceImageFormatPolicy({
      fileName: 'capture.cr3',
      mimeType: 'image/x-canon-cr3',
    }));
    const psb = describeSourceImageFormatExportReadiness(detectSourceImageFormatPolicy({
      fileName: 'large.psb',
    }));
    const tiff16 = describeSourceImageFormatExportReadiness(detectSourceImageFormatPolicy({
      fileName: 'scan-16.tif',
      mimeType: 'image/tiff',
      bytes: rewriteTiffBitsPerSample(encodeImageDataToTiff(makeImageData(1, 1, [10, 20, 30, 255])), 16),
    }));

    expect(raw).toMatchObject({
      importAction: 'develop-first',
      exportAction: 'unsupported',
      rawPolicy: {
        requiresDevelopFirst: true,
        recommendedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
        recommendedConversionPath: [
          'Develop the RAW source in a dedicated RAW processor with demosaic, profile interpretation, and non-destructive edits.',
          'Export a fully developed derivative as 8-bit TIFF, PSD, PNG, JPEG before opening in Image.',
          'Open the exported file as a normal raster import target.',
        ],
        openAsPixelsBlockedReasons: [
          'Image has no RAW demosaic/development pipeline for camera sensor data.',
          'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
        ],
      },
      recommendedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
      warningCodes: ['camera-raw-import-unsupported'],
    });
    expect(raw.rawPolicy?.summary).toMatch(/RAW demosaic.*external/i);
    expect(raw.stableSignature).toBe('source-export-readiness:v1|format=Camera Raw|import=develop-first|export=unsupported|layers=flattened|frames=not-decoded|bitDepth=camera-raw|warnings=camera-raw-import-unsupported');

    expect(psb).toMatchObject({
      importAction: 'convert-first',
      exportAction: 'unsupported',
      psbPolicy: {
        unsupported: true,
        thresholds: ['PSD 30,000 px per side limit exceeded or PSB version 2 header detected', 'Large document workflows require conversion before Image import'],
        thresholdDescriptors: [
          {
            code: 'psd-max-dimension-exceeded',
            limit: '30,000 px per side',
            unsupported: true,
            summary: 'Documents beyond the PSD 30,000 px per side limit require PSB, which Image does not decode.',
          },
          {
            code: 'psb-header-version-2',
            limit: '8BPS version 2 header',
            unsupported: true,
            summary: 'PSB version 2 large-document headers are detected and blocked before ag-psd import.',
          },
        ],
        largeDocumentCaveats: [
          'Image has no tiled or streaming PSB decoder for large canvases.',
          'Native PSB round-trip is unsupported; convert to PSD within size limits or to a flattened 8-bit raster handoff.',
        ],
      },
      recommendedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
      warningCodes: ['psb-import-unsupported'],
      policyWarnings: [
        {
          descriptorId: 'source-format-warning:v1|format=PSB|code=psb-import-unsupported',
          code: 'psb-import-unsupported',
          summary: 'PSB large-document import/export is unsupported; convert to a supported handoff format before opening in Image.',
        },
      ],
    });
    expect(psb.psbPolicy?.summary).toMatch(/30,000|large-document|conversion/i);

    expect(tiff16).toMatchObject({
      importAction: 'open-as-pixels',
      bitDepthPolicy: {
        status: 'native-high-bit-supported',
        sourceBitsPerChannel: 16,
        preservesHighBitDepth: true,
      },
      warningCodes: ['tiff-format-limits'],
      recommendedHandoffFormats: [],
      policyWarnings: [
        {
          descriptorId: 'source-format-warning:v1|format=TIFF|code=tiff-format-limits',
          code: 'tiff-format-limits',
          summary: 'TIFF interoperability is flattened; native layer, mask, and effect structures are not round-tripped.',
        },
      ],
    });
    expect(tiff16.bitDepthPolicy.warning).toBeUndefined();
  });

  it('describes Photoshop PSD/PSB size blockers from headers without parsing native layers', () => {
    const normalPsd = describePhotoshopDocumentSizePolicy({
      bytes: makePhotoshopHeaderBytes({ version: 1, width: 12000, height: 8000 }),
      fileName: 'poster.psd',
      mimeType: 'image/vnd.adobe.photoshop',
    });
    const oversizedPsd = describePhotoshopDocumentSizePolicy({
      bytes: makePhotoshopHeaderBytes({ version: 1, width: 30001, height: 12000 }),
      fileName: 'wide.psd',
    });
    const psb = describePhotoshopDocumentSizePolicy({
      bytes: makePhotoshopHeaderBytes({ version: 2, width: 42000, height: 36000 }),
      fileName: 'huge.psb',
    });

    expect(normalPsd).toMatchObject({
      descriptorId: 'photoshop-document-size-policy:v1',
      kind: 'psd',
      width: 12000,
      height: 8000,
      psdMaxDimension: 30000,
      canAttemptLayeredPsdImport: true,
      requiresConversion: false,
      blockers: [],
      recommendedFallbackRoutes: [],
      stableSignature: 'photoshop-size-policy:v1|kind=psd|width=12000|height=8000|max=30000|blockers=none',
    });

    expect(oversizedPsd).toMatchObject({
      kind: 'psd',
      width: 30001,
      height: 12000,
      canAttemptLayeredPsdImport: false,
      requiresConversion: true,
      blockers: [
        {
          code: 'psd-max-dimension-exceeded',
          limit: '30,000 px per side',
          unsupported: true,
          summary: 'PSD header dimensions 30001 x 12000 exceed the 30,000 px PSD limit; convert to a supported derivative before Image import.',
        },
      ],
    });
    expect(oversizedPsd.recommendedFallbackRoutes.map((route) => route.route)).toEqual([
      'psd-conversion',
      'tiff-visible-composite',
      'png-jpeg-preview',
      'source-library-original',
    ]);
    expect(oversizedPsd.stableSignature).toBe('photoshop-size-policy:v1|kind=psd|width=30001|height=12000|max=30000|blockers=psd-max-dimension-exceeded');

    expect(psb).toMatchObject({
      kind: 'psb',
      canAttemptLayeredPsdImport: false,
      requiresConversion: true,
      blockers: [
        {
          code: 'psb-header-version-2',
          limit: '8BPS version 2 header',
          unsupported: true,
          summary: 'PSB version 2 large-document headers are blocked before ag-psd import.',
        },
        {
          code: 'psd-max-dimension-exceeded',
          limit: '30,000 px per side',
          unsupported: true,
          summary: 'PSD header dimensions 42000 x 36000 exceed the 30,000 px PSD limit; convert to a supported derivative before Image import.',
        },
      ],
      stableSignature: 'photoshop-size-policy:v1|kind=psb|width=42000|height=36000|max=30000|blockers=psb-header-version-2,psd-max-dimension-exceeded',
    });
  });

  it('describes Camera Raw develop-first handoff metadata with explicit conversion path and blocked open-as-pixels reasons', () => {
    const descriptor = describeCameraRawImportReadiness({
      fileName: 'Capture.NEF',
      sourceLabel: 'Capture.NEF',
      mimeType: 'image/x-nikon-nef',
    });
    const helper = describeCameraRawDevelopFirstMetadata({
      sourceLabel: 'Capture.NEF',
      sourceExtension: 'nef',
      sourceMimeType: 'image/x-nikon-nef',
    });

    expect(descriptor).toMatchObject({
      sourceLabel: 'Capture.NEF',
      sourceExtension: 'nef',
      sourceMimeType: 'image/x-nikon-nef',
      openAsPixelsBlockedReasons: [
        'Image has no RAW demosaic/development pipeline for camera sensor data.',
        'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
      ],
      openAsPixelsBlockers: [
        {
          code: 'raw-demosaic-missing',
          summary: 'Image has no RAW demosaic/development pipeline for camera sensor data.',
        },
        {
          code: 'camera-profile-controls-missing',
          summary: 'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
        },
      ],
      supportedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
    });
    expect(descriptor.policySignatures.blockers).toBe('camera-raw-blockers:v1|raw-demosaic-missing,camera-profile-controls-missing');
    expect(helper).toMatchObject({
      sourceLabel: 'Capture.NEF',
      sourceMimeType: 'image/x-nikon-nef',
      sourceExtension: 'nef',
      supportedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
      recommendedConversionPath: [
        'Develop the RAW source in a dedicated RAW processor with demosaic, profile interpretation, and non-destructive edits.',
        'Export a fully developed derivative as 8-bit TIFF, PSD, PNG, JPEG before opening in Image.',
        'Open the exported file as a normal raster import target.',
      ],
      openAsPixelsBlockedReasons: [
        'Image has no RAW demosaic/development pipeline for camera sensor data.',
        'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
      ],
    });
  });

  it('exposes Camera Raw detection, unsupported blockers, and handoff policy signatures', () => {
    expect(isCameraRawExtension('Capture.CR3')).toBe(true);
    expect(isCameraRawExtension('.nef')).toBe(true);
    expect(isCameraRawExtension('grade-plate.png')).toBe(false);
    expect(isCameraRawMimeType('IMAGE/X-NIKON-NEF')).toBe(true);
    expect(isCameraRawMimeType('image/png')).toBe(false);

    const descriptor = describeCameraRawImportReadiness({
      fileName: 'Capture.CR3',
      mimeType: 'image/x-canon-cr3',
    });

    expect(descriptor).toEqual({
      descriptorId: 'camera-raw-import-readiness:v1',
      detected: true,
      sourceLabel: 'Capture.CR3',
      sourceExtension: 'cr3',
      sourceMimeType: 'image/x-canon-cr3',
      openAsPixelsBlockedReasons: [
        'Image has no RAW demosaic/development pipeline for camera sensor data.',
        'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
      ],
      openAsPixelsBlockers: [
        {
          code: 'raw-demosaic-missing',
          summary: 'Image has no RAW demosaic/development pipeline for camera sensor data.',
        },
        {
          code: 'camera-profile-controls-missing',
          summary: 'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
        },
      ],
      supportedExtensions: expect.arrayContaining(['cr3', 'dng', 'nef']),
      supportedMimeTypes: expect.arrayContaining(['image/x-canon-cr3', 'image/x-nikon-nef']),
      supportedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
      externalDevelopmentRequired: true,
      unsupportedImportBlockers: [
        {
          code: 'raw-demosaic-missing',
          summary: 'Image has no RAW demosaic/development pipeline for camera sensor data.',
        },
        {
          code: 'camera-profile-controls-missing',
          summary: 'Camera profile, white balance, lens correction, and non-destructive develop controls must be handled externally.',
        },
      ],
      roundtripRisk: {
        level: 'unsupported',
        summary: 'Camera Raw cannot round-trip as an editable source document in Image.',
        caveats: [
          'RAW demosaic, camera profiles, and non-destructive RAW settings are not represented in Image documents.',
          'Developed pixels can continue through Image only after export to 8-bit TIFF, PSD, PNG, or JPEG.',
        ],
      },
      suiteHandoffCaveats: [
        'Flow, Video, and Paper handoff should receive the developed raster or PSD derivative, not the original RAW payload.',
        'Keep the original RAW as a Source Library reference if provenance matters; Image edits will not update it.',
      ],
      policySignatures: {
        detection: 'camera-raw-detection:v1|ext=cr3|mime=image/x-canon-cr3|detected=true',
        handoff: 'camera-raw-handoff:v1|formats=8-bit TIFF,PSD,PNG,JPEG|external=true',
        blockers: 'camera-raw-blockers:v1|raw-demosaic-missing,camera-profile-controls-missing',
      },
    });
  });

  it('builds deterministic Camera Raw open-policy descriptors with fallback recommendations', () => {
    const raw = describeCameraRawOpenPolicy({
      fileName: 'Capture.CR3?download=1',
      mimeType: 'IMAGE/X-CANON-CR3',
      sourceLabel: '  Wedding capture.CR3  ',
    });
    const nonRaw = describeCameraRawOpenPolicy({
      fileName: 'plate.png',
      mimeType: 'image/png',
    });

    expect(raw).toMatchObject({
      descriptorId: 'camera-raw-open-policy:v1',
      detected: true,
      sourceLabel: 'Wedding capture.CR3',
      sourceExtension: 'cr3',
      sourceMimeType: 'image/x-canon-cr3',
      openPolicy: 'develop-first',
      canOpenAsPixels: false,
      externalDevelopmentRequired: true,
      developFirst: {
        sourceLabel: 'Wedding capture.CR3',
        sourceExtension: 'cr3',
        sourceMimeType: 'image/x-canon-cr3',
        supportedHandoffFormats: ['8-bit TIFF', 'PSD', 'PNG', 'JPEG'],
      },
      recommendedFallbackRoutes: [
        {
          route: 'external-raw-development',
          label: 'Develop in RAW processor',
          preserves: 'demosaic, camera profile, lens correction, and non-destructive RAW controls',
          recommendedFor: 'Primary develop master before any Image editing.',
          caveat: 'Image cannot open RAW sensor data directly; only the developed derivative continues into Image.',
        },
        {
          route: 'psd-developed-derivative',
          label: 'PSD developed derivative',
          preserves: 'developed pixels plus room for layered Image edits after import',
          recommendedFor: 'Continue compositing after external RAW development.',
          caveat: 'RAW development yields a single developed raster derivative; layered Image work begins only after export to PSD, TIFF, PNG, or JPEG.',
        },
        {
          route: 'tiff-developed-derivative',
          label: 'TIFF developed derivative',
          preserves: 'developed raster pixels for print-oriented handoff',
          recommendedFor: 'Bake the develop result for raster finishing or print exchange.',
          caveat: 'Keep the RAW separately; TIFF does not preserve RAW develop controls, source links, or layered edit state.',
        },
        {
          route: 'source-library-original',
          label: 'Keep original RAW in Source Library',
          preserves: 'the untouched camera original for provenance and re-development',
          recommendedFor: 'Reference and archive alongside developed derivatives.',
          caveat: 'Keep the original RAW in the Source Library for provenance; Image edits apply only to the developed derivative.',
        },
      ],
      unsupportedStates: [
        {
          code: 'native-raw-open',
          message: 'Native Camera Raw files cannot be opened as editable Image pixels without external development.',
        },
        {
          code: 'raw-demosaic',
          message: 'RAW demosaic is unsupported in the Image workspace.',
        },
        {
          code: 'raw-camera-profile-controls',
          message: 'Camera profile, white balance, lens correction, and sensor color controls are unsupported in Image.',
        },
        {
          code: 'raw-non-destructive-develop',
          message: 'Non-destructive RAW develop settings are not stored or round-tripped by Image documents.',
        },
      ],
    });
    expect(raw.stableSignature).toBe('camera-raw-open-policy:v1|ext=cr3|mime=image/x-canon-cr3|detected=true|policy=develop-first|unsupported=native-raw-open,raw-demosaic,raw-camera-profile-controls,raw-non-destructive-develop');

    expect(nonRaw).toMatchObject({
      detected: false,
      sourceLabel: 'plate.png',
      sourceExtension: 'png',
      sourceMimeType: 'image/png',
      openPolicy: 'open-as-pixels',
      canOpenAsPixels: true,
      externalDevelopmentRequired: false,
      recommendedFallbackRoutes: [],
      unsupportedStates: [],
    });
    expect(nonRaw.stableSignature).toBe('camera-raw-open-policy:v1|ext=png|mime=image/png|detected=false|policy=open-as-pixels|unsupported=none');
  });

  it('publishes typed file-open readiness descriptors with route ranking and stable policy signatures', () => {
    const raw = describeSourceImageFileOpenReadiness(detectSourceImageFormatPolicy({
      fileName: 'capture.dng',
      mimeType: 'image/x-adobe-dng',
    }));
    const psd = describeSourceImageFileOpenReadiness(detectSourceImageFormatPolicy({
      fileName: 'layout.psd',
      mimeType: 'image/vnd.adobe.photoshop',
    }));
    const psb = describeSourceImageFileOpenReadiness(detectSourceImageFormatPolicy({
      fileName: 'huge.psb',
    }));
    const xcf = describeSourceImageFileOpenReadiness(detectSourceImageFormatPolicy({
      fileName: 'paint.xcf',
      mimeType: 'image/x-gimp-xcf',
    }));
    const png = describeSourceImageFileOpenReadiness(detectSourceImageFormatPolicy({
      fileName: 'plate.png',
      mimeType: 'image/png',
    }));

    expect(raw).toMatchObject({
      descriptorId: 'source-image-file-open-readiness:v1',
      formatLabel: 'Camera Raw',
      roundtripRisk: {
        riskId: 'roundtrip-risk:camera-raw:unsupported:v1',
        level: 'unsupported',
        stableId: 'roundtrip-risk:camera-raw:unsupported:v1',
      },
      signatures: {
        importPolicy: 'import-policy:v1|format=Camera Raw|status=unsupported|action=develop-first|canOpen=false|external=true',
        fallbackRouteRanking: 'fallback-ranking:v1|format=Camera Raw|routes=1:external-raw-development,2:open-as-pixels,3:psd-developed-derivative,4:tiff-developed-derivative,5:source-library-original',
        nativeConstructWarnings: 'native-constructs:v1|format=Camera Raw|warnings=native-raw-demosaic,raw-camera-profile-controls,raw-non-destructive-develop,icc-managed-open-transform',
        roundtripRisk: 'roundtrip-risk:camera-raw:unsupported:v1',
      },
    });
    expect(raw.openRoutes.map((route) => `${route.rank}:${route.route}:${route.supported}`)).toEqual([
      '1:external-raw-development:true',
      '2:open-as-pixels:false',
      '3:psd-developed-derivative:true',
      '4:tiff-developed-derivative:true',
      '5:source-library-original:true',
    ]);
    expect(raw.openRoutes[1].unsupportedStateCodes).toEqual(['native-raw-demosaic']);
    expect(raw.unsupportedStates.map((state) => state.code)).toEqual([
      'native-raw-demosaic',
      'raw-camera-profile-controls',
      'raw-non-destructive-develop',
      'icc-managed-open-transform',
    ]);
    expect(raw.unsupportedStates.find((state) => state.code === 'icc-managed-open-transform')).toMatchObject({
      category: 'color-management',
      blocksOpenAsPixels: false,
    });
    expect(raw.rawDevelopFirst?.supportedHandoffFormats).toEqual(['8-bit TIFF', 'PSD', 'PNG', 'JPEG']);

    expect(psd.openRoutes.map((route) => `${route.rank}:${route.route}:${route.supported}`)).toEqual([
      '1:open-layered-psd:true',
      '2:psd-signal-loom-metadata:true',
      '3:source-library-package:true',
      '4:tiff-visible-composite:true',
      '5:png-visible-composite:true',
    ]);
    expect(psd.nativeConstructWarnings.map((warning) => warning.code)).toEqual([
      'full-psd-native-constructs',
      'icc-managed-open-transform',
    ]);
    expect(psd.roundtripRisk.riskId).toBe('roundtrip-risk:psd:metadata-only:v1');

    expect(psb.openRoutes.map((route) => `${route.rank}:${route.route}:${route.supported}`)).toEqual([
      '1:psd-conversion:true',
      '2:tiff-visible-composite:true',
      '3:png-jpeg-preview:true',
      '4:source-library-original:true',
      '5:open-as-psb:false',
    ]);
    expect(psb.unsupportedStates.map((state) => state.code)).toEqual([
      'native-psb-decode',
      'full-psb-native-constructs',
      'icc-managed-open-transform',
    ]);
    expect(psb.roundtripRisk.riskId).toBe('roundtrip-risk:psb:unsupported:v1');

    expect(xcf.openRoutes.map((route) => `${route.rank}:${route.route}:${route.supported}`)).toEqual([
      '1:open-as-pixels:true',
      '2:full-xcf-native-constructs:false',
    ]);
    expect(xcf.unsupportedStates.map((state) => state.code)).toContain('full-xcf-native-constructs');
    expect(xcf.roundtripRisk.riskId).toBe('roundtrip-risk:xcf:unsupported:v1');

    expect(png).toMatchObject({
      formatLabel: 'PNG',
      openRoutes: [
        {
          route: 'open-as-pixels',
          rank: 1,
          supported: true,
          openAction: 'open-as-pixels',
        },
      ],
      unsupportedStates: [
        {
          code: 'icc-managed-open-transform',
          blocksOpenAsPixels: false,
        },
      ],
      roundtripRisk: {
        riskId: 'roundtrip-risk:png:none:v1',
        level: 'none',
      },
    });
    expect(png.signatures.sourcePolicy).toBe(png.sourcePolicySignature);
  });

  it('rasterizes SVG into a document while retaining original SVG source metadata', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" /></svg>';
    const doc = await createSvgImageDocument(svg, {
      id: 'doc-svg',
      title: 'Icon',
      sourceBinItemId: 'source-svg',
      sourceLabel: 'Icon.svg',
      sourceMimeType: 'image/svg+xml',
    });

    expect(doc.width).toBe(32);
    expect(doc.height).toBe(16);
    expect(doc.metadata).toMatchObject({ sourceFormat: 'SVG', sourceMimeType: 'image/svg+xml' });
    expect(doc.layers[0].bitmap).toMatchObject({ width: 32, height: 16 } satisfies Partial<LayerBitmap>);
    expect(doc.layers[0].metadata).toMatchObject({
      sourceFormat: 'SVG',
      originalSvgSource: svg,
      smartLinkedSourceId: 'source-svg',
    });
  });
});

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function makePngHeader(options: { bitDepth: number; colorType: number }): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, 1);
  view.setUint32(20, 1);
  bytes[24] = options.bitDepth;
  bytes[25] = options.colorType;
  return bytes;
}

function rewriteTiffBitsPerSample(bytes: Uint8Array, bitsPerSample: number): Uint8Array {
  const output = new Uint8Array(bytes);
  const view = new DataView(output.buffer);
  const littleEndian = output[0] === 0x49;
  const ifdOffset = view.getUint32(4, littleEndian);
  const tagCount = view.getUint16(ifdOffset, littleEndian);

  for (let index = 0; index < tagCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    if (view.getUint16(entryOffset, littleEndian) !== 258) continue;
    const valueCount = view.getUint32(entryOffset + 4, littleEndian);
    const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
    for (let valueIndex = 0; valueIndex < valueCount; valueIndex += 1) {
      view.setUint16(valueOffset + valueIndex * 2, bitsPerSample, littleEndian);
    }
  }

  return output;
}

function makePhotoshopHeaderBytes(options: { version: 1 | 2; width: number; height: number }): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set([0x38, 0x42, 0x50, 0x53]);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, options.version, false);
  view.setUint16(12, 4, false);
  view.setUint32(14, options.height, false);
  view.setUint32(18, options.width, false);
  view.setUint16(22, 8, false);
  view.setUint16(24, 3, false);
  return bytes;
}
