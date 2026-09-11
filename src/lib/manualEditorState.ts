import type {
  EditorAudioClip,
  EditorVisualSourceKind,
  EditorVisualClip,
  EditorVisualTrackKind,
  EditorTextTypography,
  NodeData,
  TimelineAutomationPoint,
  TextClipEffect,
  VisualClipTransition,
} from '../types/flow';
import {
  audioKeyframesToVolumeAutomation,
  ensureVisualClipHasKeyframes,
  normalizeAudioKeyframes,
  normalizeVisualKeyframes,
  visualKeyframesToOpacityAutomation,
} from './editorKeyframes';
import { normalizeFontWeight } from './formatFontFamily';
import { normalizeBundledFontFaceState, normalizeBundledFontFaceStateForTypography } from './bundledFontLibrary';
import {
  normalizeClipBlendMode,
  normalizeClipChromaKey,
  normalizeClipFilterStack,
  normalizeClipStroke,
} from './editorClipEffects';
import { normalizeEditorAudioProcessingSettings } from './editorAudioProcessing';
import { normalizeEditorAudioDuckingSettings } from './editorAudioDucking';
import {
  sanitizeEditorAudioClipProfessionalState,
  sanitizeEditorVisualClipProfessionalState,
} from './videoProfessionalState';

export function getEditorVisualClips(nodeData: NodeData): EditorVisualClip[] {
  const value = nodeData.editorVisualClips;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((clip) => {
    if (!isRecord(clip) || typeof clip.id !== 'string' || typeof clip.sourceNodeId !== 'string') {
      return [];
    }

    const sourceKind = normalizeVisualSourceKind(clip.sourceKind);

    if (!sourceKind) {
      return [];
    }

    const comicBezierTip = resolveComicBezierTip(clip);

    const normalizedClip: EditorVisualClip = {
      id: clip.id,
      sourceNodeId: clip.sourceNodeId,
      sourceKind,
      trackIndex: normalizeInteger(clip.trackIndex, 0),
      startMs: normalizeNonNegativeNumber(clip.startMs, 0),
      sourceInMs: normalizeNonNegativeNumber(clip.sourceInMs, normalizeNonNegativeNumber(clip.trimStartMs, 0)),
      sourceOutMs: typeof clip.sourceOutMs === 'number' ? Math.max(0, clip.sourceOutMs) : undefined,
      durationSeconds: typeof clip.durationSeconds === 'number' ? clip.durationSeconds : undefined,
      trimStartMs: normalizeNonNegativeNumber(clip.trimStartMs, 0),
      trimEndMs: normalizeNonNegativeNumber(clip.trimEndMs, 0),
      playbackRate: normalizePlaybackRate(clip.playbackRate),
      reversePlayback: typeof clip.reversePlayback === 'boolean' ? clip.reversePlayback : false,
      fitMode: clip.fitMode === 'cover' || clip.fitMode === 'stretch' ? clip.fitMode : 'contain',
      scalePercent: normalizeInteger(clip.scalePercent, 100),
      scaleMotionEnabled: typeof clip.scaleMotionEnabled === 'boolean' ? clip.scaleMotionEnabled : false,
      endScalePercent: normalizeInteger(clip.endScalePercent, 100),
      opacityPercent: normalizeInteger(clip.opacityPercent, 100),
      opacityAutomationPoints: normalizeAutomationPoints(
        clip.opacityAutomationPoints,
        normalizeInteger(clip.opacityPercent, 100),
      ),
      rotationDeg: normalizeInteger(clip.rotationDeg, 0),
      rotationMotionEnabled: typeof clip.rotationMotionEnabled === 'boolean' ? clip.rotationMotionEnabled : false,
      endRotationDeg: normalizeInteger(clip.endRotationDeg, normalizeInteger(clip.rotationDeg, 0)),
      flipHorizontal: typeof clip.flipHorizontal === 'boolean' ? clip.flipHorizontal : false,
      flipVertical: typeof clip.flipVertical === 'boolean' ? clip.flipVertical : false,
      positionX: normalizeInteger(clip.positionX, 0),
      positionY: normalizeInteger(clip.positionY, 0),
      motionEnabled: typeof clip.motionEnabled === 'boolean' ? clip.motionEnabled : false,
      endPositionX: normalizeInteger(clip.endPositionX, 0),
      endPositionY: normalizeInteger(clip.endPositionY, 0),
      cropLeftPercent: normalizePercent(clip.cropLeftPercent, 0),
      cropRightPercent: normalizePercent(clip.cropRightPercent, 0),
      cropTopPercent: normalizePercent(clip.cropTopPercent, 0),
      cropBottomPercent: normalizePercent(clip.cropBottomPercent, 0),
      cropPanXPercent: normalizeSignedPercent(clip.cropPanXPercent, 0),
      cropPanYPercent: normalizeSignedPercent(clip.cropPanYPercent, 0),
      cropRotationDeg: normalizeInteger(clip.cropRotationDeg, 0),
      filterStack: normalizeClipFilterStack(clip.filterStack),
      blendMode: normalizeClipBlendMode(clip.blendMode),
      chromaKey: normalizeClipChromaKey(clip.chromaKey),
      stroke: normalizeClipStroke(clip.stroke),
      transitionIn: normalizeTransition(clip.transitionIn),
      transitionOut:
        clip.transitionOut !== undefined
          ? normalizeTransition(clip.transitionOut)
          : normalizeTransition(clip.transitionAfter),
      transitionDurationMs: normalizeNonNegativeNumber(clip.transitionDurationMs, 500),
      textContent: typeof clip.textContent === 'string' ? clip.textContent : undefined,
      textFontFamily: typeof clip.textFontFamily === 'string' ? clip.textFontFamily : 'Inter, system-ui, sans-serif',
      textSizePx: normalizeInteger(clip.textSizePx, 64),
      textColor: typeof clip.textColor === 'string' ? clip.textColor : '#f3f4f6',
      textEffect: normalizeTextEffect(clip.textEffect),
      textBackgroundOpacityPercent: normalizeInteger(clip.textBackgroundOpacityPercent, 0),
      comicKind: clip.comicKind === 'speech-bubble' || clip.comicKind === 'thought-bubble' || clip.comicKind === 'caption' ? clip.comicKind : undefined,
      comicTailAngleDeg: typeof clip.comicTailAngleDeg === 'number' ? clip.comicTailAngleDeg : undefined,
      comicTailLengthPx: typeof clip.comicTailLengthPx === 'number' ? Math.max(0, clip.comicTailLengthPx) : undefined,
      comicTailTipXPercent: comicBezierTip?.tipXPercent,
      comicTailTipYPercent: comicBezierTip?.tipYPercent,
      comicTailCurvePercent: typeof clip.comicTailCurvePercent === 'number' && Number.isFinite(clip.comicTailCurvePercent)
        ? clamp01to100(clip.comicTailCurvePercent)
        : undefined,
      comicLineHeightPercent: typeof clip.comicLineHeightPercent === 'number' ? clip.comicLineHeightPercent : undefined,
      comicLetterSpacingPx: typeof clip.comicLetterSpacingPx === 'number' ? clip.comicLetterSpacingPx : undefined,
      comicTextAlign: clip.comicTextAlign === 'left' || clip.comicTextAlign === 'center' || clip.comicTextAlign === 'right' ? clip.comicTextAlign : undefined,
      textTypography: normalizeEditorTextTypography(clip.textTypography, typeof clip.textFontFamily === 'string' ? clip.textFontFamily : 'Inter, system-ui, sans-serif'),
      shapeFillColor: typeof clip.shapeFillColor === 'string' ? clip.shapeFillColor : undefined,
      shapeBorderColor: typeof clip.shapeBorderColor === 'string' ? clip.shapeBorderColor : undefined,
      shapeBorderWidth: typeof clip.shapeBorderWidth === 'number' ? Math.max(0, Math.round(clip.shapeBorderWidth)) : undefined,
      shapeCornerRadius: typeof clip.shapeCornerRadius === 'number' ? Math.max(0, Math.round(clip.shapeCornerRadius)) : undefined,
      professional: sanitizeEditorVisualClipProfessionalState(clip.professional),
    };

    if (Array.isArray(clip.keyframes) && clip.keyframes.length > 0) {
      const clipWithKeyframes = {
        ...normalizedClip,
        keyframes: clip.keyframes as EditorVisualClip['keyframes'],
      };
      const keyframes = normalizeVisualKeyframes(clipWithKeyframes);

      normalizedClip.keyframes = keyframes;
      normalizedClip.opacityAutomationPoints = visualKeyframesToOpacityAutomation({
        ...normalizedClip,
        keyframes,
      });
    }

    return [ensureVisualClipHasKeyframes(normalizedClip)];
  });
}

export function getEditorAudioClips(nodeData: NodeData): EditorAudioClip[] {
  const value = nodeData.editorAudioClips;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((clip) => {
    if (!isRecord(clip) || typeof clip.id !== 'string' || typeof clip.sourceNodeId !== 'string') {
      return [];
    }

    const volumePercent = normalizeInteger(clip.volumePercent, 100);

    const normalizedClip: EditorAudioClip = {
      id: clip.id,
      sourceNodeId: clip.sourceNodeId,
      offsetMs: typeof clip.offsetMs === 'number' ? clip.offsetMs : 0,
      sourceInMs: optionalNonNegativeNumber(clip.sourceInMs),
      sourceOutMs: optionalNonNegativeNumber(clip.sourceOutMs),
      trackIndex: typeof clip.trackIndex === 'number' ? clip.trackIndex : 0,
      volumePercent,
      volumeAutomationPoints: normalizeAutomationPoints(clip.volumeAutomationPoints, volumePercent),
      measuredMatchGainDb: normalizeMeasuredMatchGainDb(clip.measuredMatchGainDb),
      loudnessReferenceClipId: typeof clip.loudnessReferenceClipId === 'string' && clip.loudnessReferenceClipId.trim()
        ? clip.loudnessReferenceClipId
        : undefined,
      loudnessReferenceSourceNodeId: optionalNonEmptyString(clip.loudnessReferenceSourceNodeId),
      loudnessReferenceSourceInMs: optionalNonNegativeNumber(clip.loudnessReferenceSourceInMs),
      loudnessReferenceSourceOutMs: optionalNonNegativeNumber(clip.loudnessReferenceSourceOutMs),
      speechLevelMatchMeasurement: normalizeSpeechLevelMatchMeasurement(clip.speechLevelMatchMeasurement),
      audioProcessing: normalizeEditorAudioProcessingSettings(clip.audioProcessing),
      audioDucking: normalizeEditorAudioDuckingSettings(clip.audioDucking),
      fadeInSeconds: normalizeAudioFadeSeconds(clip.fadeInSeconds),
      fadeOutSeconds: normalizeAudioFadeSeconds(clip.fadeOutSeconds),
      enabled: typeof clip.enabled === 'boolean' ? clip.enabled : true,
      professional: sanitizeEditorAudioClipProfessionalState(clip.professional),
    };

    if (Array.isArray(clip.volumeKeyframes) && clip.volumeKeyframes.length > 0) {
      const clipWithKeyframes = {
        ...normalizedClip,
        volumeKeyframes: clip.volumeKeyframes as EditorAudioClip['volumeKeyframes'],
      };
      const volumeKeyframes = normalizeAudioKeyframes(clipWithKeyframes);

      normalizedClip.volumeKeyframes = volumeKeyframes;
      normalizedClip.volumeAutomationPoints = audioKeyframesToVolumeAutomation({
        ...normalizedClip,
        volumeKeyframes,
      });
    }

    return [normalizedClip];
  });
}

export function getEditorAudioTrackVolumes(nodeData: NodeData, trackCount = 4): number[] {
  const value = Array.isArray(nodeData.editorAudioTrackVolumes) ? nodeData.editorAudioTrackVolumes : [];

  return Array.from({ length: Math.max(0, trackCount) }, (_, index) =>
    normalizeTrackVolume(value[index]),
  );
}

/**
 * Per-visual-track role (index-aligned with the visual tracks), defaulting every absent/invalid
 * entry to `'standard'` — never crashes on a missing or short-array `editorVisualTrackKinds`.
 * Mirrors `getEditorAudioTrackVolumes`'s dense-array-with-defaults shape (as opposed to the sparse
 * index-set shape used by track lock/collapse, which are booleans rather than an enum per track).
 */
export function getEditorVisualTrackKinds(nodeData: NodeData, trackCount = 4): EditorVisualTrackKind[] {
  const value = Array.isArray(nodeData.editorVisualTrackKinds) ? nodeData.editorVisualTrackKinds : [];

  return Array.from({ length: Math.max(0, trackCount) }, (_, index) =>
    normalizeVisualTrackKind(value[index]),
  );
}

function normalizeVisualTrackKind(value: unknown): EditorVisualTrackKind {
  return value === 'overlay' ? 'overlay' : 'standard';
}

/** Toggles a single track's kind between `'standard'` and `'overlay'`, leaving every other track
 *  untouched. `trackKinds` is expected to already be the full, dense array (from
 *  `getEditorVisualTrackKinds`); out-of-range indexes are a no-op. */
export function toggleEditorVisualTrackKind(
  trackKinds: readonly EditorVisualTrackKind[],
  trackIndex: number,
): EditorVisualTrackKind[] {
  return trackKinds.map((kind, index) =>
    index === trackIndex ? (kind === 'overlay' ? 'standard' : 'overlay') : kind,
  );
}

/**
 * Placement preference for a brand-new text/comic clip: when a dedicated `overlay` track exists,
 * new text/comic clips should land there instead of the default track, so "text/captions are a
 * separate thing" without migrating any existing clip. Returns `undefined` (meaning "no
 * preference, keep today's default") for every other source kind, and whenever no overlay track
 * exists — callers should fall back to their normal default trackIndex in that case.
 */
export function selectOverlayTrackIndexForNewClip(
  sourceKind: EditorVisualSourceKind,
  trackKinds: readonly EditorVisualTrackKind[],
): number | undefined {
  if (sourceKind !== 'text' && sourceKind !== 'comic') {
    return undefined;
  }

  const overlayIndex = trackKinds.findIndex((kind) => kind === 'overlay');

  return overlayIndex >= 0 ? overlayIndex : undefined;
}

export function createEditorVisualClip(
  sourceNodeId: string,
  sourceKind: EditorVisualSourceKind,
  overrides: Partial<EditorVisualClip> = {},
): EditorVisualClip {
  const overridesBezierTip = resolveComicBezierTip(overrides);
  const clip: EditorVisualClip = {
    id: `visual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceNodeId,
    sourceKind,
    trackIndex: overrides.trackIndex ?? 0,
    startMs: overrides.startMs ?? 0,
    sourceInMs: overrides.sourceInMs ?? overrides.trimStartMs ?? 0,
    sourceOutMs: overrides.sourceOutMs,
    durationSeconds:
      overrides.durationSeconds ?? (sourceKind === 'image' || sourceKind === 'text' || sourceKind === 'shape' || sourceKind === 'comic' ? 4 : undefined),
    trimStartMs: overrides.trimStartMs ?? 0,
    trimEndMs: overrides.trimEndMs ?? 0,
    playbackRate: overrides.playbackRate ?? 1,
    reversePlayback: overrides.reversePlayback ?? false,
    fitMode: overrides.fitMode ?? 'contain',
    scalePercent: overrides.scalePercent ?? 100,
    scaleMotionEnabled: overrides.scaleMotionEnabled ?? false,
    endScalePercent: overrides.endScalePercent ?? overrides.scalePercent ?? 100,
    opacityPercent: overrides.opacityPercent ?? 100,
    opacityAutomationPoints: normalizeAutomationPoints(
      overrides.opacityAutomationPoints,
      overrides.opacityPercent ?? 100,
    ),
    rotationDeg: overrides.rotationDeg ?? 0,
    rotationMotionEnabled: overrides.rotationMotionEnabled ?? false,
    endRotationDeg: overrides.endRotationDeg ?? overrides.rotationDeg ?? 0,
    flipHorizontal: overrides.flipHorizontal ?? false,
    flipVertical: overrides.flipVertical ?? false,
    positionX: overrides.positionX ?? 0,
    positionY: overrides.positionY ?? 0,
    motionEnabled: overrides.motionEnabled ?? false,
    endPositionX: overrides.endPositionX ?? 0,
    endPositionY: overrides.endPositionY ?? 0,
    cropLeftPercent: overrides.cropLeftPercent ?? 0,
    cropRightPercent: overrides.cropRightPercent ?? 0,
    cropTopPercent: overrides.cropTopPercent ?? 0,
    cropBottomPercent: overrides.cropBottomPercent ?? 0,
    cropPanXPercent: overrides.cropPanXPercent ?? 0,
    cropPanYPercent: overrides.cropPanYPercent ?? 0,
    cropRotationDeg: overrides.cropRotationDeg ?? 0,
    filterStack: normalizeClipFilterStack(overrides.filterStack ?? []),
    blendMode: normalizeClipBlendMode(overrides.blendMode),
    chromaKey: normalizeClipChromaKey(overrides.chromaKey),
    stroke: normalizeClipStroke(overrides.stroke),
    transitionIn: overrides.transitionIn ?? 'none',
    transitionOut: overrides.transitionOut ?? 'none',
    transitionDurationMs: overrides.transitionDurationMs ?? 500,
    textContent: overrides.textContent,
    textFontFamily: overrides.textFontFamily ?? 'Inter, system-ui, sans-serif',
    textSizePx: overrides.textSizePx ?? 64,
    textColor: overrides.textColor ?? '#f3f4f6',
    textEffect: overrides.textEffect ?? 'shadow',
    textBackgroundOpacityPercent: overrides.textBackgroundOpacityPercent ?? 0,
    textTypography: overrides.textTypography,
    comicKind: overrides.comicKind,
    comicTailAngleDeg: overrides.comicTailAngleDeg,
    comicTailLengthPx: overrides.comicTailLengthPx,
    comicTailTipXPercent: overridesBezierTip?.tipXPercent,
    comicTailTipYPercent: overridesBezierTip?.tipYPercent,
    comicTailCurvePercent: overrides.comicTailCurvePercent,
    comicLineHeightPercent: overrides.comicLineHeightPercent,
    comicLetterSpacingPx: overrides.comicLetterSpacingPx,
    comicTextAlign: overrides.comicTextAlign,
    shapeFillColor: overrides.shapeFillColor,
    shapeBorderColor: overrides.shapeBorderColor,
    shapeBorderWidth: overrides.shapeBorderWidth,
    shapeCornerRadius: overrides.shapeCornerRadius,
  };

  if (overrides.keyframes?.length) {
    const keyframes = normalizeVisualKeyframes({ ...clip, keyframes: overrides.keyframes });

    return ensureVisualClipHasKeyframes({
      ...clip,
      keyframes,
      opacityAutomationPoints: visualKeyframesToOpacityAutomation({ ...clip, keyframes }),
    });
  }

  return ensureVisualClipHasKeyframes(clip);
}

export function createEditorAudioClip(
  sourceNodeId: string,
  trackIndex = 0,
  overrides: Partial<EditorAudioClip> = {},
): EditorAudioClip {
  const clip: EditorAudioClip = {
    id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceNodeId,
    offsetMs: overrides.offsetMs ?? 0,
    sourceInMs: optionalNonNegativeNumber(overrides.sourceInMs),
    sourceOutMs: optionalNonNegativeNumber(overrides.sourceOutMs),
    trackIndex,
    volumePercent: overrides.volumePercent ?? 100,
    volumeAutomationPoints: overrides.volumeAutomationPoints,
    measuredMatchGainDb: normalizeMeasuredMatchGainDb(overrides.measuredMatchGainDb),
    loudnessReferenceClipId: overrides.loudnessReferenceClipId,
    loudnessReferenceSourceNodeId: overrides.loudnessReferenceSourceNodeId,
    loudnessReferenceSourceInMs: optionalNonNegativeNumber(overrides.loudnessReferenceSourceInMs),
    loudnessReferenceSourceOutMs: optionalNonNegativeNumber(overrides.loudnessReferenceSourceOutMs),
    speechLevelMatchMeasurement: overrides.speechLevelMatchMeasurement,
    audioProcessing: normalizeEditorAudioProcessingSettings(overrides.audioProcessing),
    audioDucking: normalizeEditorAudioDuckingSettings(overrides.audioDucking),
    fadeInSeconds: normalizeAudioFadeSeconds(overrides.fadeInSeconds),
    fadeOutSeconds: normalizeAudioFadeSeconds(overrides.fadeOutSeconds),
    enabled: overrides.enabled ?? true,
    // New clips, duplicates, and restored placements all pass through this
    // constructor. Keep the persisted mixer route instead of dropping it on
    // the next normal editor-state normalization.
    professional: sanitizeEditorAudioClipProfessionalState(overrides.professional),
  };

  if (overrides.volumeKeyframes?.length) {
    const volumeKeyframes = normalizeAudioKeyframes({ ...clip, volumeKeyframes: overrides.volumeKeyframes });

    return {
      ...clip,
      volumeKeyframes,
      volumeAutomationPoints: audioKeyframesToVolumeAutomation({ ...clip, volumeKeyframes }),
    };
  }

  return clip;
}

function normalizeAudioFadeSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(5, Math.max(0, value))
    : 0;
}

function normalizeMeasuredMatchGainDb(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(12, Math.max(-12, value))
    : undefined;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function normalizeSpeechLevelMatchMeasurement(value: unknown): EditorAudioClip['speechLevelMatchMeasurement'] {
  if (!isRecord(value) || value.method !== 'active-rms-v1') return undefined;
  const referenceSourceNodeId = optionalNonEmptyString(value.referenceSourceNodeId);
  const targetSourceNodeId = optionalNonEmptyString(value.targetSourceNodeId);
  const requiredNumbers = [
    value.measuredAt,
    value.referenceSourceInMs,
    value.referenceSourceOutMs,
    value.targetSourceInMs,
    value.targetSourceOutMs,
    value.originalActiveRmsDbfs,
    value.cleanActiveRmsDbfs,
    value.cleanSamplePeakDbfs,
    value.gainDb,
    value.activeDurationSeconds,
  ];
  if (!referenceSourceNodeId || !targetSourceNodeId || requiredNumbers.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    return undefined;
  }
  return {
    method: 'active-rms-v1',
    measuredAt: value.measuredAt as number,
    referenceClipId: optionalNonEmptyString(value.referenceClipId),
    referenceSourceNodeId,
    targetSourceNodeId,
    referenceSourceInMs: value.referenceSourceInMs as number,
    referenceSourceOutMs: value.referenceSourceOutMs as number,
    targetSourceInMs: value.targetSourceInMs as number,
    targetSourceOutMs: value.targetSourceOutMs as number,
    originalActiveRmsDbfs: value.originalActiveRmsDbfs as number,
    cleanActiveRmsDbfs: value.cleanActiveRmsDbfs as number,
    cleanSamplePeakDbfs: value.cleanSamplePeakDbfs as number,
    gainDb: Math.min(12, Math.max(-12, value.gainDb as number)),
    activeDurationSeconds: value.activeDurationSeconds as number,
    peakLimited: value.peakLimited === true,
  };
}

function normalizeVisualSourceKind(
  value: unknown,
): EditorVisualSourceKind | undefined {
  return value === 'text' || value === 'shape' || value === 'image' || value === 'video' || value === 'composition' || value === 'comic'
    ? value
    : undefined;
}

function normalizeTransition(value: unknown): VisualClipTransition {
  return value === 'fade' ||
    value === 'slide-left' ||
    value === 'slide-right' ||
    value === 'slide-up' ||
    value === 'slide-down'
    ? value
    : 'none';
}

function normalizeTextEffect(value: unknown): TextClipEffect {
  return value === 'shadow' || value === 'glow' || value === 'outline' ? value : 'none';
}

function normalizeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function normalizePercent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

function normalizeSignedPercent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-100, Math.min(100, Math.round(value)))
    : fallback;
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function normalizeTrackVolume(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : 100;
}

function normalizePlaybackRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }

  return Math.min(4, Math.max(0.25, value));
}

function normalizeAutomationPoints(
  value: unknown,
  defaultValuePercent?: number,
): TimelineAutomationPoint[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const points = value.flatMap((point) => {
    if (!isRecord(point)) {
      return [];
    }

    const timePercent = normalizeNonNegativeNumber(point.timePercent, Number.NaN);
    const valuePercent = normalizeNonNegativeNumber(point.valuePercent, Number.NaN);

    if (!Number.isFinite(timePercent) || !Number.isFinite(valuePercent)) {
      return [];
    }

    return [{
      timePercent: Math.min(100, timePercent),
      valuePercent: Math.min(100, valuePercent),
    }];
  });

  if (points.length === 0) {
    return undefined;
  }

  points.sort((left, right) => left.timePercent - right.timePercent);

  if (defaultValuePercent === undefined) {
    return points;
  }

  const defaultPointValue = Math.min(100, Math.max(0, Math.round(defaultValuePercent)));
  const anchored = [...points];

  if (anchored[0].timePercent > 0) {
    anchored.unshift({ timePercent: 0, valuePercent: defaultPointValue });
  } else {
    anchored[0] = { ...anchored[0], timePercent: 0 };
  }

  const lastPoint = anchored[anchored.length - 1];

  if (lastPoint.timePercent < 100) {
    anchored.push({ timePercent: 100, valuePercent: defaultPointValue });
  } else {
    anchored[anchored.length - 1] = { ...lastPoint, timePercent: 100 };
  }

  return anchored;
}

const COMIC_TAIL_BODY_RADIUS_PERCENT = 30;
const COMIC_TAIL_PX_TO_PERCENT = 0.2;
const COMIC_TAIL_DEFAULT_ANGLE_DEG = 115;
const COMIC_TAIL_DEFAULT_LENGTH_PX = 90;

type ComicTailSource = Pick<
  EditorVisualClip,
  'comicTailTipXPercent' | 'comicTailTipYPercent' | 'comicTailAngleDeg' | 'comicTailLengthPx'
>;

/**
 * Resolves a comic clip's bezier tail tip: prefers an explicit `comicTailTip*` (the new bezier
 * model), otherwise migrates the legacy polar `comicTailAngleDeg`/`comicTailLengthPx`. Returns
 * `undefined` when the clip carries no tail data (non-comic clips, or comics whose tail is left to
 * painter defaults). Pure.
 */
function resolveComicBezierTip(clip: ComicTailSource): { tipXPercent: number; tipYPercent: number } | undefined {
  if (
    typeof clip.comicTailTipXPercent === 'number' && Number.isFinite(clip.comicTailTipXPercent) &&
    typeof clip.comicTailTipYPercent === 'number' && Number.isFinite(clip.comicTailTipYPercent)
  ) {
    return {
      tipXPercent: clamp01to100(clip.comicTailTipXPercent),
      tipYPercent: clamp01to100(clip.comicTailTipYPercent),
    };
  }

  return migrateComicPolarTailToBezierTip(clip.comicTailAngleDeg, clip.comicTailLengthPx);
}

/**
 * Converts a legacy polar comic tail (angle in degrees — 0 = right, 90 = down; length in px, both
 * measured around the bubble center) into a Paper-style bezier tail tip expressed as a percent of
 * the bubble frame (0–100, origin top-left, center = 50/50). The bubble body half-extent in that
 * percent space is ~45, so the tip is placed beyond the body edge; the px length is scaled into
 * percent units so a default ~90px tail lands ~48 from center (matching Paper's default tip
 * distance) and the result is clamped in-frame. Returns `undefined` when no polar data is present.
 * Pure — exported for direct unit testing.
 */
export function migrateComicPolarTailToBezierTip(
  angleDeg: number | undefined,
  lengthPx: number | undefined,
): { tipXPercent: number; tipYPercent: number } | undefined {
  const hasAngle = typeof angleDeg === 'number' && Number.isFinite(angleDeg);
  const hasLength = typeof lengthPx === 'number' && Number.isFinite(lengthPx);

  if (!hasAngle && !hasLength) {
    return undefined;
  }

  const resolvedAngleDeg = hasAngle ? (angleDeg as number) : COMIC_TAIL_DEFAULT_ANGLE_DEG;
  const resolvedLengthPx = Math.max(0, hasLength ? (lengthPx as number) : COMIC_TAIL_DEFAULT_LENGTH_PX);
  const angleRad = resolvedAngleDeg * (Math.PI / 180);
  const distancePercent = clampRange(
    COMIC_TAIL_BODY_RADIUS_PERCENT + resolvedLengthPx * COMIC_TAIL_PX_TO_PERCENT,
    22,
    72,
  );

  return {
    tipXPercent: clamp01to100(50 + Math.cos(angleRad) * distancePercent),
    tipYPercent: clamp01to100(50 + Math.sin(angleRad) * distancePercent),
  };
}

function normalizeEditorTextTypography(value: unknown, fontFamily: string): EditorTextTypography | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const typography: EditorTextTypography = {};

  if (typeof value.fontWeight === 'number' && Number.isFinite(value.fontWeight)) {
    typography.fontWeight = normalizeFontWeight(value.fontWeight);
  }
  const initialManagedFaceState = normalizeBundledFontFaceState(value.managedFace, value.managedFaceIssue);
  const fontStyle = value.fontStyle === 'italic' || (value.fontStyle === 'oblique' && initialManagedFaceState.managedFace?.style === 'oblique')
    ? value.fontStyle
    : 'normal';
  if (
    value.fontStyle === 'normal'
    || value.fontStyle === 'italic'
    || (value.fontStyle === 'oblique' && initialManagedFaceState.managedFace?.style === 'oblique')
  ) {
    typography.fontStyle = value.fontStyle;
  }
  Object.assign(typography, normalizeBundledFontFaceStateForTypography(value.managedFace, value.managedFaceIssue, {
    family: fontFamily,
    weight: normalizeFontWeight(value.fontWeight),
    style: fontStyle,
  }));
  if (value.fontKerning === 'auto' || value.fontKerning === 'normal' || value.fontKerning === 'none') {
    typography.fontKerning = value.fontKerning;
  }
  if (typeof value.lineHeightPercent === 'number' && Number.isFinite(value.lineHeightPercent)) {
    typography.lineHeightPercent = value.lineHeightPercent;
  }
  if (typeof value.letterSpacingPx === 'number' && Number.isFinite(value.letterSpacingPx)) {
    typography.letterSpacingPx = value.letterSpacingPx;
  }
  if (
    value.textAlign === 'left' || value.textAlign === 'center' ||
    value.textAlign === 'right' || value.textAlign === 'justify'
  ) {
    typography.textAlign = value.textAlign;
  }
  if (typeof value.strokeColor === 'string') {
    typography.strokeColor = value.strokeColor;
  }
  if (typeof value.strokeWidthPx === 'number' && Number.isFinite(value.strokeWidthPx)) {
    typography.strokeWidthPx = value.strokeWidthPx;
  }
  if (typeof value.shadowColor === 'string') {
    typography.shadowColor = value.shadowColor;
  }
  if (typeof value.shadowBlurPx === 'number' && Number.isFinite(value.shadowBlurPx)) {
    typography.shadowBlurPx = value.shadowBlurPx;
  }
  if (typeof value.shadowOffsetXPx === 'number' && Number.isFinite(value.shadowOffsetXPx)) {
    typography.shadowOffsetXPx = value.shadowOffsetXPx;
  }
  if (typeof value.shadowOffsetYPx === 'number' && Number.isFinite(value.shadowOffsetYPx)) {
    typography.shadowOffsetYPx = value.shadowOffsetYPx;
  }
  if (typeof value.arcPercent === 'number' && Number.isFinite(value.arcPercent)) {
    typography.arcPercent = value.arcPercent;
  }

  return Object.keys(typography).length > 0 ? typography : undefined;
}

function clampRange(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clamp01to100(value: number): number {
  return Number(clampRange(value, 0, 100).toFixed(2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
