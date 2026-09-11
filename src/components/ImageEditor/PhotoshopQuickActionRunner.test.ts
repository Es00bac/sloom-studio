import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { createMask, setRect } from './SelectionMask';
import { getSelection, setSelection, clearAllSelections } from './selectionRegistry';
import { playImageQuickActionMacro } from './ImageQuickActionMacros';
import {
  buildPhotoshopQuickActionAutomationDescriptor,
  runPhotoshopQuickAction,
} from './PhotoshopQuickActionRunner';
import { redo, undo } from './undoRedoApply';

class FakeContext {
  imageData: ImageData;

  constructor(width: number, height: number) {
    this.imageData = makeImageData(width, height);
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

  drawImage(source: CanvasImageSource) {
    const sourceCanvas = source as unknown as FakeOffscreenCanvas;
    if (!sourceCanvas.context?.imageData) return;
    this.imageData = {
      width: sourceCanvas.context.imageData.width,
      height: sourceCanvas.context.imageData.height,
      data: new Uint8ClampedArray(sourceCanvas.context.imageData.data),
    } as ImageData;
  }
  save() {}
  restore() {}
  clearRect() {}
  fillRect() {}
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

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob() {
    return new Blob();
  }
}

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    globalThis.createImageBitmap = async () => {
      return {
        width: 10,
        height: 12,
        close() {},
      } as unknown as ImageBitmap;
    };
}

function makeDoc(layer: ImageLayer): ImageDocument {
  return {
    id: 'doc-1',
    title: 'doc',
    width: 8,
    height: 6,
    layers: [layer],
    activeLayerId: layer.id,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

function makeLayer(): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 2,
    y: 1,
    bitmap: new OffscreenCanvas(4, 3) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

function setPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  data.set(rgba, (y * bitmap.width + x) * 4);
}

function fillBitmap(bitmap: LayerBitmap, rgba: [number, number, number, number]) {
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      setPixel(bitmap, x, y, rgba);
    }
  }
}

function rgbaAt(bitmap: LayerBitmap, x: number, y: number): number[] {
  const data = (bitmap as unknown as FakeOffscreenCanvas).context.imageData.data;
  return Array.from(data.slice((y * bitmap.width + x) * 4, (y * bitmap.width + x) * 4 + 4));
}

describe('PhotoshopQuickActionRunner', () => {
  beforeEach(() => {
    installCanvasStub();
    clearAllSelections();
    const layer = makeLayer();
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [0, 255, 0, 255]);
    const doc = makeDoc(layer);
    useImageEditorStore.setState({
      documents: [doc],
      activeDocId: doc.id,
      undoStacks: {},
      redoStacks: {},
      quickActionMacros: [],
      activeQuickActionRecording: null,
    });
  });

  it('runs selection actions against the active document and tracks history', () => {
    const ok = runPhotoshopQuickAction('selectLayerOpaquePixels');

    const state = useImageEditorStore.getState();
    expect(ok).toBe(true);
    expect(state.documents[0].hasSelection).toBe(true);
    expect(getSelection('doc-1')?.data[2 * 8 + 3]).toBe(255);
    expect(state.undoStacks['doc-1']?.[0]?.kind).toBe('selection');
  });

  it('runs layer quick actions through undoable store operations', () => {
    const selection = createMask(8, 6);
    setRect(selection, 3, 2, 1, 1, 255, false);
    setSelection('doc-1', selection);
    useImageEditorStore.getState().setHasSelection('doc-1', true);

    expect(runPhotoshopQuickAction('layerViaCopy', { createLayerId: () => 'copied-layer' })).toBe(true);
    expect(runPhotoshopQuickAction('resetLayerPosition')).toBe(true);

    const state = useImageEditorStore.getState();
    const doc = state.documents[0];
    const copiedLayer = doc.layers.find((layer) => layer.id === 'copied-layer');

    expect(doc.layers.some((layer) => layer.id === 'copied-layer')).toBe(true);
    expect(copiedLayer?.x).toBe(0);
    expect(copiedLayer?.y).toBe(0);
    expect(state.undoStacks['doc-1']?.map((op) => op.kind)).toEqual([
      'layerOp',
      'transform',
    ]);
  });

  it('runs paint and canvas quick actions through undoable store operations', () => {
    const selection = createMask(8, 6);
    setRect(selection, 3, 2, 1, 1, 255, false);
    setSelection('doc-1', selection);
    useImageEditorStore.getState().setHasSelection('doc-1', true);

    expect(runPhotoshopQuickAction('clearOutsideSelection')).toBe(true);
    expect(runPhotoshopQuickAction('resetLayerPosition')).toBe(true);
    expect(runPhotoshopQuickAction('trimCanvasToVisible')).toBe(true);

    const state = useImageEditorStore.getState();
    const doc = state.documents[0];
    const sourceLayer = doc.layers.find((layer) => layer.id === 'layer-1');

    expect(sourceLayer?.x).toBe(-1);
    expect(sourceLayer?.y).toBe(-1);
    expect(sourceLayer?.bitmap ? rgbaAt(sourceLayer.bitmap, 0, 0)[3] : 255).toBe(0);
    expect(doc.width).toBe(1);
    expect(doc.height).toBe(1);
    expect(state.undoStacks['doc-1']?.map((op) => op.kind)).toEqual([
      'paint',
      'transform',
      'docResize',
    ]);
  });

  it('runs local content-aware fill as an undoable dirty paint quick action', () => {
    const layer = useImageEditorStore.getState().documents[0].layers[0];
    setPixel(layer.bitmap as LayerBitmap, 0, 0, [100, 120, 140, 255]);
    setPixel(layer.bitmap as LayerBitmap, 1, 0, [100, 120, 140, 255]);
    setPixel(layer.bitmap as LayerBitmap, 0, 1, [100, 120, 140, 255]);
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [250, 0, 0, 255]);
    setPixel(layer.bitmap as LayerBitmap, 2, 1, [100, 120, 140, 255]);
    setPixel(layer.bitmap as LayerBitmap, 1, 2, [100, 120, 140, 255]);

    const selection = createMask(8, 6);
    setRect(selection, 3, 2, 1, 1, 255, false);
    setSelection('doc-1', selection);
    useImageEditorStore.getState().setHasSelection('doc-1', true);

    expect(runPhotoshopQuickAction('localContentAwareFillPatch')).toBe(true);

    const state = useImageEditorStore.getState();
    const doc = state.documents[0];
    const updatedLayer = doc.layers.find((candidate) => candidate.id === 'layer-1');
    expect(updatedLayer?.bitmap ? rgbaAt(updatedLayer.bitmap, 1, 1) : []).toEqual([100, 120, 140, 255]);
    expect(updatedLayer?.bitmapVersion).toBe(1);
    expect(doc.dirty).toBe(true);
    expect(state.undoStacks['doc-1']?.map((op) => op.kind)).toEqual(['paint']);
  });

  it('retains a deterministic local repair on a new layer with one undo step', () => {
    const layer = useImageEditorStore.getState().documents[0].layers[0];
    fillBitmap(layer.bitmap as LayerBitmap, [100, 120, 140, 255]);
    setPixel(layer.bitmap as LayerBitmap, 1, 1, [250, 0, 0, 255]);
    const selection = createMask(8, 6);
    setRect(selection, 3, 2, 1, 1, 255, false);
    setSelection('doc-1', selection);
    useImageEditorStore.getState().setHasSelection('doc-1', true);

    expect(runPhotoshopQuickAction('localContentAwareFillPatch', {
      createLayerId: () => 'content-aware-layer',
      contentAware: {
        outputTarget: 'new-layer',
        maxSampleRadius: 2,
        manualPatchSource: { x: 0, y: 0, width: 3, height: 3 },
      },
    })).toBe(true);

    const state = useImageEditorStore.getState();
    const doc = state.documents[0];
    const source = doc.layers.find((candidate) => candidate.id === 'layer-1');
    const output = doc.layers.find((candidate) => candidate.id === 'content-aware-layer');
    expect(source?.bitmap ? rgbaAt(source.bitmap, 1, 1) : []).toEqual([250, 0, 0, 255]);
    expect(output?.name).toBe('Content-Aware Fill');
    expect(output?.bitmap ? rgbaAt(output.bitmap, 1, 1) : []).toEqual([100, 120, 140, 255]);
    expect(output?.bitmap ? rgbaAt(output.bitmap, 0, 0)[3] : -1).toBe(0);
    expect(doc.activeLayerId).toBe('content-aware-layer');
    expect(state.undoStacks['doc-1']?.map((op) => op.kind)).toEqual(['layerOp']);
    expect(undo('doc-1')).toBe(true);
    expect(useImageEditorStore.getState().documents[0].layers.some((candidate) => candidate.id === 'content-aware-layer')).toBe(false);
    expect(redo('doc-1')).toBe(true);
    expect(useImageEditorStore.getState().documents[0].layers.some((candidate) => candidate.id === 'content-aware-layer')).toBe(true);
  });

  it('runs newly added selection, ordering, and color actions from the shared runner', () => {
    expect(runPhotoshopQuickAction('selectCanvas')).toBe(true);
    expect(runPhotoshopQuickAction('duplicateLayer', { createLayerId: () => 'duplicate-layer' })).toBe(true);
    expect(runPhotoshopQuickAction('moveLayerToBack')).toBe(true);
    expect(runPhotoshopQuickAction('desaturateLayer')).toBe(true);

    const state = useImageEditorStore.getState();
    const doc = state.documents[0];

    expect(doc.hasSelection).toBe(true);
    expect(getSelection(doc.id)?.data.every((value) => value === 255)).toBe(true);
    expect(doc.layers[0].id).toBe('duplicate-layer');
    expect(state.undoStacks[doc.id]?.map((op) => op.kind)).toEqual([
      'selection',
      'layerOp',
      'layerOp',
      'paint',
    ]);
  });

  it('records successful quick actions into the active recording and saves a replayable action set', () => {
    const store = useImageEditorStore.getState();

    store.startQuickActionRecording();
    expect(runPhotoshopQuickAction('nudgeLayerRightLarge')).toBe(true);
    expect(runPhotoshopQuickAction('nudgeLayerDownLarge')).toBe(true);

    const macro = store.saveQuickActionRecording();

    expect(macro).toMatchObject({
      name: 'Action 1',
      steps: [
        { actionId: 'nudgeLayerRightLarge' },
        { actionId: 'nudgeLayerDownLarge' },
      ],
    });
    expect(useImageEditorStore.getState().quickActionMacros).toEqual([
      expect.objectContaining({
        name: 'Action 1',
        steps: [
          { actionId: 'nudgeLayerRightLarge' },
          { actionId: 'nudgeLayerDownLarge' },
        ],
      }),
    ]);
  });

  it('replays a saved quick action macro against the active document without re-recording the playback', () => {
    useImageEditorStore.setState({
      quickActionMacros: [{
        id: 'macro-1',
        name: 'Move right and down',
        createdAt: 10,
        updatedAt: 10,
        steps: [
          { actionId: 'nudgeLayerRightLarge' },
          { actionId: 'nudgeLayerDownLarge' },
        ],
      }],
    });

    const store = useImageEditorStore.getState();
    store.startQuickActionRecording();

    expect(playImageQuickActionMacro('macro-1')).toBe(true);

    const doc = useImageEditorStore.getState().documents[0];
    expect(doc.layers[0]?.x).toBe(12);
    expect(doc.layers[0]?.y).toBe(11);
    expect(useImageEditorStore.getState().activeQuickActionRecording?.steps).toEqual([]);
  });

  it('regenerates vector layers after a scale quick action is run', async () => {
    const fakeBitmap = new OffscreenCanvas(4, 4);
    const layer: ImageLayer = {
      id: 'vector-layer',
      name: 'Vector',
      type: 'vector',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: fakeBitmap,
      bitmapVersion: 0,
      mask: null,
      metadata: {
        originalSvgSource: '<svg>circle</svg>',
      },
    };

    const doc = useImageEditorStore.getState().documents[0];
    const updatedLayers = [layer, ...doc.layers];
    useImageEditorStore.getState().setLayers(doc.id, updatedLayers, 'vector-layer');

    // Run scaleLayer50Percent
    const ok = runPhotoshopQuickAction('scaleLayer50Percent');
    expect(ok).toBe(true);

    // Let any pending promises/microtasks flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    const state = useImageEditorStore.getState();
    const finalDoc = state.documents[0];
    const vectorLayer = finalDoc.layers.find((l) => l.id === 'vector-layer')!;

    // The vector layer's bitmap should have been scaled to 50% (2x2) and then regenerated
    expect(vectorLayer.bitmap).not.toBeNull();
    expect(vectorLayer.bitmap!.width).toBe(2);
    expect(vectorLayer.bitmap!.height).toBe(2);
  });

  it('describes suite-native callable quick actions for image automation dry runs across multiple documents', () => {
    const secondLayer = makeLayer();
    const docs = [
      useImageEditorStore.getState().documents[0],
      {
        ...makeDoc(secondLayer),
        id: 'doc-2',
        title: 'Second doc',
        activeLayerId: null,
      },
    ];

    const descriptor = buildPhotoshopQuickActionAutomationDescriptor({
      actionIds: ['resetLayerPosition', 'missingAction'],
      documents: docs,
      activeDocId: 'doc-1',
    });

    expect(descriptor).toEqual({
      descriptorId: 'photoshop-quick-action-automation:v1',
      automationSurface: {
        workspaceId: 'image-automation',
        separateFromMainFlow: true,
        scope: 'open-document-quick-actions',
      },
      callableOperations: [
        {
          kind: 'quick-action',
          id: 'resetLayerPosition',
          callable: true,
          source: 'suite-native-quick-action',
        },
        {
          kind: 'quick-action',
          id: 'missingAction',
          callable: false,
          source: 'suite-native-quick-action',
          reason: 'missing-from-registry',
        },
      ],
      variableBindingReadiness: {
        state: 'ready-for-explicit-review',
        supportsActionIdBinding: true,
        supportsArbitraryJsExpressions: false,
      },
      dryRunDiagnostics: {
        safe: true,
        canMutateDocuments: false,
        documentCount: 2,
        actionableDocumentCount: 1,
        blockedDocumentCount: 1,
        blockedDocumentIds: ['doc-2'],
      },
    });
  });

  it('adds per-document content-aware compatibility to quick-action automation dry runs', () => {
    const opaqueLayer = makeLayer();
    fillBitmap(opaqueLayer.bitmap as LayerBitmap, [20, 40, 60, 255]);
    const docs = [
      useImageEditorStore.getState().documents[0],
      {
        ...makeDoc(opaqueLayer),
        id: 'doc-opaque',
        title: 'Opaque doc',
      },
    ];

    const descriptor = buildPhotoshopQuickActionAutomationDescriptor({
      actionIds: ['localContentAwareFillPatch'],
      documents: docs,
      activeDocId: 'doc-1',
    }) as ReturnType<typeof buildPhotoshopQuickActionAutomationDescriptor> & {
      contentAwareRepairCompatibility?: {
        requested: boolean;
        actionIds: string[];
        batchSuitable: boolean;
        documents: Array<{
          docId: string;
          actionId: string;
          compatible: boolean;
          targetKind: string | null;
          operation: string | null;
          readinessState: string | null;
          outputTarget: string | null;
          blockerCodes: string[];
          previewSignature: string | null;
        }>;
      };
    };

    expect(descriptor.dryRunDiagnostics).toEqual({
      safe: true,
      canMutateDocuments: false,
      documentCount: 2,
      actionableDocumentCount: 1,
      blockedDocumentCount: 1,
      blockedDocumentIds: ['doc-opaque'],
    });
    expect(descriptor.contentAwareRepairCompatibility).toEqual({
      requested: true,
      actionIds: ['localContentAwareFillPatch'],
      batchSuitable: false,
      documents: [
        {
          docId: 'doc-1',
          actionId: 'localContentAwareFillPatch',
          compatible: true,
          targetKind: 'transparent-pixels',
          operation: 'fill',
          readinessState: 'ready',
          outputTarget: 'active-layer',
          blockerCodes: [],
          previewSignature: expect.stringContaining('local-content-aware-repair-preview:v1:'),
        },
        {
          docId: 'doc-opaque',
          actionId: 'localContentAwareFillPatch',
          compatible: false,
          targetKind: 'transparent-pixels',
          operation: 'fill',
          readinessState: 'no-target-pixels',
          outputTarget: 'active-layer',
          blockerCodes: ['empty-transparent-target'],
          previewSignature: expect.stringContaining('local-content-aware-repair-preview:v1:'),
        },
      ],
    });
  });
});
