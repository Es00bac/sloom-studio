import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { addImageLayerUndoable } from './imageLayerInsert';
import { cloneBitmap } from './LayerBitmap';
import {
  IMAGE_TEXT_RASTER_MAX_DIMENSION,
  ImageTextRasterBudgetError,
  normalizeImageTextStyle,
  updateTextLayerFromStyle,
} from './ImageTextLayer';
import { createLiveImageVectorBooleanLayers } from './ImageVectorShape';
import { applyOperation, jumpToHistoryUndoCount, redo, undo } from './undoRedoApply';

class FakeOffscreenCanvas {
  width: number;
  height: number;
  pixel: [number, number, number, number];
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixel = [0, 0, 0, 0];
  }
  getContext() {
    return {
      beginPath: () => undefined,
      bezierCurveTo: () => undefined,
      clearRect: () => undefined,
      closePath: () => undefined,
      ellipse: () => undefined,
      fill: () => undefined,
      font: '',
      fontKerning: '',
      fontVariantCaps: '',
      fillStyle: '',
      globalAlpha: 1,
      lineJoin: 'miter',
      lineTo: () => undefined,
      lineWidth: 1,
      moveTo: () => undefined,
      rect: () => undefined,
      setLineDash: () => undefined,
      textAlign: '',
      textBaseline: '',
      stroke: () => undefined,
      strokeStyle: '',
      drawImage: (source: FakeOffscreenCanvas) => {
        this.pixel = [...source.pixel];
      },
      measureText: (text: string) => ({ width: Math.max(1, text.length * 10) }),
      fillText: () => undefined,
    };
  }
}

function layer(patch: Partial<ImageLayer> = {}): ImageLayer {
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
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    ...patch,
  };
}

describe('undoRedoApply', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
  });

  it('restores transform pivot values when replaying transform operations', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-undo-pivot',
        title: 'Undo Pivot',
        width: 640,
        height: 480,
      }),
      layers: [
        layer({
          id: 'layer-1',
          transformOriginX: 0.5,
          transformOriginY: 0.5,
        } as unknown as Partial<ImageLayer>),
      ],
      activeLayerId: 'layer-1',
    });

    const operation = {
      kind: 'transform',
      docId: 'doc-undo-pivot',
      layerId: 'layer-1',
      before: { x: 24, y: 32, rotationDeg: 0, transformOriginX: 0.5, transformOriginY: 0.5 },
      after: { x: 24, y: 32, rotationDeg: 0, transformOriginX: 0, transformOriginY: 0.5 },
    } as any;

    applyOperation(operation, 'redo');
    let updatedLayer = useImageEditorStore.getState().documents[0]?.layers[0] as unknown as Record<string, unknown> | undefined;
    expect(updatedLayer?.transformOriginX).toBe(0);
    expect(updatedLayer?.transformOriginY).toBe(0.5);

    applyOperation(operation, 'undo');
    updatedLayer = useImageEditorStore.getState().documents[0]?.layers[0] as unknown as Record<string, unknown> | undefined;
    expect(updatedLayer?.transformOriginX).toBe(0.5);
    expect(updatedLayer?.transformOriginY).toBe(0.5);
  });

  it('restores layer perspective values when replaying transform operations', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-undo-perspective',
        title: 'Undo Perspective',
        width: 640,
        height: 480,
      }),
      layers: [
        layer({
          id: 'layer-1',
          perspectiveX: 0,
          perspectiveY: 0,
        } as unknown as Partial<ImageLayer>),
      ],
      activeLayerId: 'layer-1',
    });

    const operation = {
      kind: 'transform',
      docId: 'doc-undo-perspective',
      layerId: 'layer-1',
      before: { x: 24, y: 32, rotationDeg: 0, perspectiveX: 0, perspectiveY: 0 },
      after: { x: 24, y: 32, rotationDeg: 0, perspectiveX: 0.25, perspectiveY: -0.125 },
    } as const;

    applyOperation(operation, 'redo');
    let updatedLayer = useImageEditorStore.getState().documents[0]?.layers[0];
    expect(updatedLayer?.perspectiveX).toBe(0.25);
    expect(updatedLayer?.perspectiveY).toBe(-0.125);

    applyOperation(operation, 'undo');
    updatedLayer = useImageEditorStore.getState().documents[0]?.layers[0];
    expect(updatedLayer?.perspectiveX).toBe(0);
    expect(updatedLayer?.perspectiveY).toBe(0);
  });

  it('restores layer warp values when replaying transform operations', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-undo-warp',
        title: 'Undo Warp',
        width: 640,
        height: 480,
      }),
      layers: [
        layer({
          id: 'layer-1',
          warp: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          },
        } as unknown as Partial<ImageLayer>),
      ],
      activeLayerId: 'layer-1',
    });

    const operation = {
      kind: 'transform',
      docId: 'doc-undo-warp',
      layerId: 'layer-1',
      before: {
        x: 24,
        y: 32,
        rotationDeg: 0,
        warp: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      after: {
        x: 24,
        y: 32,
        rotationDeg: 0,
        warp: { top: 0.25, right: -0.15, bottom: 0.1, left: 0 },
      },
    } as const;

    applyOperation(operation, 'redo');
    let updatedLayer = useImageEditorStore.getState().documents[0]?.layers[0];
    expect(updatedLayer?.warp).toEqual({
      top: 0.25,
      right: -0.15,
      bottom: 0.1,
      left: 0,
    });

    applyOperation(operation, 'undo');
    updatedLayer = useImageEditorStore.getState().documents[0]?.layers[0];
    expect(updatedLayer?.warp).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('replays mask paint operations against the layer mask target instead of the layer bitmap', () => {
    const beforeMask = new OffscreenCanvas(8, 8) as LayerBitmap;
    const afterMask = new OffscreenCanvas(8, 8) as LayerBitmap;

    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-undo-mask',
        title: 'Undo Mask',
        width: 640,
        height: 480,
      }),
      layers: [
        layer({
          id: 'layer-1',
          bitmap: new OffscreenCanvas(8, 8) as LayerBitmap,
          mask: beforeMask,
        }),
      ],
      activeLayerId: 'layer-1',
    });

    const operation = {
      kind: 'paint',
      docId: 'doc-undo-mask',
      layerId: 'layer-1',
      paintTarget: 'mask',
      before: beforeMask,
      after: afterMask,
    } as const;

    applyOperation(operation, 'redo');
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.mask).not.toBe(afterMask);
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.mask).toStrictEqual(afterMask);
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.bitmap).not.toBe(afterMask);

    applyOperation(operation, 'undo');
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.mask).not.toBe(beforeMask);
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.mask).toStrictEqual(beforeMask);
  });

  it('does not resurrect paint recorded after a layer insertion when undo crosses both operations', () => {
    const originalBitmap = new OffscreenCanvas(1, 1) as LayerBitmap & { pixel: [number, number, number, number] };
    originalBitmap.pixel = [12, 34, 56, 255];
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-layer-paint-chronology',
        title: 'Layer paint chronology',
        width: 1,
        height: 1,
      }),
      layers: [layer({ id: 'base', bitmap: originalBitmap })],
      activeLayerId: 'base',
    });

    addImageLayerUndoable(layer({ id: 'inserted', bitmap: new OffscreenCanvas(1, 1) as LayerBitmap }));

    const beforePaint = cloneBitmap(originalBitmap);
    originalBitmap.pixel = [220, 10, 20, 255];
    const afterPaint = cloneBitmap(originalBitmap);
    useImageEditorStore.getState().pushOperation({
      kind: 'paint',
      docId: 'doc-layer-paint-chronology',
      layerId: 'base',
      before: beforePaint,
      after: afterPaint,
    });

    expect(undo('doc-layer-paint-chronology')).toBe(true);
    expect(undo('doc-layer-paint-chronology')).toBe(true);

    const restored = useImageEditorStore.getState().getActiveDocument()?.layers[0]?.bitmap as
      | (LayerBitmap & { pixel: [number, number, number, number] })
      | null
      | undefined;
    expect(restored?.pixel).toEqual([12, 34, 56, 255]);
  });

  it('restores the recorded active layer when replaying document resize operations', () => {
    const background = layer({ id: 'background', name: 'Background' });
    const foreground = layer({ id: 'foreground', name: 'Foreground' });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-undo-doc-resize-active-layer',
        title: 'Undo Crop Active Layer',
        width: 640,
        height: 480,
      }),
      layers: [background, foreground],
      activeLayerId: 'background',
    });

    applyOperation({
      kind: 'docResize',
      docId: 'doc-undo-doc-resize-active-layer',
      before: {
        width: 640,
        height: 480,
        layers: [background, foreground],
        activeLayerId: 'background',
      },
      after: {
        width: 320,
        height: 240,
        layers: [
          { ...background, x: 0, y: 0 },
          { ...foreground, x: 8, y: 12 },
        ],
        activeLayerId: 'background',
      },
    }, 'redo');

    expect(useImageEditorStore.getState().getActiveDocument()?.activeLayerId).toBe('background');

    applyOperation({
      kind: 'docResize',
      docId: 'doc-undo-doc-resize-active-layer',
      before: {
        width: 640,
        height: 480,
        layers: [background, foreground],
        activeLayerId: 'background',
      },
      after: {
        width: 320,
        height: 240,
        layers: [
          { ...background, x: 0, y: 0 },
          { ...foreground, x: 8, y: 12 },
        ],
        activeLayerId: 'background',
      },
    }, 'undo');

    expect(useImageEditorStore.getState().getActiveDocument()?.activeLayerId).toBe('background');
  });

  it('jumps to a requested history depth by replaying undo and redo operations', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-history-jump',
        title: 'History Jump',
        width: 640,
        height: 480,
      }),
      layers: [
        layer({
          id: 'layer-1',
          x: 20,
          y: 0,
        }),
      ],
      activeLayerId: 'layer-1',
    });

    const op1 = {
      kind: 'transform',
      docId: 'doc-history-jump',
      layerId: 'layer-1',
      before: { x: 0, y: 0, rotationDeg: 0 },
      after: { x: 10, y: 0, rotationDeg: 0 },
    } as const;
    const op2 = {
      kind: 'transform',
      docId: 'doc-history-jump',
      layerId: 'layer-1',
      before: { x: 10, y: 0, rotationDeg: 0 },
      after: { x: 20, y: 0, rotationDeg: 0 },
    } as const;

    useImageEditorStore.setState({
      undoStacks: {
        'doc-history-jump': [op1, op2],
      },
      redoStacks: {
        'doc-history-jump': [],
      },
    });

    expect(jumpToHistoryUndoCount('doc-history-jump', 0)).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.x).toBe(0);
    expect(useImageEditorStore.getState().undoStacks['doc-history-jump']).toHaveLength(0);
    expect(useImageEditorStore.getState().redoStacks['doc-history-jump']).toHaveLength(2);

    expect(jumpToHistoryUndoCount('doc-history-jump', 2)).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.x).toBe(20);
    expect(useImageEditorStore.getState().undoStacks['doc-history-jump']).toHaveLength(2);
    expect(useImageEditorStore.getState().redoStacks['doc-history-jump']).toHaveLength(0);
  });

  it('replays a real retained vertical text edit through layer-operation undo and redo', () => {
    const original = layer({
      id: 'vertical-text',
      name: '右の列',
      type: 'text',
      bitmapVersion: 2,
      text: normalizeImageTextStyle({
        content: '右の列\n左の列',
        fontSize: 24,
        boxWidth: 120,
        boxHeight: 160,
        orientation: 'vertical-rl',
        warp: 'arc',
      }),
      metadata: { editableText: true },
    });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-vertical-text-history',
        title: 'Vertical text history',
        width: 640,
        height: 480,
      }),
      layers: [original],
      activeLayerId: original.id,
    });

    const updated = updateTextLayerFromStyle(original, { orientation: 'vertical-lr', warp: 'bulge' });
    useImageEditorStore.getState().pushOperation({
      kind: 'layerOp',
      docId: 'doc-vertical-text-history',
      before: [original],
      after: [updated],
    });
    useImageEditorStore.getState().updateLayer('doc-vertical-text-history', original.id, updated);

    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.text?.orientation).toBe('vertical-lr');
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.text?.warp).toBe('bulge');
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.bitmapVersion).toBe(3);
    expect(undo('doc-vertical-text-history')).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.text?.orientation).toBe('vertical-rl');
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.text?.warp).toBe('arc');
    expect(redo('doc-vertical-text-history')).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.text).toMatchObject({
      content: '右の列\n左の列',
      orientation: 'vertical-lr',
      warp: 'bulge',
    });
  });

  it('atomically restores reordered live Boolean layers without sticky hidden output', () => {
    const operand = (id: string, x: number, y: number): ImageLayer => layer({
      id,
      name: id,
      type: 'vector',
      x,
      y,
      metadata: {
        vectorShape: {
          kind: 'rect',
          width: 24,
          height: 20,
          fillColor: '#22cc88',
          fillOpacity: 1,
          strokeColor: '#1144ff',
          strokeOpacity: 1,
          strokeWidth: 1,
        },
        originalSvgSource: '<svg />',
      },
      vectorRecipe: '<svg />',
    });
    const first = operand('operand-first', 0, 0);
    const second = operand('operand-second', 8, 6);
    const derived = createLiveImageVectorBooleanLayers('intersect', first, second).outputLayers[0];
    expect(derived).toBeDefined();

    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-live-boolean-history',
        title: 'Live Boolean history',
        width: 640,
        height: 480,
      }),
      layers: [first, second, derived!],
      activeLayerId: derived!.id,
    });

    const undoTarget = [derived!, first, second];
    const redoTarget = [first, derived!, second];
    useImageEditorStore.getState().pushOperation({
      kind: 'layerOp',
      docId: 'doc-live-boolean-history',
      before: undoTarget,
      after: redoTarget,
    });
    useImageEditorStore.getState().setLayers(
      'doc-live-boolean-history',
      redoTarget,
      derived!.id,
    );

    expect(undo('doc-live-boolean-history')).toBe(true);

    let restored = useImageEditorStore.getState().getActiveDocument();
    expect(restored?.layers.map((candidate) => candidate.id)).toEqual(
      undoTarget.map((candidate) => candidate.id),
    );
    expect(restored?.layers[0]?.visible).toBe(true);
    expect(restored?.activeLayerId).toBe(derived!.id);

    expect(redo('doc-live-boolean-history')).toBe(true);
    restored = useImageEditorStore.getState().getActiveDocument();
    expect(restored?.layers.map((candidate) => candidate.id)).toEqual(
      redoTarget.map((candidate) => candidate.id),
    );
    expect(restored?.layers[1]?.visible).toBe(true);
    expect(restored?.activeLayerId).toBe(derived!.id);
  });

  it('keeps the active layer valid when atomic layer replay removes it', () => {
    const base = layer({ id: 'base-layer', name: 'Base layer' });
    const inserted = layer({ id: 'inserted-layer', name: 'Inserted layer' });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-layer-active-history',
        title: 'Active layer history',
        width: 640,
        height: 480,
      }),
      layers: [base, inserted],
      activeLayerId: inserted.id,
    });
    useImageEditorStore.getState().pushOperation({
      kind: 'layerOp',
      docId: 'doc-layer-active-history',
      before: [base],
      after: [base, inserted],
    });

    expect(undo('doc-layer-active-history')).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()).toMatchObject({
      activeLayerId: base.id,
      layers: [expect.objectContaining({ id: base.id })],
    });
    expect(redo('doc-layer-active-history')).toBe(true);
    const restored = useImageEditorStore.getState().getActiveDocument();
    expect(restored?.layers.map((candidate) => candidate.id)).toEqual([base.id, inserted.id]);
    expect(restored?.layers.some((candidate) => candidate.id === restored.activeLayerId)).toBe(true);
  });

  it('leaves the layer and history unchanged when a vertical text edit exceeds the raster budget', () => {
    const original = layer({
      id: 'bounded-vertical-text',
      name: 'Bounded vertical text',
      type: 'text',
      bitmapVersion: 5,
      text: normalizeImageTextStyle({
        content: '安全',
        fontSize: 24,
        orientation: 'vertical-rl',
      }),
      metadata: { editableText: true },
    });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-bounded-vertical-text',
        title: 'Bounded vertical text',
        width: 640,
        height: 480,
      }),
      layers: [original],
      activeLayerId: original.id,
    });

    expect(() => updateTextLayerFromStyle(original, {
      content: '巨大',
      orientation: 'vertical-rl',
      boxWidth: IMAGE_TEXT_RASTER_MAX_DIMENSION,
      boxHeight: IMAGE_TEXT_RASTER_MAX_DIMENSION,
    })).toThrow(ImageTextRasterBudgetError);

    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]).toBe(original);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.text?.content).toBe('安全');
    expect(useImageEditorStore.getState().undoStacks['doc-bounded-vertical-text'] ?? []).toHaveLength(0);
    expect(useImageEditorStore.getState().redoStacks['doc-bounded-vertical-text'] ?? []).toHaveLength(0);
  });
});
