import { expect, it, vi } from 'vitest';
import type { AppNode } from '../types/flow';

const h = vi.hoisted(() => ({
  notify: vi.fn<(channel: string, change: unknown) => Promise<boolean>>(async () => true),
}));

vi.mock('./androidLanServer', async (importOriginal) => ({
  ...await importOriginal<typeof import('./androidLanServer')>(),
  isAndroidLanServerAvailable: () => true,
  notifyLanProjectChange: (channel: string, change: unknown) => h.notify(channel, change),
}));
vi.mock('./remoteHostClient', () => ({ isServedLanSession: () => false }));
vi.mock('./projectSyncClient', () => ({ ensureProjectSyncChannelStarted: vi.fn(async () => undefined) }));

import { useFlowStore } from '../store/flowStore';
import { getProjectSyncChannel } from './projectSyncService';
import {
  FLOW_SYNC_CHANNEL,
  __flushFlowSyncEmitForTests,
  __resetFlowSyncChannelForTests,
  initializeFlowSyncChannel,
} from './flowSyncChannel';

it('leaves timeline mutations to Video sync while Flow still publishes non-Video composition edits', async () => {
  const node: AppNode = {
    id: 'composition-1',
    type: 'composition',
    position: { x: 0, y: 0 },
    data: {
      nodeInstanceId: 'instance-1',
      customTitle: 'Sequence A',
      compositionTimelineSeconds: 30,
      editorVisualClips: [],
    },
  } as AppNode;
  useFlowStore.setState({ nodes: [node], edges: [] });
  __resetFlowSyncChannelForTests();
  initializeFlowSyncChannel();
  h.notify.mockReset().mockResolvedValue(true);

  useFlowStore.getState().patchNodeData(node.id, { compositionTimelineSeconds: 45 });
  await __flushFlowSyncEmitForTests();
  expect(h.notify).not.toHaveBeenCalled();

  useFlowStore.getState().patchNodeData(node.id, { customTitle: 'Sequence B' });
  await __flushFlowSyncEmitForTests();
  expect(h.notify).toHaveBeenCalledTimes(1);
  const [channel, change] = h.notify.mock.calls[0];
  expect(channel).toBe(FLOW_SYNC_CHANNEL);
  expect(change).toMatchObject({
    type: 'flow-node-data-updated',
    nodeId: node.id,
    patch: { customTitle: 'Sequence B' },
  });
  expect(JSON.stringify(change)).not.toContain('editorVisualClips');
  expect(JSON.stringify(change)).not.toContain('compositionTimelineSeconds');

  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((candidate) => candidate.id === node.id
      ? { ...candidate, data: { ...candidate.data, result: 'blob:local-render', editorRenderCacheUpdatedAt: 'now' } }
      : candidate),
  }));
  const seed = await getProjectSyncChannel(FLOW_SYNC_CHANNEL)!.snapshot();
  expect(JSON.stringify(seed)).not.toContain('blob:local-render');
  expect(JSON.stringify(seed)).not.toContain('editorRenderCacheUpdatedAt');
  expect(JSON.stringify(seed)).toContain('compositionTimelineSeconds');
});

it('rejects malformed inbound Flow operations before they can touch the store', () => {
  const node: AppNode = {
    id: 'composition-invalid-test',
    type: 'composition',
    position: { x: 0, y: 0 },
    data: { customTitle: 'Untouched' },
  } as AppNode;
  useFlowStore.setState({ nodes: [node], edges: [] });
  __resetFlowSyncChannelForTests();
  initializeFlowSyncChannel();

  const channel = getProjectSyncChannel(FLOW_SYNC_CHANNEL)!;
  expect(channel.applyRemote({
    type: 'flow-node-data-updated',
    nodeId: node.id,
    patch: { customTitle: 'Injected' },
    foreign: true,
  })).toBe(false);
  expect(useFlowStore.getState().nodes[0].data.customTitle).toBe('Untouched');
});

it('keeps an unacknowledged Flow edit pending until a later publication succeeds', async () => {
  const node: AppNode = {
    id: 'flow-retry-test',
    type: 'composition',
    position: { x: 0, y: 0 },
    data: { customTitle: 'Before' },
  } as AppNode;
  useFlowStore.setState({ nodes: [node], edges: [] });
  __resetFlowSyncChannelForTests();
  initializeFlowSyncChannel();
  h.notify.mockReset();
  h.notify.mockResolvedValueOnce(false).mockResolvedValue(true);

  useFlowStore.getState().patchNodeData(node.id, { customTitle: 'After' });
  await __flushFlowSyncEmitForTests();
  await __flushFlowSyncEmitForTests();

  expect(h.notify).toHaveBeenCalledTimes(2);
  expect(h.notify.mock.calls[0][1]).toEqual(h.notify.mock.calls[1][1]);
  expect(h.notify.mock.calls[1][1]).toMatchObject({
    type: 'flow-node-data-updated',
    nodeId: node.id,
    patch: { customTitle: 'After' },
  });
});

it('rebases unpublished local Flow edits over a gap-repair snapshot', async () => {
  const authorityNode: AppNode = {
    id: 'flow-reseed-authority',
    type: 'composition',
    position: { x: 10, y: 20 },
    data: { customTitle: 'Authority before gap' },
  } as AppNode;
  const localNode: AppNode = {
    id: 'flow-reseed-local',
    type: 'composition',
    position: { x: 30, y: 40 },
    data: { customTitle: 'Unpublished local node' },
  } as AppNode;
  useFlowStore.setState({ nodes: [authorityNode], edges: [] });
  __resetFlowSyncChannelForTests();
  initializeFlowSyncChannel();
  h.notify.mockReset().mockResolvedValue(true);

  useFlowStore.getState().patchNodeData(authorityNode.id, { customTitle: 'Unpublished local title' });
  useFlowStore.setState((state) => ({ nodes: [...state.nodes, localNode] }));

  const changed = await getProjectSyncChannel(FLOW_SYNC_CHANNEL)!.applyRemote({
    type: 'flow-graph-snapshot',
    snapshot: {
      version: 1,
      nodes: [{
        ...authorityNode,
        position: { x: 50, y: 60 },
        data: { customTitle: 'Authority after gap' },
      }],
      edges: [],
    },
  });

  expect(changed).toBe(true);
  const rebased = useFlowStore.getState().nodes;
  expect(rebased.find((node) => node.id === authorityNode.id)).toMatchObject({
    position: { x: 50, y: 60 },
    data: { customTitle: 'Unpublished local title' },
  });
  expect(rebased.find((node) => node.id === localNode.id)).toBeTruthy();

  await __flushFlowSyncEmitForTests();
  expect(h.notify.mock.calls.map(([, operation]) => operation)).toEqual(expect.arrayContaining([
    expect.objectContaining({
      type: 'flow-node-data-updated',
      nodeId: authorityNode.id,
      patch: expect.objectContaining({ customTitle: 'Unpublished local title' }),
    }),
    expect.objectContaining({ type: 'flow-node-added', node: expect.objectContaining({ id: localNode.id }) }),
  ]));
});
