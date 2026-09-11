import type { EditorOperation } from '../../types/imageEditor';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { fromSnapshot } from './SelectionMask';
import { clearSelection, setSelection } from './selectionRegistry';
import {
  applyImageDocumentSelectionState,
  disposeImageDocumentSnapshotsRemoved,
} from './ImageSnapshots';
import {
  materializeHistoryBitmap,
  materializeHistoryDocument,
  materializeHistoryLayers,
} from './ImageHistoryResources';
import { clonePixelBuffer } from './pixels/PixelBuffer';
import { syncPixelBufferProxy } from './pixels/highBitTools';
import {
  releaseTiltmarkLayerSubstrate,
  restoreTiltmarkHistoryState,
} from './tiltmark/TiltmarkRuntime';

type Direction = 'undo' | 'redo';

/**
 * Apply an EditorOperation in either direction. Used by Ctrl+Z / Ctrl+Y
 * handlers and by tools that share the same op log.
 */
export function applyOperation(op: EditorOperation, direction: Direction): void {
  const state = useImageEditorStore.getState();
  const docId = op.docId;

  switch (op.kind) {
    case 'paint': {
      const targetBitmap = materializeHistoryBitmap(direction === 'undo' ? op.before : op.after);
      if (op.paintTarget === 'mask') {
        state.updateLayer(docId, op.layerId, { mask: targetBitmap });
      } else {
        state.updateLayer(docId, op.layerId, { bitmap: targetBitmap });
      }
      if (op.tiltmarkHistory) {
        restoreTiltmarkHistoryState(
          direction === 'undo'
            ? op.tiltmarkHistory.before
            : op.tiltmarkHistory.after,
        );
      }
      if (op.tiltmarkLayer) {
        const target = direction === 'undo'
          ? op.tiltmarkLayer.before
          : op.tiltmarkLayer.after;
        state.updateLayer(docId, op.layerId, {
          tiltmarkBaseBitmap: materializeHistoryBitmap(target.base),
          tiltmarkSimulationData: target.simulationData,
          metadata: target.metadata,
        });
        releaseTiltmarkLayerSubstrate(docId, op.layerId);
      }
      break;
    }
    case 'transform': {
      const target = direction === 'undo' ? op.before : op.after;
      state.updateLayer(docId, op.layerId, {
        x: target.x,
        y: target.y,
        rotationDeg: target.rotationDeg ?? 0,
        ...('skewXDeg' in target ? { skewXDeg: target.skewXDeg ?? 0 } : {}),
        ...('skewYDeg' in target ? { skewYDeg: target.skewYDeg ?? 0 } : {}),
        ...('perspectiveX' in target ? { perspectiveX: target.perspectiveX ?? 0 } : {}),
        ...('perspectiveY' in target ? { perspectiveY: target.perspectiveY ?? 0 } : {}),
        ...('warp' in target ? { warp: target.warp } : {}),
        ...('warpMesh' in target ? { warpMesh: target.warpMesh } : {}),
        ...('cornerOffsets' in target ? { cornerOffsets: target.cornerOffsets } : {}),
        ...('transformOriginX' in target ? { transformOriginX: target.transformOriginX } : {}),
        ...('transformOriginY' in target ? { transformOriginY: target.transformOriginY } : {}),
      });
      break;
    }
    case 'multiTransform': {
      const target = direction === 'undo' ? op.before : op.after;
      const current = useImageEditorStore.getState().documents.find((d) => d.id === docId);
      if (!current) return;
      const knownLayerIds = new Set(current.layers.map((layer) => layer.id));
      for (const [layerId, layerState] of Object.entries(target)) {
        if (!knownLayerIds.has(layerId)) continue;
        state.updateLayer(docId, layerId, {
          x: layerState.x,
          y: layerState.y,
          rotationDeg: layerState.rotationDeg ?? 0,
          ...('skewXDeg' in layerState ? { skewXDeg: layerState.skewXDeg ?? 0 } : {}),
          ...('skewYDeg' in layerState ? { skewYDeg: layerState.skewYDeg ?? 0 } : {}),
          ...('perspectiveX' in layerState ? { perspectiveX: layerState.perspectiveX ?? 0 } : {}),
          ...('perspectiveY' in layerState ? { perspectiveY: layerState.perspectiveY ?? 0 } : {}),
          ...('warp' in layerState ? { warp: layerState.warp } : {}),
          ...('warpMesh' in layerState ? { warpMesh: layerState.warpMesh } : {}),
          ...('cornerOffsets' in layerState ? { cornerOffsets: layerState.cornerOffsets } : {}),
          ...('transformOriginX' in layerState ? { transformOriginX: layerState.transformOriginX } : {}),
          ...('transformOriginY' in layerState ? { transformOriginY: layerState.transformOriginY } : {}),
        });
      }
      break;
    }
    case 'selection': {
      const target = direction === 'undo' ? op.before : op.after;
      if (target) {
        setSelection(docId, fromSnapshot(target));
        state.setHasSelection(docId, true);
      } else {
        clearSelection(docId);
        state.setHasSelection(docId, false);
      }
      break;
    }
    case 'layerOp': {
      const target = materializeHistoryLayers(direction === 'undo' ? op.before : op.after);
      const current = useImageEditorStore.getState().documents.find((d) => d.id === docId);
      if (!current) return;
      // Replay the snapshot atomically. Adding layers one at a time exposes
      // relationship resolvers to incomplete intermediate stacks, which can
      // permanently hide an otherwise-valid derived layer when it precedes
      // one of its source layers after a reorder.
      const activeLayerId = target.some((layer) => layer.id === current.activeLayerId)
        ? current.activeLayerId
        : (target[target.length - 1]?.id ?? null);
      state.setLayers(docId, target, activeLayerId);
      break;
    }
    case 'docResize': {
      const target = direction === 'undo' ? op.before : op.after;
      const current = useImageEditorStore.getState().documents.find((d) => d.id === docId);
      if (!current) return;
      state.setLayers(docId, materializeHistoryLayers(target.layers), target.activeLayerId);
      state.setDocumentDimensions(docId, target.width, target.height);
      break;
    }
    case 'documentState': {
      const target = applyImageDocumentSelectionState(
        materializeHistoryDocument(direction === 'undo' ? op.before : op.after),
      );
      const currentDocument = useImageEditorStore.getState().documents.find((doc) => doc.id === docId);
      if (currentDocument) disposeImageDocumentSnapshotsRemoved(currentDocument, target);
      useImageEditorStore.setState((currentState) => ({
        documents: currentState.documents.map((doc) => (doc.id === docId ? target : doc)),
      }));
      break;
    }
    case 'convertDepth': {
      // MH-009: restore each converted layer's pixel authority bit-exactly.
      // Canvases never change across a conversion, so only the authority and
      // the document working depth move.
      const target = direction === 'undo' ? op.before : op.after;
      const state = useImageEditorStore.getState();
      for (const [layerId, layerState] of Object.entries(target.layers)) {
        state.updateLayer(docId, layerId, {
          pixels: layerState.pixels,
          pixelsVersion: layerState.pixelsVersion,
        });
      }
      useImageEditorStore.setState((currentState) => ({
        documents: currentState.documents.map((doc) => (
          doc.id === docId
            ? { ...doc, metadata: { ...doc.metadata, bitDepth: target.bitDepth } }
            : doc
        )),
      }));
      break;
    }
    case 'highBitPaint': {
      const target = direction === 'undo' ? op.before : op.after;
      const currentLayer = useImageEditorStore.getState().documents
        .find((document) => document.id === docId)?.layers.find((layer) => layer.id === op.layerId);
      const pixels = clonePixelBuffer(target);
      syncPixelBufferProxy(pixels, currentLayer?.bitmap ?? null);
      state.updateLayer(docId, op.layerId, {
        pixels,
        pixelsVersion: direction === 'undo' ? op.beforeVersion : op.afterVersion,
        bitmapVersion: (currentLayer?.bitmapVersion ?? 0) + 1,
      });
      break;
    }
  }
}

export function undo(docId: string): boolean {
  const state = useImageEditorStore.getState();
  const op = state.popUndo(docId);
  if (!op) return false;
  applyOperation(op, 'undo');
  return true;
}

export function redo(docId: string): boolean {
  const state = useImageEditorStore.getState();
  const op = state.popRedo(docId);
  if (!op) return false;
  applyOperation(op, 'redo');
  return true;
}

export function jumpToHistoryUndoCount(docId: string, targetUndoCount: number): boolean {
  const state = useImageEditorStore.getState();
  const currentUndoCount = state.undoStacks[docId]?.length ?? 0;
  const currentRedoCount = state.redoStacks[docId]?.length ?? 0;
  const maxUndoCount = currentUndoCount + currentRedoCount;

  if (targetUndoCount < 0 || targetUndoCount > maxUndoCount) return false;
  if (targetUndoCount === currentUndoCount) return true;

  let changed = false;
  while ((useImageEditorStore.getState().undoStacks[docId]?.length ?? 0) > targetUndoCount) {
    if (!undo(docId)) return changed;
    changed = true;
  }
  while ((useImageEditorStore.getState().undoStacks[docId]?.length ?? 0) < targetUndoCount) {
    if (!redo(docId)) return changed;
    changed = true;
  }
  return changed;
}
