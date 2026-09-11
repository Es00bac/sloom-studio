import type { ImageDocument, ImageLayer } from '../../../types/imageEditor';
import { createBitmap } from '../LayerBitmap';
import { renderImageDocumentLayersToBitmap } from '../ImageAdjustmentLayer';
import {
  isPerspectiveCropOutputAllocationSafe,
  warpPerspectiveToRect,
  type CropPoint,
} from './perspectiveCrop';

export interface PerspectiveCropDocumentState {
  width: number;
  height: number;
  layers: ImageLayer[];
  activeLayerId: string | null;
}

function distance(a: CropPoint, b: CropPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Output size for a perspective crop: the average of the quad's opposite edge
 * lengths (top/bottom → width, left/right → height). Quad order is
 * TL, TR, BR, BL. Pure + tested.
 */
export function perspectiveCropOutputSize(quad: CropPoint[]): { width: number; height: number } {
  if (quad.length !== 4) return { width: 1, height: 1 };
  const top = distance(quad[0], quad[1]);
  const bottom = distance(quad[3], quad[2]);
  const left = distance(quad[0], quad[3]);
  const right = distance(quad[1], quad[2]);
  return {
    width: Math.max(1, Math.round((top + bottom) / 2)),
    height: Math.max(1, Math.round((left + right) / 2)),
  };
}

/**
 * Rectify the document's flattened composite through the four `corners`
 * (TL, TR, BR, BL, in document pixels) into a new straight rectangle, returning
 * a single-layer document state. Perspective crop is inherently rasterizing, so
 * the result is flattened (matching how Photoshop bakes a perspective crop).
 * Returns null for empty docs or degenerate quads.
 */
export function buildPerspectiveCroppedImageDocumentState(
  doc: ImageDocument,
  corners: CropPoint[],
): PerspectiveCropDocumentState | null {
  if (corners.length !== 4 || doc.layers.length === 0) return null;
  const { width, height } = perspectiveCropOutputSize(corners);
  if (!isPerspectiveCropOutputAllocationSafe(width, height)) return null;

  const composite = renderImageDocumentLayersToBitmap(doc);
  const srcCtx = composite.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return null;
  const srcData = srcCtx.getImageData(0, 0, doc.width, doc.height);

  const warped = warpPerspectiveToRect(
    { data: srcData.data, width: doc.width, height: doc.height },
    corners,
    width,
    height,
  );
  if (!warped) return null;

  const outBitmap = createBitmap(width, height);
  const outCtx = outBitmap.getContext('2d');
  if (!outCtx) return null;
  // Build via createImageData + set() rather than `new ImageData(buffer, …)` so
  // the typed-array buffer variance (ArrayBufferLike vs ArrayBuffer) doesn't trip
  // the strict DOM lib types under the production `tsc -b` build.
  const outImageData = outCtx.createImageData(width, height);
  outImageData.data.set(warped.data);
  outCtx.putImageData(outImageData, 0, 0);

  const template = doc.layers[doc.layers.length - 1];
  const layer: ImageLayer = {
    ...template,
    id: globalThis.crypto?.randomUUID?.() ?? `layer-perspective-${Date.now()}`,
    name: 'Perspective Crop',
    type: 'image',
    visible: true,
    locked: false,
    locks: undefined,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    rotationDeg: undefined,
    skewXDeg: undefined,
    skewYDeg: undefined,
    perspectiveX: undefined,
    perspectiveY: undefined,
    warp: undefined,
    cornerOffsets: undefined,
    transformOriginX: undefined,
    transformOriginY: undefined,
    bitmap: outBitmap,
    bitmapVersion: 0,
    mask: null,
    maskDensity: undefined,
    maskFeather: undefined,
    text: undefined,
  };

  return { width, height, layers: [layer], activeLayerId: layer.id };
}
