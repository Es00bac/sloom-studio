import type { ImageDocument, ImageLayer, LayerBitmap, SmartSource } from '../../../types/imageEditor';
import { createBitmap } from '../LayerBitmap';

const cache = new Map<string, LayerBitmap>();

export function smartObjectRenderKey(source: Pick<SmartSource, 'id' | 'version'>, width: number, height: number, target = 'rgba8'): string {
  return `${source.id}:${source.version}:${width}x${height}:${target}`;
}

/** Render from an immutable source bitmap at the requested placement. Scaling always starts from
 * the native source, never an earlier instance cache, so 10% → 1000% has no cumulative loss. */
export function rasterizeSmartSource(source: Pick<SmartSource, 'id' | 'version'>, native: LayerBitmap, placement: { width: number; height: number }, target = 'rgba8'): LayerBitmap {
  const width = Math.max(1, Math.floor(placement.width));
  const height = Math.max(1, Math.floor(placement.height));
  const key = smartObjectRenderKey(source, width, height, target);
  const cached = cache.get(key);
  if (cached) return cached;
  const bitmap = createBitmap(width, height);
  const context = bitmap.getContext('2d');
  if (!context) throw new Error('Smart Object render requires a 2D canvas.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(native, 0, 0, width, height);
  cache.set(key, bitmap);
  return bitmap;
}

export function invalidateSmartSourceRender(sourceId: string): void {
  for (const key of cache.keys()) if (key.startsWith(`${sourceId}:`)) cache.delete(key);
}

export function applySmartSourceRender(layer: ImageLayer, source: SmartSource, native: LayerBitmap): ImageLayer {
  if (layer.smartObject?.sourceId !== source.id) return layer;
  const bitmap = rasterizeSmartSource(source, native, layer.smartObject.placement);
  return { ...layer, bitmap, bitmapVersion: layer.bitmapVersion + 1, smartObject: { ...layer.smartObject, renderedVersion: source.version } };
}

/** Rebuild every local instance from one authoritative native raster. The optional renderer makes
 * the document operation testable without browser image codecs. */
export function rerasterizeSmartObjectInstances(
  document: ImageDocument,
  sourceId: string,
  native: LayerBitmap,
  renderer: (source: SmartSource, native: LayerBitmap, placement: { width: number; height: number }) => LayerBitmap = rasterizeSmartSource,
): ImageDocument {
  const source = document.metadata?.smartSources?.[sourceId];
  if (!source) throw new Error(`Smart Object source ${sourceId} is unavailable.`);
  invalidateSmartSourceRender(sourceId);
  return {
    ...document,
    layers: document.layers.map((layer) => {
      if (layer.smartObject?.sourceId !== sourceId) return layer;
      const bitmap = renderer(source, native, layer.smartObject.placement);
      return { ...layer, bitmap, bitmapVersion: layer.bitmapVersion + 1, smartObject: { ...layer.smartObject, renderedVersion: source.version } };
    }),
  };
}
