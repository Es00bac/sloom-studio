import { beforeEach, describe, expect, it } from 'vitest';
import {
  decodeImageDocumentSnapshotProjectPixels,
  decodeImageLayerProjectPixels,
  encodeImageDocumentSnapshotProjectPixels,
  encodeImageLayerProjectPixels,
  type ImageLayerPixelCodec,
} from './ImageLayerProjectPixels';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { buildImageDocumentSnapshotIntegrity } from './ImageSnapshots';
import { normalizeImageTextStyle } from './ImageTextLayer';

class ProjectPixelTestCanvas {
  width: number;
  height: number;
  __id: string;
  #bytes: Uint8ClampedArray;

  constructor(width: number, height: number, id = '') {
    this.width = width;
    this.height = height;
    this.__id = id;
    this.#bytes = new Uint8ClampedArray(
      Array.from(
        { length: width * height * 4 },
        (_, index) => id.length > 0 ? id.charCodeAt(index % id.length) : 0,
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
      getImageData: () => ({
        width: this.width,
        height: this.height,
        data: new Uint8ClampedArray(this.#bytes),
      }),
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

// Fake bitmaps + a codec that maps bitmap<->string through an explicit CPU test platform.
const fakeBitmap = (id: string): LayerBitmap => (
  new ProjectPixelTestCanvas(1, 1, id) as unknown as LayerBitmap
);
const bitmapId = (bitmap: LayerBitmap | null): string | null =>
  bitmap ? (bitmap as unknown as { __id: string }).__id : null;

const stubCodec: ImageLayerPixelCodec = {
  encode: async (bitmap) => `encoded:${bitmapId(bitmap)}`,
  decode: async (dataUrl) => fakeBitmap(dataUrl.replace('encoded:', '')),
};

function baseLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: 'layer-1', name: 'Layer 1', type: 'raster', visible: true, locked: false,
    opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null,
    ...overrides,
  } as ImageLayer;
}

describe('image layer project pixels', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = ProjectPixelTestCanvas as unknown as typeof OffscreenCanvas;
  });

  it('encodes live bitmap + mask into base64 payloads and nulls the live buffers', async () => {
    const encoded = await encodeImageLayerProjectPixels(
      baseLayer({ bitmap: fakeBitmap('px'), mask: fakeBitmap('mk') }),
      stubCodec,
    );
    expect(encoded.bitmap).toBeNull();
    expect(encoded.mask).toBeNull();
    expect(encoded.bitmapData).toBe('encoded:px');
    expect(encoded.maskData).toBe('encoded:mk');
  });

  it('round-trips pixels through JSON serialization — the active canvas survives save -> open', async () => {
    const encoded = await encodeImageLayerProjectPixels(
      baseLayer({ id: 'merged', bitmap: fakeBitmap('canvas'), mask: fakeBitmap('m') }),
      stubCodec,
    );
    const serialized = JSON.parse(JSON.stringify(encoded)) as ImageLayer; // disk round-trip
    const decoded = await decodeImageLayerProjectPixels(serialized, stubCodec);
    expect(bitmapId(decoded.bitmap)).toBe('canvas');
    expect(bitmapId(decoded.mask)).toBe('m');
    expect(decoded.bitmapData).toBeUndefined();
    expect(decoded.maskData).toBeUndefined();
  });

  it('preserves multi-column vertical text metadata and raster pixels through project save -> open', async () => {
    const original = baseLayer({
      id: 'vertical-japanese',
      name: '縦書き',
      type: 'text',
      bitmap: fakeBitmap('vertical-preview'),
      bitmapVersion: 3,
      text: normalizeImageTextStyle({
        content: '右の列\n左の列',
        fontFamily: 'Noto Sans JP, sans-serif',
        fontSize: 32,
        orientation: 'vertical-rl',
        boxWidth: 160,
        boxHeight: 240,
      }),
      metadata: { editableText: true },
    });

    const encoded = await encodeImageLayerProjectPixels(original, stubCodec);
    const reopened = await decodeImageLayerProjectPixels(
      JSON.parse(JSON.stringify(encoded)) as ImageLayer,
      stubCodec,
    );

    expect(bitmapId(reopened.bitmap)).toBe('vertical-preview');
    expect(reopened.bitmapVersion).toBe(3);
    expect(reopened.text).toMatchObject({
      content: '右の列\n左の列',
      orientation: 'vertical-rl',
      boxWidth: 160,
      boxHeight: 240,
    });
    expect(reopened.metadata?.editableText).toBe(true);
  });

  it('round-trips the separate Tiltmark base without flattening its simulation checkpoint', async () => {
    const encoded = await encodeImageLayerProjectPixels(
      baseLayer({
        bitmap: fakeBitmap('preview'),
        tiltmarkBaseBitmap: fakeBitmap('physical-base'),
        tiltmarkSimulationData: 'data:application/vnd.sloom.tiltmark+json;encoding=gzip;base64,state',
      }),
      stubCodec,
    );
    expect(encoded.tiltmarkBaseBitmap).toBeNull();
    expect(encoded.tiltmarkBaseBitmapData).toBe('encoded:physical-base');
    const decoded = await decodeImageLayerProjectPixels(
      JSON.parse(JSON.stringify(encoded)) as ImageLayer,
      stubCodec,
    );
    expect(bitmapId(decoded.bitmap)).toBe('preview');
    expect(bitmapId(decoded.tiltmarkBaseBitmap ?? null)).toBe('physical-base');
    expect(decoded.tiltmarkSimulationData).toContain('vnd.sloom.tiltmark');
  });

  it('handles an empty layer and throws on a corrupt live-layer payload', async () => {
    const empty = await encodeImageLayerProjectPixels(baseLayer(), stubCodec);
    expect(empty.bitmapData).toBeUndefined();
    expect(empty.maskData).toBeUndefined();

    const throwingCodec: ImageLayerPixelCodec = {
      encode: stubCodec.encode,
      decode: async () => { throw new Error('corrupt'); },
    };
    await expect(decodeImageLayerProjectPixels(
      baseLayer({ bitmapData: 'garbage' }),
      throwingCodec,
    )).rejects.toThrow('corrupt');
  });

  it('round-trips complete named snapshot pixels and rejects corrupt current-format payloads', async () => {
    const snapshotLayers = [baseLayer({ bitmap: fakeBitmap('red'), mask: fakeBitmap('mask') })];
    const snapshot = {
      id: 'snapshot-red',
      name: 'Red',
      createdAt: 1,
      width: 1,
      height: 1,
      layers: snapshotLayers,
      activeLayerId: 'layer-1',
      hasSelection: false,
      selectionVersion: 0,
      pixelState: 'complete' as const,
      integrity: buildImageDocumentSnapshotIntegrity(snapshotLayers),
    };
    const encoded = await encodeImageDocumentSnapshotProjectPixels(snapshot, stubCodec);
    const decoded = await decodeImageDocumentSnapshotProjectPixels(
      JSON.parse(JSON.stringify(encoded)),
      stubCodec,
    );
    expect(decoded.pixelState).toBe('complete');
    expect(bitmapId(decoded.layers[0].bitmap)).toBe('red');
    expect(bitmapId(decoded.layers[0].mask)).toBe('mask');

    await expect(decodeImageDocumentSnapshotProjectPixels(
      { ...encoded, layers: [{ ...encoded.layers[0], bitmapData: 'corrupt' }] },
      {
        encode: stubCodec.encode,
        decode: async (payload) => {
          if (payload === 'corrupt') throw new Error('bad payload');
          return stubCodec.decode(payload);
        },
      },
    )).rejects.toThrow(/integrity/i);
  });

  it('rejects stripped, dimension-mismatched, and selection-incomplete claimed-complete snapshots', async () => {
    const selectionMask = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([211]),
    };
    const layers = [baseLayer({ bitmap: fakeBitmap('pixel') })];
    const encoded = await encodeImageDocumentSnapshotProjectPixels({
      id: 'snapshot-proof',
      name: 'Proof',
      createdAt: 1,
      width: 1,
      height: 1,
      layers,
      activeLayerId: 'layer-1',
      hasSelection: true,
      selectionVersion: 2,
      selectionMask,
      pixelState: 'complete',
      integrity: buildImageDocumentSnapshotIntegrity(layers, selectionMask),
    }, stubCodec);

    await expect(decodeImageDocumentSnapshotProjectPixels({
      ...encoded,
      layers: [{ ...encoded.layers[0], bitmapData: undefined }],
    }, stubCodec)).rejects.toThrow(/integrity/i);

    await expect(decodeImageDocumentSnapshotProjectPixels(encoded, {
      ...stubCodec,
      decode: async () => ({ width: 2, height: 1, __id: 'wrong' } as unknown as LayerBitmap),
    })).rejects.toThrow(/integrity/i);

    await expect(decodeImageDocumentSnapshotProjectPixels({
      ...encoded,
      selectionMaskData: undefined,
    }, stubCodec)).rejects.toThrow(/integrity/i);

    const legacyWithoutProof = await decodeImageDocumentSnapshotProjectPixels({
      ...encoded,
      integrity: undefined,
    }, stubCodec);
    expect(legacyWithoutProof.pixelState).toBe('unavailable');

    const legacyVersionOne = await decodeImageDocumentSnapshotProjectPixels({
      ...encoded,
      integrity: { ...encoded.integrity!, version: 1 } as unknown as typeof encoded.integrity,
    }, stubCodec);
    expect(legacyVersionOne.pixelState).toBe('unavailable');
    expect(legacyVersionOne.integrity?.version as number).toBe(1);
  });
});
