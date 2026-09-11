import { describe, expect, it } from 'vitest';
import type { EditorAudioClip, EditorVisualClip } from '../types/flow';
import { createEditorAudioClip, createEditorVisualClip } from './manualEditorState';
import type { EditableTranscriptWord, TranscriptEditProposal } from './videoTranscriptEditing';
import {
  applyVideoTranscriptPatch,
  mapVideoTranscriptSourceProposalToRecord,
  MAX_VIDEO_TRANSCRIPT_AFFECTED_CLIPS,
  MAX_VIDEO_TRANSCRIPT_APPLY_WORDS,
  planAndApplyVideoTranscriptEdit,
  planAndApplyVideoSourceTranscriptEdit,
  planVideoTranscriptApply,
  type VideoTranscriptApplyTrack,
} from './videoTranscriptApply';

const words: EditableTranscriptWord[] = [
  { id: 'word-1', text: 'Remove', startMs: 3_000, endMs: 4_000 },
  { id: 'word-2', text: 'this', startMs: 4_000, endMs: 5_000 },
];

const proposal: TranscriptEditProposal = {
  title: 'Remove transcript selection',
  ranges: [{ startMs: 3_000, endMs: 5_000, reason: 'transcript-selection' }],
  commands: [{ kind: 'ripple-delete', startMs: 3_000, endMs: 5_000, durationMs: 2_000, source: 'transcript' }],
  removedRangesAfter: [{ startMs: 3_000, endMs: 5_000, reason: 'transcript-selection' }],
};

const tracks: VideoTranscriptApplyTrack[] = [
  { kind: 'visual', trackIndex: 0, locked: false },
  { kind: 'audio', trackIndex: 0, locked: false },
];

function visual(overrides: Partial<EditorVisualClip> = {}): EditorVisualClip {
  return {
    ...createEditorVisualClip('imported-video-node', 'video', {
      sourceInMs: 0,
      sourceOutMs: 10_000,
      durationSeconds: 10,
      playbackRate: 1,
    }),
    id: 'visual-original',
    professional: { linkGroupId: 'linked-av', chromaKeyMode: 'green' },
    filterStack: [{ id: 'look', kind: 'contrast', amount: 12, enabled: true }],
    ...overrides,
  };
}

function audio(overrides: Partial<EditorAudioClip> = {}): EditorAudioClip {
  return {
    ...createEditorAudioClip('imported-audio-node', 0, { sourceInMs: 0, sourceOutMs: 10_000 }),
    id: 'audio-original',
    professional: { linkGroupId: 'linked-av', pan: -0.2 },
    audioProcessing: {
      ...createEditorAudioClip('imported-audio-node', 0).audioProcessing!,
      limiterEnabled: true,
    },
    ...overrides,
  };
}

describe('transcript edit timeline adapter', () => {
  it('applies one atomic linked A/V split while preserving original clip fields', () => {
    const result = planAndApplyVideoTranscriptEdit({
      visualClips: [visual()],
      audioClips: [audio()],
      tracks,
      words,
      proposal,
      createSplitClipId: ({ kind }) => `${kind}-right`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.patch.affectedClipIds).toEqual(['audio-original', 'visual-original']);
    expect(result.value.visualClips.map((clip) => [clip.id, clip.startMs, clip.durationSeconds, clip.sourceInMs, clip.sourceOutMs])).toEqual([
      ['visual-original', 0, 3, 0, 3_000],
      ['visual-right', 3_000, 5, 5_000, 10_000],
    ]);
    expect(result.value.audioClips.map((clip) => [clip.id, clip.offsetMs, clip.sourceInMs, clip.sourceOutMs])).toEqual([
      ['audio-original', 0, 0, 3_000],
      ['audio-right', 3_000, 5_000, 10_000],
    ]);
    expect(result.value.visualClips.every((clip) => clip.filterStack[0]?.id === 'look')).toBe(true);
    expect(result.value.audioClips.every((clip) => clip.audioProcessing?.limiterEnabled)).toBe(true);
    expect(result.value.visualClips[1]?.professional?.linkGroupId).toBe('linked-av::transcript:0:right');
    expect(result.value.audioClips[1]?.professional?.linkGroupId).toBe('linked-av::transcript:0:right');
  });

  it('rejects locked or non-atomic linked changes before returning a patch', () => {
    const locked = planVideoTranscriptApply({
      visualClips: [visual()], audioClips: [audio()], words, proposal,
      tracks: tracks.map((track) => track.kind === 'audio' ? { ...track, locked: true } : track),
    });
    expect(locked).toMatchObject({ ok: false, reason: 'locked-track' });

    const misaligned = planVideoTranscriptApply({
      visualClips: [visual()],
      audioClips: [audio({ offsetMs: 8_000, sourceInMs: 0, sourceOutMs: 2_000 })],
      tracks,
      words,
      proposal,
    });
    expect(misaligned).toMatchObject({ ok: false, reason: 'linked-group-not-atomic' });
  });

  it('rejects stale patches instead of overwriting concurrent timeline edits', () => {
    const originalVisual = visual({ professional: undefined });
    const planned = planVideoTranscriptApply({
      visualClips: [originalVisual], audioClips: [], tracks: [tracks[0]!], words, proposal,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(applyVideoTranscriptPatch([{ ...originalVisual, startMs: 100 }], [], planned.value)).toMatchObject({
      ok: false,
      reason: 'stale-patch',
    });
  });

  it('enforces the word and affected-clip application limits', () => {
    const tooManyWords = { length: MAX_VIDEO_TRANSCRIPT_APPLY_WORDS + 1 } as unknown as readonly EditableTranscriptWord[];
    expect(planVideoTranscriptApply({ visualClips: [], audioClips: [], tracks: [], words: tooManyWords, proposal })).toMatchObject({
      ok: false,
      reason: 'too-many-words',
    });

    const manyVisualClips = Array.from({ length: MAX_VIDEO_TRANSCRIPT_AFFECTED_CLIPS + 1 }, (_, index) =>
      visual({
        id: `clip-${index}`,
        startMs: 6_000 + index * 20,
        sourceInMs: 0,
        sourceOutMs: 10,
        durationSeconds: 0.01,
        professional: undefined,
      }),
    );
    expect(planVideoTranscriptApply({
      visualClips: manyVisualClips,
      audioClips: [],
      tracks: [tracks[0]!],
      words,
      proposal,
    })).toMatchObject({ ok: false, reason: 'too-many-affected-clips' });
  });

  it('maps source transcript ranges through a uniform-speed source clip into record time', () => {
    const sourceProposal: TranscriptEditProposal = {
      title: 'Remove source words',
      ranges: [{ startMs: 12_000, endMs: 14_000, reason: 'transcript-selection' }],
      commands: [{ kind: 'ripple-delete', startMs: 12_000, endMs: 14_000, durationMs: 2_000, source: 'transcript' }],
      removedRangesAfter: [{ startMs: 12_000, endMs: 14_000, reason: 'transcript-selection' }],
    };
    const result = mapVideoTranscriptSourceProposalToRecord({
      visualClips: [visual({
        id: 'source-instance', startMs: 30_000, sourceInMs: 10_000, sourceOutMs: 20_000,
        durationSeconds: 5, playbackRate: 2, professional: undefined,
      })],
      audioClips: [],
      selectedClips: [{ kind: 'visual', clipId: 'source-instance' }],
      sourceProposal,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mappings).toEqual([{
      clipId: 'source-instance', kind: 'visual',
      sourceStartMs: 12_000, sourceEndMs: 14_000,
      sourceInMs: 10_000, sourceOutMs: 20_000, speed: 2,
      recordStartMs: 31_000, recordEndMs: 32_000,
      reason: 'transcript-selection',
    }]);
    expect(result.value.recordProposal.commands).toEqual([{
      kind: 'ripple-delete', startMs: 31_000, endMs: 32_000,
      durationMs: 1_000, source: 'transcript',
    }]);
  });

  it('rejects reverse, nonlinear, and source-boundary-ambiguous mappings explicitly', () => {
    const sourceProposal: TranscriptEditProposal = {
      title: 'Map source selection',
      ranges: [{ startMs: 10_000, endMs: 11_000, reason: 'transcript-selection' }],
      commands: [{ kind: 'ripple-delete', startMs: 10_000, endMs: 11_000, durationMs: 1_000, source: 'transcript' }],
      removedRangesAfter: [{ startMs: 10_000, endMs: 11_000, reason: 'transcript-selection' }],
    };
    const mapping = (clip: EditorVisualClip, proposalOverride = sourceProposal) =>
      mapVideoTranscriptSourceProposalToRecord({
        visualClips: [clip], audioClips: [],
        selectedClips: [{ kind: 'visual', clipId: clip.id }],
        sourceProposal: proposalOverride,
      });
    expect(mapping(visual({
      id: 'reverse', sourceInMs: 10_000, sourceOutMs: 20_000, reversePlayback: true,
    }))).toMatchObject({ ok: false, reason: 'reverse-source-mapping' });
    expect(mapping(visual({
      id: 'retimed', sourceInMs: 10_000, sourceOutMs: 20_000,
      professional: {
        retime: [{ id: 'ramp', timelineStartMs: 0, timelineEndMs: 5_000, speedPercent: 80, interpolation: 'blend' }],
      },
    }))).toMatchObject({ ok: false, reason: 'nonlinear-source-mapping' });
    expect(mapping(visual({
      id: 'inconsistent', sourceInMs: 10_000, sourceOutMs: 20_000,
      durationSeconds: 5, playbackRate: 1,
    }))).toMatchObject({ ok: false, reason: 'ambiguous-source-mapping' });
    const boundaryProposal: TranscriptEditProposal = {
      ...sourceProposal,
      ranges: [{ startMs: 9_500, endMs: 10_500, reason: 'transcript-selection' }],
      removedRangesAfter: [{ startMs: 9_500, endMs: 10_500, reason: 'transcript-selection' }],
    };
    expect(mapping(visual({
      id: 'boundary', sourceInMs: 10_000, sourceOutMs: 20_000,
    }), boundaryProposal)).toMatchObject({ ok: false, reason: 'partial-source-range' });
  });

  it('routes mapped source edits through linked/locked atomic application', () => {
    const sourceWords: EditableTranscriptWord[] = [
      { id: 'source-word-1', text: 'remove', startMs: 12_000, endMs: 13_000 },
      { id: 'source-word-2', text: 'this', startMs: 13_000, endMs: 14_000 },
    ];
    const sourceProposal: TranscriptEditProposal = {
      title: 'Remove linked source selection',
      ranges: [{ startMs: 12_000, endMs: 14_000, reason: 'transcript-selection' }],
      commands: [{ kind: 'ripple-delete', startMs: 12_000, endMs: 14_000, durationMs: 2_000, source: 'transcript' }],
      removedRangesAfter: [{ startMs: 12_000, endMs: 14_000, reason: 'transcript-selection' }],
    };
    const visualClip = visual({
      id: 'linked-visual-source', startMs: 30_000, sourceInMs: 10_000, sourceOutMs: 20_000,
      durationSeconds: 10, professional: { linkGroupId: 'linked-source' },
    });
    const audioClip = audio({
      id: 'linked-audio-source', offsetMs: 30_000, sourceInMs: 10_000, sourceOutMs: 20_000,
      professional: { linkGroupId: 'linked-source', pan: 0 },
    });
    const baseInput = {
      visualClips: [visualClip], audioClips: [audioClip],
      selectedClips: [
        { kind: 'visual' as const, clipId: visualClip.id },
        { kind: 'audio' as const, clipId: audioClip.id },
      ],
      sourceProposal, words: sourceWords,
    };
    expect(planAndApplyVideoSourceTranscriptEdit({
      ...baseInput,
      tracks: tracks.map((track) => track.kind === 'audio' ? { ...track, locked: true } : track),
    })).toMatchObject({ ok: false, reason: 'locked-track' });

    const applied = planAndApplyVideoSourceTranscriptEdit({
      ...baseInput,
      tracks,
      createSplitClipId: ({ kind }) => `${kind}-mapped-right`,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.sourceMapping.recordProposal.commands[0]).toMatchObject({
      startMs: 32_000, endMs: 34_000,
    });
    expect(applied.value.visualClips.map((clip) => [clip.id, clip.startMs, clip.sourceInMs, clip.sourceOutMs])).toEqual([
      ['linked-visual-source', 30_000, 10_000, 12_000],
      ['visual-mapped-right', 32_000, 14_000, 20_000],
    ]);
    expect(applied.value.audioClips.map((clip) => [clip.id, clip.offsetMs, clip.sourceInMs, clip.sourceOutMs])).toEqual([
      ['linked-audio-source', 30_000, 10_000, 12_000],
      ['audio-mapped-right', 32_000, 14_000, 20_000],
    ]);
  });
});
