import type { EditorAudioClip, EditorVisualClip } from '../types/flow';
import {
  mergeTranscriptRemovedRanges,
  validateEditableTranscript,
  type EditableTranscriptWord,
  type TimelineRippleDeleteCommand,
  type TranscriptEditProposal,
  type TranscriptRemovedRange,
} from './videoTranscriptEditing';

export const VIDEO_TRANSCRIPT_APPLY_VERSION = 1 as const;
export const MAX_VIDEO_TRANSCRIPT_APPLY_WORDS = 100_000;
export const MAX_VIDEO_TRANSCRIPT_AFFECTED_CLIPS = 2_000;
export const MAX_VIDEO_TRANSCRIPT_TIMELINE_CLIPS = 100_000;
export const MAX_VIDEO_TRANSCRIPT_TRACKS = 64;
export const MAX_VIDEO_TRANSCRIPT_TIME_MS = 12 * 60 * 60 * 1_000;
export const MAX_VIDEO_TRANSCRIPT_SOURCE_RANGES = 5_000;
export const MAX_VIDEO_TRANSCRIPT_SOURCE_MAPPINGS = 2_000;

export type VideoTranscriptClipKind = 'visual' | 'audio';

export interface VideoTranscriptApplyTrack {
  kind: VideoTranscriptClipKind;
  trackIndex: number;
  locked: boolean;
}

export interface VideoTranscriptSplitIdContext {
  kind: VideoTranscriptClipKind;
  originalClipId: string;
  commandIndex: number;
  side: 'right';
}

export interface VideoTranscriptClipReplacement {
  kind: VideoTranscriptClipKind;
  originalClipId: string;
  clips: readonly (EditorVisualClip | EditorAudioClip)[];
}

export interface VideoTranscriptApplyPatch {
  version: typeof VIDEO_TRANSCRIPT_APPLY_VERSION;
  baseSignature: string;
  proposalTitle: string;
  commands: readonly TimelineRippleDeleteCommand[];
  replacements: readonly VideoTranscriptClipReplacement[];
  affectedClipIds: readonly string[];
  createdClipIds: readonly string[];
  removedClipIds: readonly string[];
}

export type VideoTranscriptApplyRejectedReason =
  | 'ambiguous-source-history'
  | 'ambiguous-source-mapping'
  | 'duplicate-clip-id'
  | 'duplicate-track'
  | 'empty-source-selection'
  | 'feature-length-bound-exceeded'
  | 'invalid-clip'
  | 'invalid-proposal'
  | 'invalid-transcript'
  | 'linked-group-not-atomic'
  | 'locked-track'
  | 'missing-track'
  | 'nonlinear-source-mapping'
  | 'partial-source-range'
  | 'reverse-source-mapping'
  | 'source-clip-not-found'
  | 'source-range-outside-clip'
  | 'stale-patch'
  | 'too-many-affected-clips'
  | 'too-many-clips'
  | 'too-many-tracks'
  | 'too-many-words'
  | 'too-many-source-mappings'
  | 'too-many-source-ranges';

export type VideoTranscriptApplyResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: VideoTranscriptApplyRejectedReason; detail: string };

export interface VideoTranscriptAppliedTimeline {
  visualClips: EditorVisualClip[];
  audioClips: EditorAudioClip[];
  patch: VideoTranscriptApplyPatch;
}

export interface VideoTranscriptSourceClipSelection {
  kind: VideoTranscriptClipKind;
  clipId: string;
}

export interface VideoTranscriptSourceRangeMapping {
  clipId: string;
  kind: VideoTranscriptClipKind;
  sourceStartMs: number;
  sourceEndMs: number;
  sourceInMs: number;
  sourceOutMs: number;
  speed: number;
  recordStartMs: number;
  recordEndMs: number;
  reason: TranscriptRemovedRange['reason'];
}

export interface VideoTranscriptSourceProposalMapping {
  sourceProposal: TranscriptEditProposal;
  recordProposal: TranscriptEditProposal;
  mappings: VideoTranscriptSourceRangeMapping[];
}

export interface VideoTranscriptSourceMappingInput {
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  selectedClips: readonly VideoTranscriptSourceClipSelection[];
  sourceProposal: TranscriptEditProposal;
  audioDurationMsByClipId?: Readonly<Record<string, number>>;
}

export interface VideoTranscriptSourceAppliedTimeline extends VideoTranscriptAppliedTimeline {
  sourceMapping: VideoTranscriptSourceProposalMapping;
}

interface WorkingVisual {
  kind: 'visual';
  originKey: string;
  clip: EditorVisualClip;
  durationMs: number;
}

interface WorkingAudio {
  kind: 'audio';
  originKey: string;
  clip: EditorAudioClip;
  durationMs: number;
}

type WorkingClip = WorkingVisual | WorkingAudio;
type MutationKind = 'none' | 'shift' | 'remove' | 'trim-head' | 'trim-tail' | 'split';

export function mapVideoTranscriptSourceProposalToRecord(
  input: VideoTranscriptSourceMappingInput,
): VideoTranscriptApplyResult<VideoTranscriptSourceProposalMapping> {
  if (input.sourceProposal.ranges.length > MAX_VIDEO_TRANSCRIPT_SOURCE_RANGES) {
    return rejected(
      'too-many-source-ranges',
      `Source transcript proposal exceeds ${MAX_VIDEO_TRANSCRIPT_SOURCE_RANGES.toLocaleString()} ranges.`,
    );
  }
  if (input.selectedClips.length === 0) {
    return rejected('empty-source-selection', 'Select at least one source clip before mapping transcript time to record time.');
  }
  if (input.selectedClips.length > MAX_VIDEO_TRANSCRIPT_AFFECTED_CLIPS) {
    return rejected(
      'too-many-affected-clips',
      `Source transcript mapping supports at most ${MAX_VIDEO_TRANSCRIPT_AFFECTED_CLIPS.toLocaleString()} selected clips.`,
    );
  }
  if (input.visualClips.length + input.audioClips.length > MAX_VIDEO_TRANSCRIPT_TIMELINE_CLIPS) {
    return rejected('too-many-clips', `Timeline exceeds the ${MAX_VIDEO_TRANSCRIPT_TIMELINE_CLIPS.toLocaleString()}-clip mapping limit.`);
  }

  for (const [index, range] of input.sourceProposal.ranges.entries()) {
    if (!isValidTranscriptRange(range)) {
      return rejected('invalid-proposal', `Source transcript range ${index + 1} is invalid.`);
    }
  }
  const sourceRanges = mergeTranscriptRemovedRanges(input.sourceProposal.ranges);
  const removedAfter = mergeTranscriptRemovedRanges(input.sourceProposal.removedRangesAfter);
  if (!sameTranscriptRanges(sourceRanges, removedAfter)) {
    return rejected(
      'ambiguous-source-history',
      'Source transcript proposal includes earlier ripple history; map each fresh source range before applying record edits.',
    );
  }

  const normalized = normalizeWorkingClips(
    input.visualClips,
    input.audioClips,
    input.audioDurationMsByClipId ?? {},
  );
  if (!normalized.ok) return normalized;
  const workingByKey = new Map(normalized.value.map((item) => [clipKey(item.kind, item.clip.id), item]));
  const selectedKeys = new Set<string>();
  const selected: WorkingClip[] = [];
  for (const selection of input.selectedClips) {
    const key = clipKey(selection.kind, selection.clipId);
    if (selectedKeys.has(key)) {
      return rejected('ambiguous-source-mapping', `Source clip '${selection.clipId}' is selected more than once.`);
    }
    selectedKeys.add(key);
    const item = workingByKey.get(key);
    if (!item) return rejected('source-clip-not-found', `Selected ${selection.kind} clip '${selection.clipId}' no longer exists.`);
    selected.push(item);
  }

  const mappings: VideoTranscriptSourceRangeMapping[] = [];
  for (const item of selected) {
    const descriptor = sourceMappingDescriptor(item);
    if (!descriptor.ok) return descriptor;
    for (const range of sourceRanges) {
      if (range.endMs <= descriptor.value.sourceInMs || range.startMs >= descriptor.value.sourceOutMs) continue;
      if (range.startMs < descriptor.value.sourceInMs || range.endMs > descriptor.value.sourceOutMs) {
        return rejected(
          'partial-source-range',
          `Source transcript range ${range.startMs}–${range.endMs}ms crosses clip '${item.clip.id}' source boundaries.`,
        );
      }
      const recordStartMs = roundMappedMilliseconds(
        timelineStart(item) + (range.startMs - descriptor.value.sourceInMs) / descriptor.value.speed,
      );
      const recordEndMs = roundMappedMilliseconds(
        timelineStart(item) + (range.endMs - descriptor.value.sourceInMs) / descriptor.value.speed,
      );
      if (recordEndMs <= recordStartMs || recordEndMs > MAX_VIDEO_TRANSCRIPT_TIME_MS) {
        return rejected('feature-length-bound-exceeded', `Mapped record range for clip '${item.clip.id}' exceeds the feature timeline.`);
      }
      mappings.push({
        clipId: item.clip.id,
        kind: item.kind,
        sourceStartMs: range.startMs,
        sourceEndMs: range.endMs,
        sourceInMs: descriptor.value.sourceInMs,
        sourceOutMs: descriptor.value.sourceOutMs,
        speed: descriptor.value.speed,
        recordStartMs,
        recordEndMs,
        reason: range.reason,
      });
      if (mappings.length > MAX_VIDEO_TRANSCRIPT_SOURCE_MAPPINGS) {
        return rejected(
          'too-many-source-mappings',
          `Source transcript proposal expands beyond ${MAX_VIDEO_TRANSCRIPT_SOURCE_MAPPINGS.toLocaleString()} record mappings.`,
        );
      }
    }
  }

  for (const range of sourceRanges) {
    if (!mappings.some((mapping) => mapping.sourceStartMs === range.startMs && mapping.sourceEndMs === range.endMs)) {
      return rejected(
        'source-range-outside-clip',
        `Source transcript range ${range.startMs}–${range.endMs}ms is outside every selected source clip.`,
      );
    }
  }

  const sortedMappings = [...mappings].sort(compareSourceMappings);
  for (let index = 1; index < sortedMappings.length; index += 1) {
    const previous = sortedMappings[index - 1]!;
    const current = sortedMappings[index]!;
    if (current.recordStartMs >= previous.recordEndMs) continue;
    const sameRecordRange = current.recordStartMs === previous.recordStartMs
      && current.recordEndMs === previous.recordEndMs;
    const sameSourceRange = current.sourceStartMs === previous.sourceStartMs
      && current.sourceEndMs === previous.sourceEndMs;
    if (!sameRecordRange || !sameSourceRange) {
      return rejected(
        'ambiguous-source-mapping',
        `Selected clips '${previous.clipId}' and '${current.clipId}' map source transcript time onto overlapping, non-identical record ranges.`,
      );
    }
  }

  const recordRanges = mergeTranscriptRemovedRanges([...new Map(sortedMappings.map((mapping) => {
    const key = `${mapping.recordStartMs}:${mapping.recordEndMs}`;
    const range: TranscriptRemovedRange = {
      startMs: mapping.recordStartMs,
      endMs: mapping.recordEndMs,
      reason: mapping.reason,
    };
    return [key, range] as const;
  })).values()]);
  const commands = [...recordRanges]
    .sort((left, right) => right.startMs - left.startMs || right.endMs - left.endMs)
    .map<TimelineRippleDeleteCommand>((range) => ({
      kind: 'ripple-delete',
      startMs: range.startMs,
      endMs: range.endMs,
      durationMs: range.endMs - range.startMs,
      source: 'transcript',
    }));
  return {
    ok: true,
    value: {
      sourceProposal: cloneTranscriptProposal(input.sourceProposal),
      recordProposal: {
        title: input.sourceProposal.title,
        ranges: recordRanges,
        commands,
        removedRangesAfter: recordRanges.map((range) => ({ ...range })),
      },
      mappings: sortedMappings,
    },
  };
}

export function planAndApplyVideoSourceTranscriptEdit(
  input: VideoTranscriptSourceMappingInput & {
    tracks: readonly VideoTranscriptApplyTrack[];
    words: readonly EditableTranscriptWord[];
    createSplitClipId?: (context: VideoTranscriptSplitIdContext) => string;
  },
): VideoTranscriptApplyResult<VideoTranscriptSourceAppliedTimeline> {
  const mapped = mapVideoTranscriptSourceProposalToRecord(input);
  if (!mapped.ok) return mapped;
  const applied = planAndApplyVideoTranscriptEdit({
    visualClips: input.visualClips,
    audioClips: input.audioClips,
    tracks: input.tracks,
    words: input.words,
    proposal: mapped.value.recordProposal,
    audioDurationMsByClipId: input.audioDurationMsByClipId,
    createSplitClipId: input.createSplitClipId,
  });
  if (!applied.ok) return applied;
  return { ok: true, value: { ...applied.value, sourceMapping: mapped.value } };
}

export function planVideoTranscriptApply({
  visualClips,
  audioClips,
  tracks,
  words,
  proposal,
  audioDurationMsByClipId = {},
  createSplitClipId = defaultSplitClipId,
}: {
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  tracks: readonly VideoTranscriptApplyTrack[];
  words: readonly EditableTranscriptWord[];
  proposal: TranscriptEditProposal;
  audioDurationMsByClipId?: Readonly<Record<string, number>>;
  createSplitClipId?: (context: VideoTranscriptSplitIdContext) => string;
}): VideoTranscriptApplyResult<VideoTranscriptApplyPatch> {
  if (words.length > MAX_VIDEO_TRANSCRIPT_APPLY_WORDS) {
    return rejected('too-many-words', `Transcript exceeds the ${MAX_VIDEO_TRANSCRIPT_APPLY_WORDS.toLocaleString()}-word application limit.`);
  }
  try {
    validateEditableTranscript(words);
  } catch (error) {
    return rejected('invalid-transcript', errorMessage(error));
  }
  if (visualClips.length + audioClips.length > MAX_VIDEO_TRANSCRIPT_TIMELINE_CLIPS) {
    return rejected('too-many-clips', `Timeline exceeds the ${MAX_VIDEO_TRANSCRIPT_TIMELINE_CLIPS.toLocaleString()}-clip application limit.`);
  }
  if (tracks.length > MAX_VIDEO_TRANSCRIPT_TRACKS) {
    return rejected('too-many-tracks', `Transcript application supports at most ${MAX_VIDEO_TRANSCRIPT_TRACKS} timeline tracks.`);
  }
  const trackMap = new Map<string, VideoTranscriptApplyTrack>();
  for (const track of tracks) {
    const key = trackKey(track.kind, track.trackIndex);
    if (!Number.isInteger(track.trackIndex) || track.trackIndex < 0 || trackMap.has(key)) {
      return rejected('duplicate-track', `Track ${key} is invalid or duplicated.`);
    }
    trackMap.set(key, { ...track });
  }
  const commands = validateCommands(proposal.commands);
  if (!commands.ok) return commands;

  const normalized = normalizeWorkingClips(visualClips, audioClips, audioDurationMsByClipId);
  if (!normalized.ok) return normalized;
  let working = normalized.value;
  const originalWorking = working;
  const affectedOriginKeys = new Set<string>();
  const affectedCurrentIds = new Set<string>();
  const createdIds = new Set<string>();

  for (const [commandIndex, command] of commands.value.entries()) {
    const mutations = new Map<WorkingClip, MutationKind>();
    for (const item of working) mutations.set(item, classifyMutation(item, command));
    const atomic = validateAtomicMutation(working, mutations, trackMap);
    if (!atomic.ok) return atomic;
    for (const [item, mutation] of mutations) {
      if (mutation === 'none') continue;
      affectedOriginKeys.add(item.originKey);
      affectedCurrentIds.add(clipKey(item.kind, item.clip.id));
    }
    if (affectedCurrentIds.size > MAX_VIDEO_TRANSCRIPT_AFFECTED_CLIPS) {
      return rejected('too-many-affected-clips', `Transcript edit affects more than ${MAX_VIDEO_TRANSCRIPT_AFFECTED_CLIPS.toLocaleString()} clips.`);
    }
    const next: WorkingClip[] = [];
    for (const item of working) {
      const transformed = transformWorkingClip(item, command, commandIndex, createSplitClipId);
      for (const candidate of transformed) {
        const key = clipKey(candidate.kind, candidate.clip.id);
        if (candidate.clip.id !== item.clip.id) {
          if (!candidate.clip.id.trim() || createdIds.has(key) || working.some((existing) => clipKey(existing.kind, existing.clip.id) === key)) {
            return rejected('duplicate-clip-id', `Transcript split produced duplicate clip id '${candidate.clip.id}'.`);
          }
          createdIds.add(key);
        }
        next.push(candidate);
      }
    }
    working = next;
  }

  const originalsByKey = new Map(originalWorking.map((item) => [item.originKey, item]));
  const replacements = [...affectedOriginKeys]
    .sort()
    .map((originKey): VideoTranscriptClipReplacement => {
      const original = originalsByKey.get(originKey)!;
      const clips = working
        .filter((item) => item.originKey === originKey)
        .sort(compareWorkingClips)
        .map((item) => item.clip);
      return { kind: original.kind, originalClipId: original.clip.id, clips };
    });
  const removedClipIds = replacements.filter((replacement) => replacement.clips.length === 0).map((replacement) => replacement.originalClipId);
  const createdClipIds = replacements.flatMap((replacement) => replacement.clips
    .filter((clip) => clip.id !== replacement.originalClipId)
    .map((clip) => clip.id));
  const patch: VideoTranscriptApplyPatch = Object.freeze({
    version: VIDEO_TRANSCRIPT_APPLY_VERSION,
    baseSignature: buildTimelineSignature(visualClips, audioClips),
    proposalTitle: proposal.title,
    commands: commands.value.map((command) => Object.freeze({ ...command })),
    replacements: replacements.map((replacement) => Object.freeze({
      ...replacement,
      clips: replacement.clips.map((clip) => Object.freeze({ ...clip })),
    })),
    affectedClipIds: replacements.map((replacement) => replacement.originalClipId),
    createdClipIds,
    removedClipIds,
  });
  return { ok: true, value: patch };
}

export function applyVideoTranscriptPatch(
  visualClips: readonly EditorVisualClip[],
  audioClips: readonly EditorAudioClip[],
  patch: VideoTranscriptApplyPatch,
): VideoTranscriptApplyResult<VideoTranscriptAppliedTimeline> {
  if (patch.version !== VIDEO_TRANSCRIPT_APPLY_VERSION || patch.baseSignature !== buildTimelineSignature(visualClips, audioClips)) {
    return rejected('stale-patch', 'Timeline clips changed after the transcript patch was planned.');
  }
  const visualReplacements = new Map<string, readonly EditorVisualClip[]>();
  const audioReplacements = new Map<string, readonly EditorAudioClip[]>();
  for (const replacement of patch.replacements) {
    if (replacement.kind === 'visual') {
      visualReplacements.set(replacement.originalClipId, replacement.clips as readonly EditorVisualClip[]);
    } else {
      audioReplacements.set(replacement.originalClipId, replacement.clips as readonly EditorAudioClip[]);
    }
  }
  const nextVisual = visualClips.flatMap((clip) => visualReplacements.get(clip.id)?.map(cloneVisual) ?? [cloneVisual(clip)]).sort(compareVisualClips);
  const nextAudio = audioClips.flatMap((clip) => audioReplacements.get(clip.id)?.map(cloneAudio) ?? [cloneAudio(clip)]).sort(compareAudioClips);
  return {
    ok: true,
    value: { visualClips: nextVisual, audioClips: nextAudio, patch },
  };
}

export function planAndApplyVideoTranscriptEdit(
  input: Parameters<typeof planVideoTranscriptApply>[0],
): VideoTranscriptApplyResult<VideoTranscriptAppliedTimeline> {
  const planned = planVideoTranscriptApply(input);
  if (!planned.ok) return planned;
  return applyVideoTranscriptPatch(input.visualClips, input.audioClips, planned.value);
}

function sourceMappingDescriptor(
  item: WorkingClip,
): VideoTranscriptApplyResult<{ sourceInMs: number; sourceOutMs: number; speed: number }> {
  const parameterKeyframes = item.clip.professional?.parameterKeyframes ?? [];
  const hasSpeedAutomation = parameterKeyframes.some((track) => {
    const parameter = track.parameter.trim().toLocaleLowerCase();
    return parameter === 'speed' || parameter === 'playbackrate' || parameter === 'playback-rate';
  });
  if (hasSpeedAutomation || (item.kind === 'visual' && (item.clip.professional?.retime?.length ?? 0) > 0)) {
    return rejected(
      'nonlinear-source-mapping',
      `Clip '${item.clip.id}' has retime or speed automation, so one source range cannot map to one linear record range.`,
    );
  }
  if (item.kind === 'visual' && item.clip.reversePlayback) {
    return rejected('reverse-source-mapping', `Clip '${item.clip.id}' is reversed; transcript source mapping supports forward clips only.`);
  }

  const speed = item.kind === 'visual' ? item.clip.playbackRate : 1;
  if (!Number.isFinite(speed) || speed <= 0) {
    return rejected('nonlinear-source-mapping', `Clip '${item.clip.id}' needs one positive finite playback speed.`);
  }
  const sourceInMs = item.kind === 'visual' ? item.clip.sourceInMs : item.clip.sourceInMs ?? 0;
  const explicitSourceOutMs = item.clip.sourceOutMs;
  const sourceOutMs = explicitSourceOutMs ?? sourceInMs + item.durationMs * speed;
  if (!Number.isFinite(sourceInMs) || sourceInMs < 0 || !Number.isFinite(sourceOutMs) || sourceOutMs <= sourceInMs) {
    return rejected('invalid-clip', `Clip '${item.clip.id}' has an invalid source range for transcript mapping.`);
  }
  if (Math.abs((sourceOutMs - sourceInMs) - item.durationMs * speed) > 1) {
    return rejected(
      'ambiguous-source-mapping',
      `Clip '${item.clip.id}' source range, record duration, and playback speed do not describe one linear mapping.`,
    );
  }
  return { ok: true, value: { sourceInMs, sourceOutMs, speed } };
}

function isValidTranscriptRange(range: TranscriptRemovedRange): boolean {
  return Number.isFinite(range.startMs) && range.startMs >= 0
    && Number.isFinite(range.endMs) && range.endMs > range.startMs
    && range.endMs <= MAX_VIDEO_TRANSCRIPT_TIME_MS
    && (range.reason === 'transcript-selection' || range.reason === 'silence-gap');
}

function sameTranscriptRanges(
  left: readonly TranscriptRemovedRange[],
  right: readonly TranscriptRemovedRange[],
): boolean {
  return left.length === right.length && left.every((range, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && candidate.startMs === range.startMs
      && candidate.endMs === range.endMs
      && candidate.reason === range.reason;
  });
}

function cloneTranscriptProposal(proposal: TranscriptEditProposal): TranscriptEditProposal {
  return {
    title: proposal.title,
    ranges: proposal.ranges.map((range) => ({ ...range })),
    commands: proposal.commands.map((command) => ({ ...command })),
    removedRangesAfter: proposal.removedRangesAfter.map((range) => ({ ...range })),
  };
}

function roundMappedMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function compareSourceMappings(
  left: VideoTranscriptSourceRangeMapping,
  right: VideoTranscriptSourceRangeMapping,
): number {
  return left.recordStartMs - right.recordStartMs
    || left.recordEndMs - right.recordEndMs
    || left.sourceStartMs - right.sourceStartMs
    || left.kind.localeCompare(right.kind)
    || left.clipId.localeCompare(right.clipId);
}

function normalizeWorkingClips(
  visualClips: readonly EditorVisualClip[],
  audioClips: readonly EditorAudioClip[],
  audioDurationMsByClipId: Readonly<Record<string, number>>,
): VideoTranscriptApplyResult<WorkingClip[]> {
  const keys = new Set<string>();
  const result: WorkingClip[] = [];
  for (const clip of visualClips) {
    const key = clipKey('visual', clip.id);
    if (!clip.id.trim() || keys.has(key)) return rejected('duplicate-clip-id', `Visual clip id '${clip.id}' is missing or duplicated.`);
    keys.add(key);
    const durationMs = visualDurationMs(clip);
    if (!isValidClipRange(clip.startMs, durationMs, clip.sourceInMs, clip.sourceOutMs)) {
      return rejected('invalid-clip', `Visual clip '${clip.id}' has an invalid timeline or source range.`);
    }
    result.push({ kind: 'visual', originKey: key, clip: cloneVisual(clip), durationMs });
  }
  for (const clip of audioClips) {
    const key = clipKey('audio', clip.id);
    if (!clip.id.trim() || keys.has(key)) return rejected('duplicate-clip-id', `Audio clip id '${clip.id}' is missing or duplicated.`);
    keys.add(key);
    const explicitDuration = clip.sourceInMs !== undefined && clip.sourceOutMs !== undefined
      ? clip.sourceOutMs - clip.sourceInMs
      : audioDurationMsByClipId[clip.id];
    if (!isValidClipRange(clip.offsetMs, explicitDuration, clip.sourceInMs, clip.sourceOutMs)) {
      return rejected('invalid-clip', `Audio clip '${clip.id}' needs a positive finite source range or supplied duration.`);
    }
    result.push({ kind: 'audio', originKey: key, clip: cloneAudio(clip), durationMs: explicitDuration! });
  }
  return { ok: true, value: result };
}

function validateCommands(
  commands: readonly TimelineRippleDeleteCommand[],
): VideoTranscriptApplyResult<TimelineRippleDeleteCommand[]> {
  let previousStart = Number.POSITIVE_INFINITY;
  const normalized: TimelineRippleDeleteCommand[] = [];
  for (const [index, command] of commands.entries()) {
    if (command.kind !== 'ripple-delete' || command.source !== 'transcript'
      || !Number.isFinite(command.startMs) || !Number.isFinite(command.endMs)
      || command.startMs < 0 || command.endMs <= command.startMs
      || command.endMs > MAX_VIDEO_TRANSCRIPT_TIME_MS
      || Math.abs(command.durationMs - (command.endMs - command.startMs)) > 0.001
      || command.startMs >= previousStart) {
      return rejected('invalid-proposal', `Transcript ripple command ${index + 1} is invalid or not in descending timeline order.`);
    }
    previousStart = command.startMs;
    normalized.push({ ...command });
  }
  return { ok: true, value: normalized };
}

function validateAtomicMutation(
  clips: readonly WorkingClip[],
  mutations: ReadonlyMap<WorkingClip, MutationKind>,
  tracks: ReadonlyMap<string, VideoTranscriptApplyTrack>,
): VideoTranscriptApplyResult<true> {
  const linked = new Map<string, WorkingClip[]>();
  for (const item of clips) {
    const mutation = mutations.get(item) ?? 'none';
    if (mutation !== 'none') {
      const track = tracks.get(trackKey(item.kind, item.clip.trackIndex));
      if (!track) return rejected('missing-track', `${item.kind} track ${item.clip.trackIndex + 1} is missing from transcript apply state.`);
      if (track.locked) return rejected('locked-track', `Clip '${item.clip.id}' is on a locked ${item.kind} track.`);
    }
    const linkGroupId = item.clip.professional?.linkGroupId?.trim();
    if (linkGroupId) linked.set(linkGroupId, [...(linked.get(linkGroupId) ?? []), item]);
  }
  for (const [linkGroupId, members] of linked) {
    const kinds = new Set(members.map((member) => mutations.get(member) ?? 'none'));
    if (kinds.size > 1) {
      return rejected('linked-group-not-atomic', `Linked group '${linkGroupId}' would receive different transcript edit operations.`);
    }
  }
  return { ok: true, value: true };
}

function classifyMutation(item: WorkingClip, command: TimelineRippleDeleteCommand): MutationKind {
  const start = timelineStart(item);
  const end = start + item.durationMs;
  if (end <= command.startMs) return 'none';
  if (start >= command.endMs) return 'shift';
  if (command.startMs <= start && end <= command.endMs) return 'remove';
  if (start < command.startMs && end > command.endMs) return 'split';
  if (start < command.startMs) return 'trim-tail';
  return 'trim-head';
}

function transformWorkingClip(
  item: WorkingClip,
  command: TimelineRippleDeleteCommand,
  commandIndex: number,
  createSplitClipId: (context: VideoTranscriptSplitIdContext) => string,
): WorkingClip[] {
  const mutation = classifyMutation(item, command);
  const start = timelineStart(item);
  if (mutation === 'none') return [item];
  if (mutation === 'remove') return [];
  if (mutation === 'shift') return [withTimelineStart(item, start - command.durationMs)];
  if (mutation === 'trim-tail') return [sliceWorkingClip(item, 0, command.startMs - start, start, item.clip.id)];
  if (mutation === 'trim-head') {
    return [sliceWorkingClip(item, command.endMs - start, item.durationMs, command.startMs, item.clip.id)];
  }
  const left = sliceWorkingClip(item, 0, command.startMs - start, start, item.clip.id);
  const rightId = createSplitClipId({ kind: item.kind, originalClipId: item.clip.id, commandIndex, side: 'right' });
  const originalLink = item.clip.professional?.linkGroupId?.trim();
  const rightLink = originalLink ? `${originalLink}::transcript:${commandIndex}:right` : undefined;
  const right = sliceWorkingClip(item, command.endMs - start, item.durationMs, command.startMs, rightId, rightLink);
  return [left, right];
}

function sliceWorkingClip(
  item: WorkingClip,
  keepStartMs: number,
  keepEndMs: number,
  newTimelineStartMs: number,
  id: string,
  linkGroupId?: string,
): WorkingClip {
  const durationMs = keepEndMs - keepStartMs;
  if (item.kind === 'visual') {
    const sourceRate = Math.max(0.000001, Math.abs(item.clip.playbackRate || 1));
    const sourceIn = item.clip.sourceInMs;
    const sourceOut = item.clip.sourceOutMs ?? sourceIn + item.durationMs * sourceRate;
    const nextSourceIn = item.clip.reversePlayback ? sourceOut - keepEndMs * sourceRate : sourceIn + keepStartMs * sourceRate;
    const nextSourceOut = item.clip.reversePlayback ? sourceOut - keepStartMs * sourceRate : sourceIn + keepEndMs * sourceRate;
    const clip: EditorVisualClip = {
      ...item.clip,
      id,
      startMs: newTimelineStartMs,
      sourceInMs: nextSourceIn,
      sourceOutMs: nextSourceOut,
      durationSeconds: durationMs / 1_000,
      professional: withLinkGroup(item.clip.professional, linkGroupId),
    };
    return { kind: 'visual', originKey: item.originKey, clip, durationMs };
  }
  const sourceIn = item.clip.sourceInMs ?? 0;
  const clip: EditorAudioClip = {
    ...item.clip,
    id,
    offsetMs: newTimelineStartMs,
    sourceInMs: sourceIn + keepStartMs,
    sourceOutMs: sourceIn + keepEndMs,
    professional: withLinkGroup(item.clip.professional, linkGroupId),
  };
  return { kind: 'audio', originKey: item.originKey, clip, durationMs };
}

function withTimelineStart(item: WorkingClip, startMs: number): WorkingClip {
  return item.kind === 'visual'
    ? { ...item, clip: { ...item.clip, startMs } }
    : { ...item, clip: { ...item.clip, offsetMs: startMs } };
}

function withLinkGroup<T extends { linkGroupId?: string } | undefined>(professional: T, replacement?: string): T {
  if (replacement === undefined) return professional;
  return { ...(professional ?? {}), linkGroupId: replacement } as T;
}

function visualDurationMs(clip: EditorVisualClip): number {
  if (Number.isFinite(clip.durationSeconds) && (clip.durationSeconds ?? 0) > 0) return clip.durationSeconds! * 1_000;
  if (clip.sourceOutMs !== undefined && clip.sourceOutMs > clip.sourceInMs) {
    return (clip.sourceOutMs - clip.sourceInMs) / Math.max(0.000001, Math.abs(clip.playbackRate || 1));
  }
  return Number.NaN;
}

function isValidClipRange(startMs: number, durationMs: number | undefined, sourceInMs?: number, sourceOutMs?: number): boolean {
  return Number.isFinite(startMs) && startMs >= 0 && Number.isFinite(durationMs) && (durationMs ?? 0) > 0
    && startMs + (durationMs ?? 0) <= MAX_VIDEO_TRANSCRIPT_TIME_MS
    && (sourceInMs === undefined || (Number.isFinite(sourceInMs) && sourceInMs >= 0))
    && (sourceOutMs === undefined || (Number.isFinite(sourceOutMs) && sourceOutMs > (sourceInMs ?? -1)));
}

function buildTimelineSignature(visualClips: readonly EditorVisualClip[], audioClips: readonly EditorAudioClip[]): string {
  const material = [
    ...visualClips.map((clip) => ['visual', clip.id, clip.sourceNodeId, clip.trackIndex, clip.startMs, clip.sourceInMs, clip.sourceOutMs, clip.durationSeconds, clip.playbackRate, clip.reversePlayback, clip.professional?.linkGroupId]),
    ...audioClips.map((clip) => ['audio', clip.id, clip.sourceNodeId, clip.trackIndex, clip.offsetMs, clip.sourceInMs, clip.sourceOutMs, clip.professional?.linkGroupId]),
  ].sort((left, right) => String(left[0]).localeCompare(String(right[0])) || String(left[1]).localeCompare(String(right[1])));
  let hash = 0x811c9dc5;
  const text = JSON.stringify(material);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function cloneVisual(clip: EditorVisualClip): EditorVisualClip {
  return { ...clip, professional: clip.professional ? { ...clip.professional } : undefined };
}

function cloneAudio(clip: EditorAudioClip): EditorAudioClip {
  return { ...clip, professional: clip.professional ? { ...clip.professional } : undefined };
}

function timelineStart(item: WorkingClip): number {
  return item.kind === 'visual' ? item.clip.startMs : item.clip.offsetMs;
}

function clipKey(kind: VideoTranscriptClipKind, id: string): string {
  return `${kind}:${id}`;
}

function trackKey(kind: VideoTranscriptClipKind, index: number): string {
  return `${kind}:${index}`;
}

function defaultSplitClipId(context: VideoTranscriptSplitIdContext): string {
  return `${context.kind}:${context.originalClipId}:transcript:${context.commandIndex}:right`;
}

function compareWorkingClips(left: WorkingClip, right: WorkingClip): number {
  return timelineStart(left) - timelineStart(right) || left.clip.trackIndex - right.clip.trackIndex || left.clip.id.localeCompare(right.clip.id);
}

function compareVisualClips(left: EditorVisualClip, right: EditorVisualClip): number {
  return left.startMs - right.startMs || left.trackIndex - right.trackIndex || left.id.localeCompare(right.id);
}

function compareAudioClips(left: EditorAudioClip, right: EditorAudioClip): number {
  return left.offsetMs - right.offsetMs || left.trackIndex - right.trackIndex || left.id.localeCompare(right.id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Invalid transcript.';
}

function rejected<T>(reason: VideoTranscriptApplyRejectedReason, detail: string): VideoTranscriptApplyResult<T> {
  return { ok: false, reason, detail };
}
