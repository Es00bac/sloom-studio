import {
  VIDEO_PROFESSIONAL_STATE_VERSION,
  createDefaultEditorProfessionalVideoState,
  type EditorAudioClipProfessionalState,
  type EditorProfessionalVideoState,
  type EditorVisualClipProfessionalState,
  type ProfessionalAudioBus,
  type ProfessionalColorCorrection,
  type ProfessionalLoudnessNormalization,
  type ProfessionalColorMetadata,
  type ProfessionalMask,
  type ProfessionalStabilizationAnalysisArtifact,
  type ProfessionalMediaLoggingMetadata,
  type ProfessionalMulticamSource,
  type ProfessionalNumericParameterTrack,
  type ProfessionalRetimeSegment,
  type ProfessionalSequenceReference,
  type ProfessionalTrack,
  type ProfessionalTranscriptCue,
  type SourceBinProfessionalMediaState,
} from '../types/videoProfessional';
import type { EditorVisualClip } from '../types/flow';

export const MAX_PROFESSIONAL_TRACKS = 64;
export const MAX_PROFESSIONAL_SEQUENCES = 128;
export const MAX_PROFESSIONAL_MULTICAM_SOURCES = 64;
export const MAX_PROFESSIONAL_AUDIO_BUSES = 32;
export const MAX_PROFESSIONAL_TRANSCRIPT_CUES = 20_000;
export const MAX_PROFESSIONAL_RETIME_SEGMENTS = 2_000;
export const MAX_PROFESSIONAL_MASKS_PER_CLIP = 32;
export const MAX_PROFESSIONAL_PARAMETER_TRACKS_PER_CLIP = 128;
export const MAX_PROFESSIONAL_KEYFRAMES_PER_PARAMETER = 1_000;
export const MAX_PROFESSIONAL_KEYFRAMES_PER_CLIP = 100_000;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(value: unknown, max = 512): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function optionalNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function uniqueStrings(value: unknown, limit: number, maxLength = 256): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const normalized = string(item, maxLength);
    return normalized ? [normalized] : [];
  }))].slice(0, limit);
}

function sanitizeColorMetadata(value: unknown): ProfessionalColorMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const primaries = value.primaries === 'bt709' || value.primaries === 'display-p3' || value.primaries === 'bt2020'
    ? value.primaries
    : undefined;
  const transfer = value.transfer === 'srgb' || value.transfer === 'bt1886' || value.transfer === 'pq' || value.transfer === 'hlg'
    ? value.transfer
    : undefined;
  const matrix = value.matrix === 'rgb' || value.matrix === 'bt709' || value.matrix === 'bt2020-ncl'
    ? value.matrix
    : undefined;
  const range = value.range === 'full' || value.range === 'limited' ? value.range : undefined;
  return primaries || transfer || matrix || range ? { primaries, transfer, matrix, range } : undefined;
}

function sanitizeMediaLogging(value: unknown): ProfessionalMediaLoggingMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status === 'selected' || value.status === 'alternate' || value.status === 'rejected' || value.status === 'approved'
    ? value.status
    : value.status === 'unreviewed' ? 'unreviewed' : undefined;
  const logging: ProfessionalMediaLoggingMetadata = {
    reel: string(value.reel, 128),
    scene: string(value.scene, 128),
    shot: string(value.shot, 128),
    take: string(value.take, 128),
    camera: string(value.camera, 128),
    recordedAt: string(value.recordedAt, 64),
    notes: string(value.notes, 4_000),
    colorLabel: string(value.colorLabel, 64),
    status,
  };
  return Object.values(logging).some((entry) => entry !== undefined) ? logging : undefined;
}

function sanitizeTranscriptCue(value: unknown): ProfessionalTranscriptCue | undefined {
  if (!isRecord(value)) return undefined;
  const id = string(value.id, 128);
  const text = string(value.text, 10_000);
  if (!id || !text) return undefined;
  const startMs = number(value.startMs, 0, 0, 86_400_000);
  const endMs = number(value.endMs, startMs, startMs, 86_400_000);
  return {
    id,
    startMs,
    endMs,
    text,
    speaker: string(value.speaker, 128),
    confidence: optionalNumber(value.confidence, 0, 1),
  };
}

export function sanitizeSourceBinProfessionalMediaState(
  value: unknown,
): SourceBinProfessionalMediaState | undefined {
  if (!isRecord(value)) return undefined;
  const origin = value.origin === 'generated' ? 'generated' : value.origin === 'imported' ? 'imported' : undefined;
  if (!origin) return undefined;
  const onlineState = value.onlineState === 'online' || value.onlineState === 'offline' || value.onlineState === 'stale'
    ? value.onlineState
    : undefined;
  const proxyValue = isRecord(value.proxy) ? value.proxy : undefined;
  const status = proxyValue && (
    proxyValue.status === 'none' || proxyValue.status === 'queued' || proxyValue.status === 'building'
    || proxyValue.status === 'ready' || proxyValue.status === 'failed'
  ) ? proxyValue.status : undefined;
  const transcriptValue = isRecord(value.transcript) ? value.transcript : undefined;
  const subclipValue = isRecord(value.subclip) ? value.subclip : undefined;
  const parentSourceItemId = subclipValue ? string(subclipValue.parentSourceItemId, 128) : undefined;
  const subclipSourceInMs = subclipValue ? number(subclipValue.sourceInMs, 0, 0, 86_400_000) : 0;
  const subclipSourceOutMs = subclipValue
    ? number(subclipValue.sourceOutMs, subclipSourceInMs, subclipSourceInMs, 86_400_000)
    : 0;
  const generatedByValue = origin === 'generated' && isRecord(value.generatedBy) ? value.generatedBy : undefined;
  const generatedOperation = generatedByValue?.operation === 'tts' || generatedByValue?.operation === 'sound-effect'
    || generatedByValue?.operation === 'music' || generatedByValue?.operation === 'voice-change'
    || generatedByValue?.operation === 'voice-isolation' || generatedByValue?.operation === 'transcription'
    ? generatedByValue.operation
    : generatedByValue ? 'other' as const : undefined;
  const timingValue = generatedByValue && isRecord(generatedByValue.timing) ? generatedByValue.timing : undefined;
  return {
    version: VIDEO_PROFESSIONAL_STATE_VERSION,
    origin,
    onlineState,
    sourceFingerprint: string(value.sourceFingerprint, 256),
    proxy: status ? {
      status,
      scratchFileName: string(proxyValue?.scratchFileName, 512),
      width: optionalNumber(proxyValue?.width, 16, 16_384),
      height: optionalNumber(proxyValue?.height, 16, 16_384),
      videoCodec: string(proxyValue?.videoCodec, 64),
      sourceFingerprint: string(proxyValue?.sourceFingerprint, 256),
      progressPercent: optionalNumber(proxyValue?.progressPercent, 0, 100),
      error: string(proxyValue?.error, 1_000),
    } : undefined,
    color: sanitizeColorMetadata(value.color),
    transcript: transcriptValue ? {
      language: string(transcriptValue.language, 64),
      cues: Array.isArray(transcriptValue.cues)
        ? transcriptValue.cues.slice(0, MAX_PROFESSIONAL_TRANSCRIPT_CUES).flatMap((cue) => {
            const sanitized = sanitizeTranscriptCue(cue);
            return sanitized ? [sanitized] : [];
          })
        : [],
    } : undefined,
    tags: uniqueStrings(value.tags, 64, 64),
    rating: optionalNumber(value.rating, 0, 5),
    logging: sanitizeMediaLogging(value.logging),
    subclip: parentSourceItemId && subclipSourceOutMs > subclipSourceInMs ? {
      parentSourceItemId,
      sourceInMs: subclipSourceInMs,
      sourceOutMs: subclipSourceOutMs,
    } : undefined,
    generatedBy: generatedByValue && string(generatedByValue.provider, 128) ? {
      provider: string(generatedByValue.provider, 128)!,
      operation: generatedOperation ?? 'other',
      modelId: string(generatedByValue.modelId, 128),
      requestId: string(generatedByValue.requestId, 256),
      parentSourceItemIds: uniqueStrings(generatedByValue.parentSourceItemIds, 32, 128),
      generatedAt: number(generatedByValue.generatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
      timing: timingValue ? {
        words: Array.isArray(timingValue.words) ? timingValue.words.slice(0, MAX_PROFESSIONAL_TRANSCRIPT_CUES).flatMap((word) => {
          if (!isRecord(word)) return [];
          const wordText = string(word.text, 512);
          if (!wordText) return [];
          const startMs = number(word.startMs, 0, 0, 86_400_000);
          return [{
            text: wordText,
            startMs,
            endMs: number(word.endMs, startMs, startMs, 86_400_000),
          }];
        }) : [],
      } : undefined,
    } : undefined,
  };
}

function sanitizeParameterTracks(value: unknown): ProfessionalNumericParameterTrack[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tracks: ProfessionalNumericParameterTrack[] = [];
  let remaining = MAX_PROFESSIONAL_KEYFRAMES_PER_CLIP;
  for (const [trackIndex, entry] of value.slice(0, MAX_PROFESSIONAL_PARAMETER_TRACKS_PER_CLIP).entries()) {
    if (!isRecord(entry) || remaining <= 0) break;
    const parameter = string(entry.parameter, 256);
    if (!parameter) continue;
    const keyframes = Array.isArray(entry.keyframes)
      ? entry.keyframes.slice(0, Math.min(MAX_PROFESSIONAL_KEYFRAMES_PER_PARAMETER, remaining)).flatMap((keyframe, keyframeIndex) => {
          if (!isRecord(keyframe)) return [];
          const timeMs = number(keyframe.timeMs, 0, 0, 86_400_000);
          const interpolation: 'hold' | 'linear' | 'bezier' = keyframe.interpolation === 'hold' || keyframe.interpolation === 'bezier'
            ? keyframe.interpolation
            : 'linear';
          const bezier = interpolation === 'bezier' && isRecord(keyframe.bezier) ? {
            outX: number(keyframe.bezier.outX, 0.33, 0, 1),
            outY: number(keyframe.bezier.outY, 0.33, 0, 1),
            inX: number(keyframe.bezier.inX, 0.67, 0, 1),
            inY: number(keyframe.bezier.inY, 0.67, 0, 1),
          } : undefined;
          return [{
            id: string(keyframe.id, 128) ?? `parameter-keyframe-${trackIndex + 1}-${keyframeIndex + 1}`,
            timeMs,
            value: number(keyframe.value, 0, -1_000_000_000, 1_000_000_000),
            interpolation,
            bezier,
          }];
        }).sort((left, right) => left.timeMs - right.timeMs)
      : [];
    remaining -= keyframes.length;
    tracks.push({
      id: string(entry.id, 128) ?? `parameter-track-${trackIndex + 1}`,
      parameter,
      durationMs: typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs)
        ? number(entry.durationMs, 1, 1, 43_200_000)
        : undefined,
      keyframes,
    });
  }
  return tracks;
}

function sanitizeRetimeSegment(value: unknown): ProfessionalRetimeSegment | undefined {
  if (!isRecord(value)) return undefined;
  const id = string(value.id, 128);
  if (!id) return undefined;
  const timelineStartMs = number(value.timelineStartMs, 0, 0, 86_400_000);
  const timelineEndMs = number(value.timelineEndMs, timelineStartMs, timelineStartMs, 86_400_000);
  const interpolation = value.interpolation === 'blend' || value.interpolation === 'optical-flow'
    ? value.interpolation
    : 'nearest';
  return {
    id,
    timelineStartMs,
    timelineEndMs,
    speedPercent: number(value.speedPercent, 100, -10_000, 10_000),
    interpolation,
  };
}

function sanitizeColorCorrection(value: unknown): ProfessionalColorCorrection | undefined {
  if (!isRecord(value)) return undefined;
  const tuple = (candidate: unknown): [number, number, number] => {
    const entries = Array.isArray(candidate) ? candidate : [];
    return [0, 1, 2].map((index) => number(entries[index], 0, -2, 2)) as [number, number, number];
  };
  return {
    exposureStops: number(value.exposureStops, 0, -10, 10),
    contrast: number(value.contrast, 0, -100, 100),
    temperature: number(value.temperature, 0, -100, 100),
    tint: number(value.tint, 0, -100, 100),
    saturation: number(value.saturation, 100, 0, 400),
    lift: tuple(value.lift),
    gamma: tuple(value.gamma),
    gain: tuple(value.gain),
    inputLutName: string(value.inputLutName, 256),
  };
}

function sanitizeMask(value: unknown): ProfessionalMask | undefined {
  if (!isRecord(value)) return undefined;
  const id = string(value.id, 128);
  if (!id) return undefined;
  const kind = value.kind === 'ellipse' || value.kind === 'bezier' ? value.kind : 'rectangle';
  const tracking = isRecord(value.tracking) ? value.tracking : undefined;
  const trackingStatus = tracking && (
    tracking.status === 'idle' || tracking.status === 'tracking' || tracking.status === 'ready' || tracking.status === 'failed'
  ) ? tracking.status : 'idle';
  return {
    id,
    kind,
    points: Array.isArray(value.points) ? value.points.slice(0, 128).flatMap((point) => {
      if (!isRecord(point)) return [];
      return [{ x: number(point.x, 0.5, 0, 1), y: number(point.y, 0.5, 0, 1) }];
    }) : [],
    featherPercent: number(value.featherPercent, 0, 0, 100),
    opacityPercent: number(value.opacityPercent, 100, 0, 100),
    inverted: bool(value.inverted, false),
    tracking: tracking ? {
      status: trackingStatus,
      keyframes: Array.isArray(tracking.keyframes) ? tracking.keyframes.slice(0, 10_000).flatMap((keyframe) => {
        if (!isRecord(keyframe)) return [];
        return [{
          timeMs: number(keyframe.timeMs, 0, 0, 86_400_000),
          offsetX: number(keyframe.offsetX, 0, -4, 4),
          offsetY: number(keyframe.offsetY, 0, -4, 4),
          scale: number(keyframe.scale, 1, 0.01, 20),
        }];
      }) : [],
    } : undefined,
  };
}

function sanitizeStabilizationAnalysis(value: unknown): ProfessionalStabilizationAnalysisArtifact | undefined {
  if (!isRecord(value) || value.version !== 1 || value.status !== 'ready' || !Array.isArray(value.samples)) return undefined;
  const samples = value.samples.slice(0, 128).flatMap((sample) => {
    if (!isRecord(sample)) return [];
    return [{
      timeMs: number(sample.timeMs, 0, 0, 86_400_000),
      offsetX: number(sample.offsetX, 0, -1, 1),
      offsetY: number(sample.offsetY, 0, -1, 1),
      scale: number(sample.scale, 1, 0.01, 20),
    }];
  });
  if (samples.length === 0) return undefined;
  return { version: 1, status: 'ready', sourceFingerprint: string(value.sourceFingerprint, 256), samples };
}

export function sanitizeEditorVisualClipProfessionalState(
  value: unknown,
): EditorVisualClipProfessionalState | undefined {
  if (!isRecord(value)) return undefined;
  const stabilization = isRecord(value.stabilization) ? value.stabilization : undefined;
  return {
    trackId: string(value.trackId, 128),
    linkGroupId: string(value.linkGroupId, 128),
    syncGroupId: string(value.syncGroupId, 128),
    syncOffsetFrames: optionalNumber(value.syncOffsetFrames, -1_000_000, 1_000_000),
    nestedSequenceId: string(value.nestedSequenceId, 128),
    adjustmentLayer: typeof value.adjustmentLayer === 'boolean' ? value.adjustmentLayer : undefined,
    multicamSourceId: string(value.multicamSourceId, 128),
    multicamAngleId: string(value.multicamAngleId, 128),
    retime: Array.isArray(value.retime)
      ? value.retime.slice(0, MAX_PROFESSIONAL_RETIME_SEGMENTS).flatMap((segment) => {
          const sanitized = sanitizeRetimeSegment(segment);
          return sanitized ? [sanitized] : [];
        })
      : undefined,
    color: sanitizeColorCorrection(value.color),
    masks: Array.isArray(value.masks)
      ? value.masks.slice(0, MAX_PROFESSIONAL_MASKS_PER_CLIP).flatMap((mask) => {
          const sanitized = sanitizeMask(mask);
          return sanitized ? [sanitized] : [];
        })
      : undefined,
    stabilization: stabilization ? {
      enabled: bool(stabilization.enabled, false),
      strengthPercent: number(stabilization.strengthPercent, 50, 0, 100),
      cropMode: stabilization.cropMode === 'none' ? 'none' : 'auto-scale',
      analysis: sanitizeStabilizationAnalysis(stabilization.analysis),
    } : undefined,
    chromaKeyMode: value.chromaKeyMode === 'green' || value.chromaKeyMode === 'blue' || value.chromaKeyMode === 'custom'
      ? value.chromaKeyMode
      : value.chromaKeyMode === 'off' ? 'off' : undefined,
    parameterKeyframes: sanitizeParameterTracks(value.parameterKeyframes),
  };
}

export function sanitizeEditorAudioClipProfessionalState(
  value: unknown,
): EditorAudioClipProfessionalState | undefined {
  if (!isRecord(value)) return undefined;
  return {
    trackId: string(value.trackId, 128),
    linkGroupId: string(value.linkGroupId, 128),
    syncGroupId: string(value.syncGroupId, 128),
    syncOffsetFrames: optionalNumber(value.syncOffsetFrames, -1_000_000, 1_000_000),
    pan: number(value.pan, 0, -1, 1),
    busId: string(value.busId, 128),
    channelMap: Array.isArray(value.channelMap)
      ? value.channelMap.slice(0, 32).flatMap((channel) => {
          const normalized = optionalNumber(channel, 0, 31);
          return normalized === undefined ? [] : [Math.round(normalized)];
      })
      : undefined,
    parameterKeyframes: sanitizeParameterTracks(value.parameterKeyframes),
  };
}

function sanitizeTrack(value: unknown): ProfessionalTrack | undefined {
  if (!isRecord(value)) return undefined;
  const id = string(value.id, 128);
  const name = string(value.name, 128);
  const kind = value.kind === 'video' || value.kind === 'audio' || value.kind === 'subtitle' ? value.kind : undefined;
  if (!id || !name || !kind) return undefined;
  const role = value.role === 'standard' || value.role === 'overlay' || value.role === 'adjustment'
    || value.role === 'dialogue' || value.role === 'music' || value.role === 'effects' ? value.role : undefined;
  return {
    id, name, kind, role,
    order: Math.round(number(value.order, 0, 0, MAX_PROFESSIONAL_TRACKS - 1)),
    enabled: bool(value.enabled, true),
    locked: bool(value.locked, false),
    muted: typeof value.muted === 'boolean' ? value.muted : undefined,
    solo: typeof value.solo === 'boolean' ? value.solo : undefined,
    syncLocked: typeof value.syncLocked === 'boolean' ? value.syncLocked : undefined,
    sourcePatched: typeof value.sourcePatched === 'boolean' ? value.sourcePatched : undefined,
  };
}

function sanitizeSequence(value: unknown): ProfessionalSequenceReference | undefined {
  if (!isRecord(value)) return undefined;
  const id = string(value.id, 128);
  const name = string(value.name, 128);
  if (!id || !name) return undefined;
  return {
    id, name,
    durationMs: number(value.durationMs, 0, 0, 86_400_000),
    frameRate: number(value.frameRate, 30, 1, 240),
    parentSequenceId: string(value.parentSequenceId, 128),
    // Full clip normalization is owned by the executable Runtime IR. This persistence boundary
    // retains only bounded record-shaped children, so malformed saved state never becomes a
    // renderer input merely by reopening a project.
    visualClips: Array.isArray(value.visualClips)
      ? value.visualClips.slice(0, 2_000).flatMap((clip) => isRecord(clip)
        && typeof clip.id === 'string' && clip.id.length > 0 && clip.id.length <= 128
        && typeof clip.sourceNodeId === 'string' && clip.sourceNodeId.length > 0 && clip.sourceNodeId.length <= 128
        ? [clip as unknown as EditorVisualClip]
        : [])
      : undefined,
  };
}

function sanitizeMulticam(value: unknown): ProfessionalMulticamSource | undefined {
  if (!isRecord(value)) return undefined;
  const id = string(value.id, 128);
  const name = string(value.name, 128);
  if (!id || !name) return undefined;
  const cuts = Array.isArray(value.cuts) ? value.cuts.slice(0, 1_000).flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const cutId = string(candidate.id, 128);
    const angleSourceId = string(candidate.angleSourceId, 128);
    const timelineMs = number(candidate.timelineMs, Number.NaN, 0, 86_400_000);
    return cutId && angleSourceId && Number.isFinite(timelineMs)
      ? [{ id: cutId, angleSourceId, timelineMs: Math.round(timelineMs) }]
      : [];
  }) : undefined;
  return {
    id, name,
    angleSourceIds: uniqueStrings(value.angleSourceIds, 16, 128),
    syncMethod: value.syncMethod === 'manual' || value.syncMethod === 'timecode' || value.syncMethod === 'markers' ? value.syncMethod : 'audio',
    activeAngleId: string(value.activeAngleId, 128),
    cuts,
    audioFollowsVideo: bool(value.audioFollowsVideo, true),
  };
}

function sanitizeBus(value: unknown): ProfessionalAudioBus | undefined {
  if (!isRecord(value)) return undefined;
  const id = string(value.id, 128);
  const name = string(value.name, 128);
  if (!id || !name) return undefined;
  return {
    id, name,
    kind: value.kind === 'submix' ? 'submix' : 'master',
    gainDb: number(value.gainDb, 0, -96, 24),
    pan: number(value.pan, 0, -1, 1),
    muted: bool(value.muted, false),
    solo: bool(value.solo, false),
    outputBusId: string(value.outputBusId, 128),
    targetLufs: optionalNumber(value.targetLufs, -36, -5),
    truePeakCeilingDbtp: optionalNumber(value.truePeakCeilingDbtp, -20, 0),
  };
}

function sanitizeLoudnessNormalization(value: unknown): ProfessionalLoudnessNormalization | undefined {
  if (!isRecord(value)) return undefined;
  return {
    enabled: bool(value.enabled, false),
    targetLufs: number(value.targetLufs, -14, -70, -5),
    loudnessRangeLu: number(value.loudnessRangeLu, 7, 1, 50),
    truePeakCeilingDbtp: number(value.truePeakCeilingDbtp, -1, -9, 0),
  };
}

export function sanitizeEditorProfessionalVideoState(
  value: unknown,
): EditorProfessionalVideoState | undefined {
  if (!isRecord(value)) return undefined;
  const defaults = createDefaultEditorProfessionalVideoState();
  const workingColorSpace = value.workingColorSpace === 'display-p3' || value.workingColorSpace === 'rec2020-pq'
    || value.workingColorSpace === 'rec2020-hlg' ? value.workingColorSpace : 'rec709';
  return {
    version: VIDEO_PROFESSIONAL_STATE_VERSION,
    proxyPlaybackEnabled: bool(value.proxyPlaybackEnabled, true),
    tracks: Array.isArray(value.tracks) ? value.tracks.slice(0, MAX_PROFESSIONAL_TRACKS).flatMap((track) => {
      const sanitized = sanitizeTrack(track);
      return sanitized ? [sanitized] : [];
    }) : [],
    sequences: Array.isArray(value.sequences) ? value.sequences.slice(0, MAX_PROFESSIONAL_SEQUENCES).flatMap((sequence) => {
      const sanitized = sanitizeSequence(sequence);
      return sanitized ? [sanitized] : [];
    }) : [],
    multicamSources: Array.isArray(value.multicamSources)
      ? value.multicamSources.slice(0, MAX_PROFESSIONAL_MULTICAM_SOURCES).flatMap((source) => {
          const sanitized = sanitizeMulticam(source);
          return sanitized ? [sanitized] : [];
        })
      : [],
    audioBuses: Array.isArray(value.audioBuses) ? value.audioBuses.slice(0, MAX_PROFESSIONAL_AUDIO_BUSES).flatMap((bus) => {
      const sanitized = sanitizeBus(bus);
      return sanitized ? [sanitized] : [];
    }) : defaults.audioBuses,
    loudnessNormalization: sanitizeLoudnessNormalization(value.loudnessNormalization) ?? defaults.loudnessNormalization,
    workingColorSpace,
    toneMapping: value.toneMapping === 'hdr-to-sdr' ? 'hdr-to-sdr' : 'none',
    adjustmentLayerClipIds: uniqueStrings(value.adjustmentLayerClipIds, 2_000, 128),
    transcriptRemovedCueIds: uniqueStrings(value.transcriptRemovedCueIds, MAX_PROFESSIONAL_TRANSCRIPT_CUES, 128),
    interchangeHistory: Array.isArray(value.interchangeHistory)
      ? value.interchangeHistory.slice(-100).flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const id = string(entry.id, 128);
          const format = entry.format === 'fcp7-xml' || entry.format === 'edl' || entry.format === 'otio' || entry.format === 'aaf-handoff'
            ? entry.format : undefined;
          if (!id || !format) return [];
          return [{
            id,
            format,
            direction: entry.direction === 'import' ? 'import' as const : 'export' as const,
            createdAt: number(entry.createdAt, 0, 0, Number.MAX_SAFE_INTEGER),
            warnings: uniqueStrings(entry.warnings, 100, 1_000),
          }];
        })
      : [],
  };
}
