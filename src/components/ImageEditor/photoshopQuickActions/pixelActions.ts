import type { EditorOperation, ImageDocument, ImageLayer } from '../../../types/imageEditor';
import {
  applyLocalContentAwareFillToImageData,
  buildTransparentPixelMask,
  buildLocalContentAwarePreviewId,
  describeLocalContentAwarePatchPlan,
  type LocalContentAwareBounds,
  type LocalContentAwarePatchPlan,
  type LocalContentAwareRequestedOutputTarget,
  type LocalContentAwareRepairOperation,
} from '../ImageContentAware';
import { getBitmapImageData, putBitmapImageData } from '../LayerBitmap';
import { createMask, isMaskEmpty, maskBoundingBox, type SelectionMask } from '../SelectionMask';
import {
  cloneBitmapPixels,
  forEachBitmapPixel,
  getSelectionAlphaAtDocumentPixel,
} from './bitmapUtils';
import { clampByte } from './utils';

export interface LayerLocalContentAwarePatchPlan extends LocalContentAwarePatchPlan {
  layerId: string;
  layerBounds: LocalContentAwareBounds;
  documentSelectionBounds: LocalContentAwareBounds | null;
}

export function clearOutsideSelection(
  doc: ImageDocument,
  layer: ImageLayer,
  selection: SelectionMask,
): Extract<EditorOperation, { kind: 'paint' }> | null {
  if (!layer.bitmap) return null;
  const before = cloneBitmapPixels(layer.bitmap);
  const after = cloneBitmapPixels(layer.bitmap);
  const imageData = getBitmapImageData(after);

  forEachBitmapPixel(after, (x, y, offset) => {
    const alpha = getSelectionAlphaAtDocumentPixel(doc, selection, layer.x + x, layer.y + y);
    imageData.data[offset + 3] = Math.round((imageData.data[offset + 3] * alpha) / 255);
  });

  putBitmapImageData(after, imageData);
  return { kind: 'paint', docId: doc.id, layerId: layer.id, before, after };
}


export function invertLayerColors(
  doc: ImageDocument,
  layer: ImageLayer,
): Extract<EditorOperation, { kind: 'paint' }> | null {
  return mapLayerPixels(doc, layer, (data, offset) => {
    data[offset] = 255 - data[offset];
    data[offset + 1] = 255 - data[offset + 1];
    data[offset + 2] = 255 - data[offset + 2];
  });
}

export function desaturateLayer(
  doc: ImageDocument,
  layer: ImageLayer,
): Extract<EditorOperation, { kind: 'paint' }> | null {
  return mapLayerPixels(doc, layer, (data, offset) => {
    const gray = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114);
    data[offset] = gray;
    data[offset + 1] = gray;
    data[offset + 2] = gray;
  });
}

export function adjustLayerBrightness(
  doc: ImageDocument,
  layer: ImageLayer,
  delta: number,
): Extract<EditorOperation, { kind: 'paint' }> | null {
  return mapLayerPixels(doc, layer, (data, offset) => {
    data[offset] = clampByte(data[offset] + delta);
    data[offset + 1] = clampByte(data[offset + 1] + delta);
    data[offset + 2] = clampByte(data[offset + 2] + delta);
  });
}

export function setLayerPixelAlphaPercent(
  doc: ImageDocument,
  layer: ImageLayer,
  percent: number,
): Extract<EditorOperation, { kind: 'paint' }> | null {
  const ratio = Math.max(0, Math.min(1, percent / 100));
  return mapLayerPixels(doc, layer, (data, offset) => {
    data[offset + 3] = clampByte(data[offset + 3] * ratio);
  });
}


export function clearSelectedPixels(
  doc: ImageDocument,
  layer: ImageLayer,
  selection: SelectionMask,
): Extract<EditorOperation, { kind: 'paint' }> | null {
  if (!layer.bitmap) return null;
  const before = cloneBitmapPixels(layer.bitmap);
  const after = cloneBitmapPixels(layer.bitmap);
  const imageData = getBitmapImageData(after);

  forEachBitmapPixel(after, (x, y, offset) => {
    const alpha = getSelectionAlphaAtDocumentPixel(doc, selection, layer.x + x, layer.y + y);
    if (alpha === 0) return;
    imageData.data[offset + 3] = Math.round((imageData.data[offset + 3] * (255 - alpha)) / 255);
  });

  putBitmapImageData(after, imageData);
  return { kind: 'paint', docId: doc.id, layerId: layer.id, before, after };
}

export function localContentAwareFillPatch(
  doc: ImageDocument,
  layer: ImageLayer,
  selection?: SelectionMask | null,
  options: {
    operation?: LocalContentAwareRepairOperation;
    maxSampleRadius?: number;
    manualPatchSource?: LocalContentAwareBounds | null;
  } = {},
): Extract<EditorOperation, { kind: 'paint' }> | null {
  if (!layer.bitmap) return null;
  const before = cloneBitmapPixels(layer.bitmap);
  const after = cloneBitmapPixels(layer.bitmap);
  const imageData = getBitmapImageData(after);
  const targetMask = selection ? selectionToLayerMask(doc, layer, selection) : buildTransparentPixelMask(imageData);
  if (isMaskEmpty(targetMask)) return null;

  const result = applyLocalContentAwareFillToImageData(imageData, {
    selection: targetMask,
    operation: options.operation,
    maxSampleRadius: options.maxSampleRadius,
    manualPatchSource: options.manualPatchSource,
  });
  if (result.changedPixels === 0) return null;

  putBitmapImageData(after, result.imageData);
  return { kind: 'paint', docId: doc.id, layerId: layer.id, before, after };
}

/**
 * Creates a retained repair layer containing only the repaired target pixels.
 * The original active layer is deliberately left byte-for-byte intact.
 */
export function createLocalContentAwareFillLayer(
  doc: ImageDocument,
  layer: ImageLayer,
  selection: SelectionMask | null | undefined,
  layerId: string,
  options: {
    operation?: LocalContentAwareRepairOperation;
    maxSampleRadius?: number;
    manualPatchSource?: LocalContentAwareBounds | null;
  } = {},
): ImageLayer | null {
  if (!layer.bitmap) return null;
  const source = getBitmapImageData(layer.bitmap);
  const targetMask = selection ? selectionToLayerMask(doc, layer, selection) : buildTransparentPixelMask(source);
  if (isMaskEmpty(targetMask)) return null;

  const repaired = applyLocalContentAwareFillToImageData(source, {
    selection: targetMask,
    operation: options.operation,
    maxSampleRadius: options.maxSampleRadius,
    manualPatchSource: options.manualPatchSource,
  });
  if (repaired.changedPixels === 0) return null;

  const output = cloneBitmapPixels(layer.bitmap);
  const outputData = getBitmapImageData(output);
  forEachBitmapPixel(output, (x, y, offset) => {
    if ((targetMask.data[y * targetMask.width + x] ?? 0) === 0) {
      outputData.data[offset + 3] = 0;
      return;
    }
    outputData.data[offset] = repaired.imageData.data[offset];
    outputData.data[offset + 1] = repaired.imageData.data[offset + 1];
    outputData.data[offset + 2] = repaired.imageData.data[offset + 2];
    outputData.data[offset + 3] = repaired.imageData.data[offset + 3];
  });
  putBitmapImageData(output, outputData);

  return {
    ...layer,
    id: layerId,
    name: 'Content-Aware Fill',
    locked: false,
    bitmap: output,
    bitmapVersion: 0,
    mask: null,
  };
}

export function planLocalContentAwareFillPatch(
  doc: ImageDocument,
  layer: ImageLayer,
  selection?: SelectionMask | null,
  options: {
    maxSampleRadius?: number;
    outputTarget?: LocalContentAwareRequestedOutputTarget;
    manualPatchSource?: LocalContentAwareBounds | null;
    operation?: LocalContentAwareRepairOperation;
  } = {},
): LayerLocalContentAwarePatchPlan | null {
  if (!layer.bitmap) return null;
  const imageData = getBitmapImageData(layer.bitmap);
  const targetMask = selection ? selectionToLayerMask(doc, layer, selection) : buildTransparentPixelMask(imageData);
  const basePlan = describeLocalContentAwarePatchPlan(imageData, {
    selection: targetMask,
    maxSampleRadius: options.maxSampleRadius,
    targetKind: selection ? 'selection' : 'transparent-pixels',
    outputTarget: options.outputTarget,
    manualPatchSource: options.manualPatchSource,
    operation: options.operation,
  });
  const layerBounds = {
    x: layer.x,
    y: layer.y,
    width: layer.bitmap.width,
    height: layer.bitmap.height,
  };
  const documentSelectionBounds = selection
    ? maskBoundingBox(selection)
    : translateBounds(basePlan.selectionBounds, layer.x, layer.y);
  const signaturePayload = {
    layerId: layer.id,
    layerBounds,
    documentSelectionBounds,
    targetKind: basePlan.targetKind,
    outputTarget: basePlan.outputTarget,
    selectionBounds: basePlan.selectionBounds,
    samplingRadius: basePlan.samplingRadius,
    targetPixels: basePlan.targetPixels,
    sourcePixels: basePlan.sourcePixels,
    warnings: basePlan.warnings.map((warning) => warning.code),
  };
  const previewSignature = `local-content-aware-patch:v1:${JSON.stringify(signaturePayload)}`;
  const stablePreviewSignaturePayload = {
    layerId: layer.id,
    layerBounds,
    documentSelectionBounds,
    operation: basePlan.operation,
    targetKind: basePlan.targetKind,
    outputTarget: basePlan.outputTarget,
    selectionBounds: basePlan.selectionBounds,
    samplingRadius: basePlan.samplingRadius,
    targetPixels: basePlan.targetPixels,
    sourcePixels: basePlan.sourcePixels,
    warnings: basePlan.warnings.map((warning) => warning.code),
  };

  return {
    ...basePlan,
    layerId: layer.id,
    layerBounds,
    documentSelectionBounds,
    previewSignature,
    stablePreview: {
      ...basePlan.stablePreview,
      signature: `local-content-aware-repair-preview:v1:${JSON.stringify(stablePreviewSignaturePayload)}`,
      signatureFields: [
        'layerId',
        'layerBounds',
        'documentSelectionBounds',
        ...basePlan.stablePreview.signatureFields,
      ],
    },
    preview: {
      id: `${buildLocalContentAwarePreviewId(
        basePlan.operation,
        basePlan.targetKind,
        imageData.width,
        imageData.height,
        basePlan.selectionBounds,
        basePlan.samplingRadius,
        basePlan.targetPixels,
      )}:${layer.id}`,
      signature: `local-content-aware-repair-preview:v1:${JSON.stringify(stablePreviewSignaturePayload)}`,
      signatureFields: [
        'layerId',
        'layerBounds',
        'documentSelectionBounds',
        ...basePlan.stablePreview.signatureFields,
      ],
    },
  };
}

function mapLayerPixels(
  doc: ImageDocument,
  layer: ImageLayer,
  mutate: (data: Uint8ClampedArray, offset: number, x: number, y: number) => void,
): Extract<EditorOperation, { kind: 'paint' }> | null {
  if (!layer.bitmap) return null;
  const before = cloneBitmapPixels(layer.bitmap);
  const after = cloneBitmapPixels(layer.bitmap);
  const imageData = getBitmapImageData(after);

  forEachBitmapPixel(after, (x, y, offset) => {
    mutate(imageData.data, offset, x, y);
  });

  putBitmapImageData(after, imageData);
  return { kind: 'paint', docId: doc.id, layerId: layer.id, before, after };
}

function selectionToLayerMask(
  doc: ImageDocument,
  layer: ImageLayer,
  selection: SelectionMask,
): SelectionMask {
  const bitmap = layer.bitmap;
  if (!bitmap) return createMask(0, 0);
  const mask = createMask(bitmap.width, bitmap.height);
  forEachBitmapPixel(bitmap, (x, y) => {
    mask.data[y * mask.width + x] = getSelectionAlphaAtDocumentPixel(doc, selection, layer.x + x, layer.y + y);
  });
  return mask;
}

function translateBounds(
  bounds: LocalContentAwareBounds | null,
  dx: number,
  dy: number,
): LocalContentAwareBounds | null {
  if (!bounds) return null;
  return {
    x: bounds.x + dx,
    y: bounds.y + dy,
    width: bounds.width,
    height: bounds.height,
  };
}
