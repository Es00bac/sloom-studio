import type { ToolHandler, Point, ToolEnv } from './types';
import type { ImageDocument, ImageLayer } from '../../../types/imageEditor';
import { canMoveImageLayer } from '../../../lib/imageLayerLocks';
import { getImageLayerLinkGroupMembers } from '../../../lib/imageLayerLinks';
import { resolveSelectedLayerIds } from '../ImageGroupTransform';
import { resolveImageLayerTransformOrigin } from '../ImageLayerTransform';
import { applyTransformPreviewSession, cancelTransformPreviewSession, getTransformPreviewSession } from '../ImageTransformPreview';
import {
  applySelectionTransformSession,
  beginSelectionTransformSession,
  cancelSelectionTransformSession,
  getSelectionTransformSession,
  updateSelectionTransformBounds,
  type SelectionTransformBounds,
} from '../ImageSelectionTransform';
import {
  clearFloatingSelection,
  getFloatingSelection,
  getSelection,
  setFloatingSelection,
} from '../selectionRegistry';
import { maskBoundingBox, type SelectionMask } from '../SelectionMask';
import { createBitmap } from '../LayerBitmap';
import { liftSelectionPixels } from './selectionPixelMove';
import type { LayerBitmap } from '../../../types/imageEditor';

interface MoveLayerState {
  kind: 'layer';
  layerId: string;
  startPoint: Point;
  origin: { x: number; y: number; rotationDeg?: number; transformOriginX?: number; transformOriginY?: number };
  linkedOrigins: Array<{ layerId: string; x: number; y: number }>;
  beforeLayers: ImageLayer[];
}

interface MoveSelectionState {
  kind: 'selection';
  docId: string;
  startPoint: Point;
  origin: SelectionTransformBounds;
  /** Layers snapshot at gesture start, so the lift + move commits as one undoable layerOp. */
  beforeLayers: ImageLayer[];
  /** The active image layer the selected pixels are lifted from (null when nothing is liftable). */
  sourceLayerId: string | null;
  /** The selection mask at gesture start — used for the lift bounding box and cancel-restore. */
  selection: SelectionMask;
  /**
   * Photoshop-style floating selection: dragging the selected pixels lifts them onto a NEW layer
   * (the source keeps a clean hole) instead of compositing them back into the source — which used
   * to overwrite, then on the next drag re-cut, whatever sat beneath the previous drop. Set lazily
   * on the first actual movement (a click alone must not float), or carried over from a prior drag
   * via the registry so re-moves translate the SAME layer.
   */
  float: {
    layerId: string;
    startX: number;
    startY: number;
    /** True when THIS gesture created the float (so cancel removes it + restores the source). */
    createdThisGesture: boolean;
    /** The source layer's bitmap before the lift erased it — for cancel-restore. */
    originalSourceBitmap: LayerBitmap | null;
  } | null;
  moved: boolean;
}

type MoveState = MoveLayerState | MoveSelectionState;

export type MoveToolWorkflowMode = 'none' | 'single-layer' | 'linked-layer-group';
export type MoveToolStationaryReason = 'full-lock' | 'position-lock' | 'group-layer';
export type MoveToolParityStationaryReason = MoveToolStationaryReason | 'not-selected';
export type MoveToolNudgeCommandId =
  | 'nudgeLayerLeft'
  | 'nudgeLayerRight'
  | 'nudgeLayerUp'
  | 'nudgeLayerDown'
  | 'nudgeLayerLeftLarge'
  | 'nudgeLayerRightLarge'
  | 'nudgeLayerUpLarge'
  | 'nudgeLayerDownLarge';
export type MoveToolAlignCommandId =
  | 'alignLayerLeft'
  | 'alignLayerRight'
  | 'alignLayerTop'
  | 'alignLayerBottom'
  | 'centerLayerHorizontal'
  | 'centerLayerVertical';

export interface MoveToolStationaryLayerDescriptor {
  layerId: string;
  reason: MoveToolStationaryReason;
}

export interface MoveToolDragDescriptor {
  updates: 'live-layer-position';
  axisConstraint: 'shift-dominant-axis';
  undoOperation: 'transform' | 'layerOp';
}

export interface MoveToolMovementDescriptor {
  supported: boolean;
  mode: MoveToolWorkflowMode;
  linkedLayerIds: string[];
  movableLayerIds: string[];
  stationaryLayers: MoveToolStationaryLayerDescriptor[];
  drag: MoveToolDragDescriptor;
}

export type MoveToolSourceSafetyWarningCode = 'move-source-metadata-only' | 'move-source-link-missing';

export interface MoveToolSourceSafetyWarningDescriptor {
  code: MoveToolSourceSafetyWarningCode;
  severity: 'info' | 'warning';
  layerIds: string[];
  message: string;
}

export interface MoveToolSourceSafetyDescriptor {
  metadataOnly: true;
  mutatesPixels: false;
  mutatesSourceAssets: false;
  sourceLinkedLayerIds: string[];
  missingSourceLayerIds: string[];
  relinkedSourceLayerIds: string[];
  sourceIds: string[];
  warnings: MoveToolSourceSafetyWarningDescriptor[];
  signature: string;
}

export interface MoveToolNudgeCommandDescriptor {
  id: MoveToolNudgeCommandId;
  dx: number;
  dy: number;
}

export interface MoveToolNudgeDescriptor {
  supported: boolean;
  incrementsPx: number[];
  commands: MoveToolNudgeCommandDescriptor[];
}

export interface MoveToolAlignCommandDescriptor {
  id: MoveToolAlignCommandId;
  axis: 'x' | 'y';
  edge: 'min' | 'max' | 'center';
  x?: number;
  y?: number;
}

export type MoveToolCommandReadinessBlocker =
  | 'missing-active-layer'
  | 'active-layer-full-lock'
  | 'active-layer-position-lock'
  | 'active-layer-group'
  | 'stationary-linked-members'
  | 'no-movable-layers';

export type MoveToolDistributeReadinessBlocker =
  | MoveToolCommandReadinessBlocker
  | 'not-enough-movable-layers'
  | 'multi-layer-selection-unsupported';

export interface MoveToolAlignDescriptor {
  supported: boolean;
  target: 'canvas';
  commands: MoveToolAlignCommandDescriptor[];
  unsupportedTargets: Array<'selection' | 'multi-layer-selection'>;
}

export interface MoveToolSnapDescriptor {
  supported: true;
  modes: readonly string[];
  appliedDuring: 'runtime-drag';
  snapDistancePx: number;
  warnings: MoveToolWarningDescriptor[];
}

export interface MoveToolDistributeDescriptor {
  supported: false;
  commands: string[];
  unsupportedReason: string;
  warnings: MoveToolWarningDescriptor[];
}

export interface MoveToolWarningDescriptor {
  code: 'move-snapping-unsupported' | 'move-distribution-unsupported';
  severity: 'warning';
  message: string;
}

export interface MoveToolExportCaveatDescriptor {
  code: 'move-export-uses-layer-position';
  severity: 'info';
  message: string;
}

export interface MoveToolTransformStatusDescriptor {
  destructive: false;
  nonDestructive: true;
  commitModel: 'live-position-metadata';
}

export interface MoveToolWorkflowDescriptor {
  descriptorId: 'move-tool-workflow:v1';
  document: { id: string; width: number; height: number };
  activeLayerId: string | null;
  activeLayerType: ImageLayer['type'] | null;
  movement: MoveToolMovementDescriptor;
  sourceSafety: MoveToolSourceSafetyDescriptor;
  nudge: MoveToolNudgeDescriptor;
  align: MoveToolAlignDescriptor;
  snap: MoveToolSnapDescriptor;
  distribute: MoveToolDistributeDescriptor;
  transformStatus: MoveToolTransformStatusDescriptor;
  preview: { id: string; signature: string };
  exportCaveats: MoveToolExportCaveatDescriptor[];
  previewSignature: string;
}

export interface MoveToolGeometryBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface MoveToolLayerGeometryDescriptor {
  layerId: string;
  name: string;
  type: ImageLayer['type'];
  bounds: MoveToolGeometryBounds;
  snapPoints: { x: number[]; y: number[] };
}

export interface MoveToolStationaryGeometryDescriptor extends MoveToolLayerGeometryDescriptor {
  reason: MoveToolParityStationaryReason;
}

export interface MoveToolSnapGuideDescriptor {
  id: string;
  source: 'document' | 'layer';
  layerId?: string;
  axis: 'x' | 'y';
  value: number;
}

export interface MoveToolCandidateSnapTargetDescriptor {
  guideId: string;
  axis: 'x' | 'y';
  source: 'document' | 'layer';
  layerId?: string;
  value: number;
  nearestMovableLayerId: string;
  movablePoint: number;
  requiredDelta: number;
  withinSnapDistance: boolean;
}

export interface MoveToolSnapCandidateSummaryEntry {
  axis: 'x' | 'y';
  guideId: string;
  source: 'document' | 'layer';
  layerId?: string;
  value: number;
  nearestMovableLayerId: string;
  requiredDelta: number;
  withinSnapDistance: boolean;
}

export interface MoveToolSnapCandidateSummaryDescriptor {
  guideCounts: {
    vertical: number;
    horizontal: number;
    document: number;
    layer: number;
  };
  candidateCount: number;
  withinSnapDistanceCount: number;
  closestByAxis: MoveToolSnapCandidateSummaryEntry[];
  signature: string;
}

export interface MoveToolCommandReadinessDescriptor {
  id: MoveToolAlignCommandId;
  ready: boolean;
  target: 'canvas';
  blockers?: MoveToolCommandReadinessBlocker[];
}

export interface MoveToolDistributeReadinessDescriptor {
  id: 'distribute-horizontal-centers' | 'distribute-vertical-centers' | 'distribute-horizontal-spacing' | 'distribute-vertical-spacing';
  ready: boolean;
  blockers?: MoveToolDistributeReadinessBlocker[];
}

export interface MoveToolParityPlanBlockerDescriptor {
  code: 'missing-layer' | 'stationary-layer';
  layerId: string;
  reason: 'missing-active-layer' | MoveToolParityStationaryReason;
}

export interface MoveToolParityPlanDescriptor {
  descriptorId: 'move-tool-parity-plan:v1';
  documentBounds: MoveToolGeometryBounds;
  activeLayerId: string | null;
  snapDistancePx: number;
  runtimeSnapping: {
    supported: true;
    previewOnly: false;
    appliedDuring: 'runtime-drag';
    modes: ReadonlyArray<'document-guides' | 'layer-edges' | 'layer-centers'>;
    warnings: MoveToolWarningDescriptor[];
  };
  runtimeDistribution: {
    supported: false;
    previewOnly: true;
    commands: MoveToolDistributeReadinessDescriptor['id'][];
    unsupportedReason: string;
    warnings: MoveToolWarningDescriptor[];
  };
  sourceSafety: MoveToolSourceSafetyDescriptor;
  movableGeometry: MoveToolLayerGeometryDescriptor[];
  stationaryGeometry: MoveToolStationaryGeometryDescriptor[];
  snapGuides: {
    vertical: MoveToolSnapGuideDescriptor[];
    horizontal: MoveToolSnapGuideDescriptor[];
  };
  candidateSnapTargets: MoveToolCandidateSnapTargetDescriptor[];
  snapCandidateSummary: MoveToolSnapCandidateSummaryDescriptor;
  alignReadiness: MoveToolCommandReadinessDescriptor[];
  distributeReadiness: MoveToolDistributeReadinessDescriptor[];
  blockers: MoveToolParityPlanBlockerDescriptor[];
  warnings: MoveToolWarningDescriptor[];
  preview: { id: string; signature: string };
}

export interface MoveToolAppliedSnapTargetDescriptor {
  guideId: string;
  axis: 'x' | 'y';
  source: 'document' | 'layer';
  layerId?: string;
  value: number;
  movableLayerId: string;
  movablePoint: number;
}

export interface MoveToolSnappedDeltaDescriptor {
  dx: number;
  dy: number;
  snapped: boolean;
  appliedTargets: MoveToolAppliedSnapTargetDescriptor[];
  signature: string;
}

let active: MoveState | null = null;
const MOVE_TOOL_SNAP_DISTANCE_PX = 8;
const MOVE_TOOL_DISTRIBUTE_COMMAND_IDS: MoveToolDistributeReadinessDescriptor['id'][] = [
  'distribute-horizontal-centers',
  'distribute-vertical-centers',
  'distribute-horizontal-spacing',
  'distribute-vertical-spacing',
];

const MOVE_TOOL_NUDGE_COMMANDS: MoveToolNudgeCommandDescriptor[] = [
  { id: 'nudgeLayerLeft', dx: -1, dy: 0 },
  { id: 'nudgeLayerRight', dx: 1, dy: 0 },
  { id: 'nudgeLayerUp', dx: 0, dy: -1 },
  { id: 'nudgeLayerDown', dx: 0, dy: 1 },
  { id: 'nudgeLayerLeftLarge', dx: -10, dy: 0 },
  { id: 'nudgeLayerRightLarge', dx: 10, dy: 0 },
  { id: 'nudgeLayerUpLarge', dx: 0, dy: -10 },
  { id: 'nudgeLayerDownLarge', dx: 0, dy: 10 },
];

export function describeMoveToolWorkflow(
  doc: ImageDocument,
  activeLayerId: string | null = doc.activeLayerId,
): MoveToolWorkflowDescriptor {
  const requestedLayerId = activeLayerId ?? doc.activeLayerId ?? null;
  const activeLayer = requestedLayerId
    ? doc.layers.find((candidate) => candidate.id === requestedLayerId) ?? null
    : null;
  const linkedLayers = getImageLayerLinkGroupMembers(activeLayer, doc.layers);
  const movableLayers = linkedLayers.filter(isMoveToolLayerMovable);
  const stationaryLayers = linkedLayers
    .filter((layer) => !isMoveToolLayerMovable(layer))
    .map((layer) => ({
      layerId: layer.id,
      reason: describeMoveToolStationaryReason(layer),
    }));
  const supported = Boolean(activeLayer && isMoveToolLayerMovable(activeLayer) && movableLayers.length > 0);
  const alignCommands = describeMoveToolAlignCommands(doc, activeLayer);
  const activeLayerIdForDescriptor = activeLayer?.id ?? requestedLayerId;
  const sourceSafety = describeMoveToolSourceSafety(linkedLayers);
  const movement: MoveToolMovementDescriptor = {
    supported,
    mode: describeMoveToolMode(activeLayer, linkedLayers),
    linkedLayerIds: linkedLayers.map((layer) => layer.id),
    movableLayerIds: movableLayers.map((layer) => layer.id),
    stationaryLayers,
    drag: {
      updates: 'live-layer-position',
      axisConstraint: 'shift-dominant-axis',
      undoOperation: movableLayers.length > 1 ? 'layerOp' : 'transform',
    },
  };
  const previewSignature = buildMoveToolWorkflowPreviewSignature(doc, activeLayerIdForDescriptor, movement, alignCommands);
  const distributeUnsupportedReason = 'Layer distribution requires multi-layer selection bounds and is not implemented by the current Move tool workflow.';

  return {
    descriptorId: 'move-tool-workflow:v1',
    document: { id: doc.id, width: doc.width, height: doc.height },
    activeLayerId: activeLayerIdForDescriptor,
    activeLayerType: activeLayer?.type ?? null,
    movement,
    sourceSafety,
    nudge: {
      supported,
      incrementsPx: [1, 10],
      commands: MOVE_TOOL_NUDGE_COMMANDS.map((command) => ({ ...command })),
    },
    align: {
      supported,
      target: 'canvas',
      commands: alignCommands,
      unsupportedTargets: ['selection', 'multi-layer-selection'],
    },
    snap: {
      supported: true,
      modes: ['document-guides', 'layer-edges', 'layer-centers'],
      appliedDuring: 'runtime-drag',
      snapDistancePx: MOVE_TOOL_SNAP_DISTANCE_PX,
      warnings: [],
    },
    distribute: {
      supported: false,
      commands: ['distribute-horizontal-centers', 'distribute-vertical-centers', 'distribute-spacing'],
      unsupportedReason: distributeUnsupportedReason,
      warnings: [
        {
          code: 'move-distribution-unsupported',
          severity: 'warning',
          message: distributeUnsupportedReason,
        },
      ],
    },
    transformStatus: {
      destructive: false,
      nonDestructive: true,
      commitModel: 'live-position-metadata',
    },
    preview: {
      id: `move-tool-workflow:${doc.id}:${activeLayerIdForDescriptor ?? 'none'}`,
      signature: previewSignature,
    },
    exportCaveats: [
      {
        code: 'move-export-uses-layer-position',
        severity: 'info',
        message: 'Move commits update layer position metadata; export uses the committed layer coordinates without additional smart-object instructions.',
      },
    ],
    previewSignature,
  };
}

export function describeMoveToolParityPlan(
  doc: ImageDocument,
  activeLayerId: string | null = doc.activeLayerId,
): MoveToolParityPlanDescriptor {
  const requestedLayerId = activeLayerId ?? doc.activeLayerId ?? null;
  const activeLayer = requestedLayerId
    ? doc.layers.find((candidate) => candidate.id === requestedLayerId) ?? null
    : null;
  const linkedLayers = getImageLayerLinkGroupMembers(activeLayer, doc.layers);
  const movableLayers = activeLayer ? linkedLayers.filter(isMoveToolLayerMovable) : [];
  const movableLayerIds = new Set(movableLayers.map((layer) => layer.id));
  const stationaryLayers = doc.layers.filter((layer) => !movableLayerIds.has(layer.id));
  const movableGeometry = movableLayers.map(describeMoveToolLayerGeometry);
  const stationaryGeometry = stationaryLayers.map((layer) => ({
    ...describeMoveToolLayerGeometry(layer),
    reason: describeMoveToolParityStationaryReason(layer, activeLayer, linkedLayers),
  }));
  const snapGuides = describeMoveToolSnapGuides(doc, stationaryGeometry);
  const candidateSnapTargets = describeMoveToolCandidateSnapTargets(movableGeometry, snapGuides, MOVE_TOOL_SNAP_DISTANCE_PX);
  const snapCandidateSummary = describeMoveToolSnapCandidateSummary(snapGuides, candidateSnapTargets);
  const readinessBlockers = describeMoveToolCommandReadinessBlockers(activeLayer, movableLayers, linkedLayers);
  const alignReadiness = describeMoveToolAlignReadiness(readinessBlockers);
  const distributeReadiness = describeMoveToolDistributeReadiness(readinessBlockers, movableLayers.length);
  const blockers = describeMoveToolParityPlanBlockers(requestedLayerId, activeLayer, stationaryGeometry);
  const sourceSafety = describeMoveToolSourceSafety(linkedLayers);
  const runtimeDistributionReason = 'Layer distribution requires multi-layer selection bounds and is not applied by runtime Move dragging.';
  const warnings: MoveToolWarningDescriptor[] = [
    {
      code: 'move-distribution-unsupported',
      severity: 'warning',
      message: runtimeDistributionReason,
    },
  ];
  const planWithoutPreview = {
    descriptorId: 'move-tool-parity-plan:v1' as const,
    documentBounds: describeMoveToolDocumentBounds(doc),
    activeLayerId: requestedLayerId,
    snapDistancePx: MOVE_TOOL_SNAP_DISTANCE_PX,
    runtimeSnapping: {
      supported: true as const,
      previewOnly: false as const,
      appliedDuring: 'runtime-drag' as const,
      modes: ['document-guides', 'layer-edges', 'layer-centers'] as const,
      warnings: [],
    },
    runtimeDistribution: {
      supported: false as const,
      previewOnly: true as const,
      commands: MOVE_TOOL_DISTRIBUTE_COMMAND_IDS.map((id) => id),
      unsupportedReason: runtimeDistributionReason,
      warnings: warnings.filter((warning) => warning.code === 'move-distribution-unsupported'),
    },
    sourceSafety,
    movableGeometry,
    stationaryGeometry,
    snapGuides,
    candidateSnapTargets,
    snapCandidateSummary,
    alignReadiness,
    distributeReadiness,
    blockers,
    warnings,
  };
  return {
    ...planWithoutPreview,
    preview: {
      id: `move-tool-parity-plan:${doc.id}:${requestedLayerId ?? 'none'}`,
      signature: buildMoveToolParityPlanPreviewSignature(doc, planWithoutPreview),
    },
  };
}

export function calculateMoveToolSnappedDelta(
  plan: MoveToolParityPlanDescriptor,
  delta: { dx: number; dy: number },
): MoveToolSnappedDeltaDescriptor {
  const xSnap = findMoveToolDeltaSnap(plan.movableGeometry, plan.snapGuides.vertical, 'x', delta.dx, plan.snapDistancePx);
  const ySnap = findMoveToolDeltaSnap(plan.movableGeometry, plan.snapGuides.horizontal, 'y', delta.dy, plan.snapDistancePx);
  const dx = xSnap?.delta ?? delta.dx;
  const dy = ySnap?.delta ?? delta.dy;
  const appliedTargets = [xSnap, ySnap]
    .filter((snap): snap is NonNullable<typeof snap> => Boolean(snap))
    .map((snap) => ({
      guideId: snap.guide.id,
      axis: snap.axis,
      source: snap.guide.source,
      ...(snap.guide.layerId ? { layerId: snap.guide.layerId } : {}),
      value: snap.guide.value,
      movableLayerId: snap.layer.layerId,
      movablePoint: snap.point,
    }));
  const signature = `move-tool-snapped-delta:v1:${JSON.stringify({
    base: { dx: delta.dx, dy: delta.dy },
    snapped: { dx, dy },
    targets: appliedTargets.map((target) => `${target.guideId}:${target.axis}:${target.movableLayerId}`),
  })}`;
  return {
    dx,
    dy,
    snapped: appliedTargets.length > 0,
    appliedTargets,
    signature,
  };
}

/**
 * The movable layer origins for a Move drag: the union of the ad-hoc multi-selection
 * (`selectedLayerIds`) and each selected layer's explicit link-group members, restricted to
 * layers that can actually move. With a single selection this collapses to the active layer's
 * link group (the prior behaviour); with several layers selected they translate as one group.
 */
export function resolveMoveToolLinkedOrigins(
  doc: Pick<ImageDocument, 'layers' | 'activeLayerId' | 'selectedLayerIds'>,
): Array<{ layerId: string; x: number; y: number }> {
  const seen = new Set<string>();
  const origins: Array<{ layerId: string; x: number; y: number }> = [];
  for (const id of resolveSelectedLayerIds(doc)) {
    const layer = doc.layers.find((candidate) => candidate.id === id);
    if (!layer) continue;
    for (const member of getImageLayerLinkGroupMembers(layer, doc.layers)) {
      if (canMoveImageLayer(member) && !seen.has(member.id)) {
        seen.add(member.id);
        origins.push({ layerId: member.id, x: member.x, y: member.y });
      }
    }
  }
  return origins;
}

export const moveTool: ToolHandler = {
  onPointerDown(env, point) {
    applyTransformPreviewSession(env.doc.id, env.requestRender);
    const selectionDragState = beginMoveToolSelectionDrag(env, point);
    if (selectionDragState) {
      active = selectionDragState;
      env.requestRender();
      return;
    }
    if (!canMoveImageLayer(env.activeLayer)) {
      active = null;
      return;
    }
    const linkedOrigins = resolveMoveToolLinkedOrigins(env.doc);
    active = {
      kind: 'layer',
      layerId: env.activeLayer.id,
      startPoint: point,
      origin: {
        x: env.activeLayer.x,
        y: env.activeLayer.y,
        rotationDeg: env.activeLayer.rotationDeg ?? 0,
        transformOriginX: resolveImageLayerTransformOrigin(env.activeLayer).x,
        transformOriginY: resolveImageLayerTransformOrigin(env.activeLayer).y,
      },
      linkedOrigins,
      beforeLayers: env.doc.layers,
    };
  },

  onPointerMove(env, point, mods) {
    if (!active) return;
    let dx = point.x - active.startPoint.x;
    let dy = point.y - active.startPoint.y;
    if (mods.shift) {
      // Constrain to the dominant axis.
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    if (active.kind === 'selection') {
      const boundsChanged = updateSelectionTransformBounds(active.docId, {
        x: active.origin.x + dx,
        y: active.origin.y + dy,
        width: active.origin.width,
        height: active.origin.height,
      });
      // Lift on the first real movement — a click that never moves must not spawn a float layer.
      if (!active.float && active.sourceLayerId && (dx !== 0 || dy !== 0)) {
        const created = liftSelectionToNewLayer(env, active);
        if (created) {
          active.float = created;
          setFloatingSelection(active.docId, { layerId: created.layerId });
        } else {
          active.sourceLayerId = null; // nothing liftable (e.g. no canvas) — fall back to mask-only
        }
      }
      if (active.float) {
        // The floated pixels are an ordinary layer now; moving the selection just translates it.
        env.store.updateLayer(active.docId, active.float.layerId, {
          x: active.float.startX + dx,
          y: active.float.startY + dy,
        });
        active.moved = true;
        env.requestRender();
      } else if (boundsChanged) {
        env.requestRender();
      }
      return;
    }
    const snap = calculateMoveToolSnappedDelta(
      describeMoveToolParityPlan(env.doc, active.layerId),
      { dx, dy },
    );
    dx = snap.dx;
    dy = snap.dy;
    for (const origin of active.linkedOrigins) {
      env.store.updateLayer(env.doc.id, origin.layerId, {
        x: origin.x + dx,
        y: origin.y + dy,
      });
    }
    env.requestRender();
  },

  onPointerUp(env) {
    if (!active) return;
    if (active.kind === 'selection') {
      const sel = active; // capture the narrowed value so it stays typed inside the find() closure
      if (sel.float && sel.moved) {
        // One undoable step for the whole gesture: the source's cut + the new float layer + its
        // move (when this gesture created the float), or just the float's reposition (re-move).
        const currentDoc = env.store.documents.find((candidate) => candidate.id === sel.docId) ?? env.doc;
        env.pushOperation({
          kind: 'layerOp',
          docId: sel.docId,
          before: sel.beforeLayers,
          after: currentDoc.layers,
        });
        env.store.markDocumentDirty(sel.docId);
      }
      applySelectionTransformSession(sel.docId, env.requestRender);
      active = null;
      return;
    }
    const layerMove = active;
    const currentDoc = env.store.documents.find((candidate) => candidate.id === env.doc.id) ?? env.doc;
    const layer = currentDoc.layers.find((l) => l.id === layerMove.layerId);
    if (layer && (layer.x !== layerMove.origin.x || layer.y !== layerMove.origin.y)) {
      if (layerMove.linkedOrigins.length > 1) {
        env.pushOperation({
          kind: 'layerOp',
          docId: env.doc.id,
          before: layerMove.beforeLayers,
          after: currentDoc.layers,
        });
      } else {
        env.pushOperation({
          kind: 'transform',
          docId: env.doc.id,
          layerId: layer.id,
          before: layerMove.origin,
          after: {
            x: layer.x,
            y: layer.y,
            rotationDeg: layer.rotationDeg ?? 0,
            transformOriginX: resolveImageLayerTransformOrigin(layer).x,
            transformOriginY: resolveImageLayerTransformOrigin(layer).y,
          },
        });
      }
    }
    active = null;
  },

  onKeyDown(env, key) {
    if (getTransformPreviewSession(env.doc.id)) {
      if (key === 'Enter') {
        applyTransformPreviewSession(env.doc.id, env.requestRender);
      } else if (key === 'Escape') {
        cancelTransformPreviewSession(env.doc.id, env.requestRender);
      }
      return;
    }
    if (!getSelectionTransformSession(env.doc.id)) return;
    if (key === 'Enter') {
      applySelectionTransformSession(env.doc.id, env.requestRender);
    } else if (key === 'Escape') {
      cancelSelectionTransformSession(env.doc.id, env.requestRender);
    }
  },

  onCancel(env) {
    if (active?.kind === 'selection') {
      if (active.float?.createdThisGesture) {
        // Undo the lift made this gesture: restore the source pixels and drop the float layer.
        if (active.sourceLayerId && active.float.originalSourceBitmap) {
          env.store.updateLayer(active.docId, active.sourceLayerId, {
            bitmap: active.float.originalSourceBitmap,
          });
        }
        env.store.removeLayer(active.docId, active.float.layerId);
        clearFloatingSelection(active.docId);
      } else if (active.float) {
        // A float carried over from a prior drag — just restore its starting position.
        env.store.updateLayer(active.docId, active.float.layerId, {
          x: active.float.startX,
          y: active.float.startY,
        });
      }
      cancelSelectionTransformSession(active.docId, env.requestRender);
      active = null;
      return;
    }
    applyTransformPreviewSession(env.doc.id, env.requestRender);
    active = null;
  },
};

function beginMoveToolSelectionDrag(env: ToolEnv, point: Point): MoveSelectionState | null {
  const selection = getSelection(env.doc.id);
  if (!selection || !pointHitsSelectionMask(selection, point)) return null;
  const session = getSelectionTransformSession(env.doc.id) ?? beginSelectionTransformSession(env.doc.id);
  if (!session) return null;

  // If a prior drag already floated this selection onto its own layer, keep moving THAT layer rather
  // than cutting a fresh hole in the source — this is what stops a second move from deleting whatever
  // sat beneath the first drop.
  let float: MoveSelectionState['float'] = null;
  const existing = getFloatingSelection(env.doc.id);
  if (existing) {
    const floatLayer = env.doc.layers.find((candidate) => candidate.id === existing.layerId);
    if (floatLayer && floatLayer.type === 'image' && canMoveImageLayer(floatLayer)) {
      float = {
        layerId: floatLayer.id,
        startX: floatLayer.x,
        startY: floatLayer.y,
        createdThisGesture: false,
        originalSourceBitmap: null,
      };
    } else {
      clearFloatingSelection(env.doc.id); // stale association (layer deleted/undone)
    }
  }

  // First move of this selection: remember which active image layer to lift from. The lift itself is
  // deferred to the first real movement (onPointerMove) so a click that never drags doesn't float.
  const source = env.activeLayer;
  const sourceLayerId = float
    ? null
    : source && source.type === 'image' && source.bitmap && canMoveImageLayer(source)
      ? source.id
      : null;

  return {
    kind: 'selection',
    docId: env.doc.id,
    startPoint: point,
    origin: session.currentBounds,
    beforeLayers: env.doc.layers,
    sourceLayerId,
    selection,
    float,
    moved: false,
  };
}

/**
 * Lift the selected pixels of the source layer onto a NEW image layer inserted just above it (and
 * made active), leaving the source with a clean transparent hole. Returns the float descriptor, or
 * null when there is nothing liftable (e.g. no canvas in a non-DOM environment), in which case the
 * caller degrades to translating only the marching-ants outline.
 */
function liftSelectionToNewLayer(
  env: ToolEnv,
  state: MoveSelectionState,
): MoveSelectionState['float'] | null {
  if (!state.sourceLayerId) return null;
  const doc = env.store.documents.find((candidate) => candidate.id === state.docId) ?? env.doc;
  const source = doc.layers.find((candidate) => candidate.id === state.sourceLayerId);
  if (!source || source.type !== 'image' || !source.bitmap) return null;

  const lifted = liftSelectionPixels(source, state.selection);
  if (!lifted) return null; // canvas unavailable — caller degrades to a mask-only move
  const bbox = maskBoundingBox(state.selection);
  if (!bbox) return null;

  // Crop the lifted (document-space) pixels down to the selection bounds for a tidy layer.
  let cropped: LayerBitmap;
  try {
    cropped = createBitmap(bbox.width, bbox.height);
    const cctx = cropped.getContext('2d');
    if (!cctx) return null;
    cctx.drawImage(lifted.floating, -bbox.x, -bbox.y);
  } catch {
    return null;
  }

  const originalSourceBitmap = source.bitmap;
  // Cut the selected region out of the source layer.
  env.store.updateLayer(state.docId, source.id, { bitmap: lifted.clearedLocal });

  // Create the floating layer just above the source, inheriting its compositing so it looks the same.
  const floatLayer: ImageLayer = {
    id: `layer-float-${Date.now()}`,
    name: `${source.name} (floating)`,
    type: 'image',
    visible: true,
    locked: false,
    opacity: source.opacity,
    blendMode: source.blendMode,
    x: bbox.x,
    y: bbox.y,
    bitmap: cropped,
    bitmapVersion: 0,
    mask: null,
  };
  const sourceIndex = doc.layers.findIndex((candidate) => candidate.id === source.id);
  env.store.addLayer(state.docId, floatLayer, sourceIndex + 1);

  return {
    layerId: floatLayer.id,
    startX: floatLayer.x,
    startY: floatLayer.y,
    createdThisGesture: true,
    originalSourceBitmap,
  };
}

function pointHitsSelectionMask(mask: SelectionMask, point: Point): boolean {
  const bounds = maskBoundingBox(mask);
  if (!bounds) return false;
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  if (
    x < bounds.x
    || y < bounds.y
    || x >= bounds.x + bounds.width
    || y >= bounds.y + bounds.height
    || x < 0
    || y < 0
    || x >= mask.width
    || y >= mask.height
  ) {
    return false;
  }
  return mask.data[y * mask.width + x] > 0;
}

function describeMoveToolMode(
  layer: ImageLayer | null,
  linkedLayers: readonly ImageLayer[],
): MoveToolWorkflowMode {
  if (!layer) return 'none';
  return layer.linkGroupId && linkedLayers.length > 1 ? 'linked-layer-group' : 'single-layer';
}

function isMoveToolLayerMovable(layer: ImageLayer | null | undefined): boolean {
  return canMoveImageLayer(layer);
}

function describeMoveToolStationaryReason(layer: ImageLayer): MoveToolStationaryReason {
  if (layer.type === 'group') return 'group-layer';
  if (layer.locked) return 'full-lock';
  return 'position-lock';
}

function describeMoveToolAlignCommands(
  doc: ImageDocument,
  layer: ImageLayer | null,
): MoveToolAlignCommandDescriptor[] {
  const width = layer?.bitmap?.width ?? 0;
  const height = layer?.bitmap?.height ?? 0;
  return [
    { id: 'alignLayerLeft', axis: 'x', edge: 'min', x: 0 },
    { id: 'alignLayerRight', axis: 'x', edge: 'max', x: doc.width - width },
    { id: 'alignLayerTop', axis: 'y', edge: 'min', y: 0 },
    { id: 'alignLayerBottom', axis: 'y', edge: 'max', y: doc.height - height },
    { id: 'centerLayerHorizontal', axis: 'x', edge: 'center', x: (doc.width - width) / 2 },
    { id: 'centerLayerVertical', axis: 'y', edge: 'center', y: (doc.height - height) / 2 },
  ];
}

function describeMoveToolDocumentBounds(doc: ImageDocument): MoveToolGeometryBounds {
  return {
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
    centerX: doc.width / 2,
    centerY: doc.height / 2,
  };
}

function describeMoveToolSourceSafety(layers: readonly ImageLayer[]): MoveToolSourceSafetyDescriptor {
  const sourceLinkedLayerIds = layers
    .filter(isMoveToolSourceLinkedLayer)
    .map((layer) => layer.id)
    .sort();
  const missingSourceLayerIds = layers
    .filter((layer) => layer.metadata?.sourceLink?.status === 'missing')
    .map((layer) => layer.id)
    .sort();
  const relinkedSourceLayerIds = layers
    .filter((layer) => layer.metadata?.sourceLink?.status === 'relinked')
    .map((layer) => layer.id)
    .sort();
  const sourceIds = layers
    .map(getMoveToolLayerSourceId)
    .filter((sourceId): sourceId is string => Boolean(sourceId))
    .sort();
  const warnings: MoveToolSourceSafetyWarningDescriptor[] = [];

  if (sourceLinkedLayerIds.length > 0) {
    warnings.push({
      code: 'move-source-metadata-only',
      severity: 'info',
      layerIds: [...sourceLinkedLayerIds],
      message: 'Move updates linked layer position metadata only; source assets are not rewritten.',
    });
  }
  if (missingSourceLayerIds.length > 0) {
    warnings.push({
      code: 'move-source-link-missing',
      severity: 'warning',
      layerIds: [...missingSourceLayerIds],
      message: 'Some source-linked layers are missing their Source Library asset; movement is metadata-only but relink/replace remains blocked.',
    });
  }

  return {
    metadataOnly: true,
    mutatesPixels: false,
    mutatesSourceAssets: false,
    sourceLinkedLayerIds,
    missingSourceLayerIds,
    relinkedSourceLayerIds,
    sourceIds,
    warnings,
    signature: `move-tool-source-safety:v1:${JSON.stringify({
      layers: sourceLinkedLayerIds,
      missing: missingSourceLayerIds,
      relinked: relinkedSourceLayerIds,
      sourceIds,
    })}`,
  };
}

function isMoveToolSourceLinkedLayer(layer: ImageLayer): boolean {
  return Boolean(layer.metadata?.sourceLink || layer.metadata?.smartLinkedSourceId);
}

function getMoveToolLayerSourceId(layer: ImageLayer): string | null {
  return layer.metadata?.sourceLink?.id ?? layer.metadata?.smartLinkedSourceId ?? null;
}

function describeMoveToolLayerGeometry(layer: ImageLayer): MoveToolLayerGeometryDescriptor {
  const width = layer.bitmap?.width ?? 0;
  const height = layer.bitmap?.height ?? 0;
  const bounds = {
    x: layer.x,
    y: layer.y,
    width,
    height,
    centerX: layer.x + width / 2,
    centerY: layer.y + height / 2,
  };
  return {
    layerId: layer.id,
    name: layer.name,
    type: layer.type,
    bounds,
    snapPoints: {
      x: [bounds.x, bounds.centerX, bounds.x + bounds.width],
      y: [bounds.y, bounds.centerY, bounds.y + bounds.height],
    },
  };
}

function describeMoveToolParityStationaryReason(
  layer: ImageLayer,
  activeLayer: ImageLayer | null,
  linkedLayers: readonly ImageLayer[],
): MoveToolParityStationaryReason {
  if (!activeLayer) return 'not-selected';
  if (!linkedLayers.some((candidate) => candidate.id === layer.id)) return 'not-selected';
  return describeMoveToolStationaryReason(layer);
}

function describeMoveToolSnapGuides(
  doc: ImageDocument,
  stationaryGeometry: readonly MoveToolStationaryGeometryDescriptor[],
): MoveToolParityPlanDescriptor['snapGuides'] {
  const vertical: MoveToolSnapGuideDescriptor[] = [
    { id: 'document-left', source: 'document', axis: 'x', value: 0 },
    { id: 'document-center-x', source: 'document', axis: 'x', value: doc.width / 2 },
    { id: 'document-right', source: 'document', axis: 'x', value: doc.width },
  ];
  const horizontal: MoveToolSnapGuideDescriptor[] = [
    { id: 'document-top', source: 'document', axis: 'y', value: 0 },
    { id: 'document-center-y', source: 'document', axis: 'y', value: doc.height / 2 },
    { id: 'document-bottom', source: 'document', axis: 'y', value: doc.height },
  ];

  for (const layer of stationaryGeometry) {
    vertical.push(
      { id: `layer-${layer.layerId}-left`, source: 'layer', layerId: layer.layerId, axis: 'x', value: layer.bounds.x },
      { id: `layer-${layer.layerId}-center-x`, source: 'layer', layerId: layer.layerId, axis: 'x', value: layer.bounds.centerX },
      { id: `layer-${layer.layerId}-right`, source: 'layer', layerId: layer.layerId, axis: 'x', value: layer.bounds.x + layer.bounds.width },
    );
    horizontal.push(
      { id: `layer-${layer.layerId}-top`, source: 'layer', layerId: layer.layerId, axis: 'y', value: layer.bounds.y },
      { id: `layer-${layer.layerId}-center-y`, source: 'layer', layerId: layer.layerId, axis: 'y', value: layer.bounds.centerY },
      { id: `layer-${layer.layerId}-bottom`, source: 'layer', layerId: layer.layerId, axis: 'y', value: layer.bounds.y + layer.bounds.height },
    );
  }

  return { vertical, horizontal };
}

function describeMoveToolCandidateSnapTargets(
  movableGeometry: readonly MoveToolLayerGeometryDescriptor[],
  snapGuides: MoveToolParityPlanDescriptor['snapGuides'],
  snapDistancePx: number,
): MoveToolCandidateSnapTargetDescriptor[] {
  if (movableGeometry.length === 0) return [];
  const documentVertical = snapGuides.vertical
    .filter((guide) => guide.source === 'document')
    .map((guide) => describeNearestMoveToolCandidate(guide, movableGeometry, snapDistancePx));
  const layerTopGuides = snapGuides.horizontal
    .filter((guide) => guide.source === 'layer' && guide.id.endsWith('-top'))
    .map((guide) => describeNearestMoveToolCandidate(guide, movableGeometry, snapDistancePx))
    .sort((a, b) => Number(a.withinSnapDistance) - Number(b.withinSnapDistance) || a.guideId.localeCompare(b.guideId))
    .slice(0, 2);
  return [...documentVertical, ...layerTopGuides];
}

function describeNearestMoveToolCandidate(
  guide: MoveToolSnapGuideDescriptor,
  movableGeometry: readonly MoveToolLayerGeometryDescriptor[],
  snapDistancePx: number,
): MoveToolCandidateSnapTargetDescriptor {
  const axis = guide.axis;
  const nearest = movableGeometry
    .flatMap((layer) => layer.snapPoints[axis].map((point) => ({ layer, point })))
    .sort((a, b) => Math.abs(guide.value - a.point) - Math.abs(guide.value - b.point))[0]!;
  const requiredDelta = guide.value - nearest.point;
  return {
    guideId: guide.id,
    axis,
    source: guide.source,
    ...(guide.layerId ? { layerId: guide.layerId } : {}),
    value: guide.value,
    nearestMovableLayerId: nearest.layer.layerId,
    movablePoint: nearest.point,
    requiredDelta,
    withinSnapDistance: Math.abs(requiredDelta) <= snapDistancePx,
  };
}

function describeMoveToolSnapCandidateSummary(
  snapGuides: MoveToolParityPlanDescriptor['snapGuides'],
  candidates: readonly MoveToolCandidateSnapTargetDescriptor[],
): MoveToolSnapCandidateSummaryDescriptor {
  const guideCounts = {
    vertical: snapGuides.vertical.length,
    horizontal: snapGuides.horizontal.length,
    document: [...snapGuides.vertical, ...snapGuides.horizontal].filter((guide) => guide.source === 'document').length,
    layer: [...snapGuides.vertical, ...snapGuides.horizontal].filter((guide) => guide.source === 'layer').length,
  };
  const closestByAxis: MoveToolSnapCandidateSummaryEntry[] = (['x', 'y'] as const)
    .flatMap((axis) => {
      const closest = candidates
        .filter((candidate) => candidate.axis === axis)
        .sort((a, b) => (
          Math.abs(a.requiredDelta) - Math.abs(b.requiredDelta)
          || Number(b.withinSnapDistance) - Number(a.withinSnapDistance)
          || a.guideId.localeCompare(b.guideId)
        ))[0];
      return closest
        ? [{
          axis: closest.axis,
          guideId: closest.guideId,
          source: closest.source,
          ...(closest.layerId ? { layerId: closest.layerId } : {}),
          value: closest.value,
          nearestMovableLayerId: closest.nearestMovableLayerId,
          requiredDelta: closest.requiredDelta,
          withinSnapDistance: closest.withinSnapDistance,
        }]
        : [];
    });

  return {
    guideCounts,
    candidateCount: candidates.length,
    withinSnapDistanceCount: candidates.filter((candidate) => candidate.withinSnapDistance).length,
    closestByAxis,
    signature: `move-tool-snap-candidates:v1:${JSON.stringify({
      guides: guideCounts,
      candidateCount: candidates.length,
      within: candidates.filter((candidate) => candidate.withinSnapDistance).length,
      closest: closestByAxis.map((candidate) => `${candidate.axis}:${candidate.guideId}:${candidate.nearestMovableLayerId}:${candidate.requiredDelta}`),
    })}`,
  };
}

function describeMoveToolCommandReadinessBlockers(
  activeLayer: ImageLayer | null,
  movableLayers: readonly ImageLayer[],
  linkedLayers: readonly ImageLayer[],
): MoveToolCommandReadinessBlocker[] {
  if (!activeLayer) return ['missing-active-layer'];
  const blockers: MoveToolCommandReadinessBlocker[] = [];
  if (!isMoveToolLayerMovable(activeLayer)) {
    blockers.push(describeMoveToolActiveLayerBlocker(activeLayer));
  }
  if (movableLayers.length === 0) {
    blockers.push('no-movable-layers');
  }
  if (
    activeLayer.linkGroupId
    && linkedLayers.some((layer) => layer.id !== activeLayer.id && !isMoveToolLayerMovable(layer))
  ) {
    blockers.push('stationary-linked-members');
  }
  return dedupeMoveToolBlockers(blockers);
}

function describeMoveToolAlignReadiness(
  blockers: readonly MoveToolCommandReadinessBlocker[],
): MoveToolCommandReadinessDescriptor[] {
  const ready = blockers.length === 0;
  return MOVE_TOOL_ALIGN_COMMAND_IDS.map((id) => ({
    id,
    ready,
    target: 'canvas' as const,
    ...(ready ? {} : { blockers: [...blockers] }),
  }));
}

function describeMoveToolDistributeReadiness(
  readinessBlockers: readonly MoveToolCommandReadinessBlocker[],
  movableLayerCount: number,
): MoveToolDistributeReadinessDescriptor[] {
  const blockers: MoveToolDistributeReadinessBlocker[] = [...readinessBlockers];
  if (movableLayerCount > 0 && movableLayerCount < 3) {
    blockers.push('not-enough-movable-layers');
  }
  blockers.push('multi-layer-selection-unsupported');
  const dedupedBlockers = dedupeMoveToolBlockers(blockers);
  return MOVE_TOOL_DISTRIBUTE_COMMAND_IDS.map((id) => ({
    id,
    ready: false,
    blockers: [...dedupedBlockers],
  }));
}

function describeMoveToolActiveLayerBlocker(layer: ImageLayer): MoveToolCommandReadinessBlocker {
  if (layer.type === 'group') return 'active-layer-group';
  if (layer.locked) return 'active-layer-full-lock';
  return 'active-layer-position-lock';
}

function dedupeMoveToolBlockers<T extends string>(blockers: readonly T[]): T[] {
  return [...new Set(blockers)];
}

function describeMoveToolParityPlanBlockers(
  requestedLayerId: string | null,
  activeLayer: ImageLayer | null,
  stationaryGeometry: readonly MoveToolStationaryGeometryDescriptor[],
): MoveToolParityPlanBlockerDescriptor[] {
  const blockers: MoveToolParityPlanBlockerDescriptor[] = [];
  if (requestedLayerId && !activeLayer) {
    blockers.push({ code: 'missing-layer', layerId: requestedLayerId, reason: 'missing-active-layer' });
  }
  for (const layer of stationaryGeometry) {
    if (layer.reason !== 'not-selected') {
      blockers.push({ code: 'stationary-layer', layerId: layer.layerId, reason: layer.reason });
    }
  }
  return blockers;
}

function findMoveToolDeltaSnap(
  movableGeometry: readonly MoveToolLayerGeometryDescriptor[],
  guides: readonly MoveToolSnapGuideDescriptor[],
  axis: 'x' | 'y',
  delta: number,
  snapDistancePx: number,
): { axis: 'x' | 'y'; delta: number; guide: MoveToolSnapGuideDescriptor; layer: MoveToolLayerGeometryDescriptor; point: number } | null {
  const candidates = movableGeometry.flatMap((layer) => layer.snapPoints[axis].flatMap((point) => guides.map((guide) => {
    const snappedDelta = guide.value - point;
    return {
      axis,
      delta: snappedDelta,
      distance: Math.abs(snappedDelta - delta),
      guide,
      layer,
      point,
    };
  })));
  const snap = candidates
    .filter((candidate) => candidate.distance <= snapDistancePx)
    .sort((a, b) => a.distance - b.distance || a.guide.id.localeCompare(b.guide.id) || a.layer.layerId.localeCompare(b.layer.layerId))[0];
  return snap
    ? { axis: snap.axis, delta: snap.delta, guide: snap.guide, layer: snap.layer, point: snap.point }
    : null;
}

const MOVE_TOOL_ALIGN_COMMAND_IDS: MoveToolAlignCommandId[] = [
  'alignLayerLeft',
  'alignLayerRight',
  'alignLayerTop',
  'alignLayerBottom',
  'centerLayerHorizontal',
  'centerLayerVertical',
];

function buildMoveToolParityPlanPreviewSignature(
  doc: ImageDocument,
  plan: Omit<MoveToolParityPlanDescriptor, 'preview'>,
): string {
  return `move-tool-parity-plan:v1:${JSON.stringify({
    docId: doc.id,
    activeLayerId: plan.activeLayerId,
    movable: plan.movableGeometry.map((layer) => formatMoveToolGeometrySignature(layer)),
    stationary: plan.stationaryGeometry.map((layer) => `${layer.layerId}:${layer.reason}:${formatMoveToolBoundsSignature(layer.bounds)}`),
    snapDistancePx: plan.snapDistancePx,
    snapSummary: plan.snapCandidateSummary.signature,
    sourceSafety: plan.sourceSafety.signature,
    runtimeSnapping: plan.runtimeSnapping.supported,
    runtimeDistribution: plan.runtimeDistribution.supported,
    warnings: plan.warnings.map((warning) => warning.code),
    alignReady: plan.alignReadiness.filter((command) => command.ready).map((command) => command.id),
    distributeReady: plan.distributeReadiness.filter((command) => command.ready).map((command) => command.id),
    blockers: plan.blockers.map((blocker) => `${blocker.layerId}:${blocker.reason}`),
  })}`;
}

function formatMoveToolGeometrySignature(layer: MoveToolLayerGeometryDescriptor): string {
  return `${layer.layerId}:${formatMoveToolBoundsSignature(layer.bounds)}`;
}

function formatMoveToolBoundsSignature(bounds: MoveToolGeometryBounds): string {
  return [bounds.x, bounds.y, bounds.width, bounds.height].join(',');
}

function buildMoveToolWorkflowPreviewSignature(
  doc: ImageDocument,
  activeLayerId: string | null,
  movement: MoveToolMovementDescriptor,
  alignCommands: readonly MoveToolAlignCommandDescriptor[],
): string {
  return `move-tool-workflow:v1:${JSON.stringify({
    docId: doc.id,
    activeLayerId,
    movableLayerIds: movement.movableLayerIds,
    stationaryLayerIds: movement.stationaryLayers.map((layer) => layer.layerId),
    dragSupported: movement.supported,
    nudgeSteps: [1, 10],
    alignCommands: alignCommands.map((command) => command.id),
    snapSupported: true,
    distributeSupported: false,
  })}`;
}
