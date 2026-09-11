import type { EditorAudioClip, EditorVisualClip } from '../types/flow';
import type { SourceBinItem } from './sourceBin';
import { resolveVisualClipSourceRangeMs } from './editorTimelineSourceRange';
import { resolveEditorAudioSourceRangeMs } from './editorAudioSourceRange';

export interface VisualTimelineBlock {
  clip: EditorVisualClip;
  item?: SourceBinItem;
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
}

export interface AudioTimelineBlock {
  clip: EditorAudioClip;
  item?: SourceBinItem;
  startSeconds: number;
  durationSeconds: number;
  endSeconds: number;
}

export function buildVisualTimelineBlocks(
  clips: EditorVisualClip[],
  itemMap: Map<string, SourceBinItem>,
  durationMap: Record<string, number>,
): VisualTimelineBlock[] {
  return clips.map((clip) => {
    const item = itemMap.get(clip.sourceNodeId);
    const durationSeconds = resolveVisualClipDuration(clip, itemMap, durationMap);
    const startSeconds = Math.max(0, clip.startMs) / 1000;

    const block = {
      clip,
      item,
      startSeconds,
      durationSeconds,
      endSeconds: startSeconds + durationSeconds,
    };
    return block;
  });
}

export function buildAudioTimelineBlocks(
  clips: EditorAudioClip[],
  itemMap: Map<string, SourceBinItem>,
  durationMap: Record<string, number>,
): AudioTimelineBlock[] {
  return clips.map((clip) => {
    const item = itemMap.get(clip.sourceNodeId);
    const sourceDurationSeconds = item ? durationMap[item.id] ?? 0 : 0;
    const durationSeconds = resolveEditorAudioSourceRangeMs(clip, sourceDurationSeconds).durationMs / 1_000;
    const startSeconds = clip.offsetMs / 1000;

    return {
      clip,
      item,
      startSeconds,
      durationSeconds,
      endSeconds: startSeconds + durationSeconds,
    };
  });
}

export function resolveVisualClipDuration(
  clip: EditorVisualClip,
  itemMap: Map<string, SourceBinItem>,
  durationMap: Record<string, number>,
): number {
  if (clip.sourceKind === 'image' || clip.sourceKind === 'text' || clip.sourceKind === 'shape' || clip.sourceKind === 'comic') {
    return clip.durationSeconds ?? 4;
  }

  const item = itemMap.get(clip.sourceNodeId);
  const sourceDurationSeconds = item ? durationMap[item.id] ?? 0 : 0;
  const availableMs = resolveVisualClipSourceRangeMs(clip, sourceDurationSeconds).durationMs;

  if (availableMs === 0) {
    return 0;
  }

  const playbackRate = Math.max(0.25, clip.playbackRate || 1);
  return availableMs / 1000 / playbackRate;
}

export function getTimelineDurationSeconds(
  visualBlocks: VisualTimelineBlock[],
  audioBlocks: AudioTimelineBlock[],
): number {
  const visualDuration = Math.max(0, ...visualBlocks.map((block) => block.endSeconds));
  const audioDuration = Math.max(0, ...audioBlocks.map((block) => block.endSeconds));
  return Math.max(visualDuration, audioDuration);
}
