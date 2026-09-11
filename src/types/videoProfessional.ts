import type { EditorVisualClip } from './flow';

/**
 * Additive, versioned project state for professional Video workflows.
 *
 * Keep media bytes and device-local cache paths out of this document. The fields below are
 * editing decisions and durable media references only, so legacy projects can omit the whole
 * object and continue to use the original four-track editor unchanged.
 */
export const VIDEO_PROFESSIONAL_STATE_VERSION = 1 as const;

export type ProfessionalMediaOrigin = 'imported' | 'generated';
export type ProfessionalMediaOnlineState = 'online' | 'offline' | 'stale';
export type ProfessionalProxyStatus = 'none' | 'queued' | 'building' | 'ready' | 'failed';

export interface ProfessionalProxyReference {
  status: ProfessionalProxyStatus;
  /** Stable project-scratch name, never a browser blob URL. */
  scratchFileName?: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  sourceFingerprint?: string;
  progressPercent?: number;
  error?: string;
}

export interface ProfessionalColorMetadata {
  primaries?: 'bt709' | 'display-p3' | 'bt2020';
  transfer?: 'srgb' | 'bt1886' | 'pq' | 'hlg';
  matrix?: 'rgb' | 'bt709' | 'bt2020-ncl';
  range?: 'full' | 'limited';
}

export interface ProfessionalTranscriptCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface ProfessionalGeneratedMediaProvenance {
  provider: string;
  operation: 'tts' | 'sound-effect' | 'music' | 'voice-change' | 'voice-isolation' | 'transcription' | 'other';
  modelId?: string;
  requestId?: string;
  parentSourceItemIds?: string[];
  generatedAt: number;
  timing?: {
    words: Array<{ text: string; startMs: number; endMs: number }>;
  };
}

export interface ProfessionalMediaLoggingMetadata {
  reel?: string;
  scene?: string;
  shot?: string;
  take?: string;
  camera?: string;
  recordedAt?: string;
  notes?: string;
  colorLabel?: string;
  status?: 'unreviewed' | 'selected' | 'alternate' | 'rejected' | 'approved';
}

export interface ProfessionalSubclipReference {
  parentSourceItemId: string;
  sourceInMs: number;
  sourceOutMs: number;
}

export interface SourceBinProfessionalMediaState {
  version: typeof VIDEO_PROFESSIONAL_STATE_VERSION;
  origin: ProfessionalMediaOrigin;
  onlineState?: ProfessionalMediaOnlineState;
  sourceFingerprint?: string;
  proxy?: ProfessionalProxyReference;
  color?: ProfessionalColorMetadata;
  transcript?: {
    language?: string;
    cues: ProfessionalTranscriptCue[];
  };
  tags?: string[];
  rating?: number;
  logging?: ProfessionalMediaLoggingMetadata;
  subclip?: ProfessionalSubclipReference;
  /** Provider/request provenance for derivatives. Credentials are never valid here. */
  generatedBy?: ProfessionalGeneratedMediaProvenance;
}

export interface ProfessionalNumericParameterKeyframe {
  id: string;
  timeMs: number;
  value: number;
  interpolation: 'hold' | 'linear' | 'bezier';
  bezier?: { outX: number; outY: number; inX: number; inY: number };
}

export interface ProfessionalNumericParameterTrack {
  id: string;
  parameter: string;
  /** Clip-local automation extent used by preview and export parity checks. */
  durationMs?: number;
  keyframes: ProfessionalNumericParameterKeyframe[];
}

export interface ProfessionalRetimeSegment {
  id: string;
  timelineStartMs: number;
  timelineEndMs: number;
  speedPercent: number;
  interpolation: 'nearest' | 'blend' | 'optical-flow';
}

export interface ProfessionalColorCorrection {
  exposureStops: number;
  contrast: number;
  temperature: number;
  tint: number;
  saturation: number;
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  inputLutName?: string;
}

export interface ProfessionalMask {
  id: string;
  kind: 'rectangle' | 'ellipse' | 'bezier';
  points: Array<{ x: number; y: number }>;
  featherPercent: number;
  opacityPercent: number;
  inverted: boolean;
  tracking?: {
    status: 'idle' | 'tracking' | 'ready' | 'failed';
    keyframes: Array<{ timeMs: number; offsetX: number; offsetY: number; scale: number }>;
  };
}

export interface ProfessionalStabilizationSample {
  timeMs: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface ProfessionalStabilizationAnalysisArtifact {
  version: 1;
  status: 'ready';
  sourceFingerprint?: string;
  samples: ProfessionalStabilizationSample[];
}

export interface EditorVisualClipProfessionalState {
  trackId?: string;
  linkGroupId?: string;
  syncGroupId?: string;
  syncOffsetFrames?: number;
  nestedSequenceId?: string;
  adjustmentLayer?: boolean;
  multicamSourceId?: string;
  multicamAngleId?: string;
  retime?: ProfessionalRetimeSegment[];
  color?: ProfessionalColorCorrection;
  masks?: ProfessionalMask[];
  stabilization?: {
    enabled: boolean;
    strengthPercent: number;
    cropMode: 'none' | 'auto-scale';
    analysis?: ProfessionalStabilizationAnalysisArtifact;
  };
  chromaKeyMode?: 'off' | 'green' | 'blue' | 'custom';
  parameterKeyframes?: ProfessionalNumericParameterTrack[];
}

export interface EditorAudioClipProfessionalState {
  trackId?: string;
  linkGroupId?: string;
  syncGroupId?: string;
  syncOffsetFrames?: number;
  pan?: number;
  busId?: string;
  channelMap?: number[];
  parameterKeyframes?: ProfessionalNumericParameterTrack[];
}

export interface ProfessionalTrack {
  id: string;
  kind: 'video' | 'audio' | 'subtitle';
  name: string;
  order: number;
  enabled: boolean;
  locked: boolean;
  muted?: boolean;
  solo?: boolean;
  syncLocked?: boolean;
  sourcePatched?: boolean;
  role?: 'standard' | 'overlay' | 'adjustment' | 'dialogue' | 'music' | 'effects';
}

export interface ProfessionalSequenceReference {
  id: string;
  name: string;
  durationMs: number;
  frameRate: number;
  parentSequenceId?: string;
  /** A persisted, bounded child timeline. Definitions without clips are descriptors, not media. */
  visualClips?: EditorVisualClip[];
}

export interface ProfessionalMulticamSource {
  id: string;
  name: string;
  angleSourceIds: string[];
  syncMethod: 'manual' | 'timecode' | 'markers' | 'audio';
  activeAngleId?: string;
  /** Local timeline cuts, in milliseconds from the host clip's start. */
  cuts?: Array<{ id: string; timelineMs: number; angleSourceId: string }>;
  audioFollowsVideo: boolean;
}

export interface ProfessionalAudioBus {
  id: string;
  name: string;
  kind: 'submix' | 'master';
  gainDb: number;
  /** Main-output stereo position. Omitted legacy buses normalize to centre. */
  pan?: number;
  muted: boolean;
  solo: boolean;
  outputBusId?: string;
  targetLufs?: number;
  truePeakCeilingDbtp?: number;
}

/** Durable delivery intent only. Measurements and FFmpeg reports are runtime
 * artifacts and deliberately never enter the project document. */
export interface ProfessionalLoudnessNormalization {
  enabled: boolean;
  targetLufs: number;
  loudnessRangeLu: number;
  truePeakCeilingDbtp: number;
}

export interface EditorProfessionalVideoState {
  version: typeof VIDEO_PROFESSIONAL_STATE_VERSION;
  proxyPlaybackEnabled: boolean;
  tracks: ProfessionalTrack[];
  sequences: ProfessionalSequenceReference[];
  multicamSources: ProfessionalMulticamSource[];
  audioBuses: ProfessionalAudioBus[];
  loudnessNormalization: ProfessionalLoudnessNormalization;
  workingColorSpace: 'rec709' | 'display-p3' | 'rec2020-pq' | 'rec2020-hlg';
  toneMapping: 'none' | 'hdr-to-sdr';
  adjustmentLayerClipIds: string[];
  transcriptRemovedCueIds: string[];
  interchangeHistory: Array<{
    id: string;
    format: 'fcp7-xml' | 'edl' | 'otio' | 'aaf-handoff';
    direction: 'import' | 'export';
    createdAt: number;
    warnings: string[];
  }>;
}

export function createDefaultEditorProfessionalVideoState(): EditorProfessionalVideoState {
  return {
    version: VIDEO_PROFESSIONAL_STATE_VERSION,
    proxyPlaybackEnabled: true,
    tracks: [],
    sequences: [],
    multicamSources: [],
    audioBuses: [{
      id: 'master',
      name: 'Master',
      kind: 'master',
      gainDb: 0,
      pan: 0,
      muted: false,
      solo: false,
      targetLufs: -14,
      truePeakCeilingDbtp: -1,
    }],
    loudnessNormalization: {
      enabled: false,
      targetLufs: -14,
      loudnessRangeLu: 7,
      truePeakCeilingDbtp: -1,
    },
    workingColorSpace: 'rec709',
    toneMapping: 'none',
    adjustmentLayerClipIds: [],
    transcriptRemovedCueIds: [],
    interchangeHistory: [],
  };
}
