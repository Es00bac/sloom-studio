/** Deterministic multicamera synchronization and cut-flattening primitives. */

export const MAX_MULTICAM_ANGLES = 64;
export const MAX_LIVE_MULTICAM_ANGLES = 16;
export const MAX_AUDIO_SYNC_LAG_FRAMES = 900;
/** Ten minutes at 30 envelope samples/sec; keeps worst-case correlation work bounded. */
export const MAX_AUDIO_ENVELOPE_FRAMES = 18_000;

export interface MulticamAngle {
  id: string;
  label: string;
  sourceId: string;
  durationFrames: number;
  timecodeStartFrame?: number;
  /** Timeline frame at which source frame zero occurs. Negative values trim the source head. */
  syncOffsetFrames: number;
  audioEnvelope?: readonly number[];
}

export interface MulticamAngleCut {
  id: string;
  timelineFrame: number;
  angleId: string;
}

export interface MulticamSequence {
  id: string;
  frameRate: number;
  durationFrames: number;
  angles: MulticamAngle[];
  cuts: MulticamAngleCut[];
}

export type MulticamSyncMode = 'manual' | 'timecode' | 'audio-envelope';

export interface AudioEnvelopeCorrelationResult {
  lagFrames: number;
  /** Offset to assign to the target angle under the MulticamAngle convention. */
  targetSyncOffsetFrames: number;
  score: number;
  comparedFrames: number;
}

export interface MulticamSyncResult {
  mode: MulticamSyncMode;
  angles: MulticamAngle[];
  referenceAngleId?: string;
  diagnostics: Array<{ angleId: string; offsetFrames: number; score?: number }>;
}

export interface FlattenedMulticamClip {
  id: string;
  sourceId: string;
  angleId: string;
  trackId: string;
  startFrame: number;
  durationFrames: number;
  sourceInFrame: number;
}

export interface MulticamLiveAnglePolicy {
  requestedAngleCount: number;
  liveAngleCount: number;
  mode: 'full-resolution' | 'proxy-grid' | 'thumbnail-grid' | 'select-live-angles';
  requiresProxies: boolean;
  message: string;
}

function cloneAngle(angle: MulticamAngle): MulticamAngle {
  return { ...angle, audioEnvelope: angle.audioEnvelope ? [...angle.audioEnvelope] : undefined };
}

function normalizedCorrelation(
  reference: readonly number[],
  target: readonly number[],
  lag: number,
): { score: number; comparedFrames: number } {
  const startReference = Math.max(0, -lag);
  const endReference = Math.min(reference.length, target.length - lag);
  const comparedFrames = Math.max(0, endReference - startReference);
  if (comparedFrames < 3) return { score: Number.NEGATIVE_INFINITY, comparedFrames };
  let referenceMean = 0;
  let targetMean = 0;
  for (let index = startReference; index < endReference; index += 1) {
    referenceMean += reference[index] ?? 0;
    targetMean += target[index + lag] ?? 0;
  }
  referenceMean /= comparedFrames;
  targetMean /= comparedFrames;
  let numerator = 0;
  let referenceEnergy = 0;
  let targetEnergy = 0;
  for (let index = startReference; index < endReference; index += 1) {
    const referenceValue = (reference[index] ?? 0) - referenceMean;
    const targetValue = (target[index + lag] ?? 0) - targetMean;
    numerator += referenceValue * targetValue;
    referenceEnergy += referenceValue * referenceValue;
    targetEnergy += targetValue * targetValue;
  }
  const denominator = Math.sqrt(referenceEnergy * targetEnergy);
  return { score: denominator > 1e-12 ? numerator / denominator : 0, comparedFrames };
}

/**
 * Correlates bounded, frame-rate audio envelopes. Positive lag means the matching target content
 * appears later than the reference, so its source head must be trimmed (`syncOffset = -lag`).
 */
export function correlateMulticamAudioEnvelopes(
  referenceInput: readonly number[],
  targetInput: readonly number[],
  requestedMaxLagFrames = MAX_AUDIO_SYNC_LAG_FRAMES,
): AudioEnvelopeCorrelationResult {
  const reference = referenceInput.slice(0, MAX_AUDIO_ENVELOPE_FRAMES);
  const target = targetInput.slice(0, MAX_AUDIO_ENVELOPE_FRAMES);
  if (reference.length < 3 || target.length < 3) throw new Error('Audio synchronization requires at least three envelope frames per angle.');
  const maxLagFrames = Math.max(0, Math.min(
    MAX_AUDIO_SYNC_LAG_FRAMES,
    Math.floor(requestedMaxLagFrames),
    reference.length - 3,
    target.length - 3,
  ));
  let best: AudioEnvelopeCorrelationResult = {
    lagFrames: 0,
    targetSyncOffsetFrames: 0,
    score: Number.NEGATIVE_INFINITY,
    comparedFrames: 0,
  };
  for (let lag = -maxLagFrames; lag <= maxLagFrames; lag += 1) {
    const candidate = normalizedCorrelation(reference, target, lag);
    const betterScore = candidate.score > best.score + 1e-12;
    const tieBreak = Math.abs(candidate.score - best.score) <= 1e-12
      && (Math.abs(lag) < Math.abs(best.lagFrames) || (Math.abs(lag) === Math.abs(best.lagFrames) && lag < best.lagFrames));
    if (betterScore || tieBreak) {
      best = {
        lagFrames: lag,
        targetSyncOffsetFrames: -lag,
        score: candidate.score,
        comparedFrames: candidate.comparedFrames,
      };
    }
  }
  return best;
}

export function synchronizeMulticamAnglesManual(
  angles: readonly MulticamAngle[],
  offsetsByAngleId: Readonly<Record<string, number>>,
): MulticamSyncResult {
  const synchronized = angles.map((angle) => ({
    ...cloneAngle(angle),
    syncOffsetFrames: Number.isFinite(offsetsByAngleId[angle.id])
      ? Math.round(offsetsByAngleId[angle.id] ?? angle.syncOffsetFrames)
      : angle.syncOffsetFrames,
  }));
  return {
    mode: 'manual',
    angles: synchronized,
    diagnostics: synchronized.map((angle) => ({ angleId: angle.id, offsetFrames: angle.syncOffsetFrames })),
  };
}

export function synchronizeMulticamAnglesByTimecode(angles: readonly MulticamAngle[]): MulticamSyncResult {
  const timecodes = angles.map((angle) => angle.timecodeStartFrame).filter((value): value is number => Number.isFinite(value));
  if (timecodes.length !== angles.length) throw new Error('Every multicam angle needs a timecode start frame.');
  const origin = Math.min(...timecodes);
  const synchronized = angles.map((angle) => ({
    ...cloneAngle(angle),
    syncOffsetFrames: Math.round((angle.timecodeStartFrame ?? origin) - origin),
  }));
  return {
    mode: 'timecode',
    angles: synchronized,
    diagnostics: synchronized.map((angle) => ({ angleId: angle.id, offsetFrames: angle.syncOffsetFrames })),
  };
}

export function synchronizeMulticamAnglesByAudio(
  angles: readonly MulticamAngle[],
  referenceAngleId = angles[0]?.id,
  maxLagFrames = MAX_AUDIO_SYNC_LAG_FRAMES,
): MulticamSyncResult {
  const reference = angles.find((angle) => angle.id === referenceAngleId);
  if (!reference?.audioEnvelope) throw new Error('The reference angle needs an audio envelope.');
  // Preserve the narrowing across the Array.map callback; the interface property itself remains
  // optional because not every imported angle is required to carry an analysis envelope.
  const referenceEnvelope = reference.audioEnvelope;
  const diagnostics: MulticamSyncResult['diagnostics'] = [];
  const synchronized = angles.map((angle) => {
    if (angle.id === reference.id) {
      diagnostics.push({ angleId: angle.id, offsetFrames: 0, score: 1 });
      return { ...cloneAngle(angle), syncOffsetFrames: 0 };
    }
    if (!angle.audioEnvelope) throw new Error(`Angle ${angle.id} needs an audio envelope.`);
    const correlation = correlateMulticamAudioEnvelopes(referenceEnvelope, angle.audioEnvelope, maxLagFrames);
    diagnostics.push({ angleId: angle.id, offsetFrames: correlation.targetSyncOffsetFrames, score: correlation.score });
    return { ...cloneAngle(angle), syncOffsetFrames: correlation.targetSyncOffsetFrames };
  });
  return { mode: 'audio-envelope', angles: synchronized, referenceAngleId: reference.id, diagnostics };
}

function normalizedCuts(sequence: MulticamSequence): MulticamAngleCut[] {
  const angleIds = new Set(sequence.angles.map((angle) => angle.id));
  const byFrame = new Map<number, MulticamAngleCut>();
  [...sequence.cuts]
    .filter((cut) => angleIds.has(cut.angleId) && Number.isInteger(cut.timelineFrame) && cut.timelineFrame >= 0 && cut.timelineFrame < sequence.durationFrames)
    .sort((left, right) => left.timelineFrame - right.timelineFrame || left.id.localeCompare(right.id))
    .forEach((cut) => byFrame.set(cut.timelineFrame, { ...cut }));
  const cuts = [...byFrame.values()].sort((left, right) => left.timelineFrame - right.timelineFrame || left.id.localeCompare(right.id));
  if (cuts.length === 0 && sequence.angles[0]) cuts.push({ id: `${sequence.id}-cut-0`, timelineFrame: 0, angleId: sequence.angles[0].id });
  if (cuts.length > 0 && cuts[0].timelineFrame > 0) cuts.unshift({ id: `${sequence.id}-cut-0`, timelineFrame: 0, angleId: cuts[0].angleId });
  return cuts.filter((cut, index) => index === 0 || cuts[index - 1]?.angleId !== cut.angleId);
}

export function getActiveMulticamAngleId(sequence: MulticamSequence, timelineFrame: number): string | undefined {
  const frame = Math.max(0, Math.min(sequence.durationFrames - 1, Math.floor(timelineFrame)));
  return normalizedCuts(sequence).filter((cut) => cut.timelineFrame <= frame).at(-1)?.angleId;
}

export function recordMulticamAngleCut(
  sequence: MulticamSequence,
  timelineFrame: number,
  angleId: string,
  cutId = `${sequence.id}-cut-${Math.floor(timelineFrame)}-${angleId}`,
): MulticamSequence {
  if (!sequence.angles.some((angle) => angle.id === angleId)) throw new Error(`Unknown multicam angle: ${angleId}`);
  const frame = Math.max(0, Math.min(sequence.durationFrames - 1, Math.floor(timelineFrame)));
  const cuts = [...sequence.cuts.filter((cut) => cut.timelineFrame !== frame), { id: cutId, timelineFrame: frame, angleId }];
  return { ...sequence, angles: sequence.angles.map(cloneAngle), cuts: normalizedCuts({ ...sequence, cuts }) };
}

export function splitMulticamAngleCut(
  sequence: MulticamSequence,
  timelineFrame: number,
  angleId: string,
): MulticamSequence {
  return recordMulticamAngleCut(sequence, timelineFrame, angleId);
}

export function flattenMulticamSequence(sequence: MulticamSequence, trackId: string): FlattenedMulticamClip[] {
  const angleById = new Map(sequence.angles.map((angle) => [angle.id, angle]));
  const cuts = normalizedCuts(sequence);
  return cuts.flatMap((cut, index): FlattenedMulticamClip[] => {
    const angle = angleById.get(cut.angleId);
    if (!angle) return [];
    const segmentEnd = cuts[index + 1]?.timelineFrame ?? sequence.durationFrames;
    const startFrame = Math.max(cut.timelineFrame, angle.syncOffsetFrames);
    const sourceInFrame = Math.max(0, startFrame - angle.syncOffsetFrames);
    const availableEnd = startFrame + Math.max(0, angle.durationFrames - sourceInFrame);
    const endFrame = Math.min(segmentEnd, availableEnd);
    if (endFrame <= startFrame) return [];
    return [{
      id: `${sequence.id}:${cut.id}`,
      sourceId: angle.sourceId,
      angleId: angle.id,
      trackId,
      startFrame,
      durationFrames: endFrame - startFrame,
      sourceInFrame,
    }];
  });
}

export function describeMulticamLiveAnglePolicy(requestedAngleCount: number): MulticamLiveAnglePolicy {
  const count = Math.max(0, Math.min(MAX_MULTICAM_ANGLES, Math.floor(requestedAngleCount)));
  if (count <= 4) return { requestedAngleCount: count, liveAngleCount: count, mode: 'full-resolution', requiresProxies: false, message: 'Up to four angles can preview at full resolution.' };
  if (count <= 9) return { requestedAngleCount: count, liveAngleCount: count, mode: 'proxy-grid', requiresProxies: true, message: 'Five to nine live angles use proxy playback.' };
  if (count <= MAX_LIVE_MULTICAM_ANGLES) return { requestedAngleCount: count, liveAngleCount: count, mode: 'thumbnail-grid', requiresProxies: true, message: 'Ten to sixteen angles use a bounded thumbnail grid and proxy playback.' };
  return { requestedAngleCount: count, liveAngleCount: MAX_LIVE_MULTICAM_ANGLES, mode: 'select-live-angles', requiresProxies: true, message: `Select ${MAX_LIVE_MULTICAM_ANGLES} live angles; remaining angles stay available but do not decode concurrently.` };
}
