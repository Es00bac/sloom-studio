import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, SmartSource } from '../../../types/imageEditor';
import { convertLayerToSmartObject, duplicateSmartObjectInstance, newSmartObjectViaCopy, rasterizeSmartObject, resizeSmartObjectPlacement, saveSmartObjectContents } from './SmartObjectCommands';

function layer(id = 'layer-a'): ImageLayer {
  return { id, name: id, type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null };
}
function source(): SmartSource { return { id: 'source-a', kind: 'embedded', mimeType: 'image/png', byteLength: 4, sha256: 'a'.repeat(64), nativeWidth: 2, nativeHeight: 2, label: 'plate', version: 1, bytesAssetId: 'smart-source-a' }; }
function document(): ImageDocument { return { id: 'doc-a', title: 'Doc', width: 2, height: 2, layers: [layer()], activeLayerId: 'layer-a', hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false }; }

describe('SmartObjectCommands', () => {
  it('shares a source when duplicating, but detaches New via Copy', () => {
    const converted = convertLayerToSmartObject(document(), 'layer-a', source());
    expect(converted.ok).toBe(true); if (!converted.ok) return;
    const duplicated = duplicateSmartObjectInstance(converted.document, 'layer-a', 'layer-b');
    expect(duplicated.ok).toBe(true); if (!duplicated.ok) return;
    expect(duplicated.document.layers.map((item) => item.smartObject?.sourceId)).toEqual(['source-a', 'source-a']);
    const detached = newSmartObjectViaCopy(duplicated.document, 'layer-b', 'source-b', 'layer-c');
    expect(detached.ok).toBe(true); if (!detached.ok) return;
    expect(detached.document.layers.find((item) => item.id === 'layer-c')?.smartObject?.sourceId).toBe('source-b');
    expect(detached.document.metadata?.smartSources?.['source-a']).toBeDefined();
  });

  it('invalidates every instance after Save & Return and rasterizes only by an explicit command', () => {
    const converted = convertLayerToSmartObject(document(), 'layer-a', source()); if (!converted.ok) throw converted.reason;
    const duplicate = duplicateSmartObjectInstance(converted.document, 'layer-a', 'layer-b'); if (!duplicate.ok) throw duplicate.reason;
    const saved = saveSmartObjectContents(duplicate.document, 'source-a', { byteLength: 5, sha256: 'b'.repeat(64), mimeType: 'image/png', nativeWidth: 2, nativeHeight: 2, bytesAssetId: 'smart-source-a-v2' });
    expect(saved.ok).toBe(true); if (!saved.ok) return;
    expect(saved.document.layers.every((item) => item.smartObject?.renderedVersion === 0)).toBe(true);
    const raster = rasterizeSmartObject(saved.document, 'layer-a');
    expect(raster.ok).toBe(true); if (!raster.ok) return;
    expect(raster.document.layers[0].smartObject).toBeUndefined();
    expect(raster.document.layers[1].smartObject?.sourceId).toBe('source-a');
  });

  it('commits transform scale into placement without baking rotation or skew', () => {
    const converted = convertLayerToSmartObject({ ...document(), layers: [{ ...layer(), rotationDeg: 35, skewXDeg: 6 }] }, 'layer-a', source()); if (!converted.ok) throw converted.reason;
    const resized = resizeSmartObjectPlacement(converted.document, 'layer-a', 20.9, 30.1);
    expect(resized.ok).toBe(true); if (!resized.ok) return;
    expect(resized.document.layers[0]).toMatchObject({ rotationDeg: 35, skewXDeg: 6, smartObject: { placement: { width: 20, height: 30 }, renderedVersion: 0 } });
  });
});
