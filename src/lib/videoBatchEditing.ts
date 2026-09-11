/**
 * Bounded, UI-independent selection and batch-edit proposals for the Video timeline.
 *
 * The workspace's visual and audio clip shapes use different timing property names.  This module
 * intentionally works on a small normalized projection so callers can adapt either clip family,
 * preview a proposal, and commit the mapped result as one editor-history transaction.
 */

export const MAX_VIDEO_BATCH_SELECTION = 2_000;
export const MAX_VIDEO_BATCH_TIMELINE_CLIPS = 100_000;
export const MAX_VIDEO_BATCH_TRACKS = 64;

export type VideoBatchClipKind = 'video' | 'audio';

export interface VideoBatchTrack {
  kind: VideoBatchClipKind;
  trackIndex: number;
  locked: boolean;
}

export interface VideoBatchClip {
  id: string;
  kind: VideoBatchClipKind;
  trackIndex: number;
  startMs: number;
  durationMs: number;
  enabled: boolean;
  linkGroupId?: string;
}

export interface VideoBatchSelection {
  clipIds: string[];
  anchorClipId?: string;
}

export type VideoBatchEditReason =
  | 'empty-selection'
  | 'invalid-time'
  | 'invalid-track-shift'
  | 'locked-track'
  | 'selection-too-large'
  | 'timeline-too-large'
  | 'too-many-tracks'
  | 'track-not-found';

export interface VideoBatchSelectionResult {
  applied: boolean;
  selection: VideoBatchSelection;
  reason?: VideoBatchEditReason;
  missingClipIds: string[];
}

export interface VideoBatchEditResult<TClip extends VideoBatchClip> {
  applied: boolean;
  clips: TClip[];
  affectedClipIds: string[];
  selectedClipIds: string[];
  reason?: VideoBatchEditReason;
}

export interface VideoBatchDuplicateResult<TClip extends VideoBatchClip> extends VideoBatchEditResult<TClip> {
  createdClipIds: string[];
}

export interface VideoBatchSelectionOptions {
  anchorClipId?: string;
  includeLinked?: boolean;
}

export interface VideoBatchMoveOptions {
  deltaMs?: number;
  trackShift?: number;
  includeLinked?: boolean;
}

export interface VideoBatchDuplicateOptions extends VideoBatchMoveOptions {
  createId?: (clip: VideoBatchClip, duplicateIndex: number) => string;
  createLinkGroupId?: (originalLinkGroupId: string, duplicateIndex: number) => string;
}

export function createVideoBatchSelection<TClip extends VideoBatchClip>(
  clips: readonly TClip[],
  requestedClipIds: readonly string[],
  options: VideoBatchSelectionOptions = {},
): VideoBatchSelectionResult {
  if (clips.length > MAX_VIDEO_BATCH_TIMELINE_CLIPS) {
    return rejectedSelection('timeline-too-large');
  }

  const clipById = new Map(clips.map((clip) => [clip.id, clip]));
  const requested = uniqueStrings(requestedClipIds);
  if (requested.length > MAX_VIDEO_BATCH_SELECTION) {
    return rejectedSelection('selection-too-large');
  }

  const missingClipIds = requested.filter((id) => !clipById.has(id));
  const selected = new Set(requested.filter((id) => clipById.has(id)));

  if (options.includeLinked !== false) {
    const linkGroups = new Set(
      [...selected]
        .map((id) => clipById.get(id)?.linkGroupId)
        .filter((value): value is string => Boolean(value)),
    );
    for (const clip of clips) {
      if (clip.linkGroupId && linkGroups.has(clip.linkGroupId)) selected.add(clip.id);
      if (selected.size > MAX_VIDEO_BATCH_SELECTION) {
        return rejectedSelection('selection-too-large');
      }
    }
  }

  const clipIds = clips.filter((clip) => selected.has(clip.id)).map((clip) => clip.id);
  const requestedAnchor = options.anchorClipId && selected.has(options.anchorClipId)
    ? options.anchorClipId
    : undefined;
  return {
    applied: true,
    selection: {
      clipIds,
      anchorClipId: requestedAnchor ?? clipIds[0],
    },
    missingClipIds,
  };
}

export function proposeVideoBatchMove<TClip extends VideoBatchClip>(
  clips: readonly TClip[],
  tracks: readonly VideoBatchTrack[],
  selectedClipIds: readonly string[],
  options: VideoBatchMoveOptions,
): VideoBatchEditResult<TClip> {
  const deltaMs = options.deltaMs ?? 0;
  const trackShift = options.trackShift ?? 0;
  if (!Number.isFinite(deltaMs)) return rejectedEdit(clips, 'invalid-time');
  if (!Number.isInteger(trackShift)) return rejectedEdit(clips, 'invalid-track-shift');

  const prepared = prepareEdit(clips, tracks, selectedClipIds, options.includeLinked);
  if ('reason' in prepared) return rejectedEdit(clips, prepared.reason);
  const { affectedClipIds, selected, trackByKey } = prepared;

  for (const clip of selected) {
    if (clip.startMs + deltaMs < 0) return rejectedEdit(clips, 'invalid-time');
    if (isLocked(trackByKey, clip.kind, clip.trackIndex)) return rejectedEdit(clips, 'locked-track');
    if (trackShift !== 0) {
      const destination = trackByKey.get(trackKey(clip.kind, clip.trackIndex + trackShift));
      if (!destination) return rejectedEdit(clips, 'track-not-found');
      if (destination.locked) return rejectedEdit(clips, 'locked-track');
    }
  }

  const affected = new Set(affectedClipIds);
  return {
    applied: true,
    clips: clips.map((clip) => affected.has(clip.id)
      ? { ...clip, startMs: clip.startMs + deltaMs, trackIndex: clip.trackIndex + trackShift }
      : { ...clip }),
    affectedClipIds,
    selectedClipIds: affectedClipIds,
  };
}

export function proposeVideoBatchTrackShift<TClip extends VideoBatchClip>(
  clips: readonly TClip[],
  tracks: readonly VideoBatchTrack[],
  selectedClipIds: readonly string[],
  trackShift: number,
  includeLinked = true,
): VideoBatchEditResult<TClip> {
  return proposeVideoBatchMove(clips, tracks, selectedClipIds, {
    deltaMs: 0,
    trackShift,
    includeLinked,
  });
}

export function proposeVideoBatchDelete<TClip extends VideoBatchClip>(
  clips: readonly TClip[],
  tracks: readonly VideoBatchTrack[],
  selectedClipIds: readonly string[],
  includeLinked = true,
): VideoBatchEditResult<TClip> {
  const prepared = prepareEdit(clips, tracks, selectedClipIds, includeLinked);
  if ('reason' in prepared) return rejectedEdit(clips, prepared.reason);
  if (prepared.selected.some((clip) => isLocked(prepared.trackByKey, clip.kind, clip.trackIndex))) {
    return rejectedEdit(clips, 'locked-track');
  }
  const affected = new Set(prepared.affectedClipIds);
  return {
    applied: true,
    clips: clips.filter((clip) => !affected.has(clip.id)).map((clip) => ({ ...clip })),
    affectedClipIds: prepared.affectedClipIds,
    selectedClipIds: [],
  };
}

export function proposeVideoBatchEnabled<TClip extends VideoBatchClip>(
  clips: readonly TClip[],
  tracks: readonly VideoBatchTrack[],
  selectedClipIds: readonly string[],
  enabled: boolean,
  includeLinked = true,
): VideoBatchEditResult<TClip> {
  const prepared = prepareEdit(clips, tracks, selectedClipIds, includeLinked);
  if ('reason' in prepared) return rejectedEdit(clips, prepared.reason);
  if (prepared.selected.some((clip) => isLocked(prepared.trackByKey, clip.kind, clip.trackIndex))) {
    return rejectedEdit(clips, 'locked-track');
  }
  const affected = new Set(prepared.affectedClipIds);
  return {
    applied: true,
    clips: clips.map((clip) => affected.has(clip.id) ? { ...clip, enabled } : { ...clip }),
    affectedClipIds: prepared.affectedClipIds,
    selectedClipIds: prepared.affectedClipIds,
  };
}

export function proposeVideoBatchDuplicate<TClip extends VideoBatchClip>(
  clips: readonly TClip[],
  tracks: readonly VideoBatchTrack[],
  selectedClipIds: readonly string[],
  options: VideoBatchDuplicateOptions = {},
): VideoBatchDuplicateResult<TClip> {
  const deltaMs = options.deltaMs ?? 0;
  const trackShift = options.trackShift ?? 0;
  if (!Number.isFinite(deltaMs)) return rejectedDuplicate(clips, 'invalid-time');
  if (!Number.isInteger(trackShift)) return rejectedDuplicate(clips, 'invalid-track-shift');

  const prepared = prepareEdit(clips, tracks, selectedClipIds, options.includeLinked);
  if ('reason' in prepared) return rejectedDuplicate(clips, prepared.reason);
  const usedIds = new Set(clips.map((clip) => clip.id));
  const usedLinkIds = new Set(clips.flatMap((clip) => clip.linkGroupId ? [clip.linkGroupId] : []));
  const linkGroupIds = new Map<string, string>();
  const duplicates: TClip[] = [];

  for (const [index, clip] of prepared.selected.entries()) {
    if (isLocked(prepared.trackByKey, clip.kind, clip.trackIndex)) {
      return rejectedDuplicate(clips, 'locked-track');
    }
    const destination = prepared.trackByKey.get(trackKey(clip.kind, clip.trackIndex + trackShift));
    if (!destination) return rejectedDuplicate(clips, 'track-not-found');
    if (destination.locked) return rejectedDuplicate(clips, 'locked-track');
    if (clip.startMs + deltaMs < 0) return rejectedDuplicate(clips, 'invalid-time');

    const id = uniqueGeneratedId(
      options.createId?.(clip, index),
      `${clip.id}-copy`,
      usedIds,
    );
    let linkGroupId: string | undefined;
    if (clip.linkGroupId) {
      linkGroupId = linkGroupIds.get(clip.linkGroupId);
      if (!linkGroupId) {
        linkGroupId = uniqueGeneratedId(
          options.createLinkGroupId?.(clip.linkGroupId, linkGroupIds.size),
          `${clip.linkGroupId}-copy`,
          usedLinkIds,
        );
        linkGroupIds.set(clip.linkGroupId, linkGroupId);
      }
    }
    duplicates.push({
      ...clip,
      id,
      startMs: clip.startMs + deltaMs,
      trackIndex: clip.trackIndex + trackShift,
      linkGroupId,
    });
  }

  const createdClipIds = duplicates.map((clip) => clip.id);
  return {
    applied: true,
    clips: [...clips.map((clip) => ({ ...clip })), ...duplicates],
    affectedClipIds: prepared.affectedClipIds,
    selectedClipIds: createdClipIds,
    createdClipIds,
  };
}

type PreparedEdit<TClip extends VideoBatchClip> = {
  affectedClipIds: string[];
  selected: TClip[];
  trackByKey: Map<string, VideoBatchTrack>;
} | { reason: VideoBatchEditReason };

function prepareEdit<TClip extends VideoBatchClip>(
  clips: readonly TClip[],
  tracks: readonly VideoBatchTrack[],
  selectedClipIds: readonly string[],
  includeLinked = true,
): PreparedEdit<TClip> {
  if (tracks.length > MAX_VIDEO_BATCH_TRACKS) return { reason: 'too-many-tracks' };
  const trackByKey = new Map<string, VideoBatchTrack>();
  for (const track of tracks) {
    if (!Number.isInteger(track.trackIndex) || track.trackIndex < 0) return { reason: 'track-not-found' };
    trackByKey.set(trackKey(track.kind, track.trackIndex), track);
  }
  const selection = createVideoBatchSelection(clips, selectedClipIds, { includeLinked });
  if (!selection.applied) return { reason: selection.reason ?? 'empty-selection' };
  if (selection.selection.clipIds.length === 0) return { reason: 'empty-selection' };
  const selectedSet = new Set(selection.selection.clipIds);
  const selected = clips.filter((clip) => selectedSet.has(clip.id));
  if (selected.some((clip) => !trackByKey.has(trackKey(clip.kind, clip.trackIndex)))) {
    return { reason: 'track-not-found' };
  }
  return { affectedClipIds: selection.selection.clipIds, selected, trackByKey };
}

function rejectedSelection(reason: VideoBatchEditReason): VideoBatchSelectionResult {
  return { applied: false, selection: { clipIds: [] }, reason, missingClipIds: [] };
}

function rejectedEdit<TClip extends VideoBatchClip>(
  clips: readonly TClip[],
  reason: VideoBatchEditReason,
): VideoBatchEditResult<TClip> {
  return {
    applied: false,
    clips: clips.map((clip) => ({ ...clip })),
    affectedClipIds: [],
    selectedClipIds: [],
    reason,
  };
}

function rejectedDuplicate<TClip extends VideoBatchClip>(
  clips: readonly TClip[],
  reason: VideoBatchEditReason,
): VideoBatchDuplicateResult<TClip> {
  return { ...rejectedEdit(clips, reason), createdClipIds: [] };
}

function uniqueGeneratedId(candidate: string | undefined, fallbackBase: string, used: Set<string>): string {
  const preferred = candidate?.trim();
  if (preferred && !used.has(preferred)) {
    used.add(preferred);
    return preferred;
  }
  let serial = 1;
  while (used.has(`${fallbackBase}-${serial}`)) serial += 1;
  const id = `${fallbackBase}-${serial}`;
  used.add(id);
  return id;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function trackKey(kind: VideoBatchClipKind, trackIndex: number): string {
  return `${kind}:${trackIndex}`;
}

function isLocked(
  trackByKey: ReadonlyMap<string, VideoBatchTrack>,
  kind: VideoBatchClipKind,
  trackIndex: number,
): boolean {
  return trackByKey.get(trackKey(kind, trackIndex))?.locked === true;
}
