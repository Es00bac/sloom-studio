// Pure geometry for text-on-a-path (an arched baseline). Given a frame's pixel box and a curvature
// percentage, it returns the SVG path `d` the renderer feeds to <textPath>. Framework-free + testable.
// Positive curvature arcs the baseline up (rainbow); negative arcs it down (valley); 0 = straight.

export interface PaperTextArcPath {
  d: string;
}

/** SVG quadratic-arc path for the text baseline, or null when the text should stay straight. */
export function buildPaperTextArcPath(widthPx: number, heightPx: number, arcPercent: number): PaperTextArcPath | null {
  const amount = Math.max(-100, Math.min(100, arcPercent)) / 100;
  if (amount === 0 || widthPx <= 0 || heightPx <= 0) return null;

  const inset = Math.min(widthPx * 0.04, 8);
  const midY = heightPx / 2;
  const endY = midY + amount * heightPx * 0.18;
  const controlY = midY - amount * heightPx * 0.5;
  const d = `M ${inset.toFixed(2)} ${endY.toFixed(2)} Q ${(widthPx / 2).toFixed(2)} ${controlY.toFixed(2)} ${(widthPx - inset).toFixed(2)} ${endY.toFixed(2)}`;
  return { d };
}
