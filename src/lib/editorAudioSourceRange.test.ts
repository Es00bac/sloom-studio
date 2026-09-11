import { describe, expect, it } from 'vitest';
import type { EditorAudioClip } from '../types/flow';
import {
  resolveEditorAudioSourceRangeMs,
  splitEditorAudioClipAtTimelineSeconds,
  trimEditorAudioClipEdge,
} from './editorAudioSourceRange';

const clip: EditorAudioClip = {
  id: 'audio-1',
  sourceNodeId: 'source-1',
  offsetMs: 2_000,
  trackIndex: 0,
  volumePercent: 100,
  volumeAutomationPoints: [
    { timePercent: 0, valuePercent: 100 },
    { timePercent: 50, valuePercent: 50 },
    { timePercent: 100, valuePercent: 100 },
  ],
  fadeInSeconds: 1,
  fadeOutSeconds: 1,
  enabled: true,
};

describe('editor audio source ranges', () => {
  it('normalizes saved source windows against the actual media duration', () => {
    expect(resolveEditorAudioSourceRangeMs({ sourceInMs: 1_000, sourceOutMs: 7_000 }, 10)).toEqual({
      sourceInMs: 1_000,
      sourceOutMs: 7_000,
      durationMs: 6_000,
    });
    expect(resolveEditorAudioSourceRangeMs({ sourceInMs: -10, sourceOutMs: 50_000 }, 4)).toEqual({
      sourceInMs: 0,
      sourceOutMs: 4_000,
      durationMs: 4_000,
    });
  });

  it('trims and extends source edges without moving the opposite timeline edge', () => {
    const trimmedStart = trimEditorAudioClipEdge(clip, 'start', 1.5, 10);
    expect(trimmedStart).toMatchObject({ offsetMs: 3_500, sourceInMs: 1_500, sourceOutMs: 10_000 });

    const restoredStart = trimEditorAudioClipEdge(trimmedStart, 'start', -1.5, 10);
    expect(restoredStart).toMatchObject({ offsetMs: 2_000, sourceInMs: 0, sourceOutMs: 10_000 });

    const trimmedEnd = trimEditorAudioClipEdge(clip, 'end', -2, 10);
    expect(trimmedEnd).toMatchObject({ offsetMs: 2_000, sourceInMs: 0, sourceOutMs: 8_000 });
  });

  it('splits source windows, automation, and fades at the timeline playhead', () => {
    const split = splitEditorAudioClipAtTimelineSeconds(
      clip,
      10,
      4.5,
      (side) => side,
    );

    expect(split).toBeDefined();
    const [left, right] = split!;
    expect(left).toMatchObject({ id: 'left', offsetMs: 2_000, sourceInMs: 0, sourceOutMs: 2_500, fadeOutSeconds: 0 });
    expect(right).toMatchObject({ id: 'right', offsetMs: 4_500, sourceInMs: 2_500, sourceOutMs: 10_000, fadeInSeconds: 0 });
    expect(left.volumeAutomationPoints?.at(-1)).toEqual({ timePercent: 100, valuePercent: 75 });
    expect(right.volumeAutomationPoints?.[0]).toEqual({ timePercent: 0, valuePercent: 75 });
  });

  it('refuses zero-length and near-edge splits', () => {
    expect(splitEditorAudioClipAtTimelineSeconds({ ...clip, fadeInSeconds: 0 }, 10, 2.005)).toBeUndefined();
    expect(splitEditorAudioClipAtTimelineSeconds(clip, 10, 12)).toBeUndefined();
  });

  it('refuses a split inside an outer-edge fade because that edit would change the curve', () => {
    expect(splitEditorAudioClipAtTimelineSeconds(clip, 10, 2.5)).toBeUndefined();
    expect(splitEditorAudioClipAtTimelineSeconds(clip, 10, 11.5)).toBeUndefined();
  });
});
