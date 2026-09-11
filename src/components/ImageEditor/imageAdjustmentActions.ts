import { useImageEditorStore } from '../../store/imageEditorStore';
import { createAdjustmentLayer } from './ImageAdjustmentLayer';
import {
  createCameraRawDevelopmentLayers,
  getCameraRawDevelopmentRefusal,
  type CameraRawDevelopmentDraft,
  type CameraRawDevelopmentRefusal,
} from './ImageCameraRawDevelopment';
import { addImageLayerUndoable } from './imageLayerInsert';
import type {
  AdjustmentLayerKind,
  ImageAdjustmentSettings,
  ImageLayer,
} from '../../types/imageEditor';

/**
 * Undoable adjustment-layer actions shared by the Layers panel and the
 * menu-driven Adjustments dialog, so both go through the exact same
 * create/commit + undo bookkeeping.
 */

/**
 * Add a non-destructive adjustment layer of `kind` to the active document and
 * make it active, recording one undoable layer operation. Returns the new
 * layer, or `null` when there is no active document.
 */
export function addAdjustmentLayerUndoable(kind: AdjustmentLayerKind): ImageLayer | null {
  const doc = useImageEditorStore.getState().getActiveDocument();
  if (!doc) return null;
  if (isHighBitMutationUnsupported(doc)) {
    dispatchHighBitAdjustmentRefusal(doc.metadata?.bitDepth);
    return null;
  }
  return addImageLayerUndoable(createAdjustmentLayer(doc, kind));
}

export type CameraRawDevelopmentApplyResult =
  | { status: 'applied'; layerIds: string[] }
  | { status: 'refused'; reason: CameraRawDevelopmentRefusal };

/**
 * Commits the bounded Camera Raw-style RGB development stack as exactly one ordinary layer history
 * operation. Native RAW decoding remains outside this route.
 */
export function addCameraRawDevelopmentStackUndoable(
  draft: Partial<CameraRawDevelopmentDraft> | null | undefined,
): CameraRawDevelopmentApplyResult {
  const store = useImageEditorStore.getState();
  const doc = store.getActiveDocument();
  if (!doc) return { status: 'refused', reason: 'no-photographic-pixels' };
  const refusal = getCameraRawDevelopmentRefusal(doc);
  if (refusal) return { status: 'refused', reason: refusal };
  if (doc.metadata?.bitDepth === 16 || doc.metadata?.bitDepth === 32) {
    dispatchHighBitAdjustmentRefusal(doc.metadata.bitDepth);
    return { status: 'refused', reason: 'high-bit-adjustment-unsupported' };
  }

  const before = doc.layers;
  const additions = createCameraRawDevelopmentLayers(doc, draft);
  const activeLayerId = additions[additions.length - 1]?.id ?? doc.activeLayerId;
  store.setLayers(doc.id, [...doc.layers, ...additions], activeLayerId);
  const after = store.getActiveDocument()?.layers;
  if (!after) return { status: 'refused', reason: 'no-photographic-pixels' };
  store.pushOperation({ kind: 'layerOp', docId: doc.id, before, after });
  return { status: 'applied', layerIds: additions.map((layer) => layer.id) };
}

/**
 * Commit edited adjustment settings onto an existing adjustment layer in the
 * active document, recording one undoable layer operation. No-op when the
 * document or layer is gone.
 */
export function commitAdjustmentSettingsUndoable(
  layerId: string,
  adjustment: ImageAdjustmentSettings,
): void {
  const store = useImageEditorStore.getState();
  const doc = store.getActiveDocument();
  if (!doc) return;
  if (isHighBitMutationUnsupported(doc)) {
    dispatchHighBitAdjustmentRefusal(doc.metadata?.bitDepth);
    return;
  }
  const target = doc.layers.find((layer) => layer.id === layerId);
  if (!target) return;
  const before = doc.layers;
  const next: ImageLayer = { ...target, adjustment };
  const after = doc.layers.map((layer) => (layer.id === layerId ? next : layer));
  store.pushOperation({ kind: 'layerOp', docId: doc.id, before, after });
  store.updateLayer(doc.id, layerId, next);
}

function isHighBitMutationUnsupported(doc: { metadata?: { bitDepth?: number } }): boolean {
  return doc.metadata?.bitDepth === 16 || doc.metadata?.bitDepth === 32;
}

function dispatchHighBitAdjustmentRefusal(bitDepth: number | undefined): void {
  const detail = {
    code: 'high-bit-adjustment-refused',
    bitDepth,
    message: `Refused before mutation: ${String(bitDepth)}-bit adjustment processing has no native round-trip authority; no pixels or history were changed.`,
  } as const;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sloom-high-bit-tool-refused', { detail }));
}
