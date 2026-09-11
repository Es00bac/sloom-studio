import type { ImageGuide } from '../../types/imageEditor';

// Pure geometry for the Image workspace's rulers, grid, and guides. Kept free of
// React/canvas so the tick/line/snap math can be unit-tested directly.

export interface ImageViewSettings {
  /** Show the horizontal + vertical rulers around the canvas. */
  rulers: boolean;
  /** Draw the document grid overlay. */
  grid: boolean;
  /** Show ruler guides (the draggable lines). */
  guides: boolean;
  /** Grid spacing in document pixels. */
  gridSpacing: number;
  /** Snap new/moved guides (and grid-aware actions) to the grid. */
  snap: boolean;
}

export const DEFAULT_IMAGE_VIEW_SETTINGS: ImageViewSettings = {
  rulers: false,
  grid: false,
  guides: true,
  gridSpacing: 50,
  snap: true,
};

export const IMAGE_VIEW_TOGGLE_KEYS = ['rulers', 'grid', 'guides', 'snap'] as const;
export type ImageViewToggleKey = (typeof IMAGE_VIEW_TOGGLE_KEYS)[number];

export const MIN_GRID_SPACING = 2;
export const MAX_GRID_SPACING = 2000;

export function clampGridSpacing(spacing: number): number {
  if (!Number.isFinite(spacing)) return DEFAULT_IMAGE_VIEW_SETTINGS.gridSpacing;
  return Math.min(MAX_GRID_SPACING, Math.max(MIN_GRID_SPACING, Math.round(spacing)));
}

// "Nice" 1/2/5 × 10ⁿ steps so ruler ticks land on round document values.
const NICE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];

/**
 * Choose a ruler tick interval (in document pixels) so that minor ticks are at
 * least `minScreenGap` device-independent pixels apart at the current zoom.
 */
export function chooseRulerStep(zoom: number, minScreenGap = 56): number {
  const safeZoom = zoom > 0 ? zoom : 1;
  const target = minScreenGap / safeZoom;
  for (const step of NICE_STEPS) {
    if (step >= target) return step;
  }
  return NICE_STEPS[NICE_STEPS.length - 1];
}

export interface RulerTick {
  /** Position along the ruler in screen (container-local) pixels. */
  screen: number;
  /** Document coordinate value at this tick. */
  value: number;
  /** Major ticks get a label and a longer mark. */
  major: boolean;
}

/**
 * Generate ruler ticks spanning `[0, lengthPx)` of screen space for one axis.
 * `pan` and `zoom` come from the document viewport (panX/panY per axis).
 */
export function generateRulerTicks(
  lengthPx: number,
  pan: number,
  zoom: number,
  minScreenGap = 56,
): RulerTick[] {
  if (lengthPx <= 0 || !(zoom > 0)) return [];
  const step = chooseRulerStep(zoom, minScreenGap);
  const majorEvery = 5; // every 5th tick is a labelled major
  const docStart = (0 - pan) / zoom;
  const docEnd = (lengthPx - pan) / zoom;
  const firstIndex = Math.floor(docStart / step);
  const lastIndex = Math.ceil(docEnd / step);
  const ticks: RulerTick[] = [];
  for (let i = firstIndex; i <= lastIndex; i += 1) {
    const value = i * step;
    const screen = value * zoom + pan;
    if (screen < -1 || screen > lengthPx + 1) continue;
    ticks.push({ screen, value, major: i % majorEvery === 0 });
  }
  return ticks;
}

/** Grid line document positions within the document bounds (excludes 0 and the far edge). */
export function generateGridLines(
  documentWidth: number,
  documentHeight: number,
  spacing: number,
): { xs: number[]; ys: number[] } {
  const step = clampGridSpacing(spacing);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = step; x < documentWidth; x += step) xs.push(x);
  for (let y = step; y < documentHeight; y += step) ys.push(y);
  return { xs, ys };
}

/** Snap a document coordinate to the nearest grid line when snapping is enabled. */
export function snapGuidePosition(value: number, settings: ImageViewSettings): number {
  if (!settings.snap) return Math.round(value);
  const step = clampGridSpacing(settings.gridSpacing);
  return Math.round(value / step) * step;
}

/** Find an existing guide within `tolerance` document px of `position` on `axis`. */
export function findGuideNear(
  guides: readonly ImageGuide[],
  axis: ImageGuide['axis'],
  position: number,
  tolerance: number,
): ImageGuide | null {
  let best: ImageGuide | null = null;
  let bestDist = tolerance;
  for (const guide of guides) {
    if (guide.axis !== axis) continue;
    const dist = Math.abs(guide.position - position);
    if (dist <= bestDist) {
      best = guide;
      bestDist = dist;
    }
  }
  return best;
}

let guideCounter = 0;
export function createImageGuide(axis: ImageGuide['axis'], position: number): ImageGuide {
  guideCounter += 1;
  return { id: `guide-${Date.now()}-${guideCounter}`, axis, position: Math.round(position) };
}
