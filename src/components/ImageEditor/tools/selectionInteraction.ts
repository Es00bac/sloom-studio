import {
  cloneMask,
  combineMasks,
  createMask,
  type SelectionMask,
} from '../SelectionMask';
import { clearFloatingSelection, getSelection, setSelection } from '../selectionRegistry';
import { featherSelection } from '../photoshopQuickActions/selectionActions';
import type { ToolEnv } from './types';
import type { SelectionMode } from '../../../types/imageEditor';

export type SelectionModeOperation =
  | 'replace-existing-selection'
  | 'add-to-existing-selection'
  | 'remove-from-existing-selection'
  | 'keep-overlap-with-existing-selection';

export interface SelectionModeSemanticsDescriptor {
  descriptorId: 'selection-mode-semantics:v1';
  mode: SelectionMode;
  operation: SelectionModeOperation;
  baseSelection: 'captured-at-stroke-start';
  previewTarget: 'document-selection-registry';
  commitTarget: 'document-selection-history';
  emptyResult: 'clears-document-selection';
  transformSelectionHandoff: {
    target: 'transform-selection';
    readiness: 'requires-committed-selection';
    source: 'document-selection-registry';
    commitBoundary: 'after-selection-commit';
  };
  refineSelectionHandoff: {
    target: 'select-and-mask';
    readiness: 'requires-committed-selection';
    source: 'document-selection-registry';
    transformBoundary: 'apply-or-cancel-active-transform-first';
    preservesTransformPreview: false;
    signature: string;
  };
  previewSignature: string;
}

export function describeSelectionModeSemantics(
  mode: SelectionMode,
): SelectionModeSemanticsDescriptor {
  const descriptor = {
    descriptorId: 'selection-mode-semantics:v1' as const,
    mode,
    operation: getSelectionModeOperation(mode),
    baseSelection: 'captured-at-stroke-start' as const,
    previewTarget: 'document-selection-registry' as const,
    commitTarget: 'document-selection-history' as const,
    emptyResult: 'clears-document-selection' as const,
    transformSelectionHandoff: {
      target: 'transform-selection' as const,
      readiness: 'requires-committed-selection' as const,
      source: 'document-selection-registry' as const,
      commitBoundary: 'after-selection-commit' as const,
    },
    refineSelectionHandoff: {
      target: 'select-and-mask' as const,
      readiness: 'requires-committed-selection' as const,
      source: 'document-selection-registry' as const,
      transformBoundary: 'apply-or-cancel-active-transform-first' as const,
      preservesTransformPreview: false as const,
      signature: buildSelectionRefineHandoffSignature(mode),
    },
  };

  return {
    ...descriptor,
    previewSignature: buildSelectionModeSemanticsPreviewSignature(descriptor),
  };
}

/**
 * Common helper used by every selection tool. Captures the committed mask at
 * stroke start, then on every update rasterizes the tool's transient shape
 * into a fresh mask, combines with the captured mask under the resolved mode,
 * and writes the result into the selection registry. On finish the same merge
 * is committed (the registry is already up to date) and the doc's
 * `hasSelection` flag is bumped.
 */
export class SelectionInteraction {
  private capturedBase: SelectionMask;
  private mode: SelectionMode;
  private docId: string;

  constructor(env: ToolEnv, mode: SelectionMode) {
    this.docId = env.doc.id;
    this.mode = mode;
    const existing = getSelection(this.docId);
    this.capturedBase = existing
      ? cloneMask(existing)
      : createMask(env.doc.width, env.doc.height);
  }

  /**
   * Apply the supplied "shape" mask under the current mode against the captured
   * base, and write the result into the registry. Bumps selection version so
   * the renderer re-paints. Does not yet flag the doc as having-selection.
   */
  preview(env: ToolEnv, shape: SelectionMask): void {
    const next = cloneMask(this.capturedBase);
    combineMasks(next, getToolShapeMask(shape, env.selectionToolSettings.feather), this.mode);
    setSelection(this.docId, next);
    env.store.bumpSelectionVersion(this.docId);
    env.requestRender();
  }

  /**
   * Commit the latest preview into the document state. After this call,
   * `doc.hasSelection` reflects whether the resulting mask has any non-zero
   * pixels. The undo entry captures the before/after snapshots.
   */
  commit(env: ToolEnv): void {
    // A freshly drawn/edited selection breaks any association with pixels floated by a prior Move
    // drag, so the next move lifts from the source again instead of grabbing the old float layer.
    clearFloatingSelection(this.docId);
    const finalMask = getSelection(this.docId);
    if (!finalMask) return;
    const isEmpty = !maskHasAlpha(finalMask);
    env.pushOperation({
      kind: 'selection',
      docId: this.docId,
      before: maskHasAlpha(this.capturedBase)
        ? { width: this.capturedBase.width, height: this.capturedBase.height, data: this.capturedBase.data.slice() }
        : null,
      after: isEmpty
        ? null
        : { width: finalMask.width, height: finalMask.height, data: finalMask.data.slice() },
    });
    env.store.setHasSelection(this.docId, !isEmpty);
  }

  /** Restore the original mask without committing. */
  cancel(env: ToolEnv): void {
    if (maskHasAlpha(this.capturedBase)) {
      setSelection(this.docId, cloneMask(this.capturedBase));
    } else {
      setSelection(this.docId, createMask(env.doc.width, env.doc.height));
    }
    env.store.bumpSelectionVersion(this.docId);
    env.requestRender();
  }
}

function maskHasAlpha(mask: SelectionMask): boolean {
  for (let i = 0; i < mask.data.length; i += 1) {
    if (mask.data[i] > 0) return true;
  }
  return false;
}

function getToolShapeMask(shape: SelectionMask, featherPx: number): SelectionMask {
  if (!Number.isFinite(featherPx) || featherPx <= 0) return shape;
  return featherSelection(shape, featherPx);
}

function getSelectionModeOperation(mode: SelectionMode): SelectionModeOperation {
  if (mode === 'add') return 'add-to-existing-selection';
  if (mode === 'subtract') return 'remove-from-existing-selection';
  if (mode === 'intersect') return 'keep-overlap-with-existing-selection';
  return 'replace-existing-selection';
}

function buildSelectionRefineHandoffSignature(mode: SelectionMode): string {
  return `selection-refine-handoff:v1:${mode}:requires-committed-selection:apply-or-cancel-active-transform-first`;
}

function buildSelectionModeSemanticsPreviewSignature(
  descriptor: Omit<SelectionModeSemanticsDescriptor, 'previewSignature'>,
): string {
  return `selection-mode-semantics:v2:${JSON.stringify({
    mode: descriptor.mode,
    operation: descriptor.operation,
    previewTarget: descriptor.previewTarget,
    commitTarget: descriptor.commitTarget,
    transformSelectionHandoff: descriptor.transformSelectionHandoff,
  })}`;
}
