import { describe, expect, it, beforeEach } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from './imageEditorStore';
import { DEFAULT_IMAGE_EDITOR_TOOLBAR_FLYOUT_ORDER } from '../components/ImageEditor/imageEditorTools';
import { DEFAULT_IMAGE_VIEW_SETTINGS } from '../components/ImageEditor/ImageRulersGuides';
import {
  attachTextLayerToVectorPath,
  normalizeImageTextStyle,
  updateTextLayerFromStyle,
} from '../components/ImageEditor/ImageTextLayer';
import { createLiveImageVectorBooleanLayers } from '../components/ImageEditor/ImageVectorShape';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_GRADIENT_TOOL_SETTINGS,
  DEFAULT_SHAPE_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  DEFAULT_TEXT_TOOL_SETTINGS,
  type EditorOperation,
  type GradientToolSettings,
  type ImageLayer,
  type ImagePathVectorShape,
  type LayerBitmap,
} from '../types/imageEditor';

class FakeContext {
  font = '';
  fontKerning = '';
  fontVariantCaps = '';
  fillStyle = '';
  textBaseline = '';
  drawImage() {}
  beginPath() {}
  closePath() {}
  clearRect() {}
  ellipse() {}
  fill() {}
  fillText() {}
  lineTo() {}
  measureText(text: string) { return { width: text.length * 10 }; }
  moveTo() {}
  rect() {}
  restore() {}
  rotate() {}
  save() {}
  stroke() {}
  translate() {}
  bezierCurveTo() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return new FakeContext();
  }
}

globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;

globalThis.createImageBitmap = async () => {
  return {
    width: 10,
    height: 12,
    close() {},
  } as unknown as ImageBitmap;
};

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {


  return {
    id: 'layer-1',
    name: 'Background',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function resetStore() {
  useImageEditorStore.setState({
    documents: [],
    activeDocId: null,
    tool: 'move',
    backgroundColor: '#000000',
    brushSettings: { ...DEFAULT_BRUSH_SETTINGS },
    gradientToolSettings: { ...DEFAULT_GRADIENT_TOOL_SETTINGS },
    shapeToolSettings: { ...DEFAULT_SHAPE_TOOL_SETTINGS },
    selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS },
    textToolSettings: { ...DEFAULT_TEXT_TOOL_SETTINGS },
    viewportContainerSize: { width: 0, height: 0 },
    undoStacks: {},
    redoStacks: {},
    quickActionMacros: [],
    activeQuickActionRecording: null,
    toolbarFlyoutOrder: [...DEFAULT_IMAGE_EDITOR_TOOLBAR_FLYOUT_ORDER],
    generativeFillDismissedByDocId: {},
  });
}

describe('imageEditorStore — documents', () => {
  beforeEach(resetStore);

  it('opens a document and makes it active', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a.png', width: 800, height: 600 });
    useImageEditorStore.getState().openDocument(doc);
    const state = useImageEditorStore.getState();
    expect(state.documents).toHaveLength(1);
    expect(state.activeDocId).toBe('doc-1');
  });

  it('creates new documents with persisted channel collections initialized', () => {
    const doc = createEmptyImageDocument({ id: 'doc-empty-channels', title: 'a.png', width: 800, height: 600 });

    expect(doc.savedSelectionChannels).toEqual([]);
    expect(doc.spotChannels).toEqual([]);
  });

  it('switches to existing doc instead of duplicating on re-open', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a.png', width: 100, height: 100 });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setActiveDocument('doc-1');
    useImageEditorStore.getState().openDocument(doc);
    expect(useImageEditorStore.getState().documents).toHaveLength(1);
  });

  it('refuses to close a dirty document implicitly and preserves its history', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a.png', width: 1, height: 1 });
    useImageEditorStore.getState().openDocument({ ...doc, dirty: true });
    useImageEditorStore.getState().pushOperation({
      kind: 'selection',
      docId: 'doc-1',
      before: null,
      after: null,
    });
    useImageEditorStore.getState().closeDocument('doc-1');
    const state = useImageEditorStore.getState();
    expect(state.documents).toHaveLength(1);
    expect(state.activeDocId).toBe('doc-1');
    expect(state.undoStacks['doc-1']).toHaveLength(1);
  });

  it('deliberately discards a dirty document and clears both history stacks', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a.png', width: 1, height: 1 });
    useImageEditorStore.getState().openDocument({ ...doc, dirty: true });
    useImageEditorStore.setState({
      undoStacks: { 'doc-1': [{ kind: 'selection', docId: 'doc-1', before: null, after: null }] },
      redoStacks: { 'doc-1': [{ kind: 'selection', docId: 'doc-1', before: null, after: null }] },
    });

    useImageEditorStore.getState().discardDocument('doc-1');

    const state = useImageEditorStore.getState();
    expect(state.documents).toHaveLength(0);
    expect(state.activeDocId).toBeNull();
    expect(state.undoStacks['doc-1']).toBeUndefined();
    expect(state.redoStacks['doc-1']).toBeUndefined();
  });

  it('closing the active doc switches to the last remaining', () => {
    const a = createEmptyImageDocument({ id: 'a', title: 'a', width: 1, height: 1 });
    const b = createEmptyImageDocument({ id: 'b', title: 'b', width: 1, height: 1 });
    useImageEditorStore.getState().openDocument(a);
    useImageEditorStore.getState().openDocument(b);
    useImageEditorStore.getState().closeDocument('b');
    expect(useImageEditorStore.getState().activeDocId).toBe('a');
  });

  it('renames a document', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 1, height: 1 });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setDocumentTitle('doc-1', 'renamed');
    expect(useImageEditorStore.getState().documents[0].title).toBe('renamed');
  });

  it('marks dirty / clean', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 1, height: 1 });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().markDocumentDirty('doc-1');
    expect(useImageEditorStore.getState().documents[0].dirty).toBe(true);
    useImageEditorStore.getState().markDocumentClean('doc-1');
    expect(useImageEditorStore.getState().documents[0].dirty).toBe(false);
  });

  it('getActiveDocument returns the active doc', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 1, height: 1 });
    useImageEditorStore.getState().openDocument(doc);
    expect(useImageEditorStore.getState().getActiveDocument()?.id).toBe('doc-1');
  });

  it('resizeDocumentPixels scales the document and records an undoable resize operation', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 20 });
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [makeLayer({ id: 'l1', x: 5, y: 6 })],
      activeLayerId: 'l1',
    });

    useImageEditorStore.getState().resizeDocumentPixels('doc-1', 20, 40);

    const updated = useImageEditorStore.getState().getActiveDocument()!;
    expect(updated).toMatchObject({ width: 20, height: 40, dirty: true });
    expect(updated.layers[0]).toMatchObject({ x: 10, y: 12 });
    expect(useImageEditorStore.getState().undoStacks['doc-1'].at(-1)).toMatchObject({
      kind: 'docResize',
      before: { width: 10, height: 20 },
      after: { width: 20, height: 40 },
    });
  });

  it('resizeDocumentPixels on a vector layer triggers async high-res SVG rasterization', async () => {
    const doc = createEmptyImageDocument({ id: 'doc-vector', title: 'a', width: 10, height: 20 });
    const fakeBitmap = {
      width: 5,
      height: 6,
      getContext: () => ({
        drawImage: () => {},
      }),
    } as unknown as LayerBitmap;
    const layer = makeLayer({
      id: 'l-vector',
      type: 'vector',
      bitmap: fakeBitmap,
      metadata: {
        originalSvgSource: '<svg>vector</svg>',
      },
    });

    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [layer],
      activeLayerId: 'l-vector',
    });

    useImageEditorStore.getState().resizeDocumentPixels('doc-vector', 20, 40);

    // Let any pending promises/microtasks flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    const updated = useImageEditorStore.getState().getActiveDocument()!;
    expect(updated.layers[0].type).toBe('vector');
    expect(updated.layers[0].bitmap).not.toBeNull();
    expect(updated.layers[0].bitmap!.width).toBe(10);
    expect(updated.layers[0].bitmap!.height).toBe(12);
  });


  it('resizeDocumentCanvas preserves pixels, offsets layers from the anchor, and records history', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 20 });
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [makeLayer({ id: 'l1', x: 5, y: 6 })],
      activeLayerId: 'l1',
    });

    useImageEditorStore.getState().resizeDocumentCanvas('doc-1', 30, 60, 'center');

    const updated = useImageEditorStore.getState().getActiveDocument()!;
    expect(updated).toMatchObject({ width: 30, height: 60, dirty: true });
    expect(updated.layers[0]).toMatchObject({ x: 15, y: 26 });
    expect(useImageEditorStore.getState().undoStacks['doc-1'].at(-1)).toMatchObject({
      kind: 'docResize',
      before: { width: 10, height: 20 },
      after: { width: 30, height: 60 },
    });
  });
});

describe('imageEditorStore — tools and settings', () => {
  beforeEach(resetStore);

  it('sets the active tool', () => {
    useImageEditorStore.getState().setTool('brush');
    expect(useImageEditorStore.getState().tool).toBe('brush');
  });

  it('stores a sanitized custom Image toolbar flyout order', () => {
    useImageEditorStore.getState().setToolbarFlyoutOrder([
      'text',
      'eraser',
      'bogus',
      'selection',
      'text',
    ]);

    expect(useImageEditorStore.getState().toolbarFlyoutOrder.slice(0, 3)).toEqual([
      'text',
      'eraser',
      'selection',
    ]);
    expect(useImageEditorStore.getState().toolbarFlyoutOrder).toHaveLength(13);

    useImageEditorStore.getState().resetToolbarFlyoutOrder();
    expect(useImageEditorStore.getState().toolbarFlyoutOrder.slice(0, 3)).toEqual([
      'move',
      'hand',
      'selection',
    ]);
  });

  it('updates brush settings partially', () => {
    useImageEditorStore.getState().setBrushSettings({ size: 24, symmetryMode: 'vertical' });
    const settings = useImageEditorStore.getState().brushSettings;
    expect(settings.size).toBe(24);
    expect(settings.symmetryMode).toBe('vertical');
    expect(settings.opacity).toBe(DEFAULT_BRUSH_SETTINGS.opacity);
  });

  it('swaps and resets foreground and background colors', () => {
    useImageEditorStore.getState().setBrushSettings({ color: '#112233' });
    useImageEditorStore.getState().setBackgroundColor('#aabbcc');

    useImageEditorStore.getState().swapForegroundBackgroundColors();

    expect(useImageEditorStore.getState().brushSettings.color).toBe('#aabbcc');
    expect(useImageEditorStore.getState().backgroundColor).toBe('#112233');

    useImageEditorStore.getState().resetForegroundBackgroundColors();

    expect(useImageEditorStore.getState().brushSettings.color).toBe('#ffffff');
    expect(useImageEditorStore.getState().backgroundColor).toBe('#000000');
  });

  it('updates selection tool settings partially', () => {
    useImageEditorStore.getState().setSelectionToolSettings({
      feather: 5,
      mode: 'add',
      paintBucketBlendMode: 'multiply',
      paintBucketPreserveTransparency: true,
    });
    const settings = useImageEditorStore.getState().selectionToolSettings;
    expect(settings.feather).toBe(5);
    expect(settings.mode).toBe('add');
    expect(settings.paintBucketBlendMode).toBe('multiply');
    expect(settings.paintBucketPreserveTransparency).toBe(true);
    expect(settings.antiAlias).toBe(DEFAULT_SELECTION_TOOL_SETTINGS.antiAlias);
  });

  it('persists gradient tool settings independently of brush foreground color', () => {
    useImageEditorStore.getState().setGradientToolSettings({
      mode: 'radial',
      colorMode: 'foregroundToBackground',
      reverse: true,
      dither: true,
      presetId: 'warm-sunset',
      colorStops: [
        { offset: 0, color: '#2d1b69', opacity: 1 },
        { offset: 0.35, color: '#f97316', opacity: 0.8 },
        { offset: 1, color: '#fde68a', opacity: 0.45 },
      ],
    } as Partial<GradientToolSettings> & { dither: boolean; presetId: string });
    useImageEditorStore.getState().setTool('brush');
    useImageEditorStore.getState().setTool('gradientTool');

    const settings = useImageEditorStore.getState().gradientToolSettings;
    expect(settings.mode).toBe('radial');
    expect(settings.colorMode).toBe('foregroundToBackground');
    expect(settings.reverse).toBe(true);
    expect(settings.dither).toBe(true);
    expect(settings.presetId).toBe('warm-sunset');
    expect(settings.colorStops).toEqual([
      { offset: 0, color: '#2d1b69', opacity: 1 },
      { offset: 0.35, color: '#f97316', opacity: 0.8 },
      { offset: 1, color: '#fde68a', opacity: 0.45 },
    ]);
    expect(useImageEditorStore.getState().brushSettings.color).toBe(DEFAULT_BRUSH_SETTINGS.color);
  });

  it('persists the active layer edit target and falls back to the layer when switching to one without a mask', () => {
    const doc = createEmptyImageDocument({ id: 'doc-edit-target', title: 'a', width: 10, height: 10 });
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [
        makeLayer({ id: 'masked', mask: new OffscreenCanvas(10, 10) as LayerBitmap }),
        makeLayer({ id: 'plain' }),
      ],
      activeLayerId: 'masked',
    });

    useImageEditorStore.getState().setActiveLayerEditTarget('doc-edit-target', 'mask');
    expect(useImageEditorStore.getState().documents[0].activeLayerEditTarget).toBe('mask');

    useImageEditorStore.getState().setActiveLayer('doc-edit-target', 'plain');
    expect(useImageEditorStore.getState().documents[0].activeLayerEditTarget).toBe('layer');
  });
});

describe('imageEditorStore — selection + viewport', () => {
  beforeEach(resetStore);

  it('setHasSelection bumps selection version', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 10 });
    useImageEditorStore.getState().openDocument(doc);
    expect(useImageEditorStore.getState().getActiveDocument()?.selectionVersion).toBe(0);
    useImageEditorStore.getState().setHasSelection('doc-1', true);
    const updated = useImageEditorStore.getState().getActiveDocument()!;
    expect(updated.hasSelection).toBe(true);
    expect(updated.selectionVersion).toBe(1);
  });

  it('bumpSelectionVersion increments without changing hasSelection', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 10 });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setHasSelection('doc-1', true);
    useImageEditorStore.getState().bumpSelectionVersion('doc-1');
    const updated = useImageEditorStore.getState().getActiveDocument()!;
    expect(updated.selectionVersion).toBe(2);
    expect(updated.hasSelection).toBe(true);
  });

  it('clears the dismissed generative-edit state when the selection is cleared', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 10 });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setHasSelection('doc-1', true);
    useImageEditorStore.getState().setGenerativeFillDismissed('doc-1', true);

    useImageEditorStore.getState().setHasSelection('doc-1', false);

    expect(Boolean(useImageEditorStore.getState().generativeFillDismissedByDocId['doc-1'])).toBe(false);
  });

  it('setViewport patches the active doc viewport', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 10 });
    useImageEditorStore.getState().openDocument(doc);
    useImageEditorStore.getState().setViewport('doc-1', { zoom: 2 });
    const v = useImageEditorStore.getState().getActiveDocument()!.viewport;
    expect(v.zoom).toBe(2);
    expect(v.panX).toBe(0);
  });

  it('does not emit document changes for unchanged viewport patches', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 10 });
    useImageEditorStore.getState().openDocument(doc);
    const before = useImageEditorStore.getState();
    const notifications: Array<ReturnType<typeof useImageEditorStore.getState>> = [];
    const unsubscribe = useImageEditorStore.subscribe((state) => {
      notifications.push(state);
    });

    try {
      before.setViewport('doc-1', { zoom: doc.viewport.zoom, panX: doc.viewport.panX });
    } finally {
      unsubscribe();
    }

    const after = useImageEditorStore.getState();
    expect(after.documents).toBe(before.documents);
    expect(notifications).toHaveLength(0);
  });

  it('tracks the image canvas viewport container size', () => {
    useImageEditorStore.getState().setViewportContainerSize({ width: 640, height: 360 });
    expect(useImageEditorStore.getState().viewportContainerSize).toEqual({
      width: 640,
      height: 360,
    });
  });
});

describe('imageEditorStore — layers', () => {
  beforeEach(resetStore);

  function setupDoc() {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 10 });
    useImageEditorStore.getState().openDocument(doc);
  }

  it('refreshes live vector Boolean outputs on operand updates and hides them on operand removal', () => {
    const doc = createEmptyImageDocument({ id: 'doc-live-boolean', title: 'Live Boolean', width: 100, height: 100 });
    const first = makeLayer({
      id: 'vector-a',
      name: 'A',
      type: 'vector',
      x: 0,
      y: 0,
      metadata: {
        vectorShape: {
          kind: 'rect',
          width: 30,
          height: 20,
          fillColor: '#ffffff',
          fillOpacity: 1,
          strokeColor: '#000000',
          strokeOpacity: 1,
          strokeWidth: 0,
        },
      },
    });
    const second = makeLayer({
      id: 'vector-b',
      name: 'B',
      type: 'vector',
      x: 10,
      y: 0,
      metadata: {
        vectorShape: {
          kind: 'rect',
          width: 30,
          height: 20,
          fillColor: '#ffffff',
          fillOpacity: 1,
          strokeColor: '#000000',
          strokeOpacity: 1,
          strokeWidth: 0,
        },
      },
    });
    const live = createLiveImageVectorBooleanLayers('union', first, second);
    expect(live.status).toBe('exact');
    const output = live.outputLayers[0]!;
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [first, second, output],
      activeLayerId: second.id,
    });

    useImageEditorStore.getState().updateLayer(doc.id, second.id, { x: 20 });
    let current = useImageEditorStore.getState().getActiveDocument()!;
    expect(current.layers.find((layer) => layer.id === output.id)?.metadata?.vectorShape).toMatchObject({
      kind: 'path',
      width: 50,
    });

    useImageEditorStore.getState().removeLayer(doc.id, first.id);
    current = useImageEditorStore.getState().getActiveDocument()!;
    expect(current.layers.find((layer) => layer.id === output.id)?.visible).toBe(false);
  });

  it('rerasterizes linked Bezier text centrally when source handles change and clears missing paths', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-link', title: 'Path link', width: 640, height: 400 });
    const path = makeLayer({
      id: 'path-source',
      name: 'Curve',
      type: 'vector',
      bitmapVersion: 1,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 240,
          height: 120,
          points: [
            { x: 0, y: 72, outHandle: { x: 64, y: 0 } },
            { x: 240, y: 48, inHandle: { x: 176, y: 120 } },
          ],
          closed: false,
          fillColor: 'transparent',
          fillOpacity: 0,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWidth: 2,
        },
      },
    });
    const text = makeLayer({
      id: 'path-text',
      name: 'Curve text',
      type: 'text',
      bitmapVersion: 1,
      text: normalizeImageTextStyle({ content: 'Live curve', fontSize: 20 }),
      metadata: { editableText: true },
    });
    const attached = attachTextLayerToVectorPath(text, path, { startOffset: 12, reverse: true });
    const originalSignature = attached.text?.pathLayout?.previewSignature;
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [path, attached],
      activeLayerId: path.id,
    });

    const pathShape = path.metadata?.vectorShape;
    if (!pathShape || pathShape.kind !== 'path') throw new Error('Expected retained path geometry.');
    const changedPathShape = {
      ...pathShape,
      points: [
        { x: 0, y: 72, outHandle: { x: 64, y: 120 } },
        { x: 240, y: 48, inHandle: { x: 176, y: 0 } },
      ],
    } satisfies ImagePathVectorShape;
    const changedPath = {
      ...path,
      bitmapVersion: 2,
      metadata: {
        ...path.metadata,
        vectorShape: changedPathShape,
      },
    } satisfies ImageLayer;
    useImageEditorStore.getState().setLayers(doc.id, [changedPath, attached], path.id);

    const refreshed = useImageEditorStore.getState().getActiveDocument()!.layers.find((layer) => layer.id === text.id)!;
    expect(refreshed.text?.pathReference?.revision).toBe(2);
    expect(refreshed.text?.pathLayout).toMatchObject({ startOffset: 12, reverse: true });
    expect(refreshed.text?.pathLayout?.previewSignature).not.toBe(originalSignature);
    expect(refreshed.bitmapVersion).toBe(attached.bitmapVersion + 1);
    expect(refreshed.bitmap).not.toBeNull();

    useImageEditorStore.getState().setLayers(doc.id, [changedPath, refreshed], path.id);
    expect(useImageEditorStore.getState().getActiveDocument()!.layers.find((layer) => layer.id === text.id))
      .toBe(refreshed);

    // Layer-operation history replays one layer at a time. A text layer may be
    // restored before its source path, so preserve the reference until the path
    // arrives and then repair the stale raster/revision against that geometry.
    useImageEditorStore.getState().removeLayer(doc.id, path.id);
    useImageEditorStore.getState().removeLayer(doc.id, text.id);
    useImageEditorStore.getState().addLayer(doc.id, attached);
    expect(useImageEditorStore.getState().getActiveDocument()!.layers[0]?.text?.pathReference?.revision).toBe(1);
    useImageEditorStore.getState().addLayer(doc.id, changedPath, 0);
    const replayed = useImageEditorStore.getState().getActiveDocument()!.layers.find((layer) => layer.id === text.id)!;
    expect(replayed.text?.pathReference?.revision).toBe(2);
    expect(replayed.text?.pathLayout?.previewSignature).toBe(refreshed.text?.pathLayout?.previewSignature);

    useImageEditorStore.getState().setLayers(doc.id, [replayed], text.id);
    const detached = useImageEditorStore.getState().getActiveDocument()!.layers[0]!;
    expect(detached.text?.pathReference).toBeNull();
    expect(detached.text?.pathLayout).toBeNull();
  });

  it('reanchors linked text after style edits and refreshes path metadata after rename', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-update', title: 'Path update', width: 640, height: 400 });
    const path = makeLayer({
      id: 'path-update-source',
      name: 'Original curve',
      type: 'vector',
      bitmapVersion: 1,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 240,
          height: 120,
          points: [
            { x: 0, y: 72, outHandle: { x: 64, y: 0 } },
            { x: 240, y: 48, inHandle: { x: 176, y: 120 } },
          ],
          closed: false,
          fillColor: 'transparent',
          fillOpacity: 0,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWidth: 2,
        },
      },
    });
    const text = makeLayer({
      id: 'path-update-text',
      name: 'Curve text',
      type: 'text',
      bitmapVersion: 1,
      text: normalizeImageTextStyle({ content: 'Live curve', fontSize: 20 }),
      metadata: { editableText: true },
    });
    const attached = attachTextLayerToVectorPath(text, path, { startOffset: 12, reverse: true });
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [path, attached],
      activeLayerId: attached.id,
    });

    const largerText = updateTextLayerFromStyle(attached, { fontSize: 48 });
    const expectedReanchored = attachTextLayerToVectorPath(largerText, path, { startOffset: 12, reverse: true });
    expect({ x: expectedReanchored.x, y: expectedReanchored.y }).not.toEqual({ x: attached.x, y: attached.y });

    useImageEditorStore.getState().updateLayer(doc.id, attached.id, largerText);
    const reanchored = useImageEditorStore.getState().getActiveDocument()!.layers
      .find((layer) => layer.id === attached.id)!;
    expect({ x: reanchored.x, y: reanchored.y }).toEqual({
      x: expectedReanchored.x,
      y: expectedReanchored.y,
    });

    useImageEditorStore.getState().updateLayer(doc.id, path.id, { name: 'Renamed curve' });
    const renamedReference = useImageEditorStore.getState().getActiveDocument()!.layers
      .find((layer) => layer.id === attached.id)!.text?.pathReference;
    expect(renamedReference).toMatchObject({
      kind: 'vector-layer',
      layerId: path.id,
      pathId: 'Renamed curve',
    });
  });

  it('refreshes linked path metadata when a path layer is renamed through updateLayer', () => {
    const doc = createEmptyImageDocument({ id: 'doc-path-rename', title: 'Path rename', width: 640, height: 400 });
    const path = makeLayer({
      id: 'path-rename-source',
      name: 'Original path name',
      type: 'vector',
      bitmapVersion: 1,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 240,
          height: 120,
          points: [{ x: 0, y: 72 }, { x: 240, y: 48 }],
          closed: false,
          fillColor: 'transparent',
          fillOpacity: 0,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWidth: 2,
        },
      },
    });
    const text = makeLayer({
      id: 'path-rename-text',
      name: 'Path text',
      type: 'text',
      bitmapVersion: 1,
      text: normalizeImageTextStyle({ content: 'Rename me', fontSize: 20 }),
      metadata: { editableText: true },
    });
    const attached = attachTextLayerToVectorPath(text, path);
    useImageEditorStore.getState().openDocument({
      ...doc,
      layers: [path, attached],
      activeLayerId: path.id,
    });

    useImageEditorStore.getState().updateLayer(doc.id, path.id, { name: 'Renamed path' });

    expect(useImageEditorStore.getState().getActiveDocument()!.layers
      .find((layer) => layer.id === attached.id)!.text?.pathReference).toMatchObject({
      kind: 'vector-layer',
      layerId: path.id,
      pathId: 'Renamed path',
    });
  });

  it('addLayer appends and activates by default', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1' }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l2' }));
    const d = useImageEditorStore.getState().getActiveDocument()!;
    expect(d.layers.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(d.activeLayerId).toBe('l2');
    expect(d.dirty).toBe(true);
  });

  it('addLayer respects index', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1' }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l2' }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l3' }), 1);
    const d = useImageEditorStore.getState().getActiveDocument()!;
    expect(d.layers.map((l) => l.id)).toEqual(['l1', 'l3', 'l2']);
  });

  it('removeLayer reassigns activeLayerId to the previous top', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1' }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l2' }));
    useImageEditorStore.getState().removeLayer('doc-1', 'l2');
    expect(useImageEditorStore.getState().getActiveDocument()!.activeLayerId).toBe('l1');
  });

  it('removeLayer clears activeLayerId when last layer is removed', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1' }));
    useImageEditorStore.getState().removeLayer('doc-1', 'l1');
    expect(useImageEditorStore.getState().getActiveDocument()!.activeLayerId).toBeNull();
  });

  it('removeLayer materializes linked-mask consumers instead of leaving dangling references', () => {
    setupDoc();
    const sourceMask = new FakeOffscreenCanvas(4, 4);
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'source', mask: sourceMask as unknown as ImageLayer['mask'] }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'consumer', maskLinkSourceLayerId: 'source' }));

    useImageEditorStore.getState().removeLayer('doc-1', 'source');

    const doc = useImageEditorStore.getState().getActiveDocument()!;
    expect(doc.layers.map((l) => l.id)).toEqual(['consumer']);
    const consumer = doc.layers.find((l) => l.id === 'consumer')!;
    expect(consumer.maskLinkSourceLayerId).toBeUndefined();
    expect(consumer.mask).not.toBeNull();
    expect(consumer.mask).not.toBe(sourceMask);
    expect(doc.dirty).toBe(true);
  });

  it('removeLayer keeps the source untouched when a consumer (not the source) is removed', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'source', mask: new FakeOffscreenCanvas(4, 4) as unknown as ImageLayer['mask'] }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'consumer', maskLinkSourceLayerId: 'source' }));

    useImageEditorStore.getState().removeLayer('doc-1', 'consumer');

    const doc = useImageEditorStore.getState().getActiveDocument()!;
    const source = doc.layers.find((l) => l.id === 'source')!;
    expect(source.mask).not.toBeNull();
    expect(source.maskLinkSourceLayerId).toBeUndefined();
  });

  it('duplicateLayer inserts above the source and activates the copy', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1', name: 'Bg' }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l2' }));
    useImageEditorStore.getState().duplicateLayer('doc-1', 'l1');
    const d = useImageEditorStore.getState().getActiveDocument()!;
    expect(d.layers).toHaveLength(3);
    expect(d.layers[0].id).toBe('l1');
    expect(d.layers[1].id).toMatch(/^l1-copy-/);
    expect(d.layers[1].name).toBe('Bg copy');
    expect(d.activeLayerId).toBe(d.layers[1].id);
  });

  it('duplicateLayer clones mutable bitmap and mask buffers instead of sharing them', () => {
    setupDoc();
    const bitmap = new OffscreenCanvas(8, 6) as LayerBitmap;
    const mask = new OffscreenCanvas(8, 6) as LayerBitmap;
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1', bitmap, mask }));

    useImageEditorStore.getState().duplicateLayer('doc-1', 'l1');

    const [original, copy] = useImageEditorStore.getState().getActiveDocument()!.layers;
    expect(copy.bitmap).not.toBe(original.bitmap);
    expect(copy.bitmap).toMatchObject({ width: 8, height: 6 });
    expect(copy.mask).not.toBe(original.mask);
    expect(copy.mask).toMatchObject({ width: 8, height: 6 });
  });

  it('exportProjectSnapshot preserves editable Image metadata and lightweight snapshots without runtime pixels', () => {
    setupDoc();
    const bitmap = new OffscreenCanvas(8, 6) as LayerBitmap;
    const mask = new OffscreenCanvas(8, 6) as LayerBitmap;
    const layer = makeLayer({
      id: 'vector-1',
      type: 'vector',
      bitmap,
      mask,
      metadata: {
        originalSvgSource: '<svg><text>Bang</text></svg>',
        smartLinkedSourceId: 'source-1',
        sourceLink: {
          id: 'source-1',
          label: 'Panel.svg',
          width: 8,
          height: 6,
          status: 'linked',
          relinkHistory: [],
        },
      },
      vectorRecipe: '<svg><text>Bang</text></svg>',
    });
    useImageEditorStore.setState({
      documents: [{
        ...createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 10, sourceBinItemId: 'source-1' }),
        layers: [layer],
        activeLayerId: 'vector-1',
        savedSelectionChannels: [{
          id: 'alpha-1',
          name: 'Saved hair mask',
          width: 10,
          height: 10,
          dataBase64: 'AAAA',
          createdAt: 12,
        }],
        spotChannels: [{
          id: 'spot-1',
          name: 'Varnish',
          width: 10,
          height: 10,
          color: { r: 20, g: 120, b: 220 },
          opacity: 0.75,
          solidity: 0.5,
          visible: true,
          dataBase64: 'AAAA',
          createdAt: 13,
          updatedAt: 14,
        }],
        snapshots: [{
          id: 'snapshot-1',
          name: 'Before edits',
          createdAt: 10,
          updatedAt: 15,
          width: 10,
          height: 10,
          layers: [layer],
          activeLayerId: 'vector-1',
          hasSelection: false,
          selectionVersion: 0,
        }],
      }],
      activeDocId: 'doc-1',
    });

    const snapshot = useImageEditorStore.getState().exportProjectSnapshot();

    expect(snapshot.documents[0].sourceBinItemId).toBe('source-1');
    expect(snapshot.documents[0].layers[0]).toMatchObject({
      id: 'vector-1',
      type: 'vector',
      bitmap: null,
      mask: null,
      metadata: {
        smartLinkedSourceId: 'source-1',
        sourceLink: { id: 'source-1', label: 'Panel.svg', status: 'linked' },
      },
      vectorRecipe: '<svg><text>Bang</text></svg>',
    });
    expect(snapshot.documents[0].snapshots).toHaveLength(1);
    expect(snapshot.documents[0].snapshots?.[0]).toMatchObject({
      id: 'snapshot-1',
      name: 'Before edits',
      updatedAt: 15,
    });
    expect(snapshot.documents[0].snapshots?.[0].layers[0]).toMatchObject({
      id: 'vector-1',
      type: 'vector',
      bitmap: null,
      mask: null,
      vectorRecipe: '<svg><text>Bang</text></svg>',
    });
    expect((snapshot.documents[0] as unknown as {
      savedSelectionChannels?: Array<{ id: string; name: string; dataBase64: string }>;
    }).savedSelectionChannels).toEqual([
      expect.objectContaining({
        id: 'alpha-1',
        name: 'Saved hair mask',
        dataBase64: 'AAAA',
      }),
    ]);
    expect((snapshot.documents[0] as unknown as {
      spotChannels?: Array<{ id: string; name: string; dataBase64: string; opacity: number; solidity: number }>;
    }).spotChannels).toEqual([
      expect.objectContaining({
        id: 'spot-1',
        name: 'Varnish',
        dataBase64: 'AAAA',
        opacity: 0.75,
        solidity: 0.5,
      }),
    ]);
  });

  it('restoreProjectSnapshot preserves sanitized spot channels', () => {
    useImageEditorStore.getState().restoreProjectSnapshot({
      activeDocId: 'doc-restored-spot',
      quickActionMacros: [],
      documents: [{
        ...createEmptyImageDocument({ id: 'doc-restored-spot', title: 'Restored', width: 2, height: 2 }),
        spotChannels: [{
          id: 'spot-varnish',
          name: 'Varnish',
          width: 2,
          height: 2,
          color: { r: 20, g: 120, b: 220 },
          opacity: 0.75,
          solidity: 0.5,
          visible: false,
          dataBase64: 'AAAA',
          createdAt: 13,
          updatedAt: 14,
        }],
      }],
    });

    expect(useImageEditorStore.getState().getActiveDocument()?.spotChannels).toEqual([
      expect.objectContaining({
        id: 'spot-varnish',
        name: 'Varnish',
        color: { r: 20, g: 120, b: 220 },
        opacity: 0.75,
        solidity: 0.5,
        visible: false,
        dataBase64: 'AAAA',
      }),
    ]);
  });

  it('exports and restores saved quick action macros in the Image project snapshot', () => {
    setupDoc();
    useImageEditorStore.setState({
      quickActionMacros: [{
        id: 'macro-1',
        name: 'Center and fade',
        createdAt: 10,
        updatedAt: 20,
        steps: [
          { actionId: 'centerLayer' },
          { actionId: 'setLayerOpacity50' },
        ],
      }],
    });

    const snapshot = useImageEditorStore.getState().exportProjectSnapshot();
    expect(snapshot.quickActionMacros).toEqual([
      expect.objectContaining({
        id: 'macro-1',
        name: 'Center and fade',
        steps: [
          { actionId: 'centerLayer' },
          { actionId: 'setLayerOpacity50' },
        ],
      }),
    ]);

    useImageEditorStore.getState().restoreProjectSnapshot(undefined);
    expect(useImageEditorStore.getState().quickActionMacros).toEqual([]);

    useImageEditorStore.getState().restoreProjectSnapshot(snapshot);
    expect(useImageEditorStore.getState().quickActionMacros).toEqual([
      expect.objectContaining({
        id: 'macro-1',
        name: 'Center and fade',
        steps: [
          { actionId: 'centerLayer' },
          { actionId: 'setLayerOpacity50' },
        ],
      }),
    ]);
  });

  it('renames saved quick action macros and preserves the new name in project snapshots', () => {
    setupDoc();
    useImageEditorStore.setState({
      quickActionMacros: [{
        id: 'macro-1',
        name: 'Action 1',
        createdAt: 10,
        updatedAt: 10,
        steps: [{ actionId: 'centerLayer' }],
      }],
    });

    useImageEditorStore.getState().renameQuickActionMacro('macro-1', 'Batch Center');
    expect(useImageEditorStore.getState().quickActionMacros).toEqual([
      expect.objectContaining({
        id: 'macro-1',
        name: 'Batch Center',
      }),
    ]);

    const snapshot = useImageEditorStore.getState().exportProjectSnapshot();
    expect(snapshot.quickActionMacros).toEqual([
      expect.objectContaining({
        id: 'macro-1',
        name: 'Batch Center',
      }),
    ]);
  });

  it('updateLayer patches a single layer', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1' }));
    useImageEditorStore.getState().updateLayer('doc-1', 'l1', { opacity: 0.5, visible: false });
    const layer = useImageEditorStore.getState().getActiveDocument()!.layers[0];
    expect(layer.opacity).toBe(0.5);
    expect(layer.visible).toBe(false);
  });

  it('does not mark the document dirty or emit when a layer patch is unchanged', () => {
    const doc = createEmptyImageDocument({ id: 'doc-1', title: 'a', width: 10, height: 10 });
    useImageEditorStore.setState({
      documents: [{
        ...doc,
        layers: [makeLayer({ id: 'l1', opacity: 1 })],
        activeLayerId: 'l1',
        dirty: false,
      }],
      activeDocId: 'doc-1',
    });
    const before = useImageEditorStore.getState();
    const notifications: Array<ReturnType<typeof useImageEditorStore.getState>> = [];
    const unsubscribe = useImageEditorStore.subscribe((state) => {
      notifications.push(state);
    });

    try {
      before.updateLayer('doc-1', 'l1', { opacity: 1 });
    } finally {
      unsubscribe();
    }

    const after = useImageEditorStore.getState();
    expect(after.documents).toBe(before.documents);
    expect(after.getActiveDocument()!.dirty).toBe(false);
    expect(notifications).toHaveLength(0);
  });

  it('bumpLayerBitmapVersion invalidates in-place bitmap edits', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1' }));
    useImageEditorStore.getState().bumpLayerBitmapVersion('doc-1', 'l1');
    useImageEditorStore.getState().bumpLayerBitmapVersion('doc-1', 'l1');
    const layer = useImageEditorStore.getState().getActiveDocument()!.layers[0];
    expect(layer.bitmapVersion).toBe(2);
  });

  it('reorderLayer moves to new index', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1' }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l2' }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l3' }));
    useImageEditorStore.getState().reorderLayer('doc-1', 'l1', 2);
    const order = useImageEditorStore.getState().getActiveDocument()!.layers.map((l) => l.id);
    expect(order).toEqual(['l2', 'l3', 'l1']);
  });

  it('setActiveLayer changes activeLayerId without mutating layers', () => {
    setupDoc();
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l1' }));
    useImageEditorStore.getState().addLayer('doc-1', makeLayer({ id: 'l2' }));
    useImageEditorStore.getState().setActiveLayer('doc-1', 'l1');
    expect(useImageEditorStore.getState().getActiveDocument()!.activeLayerId).toBe('l1');
  });
});

describe('imageEditorStore — undo/redo log', () => {
  beforeEach(resetStore);

  const op: EditorOperation = {
    kind: 'transform',
    docId: 'doc-1',
    layerId: 'l1',
    before: { x: 0, y: 0 },
    after: { x: 10, y: 20 },
  };

  it('pushOperation adds to undo stack and clears redo', () => {
    useImageEditorStore.getState().pushOperation(op);
    const state = useImageEditorStore.getState();
    expect(state.undoStacks['doc-1']).toHaveLength(1);
    expect(state.redoStacks['doc-1']).toEqual([]);
  });

  it('popUndo returns the latest op and moves it to redo', () => {
    useImageEditorStore.getState().pushOperation(op);
    const popped = useImageEditorStore.getState().popUndo('doc-1');
    expect(popped).toEqual(op);
    expect(useImageEditorStore.getState().redoStacks['doc-1']).toHaveLength(1);
  });

  it('popRedo moves the op back onto undo', () => {
    useImageEditorStore.getState().pushOperation(op);
    useImageEditorStore.getState().popUndo('doc-1');
    const redone = useImageEditorStore.getState().popRedo('doc-1');
    expect(redone).toEqual(op);
    expect(useImageEditorStore.getState().undoStacks['doc-1']).toHaveLength(1);
  });

  it('pushOperation after a popUndo clears redo (redo branch is destroyed)', () => {
    useImageEditorStore.getState().pushOperation(op);
    useImageEditorStore.getState().popUndo('doc-1');
    expect(useImageEditorStore.getState().redoStacks['doc-1']).toHaveLength(1);
    useImageEditorStore.getState().pushOperation({ ...op, after: { x: 99, y: 99 } });
    expect(useImageEditorStore.getState().redoStacks['doc-1']).toEqual([]);
  });

  it('undo stack capped at 50 entries', () => {
    for (let i = 0; i < 60; i += 1) {
      useImageEditorStore.getState().pushOperation({
        ...op,
        before: { x: i, y: 0 },
        after: { x: i + 1, y: 0 },
      });
    }
    const stack = useImageEditorStore.getState().undoStacks['doc-1'];
    expect(stack).toHaveLength(50);
    expect(stack[0].kind).toBe('transform');
    if (stack[0].kind === 'transform') {
      expect(stack[0].before.x).toBe(10);
    }
  });

  it('clearHistory empties both stacks', () => {
    useImageEditorStore.getState().pushOperation(op);
    useImageEditorStore.getState().popUndo('doc-1');
    useImageEditorStore.getState().clearHistory('doc-1');
    expect(useImageEditorStore.getState().undoStacks['doc-1']).toEqual([]);
    expect(useImageEditorStore.getState().redoStacks['doc-1']).toEqual([]);
  });
});

describe('imageEditorStore — view settings and guides', () => {
  beforeEach(() => {
    resetStore();
    useImageEditorStore.setState({ imageViewSettings: { ...DEFAULT_IMAGE_VIEW_SETTINGS } });
    const doc = createEmptyImageDocument({ id: 'doc-g', title: 'Guides', width: 400, height: 300 });
    useImageEditorStore.getState().openDocument(doc);
  });

  it('toggles rulers/grid/guides/snap view settings', () => {
    const before = useImageEditorStore.getState().imageViewSettings.rulers;
    useImageEditorStore.getState().toggleImageViewSetting('rulers');
    expect(useImageEditorStore.getState().imageViewSettings.rulers).toBe(!before);
    useImageEditorStore.getState().toggleImageViewSetting('grid');
    expect(useImageEditorStore.getState().imageViewSettings.grid).toBe(true);
  });

  it('clamps grid spacing', () => {
    useImageEditorStore.getState().setImageGridSpacing(0);
    expect(useImageEditorStore.getState().imageViewSettings.gridSpacing).toBeGreaterThanOrEqual(2);
    useImageEditorStore.getState().setImageGridSpacing(120);
    expect(useImageEditorStore.getState().imageViewSettings.gridSpacing).toBe(120);
  });

  it('adds, moves, removes, and clears document guides', () => {
    const store = useImageEditorStore.getState();
    store.addImageGuide('doc-g', 'x', 100);
    store.addImageGuide('doc-g', 'y', 50);
    let guides = useImageEditorStore.getState().documents.find((d) => d.id === 'doc-g')?.guides ?? [];
    expect(guides).toHaveLength(2);
    expect(guides.find((g) => g.axis === 'x')?.position).toBe(100);

    const xGuideId = guides.find((g) => g.axis === 'x')!.id;
    useImageEditorStore.getState().updateImageGuidePosition('doc-g', xGuideId, 175.6);
    guides = useImageEditorStore.getState().documents.find((d) => d.id === 'doc-g')?.guides ?? [];
    expect(guides.find((g) => g.id === xGuideId)?.position).toBe(176);

    useImageEditorStore.getState().removeImageGuide('doc-g', xGuideId);
    guides = useImageEditorStore.getState().documents.find((d) => d.id === 'doc-g')?.guides ?? [];
    expect(guides).toHaveLength(1);

    useImageEditorStore.getState().clearImageGuides('doc-g');
    guides = useImageEditorStore.getState().documents.find((d) => d.id === 'doc-g')?.guides ?? [];
    expect(guides).toHaveLength(0);
  });
});
