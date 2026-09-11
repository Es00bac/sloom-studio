import { describe, expect, it } from 'vitest';
import {
  EDITOR_HISTORY_ABSOLUTE_LIMIT,
  createEditorHistorySnapshot,
  createEditorHistoryState,
  estimateEditorHistoryEntryCharacters,
  pushEditorHistoryEntry,
  redoEditorHistory,
  undoEditorHistory,
} from './editorHistory';
import type { EditorVisualClip, NodeData } from '../types/flow';
import { createDefaultEditorProfessionalWorkflowState } from '../types/videoProduction';

function createVisualClip(overrides: Partial<EditorVisualClip> & Pick<EditorVisualClip, 'id'>): EditorVisualClip {
  const { id, ...rest } = overrides;

  return {
    id,
    sourceNodeId: 'source-1',
    sourceKind: 'image',
    trackIndex: 0,
    startMs: 0,
    sourceInMs: 0,
    durationSeconds: 4,
    trimStartMs: 0,
    trimEndMs: 0,
    playbackRate: 1,
    reversePlayback: false,
    fitMode: 'contain',
    scalePercent: 100,
    scaleMotionEnabled: false,
    endScalePercent: 100,
    opacityPercent: 100,
    rotationDeg: 0,
    rotationMotionEnabled: false,
    endRotationDeg: 0,
    flipHorizontal: false,
    flipVertical: false,
    positionX: 0,
    positionY: 0,
    motionEnabled: false,
    endPositionX: 0,
    endPositionY: 0,
    cropLeftPercent: 0,
    cropRightPercent: 0,
    cropTopPercent: 0,
    cropBottomPercent: 0,
    cropPanXPercent: 0,
    cropPanYPercent: 0,
    cropRotationDeg: 0,
    filterStack: [],
    transitionIn: 'none',
    transitionOut: 'none',
    transitionDurationMs: 500,
    textFontFamily: 'Inter, system-ui, sans-serif',
    textSizePx: 64,
    textColor: '#f3f4f6',
    textEffect: 'shadow',
    textBackgroundOpacityPercent: 0,
    ...rest,
  };
}

describe('editor history', () => {
  it('undoes and redoes composition editor snapshots', () => {
    const before = createEditorHistorySnapshot({
      aspectRatio: '16:9',
      editorVisualClips: [createVisualClip({ id: 'visual-1', startMs: 0 })],
    });
    const after = createEditorHistorySnapshot({
      aspectRatio: '9:16',
      editorVisualClips: [createVisualClip({ id: 'visual-1', startMs: 2500 })],
    });

    const history = pushEditorHistoryEntry(createEditorHistoryState(), {
      compositionId: 'composition-1',
      before,
      after,
      label: 'Move clip',
    });

    const undo = undoEditorHistory(history);
    expect(undo.entry?.compositionId).toBe('composition-1');
    expect(undo.snapshot).toEqual(before);
    expect(undo.history.undoStack).toHaveLength(0);
    expect(undo.history.redoStack).toHaveLength(1);

    const redo = redoEditorHistory(undo.history);
    expect(redo.entry?.label).toBe('Move clip');
    expect(redo.snapshot).toEqual(after);
    expect(redo.history.undoStack).toHaveLength(1);
    expect(redo.history.redoStack).toHaveLength(0);
  });

  it('ignores no-op snapshots and clears redo after a new edit', () => {
    const first = createEditorHistorySnapshot({
      editorVisualClips: [createVisualClip({ id: 'visual-1', startMs: 0 })],
    });
    const second = createEditorHistorySnapshot({
      editorVisualClips: [createVisualClip({ id: 'visual-1', startMs: 1000 })],
    });
    const third = createEditorHistorySnapshot({
      editorVisualClips: [createVisualClip({ id: 'visual-1', startMs: 2000 })],
    });

    const empty = pushEditorHistoryEntry(createEditorHistoryState(), {
      compositionId: 'composition-1',
      before: first,
      after: first,
      label: 'No op',
    });
    expect(empty.undoStack).toHaveLength(0);

    const withRedo = undoEditorHistory(
      pushEditorHistoryEntry(empty, {
        compositionId: 'composition-1',
        before: first,
        after: second,
        label: 'Move clip',
      }),
    ).history;

    const next = pushEditorHistoryEntry(withRedo, {
      compositionId: 'composition-1',
      before: first,
      after: third,
      label: 'Move clip again',
    });

    expect(next.undoStack).toHaveLength(1);
    expect(next.redoStack).toHaveLength(0);
  });

  it('converts a saved snapshot back to a node-data patch', () => {
    const snapshot = createEditorHistorySnapshot({
      aspectRatio: '1:1',
      videoResolution: '4k',
      compositionTimelineSeconds: 42,
      editorMutedAudioTracks: [1],
      editorSoloAudioTracks: [2],
      editorVisualClips: [createVisualClip({ id: 'visual-1', startMs: 3000 })],
    } satisfies Partial<NodeData>);

    expect(snapshot.toPatch()).toMatchObject({
      aspectRatio: '1:1',
      videoResolution: '4k',
      compositionTimelineSeconds: 42,
      editorMutedAudioTracks: [1],
      editorSoloAudioTracks: [2],
      editorVisualClips: [{ id: 'visual-1', startMs: 3000 }],
      editorAudioClips: [],
    });
  });

  it('captures and restores every authored Video timeline field, including second-wave workflow state', () => {
    const workflow = createDefaultEditorProfessionalWorkflowState();
    workflow.smartBins.push({
      id: 'selects',
      name: 'Selects',
      query: 'rating:>=4',
      sortBy: 'rating',
      sortDirection: 'descending',
    });
    const source: Partial<NodeData> = {
      aspectRatio: '21:9',
      videoResolution: '1080p',
      videoFrameRate: 23.976,
      compositionTimelineSeconds: 7_200,
      compositionAudioTrackCount: 4,
      compositionUseVideoAudio: false,
      compositionVideoAudioVolume: 72,
      compositionAudio1OffsetMs: 1,
      compositionAudio2OffsetMs: 2,
      compositionAudio3OffsetMs: 3,
      compositionAudio4OffsetMs: 4,
      compositionAudio1Volume: 91,
      compositionAudio2Volume: 92,
      compositionAudio3Volume: 93,
      compositionAudio4Volume: 94,
      compositionAudio1Enabled: true,
      compositionAudio2Enabled: false,
      compositionAudio3Enabled: true,
      compositionAudio4Enabled: false,
      editorVisualClips: [createVisualClip({
        id: 'visual-1',
        trackIndex: 3,
        filterStack: [{ id: 'filter-1', kind: 'contrast', amount: 20, enabled: true }],
        chromaKey: { enabled: true, color: '#00ff00', similarityPercent: 40, blendPercent: 12 },
        professional: {
          linkGroupId: 'av-1',
          masks: [{
            id: 'mask-1',
            kind: 'bezier',
            points: [{ x: 0.1, y: 0.2 }],
            featherPercent: 15,
            opacityPercent: 100,
            inverted: false,
          }],
        },
      })],
      editorVisualTrackKinds: ['standard', 'overlay', 'standard', 'overlay'],
      editorAudioClips: [{
        id: 'audio-1',
        sourceNodeId: 'source-audio',
        offsetMs: 120,
        trackIndex: 3,
        volumePercent: 88,
        enabled: true,
        professional: { linkGroupId: 'av-1', pan: -0.2, channelMap: [1, 0] },
      }],
      editorAudioTrackVolumes: [90, 80, 70, 60],
      editorMutedAudioTracks: [3, 1],
      editorSoloAudioTracks: [2],
      editorAssets: [{
        id: 'comic-asset',
        kind: 'comic',
        label: 'Caption',
        createdAt: 1,
        updatedAt: 2,
        comicDefaults: {
          comicKind: 'caption',
          text: 'Meanwhile',
          fontFamily: 'Inter',
          fontSizePx: 40,
          textColor: '#111111',
          fillColor: '#eeeeee',
          strokeColor: '#222222',
          strokeWidthPx: 2,
          tailAngleDeg: 0,
          tailLengthPx: 0,
          lineHeightPercent: 120,
          letterSpacingPx: 0,
          textAlign: 'left',
        },
      }],
      editorStageObjects: [{
        id: 'stage-shape',
        kind: 'rectangle',
        x: 10,
        y: 20,
        width: 300,
        height: 200,
        rotationDeg: 5,
        opacityPercent: 90,
        blendMode: 'multiply',
        fillColor: '#000000',
        borderColor: '#ffffff',
        borderWidth: 2,
        cornerRadius: 8,
      }],
      editorTimelineSnapPoints: [12.3456, 4],
      editorTimelineMarkers: [{
        id: 'marker-1', seconds: 42, endSeconds: 48.5, label: 'Act two', color: '#f472b6', kind: 'review',
        notes: 'Client-approved range', createdAt: 100, updatedAt: 200,
      }],
      editorLockedVisualTracks: [3, 1],
      editorLockedAudioTracks: [2],
      editorCollapsedVisualTracks: [2],
      editorCollapsedAudioTracks: [3],
      editorExportPresetPlan: { presetId: 'prores-mov', notes: 'Master' },
      editorProfessionalState: {
        version: 1,
        proxyPlaybackEnabled: true,
        tracks: [],
        sequences: [],
        multicamSources: [],
        audioBuses: [],
        loudnessNormalization: { enabled: false, targetLufs: -14, loudnessRangeLu: 7, truePeakCeilingDbtp: -1 },
        workingColorSpace: 'rec709',
        toneMapping: 'none',
        adjustmentLayerClipIds: ['visual-1'],
        transcriptRemovedCueIds: [],
        interchangeHistory: [],
      },
      editorProfessionalWorkflowState: workflow,
    };
    const snapshot = createEditorHistorySnapshot(source);
    const patch = snapshot.toPatch();

    expect(patch).toMatchObject({
      aspectRatio: '21:9',
      videoResolution: '1080p',
      videoFrameRate: 23.976,
      compositionTimelineSeconds: 7_200,
      compositionAudioTrackCount: 4,
      compositionUseVideoAudio: false,
      compositionVideoAudioVolume: 72,
      compositionAudio1OffsetMs: 1,
      compositionAudio2OffsetMs: 2,
      compositionAudio3OffsetMs: 3,
      compositionAudio4OffsetMs: 4,
      compositionAudio1Volume: 91,
      compositionAudio2Volume: 92,
      compositionAudio3Volume: 93,
      compositionAudio4Volume: 94,
      compositionAudio1Enabled: true,
      compositionAudio2Enabled: false,
      compositionAudio3Enabled: true,
      compositionAudio4Enabled: false,
      editorVisualTrackKinds: ['standard', 'overlay', 'standard', 'overlay'],
      editorAudioTrackVolumes: [90, 80, 70, 60],
      editorMutedAudioTracks: [1, 3],
      editorSoloAudioTracks: [2],
      editorTimelineSnapPoints: [4, 12.346],
      editorTimelineMarkers: [{
        id: 'marker-1', seconds: 42, endSeconds: 48.5, label: 'Act two', color: '#f472b6', kind: 'review',
        notes: 'Client-approved range', createdAt: 100, updatedAt: 200,
      }],
      editorLockedVisualTracks: [1, 3],
      editorLockedAudioTracks: [2],
      editorCollapsedVisualTracks: [2],
      editorCollapsedAudioTracks: [3],
      editorExportPresetPlan: { presetId: 'prores-mov', notes: 'Master' },
      editorProfessionalWorkflowState: { smartBins: [{ id: 'selects' }] },
    });

    source.editorVisualClips![0].filterStack[0].amount = 99;
    source.editorAssets![0].comicDefaults!.text = 'Mutated';
    workflow.smartBins[0].name = 'Mutated';
    expect(snapshot.editorVisualClips[0].filterStack[0].amount).toBe(20);
    expect(snapshot.editorAssets[0].comicDefaults?.text).toBe('Meanwhile');
    expect(snapshot.editorProfessionalWorkflowState?.smartBins[0].name).toBe('Selects');

    const restored = snapshot.toPatch();
    restored.editorProfessionalWorkflowState!.smartBins[0].name = 'Patch mutation';
    expect(snapshot.editorProfessionalWorkflowState?.smartBins[0].name).toBe('Selects');
  });

  it('treats workflow-only edits as history entries and hard-bounds custom history limits', () => {
    const before = createDefaultEditorProfessionalWorkflowState();
    const after = createDefaultEditorProfessionalWorkflowState();
    after.timebase.sequenceStartTimecode = '01:00:00:00';
    const history = pushEditorHistoryEntry(createEditorHistoryState(Number.POSITIVE_INFINITY), {
      compositionId: 'composition-1',
      label: 'Set sequence timecode',
      before: createEditorHistorySnapshot({ editorProfessionalWorkflowState: before }),
      after: createEditorHistorySnapshot({ editorProfessionalWorkflowState: after }),
    });
    expect(history.limit).toBe(80);
    expect(history.undoStack).toHaveLength(1);
    expect(createEditorHistoryState(999).limit).toBe(EDITOR_HISTORY_ABSOLUTE_LIMIT);
    expect(createEditorHistoryState(0).limit).toBe(1);
  });

  it('also bounds retained snapshot volume for feature-length timelines', () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      compositionId: 'composition-1',
      label: `Edit ${index + 1}`,
      before: createEditorHistorySnapshot({ compositionTimelineSeconds: index + 10 }),
      after: createEditorHistorySnapshot({ compositionTimelineSeconds: index + 11 }),
    }));
    const twoEntryBudget = estimateEditorHistoryEntryCharacters(entries[0]) * 2;
    const history = entries.reduce(
      (current, entry) => pushEditorHistoryEntry(current, entry),
      createEditorHistoryState(EDITOR_HISTORY_ABSOLUTE_LIMIT, twoEntryBudget),
    );

    expect(history.undoStack.map((entry) => entry.label)).toEqual(['Edit 5', 'Edit 6']);
    expect(history.serializedCharacterBudget).toBe(twoEntryBudget);
  });

  it('retains the newest undo transaction when that transaction alone exceeds the snapshot target', () => {
    const entry = {
      compositionId: 'composition-1',
      label: 'Feature-length edit',
      before: createEditorHistorySnapshot({ editorVisualClips: [createVisualClip({ id: 'before' })] }),
      after: createEditorHistorySnapshot({ editorVisualClips: [createVisualClip({ id: 'after' })] }),
    };
    const history = pushEditorHistoryEntry(createEditorHistoryState(80, 1), entry);

    expect(history.undoStack).toEqual([entry]);
    expect(estimateEditorHistoryEntryCharacters(entry)).toBeGreaterThan(history.serializedCharacterBudget);
  });

  it('preserves an exact bundled face through Video history copies', () => {
    const managedFace = {
      kind: 'bundled' as const,
      schemaVersion: 2 as const,
      faceId: 'liberationsans:LiberationSans-Regular:baccc64becc3',
      family: 'Liberation Sans',
      weight: 400,
      style: 'normal' as const,
      stretchPercent: 100,
      collectionIndex: 0,
      sha256: 'baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee',
      byteLength: 410820,
    };
    const source = createVisualClip({
      id: 'managed-title',
      sourceKind: 'text',
      textFontFamily: managedFace.family,
      textTypography: { fontWeight: 400, fontStyle: 'normal', managedFace },
    });
    const snapshot = createEditorHistorySnapshot({ editorVisualClips: [source] });

    source.textTypography!.managedFace!.family = 'mutated source';
    expect(snapshot.editorVisualClips[0].textTypography?.managedFace?.family).toBe('Liberation Sans');
    expect(snapshot.toPatch().editorVisualClips?.[0].textTypography?.managedFace?.family).toBe('Liberation Sans');
  });

  it('undoes and redoes complete timeline marker authoring without losing exchange timestamps', () => {
    const before = createEditorHistorySnapshot({
      editorTimelineMarkers: [{
        id: 'point', seconds: 1.25, label: 'Point', color: '#22d3ee', kind: 'comment',
        notes: 'Before', createdAt: 10, updatedAt: 20,
      }],
    });
    const after = createEditorHistorySnapshot({
      editorTimelineMarkers: [{
        id: 'range', seconds: 3.5, endSeconds: 7.25, label: 'Review', color: '#f472b6', kind: 'review',
        notes: 'After', createdAt: 30, updatedAt: 40,
      }],
    });
    const history = pushEditorHistoryEntry(createEditorHistoryState(), {
      compositionId: 'composition-1',
      before,
      after,
      label: 'Replace timeline markers',
    });

    const undo = undoEditorHistory(history);
    expect(JSON.parse(JSON.stringify(undo.snapshot?.toPatch().editorTimelineMarkers))).toEqual([
      { id: 'point', seconds: 1.25, label: 'Point', color: '#22d3ee', kind: 'comment', notes: 'Before', createdAt: 10, updatedAt: 20 },
    ]);
    const redo = redoEditorHistory(undo.history);
    expect(JSON.parse(JSON.stringify(redo.snapshot?.toPatch().editorTimelineMarkers))).toEqual([
      { id: 'range', seconds: 3.5, endSeconds: 7.25, label: 'Review', color: '#f472b6', kind: 'review', notes: 'After', createdAt: 30, updatedAt: 40 },
    ]);
  });

  it('undoes and redoes clip-relative marker edits without losing ownership or offsets', () => {
    const before = createEditorHistorySnapshot({
      editorVisualClips: [createVisualClip({ id: 'visual-1', startMs: 2_000 })],
      editorTimelineMarkers: [{
        id: 'clip-note', seconds: 4, label: 'Cut note', color: '#fbbf24', kind: 'edit', notes: 'Anchored',
        clipId: 'visual-1', clipOffsetMs: 2_000, createdAt: 10, updatedAt: 20,
      }],
    });
    const after = createEditorHistorySnapshot({
      editorVisualClips: [createVisualClip({ id: 'visual-1', startMs: 9_000 })],
      editorTimelineMarkers: [{
        id: 'clip-note', seconds: 11, label: 'Cut note', color: '#fbbf24', kind: 'edit', notes: 'Anchored',
        clipId: 'visual-1', clipOffsetMs: 2_000, createdAt: 10, updatedAt: 21,
      }],
    });
    const history = pushEditorHistoryEntry(createEditorHistoryState(), {
      compositionId: 'composition-1',
      before,
      after,
      label: 'Move clip with clip marker',
    });

    const undo = undoEditorHistory(history);
    expect(JSON.parse(JSON.stringify(undo.snapshot?.toPatch().editorTimelineMarkers))).toEqual([
      { id: 'clip-note', seconds: 4, label: 'Cut note', color: '#fbbf24', kind: 'edit', notes: 'Anchored', clipId: 'visual-1', clipOffsetMs: 2_000, createdAt: 10, updatedAt: 20 },
    ]);
    expect(JSON.parse(JSON.stringify(undo.snapshot?.toPatch().editorVisualClips?.map((clip) => clip.startMs)))).toEqual([2_000]);

    const redo = redoEditorHistory(undo.history);
    expect(JSON.parse(JSON.stringify(redo.snapshot?.toPatch().editorTimelineMarkers))).toEqual([
      { id: 'clip-note', seconds: 11, label: 'Cut note', color: '#fbbf24', kind: 'edit', notes: 'Anchored', clipId: 'visual-1', clipOffsetMs: 2_000, createdAt: 10, updatedAt: 21 },
    ]);
    expect(JSON.parse(JSON.stringify(redo.snapshot?.toPatch().editorVisualClips?.map((clip) => clip.startMs)))).toEqual([9_000]);
  });

  it('undo/redo and persistence patches round-trip a transcript-applied timeline exactly', () => {
    // Real transcript-applied state: one source clip rippled apart by a transcript edit, with
    // split ids, renamed linked-group ids, and per-fragment source windows exactly as the
    // bounded atomic apply produced them.
    const after = createEditorHistorySnapshot({
      editorVisualClips: [
        createVisualClip({ id: 'visual-source', startMs: 0, sourceInMs: 0, sourceOutMs: 3_000, durationSeconds: 3, professional: { linkGroupId: 'linked-av' } }),
        createVisualClip({
          id: 'visual:visual-source:transcript:0:right',
          startMs: 3_000,
          sourceInMs: 5_000,
          sourceOutMs: 10_000,
          durationSeconds: 5,
          professional: { linkGroupId: 'linked-av::transcript:0:right' },
        }),
      ],
    });
    const before = createEditorHistorySnapshot({
      editorVisualClips: [createVisualClip({ id: 'visual-source', startMs: 0, sourceInMs: 0, sourceOutMs: 10_000, durationSeconds: 10, professional: { linkGroupId: 'linked-av' } })],
    });
    const beforePatch = before.toPatch();
    const afterPatch = after.toPatch();

    // The applied state survives the persisted-patch contract untouched, and re-hydrating the
    // persisted patch (reopen) normalizes to the same state.
    expect(JSON.parse(JSON.stringify(afterPatch.editorVisualClips))).toEqual(
      JSON.parse(JSON.stringify(createEditorHistorySnapshot(afterPatch).toPatch().editorVisualClips)),
    );
    expect(afterPatch.editorVisualClips?.map((clip) => [clip.id, clip.startMs, clip.sourceInMs, clip.sourceOutMs, clip.professional?.linkGroupId])).toEqual([
      ['visual-source', 0, 0, 3_000, 'linked-av'],
      ['visual:visual-source:transcript:0:right', 3_000, 5_000, 10_000, 'linked-av::transcript:0:right'],
    ]);

    const history = pushEditorHistoryEntry(createEditorHistoryState(), {
      compositionId: 'composition-1',
      before,
      after,
      label: 'Remove transcript selection',
    });

    const undo = undoEditorHistory(history);
    expect(JSON.parse(JSON.stringify(undo.snapshot?.toPatch().editorVisualClips))).toEqual(
      JSON.parse(JSON.stringify(beforePatch.editorVisualClips)),
    );

    const redo = redoEditorHistory(undo.history);
    expect(JSON.parse(JSON.stringify(redo.snapshot?.toPatch().editorVisualClips))).toEqual(
      JSON.parse(JSON.stringify(afterPatch.editorVisualClips)),
    );
  });
});
