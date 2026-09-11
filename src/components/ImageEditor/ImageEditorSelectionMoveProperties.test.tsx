// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createMask, maskBoundingBox } from './SelectionMask';
import { beginSelectionTransformSession, getSelectionTransformSession, setSelectionTransformMode } from './ImageSelectionTransform';
import { beginTransformPreviewSession, getTransformPreviewSession, setTransformPreviewMode } from './ImageTransformPreview';
import { MovePanel, SelectionPanel } from './ImageEditorSelectionMoveProperties';
import { getSelection, setSelection } from './selectionRegistry';

class FakeContext {
  drawImage = vi.fn();
  imageData: ImageData;

  constructor(width = 1, height = 1) {
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  getImageData() {
    return {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(width, height);
  }

  getContext() {
    return this.context;
  }
}

function bitmap(width: number, height: number): LayerBitmap {
  return new FakeOffscreenCanvas(width, height) as unknown as LayerBitmap;
}

function setBitmapPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  data.set(rgba, (y * bitmap.width + x) * 4);
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

function setNumericInputValue(input: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('MovePanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      tool: 'move',
      undoStacks: {},
      redoStacks: {},
      generativeFillDismissedByDocId: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('commits numeric X-position edits through an undoable transform operation', () => {
    const layer = imageLayer();
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-move-x',
        title: 'Move X',
        width: 1024,
        height: 768,
      }),
      layers: [layer],
      activeLayerId: layer.id,
    });

    act(() => {
      root.render(<MovePanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Layer X"]');
    expect(input).not.toBeNull();

    act(() => {
      setNumericInputValue(input!, '96');
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    const state = useImageEditorStore.getState();
    const updatedLayer = state.documents[0]?.layers[0];
    expect(updatedLayer?.x).toBe(96);
    expect(state.undoStacks['doc-move-x']?.at(-1)).toMatchObject({
      kind: 'transform',
      docId: 'doc-move-x',
      layerId: layer.id,
      before: { x: 24, y: 32, rotationDeg: 0 },
      after: { x: 96, y: 32, rotationDeg: 0 },
    });
  });

  it('commits numeric width edits for bitmap layers through an undoable layer operation', () => {
    const layer = imageLayer();
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-move-width',
        title: 'Move Width',
        width: 1024,
        height: 768,
      }),
      layers: [layer],
      activeLayerId: layer.id,
    });

    act(() => {
      root.render(<MovePanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Layer width"]');
    expect(input).not.toBeNull();

    act(() => {
      setNumericInputValue(input!, '240');
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    const state = useImageEditorStore.getState();
    const updatedLayer = state.documents[0]?.layers[0];
    expect(updatedLayer?.bitmap?.width).toBe(240);
    expect(updatedLayer?.bitmap?.height).toBe(120);
    expect(state.undoStacks['doc-move-width']?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: 'doc-move-width',
    });
  });

  it('commits numeric text box height edits through an undoable layer operation', () => {
    const layer = imageLayer({
      id: 'text-layer',
      type: 'text',
      bitmap: null,
      text: {
        content: 'Sloom Studio',
        fontFamily: 'Inter',
        fontSize: 42,
        fontWeight: '400',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 0,
        boxWidth: 280,
        boxHeight: 96,
        wrap: true,
        color: '#ffffff',
        lineHeight: 1.2,
        align: 'left',
        verticalAlign: 'top',
        warp: 'none',
      },
    });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-move-text-height',
        title: 'Move Text Height',
        width: 1024,
        height: 768,
      }),
      layers: [layer],
      activeLayerId: layer.id,
    });

    act(() => {
      root.render(<MovePanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Layer height"]');
    expect(input).not.toBeNull();

    act(() => {
      setNumericInputValue(input!, '144');
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    const state = useImageEditorStore.getState();
    const updatedLayer = state.documents[0]?.layers[0];
    expect(updatedLayer?.text?.boxHeight).toBe(144);
    expect(updatedLayer?.text?.boxWidth).toBe(280);
    expect(state.undoStacks['doc-move-text-height']?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: 'doc-move-text-height',
    });
  });

  it('commits numeric pivot edits through an undoable transform operation', () => {
    const layer = imageLayer();
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-move-pivot',
        title: 'Move Pivot',
        width: 1024,
        height: 768,
      }),
      layers: [layer],
      activeLayerId: layer.id,
    });

    act(() => {
      root.render(<MovePanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Layer pivot X"]');
    expect(input).not.toBeNull();

    act(() => {
      setNumericInputValue(input!, '24');
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    const state = useImageEditorStore.getState();
    const updatedLayer = state.documents[0]?.layers[0] as unknown as Record<string, unknown> | undefined;
    expect(updatedLayer?.transformOriginX).toBe(0);
    expect(updatedLayer?.transformOriginY).toBe(0.5);
    expect(state.undoStacks['doc-move-pivot']?.at(-1)).toMatchObject({
      kind: 'transform',
      docId: 'doc-move-pivot',
      layerId: layer.id,
      before: { x: 24, y: 32, rotationDeg: 0, transformOriginX: 0.5, transformOriginY: 0.5 },
      after: { x: 24, y: 32, rotationDeg: 0, transformOriginX: 0, transformOriginY: 0.5 },
    });
  });

  it('commits numeric selection rotation edits through the active selection-transform session', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-selection-rotation',
      title: 'Selection Rotation',
      width: 10,
      height: 10,
    });
    useImageEditorStore.getState().openDocument(doc);
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    beginSelectionTransformSession(doc.id);

    act(() => {
      root.render(<MovePanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Selection rotation"]');
    expect(input).not.toBeNull();

    act(() => {
      setNumericInputValue(input!, '90');
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    expect(getSelectionTransformSession(doc.id)?.currentRotationDeg).toBe(90);
  });

  it('commits numeric selection skew edits through the active selection-transform session', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-selection-skew',
      title: 'Selection Skew',
      width: 10,
      height: 10,
    });
    useImageEditorStore.getState().openDocument(doc);
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    beginSelectionTransformSession(doc.id);
    setSelectionTransformMode(doc.id, 'skew');

    act(() => {
      root.render(<MovePanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Selection skew X"]');
    expect(input).not.toBeNull();

    act(() => {
      setNumericInputValue(input!, '30');
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    expect(getSelectionTransformSession(doc.id)?.currentSkewXDeg).toBe(30);
  });

  it('nudges an active selection from the Move panel with undoable selection history', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-selection-nudge',
      title: 'Selection Nudge',
      width: 10,
      height: 10,
    });
    useImageEditorStore.getState().openDocument(doc);
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    act(() => {
      root.render(<MovePanel />);
    });

    const nudgeRight = container.querySelector<HTMLButtonElement>('button[aria-label="Nudge selection right 1 px"]');
    expect(nudgeRight).not.toBeNull();

    act(() => {
      nudgeRight!.click();
    });

    expect(maskBoundingBox(getSelection(doc.id)!)).toEqual({ x: 3, y: 2, width: 2, height: 1 });
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: doc.id,
    });
  });

  it('commits numeric layer skew edits through the active layer transform preview session', () => {
    const layer = imageLayer();
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-layer-skew',
        title: 'Layer Skew',
        width: 1024,
        height: 768,
      }),
      layers: [layer],
      activeLayerId: layer.id,
    };
    useImageEditorStore.getState().openDocument(doc);
    beginTransformPreviewSession(doc, layer);
    setTransformPreviewMode(doc.id, 'skew');

    act(() => {
      root.render(<MovePanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Layer skew X"]');
    expect(input).not.toBeNull();

    act(() => {
      setNumericInputValue(input!, '28');
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    const updatedLayer = useImageEditorStore.getState().documents[0]?.layers[0];
    expect(updatedLayer?.skewXDeg).toBe(28);
    expect(getTransformPreviewSession(doc.id)?.currentMode).toBe('skew');
  });

  it('commits numeric layer perspective edits through the active layer transform preview session', () => {
    const layer = imageLayer();
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-layer-perspective',
        title: 'Layer Perspective',
        width: 1024,
        height: 768,
      }),
      layers: [layer],
      activeLayerId: layer.id,
    };
    useImageEditorStore.getState().openDocument(doc);
    beginTransformPreviewSession(doc, layer);
    setTransformPreviewMode(doc.id, 'perspective');

    act(() => {
      root.render(<MovePanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Layer perspective X"]');
    expect(input).not.toBeNull();

    act(() => {
      setNumericInputValue(input!, '25');
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    const updatedLayer = useImageEditorStore.getState().documents[0]?.layers[0] as (ImageLayer & { perspectiveX?: number }) | undefined;
    expect(updatedLayer?.perspectiveX).toBe(0.25);
    expect(getTransformPreviewSession(doc.id)?.currentMode).toBe('perspective');
  });

  it('commits numeric layer warp edits through the active layer transform preview session', () => {
    const layer = imageLayer();
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-layer-warp',
        title: 'Layer Warp',
        width: 1024,
        height: 768,
      }),
      layers: [layer],
      activeLayerId: layer.id,
    };
    useImageEditorStore.getState().openDocument(doc);
    beginTransformPreviewSession(doc, layer);
    setTransformPreviewMode(doc.id, 'warp');

    act(() => {
      root.render(<MovePanel />);
    });

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Layer warp top"]');
    expect(input).not.toBeNull();

    act(() => {
      setNumericInputValue(input!, '25');
      input!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    const updatedLayer = useImageEditorStore.getState().documents[0]?.layers[0] as (ImageLayer & {
      warp?: { top: number; right: number; bottom: number; left: number };
    }) | undefined;
    expect(updatedLayer?.warp).toEqual({
      top: 0.25,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(getTransformPreviewSession(doc.id)?.currentMode).toBe('warp');
  });

  it('exposes and resets the retained Puppet mesh from the Move panel', () => {
    const layer = imageLayer({
      warpMesh: {
        columns: 1,
        rows: 1,
        points: [{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0, y: 0 }, { x: 0, y: -0.3 }],
      },
    });
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-puppet-mesh', title: 'Puppet mesh', width: 1024, height: 768 }),
      layers: [layer],
      activeLayerId: layer.id,
    };
    useImageEditorStore.getState().openDocument(doc);
    beginTransformPreviewSession(doc, layer);
    setTransformPreviewMode(doc.id, 'warp');

    act(() => {
      root.render(<MovePanel />);
    });

    expect(container.textContent).toContain('Puppet');
    expect(container.querySelector('[data-image-layer-puppet-mesh-help="true"]')?.textContent).toContain('drag the on-canvas cage pins');
    const reset = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Reset Puppet Mesh');
    expect(reset).toBeDefined();
    act(() => reset?.click());
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.warpMesh).toBeNull();
  });
});

describe('SelectionPanel object selection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      tool: 'magicWand',
      undoStacks: {},
      redoStacks: {},
      generativeFillDismissedByDocId: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates an undoable local foreground object selection from the active layer', () => {
    const layerBitmap = bitmap(4, 4);
    setBitmapPixel(layerBitmap, 0, 0, [255, 255, 255, 255]);
    setBitmapPixel(layerBitmap, 1, 1, [220, 220, 220, 255]);
    setBitmapPixel(layerBitmap, 2, 1, [220, 220, 220, 255]);
    setBitmapPixel(layerBitmap, 1, 2, [220, 220, 220, 255]);
    setBitmapPixel(layerBitmap, 2, 2, [220, 220, 220, 255]);
    const layer = imageLayer({
      id: 'subject-layer',
      x: 3,
      y: 2,
      bitmap: layerBitmap,
    });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-object-ui',
        title: 'Object UI',
        width: 10,
        height: 8,
      }),
      layers: [layer],
      activeLayerId: layer.id,
    });

    act(() => {
      root.render(<SelectionPanel showTolerance />);
    });

    const button = Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Select Local Object'));
    expect(button).toBeDefined();

    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const state = useImageEditorStore.getState();
    const doc = state.documents.find((candidate) => candidate.id === 'doc-object-ui');
    expect(doc?.hasSelection).toBe(true);
    expect(maskBoundingBox(getSelection('doc-object-ui')!)).toEqual({ x: 4, y: 3, width: 2, height: 2 });
    expect(state.undoStacks['doc-object-ui']?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: 'doc-object-ui',
      before: null,
    });
  });

  it('mounts Offline Select Subject and commits the normal undoable document selection', () => {
    const layerBitmap = bitmap(7, 5);
    for (let y = 0; y < layerBitmap.height; y += 1) {
      for (let x = 0; x < layerBitmap.width; x += 1) setBitmapPixel(layerBitmap, x, y, [225, 225, 225, 255]);
    }
    for (const [x, y] of [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]] as const) {
      setBitmapPixel(layerBitmap, x, y, [35, 75, 110, 255]);
    }
    const layer = imageLayer({ id: 'offline-subject', x: 0, y: 0, bitmap: layerBitmap });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-offline-subject', title: 'Offline subject', width: 7, height: 5 }),
      layers: [layer],
      activeLayerId: layer.id,
    });
    act(() => root.render(<SelectionPanel showTolerance />));
    const button = Array.from(container.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Select Subject (Offline)'));
    expect(button).toBeDefined();

    act(() => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(maskBoundingBox(getSelection('doc-offline-subject')!)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
    expect(useImageEditorStore.getState().undoStacks['doc-offline-subject']?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: 'doc-offline-subject',
    });
  });
});
