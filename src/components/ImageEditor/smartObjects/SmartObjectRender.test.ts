import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap, SmartSource } from '../../../types/imageEditor';
import { rerasterizeSmartObjectInstances } from './SmartObjectRender';

function layer(id: string, sourceId: string, placement: { width: number; height: number }): ImageLayer {
  return { id, name: id, type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 3, mask: null, smartObject: { sourceId, placement, renderedVersion: 1 } };
}

describe('rerasterizeSmartObjectInstances', () => {
  it('rebuilds every shared instance at its own placement while leaving independent copies intact', () => {
    const source: SmartSource = { id: 'shared', kind: 'embedded', mimeType: 'image/png', byteLength: 4, sha256: 'a'.repeat(64), nativeWidth: 2, nativeHeight: 2, label: 'plate', version: 2, embeddedBytes: new Uint8Array([1, 2, 3, 4]) };
    const doc: ImageDocument = { id: 'doc', title: 'doc', width: 20, height: 20, layers: [layer('a', 'shared', { width: 10, height: 5 }), layer('b', 'shared', { width: 20, height: 15 }), layer('copy', 'independent', { width: 7, height: 7 })], activeLayerId: 'a', hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false, metadata: { smartSources: { shared: source } } };
    const calls: Array<{ width: number; height: number }> = [];
    const result = rerasterizeSmartObjectInstances(doc, 'shared', {} as LayerBitmap, (_source, _native, placement) => {
      calls.push(placement); return { width: placement.width, height: placement.height } as LayerBitmap;
    });
    expect(calls).toEqual([{ width: 10, height: 5 }, { width: 20, height: 15 }]);
    expect(result.layers.slice(0, 2).map((item) => [item.bitmap?.width, item.bitmap?.height, item.smartObject?.renderedVersion])).toEqual([[10, 5, 2], [20, 15, 2]]);
    expect(result.layers[2]).toBe(doc.layers[2]);
  });
});
