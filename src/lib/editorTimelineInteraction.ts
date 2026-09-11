import type { TimelineAutomationPoint } from '../types/flow';

export interface TimelineInteractionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function resizeTimelineTrackHeight(
  startHeight: number,
  startClientY: number,
  currentClientY: number,
): number {
  return Math.round(startHeight + currentClientY - startClientY);
}

export function buildTimelineOpacityPoint(
  bounds: TimelineInteractionRect,
  clientX: number,
  clientY: number,
): TimelineAutomationPoint {
  const safeWidth = Math.max(1, bounds.width);
  const safeHeight = Math.max(1, bounds.height);

  return {
    timePercent: clampPercent(((clientX - bounds.left) / safeWidth) * 100),
    valuePercent: clampPercent(100 - ((clientY - bounds.top) / safeHeight) * 100),
  };
}

export function isPrimaryTimelinePointerButton(button: number): boolean {
  return button === 0;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
