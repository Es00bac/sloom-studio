import type { EditorAudioClip, EditorVisualClip } from '../types/flow';

export type VideoExportReadinessSeverity = 'error' | 'warning' | 'info';
export type VideoExportReadinessTone = 'ready' | VideoExportReadinessSeverity;

export interface VideoExportReadinessIssue {
  severity: VideoExportReadinessSeverity;
  title: string;
  detail: string;
  clipId?: string;
}

export interface VideoExportReadinessSummary {
  tone: VideoExportReadinessTone;
  label: string;
  detail: string;
  issueCount: number;
}

export interface VideoExportReadinessReport {
  issues: VideoExportReadinessIssue[];
  summary: VideoExportReadinessSummary;
}

export function analyzeVideoExportReadiness({
  audioClips,
  availableSourceIds,
  dirtySpanSummary,
  hasComposition,
  managedFontError,
  managedFontState,
  stageObjectCount,
  visualClips,
}: {
  audioClips: EditorAudioClip[];
  availableSourceIds: Iterable<string>;
  dirtySpanSummary?: string;
  hasComposition: boolean;
  managedFontError?: string;
  managedFontState?: { status: 'ready' | 'loading' | 'error'; error?: string };
  stageObjectCount: number;
  visualClips: EditorVisualClip[];
}): VideoExportReadinessReport {
  const availableSources = new Set(availableSourceIds);
  const issues: VideoExportReadinessIssue[] = [];

  if (managedFontState?.status === 'loading') {
    issues.push({
      severity: 'error',
      title: 'Registering bundled font faces',
      detail: 'Referenced managed font faces are still being verified. Preview and export stay blocked until registration succeeds.',
    });
  }

  const resolvedManagedFontError = managedFontState?.status === 'error'
    ? managedFontState.error ?? 'A bundled font face is unavailable.'
    : managedFontError;
  if (resolvedManagedFontError) {
    issues.push({
      severity: 'error',
      title: 'Missing bundled font face',
      detail: `${resolvedManagedFontError} Exact Video typography cannot be previewed or exported until this face is restored.`,
    });
  }

  if (!hasComposition) {
    issues.push({
      severity: 'warning',
      title: 'No active composition',
      detail: 'Create or select a Video composition before rendering.',
    });
  }

  if (hasComposition && visualClips.length + audioClips.length + stageObjectCount === 0) {
    issues.push({
      severity: 'warning',
      title: 'Timeline is empty',
      detail: 'Add visual, audio, or stage-object media before rendering.',
    });
  }

  for (const clip of visualClips) {
    if (!clipNeedsSourceMedia(clip)) continue;
    if (availableSources.has(clip.sourceNodeId)) continue;
    issues.push({
      severity: 'error',
      title: 'Missing visual source',
      detail: `${clip.sourceKind} clip ${clip.id} references ${clip.sourceNodeId}, but that source is not available in the Source Library.`,
      clipId: clip.id,
    });
  }

  for (const clip of audioClips) {
    if (availableSources.has(clip.sourceNodeId)) continue;
    issues.push({
      severity: 'error',
      title: 'Missing audio source',
      detail: `Audio clip ${clip.id} references ${clip.sourceNodeId}, but that source is not available in the Source Library.`,
      clipId: clip.id,
    });
  }

  if (dirtySpanSummary) {
    if (isRenderCacheStatusSummary(dirtySpanSummary)) {
      issues.push({
        severity: 'info',
        title: 'Render cache',
        detail: dirtySpanSummary,
      });
    } else {
      issues.push({
        severity: 'info',
        title: 'Dirty-span analysis only',
        detail: `${dirtySpanSummary} This identifies changed spans only; artifact-aware render-cache reuse requires cached segment artifacts.`,
      });
    }
  }

  return {
    issues,
    summary: summarizeVideoExportReadiness(issues),
  };
}

function clipNeedsSourceMedia(clip: EditorVisualClip): boolean {
  return clip.sourceKind === 'image' || clip.sourceKind === 'video' || clip.sourceKind === 'composition';
}

function summarizeVideoExportReadiness(issues: VideoExportReadinessIssue[]): VideoExportReadinessSummary {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  if (errorCount > 0) {
    const fontError = issues.find((issue) => issue.severity === 'error' && issue.title === 'Missing bundled font face');
    const fontLoading = issues.find((issue) => issue.severity === 'error' && issue.title === 'Registering bundled font faces');
    return {
      tone: 'error',
      label: fontError ? 'Missing font' : fontLoading ? 'Loading fonts' : 'Missing media',
      detail: fontError
        ? fontError.detail
        : fontLoading
          ? fontLoading.detail
        : `${errorCount} missing timeline source${errorCount === 1 ? '' : 's'} must be restored before export is reliable.`,
      issueCount: errorCount,
    };
  }

  const warning = issues.find((issue) => issue.severity === 'warning');
  if (warning) {
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      tone: 'warning',
      label: warning.title,
      detail: warning.detail,
      issueCount: warningCount,
    };
  }

  const info = issues.find((issue) => issue.severity === 'info');
  if (info) {
    const infoCount = issues.filter((issue) => issue.severity === 'info').length;
    return {
      tone: 'info',
      label: info.title === 'Render cache' ? 'Render cache' : 'Analysis only',
      detail: info.detail,
      issueCount: infoCount,
    };
  }

  return {
    tone: 'ready',
    label: 'Ready',
    detail: 'Video export sources are available.',
    issueCount: 0,
  };
}

function isRenderCacheStatusSummary(summary: string): boolean {
  return summary.startsWith('Render cache hit:')
    || summary.startsWith('Render cache invalidated:')
    || summary.startsWith('Render cache unavailable:')
    || summary.startsWith('Initial render plan:')
    || summary.startsWith('Segment artifact reuse:')
    // Legacy saved composition status from before artifact assembly execution was wired.
    || summary.startsWith('Segment reuse plan:');
}
