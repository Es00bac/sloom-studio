import { describe, expect, it } from 'vitest';
import { resolvePaperViewportFitZoom } from './paperViewportFit';

describe('Paper viewport fitting', () => {
  it('fits a whole page and reduces the zoom when a spread is width-constrained', () => {
    const page = resolvePaperViewportFitZoom({
      mode: 'page',
      viewportWidthPx: 1000,
      viewportHeightPx: 880,
      pageWidthMm: 210,
      pageHeightMm: 297,
    });
    const spread = resolvePaperViewportFitZoom({
      mode: 'spread',
      viewportWidthPx: 1000,
      viewportHeightPx: 880,
      pageWidthMm: 210,
      pageHeightMm: 297,
      spreadPageCount: 2,
    });

    expect(page).toBeGreaterThan(spread);
    expect(page).toBeLessThanOrEqual(3);
    expect(spread).toBeGreaterThanOrEqual(0.15);
  });

  it('treats a single-page spread as a page and clamps tiny viewports', () => {
    expect(resolvePaperViewportFitZoom({
      mode: 'spread',
      viewportWidthPx: 1000,
      viewportHeightPx: 800,
      pageWidthMm: 148,
      pageHeightMm: 210,
      spreadPageCount: 1,
    })).toBe(resolvePaperViewportFitZoom({
      mode: 'page',
      viewportWidthPx: 1000,
      viewportHeightPx: 800,
      pageWidthMm: 148,
      pageHeightMm: 210,
    }));
    expect(resolvePaperViewportFitZoom({
      mode: 'page',
      viewportWidthPx: 40,
      viewportHeightPx: 40,
      pageWidthMm: 210,
      pageHeightMm: 297,
    })).toBe(0.15);
  });
});
