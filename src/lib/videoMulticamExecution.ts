import type { EditorVisualClip } from '../types/flow';
import type { EditorProfessionalVideoState, ProfessionalMulticamSource } from '../types/videoProfessional';
import type { VideoRuntimeResolvedVisualClip } from './videoRuntimeNestedExecution';

export const MAX_EXECUTABLE_MULTICAM_ANGLES = 4;
export const MAX_EXECUTABLE_MULTICAM_CUTS = 1_000;
export const MAX_EXECUTABLE_MULTICAM_SEGMENTS = 1_024;

export type MulticamProjectionResult<TClip extends EditorVisualClip = EditorVisualClip> =
  | { ok: true; clips: TClip[] }
  | { ok: false; message: string };

interface NormalizedCut {
  id: string;
  timelineMs: number;
  angleSourceId: string;
}

function hostDurationMs(clip: EditorVisualClip): number | undefined {
  if (!Number.isFinite(clip.playbackRate) || clip.playbackRate !== 1 || clip.reversePlayback) return undefined;
  if (Number.isFinite(clip.sourceOutMs)) return Math.max(0, (clip.sourceOutMs ?? 0) - clip.sourceInMs);
  if (Number.isFinite(clip.durationSeconds) && (clip.durationSeconds ?? 0) > 0) {
    return Math.round((clip.durationSeconds ?? 0) * 1_000);
  }
  return undefined;
}

function validateSource(
  source: ProfessionalMulticamSource,
  availableSourceIds: ReadonlySet<string>,
  executableAngleSourceIds: ReadonlySet<string>,
): string | undefined {
  const ids = source.angleSourceIds;
  if (ids.length < 2 || ids.length > MAX_EXECUTABLE_MULTICAM_ANGLES) {
    return `Multicam “${source.name}” must contain two to four unique resolved angles.`;
  }
  if (new Set(ids).size !== ids.length) return `Multicam “${source.name}” contains duplicate angles.`;
  if (ids.some((id) => !availableSourceIds.has(id))) return `Multicam “${source.name}” references an unavailable angle.`;
  if (ids.some((id) => !executableAngleSourceIds.has(id))) return `Multicam “${source.name}” references an unsupported non-video angle.`;
  if (source.audioFollowsVideo) return `Multicam “${source.name}” requests audio-follow-video, which is unavailable for this bounded video-only route.`;
  return undefined;
}

function normalizedCuts(source: ProfessionalMulticamSource, durationMs: number): NormalizedCut[] | string {
  const activeAngleId = source.activeAngleId ?? source.angleSourceIds[0];
  if (!activeAngleId || !source.angleSourceIds.includes(activeAngleId)) {
    return `Multicam “${source.name}” has no valid active angle.`;
  }
  const input = source.cuts?.length
    ? source.cuts
    : [{ id: 'opening', timelineMs: 0, angleSourceId: activeAngleId }];
  if (input.length > MAX_EXECUTABLE_MULTICAM_CUTS) return `Multicam “${source.name}” exceeds the ${MAX_EXECUTABLE_MULTICAM_CUTS}-cut bound.`;
  const seenIds = new Set<string>();
  const seenTimes = new Set<number>();
  const cuts: NormalizedCut[] = [];
  for (const cut of input) {
    if (!cut.id || seenIds.has(cut.id) || seenTimes.has(cut.timelineMs) || !Number.isInteger(cut.timelineMs)
      || cut.timelineMs < 0 || cut.timelineMs >= durationMs || !source.angleSourceIds.includes(cut.angleSourceId)) {
      return `Multicam “${source.name}” has an invalid cut record.`;
    }
    seenIds.add(cut.id);
    seenTimes.add(cut.timelineMs);
    cuts.push({ id: cut.id, timelineMs: cut.timelineMs, angleSourceId: cut.angleSourceId });
  }
  cuts.sort((left, right) => left.timelineMs - right.timelineMs || left.id.localeCompare(right.id));
  if (cuts[0]?.timelineMs !== 0) return `Multicam “${source.name}” must start with a cut at 0 ms.`;
  return cuts;
}

/**
 * Replaces an explicitly attached host clip with ordinary source clips. The resulting clips keep
 * the host's effects/masks and are deliberately safe only for normal-speed, forward playback.
 * Projection mutates the coordinates but preserves every Runtime IR field; the overload makes
 * role/path diagnostics impossible to lose at this composition boundary.
 */
export function projectExecutableMulticamClips(
  clips: readonly VideoRuntimeResolvedVisualClip[],
  state: EditorProfessionalVideoState | undefined,
  availableSourceIds: ReadonlySet<string>,
  executableAngleSourceIds?: ReadonlySet<string>,
): MulticamProjectionResult<VideoRuntimeResolvedVisualClip>;
export function projectExecutableMulticamClips(
  clips: readonly EditorVisualClip[],
  state: EditorProfessionalVideoState | undefined,
  availableSourceIds: ReadonlySet<string>,
  executableAngleSourceIds?: ReadonlySet<string>,
): MulticamProjectionResult;
export function projectExecutableMulticamClips(
  clips: readonly EditorVisualClip[],
  state: EditorProfessionalVideoState | undefined,
  availableSourceIds: ReadonlySet<string>,
  executableAngleSourceIds: ReadonlySet<string> = availableSourceIds,
): MulticamProjectionResult {
  const sources = new Map((state?.multicamSources ?? []).map((source) => [source.id, source]));
  const output: EditorVisualClip[] = [];
  for (const clip of clips) {
    const sourceId = clip.professional?.multicamSourceId;
    if (!sourceId) {
      output.push(clip);
      continue;
    }
    const source = sources.get(sourceId);
    if (!source) return { ok: false, message: 'This clip references a missing multicam source.' };
    const sourceError = validateSource(source, availableSourceIds, executableAngleSourceIds);
    if (sourceError) return { ok: false, message: sourceError };
    const durationMs = hostDurationMs(clip);
    if (!durationMs) return { ok: false, message: `Multicam host “${clip.id}” must use a finite normal-speed forward range.` };
    const cuts = normalizedCuts(source, durationMs);
    if (typeof cuts === 'string') return { ok: false, message: cuts };
    if (output.length + cuts.length > MAX_EXECUTABLE_MULTICAM_SEGMENTS) {
      return { ok: false, message: `Multicam projection exceeds the ${MAX_EXECUTABLE_MULTICAM_SEGMENTS}-segment resource bound.` };
    }
    cuts.forEach((cut, index) => {
      const endMs = cuts[index + 1]?.timelineMs ?? durationMs;
      const segmentDurationMs = endMs - cut.timelineMs;
      if (segmentDurationMs <= 0) return;
      output.push({
        ...clip,
        id: `${clip.id}:multicam:${cut.id}`,
        sourceNodeId: cut.angleSourceId,
        startMs: clip.startMs + cut.timelineMs,
        sourceInMs: clip.sourceInMs + cut.timelineMs,
        sourceOutMs: clip.sourceInMs + endMs,
        durationSeconds: segmentDurationMs / 1_000,
        trimStartMs: 0,
        trimEndMs: 0,
        transitionIn: index === 0 ? clip.transitionIn : 'none',
        transitionOut: index === cuts.length - 1 ? clip.transitionOut : 'none',
        professional: clip.professional ? {
          ...clip.professional,
          multicamSourceId: undefined,
          multicamAngleId: cut.angleSourceId,
        } : undefined,
      });
    });
  }
  return { ok: true, clips: output };
}
