import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import { buildListItemTargetHandle } from './listNodes';
import {
  collectPromptSignalForNode,
  evaluateNodeSignal,
  getSignalIterationCount,
  signalToTextList,
} from './flowSignals';

function createNode(node: Partial<AppNode> & Pick<AppNode, 'id' | 'type'>): AppNode {
  return {
    position: { x: 0, y: 0 },
    data: {},
    ...node,
  } as AppNode;
}

describe('flow signal evaluation', () => {
  it('routes stable named outputs from non-Function nodes', () => {
    const transcription = createNode({
      id: 'scribe',
      type: 'transcriptionNode',
      data: {
        namedOutputs: {
          'timed-transcript': { result: '{"words":[]}', resultType: 'json', mimeType: 'application/json' },
          'captions-vtt': { result: 'blob:captions', resultType: 'text', assetKind: 'subtitle', mimeType: 'text/vtt' },
        },
      },
    });
    const nodesById = new Map([[transcription.id, transcription]]);

    expect(evaluateNodeSignal('scribe', [transcription], [], new Set(), nodesById, 'timed-transcript'))
      .toMatchObject({ kind: 'json', value: { words: [] }, mimeType: 'application/json' });
    expect(evaluateNodeSignal('scribe', [transcription], [], new Set(), nodesById, 'captions-vtt'))
      .toMatchObject({ kind: 'text', value: 'blob:captions', mimeType: 'text/vtt' });
  });

  it('preserves declared scalar types when routing a named Function output', () => {
    const functionNode = createNode({
      id: 'function',
      type: 'functionNode',
      data: {
        functionOutputs: {
          count: { result: '42', resultType: 'number' },
          approved: { result: 'true', resultType: 'boolean' },
          rejected: { result: false, resultType: 'boolean' },
        },
      },
    });

    expect(evaluateNodeSignal('function', [functionNode], [], new Set(), new Map([[functionNode.id, functionNode]]), 'count'))
      .toMatchObject({ kind: 'number', value: 42, diagnostics: [] });
    expect(evaluateNodeSignal('function', [functionNode], [], new Set(), new Map([[functionNode.id, functionNode]]), 'approved'))
      .toMatchObject({ kind: 'boolean', value: true, diagnostics: [] });
    expect(evaluateNodeSignal('function', [functionNode], [], new Set(), new Map([[functionNode.id, functionNode]]), 'rejected'))
      .toMatchObject({ kind: 'boolean', value: false, diagnostics: [] });
  });

  it('renders local string-template slots across casing without corrupting double braces or literal braces', () => {
    const nodes = [
      createNode({ id: 'slot-a', type: 'textNode', data: { prompt: 'alpha' } }),
      createNode({ id: 'slot-b', type: 'textNode', data: { prompt: 'bravo' } }),
      createNode({ id: 'slot-c', type: 'textNode', data: { prompt: 'charlie' } }),
      createNode({
        id: 'template',
        type: 'stringTemplateNode',
        data: { template: '{{A}} / {b} / {{c}} / {literal} / {{not-a-token}}' },
      }),
    ];
    const edges: Edge[] = [
      { id: 'a', source: 'slot-a', target: 'template', targetHandle: 'A' },
      { id: 'b', source: 'slot-b', target: 'template', targetHandle: 'B' },
      { id: 'c', source: 'slot-c', target: 'template', targetHandle: 'C' },
    ];

    const signal = evaluateNodeSignal('template', nodes, edges);

    expect(signal).toMatchObject({
      kind: 'text',
      value: 'alpha / bravo / charlie / {literal} / {{not-a-token}}',
      diagnostics: [],
    });
  });

  it('evaluates list inputs in numbered slot order when persisted edges are shuffled', () => {
    const nodes = [
      createNode({ id: 'first', type: 'textNode', data: { prompt: 'first slot' } }),
      createNode({ id: 'second', type: 'textNode', data: { prompt: 'second slot' } }),
      createNode({ id: 'list', type: 'list' }),
    ];
    const edges: Edge[] = [
      { id: 'second-edge', source: 'second', target: 'list', targetHandle: buildListItemTargetHandle(1) },
      { id: 'first-edge', source: 'first', target: 'list', targetHandle: buildListItemTargetHandle(0) },
    ];

    const signal = evaluateNodeSignal('list', nodes, edges);

    expect(signal.items?.map((item) => item.value)).toEqual(['first slot', 'second slot']);
  });

  it.each([
    ['text', ['alpha', 'beta'], ['alpha', 'beta']],
    ['number', ['1', '2'], ['1', '2']],
    ['boolean', ['true', 'false'], ['true', 'false']],
    ['json', ['{"a":1}', '{"b":2}'], ['{"a":1}', '{"b":2}']],
    ['package', ['pkg:a', 'pkg:b'], ['pkg:a', 'pkg:b']],
  ] as const)('routes concrete %s lists and envelopes through the textual prompt boundary', (kind, values, expected) => {
    for (const containerType of ['list', 'envelope'] as const) {
      const source = createNode({
        id: `source-${containerType}`,
        type: containerType,
        data: {
          envelopeItemKind: kind,
          envelopeItems: values.map((value, index) => ({
            id: `${containerType}-${index}`,
            index,
            kind,
            label: `${kind} ${index + 1}`,
            value,
          })),
        },
      });
      const target = createNode({ id: 'target', type: 'imageGen' });
      const signal = collectPromptSignalForNode('target', [source, target], [{
        id: `${containerType}-target`,
        source: source.id,
        target: target.id,
      }]);

      expect(signalToTextList(signal)).toEqual(expected);
    }
  });

  it('keeps a mixed media envelope out of the prompt signal boundary', () => {
    const source = createNode({
      id: 'mixed',
      type: 'envelope',
      data: {
        envelopeItems: [
          { id: 'text', index: 0, kind: 'text', label: 'Text', value: 'do not partially coerce' },
          { id: 'image', index: 1, kind: 'image', label: 'Image', value: 'data:image/png;base64,AAA' },
        ],
      },
    });
    const target = createNode({ id: 'target', type: 'imageGen' });

    expect(signalToTextList(collectPromptSignalForNode('target', [source, target], [{
      id: 'mixed-target', source: source.id, target: target.id,
    }]))).toEqual([]);
  });

  it('preserves generated Text envelope batches for downstream prompt execution', () => {
    const generated = createNode({
      id: 'generated',
      type: 'textNode',
      data: {
        mode: 'generate',
        result: 'first',
        envelopeItems: [
          { id: 'one', index: 0, kind: 'text', label: 'One', value: 'first' },
          { id: 'two', index: 1, kind: 'text', label: 'Two', value: 'second' },
          { id: 'three', index: 2, kind: 'text', label: 'Three', value: 'third' },
        ],
      },
    });
    const target = createNode({ id: 'target', type: 'imageGen' });

    expect(signalToTextList(collectPromptSignalForNode('target', [generated, target], [{
      id: 'generated-target', source: generated.id, target: target.id,
    }]))).toEqual(['first', 'second', 'third']);
  });

  it('short-circuits vectorized prompt routing when any connected prompt axis is empty', () => {
    const empty = createNode({ id: 'empty', type: 'envelope', data: { envelopeItemKind: 'text', envelopeItems: [] } });
    const nonempty = createNode({
      id: 'nonempty',
      type: 'envelope',
      data: {
        envelopeItemKind: 'text',
        envelopeItems: [
          { id: 'one', index: 0, kind: 'text', label: 'One', value: 'one' },
          { id: 'two', index: 1, kind: 'text', label: 'Two', value: 'two' },
        ],
      },
    });
    const target = createNode({ id: 'target', type: 'imageGen' });
    const signal = collectPromptSignalForNode('target', [empty, nonempty, target], [
      { id: 'empty-target', source: empty.id, target: target.id },
      { id: 'nonempty-target', source: nonempty.id, target: target.id },
    ]);

    expect(getSignalIterationCount(signal)).toBe(0);
    expect(signal.diagnostics).toEqual([]);
  });

  it('auto-batches a string template when one placeholder is fed by a text list', () => {
    const nodes = [
      createNode({ id: 'happy', type: 'textNode', data: { prompt: 'happy' } }),
      createNode({ id: 'angry', type: 'textNode', data: { prompt: 'angry' } }),
      createNode({ id: 'emotions', type: 'list' }),
      createNode({ id: 'template', type: 'stringTemplateNode', data: { template: 'Make this face express: {A}' } }),
      createNode({ id: 'image', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'happy', target: 'emotions', targetHandle: buildListItemTargetHandle(0) },
      { id: 'e2', source: 'angry', target: 'emotions', targetHandle: buildListItemTargetHandle(1) },
      { id: 'e3', source: 'emotions', target: 'template', targetHandle: 'A' },
      { id: 'e4', source: 'template', target: 'image' },
    ];

    const signal = collectPromptSignalForNode('image', nodes, edges);

    expect(getSignalIterationCount(signal)).toBe(2);
    expect(signalToTextList(signal)).toEqual([
      'Make this face express: happy',
      'Make this face express: angry',
    ]);
  });

  it('broadcasts scalar template inputs across list inputs', () => {
    const nodes = [
      createNode({ id: 'one', type: 'textNode', data: { prompt: 'run' } }),
      createNode({ id: 'two', type: 'textNode', data: { prompt: 'jump' } }),
      createNode({ id: 'actions', type: 'list' }),
      createNode({ id: 'subject', type: 'textNode', data: { prompt: 'the hero' } }),
      createNode({ id: 'template', type: 'stringTemplateNode', data: { template: '{B} should {A}' } }),
    ];
    const edges: Edge[] = [
      { id: 'e1', source: 'one', target: 'actions', targetHandle: buildListItemTargetHandle(0) },
      { id: 'e2', source: 'two', target: 'actions', targetHandle: buildListItemTargetHandle(1) },
      { id: 'e3', source: 'actions', target: 'template', targetHandle: 'A' },
      { id: 'e4', source: 'subject', target: 'template', targetHandle: 'B' },
    ];

    expect(signalToTextList(evaluateNodeSignal('template', nodes, edges))).toEqual([
      'the hero should run',
      'the hero should jump',
    ]);
  });

  it('surfaces a critical diagnostic for incompatible paired list lengths', () => {
    const nodes = [
      createNode({ id: 'a1', type: 'textNode', data: { prompt: 'a1' } }),
      createNode({ id: 'a2', type: 'textNode', data: { prompt: 'a2' } }),
      createNode({ id: 'b1', type: 'textNode', data: { prompt: 'b1' } }),
      createNode({ id: 'b2', type: 'textNode', data: { prompt: 'b2' } }),
      createNode({ id: 'b3', type: 'textNode', data: { prompt: 'b3' } }),
      createNode({ id: 'list-a', type: 'list' }),
      createNode({ id: 'list-b', type: 'list' }),
      createNode({ id: 'template', type: 'stringTemplateNode', data: { template: '{A}/{B}' } }),
    ];
    const edges: Edge[] = [
      { id: 'ea1', source: 'a1', target: 'list-a', targetHandle: buildListItemTargetHandle(0) },
      { id: 'ea2', source: 'a2', target: 'list-a', targetHandle: buildListItemTargetHandle(1) },
      { id: 'eb1', source: 'b1', target: 'list-b', targetHandle: buildListItemTargetHandle(0) },
      { id: 'eb2', source: 'b2', target: 'list-b', targetHandle: buildListItemTargetHandle(1) },
      { id: 'eb3', source: 'b3', target: 'list-b', targetHandle: buildListItemTargetHandle(2) },
      { id: 'ta', source: 'list-a', target: 'template', targetHandle: 'A' },
      { id: 'tb', source: 'list-b', target: 'template', targetHandle: 'B' },
    ];

    const signal = evaluateNodeSignal('template', nodes, edges);

    expect(signal.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'critical',
        nodeId: 'template',
        blocksRun: true,
      }),
    ]);
  });

  it('includes connected color swatches as prompt context for image generation', () => {
    const nodes = [
      createNode({ id: 'prompt', type: 'textNode', data: { prompt: 'A mountain observatory at dawn' } }),
      createNode({
        id: 'palette',
        type: 'colorSwatchNode' as AppNode['type'],
        data: {
          colorSwatchColors: ['#0f172a', '#38bdf8', '#facc15'],
          colorSwatchUsageMode: 'primary',
        },
      }),
      createNode({ id: 'image', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      { id: 'prompt-edge', source: 'prompt', target: 'image' },
      { id: 'palette-edge', source: 'palette', target: 'image' },
    ];

    expect(signalToTextList(collectPromptSignalForNode('image', nodes, edges))).toEqual([
      [
        'A mountain observatory at dawn',
        'Color swatch: #0F172A, #38BDF8, #FACC15. Use these colors primarily and keep generated media aligned with this palette.',
      ].join('\n\n'),
    ]);
  });

  it('combines Text and JSON descriptions attached beside an image on one reference slot', () => {
    const nodes = [
      createNode({ id: 'reference-image', type: 'imageGen', data: { result: 'data:image/png;base64,SHIRT' } }),
      createNode({ id: 'reference-text', type: 'textNode', data: { prompt: 'Preserve the exact shirt cut and chest logo placement.' } }),
      createNode({ id: 'reference-json', type: 'valueNode', data: { valueKind: 'json', value: '{"role":"wardrobe reference","priority":"high"}' } }),
      createNode({ id: 'target-image', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      { id: 'image-edge', source: 'reference-image', target: 'target-image', targetHandle: 'image-reference-1' },
      { id: 'text-edge', source: 'reference-text', target: 'target-image', targetHandle: 'image-reference-1' },
      { id: 'json-edge', source: 'reference-json', target: 'target-image', targetHandle: 'image-reference-1' },
    ];

    expect(signalToTextList(collectPromptSignalForNode('target-image', nodes, edges))).toEqual([
      'Preserve the exact shirt cut and chest logo placement.\n\n{"role":"wardrobe reference","priority":"high"}',
    ]);
  });

  it('keeps execution-only Settings and LoRA JSON out of creative prompts while preserving JSON context values', () => {
    const nodes = [
      createNode({ id: 'settings', type: 'settings', data: { aspectRatio: '4:5', steps: 30 } }),
      createNode({ id: 'lora', type: 'loraSpecNode', data: { loraEntries: [{ path: 'demo/style', scale: 0.8 }] } }),
      createNode({ id: 'context', type: 'valueNode', data: { valueKind: 'json', value: '{"campaign":"demo"}' } }),
      createNode({ id: 'prompt', type: 'textNode', data: { prompt: 'Editorial portrait' } }),
      createNode({ id: 'image', type: 'imageGen' }),
    ];
    const edges: Edge[] = [
      { id: 'settings-image', source: 'settings', target: 'image' },
      { id: 'lora-image', source: 'lora', target: 'image' },
      { id: 'context-image', source: 'context', target: 'image' },
      { id: 'prompt-image', source: 'prompt', target: 'image' },
    ];

    expect(signalToTextList(collectPromptSignalForNode('image', nodes, edges))).toEqual([
      '{"campaign":"demo"}\n\nEditorial portrait',
    ]);
  });

  it('resolves named generated attempts inside text-node prompts', () => {
    const nodes = [
      createNode({
        id: 'image-result',
        type: 'imageGen',
        data: {
          resultHistory: [{
            id: 'attempt-1',
            result: 'data:image/png;base64,HERO',
            resultType: 'image',
            statusMessage: 'Generated',
            createdAt: '2026-06-03T12:00:00.000Z',
            variableName: 'hero_pose',
          }],
        },
      }),
      createNode({ id: 'prompt', type: 'textNode', data: { prompt: 'Match {{hero_pose}}.' } }),
    ];

    expect(signalToTextList(evaluateNodeSignal('prompt', nodes, []))).toEqual([
      'Match data:image/png;base64,HERO.',
    ]);
  });

  it('resolves indexed collection variables without breaking connected string-template handles', () => {
    const nodes = [
      createNode({
        id: 'poses',
        type: 'envelope',
        data: {
          flowVariableName: 'hero_poses',
          envelopeItems: [
            { id: 'pose-1', index: 0, kind: 'text', label: 'Pose 1', value: 'standing pose' },
            { id: 'pose-2', index: 1, kind: 'text', label: 'Pose 2', value: 'running pose' },
          ],
        },
      }),
      createNode({ id: 'subject', type: 'textNode', data: { prompt: 'the main character' } }),
      createNode({
        id: 'template',
        type: 'stringTemplateNode',
        data: { template: 'Use {{hero_poses[2]}} for {A}.' },
      }),
    ];
    const edges: Edge[] = [
      { id: 'edge-subject', source: 'subject', target: 'template', targetHandle: 'A' },
    ];

    expect(signalToTextList(evaluateNodeSignal('template', nodes, edges))).toEqual([
      'Use running pose for the main character.',
    ]);
  });

  it('evaluates Python node transpilation and execution with variables', () => {
    const nodes = [
      createNode({ id: 'inA', type: 'textNode', data: { prompt: 'Hello' } }),
      createNode({ id: 'inB', type: 'textNode', data: { prompt: 'World' } }),
      createNode({
        id: 'pyNode',
        type: 'pythonNode' as AppNode['type'],
        data: {
          code: '# Return concatenation\nreturn A + " " + B + "!"',
        },
      }),
    ];
    const edges: Edge[] = [
      { id: 'ea', source: 'inA', target: 'pyNode', targetHandle: 'A' },
      { id: 'eb', source: 'inB', target: 'pyNode', targetHandle: 'B' },
    ];

    expect(signalToTextList(evaluateNodeSignal('pyNode', nodes, edges))).toEqual([
      'Hello World!',
    ]);
  });

  it('accepts flexible-node values that match their declared output type', () => {
    const nodes = [
      createNode({
        id: 'script',
        type: 'javascriptNode',
        data: { code: 'return 42;', declaredOutputType: 'number' },
      }),
    ];

    const signal = evaluateNodeSignal('script', nodes, []);

    expect(signal.kind).toBe('number');
    expect(signal.value).toBe(42);
    expect(signal.diagnostics).toEqual([]);
  });

  it.each([
    ['javascriptNode', { code: 'return "hello";', declaredOutputType: 'number' }],
    ['pythonNode', { code: 'return "hello"', declaredOutputType: 'number' }],
    ['apiFetchNode', { result: '{"ok":true}', resultType: 'json', declaredOutputType: 'text' }],
  ] as const)('blocks %s when its actual value violates the declared output type', (type, data) => {
    const node = createNode({ id: 'flexible', type, data });
    const signal = evaluateNodeSignal(node.id, [node], []);

    expect(signal.diagnostics).toContainEqual(expect.objectContaining({
      id: 'declared-output-mismatch-flexible',
      severity: 'critical',
      nodeId: 'flexible',
      blocksRun: true,
      message: expect.stringContaining('declared a'),
    }));
  });

  it('evaluates the story utility nodes according to their declared contracts', () => {
    const nodes = [
      createNode({ id: 'index', type: 'numberNode', data: { value: 3 } }),
      createNode({ id: 'seed', type: 'seedSequencerNode', data: { seed: 100, increment: 5 } }),
      createNode({ id: 'a', type: 'textNode', data: { prompt: 'watercolor portrait' } }),
      createNode({ id: 'b', type: 'textNode', data: { prompt: 'dramatic rim light' } }),
      createNode({ id: 'mix', type: 'promptMixerNode', data: { weight: 25 } }),
      createNode({ id: 'state-value', type: 'valueNode', data: { valueKind: 'boolean', value: true } }),
      createNode({ id: 'state', type: 'storyStateNode', data: { key: 'injured', value: 'false' } }),
      createNode({ id: 'dialogue', type: 'textNode', data: { prompt: 'MARA: Hello\nJON: Wait\n  MARA: Goodbye' } }),
      createNode({ id: 'split', type: 'dialogueScriptSplitterNode', data: { prefix: 'MARA:' } }),
      createNode({ id: 'sentiment-text', type: 'textNode', data: { prompt: 'I love this wonderful, joyful day.' } }),
      createNode({ id: 'sentiment', type: 'textSentimentAnalysisNode' }),
    ];
    const edges: Edge[] = [
      { id: 'index-seed', source: 'index', target: 'seed' },
      { id: 'a-mix', source: 'a', target: 'mix', targetHandle: 'A' },
      { id: 'b-mix', source: 'b', target: 'mix', targetHandle: 'B' },
      { id: 'value-state', source: 'state-value', target: 'state' },
      { id: 'dialogue-split', source: 'dialogue', target: 'split' },
      { id: 'text-sentiment', source: 'sentiment-text', target: 'sentiment' },
    ];

    expect(evaluateNodeSignal('seed', nodes, edges)).toMatchObject({ kind: 'number', value: 115 });
    expect(evaluateNodeSignal('mix', nodes, edges)).toMatchObject({
      kind: 'text',
      value: '[watercolor portrait — 25% emphasis]\n[dramatic rim light — 75% emphasis]',
    });
    expect(evaluateNodeSignal('state', nodes, edges)).toMatchObject({ kind: 'json', value: { injured: true } });
    expect(evaluateNodeSignal('split', nodes, edges)).toMatchObject({
      kind: 'list',
      value: ['Hello', 'Goodbye'],
    });
    expect(evaluateNodeSignal('sentiment', nodes, edges)).toMatchObject({
      kind: 'json',
      value: expect.objectContaining({ label: 'positive', score: expect.any(Number) }),
    });
  });

  it('implements filters, gates, fallback, and branch-specific source handles', () => {
    const nodes = [
      createNode({ id: 'prompt', type: 'textNode', data: { prompt: 'A clean portrait' } }),
      createNode({ id: 'avoid', type: 'textNode', data: { prompt: 'blur, watermark' } }),
      createNode({ id: 'negative', type: 'negativePromptNode' }),
      createNode({ id: 'yes', type: 'valueNode', data: { valueKind: 'boolean', value: true } }),
      createNode({ id: 'no', type: 'valueNode', data: { valueKind: 'boolean', value: false } }),
      createNode({ id: 'gate', type: 'loopGateNode' }),
      createNode({ id: 'empty', type: 'textNode', data: { prompt: '' } }),
      createNode({ id: 'backup', type: 'textNode', data: { prompt: 'fallback value' } }),
      createNode({ id: 'fallback', type: 'fallbackSelectorNode' }),
      createNode({ id: 'fork', type: 'forkSwitchNode', data: { selectedOutput: 'A' } }),
      createNode({ id: 'monitor-a', type: 'valueMonitorNode' }),
      createNode({ id: 'monitor-b', type: 'valueMonitorNode' }),
      createNode({ id: 'case-key', type: 'textNode', data: { prompt: 'B' } }),
      createNode({ id: 'cases', type: 'switchCaseNode', data: { case1Val: 'A', case2Val: 'B', case3Val: 'C' } }),
      createNode({ id: 'case-two', type: 'valueMonitorNode' }),
      createNode({ id: 'case-one', type: 'valueMonitorNode' }),
    ];
    const edges: Edge[] = [
      { id: 'prompt-negative', source: 'prompt', target: 'negative', targetHandle: 'text' },
      { id: 'avoid-negative', source: 'avoid', target: 'negative', targetHandle: 'exclude' },
      { id: 'prompt-gate', source: 'prompt', target: 'gate', targetHandle: 'input' },
      { id: 'no-gate', source: 'no', target: 'gate', targetHandle: 'condition' },
      { id: 'empty-primary', source: 'empty', target: 'fallback', targetHandle: 'primary' },
      { id: 'backup-fallback', source: 'backup', target: 'fallback', targetHandle: 'fallback' },
      { id: 'prompt-fork', source: 'prompt', target: 'fork', targetHandle: 'input' },
      { id: 'yes-fork', source: 'yes', target: 'fork', targetHandle: 'condition' },
      { id: 'fork-a', source: 'fork', sourceHandle: 'A', target: 'monitor-a' },
      { id: 'fork-b', source: 'fork', sourceHandle: 'B', target: 'monitor-b' },
      { id: 'key-cases', source: 'case-key', target: 'cases', targetHandle: 'key' },
      { id: 'case-2', source: 'cases', sourceHandle: 'case2', target: 'case-two' },
      { id: 'case-1', source: 'cases', sourceHandle: 'case1', target: 'case-one' },
    ];

    expect(evaluateNodeSignal('negative', nodes, edges).value).toBe('A clean portrait\nAvoid: blur, watermark');
    expect(evaluateNodeSignal('gate', nodes, edges)).toMatchObject({ kind: 'text', value: '' });
    expect(evaluateNodeSignal('fallback', nodes, edges).value).toBe('fallback value');
    expect(evaluateNodeSignal('monitor-a', nodes, edges).value).toBe('A clean portrait');
    expect(evaluateNodeSignal('monitor-b', nodes, edges).value).toBe('');
    expect(evaluateNodeSignal('case-two', nodes, edges).value).toBe('B');
    expect(evaluateNodeSignal('case-one', nodes, edges).value).toBe('');
  });

  it('emits honest typed values for config, palette, LoRA, doodle, editor, and feature nodes', () => {
    const nodes = [
      createNode({ id: 'config', type: 'settings', data: { aspectRatio: '16:9', steps: 30, durationSeconds: 6 } }),
      createNode({ id: 'palette', type: 'colorSwatchNode', data: { colorSwatchColors: ['#112233', '#aabbcc'] } }),
      createNode({ id: 'template', type: 'stringTemplateNode', data: { template: 'Color {A}' } }),
      createNode({ id: 'lora', type: 'loraSpecNode', data: { loraEntries: [{ path: 'org/style', scale: 0.8 }] } }),
      createNode({ id: 'doodle', type: 'doodleNode', data: { doodleDescription: 'rough fox', doodleSketch: 'data:image/png;base64,AAAA' } }),
      createNode({ id: 'editor', type: 'advancedImageEditor', data: { result: 'data:image/png;base64,EDIT' } }),
      createNode({ id: 'features', type: 'imageFeatureExtractorNode', data: { imageFeatures: { width: 640, height: 480, averageColor: '#123456' } } }),
    ];
    const edges: Edge[] = [
      { id: 'color-template', source: 'palette', sourceHandle: 'palette-color-1', target: 'template', targetHandle: 'A' },
    ];

    expect(evaluateNodeSignal('config', nodes, edges)).toMatchObject({
      kind: 'json',
      value: expect.objectContaining({ aspectRatio: '16:9', steps: 30, durationSeconds: 6 }),
    });
    expect(evaluateNodeSignal('template', nodes, edges).value).toBe('Color #AABBCC');
    expect(evaluateNodeSignal('lora', nodes, edges)).toMatchObject({
      kind: 'json',
      value: [{ path: 'org/style', scale: 0.8 }],
    });
    expect(evaluateNodeSignal('doodle', nodes, edges)).toMatchObject({ kind: 'package', value: 'rough fox' });
    expect(evaluateNodeSignal('editor', nodes, edges)).toMatchObject({ kind: 'image', value: 'data:image/png;base64,EDIT' });
    expect(evaluateNodeSignal('features', nodes, edges)).toMatchObject({
      kind: 'json',
      value: { width: 640, height: 480, averageColor: '#123456' },
    });
  });

  it('evaluates JSON Builder nodes correctly rendering input signals', () => {
    const nodes = [
      createNode({ id: 'valA', type: 'textNode', data: { prompt: 'John' } }),
      createNode({ id: 'valB', type: 'textNode', data: { prompt: 'Doe' } }),
      createNode({
        id: 'jsonBuilder',
        type: 'jsonBuilderNode' as AppNode['type'],
        data: {
          template: '{\n  "firstName": "{{A}}",\n  "lastName": "{{B}}"\n}',
        },
      }),
    ];
    const edges: Edge[] = [
      { id: 'ea', source: 'valA', target: 'jsonBuilder', targetHandle: 'A' },
      { id: 'eb', source: 'valB', target: 'jsonBuilder', targetHandle: 'B' },
    ];

    const signal = evaluateNodeSignal('jsonBuilder', nodes, edges);
    expect(signal.kind).toBe('json');
    expect(signal.value).toEqual({
      firstName: 'John',
      lastName: 'Doe',
    });
  });

  it('evaluates HTML Sandbox nodes combining HTML, CSS, and JS', () => {
    const nodes = [
      createNode({ id: 'inHtml', type: 'textNode', data: { prompt: '<div>Content</div>' } }),
      createNode({
        id: 'htmlSandbox',
        type: 'htmlSandboxNode' as AppNode['type'],
        data: {
          css: 'div { color: red; }',
          js: 'console.log("hello");',
        },
      }),
    ];
    const edges: Edge[] = [
      { id: 'eh', source: 'inHtml', target: 'htmlSandbox', targetHandle: 'html' },
    ];

    const signal = evaluateNodeSignal('htmlSandbox', nodes, edges);
    expect(signalToTextList(signal)[0]).toContain('<div>Content</div>');
    expect(signalToTextList(signal)[0]).toContain('<style>div { color: red; }</style>');
    expect(signalToTextList(signal)[0]).toContain('<script>console.log("hello");</script>');
  });

  it('evaluates API Fetch nodes returning the configured static mock output', () => {
    const nodes = [
      createNode({
        id: 'apiNode',
        type: 'apiFetchNode' as AppNode['type'],
        data: {
          result: '{"ok": true}',
          resultType: 'json',
        },
      }),
    ];

    const signal = evaluateNodeSignal('apiNode', nodes, []);
    expect(signal.kind).toBe('json');
    expect(signal.value).toBe('{"ok": true}');
  });

  it('evaluates sqlQueryNode selecting and joining collections', () => {
    const nodes = [
      createNode({
        id: 'tableA',
        type: 'list',
        data: {
          // A is user list
        }
      }),
      createNode({
        id: 'tableB',
        type: 'list',
        data: {}
      }),
      createNode({
        id: 'sqlNode',
        type: 'sqlQueryNode' as AppNode['type'],
        data: {
          query: 'SELECT A.name, B.title FROM A JOIN B ON A.id = B.userId WHERE A.active = true ORDER BY B.title DESC LIMIT 1'
        }
      })
    ];

    // Mock incoming signals directly via evaluated signals
    // Let's create user elements for A
    const users = [
      { id: 1, name: 'Alice', active: true },
      { id: 2, name: 'Bob', active: false },
      { id: 3, name: 'Charlie', active: true }
    ];
    const posts = [
      { userId: 1, title: 'Learn React' },
      { userId: 3, title: 'Learn SQL' },
      { userId: 1, title: 'Advanced Nodes' }
    ];

    // We can connect inputs to sqlNode using edges and list nodes, or evaluate list nodes as json
    // But sqlQueryNode expects list input on handles 'A' and 'B'.
    // Let's create textNode elements containing stringified arrays, or list nodes that compile users and posts.
    // Actually, in evaluateSqlQueryNode, A and B are parsed from signals on handles 'A' and 'B'.
    // So let's connect list or JSON-carrying nodes to sqlNode.
    const userNode = createNode({ id: 'users', type: 'textNode', data: { prompt: JSON.stringify(users) } });
    const postNode = createNode({ id: 'posts', type: 'textNode', data: { prompt: JSON.stringify(posts) } });

    const testNodes = [userNode, postNode, nodes[2]];
    const edges: Edge[] = [
      { id: 'ea', source: 'users', target: 'sqlNode', targetHandle: 'A' },
      { id: 'eb', source: 'posts', target: 'sqlNode', targetHandle: 'B' }
    ];

    const result = evaluateNodeSignal('sqlNode', testNodes, edges);
    expect(result.kind).toBe('list');
    expect(result.value).toHaveLength(1);
    // Alice matched with 'Learn SQL' (Charlie) vs 'Learn React'/'Advanced Nodes' (Alice). 
    // Alice posts: 'Learn React', 'Advanced Nodes'. Charlie post: 'Learn SQL'.
    // active users are Alice (1) and Charlie (3).
    // Joins:
    // User 1 (Alice) with post 'Learn React' (title DESC: 'Learn SQL' > 'Learn React' > 'Advanced Nodes')
    // Let's see:
    // titles sorted DESC:
    // 'Learn SQL' (Charlie, userId 3, active=true)
    // 'Learn React' (Alice, userId 1, active=true)
    // 'Advanced Nodes' (Alice, userId 1, active=true)
    // Order DESC: 'Learn SQL' -> 'Learn React' -> 'Advanced Nodes'
    // Limit 1 should return Charlie + 'Learn SQL'
    expect((result.value as any[])[0]).toEqual({
      name: 'Charlie',
      title: 'Learn SQL'
    });
  });

  it('evaluates csvParserNode bidirectionally (parsing and formatting)', () => {
    // 1. Parsing mode
    const csvContent = 'id,name,active\n1,Alice,true\n2,Bob,false';
    const csvNode = createNode({ id: 'csv', type: 'textNode', data: { prompt: csvContent } });
    const parserNode = createNode({
      id: 'parser',
      type: 'csvParserNode' as AppNode['type'],
      data: {
        mode: 'parse',
        delimiter: ','
      }
    });

    const parseNodes = [csvNode, parserNode];
    const parseEdges: Edge[] = [
      { id: 'e1', source: 'csv', target: 'parser', targetHandle: 'csv' }
    ];

    const parseResult = evaluateNodeSignal('parser', parseNodes, parseEdges);
    expect(parseResult.kind).toBe('list');
    expect(parseResult.value).toHaveLength(2);
    expect((parseResult.value as any[])[0]).toEqual({ id: 1, name: 'Alice', active: true });
    expect((parseResult.value as any[])[1]).toEqual({ id: 2, name: 'Bob', active: false });

    // 2. Formatting mode
    const records = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ];
    const jsonNode = createNode({
      id: 'json',
      type: 'valueNode',
      data: {
        valueKind: 'json',
        value: JSON.stringify(records)
      }
    });
    const formatterNode = createNode({
      id: 'formatter',
      type: 'csvParserNode' as AppNode['type'],
      data: {
        mode: 'format',
        delimiter: ';'
      }
    });

    const formatNodes = [jsonNode, formatterNode];
    const formatEdges: Edge[] = [
      { id: 'e2', source: 'json', target: 'formatter', targetHandle: 'csv' }
    ];

    const formatResult = evaluateNodeSignal('formatter', formatNodes, formatEdges);
    expect(formatResult.kind).toBe('text');
    expect(formatResult.value).toBe('id;name\n1;Alice\n2;Bob');
  });

  it('evaluates mathExpressionNode parsing and evaluating multi-variable formulas', () => {
    const nodeA = createNode({ id: 'nA', type: 'textNode', data: { prompt: '10' } });
    const nodeB = createNode({ id: 'nB', type: 'textNode', data: { prompt: '16' } });
    const nodeC = createNode({ id: 'nC', type: 'textNode', data: { prompt: '3' } });
    const mathNode = createNode({
      id: 'mathExpr',
      type: 'mathExpressionNode' as AppNode['type'],
      data: {
        expression: 'A + sqrt(B) * C - pow(2, 3)' // 10 + 4 * 3 - 8 = 10 + 12 - 8 = 14
      }
    });

    const nodes = [nodeA, nodeB, nodeC, mathNode];
    const edges: Edge[] = [
      { id: 'ea', source: 'nA', target: 'mathExpr', targetHandle: 'A' },
      { id: 'eb', source: 'nB', target: 'mathExpr', targetHandle: 'B' },
      { id: 'ec', source: 'nC', target: 'mathExpr', targetHandle: 'C' }
    ];

    const result = evaluateNodeSignal('mathExpr', nodes, edges);
    expect(result.kind).toBe('number');
    expect(result.value).toBe(14);
  });

  it('evaluates xmlYamlNode bidirectionally for XML and YAML', () => {
    // 1. XML to JSON
    const xmlContent = '<root><user><id>1</id><name>Alice</name></user></root>';
    const xmlInput = createNode({ id: 'xml', type: 'textNode', data: { prompt: xmlContent } });
    const xmlNode = createNode({
      id: 'xmlParser',
      type: 'xmlYamlNode' as AppNode['type'],
      data: { mode: 'xml-to-json' }
    });

    const xmlNodes = [xmlInput, xmlNode];
    const xmlEdges: Edge[] = [
      { id: 'e1', source: 'xml', target: 'xmlParser', targetHandle: 'text' }
    ];

    const xmlResult = evaluateNodeSignal('xmlParser', xmlNodes, xmlEdges);
    expect(xmlResult.kind).toBe('json');
    expect(xmlResult.value).toEqual({
      root: {
        user: {
          id: 1,
          name: 'Alice'
        }
      }
    });

    // 2. JSON to XML
    const jsonObj = { root: { item: [1, 2] } };
    const jsonInput = createNode({
      id: 'json',
      type: 'valueNode',
      data: {
        valueKind: 'json',
        value: JSON.stringify(jsonObj)
      }
    });
    const xmlFormatter = createNode({
      id: 'xmlFormatter',
      type: 'xmlYamlNode' as AppNode['type'],
      data: { mode: 'json-to-xml' }
    });

    const xmlFormatNodes = [jsonInput, xmlFormatter];
    const xmlFormatEdges: Edge[] = [
      { id: 'e2', source: 'json', target: 'xmlFormatter', targetHandle: 'text' }
    ];

    const xmlFormatResult = evaluateNodeSignal('xmlFormatter', xmlFormatNodes, xmlFormatEdges);
    expect(xmlFormatResult.kind).toBe('text');
    expect((xmlFormatResult.value as string).replace(/\s+/g, '')).toBe('<root><item>1</item><item>2</item></root>');

    // 3. YAML to JSON
    const yamlContent = 'user:\n  id: 1\n  name: Alice';
    const yamlInput = createNode({ id: 'yaml', type: 'textNode', data: { prompt: yamlContent } });
    const yamlNode = createNode({
      id: 'yamlParser',
      type: 'xmlYamlNode' as AppNode['type'],
      data: { mode: 'yaml-to-json' }
    });

    const yamlNodes = [yamlInput, yamlNode];
    const yamlEdges: Edge[] = [
      { id: 'e3', source: 'yaml', target: 'yamlParser', targetHandle: 'text' }
    ];

    const yamlResult = evaluateNodeSignal('yamlParser', yamlNodes, yamlEdges);
    expect(yamlResult.kind).toBe('json');
    expect(yamlResult.value).toEqual({
      user: {
        id: 1,
        name: 'Alice'
      }
    });

    // 4. JSON to YAML
    const jsonInputForYaml = createNode({
      id: 'jsonForYaml',
      type: 'valueNode',
      data: {
        valueKind: 'json',
        value: JSON.stringify({ user: { id: 1, name: 'Alice' } })
      }
    });
    const yamlFormatter = createNode({
      id: 'yamlFormatter',
      type: 'xmlYamlNode' as AppNode['type'],
      data: { mode: 'json-to-yaml' }
    });

    const yamlFormatNodes = [jsonInputForYaml, yamlFormatter];
    const yamlFormatEdges: Edge[] = [
      { id: 'e4', source: 'jsonForYaml', target: 'yamlFormatter', targetHandle: 'text' }
    ];

    const yamlFormatResult = evaluateNodeSignal('yamlFormatter', yamlFormatNodes, yamlFormatEdges);
    expect(yamlFormatResult.kind).toBe('text');
    expect((yamlFormatResult.value as string).trim().replace(/\r?\n/g, '\n')).toBe('user:\n  id: 1\n  name: Alice');
  });

  it('uses a doodle node\'s typed description as its text signal when nothing is attached', () => {
    const nodes = [createNode({ id: 'doodle', type: 'doodleNode', data: { doodleDescription: 'a sleepy fox' } })];
    expect(signalToTextList(evaluateNodeSignal('doodle', nodes, []))).toEqual(['a sleepy fox']);
  });

  it('lets a Text node attached to a doodle node override its typed description', () => {
    const nodes = [
      createNode({ id: 'caption', type: 'textNode', data: { prompt: 'a fox in a raincoat' } }),
      createNode({ id: 'doodle', type: 'doodleNode', data: { doodleDescription: 'typed fallback' } }),
    ];
    const edges: Edge[] = [{ id: 'e1', source: 'caption', target: 'doodle' }];
    expect(signalToTextList(evaluateNodeSignal('doodle', nodes, edges))).toEqual(['a fox in a raincoat']);
  });
});
