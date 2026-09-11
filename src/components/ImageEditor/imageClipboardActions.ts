import { useImageEditorStore } from '../../store/imageEditorStore';
import { getSelection } from './selectionRegistry';
import {
  copyLayerPixelsToClipboard,
  createPastedLayerFromClipboard,
  deleteSelectedLayerPixels,
} from './ImageEditorClipboard';

/**
 * Edit-clipboard actions for the active image document/layer. Each operates on the live store state
 * (no React context needed) so they can be invoked from keyboard shortcuts, the context menu, and the
 * tools-palette edit buttons alike. Returns true when the action did something.
 */

function getActiveDocumentAndLayer() {
  const state = useImageEditorStore.getState();
  const doc = state.documents.find((d) => d.id === state.activeDocId);
  const layer = doc?.layers.find((l) => l.id === doc.activeLayerId) ?? null;
  return { doc, layer, state };
}

export function copyActiveImageSelection(): boolean {
  const { doc, layer } = getActiveDocumentAndLayer();
  if (!doc || !layer) return false;
  return copyLayerPixelsToClipboard(doc, layer, getSelection(doc.id) ?? null);
}

export function pasteImageClipboard(): boolean {
  const state = useImageEditorStore.getState();
  const doc = state.documents.find((d) => d.id === state.activeDocId);
  if (!doc) return false;
  const layer = createPastedLayerFromClipboard();
  if (!layer) return false;

  const before = doc.layers;
  const activeLayerIndex = doc.activeLayerId
    ? doc.layers.findIndex((candidate) => candidate.id === doc.activeLayerId)
    : -1;
  const insertAt = activeLayerIndex >= 0 ? activeLayerIndex + 1 : doc.layers.length;
  state.addLayer(doc.id, layer, insertAt);
  const after =
    useImageEditorStore.getState().documents.find((candidate) => candidate.id === doc.id)
      ?.layers ?? before;
  useImageEditorStore.getState().pushOperation({
    kind: 'layerOp',
    docId: doc.id,
    before,
    after,
  });
  return true;
}

export function deleteActiveLayer(): boolean {
  const { doc, layer, state } = getActiveDocumentAndLayer();
  if (!doc || !layer) return false;

  const before = doc.layers;
  state.removeLayer(doc.id, layer.id);
  const after =
    useImageEditorStore.getState().documents.find((candidate) => candidate.id === doc.id)
      ?.layers ?? [];
  useImageEditorStore.getState().pushOperation({
    kind: 'layerOp',
    docId: doc.id,
    before,
    after,
  });
  return true;
}

export function deleteActiveImageSelection(): boolean {
  const { doc, layer, state } = getActiveDocumentAndLayer();
  if (!doc || !layer) return false;

  const selection = getSelection(doc.id) ?? null;
  if (selection) {
    const op = deleteSelectedLayerPixels(doc, layer, selection);
    if (!op) return false;
    state.pushOperation(op);
    state.bumpLayerBitmapVersion(doc.id, layer.id);
    state.markDocumentDirty(doc.id);
    return true;
  }

  return deleteActiveLayer();
}

export function cutActiveImageSelection(): boolean {
  const copied = copyActiveImageSelection();
  if (!copied) return false;
  return deleteActiveImageSelection();
}

/** True when there is an active document with an active layer (i.e. copy/cut can run). */
export function canRunImageClipboardActions(): boolean {
  const { doc, layer } = getActiveDocumentAndLayer();
  return Boolean(doc && layer);
}
