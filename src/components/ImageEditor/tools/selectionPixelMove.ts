import type { ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import { cloneBitmap, createBitmap } from '../LayerBitmap';
import { maskToCanvas, type SelectionMask } from '../SelectionMask';

/**
 * Lifts the pixels of an image layer that fall inside a selection so the Move tool can drag the actual
 * image content (not just the marching-ants outline). The selection mask is in document space; the
 * layer bitmap is layer-local at (layer.x, layer.y).
 */
export interface LiftedSelection {
  /** Document-space canvas holding only the selected layer pixels. */
  floating: LayerBitmap;
  /** Layer-local canvas: a copy of the layer with the selected region erased. */
  clearedLocal: LayerBitmap;
  layerX: number;
  layerY: number;
}

export function liftSelectionPixels(layer: ImageLayer, mask: SelectionMask): LiftedSelection | null {
  if (layer.type !== 'image' || !layer.bitmap) return null;
  // Canvas APIs may be unavailable (e.g. non-DOM test env); fall back to a mask-only move on any failure.
  try {
    const maskCanvas = maskToCanvas(mask); // document-sized alpha mask

    // floating = layer pixels under the mask, kept at their document positions.
    const floating = createBitmap(mask.width, mask.height);
    const fctx = floating.getContext('2d');
    if (!fctx) return null;
    fctx.drawImage(layer.bitmap, layer.x, layer.y);
    fctx.globalCompositeOperation = 'destination-in';
    fctx.drawImage(maskCanvas, 0, 0);

    // clearedLocal = the layer with the selected region erased (layer-local coordinates).
    const clearedLocal = cloneBitmap(layer.bitmap);
    const cctx = clearedLocal.getContext('2d');
    if (!cctx) return null;
    cctx.save();
    cctx.globalCompositeOperation = 'destination-out';
    cctx.translate(-layer.x, -layer.y);
    cctx.drawImage(maskCanvas, 0, 0);
    cctx.restore();

    return { floating, clearedLocal, layerX: layer.x, layerY: layer.y };
  } catch {
    return null;
  }
}

/**
 * Redraws a layer bitmap in place to show the lifted selection translated by (dx, dy) in document
 * pixels: the erased layer underneath plus the floating pixels at their new offset.
 */
export function renderMovedSelectionIntoBitmap(
  target: LayerBitmap,
  lifted: LiftedSelection,
  dx: number,
  dy: number,
): void {
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(lifted.clearedLocal, 0, 0);
  ctx.drawImage(lifted.floating, -lifted.layerX + dx, -lifted.layerY + dy);
}
