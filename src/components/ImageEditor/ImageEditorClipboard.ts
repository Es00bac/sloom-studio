import type { EditorOperation, ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { cloneBitmap, createBitmap } from './LayerBitmap';
import { maskBoundingBox, maskToCanvas, type SelectionMask } from './SelectionMask';

interface ImageClipboardEntry {
  bitmap: LayerBitmap;
  name: string;
  x: number;
  y: number;
}

let clipboard: ImageClipboardEntry | null = null;

export function hasImageClipboard(): boolean {
  return clipboard !== null;
}

/** A clone of the current internal clipboard bitmap (for "New from clipboard"), or null. */
export function getImageClipboardBitmap(): LayerBitmap | null {
  return clipboard ? cloneBitmap(clipboard.bitmap) : null;
}

export function clearImageClipboard(): void {
  clipboard = null;
}

export function copyLayerPixelsToClipboard(
  _doc: ImageDocument,
  layer: ImageLayer | null,
  selection: SelectionMask | null,
): boolean {
  if (!layer?.bitmap) return false;

  if (!selection) {
    clipboard = {
      bitmap: cloneBitmap(layer.bitmap),
      name: layer.name,
      x: layer.x,
      y: layer.y,
    };
    return true;
  }

  const bbox = maskBoundingBox(selection);
  if (!bbox) return false;

  const bitmap = createBitmap(bbox.width, bbox.height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) return false;

  ctx.drawImage(layer.bitmap, layer.x - bbox.x, layer.y - bbox.y);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskToCanvas(selection), -bbox.x, -bbox.y);
  ctx.restore();

  clipboard = {
    bitmap,
    name: layer.name,
    x: bbox.x,
    y: bbox.y,
  };
  return true;
}

export function createPastedLayerFromClipboard(id = `layer-paste-${Date.now()}`): ImageLayer | null {
  if (!clipboard) return null;

  return {
    id,
    name: `${clipboard.name} copy`,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: clipboard.x,
    y: clipboard.y,
    bitmap: cloneBitmap(clipboard.bitmap),
    bitmapVersion: 0,
    mask: null,
  };
}

export function deleteSelectedLayerPixels(
  doc: ImageDocument,
  layer: ImageLayer | null,
  selection: SelectionMask | null,
): Extract<EditorOperation, { kind: 'paint' }> | null {
  if (!layer?.bitmap || !selection) return null;

  const before = cloneBitmap(layer.bitmap);
  const ctx = layer.bitmap.getContext('2d');
  if (!ctx) return null;

  ctx.save();
  ctx.translate(-layer.x, -layer.y);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(maskToCanvas(selection), 0, 0);
  ctx.restore();

  return {
    kind: 'paint',
    docId: doc.id,
    layerId: layer.id,
    before,
    after: cloneBitmap(layer.bitmap),
  };
}
