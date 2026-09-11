import { clipSimplePolygons, polygonArea } from '../components/ImageEditor/ImagePolygonBooleanClip';
import type {
  PaperBubbleConnectorAnchor,
  PaperBubbleConnectorGeometry,
  PaperBubbleConnectorStyle,
  PaperFrame,
  PaperFramePatch,
} from '../types/paper';
import {
  resolveBubbleRadii,
  resolvePaperBubbleBodyPoint,
  samplePaperSpeechBubbleBody,
  samplePaperSpeechBubblePath,
} from './paperBubblePaths';
import type { PaperPoint } from './paperLayoutTools';

export type PaperBubbleConnectorHandle =
  | 'from-anchor'
  | 'to-anchor'
  | 'control-1'
  | 'control-2'
  | 'width';

export interface PaperBubbleConnectorSegment {
  id: string;
  chainId: string;
  fromFrameId: string;
  toFrameId: string;
  style: PaperBubbleConnectorStyle;
  from: PaperPoint;
  to: PaperPoint;
  control: PaperPoint;
  control1: PaperPoint;
  control2: PaperPoint;
  widthHandle: PaperPoint;
  geometry: PaperBubbleConnectorGeometry;
  dots: PaperPoint[];
  /** Curved cubic ribbon used as the bridge fallback and as input to the compound outline union. */
  bridgePolygon: PaperPoint[];
}

export interface PaperCompoundBubbleShape {
  id: string;
  chainId: string;
  sourceFrameId: string;
  memberFrameIds: string[];
  segmentIds: string[];
  outline: PaperPoint[];
  path: string;
  approximate: boolean;
}

interface ChainCandidate {
  frame: PaperFrame;
  sourceIndex: number;
}

interface Vector {
  x: number;
  y: number;
}

const DEFAULT_CONTROL_1_ALONG_PERCENT = 30;
const DEFAULT_CONTROL_2_ALONG_PERCENT = 70;
const DEFAULT_CONTROL_OFFSET_PERCENT = 7.5;
const DEFAULT_TAPER_PERCENT = 32;
const connectorSegmentCache = new WeakMap<PaperFrame[], PaperBubbleConnectorSegment[]>();
const compoundShapeCache = new WeakMap<PaperFrame[], PaperCompoundBubbleShape[]>();

export function isPaperBubbleChainFrame(frame: PaperFrame): boolean {
  return (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble') && Boolean(frame.bubbleChainId);
}

export function paperBubbleCompoundStrokeDasharray(
  strokeStyle: PaperFrame['strokeStyle'] | undefined,
): string | undefined {
  if (strokeStyle === 'dashed') return '2 1.6';
  if (strokeStyle === 'dotted') return '0.45 1.3';
  return undefined;
}

export function getPaperBubbleChainFrames(frames: PaperFrame[], chainId: string): PaperFrame[] {
  return frames
    .map((frame, sourceIndex) => ({ frame, sourceIndex }))
    .filter((candidate) => candidate.frame.bubbleChainId === chainId && isPaperBubbleChainFrame(candidate.frame))
    .sort(compareBubbleChainCandidates)
    .map((candidate) => candidate.frame);
}

export function resolvePaperBubbleConnectorGeometry(
  fromFrame: PaperFrame,
  toFrame: PaperFrame,
  stored = toFrame.bubbleConnectorGeometry,
): PaperBubbleConnectorGeometry {
  const fromAngleDeg = stored?.fromAngleDeg
    ?? resolveAnchorAngle(fromFrame, toFrame, fromFrame.bubbleConnectorAnchor ?? 'auto');
  const toAngleDeg = stored?.toAngleDeg
    ?? resolveAnchorAngle(toFrame, fromFrame, toFrame.bubbleConnectorAnchor ?? 'auto');
  const defaultWidthMm = Math.max(1.6, Math.min(
    4.5,
    Math.min(fromFrame.heightMm, toFrame.heightMm) * 0.13,
  ));
  return {
    fromAngleDeg: normalizeAngle(fromAngleDeg),
    toAngleDeg: normalizeAngle(toAngleDeg),
    control1AlongPercent: clamp(stored?.control1AlongPercent ?? DEFAULT_CONTROL_1_ALONG_PERCENT, -50, 150),
    control1OffsetPercent: clamp(stored?.control1OffsetPercent ?? DEFAULT_CONTROL_OFFSET_PERCENT, -100, 100),
    control2AlongPercent: clamp(stored?.control2AlongPercent ?? DEFAULT_CONTROL_2_ALONG_PERCENT, -50, 150),
    control2OffsetPercent: clamp(stored?.control2OffsetPercent ?? DEFAULT_CONTROL_OFFSET_PERCENT, -100, 100),
    widthMm: clamp(stored?.widthMm ?? defaultWidthMm, 0.8, 50),
    taperPercent: clamp(stored?.taperPercent ?? DEFAULT_TAPER_PERCENT, 0, 100),
  };
}

export function buildPaperBubbleConnectorSegments(frames: PaperFrame[]): PaperBubbleConnectorSegment[] {
  const cached = connectorSegmentCache.get(frames);
  if (cached) return cached;
  const groups = new Map<string, ChainCandidate[]>();

  frames.forEach((frame, sourceIndex) => {
    if (!isPaperBubbleChainFrame(frame) || !frame.bubbleChainId) return;
    groups.set(frame.bubbleChainId, [...(groups.get(frame.bubbleChainId) ?? []), { frame, sourceIndex }]);
  });

  const segments = [...groups.entries()].flatMap(([chainId, candidates]) => {
    const chainFrames = candidates.sort(compareBubbleChainCandidates).map((candidate) => candidate.frame);
    if (chainFrames.length < 2) return [];

    return chainFrames.slice(0, -1).map((fromFrame, index): PaperBubbleConnectorSegment => {
      const toFrame = chainFrames[index + 1];
      const geometry = resolvePaperBubbleConnectorGeometry(fromFrame, toFrame);
      const from = resolveBodyPointOnPage(fromFrame, geometry.fromAngleDeg);
      const to = resolveBodyPointOnPage(toFrame, geometry.toAngleDeg);
      const { control1, control2 } = resolveCubicControls(from, to, geometry);
      const style = toFrame.bubbleConnectorStyle ?? fromFrame.bubbleConnectorStyle ?? 'line';
      const control = {
        xMm: roundMm((control1.xMm + control2.xMm) / 2),
        yMm: roundMm((control1.yMm + control2.yMm) / 2),
      };
      const bridgePolygon = style === 'bridge'
        ? resolveBridgePolygon(from, to, control1, control2, geometry)
        : [];

      return {
        id: `${chainId}:${fromFrame.id}:${toFrame.id}`,
        chainId,
        fromFrameId: fromFrame.id,
        toFrameId: toFrame.id,
        style,
        from,
        to,
        control,
        control1,
        control2,
        widthHandle: resolveBridgeWidthHandle(from, to, control1, control2, geometry.widthMm),
        geometry,
        dots: style === 'thought-dots' ? resolveThoughtConnectorDots(from, to) : [],
        bridgePolygon,
      };
    });
  });
  connectorSegmentCache.set(frames, segments);
  return segments;
}

/**
 * Builds one strokable outer ring for every contiguous run of bridge-linked speech balloons.
 * The member balloon paths and their cubic ribbons are geometrically unioned; callers must suppress
 * the individual member shape strokes while keeping their text and editing frames alive.
 */
export function buildPaperCompoundBubbleShapes(frames: PaperFrame[]): PaperCompoundBubbleShape[] {
  const cached = compoundShapeCache.get(frames);
  if (cached) return cached;
  const framesById = new Map(frames.map((frame) => [frame.id, frame]));
  const byChain = new Map<string, PaperBubbleConnectorSegment[]>();
  buildPaperBubbleConnectorSegments(frames).forEach((segment) => {
    byChain.set(segment.chainId, [...(byChain.get(segment.chainId) ?? []), segment]);
  });
  const shapes: PaperCompoundBubbleShape[] = [];

  for (const [chainId, segments] of byChain) {
    let run: PaperBubbleConnectorSegment[] = [];
    const flush = () => {
      if (!run.length) return;
      const shape = buildCompoundRun(chainId, run, framesById);
      if (shape) shapes.push(shape);
      run = [];
    };

    for (const segment of segments) {
      const fromFrame = framesById.get(segment.fromFrameId);
      const toFrame = framesById.get(segment.toFrameId);
      const eligible = segment.style === 'bridge'
        && fromFrame?.kind === 'speechBubble'
        && toFrame?.kind === 'speechBubble';
      if (!eligible) {
        flush();
        continue;
      }
      if (run.length && run[run.length - 1].toFrameId !== segment.fromFrameId) flush();
      run.push(segment);
    }
    flush();
  }

  compoundShapeCache.set(frames, shapes);
  return shapes;
}

export function getPaperCompoundBubbleFrameIds(frames: PaperFrame[]): Set<string> {
  return new Set(buildPaperCompoundBubbleShapes(frames).flatMap((shape) => shape.memberFrameIds));
}

/** Bridge segments that could not be reduced to a single outer silhouette and therefore need attention. */
export function getPaperBubbleCompoundFallbackSegments(frames: PaperFrame[]): PaperBubbleConnectorSegment[] {
  const compounded = new Set(buildPaperCompoundBubbleShapes(frames).flatMap((shape) => shape.segmentIds));
  const framesById = new Map(frames.map((frame) => [frame.id, frame]));
  return buildPaperBubbleConnectorSegments(frames).filter((segment) => (
    segment.style === 'bridge'
    && framesById.get(segment.fromFrameId)?.kind === 'speechBubble'
    && framesById.get(segment.toFrameId)?.kind === 'speechBubble'
    && !compounded.has(segment.id)
  ));
}

export function paperBubbleConnectorHandlePatch(
  segment: PaperBubbleConnectorSegment,
  fromFrame: PaperFrame,
  toFrame: PaperFrame,
  handle: PaperBubbleConnectorHandle,
  point: PaperPoint,
): PaperFramePatch {
  const geometry = { ...segment.geometry };
  if (handle === 'from-anchor') {
    geometry.fromAngleDeg = resolvePointAngleForFrame(fromFrame, point);
  } else if (handle === 'to-anchor') {
    geometry.toAngleDeg = resolvePointAngleForFrame(toFrame, point);
  } else if (handle === 'control-1' || handle === 'control-2') {
    const axis = normalizeVector({
      x: segment.to.xMm - segment.from.xMm,
      y: segment.to.yMm - segment.from.yMm,
    });
    const normal = { x: -axis.y, y: axis.x };
    const distance = Math.max(0.001, Math.hypot(
      segment.to.xMm - segment.from.xMm,
      segment.to.yMm - segment.from.yMm,
    ));
    const relative = { x: point.xMm - segment.from.xMm, y: point.yMm - segment.from.yMm };
    const along = clamp(((relative.x * axis.x + relative.y * axis.y) / distance) * 100, -50, 150);
    const offset = clamp(((relative.x * normal.x + relative.y * normal.y) / distance) * 100, -100, 100);
    if (handle === 'control-1') {
      geometry.control1AlongPercent = roundMm(along);
      geometry.control1OffsetPercent = roundMm(offset);
    } else {
      geometry.control2AlongPercent = roundMm(along);
      geometry.control2OffsetPercent = roundMm(offset);
    }
  } else {
    const midpoint = cubicPoint(segment.from, segment.control1, segment.control2, segment.to, 0.5);
    const maxWidth = Math.max(0.8, Math.min(fromFrame.heightMm, toFrame.heightMm) * 0.75);
    geometry.widthMm = roundMm(clamp(
      Math.hypot(point.xMm - midpoint.xMm, point.yMm - midpoint.yMm) * 2,
      0.8,
      Math.min(50, maxWidth),
    ));
  }
  return { bubbleConnectorGeometry: geometry };
}

function buildCompoundRun(
  chainId: string,
  segments: PaperBubbleConnectorSegment[],
  framesById: Map<string, PaperFrame>,
): PaperCompoundBubbleShape | undefined {
  const firstFrame = framesById.get(segments[0].fromFrameId);
  if (!firstFrame) return undefined;
  // A connected same-speaker group owns one speaker tail, on its final balloon in reading order.
  // Earlier member tails otherwise collide with the neck and produce the exact notch/cusp this feature
  // is intended to remove.
  let outline = sampleFrameOutline(firstFrame, false);
  if (outline.length < 3) return undefined;
  let approximate = false;
  const memberFrameIds = [firstFrame.id];

  for (const [segmentIndex, segment] of segments.entries()) {
    const nextFrame = framesById.get(segment.toFrameId);
    if (!nextFrame || segment.bridgePolygon.length < 3) return undefined;
    const ribbonUnion = unionRings(outline, segment.bridgePolygon);
    if (!ribbonUnion) return undefined;
    outline = ribbonUnion.outline;
    approximate ||= ribbonUnion.approximate;
    const nextOutline = sampleFrameOutline(nextFrame, segmentIndex === segments.length - 1);
    if (nextOutline.length < 3) return undefined;
    const bubbleUnion = unionRings(outline, nextOutline);
    if (!bubbleUnion) return undefined;
    outline = bubbleUnion.outline;
    approximate ||= bubbleUnion.approximate;
    memberFrameIds.push(nextFrame.id);
  }

  const rounded = outline.map((point) => ({ xMm: roundMm(point.xMm), yMm: roundMm(point.yMm) }));
  const id = `${chainId}:${segments[0].fromFrameId}:${segments[segments.length - 1].toFrameId}:compound`;
  return {
    id,
    chainId,
    sourceFrameId: firstFrame.id,
    memberFrameIds,
    segmentIds: segments.map((segment) => segment.id),
    outline: rounded,
    path: paperRingToSvgPath(rounded),
    approximate,
  };
}

function unionRings(
  subject: PaperPoint[],
  clip: PaperPoint[],
): { outline: PaperPoint[]; approximate: boolean } | undefined {
  try {
    const result = clipSimplePolygons(
      'union',
      subject.map((point) => ({ x: point.xMm, y: point.yMm })),
      clip.map((point) => ({ x: point.xMm, y: point.yMm })),
    );
    if (result.containsHoles || result.rings.length !== 1) return undefined;
    const ring = result.rings[0];
    if (ring.length < 3 || Math.abs(polygonArea(ring)) < 0.01) return undefined;
    return {
      outline: ring.map((point) => ({ xMm: point.x, yMm: point.y })),
      approximate: result.approximate,
    };
  } catch {
    return undefined;
  }
}

function sampleFrameOutline(frame: PaperFrame, includeTail: boolean): PaperPoint[] {
  const points = includeTail ? samplePaperSpeechBubblePath(frame) : samplePaperSpeechBubbleBody(frame);
  return points.map((point) => transformLocalPointToPage(frame, point));
}

function transformLocalPointToPage(frame: PaperFrame, point: Vector): PaperPoint {
  const centerX = frame.xMm + frame.widthMm / 2;
  const centerY = frame.yMm + frame.heightMm / 2;
  const unrotatedX = frame.xMm + (point.x / 100) * frame.widthMm;
  const unrotatedY = frame.yMm + (point.y / 100) * frame.heightMm;
  const radians = frame.rotationDeg * Math.PI / 180;
  const dx = unrotatedX - centerX;
  const dy = unrotatedY - centerY;
  return {
    xMm: roundMm(centerX + dx * Math.cos(radians) - dy * Math.sin(radians)),
    yMm: roundMm(centerY + dx * Math.sin(radians) + dy * Math.cos(radians)),
  };
}

function resolveBodyPointOnPage(frame: PaperFrame, angleDeg: number): PaperPoint {
  return transformLocalPointToPage(frame, resolvePaperBubbleBodyPoint(frame, angleDeg));
}

function resolveAnchorAngle(
  frame: PaperFrame,
  otherFrame: PaperFrame,
  anchor: PaperBubbleConnectorAnchor,
): number {
  switch (anchor) {
    case 'left': return 180;
    case 'right': return 0;
    case 'top': return 270;
    case 'bottom': return 90;
    case 'auto': {
      const dx = (otherFrame.xMm + otherFrame.widthMm / 2) - (frame.xMm + frame.widthMm / 2);
      const dy = (otherFrame.yMm + otherFrame.heightMm / 2) - (frame.yMm + frame.heightMm / 2);
      return normalizeAngle(Math.atan2(dy, dx) * 180 / Math.PI - frame.rotationDeg);
    }
  }
}

function resolvePointAngleForFrame(frame: PaperFrame, point: PaperPoint): number {
  const centerX = frame.xMm + frame.widthMm / 2;
  const centerY = frame.yMm + frame.heightMm / 2;
  const radians = -frame.rotationDeg * Math.PI / 180;
  const dx = point.xMm - centerX;
  const dy = point.yMm - centerY;
  const localXPercent = 50 + ((dx * Math.cos(radians) - dy * Math.sin(radians)) / Math.max(0.001, frame.widthMm)) * 100;
  const localYPercent = 50 + ((dx * Math.sin(radians) + dy * Math.cos(radians)) / Math.max(0.001, frame.heightMm)) * 100;
  const radii = resolveBubbleRadii(frame);
  const radiusX = localXPercent >= 50 ? radii.rRight : radii.rLeft;
  const radiusY = localYPercent >= 50 ? radii.rBottom : radii.rTop;
  return roundMm(normalizeAngle(Math.atan2(
    (localYPercent - 50) / Math.max(0.001, radiusY),
    (localXPercent - 50) / Math.max(0.001, radiusX),
  ) * 180 / Math.PI));
}

function resolveCubicControls(
  from: PaperPoint,
  to: PaperPoint,
  geometry: PaperBubbleConnectorGeometry,
): { control1: PaperPoint; control2: PaperPoint } {
  const delta = { x: to.xMm - from.xMm, y: to.yMm - from.yMm };
  const distance = Math.max(0.001, Math.hypot(delta.x, delta.y));
  const axis = normalizeVector(delta);
  const normal = { x: -axis.y, y: axis.x };
  const point = (alongPercent: number, offsetPercent: number): PaperPoint => ({
    xMm: roundMm(from.xMm + axis.x * distance * alongPercent / 100 + normal.x * distance * offsetPercent / 100),
    yMm: roundMm(from.yMm + axis.y * distance * alongPercent / 100 + normal.y * distance * offsetPercent / 100),
  });
  return {
    control1: point(geometry.control1AlongPercent, geometry.control1OffsetPercent),
    control2: point(geometry.control2AlongPercent, geometry.control2OffsetPercent),
  };
}

function resolveBridgePolygon(
  from: PaperPoint,
  to: PaperPoint,
  control1: PaperPoint,
  control2: PaperPoint,
  geometry: PaperBubbleConnectorGeometry,
): PaperPoint[] {
  const spanMm = Math.hypot(to.xMm - from.xMm, to.yMm - from.yMm);
  const sampleCount = Math.max(28, Math.min(128, Math.ceil(spanMm / 0.75)));
  const centerline = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const amount = index / sampleCount;
    return {
      point: cubicPoint(from, control1, control2, to, amount),
      tangent: cubicDerivative(from, control1, control2, to, amount),
      amount,
    };
  });
  const startTangent = normalizeVector(centerline[0].tangent);
  const endTangent = normalizeVector(centerline[centerline.length - 1].tangent);
  const overlap = geometry.widthMm * 0.9;
  centerline.unshift({
    point: {
      xMm: roundMm(from.xMm - startTangent.x * overlap),
      yMm: roundMm(from.yMm - startTangent.y * overlap),
    },
    tangent: centerline[0].tangent,
    amount: 0,
  });
  centerline.push({
    point: {
      xMm: roundMm(to.xMm + endTangent.x * overlap),
      yMm: roundMm(to.yMm + endTangent.y * overlap),
    },
    tangent: centerline[centerline.length - 1].tangent,
    amount: 1,
  });

  const edgePoint = (
    entry: { point: PaperPoint; tangent: Vector; amount: number },
    side: 1 | -1,
  ): PaperPoint => {
    const tangent = normalizeVector(entry.tangent);
    const normal = { x: -tangent.y, y: tangent.x };
    const waist = 1 - (geometry.taperPercent / 100) * 0.55 * Math.sin(Math.PI * entry.amount) ** 2;
    const halfWidth = geometry.widthMm * 0.5 * waist;
    return {
      xMm: roundMm(entry.point.xMm + normal.x * halfWidth * side),
      yMm: roundMm(entry.point.yMm + normal.y * halfWidth * side),
    };
  };
  return [
    ...centerline.map((entry) => edgePoint(entry, 1)),
    ...[...centerline].reverse().map((entry) => edgePoint(entry, -1)),
  ];
}

function resolveBridgeWidthHandle(
  from: PaperPoint,
  to: PaperPoint,
  control1: PaperPoint,
  control2: PaperPoint,
  widthMm: number,
): PaperPoint {
  const midpoint = cubicPoint(from, control1, control2, to, 0.5);
  const tangent = normalizeVector(cubicDerivative(from, control1, control2, to, 0.5));
  return {
    xMm: roundMm(midpoint.xMm - tangent.y * widthMm / 2),
    yMm: roundMm(midpoint.yMm + tangent.x * widthMm / 2),
  };
}

function cubicPoint(
  from: PaperPoint,
  control1: PaperPoint,
  control2: PaperPoint,
  to: PaperPoint,
  amount: number,
): PaperPoint {
  const inverse = 1 - amount;
  return {
    xMm: roundMm((inverse ** 3 * from.xMm)
      + (3 * inverse ** 2 * amount * control1.xMm)
      + (3 * inverse * amount ** 2 * control2.xMm)
      + (amount ** 3 * to.xMm)),
    yMm: roundMm((inverse ** 3 * from.yMm)
      + (3 * inverse ** 2 * amount * control1.yMm)
      + (3 * inverse * amount ** 2 * control2.yMm)
      + (amount ** 3 * to.yMm)),
  };
}

function cubicDerivative(
  from: PaperPoint,
  control1: PaperPoint,
  control2: PaperPoint,
  to: PaperPoint,
  amount: number,
): Vector {
  const inverse = 1 - amount;
  return {
    x: 3 * inverse ** 2 * (control1.xMm - from.xMm)
      + 6 * inverse * amount * (control2.xMm - control1.xMm)
      + 3 * amount ** 2 * (to.xMm - control2.xMm),
    y: 3 * inverse ** 2 * (control1.yMm - from.yMm)
      + 6 * inverse * amount * (control2.yMm - control1.yMm)
      + 3 * amount ** 2 * (to.yMm - control2.yMm),
  };
}

function resolveThoughtConnectorDots(from: PaperPoint, to: PaperPoint): PaperPoint[] {
  const distance = Math.hypot(to.xMm - from.xMm, to.yMm - from.yMm);
  const count = Math.max(3, Math.min(7, Math.round(distance / 12)));
  return Array.from({ length: count }, (_, index) => {
    const amount = (index + 1) / (count + 1);
    return {
      xMm: roundMm(from.xMm + (to.xMm - from.xMm) * amount),
      yMm: roundMm(from.yMm + (to.yMm - from.yMm) * amount),
    };
  });
}

function compareBubbleChainCandidates(a: ChainCandidate, b: ChainCandidate): number {
  return compareOrder(a.frame.bubbleChainOrder, b.frame.bubbleChainOrder)
    || a.frame.yMm - b.frame.yMm
    || a.frame.xMm - b.frame.xMm
    || a.sourceIndex - b.sourceIndex;
}

function compareOrder(a: number | undefined, b: number | undefined): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  return 0;
}

function normalizeVector(vector: Vector): Vector {
  const length = Math.hypot(vector.x, vector.y);
  return length > 0.000001 ? { x: vector.x / length, y: vector.y / length } : { x: 1, y: 0 };
}

function normalizeAngle(value: number): number {
  return ((value % 360) + 360) % 360;
}

function paperRingToSvgPath(ring: PaperPoint[]): string {
  return `${ring.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.xMm} ${point.yMm}`).join(' ')} Z`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function roundMm(value: number): number {
  return Number(value.toFixed(3));
}
