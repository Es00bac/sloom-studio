import type { Edge } from '@xyflow/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppNode } from '../types/flow';
import { useFlowStore } from './flowStore';

function node(
  id: string,
  type: AppNode['type'],
  data: Record<string, unknown> = {},
): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle: string | null = null,
  targetHandle: string | null = null,
): Edge {
  return { id, source, target, sourceHandle, targetHandle };
}

function flowContract(id: string) {
  return useFlowStore.getState().edges.find((candidate) => candidate.id === id)?.data?.flowContract;
}

describe('Flow edge contract refresh after node configuration patches (FBL-027)', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
  });

  it('re-derives source and target contracts in both incompatible and compatible directions', () => {
    useFlowStore.setState({
      nodes: [
        node('script', 'javascriptNode', { declaredOutputType: 'text' }),
        node('regex', 'regexReplaceNode'),
        node('text', 'textNode'),
        node('xml', 'xmlYamlNode', { mode: 'xml-to-json' }),
      ],
      edges: [
        edge('script-regex', 'script', 'regex'),
        edge('text-xml', 'text', 'xml', null, 'text'),
      ],
    });
    useFlowStore.getState().hydratePersistedState();
    expect(flowContract('script-regex')).toMatchObject({ valid: true, carriedType: { kind: 'text' } });
    expect(flowContract('text-xml')).toMatchObject({ valid: true, acceptedTypes: [{ kind: 'text' }] });

    useFlowStore.getState().patchNodeData('script', { declaredOutputType: 'number' });
    useFlowStore.getState().patchNodeData('xml', { mode: 'json-to-xml' });

    expect(flowContract('script-regex')).toMatchObject({
      valid: false,
      carriedType: { kind: 'number' },
      reason: expect.stringContaining('number cannot connect to text'),
    });
    expect(flowContract('text-xml')).toMatchObject({
      valid: false,
      carriedType: { kind: 'text' },
      acceptedTypes: [{ kind: 'json' }],
      reason: expect.stringContaining('text cannot connect to json'),
    });

    useFlowStore.getState().patchNodeData('script', { declaredOutputType: 'text' });
    useFlowStore.getState().patchNodeData('xml', { mode: 'xml-to-json' });
    expect(flowContract('script-regex')).toMatchObject({ valid: true, carriedType: { kind: 'text' } });
    expect(flowContract('text-xml')).toMatchObject({ valid: true, acceptedTypes: [{ kind: 'text' }] });
  });

  it('refreshes every affected fan-out and named-handle edge without mutating an unrelated edge', () => {
    useFlowStore.setState({
      nodes: [
        node('swatch', 'colorSwatchNode', { colorSwatchColors: ['#111111', '#222222'] }),
        node('regex-a', 'regexReplaceNode'),
        node('regex-b', 'regexReplaceNode'),
        node('number', 'numberNode'),
        node('math', 'mathNode'),
      ],
      edges: [
        edge('color-a', 'swatch', 'regex-a', 'palette-color-1'),
        edge('color-b', 'swatch', 'regex-b', 'palette-color-1'),
        edge('unrelated', 'number', 'math', null, 'A'),
      ],
    });
    useFlowStore.getState().hydratePersistedState();
    const unrelatedBefore = useFlowStore.getState().edges.find((candidate) => candidate.id === 'unrelated');

    useFlowStore.getState().patchNodeData('swatch', { colorSwatchColors: ['#111111'] });

    for (const id of ['color-a', 'color-b']) {
      expect(flowContract(id)).toMatchObject({
        valid: false,
        reason: expect.stringContaining('source handle "palette-color-1" is not available'),
      });
    }
    expect(useFlowStore.getState().edges.find((candidate) => candidate.id === 'unrelated')).toBe(unrelatedBefore);
    expect(flowContract('unrelated')).toMatchObject({ valid: true, carriedType: { kind: 'number' } });
  });

  it('propagates a source type change through connected pass-through nodes', () => {
    useFlowStore.setState({
      nodes: [
        node('script', 'javascriptNode', { declaredOutputType: 'text' }),
        node('alias', 'virtual'),
        node('regex', 'regexReplaceNode'),
      ],
      edges: [
        edge('script-alias', 'script', 'alias'),
        edge('alias-regex', 'alias', 'regex'),
      ],
    });
    useFlowStore.getState().hydratePersistedState();

    useFlowStore.getState().patchNodeData('script', { declaredOutputType: 'number' });

    expect(flowContract('script-alias')).toMatchObject({ valid: true, carriedType: { kind: 'number' } });
    expect(flowContract('alias-regex')).toMatchObject({
      valid: false,
      carriedType: { kind: 'number' },
      reason: expect.stringContaining('number cannot connect to text'),
    });
  });

  it('does not churn edges for unchanged, content-only, disconnected, or missing-node patches', () => {
    useFlowStore.setState({
      nodes: [
        node('script', 'javascriptNode', { declaredOutputType: 'text', code: 'return A' }),
        node('regex', 'regexReplaceNode'),
        node('inactive', 'javascriptNode', { declaredOutputType: 'text' }),
      ],
      edges: [edge('script-regex', 'script', 'regex')],
    });
    useFlowStore.getState().hydratePersistedState();
    const initialEdges = useFlowStore.getState().edges;

    useFlowStore.getState().patchNodeData('script', { declaredOutputType: 'text' });
    expect(useFlowStore.getState().edges).toBe(initialEdges);
    useFlowStore.getState().patchNodeData('script', { code: 'return String(A)' });
    expect(useFlowStore.getState().edges).toBe(initialEdges);
    useFlowStore.getState().patchNodeData('inactive', { declaredOutputType: 'number' });
    expect(useFlowStore.getState().edges).toBe(initialEdges);
    useFlowStore.getState().patchNodeData('missing', { declaredOutputType: 'number' });
    expect(useFlowStore.getState().edges).toBe(initialEdges);
  });

  it('persists refreshed annotations through export/import and undo/redo-style snapshot replacement', () => {
    useFlowStore.setState({
      nodes: [
        node('script', 'javascriptNode', { declaredOutputType: 'text' }),
        node('regex', 'regexReplaceNode'),
      ],
      edges: [edge('script-regex', 'script', 'regex')],
    });
    useFlowStore.getState().hydratePersistedState();
    const beforePatch = useFlowStore.getState().exportProjectFlowSnapshot();

    useFlowStore.getState().patchNodeData('script', { declaredOutputType: 'number' });
    const afterPatch = useFlowStore.getState().exportProjectFlowSnapshot();
    expect(afterPatch.edges[0]?.data?.flowContract).toMatchObject({
      valid: false,
      carriedType: { kind: 'number' },
    });

    useFlowStore.getState().replaceFlowSnapshot(beforePatch);
    expect(flowContract('script-regex')).toMatchObject({ valid: true, carriedType: { kind: 'text' } });
    useFlowStore.getState().replaceFlowSnapshot(afterPatch);
    expect(flowContract('script-regex')).toMatchObject({ valid: false, carriedType: { kind: 'number' } });

    const browserExport = JSON.parse(useFlowStore.getState().exportFlow());
    useFlowStore.getState().replaceFlowSnapshot({ version: 3, nodes: browserExport.nodes, edges: browserExport.edges });
    expect(flowContract('script-regex')).toMatchObject({ valid: false, carriedType: { kind: 'number' } });
  });

  it('preserves an existing routed Composition audio handle and settles its authored count', () => {
    useFlowStore.setState({
      nodes: [
        node('audio', 'audioGen'),
        node('composition', 'composition', { compositionAudioTrackCount: 3 }),
      ],
      edges: [edge('audio-track-3', 'audio', 'composition', null, 'composition-audio-3')],
    });
    useFlowStore.getState().hydratePersistedState();

    useFlowStore.getState().patchNodeData('composition', { compositionAudioTrackCount: 1 });

    expect(useFlowStore.getState().edges.find((candidate) => candidate.id === 'audio-track-3')).toMatchObject({
      targetHandle: 'composition-audio-3',
      data: { flowContract: { valid: true, carriedType: { kind: 'audio' } } },
    });
    expect(useFlowStore.getState().nodes.find((candidate) => candidate.id === 'composition')?.data.compositionAudioTrackCount)
      .toBe(3);
  });

  it('refreshes a transitive Portal edge without letting hidden plumbing mask the current type reason', () => {
    useFlowStore.setState({
      nodes: [
        node('source', 'javascriptNode', { declaredOutputType: 'text' }),
        node('entry', 'portal', { portalRole: 'entry', portalPairId: 'pair-1' }),
        node('exit', 'portal', { portalRole: 'exit', portalPairId: 'pair-1' }),
        node('regex', 'regexReplaceNode'),
      ],
      edges: [
        edge('source-entry', 'source', 'entry'),
        edge('exit-regex', 'exit', 'regex'),
      ],
    });
    useFlowStore.getState().hydratePersistedState();

    expect(flowContract('exit-regex')).toMatchObject({
      valid: true,
      carriedType: { kind: 'text' },
      acceptedTypes: [{ kind: 'text' }],
    });
    expect(useFlowStore.getState().edges.filter((candidate) => candidate.data?.portalSynthetic)).toHaveLength(1);

    useFlowStore.getState().patchNodeData('source', { declaredOutputType: 'number' });

    expect(flowContract('exit-regex')).toMatchObject({
      valid: false,
      carriedType: { kind: 'number' },
      acceptedTypes: [{ kind: 'text' }],
      reason: expect.stringContaining('number cannot connect to text'),
    });
    expect(useFlowStore.getState().edges.filter((candidate) => candidate.data?.portalSynthetic)).toHaveLength(1);
  });

  it('uses the Function runtime media family for a routed Composition contract', () => {
    const functionNode = {
      schemaVersion: 1 as const,
      title: 'Audio function',
      description: '',
      contract: {
        id: 'audio-function',
        title: 'Audio function',
        inputPorts: [],
        outputPorts: [{
          id: 'audio-out',
          key: 'audio',
          label: 'Audio',
          resultType: 'audio' as const,
          required: true,
          order: 0,
        }],
        version: 1,
      },
      graph: { version: 1 as const, nodes: [], edges: [] },
      inputBindings: [],
      outputBindings: [],
    };
    useFlowStore.setState({
      nodes: [
        node('function', 'functionNode', { functionNode, resultType: 'audio' }),
        node('composition', 'composition', { compositionAudioTrackCount: 1 }),
      ],
      edges: [edge(
        'function-composition',
        'function',
        'composition',
        'audio-out',
        'composition-audio-1',
      )],
    });
    useFlowStore.getState().hydratePersistedState();

    expect(flowContract('function-composition')).toMatchObject({
      valid: true,
      carriedType: { kind: 'audio' },
      acceptedTypes: [{ kind: 'audio' }],
    });

    useFlowStore.getState().patchNodeData('function', { resultType: 'video' });

    expect(flowContract('function-composition')).toMatchObject({
      valid: false,
      carriedType: { kind: 'video' },
      acceptedTypes: [{ kind: 'audio' }],
      reason: expect.stringContaining('video cannot connect to audio'),
    });
    expect(useFlowStore.getState().edges.find((candidate) => candidate.id === 'function-composition')?.targetHandle)
      .toBe('composition-audio-1');

    useFlowStore.getState().patchNodeData('function', { resultType: 'audio' });
    expect(flowContract('function-composition')).toMatchObject({
      valid: true,
      carriedType: { kind: 'audio' },
      acceptedTypes: [{ kind: 'audio' }],
    });
  });
});
