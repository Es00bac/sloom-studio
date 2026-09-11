// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_GRADIENT_TOOL_SETTINGS,
  DEFAULT_SHAPE_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  type ImageDocument,
  type ImageLayer,
  type LayerBitmap,
} from '../../types/imageEditor';
import { getBrushSymmetryGuideSegment, ImageCropActionOverlay, ImageEditorCanvas, ImageLayerTransformOverlay, ImageMultiLayerTransformOverlay, ImageTransformActionOverlay, ImageVectorPathAnchorOverlay } from './ImageEditorCanvas';
import { normalizeImageTextStyle } from './ImageTextLayer';
import { clearCropPreview, clearPerspectiveCropPreview, cropTool, getPerspectiveCropPreview, seedPerspectiveCropQuadFromDocument } from './tools/cropTool';
import type { ToolEnv } from './tools/types';
import { createMask } from './SelectionMask';
import { applyOperation } from './undoRedoApply';
import { clearSelection, getSelection, setSelection } from './selectionRegistry';
import { applyTransformPreviewSession, beginMultiLayerTransformPreviewSession, beginTransformPreviewSession, clearTransformPreviewSession, setTransformPreviewMode } from './ImageTransformPreview';
import { createPixelBuffer } from './pixels/PixelBuffer';
import { createImageCmykPixelBuffer } from './cmyk/ImageCmykDocument';
import { beginSelectionTransformSession, clearSelectionTransformSession, setSelectionTransformMode } from './ImageSelectionTransform';
import {
  buildVectorPathLayer,
  createLiveImageVectorBooleanLayers,
  getVectorPathDocumentPoints,
} from './ImageVectorShape';
import { describeImageToolDispatcherSupport, shouldIgnoreImageCanvasToolEvent } from './tools/dispatcher';
import { resolveMultiLayerTransformParticipants } from './ImageGroupTransform';
import { docToScreen } from './viewport';

function bitmap(width: number, height: number): LayerBitmap {
  return { width, height } as LayerBitmap;
}

function imageLayer(patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 24,
    y: 32,
    bitmap: bitmap(180, 120),
    bitmapVersion: 0,
    mask: null,
    ...patch,
  };
}

function imageDoc(layer: ImageLayer): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Canvas tools',
    width: 640,
    height: 480,
    layers: [layer],
    activeLayerId: layer.id,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    snapshots: [],
  };
}

function dispatchPointerEvent(
  target: Element,
  type: string,
  init: { clientX: number; clientY: number; pointerId?: number },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX,
    clientY: init.clientY,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', {
    configurable: true,
    value: init.pointerId ?? 1,
  });
  target.dispatchEvent(event);
}

class FakeOffscreenCanvasContext {
  drawImage = vi.fn();
  beginPath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  closePath() {}
  clip() {}
  fill() {}
  stroke() {}
  clearRect() {}
  rect() {}
  ellipse() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  transform() {}
  getImageData() {
    return {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    } as ImageData;
  }
  createImageData(width: number, height: number) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }
  putImageData() {}
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context = new FakeOffscreenCanvasContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

describe('ImageEditorCanvas tools', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn(() => new FakeOffscreenCanvasContext()),
    });
    clearCropPreview();
    clearPerspectiveCropPreview();
    clearTransformPreviewSession();
    clearSelectionTransformSession();
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('describes dispatcher support for every registered image tool without assuming every tool has full canvas handlers', () => {
    const support = describeImageToolDispatcherSupport();

    expect(support.descriptorId).toBe('image-tool-dispatcher-support:v1');
    expect(support.tools).toHaveLength(26);
    expect(support.signature).toContain('brush:pointerDown,pointerMove,pointerUp,cancel');
    expect(support.tools.find((tool) => tool.tool === 'hand')).toMatchObject({
      support: 'inactive',
      methods: [],
      caveat: 'Toolbar/shortcut selection exists, but no canvas ToolHandler callbacks are registered.',
    });
    expect(support.tools.find((tool) => tool.tool === 'brush')).toMatchObject({
      support: 'partial',
      methods: ['pointerDown', 'pointerMove', 'pointerUp', 'cancel'],
    });
    expect(support.unsupportedTools).toEqual(['hand']);
    expect(support.partialTools).toContain('brush');
  });

  it('owns one canvas pointer and cancels an unfinished selection on unmount', async () => {
    const doc = imageDoc(imageLayer());
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('lasso');
    useImageEditorStore.getState().setSelectionToolSettings({
      ...DEFAULT_SELECTION_TOOL_SETTINGS,
      lassoShape: 'freehand',
    });

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ImageEditorCanvas />);
    });
    const wrapper = container.firstElementChild;
    expect(wrapper).not.toBeNull();

    await act(async () => {
      dispatchPointerEvent(wrapper!, 'pointerdown', { clientX: 4, clientY: 4, pointerId: 1 });
      dispatchPointerEvent(wrapper!, 'pointermove', { clientX: 28, clientY: 4, pointerId: 1 });
      dispatchPointerEvent(wrapper!, 'pointermove', { clientX: 4, clientY: 28, pointerId: 1 });
      // A second touch/pen pointer must not replace the first stroke or receive its completion.
      dispatchPointerEvent(wrapper!, 'pointerdown', { clientX: 12, clientY: 12, pointerId: 2 });
      dispatchPointerEvent(wrapper!, 'pointerup', { clientX: 12, clientY: 12, pointerId: 2 });
      // Browser cancellation discards the preview rather than committing a selection operation.
      dispatchPointerEvent(wrapper!, 'pointercancel', { clientX: 4, clientY: 28, pointerId: 1 });
    });

    expect(useImageEditorStore.getState().undoStacks[doc.id] ?? []).toHaveLength(0);
    expect(getSelection(doc.id)?.data.every((alpha) => alpha === 0)).toBe(true);
    await act(async () => {
      root.unmount();
    });

    const selection = getSelection(doc.id);
    expect(selection?.data.every((alpha) => alpha === 0)).toBe(true);
    expect(useImageEditorStore.getState().undoStacks[doc.id] ?? []).toHaveLength(0);
    container.remove();
    clearSelection(doc.id);
  });

  it('renders direct transform and rotate handles for the active layer on the Move tool', () => {
    const layer = imageLayer();
    const doc = imageDoc(layer);

    const html = renderToStaticMarkup(
      <ImageLayerTransformOverlay
        doc={doc}
        layer={layer}
        requestRender={() => undefined}
        wrapperRef={{ current: null }}
      />,
    );

    expect(html).toContain('data-image-layer-transform-overlay="true"');
    expect(html).toContain('data-image-layer-transform-handle="nw"');
    expect(html).toContain('data-image-layer-transform-handle="n"');
    expect(html).toContain('data-image-layer-transform-handle="e"');
    expect(html).toContain('data-image-layer-transform-handle="s"');
    expect(html).toContain('data-image-layer-transform-handle="w"');
    expect(html).toContain('data-image-layer-transform-handle="se"');
    expect(html).toContain('data-image-layer-rotate-handle="true"');
    expect(html).toContain('data-image-layer-pivot-handle="true"');
    expect(html).toContain('aria-label="Rotate layer"');
  });

  it('resamples native high-bit authority and refreshes its proxy on a direct resize commit', () => {
    const pixels = createPixelBuffer({ width: 180, height: 120, depth: 'u16' });
    pixels.data.fill(3210);
    const layer = imageLayer({ pixels, pixelsVersion: 7 });
    const doc = { ...imageDoc(layer), metadata: { bitDepth: 16 as const } };
    useImageEditorStore.getState().openDocument(doc);

    const wrapper = document.createElement('div');
    wrapper.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 480, width: 640, height: 480,
      toJSON: () => ({}),
    });
    const container = document.createElement('div');
    document.body.append(wrapper, container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <ImageLayerTransformOverlay
          doc={doc}
          layer={layer}
          requestRender={() => undefined}
          wrapperRef={{ current: wrapper }}
        />,
      );
    });

    const handle = container.querySelector<HTMLButtonElement>('[data-image-layer-transform-handle="se"]');
    expect(handle).not.toBeNull();
    act(() => {
      dispatchPointerEvent(handle!, 'pointerdown', { clientX: 204, clientY: 152, pointerId: 81 });
      dispatchPointerEvent(handle!, 'pointermove', { clientX: 264, clientY: 192, pointerId: 81 });
      dispatchPointerEvent(handle!, 'pointerup', { clientX: 264, clientY: 192, pointerId: 81 });
    });

    const resized = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(resized?.pixels).toMatchObject({ width: 240, height: 160, depth: 'u16' });
    expect(resized?.bitmap).toMatchObject({ width: 240, height: 160 });
    expect(resized?.mask).toBeNull();
    expect(resized?.pixelsVersion).toBe(8);
    const operation = applyTransformPreviewSession(doc.id);
    expect(operation?.kind).toBe('layerOp');
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    const undoOperation = useImageEditorStore.getState().popUndo(doc.id);
    expect(undoOperation).toBeDefined();
    applyOperation(undoOperation!, 'undo');
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.pixels).toMatchObject({ width: 180, height: 120 });
    const redoOperation = useImageEditorStore.getState().popRedo(doc.id);
    expect(redoOperation).toBeDefined();
    applyOperation(redoOperation!, 'redo');
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.pixels).toMatchObject({ width: 240, height: 160 });

    act(() => root.unmount());
    container.remove();
    wrapper.remove();
  });

  it('renders direct draggable anchor handles for a selected retained path layer', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-path-anchor-overlay',
      title: 'Path Overlay',
      width: 300,
      height: 240,
    });
    const pathLayer = buildVectorPathLayer({
      doc,
      points: [
        { x: 40, y: 52 },
        { x: 120, y: 84 },
        { x: 180, y: 148 },
      ],
      closed: false,
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    });
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;

    const html = renderToStaticMarkup(
      <ImageVectorPathAnchorOverlay
        doc={doc}
        layer={pathLayer}
        requestRender={() => undefined}
        wrapperRef={{ current: null }}
      />,
    );

    expect(html).toContain('data-image-vector-path-anchor-overlay="true"');
    expect(html).toContain('data-image-canvas-interaction-overlay="true"');
    expect(html).toContain('data-image-vector-path-anchor-handle="0"');
    expect(html).toContain('data-image-vector-path-anchor-handle="1"');
    expect(html).toContain('data-image-vector-path-anchor-handle="2"');
    expect(html).toContain('aria-label="Move path anchor 2"');
  });

  it('renders direct draggable Bezier handle controls for retained curved path anchors', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-path-bezier-overlay',
      title: 'Path Bezier Overlay',
      width: 300,
      height: 240,
    });
    const pathLayer = buildVectorPathLayer({
      doc,
      points: [
        { x: 40, y: 52, outHandle: { x: 74, y: 38 } },
        { x: 180, y: 148, inHandle: { x: 142, y: 168 } },
      ],
      closed: false,
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    });
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;

    const html = renderToStaticMarkup(
      <ImageVectorPathAnchorOverlay
        doc={doc}
        layer={pathLayer}
        requestRender={() => undefined}
        wrapperRef={{ current: null }}
      />,
    );

    expect(html).toContain('data-image-vector-path-bezier-handle="0-outHandle"');
    expect(html).toContain('data-image-vector-path-bezier-handle="1-inHandle"');
    expect(html).toContain('aria-label="Move path anchor 1 out handle"');
    expect(html).toContain('C 74 38 142 168 180 148');
  });

  it('keeps committed path anchor and Bezier handles visible while the Pen tool is active', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-pen-active-overlay',
      title: 'Pen Active Overlay',
      width: 300,
      height: 240,
    });
    const pathLayer = buildVectorPathLayer({
      doc,
      points: [
        { x: 40, y: 52 },
        { x: 120, y: 84 },
      ],
      closed: false,
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    });
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.setState({
      documents: [doc],
      activeDocId: doc.id,
      tool: 'pen',
    });

    const html = renderToStaticMarkup(<ImageEditorCanvas />);

    expect(html).toContain('data-image-vector-path-anchor-overlay="true"');
    expect(html).toContain('data-image-vector-path-anchor-handle="0"');
    expect(html).toContain('data-image-vector-path-anchor-handle="1"');
  });

  it('keeps direct path anchor pointer events out of the active canvas tool dispatcher', () => {
    const overlay = document.createElement('div');
    overlay.setAttribute('data-image-canvas-interaction-overlay', 'true');
    const handle = document.createElement('button');
    overlay.append(handle);
    document.body.append(overlay);

    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    handle.dispatchEvent(event);

    expect(shouldIgnoreImageCanvasToolEvent(event)).toBe(true);
    overlay.remove();
  });

  it('drags a retained path anchor as one undoable layer operation', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-path-anchor-drag',
      title: 'Path Drag',
      width: 300,
      height: 240,
    });
    const pathLayer = buildVectorPathLayer({
      doc,
      points: [
        { x: 40, y: 52 },
        { x: 120, y: 84 },
        { x: 180, y: 148 },
      ],
      closed: false,
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    });
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);
    const requestRender = vi.fn();
    const wrapper = document.createElement('div');
    wrapper.getBoundingClientRect = () => ({
      x: 12,
      y: 18,
      left: 12,
      top: 18,
      right: 312,
      bottom: 258,
      width: 300,
      height: 240,
      toJSON: () => ({}),
    } as DOMRect);
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | null = createRoot(container);

    act(() => {
      root?.render(
        <ImageVectorPathAnchorOverlay
          doc={doc}
          layer={pathLayer}
          requestRender={requestRender}
          wrapperRef={{ current: wrapper }}
        />,
      );
    });

    const anchor2 = container.querySelector<HTMLButtonElement>('button[data-image-vector-path-anchor-handle="1"]');
    expect(anchor2).not.toBeNull();

    act(() => {
      dispatchPointerEvent(anchor2!, 'pointerdown', { clientX: 132, clientY: 102, pointerId: 4 });
      dispatchPointerEvent(anchor2!, 'pointermove', { clientX: 162, clientY: 134, pointerId: 4 });
      dispatchPointerEvent(anchor2!, 'pointerup', { clientX: 162, clientY: 134, pointerId: 4 });
    });

    const editedLayer = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(editedLayer ? getVectorPathDocumentPoints(editedLayer) : []).toEqual([
      { x: 40, y: 52 },
      { x: 150, y: 116 },
      { x: 180, y: 148 },
    ]);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.[0]).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });
    expect(requestRender).toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
  });

  it('refreshes a live Boolean result during an operand anchor drag and records that displayed result', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-live-boolean-anchor-drag',
      title: 'Live Boolean Drag',
      width: 300,
      height: 240,
    });
    const first = buildVectorPathLayer({
      doc,
      points: [
        { x: 40, y: 52 },
        { x: 120, y: 52 },
        { x: 120, y: 148 },
        { x: 40, y: 148 },
      ],
      closed: true,
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    });
    const second = buildVectorPathLayer({
      doc,
      points: [
        { x: 100, y: 60 },
        { x: 180, y: 60 },
        { x: 180, y: 140 },
        { x: 100, y: 140 },
      ],
      closed: true,
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    });
    const live = createLiveImageVectorBooleanLayers('union', first, second);
    expect(live.status).toBe('exact');
    const output = live.outputLayers[0]!;
    doc.layers = [first, second, output];
    doc.activeLayerId = first.id;
    useImageEditorStore.getState().openDocument(doc);
    const outputBefore = JSON.stringify(output.metadata?.vectorShape);

    const requestRender = vi.fn();
    const wrapper = document.createElement('div');
    wrapper.getBoundingClientRect = () => ({
      x: 12,
      y: 18,
      left: 12,
      top: 18,
      right: 312,
      bottom: 258,
      width: 300,
      height: 240,
      toJSON: () => ({}),
    } as DOMRect);
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | null = createRoot(container);

    act(() => {
      root?.render(
        <ImageVectorPathAnchorOverlay
          doc={doc}
          layer={first}
          requestRender={requestRender}
          wrapperRef={{ current: wrapper }}
        />,
      );
    });

    const anchor2 = container.querySelector<HTMLButtonElement>('button[data-image-vector-path-anchor-handle="1"]');
    expect(anchor2).not.toBeNull();
    act(() => {
      dispatchPointerEvent(anchor2!, 'pointerdown', { clientX: 132, clientY: 70, pointerId: 44 });
      dispatchPointerEvent(anchor2!, 'pointermove', { clientX: 152, clientY: 82, pointerId: 44 });
      dispatchPointerEvent(anchor2!, 'pointerup', { clientX: 152, clientY: 82, pointerId: 44 });
    });

    const state = useImageEditorStore.getState();
    const current = state.getActiveDocument()!;
    const displayedOutput = current.layers.find((layer) => layer.id === output.id)!;
    expect(JSON.stringify(displayedOutput.metadata?.vectorShape)).not.toBe(outputBefore);
    const operation = state.undoStacks[doc.id]?.at(-1);
    expect(operation).toMatchObject({ kind: 'layerOp', docId: doc.id });
    if (!operation || operation.kind !== 'layerOp') throw new Error('expected anchor drag layer operation');
    expect(operation.after.find((layer) => layer.id === output.id)?.metadata?.vectorShape)
      .toEqual(displayedOutput.metadata?.vectorShape);

    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
  });

  it('drags a retained Bezier handle as one undoable layer operation', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-path-bezier-handle-drag',
      title: 'Path Bezier Drag',
      width: 300,
      height: 240,
    });
    const pathLayer = buildVectorPathLayer({
      doc,
      points: [
        { x: 40, y: 52, outHandle: { x: 74, y: 38 } },
        { x: 180, y: 148, inHandle: { x: 142, y: 168 } },
      ],
      closed: false,
      settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    });
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);
    const requestRender = vi.fn();
    const wrapper = document.createElement('div');
    wrapper.getBoundingClientRect = () => ({
      x: 12,
      y: 18,
      left: 12,
      top: 18,
      right: 312,
      bottom: 258,
      width: 300,
      height: 240,
      toJSON: () => ({}),
    } as DOMRect);
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | null = createRoot(container);

    act(() => {
      root?.render(
        <ImageVectorPathAnchorOverlay
          doc={doc}
          layer={pathLayer}
          requestRender={requestRender}
          wrapperRef={{ current: wrapper }}
        />,
      );
    });

    const outHandle = container.querySelector<HTMLButtonElement>('button[data-image-vector-path-bezier-handle="0-outHandle"]');
    expect(outHandle).not.toBeNull();

    act(() => {
      dispatchPointerEvent(outHandle!, 'pointerdown', { clientX: 86, clientY: 56, pointerId: 5 });
      dispatchPointerEvent(outHandle!, 'pointermove', { clientX: 102, clientY: 76, pointerId: 5 });
      dispatchPointerEvent(outHandle!, 'pointerup', { clientX: 102, clientY: 76, pointerId: 5 });
    });

    const editedLayer = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(editedLayer ? getVectorPathDocumentPoints(editedLayer) : []).toEqual([
      { x: 40, y: 52, outHandle: { x: 90, y: 58 } },
      { x: 180, y: 148, inHandle: { x: 142, y: 168 } },
    ]);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.[0]).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });
    expect(requestRender).toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
  });

  it('renders brush symmetry guides when a symmetry mode is active', () => {
    const layer = imageLayer();
    const doc = imageDoc(layer);
    useImageEditorStore.setState({
      documents: [doc],
      activeDocId: doc.id,
      tool: 'brush',
      brushSettings: { ...DEFAULT_BRUSH_SETTINGS, symmetryMode: 'both' },
    });

    const html = renderToStaticMarkup(<ImageEditorCanvas />);

    expect(html).toContain('data-image-brush-symmetry-overlay="true"');
    expect(html).toContain('data-image-brush-symmetry-guide="vertical"');
    expect(html).toContain('data-image-brush-symmetry-guide="horizontal"');
  });

  it.each([
    [90, '90 degrees'],
    [270, '270 degrees'],
    [37, 'a non-right angle'],
  ])('keeps both brush symmetry guides as non-zero transformed segments at %s (%s)', (rotationDeg) => {
    const layer = imageLayer();
    const doc = {
      ...imageDoc(layer),
      width: 400,
      height: 300,
      viewport: { zoom: 1, panX: 0, panY: 0, rotationDeg },
    };
    const view = { width: 400, height: 300 };
    const vertical = getBrushSymmetryGuideSegment(doc, 'vertical', view);
    const horizontal = getBrushSymmetryGuideSegment(doc, 'horizontal', view);

    expect(vertical.length).toBeCloseTo(300, 6);
    expect(horizontal.length).toBeCloseTo(400, 6);
    expect(Math.abs(vertical.end.x - vertical.start.x) + Math.abs(vertical.end.y - vertical.start.y)).toBeGreaterThan(0);
    expect(Math.abs(horizontal.end.x - horizontal.start.x) + Math.abs(horizontal.end.y - horizontal.start.y)).toBeGreaterThan(0);
  });

  it('renders direct skew and distort handles for the active layer transform mode', () => {
    const layer = imageLayer();
    const doc = imageDoc(layer);
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('move');
    beginTransformPreviewSession(doc, layer);
    setTransformPreviewMode(doc.id, 'skew');
    const skewHtml = renderToStaticMarkup(<ImageEditorCanvas />);
    setTransformPreviewMode(doc.id, 'distort');
    const distortHtml = renderToStaticMarkup(<ImageEditorCanvas />);

    expect(skewHtml).toContain('data-image-layer-transform-skew-handle="n"');
    expect(skewHtml).toContain('data-image-layer-transform-skew-handle="e"');
    expect(skewHtml).toContain('data-image-layer-transform-skew-handle="s"');
    expect(skewHtml).toContain('data-image-layer-transform-skew-handle="w"');
    expect(distortHtml).toContain('data-image-layer-transform-distort-handle="nw"');
    expect(distortHtml).toContain('data-image-layer-transform-distort-handle="ne"');
    expect(distortHtml).toContain('data-image-layer-transform-distort-handle="se"');
    expect(distortHtml).toContain('data-image-layer-transform-distort-handle="sw"');
  });

  it('renders direct perspective handles for the active layer transform mode', () => {
    const layer = imageLayer();
    const doc = imageDoc(layer);
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('move');
    beginTransformPreviewSession(doc, layer);
    setTransformPreviewMode(doc.id, 'perspective');
    const perspectiveHtml = renderToStaticMarkup(<ImageEditorCanvas />);

    expect(perspectiveHtml).toContain('data-image-layer-transform-perspective-handle="nw"');
    expect(perspectiveHtml).toContain('data-image-layer-transform-perspective-handle="ne"');
    expect(perspectiveHtml).toContain('data-image-layer-transform-perspective-handle="se"');
    expect(perspectiveHtml).toContain('data-image-layer-transform-perspective-handle="sw"');
    expect(perspectiveHtml).toContain('data-image-layer-perspective-plane-grid="true"');
    expect(perspectiveHtml).toContain('aria-label="Perspective plane grid"');
  });

  it('renders the shared-pivot multi-layer transform overlay for selected unlocked siblings', () => {
    const first = imageLayer({ id: 'layer-1', name: 'Layer 1', x: 24, y: 32 });
    const second = imageLayer({ id: 'layer-2', name: 'Layer 2', x: 220, y: 140, bitmap: bitmap(90, 70) });
    const locked = imageLayer({ id: 'layer-locked', name: 'Locked', x: 0, y: 0, locked: true });
    const doc = imageDoc(first);
    doc.layers = [first, second, locked];
    doc.selectedLayerIds = ['layer-1', 'layer-2', 'layer-locked'];
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('move');

    const html = renderToStaticMarkup(<ImageEditorCanvas />);

    // The multi-selection replaces the single-layer overlay and reports the locked exclusion.
    expect(html).toContain('data-image-multi-layer-transform-overlay="true"');
    expect(html).toContain('data-image-multi-layer-transform-box="true"');
    expect(html).toContain('data-image-multi-layer-transform-handle="nw"');
    expect(html).toContain('data-image-multi-layer-transform-handle="se"');
    expect(html).toContain('data-image-multi-layer-rotate-handle="true"');
    expect(html).toContain('data-image-multi-layer-pivot-handle="true"');
    expect(html).toContain('data-image-multi-layer-transform-excluded="true"');
    expect(html).not.toContain('data-image-layer-transform-overlay="true"');
  });

  it.each([90, 270, 37])('keeps multi-layer bounds and pivot drag in the rotated %s-degree view without document mutation', (rotationDeg) => {
    const view = { width: 400, height: 300 };
    const first = imageLayer({ id: 'layer-1', x: 80, y: 50, bitmap: bitmap(100, 100) });
    const second = imageLayer({ id: 'layer-2', x: 220, y: 120, bitmap: bitmap(80, 70) });
    const doc = {
      ...imageDoc(first),
      width: view.width,
      height: view.height,
      layers: [first, second],
      selectedLayerIds: ['layer-1', 'layer-2'],
      viewport: { zoom: 1, panX: 0, panY: 0, rotationDeg },
    };
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setViewportContainerSize(view);

    const wrapper = document.createElement('div');
    wrapper.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: view.width, bottom: view.height,
      width: view.width, height: view.height, toJSON: () => ({}),
    });
    const container = document.createElement('div');
    document.body.append(wrapper, container);
    const root = createRoot(container);
    const plan = resolveMultiLayerTransformParticipants(doc);

    act(() => {
      root.render(
        <ImageMultiLayerTransformOverlay
          doc={doc}
          plan={plan}
          requestRender={() => undefined}
          view={view}
          wrapperRef={{ current: wrapper }}
        />,
      );
    });

    const corners = [
      { x: 80, y: 50 }, { x: 180, y: 50 }, { x: 180, y: 150 }, { x: 80, y: 150 },
      { x: 220, y: 120 }, { x: 300, y: 120 }, { x: 300, y: 190 }, { x: 220, y: 190 },
    ].map((point) => docToScreen(point, doc.viewport, view));
    const minX = Math.min(...corners.map((point) => point.x));
    const minY = Math.min(...corners.map((point) => point.y));
    const pivotDoc = { x: 190, y: 120 };
    const pivotScreen = docToScreen(pivotDoc, doc.viewport, view);
    const overlay = container.querySelector<HTMLElement>('[data-image-multi-layer-transform-overlay="true"]')!;
    const pivot = container.querySelector<HTMLButtonElement>('[data-image-multi-layer-pivot-handle="true"]')!;
    expect(parseFloat(overlay.style.left)).toBeCloseTo(minX, 6);
    expect(parseFloat(overlay.style.top)).toBeCloseTo(minY, 6);
    expect(parseFloat(pivot.style.left)).toBeCloseTo(pivotScreen.x - minX, 6);
    expect(parseFloat(pivot.style.top)).toBeCloseTo(pivotScreen.y - minY, 6);

    const before = JSON.stringify({
      layers: useImageEditorStore.getState().getActiveDocument()?.layers,
      undo: useImageEditorStore.getState().undoStacks[doc.id] ?? [],
    });
    const targetDoc = { x: 250, y: 160 };
    const targetScreen = docToScreen(targetDoc, doc.viewport, view);
    act(() => {
      dispatchPointerEvent(pivot, 'pointerdown', { clientX: pivotScreen.x, clientY: pivotScreen.y, pointerId: 61 });
      dispatchPointerEvent(pivot, 'pointermove', { clientX: targetScreen.x, clientY: targetScreen.y, pointerId: 61 });
      dispatchPointerEvent(pivot, 'pointerup', { clientX: targetScreen.x, clientY: targetScreen.y, pointerId: 61 });
    });

    const targetPivotScreen = docToScreen(targetDoc, doc.viewport, view);
    expect(parseFloat(pivot.style.left)).toBeCloseTo(targetPivotScreen.x - minX, 6);
    expect(parseFloat(pivot.style.top)).toBeCloseTo(targetPivotScreen.y - minY, 6);
    expect(JSON.stringify({
      layers: useImageEditorStore.getState().getActiveDocument()?.layers,
      undo: useImageEditorStore.getState().undoStacks[doc.id] ?? [],
    })).toBe(before);

    act(() => root.unmount());
    container.remove();
    wrapper.remove();
  });

  it('resets a dragged shared pivot immediately when the participant selection changes', () => {
    const first = imageLayer({ id: 'layer-1', name: 'Layer 1', x: 0, y: 0, bitmap: bitmap(100, 100) });
    const second = imageLayer({ id: 'layer-2', name: 'Layer 2', x: 200, y: 100, bitmap: bitmap(80, 60) });
    const distant = imageLayer({ id: 'layer-3', name: 'Layer 3', x: 500, y: 300, bitmap: bitmap(100, 100) });
    const initialDoc = imageDoc(first);
    initialDoc.layers = [first, second, distant];
    initialDoc.selectedLayerIds = ['layer-1', 'layer-2', 'layer-3'];
    useImageEditorStore.getState().openDocument(initialDoc);

    const wrapper = document.createElement('div');
    wrapper.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 640,
      bottom: 480,
      width: 640,
      height: 480,
      toJSON: () => ({}),
    });
    const container = document.createElement('div');
    document.body.append(wrapper, container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ImageMultiLayerTransformOverlay
          doc={initialDoc}
          plan={resolveMultiLayerTransformParticipants(initialDoc)}
          requestRender={() => undefined}
          wrapperRef={{ current: wrapper }}
        />,
      );
    });

    const pivot = container.querySelector<HTMLButtonElement>('[data-image-multi-layer-pivot-handle="true"]')!;
    act(() => {
      dispatchPointerEvent(pivot, 'pointerdown', { clientX: 300, clientY: 200, pointerId: 17 });
      dispatchPointerEvent(pivot, 'pointermove', { clientX: 550, clientY: 350, pointerId: 17 });
      dispatchPointerEvent(pivot, 'pointerup', { clientX: 550, clientY: 350, pointerId: 17 });
    });
    expect(pivot.style.left).toBe('550px');

    const narrowedDoc = { ...initialDoc, selectedLayerIds: ['layer-1', 'layer-2'] };
    useImageEditorStore.setState({ documents: [narrowedDoc], activeDocId: narrowedDoc.id });
    act(() => {
      root.render(
        <ImageMultiLayerTransformOverlay
          doc={narrowedDoc}
          plan={resolveMultiLayerTransformParticipants(narrowedDoc)}
          requestRender={() => undefined}
          wrapperRef={{ current: wrapper }}
        />,
      );
    });

    expect(container.querySelector<HTMLButtonElement>('[data-image-multi-layer-pivot-handle="true"]')?.style.left).toBe('140px');

    act(() => root.unmount());
    container.remove();
    wrapper.remove();
  });

  it('drops a shared pivot that falls outside unchanged participants after they translate', () => {
    const first = imageLayer({ id: 'layer-1', name: 'Layer 1', x: 0, y: 0, bitmap: bitmap(100, 100) });
    const second = imageLayer({ id: 'layer-2', name: 'Layer 2', x: 100, y: 0, bitmap: bitmap(100, 100) });
    const initialDoc = imageDoc(first);
    initialDoc.layers = [first, second];
    initialDoc.selectedLayerIds = ['layer-1', 'layer-2'];
    useImageEditorStore.getState().openDocument(initialDoc);

    const wrapper = document.createElement('div');
    wrapper.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      toJSON: () => ({}),
    });
    const container = document.createElement('div');
    document.body.append(wrapper, container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ImageMultiLayerTransformOverlay
          doc={initialDoc}
          plan={resolveMultiLayerTransformParticipants(initialDoc)}
          requestRender={() => undefined}
          wrapperRef={{ current: wrapper }}
        />,
      );
    });
    const pivot = container.querySelector<HTMLButtonElement>('[data-image-multi-layer-pivot-handle="true"]')!;
    act(() => {
      dispatchPointerEvent(pivot, 'pointerdown', { clientX: 100, clientY: 50, pointerId: 18 });
      dispatchPointerEvent(pivot, 'pointermove', { clientX: 200, clientY: 50, pointerId: 18 });
      dispatchPointerEvent(pivot, 'pointerup', { clientX: 200, clientY: 50, pointerId: 18 });
    });
    expect(pivot.style.left).toBe('200px');

    const translatedDoc = {
      ...initialDoc,
      layers: initialDoc.layers.map((candidate) => ({ ...candidate, x: candidate.x + 400 })),
    };
    useImageEditorStore.setState({ documents: [translatedDoc], activeDocId: translatedDoc.id });
    act(() => {
      root.render(
        <ImageMultiLayerTransformOverlay
          doc={translatedDoc}
          plan={resolveMultiLayerTransformParticipants(translatedDoc)}
          requestRender={() => undefined}
          wrapperRef={{ current: wrapper }}
        />,
      );
    });

    expect(container.querySelector<HTMLButtonElement>('[data-image-multi-layer-pivot-handle="true"]')?.style.left).toBe('100px');

    act(() => root.unmount());
    container.remove();
    wrapper.remove();
  });

  it('does not resurrect a dragged shared pivot after selecting away and back', () => {
    const first = imageLayer({ id: 'layer-1', name: 'Layer 1', x: 0, y: 0, bitmap: bitmap(100, 100) });
    const second = imageLayer({ id: 'layer-2', name: 'Layer 2', x: 100, y: 0, bitmap: bitmap(100, 100) });
    const distant = imageLayer({ id: 'layer-3', name: 'Layer 3', x: 500, y: 300, bitmap: bitmap(100, 100) });
    const initialDoc = imageDoc(first);
    initialDoc.layers = [first, second, distant];
    initialDoc.selectedLayerIds = ['layer-1', 'layer-2'];
    useImageEditorStore.getState().openDocument(initialDoc);

    const wrapper = document.createElement('div');
    wrapper.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
      toJSON: () => ({}),
    });
    const container = document.createElement('div');
    document.body.append(wrapper, container);
    const root = createRoot(container);
    const renderOverlay = (doc: ImageDocument) => {
      root.render(
        <ImageMultiLayerTransformOverlay
          doc={doc}
          plan={resolveMultiLayerTransformParticipants(doc)}
          requestRender={() => undefined}
          wrapperRef={{ current: wrapper }}
        />,
      );
    };

    act(() => renderOverlay(initialDoc));
    const pivot = container.querySelector<HTMLButtonElement>('[data-image-multi-layer-pivot-handle="true"]')!;
    act(() => {
      dispatchPointerEvent(pivot, 'pointerdown', { clientX: 100, clientY: 50, pointerId: 19 });
      dispatchPointerEvent(pivot, 'pointermove', { clientX: 200, clientY: 50, pointerId: 19 });
      dispatchPointerEvent(pivot, 'pointerup', { clientX: 200, clientY: 50, pointerId: 19 });
    });
    expect(pivot.style.left).toBe('200px');

    const widenedDoc = { ...initialDoc, selectedLayerIds: ['layer-1', 'layer-2', 'layer-3'] };
    act(() => renderOverlay(widenedDoc));
    const returnedDoc = { ...initialDoc, selectedLayerIds: ['layer-1', 'layer-2'] };
    act(() => renderOverlay(returnedDoc));

    expect(container.querySelector<HTMLButtonElement>('[data-image-multi-layer-pivot-handle="true"]')?.style.left).toBe('100px');

    act(() => root.unmount());
    container.remove();
    wrapper.remove();
  });

  it('renders the apply and cancel actions for a pending multi-layer transform session', () => {
    const first = imageLayer({ id: 'layer-1', name: 'Layer 1', x: 24, y: 32 });
    const second = imageLayer({ id: 'layer-2', name: 'Layer 2', x: 220, y: 140, bitmap: bitmap(90, 70) });
    const doc = imageDoc(first);
    doc.layers = [first, second];
    doc.selectedLayerIds = ['layer-1', 'layer-2'];
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('move');
    beginMultiLayerTransformPreviewSession(doc, ['layer-1', 'layer-2']);
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', { rotationDeg: 20 });

    const html = renderToStaticMarkup(<ImageEditorCanvas />);

    expect(html).toContain('data-image-transform-actions="true"');
    expect(html).toContain('title="Apply transform"');
    expect(html).toContain('title="Cancel transform"');

    clearTransformPreviewSession();
  });

  it('renders the warp control-point mesh for the active layer transform mode', () => {
    const layer = imageLayer();
    const doc = imageDoc(layer);
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('move');
    beginTransformPreviewSession(doc, layer);
    setTransformPreviewMode(doc.id, 'warp');
    const warpHtml = renderToStaticMarkup(<ImageEditorCanvas />);

    // Warp mode shows the full NxN control-point mesh (cage grid + draggable nodes),
    // including the four corners and an interior control point.
    expect(warpHtml).toContain('data-image-layer-warp-mesh-grid="true"');
    expect(warpHtml).toContain('data-image-layer-warp-mesh-handle="0-0"');
    expect(warpHtml).toContain('data-image-layer-warp-mesh-handle="3-3"');
    expect(warpHtml).toContain('data-image-layer-warp-mesh-handle="1-1"');
    expect(warpHtml).toContain('aria-label="Puppet mesh pin 1,1"');
  });

  it('renders visible apply and cancel controls for an active crop preview', () => {
    const doc = imageDoc(imageLayer());

    const html = renderToStaticMarkup(
      <ImageCropActionOverlay
        onApply={() => undefined}
        onCancel={() => undefined}
        preview={{ x: 40, y: 50, w: 140, h: 110 }}
        viewport={doc.viewport}
      />,
    );

    expect(html).toContain('data-image-crop-actions="true"');
    expect(html).toContain('title="Apply crop"');
    expect(html).toContain('title="Cancel crop"');
  });

  it('uses crop tool settings when the floating crop apply button commits the preview', async () => {
    const originalMask = bitmap(180, 120);
    const layer = imageLayer({
      x: 40,
      y: 55,
      bitmapVersion: 7,
      mask: originalMask,
    });
    const doc = imageDoc(layer);
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('crop');
    useImageEditorStore.getState().setCropToolSettings({
      ...DEFAULT_CROP_TOOL_SETTINGS,
      deleteCroppedPixels: true,
      rotationDeg: 15,
    });

    const state = useImageEditorStore.getState();
    const env = {
      doc,
      activeLayer: layer,
      brushSettings: DEFAULT_BRUSH_SETTINGS,
      cropToolSettings: state.cropToolSettings,
      gradientToolSettings: DEFAULT_GRADIENT_TOOL_SETTINGS,
      selectionToolSettings: DEFAULT_SELECTION_TOOL_SETTINGS,
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: state.pushOperation,
      store: state,
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
    } satisfies ToolEnv;
    cropTool.onPointerDown?.(env, { x: 25, y: 30 }, { shift: false, alt: false, ctrl: false, meta: false }, new MouseEvent('pointerdown') as unknown as PointerEvent);
    cropTool.onPointerMove?.(env, { x: 105, y: 70 }, { shift: false, alt: false, ctrl: false, meta: false }, new MouseEvent('pointermove') as unknown as PointerEvent);

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<ImageEditorCanvas />);
    });

    const applyButton = container.querySelector('[title="Apply crop"]') as HTMLButtonElement | null;
    expect(applyButton).not.toBeNull();

    await act(async () => {
      applyButton?.click();
    });

    const committedLayer = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(committedLayer).toMatchObject({
      x: 0,
      y: 0,
      bitmapVersion: 8,
      mask: null,
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('commits rectangular high-bit crop authority and matching mask from the crop UI', async () => {
    const pixels = createPixelBuffer({ width: 180, height: 120, depth: 'u16' });
    pixels.data.fill(2222);
    const layer = imageLayer({ x: 40, y: 55, pixels, mask: bitmap(180, 120), pixelsVersion: 3 });
    const doc = { ...imageDoc(layer), metadata: { bitDepth: 16 as const } };
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('crop');
    useImageEditorStore.getState().setCropToolSettings({
      ...DEFAULT_CROP_TOOL_SETTINGS,
      deleteCroppedPixels: true,
      rotationDeg: 0,
    });

    const state = useImageEditorStore.getState();
    const env = {
      doc,
      activeLayer: layer,
      brushSettings: DEFAULT_BRUSH_SETTINGS,
      cropToolSettings: state.cropToolSettings,
      gradientToolSettings: DEFAULT_GRADIENT_TOOL_SETTINGS,
      selectionToolSettings: DEFAULT_SELECTION_TOOL_SETTINGS,
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: state.pushOperation,
      store: state,
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
    } satisfies ToolEnv;
    cropTool.onPointerDown?.(env, { x: 65, y: 85 }, { shift: false, alt: false, ctrl: false, meta: false }, new MouseEvent('pointerdown') as unknown as PointerEvent);
    cropTool.onPointerMove?.(env, { x: 145, y: 125 }, { shift: false, alt: false, ctrl: false, meta: false }, new MouseEvent('pointermove') as unknown as PointerEvent);

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    await act(async () => root.render(<ImageEditorCanvas />));
    const applyButton = container.querySelector('[title="Apply crop"]') as HTMLButtonElement | null;
    expect(applyButton).not.toBeNull();
    await act(async () => applyButton?.click());

    const committed = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(committed?.pixels).toMatchObject({ width: 80, height: 40, depth: 'u16' });
    expect(committed?.bitmap).toMatchObject({ width: 80, height: 40 });
    expect(committed?.mask).toMatchObject({ width: 80, height: 40 });
    expect(committed?.pixelsVersion).toBe(4);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.[0]).toMatchObject({ kind: 'docResize' });

    await act(async () => root.unmount());
    container.remove();
  });

  it('refuses Apply when an open rectangular crop preview enters native CMYK', async () => {
    const layer = imageLayer({ x: 40, y: 55 });
    const rgbDoc = imageDoc(layer);
    useImageEditorStore.getState().openDocument(rgbDoc);
    useImageEditorStore.getState().setTool('crop');
    const state = useImageEditorStore.getState();
    const env = {
      doc: rgbDoc,
      activeLayer: layer,
      brushSettings: DEFAULT_BRUSH_SETTINGS,
      cropToolSettings: state.cropToolSettings,
      gradientToolSettings: DEFAULT_GRADIENT_TOOL_SETTINGS,
      selectionToolSettings: DEFAULT_SELECTION_TOOL_SETTINGS,
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: state.pushOperation,
      store: state,
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace' as const,
    } satisfies ToolEnv;
    cropTool.onPointerDown?.(env, { x: 65, y: 85 }, { shift: false, alt: false, ctrl: false, meta: false }, new MouseEvent('pointerdown') as unknown as PointerEvent);
    cropTool.onPointerMove?.(env, { x: 145, y: 125 }, { shift: false, alt: false, ctrl: false, meta: false }, new MouseEvent('pointermove') as unknown as PointerEvent);

    const authority = createImageCmykPixelBuffer(180, 120, new Uint8Array(180 * 120 * 5).fill(37));
    useImageEditorStore.setState((current) => ({
      documents: current.documents.map((document) => document.id === rgbDoc.id ? {
        ...document,
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
        layers: document.layers.map((candidate) => candidate.id === layer.id ? { ...candidate, cmykPixels: authority } : candidate),
      } : document),
    }));

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    try {
      await act(async () => root.render(<ImageEditorCanvas />));
      const applyButton = container.querySelector('[title="Apply crop"]') as HTMLButtonElement | null;
      expect(applyButton).not.toBeNull();
      await act(async () => applyButton?.click());

      const current = useImageEditorStore.getState().getActiveDocument();
      expect(current?.width).toBe(rgbDoc.width);
      expect(current?.height).toBe(rgbDoc.height);
      expect(current?.layers[0]?.cmykPixels).toBe(authority);
      expect(current?.layers[0]?.bitmap).toMatchObject({ width: 180, height: 120 });
      expect(useImageEditorStore.getState().undoStacks[rgbDoc.id]).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('renders visible apply and cancel controls for a pending transform preview', () => {
    const html = renderToStaticMarkup(
      <ImageTransformActionOverlay
        bounds={{ x: 40, y: 50, width: 140, height: 110, rotationDeg: 12 }}
        onApply={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(html).toContain('data-image-transform-actions="true"');
    expect(html).toContain('title="Apply transform"');
    expect(html).toContain('title="Cancel transform"');
  });

  it('renders selection transform preview bounds and action controls when a selection session is active', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-selection-overlay',
      title: 'Selection Overlay',
      width: 10,
      height: 10,
    });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('move');
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    beginSelectionTransformSession(doc.id);

    const html = renderToStaticMarkup(<ImageEditorCanvas />);

    expect(html).toContain('data-image-selection-transform-overlay="true"');
    expect(html).toContain('data-image-selection-transform-body="true"');
    expect(html).toContain('data-image-selection-transform-handle="nw"');
    expect(html).toContain('data-image-selection-transform-handle="n"');
    expect(html).toContain('data-image-selection-transform-handle="e"');
    expect(html).toContain('data-image-selection-transform-handle="s"');
    expect(html).toContain('data-image-selection-transform-handle="w"');
    expect(html).toContain('data-image-selection-transform-handle="se"');
    expect(html).toContain('data-image-selection-transform-rotate-handle="true"');
    expect(html).toContain('aria-label="Rotate selection"');
    expect(html).toContain('data-image-selection-transform-rotation-preview="true"');
    expect(html).toContain('data-image-selection-transform-actions="true"');
    expect(html).toContain('title="Apply selection transform"');
    expect(html).toContain('title="Cancel selection transform"');
  });

  it('renders direct skew and distort handles for the active selection transform mode', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-selection-overlay-modes',
      title: 'Selection Overlay Modes',
      width: 10,
      height: 10,
    });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('move');
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    beginSelectionTransformSession(doc.id);
    setSelectionTransformMode(doc.id, 'skew');
    const skewHtml = renderToStaticMarkup(<ImageEditorCanvas />);
    setSelectionTransformMode(doc.id, 'distort');
    const distortHtml = renderToStaticMarkup(<ImageEditorCanvas />);

    expect(skewHtml).toContain('data-image-selection-transform-skew-handle="n"');
    expect(skewHtml).toContain('data-image-selection-transform-skew-handle="e"');
    expect(skewHtml).toContain('data-image-selection-transform-skew-handle="s"');
    expect(skewHtml).toContain('data-image-selection-transform-skew-handle="w"');
    expect(distortHtml).toContain('data-image-selection-transform-distort-handle="nw"');
    expect(distortHtml).toContain('data-image-selection-transform-distort-handle="ne"');
    expect(distortHtml).toContain('data-image-selection-transform-distort-handle="se"');
    expect(distortHtml).toContain('data-image-selection-transform-distort-handle="sw"');
  });

  it('opens the on-canvas text editor when the Type tool requests a pending edit', async () => {
    const textLayer = imageLayer({
      id: 'text-layer-1',
      type: 'text',
      bitmap: bitmap(80, 30),
      text: normalizeImageTextStyle({ content: 'Hello' }),
      metadata: { editableText: true },
    });
    useImageEditorStore.getState().openDocument(imageDoc(textLayer));
    useImageEditorStore.getState().setTool('text');
    // The Type tool sets this after dropping a new layer; the canvas should
    // consume it, open the editor, and clear it.
    useImageEditorStore.getState().setPendingTextEditLayerId('text-layer-1');

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<ImageEditorCanvas />);
    });

    expect(container.querySelector('[data-image-text-edit-overlay="true"]')).not.toBeNull();
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(useImageEditorStore.getState().pendingTextEditLayerId).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('discards a freshly-placed text layer when its editor is cancelled empty', async () => {
    const textLayer = imageLayer({
      id: 'text-layer-fresh',
      type: 'text',
      bitmap: bitmap(80, 30),
      text: normalizeImageTextStyle({ content: '' }),
      metadata: { editableText: true, freshlyPlaced: true },
    });
    useImageEditorStore.getState().openDocument(imageDoc(textLayer));
    useImageEditorStore.getState().setTool('text');
    useImageEditorStore.getState().setPendingTextEditLayerId('text-layer-fresh');

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<ImageEditorCanvas />);
    });

    const cancelButton = container.querySelector('[title="Cancel text edit"]') as HTMLButtonElement | null;
    expect(cancelButton).not.toBeNull();

    await act(async () => {
      cancelButton?.click();
    });

    // The empty, freshly-placed layer is removed rather than left behind.
    const doc = useImageEditorStore.getState().getActiveDocument();
    expect(doc?.layers.some((layer) => layer.id === 'text-layer-fresh')).toBe(false);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders perspective crop action controls bound to the live quad session', async () => {
    useImageEditorStore.getState().openDocument(imageDoc(imageLayer()));
    useImageEditorStore.getState().setTool('crop');
    useImageEditorStore.getState().setCropToolSettings({ mode: 'perspective' });
    seedPerspectiveCropQuadFromDocument(useImageEditorStore.getState().getActiveDocument()!);

    const html = renderToStaticMarkup(<ImageEditorCanvas />);

    expect(html).toContain('data-image-perspective-crop-actions="true"');
    expect(html).toContain('title="Apply perspective crop"');
    expect(html).toContain('title="Cancel perspective crop"');
    // The live output size label is derived from the document-sized quad.
    expect(html).toContain('640 × 480px');
    clearPerspectiveCropPreview();
  });

  it.each([90, 270, 37])('anchors perspective crop actions to the rotated %s-degree quad without mutating the document', (rotationDeg) => {
    const view = { width: 400, height: 300 };
    const doc = {
      ...imageDoc(imageLayer()),
      width: view.width,
      height: view.height,
      viewport: { zoom: 1, panX: 0, panY: 0, rotationDeg },
    };
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setTool('crop');
    useImageEditorStore.getState().setCropToolSettings({ mode: 'perspective' });
    useImageEditorStore.getState().setViewportContainerSize(view);
    seedPerspectiveCropQuadFromDocument(useImageEditorStore.getState().getActiveDocument()!);

    const before = JSON.stringify({
      layers: useImageEditorStore.getState().getActiveDocument()?.layers,
      undo: useImageEditorStore.getState().undoStacks[doc.id] ?? [],
    });
    const html = renderToStaticMarkup(<ImageEditorCanvas />);
    const actionStyle = html.match(/data-image-perspective-crop-actions="true"[^>]*style="([^"]+)"/)?.[1] ?? '';
    const corners = [
      { x: 0, y: 0 }, { x: view.width, y: 0 }, { x: view.width, y: view.height }, { x: 0, y: view.height },
    ].map((point) => docToScreen(point, doc.viewport, view));
    const minX = Math.min(...corners.map((point) => point.x));
    const minY = Math.min(...corners.map((point) => point.y));
    const maxY = Math.max(...corners.map((point) => point.y));
    const expectedLeft = Math.max(8, minX);
    const expectedTop = minY >= 42 ? minY - 38 : maxY + 8;

    expect(actionStyle).toContain(`left:${expectedLeft}px`);
    expect(actionStyle).toContain(`top:${expectedTop}px`);
    expect(JSON.stringify({
      layers: useImageEditorStore.getState().getActiveDocument()?.layers,
      undo: useImageEditorStore.getState().undoStacks[doc.id] ?? [],
    })).toBe(before);
    clearPerspectiveCropPreview();
  });

  it('applies the perspective quad through the store from the overlay button', async () => {
    useImageEditorStore.getState().openDocument(imageDoc(imageLayer()));
    useImageEditorStore.getState().setTool('crop');
    useImageEditorStore.getState().setCropToolSettings({ mode: 'perspective' });
    const docId = useImageEditorStore.getState().activeDocId!;
    seedPerspectiveCropQuadFromDocument(useImageEditorStore.getState().getActiveDocument()!);

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<ImageEditorCanvas />);
    });

    const applyButton = container.querySelector('[title="Apply perspective crop"]') as HTMLButtonElement | null;
    expect(applyButton).not.toBeNull();
    expect(applyButton?.disabled).toBe(false);

    await act(async () => {
      applyButton?.click();
    });

    const committed = useImageEditorStore.getState().documents.find((d) => d.id === docId);
    expect(committed?.layers).toHaveLength(1);
    expect(committed?.layers[0].name).toBe('Perspective Crop');
    expect(useImageEditorStore.getState().undoStacks[docId]).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[docId][0]).toMatchObject({ kind: 'docResize' });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('cancels the perspective quad from the overlay button without touching the document', async () => {
    useImageEditorStore.getState().openDocument(imageDoc(imageLayer()));
    useImageEditorStore.getState().setTool('crop');
    useImageEditorStore.getState().setCropToolSettings({ mode: 'perspective' });
    const docId = useImageEditorStore.getState().activeDocId!;
    seedPerspectiveCropQuadFromDocument(useImageEditorStore.getState().getActiveDocument()!);

    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<ImageEditorCanvas />);
    });

    const cancelButton = container.querySelector('[title="Cancel perspective crop"]') as HTMLButtonElement | null;
    expect(cancelButton).not.toBeNull();

    await act(async () => {
      cancelButton?.click();
    });

    expect(getPerspectiveCropPreview()).toBeNull();
    const unchanged = useImageEditorStore.getState().documents.find((d) => d.id === docId);
    expect(unchanged?.layers).toHaveLength(1);
    expect(unchanged?.layers[0].id).toBe('layer-1');
    expect(useImageEditorStore.getState().undoStacks[docId]).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('disables apply and explains why for an editable Tiltmark surface document', async () => {
    useImageEditorStore.getState().openDocument(imageDoc(imageLayer({
      metadata: { tiltmark: { schemaVersion: 1, role: 'surface' } },
    })));
    useImageEditorStore.getState().setTool('crop');
    useImageEditorStore.getState().setCropToolSettings({ mode: 'perspective' });
    const doc = useImageEditorStore.getState().getActiveDocument()!;
    // Starting an interaction on a Tiltmark doc records the refusal for the overlay.
    const state = useImageEditorStore.getState();
    const env = {
      doc,
      activeLayer: null,
      brushSettings: state.brushSettings,
      cropToolSettings: state.cropToolSettings,
      selectionToolSettings: state.selectionToolSettings,
      screenToDoc: (point: { x: number; y: number }) => point,
      docToScreen: (point: { x: number; y: number }) => point,
      pushOperation: state.pushOperation,
      store: state,
      requestRender: vi.fn(),
      resolveSelectionMode: () => 'replace',
    } satisfies ToolEnv;
    cropTool.onPointerDown?.(
      env,
      { x: 10, y: 10 },
      { shift: false, alt: false, ctrl: false, meta: false },
      new MouseEvent('pointerdown') as unknown as PointerEvent,
    );

    const html = renderToStaticMarkup(<ImageEditorCanvas />);
    expect(html).toContain('data-image-perspective-crop-actions="true"');
    expect(html).toContain('Convert to Raster');
    const applyButton = html.match(/title="Apply perspective crop"/);
    expect(applyButton).not.toBeNull();
    clearPerspectiveCropPreview();
  });
});
