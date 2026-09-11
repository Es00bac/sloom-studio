import { describe, expect, it } from 'vitest';
import {
  createDefaultEditorProfessionalWorkflowState,
  type EditorProfessionalWorkflowState,
  type VideoSemanticCaptionTrack,
} from '../types/videoProduction';
import { sanitizeEditorProfessionalWorkflowState } from './videoProductionState';
import {
  VIDEO_CAPTION_EMBEDDING_FORMAT,
  VIDEO_CAPTION_EMBEDDING_INPUT_NAME,
  buildVideoCaptionEmbeddingPlan,
} from './videoCaptionEmbedding';

const mp4Preset = { container: 'MP4', extension: 'mp4', imageSequence: false };

const englishTrack: VideoSemanticCaptionTrack = {
  id: 'english',
  name: 'English captions',
  language: 'eng',
  service: 'captions',
  style: {
    fontFamily: 'Helvetica',
    fontSizePx: 24,
    textColor: '#ffffff',
    backgroundOpacityPercent: 50,
    safeAreaPercent: 90,
  },
  cues: [
    { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'First plain caption.' },
    { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Second plain caption.' },
  ],
};

function embeddedWorkflow(): EditorProfessionalWorkflowState {
  return {
    ...createDefaultEditorProfessionalWorkflowState(),
    captionEmbedding: { enabled: true, trackId: 'english' },
    captionTracks: [englishTrack],
  };
}

describe('videoCaptionEmbedding', () => {
  it('builds one bounded, plain-timed-text mov_text input for an aligned MP4 delivery', () => {
    const workflow = embeddedWorkflow();
    const result = buildVideoCaptionEmbeddingPlan({ workflow, exportPreset: mp4Preset, frameRate: 30 });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        format: VIDEO_CAPTION_EMBEDDING_FORMAT,
        inputName: VIDEO_CAPTION_EMBEDDING_INPUT_NAME,
        language: 'eng',
        trackId: 'english',
        cueCount: 2,
        styleBoundary: 'plain-timing-and-text-only',
      }),
    });
    if (!result.ok || !result.value) throw new Error('Expected caption plan.');
    expect(result.value.srt).toContain('00:00:00,000 --> 00:00:01,000');
    expect(result.value.srt).toContain('Second plain caption.');
  });

  it('refuses unrepresentable output, timebase, styled text, and mismatched delivery without mutating authoring state', () => {
    const workflow = embeddedWorkflow();
    const before = structuredClone(workflow);

    expect(buildVideoCaptionEmbeddingPlan({
      workflow,
      exportPreset: { container: 'WebM', extension: 'webm', imageSequence: false },
      frameRate: 30,
    })).toMatchObject({ ok: false, reason: expect.stringContaining('MP4 or MOV') });
    expect(buildVideoCaptionEmbeddingPlan({ workflow, exportPreset: mp4Preset, frameRate: 25 }))
      .toMatchObject({ ok: false, reason: expect.stringContaining('frame rate') });
    expect(buildVideoCaptionEmbeddingPlan({
      workflow: { ...workflow, timebase: { ...workflow.timebase, dropFrame: true } },
      exportPreset: mp4Preset,
      frameRate: 30,
    })).toMatchObject({ ok: false, reason: expect.stringContaining('non-drop') });
    expect(buildVideoCaptionEmbeddingPlan({
      workflow: {
        ...workflow,
        captionTracks: [{ ...workflow.captionTracks[0], cues: [{ id: 'styled', startMs: 0, endMs: 1_000, text: '<i>Styled</i>' }] }],
      },
      exportPreset: mp4Preset,
      frameRate: 30,
    })).toMatchObject({ ok: false, reason: expect.stringContaining('styling markup') });
    expect(workflow).toEqual(before);
  });

  it('persists a retained selection and fail-closes an explicit stale selection on reopen', () => {
    const state = sanitizeEditorProfessionalWorkflowState({
      ...embeddedWorkflow(),
      captionEmbedding: { enabled: true, trackId: 'english' },
    });
    expect(state.captionEmbedding).toEqual({ enabled: true, trackId: 'english' });

    const stale = sanitizeEditorProfessionalWorkflowState({
      ...embeddedWorkflow(),
      captionEmbedding: { enabled: true, trackId: 'removed-language' },
    });
    expect(stale.captionEmbedding).toEqual({ enabled: false });
  });
});
