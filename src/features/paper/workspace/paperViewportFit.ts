import { MAX_PAPER_ZOOM, MIN_PAPER_ZOOM, PAPER_SCREEN_PX_PER_MM } from '../../../lib/paperLayoutTools';

export type PaperViewportFitMode = 'page' | 'spread';

export interface PaperViewportFitInput {
  mode: PaperViewportFitMode;
  viewportWidthPx: number;
  viewportHeightPx: number;
  pageWidthMm: number;
  pageHeightMm: number;
  spreadPageCount?: number;
  gapPx?: number;
  paddingPx?: number;
}

/** Resolve a bounded zoom that keeps the complete trim page/spread visible in the real canvas viewport. */
export function resolvePaperViewportFitZoom(input: PaperViewportFitInput): number {
  const paddingPx = Math.max(0, input.paddingPx ?? 72);
  const gapPx = Math.max(0, input.gapPx ?? 12);
  const pageCount = input.mode === 'spread'
    ? Math.max(1, Math.min(2, Math.round(input.spreadPageCount ?? 2)))
    : 1;
  const contentWidthPx = input.pageWidthMm * PAPER_SCREEN_PX_PER_MM * pageCount + gapPx * (pageCount - 1);
  const contentHeightPx = input.pageHeightMm * PAPER_SCREEN_PX_PER_MM;
  const availableWidthPx = Math.max(1, input.viewportWidthPx - paddingPx);
  const availableHeightPx = Math.max(1, input.viewportHeightPx - paddingPx);
  const fit = Math.min(availableWidthPx / contentWidthPx, availableHeightPx / contentHeightPx);
  return round(Math.max(MIN_PAPER_ZOOM, Math.min(MAX_PAPER_ZOOM, fit)));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
