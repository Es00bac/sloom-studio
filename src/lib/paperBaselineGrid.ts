import type { PaperBaselineGridSpec } from '../types/paper';

const PT_PER_MM = 72 / 25.4;

export function snapPaperBaselinePt(baselinePt: number, grid: PaperBaselineGridSpec | undefined): number {
  if (!grid || !(grid.incrementMm > 0)) return baselinePt;
  const startPt = grid.startMm * PT_PER_MM;
  const incrementPt = grid.incrementMm * PT_PER_MM;
  return startPt + Math.max(0, Math.ceil((baselinePt - startPt - 1e-7) / incrementPt)) * incrementPt;
}

/** CSS/native fallback leading that lands every subsequent baseline on a grid line. */
export function resolvePaperBaselineLeadingPt(leadingPt: number, grid: PaperBaselineGridSpec | undefined): number {
  if (!grid || !(grid.incrementMm > 0)) return leadingPt;
  const incrementPt = grid.incrementMm * PT_PER_MM;
  return Math.max(incrementPt, Math.ceil((leadingPt - 1e-7) / incrementPt) * incrementPt);
}

/** Extra top inset for CSS text, using the same 0.8 line-box baseline model as managed composition. */
export function resolvePaperBaselineTopInsetMm(
  contentTopMm: number,
  leadingPt: number,
  grid: PaperBaselineGridSpec | undefined,
): number {
  if (!grid || !(grid.incrementMm > 0)) return 0;
  const baselinePt = contentTopMm * PT_PER_MM + leadingPt * 0.8;
  return Math.max(0, (snapPaperBaselinePt(baselinePt, grid) - baselinePt) / PT_PER_MM);
}
