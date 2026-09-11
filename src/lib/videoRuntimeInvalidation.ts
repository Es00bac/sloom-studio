import {
  hashVideoRuntimeIr,
  videoRuntimeRationalToMilliseconds,
  videoRuntimeTimeRangeToMilliseconds,
  type VideoRuntimeIr,
  type VideoRuntimeVisualClip,
} from './videoRuntimeIr';
import { sha256Hex } from '../shared/crypto/sha256';
import type { VideoRenderDirtyPlan, VideoRenderSegment } from './videoRenderSegments';

export interface VideoRuntimeInvalidationRange {
  startMs: number;
  endMs: number;
  reasons: string[];
  entityIds: string[];
}

export interface VideoRuntimeInvalidationPlan {
  previousRevision: string;
  nextRevision: string;
  ranges: VideoRuntimeInvalidationRange[];
  changedEntityIds: string[];
  totalDirtyDurationMs: number;
}

export interface VideoRuntimeNestedInvalidationInput {
  sequenceId: string;
  ranges: readonly Pick<VideoRuntimeInvalidationRange, 'startMs' | 'endMs'>[];
}

/**
 * Builds content-addressed cache spans directly from Runtime IR semantics. Unlike the legacy
 * visual-only planner, this includes audio, captions, stage objects, source fingerprints, worker
 * capabilities, and adjustment/target intersections in each span signature.
 */
export function buildVideoRuntimeRenderDirtyPlan(input: {
  ir: VideoRuntimeIr;
  previousSegmentSignatures: Readonly<Record<string, string>>;
  workerCapabilityFingerprint: string;
  forcedDirtyRanges?: readonly Pick<VideoRuntimeInvalidationRange, 'startMs' | 'endMs'>[];
}): VideoRenderDirtyPlan {
  const { ir } = input;
  const sequenceEndMs = Math.max(1, Math.round(sequenceDurationMs(ir)));
  const boundaries = new Set<number>([0, sequenceEndMs]);
  const addBoundaryRange = (range: VideoRuntimeTimeRangeLike): void => {
    boundaries.add(clampBoundary(range.startMs, sequenceEndMs));
    boundaries.add(clampBoundary(range.endMs, sequenceEndMs));
  };
  for (const clip of ir.visualClips) addBoundaryRange(videoRuntimeTimeRangeToMilliseconds(clip.activeRange));
  for (const clip of ir.audioClips) addBoundaryRange(videoRuntimeTimeRangeToMilliseconds(clip.recordRange));
  for (const track of ir.captionTracks) for (const cue of track.cues) addBoundaryRange(videoRuntimeTimeRangeToMilliseconds(cue.range));
  for (const range of input.forcedDirtyRanges ?? []) addBoundaryRange(range);

  const orderedBoundaries = [...boundaries].sort((left, right) => left - right);
  const sourceById = new Map(ir.sources.map((source) => [source.id, source]));
  const segments: VideoRenderSegment[] = [];
  for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
    const startMs = orderedBoundaries[index] ?? 0;
    const endMs = orderedBoundaries[index + 1] ?? startMs;
    if (endMs <= startMs) continue;
    const activeVisual = ir.visualClips.filter((clip) => runtimeVisualAffectsSpan(clip, ir, startMs, endMs));
    const activeAudio = ir.audioClips.filter((clip) => clip.enabled && rangeIntersects(clip.recordRange, startMs, endMs));
    const activeCues = ir.captionTracks.flatMap((track) => track.cues
      .filter((cue) => rangeIntersects(cue.range, startMs, endMs))
      .map((cue) => ({ trackId: track.id, cue })));
    const activeStageObjects = ir.stageObjects.filter((object) => rangeIntersects(object.activeRange, startMs, endMs));
    const activeSourceIds = [...new Set([
      ...activeVisual.map((clip) => clip.sourceId),
      ...activeAudio.map((clip) => clip.sourceId),
    ])].sort();
    const signaturePayload = {
      schema: `${ir.schema}@${ir.version}`,
      workerCapabilityFingerprint: input.workerCapabilityFingerprint,
      sequence: ir.sequence,
      startMs,
      endMs,
      sources: activeSourceIds.map((sourceId) => sourceById.get(sourceId)),
      visual: activeVisual,
      audio: activeAudio,
      captions: activeCues,
      stageObjects: activeStageObjects,
      audioBuses: activeAudio.length > 0 ? ir.audioBuses : [],
    };
    const signature = `video-runtime-segment-v1:${sha256Hex(new TextEncoder().encode(stableSerialize(signaturePayload)))}`;
    const key = `${startMs}-${endMs}`;
    const forcedDirty = (input.forcedDirtyRanges ?? []).some((range) => range.startMs < endMs && range.endMs > startMs);
    segments.push({
      key,
      startMs,
      endMs,
      activeClipIds: [
        ...activeVisual.map((clip) => clip.id),
        ...activeAudio.map((clip) => clip.id),
        ...activeCues.map(({ cue }) => cue.id),
        ...activeStageObjects.map((object) => object.id),
      ].sort(),
      signature,
      dirty: forcedDirty || input.previousSegmentSignatures[key] !== signature,
    });
  }
  return {
    segments,
    dirtySegments: segments.filter((segment) => segment.dirty),
    segmentSignatures: Object.fromEntries(segments.map((segment) => [segment.key, segment.signature])),
  };
}

/**
 * Computes timeline-local dirty ranges from two immutable IR revisions. Adjustment changes are
 * restricted to their intersections with lower visual tracks. Nested child ranges can be supplied
 * to project only the changed child spans through every parent reference instead of invalidating a
 * whole compound clip.
 */
export function diffVideoRuntimeIr(
  previous: VideoRuntimeIr,
  next: VideoRuntimeIr,
  options: { nestedInvalidations?: readonly VideoRuntimeNestedInvalidationInput[] } = {},
): VideoRuntimeInvalidationPlan {
  const ranges: VideoRuntimeInvalidationRange[] = [];
  const changedIds = new Set<string>();
  const nestedById = new Map(options.nestedInvalidations?.map((entry) => [entry.sequenceId, entry.ranges]) ?? []);

  if (stableSerialize(previous.sequence) !== stableSerialize(next.sequence)) {
    appendRange(ranges, 0, Math.max(sequenceDurationMs(previous), sequenceDurationMs(next)), 'sequence settings changed', next.sequence.id);
    changedIds.add(next.sequence.id);
  }

  diffSources(previous, next, ranges, changedIds);
  diffVisualClips(previous, next, nestedById, ranges, changedIds);
  diffAudioClips(previous, next, ranges, changedIds);
  diffCaptionTracks(previous, next, ranges, changedIds);
  diffStageObjects(previous, next, ranges, changedIds);

  if (stableSerialize(previous.audioBuses) !== stableSerialize(next.audioBuses)) {
    for (const clip of [...previous.audioClips, ...next.audioClips]) {
      const range = videoRuntimeTimeRangeToMilliseconds(clip.recordRange);
      appendRange(ranges, range.startMs, range.endMs, 'audio bus routing changed', clip.id);
      changedIds.add(clip.id);
    }
  }

  const merged = mergeVideoRuntimeInvalidationRanges(ranges);
  return {
    previousRevision: hashVideoRuntimeIr(previous),
    nextRevision: hashVideoRuntimeIr(next),
    ranges: merged,
    changedEntityIds: [...changedIds].sort(),
    totalDirtyDurationMs: merged.reduce((total, range) => total + range.endMs - range.startMs, 0),
  };
}

/** Projects child-sequence dirty ranges through every matching nested reference in a parent IR. */
export function projectVideoRuntimeNestedInvalidation(
  parent: VideoRuntimeIr,
  childSequenceId: string,
  childRanges: readonly Pick<VideoRuntimeInvalidationRange, 'startMs' | 'endMs'>[],
): VideoRuntimeInvalidationRange[] {
  const projected: VideoRuntimeInvalidationRange[] = [];
  const references = parent.visualClips.filter((clip) => clip.nestedSequenceId === childSequenceId);

  for (const reference of references) {
    const source = videoRuntimeTimeRangeToMilliseconds(reference.sourceRange);
    const record = videoRuntimeTimeRangeToMilliseconds(reference.recordRange);
    if (source.durationMs <= 0 || record.durationMs <= 0) continue;

    for (const dirty of childRanges) {
      const childStart = Math.max(source.startMs, dirty.startMs);
      const childEnd = Math.min(source.endMs, dirty.endMs);
      if (childEnd <= childStart) continue;

      const scale = record.durationMs / source.durationMs;
      const mappedStart = reference.playback.reverse
        ? record.startMs + (source.endMs - childEnd) * scale
        : record.startMs + (childStart - source.startMs) * scale;
      const mappedEnd = reference.playback.reverse
        ? record.startMs + (source.endMs - childStart) * scale
        : record.startMs + (childEnd - source.startMs) * scale;
      let startMs = Math.floor(Math.min(mappedStart, mappedEnd));
      const endMs = Math.ceil(Math.max(mappedStart, mappedEnd));

      // An incoming edit-point dissolve samples the first nested frames during pre-roll.
      if (reference.transitions.editPointDissolve && childStart <= source.startMs) {
        startMs = Math.min(startMs, Math.floor(videoRuntimeTimeRangeToMilliseconds(reference.activeRange).startMs));
      }
      appendRange(projected, startMs, endMs, `nested sequence '${childSequenceId}' changed`, reference.id);
    }
  }

  return mergeVideoRuntimeInvalidationRanges(projected);
}

export function mergeVideoRuntimeInvalidationRanges(
  input: readonly VideoRuntimeInvalidationRange[],
): VideoRuntimeInvalidationRange[] {
  const sorted = input
    .filter((range) => Number.isFinite(range.startMs) && Number.isFinite(range.endMs) && range.endMs > range.startMs)
    .map((range) => ({
      startMs: Math.max(0, Math.floor(range.startMs)),
      endMs: Math.max(0, Math.ceil(range.endMs)),
      reasons: [...new Set(range.reasons)].sort(),
      entityIds: [...new Set(range.entityIds)].sort(),
    }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const result: VideoRuntimeInvalidationRange[] = [];

  for (const range of sorted) {
    const previous = result.at(-1);
    if (!previous || range.startMs > previous.endMs) {
      result.push(range);
      continue;
    }
    previous.endMs = Math.max(previous.endMs, range.endMs);
    previous.reasons = [...new Set([...previous.reasons, ...range.reasons])].sort();
    previous.entityIds = [...new Set([...previous.entityIds, ...range.entityIds])].sort();
  }
  return result;
}

function diffSources(
  previous: VideoRuntimeIr,
  next: VideoRuntimeIr,
  ranges: VideoRuntimeInvalidationRange[],
  changedIds: Set<string>,
): void {
  const previousById = new Map(previous.sources.map((source) => [source.id, source]));
  const nextById = new Map(next.sources.map((source) => [source.id, source]));
  for (const sourceId of new Set([...previousById.keys(), ...nextById.keys()])) {
    if (stableSerialize(previousById.get(sourceId)) === stableSerialize(nextById.get(sourceId))) continue;
    const visual = [...previous.visualClips, ...next.visualClips].filter((clip) => clip.sourceId === sourceId);
    const audio = [...previous.audioClips, ...next.audioClips].filter((clip) => clip.sourceId === sourceId);
    for (const clip of visual) {
      for (const range of affectedVisualRanges(clip, clipInIr(clip, next) ? next : previous)) {
        appendRange(ranges, range.startMs, range.endMs, `source '${sourceId}' changed`, clip.id);
      }
      changedIds.add(clip.id);
    }
    for (const clip of audio) {
      const range = videoRuntimeTimeRangeToMilliseconds(clip.recordRange);
      appendRange(ranges, range.startMs, range.endMs, `source '${sourceId}' changed`, clip.id);
      changedIds.add(clip.id);
    }
    changedIds.add(sourceId);
  }
}

function diffVisualClips(
  previous: VideoRuntimeIr,
  next: VideoRuntimeIr,
  nestedById: ReadonlyMap<string, readonly Pick<VideoRuntimeInvalidationRange, 'startMs' | 'endMs'>[]>,
  ranges: VideoRuntimeInvalidationRange[],
  changedIds: Set<string>,
): void {
  const previousById = new Map(previous.visualClips.map((clip) => [clip.id, clip]));
  const nextById = new Map(next.visualClips.map((clip) => [clip.id, clip]));
  for (const clipId of new Set([...previousById.keys(), ...nextById.keys()])) {
    const oldClip = previousById.get(clipId);
    const newClip = nextById.get(clipId);
    if (stableSerialize(oldClip) === stableSerialize(newClip)) continue;
    changedIds.add(clipId);

    const nestedId = newClip?.nestedSequenceId ?? oldClip?.nestedSequenceId;
    const childRanges = nestedId ? nestedById.get(nestedId) : undefined;
    if (nestedId && childRanges && oldClip && newClip && sameReferencePlacement(oldClip, newClip)) {
      for (const range of projectVideoRuntimeNestedInvalidation(next, nestedId, childRanges)) ranges.push(range);
      continue;
    }
    if (oldClip) {
      for (const range of affectedVisualRanges(oldClip, previous)) {
        appendRange(ranges, range.startMs, range.endMs, 'visual clip changed', clipId);
      }
    }
    if (newClip) {
      for (const range of affectedVisualRanges(newClip, next)) {
        appendRange(ranges, range.startMs, range.endMs, 'visual clip changed', clipId);
      }
    }
  }
}

function diffAudioClips(
  previous: VideoRuntimeIr,
  next: VideoRuntimeIr,
  ranges: VideoRuntimeInvalidationRange[],
  changedIds: Set<string>,
): void {
  const previousById = new Map(previous.audioClips.map((clip) => [clip.id, clip]));
  const nextById = new Map(next.audioClips.map((clip) => [clip.id, clip]));
  for (const clipId of new Set([...previousById.keys(), ...nextById.keys()])) {
    const oldClip = previousById.get(clipId);
    const newClip = nextById.get(clipId);
    if (stableSerialize(oldClip) === stableSerialize(newClip)) continue;
    changedIds.add(clipId);
    for (const clip of [oldClip, newClip]) {
      if (!clip) continue;
      const range = videoRuntimeTimeRangeToMilliseconds(clip.recordRange);
      appendRange(ranges, range.startMs, range.endMs, 'audio clip changed', clipId);
    }
  }
}

function diffCaptionTracks(
  previous: VideoRuntimeIr,
  next: VideoRuntimeIr,
  ranges: VideoRuntimeInvalidationRange[],
  changedIds: Set<string>,
): void {
  const previousById = new Map(previous.captionTracks.map((track) => [track.id, track]));
  const nextById = new Map(next.captionTracks.map((track) => [track.id, track]));
  for (const trackId of new Set([...previousById.keys(), ...nextById.keys()])) {
    const oldTrack = previousById.get(trackId);
    const newTrack = nextById.get(trackId);
    if (stableSerialize(oldTrack) === stableSerialize(newTrack)) continue;
    changedIds.add(trackId);
    const oldCueById = new Map(oldTrack?.cues.map((cue) => [cue.id, cue]) ?? []);
    const newCueById = new Map(newTrack?.cues.map((cue) => [cue.id, cue]) ?? []);
    const styleChanged = stableSerialize(oldTrack?.style) !== stableSerialize(newTrack?.style);
    for (const cueId of new Set([...oldCueById.keys(), ...newCueById.keys()])) {
      const oldCue = oldCueById.get(cueId);
      const newCue = newCueById.get(cueId);
      if (!styleChanged && stableSerialize(oldCue) === stableSerialize(newCue)) continue;
      changedIds.add(cueId);
      for (const cue of [oldCue, newCue]) {
        if (!cue) continue;
        const range = videoRuntimeTimeRangeToMilliseconds(cue.range);
        appendRange(ranges, range.startMs, range.endMs, 'caption changed', cueId);
      }
    }
  }
}

function diffStageObjects(
  previous: VideoRuntimeIr,
  next: VideoRuntimeIr,
  ranges: VideoRuntimeInvalidationRange[],
  changedIds: Set<string>,
): void {
  const previousById = new Map(previous.stageObjects.map((object) => [object.id, object]));
  const nextById = new Map(next.stageObjects.map((object) => [object.id, object]));
  for (const objectId of new Set([...previousById.keys(), ...nextById.keys()])) {
    const oldObject = previousById.get(objectId);
    const newObject = nextById.get(objectId);
    if (stableSerialize(oldObject) === stableSerialize(newObject)) continue;
    changedIds.add(objectId);
    for (const object of [oldObject, newObject]) {
      if (!object) continue;
      const range = videoRuntimeTimeRangeToMilliseconds(object.activeRange);
      appendRange(ranges, range.startMs, range.endMs, 'stage object changed', objectId);
    }
  }
}

function affectedVisualRanges(clip: VideoRuntimeVisualClip, ir: VideoRuntimeIr): Array<{ startMs: number; endMs: number }> {
  if (clip.role !== 'adjustment') {
    const range = videoRuntimeTimeRangeToMilliseconds(clip.activeRange);
    return [{ startMs: range.startMs, endMs: range.endMs }];
  }
  const adjustment = videoRuntimeTimeRangeToMilliseconds(clip.activeRange);
  return ir.visualClips.flatMap((target): Array<{ startMs: number; endMs: number }> => {
    if (target.id === clip.id || target.role === 'adjustment' || target.trackOrder >= clip.trackOrder) return [];
    const targetRange = videoRuntimeTimeRangeToMilliseconds(target.activeRange);
    const startMs = Math.max(adjustment.startMs, targetRange.startMs);
    const endMs = Math.min(adjustment.endMs, targetRange.endMs);
    return endMs > startMs ? [{ startMs, endMs }] : [];
  });
}

interface VideoRuntimeTimeRangeLike {
  startMs: number;
  endMs: number;
}

function runtimeVisualAffectsSpan(
  clip: VideoRuntimeVisualClip,
  ir: VideoRuntimeIr,
  startMs: number,
  endMs: number,
): boolean {
  if (!rangeIntersects(clip.activeRange, startMs, endMs)) return false;
  if (clip.role !== 'adjustment') return true;
  return ir.visualClips.some((target) => (
    target.id !== clip.id
    && target.role !== 'adjustment'
    && target.trackOrder < clip.trackOrder
    && rangeIntersects(target.activeRange, startMs, endMs)
  ));
}

function rangeIntersects(range: { start: { numerator: number; denominator: number }; duration: { numerator: number; denominator: number } }, startMs: number, endMs: number): boolean {
  const resolved = videoRuntimeTimeRangeToMilliseconds(range);
  return resolved.startMs < endMs && resolved.endMs > startMs;
}

function clampBoundary(value: number, sequenceEndMs: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(sequenceEndMs, Math.round(value)));
}

function sameReferencePlacement(left: VideoRuntimeVisualClip, right: VideoRuntimeVisualClip): boolean {
  const omitRevision = (clip: VideoRuntimeVisualClip) => ({
    ...clip,
    nestedRevision: undefined,
    requiredCapabilities: [...clip.requiredCapabilities],
  });
  return stableSerialize(omitRevision(left)) === stableSerialize(omitRevision(right));
}

function clipInIr(clip: VideoRuntimeVisualClip, ir: VideoRuntimeIr): boolean {
  return ir.visualClips.some((candidate) => candidate === clip);
}

function sequenceDurationMs(ir: VideoRuntimeIr): number {
  return videoRuntimeRationalToMilliseconds(ir.sequence.duration);
}

function appendRange(
  ranges: VideoRuntimeInvalidationRange[],
  startMs: number,
  endMs: number,
  reason: string,
  entityId: string,
): void {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
  ranges.push({ startMs, endMs, reasons: [reason], entityIds: [entityId] });
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
