import { describe, expect, it, vi } from 'vitest';
import {
  buildTextOverlaySvg,
  buildTextOverlaySvgAsset,
  measureTextObjectBounds,
} from './editorTextRender';

describe('buildTextOverlaySvg', () => {
  it('renders timeline text as transparent free text instead of a containing card', () => {
    const svg = buildTextOverlaySvg({
      text: 'Lower third',
      fontFamily: 'Inter',
      fontSizePx: 72,
      color: '#f8fafc',
      effect: 'shadow',
      opacityPercent: 85,
    });

    expect(svg).toContain('Lower third');
    expect(svg).toContain('background:transparent');
    expect(svg).toContain('white-space:pre');
    expect(svg).not.toContain('border-radius');
    expect(svg).not.toContain('rgba(11,12,16');
    expect(svg).not.toContain('Title Card');
  });

  it('sizes the text image to the text object instead of the full video canvas', () => {
    const bounds = measureTextObjectBounds({
      text: 'Scale me',
      fontSizePx: 80,
    });
    const svg = buildTextOverlaySvg({
      text: 'Scale me',
      fontFamily: 'Inter',
      fontSizePx: 80,
      color: '#ffffff',
      effect: 'none',
      opacityPercent: 100,
    });

    expect(bounds.width).toBeLessThan(1280);
    expect(bounds.height).toBeLessThan(720);
    expect(svg).toContain(`width="${bounds.width}"`);
    expect(svg).toContain(`height="${bounds.height}"`);
    expect(svg).not.toContain('width="1280" height="720"');
  });

  it('reserves enough raster width for long animated text so scaled renders do not clip glyphs', () => {
    const bounds = measureTextObjectBounds({
      text: 'Thanks for watching',
      fontSizePx: 72,
      effect: 'none',
      fontFamily: 'Inter, system-ui, sans-serif',
    });

    expect(bounds.width).toBeGreaterThan(72 * 11);
  });

  it('returns the exact bounds used by the rendered text SVG', () => {
    const asset = buildTextOverlaySvgAsset({
      text: 'Thanks for watching',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePx: 72,
      color: '#a7f3d0',
      effect: 'glow',
      opacityPercent: 100,
    });

    expect(asset.svg).toContain(`width="${asset.bounds.width}"`);
    expect(asset.svg).toContain(`height="${asset.bounds.height}"`);
  });

  it('quotes multi-word families in the SVG font-family and canvas measurer (FBL-012)', () => {
    const svg = buildTextOverlaySvg({
      text: 'Title',
      fontFamily: 'M PLUS 1, Inter, sans-serif',
      fontSizePx: 72,
      color: '#ffffff',
      effect: 'none',
      opacityPercent: 100,
    });

    expect(svg).toContain('font-family:&quot;M PLUS 1&quot;, Inter, sans-serif');

    const ctx = { font: '', measureText: () => ({ width: 0 }) };
    const canvas = { getContext: vi.fn(() => ctx) };
    vi.stubGlobal('document', { createElement: () => canvas });

    measureTextObjectBounds({
      text: 'Title',
      fontFamily: 'M PLUS 1, Inter, sans-serif',
      fontSizePx: 72,
    });

    expect(canvas.getContext).toHaveBeenCalledWith('2d');
    expect(ctx.font).toContain('"M PLUS 1"');
    vi.unstubAllGlobals();
  });
});
