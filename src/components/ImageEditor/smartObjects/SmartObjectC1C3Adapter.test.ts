import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, SmartSource } from '../../../types/imageEditor';
import { sha256Hex } from '../../../lib/slimgV2';
import { getSmartObjectPsdRecord, writeSmartObjectPsdInterchange, type SmartObjectPsdReadRecord } from './SmartObjectPsd';
import { attachSmartObjectPsdBridge, describeC3SmartObjectRead, smartSourceFromC3Record } from './SmartObjectC1C3Adapter';

const source: SmartSource = { id: 'source-a', kind: 'embedded', mimeType: 'image/png', byteLength: 4, sha256: 'a'.repeat(64), nativeWidth: 2, nativeHeight: 2, label: 'Plate', version: 1, embeddedBytes: new Uint8Array([1, 2, 3, 4]) };
const layer: ImageLayer = { id: 'layer-a', name: 'Layer', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 3, y: 4, bitmap: null, bitmapVersion: 1, mask: null, smartObject: { sourceId: 'source-a', placement: { width: 20, height: 10 }, renderedVersion: 1 } };
const document: ImageDocument = { id: 'doc', title: 'Doc', width: 32, height: 32, layers: [layer], activeLayerId: layer.id, hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false, metadata: { smartSources: { 'source-a': source } } };

describe('C1/C3 Smart Object adapter', () => {
  it('preserves embedded source identity, bytes, and placement through C3 bridge records', () => {
    const bridged = attachSmartObjectPsdBridge(document, layer);
    const record = getSmartObjectPsdRecord(bridged);
    expect(record?.source).toMatchObject({ id: 'source-a', name: 'Plate', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) });
    expect(record?.placement).toEqual({ width: 20, height: 10, transform: [3, 4, 23, 4, 23, 14, 3, 14] });
    expect(writeSmartObjectPsdInterchange(record!).linkedFile.data).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(bridged.smartObject).toBe(layer.smartObject);
  });

  it('does not claim linked C1 sources are portable embedded PSD source bytes', () => {
    const linked: SmartSource = { ...source, kind: 'linked', embeddedBytes: undefined, linked: { sourceLibraryItemId: 'library-plate' } };
    const linkedDocument: ImageDocument = { ...document, metadata: { smartSources: { [linked.id]: linked } } };
    expect(attachSmartObjectPsdBridge(linkedDocument, layer)).toBe(layer);
  });

  it('retains MH-057 linked-mask references while building the PSD export view', () => {
    const maskLinked = { ...layer, maskLinkSourceLayerId: 'mask-source' };
    const bridged = attachSmartObjectPsdBridge(document, maskLinked);
    expect(bridged.maskLinkSourceLayerId).toBe('mask-source');
    expect(getSmartObjectPsdRecord(bridged)?.source.id).toBe(source.id);
  });

  it('creates a bounded embedded C1 source only from an editable C3 record', () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const record: SmartObjectPsdReadRecord = { layerIndex: [1], sourceId: 'from-c3', source: { id: 'from-c3', name: 'PSD plate', mimeType: 'image/png', bytes }, placement: { width: 12, height: 6, transform: [0, 0, 12, 0, 12, 6, 0, 6] }, filters: [], unsupportedFilters: [], previewOnly: false };
    expect(smartSourceFromC3Record(record)).toMatchObject({ id: 'from-c3', kind: 'embedded', byteLength: 3, sha256: sha256Hex(bytes), embeddedBytes: bytes });
  });

  it('keeps C3 preview-only diagnostics non-editable and refuses empty sources', () => {
    const preview: SmartObjectPsdReadRecord = { layerIndex: [0], sourceId: 'bad', source: null, placement: null, filters: [], unsupportedFilters: [], previewOnly: true, reason: 'Embedded Smart Object bytes are empty.' };
    expect(describeC3SmartObjectRead(preview)).toEqual({ editable: false, reason: 'Embedded Smart Object bytes are empty.' });
    expect(smartSourceFromC3Record(preview)).toBeUndefined();
  });
});
