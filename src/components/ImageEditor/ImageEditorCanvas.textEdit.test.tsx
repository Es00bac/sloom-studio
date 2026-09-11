// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageTextEditOverlay } from './ImageEditorCanvas';
import { normalizeImageTextStyle } from './ImageTextLayer';
import type { ImageLayer } from '../../types/imageEditor';

describe('ImageTextEditOverlay', () => {
  it('formats the live editor font family and preserves variant caps (FBL-012)', () => {
    const layer = {
      id: 'text-1',
      name: 'Title',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 1,
      mask: null,
      text: normalizeImageTextStyle({
        content: 'HEADLINE',
        fontFamily: 'M PLUS 1, sans-serif',
        fontSize: 48,
        fontWeight: '700',
        fontStyle: 'normal',
        fontVariantCaps: 'all-small-caps',
      }),
      metadata: { editableText: true },
    } satisfies ImageLayer;

    const html = renderToStaticMarkup(
      <ImageTextEditOverlay
        bounds={{
          x: 10,
          y: 20,
          width: 200,
          height: 80,
          rotationDeg: 0,
          transformOriginX: 0.5,
          transformOriginY: 0.5,
        }}
        draft="HEADLINE"
        layer={layer}
        onCancel={vi.fn()}
        onChange={vi.fn()}
        onCommit={vi.fn()}
        zoom={1}
      />,
    );

    expect(html).toContain('font-family:&quot;M PLUS 1&quot;, sans-serif');
    expect(html).toContain('font-variant-caps:all-small-caps');
  });
});
