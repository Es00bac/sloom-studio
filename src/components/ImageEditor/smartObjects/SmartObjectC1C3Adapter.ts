import type { ImageDocument, ImageLayer, SmartSource } from '../../../types/imageEditor';
import { sha256Hex } from '../../../lib/slimgV2';
import type { SmartObjectPsdReadRecord, SmartObjectPsdRecord } from './SmartObjectPsd';

/** Converts one C1 embedded instance into C3's intentionally temporary PSD bridge without
 * changing either ownership model. C3 normalizes the PSD linked-file id, while C1 retains its
 * own source id in the project; linked sources and absent bytes stay outside PSD write scope. */
export function toSmartObjectPsdRecord(document: ImageDocument, layer: ImageLayer): SmartObjectPsdRecord | undefined {
  const instance = layer.smartObject;
  if (!instance) return undefined;
  const source = instance ? document.metadata?.smartSources?.[instance.sourceId] : undefined;
  if (!source || source.kind !== 'embedded' || !source.embeddedBytes || source.embeddedBytes.byteLength === 0) return undefined;
  return {
    source: { id: source.id, name: source.label, mimeType: source.mimeType, bytes: new Uint8Array(source.embeddedBytes) },
    placement: { width: instance.placement.width, height: instance.placement.height, transform: placementTransform(layer, instance.placement) },
  };
}

export function attachSmartObjectPsdBridge(document: ImageDocument, layer: ImageLayer): ImageLayer {
  const smartObjectPsd = toSmartObjectPsdRecord(document, layer);
  return smartObjectPsd ? { ...layer, smartObjectPsd } : layer;
}

/** Produces a PSD-export view; C1 source/instance state itself is not mutated. */
export function withSmartObjectPsdBridges(document: ImageDocument): ImageDocument {
  return { ...document, layers: document.layers.map((layer) => attachSmartObjectPsdBridge(document, layer)) };
}

/** C3 preview-only records deliberately do not become editable C1 sources. */
export function describeC3SmartObjectRead(record: SmartObjectPsdReadRecord): { editable: boolean; reason?: string } {
  return record.previewOnly || !record.source || !record.placement
    ? { editable: false, reason: record.reason ?? 'PSD Smart Object source is unavailable.' }
    : { editable: true };
}

export function smartSourceFromC3Record(record: SmartObjectPsdReadRecord): SmartSource | undefined {
  if (record.previewOnly || !record.source || !record.placement || record.source.bytes.byteLength === 0) return undefined;
  const embeddedBytes = new Uint8Array(record.source.bytes);
  return { id: record.source.id, kind: 'embedded', mimeType: record.source.mimeType, byteLength: embeddedBytes.byteLength, sha256: sha256Hex(embeddedBytes), nativeWidth: record.placement.width, nativeHeight: record.placement.height, label: record.source.name, version: 1, embeddedBytes };
}

function placementTransform(layer: ImageLayer, placement: { width: number; height: number }): readonly number[] {
  const x = layer.x; const y = layer.y; const right = x + placement.width; const bottom = y + placement.height;
  return [x, y, right, y, right, bottom, x, bottom];
}
