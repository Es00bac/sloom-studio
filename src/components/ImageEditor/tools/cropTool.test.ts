import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import {
  buildCropPreviewRect,
  buildCroppedImageDocumentState,
  buildCropToolCommitPlanDescriptor,
  clearCropPreview,
  clearPerspectiveCropPreview,
  cropTool,
  getCropPreview,
  getPerspectiveCropPreview,
  getPerspectiveCropRefusal,
  reconcileCropPreviewMode,
  seedPerspectiveCropQuadFromDocument,
  setPerspectiveCropQuad,
  summarizeCropPreviewGeometry,
  resolveCropPreviewAspectRatio,
  describeCropToolReadiness,
} from './cropTool';
import type { PerspectiveCropQuad } from './perspectiveCropSession';
import type { ToolEnv } from './types';
import { deserializeSlimg, serializeSlimg, type SlimgCodec } from '../ImageSlimgFormat';
import { createPixelBuffer } from '../pixels/PixelBuffer';
import { createImageCmykPixelBuffer } from '../cmyk/ImageCmykDocument';

class FakeOffscreenCanvas {
  width: number;
  height: number;
  drawImage = vi.fn();
  private readonly pixels: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext(_kind?: string) {
    return {
      drawImage: this.drawImage.mockImplementation((source: FakeOffscreenCanvas, dx = 0, dy = 0) => {
        if (!(source instanceof FakeOffscreenCanvas)) return;
        for (let y = 0; y < source.height; y += 1) {
          for (let x = 0; x < source.width; x += 1) {
            const targetX = x + Math.round(dx);
            const targetY = y + Math.round(dy);
            if (targetX < 0 || targetY < 0 || targetX >= this.width || targetY >= this.height) continue;
            const from = (y * source.width + x) * 4;
            const to = (targetY * this.width + targetX) * 4;
            this.pixels.set(source.pixels.slice(from, from + 4), to);
          }
        }
      }),
      getImageData: () => ({ width: this.width, height: this.height, data: new Uint8ClampedArray(this.pixels) }) as ImageData,
      putImageData: (imageData: ImageData, _dx = 0, _dy = 0) => this.pixels.set(imageData.data),
    };
  }
}

function fakeBitmap(width: number, height: number): LayerBitmap {
  const drawImage = vi.fn();
  return {
    width,
    height,
    getContext: vi.fn(() => ({ drawImage })),
  } as unknown as LayerBitmap;
}

function layer(patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 10,
    y: 20,
    bitmap: fakeBitmap(200, 120),
    bitmapVersion: 2,
    mask: fakeBitmap(200, 120),
    ...patch,
  };
}

function doc(layers: ImageLayer[]): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Doc',
    width: 300,
    height: 200,
    layers,
    activeLayerId: layers[0]?.id ?? null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    snapshots: [],
  };
}

describe('cropTool', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('builds a fixed-aspect crop preview when a preset ratio is active', () => {
    const preview = buildCropPreviewRect({
      start: { x: 10, y: 20 },
      current: { x: 70, y: 50 },
      aspectRatio: 1,
    });

    expect(preview).toEqual({
      x: 10,
      y: 20,
      w: 60,
      h: 60,
    });
  });

  it('attaches crop rotation metadata to the preview rectangle', () => {
    const preview = buildCropPreviewRect({
      start: { x: 10, y: 20 },
      current: { x: 70, y: 50 },
      aspectRatio: null,
      rotationDeg: 12.5,
    });

    expect(preview).toEqual({
      x: 10,
      y: 20,
      w: 60,
      h: 30,
      rotationDeg: 12.5,
    });
  });

  it('resolves the original crop preset from the current document dimensions', () => {
    const aspectRatio = resolveCropPreviewAspectRatio(doc([layer()]), 'original');

    expect(aspectRatio).toBe(1.5);
  });

  it('builds a cropped document state without losing active layer identity', () => {
    const original = layer();
    const result = buildCroppedImageDocumentState(doc([original]), {
      x: 25.2,
      y: 30.7,
      w: 80.4,
      h: 40.1,
    }, { deleteCroppedPixels: true });

    expect(result?.width).toBe(80);
    expect(result?.height).toBe(40);
    expect(result?.activeLayerId).toBe('layer-1');
    expect(result?.layers).toHaveLength(1);
    expect(result?.layers[0]).toMatchObject({
      id: 'layer-1',
      x: 0,
      y: 0,
      bitmapVersion: 3,
      mask: null,
    });
    expect(result?.layers[0].bitmap?.width).toBe(80);
    expect(result?.layers[0].bitmap?.height).toBe(40);
  });

  it('crops native u16 authority and matching u8 mask on destructive crop', () => {
    const pixels = createPixelBuffer({ width: 200, height: 120, depth: 'u16' });
    (pixels.data as Uint16Array).fill(1001);
    const original = layer({ pixels, pixelsVersion: 2 });
    const result = buildCroppedImageDocumentState({ ...doc([original]), metadata: { bitDepth: 16 } }, {
      x: 25, y: 30, w: 80, h: 40,
    }, { deleteCroppedPixels: true });
    expect(result?.layers[0]?.pixels).toMatchObject({ width: 80, height: 40, depth: 'u16' });
    expect(result?.layers[0]?.pixelsVersion).toBe(3);
    expect(result?.layers[0]?.mask).toMatchObject({ width: 80, height: 40 });
  });

  it('refuses a native-CMYK rectangular crop commit before history or proxy dimensions can change', () => {
    const authority = createImageCmykPixelBuffer(200, 120, new Uint8Array(200 * 120 * 5).fill(31));
    const source = {
      ...doc([layer({ cmykPixels: authority })]),
      metadata: {
        colorMode: 'cmyk' as const,
        cmyk: {
          profileId: 'fogra39',
          profileLabel: 'FOGRA39',
          profileSource: { kind: 'bundled' as const, id: 'fogra39' },
          intent: 'relative' as const,
          blackPointCompensation: true,
          paperWhiteSimulation: false,
        },
      },
    };
    const pushOperation = vi.fn();
    const setLayers = vi.fn();
    const setDocumentDimensions = vi.fn();
    const requestRender = vi.fn();
    const env = {
      doc: source,
      activeLayer: source.layers[0] ?? null,
      brushSettings: {} as ToolEnv['brushSettings'],
      cropToolSettings: {
        aspectPreset: 'free' as const,
        guideMode: 'thirds' as const,
        deleteCroppedPixels: false,
        rotationDeg: 0,
        mode: 'rectangular' as const,
      },
      selectionToolSettings: {} as ToolEnv['selectionToolSettings'],
      screenToDoc: (point: { x: number; y: number }) => point,
      docToScreen: (point: { x: number; y: number }) => point,
      pushOperation,
      store: { setLayers, setDocumentDimensions } as unknown as ToolEnv['store'],
      requestRender,
      resolveSelectionMode: () => 'replace' as const,
    } satisfies ToolEnv;
    cropTool.onPointerDown?.(env, { x: 20, y: 30 }, noMods, pointerEvent);
    cropTool.onPointerMove?.(env, { x: 100, y: 70 }, noMods, pointerEvent);
    cropTool.onKeyDown?.(env, 'Enter', noMods, keyboardEvent);

    expect(pushOperation).not.toHaveBeenCalled();
    expect(setLayers).not.toHaveBeenCalled();
    expect(setDocumentDimensions).not.toHaveBeenCalled();
    expect(source.layers[0]?.cmykPixels).toBe(authority);
    clearCropPreview();
  });

  it('refuses rotated or content-aware high-bit crop before proxy mutation', () => {
    const pixels = createPixelBuffer({ width: 200, height: 120, depth: 'f32' });
    const original = layer({ pixels });
    const source = { ...doc([original]), metadata: { bitDepth: 32 as const } };
    const preview = { x: 25, y: 30, w: 80, h: 40, rotationDeg: 5 };
    expect(buildCroppedImageDocumentState(source, preview, { deleteCroppedPixels: true })).toBeNull();
    expect(buildCroppedImageDocumentState(source, { ...preview, rotationDeg: 0 }, {
      cornerFillMode: 'content-aware',
    })).toBeNull();
    expect(original.pixels).toBe(pixels);
    expect(pixels.data.some((value) => value !== 0)).toBe(false);
  });

  it('offsets non-bitmap layers instead of rasterizing them', () => {
    const textLayer = layer({
      id: 'text-1',
      type: 'text',
      bitmap: null,
      x: 64,
      y: 88,
    });
    const result = buildCroppedImageDocumentState(doc([textLayer]), {
      x: 12,
      y: 18,
      w: 50,
      h: 60,
    });

    expect(result?.layers[0]).toMatchObject({ id: 'text-1', x: 52, y: 70, bitmap: null });
  });

  it('preserves bitmap pixels and masks for non-destructive crop commits', () => {
    const originalBitmap = fakeBitmap(200, 120);
    const originalMask = fakeBitmap(200, 120);
    const original = layer({
      x: 40,
      y: 55,
      bitmap: originalBitmap,
      mask: originalMask,
      bitmapVersion: 7,
    });

    const result = buildCroppedImageDocumentState(doc([original]), {
      x: 25,
      y: 30,
      w: 80,
      h: 40,
    }, { deleteCroppedPixels: false });

    expect(result?.width).toBe(80);
    expect(result?.height).toBe(40);
    expect(result?.layers[0]).toMatchObject({
      id: 'layer-1',
      x: 15,
      y: 25,
      bitmapVersion: 7,
      bitmap: originalBitmap,
      mask: originalMask,
    });
  });

  it('keeps Tiltmark crop framing non-destructive and blocks destructive baking', () => {
    const surface = layer({
      metadata: {
        tiltmark: {
          schemaVersion: 1,
          role: 'surface',
          materialState: 'physical',
        },
      },
      tiltmarkSimulationData: 'checkpoint',
      tiltmarkBaseBitmap: fakeBitmap(200, 120),
    });
    const source = doc([surface]);
    const preview = { x: 25, y: 30, w: 80, h: 40 };

    const framed = buildCroppedImageDocumentState(source, preview, { deleteCroppedPixels: false });
    expect(framed?.layers[0]).toMatchObject({
      id: surface.id,
      x: surface.x - 25,
      y: surface.y - 30,
      tiltmarkSimulationData: 'checkpoint',
      tiltmarkBaseBitmap: surface.tiltmarkBaseBitmap,
    });
    expect(buildCroppedImageDocumentState(source, preview, { deleteCroppedPixels: true })).toBeNull();
    expect(buildCroppedImageDocumentState(source, preview, { cornerFillMode: 'content-aware' })).toBeNull();
  });

  it('rotates layer placement around the crop center for non-destructive straighten commits', () => {
    const originalBitmap = fakeBitmap(200, 120);
    const originalMask = fakeBitmap(200, 120);
    const original = layer({
      x: 40,
      y: 55,
      rotationDeg: 10,
      bitmap: originalBitmap,
      mask: originalMask,
      bitmapVersion: 7,
    });

    const result = buildCroppedImageDocumentState(doc([original]), {
      x: 25,
      y: 30,
      w: 80,
      h: 40,
      rotationDeg: 90,
    }, { deleteCroppedPixels: false, rotationDeg: 90 });

    expect(result?.width).toBe(80);
    expect(result?.height).toBe(40);
    expect(result?.layers[0]).toMatchObject({
      id: 'layer-1',
      x: 45,
      y: 45,
      rotationDeg: -80,
      bitmapVersion: 7,
      bitmap: originalBitmap,
      mask: originalMask,
    });
  });

  it('bakes destructive straighten crops into a new bitmap without preserving the old mask', () => {
    const original = layer({
      x: 40,
      y: 55,
      bitmapVersion: 7,
      mask: fakeBitmap(200, 120),
    });

    const result = buildCroppedImageDocumentState(doc([original]), {
      x: 25,
      y: 30,
      w: 80,
      h: 40,
      rotationDeg: 15,
    }, { deleteCroppedPixels: true, rotationDeg: 15 });

    expect(result?.width).toBe(80);
    expect(result?.height).toBe(40);
    expect(result?.layers[0]).toMatchObject({
      id: 'layer-1',
      x: 0,
      y: 0,
      bitmapVersion: 8,
      mask: null,
    });
    expect(result?.layers[0].bitmap?.width).toBe(80);
    expect(result?.layers[0].bitmap?.height).toBe(40);
  });

  it('bakes selected content-aware crop corner repair into the same cropped active-layer bitmap and .slimg reopen', async () => {
    const source = new FakeOffscreenCanvas(4, 4) as unknown as LayerBitmap;
    const sourcePixels = source.getContext('2d')?.getImageData(0, 0, 4, 4) as ImageData;
    sourcePixels.data.fill(255);
    sourcePixels.data[3] = 0;
    sourcePixels.data[(1 * 4 + 1) * 4 + 3] = 0;
    source.getContext('2d')?.putImageData(sourcePixels, 0, 0);
    const original = layer({ x: 0, y: 0, bitmap: source, mask: null });

    const result = buildCroppedImageDocumentState(doc([original]), {
      x: 0,
      y: 0,
      w: 4,
      h: 4,
      rotationDeg: 10,
    }, { deleteCroppedPixels: false, cornerFillMode: 'content-aware', rotationDeg: 10 });

    const repaired = result?.layers[0].bitmap?.getContext('2d')?.getImageData(0, 0, 4, 4) as ImageData;
    expect(result?.layers[0]).toMatchObject({ x: 0, y: 0, mask: null, bitmapVersion: 3 });
    expect(repaired.data[3]).toBe(255);
    expect(repaired.data[(1 * 4 + 1) * 4 + 3]).toBe(0);
    expect(source.getContext('2d')?.getImageData(0, 0, 4, 4).data[3]).toBe(0);

    const rawPixelCodec: SlimgCodec = {
      encode: async (bitmap) => new Uint8Array(bitmap.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data),
      decode: async (bytes, width, height) => {
        const bitmap = new FakeOffscreenCanvas(width, height);
        bitmap.getContext('2d')!.putImageData({ width, height, data: new Uint8ClampedArray(bytes) } as ImageData);
        return bitmap as unknown as LayerBitmap;
      },
    };
    const croppedDoc = {
      ...doc([original]),
      width: result!.width,
      height: result!.height,
      layers: result!.layers,
      activeLayerId: result!.activeLayerId,
    };
    const reopened = await deserializeSlimg(await serializeSlimg(croppedDoc, rawPixelCodec), rawPixelCodec);
    const reopenedPixels = reopened.layers[0].bitmap!.getContext('2d')!.getImageData(0, 0, 4, 4) as ImageData;
    expect(reopenedPixels.data[3]).toBe(255);
    expect(reopenedPixels.data[(1 * 4 + 1) * 4 + 3]).toBe(0);
  });

  it('summarizes crop preview aspect, composition guide, and rotation metadata', () => {
    const summary = summarizeCropPreviewGeometry({
      doc: doc([layer()]),
      preview: { x: 12.25, y: 8.75, w: 160, h: 90, rotationDeg: -7.25 },
      settings: {
        aspectPreset: '16:9',
        guideMode: 'thirds',
        deleteCroppedPixels: false,
        rotationDeg: 0,
        mode: 'rectangular',
      },
    });

    expect(summary).toEqual({
      signature: 'crop-preview|12.25,8.75,160x90|rotate=-7.25|aspect=16:9|guide=thirds',
      boundsLabel: '12.25,8.75 160x90',
      aspect: { preset: '16:9', ratio: 1.777778, locked: true },
      guides: { mode: 'thirds', verticalLines: 2, horizontalLines: 2, label: 'Rule of thirds' },
      straighten: { rotationDeg: -7.25, applied: true, direction: 'counterclockwise' },
    });
  });

  it('describes crop rectangle, apply/cancel, presets, guides, straighten, and non-destructive readiness', () => {
    const readiness = describeCropToolReadiness({
      doc: doc([layer()]),
      preview: { x: 12.25, y: 8.75, w: 160, h: 90, rotationDeg: -7.25 },
      settings: {
        aspectPreset: '16:9',
        guideMode: 'thirds',
        deleteCroppedPixels: false,
        rotationDeg: 0,
        mode: 'rectangular',
      },
      printDpi: 320,
    });

    expect(readiness.status).toBe('ready');
    expect(readiness.workingState).toEqual({
      hasPreview: true,
      phase: 'preview-ready',
      sourceDimensions: { width: 300, height: 200 },
    });
    expect(readiness.cropRectangle).toEqual({
      status: 'ready',
      boundsLabel: '12.25,8.75 160x90',
      width: 160,
      height: 90,
      canApply: true,
    });
    expect(readiness.applyCancel).toEqual({
      apply: 'supported-enter-key',
      cancel: 'supported-escape-key',
      previewPersistence: 'temporary-until-apply',
      previewBehavior: 'live-overlay-no-document-mutation',
    });
    expect(readiness.aspectPresets.supported).toEqual(['free', 'original', '1:1', '4:3', '3:2', '4:5', '16:9']);
    expect(readiness.aspectPresets.active).toEqual({ preset: '16:9', ratio: 1.777778, locked: true });
    expect(readiness.guideOverlays).toEqual({ mode: 'thirds', verticalLines: 2, horizontalLines: 2, label: 'Rule of thirds' });
    expect(readiness.straighten).toEqual({ status: 'ready', rotationDeg: -7.25, direction: 'counterclockwise' });
    expect(readiness.rotateCrop).toEqual({ status: 'ready', rotationDeg: -7.25 });
    expect(readiness.pixelRetention).toEqual({
      mode: 'non-destructive',
      deleteCroppedPixels: false,
      hiddenPixels: 'preserved-off-canvas',
      layerBitmapHandling: 'offset-retained-layer-content',
    });
    expect(readiness.fixedSizePrintGeometry).toEqual({
      dpi: 320,
      outputPixels: { width: 160, height: 90 },
      widthInches: 0.5,
      heightInches: 0.281,
      widthMm: 12.7,
      heightMm: 7.137,
      aspectLocked: true,
    });
    expect(readiness.sourceBinExportHandoff).toEqual({
      status: 'ready',
      sourceBinSafe: true,
      exportSafe: true,
      outputDimensions: { width: 160, height: 90 },
      caveats: ['Non-destructive crop handoff is safe for Source Bin/export, but flattened exports only include the visible crop bounds.'],
    });
    expect(readiness.batchActionSuitability).toEqual({
      actionRecording: 'recordable-fixed-preview',
      batchApply: 'suitable-with-fixed-rectangle',
      requiresPerDocumentValidation: true,
    });
    expect(readiness.previewSignatures).toEqual({
      geometry: 'crop-preview|12.25,8.75,160x90|rotate=-7.25|aspect=16:9|guide=thirds',
      readiness: 'crop-readiness|ready|rect=12.25,8.75,160x90|apply=true|mode=non-destructive|rotate=-7.25|aspect=16:9|guide=thirds|blockers=none',
    });
    expect(readiness.blockers).toEqual([]);
  });

  it('describes preset aspect constraints and non-destructive preview source/export safety', () => {
    const readiness = describeCropToolReadiness({
      doc: doc([layer()]),
      preview: { x: 20, y: 10, w: 120, h: 150 },
      settings: {
        aspectPreset: '4:5',
        guideMode: 'grid',
        deleteCroppedPixels: false,
        rotationDeg: 0,
        mode: 'rectangular',
      },
    });

    expect(readiness.aspectPresets.constraint).toEqual({
      preset: '4:5',
      requestedRatio: 0.8,
      previewRatio: 0.8,
      locked: true,
      satisfied: true,
      constrainedPreview: { width: 120, height: 150 },
    });
    expect(readiness.previewMetadata).toEqual({
      documentMutation: 'none-until-apply',
      previewLayerMutation: 'none-overlay-only',
      hiddenPixels: 'preserved-off-canvas',
      sourceSafety: 'source-layer-bitmaps-referenced-until-apply',
      exportSafety: 'flattened-export-uses-visible-crop-bounds',
    });
  });

  it('warns when crop output is handed to resize and canvas expansion descriptors', () => {
    const readiness = describeCropToolReadiness({
      doc: doc([layer()]),
      preview: { x: 0, y: 0, w: 120, h: 120 },
      settings: {
        aspectPreset: '1:1',
        guideMode: 'none',
        deleteCroppedPixels: false,
        rotationDeg: 0,
        mode: 'rectangular',
      },
      handoffResize: { width: 240, height: 120, resampleMethod: 'bicubic' },
      handoffCanvas: { width: 300, height: 200, anchor: 'center' },
    });

    expect(readiness.resizeCanvasHandoff).toEqual({
      cropOutputDimensions: { width: 120, height: 120 },
      resize: {
        status: 'will-resample-crop-output',
        targetDimensions: { width: 240, height: 120 },
        resampleMethod: 'bicubic',
        scale: { x: 2, y: 1 },
        warningCodes: ['handoff-resize-resamples-crop-output'],
      },
      canvas: {
        status: 'will-expand-canvas',
        targetDimensions: { width: 300, height: 200 },
        anchor: 'center',
        canvasOffset: { x: 30, y: 40 },
        transparentExpansion: { left: 30, top: 40, right: 30, bottom: 40 },
        warningCodes: ['handoff-canvas-adds-transparent-pixels'],
      },
      warnings: [
        {
          code: 'handoff-resize-resamples-crop-output',
          severity: 'warning',
          message: 'Crop output handoff will be resampled from 120x120 to 240x120 using bicubic.',
        },
        {
          code: 'handoff-canvas-adds-transparent-pixels',
          severity: 'warning',
          message: 'Canvas handoff expands 240x120 to 300x200 and adds transparent pixels on at least one edge.',
        },
      ],
      signature: 'crop-handoff|crop=120x120|resize=240x120:bicubic:will-resample-crop-output|canvas=300x200:center:expand=30,40,30,40|warnings=handoff-resize-resamples-crop-output,handoff-canvas-adds-transparent-pixels',
    });
  });

  it('reports destructive delete-cropped-pixels readiness and available crop capabilities deterministically', () => {
    const readiness = describeCropToolReadiness({
      doc: doc([layer()]),
      preview: { x: 0, y: 0, w: 120, h: 80 },
      settings: {
        aspectPreset: '4:3',
        guideMode: 'grid',
        deleteCroppedPixels: true,
        rotationDeg: 0,
        mode: 'rectangular',
      },
      requirePerspectiveCrop: true,
      requireContentAwareCornerFill: true,
      requirePresetManagement: true,
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.pixelRetention).toEqual({
      mode: 'destructive',
      deleteCroppedPixels: true,
      hiddenPixels: 'deleted-on-apply',
      layerBitmapHandling: 'bake-visible-crop-into-new-bitmaps',
    });
    expect(readiness.unsupportedStates).toEqual({
      perspectiveCrop: 'supported-destructive-flatten',
      contentAwareCornerFill: 'supported-destructive-active-layer',
      presetManagement: 'caveat-built-in-presets-only',
    });
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual([
      'custom-preset-management-unavailable',
    ]);
    expect(readiness.previewSignatures.readiness).toBe(
      'crop-readiness|blocked|rect=0,0,120x80|apply=true|mode=destructive|rotate=0|aspect=4:3|guide=grid|blockers=custom-preset-management-unavailable',
    );
  });

  it('describes crop handle ergonomics and keeps handle signatures stable', () => {
    const readiness = describeCropToolReadiness({
      doc: doc([layer()]),
      preview: { x: 10, y: 20, w: 100, h: 50, rotationDeg: -5 },
      settings: {
        aspectPreset: 'free',
        guideMode: 'thirds',
        deleteCroppedPixels: false,
        rotationDeg: 0,
        mode: 'rectangular',
      },
    });

    expect(readiness.handleReadiness).toEqual({
      status: 'ready',
      minHitTargetPx: 24,
      hitTargetPx: 28,
      visualHandlePx: 8,
      keyboardStepPx: 1,
      handles: [
        { id: 'nw', kind: 'corner-resize', documentPoint: { x: 10, y: 20 }, cursor: 'nwse-resize', hitTargetPx: 28, visualHandlePx: 8, ready: true },
        { id: 'n', kind: 'edge-resize', documentPoint: { x: 60, y: 20 }, cursor: 'ns-resize', hitTargetPx: 28, visualHandlePx: 8, ready: true },
        { id: 'ne', kind: 'corner-resize', documentPoint: { x: 110, y: 20 }, cursor: 'nesw-resize', hitTargetPx: 28, visualHandlePx: 8, ready: true },
        { id: 'e', kind: 'edge-resize', documentPoint: { x: 110, y: 45 }, cursor: 'ew-resize', hitTargetPx: 28, visualHandlePx: 8, ready: true },
        { id: 'se', kind: 'corner-resize', documentPoint: { x: 110, y: 70 }, cursor: 'nwse-resize', hitTargetPx: 28, visualHandlePx: 8, ready: true },
        { id: 's', kind: 'edge-resize', documentPoint: { x: 60, y: 70 }, cursor: 'ns-resize', hitTargetPx: 28, visualHandlePx: 8, ready: true },
        { id: 'sw', kind: 'corner-resize', documentPoint: { x: 10, y: 70 }, cursor: 'nesw-resize', hitTargetPx: 28, visualHandlePx: 8, ready: true },
        { id: 'w', kind: 'edge-resize', documentPoint: { x: 10, y: 45 }, cursor: 'ew-resize', hitTargetPx: 28, visualHandlePx: 8, ready: true },
        { id: 'rotate', kind: 'rotate-crop', documentPoint: { x: 60, y: -8 }, cursor: 'grab', hitTargetPx: 28, visualHandlePx: 8, ready: true },
      ],
      caveats: [
        'Handle descriptors are deterministic planning metadata; direct crop-box drag handles are rendered by the canvas overlay path.',
        'Perspective corner handles belong to the perspective-mode quad overlay, not these rectangular crop handles.',
      ],
      signature: 'crop-handles:v1|ready|rect=10,20,100x50|handles=nw:10,20|n:60,20|ne:110,20|e:110,45|se:110,70|s:60,70|sw:10,70|w:10,45|rotate:60,-8|hit=28|visual=8',
    });
  });

  it('adds typed crop descriptor checks for content-aware corners, presets, preview safety, and signatures', () => {
    const readiness = describeCropToolReadiness({
      doc: doc([layer()]),
      preview: { x: 0, y: 0, w: 120, h: 80 },
      settings: {
        aspectPreset: '4:3',
        guideMode: 'grid',
        deleteCroppedPixels: false,
        rotationDeg: 0,
        mode: 'rectangular',
      },
      requirePerspectiveCrop: true,
      requireContentAwareCornerFill: true,
      requirePresetManagement: true,
    });

    expect(readiness.descriptorChecks).toEqual({
      perspectiveCrop: {
        status: 'supported-destructive-flatten',
        supported: true,
        requested: true,
        entryPoints: 'crop-tool-perspective-mode',
        commit: 'single-undoable-doc-resize-operation',
        preview: 'live-quad-overlay-no-document-mutation',
        mutationPolicy: 'blocked-for-editable-tiltmark-surfaces-and-high-bit-documents',
        caveats: [
          'perspective-crop-flattens-the-document-into-one-raster-layer',
          'editable-tiltmark-surfaces-require-explicit-convert-to-raster',
          'high-bit-documents-refuse-before-mutation-until-native-perspective-crop-exists',
          'content-aware-corner-fill-repairs-only-active-raster-layer-transparent-pixels',
        ],
        signature: 'crop-check:v1:perspective-crop:supported-destructive-flatten:entry=crop-tool-perspective-mode:undo=single-doc-resize',
      },
      contentAwareCornerFill: {
        status: 'supported-destructive-active-layer',
        supported: true,
        requested: true,
        entryPoints: 'crop-panel-content-aware-corners',
        commit: 'single-undoable-doc-resize-operation',
        scope: 'active-raster-layer-transparent-pixels',
        mutationPolicy: 'baked-with-crop-commit',
        signature: 'crop-check:v1:content-aware-corner-fill:supported-destructive-active-layer:requested=true',
      },
      presetManagementCaveats: {
        status: 'limited-built-in-presets-only',
        builtInPresetCount: 7,
        customPresetManagement: false,
        importExport: false,
        caveats: [
          'custom-preset-create-rename-unavailable',
          'crop-preset-import-export-unavailable',
          'built-in-aspect-presets-are-deterministic',
        ],
        signature: 'crop-check:v1:preset-management:limited-built-in-presets-only:count=7:custom=false:import-export=false',
      },
      nonDestructivePreviewSafety: {
        status: 'safe-overlay-preview',
        documentMutation: 'none-until-apply',
        layerMutation: 'none-overlay-only',
        hiddenPixels: 'preserved-off-canvas',
        sourceLayerBitmaps: 'referenced-until-apply',
        flattenedExport: 'visible-crop-bounds-only',
        signature: 'crop-check:v1:non-destructive-preview:safe-overlay-preview:hidden=preserved-off-canvas:source=referenced-until-apply',
      },
      signature: 'crop-checks:v1|perspective=supported-destructive-flatten:requested|corner-fill=supported-destructive-active-layer:requested|presets=limited-built-in-presets-only|preview=safe-overlay-preview|mode=non-destructive',
    });
  });

  it('builds typed crop commit/source safety descriptors with stable signatures', () => {
    const plan = buildCropToolCommitPlanDescriptor({
      doc: doc([layer()]),
      preview: { x: 12.25, y: 8.75, w: 160, h: 90, rotationDeg: -7.25 },
      settings: {
        aspectPreset: '16:9',
        guideMode: 'thirds',
        deleteCroppedPixels: false,
        rotationDeg: 0,
        mode: 'rectangular',
      },
      requirePerspectiveCrop: true,
      requireContentAwareCornerFill: true,
    });

    expect(plan).toEqual({
      descriptorId: 'crop-tool-commit-plan:v1',
      planSignature: 'crop-tool-commit-plan:v1|non-destructive|rect=12.25,8.75,160x90|out=160x90|rotate=-7.25|aspect=16:9|guide=thirds|unsupported=none',
      sourceSignature: 'crop-tool-source-safety:v1|mode=non-destructive|hidden=preserved-off-canvas|source=referenced-until-apply|flattened=visible-crop-bounds-only',
      commit: {
        status: 'ready',
        mode: 'non-destructive',
        outputDimensions: { width: 160, height: 90 },
        documentMutation: 'apply-resizes-document',
        layerMutation: 'offset-retained-layer-content',
        undoModel: 'single-atomic-document-operation',
      },
      previewSession: {
        active: true,
        applyReady: true,
        cancelReady: true,
        applyCommand: 'Enter',
        cancelCommand: 'Escape',
        signature: 'crop-tool-preview-session:v1|active=true|apply=true|cancel=true|rect=12.25,8.75,160x90|rotate=-7.25',
      },
      sourceSafety: {
        hiddenPixels: 'preserved-off-canvas',
        sourceLayerBitmaps: 'referenced-until-apply',
        flattenedExport: 'visible-crop-bounds-only',
        destructiveCaveats: [],
        signature: 'crop-tool-source-safety:v1|mode=non-destructive|hidden=preserved-off-canvas|source=referenced-until-apply|flattened=visible-crop-bounds-only',
      },
      unsupported: [],
    });
  });

  it('blocks apply readiness when the crop rectangle is missing or invalid', () => {
    const readiness = describeCropToolReadiness({
      doc: doc([layer()]),
      preview: { x: 0, y: 0, w: 0, h: 80 },
      settings: {
        aspectPreset: 'free',
        guideMode: 'none',
        deleteCroppedPixels: false,
        rotationDeg: 0,
        mode: 'rectangular',
      },
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.cropRectangle).toEqual({
      status: 'blocked-invalid-rectangle',
      boundsLabel: 'none',
      width: 0,
      height: 0,
      canApply: false,
    });
    expect(readiness.applyCancel).toEqual({
      apply: 'blocked-invalid-rectangle',
      cancel: 'supported-escape-key',
      previewPersistence: 'temporary-until-apply',
      previewBehavior: 'unavailable',
    });
    expect(readiness.sourceBinExportHandoff).toMatchObject({
      status: 'blocked-invalid-crop',
      sourceBinSafe: false,
      exportSafe: false,
      outputDimensions: { width: 0, height: 0 },
    });
    expect(readiness.batchActionSuitability).toEqual({
      actionRecording: 'blocked-invalid-crop',
      batchApply: 'blocked-invalid-crop',
      requiresPerDocumentValidation: true,
    });
    expect(readiness.blockers).toEqual([
      {
        code: 'invalid-crop-rectangle',
        severity: 'error',
        operation: 'apply-crop',
        message: 'Crop apply requires a positive-width and positive-height rectangle.',
      },
    ]);
    expect(readiness.previewSignatures).toEqual({
      geometry: 'crop-preview|none',
      readiness: 'crop-readiness|blocked|rect=none|apply=false|mode=non-destructive|rotate=0|aspect=free|guide=none|blockers=invalid-crop-rectangle',
    });
  });
});

describe('cropTool — perspective mode interaction', () => {
  const baseSettings = {
    aspectPreset: 'free' as const,
    guideMode: 'thirds' as const,
    deleteCroppedPixels: false,
    rotationDeg: 0,
    mode: 'perspective' as const,
  };

  function perspectiveEnv(overrides: Partial<ToolEnv> = {}): ToolEnv {
    const requestRender = vi.fn();
    const store = {
      applyPerspectiveCrop: vi.fn(),
    };
    return {
      doc: doc([layer()]),
      activeLayer: null,
      brushSettings: {} as ToolEnv['brushSettings'],
      cropToolSettings: { ...baseSettings },
      selectionToolSettings: {} as ToolEnv['selectionToolSettings'],
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: vi.fn(),
      store: store as unknown as ToolEnv['store'],
      requestRender,
      resolveSelectionMode: () => 'replace',
      ...overrides,
    };
  }

  beforeEach(() => {
    clearCropPreview();
    clearPerspectiveCropPreview();
  });

  it('seeds a quad from a drag and keeps the rectangular preview idle', () => {
    const env = perspectiveEnv();
    cropTool.onPointerDown?.(env, { x: 10, y: 20 }, noMods, pointerEvent);
    cropTool.onPointerMove?.(env, { x: 110, y: 80 }, noMods, pointerEvent);
    cropTool.onPointerUp?.(env, { x: 110, y: 80 }, noMods, pointerEvent);

    const quad = getPerspectiveCropPreview();
    expect(quad).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 80 },
      { x: 10, y: 80 },
    ]);
    expect(getCropPreview(env.doc)).toBeNull();
  });

  it('drags an individual corner after the quad exists', () => {
    const env = perspectiveEnv();
    seedPerspectiveCropQuadFromDocument(env.doc);
    // Top-right corner at (300, 0); grab just inside it and drag outward.
    cropTool.onPointerDown?.(env, { x: 296, y: 3 }, noMods, pointerEvent);
    cropTool.onPointerMove?.(env, { x: 340, y: -12 }, noMods, pointerEvent);
    cropTool.onPointerUp?.(env, { x: 340, y: -12 }, noMods, pointerEvent);

    const quad = getPerspectiveCropPreview();
    expect(quad?.[1]).toEqual({ x: 340, y: -12 });
    expect(quad?.[0]).toEqual({ x: 0, y: 0 });
  });

  it('translates the whole quad when dragging inside it', () => {
    const env = perspectiveEnv();
    seedPerspectiveCropQuadFromDocument(env.doc);
    cropTool.onPointerDown?.(env, { x: 150, y: 100 }, noMods, pointerEvent);
    cropTool.onPointerMove?.(env, { x: 160, y: 90 }, noMods, pointerEvent);
    cropTool.onPointerUp?.(env, { x: 160, y: 90 }, noMods, pointerEvent);

    const quad = getPerspectiveCropPreview();
    expect(quad?.[0]).toEqual({ x: 10, y: -10 });
    expect(quad?.[2]).toEqual({ x: 310, y: 190 });
  });

  it('commits on Enter through the undoable store operation and clears the session', () => {
    const env = perspectiveEnv();
    seedPerspectiveCropQuadFromDocument(env.doc);
    cropTool.onKeyDown?.(env, 'Enter', noMods, keyboardEvent);

    expect(env.store.applyPerspectiveCrop).toHaveBeenCalledTimes(1);
    expect(env.store.applyPerspectiveCrop).toHaveBeenCalledWith(env.doc.id, [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 0, y: 200 },
    ]);
    expect(getPerspectiveCropPreview()).toBeNull();
  });

  it('does not apply a perspective session owned by another document', () => {
    const envA = perspectiveEnv();
    seedPerspectiveCropQuadFromDocument(envA.doc);
    const envB = perspectiveEnv({
      doc: { ...envA.doc, id: 'doc-2', width: 120, height: 90 },
    });

    cropTool.onKeyDown?.(envB, 'Enter', noMods, keyboardEvent);

    expect(envB.store.applyPerspectiveCrop).not.toHaveBeenCalled();
    expect(getPerspectiveCropPreview()).not.toBeNull();
  });

  it('cancels on Escape without touching the document', () => {
    const env = perspectiveEnv();
    seedPerspectiveCropQuadFromDocument(env.doc);
    cropTool.onKeyDown?.(env, 'Escape', noMods, keyboardEvent);

    expect(env.store.applyPerspectiveCrop).not.toHaveBeenCalled();
    expect(getPerspectiveCropPreview()).toBeNull();
  });

  it('Escape clears the inactive crop mode instead of leaving a stale session', () => {
    const rectangularEnv = perspectiveEnv({
      cropToolSettings: { ...baseSettings, mode: 'rectangular' },
    });
    cropTool.onPointerDown?.(rectangularEnv, { x: 10, y: 20 }, noMods, pointerEvent);
    cropTool.onPointerMove?.(rectangularEnv, { x: 60, y: 50 }, noMods, pointerEvent);
    expect(getCropPreview(rectangularEnv.doc)).not.toBeNull();

    const perspectiveEnvForEscape = {
      ...rectangularEnv,
      cropToolSettings: { ...baseSettings, mode: 'perspective' as const },
    };
    cropTool.onKeyDown?.(perspectiveEnvForEscape, 'Escape', noMods, keyboardEvent);
    expect(getCropPreview(rectangularEnv.doc)).toBeNull();

    seedPerspectiveCropQuadFromDocument(rectangularEnv.doc);
    cropTool.onKeyDown?.(rectangularEnv, 'Escape', noMods, keyboardEvent);
    expect(getPerspectiveCropPreview()).toBeNull();
  });

  it('mode switches cancel the opposite preview so both sessions cannot coexist', () => {
    const rectangularEnv = perspectiveEnv({
      cropToolSettings: { ...baseSettings, mode: 'rectangular' },
    });
    cropTool.onPointerDown?.(rectangularEnv, { x: 10, y: 20 }, noMods, pointerEvent);
    cropTool.onPointerMove?.(rectangularEnv, { x: 60, y: 50 }, noMods, pointerEvent);
    expect(getCropPreview(rectangularEnv.doc)).not.toBeNull();

    reconcileCropPreviewMode('perspective');
    expect(getCropPreview(rectangularEnv.doc)).toBeNull();

    seedPerspectiveCropQuadFromDocument(rectangularEnv.doc);
    expect(getPerspectiveCropPreview(rectangularEnv.doc)).not.toBeNull();
    reconcileCropPreviewMode('rectangular');
    expect(getPerspectiveCropPreview(rectangularEnv.doc)).toBeNull();
  });

  it('refuses to commit a degenerate quad', () => {
    const env = perspectiveEnv();
    setPerspectiveCropQuad([
      { x: 0, y: 0 },
      { x: 100, y: 60 },
      { x: 100, y: 0 },
      { x: 0, y: 60 },
    ], env.doc);
    cropTool.onKeyDown?.(env, 'Enter', noMods, keyboardEvent);

    expect(env.store.applyPerspectiveCrop).not.toHaveBeenCalled();
    expect(getPerspectiveCropPreview()).not.toBeNull();
  });

  it('records the Tiltmark refusal instead of silently no-oping', () => {
    const tiltmarkLayer = layer({
      type: 'image',
      metadata: { tiltmark: { schemaVersion: 1, role: 'surface' } },
    });
    const env = perspectiveEnv({ doc: doc([tiltmarkLayer]) });
    cropTool.onPointerDown?.(env, { x: 10, y: 10 }, noMods, pointerEvent);

    expect(getPerspectiveCropRefusal()).toBe('tiltmark-surface-requires-raster');
    cropTool.onKeyDown?.(env, 'Enter', noMods, keyboardEvent);
    expect(env.store.applyPerspectiveCrop).not.toHaveBeenCalled();
  });

  it('keeps rectangular mode untouched: drags seed the classic rect preview only', () => {
    const env = perspectiveEnv({
      cropToolSettings: { ...baseSettings, mode: 'rectangular' },
    });
    cropTool.onPointerDown?.(env, { x: 10, y: 20 }, noMods, pointerEvent);
    cropTool.onPointerMove?.(env, { x: 60, y: 50 }, noMods, pointerEvent);

    expect(getPerspectiveCropPreview()).toBeNull();
    expect(getCropPreview(env.doc)).toEqual({ x: 10, y: 20, w: 50, h: 30 });
  });

  it('exposes the quad to the panel through set/clear accessors', () => {
    const env = perspectiveEnv();
    const quad: PerspectiveCropQuad = [
      { x: 1, y: 2 },
      { x: 30, y: 2 },
      { x: 30, y: 40 },
      { x: 1, y: 40 },
    ];
    setPerspectiveCropQuad(quad, env.doc);
    expect(getPerspectiveCropPreview()).toEqual(quad);
    setPerspectiveCropQuad(null);
    expect(getPerspectiveCropPreview()).toBeNull();
  });
});

const noMods = { shift: false, alt: false, ctrl: false, meta: false };
const pointerEvent = {} as PointerEvent;
const keyboardEvent = {} as KeyboardEvent;
