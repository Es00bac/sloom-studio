import { afterEach, describe, expect, it } from 'vitest';
import type { AppNode } from '../types/flow';
import { buildExecutionContextForNode } from './flowStore';
import { useSourceBinStore } from './sourceBinStore';

afterEach(() => {
  useSourceBinStore.setState({
    bins: [{ id: 'default', name: 'Source Library', items: [], collapsed: false, createdAt: 1 }],
    dismissedSourceKeys: [],
    nativeScratchDirectoryPath: undefined,
  });
});

describe('relinked media playback and export context', () => {
  it('feeds persisted multicam cuts into the authoritative sequence-export context and refuses missing angles', () => {
    const composition = {
      id: 'composition-multicam', type: 'composition', position: { x: 0, y: 0 }, data: {
        editorVisualClips: [{
          id: 'host', sourceNodeId: 'camera-a', sourceKind: 'video', trackIndex: 0, startMs: 0,
          sourceInMs: 0, sourceOutMs: 4_000, durationSeconds: 4, playbackRate: 1,
          professional: { multicamSourceId: 'multi-1' },
        }],
        editorProfessionalState: {
          multicamSources: [{
            id: 'multi-1', name: 'Interview', angleSourceIds: ['camera-a', 'camera-b'], activeAngleId: 'camera-a', syncMethod: 'manual', audioFollowsVideo: false,
            cuts: [{ id: 'opening', timelineMs: 0, angleSourceId: 'camera-a' }, { id: 'reaction', timelineMs: 1_000, angleSourceId: 'camera-b' }],
          }],
        },
      },
    } as AppNode;
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 1, items: [
        { id: 'camera-a', label: 'A.mov', kind: 'video', assetUrl: 'signal-loom-asset://asset/camera-a', createdAt: 1 },
        { id: 'camera-b', label: 'B.mov', kind: 'video', assetUrl: 'signal-loom-asset://asset/camera-b', createdAt: 1 },
      ] }], dismissedSourceKeys: [],
    });
    expect(buildExecutionContextForNode(composition, [composition], []).visualSequenceClips).toMatchObject([
      { sourceNodeId: 'camera-a', startMs: 0, sourceOutMs: 1_000 },
      { sourceNodeId: 'camera-b', startMs: 1_000, sourceInMs: 1_000, sourceOutMs: 4_000 },
    ]);
    useSourceBinStore.setState((state) => ({ bins: state.bins.map((bin) => ({ ...bin, items: bin.items.filter((item) => item.id !== 'camera-b') })) }));
    expect(() => buildExecutionContextForNode(composition, [composition], [])).toThrow('Video export refused');
  });

  it('carries the saved final-mix loudness opt-in into the composition render context', () => {
    const loudnessNormalization = { enabled: true, targetLufs: -16, loudnessRangeLu: 8, truePeakCeilingDbtp: -1 };
    const composition = {
      id: 'composition-loudness', type: 'composition', position: { x: 0, y: 0 },
      data: { editorProfessionalState: {
        version: 1, proxyPlaybackEnabled: true, tracks: [], sequences: [], multicamSources: [], audioBuses: [],
        loudnessNormalization, workingColorSpace: 'rec709', toneMapping: 'none', adjustmentLayerClipIds: [], transcriptRemovedCueIds: [], interchangeHistory: [],
      } },
    } as AppNode;

    expect(buildExecutionContextForNode(composition, [composition], []).sequenceLoudnessNormalization).toEqual(loudnessNormalization);
  });

  it('expands a persisted nested timeline into the same execution context consumed by both render backends', () => {
    const composition = {
      id: 'composition-nested',
      type: 'composition',
      position: { x: 0, y: 0 },
      data: {
        editorVisualClips: [{
          id: 'nested-reference', sourceNodeId: 'reference-marker', sourceKind: 'image',
          trackIndex: 1, startMs: 1_000, sourceInMs: 0, sourceOutMs: 3_000, durationSeconds: 3,
          professional: { nestedSequenceId: 'nested-title' },
        }],
        editorProfessionalState: {
          version: 1,
          proxyPlaybackEnabled: true,
          tracks: [], multicamSources: [], audioBuses: [], workingColorSpace: 'rec709', toneMapping: 'none',
          adjustmentLayerClipIds: [], transcriptRemovedCueIds: [], interchangeHistory: [],
          sequences: [{
            id: 'nested-title', name: 'Nested title', durationMs: 3_000, frameRate: 24,
            visualClips: [{ id: 'nested-child', sourceNodeId: 'title-card', sourceKind: 'image', trackIndex: 0, startMs: 250, durationSeconds: 2 }],
          }],
        },
      },
    } as unknown as AppNode;
    useSourceBinStore.setState({
      bins: [{
        id: 'default', name: 'Source Library', collapsed: false, createdAt: 1,
        items: [{ id: 'title-card', label: 'Title card', kind: 'image', assetUrl: 'data:image/png;base64,UE5H', createdAt: 1 }],
      }],
      dismissedSourceKeys: [],
    });

    const context = buildExecutionContextForNode(composition, [composition], []);

    expect(context.videoRuntimeError).toBeUndefined();
    expect(context.visualSequenceClips).toEqual([
      expect.objectContaining({
        id: 'nested-reference::nested-child', sourceNodeId: 'title-card', startMs: 1_250, runtimeRole: 'media',
      }),
    ]);
  });

  it('expands nested clips before preserving their current multicam cuts for export', () => {
    const composition = {
      id: 'composition-nested-multicam', type: 'composition', position: { x: 0, y: 0 }, data: {
        editorVisualClips: [{
          id: 'nested-reference', sourceNodeId: 'reference-marker', sourceKind: 'image', trackIndex: 0,
          startMs: 1_000, sourceInMs: 0, sourceOutMs: 3_000, durationSeconds: 3,
          professional: { nestedSequenceId: 'nested-cameras' },
        }],
        editorProfessionalState: {
          sequences: [{
            id: 'nested-cameras', name: 'Nested cameras', durationMs: 3_000, frameRate: 24,
            visualClips: [{
              id: 'camera-host', sourceNodeId: 'camera-a', sourceKind: 'video', trackIndex: 0,
              startMs: 0, sourceInMs: 0, sourceOutMs: 3_000, durationSeconds: 3, playbackRate: 1,
              professional: { multicamSourceId: 'interview' },
            }],
          }],
          multicamSources: [{
            id: 'interview', name: 'Interview', angleSourceIds: ['camera-a', 'camera-b'], activeAngleId: 'camera-a',
            syncMethod: 'manual', audioFollowsVideo: false,
            cuts: [{ id: 'opening', timelineMs: 0, angleSourceId: 'camera-a' }, { id: 'reaction', timelineMs: 1_000, angleSourceId: 'camera-b' }],
          }],
        },
      },
    } as unknown as AppNode;
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 1, items: [
        { id: 'camera-a', label: 'A.mov', kind: 'video', assetUrl: 'signal-loom-asset://asset/camera-a', createdAt: 1 },
        { id: 'camera-b', label: 'B.mov', kind: 'video', assetUrl: 'signal-loom-asset://asset/camera-b', createdAt: 1 },
      ] }], dismissedSourceKeys: [],
    });

    const context = buildExecutionContextForNode(composition, [composition], []);

    expect(context.videoRuntimeError).toBeUndefined();
    expect(context.visualSequenceClips).toMatchObject([
      { id: 'nested-reference::camera-host:multicam:opening', sourceNodeId: 'camera-a', startMs: 1_000, sourceOutMs: 1_000 },
      { id: 'nested-reference::camera-host:multicam:reaction', sourceNodeId: 'camera-b', startMs: 2_000, sourceInMs: 1_000, sourceOutMs: 3_000 },
    ]);
  });

  it('keeps a malformed nested plan out of render execution instead of falling back to root descriptor clips', () => {
    const composition = {
      id: 'composition-invalid-nested', type: 'composition', position: { x: 0, y: 0 },
      data: {
        editorVisualClips: [{
          id: 'cycle-reference', sourceNodeId: 'marker', sourceKind: 'image', trackIndex: 0, startMs: 0,
          professional: { nestedSequenceId: 'cycle-a' },
        }],
        editorProfessionalState: {
          version: 1, proxyPlaybackEnabled: true, tracks: [], multicamSources: [], audioBuses: [],
          workingColorSpace: 'rec709', toneMapping: 'none', adjustmentLayerClipIds: [], transcriptRemovedCueIds: [], interchangeHistory: [],
          sequences: [{
            id: 'cycle-a', name: 'Cycle A', durationMs: 4_000, frameRate: 24,
            visualClips: [{ id: 'cycle-child', sourceNodeId: 'marker', sourceKind: 'image', trackIndex: 0, startMs: 0, professional: { nestedSequenceId: 'cycle-a' } }],
          }],
        },
      },
    } as unknown as AppNode;

    const context = buildExecutionContextForNode(composition, [composition], []);

    expect(context.visualSequenceClips).toEqual([]);
    expect(context.videoRuntimeError).toContain('cycle refused');
  });

  it('refuses a retained nested child whose source has become unavailable instead of silently dropping it', () => {
    const composition = {
      id: 'composition-missing-nested-source', type: 'composition', position: { x: 0, y: 0 },
      data: {
        editorVisualClips: [{
          id: 'nested-reference', sourceNodeId: 'reference-marker', sourceKind: 'image', trackIndex: 0,
          startMs: 0, sourceInMs: 0, sourceOutMs: 2_000, durationSeconds: 2,
          professional: { nestedSequenceId: 'missing-source-sequence' },
        }],
        editorProfessionalState: {
          version: 1, proxyPlaybackEnabled: true, tracks: [], multicamSources: [], audioBuses: [],
          workingColorSpace: 'rec709', toneMapping: 'none', adjustmentLayerClipIds: [], transcriptRemovedCueIds: [], interchangeHistory: [],
          sequences: [{
            id: 'missing-source-sequence', name: 'Missing source', durationMs: 2_000, frameRate: 24,
            visualClips: [{ id: 'missing-child', sourceNodeId: 'deleted-source', sourceKind: 'image', trackIndex: 0, startMs: 0, durationSeconds: 2 }],
          }],
        },
      },
    } as unknown as AppNode;

    const context = buildExecutionContextForNode(composition, [composition], []);

    expect(context.visualSequenceClips).toEqual([]);
    expect(context.videoRuntimeError).toContain("references unavailable source 'deleted-source'");
  });

  it('resolves stable timeline identities through the latest Source Library native path', () => {
    const composition = {
      id: 'composition-1',
      type: 'composition',
      position: { x: 0, y: 0 },
      data: {
        editorVisualClips: [{
          id: 'visual-camera-a',
          sourceNodeId: 'camera-a',
          sourceKind: 'video',
          trackIndex: 0,
          startMs: 0,
          durationSeconds: 2,
        }],
        editorAudioClips: [{
          id: 'audio-camera-a',
          sourceNodeId: 'camera-a',
          trackIndex: 0,
          offsetMs: 0,
          volumePercent: 100,
          enabled: true,
        }],
      },
    } as AppNode;
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: 1,
        items: [{
          id: 'camera-a',
          label: 'A001.mov',
          kind: 'video',
          mimeType: 'video/quicktime',
          assetUrl: 'signal-loom-asset://asset/camera-a',
          nativeFilePath: '/old/card/A001.mov',
          createdAt: 1,
        }],
      }],
      dismissedSourceKeys: [],
    });

    const original = buildExecutionContextForNode(composition, [composition], []);
    expect(original.visualSequenceClips?.[0].nativeFilePath).toBe('/old/card/A001.mov');
    expect(original.sequenceAudioInputs?.[0].nativeFilePath).toBe('/old/card/A001.mov');

    useSourceBinStore.setState((state) => ({
      bins: state.bins.map((bin) => ({
        ...bin,
        items: bin.items.map((item) => item.id === 'camera-a' ? {
          ...item,
          assetUrl: 'signal-loom-asset://asset/camera-a',
          nativeFilePath: '/project/Media/A001.mov',
          professional: {
            version: 1,
            origin: 'imported',
            onlineState: 'online',
            sourceFingerprint: `sha256:${'a'.repeat(64)}`,
          },
        } : item),
      })),
    }));

    const relinked = buildExecutionContextForNode(composition, [composition], []);
    expect(relinked.visualSequenceClips?.[0]).toMatchObject({
      sourceNodeId: 'camera-a',
      assetUrl: 'signal-loom-asset://asset/camera-a',
      nativeFilePath: '/project/Media/A001.mov',
    });
    expect(relinked.sequenceAudioInputs?.[0]).toMatchObject({
      sourceNodeId: 'camera-a',
      url: 'signal-loom-asset://asset/camera-a',
      nativeFilePath: '/project/Media/A001.mov',
    });
  });
});
