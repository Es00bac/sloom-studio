import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { defaultImageLayerPixelCodec } from './ImageLayerProjectPixels';
import { clearAllSelections, clearSelection, getSelection, setSelection } from './selectionRegistry';
import { createMask } from './SelectionMask';
import {
  addImageDocumentSnapshot,
  buildImageDocumentSnapshotIntegrity,
  buildImageSnapshotReadinessDescriptor,
  createImageDocumentSnapshot,
  deleteImageDocumentSnapshot,
  renameImageDocumentSnapshot,
  restoreImageDocumentSnapshot,
} from './ImageSnapshots';

class PixelOffscreenCanvas {
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
      drawImage: (source: PixelOffscreenCanvas) => {
        this.pixel = [...source.pixel];
      },
      getImageData: () => {
        const data = new Uint8ClampedArray(this.width * this.height * 4);
        for (let offset = 0; offset < data.length; offset += 4) data.set(this.pixel, offset);
        return { width: this.width, height: this.height, data };
      },
    };
  }
}

function makeLayer(id: string): ImageLayer {
  return {
    id,
    name: id,
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
  };
}

function makeDoc(overrides?: Partial<ImageDocument>): ImageDocument {
  return {
    id: 'doc',
    title: 'Doc',
    width: 10,
    height: 10,
    layers: [makeLayer('base')],
    activeLayerId: 'base',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    snapshots: [],
    ...overrides,
  };
}

describe('ImageSnapshots', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = PixelOffscreenCanvas as unknown as typeof OffscreenCanvas;
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
    clearAllSelections();
  });

  it('stores compact document layer state snapshots without flattening bitmaps', () => {
    const doc = makeDoc();
    const snapshot = createImageDocumentSnapshot(doc, 'Before type');
    const withSnapshot = addImageDocumentSnapshot(doc, snapshot);

    expect(withSnapshot.snapshots).toHaveLength(1);
    expect(withSnapshot.snapshots?.[0]).toMatchObject({ name: 'Before type', layers: doc.layers });
    expect(withSnapshot.dirty).toBe(true);
  });

  it('renames snapshots with normalized durable names and updated metadata', () => {
    const doc = addImageDocumentSnapshot(makeDoc(), createImageDocumentSnapshot(makeDoc(), 'Before cleanup'));
    const snapshotId = doc.snapshots?.[0]?.id ?? '';

    const renamed = renameImageDocumentSnapshot(doc, snapshotId, '  Final named state  ', 1234);

    expect(renamed.snapshots?.[0]).toMatchObject({
      id: snapshotId,
      name: 'Final named state',
      updatedAt: 1234,
    });
    expect(renamed.dirty).toBe(true);

    const unchanged = renameImageDocumentSnapshot(renamed, snapshotId, '   ', 9999);
    expect(unchanged).toBe(renamed);
  });

  it('builds deterministic snapshot readiness for named states and rename previews', () => {
    const selectionMask = { width: 10, height: 10, data: new Uint8ClampedArray(100) };
    selectionMask.data[7] = 255;
    const baseLayers = [makeLayer('base')];
    const doc = makeDoc({
      dirty: true,
      snapshots: [
        {
          id: 'snapshot-base',
          name: 'Base state',
          createdAt: 10,
          updatedAt: 20,
          width: 10,
          height: 10,
          layers: baseLayers,
          activeLayerId: 'base',
          hasSelection: true,
          selectionVersion: 2,
          selectionMask,
          pixelState: 'complete',
          integrity: buildImageDocumentSnapshotIntegrity(baseLayers, selectionMask),
        },
        {
          id: 'snapshot-bad',
          name: 'Broken state',
          createdAt: 30,
          width: 0,
          height: -1,
          layers: [],
          activeLayerId: null,
          hasSelection: false,
          selectionVersion: 3,
          pixelState: 'complete',
          integrity: buildImageDocumentSnapshotIntegrity([]),
        },
      ],
    });

    const readiness = buildImageSnapshotReadinessDescriptor({
      doc,
      rename: {
        snapshotId: 'snapshot-base',
        draftName: '  Final   named state  ',
      },
    });

    expect(readiness.descriptorId).toBe('image-history-snapshots-readiness:v1');
    expect(readiness.document).toEqual({
      id: 'doc',
      title: 'Doc',
      width: 10,
      height: 10,
      layerCount: 1,
      activeLayerId: 'base',
      hasSelection: false,
      dirty: true,
    });
    expect(readiness.capacity).toEqual({
      maxSnapshots: 12,
      count: 2,
      remaining: 10,
      canCreate: true,
    });
    expect(readiness.namedSnapshots.snapshots.map((snapshot) => ({
      id: snapshot.id,
      name: snapshot.name,
      layerCount: snapshot.layerCount,
      restorable: snapshot.restorable,
      blockerCodes: snapshot.blockers.map((blocker) => blocker.code),
      warningCodes: snapshot.warnings.map((warning) => warning.code),
    }))).toEqual([
      {
        id: 'snapshot-base',
        name: 'Base state',
        layerCount: 1,
        restorable: true,
        blockerCodes: [],
        warningCodes: [],
      },
      {
        id: 'snapshot-bad',
        name: 'Broken state',
        layerCount: 0,
        restorable: false,
        blockerCodes: ['invalid-snapshot-dimensions'],
        warningCodes: ['empty-snapshot-layers'],
      },
    ]);
    expect(readiness.rename).toMatchObject({
      supported: true,
      targetSnapshotId: 'snapshot-base',
      targetExists: true,
      currentName: 'Base state',
      draftName: 'Final named state',
      unchanged: false,
      willUpdate: true,
      blockers: [],
      warnings: [],
    });
    expect(readiness.rename.signature).toBe(
      'image-history-snapshot-rename:v1:{"snapshotId":"snapshot-base","targetExists":true,"currentName":"Base state","draftName":"Final named state","willUpdate":true,"blockerCodes":[],"warningCodes":[]}',
    );
    expect(readiness.preview).toEqual({
      id: 'image-history-snapshots-preview:doc:2-snapshots:1-blockers',
      signature: 'image-history-snapshots-readiness:v1:{"document":{"id":"doc","width":10,"height":10,"layerCount":1,"activeLayerId":"base","hasSelection":false},"snapshotSignatures":["image-history-snapshot:v1:{\\"id\\":\\"snapshot-base\\",\\"name\\":\\"Base state\\",\\"createdAt\\":10,\\"updatedAt\\":20,\\"width\\":10,\\"height\\":10,\\"layerCount\\":1,\\"activeLayerId\\":\\"base\\",\\"hasSelection\\":true,\\"selectionVersion\\":2,\\"restorable\\":true,\\"blockerCodes\\":[],\\"warningCodes\\":[]}","image-history-snapshot:v1:{\\"id\\":\\"snapshot-bad\\",\\"name\\":\\"Broken state\\",\\"createdAt\\":30,\\"updatedAt\\":null,\\"width\\":0,\\"height\\":-1,\\"layerCount\\":0,\\"activeLayerId\\":null,\\"hasSelection\\":false,\\"selectionVersion\\":3,\\"restorable\\":false,\\"blockerCodes\\":[\\"invalid-snapshot-dimensions\\"],\\"warningCodes\\":[\\"empty-snapshot-layers\\"]}"],"renameSignature":"image-history-snapshot-rename:v1:{\\"snapshotId\\":\\"snapshot-base\\",\\"targetExists\\":true,\\"currentName\\":\\"Base state\\",\\"draftName\\":\\"Final named state\\",\\"willUpdate\\":true,\\"blockerCodes\\":[],\\"warningCodes\\":[]}","blockerCodes":["invalid-snapshot-dimensions"],"warningCodes":["empty-snapshot-layers"]}',
    });
    expect(readiness.automationMetadata).toEqual({
      workspaceId: 'image-automation',
      separateFromMainFlow: true,
      bindingReadiness: 'ready-for-review',
      supportsNamedSnapshotVariables: true,
      supportsArbitraryJsExpressions: false,
      snapshotVariableTargets: ['snapshot-base'],
    });
  });

  it('reports snapshot rename blockers for missing targets and blank names', () => {
    const readiness = buildImageSnapshotReadinessDescriptor({
      doc: makeDoc(),
      rename: {
        snapshotId: 'missing',
        draftName: '   ',
      },
    });

    expect(readiness.rename).toMatchObject({
      supported: false,
      targetSnapshotId: 'missing',
      targetExists: false,
      currentName: null,
      draftName: '',
      unchanged: false,
      willUpdate: false,
    });
    expect(readiness.rename.blockers.map((blocker) => blocker.code)).toEqual([
      'missing-snapshot',
      'blank-snapshot-name',
    ]);
    expect(readiness.preview.id).toBe('image-history-snapshots-preview:doc:0-snapshots:2-blockers');
  });

  it('restores and deletes snapshots by id', () => {
    const original = makeDoc();
    const snapshot = createImageDocumentSnapshot(original, 'Base');
    const changed = addImageDocumentSnapshot(original, snapshot);
    const withEdit = { ...changed, layers: [makeLayer('edit')], activeLayerId: 'edit' };

    const restored = restoreImageDocumentSnapshot(withEdit, snapshot.id);
    expect(restored.layers.map((layer) => layer.id)).toEqual(['base']);
    expect(restored.activeLayerId).toBe('base');

    const deleted = deleteImageDocumentSnapshot(restored, snapshot.id);
    expect(deleted.snapshots).toEqual([]);
  });

  it('freezes named snapshot pixels and restores them after a project JSON round trip', async () => {
    const originalEncode = defaultImageLayerPixelCodec.encode;
    const originalDecode = defaultImageLayerPixelCodec.decode;
    defaultImageLayerPixelCodec.encode = async (bitmap) => JSON.stringify({
      width: bitmap.width,
      height: bitmap.height,
      pixel: (bitmap as unknown as PixelOffscreenCanvas).pixel,
    });
    defaultImageLayerPixelCodec.decode = async (payload) => {
      const parsed = JSON.parse(payload) as {
        width: number;
        height: number;
        pixel: [number, number, number, number];
      };
      const bitmap = new PixelOffscreenCanvas(parsed.width, parsed.height);
      bitmap.pixel = [...parsed.pixel];
      return bitmap as unknown as LayerBitmap;
    };

    try {
      const liveBitmap = new PixelOffscreenCanvas(1, 1);
      liveBitmap.pixel = [180, 20, 30, 255];
      const liveMask = new PixelOffscreenCanvas(1, 1);
      liveMask.pixel = [40, 50, 200, 255];
      const initial = {
        ...createEmptyImageDocument({
          id: 'doc-snapshot-project-roundtrip',
          title: 'Snapshot project round trip',
          width: 1,
          height: 1,
        }),
        layers: [makeLayer('base')],
        activeLayerId: 'base',
      };
      initial.layers[0].bitmap = liveBitmap as unknown as LayerBitmap;
      initial.layers[0].mask = liveMask as unknown as LayerBitmap;
      initial.layers[0].metadata = {
        sourceLink: {
          id: 'source-red',
          status: 'linked',
          label: 'Red source',
          width: 1,
          height: 1,
          relinkHistory: [],
        },
      };
      const snapshot = createImageDocumentSnapshot(initial, 'Red state');
      const withSnapshot = addImageDocumentSnapshot(initial, snapshot);
      liveBitmap.pixel = [10, 190, 20, 255];
      liveMask.pixel = [200, 210, 20, 255];
      initial.layers[0].metadata.sourceLink!.label = 'Mutated source';
      useImageEditorStore.getState().openDocument(withSnapshot);

      const serialized = JSON.parse(JSON.stringify(
        await useImageEditorStore.getState().exportProjectSnapshotWithPixels(),
      ));
      useImageEditorStore.getState().restoreProjectSnapshot(undefined);
      await useImageEditorStore.getState().restoreProjectSnapshotWithPixels(serialized);

      const reopened = useImageEditorStore.getState().getActiveDocument();
      expect(reopened).toBeDefined();
      const restored = restoreImageDocumentSnapshot(reopened!, snapshot.id);
      expect((restored.layers[0].bitmap as unknown as PixelOffscreenCanvas).pixel).toEqual([
        180,
        20,
        30,
        255,
      ]);
      expect((restored.layers[0].mask as unknown as PixelOffscreenCanvas).pixel).toEqual([
        40,
        50,
        200,
        255,
      ]);
      expect(restored.layers[0].metadata?.sourceLink?.label).toBe('Red source');
    } finally {
      defaultImageLayerPixelCodec.encode = originalEncode;
      defaultImageLayerPixelCodec.decode = originalDecode;
    }
  });

  it('restores exact asymmetric selection bytes after replacement, clear, and a fresh project-store round trip', async () => {
    const initial = makeDoc({ id: 'selection-snapshot', width: 3, height: 2, hasSelection: true });
    const selectionA = createMask(3, 2);
    selectionA.data.set([0, 255, 17, 3, 128, 64]);
    setSelection(initial.id, selectionA);
    const snapshot = createImageDocumentSnapshot(initial, 'Selection A');
    const withSnapshot = addImageDocumentSnapshot(initial, snapshot);

    selectionA.data.fill(9);
    const selectionB = createMask(3, 2);
    selectionB.data.set([255, 0, 0, 222, 0, 1]);
    setSelection(initial.id, selectionB);
    const restoredFromB = restoreImageDocumentSnapshot(withSnapshot, snapshot.id);
    expect(restoredFromB.hasSelection).toBe(true);
    expect(Array.from(getSelection(initial.id)?.data ?? [])).toEqual([0, 255, 17, 3, 128, 64]);
    expect(getSelection(initial.id)?.data).not.toBe(snapshot.selectionMask?.data);

    clearSelection(initial.id);
    const restoredFromClear = restoreImageDocumentSnapshot(
      { ...restoredFromB, hasSelection: false },
      snapshot.id,
    );
    expect(restoredFromClear.hasSelection).toBe(true);
    expect(Array.from(getSelection(initial.id)?.data ?? [])).toEqual([0, 255, 17, 3, 128, 64]);

    useImageEditorStore.getState().openDocument({ ...withSnapshot, hasSelection: false });
    const serialized = JSON.parse(JSON.stringify(
      await useImageEditorStore.getState().exportProjectSnapshotWithPixels(),
    ));
    useImageEditorStore.getState().restoreProjectSnapshot(undefined);
    clearAllSelections();
    await useImageEditorStore.getState().restoreProjectSnapshotWithPixels(serialized);
    const reopened = useImageEditorStore.getState().getActiveDocument();
    expect(reopened?.snapshots?.[0]?.selectionMask?.data).toEqual(
      new Uint8ClampedArray([0, 255, 17, 3, 128, 64]),
    );
    const restoredFresh = restoreImageDocumentSnapshot(reopened!, snapshot.id);
    expect(restoredFresh.hasSelection).toBe(true);
    expect(Array.from(getSelection(initial.id)?.data ?? [])).toEqual([0, 255, 17, 3, 128, 64]);
  });

  it('clears a live registry mask when the restored snapshot proves there was no selection', () => {
    const initial = makeDoc({ id: 'selection-clear', width: 2, height: 2 });
    const snapshot = createImageDocumentSnapshot(initial, 'No selection');
    const liveSelection = createMask(2, 2);
    liveSelection.data[0] = 255;
    setSelection(initial.id, liveSelection);

    const restored = restoreImageDocumentSnapshot(
      { ...addImageDocumentSnapshot(initial, snapshot), hasSelection: true },
      snapshot.id,
    );

    expect(restored.hasSelection).toBe(false);
    expect(getSelection(initial.id)).toBeUndefined();
  });

  it('fails legacy lightweight snapshot restore closed instead of borrowing live pixels', () => {
    const liveBitmap = { width: 20, height: 20 } as LayerBitmap;
    const liveMask = { width: 20, height: 20 } as LayerBitmap;
    const snapshot = {
      id: 'snapshot-lightweight',
      name: 'Saved metadata checkpoint',
      createdAt: 1,
      width: 10,
      height: 10,
      layers: [{
        ...makeLayer('base'),
        name: 'Saved layer name',
        bitmap: null,
        bitmapVersion: 2,
        mask: null,
      }],
      activeLayerId: 'base',
      hasSelection: false,
      selectionVersion: 1,
    };
    const doc = makeDoc({
      layers: [{
        ...makeLayer('base'),
        bitmap: liveBitmap,
        bitmapVersion: 8,
        mask: liveMask,
      }],
      snapshots: [snapshot],
    });

    const restored = restoreImageDocumentSnapshot(doc, 'snapshot-lightweight');

    expect(restored).toBe(doc);
    expect(restored.layers[0]).toMatchObject({ bitmap: liveBitmap, bitmapVersion: 8, mask: liveMask });
    expect(buildImageSnapshotReadinessDescriptor({ doc }).namedSnapshots.snapshots[0]).toMatchObject({
      restorable: false,
      blockers: [{ code: 'snapshot-pixels-unavailable' }],
    });
  });

  it('blocks Restore when complete claims lack a proven bitmap or exact selection payload', () => {
    const expectedBitmap = new PixelOffscreenCanvas(2, 2) as unknown as LayerBitmap;
    const layers = [{ ...makeLayer('base'), bitmap: expectedBitmap }];
    const selectionMask = { width: 2, height: 2, data: new Uint8ClampedArray([0, 255, 0, 1]) };
    const integrity = buildImageDocumentSnapshotIntegrity(layers, selectionMask);
    const stripped = {
      id: 'stripped-complete', name: 'Stripped', createdAt: 1, width: 2, height: 2,
      layers: [{ ...layers[0], bitmap: null }], activeLayerId: 'base', hasSelection: true,
      selectionVersion: 1, pixelState: 'complete' as const, integrity,
    };
    const doc = makeDoc({ snapshots: [stripped] });
    const readiness = buildImageSnapshotReadinessDescriptor({ doc });

    expect(readiness.namedSnapshots.snapshots[0].restorable).toBe(false);
    expect(readiness.namedSnapshots.snapshots[0].blockers.map((blocker) => blocker.code)).toEqual([
      'snapshot-selection-unavailable',
    ]);
    expect(restoreImageDocumentSnapshot(doc, stripped.id)).toBe(doc);
  });

  it('keeps current dimensions when restoring a malformed snapshot with invalid dimensions', () => {
    const snapshot = {
      id: 'snapshot-invalid-size',
      name: 'Invalid size',
      createdAt: 1,
      width: 0,
      height: -50,
      layers: [makeLayer('base')],
      activeLayerId: 'base',
      hasSelection: false,
      selectionVersion: 1,
    };
    const doc = makeDoc({ width: 640, height: 480, snapshots: [snapshot] });

    const restored = restoreImageDocumentSnapshot(doc, 'snapshot-invalid-size');

    expect(restored.width).toBe(640);
    expect(restored.height).toBe(480);
  });
});
