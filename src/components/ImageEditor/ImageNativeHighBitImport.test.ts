import { beforeEach, describe, expect, it } from 'vitest';
import type { LayerBitmap } from '../../types/imageEditor';
import { detectSourceImageFormatPolicy } from './ImageFileFormats';
import { decodeNativeHighBitImport } from './ImageNativeHighBitImport';
import { encodeExr } from './codecs/exr';
import { encodePng16Rgba } from './codecs/png16';
import { encodeHighBitTiff } from './codecs/tiffHighBit';

class FakeContext {
  putImageData() {}
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? new FakeContext() : null;
  }
}

class FakeImageData {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;

  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

describe('ImageNativeHighBitImport', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    globalThis.ImageData = FakeImageData as unknown as typeof ImageData;
  });

  it('mounts PNG16 as u16 authority without browser image decoding', () => {
    const bytes = encodePng16Rgba({ width: 1, height: 1, data: new Uint16Array([100, 200, 300, 65535]) });
    const policy = detectSourceImageFormatPolicy({ fileName: 'plate.png', mimeType: 'image/png', bytes });
    const result = decodeNativeHighBitImport(bytes, policy);
    expect(result).toMatchObject({ width: 1, height: 1, depth: 'u16', pixels: { depth: 'u16', width: 1, height: 1 }, bitmap: { width: 1, height: 1 } });
    expect(Array.from(result!.pixels.data as Uint16Array)).toEqual([100, 200, 300, 65535]);
  });

  it.each([
    ['u16', encodeHighBitTiff({ width: 1, height: 1, depth: 'u16', data: new Uint16Array([100, 200, 300, 65535]) })],
    ['f32', encodeHighBitTiff({ width: 1, height: 1, depth: 'f32', data: new Float32Array([0.1, 0.2, 0.3, 1]) })],
  ] as const)('mounts TIFF %s authority and a derived proxy', (_depth, bytes) => {
    const policy = detectSourceImageFormatPolicy({ fileName: 'plate.tif', mimeType: 'image/tiff', bytes });
    const result = decodeNativeHighBitImport(bytes, policy);
    expect(result?.pixels).toMatchObject({ width: 1, height: 1, depth: _depth });
    expect(result?.bitmap).toMatchObject({ width: 1, height: 1 } satisfies Partial<LayerBitmap>);
  });

  it('mounts bounded OpenEXR as f32 authority', () => {
    const bytes = encodeExr({ width: 1, height: 1, depth: 'f32', data: new Float32Array([0.1, 0.2, 0.3, 1]) });
    const policy = detectSourceImageFormatPolicy({ fileName: 'plate.exr', mimeType: 'image/x-exr', bytes });
    const result = decodeNativeHighBitImport(bytes, policy);
    expect(result?.pixels).toMatchObject({ width: 1, height: 1, depth: 'f32' });
    expect(result?.pixels.data[0]).toBeCloseTo(0.1, 5);
  });

  it('leaves normal 8-bit policy on the browser route', () => {
    const policy = detectSourceImageFormatPolicy({ fileName: 'plate.png', mimeType: 'image/png' });
    expect(decodeNativeHighBitImport(new Uint8Array(), policy)).toBeNull();
  });
});
