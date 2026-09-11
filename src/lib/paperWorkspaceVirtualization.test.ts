import { describe, expect, it } from 'vitest';
import type { PaperSpread } from './paperSpreads';
import { buildPaperSpreadVirtualWindow } from './paperWorkspaceVirtualization';

function makeSpread(id: string, pageId: string): PaperSpread {
  return {
    id,
    slots: [{ side: 'right', label: 'Single page', page: { id: pageId, pageNumber: Number(pageId.replace('page-', '')), frames: [], guides: [] } }],
  };
}

const spreads = Array.from({ length: 20 }, (_, index) => makeSpread(`spread-${index + 1}`, `page-${index + 1}`));

describe('paper workspace virtualization', () => {
  it('marks only viewport-near spreads visible while preserving all metrics', () => {
    const window = buildPaperSpreadVirtualWindow({
      spreads,
      pageWidthMm: 170,
      pageHeightMm: 260,
      pxPerMm: 3,
      zoom: 1,
      pasteboardPaddingPx: 160,
      gapPx: 40,
      viewportTopPx: 0,
      viewportHeightPx: 900,
      overscanPx: 300,
    });

    expect(window).toHaveLength(20);
    expect(window[0].visible).toBe(true);
    expect(window[1].visible).toBe(true);
    expect(window[4].visible).toBe(false);
    expect(window[1].topPx).toBe(window[0].heightPx + 40);
  });

  it('keeps the selected or actively edited page mounted outside the viewport', () => {
    const window = buildPaperSpreadVirtualWindow({
      spreads,
      pageWidthMm: 170,
      pageHeightMm: 260,
      pxPerMm: 3,
      zoom: 1,
      pasteboardPaddingPx: 160,
      gapPx: 40,
      viewportTopPx: 0,
      viewportHeightPx: 700,
      overscanPx: 100,
      activePageIds: ['page-18'],
    });

    expect(window[17].visible).toBe(true);
    expect(window[16].visible).toBe(false);
  });

  it('accounts for zoom, pasteboard, and ruler height in placeholder sizing', () => {
    const [metric] = buildPaperSpreadVirtualWindow({
      spreads: [spreads[0]],
      pageWidthMm: 100,
      pageHeightMm: 200,
      pxPerMm: 2,
      zoom: 1.5,
      pasteboardPaddingPx: 40,
      rulerHeightPx: 25,
      viewportTopPx: 0,
      viewportHeightPx: 1,
    });

    expect(metric.widthPx).toBe(380);
    expect(metric.heightPx).toBe(705);
  });
});
