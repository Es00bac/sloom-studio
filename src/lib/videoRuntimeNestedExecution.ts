import type { EditorVisualClip, NodeData } from '../types/flow';
import type { EditorProfessionalVideoState, ProfessionalSequenceReference } from '../types/videoProfessional';
import { getEditorVisualClips } from './manualEditorState';

/**
 * The bounded nested/adjustment execution adapter for the mature Video Runtime IR.
 *
 * Project JSON stays canonical. This adapter is intentionally rebuilt for both the program monitor
 * and the render dispatch path, so a nested or adjustment marker cannot survive as a descriptor
 * that one consumer silently ignores. It carries no URLs, handles, or byte ownership.
 */
export const VIDEO_RUNTIME_IR_SCHEMA = 'sloom.video-runtime-ir' as const;
export const VIDEO_RUNTIME_IR_VERSION = 2 as const;
export const MAX_VIDEO_RUNTIME_NESTED_SEQUENCES = 128;
export const MAX_VIDEO_RUNTIME_NESTING_DEPTH = 8;
export const MAX_VIDEO_RUNTIME_EXPANDED_VISUAL_CLIPS = 2_000;
export const MAX_VIDEO_RUNTIME_SEQUENCE_DURATION_MS = 86_400_000;

export type VideoRuntimeVisualRole = 'media' | 'adjustment';

export interface VideoRuntimeResolvedVisualClip extends EditorVisualClip {
  runtimeRole: VideoRuntimeVisualRole;
  /** The persisted root/reference clip that owns this resolved record for diagnostics. */
  runtimeOriginClipId: string;
  /** Stable sequence ancestry, used only for diagnostics and deterministic ordering. */
  runtimePath: string[];
}

export interface VideoRuntimeAdjustmentLayer {
  clipId: string;
  originClipId: string;
  trackIndex: number;
  startMs: number;
  endMs: number;
  runtimePath: string[];
}

export interface VideoRuntimeIr {
  schema: typeof VIDEO_RUNTIME_IR_SCHEMA;
  version: typeof VIDEO_RUNTIME_IR_VERSION;
  visualClips: VideoRuntimeResolvedVisualClip[];
  adjustmentLayers: VideoRuntimeAdjustmentLayer[];
  referencedSequenceIds: string[];
}

export type VideoRuntimeCompileResult =
  | { ok: true; ir: VideoRuntimeIr; warnings: string[] }
  | { ok: false; errors: string[] };

export interface CompileVideoRuntimeIrInput {
  visualClips: readonly EditorVisualClip[];
  professionalState?: EditorProfessionalVideoState;
  signal?: AbortSignal;
}

interface SequenceDefinition {
  id: string;
  durationMs: number;
  visualClips: EditorVisualClip[];
}

/**
 * Expands persisted nested-sequence definitions and retains adjustment clips as real compositing
 * passes. Consumers must use this result; failing validation returns no executable plan rather
 * than falling back to raw marked clips.
 */
export function compileVideoRuntimeIr(input: CompileVideoRuntimeIrInput): VideoRuntimeCompileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const definitions = buildSequenceDefinitions(input.professionalState?.sequences ?? [], errors);
  const resolved: VideoRuntimeResolvedVisualClip[] = [];
  const referenced = new Set<string>();
  let expansionCount = 0;
  let expansionBudgetRefused = false;

  const append = (clip: VideoRuntimeResolvedVisualClip) => {
    if (resolved.length >= MAX_VIDEO_RUNTIME_EXPANDED_VISUAL_CLIPS) {
      expansionBudgetRefused = true;
      errors.push(`Nested sequence expansion exceeds ${MAX_VIDEO_RUNTIME_EXPANDED_VISUAL_CLIPS.toLocaleString()} expanded clips.`);
      return false;
    }
    resolved.push(clip);
    return true;
  };

  const expand = (
    clip: EditorVisualClip,
    originClipId: string,
    path: string[],
    sequenceStack: string[],
  ): void => {
    if (input.signal?.aborted) {
      errors.push('Nested/adjustment runtime compilation was cancelled before any render plan was produced.');
      return;
    }
    if (expansionBudgetRefused || expansionCount >= MAX_VIDEO_RUNTIME_EXPANDED_VISUAL_CLIPS) {
      expansionBudgetRefused = true;
      if (!errors.some((error) => error.includes('expanded clips'))) {
        errors.push(`Nested sequence expansion exceeds ${MAX_VIDEO_RUNTIME_EXPANDED_VISUAL_CLIPS.toLocaleString()} expanded clips.`);
      }
      return;
    }
    expansionCount += 1;

    const nestedSequenceId = clip.professional?.nestedSequenceId;
    const isAdjustment = clip.professional?.adjustmentLayer === true
      || input.professionalState?.adjustmentLayerClipIds?.includes(clip.id) === true;

    if (nestedSequenceId && isAdjustment) {
      errors.push(`Clip '${clip.id}' cannot be both a nested sequence reference and an adjustment layer.`);
      return;
    }

    if (!nestedSequenceId) {
      append({
        ...cloneVisualClip(clip),
        runtimeRole: isAdjustment ? 'adjustment' : 'media',
        runtimeOriginClipId: originClipId,
        runtimePath: [...path],
      });
      return;
    }

    referenced.add(nestedSequenceId);
    if (sequenceStack.includes(nestedSequenceId)) {
      errors.push(`Nested sequence cycle refused: ${[...sequenceStack, nestedSequenceId].join(' → ')}.`);
      return;
    }
    if (sequenceStack.length >= MAX_VIDEO_RUNTIME_NESTING_DEPTH) {
      errors.push(`Nested sequence depth exceeds ${MAX_VIDEO_RUNTIME_NESTING_DEPTH}; render was refused before allocation.`);
      return;
    }

    const definition = definitions.get(nestedSequenceId);
    if (!definition) {
      errors.push(`Nested sequence '${nestedSequenceId}' is missing; monitor and export were both refused.`);
      return;
    }
    if (definition.visualClips.length === 0) {
      errors.push(`Nested sequence '${nestedSequenceId}' has no retained child timeline; a descriptor alone cannot render.`);
      return;
    }

    const outerDurationMs = resolveClipDurationMs(clip);
    const sourceWindowStartMs = Math.max(0, Math.round(clip.sourceInMs));
    const sourceWindowEndMs = Math.min(
      definition.durationMs,
      sourceWindowStartMs + outerDurationMs,
    );
    if (sourceWindowEndMs <= sourceWindowStartMs) {
      errors.push(`Nested sequence '${nestedSequenceId}' has an empty source window.`);
      return;
    }

    const firstTrack = Math.min(...definition.visualClips.map((child) => child.trackIndex));
    for (const child of definition.visualClips) {
      if (input.signal?.aborted) {
        errors.push('Nested/adjustment runtime compilation was cancelled before any render plan was produced.');
        return;
      }
      const childDurationMs = resolveClipDurationMs(child);
      const childStartMs = Math.max(0, Math.round(child.startMs));
      const childEndMs = childStartMs + childDurationMs;
      const retainedStartMs = Math.max(childStartMs, sourceWindowStartMs);
      const retainedEndMs = Math.min(childEndMs, sourceWindowEndMs);
      if (retainedEndMs <= retainedStartMs) continue;

      const clippedStartMs = retainedStartMs - childStartMs;
      const childRate = Math.max(0.01, child.playbackRate || 1);
      const projected = cloneVisualClip(child);
      projected.id = `${clip.id}::${child.id}`;
      projected.startMs = Math.round(clip.startMs + retainedStartMs - sourceWindowStartMs);
      projected.durationSeconds = (retainedEndMs - retainedStartMs) / 1_000;
      projected.sourceInMs = Math.max(0, Math.round(child.sourceInMs + clippedStartMs * childRate));
      if (projected.sourceKind === 'video') {
        projected.sourceOutMs = projected.sourceInMs
          + Math.max(1, Math.round((retainedEndMs - retainedStartMs) * childRate));
      } else if (projected.sourceOutMs !== undefined) {
        projected.sourceOutMs = Math.max(projected.sourceInMs + 1, projected.sourceOutMs);
      }
      projected.trackIndex = Math.max(0, clip.trackIndex + child.trackIndex - firstTrack);

      expand(
        projected,
        originClipId,
        [...path, nestedSequenceId],
        [...sequenceStack, nestedSequenceId],
      );
      if (expansionBudgetRefused) return;
    }
  };

  for (const clip of input.visualClips) {
    expand(clip, clip.id, [], []);
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };

  const visualClips = resolved.sort(compareResolvedVisualClips);
  const adjustmentLayers = visualClips
    .filter((clip) => clip.runtimeRole === 'adjustment')
    .map((clip) => ({
      clipId: clip.id,
      originClipId: clip.runtimeOriginClipId,
      trackIndex: clip.trackIndex,
      startMs: clip.startMs,
      endMs: clip.startMs + resolveClipDurationMs(clip),
      runtimePath: [...clip.runtimePath],
    }))
    .sort((left, right) => left.trackIndex - right.trackIndex || left.startMs - right.startMs || left.clipId.localeCompare(right.clipId));

  // The monitor has a CSS stacking plane for an adjustment pass, but FFmpeg only has the
  // timeline track order. A same-track source would make that record's ownership ambiguous,
  // so refuse it rather than claiming preview/export parity. The mounted action always creates
  // a dedicated higher lane.
  const sameTrackAdjustment = adjustmentLayers.find((adjustment) => visualClips.some((clip) => (
    clip.runtimeRole === 'media' && clip.trackIndex === adjustment.trackIndex
  )));
  if (sameTrackAdjustment) {
    return {
      ok: false,
      errors: [`Adjustment layer '${sameTrackAdjustment.clipId}' shares a track with source media. Move it to a dedicated higher track before monitor/export.`],
    };
  }

  if (adjustmentLayers.some((layer) => layer.endMs > MAX_VIDEO_RUNTIME_SEQUENCE_DURATION_MS)) {
    return { ok: false, errors: [`Nested/adjustment runtime exceeds the ${Math.round(MAX_VIDEO_RUNTIME_SEQUENCE_DURATION_MS / 3_600_000)} hour duration bound.`] };
  }
  if (adjustmentLayers.length > 0) {
    warnings.push('Adjustment clips render only their enabled filter stack over lower tracks; their own source pixels are suppressed.');
  }

  return {
    ok: true,
    ir: {
      schema: VIDEO_RUNTIME_IR_SCHEMA,
      version: VIDEO_RUNTIME_IR_VERSION,
      visualClips,
      adjustmentLayers,
      referencedSequenceIds: [...referenced].sort(),
    },
    warnings,
  };
}

function buildSequenceDefinitions(
  sequences: readonly ProfessionalSequenceReference[],
  errors: string[],
): Map<string, SequenceDefinition> {
  const definitions = new Map<string, SequenceDefinition>();
  if (sequences.length > MAX_VIDEO_RUNTIME_NESTED_SEQUENCES) {
    errors.push(`Nested sequence runtime supports at most ${MAX_VIDEO_RUNTIME_NESTED_SEQUENCES} retained sequences.`);
  }

  for (const sequence of sequences.slice(0, MAX_VIDEO_RUNTIME_NESTED_SEQUENCES)) {
    if (!sequence.id || sequence.id.length > 128) {
      errors.push('Nested sequence ids must be non-empty and no longer than 128 characters.');
      continue;
    }
    if (definitions.has(sequence.id)) {
      errors.push(`Nested sequence id '${sequence.id}' is duplicated.`);
      continue;
    }
    const durationMs = Math.round(sequence.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_VIDEO_RUNTIME_SEQUENCE_DURATION_MS) {
      errors.push(`Nested sequence '${sequence.id}' has an invalid bounded duration.`);
      continue;
    }
    const visualClips = normalizePersistedSequenceClips(sequence.visualClips);
    definitions.set(sequence.id, { id: sequence.id, durationMs, visualClips });
  }
  return definitions;
}

function normalizePersistedSequenceClips(value: unknown): EditorVisualClip[] {
  return getEditorVisualClips({ editorVisualClips: value } as NodeData).slice(0, MAX_VIDEO_RUNTIME_EXPANDED_VISUAL_CLIPS);
}

function cloneVisualClip(clip: EditorVisualClip): EditorVisualClip {
  return JSON.parse(JSON.stringify(clip)) as EditorVisualClip;
}

export function resolveVideoRuntimeClipDurationMs(clip: Pick<EditorVisualClip, 'durationSeconds' | 'sourceInMs' | 'sourceOutMs'> & {
  sourceKind?: EditorVisualClip['sourceKind'];
  playbackRate?: number;
}): number {
  const explicitDurationMs = Number.isFinite(clip.durationSeconds) && (clip.durationSeconds ?? 0) > 0
    ? Math.round((clip.durationSeconds as number) * 1_000)
    : undefined;
  const rangeDurationMs = Number.isFinite(clip.sourceOutMs) && (clip.sourceOutMs ?? 0) > clip.sourceInMs
    ? Math.round((clip.sourceOutMs as number) - clip.sourceInMs)
    : undefined;
  // Video/composition edge trims retain the legacy duration field for compatibility while
  // changing the source window. The source range is therefore authoritative whenever it is
  // present, and must be converted back into timeline time at the clip playback rate.
  if ((clip.sourceKind === 'video' || clip.sourceKind === 'composition') && rangeDurationMs !== undefined) {
    return Math.min(
      MAX_VIDEO_RUNTIME_SEQUENCE_DURATION_MS,
      Math.max(1, Math.round(rangeDurationMs / Math.max(0.25, clip.playbackRate || 1))),
    );
  }
  return Math.min(MAX_VIDEO_RUNTIME_SEQUENCE_DURATION_MS, Math.max(1, explicitDurationMs ?? rangeDurationMs ?? 4_000));
}

function resolveClipDurationMs(clip: Pick<EditorVisualClip, 'durationSeconds' | 'sourceInMs' | 'sourceOutMs'>): number {
  return resolveVideoRuntimeClipDurationMs(clip);
}

function compareResolvedVisualClips(left: VideoRuntimeResolvedVisualClip, right: VideoRuntimeResolvedVisualClip): number {
  return left.trackIndex - right.trackIndex
    || left.startMs - right.startMs
    || (left.runtimeRole === 'adjustment' ? 1 : 0) - (right.runtimeRole === 'adjustment' ? 1 : 0)
    || left.id.localeCompare(right.id);
}
