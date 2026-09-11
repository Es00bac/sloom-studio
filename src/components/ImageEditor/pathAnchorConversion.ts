/**
 * Corner/smooth anchor conversion for retained Image vector paths (MH-047).
 * Pure geometry + layer plumbing mirroring `updateVectorPathLayerPoint`: document-space
 * points in, a rebuilt retained vector-path layer out, so every conversion commits as an
 * ordinary undoable `layerOp`.
 */

import type { ImageLayer, ImageVectorPathPoint } from '../../types/imageEditor';
import {
  buildVectorPathLayer,
  getEditableVectorShape,
  getVectorPathDocumentPoints,
} from './ImageVectorShape';

/** Bezier handle length as a fraction of the distance to the neighbouring anchor. */
const SMOOTH_HANDLE_NEIGHBOR_FRACTION = 1 / 3;
const SMOOTH_HANDLE_MAX_LENGTH_PX = 240;

export type PathAnchorConversionTarget = 'corner' | 'smooth';

/** An anchor is smooth while it retains any Bezier handle; corner anchors have none. */
export function isSmoothVectorPathAnchor(point: ImageVectorPathPoint): boolean {
  return Boolean(point.inHandle || point.outHandle);
}

export function convertVectorPathAnchor(
  layer: ImageLayer,
  pointIndex: number,
  target: PathAnchorConversionTarget,
): ImageLayer {
  const shape = getEditableVectorShape(layer);
  if (!shape || shape.kind !== 'path') return layer;
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= shape.points.length) return layer;

  const points = getVectorPathDocumentPoints(layer);
  const currentPoint = points[pointIndex];
  if (!currentPoint) return layer;

  points[pointIndex] = target === 'corner'
    ? convertAnchorToCorner(currentPoint)
    : convertAnchorToSmooth(points, pointIndex);

  return buildVectorPathLayer({
    doc: null,
    points,
    closed: shape.closed,
    settings: shape,
    existingLayer: layer,
  });
}

/** Toggle an anchor between corner (handles retracted) and smooth (handles rebuilt). */
export function toggleVectorPathAnchorConversion(layer: ImageLayer, pointIndex: number): ImageLayer {
  const points = getVectorPathDocumentPoints(layer);
  const currentPoint = points[pointIndex];
  if (!currentPoint) return layer;
  return convertVectorPathAnchor(
    layer,
    pointIndex,
    isSmoothVectorPathAnchor(currentPoint) ? 'corner' : 'smooth',
  );
}

function convertAnchorToCorner(point: ImageVectorPathPoint): ImageVectorPathPoint {
  const { inHandle: _inHandle, outHandle: _outHandle, ...corner } = point;
  return corner;
}

function convertAnchorToSmooth(
  points: ImageVectorPathPoint[],
  pointIndex: number,
): ImageVectorPathPoint {
  const point = points[pointIndex];
  const previous = points[pointIndex - 1];
  const next = points[pointIndex + 1];
  const anchor = { x: point.x, y: point.y };

  // Interior anchors get mirrored in/out handles along the averaged neighbour tangent —
  // the standard "convert anchor point" smooth reconstruction.
  if (previous && next) {
    const toPrevious = { x: previous.x - anchor.x, y: previous.y - anchor.y };
    const toNext = { x: next.x - anchor.x, y: next.y - anchor.y };
    const previousLength = Math.hypot(toPrevious.x, toPrevious.y);
    const nextLength = Math.hypot(toNext.x, toNext.y);
    if (previousLength > 0 && nextLength > 0) {
      const tangent = {
        x: toNext.x / nextLength - toPrevious.x / previousLength,
        y: toNext.y / nextLength - toPrevious.y / previousLength,
      };
      const tangentLength = Math.hypot(tangent.x, tangent.y);
      if (tangentLength > 1e-6) {
        const direction = { x: tangent.x / tangentLength, y: tangent.y / tangentLength };
        const handleLength = Math.min(
          SMOOTH_HANDLE_MAX_LENGTH_PX,
          SMOOTH_HANDLE_NEIGHBOR_FRACTION * (previousLength + nextLength) / 2,
        );
        return {
          ...point,
          inHandle: roundedPoint({
            x: anchor.x - direction.x * handleLength,
            y: anchor.y - direction.y * handleLength,
          }),
          outHandle: roundedPoint({
            x: anchor.x + direction.x * handleLength,
            y: anchor.y + direction.y * handleLength,
          }),
        };
      }
    }
    // Collinear neighbours: fall through to a straight-through segment tangent.
  }

  // Open-path end anchors (or degenerate interiors): a single handle continuing the
  // adjacent segment, mirroring Photoshop's behavior at path ends.
  const neighbour = previous ?? next;
  if (neighbour) {
    // An open-path endpoint's available handle points into the adjacent segment. The
    // previous draft used anchor-minus-neighbour, which projected the first point's
    // out handle away from the path (and likewise the last point's in handle).
    const segment = { x: neighbour.x - anchor.x, y: neighbour.y - anchor.y };
    const length = Math.hypot(segment.x, segment.y);
    if (length > 0) {
      const handleLength = Math.min(SMOOTH_HANDLE_MAX_LENGTH_PX, length * SMOOTH_HANDLE_NEIGHBOR_FRACTION);
      const handle = roundedPoint({
        x: anchor.x + (segment.x / length) * handleLength,
        y: anchor.y + (segment.y / length) * handleLength,
      });
      return previous
        ? { ...point, inHandle: handle }
        : { ...point, outHandle: handle };
    }
  }

  // A single-point path has no segment to derive a tangent from; keep it a corner.
  return convertAnchorToCorner(point);
}

function roundedPoint(point: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
