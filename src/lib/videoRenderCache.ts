import type { VideoRenderDirtyPlan, VideoRenderSegment } from './videoRenderSegments';
import { sha256Hex } from '../shared/crypto/sha256';

export interface VideoCompositionRenderCacheSignatureInput {
  aspectRatio?: unknown;
  videoResolution?: unknown;
  frameRate?: unknown;
  timelineDurationSeconds?: unknown;
  exportPresetPlan?: {
    presetId?: unknown;
    notes?: unknown;
  };
  visualClips?: readonly unknown[];
  audioClips?: readonly unknown[];
  /** Render-relevant persisted audio-track mixer authority. */
  editorMutedAudioTracks?: readonly unknown[];
  editorSoloAudioTracks?: readonly unknown[];
  editorAudioTrackVolumes?: readonly unknown[];
  /** Render-relevant Source Library identities and current authorized locations. */
  sourceMedia?: readonly unknown[];
  stageObjects?: readonly unknown[];
  professionalState?: unknown;
  professionalWorkflowState?: unknown;
}

export type VideoRenderCacheAction =
  | {
      kind: 'reuse-cache';
      summary: string;
    }
  | {
      kind: 'render';
      summary: string | undefined;
    };

export interface VideoRenderCachedSegmentArtifact {
  key: string;
  signature: string;
  url: string;
  startMs: number;
  endMs: number;
  updatedAt?: string;
}

export interface VideoRenderSegmentReusePlanItem {
  key: string;
  startMs: number;
  endMs: number;
  activeClipIds: string[];
  signature: string;
  action: 'reuse' | 'render';
  cachedUrl?: string;
  reason?: string;
}

export interface VideoRenderSegmentReusePlan {
  items: VideoRenderSegmentReusePlanItem[];
  reusedSegments: number;
  renderSegments: number;
  reusableDurationMs: number;
  renderDurationMs: number;
  summary: string | undefined;
}

export interface VideoRenderAssemblyManifestSegment {
  key: string;
  startMs: number;
  endMs: number;
  activeClipIds: string[];
  signature: string;
  action: 'reuse-cached-segment' | 'render-dirty-span';
  cachedUrl?: string;
  reason?: string;
}

export interface VideoRenderAssemblyManifest {
  version: 1;
  kind: 'video-render-segment-assembly';
  mode: 'safe-artifact-assembly' | 'planning-only';
  summary?: string;
  segments: VideoRenderAssemblyManifestSegment[];
  caveat?: string;
}

export const VIDEO_RENDER_ASSEMBLY_CAVEAT =
  'Native artifact assembly can reuse materialized cached spans; dirty spans are still extracted from a full render until dirty-span-only rendering lands.';

export interface VideoRenderAssemblyResult {
  assembledFromSegments: boolean;
  assemblyUnavailableReason?: string;
}

export function normalizeVideoRenderCacheSegmentSignatures(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export function normalizeVideoRenderCacheSegmentArtifacts(
  value: unknown,
): Record<string, VideoRenderCachedSegmentArtifact> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([entryKey, entryValue]) => {
      if (!isRecord(entryValue)) {
        return [];
      }

      const key = typeof entryValue.key === 'string' && entryValue.key.length > 0
        ? entryValue.key
        : entryKey;
      const signature = typeof entryValue.signature === 'string' ? entryValue.signature : undefined;
      const url = typeof entryValue.url === 'string' ? entryValue.url : undefined;
      const startMs = optionalFiniteNumber(entryValue.startMs);
      const endMs = optionalFiniteNumber(entryValue.endMs);

      if (!key || !signature || !url || startMs === undefined || endMs === undefined || endMs <= startMs) {
        return [];
      }

      const artifact: VideoRenderCachedSegmentArtifact = {
        key,
        signature,
        url,
        startMs,
        endMs,
      };

      if (typeof entryValue.updatedAt === 'string') {
        artifact.updatedAt = entryValue.updatedAt;
      }

      return [[key, artifact]];
    }),
  );
}

export function buildVideoRenderCachedSegmentArtifactsFromNativePayload({
  segmentArtifacts,
  updatedAt,
}: {
  segmentArtifacts: unknown;
  updatedAt?: string;
}): Record<string, VideoRenderCachedSegmentArtifact> {
  if (!Array.isArray(segmentArtifacts)) {
    return {};
  }

  return Object.fromEntries(
    segmentArtifacts.flatMap((entryValue) => {
      if (!isRecord(entryValue)) {
        return [];
      }

      const key = typeof entryValue.key === 'string' && entryValue.key.length > 0
        ? entryValue.key
        : undefined;
      const signature = typeof entryValue.signature === 'string' && entryValue.signature.length > 0
        ? entryValue.signature
        : undefined;
      const startMs = optionalFiniteNumber(entryValue.startMs);
      const endMs = optionalFiniteNumber(entryValue.endMs);
      const base64 = typeof entryValue.base64 === 'string' && entryValue.base64.length > 0
        ? entryValue.base64
        : undefined;
      const mimeType = typeof entryValue.mimeType === 'string' && entryValue.mimeType.length > 0
        ? entryValue.mimeType
        : 'video/mp4';

      if (!key || !signature || startMs === undefined || endMs === undefined || endMs <= startMs || !base64) {
        return [];
      }

      const artifact: VideoRenderCachedSegmentArtifact = {
        key,
        signature,
        startMs,
        endMs,
        url: `data:${mimeType};base64,${base64}`,
      };

      if (updatedAt) {
        artifact.updatedAt = updatedAt;
      }

      return [[key, artifact]];
    }),
  );
}

export function buildVideoCompositionRenderCacheSignature(
  input: VideoCompositionRenderCacheSignatureInput,
): string {
  const serialized = stableStringify({
    aspectRatio: input.aspectRatio,
    videoResolution: input.videoResolution,
    frameRate: optionalFiniteNumber(input.frameRate),
    timelineDurationSeconds: optionalFiniteNumber(input.timelineDurationSeconds),
    exportPresetPlan: {
      presetId: input.exportPresetPlan?.presetId,
      notes: input.exportPresetPlan?.notes,
    },
    visualClips: input.visualClips,
    sourceMedia: input.sourceMedia,
    editorMutedAudioTracks: input.editorMutedAudioTracks,
    editorSoloAudioTracks: input.editorSoloAudioTracks,
    editorAudioTrackVolumes: input.editorAudioTrackVolumes,
    audioClips: (input.audioClips ?? []).map((value) => {
      const clip = isRecord(value) ? value : {};
      return {
        id: clip.id,
        sourceNodeId: clip.sourceNodeId,
        sourceKind: clip.sourceKind,
        trackIndex: optionalFiniteNumber(clip.trackIndex),
        startMs: optionalFiniteNumber(clip.startMs),
        durationSeconds: optionalFiniteNumber(clip.durationSeconds),
        offsetMs: optionalFiniteNumber(clip.offsetMs),
        sourceInMs: optionalFiniteNumber(clip.sourceInMs),
        sourceOutMs: optionalFiniteNumber(clip.sourceOutMs),
        trackVolumePercent: optionalFiniteNumber(clip.trackVolumePercent),
        volumePercent: optionalFiniteNumber(clip.volumePercent),
        volumeAutomationPoints: clip.volumeAutomationPoints,
        volumeKeyframes: clip.volumeKeyframes,
        measuredMatchGainDb: optionalFiniteNumber(clip.measuredMatchGainDb),
        loudnessReferenceClipId: clip.loudnessReferenceClipId,
        loudnessReferenceSourceNodeId: clip.loudnessReferenceSourceNodeId,
        loudnessReferenceSourceInMs: optionalFiniteNumber(clip.loudnessReferenceSourceInMs),
        loudnessReferenceSourceOutMs: optionalFiniteNumber(clip.loudnessReferenceSourceOutMs),
        speechLevelMatchMeasurement: clip.speechLevelMatchMeasurement,
        audioProcessing: clip.audioProcessing,
        audioDucking: clip.audioDucking,
        fadeInSeconds: optionalFiniteNumber(clip.fadeInSeconds),
        fadeOutSeconds: optionalFiniteNumber(clip.fadeOutSeconds),
        enabled: clip.enabled,
        professional: clip.professional,
      };
    }),
    stageObjects: (input.stageObjects ?? []).map((value, index) => {
      const object = isRecord(value) ? value : {};
      return {
        index,
        id: object.id,
        kind: object.kind,
        x: optionalFiniteNumber(object.x),
        y: optionalFiniteNumber(object.y),
        width: optionalFiniteNumber(object.width),
        height: optionalFiniteNumber(object.height),
        rotationDeg: optionalFiniteNumber(object.rotationDeg),
        opacityPercent: optionalFiniteNumber(object.opacityPercent),
        blendMode: object.blendMode,
        text: object.text,
        fontFamily: object.fontFamily,
        fontWeight: optionalFiniteNumber(object.fontWeight),
        fontStyle: object.fontStyle,
        managedFace: object.managedFace,
        fontSizePx: optionalFiniteNumber(object.fontSizePx),
        color: object.color,
        fillColor: object.fillColor,
        borderColor: object.borderColor,
        borderWidth: optionalFiniteNumber(object.borderWidth),
        cornerRadius: optionalFiniteNumber(object.cornerRadius),
      };
    }),
    professionalState: input.professionalState,
    professionalWorkflowState: pickProfessionalWorkflowRenderState(input.professionalWorkflowState),
  });
  return `video-composition-v2:${sha256Hex(new TextEncoder().encode(serialized))}`;
}

/** Review notes, smart-bin queries, and delivery job status do not change rendered pixels or audio. */
function pickProfessionalWorkflowRenderState(value: unknown): unknown {
  if (!isRecord(value)) return undefined;
  return {
    timebase: value.timebase,
    captionTracks: value.captionTracks,
  };
}

export function buildVideoRenderSegmentReusePlan({
  dirtyPlan,
  cachedArtifacts,
}: {
  dirtyPlan: VideoRenderDirtyPlan;
  cachedArtifacts: Record<string, VideoRenderCachedSegmentArtifact>;
}): VideoRenderSegmentReusePlan {
  const items = dirtyPlan.segments.map((segment) => {
    const artifact = cachedArtifacts[segment.key];

    if (segment.dirty) {
      return buildRenderPlanItem(segment, 'timeline span changed');
    }

    if (!artifact?.url) {
      return buildRenderPlanItem(segment, 'missing cached segment artifact');
    }

    if (artifact.signature !== segment.signature) {
      return buildRenderPlanItem(segment, 'cached segment signature mismatch');
    }

    if (artifact.startMs !== segment.startMs || artifact.endMs !== segment.endMs) {
      return buildRenderPlanItem(segment, 'cached segment time range mismatch');
    }

    return {
      key: segment.key,
      startMs: segment.startMs,
      endMs: segment.endMs,
      activeClipIds: segment.activeClipIds,
      signature: segment.signature,
      action: 'reuse',
      cachedUrl: artifact.url,
    } satisfies VideoRenderSegmentReusePlanItem;
  });
  const reusedSegments = items.filter((item) => item.action === 'reuse').length;
  const renderSegments = items.length - reusedSegments;
  const reusableDurationMs = items.reduce(
    (total, item) => total + (item.action === 'reuse' ? item.endMs - item.startMs : 0),
    0,
  );
  const renderDurationMs = items.reduce(
    (total, item) => total + (item.action === 'render' ? item.endMs - item.startMs : 0),
    0,
  );

  return {
    items,
    reusedSegments,
    renderSegments,
    reusableDurationMs,
    renderDurationMs,
    summary: items.length === 0
      ? undefined
      : `Segment artifact reuse: ${reusedSegments} reusable cached span${reusedSegments === 1 ? '' : 's'}, ${renderSegments} queued dirty span${renderSegments === 1 ? '' : 's'}.`,
  };
}

export function buildVideoRenderAssemblyManifest(
  reusePlan: VideoRenderSegmentReusePlan,
): VideoRenderAssemblyManifest {
  return {
    version: 1,
    kind: 'video-render-segment-assembly',
    mode: 'safe-artifact-assembly',
    summary: reusePlan.summary ?? 'Segment artifact reuse: no timeline spans.',
    segments: reusePlan.items.map((item) => ({
      key: item.key,
      startMs: item.startMs,
      endMs: item.endMs,
      activeClipIds: item.activeClipIds,
      signature: item.signature,
      action: item.action === 'reuse' ? 'reuse-cached-segment' : 'render-dirty-span',
      ...(item.cachedUrl ? { cachedUrl: item.cachedUrl } : {}),
      ...(item.reason ? { reason: item.reason } : {}),
    })),
    caveat: VIDEO_RENDER_ASSEMBLY_CAVEAT,
  };
}

export function formatVideoRenderAssemblyManifestDetails(
  manifest: VideoRenderAssemblyManifest | undefined,
): string[] {
  if (!manifest?.segments.length) {
    return [];
  }

  return manifest.segments.map((segment) => {
    const timeRange = `${formatRenderCacheSeconds(segment.startMs)}s-${formatRenderCacheSeconds(segment.endMs)}s`;
    const clipCount = segment.activeClipIds.length;
    const clipLabel = `${clipCount} clip${clipCount === 1 ? '' : 's'}`;

    if (segment.action === 'reuse-cached-segment') {
      return `Reuse ${timeRange} from cached segment (${clipLabel}).`;
    }

    return `Extract ${timeRange} from the new full render because ${segment.reason || 'timeline span changed'} (${clipLabel}).`;
  });
}

export function normalizeVideoRenderAssemblyResult(value: unknown): VideoRenderAssemblyResult | undefined {
  if (!isRecord(value) || typeof value.assembledFromSegments !== 'boolean') {
    return undefined;
  }

  const reason = typeof value.assemblyUnavailableReason === 'string'
    ? value.assemblyUnavailableReason.trim()
    : '';

  return {
    assembledFromSegments: value.assembledFromSegments,
    ...(reason ? { assemblyUnavailableReason: reason } : {}),
  };
}

export function formatVideoRenderAssemblyResultDetail(value: unknown): string | undefined {
  const result = normalizeVideoRenderAssemblyResult(value);

  if (!result) {
    return undefined;
  }

  if (result.assembledFromSegments) {
    return 'Native segment assembly: assembled final output from reusable cached spans and newly rendered dirty-span artifacts.';
  }

  return result.assemblyUnavailableReason
    ? `Native segment assembly fallback: used the full rendered output because ${result.assemblyUnavailableReason}`
    : 'Native segment assembly fallback: used the full rendered output because native segment assembly was unavailable.';
}

export function retainReusableVideoRenderSegmentArtifacts({
  reusePlan,
  cachedArtifacts,
}: {
  reusePlan: VideoRenderSegmentReusePlan | undefined;
  cachedArtifacts: Record<string, VideoRenderCachedSegmentArtifact>;
}): Record<string, VideoRenderCachedSegmentArtifact> {
  if (!reusePlan) {
    return {};
  }

  return Object.fromEntries(
    reusePlan.items.flatMap((item) => {
      if (item.action !== 'reuse') {
        return [];
      }

      const artifact = cachedArtifacts[item.key];

      if (
        !artifact
        || artifact.signature !== item.signature
        || artifact.startMs !== item.startMs
        || artifact.endMs !== item.endMs
      ) {
        return [];
      }

      return [[item.key, artifact]];
    }),
  );
}

export function buildVideoRenderSegmentArtifactsForCompletedRender({
  reusePlan,
  cachedArtifacts,
  segmentArtifacts,
  updatedAt,
}: {
  reusePlan: VideoRenderSegmentReusePlan | undefined;
  cachedArtifacts: Record<string, VideoRenderCachedSegmentArtifact>;
  segmentArtifacts: unknown;
  updatedAt?: string;
}): Record<string, VideoRenderCachedSegmentArtifact> {
  return {
    ...retainReusableVideoRenderSegmentArtifacts({ reusePlan, cachedArtifacts }),
    ...buildVideoRenderCachedSegmentArtifactsFromNativePayload({ segmentArtifacts, updatedAt }),
  };
}

export function resolveVideoRenderCacheAction({
  dirtyPlan,
  cachedResultUrl,
  cacheInvalidationReason,
}: {
  dirtyPlan: VideoRenderDirtyPlan;
  cachedResultUrl?: string;
  cacheInvalidationReason?: string;
}): VideoRenderCacheAction {
  if (dirtyPlan.segments.length === 0) {
    return {
      kind: 'render',
      summary: undefined,
    };
  }

  if (dirtyPlan.dirtySegments.length === 0) {
    if (cachedResultUrl) {
      return {
        kind: 'reuse-cache',
        summary: 'Render cache hit: no timeline spans changed; reused the previous rendered preview.',
      };
    }

    return {
      kind: 'render',
      summary: `Render cache unavailable: previous preview missing; ${formatSpanCount(dirtyPlan.segments.length)} queued.`,
    };
  }

  if (cachedResultUrl && cacheInvalidationReason) {
    return {
      kind: 'render',
      summary: `Render cache invalidated: ${cacheInvalidationReason}; ${formatSpanCount(dirtyPlan.dirtySegments.length)} queued.`,
    };
  }

  if (dirtyPlan.dirtySegments.length === dirtyPlan.segments.length) {
    return {
      kind: 'render',
      summary: `Initial render plan: ${formatSpanCount(dirtyPlan.dirtySegments.length)} queued.`,
    };
  }

  return {
    kind: 'render',
    summary: `Incremental render plan: ${dirtyPlan.dirtySegments.length}/${dirtyPlan.segments.length} timeline span${dirtyPlan.segments.length === 1 ? '' : 's'} changed.`,
  };
}

function formatRenderCacheSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

function formatSpanCount(count: number): string {
  return `${count} timeline span${count === 1 ? '' : 's'}`;
}

function buildRenderPlanItem(
  segment: VideoRenderSegment,
  reason: string,
): VideoRenderSegmentReusePlanItem {
  return {
    key: segment.key,
    startMs: segment.startMs,
    endMs: segment.endMs,
    activeClipIds: segment.activeClipIds,
    signature: segment.signature,
    action: 'render',
    reason,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
