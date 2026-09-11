import { describe, expect, it } from 'vitest';
import {
  buildVideoClipClipboard,
  createVideoClipboardAudioTimelineClip,
  createVideoClipboardVisualTimelineClip,
  MAX_VIDEO_CLIPBOARD_CLIPS,
  planVideoClipPaste,
  type VideoClipboardTimelineClip,
  type VideoClipboardTrack,
} from './videoClipClipboard';
import { createEditorAudioClip, createEditorVisualClip } from './manualEditorState';

const tracks: VideoClipboardTrack[] = [
  { id: 'v1', kind: 'video', order: 0, locked: false },
  { id: 'v2', kind: 'video', order: 1, locked: false },
  { id: 'a1', kind: 'audio', order: 0, locked: false },
];

const clips: VideoClipboardTimelineClip[] = [
  { id: 'picture', kind: 'visual', trackId: 'v1', startMs: 1_000, durationMs: 2_000, sourceItemId: 'camera', sourceInMs: 500, sourceOutMs: 2_500, linkGroupId: 'av-1' },
  { id: 'title', kind: 'visual', trackId: 'v2', startMs: 1_250, durationMs: 1_000, sourceItemId: 'title-source', sourceInMs: 0 },
  { id: 'sound', kind: 'audio', trackId: 'a1', startMs: 1_100, durationMs: 2_000, sourceItemId: 'camera-audio', sourceInMs: 600, sourceOutMs: 2_600, linkGroupId: 'av-1' },
];

describe('Video clip clipboard', () => {
  it('builds a media-free descriptor preserving relative time, track, and link offsets', () => {
    const result = buildVideoClipClipboard({
      operation: 'copy', sourceSequenceId: 'sequence-a', sourceRevision: 'rev-7', clips,
      selectedClipIds: ['picture', 'title', 'sound'], tracks,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toMatchObject({ anchorStartMs: 1_000, spanMs: 2_100, items: [
      expect.objectContaining({ sourceClipId: 'picture', relativeStartMs: 0, relativeTrackOffset: 0, relativeLinkOffsetMs: 0 }),
      expect.objectContaining({ sourceClipId: 'sound', relativeStartMs: 100, relativeTrackOffset: 0, relativeLinkOffsetMs: 100 }),
      expect.objectContaining({ sourceClipId: 'title', relativeStartMs: 250, relativeTrackOffset: 1 }),
    ] });
    expect(JSON.stringify(result.document)).not.toMatch(/assetUrl|data:|nativeFilePath|mediaBytes/u);
  });

  it('plans collision-safe cross-sequence paste-insert without mutating source clips', () => {
    const clipboard = buildVideoClipClipboard({
      operation: 'cut', sourceSequenceId: 'sequence-a', sourceRevision: 'rev-7', clips,
      selectedClipIds: ['picture', 'sound'], tracks,
    });
    expect(clipboard.ok).toBe(true);
    if (!clipboard.ok) return;
    const destinationTracks: VideoClipboardTrack[] = [
      { id: 'video-main', kind: 'video', order: 0, locked: false },
      { id: 'audio-main', kind: 'audio', order: 0, locked: false },
    ];
    const result = planVideoClipPaste({
      clipboard: clipboard.document,
      destinationSequenceId: 'sequence-b',
      atMs: 10_000,
      mode: 'insert',
      tracks: destinationTracks,
      targetTrackIdByKind: { visual: 'video-main', audio: 'audio-main' },
      availableSourceItemIds: new Set(['camera', 'camera-audio']),
      existingClips: [
        { ...clips[0], id: 'picture-copy', trackId: 'video-main', startMs: 15_000 },
        { ...clips[2], id: 'later-audio', trackId: 'audio-main', startMs: 16_000 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.clips.map((clip) => [clip.id, clip.startMs, clip.trackId])).toEqual([
      ['picture-copy-2', 10_000, 'video-main'],
      ['sound-copy', 10_100, 'audio-main'],
    ]);
    expect(new Set(result.plan.clips.map((clip) => clip.linkGroupId)).size).toBe(1);
    expect(result.plan.insertShifts).toEqual([
      { clipId: 'later-audio', trackId: 'audio-main', deltaMs: 2_100 },
      { clipId: 'picture-copy', trackId: 'video-main', deltaMs: 2_100 },
    ]);
    expect(result.plan.cutRemoval).toEqual({ sequenceId: 'sequence-a', expectedRevision: 'rev-7', clipIds: ['picture', 'sound'] });
    expect(clips[0].startMs).toBe(1_000);
  });

  it('rejects paste atomically when a source is missing or any target track is locked', () => {
    const clipboard = buildVideoClipClipboard({
      operation: 'copy', sourceSequenceId: 'sequence-a', sourceRevision: 'rev', clips,
      selectedClipIds: ['picture'], tracks,
    });
    expect(clipboard.ok).toBe(true);
    if (!clipboard.ok) return;
    const result = planVideoClipPaste({
      clipboard: clipboard.document,
      destinationSequenceId: 'sequence-b', atMs: 0, mode: 'overwrite',
      tracks: [{ id: 'locked-video', kind: 'video', order: 0, locked: true }],
      targetTrackIdByKind: { visual: 'locked-video' },
      availableSourceItemIds: new Set(), existingClips: [],
    });
    expect(result).toMatchObject({ ok: false, errors: [
      { code: 'missing-source', sourceItemIds: ['camera'] },
      { code: 'target-track-locked', trackIds: ['locked-video'] },
    ] });
  });

  it('rejects cuts from locked tracks and selections beyond the hard bound', () => {
    const locked = buildVideoClipClipboard({
      operation: 'cut', sourceSequenceId: 'sequence-a', sourceRevision: 'rev', clips,
      selectedClipIds: ['picture'], tracks: [{ ...tracks[0], locked: true }, ...tracks.slice(1)],
    });
    expect(locked).toMatchObject({ ok: false, errors: [{ code: 'source-track-locked' }] });

    const tooMany = Array.from({ length: MAX_VIDEO_CLIPBOARD_CLIPS + 1 }, (_, index) => `clip-${index}`);
    expect(buildVideoClipClipboard({
      operation: 'copy', sourceSequenceId: 'sequence-a', sourceRevision: 'rev', clips: [],
      selectedClipIds: tooMany, tracks,
    })).toMatchObject({ ok: false, errors: [{ code: 'selection-limit', limit: MAX_VIDEO_CLIPBOARD_CLIPS }] });
  });

  it('preserves complete authored visual/audio state without retaining runtime media', () => {
    const visual = {
      ...createEditorVisualClip('camera-node', 'video', {
        sourceInMs: 500,
        sourceOutMs: 2_500,
        durationSeconds: 2,
      }),
      id: 'authored-picture',
      startMs: 1_000,
      positionX: 18,
      textContent: 'Lower third',
      opacityAutomationPoints: [{ timePercent: 25, valuePercent: 65 }],
      keyframes: [{ timePercent: 50, positionX: 25, positionY: 40, scalePercent: 115, rotationDeg: 3, opacityPercent: 80 }],
      filterStack: [{ id: 'grade', kind: 'contrast' as const, amount: 14, enabled: true }],
      professional: {
        trackId: 'v1',
        linkGroupId: 'authored-av',
        syncGroupId: 'sync-take-4',
        parameterKeyframes: [{
          id: 'opacity-track', parameter: 'opacity',
          keyframes: [{ id: 'opacity-1', timeMs: 600, value: 72, interpolation: 'linear' as const }],
        }],
      },
    };
    const audioBase = createEditorAudioClip('camera-audio-node', 0, { sourceInMs: 600, sourceOutMs: 2_600 });
    const audio = {
      ...audioBase,
      id: 'authored-sound',
      offsetMs: 1_100,
      volumePercent: 82,
      fadeInSeconds: 0.2,
      fadeOutSeconds: 0.4,
      volumeAutomationPoints: [{ timePercent: 40, valuePercent: 75 }],
      volumeKeyframes: [{ timePercent: 70, volumePercent: 55 }],
      audioProcessing: { ...audioBase.audioProcessing!, compressorEnabled: true, limiterEnabled: true },
      professional: {
        trackId: 'a1', linkGroupId: 'authored-av', syncGroupId: 'sync-take-4', pan: -0.25,
        parameterKeyframes: [{
          id: 'pan-track', parameter: 'pan',
          keyframes: [{ id: 'pan-1', timeMs: 300, value: -0.25, interpolation: 'hold' as const }],
        }],
      },
    };
    const authoredClips = [
      createVideoClipboardVisualTimelineClip({ clip: visual, trackId: 'v1', sourceItemId: 'camera' }),
      createVideoClipboardAudioTimelineClip({ clip: audio, trackId: 'a1', sourceItemId: 'camera-audio' }),
    ];
    const built = buildVideoClipClipboard({
      operation: 'copy', sourceSequenceId: 'sequence-a', sourceRevision: 'rev-authored',
      clips: authoredClips, selectedClipIds: authoredClips.map((clip) => clip.id), tracks,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    visual.filterStack[0]!.amount = 99;
    audio.volumeAutomationPoints![0]!.valuePercent = 1;
    const pasted = planVideoClipPaste({
      clipboard: built.document,
      destinationSequenceId: 'sequence-b', atMs: 8_000, mode: 'insert',
      tracks: [
        { id: 'dest-v', kind: 'video', order: 3, locked: false },
        { id: 'dest-a', kind: 'audio', order: 2, locked: false },
      ],
      targetTrackIdByKind: { visual: 'dest-v', audio: 'dest-a' },
      availableSourceItemIds: new Set(['camera', 'camera-audio']), existingClips: [],
    });
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    const pastedVisual = pasted.plan.clips.find((clip) => clip.kind === 'visual')?.authoredClip;
    const pastedAudio = pasted.plan.clips.find((clip) => clip.kind === 'audio')?.authoredClip;
    expect(pastedVisual?.kind).toBe('visual');
    expect(pastedAudio?.kind).toBe('audio');
    if (pastedVisual?.kind !== 'visual' || pastedAudio?.kind !== 'audio') return;
    expect(pastedVisual.clip).toMatchObject({
      id: 'authored-picture-copy', trackIndex: 3, startMs: 8_000, positionX: 18,
      textContent: 'Lower third', filterStack: [{ id: 'grade', amount: 14 }],
      opacityAutomationPoints: [{ timePercent: 25, valuePercent: 65 }],
      professional: { trackId: 'dest-v', parameterKeyframes: [{ id: 'opacity-track' }] },
    });
    expect(pastedAudio.clip).toMatchObject({
      id: 'authored-sound-copy', trackIndex: 2, offsetMs: 8_100, volumePercent: 82,
      fadeInSeconds: 0.2, fadeOutSeconds: 0.4,
      volumeAutomationPoints: [{ timePercent: 40, valuePercent: 75 }],
      audioProcessing: { compressorEnabled: true, limiterEnabled: true },
      professional: { trackId: 'dest-a', parameterKeyframes: [{ id: 'pan-track' }] },
    });
    expect(pastedVisual.clip.professional?.linkGroupId).toBe(pastedAudio.clip.professional?.linkGroupId);
    expect(pastedVisual.clip.professional?.syncGroupId).toBe(pastedAudio.clip.professional?.syncGroupId);
    expect(JSON.stringify(built.document)).not.toMatch(/(?:blob:|data:|nativeFilePath|mediaBytes|cachePath)/u);
  });

  it('exposes exact retained destination edge fragments for overwrite paste', () => {
    const destinationVisual = {
      ...createEditorVisualClip('destination-camera', 'video', {
        sourceInMs: 1_000,
        sourceOutMs: 11_000,
        durationSeconds: 10,
      }),
      id: 'destination-long',
      startMs: 0,
      filterStack: [{ id: 'destination-look', kind: 'saturation' as const, amount: 12, enabled: true }],
    };
    const destinationDescriptor = createVideoClipboardVisualTimelineClip({
      clip: destinationVisual, trackId: 'v1', sourceItemId: 'destination-source',
    });
    const overwriteSource: VideoClipboardTimelineClip = {
      id: 'incoming', kind: 'visual', trackId: 'v1', startMs: 0, durationMs: 2_000,
      sourceItemId: 'incoming-source', sourceInMs: 0, sourceOutMs: 2_000,
    };
    const clipboard = buildVideoClipClipboard({
      operation: 'copy', sourceSequenceId: 'source-sequence', sourceRevision: 'source-rev',
      clips: [overwriteSource], selectedClipIds: ['incoming'], tracks,
    });
    expect(clipboard.ok).toBe(true);
    if (!clipboard.ok) return;
    const planned = planVideoClipPaste({
      clipboard: clipboard.document, destinationSequenceId: 'destination-sequence',
      atMs: 4_000, mode: 'overwrite', tracks,
      targetTrackIdByKind: { visual: 'v1' },
      availableSourceItemIds: new Set(['incoming-source']),
      existingClips: [destinationDescriptor],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.overwriteReplacements).toHaveLength(1);
    const replacement = planned.plan.overwriteReplacements[0]!;
    expect(replacement.removedRanges).toEqual([{ startMs: 4_000, endMs: 6_000 }]);
    expect(replacement.retainedFragments.map((clip) => [
      clip.id, clip.startMs, clip.durationMs, clip.sourceInMs, clip.sourceOutMs,
    ])).toEqual([
      ['destination-long', 0, 4_000, 1_000, 5_000],
      ['destination-long-overwrite-fragment', 6_000, 4_000, 7_000, 11_000],
    ]);
    expect(replacement.retainedFragments.every((fragment) =>
      fragment.authoredClip?.kind === 'visual'
      && fragment.authoredClip.clip.filterStack[0]?.id === 'destination-look'
      && fragment.authoredClip.clip.durationSeconds === 4)).toBe(true);
  });
});
