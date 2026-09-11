import type {
  EditorOperation,
  ImageDocument,
  ImageDocumentSnapshot,
  ImageLayer,
  LayerBitmap,
  PixelBuffer,
  SelectionMaskSnapshot,
} from '../../types/imageEditor';
import { cloneBitmap } from './LayerBitmap';
import {
  markImageDocumentSnapshotOwned,
  verifyImageDocumentSnapshotIntegrity,
} from './ImageSnapshots';

const retainedHistoryOperations = new WeakSet<EditorOperation>();

function cloneSerializableValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneRetainedBitmap(
  bitmap: LayerBitmap | null,
  clones: Map<LayerBitmap, LayerBitmap>,
): LayerBitmap | null {
  if (!bitmap) return null;
  const existing = clones.get(bitmap);
  if (existing) return existing;
  const cloned = cloneBitmap(bitmap);
  clones.set(bitmap, cloned);
  return cloned;
}

function cloneLayer(
  layer: ImageLayer,
  clones: Map<LayerBitmap, LayerBitmap>,
): ImageLayer {
  const { bitmap, mask, tiltmarkBaseBitmap, ...serializable } = layer;
  return {
    ...cloneSerializableValue(serializable),
    bitmap: cloneRetainedBitmap(bitmap, clones),
    mask: cloneRetainedBitmap(mask, clones),
    tiltmarkBaseBitmap: cloneRetainedBitmap(tiltmarkBaseBitmap ?? null, clones),
  };
}

function cloneLayers(
  layers: readonly ImageLayer[],
  clones: Map<LayerBitmap, LayerBitmap>,
): ImageLayer[] {
  return layers.map((layer) => cloneLayer(layer, clones));
}

function cloneSnapshot(
  snapshot: ImageDocumentSnapshot,
  clones: Map<LayerBitmap, LayerBitmap>,
): ImageDocumentSnapshot {
  const { layers, ...serializable } = snapshot;
  return {
    ...cloneSerializableValue(serializable),
    layers: cloneLayers(layers, clones),
  };
}

function cloneDocument(
  document: ImageDocument,
  clones: Map<LayerBitmap, LayerBitmap>,
): ImageDocument {
  const { layers, snapshots, ...serializable } = document;
  return {
    ...cloneSerializableValue(serializable),
    layers: cloneLayers(layers, clones),
    snapshots: snapshots?.map((snapshot) => cloneSnapshot(snapshot, clones)),
  };
}

function cloneSelectionSnapshot(snapshot: SelectionMaskSnapshot | null): SelectionMaskSnapshot | null {
  if (!snapshot) return null;
  return {
    width: snapshot.width,
    height: snapshot.height,
    data: new Uint8ClampedArray(snapshot.data),
  };
}

/** MH-009: deep-copy a high-bit pixel authority for immutable history retention. */
function cloneRetainedPixelBuffer(buffer: PixelBuffer | null): PixelBuffer | null {
  if (!buffer) return null;
  return {
    width: buffer.width,
    height: buffer.height,
    model: buffer.model,
    depth: buffer.depth,
    data: buffer.depth === 'u8'
      ? new Uint8Array(buffer.data as Uint8Array)
      : buffer.depth === 'u16'
        ? new Uint16Array(buffer.data as Uint16Array)
        : new Float32Array(buffer.data as Float32Array),
  } as PixelBuffer;
}

function cloneConvertDepthLayerState(state: {
  pixels: PixelBuffer | null;
  pixelsVersion: number | undefined;
}): { pixels: PixelBuffer | null; pixelsVersion: number | undefined } {
  return {
    pixels: cloneRetainedPixelBuffer(state.pixels),
    pixelsVersion: state.pixelsVersion,
  };
}

function cloneConvertDepthState(state: {
  bitDepth: 8 | 16 | 32;
  layers: Record<string, { pixels: PixelBuffer | null; pixelsVersion: number | undefined }>;
}): { bitDepth: 8 | 16 | 32; layers: Record<string, { pixels: PixelBuffer | null; pixelsVersion: number | undefined }> } {
  const layers: Record<string, { pixels: PixelBuffer | null; pixelsVersion: number | undefined }> = {};
  for (const [layerId, layerState] of Object.entries(state.layers)) {
    layers[layerId] = cloneConvertDepthLayerState(layerState);
  }
  return { bitDepth: state.bitDepth, layers };
}

/**
 * Copy all mutable content retained by an undo entry. One clone map spans the
 * operation's before/after states, so unchanged bitmap identities are shared
 * inside that immutable operation instead of being duplicated.
 */
export function retainEditorOperation(operation: EditorOperation): EditorOperation {
  const clones = new Map<LayerBitmap, LayerBitmap>();
  let retained: EditorOperation;

  switch (operation.kind) {
    case 'paint':
      retained = {
        ...operation,
        before: cloneRetainedBitmap(operation.before, clones),
        after: cloneRetainedBitmap(operation.after, clones),
        ...(operation.tiltmarkHistory
          ? { tiltmarkHistory: cloneSerializableValue(operation.tiltmarkHistory) }
          : {}),
        ...(operation.tiltmarkLayer
          ? {
              tiltmarkLayer: {
                before: {
                  ...cloneSerializableValue({
                    ...operation.tiltmarkLayer.before,
                    base: undefined,
                  }),
                  base: cloneRetainedBitmap(operation.tiltmarkLayer.before.base, clones),
                },
                after: {
                  ...cloneSerializableValue({
                    ...operation.tiltmarkLayer.after,
                    base: undefined,
                  }),
                  base: cloneRetainedBitmap(operation.tiltmarkLayer.after.base, clones),
                },
              },
            }
          : {}),
      };
      break;
    case 'selection':
      retained = {
        ...operation,
        before: cloneSelectionSnapshot(operation.before),
        after: cloneSelectionSnapshot(operation.after),
      };
      break;
    case 'transform':
    case 'multiTransform':
      retained = cloneSerializableValue(operation);
      break;
    case 'layerOp':
      retained = {
        ...operation,
        before: cloneLayers(operation.before, clones),
        after: cloneLayers(operation.after, clones),
      };
      break;
    case 'docResize':
      retained = {
        ...operation,
        before: {
          ...cloneSerializableValue({ ...operation.before, layers: undefined }),
          layers: cloneLayers(operation.before.layers, clones),
        },
        after: {
          ...cloneSerializableValue({ ...operation.after, layers: undefined }),
          layers: cloneLayers(operation.after.layers, clones),
        },
      };
      break;
    case 'documentState':
      retained = {
        ...operation,
        before: cloneDocument(operation.before, clones),
        after: cloneDocument(operation.after, clones),
      };
      break;
    case 'convertDepth':
      retained = {
        ...operation,
        before: cloneConvertDepthState(operation.before),
        after: cloneConvertDepthState(operation.after),
      };
      break;
    case 'highBitPaint':
      retained = {
        ...operation,
        before: cloneRetainedPixelBuffer(operation.before)!,
        after: cloneRetainedPixelBuffer(operation.after)!,
      };
      break;
  }

  retainedHistoryOperations.add(retained);
  return retained;
}

/** Clone an immutable history layer graph before exposing it to live tools. */
export function materializeHistoryLayers(layers: readonly ImageLayer[]): ImageLayer[] {
  return cloneLayers(layers, new Map());
}

/** Clone an immutable history document before exposing it to live tools. */
export function materializeHistoryDocument(document: ImageDocument): ImageDocument {
  const materialized = cloneDocument(document, new Map());
  materialized.snapshots?.forEach((snapshot) => {
    markImageDocumentSnapshotOwned(snapshot);
    verifyImageDocumentSnapshotIntegrity(snapshot);
  });
  return materialized;
}

/** Clone one immutable history bitmap before exposing it to live tools. */
export function materializeHistoryBitmap(bitmap: LayerBitmap | null): LayerBitmap | null {
  return bitmap ? cloneBitmap(bitmap) : null;
}

function collectLayerBitmaps(layer: ImageLayer, bitmaps: Set<LayerBitmap>): void {
  if (layer.bitmap) bitmaps.add(layer.bitmap);
  if (layer.mask) bitmaps.add(layer.mask);
  if (layer.tiltmarkBaseBitmap) bitmaps.add(layer.tiltmarkBaseBitmap);
}

function collectLayerPixelBuffers(layer: ImageLayer, buffers: Set<PixelBuffer>): void {
  if (layer.pixels) buffers.add(layer.pixels);
}

function collectSnapshotBitmaps(snapshot: ImageDocumentSnapshot, bitmaps: Set<LayerBitmap>): void {
  for (const layer of snapshot.layers) collectLayerBitmaps(layer, bitmaps);
}

function collectDocumentBitmaps(document: ImageDocument, bitmaps: Set<LayerBitmap>): void {
  for (const layer of document.layers) collectLayerBitmaps(layer, bitmaps);
  for (const snapshot of document.snapshots ?? []) collectSnapshotBitmaps(snapshot, bitmaps);
}

function operationBitmaps(operation: EditorOperation): Set<LayerBitmap> {
  const bitmaps = new Set<LayerBitmap>();
  switch (operation.kind) {
    case 'paint':
      if (operation.before) bitmaps.add(operation.before);
      if (operation.after) bitmaps.add(operation.after);
      if (operation.tiltmarkLayer?.before.base) bitmaps.add(operation.tiltmarkLayer.before.base);
      if (operation.tiltmarkLayer?.after.base) bitmaps.add(operation.tiltmarkLayer.after.base);
      break;
    case 'layerOp':
      for (const layer of operation.before) collectLayerBitmaps(layer, bitmaps);
      for (const layer of operation.after) collectLayerBitmaps(layer, bitmaps);
      break;
    case 'docResize':
      for (const layer of operation.before.layers) collectLayerBitmaps(layer, bitmaps);
      for (const layer of operation.after.layers) collectLayerBitmaps(layer, bitmaps);
      break;
    case 'documentState':
      collectDocumentBitmaps(operation.before, bitmaps);
      collectDocumentBitmaps(operation.after, bitmaps);
      break;
    case 'selection':
    case 'transform':
    case 'multiTransform':
      break;
    case 'convertDepth':
      break;
    case 'highBitPaint':
      break;
  }
  return bitmaps;
}

function operationPixelBuffers(operation: EditorOperation): Set<PixelBuffer> {
  const buffers = new Set<PixelBuffer>();
  switch (operation.kind) {
    case 'layerOp':
      for (const layer of operation.before) collectLayerPixelBuffers(layer, buffers);
      for (const layer of operation.after) collectLayerPixelBuffers(layer, buffers);
      break;
    case 'docResize':
      for (const layer of operation.before.layers) collectLayerPixelBuffers(layer, buffers);
      for (const layer of operation.after.layers) collectLayerPixelBuffers(layer, buffers);
      break;
    case 'documentState':
      for (const document of [operation.before, operation.after]) {
        for (const layer of document.layers) collectLayerPixelBuffers(layer, buffers);
        for (const snapshot of document.snapshots ?? []) {
          for (const layer of snapshot.layers) collectLayerPixelBuffers(layer, buffers);
        }
      }
      break;
    case 'paint':
    case 'selection':
    case 'transform':
    case 'multiTransform':
    case 'convertDepth':
    case 'highBitPaint':
      break;
  }
  return buffers;
}

function collectConvertDepthPixelBytes(state: {
  layers: Record<string, { pixels: PixelBuffer | null; pixelsVersion: number | undefined }>;
}): number {
  let bytes = 0;
  for (const layerState of Object.values(state.layers)) {
    bytes += Math.max(0, layerState.pixels?.data.byteLength ?? 0);
  }
  return bytes;
}

/** Exact RGBA8 bytes held by unique immutable bitmap/selection buffers in one operation. */
export function editorOperationRetainedBytes(operation: EditorOperation): number {
  let bytes = 0;
  for (const bitmap of operationBitmaps(operation)) {
    bytes += Math.max(0, bitmap.width) * Math.max(0, bitmap.height) * 4;
  }
  for (const pixels of operationPixelBuffers(operation)) {
    bytes += Math.max(0, pixels.data.byteLength);
  }
  if (operation.kind === 'selection') {
    bytes += operation.before?.data.byteLength ?? 0;
    bytes += operation.after?.data.byteLength ?? 0;
  }
  if (operation.kind === 'convertDepth') {
    bytes += collectConvertDepthPixelBytes(operation.before);
    bytes += collectConvertDepthPixelBytes(operation.after);
  }
  if (operation.kind === 'highBitPaint') {
    bytes += operation.before.data.byteLength + operation.after.data.byteLength;
  }
  if (operation.kind === 'documentState') {
    const selectionBuffers = new Set<ArrayBufferLike>();
    const cmykBuffers = new Set<ArrayBufferLike>();
    for (const document of [operation.before, operation.after]) {
      if (document.selectionMask) selectionBuffers.add(document.selectionMask.data.buffer);
      for (const snapshot of document.snapshots ?? []) {
        if (snapshot.selectionMask) selectionBuffers.add(snapshot.selectionMask.data.buffer);
      }
      for (const layer of document.layers) {
        if (layer.cmykPixels) cmykBuffers.add(layer.cmykPixels.data.buffer);
      }
    }
    for (const buffer of selectionBuffers) bytes += buffer.byteLength;
    for (const buffer of cmykBuffers) bytes += buffer.byteLength;
  }
  return bytes;
}

/**
 * Release only buffers created by retainEditorOperation. Replaying an entry
 * always materializes fresh live canvases, so zero-sizing these owned retained
 * canvases cannot invalidate the document currently being edited.
 */
export function disposeEditorOperation(operation: EditorOperation): void {
  if (!retainedHistoryOperations.has(operation)) return;
  for (const bitmap of operationBitmaps(operation)) {
    bitmap.width = 0;
    bitmap.height = 0;
  }
  for (const pixels of operationPixelBuffers(operation)) {
    pixels.data.fill(0);
  }
  if (operation.kind === 'convertDepth') {
    // Release the typed-array backing stores the same way canvases are zeroed.
    for (const state of [operation.before, operation.after]) {
      for (const layerState of Object.values(state.layers)) {
        layerState.pixels?.data.fill(0);
      }
    }
  }
  if (operation.kind === 'highBitPaint') {
    operation.before.data.fill(0);
    operation.after.data.fill(0);
  }
  if (operation.kind === 'documentState') {
    for (const document of [operation.before, operation.after]) {
      for (const layer of document.layers) layer.cmykPixels?.data.fill(0);
    }
  }
  retainedHistoryOperations.delete(operation);
}

export function disposeEditorOperations(operations: readonly EditorOperation[]): void {
  for (const operation of operations) disposeEditorOperation(operation);
}
