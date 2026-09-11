// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  createPaperHaneBlankImageDataUrl,
  defaultPaperHaneBlankImageSpec,
  PaperHaneBlankImageDialog,
  paperHaneBlankImageValidationError,
} from './PaperHaneBlankImageDialog';

const frame = {
  label: 'Panel illustration',
  widthMm: 127,
  heightMm: 63.5,
};

describe('PaperHaneBlankImageDialog', () => {
  it('starts with the exact frame size at the Paper print resolution', () => {
    expect(defaultPaperHaneBlankImageSpec(frame, 300)).toEqual({
      label: 'Panel illustration',
      widthPx: 1500,
      heightPx: 750,
      dpi: 300,
      background: 'transparent',
    });
  });

  it('bounds dimensions before allocating a mobile drawing canvas', () => {
    expect(paperHaneBlankImageValidationError({
      label: 'Too large',
      widthPx: 10_000,
      heightPx: 10_000,
      dpi: 300,
      background: 'transparent',
    })).toContain('64 million pixels');
  });

  it('creates a transparent PNG at the requested pixel dimensions', () => {
    const clearRect = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect,
        fillRect: vi.fn(),
      }),
      toDataURL: () => 'data:image/png;base64,blank',
    } as unknown as HTMLCanvasElement;
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(canvas);

    const dataUrl = createPaperHaneBlankImageDataUrl({
      label: 'Blank',
      widthPx: 1024,
      heightPx: 768,
      dpi: 300,
      background: 'transparent',
    }, {
      type: 'solid',
      color: '#ffffff',
      fromColor: '#ffffff',
      toColor: '#000000',
      angleDeg: 0,
      radialShape: 'circle',
    });

    expect(dataUrl).toBe('data:image/png;base64,blank');
    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(768);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 1024, 768);
    createElement.mockRestore();
  });

  it('explains the one-workflow flattened-return behavior in the creation dialog', () => {
    const html = renderToStaticMarkup(
      <PaperHaneBlankImageDialog
        busy={false}
        documentDpi={300}
        frame={frame}
        onCancel={() => undefined}
        onCreate={() => undefined}
      />,
    );

    expect(html).toContain('Create Image for Hane Mobile');
    expect(html).toContain('refreshed here as a flattened image');
    expect(html).toContain('Create &amp; Open in Hane');
  });
});
