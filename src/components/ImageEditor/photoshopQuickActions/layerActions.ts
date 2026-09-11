import type { EditorOperation, ImageDocument, ImageLayer } from '../../../types/imageEditor';
import { createBitmap, getBitmapImageData, putBitmapImageData } from '../LayerBitmap';
import type { SelectionMask } from '../SelectionMask';
import {
  bitmapAlphaBoundingBox,
  copyBitmapRegion,
  copyPixel,
  copySelectionBitmap,
  createEmptyImageData,
  rotateLayer,
  scaleBitmapNearest,
  transformLayerBitmap,
} from './bitmapUtils';
import { clearSelectedPixels } from './pixelActions';
import {
  getLayerHeight,
  getLayerWidth,
  insertLayerAfter,
  moveLayerToIndex,
} from './layerStack';

export function createLayerViaCopy(
  doc: ImageDocument,
  layer: ImageLayer,
  selection: SelectionMask,
  id = `layer-via-copy-${Date.now()}`,
): ImageLayer | null {
  const bitmap = copySelectionBitmap(doc, layer, selection);
  if (!bitmap) return null;
  return {
    ...layer,
    id,
    name: `${layer.name} copy`,
    x: bitmap.x,
    y: bitmap.y,
    bitmap: bitmap.bitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

export function createLayerViaCut(
  doc: ImageDocument,
  layer: ImageLayer,
  selection: SelectionMask,
  id = `layer-via-cut-${Date.now()}`,
): { newLayer: ImageLayer; paintOp: Extract<EditorOperation, { kind: 'paint' }> } | null {
  const newLayer = createLayerViaCopy(doc, layer, selection, id);
  const paintOp = clearSelectedPixels(doc, layer, selection);
  if (!newLayer || !paintOp) return null;
  return { newLayer: { ...newLayer, name: `${layer.name} cut` }, paintOp };
}

export function cropLayerToSelection(
  doc: ImageDocument,
  layer: ImageLayer,
  selection: SelectionMask,
): ImageLayer | null {
  const bitmap = copySelectionBitmap(doc, layer, selection);
  if (!bitmap) return null;
  return {
    ...layer,
    x: bitmap.x,
    y: bitmap.y,
    bitmap: bitmap.bitmap,
    bitmapVersion: layer.bitmapVersion + 1,
    mask: null,
  };
}

export function trimTransparentLayer(layer: ImageLayer): ImageLayer | null {
  if (!layer.bitmap) return null;
  const bbox = bitmapAlphaBoundingBox(layer.bitmap);
  if (!bbox) return null;
  const bitmap = copyBitmapRegion(layer.bitmap, bbox.x, bbox.y, bbox.width, bbox.height);
  return {
    ...layer,
    x: layer.x + bbox.x,
    y: layer.y + bbox.y,
    bitmap,
    bitmapVersion: layer.bitmapVersion + 1,
    mask: layer.mask ? copyBitmapRegion(layer.mask, bbox.x, bbox.y, bbox.width, bbox.height) : null,
  };
}

export function flipLayerHorizontal(layer: ImageLayer): ImageLayer {
  return transformLayerBitmap(layer, (src, x, y) => ({
    x: src.width - 1 - x,
    y,
  }));
}

export function flipLayerVertical(layer: ImageLayer): ImageLayer {
  return transformLayerBitmap(layer, (src, x, y) => ({
    x,
    y: src.height - 1 - y,
  }));
}

export function rotateLayer90Clockwise(layer: ImageLayer): ImageLayer {
  return rotateLayer(layer, 'cw');
}

export function rotateLayer90CounterClockwise(layer: ImageLayer): ImageLayer {
  return rotateLayer(layer, 'ccw');
}

export function rotateLayer180(layer: ImageLayer): ImageLayer {
  return transformLayerBitmap(layer, (src, x, y) => ({
    x: src.width - 1 - x,
    y: src.height - 1 - y,
  }));
}

export function centerLayer(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  const width = layer.bitmap?.width ?? doc.width;
  const height = layer.bitmap?.height ?? doc.height;
  return {
    ...layer,
    x: (doc.width - width) / 2,
    y: (doc.height - height) / 2,
  };
}

export function fitLayerToCanvas(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  if (!layer.bitmap) return { ...layer, x: 0, y: 0 };
  return {
    ...layer,
    x: 0,
    y: 0,
    bitmap: scaleBitmapNearest(layer.bitmap, doc.width, doc.height),
    bitmapVersion: layer.bitmapVersion + 1,
    mask: layer.mask ? scaleBitmapNearest(layer.mask, doc.width, doc.height) : null,
  };
}

export function resetLayerPosition(layer: ImageLayer): ImageLayer {
  return { ...layer, x: 0, y: 0 };
}

export function duplicateLayerQuickAction(
  doc: ImageDocument,
  layer: ImageLayer,
  id = `layer-duplicate-${Date.now()}`,
): ImageLayer[] {
  return insertLayerAfter(doc.layers, layer.id, {
    ...layer,
    id,
    name: `${layer.name} copy`,
  });
}

export function moveLayerToFront(doc: ImageDocument, layer: ImageLayer): ImageLayer[] {
  return moveLayerToIndex(doc.layers, layer.id, doc.layers.length - 1);
}

export function moveLayerToBack(doc: ImageDocument, layer: ImageLayer): ImageLayer[] {
  return moveLayerToIndex(doc.layers, layer.id, 0);
}

export function raiseLayerOneStep(doc: ImageDocument, layer: ImageLayer): ImageLayer[] {
  const index = doc.layers.findIndex((candidate) => candidate.id === layer.id);
  return index < 0 ? doc.layers : moveLayerToIndex(doc.layers, layer.id, index + 1);
}

export function lowerLayerOneStep(doc: ImageDocument, layer: ImageLayer): ImageLayer[] {
  const index = doc.layers.findIndex((candidate) => candidate.id === layer.id);
  return index < 0 ? doc.layers : moveLayerToIndex(doc.layers, layer.id, index - 1);
}

export function nudgeLayer(layer: ImageLayer, dx: number, dy: number): ImageLayer {
  return {
    ...layer,
    x: layer.x + dx,
    y: layer.y + dy,
  };
}

export function alignLayerLeft(layer: ImageLayer): ImageLayer {
  return { ...layer, x: 0 };
}

export function alignLayerRight(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  return { ...layer, x: doc.width - getLayerWidth(layer) };
}

export function alignLayerTop(layer: ImageLayer): ImageLayer {
  return { ...layer, y: 0 };
}

export function alignLayerBottom(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  return { ...layer, y: doc.height - getLayerHeight(layer) };
}

export function centerLayerHorizontal(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  return {
    ...layer,
    x: (doc.width - getLayerWidth(layer)) / 2,
  };
}

export function centerLayerVertical(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  return {
    ...layer,
    y: (doc.height - getLayerHeight(layer)) / 2,
  };
}

export function fitLayerWidthToCanvas(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  if (!layer.bitmap) return { ...layer, x: 0 };
  const ratio = doc.width / Math.max(1, layer.bitmap.width);
  const height = Math.max(1, Math.round(layer.bitmap.height * ratio));
  return {
    ...layer,
    x: 0,
    y: (doc.height - height) / 2,
    bitmap: scaleBitmapNearest(layer.bitmap, doc.width, height),
    bitmapVersion: layer.bitmapVersion + 1,
    mask: layer.mask ? scaleBitmapNearest(layer.mask, doc.width, height) : null,
  };
}

export function fitLayerHeightToCanvas(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  if (!layer.bitmap) return { ...layer, y: 0 };
  const ratio = doc.height / Math.max(1, layer.bitmap.height);
  const width = Math.max(1, Math.round(layer.bitmap.width * ratio));
  return {
    ...layer,
    x: (doc.width - width) / 2,
    y: 0,
    bitmap: scaleBitmapNearest(layer.bitmap, width, doc.height),
    bitmapVersion: layer.bitmapVersion + 1,
    mask: layer.mask ? scaleBitmapNearest(layer.mask, width, doc.height) : null,
  };
}

export function fitLayerInsideCanvas(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  if (!layer.bitmap) return { ...layer, x: 0, y: 0 };
  const ratio = Math.min(
    doc.width / Math.max(1, layer.bitmap.width),
    doc.height / Math.max(1, layer.bitmap.height),
  );
  return scaleLayerToRatio(doc, layer, ratio);
}

export function fillLayerToCanvas(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  if (!layer.bitmap) return { ...layer, x: 0, y: 0 };
  const ratio = Math.max(
    doc.width / Math.max(1, layer.bitmap.width),
    doc.height / Math.max(1, layer.bitmap.height),
  );
  return scaleLayerToRatio(doc, layer, ratio);
}

export function scaleLayerByPercent(
  _doc: ImageDocument,
  layer: ImageLayer,
  percent: number,
): ImageLayer {
  if (!layer.bitmap) return { ...layer };
  const ratio = Math.max(0.01, percent / 100);
  const width = Math.max(1, Math.round(layer.bitmap.width * ratio));
  const height = Math.max(1, Math.round(layer.bitmap.height * ratio));
  return {
    ...layer,
    x: layer.x + (layer.bitmap.width - width) / 2,
    y: layer.y + (layer.bitmap.height - height) / 2,
    bitmap: scaleBitmapNearest(layer.bitmap, width, height),
    bitmapVersion: layer.bitmapVersion + 1,
    mask: layer.mask ? scaleBitmapNearest(layer.mask, width, height) : null,
  };
}

export function rasterizeLayerToCanvas(doc: ImageDocument, layer: ImageLayer): ImageLayer {
  if (!layer.bitmap) return { ...layer, x: 0, y: 0 };
  const bitmap = createBitmap(doc.width, doc.height);
  const output = createEmptyImageData(bitmap);
  const source = getBitmapImageData(layer.bitmap);

  for (let y = 0; y < layer.bitmap.height; y += 1) {
    for (let x = 0; x < layer.bitmap.width; x += 1) {
      const docX = Math.round(layer.x + x);
      const docY = Math.round(layer.y + y);
      if (docX < 0 || docY < 0 || docX >= doc.width || docY >= doc.height) continue;
      copyPixel(source.data, layer.bitmap.width, x, y, output.data, bitmap.width, docX, docY);
    }
  }

  putBitmapImageData(bitmap, output);
  return {
    ...layer,
    x: 0,
    y: 0,
    bitmap,
    bitmapVersion: layer.bitmapVersion + 1,
    mask: null,
  };
}


function scaleLayerToRatio(doc: ImageDocument, layer: ImageLayer, ratio: number): ImageLayer {
  if (!layer.bitmap) return { ...layer };
  const width = Math.max(1, Math.round(layer.bitmap.width * ratio));
  const height = Math.max(1, Math.round(layer.bitmap.height * ratio));
  return {
    ...layer,
    x: (doc.width - width) / 2,
    y: (doc.height - height) / 2,
    bitmap: scaleBitmapNearest(layer.bitmap, width, height),
    bitmapVersion: layer.bitmapVersion + 1,
    mask: layer.mask ? scaleBitmapNearest(layer.mask, width, height) : null,
  };
}


export function trimCanvasToVisible(
  doc: ImageDocument,
): { width: number; height: number; layers: ImageLayer[] } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const layer of doc.layers) {
    if (!layer.visible || !layer.bitmap) continue;
    const imageData = getBitmapImageData(layer.bitmap);
    for (let y = 0; y < layer.bitmap.height; y += 1) {
      for (let x = 0; x < layer.bitmap.width; x += 1) {
        const alpha = imageData.data[(y * layer.bitmap.width + x) * 4 + 3];
        if (alpha === 0) continue;
        const docX = Math.round(layer.x + x);
        const docY = Math.round(layer.y + y);
        if (docX < minX) minX = docX;
        if (docY < minY) minY = docY;
        if (docX > maxX) maxX = docX;
        if (docY > maxY) maxY = docY;
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return {
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
    layers: doc.layers.map((layer) => ({
      ...layer,
      x: layer.x - minX,
      y: layer.y - minY,
    })),
  };
}
