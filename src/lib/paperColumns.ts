import type { PaperFrame } from '../types/paper';
import type { PaperTextFlowColumn } from './paperTextFlow';

export const DEFAULT_PAPER_COLUMN_GUTTER_MM = 5;

export function resolvePaperColumnCount(frame: Pick<PaperFrame, 'columns'>): number {
  return Math.max(1, Math.round(frame.columns || 1));
}

export function resolvePaperColumnGutterMm(frame: Pick<PaperFrame, 'columnGutterMm'>): number {
  const gutter = frame.columnGutterMm;
  return gutter !== undefined && Number.isFinite(gutter) && gutter >= 0 ? gutter : DEFAULT_PAPER_COLUMN_GUTTER_MM;
}

/**
 * Column boxes (mm) within a text frame's content area, origin at the frame's top-left after the
 * given padding. Used by the renderer for column metrics and by `paperTextFlow` to flow text through
 * a frame's columns (and, with threading, on into the next frame).
 */
export function resolvePaperTextColumns(
  frame: Pick<PaperFrame, 'columns' | 'columnGutterMm' | 'widthMm' | 'heightMm'>,
  paddingMm = 0,
): PaperTextFlowColumn[] {
  const count = resolvePaperColumnCount(frame);
  const gutter = resolvePaperColumnGutterMm(frame);
  const contentWidth = Math.max(0, frame.widthMm - paddingMm * 2);
  const contentHeight = Math.max(0, frame.heightMm - paddingMm * 2);
  const columnWidth = Math.max(0, (contentWidth - gutter * (count - 1)) / count);

  return Array.from({ length: count }, (_, index) => ({
    xMm: paddingMm + index * (columnWidth + gutter),
    yMm: paddingMm,
    widthMm: columnWidth,
    heightMm: contentHeight,
  }));
}
