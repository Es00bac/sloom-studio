import type { ImageDocument } from '../../types/imageEditor';
import { maskBoundingBox, type SelectionMask } from './SelectionMask';

export interface GenerativeFillPlacementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GenerativeFillPlacementPlan {
  descriptorId: 'generative-fill-placement:v1';
  documentSize: {
    width: number;
    height: number;
  };
  contextPaddingPx: number;
  selection: {
    present: boolean;
    empty: boolean;
    selectedPixels: number;
    coverage: number;
    bounds: GenerativeFillPlacementBounds | null;
  };
  placementBounds: GenerativeFillPlacementBounds;
  localSelectionBounds: GenerativeFillPlacementBounds | null;
  artifacts: {
    source: {
      width: number;
      height: number;
      mimeType: 'image/png';
    };
    mask: {
      width: number;
      height: number;
      mimeType: 'image/png';
    };
  };
  previewSignature: string;
}

export function resolveGenerativeFillPlacementBounds(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  selection: SelectionMask,
  paddingPx = 64,
): GenerativeFillPlacementBounds {
  const selectionBounds = maskBoundingBox(selection);

  if (!selectionBounds) {
    return {
      x: 0,
      y: 0,
      width: doc.width,
      height: doc.height,
    };
  }

  const padding = Math.max(0, Math.round(paddingPx));

  return normalizeGenerativeFillPlacementBounds({
    x: selectionBounds.x - padding,
    y: selectionBounds.y - padding,
    width: selectionBounds.width + padding * 2,
    height: selectionBounds.height + padding * 2,
  }, doc);
}

export function describeGenerativeFillPlacementPlan(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  selection: SelectionMask,
  paddingPx = 64,
): GenerativeFillPlacementPlan {
  const contextPaddingPx = Math.max(0, Math.round(paddingPx));
  const selectionBounds = maskBoundingBox(selection);
  const selectedPixels = countSelectedPixels(selection);
  const placementBounds = resolveGenerativeFillPlacementBounds(doc, selection, contextPaddingPx);
  const localSelectionBounds = selectionBounds
    ? {
        x: selectionBounds.x - placementBounds.x,
        y: selectionBounds.y - placementBounds.y,
        width: selectionBounds.width,
        height: selectionBounds.height,
      }
    : null;
  const previewPayload = {
    documentSize: { width: doc.width, height: doc.height },
    contextPaddingPx,
    selectionBounds,
    placementBounds,
    selectedPixels,
  };

  return {
    descriptorId: 'generative-fill-placement:v1',
    documentSize: { width: doc.width, height: doc.height },
    contextPaddingPx,
    selection: {
      present: true,
      empty: selectedPixels === 0,
      selectedPixels,
      coverage: selection.width * selection.height > 0
        ? Number((selectedPixels / (selection.width * selection.height)).toFixed(4))
        : 0,
      bounds: selectionBounds,
    },
    placementBounds,
    localSelectionBounds,
    artifacts: {
      source: {
        width: placementBounds.width,
        height: placementBounds.height,
        mimeType: 'image/png',
      },
      mask: {
        width: placementBounds.width,
        height: placementBounds.height,
        mimeType: 'image/png',
      },
    },
    previewSignature: `generative-fill-placement:v1:${JSON.stringify(previewPayload)}`,
  };
}

export function cropSelectionToBounds(
  selection: SelectionMask,
  bounds: GenerativeFillPlacementBounds,
): SelectionMask {
  const data = new Uint8ClampedArray(bounds.width * bounds.height);

  for (let y = 0; y < bounds.height; y += 1) {
    const docY = bounds.y + y;
    if (docY < 0 || docY >= selection.height) continue;

    for (let x = 0; x < bounds.width; x += 1) {
      const docX = bounds.x + x;
      if (docX < 0 || docX >= selection.width) continue;
      data[y * bounds.width + x] = selection.data[docY * selection.width + docX];
    }
  }

  return {
    width: bounds.width,
    height: bounds.height,
    data,
  };
}

export function normalizeGenerativeFillPlacementBounds(
  bounds: GenerativeFillPlacementBounds,
  doc: Pick<ImageDocument, 'width' | 'height'>,
): GenerativeFillPlacementBounds {
  const x = clampInteger(bounds.x, 0, doc.width - 1);
  const y = clampInteger(bounds.y, 0, doc.height - 1);
  const right = clampInteger(bounds.x + bounds.width, x + 1, doc.width);
  const bottom = clampInteger(bounds.y + bounds.height, y + 1, doc.height);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.round(Math.min(max, Math.max(min, value)));
}

function countSelectedPixels(selection: SelectionMask): number {
  let selectedPixels = 0;
  for (let index = 0; index < selection.data.length; index += 1) {
    if (selection.data[index] > 0) {
      selectedPixels += 1;
    }
  }
  return selectedPixels;
}
