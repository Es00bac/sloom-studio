/**
 * Bounded structural preflight for professional Video projects.
 *
 * This module examines saved descriptors only. It does not decode media and therefore never
 * claims to detect black/frozen frames, silence, clipping, loudness, gamut violations, corrupt
 * elementary streams, or any other signal-level condition.
 */

export const MAX_VIDEO_QC_SOURCES = 10_000;
export const MAX_VIDEO_QC_TRACKS = 256;
export const MAX_VIDEO_QC_CLIPS = 20_000;
export const MAX_VIDEO_QC_CAPTIONS = 20_000;
export const MAX_VIDEO_QC_FEATURES = 5_000;
export const MAX_VIDEO_QC_ISSUES = 5_000;

export const VIDEO_STRUCTURAL_QC_DISCLAIMER =
  'Structural preflight only: media was not decoded, so this report makes no claims about black or frozen frames, silence, clipping, loudness, gamut, or stream integrity.';

export type VideoStructuralQcSeverity = 'error' | 'warning' | 'info';
export type VideoStructuralQcCategory = 'project' | 'media' | 'timeline' | 'caption' | 'feature' | 'cache' | 'color';
export type VideoStructuralQcIssueCode =
  | 'input-truncated'
  | 'invalid-project-duration'
  | 'offline-source'
  | 'stale-source'
  | 'unverified-source'
  | 'unlinked-source'
  | 'missing-clip-source-id'
  | 'missing-clip-source'
  | 'invalid-clip-range'
  | 'invalid-source-trim'
  | 'source-trim-exceeds-media'
  | 'track-overlap'
  | 'track-gap'
  | 'unsupported-feature'
  | 'setup-only-feature'
  | 'invalid-caption-range'
  | 'empty-caption'
  | 'caption-overlap'
  | 'caption-too-many-lines'
  | 'caption-line-too-long'
  | 'caption-reading-speed'
  | 'stale-render-cache'
  | 'source-color-transform-missing'
  | 'delivery-color-mismatch';

export interface VideoStructuralQcNavigation {
  sourceId?: string;
  clipId?: string;
  captionId?: string;
  trackId?: string;
  frame?: number;
}

export interface VideoStructuralQcIssue {
  id: string;
  code: VideoStructuralQcIssueCode;
  severity: VideoStructuralQcSeverity;
  category: VideoStructuralQcCategory;
  title: string;
  detail: string;
  navigation?: VideoStructuralQcNavigation;
}

export interface VideoStructuralQcSourceDescriptor {
  id: string;
  label?: string;
  onlineState: 'online' | 'offline' | 'stale' | 'unverified';
  linkState?: 'linked' | 'unlinked';
  durationFrames?: number;
  colorSpace?: string;
  colorTransformState?: 'configured' | 'missing' | 'setup-only';
}

export interface VideoStructuralQcClipDescriptor {
  id: string;
  trackId: string;
  kind: 'video' | 'audio' | 'caption' | 'graphic';
  startFrame: number;
  durationFrames: number;
  sourceId?: string;
  requiresSource?: boolean;
  sourceInFrame?: number;
  sourceOutFrame?: number;
  enabled?: boolean;
  unsupportedFeatures?: string[];
  setupOnlyFeatures?: string[];
}

export interface VideoStructuralQcTrackDescriptor {
  id: string;
  kind: 'video' | 'audio' | 'caption' | 'graphic';
  continuity?: 'allow-gaps' | 'continuous';
}

export interface VideoStructuralQcCaptionDescriptor {
  id: string;
  trackId?: string;
  startFrame: number;
  endFrame: number;
  text: string;
}

export interface VideoStructuralQcFeatureDescriptor {
  id: string;
  label: string;
  status: 'available' | 'unsupported' | 'setup-only';
  clipId?: string;
  frame?: number;
}

export interface VideoStructuralQcProjectDescriptor {
  durationFrames: number;
  framesPerSecond: number;
  workingColorSpace?: string;
  deliveryColorSpace?: string;
  deliveryColorTransformState?: 'configured' | 'missing' | 'setup-only';
  compositionSignature?: string;
  renderCacheSignature?: string;
}

export interface VideoStructuralQcCaptionPolicy {
  maxLines: number;
  maxCharactersPerLine: number;
  maxCharactersPerSecond: number;
}

export interface VideoStructuralQcInput {
  project: VideoStructuralQcProjectDescriptor;
  sources?: readonly VideoStructuralQcSourceDescriptor[];
  tracks?: readonly VideoStructuralQcTrackDescriptor[];
  clips?: readonly VideoStructuralQcClipDescriptor[];
  captions?: readonly VideoStructuralQcCaptionDescriptor[];
  features?: readonly VideoStructuralQcFeatureDescriptor[];
  captionPolicy?: Partial<VideoStructuralQcCaptionPolicy>;
}

export interface VideoStructuralQcSummary {
  errors: number;
  warnings: number;
  info: number;
  blocking: boolean;
}

export interface VideoStructuralQcReport {
  scope: 'structural-only';
  disclaimer: string;
  issues: VideoStructuralQcIssue[];
  summary: VideoStructuralQcSummary;
  truncated: boolean;
  inspected: {
    sources: number;
    tracks: number;
    clips: number;
    captions: number;
    features: number;
  };
}

const DEFAULT_CAPTION_POLICY: VideoStructuralQcCaptionPolicy = {
  maxLines: 2,
  maxCharactersPerLine: 42,
  maxCharactersPerSecond: 20,
};

export function analyzeVideoStructuralQc(input: VideoStructuralQcInput): VideoStructuralQcReport {
  const issues: VideoStructuralQcIssue[] = [];
  let issueCounter = 0;
  let truncated = false;

  const addIssue = (issue: Omit<VideoStructuralQcIssue, 'id'>): void => {
    if (issues.length >= MAX_VIDEO_QC_ISSUES) {
      truncated = true;
      return;
    }
    issueCounter += 1;
    issues.push({ ...issue, id: `structural-qc-${String(issueCounter).padStart(5, '0')}` });
  };

  const sources = bounded(input.sources ?? [], MAX_VIDEO_QC_SOURCES, 'sources', addIssue);
  const tracks = bounded(input.tracks ?? [], MAX_VIDEO_QC_TRACKS, 'tracks', addIssue);
  const clips = bounded(input.clips ?? [], MAX_VIDEO_QC_CLIPS, 'clips', addIssue);
  const captions = bounded(input.captions ?? [], MAX_VIDEO_QC_CAPTIONS, 'captions', addIssue);
  const features = bounded(input.features ?? [], MAX_VIDEO_QC_FEATURES, 'features', addIssue);
  truncated = truncated
    || sources.truncated
    || tracks.truncated
    || clips.truncated
    || captions.truncated
    || features.truncated;

  const projectDuration = input.project.durationFrames;
  const framesPerSecond = input.project.framesPerSecond;
  if (!isNonNegativeInteger(projectDuration) || !Number.isFinite(framesPerSecond) || framesPerSecond <= 0 || framesPerSecond > 240) {
    addIssue({
      code: 'invalid-project-duration',
      severity: 'error',
      category: 'project',
      title: 'Invalid sequence timing',
      detail: 'Sequence duration must be a non-negative integer frame count and frame rate must be greater than zero and no more than 240.',
    });
  }

  if (
    normalized(input.project.workingColorSpace)
    && normalized(input.project.deliveryColorSpace)
    && normalized(input.project.workingColorSpace) !== normalized(input.project.deliveryColorSpace)
    && input.project.deliveryColorTransformState !== 'configured'
  ) {
    addIssue({
      code: 'delivery-color-mismatch',
      severity: input.project.deliveryColorTransformState === 'setup-only' ? 'warning' : 'error',
      category: 'color',
      title: 'Delivery color transform is not active',
      detail: `${input.project.workingColorSpace} working color differs from ${input.project.deliveryColorSpace} delivery color without a configured output transform.`,
    });
  }

  if (
    normalized(input.project.compositionSignature)
    && normalized(input.project.renderCacheSignature)
    && input.project.compositionSignature !== input.project.renderCacheSignature
  ) {
    addIssue({
      code: 'stale-render-cache',
      severity: 'warning',
      category: 'cache',
      title: 'Render cache is stale',
      detail: 'The cached composition signature does not match the current immutable composition signature.',
    });
  }

  const sourceById = new Map<string, VideoStructuralQcSourceDescriptor>();
  for (const source of [...sources.items].sort(compareById)) {
    if (!source.id || sourceById.has(source.id)) continue;
    sourceById.set(source.id, source);
    const label = source.label?.trim() || source.id;
    if (source.onlineState === 'offline') {
      addIssue(sourceIssue('offline-source', 'error', 'Offline source', `${label} is offline.`, source.id));
    } else if (source.onlineState === 'stale') {
      addIssue(sourceIssue('stale-source', 'error', 'Stale source', `${label} no longer matches its ingested fingerprint.`, source.id));
    } else if (source.onlineState === 'unverified') {
      addIssue(sourceIssue('unverified-source', 'warning', 'Unverified source', `${label} has not been verified against its ingested fingerprint.`, source.id));
    }
    if (source.linkState === 'unlinked') {
      addIssue(sourceIssue('unlinked-source', 'error', 'Unlinked source', `${label} has no usable media link.`, source.id));
    }
    if (
      normalized(source.colorSpace)
      && normalized(input.project.workingColorSpace)
      && normalized(source.colorSpace) !== normalized(input.project.workingColorSpace)
      && source.colorTransformState !== 'configured'
    ) {
      addIssue({
        code: 'source-color-transform-missing',
        severity: source.colorTransformState === 'setup-only' ? 'warning' : 'error',
        category: 'color',
        title: 'Source color transform is not active',
        detail: `${label} is tagged ${source.colorSpace}, but the ${input.project.workingColorSpace} sequence has no active source transform.`,
        navigation: { sourceId: source.id },
      });
    }
  }

  const orderedClips = [...clips.items].sort(compareClips);
  for (const clip of orderedClips) {
    const navigation = { clipId: clip.id, trackId: clip.trackId, frame: safeNavigationFrame(clip.startFrame) };
    const validRange = isNonNegativeInteger(clip.startFrame) && isPositiveInteger(clip.durationFrames);
    if (!validRange) {
      addIssue({
        code: 'invalid-clip-range',
        severity: 'error',
        category: 'timeline',
        title: 'Invalid clip range',
        detail: `Clip ${clip.id || '(unnamed)'} needs a non-negative integer start and positive integer duration.`,
        navigation,
      });
    }

    const requiresSource = clip.requiresSource ?? (clip.kind === 'video' || clip.kind === 'audio');
    if (requiresSource && !clip.sourceId?.trim()) {
      addIssue({
        code: 'missing-clip-source-id',
        severity: 'error',
        category: 'media',
        title: 'Clip has no source link',
        detail: `Clip ${clip.id || '(unnamed)'} requires media but has no source identifier.`,
        navigation,
      });
    } else if (clip.sourceId && !sourceById.has(clip.sourceId)) {
      addIssue({
        code: 'missing-clip-source',
        severity: 'error',
        category: 'media',
        title: 'Clip source is missing',
        detail: `Clip ${clip.id || '(unnamed)'} refers to source ${clip.sourceId}, which is not present in the project source descriptors.`,
        navigation: { ...navigation, sourceId: clip.sourceId },
      });
    }

    const hasIn = clip.sourceInFrame !== undefined;
    const hasOut = clip.sourceOutFrame !== undefined;
    if (hasIn !== hasOut || (hasIn && hasOut && (
      !isNonNegativeInteger(clip.sourceInFrame)
      || !isPositiveInteger(clip.sourceOutFrame)
      || (clip.sourceOutFrame as number) <= (clip.sourceInFrame as number)
    ))) {
      addIssue({
        code: 'invalid-source-trim',
        severity: 'error',
        category: 'timeline',
        title: 'Invalid source trim',
        detail: `Clip ${clip.id || '(unnamed)'} must have a valid source-in/source-out pair with out after in.`,
        navigation,
      });
    } else if (hasOut && clip.sourceId) {
      const sourceDuration = sourceById.get(clip.sourceId)?.durationFrames;
      if (isNonNegativeInteger(sourceDuration) && (clip.sourceOutFrame as number) > sourceDuration) {
        addIssue({
          code: 'source-trim-exceeds-media',
          severity: 'error',
          category: 'timeline',
          title: 'Source trim exceeds media',
          detail: `Clip ${clip.id || '(unnamed)'} ends at source frame ${clip.sourceOutFrame}, beyond the source duration of ${sourceDuration} frames.`,
          navigation: { ...navigation, sourceId: clip.sourceId },
        });
      }
    }

    for (const label of boundedLabels(clip.unsupportedFeatures)) {
      addIssue(featureIssue('unsupported-feature', 'error', label, navigation));
    }
    for (const label of boundedLabels(clip.setupOnlyFeatures)) {
      addIssue(featureIssue('setup-only-feature', 'warning', label, navigation));
    }
  }

  inspectTrackRanges(orderedClips, tracks.items, projectDuration, addIssue);

  for (const feature of [...features.items].sort(compareById)) {
    if (feature.status === 'available') continue;
    addIssue(featureIssue(
      feature.status === 'unsupported' ? 'unsupported-feature' : 'setup-only-feature',
      feature.status === 'unsupported' ? 'error' : 'warning',
      feature.label || feature.id,
      { clipId: feature.clipId, frame: safeNavigationFrame(feature.frame) },
    ));
  }

  const captionPolicy = normalizeCaptionPolicy(input.captionPolicy);
  inspectCaptions(captions.items, framesPerSecond, captionPolicy, addIssue);

  const summary = summarize(issues);
  return {
    scope: 'structural-only',
    disclaimer: VIDEO_STRUCTURAL_QC_DISCLAIMER,
    issues,
    summary,
    truncated,
    inspected: {
      sources: sources.items.length,
      tracks: tracks.items.length,
      clips: clips.items.length,
      captions: captions.items.length,
      features: features.items.length,
    },
  };
}

function inspectTrackRanges(
  clips: readonly VideoStructuralQcClipDescriptor[],
  tracks: readonly VideoStructuralQcTrackDescriptor[],
  projectDuration: number,
  addIssue: (issue: Omit<VideoStructuralQcIssue, 'id'>) => void,
): void {
  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const grouped = new Map<string, VideoStructuralQcClipDescriptor[]>();
  for (const clip of clips) {
    if (clip.enabled === false || !clip.trackId || !isNonNegativeInteger(clip.startFrame) || !isPositiveInteger(clip.durationFrames)) continue;
    const lane = grouped.get(clip.trackId) ?? [];
    lane.push(clip);
    grouped.set(clip.trackId, lane);
  }

  for (const [trackId, lane] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
    lane.sort(compareClips);
    let cursor = 0;
    for (const clip of lane) {
      if (clip.startFrame < cursor) {
        addIssue({
          code: 'track-overlap',
          severity: 'error',
          category: 'timeline',
          title: 'Clips overlap on one track',
          detail: `Clip ${clip.id} starts at frame ${clip.startFrame} before the prior clip ends at frame ${cursor}.`,
          navigation: { clipId: clip.id, trackId, frame: clip.startFrame },
        });
      } else if (trackById.get(trackId)?.continuity === 'continuous' && clip.startFrame > cursor) {
        addIssue({
          code: 'track-gap',
          severity: 'warning',
          category: 'timeline',
          title: 'Gap on continuous track',
          detail: `Track ${trackId} has a ${clip.startFrame - cursor}-frame gap beginning at frame ${cursor}.`,
          navigation: { trackId, frame: cursor },
        });
      }
      cursor = Math.max(cursor, clip.startFrame + clip.durationFrames);
    }
    if (trackById.get(trackId)?.continuity === 'continuous' && isNonNegativeInteger(projectDuration) && cursor < projectDuration) {
      addIssue({
        code: 'track-gap',
        severity: 'warning',
        category: 'timeline',
        title: 'Gap on continuous track',
        detail: `Track ${trackId} has a ${projectDuration - cursor}-frame trailing gap beginning at frame ${cursor}.`,
        navigation: { trackId, frame: cursor },
      });
    }
  }
}

function inspectCaptions(
  captions: readonly VideoStructuralQcCaptionDescriptor[],
  framesPerSecond: number,
  policy: VideoStructuralQcCaptionPolicy,
  addIssue: (issue: Omit<VideoStructuralQcIssue, 'id'>) => void,
): void {
  const ordered = [...captions].sort((left, right) =>
    (left.trackId ?? '').localeCompare(right.trackId ?? '')
      || numericSort(left.startFrame, right.startFrame)
      || left.id.localeCompare(right.id));
  const lastEndByTrack = new Map<string, number>();

  for (const caption of ordered) {
    const navigation = { captionId: caption.id, trackId: caption.trackId, frame: safeNavigationFrame(caption.startFrame) };
    if (!isNonNegativeInteger(caption.startFrame) || !isPositiveInteger(caption.endFrame) || caption.endFrame <= caption.startFrame) {
      addIssue({
        code: 'invalid-caption-range',
        severity: 'error',
        category: 'caption',
        title: 'Invalid caption range',
        detail: `Caption ${caption.id || '(unnamed)'} must end after its non-negative start frame.`,
        navigation,
      });
      continue;
    }

    const text = caption.text.trim();
    if (!text) {
      addIssue({
        code: 'empty-caption',
        severity: 'error',
        category: 'caption',
        title: 'Empty caption',
        detail: `Caption ${caption.id || '(unnamed)'} has no readable text.`,
        navigation,
      });
    }

    const trackKey = caption.trackId ?? 'default-caption-track';
    const priorEnd = lastEndByTrack.get(trackKey);
    if (priorEnd !== undefined && caption.startFrame < priorEnd) {
      addIssue({
        code: 'caption-overlap',
        severity: 'error',
        category: 'caption',
        title: 'Captions overlap',
        detail: `Caption ${caption.id || '(unnamed)'} starts before the preceding cue ends on ${trackKey}.`,
        navigation,
      });
    }
    lastEndByTrack.set(trackKey, Math.max(priorEnd ?? 0, caption.endFrame));

    const lines = caption.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length > policy.maxLines) {
      addIssue({
        code: 'caption-too-many-lines',
        severity: 'warning',
        category: 'caption',
        title: 'Caption has too many lines',
        detail: `Caption ${caption.id || '(unnamed)'} has ${lines.length} lines; the policy allows ${policy.maxLines}.`,
        navigation,
      });
    }
    const longestLine = Math.max(0, ...lines.map(codePointLength));
    if (longestLine > policy.maxCharactersPerLine) {
      addIssue({
        code: 'caption-line-too-long',
        severity: 'warning',
        category: 'caption',
        title: 'Caption line is too long',
        detail: `Caption ${caption.id || '(unnamed)'} has a ${longestLine}-character line; the policy allows ${policy.maxCharactersPerLine}.`,
        navigation,
      });
    }
    if (text && Number.isFinite(framesPerSecond) && framesPerSecond > 0) {
      const durationSeconds = (caption.endFrame - caption.startFrame) / framesPerSecond;
      const charactersPerSecond = codePointLength(text.replace(/\s/gu, '')) / durationSeconds;
      if (charactersPerSecond > policy.maxCharactersPerSecond) {
        addIssue({
          code: 'caption-reading-speed',
          severity: 'warning',
          category: 'caption',
          title: 'Caption reading speed is high',
          detail: `Caption ${caption.id || '(unnamed)'} is ${charactersPerSecond.toFixed(1)} characters/second; the policy allows ${policy.maxCharactersPerSecond}.`,
          navigation,
        });
      }
    }
  }
}

function sourceIssue(
  code: 'offline-source' | 'stale-source' | 'unverified-source' | 'unlinked-source',
  severity: VideoStructuralQcSeverity,
  title: string,
  detail: string,
  sourceId: string,
): Omit<VideoStructuralQcIssue, 'id'> {
  return { code, severity, category: 'media', title, detail, navigation: { sourceId } };
}

function featureIssue(
  code: 'unsupported-feature' | 'setup-only-feature',
  severity: VideoStructuralQcSeverity,
  label: string,
  navigation: VideoStructuralQcNavigation,
): Omit<VideoStructuralQcIssue, 'id'> {
  return {
    code,
    severity,
    category: 'feature',
    title: code === 'unsupported-feature' ? 'Unsupported feature' : 'Feature setup is not executing',
    detail: code === 'unsupported-feature'
      ? `${label} is not supported by the selected project/runtime path.`
      : `${label} is saved as setup-only and is not connected to execution.`,
    navigation,
  };
}

function bounded<T>(
  values: readonly T[],
  limit: number,
  label: string,
  addIssue: (issue: Omit<VideoStructuralQcIssue, 'id'>) => void,
): { items: readonly T[]; truncated: boolean } {
  if (values.length <= limit) return { items: values, truncated: false };
  addIssue({
    code: 'input-truncated',
    severity: 'error',
    category: 'project',
    title: 'Preflight input exceeded its safety bound',
    detail: `Structural preflight inspected the first ${limit} ${label} of ${values.length}.`,
  });
  return { items: values.slice(0, limit), truncated: true };
}

function normalizeCaptionPolicy(value: Partial<VideoStructuralQcCaptionPolicy> | undefined): VideoStructuralQcCaptionPolicy {
  return {
    maxLines: boundedPolicyInteger(value?.maxLines, DEFAULT_CAPTION_POLICY.maxLines, 1, 8),
    maxCharactersPerLine: boundedPolicyInteger(value?.maxCharactersPerLine, DEFAULT_CAPTION_POLICY.maxCharactersPerLine, 1, 200),
    maxCharactersPerSecond: boundedPolicyInteger(value?.maxCharactersPerSecond, DEFAULT_CAPTION_POLICY.maxCharactersPerSecond, 1, 100),
  };
}

function boundedPolicyInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value as number)) : fallback;
}

function summarize(issues: readonly VideoStructuralQcIssue[]): VideoStructuralQcSummary {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const info = issues.filter((issue) => issue.severity === 'info').length;
  return { errors, warnings, info, blocking: errors > 0 };
}

function boundedLabels(value: readonly string[] | undefined): string[] {
  return [...new Set((value ?? []).map((label) => label.trim()).filter(Boolean))].sort().slice(0, 64);
}

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function safeNavigationFrame(value: number | undefined): number | undefined {
  return isNonNegativeInteger(value) ? value : undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function compareById<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}

function compareClips(left: VideoStructuralQcClipDescriptor, right: VideoStructuralQcClipDescriptor): number {
  return left.trackId.localeCompare(right.trackId)
    || numericSort(left.startFrame, right.startFrame)
    || left.id.localeCompare(right.id);
}

function numericSort(left: number, right: number): number {
  if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
  if (!Number.isFinite(right)) return -1;
  return left - right;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}
