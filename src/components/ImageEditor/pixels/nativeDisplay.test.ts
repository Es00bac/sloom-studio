import { describe, expect, it } from 'vitest';
import type { ImageDocument } from '../../../types/imageEditor';
import { createPixelBuffer } from './PixelBuffer';
import { checkNativeWorkerMemoryAdmission, prepareNativeCompositeLayers } from './nativeDisplay';

function docWithPixels(): ImageDocument {
  const pixels = createPixelBuffer({ width: 1, height: 1, depth: 'u16' });
  (pixels.data as Uint16Array).set([65535, 0, 0, 65535]);
  return {
    id: 'native-display-test', width: 1, height: 1, layers: [{
      id: 'layer', name: 'Layer', type: 'image', visible: true, locked: false, opacity: 1,
      blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 1, pixels, pixelsVersion: 1,
      mask: null,
    }], activeLayerId: 'layer', metadata: { bitDepth: 16 },
  } as ImageDocument;
}

describe('native high-bit display adapter', () => {
  it('prepares authority layers without reading their derived proxies', () => {
    const doc = docWithPixels();
    const prepared = prepareNativeCompositeLayers(doc);
    expect(prepared).toHaveLength(1);
    expect(prepared[0]!.pixels).toBe(doc.layers[0]!.pixels);
    expect(prepared[0]!.hasTransform).toBe(false);
  });

  it('marks geometry, effects, and adjustments for refusal before native render', () => {
    const doc = docWithPixels();
    doc.layers[0]!.x = 2;
    doc.layers[0]!.effects = [{ kind: 'drop-shadow', enabled: true } as never];
    doc.layers[0]!.filters = [{ kind: 'blur', enabled: true } as never];
    doc.layers[0]!.adjustment = { kind: 'exposure', exposure: 1 } as never;
    const prepared = prepareNativeCompositeLayers(doc);
    expect(prepared[0]).toMatchObject({ hasTransform: true, hasEffects: true, hasAdjustment: true });
  });

  it('refuses non-raster layers before any proxy fallback', () => {
    const doc = docWithPixels();
    doc.layers[0]!.type = 'group';
    expect(() => prepareNativeCompositeLayers(doc)).toThrow(/no native compositor payload/);
  });

  it('rejects worker cloning/output cost that exceeds the high-bit admission budget', () => {
    const doc = {
      width: 4000,
      height: 3000,
      metadata: { bitDepth: 32 },
      layers: Array.from({ length: 6 }, (_, index) => ({
        id: `layer-${index}`,
        pixels: { width: 4000, height: 3000, depth: 'f32', data: { byteLength: 4000 * 3000 * 4 * 4 } },
        mask: null,
      })),
    } as unknown as ImageDocument;
    const admission = checkNativeWorkerMemoryAdmission(doc);
    expect(admission.admitted).toBe(false);
    expect(admission.estimatedBytes).toBeGreaterThan(admission.budgetBytes);
    expect(admission.reason).toContain('before cloning');
  });

  it('fails closed for hostile dimensions before any worker-size arithmetic', () => {
    const doc = {
      width: Number.NEGATIVE_INFINITY,
      height: Number.NEGATIVE_INFINITY,
      metadata: { bitDepth: 32 },
      layers: [],
    } as unknown as ImageDocument;
    const admission = checkNativeWorkerMemoryAdmission(doc);
    expect(admission.admitted).toBe(false);
    expect(admission.estimatedBytes).toBe(Number.POSITIVE_INFINITY);
    expect(admission.reason).toContain('not finite positive safe sizes');

    const missingLayers = { width: 1, height: 1, metadata: { bitDepth: 32 } } as unknown as ImageDocument;
    expect(checkNativeWorkerMemoryAdmission(missingLayers).admitted).toBe(false);
  });
});
