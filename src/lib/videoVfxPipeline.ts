import {
  findMissingVideoCapabilities,
  type VideoProfessionalCapabilityId,
  type VideoProfessionalCapabilityProbe,
} from './videoProfessionalCapabilities';
import type {
  ProfessionalMask,
  ProfessionalStabilizationAnalysisArtifact,
  ProfessionalStabilizationSample,
} from '../types/videoProfessional';

export interface VideoMaskPoint {
  x: number;
  y: number;
  inHandle?: { x: number; y: number };
  outHandle?: { x: number; y: number };
}

interface VideoMaskShapeBase {
  id: string;
  operation: 'add' | 'subtract' | 'intersect';
  opacity: number;
  feather: number;
}

export interface VideoBezierMaskShape extends VideoMaskShapeBase {
  kind: 'bezier';
  points: VideoMaskPoint[];
  closed: true;
}

export interface VideoRectMaskShape extends VideoMaskShapeBase {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  cornerRadius: number;
}

export interface VideoEllipseMaskShape extends VideoMaskShapeBase {
  kind: 'ellipse';
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
}

export type VideoMaskShape = VideoBezierMaskShape | VideoRectMaskShape | VideoEllipseMaskShape;

export interface VideoMaskModel {
  version: 1;
  id: string;
  name: string;
  inverted: boolean;
  shapes: VideoMaskShape[];
}

export interface VideoMaskRenderDescriptor {
  kind: 'shared-alpha-mask';
  maskId: string;
  inverted: boolean;
  coordinateSpace: 'normalized-source';
  antialiasing: 'supersample-4x';
  shapes: VideoMaskShape[];
  note: string;
}

export interface VideoMaskTrackingSample {
  timeMs: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

const MAX_MASK_TRACKING_KEYFRAMES = 128;
const MAX_STABILIZATION_SAMPLES = 128;

export type VideoMaskExecutionPlan =
  | { status: 'none' }
  | { status: 'ready'; model: VideoMaskModel }
  | { status: 'unsupported'; reason: string };

function maskBounds(points: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number; width: number; height: number } | undefined {
  if (points.length < 2 || points.some((point) => !finiteNormalized(point.x) || !finiteNormalized(point.y))) return undefined;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

/** Resolves persisted tracker samples with the same clamped linear policy used by browser and native delivery. */
export function resolveVideoMaskTrackingSample(mask: ProfessionalMask, timeMs: number): VideoMaskTrackingSample {
  const keyframes = normalizeVideoMaskTrackingKeyframes(mask);
  if (keyframes.length === 0) throw new Error('Tracked mask has no executable keyframes.');
  const time = finiteTimeMs(timeMs);
  const first = keyframes[0]!;
  const last = keyframes[keyframes.length - 1]!;
  if (time <= first.timeMs) return { ...first };
  if (time >= last.timeMs) return { ...last };
  for (let index = 1; index < keyframes.length; index += 1) {
    const end = keyframes[index]!;
    const start = keyframes[index - 1]!;
    if (time <= end.timeMs) {
      const amount = (time - start.timeMs) / Math.max(1, end.timeMs - start.timeMs);
      return {
        timeMs: time,
        offsetX: lerp(start.offsetX, end.offsetX, amount),
        offsetY: lerp(start.offsetY, end.offsetY, amount),
        scale: lerp(start.scale, end.scale, amount),
      };
    }
  }
  return { ...last };
}

/** Converts the persisted professional-mask shape into one deterministic, time-varying execution boundary.
 * One rectangle/ellipse, one mask, finite in-bounds geometry, and bounded keyframes are executable. */
export function buildVideoMaskExecutionPlan(masks: readonly ProfessionalMask[] | undefined, timeMs = 0): VideoMaskExecutionPlan {
  if (!masks || masks.length === 0) return { status: 'none' };
  if (masks.length !== 1) return { status: 'unsupported', reason: 'Only one authored mask per clip is executable in this bounded route.' };
  const mask = masks[0];
  if (mask.inverted) return { status: 'unsupported', reason: 'Inverted masks remain saved setup; the bounded route executes non-inverted masks only.' };
  if (mask.kind === 'bezier') return { status: 'unsupported', reason: 'Bezier masks remain saved setup; only rectangle and ellipse masks are executable.' };
  const bounds = maskBounds(mask.points);
  if (!bounds) return { status: 'unsupported', reason: 'Mask needs two distinct finite normalized points.' };
  let resolvedBounds = bounds;
  if (mask.tracking?.keyframes.length) {
    if (mask.tracking.status !== 'ready') return { status: 'unsupported', reason: 'Tracked mask keyframes are not marked ready for delivery.' };
    try {
      resolvedBounds = resolveTrackedBounds(bounds, resolveVideoMaskTrackingSample(mask, timeMs));
    } catch (error) {
      return { status: 'unsupported', reason: error instanceof Error ? error.message : 'Tracked mask geometry is not executable.' };
    }
  }
  const opacity = Math.max(0, Math.min(1, mask.opacityPercent / 100));
  const feather = Math.max(0, Math.min(1, mask.featherPercent / 100));
  const shape: VideoMaskShape = mask.kind === 'rectangle'
    ? { id: mask.id, kind: 'rect', operation: 'add', opacity, feather, ...resolvedBounds, cornerRadius: 0 }
    : {
      id: mask.id,
      kind: 'ellipse',
      operation: 'add',
      opacity,
      feather,
      centerX: resolvedBounds.x + resolvedBounds.width / 2,
      centerY: resolvedBounds.y + resolvedBounds.height / 2,
      radiusX: resolvedBounds.width / 2,
      radiusY: resolvedBounds.height / 2,
    };
  const model: VideoMaskModel = {
    version: 1,
    id: mask.id,
    name: mask.id,
    inverted: mask.inverted,
    shapes: [shape],
  };
  const errors = validateVideoMask(model);
  return errors.length > 0 ? { status: 'unsupported', reason: errors.join(' ') } : { status: 'ready', model };
}

export function buildVideoMaskCssClipPath(plan: Extract<VideoMaskExecutionPlan, { status: 'ready' }>): string {
  const shape = plan.model.shapes[0];
  if (!shape) return 'none';
  if (shape.kind === 'rect') {
    return `inset(${(shape.y * 100).toFixed(3)}% ${((1 - shape.x - shape.width) * 100).toFixed(3)}% ${((1 - shape.y - shape.height) * 100).toFixed(3)}% ${(shape.x * 100).toFixed(3)}%)`;
  }
  if (shape.kind !== 'ellipse') return 'none';
  return `ellipse(${(shape.radiusX * 100).toFixed(3)}% ${(shape.radiusY * 100).toFixed(3)}% at ${(shape.centerX * 100).toFixed(3)}% ${(shape.centerY * 100).toFixed(3)}%)`;
}

export function buildVideoMaskFfmpegAlphaFilter(plan: Extract<VideoMaskExecutionPlan, { status: 'ready' }>): string {
  const shape = plan.model.shapes[0];
  if (!shape) throw new Error('Executable mask has no shape.');
  if (shape.kind !== 'rect' && shape.kind !== 'ellipse') throw new Error('Only rectangle and ellipse masks are executable.');
  const condition = shape.kind === 'rect'
    ? `between(X,${shape.x.toFixed(6)}*W,${(shape.x + shape.width).toFixed(6)}*W)*between(Y,${shape.y.toFixed(6)}*H,${(shape.y + shape.height).toFixed(6)}*H)`
    : `lte(((X/W-${shape.centerX.toFixed(6)})/${shape.radiusX.toFixed(6)})^2+((Y/H-${shape.centerY.toFixed(6)})/${shape.radiusY.toFixed(6)})^2,1)`;
  const inside = plan.model.inverted ? `if(${condition},0,1)` : `if(${condition},1,0)`;
  // Keep RGB and any pre-existing alpha intact. FFmpeg's geq requires at least one
  // colour/luminance expression when targeting alpha, and multiplying alpha makes
  // the mask compose correctly with chroma-key transparency and clip opacity.
  return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${inside}*${shape.opacity.toFixed(6)}'`;
}

/** Builds a time-varying native filter from the same persisted tracker samples used by the stage. */
export function buildVideoMaskFfmpegAlphaFilterForMasks(masks: readonly ProfessionalMask[]): string {
  const mask = masks.length === 1 ? masks[0] : undefined;
  if (!mask) throw new Error('Only one tracked mask can be delivered by the bounded route.');
  const plan = buildVideoMaskExecutionPlan([mask], 0);
  if (plan.status !== 'ready') throw new Error(plan.status === 'unsupported' ? plan.reason : 'No executable mask.');
  if (!mask.tracking?.keyframes.length) return buildVideoMaskFfmpegAlphaFilter(plan);
  const bounds = maskBounds(mask.points);
  if (!bounds) throw new Error('Mask needs two distinct finite normalized points.');
  const samples = normalizeVideoMaskTrackingKeyframes(mask);
  const x = trackingExpression(samples, (sample) => resolveTrackedBounds(bounds, sample).x);
  const y = trackingExpression(samples, (sample) => resolveTrackedBounds(bounds, sample).y);
  const width = trackingExpression(samples, (sample) => resolveTrackedBounds(bounds, sample).width);
  const height = trackingExpression(samples, (sample) => resolveTrackedBounds(bounds, sample).height);
  const condition = mask.kind === 'rectangle'
    ? `between(X,(${x})*W,((${x})+(${width}))*W)*between(Y,(${y})*H,((${y})+(${height}))*H)`
    : `lte(((X/W-((${x})+(${width})/2))/(${width}/2))^2+((Y/H-((${y})+(${height})/2))/(${height}/2))^2,1)`;
  const inside = `if(${condition},1,0)`;
  return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${inside}*${Math.max(0, Math.min(1, mask.opacityPercent / 100)).toFixed(6)}'`;
}

function normalizeVideoMaskTrackingKeyframes(mask: ProfessionalMask): VideoMaskTrackingSample[] {
  const keyframes = mask.tracking?.keyframes ?? [];
  if (keyframes.length === 0 || keyframes.length > MAX_MASK_TRACKING_KEYFRAMES) {
    throw new Error(`Tracked mask keyframes must contain between 1 and ${MAX_MASK_TRACKING_KEYFRAMES} samples.`);
  }
  const normalized = keyframes.map((keyframe) => ({
    timeMs: finiteTimeMs(keyframe.timeMs),
    offsetX: finiteNumber(keyframe.offsetX, 'offsetX'),
    offsetY: finiteNumber(keyframe.offsetY, 'offsetY'),
    scale: finiteNumber(keyframe.scale, 'scale'),
  })).sort((left, right) => left.timeMs - right.timeMs);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index]!.timeMs === normalized[index - 1]!.timeMs) throw new Error('Tracked mask keyframe times must be strictly increasing.');
  }
  return normalized;
}

function resolveTrackedBounds(bounds: { x: number; y: number; width: number; height: number }, sample: VideoMaskTrackingSample): { x: number; y: number; width: number; height: number } {
  if (sample.scale <= 0) throw new Error('Tracked mask scale must be positive.');
  const width = bounds.width * sample.scale;
  const height = bounds.height * sample.scale;
  const x = bounds.x + bounds.width / 2 + sample.offsetX - width / 2;
  const y = bounds.y + bounds.height / 2 + sample.offsetY - height / 2;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || x + width > 1 || y + height > 1) {
    throw new Error('Tracked mask motion leaves normalized source bounds.');
  }
  return { x, y, width, height };
}

function trackingExpression(samples: VideoMaskTrackingSample[], value: (sample: VideoMaskTrackingSample) => number): string {
  const values = samples.map((sample) => value(resolveSafeSample(sample)));
  let expression = values.at(-1)!.toFixed(8);
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const start = samples[index]!;
    const end = samples[index + 1]!;
    const amount = `(T-${(start.timeMs / 1000).toFixed(6)})/${Math.max(0.001, (end.timeMs - start.timeMs) / 1000).toFixed(6)}`;
    expression = `if(lt(T,${(end.timeMs / 1000).toFixed(6)}),${values[index]!.toFixed(8)}+(${values[index + 1]!.toFixed(8)}-${values[index]!.toFixed(8)})*${amount},${expression})`;
  }
  return expression;
}

function resolveSafeSample(sample: VideoMaskTrackingSample): VideoMaskTrackingSample {
  return { ...sample, scale: Math.max(0.0001, sample.scale) };
}

function finiteTimeMs(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Tracked mask time must be finite.');
  return Math.max(0, Math.round(value));
}

function finiteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`Tracked mask ${name} must be finite.`);
  return value;
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

/** Normalizes a bounded host-produced stabilization pass into durable project state. */
export function buildVideoStabilizationAnalysisArtifact(
  samples: readonly ProfessionalStabilizationSample[],
  sourceFingerprint?: string,
): ProfessionalStabilizationAnalysisArtifact {
  if (samples.length === 0 || samples.length > MAX_STABILIZATION_SAMPLES) {
    throw new Error(`Stabilization analysis must contain between 1 and ${MAX_STABILIZATION_SAMPLES} samples.`);
  }
  const normalized = samples.map((sample) => ({
    timeMs: finiteTimeMs(sample.timeMs),
    offsetX: finiteNumber(sample.offsetX, 'stabilization offsetX'),
    offsetY: finiteNumber(sample.offsetY, 'stabilization offsetY'),
    scale: finiteNumber(sample.scale, 'stabilization scale'),
  })).sort((left, right) => left.timeMs - right.timeMs);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index]!.timeMs === normalized[index - 1]!.timeMs) throw new Error('Stabilization sample times must be strictly increasing.');
  }
  if (normalized.some((sample) => sample.scale <= 0 || Math.abs(sample.offsetX) > 1 || Math.abs(sample.offsetY) > 1)) {
    throw new Error('Stabilization samples exceed the bounded normalized transform range.');
  }
  return {
    version: 1,
    status: 'ready',
    sourceFingerprint: sourceFingerprint?.trim() || undefined,
    samples: normalized,
  };
}

export function resolveVideoStabilizationSample(
  artifact: ProfessionalStabilizationAnalysisArtifact,
  timeMs: number,
): ProfessionalStabilizationSample {
  if (artifact.version !== 1 || artifact.status !== 'ready' || artifact.samples.length === 0) {
    throw new Error('Stabilization analysis artifact is unavailable.');
  }
  const time = finiteTimeMs(timeMs);
  const first = artifact.samples[0]!;
  const last = artifact.samples.at(-1)!;
  if (time <= first.timeMs) return { ...first };
  if (time >= last.timeMs) return { ...last };
  for (let index = 1; index < artifact.samples.length; index += 1) {
    const end = artifact.samples[index]!;
    const start = artifact.samples[index - 1]!;
    if (time <= end.timeMs) {
      const amount = (time - start.timeMs) / Math.max(1, end.timeMs - start.timeMs);
      return {
        timeMs: time,
        offsetX: lerp(start.offsetX, end.offsetX, amount),
        offsetY: lerp(start.offsetY, end.offsetY, amount),
        scale: lerp(start.scale, end.scale, amount),
      };
    }
  }
  return { ...last };
}

/** Compiles a bounded stabilization artifact for native FFmpeg delivery. */
export function buildVideoStabilizationFfmpegFilter(
  artifact: ProfessionalStabilizationAnalysisArtifact,
  cropMode: 'none' | 'auto-scale',
): string {
  resolveVideoStabilizationSample(artifact, 0);
  const x = stabilizationExpression(artifact.samples, (sample) => sample.offsetX);
  const y = stabilizationExpression(artifact.samples, (sample) => sample.offsetY);
  const scale = stabilizationExpression(artifact.samples, (sample) => Math.max(1, sample.scale));
  const cropWidth = cropMode === 'auto-scale' ? `(iw/(${scale}))` : 'iw';
  const cropHeight = cropMode === 'auto-scale' ? `(ih/(${scale}))` : 'ih';
  const crop = `crop=w='${cropWidth}':h='${cropHeight}':x='(iw-ow)/2-(${x})*iw':y='(ih-oh)/2-(${y})*ih'`;
  return `scale=w='iw*(${scale})':h='ih*(${scale})':eval=frame,${crop},scale=w=iw:h=ih:eval=init`;
}

function stabilizationExpression(samples: readonly ProfessionalStabilizationSample[], value: (sample: ProfessionalStabilizationSample) => number): string {
  const values = samples.map(value);
  let expression = values.at(-1)!.toFixed(8);
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const start = samples[index]!;
    const end = samples[index + 1]!;
    const amount = `(t-${(start.timeMs / 1000).toFixed(6)})/${Math.max(0.001, (end.timeMs - start.timeMs) / 1000).toFixed(6)}`;
    expression = `if(lt(t,${(end.timeMs / 1000).toFixed(6)}),${values[index]!.toFixed(8)}+(${values[index + 1]!.toFixed(8)}-${values[index]!.toFixed(8)})*${amount},${expression})`;
  }
  return expression;
}

function finiteNormalized(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateVideoMask(mask: VideoMaskModel): string[] {
  const errors: string[] = [];
  if (!mask.id.trim()) errors.push('Mask id is required.');
  const shapeIds = new Set<string>();
  for (const shape of mask.shapes) {
    if (shapeIds.has(shape.id)) errors.push(`Duplicate mask shape id '${shape.id}'.`);
    shapeIds.add(shape.id);
    if (!Number.isFinite(shape.opacity) || shape.opacity < 0 || shape.opacity > 1) errors.push(`Mask shape '${shape.id}' opacity must be from 0 through 1.`);
    if (!Number.isFinite(shape.feather) || shape.feather < 0 || shape.feather > 1) errors.push(`Mask shape '${shape.id}' feather must be from 0 through 1.`);
    if (shape.kind === 'bezier') {
      if (shape.points.length < 3) errors.push(`Bezier mask '${shape.id}' requires at least three points.`);
      for (const point of shape.points) {
        if (!finiteNormalized(point.x) || !finiteNormalized(point.y)) errors.push(`Bezier mask '${shape.id}' points must use normalized coordinates.`);
      }
    } else if (shape.kind === 'rect') {
      if (![shape.x, shape.y, shape.width, shape.height, shape.cornerRadius].every(Number.isFinite)
        || shape.width <= 0 || shape.height <= 0) errors.push(`Rectangle mask '${shape.id}' requires finite positive dimensions.`);
    } else if (![shape.centerX, shape.centerY, shape.radiusX, shape.radiusY].every(Number.isFinite)
      || shape.radiusX <= 0 || shape.radiusY <= 0) {
      errors.push(`Ellipse mask '${shape.id}' requires finite positive radii.`);
    }
  }
  return [...new Set(errors)];
}

function cubicPoint(start: VideoMaskPoint, end: VideoMaskPoint, t: number): { x: number; y: number } {
  const inverse = 1 - t;
  const control1 = start.outHandle ?? { x: start.x, y: start.y };
  const control2 = end.inHandle ?? { x: end.x, y: end.y };
  return {
    x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * control1.x + 3 * inverse * t ** 2 * control2.x + t ** 3 * end.x,
    y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * control1.y + 3 * inverse * t ** 2 * control2.y + t ** 3 * end.y,
  };
}

function flattenBezier(shape: VideoBezierMaskShape, subdivisions = 12): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < shape.points.length; index += 1) {
    const start = shape.points[index];
    const end = shape.points[(index + 1) % shape.points.length];
    if (!start || !end) continue;
    for (let step = 0; step < subdivisions; step += 1) result.push(cubicPoint(start, end, step / subdivisions));
  }
  return result;
}

function pointInPolygon(points: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const a = points[current];
    const b = points[previous];
    if (!a || !b) continue;
    const crosses = (a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function smoothEdge(signedDistance: number, feather: number): number {
  if (feather <= 0) return signedDistance >= 0 ? 1 : 0;
  const normalized = Math.max(0, Math.min(1, signedDistance / feather + 0.5));
  return normalized * normalized * (3 - 2 * normalized);
}

function sampleShape(shape: VideoMaskShape, x: number, y: number): number {
  if (shape.kind === 'rect') {
    const signed = Math.min(x - shape.x, shape.x + shape.width - x, y - shape.y, shape.y + shape.height - y);
    return smoothEdge(signed, shape.feather) * shape.opacity;
  }
  if (shape.kind === 'ellipse') {
    const normalizedDistance = 1 - Math.sqrt(((x - shape.centerX) / shape.radiusX) ** 2 + ((y - shape.centerY) / shape.radiusY) ** 2);
    return smoothEdge(normalizedDistance * Math.min(shape.radiusX, shape.radiusY), shape.feather) * shape.opacity;
  }
  // Bezier feathering needs a signed-distance pass. The shared descriptor
  // preserves feather for GPU/final render; this bounded sampler provides a
  // deterministic binary interior for thumbnails and tests.
  return (pointInPolygon(flattenBezier(shape), x, y) ? 1 : 0) * shape.opacity;
}

export function sampleVideoMaskAlpha(mask: VideoMaskModel, x: number, y: number): number {
  let alpha = 0;
  mask.shapes.forEach((shape, index) => {
    const sampled = sampleShape(shape, x, y);
    if (index === 0) alpha = shape.operation === 'subtract' ? 1 - sampled : sampled;
    else if (shape.operation === 'add') alpha = Math.max(alpha, sampled);
    else if (shape.operation === 'subtract') alpha *= 1 - sampled;
    else alpha = Math.min(alpha, sampled);
  });
  return mask.inverted ? 1 - alpha : alpha;
}

export function rasterizeVideoMaskAlpha(mask: VideoMaskModel, width: number, height: number): Uint8Array {
  const errors = validateVideoMask(mask);
  if (errors.length > 0) throw new Error(errors[0]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('Mask raster dimensions must be positive integers.');
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Four stable sub-pixel samples provide the same antialiasing convention
      // to preview thumbnails and render-worker alpha textures.
      const samples = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const;
      const alpha = samples.reduce((sum, [offsetX, offsetY]) => sum + sampleVideoMaskAlpha(mask, (x + offsetX) / width, (y + offsetY) / height), 0) / samples.length;
      result[y * width + x] = Math.round(alpha * 255);
    }
  }
  return result;
}

export function buildVideoMaskRenderDescriptor(mask: VideoMaskModel): VideoMaskRenderDescriptor {
  const errors = validateVideoMask(mask);
  if (errors.length > 0) throw new Error(errors[0]);
  return {
    kind: 'shared-alpha-mask',
    maskId: mask.id,
    inverted: mask.inverted,
    coordinateSpace: 'normalized-source',
    antialiasing: 'supersample-4x',
    shapes: structuredClone(mask.shapes),
    note: 'Preview and final render consume the same serialized shape geometry; final render may rasterize at output resolution.',
  };
}

export interface VideoTrackingSample {
  timeSeconds: number;
  translateX: number;
  translateY: number;
  scale: number;
  rotationDegrees: number;
  confidence: number;
}

export interface VideoTrackingResult {
  tracker: 'point' | 'planar' | 'manual';
  sourceWidth: number;
  sourceHeight: number;
  samples: VideoTrackingSample[];
}

export interface VideoMaskTrackingKeyframe {
  timeSeconds: number;
  transform: { translateX: number; translateY: number; scale: number; rotationDegrees: number };
  confidence: number;
  source: 'baked-tracking';
}

export function bakeVideoTrackingToMaskKeyframes(result: VideoTrackingResult): VideoMaskTrackingKeyframe[] {
  return [...result.samples]
    .filter((sample) => Number.isFinite(sample.timeSeconds) && sample.timeSeconds >= 0)
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .map((sample) => ({
      timeSeconds: sample.timeSeconds,
      transform: {
        translateX: sample.translateX,
        translateY: sample.translateY,
        scale: sample.scale,
        rotationDegrees: sample.rotationDegrees,
      },
      confidence: Math.max(0, Math.min(1, sample.confidence)),
      source: 'baked-tracking',
    }));
}

export interface VideoStabilizationSettings {
  shakiness: number;
  accuracy: number;
  smoothingFrames: number;
  zoomPercent: number;
  tripod: boolean;
}

export interface VideoStabilizationUnavailable {
  ok: false;
  reason: string;
  missingCapabilities: Array<{ id: VideoProfessionalCapabilityId; reason: string }>;
}

export interface VideoStabilizationAnalysisSpec {
  ok: true;
  phase: 'analysis';
  filter: string;
  transformArtifactPath: string;
}

export interface VideoStabilizationRenderSpec {
  ok: true;
  phase: 'render';
  filter: string;
  transformArtifactPath: string;
}

function stabilizationUnavailable(
  probe: VideoProfessionalCapabilityProbe,
  requirement: VideoProfessionalCapabilityId,
): VideoStabilizationUnavailable | undefined {
  const missing = findMissingVideoCapabilities(probe, [requirement]);
  return missing.length === 0 ? undefined : {
    ok: false,
    reason: missing.map(({ reason }) => reason).join(' '),
    missingCapabilities: missing.map(({ id, reason }) => ({ id, reason })),
  };
}

function escapeFfmpegValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

export function buildVideoStabilizationAnalysisSpec(
  settings: VideoStabilizationSettings,
  transformArtifactPath: string,
  probe: VideoProfessionalCapabilityProbe,
): VideoStabilizationAnalysisSpec | VideoStabilizationUnavailable {
  const unavailable = stabilizationUnavailable(probe, 'vidstab-detect');
  if (unavailable) return unavailable;
  return {
    ok: true,
    phase: 'analysis',
    transformArtifactPath,
    filter: `vidstabdetect=shakiness=${Math.round(settings.shakiness)}:accuracy=${Math.round(settings.accuracy)}:result='${escapeFfmpegValue(transformArtifactPath)}'`,
  };
}

export function buildVideoStabilizationRenderSpec(
  settings: VideoStabilizationSettings,
  transformArtifactPath: string,
  probe: VideoProfessionalCapabilityProbe,
): VideoStabilizationRenderSpec | VideoStabilizationUnavailable {
  const unavailable = stabilizationUnavailable(probe, 'vidstab-transform');
  if (unavailable) return unavailable;
  return {
    ok: true,
    phase: 'render',
    transformArtifactPath,
    filter: `vidstabtransform=input='${escapeFfmpegValue(transformArtifactPath)}':smoothing=${Math.round(settings.smoothingFrames)}:zoom=${settings.zoomPercent.toFixed(2)}:tripod=${settings.tripod ? 1 : 0}`,
  };
}

export interface VideoRotoDescriptor {
  kind: 'tracked-manual-mask';
  mask: VideoMaskRenderDescriptor;
  keyframes: VideoMaskTrackingKeyframe[];
  automation: 'manual-or-tracker-assisted';
  note: string;
}

/** Roto is intentionally modeled without claiming an unavailable ML segmentation engine. */
export function buildVideoRotoDescriptor(
  mask: VideoMaskModel,
  tracking?: VideoTrackingResult,
): VideoRotoDescriptor {
  return {
    kind: 'tracked-manual-mask',
    mask: buildVideoMaskRenderDescriptor(mask),
    keyframes: tracking ? bakeVideoTrackingToMaskKeyframes(tracking) : [],
    automation: 'manual-or-tracker-assisted',
    note: 'Rotoscoping uses editable mask geometry plus optional baked tracker transforms; no ML subject-isolation capability is claimed.',
  };
}
