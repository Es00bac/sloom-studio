import { beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageDocumentSnapshot, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import {
  IMAGE_SNAPSHOT_MAX_METADATA_BYTES,
  assertImageDocumentSnapshotDecodeBounds,
  buildImageDocumentSnapshotIntegrity,
  buildImageSnapshotReadinessDescriptor,
  createImageDocumentSnapshot,
  disposeImageDocumentSnapshotResources,
  inspectImageDocumentSnapshotIntegrity,
  markImageDocumentSnapshotOwned,
  markImageDocumentSnapshotVerifiedOwned,
  restoreImageDocumentSnapshot,
  verifyImageDocumentSnapshotIntegrity,
} from './ImageSnapshots';

class CountingBitmap {
  static imageDataReads = 0;
  static codecCalls = 0;

  width: number;
  height: number;
  #bytes: Uint8ClampedArray;

  constructor(bytes: ArrayLike<number>) {
    this.width = 1;
    this.height = 1;
    this.#bytes = new Uint8ClampedArray(bytes);
  }

  getContext() {
    return {
      getImageData: () => {
        CountingBitmap.imageDataReads += 1;
        return { width: 1, height: 1, data: new Uint8ClampedArray(this.#bytes) };
      },
    };
  }

  async convertToBlob(): Promise<Blob> {
    CountingBitmap.codecCalls += 1;
    return new Blob();
  }
}

class SnapshotCloneCanvas {
  width: number;
  height: number;
  #bytes: Uint8ClampedArray;
  #context: {
    drawImage: (source: LayerBitmap) => void;
    getImageData: () => { width: number; height: number; data: Uint8ClampedArray };
  };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.#bytes = new Uint8ClampedArray(width * height * 4);
    this.#context = {
      drawImage: (source) => {
        if (source instanceof SnapshotCloneCanvas) {
          this.#bytes = source.snapshotBytes();
          return;
        }
        const context = source.getContext('2d');
        if (!context) throw new Error('snapshot clone source has no readable context');
        this.#bytes = new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
      },
      getImageData: () => ({
        width: this.width,
        height: this.height,
        data: new Uint8ClampedArray(this.#bytes),
      }),
    };
  }

  getContext() {
    return this.#context;
  }

  snapshotBytes(): Uint8ClampedArray {
    return new Uint8ClampedArray(this.#bytes);
  }

  async convertToBlob(): Promise<Blob> {
    CountingBitmap.codecCalls += 1;
    return new Blob();
  }
}

function bitmap(bytes: ArrayLike<number>): LayerBitmap {
  return new CountingBitmap(bytes) as unknown as LayerBitmap;
}

function layer(id: string, offset: number): ImageLayer {
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
    bitmap: bitmap([offset, offset + 1, offset + 2, 255]),
    mask: bitmap([offset + 3, offset + 4, offset + 5, 255]),
    bitmapVersion: 0,
  };
}

function snapshot(): ImageDocumentSnapshot {
  const layers = [layer('layer-a', 10), layer('layer-b', 30)];
  const selectionMask = { width: 1, height: 1, data: new Uint8ClampedArray([211]) };
  return {
    id: 'verified-state',
    name: 'Verified state',
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

function documentWith(snapshotValue: ImageDocumentSnapshot): ImageDocument {
  return {
    id: 'verified-doc',
    title: 'Verified doc',
    width: 1,
    height: 1,
    layers: [],
    activeLayerId: null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    snapshots: [snapshotValue],
  };
}

describe('Image snapshot verified-state lifecycle', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = SnapshotCloneCanvas as unknown as typeof OffscreenCanvas;
    CountingBitmap.imageDataReads = 0;
    CountingBitmap.codecCalls = 0;
  });

  it.each(['bitmap', 'mask'] as const)(
    'rejects cached %s resource metadata growth without pixel readback or codec work',
    (role) => {
      const value = snapshot();
      const resource = value.layers[0][role]! as LayerBitmap & { evilMetadata?: string };
      resource.evilMetadata = 'bounded';
      markImageDocumentSnapshotVerifiedOwned(value);
      const retained = value.layers[0][role]! as LayerBitmap & { evilMetadata?: string };
      retained.evilMetadata = 'x'.repeat(16 * 1024 * 1024);

      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['snapshot-bounds-invalid'],
      });
      expect(buildImageSnapshotReadinessDescriptor({ doc: documentWith(value) })
        .namedSnapshots.snapshots[0].restorable).toBe(false);
      expect(verifyImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['snapshot-bounds-invalid'],
      });
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it('rejects an uncached 20 MiB resource expando before explicit verification reads pixels', () => {
    const value = snapshot();
    const resource = value.layers[0].bitmap! as LayerBitmap & { evilMetadata?: string };
    resource.evilMetadata = 'x'.repeat(20 * 1024 * 1024);

    CountingBitmap.imageDataReads = 0;
    CountingBitmap.codecCalls = 0;
    expect(verifyImageDocumentSnapshotIntegrity(value)).toEqual({
      complete: false,
      selectionComplete: false,
      reasons: ['snapshot-bounds-invalid'],
    });
    expect(CountingBitmap.imageDataReads).toBe(0);
    expect(CountingBitmap.codecCalls).toBe(0);
  });

  it('counts runtime resource metadata at the exact configured size boundary', () => {
    const maxMetadataBytes = 4_096;
    const value = snapshot();
    const resource = value.layers[0].bitmap! as LayerBitmap & { legitimateMetadata?: unknown };
    const accepts = (length: number) => {
      resource.legitimateMetadata = { nested: { padding: 'x'.repeat(length) } };
      try {
        assertImageDocumentSnapshotDecodeBounds([value], {
          transport: 'runtime',
          maxSnapshotMetadataBytes: maxMetadataBytes,
          maxAggregateMetadataBytes: maxMetadataBytes,
        });
        return true;
      } catch {
        return false;
      }
    };
    let lower = 0;
    let upper = maxMetadataBytes;
    while (lower < upper) {
      const midpoint = Math.ceil((lower + upper) / 2);
      if (accepts(midpoint)) lower = midpoint;
      else upper = midpoint - 1;
    }

    expect(accepts(lower - 1)).toBe(true);
    expect(accepts(lower)).toBe(true);
    expect(accepts(lower + 1)).toBe(false);
  });

  it('supports bounded pre-existing resource metadata and binds later changes', () => {
    const value = snapshot();
    const metadata: {
      label: string;
      nested: { value: number };
      self?: unknown;
    } = { label: 'camera profile', nested: { value: 7 } };
    metadata.self = metadata;
    const resource = value.layers[0].bitmap! as LayerBitmap & {
      legitimateMetadata?: typeof metadata;
    };
    resource.legitimateMetadata = metadata;
    markImageDocumentSnapshotVerifiedOwned(value);
    const retained = value.layers[0].bitmap! as LayerBitmap & {
      legitimateMetadata: typeof metadata;
    };

    CountingBitmap.imageDataReads = 0;
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    expect(CountingBitmap.imageDataReads).toBe(0);

    retained.legitimateMetadata.nested.value = 8;
    expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
      complete: false,
      selectionComplete: false,
      reasons: ['verified-snapshot-binding-changed'],
    });
    expect(CountingBitmap.imageDataReads).toBe(0);
  });

  it.each(['bitmap', 'mask'] as const)(
    'rejects callable %s metadata before ownership or pixel verification',
    (role) => {
      const value = snapshot();
      const callable = Object.assign(() => 'must never cross snapshot ownership', {
        state: { revision: 1 },
      });
      const resource = value.layers[0][role]! as LayerBitmap & { metadata?: unknown };
      resource.metadata = { callable };

      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      expect(verifyImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['snapshot-bounds-invalid'],
      });
      expect(() => markImageDocumentSnapshotVerifiedOwned(value)).toThrow(/verified state.*snapshot-bounds-invalid/i);
      expect((resource.metadata as { callable: typeof callable }).callable).toBe(callable);
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it('invalidates cached readiness if a retained metadata field is changed to a callable', () => {
    const value = snapshot();
    const source = value.layers[0].bitmap! as LayerBitmap & {
      metadata?: { state: unknown };
    };
    source.metadata = { state: 'detached-data' };
    markImageDocumentSnapshotVerifiedOwned(value);
    const retained = value.layers[0].bitmap! as LayerBitmap & {
      metadata: { state: unknown };
    };
    retained.metadata.state = Object.assign(() => undefined, { state: { revision: 1 } });

    CountingBitmap.imageDataReads = 0;
    CountingBitmap.codecCalls = 0;
    expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
      complete: false,
      selectionComplete: false,
      reasons: ['snapshot-bounds-invalid'],
    });
    expect(CountingBitmap.imageDataReads).toBe(0);
    expect(CountingBitmap.codecCalls).toBe(0);
  });

  it.each(['bitmap', 'mask'] as const)(
    'binds nested binary %s metadata content across same-length mutation without pixel work',
    (role) => {
      const value = snapshot();
      const resource = value.layers[0][role]! as LayerBitmap & {
        metadata?: { data: Uint8Array };
      };
      resource.metadata = { data: new Uint8Array([1, 2, 3, 4]) };
      markImageDocumentSnapshotVerifiedOwned(value);
      const retained = value.layers[0][role]! as LayerBitmap & {
        metadata: { data: Uint8Array };
      };

      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      retained.metadata.data[0] ^= 1;
      expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['verified-snapshot-binding-changed'],
      });
      expect(buildImageSnapshotReadinessDescriptor({ doc: documentWith(value) })
        .namedSnapshots.snapshots[0].restorable).toBe(false);
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it.each(['bitmap', 'mask'] as const)(
    'binds direct root data bytes for cached %s resources across same-length mutation',
    (role) => {
      const value = snapshot();
      const resource = value.layers[0][role]! as LayerBitmap & { data: Uint8Array };
      resource.data = new Uint8Array([17, 18, 19, 20]);
      markImageDocumentSnapshotVerifiedOwned(value);
      const retained = value.layers[0][role]! as LayerBitmap & { data: Uint8Array };

      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      retained.data[2] ^= 1;
      expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['verified-snapshot-binding-changed'],
      });
      expect(buildImageSnapshotReadinessDescriptor({ doc: documentWith(value) })
        .namedSnapshots.snapshots[0].restorable).toBe(false);
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it.each(['bitmap', 'mask'] as const)(
    'binds own enumerable symbol-keyed binary metadata for cached %s resources',
    (role) => {
      const value = snapshot();
      const enumerableKey = Symbol('enumerable-binary');
      const hiddenKey = Symbol('non-enumerable-binary');
      const resource = value.layers[0][role]! as unknown as Record<PropertyKey, unknown>;
      resource[enumerableKey] = new Uint8Array([31, 32, 33, 34]);
      Object.defineProperty(resource, hiddenKey, {
        configurable: true,
        enumerable: false,
        value: new Uint8Array([41, 42, 43, 44]),
      });
      markImageDocumentSnapshotVerifiedOwned(value);
      const retained = value.layers[0][role]! as unknown as Record<PropertyKey, unknown>;

      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      expect(retained[hiddenKey]).toBeUndefined();
      (resource[hiddenKey] as Uint8Array)[0] ^= 1;
      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
      (retained[enumerableKey] as Uint8Array)[0] ^= 1;
      expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['verified-snapshot-binding-changed'],
      });
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it('releases cache-entry-owned fresh-symbol bindings across repeated snapshot disposal', () => {
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const value = snapshot();
      const key = Symbol('repeated-fresh-key');
      const identity = Symbol('repeated-fresh-value');
      const resource = value.layers[0].bitmap! as unknown as Record<PropertyKey, unknown>;
      resource[key] = { identity };
      markImageDocumentSnapshotVerifiedOwned(value);
      const retained = value.layers[0].bitmap! as unknown as Record<PropertyKey, unknown>;

      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
      (retained[key] as { identity: symbol }).identity = Symbol('repeated-fresh-value');
      expect(inspectImageDocumentSnapshotIntegrity(value)).toMatchObject({
        complete: false,
        reasons: ['verified-snapshot-binding-changed'],
      });

      const retainedBitmap = value.layers[0].bitmap!;
      disposeImageDocumentSnapshotResources(value);
      expect(retainedBitmap.width).toBe(0);
      expect(retainedBitmap.height).toBe(0);
      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
    }
  });

  it('preserves exact symbol-key identity and makes post-cache fresh-key replacement impossible', () => {
    const value = snapshot();
    const sourceKey = Symbol('identity-key');
    const source = value.layers[0].bitmap! as unknown as Record<PropertyKey, unknown>;
    source[sourceKey] = { revision: 1 };
    markImageDocumentSnapshotVerifiedOwned(value);
    const retained = value.layers[0].bitmap! as unknown as Record<PropertyKey, unknown>;

    expect(Reflect.ownKeys(retained)).toContain(sourceKey);
    expect(Reflect.deleteProperty(retained, sourceKey)).toBe(true);
    expect(Reflect.defineProperty(retained, Symbol('identity-key'), {
      configurable: true,
      enumerable: true,
      value: { revision: 1 },
      writable: true,
    })).toBe(false);
    expect(inspectImageDocumentSnapshotIntegrity(value)).toMatchObject({
      complete: false,
      reasons: ['verified-snapshot-binding-changed'],
    });
  });

  it.each(['bitmap', 'mask'] as const)(
    'adopts and binds direct %s bytes through the uncached owned-readiness path',
    (role) => {
      const value = markImageDocumentSnapshotOwned(snapshot());
      const source = value.layers[0][role]! as LayerBitmap & { pixels: Uint8Array };
      source.pixels = new Uint8Array([51, 52, 53, 54]);

      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
      const retained = value.layers[0][role]! as LayerBitmap & { pixels: Uint8Array };
      expect(retained).not.toBe(source);
      expect(Array.from(retained.pixels)).toEqual([51, 52, 53, 54]);
      expect(CountingBitmap.imageDataReads).toBe(4);
      expect(CountingBitmap.codecCalls).toBe(0);

      CountingBitmap.imageDataReads = 0;
      retained.pixels[3] ^= 1;
      expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['verified-snapshot-binding-changed'],
      });
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it.each(['bitmap', 'mask'] as const)(
    'fails closed on detached binary metadata for uncached and cached %s resources',
    (role) => {
      const uncached = snapshot();
      const uncachedResource = uncached.layers[0][role]! as LayerBitmap & {
        metadata: { payload: Uint8Array };
      };
      const uncachedBuffer = new ArrayBuffer(4);
      uncachedResource.metadata = { payload: new Uint8Array(uncachedBuffer) };
      structuredClone(uncachedBuffer, { transfer: [uncachedBuffer] });
      CountingBitmap.imageDataReads = 0;
      expect(verifyImageDocumentSnapshotIntegrity(uncached)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['snapshot-bounds-invalid'],
      });
      expect(CountingBitmap.imageDataReads).toBe(0);

      const cached = snapshot();
      const cachedSource = cached.layers[0][role]! as LayerBitmap & { bytes: Uint8Array };
      cachedSource.bytes = new Uint8Array([61, 62, 63, 64]);
      markImageDocumentSnapshotVerifiedOwned(cached);
      const cachedRetained = cached.layers[0][role]! as LayerBitmap & { bytes: Uint8Array };
      structuredClone(cachedRetained.bytes.buffer, { transfer: [cachedRetained.bytes.buffer] });
      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      expect(inspectImageDocumentSnapshotIntegrity(cached).complete).toBe(false);
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it('preserves metadata cycles and aliases in the detached retained graph', () => {
    const value = snapshot();
    const shared = { label: 'shared' };
    const metadata: {
      left: typeof shared;
      right: typeof shared;
      self?: unknown;
    } = { left: shared, right: shared };
    metadata.self = metadata;
    (value.layers[0].bitmap! as LayerBitmap & { metadata: typeof metadata }).metadata = metadata;
    markImageDocumentSnapshotVerifiedOwned(value);

    const retained = (value.layers[0].bitmap! as LayerBitmap & { metadata: typeof metadata }).metadata;
    expect(retained).not.toBe(metadata);
    expect(retained.left).toBe(retained.right);
    expect(retained.self).toBe(retained);
    retained.right.label = 'changed through alias';
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
  });

  it.each(['bitmap', 'mask'] as const)(
    'rejects oversized nested binary %s metadata before uncached pixel verification',
    (role) => {
      const value = snapshot();
      const resource = value.layers[0][role]! as LayerBitmap & {
        metadata?: { data: Uint8Array };
      };
      resource.metadata = { data: new Uint8Array(20 * 1024 * 1024) };

      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      expect(verifyImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['snapshot-bounds-invalid'],
      });
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it.each(['bitmap', 'mask'] as const)(
    'detaches an uncached %s Proxy from hidden target metadata before retaining pixels',
    (role) => {
      const value = markImageDocumentSnapshotOwned(snapshot());
      const target = value.layers[0][role]! as LayerBitmap & { hiddenMetadata?: Uint8Array };
      target.hiddenMetadata = new Uint8Array(20 * 1024 * 1024);
      value.layers[0][role] = new Proxy(target, {
        get: (proxyTarget, key) => {
          const property = Reflect.get(proxyTarget, key, proxyTarget);
          return typeof property === 'function' ? property.bind(proxyTarget) : property;
        },
        ownKeys: (proxyTarget) => Reflect.ownKeys(proxyTarget).filter((key) => key !== 'hiddenMetadata'),
      });

      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(true);
      expect(value.layers[0][role]).not.toBe(target);
      expect((value.layers[0][role] as unknown as Record<string, unknown>).hiddenMetadata).toBeUndefined();
      expect(target.hiddenMetadata?.byteLength).toBe(20 * 1024 * 1024);
      expect(CountingBitmap.imageDataReads).toBe(4);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it.each(['bitmap', 'mask'] as const)(
    'retains a controlled %s clone while the discarded Proxy target remains unchanged',
    (role) => {
      const value = snapshot();
      const target = value.layers[0][role]! as LayerBitmap & { hiddenMetadata?: Uint8Array };
      const proxy = new Proxy(target, {
        get: (proxyTarget, key) => {
          const property = Reflect.get(proxyTarget, key, proxyTarget);
          return typeof property === 'function' ? property.bind(proxyTarget) : property;
        },
        ownKeys: (proxyTarget) => Reflect.ownKeys(proxyTarget).filter((key) => key !== 'hiddenMetadata'),
      });
      value.layers[0][role] = proxy;
      markImageDocumentSnapshotVerifiedOwned(value);
      const retained = value.layers[0][role]!;

      const added = Reflect.defineProperty(target, 'hiddenMetadata', {
        configurable: true,
        enumerable: true,
        value: new Uint8Array(20 * 1024 * 1024),
        writable: true,
      });
      CountingBitmap.imageDataReads = 0;
      CountingBitmap.codecCalls = 0;
      expect(added).toBe(true);
      expect(Object.isExtensible(target)).toBe(true);
      expect(Object.isExtensible(retained)).toBe(false);
      expect(Reflect.defineProperty(retained, 'lateMetadata', {
        configurable: true,
        enumerable: true,
        value: new Uint8Array(20 * 1024 * 1024),
      })).toBe(false);
      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
      expect(buildImageSnapshotReadinessDescriptor({ doc: documentWith(value) })
        .namedSnapshots.snapshots[0].restorable).toBe(true);
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    },
  );

  it('fails closed for revoked Proxies and never invokes source preventExtensions traps', () => {
    const revokedValue = snapshot();
    const revocable = Proxy.revocable(revokedValue.layers[0].bitmap!, {});
    revokedValue.layers[0].bitmap = revocable.proxy;
    revocable.revoke();

    CountingBitmap.imageDataReads = 0;
    expect(() => verifyImageDocumentSnapshotIntegrity(revokedValue)).not.toThrow();
    expect(verifyImageDocumentSnapshotIntegrity(revokedValue).complete).toBe(false);
    expect(CountingBitmap.imageDataReads).toBe(0);

    const trappedValue = markImageDocumentSnapshotOwned(snapshot());
    let preventExtensionsCalls = 0;
    trappedValue.layers[0].mask = new Proxy(trappedValue.layers[0].mask!, {
      get: (target, key) => {
        const property = Reflect.get(target, key, target);
        return typeof property === 'function' ? property.bind(target) : property;
      },
      preventExtensions: () => {
        preventExtensionsCalls += 1;
        throw new Error('resource hardening trap');
      },
    });
    CountingBitmap.imageDataReads = 0;
    let trappedResult: ReturnType<typeof verifyImageDocumentSnapshotIntegrity> | undefined;
    expect(() => {
      trappedResult = verifyImageDocumentSnapshotIntegrity(trappedValue);
    }).not.toThrow();
    expect(trappedResult?.complete).toBe(true);
    expect(preventExtensionsCalls).toBe(0);
    expect(CountingBitmap.imageDataReads).toBe(4);
  });

  it('rolls back every retained resource when descendant hardening fails partway', () => {
    const value = markImageDocumentSnapshotOwned(snapshot());
    const bitmapResource = value.layers[0].bitmap! as LayerBitmap & {
      metadata?: { nested: { label: string } };
    };
    bitmapResource.metadata = { nested: { label: 'must remain extensible' } };
    const originalMask = value.layers[0].mask!;
    let maskOwnKeysCalls = 0;
    value.layers[0].mask = new Proxy(originalMask, {
      get: (target, key) => {
        const property = Reflect.get(target, key, target);
        return typeof property === 'function' ? property.bind(target) : property;
      },
      ownKeys: (target) => {
        maskOwnKeysCalls += 1;
        if (maskOwnKeysCalls > 1) throw new Error('second resource clone failed');
        return Reflect.ownKeys(target);
      },
    });

    CountingBitmap.imageDataReads = 0;
    CountingBitmap.codecCalls = 0;
    expect(verifyImageDocumentSnapshotIntegrity(value)).toEqual({
      complete: false,
      selectionComplete: false,
      reasons: ['snapshot-resource-hardening-failed'],
    });
    expect(value.layers[0].bitmap).toBe(bitmapResource);
    expect(Object.isExtensible(bitmapResource)).toBe(true);
    expect(Object.isExtensible(bitmapResource.metadata!)).toBe(true);
    expect(Object.isExtensible(bitmapResource.metadata!.nested)).toBe(true);
    expect(value.layers[0].mask === originalMask).toBe(false);
    expect(originalMask.width).toBe(1);
    expect(originalMask.height).toBe(1);
    expect(CountingBitmap.imageDataReads).toBe(4);
    expect(CountingBitmap.codecCalls).toBe(0);
  });

  it('fails immediately with an actionable typed error when snapshot cloning has no OffscreenCanvas', () => {
    const sourceDocument: ImageDocument = {
      ...documentWith(snapshot()),
      id: 'unsupported-platform-document',
      layers: [layer('live-layer', 70)],
      activeLayerId: 'live-layer',
      snapshots: [],
    };
    const installedOffscreenCanvas = globalThis.OffscreenCanvas;
    Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
    CountingBitmap.imageDataReads = 0;
    CountingBitmap.codecCalls = 0;

    try {
      let thrown: unknown;
      try {
        createImageDocumentSnapshot(sourceDocument, 'Unsupported platform');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        name: 'UnsupportedLayerBitmapPlatformError',
        code: 'LAYER_BITMAP_UNSUPPORTED_PLATFORM',
      });
      expect(String((thrown as Error | undefined)?.message)).toMatch(/OffscreenCanvas.*required/i);
      expect(sourceDocument.snapshots).toEqual([]);
      expect(sourceDocument.layers[0].bitmap?.width).toBe(1);
      expect(sourceDocument.layers[0].bitmap?.height).toBe(1);
      expect(CountingBitmap.imageDataReads).toBe(0);
      expect(CountingBitmap.codecCalls).toBe(0);
    } finally {
      globalThis.OffscreenCanvas = installedOffscreenCanvas;
    }
  });

  it('keeps ordinary platform-shaped resources usable while controlling their own-field coverage', () => {
    const value = markImageDocumentSnapshotVerifiedOwned(snapshot());

    expect(value.layers[0].bitmap).toBeInstanceOf(SnapshotCloneCanvas);
    expect(value.layers[0].mask).toBeInstanceOf(SnapshotCloneCanvas);
    expect(Object.isExtensible(value.layers[0].bitmap!)).toBe(false);
    expect(Object.isExtensible(value.layers[0].mask!)).toBe(false);
    expect(value.layers[0].bitmap!.width).toBe(1);
    expect(value.layers[0].bitmap!.height).toBe(1);
    expect(typeof value.layers[0].bitmap!.convertToBlob).toBe('function');

    CountingBitmap.imageDataReads = 0;
    CountingBitmap.codecCalls = 0;
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    expect(CountingBitmap.imageDataReads).toBe(0);
    expect(CountingBitmap.codecCalls).toBe(0);
  });

  it('bounds deeply nested resource metadata while preserving cycles and prototype exclusions', () => {
    const accepted = snapshot();
    const acceptedResource = accepted.layers[0].bitmap! as LayerBitmap & { metadata?: unknown };
    const cycle: { next?: unknown } = {};
    cycle.next = cycle;
    acceptedResource.metadata = Object.create({ ignoredPrototype: new Uint8Array(20 * 1024 * 1024) });
    (acceptedResource.metadata as { cycle?: unknown }).cycle = cycle;
    expect(verifyImageDocumentSnapshotIntegrity(accepted).complete).toBe(true);

    const tooDeep = snapshot();
    const tooDeepResource = tooDeep.layers[0].bitmap! as LayerBitmap & { metadata?: unknown };
    let nested: Record<string, unknown> = {};
    tooDeepResource.metadata = nested;
    for (let depth = 0; depth < 257; depth += 1) {
      const child: Record<string, unknown> = {};
      nested.child = child;
      nested = child;
    }
    CountingBitmap.imageDataReads = 0;
    expect(verifyImageDocumentSnapshotIntegrity(tooDeep)).toEqual({
      complete: false,
      selectionComplete: false,
      reasons: ['snapshot-bounds-invalid'],
    });
    expect(CountingBitmap.imageDataReads).toBe(0);
  });

  it('fails closed on retained resource getters and Proxies while excluding non-enumerable and inherited keys', () => {
    const value = snapshot();
    const original = value.layers[0].bitmap!;
    const symbolKey = Symbol('resource-metadata');
    let getterCalls = 0;

    Object.defineProperty(original, 'hiddenMetadata', {
      configurable: true,
      value: 'x'.repeat(20 * 1024 * 1024),
    });
    Object.defineProperty(original, symbolKey, {
      configurable: true,
      enumerable: false,
      value: 'x'.repeat(20 * 1024 * 1024),
    });
    const inheritedMetadataPrototype = Object.create(Object.getPrototypeOf(original)) as {
      inheritedMetadata?: string;
    };
    inheritedMetadataPrototype.inheritedMetadata = 'x'.repeat(20 * 1024 * 1024);
    Object.setPrototypeOf(original, inheritedMetadataPrototype);
    Object.defineProperty(original, 'hostileMetadata', {
      configurable: true,
      enumerable: true,
      value: 'bounded',
      writable: true,
    });
    markImageDocumentSnapshotVerifiedOwned(value);
    const retained = value.layers[0].bitmap!;
    const retainedMutable = retained as unknown as Record<PropertyKey, unknown>;
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);

    Object.defineProperty(retained, 'hostileMetadata', {
      configurable: true,
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('resource getter must not run');
      },
    });
    expect(() => inspectImageDocumentSnapshotIntegrity(value)).not.toThrow();
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
    expect(getterCalls).toBe(0);

    delete retainedMutable.hostileMetadata;
    value.layers[0].bitmap = new Proxy(retained, {
      ownKeys: () => {
        throw new Error('resource Proxy inspection failed');
      },
    });
    CountingBitmap.imageDataReads = 0;
    expect(() => inspectImageDocumentSnapshotIntegrity(value)).not.toThrow();
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
    expect(CountingBitmap.imageDataReads).toBe(0);
  });

  it('adopts sealed Canvas-like resources through detached controlled clones', () => {
    const explicit = markImageDocumentSnapshotOwned(snapshot());
    Object.preventExtensions(explicit.layers[0].bitmap!);

    expect(verifyImageDocumentSnapshotIntegrity(explicit).complete).toBe(true);
    expect(explicit.layers[0].bitmap).not.toBeNull();
    expect(Object.isExtensible(explicit.layers[0].bitmap!)).toBe(false);

    const trustedBuilderPath = snapshot();
    Object.preventExtensions(trustedBuilderPath.layers[0].bitmap!);
    expect(() => markImageDocumentSnapshotVerifiedOwned(trustedBuilderPath)).not.toThrow();
    expect(inspectImageDocumentSnapshotIntegrity(trustedBuilderPath).complete).toBe(true);
  });

  it('rejects oversized enumerable metadata added after the verified cache is populated', () => {
    const value = markImageDocumentSnapshotVerifiedOwned(snapshot());
    (value as ImageDocumentSnapshot & { untrustedMetadata?: string }).untrustedMetadata = 'x'.repeat(
      IMAGE_SNAPSHOT_MAX_METADATA_BYTES,
    );

    expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
      complete: false,
      selectionComplete: false,
      reasons: ['snapshot-bounds-invalid'],
    });
    expect(verifyImageDocumentSnapshotIntegrity(value)).toEqual({
      complete: false,
      selectionComplete: false,
      reasons: ['snapshot-bounds-invalid'],
    });
    expect(buildImageSnapshotReadinessDescriptor({ doc: documentWith(value) })
      .namedSnapshots.snapshots[0].restorable).toBe(false);
  });

  it('rejects duplicate/empty layer ids and duplicate/missing/extra proofs before reading pixels, while accepting reordered proofs', () => {
    const assertIdentityFailureWithoutRead = (mutate: (value: ImageDocumentSnapshot) => void) => {
      const value = snapshot();
      mutate(value);
      CountingBitmap.imageDataReads = 0;
      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
      expect(CountingBitmap.imageDataReads).toBe(0);
    };

    assertIdentityFailureWithoutRead((value) => {
      value.layers[1] = layer('layer-a', 10);
    });
    assertIdentityFailureWithoutRead((value) => {
      value.layers[0].id = '';
    });
    assertIdentityFailureWithoutRead((value) => {
      value.integrity!.layers[1] = { ...value.integrity!.layers[0] };
    });
    assertIdentityFailureWithoutRead((value) => {
      value.integrity!.layers.pop();
    });
    assertIdentityFailureWithoutRead((value) => {
      value.integrity!.layers.push({
        ...value.integrity!.layers[0],
        layerId: 'unused-proof',
      });
    });

    const reordered = snapshot();
    reordered.integrity!.layers.reverse();
    CountingBitmap.imageDataReads = 0;
    expect(inspectImageDocumentSnapshotIntegrity(reordered)).toMatchObject({
      complete: true,
      selectionComplete: true,
    });
    expect(CountingBitmap.imageDataReads).toBe(4);
  });

  it('serves cached rerender/readiness queries in O(structure) without pixel readback or rehashing', () => {
    const value = snapshot();
    let metadataReads = 0;
    Object.defineProperty(value.layers[0], 'metadataProbe', {
      configurable: true,
      enumerable: true,
      get: () => {
        metadataReads += 1;
        return { note: 'structural metadata' };
      },
    });
    markImageDocumentSnapshotVerifiedOwned(value);
    const doc = documentWith(value);
    CountingBitmap.imageDataReads = 0;
    metadataReads = 0;
    const startedAt = performance.now();
    for (let index = 0; index < 100; index += 1) {
      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
      expect(buildImageSnapshotReadinessDescriptor({ doc }).namedSnapshots.snapshots[0].restorable).toBe(true);
    }
    const elapsedMs = performance.now() - startedAt;

    expect(CountingBitmap.imageDataReads).toBe(0);
    expect(metadataReads).toBe(200);
    expect(elapsedMs).toBeGreaterThanOrEqual(0);

    expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    expect(CountingBitmap.imageDataReads).toBe(0);
    expect(metadataReads).toBe(203);
  });

  it('fails closed for oversized string, array, and object replacements before and after readiness', () => {
    const value = markImageDocumentSnapshotVerifiedOwned(snapshot());
    const mutable = value as ImageDocumentSnapshot & { untrustedMetadata?: unknown };
    const assertRejectedWithoutPixelRead = () => {
      CountingBitmap.imageDataReads = 0;
      expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['snapshot-bounds-invalid'],
      });
      expect(buildImageSnapshotReadinessDescriptor({ doc: documentWith(value) })
        .namedSnapshots.snapshots[0].restorable).toBe(false);
      expect(verifyImageDocumentSnapshotIntegrity(value)).toEqual({
        complete: false,
        selectionComplete: false,
        reasons: ['snapshot-bounds-invalid'],
      });
      expect(CountingBitmap.imageDataReads).toBe(0);
    };
    const assertAccepted = () => {
      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
      expect(buildImageSnapshotReadinessDescriptor({ doc: documentWith(value) })
        .namedSnapshots.snapshots[0].restorable).toBe(true);
      expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    };

    mutable.untrustedMetadata = 'x'.repeat(IMAGE_SNAPSHOT_MAX_METADATA_BYTES);
    assertRejectedWithoutPixelRead();
    delete mutable.untrustedMetadata;
    assertAccepted();

    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    mutable.untrustedMetadata = new Array(IMAGE_SNAPSHOT_MAX_METADATA_BYTES);
    assertRejectedWithoutPixelRead();
    delete mutable.untrustedMetadata;
    assertAccepted();

    mutable.untrustedMetadata = {
      nested: { payload: 'x'.repeat(IMAGE_SNAPSHOT_MAX_METADATA_BYTES) },
    };
    assertRejectedWithoutPixelRead();
    delete mutable.untrustedMetadata;
    assertAccepted();
  });

  it('accepts nested metadata just below and at the aggregate limit and rejects the next byte', () => {
    const maxMetadataBytes = 4_096;
    const value = snapshot() as ImageDocumentSnapshot & { nestedMetadata?: unknown };
    const setPadding = (length: number) => {
      value.nestedMetadata = { groups: [{ details: { padding: 'x'.repeat(length) } }] };
    };
    const accepts = (length: number) => {
      setPadding(length);
      try {
        assertImageDocumentSnapshotDecodeBounds([value], {
          transport: 'runtime',
          maxSnapshotMetadataBytes: maxMetadataBytes,
          maxAggregateMetadataBytes: maxMetadataBytes,
        });
        return true;
      } catch {
        return false;
      }
    };
    let lower = 0;
    let upper = maxMetadataBytes;
    while (lower < upper) {
      const midpoint = Math.ceil((lower + upper) / 2);
      if (accepts(midpoint)) lower = midpoint;
      else upper = midpoint - 1;
    }
    const exactPaddingLength = lower;

    expect(accepts(exactPaddingLength - 1)).toBe(true);
    expect(accepts(exactPaddingLength)).toBe(true);
    expect(accepts(exactPaddingLength + 1)).toBe(false);

    setPadding(exactPaddingLength);
    expect(() => assertImageDocumentSnapshotDecodeBounds([value, value], {
      transport: 'runtime',
      maxSnapshotMetadataBytes: maxMetadataBytes,
      maxAggregateMetadataBytes: maxMetadataBytes * 2,
    })).not.toThrow();
    expect(() => assertImageDocumentSnapshotDecodeBounds([value, value], {
      transport: 'runtime',
      maxSnapshotMetadataBytes: maxMetadataBytes,
      maxAggregateMetadataBytes: maxMetadataBytes * 2 - 1,
    })).toThrow(/aggregate metadata exceeds/i);
  });

  it('rechecks post-cache layer, proof, and selection metadata against structural bounds', () => {
    const oversized = 'x'.repeat(IMAGE_SNAPSHOT_MAX_METADATA_BYTES);
    const selectTargets: Array<(value: ImageDocumentSnapshot) => object> = [
      (value) => value.layers[0],
      (value) => value.integrity!.layers[0],
      (value) => value.integrity!.selection,
    ];

    for (const selectTarget of selectTargets) {
      const value = snapshot();
      const target = selectTarget(value);
      markImageDocumentSnapshotVerifiedOwned(value);
      (target as unknown as { optionalMetadata?: unknown }).optionalMetadata = { nested: oversized };

      CountingBitmap.imageDataReads = 0;
      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
      expect(buildImageSnapshotReadinessDescriptor({ doc: documentWith(value) })
        .namedSnapshots.snapshots[0].restorable).toBe(false);
      expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(false);
      expect(CountingBitmap.imageDataReads).toBe(0);

      delete (target as unknown as { optionalMetadata?: unknown }).optionalMetadata;
      expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    }
  });

  it('invalidates an object replacement with identical pixels until explicit verification recaches it', () => {
    const value = markImageDocumentSnapshotVerifiedOwned(snapshot());
    value.layers[0] = { ...value.layers[0] };

    CountingBitmap.imageDataReads = 0;
    expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
      complete: false,
      selectionComplete: false,
      reasons: ['verified-snapshot-binding-changed'],
    });
    expect(CountingBitmap.imageDataReads).toBe(0);

    expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    expect(CountingBitmap.imageDataReads).toBe(0);
    CountingBitmap.imageDataReads = 0;
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    expect(CountingBitmap.imageDataReads).toBe(0);
  });

  it('bounds own enumerable string and symbol metadata and fails closed on hostile getters and proxies', () => {
    const value = markImageDocumentSnapshotVerifiedOwned(snapshot());
    const mutable = value as unknown as Record<PropertyKey, unknown>;
    const oversized = 'x'.repeat(IMAGE_SNAPSHOT_MAX_METADATA_BYTES);
    const symbolKey = Symbol('untrusted');
    const originalPrototype = Object.getPrototypeOf(value);

    Object.defineProperty(value, 'hiddenMetadata', { configurable: true, value: oversized });
    Object.defineProperty(value, symbolKey, {
      configurable: true,
      enumerable: false,
      value: oversized,
    });
    Object.setPrototypeOf(value, { inheritedMetadata: oversized });
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(true);

    Object.defineProperty(value, symbolKey, {
      configurable: true,
      enumerable: true,
      value: oversized,
    });
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
    expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(false);

    delete mutable.hiddenMetadata;
    delete mutable[symbolKey];
    Object.setPrototypeOf(value, originalPrototype);

    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    mutable.runtimeMetadata = cycle;
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(true);

    let getterMode: 'small' | 'oversized' | 'throw' = 'small';
    Object.defineProperty(value, 'runtimeMetadata', {
      configurable: true,
      enumerable: true,
      get: () => {
        if (getterMode === 'throw') throw new Error('hostile getter');
        return getterMode === 'oversized' ? oversized : { note: 'small' };
      },
    });
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(true);
    getterMode = 'oversized';
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
    expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(false);
    getterMode = 'throw';
    expect(() => inspectImageDocumentSnapshotIntegrity(value)).not.toThrow();
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
    expect(() => verifyImageDocumentSnapshotIntegrity(value)).not.toThrow();
    expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(false);

    delete mutable.runtimeMetadata;
    mutable.runtimeMetadata = new Proxy({}, {
      ownKeys: () => {
        throw new Error('hostile proxy');
      },
    });
    expect(() => inspectImageDocumentSnapshotIntegrity(value)).not.toThrow();
    expect(inspectImageDocumentSnapshotIntegrity(value).complete).toBe(false);
    expect(() => verifyImageDocumentSnapshotIntegrity(value)).not.toThrow();
    expect(verifyImageDocumentSnapshotIntegrity(value).complete).toBe(false);
  });

  it('rejects hostile creation dimensions and aggregate pixels before source readback', () => {
    const oversizedDimension = layer('oversized', 1);
    oversizedDimension.bitmap!.width = 16_385;
    CountingBitmap.imageDataReads = 0;
    expect(() => buildImageDocumentSnapshotIntegrity([oversizedDimension])).toThrow(/16384/i);
    expect(CountingBitmap.imageDataReads).toBe(0);

    const aggregateLayers = [layer('large-a', 1), layer('large-b', 2)];
    for (const value of aggregateLayers) {
      value.bitmap!.width = 12_000;
      value.bitmap!.height = 12_000;
      value.mask = null;
    }
    expect(() => buildImageDocumentSnapshotIntegrity(aggregateLayers)).toThrow(/aggregate pixels exceed/i);
    expect(CountingBitmap.imageDataReads).toBe(0);
  });

  it('accounts unavailable structural resources and metadata at exact aggregate boundaries', () => {
    const structuralSnapshot = {
      id: 'structural-only',
      name: 'Structural only',
      createdAt: 1,
      width: 1,
      height: 1,
      layers: [{
        id: 'structural-layer',
        name: 'Structural layer',
        bitmap: { ignoredRuntimeBitmap: true },
        bitmapData: 'ignored-pixel-payload',
        mask: { ignoredRuntimeMask: true },
        maskData: 'ignored-mask-payload',
        metadata: { note: 'bounded metadata' },
      }],
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      selectionMask: { ignoredRuntimeSelection: true },
      selectionMaskData: 'ignored-selection-payload',
      pixelState: 'unavailable',
    };

    expect(() => assertImageDocumentSnapshotDecodeBounds([structuralSnapshot], {
      transport: 'runtime',
      maxAggregateResources: 6,
    })).not.toThrow();
    expect(() => assertImageDocumentSnapshotDecodeBounds([structuralSnapshot], {
      transport: 'runtime',
      maxAggregateResources: 5,
    })).toThrow(/aggregate structural resource count exceeds 5/i);

    let lower = 0;
    let upper = 4_096;
    while (lower < upper) {
      const midpoint = Math.floor((lower + upper) / 2);
      try {
        assertImageDocumentSnapshotDecodeBounds([structuralSnapshot], {
          transport: 'runtime',
          maxSnapshotMetadataBytes: midpoint,
          maxAggregateMetadataBytes: 4_096,
        });
        upper = midpoint;
      } catch {
        lower = midpoint + 1;
      }
    }
    const exactMetadataBytes = lower;
    expect(() => assertImageDocumentSnapshotDecodeBounds([structuralSnapshot], {
      transport: 'runtime',
      maxSnapshotMetadataBytes: exactMetadataBytes,
      maxAggregateMetadataBytes: exactMetadataBytes,
    })).not.toThrow();
    expect(() => assertImageDocumentSnapshotDecodeBounds([structuralSnapshot], {
      transport: 'runtime',
      maxSnapshotMetadataBytes: exactMetadataBytes - 1,
      maxAggregateMetadataBytes: 4_096,
    })).toThrow(/metadata exceeds/i);
    expect(() => assertImageDocumentSnapshotDecodeBounds([structuralSnapshot, structuralSnapshot], {
      transport: 'runtime',
      maxSnapshotMetadataBytes: exactMetadataBytes,
      maxAggregateMetadataBytes: exactMetadataBytes * 2,
    })).not.toThrow();
    expect(() => assertImageDocumentSnapshotDecodeBounds([structuralSnapshot, structuralSnapshot], {
      transport: 'runtime',
      maxSnapshotMetadataBytes: exactMetadataBytes,
      maxAggregateMetadataBytes: exactMetadataBytes * 2 - 1,
    })).toThrow(/aggregate metadata exceeds/i);
  });

  it('blocks oversized unavailable snapshots in readiness and Restore without reading pixels', () => {
    const value = snapshot();
    value.pixelState = 'unavailable';
    value.layers = Array.from({ length: 2_049 }, (_, index) => ({
      ...value.layers[0],
      id: `unavailable-layer-${index}`,
      bitmap: null,
      mask: null,
    }));
    const doc = documentWith(value);
    CountingBitmap.imageDataReads = 0;

    expect(inspectImageDocumentSnapshotIntegrity(value)).toEqual({
      complete: false,
      selectionComplete: false,
      reasons: ['snapshot-bounds-invalid'],
    });
    expect(buildImageSnapshotReadinessDescriptor({ doc }).namedSnapshots.snapshots[0].restorable).toBe(false);
    expect(restoreImageDocumentSnapshot(doc, value.id)).toBe(doc);
    expect(CountingBitmap.imageDataReads).toBe(0);
  });

  it('makes owned payload mutation unavailable and invalidates cache on resource or manifest replacement', () => {
    const value = markImageDocumentSnapshotVerifiedOwned(snapshot());
    const originalSelection = value.selectionMask!.data;
    originalSelection[0] = 0;
    expect(value.selectionMask!.data[0]).toBe(211);
    expect(value.layers[0].bitmap!.getContext('2d')).toBeNull();
    expect(() => {
      value.layers[0].bitmap!.width = 2;
    }).toThrow(/immutable/i);

    CountingBitmap.imageDataReads = 0;
    value.layers[0].bitmap = bitmap([99, 11, 12, 255]);
    expect(inspectImageDocumentSnapshotIntegrity(value)).toMatchObject({
      complete: false,
      reasons: ['verified-snapshot-binding-changed'],
    });
    expect(CountingBitmap.imageDataReads).toBe(0);
    const changedPayloadDoc = documentWith(value);
    expect(restoreImageDocumentSnapshot(changedPayloadDoc, value.id)).toBe(changedPayloadDoc);

    const manifestReplacement = markImageDocumentSnapshotVerifiedOwned(snapshot());
    manifestReplacement.integrity = structuredClone(manifestReplacement.integrity);
    expect(inspectImageDocumentSnapshotIntegrity(manifestReplacement)).toMatchObject({
      complete: false,
      reasons: ['verified-snapshot-binding-changed'],
    });

    const disposed = markImageDocumentSnapshotVerifiedOwned(snapshot());
    expect(inspectImageDocumentSnapshotIntegrity(disposed).complete).toBe(true);
    disposeImageDocumentSnapshotResources(disposed);
    expect(disposed.layers[0].bitmap?.width).toBe(0);
    expect(disposed.selectionMask?.data.byteLength).toBe(0);
    expect(inspectImageDocumentSnapshotIntegrity(disposed).complete).toBe(false);
  });

  it('disposes retained clones and their superseded owned sources exactly at snapshot disposal', () => {
    const value = snapshot();
    const sources = value.layers.flatMap((entry) => [entry.bitmap!, entry.mask!]);
    markImageDocumentSnapshotVerifiedOwned(value);
    const retained = value.layers.flatMap((entry) => [entry.bitmap!, entry.mask!]);

    expect(retained.every((entry) => !sources.includes(entry))).toBe(true);
    expect(sources.every((entry) => entry.width === 1 && entry.height === 1)).toBe(true);
    disposeImageDocumentSnapshotResources(value);
    expect(retained.every((entry) => entry.width === 0 && entry.height === 0)).toBe(true);
    expect(sources.every((entry) => entry.width === 0 && entry.height === 0)).toBe(true);

    disposeImageDocumentSnapshotResources(value);
    expect(retained.every((entry) => entry.width === 0 && entry.height === 0)).toBe(true);
    expect(sources.every((entry) => entry.width === 0 && entry.height === 0)).toBe(true);
  });
});
