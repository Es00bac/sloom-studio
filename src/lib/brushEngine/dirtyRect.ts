import type { Rect } from './backend';

export function dabRect(centerX: number, centerY: number, size: number): Rect {
  const radius = size / 2;
  const x = Math.floor(centerX - radius);
  const y = Math.floor(centerY - radius);
  const right = Math.ceil(centerX + radius);
  const bottom = Math.ceil(centerY + radius);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function isEmptyRect(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a || isEmptyRect(a)) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export function intersectRect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

export function clampRect(rect: Rect, width: number, height: number): Rect {
  return intersectRect(rect, { x: 0, y: 0, width, height });
}
