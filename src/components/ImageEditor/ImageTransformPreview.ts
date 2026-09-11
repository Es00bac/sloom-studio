import { useImageEditorStore } from '../../store/imageEditorStore';
import type {
  EditorOperation,
  ImageDocument,
  ImageLayer,
  ImageLayerTransformCorner,
  ImageLayerWarpOffsets,
  ImageLayerTransformState,
} from '../../types/imageEditor';
import {
  describeImageLayerTransformCapabilities,
  resolveImageLayerTransformOrigin,
  type ImageLayerTransformCapabilityDescriptor,
  type ImageLayerTransformCapabilityKind,
  type ImageLayerTransformDescriptorOptions,
  type ImageLayerTransformWarning,
} from './ImageLayerTransform';
import {
  createEmptyImageLayerTransformCornerOffsets,
  createEmptyImageLayerWarpOffsets,
  normalizeImageLayerTransformCornerOffsets,
  normalizeImageLayerWarpOffsets,
  type ImageLayerTransformMode,
} from './ImageLayerTransformControls';
import { normalizeWarpMesh } from './ImageWarpMesh';
import { resolveMultiLayerTransformParticipants } from './ImageGroupTransform';

export interface ImageTransformPreviewSession {
  docId: string;
  layerId: string;
  activeLayerId: string | null;
  beforeLayers: ImageLayer[];
  beforeTransform: ImageLayerTransformState;
  /** Per-layer before states; present when several layers transform as one selection. */
  beforeTransforms?: Record<string, ImageLayerTransformState>;
  /** The full participant set (unlocked siblings) when this is a multi-layer session. */
  participantLayerIds?: string[];
  structureChange: boolean;
  currentMode: ImageLayerTransformMode;
}

export type ImageTransformPreviewOperationKind = 'none' | 'transform' | 'multiTransform' | 'layerOp';

export interface ImageTransformPreviewSessionDescriptor {
  docId: string;
  layerId: string;
  activeLayerId: string | null;
  currentMode: ImageLayerTransformMode;
  activeCapability: ImageLayerTransformCapabilityKind;
  pendingChanges: boolean;
  structureChange: boolean;
  operationKind: ImageTransformPreviewOperationKind;
  beforeTransform: ImageLayerTransformState;
  currentTransform: ImageLayerTransformState;
  capabilities: ImageLayerTransformCapabilityDescriptor[];
  warnings: ImageLayerTransformWarning[];
  previewSignature: string;
  /** Present when this session transforms several selected layers about a shared pivot. */
  multiLayer?: {
    participantLayerIds: string[];
  };
}

const listeners = new Set<() => void>();
let session: ImageTransformPreviewSession | null = null;

type TransformPreviewSessionIdentity =
  | { kind: 'single'; layerId: string }
  | { kind: 'multi'; participantLayerIds: string[] };

/** True when this session transforms several selected layers about a shared pivot. */
export function isMultiLayerTransformSession(candidate: ImageTransformPreviewSession | null): boolean {
  return Boolean(candidate && candidate.participantLayerIds && candidate.participantLayerIds.length > 1);
}

export function subscribeTransformPreviewSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTransformPreviewSession(docId?: string): ImageTransformPreviewSession | null {
  if (!session) return null;
  if (docId && session.docId !== docId) return null;
  return session;
}

export function clearTransformPreviewSession(): void {
  if (!session) return;
  session = null;
  notify();
}

export function beginTransformPreviewSession(doc: ImageDocument, layer: ImageLayer): ImageTransformPreviewSession {
  const plan = resolveMultiLayerTransformParticipants(doc);
  const request: TransformPreviewSessionIdentity = plan.eligible && plan.participantLayerIds.includes(layer.id)
    ? { kind: 'multi', participantLayerIds: plan.participantLayerIds }
    : { kind: 'single', layerId: layer.id };
  const continuingSession = continueOrCommitMultiLayerSessionBoundary(doc, request);
  if (continuingSession) {
    return continuingSession;
  }

  session = {
    docId: doc.id,
    layerId: layer.id,
    activeLayerId: doc.activeLayerId,
    beforeLayers: doc.layers,
    beforeTransform: getLayerTransformState(layer),
    structureChange: false,
    currentMode: 'resize',
  };
  notify();
  return session;
}

/**
 * Starts a shared-pivot transform session over several selected unlocked sibling layers.
 * The anchor layer (`layerId`) is the active layer when it participates, otherwise the
 * first participant. Every participant's before-transform state is captured so one commit
 * produces exactly one history operation and one cancel restores the whole selection.
 */
export function beginMultiLayerTransformPreviewSession(
  doc: ImageDocument,
  participantLayerIds: readonly string[],
): ImageTransformPreviewSession | null {
  const participants = participantLayerIds
    .map((id) => doc.layers.find((candidate) => candidate.id === id))
    .filter((layer): layer is ImageLayer => Boolean(layer));
  if (participants.length < 2) return null;

  const continuingSession = continueOrCommitMultiLayerSessionBoundary(doc, {
    kind: 'multi',
    participantLayerIds: participants.map((layer) => layer.id),
  });
  if (continuingSession) {
    return continuingSession;
  }

  const anchor = doc.activeLayerId && participants.some((layer) => layer.id === doc.activeLayerId)
    ? participants.find((layer) => layer.id === doc.activeLayerId)!
    : participants[0];
  const beforeTransforms: Record<string, ImageLayerTransformState> = {};
  for (const layer of participants) {
    beforeTransforms[layer.id] = getLayerTransformState(layer);
  }

  session = {
    docId: doc.id,
    layerId: anchor.id,
    activeLayerId: doc.activeLayerId,
    beforeLayers: doc.layers,
    beforeTransform: beforeTransforms[anchor.id],
    beforeTransforms,
    participantLayerIds: participants.map((layer) => layer.id),
    structureChange: false,
    currentMode: 'resize',
  };
  notify();
  return session;
}

/**
 * One symmetric boundary rule for MH-040 session crossings. A same-document request may
 * continue only when it names the same single layer or the same multi participant set.
 * Whenever either side is multi-layer and those identities differ, the open gesture is
 * committed before its successor captures a baseline. Pre-existing single-to-single and
 * cross-document behavior deliberately remains outside this feature repair.
 */
function continueOrCommitMultiLayerSessionBoundary(
  doc: ImageDocument,
  request: TransformPreviewSessionIdentity,
): ImageTransformPreviewSession | null {
  const openSession = session;
  if (!openSession || openSession.docId !== doc.id) return null;

  const openIdentity: TransformPreviewSessionIdentity = isMultiLayerTransformSession(openSession)
    ? { kind: 'multi', participantLayerIds: [...openSession.participantLayerIds!] }
    : { kind: 'single', layerId: openSession.layerId };
  if (transformPreviewSessionIdentitiesMatch(openIdentity, request)) {
    return openSession;
  }
  if (openIdentity.kind === 'multi' || request.kind === 'multi') {
    applyTransformPreviewSession(doc.id);
  }
  return null;
}

function transformPreviewSessionIdentitiesMatch(
  a: TransformPreviewSessionIdentity,
  b: TransformPreviewSessionIdentity,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'single' && b.kind === 'single') return a.layerId === b.layerId;
  if (a.kind !== 'multi' || b.kind !== 'multi') return false;
  return a.participantLayerIds.length === b.participantLayerIds.length
    && a.participantLayerIds.every((id) => b.participantLayerIds.includes(id));
}

/** Marks a multi-layer session as destructive (bitmap resampling), so commit becomes a layerOp. */
export function markMultiLayerTransformSessionStructureChange(
  doc: ImageDocument,
  participantLayerIds: readonly string[],
): ImageTransformPreviewSession | null {
  const current = beginMultiLayerTransformPreviewSession(doc, participantLayerIds);
  if (!current || current.structureChange) return current;
  session = { ...current, structureChange: true };
  notify();
  return session;
}

export function markTransformPreviewSessionStructureChange(
  doc: ImageDocument,
  layer: ImageLayer,
): ImageTransformPreviewSession {
  const current = beginTransformPreviewSession(doc, layer);
  if (current.structureChange) return current;
  session = { ...current, structureChange: true };
  notify();
  return session;
}

export function setTransformPreviewMode(
  docId: string,
  mode: ImageLayerTransformMode,
): boolean {
  const current = getTransformPreviewSession(docId);
  if (!current || current.currentMode === mode) return Boolean(current);
  session = {
    ...current,
    currentMode: mode,
  };
  notify();
  return true;
}

export function describeTransformPreviewSession(
  doc: ImageDocument,
  options: ImageLayerTransformDescriptorOptions = {},
): ImageTransformPreviewSessionDescriptor | null {
  const current = getTransformPreviewSession(doc.id);
  if (!current) return null;
  const layer = doc.layers.find((candidate) => candidate.id === current.layerId);
  if (!layer) return null;

  const currentTransform = getLayerTransformState(layer);
  const pendingChanges = transformPreviewSessionHasPendingChanges(doc);
  const operationKind = getTransformPreviewOperationKind(current, pendingChanges);
  const activeCapability = getTransformPreviewActiveCapability(current, currentTransform);
  const capabilityDescriptor = describeImageLayerTransformCapabilities(layer, options);
  const warnings = capabilityDescriptor.warnings;

  return {
    docId: current.docId,
    layerId: current.layerId,
    activeLayerId: current.activeLayerId,
    currentMode: current.currentMode,
    activeCapability,
    pendingChanges,
    structureChange: current.structureChange,
    operationKind,
    beforeTransform: current.beforeTransform,
    currentTransform,
    capabilities: capabilityDescriptor.capabilities,
    warnings,
    ...(isMultiLayerTransformSession(current)
      ? { multiLayer: { participantLayerIds: [...current.participantLayerIds!] } }
      : {}),
    previewSignature: buildTransformPreviewSessionSignature({
      current,
      activeCapability,
      pendingChanges,
      operationKind,
      currentTransform,
      warnings,
    }),
  };
}

export function transformPreviewSessionHasPendingChanges(doc: ImageDocument): boolean {
  const current = getTransformPreviewSession(doc.id);
  if (!current) return false;
  if (current.structureChange) {
    return doc.layers !== current.beforeLayers;
  }
  if (isMultiLayerTransformSession(current) && current.beforeTransforms) {
    return current.participantLayerIds!.some((id) => {
      const before = current.beforeTransforms![id];
      const layer = doc.layers.find((candidate) => candidate.id === id);
      if (!before || !layer) return false;
      return !transformStatesMatch(before, getLayerTransformState(layer));
    });
  }
  const layer = doc.layers.find((candidate) => candidate.id === current.layerId);
  if (!layer) return false;
  return !transformStatesMatch(current.beforeTransform, getLayerTransformState(layer));
}

export function applyTransformPreviewSession(
  docId: string,
  requestRender?: () => void,
): EditorOperation | null {
  const current = getTransformPreviewSession(docId);
  if (!current) return null;
  const store = useImageEditorStore.getState();
  const doc = store.documents.find((candidate) => candidate.id === docId);
  let operation: EditorOperation | null = null;

  if (doc) {
    if (current.structureChange) {
      if (doc.layers !== current.beforeLayers) {
        operation = {
          kind: 'layerOp',
          docId,
          before: current.beforeLayers,
          after: doc.layers,
        };
      }
    } else if (isMultiLayerTransformSession(current) && current.beforeTransforms) {
      // One gesture over the selection commits as ONE multi-layer transform operation.
      const before: Record<string, ImageLayerTransformState> = {};
      const after: Record<string, ImageLayerTransformState> = {};
      for (const id of current.participantLayerIds!) {
        const beforeState = current.beforeTransforms[id];
        const layer = doc.layers.find((candidate) => candidate.id === id);
        if (!beforeState || !layer) continue;
        const afterState = getLayerTransformState(layer);
        if (!transformStatesMatch(beforeState, afterState)) {
          before[id] = beforeState;
          after[id] = afterState;
        }
      }
      if (Object.keys(after).length > 0) {
        operation = { kind: 'multiTransform', docId, before, after };
      }
    } else {
      const layer = doc.layers.find((candidate) => candidate.id === current.layerId);
      if (layer) {
        const after = getLayerTransformState(layer);
        if (!transformStatesMatch(current.beforeTransform, after)) {
          operation = {
            kind: 'transform',
            docId,
            layerId: layer.id,
            before: current.beforeTransform,
            after,
          };
        }
      }
    }
  }

  clearTransformPreviewSession();
  if (operation) {
    store.pushOperation(operation);
  }
  requestRender?.();
  return operation;
}

export function cancelTransformPreviewSession(docId: string, requestRender?: () => void): boolean {
  const current = getTransformPreviewSession(docId);
  if (!current) return false;
  const store = useImageEditorStore.getState();
  store.setLayers(current.docId, current.beforeLayers, current.activeLayerId);
  clearTransformPreviewSession();
  requestRender?.();
  return true;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function getLayerTransformState(layer: ImageLayer): ImageLayerTransformState {
  const origin = resolveImageLayerTransformOrigin(layer);
  return {
    x: layer.x,
    y: layer.y,
    rotationDeg: layer.rotationDeg ?? 0,
    skewXDeg: layer.skewXDeg ?? 0,
    skewYDeg: layer.skewYDeg ?? 0,
    perspectiveX: layer.perspectiveX ?? 0,
    perspectiveY: layer.perspectiveY ?? 0,
    warp: normalizeImageLayerWarpOffsets(layer.warp),
    warpMesh: normalizeWarpMesh(layer.warpMesh),
    cornerOffsets: normalizeImageLayerTransformCornerOffsets(layer.cornerOffsets),
    transformOriginX: origin.x,
    transformOriginY: origin.y,
  };
}

function transformStatesMatch(a: ImageLayerTransformState, b: ImageLayerTransformState): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    (a.rotationDeg ?? 0) === (b.rotationDeg ?? 0) &&
    (a.skewXDeg ?? 0) === (b.skewXDeg ?? 0) &&
    (a.skewYDeg ?? 0) === (b.skewYDeg ?? 0) &&
    (a.perspectiveX ?? 0) === (b.perspectiveX ?? 0) &&
    (a.perspectiveY ?? 0) === (b.perspectiveY ?? 0) &&
    warpOffsetsMatch(a.warp, b.warp) &&
    warpMeshesMatch(a.warpMesh, b.warpMesh) &&
    cornerOffsetsMatch(a.cornerOffsets, b.cornerOffsets) &&
    a.transformOriginX === b.transformOriginX &&
    a.transformOriginY === b.transformOriginY
  );
}

function warpMeshesMatch(
  a: ImageLayerTransformState['warpMesh'],
  b: ImageLayerTransformState['warpMesh'],
): boolean {
  const left = normalizeWarpMesh(a);
  const right = normalizeWarpMesh(b);
  if (!left || !right) return left === right;
  return left.columns === right.columns
    && left.rows === right.rows
    && left.points.length === right.points.length
    && left.points.every((point, index) => (
      point.x === right.points[index]?.x && point.y === right.points[index]?.y
    ));
}

function cornerOffsetsMatch(
  a: ImageLayerTransformState['cornerOffsets'],
  b: ImageLayerTransformState['cornerOffsets'],
): boolean {
  const left = a ?? createEmptyImageLayerTransformCornerOffsets();
  const right = b ?? createEmptyImageLayerTransformCornerOffsets();
  const corners: ImageLayerTransformCorner[] = ['nw', 'ne', 'se', 'sw'];
  return corners.every((corner) => left[corner].x === right[corner].x && left[corner].y === right[corner].y);
}

function warpOffsetsMatch(
  a: ImageLayerWarpOffsets | undefined,
  b: ImageLayerWarpOffsets | undefined,
): boolean {
  const left = a ?? createEmptyImageLayerWarpOffsets();
  const right = b ?? createEmptyImageLayerWarpOffsets();
  return left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom
    && left.left === right.left;
}

function getTransformPreviewOperationKind(
  current: ImageTransformPreviewSession,
  pendingChanges: boolean,
): ImageTransformPreviewOperationKind {
  if (!pendingChanges) return 'none';
  if (current.structureChange) return 'layerOp';
  return isMultiLayerTransformSession(current) ? 'multiTransform' : 'transform';
}

function getTransformPreviewActiveCapability(
  current: ImageTransformPreviewSession,
  currentTransform: ImageLayerTransformState,
): ImageLayerTransformCapabilityKind {
  if (current.structureChange) return 'scale';
  if (current.currentMode !== 'resize') return current.currentMode;
  if ((current.beforeTransform.rotationDeg ?? 0) !== (currentTransform.rotationDeg ?? 0)) return 'rotate';
  if (
    current.beforeTransform.transformOriginX !== currentTransform.transformOriginX
    || current.beforeTransform.transformOriginY !== currentTransform.transformOriginY
  ) {
    return 'rotate';
  }
  if (current.beforeTransform.x !== currentTransform.x || current.beforeTransform.y !== currentTransform.y) return 'move';
  if (
    (current.beforeTransform.skewXDeg ?? 0) !== (currentTransform.skewXDeg ?? 0)
    || (current.beforeTransform.skewYDeg ?? 0) !== (currentTransform.skewYDeg ?? 0)
  ) {
    return 'skew';
  }
  if (!cornerOffsetsMatch(current.beforeTransform.cornerOffsets, currentTransform.cornerOffsets)) return 'distort';
  if (
    (current.beforeTransform.perspectiveX ?? 0) !== (currentTransform.perspectiveX ?? 0)
    || (current.beforeTransform.perspectiveY ?? 0) !== (currentTransform.perspectiveY ?? 0)
  ) {
    return 'perspective';
  }
  if (!warpOffsetsMatch(current.beforeTransform.warp, currentTransform.warp)) return 'warp';
  return 'scale';
}

function buildTransformPreviewSessionSignature({
  current,
  activeCapability,
  pendingChanges,
  operationKind,
  currentTransform,
  warnings,
}: {
  current: ImageTransformPreviewSession;
  activeCapability: ImageLayerTransformCapabilityKind;
  pendingChanges: boolean;
  operationKind: ImageTransformPreviewOperationKind;
  currentTransform: ImageLayerTransformState;
  warnings: ImageLayerTransformWarning[];
}): string {
  return `transform-preview-session:v1:${JSON.stringify({
    docId: current.docId,
    layerId: current.layerId,
    currentMode: current.currentMode,
    activeCapability,
    structureChange: current.structureChange,
    pendingChanges,
    operationKind,
    before: current.beforeTransform,
    current: currentTransform,
    warnings: warnings.map((warning) => warning.code),
    ...(isMultiLayerTransformSession(current)
      ? { multiLayerParticipantIds: current.participantLayerIds }
      : {}),
  })}`;
}
