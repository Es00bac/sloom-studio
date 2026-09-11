import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CROP_TOOL_SETTINGS,
  type BrushSettings,
  type ImageDocument,
  type ImageLayer,
  type LayerBitmap,
  type SelectionToolSettings,
} from '../../../types/imageEditor';
import { createEmptyImageDocument, useImageEditorStore } from '../../../store/imageEditorStore';
import { beginTransformPreviewSession, clearTransformPreviewSession } from '../ImageTransformPreview';
import { createMask, maskBoundingBox } from '../SelectionMask';
import { clearAllSelections, getSelection, setSelection } from '../selectionRegistry';
import {
  beginSelectionTransformSession,
  clearSelectionTransformSession,
  getSelectionTransformSession,
  updateSelectionTransformBounds,
} from '../ImageSelectionTransform';
import type { ToolEnv } from './types';
import * as moveToolModule from './moveTool';
import { moveTool } from './moveTool';

type DescribeMoveToolWorkflow = (
  doc: ImageDocument,
  activeLayerId?: string | null,
) => unknown;
type DescribeMoveToolParityPlan = (
  doc: ImageDocument,
  activeLayerId?: string | null,
) => unknown;
type CalculateMoveToolSnappedDelta = (
  plan: unknown,
  delta: { dx: number; dy: number },
) => unknown;

const brushSettings: BrushSettings = {
  size: 12,
  opacity: 1,
  hardness: 1,
  flow: 1,
  color: '#00ffff',
  spacing: 0.2,
  angleDeg: 0,
  roundness: 1,
  scatter: 0,
  smoothing: 0,
  pressureSize: 0,
  pressureOpacity: 0,
  pressureFlow: 0,
  tipShape: 'round',
};

const selectionToolSettings: SelectionToolSettings = {
  mode: 'replace',
  feather: 0,
  antiAlias: true,
  marqueeShape: 'rectangle',
  lassoShape: 'freehand',
  magicWandTolerance: 32,
  sampleAllLayers: true,
  contiguous: true,
  paintBucketBlendMode: 'normal',
  paintBucketPreserveTransparency: false,
};

const mods = { shift: false, alt: false, ctrl: false, meta: false };

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
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    ...patch,
  };
}

function testBitmap(width: number, height: number): LayerBitmap {
  return { width, height } as LayerBitmap;
}

function docWith(activeLayer: ImageLayer): ImageDocument {
  return {
    id: 'doc-1',
    title: 'Move locks',
    width: 320,
    height: 240,
    layers: [activeLayer],
    activeLayerId: activeLayer.id,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function docWithLayers(layers: ImageLayer[], activeLayerId = layers[0]?.id ?? ''): ImageDocument {
  return {
    ...docWith(layers.find((entry) => entry.id === activeLayerId) ?? layers[0]),
    layers,
    activeLayerId,
  };
}

function envWith(activeLayer: ImageLayer, docOverride?: ImageDocument): ToolEnv {
  const doc = docOverride ?? docWith(activeLayer);
  return {
    doc,
    activeLayer,
    brushSettings,
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    selectionToolSettings,
    screenToDoc: (point) => point,
    docToScreen: (point) => point,
    pushOperation: vi.fn(),
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store: {
      updateLayer: vi.fn(),
    } as unknown as ToolEnv['store'],
  };
}

describe('moveTool layer locks', () => {
  beforeEach(() => {
    clearTransformPreviewSession();
    clearSelectionTransformSession();
    clearAllSelections();
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
    moveTool.onCancel?.(envWith(layer()));
  });

  it('does not move a position-locked layer', () => {
    const env = envWith(layer({ locks: { position: true } } as Partial<ImageLayer>));

    moveTool.onPointerDown?.(env, { x: 12, y: 18 }, mods, {} as PointerEvent);
    moveTool.onPointerMove?.(env, { x: 42, y: 58 }, mods, {} as PointerEvent);
    moveTool.onPointerUp?.(env, { x: 42, y: 58 }, mods, {} as PointerEvent);

    expect(env.store.updateLayer).not.toHaveBeenCalled();
    expect(env.requestRender).not.toHaveBeenCalled();
    expect(env.pushOperation).not.toHaveBeenCalled();
  });

  it('moves linked layer companions by the same drag delta', () => {
    const paint = layer({ id: 'paint', x: 10, y: 20, linkGroupId: 'link-a' });
    const shadow = layer({ id: 'shadow', x: 30, y: 40, linkGroupId: 'link-a' });
    const loose = layer({ id: 'loose', x: 80, y: 90 });
    const doc = docWithLayers([shadow, loose, paint], 'paint');
    const env = envWith(paint, doc);

    moveTool.onPointerDown?.(env, { x: 10, y: 10 }, mods, {} as PointerEvent);
    moveTool.onPointerMove?.(env, { x: 18, y: 4 }, mods, {} as PointerEvent);

    expect(env.store.updateLayer).toHaveBeenCalledWith('doc-1', 'shadow', { x: 38, y: 34 });
    expect(env.store.updateLayer).toHaveBeenCalledWith('doc-1', 'paint', { x: 18, y: 14 });
    expect(env.store.updateLayer).not.toHaveBeenCalledWith('doc-1', 'loose', expect.anything());
  });

  it('moves all ad-hoc multi-selected layers by the same drag delta', () => {
    const paint = layer({ id: 'paint', x: 10, y: 20 });
    const text = layer({ id: 'text', x: 50, y: 60 });
    const loose = layer({ id: 'loose', x: 200, y: 200 });
    const doc = { ...docWithLayers([paint, text, loose], 'paint'), selectedLayerIds: ['paint', 'text'] };
    const env = envWith(paint, doc);

    moveTool.onPointerDown?.(env, { x: 10, y: 10 }, mods, {} as PointerEvent);
    moveTool.onPointerMove?.(env, { x: 25, y: 30 }, mods, {} as PointerEvent);

    expect(env.store.updateLayer).toHaveBeenCalledWith('doc-1', 'paint', { x: 25, y: 40 });
    expect(env.store.updateLayer).toHaveBeenCalledWith('doc-1', 'text', { x: 65, y: 80 });
    expect(env.store.updateLayer).not.toHaveBeenCalledWith('doc-1', 'loose', expect.anything());
  });

  it('skips position-locked layers inside an ad-hoc multi-selection', () => {
    const paint = layer({ id: 'paint', x: 10, y: 20 });
    const fixed = layer({ id: 'fixed', x: 50, y: 60, locks: { position: true } } as Partial<ImageLayer>);
    const doc = { ...docWithLayers([paint, fixed], 'paint'), selectedLayerIds: ['paint', 'fixed'] };
    const env = envWith(paint, doc);

    moveTool.onPointerDown?.(env, { x: 10, y: 10 }, mods, {} as PointerEvent);
    moveTool.onPointerMove?.(env, { x: 25, y: 30 }, mods, {} as PointerEvent);

    expect(env.store.updateLayer).toHaveBeenCalledWith('doc-1', 'paint', { x: 25, y: 40 });
    expect(env.store.updateLayer).not.toHaveBeenCalledWith('doc-1', 'fixed', expect.anything());
  });

  it('applies smart snap deltas during live move dragging', () => {
    const paint = layer({ id: 'paint', name: 'Paint', x: 9, y: 20, bitmap: testBitmap(40, 30) });
    const loose = layer({ id: 'loose', name: 'Loose', x: 120, y: 50, bitmap: testBitmap(24, 18) });
    const doc = docWithLayers([loose, paint], 'paint');
    const env = envWith(paint, doc);

    moveTool.onPointerDown?.(env, { x: 0, y: 0 }, mods, {} as PointerEvent);
    moveTool.onPointerMove?.(env, { x: 70, y: 2 }, mods, {} as PointerEvent);

    expect(env.store.updateLayer).toHaveBeenCalledWith('doc-1', 'paint', { x: 80, y: 20 });
  });

  it('starts and moves a selection transform when dragging inside an active selection', () => {
    const paint = layer({ id: 'paint', name: 'Paint', x: 0, y: 0, bitmap: testBitmap(10, 10) });
    const document = {
      ...createEmptyImageDocument({
        id: 'doc-move-selection-drag',
        title: 'Selection Drag',
        width: 10,
        height: 10,
      }),
      layers: [paint],
      activeLayerId: paint.id,
    };
    useImageEditorStore.getState().openDocument(document);
    const store = useImageEditorStore.getState();
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(document.id, selection);
    store.setHasSelection(document.id, true);
    const requestRender = vi.fn();
    const liveDoc = store.documents[0]!;
    const liveEnv: ToolEnv = {
      doc: liveDoc,
      activeLayer: liveDoc.layers[0]!,
      brushSettings,
      cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
      selectionToolSettings,
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: store.pushOperation,
      requestRender,
      resolveSelectionMode: () => 'replace',
      store,
    };

    moveTool.onPointerDown?.(liveEnv, { x: 2, y: 2 }, mods, {} as PointerEvent);
    moveTool.onPointerMove?.({
      ...liveEnv,
      doc: useImageEditorStore.getState().documents[0]!,
      store: useImageEditorStore.getState(),
    }, { x: 5, y: 4 }, mods, {} as PointerEvent);

    expect(getSelectionTransformSession(liveDoc.id)?.currentBounds).toEqual({ x: 5, y: 4, width: 2, height: 2 });
    expect(maskBoundingBox(getSelection(liveDoc.id)!)).toEqual({ x: 5, y: 4, width: 2, height: 2 });
    expect(useImageEditorStore.getState().documents[0]!.layers[0]).toMatchObject({ x: 0, y: 0 });
    expect(requestRender).toHaveBeenCalled();
  });

  it('commits a dragged selection transform on pointer release', () => {
    const paint = layer({ id: 'paint', name: 'Paint', x: 0, y: 0, bitmap: testBitmap(10, 10) });
    const document = {
      ...createEmptyImageDocument({
        id: 'doc-move-selection-release',
        title: 'Selection Release',
        width: 10,
        height: 10,
      }),
      layers: [paint],
      activeLayerId: paint.id,
    };
    useImageEditorStore.getState().openDocument(document);
    const store = useImageEditorStore.getState();
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(document.id, selection);
    store.setHasSelection(document.id, true);
    const requestRender = vi.fn();
    const liveDoc = store.documents[0]!;
    const liveEnv: ToolEnv = {
      doc: liveDoc,
      activeLayer: liveDoc.layers[0]!,
      brushSettings,
      cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
      selectionToolSettings,
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: store.pushOperation,
      requestRender,
      resolveSelectionMode: () => 'replace',
      store,
    };

    moveTool.onPointerDown?.(liveEnv, { x: 2, y: 2 }, mods, {} as PointerEvent);
    moveTool.onPointerMove?.({
      ...liveEnv,
      doc: useImageEditorStore.getState().documents[0]!,
      store: useImageEditorStore.getState(),
    }, { x: 5, y: 4 }, mods, {} as PointerEvent);
    moveTool.onPointerUp?.({
      ...liveEnv,
      doc: useImageEditorStore.getState().documents[0]!,
      store: useImageEditorStore.getState(),
    }, { x: 5, y: 4 }, mods, {} as PointerEvent);

    expect(maskBoundingBox(getSelection(liveDoc.id)!)).toEqual({ x: 5, y: 4, width: 2, height: 2 });
    expect(getSelectionTransformSession(liveDoc.id)).toBeNull();
    expect(useImageEditorStore.getState().undoStacks[liveDoc.id]?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: liveDoc.id,
    });
  });

  it('cancels an active selection drag by restoring the original selection', () => {
    const paint = layer({ id: 'paint', name: 'Paint', x: 0, y: 0, bitmap: testBitmap(10, 10) });
    const document = {
      ...createEmptyImageDocument({
        id: 'doc-move-selection-cancel',
        title: 'Selection Cancel',
        width: 10,
        height: 10,
      }),
      layers: [paint],
      activeLayerId: paint.id,
    };
    useImageEditorStore.getState().openDocument(document);
    const store = useImageEditorStore.getState();
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(document.id, selection);
    store.setHasSelection(document.id, true);
    const requestRender = vi.fn();
    const liveDoc = store.documents[0]!;
    const liveEnv: ToolEnv = {
      doc: liveDoc,
      activeLayer: liveDoc.layers[0]!,
      brushSettings,
      cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
      selectionToolSettings,
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: store.pushOperation,
      requestRender,
      resolveSelectionMode: () => 'replace',
      store,
    };

    moveTool.onPointerDown?.(liveEnv, { x: 2, y: 2 }, mods, {} as PointerEvent);
    moveTool.onPointerMove?.({
      ...liveEnv,
      doc: useImageEditorStore.getState().documents[0]!,
      store: useImageEditorStore.getState(),
    }, { x: 5, y: 4 }, mods, {} as PointerEvent);
    moveTool.onCancel?.({
      ...liveEnv,
      doc: useImageEditorStore.getState().documents[0]!,
      store: useImageEditorStore.getState(),
    });

    expect(maskBoundingBox(getSelection(liveDoc.id)!)).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(getSelectionTransformSession(liveDoc.id)).toBeNull();
    expect(useImageEditorStore.getState().undoStacks[liveDoc.id]).toBeUndefined();
  });

  it('builds deterministic workflow metadata for move, align, snap, and nudge behavior', () => {
    const describeMoveToolWorkflow = (
      moveToolModule as unknown as { describeMoveToolWorkflow?: DescribeMoveToolWorkflow }
    ).describeMoveToolWorkflow;
    const paint = layer({ id: 'paint', name: 'Paint', x: 10, y: 20, linkGroupId: 'link-a' });
    const shadow = layer({ id: 'shadow', name: 'Shadow', x: 30, y: 40, linkGroupId: 'link-a' });
    const locked = layer({
      id: 'locked',
      name: 'Locked',
      x: 50,
      y: 60,
      linkGroupId: 'link-a',
      locks: { position: true },
    } as Partial<ImageLayer>);
    const loose = layer({ id: 'loose', name: 'Loose', x: 80, y: 90 });
    const doc = docWithLayers([shadow, loose, locked, paint], 'paint');

    expect(describeMoveToolWorkflow?.(doc, 'paint')).toEqual({
      descriptorId: 'move-tool-workflow:v1',
      document: { id: 'doc-1', width: 320, height: 240 },
      activeLayerId: 'paint',
      activeLayerType: 'image',
      movement: {
        supported: true,
        mode: 'linked-layer-group',
        linkedLayerIds: ['shadow', 'locked', 'paint'],
        movableLayerIds: ['shadow', 'paint'],
        stationaryLayers: [
          { layerId: 'locked', reason: 'position-lock' },
        ],
        drag: {
          updates: 'live-layer-position',
          axisConstraint: 'shift-dominant-axis',
          undoOperation: 'layerOp',
        },
      },
      sourceSafety: {
        metadataOnly: true,
        mutatesPixels: false,
        mutatesSourceAssets: false,
        sourceLinkedLayerIds: [],
        missingSourceLayerIds: [],
        relinkedSourceLayerIds: [],
        sourceIds: [],
        warnings: [],
        signature: 'move-tool-source-safety:v1:{"layers":[],"missing":[],"relinked":[],"sourceIds":[]}',
      },
      nudge: {
        supported: true,
        incrementsPx: [1, 10],
        commands: [
          { id: 'nudgeLayerLeft', dx: -1, dy: 0 },
          { id: 'nudgeLayerRight', dx: 1, dy: 0 },
          { id: 'nudgeLayerUp', dx: 0, dy: -1 },
          { id: 'nudgeLayerDown', dx: 0, dy: 1 },
          { id: 'nudgeLayerLeftLarge', dx: -10, dy: 0 },
          { id: 'nudgeLayerRightLarge', dx: 10, dy: 0 },
          { id: 'nudgeLayerUpLarge', dx: 0, dy: -10 },
          { id: 'nudgeLayerDownLarge', dx: 0, dy: 10 },
        ],
      },
      align: {
        supported: true,
        target: 'canvas',
        commands: [
          { id: 'alignLayerLeft', axis: 'x', edge: 'min', x: 0 },
          { id: 'alignLayerRight', axis: 'x', edge: 'max', x: 320 },
          { id: 'alignLayerTop', axis: 'y', edge: 'min', y: 0 },
          { id: 'alignLayerBottom', axis: 'y', edge: 'max', y: 240 },
          { id: 'centerLayerHorizontal', axis: 'x', edge: 'center', x: 160 },
          { id: 'centerLayerVertical', axis: 'y', edge: 'center', y: 120 },
        ],
        unsupportedTargets: [
          'selection',
          'multi-layer-selection',
        ],
      },
      snap: {
        supported: true,
        modes: ['document-guides', 'layer-edges', 'layer-centers'],
        appliedDuring: 'runtime-drag',
        snapDistancePx: 8,
        warnings: [],
      },
      distribute: {
        supported: false,
        commands: ['distribute-horizontal-centers', 'distribute-vertical-centers', 'distribute-spacing'],
        unsupportedReason: 'Layer distribution requires multi-layer selection bounds and is not implemented by the current Move tool workflow.',
        warnings: [
          {
            code: 'move-distribution-unsupported',
            severity: 'warning',
            message: 'Layer distribution requires multi-layer selection bounds and is not implemented by the current Move tool workflow.',
          },
        ],
      },
      transformStatus: {
        destructive: false,
        nonDestructive: true,
        commitModel: 'live-position-metadata',
      },
      preview: {
        id: 'move-tool-workflow:doc-1:paint',
        signature: 'move-tool-workflow:v1:{"docId":"doc-1","activeLayerId":"paint","movableLayerIds":["shadow","paint"],"stationaryLayerIds":["locked"],"dragSupported":true,"nudgeSteps":[1,10],"alignCommands":["alignLayerLeft","alignLayerRight","alignLayerTop","alignLayerBottom","centerLayerHorizontal","centerLayerVertical"],"snapSupported":true,"distributeSupported":false}',
      },
      exportCaveats: [
        {
          code: 'move-export-uses-layer-position',
          severity: 'info',
          message: 'Move commits update layer position metadata; export uses the committed layer coordinates without additional smart-object instructions.',
        },
      ],
      previewSignature: 'move-tool-workflow:v1:{"docId":"doc-1","activeLayerId":"paint","movableLayerIds":["shadow","paint"],"stationaryLayerIds":["locked"],"dragSupported":true,"nudgeSteps":[1,10],"alignCommands":["alignLayerLeft","alignLayerRight","alignLayerTop","alignLayerBottom","centerLayerHorizontal","centerLayerVertical"],"snapSupported":true,"distributeSupported":false}',
    });
  });

  it('describes runtime snapping and unsupported distribution warnings with preview identity', () => {
    const describeMoveToolWorkflow = (
      moveToolModule as unknown as { describeMoveToolWorkflow?: DescribeMoveToolWorkflow }
    ).describeMoveToolWorkflow;
    const paint = layer({ id: 'paint', name: 'Paint', x: 10, y: 20 });
    const doc = docWithLayers([paint], 'paint');
    const descriptor = describeMoveToolWorkflow?.(doc, 'paint') as {
      previewSignature: string;
    };

    expect(descriptor).toMatchObject({
      preview: {
        id: 'move-tool-workflow:doc-1:paint',
        signature: descriptor.previewSignature,
      },
      transformStatus: {
        destructive: false,
        nonDestructive: true,
        commitModel: 'live-position-metadata',
      },
      snap: {
        supported: true,
        modes: ['document-guides', 'layer-edges', 'layer-centers'],
        appliedDuring: 'runtime-drag',
        snapDistancePx: 8,
        warnings: [],
      },
      distribute: {
        supported: false,
        commands: ['distribute-horizontal-centers', 'distribute-vertical-centers', 'distribute-spacing'],
        warnings: [
          {
            code: 'move-distribution-unsupported',
            severity: 'warning',
            message: 'Layer distribution requires multi-layer selection bounds and is not implemented by the current Move tool workflow.',
          },
        ],
      },
      exportCaveats: [
        {
          code: 'move-export-uses-layer-position',
          severity: 'info',
          message: 'Move commits update layer position metadata; export uses the committed layer coordinates without additional smart-object instructions.',
        },
      ],
    });
  });

  it('plans deterministic move geometry, snap candidates, command readiness, and blockers', () => {
    const describeMoveToolParityPlan = (
      moveToolModule as unknown as { describeMoveToolParityPlan?: DescribeMoveToolParityPlan }
    ).describeMoveToolParityPlan;
    const paint = layer({
      id: 'paint',
      name: 'Paint',
      x: 9,
      y: 20,
      linkGroupId: 'link-a',
      bitmap: testBitmap(40, 30),
      metadata: {
        sourceLink: {
          id: 'source-paint',
          label: 'Paint Source',
          status: 'linked',
          relinkHistory: [],
        },
      },
    });
    const shadow = layer({
      id: 'shadow',
      name: 'Shadow',
      x: 30,
      y: 40,
      linkGroupId: 'link-a',
      bitmap: testBitmap(20, 10),
    });
    const locked = layer({
      id: 'locked',
      name: 'Locked',
      x: 80,
      y: 90,
      linkGroupId: 'link-a',
      locks: { position: true },
      bitmap: testBitmap(12, 14),
      metadata: {
        sourceLink: {
          id: 'source-locked',
          label: 'Missing Source',
          status: 'missing',
          relinkHistory: [],
        },
      },
    } as Partial<ImageLayer>);
    const loose = layer({
      id: 'loose',
      name: 'Loose',
      x: 120,
      y: 50,
      bitmap: testBitmap(24, 18),
    });
    const doc = docWithLayers([shadow, loose, locked, paint], 'paint');

    expect(describeMoveToolParityPlan?.(doc, 'paint')).toEqual({
      descriptorId: 'move-tool-parity-plan:v1',
      documentBounds: { x: 0, y: 0, width: 320, height: 240, centerX: 160, centerY: 120 },
      activeLayerId: 'paint',
      snapDistancePx: 8,
      runtimeSnapping: {
        supported: true,
        previewOnly: false,
        appliedDuring: 'runtime-drag',
        modes: ['document-guides', 'layer-edges', 'layer-centers'],
        warnings: [],
      },
      runtimeDistribution: {
        supported: false,
        previewOnly: true,
        commands: [
          'distribute-horizontal-centers',
          'distribute-vertical-centers',
          'distribute-horizontal-spacing',
          'distribute-vertical-spacing',
        ],
        unsupportedReason: 'Layer distribution requires multi-layer selection bounds and is not applied by runtime Move dragging.',
        warnings: [
          {
            code: 'move-distribution-unsupported',
            severity: 'warning',
            message: 'Layer distribution requires multi-layer selection bounds and is not applied by runtime Move dragging.',
          },
        ],
      },
      sourceSafety: {
        metadataOnly: true,
        mutatesPixels: false,
        mutatesSourceAssets: false,
        sourceLinkedLayerIds: ['locked', 'paint'],
        missingSourceLayerIds: ['locked'],
        relinkedSourceLayerIds: [],
        sourceIds: ['source-locked', 'source-paint'],
        warnings: [
          {
            code: 'move-source-metadata-only',
            severity: 'info',
            layerIds: ['locked', 'paint'],
            message: 'Move updates linked layer position metadata only; source assets are not rewritten.',
          },
          {
            code: 'move-source-link-missing',
            severity: 'warning',
            layerIds: ['locked'],
            message: 'Some source-linked layers are missing their Source Library asset; movement is metadata-only but relink/replace remains blocked.',
          },
        ],
        signature: 'move-tool-source-safety:v1:{"layers":["locked","paint"],"missing":["locked"],"relinked":[],"sourceIds":["source-locked","source-paint"]}',
      },
      movableGeometry: [
        {
          layerId: 'shadow',
          name: 'Shadow',
          type: 'image',
          bounds: { x: 30, y: 40, width: 20, height: 10, centerX: 40, centerY: 45 },
          snapPoints: { x: [30, 40, 50], y: [40, 45, 50] },
        },
        {
          layerId: 'paint',
          name: 'Paint',
          type: 'image',
          bounds: { x: 9, y: 20, width: 40, height: 30, centerX: 29, centerY: 35 },
          snapPoints: { x: [9, 29, 49], y: [20, 35, 50] },
        },
      ],
      stationaryGeometry: [
        {
          layerId: 'loose',
          name: 'Loose',
          type: 'image',
          reason: 'not-selected',
          bounds: { x: 120, y: 50, width: 24, height: 18, centerX: 132, centerY: 59 },
          snapPoints: { x: [120, 132, 144], y: [50, 59, 68] },
        },
        {
          layerId: 'locked',
          name: 'Locked',
          type: 'image',
          reason: 'position-lock',
          bounds: { x: 80, y: 90, width: 12, height: 14, centerX: 86, centerY: 97 },
          snapPoints: { x: [80, 86, 92], y: [90, 97, 104] },
        },
      ],
      snapGuides: {
        vertical: [
          { id: 'document-left', source: 'document', axis: 'x', value: 0 },
          { id: 'document-center-x', source: 'document', axis: 'x', value: 160 },
          { id: 'document-right', source: 'document', axis: 'x', value: 320 },
          { id: 'layer-loose-left', source: 'layer', layerId: 'loose', axis: 'x', value: 120 },
          { id: 'layer-loose-center-x', source: 'layer', layerId: 'loose', axis: 'x', value: 132 },
          { id: 'layer-loose-right', source: 'layer', layerId: 'loose', axis: 'x', value: 144 },
          { id: 'layer-locked-left', source: 'layer', layerId: 'locked', axis: 'x', value: 80 },
          { id: 'layer-locked-center-x', source: 'layer', layerId: 'locked', axis: 'x', value: 86 },
          { id: 'layer-locked-right', source: 'layer', layerId: 'locked', axis: 'x', value: 92 },
        ],
        horizontal: [
          { id: 'document-top', source: 'document', axis: 'y', value: 0 },
          { id: 'document-center-y', source: 'document', axis: 'y', value: 120 },
          { id: 'document-bottom', source: 'document', axis: 'y', value: 240 },
          { id: 'layer-loose-top', source: 'layer', layerId: 'loose', axis: 'y', value: 50 },
          { id: 'layer-loose-center-y', source: 'layer', layerId: 'loose', axis: 'y', value: 59 },
          { id: 'layer-loose-bottom', source: 'layer', layerId: 'loose', axis: 'y', value: 68 },
          { id: 'layer-locked-top', source: 'layer', layerId: 'locked', axis: 'y', value: 90 },
          { id: 'layer-locked-center-y', source: 'layer', layerId: 'locked', axis: 'y', value: 97 },
          { id: 'layer-locked-bottom', source: 'layer', layerId: 'locked', axis: 'y', value: 104 },
        ],
      },
      candidateSnapTargets: [
        { guideId: 'document-left', axis: 'x', source: 'document', value: 0, nearestMovableLayerId: 'paint', movablePoint: 9, requiredDelta: -9, withinSnapDistance: false },
        { guideId: 'document-center-x', axis: 'x', source: 'document', value: 160, nearestMovableLayerId: 'shadow', movablePoint: 50, requiredDelta: 110, withinSnapDistance: false },
        { guideId: 'document-right', axis: 'x', source: 'document', value: 320, nearestMovableLayerId: 'shadow', movablePoint: 50, requiredDelta: 270, withinSnapDistance: false },
        { guideId: 'layer-locked-top', axis: 'y', source: 'layer', layerId: 'locked', value: 90, nearestMovableLayerId: 'shadow', movablePoint: 50, requiredDelta: 40, withinSnapDistance: false },
        { guideId: 'layer-loose-top', axis: 'y', source: 'layer', layerId: 'loose', value: 50, nearestMovableLayerId: 'shadow', movablePoint: 50, requiredDelta: 0, withinSnapDistance: true },
      ],
      snapCandidateSummary: {
        guideCounts: { vertical: 9, horizontal: 9, document: 6, layer: 12 },
        candidateCount: 5,
        withinSnapDistanceCount: 1,
        closestByAxis: [
          { axis: 'x', guideId: 'document-left', source: 'document', value: 0, nearestMovableLayerId: 'paint', requiredDelta: -9, withinSnapDistance: false },
          { axis: 'y', guideId: 'layer-loose-top', source: 'layer', layerId: 'loose', value: 50, nearestMovableLayerId: 'shadow', requiredDelta: 0, withinSnapDistance: true },
        ],
        signature: 'move-tool-snap-candidates:v1:{"guides":{"vertical":9,"horizontal":9,"document":6,"layer":12},"candidateCount":5,"within":1,"closest":["x:document-left:paint:-9","y:layer-loose-top:shadow:0"]}',
      },
      alignReadiness: [
        { id: 'alignLayerLeft', ready: false, target: 'canvas', blockers: ['stationary-linked-members'] },
        { id: 'alignLayerRight', ready: false, target: 'canvas', blockers: ['stationary-linked-members'] },
        { id: 'alignLayerTop', ready: false, target: 'canvas', blockers: ['stationary-linked-members'] },
        { id: 'alignLayerBottom', ready: false, target: 'canvas', blockers: ['stationary-linked-members'] },
        { id: 'centerLayerHorizontal', ready: false, target: 'canvas', blockers: ['stationary-linked-members'] },
        { id: 'centerLayerVertical', ready: false, target: 'canvas', blockers: ['stationary-linked-members'] },
      ],
      distributeReadiness: [
        { id: 'distribute-horizontal-centers', ready: false, blockers: ['stationary-linked-members', 'not-enough-movable-layers', 'multi-layer-selection-unsupported'] },
        { id: 'distribute-vertical-centers', ready: false, blockers: ['stationary-linked-members', 'not-enough-movable-layers', 'multi-layer-selection-unsupported'] },
        { id: 'distribute-horizontal-spacing', ready: false, blockers: ['stationary-linked-members', 'not-enough-movable-layers', 'multi-layer-selection-unsupported'] },
        { id: 'distribute-vertical-spacing', ready: false, blockers: ['stationary-linked-members', 'not-enough-movable-layers', 'multi-layer-selection-unsupported'] },
      ],
      blockers: [
        { code: 'stationary-layer', layerId: 'locked', reason: 'position-lock' },
      ],
      warnings: [
        {
          code: 'move-distribution-unsupported',
          severity: 'warning',
          message: 'Layer distribution requires multi-layer selection bounds and is not applied by runtime Move dragging.',
        },
      ],
      preview: {
        id: 'move-tool-parity-plan:doc-1:paint',
        signature: 'move-tool-parity-plan:v1:{"docId":"doc-1","activeLayerId":"paint","movable":["shadow:30,40,20,10","paint:9,20,40,30"],"stationary":["loose:not-selected:120,50,24,18","locked:position-lock:80,90,12,14"],"snapDistancePx":8,"snapSummary":"move-tool-snap-candidates:v1:{\\"guides\\":{\\"vertical\\":9,\\"horizontal\\":9,\\"document\\":6,\\"layer\\":12},\\"candidateCount\\":5,\\"within\\":1,\\"closest\\":[\\"x:document-left:paint:-9\\",\\"y:layer-loose-top:shadow:0\\"]}","sourceSafety":"move-tool-source-safety:v1:{\\"layers\\":[\\"locked\\",\\"paint\\"],\\"missing\\":[\\"locked\\"],\\"relinked\\":[],\\"sourceIds\\":[\\"source-locked\\",\\"source-paint\\"]}","runtimeSnapping":true,"runtimeDistribution":false,"warnings":["move-distribution-unsupported"],"alignReady":[],"distributeReady":[],"blockers":["locked:position-lock"]}',
      },
    });
  });

  it('reports precise align and distribute blockers for a locked active layer', () => {
    const describeMoveToolParityPlan = (
      moveToolModule as unknown as { describeMoveToolParityPlan?: DescribeMoveToolParityPlan }
    ).describeMoveToolParityPlan;
    const locked = layer({
      id: 'locked-active',
      name: 'Locked Active',
      x: 16,
      y: 24,
      locks: { position: true },
      bitmap: testBitmap(20, 20),
    } as Partial<ImageLayer>);
    const doc = docWithLayers([locked], 'locked-active');
    const plan = describeMoveToolParityPlan?.(doc, 'locked-active') as {
      alignReadiness: Array<{ ready: boolean; blockers?: string[] }>;
      distributeReadiness: Array<{ ready: boolean; blockers?: string[] }>;
      blockers: Array<{ code: string; layerId: string; reason: string }>;
    };

    expect(plan.alignReadiness.every((command) => command.ready === false)).toBe(true);
    expect(plan.alignReadiness.map((command) => command.blockers)).toEqual([
      ['active-layer-position-lock', 'no-movable-layers'],
      ['active-layer-position-lock', 'no-movable-layers'],
      ['active-layer-position-lock', 'no-movable-layers'],
      ['active-layer-position-lock', 'no-movable-layers'],
      ['active-layer-position-lock', 'no-movable-layers'],
      ['active-layer-position-lock', 'no-movable-layers'],
    ]);
    expect(plan.distributeReadiness.map((command) => command.blockers)).toEqual([
      ['active-layer-position-lock', 'no-movable-layers', 'multi-layer-selection-unsupported'],
      ['active-layer-position-lock', 'no-movable-layers', 'multi-layer-selection-unsupported'],
      ['active-layer-position-lock', 'no-movable-layers', 'multi-layer-selection-unsupported'],
      ['active-layer-position-lock', 'no-movable-layers', 'multi-layer-selection-unsupported'],
    ]);
    expect(plan.blockers).toEqual([
      { code: 'stationary-layer', layerId: 'locked-active', reason: 'position-lock' },
    ]);
  });

  it('reports supported runtime snapping and unsupported distribution states with stable signatures', () => {
    const describeMoveToolParityPlan = (
      moveToolModule as unknown as { describeMoveToolParityPlan?: DescribeMoveToolParityPlan }
    ).describeMoveToolParityPlan;
    const paint = layer({
      id: 'paint',
      name: 'Paint',
      x: 9,
      y: 20,
      bitmap: testBitmap(40, 30),
    });
    const doc = docWithLayers([paint], 'paint');
    const descriptor = describeMoveToolParityPlan?.(doc, 'paint') as {
      runtimeSnapping: unknown;
      runtimeDistribution: unknown;
      warnings: Array<{ code: string }>;
      preview: { signature: string };
    };

    expect(descriptor.runtimeSnapping).toEqual({
      supported: true,
      previewOnly: false,
      appliedDuring: 'runtime-drag',
      modes: ['document-guides', 'layer-edges', 'layer-centers'],
      warnings: [],
    });
    expect(descriptor.runtimeDistribution).toEqual({
      supported: false,
      previewOnly: true,
      commands: [
        'distribute-horizontal-centers',
        'distribute-vertical-centers',
        'distribute-horizontal-spacing',
        'distribute-vertical-spacing',
      ],
      unsupportedReason: 'Layer distribution requires multi-layer selection bounds and is not applied by runtime Move dragging.',
      warnings: [
        {
          code: 'move-distribution-unsupported',
          severity: 'warning',
          message: 'Layer distribution requires multi-layer selection bounds and is not applied by runtime Move dragging.',
        },
      ],
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'move-distribution-unsupported',
    ]);
    const repeatedDescriptor = describeMoveToolParityPlan?.(doc, 'paint') as { preview: { signature: string } };
    expect(descriptor.preview.signature).toBe(repeatedDescriptor.preview.signature);
    expect(descriptor.preview.signature).toContain('"runtimeSnapping":true');
    expect(descriptor.preview.signature).toContain('"runtimeDistribution":false');
  });

  it('calculates snapped deltas from the deterministic planning descriptor used by runtime dragging', () => {
    const describeMoveToolParityPlan = (
      moveToolModule as unknown as { describeMoveToolParityPlan?: DescribeMoveToolParityPlan }
    ).describeMoveToolParityPlan;
    const calculateMoveToolSnappedDelta = (
      moveToolModule as unknown as { calculateMoveToolSnappedDelta?: CalculateMoveToolSnappedDelta }
    ).calculateMoveToolSnappedDelta;
    const paint = layer({
      id: 'paint',
      name: 'Paint',
      x: 9,
      y: 20,
      bitmap: testBitmap(40, 30),
    });
    const loose = layer({
      id: 'loose',
      name: 'Loose',
      x: 120,
      y: 50,
      bitmap: testBitmap(24, 18),
    });
    const doc = docWithLayers([loose, paint], 'paint');
    const plan = describeMoveToolParityPlan?.(doc, 'paint');

    expect(calculateMoveToolSnappedDelta?.(plan, { dx: 70, dy: 2 })).toEqual({
      dx: 71,
      dy: 0,
      snapped: true,
      appliedTargets: [
        { guideId: 'layer-loose-left', axis: 'x', source: 'layer', layerId: 'loose', value: 120, movableLayerId: 'paint', movablePoint: 49 },
        { guideId: 'layer-loose-top', axis: 'y', source: 'layer', layerId: 'loose', value: 50, movableLayerId: 'paint', movablePoint: 50 },
      ],
      signature: 'move-tool-snapped-delta:v1:{"base":{"dx":70,"dy":2},"snapped":{"dx":71,"dy":0},"targets":["layer-loose-left:x:paint","layer-loose-top:y:paint"]}',
    });

    expect(calculateMoveToolSnappedDelta?.(plan, { dx: 2000, dy: 2000 })).toEqual({
      dx: 2000,
      dy: 2000,
      snapped: false,
      appliedTargets: [],
      signature: 'move-tool-snapped-delta:v1:{"base":{"dx":2000,"dy":2000},"snapped":{"dx":2000,"dy":2000},"targets":[]}',
    });
  });

  it('reports a missing active layer as a planning blocker', () => {
    const describeMoveToolParityPlan = (
      moveToolModule as unknown as { describeMoveToolParityPlan?: DescribeMoveToolParityPlan }
    ).describeMoveToolParityPlan;
    const doc = docWithLayers([layer({ id: 'paint' })], 'paint');

    expect(describeMoveToolParityPlan?.(doc, 'missing')).toMatchObject({
      activeLayerId: 'missing',
      movableGeometry: [],
      stationaryGeometry: [
        expect.objectContaining({ layerId: 'paint', reason: 'not-selected' }),
      ],
      alignReadiness: [
        { id: 'alignLayerLeft', ready: false, target: 'canvas', blockers: ['missing-active-layer'] },
        { id: 'alignLayerRight', ready: false, target: 'canvas', blockers: ['missing-active-layer'] },
        { id: 'alignLayerTop', ready: false, target: 'canvas', blockers: ['missing-active-layer'] },
        { id: 'alignLayerBottom', ready: false, target: 'canvas', blockers: ['missing-active-layer'] },
        { id: 'centerLayerHorizontal', ready: false, target: 'canvas', blockers: ['missing-active-layer'] },
        { id: 'centerLayerVertical', ready: false, target: 'canvas', blockers: ['missing-active-layer'] },
      ],
      blockers: [
        { code: 'missing-layer', layerId: 'missing', reason: 'missing-active-layer' },
      ],
    });
  });

  it('lets Escape cancel an active transform preview and Enter apply it', () => {
    const document = {
      ...createEmptyImageDocument({
        id: 'doc-move-preview',
        title: 'Move Preview',
        width: 800,
        height: 600,
      }),
      layers: [layer({ rotationDeg: 0, transformOriginX: 0.5, transformOriginY: 0.5 } as Partial<ImageLayer>)],
      activeLayerId: 'layer-1',
    };
    useImageEditorStore.getState().openDocument(document);
    const store = useImageEditorStore.getState();
    const liveDoc = store.documents[0]!;
    const liveLayer = liveDoc.layers[0]!;
    const requestRender = vi.fn();
    const liveEnv: ToolEnv = {
      doc: liveDoc,
      activeLayer: liveLayer,
      brushSettings,
      cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
      selectionToolSettings,
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: store.pushOperation,
      requestRender,
      resolveSelectionMode: () => 'replace',
      store,
    };

    beginTransformPreviewSession(liveDoc, liveLayer);
    store.updateLayer(liveDoc.id, liveLayer.id, { rotationDeg: 22 });
    moveTool.onKeyDown?.(liveEnv, 'Escape', mods, {} as KeyboardEvent);
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.rotationDeg).toBe(0);

    const updatedDoc = useImageEditorStore.getState().documents[0]!;
    const updatedLayer = updatedDoc.layers[0]!;
    beginTransformPreviewSession(updatedDoc, updatedLayer);
    useImageEditorStore.getState().updateLayer(updatedDoc.id, updatedLayer.id, { rotationDeg: 35 });
    moveTool.onKeyDown?.({
      ...liveEnv,
      doc: useImageEditorStore.getState().documents[0]!,
      activeLayer: useImageEditorStore.getState().documents[0]!.layers[0]!,
      store: useImageEditorStore.getState(),
      pushOperation: useImageEditorStore.getState().pushOperation,
    }, 'Enter', mods, {} as KeyboardEvent);

    expect(useImageEditorStore.getState().undoStacks[updatedDoc.id]?.at(-1)).toMatchObject({
      kind: 'transform',
      after: { rotationDeg: 35 },
    });
  });

  it('lets Escape cancel and Enter apply an active selection transform session', () => {
    const document = createEmptyImageDocument({
      id: 'doc-move-selection-preview',
      title: 'Selection Preview',
      width: 10,
      height: 10,
    });
    useImageEditorStore.getState().openDocument(document);
    const store = useImageEditorStore.getState();
    const selection = createMask(10, 10);
    selection.data[2 * selection.width + 2] = 255;
    selection.data[2 * selection.width + 3] = 255;
    selection.data[3 * selection.width + 2] = 255;
    setSelection(document.id, selection);
    store.setHasSelection(document.id, true);
    const requestRender = vi.fn();
    const liveDoc = store.documents[0]!;
    const liveEnv: ToolEnv = {
      doc: liveDoc,
      activeLayer: null,
      brushSettings,
      cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
      selectionToolSettings,
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: store.pushOperation,
      requestRender,
      resolveSelectionMode: () => 'replace',
      store,
    };

    beginSelectionTransformSession(liveDoc.id);
    updateSelectionTransformBounds(liveDoc.id, { x: 5, y: 4, width: 2, height: 2 });
    moveTool.onKeyDown?.(liveEnv, 'Escape', mods, {} as KeyboardEvent);
    expect(getSelection(liveDoc.id)?.data[2 * 10 + 2]).toBe(255);
    expect(getSelection(liveDoc.id)?.data[4 * 10 + 5]).toBe(0);

    beginSelectionTransformSession(liveDoc.id);
    updateSelectionTransformBounds(liveDoc.id, { x: 5, y: 4, width: 2, height: 2 });
    moveTool.onKeyDown?.({
      ...liveEnv,
      doc: useImageEditorStore.getState().documents[0]!,
      store: useImageEditorStore.getState(),
      pushOperation: useImageEditorStore.getState().pushOperation,
    }, 'Enter', mods, {} as KeyboardEvent);

    expect(useImageEditorStore.getState().undoStacks[liveDoc.id]?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: liveDoc.id,
    });
  });
});
