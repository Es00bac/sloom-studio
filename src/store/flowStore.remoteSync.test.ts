import { beforeEach, describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { useFlowStore } from './flowStore';
import type { FlowProjectFlowSnapshot } from '../lib/flowProjectWorkspaces';

/**
 * `applyRemoteFlowGraphChange` is the store seam the unified Flow sync channel (#51) drives. These
 * verify it mutates the live graph from a serialized op the way a remote client would, re-attaches
 * runtime callbacks to incoming nodes, and reports change/no-op so a self-echoed op never thrashes.
 */

const node = (id: string, position = { x: 0, y: 0 }, data: Record<string, unknown> = {}): AppNode =>
  ({ id, type: 'textNode', position, data } as unknown as AppNode);

const edge = (id: string, source: string, target: string): Edge =>
  ({ id, source, target } as Edge);

beforeEach(() => {
  useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
});

describe('flowStore.applyRemoteFlowGraphChange', () => {
  it('adds a remote node and re-attaches runtime callbacks', () => {
    const changed = useFlowStore.getState().applyRemoteFlowGraphChange({
      type: 'flow-node-added',
      node: node('a', { x: 4, y: 5 }, { prompt: 'hi' }),
    });
    expect(changed).toBe(true);

    const added = useFlowStore.getState().nodes.find((n) => n.id === 'a');
    expect(added?.position).toEqual({ x: 4, y: 5 });
    expect(added?.data.prompt).toBe('hi');
    // Runtime callbacks the serialized op didn't carry are restored.
    expect(typeof added?.data.onChange).toBe('function');
    expect(added?.data.isRunning).toBe(false);
  });

  it('preserves a remote node identity when only its device-local input revision is absent', () => {
    const changed = useFlowStore.getState().applyRemoteFlowGraphChange({
      type: 'flow-node-added',
      node: node('composition-remote', { x: 4, y: 5 }, { nodeInstanceId: 'phone-instance' }),
    });

    expect(changed).toBe(true);
    const added = useFlowStore.getState().nodes.find((candidate) => candidate.id === 'composition-remote');
    expect(added?.data.nodeInstanceId).toBe('phone-instance');
    expect(added?.data.inputRevision).toEqual(expect.any(String));
  });

  it('is idempotent: re-adding the same node id reports no change', () => {
    useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-node-added', node: node('a') });
    const changed = useFlowStore
      .getState()
      .applyRemoteFlowGraphChange({ type: 'flow-node-added', node: node('a') });
    expect(changed).toBe(false);
    expect(useFlowStore.getState().nodes).toHaveLength(1);
  });

  it('moves a node and no-ops a move to the same position', () => {
    useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-node-added', node: node('a', { x: 0, y: 0 }) });

    expect(
      useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-node-moved', nodeId: 'a', position: { x: 9, y: 9 } }),
    ).toBe(true);
    expect(useFlowStore.getState().nodes[0].position).toEqual({ x: 9, y: 9 });

    expect(
      useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-node-moved', nodeId: 'a', position: { x: 9, y: 9 } }),
    ).toBe(false);
  });

  it('merges a node-data patch while keeping runtime callbacks intact', () => {
    useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-node-added', node: node('a', { x: 0, y: 0 }, { prompt: 'one' }) });
    const before = useFlowStore.getState().nodes[0].data.onChange;

    const changed = useFlowStore.getState().applyRemoteFlowGraphChange({
      type: 'flow-node-data-updated',
      nodeId: 'a',
      patch: { prompt: 'two' } as never,
    });
    expect(changed).toBe(true);
    const after = useFlowStore.getState().nodes[0];
    expect(after.data.prompt).toBe('two');
    expect(typeof after.data.onChange).toBe('function');
    expect(before).toBeTypeOf('function');
  });

  it('removes a node together with its incident edges', () => {
    useFlowStore.setState({
      nodes: [node('a'), node('b'), node('c')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
      bookmarkSidebarOpen: true,
    });
    const changed = useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-node-removed', nodeId: 'b' });
    expect(changed).toBe(true);
    expect(useFlowStore.getState().nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(useFlowStore.getState().edges).toHaveLength(0);
  });

  it('adds and removes edges', () => {
    useFlowStore.setState({ nodes: [node('a'), node('b')], edges: [], bookmarkSidebarOpen: true });
    expect(
      useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-edge-added', edge: edge('e1', 'a', 'b') }),
    ).toBe(true);
    expect(useFlowStore.getState().edges.map((e) => e.id)).toEqual(['e1']);

    expect(
      useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-edge-removed', edgeId: 'e1' }),
    ).toBe(true);
    expect(useFlowStore.getState().edges).toHaveLength(0);
    expect(
      useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-edge-removed', edgeId: 'missing' }),
    ).toBe(false);
  });

  it('settles a stale Composition audio-track count when a remote edge-added change lands on a higher track (FBL-019 gap 2)', () => {
    useFlowStore.setState({
      nodes: [
        { id: 'audio-1', type: 'audioGen', position: { x: 0, y: 0 }, data: {} } as unknown as AppNode,
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        } as unknown as AppNode,
      ],
      edges: [],
      bookmarkSidebarOpen: true,
    });

    const changed = useFlowStore.getState().applyRemoteFlowGraphChange({
      type: 'flow-edge-added',
      edge: { id: 'remote-edge', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-3' } as Edge,
    });

    expect(changed).toBe(true);
    const composition = useFlowStore.getState().nodes.find((n) => n.id === 'composition-1');
    expect(composition?.data.compositionAudioTrackCount).toBe(3);
  });

  it('rejects and diagnoses an overflow audio handle delivered via an incremental remote edge-added change (FBL-019 correction)', () => {
    useFlowStore.setState({
      nodes: [
        { id: 'audio-1', type: 'audioGen', position: { x: 0, y: 0 }, data: {} } as unknown as AppNode,
        {
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: { compositionAudioTrackCount: 1 },
        } as unknown as AppNode,
      ],
      edges: [],
      bookmarkSidebarOpen: true,
    });

    const changed = useFlowStore.getState().applyRemoteFlowGraphChange({
      type: 'flow-edge-added',
      edge: { id: 'remote-overflow', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-9' } as Edge,
    });

    expect(changed).toBe(true);
    expect(useFlowStore.getState().edges.find((edge) => edge.id === 'remote-overflow')).toBeUndefined();
    const composition = useFlowStore.getState().nodes.find((n) => n.id === 'composition-1')!;
    expect(composition.data.compositionAudioMigrationWarnings).toEqual([
      expect.objectContaining({ handle: 'composition-audio-9', reason: 'overflow' }),
    ]);
  });

  it('replaces the whole graph from a snapshot and re-attaches runtime data', () => {
    useFlowStore.setState({ nodes: [node('old')], edges: [], bookmarkSidebarOpen: true });
    const snapshot: FlowProjectFlowSnapshot = {
      version: 3,
      nodes: [node('a'), node('b')],
      edges: [edge('e1', 'a', 'b')],
    };
    const changed = useFlowStore.getState().applyRemoteFlowGraphChange({ type: 'flow-graph-snapshot', snapshot });
    expect(changed).toBe(true);
    expect(useFlowStore.getState().nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(useFlowStore.getState().edges.map((e) => e.id)).toEqual(['e1']);
    expect(typeof useFlowStore.getState().nodes[0].data.onChange).toBe('function');
  });
});
