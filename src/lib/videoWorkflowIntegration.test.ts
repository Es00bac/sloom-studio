import { describe, expect, it } from 'vitest';
import type { EditorAudioClip, EditorVisualClip } from '../types/flow';
import { createEditorAudioClip, createEditorVisualClip } from './manualEditorState';
import type { SourceBinItem } from './sourceBin';
import {
  applyVideoWorkflowBatchProposal,
  applyVideoWorkflowSourceRecordProposal,
  buildVideoWorkflowStructuralQc,
  createDefaultVideoWorkflowDeliveryJob,
  normalizeVideoWorkflowBatch,
  normalizeVideoWorkflowSourceRecord,
  proposeOneFrameVideoWorkflowSlide,
  type VideoWorkflowSourceDurationLookup,
  type VideoWorkflowTrackState,
  videoCompositionPresetCapability,
} from './videoWorkflowIntegration';
import { proposeVideoBatchDuplicate, proposeVideoBatchEnabled, proposeVideoBatchMove } from './videoBatchEditing';
import { proposeSourceRecordLift, proposeSourceRecordReplace } from './videoSourceRecordEditing';

const trackState: VideoWorkflowTrackState = {
  videoTrackCount: 1,
  audioTrackCount: 1,
  armedVideoTrackIndexes: [0],
  armedAudioTrackIndexes: [0],
};

const sources: SourceBinItem[] = [
  { id: 'source-video', nodeId: 'node-video', kind: 'video', label: 'Video', assetUrl: 'blob:video' },
  { id: 'source-audio', nodeId: 'node-audio', kind: 'audio', label: 'Audio', assetUrl: 'blob:audio' },
  { id: 'source-replacement', nodeId: 'node-replacement', kind: 'video', label: 'Replacement', nativeFilePath: '/media/replacement.mov' },
];

const sourceDurationMs: VideoWorkflowSourceDurationLookup = (source) => {
  if (source?.id === 'source-audio') return 20_000;
  return source ? 30_000 : undefined;
};

function visual(overrides: Partial<EditorVisualClip> = {}): EditorVisualClip {
  return {
    ...createEditorVisualClip('node-video', 'video', {
      sourceInMs: 0,
      sourceOutMs: 4_000,
      durationSeconds: 4,
      playbackRate: 1,
    }),
    id: 'visual-1',
    ...overrides,
  };
}

function audio(overrides: Partial<EditorAudioClip> = {}): EditorAudioClip {
  return {
    ...createEditorAudioClip('node-audio', 0, { sourceInMs: 0, sourceOutMs: 4_000 }),
    id: 'audio-1',
    ...overrides,
  };
}

describe('video workflow integration adapters', () => {
  it('applies batch proposals without dropping clip fields or linked groups', () => {
    const original = visual({
      filterStack: [{ id: 'filter-1', kind: 'brightness', enabled: true, amount: 18 }],
      professional: { linkGroupId: 'av-link', chromaKeyMode: 'green' },
    });
    const originalAudio = audio({
      professional: { linkGroupId: 'av-link', pan: -0.25 },
      audioProcessing: { ...audio().audioProcessing!, limiterEnabled: true },
    });
    const normalized = normalizeVideoWorkflowBatch({
      visualClips: [original], audioClips: [originalAudio], trackState,
      sourceItems: sources, sourceDurationMs,
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const moved = proposeVideoBatchMove(normalized.value.clips, normalized.value.tracks, ['visual-1'], {
      deltaMs: 1_000,
      includeLinked: true,
    });
    const applied = applyVideoWorkflowBatchProposal(normalized.value, moved);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.visualClips[0]).toMatchObject({
      startMs: 1_000,
      filterStack: original.filterStack,
      professional: { linkGroupId: 'av-link', chromaKeyMode: 'green' },
    });
    expect(applied.value.audioClips[0]).toMatchObject({
      offsetMs: 1_000,
      professional: { linkGroupId: 'av-link', pan: -0.25 },
      audioProcessing: originalAudio.audioProcessing,
    });

    const duplicated = proposeVideoBatchDuplicate(normalized.value.clips, normalized.value.tracks, ['visual-1'], {
      deltaMs: 5_000,
      includeLinked: true,
      createId: (clip) => `${clip.id}-copy`,
      createLinkGroupId: () => 'av-link-copy',
    });
    const duplicateApplied = applyVideoWorkflowBatchProposal(normalized.value, duplicated);
    expect(duplicateApplied.ok).toBe(true);
    if (duplicateApplied.ok) {
      expect(duplicateApplied.value.createdClipIds).toEqual(['visual-1-copy', 'audio-1-copy']);
      expect(duplicateApplied.value.visualClips[1].filterStack).toEqual(original.filterStack);
      expect(duplicateApplied.value.visualClips[1].professional?.linkGroupId).toBe('av-link-copy');
      expect(duplicateApplied.value.audioClips[1].professional?.linkGroupId).toBe('av-link-copy');
    }
  });

  it('rejects a visual enabled proposal because EditorVisualClip cannot represent it', () => {
    const normalized = normalizeVideoWorkflowBatch({
      visualClips: [visual()], audioClips: [], trackState, sourceItems: sources, sourceDurationMs,
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const proposal = proposeVideoBatchEnabled(normalized.value.clips, normalized.value.tracks, ['visual-1'], false, false);
    expect(applyVideoWorkflowBatchProposal(normalized.value, proposal)).toEqual({
      ok: false,
      reason: 'visual-enabled-not-representable',
    });
  });

  it('applies source/record splits and replacements while retaining originals and requiring templates for new media', () => {
    const original = visual({
      sourceOutMs: 10_000,
      durationSeconds: 10,
      professional: { linkGroupId: 'linked', chromaKeyMode: 'blue' },
      opacityPercent: 72,
    });
    const normalized = normalizeVideoWorkflowSourceRecord({
      visualClips: [original], audioClips: [], trackState, sourceItems: sources, sourceDurationMs,
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const lifted = proposeSourceRecordLift(normalized.value.clips, normalized.value.tracks, {
      inMs: 3_000,
      outMs: 5_000,
    }, { targetTrackIds: ['legacy-video-1'], createId: () => 'visual-right' });
    const applied = applyVideoWorkflowSourceRecordProposal(normalized.value, lifted);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.value.visualClips.map((clip) => [clip.id, clip.startMs, clip.durationSeconds])).toEqual([
        ['visual-1', 0, 3],
        ['visual-right', 5_000, 5],
      ]);
      expect(applied.value.visualClips.every((clip) => clip.opacityPercent === 72)).toBe(true);
      expect(applied.value.visualClips.every((clip) => clip.professional?.chromaKeyMode === 'blue')).toBe(true);
      expect(applied.value.visualClips[1].professional?.linkGroupId).toMatch(/^linked-right/);
    }

    const replacement = proposeSourceRecordReplace(normalized.value.clips, normalized.value.tracks, 12_000, [{
      targetTrackId: 'legacy-video-1',
      sourceId: 'source-replacement',
      sourceInMs: 1_000,
      durationMs: 2_000,
      sourceDurationMs: 30_000,
      createId: 'replacement-clip',
    }]);
    expect(applyVideoWorkflowSourceRecordProposal(normalized.value, replacement)).toEqual({
      ok: false,
      reason: 'missing-created-clip-template',
    });
    const withTemplate = applyVideoWorkflowSourceRecordProposal(normalized.value, replacement, {
      visualBySourceId: { 'source-replacement': visual({ id: 'template', opacityPercent: 55 }) },
    });
    expect(withTemplate.ok).toBe(true);
    if (withTemplate.ok) {
      expect(withTemplate.value.visualClips.at(-1)).toMatchObject({
        id: 'replacement-clip', sourceNodeId: 'node-replacement', startMs: 12_000,
        sourceInMs: 1_000, sourceOutMs: 3_000, opacityPercent: 55,
      });
    }
  });

  it('constructs and applies an exact one-frame slide between contiguous clips', () => {
    const clips = [
      visual({ id: 'left', startMs: 0, sourceInMs: 0, sourceOutMs: 4_000 }),
      visual({ id: 'selected', startMs: 4_000, sourceInMs: 4_000, sourceOutMs: 8_000, professional: { linkGroupId: 'selected-link' } }),
      visual({ id: 'right', startMs: 8_000, sourceInMs: 8_000, sourceOutMs: 12_000 }),
    ];
    const result = proposeOneFrameVideoWorkflowSlide({
      visualClips: clips,
      audioClips: [],
      trackState,
      sourceItems: sources,
      sourceDurationMs,
      selectedVisualClipId: 'selected',
      direction: 1,
      framesPerSecond: 25,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appliedDeltaMs).toBe(40);
    expect(result.value.visualClips.map((clip) => [clip.id, clip.startMs, clip.durationSeconds, clip.sourceInMs])).toEqual([
      ['left', 0, 4.04, 0],
      ['selected', 4_040, 4, 4_000],
      ['right', 8_040, 3.96, 8_040],
    ]);
    expect(result.value.visualClips[1].professional?.linkGroupId).toBe('selected-link');
  });

  it('builds structural-only QC with navigable source, clip, caption, cache, and feature issues', () => {
    const offlineSources: SourceBinItem[] = [
      { ...sources[0], assetUrl: undefined, durability: 'unavailable', professional: { version: 1, origin: 'imported', onlineState: 'offline' } },
    ];
    const report = buildVideoWorkflowStructuralQc({
      visualClips: [
        visual({ id: 'clip-a', sourceOutMs: 5_000, durationSeconds: 5 }),
        visual({ id: 'clip-b', startMs: 4_000, sourceInMs: 5_000, sourceOutMs: 9_000, durationSeconds: 4 }),
      ],
      audioClips: [],
      trackState,
      sourceItems: offlineSources,
      sourceDurationMs,
      framesPerSecond: 25,
      compositionSignature: 'composition-v2',
      renderCacheSignature: 'composition-v1',
      clipFeatureStatus: { 'clip-a': { setupOnly: ['Optical-flow render'] } },
      captionTracks: [{
        id: 'captions-en', name: 'English', language: 'en', service: 'captions',
        style: { fontFamily: 'Inter', fontSizePx: 48, textColor: '#fff', backgroundOpacityPercent: 0, safeAreaPercent: 5 },
        cues: [{ id: 'cue-1', startMs: 1_000, endMs: 1_100, text: 'This caption is deliberately much too fast to read.' }],
      }],
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.scope).toBe('structural-only');
    expect(report.value.disclaimer).toMatch(/media was not decoded/i);
    expect(report.value.issues.find((issue) => issue.code === 'offline-source')?.navigation).toEqual({ sourceId: 'source-video' });
    expect(report.value.issues.find((issue) => issue.code === 'track-overlap')?.navigation?.clipId).toBe('clip-b');
    expect(report.value.issues.find((issue) => issue.code === 'caption-reading-speed')?.navigation?.captionId).toBe('cue-1');
    expect(report.value.issues.some((issue) => issue.code === 'stale-render-cache')).toBe(true);
    expect(report.value.issues.find((issue) => issue.code === 'setup-only-feature')?.navigation?.clipId).toBe('clip-a');
  });

  it('does not report projected semantic caption graphics as missing media sources', () => {
    const captionGraphic = visual({
      id: 'caption-cue-1',
      sourceNodeId: 'caption-document:captions-en',
      sourceKind: 'text',
      textContent: 'Opening title',
      sourceOutMs: 2_000,
      durationSeconds: 2,
    });
    const report = buildVideoWorkflowStructuralQc({
      visualClips: [captionGraphic],
      audioClips: [],
      trackState,
      sourceItems: [],
      sourceDurationMs,
      framesPerSecond: 24,
      captionTracks: [{
        id: 'captions-en', name: 'English', language: 'en', service: 'captions',
        style: { fontFamily: 'Inter', fontSizePx: 48, textColor: '#fff', backgroundOpacityPercent: 0, safeAreaPercent: 10 },
        cues: [{ id: 'cue-1', startMs: 0, endMs: 2_000, text: 'Opening title' }],
      }],
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.issues.some((issue) => issue.code === 'missing-clip-source-id')).toBe(false);
    expect(report.value.issues.some((issue) => issue.code === 'missing-clip-source')).toBe(false);
  });

  it('creates an immutable capability-gated default delivery job with truthful browser durability', () => {
    const job = createDefaultVideoWorkflowDeliveryJob({
      jobId: 'delivery-1',
      createdAt: '2026-08-16T18:30:00.000Z',
      projectName: 'Feature Film',
      composition: {
        compositionId: 'sequence-1',
        compositionName: 'Picture Lock',
        compositionSignature: 'sha256:frozen-composition',
        revision: 'r12',
      },
      host: {
        native: { available: true, capabilities: [] },
        browser: { available: true, capabilities: ['encode:h264', 'mux:mp4'] },
      },
      existingFileNames: ['Feature Film-Picture Lock-Review-2026-08-16.mp4'],
    });
    expect(job.frozenCompositionSignature).toBe('sha256:frozen-composition');
    expect(job.outputs[0]).toMatchObject({
      target: 'browser',
      status: 'queued',
      executionDurability: 'browser-session-only',
      fileName: 'Feature Film-Picture Lock-Review-2026-08-16-2.mp4',
    });
    expect(job.outputs[1]).toMatchObject({ status: 'blocked', executionDurability: 'blocked' });
    expect(job.manifestIntent).toEqual({
      format: 'sloom-video-delivery-manifest-v1',
      includeFrozenCompositionSignature: true,
      includeOutputChecksums: true,
    });
    expect(Object.isFrozen(job)).toBe(true);
    expect(Object.isFrozen(job.outputs)).toBe(true);
  });

  it('plans exactly the enabled outputs in a persisted editor delivery profile', () => {
    const job = createDefaultVideoWorkflowDeliveryJob({
      jobId: 'delivery-profile',
      createdAt: '2026-08-16T18:30:00.000Z',
      projectName: 'Feature Film',
      composition: { compositionId: 'sequence-1', compositionName: 'Picture Lock', compositionSignature: 'sha256:frozen' },
      host: {
        native: { available: false, capabilities: [] },
        browser: {
          available: true,
          capabilities: [videoCompositionPresetCapability('review-h264-1080p'), 'export:structural-qc-json'],
        },
      },
      profile: {
        id: 'standard-delivery',
        name: 'Standard delivery',
        targets: [
          { id: 'review', kind: 'review-video', presetId: 'review-h264-1080p', fileNameTemplate: '{project}-{sequence}-review', enabled: true },
          { id: 'captions', kind: 'captions', fileNameTemplate: '{project}-{language}', enabled: false },
          { id: 'qc', kind: 'qc-report', fileNameTemplate: '{project}-{sequence}-qc', enabled: true },
        ],
      },
    });

    expect(job.profileId).toBe('standard-delivery');
    expect(job.outputs.map((output) => [output.id, output.fileName, output.status])).toEqual([
      ['review', 'Feature Film-Picture Lock-review.mp4', 'queued'],
      ['qc', 'Feature Film-Picture Lock-qc.json', 'queued'],
    ]);
  });

  it('blocks a video deliverable whose export preset is not the one the sequence is set to', () => {
    const plan = (targetPresetId: string | undefined) => createDefaultVideoWorkflowDeliveryJob({
      jobId: 'delivery-preset',
      createdAt: '2026-08-16T18:30:00.000Z',
      projectName: 'Feature Film',
      composition: { compositionId: 'sequence-1', compositionName: 'Picture Lock', compositionSignature: 'sha256:frozen' },
      // The sequence is currently set to ProRes, so only a ProRes deliverable can honestly be made.
      host: {
        native: { available: true, capabilities: [videoCompositionPresetCapability('prores-mov')] },
        browser: { available: true, capabilities: [videoCompositionPresetCapability('prores-mov')] },
      },
      profile: {
        id: 'standard-delivery',
        name: 'Standard delivery',
        targets: [{ id: 'review', kind: 'review-video', presetId: targetPresetId, fileNameTemplate: '{project}-review', enabled: true }],
      },
    });

    const mismatched = plan('review-h264-1080p').outputs[0];
    expect(mismatched.status).toBe('blocked');
    expect(mismatched.missingCapabilities).toEqual([videoCompositionPresetCapability('review-h264-1080p')]);

    expect(plan('prores-mov').outputs[0].status).toBe('queued');
    // A target with no preset at all cannot be honestly rendered under its declared codec.
    expect(plan(undefined).outputs[0].status).toBe('blocked');
  });
});
