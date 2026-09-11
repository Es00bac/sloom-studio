import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { cloneBitmap } from './LayerBitmap';

export interface ImageLinkedMaskResolution {
  sourceLayerId: string;
  mask: LayerBitmap;
}

/** Returns the direct source mask for a linked consumer. Chained and cyclic links are rejected. */
export function resolveImageLinkedMask(
  layers: readonly ImageLayer[],
  layer: Pick<ImageLayer, 'id' | 'maskLinkSourceLayerId'>,
): ImageLinkedMaskResolution | null {
  const sourceLayerId = layer.maskLinkSourceLayerId?.trim();
  if (!sourceLayerId || sourceLayerId === layer.id) return null;
  const source = layers.find((candidate) => candidate.id === sourceLayerId);
  if (!source || source.maskLinkSourceLayerId || !source.mask) return null;
  return { sourceLayerId, mask: source.mask };
}

/**
 * Supplies a transient effective mask to render/export paths. The persisted consumer remains a
 * reference, so an edit to the source mask is immediately visible everywhere it is linked.
 */
export function materializeImageLinkedMasks(layers: readonly ImageLayer[]): ImageLayer[] {
  return layers.map((layer) => {
    const resolved = resolveImageLinkedMask(layers, layer);
    const source = resolved ? layers.find((candidate) => candidate.id === resolved.sourceLayerId) : null;
    return resolved
      ? { ...layer, mask: resolved.mask, bitmapVersion: layer.bitmapVersion + (source?.bitmapVersion ?? 0) }
      : layer;
  });
}

/** Layers whose linked mask reference points at `sourceLayerId` (its mask-link consumers). */
export function findImageLinkedMaskConsumerIds(
  layers: readonly ImageLayer[],
  sourceLayerId: string,
): string[] {
  return layers
    .filter((layer) => layer.id !== sourceLayerId && layer.maskLinkSourceLayerId === sourceLayerId)
    .map((layer) => layer.id);
}

export function linkImageLayerMask(
  layers: readonly ImageLayer[],
  targetLayerId: string,
  sourceLayerId: string,
): ImageLayer[] {
  const source = layers.find((layer) => layer.id === sourceLayerId);
  const target = layers.find((layer) => layer.id === targetLayerId);
  if (!source || !target || source.id === target.id || source.maskLinkSourceLayerId || !source.mask) {
    return [...layers];
  }
  // Target-side guard: linking away a mask that other consumers already reference would leave
  // them resolve-null (single-hop resolution) and unsaveable, so refuse without mutation.
  if (findImageLinkedMaskConsumerIds(layers, targetLayerId).length > 0) {
    return [...layers];
  }
  return layers.map((layer) => layer.id === targetLayerId
    ? { ...layer, mask: null, maskLinkSourceLayerId: sourceLayerId }
    : layer);
}

/** Unlinking materializes a detached copy, preserving the visible mask at the moment of unlink. */
export function unlinkImageLayerMask(
  layers: readonly ImageLayer[],
  targetLayerId: string,
): ImageLayer[] {
  const target = layers.find((layer) => layer.id === targetLayerId);
  if (!target?.maskLinkSourceLayerId) return [...layers];
  const resolved = resolveImageLinkedMask(layers, target);
  return layers.map((layer) => {
    if (layer.id !== targetLayerId) return layer;
    const { maskLinkSourceLayerId: _removed, ...unlinked } = layer;
    return { ...unlinked, mask: resolved ? cloneBitmap(resolved.mask) : null };
  });
}
