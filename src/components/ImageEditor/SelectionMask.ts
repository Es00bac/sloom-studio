import type { SelectionMaskSnapshot, SelectionMode } from '../../types/imageEditor';

/**
 * A SelectionMask is a single-channel alpha buffer covering the document.
 *  - 0 = fully outside selection
 *  - 255 = fully inside selection
 *  - any value in between = partial coverage (anti-aliased edge or feather)
 *
 * The buffer is stored as a Uint8ClampedArray of length width*height. All
 * operations are pure functions that return either a new mask or mutate the
 * one passed in (clearly documented per function).
 */
export interface SelectionMask {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Point {
  x: number;
  y: number;
}

export type AlphaMaskCombineMonotonicity =
  | 'source-defined'
  | 'expands-or-preserves-alpha'
  | 'reduces-or-preserves-alpha';

export interface AlphaMaskCombineModeDescriptor {
  kind: 'alpha-mask-combine-mode';
  mode: SelectionMode;
  label: string;
  alphaRule: string;
  previewFormula: string;
  preservesPartialAlpha: boolean;
  monotonicity: AlphaMaskCombineMonotonicity;
  signature: string;
}

export type SelectionMaskOverlayWarningCode =
  | 'selection-mask-feather-display-only'
  | 'selection-mask-richer-visualization-unsupported';

export interface SelectionMaskOverlayWarning {
  code: SelectionMaskOverlayWarningCode;
  severity: 'warning';
  message: string;
}

export interface SelectionMaskAlphaSummary {
  transparentPixels: number;
  partialPixels: number;
  fullPixels: number;
  minAlpha: number;
  maxAlpha: number;
  averageAlpha: number;
}

export interface SelectionMaskOverlayDisplayDescriptor {
  tintColor: string;
  opacity: number;
  opacityLabel: string;
  featherPx: number;
  featherLabel: string;
}

export interface SelectionMaskOverlayDescriptorOptions {
  label?: string;
  tintColor?: string;
  opacity?: number;
  featherPx?: number;
}

export interface SelectionMaskOverlayDescriptor {
  kind: 'selection-mask-overlay';
  label: string;
  size: { width: number; height: number };
  alpha: SelectionMaskAlphaSummary;
  display: SelectionMaskOverlayDisplayDescriptor;
  warnings: SelectionMaskOverlayWarning[];
  limitations: string[];
  signature: string;
}

export type SelectionMaskPersistenceWarningCode = 'selection-mask-saved-selection-metadata-only';

export interface SelectionMaskPersistenceWarning {
  code: SelectionMaskPersistenceWarningCode;
  severity: 'warning';
  message: string;
}

export interface SelectionMaskPersistenceDescriptorOptions {
  label?: string;
  storageTarget?: 'saved-selection-alpha-channel';
}

export interface SelectionMaskPersistenceDescriptor {
  kind: 'selection-mask-persistence';
  label: string;
  storageTarget: 'saved-selection-alpha-channel';
  loadTarget: 'document-selection';
  roundTrip: 'lossless-alpha-mask';
  hasSelection: boolean;
  partialAlpha: boolean;
  warnings: SelectionMaskPersistenceWarning[];
  signature: string;
}

const ALPHA_MASK_COMBINE_MODE_DESCRIPTORS: Record<SelectionMode, AlphaMaskCombineModeDescriptor> = {
  replace: {
    kind: 'alpha-mask-combine-mode',
    mode: 'replace',
    label: 'Replace Selection',
    alphaRule: 'target = source',
    previewFormula: 'source',
    preservesPartialAlpha: true,
    monotonicity: 'source-defined',
    signature: 'alpha-mask-combine:v1:replace:source',
  },
  add: {
    kind: 'alpha-mask-combine-mode',
    mode: 'add',
    label: 'Add to Selection',
    alphaRule: 'target = max(target, source)',
    previewFormula: 'max(target, source)',
    preservesPartialAlpha: true,
    monotonicity: 'expands-or-preserves-alpha',
    signature: 'alpha-mask-combine:v1:add:max(target, source)',
  },
  subtract: {
    kind: 'alpha-mask-combine-mode',
    mode: 'subtract',
    label: 'Subtract from Selection',
    alphaRule: 'target = max(0, target - source)',
    previewFormula: 'max(0, target - source)',
    preservesPartialAlpha: true,
    monotonicity: 'reduces-or-preserves-alpha',
    signature: 'alpha-mask-combine:v1:subtract:max(0, target - source)',
  },
  intersect: {
    kind: 'alpha-mask-combine-mode',
    mode: 'intersect',
    label: 'Intersect with Selection',
    alphaRule: 'target = min(target, source)',
    previewFormula: 'min(target, source)',
    preservesPartialAlpha: true,
    monotonicity: 'reduces-or-preserves-alpha',
    signature: 'alpha-mask-combine:v1:intersect:min(target, source)',
  },
};

export function createMask(width: number, height: number): SelectionMask {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height),
  };
}

export function cloneMask(mask: SelectionMask): SelectionMask {
  return {
    width: mask.width,
    height: mask.height,
    data: new Uint8ClampedArray(mask.data),
  };
}

export function clearMask(mask: SelectionMask): void {
  mask.data.fill(0);
}

export function fillMask(mask: SelectionMask, value = 255): void {
  mask.data.fill(value);
}

export function isMaskEmpty(mask: SelectionMask): boolean {
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i] !== 0) return false;
  }
  return true;
}

export function invertMask(mask: SelectionMask): void {
  const data = mask.data;
  for (let i = 0; i < data.length; i += 1) {
    data[i] = 255 - data[i];
  }
}

export function toSnapshot(mask: SelectionMask): SelectionMaskSnapshot {
  return {
    width: mask.width,
    height: mask.height,
    data: new Uint8ClampedArray(mask.data),
  };
}

export function fromSnapshot(snapshot: SelectionMaskSnapshot): SelectionMask {
  return {
    width: snapshot.width,
    height: snapshot.height,
    data: new Uint8ClampedArray(snapshot.data),
  };
}

/**
 * Combine two masks. The target is mutated in place; the source is read-only.
 * Both masks must be the same dimensions.
 */
export function combineMasks(
  target: SelectionMask,
  source: SelectionMask,
  mode: SelectionMode,
): void {
  if (target.width !== source.width || target.height !== source.height) {
    throw new Error('SelectionMask dimensions must match for combine');
  }
  const t = target.data;
  const s = source.data;
  switch (mode) {
    case 'replace':
      t.set(s);
      return;
    case 'add':
      for (let i = 0; i < t.length; i += 1) {
        if (s[i] > t[i]) t[i] = s[i];
      }
      return;
    case 'subtract':
      for (let i = 0; i < t.length; i += 1) {
        const remaining = t[i] - s[i];
        t[i] = remaining < 0 ? 0 : remaining;
      }
      return;
    case 'intersect':
      for (let i = 0; i < t.length; i += 1) {
        if (s[i] < t[i]) t[i] = s[i];
      }
      return;
  }
}

export function describeAlphaMaskCombineMode(mode: SelectionMode): AlphaMaskCombineModeDescriptor {
  const descriptor = ALPHA_MASK_COMBINE_MODE_DESCRIPTORS[mode];
  if (!descriptor) {
    throw new Error(`Unsupported alpha mask combine mode: ${mode}`);
  }
  return { ...descriptor };
}

export function describeSelectionMaskOverlay(
  mask: SelectionMask,
  options: SelectionMaskOverlayDescriptorOptions = {},
): SelectionMaskOverlayDescriptor {
  const label = normalizeOverlayLabel(options.label);
  const alpha = summarizeMaskAlpha(mask);
  const display = buildSelectionMaskOverlayDisplay(options);
  const warnings = buildSelectionMaskOverlayWarnings(display.featherPx);
  const signature = `selection-mask-overlay:v1:${JSON.stringify({
    label,
    width: mask.width,
    height: mask.height,
    alpha,
    display: {
      opacity: display.opacity,
      featherPx: display.featherPx,
    },
    warnings: warnings.map((warning) => warning.code),
  })}`;

  return {
    kind: 'selection-mask-overlay',
    label,
    size: { width: mask.width, height: mask.height },
    alpha,
    display,
    warnings,
    limitations: warnings.map((warning) => warning.message),
    signature,
  };
}

export function describeSelectionMaskPersistence(
  mask: SelectionMask,
  options: SelectionMaskPersistenceDescriptorOptions = {},
): SelectionMaskPersistenceDescriptor {
  const label = normalizeOverlayLabel(options.label);
  const hasSelection = !isMaskEmpty(mask);
  const partialAlpha = mask.data.some((value) => value > 0 && value < 255);
  const storageTarget = options.storageTarget ?? 'saved-selection-alpha-channel';
  const warnings: SelectionMaskPersistenceWarning[] = [{
    code: 'selection-mask-saved-selection-metadata-only',
    severity: 'warning',
    message: 'Saved-selection round-trip is represented as alpha-mask metadata; native channel UI/export is not modeled here.',
  }];

  return {
    kind: 'selection-mask-persistence',
    label,
    storageTarget,
    loadTarget: 'document-selection',
    roundTrip: 'lossless-alpha-mask',
    hasSelection,
    partialAlpha,
    warnings,
    signature: `selection-mask-persistence:v1:${JSON.stringify({
      label,
      storageTarget,
      loadTarget: 'document-selection',
      roundTrip: 'lossless-alpha-mask',
      hasSelection,
      partialAlpha,
      warnings: warnings.map((warning) => warning.code),
    })}`,
  };
}

/**
 * Rasterize a rectangle into a mask. Coordinates are in document pixel space.
 * If antiAlias is true, fractional pixel coverage is computed for the edges.
 */
export function setRect(
  mask: SelectionMask,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 255,
  antiAlias = true,
): void {
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(mask.width, Math.ceil(x + w));
  const y1 = Math.min(mask.height, Math.ceil(y + h));

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      let coverage = 1;
      if (antiAlias) {
        const cx = Math.max(x, px);
        const cxEnd = Math.min(x + w, px + 1);
        const cy = Math.max(y, py);
        const cyEnd = Math.min(y + h, py + 1);
        coverage = Math.max(0, cxEnd - cx) * Math.max(0, cyEnd - cy);
      }
      const value = Math.round(alpha * coverage);
      if (value > 0) {
        const idx = py * mask.width + px;
        if (value > mask.data[idx]) mask.data[idx] = value;
      }
    }
  }
}

/**
 * Rasterize an axis-aligned ellipse into a mask. (cx, cy) is the center,
 * (rx, ry) the radii. Anti-aliased by sampling distance from center.
 */
export function setEllipse(
  mask: SelectionMask,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha = 255,
  antiAlias = true,
): void {
  const ax = Math.abs(rx);
  const ay = Math.abs(ry);
  if (ax <= 0 || ay <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - ax));
  const y0 = Math.max(0, Math.floor(cy - ay));
  const x1 = Math.min(mask.width, Math.ceil(cx + ax));
  const y1 = Math.min(mask.height, Math.ceil(cy + ay));

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const dx = (px + 0.5 - cx) / ax;
      const dy = (py + 0.5 - cy) / ay;
      const dist = dx * dx + dy * dy;
      let coverage: number;
      if (antiAlias) {
        // Smooth edge over ~one pixel using radial distance.
        coverage = 1 - smoothstep(1 - 1 / Math.max(ax, ay), 1, dist);
      } else {
        coverage = dist <= 1 ? 1 : 0;
      }
      if (coverage > 0) {
        const value = Math.round(alpha * coverage);
        const idx = py * mask.width + px;
        if (value > mask.data[idx]) mask.data[idx] = value;
      }
    }
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Rasterize a closed polygon (array of vertices) into a mask using the
 * scanline algorithm. Polygon is auto-closed (first vertex implicitly equals
 * last vertex). Even-odd fill rule.
 */
export function setPolygon(
  mask: SelectionMask,
  points: Point[],
  alpha = 255,
): void {
  if (points.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(mask.height - 1, Math.ceil(maxY));

  const n = points.length;
  for (let py = y0; py <= y1; py += 1) {
    const sampleY = py + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const ya = a.y;
      const yb = b.y;
      // crossing test: skip horizontal edges; include if scanline strictly between ya/yb
      if (ya === yb) continue;
      const enters = ya < sampleY && yb >= sampleY;
      const exits = yb < sampleY && ya >= sampleY;
      if (!enters && !exits) continue;
      const t = (sampleY - ya) / (yb - ya);
      xs.push(a.x + t * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const startX = Math.max(0, Math.floor(xs[k]));
      const endX = Math.min(mask.width - 1, Math.ceil(xs[k + 1]) - 1);
      for (let px = startX; px <= endX; px += 1) {
        const idx = py * mask.width + px;
        if (alpha > mask.data[idx]) mask.data[idx] = alpha;
      }
    }
  }
}

/**
 * Flood-fill selection driven by an RGBA pixel source. (x,y) seeds the fill;
 * pixels are added to the selection if their RGB-distance from the seed
 * falls within `tolerance` (0-255). Uses an iterative scanline flood-fill.
 */
export function setFloodFill(
  mask: SelectionMask,
  source: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
  alphaOrContiguous: number | boolean = 255,
  contiguous = true,
): void {
  if (
    source.width !== mask.width ||
    source.height !== mask.height ||
    seedX < 0 ||
    seedY < 0 ||
    seedX >= mask.width ||
    seedY >= mask.height
  ) {
    return;
  }

  const width = mask.width;
  const height = mask.height;
  const px = source.data;
  const seedIdx = (seedY * width + seedX) * 4;
  const sr = px[seedIdx];
  const sg = px[seedIdx + 1];
  const sb = px[seedIdx + 2];
  const tol2 = tolerance * tolerance;
  const alpha = typeof alphaOrContiguous === 'number' ? alphaOrContiguous : 255;
  const useContiguous = typeof alphaOrContiguous === 'boolean' ? alphaOrContiguous : contiguous;

  if (!useContiguous) {
    for (let cy = 0; cy < height; cy += 1) {
      for (let cx = 0; cx < width; cx += 1) {
        const flatIdx = cy * width + cx;
        if (matchesSeedColor(flatIdx)) {
          if (alpha > mask.data[flatIdx]) mask.data[flatIdx] = alpha;
        }
      }
    }
    return;
  }

  const visited = new Uint8Array(width * height);
  const stack: [number, number][] = [[seedX, seedY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    let leftX = x;
    while (leftX >= 0 && matches(leftX, y)) leftX -= 1;
    leftX += 1;
    let rightX = x;
    while (rightX < width && matches(rightX, y)) rightX += 1;
    rightX -= 1;
    for (let cx = leftX; cx <= rightX; cx += 1) {
      const flatIdx = y * width + cx;
      visited[flatIdx] = 1;
      if (alpha > mask.data[flatIdx]) mask.data[flatIdx] = alpha;
      if (y > 0 && !visited[(y - 1) * width + cx] && matches(cx, y - 1)) {
        stack.push([cx, y - 1]);
      }
      if (y < height - 1 && !visited[(y + 1) * width + cx] && matches(cx, y + 1)) {
        stack.push([cx, y + 1]);
      }
    }
  }

  function matches(cx: number, cy: number): boolean {
    const idx = cy * width + cx;
    if (visited[idx]) return false;
    return matchesSeedColor(idx);
  }

  function matchesSeedColor(idx: number): boolean {
    const off = idx * 4;
    const dr = px[off] - sr;
    const dg = px[off + 1] - sg;
    const db = px[off + 2] - sb;
    return dr * dr + dg * dg + db * db <= tol2;
  }
}

/**
 * Compute the bounding box of selected pixels (any non-zero alpha).
 * Returns null if the mask is empty.
 */
export function maskBoundingBox(
  mask: SelectionMask,
): { x: number; y: number; width: number; height: number } | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  const data = mask.data;
  const width = mask.width;
  for (let y = 0; y < mask.height; y += 1) {
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      if (data[rowStart + x] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Render the mask into an OffscreenCanvas with the supplied paint color
 * (defaults to white) using the mask's alpha. Useful for composite passes
 * (per-layer masking, AI mask transmission, marching-ants edge overlays).
 */
export function maskToCanvas(
  mask: SelectionMask,
  paintR = 255,
  paintG = 255,
  paintB = 255,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(mask.width, mask.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context for mask render');
  const imageData = ctx.createImageData(mask.width, mask.height);
  const out = imageData.data;
  const src = mask.data;
  for (let i = 0; i < src.length; i += 1) {
    const off = i * 4;
    out[off] = paintR;
    out[off + 1] = paintG;
    out[off + 2] = paintB;
    out[off + 3] = src[i];
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function summarizeMaskAlpha(mask: SelectionMask): SelectionMaskAlphaSummary {
  let transparentPixels = 0;
  let partialPixels = 0;
  let fullPixels = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  let alphaTotal = 0;

  for (let index = 0; index < mask.data.length; index += 1) {
    const alpha = mask.data[index];
    if (alpha === 0) {
      transparentPixels += 1;
    } else if (alpha === 255) {
      fullPixels += 1;
    } else {
      partialPixels += 1;
    }
    if (alpha < minAlpha) minAlpha = alpha;
    if (alpha > maxAlpha) maxAlpha = alpha;
    alphaTotal += alpha;
  }

  if (mask.data.length === 0) {
    minAlpha = 0;
  }

  return {
    transparentPixels,
    partialPixels,
    fullPixels,
    minAlpha,
    maxAlpha,
    averageAlpha: roundTo(alphaTotal / Math.max(1, mask.data.length), 2),
  };
}

function buildSelectionMaskOverlayDisplay(
  options: SelectionMaskOverlayDescriptorOptions,
): SelectionMaskOverlayDisplayDescriptor {
  const opacity = normalizeOpacity(options.opacity);
  const featherPx = normalizeFeatherPx(options.featherPx);
  return {
    tintColor: normalizeTintColor(options.tintColor),
    opacity,
    opacityLabel: `${Math.round(opacity * 100)}%`,
    featherPx,
    featherLabel: featherPx === 0 ? '0 px' : `${formatFixedDecimal(featherPx)} px`,
  };
}

function buildSelectionMaskOverlayWarnings(featherPx: number): SelectionMaskOverlayWarning[] {
  const warnings: SelectionMaskOverlayWarning[] = [];
  if (featherPx > 0) {
    warnings.push({
      code: 'selection-mask-feather-display-only',
      severity: 'warning',
      message: 'Feather is displayed as descriptor metadata; this helper does not blur or mutate mask pixels.',
    });
  }
  warnings.push({
    code: 'selection-mask-richer-visualization-unsupported',
    severity: 'warning',
    message: 'Advanced marching-ants animation, per-edge colorization, and channel-specific matte views are not represented by this descriptor.',
  });
  return warnings;
}

function normalizeOverlayLabel(label: string | undefined): string {
  const normalized = label?.trim();
  return normalized && normalized.length > 0 ? normalized : 'Selection Mask';
}

function normalizeTintColor(color: string | undefined): string {
  const normalized = color?.trim().toLowerCase();
  if (normalized && /^#[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }
  if (normalized && /^#[0-9a-f]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  return '#ff0000';
}

function normalizeOpacity(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return roundTo(Math.max(0, Math.min(1, value)), 3);
}

function normalizeFeatherPx(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return roundTo(value, 2);
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function formatFixedDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
