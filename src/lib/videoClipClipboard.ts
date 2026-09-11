/**
 * Project-safe clipboard planning for cross-sequence Video edits.
 *
 * Clipboard documents contain source references and editing decisions only. Media bytes, data
 * URLs, blob URLs, native paths, thumbnails, and cache locations deliberately have no fields in
 * this schema.
 */

import type { EditorAudioClip, EditorVisualClip } from '../types/flow';

export const VIDEO_CLIP_CLIPBOARD_VERSION = 1 as const;
export const MAX_VIDEO_CLIPBOARD_CLIPS = 2_000;
export const MAX_VIDEO_CLIPBOARD_AUTHORED_STATE_ENTRIES = 1_000_000;
export const MAX_VIDEO_CLIPBOARD_AUTHORED_STRING_CHARACTERS = 8 * 1024 * 1024;
export const MAX_VIDEO_CLIPBOARD_TIME_MS = 12 * 60 * 60 * 1_000;

export type VideoClipboardClipKind = 'visual' | 'audio';
export type VideoClipboardOperation = 'copy' | 'cut';
export type VideoClipboardPasteMode = 'overwrite' | 'insert';

export interface VideoClipboardTrack {
  id: string;
  kind: 'video' | 'audio';
  order: number;
  locked: boolean;
}

export type VideoClipboardAuthoredClip =
  | { kind: 'visual'; clip: EditorVisualClip }
  | { kind: 'audio'; clip: EditorAudioClip };

export interface VideoClipboardTimelineClip {
  id: string;
  kind: VideoClipboardClipKind;
  trackId: string;
  startMs: number;
  durationMs: number;
  sourceItemId: string;
  sourceInMs: number;
  sourceOutMs?: number;
  linkGroupId?: string;
  syncGroupId?: string;
  label?: string;
  /** Full authored decisions only; runtime media, URLs, bytes, paths, and caches are rejected. */
  authoredClip?: VideoClipboardAuthoredClip;
}

export interface VideoClipClipboardItem {
  sourceClipId: string;
  kind: VideoClipboardClipKind;
  sourceTrackId: string;
  relativeTrackOffset: number;
  relativeStartMs: number;
  durationMs: number;
  sourceItemId: string;
  sourceInMs: number;
  sourceOutMs?: number;
  sourceLinkGroupId?: string;
  sourceSyncGroupId?: string;
  relativeLinkOffsetMs?: number;
  label?: string;
  authoredClip?: VideoClipboardAuthoredClip;
}

export interface VideoClipClipboardDocument {
  version: typeof VIDEO_CLIP_CLIPBOARD_VERSION;
  operation: VideoClipboardOperation;
  sourceSequenceId: string;
  sourceRevision: string;
  anchorStartMs: number;
  spanMs: number;
  items: VideoClipClipboardItem[];
}

export type VideoClipClipboardBuildError =
  | { code: 'empty-selection'; message: string }
  | { code: 'selection-limit'; message: string; limit: number }
  | { code: 'missing-clip'; message: string; clipIds: string[] }
  | { code: 'track-not-found'; message: string; trackIds: string[] }
  | { code: 'source-track-locked'; message: string; trackIds: string[] }
  | { code: 'invalid-clip'; message: string; clipIds: string[] }
  | { code: 'unsafe-authored-state'; message: string; clipIds: string[] }
  | { code: 'authored-state-limit'; message: string; limit: number };

export type VideoClipClipboardBuildResult =
  | { ok: true; document: VideoClipClipboardDocument }
  | { ok: false; errors: VideoClipClipboardBuildError[] };

export interface BuildVideoClipClipboardInput {
  operation: VideoClipboardOperation;
  sourceSequenceId: string;
  sourceRevision: string;
  clips: readonly VideoClipboardTimelineClip[];
  selectedClipIds: readonly string[];
  tracks: readonly VideoClipboardTrack[];
}

export interface VideoClipboardPasteClipDescriptor extends VideoClipboardTimelineClip {
  /** The original clip is retained for history labels and post-paste selection. */
  copiedFromClipId: string;
}

export interface VideoClipboardInsertShiftDescriptor {
  clipId: string;
  trackId: string;
  deltaMs: number;
}

export interface VideoClipboardOverwriteRange {
  startMs: number;
  endMs: number;
}

/** Exact replacement for one destination clip touched by overwrite paste. */
export interface VideoClipboardOverwriteReplacementDescriptor {
  originalClipId: string;
  kind: VideoClipboardClipKind;
  trackId: string;
  removedRanges: VideoClipboardOverwriteRange[];
  retainedFragments: VideoClipboardTimelineClip[];
}

export interface VideoClipboardCutRemovalDescriptor {
  sequenceId: string;
  expectedRevision: string;
  clipIds: string[];
}

export interface VideoClipPastePlan {
  destinationSequenceId: string;
  mode: VideoClipboardPasteMode;
  atMs: number;
  clips: VideoClipboardPasteClipDescriptor[];
  insertShifts: VideoClipboardInsertShiftDescriptor[];
  overwriteReplacements: VideoClipboardOverwriteReplacementDescriptor[];
  cutRemoval?: VideoClipboardCutRemovalDescriptor;
}

export type VideoClipPasteError =
  | { code: 'clipboard-empty'; message: string }
  | { code: 'clipboard-limit'; message: string; limit: number }
  | { code: 'invalid-clipboard'; message: string; itemClipIds?: string[] }
  | { code: 'missing-source'; message: string; sourceItemIds: string[] }
  | { code: 'target-track-unavailable'; message: string; itemClipIds: string[] }
  | { code: 'target-track-locked'; message: string; trackIds: string[] }
  | { code: 'invalid-time'; message: string }
  | { code: 'invalid-existing-clip'; message: string; clipIds: string[] };

export type VideoClipPasteResult =
  | { ok: true; plan: VideoClipPastePlan }
  | { ok: false; errors: VideoClipPasteError[] };

export interface PlanVideoClipPasteInput {
  clipboard: VideoClipClipboardDocument;
  destinationSequenceId: string;
  atMs: number;
  mode: VideoClipboardPasteMode;
  tracks: readonly VideoClipboardTrack[];
  /** Optional anchor track for each kind. Relative track offsets are applied from this track. */
  targetTrackIdByKind?: Partial<Record<VideoClipboardClipKind, string>>;
  availableSourceItemIds: ReadonlySet<string>;
  existingClips: readonly VideoClipboardTimelineClip[];
  existingClipIds?: ReadonlySet<string>;
}

export function createVideoClipboardVisualTimelineClip(input: {
  clip: EditorVisualClip;
  trackId: string;
  sourceItemId: string;
  label?: string;
}): VideoClipboardTimelineClip {
  const durationMs = visualClipDurationMs(input.clip);
  return {
    id: input.clip.id,
    kind: 'visual',
    trackId: input.trackId,
    startMs: input.clip.startMs,
    durationMs,
    sourceItemId: input.sourceItemId,
    sourceInMs: input.clip.sourceInMs,
    ...(input.clip.sourceOutMs !== undefined ? { sourceOutMs: input.clip.sourceOutMs } : {}),
    ...(input.clip.professional?.linkGroupId ? { linkGroupId: input.clip.professional.linkGroupId } : {}),
    ...(input.clip.professional?.syncGroupId ? { syncGroupId: input.clip.professional.syncGroupId } : {}),
    ...(input.label ? { label: input.label } : {}),
    authoredClip: { kind: 'visual', clip: input.clip },
  };
}

export function createVideoClipboardAudioTimelineClip(input: {
  clip: EditorAudioClip;
  trackId: string;
  sourceItemId: string;
  durationMs?: number;
  label?: string;
}): VideoClipboardTimelineClip {
  const durationMs = input.clip.sourceInMs !== undefined && input.clip.sourceOutMs !== undefined
    ? input.clip.sourceOutMs - input.clip.sourceInMs
    : input.durationMs ?? Number.NaN;
  return {
    id: input.clip.id,
    kind: 'audio',
    trackId: input.trackId,
    startMs: input.clip.offsetMs,
    durationMs,
    sourceItemId: input.sourceItemId,
    sourceInMs: input.clip.sourceInMs ?? 0,
    ...(input.clip.sourceOutMs !== undefined ? { sourceOutMs: input.clip.sourceOutMs } : {}),
    ...(input.clip.professional?.linkGroupId ? { linkGroupId: input.clip.professional.linkGroupId } : {}),
    ...(input.clip.professional?.syncGroupId ? { syncGroupId: input.clip.professional.syncGroupId } : {}),
    ...(input.label ? { label: input.label } : {}),
    authoredClip: { kind: 'audio', clip: input.clip },
  };
}

export function buildVideoClipClipboard(
  input: BuildVideoClipClipboardInput,
): VideoClipClipboardBuildResult {
  const selectedIds = dedupeStrings(input.selectedClipIds);
  if (selectedIds.length === 0) {
    return { ok: false, errors: [{ code: 'empty-selection', message: 'Select at least one clip.' }] };
  }
  if (selectedIds.length > MAX_VIDEO_CLIPBOARD_CLIPS) {
    return {
      ok: false,
      errors: [{
        code: 'selection-limit',
        message: `A clipboard operation supports at most ${MAX_VIDEO_CLIPBOARD_CLIPS} clips.`,
        limit: MAX_VIDEO_CLIPBOARD_CLIPS,
      }],
    };
  }

  const clipsById = new Map(input.clips.map((clip) => [clip.id, clip]));
  const tracksById = new Map(input.tracks.map((track) => [track.id, track]));
  const missingClipIds = selectedIds.filter((id) => !clipsById.has(id));
  const selected = selectedIds.flatMap((id) => {
    const clip = clipsById.get(id);
    return clip ? [clip] : [];
  });
  const invalidClipIds = selected
    .filter((clip) => !isValidTimelineClip(clip))
    .map((clip) => clip.id)
    .sort();
  const missingTrackIds = dedupeStrings(
    selected.filter((clip) => !tracksById.has(clip.trackId)).map((clip) => clip.trackId),
  );
  const lockedTrackIds = input.operation === 'cut'
    ? dedupeStrings(selected
      .filter((clip) => tracksById.get(clip.trackId)?.locked)
      .map((clip) => clip.trackId))
    : [];
  const errors: VideoClipClipboardBuildError[] = [];
  if (missingClipIds.length > 0) {
    errors.push({ code: 'missing-clip', message: 'Some selected clips no longer exist.', clipIds: missingClipIds });
  }
  if (missingTrackIds.length > 0) {
    errors.push({ code: 'track-not-found', message: 'Some selected clips reference missing tracks.', trackIds: missingTrackIds });
  }
  if (lockedTrackIds.length > 0) {
    errors.push({ code: 'source-track-locked', message: 'Cut cannot remove clips from locked tracks.', trackIds: lockedTrackIds });
  }
  if (invalidClipIds.length > 0) {
    errors.push({ code: 'invalid-clip', message: 'Some selected clips have invalid timing or source references.', clipIds: invalidClipIds });
  }
  if (errors.length > 0) return { ok: false, errors };

  const authoredStateByClipId = new Map<string, VideoClipboardAuthoredClip>();
  const authoredStateBudget: ReferenceCloneBudget = { entries: 0, stringCharacters: 0 };
  const unsafeAuthoredClipIds: string[] = [];
  try {
    for (const clip of selected) {
      if (!clip.authoredClip) continue;
      if (clip.authoredClip.kind !== clip.kind || clip.authoredClip.clip.id !== clip.id) {
        unsafeAuthoredClipIds.push(clip.id);
        continue;
      }
      authoredStateByClipId.set(
        clip.id,
        cloneReferenceOnlyAuthoredClip(clip.authoredClip, authoredStateBudget),
      );
    }
  } catch (error) {
    if (error instanceof AuthoredStateLimitError) {
      return {
        ok: false,
        errors: [{
          code: 'authored-state-limit',
          message: error.message,
          limit: error.limit,
        }],
      };
    }
    return {
      ok: false,
      errors: [{
        code: 'unsafe-authored-state',
        message: error instanceof Error ? error.message : 'Clipboard authored state is not reference-only.',
        clipIds: selected.filter((clip) => clip.authoredClip).map((clip) => clip.id).sort(),
      }],
    };
  }
  if (unsafeAuthoredClipIds.length > 0) {
    return {
      ok: false,
      errors: [{
        code: 'unsafe-authored-state',
        message: 'Authored clip snapshots must match their clipboard descriptor kind and clip id.',
        clipIds: unsafeAuthoredClipIds.sort(),
      }],
    };
  }

  const anchorStartMs = Math.min(...selected.map((clip) => clip.startMs));
  const spanMs = Math.max(...selected.map((clip) => clip.startMs + clip.durationMs)) - anchorStartMs;
  const anchorTrackOrder = new Map<VideoClipboardClipKind, number>();
  for (const kind of ['visual', 'audio'] as const) {
    const orders = selected
      .filter((clip) => clip.kind === kind)
      .map((clip) => tracksById.get(clip.trackId)?.order)
      .filter((order): order is number => order !== undefined);
    if (orders.length > 0) anchorTrackOrder.set(kind, Math.min(...orders));
  }
  const linkAnchorById = new Map<string, number>();
  for (const clip of selected) {
    const linkGroupId = resolvedLinkGroupId(clip);
    if (!linkGroupId) continue;
    linkAnchorById.set(
      linkGroupId,
      Math.min(linkAnchorById.get(linkGroupId) ?? Number.POSITIVE_INFINITY, clip.startMs),
    );
  }

  const items = selected
    .map((clip): VideoClipClipboardItem => {
      const linkGroupId = resolvedLinkGroupId(clip);
      const syncGroupId = resolvedSyncGroupId(clip);
      return {
        sourceClipId: clip.id,
        kind: clip.kind,
        sourceTrackId: clip.trackId,
        relativeTrackOffset: (tracksById.get(clip.trackId)?.order ?? 0) - (anchorTrackOrder.get(clip.kind) ?? 0),
        relativeStartMs: clip.startMs - anchorStartMs,
        durationMs: clip.durationMs,
        sourceItemId: clip.sourceItemId,
        sourceInMs: clip.sourceInMs,
        ...(clip.sourceOutMs !== undefined ? { sourceOutMs: clip.sourceOutMs } : {}),
        ...(linkGroupId ? {
          sourceLinkGroupId: linkGroupId,
          relativeLinkOffsetMs: clip.startMs - (linkAnchorById.get(linkGroupId) ?? clip.startMs),
        } : {}),
        ...(syncGroupId ? { sourceSyncGroupId: syncGroupId } : {}),
        ...(cleanOptionalText(clip.label, 160) ? { label: cleanOptionalText(clip.label, 160) } : {}),
        ...(authoredStateByClipId.get(clip.id) ? { authoredClip: authoredStateByClipId.get(clip.id) } : {}),
      };
    })
    .sort(compareClipboardItems);

  return {
    ok: true,
    document: {
      version: VIDEO_CLIP_CLIPBOARD_VERSION,
      operation: input.operation,
      sourceSequenceId: requiredText(input.sourceSequenceId, 'sourceSequenceId'),
      sourceRevision: requiredText(input.sourceRevision, 'sourceRevision'),
      anchorStartMs,
      spanMs,
      items,
    },
  };
}

export function planVideoClipPaste(input: PlanVideoClipPasteInput): VideoClipPasteResult {
  if (input.clipboard.items.length === 0) {
    return { ok: false, errors: [{ code: 'clipboard-empty', message: 'The Video clipboard is empty.' }] };
  }
  if (input.clipboard.items.length > MAX_VIDEO_CLIPBOARD_CLIPS) {
    return {
      ok: false,
      errors: [{
        code: 'clipboard-limit',
        message: `The Video clipboard exceeds ${MAX_VIDEO_CLIPBOARD_CLIPS.toLocaleString()} clips.`,
        limit: MAX_VIDEO_CLIPBOARD_CLIPS,
      }],
    };
  }
  const invalidClipboardItemIds = input.clipboard.items
    .filter((item) => !isValidClipboardItem(item))
    .map((item) => item.sourceClipId)
    .sort();
  if (input.clipboard.version !== VIDEO_CLIP_CLIPBOARD_VERSION
    || !Number.isFinite(input.clipboard.spanMs) || input.clipboard.spanMs <= 0
    || invalidClipboardItemIds.length > 0) {
    return {
      ok: false,
      errors: [{
        code: 'invalid-clipboard',
        message: 'The Video clipboard has an unsupported version or invalid clip descriptors.',
        ...(invalidClipboardItemIds.length > 0 ? { itemClipIds: invalidClipboardItemIds } : {}),
      }],
    };
  }
  try {
    const budget: ReferenceCloneBudget = { entries: 0, stringCharacters: 0 };
    for (const item of input.clipboard.items) {
      if (item.authoredClip) cloneReferenceOnlyAuthoredClip(item.authoredClip, budget);
    }
  } catch (error) {
    return {
      ok: false,
      errors: [{
        code: 'invalid-clipboard',
        message: error instanceof Error ? error.message : 'The Video clipboard authored state is unsafe.',
      }],
    };
  }
  if (!Number.isFinite(input.atMs) || input.atMs < 0
    || input.atMs + input.clipboard.spanMs > MAX_VIDEO_CLIPBOARD_TIME_MS) {
    return { ok: false, errors: [{ code: 'invalid-time', message: 'Paste time must be a non-negative finite value.' }] };
  }

  const missingSourceItemIds = dedupeStrings(input.clipboard.items
    .filter((item) => !input.availableSourceItemIds.has(item.sourceItemId))
    .map((item) => item.sourceItemId));
  const tracksByKind = {
    visual: input.tracks.filter((track) => track.kind === 'video').sort(compareTracks),
    audio: input.tracks.filter((track) => track.kind === 'audio').sort(compareTracks),
  } satisfies Record<VideoClipboardClipKind, VideoClipboardTrack[]>;
  const resolvedTracks = new Map<VideoClipClipboardItem, VideoClipboardTrack>();
  const unavailableItemClipIds: string[] = [];

  for (const item of input.clipboard.items) {
    const candidates = tracksByKind[item.kind];
    const requestedAnchorId = input.targetTrackIdByKind?.[item.kind];
    const requestedAnchorIndex = requestedAnchorId
      ? candidates.findIndex((track) => track.id === requestedAnchorId)
      : -1;
    const sourceTrackIndex = candidates.findIndex((track) => track.id === item.sourceTrackId);
    const anchorIndex = requestedAnchorIndex >= 0 ? requestedAnchorIndex : sourceTrackIndex >= 0 ? sourceTrackIndex : 0;
    const targetTrack = candidates[anchorIndex + item.relativeTrackOffset];
    if (!targetTrack) unavailableItemClipIds.push(item.sourceClipId);
    else resolvedTracks.set(item, targetTrack);
  }

  const lockedTrackIds = dedupeStrings([...resolvedTracks.values()]
    .filter((track) => track.locked)
    .map((track) => track.id));
  const errors: VideoClipPasteError[] = [];
  if (missingSourceItemIds.length > 0) {
    errors.push({ code: 'missing-source', message: 'Paste requires source media that is unavailable in the destination project.', sourceItemIds: missingSourceItemIds });
  }
  if (unavailableItemClipIds.length > 0) {
    errors.push({ code: 'target-track-unavailable', message: 'The destination sequence does not have compatible target tracks.', itemClipIds: unavailableItemClipIds.sort() });
  }
  if (lockedTrackIds.length > 0) {
    errors.push({ code: 'target-track-locked', message: 'Paste cannot modify locked destination tracks.', trackIds: lockedTrackIds });
  }
  const invalidExistingClipIds = input.mode === 'overwrite'
    ? input.existingClips.filter((clip) => !isValidTimelineClip(clip)).map((clip) => clip.id).sort()
    : [];
  if (invalidExistingClipIds.length > 0) {
    errors.push({
      code: 'invalid-existing-clip',
      message: 'Overwrite planning needs valid timing and source ranges for every destination clip.',
      clipIds: invalidExistingClipIds,
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const usedClipIds = new Set(input.existingClipIds ?? input.existingClips.map((clip) => clip.id));
  const usedLinkGroupIds = new Set(input.existingClips.flatMap((clip) => {
    const groupId = resolvedLinkGroupId(clip);
    return groupId ? [groupId] : [];
  }));
  const usedSyncGroupIds = new Set(input.existingClips.flatMap((clip) => {
    const groupId = resolvedSyncGroupId(clip);
    return groupId ? [groupId] : [];
  }));
  const pastedLinkGroupIds = new Map<string, string>();
  const pastedSyncGroupIds = new Map<string, string>();
  const clips = input.clipboard.items.map((item): VideoClipboardPasteClipDescriptor => {
    const track = resolvedTracks.get(item);
    if (!track) throw new Error('Paste track resolution changed during planning.');
    const id = allocateCollisionSafeId(`${item.sourceClipId}-copy`, usedClipIds);
    let linkGroupId: string | undefined;
    if (item.sourceLinkGroupId) {
      linkGroupId = pastedLinkGroupIds.get(item.sourceLinkGroupId);
      if (!linkGroupId) {
        linkGroupId = allocateCollisionSafeId(`${item.sourceLinkGroupId}-copy`, usedLinkGroupIds);
        pastedLinkGroupIds.set(item.sourceLinkGroupId, linkGroupId);
      }
    }
    let syncGroupId: string | undefined;
    if (item.sourceSyncGroupId) {
      syncGroupId = pastedSyncGroupIds.get(item.sourceSyncGroupId);
      if (!syncGroupId) {
        syncGroupId = allocateCollisionSafeId(`${item.sourceSyncGroupId}-copy`, usedSyncGroupIds);
        pastedSyncGroupIds.set(item.sourceSyncGroupId, syncGroupId);
      }
    }
    const startMs = Math.round(input.atMs + item.relativeStartMs);
    const authoredClip = item.authoredClip
      ? rebaseAuthoredClip(item.authoredClip, {
          id,
          trackId: track.id,
          trackIndex: track.order,
          startMs,
          sourceInMs: item.sourceInMs,
          sourceOutMs: item.sourceOutMs,
          durationMs: item.durationMs,
          linkGroupId,
          syncGroupId,
        })
      : undefined;
    return {
      id,
      copiedFromClipId: item.sourceClipId,
      kind: item.kind,
      trackId: track.id,
      startMs,
      durationMs: item.durationMs,
      sourceItemId: item.sourceItemId,
      sourceInMs: item.sourceInMs,
      ...(item.sourceOutMs !== undefined ? { sourceOutMs: item.sourceOutMs } : {}),
      ...(linkGroupId ? { linkGroupId } : {}),
      ...(syncGroupId ? { syncGroupId } : {}),
      ...(item.label ? { label: item.label } : {}),
      ...(authoredClip ? { authoredClip } : {}),
    };
  });

  const affectedTrackIds = new Set(clips.map((clip) => clip.trackId));
  const insertShifts = input.mode === 'insert'
    ? input.existingClips
      .filter((clip) => affectedTrackIds.has(clip.trackId) && clip.startMs >= input.atMs)
      .map((clip) => ({ clipId: clip.id, trackId: clip.trackId, deltaMs: input.clipboard.spanMs }))
      .sort((left, right) => left.trackId.localeCompare(right.trackId) || left.clipId.localeCompare(right.clipId))
    : [];
  const overwriteReplacements = input.mode === 'overwrite'
    ? planOverwriteReplacements(input.existingClips, clips, usedClipIds)
    : [];

  return {
    ok: true,
    plan: {
      destinationSequenceId: requiredText(input.destinationSequenceId, 'destinationSequenceId'),
      mode: input.mode,
      atMs: Math.round(input.atMs),
      clips,
      insertShifts,
      overwriteReplacements,
      ...(input.clipboard.operation === 'cut' ? {
        cutRemoval: {
          sequenceId: input.clipboard.sourceSequenceId,
          expectedRevision: input.clipboard.sourceRevision,
          clipIds: input.clipboard.items.map((item) => item.sourceClipId),
        },
      } : {}),
    },
  };
}

function planOverwriteReplacements(
  existingClips: readonly VideoClipboardTimelineClip[],
  pastedClips: readonly VideoClipboardPasteClipDescriptor[],
  usedClipIds: Set<string>,
): VideoClipboardOverwriteReplacementDescriptor[] {
  const overwriteRangesByTrack = new Map<string, VideoClipboardOverwriteRange[]>();
  for (const clip of pastedClips) {
    overwriteRangesByTrack.set(clip.trackId, mergeTimeRanges([
      ...(overwriteRangesByTrack.get(clip.trackId) ?? []),
      { startMs: clip.startMs, endMs: clip.startMs + clip.durationMs },
    ]));
  }

  return existingClips.flatMap((clip): VideoClipboardOverwriteReplacementDescriptor[] => {
    const clipStartMs = clip.startMs;
    const clipEndMs = clip.startMs + clip.durationMs;
    const coverage = overwriteRangesByTrack.get(clip.trackId) ?? [];
    const removedRanges = coverage.flatMap((range) => {
      const startMs = Math.max(clipStartMs, range.startMs);
      const endMs = Math.min(clipEndMs, range.endMs);
      return endMs > startMs ? [{ startMs, endMs }] : [];
    });
    if (removedRanges.length === 0) return [];

    const retainedOffsets = subtractTimeRanges(
      { startMs: clipStartMs, endMs: clipEndMs },
      removedRanges,
    );
    const retainedFragments = retainedOffsets.map((range, index) => {
      const id = index === 0
        ? clip.id
        : allocateCollisionSafeId(`${clip.id}-overwrite-fragment`, usedClipIds);
      return sliceClipboardTimelineClip(
        clip,
        range.startMs - clipStartMs,
        range.endMs - clipStartMs,
        id,
      );
    });
    return [{
      originalClipId: clip.id,
      kind: clip.kind,
      trackId: clip.trackId,
      removedRanges,
      retainedFragments,
    }];
  }).sort((left, right) => left.trackId.localeCompare(right.trackId)
    || left.originalClipId.localeCompare(right.originalClipId));
}

function sliceClipboardTimelineClip(
  clip: VideoClipboardTimelineClip,
  keepStartMs: number,
  keepEndMs: number,
  id: string,
): VideoClipboardTimelineClip {
  const durationMs = keepEndMs - keepStartMs;
  const sourceRate = clipboardSourceRate(clip);
  const sourceOutMs = clip.sourceOutMs ?? clip.sourceInMs + clip.durationMs * sourceRate;
  const reverse = clip.authoredClip?.kind === 'visual' && clip.authoredClip.clip.reversePlayback;
  const nextSourceInMs = reverse
    ? sourceOutMs - keepEndMs * sourceRate
    : clip.sourceInMs + keepStartMs * sourceRate;
  const nextSourceOutMs = reverse
    ? sourceOutMs - keepStartMs * sourceRate
    : clip.sourceInMs + keepEndMs * sourceRate;
  const startMs = clip.startMs + keepStartMs;
  const authoredClip = clip.authoredClip
    ? rebaseAuthoredClip(clip.authoredClip, {
        id,
        trackId: clip.trackId,
        trackIndex: clip.authoredClip.clip.trackIndex,
        startMs,
        sourceInMs: nextSourceInMs,
        sourceOutMs: nextSourceOutMs,
        durationMs,
        linkGroupId: resolvedLinkGroupId(clip),
        syncGroupId: resolvedSyncGroupId(clip),
      })
    : undefined;
  return {
    ...clip,
    id,
    startMs,
    durationMs,
    sourceInMs: nextSourceInMs,
    sourceOutMs: nextSourceOutMs,
    ...(authoredClip ? { authoredClip } : {}),
  };
}

function mergeTimeRanges(ranges: readonly VideoClipboardOverwriteRange[]): VideoClipboardOverwriteRange[] {
  const sorted = [...ranges].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const merged: VideoClipboardOverwriteRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.startMs > previous.endMs) merged.push({ ...range });
    else previous.endMs = Math.max(previous.endMs, range.endMs);
  }
  return merged;
}

function subtractTimeRanges(
  whole: VideoClipboardOverwriteRange,
  removed: readonly VideoClipboardOverwriteRange[],
): VideoClipboardOverwriteRange[] {
  let cursor = whole.startMs;
  const retained: VideoClipboardOverwriteRange[] = [];
  for (const range of mergeTimeRanges(removed)) {
    if (range.startMs > cursor) retained.push({ startMs: cursor, endMs: range.startMs });
    cursor = Math.max(cursor, range.endMs);
  }
  if (cursor < whole.endMs) retained.push({ startMs: cursor, endMs: whole.endMs });
  return retained;
}

function clipboardSourceRate(clip: VideoClipboardTimelineClip): number {
  if (clip.authoredClip?.kind === 'visual') {
    return Math.max(0.000001, Math.abs(clip.authoredClip.clip.playbackRate || 1));
  }
  if (clip.sourceOutMs !== undefined) return (clip.sourceOutMs - clip.sourceInMs) / clip.durationMs;
  return 1;
}

function rebaseAuthoredClip(
  authored: VideoClipboardAuthoredClip,
  update: {
    id: string;
    trackId?: string;
    trackIndex: number;
    startMs: number;
    sourceInMs: number;
    sourceOutMs?: number;
    durationMs?: number;
    linkGroupId?: string;
    syncGroupId?: string;
  },
): VideoClipboardAuthoredClip {
  const cloned = cloneReferenceOnlyAuthoredClip(authored, { entries: 0, stringCharacters: 0 });
  if (cloned.kind === 'visual') {
    return {
      kind: 'visual',
      clip: {
        ...cloned.clip,
        id: update.id,
        trackIndex: update.trackIndex,
        startMs: update.startMs,
        sourceInMs: update.sourceInMs,
        sourceOutMs: update.sourceOutMs,
        ...(update.durationMs !== undefined ? { durationSeconds: update.durationMs / 1_000 } : {}),
        professional: rebaseProfessionalState(
          cloned.clip.professional,
          update.trackId,
          update.linkGroupId,
          update.syncGroupId,
        ),
      },
    };
  }
  return {
    kind: 'audio',
    clip: {
      ...cloned.clip,
      id: update.id,
      trackIndex: update.trackIndex,
      offsetMs: update.startMs,
      sourceInMs: update.sourceInMs,
      sourceOutMs: update.sourceOutMs,
      professional: rebaseProfessionalState(
        cloned.clip.professional,
        update.trackId,
        update.linkGroupId,
        update.syncGroupId,
      ),
    },
  };
}

function rebaseProfessionalState<T extends { trackId?: string; linkGroupId?: string; syncGroupId?: string } | undefined>(
  professional: T,
  trackId: string | undefined,
  linkGroupId: string | undefined,
  syncGroupId: string | undefined,
): T {
  if (!professional && !trackId && !linkGroupId && !syncGroupId) return professional;
  const next = { ...(professional ?? {}) } as Exclude<T, undefined>;
  if (trackId) next.trackId = trackId;
  if (linkGroupId) next.linkGroupId = linkGroupId;
  else delete next.linkGroupId;
  if (syncGroupId) next.syncGroupId = syncGroupId;
  else delete next.syncGroupId;
  return next as T;
}

export function allocateCollisionSafeId(base: string, usedIds: Set<string>): string {
  const cleanBase = cleanOptionalText(base, 180)?.replace(/\s+/gu, '-') || 'clip-copy';
  let candidate = cleanBase;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${cleanBase}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

interface ReferenceCloneBudget {
  entries: number;
  stringCharacters: number;
}

class AuthoredStateLimitError extends Error {
  readonly limit: number;

  constructor(message: string, limit: number) {
    super(message);
    this.name = 'AuthoredStateLimitError';
    this.limit = limit;
  }
}

function cloneReferenceOnlyAuthoredClip(
  authored: VideoClipboardAuthoredClip,
  budget: ReferenceCloneBudget,
): VideoClipboardAuthoredClip {
  return cloneReferenceOnlyValue(authored, budget, new WeakSet<object>(), 'authoredClip') as VideoClipboardAuthoredClip;
}

function cloneReferenceOnlyValue(
  value: unknown,
  budget: ReferenceCloneBudget,
  ancestors: WeakSet<object>,
  path: string,
): unknown {
  budget.entries += 1;
  if (budget.entries > MAX_VIDEO_CLIPBOARD_AUTHORED_STATE_ENTRIES) {
    throw new AuthoredStateLimitError(
      `Clipboard authored state exceeds ${MAX_VIDEO_CLIPBOARD_AUTHORED_STATE_ENTRIES.toLocaleString()} values.`,
      MAX_VIDEO_CLIPBOARD_AUTHORED_STATE_ENTRIES,
    );
  }
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Clipboard authored state '${path}' must be finite.`);
    return value;
  }
  if (typeof value === 'string') {
    budget.stringCharacters += value.length;
    if (budget.stringCharacters > MAX_VIDEO_CLIPBOARD_AUTHORED_STRING_CHARACTERS) {
      throw new AuthoredStateLimitError(
        `Clipboard authored strings exceed ${MAX_VIDEO_CLIPBOARD_AUTHORED_STRING_CHARACTERS.toLocaleString()} characters.`,
        MAX_VIDEO_CLIPBOARD_AUTHORED_STRING_CHARACTERS,
      );
    }
    if (/^(?:blob|data|file):/iu.test(value.trim())) {
      throw new Error(`Clipboard authored state '${path}' contains a runtime media reference.`);
    }
    return value;
  }
  if (typeof value !== 'object') throw new Error(`Clipboard authored state '${path}' is not serializable.`);
  if (ancestors.has(value)) throw new Error(`Clipboard authored state '${path}' contains a cycle.`);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || (typeof Blob !== 'undefined' && value instanceof Blob)) {
    throw new Error(`Clipboard authored state '${path}' contains media bytes.`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => cloneReferenceOnlyValue(entry, budget, ancestors, `${path}[${index}]`));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Clipboard authored state '${path}' contains a non-plain object.`);
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/^(?:assetUrl|sourceAssetUrl|nativeFilePath|dataUrl|blob|mediaBytes|thumbnailUrl|cachePath|cacheUrl)$/iu.test(key)) {
        throw new Error(`Clipboard authored state '${path}.${key}' is a runtime media field.`);
      }
      const cloned = cloneReferenceOnlyValue(entry, budget, ancestors, `${path}.${key}`);
      if (cloned !== undefined) result[key] = cloned;
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function resolvedLinkGroupId(clip: VideoClipboardTimelineClip): string | undefined {
  return cleanOptionalText(clip.linkGroupId ?? clip.authoredClip?.clip.professional?.linkGroupId, 200);
}

function resolvedSyncGroupId(clip: VideoClipboardTimelineClip): string | undefined {
  return cleanOptionalText(clip.syncGroupId ?? clip.authoredClip?.clip.professional?.syncGroupId, 200);
}

function visualClipDurationMs(clip: EditorVisualClip): number {
  if (Number.isFinite(clip.durationSeconds) && (clip.durationSeconds ?? 0) > 0) {
    return clip.durationSeconds! * 1_000;
  }
  if (clip.sourceOutMs !== undefined && clip.sourceOutMs > clip.sourceInMs) {
    return (clip.sourceOutMs - clip.sourceInMs) / Math.max(0.000001, Math.abs(clip.playbackRate || 1));
  }
  return Number.NaN;
}

function isValidTimelineClip(clip: VideoClipboardTimelineClip): boolean {
  return Boolean(
    clip.id.trim()
    && clip.trackId.trim()
    && clip.sourceItemId.trim()
    && Number.isFinite(clip.startMs)
    && clip.startMs >= 0
    && Number.isFinite(clip.durationMs)
    && clip.durationMs > 0
    && clip.startMs + clip.durationMs <= MAX_VIDEO_CLIPBOARD_TIME_MS
    && Number.isFinite(clip.sourceInMs)
    && clip.sourceInMs >= 0
    && (clip.sourceOutMs === undefined || (Number.isFinite(clip.sourceOutMs) && clip.sourceOutMs > clip.sourceInMs)),
  );
}

function isValidClipboardItem(item: VideoClipClipboardItem): boolean {
  return Boolean(
    item.sourceClipId.trim()
    && item.sourceTrackId.trim()
    && item.sourceItemId.trim()
    && Number.isInteger(item.relativeTrackOffset)
    && Number.isFinite(item.relativeStartMs)
    && item.relativeStartMs >= 0
    && Number.isFinite(item.durationMs)
    && item.durationMs > 0
    && item.relativeStartMs + item.durationMs <= MAX_VIDEO_CLIPBOARD_TIME_MS
    && Number.isFinite(item.sourceInMs)
    && item.sourceInMs >= 0
    && (item.sourceOutMs === undefined
      || (Number.isFinite(item.sourceOutMs) && item.sourceOutMs > item.sourceInMs))
    && (!item.authoredClip
      || (item.authoredClip.kind === item.kind && item.authoredClip.clip.id === item.sourceClipId)),
  );
}

function compareTracks(left: VideoClipboardTrack, right: VideoClipboardTrack): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function compareClipboardItems(left: VideoClipClipboardItem, right: VideoClipClipboardItem): number {
  return left.relativeStartMs - right.relativeStartMs
    || left.kind.localeCompare(right.kind)
    || left.relativeTrackOffset - right.relativeTrackOffset
    || left.sourceClipId.localeCompare(right.sourceClipId);
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function cleanOptionalText(value: string | undefined, limit: number): string | undefined {
  const clean = value?.trim().slice(0, limit);
  return clean || undefined;
}

function requiredText(value: string, field: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${field} is required.`);
  return clean;
}
