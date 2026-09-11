import { describe, expect, it } from 'vitest';
import type { AppNode } from '../types/flow';
import { DEFAULT_EDITOR_AUDIO_PROCESSING } from './editorAudioProcessing';
import { MAX_TIMELINE_MARKERS, MAX_TIMELINE_MARKER_SECONDS } from './editorTimelineMarkers';
import {
  MAX_VIDEO_TIMELINE_SYNC_CLIPS_PER_KIND,
  MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES,
  MAX_VIDEO_TIMELINE_SYNC_MARKERS,
  VIDEO_TIMELINE_DATA_KEYS,
  createVideoTimelineCompositionUpdatedChange,
  createVideoTimelineWorkspaceSnapshot,
  describeVideoTimelineCompositionSyncReadiness,
  extractVideoTimelineData,
  isVideoTimelineNativeChange,
  stripVideoOwnedCompositionData,
} from './videoTimelineNativeSync';

function composition(data: AppNode['data'] = {}): AppNode {
  return {
    id: 'composition-1',
    type: 'composition',
    position: { x: 0, y: 0 },
    data: { nodeInstanceId: 'instance-1', ...data },
  } as AppNode;
}

describe('videoTimelineNativeSync', () => {
  it('carries complete authored timeline identity/state without render URLs or media bytes', () => {
    const node = composition({
      aspectRatio: '16:9',
      videoResolution: '1080p',
      videoFrameRate: 30,
      compositionTimelineSeconds: 42,
      editorVisualClips: [{
        id: 'clip-1', sourceNodeId: 'phone-video-source', sourceKind: 'video', trackIndex: 0,
        startMs: 250, sourceInMs: 500, trimStartMs: 0, trimEndMs: 0, playbackRate: 1,
        reversePlayback: false, fitMode: 'cover', scalePercent: 100, scaleMotionEnabled: false,
        endScalePercent: 100, opacityPercent: 100, opacityAutomationPoints: [], rotationDeg: 0,
        rotationMotionEnabled: false, endRotationDeg: 0, flipHorizontal: false, flipVertical: false,
        positionX: 0, positionY: 0, motionEnabled: false, endPositionX: 0, endPositionY: 0,
        cropLeftPercent: 0, cropRightPercent: 0, cropTopPercent: 0, cropBottomPercent: 0,
        cropPanXPercent: 0, cropPanYPercent: 0, cropRotationDeg: 0, filterStack: [],
        blendMode: 'normal', chromaKey: { enabled: false, color: '#00ff00', similarityPercent: 30, blendPercent: 10 },
        stroke: { enabled: false, color: '#ffffff', widthPx: 0, opacityPercent: 100 },
        transitionIn: 'none', transitionOut: 'none', transitionDurationMs: 500,
        textFontFamily: 'Inter', textSizePx: 64, textColor: '#ffffff', textEffect: 'none',
        textBackgroundOpacityPercent: 0,
      }],
      editorAudioClips: [{ id: 'audio-1', sourceNodeId: 'phone-audio-source', offsetMs: 0, sourceInMs: 250, sourceOutMs: 2_750, trackIndex: 0, volumePercent: 100, volumeAutomationPoints: [], measuredMatchGainDb: 1.5, loudnessReferenceSourceNodeId: 'phone-original-source', audioProcessing: { ...DEFAULT_EDITOR_AUDIO_PROCESSING, highPassEnabled: true, highPassHz: 80 }, fadeInSeconds: 0.5, fadeOutSeconds: 1, enabled: true }],
      editorMutedAudioTracks: [1],
      editorSoloAudioTracks: [2],
      editorAssets: [{ id: 'title', kind: 'text', label: 'Title', createdAt: 1, updatedAt: 1 }],
      editorTimelineMarkers: [{
        id: 'mark-1', seconds: 1.25, endSeconds: 2.75, label: 'Cut', color: '#22d3ee', kind: 'review',
        notes: 'Client range', createdAt: 100, updatedAt: 200,
      }],
      editorLockedVisualTracks: [2],
      editorCollapsedAudioTracks: [1],
      editorExportPresetPlan: { presetId: 'review-h264-1080p', notes: 'client review' },
      result: 'blob:https://phone.invalid/render',
      editorRenderCacheSegmentArtifacts: {
        unsafe: { key: 'unsafe', signature: 'local', url: 'blob:https://phone.invalid/cache', startMs: 0, endMs: 1 },
      },
    });

    const change = createVideoTimelineCompositionUpdatedChange(node, 'workspace-1')!;
    expect(isVideoTimelineNativeChange(change)).toBe(true);
    expect(change.composition).toMatchObject({
      compositionId: 'composition-1',
      nodeInstanceId: 'instance-1',
      data: {
        compositionTimelineSeconds: 42,
        editorVisualClips: [expect.objectContaining({ sourceNodeId: 'phone-video-source' })],
        editorAudioClips: [expect.objectContaining({ sourceNodeId: 'phone-audio-source', sourceInMs: 250, sourceOutMs: 2_750, measuredMatchGainDb: 1.5, loudnessReferenceSourceNodeId: 'phone-original-source', audioProcessing: expect.objectContaining({ highPassEnabled: true, highPassHz: 80 }), fadeInSeconds: 0.5, fadeOutSeconds: 1 })],
        editorMutedAudioTracks: [1],
        editorSoloAudioTracks: [2],
        editorTimelineMarkers: [{
          id: 'mark-1', seconds: 1.25, endSeconds: 2.75, label: 'Cut', color: '#22d3ee', kind: 'review',
          notes: 'Client range', createdAt: 100, updatedAt: 200,
        }],
      },
    });
    expect(JSON.stringify(change)).not.toContain('blob:');
    expect(Object.keys(change.composition.data).every((key) => VIDEO_TIMELINE_DATA_KEYS.includes(key as never))).toBe(true);
  });

  it('strips Video-owned and device-local render fields from incremental Flow patches', () => {
    const projected = stripVideoOwnedCompositionData(composition({
      customTitle: 'Sequence A',
      editorVisualClips: [],
      inputRevision: 'local-revision',
      result: 'blob:local-render',
    }).data);
    expect(projected.customTitle).toBe('Sequence A');
    expect(projected.editorVisualClips).toBeUndefined();
    expect(projected.inputRevision).toBeUndefined();
    expect(projected.result).toBeUndefined();
  });

  it('rejects unknown fields, stale schema versions, excessive clip counts, and excessive text', () => {
    const valid = createVideoTimelineWorkspaceSnapshot([composition({ editorVisualClips: [] })], 'workspace-1');
    expect(valid.type).toBe('video-timeline-workspace-snapshot');
    if (valid.type !== 'video-timeline-workspace-snapshot') throw new Error('unexpected unavailable fixture');
    expect(isVideoTimelineNativeChange(valid)).toBe(true);
    expect(isVideoTimelineNativeChange({ ...valid, schemaVersion: 99 })).toBe(false);
    expect(isVideoTimelineNativeChange({
      ...valid,
      compositions: [{ ...valid.compositions[0], data: { secretAssetUrl: 'file:///private/video.mp4' } }],
    })).toBe(false);
    expect(isVideoTimelineNativeChange({
      ...valid,
      compositions: [{
        ...valid.compositions[0],
        data: { editorVisualClips: Array.from({ length: MAX_VIDEO_TIMELINE_SYNC_CLIPS_PER_KIND + 1 }, () => ({})) },
      }],
    })).toBe(false);
    expect(isVideoTimelineNativeChange({
      ...valid,
      compositions: [{ ...valid.compositions[0], data: { editorAssets: [{ label: 'x'.repeat(70_000) }] } }],
    })).toBe(false);
  });

  it('shares the 20k marker capacity and rejects marker times outside the finite project bound', () => {
    expect(MAX_VIDEO_TIMELINE_SYNC_MARKERS).toBe(MAX_TIMELINE_MARKERS);
    const formerlyOverflowingMarkers = Array.from({ length: 1_001 }, (_, index) => ({
      id: `marker-${index}`,
      seconds: index / 1_000,
      label: `M${index}`,
      color: '#22d3ee',
      kind: 'comment' as const,
      createdAt: index,
      updatedAt: index,
    }));
    const accepted = createVideoTimelineCompositionUpdatedChange(
      composition({ editorTimelineMarkers: formerlyOverflowingMarkers }),
      'workspace-1',
    );
    expect(accepted?.composition.data.editorTimelineMarkers).toHaveLength(1_001);

    for (const seconds of [-0.001, MAX_TIMELINE_MARKER_SECONDS + 0.001, Number.POSITIVE_INFINITY]) {
      expect(createVideoTimelineCompositionUpdatedChange(composition({
        editorTimelineMarkers: [{ id: 'invalid', seconds, label: 'Invalid', color: '#22d3ee' }],
      }), 'workspace-1')).toBeNull();
    }
  });

  it('reports when a count-valid 20k marker set exceeds the independent per-edit byte budget', () => {
    const fullCapacityMarkers = Array.from({ length: MAX_VIDEO_TIMELINE_SYNC_MARKERS }, (_, index) => ({
      id: `marker-${index}`,
      seconds: index / 1_000,
      label: `Marker ${index}`,
      color: '#22d3ee',
      kind: 'comment' as const,
      createdAt: index,
      updatedAt: index,
    }));
    const markerHeavyComposition = composition({ editorTimelineMarkers: fullCapacityMarkers });
    const readiness = describeVideoTimelineCompositionSyncReadiness(markerHeavyComposition, 'workspace-1');

    expect(readiness).toMatchObject({
      status: 'unavailable',
      reason: 'payload-too-large',
      maximumBytes: MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES,
    });
    expect(readiness.encodedBytes).toBeGreaterThan(MAX_VIDEO_TIMELINE_SYNC_JSON_BYTES);
    expect(readiness.message).toContain('Native timeline sync is unavailable');
    expect(readiness.message).toContain('Local project save remains available');
    expect(createVideoTimelineCompositionUpdatedChange(markerHeavyComposition, 'workspace-1')).toBeNull();
  });

  it('returns an independent JSON snapshot rather than aliases into the live node', () => {
    const node = composition({ editorTimelineSnapPoints: [1, 2] });
    const extracted = extractVideoTimelineData(node.data);
    (node.data.editorTimelineSnapPoints as number[]).push(3);
    expect(extracted.editorTimelineSnapPoints).toEqual([1, 2]);
  });

  it('uses separate mutation and workspace bounds and fails oversized seeds closed without throwing', () => {
    const assets = (count: number, labelLength: number) => Array.from({ length: count }, (_, index) => ({
      id: `asset-${index}`,
      kind: 'text' as const,
      label: 'x'.repeat(labelLength),
      createdAt: index,
      updatedAt: index,
    }));

    const mutationTooLarge = composition({ editorAssets: assets(1_000, 1_600) });
    expect(createVideoTimelineCompositionUpdatedChange(mutationTooLarge, 'workspace-1')).toBeNull();
    expect(createVideoTimelineWorkspaceSnapshot([mutationTooLarge], 'workspace-1')).toMatchObject({
      type: 'video-timeline-sync-unavailable',
      reason: 'payload-too-large',
    });

    const second = { ...composition({ editorAssets: assets(1_000, 800) }), id: 'composition-2' } as AppNode;
    const workspace = createVideoTimelineWorkspaceSnapshot([
      { ...composition({ editorAssets: assets(1_000, 800) }), id: 'composition-1' } as AppNode,
      second,
    ], 'workspace-1');
    expect(workspace.type).toBe('video-timeline-workspace-snapshot');

    const unavailable = createVideoTimelineWorkspaceSnapshot([
      composition({ editorAssets: assets(1_000, 9_000) }),
    ], 'workspace-1');
    expect(unavailable).toMatchObject({
      type: 'video-timeline-sync-unavailable',
      reason: 'payload-too-large',
    });
  });
});
