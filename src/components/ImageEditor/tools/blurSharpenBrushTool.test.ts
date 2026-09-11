import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_RETOUCH_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  type ImageDocument,
  type ImageLayer,
  type LayerBitmap,
  type RetouchToolSettings,
} from '../../../types/imageEditor';
import type { ToolEnv } from './types';
import { blurBrushFinishingReadinessSignature, blurBrushReadinessDescriptor, blurBrushTool } from './blurBrushTool';
import { sharpenBrushFinishingReadinessSignature, sharpenBrushReadinessDescriptor, sharpenBrushTool } from './sharpenBrushTool';
import { smudgeBrushFinishingReadinessSignature, smudgeBrushReadinessDescriptor, smudgeBrushTool } from './smudgeBrushTool';

const mods = { shift: false, alt: false, ctrl: false, meta: false };

class FakeCanvasContext {
  readonly imageData: ImageData;
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  getImageData() {
    return {
      width: this.width,
      height: this.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.imageData.data.set(imageData.data);
  }

  drawImage(source: FakeOffscreenCanvas, dx: number, dy: number) {
    const sourceData = source.context.imageData.data;
    for (let sy = 0; sy < source.height; sy += 1) {
      for (let sx = 0; sx < source.width; sx += 1) {
        const targetX = sx + dx;
        const targetY = sy + dy;
        if (targetX < 0 || targetY < 0 || targetX >= this.width || targetY >= this.height) continue;
        const sourceOffset = (sy * source.width + sx) * 4;
        const targetOffset = (targetY * this.width + targetX) * 4;
        this.blendPixel(targetOffset, [
          sourceData[sourceOffset] ?? 0,
          sourceData[sourceOffset + 1] ?? 0,
          sourceData[sourceOffset + 2] ?? 0,
          sourceData[sourceOffset + 3] ?? 0,
        ]);
      }
    }
  }

  save() {}
  restore() {}

  private blendPixel(offset: number, source: [number, number, number, number]) {
    const sourceAlpha = (source[3] / 255) * this.globalAlpha;
    const targetAlpha = (this.imageData.data[offset + 3] ?? 0) / 255;
    const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
    if (outputAlpha <= 0) return;

    const targetWeight = targetAlpha * (1 - sourceAlpha);
    this.imageData.data[offset] = Math.round((source[0] * sourceAlpha + (this.imageData.data[offset] ?? 0) * targetWeight) / outputAlpha);
    this.imageData.data[offset + 1] = Math.round((source[1] * sourceAlpha + (this.imageData.data[offset + 1] ?? 0) * targetWeight) / outputAlpha);
    this.imageData.data[offset + 2] = Math.round((source[2] * sourceAlpha + (this.imageData.data[offset + 2] ?? 0) * targetWeight) / outputAlpha);
    this.imageData.data[offset + 3] = Math.round(outputAlpha * 255);
  }
}

class FakeOffscreenCanvas {
  readonly context: FakeCanvasContext;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeCanvasContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function pointerEvent(): PointerEvent {
  return {
    pointerType: 'mouse',
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
  } as PointerEvent;
}

function setPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const offset = (y * bitmap.width + x) * 4;
  (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data.set(rgba, offset);
}

function getPixel(bitmap: LayerBitmap, x: number, y: number): [number, number, number, number] {
  const offset = (y * bitmap.width + x) * 4;
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0, data[offset + 3] ?? 0];
}

function makeLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
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
    bitmap: new OffscreenCanvas(5, 1) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeDoc(layers: ImageLayer[], activeLayerId: string): ImageDocument {
  return {
    id: 'doc-blur-sharpen',
    title: 'Blur Sharpen',
    width: 5,
    height: 1,
    layers,
    activeLayerId,
    activeLayerEditTarget: 'layer',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function makeEnv(doc: ImageDocument, activeLayer: ImageLayer, retouchToolSettings: RetouchToolSettings, brushSize = 1): ToolEnv {
  return {
    doc,
    activeLayer,
    brushSettings: { ...DEFAULT_BRUSH_SETTINGS, size: brushSize, opacity: 1 },
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    retouchToolSettings,
    selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS },
    screenToDoc: (point) => point,
    docToScreen: (point) => point,
    pushOperation: vi.fn(),
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store: {
      bumpLayerBitmapVersion: vi.fn(),
      markDocumentDirty: vi.fn(),
    } as unknown as ToolEnv['store'],
  };
}

describe('blur and sharpen brush retouch sampling', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('blur samples visible lower layers when sample mode is all layers', () => {
    const lower = makeLayer({ id: 'lower', name: 'Lower' });
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(lower.bitmap!, 1, 0, [200, 20, 40, 255]);
    setPixel(lower.bitmap!, 2, 0, [200, 20, 40, 255]);
    setPixel(lower.bitmap!, 3, 0, [200, 20, 40, 255]);
    setPixel(active.bitmap!, 2, 0, [0, 0, 0, 0]);
    const doc = makeDoc([lower, active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'allLayers' });

    blurBrushTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    blurBrushTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 0)).toEqual([200, 20, 40, 255]);
  });

  it('requests a fresh render after committing a blur stroke so renderer caches see the bitmap version change', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(active.bitmap!, 1, 0, [255, 0, 0, 255]);
    setPixel(active.bitmap!, 2, 0, [0, 0, 255, 255]);
    setPixel(active.bitmap!, 3, 0, [255, 0, 0, 255]);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' }, 3);

    blurBrushTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    blurBrushTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, active.id);
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('retargets blur strokes to the visible bitmap layer under the cursor when the active layer has no pixels', () => {
    const raster = makeLayer({ id: 'raster', name: 'Raster' });
    const activeVector = makeLayer({
      id: 'vector',
      name: 'Vector',
      type: 'vector',
      bitmap: undefined,
    });
    setPixel(raster.bitmap!, 1, 0, [255, 0, 0, 255]);
    setPixel(raster.bitmap!, 2, 0, [0, 0, 255, 255]);
    setPixel(raster.bitmap!, 3, 0, [255, 0, 0, 255]);
    const doc = makeDoc([raster, activeVector], activeVector.id);
    const env = makeEnv(doc, activeVector, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' }, 3);

    blurBrushTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    blurBrushTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(getPixel(raster.bitmap!, 2, 0)).not.toEqual([0, 0, 255, 255]);
    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, raster.id);
  });

  it('invalidates renderer bitmap caches for live blur and sharpen dab previews', () => {
    const blurLayer = makeLayer({ id: 'blur-active', name: 'Blur Active' });
    setPixel(blurLayer.bitmap!, 1, 0, [255, 0, 0, 255]);
    setPixel(blurLayer.bitmap!, 2, 0, [0, 0, 255, 255]);
    setPixel(blurLayer.bitmap!, 3, 0, [255, 0, 0, 255]);
    const blurDoc = makeDoc([blurLayer], blurLayer.id);
    const blurEnv = makeEnv(blurDoc, blurLayer, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' }, 3);

    blurBrushTool.onPointerDown?.(blurEnv, { x: 2, y: 0 }, mods, pointerEvent());

    expect(blurEnv.requestRender).toHaveBeenLastCalledWith({ invalidateBitmapCache: true });

    const sharpenLayer = makeLayer({ id: 'sharpen-active', name: 'Sharpen Active' });
    setPixel(sharpenLayer.bitmap!, 1, 0, [60, 60, 60, 255]);
    setPixel(sharpenLayer.bitmap!, 2, 0, [100, 100, 100, 255]);
    setPixel(sharpenLayer.bitmap!, 3, 0, [60, 60, 60, 255]);
    const sharpenDoc = makeDoc([sharpenLayer], sharpenLayer.id);
    const sharpenEnv = makeEnv(sharpenDoc, sharpenLayer, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' });

    sharpenBrushTool.onPointerDown?.(sharpenEnv, { x: 2, y: 0 }, mods, pointerEvent());

    expect(sharpenEnv.requestRender).toHaveBeenLastCalledWith({ invalidateBitmapCache: true });
  });

  it('sharpen samples visible lower layers when sample mode is current and below', () => {
    const lower = makeLayer({ id: 'lower', name: 'Lower' });
    const active = makeLayer({ id: 'active', name: 'Active', opacity: 0 });
    setPixel(lower.bitmap!, 1, 0, [60, 60, 60, 255]);
    setPixel(lower.bitmap!, 2, 0, [60, 60, 60, 255]);
    setPixel(lower.bitmap!, 3, 0, [60, 60, 60, 255]);
    setPixel(active.bitmap!, 2, 0, [100, 100, 100, 255]);
    const doc = makeDoc([lower, active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentAndBelow' });

    sharpenBrushTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    sharpenBrushTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 0)).toEqual([140, 140, 140, 255]);
  });

  it('requests a fresh render after committing a sharpen stroke so renderer caches see the bitmap version change', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(active.bitmap!, 1, 0, [60, 60, 60, 255]);
    setPixel(active.bitmap!, 2, 0, [100, 100, 100, 255]);
    setPixel(active.bitmap!, 3, 0, [60, 60, 60, 255]);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' });

    sharpenBrushTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    sharpenBrushTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, active.id);
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('restores blurred preview pixels when a stroke is canceled before commit', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    const originalCenter: [number, number, number, number] = [0, 0, 255, 255];
    setPixel(active.bitmap!, 1, 0, [255, 0, 0, 255]);
    setPixel(active.bitmap!, 2, 0, originalCenter);
    setPixel(active.bitmap!, 3, 0, [255, 0, 0, 255]);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' }, 3);

    blurBrushTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 0)).not.toEqual(originalCenter);

    blurBrushTool.onCancel?.(env);

    expect(getPixel(active.bitmap!, 2, 0)).toEqual(originalCenter);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('restores sharpened preview pixels when a stroke is canceled before commit', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    const originalCenter: [number, number, number, number] = [100, 100, 100, 255];
    setPixel(active.bitmap!, 1, 0, [60, 60, 60, 255]);
    setPixel(active.bitmap!, 2, 0, originalCenter);
    setPixel(active.bitmap!, 3, 0, [60, 60, 60, 255]);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' });

    sharpenBrushTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 0)).not.toEqual(originalCenter);

    sharpenBrushTool.onCancel?.(env);

    expect(getPixel(active.bitmap!, 2, 0)).toEqual(originalCenter);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('publishes blur and sharpen readiness descriptors for sampled brush actions', () => {
    expect(blurBrushReadinessDescriptor).toMatchObject({
      descriptorId: 'image-retouch-tool-readiness:v1',
      tool: 'blur',
      readiness: 'ready',
      implemented: expect.arrayContaining(['current-and-below-composite-sampling', 'all-layers-composite-sampling']),
      routeSafety: {
        activeTarget: 'layer',
        canPaint: true,
        blockers: [],
      },
      brushInput: {
        supportsPointer: true,
        supportsPressure: false,
        controls: ['size', 'strength', 'sampleMode'],
      },
      sourceSampling: {
        requested: 'currentLayer',
        coordinateSpace: 'layer',
        source: 'active-layer-snapshot-at-stroke-start',
        requiresExplicitSamplePoint: false,
      },
      batchActions: {
        suitable: false,
        requiresRecordedPointerPath: true,
        requiresRecordedSamplePoint: false,
      },
    });

    expect(sharpenBrushReadinessDescriptor).toMatchObject({
      descriptorId: 'image-retouch-tool-readiness:v1',
      tool: 'sharpen',
      readiness: 'ready',
      unsupported: expect.arrayContaining([
        'editable-non-destructive-retouch-layer',
        'single-channel-retouch-routing',
      ]),
      sourceSampling: {
        requested: 'currentLayer',
        source: 'active-layer-snapshot-at-stroke-start',
      },
      layerMaskChannelCaveats: [
        'Layer masks can constrain visible output, but retouch strokes are written to active layer pixels.',
        'Alpha and spot-channel retouch edits are unsupported; convert/load channel selections before painting RGB pixels.',
      ],
    });
  });

  it('smudge samples visible lower layers when composite sample mode is requested', () => {
    const lower = makeLayer({ id: 'lower', name: 'Lower' });
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(lower.bitmap!, 1, 0, [12, 180, 90, 255]);
    setPixel(active.bitmap!, 1, 0, [0, 0, 0, 0]);
    setPixel(active.bitmap!, 2, 0, [0, 0, 0, 0]);
    const doc = makeDoc([lower, active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'allLayers' });

    smudgeBrushTool.onPointerDown?.(env, { x: 1, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerMove?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 0)).toEqual([12, 180, 90, 255]);
    expect(env.pushOperation).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'paint',
      layerId: active.id,
    }));
  });

  it('retargets smudge strokes to the visible bitmap layer under the cursor when the active layer has no pixels', () => {
    const raster = makeLayer({ id: 'raster', name: 'Raster' });
    const activeVector = makeLayer({
      id: 'vector',
      name: 'Vector',
      type: 'vector',
      bitmap: undefined,
    });
    setPixel(raster.bitmap!, 1, 0, [255, 0, 0, 255]);
    setPixel(raster.bitmap!, 2, 0, [0, 0, 255, 255]);
    const doc = makeDoc([raster, activeVector], activeVector.id);
    const env = makeEnv(doc, activeVector, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' });

    smudgeBrushTool.onPointerDown?.(env, { x: 1, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerMove?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(getPixel(raster.bitmap!, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, raster.id);
  });

  it('smudge samples the stroke-start composite snapshot (no per-dab live resample) for bounded performance', () => {
    const lower = makeLayer({ id: 'lower', name: 'Lower' });
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(lower.bitmap!, 1, 0, [18, 144, 220, 255]);
    setPixel(active.bitmap!, 1, 0, [0, 0, 0, 0]);
    setPixel(active.bitmap!, 2, 0, [0, 0, 0, 0]);
    setPixel(active.bitmap!, 3, 0, [0, 0, 0, 0]);
    const doc = makeDoc([lower, active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'allLayers' });

    smudgeBrushTool.onPointerDown?.(env, { x: 1, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerMove?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerMove?.(env, { x: 3, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerUp?.(env, { x: 3, y: 0 }, mods, pointerEvent());

    // x=2 pulls in the lower-layer colour that was under the drag origin (x=1) at stroke start.
    expect(getPixel(active.bitmap!, 2, 0)).toEqual([18, 144, 220, 255]);
    // x=3 samples the *original* snapshot at x=2 (transparent), NOT the freshly-smeared colour:
    // the engine freezes the stroke-start sample source so it never re-reads the whole canvas per dab.
    expect(getPixel(active.bitmap!, 3, 0)).toEqual([0, 0, 0, 0]);
    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, active.id);
  });

  it('requests a fresh render after committing a smudge stroke so renderer caches see the bitmap version change', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(active.bitmap!, 1, 0, [255, 0, 0, 255]);
    setPixel(active.bitmap!, 2, 0, [0, 0, 255, 255]);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' });

    smudgeBrushTool.onPointerDown?.(env, { x: 1, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerMove?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, active.id);
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('reports the touched region for a bounded live smudge drag preview (dirty-rect, not a full recomposite)', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(active.bitmap!, 1, 0, [255, 0, 0, 255]);
    setPixel(active.bitmap!, 2, 0, [0, 0, 255, 255]);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' });
    const markDirty = vi.fn();
    env.markDirty = markDirty;

    smudgeBrushTool.onPointerDown?.(env, { x: 1, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerMove?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    // The live preview reports a dirty rect (bounding the recomposite) and requests a plain render —
    // no per-move full bitmap-cache invalidation, which forced a full-document worker render.
    expect(markDirty).toHaveBeenCalled();
    expect(env.requestRender).toHaveBeenLastCalledWith();
  });

  it('restores smudged preview pixels when a stroke is canceled before commit', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    const sourcePixel: [number, number, number, number] = [255, 0, 0, 255];
    const targetPixel: [number, number, number, number] = [0, 0, 255, 255];
    setPixel(active.bitmap!, 1, 0, sourcePixel);
    setPixel(active.bitmap!, 2, 0, targetPixel);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' });

    smudgeBrushTool.onPointerDown?.(env, { x: 1, y: 0 }, mods, pointerEvent());
    smudgeBrushTool.onPointerMove?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 0)).toEqual(sourcePixel);

    smudgeBrushTool.onCancel?.(env);

    expect(getPixel(active.bitmap!, 2, 0)).toEqual(targetPixel);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('publishes shared readiness signatures for local finishing brushes', () => {
    expect(blurBrushFinishingReadinessSignature).toBe(
      'image-retouch-action-readiness:v1:{"tool":"blur","sampleMode":"currentLayer","aligned":true,"output":"activeLayer","recordable":true,"requiresSamplePoint":false}',
    );
    expect(sharpenBrushFinishingReadinessSignature).toBe(
      'image-retouch-action-readiness:v1:{"tool":"sharpen","sampleMode":"currentLayer","aligned":true,"output":"activeLayer","recordable":true,"requiresSamplePoint":false}',
    );
    expect(smudgeBrushFinishingReadinessSignature).toBe(
      'image-retouch-action-readiness:v1:{"tool":"smudge","sampleMode":"currentLayer","output":"activeLayer","recordable":true,"requiresSamplePoint":false,"compositeSampling":"bounded"}',
    );
    expect(smudgeBrushReadinessDescriptor).toMatchObject({
      descriptorId: 'image-smudge-brush-readiness:v1',
      tool: 'smudge',
      readiness: 'ready',
      compositeSampling: {
        supported: true,
        supportedModes: ['currentLayer', 'currentAndBelow', 'allLayers'],
        bounded: true,
        source: 'previous-stroke-point-current-layer',
      },
      routeSafety: {
        activeTarget: 'layer',
        canPaint: true,
        blockers: [],
      },
    });
  });
});
