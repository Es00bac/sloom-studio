// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTextOverlaySvgAsset } from './editorTextRender';

describe('buildTextOverlaySvgAsset XML correctness', () => {
  beforeEach(() => {
    const ctx = { font: '', measureText: () => ({ width: 0 }) };
    const canvas = { getContext: vi.fn(() => ctx) };
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses as valid SVG/XML when the family stack contains multi-word names', () => {
    const asset = buildTextOverlaySvgAsset({
      text: 'Title',
      fontFamily: 'M PLUS 1, Inter, sans-serif',
      fontSizePx: 72,
      color: '#ffffff',
      effect: 'none',
      opacityPercent: 100,
    });

    const doc = new DOMParser().parseFromString(asset.svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();

    const innerDiv = doc.querySelector('div[xmlns="http://www.w3.org/1999/xhtml"] > div');
    const style = innerDiv?.getAttribute('style') ?? '';
    expect(style).toContain('font-family:"M PLUS 1", Inter, sans-serif');
  });
});
