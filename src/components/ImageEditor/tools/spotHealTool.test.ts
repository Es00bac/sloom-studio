import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_RETOUCH_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  type ImageDocument,
  type ImageLayer,
  type LayerBitmap,
} from '../../../types/imageEditor';
import type { ToolEnv } from './types';
import {
  spotHealRepairOutputParityCheckDescriptor,
  spotHealPreviewIdDescriptor,
  spotHealReadinessDescriptor,
  spotHealRouteSupportDescriptor,
  spotHealTool,
  spotHealWorkflowCapabilityDescriptor,
} from './spotHealTool';

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
    bitmap: new OffscreenCanvas(5, 5) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeDoc(layers: ImageLayer[], activeLayerId: string): ImageDocument {
  return {
    id: 'doc-heal',
    title: 'Heal',
    width: 5,
    height: 5,
    layers,
    activeLayerId,
    activeLayerEditTarget: 'layer',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function makeEnv(doc: ImageDocument, activeLayer: ImageLayer): ToolEnv {
  return {
    doc,
    activeLayer,
    brushSettings: { ...DEFAULT_BRUSH_SETTINGS, size: 1, opacity: 1 },
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    retouchToolSettings: { ...DEFAULT_RETOUCH_TOOL_SETTINGS, sampleMode: 'allLayers' },
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

describe('spotHealTool retouch sampling', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('uses visible lower layers as the repair source when sample mode is all layers', () => {
    const lower = makeLayer({ id: 'lower', name: 'Lower' });
    const active = makeLayer({ id: 'active', name: 'Active' });
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        setPixel(lower.bitmap!, x, y, [40, 140, 220, 255]);
      }
    }
    setPixel(active.bitmap!, 2, 2, [200, 0, 0, 255]);
    const doc = makeDoc([lower, active], active.id);
    const env = makeEnv(doc, active);

    spotHealTool.onPointerDown?.(env, { x: 2, y: 2 }, mods, pointerEvent());
    spotHealTool.onPointerUp?.(env, { x: 2, y: 2 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 2)).toEqual([40, 140, 220, 255]);
  });

  it('retargets spot heal strokes to a visible bitmap layer under the cursor when the active layer has no pixels', () => {
    const lower = makeLayer({ id: 'lower', name: 'Lower' });
    const raster = makeLayer({ id: 'raster', name: 'Raster' });
    const activeVector = makeLayer({
      id: 'vector',
      name: 'Vector',
      type: 'vector',
      bitmap: undefined,
    });
    const repairPixel: [number, number, number, number] = [40, 140, 220, 255];
    const blemishPixel: [number, number, number, number] = [200, 0, 0, 255];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        setPixel(lower.bitmap!, x, y, repairPixel);
      }
    }
    setPixel(raster.bitmap!, 2, 2, blemishPixel);
    const doc = makeDoc([lower, raster, activeVector], activeVector.id);
    const env = makeEnv(doc, activeVector);

    spotHealTool.onPointerDown?.(env, { x: 2, y: 2 }, mods, pointerEvent());
    spotHealTool.onPointerUp?.(env, { x: 2, y: 2 }, mods, pointerEvent());

    expect(getPixel(raster.bitmap!, 2, 2)).toEqual(repairPixel);
    expect(env.store.bumpLayerBitmapVersion).toHaveBeenCalledWith(doc.id, raster.id);
    expect(env.requestRender).toHaveBeenLastCalledWith({ invalidateBitmapCache: true });
  });

  it('restores healed preview pixels when a stroke is canceled before commit', () => {
    const lower = makeLayer({ id: 'lower', name: 'Lower' });
    const active = makeLayer({ id: 'active', name: 'Active' });
    const repairPixel: [number, number, number, number] = [40, 140, 220, 255];
    const blemishPixel: [number, number, number, number] = [200, 0, 0, 255];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        setPixel(lower.bitmap!, x, y, repairPixel);
      }
    }
    setPixel(active.bitmap!, 2, 2, blemishPixel);
    const doc = makeDoc([lower, active], active.id);
    const env = makeEnv(doc, active);

    spotHealTool.onPointerDown?.(env, { x: 2, y: 2 }, mods, pointerEvent());

    expect(getPixel(active.bitmap!, 2, 2)).toEqual(repairPixel);

    spotHealTool.onCancel?.(env);

    expect(getPixel(active.bitmap!, 2, 2)).toEqual(blemishPixel);
    expect(env.pushOperation).not.toHaveBeenCalled();
    expect(env.store.markDocumentDirty).not.toHaveBeenCalled();
    expect(env.requestRender).toHaveBeenCalledTimes(2);
  });

  it('publishes spot heal patch/remove limitation metadata from the concrete tool module', () => {
    expect(spotHealWorkflowCapabilityDescriptor.tool).toBe('spotHeal');
    expect(spotHealWorkflowCapabilityDescriptor.sampleSource.readiness).toBe('ready-on-stroke');
    expect(spotHealWorkflowCapabilityDescriptor.patchWorkflow.status).toBe('unsupported');
    expect(spotHealWorkflowCapabilityDescriptor.removeWorkflow.status).toBe('unsupported');
    expect(spotHealWorkflowCapabilityDescriptor.preview.signature).toContain('image-spot-heal-workflow:v1');
  });

  it('publishes spot heal preview and route support signatures from the concrete tool module', () => {
    expect(spotHealPreviewIdDescriptor).toEqual({
      id: 'spot-heal:currentLayer:16:1:activeLayer',
      signature: 'image-spot-heal-workflow:v1:{"sampleMode":"currentLayer","size":16,"opacity":1,"output":"activeLayer","warnings":["patch-workflow-unsupported","content-aware-remove-unsupported","destructive-active-layer-pixels"]}',
    });
    expect(spotHealRouteSupportDescriptor).toMatchObject({
      descriptorId: 'image-retouch-brush-route-support:v1',
      tool: 'spotHeal',
      readiness: 'ready',
      blockers: [],
      unsupported: expect.arrayContaining([
        'content-aware-remove-tool',
        'advanced-healing-ai',
        'patch-remove-dedicated-ui',
      ]),
    });
    expect(spotHealRouteSupportDescriptor.signature).toContain('image-retouch-brush-route-support:v1');
  });

  it('publishes spot heal readiness metadata with patch and remove caveats', () => {
    expect(spotHealReadinessDescriptor).toMatchObject({
      descriptorId: 'image-retouch-tool-readiness:v1',
      tool: 'spotHeal',
      readiness: 'ready',
      implemented: expect.arrayContaining(['paint-local-repair-from-surrounding-samples']),
      unsupported: expect.arrayContaining([
        'patch-source-drag',
        'content-aware-remove-tool',
      ]),
      routeSafety: {
        activeTarget: 'layer',
        canPaint: true,
        blockers: [],
      },
      brushInput: {
        controls: ['size', 'opacity', 'sampleMode'],
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
  });

  it('publishes spot heal repair and new-layer parity checks from the concrete tool module', () => {
    expect(spotHealRepairOutputParityCheckDescriptor).toEqual({
      patch: {
        checkId: 'patch-source-workflow',
        status: 'unsupported',
        supportedRoute: 'paint-local-repair',
        unsupportedSteps: ['lasso-patch-source-drag', 'patch-transform', 'destination-mode', 'transparent-mode'],
        blocker: 'patch-workflow-unsupported',
        caveat: 'Patch Tool source dragging, destination mode, transparent mode, and patch transforms are not implemented.',
        signature: 'retouch-repair-output-check:v1:{"checkId":"patch-source-workflow","status":"unsupported","blocker":"patch-workflow-unsupported","unsupportedSteps":["lasso-patch-source-drag","patch-transform","destination-mode","transparent-mode"]}',
      },
      remove: {
        checkId: 'remove-tool-workflow',
        status: 'unsupported',
        localFallback: 'local-alpha-remove-from-content-aware-plan',
        blocker: 'content-aware-remove-unsupported',
        caveat: 'Photoshop Remove Tool style object removal is not implemented by Spot Heal.',
        signature: 'retouch-repair-output-check:v1:{"checkId":"remove-tool-workflow","status":"unsupported","blocker":"content-aware-remove-unsupported","localFallback":"local-alpha-remove-from-content-aware-plan"}',
      },
      newLayerOutput: {
        checkId: 'retouch-new-layer-output',
        requested: false,
        status: 'unsupported',
        applied: 'activeLayer',
        blocker: 'new-layer-output-unsupported',
        caveat: 'Retouch tools commit undoable pixels to the active layer; new clone/heal/repair output layers are not generated.',
        signature: 'retouch-repair-output-check:v1:{"checkId":"retouch-new-layer-output","requested":false,"status":"unsupported","applied":"activeLayer","blocker":"new-layer-output-unsupported"}',
      },
    });
  });
});
