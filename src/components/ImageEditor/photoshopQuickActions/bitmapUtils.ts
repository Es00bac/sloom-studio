import type { ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import { createBitmap, getBitmapImageData, putBitmapImageData } from '../LayerBitmap';
import { maskBoundingBox, type SelectionMask } from '../SelectionMask';

export function copySelectionBitmap(
  doc: ImageDocument,
  layer: ImageLayer,
  selection: SelectionMask,
): { bitmap: LayerBitmap; x: number; y: number } | null {
  if (!layer.bitmap) return null;
  const bbox = maskBoundingBox(selection);
  if (!bbox) return null;
  const bitmap = createBitmap(bbox.width, bbox.height);
  const source = getBitmapImageData(layer.bitmap);
  const output = createEmptyImageData(bitmap);

  for (let y = 0; y < bbox.height; y += 1) {
    for (let x = 0; x < bbox.width; x += 1) {
      const docX = bbox.x + x;
      const docY = bbox.y + y;
      const layerX = Math.round(docX - layer.x);
      const layerY = Math.round(docY - layer.y);
      if (layerX < 0 || layerY < 0 || layerX >= layer.bitmap.width || layerY >= layer.bitmap.height) {
        continue;
      }
      const selectionAlpha = getSelectionAlphaAtDocumentPixel(doc, selection, docX, docY);
      if (selectionAlpha === 0) continue;
      const srcOffset = (layerY * layer.bitmap.width + layerX) * 4;
      const dstOffset = (y * bbox.width + x) * 4;
      output.data[dstOffset] = source.data[srcOffset];
      output.data[dstOffset + 1] = source.data[srcOffset + 1];
      output.data[dstOffset + 2] = source.data[srcOffset + 2];
      output.data[dstOffset + 3] = Math.round((source.data[srcOffset + 3] * selectionAlpha) / 255);
    }
  }

  putBitmapImageData(bitmap, output);
  return { bitmap, x: bbox.x, y: bbox.y };
}

export function getSelectionAlphaAtDocumentPixel(
  doc: ImageDocument,
  selection: SelectionMask,
  x: number,
  y: number,
): number {
  const docX = Math.round(x);
  const docY = Math.round(y);
  if (
    docX < 0 ||
    docY < 0 ||
    docX >= doc.width ||
    docY >= doc.height ||
    docX >= selection.width ||
    docY >= selection.height
  ) {
    return 0;
  }
  return selection.data[docY * selection.width + docX];
}

export function bitmapAlphaBoundingBox(
  bitmap: LayerBitmap,
): { x: number; y: number; width: number; height: number } | null {
  const imageData = getBitmapImageData(bitmap);
  let minX = bitmap.width;
  let minY = bitmap.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (imageData.data[(y * bitmap.width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function copyBitmapRegion(
  src: LayerBitmap,
  sx: number,
  sy: number,
  width: number,
  height: number,
): LayerBitmap {
  const source = getBitmapImageData(src);
  const bitmap = createBitmap(width, height);
  const output = createEmptyImageData(bitmap);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      copyPixel(source.data, src.width, sx + x, sy + y, output.data, width, x, y);
    }
  }
  putBitmapImageData(bitmap, output);
  return bitmap;
}

export function transformLayerBitmap(
  layer: ImageLayer,
  mapDestToSource: (src: LayerBitmap, x: number, y: number) => { x: number; y: number },
): ImageLayer {
  return {
    ...layer,
    bitmap: layer.bitmap ? remapBitmap(layer.bitmap, layer.bitmap.width, layer.bitmap.height, mapDestToSource) : null,
    bitmapVersion: layer.bitmap ? layer.bitmapVersion + 1 : layer.bitmapVersion,
    mask: layer.mask ? remapBitmap(layer.mask, layer.mask.width, layer.mask.height, mapDestToSource) : null,
  };
}

export function rotateLayer(layer: ImageLayer, direction: 'cw' | 'ccw'): ImageLayer {
  const rotateBitmap = (bitmap: LayerBitmap): LayerBitmap =>
    remapBitmap(bitmap, bitmap.height, bitmap.width, (_src, x, y) =>
      direction === 'cw'
        ? { x: y, y: bitmap.height - 1 - x }
        : { x: bitmap.width - 1 - y, y: x },
    );

  return {
    ...layer,
    bitmap: layer.bitmap ? rotateBitmap(layer.bitmap) : null,
    bitmapVersion: layer.bitmap ? layer.bitmapVersion + 1 : layer.bitmapVersion,
    mask: layer.mask ? rotateBitmap(layer.mask) : null,
  };
}

function remapBitmap(
  src: LayerBitmap,
  destWidth: number,
  destHeight: number,
  mapDestToSource: (src: LayerBitmap, x: number, y: number) => { x: number; y: number },
): LayerBitmap {
  const source = getBitmapImageData(src);
  const dest = createBitmap(destWidth, destHeight);
  const output = createEmptyImageData(dest);
  for (let y = 0; y < dest.height; y += 1) {
    for (let x = 0; x < dest.width; x += 1) {
      const mapped = mapDestToSource(src, x, y);
      copyPixel(source.data, src.width, mapped.x, mapped.y, output.data, dest.width, x, y);
    }
  }
  putBitmapImageData(dest, output);
  return dest;
}

export function scaleBitmapNearest(src: LayerBitmap, width: number, height: number): LayerBitmap {
  const source = getBitmapImageData(src);
  const dest = createBitmap(width, height);
  const output = createEmptyImageData(dest);
  for (let y = 0; y < dest.height; y += 1) {
    for (let x = 0; x < dest.width; x += 1) {
      const sx = Math.min(src.width - 1, Math.floor((x / dest.width) * src.width));
      const sy = Math.min(src.height - 1, Math.floor((y / dest.height) * src.height));
      copyPixel(source.data, src.width, sx, sy, output.data, dest.width, x, y);
    }
  }
  putBitmapImageData(dest, output);
  return dest;
}

export function cloneBitmapPixels(src: LayerBitmap): LayerBitmap {
  const bitmap = createBitmap(src.width, src.height);
  putBitmapImageData(bitmap, getBitmapImageData(src));
  return bitmap;
}

export function createEmptyImageData(bitmap: LayerBitmap): ImageData {
  const ctx = bitmap.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire image data context');
  return ctx.createImageData(bitmap.width, bitmap.height);
}

export function forEachBitmapPixel(
  bitmap: LayerBitmap,
  visit: (x: number, y: number, offset: number) => void,
): void {
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      visit(x, y, (y * bitmap.width + x) * 4);
    }
  }
}

export function copyPixel(
  src: Uint8ClampedArray,
  srcWidth: number,
  sx: number,
  sy: number,
  dest: Uint8ClampedArray,
  destWidth: number,
  dx: number,
  dy: number,
): void {
  const srcOffset = (sy * srcWidth + sx) * 4;
  const destOffset = (dy * destWidth + dx) * 4;
  dest[destOffset] = src[srcOffset] ?? 0;
  dest[destOffset + 1] = src[srcOffset + 1] ?? 0;
  dest[destOffset + 2] = src[srcOffset + 2] ?? 0;
  dest[destOffset + 3] = src[srcOffset + 3] ?? 0;
}
