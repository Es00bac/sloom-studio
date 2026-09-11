import type { ImageDocument, ImageLayer, SmartSource } from '../../../types/imageEditor';
import { cloneBitmap } from '../LayerBitmap';
import { assertSmartSourceGraph, bumpSmartSourceVersion, type SmartSourceError } from './SmartSource';

export type SmartObjectCommandResult = { ok: true; document: ImageDocument } | { ok: false; reason: SmartSourceError | Error };

export function convertLayerToSmartObject(document: ImageDocument, layerId: string, source: SmartSource): SmartObjectCommandResult {
  try {
    if (document.layers.some((layer) => layer.id === layerId && layer.locked)) throw new Error('Locked layers cannot become Smart Objects.');
    if (!document.layers.some((layer) => layer.id === layerId)) throw new Error('The selected layer no longer exists.');
    const smartSources = { ...(document.metadata?.smartSources ?? {}), [source.id]: source };
    assertSmartSourceGraph(smartSources);
    const layers = document.layers.map((layer) => layer.id !== layerId ? layer : {
      ...layer,
      smartObject: { sourceId: source.id, placement: { width: source.nativeWidth, height: source.nativeHeight }, renderedVersion: source.version },
    });
    return { ok: true, document: { ...document, layers, dirty: true, metadata: { ...document.metadata, smartSources } } };
  } catch (reason) { return { ok: false, reason: reason as Error }; }
}

/** Duplicate creates another instance of the same source identity. New via Copy is intentionally separate. */
export function duplicateSmartObjectInstance(document: ImageDocument, layerId: string, nextLayerId: string): SmartObjectCommandResult {
  try {
    const index = document.layers.findIndex((layer) => layer.id === layerId && Boolean(layer.smartObject));
    if (index < 0) throw new Error('The selected layer is not a Smart Object.');
    const original = document.layers[index];
    const copy: ImageLayer = { ...original, id: nextLayerId, name: `${original.name} copy`, bitmap: original.bitmap ? cloneBitmap(original.bitmap) : null };
    const layers = [...document.layers]; layers.splice(index + 1, 0, copy);
    return { ok: true, document: { ...document, layers, activeLayerId: copy.id, dirty: true } };
  } catch (reason) { return { ok: false, reason: reason as Error }; }
}

export function newSmartObjectViaCopy(document: ImageDocument, layerId: string, sourceId: string, nextLayerId: string): SmartObjectCommandResult {
  try {
    const layer = document.layers.find((candidate) => candidate.id === layerId && candidate.smartObject);
    const source = layer?.smartObject ? document.metadata?.smartSources?.[layer.smartObject.sourceId] : undefined;
    if (!layer || !source) throw new Error('The selected Smart Object source is unavailable.');
    const copySource: SmartSource = { ...source, id: sourceId, label: `${source.label} copy`, version: 1 };
    const smartSources = { ...document.metadata?.smartSources, [copySource.id]: copySource };
    assertSmartSourceGraph(smartSources);
    const index = document.layers.findIndex((candidate) => candidate.id === layerId);
    const copy: ImageLayer = {
      ...layer,
      id: nextLayerId,
      name: `${layer.name} copy`,
      smartObject: { ...layer.smartObject!, sourceId: copySource.id, renderedVersion: copySource.version },
      bitmap: layer.bitmap ? cloneBitmap(layer.bitmap) : null,
    };
    const layers = [...document.layers]; layers.splice(index + 1, 0, copy);
    return { ok: true, document: { ...document, layers, activeLayerId: copy.id, dirty: true, metadata: { ...document.metadata, smartSources } } };
  } catch (reason) { return { ok: false, reason: reason as Error }; }
}

/** Save & Return replaces source authority once, then invalidates every instance cache. The caller
 * renders actual pixels through SmartObjectRender before committing one ordinary layer operation. */
export function saveSmartObjectContents(document: ImageDocument, sourceId: string, patch: Parameters<typeof bumpSmartSourceVersion>[1] & Pick<SmartSource, 'embeddedBytes'>): SmartObjectCommandResult {
  try {
    const source = document.metadata?.smartSources?.[sourceId];
    if (!source) throw new Error('The Smart Object source no longer exists.');
    const next = bumpSmartSourceVersion(source, patch);
    const smartSources = { ...document.metadata?.smartSources, [sourceId]: next };
    assertSmartSourceGraph(smartSources);
    const layers = document.layers.map((layer) => layer.smartObject?.sourceId === sourceId
      ? { ...layer, smartObject: { ...layer.smartObject, renderedVersion: 0 } }
      : layer);
    return { ok: true, document: { ...document, layers, dirty: true, metadata: { ...document.metadata, smartSources } } };
  } catch (reason) { return { ok: false, reason: reason as Error }; }
}

export function rasterizeSmartObject(document: ImageDocument, layerId: string): SmartObjectCommandResult {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer?.smartObject || layer.locked) return { ok: false, reason: new Error('The selected Smart Object cannot be rasterized.') };
  return { ok: true, document: { ...document, dirty: true, layers: document.layers.map((candidate) => candidate.id === layerId ? { ...candidate, smartObject: undefined } : candidate) } };
}

/** Transform resize commits placement only. Rotation/skew/warp remain on the layer and are not baked. */
export function resizeSmartObjectPlacement(document: ImageDocument, layerId: string, width: number, height: number): SmartObjectCommandResult {
  const layer = document.layers.find((candidate) => candidate.id === layerId);
  if (!layer?.smartObject || layer.locked || !Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return { ok: false, reason: new Error('The Smart Object placement is invalid.') };
  }
  const placement = { width: Math.floor(width), height: Math.floor(height) };
  return { ok: true, document: { ...document, dirty: true, layers: document.layers.map((candidate) => candidate.id === layerId ? { ...candidate, smartObject: { ...candidate.smartObject!, placement, renderedVersion: 0 } } : candidate) } };
}
