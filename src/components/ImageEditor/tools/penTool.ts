import { useImageEditorStore } from '../../../store/imageEditorStore';
import { DEFAULT_SHAPE_TOOL_SETTINGS, type ImageLayer, type ImageVectorPathPoint, type ShapeToolSettings } from '../../../types/imageEditor';
import { buildVectorPathLayer } from '../ImageVectorShape';
import type { Point, ToolEnv, ToolHandler } from './types';

interface PenSession {
  docId: string;
  layerId: string | null;
  beforeLayers: ImageLayer[];
  beforeActiveLayerId: string | null;
  points: ImageVectorPathPoint[];
  previewPoint: Point | null;
  dragAnchorIndex: number | null;
  closed: boolean;
}

let session: PenSession | null = null;
const PEN_CLOSE_ANCHOR_HIT_RADIUS_PX = 8;

/**
 * True while the Pen tool is mid-creation on this document (one or more anchors placed, not yet
 * committed/cancelled). The canvas uses this to suppress the committed-path anchor-editing overlay
 * during creation, so its draggable handles can't intercept the clicks that add the next anchor.
 */
export function isPenSessionActive(docId: string): boolean {
  return session !== null && session.docId === docId;
}

/** Commit the active Pen path (e.g. on double-click) if one is in progress. Returns true if it ran. */
export function commitActivePenPath(env: ToolEnv): boolean {
  if (!session || session.docId !== env.doc.id) return false;
  commitPath(env);
  return true;
}

export type PenToolWorkflowCapabilityKind =
  | 'add-straight-anchor'
  | 'close-straight-path'
  | 'live-preview-vector-layer'
  | 'commit-retained-path'
  | 'cancel-preview-path'
  | 'bezier-handles'
  | 'curvature-mode'
  | 'anchor-conversion'
  | 'independent-direct-selection'
  | 'independent-path-selection';

export type PenToolWorkflowWarningCode =
  | 'unsupported-bezier-handles'
  | 'unsupported-curvature-mode'
  | 'unsupported-anchor-conversion'
  | 'unsupported-independent-direct-selection'
  | 'unsupported-independent-path-selection'
  | 'unsupported-text-on-path'
  | 'one-step-vector-mask-unsupported';

export interface PenToolWorkflowWarning {
  code: PenToolWorkflowWarningCode;
  severity: 'warning';
  message: string;
  capability: PenToolWorkflowCapabilityKind;
}

export interface PenToolWorkflowCapabilityDescriptor {
  kind: PenToolWorkflowCapabilityKind;
  label: string;
  supported: boolean;
  gesture: string;
  result: string;
  warnings: PenToolWorkflowWarning[];
}

export interface PenToolWorkflowDescriptorOptions {
  requireBezierHandles?: boolean;
  requireCurvatureMode?: boolean;
}

export interface PenToolWorkflowDescriptor {
  pathStorage: 'vector-layer';
  segmentGeometry: 'straight-or-cubic-bezier';
  creationSession: {
    kind: 'path-creation';
    storage: 'preview-vector-layer';
    commitAction: 'commit-retained-vector-path-layer';
    cancelAction: 'restore-pre-session-layer-stack';
    previewId: 'pen-tool:path-creation';
  };
  editSession: {
    kind: 'path-anchor-editing';
    supported: true;
    owner: 'paths-panel-anchor-controls';
    availability: 'after-commit';
    selection: 'single-or-multi-anchor-descriptor';
    moveOperation: 'delegated-retained-path-anchor-move';
    limitation: string;
  };
  pathClassification: {
    savedPath: 'layer-backed-vector-path';
    workPath: 'pen-preview-vector-layer';
    independentSavedPaths: false;
  };
  supportStatus: {
    bezierHandles: 'supported';
    curvatureMode: 'supported';
    anchorConversion: 'supported';
  };
  selectionSemantics: {
    independentDirectSelection: true;
    independentPathSelection: true;
  };
  booleanReadiness: {
    mode: 'separate-layer-boolean-actions-only';
    supportsLiveBooleanStack: false;
    supportsBezierOperands: false;
    supportsOverlapResolution: false;
  };
  handoffCaveats: {
    svg: string[];
    psd: string[];
  };
  commitKeys: string[];
  cancelKeys: string[];
  capabilities: PenToolWorkflowCapabilityDescriptor[];
  warnings: PenToolWorkflowWarning[];
  previewId: 'pen-tool-workflow:v2';
  previewSignature: string;
}

export type PenToolReadinessStatus = 'ready' | 'limited-ready' | 'blocked';
export type PenToolOperationBlockerCode =
  | 'insufficient-anchors'
  | 'missing-committed-path-layer'
  | 'one-step-vector-mask-unsupported';

export interface PenToolOperationBlocker {
  code: PenToolOperationBlockerCode;
  severity: 'error' | 'warning';
  operation:
    | 'commit-retained-path'
    | 'convert-path-to-vector-mask'
    | 'create-vector-mask-directly-from-active-pen-session';
  message: string;
}

export interface PenToolBezierHandleReadinessDescriptor {
  state: 'ready';
  inputGesture: 'click-drag-anchor-or-drag-retained-handle';
  storedHandleModel: 'retained-in-out-handles';
  canCreateSmoothAnchors: true;
  canEditInOutHandles: true;
  blockerCodes: [];
  signature: string;
}

export interface PenToolTextOnPathReadinessDescriptor {
  state: 'unsupported';
  canAttachTextLayer: false;
  canEditBaselineOffset: false;
  canEditBezierTextFlow: false;
  caveats: Array<'bezier-text-on-path-editing-unsupported' | 'text-on-path-layout-engine-missing'>;
  signature: string;
}

export interface PenToolReadinessOptions extends PenToolWorkflowDescriptorOptions {
  points?: Point[];
  targetLayerId?: string | null;
  selectedPathLayerId?: string | null;
  fillEnabled?: boolean;
  strokeEnabled?: boolean;
  requireTextOnPath?: boolean;
  requireOneStepVectorMask?: boolean;
}

export interface PenToolReadinessDescriptor {
  status: PenToolReadinessStatus;
  pointCreationState: {
    mode: 'adding-straight-anchors';
    pointCount: number;
    previewPoint: 'not-tracked-by-descriptor';
    canPreviewPath: boolean;
    canCommitPath: boolean;
  };
  straightSegmentPathSupport: {
    status: 'supported';
    geometry: 'straight-segment';
    minimumCommitPoints: 2;
    pointCount: number;
    canCommit: boolean;
  };
  liveSession: {
    preview: 'supported';
    commit: 'supported';
    cancel: 'supported';
    previewLayerPersistence: 'temporary-until-commit';
    commitKeys: string[];
    cancelKeys: string[];
  };
  pathLayerOutput: {
    status: 'supported';
    outputKind: 'retained-vector-path-layer';
    shapeKind: 'path';
    layerBackedPath: true;
    editableAfterCommit: true;
  };
  interop: {
    selectionFromPath: 'supported';
    fillPath: 'supported' | 'blocked-no-style';
    strokePath: 'supported' | 'blocked-no-style';
    vectorMaskFromPath: 'supported-two-step' | 'blocked-no-committed-path';
    oneStepVectorMaskFromPen: 'unsupported';
  };
  missingStates: {
    bezierHandles: 'supported';
    curvatureMode: 'supported';
    textOnPath: 'unsupported';
  };
  unsupportedEditingStates: {
    bezierHandleEditing: 'supported';
    anchorConversion: 'supported';
    directSelectionTool: 'supported';
    pathSelectionTool: 'supported';
  };
  actionSuitability: {
    panelCommands: 'suitable-after-commit' | 'blocked-until-commit';
    batchActions: 'suitable-after-commit' | 'blocked';
    macroPlayback: 'suitable-deterministic-after-commit' | 'blocked';
    liveBezierEditing: 'suitable-after-commit' | 'blocked-until-commit';
  };
  oneStepVectorMaskCaveat: {
    status: 'two-step-required';
    message: string;
  };
  bezierHandleReadiness: PenToolBezierHandleReadinessDescriptor;
  textOnPathReadiness: PenToolTextOnPathReadinessDescriptor;
  warnings: PenToolWorkflowWarning[];
  operationBlockers: PenToolOperationBlocker[];
  previewSignatures: {
    workflow: string;
    readiness: string;
  };
}

const PEN_TOOL_WORKFLOW_CAPABILITY_ORDER: PenToolWorkflowCapabilityKind[] = [
  'add-straight-anchor',
  'close-straight-path',
  'live-preview-vector-layer',
  'commit-retained-path',
  'cancel-preview-path',
  'bezier-handles',
  'curvature-mode',
  'anchor-conversion',
  'independent-direct-selection',
  'independent-path-selection',
];

export function describePenToolWorkflow(
  options: PenToolWorkflowDescriptorOptions = {},
): PenToolWorkflowDescriptor {
  const warnings = getUnsupportedPenToolWorkflowWarnings(options);
  const capabilities = PEN_TOOL_WORKFLOW_CAPABILITY_ORDER.map((kind) => (
    buildPenToolWorkflowCapabilityDescriptor(kind, warnings)
  ));
  const descriptor = {
    pathStorage: 'vector-layer' as const,
    segmentGeometry: 'straight-or-cubic-bezier' as const,
    creationSession: buildPenToolCreationSessionDescriptor(),
    editSession: buildPenToolEditSessionDescriptor(),
    pathClassification: buildPenToolPathClassificationDescriptor(),
    supportStatus: buildPenToolSupportStatusDescriptor(),
    selectionSemantics: buildPenToolSelectionSemanticsDescriptor(),
    booleanReadiness: {
      mode: 'separate-layer-boolean-actions-only' as const,
      supportsLiveBooleanStack: false as const,
      supportsBezierOperands: false as const,
      supportsOverlapResolution: false as const,
    },
    handoffCaveats: {
      svg: [
        'svg-export-flattens-retained-cubic-bezier-path-data',
        'svg-export-does-not-preserve-live-boolean-stack',
      ],
      psd: [
        'psd-export-keeps-layer-backed-path-only',
        'native-psd-pen-path-roundtrip-not-guaranteed',
      ],
    },
    commitKeys: ['Enter'],
    cancelKeys: ['Escape'],
    capabilities,
    warnings,
    previewId: 'pen-tool-workflow:v2' as const,
  };

  return {
    ...descriptor,
    previewSignature: buildPenToolWorkflowPreviewSignature(descriptor),
  };
}

export function describePenToolReadiness(
  options: PenToolReadinessOptions = {},
): PenToolReadinessDescriptor {
  const workflow = describePenToolWorkflow(options);
  const pointCount = options.points?.length ?? 0;
  const canCommit = pointCount >= 2;
  const selectedPathLayerId = options.selectedPathLayerId ?? null;
  const interop: PenToolReadinessDescriptor['interop'] = {
    selectionFromPath: 'supported',
    fillPath: options.fillEnabled === false ? 'blocked-no-style' : 'supported',
    strokePath: options.strokeEnabled === false ? 'blocked-no-style' : 'supported',
    vectorMaskFromPath: selectedPathLayerId ? 'supported-two-step' : 'blocked-no-committed-path',
    oneStepVectorMaskFromPen: 'unsupported',
  };
  const extraWarnings = getPenToolReadinessWarnings(options);
  const operationBlockers = getPenToolOperationBlockers({
    canCommit,
    selectedPathLayerId,
    requireOneStepVectorMask: options.requireOneStepVectorMask === true,
  });
  const status = getPenToolReadinessStatus(canCommit, operationBlockers);
  const bezierHandleReadiness = describePenToolBezierHandleReadiness();
  const textOnPathReadiness = describePenToolTextOnPathReadiness();
  const descriptor: Omit<PenToolReadinessDescriptor, 'previewSignatures'> = {
    status,
    pointCreationState: buildPenToolPointCreationState(pointCount, canCommit),
    straightSegmentPathSupport: {
      status: 'supported',
      geometry: 'straight-segment',
      minimumCommitPoints: 2,
      pointCount,
      canCommit,
    },
    liveSession: {
      preview: 'supported',
      commit: 'supported',
      cancel: 'supported',
      previewLayerPersistence: 'temporary-until-commit',
      commitKeys: workflow.commitKeys,
      cancelKeys: workflow.cancelKeys,
    },
    pathLayerOutput: {
      status: 'supported',
      outputKind: 'retained-vector-path-layer',
      shapeKind: 'path',
      layerBackedPath: true,
      editableAfterCommit: true,
    },
    interop,
    missingStates: {
      bezierHandles: 'supported',
      curvatureMode: 'supported',
      textOnPath: 'unsupported',
    },
    unsupportedEditingStates: buildPenToolUnsupportedEditingStates(),
    actionSuitability: buildPenToolActionSuitability(canCommit, selectedPathLayerId),
    oneStepVectorMaskCaveat: {
      status: 'two-step-required',
      message: 'Create or select a retained path layer first, then convert it to a vector mask from the Paths workflow.',
    },
    bezierHandleReadiness,
    textOnPathReadiness,
    warnings: [...workflow.warnings, ...extraWarnings],
    operationBlockers,
  };

  return {
    ...descriptor,
    previewSignatures: {
      workflow: workflow.previewSignature,
      readiness: buildPenToolReadinessPreviewSignature({
        status,
        pointCount,
        canCommit,
        targetLayerId: options.targetLayerId ?? null,
        selectedPathLayerId,
        interop,
        warnings: descriptor.warnings,
        operationBlockers,
        bezierHandleReadiness,
        textOnPathReadiness,
      }),
    },
  };
}

export function describePenToolBezierHandleReadiness(): PenToolBezierHandleReadinessDescriptor {
  const descriptor: Omit<PenToolBezierHandleReadinessDescriptor, 'signature'> = {
    state: 'ready',
    inputGesture: 'click-drag-anchor-or-drag-retained-handle',
    storedHandleModel: 'retained-in-out-handles',
    canCreateSmoothAnchors: true,
    canEditInOutHandles: true,
    blockerCodes: [],
  };
  return {
    ...descriptor,
    signature: `pen-bezier-handles:v1:${JSON.stringify(descriptor)}`,
  };
}

export function describePenToolTextOnPathReadiness(): PenToolTextOnPathReadinessDescriptor {
  const descriptor: Omit<PenToolTextOnPathReadinessDescriptor, 'signature'> = {
    state: 'unsupported',
    canAttachTextLayer: false,
    canEditBaselineOffset: false,
    canEditBezierTextFlow: false,
    caveats: ['bezier-text-on-path-editing-unsupported', 'text-on-path-layout-engine-missing'],
  };
  return {
    ...descriptor,
    signature: `pen-text-on-path:v1:${JSON.stringify(descriptor)}`,
  };
}

export function getUnsupportedPenToolWorkflowWarnings(
  options: PenToolWorkflowDescriptorOptions = {},
): PenToolWorkflowWarning[] {
  // Curvature creation, anchor conversion, and the two selection interactions are now backed by
  // retained vector layers. Keep this option consumed so callers can continue asking for the
  // capability without receiving a stale unsupported warning.
  void options.requireCurvatureMode;
  return [];
}

function getPenToolReadinessWarnings(options: PenToolReadinessOptions): PenToolWorkflowWarning[] {
  const warnings: PenToolWorkflowWarning[] = [];
  if (options.requireTextOnPath) {
    warnings.push({
      code: 'unsupported-text-on-path',
      severity: 'warning',
      capability: 'bezier-handles',
      message: 'Text on a Pen path is not implemented; path layers can be selected, filled, stroked, or converted to vector masks only after commit.',
    });
  }
  if (options.requireOneStepVectorMask) {
    warnings.push({
      code: 'one-step-vector-mask-unsupported',
      severity: 'warning',
      capability: 'commit-retained-path',
      message: 'One-step Pen-to-vector-mask creation is not implemented; commit the path layer first, then convert it through the path/vector-mask workflow.',
    });
  }
  return warnings;
}

function getPenToolOperationBlockers({
  canCommit,
  selectedPathLayerId,
  requireOneStepVectorMask,
}: {
  canCommit: boolean;
  selectedPathLayerId: string | null;
  requireOneStepVectorMask: boolean;
}): PenToolOperationBlocker[] {
  const blockers: PenToolOperationBlocker[] = [];
  if (!canCommit) {
    blockers.push({
      code: 'insufficient-anchors',
      severity: 'error',
      operation: 'commit-retained-path',
      message: 'A retained Pen path requires at least two clicked anchors before commit.',
    });
  }
  if (!selectedPathLayerId) {
    blockers.push({
      code: 'missing-committed-path-layer',
      severity: 'error',
      operation: 'convert-path-to-vector-mask',
      message: 'Vector-mask conversion requires a committed retained path layer selection.',
    });
  }
  if (requireOneStepVectorMask) {
    blockers.push({
      code: 'one-step-vector-mask-unsupported',
      severity: 'warning',
      operation: 'create-vector-mask-directly-from-active-pen-session',
      message: 'Pen paths can become vector masks after they are committed as retained path layers; direct one-step Pen-to-mask creation is not available.',
    });
  }
  return blockers;
}

function getPenToolReadinessStatus(
  canCommit: boolean,
  operationBlockers: PenToolOperationBlocker[],
): PenToolReadinessStatus {
  if (!canCommit || operationBlockers.some((blocker) => blocker.severity === 'error')) {
    return 'blocked';
  }
  if (operationBlockers.length > 0) return 'limited-ready';
  return 'ready';
}

function buildPenToolPointCreationState(
  pointCount: number,
  canCommit: boolean,
): PenToolReadinessDescriptor['pointCreationState'] {
  return {
    mode: 'adding-straight-anchors',
    pointCount,
    previewPoint: 'not-tracked-by-descriptor',
    canPreviewPath: pointCount > 0,
    canCommitPath: canCommit,
  };
}

function buildPenToolUnsupportedEditingStates(): PenToolReadinessDescriptor['unsupportedEditingStates'] {
  return {
    bezierHandleEditing: 'supported',
    anchorConversion: 'supported',
    directSelectionTool: 'supported',
    pathSelectionTool: 'supported',
  };
}

function buildPenToolActionSuitability(
  canCommit: boolean,
  selectedPathLayerId: string | null,
): PenToolReadinessDescriptor['actionSuitability'] {
  const hasCommittedPath = Boolean(selectedPathLayerId);
  return {
    panelCommands: canCommit && hasCommittedPath ? 'suitable-after-commit' : 'blocked-until-commit',
    batchActions: canCommit && hasCommittedPath ? 'suitable-after-commit' : 'blocked',
    macroPlayback: canCommit && hasCommittedPath ? 'suitable-deterministic-after-commit' : 'blocked',
    liveBezierEditing: canCommit && hasCommittedPath ? 'suitable-after-commit' : 'blocked-until-commit',
  };
}

export const penTool: ToolHandler = {
  onPointerDown(env, point) {
    if (!session || session.docId !== env.doc.id) {
      session = {
        docId: env.doc.id,
        layerId: null,
        beforeLayers: env.doc.layers,
        beforeActiveLayerId: env.doc.activeLayerId,
        points: [],
        previewPoint: null,
        dragAnchorIndex: null,
        closed: false,
      };
    }
    if (session.closed) {
      previewPath(env);
      return;
    }
    if (shouldClosePenPath(session, point)) {
      session.closed = true;
      session.previewPoint = null;
      session.dragAnchorIndex = null;
      previewPath(env);
      return;
    }
    session.points.push(point);
    session.dragAnchorIndex = session.points.length - 1;
    session.previewPoint = null;
    previewPath(env);
  },

  onPointerMove(env, point, _mods, event) {
    if (!session || session.docId !== env.doc.id || session.points.length === 0 || session.closed) return;
    if (session.dragAnchorIndex !== null && isPenAnchorDragEvent(event)) {
      updateDraggedPenAnchorHandles(session, session.dragAnchorIndex, point);
      session.previewPoint = null;
      previewPath(env);
      return;
    }
    session.previewPoint = point;
    previewPath(env);
  },

  onPointerUp(env) {
    if (!session || session.docId !== env.doc.id) return;
    session.dragAnchorIndex = null;
  },

  onKeyDown(env, key, _mods, event) {
    if (!session || session.docId !== env.doc.id) return;
    if (key === 'Enter') {
      event.preventDefault?.();
      commitPath(env);
      return;
    }
    if (key === 'Escape') {
      event.preventDefault?.();
      cancelPath(env);
    }
  },

  onCancel(env) {
    cancelPath(env);
  },
};

function previewPath(env: ToolEnv): void {
  if (!session) return;
  const currentStore = useImageEditorStore.getState();
  const currentDoc = currentStore.documents.find((candidate) => candidate.id === session?.docId);
  if (!currentDoc) return;
  const points = session.previewPoint
    ? [...session.points, session.previewPoint]
    : session.points;
  if (points.length === 0) return;
  const settings = resolvePenToolSettings(env);
  const existingLayer = session.layerId
    ? currentDoc.layers.find((layer) => layer.id === session?.layerId) ?? null
    : null;
  const nextLayer = buildVectorPathLayer({
    doc: currentDoc,
    points,
    closed: session.closed,
    settings,
    existingLayer,
  });

  if (!session.layerId) {
    session.layerId = nextLayer.id;
    currentStore.addLayer(currentDoc.id, nextLayer);
  } else {
    currentStore.setLayers(
      currentDoc.id,
      currentDoc.layers.map((layer) => (layer.id === session?.layerId ? nextLayer : layer)),
      nextLayer.id,
    );
  }
  env.requestRender();
}

function commitPath(env: ToolEnv): void {
  if (!session) return;
  session.previewPoint = null;
  if (session.points.length < 2) {
    cancelPath(env);
    return;
  }

  previewPath(env);
  const currentDoc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === session?.docId);
  if (currentDoc && session.layerId) {
    env.pushOperation({
      kind: 'layerOp',
      docId: currentDoc.id,
      before: session.beforeLayers,
      after: currentDoc.layers,
    });
  }
  session = null;
}

function shouldClosePenPath(currentSession: PenSession, point: Point): boolean {
  if (currentSession.points.length < 3) return false;
  const firstPoint = currentSession.points[0];
  if (!firstPoint) return false;
  return Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) <= PEN_CLOSE_ANCHOR_HIT_RADIUS_PX;
}

function isPenAnchorDragEvent(event: PointerEvent): boolean {
  return typeof event.buttons !== 'number' || event.buttons > 0;
}

function updateDraggedPenAnchorHandles(
  currentSession: PenSession,
  pointIndex: number,
  handlePoint: Point,
): void {
  const anchor = currentSession.points[pointIndex];
  if (!anchor) return;
  const delta = {
    x: handlePoint.x - anchor.x,
    y: handlePoint.y - anchor.y,
  };
  if (Math.hypot(delta.x, delta.y) < 2) {
    currentSession.points[pointIndex] = {
      x: anchor.x,
      y: anchor.y,
    };
    return;
  }
  currentSession.points[pointIndex] = {
    ...anchor,
    inHandle: {
      x: Math.round(anchor.x - delta.x),
      y: Math.round(anchor.y - delta.y),
    },
    outHandle: {
      x: Math.round(anchor.x + delta.x),
      y: Math.round(anchor.y + delta.y),
    },
  };
}

function cancelPath(env: ToolEnv): void {
  if (!session) return;
  useImageEditorStore.getState().setLayers(session.docId, session.beforeLayers, session.beforeActiveLayerId);
  env.requestRender();
  session = null;
}

function resolvePenToolSettings(env: ToolEnv): ShapeToolSettings {
  const settings = env.shapeToolSettings ?? {
    ...DEFAULT_SHAPE_TOOL_SETTINGS,
    strokeColor: env.brushSettings.color,
    strokeOpacity: env.brushSettings.opacity,
  };
  return {
    ...settings,
    strokeWidth: settings.strokeWidth > 0 ? settings.strokeWidth : 2,
  };
}

function buildPenToolWorkflowCapabilityDescriptor(
  kind: PenToolWorkflowCapabilityKind,
  warnings: PenToolWorkflowWarning[],
): PenToolWorkflowCapabilityDescriptor {
  const base = getPenToolWorkflowCapabilityBase(kind);
  return {
    kind,
    label: penToolWorkflowCapabilityLabel(kind),
    ...base,
    warnings: warnings.filter((warning) => warning.capability === kind),
  };
}

function getPenToolWorkflowCapabilityBase(
  kind: PenToolWorkflowCapabilityKind,
): Omit<PenToolWorkflowCapabilityDescriptor, 'kind' | 'label' | 'warnings'> {
  switch (kind) {
    case 'add-straight-anchor':
      return {
        supported: true,
        gesture: 'click',
        result: 'straight-segment-anchor',
      };
    case 'close-straight-path':
      return {
        supported: true,
        gesture: 'click-first-anchor',
        result: 'closed-straight-segment-path',
      };
    case 'live-preview-vector-layer':
      return {
        supported: true,
        gesture: 'move',
        result: 'preview-vector-path-layer',
      };
    case 'commit-retained-path':
      return {
        supported: true,
        gesture: 'Enter',
        result: 'undoable-vector-path-layer',
      };
    case 'cancel-preview-path':
      return {
        supported: true,
        gesture: 'Escape',
        result: 'restore-pre-session-layers',
      };
    case 'bezier-handles':
      return {
        supported: true,
        gesture: 'click-drag-anchor-or-drag-retained-handle',
        result: 'retained-cubic-bezier-handles',
      };
    case 'curvature-mode':
      return {
        supported: true,
        gesture: 'click-drag-anchor',
        result: 'retained-cubic-bezier-anchor',
      };
    case 'anchor-conversion':
      return {
        supported: true,
        gesture: 'paths-panel-corner-or-smooth',
        result: 'undoable-retained-anchor-conversion',
      };
    case 'independent-direct-selection':
      return {
        supported: true,
        gesture: 'paths-panel-direct-edit-selected-anchor',
        result: 'canvas-retained-anchor-overlay',
      };
    case 'independent-path-selection':
      return {
        supported: true,
        gesture: 'paths-panel-select-path',
        result: 'active-retained-path-layer',
      };
  }
}

function penToolWorkflowCapabilityLabel(kind: PenToolWorkflowCapabilityKind): string {
  switch (kind) {
    case 'add-straight-anchor':
      return 'Add straight anchor';
    case 'close-straight-path':
      return 'Close straight path';
    case 'live-preview-vector-layer':
      return 'Live preview vector layer';
    case 'commit-retained-path':
      return 'Commit retained path';
    case 'cancel-preview-path':
      return 'Cancel preview path';
    case 'bezier-handles':
      return 'Bezier handles';
    case 'curvature-mode':
      return 'Curvature mode';
    case 'anchor-conversion':
      return 'Anchor conversion';
    case 'independent-direct-selection':
      return 'Independent direct selection';
    case 'independent-path-selection':
      return 'Independent path selection';
  }
}

function buildPenToolCreationSessionDescriptor(): PenToolWorkflowDescriptor['creationSession'] {
  return {
    kind: 'path-creation',
    storage: 'preview-vector-layer',
    commitAction: 'commit-retained-vector-path-layer',
    cancelAction: 'restore-pre-session-layer-stack',
    previewId: 'pen-tool:path-creation',
  };
}

function buildPenToolEditSessionDescriptor(): PenToolWorkflowDescriptor['editSession'] {
  return {
    kind: 'path-anchor-editing',
    supported: true,
    owner: 'paths-panel-anchor-controls',
    availability: 'after-commit',
    selection: 'single-or-multi-anchor-descriptor',
    moveOperation: 'delegated-retained-path-anchor-move',
    limitation: 'Curvature creation, Corner/Smooth conversion, and direct anchor editing are retained; text on path and live boolean stacks remain unavailable.',
  };
}

function buildPenToolPathClassificationDescriptor(): PenToolWorkflowDescriptor['pathClassification'] {
  return {
    savedPath: 'layer-backed-vector-path',
    workPath: 'pen-preview-vector-layer',
    independentSavedPaths: false,
  };
}

function buildPenToolSupportStatusDescriptor(): PenToolWorkflowDescriptor['supportStatus'] {
  return {
    bezierHandles: 'supported',
    curvatureMode: 'supported',
    anchorConversion: 'supported',
  };
}

function buildPenToolSelectionSemanticsDescriptor(): PenToolWorkflowDescriptor['selectionSemantics'] {
  return {
    independentDirectSelection: true,
    independentPathSelection: true,
  };
}

function buildPenToolWorkflowPreviewSignature(
  descriptor: Omit<PenToolWorkflowDescriptor, 'previewSignature'>,
): string {
  return `pen-tool-workflow:v2:${JSON.stringify({
    pathStorage: descriptor.pathStorage,
    segmentGeometry: descriptor.segmentGeometry,
    creationSession: descriptor.creationSession,
    editSession: {
      kind: descriptor.editSession.kind,
      supported: descriptor.editSession.supported,
      owner: descriptor.editSession.owner,
      availability: descriptor.editSession.availability,
      selection: descriptor.editSession.selection,
      moveOperation: descriptor.editSession.moveOperation,
    },
    pathClassification: descriptor.pathClassification,
    supportStatus: descriptor.supportStatus,
    selectionSemantics: descriptor.selectionSemantics,
    booleanReadiness: descriptor.booleanReadiness,
    handoffCaveats: descriptor.handoffCaveats,
    commitKeys: descriptor.commitKeys,
    cancelKeys: descriptor.cancelKeys,
    capabilities: descriptor.capabilities.map((capability) => ({
      kind: capability.kind,
      supported: capability.supported,
      result: capability.result,
    })),
    warnings: descriptor.warnings.map((warning) => warning.code),
  })}`;
}

function buildPenToolReadinessPreviewSignature({
  status,
  pointCount,
  canCommit,
  targetLayerId,
  selectedPathLayerId,
  interop,
  warnings,
  operationBlockers,
  bezierHandleReadiness,
  textOnPathReadiness,
}: {
  status: PenToolReadinessStatus;
  pointCount: number;
  canCommit: boolean;
  targetLayerId: string | null;
  selectedPathLayerId: string | null;
  interop: PenToolReadinessDescriptor['interop'];
  warnings: PenToolWorkflowWarning[];
  operationBlockers: PenToolOperationBlocker[];
  bezierHandleReadiness?: PenToolBezierHandleReadinessDescriptor;
  textOnPathReadiness?: PenToolTextOnPathReadinessDescriptor;
}): string {
  const missing = warnings.flatMap((warning) => {
    switch (warning.code) {
      case 'unsupported-bezier-handles':
        return ['bezier-handles'];
      case 'unsupported-curvature-mode':
        return ['curvature-mode'];
      case 'unsupported-text-on-path':
        return ['text-on-path'];
      default:
        return [];
    }
  });
  return `pen-tool-readiness:v1:${JSON.stringify({
    status,
    pointCount,
    canCommit,
    targetLayerId,
    selectedPathLayerId,
    interop,
    missing,
    blockers: operationBlockers.map((blocker) => blocker.code),
    ...(bezierHandleReadiness ? { bezier: bezierHandleReadiness.signature } : {}),
    ...(textOnPathReadiness ? { textOnPath: textOnPathReadiness.signature } : {}),
  })}`;
}
