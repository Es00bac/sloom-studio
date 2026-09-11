import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  type ImageLayer,
  type LayerBitmap,
} from '../../../types/imageEditor';
import { createEmptyImageDocument, useImageEditorStore } from '../../../store/imageEditorStore';
import { createHideAllLayerMask, createRevealAllLayerMask } from '../LayerMaskOps';
import type { ToolEnv } from './types';
import { brushTool, eraserTool } from './brushTool';

const mods = { shift: false, alt: false, ctrl: false, meta: false };

class FakeContext {
  imageData: ImageData;
  fillStyle: string | CanvasGradient = '#000000';
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';

  constructor(canvas: FakeOffscreenCanvas) {
    this.imageData = makeImageData(canvas.width, canvas.height);
  }

  createImageData(width: number, height: number) {
    return makeImageData(width, height);
  }

  getImageData() {
    return {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.imageData = {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    } as ImageData;
  }

  drawImage() {}
  save() {}
  restore() {}
  clearRect() {}
  fillRect() {}
  translate() {}
  rotate() {}
  scale() {}
  beginPath() {}
  arc() {}
  fill() {}
  createRadialGradient() {
    return {
      addColorStop() {},
    } as CanvasGradient;
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(this);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function alphaAt(bitmap: LayerBitmap, x: number, y: number): number {
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  return data[(y * bitmap.width + x) * 4 + 3];
}

function pointerEvent(): PointerEvent {
  return {
    pointerType: 'mouse',
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
  } as PointerEvent;
}

function createEnv(docId: string): ToolEnv {
  const store = useImageEditorStore.getState();
  const doc = store.documents.find((entry) => entry.id === docId)!;
  const activeLayer = doc.layers.find((entry) => entry.id === doc.activeLayerId) ?? null;
  return {
    doc,
    activeLayer,
    brushSettings: { ...DEFAULT_BRUSH_SETTINGS },
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS },
    screenToDoc: (point) => point,
    docToScreen: (point) => point,
    pushOperation: store.pushOperation,
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store,
  };
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
    bitmap: new OffscreenCanvas(12, 12) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

describe('brushTool layer-mask integration', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
      quickMaskSettings: {
        enabled: false,
        viewMode: 'maskedAreas',
        overlayOpacity: 0.5,
      },
    });
  });

  it('paints directly into the active layer mask and records an undoable mask paint operation', () => {
    const baseLayer = makeLayer();
    const maskedLayer = makeLayer({
      id: 'masked',
      mask: createHideAllLayerMask({ width: 12, height: 12 } as never, baseLayer),
    });
    const doc = createEmptyImageDocument({
      id: 'doc-mask-paint',
      title: 'Mask Paint',
      width: 12,
      height: 12,
    });
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [maskedLayer],
      activeLayerId: 'masked',
      activeLayerEditTarget: 'mask',
    });

    const env = createEnv(doc.id);

    brushTool.onPointerDown?.(env, { x: 6, y: 6 }, mods, pointerEvent());
    brushTool.onPointerUp?.(env, { x: 6, y: 6 }, mods, pointerEvent());

    const activeDoc = useImageEditorStore.getState().getActiveDocument();
    const layer = activeDoc?.layers.find((entry) => entry.id === 'masked');
    expect(layer?.mask).not.toBeNull();
    expect(alphaAt(layer!.mask!, 6, 6)).toBeGreaterThan(0);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'paint',
      docId: doc.id,
      layerId: 'masked',
      paintTarget: 'mask',
    });
  });

  it('lets the eraser conceal an active layer mask', () => {
    const baseLayer = makeLayer();
    const maskedLayer = makeLayer({
      id: 'masked',
      mask: createRevealAllLayerMask({ width: 12, height: 12 } as never, baseLayer),
    });
    const doc = createEmptyImageDocument({
      id: 'doc-mask-erase',
      title: 'Mask Paint',
      width: 12,
      height: 12,
    });
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [maskedLayer],
      activeLayerId: 'masked',
      activeLayerEditTarget: 'mask',
    });

    const env = createEnv(doc.id);

    eraserTool.onPointerDown?.(env, { x: 6, y: 6 }, mods, pointerEvent());
    eraserTool.onPointerUp?.(env, { x: 6, y: 6 }, mods, pointerEvent());

    const activeDoc = useImageEditorStore.getState().getActiveDocument();
    const layer = activeDoc?.layers.find((entry) => entry.id === 'masked');
    expect(layer?.mask).not.toBeNull();
    expect(alphaAt(layer!.mask!, 6, 6)).toBeLessThan(255);
  });

  it('mirrors layer-mask painting across the document center when vertical symmetry is enabled', () => {
    const baseLayer = makeLayer();
    const maskedLayer = makeLayer({
      id: 'masked',
      mask: createHideAllLayerMask({ width: 12, height: 12 } as never, baseLayer),
    });
    const doc = createEmptyImageDocument({
      id: 'doc-mask-symmetry',
      title: 'Mask Symmetry',
      width: 12,
      height: 12,
    });
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [maskedLayer],
      activeLayerId: 'masked',
      activeLayerEditTarget: 'mask',
    });

    const env = createEnv(doc.id);
    env.brushSettings = { ...DEFAULT_BRUSH_SETTINGS, symmetryMode: 'vertical' };

    brushTool.onPointerDown?.(env, { x: 2, y: 6 }, mods, pointerEvent());
    brushTool.onPointerUp?.(env, { x: 2, y: 6 }, mods, pointerEvent());

    const layer = useImageEditorStore.getState().getActiveDocument()?.layers.find((entry) => entry.id === 'masked');
    expect(alphaAt(layer!.mask!, 2, 6)).toBeGreaterThan(0);
    expect(alphaAt(layer!.mask!, 10, 6)).toBeGreaterThan(0);
  });
});
