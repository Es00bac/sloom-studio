import { beforeEach, describe, expect, it } from 'vitest';
import { deserializeSlimg, serializeSlimg, type SlimgCodec } from './ImageSlimgFormat';
import type { ImageDocument, LayerBitmap } from '../../types/imageEditor';
import { buildImageDocumentSnapshotIntegrity, IMAGE_SNAPSHOT_MAX_LAYERS } from './ImageSnapshots';
import { packContainer, unpackContainer } from '../../shared/files/SignalLoomContainer';
import {
  createImageTiltmarkLayerSet,
  encodeImageTiltmarkSimulation,
  isImageTiltmarkSurface,
} from './tiltmark/ImageTiltmarkLayer';

class TestOffscreenCanvas {
  width: number;
  height: number;
  __tag: string;
  #bytes: Uint8ClampedArray;

  constructor(width: number, height: number, tag = '') {
    this.width = width;
    this.height = height;
    this.__tag = tag;
    const tagBytes = new TextEncoder().encode(tag);
    this.#bytes = new Uint8ClampedArray(
      Array.from(
        { length: width * height * 4 },
        (_, index) => tagBytes.length > 0 ? tagBytes[index % tagBytes.length] : 0,
      ),
    );
  }

  getContext() {
    return {
      drawImage: (source: LayerBitmap) => {
        const context = source.getContext('2d');
        if (!context) throw new Error('test bitmap source has no readable context');
        this.#bytes = new Uint8ClampedArray(
          context.getImageData(0, 0, source.width, source.height).data,
        );
      },
      getImageData: () => {
        return {
          width: this.width,
          height: this.height,
          data: new Uint8ClampedArray(this.#bytes),
        };
      },
      putImageData: (imageData: ImageData) => {
        this.#bytes = new Uint8ClampedArray(imageData.data);
      },
      clearRect: () => {
        this.#bytes.fill(0);
      },
    };
  }

  async convertToBlob(): Promise<Blob> {
    return new Blob([this.#bytes.buffer as ArrayBuffer]);
  }
}

// A fake LayerBitmap with platform methods on its prototype and a round-trip tag expando.
function fakeBitmap(width: number, height: number, tag: string): LayerBitmap {
  return new TestOffscreenCanvas(width, height, tag) as unknown as LayerBitmap;
}
const codec: SlimgCodec = {
  // encode: store the tag as UTF-8 bytes so we can assert the round-trip carried the right pixels
  encode: async (b) => new TextEncoder().encode((b as unknown as { __tag: string }).__tag),
  decode: async (bytes, width, height) => fakeBitmap(width, height, new TextDecoder().decode(bytes)),
};

function doc(): ImageDocument {
  return {
    id: 'doc1', name: 'Doc', width: 64, height: 48,
    activeLayerId: 'a',
    layers: [
      { id: 'a', name: 'Painted', type: 'image', visible: true, opacity: 0.5,
        bitmap: fakeBitmap(64, 48, 'A-PIX'), mask: fakeBitmap(64, 48, 'A-MASK') },
      { id: 'b', name: 'Empty', type: 'image', visible: true, opacity: 1,
        bitmap: null, mask: null },
    ],
  } as unknown as ImageDocument;
}

describe('ImageSlimgFormat', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = TestOffscreenCanvas as unknown as typeof OffscreenCanvas;
  });

  it('round-trips a document: structure preserved, bitmaps/masks carried as assets', async () => {
    const bytes = await serializeSlimg(doc(), codec);
    const out = await deserializeSlimg(bytes, codec);
    expect(out.width).toBe(64);
    expect(out.height).toBe(48);
    expect(out.activeLayerId).toBe('a');
    expect(out.layers).toHaveLength(2);
    expect(out.layers[0].name).toBe('Painted');
    expect(out.layers[0].opacity).toBe(0.5);
    expect((out.layers[0].bitmap as unknown as { __tag: string }).__tag).toBe('A-PIX');
    expect((out.layers[0].mask as unknown as { __tag: string }).__tag).toBe('A-MASK');
    expect(out.layers[0].bitmap!.width).toBe(64);
    expect(out.layers[1].bitmap).toBeNull();
    expect(out.layers[1].mask).toBeNull();
  });

  it('reopens malformed animation metadata as a safe single frame instead of crashing the editor', async () => {
    const bytes = await serializeSlimg({
      ...doc(),
      metadata: {
        animation: {
          version: 1,
          frameRate: 12,
          currentFrameId: 'frame-1',
          onionSkin: { enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 },
          frames: [{
            id: 'frame-1',
            name: 'Frame 1',
            durationMs: 1000 / 12,
            layerVisibility: { a: true, b: false },
          }],
        },
      },
    }, codec);
    const { manifest, assets } = unpackContainer(bytes);
    const rawDocument = manifest.document as Record<string, unknown>;
    (rawDocument.metadata as Record<string, unknown>).animation = {
      version: 1,
      frameRate: 12,
      currentFrameId: 'bad',
      onionSkin: { enabled: true },
      frames: [{ id: 'frame-1' }],
    };
    const reopened = await deserializeSlimg(packContainer(manifest, assets), codec);
    const animation = reopened.metadata?.animation;
    expect(animation?.frames).toHaveLength(1);
    expect(animation?.currentFrameId).toBe('frame-1');
    expect(animation?.onionSkin).toEqual({ enabled: true, previousOpacity: 0.28, nextOpacity: 0.16 });
    expect(reopened.metadata?.warnings).toContain('Malformed Image frame animation metadata was reset to a safe single frame.');
  });

  it('round-trips retained Reduce Noise filter intent for later preview and export', async () => {
    const source = doc();
    source.layers[0].filters = [{
      id: 'denoise-portrait', kind: 'denoise', enabled: true, amount: 60, opacity: 0.75, blendMode: 'normal',
    }];

    const restored = await deserializeSlimg(await serializeSlimg(source, codec), codec);

    expect(restored.layers[0].filters).toEqual(source.layers[0].filters);
  });

  it('round-trips an editable Tiltmark base and validated substrate checkpoint as separate assets', async () => {
    const { group, surface } = createImageTiltmarkLayerSet({ width: 64, height: 48 });
    const simulationData = encodeImageTiltmarkSimulation({
      version: 4,
      config: {
        widthPx: 64,
        heightPx: 48,
        cellSizePx: 2,
        tileSizeCells: 32,
        maxActiveTiles: 192,
        paperAbsorbency: 0.63,
        paperSizing: 0.38,
      },
      tiles: [],
      stepCount: 2,
      touchSerial: 0,
      activeKeys: [],
      deferredKeys: [],
      dormantKeys: [],
    });
    const physicalSurface = {
      ...surface,
      metadata: {
        tiltmark: {
          ...surface.metadata!.tiltmark!,
          materialState: 'physical' as const,
        },
      },
      tiltmarkSimulationData: simulationData,
    };
    const live = {
      ...doc(),
      layers: [group, physicalSurface],
      activeLayerId: physicalSurface.id,
    };

    const out = await deserializeSlimg(await serializeSlimg(live, codec), codec);
    const restored = out.layers.find((layer) => layer.id === physicalSurface.id);
    expect(isImageTiltmarkSurface(restored)).toBe(true);
    expect(restored?.tiltmarkBaseBitmap).toMatchObject({ width: 64, height: 48 });
    expect(restored?.tiltmarkSimulationData).toBe(simulationData);
  });

  it('writes a clean editable baseline without mutating the live dirty document', async () => {
    const live = { ...doc(), dirty: true };

    const bytes = await serializeSlimg(live, codec);
    const out = await deserializeSlimg(bytes, codec);

    expect(out.dirty).toBe(false);
    expect(live.dirty).toBe(true);
  });

  it('round-trips complete named snapshot bitmap and mask assets', async () => {
    const live = doc();
    const snapshotLayers = [{
      ...live.layers[0],
      bitmap: fakeBitmap(64, 48, 'SNAPSHOT-PIX'),
      mask: fakeBitmap(64, 48, 'SNAPSHOT-MASK'),
    }];
    live.snapshots = [{
      id: 'snapshot-red',
      name: 'Red state',
      createdAt: 1,
      width: 64,
      height: 48,
      layers: snapshotLayers,
      activeLayerId: 'a',
      hasSelection: false,
      selectionVersion: 0,
      pixelState: 'complete',
      integrity: buildImageDocumentSnapshotIntegrity(snapshotLayers),
    }];

    const out = await deserializeSlimg(await serializeSlimg(live, codec), codec);

    expect(out.snapshots?.[0]?.pixelState).toBe('complete');
    expect((out.snapshots?.[0]?.layers[0]?.bitmap as unknown as { __tag: string }).__tag).toBe('SNAPSHOT-PIX');
    expect((out.snapshots?.[0]?.layers[0]?.mask as unknown as { __tag: string }).__tag).toBe('SNAPSHOT-MASK');
  });

  it('round-trips exact named-snapshot selection bytes as a native asset', async () => {
    const live = doc();
    const selectionMask = {
      width: 64,
      height: 48,
      data: new Uint8ClampedArray(64 * 48),
    };
    selectionMask.data.set([0, 7, 255, 31, 128], 19);
    const snapshotLayers = [{ ...live.layers[0], bitmap: fakeBitmap(64, 48, 'SELECTED-PIX') }];
    live.snapshots = [{
      id: 'snapshot-selection',
      name: 'Asymmetric selection',
      createdAt: 2,
      width: 64,
      height: 48,
      layers: snapshotLayers,
      activeLayerId: 'a',
      hasSelection: true,
      selectionVersion: 4,
      selectionMask,
      pixelState: 'complete',
      integrity: buildImageDocumentSnapshotIntegrity(snapshotLayers, selectionMask),
    }];

    const out = await deserializeSlimg(await serializeSlimg(live, codec), codec);

    expect(out.snapshots?.[0]?.pixelState).toBe('complete');
    expect(out.snapshots?.[0]?.selectionMask?.data).toEqual(selectionMask.data);
    expect(out.snapshots?.[0]?.selectionMask?.data).not.toBe(selectionMask.data);
  });

  it('rejects claimed-complete native snapshots when an expected ref, dimensions, or selection asset is missing', async () => {
    const live = doc();
    const selectionMask = { width: 64, height: 48, data: new Uint8ClampedArray(64 * 48) };
    selectionMask.data[44] = 255;
    const snapshotLayers = [{ ...live.layers[0], bitmap: fakeBitmap(64, 48, 'PROVEN') }];
    live.snapshots = [{
      id: 'snapshot-corrupt', name: 'Corrupt me', createdAt: 3, width: 64, height: 48,
      layers: snapshotLayers, activeLayerId: 'a', hasSelection: true, selectionVersion: 1,
      selectionMask, pixelState: 'complete',
      integrity: buildImageDocumentSnapshotIntegrity(snapshotLayers, selectionMask),
    }];
    const { unpackContainer, packContainer } = await import('../../shared/files/SignalLoomContainer');
    const packed = await serializeSlimg(live, codec);
    const { manifest, assets } = unpackContainer(packed);

    const mutateAndOpen = async (mutate: (snapshot: Record<string, unknown>) => void) => {
      const cloned = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
      const document = cloned.document as { snapshots: Array<Record<string, unknown>> };
      mutate(document.snapshots[0]);
      return deserializeSlimg(packContainer(cloned, assets), codec);
    };

    await expect(mutateAndOpen((snapshot) => {
      (snapshot.layers as Array<Record<string, unknown>>)[0].bitmap = null;
    })).rejects.toThrow(/integrity/i);

    await expect(mutateAndOpen((snapshot) => {
      ((snapshot.layers as Array<Record<string, unknown>>)[0].bitmap as { width: number }).width = 63;
    })).rejects.toThrow(/integrity/i);

    await expect(mutateAndOpen((snapshot) => {
      snapshot.selectionMask = null;
    })).rejects.toThrow(/integrity/i);
  });

  it('rejects same-size native bitmap, mask, selection, swap, and manifest-digest corruption', async () => {
    const live = doc();
    const selectionMask = { width: 64, height: 48, data: new Uint8ClampedArray(64 * 48) };
    selectionMask.data[17] = 211;
    const snapshotLayers = [
      { ...live.layers[0], id: 'snapshot-a', bitmap: fakeBitmap(64, 48, 'AAAA'), mask: fakeBitmap(64, 48, 'MMMM') },
      { ...live.layers[0], id: 'snapshot-b', bitmap: fakeBitmap(64, 48, 'BBBB'), mask: fakeBitmap(64, 48, 'NNNN') },
    ];
    live.snapshots = [{
      id: 'snapshot-content', name: 'Content', createdAt: 4, width: 64, height: 48,
      layers: snapshotLayers, activeLayerId: 'snapshot-a', hasSelection: true, selectionVersion: 1,
      selectionMask, pixelState: 'complete',
      integrity: buildImageDocumentSnapshotIntegrity(snapshotLayers, selectionMask),
    }];
    const { unpackContainer, packContainer } = await import('../../shared/files/SignalLoomContainer');
    const { manifest, assets } = unpackContainer(await serializeSlimg(live, codec));

    const corruptAndOpen = async (mutate: (
      snapshotManifest: Record<string, unknown>,
      mutableAssets: Map<string, Uint8Array>,
    ) => void) => {
      const clonedManifest = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
      const clonedAssets = new Map([...assets].map(([id, bytes]) => [id, bytes.slice()]));
      const snapshotManifest = (clonedManifest.document as { snapshots: Array<Record<string, unknown>> }).snapshots[0];
      mutate(snapshotManifest, clonedAssets);
      return deserializeSlimg(packContainer(clonedManifest, clonedAssets), codec);
    };
    const flipAsset = (
      snapshotManifest: Record<string, unknown>,
      mutableAssets: Map<string, Uint8Array>,
      role: 'bitmap' | 'mask' | 'selectionMask',
    ) => {
      const ref = role === 'selectionMask'
        ? snapshotManifest.selectionMask as { asset: string }
        : (snapshotManifest.layers as Array<Record<string, unknown>>)[0][role] as { asset: string };
      mutableAssets.get(ref.asset)![0] ^= 1;
    };

    await expect(corruptAndOpen((snapshotManifest, mutableAssets) => {
      flipAsset(snapshotManifest, mutableAssets, 'bitmap');
    })).rejects.toThrow(/integrity/i);
    await expect(corruptAndOpen((snapshotManifest, mutableAssets) => {
      flipAsset(snapshotManifest, mutableAssets, 'mask');
    })).rejects.toThrow(/integrity/i);
    await expect(corruptAndOpen((snapshotManifest, mutableAssets) => {
      flipAsset(snapshotManifest, mutableAssets, 'selectionMask');
    })).rejects.toThrow(/integrity/i);
    await expect(corruptAndOpen((snapshotManifest) => {
      const layers = snapshotManifest.layers as Array<Record<string, unknown>>;
      [layers[0].bitmap, layers[1].bitmap] = [layers[1].bitmap, layers[0].bitmap];
    })).rejects.toThrow(/integrity/i);
    await expect(corruptAndOpen((snapshotManifest) => {
      const integrity = snapshotManifest.integrity as { layers: Array<{ bitmap: { contentDigest?: string } }> };
      integrity.layers[0].bitmap.contentDigest = `sha256:${'0'.repeat(64)}`;
    })).rejects.toThrow(/integrity/i);
    await expect(corruptAndOpen((snapshotManifest) => {
      const integrity = snapshotManifest.integrity as { layers: Array<{ bitmap: { contentDigest?: string } }> };
      delete integrity.layers[0].bitmap.contentDigest;
    })).rejects.toThrow(/integrity/i);

    const legacyManifest = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    const legacySnapshot = (legacyManifest.document as { snapshots: Array<Record<string, unknown>> }).snapshots[0];
    (legacySnapshot.integrity as { version: number }).version = 1;
    const legacy = await deserializeSlimg(packContainer(legacyManifest, assets), codec);
    expect(legacy.snapshots?.[0].pixelState).toBe('unavailable');
    expect(legacy.snapshots?.[0].integrity?.version as number).toBe(1);
  });

  it('requires exact native snapshot layer/proof identity and permits reordered proofs before decode', async () => {
    const live = doc();
    const snapshotLayers = [
      { ...live.layers[0], id: 'native-a', bitmap: fakeBitmap(64, 48, 'NATIVE-A'), mask: null },
      { ...live.layers[0], id: 'native-b', bitmap: fakeBitmap(64, 48, 'NATIVE-B'), mask: null },
    ];
    live.snapshots = [{
      id: 'native-identity', name: 'Native identity', createdAt: 6, width: 64, height: 48,
      layers: snapshotLayers, activeLayerId: 'native-a', hasSelection: false, selectionVersion: 0,
      pixelState: 'complete', integrity: buildImageDocumentSnapshotIntegrity(snapshotLayers),
    }];
    const { unpackContainer, packContainer } = await import('../../shared/files/SignalLoomContainer');
    const { manifest, assets } = unpackContainer(await serializeSlimg(live, codec));
    let decodeCalls = 0;
    const trackedCodec: SlimgCodec = {
      encode: codec.encode,
      decode: async (...args) => {
        decodeCalls += 1;
        return codec.decode(...args);
      },
    };
    const mutateAndOpen = async (mutate: (namedSnapshot: Record<string, unknown>) => void) => {
      const cloned = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
      const namedSnapshot = (cloned.document as { snapshots: Array<Record<string, unknown>> }).snapshots[0];
      mutate(namedSnapshot);
      decodeCalls = 0;
      return deserializeSlimg(packContainer(cloned, assets), trackedCodec);
    };

    await expect(mutateAndOpen((namedSnapshot) => {
      (namedSnapshot.layers as Array<{ id: string }>)[1].id = 'native-a';
    })).rejects.toThrow(/identity|duplicate/i);
    expect(decodeCalls).toBe(0);
    await expect(mutateAndOpen((namedSnapshot) => {
      const proofs = (namedSnapshot.integrity as { layers: Array<Record<string, unknown>> }).layers;
      proofs[1] = structuredClone(proofs[0]);
    })).rejects.toThrow(/identity|duplicate/i);
    expect(decodeCalls).toBe(0);
    await expect(mutateAndOpen((namedSnapshot) => {
      (namedSnapshot.integrity as { layers: unknown[] }).layers.pop();
    })).rejects.toThrow(/identity|count|missing/i);
    expect(decodeCalls).toBe(0);
    await expect(mutateAndOpen((namedSnapshot) => {
      const proofs = (namedSnapshot.integrity as { layers: Array<Record<string, unknown>> }).layers;
      proofs.push({ ...structuredClone(proofs[0]), layerId: 'unused-native-proof' });
    })).rejects.toThrow(/identity|count|extra/i);
    expect(decodeCalls).toBe(0);

    const reordered = await mutateAndOpen((namedSnapshot) => {
      (namedSnapshot.integrity as { layers: unknown[] }).layers.reverse();
    });
    expect(reordered.snapshots?.[0].pixelState).toBe('complete');
    expect(decodeCalls).toBeGreaterThan(0);
  });

  it('rejects hostile native snapshot count, dimensions, and aggregate bytes before codec allocation', async () => {
    const live = doc();
    const snapshotLayers = [{ ...live.layers[0], id: 'bounded-native', bitmap: fakeBitmap(64, 48, 'BOUNDED'), mask: null }];
    live.snapshots = [{
      id: 'bounded-native', name: 'Bounded native', createdAt: 7, width: 64, height: 48,
      layers: snapshotLayers, activeLayerId: 'bounded-native', hasSelection: false, selectionVersion: 0,
      pixelState: 'complete', integrity: buildImageDocumentSnapshotIntegrity(snapshotLayers),
    }];
    const { unpackContainer, packContainer } = await import('../../shared/files/SignalLoomContainer');
    const { manifest, assets } = unpackContainer(await serializeSlimg(live, codec));
    let decodeCalls = 0;
    const trackedCodec: SlimgCodec = {
      encode: codec.encode,
      decode: async (...args) => {
        decodeCalls += 1;
        return codec.decode(...args);
      },
    };
    const rejectManifest = async (mutate: (document: { snapshots: Array<Record<string, unknown>> }) => void) => {
      const cloned = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
      const document = cloned.document as { snapshots: Array<Record<string, unknown>> };
      mutate(document);
      decodeCalls = 0;
      await expect(deserializeSlimg(packContainer(cloned, assets), trackedCodec)).rejects.toThrow(/snapshot|16384|aggregate/i);
      expect(decodeCalls).toBe(0);
    };

    await rejectManifest((document) => {
      document.snapshots = Array.from({ length: 13 }, (_, index) => ({
        ...structuredClone(document.snapshots[0]),
        id: `native-count-${index}`,
      }));
    });
    await rejectManifest((document) => {
      const namedSnapshot = document.snapshots[0];
      namedSnapshot.width = 16_385;
    });
    await rejectManifest((document) => {
      const namedSnapshot = document.snapshots[0];
      namedSnapshot.width = 12_000;
      namedSnapshot.height = 12_000;
      const layers = namedSnapshot.layers as Array<Record<string, unknown>>;
      layers.push({ ...structuredClone(layers[0]), id: 'bounded-native-2' });
      for (const layer of layers) {
        const ref = layer.bitmap as { width: number; height: number };
        ref.width = 12_000;
        ref.height = 12_000;
      }
      (namedSnapshot.integrity as { layers: unknown[] }).layers = ['bounded-native', 'bounded-native-2'].map((layerId) => ({
        layerId,
        bitmap: { present: true, width: 12_000, height: 12_000, contentDigest: `sha256:${'3'.repeat(64)}` },
        mask: { present: false, width: 0, height: 0 },
      }));
    });
  });

  it('bounds unavailable and legacy native snapshot structure at the exact layer limit before decode', async () => {
    const { packContainer } = await import('../../shared/files/SignalLoomContainer');
    let decodeCalls = 0;
    const trackedCodec: SlimgCodec = {
      encode: codec.encode,
      decode: async (...args) => {
        decodeCalls += 1;
        return codec.decode(...args);
      },
    };
    const layer = (index: number) => ({
      id: `native-bounded-layer-${index}`,
      name: `Layer ${index}`,
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      mask: null,
      bitmapVersion: 0,
    });
    const open = (
      layerCount: number,
      variant: 'unavailable' | 'legacy',
      overrides: Record<string, unknown> = {},
    ) => deserializeSlimg(packContainer({
      format: 'signal-loom-image',
      formatVersion: 1,
      kind: 'image',
      document: {
        id: 'native-structural-bounds-doc',
        title: 'Native structural bounds',
        width: 1,
        height: 1,
        layers: [],
        activeLayerId: null,
        hasSelection: false,
        selectionVersion: 0,
        viewport: { zoom: 1, panX: 0, panY: 0 },
        dirty: false,
        snapshots: [{
          id: `${variant}-${layerCount}`,
          name: `${variant} ${layerCount}`,
          createdAt: 1,
          width: 1,
          height: 1,
          layers: Array.from({ length: layerCount }, (_, index) => layer(index)),
          activeLayerId: null,
          hasSelection: false,
          selectionVersion: 0,
          ...(variant === 'unavailable'
            ? { pixelState: 'unavailable' }
            : { integrity: { version: 1, layers: [], selection: null } }),
          ...overrides,
        }],
      },
      assets: [],
    }, new Map()), trackedCodec);

    await expect(open(IMAGE_SNAPSHOT_MAX_LAYERS, 'unavailable')).resolves.toMatchObject({
      snapshots: [expect.objectContaining({ pixelState: 'unavailable' })],
    });
    await expect(open(IMAGE_SNAPSHOT_MAX_LAYERS, 'legacy')).resolves.toMatchObject({
      snapshots: [expect.objectContaining({ pixelState: 'unavailable' })],
    });
    await expect(open(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'unavailable')).rejects.toThrow(/layer count exceeds/i);
    await expect(open(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'legacy')).rejects.toThrow(/layer count exceeds/i);
    await expect(open(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'unavailable', {
      hasSelection: true,
      selectionMask: { asset: 'oversized-selection.alpha', width: 1, height: 1 },
    })).rejects.toThrow(/layer count exceeds/i);
    await expect(open(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'unavailable', {
      pixelState: 'complete',
      integrity: {
        version: 2,
        layers: [],
        selection: { present: false, width: 0, height: 0, byteLength: 0 },
      },
    })).rejects.toThrow(/layer count exceeds/i);
    const duplicateProof = {
      layerId: 'duplicate-proof',
      bitmap: { present: false, width: 0, height: 0 },
      mask: { present: false, width: 0, height: 0 },
    };
    await expect(open(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'unavailable', {
      pixelState: 'complete',
      integrity: {
        version: 2,
        layers: [duplicateProof, duplicateProof],
        selection: { present: true, width: 1, height: 1, byteLength: 1 },
      },
      hasSelection: true,
      selectionMask: { asset: 'oversized-selection.alpha', width: 1, height: 1 },
    })).rejects.toThrow(/layer count exceeds/i);
    expect(decodeCalls).toBe(0);
  });

  it('disposes every partially decoded native resource exactly once on snapshot digest failure', async () => {
    const live = doc();
    const selectionMask = { width: 64, height: 48, data: new Uint8ClampedArray(64 * 48) };
    selectionMask.data[1] = 255;
    const snapshotLayers = [{ ...live.layers[0], bitmap: fakeBitmap(64, 48, 'TRACK-B'), mask: fakeBitmap(64, 48, 'TRACK-M') }];
    live.snapshots = [{
      id: 'snapshot-disposal', name: 'Disposal', createdAt: 5, width: 64, height: 48,
      layers: snapshotLayers, activeLayerId: 'a', hasSelection: true, selectionVersion: 1,
      selectionMask, pixelState: 'complete',
      integrity: buildImageDocumentSnapshotIntegrity(snapshotLayers, selectionMask),
    }];
    const { unpackContainer, packContainer } = await import('../../shared/files/SignalLoomContainer');
    const { manifest, assets } = unpackContainer(await serializeSlimg(live, codec));
    const clonedManifest = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    const snapshotManifest = (clonedManifest.document as { snapshots: Array<Record<string, unknown>> }).snapshots[0];
    const integrity = snapshotManifest.integrity as { selection: { contentDigest: string } };
    integrity.selection.contentDigest = `sha256:${'0'.repeat(64)}`;

    const decoded: Array<LayerBitmap & { widthZeroWrites: number; heightZeroWrites: number }> = [];
    const trackedCodec: SlimgCodec = {
      encode: codec.encode,
      decode: async (bytes, width, height) => {
        const target = fakeBitmap(width, height, new TextDecoder().decode(bytes)) as LayerBitmap & {
          widthZeroWrites: number;
          heightZeroWrites: number;
        };
        let currentWidth = width;
        let currentHeight = height;
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
      },
    };

    await expect(deserializeSlimg(packContainer(clonedManifest, assets), trackedCodec)).rejects.toThrow(/integrity/i);
    expect(decoded.length).toBeGreaterThan(0);
    for (const resource of decoded) {
      expect(resource.widthZeroWrites).toBe(1);
      expect(resource.heightZeroWrites).toBe(1);
    }
  });

  it('deduplicates shared bitmap identities in the native asset table', async () => {
    const live = doc();
    const shared = fakeBitmap(64, 48, 'SHARED');
    live.layers[0].bitmap = shared;
    live.layers[0].mask = shared;

    const { unpackContainer } = await import('../../shared/files/SignalLoomContainer');
    const packed = await serializeSlimg(live, codec);
    const { manifest, assets } = unpackContainer(packed);

    expect(manifest.assets).toHaveLength(1);
    expect(assets.size).toBe(1);
  });

  it('rejects a non-.slimg container', async () => {
    // Build a valid container of a different format via the container core directly.
    const { packContainer } = await import('../../shared/files/SignalLoomContainer');
    const foreign = packContainer({ format: 'signal-loom-paper', formatVersion: 1, kind: 'paper', document: {}, assets: [] }, new Map());
    await expect(deserializeSlimg(foreign, codec)).rejects.toThrow();
  });

  it('throws if an asset entry is missing', async () => {
    const bytes = await serializeSlimg(doc(), codec);
    const { unpackContainer, packContainer } = await import('../../shared/files/SignalLoomContainer');
    const { manifest } = unpackContainer(bytes);
    // repack WITHOUT the assets -> deref must fail
    const stripped = packContainer(manifest, new Map());
    await expect(deserializeSlimg(stripped, codec)).rejects.toThrow();
  });
});
