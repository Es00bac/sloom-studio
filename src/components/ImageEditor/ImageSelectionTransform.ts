import { useImageEditorStore } from '../../store/imageEditorStore';
import type { SelectionMaskSnapshot } from '../../types/imageEditor';
import type { EditorOperation } from '../../types/imageEditor';
import type { Point } from './viewport';
import {
  createMask,
  fromSnapshot,
  maskBoundingBox,
  toSnapshot,
  type SelectionMask,
} from './SelectionMask';
import { getSelection, setSelection, clearSelection } from './selectionRegistry';

export interface SelectionTransformBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SelectionTransformMode = 'resize' | 'skew' | 'distort';
export type SelectionTransformCorner = 'nw' | 'ne' | 'se' | 'sw';

export interface SelectionTransformCornerOffsets {
  nw: Point;
  ne: Point;
  se: Point;
  sw: Point;
}

export interface SelectionTransformShape {
  bounds: SelectionTransformBounds;
  rotationDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  cornerOffsets: SelectionTransformCornerOffsets;
}

export interface ImageSelectionTransformSession {
  docId: string;
  before: SelectionMaskSnapshot;
  beforeBounds: SelectionTransformBounds;
  currentBounds: SelectionTransformBounds;
  currentRotationDeg: number;
  currentSkewXDeg: number;
  currentSkewYDeg: number;
  currentCornerOffsets: SelectionTransformCornerOffsets;
  currentMode: SelectionTransformMode;
}

export type SelectionTransformPlanningState = 'inactive' | 'unchanged' | 'pending';
export type SelectionTransformUnsupportedSemantic = 'perspective' | 'warp' | 'refine';
export type SelectionTransformPlanningWarningCode =
  | 'unsupported-perspective-selection-semantics'
  | 'unsupported-warp-selection-semantics'
  | 'unsupported-refine-selection-transform-integration';

export interface SelectionTransformPlanningWarning {
  code: SelectionTransformPlanningWarningCode;
  severity: 'warning';
  message: string;
}

export type SelectionTransformApplyReadinessReason =
  | 'no-active-session'
  | 'no-pending-changes'
  | 'pending-changes';

export type SelectionTransformCancelReadinessReason =
  | 'no-active-session'
  | 'active-session';

export interface SelectionTransformPlanningOptions {
  requestedSemantics?: SelectionTransformUnsupportedSemantic[];
}

export type SelectionTransformReadinessBlockerCode = 'empty-selection';

export interface SelectionTransformReadinessBlocker {
  code: SelectionTransformReadinessBlockerCode;
  severity: 'blocker';
  message: string;
}

export type SelectionTransformReadinessOutputTargetId =
  | 'preview-selection-mask'
  | 'apply-selection-mask'
  | 'undo-history'
  | 'refine-workspace';

export type SelectionTransformReadinessOutputTarget =
  | 'selection-transform-preview-overlay'
  | 'document-selection-registry'
  | 'undoable-selection-history'
  | 'select-and-mask-handoff'
  | 'select-and-mask-handoff-unsupported';

export interface SelectionTransformOutputTargetDescriptor {
  id: SelectionTransformReadinessOutputTargetId;
  ready: boolean;
  target: SelectionTransformReadinessOutputTarget;
}

export interface SelectionTransformUnsupportedIntegrationDescriptor {
  kind: SelectionTransformUnsupportedSemantic;
  supported: false;
  warningCode: SelectionTransformPlanningWarningCode;
}

export interface SelectionTransformReadinessGeometrySummary {
  before: SelectionTransformBounds | null;
  target: SelectionTransformBounds | null;
  delta: Point;
  scale: Point;
  pivot: SelectionTransformPivotDescriptor;
  rotationDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  numericSummary: string;
  signature: string;
}

export interface SelectionTransformPivotDescriptor {
  anchor: 'selection-center' | 'none';
  editable: false;
  point: Point | null;
  signature: string;
}

export interface SelectionTransformReadinessHandleSummary {
  move: { ready: boolean; active: boolean };
  resize: { ready: boolean; active: boolean };
  rotate: { ready: boolean; active: boolean };
  skew: { ready: boolean; active: boolean; xDeg: number; yDeg: number };
  distort: {
    ready: boolean;
    active: boolean;
    handles: Array<{
      corner: SelectionTransformCorner;
      x: number;
      y: number;
      moved: boolean;
    }>;
    movedCorners: SelectionTransformCorner[];
  };
}

export interface SelectionTransformReadinessPreviewDescriptor {
  ready: boolean;
  changed: boolean;
  target: 'selection-transform-preview-overlay' | 'none';
  signature: string;
}

export interface SelectionTransformActionPreviewReadinessDescriptor {
  apply: {
    ready: boolean;
    source: 'live-preview-selection-mask' | 'none';
    commitsTo: 'document-selection-registry' | 'none';
    history: 'undoable-selection-history' | 'none';
    reason: SelectionTransformApplyReadinessReason;
  };
  cancel: {
    ready: boolean;
    restores: 'before-selection-snapshot' | 'none';
    clearsPreview: boolean;
    reason: SelectionTransformCancelReadinessReason;
  };
  signature: string;
}

export type SelectionTransformCaveatCode =
  | 'skew-affine-selection-mask-preview'
  | 'distort-bounded-quad-selection-mask-preview';

export interface SelectionTransformCaveatDescriptor {
  code: SelectionTransformCaveatCode;
  mode: Extract<SelectionTransformMode, 'skew' | 'distort'>;
  support: 'supported' | 'limited';
  active: boolean;
  message: string;
}

export type SelectionTransformOverlayUnsupportedCode =
  | 'marching-ants-live-transform-unsupported'
  | 'selection-overlay-blend-preview-unsupported';

export interface SelectionTransformOverlayUnsupportedDescriptor {
  code: SelectionTransformOverlayUnsupportedCode;
  supported: false;
  fallback: 'static-transform-bounds-and-handles' | 'selection-transform-preview-overlay';
  message: string;
}

export type SelectionTransformRefineHandoffRequirement =
  | 'committed-selection-ready'
  | 'apply-or-cancel-active-transform-first'
  | 'requires-active-selection';

export type SelectionTransformRefineHandoffBlocker =
  | 'active-transform-session'
  | 'empty-selection';

export interface SelectionTransformRefineHandoffDescriptor {
  target: 'select-and-mask';
  ready: boolean;
  source: 'document-selection-registry' | 'none';
  requirement: SelectionTransformRefineHandoffRequirement;
  blockers: SelectionTransformRefineHandoffBlocker[];
  preservesEditableTransform: false;
  signature: string;
}

export interface ImageSelectionTransformReadinessDescriptor {
  state: SelectionTransformPlanningState;
  docId: string;
  mode: SelectionTransformMode | null;
  geometry: SelectionTransformReadinessGeometrySummary;
  handles: SelectionTransformReadinessHandleSummary;
  readiness: SelectionTransformReadinessDescriptor;
  actionPreview: SelectionTransformActionPreviewReadinessDescriptor;
  blockers: SelectionTransformReadinessBlocker[];
  caveats: SelectionTransformCaveatDescriptor[];
  overlayStates: SelectionTransformOverlayUnsupportedDescriptor[];
  refineHandoff: SelectionTransformRefineHandoffDescriptor;
  unsupportedIntegrations: SelectionTransformUnsupportedIntegrationDescriptor[];
  preview: SelectionTransformReadinessPreviewDescriptor;
  outputTargets: SelectionTransformOutputTargetDescriptor[];
  signature: string;
}

export type SelectionTransformPreviewBlockerCode =
  | 'empty-selection'
  | 'preview-session-missing'
  | 'no-pending-transform-changes'
  | 'active-transform-session';

export interface SelectionTransformPreviewBlockerDescriptor {
  code: SelectionTransformPreviewBlockerCode;
  severity: 'blocker';
  blocksPreview: boolean;
  blocksApply: boolean;
  blocksRefineHandoff: boolean;
  message: string;
}

export interface SelectionTransformPreviewBlockersDescriptor {
  kind: 'selection-transform-preview-blockers';
  stableHandoffId: string;
  previewReady: boolean;
  applyReady: boolean;
  refineReady: boolean;
  blockers: SelectionTransformPreviewBlockerDescriptor[];
  signature: string;
}

export interface SelectionTransformMoveOperationDescriptor {
  kind: 'move';
  active: boolean;
  from: Pick<SelectionTransformBounds, 'x' | 'y'> | null;
  to: Pick<SelectionTransformBounds, 'x' | 'y'> | null;
  delta: Point;
}

export interface SelectionTransformResizeOperationDescriptor {
  kind: 'resize';
  active: boolean;
  from: Pick<SelectionTransformBounds, 'width' | 'height'> | null;
  to: Pick<SelectionTransformBounds, 'width' | 'height'> | null;
  scale: Point;
}

export interface SelectionTransformRotateOperationDescriptor {
  kind: 'rotate';
  active: boolean;
  rotationDeg: number;
}

export interface SelectionTransformSkewOperationDescriptor {
  kind: 'skew';
  active: boolean;
  skewXDeg: number;
  skewYDeg: number;
}

export interface SelectionTransformDistortOperationDescriptor {
  kind: 'distort';
  active: boolean;
  cornerOffsets: SelectionTransformCornerOffsets;
  movedCorners: SelectionTransformCorner[];
}

export type SelectionTransformOperationDescriptor =
  | SelectionTransformMoveOperationDescriptor
  | SelectionTransformResizeOperationDescriptor
  | SelectionTransformRotateOperationDescriptor
  | SelectionTransformSkewOperationDescriptor
  | SelectionTransformDistortOperationDescriptor;

export interface SelectionTransformReadinessDescriptor {
  apply: {
    ready: boolean;
    reason: SelectionTransformApplyReadinessReason;
  };
  cancel: {
    ready: boolean;
    reason: SelectionTransformCancelReadinessReason;
  };
}

export interface SelectionTransformPlanningDescriptor {
  state: SelectionTransformPlanningState;
  docId: string | null;
  mode: SelectionTransformMode | null;
  beforeBounds: SelectionTransformBounds | null;
  targetBounds: SelectionTransformBounds | null;
  operations: SelectionTransformOperationDescriptor[];
  readiness: SelectionTransformReadinessDescriptor;
  warnings: SelectionTransformPlanningWarning[];
  signature: string;
}

const listeners = new Set<() => void>();
let session: ImageSelectionTransformSession | null = null;

export function subscribeSelectionTransformSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSelectionTransformSession(docId?: string): ImageSelectionTransformSession | null {
  if (!session) return null;
  if (docId && session.docId !== docId) return null;
  return session;
}

export function clearSelectionTransformSession(): void {
  if (!session) return;
  session = null;
  notify();
}

export function beginSelectionTransformSession(docId: string): ImageSelectionTransformSession | null {
  const selection = getSelection(docId);
  const bounds = selection ? maskBoundingBox(selection) : null;
  if (!selection || !bounds) return null;
  if (session && session.docId === docId) {
    return session;
  }
  session = {
    docId,
    before: toSnapshot(selection),
    beforeBounds: bounds,
    currentBounds: bounds,
    currentRotationDeg: 0,
    currentSkewXDeg: 0,
    currentSkewYDeg: 0,
    currentCornerOffsets: createEmptySelectionTransformCornerOffsets(),
    currentMode: 'resize',
  };
  notify();
  return session;
}

export function updateSelectionTransformBounds(docId: string, bounds: SelectionTransformBounds): boolean {
  return updateSelectionTransformPreview(docId, { bounds });
}

export function updateSelectionTransformRotation(docId: string, rotationDeg: number): boolean {
  return updateSelectionTransformPreview(docId, { rotationDeg });
}

export function updateSelectionTransformSkew(
  docId: string,
  patch: Partial<{ skewXDeg: number; skewYDeg: number }>,
): boolean {
  return updateSelectionTransformPreview(docId, patch);
}

export function updateSelectionTransformDistortCornerOffset(
  docId: string,
  corner: SelectionTransformCorner,
  offset: Point,
): boolean {
  const current = getSelectionTransformSession(docId);
  if (!current) return false;
  return updateSelectionTransformPreview(docId, {
    cornerOffsets: {
      ...current.currentCornerOffsets,
      [corner]: normalizeSelectionTransformPoint(offset),
    },
  });
}

export function resetSelectionTransformDistort(docId: string): boolean {
  return updateSelectionTransformPreview(docId, {
    cornerOffsets: createEmptySelectionTransformCornerOffsets(),
  });
}

export function setSelectionTransformMode(docId: string, mode: SelectionTransformMode): boolean {
  const current = getSelectionTransformSession(docId);
  if (!current || current.currentMode === mode) return Boolean(current);
  session = {
    ...current,
    currentMode: mode,
  };
  notify();
  return true;
}

export function describeSelectionTransformSession(
  current: ImageSelectionTransformSession | null,
  options: SelectionTransformPlanningOptions = {},
): SelectionTransformPlanningDescriptor {
  const warnings = getSelectionTransformUnsupportedSemanticWarnings(options.requestedSemantics);

  if (!current) {
    return {
      state: 'inactive',
      docId: null,
      mode: null,
      beforeBounds: null,
      targetBounds: null,
      operations: buildInactiveSelectionTransformOperations(),
      readiness: {
        apply: { ready: false, reason: 'no-active-session' },
        cancel: { ready: false, reason: 'no-active-session' },
      },
      warnings,
      signature: 'selection-transform:inactive',
    };
  }

  const beforeBounds = normalizeSelectionTransformBounds(current.beforeBounds);
  const targetBounds = normalizeSelectionTransformBounds(current.currentBounds);
  const rotationDeg = normalizeSelectionTransformRotation(current.currentRotationDeg);
  const skewXDeg = normalizeSelectionTransformSkew(current.currentSkewXDeg);
  const skewYDeg = normalizeSelectionTransformSkew(current.currentSkewYDeg);
  const cornerOffsets = normalizeSelectionTransformCornerOffsets(current.currentCornerOffsets);
  const movedCorners = getMovedSelectionTransformCorners(cornerOffsets);
  const operations = buildSelectionTransformOperations({
    beforeBounds,
    targetBounds,
    rotationDeg,
    skewXDeg,
    skewYDeg,
    cornerOffsets,
    movedCorners,
  });
  const hasPendingChanges = operations.some((operation) => operation.active);

  return {
    state: hasPendingChanges ? 'pending' : 'unchanged',
    docId: current.docId,
    mode: current.currentMode,
    beforeBounds,
    targetBounds,
    operations,
    readiness: {
      apply: hasPendingChanges
        ? { ready: true, reason: 'pending-changes' }
        : { ready: false, reason: 'no-pending-changes' },
      cancel: { ready: true, reason: 'active-session' },
    },
    warnings,
    signature: buildSelectionTransformPlanningSignature({
      docId: current.docId,
      mode: current.currentMode,
      beforeBounds,
      targetBounds,
      rotationDeg,
      skewXDeg,
      skewYDeg,
      cornerOffsets,
    }),
  };
}

export function describeImageSelectionTransformReadiness(
  docId: string,
  options: SelectionTransformPlanningOptions = {},
): ImageSelectionTransformReadinessDescriptor {
  const current = getSelectionTransformSession(docId);
  const planning = describeSelectionTransformSession(current, options);
  const hasSelection = current !== null || Boolean(maskBoundingBox(getSelection(docId) ?? createMask(1, 1)));
  const blockers = hasSelection ? [] : [buildEmptySelectionTransformBlocker()];
  const unsupportedIntegrations = buildSelectionTransformUnsupportedIntegrations(options.requestedSemantics);
  const geometry = buildSelectionTransformReadinessGeometry(docId, planning, current);
  const handles = buildSelectionTransformReadinessHandles(planning, current);
  const changed = planning.state === 'pending';
  const previewSignature = current
    ? `selection-transform-preview:v1:${formatSelectionTransformPreviewSignaturePayload(planning.signature)}`
    : `selection-transform-preview:v1:${docId}:inactive:none`;
  const previewReady = hasSelection && current !== null;
  const applyReady = planning.readiness.apply.ready && blockers.length === 0;
  const cancelReadiness = blockers.length > 0
    ? { ...planning.readiness.cancel, ready: false }
    : planning.readiness.cancel;
  const refineHandoff = buildSelectionTransformRefineHandoff({
    docId,
    hasSelection,
    hasActiveSession: current !== null,
  });
  const outputTargets = buildSelectionTransformOutputTargets({
    previewReady,
    applyReady,
    undoReady: applyReady,
    refineReady: refineHandoff.ready,
  });

  return {
    state: planning.state,
    docId,
    mode: planning.mode,
    geometry,
    handles,
    readiness: {
      apply: applyReady
        ? planning.readiness.apply
        : { ...planning.readiness.apply, ready: false },
      cancel: cancelReadiness,
    },
    actionPreview: buildSelectionTransformActionPreview({
      docId,
      state: planning.state,
      previewReady,
      applyReadiness: applyReady
        ? planning.readiness.apply
        : { ...planning.readiness.apply, ready: false },
      cancelReadiness,
    }),
    blockers,
    caveats: buildSelectionTransformCaveats(handles),
    overlayStates: buildSelectionTransformOverlayStates(),
    refineHandoff,
    unsupportedIntegrations,
    preview: {
      ready: previewReady,
      changed,
      target: previewReady ? 'selection-transform-preview-overlay' : 'none',
      signature: previewSignature,
    },
    outputTargets,
    signature: `selection-transform-readiness:v1:${docId}:${planning.state}:${previewSignature}:${blockers.map((blocker) => blocker.code).join(',') || 'none'}`,
  };
}

export function describeSelectionTransformPreviewBlockers(
  readiness: ImageSelectionTransformReadinessDescriptor,
): SelectionTransformPreviewBlockersDescriptor {
  const stableHandoffId = [
    'selection-transform-handoff:v1',
    readiness.docId,
    readiness.state,
    readiness.mode ?? 'none',
  ].join(':');
  const blockers = buildSelectionTransformPreviewBlockers(readiness);

  return {
    kind: 'selection-transform-preview-blockers',
    stableHandoffId,
    previewReady: readiness.preview.ready,
    applyReady: readiness.readiness.apply.ready,
    refineReady: readiness.refineHandoff.ready,
    blockers,
    signature: [
      'selection-transform-preview-blockers:v1',
      stableHandoffId,
      `preview${readiness.preview.ready ? 1 : 0}`,
      `apply${readiness.readiness.apply.ready ? 1 : 0}`,
      `refine${readiness.refineHandoff.ready ? 1 : 0}`,
      blockers.map((blocker) => blocker.code).join('|') || 'none',
    ].join(':'),
  };
}

function buildSelectionTransformPreviewBlockers(
  readiness: ImageSelectionTransformReadinessDescriptor,
): SelectionTransformPreviewBlockerDescriptor[] {
  const blockers: SelectionTransformPreviewBlockerDescriptor[] = [];

  if (readiness.blockers.some((blocker) => blocker.code === 'empty-selection')) {
    blockers.push({
      code: 'empty-selection',
      severity: 'blocker',
      blocksPreview: true,
      blocksApply: true,
      blocksRefineHandoff: true,
      message: 'Transform Selection requires a non-empty active selection before preview, apply, or Select and Mask handoff.',
    });
  }

  if (!readiness.preview.ready && readiness.state === 'inactive' && readiness.blockers.length === 0) {
    blockers.push({
      code: 'preview-session-missing',
      severity: 'blocker',
      blocksPreview: true,
      blocksApply: true,
      blocksRefineHandoff: false,
      message: 'Transform Selection preview requires an active transform session.',
    });
  }

  if (!readiness.readiness.apply.ready && readiness.state !== 'pending') {
    blockers.push({
      code: 'no-pending-transform-changes',
      severity: 'blocker',
      blocksPreview: false,
      blocksApply: true,
      blocksRefineHandoff: false,
      message: 'Apply is unavailable until the active transform changes the selection mask.',
    });
  }

  if (readiness.refineHandoff.blockers.includes('active-transform-session')) {
    blockers.push({
      code: 'active-transform-session',
      severity: 'blocker',
      blocksPreview: false,
      blocksApply: false,
      blocksRefineHandoff: true,
      message: 'Select and Mask handoff is blocked while an editable selection transform session is active.',
    });
  }

  return blockers;
}

function buildEmptySelectionTransformBlocker(): SelectionTransformReadinessBlocker {
  return {
    code: 'empty-selection',
    severity: 'blocker',
    message: 'Transform Selection requires a non-empty active selection before preview, apply, or output targets can be prepared.',
  };
}

function buildSelectionTransformUnsupportedIntegrations(
  requestedSemantics: SelectionTransformUnsupportedSemantic[] = [],
): SelectionTransformUnsupportedIntegrationDescriptor[] {
  const requested = new Set(requestedSemantics);
  const descriptors: SelectionTransformUnsupportedIntegrationDescriptor[] = [];

  if (requested.has('perspective')) {
    descriptors.push({
      kind: 'perspective',
      supported: false,
      warningCode: 'unsupported-perspective-selection-semantics',
    });
  }
  if (requested.has('warp')) {
    descriptors.push({
      kind: 'warp',
      supported: false,
      warningCode: 'unsupported-warp-selection-semantics',
    });
  }
  if (requested.has('refine')) {
    descriptors.push({
      kind: 'refine',
      supported: false,
      warningCode: 'unsupported-refine-selection-transform-integration',
    });
  }

  return descriptors;
}

function buildSelectionTransformReadinessGeometry(
  docId: string,
  planning: SelectionTransformPlanningDescriptor,
  current: ImageSelectionTransformSession | null,
): SelectionTransformReadinessGeometrySummary {
  if (!current || !planning.beforeBounds || !planning.targetBounds) {
    const pivot = buildSelectionTransformPivot(docId, null);
    return {
      before: null,
      target: null,
      delta: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      pivot,
      rotationDeg: 0,
      skewXDeg: 0,
      skewYDeg: 0,
      numericSummary: 'x=none,y=none,w=none,h=none,rot=0,skewX=0,skewY=0',
      signature: `selection-transform-geometry:v1:${docId}:inactive:none`,
    };
  }

  const move = planning.operations.find((operation): operation is SelectionTransformMoveOperationDescriptor => operation.kind === 'move');
  const resize = planning.operations.find((operation): operation is SelectionTransformResizeOperationDescriptor => operation.kind === 'resize');
  const rotationDeg = normalizeSelectionTransformRotation(current.currentRotationDeg);
  const skewXDeg = normalizeSelectionTransformSkew(current.currentSkewXDeg);
  const skewYDeg = normalizeSelectionTransformSkew(current.currentSkewYDeg);
  const pivot = buildSelectionTransformPivot(docId, planning.targetBounds);

  return {
    before: planning.beforeBounds,
    target: planning.targetBounds,
    delta: move?.delta ?? { x: 0, y: 0 },
    scale: resize?.scale ?? { x: 1, y: 1 },
    pivot,
    rotationDeg,
    skewXDeg,
    skewYDeg,
    numericSummary: [
      `x=${formatSelectionTransformNumber(planning.targetBounds.x)}`,
      `y=${formatSelectionTransformNumber(planning.targetBounds.y)}`,
      `w=${formatSelectionTransformNumber(planning.targetBounds.width)}`,
      `h=${formatSelectionTransformNumber(planning.targetBounds.height)}`,
      `rot=${formatSelectionTransformNumber(rotationDeg)}`,
      `skewX=${formatSelectionTransformNumber(skewXDeg)}`,
      `skewY=${formatSelectionTransformNumber(skewYDeg)}`,
    ].join(','),
    signature: [
      'selection-transform-geometry:v1',
      docId,
      formatSelectionTransformBounds(planning.beforeBounds),
      formatSelectionTransformBounds(planning.targetBounds),
      `pivot=${formatSelectionTransformPoint(pivot.point ?? { x: 0, y: 0 })}`,
      `rot=${formatSelectionTransformNumber(rotationDeg)}`,
      `skew=${formatSelectionTransformNumber(skewXDeg)},${formatSelectionTransformNumber(skewYDeg)}`,
    ].join(':'),
  };
}

function buildSelectionTransformPivot(
  docId: string,
  bounds: SelectionTransformBounds | null,
): SelectionTransformPivotDescriptor {
  if (!bounds) {
    return {
      anchor: 'none',
      editable: false,
      point: null,
      signature: `selection-transform-pivot:v1:${docId}:none:none`,
    };
  }

  const point = normalizeSelectionTransformPoint({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });

  return {
    anchor: 'selection-center',
    editable: false,
    point,
    signature: `selection-transform-pivot:v1:${docId}:selection-center:${formatSelectionTransformPoint(point)}`,
  };
}

function buildSelectionTransformReadinessHandles(
  planning: SelectionTransformPlanningDescriptor,
  current: ImageSelectionTransformSession | null,
): SelectionTransformReadinessHandleSummary {
  const move = planning.operations.find((operation): operation is SelectionTransformMoveOperationDescriptor => operation.kind === 'move');
  const resize = planning.operations.find((operation): operation is SelectionTransformResizeOperationDescriptor => operation.kind === 'resize');
  const rotate = planning.operations.find((operation): operation is SelectionTransformRotateOperationDescriptor => operation.kind === 'rotate');
  const skew = planning.operations.find((operation): operation is SelectionTransformSkewOperationDescriptor => operation.kind === 'skew');
  const distort = planning.operations.find((operation): operation is SelectionTransformDistortOperationDescriptor => operation.kind === 'distort');
  const hasSession = current !== null;
  const cornerOffsets = distort?.cornerOffsets ?? createEmptySelectionTransformCornerOffsets();
  const movedCorners = distort?.movedCorners ?? [];

  return {
    move: { ready: hasSession, active: Boolean(move?.active) },
    resize: { ready: hasSession, active: Boolean(resize?.active) },
    rotate: { ready: hasSession, active: Boolean(rotate?.active) },
    skew: {
      ready: hasSession,
      active: Boolean(skew?.active),
      xDeg: skew?.skewXDeg ?? 0,
      yDeg: skew?.skewYDeg ?? 0,
    },
    distort: {
      ready: hasSession,
      active: Boolean(distort?.active),
      handles: (['nw', 'ne', 'se', 'sw'] as SelectionTransformCorner[]).map((corner) => ({
        corner,
        x: cornerOffsets[corner].x,
        y: cornerOffsets[corner].y,
        moved: movedCorners.includes(corner),
      })),
      movedCorners,
    },
  };
}

function buildSelectionTransformOutputTargets({
  previewReady,
  applyReady,
  undoReady,
  refineReady,
}: {
  previewReady: boolean;
  applyReady: boolean;
  undoReady: boolean;
  refineReady: boolean;
}): SelectionTransformOutputTargetDescriptor[] {
  return [
    { id: 'preview-selection-mask', ready: previewReady, target: 'selection-transform-preview-overlay' },
    { id: 'apply-selection-mask', ready: applyReady, target: 'document-selection-registry' },
    { id: 'undo-history', ready: undoReady, target: 'undoable-selection-history' },
    {
      id: 'refine-workspace',
      ready: refineReady,
      target: refineReady ? 'select-and-mask-handoff' : 'select-and-mask-handoff-unsupported',
    },
  ];
}

function buildSelectionTransformActionPreview({
  docId,
  state,
  previewReady,
  applyReadiness,
  cancelReadiness,
}: {
  docId: string;
  state: SelectionTransformPlanningState;
  previewReady: boolean;
  applyReadiness: SelectionTransformReadinessDescriptor['apply'];
  cancelReadiness: SelectionTransformReadinessDescriptor['cancel'];
}): SelectionTransformActionPreviewReadinessDescriptor {
  return {
    apply: {
      ready: applyReadiness.ready,
      source: previewReady ? 'live-preview-selection-mask' : 'none',
      commitsTo: applyReadiness.ready ? 'document-selection-registry' : 'none',
      history: applyReadiness.ready ? 'undoable-selection-history' : 'none',
      reason: applyReadiness.reason,
    },
    cancel: {
      ready: cancelReadiness.ready,
      restores: previewReady ? 'before-selection-snapshot' : 'none',
      clearsPreview: previewReady,
      reason: cancelReadiness.reason,
    },
    signature: [
      'selection-transform-action-preview:v1',
      docId,
      state,
      `apply=${applyReadiness.reason}:${applyReadiness.ready}`,
      `cancel=${cancelReadiness.reason}:${cancelReadiness.ready}`,
      `preview=${previewReady ? 'ready' : 'blocked'}`,
    ].join(':'),
  };
}

function buildSelectionTransformCaveats(
  handles: SelectionTransformReadinessHandleSummary,
): SelectionTransformCaveatDescriptor[] {
  return [
    {
      code: 'skew-affine-selection-mask-preview',
      mode: 'skew',
      support: 'supported',
      active: handles.skew.active,
      message: 'Skew updates the selection mask preview with affine edge offsets, then commits pixels; no editable skew object is preserved after apply.',
    },
    {
      code: 'distort-bounded-quad-selection-mask-preview',
      mode: 'distort',
      support: 'limited',
      active: handles.distort.active,
      message: 'Distort tracks four corner offsets as a bounded quad preview; true perspective or warp selection semantics are not preserved.',
    },
  ];
}

function buildSelectionTransformOverlayStates(): SelectionTransformOverlayUnsupportedDescriptor[] {
  return [
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
  ];
}

function buildSelectionTransformRefineHandoff({
  docId,
  hasSelection,
  hasActiveSession,
}: {
  docId: string;
  hasSelection: boolean;
  hasActiveSession: boolean;
}): SelectionTransformRefineHandoffDescriptor {
  const blockers: SelectionTransformRefineHandoffBlocker[] = [];
  if (!hasSelection) blockers.push('empty-selection');
  if (hasActiveSession) blockers.push('active-transform-session');

  const requirement: SelectionTransformRefineHandoffRequirement = !hasSelection
    ? 'requires-active-selection'
    : hasActiveSession
      ? 'apply-or-cancel-active-transform-first'
      : 'committed-selection-ready';
  const ready = hasSelection && !hasActiveSession;

  return {
    target: 'select-and-mask',
    ready,
    source: hasSelection ? 'document-selection-registry' : 'none',
    requirement,
    blockers,
    preservesEditableTransform: false,
    signature: [
      'selection-transform-refine-handoff:v1',
      docId,
      ready ? 'ready' : 'blocked',
      requirement,
      blockers.join(',') || 'none',
    ].join(':'),
  };
}

function formatSelectionTransformPreviewSignaturePayload(planningSignature: string): string {
  return planningSignature.startsWith('selection-transform:')
    ? planningSignature.slice('selection-transform:'.length)
    : planningSignature;
}

export function getSelectionTransformUnsupportedSemanticWarnings(
  requestedSemantics: SelectionTransformUnsupportedSemantic[] = [],
): SelectionTransformPlanningWarning[] {
  const requested = new Set(requestedSemantics);
  const warnings: SelectionTransformPlanningWarning[] = [];

  if (requested.has('perspective')) {
    warnings.push({
      code: 'unsupported-perspective-selection-semantics',
      severity: 'warning',
      message: 'Perspective selection transforms are not supported for pixel selections; distort corner offsets are tracked as a bounded quad preview only.',
    });
  }

  if (requested.has('warp')) {
    warnings.push({
      code: 'unsupported-warp-selection-semantics',
      severity: 'warning',
      message: 'Warp selection transforms are not supported for pixel selections; use layer-side warp or apply the selection before raster deformation.',
    });
  }

  if (requested.has('refine')) {
    warnings.push({
      code: 'unsupported-refine-selection-transform-integration',
      severity: 'warning',
      message: 'Transform Selection does not hand off editable transform state into Select and Mask; apply or cancel the transform before refinement.',
    });
  }

  return warnings;
}

function updateSelectionTransformPreview(
  docId: string,
  patch: Partial<{
    bounds: SelectionTransformBounds;
    rotationDeg: number;
    skewXDeg: number;
    skewYDeg: number;
    cornerOffsets: SelectionTransformCornerOffsets;
  }>,
): boolean {
  const current = getSelectionTransformSession(docId);
  if (!current) return false;
  const normalizedBounds = patch.bounds
    ? normalizeSelectionTransformBounds(patch.bounds)
    : current.currentBounds;
  const normalizedRotation = patch.rotationDeg !== undefined
    ? normalizeSelectionTransformRotation(patch.rotationDeg)
    : current.currentRotationDeg;
  const normalizedSkewX = patch.skewXDeg !== undefined
    ? normalizeSelectionTransformSkew(patch.skewXDeg)
    : current.currentSkewXDeg;
  const normalizedSkewY = patch.skewYDeg !== undefined
    ? normalizeSelectionTransformSkew(patch.skewYDeg)
    : current.currentSkewYDeg;
  const normalizedCornerOffsets = patch.cornerOffsets
    ? normalizeSelectionTransformCornerOffsets(patch.cornerOffsets)
    : current.currentCornerOffsets;
  const preview = transformSelectionMask(
    fromSnapshot(current.before),
    current.beforeBounds,
    {
      bounds: normalizedBounds,
      rotationDeg: normalizedRotation,
      skewXDeg: normalizedSkewX,
      skewYDeg: normalizedSkewY,
      cornerOffsets: normalizedCornerOffsets,
    },
  );
  const store = useImageEditorStore.getState();
  setSelection(docId, preview);
  store.bumpSelectionVersion(docId);
  store.setHasSelection(docId, Boolean(maskBoundingBox(preview)));
  session = {
    ...current,
    currentBounds: normalizedBounds,
    currentRotationDeg: normalizedRotation,
    currentSkewXDeg: normalizedSkewX,
    currentSkewYDeg: normalizedSkewY,
    currentCornerOffsets: normalizedCornerOffsets,
  };
  notify();
  return true;
}

export function selectionTransformSessionHasPendingChanges(docId: string): boolean {
  const current = getSelectionTransformSession(docId);
  if (!current) return false;
  const live = getSelection(docId);
  if (!live) return false;
  return !selectionSnapshotsMatch(current.before, toSnapshot(live));
}

export function applySelectionTransformSession(
  docId: string,
  requestRender?: () => void,
): EditorOperation | null {
  const current = getSelectionTransformSession(docId);
  if (!current) return null;
  const store = useImageEditorStore.getState();
  const live = getSelection(docId) ?? fromSnapshot(current.before);
  const after = maskBoundingBox(live) ? toSnapshot(live) : null;
  const before = current.before;
  let operation: EditorOperation | null = null;

  if (!after) {
    clearSelection(docId);
    store.setHasSelection(docId, false);
    if (current.before.data.some((value: number) => value > 0)) {
      operation = {
        kind: 'selection',
        docId,
        before,
        after: null,
      };
    }
  } else {
    store.setHasSelection(docId, true);
    if (!selectionSnapshotsMatch(before, after)) {
      operation = {
        kind: 'selection',
        docId,
        before,
        after,
      };
    }
  }

  clearSelectionTransformSession();
  if (operation) {
    store.pushOperation(operation);
  }
  requestRender?.();
  return operation;
}

export function cancelSelectionTransformSession(docId: string, requestRender?: () => void): boolean {
  const current = getSelectionTransformSession(docId);
  if (!current) return false;
  const store = useImageEditorStore.getState();
  setSelection(docId, fromSnapshot(current.before));
  store.bumpSelectionVersion(docId);
  store.setHasSelection(docId, true);
  clearSelectionTransformSession();
  requestRender?.();
  return true;
}

export function transformSelectionMask(
  selection: SelectionMask,
  sourceBounds: SelectionTransformBounds,
  shape: SelectionTransformShape,
): SelectionMask {
  const normalizedBounds = normalizeSelectionTransformBounds(shape.bounds);
  const normalizedShape: SelectionTransformShape = {
    bounds: normalizedBounds,
    rotationDeg: normalizeSelectionTransformRotation(shape.rotationDeg),
    skewXDeg: normalizeSelectionTransformSkew(shape.skewXDeg),
    skewYDeg: normalizeSelectionTransformSkew(shape.skewYDeg),
    cornerOffsets: normalizeSelectionTransformCornerOffsets(shape.cornerOffsets),
  };
  const out = createMask(selection.width, selection.height);
  const targetCorners = getSelectionTransformTargetCorners(normalizedShape);
  const { minX, minY, maxX, maxY } = getSelectionTransformTargetExtents(normalizedShape);
  const targetX0 = Math.max(0, minX);
  const targetY0 = Math.max(0, minY);
  const targetX1 = Math.min(selection.width, maxX);
  const targetY1 = Math.min(selection.height, maxY);
  const sourceXMax = sourceBounds.x + sourceBounds.width - 1;
  const sourceYMax = sourceBounds.y + sourceBounds.height - 1;

  const sourceCorners = {
    nw: { x: sourceBounds.x, y: sourceBounds.y },
    ne: { x: sourceBounds.x + sourceBounds.width - 1, y: sourceBounds.y },
    se: { x: sourceBounds.x + sourceBounds.width - 1, y: sourceBounds.y + sourceBounds.height - 1 },
    sw: { x: sourceBounds.x, y: sourceBounds.y + sourceBounds.height - 1 },
  } satisfies Record<SelectionTransformCorner, Point>;

  for (let y = targetY0; y < targetY1; y += 1) {
    for (let x = targetX0; x < targetX1; x += 1) {
      const samplePoint = { x: x + 0.5, y: y + 0.5 };
      const sourcePoint = mapPointFromTargetToSourceQuad(samplePoint, targetCorners, sourceCorners);
      if (!sourcePoint) continue;
      const sourceX = clampInteger(Math.round(sourcePoint.x), sourceBounds.x, sourceXMax);
      const sourceY = clampInteger(Math.round(sourcePoint.y), sourceBounds.y, sourceYMax);
      out.data[y * out.width + x] = selection.data[sourceY * selection.width + sourceX];
    }
  }

  return out;
}

export function getSelectionTransformTargetCorners(
  shape: SelectionTransformShape,
): Record<SelectionTransformCorner, Point> {
  const centerX = shape.bounds.x + shape.bounds.width / 2;
  const centerY = shape.bounds.y + shape.bounds.height / 2;
  const halfWidth = shape.bounds.width / 2;
  const halfHeight = shape.bounds.height / 2;
  const skewXRadians = (shape.skewXDeg * Math.PI) / 180;
  const skewYRadians = (shape.skewYDeg * Math.PI) / 180;
  const skewX = Math.tan(skewXRadians);
  const skewY = Math.tan(skewYRadians);
  const rotationRadians = (shape.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);

  const corners = {
    nw: { x: -halfWidth, y: -halfHeight },
    ne: { x: halfWidth, y: -halfHeight },
    se: { x: halfWidth, y: halfHeight },
    sw: { x: -halfWidth, y: halfHeight },
  } satisfies Record<SelectionTransformCorner, Point>;

  return {
    nw: applyCornerTransform(corners.nw, centerX, centerY, skewX, skewY, cos, sin, shape.cornerOffsets.nw),
    ne: applyCornerTransform(corners.ne, centerX, centerY, skewX, skewY, cos, sin, shape.cornerOffsets.ne),
    se: applyCornerTransform(corners.se, centerX, centerY, skewX, skewY, cos, sin, shape.cornerOffsets.se),
    sw: applyCornerTransform(corners.sw, centerX, centerY, skewX, skewY, cos, sin, shape.cornerOffsets.sw),
  };
}

function applyCornerTransform(
  corner: Point,
  centerX: number,
  centerY: number,
  skewX: number,
  skewY: number,
  cos: number,
  sin: number,
  offset: Point,
): Point {
  const skewedX = corner.x + skewX * corner.y;
  const skewedY = corner.y + skewY * corner.x;
  const rotatedX = skewedX * cos - skewedY * sin;
  const rotatedY = skewedX * sin + skewedY * cos;
  return {
    x: roundSelectionTransformNumber(centerX + rotatedX + offset.x),
    y: roundSelectionTransformNumber(centerY + rotatedY + offset.y),
  };
}

export function getSelectionTransformTargetExtents(
  shape: SelectionTransformShape,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = Object.values(getSelectionTransformTargetCorners(shape));
  return {
    minX: Math.floor(Math.min(...corners.map((corner) => corner.x))),
    minY: Math.floor(Math.min(...corners.map((corner) => corner.y))),
    maxX: Math.ceil(Math.max(...corners.map((corner) => corner.x))),
    maxY: Math.ceil(Math.max(...corners.map((corner) => corner.y))),
  };
}

function mapPointFromTargetToSourceQuad(
  point: Point,
  targetCorners: Record<SelectionTransformCorner, Point>,
  sourceCorners: Record<SelectionTransformCorner, Point>,
): Point | null {
  const triangles: Array<{
    target: [Point, Point, Point];
    source: [Point, Point, Point];
  }> = [
    {
      target: [targetCorners.nw, targetCorners.ne, targetCorners.se],
      source: [sourceCorners.nw, sourceCorners.ne, sourceCorners.se],
    },
    {
      target: [targetCorners.nw, targetCorners.se, targetCorners.sw],
      source: [sourceCorners.nw, sourceCorners.se, sourceCorners.sw],
    },
  ];

  for (const triangle of triangles) {
    const barycentric = getTriangleBarycentric(point, triangle.target);
    if (!barycentric || !isBarycentricInsideTriangle(barycentric)) continue;
    return {
      x: barycentric.a * triangle.source[0].x + barycentric.b * triangle.source[1].x + barycentric.c * triangle.source[2].x,
      y: barycentric.a * triangle.source[0].y + barycentric.b * triangle.source[1].y + barycentric.c * triangle.source[2].y,
    };
  }

  return null;
}

function getTriangleBarycentric(
  point: Point,
  triangle: [Point, Point, Point],
): { a: number; b: number; c: number } | null {
  const [a, b, c] = triangle;
  const denominator = ((b.y - c.y) * (a.x - c.x)) + ((c.x - b.x) * (a.y - c.y));
  if (Math.abs(denominator) < 0.000001) return null;
  const baryA = (((b.y - c.y) * (point.x - c.x)) + ((c.x - b.x) * (point.y - c.y))) / denominator;
  const baryB = (((c.y - a.y) * (point.x - c.x)) + ((a.x - c.x) * (point.y - c.y))) / denominator;
  const baryC = 1 - baryA - baryB;
  return { a: baryA, b: baryB, c: baryC };
}

function isBarycentricInsideTriangle(barycentric: { a: number; b: number; c: number }): boolean {
  const epsilon = 0.0005;
  return (
    barycentric.a >= -epsilon &&
    barycentric.b >= -epsilon &&
    barycentric.c >= -epsilon
  );
}

function selectionSnapshotsMatch(a: SelectionMaskSnapshot, b: SelectionMaskSnapshot): boolean {
  if (a.width !== b.width || a.height !== b.height || a.data.length !== b.data.length) {
    return false;
  }
  for (let index = 0; index < a.data.length; index += 1) {
    if (a.data[index] !== b.data[index]) {
      return false;
    }
  }
  return true;
}

function normalizeSelectionTransformBounds(bounds: SelectionTransformBounds): SelectionTransformBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function buildInactiveSelectionTransformOperations(): SelectionTransformOperationDescriptor[] {
  const cornerOffsets = createEmptySelectionTransformCornerOffsets();
  return [
    { kind: 'move', active: false, from: null, to: null, delta: { x: 0, y: 0 } },
    { kind: 'resize', active: false, from: null, to: null, scale: { x: 1, y: 1 } },
    { kind: 'rotate', active: false, rotationDeg: 0 },
    { kind: 'skew', active: false, skewXDeg: 0, skewYDeg: 0 },
    { kind: 'distort', active: false, cornerOffsets, movedCorners: [] },
  ];
}

function buildSelectionTransformOperations({
  beforeBounds,
  targetBounds,
  rotationDeg,
  skewXDeg,
  skewYDeg,
  cornerOffsets,
  movedCorners,
}: {
  beforeBounds: SelectionTransformBounds;
  targetBounds: SelectionTransformBounds;
  rotationDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  cornerOffsets: SelectionTransformCornerOffsets;
  movedCorners: SelectionTransformCorner[];
}): SelectionTransformOperationDescriptor[] {
  const delta = {
    x: roundSelectionTransformNumber(targetBounds.x - beforeBounds.x),
    y: roundSelectionTransformNumber(targetBounds.y - beforeBounds.y),
  };
  const scale = {
    x: roundSelectionTransformNumber(targetBounds.width / Math.max(1, beforeBounds.width)),
    y: roundSelectionTransformNumber(targetBounds.height / Math.max(1, beforeBounds.height)),
  };

  return [
    {
      kind: 'move',
      active: delta.x !== 0 || delta.y !== 0,
      from: { x: beforeBounds.x, y: beforeBounds.y },
      to: { x: targetBounds.x, y: targetBounds.y },
      delta,
    },
    {
      kind: 'resize',
      active: beforeBounds.width !== targetBounds.width || beforeBounds.height !== targetBounds.height,
      from: { width: beforeBounds.width, height: beforeBounds.height },
      to: { width: targetBounds.width, height: targetBounds.height },
      scale,
    },
    {
      kind: 'rotate',
      active: rotationDeg !== 0,
      rotationDeg,
    },
    {
      kind: 'skew',
      active: skewXDeg !== 0 || skewYDeg !== 0,
      skewXDeg,
      skewYDeg,
    },
    {
      kind: 'distort',
      active: movedCorners.length > 0,
      cornerOffsets,
      movedCorners,
    },
  ];
}

function getMovedSelectionTransformCorners(
  cornerOffsets: SelectionTransformCornerOffsets,
): SelectionTransformCorner[] {
  return (['nw', 'ne', 'se', 'sw'] as SelectionTransformCorner[]).filter((corner) => {
    const offset = cornerOffsets[corner];
    return offset.x !== 0 || offset.y !== 0;
  });
}

function buildSelectionTransformPlanningSignature({
  docId,
  mode,
  beforeBounds,
  targetBounds,
  rotationDeg,
  skewXDeg,
  skewYDeg,
  cornerOffsets,
}: {
  docId: string;
  mode: SelectionTransformMode;
  beforeBounds: SelectionTransformBounds;
  targetBounds: SelectionTransformBounds;
  rotationDeg: number;
  skewXDeg: number;
  skewYDeg: number;
  cornerOffsets: SelectionTransformCornerOffsets;
}): string {
  return [
    'selection-transform',
    docId,
    mode,
    formatSelectionTransformBounds(beforeBounds),
    formatSelectionTransformBounds(targetBounds),
    formatSelectionTransformNumber(rotationDeg),
    formatSelectionTransformNumber(skewXDeg),
    formatSelectionTransformNumber(skewYDeg),
    formatSelectionTransformCornerOffsets(cornerOffsets),
  ].join(':');
}

function formatSelectionTransformBounds(bounds: SelectionTransformBounds): string {
  return [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
  ].map(formatSelectionTransformNumber).join(',');
}

function formatSelectionTransformPoint(point: Point): string {
  return [
    point.x,
    point.y,
  ].map(formatSelectionTransformNumber).join(',');
}

function formatSelectionTransformCornerOffsets(cornerOffsets: SelectionTransformCornerOffsets): string {
  return (['nw', 'ne', 'se', 'sw'] as SelectionTransformCorner[])
    .map((corner) => [
      formatSelectionTransformNumber(cornerOffsets[corner].x),
      formatSelectionTransformNumber(cornerOffsets[corner].y),
    ].join(','))
    .join('|');
}

function normalizeSelectionTransformRotation(rotationDeg: number): number {
  if (!Number.isFinite(rotationDeg)) return 0;
  const normalized = (((rotationDeg % 360) + 360) % 360);
  return Math.round(normalized * 100) / 100;
}

function normalizeSelectionTransformSkew(skewDeg: number): number {
  if (!Number.isFinite(skewDeg)) return 0;
  return Math.min(75, Math.max(-75, roundSelectionTransformNumber(skewDeg)));
}

function normalizeSelectionTransformCornerOffsets(
  offsets: SelectionTransformCornerOffsets,
): SelectionTransformCornerOffsets {
  return {
    nw: normalizeSelectionTransformPoint(offsets.nw),
    ne: normalizeSelectionTransformPoint(offsets.ne),
    se: normalizeSelectionTransformPoint(offsets.se),
    sw: normalizeSelectionTransformPoint(offsets.sw),
  };
}

function normalizeSelectionTransformPoint(point: Point): Point {
  return {
    x: roundSelectionTransformNumber(point.x),
    y: roundSelectionTransformNumber(point.y),
  };
}

function roundSelectionTransformNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatSelectionTransformNumber(value: number): string {
  return String(roundSelectionTransformNumber(value));
}

function createEmptySelectionTransformCornerOffsets(): SelectionTransformCornerOffsets {
  return {
    nw: { x: 0, y: 0 },
    ne: { x: 0, y: 0 },
    se: { x: 0, y: 0 },
    sw: { x: 0, y: 0 },
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}
