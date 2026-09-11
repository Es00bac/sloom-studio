import { describe, expect, it } from 'vitest';
import { createMask, setRect } from './SelectionMask';
import {
  cropSelectionToBounds,
  describeGenerativeFillPlacementPlan,
  resolveGenerativeFillPlacementBounds,
} from './GenerativeFillGeometry';

describe('GenerativeFillGeometry', () => {
  it('expands selected-area edits with context while clamping to the document', () => {
    const selection = createMask(100, 80);
    setRect(selection, 20, 18, 10, 8, 255, false);

    expect(resolveGenerativeFillPlacementBounds({ width: 100, height: 80 }, selection, 12)).toEqual({
      x: 8,
      y: 6,
      width: 34,
      height: 32,
    });
  });

  it('crops a document-space selection mask into local generated-layer coordinates', () => {
    const selection = createMask(20, 16);
    setRect(selection, 7, 6, 3, 2, 255, false);

    const cropped = cropSelectionToBounds(selection, { x: 5, y: 4, width: 8, height: 6 });

    expect(cropped.width).toBe(8);
    expect(cropped.height).toBe(6);
    expect(cropped.data[(2 * 8 + 2)]).toBe(255);
    expect(cropped.data[(3 * 8 + 4)]).toBe(255);
    expect(cropped.data[0]).toBe(0);
  });

  it('describes selected-region artifact geometry with local bounds and a stable signature', () => {
    const selection = createMask(120, 90);
    setRect(selection, 30, 25, 5, 4, 255, false);

    expect(describeGenerativeFillPlacementPlan({ width: 120, height: 90 }, selection, 10)).toEqual({
      descriptorId: 'generative-fill-placement:v1',
      documentSize: { width: 120, height: 90 },
      contextPaddingPx: 10,
      selection: {
        present: true,
        empty: false,
        selectedPixels: 20,
        coverage: 0.0019,
        bounds: { x: 30, y: 25, width: 5, height: 4 },
      },
      placementBounds: { x: 20, y: 15, width: 25, height: 24 },
      localSelectionBounds: { x: 10, y: 10, width: 5, height: 4 },
      artifacts: {
        source: { width: 25, height: 24, mimeType: 'image/png' },
        mask: { width: 25, height: 24, mimeType: 'image/png' },
      },
      previewSignature: 'generative-fill-placement:v1:{"documentSize":{"width":120,"height":90},"contextPaddingPx":10,"selectionBounds":{"x":30,"y":25,"width":5,"height":4},"placementBounds":{"x":20,"y":15,"width":25,"height":24},"selectedPixels":20}',
    });
  });
});
