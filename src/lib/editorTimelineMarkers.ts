/**
 * Labeled, colored timeline markers for the Video sequencer (gap audit 808, rank 74).
 * Distinct from snap POINTS (bare seconds used by the snap tool): markers carry a label and
 * color for notes/sync/feedback, render as flags in the ruler, and also act as snap targets.
 */

import { MAX_VIDEO_PROJECT_DURATION_MS } from './videoProductionState';
import { allocateCollisionSafeId } from './videoClipClipboard';

export interface TimelineMarker {
  id: string;
  seconds: number;
  endSeconds?: number;
  label: string;
  color: string;
  kind?: 'comment' | 'chapter' | 'review' | 'sync' | 'export' | 'edit' | 'qc';
  notes?: string;
  clipId?: string;
  /** Stable clip-owned offset in milliseconds from the owning clip's timeline start. */
  clipOffsetMs?: number;
  createdAt?: number;
  updatedAt?: number;
}

/** Minimal owning-clip view: a visual clip's startMs or an audio clip's offsetMs. */
export interface TimelineMarkerClipHost {
  id: string;
  startMs: number;
}

export const TIMELINE_MARKER_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#f87171'] as const;
export const MAX_TIMELINE_MARKERS = 20_000;
/** Matches the canonical maximum Video project duration rather than defining a marker-only ceiling. */
export const MAX_TIMELINE_MARKER_SECONDS = MAX_VIDEO_PROJECT_DURATION_MS / 1_000;
/** Clip-relative offsets share the canonical project time ceiling. */
const MAX_TIMELINE_MARKER_OFFSET_MS = MAX_VIDEO_PROJECT_DURATION_MS;

const TIMELINE_MARKER_KINDS = new Set<NonNullable<TimelineMarker['kind']>>([
  'comment',
  'chapter',
  'review',
  'sync',
  'export',
  'edit',
  'qc',
]);

export function normalizeTimelineMarkers(value: unknown): TimelineMarker[] {
  if (!Array.isArray(value)) return [];
  const markers: TimelineMarker[] = [];
  const seenIds = new Set<string>();
  for (const [index, entry] of value.slice(0, MAX_TIMELINE_MARKERS).entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<TimelineMarker>;
    const seconds = clampTimelineMarkerSeconds(candidate.seconds);
    if (seconds === undefined) continue;
    const id = typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id.trim().slice(0, 128)
      : `marker-${index + 1}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const endSeconds = clampTimelineMarkerSeconds(candidate.endSeconds);
    const createdAt = normalizeMarkerTimestamp(candidate.createdAt);
    const updatedAt = normalizeMarkerTimestamp(candidate.updatedAt);
    const clipId = typeof candidate.clipId === 'string' && candidate.clipId.trim()
      ? candidate.clipId.trim().slice(0, 128)
      : undefined;
    // An offset without an owning clip is invalid data: fail closed on the whole marker so
    // normalization and bounds validation agree instead of keeping an ambiguously anchored row.
    if (!clipId && candidate.clipOffsetMs !== undefined) continue;
    markers.push({
      id,
      seconds,
      endSeconds: endSeconds !== undefined && endSeconds > seconds ? endSeconds : undefined,
      label: typeof candidate.label === 'string' ? candidate.label.slice(0, 256) : '',
      color: normalizeTimelineMarkerColor(candidate.color),
      kind: typeof candidate.kind === 'string' && TIMELINE_MARKER_KINDS.has(candidate.kind as NonNullable<TimelineMarker['kind']>)
        ? candidate.kind as NonNullable<TimelineMarker['kind']>
        : 'comment',
      notes: typeof candidate.notes === 'string' && candidate.notes.trim() ? candidate.notes.trim().slice(0, 8_000) : undefined,
      clipId,
      clipOffsetMs: clipId ? normalizeClipOffsetMs(candidate.clipOffsetMs) : undefined,
      createdAt,
      updatedAt: updatedAt ?? createdAt,
    });
  }
  return markers.sort((a, b) => a.seconds - b.seconds);
}

/**
 * Reconcile every clip-owned marker's displayed sequence time against its owning clip's current
 * timeline start. The owned offset is the authority: moving a clip changes the displayed sequence
 * time while the offset is retained. Legacy clip markers without an explicit offset adopt one,
 * derived from their current display, the first time their sequence is reconciled. Markers whose
 * owning clip is absent are left untouched so imports for not-yet-pasted clips never silently
 * disappear. Returns the input reference when nothing changed.
 */
export function reconcileClipTimelineMarkers(
  markers: readonly TimelineMarker[],
  hosts: readonly TimelineMarkerClipHost[],
): TimelineMarker[] {
  if (!markers.some((marker) => marker.clipId)) return markers as TimelineMarker[];
  const hostById = new Map(hosts.map((host) => [host.id, host]));
  let changed = false;
  const reconciled = markers.map((marker) => {
    if (!marker.clipId) return marker;
    const host = hostById.get(marker.clipId);
    if (!host) return marker;
    const offsetMs = marker.clipOffsetMs ?? deriveClipOffsetMs(marker.seconds, host.startMs);
    const seconds = clampTimelineMarkerSeconds((host.startMs + offsetMs) / 1_000);
    if (offsetMs === marker.clipOffsetMs && seconds === marker.seconds) return marker;
    changed = true;
    return { ...marker, clipOffsetMs: offsetMs, seconds: seconds ?? marker.seconds };
  });
  return changed ? reconciled : (markers as TimelineMarker[]);
}

/**
 * Explicit trim policy: a clip marker is anchored to its clip's content, so a start-edge trim
 * shifts its offset by the content shift while its sequence time stays with the content, and any
 * marker left outside `[0, nextDurationMs]` — trimmed past either edge — is removed. Surviving
 * markers keep their label, colour, kind, notes, and timestamps.
 */
export function applyClipTrimToTimelineMarkers(
  markers: readonly TimelineMarker[],
  trim: {
    clipId: string;
    previousStartMs: number;
    nextStartMs: number;
    contentShiftMs: number;
    nextDurationMs: number;
  },
): TimelineMarker[] {
  const clipId = trim.clipId;
  const owned = markers.filter((marker) => marker.clipId === clipId);
  if (owned.length === 0) return markers as TimelineMarker[];
  const removals = new Set<string>();
  const offsetById = new Map<string, number>();
  for (const marker of owned) {
    const offsetMs = marker.clipOffsetMs ?? deriveClipOffsetMs(marker.seconds, trim.previousStartMs);
    const nextOffsetMs = offsetMs - trim.contentShiftMs;
    if (nextOffsetMs < 0 || nextOffsetMs > Math.max(0, trim.nextDurationMs)) {
      removals.add(marker.id);
      continue;
    }
    offsetById.set(marker.id, nextOffsetMs);
  }
  return markers.flatMap((marker) => {
    if (marker.clipId !== clipId) return [marker];
    if (removals.has(marker.id)) return [];
    const offsetMs = offsetById.get(marker.id);
    if (offsetMs === undefined || offsetMs === marker.clipOffsetMs) return [marker];
    return [{ ...marker, clipOffsetMs: offsetMs, seconds: (trim.nextStartMs + offsetMs) / 1_000 }];
  });
}

/**
 * Deterministic split partition: markers strictly before the split point stay with the left clip
 * and their offset; markers at or after it are re-owned by the right clip with the split offset
 * subtracted, so both sides keep their displayed sequence time.
 */
export function applyClipSplitToTimelineMarkers(
  markers: readonly TimelineMarker[],
  split: { clipId: string; clipStartMs: number; splitMs: number; rightClipId: string },
): TimelineMarker[] {
  const splitOffsetMs = split.splitMs - split.clipStartMs;
  return markers.flatMap((marker) => {
    if (marker.clipId !== split.clipId) return [marker];
    const offsetMs = marker.clipOffsetMs ?? deriveClipOffsetMs(marker.seconds, split.clipStartMs);
    if (offsetMs < splitOffsetMs) return [marker.clipOffsetMs === offsetMs ? marker : { ...marker, clipOffsetMs: offsetMs }];
    return [{
      ...marker,
      clipId: split.rightClipId,
      clipOffsetMs: offsetMs - splitOffsetMs,
      seconds: (split.splitMs + (offsetMs - splitOffsetMs)) / 1_000,
    }];
  });
}

/** Deleting clips removes the markers they own; every other marker is untouched. */
export function removeClipsFromTimelineMarkers(
  markers: readonly TimelineMarker[],
  clipIds: Iterable<string>,
): TimelineMarker[] {
  const removed = new Set(clipIds);
  if (removed.size === 0 || !markers.some((marker) => marker.clipId && removed.has(marker.clipId))) {
    return markers as TimelineMarker[];
  }
  return markers.filter((marker) => !marker.clipId || !removed.has(marker.clipId));
}

export interface PlanClipTimelineMarkerPasteInput {
  /** The destination sequence's current markers. */
  markers: readonly TimelineMarker[];
  /** Clip-owned markers captured from the copied selection, offsets already resolved. */
  clipboardMarkers: readonly TimelineMarker[];
  pastedClips: ReadonlyArray<{ id: string; copiedFromClipId: string; startMs: number }>;
  /** Overwritten originals re-owning their surviving markers to retained fragments. */
  overwriteFragments: ReadonlyMap<string, ReadonlyArray<{ id: string; startMs: number; durationMs: number }>>;
  now: number;
}

/**
 * Paste remaps ownership: each clipboard marker is cloned onto its clip's pasted copy with a
 * collision-free marker id, its owned offset, label, colour, kind, notes, and `createdAt`
 * retained and `updatedAt` stamped at paste time. Overwritten originals partition their markers
 * into retained fragments by displayed time and lose the overwritten remainder. The shared
 * 20,000-marker capacity bounds the result deterministically. Returns the input reference when
 * the paste owns no markers.
 */
export function planClipTimelineMarkerPaste(input: PlanClipTimelineMarkerPasteInput): TimelineMarker[] {
  const hasOverwrites = input.overwriteFragments.size > 0
    && [...input.overwriteFragments.values()].some((fragments) => fragments.length > 0);
  if (input.clipboardMarkers.length === 0 && !hasOverwrites) return input.markers as TimelineMarker[];

  const pastedClipIdBySourceId = new Map(input.pastedClips.map((clip) => [clip.copiedFromClipId, clip.id]));
  const pastedStartById = new Map(input.pastedClips.map((clip) => [clip.id, clip.startMs]));

  const base: TimelineMarker[] = [];
  const pasted: TimelineMarker[] = [];
  for (const marker of input.markers) {
    const fragments = marker.clipId ? input.overwriteFragments.get(marker.clipId) : undefined;
    if (!fragments || fragments.length === 0) {
      base.push(marker);
      continue;
    }
    const displayMs = Math.round(marker.seconds * 1_000);
    const fragment = fragments.find(
      (candidate) => displayMs >= candidate.startMs && displayMs < candidate.startMs + Math.max(0, candidate.durationMs),
    );
    if (!fragment) continue;
    base.push({
      ...marker,
      clipId: fragment.id,
      clipOffsetMs: Math.max(0, displayMs - fragment.startMs),
    });
  }

  const usedIds = new Set<string>([
    ...base.map((marker) => marker.id),
    ...input.clipboardMarkers.map((marker) => marker.id),
  ]);
  for (const marker of input.clipboardMarkers) {
    if (base.length + pasted.length >= MAX_TIMELINE_MARKERS) break;
    const pastedClipId = marker.clipId ? pastedClipIdBySourceId.get(marker.clipId) : undefined;
    const startMs = pastedClipId ? pastedStartById.get(pastedClipId) : undefined;
    if (!pastedClipId || startMs === undefined) continue;
    const offsetMs = marker.clipOffsetMs ?? 0;
    pasted.push({
      ...marker,
      id: allocateCollisionSafeId(`${marker.id}-copy`, usedIds),
      clipId: pastedClipId,
      clipOffsetMs: offsetMs,
      seconds: clampTimelineMarkerSeconds((startMs + offsetMs) / 1_000) ?? marker.seconds,
      updatedAt: input.now,
    });
    usedIds.add(pasted[pasted.length - 1].id);
  }

  return [...base, ...pasted].sort((left, right) => left.seconds - right.seconds);
}

/**
 * Editor clip view for transition maintenance. A clip plays the content span
 * `[sourceInMs, sourceInMs + durationMs * rate)` starting at timeline `startMs`.
 */
export interface TimelineMarkerClipTransitionDescriptor {
  id: string;
  kind: 'visual' | 'audio';
  trackIndex: number;
  sourceNodeId: string;
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  rate: number;
}

/**
 * One-pass marker maintenance across a structural clip edit (advanced trim sessions, lift and
 * extract, transcript-applied edits, batch operations). Markers stay content-anchored:
 * - A clip removed entirely loses its markers unless a surviving fragment re-owns them.
 * - A surviving clip whose consumed source head advanced shifts owned offsets by the content
 *   shift (roll/head-trim); a clip that merely moved keeps its offsets and its display follows.
 * - A clip whose source window slipped moves its markers with the content.
 * - New clips that structurally continue a shrunk parent (same kind, track, and source, with
 *   content drawn from inside the parent's before span) re-own the parent markers whose content
 *   they now carry; markers inside a removed range are dropped.
 * Foreign owners (clips not present in `before`) are left untouched, and the input reference is
 * returned when nothing changed.
 */
export function applyClipSetTransitionToTimelineMarkers(
  markers: readonly TimelineMarker[],
  before: readonly TimelineMarkerClipTransitionDescriptor[],
  after: readonly TimelineMarkerClipTransitionDescriptor[],
): TimelineMarker[] {
  if (!markers.some((marker) => marker.clipId)) return markers as TimelineMarker[];
  const beforeById = new Map(before.map((clip) => [clip.id, clip]));
  const afterById = new Map(after.map((clip) => [clip.id, clip]));

  // Group new (fragment) clips onto the before clip whose content they continue: same kind,
  // track, and source, nearest consumed head at or before the fragment's source in-point.
  const fragmentsByParentId = new Map<string, TimelineMarkerClipTransitionDescriptor[]>();
  for (const clip of after) {
    if (beforeById.has(clip.id)) continue;
    let parent: TimelineMarkerClipTransitionDescriptor | undefined;
    for (const candidate of before) {
      if (candidate.kind !== clip.kind || candidate.trackIndex !== clip.trackIndex
        || candidate.sourceNodeId !== clip.sourceNodeId) continue;
      if (clip.sourceInMs < candidate.sourceInMs - 1) continue;
      if (!parent || candidate.sourceInMs > parent.sourceInMs
        || (candidate.sourceInMs === parent.sourceInMs && candidate.id > parent.id)) {
        parent = candidate;
      }
    }
    if (!parent) continue;
    const grouped = fragmentsByParentId.get(parent.id) ?? [];
    grouped.push(clip);
    fragmentsByParentId.set(parent.id, grouped);
  }

  let changed = false;
  const result: TimelineMarker[] = [];
  for (const marker of markers) {
    const parentId = marker.clipId;
    if (!parentId || !beforeById.has(parentId)) {
      result.push(marker);
      continue;
    }
    const parent = beforeById.get(parentId)!;
    const nextParent = afterById.get(parentId);
    // A parent whose structure did not change keeps its markers untouched, whatever their
    // stored display is (this also protects degenerate timing such as unknown durations).
    if (nextParent !== undefined
      && nextParent.startMs === parent.startMs
      && nextParent.sourceInMs === parent.sourceInMs
      && Math.round(nextParent.durationMs) === Math.round(parent.durationMs)
      && nextParent.rate === parent.rate) {
      result.push(marker);
      continue;
    }
    const offsetMs = marker.clipOffsetMs ?? deriveClipOffsetMs(marker.seconds, parent.startMs);
    const contentMs = parent.sourceInMs + offsetMs * parent.rate;
    // The parent keeps exactly the content its surviving span still plays; anything outside
    // that span can only survive by re-owning to a fragment that now carries its content.
    const parentKeepsContent = nextParent !== undefined
      && contentMs >= nextParent.sourceInMs - 1
      && contentMs < nextParent.sourceInMs + Math.max(0, nextParent.durationMs) * nextParent.rate - 1;
    const fragment = parentKeepsContent
      ? undefined
      : (fragmentsByParentId.get(parentId) ?? [])
        .find((candidate) => contentMs >= candidate.sourceInMs - 1
          && contentMs < candidate.sourceInMs + Math.max(0, candidate.durationMs) * candidate.rate);
    if (fragment) {
      const fragmentOffsetMs = Math.round((contentMs - fragment.sourceInMs) / fragment.rate);
      if (marker.clipId === fragment.id && marker.clipOffsetMs === fragmentOffsetMs
        && marker.seconds === (fragment.startMs + fragmentOffsetMs) / 1_000) {
        result.push(marker);
        continue;
      }
      changed = true;
      result.push({
        ...marker,
        clipId: fragment.id,
        clipOffsetMs: fragmentOffsetMs,
        seconds: (fragment.startMs + fragmentOffsetMs) / 1_000,
      });
      continue;
    }
    if (!nextParent) {
      // The parent vanished and no fragment carries this content.
      changed = true;
      continue;
    }
    const contentShiftMs = Math.round((nextParent.sourceInMs - parent.sourceInMs) / parent.rate);
    const nextOffsetMs = offsetMs - contentShiftMs;
    if (nextOffsetMs < 0 || nextOffsetMs > Math.max(0, nextParent.durationMs)) {
      changed = true;
      continue;
    }
    if (contentShiftMs === 0 && nextParent.startMs === parent.startMs && marker.clipOffsetMs === offsetMs) {
      result.push(marker);
      continue;
    }
    changed = true;
    result.push({
      ...marker,
      clipOffsetMs: nextOffsetMs,
      seconds: (nextParent.startMs + nextOffsetMs) / 1_000,
    });
  }
  return changed ? result : (markers as TimelineMarker[]);
}

/** Add a marker at `seconds`; auto-label ("Marker N") and cycle the palette. No duplicates within 50ms. */
export function addTimelineMarker(markers: readonly TimelineMarker[], seconds: number): TimelineMarker[] {
  if (markers.length >= MAX_TIMELINE_MARKERS) return [...markers];
  const normalized = clampTimelineMarkerSeconds(seconds);
  if (normalized === undefined) return [...markers];
  if (markers.some((marker) => Math.abs(marker.seconds - normalized) < 0.05)) {
    return [...markers];
  }
  const now = Date.now();
  const marker: TimelineMarker = {
    id: `marker-${now}-${Math.random().toString(36).slice(2, 8)}`,
    seconds: normalized,
    label: `Marker ${markers.length + 1}`,
    color: TIMELINE_MARKER_COLORS[markers.length % TIMELINE_MARKER_COLORS.length],
    kind: 'comment',
    createdAt: now,
    updatedAt: now,
  };
  return [...markers, marker].sort((a, b) => a.seconds - b.seconds);
}

export function removeTimelineMarker(markers: readonly TimelineMarker[], markerId: string): TimelineMarker[] {
  return markers.filter((marker) => marker.id !== markerId);
}

export function updateTimelineMarker(
  markers: readonly TimelineMarker[],
  markerId: string,
  patch: Partial<Pick<TimelineMarker, 'label' | 'color' | 'seconds' | 'endSeconds' | 'kind' | 'notes' | 'clipId' | 'updatedAt'>>,
): TimelineMarker[] {
  const updatedAt = patch.updatedAt ?? Date.now();
  return normalizeTimelineMarkers(markers
    .map((marker) => (marker.id === markerId ? { ...marker, ...patch, updatedAt } : marker))
    .sort((a, b) => a.seconds - b.seconds));
}

/** Binary-search adjacent marker navigation for feature-length marker sets. */
export function findAdjacentTimelineMarker(
  markers: readonly TimelineMarker[],
  seconds: number,
  direction: 'previous' | 'next',
): TimelineMarker | undefined {
  let low = 0;
  let high = markers.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((markers[middle]?.seconds ?? 0) <= seconds) low = middle + 1;
    else high = middle;
  }
  return direction === 'next' ? markers[low] : markers[low - 1];
}

export function clampTimelineMarkerSeconds(value: unknown): number | undefined {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return undefined;
  return Math.round(Math.min(MAX_TIMELINE_MARKER_SECONDS, Math.max(0, seconds)) * 1_000) / 1_000;
}

export function isTimelineMarkerWithinBounds(value: unknown): value is TimelineMarker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<TimelineMarker>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim() || candidate.id.length > 128) return false;
  if (typeof candidate.seconds !== 'number'
    || !Number.isFinite(candidate.seconds)
    || candidate.seconds < 0
    || candidate.seconds > MAX_TIMELINE_MARKER_SECONDS) return false;
  if (candidate.endSeconds !== undefined
    && (typeof candidate.endSeconds !== 'number'
      || !Number.isFinite(candidate.endSeconds)
      || candidate.endSeconds <= candidate.seconds
      || candidate.endSeconds > MAX_TIMELINE_MARKER_SECONDS)) return false;
  if (typeof candidate.label !== 'string' || candidate.label.length > 256) return false;
  if (!isTimelineMarkerColor(candidate.color)) return false;
  if (candidate.kind !== undefined
    && (typeof candidate.kind !== 'string'
      || !TIMELINE_MARKER_KINDS.has(candidate.kind as NonNullable<TimelineMarker['kind']>))) return false;
  if (candidate.notes !== undefined && (typeof candidate.notes !== 'string' || candidate.notes.length > 8_000)) return false;
  if (candidate.clipId !== undefined
    && (typeof candidate.clipId !== 'string' || !candidate.clipId.trim() || candidate.clipId.length > 128)) return false;
  if (candidate.clipOffsetMs !== undefined && candidate.clipId === undefined) return false;
  if (candidate.clipOffsetMs !== undefined
    && (typeof candidate.clipOffsetMs !== 'number'
      || !Number.isFinite(candidate.clipOffsetMs)
      || candidate.clipOffsetMs < 0
      || candidate.clipOffsetMs > MAX_TIMELINE_MARKER_OFFSET_MS)) return false;
  return isOptionalMarkerTimestamp(candidate.createdAt) && isOptionalMarkerTimestamp(candidate.updatedAt);
}

function normalizeClipOffsetMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(MAX_TIMELINE_MARKER_OFFSET_MS, Math.max(0, value)));
}

/** Legacy clip markers adopt the offset their current display implies relative to the owning clip. */
function deriveClipOffsetMs(seconds: number, clipStartMs: number): number {
  return Math.round(Math.min(MAX_TIMELINE_MARKER_OFFSET_MS, Math.max(0, Math.round(seconds * 1_000) - clipStartMs)));
}

function normalizeTimelineMarkerColor(value: unknown): string {
  return isTimelineMarkerColor(value) ? value.trim().toLowerCase() : TIMELINE_MARKER_COLORS[0];
}

function isTimelineMarkerColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/iu.test(value.trim());
}

function normalizeMarkerTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function isOptionalMarkerTimestamp(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}
