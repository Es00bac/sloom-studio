import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { buildListItemTargetHandle } from './listNodes';
import { collectFlowDiagnostics, getBlockingFlowDiagnostics } from './flowDiagnostics';
import { sanitizeCompositionAudioMigrationWarnings } from './compositionTracks';
import { createEditorVisualClip } from './manualEditorState';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('flow diagnostics', () => {
  it('reports incompatible legacy edges with source/target types and converter guidance', () => {
    const nodes = [
      createNode({ id: 'number', type: 'numberNode' }),
      createNode({ id: 'replace', type: 'regexReplaceNode' }),
    ];
    const diagnostics = collectFlowDiagnostics(nodes, [
      { id: 'bad-type', source: 'number', target: 'replace' },
    ]);

    expect(diagnostics).toContainEqual(expect.objectContaining({
      id: 'contract-edge-bad-type',
      edgeId: 'bad-type',
      nodeId: 'replace',
      severity: 'critical',
      message: expect.stringContaining('number cannot connect to text'),
      suggestedFix: expect.stringContaining('javascriptNode'),
      blocksRun: true,
    }));
  });

  it('reports missing required inputs from the resolved node contract', () => {
    const diagnostics = collectFlowDiagnostics([
      createNode({ id: 'crop', type: 'cropImageNode' }),
    ], []);

    expect(diagnostics).toContainEqual(expect.objectContaining({
      id: 'contract-required-crop-image',
      nodeId: 'crop',
      severity: 'critical',
      message: 'Image requires 1 connection.',
      blocksRun: true,
    }));
  });

  it('accepts an embedded Video-workspace sequence as the Composition video source', () => {
    const composition = createNode({
      id: 'composition-editor-sequence',
      type: 'composition',
      data: {
        editorVisualClips: [createEditorVisualClip('library-video', 'video', { id: 'timeline-video' })],
      },
    });

    expect(getBlockingFlowDiagnostics([composition], [], composition.id)).toEqual([]);
  });

  it('still refuses a truly empty Composition without an upstream video edge', () => {
    const composition = createNode({ id: 'composition-empty', type: 'composition' });

    expect(getBlockingFlowDiagnostics([composition], [], composition.id)).toContainEqual(
      expect.objectContaining({
        id: 'contract-required-composition-empty-composition-video',
        message: 'Video track requires 1 connection.',
      }),
    );
  });

  it('reports saved edges attached to model-disabled ports', () => {
    const nodes = [
      createNode({ id: 'source', type: 'imageGen', data: { mediaMode: 'import' } }),
      createNode({
        id: 'target',
        type: 'imageGen',
        data: { provider: 'stability', modelId: 'stable-image-core' },
      }),
    ];
    const diagnostics = collectFlowDiagnostics(nodes, [
      { id: 'disabled-ref', source: 'source', target: 'target', targetHandle: 'image-reference-1' },
    ]);

    expect(diagnostics).toContainEqual(expect.objectContaining({
      id: 'contract-edge-disabled-ref',
      edgeId: 'disabled-ref',
      message: expect.stringContaining('does not support reference images'),
      blocksRun: true,
    }));
  });

  it('surfaces a persisted Composition audio migration warning as a non-blocking diagnostic (FBL-019 correction)', () => {
    const nodes = [
      createNode({
        id: 'composition-1',
        type: 'composition',
        data: {
          compositionAudioMigrationWarnings: [
            {
              handle: 'composition-audio-9',
              reason: 'overflow',
              message: 'Removed unsupported audio connection on handle "composition-audio-9" (beyond the supported 4-track limit).',
            },
          ],
        },
      }),
    ];

    const diagnostics = collectFlowDiagnostics(nodes, []);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      nodeId: 'composition-1',
      severity: 'warning',
      blocksRun: false,
      message: expect.stringContaining('composition-audio-9'),
    }));
  });

  it('emits one diagnostic after duplicate persisted Composition warnings are sanitized', () => {
    const warnings = sanitizeCompositionAudioMigrationWarnings([
      { handle: 'composition-audio-9', reason: 'overflow', message: 'First diagnostic warning.' },
      { handle: 'composition-audio-9', reason: 'overflow', message: 'Duplicate diagnostic warning.' },
    ]);
    const nodes = [
      createNode({
        id: 'composition-1',
        type: 'composition',
        data: { compositionAudioMigrationWarnings: warnings },
      }),
    ];

    const diagnostics = collectFlowDiagnostics(nodes, []).filter((diagnostic) =>
      diagnostic.id.startsWith('composition-audio-migration-composition-1-')
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toBe('First diagnostic warning.');
  });

  it('reports cardinality violations without deleting either saved edge', () => {
    const nodes = [
      createNode({ id: 'a', type: 'textNode' }),
      createNode({ id: 'b', type: 'textNode' }),
      createNode({ id: 'replace', type: 'regexReplaceNode' }),
    ];
    const edges: Edge[] = [
      { id: 'edge-a', source: 'a', target: 'replace' },
      { id: 'edge-b', source: 'b', target: 'replace' },
    ];
    const diagnostics = collectFlowDiagnostics(nodes, edges);

    expect(diagnostics.filter((diagnostic) => diagnostic.id.startsWith('contract-edge-'))).toHaveLength(2);
    expect(edges).toHaveLength(2);
  });

  it('accepts a valid dynamic pass-through chain', () => {
    const nodes = [
      createNode({ id: 'source', type: 'textNode' }),
      createNode({ id: 'virtual', type: 'virtual' }),
      createNode({ id: 'replace', type: 'regexReplaceNode' }),
    ];
    const edges: Edge[] = [
      { id: 'source-virtual', source: 'source', target: 'virtual' },
      { id: 'virtual-replace', source: 'virtual', target: 'replace' },
    ];

    expect(collectFlowDiagnostics(nodes, edges).filter((diagnostic) =>
      diagnostic.id.startsWith('contract-'))).toEqual([]);
  });

  it('scopes run blocking to the selected node and its upstream dependency graph', () => {
    const nodes = [
      createNode({ id: 'prompt', type: 'textNode' }),
      createNode({ id: 'request', type: 'apiFetchNode' }),
      createNode({ id: 'unrelated-crop', type: 'cropImageNode' }),
    ];
    const edges: Edge[] = [{ id: 'prompt-request', source: 'prompt', target: 'request' }];

    expect(getBlockingFlowDiagnostics(nodes, edges, 'request')).toEqual([]);
    expect(getBlockingFlowDiagnostics(nodes, edges)).toContainEqual(expect.objectContaining({
      nodeId: 'unrelated-crop',
      id: 'contract-required-unrelated-crop-image',
    }));
  });

  it('reports list-aware pure-node mismatches as critical workspace diagnostics', () => {
    const nodes = [
      createNode({ id: 'a1', type: 'textNode', data: { prompt: 'a1' } }),
      createNode({ id: 'a2', type: 'textNode', data: { prompt: 'a2' } }),
      createNode({ id: 'b1', type: 'textNode', data: { prompt: 'b1' } }),
      createNode({ id: 'b2', type: 'textNode', data: { prompt: 'b2' } }),
      createNode({ id: 'b3', type: 'textNode', data: { prompt: 'b3' } }),
      createNode({ id: 'list-a', type: 'list' }),
      createNode({ id: 'list-b', type: 'list' }),
      createNode({ id: 'template', type: 'stringTemplateNode', data: { template: '{A}/{B}' } }),
      createNode({ id: 'image', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      { id: 'ea1', source: 'a1', target: 'list-a', targetHandle: buildListItemTargetHandle(0) },
      { id: 'ea2', source: 'a2', target: 'list-a', targetHandle: buildListItemTargetHandle(1) },
      { id: 'eb1', source: 'b1', target: 'list-b', targetHandle: buildListItemTargetHandle(0) },
      { id: 'eb2', source: 'b2', target: 'list-b', targetHandle: buildListItemTargetHandle(1) },
      { id: 'eb3', source: 'b3', target: 'list-b', targetHandle: buildListItemTargetHandle(2) },
      { id: 'ta', source: 'list-a', target: 'template', targetHandle: 'A' },
      { id: 'tb', source: 'list-b', target: 'template', targetHandle: 'B' },
      { id: 'out', source: 'template', target: 'image' },
    ];

    const diagnostics = collectFlowDiagnostics(nodes, edges);

    expect(diagnostics.some((diagnostic) =>
      diagnostic.severity === 'critical' &&
      diagnostic.nodeId === 'template' &&
      diagnostic.message.includes('same length'),
    )).toBe(true);
  });

  it('warns when an edge references a missing node', () => {
    const diagnostics = collectFlowDiagnostics(
      [createNode({ id: 'image', type: 'imageGen' })],
      [{ id: 'broken', source: 'missing', target: 'image' }],
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        edgeId: 'broken',
        severity: 'critical',
        blocksRun: true,
      }),
    ]);
  });

  it('does not crash the surface when diagnostics encounters an overly deep utility chain', () => {
    const depth = 1800;
    const nodes: AppNode[] = [
      createNode({ id: 'source', type: 'textNode', data: { prompt: 'safe' } }),
      ...Array.from({ length: depth }, (_, index) =>
        createNode({ id: `monitor-${index}`, type: 'valueMonitorNode' }),
      ),
    ];
    const edges: Edge[] = Array.from({ length: depth }, (_, index) => ({
      id: `edge-${index}`,
      source: index === 0 ? 'source' : `monitor-${index - 1}`,
      target: `monitor-${index}`,
    }));

    let diagnostics: ReturnType<typeof collectFlowDiagnostics> = [];
    expect(() => {
      diagnostics = collectFlowDiagnostics(nodes, edges);
    }).not.toThrow();
    expect(diagnostics.some((diagnostic) =>
      diagnostic.severity === 'critical' &&
      diagnostic.message.includes('too deep'),
    )).toBe(true);
  }, 10_000);
});
