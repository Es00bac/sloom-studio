/**
 * Additive project decisions for the second professional Video workflow program.
 * Device-local cache paths, media bytes, live job controllers, and thumbnails never belong here.
 */
import type { VideoDecodedSignalQcReport } from '../lib/videoDecodedSignalQc';

export const VIDEO_PRODUCTION_STATE_VERSION = 2 as const;

export interface VideoSourcePatchState {
  id: string;
  sourceKind: 'video' | 'audio';
  sourceTrackIndex: number;
  targetTrackId: string;
  enabled: boolean;
}

export interface VideoSequenceBinState {
  id: string;
  name: string;
  sequenceIds: string[];
}

export interface VideoSequenceViewState {
  sequenceId: string;
  zoomPercent: number;
  scrollLeftPx: number;
  workArea?: {
    inMs: number;
    outMs: number;
    loopEnabled: boolean;
  };
}

/**
 * Durable editorial decisions introduced by the third professional Video program.
 * Selection, the open tab set, clipboard payloads, transient trim sessions, and derived search
 * indexes stay out of project state.
 */
export interface VideoEditorialWorkflowState {
  sourcePatches: VideoSourcePatchState[];
  recordTargetTrackIds: string[];
  syncLockedTrackIds: string[];
  sequenceBins: VideoSequenceBinState[];
  sequenceViewStates: VideoSequenceViewState[];
}

export interface VideoProductionTimebase {
  numerator: number;
  denominator: number;
  dropFrame: boolean;
  sequenceStartTimecode: string;
  mixedRatePolicy: 'preserve-time' | 'preserve-frame-number' | 'reject';
}

export interface VideoSmartBinDefinition {
  id: string;
  name: string;
  query: string;
  sortBy: 'name' | 'created' | 'rating' | 'scene' | 'take';
  sortDirection: 'ascending' | 'descending';
}

export interface VideoReviewReply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface VideoReviewAnnotation {
  id: string;
  target: 'sequence-point' | 'sequence-range' | 'visual-clip' | 'audio-clip';
  startMs: number;
  endMs?: number;
  clipId?: string;
  author: string;
  text: string;
  status: 'open' | 'in-progress' | 'resolved';
  priority: 'low' | 'normal' | 'high' | 'blocking';
  assignee?: string;
  createdAt: number;
  updatedAt: number;
  replies: VideoReviewReply[];
}

export interface VideoReviewApproval {
  id: string;
  reviewer: string;
  compositionSignature: string;
  status: 'approved' | 'changes-requested';
  createdAt: number;
  note?: string;
}

export interface VideoSemanticCaptionCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  position?: 'top' | 'center' | 'bottom';
}

export interface VideoSemanticCaptionTrack {
  id: string;
  name: string;
  language: string;
  service: 'captions' | 'subtitles' | 'sdh';
  style: {
    fontFamily: string;
    fontSizePx: number;
    textColor: string;
    backgroundOpacityPercent: number;
    safeAreaPercent: number;
  };
  cues: VideoSemanticCaptionCue[];
}

/**
 * Persisted user intent only. The render-time plan is rebuilt from the retained caption track so
 * no delivery bytes, output paths, or stale prior render result can be revived from a project.
 */
export interface VideoCaptionEmbeddingState {
  enabled: boolean;
  trackId?: string;
}

export interface VideoDeliveryProfile {
  id: string;
  name: string;
  targets: Array<{
    id: string;
    kind: 'review-video' | 'master-video' | 'audio-mix' | 'captions' | 'qc-report';
    presetId?: string;
    fileNameTemplate: string;
    enabled: boolean;
  }>;
}

export interface VideoDeliveryJobRecord {
  id: string;
  profileId: string;
  compositionSignature: string;
  /**
   * `interrupted` is distinct from `failed`: the render never reported an outcome because the
   * session running it stopped existing. Restart reconciliation produces it, and only an explicit
   * user action clears it.
   */
  status: 'planned' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
  createdAt: number;
  updatedAt: number;
  hostDurability: 'native-restart-check' | 'browser-session-only';
  outputs?: Array<{
    id: string;
    label: string;
    fileName: string;
    extension?: string;
    container?: string;
    codec?: string;
    target?: 'native' | 'browser';
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'cancelled' | 'interrupted';
    missingCapabilities: string[];
    checksumIntent?: 'sha256' | 'none';
    manifestIntent?: 'write-json' | 'none';
    executionDurability?: 'browser-session-only' | 'native-host-resume-required' | 'blocked';
    truthfulnessNote: string;
    /** Starts consumed, persisted so a crash loop stays bounded across restarts. */
    attempts?: number;
    /**
     * Opaque capability for the one attempt currently allowed to publish an outcome. It is cleared
     * on every terminal or recovery transition so an old async callback cannot complete a retried
     * output that happens to have the same job and output IDs.
     */
    executionLeaseId?: string;
    error?: string;
    /** Measured evidence of a real produced deliverable, never an intention. */
    result?: {
      byteSize?: number;
      checksum?: string;
      /** Where the delivered artifact actually is, so recovery can tell whether it still exists. */
      reference?: string;
    };
  }>;
  manifestIntent?: {
    includeFrozenCompositionSignature: true;
    includeOutputChecksums: boolean;
  };
  message?: string;
}

export interface EditorProfessionalWorkflowState {
  version: typeof VIDEO_PRODUCTION_STATE_VERSION;
  timebase: VideoProductionTimebase;
  smartBins: VideoSmartBinDefinition[];
  reviewAnnotations: VideoReviewAnnotation[];
  reviewApprovals: VideoReviewApproval[];
  captionTracks: VideoSemanticCaptionTrack[];
  captionEmbedding: VideoCaptionEmbeddingState;
  deliveryProfiles: VideoDeliveryProfile[];
  deliveryJobs: VideoDeliveryJobRecord[];
  /** Compact sampled QC evidence. Decoder handles, source URLs, and PCM/frame data never persist. */
  decodedSignalQcReport?: VideoDecodedSignalQcReport;
  editorial: VideoEditorialWorkflowState;
}

export function createDefaultEditorProfessionalWorkflowState(): EditorProfessionalWorkflowState {
  return {
    version: VIDEO_PRODUCTION_STATE_VERSION,
    timebase: {
      numerator: 30,
      denominator: 1,
      dropFrame: false,
      sequenceStartTimecode: '00:00:00:00',
      mixedRatePolicy: 'preserve-time',
    },
    smartBins: [],
    reviewAnnotations: [],
    reviewApprovals: [],
    captionTracks: [],
    captionEmbedding: { enabled: false },
    deliveryProfiles: [{
      id: 'standard-delivery',
      name: 'Standard delivery',
      targets: [
        { id: 'review', kind: 'review-video', presetId: 'review-h264-1080p', fileNameTemplate: '{project}-{sequence}-review', enabled: true },
        { id: 'captions', kind: 'captions', fileNameTemplate: '{project}-{sequence}-{language}', enabled: false },
        { id: 'qc', kind: 'qc-report', fileNameTemplate: '{project}-{sequence}-qc', enabled: true },
      ],
    }],
    deliveryJobs: [],
    editorial: {
      sourcePatches: [],
      recordTargetTrackIds: [],
      syncLockedTrackIds: [],
      sequenceBins: [],
      sequenceViewStates: [],
    },
  };
}
