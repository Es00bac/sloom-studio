import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { createMask, maskBoundingBox, type SelectionMask } from './SelectionMask';
import { clearAllSelections, getSelection, setSelection } from './selectionRegistry';
import * as selectionTransform from './ImageSelectionTransform';
import {
  applySelectionTransformSession,
  beginSelectionTransformSession,
  cancelSelectionTransformSession,
  clearSelectionTransformSession,
  getSelectionTransformSession,
  setSelectionTransformMode,
  updateSelectionTransformDistortCornerOffset,
  updateSelectionTransformRotation,
  updateSelectionTransformSkew,
  updateSelectionTransformBounds,
} from './ImageSelectionTransform';

type DescribeSelectionTransformSession = (
  session: ReturnType<typeof getSelectionTransformSession>,
  options?: { requestedSemantics?: Array<'perspective' | 'warp' | 'refine'> },
) => unknown;

function seedMoveMask(): SelectionMask {
  const mask = createMask(10, 10);
  mask.data[2 * mask.width + 2] = 255;
  mask.data[2 * mask.width + 3] = 255;
  mask.data[3 * mask.width + 2] = 255;
  return mask;
}

function seedScaleMask(): SelectionMask {
  const mask = createMask(10, 10);
  mask.data[1 * mask.width + 1] = 255;
  mask.data[2 * mask.width + 2] = 255;
  return mask;
}

function openDoc(id = 'doc-selection-transform') {
  const doc = createEmptyImageDocument({
    id,
    title: 'Selection Transform',
    width: 10,
    height: 10,
  });
  useImageEditorStore.getState().openDocument(doc);
  return doc;
}

describe('ImageSelectionTransform', () => {
  beforeEach(() => {
    clearSelectionTransformSession();
    clearAllSelections();
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
  });

  it('updates the live selection preview when the target bounds move', () => {
    const doc = openDoc();
    const selection = seedMoveMask();
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    const session = beginSelectionTransformSession(doc.id);
    expect(session?.beforeBounds).toEqual({ x: 2, y: 2, width: 2, height: 2 });

    expect(updateSelectionTransformBounds(doc.id, { x: 5, y: 4, width: 2, height: 2 })).toBe(true);

    const preview = getSelection(doc.id)!;
    expect(maskBoundingBox(preview)).toEqual({ x: 5, y: 4, width: 2, height: 2 });
    expect(preview.data[4 * preview.width + 5]).toBe(255);
    expect(preview.data[4 * preview.width + 6]).toBe(255);
    expect(preview.data[5 * preview.width + 5]).toBe(255);
  });

  it('scales the original selection mask content instead of only moving the bounding box', () => {
    const doc = openDoc('doc-selection-scale');
    const selection = seedScaleMask();
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    beginSelectionTransformSession(doc.id);
    expect(updateSelectionTransformBounds(doc.id, { x: 4, y: 4, width: 4, height: 4 })).toBe(true);

    const preview = getSelection(doc.id)!;
    expect(maskBoundingBox(preview)).toEqual({ x: 4, y: 4, width: 4, height: 4 });
    expect(preview.data[4 * preview.width + 4]).toBe(255);
    expect(preview.data[4 * preview.width + 5]).toBe(255);
    expect(preview.data[5 * preview.width + 5]).toBe(255);
    expect(preview.data[4 * preview.width + 6]).toBe(0);
    expect(preview.data[6 * preview.width + 4]).toBe(0);
    expect(preview.data[7 * preview.width + 7]).toBe(255);
  });

  it('applies a pending selection transform as an undoable selection operation', () => {
    const doc = openDoc('doc-selection-apply');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    const requestRender = vi.fn();

    beginSelectionTransformSession(doc.id);
    updateSelectionTransformBounds(doc.id, { x: 4, y: 5, width: 2, height: 2 });

    const operation = applySelectionTransformSession(doc.id, requestRender);

    expect(operation).toMatchObject({
      kind: 'selection',
      docId: doc.id,
      before: { width: 10, height: 10 },
      after: { width: 10, height: 10 },
    });
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: doc.id,
    });
    expect(getSelectionTransformSession(doc.id)).toBeNull();
  });

  it('rotates the live selection preview around the target bounds center', () => {
    const doc = openDoc('doc-selection-rotate');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    beginSelectionTransformSession(doc.id);
    expect(updateSelectionTransformRotation(doc.id, 90)).toBe(true);

    const preview = getSelection(doc.id)!;
    expect(maskBoundingBox(preview)).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(preview.data[2 * preview.width + 2]).toBe(255);
    expect(preview.data[2 * preview.width + 3]).toBe(255);
    expect(preview.data[3 * preview.width + 3]).toBe(255);
    expect(preview.data[3 * preview.width + 2]).toBe(0);
    expect(getSelectionTransformSession(doc.id)?.currentRotationDeg).toBe(90);
  });

  it('skews the live selection preview and tracks skew session state', () => {
    const doc = openDoc('doc-selection-skew');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    beginSelectionTransformSession(doc.id);
    expect(updateSelectionTransformSkew(doc.id, { skewXDeg: 45 })).toBe(true);

    const preview = getSelection(doc.id)!;
    expect(maskBoundingBox(preview)).toEqual({ x: 1, y: 2, width: 3, height: 2 });
    expect(preview.data[2 * preview.width + 1]).toBe(255);
    expect(preview.data[2 * preview.width + 2]).toBe(255);
    expect(preview.data[3 * preview.width + 2]).toBe(255);
    expect(getSelectionTransformSession(doc.id)?.currentSkewXDeg).toBe(45);
    expect(getSelectionTransformSession(doc.id)?.currentSkewYDeg).toBe(0);
  });

  it('distorts the live selection preview from a direct corner update and tracks the active mode', () => {
    const doc = openDoc('doc-selection-distort');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    beginSelectionTransformSession(doc.id);
    expect(setSelectionTransformMode(doc.id, 'distort')).toBe(true);
    expect(updateSelectionTransformDistortCornerOffset(doc.id, 'ne', { x: 2, y: -1 })).toBe(true);

    const preview = getSelection(doc.id)!;
    expect(maskBoundingBox(preview)).toEqual({ x: 2, y: 1, width: 4, height: 3 });
    expect(preview.data[1 * preview.width + 4]).toBe(255);
    expect(preview.data[2 * preview.width + 3]).toBe(255);
    expect(getSelectionTransformSession(doc.id)?.currentMode).toBe('distort');
    expect(getSelectionTransformSession(doc.id)?.currentCornerOffsets.ne).toEqual({ x: 2, y: -1 });
  });

  it('cancels a pending transform by restoring the original selection without pushing history', () => {
    const doc = openDoc('doc-selection-cancel');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    const requestRender = vi.fn();

    beginSelectionTransformSession(doc.id);
    updateSelectionTransformBounds(doc.id, { x: 6, y: 6, width: 2, height: 2 });

    expect(cancelSelectionTransformSession(doc.id, requestRender)).toBe(true);
    expect(maskBoundingBox(getSelection(doc.id)!)).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(useImageEditorStore.getState().undoStacks[doc.id]).toBeUndefined();
    expect(getSelectionTransformSession(doc.id)).toBeNull();
  });

  it('describes inactive selection transform readiness without mutating selection state', () => {
    const describeSelectionTransformSession = (
      selectionTransform as unknown as { describeSelectionTransformSession?: DescribeSelectionTransformSession }
    ).describeSelectionTransformSession;

    expect(describeSelectionTransformSession?.(null)).toEqual({
      state: 'inactive',
      docId: null,
      mode: null,
      beforeBounds: null,
      targetBounds: null,
      operations: [
        { kind: 'move', active: false, from: null, to: null, delta: { x: 0, y: 0 } },
        { kind: 'resize', active: false, from: null, to: null, scale: { x: 1, y: 1 } },
        { kind: 'rotate', active: false, rotationDeg: 0 },
        { kind: 'skew', active: false, skewXDeg: 0, skewYDeg: 0 },
        {
          kind: 'distort',
          active: false,
          cornerOffsets: {
            nw: { x: 0, y: 0 },
            ne: { x: 0, y: 0 },
            se: { x: 0, y: 0 },
            sw: { x: 0, y: 0 },
          },
          movedCorners: [],
        },
      ],
      readiness: {
        apply: { ready: false, reason: 'no-active-session' },
        cancel: { ready: false, reason: 'no-active-session' },
      },
      warnings: [],
      signature: 'selection-transform:inactive',
    });
  });

  it('builds deterministic planning descriptors for pending selection transform state', () => {
    const doc = openDoc('doc-selection-descriptor');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    const describeSelectionTransformSession = (
      selectionTransform as unknown as { describeSelectionTransformSession?: DescribeSelectionTransformSession }
    ).describeSelectionTransformSession;

    beginSelectionTransformSession(doc.id);
    updateSelectionTransformBounds(doc.id, { x: 4, y: 5, width: 6, height: 4 });
    updateSelectionTransformRotation(doc.id, 90);
    updateSelectionTransformSkew(doc.id, { skewXDeg: 15, skewYDeg: -10 });
    setSelectionTransformMode(doc.id, 'distort');
    updateSelectionTransformDistortCornerOffset(doc.id, 'ne', { x: 1.5, y: -2 });

    expect(describeSelectionTransformSession?.(getSelectionTransformSession(doc.id), {
      requestedSemantics: ['perspective', 'warp'],
    })).toEqual({
      state: 'pending',
      docId: doc.id,
      mode: 'distort',
      beforeBounds: { x: 2, y: 2, width: 2, height: 2 },
      targetBounds: { x: 4, y: 5, width: 6, height: 4 },
      operations: [
        { kind: 'move', active: true, from: { x: 2, y: 2 }, to: { x: 4, y: 5 }, delta: { x: 2, y: 3 } },
        { kind: 'resize', active: true, from: { width: 2, height: 2 }, to: { width: 6, height: 4 }, scale: { x: 3, y: 2 } },
        { kind: 'rotate', active: true, rotationDeg: 90 },
        { kind: 'skew', active: true, skewXDeg: 15, skewYDeg: -10 },
        {
          kind: 'distort',
          active: true,
          cornerOffsets: {
            nw: { x: 0, y: 0 },
            ne: { x: 1.5, y: -2 },
            se: { x: 0, y: 0 },
            sw: { x: 0, y: 0 },
          },
          movedCorners: ['ne'],
        },
      ],
      readiness: {
        apply: { ready: true, reason: 'pending-changes' },
        cancel: { ready: true, reason: 'active-session' },
      },
      warnings: [
        {
          code: 'unsupported-perspective-selection-semantics',
          severity: 'warning',
          message: 'Perspective selection transforms are not supported for pixel selections; distort corner offsets are tracked as a bounded quad preview only.',
        },
        {
          code: 'unsupported-warp-selection-semantics',
          severity: 'warning',
          message: 'Warp selection transforms are not supported for pixel selections; use layer-side warp or apply the selection before raster deformation.',
        },
      ],
      signature: 'selection-transform:doc-selection-descriptor:distort:2,2,2,2:4,5,6,4:90:15:-10:0,0|1.5,-2|0,0|0,0',
    });
  });

  it('keeps apply disabled but cancel ready for an unchanged active transform session', () => {
    const doc = openDoc('doc-selection-unchanged-descriptor');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);
    const describeSelectionTransformSession = (
      selectionTransform as unknown as { describeSelectionTransformSession?: DescribeSelectionTransformSession }
    ).describeSelectionTransformSession;

    beginSelectionTransformSession(doc.id);

    expect(describeSelectionTransformSession?.(getSelectionTransformSession(doc.id))).toMatchObject({
      state: 'unchanged',
      readiness: {
        apply: { ready: false, reason: 'no-pending-changes' },
        cancel: { ready: true, reason: 'active-session' },
      },
    });
  });

  it('summarizes selection transform readiness with numeric geometry, handles, signatures, and output targets', () => {
    const doc = openDoc('doc-selection-readiness-summary');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    beginSelectionTransformSession(doc.id);
    updateSelectionTransformBounds(doc.id, { x: 4.4, y: 5.2, width: 6.6, height: 3.8 });
    updateSelectionTransformRotation(doc.id, -90);
    updateSelectionTransformSkew(doc.id, { skewXDeg: 12.345, skewYDeg: -80 });
    setSelectionTransformMode(doc.id, 'distort');
    updateSelectionTransformDistortCornerOffset(doc.id, 'sw', { x: -1.25, y: 2.5 });

    expect(selectionTransform.describeImageSelectionTransformReadiness(doc.id, {
      requestedSemantics: ['perspective', 'warp', 'refine'],
    })).toEqual({
      state: 'pending',
      docId: doc.id,
      mode: 'distort',
      geometry: {
        before: { x: 2, y: 2, width: 2, height: 2 },
        target: { x: 4, y: 5, width: 7, height: 4 },
        delta: { x: 2, y: 3 },
        scale: { x: 3.5, y: 2 },
        pivot: {
          anchor: 'selection-center',
          editable: false,
          point: { x: 7.5, y: 7 },
          signature: 'selection-transform-pivot:v1:doc-selection-readiness-summary:selection-center:7.5,7',
        },
        rotationDeg: 270,
        skewXDeg: 12.35,
        skewYDeg: -75,
        numericSummary: 'x=4,y=5,w=7,h=4,rot=270,skewX=12.35,skewY=-75',
        signature: 'selection-transform-geometry:v1:doc-selection-readiness-summary:2,2,2,2:4,5,7,4:pivot=7.5,7:rot=270:skew=12.35,-75',
      },
      handles: {
        move: { ready: true, active: true },
        resize: { ready: true, active: true },
        rotate: { ready: true, active: true },
        skew: { ready: true, active: true, xDeg: 12.35, yDeg: -75 },
        distort: {
          ready: true,
          active: true,
          handles: [
            { corner: 'nw', x: 0, y: 0, moved: false },
            { corner: 'ne', x: 0, y: 0, moved: false },
            { corner: 'se', x: 0, y: 0, moved: false },
            { corner: 'sw', x: -1.25, y: 2.5, moved: true },
          ],
          movedCorners: ['sw'],
        },
      },
      readiness: {
        apply: { ready: true, reason: 'pending-changes' },
        cancel: { ready: true, reason: 'active-session' },
      },
      actionPreview: {
        apply: {
          ready: true,
          source: 'live-preview-selection-mask',
          commitsTo: 'document-selection-registry',
          history: 'undoable-selection-history',
          reason: 'pending-changes',
        },
        cancel: {
          ready: true,
          restores: 'before-selection-snapshot',
          clearsPreview: true,
          reason: 'active-session',
        },
        signature: 'selection-transform-action-preview:v1:doc-selection-readiness-summary:pending:apply=pending-changes:true:cancel=active-session:true:preview=ready',
      },
      blockers: [],
      caveats: [
        {
          code: 'skew-affine-selection-mask-preview',
          mode: 'skew',
          support: 'supported',
          active: true,
          message: 'Skew updates the selection mask preview with affine edge offsets, then commits pixels; no editable skew object is preserved after apply.',
        },
        {
          code: 'distort-bounded-quad-selection-mask-preview',
          mode: 'distort',
          support: 'limited',
          active: true,
          message: 'Distort tracks four corner offsets as a bounded quad preview; true perspective or warp selection semantics are not preserved.',
        },
      ],
      overlayStates: [
        {
          code: 'marching-ants-live-transform-unsupported',
          supported: false,
          fallback: 'static-transform-bounds-and-handles',
          message: 'Animated marching ants are not generated for active Transform Selection previews; static bounds and handles identify the pending selection.',
        },
        {
          code: 'selection-overlay-blend-preview-unsupported',
          supported: false,
          fallback: 'selection-transform-preview-overlay',
          message: 'Photoshop-style transformed overlay blending is not generated; the live selection mask preview and transform outline are the available preview surfaces.',
        },
      ],
      refineHandoff: {
        target: 'select-and-mask',
        ready: false,
        source: 'document-selection-registry',
        requirement: 'apply-or-cancel-active-transform-first',
        blockers: ['active-transform-session'],
        preservesEditableTransform: false,
        signature: 'selection-transform-refine-handoff:v1:doc-selection-readiness-summary:blocked:apply-or-cancel-active-transform-first:active-transform-session',
      },
      unsupportedIntegrations: [
        { kind: 'perspective', supported: false, warningCode: 'unsupported-perspective-selection-semantics' },
        { kind: 'warp', supported: false, warningCode: 'unsupported-warp-selection-semantics' },
        { kind: 'refine', supported: false, warningCode: 'unsupported-refine-selection-transform-integration' },
      ],
      preview: {
        ready: true,
        changed: true,
        target: 'selection-transform-preview-overlay',
        signature: 'selection-transform-preview:v1:doc-selection-readiness-summary:distort:2,2,2,2:4,5,7,4:270:12.35:-75:0,0|0,0|0,0|-1.25,2.5',
      },
      outputTargets: [
        { id: 'preview-selection-mask', ready: true, target: 'selection-transform-preview-overlay' },
        { id: 'apply-selection-mask', ready: true, target: 'document-selection-registry' },
        { id: 'undo-history', ready: true, target: 'undoable-selection-history' },
        { id: 'refine-workspace', ready: false, target: 'select-and-mask-handoff-unsupported' },
      ],
      signature: 'selection-transform-readiness:v1:doc-selection-readiness-summary:pending:selection-transform-preview:v1:doc-selection-readiness-summary:distort:2,2,2,2:4,5,7,4:270:12.35:-75:0,0|0,0|0,0|-1.25,2.5:none',
    });
  });

  it('reports empty-selection blockers and disabled outputs without starting a transform session', () => {
    const doc = openDoc('doc-selection-readiness-empty');

    expect(selectionTransform.describeImageSelectionTransformReadiness(doc.id)).toEqual({
      state: 'inactive',
      docId: doc.id,
      mode: null,
      geometry: {
        before: null,
        target: null,
        delta: { x: 0, y: 0 },
        scale: { x: 1, y: 1 },
        pivot: {
          anchor: 'none',
          editable: false,
          point: null,
          signature: 'selection-transform-pivot:v1:doc-selection-readiness-empty:none:none',
        },
        rotationDeg: 0,
        skewXDeg: 0,
        skewYDeg: 0,
        numericSummary: 'x=none,y=none,w=none,h=none,rot=0,skewX=0,skewY=0',
        signature: 'selection-transform-geometry:v1:doc-selection-readiness-empty:inactive:none',
      },
      handles: {
        move: { ready: false, active: false },
        resize: { ready: false, active: false },
        rotate: { ready: false, active: false },
        skew: { ready: false, active: false, xDeg: 0, yDeg: 0 },
        distort: {
          ready: false,
          active: false,
          handles: [
            { corner: 'nw', x: 0, y: 0, moved: false },
            { corner: 'ne', x: 0, y: 0, moved: false },
            { corner: 'se', x: 0, y: 0, moved: false },
            { corner: 'sw', x: 0, y: 0, moved: false },
          ],
          movedCorners: [],
        },
      },
      readiness: {
        apply: { ready: false, reason: 'no-active-session' },
        cancel: { ready: false, reason: 'no-active-session' },
      },
      actionPreview: {
        apply: {
          ready: false,
          source: 'none',
          commitsTo: 'none',
          history: 'none',
          reason: 'no-active-session',
        },
        cancel: {
          ready: false,
          restores: 'none',
          clearsPreview: false,
          reason: 'no-active-session',
        },
        signature: 'selection-transform-action-preview:v1:doc-selection-readiness-empty:inactive:apply=no-active-session:false:cancel=no-active-session:false:preview=blocked',
      },
      blockers: [
        {
          code: 'empty-selection',
          severity: 'blocker',
          message: 'Transform Selection requires a non-empty active selection before preview, apply, or output targets can be prepared.',
        },
      ],
      caveats: [
        {
          code: 'skew-affine-selection-mask-preview',
          mode: 'skew',
          support: 'supported',
          active: false,
          message: 'Skew updates the selection mask preview with affine edge offsets, then commits pixels; no editable skew object is preserved after apply.',
        },
        {
          code: 'distort-bounded-quad-selection-mask-preview',
          mode: 'distort',
          support: 'limited',
          active: false,
          message: 'Distort tracks four corner offsets as a bounded quad preview; true perspective or warp selection semantics are not preserved.',
        },
      ],
      overlayStates: [
        {
          code: 'marching-ants-live-transform-unsupported',
          supported: false,
          fallback: 'static-transform-bounds-and-handles',
          message: 'Animated marching ants are not generated for active Transform Selection previews; static bounds and handles identify the pending selection.',
        },
        {
          code: 'selection-overlay-blend-preview-unsupported',
          supported: false,
          fallback: 'selection-transform-preview-overlay',
          message: 'Photoshop-style transformed overlay blending is not generated; the live selection mask preview and transform outline are the available preview surfaces.',
        },
      ],
      refineHandoff: {
        target: 'select-and-mask',
        ready: false,
        source: 'none',
        requirement: 'requires-active-selection',
        blockers: ['empty-selection'],
        preservesEditableTransform: false,
        signature: 'selection-transform-refine-handoff:v1:doc-selection-readiness-empty:blocked:requires-active-selection:empty-selection',
      },
      unsupportedIntegrations: [],
      preview: {
        ready: false,
        changed: false,
        target: 'none',
        signature: 'selection-transform-preview:v1:doc-selection-readiness-empty:inactive:none',
      },
      outputTargets: [
        { id: 'preview-selection-mask', ready: false, target: 'selection-transform-preview-overlay' },
        { id: 'apply-selection-mask', ready: false, target: 'document-selection-registry' },
        { id: 'undo-history', ready: false, target: 'undoable-selection-history' },
        { id: 'refine-workspace', ready: false, target: 'select-and-mask-handoff-unsupported' },
      ],
      signature: 'selection-transform-readiness:v1:doc-selection-readiness-empty:inactive:selection-transform-preview:v1:doc-selection-readiness-empty:inactive:none:empty-selection',
    });
    expect(beginSelectionTransformSession(doc.id)).toBeNull();
  });

  it('reports committed-selection refine handoff readiness when no transform session is active', () => {
    const doc = openDoc('doc-selection-refine-ready');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    const readiness = selectionTransform.describeImageSelectionTransformReadiness(doc.id);

    expect(readiness.state).toBe('inactive');
    expect(readiness.refineHandoff).toEqual({
      target: 'select-and-mask',
      ready: true,
      source: 'document-selection-registry',
      requirement: 'committed-selection-ready',
      blockers: [],
      preservesEditableTransform: false,
      signature: 'selection-transform-refine-handoff:v1:doc-selection-refine-ready:ready:committed-selection-ready:none',
    });
    expect(readiness.outputTargets.find((target) => target.id === 'refine-workspace')).toEqual({
      id: 'refine-workspace',
      ready: true,
      target: 'select-and-mask-handoff',
    });
  });

  it('summarizes transform preview blockers with a stable handoff signature', () => {
    const doc = openDoc('doc-selection-transform-blockers');
    setSelection(doc.id, seedMoveMask());
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    const idleReadiness = selectionTransform.describeImageSelectionTransformReadiness(doc.id);
    expect(selectionTransform.describeSelectionTransformPreviewBlockers(idleReadiness)).toEqual({
      kind: 'selection-transform-preview-blockers',
      stableHandoffId: 'selection-transform-handoff:v1:doc-selection-transform-blockers:inactive:none',
      previewReady: false,
      applyReady: false,
      refineReady: true,
      blockers: [
        {
          code: 'preview-session-missing',
          severity: 'blocker',
          blocksPreview: true,
          blocksApply: true,
          blocksRefineHandoff: false,
          message: 'Transform Selection preview requires an active transform session.',
        },
        {
          code: 'no-pending-transform-changes',
          severity: 'blocker',
          blocksPreview: false,
          blocksApply: true,
          blocksRefineHandoff: false,
          message: 'Apply is unavailable until the active transform changes the selection mask.',
        },
      ],
      signature: 'selection-transform-preview-blockers:v1:selection-transform-handoff:v1:doc-selection-transform-blockers:inactive:none:preview0:apply0:refine1:preview-session-missing|no-pending-transform-changes',
    });

    beginSelectionTransformSession(doc.id);
    const activeReadiness = selectionTransform.describeImageSelectionTransformReadiness(doc.id);
    expect(selectionTransform.describeSelectionTransformPreviewBlockers(activeReadiness)).toMatchObject({
      stableHandoffId: 'selection-transform-handoff:v1:doc-selection-transform-blockers:unchanged:resize',
      previewReady: true,
      applyReady: false,
      refineReady: false,
      blockers: [
        expect.objectContaining({
          code: 'no-pending-transform-changes',
          blocksApply: true,
        }),
        expect.objectContaining({
          code: 'active-transform-session',
          blocksRefineHandoff: true,
        }),
      ],
    });
  });
});
