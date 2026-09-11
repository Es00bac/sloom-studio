import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import {
  getMultiLayerTransformPivot,
  resolveMultiLayerTransformParticipants,
  rotateSelectedLayersAroundPivot,
  scaleSelectedLayerRectsAroundPivot,
} from './ImageGroupTransform';
import {
  applyTransformPreviewSession,
  beginMultiLayerTransformPreviewSession,
  beginTransformPreviewSession,
  cancelTransformPreviewSession,
  clearTransformPreviewSession,
  describeTransformPreviewSession,
  getTransformPreviewSession,
  markMultiLayerTransformSessionStructureChange,
} from './ImageTransformPreview';
import { applyOperation, redo, undo } from './undoRedoApply';
import { getEditorOperationLabel } from './ImageEditorHistory';
import {
  decodeImageLayerProjectPixels,
  encodeImageLayerProjectPixels,
  type ImageLayerPixelCodec,
} from './ImageLayerProjectPixels';

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

const sizeOf = (layer: ImageLayer): { width: number; height: number } => ({
  width: layer.bitmap?.width ?? 0,
  height: layer.bitmap?.height ?? 0,
});

function layer(patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-a',
    name: 'Layer A',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: bitmap(100, 100),
    bitmapVersion: 0,
    mask: null,
    ...patch,
  };
}

function openDoc(layers: ImageLayer[], selectedLayerIds?: string[], activeLayerId?: string): ImageDocument {
  const doc = {
    ...createEmptyImageDocument({
      id: 'doc-multi-transform',
      title: 'Multi Transform',
      width: 640,
      height: 480,
    }),
    layers,
    activeLayerId: activeLayerId ?? layers[0]?.id ?? null,
    ...(selectedLayerIds ? { selectedLayerIds } : {}),
  };
  useImageEditorStore.getState().openDocument(doc);
  return doc;
}

function twoLayerDoc(): ImageDocument {
  return openDoc(
    [
      layer({ id: 'layer-a', name: 'A', x: 0, y: 0, bitmap: bitmap(100, 100) }),
      layer({ id: 'layer-b', name: 'B', x: 200, y: 100, bitmap: bitmap(80, 60) }),
    ],
    ['layer-a', 'layer-b'],
    'layer-b',
  );
}

/** Mimics the overlay's rotate gesture: rotate the gesture-start snapshot about the pivot. */
function applyRotationGesture(
  doc: ImageDocument,
  pivot: { x: number; y: number },
  angleDeg: number,
  participantLayerIds: readonly string[] = ['layer-a', 'layer-b'],
): void {
  const store = useImageEditorStore.getState();
  const currentDoc = store.documents.find((candidate) => candidate.id === doc.id);
  if (!currentDoc) return;
  const participantSet = new Set(participantLayerIds);
  const rotated = rotateSelectedLayersAroundPivot(currentDoc.layers, participantLayerIds, pivot, angleDeg, sizeOf);
  for (const entry of rotated) {
    if (!participantSet.has(entry.id)) continue;
    store.updateLayer(currentDoc.id, entry.id, {
      x: entry.x,
      y: entry.y,
      rotationDeg: entry.rotationDeg,
    });
  }
}

describe('resolveMultiLayerTransformParticipants', () => {
  it('resolves two unlocked sibling selections as eligible participants', () => {
    const doc = twoLayerDoc();
    expect(resolveMultiLayerTransformParticipants(doc)).toEqual({
      eligible: true,
      participantLayerIds: ['layer-a', 'layer-b'],
      excludedLayers: [],
      siblings: true,
      blocker: 'none',
    });
  });

  it('excludes locked, position-locked, and group layers with explicit reasons', () => {
    const doc = openDoc(
      [
        layer({ id: 'free', name: 'Free' }),
        layer({ id: 'full-lock', name: 'Locked', locked: true }),
        layer({ id: 'pos-lock', name: 'Position', locks: { position: true } }),
        layer({ id: 'grp', name: 'Group', type: 'group', bitmap: null }),
      ],
      ['free', 'full-lock', 'pos-lock', 'grp'],
      'free',
    );
    expect(resolveMultiLayerTransformParticipants(doc)).toMatchObject({
      eligible: false,
      participantLayerIds: ['free'],
      excludedLayers: [
        { layerId: 'full-lock', reason: 'full-lock' },
        { layerId: 'pos-lock', reason: 'position-lock' },
        { layerId: 'grp', reason: 'group-layer' },
      ],
      siblings: true,
      blocker: 'too-few-participants',
    });
  });

  it('excludes adjustment layers that have no transformable geometry', () => {
    const doc = openDoc(
      [
        layer({ id: 'paint-a', name: 'Paint A' }),
        layer({ id: 'adjustment', name: 'Curves', type: 'adjustment', bitmap: null }),
        layer({ id: 'paint-b', name: 'Paint B', x: 200 }),
      ],
      ['paint-a', 'adjustment', 'paint-b'],
      'paint-b',
    );

    expect(resolveMultiLayerTransformParticipants(doc)).toMatchObject({
      eligible: true,
      participantLayerIds: ['paint-a', 'paint-b'],
      excludedLayers: [
        { layerId: 'adjustment', reason: 'no-transformable-geometry' },
      ],
      blocker: 'none',
    });
    expect(getMultiLayerTransformPivot(
      doc.layers.filter((candidate) => candidate.id !== 'adjustment'),
      sizeOf,
    )).toEqual({ x: 150, y: 50 });
  });

  it('refuses a selection spanning different parent groups', () => {
    const doc = openDoc(
      [
        layer({ id: 'in-g1', name: 'G1 child', groupId: 'group-1' }),
        layer({ id: 'in-g2', name: 'G2 child', groupId: 'group-2' }),
      ],
      ['in-g1', 'in-g2'],
      'in-g1',
    );
    const crossGroup = resolveMultiLayerTransformParticipants(doc);
    expect(crossGroup).toMatchObject({
      eligible: false,
      siblings: false,
      blocker: 'multi-select-cross-group-boundaries-unsupported',
    });

    const sameGroup = resolveMultiLayerTransformParticipants(openDoc(
      [
        layer({ id: 'a', name: 'A', groupId: 'group-1' }),
        layer({ id: 'b', name: 'B', groupId: 'group-1' }),
      ],
      ['a', 'b'],
      'a',
    ));
    expect(sameGroup).toMatchObject({ eligible: true, siblings: true, blocker: 'none' });
  });

  it('is not eligible for a plain single-layer selection', () => {
    const doc = openDoc([layer({ id: 'solo', name: 'Solo' })], undefined, 'solo');
    expect(resolveMultiLayerTransformParticipants(doc)).toMatchObject({
      eligible: false,
      participantLayerIds: ['solo'],
      blocker: 'too-few-participants',
    });
  });
});

describe('getMultiLayerTransformPivot', () => {
  it('defaults the shared pivot to the centre of the participants\' combined rects', () => {
    const layers = [
      layer({ id: 'a', x: 0, y: 0, bitmap: bitmap(100, 100) }),
      layer({ id: 'b', x: 200, y: 100, bitmap: bitmap(80, 60) }),
    ];
    expect(getMultiLayerTransformPivot(layers, sizeOf)).toEqual({ x: 140, y: 80 });
    expect(getMultiLayerTransformPivot([], sizeOf)).toBeNull();
  });
});

describe('rotateSelectedLayersAroundPivot', () => {
  it('orbits each layer\'s own pivot point so a custom origin still rotates rigidly', () => {
    // Own pivot at (125, 175) for origin (0.25, 0.75) on a 100x100 layer at (100, 100).
    const custom = [layer({
      id: 'custom',
      x: 100,
      y: 100,
      transformOriginX: 0.25,
      transformOriginY: 0.75,
      bitmap: bitmap(100, 100),
    })];
    const rotated = rotateSelectedLayersAroundPivot(custom, ['custom'], { x: 150, y: 150 }, 90, sizeOf);
    // Offset (-25, 25) rotated +90 (Y-down) -> (-25, -25); new own pivot (125, 125);
    // back out the origin: x = 125 - 25 = 100, y = 125 - 75 = 50.
    expect(rotated[0].x).toBeCloseTo(100, 6);
    expect(rotated[0].y).toBeCloseTo(50, 6);
    expect(rotated[0].rotationDeg).toBe(90);
    // Rigid: the own-pivot distance from the shared pivot is preserved.
    const before = Math.hypot(125 - 150, 175 - 150);
    const after = Math.hypot((rotated[0].x + 25) - 150, (rotated[0].y + 75) - 150);
    expect(after).toBeCloseTo(before, 6);
  });

  it('adds rotation without moving a layer whose own pivot sits on the shared pivot', () => {
    const centered = [layer({ id: 'c', x: 100, y: 100, bitmap: bitmap(100, 100) })];
    const rotated = rotateSelectedLayersAroundPivot(centered, ['c'], { x: 150, y: 150 }, 45, sizeOf);
    expect(rotated[0].x).toBeCloseTo(100, 6);
    expect(rotated[0].y).toBeCloseTo(100, 6);
    expect(rotated[0].rotationDeg).toBe(45);
  });

  it('normalizes and rounds stored rotation across the signed seam', () => {
    const layers = [layer({ id: 'c', x: 100, y: 100, rotationDeg: 0, bitmap: bitmap(100, 100) })];
    const rotated = rotateSelectedLayersAroundPivot(layers, ['c'], { x: 150, y: 150 }, -340.004, sizeOf);

    expect(rotated[0].rotationDeg).toBe(20);
  });
});

describe('scaleSelectedLayerRectsAroundPivot', () => {
  it('scales each participant rect and its offset from the shared pivot', () => {
    const layers = [
      layer({ id: 'a', x: 0, y: 0, bitmap: bitmap(100, 100) }),
      layer({ id: 'b', x: 200, y: 100, bitmap: bitmap(80, 60) }),
    ];
    const rects = scaleSelectedLayerRectsAroundPivot(layers, ['a', 'b'], { x: 140, y: 80 }, 2, 2, sizeOf);
    expect(rects).toEqual([
      { id: 'a', x: -140, y: -80, width: 200, height: 200 },
      { id: 'b', x: 260, y: 120, width: 160, height: 120 },
    ]);
  });
});

describe('multi-layer transform preview session', () => {
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

  it('commits one multiTransform operation covering every participant and undoes as one step', () => {
    const doc = twoLayerDoc();
    beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);
    applyRotationGesture(doc, { x: 140, y: 80 }, 90);

    const operation = applyTransformPreviewSession(doc.id);

    expect(operation).toMatchObject({ kind: 'multiTransform', docId: doc.id });
    if (operation?.kind !== 'multiTransform') return;
    expect(Object.keys(operation.after).sort()).toEqual(['layer-a', 'layer-b']);
    expect(operation.before['layer-a']).toMatchObject({ x: 0, y: 0, rotationDeg: 0 });
    expect(operation.after['layer-a'].rotationDeg).toBe(90);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(getTransformPreviewSession(doc.id)).toBeNull();

    expect(undo(doc.id)).toBe(true);
    const undone = useImageEditorStore.getState().documents[0]!.layers;
    expect(undone.find((l) => l.id === 'layer-a')).toMatchObject({ x: 0, y: 0, rotationDeg: 0 });
    expect(undone.find((l) => l.id === 'layer-b')).toMatchObject({ x: 200, y: 100, rotationDeg: 0 });

    expect(redo(doc.id)).toBe(true);
    const redone = useImageEditorStore.getState().documents[0]!.layers;
    expect(redone.find((l) => l.id === 'layer-a')?.rotationDeg).toBe(90);
    expect(redone.find((l) => l.id === 'layer-b')?.rotationDeg).toBe(90);
  });

  it('cancels by restoring the whole pre-session selection', () => {
    const doc = twoLayerDoc();
    beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);
    applyRotationGesture(doc, { x: 140, y: 80 }, 33);
    useImageEditorStore.getState().updateLayer(doc.id, 'layer-a', { x: 500, y: 400 });

    expect(cancelTransformPreviewSession(doc.id)).toBe(true);

    const restored = useImageEditorStore.getState().documents[0]!.layers;
    expect(restored.find((l) => l.id === 'layer-a')).toMatchObject({ x: 0, y: 0 });
    expect(restored.find((l) => l.id === 'layer-a')?.rotationDeg ?? 0).toBe(0);
    expect(restored.find((l) => l.id === 'layer-b')).toMatchObject({ x: 200, y: 100 });
    expect(restored.find((l) => l.id === 'layer-b')?.rotationDeg ?? 0).toBe(0);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toBeUndefined();
  });

  it('commits a destructive multi-layer scale as one layerOp and restores bitmaps on undo', () => {
    const doc = twoLayerDoc();
    markMultiLayerTransformSessionStructureChange(doc, ['layer-a', 'layer-b']);
    const store = useImageEditorStore.getState();
    store.updateLayer(doc.id, 'layer-a', { x: -140, y: -80, bitmap: bitmap(200, 200) });
    store.updateLayer(doc.id, 'layer-b', { x: 260, y: 120, bitmap: bitmap(160, 120) });

    const operation = applyTransformPreviewSession(doc.id);

    expect(operation).toMatchObject({ kind: 'layerOp', docId: doc.id });
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);

    expect(undo(doc.id)).toBe(true);
    const restored = useImageEditorStore.getState().documents[0]!.layers;
    expect(restored.find((l) => l.id === 'layer-a')).toMatchObject({
      x: 0,
      y: 0,
      bitmap: { width: 100, height: 100 },
    });
    expect(restored.find((l) => l.id === 'layer-b')).toMatchObject({
      x: 200,
      y: 100,
      bitmap: { width: 80, height: 60 },
    });
  });

  it('pushes nothing when no participant changed', () => {
    const doc = twoLayerDoc();
    beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);

    expect(applyTransformPreviewSession(doc.id)).toBeNull();
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toBeUndefined();
  });

  it('does not let a single-layer session begin clobber an open multi session', () => {
    const doc = twoLayerDoc();
    const multi = beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);
    const layerB = doc.layers.find((l) => l.id === 'layer-b')!;

    const returned = beginTransformPreviewSession(doc, layerB);

    expect(returned).toBe(multi);
    expect(getTransformPreviewSession(doc.id)?.participantLayerIds).toEqual(['layer-a', 'layer-b']);
  });

  it('commits a pending multi gesture before starting a single-layer gesture after selection changes', () => {
    const doc = openDoc(
      [
        layer({ id: 'layer-a', name: 'A', x: 0, y: 0 }),
        layer({ id: 'layer-b', name: 'B', x: 200, y: 100 }),
        layer({ id: 'layer-c', name: 'C', x: 50, y: 250 }),
      ],
      ['layer-a', 'layer-b'],
      'layer-b',
    );
    beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);
    applyRotationGesture(doc, { x: 140, y: 80 }, 25);

    useImageEditorStore.getState().setActiveLayer(doc.id, 'layer-c');
    const selectedDoc = useImageEditorStore.getState().documents[0]!;
    const layerC = selectedDoc.layers.find((candidate) => candidate.id === 'layer-c')!;
    const single = beginTransformPreviewSession(selectedDoc, layerC);

    expect(single).toMatchObject({ layerId: 'layer-c' });
    expect(single.participantLayerIds).toBeUndefined();
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.[0]).toMatchObject({ kind: 'multiTransform' });

    useImageEditorStore.getState().updateLayer(doc.id, 'layer-c', { rotationDeg: 15 });
    expect(applyTransformPreviewSession(doc.id)).toMatchObject({ kind: 'transform', layerId: 'layer-c' });
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(2);

    expect(undo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-c')?.rotationDeg ?? 0).toBe(0);
    expect(undo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-a')).toMatchObject({ x: 0, y: 0, rotationDeg: 0 });
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-b')).toMatchObject({ x: 200, y: 100, rotationDeg: 0 });
  });

  it('commits a pending single gesture before plain-click then Ctrl-click starts a disjoint multi gesture', () => {
    const doc = openDoc(
      [
        layer({ id: 'layer-x', name: 'X', x: 0, y: 0 }),
        layer({ id: 'layer-a', name: 'A', x: 200, y: 0 }),
        layer({ id: 'layer-b', name: 'B', x: 400, y: 0 }),
      ],
      ['layer-x'],
      'layer-x',
    );
    const store = useImageEditorStore.getState();
    const layerX = doc.layers.find((candidate) => candidate.id === 'layer-x')!;
    beginTransformPreviewSession(doc, layerX);
    store.updateLayer(doc.id, layerX.id, { rotationDeg: 17 });

    store.setActiveLayer(doc.id, 'layer-a');
    store.toggleLayerSelection(doc.id, 'layer-b');
    const multiDoc = useImageEditorStore.getState().documents[0]!;
    expect(multiDoc.selectedLayerIds).toEqual(['layer-a', 'layer-b']);
    beginMultiLayerTransformPreviewSession(multiDoc, ['layer-a', 'layer-b']);

    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.[0]).toMatchObject({
      kind: 'transform',
      layerId: 'layer-x',
    });

    applyRotationGesture(multiDoc, { x: 350, y: 50 }, 20, ['layer-a', 'layer-b']);
    expect(applyTransformPreviewSession(doc.id)).toMatchObject({ kind: 'multiTransform' });
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(2);

    expect(undo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-x')).toMatchObject({ x: 0, y: 0, rotationDeg: 17 });
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-a')).toMatchObject({ x: 200, y: 0, rotationDeg: 0 });
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-b')).toMatchObject({ x: 400, y: 0, rotationDeg: 0 });

    expect(undo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-x')).toMatchObject({ x: 0, y: 0, rotationDeg: 0 });
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(0);
  });

  it('commits a pending single gesture before Ctrl-clicks retain that layer in the new multi gesture', () => {
    const doc = openDoc(
      [
        layer({ id: 'layer-x', name: 'X', x: 0, y: 0 }),
        layer({ id: 'layer-a', name: 'A', x: 200, y: 0 }),
        layer({ id: 'layer-b', name: 'B', x: 400, y: 0 }),
      ],
      ['layer-x'],
      'layer-x',
    );
    const store = useImageEditorStore.getState();
    const layerX = doc.layers.find((candidate) => candidate.id === 'layer-x')!;
    beginTransformPreviewSession(doc, layerX);
    store.updateLayer(doc.id, layerX.id, { rotationDeg: 17 });

    store.toggleLayerSelection(doc.id, 'layer-a');
    store.toggleLayerSelection(doc.id, 'layer-b');
    const multiDoc = useImageEditorStore.getState().documents[0]!;
    expect(multiDoc.selectedLayerIds).toEqual(['layer-x', 'layer-a', 'layer-b']);
    beginMultiLayerTransformPreviewSession(multiDoc, ['layer-x', 'layer-a', 'layer-b']);

    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.[0]).toMatchObject({
      kind: 'transform',
      layerId: 'layer-x',
    });

    applyRotationGesture(multiDoc, { x: 250, y: 50 }, 20, ['layer-x', 'layer-a', 'layer-b']);
    expect(applyTransformPreviewSession(doc.id)).toMatchObject({ kind: 'multiTransform' });
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(2);

    expect(undo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-x')).toMatchObject({ x: 0, y: 0, rotationDeg: 17 });
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-a')).toMatchObject({ x: 200, y: 0, rotationDeg: 0 });
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-b')).toMatchObject({ x: 400, y: 0, rotationDeg: 0 });

    expect(undo(doc.id)).toBe(true);
    expect(useImageEditorStore.getState().documents[0]?.layers.find((candidate) => candidate.id === 'layer-x')).toMatchObject({ x: 0, y: 0, rotationDeg: 0 });
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toHaveLength(0);
  });

  it('continues the same session across gestures with the same participants', () => {
    const doc = twoLayerDoc();
    const first = beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);
    applyRotationGesture(doc, { x: 140, y: 80 }, 15);

    const second = beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);

    expect(second).toBe(first);
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toBeUndefined();
  });

  it('commits the pending gesture before re-baselining when the selection changes', () => {
    const doc = openDoc(
      [
        layer({ id: 'layer-a', name: 'A', x: 0, y: 0 }),
        layer({ id: 'layer-b', name: 'B', x: 200, y: 100 }),
        layer({ id: 'layer-c', name: 'C', x: 50, y: 250 }),
      ],
      ['layer-a', 'layer-b'],
      'layer-b',
    );
    beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);
    applyRotationGesture(doc, { x: 140, y: 80 }, 25);

    beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-c']);

    const stacks = useImageEditorStore.getState().undoStacks[doc.id];
    expect(stacks).toHaveLength(1);
    expect(stacks[0]).toMatchObject({ kind: 'multiTransform' });
    expect(getTransformPreviewSession(doc.id)?.participantLayerIds).toEqual(['layer-a', 'layer-c']);
  });

  it('describes the multi session with its participant set and multiTransform operation kind', () => {
    const doc = twoLayerDoc();
    beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);
    applyRotationGesture(doc, { x: 140, y: 80 }, 40);
    const currentDoc = useImageEditorStore.getState().documents[0]!;

    const descriptor = describeTransformPreviewSession(currentDoc);

    expect(descriptor).toMatchObject({
      docId: doc.id,
      layerId: 'layer-b',
      pendingChanges: true,
      structureChange: false,
      operationKind: 'multiTransform',
      multiLayer: { participantLayerIds: ['layer-a', 'layer-b'] },
    });
  });
});

describe('multiTransform history operation', () => {
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

  it('labels the operation by its layer count', () => {
    const operation = {
      kind: 'multiTransform',
      docId: 'doc',
      before: { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      after: { a: { x: 2, y: 0 }, b: { x: 3, y: 1 } },
    } as const;
    expect(getEditorOperationLabel(operation)).toBe('Transform 2 Layers');
  });

  it('applies only to layers that still exist in the document', () => {
    const doc = openDoc(
      [
        layer({ id: 'keep', name: 'Keep', x: 0, y: 0 }),
        layer({ id: 'gone', name: 'Gone', x: 10, y: 10 }),
      ],
      ['keep'],
      'keep',
    );
    useImageEditorStore.getState().removeLayer(doc.id, 'gone');

    applyOperation({
      kind: 'multiTransform',
      docId: doc.id,
      before: {
        keep: { x: 0, y: 0, rotationDeg: 0 },
        gone: { x: 10, y: 10, rotationDeg: 0 },
      },
      after: {
        keep: { x: 42, y: 24, rotationDeg: 15 },
        gone: { x: 99, y: 99, rotationDeg: 45 },
      },
    }, 'redo');

    const layers = useImageEditorStore.getState().documents[0]!.layers;
    expect(layers.find((l) => l.id === 'keep')).toMatchObject({ x: 42, y: 24, rotationDeg: 15 });
    expect(layers.find((l) => l.id === 'gone')).toBeUndefined();
  });
});

describe('multi-layer transform persistence', () => {
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

  it('preserves the committed transform of every participant through project save -> reopen', async () => {
    const doc = twoLayerDoc();
    beginMultiLayerTransformPreviewSession(doc, ['layer-a', 'layer-b']);
    applyRotationGesture(doc, { x: 140, y: 80 }, 90);
    const operation = applyTransformPreviewSession(doc.id);
    expect(operation?.kind).toBe('multiTransform');

    const stubCodec: ImageLayerPixelCodec = {
      encode: async (source) => `encoded:${source.width}x${source.height}`,
      decode: async (dataUrl) => {
        const [width, height] = dataUrl.replace('encoded:', '').split('x').map(Number);
        return bitmap(width, height);
      },
    };

    const committed = useImageEditorStore.getState().documents[0]!.layers;
    for (const before of committed) {
      const encoded = await encodeImageLayerProjectPixels(before, stubCodec);
      const serialized = JSON.parse(JSON.stringify(encoded)) as ImageLayer; // disk round-trip
      const decoded = await decodeImageLayerProjectPixels(serialized, stubCodec);
      expect(decoded.x).toBe(before.x);
      expect(decoded.y).toBe(before.y);
      expect(decoded.rotationDeg).toBe(before.rotationDeg);
      expect(decoded.bitmap?.width).toBe(before.bitmap?.width);
      expect(decoded.bitmap?.height).toBe(before.bitmap?.height);
    }
  });
});
