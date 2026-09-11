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
import {
  cloneStampParityCheckDescriptor,
  cloneStampPreviewIdDescriptor,
  cloneStampReadinessDescriptor,
  cloneStampRouteSupportDescriptor,
  cloneStampTool,
  cloneStampWorkflowCapabilityDescriptor,
} from './cloneStampTool';

const mods = { shift: false, alt: false, ctrl: false, meta: false };
const altMods = { shift: false, alt: true, ctrl: false, meta: false };

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
    bitmap: new OffscreenCanvas(6, 1) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeEnv(doc: ImageDocument, activeLayer: ImageLayer, retouchToolSettings: RetouchToolSettings): ToolEnv {
  return {
    doc,
    activeLayer,
    brushSettings: { ...DEFAULT_BRUSH_SETTINGS, size: 1, opacity: 1 },
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

function makeDoc(layers: ImageLayer[], activeLayerId: string): ImageDocument {
  return {
    id: 'doc-clone',
    title: 'Clone',
    width: 6,
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

describe('cloneStampTool retouch sampling', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('samples visible lower layers when sample mode is all layers', () => {
    const lower = makeLayer({ id: 'lower', name: 'Lower' });
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(lower.bitmap!, 0, 0, [255, 0, 0, 255]);
    const doc = makeDoc([lower, active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'allLayers' });

    cloneStampTool.onPointerDown?.(env, { x: 0, y: 0 }, altMods, pointerEvent());
    cloneStampTool.onPointerDown?.(env, { x: 3, y: 0 }, mods, pointerEvent());
    cloneStampTool.onPointerUp?.(env, { x: 3, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 3, 0)).toEqual([255, 0, 0, 255]);
  });

  it('retargets clone strokes to a visible bitmap layer under the cursor when the active layer has no pixels', () => {
    const raster = makeLayer({ id: 'raster', name: 'Raster' });
    const activeVector = makeLayer({
      id: 'vector',
      name: 'Vector',
      type: 'vector',
      bitmap: undefined,
    });
    const sourcePixel: [number, number, number, number] = [255, 0, 0, 255];
    const targetPixel: [number, number, number, number] = [0, 0, 255, 255];
    setPixel(raster.bitmap!, 0, 0, sourcePixel);
    setPixel(raster.bitmap!, 3, 0, targetPixel);
    const doc = makeDoc([raster, activeVector], activeVector.id);
    const env = makeEnv(doc, activeVector, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'currentLayer' });

    cloneStampTool.onPointerDown?.(env, { x: 0, y: 0 }, altMods, pointerEvent());
    cloneStampTool.onPointerDown?.(env, { x: 3, y: 0 }, mods, pointerEvent());
    cloneStampTool.onPointerUp?.(env, { x: 3, y: 0 }, mods, pointerEvent());

    expect(getPixel(raster.bitmap!, 3, 0)).toEqual(sourcePixel);
    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, raster.id);
    expect(env.requestRender).toHaveBeenLastCalledWith({ invalidateBitmapCache: true });
  });

  it('publishes clone stamp workflow parity metadata from the concrete tool module', () => {
    expect(cloneStampWorkflowCapabilityDescriptor.tool).toBe('cloneStamp');
    expect(cloneStampWorkflowCapabilityDescriptor.sampleSource.readiness).toBe('needs-sample-point');
    expect(cloneStampWorkflowCapabilityDescriptor.liveCloneSourceOverlay.status).toBe('unsupported');
    expect(cloneStampWorkflowCapabilityDescriptor.cloneSourceTransform.status).toBe('unsupported');
    expect(cloneStampWorkflowCapabilityDescriptor.preview.signature).toContain('image-clone-stamp-workflow:v1');
  });

  it('publishes clone stamp preview and route support signatures from the concrete tool module', () => {
    expect(cloneStampPreviewIdDescriptor).toEqual({
      id: 'clone-stamp:currentLayer:aligned:no-sample:16:1:activeLayer',
      signature: 'image-clone-stamp-workflow:v1:{"sampleMode":"currentLayer","aligned":true,"sampleReady":false,"size":16,"opacity":1,"output":"activeLayer","warnings":["sample-source-required","live-clone-source-overlay-unsupported","clone-source-transform-unsupported","destructive-active-layer-pixels"]}',
    });
    expect(cloneStampRouteSupportDescriptor).toMatchObject({
      descriptorId: 'image-retouch-brush-route-support:v1',
      tool: 'cloneStamp',
      readiness: 'blocked',
      blockers: ['sample-source-required'],
      unsupported: expect.arrayContaining([
        'clone-source-overlay',
        'clone-source-transform',
        'perspective-clone',
      ]),
    });
    expect(cloneStampRouteSupportDescriptor.signature).toContain('image-retouch-brush-route-support:v1');
  });

  it('publishes clone stamp readiness metadata for route safety and action planning', () => {
    expect(cloneStampReadinessDescriptor).toMatchObject({
      descriptorId: 'image-retouch-tool-readiness:v1',
      tool: 'cloneStamp',
      readiness: 'blocked',
      routeSafety: {
        activeTarget: 'layer',
        canPaint: false,
        blockers: [
          {
            code: 'sample-source-required',
            message: 'Clone Stamp requires an Alt/Option sample point before painting.',
          },
        ],
      },
      brushInput: {
        supportsPointer: true,
        supportsKeyboardSamplingShortcut: true,
        controls: ['size', 'opacity', 'sampleMode', 'aligned'],
      },
      sourceSampling: {
        requested: 'currentLayer',
        coordinateSpace: 'layer',
        source: 'active-layer-snapshot-at-stroke-start',
        requiresExplicitSamplePoint: true,
      },
      batchActions: {
        suitable: false,
        requiresRecordedPointerPath: true,
        requiresRecordedSamplePoint: true,
      },
    });
  });

  it('publishes clone source parity checks from the concrete tool module', () => {
    expect(cloneStampParityCheckDescriptor).toEqual({
      overlay: {
        checkId: 'clone-source-overlay',
        status: 'unsupported',
        fallback: 'target-brush-cursor-only',
        blocker: 'clone-source-overlay-unsupported',
        caveat: 'Live source crosshair/ghost overlay is not rendered while cloning.',
        signature: 'retouch-clone-source-check:v1:{"checkId":"clone-source-overlay","status":"unsupported","fallback":"target-brush-cursor-only","blocker":"clone-source-overlay-unsupported"}',
      },
      transform: {
        checkId: 'clone-source-transform',
        status: 'unsupported',
        requestedTransforms: ['scale', 'rotation', 'flip', 'offset'],
        supportedTransforms: [],
        blocker: 'clone-source-transform-unsupported',
        caveat: 'Clone source scale, rotation, flip, and offset transform controls are not implemented.',
        signature: 'retouch-clone-source-check:v1:{"checkId":"clone-source-transform","status":"unsupported","requestedTransforms":["scale","rotation","flip","offset"],"supportedTransforms":[],"blocker":"clone-source-transform-unsupported"}',
      },
    });
  });

  it('keeps aligned clone source offset across separate strokes', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(active.bitmap!, 0, 0, [255, 0, 0, 255]);
    setPixel(active.bitmap!, 1, 0, [0, 255, 0, 255]);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, aligned: true });

    cloneStampTool.onPointerDown?.(env, { x: 0, y: 0 }, altMods, pointerEvent());
    cloneStampTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    cloneStampTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    cloneStampTool.onPointerDown?.(env, { x: 3, y: 0 }, mods, pointerEvent());
    cloneStampTool.onPointerUp?.(env, { x: 3, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(active.bitmap!, 3, 0)).toEqual([0, 255, 0, 255]);
  });

  it('restores cloned preview pixels when a stroke is canceled before commit', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    const sourcePixel: [number, number, number, number] = [255, 0, 0, 255];
    const targetPixel: [number, number, number, number] = [0, 0, 255, 255];
    setPixel(active.bitmap!, 0, 0, sourcePixel);
    setPixel(active.bitmap!, 2, 0, targetPixel);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, aligned: true });

    cloneStampTool.onPointerDown?.(env, { x: 0, y: 0 }, altMods, pointerEvent());
    cloneStampTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 0)).toEqual(sourcePixel);

    cloneStampTool.onCancel?.(env);

    expect(getPixel(active.bitmap!, 2, 0)).toEqual(targetPixel);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('restarts clone source from the sample point when aligned is off', () => {
    const active = makeLayer({ id: 'active', name: 'Active' });
    setPixel(active.bitmap!, 0, 0, [255, 0, 0, 255]);
    setPixel(active.bitmap!, 1, 0, [0, 255, 0, 255]);
    const doc = makeDoc([active], active.id);
    const env = makeEnv(doc, active, { ...DEFAULT_RETOUCH_TOOL_SETTINGS, aligned: false });

    cloneStampTool.onPointerDown?.(env, { x: 0, y: 0 }, altMods, pointerEvent());
    cloneStampTool.onPointerDown?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    cloneStampTool.onPointerUp?.(env, { x: 2, y: 0 }, mods, pointerEvent());
    cloneStampTool.onPointerDown?.(env, { x: 3, y: 0 }, mods, pointerEvent());
    cloneStampTool.onPointerUp?.(env, { x: 3, y: 0 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(active.bitmap!, 3, 0)).toEqual([255, 0, 0, 255]);
  });
});
