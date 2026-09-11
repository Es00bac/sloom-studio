import type { LayerBitmap } from '../../types/imageEditor';
import type { ImageVectorPathPoint } from '../../types/imageEditor';
import { getBitmapImageData, putBitmapImageData } from './LayerBitmap';
import type { Point } from './tools/types';

interface ShapeDrawOptions {
  from: Point;
  to: Point;
  color: string;
  opacity: number;
  sourceImageData?: ImageData;
}

interface VectorPathDrawOptions {
  points: ImageVectorPathPoint[];
  closed: boolean;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  sourceImageData?: ImageData;
}

export function drawFilledRectOnBitmap(bitmap: LayerBitmap, options: ShapeDrawOptions): void {
  const source = options.sourceImageData ?? getBitmapImageData(bitmap);
  putBitmapImageData(bitmap, drawFilledRectOnImageData(source, options));
}

export function drawFilledEllipseOnBitmap(bitmap: LayerBitmap, options: ShapeDrawOptions): void {
  const source = options.sourceImageData ?? getBitmapImageData(bitmap);
  putBitmapImageData(bitmap, drawFilledEllipseOnImageData(source, options));
}

export function drawVectorPathOnBitmap(bitmap: LayerBitmap, options: VectorPathDrawOptions): void {
  const source = options.sourceImageData ?? getBitmapImageData(bitmap);
  putBitmapImageData(bitmap, drawVectorPathOnImageData(source, options));
}

export function drawFilledRectOnImageData(imageData: ImageData, options: ShapeDrawOptions): ImageData {
  const output = cloneImageData(imageData);
  const color = parseHexColor(options.color);
  const opacity = clamp01(options.opacity);
  const bounds = normalizeBounds(options.from, options.to);

  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      paintPixel(output, imageData, x, y, color, opacity);
    }
  }

  return output;
}

export function drawFilledEllipseOnImageData(imageData: ImageData, options: ShapeDrawOptions): ImageData {
  const output = cloneImageData(imageData);
  const color = parseHexColor(options.color);
  const opacity = clamp01(options.opacity);
  const bounds = normalizeBounds(options.from, options.to);
  const width = Math.max(1, bounds.x1 - bounds.x0);
  const height = Math.max(1, bounds.y1 - bounds.y0);
  const cx = bounds.x0 + width / 2;
  const cy = bounds.y0 + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        paintPixel(output, imageData, x, y, color, opacity);
      }
    }
  }

  return output;
}

export function drawVectorPathOnImageData(imageData: ImageData, options: VectorPathDrawOptions): ImageData {
  const output = cloneImageData(imageData);
  const points = options.points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: point.x, y: point.y }));
  if (points.length === 0) return output;

  if (options.closed && points.length >= 3) {
    const fillColor = parseHexColor(options.fillColor);
    const fillOpacity = clamp01(options.fillOpacity);
    if (fillOpacity > 0) {
      forEachPathBoundsPixel(imageData, points, 0, (x, y) => {
        if (pointInPolygon({ x, y }, points, true)) {
          paintPixel(output, imageData, x, y, fillColor, fillOpacity);
        }
      });
    }
  }

  const strokeWidth = Math.max(0, options.strokeWidth);
  const strokeOpacity = clamp01(options.strokeOpacity);
  if (strokeWidth > 0 && strokeOpacity > 0 && points.length >= 2) {
    const strokeColor = parseHexColor(options.strokeColor);
    const threshold = Math.max(0.5, strokeWidth / 2);
    const segments = pathSegments(points, options.closed);
    forEachPathBoundsPixel(imageData, points, Math.ceil(threshold), (x, y) => {
      if (segments.some((segment) => distanceToSegment({ x, y }, segment.start, segment.end) <= threshold)) {
        paintPixel(output, imageData, x, y, strokeColor, strokeOpacity);
      }
    });
  }

  return output;
}

function normalizeBounds(from: Point, to: Point): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.floor(Math.min(from.x, to.x)),
    y0: Math.floor(Math.min(from.y, to.y)),
    x1: Math.ceil(Math.max(from.x, to.x)),
    y1: Math.ceil(Math.max(from.y, to.y)),
  };
}

function forEachPathBoundsPixel(
  imageData: ImageData,
  points: ImageVectorPathPoint[],
  pad: number,
  visit: (x: number, y: number) => void,
): void {
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) - pad));
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) - pad));
  const maxX = Math.min(imageData.width - 1, Math.ceil(Math.max(...points.map((point) => point.x)) + pad));
  const maxY = Math.min(imageData.height - 1, Math.ceil(Math.max(...points.map((point) => point.y)) + pad));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      visit(x, y);
    }
  }
}

function pathSegments(
  points: ImageVectorPathPoint[],
  closed: boolean,
): Array<{ start: ImageVectorPathPoint; end: ImageVectorPathPoint }> {
  const segmentCount = closed ? points.length : points.length - 1;
  return Array.from({ length: Math.max(0, segmentCount) }, (_, index) => ({
    start: points[index]!,
    end: points[(index + 1) % points.length]!,
  }));
}

function pointInPolygon(point: ImageVectorPathPoint, polygon: ImageVectorPathPoint[], includeBoundary: boolean): boolean {
  if (includeBoundary && pathSegments(polygon, true).some((segment) => onSegment(segment.start, point, segment.end))) {
    return true;
  }

  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index]!;
    const previous = polygon[previousIndex]!;
    const crossesRay = (current.y > point.y) !== (previous.y > point.y);
    if (!crossesRay) continue;
    const xAtY = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  point: ImageVectorPathPoint,
  start: ImageVectorPathPoint,
  end: ImageVectorPathPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const projectedX = start.x + t * dx;
  const projectedY = start.y + t * dy;
  return Math.hypot(point.x - projectedX, point.y - projectedY);
}

function onSegment(a: ImageVectorPathPoint, b: ImageVectorPathPoint, c: ImageVectorPathPoint): boolean {
  const cross = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
  if (Math.abs(cross) > 1e-9) return false;
  return b.x <= Math.max(a.x, c.x)
    && b.x >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y)
    && b.y >= Math.min(a.y, c.y);
}

function paintPixel(
  output: ImageData,
  source: ImageData,
  x: number,
  y: number,
  color: [number, number, number],
  opacity: number,
): void {
  if (x < 0 || y < 0 || x >= output.width || y >= output.height) return;
  const offset = (y * output.width + x) * 4;
  output.data[offset] = mixByte(source.data[offset], color[0], opacity);
  output.data[offset + 1] = mixByte(source.data[offset + 1], color[1], opacity);
  output.data[offset + 2] = mixByte(source.data[offset + 2], color[2], opacity);
  output.data[offset + 3] = mixByte(source.data[offset + 3], 255, opacity);
}

function parseHexColor(color: string): [number, number, number] {
  const hex = color.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [0, 0, 0];
}

function cloneImageData(imageData: ImageData): ImageData {
  // Must be a real ImageData — the result is written back via ctx.putImageData(), which rejects a
  // plain object cast `as ImageData`. Structural fallback only for pure-node tests lacking ImageData.
  const data = new Uint8ClampedArray(imageData.data);
  if (typeof ImageData !== 'undefined') return new ImageData(data, imageData.width, imageData.height);
  return { width: imageData.width, height: imageData.height, data } as ImageData;
}

function mixByte(before: number, after: number, amount: number): number {
  return Math.round(before + (after - before) * amount);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
