import type { BlendMode, ImageDocument, ImageLayer } from '../../../types/imageEditor';
import { canEditImageLayerPixels, canMoveImageLayer } from '../../../lib/imageLayerLocks';
import { maskBoundingBox, type SelectionMask } from '../SelectionMask';
import { replaceLayer } from './layerStack';
import type { PhotoshopQuickActionResult } from './types';

export function buildSelectionResult(selection: SelectionMask): PhotoshopQuickActionResult {
  return {
    kind: 'selection',
    selection,
    hasSelection: Boolean(maskBoundingBox(selection)),
  };
}

export function buildTransformResult(
  doc: ImageDocument,
  before: ImageLayer,
  after: ImageLayer,
): PhotoshopQuickActionResult | null {
  if (!canMoveImageLayer(before)) return null;
  if (before.x === after.x && before.y === after.y) return null;
  return {
    kind: 'transform',
    operation: {
      kind: 'transform',
      docId: doc.id,
      layerId: before.id,
      before: { x: before.x, y: before.y },
      after: { x: after.x, y: after.y },
    },
  };
}

export function applyLayerReplacement(
  doc: ImageDocument,
  layer: ImageLayer | null | undefined,
  transform: (layer: ImageLayer) => ImageLayer | null,
): PhotoshopQuickActionResult | null {
  if (!canEditImageLayerPixels(layer)) return null;
  const nextLayer = transform(layer);
  if (!nextLayer) return null;
  return buildLayerOpResult(doc, replaceLayer(doc.layers, layer.id, nextLayer), layer.id);
}

export function setLayerOpacityResult(
  doc: ImageDocument,
  layer: ImageLayer | null | undefined,
  opacity: number,
): PhotoshopQuickActionResult | null {
  if (!layer) return null;
  return buildLayerOpResult(doc, replaceLayer(doc.layers, layer.id, { ...layer, opacity }), layer.id);
}

export function setLayerBlendModeResult(
  doc: ImageDocument,
  layer: ImageLayer | null | undefined,
  blendMode: BlendMode,
): PhotoshopQuickActionResult | null {
  if (!layer) return null;
  return buildLayerOpResult(doc, replaceLayer(doc.layers, layer.id, { ...layer, blendMode }), layer.id);
}

export function buildLayerOpResult(
  doc: ImageDocument,
  after: ImageLayer[],
  activeLayerId: string | null,
): PhotoshopQuickActionResult {
  return {
    kind: 'layerOp',
    operation: {
      kind: 'layerOp',
      docId: doc.id,
      before: doc.layers,
      after,
    },
    activeLayerId,
  };
}
