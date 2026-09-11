import type { ImageLayer } from '../../../types/imageEditor';

export function replaceLayer(layers: ImageLayer[], layerId: string, nextLayer: ImageLayer): ImageLayer[] {
  return layers.map((candidate) => (candidate.id === layerId ? nextLayer : candidate));
}

export function insertLayerAfter(layers: ImageLayer[], layerId: string, newLayer: ImageLayer): ImageLayer[] {
  const index = layers.findIndex((candidate) => candidate.id === layerId);
  if (index < 0) {
    return [...layers, newLayer];
  }
  const next = [...layers];
  next.splice(index + 1, 0, newLayer);
  return next;
}

export function moveLayerToIndex(layers: ImageLayer[], layerId: string, targetIndex: number): ImageLayer[] {
  const fromIndex = layers.findIndex((candidate) => candidate.id === layerId);
  if (fromIndex < 0) return layers;
  const next = [...layers];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(Math.max(0, Math.min(next.length, targetIndex)), 0, moved);
  return next;
}

export function getLayerWidth(layer: ImageLayer): number {
  return layer.bitmap?.width ?? 0;
}

export function getLayerHeight(layer: ImageLayer): number {
  return layer.bitmap?.height ?? 0;
}
