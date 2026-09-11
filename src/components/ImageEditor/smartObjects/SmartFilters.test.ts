import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, ImageLayerFilter, LayerBitmap, SmartSource } from '../../../types/imageEditor';
import { applyLayerFiltersToImageData } from '../ImageLayerFilters';
import { rerasterizeSmartObjectInstances } from './SmartObjectRender';
import {
  SMART_OBJECT_FILTER_LIMITS,
  readSmartObjectFilterStack,
  replaceSmartObjectFilterStack,
} from './SmartFilters';

function smartLayer(id: string, sourceId = 'shared', patch: Partial<ImageLayer> = {}): ImageLayer {
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
    bitmapVersion: 1,
    mask: null,
    smartObject: { sourceId, placement: { width: 8, height: 8 }, renderedVersion: 1 },
    ...patch,
  };
}

function filter(patch: Partial<ImageLayerFilter> = {}): ImageLayerFilter {
  return {
    id: 'blur',
    kind: 'blur',
    enabled: true,
    amount: 8,
    opacity: 1,
    blendMode: 'normal',
    ...patch,
  };
}

describe('C2 Smart Object filter stacks', () => {
  it('synchronizes one retained normalized stack across every instance of its source', () => {
    const layers = [
      smartLayer('one', 'shared', { filters: [filter({ mask: { width: 2, height: 1, alpha: [300, -1] } })] }),
      smartLayer('two', 'shared', { filters: [filter({ id: 'old', kind: 'invert', amount: 100 })] }),
      smartLayer('detached', 'copy', { filters: [filter({ id: 'copy' })] }),
    ];

    const current = readSmartObjectFilterStack(layers, 'shared', 'one');
    expect(current).toMatchObject({ ok: true });
    if (!current.ok) return;
    expect(current.value.divergentInstanceIds).toEqual(['two']);

    const applied = replaceSmartObjectFilterStack(layers, 'shared', current.value.filters);
    expect(applied).toMatchObject({ ok: true, changed: true, instanceIds: ['one', 'two'] });
    if (!applied.ok) return;
    expect(applied.layers[0]?.filters).toEqual([{ ...filter(), mask: { width: 2, height: 1, alpha: [255, 0] } }]);
    expect(applied.layers[1]?.filters).toEqual(applied.layers[0]?.filters);
    expect(applied.layers[1]?.filters).not.toBe(applied.layers[0]?.filters);
    expect(applied.layers[2]).toBe(layers[2]);
  });

  it('fails closed for a locked shared instance without changing either source member', () => {
    const layers = [smartLayer('one'), smartLayer('two', 'shared', { locked: true })];
    const result = replaceSmartObjectFilterStack(layers, 'shared', [filter()]);
    expect(result).toMatchObject({ ok: false, blocker: { code: 'locked-source-instance' } });
    expect(layers[0]?.filters).toBeUndefined();
    expect(layers[1]?.filters).toBeUndefined();
  });

  it('refuses malformed and resource-hostile records before any source instance changes', () => {
    const layers = [smartLayer('one'), smartLayer('two')];
    const malformedMask = replaceSmartObjectFilterStack(layers, 'shared', [filter({ mask: { width: 4, height: 4, alpha: [255] } })]);
    expect(malformedMask).toMatchObject({ ok: false, blocker: { code: 'invalid-filter-mask' } });

    const tooMany = replaceSmartObjectFilterStack(layers, 'shared', Array.from(
      { length: SMART_OBJECT_FILTER_LIMITS.maxFilters + 1 },
      (_, index) => filter({ id: `filter-${index}` }),
    ));
    expect(tooMany).toMatchObject({ ok: false, blocker: { code: 'too-many-filters' } });
    expect(layers.every((layer) => layer.filters === undefined)).toBe(true);
  });

  it('keeps the same source-owned stack on the ordinary preview/export filter compositor path', () => {
    const layers = [smartLayer('one'), smartLayer('two')];
    const update = replaceSmartObjectFilterStack(layers, 'shared', [
      filter({ id: 'gray', kind: 'grayscale', amount: 100 }),
      filter({ id: 'blur', kind: 'blur', amount: 1, opacity: 0.5 }),
    ]);
    expect(update.ok).toBe(true);
    if (!update.ok) return;
    const source = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([240, 40, 10, 255, 10, 80, 210, 255]),
    } as ImageData;
    const first = applyLayerFiltersToImageData(source, update.layers[0]?.filters);
    const second = applyLayerFiltersToImageData(source, update.layers[1]?.filters);
    expect([...first.data]).toEqual([...second.data]);
    expect([...first.data]).not.toEqual([...source.data]);
  });

  it('retains the shared stack after C1 re-rasterizes a changed source', () => {
    const updated = replaceSmartObjectFilterStack([smartLayer('one'), smartLayer('two')], 'shared', [filter()]);
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const source: SmartSource = {
      id: 'shared', kind: 'embedded', mimeType: 'image/png', byteLength: 4,
      sha256: 'a'.repeat(64), nativeWidth: 8, nativeHeight: 8, label: 'Plate', version: 2,
      embeddedBytes: new Uint8Array([1, 2, 3, 4]),
    };
    const doc: ImageDocument = {
      id: 'doc', title: 'doc', width: 8, height: 8, layers: updated.layers, activeLayerId: 'one',
      hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
      metadata: { smartSources: { shared: source } },
    };
    const rerendered = rerasterizeSmartObjectInstances(
      doc,
      'shared',
      {} as LayerBitmap,
      () => ({} as LayerBitmap),
    );
    expect(rerendered.layers.map((layer) => layer.filters)).toEqual([
      [expect.objectContaining({ id: 'blur', kind: 'blur' })],
      [expect.objectContaining({ id: 'blur', kind: 'blur' })],
    ]);
  });
});
