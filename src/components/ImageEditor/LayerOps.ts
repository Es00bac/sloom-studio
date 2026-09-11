import type { ImageDocument, ImageLayer, LayerType } from '../../types/imageEditor';
import { createBitmap } from './LayerBitmap';
import { createAdjustmentLayer, renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';

/**
 * Create a fresh empty layer of the given type, sized to the document.
 * The bitmap is allocated lazily as needed.
 */
export function createEmptyLayer(
  doc: ImageDocument,
  type: LayerType,
  name?: string,
): ImageLayer {
  if (type === 'adjustment') {
    return createAdjustmentLayer(doc, 'brightnessContrast', name);
  }

  const id = `layer-${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  if (type === 'group') {
    return {
      id,
      name: name ?? defaultLayerName(type, doc.layers.length + 1),
      type,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 0,
      mask: null,
      groupExpanded: true,
    };
  }

  return {
    id,
    name: name ?? defaultLayerName(type, doc.layers.length + 1),
    type,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: createBitmap(doc.width, doc.height),
    bitmapVersion: 0,
    mask: null,
  };
}

function defaultLayerName(type: LayerType, index: number): string {
  switch (type) {
    case 'image':
      return `Layer ${index}`;
    case 'mask':
      return `Mask ${index}`;
    case 'text':
      return `Text ${index}`;
    case 'adjustment':
      return `Adjustment ${index}`;
    case 'vector':
      return `Vector ${index}`;
    case 'group':
      return `Group ${index}`;
    default:
      return `Layer ${index}`;
  }
}

/**
 * Merge two adjacent layers (lower under upper) into a single layer using the
 * compositor blend rules. Returns the merged layer; caller is responsible for
 * removing the originals.
 */
export function mergeLayersDown(
  doc: ImageDocument,
  upper: ImageLayer,
  lower: ImageLayer,
): ImageLayer {
  const target = renderImageDocumentLayersToBitmap({
    ...doc,
    layers: [lower, upper],
  });

  return {
    id: `layer-merged-${Date.now()}`,
    name: lower.name,
    type: 'image',
    visible: lower.visible,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: target,
    bitmapVersion: 0,
    mask: null,
  };
}

/**
 * Flatten every layer in the document into one image layer at the document's
 * dimensions. Returns the flat layer; caller removes the originals.
 */
export function flattenDocument(doc: ImageDocument): ImageLayer {
  const target = renderImageDocumentLayersToBitmap(doc);

  return {
    id: `layer-flat-${Date.now()}`,
    name: 'Background',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: target,
    bitmapVersion: 0,
    mask: null,
  };
}

/**
 * Merge all visible layers in the document into a single image layer,
 * while leaving invisible layers untouched.
 */
export function mergeVisibleLayers(doc: ImageDocument): ImageDocument {
  const visibleLayers = doc.layers.filter((l) => l.visible);
  if (visibleLayers.length <= 1) {
    return doc;
  }

  const mergedBitmap = renderImageDocumentLayersToBitmap({
    ...doc,
    layers: visibleLayers,
  });

  const mergedLayer: ImageLayer = {
    id: `layer-merged-visible-${Date.now()}`,
    name: 'Merged Layers',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: mergedBitmap,
    bitmapVersion: 0,
    mask: null,
  };

  const nextLayers: ImageLayer[] = [];
  let mergedInserted = false;

  const highestVisibleIndex = doc.layers.map((l) => l.visible).lastIndexOf(true);

  doc.layers.forEach((layer, index) => {
    if (layer.visible) {
      if (index === highestVisibleIndex && !mergedInserted) {
        nextLayers.push(mergedLayer);
        mergedInserted = true;
      }
    } else {
      nextLayers.push(layer);
    }
  });

  return {
    ...doc,
    layers: nextLayers,
    activeLayerId: mergedLayer.id,
    dirty: true,
  };
}
