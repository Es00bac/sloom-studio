// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { DEFAULT_SHAPE_TOOL_SETTINGS, type ImageLayer, type LayerBitmap } from '../../types/imageEditor';
import { getBitmapImageData } from './LayerBitmap';
import { buildVectorPathLayer, buildVectorShapeLayerFromDrag, getVectorPathDocumentPoints } from './ImageVectorShape';
import { attachVectorMaskToLayer, getLayerVectorMaskDescriptor } from './ImageVectorMasks';
import { maskBoundingBox } from './SelectionMask';
import { clearAllSelections, getSelection } from './selectionRegistry';
import { ImageEditorPathsPanel } from './ImageEditorPathsPanel';
import { redo, undo } from './undoRedoApply';

class FakeOffscreenCanvasContext {
  private imageData = makeImageData(1, 1);

  beginPath() {}
  rect() {}
  ellipse() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  closePath() {}
  fill() {}
  stroke() {}
  clearRect() {}
  fillRect() {}
  drawImage() {}
  save() {}
  restore() {}
  getImageData() {
    return {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }
  createImageData(width: number, height: number) {
    return makeImageData(width, height);
  }
  putImageData(imageData: ImageData) {
    this.imageData = {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    } as ImageData;
  }
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

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function makeVectorLayer(doc = createEmptyImageDocument({ id: 'doc-paths-panel', title: 'Paths', width: 220, height: 180 })) {
  return buildVectorShapeLayerFromDrag({
    doc,
    kind: 'rect',
    from: { x: 20, y: 24 },
    to: { x: 80, y: 66 },
    settings: DEFAULT_SHAPE_TOOL_SETTINGS,
    existingLayer: null,
  }) as ImageLayer;
}

function makeImageLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'photo',
    name: 'Photo',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(120, 90) as LayerBitmap,
    bitmapVersion: 2,
    mask: null,
    ...overrides,
  };
}

function makePathLayer(doc = createEmptyImageDocument({ id: 'doc-pen-paths-panel', title: 'Paths', width: 220, height: 180 })) {
  return buildVectorPathLayer({
    doc,
    points: [
      { x: 18, y: 22 },
      { x: 92, y: 22 },
      { x: 92, y: 84 },
    ],
    closed: false,
    settings: DEFAULT_SHAPE_TOOL_SETTINGS,
  }) as ImageLayer;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function alphaAt(bitmap: LayerBitmap, x: number, y: number): number {
  return getBitmapImageData(bitmap).data[(y * bitmap.width + x) * 4 + 3] ?? 0;
}

describe('ImageEditorPathsPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: vi.fn((kind: string) => (kind === '2d' ? new FakeOffscreenCanvasContext() : null)),
    });
    clearAllSelections();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
      shapeToolSettings: {
        ...DEFAULT_SHAPE_TOOL_SETTINGS,
        fillColor: '#f97316',
        fillOpacity: 0.85,
        strokeColor: '#22d3ee',
        strokeOpacity: 0.9,
        strokeWidth: 6,
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearAllSelections();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders vector shape paths and loads the selected path into the document selection', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-load', title: 'Paths', width: 220, height: 180 });
    const pathLayer = makeVectorLayer(doc);
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    expect(container.textContent).toContain(pathLayer.name);

    const loadButton = container.querySelector<HTMLButtonElement>('button[aria-label="Load selected path as selection"]');
    expect(loadButton).not.toBeNull();

    act(() => {
      loadButton?.click();
    });

    expect(maskBoundingBox(getSelection(doc.id)!)).toEqual({
      x: pathLayer.x,
      y: pathLayer.y,
      width: pathLayer.bitmap?.width ?? 0,
      height: pathLayer.bitmap?.height ?? 0,
    });
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: doc.id,
    });
  });

  it('renames the selected path and creates fill/stroke vector layers as undoable operations', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-edit', title: 'Paths', width: 220, height: 180 });
    const pathLayer = makeVectorLayer(doc);
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="Selected path name"]');
    const renameButton = container.querySelector<HTMLButtonElement>('button[aria-label="Apply selected path name"]');
    const fillButton = container.querySelector<HTMLButtonElement>('button[aria-label="Create fill layer from selected path"]');
    const strokeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Create stroke layer from selected path"]');

    expect(nameInput).not.toBeNull();
    expect(renameButton).not.toBeNull();
    expect(fillButton).not.toBeNull();
    expect(strokeButton).not.toBeNull();

    act(() => {
      setInputValue(nameInput!, 'Panel Silhouette');
      renameButton?.click();
    });

    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.name).toBe('Panel Silhouette');

    act(() => {
      fillButton?.click();
      strokeButton?.click();
    });

    const layers = useImageEditorStore.getState().getActiveDocument()?.layers ?? [];
    expect(layers.map((layer) => layer.name)).toEqual(
      expect.arrayContaining(['Panel Silhouette', 'Panel Silhouette Fill', 'Panel Silhouette Stroke']),
    );
    expect(layers.find((layer) => layer.name === 'Panel Silhouette Fill')?.metadata?.vectorShape).toMatchObject({
      fillColor: '#f97316',
      strokeWidth: 0,
    });
    expect(layers.find((layer) => layer.name === 'Panel Silhouette Stroke')?.metadata?.vectorShape).toMatchObject({
      fillOpacity: 0,
      strokeColor: '#22d3ee',
      strokeWidth: 6,
    });
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });
  });

  it('labels retained pen layers as path entries instead of rectangle/ellipse entries', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-kind', title: 'Paths', width: 220, height: 180 });
    const pathLayer = {
      ...makePathLayer(doc),
      name: 'Ink Contour',
    };
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const row = container.querySelector<HTMLButtonElement>('button[aria-label="Select path Ink Contour"]');
    expect(row?.textContent).toContain('path');
  });

  it('renders a ready canvas thumbnail for layer-backed paths in the list', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-list-thumbnails', title: 'Paths', width: 220, height: 180 });
    const pathLayer = makeVectorLayer(doc);
    pathLayer.name = 'Vector Thumbnail';
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const row = container.querySelector<HTMLButtonElement>('button[aria-label="Select path Vector Thumbnail"]');
    expect(row).not.toBeNull();
    const thumbnail = row?.querySelector<HTMLCanvasElement>('canvas[aria-label="Path thumbnail Vector Thumbnail"]');
    expect(thumbnail).not.toBeNull();
  });

  it('surfaces Paths panel visibility status from the readiness descriptor', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-visibility', title: 'Paths', width: 220, height: 180 });
    const pathLayer = makeVectorLayer(doc);
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    expect(container.querySelector('[aria-label="Paths panel visibility"]')?.textContent).toBe('visible');
  });

  it('edits retained pen path points from the Paths panel as undoable layer operations', () => {
    const doc = createEmptyImageDocument({ id: 'doc-edit-path-points-panel', title: 'Paths', width: 220, height: 180 });
    const pathLayer = {
      ...makePathLayer(doc),
      name: 'Editable Route',
    };
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const point2X = container.querySelector<HTMLInputElement>('input[aria-label="Path point 2 X"]');
    const point2Y = container.querySelector<HTMLInputElement>('input[aria-label="Path point 2 Y"]');
    expect(point2X).not.toBeNull();
    expect(point2Y).not.toBeNull();
    expect(point2X?.value).toBe('92');
    expect(point2Y?.value).toBe('22');

    act(() => {
      setInputValue(point2X!, '126');
      point2X?.blur();
    });
    act(() => {
      setInputValue(point2Y!, '54');
      point2Y?.blur();
    });

    const editedLayer = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(editedLayer ? getVectorPathDocumentPoints(editedLayer) : []).toEqual([
      { x: 18, y: 22 },
      { x: 126, y: 54 },
      { x: 92, y: 84 },
    ]);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });
  });

  it('adds and deletes retained pen path anchors from the Paths panel', () => {
    const doc = createEmptyImageDocument({ id: 'doc-add-delete-path-points-panel', title: 'Path Point Structure', width: 220, height: 180 });
    const pathLayer = {
      ...makePathLayer(doc),
      name: 'Structure Route',
    };
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const point2Button = container.querySelector<HTMLButtonElement>('button[aria-label="Select anchor P2"]');
    expect(point2Button).not.toBeNull();

    act(() => {
      point2Button?.click();
    });

    const addButton = container.querySelector<HTMLButtonElement>('button[aria-label="Add anchor after selected point"]');
    const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Delete selected anchor point"]');
    expect(addButton).not.toBeNull();
    expect(deleteButton).not.toBeNull();

    act(() => {
      addButton?.click();
    });

    let editedLayer = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(editedLayer ? getVectorPathDocumentPoints(editedLayer) : []).toEqual([
      { x: 18, y: 22 },
      { x: 92, y: 22 },
      { x: 92, y: 53 },
      { x: 92, y: 84 },
    ]);
    expect(container.querySelector('[aria-label="Selected path anchor session"]')?.textContent).toBe('P3 ready');
    expect(container.textContent).toContain('4 anchors');

    act(() => {
      deleteButton?.click();
    });

    editedLayer = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(editedLayer ? getVectorPathDocumentPoints(editedLayer) : []).toEqual([
      { x: 18, y: 22 },
      { x: 92, y: 22 },
      { x: 92, y: 84 },
    ]);
    expect(container.querySelector('[aria-label="Selected path anchor session"]')?.textContent).toBe('P2 ready');
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(2);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });
  });

  it('surfaces retained anchor readiness, handoff caveats, and the panel signature for selected path entries', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-panel-readiness-copy', title: 'Path Readiness', width: 220, height: 180 });
    const pathLayer = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 18, y: 22 },
          { x: 92, y: 22 },
          { x: 92, y: 84 },
          { x: 18, y: 84 },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      name: 'Readiness Route',
    };
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    expect(container.textContent).toContain('Retained anchors ready');
    expect(container.textContent).toContain('Bezier handles editable');
    expect(container.textContent).toContain('Boolean combine uses separate vector layers');
    expect(container.textContent).toContain('Rasterize flattens retained path editing');
    expect(container.textContent).toContain('SVG export flattens path appearance; keep .slimg for editable paths');
    expect(container.textContent).toContain('PSD keeps layer-backed paths only');
    expect(container.querySelector('[data-paths-panel-signature]')?.getAttribute('data-paths-panel-signature')).toContain(
      'image-paths-panel-readiness:v1:',
    );
  });

  it('surfaces the active anchor edit session and selected anchor readiness in the panel', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-anchor-session-panel', title: 'Anchor Session Panel', width: 220, height: 180 });
    const pathLayer = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 18, y: 22 },
          { x: 92, y: 22 },
          { x: 92, y: 84 },
          { x: 18, y: 84 },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      id: 'panel-anchor-path',
      name: 'Panel Anchor Session',
    };
    doc.layers = [pathLayer];
    doc.activeLayerId = pathLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const panel = container.querySelector<HTMLElement>('[data-path-anchor-session-signature]');
    const point3Button = container.querySelector<HTMLButtonElement>('button[aria-label="Select anchor P3"]');
    expect(panel?.getAttribute('data-path-anchor-session-signature')).toContain('image-path-anchor-edit-session:v1:');
    expect(container.querySelector('[aria-label="Selected path anchor session"]')?.textContent).toBe('P1 ready');

    act(() => {
      point3Button?.click();
    });

    expect(container.querySelector('[aria-label="Selected path anchor session"]')?.textContent).toBe('P3 ready');
    expect(panel?.getAttribute('data-path-anchor-session-signature')).toContain('"activeAnchorIndex":2');
    expect(container.textContent).toContain('Move/nudge ready');
    expect(container.textContent).toContain('Convert anchor ready (corner)');
    expect(container.textContent).toContain('Bezier handles editable');
  });

  it('selects whole paths and direct anchors, then retains curvature edits across undo, redo, and reopen', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-direct-edit', title: 'Direct Path Edit', width: 220, height: 180 });
    const pathLayer = {
      ...makePathLayer(doc),
      id: 'direct-edit-path',
      name: 'Direct Edit Route',
    };
    doc.layers = [pathLayer];
    doc.activeLayerId = null;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const pathButton = container.querySelector<HTMLButtonElement>('button[aria-label="Select path Direct Edit Route"]');
    const directEdit = container.querySelector<HTMLButtonElement>('button[aria-label="Directly edit selected path anchor"]');
    const curvaturePen = container.querySelector<HTMLButtonElement>('button[aria-label="Use Curvature Pen for retained path"]');
    const smooth = container.querySelector<HTMLButtonElement>('button[aria-label="Convert selected anchor to smooth"]');
    expect(pathButton).not.toBeNull();
    expect(directEdit).not.toBeNull();
    expect(curvaturePen).not.toBeNull();
    expect(smooth).not.toBeNull();

    act(() => {
      pathButton?.click();
      directEdit?.click();
    });
    expect(useImageEditorStore.getState().getActiveDocument()?.activeLayerId).toBe(pathLayer.id);
    expect(useImageEditorStore.getState().tool).toBe('pen');
    expect(container.querySelector('[data-path-selection-active]')?.getAttribute('data-path-selection-active')).toBe(pathLayer.id);

    act(() => {
      curvaturePen?.click();
      smooth?.click();
    });
    const afterSmooth = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(afterSmooth ? getVectorPathDocumentPoints(afterSmooth)[0] : null).toMatchObject({
      outHandle: { x: 43, y: 22 },
    });
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({ kind: 'layerOp', docId: doc.id });

    act(() => {
      expect(undo(doc.id)).toBe(true);
    });
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]
      ? getVectorPathDocumentPoints(useImageEditorStore.getState().getActiveDocument()!.layers[0])[0]?.outHandle
      : null).toBeUndefined();
    act(() => {
      expect(redo(doc.id)).toBe(true);
    });
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]
      ? getVectorPathDocumentPoints(useImageEditorStore.getState().getActiveDocument()!.layers[0])[0]?.outHandle
      : null).toEqual({ x: 43, y: 22 });

    const snapshot = useImageEditorStore.getState().exportProjectSnapshot();
    act(() => {
      useImageEditorStore.getState().restoreProjectSnapshot(snapshot);
    });
    const reopened = useImageEditorStore.getState().getActiveDocument()?.layers[0];
    expect(reopened ? getVectorPathDocumentPoints(reopened)[0]?.outHandle : null).toEqual({ x: 43, y: 22 });
  });

  it('creates a layer mask on the active layer from the selected path as an undoable operation', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-layer-mask-panel', title: 'Path Mask', width: 220, height: 180 });
    const photoLayer = makeImageLayer({
      x: 10,
      y: 20,
      bitmap: new OffscreenCanvas(120, 90) as LayerBitmap,
    });
    const pathLayer = makeVectorLayer(doc);
    doc.layers = [photoLayer, pathLayer];
    doc.activeLayerId = photoLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const createMaskButton = container.querySelector<HTMLButtonElement>('button[aria-label="Create layer mask from selected path"]');
    expect(createMaskButton).not.toBeNull();

    act(() => {
      createMaskButton?.click();
    });

    const editedDoc = useImageEditorStore.getState().getActiveDocument();
    const maskedLayer = editedDoc?.layers.find((layer) => layer.id === photoLayer.id);
    expect(maskedLayer?.mask).not.toBeNull();
    expect(maskedLayer?.bitmapVersion).toBe(photoLayer.bitmapVersion + 1);
    expect(editedDoc?.activeLayerId).toBe(photoLayer.id);
    expect(editedDoc?.activeLayerEditTarget).toBe('mask');
    expect(maskedLayer?.mask?.width).toBe(120);
    expect(maskedLayer?.mask?.height).toBe(90);
    expect(alphaAt(maskedLayer!.mask!, 9, 4)).toBe(0);
    expect(alphaAt(maskedLayer!.mask!, 10, 4)).toBe(255);
    expect(alphaAt(maskedLayer!.mask!, 69, 45)).toBe(255);
    expect(alphaAt(maskedLayer!.mask!, 70, 46)).toBe(0);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });
  });

  it('creates a retained vector mask on the active layer from the selected path as an undoable operation', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-vector-mask-panel', title: 'Path Vector Mask', width: 220, height: 180 });
    const photoLayer = makeImageLayer({
      id: 'portrait',
      name: 'Portrait',
      x: 10,
      y: 20,
      bitmap: new OffscreenCanvas(120, 90) as LayerBitmap,
    });
    const pathLayer = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 18, y: 22 },
          { x: 92, y: 22 },
          { x: 92, y: 84 },
          { x: 18, y: 84 },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      name: 'Mask Route',
    };
    doc.layers = [photoLayer, pathLayer];
    doc.activeLayerId = photoLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const createVectorMaskButton = container.querySelector<HTMLButtonElement>('button[aria-label="Create vector mask from selected path"]');
    expect(createVectorMaskButton).not.toBeNull();

    act(() => {
      createVectorMaskButton?.click();
    });

    const editedDoc = useImageEditorStore.getState().getActiveDocument();
    const maskedLayer = editedDoc?.layers.find((layer) => layer.id === photoLayer.id) ?? null;
    expect(editedDoc?.activeLayerId).toBe(photoLayer.id);
    expect(getLayerVectorMaskDescriptor(maskedLayer)).toMatchObject({
      id: 'vector-mask-portrait',
      name: 'Mask Route Vector Mask',
      targetLayerId: 'portrait',
      enabled: true,
      inverted: false,
      linked: true,
      path: {
        closed: true,
        points: [
          { x: 8, y: 2 },
          { x: 82, y: 2 },
          { x: 82, y: 64 },
          { x: 8, y: 64 },
        ],
      },
    });
    expect(maskedLayer?.mask).toBe(photoLayer.mask);
    expect(maskedLayer?.bitmapVersion).toBe(photoLayer.bitmapVersion);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });
  });

  it('edits an active layer retained vector-mask path independently from its pixel mask', () => {
    const doc = createEmptyImageDocument({ id: 'doc-vector-mask-edit-panel', title: 'Vector Mask Edit', width: 220, height: 180 });
    const pixelMask = new OffscreenCanvas(120, 90) as LayerBitmap;
    const photoLayer = attachVectorMaskToLayer(makeImageLayer({
      id: 'portrait',
      name: 'Portrait',
      x: 10,
      y: 20,
      bitmap: new OffscreenCanvas(120, 90) as LayerBitmap,
      mask: pixelMask,
      bitmapVersion: 7,
    }), {
      id: 'vector-mask-portrait',
      name: 'Portrait Vector Mask',
      kind: 'path',
      enabled: true,
      linked: true,
      inverted: false,
      path: {
        closed: true,
        points: [
          { x: 8, y: 2 },
          { x: 82, y: 2 },
          { x: 82, y: 64 },
          { x: 8, y: 64 },
        ],
      },
    });
    const pathLayer = {
      ...makePathLayer(doc),
      name: 'Reference Route',
    };
    doc.layers = [photoLayer, pathLayer];
    doc.activeLayerId = photoLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    expect(container.querySelector('[aria-label="Active vector mask path edit status"]')?.textContent).toBe('ready');
    const point2X = container.querySelector<HTMLInputElement>('input[aria-label="Vector mask point 2 X"]');
    const point3Y = container.querySelector<HTMLInputElement>('input[aria-label="Vector mask point 3 Y"]');
    expect(point2X?.value).toBe('82');
    expect(point3Y?.value).toBe('64');

    act(() => {
      setInputValue(point2X!, '94');
      point2X?.blur();
    });
    act(() => {
      setInputValue(point3Y!, '72');
      point3Y?.blur();
    });

    const editedLayer = useImageEditorStore.getState().getActiveDocument()?.layers.find((layer) => layer.id === photoLayer.id) ?? null;
    expect(getLayerVectorMaskDescriptor(editedLayer)?.path.points).toEqual([
      { x: 8, y: 2 },
      { x: 94, y: 2 },
      { x: 82, y: 72 },
      { x: 8, y: 64 },
    ]);
    expect(editedLayer?.mask).toBe(pixelMask);
    expect(editedLayer?.bitmapVersion).toBe(7);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });
  });

  it('exposes saved-path metadata and operation readiness signatures on panel controls', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-panel-control-signatures', title: 'Path Control Signatures', width: 220, height: 180 });
    const photoLayer = makeImageLayer({
      id: 'portrait',
      name: 'Portrait',
      x: 10,
      y: 20,
      bitmap: new OffscreenCanvas(120, 90) as LayerBitmap,
    });
    const pathLayer = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 18, y: 22 },
          { x: 92, y: 22 },
          { x: 92, y: 84 },
          { x: 18, y: 84 },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      name: 'Signature Route',
    };
    doc.layers = [photoLayer, pathLayer];
    doc.activeLayerId = photoLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const panel = container.querySelector<HTMLElement>('[data-paths-panel-signature]');
    const loadButton = container.querySelector<HTMLButtonElement>('button[aria-label="Load selected path as selection"]');
    const vectorMaskButton = container.querySelector<HTMLButtonElement>('button[aria-label="Create vector mask from selected path"]');

    expect(panel?.getAttribute('data-independent-saved-path-signature')).toContain('image-paths-independent-saved-paths:v1:');
    expect(panel?.getAttribute('data-thumbnail-readiness-signature')).toContain('image-paths-panel-thumbnails:v1:');
    expect(panel?.getAttribute('data-path-operation-signature')).toContain('image-paths-panel-operations:v1:');
    expect(panel?.getAttribute('data-bezier-unsupported-signature')).toContain('image-paths-panel-unsupported-states:v1:');
    expect(container.querySelector('[aria-label="Independent saved paths status"]')?.textContent).toBe('layer-backed-surrogate-only');
    expect(container.querySelector('[aria-label="Bezier path editing status"]')?.textContent).toBe('ready');

    expect(loadButton?.getAttribute('data-path-operation-ready')).toBe('true');
    expect(loadButton?.getAttribute('data-path-operation-signature')).toContain('"operation":"loadSelection"');
    expect(vectorMaskButton?.getAttribute('data-path-operation-ready')).toBe('true');
    expect(vectorMaskButton?.getAttribute('data-path-operation-signature')).toContain('"operation":"createVectorMask"');
  });

  it('surfaces typed path operation lane and text-on-path unsupported readiness for selected paths', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-operation-lane-panel', title: 'Path Operation Lane Panel', width: 220, height: 180 });
    const photoLayer = makeImageLayer({
      id: 'portrait',
      name: 'Portrait',
      x: 10,
      y: 20,
      bitmap: new OffscreenCanvas(120, 90) as LayerBitmap,
    });
    const pathLayer = {
      ...buildVectorPathLayer({
        doc,
        points: [
          { x: 18, y: 22 },
          { x: 92, y: 22 },
          { x: 92, y: 84 },
        ],
        closed: false,
        settings: DEFAULT_SHAPE_TOOL_SETTINGS,
      }),
      name: 'Operation Route',
    };
    doc.layers = [photoLayer, pathLayer];
    doc.activeLayerId = photoLayer.id;
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorPathsPanel />);
    });

    const panel = container.querySelector<HTMLElement>('[data-path-operation-lane-signature]');
    expect(panel?.getAttribute('data-path-operation-lane-signature')).toContain('image-path-operation-readiness:v1:');
    expect(container.querySelector('[aria-label="Path operation lane status"]')?.textContent).toBe('vector-mask:blocked');
    expect(container.querySelector('[aria-label="Text on path status"]')?.textContent).toBe('text-path:unsupported');
    expect(container.textContent).toContain('Text on path unavailable');
    expect(container.textContent).toContain('Live stroke styles unavailable');
    expect(container.textContent).toContain('Native PSD path fidelity unavailable');
  });
});
