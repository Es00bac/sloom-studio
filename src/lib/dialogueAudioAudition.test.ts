import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR_AUDIO_PROCESSING } from './editorAudioProcessing';
import { buildDialogueGateGainFrames, resolveDialogueAuditionWindow } from './dialogueAudioAudition';

describe('dialogue A/B audition gate envelope', () => {
  it('attenuates sustained signal below threshold and opens for speech-level signal', () => {
    const quiet = new Float32Array(1_000).fill(0.001);
    const loud = new Float32Array(1_000).fill(0.2);
    const frames = buildDialogueGateGainFrames(
      [Float32Array.from([...quiet, ...loud])],
      1_000,
      { ...DEFAULT_EDITOR_AUDIO_PROCESSING, gateAttackMs: 1, gateReleaseMs: 20 },
    );
    expect(frames[20]).toBeLessThan(0.2);
    expect(frames.at(-1)).toBeGreaterThan(0.95);
  });

  it('links channels by maximum energy so anti-phase stereo does not disappear', () => {
    const left = new Float32Array(1_000).fill(0.2);
    const right = new Float32Array(1_000).fill(-0.2);
    const frames = buildDialogueGateGainFrames(
      [left, right],
      1_000,
      DEFAULT_EDITOR_AUDIO_PROCESSING,
    );
    expect(Math.min(...frames)).toBeGreaterThan(0.99);
  });
});

describe('dialogue A/B audition window', () => {
  it('caps playback to one common 30-second window centered near the playhead', () => {
    expect(resolveDialogueAuditionWindow(120, 60)).toEqual({ startSeconds: 45, durationSeconds: 30 });
    expect(resolveDialogueAuditionWindow(120, 2)).toEqual({ startSeconds: 0, durationSeconds: 30 });
    expect(resolveDialogueAuditionWindow(120, 118)).toEqual({ startSeconds: 90, durationSeconds: 30 });
  });

  it('keeps short comparisons one-shot at their exact common duration', () => {
    expect(resolveDialogueAuditionWindow(8.5, 4)).toEqual({ startSeconds: 0, durationSeconds: 8.5 });
  });
});
