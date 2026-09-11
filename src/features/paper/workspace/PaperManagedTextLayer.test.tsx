// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaperManagedTextLayer } from './PaperManagedTextLayer';
import type { PaperComposedTextFrame } from '../../../lib/paperTextComposition';
import type { PaperManagedFontFace } from '../../../types/paper';
import type { BinaryAssetRef } from '../../../shared/assets/contentAddressedAsset';

const roots: Root[] = [];

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (root) act(() => root.unmount());
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function assetRef(): BinaryAssetRef {
  const sha256 = 'a'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 4 };
}

function face(): PaperManagedFontFace {
  return {
    id: 'fixture-face',
    familyId: 'fixture sans',
    familyName: 'Fixture Sans',
    postscriptName: 'FixtureSans-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x20, end: 0x7e }],
    format: 'truetype',
    fontAsset: assetRef(),
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
  };
}

function composition(): PaperComposedTextFrame {
  const managedFace = face();
  return {
    frameId: 'frame-1',
    writingMode: 'horizontal-tb',
    bounds: { xPt: 0, yPt: 0, widthPt: 72, heightPt: 36 },
    lines: [{
      text: 'A',
      originXPt: 0,
      originYPt: 10,
      widthPt: 6,
      runs: [{
        text: 'A',
        face: managedFace,
        fontSizePt: 12,
        unitsPerEm: 1000,
        variations: { opsz: 18 },
        color: { kind: 'css-color', color: '#112233' },
        glyphs: [{ glyphId: 1, cluster: 0, xAdvance: 6, yAdvance: 0, xOffset: 0, yOffset: 0, xPt: 0, yPt: 10 }],
        sourceStart: 0,
        sourceEnd: 1,
        glyphRotationDeg: 90,
        decorations: { underline: true, strike: true, highlight: '#ffdd00' },
      }],
    }],
    caretMap: [{ sourceOffset: 0, xPt: 0, yPt: 0, heightPt: 12 }],
    overset: false,
    missingFaces: [],
    missingGlyphs: [],
    paragraphBoxes: [{
      xPt: 0,
      yPt: 0,
      widthPt: 30,
      heightPt: 18,
      fill: { kind: 'css-color', color: '#eeeeee' },
      borders: { top: { color: '#000000', widthPt: 1 } },
    }],
    emphasisMarks: [
      { xPt: 40, yPt: 8, radiusPt: 1, color: { kind: 'css-color', color: '#111111' }, style: 'dot' },
      { xPt: 44, yPt: 8, radiusPt: 1, color: { kind: 'css-color', color: '#222222' }, style: 'open-dot' },
      { xPt: 48, yPt: 8, radiusPt: 1, color: { kind: 'css-color', color: '#333333' }, style: 'sesame' },
      { xPt: 52, yPt: 8, radiusPt: 1.25, color: { kind: 'css-color', color: '#444444' }, style: 'circle' },
    ],
  };
}

describe('PaperManagedTextLayer', () => {
  it('does not report a supplied composition as ready without an outline resolver', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(<PaperManagedTextLayer composition={composition()} zoom={1} />);
    });

    expect(Boolean(host.querySelector('[data-paper-managed-text="ready"]'))).toBe(false);
  });

  it('renders positioned managed glyph paths rather than a browser text node', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    const variations: Array<Record<string, number> | undefined> = [];
    await act(async () => {
      root.render(
        <PaperManagedTextLayer
          composition={composition()}
          glyphPathFor={(_face, _glyph, selectedVariations) => { variations.push(selectedVariations); return 'M0 0 L1000 0 L1000 1000 Z'; }}
          zoom={1}
        />,
      );
    });

    expect(host.querySelector('[data-paper-managed-text="ready"]')).not.toBeNull();
    const glyphPath = host.querySelector('g[fill="#112233"] path');
    expect(glyphPath?.getAttribute('d')).toBe('M0 0 L1000 0 L1000 1000 Z');
    expect(glyphPath?.getAttribute('transform')).toContain('rotate(90)');
    expect(host.querySelectorAll('rect')).toHaveLength(2);
    expect(host.querySelectorAll('line')).toHaveLength(3);
    expect(Array.from(host.querySelectorAll('[data-paper-emphasis-style]')).map((mark) => mark.getAttribute('data-paper-emphasis-style')))
      .toEqual(['dot', 'open-dot', 'sesame', 'circle']);
    expect(host.querySelector('[data-paper-emphasis-style="open-dot"] circle')?.getAttribute('fill')).toBe('none');
    expect(host.querySelector('[data-paper-emphasis-style="open-dot"] circle')?.getAttribute('stroke')).toBe('#222222');
    expect(host.querySelector('[data-paper-emphasis-style="sesame"] path')?.getAttribute('d')).toContain(' C ');
    expect(host.textContent).toBe('');
    expect(variations).toEqual([{ opsz: 18 }]);
  });

  it('draws exact composed line origins only when the editor baseline overlay is enabled', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(
        <PaperManagedTextLayer
          composition={composition()}
          glyphPathFor={() => 'M0 0 L1000 0 L1000 1000 Z'}
          showBaselines
          zoom={1}
        />,
      );
    });

    const overlay = host.querySelector('[data-paper-editor-overlay="text-baselines"]');
    expect(overlay).not.toBeNull();
    const baseline = overlay?.querySelector('line');
    expect(baseline?.getAttribute('y1')).toBe('10');
    expect(baseline?.getAttribute('y2')).toBe('10');
  });
});
