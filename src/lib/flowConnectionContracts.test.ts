import type { Connection, Edge } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import type { AppNode, FlowNodeType, NodeData } from '../types/flow';
import {
  annotateFlowEdge,
  resolveFlowOutputType,
  validateFlowConnection,
} from './flowConnectionContracts';

function node(id: string, type: FlowNodeType, data: NodeData = {}): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    source: 'source',
    sourceHandle: null,
    target: 'target',
    targetHandle: null,
    ...overrides,
  };
}

describe('validateFlowConnection', () => {
  it('accepts an exact text connection and reports the carried type', () => {
    const nodes = [node('source', 'textNode'), node('target', 'imageGen', { provider: 'bfl', modelId: 'flux-2-pro' })];

    expect(validateFlowConnection(connection(), { nodes, edges: [] })).toMatchObject({
      valid: true,
      carriedType: { kind: 'text' },
      sourcePort: { id: null, direction: 'output' },
      targetPort: { id: null, direction: 'input' },
    });
  });

  it('rejects number to text without implicit coercion and suggests an explicit converter', () => {
    const nodes = [node('source', 'numberNode'), node('target', 'regexReplaceNode')];
    const result = validateFlowConnection(connection(), { nodes, edges: [] });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('number cannot connect to text');
    expect(result.converterNodeTypes).toContain('javascriptNode');
  });

  it('rejects text to an image-only port', () => {
    const nodes = [node('source', 'textNode'), node('target', 'cropImageNode')];
    const result = validateFlowConnection(connection({ targetHandle: 'image' }), { nodes, edges: [] });

    expect(result).toMatchObject({ valid: false });
    expect(result.reason).toContain('text cannot connect to image');
  });

  it('rejects connections whose source or target handle does not exist', () => {
    const nodes = [node('source', 'textNode'), node('target', 'regexReplaceNode')];

    expect(validateFlowConnection(connection({ sourceHandle: 'missing' }), { nodes, edges: [] }).reason)
      .toContain('source handle');
    expect(validateFlowConnection(connection({ targetHandle: 'missing' }), { nodes, edges: [] }).reason)
      .toContain('target handle');
  });

  it('blocks a visible model-specific port when the selected model does not support it', () => {
    const nodes = [
      node('source', 'imageGen', { mediaMode: 'import' }),
      node('target', 'imageGen', { provider: 'stability', modelId: 'stable-image-core' }),
    ];
    const result = validateFlowConnection(connection({ targetHandle: 'image-reference-1' }), { nodes, edges: [] });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('does not support reference images');
  });

  it('enforces target port cardinality', () => {
    const nodes = [node('source', 'textNode'), node('other', 'textNode'), node('target', 'regexReplaceNode')];
    const edges: Edge[] = [{ id: 'existing', source: 'other', target: 'target' }];
    const result = validateFlowConnection(connection(), { nodes, edges });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('already has its maximum');
  });

  it('does not count Portal synthetic plumbing as a second public connection', () => {
    const nodes = [node('source', 'textNode'), node('other', 'textNode'), node('target', 'regexReplaceNode')];
    const syntheticEdge: Edge = {
      id: 'portal-synthetic',
      source: 'other',
      target: 'target',
      hidden: true,
      data: { portalSynthetic: true },
    };

    expect(validateFlowConnection(connection(), { nodes, edges: [syntheticEdge] }))
      .toMatchObject({ valid: true, carriedType: { kind: 'text' } });
    expect(validateFlowConnection(syntheticEdge, {
      nodes,
      edges: [{ id: 'visible', source: 'source', target: 'target' }, syntheticEdge],
    })).toMatchObject({ valid: true, carriedType: { kind: 'text' } });

    // The existing visible-edge cardinality test above remains the authority for real capacity:
    // only the hidden Portal projection is exempt from consuming or being blocked by that slot.
  });

  it('accepts explicit package extraction on Image source ports', () => {
    const nodes = [
      node('source', 'packageNode'),
      node('target', 'imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }),
    ];

    expect(validateFlowConnection(connection({ targetHandle: 'image-edit-source' }), { nodes, edges: [] }))
      .toMatchObject({ valid: true, carriedType: { kind: 'package' } });
  });

  it.each([
    ['textNode', {}, 'text'],
    ['valueNode', { valueKind: 'json', value: '{"role":"shirt design"}' }, 'json'],
  ] as const)('accepts %s guidance after an image already occupies the same reference slot', (sourceType, sourceData, kind) => {
    const nodes = [
      node('source', sourceType, sourceData),
      node('reference-image', 'imageGen', { mediaMode: 'import' }),
      node('target', 'imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }),
    ];
    const edges: Edge[] = [{
      id: 'existing-image-reference',
      source: 'reference-image',
      target: 'target',
      targetHandle: 'image-reference-1',
    }];

    expect(validateFlowConnection(connection({ targetHandle: 'image-reference-1' }), { nodes, edges }))
      .toMatchObject({ valid: true, carriedType: { kind } });
  });

  it('rejects a second image-bearing value on one Image or Video reference slot', () => {
    for (const [targetType, targetData, targetHandle] of [
      ['imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }, 'image-reference-1'],
      ['videoGen', { provider: 'gemini', modelId: 'gemini-omni-flash-preview' }, 'video-reference-1'],
    ] as const) {
      const nodes = [
        node('source', 'imageGen', { mediaMode: 'import' }),
        node('existing', 'imageGen', { mediaMode: 'import' }),
        node('target', targetType, targetData),
      ];
      const edges: Edge[] = [{ id: 'existing-reference', source: 'existing', target: 'target', targetHandle }];
      const result = validateFlowConnection(connection({ targetHandle }), { nodes, edges });

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('maximum of 1 reference-image');
    }
  });

  it.each([
    ['textNode', {}, 'text'],
    ['valueNode', { valueKind: 'json', value: '{"shot":"full body"}' }, 'json'],
  ] as const)('accepts %s guidance after an image already occupies a Video reference slot', (sourceType, sourceData, kind) => {
    const nodes = [
      node('source', sourceType, sourceData),
      node('reference-image', 'imageGen', { mediaMode: 'import' }),
      node('target', 'videoGen', { provider: 'gemini', modelId: 'gemini-omni-flash-preview' }),
    ];
    const edges: Edge[] = [{
      id: 'existing-video-reference',
      source: 'reference-image',
      target: 'target',
      targetHandle: 'video-reference-1',
    }];

    expect(validateFlowConnection(connection({ targetHandle: 'video-reference-1' }), { nodes, edges }))
      .toMatchObject({ valid: true, carriedType: { kind } });
  });

  it('connects concrete typed lists and envelopes to generic container consumers', () => {
    const nodes = [
      node('text', 'textNode'),
      node('list', 'list', { envelopeItemKind: 'text' }),
      node('envelope', 'envelope', { envelopeItemKind: 'text' }),
      node('expander', 'expander'),
      node('length', 'listLengthNode'),
    ];
    const edges: Edge[] = [
      { id: 'text-list', source: 'text', target: 'list', targetHandle: 'list-item-0' },
      { id: 'text-envelope', source: 'text', target: 'envelope' },
    ];

    expect(validateFlowConnection(connection({ source: 'list', target: 'expander' }), { nodes, edges }))
      .toMatchObject({ valid: true, carriedType: { kind: 'list', item: { kind: 'text' } } });
    expect(validateFlowConnection(connection({ source: 'envelope', target: 'length' }), { nodes, edges }))
      .toMatchObject({ valid: true, carriedType: { kind: 'envelope', item: { kind: 'text' } } });
  });

  it.each(['text', 'number', 'boolean', 'json', 'package'] as const)(
    'accepts concrete list<%s> and envelope<%s> prompt connections',
    (kind) => {
      const nodes = [
        node('source-list', 'list', { envelopeItemKind: kind }),
        node('source-envelope', 'envelope', { envelopeItemKind: kind }),
        node('target', 'imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }),
      ];

      expect(validateFlowConnection(connection({ source: 'source-list' }), { nodes, edges: [] }))
        .toMatchObject({ valid: true, carriedType: { kind: 'list', item: { kind } } });
      expect(validateFlowConnection(connection({ source: 'source-envelope' }), { nodes, edges: [] }))
        .toMatchObject({ valid: true, carriedType: { kind: 'envelope', item: { kind } } });
    },
  );

  it('rejects envelope<mixed> on prompt ports while retaining explicit mixed media routing', () => {
    const nodes = [
      node('source', 'envelope'),
      node('target', 'imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }),
    ];

    expect(validateFlowConnection(connection(), { nodes, edges: [] })).toMatchObject({
      valid: false,
      carriedType: { kind: 'envelope', item: { kind: 'mixed' } },
    });
    expect(validateFlowConnection(connection({ targetHandle: 'image-edit-source' }), { nodes, edges: [] }))
      .toMatchObject({ valid: true, carriedType: { kind: 'envelope', item: { kind: 'mixed' } } });
  });

  it('preserves a configured container output type before it has connected items', () => {
    const nodes = [
      node('envelope', 'envelope', { envelopeItemKind: 'image' }),
      node('target', 'sourceBin'),
    ];

    expect(resolveFlowOutputType('envelope', null, { nodes, edges: [] })).toEqual({
      kind: 'envelope',
      item: { kind: 'image' },
    });
    expect(validateFlowConnection(connection({ source: 'envelope' }), { nodes, edges: [] }))
      .toMatchObject({ valid: true });
  });

  it('accepts supported Source Bin values and rejects unsupported numeric containers', () => {
    const nodes = [
      node('text', 'textNode'),
      node('text-list', 'list', { envelopeItemKind: 'text' }),
      node('number-envelope', 'envelope', { envelopeItemKind: 'number' }),
      node('target', 'sourceBin'),
    ];

    expect(validateFlowConnection(connection({ source: 'text' }), { nodes, edges: [] })).toMatchObject({ valid: true });
    expect(validateFlowConnection(connection({ source: 'text-list' }), { nodes, edges: [] })).toMatchObject({ valid: true });
    expect(validateFlowConnection(connection({ source: 'number-envelope' }), { nodes, edges: [] })).toMatchObject({ valid: false });
  });

  it.each([
    ['textNode', { mode: 'generate', provider: 'gemini', modelId: 'gemini-3.5-flash' }, null],
    ['imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }, null],
    ['videoGen', { provider: 'gemini', modelId: 'gemini-omni-flash-preview' }, 'video-prompt'],
    ['audioGen', { audioGenerationMode: 'speech' }, null],
  ] as const)('connects reusable Settings JSON to %s generation', (targetType, targetData, targetHandle) => {
    const nodes = [node('source', 'settings'), node('prompt', 'textNode'), node('target', targetType, targetData)];
    const edges: Edge[] = targetType === 'videoGen' || targetType === 'audioGen'
      ? [{ id: 'existing-prompt', source: 'prompt', target: 'target', targetHandle }]
      : [];

    expect(validateFlowConnection(connection({ targetHandle }), { nodes, edges }))
      .toMatchObject({ valid: true, carriedType: { kind: 'json' } });
  });

  it('accepts concrete lists on list-valued reusable Function inputs and concrete values on any inputs', () => {
    const nodes = [
      node('list-source', 'list', { envelopeItemKind: 'text' }),
      node('json-source', 'valueNode', { valueKind: 'json', value: '{"demo":true}' }),
      node('target', 'functionNode', {
        functionNode: {
          schemaVersion: 1,
          title: 'Flexible function',
          description: '',
          contract: {
            id: 'function-contract',
            title: 'Flexible function',
            inputPorts: [
              { id: 'list-input', key: 'items', label: 'Items', resultType: 'list', required: true, order: 0 },
              { id: 'any-input', key: 'context', label: 'Context', resultType: 'any', required: false, order: 1 },
            ],
            outputPorts: [],
            version: 1,
          },
          graph: { version: 1, nodes: [], edges: [] },
          inputBindings: [],
          outputBindings: [],
        },
      }),
    ];

    expect(validateFlowConnection(connection({ source: 'list-source', targetHandle: 'list-input' }), { nodes, edges: [] }))
      .toMatchObject({ valid: true });
    expect(validateFlowConnection(connection({ source: 'json-source', targetHandle: 'any-input' }), { nodes, edges: [] }))
      .toMatchObject({ valid: true });
  });

  it('routes an image-sequence Composition package to Source Bin but not to a video track', () => {
    const nodes = [
      node('source', 'composition', { editorExportPresetPlan: { presetId: 'png-image-sequence' } }),
      node('bin', 'sourceBin'),
      node('composition', 'composition'),
    ];

    expect(validateFlowConnection(connection({ target: 'bin' }), { nodes, edges: [] }))
      .toMatchObject({ valid: true, carriedType: { kind: 'package' } });
    expect(validateFlowConnection(connection({ target: 'composition', targetHandle: 'composition-video' }), { nodes, edges: [] }))
      .toMatchObject({ valid: false, carriedType: { kind: 'package' } });
  });
});

describe('resolveFlowOutputType', () => {
  it('infers pass-through types through switches and virtual aliases', () => {
    const nodes = [
      node('text', 'textNode'),
      node('switch', 'switchNode'),
      node('virtual', 'virtual'),
    ];
    const edges: Edge[] = [
      { id: 'text-switch', source: 'text', target: 'switch', targetHandle: 'input' },
      { id: 'switch-virtual', source: 'switch', target: 'virtual' },
    ];

    expect(resolveFlowOutputType('switch', null, { nodes, edges })).toEqual({ kind: 'text' });
    expect(resolveFlowOutputType('virtual', null, { nodes, edges })).toEqual({ kind: 'text' });
  });

  it('infers typed list and expander outputs from connected items', () => {
    const nodes = [node('image', 'imageGen'), node('list', 'list'), node('expander', 'expander')];
    const edges: Edge[] = [
      { id: 'image-list', source: 'image', target: 'list', targetHandle: 'list-item-0' },
      { id: 'list-expander', source: 'list', target: 'expander' },
    ];

    expect(resolveFlowOutputType('list', null, { nodes, edges })).toEqual({
      kind: 'list',
      item: { kind: 'image' },
    });
    expect(resolveFlowOutputType('expander', null, { nodes, edges })).toEqual({ kind: 'image' });
  });

  it('infers a portal exit from its paired entrance', () => {
    const nodes = [
      node('source', 'numberNode'),
      node('entry', 'portal', { portalRole: 'entry', portalPairId: 'pair-1' }),
      node('exit', 'portal', { portalRole: 'exit', portalPairId: 'pair-1' }),
    ];
    const edges: Edge[] = [{ id: 'source-entry', source: 'source', target: 'entry' }];

    expect(resolveFlowOutputType('exit', null, { nodes, edges })).toEqual({ kind: 'number' });
  });

  it('infers Switch Case output types from the connected key input', () => {
    const nodes = [
      node('text', 'textNode'),
      node('switch', 'switchCaseNode'),
    ];
    const edges: Edge[] = [
      { id: 'text-switch-key', source: 'text', target: 'switch', targetHandle: 'key' },
    ];

    expect(resolveFlowOutputType('switch', 'case1', { nodes, edges })).toEqual({ kind: 'text' });
    expect(resolveFlowOutputType('switch', 'case2', { nodes, edges })).toEqual({ kind: 'text' });
    expect(resolveFlowOutputType('switch', 'case3', { nodes, edges })).toEqual({ kind: 'text' });
  });

  it.each([
    ['textNode', {}, 'text', null],
    ['valueNode', { valueKind: 'json', value: '{"demo":true}' }, 'json', 'json'],
    ['imageGen', { mediaMode: 'import' }, 'image', 'image'],
  ] as const)('allows Switch Case %s pass-through to typed consumers', (sourceType, sourceData, kind, targetHandle) => {
    const targetType = kind === 'image' ? 'cropImageNode' : kind === 'json' ? 'jsonQueryNode' : 'regexReplaceNode';
    const nodes = [
      node('source', sourceType, sourceData),
      node('switch', 'switchCaseNode'),
      node('target', targetType),
    ];
    const edges: Edge[] = [
      { id: 'source-switch-key', source: 'source', target: 'switch', targetHandle: 'key' },
    ];

    expect(validateFlowConnection(connection({ source: 'switch', sourceHandle: 'case1', target: 'target', targetHandle }), { nodes, edges }))
      .toMatchObject({ valid: true, carriedType: { kind } });
  });
});

describe('annotateFlowEdge', () => {
  it('preserves an invalid legacy edge while attaching a durable contract diagnostic', () => {
    const nodes = [node('source', 'textNode'), node('target', 'cropImageNode')];
    const edge: Edge = {
      id: 'legacy',
      source: 'source',
      target: 'target',
      targetHandle: 'image',
      data: { existing: 'kept' },
    };

    expect(annotateFlowEdge(edge, { nodes, edges: [edge] })).toMatchObject({
      id: 'legacy',
      data: {
        existing: 'kept',
        flowContract: {
          valid: false,
          carriedType: { kind: 'text' },
          reason: 'text cannot connect to image or package or envelope<image> or envelope<package> or envelope<mixed>',
        },
      },
    });
  });
});
