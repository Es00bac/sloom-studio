import { describe, expect, it } from 'vitest';
import { createEditorVisualClip } from './manualEditorState';
import type { EditorVisualClip } from '../types/flow';
import { createDefaultEditorProfessionalVideoState } from '../types/videoProfessional';
import { getProgramStageClips } from '../components/Editor/ManualEditorWorkspaceUtils';
import { projectExecutableMulticamClips } from './videoMulticamExecution';
import type { VideoRuntimeResolvedVisualClip } from './videoRuntimeNestedExecution';

function host(): EditorVisualClip {
  return {
    ...createEditorVisualClip('camera-a', 'video', {
    startMs: 1_000, sourceInMs: 500, sourceOutMs: 4_500, durationSeconds: 4,
    transitionIn: 'fade', transitionOut: 'slide-left',
    }),
    id: 'host',
    professional: {
      multicamSourceId: 'multi-1',
      masks: [{ id: 'mask-1', kind: 'ellipse' as const, points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], featherPercent: 0, opacityPercent: 100, inverted: false }],
    },
  };
}

function state() {
  return {
    ...createDefaultEditorProfessionalVideoState(),
    multicamSources: [{
      id: 'multi-1', name: 'Interview', angleSourceIds: ['camera-a', 'camera-b'], activeAngleId: 'camera-a',
      cuts: [{ id: 'opening', timelineMs: 0, angleSourceId: 'camera-a' }, { id: 'reaction', timelineMs: 1_500, angleSourceId: 'camera-b' }],
      syncMethod: 'manual' as const, audioFollowsVideo: false,
    }],
  };
}

describe('executable multicam projection', () => {
  it('turns persisted angle cuts into ordinary monitor/export clips while retaining host effects', () => {
    const result = projectExecutableMulticamClips([host()], state(), new Set(['camera-a', 'camera-b']));
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (!result.ok) return;
    expect(result.clips).toMatchObject([
      { id: 'host:multicam:opening', sourceNodeId: 'camera-a', startMs: 1_000, sourceInMs: 500, sourceOutMs: 2_000, durationSeconds: 1.5, transitionIn: 'fade', transitionOut: 'none' },
      { id: 'host:multicam:reaction', sourceNodeId: 'camera-b', startMs: 2_500, sourceInMs: 2_000, sourceOutMs: 4_500, durationSeconds: 2.5, transitionIn: 'none', transitionOut: 'slide-left' },
    ]);
    expect(result.clips[1]?.professional).toMatchObject({ masks: [expect.objectContaining({ id: 'mask-1' })], multicamSourceId: undefined, multicamAngleId: 'camera-b' });
    const sources = new Map([
      ['camera-a', { id: 'camera-a', nodeId: 'camera-a', label: 'Camera A', kind: 'video' as const }],
      ['camera-b', { id: 'camera-b', nodeId: 'camera-b', label: 'Camera B', kind: 'video' as const }],
    ]);
    expect(getProgramStageClips(result.clips, sources, new Map(), {}, {}, 1.25)[0]?.clip.sourceNodeId).toBe('camera-a');
    expect(getProgramStageClips(result.clips, sources, new Map(), {}, {}, 3.25)[0]?.clip.sourceNodeId).toBe('camera-b');
  });

  it('retains nested Runtime IR role and ancestry while projecting multicam cuts', () => {
    const resolvedHost: VideoRuntimeResolvedVisualClip = {
      ...host(),
      runtimeRole: 'media',
      runtimeOriginClipId: 'nested-reference',
      runtimePath: ['nested-cameras', 'nested-reference'],
    };

    const result = projectExecutableMulticamClips([resolvedHost], state(), new Set(['camera-a', 'camera-b']));

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (!result.ok) return;
    expect(result.clips).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runtimeRole: 'media',
        runtimeOriginClipId: 'nested-reference',
        runtimePath: ['nested-cameras', 'nested-reference'],
      }),
    ]));
    expect(result.clips.every((clip) =>
      clip.runtimeRole === 'media'
      && clip.runtimeOriginClipId === 'nested-reference'
      && clip.runtimePath.join('/') === 'nested-cameras/nested-reference',
    )).toBe(true);
  });

  it('fails closed for missing, duplicate, out-of-range, and unsupported host records', () => {
    expect(projectExecutableMulticamClips([host()], state(), new Set(['camera-a']))).toEqual(expect.objectContaining({ ok: false, message: expect.stringMatching(/unavailable angle/) }));
    expect(projectExecutableMulticamClips([host()], { ...state(), multicamSources: [{ ...state().multicamSources[0], angleSourceIds: ['camera-a', 'camera-a'] }] }, new Set(['camera-a']))).toEqual(expect.objectContaining({ ok: false, message: expect.stringMatching(/duplicate/) }));
    expect(projectExecutableMulticamClips([host()], { ...state(), multicamSources: [{ ...state().multicamSources[0], cuts: [{ id: 'late', timelineMs: 1_000, angleSourceId: 'camera-a' }] }] }, new Set(['camera-a', 'camera-b']))).toEqual(expect.objectContaining({ ok: false, message: expect.stringMatching(/start with a cut/) }));
    expect(projectExecutableMulticamClips([{ ...host(), playbackRate: 2 }], state(), new Set(['camera-a', 'camera-b']))).toEqual(expect.objectContaining({ ok: false, message: expect.stringMatching(/normal-speed/) }));
    expect(projectExecutableMulticamClips([host()], state(), new Set(['camera-a', 'camera-b']), new Set(['camera-a']))).toEqual(expect.objectContaining({ ok: false, message: expect.stringMatching(/non-video/) }));
    expect(projectExecutableMulticamClips([host()], {
      ...state(),
      multicamSources: [{ ...state().multicamSources[0], cuts: Array.from({ length: 1_001 }, (_, index) => ({ id: `cut-${index}`, timelineMs: 0, angleSourceId: 'camera-a' })) }],
    }, new Set(['camera-a', 'camera-b']))).toEqual(expect.objectContaining({ ok: false, message: expect.stringMatching(/1000-cut/) }));
  });
});
