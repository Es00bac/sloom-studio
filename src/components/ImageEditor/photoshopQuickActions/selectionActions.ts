import type { ImageDocument, ImageLayer } from '../../../types/imageEditor';
import {
  createMask,
  maskBoundingBox,
  setRect,
  type SelectionMask,
} from '../SelectionMask';
import { getBitmapImageData } from '../LayerBitmap';
import { clampByte, clampPercent } from './utils';

export function selectLayerBounds(
  doc: ImageDocument,
  layer: ImageLayer,
): SelectionMask {
  const mask = createMask(doc.width, doc.height);
  const width = layer.bitmap?.width ?? doc.width;
  const height = layer.bitmap?.height ?? doc.height;
  const x0 = Math.max(0, Math.floor(layer.x));
  const y0 = Math.max(0, Math.floor(layer.y));
  const x1 = Math.min(doc.width, Math.ceil(layer.x + width));
  const y1 = Math.min(doc.height, Math.ceil(layer.y + height));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      mask.data[y * mask.width + x] = 255;
    }
  }
  return mask;
}

export function selectLayerOpaquePixels(
  doc: ImageDocument,
  layer: ImageLayer,
  threshold = 1,
): SelectionMask {
  const mask = createMask(doc.width, doc.height);
  if (!layer.bitmap) return mask;
  const imageData = getBitmapImageData(layer.bitmap);
  for (let y = 0; y < layer.bitmap.height; y += 1) {
    for (let x = 0; x < layer.bitmap.width; x += 1) {
      const alpha = imageData.data[(y * layer.bitmap.width + x) * 4 + 3];
      if (alpha < threshold) continue;
      const docX = Math.round(layer.x + x);
      const docY = Math.round(layer.y + y);
      if (docX < 0 || docY < 0 || docX >= doc.width || docY >= doc.height) continue;
      mask.data[docY * mask.width + docX] = alpha;
    }
  }
  return mask;
}

export function selectCanvas(doc: ImageDocument): SelectionMask {
  const mask = createMask(doc.width, doc.height);
  mask.data.fill(255);
  return mask;
}

export function selectLayerTransparentPixels(
  doc: ImageDocument,
  layer: ImageLayer,
  threshold = 1,
): SelectionMask {
  const mask = selectLayerBounds(doc, layer);
  if (!layer.bitmap) return mask;
  const imageData = getBitmapImageData(layer.bitmap);
  for (let y = 0; y < layer.bitmap.height; y += 1) {
    for (let x = 0; x < layer.bitmap.width; x += 1) {
      const docX = Math.round(layer.x + x);
      const docY = Math.round(layer.y + y);
      if (docX < 0 || docY < 0 || docX >= doc.width || docY >= doc.height) continue;
      const alpha = imageData.data[(y * layer.bitmap.width + x) * 4 + 3];
      if (alpha >= threshold) {
        mask.data[docY * mask.width + docX] = 0;
      }
    }
  }
  return mask;
}

export function selectSelectionBoundingBox(selection: SelectionMask): SelectionMask {
  const mask = createMask(selection.width, selection.height);
  const bbox = maskBoundingBox(selection);
  if (!bbox) return mask;
  for (let y = bbox.y; y < bbox.y + bbox.height; y += 1) {
    for (let x = bbox.x; x < bbox.x + bbox.width; x += 1) {
      mask.data[y * mask.width + x] = 255;
    }
  }
  return mask;
}

export function selectTopHalf(doc: ImageDocument): SelectionMask {
  return selectDocumentRect(doc, 0, 0, doc.width, doc.height / 2);
}

export function selectBottomHalf(doc: ImageDocument): SelectionMask {
  return selectDocumentRect(doc, 0, doc.height / 2, doc.width, doc.height / 2);
}

export function selectLeftHalf(doc: ImageDocument): SelectionMask {
  return selectDocumentRect(doc, 0, 0, doc.width / 2, doc.height);
}

export function selectRightHalf(doc: ImageDocument): SelectionMask {
  return selectDocumentRect(doc, doc.width / 2, 0, doc.width / 2, doc.height);
}

export function selectCenterSquare(doc: ImageDocument): SelectionMask {
  const size = Math.min(doc.width, doc.height);
  return selectDocumentRect(doc, (doc.width - size) / 2, (doc.height - size) / 2, size, size);
}

export function selectHorizontalCenterBand(doc: ImageDocument): SelectionMask {
  const height = Math.ceil(doc.height / 3);
  return selectDocumentRect(doc, 0, (doc.height - height) / 2, doc.width, height);
}

export function selectVerticalCenterBand(doc: ImageDocument): SelectionMask {
  const width = Math.ceil(doc.width / 3);
  return selectDocumentRect(doc, (doc.width - width) / 2, 0, width, doc.height);
}

export function selectGridCell(
  doc: ImageDocument,
  columns: number,
  rows: number,
  cell: number,
): SelectionMask {
  const safeColumns = Math.max(1, Math.floor(columns));
  const safeRows = Math.max(1, Math.floor(rows));
  const safeCell = Math.max(1, Math.min(safeColumns * safeRows, Math.floor(cell)));
  const column = (safeCell - 1) % safeColumns;
  const row = Math.floor((safeCell - 1) / safeColumns);
  return selectDocumentRect(
    doc,
    (doc.width * column) / safeColumns,
    (doc.height * row) / safeRows,
    doc.width / safeColumns,
    doc.height / safeRows,
  );
}

export function selectEdgeStripPercent(
  doc: ImageDocument,
  edge: 'top' | 'bottom' | 'left' | 'right',
  percent: number,
): SelectionMask {
  const ratio = clampPercent(percent) / 100;
  switch (edge) {
    case 'top': {
      const height = doc.height * ratio;
      return selectDocumentRect(doc, 0, 0, doc.width, height);
    }
    case 'bottom': {
      const height = doc.height * ratio;
      return selectDocumentRect(doc, 0, doc.height - height, doc.width, height);
    }
    case 'left': {
      const width = doc.width * ratio;
      return selectDocumentRect(doc, 0, 0, width, doc.height);
    }
    case 'right': {
      const width = doc.width * ratio;
      return selectDocumentRect(doc, doc.width - width, 0, width, doc.height);
    }
  }
}

export function selectInsetPercent(doc: ImageDocument, percent: number): SelectionMask {
  const ratio = Math.min(0.49, clampPercent(percent) / 100);
  const insetX = doc.width * ratio;
  const insetY = doc.height * ratio;
  return selectDocumentRect(
    doc,
    insetX,
    insetY,
    doc.width - insetX * 2,
    doc.height - insetY * 2,
  );
}

export function selectBorderRingPercent(doc: ImageDocument, percent: number): SelectionMask {
  const ratio = Math.min(0.49, clampPercent(percent) / 100);
  const mask = selectCanvas(doc);
  clearMaskRect(
    mask,
    doc.width * ratio,
    doc.height * ratio,
    doc.width * (1 - ratio * 2),
    doc.height * (1 - ratio * 2),
  );
  return mask;
}

function selectDocumentRect(
  doc: ImageDocument,
  x: number,
  y: number,
  width: number,
  height: number,
): SelectionMask {
  const mask = createMask(doc.width, doc.height);
  setRect(mask, x, y, width, height, 255, false);
  return mask;
}

export function growSelection(selection: SelectionMask, radius = 1): SelectionMask {
  return neighborhoodSelection(selection, radius, (values) => Math.max(...values));
}

export function shrinkSelection(selection: SelectionMask, radius = 1): SelectionMask {
  return neighborhoodSelection(selection, radius, (values) => Math.min(...values));
}

export function featherSelection(selection: SelectionMask, radius = 1): SelectionMask {
  return neighborhoodSelection(selection, radius, (values) =>
    Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
  );
}

export function borderSelection(selection: SelectionMask, radius = 1): SelectionMask {
  const grown = growSelection(selection, radius);
  const shrunk = shrinkSelection(selection, radius);
  const border = createMask(selection.width, selection.height);
  for (let i = 0; i < border.data.length; i += 1) {
    border.data[i] = Math.max(0, grown.data[i] - shrunk.data[i]);
  }
  return border;
}

export function smoothSelection(selection: SelectionMask): SelectionMask {
  const softened = featherSelection(selection, 1);
  const out = createMask(selection.width, selection.height);
  for (let i = 0; i < out.data.length; i += 1) {
    out.data[i] = softened.data[i] >= 32 ? softened.data[i] : 0;
  }
  return out;
}

export function nudgeSelection(selection: SelectionMask, dx: number, dy: number): SelectionMask {
  const offsetX = Number.isFinite(dx) ? Math.round(dx) : 0;
  const offsetY = Number.isFinite(dy) ? Math.round(dy) : 0;
  const out = createMask(selection.width, selection.height);

  for (let y = 0; y < selection.height; y += 1) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= selection.height) continue;
    for (let x = 0; x < selection.width; x += 1) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= selection.width) continue;
      out.data[targetY * out.width + targetX] = selection.data[y * selection.width + x];
    }
  }

  return out;
}


function neighborhoodSelection(
  selection: SelectionMask,
  radius: number,
  reducer: (values: number[]) => number,
): SelectionMask {
  const r = Math.max(1, Math.floor(radius));
  const out = createMask(selection.width, selection.height);
  for (let y = 0; y < selection.height; y += 1) {
    for (let x = 0; x < selection.width; x += 1) {
      const values: number[] = [];
      for (let yy = y - r; yy <= y + r; yy += 1) {
        for (let xx = x - r; xx <= x + r; xx += 1) {
          if (xx < 0 || yy < 0 || xx >= selection.width || yy >= selection.height) {
            values.push(0);
          } else {
            values.push(selection.data[yy * selection.width + xx]);
          }
        }
      }
      out.data[y * out.width + x] = clampByte(reducer(values));
    }
  }
  return out;
}


function clearMaskRect(
  mask: SelectionMask,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(mask.width, Math.ceil(x + width));
  const y1 = Math.min(mask.height, Math.ceil(y + height));

  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      mask.data[py * mask.width + px] = 0;
    }
  }
}
