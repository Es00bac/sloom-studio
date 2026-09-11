import {
  getAutomationValueAtProgress,
  normalizeAutomationPoints,
} from './clipAutomation';
import type {
  EditorAudioClip,
  EditorAudioKeyframe,
  EditorVisualClip,
  EditorVisualKeyframe,
  TimelineAutomationPoint,
} from '../types/flow';

const KEYFRAME_EPSILON_PERCENT = 0.001;

type VisualKeyframeCandidate = Partial<EditorVisualKeyframe> & { timePercent?: number };
type AudioKeyframeCandidate = Partial<EditorAudioKeyframe> & { timePercent?: number };
export type VisualKeyframeClip = Pick<
  EditorVisualClip,
  | 'positionX'
  | 'positionY'
  | 'motionEnabled'
  | 'endPositionX'
  | 'endPositionY'
  | 'scalePercent'
  | 'scaleMotionEnabled'
  | 'endScalePercent'
  | 'rotationDeg'
  | 'rotationMotionEnabled'
  | 'endRotationDeg'
  | 'opacityPercent'
  | 'opacityAutomationPoints'
  | 'keyframes'
  | 'comicTailTipXPercent'
  | 'comicTailTipYPercent'
  | 'comicTailCurvePercent'
>;
type AudioKeyframeClip = Pick<
  EditorAudioClip,
  'volumePercent' | 'volumeAutomationPoints' | 'volumeKeyframes'
>;

export function normalizeVisualKeyframes(clip: VisualKeyframeClip): EditorVisualKeyframe[] {
  const candidates: EditorVisualKeyframe[] = [
    getLegacyVisualStateAtProgress(clip, 0),
    getLegacyVisualStateAtProgress(clip, 100),
  ];
  const explicitKeyframes: EditorVisualKeyframe[] = [];

  for (const keyframe of clip.keyframes ?? []) {
    if (!isRecord(keyframe)) {
      continue;
    }

    const timePercent = normalizeTimePercent(keyframe.timePercent, 0);
    explicitKeyframes.push(normalizeVisualKeyframeCandidate(keyframe, getLegacyVisualStateAtProgress(clip, timePercent)));
  }

  if (explicitKeyframes.length > 0) {
    candidates.push(...explicitKeyframes);
  } else {
    for (const point of clip.opacityAutomationPoints ?? []) {
      candidates.push(getLegacyVisualStateAtProgress(clip, point.timePercent));
    }
  }

  return dedupeVisualKeyframes(candidates).sort((left, right) => left.timePercent - right.timePercent);
}

export function getVisualKeyframeStateAtProgress(
  clip: VisualKeyframeClip,
  progressPercent: number,
): EditorVisualKeyframe {
  const keyframes = normalizeVisualKeyframes(clip);
  const progress = normalizeTimePercent(progressPercent, 0);

  for (let index = 1; index < keyframes.length; index += 1) {
    const start = keyframes[index - 1];
    const end = keyframes[index];

    if (progress <= end.timePercent) {
      return interpolateVisualKeyframes(start, end, progress);
    }
  }

  return {
    ...(keyframes[keyframes.length - 1] ?? getLegacyVisualStateAtProgress(clip, progress)),
    timePercent: progress,
  };
}

export function upsertVisualKeyframe(
  clip: EditorVisualClip,
  progressPercent: number,
  patch: Partial<Omit<EditorVisualKeyframe, 'timePercent'>> = {},
): EditorVisualClip {
  const timePercent = normalizeTimePercent(progressPercent, 0);
  const currentState = getVisualKeyframeStateAtProgress(clip, timePercent);
  const nextKeyframe = normalizeVisualKeyframeCandidate(
    { ...currentState, ...patch, timePercent },
    currentState,
  );
  const keyframes = dedupeVisualKeyframes([
    ...normalizeVisualKeyframes(clip),
    nextKeyframe,
  ]).sort((left, right) => left.timePercent - right.timePercent);

  return syncVisualClipToKeyframes({
    ...clip,
    keyframes,
  });
}

export function ensureVisualClipHasKeyframes(clip: EditorVisualClip): EditorVisualClip {
  return syncVisualClipToKeyframes(clip);
}

export function applyVisualClipPatchAtProgress(
  clip: EditorVisualClip,
  progressPercent: number,
  patch: Partial<EditorVisualClip>,
): EditorVisualClip {
  const keyframePatch = getVisualKeyframePatchFromClipPatch(patch);
  const nextClip = { ...clip, ...patch };

  if ('keyframes' in patch) {
    if (!patch.keyframes?.length) {
      return ensureVisualClipHasKeyframes({
        ...nextClip,
        keyframes: undefined,
      });
    }

    return syncVisualClipToKeyframes({
      ...nextClip,
      keyframes: patch.keyframes,
    });
  }

  if (Object.keys(keyframePatch).length === 0) {
    return nextClip;
  }

  return upsertVisualKeyframe(nextClip, progressPercent, keyframePatch);
}

export function updateVisualKeyframe(
  clip: EditorVisualClip,
  keyframeIndex: number,
  patch: Partial<EditorVisualKeyframe>,
): EditorVisualClip {
  const keyframes = normalizeVisualKeyframes(clip);
  const existing = keyframes[keyframeIndex];

  if (!existing) {
    return clip;
  }

  const nextKeyframes = keyframes.map((keyframe, index) =>
    index === keyframeIndex
      ? normalizeVisualKeyframeCandidate({ ...keyframe, ...patch }, existing)
      : keyframe,
  );

  return syncVisualClipToKeyframes({
    ...clip,
    keyframes: dedupeVisualKeyframes(nextKeyframes).sort((left, right) => left.timePercent - right.timePercent),
  });
}

export function removeVisualKeyframe(
  clip: EditorVisualClip,
  keyframeIndex: number,
): EditorVisualClip {
  const keyframes = normalizeVisualKeyframes(clip);

  if (keyframeIndex <= 0 || keyframeIndex >= keyframes.length - 1) {
    return clip;
  }

  return syncVisualClipToKeyframes({
    ...clip,
    keyframes: keyframes.filter((_, index) => index !== keyframeIndex),
  });
}

export function visualKeyframesToOpacityAutomation(
  clip: VisualKeyframeClip,
): TimelineAutomationPoint[] {
  return normalizeAutomationPoints(
    normalizeVisualKeyframes(clip).map((keyframe) => ({
      timePercent: keyframe.timePercent,
      valuePercent: keyframe.opacityPercent,
    })),
    clip.opacityPercent,
  );
}

export function getVisualKeyframePercents(clip: VisualKeyframeClip): number[] {
  return normalizeVisualKeyframes(clip).map((keyframe) => keyframe.timePercent);
}

export function normalizeAudioKeyframes(clip: AudioKeyframeClip): EditorAudioKeyframe[] {
  const candidates: EditorAudioKeyframe[] = [
    getLegacyAudioStateAtProgress(clip, 0),
    getLegacyAudioStateAtProgress(clip, 100),
  ];
  const explicitKeyframes: EditorAudioKeyframe[] = [];

  for (const keyframe of clip.volumeKeyframes ?? []) {
    if (!isRecord(keyframe)) {
      continue;
    }

    const timePercent = normalizeTimePercent(keyframe.timePercent, 0);
    explicitKeyframes.push(normalizeAudioKeyframeCandidate(keyframe, getLegacyAudioStateAtProgress(clip, timePercent)));
  }

  if (explicitKeyframes.length > 0) {
    candidates.push(...explicitKeyframes);
  } else {
    for (const point of clip.volumeAutomationPoints ?? []) {
      candidates.push(getLegacyAudioStateAtProgress(clip, point.timePercent));
    }
  }

  return dedupeAudioKeyframes(candidates).sort((left, right) => left.timePercent - right.timePercent);
}

export function getAudioKeyframeStateAtProgress(
  clip: AudioKeyframeClip,
  progressPercent: number,
): EditorAudioKeyframe {
  const keyframes = normalizeAudioKeyframes(clip);
  const progress = normalizeTimePercent(progressPercent, 0);

  for (let index = 1; index < keyframes.length; index += 1) {
    const start = keyframes[index - 1];
    const end = keyframes[index];

    if (progress <= end.timePercent) {
      return interpolateAudioKeyframes(start, end, progress);
    }
  }

  return {
    ...(keyframes[keyframes.length - 1] ?? getLegacyAudioStateAtProgress(clip, progress)),
    timePercent: progress,
  };
}

export function upsertAudioKeyframe(
  clip: EditorAudioClip,
  progressPercent: number,
  patch: Partial<Omit<EditorAudioKeyframe, 'timePercent'>> = {},
): EditorAudioClip {
  const timePercent = normalizeTimePercent(progressPercent, 0);
  const currentState = getAudioKeyframeStateAtProgress(clip, timePercent);
  const nextKeyframe = normalizeAudioKeyframeCandidate(
    { ...currentState, ...patch, timePercent },
    currentState,
  );
  const volumeKeyframes = dedupeAudioKeyframes([
    ...normalizeAudioKeyframes(clip),
    nextKeyframe,
  ]).sort((left, right) => left.timePercent - right.timePercent);

  return syncAudioClipToKeyframes({
    ...clip,
    volumeKeyframes,
  });
}

export function updateAudioKeyframe(
  clip: EditorAudioClip,
  keyframeIndex: number,
  patch: Partial<Omit<EditorAudioKeyframe, 'timePercent'>>,
): EditorAudioClip {
  const keyframes = normalizeAudioKeyframes(clip);
  const existing = keyframes[keyframeIndex];

  if (!existing) {
    return clip;
  }

  const volumeKeyframes = keyframes.map((keyframe, index) =>
    index === keyframeIndex
      ? normalizeAudioKeyframeCandidate({ ...keyframe, ...patch }, existing)
      : keyframe,
  );

  return syncAudioClipToKeyframes({
    ...clip,
    volumeKeyframes: dedupeAudioKeyframes(volumeKeyframes).sort((left, right) => left.timePercent - right.timePercent),
  });
}

export function removeAudioKeyframe(
  clip: EditorAudioClip,
  keyframeIndex: number,
): EditorAudioClip {
  const keyframes = normalizeAudioKeyframes(clip);

  if (keyframeIndex <= 0 || keyframeIndex >= keyframes.length - 1) {
    return clip;
  }

  return syncAudioClipToKeyframes({
    ...clip,
    volumeKeyframes: keyframes.filter((_, index) => index !== keyframeIndex),
  });
}

export function audioKeyframesToVolumeAutomation(
  clip: AudioKeyframeClip,
): TimelineAutomationPoint[] {
  return normalizeAutomationPoints(
    normalizeAudioKeyframes(clip).map((keyframe) => ({
      timePercent: keyframe.timePercent,
      valuePercent: keyframe.volumePercent,
    })),
    clip.volumePercent,
  );
}

export function getAudioKeyframePercents(clip: AudioKeyframeClip): number[] {
  return normalizeAudioKeyframes(clip).map((keyframe) => keyframe.timePercent);
}

export function getAdjacentKeyframePercent(
  keyframePercents: number[],
  currentPercent: number,
  direction: 'previous' | 'next',
): number {
  const normalizedPercents = Array.from(
    new Set(
      [0, 100, ...keyframePercents]
        .filter((value) => Number.isFinite(value))
        .map((value) => normalizeTimePercent(value, 0)),
    ),
  ).sort((left, right) => left - right);
  const current = normalizeTimePercent(currentPercent, 0);

  if (direction === 'previous') {
    return [...normalizedPercents]
      .reverse()
      .find((percent) => percent < current - KEYFRAME_EPSILON_PERCENT) ?? 0;
  }

  return normalizedPercents.find((percent) => percent > current + KEYFRAME_EPSILON_PERCENT) ?? 100;
}

function syncVisualClipToKeyframes(clip: EditorVisualClip): EditorVisualClip {
  const keyframes = normalizeVisualKeyframes(clip);
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1] ?? first;
  const hasPositionMotion = keyframes.some(
    (keyframe) => keyframe.positionX !== first.positionX || keyframe.positionY !== first.positionY,
  );
  const hasScaleMotion = keyframes.some((keyframe) => keyframe.scalePercent !== first.scalePercent);
  const hasRotationMotion = keyframes.some((keyframe) => keyframe.rotationDeg !== first.rotationDeg);

  const syncedClip = {
    ...clip,
    keyframes,
    positionX: first.positionX,
    positionY: first.positionY,
    motionEnabled: hasPositionMotion,
    endPositionX: last.positionX,
    endPositionY: last.positionY,
    scalePercent: first.scalePercent,
    scaleMotionEnabled: hasScaleMotion,
    endScalePercent: last.scalePercent,
    rotationDeg: first.rotationDeg,
    rotationMotionEnabled: hasRotationMotion,
    endRotationDeg: last.rotationDeg,
    opacityPercent: first.opacityPercent,
    // Mirror the first keyframe's tail back to the clip's static bezier tail so the two round-trip
    // (undefined on non-comic clips leaves the static tail untouched).
    comicTailTipXPercent: first.tailTipXPercent ?? clip.comicTailTipXPercent,
    comicTailTipYPercent: first.tailTipYPercent ?? clip.comicTailTipYPercent,
    comicTailCurvePercent: first.tailCurvePercent ?? clip.comicTailCurvePercent,
  };

  return {
    ...syncedClip,
    opacityAutomationPoints: visualKeyframesToOpacityAutomation(syncedClip),
  };
}

function syncAudioClipToKeyframes(clip: EditorAudioClip): EditorAudioClip {
  const volumeKeyframes = normalizeAudioKeyframes(clip);
  const first = volumeKeyframes[0];
  const syncedClip = {
    ...clip,
    volumeKeyframes,
    volumePercent: first.volumePercent,
  };

  return {
    ...syncedClip,
    volumeAutomationPoints: audioKeyframesToVolumeAutomation(syncedClip),
  };
}

function getLegacyVisualStateAtProgress(
  clip: VisualKeyframeClip,
  progressPercent: number,
): EditorVisualKeyframe {
  const progress = normalizeTimePercent(progressPercent, 0);
  const ratio = progress / 100;

  return {
    timePercent: progress,
    positionX: roundNumber(interpolateValue(clip.positionX, clip.motionEnabled ? clip.endPositionX : clip.positionX, ratio)),
    positionY: roundNumber(interpolateValue(clip.positionY, clip.motionEnabled ? clip.endPositionY : clip.positionY, ratio)),
    scalePercent: roundNumber(interpolateValue(clip.scalePercent, clip.scaleMotionEnabled ? clip.endScalePercent : clip.scalePercent, ratio)),
    rotationDeg: roundNumber(interpolateValue(clip.rotationDeg, clip.rotationMotionEnabled ? clip.endRotationDeg : clip.rotationDeg, ratio)),
    opacityPercent: roundNumber(getAutomationValueAtProgress(
      clip.opacityAutomationPoints,
      progress,
      clip.opacityPercent,
    )),
    // Tail channels default to the clip's static bezier tail (undefined for non-comic clips, which
    // `toEqual` treats as absent). Explicit tail keyframes override these; the painter applies its
    // own sane defaults when both are undefined.
    tailTipXPercent: normalizeOptionalNumber(clip.comicTailTipXPercent, undefined),
    tailTipYPercent: normalizeOptionalNumber(clip.comicTailTipYPercent, undefined),
    tailCurvePercent: normalizeOptionalNumber(clip.comicTailCurvePercent, undefined),
  };
}

function getLegacyAudioStateAtProgress(
  clip: AudioKeyframeClip,
  progressPercent: number,
): EditorAudioKeyframe {
  const progress = normalizeTimePercent(progressPercent, 0);

  return {
    timePercent: progress,
    volumePercent: roundNumber(getAutomationValueAtProgress(
      clip.volumeAutomationPoints,
      progress,
      clip.volumePercent,
      150,
    )),
  };
}

function normalizeVisualKeyframeCandidate(
  keyframe: VisualKeyframeCandidate,
  fallback: EditorVisualKeyframe,
): EditorVisualKeyframe {
  return {
    timePercent: normalizeTimePercent(keyframe.timePercent, fallback.timePercent),
    positionX: normalizeNumber(keyframe.positionX, fallback.positionX),
    positionY: normalizeNumber(keyframe.positionY, fallback.positionY),
    scalePercent: Math.max(1, normalizeNumber(keyframe.scalePercent, fallback.scalePercent)),
    rotationDeg: normalizeNumber(keyframe.rotationDeg, fallback.rotationDeg),
    opacityPercent: clampNumber(normalizeNumber(keyframe.opacityPercent, fallback.opacityPercent), 0, 100),
    tailTipXPercent: normalizeOptionalNumber(keyframe.tailTipXPercent, fallback.tailTipXPercent),
    tailTipYPercent: normalizeOptionalNumber(keyframe.tailTipYPercent, fallback.tailTipYPercent),
    tailCurvePercent: normalizeOptionalNumber(keyframe.tailCurvePercent, fallback.tailCurvePercent),
  };
}

function normalizeAudioKeyframeCandidate(
  keyframe: AudioKeyframeCandidate,
  fallback: EditorAudioKeyframe,
): EditorAudioKeyframe {
  return {
    timePercent: normalizeTimePercent(keyframe.timePercent, fallback.timePercent),
    volumePercent: clampNumber(normalizeNumber(keyframe.volumePercent, fallback.volumePercent), 0, 150),
  };
}

function interpolateVisualKeyframes(
  start: EditorVisualKeyframe,
  end: EditorVisualKeyframe,
  progressPercent: number,
): EditorVisualKeyframe {
  if (Math.abs(end.timePercent - start.timePercent) < KEYFRAME_EPSILON_PERCENT) {
    return { ...end, timePercent: progressPercent };
  }

  const ratio = (progressPercent - start.timePercent) / (end.timePercent - start.timePercent);

  return {
    timePercent: normalizeTimePercent(progressPercent, 0),
    positionX: roundNumber(interpolateValue(start.positionX, end.positionX, ratio)),
    positionY: roundNumber(interpolateValue(start.positionY, end.positionY, ratio)),
    scalePercent: roundNumber(interpolateValue(start.scalePercent, end.scalePercent, ratio)),
    rotationDeg: roundNumber(interpolateValue(start.rotationDeg, end.rotationDeg, ratio)),
    opacityPercent: roundNumber(interpolateValue(start.opacityPercent, end.opacityPercent, ratio)),
    tailTipXPercent: interpolateOptionalValue(start.tailTipXPercent, end.tailTipXPercent, ratio),
    tailTipYPercent: interpolateOptionalValue(start.tailTipYPercent, end.tailTipYPercent, ratio),
    tailCurvePercent: interpolateOptionalValue(start.tailCurvePercent, end.tailCurvePercent, ratio),
  };
}

function interpolateAudioKeyframes(
  start: EditorAudioKeyframe,
  end: EditorAudioKeyframe,
  progressPercent: number,
): EditorAudioKeyframe {
  if (Math.abs(end.timePercent - start.timePercent) < KEYFRAME_EPSILON_PERCENT) {
    return { ...end, timePercent: progressPercent };
  }

  const ratio = (progressPercent - start.timePercent) / (end.timePercent - start.timePercent);

  return {
    timePercent: normalizeTimePercent(progressPercent, 0),
    volumePercent: roundNumber(interpolateValue(start.volumePercent, end.volumePercent, ratio)),
  };
}

function dedupeVisualKeyframes(keyframes: EditorVisualKeyframe[]): EditorVisualKeyframe[] {
  const deduped: EditorVisualKeyframe[] = [];

  for (const keyframe of keyframes) {
    const existingIndex = deduped.findIndex(
      (candidate) => Math.abs(candidate.timePercent - keyframe.timePercent) < KEYFRAME_EPSILON_PERCENT,
    );

    if (existingIndex >= 0) {
      deduped[existingIndex] = keyframe;
    } else {
      deduped.push(keyframe);
    }
  }

  return deduped;
}

function dedupeAudioKeyframes(keyframes: EditorAudioKeyframe[]): EditorAudioKeyframe[] {
  const deduped: EditorAudioKeyframe[] = [];

  for (const keyframe of keyframes) {
    const existingIndex = deduped.findIndex(
      (candidate) => Math.abs(candidate.timePercent - keyframe.timePercent) < KEYFRAME_EPSILON_PERCENT,
    );

    if (existingIndex >= 0) {
      deduped[existingIndex] = keyframe;
    } else {
      deduped.push(keyframe);
    }
  }

  return deduped;
}

function interpolateValue(start: number, end: number, progress: number): number {
  return start + (end - start) * clampNumber(progress, 0, 1);
}

function getVisualKeyframePatchFromClipPatch(
  patch: Partial<EditorVisualClip>,
): Partial<Omit<EditorVisualKeyframe, 'timePercent'>> {
  const keyframePatch: Partial<Omit<EditorVisualKeyframe, 'timePercent'>> = {};

  if ('positionX' in patch && patch.positionX !== undefined) {
    keyframePatch.positionX = normalizeNumber(patch.positionX, 0);
  }

  if ('positionY' in patch && patch.positionY !== undefined) {
    keyframePatch.positionY = normalizeNumber(patch.positionY, 0);
  }

  if ('scalePercent' in patch && patch.scalePercent !== undefined) {
    keyframePatch.scalePercent = Math.max(1, normalizeNumber(patch.scalePercent, 100));
  }

  if ('rotationDeg' in patch && patch.rotationDeg !== undefined) {
    keyframePatch.rotationDeg = normalizeNumber(patch.rotationDeg, 0);
  }

  if ('opacityPercent' in patch && patch.opacityPercent !== undefined) {
    keyframePatch.opacityPercent = clampNumber(normalizeNumber(patch.opacityPercent, 100), 0, 100);
  }

  if ('comicTailTipXPercent' in patch && patch.comicTailTipXPercent !== undefined) {
    keyframePatch.tailTipXPercent = normalizeNumber(patch.comicTailTipXPercent, 50);
  }

  if ('comicTailTipYPercent' in patch && patch.comicTailTipYPercent !== undefined) {
    keyframePatch.tailTipYPercent = normalizeNumber(patch.comicTailTipYPercent, 50);
  }

  if ('comicTailCurvePercent' in patch && patch.comicTailCurvePercent !== undefined) {
    keyframePatch.tailCurvePercent = normalizeNumber(patch.comicTailCurvePercent, 50);
  }

  return keyframePatch;
}

function normalizeTimePercent(value: unknown, fallback: number): number {
  return roundNumber(clampNumber(normalizeNumber(value, fallback), 0, 100));
}

function normalizeNumber(value: unknown, fallback: number): number {
  return roundNumber(typeof value === 'number' && Number.isFinite(value) ? value : fallback);
}

/** Rounds a finite candidate; otherwise inherits the fallback (which may itself be undefined). Used
 *  for the optional comic-tail keyframe channels so absent values stay absent and round-trip. */
function normalizeOptionalNumber(value: unknown, fallback: number | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return roundNumber(value);
  }

  return fallback;
}

/** Linear interpolation for the optional comic-tail channels: lerp when both ends are defined, hold
 *  the single defined end otherwise, and stay undefined when neither is set. */
function interpolateOptionalValue(
  start: number | undefined,
  end: number | undefined,
  progress: number,
): number | undefined {
  if (typeof start === 'number' && typeof end === 'number') {
    return roundNumber(interpolateValue(start, end, progress));
  }

  if (typeof end === 'number') {
    return roundNumber(end);
  }

  if (typeof start === 'number') {
    return roundNumber(start);
  }

  return undefined;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
