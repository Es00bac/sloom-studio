/**
 * Interactive Perspective Crop session (MH-044). Pure + canvas-free: quad geometry,
 * corner-drag hit resolution, whole-quad translation, homography-projected guide lines,
 * validity gating, and a deterministic session descriptor. The crop tool/panel/render
 * paths consume this; rectification stays in `perspectiveCrop.ts` /
 * `perspectiveCropDocument.ts`.
 */

import {
  applyHomography,
  isPerspectiveCropOutputAllocationSafe,
  solveHomography,
  type CropPoint,
} from './perspectiveCrop';
import { perspectiveCropOutputSize } from './perspectiveCropDocument';
import type { CropGuideMode, ImageDocument } from '../../../types/imageEditor';
import { imageDocumentHasEditableTiltmarkSurface } from '../tiltmark/ImageTiltmarkLayer';
import { documentWorkingDepth } from '../pixels/ImageHighBitDocument';

/** Quad corner order: top-left, top-right, bottom-right, bottom-left. */
export type PerspectiveCropQuad = readonly [CropPoint, CropPoint, CropPoint, CropPoint];

type MutablePerspectiveCropQuad = [CropPoint, CropPoint, CropPoint, CropPoint];

export type PerspectiveCropCornerIndex = 0 | 1 | 2 | 3;

export const PERSPECTIVE_CROP_QUAD_LABELS = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'] as const;

/** Minimum edge length (document px) for a committable quad. */
export const PERSPECTIVE_CROP_MIN_EDGE_PX = 8;
/** Minimum quad area (document px²) for a committable quad. */
export const PERSPECTIVE_CROP_MIN_AREA_PX2 = 256;
/** Corner hit target in screen px before converting through zoom. */
export const PERSPECTIVE_CROP_CORNER_HIT_SCREEN_PX = 18;
/** Additional grab margin inside the quad boundary that still counts as corner-grab. */
export const PERSPECTIVE_CROP_CORNER_HIT_SLOP_DOC_PX = 4;
/** Panel/pointer coordinates beyond this magnitude are not executable crop geometry. */
export const PERSPECTIVE_CROP_MAX_ABS_COORDINATE = 1_000_000;

export function createPerspectiveCropQuadFromRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): PerspectiveCropQuad {
  const x0 = Math.min(rect.x, rect.x + rect.width);
  const y0 = Math.min(rect.y, rect.y + rect.height);
  const x1 = Math.max(rect.x, rect.x + rect.width);
  const y1 = Math.max(rect.y, rect.y + rect.height);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function clonePerspectiveCropQuad(quad: PerspectiveCropQuad): MutablePerspectiveCropQuad {
  return [{ ...quad[0] }, { ...quad[1] }, { ...quad[2] }, { ...quad[3] }];
}

export function movePerspectiveCropQuadCorner(
  quad: PerspectiveCropQuad,
  index: PerspectiveCropCornerIndex,
  point: CropPoint,
): PerspectiveCropQuad {
  const next = clonePerspectiveCropQuad(quad);
  next[index] = { x: point.x, y: point.y };
  return next;
}

export function translatePerspectiveCropQuad(
  quad: PerspectiveCropQuad,
  delta: { x: number; y: number },
): PerspectiveCropQuad {
  return clonePerspectiveCropQuad(quad).map((corner) => ({ x: corner.x + delta.x, y: corner.y + delta.y })) as MutablePerspectiveCropQuad;
}

export function perspectiveCropQuadBounds(quad: PerspectiveCropQuad): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const xs = quad.map((corner) => corner.x);
  const ys = quad.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function quadEdgeLengths(quad: PerspectiveCropQuad): [number, number, number, number] {
  return [
    distance(quad[0], quad[1]),
    distance(quad[1], quad[2]),
    distance(quad[2], quad[3]),
    distance(quad[3], quad[0]),
  ];
}

function distance(a: CropPoint, b: CropPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function quadSignedArea(quad: PerspectiveCropQuad): number {
  let area = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * A quad is committable when all four points are finite, no edge collapses below the
 * minimum edge length, the enclosed area clears the minimum, and the quad is convex with
 * a consistent winding (no self-intersecting "bowtie").
 */
export type PerspectiveCropQuadValidity =
  | 'valid'
  | 'invalid-degenerate'
  | 'invalid-corner-order'
  | 'invalid-resource-limit';

export function resolvePerspectiveCropQuadValidity(quad: PerspectiveCropQuad): PerspectiveCropQuadValidity {
  if (quad.length !== 4) return 'invalid-degenerate';
  if (!quad.every((corner) => Number.isFinite(corner.x) && Number.isFinite(corner.y))) {
    return 'invalid-degenerate';
  }
  if (quad.some((corner) => (
    Math.abs(corner.x) > PERSPECTIVE_CROP_MAX_ABS_COORDINATE
    || Math.abs(corner.y) > PERSPECTIVE_CROP_MAX_ABS_COORDINATE
  ))) {
    return 'invalid-resource-limit';
  }
  const edges = quadEdgeLengths(quad);
  if (edges.some((edge) => edge < PERSPECTIVE_CROP_MIN_EDGE_PX)) return 'invalid-degenerate';
  const signedArea = quadSignedArea(quad);
  if (Math.abs(signedArea) < PERSPECTIVE_CROP_MIN_AREA_PX2) return 'invalid-degenerate';
  if (signedArea < 0) return 'invalid-corner-order';
  // The documented TL/TR/BR/BL screen-space winding is positive. Every corner
  // must be strictly convex; a zero/near-zero turn is a collapsed homography.
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const adjacentScale = distance(a, b) * distance(b, c);
    const tolerance = Math.max(1, adjacentScale) * 1e-12;
    if (cross < -tolerance) return 'invalid-corner-order';
    if (cross <= tolerance) return 'invalid-degenerate';
  }
  const output = perspectiveCropOutputSize([...quad]);
  return isPerspectiveCropOutputAllocationSafe(output.width, output.height)
    ? 'valid'
    : 'invalid-resource-limit';
}

export function isPerspectiveCropQuadValid(quad: PerspectiveCropQuad): boolean {
  return resolvePerspectiveCropQuadValidity(quad) === 'valid';
}

/**
 * Resolve which quad corner (if any) a document-space pointer grabs. `hitRadiusDocPx` is
 * typically the screen hit target converted through zoom; the slop margin lets grabs that
 * started just inside the boundary keep the corner.
 */
export function resolvePerspectiveCropCornerGrab(
  quad: PerspectiveCropQuad,
  point: CropPoint,
  hitRadiusDocPx: number,
): PerspectiveCropCornerIndex | null {
  let best: PerspectiveCropCornerIndex | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0 as PerspectiveCropCornerIndex; i < 4; i += 1) {
    const candidate = distance(quad[i], point);
    if (candidate <= bestDistance) {
      bestDistance = candidate;
      best = i;
    }
  }
  const reach = Math.max(hitRadiusDocPx, 0) + PERSPECTIVE_CROP_CORNER_HIT_SLOP_DOC_PX;
  return best !== null && bestDistance <= reach ? best : null;
}

/** Point-in-convex-quad test (cross-product sign against every edge). */
export function pointInPerspectiveCropQuad(quad: PerspectiveCropQuad, point: CropPoint): boolean {
  let positive = false;
  let negative = false;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross > 0) positive = true;
    if (cross < 0) negative = true;
  }
  return positive !== negative;
}

export interface PerspectiveCropGuideLine {
  /** Document-space segment endpoints. Homographies keep straight lines straight. */
  from: CropPoint;
  to: CropPoint;
}

/**
 * Guide lines for the quad preview: the output rectangle's thirds (or grid) lines mapped
 * back through the homography into document space, so the user sees the rectified result
 * superimposed on the original geometry.
 */
export function buildPerspectiveCropGuideLines(
  quad: PerspectiveCropQuad,
  guideMode: CropGuideMode,
): PerspectiveCropGuideLine[] {
  if (guideMode === 'none' || !isPerspectiveCropQuadValid(quad)) return [];
  const { width, height } = perspectiveCropOutputSize([...quad]);
  const homography = solveHomography(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    [...quad],
  );
  if (!homography) return [];

  const stations = guideMode === 'grid' ? [0.25, 0.5, 0.75] : [1 / 3, 2 / 3];
  const lines: PerspectiveCropGuideLine[] = [];
  for (const fraction of stations) {
    const u = fraction * width;
    const v = fraction * height;
    lines.push({
      from: applyHomography(homography, u, 0),
      to: applyHomography(homography, u, height),
    });
    lines.push({
      from: applyHomography(homography, 0, v),
      to: applyHomography(homography, width, v),
    });
  }
  return lines;
}

export type PerspectiveCropRefusalReason =
  | 'tiltmark-surface-requires-raster'
  | 'high-bit-depth-requires-native-crop'
  | 'degenerate-quad'
  | 'resource-limit-exceeded';

export interface PerspectiveCropAvailability {
  available: boolean;
  refusal: PerspectiveCropRefusalReason | null;
}

/** Perspective crop flattens; editable Tiltmark surfaces must rasterize explicitly first. */
export function resolvePerspectiveCropAvailability(doc: ImageDocument | null): PerspectiveCropAvailability {
  if (!doc) return { available: false, refusal: 'degenerate-quad' };
  if (documentWorkingDepth(doc) !== 8) {
    return { available: false, refusal: 'high-bit-depth-requires-native-crop' };
  }
  if (imageDocumentHasEditableTiltmarkSurface(doc)) {
    return { available: false, refusal: 'tiltmark-surface-requires-raster' };
  }
  return { available: true, refusal: null };
}

export interface PerspectiveCropSessionDescriptor {
  descriptorId: 'image-perspective-crop-session:v1';
  signature: string;
  active: boolean;
  quad: { corners: CropPoint[]; labels: readonly string[] };
  validity: {
    status: PerspectiveCropQuadValidity;
    canApply: boolean;
    minEdgePx: number;
    minAreaPx2: number;
  };
  output: {
    width: number;
    height: number;
    sizeLabel: string;
    flattenPolicy: 'destructive-single-layer-flatten';
  };
  guides: { mode: CropGuideMode; lineCount: number };
  applyCancel: {
    apply: 'supported-enter-key' | 'blocked-degenerate-quad' | 'blocked-resource-limit';
    cancel: 'supported-escape-key';
    previewBehavior: 'live-overlay-no-document-mutation';
  };
  undo: 'single-atomic-doc-resize-operation';
  refusal: PerspectiveCropRefusalReason | null;
}

export function describePerspectiveCropSession({
  doc,
  quad,
  guideMode,
}: {
  doc: ImageDocument | null;
  quad: PerspectiveCropQuad | null;
  guideMode: CropGuideMode;
}): PerspectiveCropSessionDescriptor {
  const availability = resolvePerspectiveCropAvailability(doc);
  const validity = quad === null ? 'invalid-degenerate' : resolvePerspectiveCropQuadValidity(quad);
  const valid = validity === 'valid';
  const size = quad ? perspectiveCropOutputSize([...quad]) : { width: 0, height: 0 };
  const guideLines = quad && valid ? buildPerspectiveCropGuideLines(quad, guideMode) : [];
  const active = quad !== null;
  const refusal = availability.refusal
    ?? (validity === 'invalid-resource-limit' ? 'resource-limit-exceeded' : null);
  return {
    descriptorId: 'image-perspective-crop-session:v1',
    signature: [
      'image-perspective-crop-session:v1',
      `active=${active}`,
      quad
        ? `quad=${quad.map((corner) => `${Math.round(corner.x)},${Math.round(corner.y)}`).join(';')}`
        : 'quad=none',
      `valid=${valid}`,
      `out=${size.width}x${size.height}`,
      `guide=${guideMode}:${guideLines.length}`,
      `refusal=${refusal ?? 'none'}`,
    ].join('|'),
    active,
    quad: {
      corners: quad ? [...quad] : [],
      labels: PERSPECTIVE_CROP_QUAD_LABELS,
    },
    validity: {
      status: validity,
      canApply: valid && availability.available,
      minEdgePx: PERSPECTIVE_CROP_MIN_EDGE_PX,
      minAreaPx2: PERSPECTIVE_CROP_MIN_AREA_PX2,
    },
    output: {
      width: size.width,
      height: size.height,
      sizeLabel: `${size.width} × ${size.height}px`,
      flattenPolicy: 'destructive-single-layer-flatten',
    },
    guides: { mode: guideMode, lineCount: guideLines.length },
    applyCancel: {
      apply: valid && availability.available
        ? 'supported-enter-key'
        : validity === 'invalid-resource-limit'
          ? 'blocked-resource-limit'
          : 'blocked-degenerate-quad',
      cancel: 'supported-escape-key',
      previewBehavior: 'live-overlay-no-document-mutation',
    },
    undo: 'single-atomic-doc-resize-operation',
    refusal,
  };
}
