import type { PaperSpread } from './paperSpreads';

export interface PaperSpreadVirtualMetric {
  id: string;
  topPx: number;
  heightPx: number;
  widthPx: number;
  visible: boolean;
}

export interface PaperSpreadVirtualWindowOptions {
  spreads: PaperSpread[];
  pageWidthMm: number;
  pageHeightMm: number;
  pxPerMm: number;
  zoom: number;
  pasteboardPaddingPx: number;
  rulerHeightPx?: number;
  gapPx?: number;
  viewportTopPx: number;
  viewportHeightPx: number;
  overscanPx?: number;
  activePageIds?: string[];
}

export function buildPaperSpreadVirtualWindow({
  spreads,
  pageWidthMm,
  pageHeightMm,
  pxPerMm,
  zoom,
  pasteboardPaddingPx,
  rulerHeightPx = 0,
  gapPx = 0,
  viewportTopPx,
  viewportHeightPx,
  overscanPx = 800,
  activePageIds = [],
}: PaperSpreadVirtualWindowOptions): PaperSpreadVirtualMetric[] {
  const safeZoom = Math.max(0.01, zoom);
  const pageWidthPx = Math.max(1, pageWidthMm * pxPerMm * safeZoom);
  const pageHeightPx = Math.max(1, pageHeightMm * pxPerMm * safeZoom);
  const viewportTop = Math.max(0, viewportTopPx);
  const viewportBottom = viewportTop + Math.max(1, viewportHeightPx);
  const visibleTop = Math.max(0, viewportTop - Math.max(0, overscanPx));
  const visibleBottom = viewportBottom + Math.max(0, overscanPx);
  const activePages = new Set(activePageIds.filter(Boolean));
  let topPx = 0;

  return spreads.map((spread, index) => {
    const slotCount = Math.max(1, spread.slots.length);
    const heightPx = pageHeightPx + pasteboardPaddingPx * 2 + rulerHeightPx;
    const widthPx = pageWidthPx * slotCount + pasteboardPaddingPx * 2;
    const bottomPx = topPx + heightPx;
    const hasActivePage = spread.slots.some((slot) => slot.page?.id && activePages.has(slot.page.id));
    const visible = hasActivePage || bottomPx >= visibleTop && topPx <= visibleBottom || spreads.length <= 4;
    const metric: PaperSpreadVirtualMetric = {
      id: spread.id,
      topPx,
      heightPx,
      widthPx,
      visible,
    };

    topPx = bottomPx + (index < spreads.length - 1 ? Math.max(0, gapPx) : 0);
    return metric;
  });
}
