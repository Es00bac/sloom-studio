import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ImageDocumentSnapshot,
  ImageLayer,
  LayerBitmap,
  SelectionMaskSnapshot,
} from '../../types/imageEditor';
import {
  decodeImageDocumentSnapshotProjectPixels,
  defaultImageLayerPixelCodec,
  encodeImageDocumentSnapshotProjectPixels,
  type ImageLayerPixelCodec,
} from './ImageLayerProjectPixels';
import {
  buildImageDocumentSnapshotIntegrity,
  buildImageSnapshotReadinessDescriptor,
  inspectImageDocumentSnapshotIntegrity,
} from './ImageSnapshots';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { createMask } from './SelectionMask';
import { clearAllSelections, getSelection, setSelection } from './selectionRegistry';

class ByteBitmap {
  width: number;
  height: number;
  bytes: Uint8ClampedArray;

  constructor(width: number, height: number, bytes?: ArrayLike<number>) {
    this.width = width;
    this.height = height;
    this.bytes = bytes
      ? new Uint8ClampedArray(bytes)
      : new Uint8ClampedArray(width * height * 4);
  }

  getContext() {
    return {
      drawImage: (source: LayerBitmap) => {
        const context = source.getContext('2d');
        if (!context) throw new Error('test bitmap source has no readable context');
        this.bytes = new Uint8ClampedArray(
          context.getImageData(0, 0, source.width, source.height).data,
        );
      },
      getImageData: () => ({
        width: this.width,
        height: this.height,
        data: new Uint8ClampedArray(this.bytes),
      }),
      putImageData: (imageData: ImageData) => {
        this.bytes = new Uint8ClampedArray(imageData.data);
      },
      clearRect: () => {
        this.bytes.fill(0);
      },
    };
  }

  async convertToBlob(): Promise<Blob> {
    return new Blob([this.bytes.buffer as ArrayBuffer]);
  }
}

function bitmap(bytes: ArrayLike<number>): LayerBitmap {
  return new ByteBitmap(1, 1, bytes) as unknown as LayerBitmap;
}

function bytesOf(value: LayerBitmap | null): Uint8ClampedArray {
  return (value as unknown as ByteBitmap).bytes;
}

function layer(id: string, bitmapBytes: ArrayLike<number>, maskBytes: ArrayLike<number>): ImageLayer {
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
    bitmap: bitmap(bitmapBytes),
    bitmapVersion: 0,
    mask: bitmap(maskBytes),
  };
}

function snapshot(): ImageDocumentSnapshot {
  const layers = [
    layer('layer-a', [10, 20, 30, 255], [40, 50, 60, 255]),
    layer('layer-b', [70, 80, 90, 255], [100, 110, 120, 255]),
  ];
  const selectionMask: SelectionMaskSnapshot = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([211]),
  };
  return {
    id: 'snapshot-content-proof',
    name: 'Content proof',
    createdAt: 1,
    width: 1,
    height: 1,
    layers,
    activeLayerId: 'layer-a',
    hasSelection: true,
    selectionVersion: 1,
    selectionMask,
    pixelState: 'complete',
    integrity: buildImageDocumentSnapshotIntegrity(layers, selectionMask),
  };
}

const projectCodec: ImageLayerPixelCodec = {
  encode: async (value) => btoa(String.fromCharCode(...bytesOf(value))),
  decode: async (payload) => bitmap(Uint8Array.from(atob(payload), (character) => character.charCodeAt(0))),
};

function flipBase64Byte(payload: string, index = 0): string {
  const bytes = Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
  bytes[index] ^= 1;
  return btoa(String.fromCharCode(...bytes));
}

describe('Image named snapshot cryptographic content integrity', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = ByteBitmap as unknown as typeof OffscreenCanvas;
  });

  it('binds SHA-256 proof to canonical bitmap, mask, selection, role, dimensions, and layer identity', () => {
    const original = snapshot();
    expect(original.integrity?.version).toBe(2);
    expect(snapshot().integrity).toEqual(original.integrity);
    expect((original.integrity?.layers[0].bitmap as { contentDigest?: string }).contentDigest)
      .toMatch(/^sha256:[a-f0-9]{64}$/);

    const bitmapMutation = snapshot();
    bytesOf(bitmapMutation.layers[0].bitmap)[0] ^= 1;
    expect(inspectImageDocumentSnapshotIntegrity(bitmapMutation).complete).toBe(false);

    const maskMutation = snapshot();
    bytesOf(maskMutation.layers[0].mask)[1] ^= 1;
    expect(inspectImageDocumentSnapshotIntegrity(maskMutation).complete).toBe(false);

    const selectionMutation = snapshot();
    selectionMutation.selectionMask!.data[0] ^= 1;
    expect(inspectImageDocumentSnapshotIntegrity(selectionMutation).complete).toBe(false);

    const swappedLayers = snapshot();
    [swappedLayers.layers[0].bitmap, swappedLayers.layers[1].bitmap] = [
      swappedLayers.layers[1].bitmap,
      swappedLayers.layers[0].bitmap,
    ];
    expect(inspectImageDocumentSnapshotIntegrity(swappedLayers).complete).toBe(false);

    const roleSwap = snapshot();
    [roleSwap.layers[0].bitmap, roleSwap.layers[0].mask] = [
      roleSwap.layers[0].mask,
      roleSwap.layers[0].bitmap,
    ];
    expect(inspectImageDocumentSnapshotIntegrity(roleSwap).complete).toBe(false);

    const readiness = buildImageSnapshotReadinessDescriptor({
      doc: {
        id: 'readiness-doc',
        title: 'Readiness',
        width: 1,
        height: 1,
        layers: original.layers,
        activeLayerId: 'layer-a',
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
        snapshots: [selectionMutation],
      },
    });
    expect(readiness.namedSnapshots.snapshots[0]).toMatchObject({
      restorable: false,
      blockers: [expect.objectContaining({ code: 'snapshot-selection-unavailable' })],
    });
  });

  it('round-trips exact project bytes and rejects same-length bitmap, mask, and selection mutations', async () => {
    const encoded = await encodeImageDocumentSnapshotProjectPixels(snapshot(), projectCodec);
    const valid = await decodeImageDocumentSnapshotProjectPixels(
      JSON.parse(JSON.stringify(encoded)) as ImageDocumentSnapshot,
      projectCodec,
    );
    expect(bytesOf(valid.layers[0].bitmap)).toEqual(new Uint8ClampedArray([10, 20, 30, 255]));
    expect(bytesOf(valid.layers[0].mask)).toEqual(new Uint8ClampedArray([40, 50, 60, 255]));
    expect(valid.selectionMask?.data).toEqual(new Uint8ClampedArray([211]));

    const mutateAndDecode = (mutate: (value: ImageDocumentSnapshot) => void) => {
      const corrupted = JSON.parse(JSON.stringify(encoded)) as ImageDocumentSnapshot;
      mutate(corrupted);
      return decodeImageDocumentSnapshotProjectPixels(corrupted, projectCodec);
    };

    await expect(mutateAndDecode((value) => {
      value.layers[0].bitmapData = flipBase64Byte(value.layers[0].bitmapData!);
    })).rejects.toThrow(/integrity|digest/i);
    await expect(mutateAndDecode((value) => {
      value.layers[0].maskData = flipBase64Byte(value.layers[0].maskData!);
    })).rejects.toThrow(/integrity|digest/i);
    await expect(mutateAndDecode((value) => {
      value.selectionMaskData = flipBase64Byte(value.selectionMaskData!);
    })).rejects.toThrow(/integrity|digest/i);
    await expect(mutateAndDecode((value) => {
      [value.layers[0].bitmapData, value.layers[1].bitmapData] = [
        value.layers[1].bitmapData,
        value.layers[0].bitmapData,
      ];
    })).rejects.toThrow(/integrity|digest/i);
    await expect(mutateAndDecode((value) => {
      const bitmapProof = value.integrity!.layers[0].bitmap as { contentDigest?: string };
      bitmapProof.contentDigest = `sha256:${'0'.repeat(64)}`;
    })).rejects.toThrow(/integrity|digest/i);
    await expect(mutateAndDecode((value) => {
      delete (value.integrity!.layers[0].bitmap as { contentDigest?: string }).contentDigest;
    })).rejects.toThrow(/integrity|digest/i);
  });

  it('disposes partial project decodes exactly once and preserves prior live state on digest rollback', async () => {
    const encoded = await encodeImageDocumentSnapshotProjectPixels(snapshot(), projectCodec);
    const corrupted = JSON.parse(JSON.stringify(encoded)) as ImageDocumentSnapshot;
    corrupted.selectionMaskData = flipBase64Byte(corrupted.selectionMaskData!);

    const liveBitmap = bitmap([1, 2, 3, 255]);
    const liveDocument = {
      id: 'live-before-digest-failure',
      title: 'Keep live',
      width: 1,
      height: 1,
      layers: [layer('live-layer', [1, 2, 3, 255], [4, 5, 6, 255])],
      activeLayerId: 'live-layer',
      hasSelection: true,
      selectionVersion: 3,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: false,
      snapshots: [],
    };
    liveDocument.layers[0].bitmap = liveBitmap;
    const liveSelection = createMask(1, 1);
    liveSelection.data[0] = 255;
    const historyEntry = { kind: 'selection' as const, docId: liveDocument.id, before: null, after: null };
    useImageEditorStore.setState({
      documents: [liveDocument],
      activeDocId: liveDocument.id,
      undoStacks: { [liveDocument.id]: [historyEntry] },
      redoStacks: {},
    });
    setSelection(liveDocument.id, liveSelection);

    const decoded: Array<LayerBitmap & { widthZeroWrites: number; heightZeroWrites: number }> = [];
    const originalDecode = defaultImageLayerPixelCodec.decode;
    defaultImageLayerPixelCodec.decode = async (payload) => {
      const target = await projectCodec.decode(payload) as LayerBitmap & {
        widthZeroWrites: number;
        heightZeroWrites: number;
      };
      let currentWidth = target.width;
      let currentHeight = target.height;
      target.widthZeroWrites = 0;
      target.heightZeroWrites = 0;
      Object.defineProperty(target, 'width', {
        get: () => currentWidth,
        set: (value: number) => {
          if (value === 0) target.widthZeroWrites += 1;
          currentWidth = value;
        },
        configurable: true,
      });
      Object.defineProperty(target, 'height', {
        get: () => currentHeight,
        set: (value: number) => {
          if (value === 0) target.heightZeroWrites += 1;
          currentHeight = value;
        },
        configurable: true,
      });
      decoded.push(target);
      return target;
    };

    try {
      await expect(useImageEditorStore.getState().restoreProjectSnapshotWithPixels({
        activeDocId: 'incoming-doc',
        documents: [{
          id: 'incoming-doc',
          title: 'Incoming',
          width: 1,
          height: 1,
          layers: [],
          activeLayerId: null,
          hasSelection: false,
          selectionVersion: 0,
          viewport: { zoom: 1, panX: 0, panY: 0 },
          dirty: false,
          snapshots: [corrupted],
        }],
      })).rejects.toThrow(/integrity/i);

      const state = useImageEditorStore.getState();
      expect(state.documents[0]).toBe(liveDocument);
      expect(state.documents[0].layers[0].bitmap).toBe(liveBitmap);
      expect(state.undoStacks[liveDocument.id]).toEqual([historyEntry]);
      expect(getSelection(liveDocument.id)?.data).toEqual(liveSelection.data);
      expect(decoded.length).toBeGreaterThan(0);
      for (const resource of decoded) {
        expect(resource.widthZeroWrites).toBe(1);
        expect(resource.heightZeroWrites).toBe(1);
      }
    } finally {
      defaultImageLayerPixelCodec.decode = originalDecode;
      useImageEditorStore.getState().restoreProjectSnapshot(undefined);
      clearAllSelections();
    }
  });

  it('opens a valid project into a fresh store only after digest verification completes', async () => {
    const encoded = await encodeImageDocumentSnapshotProjectPixels(snapshot(), projectCodec);
    const originalDecode = defaultImageLayerPixelCodec.decode;
    defaultImageLayerPixelCodec.decode = projectCodec.decode;
    useImageEditorStore.getState().restoreProjectSnapshot(undefined);
    try {
      await useImageEditorStore.getState().restoreProjectSnapshotWithPixels({
        activeDocId: 'fresh-doc',
        documents: [{
          id: 'fresh-doc',
          title: 'Fresh',
          width: 1,
          height: 1,
          layers: [],
          activeLayerId: null,
          hasSelection: false,
          selectionVersion: 0,
          viewport: { zoom: 1, panX: 0, panY: 0 },
          dirty: false,
          snapshots: [JSON.parse(JSON.stringify(encoded)) as ImageDocumentSnapshot],
        }],
      });
      const opened = useImageEditorStore.getState().documents[0];
      expect(opened.snapshots?.[0].pixelState).toBe('complete');
      expect(buildImageSnapshotReadinessDescriptor({ doc: opened }).namedSnapshots.snapshots[0].restorable).toBe(true);
      expect(bytesOf(opened.snapshots![0].layers[1].bitmap)).toEqual(new Uint8ClampedArray([70, 80, 90, 255]));
    } finally {
      defaultImageLayerPixelCodec.decode = originalDecode;
      useImageEditorStore.getState().restoreProjectSnapshot(undefined);
    }
  });
});
