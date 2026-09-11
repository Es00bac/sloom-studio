import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNode } from '../types/flow';

const h = vi.hoisted(() => ({
  host: { value: true },
  served: { value: false },
  notify: vi.fn<(channel: string, change: unknown) => void>(),
  notifyResult: { value: true },
  notifyPromise: { current: null as Promise<boolean> | null },
}));

vi.mock('./androidLanServer', async (importOriginal) => ({
  ...await importOriginal<typeof import('./androidLanServer')>(),
  isAndroidLanServerAvailable: () => h.host.value,
  notifyLanProjectChange: (channel: string, change: unknown) => {
    h.notify(channel, change);
    return h.notifyPromise.current ?? Promise.resolve(h.notifyResult.value);
  },
}));
vi.mock('./remoteHostClient', () => ({ isServedLanSession: () => h.served.value }));
vi.mock('./projectSyncClient', () => ({ ensureProjectSyncChannelStarted: vi.fn(async () => undefined) }));

import { useFlowStore } from '../store/flowStore';
import { useFlowWorkspaceStore } from '../store/flowWorkspaceStore';
import { clearProjectSyncChannels, getProjectSyncChannel } from './projectSyncService';
import { __resetProjectSyncRemoteApplyForTests } from './projectSyncRemoteApply';
import {
  VIDEO_SYNC_CHANNEL,
  __flushVideoSyncEmitForTests,
  __resetVideoSyncChannelForTests,
  initializeVideoSyncChannel,
} from './videoSyncChannel';
import type { VideoTimelineNativeChange } from './videoTimelineNativeSync';

function makeComposition(): AppNode {
  return {
    id: 'composition-1',
    type: 'composition',
    position: { x: 0, y: 0 },
    data: {
      nodeInstanceId: 'instance-1',
      aspectRatio: '16:9',
      videoResolution: '1080p',
      videoFrameRate: 30,
      compositionTimelineSeconds: 30,
      editorVisualClips: [],
      editorAudioClips: [],
    },
  } as AppNode;
}

beforeEach(() => {
  __resetVideoSyncChannelForTests();
  __resetProjectSyncRemoteApplyForTests();
  clearProjectSyncChannels();
  h.host.value = true;
  h.served.value = false;
  h.notify.mockReset();
  h.notifyResult.value = true;
  h.notifyPromise.current = null;
  useFlowStore.setState({ nodes: [makeComposition()], edges: [] });
});

describe('videoSyncChannel', () => {
  it('publishes a bounded composition mutation with Source Library identities after a local edit', async () => {
    initializeVideoSyncChannel();
    useFlowStore.getState().patchNodeData('composition-1', {
      editorAudioClips: [{
        id: 'audio-1', sourceNodeId: 'phone-recording', offsetMs: 125, trackIndex: 1,
        volumePercent: 90, volumeAutomationPoints: [], enabled: true,
      }],
    });
    await __flushVideoSyncEmitForTests();

    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(VIDEO_SYNC_CHANNEL, expect.objectContaining({
      type: 'video-timeline-composition-updated',
      composition: expect.objectContaining({
        compositionId: 'composition-1',
        data: expect.objectContaining({
          editorAudioClips: [expect.objectContaining({ sourceNodeId: 'phone-recording' })],
        }),
      }),
    }));
  });

  it('applies remote timeline state without echoing it and rejects recycled node identity', async () => {
    initializeVideoSyncChannel();
    const channel = getProjectSyncChannel(VIDEO_SYNC_CHANNEL)!;
    const change: VideoTimelineNativeChange = {
      type: 'video-timeline-composition-updated',
      schemaVersion: 1,
      workspaceId: useFlowWorkspaceStore.getState().hydratedWorkspaceId,
      composition: {
        compositionId: 'composition-1',
        nodeInstanceId: 'instance-1',
        data: { compositionTimelineSeconds: 75, editorTimelineMarkers: [{ id: 'm1', seconds: 4, label: 'Beat', color: '#22d3ee' }] },
      },
    };
    expect(await channel.applyRemote(change)).toBe(true);
    await __flushVideoSyncEmitForTests();
    expect(useFlowStore.getState().nodes[0].data.compositionTimelineSeconds).toBe(75);
    expect(h.notify).not.toHaveBeenCalled();

    expect(await channel.applyRemote({
      ...change,
      composition: { ...change.composition, data: { compositionTimelineSeconds: 80 } },
    })).toBe(true);
    expect(useFlowStore.getState().nodes[0].data.editorTimelineMarkers).toBeUndefined();

    expect(await channel.applyRemote({
      ...change,
      composition: { ...change.composition, nodeInstanceId: 'recycled-instance', data: { compositionTimelineSeconds: 5 } },
    })).toBe(false);
    expect(useFlowStore.getState().nodes[0].data.compositionTimelineSeconds).toBe(80);
  });

  it('seeds every composition and excludes device-local render cache URLs', async () => {
    useFlowStore.setState({ nodes: [{
      ...makeComposition(),
      data: { ...makeComposition().data, result: 'blob:local-render', editorRenderCacheUpdatedAt: 'now' },
    }] });
    initializeVideoSyncChannel();
    const snapshot = await getProjectSyncChannel(VIDEO_SYNC_CHANNEL)!.snapshot();
    expect(snapshot).toMatchObject({
      type: 'video-timeline-workspace-snapshot',
      schemaVersion: 1,
      compositions: [{ compositionId: 'composition-1' }],
    });
    expect(JSON.stringify(snapshot)).not.toContain('blob:');
  });

  it('rebases a pending local edit over a concurrent remote snapshot instead of dropping it', async () => {
    initializeVideoSyncChannel();
    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 45 });

    const channel = getProjectSyncChannel(VIDEO_SYNC_CHANNEL)!;
    expect(await channel.applyRemote({
      type: 'video-timeline-composition-updated',
      schemaVersion: 1,
      workspaceId: useFlowWorkspaceStore.getState().hydratedWorkspaceId,
      composition: {
        compositionId: 'composition-1',
        nodeInstanceId: 'instance-1',
        data: { compositionTimelineSeconds: 30, videoResolution: '4k' },
      },
    })).toBe(true);

    const data = useFlowStore.getState().nodes[0].data;
    expect(data.compositionTimelineSeconds).toBe(45);
    expect(data.videoResolution).toBe('4k');
    await __flushVideoSyncEmitForTests();
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0][1]).toMatchObject({
      composition: { data: { compositionTimelineSeconds: 45, videoResolution: '4k' } },
    });
  });

  it('preserves an acknowledged phone edit when a stale desktop later changes another timeline field', async () => {
    initializeVideoSyncChannel();
    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 45 });
    await __flushVideoSyncEmitForTests();

    const channel = getProjectSyncChannel(VIDEO_SYNC_CHANNEL)!;
    expect(await channel.applyRemote({
      type: 'video-timeline-composition-updated',
      schemaVersion: 1,
      workspaceId: useFlowWorkspaceStore.getState().hydratedWorkspaceId,
      changedKeys: ['videoResolution'],
      composition: {
        compositionId: 'composition-1',
        nodeInstanceId: 'instance-1',
        // This peer was stale and still thought duration was 30. Only its declared resolution edit
        // is ordered now; the already-authoritative phone duration must survive.
        data: { compositionTimelineSeconds: 30, videoResolution: '4k' },
      },
    })).toBe(true);

    expect(useFlowStore.getState().nodes[0].data).toMatchObject({
      compositionTimelineSeconds: 45,
      videoResolution: '4k',
    });
  });

  it('ignores a delayed self-echo while a newer local edit is pending', async () => {
    initializeVideoSyncChannel();
    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 45 });
    await __flushVideoSyncEmitForTests();
    const firstPublished = h.notify.mock.calls[0][1] as VideoTimelineNativeChange;

    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 50 });
    const channel = getProjectSyncChannel(VIDEO_SYNC_CHANNEL)!;
    expect(await channel.applyRemote(firstPublished)).toBe(false);
    expect(useFlowStore.getState().nodes[0].data.compositionTimelineSeconds).toBe(50);

    await __flushVideoSyncEmitForTests();
    expect(h.notify).toHaveBeenCalledTimes(2);
    expect(h.notify.mock.calls[1][1]).toMatchObject({
      composition: { data: { compositionTimelineSeconds: 50 } },
    });
  });

  it('serializes slow publishes and ignores their in-flight echo without rolling back a newer edit', async () => {
    let resolveFirst!: (published: boolean) => void;
    h.notifyPromise.current = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    initializeVideoSyncChannel();
    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 45 });
    const firstFlush = __flushVideoSyncEmitForTests();
    await vi.waitFor(() => expect(h.notify).toHaveBeenCalledTimes(1));
    const inFlightChange = h.notify.mock.calls[0][1] as VideoTimelineNativeChange;

    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 50 });
    const channel = getProjectSyncChannel(VIDEO_SYNC_CHANNEL)!;
    // Force the coalesced timer's in-flight early-return first. This clears timer markers and leaves
    // flushRequestedWhileInFlight as the only evidence that the newer edit is pending.
    await __flushVideoSyncEmitForTests();
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(await channel.applyRemote(inFlightChange)).toBe(false);
    expect(useFlowStore.getState().nodes[0].data.compositionTimelineSeconds).toBe(50);

    h.notifyPromise.current = null;
    resolveFirst(true);
    await firstFlush;
    await __flushVideoSyncEmitForTests();
    expect(h.notify).toHaveBeenCalledTimes(2);
    expect(h.notify.mock.calls[1][1]).toMatchObject({
      composition: { data: { compositionTimelineSeconds: 50 } },
    });
  });

  it('does not advance its baseline on a failed publish and retries the same edit', async () => {
    initializeVideoSyncChannel();
    h.notifyResult.value = false;
    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 55 });
    await __flushVideoSyncEmitForTests();
    expect(h.notify).toHaveBeenCalledTimes(1);

    h.notifyResult.value = true;
    await __flushVideoSyncEmitForTests();
    expect(h.notify).toHaveBeenCalledTimes(2);
    expect(h.notify.mock.calls[1][1]).toEqual(h.notify.mock.calls[0][1]);
  });

  it('bounds automatic retries for one failed snapshot and rearms after a new timeline edit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    initializeVideoSyncChannel();
    h.notifyResult.value = false;
    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 60 });
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await __flushVideoSyncEmitForTests();
    }
    expect(h.notify).toHaveBeenCalledTimes(9);
    await __flushVideoSyncEmitForTests();
    expect(h.notify).toHaveBeenCalledTimes(9);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stopped automatic retries'));

    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 61 });
    await __flushVideoSyncEmitForTests();
    expect(h.notify).toHaveBeenCalledTimes(10);
    warn.mockRestore();
  });

  it('does not bake an unpublished blocked composition into the baseline when another composition updates remotely', async () => {
    const second = {
      ...makeComposition(),
      id: 'composition-2',
      data: { ...makeComposition().data, nodeInstanceId: 'instance-2' },
    } as AppNode;
    useFlowStore.setState({ nodes: [makeComposition(), second], edges: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    initializeVideoSyncChannel();
    h.notifyResult.value = false;
    useFlowStore.getState().patchNodeData('composition-1', { compositionTimelineSeconds: 60 });
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await __flushVideoSyncEmitForTests();
    }
    expect(h.notify).toHaveBeenCalledTimes(9);

    const channel = getProjectSyncChannel(VIDEO_SYNC_CHANNEL)!;
    expect(await channel.applyRemote({
      type: 'video-timeline-composition-updated',
      schemaVersion: 1,
      workspaceId: useFlowWorkspaceStore.getState().hydratedWorkspaceId,
      composition: {
        compositionId: 'composition-2',
        nodeInstanceId: 'instance-2',
        data: { compositionTimelineSeconds: 80 },
      },
    })).toBe(true);
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'composition-1')?.data.compositionTimelineSeconds).toBe(60);
    expect(useFlowStore.getState().nodes.find((node) => node.id === 'composition-2')?.data.compositionTimelineSeconds).toBe(80);

    await __flushVideoSyncEmitForTests();
    expect(h.notify).toHaveBeenCalledTimes(10);
    expect(h.notify.mock.calls[9][1]).toMatchObject({ composition: { compositionId: 'composition-1' } });
    warn.mockRestore();
  });

  it('rejects a timeline update for another Flow workspace', async () => {
    initializeVideoSyncChannel();
    const channel = getProjectSyncChannel(VIDEO_SYNC_CHANNEL)!;
    expect(await channel.applyRemote({
      type: 'video-timeline-composition-updated',
      schemaVersion: 1,
      workspaceId: 'not-the-open-workspace',
      composition: {
        compositionId: 'composition-1',
        nodeInstanceId: 'instance-1',
        data: { compositionTimelineSeconds: 90 },
      },
    })).toBe(false);
    expect(useFlowStore.getState().nodes[0].data.compositionTimelineSeconds).toBe(30);
  });
});
