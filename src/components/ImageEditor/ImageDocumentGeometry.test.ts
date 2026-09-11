import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import {
  buildImageDocumentCanvasSizeReadiness,
  buildStandaloneCropResizeReadiness,
  planImageCanvasResize,
  planImageDocumentPixelResize,
  resizeImageCanvas,
  resizeImageDocumentPixels,
  scaleImageDocumentToPercent,
} from './ImageDocumentGeometry';
import { createPixelBuffer } from './pixels/PixelBuffer';

class FakeContext {
  drawImageCalls: unknown[][] = [];

  drawImage(...args: unknown[]) {
    this.drawImageCalls.push(args);
  }

  save() {}
  restore() {}
  clearRect() {}
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

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
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
    x: 10,
    y: 5,
    bitmap: new OffscreenCanvas(20, 10) as LayerBitmap,
    bitmapVersion: 0,
    mask: new OffscreenCanvas(20, 10) as LayerBitmap,
    ...overrides,
  };
}

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Document',
    width: 100,
    height: 50,
    layers: [makeLayer()],
    activeLayerId: 'layer-1',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    ...overrides,
  };
}

describe('ImageDocumentGeometry', () => {
  beforeEach(() => {
    installCanvasStub();
  });

  it('resizes image pixels by scaling document dimensions, layer positions, bitmaps, and masks', () => {
    const next = resizeImageDocumentPixels(makeDoc(), 200, 100);
    const layer = next.layers[0];

    expect(next.width).toBe(200);
    expect(next.height).toBe(100);
    expect(next.dirty).toBe(true);
    expect(layer.x).toBe(20);
    expect(layer.y).toBe(10);
    expect(layer.bitmap?.width).toBe(40);
    expect(layer.bitmap?.height).toBe(20);
    expect(layer.mask?.width).toBe(40);
    expect(layer.mask?.height).toBe(20);
    expect(layer.bitmapVersion).toBe(1);

    const bitmapCanvas = layer.bitmap as unknown as FakeOffscreenCanvas;
    expect(bitmapCanvas.context.drawImageCalls.at(-1)).toEqual([
      expect.objectContaining({ width: 20, height: 10 }),
      0,
      0,
      40,
      20,
    ]);
  });

  it('resamples native u16 authority and keeps its shape aligned during image resize', () => {
    const pixels = createPixelBuffer({ width: 2, height: 2, depth: 'u16' });
    (pixels.data as Uint16Array).fill(1001);
    for (let index = 3; index < pixels.data.length; index += 4) (pixels.data as Uint16Array)[index] = 65535;
    const source = makeDoc({
      width: 2,
      height: 2,
      metadata: { bitDepth: 16 },
      layers: [makeLayer({ bitmap: new OffscreenCanvas(2, 2) as LayerBitmap, pixels, pixelsVersion: 4 })],
    });
    const next = resizeImageDocumentPixels(source, 4, 4);
    expect(next.layers[0]?.pixels).toMatchObject({ width: 4, height: 4, depth: 'u16' });
    expect(next.layers[0]?.pixelsVersion).toBe(5);
    expect((next.layers[0]?.pixels?.data as Uint16Array).length).toBe(4 * 4 * 4);
  });

  it('resizes the independent base of an empty Tiltmark surface', () => {
    const next = resizeImageDocumentPixels(makeDoc({
      layers: [makeLayer({
        metadata: {
          tiltmark: {
            schemaVersion: 1,
            role: 'surface',
            materialState: 'empty',
          },
        },
        tiltmarkBaseBitmap: new OffscreenCanvas(20, 10) as LayerBitmap,
      })],
    }), 200, 100);

    expect(next.layers[0].tiltmarkBaseBitmap).toMatchObject({ width: 40, height: 20 });
    expect(next.layers[0].bitmapVersion).toBe(1);
  });

  it('refuses to resample a physical Tiltmark surface without explicit raster conversion', () => {
    const source = makeDoc({
      layers: [makeLayer({
        metadata: {
          tiltmark: {
            schemaVersion: 1,
            role: 'surface',
            materialState: 'physical',
          },
        },
        tiltmarkSimulationData: 'checkpoint',
      })],
    });

    expect(resizeImageDocumentPixels(source, 200, 100)).toBe(source);
    expect(resizeImageCanvas(source, 140, 90, 'center')).not.toBe(source);
  });

  it('resizes the canvas without resampling pixels and offsets layers from the selected anchor', () => {
    const source = makeDoc();
    const next = resizeImageCanvas(source, 140, 90, 'center');
    const layer = next.layers[0];

    expect(next.width).toBe(140);
    expect(next.height).toBe(90);
    expect(layer.x).toBe(30);
    expect(layer.y).toBe(25);
    expect(layer.bitmap).toBe(source.layers[0].bitmap);
    expect(layer.mask).toBe(source.layers[0].mask);
    expect(layer.bitmapVersion).toBe(0);
    expect(next.dirty).toBe(true);
  });

  it('builds percent-based upscale dimensions with integer pixel bounds', () => {
    expect(scaleImageDocumentToPercent(makeDoc(), 200)).toMatchObject({
      width: 200,
      height: 100,
    });

    expect(scaleImageDocumentToPercent(makeDoc({ width: 333, height: 222 }), 150)).toMatchObject({
      width: 500,
      height: 333,
    });
  });

  it('plans pixel resize descriptors with print size metadata and lossy workflow warnings', () => {
    const plan = planImageDocumentPixelResize(
      makeDoc({ width: 1200, height: 900 }),
      600.2,
      300.4,
      { printDpi: 300, resampleMethod: 'bicubic', sourceBitDepth: 16 },
    );

    expect(plan).toMatchObject({
      kind: 'image-pixel-resize',
      sourceDimensions: { width: 1200, height: 900 },
      targetDimensions: { width: 600, height: 300 },
      anchor: 'center',
      resampleMethod: 'bicubic',
      print: {
        dpi: 300,
        widthInches: 2,
        heightInches: 1,
        widthMm: 50.8,
        heightMm: 25.4,
      },
      scale: { x: 0.5, y: 0.333333 },
    });
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      'destructive-pixel-resize',
      'unsupported-high-bit-depth-preservation',
    ]);
  });

  it('plans canvas resize descriptors with anchor offsets and transparent expansion warnings', () => {
    const plan = planImageCanvasResize(
      makeDoc({ width: 100, height: 50 }),
      140,
      80,
      'bottom-right',
      { printDpi: 200, sourceBitDepth: 32 },
    );

    expect(plan).toMatchObject({
      kind: 'canvas-resize',
      sourceDimensions: { width: 100, height: 50 },
      targetDimensions: { width: 140, height: 80 },
      anchor: 'bottom-right',
      resampleMethod: 'none',
      print: {
        dpi: 200,
        widthInches: 0.7,
        heightInches: 0.4,
        widthMm: 17.78,
        heightMm: 10.16,
      },
      scale: { x: 1, y: 1 },
      canvasOffset: { x: 40, y: 30 },
      transparentExpansion: { left: 40, top: 30, right: 0, bottom: 0 },
    });
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      'transparent-canvas-expansion',
      'unsupported-high-bit-depth-preservation',
    ]);
  });

  it('adds deterministic preview signatures to image and canvas resize descriptors', () => {
    const pixelPlan = planImageDocumentPixelResize(
      makeDoc({ width: 1600, height: 1200 }),
      800,
      600,
      { printDpi: 240, resampleMethod: 'lanczos3', sourceBitDepth: 16 },
    );
    const canvasPlan = planImageCanvasResize(
      makeDoc({ width: 1600, height: 1200 }),
      1800,
      1500,
      'top-left',
      { printDpi: 300 },
    );

    expect(pixelPlan.preview).toEqual({
      signature: 'image-pixel-resize|1600x1200>800x600|scale=0.5,0.5|resample=lanczos3|dpi=240|bit=16',
      summary: 'Image resize 1600x1200 -> 800x600 at 240 DPI using lanczos3 resampling',
    });
    expect(canvasPlan.preview).toEqual({
      signature: 'canvas-resize|1600x1200>1800x1500|anchor=top-left|offset=0,0|dpi=300|bit=8',
      summary: 'Canvas resize 1600x1200 -> 1800x1500 anchored top-left at 300 DPI',
    });
  });

  it('summarizes deterministic document canvas-size readiness for pixel and canvas resize planning', () => {
    const readiness = buildImageDocumentCanvasSizeReadiness(
      makeDoc({ width: 1200, height: 900 }),
      {
        printDpi: 300,
        sourceBitDepth: 8,
        imageResize: { width: 600, height: 450, resampleMethod: 'bicubic' },
        canvasResize: { width: 1600, height: 1200, anchor: 'bottom' },
      },
    );

    expect(readiness).toMatchObject({
      kind: 'image-document-canvas-size-readiness',
      sourceDimensions: { width: 1200, height: 900 },
      print: {
        dpi: 300,
        minimumDpi: 300,
        readyForPrintSize: true,
        sourcePrintSize: {
          dpi: 300,
          widthInches: 4,
          heightInches: 3,
          widthMm: 101.6,
          heightMm: 76.2,
        },
      },
      imageResize: {
        targetDimensions: { width: 600, height: 450 },
        resampleMethod: 'bicubic',
        destructiveResize: true,
        scale: { x: 0.5, y: 0.5 },
      },
      canvasResize: {
        targetDimensions: { width: 1600, height: 1200 },
        anchor: 'bottom',
        canvasOffset: { x: 200, y: 300 },
        transparentExpansion: { left: 200, top: 300, right: 200, bottom: 0 },
        expandsTransparentPixels: true,
      },
      unsupported: {
        states: [
          'native-resolution-metadata-editing',
          'non-square-pixel-aspect-ratio',
          'print-profile-aware-resampling',
        ],
        highBitDepthCaveat: false,
      },
    });
    expect(readiness.previewSignatures).toEqual({
      imageResize: 'image-pixel-resize|1200x900>600x450|scale=0.5,0.5|resample=bicubic|dpi=300|bit=8',
      canvasResize: 'canvas-resize|1200x900>1600x1200|anchor=bottom|offset=200,300|dpi=300|bit=8',
    });
    expect(readiness.warningCodes).toEqual([
      'destructive-pixel-resize',
      'transparent-canvas-expansion',
    ]);
    expect(readiness.signature).toBe('image-document-canvas-size-readiness:v1|source=1200x900|dpi=300/300|print=true|image=600x450:bicubic:destructive=true|canvas=1600x1200:bottom:offset=200,300:transparent=200,300,200,0|bit=8|warnings=destructive-pixel-resize,transparent-canvas-expansion|unsupported=native-resolution-metadata-editing,non-square-pixel-aspect-ratio,print-profile-aware-resampling');
    expect(buildImageDocumentCanvasSizeReadiness(makeDoc({ width: 1200, height: 900 }), {
      printDpi: 300,
      sourceBitDepth: 8,
      imageResize: { width: 600, height: 450, resampleMethod: 'bicubic' },
      canvasResize: { width: 1600, height: 1200, anchor: 'bottom' },
    })).toEqual(readiness);
  });

  it('reports no-op resize states, low-DPI print readiness, and high-bit-depth caveats', () => {
    const readiness = buildImageDocumentCanvasSizeReadiness(
      makeDoc({ width: 1000, height: 500 }),
      {
        printDpi: 150,
        minimumPrintDpi: 300,
        sourceBitDepth: 32,
        imageResize: { width: 1000, height: 500, resampleMethod: 'lanczos3' },
        canvasResize: { width: 1000, height: 500, anchor: 'center' },
      },
    );

    expect(readiness.print.readyForPrintSize).toBe(false);
    expect(readiness.imageResize).toMatchObject({
      destructiveResize: false,
      readiness: 'no-op',
    });
    expect(readiness.canvasResize).toMatchObject({
      expandsTransparentPixels: false,
      readiness: 'no-op',
      transparentExpansion: { left: 0, top: 0, right: 0, bottom: 0 },
    });
    expect(readiness.unsupported.highBitDepthCaveat).toBe(true);
    expect(readiness.warningCodes).toEqual(['unsupported-high-bit-depth-preservation']);
    expect(readiness.signature).toContain('print=false');
    expect(readiness.signature).toContain('bit=32');
  });

  it('reports native high-bit resampling without the stale 8-bit precision warning', () => {
    const readiness = buildImageDocumentCanvasSizeReadiness(
      makeDoc({
        width: 1000,
        height: 500,
        metadata: { bitDepth: 16, sourceBitDepth: 16 },
        layers: [makeLayer({ pixels: createPixelBuffer({ width: 1000, height: 500, depth: 'u16' }) })],
      }),
      {
        printDpi: 300,
        sourceBitDepth: 16,
        imageResize: { width: 500, height: 250, resampleMethod: 'bilinear' },
      },
    );

    expect(readiness.unsupported.highBitDepthCaveat).toBe(false);
    expect(readiness.unsupported.caveats.join(' ')).not.toContain('8-bit RGBA precision');
    expect(readiness.warningCodes).toEqual(['destructive-pixel-resize']);
    expect(readiness.imageResize.previewSummary).toContain('bilinear resampling');
  });

  it('summarizes standalone fixed crop and resize readiness for Source Bin/export handoff', () => {
    const readiness = buildStandaloneCropResizeReadiness(
      makeDoc({ width: 1200, height: 900 }),
      {
        printDpi: 300,
        crop: { x: 100, y: 80, width: 600, height: 400, deleteCroppedPixels: false },
        resize: { width: 300, height: 200, resampleMethod: 'bicubic' },
        requireSourceBinHandoff: true,
        requireExportHandoff: true,
      },
    );

    expect(readiness).toEqual({
      kind: 'standalone-crop-resize-readiness',
      status: 'ready',
      sourceDimensions: { width: 1200, height: 900 },
      crop: {
        status: 'ready',
        boundsLabel: '100,80 600x400',
        outputDimensions: { width: 600, height: 400 },
        destructive: false,
        preservesHiddenPixels: true,
      },
      resize: {
        status: 'ready',
        targetDimensions: { width: 300, height: 200 },
        resampleMethod: 'bicubic',
        destructive: true,
      },
      print: {
        dpi: 300,
        widthInches: 1,
        heightInches: 0.667,
        widthMm: 25.4,
        heightMm: 16.942,
      },
      sourceBinExportHandoff: {
        sourceBinSafe: true,
        exportSafe: true,
        handoffDimensions: { width: 300, height: 200 },
      },
      blockers: [],
      batchActionSuitability: {
        suitable: true,
        reason: 'fixed-crop-and-resize',
        requiresPerDocumentBoundsValidation: true,
      },
      signature: 'standalone-crop-resize-readiness:v1|status=ready|source=1200x900|crop=ready:600x400:destructive=false|resize=ready:300x200:bicubic|handoff=300x200|dpi=300|blockers=none',
    });
  });

  it('blocks standalone crop/export handoff when a requested crop is invalid', () => {
    const readiness = buildStandaloneCropResizeReadiness(
      makeDoc({ width: 1200, height: 900 }),
      {
        crop: { x: 0, y: 0, width: 0, height: 400, deleteCroppedPixels: true },
        requireSourceBinHandoff: true,
        requireExportHandoff: true,
      },
    );

    expect(readiness.status).toBe('blocked');
    expect(readiness.crop).toMatchObject({
      status: 'blocked-invalid-crop',
      boundsLabel: 'none',
      destructive: true,
      preservesHiddenPixels: false,
    });
    expect(readiness.sourceBinExportHandoff).toEqual({
      sourceBinSafe: false,
      exportSafe: false,
      handoffDimensions: { width: 1200, height: 900 },
    });
    expect(readiness.blockers).toEqual([
      'invalid-crop-rectangle',
      'source-bin-handoff-blocked',
      'export-handoff-blocked',
    ]);
    expect(readiness.batchActionSuitability).toEqual({
      suitable: false,
      reason: 'blocked',
      requiresPerDocumentBoundsValidation: true,
    });
  });

  it('blocks standalone crop handoff when crop geometry extends outside the source document', () => {
    const readiness = buildStandaloneCropResizeReadiness(
      makeDoc({ width: 1200, height: 900 }),
      {
        crop: { x: -40, y: 20, width: 600, height: 300, deleteCroppedPixels: false },
        requireSourceBinHandoff: true,
        requireExportHandoff: true,
      },
    );

    expect(readiness.status).toBe('blocked');
    expect(readiness.crop).toMatchObject({
      status: 'blocked-invalid-crop',
      boundsLabel: '-40,20 600x300',
      outputDimensions: { width: 600, height: 300 },
      destructive: false,
      preservesHiddenPixels: true,
    });
    expect(readiness.sourceBinExportHandoff).toEqual({
      sourceBinSafe: false,
      exportSafe: false,
      handoffDimensions: { width: 600, height: 300 },
    });
    expect(readiness.blockers).toEqual([
      'invalid-crop-rectangle',
      'source-bin-handoff-blocked',
      'export-handoff-blocked',
    ]);
    expect(readiness.signature).toContain('crop=blocked-invalid-crop:600x300:destructive=false');
  });
});
