import {
  VIDEO_PRODUCTION_STATE_VERSION,
  createDefaultEditorProfessionalWorkflowState,
  type EditorProfessionalWorkflowState,
  type VideoDeliveryJobRecord,
  type VideoDeliveryProfile,
  type VideoEditorialWorkflowState,
  type VideoReviewAnnotation,
  type VideoReviewApproval,
  type VideoSemanticCaptionTrack,
  type VideoSmartBinDefinition,
} from '../types/videoProduction';
import { sanitizeVideoDecodedSignalQcReport } from './videoDecodedSignalQc';

export const MAX_VIDEO_SMART_BINS = 100;
export const MAX_VIDEO_REVIEW_ANNOTATIONS = 5_000;
export const MAX_VIDEO_REVIEW_REPLIES = 500;
export const MAX_VIDEO_REVIEW_TOTAL_REPLIES = 10_000;
export const MAX_VIDEO_CAPTION_TRACKS = 32;
export const MAX_VIDEO_CAPTION_CUES = 20_000;
export const MAX_VIDEO_DELIVERY_PROFILES = 32;
export const MAX_VIDEO_DELIVERY_TARGETS = 32;
export const MAX_VIDEO_DELIVERY_JOBS = 100;
/**
 * Starts a single delivery output may consume. Clamped here as well as in the queue so a corrupted
 * or hand-edited project cannot hand an output unlimited retries of work that crashes the host.
 */
export const MAX_VIDEO_DELIVERY_OUTPUT_ATTEMPTS = 3;

/** A job in one of these states will never do more work, so it is the safe thing to forget first. */
const TERMINAL_DELIVERY_JOB_STATUSES = new Set(['completed', 'cancelled', 'failed', 'partial']);

/**
 * Trims the queue to its bound by forgetting finished jobs before pending ones. Dropping the oldest
 * record unconditionally could discard a job that is still queued or interrupted — silently losing
 * work the user is waiting on — so age only decides between records of equal standing.
 */
export function pruneVideoDeliveryJobsToBound<T extends { status: string }>(
  jobs: readonly T[],
  bound = MAX_VIDEO_DELIVERY_JOBS,
): T[] {
  if (jobs.length <= bound) return [...jobs];
  const pending: T[] = [];
  const terminal: T[] = [];
  for (const job of jobs) (TERMINAL_DELIVERY_JOB_STATUSES.has(job.status) ? terminal : pending).push(job);
  // Keep the newest terminal jobs only to the extent pending work leaves room, and if pending work
  // alone overflows the bound, keep its newest entries rather than dropping everything else.
  const keptTerminal = terminal.slice(-Math.max(0, bound - pending.length));
  const keptPending = pending.slice(-bound);
  const kept = new Set<T>([...keptTerminal, ...keptPending]);
  return jobs.filter((job) => kept.has(job)).slice(-bound);
}
export const MAX_VIDEO_EDITORIAL_TRACKS = 64;
export const MAX_VIDEO_SEQUENCE_NAVIGATOR_ITEMS = 128;
export const MAX_VIDEO_PROJECT_DURATION_MS = 43_200_000;

/**
 * The workflow slice does not own the authoritative ProfessionalTrack collection. Without a
 * root-state migration it can enforce ID shape and a combined 64-reference budget, but it cannot
 * prove that an otherwise valid ID still exists. Callers that own both slices should pass
 * `validTargetTrackIds` to close that boundary.
 */
export const VIDEO_EDITORIAL_TRACK_TARGET_TRUTH_BOUNDARY =
  'Cross-slice track existence requires validTargetTrackIds from the project root.' as const;

export interface VideoProductionStateSanitizeOptions {
  /** Authoritative track IDs from EditorProfessionalVideoState.tracks, already scoped to a sequence. */
  validTargetTrackIds?: readonly string[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum = 512, fallback = ''): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : fallback;
}

function optionalText(value: unknown, maximum = 512): string | undefined {
  const normalized = text(value, maximum);
  return normalized || undefined;
}

function number(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function id(value: unknown, fallback: string): string {
  return text(value, 128, fallback) || fallback;
}

function sanitizeSmartBin(value: unknown, index: number): VideoSmartBinDefinition | undefined {
  if (!isRecord(value)) return undefined;
  const name = text(value.name, 128);
  if (!name) return undefined;
  return {
    id: id(value.id, `smart-bin-${index + 1}`),
    name,
    query: text(value.query, 1_000),
    sortBy: value.sortBy === 'created' || value.sortBy === 'rating' || value.sortBy === 'scene' || value.sortBy === 'take'
      ? value.sortBy
      : 'name',
    sortDirection: value.sortDirection === 'descending' ? 'descending' : 'ascending',
  };
}

function sanitizeAnnotation(value: unknown, index: number, remainingReplies = MAX_VIDEO_REVIEW_REPLIES): VideoReviewAnnotation | undefined {
  if (!isRecord(value)) return undefined;
  const annotationText = text(value.text, 8_000);
  if (!annotationText) return undefined;
  const startMs = number(value.startMs, 0, 0, 86_400_000);
  const endMs = typeof value.endMs === 'number'
    ? number(value.endMs, startMs, startMs, 86_400_000)
    : undefined;
  const target = value.target === 'sequence-range' || value.target === 'visual-clip' || value.target === 'audio-clip'
    ? value.target
    : 'sequence-point';
  const status = value.status === 'in-progress' || value.status === 'resolved' ? value.status : 'open';
  const priority = value.priority === 'low' || value.priority === 'high' || value.priority === 'blocking'
    ? value.priority
    : 'normal';
  return {
    id: id(value.id, `review-${index + 1}`),
    target,
    startMs,
    endMs,
    clipId: target === 'visual-clip' || target === 'audio-clip' ? optionalText(value.clipId, 128) : undefined,
    author: text(value.author, 128, 'Local reviewer'),
    text: annotationText,
    status,
    priority,
    assignee: optionalText(value.assignee, 128),
    createdAt: number(value.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    updatedAt: number(value.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    replies: Array.isArray(value.replies)
      ? value.replies.slice(0, Math.min(MAX_VIDEO_REVIEW_REPLIES, Math.max(0, remainingReplies))).flatMap((reply, replyIndex) => {
          if (!isRecord(reply)) return [];
          const replyText = text(reply.text, 4_000);
          if (!replyText) return [];
          return [{
            id: id(reply.id, `reply-${index + 1}-${replyIndex + 1}`),
            author: text(reply.author, 128, 'Local reviewer'),
            text: replyText,
            createdAt: number(reply.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
          }];
        })
      : [],
  };
}

function sanitizeReviewAnnotations(value: unknown): VideoReviewAnnotation[] {
  if (!Array.isArray(value)) return [];
  const annotations: VideoReviewAnnotation[] = [];
  let remainingReplies = MAX_VIDEO_REVIEW_TOTAL_REPLIES;
  for (const [index, entry] of value.slice(0, MAX_VIDEO_REVIEW_ANNOTATIONS).entries()) {
    const sanitized = sanitizeAnnotation(entry, index, remainingReplies);
    if (!sanitized) continue;
    annotations.push(sanitized);
    remainingReplies -= sanitized.replies.length;
  }
  return annotations;
}

function sanitizeApproval(value: unknown, index: number): VideoReviewApproval | undefined {
  if (!isRecord(value)) return undefined;
  const compositionSignature = text(value.compositionSignature, 512);
  if (!compositionSignature) return undefined;
  return {
    id: id(value.id, `approval-${index + 1}`),
    reviewer: text(value.reviewer, 128, 'Local reviewer'),
    compositionSignature,
    status: value.status === 'changes-requested' ? 'changes-requested' : 'approved',
    createdAt: number(value.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    note: optionalText(value.note, 4_000),
  };
}

function sanitizeCaptionTrack(
  value: unknown,
  trackIndex: number,
  remainingCues = MAX_VIDEO_CAPTION_CUES,
): VideoSemanticCaptionTrack | undefined {
  if (!isRecord(value)) return undefined;
  const style = isRecord(value.style) ? value.style : {};
  return {
    id: id(value.id, `caption-track-${trackIndex + 1}`),
    name: text(value.name, 128, `Captions ${trackIndex + 1}`),
    language: text(value.language, 32, 'und'),
    service: value.service === 'subtitles' || value.service === 'sdh' ? value.service : 'captions',
    style: {
      fontFamily: text(style.fontFamily, 128, 'Inter'),
      fontSizePx: number(style.fontSizePx, 42, 8, 200),
      textColor: text(style.textColor, 32, '#ffffff'),
      backgroundOpacityPercent: number(style.backgroundOpacityPercent, 65, 0, 100),
      safeAreaPercent: number(style.safeAreaPercent, 10, 0, 30),
    },
    cues: Array.isArray(value.cues)
      ? value.cues.slice(0, Math.min(MAX_VIDEO_CAPTION_CUES, Math.max(0, remainingCues))).flatMap((cue, cueIndex) => {
          if (!isRecord(cue)) return [];
          const cueText = text(cue.text, 4_000);
          if (!cueText) return [];
          const startMs = number(cue.startMs, 0, 0, 86_400_000);
          const endMs = number(cue.endMs, startMs + 1, startMs + 1, 86_400_000);
          return [{
            id: id(cue.id, `caption-${trackIndex + 1}-${cueIndex + 1}`),
            startMs,
            endMs,
            text: cueText,
            speaker: optionalText(cue.speaker, 128),
            position: cue.position === 'top' || cue.position === 'center' ? cue.position : 'bottom' as const,
          }];
        })
      : [],
  };
}

function sanitizeCaptionTracks(value: unknown): VideoSemanticCaptionTrack[] {
  if (!Array.isArray(value)) return [];
  const tracks: VideoSemanticCaptionTrack[] = [];
  let remainingCues = MAX_VIDEO_CAPTION_CUES;
  for (const [index, entry] of value.slice(0, MAX_VIDEO_CAPTION_TRACKS).entries()) {
    const sanitized = sanitizeCaptionTrack(entry, index, remainingCues);
    if (!sanitized) continue;
    tracks.push(sanitized);
    remainingCues -= sanitized.cues.length;
  }
  return tracks;
}

function sanitizeCaptionEmbedding(
  value: unknown,
  tracks: readonly VideoSemanticCaptionTrack[],
): EditorProfessionalWorkflowState['captionEmbedding'] {
  if (!isRecord(value) || value.enabled !== true) return { enabled: false };
  const requestedTrackId = optionalText(value.trackId, 128);
  // A hand-edited/stale selected id must not silently redirect delivery to the first retained
  // language.  A missing id deliberately means "primary", but an explicit unknown id disables
  // the optional embedding intent until the editor chooses a retained track again.
  if (requestedTrackId && !tracks.some((track) => track.id === requestedTrackId)) return { enabled: false };
  const trackId = requestedTrackId;
  return { enabled: true, ...(trackId ? { trackId } : {}) };
}

function sanitizeDeliveryProfile(value: unknown, index: number): VideoDeliveryProfile | undefined {
  if (!isRecord(value)) return undefined;
  const name = text(value.name, 128);
  if (!name) return undefined;
  return {
    id: id(value.id, `delivery-profile-${index + 1}`),
    name,
    targets: Array.isArray(value.targets)
      ? value.targets.slice(0, MAX_VIDEO_DELIVERY_TARGETS).flatMap((target, targetIndex) => {
          if (!isRecord(target)) return [];
          const kind = target.kind === 'master-video' || target.kind === 'audio-mix' || target.kind === 'captions' || target.kind === 'qc-report'
            ? target.kind
            : 'review-video';
          return [{
            id: id(target.id, `target-${index + 1}-${targetIndex + 1}`),
            kind,
            presetId: optionalText(target.presetId, 128),
            fileNameTemplate: text(target.fileNameTemplate, 512, '{project}-{sequence}'),
            enabled: target.enabled !== false,
          }];
        })
      : [],
  };
}

function sanitizeDeliveryJob(value: unknown, index: number): VideoDeliveryJobRecord | undefined {
  if (!isRecord(value)) return undefined;
  const profileId = text(value.profileId, 128);
  const compositionSignature = text(value.compositionSignature, 512);
  if (!profileId || !compositionSignature) return undefined;
  const allowedStatus: VideoDeliveryJobRecord['status'][] = [
    'planned', 'queued', 'running', 'completed', 'partial', 'failed', 'cancelled', 'interrupted',
  ];
  const status = allowedStatus.includes(value.status as VideoDeliveryJobRecord['status'])
    ? value.status as VideoDeliveryJobRecord['status']
    : 'planned';
  return {
    id: id(value.id, `delivery-job-${index + 1}`),
    profileId,
    compositionSignature,
    status,
    createdAt: number(value.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    updatedAt: number(value.updatedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    hostDurability: value.hostDurability === 'native-restart-check' ? 'native-restart-check' : 'browser-session-only',
    outputs: Array.isArray(value.outputs) ? value.outputs.slice(0, MAX_VIDEO_DELIVERY_TARGETS).flatMap((output, outputIndex) => {
      if (!isRecord(output)) return [];
      const outputStatus = output.status === 'running' || output.status === 'succeeded' || output.status === 'failed'
        || output.status === 'blocked' || output.status === 'cancelled' || output.status === 'interrupted'
        ? output.status
        : 'queued';
      const outputResult = isRecord(output.result) ? output.result : undefined;
      const byteSize = typeof outputResult?.byteSize === 'number' && Number.isSafeInteger(outputResult.byteSize)
        ? Math.max(0, outputResult.byteSize)
        : undefined;
      const checksum = optionalText(outputResult?.checksum, 512);
      const reference = optionalText(outputResult?.reference, 2_048);
      const executionLeaseId = outputStatus === 'running' ? optionalText(output.executionLeaseId, 256) : undefined;
      return [{
        id: id(output.id, `output-${index + 1}-${outputIndex + 1}`),
        label: text(output.label, 256, `Output ${outputIndex + 1}`),
        fileName: text(output.fileName, 512, `output-${outputIndex + 1}`),
        extension: optionalText(output.extension, 16),
        container: optionalText(output.container, 128),
        codec: optionalText(output.codec, 128),
        target: output.target === 'native' || output.target === 'browser' ? output.target : undefined,
        status: outputStatus,
        missingCapabilities: Array.isArray(output.missingCapabilities)
          ? [...new Set(output.missingCapabilities.flatMap((capability) => {
              const normalized = optionalText(capability, 128);
              return normalized ? [normalized] : [];
            }))].slice(0, 128)
          : [],
        checksumIntent: output.checksumIntent === 'none' ? 'none' : 'sha256',
        manifestIntent: output.manifestIntent === 'none' ? 'none' : 'write-json',
        executionDurability: output.executionDurability === 'native-host-resume-required' || output.executionDurability === 'blocked'
          ? output.executionDurability
          : 'browser-session-only',
        truthfulnessNote: text(output.truthfulnessNote, 2_000),
        // Clamped to the attempt ceiling so a hand-edited or corrupted file cannot grant unlimited retries.
        attempts: Math.round(number(output.attempts, 0, 0, MAX_VIDEO_DELIVERY_OUTPUT_ATTEMPTS)),
        // An active execution lease only has meaning while the output is running. Retaining it for
        // a stopped record would let a late callback claim a later retry after save/reopen.
        ...(executionLeaseId
          ? { executionLeaseId }
          : {}),
        error: optionalText(output.error, 2_000),
        ...(byteSize !== undefined || checksum || reference
          ? {
            result: {
              ...(byteSize !== undefined ? { byteSize } : {}),
              ...(checksum ? { checksum } : {}),
              ...(reference ? { reference } : {}),
            },
          }
          : {}),
      }];
    }) : undefined,
    manifestIntent: isRecord(value.manifestIntent) ? {
      includeFrozenCompositionSignature: true,
      includeOutputChecksums: value.manifestIntent.includeOutputChecksums === true,
    } : undefined,
    message: optionalText(value.message, 2_000),
  };
}

function sanitizeIdList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => {
    const normalized = optionalText(entry, 128);
    return normalized ? [normalized] : [];
  }))].slice(0, maximum);
}

function sanitizeTrackTargetId(value: unknown): string | undefined {
  const normalized = optionalText(value, 128);
  if (!normalized || !/^[\p{Letter}\p{Number}][\p{Letter}\p{Number}._:-]{0,127}$/u.test(normalized)) return undefined;
  return normalized;
}

function trackTargetKind(value: string): 'video' | 'audio' | undefined {
  const normalized = value.toLocaleLowerCase();
  if (/^video[:_-]\d+$/u.test(normalized) || /^v\d+$/u.test(normalized)) return 'video';
  if (/^audio[:_-]\d+$/u.test(normalized) || /^a\d+$/u.test(normalized)) return 'audio';
  return undefined;
}

function sanitizeEditorialState(
  value: unknown,
  options: VideoProductionStateSanitizeOptions,
): VideoEditorialWorkflowState {
  const record = isRecord(value) ? value : {};
  const authoritativeTrackIds = options.validTargetTrackIds
    ? new Set(options.validTargetTrackIds.flatMap((trackId) => {
        const normalized = sanitizeTrackTargetId(trackId);
        return normalized ? [normalized] : [];
      }).slice(0, MAX_VIDEO_EDITORIAL_TRACKS))
    : undefined;
  const referencedTrackIds = new Set<string>();
  const acceptTargetTrackId = (value: unknown, expectedKind?: 'video' | 'audio'): string | undefined => {
    const normalized = sanitizeTrackTargetId(value);
    if (!normalized || (authoritativeTrackIds && !authoritativeTrackIds.has(normalized))) return undefined;
    const inferredKind = trackTargetKind(normalized);
    if (expectedKind && inferredKind && inferredKind !== expectedKind) return undefined;
    if (!referencedTrackIds.has(normalized) && referencedTrackIds.size >= MAX_VIDEO_EDITORIAL_TRACKS) return undefined;
    referencedTrackIds.add(normalized);
    return normalized;
  };
  const sourcePatches = Array.isArray(record.sourcePatches)
    ? record.sourcePatches.slice(0, MAX_VIDEO_EDITORIAL_TRACKS).flatMap((entry, index) => {
        if (!isRecord(entry)) return [];
        const sourceKind = entry.sourceKind === 'audio' ? 'audio' as const : 'video' as const;
        const targetTrackId = acceptTargetTrackId(entry.targetTrackId, sourceKind);
        if (!targetTrackId) return [];
        return [{
          id: id(entry.id, `source-patch-${index + 1}`),
          sourceKind,
          sourceTrackIndex: Math.round(number(entry.sourceTrackIndex, 0, 0, MAX_VIDEO_EDITORIAL_TRACKS - 1)),
          targetTrackId,
          enabled: entry.enabled !== false,
        }];
      })
    : [];
  const sanitizeTargetIdList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const result: string[] = [];
    const seen = new Set<string>();
    for (const candidate of input) {
      const targetTrackId = acceptTargetTrackId(candidate);
      if (!targetTrackId || seen.has(targetTrackId)) continue;
      seen.add(targetTrackId);
      result.push(targetTrackId);
    }
    return result;
  };
  return {
    sourcePatches,
    recordTargetTrackIds: sanitizeTargetIdList(record.recordTargetTrackIds),
    syncLockedTrackIds: sanitizeTargetIdList(record.syncLockedTrackIds),
    sequenceBins: Array.isArray(record.sequenceBins)
      ? record.sequenceBins.slice(0, MAX_VIDEO_SEQUENCE_NAVIGATOR_ITEMS).flatMap((entry, index) => {
          if (!isRecord(entry)) return [];
          const name = optionalText(entry.name, 128);
          if (!name) return [];
          return [{
            id: id(entry.id, `sequence-bin-${index + 1}`),
            name,
            sequenceIds: sanitizeIdList(entry.sequenceIds, MAX_VIDEO_SEQUENCE_NAVIGATOR_ITEMS),
          }];
        })
      : [],
    sequenceViewStates: Array.isArray(record.sequenceViewStates)
      ? record.sequenceViewStates.slice(0, MAX_VIDEO_SEQUENCE_NAVIGATOR_ITEMS).flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const sequenceId = optionalText(entry.sequenceId, 128);
          if (!sequenceId) return [];
          const workArea = isRecord(entry.workArea) ? entry.workArea : undefined;
          const inMs = workArea ? Math.round(number(workArea.inMs, 0, 0, MAX_VIDEO_PROJECT_DURATION_MS)) : 0;
          const outMs = workArea
            ? Math.round(number(workArea.outMs, Math.max(1, inMs + 1), inMs + 1, MAX_VIDEO_PROJECT_DURATION_MS))
            : 0;
          return [{
            sequenceId,
            zoomPercent: number(entry.zoomPercent, 100, 100, 50_000),
            scrollLeftPx: number(entry.scrollLeftPx, 0, 0, 1_000_000_000),
            workArea: workArea ? { inMs, outMs, loopEnabled: workArea.loopEnabled === true } : undefined,
          }];
        })
      : [],
  };
}

export function sanitizeEditorProfessionalWorkflowState(
  value: unknown,
  options: VideoProductionStateSanitizeOptions = {},
): EditorProfessionalWorkflowState {
  const defaults = createDefaultEditorProfessionalWorkflowState();
  if (!isRecord(value)) return defaults;
  const rawTimebase = isRecord(value.timebase) ? value.timebase : {};
  const denominator = Math.round(number(rawTimebase.denominator, defaults.timebase.denominator, 1, 100_000));
  const numerator = Math.round(number(rawTimebase.numerator, defaults.timebase.numerator, 1, 240_000));
  const state: EditorProfessionalWorkflowState = {
    version: VIDEO_PRODUCTION_STATE_VERSION,
    timebase: {
      numerator,
      denominator,
      dropFrame: rawTimebase.dropFrame === true && ((numerator === 30_000 && denominator === 1_001) || (numerator === 60_000 && denominator === 1_001)),
      sequenceStartTimecode: text(rawTimebase.sequenceStartTimecode, 32, defaults.timebase.sequenceStartTimecode),
      mixedRatePolicy: rawTimebase.mixedRatePolicy === 'preserve-frame-number' || rawTimebase.mixedRatePolicy === 'reject'
        ? rawTimebase.mixedRatePolicy
        : 'preserve-time',
    },
    smartBins: Array.isArray(value.smartBins)
      ? value.smartBins.slice(0, MAX_VIDEO_SMART_BINS).flatMap((entry, index) => {
          const sanitized = sanitizeSmartBin(entry, index);
          return sanitized ? [sanitized] : [];
        })
      : [],
    reviewAnnotations: sanitizeReviewAnnotations(value.reviewAnnotations),
    reviewApprovals: Array.isArray(value.reviewApprovals)
      ? value.reviewApprovals.slice(0, MAX_VIDEO_REVIEW_ANNOTATIONS).flatMap((entry, index) => {
          const sanitized = sanitizeApproval(entry, index);
          return sanitized ? [sanitized] : [];
        })
      : [],
    captionTracks: sanitizeCaptionTracks(value.captionTracks),
    captionEmbedding: { enabled: false },
    deliveryProfiles: Array.isArray(value.deliveryProfiles)
      ? value.deliveryProfiles.slice(0, MAX_VIDEO_DELIVERY_PROFILES).flatMap((entry, index) => {
          const sanitized = sanitizeDeliveryProfile(entry, index);
          return sanitized ? [sanitized] : [];
        })
      : defaults.deliveryProfiles,
    deliveryJobs: Array.isArray(value.deliveryJobs)
      ? pruneVideoDeliveryJobsToBound(value.deliveryJobs.flatMap((entry, index) => {
          const sanitized = sanitizeDeliveryJob(entry, index);
          return sanitized ? [sanitized] : [];
      }))
      : [],
    decodedSignalQcReport: sanitizeVideoDecodedSignalQcReport(value.decodedSignalQcReport),
    editorial: sanitizeEditorialState(value.editorial, options),
  };
  state.captionEmbedding = sanitizeCaptionEmbedding(value.captionEmbedding, state.captionTracks);
  return state;
}

/**
 * Attaches a completed decoded-signal report to the latest durable workflow
 * snapshot. Async callers must use this current-state merge instead of
 * spreading the state captured when a potentially long decode began.
 */
export function mergeVideoDecodedSignalQcReport(
  currentState: unknown,
  report: unknown,
): EditorProfessionalWorkflowState {
  const current = sanitizeEditorProfessionalWorkflowState(currentState);
  const decodedSignalQcReport = sanitizeVideoDecodedSignalQcReport(report);
  return decodedSignalQcReport
    ? { ...current, decodedSignalQcReport }
    : current;
}
