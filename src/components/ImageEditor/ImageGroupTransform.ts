/**
 * Pure helpers for multi-layer ("linked") transforms: resolving the active selection,
 * computing the combined bounding box, and applying a group translate / rotate / scale
 * around a shared pivot so several selected layers move as one. Canvas-free + tested; the
 * store and the transform overlay drive it.
 */
import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import { canMoveImageLayer } from '../../lib/imageLayerLocks';
import { resolveImageLayerTransformOrigin } from './ImageLayerTransform';
import { getImageLayerIntrinsicSize } from './ImageLayerTransformControls';

/** A layer's axis-aligned placement used for group geometry (top-left + size). */
export interface GroupLayerRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The current multi-selection for linked transforms: the document's `selectedLayerIds`
 * (deduped, filtered to existing layers) or just the active layer. Always returns the
 * active layer first when present so single-selection behaviour is unchanged.
 */
export function resolveSelectedLayerIds(doc: Pick<ImageDocument, 'layers' | 'activeLayerId' | 'selectedLayerIds'>): string[] {
  const existing = new Set(doc.layers.map((layer) => layer.id));
  const raw = doc.selectedLayerIds && doc.selectedLayerIds.length > 0
    ? doc.selectedLayerIds
    : (doc.activeLayerId ? [doc.activeLayerId] : []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (existing.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Toggles a layer in/out of the selection (Ctrl/Cmd-click). Removing the active layer
 * promotes another selected layer to active. Returns the next {selectedLayerIds,
 * activeLayerId}; a selection never becomes empty (a final toggle-off is a no-op).
 */
export function toggleLayerInSelection(
  current: readonly string[],
  activeLayerId: string | null,
  layerId: string,
): { selectedLayerIds: string[]; activeLayerId: string | null } {
  const base = current.length > 0 ? current : (activeLayerId ? [activeLayerId] : []);
  if (base.includes(layerId)) {
    const next = base.filter((id) => id !== layerId);
    if (next.length === 0) {
      return { selectedLayerIds: base.slice(), activeLayerId }; // don't allow empty
    }
    return {
      selectedLayerIds: next,
      activeLayerId: activeLayerId === layerId ? next[next.length - 1] : activeLayerId,
    };
  }
  return { selectedLayerIds: [...base, layerId], activeLayerId: layerId };
}

/** Inclusive contiguous range of layer ids between two ids (Shift-click). */
export function rangeLayerSelection(orderedIds: readonly string[], anchorId: string, targetId: string): string[] {
  const a = orderedIds.indexOf(anchorId);
  const b = orderedIds.indexOf(targetId);
  if (a < 0 || b < 0) return [targetId];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return orderedIds.slice(lo, hi + 1);
}

/** Union bounding box of the selected layer rects, or null if none. */
export function getGroupBounds(rects: readonly GroupLayerRect[], selectedIds: readonly string[]): GroupBounds | null {
  const selected = rects.filter((rect) => selectedIds.includes(rect.id));
  if (selected.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of selected) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Translates the selected layers by (dx, dy); other layers are returned unchanged. */
export function translateSelectedLayers(layers: ImageLayer[], selectedIds: readonly string[], dx: number, dy: number): ImageLayer[] {
  if ((dx === 0 && dy === 0) || selectedIds.length === 0) return layers;
  const set = new Set(selectedIds);
  return layers.map((layer) => (set.has(layer.id) ? { ...layer, x: layer.x + dx, y: layer.y + dy } : layer));
}

/**
 * Rotates the selected layers as a rigid group about `pivot` by `angleDeg`. Each layer's
 * own pivot point (its transform origin resolved into document space) orbits the shared
 * pivot — which is what makes the whole selection rotate rigidly even when a layer's own
 * origin is not its centre — and `angleDeg` is added to its own rotation. Non-selected
 * layers are returned unchanged.
 */
export function rotateSelectedLayersAroundPivot(
  layers: ImageLayer[],
  selectedIds: readonly string[],
  pivot: { x: number; y: number },
  angleDeg: number,
  sizeOf: (layer: ImageLayer) => { width: number; height: number },
): ImageLayer[] {
  if (angleDeg === 0 || selectedIds.length === 0) return layers;
  const set = new Set(selectedIds);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return layers.map((layer) => {
    if (!set.has(layer.id)) return layer;
    const size = sizeOf(layer);
    // Orbit the layer's own doc-space pivot about the shared pivot, then back out the top-left.
    const origin = resolveImageLayerTransformOrigin(layer);
    const pivotDocX = layer.x + origin.x * size.width;
    const pivotDocY = layer.y + origin.y * size.height;
    const ox = pivotDocX - pivot.x;
    const oy = pivotDocY - pivot.y;
    const rx = ox * cos - oy * sin;
    const ry = ox * sin + oy * cos;
    return {
      ...layer,
      x: pivot.x + rx - origin.x * size.width,
      y: pivot.y + ry - origin.y * size.height,
      rotationDeg: normalizeMultiLayerRotation((layer.rotationDeg ?? 0) + angleDeg),
    };
  });
}

export type MultiLayerTransformExcludedReason =
  | 'group-layer'
  | 'full-lock'
  | 'position-lock'
  | 'no-transformable-geometry';

export interface MultiLayerTransformExcludedLayer {
  layerId: string;
  reason: MultiLayerTransformExcludedReason;
}

export type MultiLayerTransformBlockerCode =
  | 'none'
  | 'too-few-participants'
  | 'multi-select-cross-group-boundaries-unsupported';

export interface MultiLayerTransformParticipantPlan {
  /** True when the current selection starts a shared-pivot multi-layer transform session. */
  eligible: boolean;
  /** Unlocked, non-group selected layers that will transform together, in selection order. */
  participantLayerIds: string[];
  /** Selected layers that will not transform, with the explicit reason. */
  excludedLayers: MultiLayerTransformExcludedLayer[];
  /** True when every participant shares one parent group (or all are top-level). */
  siblings: boolean;
  blocker: MultiLayerTransformBlockerCode;
}

/**
 * Resolves the multi-layer transform participants from the current selection. Locked,
 * position-locked, and group layers are excluded with reasons instead of silently
 * transforming or blocking the whole gesture; a selection spanning different parent
 * groups is refused so a transform can never rip layers out of their group context.
 */
export function resolveMultiLayerTransformParticipants(
  doc: Pick<ImageDocument, 'layers' | 'activeLayerId' | 'selectedLayerIds'>,
): MultiLayerTransformParticipantPlan {
  const participantLayerIds: string[] = [];
  const excludedLayers: MultiLayerTransformExcludedLayer[] = [];
  for (const id of resolveSelectedLayerIds(doc)) {
    const layer = doc.layers.find((candidate) => candidate.id === id);
    if (!layer) continue;
    const movable: boolean = canMoveImageLayer(layer);
    if (movable) {
      if (getImageLayerIntrinsicSize(layer)) {
        participantLayerIds.push(layer.id);
      } else {
        excludedLayers.push({ layerId: layer.id, reason: 'no-transformable-geometry' });
      }
    } else if (layer.type === 'group') {
      excludedLayers.push({ layerId: layer.id, reason: 'group-layer' });
    } else if (layer.locked) {
      excludedLayers.push({ layerId: layer.id, reason: 'full-lock' });
    } else {
      excludedLayers.push({ layerId: layer.id, reason: 'position-lock' });
    }
  }
  const siblings = areMultiLayerTransformSiblings(doc.layers, participantLayerIds);
  const eligible = participantLayerIds.length > 1 && siblings;
  const blocker: MultiLayerTransformBlockerCode = !siblings
    ? 'multi-select-cross-group-boundaries-unsupported'
    : participantLayerIds.length > 1
      ? 'none'
      : 'too-few-participants';
  return { eligible, participantLayerIds, excludedLayers, siblings, blocker };
}

function normalizeMultiLayerRotation(rotationDeg: number): number {
  const unsigned = ((rotationDeg % 360) + 360) % 360;
  const signed = unsigned > 180 ? unsigned - 360 : unsigned;
  const rounded = Math.round(signed * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function areMultiLayerTransformSiblings(layers: readonly ImageLayer[], participantLayerIds: readonly string[]): boolean {
  const set = new Set(participantLayerIds);
  const participants = layers.filter((layer) => set.has(layer.id));
  if (participants.length === 0) return true;
  const firstGroupId = participants[0].groupId;
  return participants.every((layer) => layer.groupId === firstGroupId);
}

/**
 * The default shared pivot for a multi-layer transform: the centre of the participants'
 * combined placement rects in document space.
 */
export function getMultiLayerTransformPivot(
  layers: readonly ImageLayer[],
  sizeOf: (layer: ImageLayer) => { width: number; height: number },
): { x: number; y: number } | null {
  const rects = layers.map((layer) => {
    const size = sizeOf(layer);
    return { id: layer.id, x: layer.x, y: layer.y, width: size.width, height: size.height };
  });
  const bounds = getGroupBounds(rects, layers.map((layer) => layer.id));
  if (!bounds) return null;
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/**
 * Scales each participant's placement rect about the shared pivot by (sx, sy). Pure math:
 * the caller performs any bitmap resampling for the returned rects. Non-selected layers
 * are not included in the result.
 */
export function scaleSelectedLayerRectsAroundPivot(
  layers: readonly ImageLayer[],
  selectedIds: readonly string[],
  pivot: { x: number; y: number },
  sx: number,
  sy: number,
  sizeOf: (layer: ImageLayer) => { width: number; height: number },
): GroupLayerRect[] {
  const set = new Set(selectedIds);
  const rects: GroupLayerRect[] = [];
  for (const layer of layers) {
    if (!set.has(layer.id)) continue;
    const size = sizeOf(layer);
    rects.push({
      id: layer.id,
      x: pivot.x + (layer.x - pivot.x) * sx,
      y: pivot.y + (layer.y - pivot.y) * sy,
      width: size.width * sx,
      height: size.height * sy,
    });
  }
  return rects;
}
