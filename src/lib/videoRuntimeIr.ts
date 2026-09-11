import { sha256Hex } from '../shared/crypto/sha256';
import type {
  EditorAudioClip,
  EditorStageObject,
  EditorVisualClip,
} from '../types/flow';
import type {
  EditorAudioClipProfessionalState,
  EditorProfessionalVideoState,
  ProfessionalAudioBus,
} from '../types/videoProfessional';
import type {
  VideoProductionTimebase,
  VideoSemanticCaptionTrack,
} from '../types/videoProduction';
import { hasEnabledEditorAudioProcessing } from './editorAudioProcessing';

/**
 * Sloom-owned, backend-neutral Video runtime contract.
 *
 * Project JSON remains canonical. This IR is a deterministic compilation artifact consumed by
 * preview, export, scopes, and cache planning. It deliberately contains no URL or filesystem path;
 * renderers resolve rendition ids through a separate, authority-scoped binding table.
 */
export const VIDEO_RUNTIME_IR_SCHEMA = 'sloom.video-runtime-ir' as const;
export const VIDEO_RUNTIME_IR_VERSION = 1 as const;
export const MAX_VIDEO_RUNTIME_IR_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_RUNTIME_SOURCES = 20_000;
export const MAX_VIDEO_RUNTIME_VISUAL_CLIPS = 20_000;
export const MAX_VIDEO_RUNTIME_AUDIO_CLIPS = 20_000;
export const MAX_VIDEO_RUNTIME_STAGE_OBJECTS = 20_000;
export const MAX_VIDEO_RUNTIME_TRACKS = 1_024;
export const MAX_VIDEO_RUNTIME_CAPTION_TRACKS = 64;
export const MAX_VIDEO_RUNTIME_CAPTION_CUES = 20_000;
export const MAX_VIDEO_RUNTIME_EFFECTS = 100_000;
export const MAX_VIDEO_RUNTIME_KEYFRAMES = 200_000;
export const MAX_VIDEO_RUNTIME_ID_CHARS = 256;
export const MAX_VIDEO_RUNTIME_TEXT_CHARS = 262_144;
export const MAX_VIDEO_RUNTIME_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

export type VideoRuntimeCapabilityId =
  | 'runtime:adjustment-layer'
  | 'runtime:audio-routing'
  | 'runtime:audio-processing'
  | 'runtime:captions'
  | 'runtime:color-management'
  | 'runtime:color-correction'
  | 'runtime:masks'
  | 'runtime:multicam'
  | 'runtime:nested-sequence'
  | 'runtime:parameter-keyframes'
  | 'runtime:retime'
  | 'runtime:stabilization'
  | 'runtime:stream-selection'
  | 'lut3d'
  | 'minterpolate'
  | 'vidstab'
  | 'zscale';

export interface VideoRuntimeRational {
  numerator: number;
  denominator: number;
}

export interface VideoRuntimeTimeRange {
  start: VideoRuntimeRational;
  duration: VideoRuntimeRational;
}

export type VideoRuntimeJson =
  | null
  | boolean
  | number
  | string
  | VideoRuntimeJson[]
  | { [key: string]: VideoRuntimeJson };

export interface VideoRuntimeRendition {
  id: string;
  role: 'original' | 'preview';
  fingerprint?: string;
}

export interface VideoRuntimeSource {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'composition' | 'text' | 'shape' | 'comic';
  sourceFingerprint?: string;
  streams: {
    video: number[];
    audio: number[];
  };
  renditions: VideoRuntimeRendition[];
}

export interface VideoRuntimeEffect {
  id: string;
  kind: string;
  enabled: boolean;
  parameters: { [key: string]: VideoRuntimeJson };
  requiredCapabilities: VideoRuntimeCapabilityId[];
}

export interface VideoRuntimeTransform {
  fitMode: 'contain' | 'cover' | 'stretch';
  position: { xPercent: number; yPercent: number };
  scalePercent: number;
  rotationDegrees: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  crop: {
    leftPercent: number;
    rightPercent: number;
    topPercent: number;
    bottomPercent: number;
    panXPercent: number;
    panYPercent: number;
    rotationDegrees: number;
  };
  animation: {
    motionEnabled: boolean;
    endPositionXPercent: number;
    endPositionYPercent: number;
    scaleEnabled: boolean;
    endScalePercent: number;
    rotationEnabled: boolean;
    endRotationDegrees: number;
    keyframes: Array<{
      timePercent: number;
      positionXPercent: number;
      positionYPercent: number;
      scalePercent: number;
      rotationDegrees: number;
      opacityPercent: number;
      tailTipXPercent?: number;
      tailTipYPercent?: number;
      tailCurvePercent?: number;
    }>;
  };
}

export interface VideoRuntimeVisualClip {
  id: string;
  sourceId: string;
  sourceKind: VideoRuntimeSource['kind'];
  role: 'media' | 'generator' | 'nested-sequence' | 'adjustment' | 'multicam-angle';
  trackId: string;
  trackOrder: number;
  compositingOrder: number;
  recordRange: VideoRuntimeTimeRange;
  /** Includes an edit-point dissolve's pre-roll when one is active. */
  activeRange: VideoRuntimeTimeRange;
  sourceRange: VideoRuntimeTimeRange;
  streamIndex: number;
  playback: {
    rate: VideoRuntimeRational;
    reverse: boolean;
    retimeSegments: VideoRuntimeJson[];
  };
  transform: VideoRuntimeTransform;
  compositing: {
    opacityPercent: number;
    opacityAutomation: Array<{ timePercent: number; valuePercent: number }>;
    blendMode: string;
  };
  transitions: {
    in: string;
    out: string;
    duration: VideoRuntimeRational;
    editPointDissolve: boolean;
  };
  effects: VideoRuntimeEffect[];
  parameterAutomation: VideoRuntimeJson[];
  color?: { [key: string]: VideoRuntimeJson };
  masks: VideoRuntimeJson[];
  generator?: {
    kind: 'text' | 'shape' | 'comic';
    parameters: { [key: string]: VideoRuntimeJson };
  };
  nestedSequenceId?: string;
  nestedRevision?: string;
  multicam?: {
    sourceId: string;
    angleId?: string;
  };
  requiredCapabilities: VideoRuntimeCapabilityId[];
}

export interface VideoRuntimeAudioClip {
  id: string;
  sourceId: string;
  sourceKind: 'audio' | 'video' | 'composition';
  trackId: string;
  trackOrder: number;
  recordRange: VideoRuntimeTimeRange;
  sourceRange: VideoRuntimeTimeRange;
  streamIndex: number;
  enabled: boolean;
  gain: {
    clipPercent: number;
    trackPercent: number;
    measuredMatchDb: number;
    fades: { in: VideoRuntimeRational; out: VideoRuntimeRational };
    automation: Array<{ timePercent: number; valuePercent: number }>;
    keyframes: Array<{ timePercent: number; volumePercent: number }>;
  };
  routing: {
    pan: number;
    busId: string;
    channelMap: number[];
  };
  processing?: { [key: string]: VideoRuntimeJson };
  parameterAutomation: VideoRuntimeJson[];
  requiredCapabilities: VideoRuntimeCapabilityId[];
}

export interface VideoRuntimeCaptionCue {
  id: string;
  range: VideoRuntimeTimeRange;
  text: string;
  speaker?: string;
  position?: 'top' | 'center' | 'bottom';
}

export interface VideoRuntimeCaptionTrack {
  id: string;
  name: string;
  language: string;
  service: 'captions' | 'subtitles' | 'sdh';
  style: { [key: string]: VideoRuntimeJson };
  cues: VideoRuntimeCaptionCue[];
}

export interface VideoRuntimeStageObject {
  id: string;
  kind: EditorStageObject['kind'];
  compositingOrder: number;
  activeRange: VideoRuntimeTimeRange;
  parameters: { [key: string]: VideoRuntimeJson };
}

export interface VideoRuntimeDependency {
  sequenceId: string;
  revision?: string;
  referenceClipIds: string[];
}

export interface VideoRuntimeIr {
  schema: typeof VIDEO_RUNTIME_IR_SCHEMA;
  version: typeof VIDEO_RUNTIME_IR_VERSION;
  sequence: {
    id: string;
    canvas: { width: number; height: number };
    timebase: {
      framesPerSecond: VideoRuntimeRational;
      dropFrame: boolean;
      sequenceStartTimecode: string;
    };
    duration: VideoRuntimeRational;
    workingColorSpace: string;
    toneMapping: string;
  };
  sources: VideoRuntimeSource[];
  visualClips: VideoRuntimeVisualClip[];
  audioClips: VideoRuntimeAudioClip[];
  stageObjects: VideoRuntimeStageObject[];
  captionTracks: VideoRuntimeCaptionTrack[];
  audioBuses: ProfessionalAudioBus[];
  dependencies: VideoRuntimeDependency[];
  requiredCapabilities: VideoRuntimeCapabilityId[];
}

export type VideoRuntimeVisualClipInput = Partial<EditorVisualClip> & Pick<
  EditorVisualClip,
  'sourceNodeId' | 'sourceKind' | 'trackIndex' | 'startMs'
>;

export type VideoRuntimeAudioClipInput = Partial<Omit<EditorAudioClip, 'professional'>> & Pick<
  EditorAudioClip,
  'sourceNodeId' | 'trackIndex' | 'offsetMs'
> & {
  sourceKind?: 'audio' | 'video' | 'composition';
  trackVolumePercent?: number;
  professional?: Partial<EditorAudioClipProfessionalState>;
};

export interface VideoRuntimeResolvedVisualInput {
  clip: VideoRuntimeVisualClipInput;
  durationMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  sourceFingerprint?: string;
  previewFingerprint?: string;
  hasPreviewRendition?: boolean;
  videoStreamIndex?: number;
}

export interface VideoRuntimeResolvedAudioInput {
  clip: VideoRuntimeAudioClipInput;
  durationMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  sourceFingerprint?: string;
  previewFingerprint?: string;
  hasPreviewRendition?: boolean;
  audioStreamIndex?: number;
}

export interface VideoRuntimeCompileInput {
  sequenceId: string;
  canvas: { width: number; height: number };
  durationMs: number;
  frameRate?: number;
  timebase?: VideoProductionTimebase;
  visualClips: readonly VideoRuntimeResolvedVisualInput[];
  audioClips: readonly VideoRuntimeResolvedAudioInput[];
  stageObjects?: readonly EditorStageObject[];
  captionTracks?: readonly VideoSemanticCaptionTrack[];
  professionalState?: EditorProfessionalVideoState;
  nestedSequenceRevisions?: Readonly<Record<string, string>>;
}

export type VideoRuntimeCompileResult =
  | { ok: true; ir: VideoRuntimeIr; revision: string; warnings: string[] }
  | { ok: false; errors: string[] };

export type VideoRuntimeAdapterTarget = 'preview' | 'export' | 'scope';

export interface VideoRuntimeSourceSelection {
  sourceId: string;
  renditionId: string;
  role: 'original' | 'preview';
}

export interface VideoRuntimeAdapterPlan {
  ok: true;
  target: VideoRuntimeAdapterTarget;
  irRevision: string;
  sourceSelections: VideoRuntimeSourceSelection[];
  orderedVisualClipIds: string[];
  orderedAudioClipIds: string[];
  activeVisualClipIds: string[];
  requiredCapabilities: VideoRuntimeCapabilityId[];
}

export interface VideoRuntimeAdapterUnavailable {
  ok: false;
  target: VideoRuntimeAdapterTarget;
  reason: string;
  errors: string[];
  missingCapabilities: VideoRuntimeCapabilityId[];
}

const DEFAULT_TIMEBASE: VideoProductionTimebase = {
  numerator: 30,
  denominator: 1,
  dropFrame: false,
  sequenceStartTimecode: '00:00:00:00',
  mixedRatePolicy: 'preserve-time',
};

export function createVideoRuntimeRational(numerator: number, denominator = 1): VideoRuntimeRational {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new Error('Runtime rational values require safe integer numerators and a non-zero safe integer denominator.');
  }
  const sign = denominator < 0 ? -1 : 1;
  const divisor = greatestCommonDivisor(Math.abs(numerator), Math.abs(denominator));
  return {
    numerator: sign * numerator / divisor,
    denominator: Math.abs(denominator) / divisor,
  };
}

export function videoRuntimeRationalFromMilliseconds(milliseconds: number): VideoRuntimeRational {
  if (!Number.isFinite(milliseconds)) throw new Error('Runtime time must be finite.');
  return createVideoRuntimeRational(Math.round(milliseconds), 1_000);
}

export function videoRuntimeRationalFromRate(rate: number): VideoRuntimeRational {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Runtime rate must be finite and greater than zero.');
  return createVideoRuntimeRational(Math.round(rate * 1_000_000), 1_000_000);
}

export function videoRuntimeRationalToMilliseconds(value: VideoRuntimeRational): number {
  return (value.numerator / value.denominator) * 1_000;
}

export function videoRuntimeTimeRangeFromMilliseconds(startMs: number, durationMs: number): VideoRuntimeTimeRange {
  return {
    start: videoRuntimeRationalFromMilliseconds(startMs),
    duration: videoRuntimeRationalFromMilliseconds(durationMs),
  };
}

export function videoRuntimeTimeRangeToMilliseconds(range: VideoRuntimeTimeRange): {
  startMs: number;
  endMs: number;
  durationMs: number;
} {
  const startMs = videoRuntimeRationalToMilliseconds(range.start);
  const durationMs = videoRuntimeRationalToMilliseconds(range.duration);
  return { startMs, endMs: startMs + durationMs, durationMs };
}

export function compileVideoRuntimeIr(input: VideoRuntimeCompileInput): VideoRuntimeCompileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const timebase = normalizeTimebase(input.timebase, input.frameRate, errors);
  const durationMs = integerMilliseconds(input.durationMs, 'sequence duration', errors, { positive: true });
  const canvas = normalizeCanvas(input.canvas, errors);
  const sequenceId = boundedId(input.sequenceId, 'sequence id', errors);

  if (input.visualClips.length > MAX_VIDEO_RUNTIME_VISUAL_CLIPS) {
    errors.push(`Runtime IR supports at most ${MAX_VIDEO_RUNTIME_VISUAL_CLIPS.toLocaleString()} visual clips.`);
  }
  if (input.audioClips.length > MAX_VIDEO_RUNTIME_AUDIO_CLIPS) {
    errors.push(`Runtime IR supports at most ${MAX_VIDEO_RUNTIME_AUDIO_CLIPS.toLocaleString()} audio clips.`);
  }
  if ((input.captionTracks?.length ?? 0) > MAX_VIDEO_RUNTIME_CAPTION_TRACKS) {
    errors.push(`Runtime IR supports at most ${MAX_VIDEO_RUNTIME_CAPTION_TRACKS} caption tracks.`);
  }
  if ((input.stageObjects?.length ?? 0) > MAX_VIDEO_RUNTIME_STAGE_OBJECTS) {
    errors.push(`Runtime IR supports at most ${MAX_VIDEO_RUNTIME_STAGE_OBJECTS.toLocaleString()} stage objects.`);
  }

  const sourceById = new Map<string, VideoRuntimeSource>();
  const visualClips = input.visualClips.slice(0, MAX_VIDEO_RUNTIME_VISUAL_CLIPS).map((entry, index) => {
    const clip = compileVisualClip(entry, index, input, errors);
    registerSource(sourceById, {
      id: clip.sourceId,
      kind: clip.sourceKind,
      fingerprint: entry.sourceFingerprint,
      previewFingerprint: entry.previewFingerprint,
      hasPreview: entry.hasPreviewRendition === true,
      videoStreamIndex: clip.streamIndex,
    }, errors);
    return clip;
  });

  applyEditPointDissolveRanges(visualClips);

  const audioClips = input.audioClips.slice(0, MAX_VIDEO_RUNTIME_AUDIO_CLIPS).map((entry, index) => {
    const clip = compileAudioClip(entry, index, errors);
    registerSource(sourceById, {
      id: clip.sourceId,
      kind: clip.sourceKind,
      fingerprint: entry.sourceFingerprint,
      previewFingerprint: entry.previewFingerprint,
      hasPreview: entry.hasPreviewRendition === true,
      audioStreamIndex: clip.streamIndex,
    }, errors);
    return clip;
  });

  const captionTracks = compileCaptionTracks(input.captionTracks ?? [], errors);
  const stageObjects = compileStageObjects(input.stageObjects ?? [], durationMs, errors);
  const dependencies = buildDependencies(visualClips);
  const sources = [...sourceById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const requiredCapabilities = uniqueSortedCapabilities([
    ...visualClips.flatMap((clip) => clip.requiredCapabilities),
    ...audioClips.flatMap((clip) => clip.requiredCapabilities),
    ...(captionTracks.length > 0 ? ['runtime:captions' as const] : []),
    ...(needsManagedColorPipeline(input.professionalState)
      ? ['runtime:color-management' as const, 'zscale' as const]
      : []),
    ...(needsAudioBusRuntime(input.professionalState?.audioBuses ?? [])
      ? ['runtime:audio-routing' as const]
      : []),
  ]);

  if (sources.length > MAX_VIDEO_RUNTIME_SOURCES) {
    errors.push(`Runtime IR supports at most ${MAX_VIDEO_RUNTIME_SOURCES.toLocaleString()} sources.`);
  }

  const ir: VideoRuntimeIr = {
    schema: VIDEO_RUNTIME_IR_SCHEMA,
    version: VIDEO_RUNTIME_IR_VERSION,
    sequence: {
      id: sequenceId,
      canvas,
      timebase,
      duration: videoRuntimeRationalFromMilliseconds(durationMs),
      workingColorSpace: input.professionalState?.workingColorSpace ?? 'rec709',
      toneMapping: input.professionalState?.toneMapping ?? 'none',
    },
    sources,
    visualClips: visualClips.sort(compareVisualRuntimeClips),
    audioClips: audioClips.sort(compareAudioRuntimeClips),
    stageObjects,
    captionTracks,
    audioBuses: cloneAudioBuses(input.professionalState?.audioBuses ?? [], errors),
    dependencies,
    requiredCapabilities,
  };

  errors.push(...validateVideoRuntimeIr(ir));
  const serialized = stableSerialize(ir);
  if (new TextEncoder().encode(serialized).byteLength > MAX_VIDEO_RUNTIME_IR_BYTES) {
    errors.push(`Runtime IR exceeds the ${MAX_VIDEO_RUNTIME_IR_BYTES.toLocaleString()}-byte serialized limit.`);
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  if (visualClips.length === 0 && stageObjects.length === 0) {
    warnings.push('The runtime graph has no visual clip or stage object.');
  }
  return { ok: true, ir, revision: hashVideoRuntimeIr(ir), warnings };
}

export function validateVideoRuntimeIr(ir: VideoRuntimeIr): string[] {
  const errors: string[] = [];
  if (ir.schema !== VIDEO_RUNTIME_IR_SCHEMA || ir.version !== VIDEO_RUNTIME_IR_VERSION) {
    errors.push('Runtime IR schema/version is unsupported.');
  }
  validateRational(ir.sequence.duration, 'sequence duration', errors, true);
  validateRational(ir.sequence.timebase.framesPerSecond, 'sequence frame rate', errors, true);
  if (!Number.isInteger(ir.sequence.canvas.width) || !Number.isInteger(ir.sequence.canvas.height)
    || ir.sequence.canvas.width <= 0 || ir.sequence.canvas.height <= 0
    || ir.sequence.canvas.width > 16_384 || ir.sequence.canvas.height > 16_384) {
    errors.push('Runtime IR canvas dimensions must be positive integers no larger than 16384.');
  }

  const sourceIds = uniqueIdSet(ir.sources.map((source) => source.id), 'source', errors);
  const visualIds = uniqueIdSet(ir.visualClips.map((clip) => clip.id), 'visual clip', errors);
  const audioIds = uniqueIdSet(ir.audioClips.map((clip) => clip.id), 'audio clip', errors);
  uniqueIdSet([...visualIds, ...audioIds], 'timeline clip', errors);
  uniqueIdSet(ir.captionTracks.map((track) => track.id), 'caption track', errors);
  uniqueIdSet(ir.stageObjects.map((object) => object.id), 'stage object', errors);
  if (ir.sources.length > MAX_VIDEO_RUNTIME_SOURCES) errors.push('Runtime IR exceeds the source limit.');
  if (ir.visualClips.length > MAX_VIDEO_RUNTIME_VISUAL_CLIPS) errors.push('Runtime IR exceeds the visual clip limit.');
  if (ir.audioClips.length > MAX_VIDEO_RUNTIME_AUDIO_CLIPS) errors.push('Runtime IR exceeds the audio clip limit.');
  if (ir.stageObjects.length > MAX_VIDEO_RUNTIME_STAGE_OBJECTS) errors.push('Runtime IR exceeds the stage object limit.');
  if (ir.captionTracks.length > MAX_VIDEO_RUNTIME_CAPTION_TRACKS) errors.push('Runtime IR exceeds the caption track limit.');

  for (const source of ir.sources) {
    if (source.renditions.length === 0 || !source.renditions.some((rendition) => rendition.role === 'original')) {
      errors.push(`Source '${source.id}' is missing its original rendition.`);
    }
    for (const rendition of source.renditions) {
      if (/[/\\]|:\/\//u.test(rendition.id) || rendition.id.includes('\0')) {
        errors.push(`Source '${source.id}' has a non-opaque rendition id.`);
      }
    }
    for (const streamIndex of [...source.streams.video, ...source.streams.audio]) {
      if (!Number.isInteger(streamIndex) || streamIndex < 0 || streamIndex > 255) {
        errors.push(`Source '${source.id}' has an invalid stream index.`);
      }
    }
  }

  for (const clip of ir.visualClips) {
    validateClipRange(clip.recordRange, `visual clip '${clip.id}' record range`, errors);
    validateClipRange(clip.activeRange, `visual clip '${clip.id}' active range`, errors);
    validateClipRange(clip.sourceRange, `visual clip '${clip.id}' source range`, errors);
    if (!sourceIds.has(clip.sourceId)) errors.push(`Visual clip '${clip.id}' references missing source '${clip.sourceId}'.`);
    if (!Number.isInteger(clip.trackOrder) || clip.trackOrder < 0 || clip.trackOrder >= MAX_VIDEO_RUNTIME_TRACKS) {
      errors.push(`Visual clip '${clip.id}' has an invalid track order.`);
    }
    if (clip.nestedSequenceId === ir.sequence.id) errors.push(`Visual clip '${clip.id}' creates a direct sequence cycle.`);
  }
  for (const clip of ir.audioClips) {
    validateClipRange(clip.recordRange, `audio clip '${clip.id}' record range`, errors);
    validateClipRange(clip.sourceRange, `audio clip '${clip.id}' source range`, errors);
    if (!sourceIds.has(clip.sourceId)) errors.push(`Audio clip '${clip.id}' references missing source '${clip.sourceId}'.`);
    if (!Number.isInteger(clip.trackOrder) || clip.trackOrder < 0 || clip.trackOrder >= MAX_VIDEO_RUNTIME_TRACKS) {
      errors.push(`Audio clip '${clip.id}' has an invalid track order.`);
    }
  }
  for (const track of ir.captionTracks) {
    const cueIds = uniqueIdSet(track.cues.map((cue) => cue.id), `caption cue in '${track.id}'`, errors);
    if (cueIds.size !== track.cues.length) continue;
    for (const cue of track.cues) validateClipRange(cue.range, `caption cue '${cue.id}'`, errors);
  }
  const captionCueCount = ir.captionTracks.reduce((sum, track) => sum + track.cues.length, 0);
  if (captionCueCount > MAX_VIDEO_RUNTIME_CAPTION_CUES) errors.push('Runtime IR exceeds the caption cue limit.');

  const effectCount = ir.visualClips.reduce((sum, clip) => sum + clip.effects.length, 0);
  if (effectCount > MAX_VIDEO_RUNTIME_EFFECTS) errors.push('Runtime IR exceeds the effect limit.');
  const keyframeCount = ir.visualClips.reduce(
    (sum, clip) => sum + clip.transform.animation.keyframes.length + clip.parameterAutomation.length,
    0,
  ) + ir.audioClips.reduce(
    (sum, clip) => sum + clip.gain.automation.length + clip.gain.keyframes.length + clip.parameterAutomation.length,
    0,
  );
  if (keyframeCount > MAX_VIDEO_RUNTIME_KEYFRAMES) errors.push('Runtime IR exceeds the keyframe limit.');
  if (new TextEncoder().encode(stableSerialize(ir)).byteLength > MAX_VIDEO_RUNTIME_IR_BYTES) {
    errors.push(`Runtime IR exceeds the ${MAX_VIDEO_RUNTIME_IR_BYTES.toLocaleString()}-byte serialized limit.`);
  }
  return [...new Set(errors)];
}

export function hashVideoRuntimeIr(ir: VideoRuntimeIr): string {
  const bytes = new TextEncoder().encode(stableSerialize(ir));
  return `video-runtime-ir-v${VIDEO_RUNTIME_IR_VERSION}:${sha256Hex(bytes)}`;
}

export function buildVideoRuntimeCacheKey(
  ir: VideoRuntimeIr,
  input: {
    workerCapabilityFingerprint: string;
    renderSettings?: VideoRuntimeJson;
    sourceDigests?: Readonly<Record<string, string>>;
  },
): string {
  const fingerprint = boundedText(input.workerCapabilityFingerprint, 'worker capability fingerprint');
  const sourceDigests = Object.fromEntries(Object.entries(input.sourceDigests ?? {}).sort(([left], [right]) => left.localeCompare(right)));
  const serialized = stableSerialize({
    irRevision: hashVideoRuntimeIr(ir),
    runtimeSchema: `${VIDEO_RUNTIME_IR_SCHEMA}@${VIDEO_RUNTIME_IR_VERSION}`,
    workerCapabilityFingerprint: fingerprint,
    renderSettings: toRuntimeJson(input.renderSettings ?? null, 'render settings'),
    sourceDigests,
  });
  return `video-runtime-cache-v1:${sha256Hex(new TextEncoder().encode(serialized))}`;
}

export function compileVideoRuntimeAdapterPlan(
  ir: VideoRuntimeIr,
  options: {
    target: VideoRuntimeAdapterTarget;
    atMilliseconds?: number;
    availableCapabilities?: readonly VideoRuntimeCapabilityId[];
    allowPreviewRenditions?: boolean;
  },
): VideoRuntimeAdapterPlan | VideoRuntimeAdapterUnavailable {
  const errors = validateVideoRuntimeIr(ir);
  const available = new Set(options.availableCapabilities ?? []);
  const missingCapabilities = ir.requiredCapabilities.filter((capability) => !available.has(capability));
  if (errors.length > 0 || missingCapabilities.length > 0) {
    return {
      ok: false,
      target: options.target,
      reason: errors[0] ?? `Runtime adapter is missing ${missingCapabilities.join(', ')}.`,
      errors,
      missingCapabilities,
    };
  }

  const sourceSelections = ir.sources.map((source): VideoRuntimeSourceSelection => {
    const preview = source.renditions.find((rendition) => rendition.role === 'preview');
    const original = source.renditions.find((rendition) => rendition.role === 'original') as VideoRuntimeRendition;
    const selected = options.target === 'preview' && options.allowPreviewRenditions !== false && preview ? preview : original;
    return {
      sourceId: source.id,
      renditionId: selected.id,
      role: selected.role,
    };
  });

  const orderedVisualClipIds = [...ir.visualClips].sort(compareVisualRuntimeClips).map((clip) => clip.id);
  const orderedAudioClipIds = [...ir.audioClips].sort(compareAudioRuntimeClips).map((clip) => clip.id);
  const activeVisualClipIds = options.atMilliseconds === undefined
    ? orderedVisualClipIds
    : getVideoRuntimeActiveVisualClipIds(ir, options.atMilliseconds);
  return {
    ok: true,
    target: options.target,
    irRevision: hashVideoRuntimeIr(ir),
    sourceSelections,
    orderedVisualClipIds,
    orderedAudioClipIds,
    activeVisualClipIds,
    requiredCapabilities: [...ir.requiredCapabilities],
  };
}

export function getVideoRuntimeActiveVisualClipIds(ir: VideoRuntimeIr, atMilliseconds: number): string[] {
  if (!Number.isFinite(atMilliseconds)) return [];
  const sequenceDurationMs = videoRuntimeRationalToMilliseconds(ir.sequence.duration);
  const sampleMilliseconds = sequenceDurationMs > 0 && atMilliseconds >= sequenceDurationMs
    ? Math.max(0, sequenceDurationMs - 0.001)
    : atMilliseconds;
  return [...ir.visualClips]
    .filter((clip) => {
      const range = videoRuntimeTimeRangeToMilliseconds(clip.activeRange);
      return sampleMilliseconds >= range.startMs && sampleMilliseconds < range.endMs;
    })
    .sort(compareVisualRuntimeClips)
    .map((clip) => clip.id);
}

function compileVisualClip(
  entry: VideoRuntimeResolvedVisualInput,
  index: number,
  input: VideoRuntimeCompileInput,
  errors: string[],
): VideoRuntimeVisualClip {
  const clip = entry.clip;
  const id = boundedId(clip.id, `visual clip ${index + 1} id`, errors);
  const sourceId = boundedId(clip.sourceNodeId, `visual clip '${id || index + 1}' source id`, errors);
  const durationMs = integerMilliseconds(entry.durationMs, `visual clip '${id}' duration`, errors, { positive: true });
  const startMs = integerMilliseconds(clip.startMs, `visual clip '${id}' start`, errors);
  const playbackRate = finitePositive(clip.playbackRate, 1, `visual clip '${id}' playback rate`, errors);
  const sourceInMs = integerMilliseconds(entry.sourceInMs ?? clip.sourceInMs ?? 0, `visual clip '${id}' source in`, errors);
  const sourceOutMs = integerMilliseconds(
    entry.sourceOutMs ?? clip.sourceOutMs ?? (sourceInMs + Math.max(1, Math.round(durationMs * playbackRate))),
    `visual clip '${id}' source out`,
    errors,
    { positive: true },
  );
  if (sourceOutMs <= sourceInMs) errors.push(`Visual clip '${id}' has an empty or reversed source range.`);
  const trackOrder = integerTrack(clip.trackIndex, `visual clip '${id}' track`, errors);
  const professional = clip.professional;
  const nestedSequenceId = professional?.nestedSequenceId;
  const isAdjustment = professional?.adjustmentLayer === true
    || input.professionalState?.adjustmentLayerClipIds.includes(id);
  const isMulticam = Boolean(professional?.multicamSourceId);
  const isGenerator = clip.sourceKind === 'text' || clip.sourceKind === 'shape' || clip.sourceKind === 'comic';
  const role: VideoRuntimeVisualClip['role'] = isAdjustment
    ? 'adjustment'
    : isMulticam
      ? 'multicam-angle'
      : nestedSequenceId
        ? 'nested-sequence'
        : isGenerator
          ? 'generator'
          : 'media';
  const transitionDurationMs = integerMilliseconds(clip.transitionDurationMs ?? 0, `visual clip '${id}' transition duration`, errors);
  const effects = compileVisualEffects(clip, id, errors);
  const parameterAutomation = toRuntimeJsonArray(professional?.parameterKeyframes ?? [], `visual clip '${id}' parameter automation`, errors);
  const retimeSegments = toRuntimeJsonArray(professional?.retime ?? [], `visual clip '${id}' retime`, errors);
  const masks = toRuntimeJsonArray(professional?.masks ?? [], `visual clip '${id}' masks`, errors);
  const color = professional?.color
    ? toRuntimeJsonObject(professional.color, `visual clip '${id}' color`, errors)
    : undefined;
  const requiredCapabilities = uniqueSortedCapabilities([
    ...effects.flatMap((effect) => effect.requiredCapabilities),
    ...(parameterAutomation.length > 0 ? ['runtime:parameter-keyframes' as const] : []),
    ...(color ? ['runtime:color-correction' as const] : []),
    ...(professional?.color?.inputLutName ? ['lut3d' as const] : []),
    ...(masks.length > 0 ? ['runtime:masks' as const] : []),
    ...(professional?.stabilization?.enabled ? ['runtime:stabilization' as const, 'vidstab' as const] : []),
    ...(retimeSegments.length > 0 ? ['runtime:retime' as const] : []),
    ...(professional?.retime?.some((segment) => segment.interpolation === 'optical-flow') ? ['minterpolate' as const] : []),
    ...(role === 'nested-sequence' ? ['runtime:nested-sequence' as const] : []),
    ...(role === 'adjustment' ? ['runtime:adjustment-layer' as const] : []),
    ...(role === 'multicam-angle' ? ['runtime:multicam' as const] : []),
    ...((entry.videoStreamIndex ?? 0) !== 0 ? ['runtime:stream-selection' as const] : []),
  ]);

  return {
    id,
    sourceId,
    sourceKind: clip.sourceKind,
    role,
    trackId: boundedId(professional?.trackId ?? `video:${trackOrder}`, `visual clip '${id}' track id`, errors),
    trackOrder,
    compositingOrder: trackOrder,
    recordRange: videoRuntimeTimeRangeFromMilliseconds(startMs, durationMs),
    activeRange: videoRuntimeTimeRangeFromMilliseconds(startMs, durationMs),
    sourceRange: videoRuntimeTimeRangeFromMilliseconds(sourceInMs, Math.max(1, sourceOutMs - sourceInMs)),
    streamIndex: integerStream(entry.videoStreamIndex ?? 0, `visual clip '${id}' stream index`, errors),
    playback: {
      rate: videoRuntimeRationalFromRate(playbackRate),
      reverse: clip.reversePlayback === true,
      retimeSegments,
    },
    transform: compileTransform(clip, id, errors),
    compositing: {
      opacityPercent: finitePercent(clip.opacityPercent, 100, `visual clip '${id}' opacity`, errors),
      opacityAutomation: normalizePercentAutomation(clip.opacityAutomationPoints, `visual clip '${id}' opacity automation`, errors),
      blendMode: boundedText(clip.blendMode ?? 'normal', `visual clip '${id}' blend mode`, errors, 64),
    },
    transitions: {
      in: boundedText(clip.transitionIn ?? 'none', `visual clip '${id}' transition in`, errors, 64),
      out: boundedText(clip.transitionOut ?? 'none', `visual clip '${id}' transition out`, errors, 64),
      duration: videoRuntimeRationalFromMilliseconds(transitionDurationMs),
      editPointDissolve: false,
    },
    effects,
    parameterAutomation,
    color,
    masks,
    generator: isGenerator ? compileGenerator(clip, errors) : undefined,
    nestedSequenceId: nestedSequenceId ? boundedId(nestedSequenceId, `visual clip '${id}' nested sequence id`, errors) : undefined,
    nestedRevision: nestedSequenceId ? boundedOptionalText(input.nestedSequenceRevisions?.[nestedSequenceId], `nested sequence '${nestedSequenceId}' revision`, errors) : undefined,
    multicam: professional?.multicamSourceId ? {
      sourceId: boundedId(professional.multicamSourceId, `visual clip '${id}' multicam source`, errors),
      angleId: professional.multicamAngleId
        ? boundedId(professional.multicamAngleId, `visual clip '${id}' multicam angle`, errors)
        : undefined,
    } : undefined,
    requiredCapabilities,
  };
}

function compileAudioClip(
  entry: VideoRuntimeResolvedAudioInput,
  index: number,
  errors: string[],
): VideoRuntimeAudioClip {
  const clip = entry.clip;
  const id = boundedId(clip.id, `audio clip ${index + 1} id`, errors);
  const sourceId = boundedId(clip.sourceNodeId, `audio clip '${id || index + 1}' source id`, errors);
  const durationMs = integerMilliseconds(entry.durationMs, `audio clip '${id}' duration`, errors, { positive: true });
  const startMs = integerMilliseconds(clip.offsetMs, `audio clip '${id}' start`, errors);
  const sourceInMs = integerMilliseconds(entry.sourceInMs ?? clip.sourceInMs ?? 0, `audio clip '${id}' source in`, errors);
  const sourceOutMs = integerMilliseconds(entry.sourceOutMs ?? clip.sourceOutMs ?? sourceInMs + durationMs, `audio clip '${id}' source out`, errors, { positive: true });
  if (sourceOutMs <= sourceInMs) errors.push(`Audio clip '${id}' has an empty or reversed source range.`);
  const trackOrder = integerTrack(clip.trackIndex, `audio clip '${id}' track`, errors);
  const professional = clip.professional;
  const processing = clip.audioProcessing
    ? toRuntimeJsonObject(clip.audioProcessing, `audio clip '${id}' processing`, errors)
    : undefined;
  const parameterAutomation = toRuntimeJsonArray(professional?.parameterKeyframes ?? [], `audio clip '${id}' parameter automation`, errors);
  const requiredCapabilities = uniqueSortedCapabilities([
    ...(hasEnabledEditorAudioProcessing(clip.audioProcessing) ? ['runtime:audio-processing' as const] : []),
    ...(parameterAutomation.length > 0 ? ['runtime:parameter-keyframes' as const] : []),
    ...(needsAudioClipRouting(professional) ? ['runtime:audio-routing' as const] : []),
    ...((entry.audioStreamIndex ?? 0) !== 0 ? ['runtime:stream-selection' as const] : []),
  ]);
  return {
    id,
    sourceId,
    sourceKind: clip.sourceKind ?? 'audio',
    trackId: boundedId(professional?.trackId ?? `audio:${trackOrder}`, `audio clip '${id}' track id`, errors),
    trackOrder,
    recordRange: videoRuntimeTimeRangeFromMilliseconds(startMs, durationMs),
    sourceRange: videoRuntimeTimeRangeFromMilliseconds(sourceInMs, Math.max(1, sourceOutMs - sourceInMs)),
    streamIndex: integerStream(entry.audioStreamIndex ?? 0, `audio clip '${id}' stream index`, errors),
    enabled: clip.enabled !== false,
    gain: {
      clipPercent: finitePercent(clip.volumePercent, 100, `audio clip '${id}' volume`, errors, 1_000),
      trackPercent: finitePercent(clip.trackVolumePercent, 100, `audio clip '${id}' track volume`, errors, 1_000),
      measuredMatchDb: finiteNumber(clip.measuredMatchGainDb, 0, `audio clip '${id}' measured gain`, errors),
      fades: {
        in: videoRuntimeRationalFromMilliseconds(integerMilliseconds((clip.fadeInSeconds ?? 0) * 1_000, `audio clip '${id}' fade in`, errors)),
        out: videoRuntimeRationalFromMilliseconds(integerMilliseconds((clip.fadeOutSeconds ?? 0) * 1_000, `audio clip '${id}' fade out`, errors)),
      },
      automation: normalizePercentAutomation(clip.volumeAutomationPoints, `audio clip '${id}' volume automation`, errors, 1_000),
      keyframes: boundedInputArray(
        clip.volumeKeyframes ?? [],
        MAX_VIDEO_RUNTIME_KEYFRAMES,
        `audio clip '${id}' keyframes`,
        errors,
      ).map((keyframe, keyframeIndex) => ({
        timePercent: finitePercent(keyframe.timePercent, 0, `audio clip '${id}' keyframe ${keyframeIndex + 1} time`, errors),
        volumePercent: finitePercent(keyframe.volumePercent, 100, `audio clip '${id}' keyframe ${keyframeIndex + 1} volume`, errors, 1_000),
      })).sort((left, right) => left.timePercent - right.timePercent),
    },
    routing: {
      pan: finiteBounded(professional?.pan, 0, -1, 1, `audio clip '${id}' pan`, errors),
      busId: boundedId(professional?.busId ?? 'master', `audio clip '${id}' bus id`, errors),
      channelMap: (professional?.channelMap ?? []).slice(0, 64).map((channel, channelIndex) => integerStream(channel, `audio clip '${id}' channel ${channelIndex + 1}`, errors)),
    },
    processing,
    parameterAutomation,
    requiredCapabilities,
  };
}

function compileTransform(
  clip: VideoRuntimeVisualClipInput,
  clipId: string,
  errors: string[],
): VideoRuntimeTransform {
  return {
    fitMode: clip.fitMode === 'cover' || clip.fitMode === 'stretch' ? clip.fitMode : 'contain',
    position: {
      xPercent: finiteNumber(clip.positionX, 0, `visual clip '${clipId}' position x`, errors),
      yPercent: finiteNumber(clip.positionY, 0, `visual clip '${clipId}' position y`, errors),
    },
    scalePercent: finitePositive(clip.scalePercent, 100, `visual clip '${clipId}' scale`, errors),
    rotationDegrees: finiteNumber(clip.rotationDeg, 0, `visual clip '${clipId}' rotation`, errors),
    flipHorizontal: clip.flipHorizontal === true,
    flipVertical: clip.flipVertical === true,
    crop: {
      leftPercent: finitePercent(clip.cropLeftPercent, 0, `visual clip '${clipId}' crop left`, errors),
      rightPercent: finitePercent(clip.cropRightPercent, 0, `visual clip '${clipId}' crop right`, errors),
      topPercent: finitePercent(clip.cropTopPercent, 0, `visual clip '${clipId}' crop top`, errors),
      bottomPercent: finitePercent(clip.cropBottomPercent, 0, `visual clip '${clipId}' crop bottom`, errors),
      panXPercent: finiteNumber(clip.cropPanXPercent, 0, `visual clip '${clipId}' crop pan x`, errors),
      panYPercent: finiteNumber(clip.cropPanYPercent, 0, `visual clip '${clipId}' crop pan y`, errors),
      rotationDegrees: finiteNumber(clip.cropRotationDeg, 0, `visual clip '${clipId}' crop rotation`, errors),
    },
    animation: {
      motionEnabled: clip.motionEnabled === true,
      endPositionXPercent: finiteNumber(clip.endPositionX, clip.positionX ?? 0, `visual clip '${clipId}' end position x`, errors),
      endPositionYPercent: finiteNumber(clip.endPositionY, clip.positionY ?? 0, `visual clip '${clipId}' end position y`, errors),
      scaleEnabled: clip.scaleMotionEnabled === true,
      endScalePercent: finitePositive(clip.endScalePercent, clip.scalePercent ?? 100, `visual clip '${clipId}' end scale`, errors),
      rotationEnabled: clip.rotationMotionEnabled === true,
      endRotationDegrees: finiteNumber(clip.endRotationDeg, clip.rotationDeg ?? 0, `visual clip '${clipId}' end rotation`, errors),
      keyframes: boundedInputArray(
        clip.keyframes ?? [],
        MAX_VIDEO_RUNTIME_KEYFRAMES,
        `visual clip '${clipId}' keyframes`,
        errors,
      ).map((keyframe, index) => ({
        timePercent: finitePercent(keyframe.timePercent, 0, `visual clip '${clipId}' keyframe ${index + 1} time`, errors),
        positionXPercent: finiteNumber(keyframe.positionX, 0, `visual clip '${clipId}' keyframe ${index + 1} x`, errors),
        positionYPercent: finiteNumber(keyframe.positionY, 0, `visual clip '${clipId}' keyframe ${index + 1} y`, errors),
        scalePercent: finitePositive(keyframe.scalePercent, 100, `visual clip '${clipId}' keyframe ${index + 1} scale`, errors),
        rotationDegrees: finiteNumber(keyframe.rotationDeg, 0, `visual clip '${clipId}' keyframe ${index + 1} rotation`, errors),
        opacityPercent: finitePercent(keyframe.opacityPercent, 100, `visual clip '${clipId}' keyframe ${index + 1} opacity`, errors),
        tailTipXPercent: optionalFinitePercent(keyframe.tailTipXPercent, `visual clip '${clipId}' keyframe ${index + 1} tail x`, errors),
        tailTipYPercent: optionalFinitePercent(keyframe.tailTipYPercent, `visual clip '${clipId}' keyframe ${index + 1} tail y`, errors),
        tailCurvePercent: optionalFinitePercent(keyframe.tailCurvePercent, `visual clip '${clipId}' keyframe ${index + 1} tail curve`, errors),
      })).sort((left, right) => left.timePercent - right.timePercent),
    },
  };
}

function compileVisualEffects(
  clip: VideoRuntimeVisualClipInput,
  clipId: string,
  errors: string[],
): VideoRuntimeEffect[] {
  const effects: VideoRuntimeEffect[] = boundedInputArray(
    clip.filterStack ?? [],
    MAX_VIDEO_RUNTIME_EFFECTS,
    `visual clip '${clipId}' effects`,
    errors,
  ).map((filter, index) => ({
    id: boundedId(filter.id || `${clipId}:filter:${index}`, `visual clip '${clipId}' filter ${index + 1} id`, errors),
    kind: `clip-filter:${boundedText(filter.kind, `visual clip '${clipId}' filter kind`, errors, 64)}`,
    enabled: filter.enabled,
    parameters: { amount: finiteNumber(filter.amount, 0, `visual clip '${clipId}' filter ${index + 1} amount`, errors) },
    requiredCapabilities: [],
  }));
  if (clip.chromaKey) {
    effects.push({
      id: `${clipId}:chroma-key`,
      kind: 'chroma-key',
      enabled: clip.chromaKey.enabled,
      parameters: toRuntimeJsonObject(clip.chromaKey, `visual clip '${clipId}' chroma key`, errors),
      requiredCapabilities: [],
    });
  }
  if (clip.stroke) {
    effects.push({
      id: `${clipId}:stroke`,
      kind: 'stroke',
      enabled: clip.stroke.enabled,
      parameters: toRuntimeJsonObject(clip.stroke, `visual clip '${clipId}' stroke`, errors),
      requiredCapabilities: [],
    });
  }
  return effects;
}

function compileGenerator(
  clip: VideoRuntimeVisualClipInput,
  errors: string[],
): VideoRuntimeVisualClip['generator'] {
  const kind = clip.sourceKind === 'shape' ? 'shape' : clip.sourceKind === 'comic' ? 'comic' : 'text';
  const parameters = toRuntimeJsonObject({
    text: clip.textContent,
    textFontFamily: clip.textFontFamily,
    textSizePx: clip.textSizePx,
    textColor: clip.textColor,
    textEffect: clip.textEffect,
    textBackgroundOpacityPercent: clip.textBackgroundOpacityPercent,
    textTypography: clip.textTypography,
    shapeFillColor: clip.shapeFillColor,
    shapeBorderColor: clip.shapeBorderColor,
    shapeBorderWidth: clip.shapeBorderWidth,
    shapeCornerRadius: clip.shapeCornerRadius,
    comicKind: clip.comicKind,
    comicTailAngleDeg: clip.comicTailAngleDeg,
    comicTailLengthPx: clip.comicTailLengthPx,
    comicTailTipXPercent: clip.comicTailTipXPercent,
    comicTailTipYPercent: clip.comicTailTipYPercent,
    comicTailCurvePercent: clip.comicTailCurvePercent,
    comicLineHeightPercent: clip.comicLineHeightPercent,
    comicLetterSpacingPx: clip.comicLetterSpacingPx,
    comicTextAlign: clip.comicTextAlign,
  }, `visual ${kind} generator`, errors);
  return { kind, parameters };
}

function compileCaptionTracks(
  tracks: readonly VideoSemanticCaptionTrack[],
  errors: string[],
): VideoRuntimeCaptionTrack[] {
  let cueCount = 0;
  return tracks.slice(0, MAX_VIDEO_RUNTIME_CAPTION_TRACKS).map((track, trackIndex) => {
    const remainingCueCapacity = Math.max(0, MAX_VIDEO_RUNTIME_CAPTION_CUES - cueCount);
    if (track.cues.length > remainingCueCapacity) {
      errors.push(`Runtime IR supports at most ${MAX_VIDEO_RUNTIME_CAPTION_CUES.toLocaleString()} caption cues.`);
    }
    const cues = track.cues.slice(0, remainingCueCapacity).map((cue, cueIndex): VideoRuntimeCaptionCue => {
      cueCount += 1;
      const startMs = integerMilliseconds(cue.startMs, `caption cue '${cue.id}' start`, errors);
      const endMs = integerMilliseconds(cue.endMs, `caption cue '${cue.id}' end`, errors, { positive: true });
      if (endMs <= startMs) errors.push(`Caption cue '${cue.id || cueIndex + 1}' has an empty or reversed range.`);
      return {
        id: boundedId(cue.id, `caption cue ${cueIndex + 1} id`, errors),
        range: videoRuntimeTimeRangeFromMilliseconds(startMs, Math.max(1, endMs - startMs)),
        text: boundedText(cue.text, `caption cue '${cue.id}' text`, errors, MAX_VIDEO_RUNTIME_TEXT_CHARS),
        speaker: boundedOptionalText(cue.speaker, `caption cue '${cue.id}' speaker`, errors, 512),
        position: cue.position,
      };
    }).sort((left, right) => compareRanges(left.range, right.range) || left.id.localeCompare(right.id));
    return {
      id: boundedId(track.id, `caption track ${trackIndex + 1} id`, errors),
      name: boundedText(track.name, `caption track ${trackIndex + 1} name`, errors, 512),
      language: boundedText(track.language, `caption track ${trackIndex + 1} language`, errors, 64),
      service: track.service,
      style: toRuntimeJsonObject(track.style, `caption track '${track.id}' style`, errors),
      cues,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

function compileStageObjects(
  objects: readonly EditorStageObject[],
  durationMs: number,
  errors: string[],
): VideoRuntimeStageObject[] {
  return objects.slice(0, MAX_VIDEO_RUNTIME_STAGE_OBJECTS).map((object, index) => ({
    id: boundedId(object.id, `stage object ${index + 1} id`, errors),
    kind: object.kind,
    compositingOrder: index,
    activeRange: videoRuntimeTimeRangeFromMilliseconds(0, durationMs),
    parameters: toRuntimeJsonObject(object, `stage object '${object.id}'`, errors),
  }));
}

function registerSource(
  sources: Map<string, VideoRuntimeSource>,
  input: {
    id: string;
    kind: VideoRuntimeSource['kind'];
    fingerprint?: string;
    previewFingerprint?: string;
    hasPreview: boolean;
    videoStreamIndex?: number;
    audioStreamIndex?: number;
  },
  errors: string[],
): void {
  const sourceFingerprint = boundedOptionalText(input.fingerprint, `source '${input.id}' fingerprint`, errors);
  const previewFingerprint = boundedOptionalText(input.previewFingerprint, `source '${input.id}' preview fingerprint`, errors);
  const current = sources.get(input.id);
  if (current?.sourceFingerprint && sourceFingerprint && current.sourceFingerprint !== sourceFingerprint) {
    errors.push(`Source '${input.id}' has conflicting source fingerprints.`);
  }
  const currentPreviewFingerprint = current?.renditions.find((rendition) => rendition.role === 'preview')?.fingerprint;
  if (currentPreviewFingerprint && previewFingerprint && currentPreviewFingerprint !== previewFingerprint) {
    errors.push(`Source '${input.id}' has conflicting preview fingerprints.`);
  }
  if (current && current.kind !== input.kind) {
    const compatibleKinds = new Set([current.kind, input.kind]);
    if (!(compatibleKinds.has('video') && compatibleKinds.has('audio'))
      && !(compatibleKinds.has('composition') && compatibleKinds.has('audio'))) {
      errors.push(`Source '${input.id}' is used with incompatible kinds '${current.kind}' and '${input.kind}'.`);
    }
  }
  const kind = current?.kind === 'video' || current?.kind === 'composition'
    ? current.kind
    : input.kind;
  const effectiveSourceFingerprint = current?.sourceFingerprint ?? sourceFingerprint;
  const effectivePreviewFingerprint = currentPreviewFingerprint ?? previewFingerprint;
  const renditions: VideoRuntimeRendition[] = [{
    id: opaqueRenditionId(input.id, 'original'),
    role: 'original',
    ...(effectiveSourceFingerprint ? { fingerprint: effectiveSourceFingerprint } : {}),
  }];
  if (input.hasPreview || current?.renditions.some((rendition) => rendition.role === 'preview')) {
    renditions.push({
      id: opaqueRenditionId(input.id, 'preview'),
      role: 'preview',
      ...(effectivePreviewFingerprint ? { fingerprint: effectivePreviewFingerprint } : {}),
    });
  }
  const videoStreams = uniqueSortedStreams([
    ...(current?.streams.video ?? []),
    ...(input.videoStreamIndex === undefined ? [] : [input.videoStreamIndex]),
  ]);
  const audioStreams = uniqueSortedStreams([
    ...(current?.streams.audio ?? []),
    ...(input.audioStreamIndex === undefined ? [] : [input.audioStreamIndex]),
  ]);
  sources.set(input.id, {
    id: input.id,
    kind,
    sourceFingerprint: effectiveSourceFingerprint,
    streams: {
      video: videoStreams,
      audio: audioStreams,
    },
    renditions,
  });
}

function applyEditPointDissolveRanges(clips: VideoRuntimeVisualClip[]): void {
  for (const clip of clips) {
    if (clip.transitions.in !== 'fade') continue;
    const record = videoRuntimeTimeRangeToMilliseconds(clip.recordRange);
    const transitionMs = videoRuntimeRationalToMilliseconds(clip.transitions.duration);
    if (transitionMs <= 0) continue;
    const adjacent = clips.some((candidate) => {
      if (candidate.id === clip.id || candidate.trackOrder !== clip.trackOrder || candidate.transitions.out !== 'fade') return false;
      const candidateRecord = videoRuntimeTimeRangeToMilliseconds(candidate.recordRange);
      return Math.abs(candidateRecord.endMs - record.startMs) <= 1;
    });
    if (!adjacent) continue;
    const preRollMs = Math.min(record.durationMs / 2, transitionMs);
    const activeStartMs = Math.max(0, record.startMs - preRollMs);
    clip.activeRange = videoRuntimeTimeRangeFromMilliseconds(activeStartMs, record.endMs - activeStartMs);
    clip.transitions.editPointDissolve = true;
  }
}

function buildDependencies(clips: VideoRuntimeVisualClip[]): VideoRuntimeDependency[] {
  const byId = new Map<string, VideoRuntimeDependency>();
  for (const clip of clips) {
    if (!clip.nestedSequenceId) continue;
    const current = byId.get(clip.nestedSequenceId);
    if (current) {
      current.referenceClipIds.push(clip.id);
      if (!current.revision && clip.nestedRevision) current.revision = clip.nestedRevision;
    } else {
      byId.set(clip.nestedSequenceId, {
        sequenceId: clip.nestedSequenceId,
        revision: clip.nestedRevision,
        referenceClipIds: [clip.id],
      });
    }
  }
  return [...byId.values()].map((dependency) => ({
    ...dependency,
    referenceClipIds: [...dependency.referenceClipIds].sort(),
  })).sort((left, right) => left.sequenceId.localeCompare(right.sequenceId));
}

function normalizeTimebase(
  candidate: VideoProductionTimebase | undefined,
  frameRate: number | undefined,
  errors: string[],
): VideoRuntimeIr['sequence']['timebase'] {
  const value = candidate ?? (frameRate ? {
    ...DEFAULT_TIMEBASE,
    numerator: Math.round(frameRate * 1_000),
    denominator: 1_000,
  } : DEFAULT_TIMEBASE);
  let framesPerSecond: VideoRuntimeRational;
  try {
    framesPerSecond = createVideoRuntimeRational(Math.round(value.numerator), Math.round(value.denominator));
    if (framesPerSecond.numerator <= 0) throw new Error('Frame rate must be greater than zero.');
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Sequence timebase is invalid.');
    framesPerSecond = createVideoRuntimeRational(30, 1);
  }
  return {
    framesPerSecond,
    dropFrame: value.dropFrame === true,
    sequenceStartTimecode: boundedText(value.sequenceStartTimecode, 'sequence start timecode', errors, 32),
  };
}

function normalizeCanvas(canvas: VideoRuntimeCompileInput['canvas'], errors: string[]): { width: number; height: number } {
  const width = Math.round(canvas.width);
  const height = Math.round(canvas.height);
  if (!Number.isFinite(canvas.width) || !Number.isFinite(canvas.height)
    || width <= 0 || height <= 0 || width > 16_384 || height > 16_384) {
    errors.push('Runtime canvas dimensions must be finite, positive, and no larger than 16384.');
    return { width: 1, height: 1 };
  }
  return { width, height };
}

function cloneAudioBuses(buses: readonly ProfessionalAudioBus[], errors: string[]): ProfessionalAudioBus[] {
  if (buses.length > MAX_VIDEO_RUNTIME_TRACKS) {
    errors.push(`Runtime IR supports at most ${MAX_VIDEO_RUNTIME_TRACKS.toLocaleString()} audio buses.`);
  }
  return buses.slice(0, MAX_VIDEO_RUNTIME_TRACKS).map((bus) => ({ ...bus })).sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueSortedStreams(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function needsManagedColorPipeline(state: EditorProfessionalVideoState | undefined): boolean {
  return Boolean(state && (state.workingColorSpace !== 'rec709' || state.toneMapping !== 'none'));
}

function needsAudioBusRuntime(buses: readonly ProfessionalAudioBus[]): boolean {
  if (buses.length === 0) return false;
  if (buses.length !== 1) return true;
  const bus = buses[0];
  return bus?.id !== 'master'
    || bus.kind !== 'master'
    || bus.gainDb !== 0
    || bus.muted
    || bus.solo
    || Boolean(bus.outputBusId);
}

function needsAudioClipRouting(state: Partial<EditorAudioClipProfessionalState> | undefined): boolean {
  return Boolean(state && (
    (state.pan ?? 0) !== 0
    || (state.busId ?? 'master') !== 'master'
    || (state.channelMap?.length ?? 0) > 0
  ));
}

function opaqueRenditionId(sourceId: string, role: VideoRuntimeRendition['role']): string {
  const digest = sha256Hex(new TextEncoder().encode(sourceId)).slice(0, 24);
  return `rendition:${role}:${digest}`;
}

function compareVisualRuntimeClips(left: VideoRuntimeVisualClip, right: VideoRuntimeVisualClip): number {
  return left.trackOrder - right.trackOrder
    || compareRanges(left.recordRange, right.recordRange)
    || left.id.localeCompare(right.id);
}

function compareAudioRuntimeClips(left: VideoRuntimeAudioClip, right: VideoRuntimeAudioClip): number {
  return left.trackOrder - right.trackOrder
    || compareRanges(left.recordRange, right.recordRange)
    || left.id.localeCompare(right.id);
}

function compareRanges(left: VideoRuntimeTimeRange, right: VideoRuntimeTimeRange): number {
  return videoRuntimeRationalToMilliseconds(left.start) - videoRuntimeRationalToMilliseconds(right.start);
}

function uniqueSortedCapabilities(values: readonly VideoRuntimeCapabilityId[]): VideoRuntimeCapabilityId[] {
  return [...new Set(values)].sort();
}

function normalizePercentAutomation(
  points: readonly { timePercent: number; valuePercent: number }[] | undefined,
  label: string,
  errors: string[],
  maximumValue = 100,
): Array<{ timePercent: number; valuePercent: number }> {
  return boundedInputArray(
    points ?? [],
    MAX_VIDEO_RUNTIME_KEYFRAMES,
    label,
    errors,
  ).map((point, index) => ({
    timePercent: finitePercent(point.timePercent, 0, `${label} point ${index + 1} time`, errors),
    valuePercent: finitePercent(point.valuePercent, 0, `${label} point ${index + 1} value`, errors, maximumValue),
  })).sort((left, right) => left.timePercent - right.timePercent);
}

function toRuntimeJsonArray(value: unknown, label: string, errors: string[]): VideoRuntimeJson[] {
  try {
    const normalized = toRuntimeJson(value, label);
    if (!Array.isArray(normalized)) throw new Error(`${label} must be an array.`);
    return normalized;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `${label} is invalid.`);
    return [];
  }
}

function toRuntimeJsonObject(value: unknown, label: string, errors: string[]): { [key: string]: VideoRuntimeJson } {
  try {
    const normalized = toRuntimeJson(value, label);
    if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') throw new Error(`${label} must be an object.`);
    return normalized;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `${label} is invalid.`);
    return {};
  }
}

function toRuntimeJson(value: unknown, label: string, depth = 0): VideoRuntimeJson {
  if (depth > 16) throw new Error(`${label} is nested too deeply.`);
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_VIDEO_RUNTIME_TEXT_CHARS || value.includes('\0')) {
      throw new Error(`${label} exceeds its text limit or contains NUL.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_VIDEO_RUNTIME_KEYFRAMES) throw new Error(`${label} exceeds the array-item limit.`);
    return value.map((entry, index) => toRuntimeJson(entry, `${label}[${index}]`, depth + 1));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    if (entries.length > 2_048) throw new Error(`${label} has too many object fields.`);
    return Object.fromEntries(entries.map(([key, entry]) => {
      if (key.length > 256 || key.includes('\0')) throw new Error(`${label} has an invalid field name.`);
      return [key, toRuntimeJson(entry, `${label}.${key}`, depth + 1)];
    }));
  }
  throw new Error(`${label} contains an unsupported value.`);
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

function boundedId(value: unknown, label: string, errors: string[]): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    errors.push(`${label} must be a non-empty string.`);
    return '';
  }
  if (normalized.length > MAX_VIDEO_RUNTIME_ID_CHARS || hasAsciiControlCharacter(normalized)) {
    errors.push(`${label} is too long or contains control characters.`);
    return Array.from(normalized.slice(0, MAX_VIDEO_RUNTIME_ID_CHARS))
      .filter((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint > 31 && codePoint !== 127;
      })
      .join('');
  }
  return normalized;
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function boundedText(
  value: unknown,
  label: string,
  errors?: string[],
  maximumLength = MAX_VIDEO_RUNTIME_TEXT_CHARS,
): string {
  if (typeof value !== 'string') {
    errors?.push(`${label} must be a string.`);
    return '';
  }
  if (value.length > maximumLength || value.includes('\0')) {
    errors?.push(`${label} exceeds its text limit or contains NUL.`);
    return value.slice(0, maximumLength).replaceAll('\0', '');
  }
  return value;
}

function boundedOptionalText(
  value: unknown,
  label: string,
  errors: string[],
  maximumLength = MAX_VIDEO_RUNTIME_ID_CHARS,
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return boundedText(value, label, errors, maximumLength);
}

function boundedInputArray<T>(
  value: readonly T[],
  maximumLength: number,
  label: string,
  errors: string[],
): readonly T[] {
  if (value.length > maximumLength) {
    errors.push(`${label} exceeds the ${maximumLength.toLocaleString()}-item limit.`);
  }
  return value.slice(0, maximumLength);
}

function integerMilliseconds(
  value: unknown,
  label: string,
  errors: string[],
  options: { positive?: boolean } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${label} must be finite.`);
    return options.positive ? 1 : 0;
  }
  const normalized = Math.round(value);
  if (normalized < 0 || (options.positive && normalized <= 0) || normalized > MAX_VIDEO_RUNTIME_DURATION_MS) {
    errors.push(`${label} is outside the supported runtime range.`);
    return options.positive ? 1 : Math.max(0, Math.min(MAX_VIDEO_RUNTIME_DURATION_MS, normalized));
  }
  return normalized;
}

function integerTrack(value: unknown, label: string, errors: string[]): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= MAX_VIDEO_RUNTIME_TRACKS) {
    errors.push(`${label} must be an integer from 0 through ${MAX_VIDEO_RUNTIME_TRACKS - 1}.`);
    return 0;
  }
  return value;
}

function integerStream(value: unknown, label: string, errors: string[]): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
    errors.push(`${label} must be an integer from 0 through 255.`);
    return 0;
  }
  return value;
}

function finiteNumber(value: unknown, fallback: number, label: string, errors: string[]): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${label} must be finite.`);
    return fallback;
  }
  return value;
}

function finitePositive(value: unknown, fallback: number, label: string, errors: string[]): number {
  const normalized = finiteNumber(value, fallback, label, errors);
  if (normalized <= 0) {
    errors.push(`${label} must be greater than zero.`);
    return fallback;
  }
  return normalized;
}

function finiteBounded(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
  errors: string[],
): number {
  const normalized = finiteNumber(value, fallback, label, errors);
  if (normalized < minimum || normalized > maximum) {
    errors.push(`${label} must be from ${minimum} through ${maximum}.`);
    return Math.max(minimum, Math.min(maximum, normalized));
  }
  return normalized;
}

function finitePercent(
  value: unknown,
  fallback: number,
  label: string,
  errors: string[],
  maximum = 100,
): number {
  return finiteBounded(value, fallback, 0, maximum, label, errors);
}

function optionalFinitePercent(value: unknown, label: string, errors: string[]): number | undefined {
  if (value === undefined) return undefined;
  return finitePercent(value, 0, label, errors);
}

function validateClipRange(range: VideoRuntimeTimeRange, label: string, errors: string[]): void {
  validateRational(range.start, `${label} start`, errors, false);
  validateRational(range.duration, `${label} duration`, errors, true);
}

function validateRational(
  value: VideoRuntimeRational,
  label: string,
  errors: string[],
  positive: boolean,
): void {
  if (!Number.isSafeInteger(value.numerator) || !Number.isSafeInteger(value.denominator)
    || value.denominator <= 0 || (positive && value.numerator <= 0) || (!positive && value.numerator < 0)) {
    errors.push(`${label} is not a normalized non-negative rational.`);
  }
}

function uniqueIdSet(ids: readonly string[], label: string, errors: string[]): Set<string> {
  const result = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    if (result.has(id)) errors.push(`Duplicate ${label} id '${id}'.`);
    result.add(id);
  }
  return result;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}
