import type { EditorAudioClip, EditorVisualClip } from '../types/flow';
import type { VideoDeliveryProfile as EditorVideoDeliveryProfile, VideoSemanticCaptionTrack } from '../types/videoProduction';
import type { SourceBinItem } from './sourceBin';
import {
  type AdvancedTrimClip,
  type AdvancedTrimTrack,
  commitAdvancedTrimSession,
  createAdvancedTrimSession,
  updateAdvancedTrimSession,
} from './videoAdvancedTrim';
import type { VideoBatchClip, VideoBatchEditResult, VideoBatchTrack } from './videoBatchEditing';
import {
  VIDEO_DELIVERY_PROFILE_VERSION,
  planVideoDeliveryJob,
  type VideoDeliveryCompositionSnapshot,
  type VideoDeliveryJob,
  type VideoDeliveryPlanningEnvironment,
  type VideoDeliveryProfile,
} from './videoDeliveryJobs';
import type { SourceRecordClip, SourceRecordProposal, SourceRecordTrack } from './videoSourceRecordEditing';
import {
  analyzeVideoStructuralQc,
  type VideoStructuralQcCaptionPolicy,
  type VideoStructuralQcFeatureDescriptor,
  type VideoStructuralQcReport,
  type VideoStructuralQcSourceDescriptor,
} from './videoStructuralQc';
import { migrateLegacyTracksToV2, type LegacyTrackState, type VideoTrackV2 } from './videoTrackModelV2';

/** Twelve hours is deliberately far beyond feature length while keeping every edit finite and bounded. */
export const MAX_VIDEO_WORKFLOW_DURATION_MS = 12 * 60 * 60 * 1_000;
export const MAX_VIDEO_WORKFLOW_TRACKS = 64;
export const MAX_VIDEO_WORKFLOW_CLIPS = 100_000;

export type VideoWorkflowSourceDurationLookup = (
  source: SourceBinItem | undefined,
  sourceNodeId: string,
) => number | undefined;

export interface VideoWorkflowTrackState extends LegacyTrackState {
  videoTrackCount: number;
  audioTrackCount: number;
}

export type VideoWorkflowRejectedReason =
  | 'clip-not-found'
  | 'duplicate-clip-id'
  | 'feature-length-bound-exceeded'
  | 'invalid-frame-rate'
  | 'invalid-proposal'
  | 'invalid-source-duration'
  | 'invalid-timeline-clip'
  | 'missing-created-clip-template'
  | 'noncontiguous-neighbors'
  | 'partial-frame-slide'
  | 'too-many-clips'
  | 'too-many-tracks'
  | 'track-not-found'
  | 'unsupported-audio-retime'
  | 'visual-enabled-not-representable'
  | string;

export type VideoWorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: VideoWorkflowRejectedReason };

export interface VideoWorkflowBatchClip extends VideoBatchClip {
  adapterOriginalClipId: string;
}

export interface VideoWorkflowBatchProjection {
  clips: VideoWorkflowBatchClip[];
  tracks: VideoBatchTrack[];
  visualClips: EditorVisualClip[];
  audioClips: EditorAudioClip[];
}

export interface VideoWorkflowSourceRecordClip extends SourceRecordClip {
  /** Preserved by split/lift/extract proposals. Replacement clips intentionally omit it. */
  adapterOriginalClipId?: string;
}

export interface VideoWorkflowSourceRecordProjection {
  clips: VideoWorkflowSourceRecordClip[];
  tracks: SourceRecordTrack[];
  sourceItems: SourceBinItem[];
  visualClips: EditorVisualClip[];
  audioClips: EditorAudioClip[];
}

export interface VideoWorkflowAppliedClips {
  visualClips: EditorVisualClip[];
  audioClips: EditorAudioClip[];
  affectedClipIds: string[];
  createdClipIds: string[];
  removedClipIds: string[];
}

export interface VideoWorkflowCreatedClipTemplates {
  visualBySourceId?: Readonly<Record<string, EditorVisualClip>>;
  audioBySourceId?: Readonly<Record<string, EditorAudioClip>>;
}

export function normalizeVideoWorkflowBatch(input: {
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  trackState: VideoWorkflowTrackState;
  sourceItems: readonly SourceBinItem[];
  sourceDurationMs: VideoWorkflowSourceDurationLookup;
}): VideoWorkflowResult<VideoWorkflowBatchProjection> {
  const timeline = normalizeTimeline(input);
  if (!timeline.ok) return timeline;
  return {
    ok: true,
    value: {
      clips: timeline.value.clips.map((clip): VideoWorkflowBatchClip => ({
        id: clip.id,
        kind: clip.kind,
        trackIndex: timeline.value.trackIndexById.get(clip.trackId)!,
        startMs: clip.startMs,
        durationMs: clip.durationMs,
        // EditorVisualClip has no enabled field. `true` here describes its rendered legacy state;
        // applyVideoWorkflowBatchProposal rejects any proposal that tries to change it.
        enabled: clip.enabled,
        linkGroupId: clip.linkGroupId,
        adapterOriginalClipId: clip.adapterOriginalClipId!,
      })),
      tracks: timeline.value.tracks.map((track) => ({
        kind: track.kind,
        trackIndex: track.order,
        locked: track.locked,
      })),
      visualClips: input.visualClips.map(cloneVisual),
      audioClips: input.audioClips.map(cloneAudio),
    },
  };
}

export function applyVideoWorkflowBatchProposal(
  projection: VideoWorkflowBatchProjection,
  proposal: VideoBatchEditResult<VideoWorkflowBatchClip>,
): VideoWorkflowResult<VideoWorkflowAppliedClips> {
  if (!proposal.applied) return { ok: false, reason: proposal.reason ?? 'invalid-proposal' };
  const originals = originalMaps(projection.visualClips, projection.audioClips);
  const visualClips: EditorVisualClip[] = [];
  const audioClips: EditorAudioClip[] = [];
  const seen = new Set<string>();
  for (const clip of proposal.clips) {
    if (!clip.id || seen.has(clip.id)) return { ok: false, reason: 'duplicate-clip-id' };
    seen.add(clip.id);
    const original = originals.get(clip.adapterOriginalClipId);
    if (!original) return { ok: false, reason: 'missing-created-clip-template' };
    if (clip.kind === 'video') {
      if (original.kind !== 'video') return { ok: false, reason: 'invalid-proposal' };
      if (!clip.enabled) return { ok: false, reason: 'visual-enabled-not-representable' };
      visualClips.push({
        ...original.clip,
        id: clip.id,
        trackIndex: clip.trackIndex,
        startMs: clip.startMs,
        professional: mergeProfessional(original.clip.professional, clip.linkGroupId),
      });
    } else {
      if (original.kind !== 'audio') return { ok: false, reason: 'invalid-proposal' };
      audioClips.push({
        ...original.clip,
        id: clip.id,
        trackIndex: clip.trackIndex,
        offsetMs: clip.startMs,
        enabled: clip.enabled,
        professional: mergeProfessional(original.clip.professional, clip.linkGroupId),
      });
    }
  }
  return {
    ok: true,
    value: {
      visualClips,
      audioClips,
      affectedClipIds: [...proposal.affectedClipIds],
      createdClipIds: proposal.clips.filter((clip) => !originals.has(clip.id)).map((clip) => clip.id),
      removedClipIds: [...originals.keys()].filter((id) => !seen.has(id)),
    },
  };
}

export function normalizeVideoWorkflowSourceRecord(input: {
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  trackState: VideoWorkflowTrackState;
  sourceItems: readonly SourceBinItem[];
  sourceDurationMs: VideoWorkflowSourceDurationLookup;
}): VideoWorkflowResult<VideoWorkflowSourceRecordProjection> {
  const timeline = normalizeTimeline(input);
  if (!timeline.ok) return timeline;
  return {
    ok: true,
    value: {
      clips: timeline.value.clips,
      tracks: timeline.value.tracks.map(toSourceRecordTrack),
      sourceItems: input.sourceItems.map(cloneSourceItem),
      visualClips: input.visualClips.map(cloneVisual),
      audioClips: input.audioClips.map(cloneAudio),
    },
  };
}

export function applyVideoWorkflowSourceRecordProposal(
  projection: VideoWorkflowSourceRecordProjection,
  proposal: SourceRecordProposal<VideoWorkflowSourceRecordClip>,
  templates: VideoWorkflowCreatedClipTemplates = {},
): VideoWorkflowResult<VideoWorkflowAppliedClips> {
  if (!proposal.applied) return { ok: false, reason: proposal.reason ?? 'invalid-proposal' };
  const trackById = new Map(projection.tracks.map((track) => [track.id, track]));
  const originals = originalMaps(projection.visualClips, projection.audioClips);
  const projectionById = new Map(projection.clips.map((clip) => [clip.id, clip]));
  const sourceById = indexSourceItems(projection.sourceItems);
  const visualClips: EditorVisualClip[] = [];
  const audioClips: EditorAudioClip[] = [];
  const seen = new Set<string>();

  for (const clip of proposal.clips) {
    if (!clip.id || seen.has(clip.id)) return { ok: false, reason: 'duplicate-clip-id' };
    seen.add(clip.id);
    const track = trackById.get(clip.trackId);
    if (!track || track.kind !== clip.kind) return { ok: false, reason: 'track-not-found' };
    const source = sourceById.get(clip.sourceId);
    const original = clip.adapterOriginalClipId ? originals.get(clip.adapterOriginalClipId) : undefined;
    const originalProjection = clip.adapterOriginalClipId
      ? projectionById.get(clip.adapterOriginalClipId)
      : undefined;
    // Source/record engines clone untouched entries. Keep their exact legacy representation (including
    // optional fields) instead of needlessly projecting it through source/record time and back.
    if (original && clip.id === clip.adapterOriginalClipId
      && originalProjection && sameSourceRecordDecision(clip, originalProjection)) {
      if (original.kind === 'video') visualClips.push(cloneVisual(original.clip));
      else audioClips.push(cloneAudio(original.clip));
      continue;
    }
    if (original && original.kind !== clip.kind) return { ok: false, reason: 'invalid-proposal' };
    if (clip.kind === 'video') {
      if (!clip.enabled) return { ok: false, reason: 'visual-enabled-not-representable' };
      const base = original?.kind === 'video'
        ? original.clip
        : findTemplate(templates.visualBySourceId, clip.sourceId, source);
      if (!base) return { ok: false, reason: 'missing-created-clip-template' };
      const range = sourceRangeFromNormalized(clip);
      if (!range) return { ok: false, reason: 'invalid-proposal' };
      visualClips.push({
        ...base,
        id: clip.id,
        sourceNodeId: source?.nodeId ?? base.sourceNodeId,
        trackIndex: track.order,
        startMs: clip.startMs,
        sourceInMs: range.sourceInMs,
        sourceOutMs: range.sourceOutMs,
        trimStartMs: range.sourceInMs,
        trimEndMs: Math.max(0, (clip.sourceDurationMs ?? range.sourceOutMs) - range.sourceOutMs),
        durationSeconds: clip.durationMs / 1_000,
        playbackRate: clip.playbackRate,
        reversePlayback: clip.reverse,
        professional: mergeProfessional(base.professional, clip.linkGroupId, clip.trackId),
      });
    } else {
      if (clip.reverse || Math.abs(clip.playbackRate - 1) > 1e-9) {
        return { ok: false, reason: 'unsupported-audio-retime' };
      }
      const base = original?.kind === 'audio'
        ? original.clip
        : findTemplate(templates.audioBySourceId, clip.sourceId, source);
      if (!base) return { ok: false, reason: 'missing-created-clip-template' };
      audioClips.push({
        ...base,
        id: clip.id,
        sourceNodeId: source?.nodeId ?? base.sourceNodeId,
        trackIndex: track.order,
        offsetMs: clip.startMs,
        sourceInMs: clip.sourceInMs,
        sourceOutMs: clip.sourceInMs + clip.durationMs,
        enabled: clip.enabled,
        professional: mergeProfessional(base.professional, clip.linkGroupId, clip.trackId),
      });
    }
  }

  return {
    ok: true,
    value: {
      visualClips,
      audioClips,
      affectedClipIds: [...proposal.affectedClipIds],
      createdClipIds: [...proposal.createdClipIds],
      removedClipIds: [...proposal.removedClipIds],
    },
  };
}

export function proposeOneFrameVideoWorkflowSlide(input: {
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  trackState: VideoWorkflowTrackState;
  sourceItems: readonly SourceBinItem[];
  sourceDurationMs: VideoWorkflowSourceDurationLookup;
  selectedVisualClipId: string;
  direction: -1 | 1;
  framesPerSecond: number;
}): VideoWorkflowResult<VideoWorkflowAppliedClips & {
  appliedDeltaMs: number;
  leftNeighborClipId: string;
  rightNeighborClipId: string;
}> {
  if (!Number.isFinite(input.framesPerSecond) || input.framesPerSecond <= 0) {
    return { ok: false, reason: 'invalid-frame-rate' };
  }
  const projectionResult = normalizeVideoWorkflowSourceRecord(input);
  if (!projectionResult.ok) return projectionResult;
  const projection = projectionResult.value;
  const selected = projection.clips.find((clip) => clip.id === input.selectedVisualClipId && clip.kind === 'video');
  if (!selected) return { ok: false, reason: 'clip-not-found' };
  const sameTrack = projection.clips
    .filter((clip) => clip.kind === 'video' && clip.trackId === selected.trackId && clip.id !== selected.id)
    .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
  const epsilon = 0.001;
  const left = sameTrack.find((clip) => Math.abs(clip.startMs + clip.durationMs - selected.startMs) <= epsilon);
  const right = sameTrack.find((clip) => Math.abs(selected.startMs + selected.durationMs - clip.startMs) <= epsilon);
  if (!left || !right) return { ok: false, reason: 'noncontiguous-neighbors' };

  const tracks: AdvancedTrimTrack[] = projection.tracks.map(({ id, kind, locked }) => ({ id, kind, locked }));
  const session = createAdvancedTrimSession(
    projection.clips as readonly (VideoWorkflowSourceRecordClip & AdvancedTrimClip)[],
    tracks,
    {
      mode: 'slide',
      primaryClipId: selected.id,
      leftNeighborClipId: left.id,
      rightNeighborClipId: right.id,
      includeLinked: true,
      minimumDurationMs: 1,
    },
  );
  if (!session.ok) return { ok: false, reason: session.reason };
  const deltaMs = input.direction * (1_000 / input.framesPerSecond);
  const updated = updateAdvancedTrimSession(session.session, deltaMs);
  if (!updated.applied) return { ok: false, reason: updated.reason ?? 'invalid-proposal' };
  if (Math.abs(updated.session.appliedDeltaMs - deltaMs) > 1e-6) {
    return { ok: false, reason: 'partial-frame-slide' };
  }
  const committed = commitAdvancedTrimSession(updated.session);
  if (!committed.applied) return { ok: false, reason: committed.reason ?? 'invalid-proposal' };
  const proposal: SourceRecordProposal<VideoWorkflowSourceRecordClip> = {
    applied: true,
    clips: committed.session.previewClips,
    affectedClipIds: committed.session.affectedClipIds,
    createdClipIds: [],
    removedClipIds: [],
    recordTrackIds: [selected.trackId],
  };
  const applied = applyVideoWorkflowSourceRecordProposal(projection, proposal);
  if (!applied.ok) return applied;
  return {
    ok: true,
    value: {
      ...applied.value,
      appliedDeltaMs: updated.session.appliedDeltaMs,
      leftNeighborClipId: left.id,
      rightNeighborClipId: right.id,
    },
  };
}

export interface VideoWorkflowQcInput {
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  trackState: VideoWorkflowTrackState;
  sourceItems: readonly SourceBinItem[];
  sourceDurationMs: VideoWorkflowSourceDurationLookup;
  captionTracks?: readonly VideoSemanticCaptionTrack[];
  framesPerSecond: number;
  projectDurationMs?: number;
  compositionSignature?: string;
  renderCacheSignature?: string;
  workingColorSpace?: string;
  deliveryColorSpace?: string;
  deliveryColorTransformState?: 'configured' | 'missing' | 'setup-only';
  continuousTrackIds?: readonly string[];
  clipFeatureStatus?: Readonly<Record<string, { unsupported?: readonly string[]; setupOnly?: readonly string[] }>>;
  features?: readonly VideoStructuralQcFeatureDescriptor[];
  captionPolicy?: Partial<VideoStructuralQcCaptionPolicy>;
}

export function buildVideoWorkflowStructuralQc(
  input: VideoWorkflowQcInput,
): VideoWorkflowResult<VideoStructuralQcReport> {
  if (!Number.isFinite(input.framesPerSecond) || input.framesPerSecond <= 0) {
    return { ok: false, reason: 'invalid-frame-rate' };
  }
  const projection = normalizeVideoWorkflowSourceRecord(input);
  if (!projection.ok) return projection;
  const continuous = new Set(input.continuousTrackIds ?? []);
  const captions = (input.captionTracks ?? []).flatMap((track) => track.cues.map((cue) => ({
    id: cue.id,
    trackId: track.id,
    startFrame: msToFrame(cue.startMs, input.framesPerSecond),
    endFrame: msToFrame(cue.endMs, input.framesPerSecond),
    text: cue.text,
  })));
  const visualClipById = new Map(input.visualClips.map((clip) => [clip.id, clip]));
  const clipDescriptors = projection.value.clips.map((clip) => {
    const status = input.clipFeatureStatus?.[clip.id];
    const range = sourceRangeFromNormalized(clip);
    const visualClip = clip.kind === 'video' ? visualClipById.get(clip.id) : undefined;
    const isSelfContainedGraphic = visualClip?.sourceKind === 'text'
      || visualClip?.sourceKind === 'shape'
      || visualClip?.sourceKind === 'comic';
    return {
      id: clip.id,
      trackId: clip.trackId,
      kind: isSelfContainedGraphic ? 'graphic' : clip.kind,
      startFrame: msToFrame(clip.startMs, input.framesPerSecond),
      durationFrames: Math.max(1, msToFrame(clip.durationMs, input.framesPerSecond)),
      sourceId: isSelfContainedGraphic ? undefined : clip.sourceId,
      requiresSource: !isSelfContainedGraphic,
      sourceInFrame: !isSelfContainedGraphic && range ? msToFrame(range.sourceInMs, input.framesPerSecond) : undefined,
      sourceOutFrame: !isSelfContainedGraphic && range ? msToFrame(range.sourceOutMs, input.framesPerSecond) : undefined,
      enabled: clip.kind === 'audio' ? clip.enabled : undefined,
      unsupportedFeatures: status?.unsupported ? [...status.unsupported] : undefined,
      setupOnlyFeatures: status?.setupOnly ? [...status.setupOnly] : undefined,
    } as const;
  });
  const inferredDuration = Math.max(
    0,
    ...projection.value.clips.map((clip) => clip.startMs + clip.durationMs),
    ...(input.captionTracks ?? []).flatMap((track) => track.cues.map((cue) => cue.endMs)),
  );
  const durationMs = input.projectDurationMs ?? inferredDuration;
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_VIDEO_WORKFLOW_DURATION_MS) {
    return { ok: false, reason: 'feature-length-bound-exceeded' };
  }
  const captionTrackDescriptors = (input.captionTracks ?? []).map((track) => ({
    id: track.id,
    kind: 'caption' as const,
    continuity: 'allow-gaps' as const,
  }));
  return {
    ok: true,
    value: analyzeVideoStructuralQc({
      project: {
        durationFrames: msToFrame(durationMs, input.framesPerSecond),
        framesPerSecond: input.framesPerSecond,
        workingColorSpace: input.workingColorSpace,
        deliveryColorSpace: input.deliveryColorSpace,
        deliveryColorTransformState: input.deliveryColorTransformState,
        compositionSignature: input.compositionSignature,
        renderCacheSignature: input.renderCacheSignature,
      },
      sources: input.sourceItems.map((source) => sourceQcDescriptor(source, input.sourceDurationMs, input.framesPerSecond)),
      tracks: [
        ...projection.value.tracks.map((track) => ({
          id: track.id,
          kind: track.kind,
          continuity: continuous.has(track.id) ? 'continuous' as const : 'allow-gaps' as const,
        })),
        ...captionTrackDescriptors,
      ],
      clips: clipDescriptors,
      captions,
      features: input.features,
      captionPolicy: input.captionPolicy,
    }),
  };
}

export const DEFAULT_VIDEO_WORKFLOW_DELIVERY_PROFILE: VideoDeliveryProfile = Object.freeze({
  version: VIDEO_DELIVERY_PROFILE_VERSION,
  id: 'professional-default-v1',
  name: 'Professional review and master',
  fileNameTemplate: '{project}-{composition}-{deliverable}-{date}',
  outputs: Object.freeze([
    Object.freeze({
      id: 'review-h264', label: 'Review', extension: 'mp4', container: 'mp4', codec: 'h264',
      requestedTarget: 'auto' as const,
      requiredCapabilities: Object.freeze(['encode:h264', 'mux:mp4']),
      checksum: 'sha256' as const, writeManifest: true,
    }),
    Object.freeze({
      id: 'master-prores', label: 'Master', extension: 'mov', container: 'mov', codec: 'prores-422-hq',
      requestedTarget: 'native' as const, supportedTargets: Object.freeze(['native' as const]),
      requiredCapabilities: Object.freeze(['encode:prores-422-hq', 'mux:mov']),
      checksum: 'sha256' as const, writeManifest: true,
    }),
  ]),
});

export function createDefaultVideoWorkflowDeliveryJob(input: {
  jobId: string;
  createdAt: string;
  projectName: string;
  composition: VideoDeliveryCompositionSnapshot;
  host: VideoDeliveryPlanningEnvironment;
  profile?: EditorVideoDeliveryProfile;
  existingFileNames?: readonly string[];
}): VideoDeliveryJob {
  const date = new Date(input.createdAt);
  if (!Number.isFinite(date.getTime())) throw new Error('Delivery createdAt must be an ISO timestamp.');
  return planVideoDeliveryJob({
    jobId: input.jobId,
    createdAt: input.createdAt,
    profile: input.profile ? adaptEditorDeliveryProfile(input.profile) : DEFAULT_VIDEO_WORKFLOW_DELIVERY_PROFILE,
    composition: input.composition,
    environment: input.host,
    fileNameTokens: {
      project: input.projectName,
      composition: input.composition.compositionName,
      date: date.toISOString().slice(0, 10),
      revision: input.composition.revision,
    },
    existingFileNames: input.existingFileNames,
  });
}

/**
 * A video deliverable is rendered through the composition's own export route, so the only honest
 * statement about whether it can run is whether the sequence is currently set to that exact export
 * preset. Expressing that as a capability lets the existing planner block a mismatch with a precise
 * reason instead of rendering one format and labelling it another. A target with no preset can never
 * satisfy this, which fails closed rather than delivering an arbitrary format under a fixed name.
 */
export function videoCompositionPresetCapability(presetId: string | undefined): string {
  return `render:composition-preset:${presetId?.trim() || 'unspecified'}`;
}

function adaptEditorDeliveryProfile(profile: EditorVideoDeliveryProfile): VideoDeliveryProfile {
  const outputs = profile.targets.filter((target) => target.enabled).map((target) => {
    const fileNameTemplate = normalizeEditorDeliveryFileNameTemplate(target.fileNameTemplate);
    switch (target.kind) {
      case 'review-video': return {
        id: target.id, label: 'Review video', extension: 'mp4', container: 'mp4', codec: 'h264', fileNameTemplate,
        requestedTarget: 'auto' as const, requiredCapabilities: [videoCompositionPresetCapability(target.presetId)], checksum: 'sha256' as const, writeManifest: true,
      };
      case 'master-video': return {
        id: target.id, label: 'Master video', extension: 'mov', container: 'mov', codec: 'prores-422-hq', fileNameTemplate,
        requestedTarget: 'native' as const, supportedTargets: ['native' as const], requiredCapabilities: [videoCompositionPresetCapability(target.presetId)], checksum: 'sha256' as const, writeManifest: true,
      };
      case 'audio-mix': return {
        id: target.id, label: 'Audio mix', extension: 'wav', container: 'wav', codec: 'pcm-s24le', fileNameTemplate,
        requestedTarget: 'native' as const, supportedTargets: ['native' as const], requiredCapabilities: ['encode:pcm-s24le', 'mux:wav'], checksum: 'sha256' as const, writeManifest: true,
      };
      case 'captions': return {
        id: target.id, label: 'Captions', extension: 'vtt', container: 'webvtt', codec: 'webvtt', fileNameTemplate,
        requestedTarget: 'browser' as const, supportedTargets: ['browser' as const], requiredCapabilities: ['export:captions-vtt'], checksum: 'sha256' as const, writeManifest: true,
      };
      case 'qc-report': return {
        id: target.id, label: 'Structural QC', extension: 'json', container: 'json', codec: 'structural-qc-v1', fileNameTemplate,
        requestedTarget: 'browser' as const, supportedTargets: ['browser' as const], requiredCapabilities: ['export:structural-qc-json'], checksum: 'sha256' as const, writeManifest: true,
      };
    }
  });
  return {
    version: VIDEO_DELIVERY_PROFILE_VERSION,
    id: profile.id,
    name: profile.name,
    fileNameTemplate: '{project}-{composition}-{deliverable}',
    outputs,
  };
}

function normalizeEditorDeliveryFileNameTemplate(value: string): string {
  return value
    .replaceAll('{sequence}', '{composition}')
    .replaceAll('{language}', 'captions')
    .trim() || '{project}-{composition}-{deliverable}';
}

interface NormalizedTimeline {
  clips: VideoWorkflowSourceRecordClip[];
  tracks: VideoTrackV2[];
  trackIndexById: Map<string, number>;
}

function normalizeTimeline(input: {
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  trackState: VideoWorkflowTrackState;
  sourceItems: readonly SourceBinItem[];
  sourceDurationMs: VideoWorkflowSourceDurationLookup;
}): VideoWorkflowResult<NormalizedTimeline> {
  if (input.visualClips.length + input.audioClips.length > MAX_VIDEO_WORKFLOW_CLIPS) {
    return { ok: false, reason: 'too-many-clips' };
  }
  const tracksResult = normalizeTracks(input.trackState);
  if (!tracksResult.ok) return tracksResult;
  const tracks = tracksResult.value;
  const trackByKindAndOrder = new Map(tracks.map((track) => [`${track.kind}:${track.order}`, track]));
  const trackIndexById = new Map(tracks.map((track) => [track.id, track.order]));
  const sourceById = indexSourceItems(input.sourceItems);
  const ids = new Set<string>();
  const clips: VideoWorkflowSourceRecordClip[] = [];
  const append = (clip: VideoWorkflowSourceRecordClip): boolean => {
    if (!clip.id || ids.has(clip.id)) return false;
    if (clip.startMs + clip.durationMs > MAX_VIDEO_WORKFLOW_DURATION_MS) return false;
    ids.add(clip.id);
    clips.push(clip);
    return true;
  };

  for (const clip of input.visualClips) {
    const track = trackByKindAndOrder.get(`video:${clip.trackIndex}`);
    if (!track) return { ok: false, reason: 'track-not-found' };
    const source = sourceById.get(clip.sourceNodeId);
    const externalSourceDurationMs = input.sourceDurationMs(source, clip.sourceNodeId);
    const explicitTimelineDurationMs = clip.durationSeconds === undefined ? undefined : clip.durationSeconds * 1_000;
    const sourceDurationMs = finitePositive(externalSourceDurationMs)
      ? externalSourceDurationMs
      : isSelfContainedVisualClip(clip) && finitePositive(explicitTimelineDurationMs)
        ? Math.max(
            clip.sourceOutMs ?? 0,
            clip.sourceInMs + explicitTimelineDurationMs * Math.max(clip.playbackRate, 1),
          )
        : undefined;
    const range = visualRange(clip, sourceDurationMs);
    if (!range) return { ok: false, reason: 'invalid-source-duration' };
    const durationMs = visualTimelineDuration(clip, range);
    const normalized: VideoWorkflowSourceRecordClip = {
      id: clip.id,
      kind: 'video',
      trackId: track.id,
      startMs: clip.startMs,
      durationMs,
      sourceId: source?.id ?? clip.sourceNodeId,
      sourceInMs: clip.reversePlayback ? range.sourceOutMs : range.sourceInMs,
      sourceDurationMs,
      playbackRate: clip.playbackRate,
      reverse: clip.reversePlayback,
      enabled: true,
      linkGroupId: clip.professional?.linkGroupId,
      adapterOriginalClipId: clip.id,
    };
    if (!validNormalizedClip(normalized) || !append(normalized)) {
      return { ok: false, reason: clip.startMs + durationMs > MAX_VIDEO_WORKFLOW_DURATION_MS
        ? 'feature-length-bound-exceeded' : 'invalid-timeline-clip' };
    }
  }
  for (const clip of input.audioClips) {
    const track = trackByKindAndOrder.get(`audio:${clip.trackIndex}`);
    if (!track) return { ok: false, reason: 'track-not-found' };
    const source = sourceById.get(clip.sourceNodeId);
    const sourceDurationMs = input.sourceDurationMs(source, clip.sourceNodeId);
    if (!finitePositive(sourceDurationMs)) return { ok: false, reason: 'invalid-source-duration' };
    const sourceInMs = Math.max(0, clip.sourceInMs ?? 0);
    const sourceOutMs = Math.min(sourceDurationMs, clip.sourceOutMs ?? sourceDurationMs);
    const normalized: VideoWorkflowSourceRecordClip = {
      id: clip.id,
      kind: 'audio',
      trackId: track.id,
      startMs: clip.offsetMs,
      durationMs: sourceOutMs - sourceInMs,
      sourceId: source?.id ?? clip.sourceNodeId,
      sourceInMs,
      sourceDurationMs,
      playbackRate: 1,
      reverse: false,
      enabled: clip.enabled,
      linkGroupId: clip.professional?.linkGroupId,
      adapterOriginalClipId: clip.id,
    };
    if (!validNormalizedClip(normalized) || !append(normalized)) {
      return { ok: false, reason: clip.offsetMs + normalized.durationMs > MAX_VIDEO_WORKFLOW_DURATION_MS
        ? 'feature-length-bound-exceeded' : 'invalid-timeline-clip' };
    }
  }
  return { ok: true, value: { clips, tracks, trackIndexById } };
}

function normalizeTracks(state: VideoWorkflowTrackState): VideoWorkflowResult<VideoTrackV2[]> {
  const video = state.videoTrackCount;
  const audio = state.audioTrackCount;
  if (!Number.isInteger(video) || video < 0 || !Number.isInteger(audio) || audio < 0
    || video + audio > MAX_VIDEO_WORKFLOW_TRACKS) {
    return { ok: false, reason: 'too-many-tracks' };
  }
  return { ok: true, value: migrateLegacyTracksToV2(state).tracks };
}

function toSourceRecordTrack(track: VideoTrackV2): SourceRecordTrack {
  return {
    id: track.id,
    kind: track.kind,
    order: track.order,
    locked: track.locked,
    syncLocked: track.syncLock,
    recordTarget: track.targetArmed,
    sourceChannel: track.sourcePatch?.enabled ? track.sourcePatch.sourceChannel : undefined,
  };
}

function visualRange(
  clip: EditorVisualClip,
  sourceDurationMs: number | undefined,
): { sourceInMs: number; sourceOutMs: number } | undefined {
  if (!finitePositive(sourceDurationMs) || !finitePositive(clip.playbackRate)) return undefined;
  const sourceInMs = Math.max(0, clip.sourceOutMs === undefined ? clip.trimStartMs : clip.sourceInMs);
  const sourceOutMs = Math.min(sourceDurationMs, clip.sourceOutMs ?? sourceDurationMs - Math.max(0, clip.trimEndMs));
  return sourceOutMs > sourceInMs ? { sourceInMs, sourceOutMs } : undefined;
}

function isSelfContainedVisualClip(clip: Pick<EditorVisualClip, 'sourceKind'>): boolean {
  return clip.sourceKind === 'text' || clip.sourceKind === 'shape' || clip.sourceKind === 'comic';
}

function visualTimelineDuration(
  clip: EditorVisualClip,
  range: { sourceInMs: number; sourceOutMs: number },
): number {
  const explicit = clip.durationSeconds === undefined ? undefined : clip.durationSeconds * 1_000;
  return finitePositive(explicit) ? explicit : (range.sourceOutMs - range.sourceInMs) / clip.playbackRate;
}

function validNormalizedClip(clip: VideoWorkflowSourceRecordClip): boolean {
  if (!clip.id || !clip.trackId || !clip.sourceId || !Number.isFinite(clip.startMs) || clip.startMs < 0
    || !finitePositive(clip.durationMs) || !Number.isFinite(clip.sourceInMs) || clip.sourceInMs < 0
    || !finitePositive(clip.sourceDurationMs) || !finitePositive(clip.playbackRate)) return false;
  const terminal = clip.sourceInMs + clip.durationMs * clip.playbackRate * (clip.reverse ? -1 : 1);
  return clip.sourceInMs <= clip.sourceDurationMs! && terminal >= 0 && terminal <= clip.sourceDurationMs!;
}

function sourceRangeFromNormalized(
  clip: Pick<SourceRecordClip, 'durationMs' | 'sourceInMs' | 'playbackRate' | 'reverse'>,
): { sourceInMs: number; sourceOutMs: number } | undefined {
  const terminal = clip.sourceInMs + clip.durationMs * clip.playbackRate * (clip.reverse ? -1 : 1);
  const sourceInMs = Math.min(clip.sourceInMs, terminal);
  const sourceOutMs = Math.max(clip.sourceInMs, terminal);
  return sourceOutMs > sourceInMs && sourceInMs >= 0 ? { sourceInMs, sourceOutMs } : undefined;
}

function sameSourceRecordDecision(left: SourceRecordClip, right: SourceRecordClip): boolean {
  return left.kind === right.kind
    && left.trackId === right.trackId
    && left.startMs === right.startMs
    && left.durationMs === right.durationMs
    && left.sourceId === right.sourceId
    && left.sourceInMs === right.sourceInMs
    && left.sourceDurationMs === right.sourceDurationMs
    && left.playbackRate === right.playbackRate
    && left.reverse === right.reverse
    && left.enabled === right.enabled
    && left.linkGroupId === right.linkGroupId;
}

function sourceQcDescriptor(
  source: SourceBinItem,
  lookup: VideoWorkflowSourceDurationLookup,
  framesPerSecond: number,
): VideoStructuralQcSourceDescriptor {
  const onlineState = source.professional?.onlineState
    ?? (source.durability === 'unavailable' ? 'offline' : hasUsableSourceLink(source) ? 'online' : 'unverified');
  const durationMs = lookup(source, source.nodeId);
  const color = source.professional?.color;
  const colorSpace = color
    ? [color.primaries, color.transfer, color.matrix, color.range].filter(Boolean).join('/')
    : undefined;
  return {
    id: source.id,
    label: source.label,
    onlineState,
    linkState: hasUsableSourceLink(source) ? 'linked' as const : 'unlinked' as const,
    durationFrames: finitePositive(durationMs) ? msToFrame(durationMs, framesPerSecond) : undefined,
    colorSpace,
    colorTransformState: colorSpace ? 'setup-only' as const : undefined,
  };
}

function indexSourceItems(sources: readonly SourceBinItem[]): Map<string, SourceBinItem> {
  const indexed = new Map<string, SourceBinItem>();
  for (const source of sources) {
    for (const key of [source.id, source.nodeId, source.sourceBinItemId]) {
      if (key && !indexed.has(key)) indexed.set(key, source);
    }
  }
  return indexed;
}

function findTemplate<T>(
  templates: Readonly<Record<string, T>> | undefined,
  sourceId: string,
  source: SourceBinItem | undefined,
): T | undefined {
  return templates?.[sourceId] ?? (source ? templates?.[source.id] ?? templates?.[source.nodeId] : undefined);
}

function hasUsableSourceLink(source: SourceBinItem): boolean {
  if (source.kind === 'text' || source.kind === 'subtitle') return Boolean(source.text);
  return Boolean(source.nativeFilePath || source.scratchFileName || source.assetUrl);
}

function originalMaps(visual: readonly EditorVisualClip[], audio: readonly EditorAudioClip[]) {
  const map = new Map<string, { kind: 'video'; clip: EditorVisualClip } | { kind: 'audio'; clip: EditorAudioClip }>();
  for (const clip of visual) map.set(clip.id, { kind: 'video', clip });
  for (const clip of audio) map.set(clip.id, { kind: 'audio', clip });
  return map;
}

function mergeProfessional<T extends { linkGroupId?: string; trackId?: string }>(
  professional: T | undefined,
  linkGroupId: string | undefined,
  trackId?: string,
): T | undefined {
  if (!professional && !linkGroupId && !trackId) return undefined;
  return { ...professional, linkGroupId, trackId } as T;
}

function cloneVisual(clip: EditorVisualClip): EditorVisualClip {
  return { ...clip, professional: clip.professional ? { ...clip.professional } : undefined };
}

function cloneAudio(clip: EditorAudioClip): EditorAudioClip {
  return { ...clip, professional: clip.professional ? { ...clip.professional } : undefined };
}

function cloneSourceItem(source: SourceBinItem): SourceBinItem {
  return { ...source, professional: source.professional ? { ...source.professional } : undefined };
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function msToFrame(milliseconds: number, framesPerSecond: number): number {
  return Math.round((milliseconds / 1_000) * framesPerSecond);
}
