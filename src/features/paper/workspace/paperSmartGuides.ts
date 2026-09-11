export interface PaperSmartGuideRect {
  id: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

export interface PaperSmartGuideLine {
  orientation: 'vertical' | 'horizontal';
  positionMm: number;
  startMm: number;
  endMm: number;
  target: 'page' | 'margin' | 'object';
}

export interface PaperSmartGuideSnapResult {
  deltaXMm: number;
  deltaYMm: number;
  guides: PaperSmartGuideLine[];
}

interface PaperSmartGuideSnapInput {
  moving: PaperSmartGuideRect;
  candidates: PaperSmartGuideRect[];
  pageWidthMm: number;
  pageHeightMm: number;
  marginsMm?: { top: number; right: number; bottom: number; left: number };
  toleranceMm: number;
}

type AxisTarget = {
  positionMm: number;
  startMm: number;
  endMm: number;
  target: PaperSmartGuideLine['target'];
};

/** Candidate projection shared with canvas paint: visible locals plus visible inherited items. */
export function resolvePaperSmartGuideCandidates(
  document: PaperDocument,
  page: PaperPage,
  movingIds: ReadonlySet<string>,
): PaperFrame[] {
  return resolvePaperPageFramesForCanvas(document, page)
    .filter((frame) => !movingIds.has(frame.id));
}

/** Snap the nearest moving edge/center to page, margin, or neighboring-object geometry. */
export function resolvePaperSmartGuideSnap(input: PaperSmartGuideSnapInput): PaperSmartGuideSnapResult {
  const toleranceMm = Math.max(0, input.toleranceMm);
  const movingX = axisAnchors(input.moving.xMm, input.moving.widthMm);
  const movingY = axisAnchors(input.moving.yMm, input.moving.heightMm);
  const xTargets = pageAxisTargets(input.pageWidthMm, input.pageHeightMm, input.marginsMm?.left, input.marginsMm?.right)
    .concat(input.candidates.flatMap((candidate) => objectAxisTargets(candidate, 'x')));
  const yTargets = pageAxisTargets(input.pageHeightMm, input.pageWidthMm, input.marginsMm?.top, input.marginsMm?.bottom)
    .concat(input.candidates.flatMap((candidate) => objectAxisTargets(candidate, 'y')));
  const xMatch = nearestAxisMatch(movingX, xTargets, toleranceMm);
  const yMatch = nearestAxisMatch(movingY, yTargets, toleranceMm);
  const guides: PaperSmartGuideLine[] = [];

  if (xMatch) {
    guides.push({
      orientation: 'vertical',
      positionMm: xMatch.target.positionMm,
      startMm: Math.min(input.moving.yMm, xMatch.target.startMm),
      endMm: Math.max(input.moving.yMm + input.moving.heightMm, xMatch.target.endMm),
      target: xMatch.target.target,
    });
  }
  if (yMatch) {
    guides.push({
      orientation: 'horizontal',
      positionMm: yMatch.target.positionMm,
      startMm: Math.min(input.moving.xMm, yMatch.target.startMm),
      endMm: Math.max(input.moving.xMm + input.moving.widthMm, yMatch.target.endMm),
      target: yMatch.target.target,
    });
  }

  return {
    deltaXMm: xMatch?.deltaMm ?? 0,
    deltaYMm: yMatch?.deltaMm ?? 0,
    guides,
  };
}

function axisAnchors(startMm: number, sizeMm: number): number[] {
  return [startMm, startMm + sizeMm / 2, startMm + sizeMm];
}

function pageAxisTargets(
  pageSizeMm: number,
  crossSizeMm: number,
  leadingMarginMm?: number,
  trailingMarginMm?: number,
): AxisTarget[] {
  const result: AxisTarget[] = [
    { positionMm: 0, startMm: 0, endMm: crossSizeMm, target: 'page' },
    { positionMm: pageSizeMm / 2, startMm: 0, endMm: crossSizeMm, target: 'page' },
    { positionMm: pageSizeMm, startMm: 0, endMm: crossSizeMm, target: 'page' },
  ];
  if (leadingMarginMm !== undefined) {
    result.push({ positionMm: leadingMarginMm, startMm: 0, endMm: crossSizeMm, target: 'margin' });
  }
  if (trailingMarginMm !== undefined) {
    result.push({ positionMm: pageSizeMm - trailingMarginMm, startMm: 0, endMm: crossSizeMm, target: 'margin' });
  }
  return result;
}

function objectAxisTargets(rect: PaperSmartGuideRect, axis: 'x' | 'y'): AxisTarget[] {
  if (axis === 'x') {
    return axisAnchors(rect.xMm, rect.widthMm).map((positionMm) => ({
      positionMm,
      startMm: rect.yMm,
      endMm: rect.yMm + rect.heightMm,
      target: 'object' as const,
    }));
  }
  return axisAnchors(rect.yMm, rect.heightMm).map((positionMm) => ({
    positionMm,
    startMm: rect.xMm,
    endMm: rect.xMm + rect.widthMm,
    target: 'object' as const,
  }));
}

function nearestAxisMatch(
  movingAnchors: number[],
  targets: AxisTarget[],
  toleranceMm: number,
): { deltaMm: number; target: AxisTarget } | undefined {
  let best: { deltaMm: number; target: AxisTarget; distance: number } | undefined;
  for (const moving of movingAnchors) {
    for (const target of targets) {
      const deltaMm = target.positionMm - moving;
      const distance = Math.abs(deltaMm);
      if (distance > toleranceMm) continue;
      if (!best || distance < best.distance || (distance === best.distance && targetPriority(target) < targetPriority(best.target))) {
        best = { deltaMm, target, distance };
      }
    }
  }
  return best ? { deltaMm: roundMm(best.deltaMm), target: best.target } : undefined;
}

function targetPriority(target: AxisTarget): number {
  return target.target === 'object' ? 0 : target.target === 'margin' ? 1 : 2;
}

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}
import type { PaperDocument, PaperFrame, PaperPage } from '../../../types/paper';
import { resolvePaperPageFramesForCanvas } from '../../../lib/paperDocument';
