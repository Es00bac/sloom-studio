import { beforeEach, describe, expect, it } from 'vitest';
import { readSlimgManifest } from '../../../lib/slimgV2';
import { unzipBoundedZipSync, type BoundedZipLimits } from '../../../lib/boundedZip';
import { packContainer, type ContainerManifest } from '../../../shared/files/SignalLoomContainer';
import {
  clearAllImageSlimgRuntimeStatesForTests,
} from '../ImageSlimgRuntimeState';
import {
  deserializeSlimgAnyVersion,
  serializeSlimgV2,
} from '../ImageSlimgV2Format';
import type { SlimgCodec } from '../ImageSlimgFormat';
import {
  decodeImageLayerProjectPixels,
  encodeImageLayerProjectPixels,
  type ImageLayerPixelCodec,
} from '../ImageLayerProjectPixels';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import {
  convertPixelBuffer,
  createPixelBuffer,
  decodePixelBufferTransport,
  encodePixelBufferTransport,
  pixelBufferEquals,
} from './PixelBuffer';
import { pixelBufferFromBitmap, setPixelBitmapBridge } from './ImageHighBitDocument';

class FakeOffscreenCanvas {
  width: number;
  height: number;
  bytes: Uint8ClampedArray;

  constructor(width: number, height: number, bytes?: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.bytes = bytes ?? new Uint8ClampedArray(width * height * 4);
    if (!bytes) {
      for (let index = 0; index < this.bytes.length; index += 1) {
        this.bytes[index] = (index * 53 + 29) % 256;
      }
    }
  }

  getContext() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- test fake canvas identity
    const canvas = this;
    return {
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        width: w,
        height: h,
        data: new Uint8ClampedArray(canvas.bytes),
      }),
      putImageData: (imageData: { data: Uint8ClampedArray }) => {
        canvas.bytes = new Uint8ClampedArray(imageData.data);
      },
      drawImage: () => {},
    };
  }
}

globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;

setPixelBitmapBridge({
  readBitmapRgba: (bitmap) => {
    const canvas = bitmap as unknown as FakeOffscreenCanvas;
    return new Uint8ClampedArray(canvas.bytes);
  },
  createBitmapFromRgba: (bytes, width, height) => new FakeOffscreenCanvas(width, height, bytes) as unknown as LayerBitmap,
});

const slimgCodec: SlimgCodec = {
  encode: async (bitmap) => new Uint8Array((bitmap as unknown as FakeOffscreenCanvas).bytes),
  decode: async (bytes, width, height) => (
    new FakeOffscreenCanvas(width, height, new Uint8ClampedArray(bytes)) as unknown as LayerBitmap
  ),
};

const projectCodec: ImageLayerPixelCodec = {
  encode: async (bitmap) => {
    const bytes = (bitmap as unknown as FakeOffscreenCanvas).bytes;
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:image/png;base64,${btoa(binary)}`;
  },
  decode: async (url, expected) => {
    const binary = atob(url.slice('data:image/png;base64,'.length));
    const bytes = Uint8ClampedArray.from(binary, (character) => character.charCodeAt(0));
    return new FakeOffscreenCanvas(expected?.width ?? 1, expected?.height ?? 1, bytes) as unknown as LayerBitmap;
  },
};

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
    bitmap: new FakeOffscreenCanvas(6, 5) as unknown as LayerBitmap,
    bitmapVersion: 3,
    mask: null,
  };
}

function makeDocument(layers: ImageLayer[]): ImageDocument {
  return {
    id: 'persist-doc',
    title: 'Persistence Test',
    width: 6,
    height: 5,
    layers,
    activeLayerId: layers[0]!.id,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

beforeEach(() => {
  clearAllImageSlimgRuntimeStatesForTests();
});

async function convertedDocument(depth: 'u16' | 'f32'): Promise<ImageDocument> {
  const layer = makeLayer('raster-1');
  const authority = pixelBufferFromBitmap(layer.bitmap!, depth);
  layer.pixels = authority;
  layer.pixelsVersion = layer.bitmapVersion;
  const doc = makeDocument([layer]);
  doc.metadata = { bitDepth: depth === 'u16' ? 16 : 32 };
  return doc;
}

describe('.slimg v2 high-bit persistence', () => {
  it('saves and reopens a 16-bit document with bit-exact authorities', async () => {
    const doc = await convertedDocument('u16');
    const bytes = await serializeSlimgV2(doc, slimgCodec);
    const reopened = await deserializeSlimgAnyVersion(bytes, slimgCodec);
    expect(reopened.metadata?.bitDepth).toBe(16);
    expect(reopened.metadata?.warnings ?? []).toEqual([]);
    const authority = reopened.layers[0]!.pixels!;
    expect(authority.depth).toBe('u16');
    expect(pixelBufferEquals(authority, doc.layers[0]!.pixels!)).toBe(true);
    expect(reopened.layers[0]!.pixelsVersion).toBe(3);
    // The display proxy survives the round trip byte-exactly too.
    expect(Array.from((reopened.layers[0]!.bitmap as unknown as FakeOffscreenCanvas).bytes))
      .toEqual(Array.from((doc.layers[0]!.bitmap as unknown as FakeOffscreenCanvas).bytes));
  });

  it('saves and reopens a 32-bit document with bit-exact float authorities', async () => {
    const doc = await convertedDocument('f32');
    const bytes = await serializeSlimgV2(doc, slimgCodec);
    const reopened = await deserializeSlimgAnyVersion(bytes, slimgCodec);
    expect(reopened.metadata?.bitDepth).toBe(32);
    expect(pixelBufferEquals(reopened.layers[0]!.pixels!, doc.layers[0]!.pixels!)).toBe(true);
  });

  it('keeps u8↔u16↔f32 authority values exact across save → reopen → convert-back', async () => {
    const doc = await convertedDocument('f32');
    const bytes = await serializeSlimgV2(doc, slimgCodec);
    const reopened = await deserializeSlimgAnyVersion(bytes, slimgCodec);
    const u8 = convertPixelBuffer(reopened.layers[0]!.pixels!, 'u8');
    const originalBytes = (doc.layers[0]!.bitmap as unknown as FakeOffscreenCanvas).bytes;
    expect(Array.from(u8.data as Uint8Array)).toEqual(Array.from(originalBytes));
  });

  it('writes requiredFeatures and the highBit manifest section for high-bit saves', async () => {
    const doc = await convertedDocument('u16');
    const bytes = await serializeSlimgV2(doc, slimgCodec);
    const manifest = await readProbeManifest(bytes);
    expect(manifest.sourceVersion).toBe(2);
    expect(manifest.manifest.document.requiredFeatures).toEqual(['high-bit-pixels']);
    expect(manifest.manifest.document.highBit?.bitDepth).toBe(16);
    expect(manifest.manifest.document.highBit?.layers[0]?.encoding).toBe('srgb-u16-le');
    expect(manifest.manifest.document.highBit?.diverged ?? false).toBe(false);
    const roles = manifest.manifest.assets.map((asset) => asset.role);
    expect(roles).toContain('layer-pixels-u16');
    expect(roles).not.toContain('layer-pixels-f32');
  });

  it('leaves ordinary 8-bit saves without highBit sections or new asset roles', async () => {
    const doc = makeDocument([makeLayer('raster-plain')]);
    const bytes = await serializeSlimgV2(doc, slimgCodec);
    const manifest = await readProbeManifest(bytes);
    expect(manifest.manifest.document.highBit).toBeUndefined();
    expect(manifest.manifest.document.requiredFeatures).toBeUndefined();
    for (const asset of manifest.manifest.assets) {
      expect(['layer-pixels-u16', 'layer-pixels-f32']).not.toContain(asset.role);
    }
    const reopened = await deserializeSlimgAnyVersion(bytes, slimgCodec);
    expect(reopened.layers[0]!.pixels ?? null).toBeNull();
  });

  it('flags divergence and warns on reopen when the proxy moved past the authority', async () => {
    const doc = await convertedDocument('u16');
    // Simulate an ordinary proxy edit after conversion.
    const bumped = structuredClone(doc) as ImageDocument;
    bumped.layers[0]!.bitmapVersion = 9;
    const bytes = await serializeSlimgV2(bumped, slimgCodec);
    const reopened = await deserializeSlimgAnyVersion(bytes, slimgCodec);
    expect(reopened.metadata?.bitDepth).toBe(16);
    expect(reopened.metadata?.warnings ?? []).toContainEqual(expect.stringContaining('predates later 8-bit proxy edits'));
    // The authority itself is still bit-exact.
    expect(pixelBufferEquals(reopened.layers[0]!.pixels!, doc.layers[0]!.pixels!)).toBe(true);
  });
});

const PROBE_ZIP_LIMITS: BoundedZipLimits = {
  archiveLabel: 'probe',
  maxEntries: 64,
  maxEntryUncompressedBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 2048,
};

async function readProbeManifest(bytes: Uint8Array) {
  const entries = unzipBoundedZipSync(bytes, PROBE_ZIP_LIMITS);
  const manifestJson = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as Record<string, unknown>;
  const assets = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    if (path === 'manifest.json') continue;
    if (!path.startsWith('assets/')) continue;
    assets.set(path.slice('assets/'.length), data);
  }
  const result = await readSlimgManifest(manifestJson, assets);
  return result as Omit<typeof result, 'manifest'> & {
    manifest: { document: Record<string, any>; assets: Array<{ role: string }> };
  };
}

function tamperManifest(
  bytes: Uint8Array,
  mutate: (manifest: { document: Record<string, any> }) => void,
): Uint8Array {
  const entries = unzipBoundedZipSync(bytes, PROBE_ZIP_LIMITS);
  const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']!)) as { document: Record<string, any> };
  mutate(manifest);
  const assets = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    if (path === 'manifest.json') continue;
    if (!path.startsWith('assets/')) continue;
    assets.set(path.slice('assets/'.length), data);
  }
  return packContainer(manifest as unknown as ContainerManifest, assets);
}

describe('hostile persistence inputs', () => {
  it('refuses a manifest that requires an unknown feature (old-reader gate)', async () => {
    const doc = await convertedDocument('u16');
    const bytes = await serializeSlimgV2(doc, slimgCodec);
    const tampered = tamperManifest(bytes, (manifest) => {
      manifest.document.requiredFeatures = ['time-travel-pixels'];
    });
    await expect(deserializeSlimgAnyVersion(tampered, slimgCodec))
      .rejects.toThrow(/unsupported feature/);
  });

  it('refuses highBit layers whose asset role does not match the declared depth', async () => {
    const doc = await convertedDocument('u16');
    const bytes = await serializeSlimgV2(doc, slimgCodec);
    const tampered = tamperManifest(bytes, (manifest) => {
      manifest.document.highBit.bitDepth = 32;
    });
    await expect(deserializeSlimgAnyVersion(tampered, slimgCodec))
      .rejects.toThrow(/encoding does not match|malformed/);
  });

  it('refuses truncated high-bit pixel payloads at decode time', async () => {
    const doc = await convertedDocument('u16');
    const layer = doc.layers[0]!;
    const transport = 'sloom-pixels-u16-6x5:' + 'A'.repeat(16);
    layer.pixelsData = transport;
    layer.pixels = null;
    await expect(decodeImageLayerProjectPixels(layer, projectCodec))
      .rejects.toThrow();
  });

  it('refuses transport payloads with unknown headers', () => {
    expect(() => decodePixelBufferTransport('sloom-pixels-u32-6x5:AAAA')).toThrow(/unknown header/);
    expect(() => decodePixelBufferTransport('garbage')).toThrow(/unknown header/);
  });

  it('refuses a highBit section referencing a missing layer', async () => {
    const doc = await convertedDocument('u16');
    const bytes = await serializeSlimgV2(doc, slimgCodec);
    const tampered = tamperManifest(bytes, (manifest) => {
      manifest.document.highBit.layers[0].layerId = 'ghost-layer';
    });
    await expect(deserializeSlimgAnyVersion(tampered, slimgCodec))
      .rejects.toThrow(/references a missing layer/);
  });

  it('refuses a highBit authority whose manifest dimensions differ from its owning raster', async () => {
    const doc = await convertedDocument('u16');
    const bytes = await serializeSlimgV2(doc, slimgCodec);
    const tampered = tamperManifest(bytes, (manifest) => {
      manifest.document.highBit.layers[0].pixels.width = 1;
      manifest.document.highBit.layers[0].pixels.height = 1;
    });
    await expect(deserializeSlimgAnyVersion(tampered, slimgCodec))
      .rejects.toThrow(/owning layer raster/);
  });
});

describe('.sloom project transport for high-bit layers', () => {
  it('encodes the authority into pixelsData and restores it bit-exactly', async () => {
    const doc = await convertedDocument('u16');
    const encoded = await encodeImageLayerProjectPixels(doc.layers[0]!, projectCodec);
    expect(encoded.pixels).toBeUndefined();
    expect(encoded.pixelsData).toContain('sloom-pixels-u16-6x5:');
    const decoded = await decodeImageLayerProjectPixels(encoded, projectCodec, {
      bitmap: { width: 6, height: 5 },
    });
    expect(decoded.pixelsData ?? null).toBeNull();
    expect(pixelBufferEquals(decoded.pixels!, doc.layers[0]!.pixels!)).toBe(true);
  });

  it('keeps layers without authorities free of transport payloads', async () => {
    const plain = makeLayer('plain');
    const encoded = await encodeImageLayerProjectPixels(plain, projectCodec);
    expect('pixelsData' in encoded ? encoded.pixelsData ?? null : null).toBeNull();
    const decoded = await decodeImageLayerProjectPixels(encoded, projectCodec);
    expect(decoded.pixels ?? null).toBeNull();
  });

  it('refuses a .sloom authority whose dimensions differ from its owning bitmap', async () => {
    const layer = makeLayer('hostile-project');
    layer.pixelsData = encodePixelBufferTransport(createPixelBuffer({ width: 1, height: 1, depth: 'u16' }));
    await expect(decodeImageLayerProjectPixels(layer, projectCodec))
      .rejects.toThrow(/owning layer raster/);
  });
});
