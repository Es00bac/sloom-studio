import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import {
  applyTransformPreviewSession,
  beginTransformPreviewSession,
  cancelTransformPreviewSession,
  clearTransformPreviewSession,
  describeTransformPreviewSession,
  getTransformPreviewSession,
  markTransformPreviewSessionStructureChange,
  setTransformPreviewMode,
} from './ImageTransformPreview';
import { redo, undo } from './undoRedoApply';

class FakeOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return { drawImage: vi.fn() };
  }
}

function bitmap(width: number, height: number): LayerBitmap {
  return new FakeOffscreenCanvas(width, height) as unknown as LayerBitmap;
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
    bitmap: bitmap(180, 120),
    bitmapVersion: 0,
    mask: null,
    ...patch,
  };
}

function openDoc(layerPatch: Partial<ImageLayer> = {}): ImageDocument {
  const doc = {
    ...createEmptyImageDocument({
      id: 'doc-transform-preview',
      title: 'Transform Preview',
      width: 1024,
      height: 768,
    }),
    layers: [layer(layerPatch)],
    activeLayerId: 'layer-1',
  };
  useImageEditorStore.getState().openDocument(doc);
  return doc;
}

describe('ImageTransformPreview', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    clearTransformPreviewSession();
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
  });

  it('applies a pending rotate/pivot preview as a transform undo operation', () => {
    const doc = openDoc({
      rotationDeg: 0,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    });
    const requestRender = vi.fn();
    const previewLayer = useImageEditorStore.getState().documents[0]!.layers[0]!;

    beginTransformPreviewSession(doc, previewLayer);
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      rotationDeg: 37,
      transformOriginX: 0.25,
      transformOriginY: 0.75,
    });

    const operation = applyTransformPreviewSession(doc.id, requestRender);

    expect(operation).toMatchObject({
      kind: 'transform',
      docId: doc.id,
      layerId: 'layer-1',
      before: { x: 24, y: 32, rotationDeg: 0, transformOriginX: 0.5, transformOriginY: 0.5 },
      after: { x: 24, y: 32, rotationDeg: 37, transformOriginX: 0.25, transformOriginY: 0.75 },
    });
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'transform',
      after: { rotationDeg: 37, transformOriginX: 0.25, transformOriginY: 0.75 },
    });
    expect(getTransformPreviewSession(doc.id)).toBeNull();
  });

  it('cancels a pending preview by restoring the pre-session layer state', () => {
    const doc = openDoc({ rotationDeg: 0, transformOriginX: 0.5, transformOriginY: 0.5 });
    const requestRender = vi.fn();
    const previewLayer = useImageEditorStore.getState().documents[0]!.layers[0]!;

    beginTransformPreviewSession(doc, previewLayer);
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      x: 80,
      y: 64,
      rotationDeg: 18,
      transformOriginX: 0.1,
      transformOriginY: 0.9,
    });

    expect(cancelTransformPreviewSession(doc.id, requestRender)).toBe(true);

    const restored = useImageEditorStore.getState().documents[0]?.layers[0];
    expect(restored).toMatchObject({
      x: 24,
      y: 32,
      rotationDeg: 0,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    });
    expect(getTransformPreviewSession(doc.id)).toBeNull();
  });

  it('applies a pending destructive resize preview as a layerOp undo operation', () => {
    const doc = openDoc({
      rotationDeg: 5,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    });
    const requestRender = vi.fn();
    const previewLayer = useImageEditorStore.getState().documents[0]!.layers[0]!;

    beginTransformPreviewSession(doc, previewLayer);
    markTransformPreviewSessionStructureChange(doc, previewLayer);
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      bitmap: bitmap(240, 160),
      rotationDeg: 28,
    });

    const operation = applyTransformPreviewSession(doc.id, requestRender);

    expect(operation?.kind).toBe('layerOp');
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });
    expect(getTransformPreviewSession(doc.id)).toBeNull();
  });

  it('applies a pending skew/perspective/distort preview as a transform undo operation with the richer transform state', () => {
    const doc = openDoc({
      rotationDeg: 0,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
      skewXDeg: 0,
      skewYDeg: 0,
      perspectiveX: 0,
      perspectiveY: 0,
      cornerOffsets: {
        nw: { x: 0, y: 0 },
        ne: { x: 0, y: 0 },
        se: { x: 0, y: 0 },
        sw: { x: 0, y: 0 },
      },
    } as Partial<ImageLayer>);
    const requestRender = vi.fn();
    const previewLayer = useImageEditorStore.getState().documents[0]!.layers[0]!;

    beginTransformPreviewSession(doc, previewLayer);
    setTransformPreviewMode(doc.id, 'distort');
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      skewXDeg: 30,
      skewYDeg: -10,
      perspectiveX: 0.25,
      perspectiveY: -0.125,
      cornerOffsets: {
        nw: { x: -4, y: -2 },
        ne: { x: 6, y: -1 },
        se: { x: 10, y: 4 },
        sw: { x: -3, y: 5 },
      },
    } as Partial<ImageLayer>);

    const operation = applyTransformPreviewSession(doc.id, requestRender);

    expect(operation).toMatchObject({
      kind: 'transform',
      docId: doc.id,
      layerId: 'layer-1',
      before: {
        x: 24,
        y: 32,
        rotationDeg: 0,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
        skewXDeg: 0,
        skewYDeg: 0,
        perspectiveX: 0,
        perspectiveY: 0,
      },
      after: {
        x: 24,
        y: 32,
        rotationDeg: 0,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
        skewXDeg: 30,
        skewYDeg: -10,
        perspectiveX: 0.25,
        perspectiveY: -0.125,
      },
    });
    expect(operation?.kind === 'transform' ? operation.after.cornerOffsets : null).toEqual({
      nw: { x: -4, y: -2 },
      ne: { x: 6, y: -1 },
      se: { x: 10, y: 4 },
      sw: { x: -3, y: 5 },
    });
  });

  it('cancels a pending skew/perspective/distort preview by restoring the pre-session transform state', () => {
    const doc = openDoc({
      rotationDeg: 0,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
      skewXDeg: 0,
      skewYDeg: 0,
      perspectiveX: 0,
      perspectiveY: 0,
      cornerOffsets: {
        nw: { x: 0, y: 0 },
        ne: { x: 0, y: 0 },
        se: { x: 0, y: 0 },
        sw: { x: 0, y: 0 },
      },
    } as Partial<ImageLayer>);
    const previewLayer = useImageEditorStore.getState().documents[0]!.layers[0]!;

    beginTransformPreviewSession(doc, previewLayer);
    setTransformPreviewMode(doc.id, 'skew');
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      skewXDeg: 25,
      skewYDeg: 12,
      perspectiveX: 0.4,
      perspectiveY: -0.2,
      cornerOffsets: {
        nw: { x: -2, y: 0 },
        ne: { x: 2, y: 1 },
        se: { x: 3, y: 4 },
        sw: { x: -1, y: 3 },
      },
    } as Partial<ImageLayer>);

    expect(cancelTransformPreviewSession(doc.id)).toBe(true);

    const restored = useImageEditorStore.getState().documents[0]?.layers[0];
    expect(restored?.skewXDeg).toBe(0);
    expect(restored?.skewYDeg).toBe(0);
    expect(restored?.perspectiveX).toBe(0);
    expect(restored?.perspectiveY).toBe(0);
    expect(restored?.cornerOffsets).toEqual({
      nw: { x: 0, y: 0 },
      ne: { x: 0, y: 0 },
      se: { x: 0, y: 0 },
      sw: { x: 0, y: 0 },
    });
  });

  it('applies a pending warp preview as a transform undo operation with persisted edge bend state', () => {
    const doc = openDoc({
      rotationDeg: 0,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
      warp: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    } as Partial<ImageLayer>);
    const requestRender = vi.fn();
    const previewLayer = useImageEditorStore.getState().documents[0]!.layers[0]!;

    beginTransformPreviewSession(doc, previewLayer);
    setTransformPreviewMode(doc.id, 'warp');
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      warp: {
        top: 0.25,
        right: -0.15,
        bottom: 0.1,
        left: 0,
      },
    } as Partial<ImageLayer>);

    const operation = applyTransformPreviewSession(doc.id, requestRender);

    expect(operation).toMatchObject({
      kind: 'transform',
      docId: doc.id,
      layerId: 'layer-1',
      before: {
        x: 24,
        y: 32,
        rotationDeg: 0,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
        warp: {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
        },
      },
      after: {
        x: 24,
        y: 32,
        rotationDeg: 0,
        transformOriginX: 0.5,
        transformOriginY: 0.5,
        warp: {
          top: 0.25,
          right: -0.15,
          bottom: 0.1,
          left: 0,
        },
      },
    });
  });

  it('commits, undoes, redoes, and cancels retained warp-mesh control-point edits', () => {
    const initialMesh = {
      columns: 1,
      rows: 1,
      points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    };
    const doc = openDoc({ warpMesh: initialMesh } as Partial<ImageLayer>);
    const previewLayer = useImageEditorStore.getState().documents[0]!.layers[0]!;

    beginTransformPreviewSession(doc, previewLayer);
    setTransformPreviewMode(doc.id, 'warp');
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      warpMesh: {
        ...initialMesh,
        points: initialMesh.points.map((point, index) => index === 3 ? { x: 0.3, y: -0.2 } : point),
      },
    });

    const currentDoc = useImageEditorStore.getState().documents[0]!;
    expect(describeTransformPreviewSession(currentDoc)).toMatchObject({
      activeCapability: 'warp',
      pendingChanges: true,
      operationKind: 'transform',
      currentTransform: { warpMesh: { columns: 1, rows: 1 } },
    });
    const operation = applyTransformPreviewSession(doc.id);
    expect(operation?.kind === 'transform' ? operation.after.warpMesh?.points[3] : null).toEqual({ x: 0.3, y: -0.2 });

    expect(undo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.warpMesh?.points[3]).toEqual({ x: 0, y: 0 });
    expect(redo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.warpMesh?.points[3]).toEqual({ x: 0.3, y: -0.2 });

    const committed = useImageEditorStore.getState().documents[0]!.layers[0]!;
    beginTransformPreviewSession(useImageEditorStore.getState().documents[0]!, committed);
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      warpMesh: { ...initialMesh, points: initialMesh.points.map((point, index) => index === 0 ? { x: -0.4, y: 0.1 } : point) },
    });
    expect(cancelTransformPreviewSession(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().documents[0]?.layers[0]?.warpMesh?.points[3]).toEqual({ x: 0.3, y: -0.2 });
  });

  it('describes a pending rotate preview session with deterministic operation metadata', () => {
    const doc = openDoc({
      rotationDeg: 0,
      transformOriginX: 0.5,
      transformOriginY: 0.5,
    });
    const previewLayer = useImageEditorStore.getState().documents[0]!.layers[0]!;

    beginTransformPreviewSession(doc, previewLayer);
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      rotationDeg: 45,
    });
    const currentDoc = useImageEditorStore.getState().documents[0]!;

    const descriptor = describeTransformPreviewSession(currentDoc);

    expect(descriptor).toMatchObject({
      docId: doc.id,
      layerId: 'layer-1',
      currentMode: 'resize',
      activeCapability: 'rotate',
      pendingChanges: true,
      structureChange: false,
      operationKind: 'transform',
    });
    expect(descriptor?.capabilities.map((capability) => capability.kind)).toEqual([
      'move',
      'scale',
      'rotate',
      'skew',
      'distort',
      'perspective',
      'warp',
    ]);
    expect(descriptor?.warnings).toEqual([]);
    expect(descriptor?.previewSignature).toBe(
      'transform-preview-session:v1:{"docId":"doc-transform-preview","layerId":"layer-1","currentMode":"resize","activeCapability":"rotate","structureChange":false,"pendingChanges":true,"operationKind":"transform","before":{"x":24,"y":32,"rotationDeg":0,"skewXDeg":0,"skewYDeg":0,"perspectiveX":0,"perspectiveY":0,"warp":{"top":0,"right":0,"bottom":0,"left":0},"warpMesh":null,"cornerOffsets":{"nw":{"x":0,"y":0},"ne":{"x":0,"y":0},"se":{"x":0,"y":0},"sw":{"x":0,"y":0}},"transformOriginX":0.5,"transformOriginY":0.5},"current":{"x":24,"y":32,"rotationDeg":45,"skewXDeg":0,"skewYDeg":0,"perspectiveX":0,"perspectiveY":0,"warp":{"top":0,"right":0,"bottom":0,"left":0},"warpMesh":null,"cornerOffsets":{"nw":{"x":0,"y":0},"ne":{"x":0,"y":0},"se":{"x":0,"y":0},"sw":{"x":0,"y":0}},"transformOriginX":0.5,"transformOriginY":0.5},"warnings":[]}',
    );
  });

  it('warns when a smart-source scale preview cannot preserve non-destructive semantics', () => {
    const doc = openDoc({
      metadata: {
        sourceLink: {
          id: 'smart-source-1',
          label: 'Linked object',
          status: 'linked',
          relinkHistory: [],
        },
      },
    } as Partial<ImageLayer>);
    const previewLayer = useImageEditorStore.getState().documents[0]!.layers[0]!;

    beginTransformPreviewSession(doc, previewLayer);
    markTransformPreviewSessionStructureChange(doc, previewLayer);
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-1', {
      bitmap: bitmap(320, 180),
    });
    const currentDoc = useImageEditorStore.getState().documents[0]!;

    const descriptor = describeTransformPreviewSession(currentDoc, {
      requireSmartSourceSafe: true,
      requireNonDestructive: true,
    });

    expect(descriptor).toMatchObject({
      activeCapability: 'scale',
      pendingChanges: true,
      structureChange: true,
      operationKind: 'layerOp',
    });
    expect(descriptor?.warnings.map((warning) => warning.code)).toEqual([
      'unsupported-smart-source-safe-transform',
      'destructive-scale-rasterization',
    ]);
    expect(descriptor?.capabilities.find((capability) => capability.kind === 'scale')?.warnings.map((warning) => warning.code))
      .toEqual(['destructive-scale-rasterization']);
  });
});
