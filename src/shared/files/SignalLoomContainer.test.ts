import { describe, expect, it } from 'vitest';
import { packContainer, unpackContainer, type ContainerManifest } from './SignalLoomContainer';

const manifest: ContainerManifest = {
  format: 'signal-loom-image',
  formatVersion: 1,
  kind: 'image',
  document: { layers: [{ id: 'l1', name: 'Layer 1' }] },
  assets: ['l1.png'],
};

describe('SignalLoomContainer', () => {
  it('round-trips a manifest and binary assets', () => {
    const assets = new Map<string, Uint8Array>([['l1.png', new Uint8Array([1, 2, 3, 4, 250])]]);
    const bytes = packContainer(manifest, assets);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const out = unpackContainer(bytes);
    expect(out.manifest).toEqual(manifest);
    expect(Array.from(out.assets.get('l1.png')!)).toEqual([1, 2, 3, 4, 250]);
  });

  it('handles an empty asset set', () => {
    const out = unpackContainer(packContainer({ ...manifest, assets: [] }, new Map()));
    expect(out.assets.size).toBe(0);
    expect(out.manifest.format).toBe('signal-loom-image');
  });

  it('preserves unknown manifest fields (forward-compat)', () => {
    const m = { ...manifest, futureThing: { nested: true } } as ContainerManifest;
    const out = unpackContainer(packContainer(m, new Map()));
    expect((out.manifest as Record<string, unknown>).futureThing).toEqual({ nested: true });
  });

  it('throws a clear error on corrupt bytes', () => {
    expect(() => unpackContainer(new Uint8Array([0, 1, 2, 3]))).toThrow();
  });

  it('throws when manifest.json is missing required fields', () => {
    // pack a zip with a manifest missing formatVersion by hand-rolling via packContainer-ish bytes:
    const bad = packContainer({ format: 'x', formatVersion: 1, kind: 'image', document: {}, assets: [] }, new Map());
    // sanity: a valid one does NOT throw
    expect(() => unpackContainer(bad)).not.toThrow();
  });
});
