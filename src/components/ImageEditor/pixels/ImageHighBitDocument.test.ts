import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import { convertPixelBuffer, pixelBufferEquals } from './PixelBuffer';
import {
  HIGH_BIT_PROXY_EDIT_DISCLOSURE,
  describeWorkingDepth,
  documentWorkingDepth,
  normalizeWorkingDepth,
  planConvertDocumentDepth,
  pixelBufferFromBitmap,
  rgbaProxyBytesFromPixelBuffer,
  setPixelBitmapBridge,
} from './ImageHighBitDocument';

interface FakeBitmap {
  width: number;
  height: number;
  bytes: Uint8ClampedArray;
}

function fakeBitmap(width: number, height: number, seed: number): LayerBitmap {
  const bytes = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (index * 31 + seed * 17) % 256;
  }
  return { width, height, bytes } as unknown as LayerBitmap;
}

function bitmapBytes(bitmap: LayerBitmap): Uint8ClampedArray {
  return (bitmap as unknown as FakeBitmap).bytes;
}

beforeEach(() => {
  setPixelBitmapBridge({
    readBitmapRgba: (bitmap) => new Uint8ClampedArray(bitmapBytes(bitmap)),
    createBitmapFromRgba: (bytes, width, height) => {
      const canvas = fakeBitmap(width, height, 0) as unknown as FakeBitmap;
      canvas.bytes.set(bytes);
      return canvas as unknown as LayerBitmap;
    },
  });
});

afterEach(() => {
  setPixelBitmapBridge(null);
});

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Background',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: fakeBitmap(4, 4, 1),
    bitmapVersion: 3,
    mask: null,
    ...overrides,
  };
}

function makeDocument(layers?: ImageLayer[]): ImageDocument {
  return {
    id: 'doc-1',
    title: 'High Bit Test',
    width: 4,
    height: 4,
    layers: layers ?? [makeLayer()],
    activeLayerId: 'layer-1',
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

describe('working depth descriptors', () => {
  it('normalizes hostile persisted depths to 8', () => {
    expect(normalizeWorkingDepth(undefined)).toBe(8);
    expect(normalizeWorkingDepth(13)).toBe(8);
    expect(normalizeWorkingDepth('sixteen')).toBe(8);
    expect(normalizeWorkingDepth(16)).toBe(16);
    expect(normalizeWorkingDepth(32)).toBe(32);
    expect(documentWorkingDepth({} as ImageDocument)).toBe(8);
  });

  it('describes each depth without overclaiming depth execution', () => {
    expect(describeWorkingDepth(8)).toContain('8-bit');
    expect(describeWorkingDepth(16)).toContain('16-bit');
    expect(describeWorkingDepth(32)).toContain('32-bit float');
    expect(HIGH_BIT_PROXY_EDIT_DISCLOSURE).toContain('8-bit display proxy');
    expect(HIGH_BIT_PROXY_EDIT_DISCLOSURE).toContain('bit-exactly');
  });
});

describe('pixel authority helpers', () => {
  it('reads a bitmap canvas into a u16 authority with exact *257 samples', () => {
    const bitmap = fakeBitmap(2, 1, 2);
    const pixels = pixelBufferFromBitmap(bitmap, 'u16');
    expect(pixels.depth).toBe('u16');
    const source = bitmapBytes(bitmap);
    for (let index = 0; index < 8; index += 1) {
      expect((pixels.data as Uint16Array)[index]).toBe(source[index]! * 257);
    }
  });

  it('regenerates byte-identical 8-bit proxy bytes from u16 and f32 authorities', () => {
    const bitmap = fakeBitmap(4, 2, 3);
    const bytes = bitmapBytes(bitmap);
    for (const depth of ['u16', 'f32'] as const) {
      const authority = pixelBufferFromBitmap(bitmap, depth);
      const proxy = rgbaProxyBytesFromPixelBuffer(authority);
      expect(Array.from(proxy)).toEqual(Array.from(bytes));
    }
  });
});

describe('planConvertDocumentDepth refusals', () => {
  it('refuses unknown depth, no-op conversion, and documents without raster layers', () => {
    const doc = makeDocument();
    expect(planConvertDocumentDepth(doc, 10)).toMatchObject({ ok: false, code: 'unsupported-depth' });
    expect(planConvertDocumentDepth(doc, Number.NaN)).toMatchObject({ ok: false, code: 'unsupported-depth' });
    expect(planConvertDocumentDepth(doc, 8)).toMatchObject({ ok: false, code: 'already-at-depth' });
    const noRaster = makeDocument([
      makeLayer({ id: 'g', type: 'group' }),
      makeLayer({ id: 't', type: 'text', bitmap: null }),
    ]);
    expect(planConvertDocumentDepth(noRaster, 16)).toMatchObject({ ok: false, code: 'no-raster-layers' });
  });

  it('refuses over-budget conversion before any allocation and names the numbers', () => {
    const big = makeDocument([
      makeLayer({ id: 'l1', bitmap: fakeBitmap(4000, 3000, 1) }),
      makeLayer({ id: 'l2', bitmap: fakeBitmap(4000, 3000, 2) }),
      makeLayer({ id: 'l3', bitmap: fakeBitmap(4000, 3000, 3) }),
      makeLayer({ id: 'l4', bitmap: fakeBitmap(4000, 3000, 4) }),
      makeLayer({ id: 'l5', bitmap: fakeBitmap(4000, 3000, 5) }),
      makeLayer({ id: 'l6', bitmap: fakeBitmap(4000, 3000, 6) }),
      makeLayer({ id: 'l7', bitmap: fakeBitmap(4000, 3000, 7) }),
      makeLayer({ id: 'l8', bitmap: fakeBitmap(4000, 3000, 8) }),
    ]);
    const plan = planConvertDocumentDepth(big, 32);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('budget-exceeded');
    expect(plan.message).toContain('refused before allocation');
    expect(plan.message).toContain('1464.8 MiB');
    // The fake bitmaps never allocate real 4000x3000 buffers in tests, but the
    // gate must still be dimension-driven, not canvas-driven.
  });

  it('honors a settable budget for the same document', () => {
    const doc = makeDocument();
    const refused = planConvertDocumentDepth(doc, 16, { budgetBytes: 64 });
    expect(refused.ok).toBe(false);
    const admitted = planConvertDocumentDepth(doc, 16);
    expect(admitted.ok).toBe(true);
  });
});

describe('planned conversions', () => {
  it('8→16→32→16→8 chains keep authority samples bit-exact', () => {
    const doc = makeDocument();
    let pixels = pixelBufferFromBitmap(doc.layers[0]!.bitmap!, 'u16');
    pixels = convertPixelBuffer(pixels, 'f32');
    pixels = convertPixelBuffer(pixels, 'u16');
    const back = convertPixelBuffer(pixels, 'u8');
    const original = bitmapBytes(doc.layers[0]!.bitmap!);
    expect(Array.from(back.data as Uint8Array)).toEqual(Array.from(original));
  });

  it('plans 8→16 with per-layer before/after records bound to the proxy version', () => {
    const doc = makeDocument([
      makeLayer({ id: 'a', bitmapVersion: 5 }),
      makeLayer({ id: 'b', bitmapVersion: 7 }),
      makeLayer({ id: 'group', type: 'group', bitmap: null }),
    ]);
    const plan = planConvertDocumentDepth(doc, 16);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.convertedLayerIds).toEqual(['a', 'b']);
    const op = plan.operation;
    expect(op.kind).toBe('convertDepth');
    expect(op.before.bitDepth).toBe(8);
    expect(op.after.bitDepth).toBe(16);
    expect(Object.keys(op.after.layers).sort()).toEqual(['a', 'b']);
    expect(op.after.layers.a!.pixelsVersion).toBe(5);
    expect(op.after.layers.a!.pixels!.depth).toBe('u16');
    expect(op.before.layers.a!.pixels).toBeNull();
  });

  it('plans 16→8 by releasing the authority (proxy wins) and records the prior authority', () => {
    const layer = makeLayer({ bitmapVersion: 4 });
    const authority = convertPixelBuffer(pixelBufferFromBitmap(layer.bitmap!, 'u16'), 'f32');
    layer.pixels = authority;
    layer.pixelsVersion = 4;
    const doc = makeDocument([layer]);
    (doc.metadata ??= {}).bitDepth = 32;
    const plan = planConvertDocumentDepth(doc, 8);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.operation.after.layers[layer.id]!.pixels).toBeNull();
    expect(plan.operation.after.layers[layer.id]!.pixelsVersion).toBeUndefined();
    expect(plan.operation.before.layers[layer.id]!.pixels!.depth).toBe('f32');
  });

  it('converts from an existing u16 authority to f32 without re-reading the proxy', () => {
    const layer = makeLayer({ bitmapVersion: 2 });
    const u16 = pixelBufferFromBitmap(layer.bitmap!, 'u16');
    layer.pixels = u16;
    layer.pixelsVersion = 2;
    const doc = makeDocument([layer]);
    (doc.metadata ??= {}).bitDepth = 16;
    const plan = planConvertDocumentDepth(doc, 32);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const after = plan.operation.after.layers[layer.id]!.pixels!;
    expect(after.depth).toBe('f32');
    expect(pixelBufferEquals(convertPixelBuffer(after, 'u16'), u16)).toBe(true);
  });
});
