import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { createAdjustmentLayer, defaultAdjustmentSettings } from './ImageAdjustmentLayer';
import { addImageLayerUndoable } from './imageLayerInsert';
import {
  addAdjustmentLayerUndoable,
  addCameraRawDevelopmentStackUndoable,
  commitAdjustmentSettingsUndoable,
} from './imageAdjustmentActions';
import { normalizeCameraRawDevelopmentDraft } from './ImageCameraRawDevelopment';
import { redo, undo } from './undoRedoApply';

class FakeOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext() {
    return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }) };
  }
}

function openDoc() {
  useImageEditorStore.getState().openDocument(
    createEmptyImageDocument({ id: 'doc-adjust', title: 'Adjust', width: 64, height: 64 }),
  );
}

function undoCount(): number {
  return useImageEditorStore.getState().undoStacks['doc-adjust']?.length ?? 0;
}

function addPhotographicPixels() {
  const store = useImageEditorStore.getState();
  const doc = store.getActiveDocument();
  if (!doc) throw new Error('expected active document');
  store.setLayers(doc.id, [{
    id: 'photo', name: 'Photo', type: 'image', visible: true, locked: false, opacity: 1,
    blendMode: 'normal', x: 0, y: 0, bitmap: new FakeOffscreenCanvas(1, 1) as unknown as OffscreenCanvas,
    bitmapVersion: 0, mask: null,
  }]);
}

describe('imageAdjustmentActions', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    useImageEditorStore.setState({ documents: [], activeDocId: null, undoStacks: {}, redoStacks: {} });
  });

  it('adds a non-destructive adjustment layer of the requested kind, makes it active, and is undoable', () => {
    openDoc();
    const before = undoCount();

    const layer = addAdjustmentLayerUndoable('curves');

    expect(layer).not.toBeNull();
    expect(layer?.type).toBe('adjustment');
    expect(layer?.adjustment?.kind).toBe('curves');

    const doc = useImageEditorStore.getState().getActiveDocument();
    expect(doc?.layers.some((entry) => entry.id === layer?.id)).toBe(true);
    expect(doc?.activeLayerId).toBe(layer?.id);
    expect(undoCount()).toBe(before + 1);
  });

  it('returns null and does nothing when there is no active document', () => {
    expect(addAdjustmentLayerUndoable('levels')).toBeNull();
  });

  it('refuses adjustment mutation on a high-bit document before adding history', () => {
    openDoc();
    const store = useImageEditorStore.getState();
    const doc = store.getActiveDocument()!;
    useImageEditorStore.setState({ documents: store.documents.map((candidate) => candidate.id === doc.id
      ? { ...candidate, metadata: { ...candidate.metadata, bitDepth: 16 } }
      : candidate) });
    const before = store.getActiveDocument()!.layers;
    expect(addAdjustmentLayerUndoable('levels')).toBeNull();
    expect(store.getActiveDocument()!.layers).toEqual(before);
    expect(undoCount()).toBe(0);
  });

  it('refuses the generic adjustment-layer insertion route on high-bit documents', () => {
    openDoc();
    const store = useImageEditorStore.getState();
    const doc = store.getActiveDocument()!;
    useImageEditorStore.setState({ documents: store.documents.map((candidate) => candidate.id === doc.id
      ? { ...candidate, metadata: { ...candidate.metadata, bitDepth: 32 } }
      : candidate) });
    const before = store.getActiveDocument()!.layers;
    expect(addImageLayerUndoable(createAdjustmentLayer(store.getActiveDocument()!, 'levels'))).toBeNull();
    expect(store.getActiveDocument()!.layers).toEqual(before);
    expect(undoCount()).toBe(0);
  });

  it('commits edited adjustment settings onto an existing adjustment layer, undoably', () => {
    openDoc();
    const layer = addAdjustmentLayerUndoable('brightnessContrast');
    expect(layer).not.toBeNull();
    const undoAfterAdd = undoCount();

    const edited = { ...defaultAdjustmentSettings('brightnessContrast'), brightness: 42, contrast: -15 };
    commitAdjustmentSettingsUndoable(layer!.id, edited);

    const committed = useImageEditorStore
      .getState()
      .getActiveDocument()
      ?.layers.find((entry) => entry.id === layer!.id);
    expect(committed?.adjustment).toMatchObject({ kind: 'brightnessContrast', brightness: 42, contrast: -15 });
    expect(undoCount()).toBe(undoAfterAdd + 1);
  });

  it('ignores a commit for a layer that does not exist', () => {
    openDoc();
    const before = undoCount();
    commitAdjustmentSettingsUndoable('missing-layer', defaultAdjustmentSettings('levels'));
    expect(undoCount()).toBe(before);
  });

  it('applies a bounded Camera Raw-style RGB stack as one undoable operation only when photo pixels exist', () => {
    openDoc();
    const beforeRefusal = addCameraRawDevelopmentStackUndoable({ exposure: 9 });
    expect(beforeRefusal).toEqual({ status: 'refused', reason: 'no-photographic-pixels' });
    expect(undoCount()).toBe(0);

    addPhotographicPixels();
    const before = undoCount();
    const result = addCameraRawDevelopmentStackUndoable({ temperature: 30, tint: -20, exposure: 9, brightness: 12, contrast: -18 });
    expect(result.status).toBe('applied');
    const adjustments = useImageEditorStore.getState().getActiveDocument()?.layers.filter((layer) => layer.type === 'adjustment') ?? [];
    expect(adjustments.map((layer) => layer.adjustment)).toEqual([
      { kind: 'temperatureTint', temperature: 30, tint: -20 },
      { kind: 'exposure', exposure: 5, offset: 0, gamma: 1 },
      { kind: 'brightnessContrast', brightness: 12, contrast: -18 },
    ]);
    expect(undoCount()).toBe(before + 1);
    expect(undo('doc-adjust')).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers.map((layer) => layer.id)).toEqual(['photo']);
    expect(redo('doc-adjust')).toBe(true);
    expect(useImageEditorStore.getState().getActiveDocument()?.layers.filter((layer) => layer.type === 'adjustment')).toHaveLength(3);
  });

  it('refuses the Camera Raw three-layer stack before mutation on high-bit documents', () => {
    openDoc();
    addPhotographicPixels();
    const store = useImageEditorStore.getState();
    const doc = store.getActiveDocument()!;
    useImageEditorStore.setState({ documents: store.documents.map((candidate) => candidate.id === doc.id
      ? { ...candidate, metadata: { ...candidate.metadata, bitDepth: 16 } }
      : candidate) });
    const before = store.getActiveDocument()!.layers;
    expect(addCameraRawDevelopmentStackUndoable({ exposure: 9 })).toEqual({
      status: 'refused', reason: 'high-bit-adjustment-unsupported',
    });
    expect(store.getActiveDocument()!.layers).toEqual(before);
    expect(undoCount()).toBe(0);
  });

  it('keeps Camera Raw stack identities unique when the legacy timestamp and random bucket collide', () => {
    openDoc();
    addPhotographicPixels();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      const first = addCameraRawDevelopmentStackUndoable({ exposure: 1 });
      const second = addCameraRawDevelopmentStackUndoable({ exposure: 2 });
      expect(first.status).toBe('applied');
      expect(second.status).toBe('applied');
      if (first.status !== 'applied' || second.status !== 'applied') throw new Error('expected applied Camera Raw stacks');

      const ids = [...first.layerIds, ...second.layerIds];
      expect(new Set(ids).size).toBe(6);
      const doc = useImageEditorStore.getState().getActiveDocument();
      expect(doc?.layers.filter((layer) => ids.includes(layer.id))).toHaveLength(6);

      commitAdjustmentSettingsUndoable(first.layerIds[1], { kind: 'exposure', exposure: 4, offset: 0, gamma: 1 });
      expect(useImageEditorStore.getState().getActiveDocument()?.layers.filter((layer) => layer.id === first.layerIds[1]))
        .toEqual([expect.objectContaining({ adjustment: expect.objectContaining({ exposure: 4 }) })]);

      useImageEditorStore.getState().removeLayer('doc-adjust', first.layerIds[0]);
      expect(useImageEditorStore.getState().getActiveDocument()?.layers.filter((layer) => ids.includes(layer.id))).toHaveLength(5);
    } finally {
      now.mockRestore();
      random.mockRestore();
    }
  });

  it('normalizes hostile Camera Raw-style draft values before they can reach the compositor', () => {
    expect(normalizeCameraRawDevelopmentDraft({ temperature: Number.NaN, tint: -999, exposure: Infinity, brightness: 999, contrast: -999 }))
      .toEqual({ temperature: 0, tint: -100, exposure: 0, brightness: 100, contrast: -100 });
  });
});
