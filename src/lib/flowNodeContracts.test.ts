import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import { FLOW_NODE_TYPES, type AppNode, type FlowNodeType, type NodeData } from '../types/flow';
import {
  FLOW_NODE_CONTRACTS,
  getFlowNodeContract,
  resolveFlowNodePorts,
  type FlowNodeContractContext,
} from './flowNodeContracts';
import { LOOP_BREAK_TARGET_HANDLE } from './flowControlHandles';

function node(type: FlowNodeType, data: NodeData = {}): AppNode {
  return { id: `${type}-1`, type, position: { x: 0, y: 0 }, data } as AppNode;
}

function context(type: FlowNodeType, data: NodeData = {}): FlowNodeContractContext {
  const current = node(type, data);
  return { node: current, nodes: [current], edges: [] };
}

describe('FLOW_NODE_CONTRACTS', () => {
  it('defines exactly one contract for every registered Flow node type', () => {
    expect(Object.keys(FLOW_NODE_CONTRACTS).sort()).toEqual([...FLOW_NODE_TYPES].sort());
  });

  it.each(FLOW_NODE_TYPES)('%s has durable audit documentation', (type) => {
    const contract = getFlowNodeContract(type);

    expect(contract.type).toBe(type);
    expect(contract.purpose.trim().length).toBeGreaterThan(12);
    expect(contract.help.trim().length).toBeGreaterThan(20);
    expect(contract.failureModes.length).toBeGreaterThan(0);
    expect(contract.failureModes.every((failure) => failure.trim().length > 8)).toBe(true);
    expect(contract.examples.length).toBeGreaterThan(0);
    expect(contract.implementation.path).toMatch(/^src\//);

    for (const example of contract.examples) {
      expect(example.title.trim()).not.toBe('');
      expect(example.description.trim().length).toBeGreaterThan(12);
      expect([...example.upstream, ...example.downstream].every((candidate) => FLOW_NODE_TYPES.includes(candidate))).toBe(true);
    }
  });

  it.each(FLOW_NODE_TYPES)('%s resolves unique port IDs per direction', (type) => {
    const ports = resolveFlowNodePorts(context(type));
    for (const direction of ['input', 'output'] as const) {
      const ids = ports.filter((port) => port.direction === direction).map((port) => port.id ?? '__default__');
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps the Group node purposeful without inventing data ports', () => {
    expect(getFlowNodeContract('groupNode').role).toBe('ui-only');
    expect(resolveFlowNodePorts(context('groupNode'))).toEqual([]);
  });

  it('exposes one media input and stable transcript/caption outputs', () => {
    const ports = resolveFlowNodePorts(context('transcriptionNode'));
    expect(ports).toHaveLength(6);
    expect(ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'media', direction: 'input', required: true, types: [{ kind: 'audio' }, { kind: 'video' }] }),
      expect.objectContaining({ id: 'transcript-text', direction: 'output', types: [{ kind: 'text' }] }),
      expect.objectContaining({ id: 'timed-transcript', direction: 'output', types: [{ kind: 'json' }] }),
      expect.objectContaining({ id: 'captions-vtt', direction: 'output', types: [{ kind: 'text' }] }),
      expect.objectContaining({ id: 'captions-srt', direction: 'output', types: [{ kind: 'text' }] }),
    ]));
  });
});

describe('dynamic Flow node contracts', () => {
  it('resolves Value output from the selected primitive kind', () => {
    expect(resolveFlowNodePorts(context('valueNode', { valueKind: 'number' }))).toContainEqual(
      expect.objectContaining({ direction: 'output', types: [{ kind: 'number' }] }),
    );
  });

  it('keeps flexible code output unknown until explicitly declared', () => {
    expect(resolveFlowNodePorts(context('javascriptNode')).find((port) => port.direction === 'output')?.types).toEqual([{ kind: 'unknown' }]);
    expect(resolveFlowNodePorts(context('javascriptNode', { declaredOutputType: 'json' })).find((port) => port.direction === 'output')?.types).toEqual([{ kind: 'json' }]);
  });

  it('resolves function boundary ports from the saved function contract', () => {
    const ports = resolveFlowNodePorts(context('functionNode', {
      functionNode: {
        schemaVersion: 1,
        title: 'Caption image',
        description: '',
        contract: {
          id: 'fn-1',
          title: 'Caption image',
          inputPorts: [{ id: 'in-image', key: 'image', label: 'Image', resultType: 'image', required: true, order: 0 }],
          outputPorts: [{ id: 'out-text', key: 'caption', label: 'Caption', resultType: 'text', required: true, order: 0 }],
          version: 1,
        },
        graph: { version: 1, nodes: [], edges: [] },
        inputBindings: [],
        outputBindings: [],
      },
    }));

    expect(ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'in-image', direction: 'input', required: true, types: [{ kind: 'image' }] }),
      expect.objectContaining({ id: 'out-text', direction: 'output', types: [{ kind: 'text' }] }),
    ]));
  });

  it('exposes every conceptual Image reference port but disables unsupported ones', () => {
    const supported = resolveFlowNodePorts(context('imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }));
    const unsupported = resolveFlowNodePorts(context('imageGen', { provider: 'stability', modelId: 'stable-image-core' }));

    expect(supported.find((port) => port.id === 'image-reference-8')?.disabledReason).toBeUndefined();
    expect(unsupported.find((port) => port.id === 'image-reference-1')?.disabledReason).toContain('does not support reference images');
  });

  it('drives Video conditioning ports from the exact provider/model contract', () => {
    const omni = resolveFlowNodePorts(context('videoGen', {
      provider: 'gemini',
      modelId: 'gemini-omni-flash-preview',
    }));
    const atlasImageToVideo = resolveFlowNodePorts(context('videoGen', {
      provider: 'atlas',
      modelId: 'google/veo3.1/image-to-video',
    }));

    expect(omni.find((port) => port.id === 'video-start-frame')?.disabledReason).toBeUndefined();
    expect(omni.find((port) => port.id === 'video-end-frame')?.disabledReason).toContain('does not support');
    expect(omni.find((port) => port.id === 'video-reference-3')?.disabledReason).toBeUndefined();
    expect(omni.find((port) => port.id === 'video-source-video')?.label).toBe('Video to edit');
    expect(atlasImageToVideo.find((port) => port.id === 'video-start-frame')?.disabledReason).toBeUndefined();
    expect(atlasImageToVideo.find((port) => port.id === 'video-reference-1')?.disabledReason).toContain('does not support');
  });

  it('drives Text media input types from the exact provider/model contract', () => {
    const gemini = resolveFlowNodePorts(context('textNode', {
      mode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-3.5-flash',
    }));
    const openai = resolveFlowNodePorts(context('textNode', {
      mode: 'generate',
      provider: 'openai',
      modelId: 'gpt-5.6-terra',
    }));
    const huggingface = resolveFlowNodePorts(context('textNode', {
      mode: 'generate',
      provider: 'huggingface',
      modelId: 'Qwen/Qwen3-4B-Thinking-2507',
    }));

    const textualPromptTypes = [
      { kind: 'number' },
      { kind: 'boolean' },
      { kind: 'json' },
      { kind: 'package' },
      { kind: 'list', item: { kind: 'text' } },
      { kind: 'list', item: { kind: 'number' } },
      { kind: 'list', item: { kind: 'boolean' } },
      { kind: 'list', item: { kind: 'json' } },
      { kind: 'list', item: { kind: 'package' } },
      { kind: 'envelope', item: { kind: 'text' } },
      { kind: 'envelope', item: { kind: 'number' } },
      { kind: 'envelope', item: { kind: 'boolean' } },
      { kind: 'envelope', item: { kind: 'json' } },
      { kind: 'envelope', item: { kind: 'package' } },
    ];

    expect(gemini.find((port) => port.direction === 'input')?.types).toEqual([
      { kind: 'text' },
      { kind: 'image' },
      { kind: 'video' },
      { kind: 'audio' },
      ...textualPromptTypes,
    ]);
    expect(openai.find((port) => port.direction === 'input')?.types).toEqual([
      { kind: 'text' },
      { kind: 'image' },
      ...textualPromptTypes,
    ]);
    expect(huggingface.find((port) => port.direction === 'input')?.types).toEqual([
      { kind: 'text' },
      ...textualPromptTypes,
    ]);
  });

  it('declares composite package and envelope extraction on Image source and reference inputs', () => {
    const ports = resolveFlowNodePorts(context('imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }));
    const compositeImageTypes = [
      { kind: 'image' },
      { kind: 'package' },
      { kind: 'envelope', item: { kind: 'image' } },
      { kind: 'envelope', item: { kind: 'package' } },
      { kind: 'envelope', item: { kind: 'mixed' } },
    ];
    const descriptiveReferenceTypes = [
      ...compositeImageTypes,
      { kind: 'text' },
      { kind: 'json' },
    ];

    expect(ports.find((port) => port.id === 'image-edit-source')?.types).toEqual(compositeImageTypes);
    expect(ports.find((port) => port.id === 'image-reference-1')).toMatchObject({
      types: descriptiveReferenceTypes,
      maxConnections: null,
    });
    expect(ports.find((port) => port.id === 'image-mask')?.types).toEqual(compositeImageTypes);
  });

  it('declares every runtime-supported composite image source on local and verification image inputs', () => {
    const compositeImageTypes = [
      { kind: 'image' },
      { kind: 'package' },
      { kind: 'envelope', item: { kind: 'image' } },
      { kind: 'envelope', item: { kind: 'package' } },
      { kind: 'envelope', item: { kind: 'mixed' } },
    ];

    expect(resolveFlowNodePorts(context('cropImageNode')).find((port) => port.id === 'image')?.types)
      .toEqual(compositeImageTypes);
    expect(resolveFlowNodePorts(context('slimgNode')).find((port) => port.id === 'image')?.types)
      .toEqual(compositeImageTypes);
    expect(resolveFlowNodePorts(context('imageFeatureExtractorNode')).find((port) => port.id === null)?.types)
      .toEqual(compositeImageTypes);
    expect(resolveFlowNodePorts(context('visionVerifyNode')).filter((port) => port.direction === 'input').slice(0, 2))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'image', types: compositeImageTypes }),
        expect.objectContaining({ id: 'refImage', types: compositeImageTypes }),
      ]));
  });

  it('allows descriptive Text and JSON beside composite images on Video reference handles', () => {
    const ports = resolveFlowNodePorts(context('videoGen', {
      provider: 'gemini',
      modelId: 'gemini-omni-flash-preview',
    }));
    const compositeImageTypes = [
      { kind: 'image' },
      { kind: 'package' },
      { kind: 'envelope', item: { kind: 'image' } },
      { kind: 'envelope', item: { kind: 'package' } },
      { kind: 'envelope', item: { kind: 'mixed' } },
    ];

    expect(ports.find((port) => port.id === 'video-start-frame')?.types).toEqual(compositeImageTypes);
    expect(ports.find((port) => port.id === 'video-end-frame')?.types).toEqual(compositeImageTypes);
    expect(ports.find((port) => port.id === 'video-reference-1')).toMatchObject({
      types: [...compositeImageTypes, { kind: 'text' }, { kind: 'json' }],
      maxConnections: null,
    });
  });

  it('enumerates concrete container types on ports that consume any list or envelope', () => {
    const expanderInput = resolveFlowNodePorts(context('expander')).find((port) => port.id === null);
    const monitorInput = resolveFlowNodePorts(context('valueMonitorNode')).find((port) => port.id === null);

    for (const expected of [
      { kind: 'list', item: { kind: 'text' } },
      { kind: 'list', item: { kind: 'image' } },
      { kind: 'envelope', item: { kind: 'json' } },
      { kind: 'envelope', item: { kind: 'audio' } },
    ]) {
      expect(expanderInput?.types).toContainEqual(expected);
      expect(monitorInput?.types).toContainEqual(expected);
    }
  });

  it('declares direct and container Source Bin inputs that can become library items', () => {
    const sourceBinInput = resolveFlowNodePorts(context('sourceBin')).find((port) => port.direction === 'input');

    expect(sourceBinInput?.types).toEqual(expect.arrayContaining([
      { kind: 'text' },
      { kind: 'image' },
      { kind: 'video' },
      { kind: 'audio' },
      { kind: 'package' },
      { kind: 'list', item: { kind: 'text' } },
      { kind: 'list', item: { kind: 'image' } },
      { kind: 'envelope', item: { kind: 'package' } },
      { kind: 'envelope', item: { kind: 'mixed' } },
    ]));
    expect(sourceBinInput?.types).not.toContainEqual({ kind: 'number' });
    expect(sourceBinInput?.types).not.toContainEqual({ kind: 'envelope', item: { kind: 'number' } });
  });

  it('declares all textual kinds plus video on the image prompt input', () => {
    const prompt = resolveFlowNodePorts(context('imageGen', { provider: 'bfl', modelId: 'flux-2-pro' }))
      .find((port) => port.id === null && port.direction === 'input');

    expect(prompt?.types).toEqual([
      { kind: 'text' },
      { kind: 'number' },
      { kind: 'boolean' },
      { kind: 'json' },
      { kind: 'package' },
      { kind: 'list', item: { kind: 'text' } },
      { kind: 'list', item: { kind: 'number' } },
      { kind: 'list', item: { kind: 'boolean' } },
      { kind: 'list', item: { kind: 'json' } },
      { kind: 'list', item: { kind: 'package' } },
      { kind: 'envelope', item: { kind: 'text' } },
      { kind: 'envelope', item: { kind: 'number' } },
      { kind: 'envelope', item: { kind: 'boolean' } },
      { kind: 'envelope', item: { kind: 'json' } },
      { kind: 'envelope', item: { kind: 'package' } },
      { kind: 'video' },
    ]);
    expect(prompt?.types).not.toContainEqual({ kind: 'audio' });
    expect(prompt?.types).not.toContainEqual({ kind: 'envelope', item: { kind: 'mixed' } });
  });

  it('distinguishes Portal entrance and exit directions', () => {
    expect(resolveFlowNodePorts(context('portal', { portalRole: 'entry' })).map((port) => port.direction)).toEqual(['input']);
    expect(resolveFlowNodePorts(context('portal', { portalRole: 'exit' })).map((port) => port.direction)).toEqual(['output']);
  });

  it('exposes an explicitly connected higher audio track even when the saved count is stale (FBL-019)', () => {
    const compositionNode = node('composition', { compositionAudioTrackCount: 1 });
    const audioNode = { id: 'audio-1', type: 'audioGen', position: { x: 0, y: 0 }, data: {} } as AppNode;
    const context: FlowNodeContractContext = {
      node: compositionNode,
      nodes: [compositionNode, audioNode],
      edges: [{
        id: 'e1',
        source: 'audio-1',
        target: compositionNode.id,
        targetHandle: 'composition-audio-3',
      } satisfies Edge],
    };

    const audioInputIds = resolveFlowNodePorts(context)
      .filter((port) => port.direction === 'input' && port.id?.startsWith('composition-audio-'))
      .map((port) => port.id);

    expect(audioInputIds).toEqual(['composition-audio-1', 'composition-audio-2', 'composition-audio-3']);
  });

  it('never exposes a Composition audio port beyond the supported track-4 boundary', () => {
    const compositionNode = node('composition', { compositionAudioTrackCount: 1 });
    const audioNode = { id: 'audio-1', type: 'audioGen', position: { x: 0, y: 0 }, data: {} } as AppNode;
    const context: FlowNodeContractContext = {
      node: compositionNode,
      nodes: [compositionNode, audioNode],
      edges: [{
        id: 'e1',
        source: 'audio-1',
        target: compositionNode.id,
        targetHandle: 'composition-audio-9',
      } satisfies Edge],
    };

    const audioInputIds = resolveFlowNodePorts(context)
      .filter((port) => port.direction === 'input' && port.id?.startsWith('composition-audio-'))
      .map((port) => port.id);

    expect(audioInputIds).toEqual(['composition-audio-1']);
  });

  it('declares image-sequence Composition output as a package instead of video', () => {
    const packageOutput = resolveFlowNodePorts(context('composition', {
      editorExportPresetPlan: { presetId: 'png-image-sequence' },
    })).find((port) => port.direction === 'output');
    const videoOutput = resolveFlowNodePorts(context('composition', {
      editorExportPresetPlan: { presetId: 'review-h264-1080p' },
    })).find((port) => port.direction === 'output');

    expect(packageOutput).toMatchObject({ label: 'Rendered image-sequence package', types: [{ kind: 'package' }] });
    expect(videoOutput).toMatchObject({ label: 'Rendered video', types: [{ kind: 'video' }] });
  });

  it.each([
    'textNode',
    'imageGen',
    'cropImageNode',
    'videoGen',
    'audioGen',
    'composition',
    'visionVerifyNode',
    'functionNode',
  ] as const)('%s exposes the Stop When control handle rendered by BaseNode', (type) => {
    expect(resolveFlowNodePorts(context(type))).toContainEqual(expect.objectContaining({
      id: LOOP_BREAK_TARGET_HANDLE,
      direction: 'input',
      types: [{ kind: 'control' }],
    }));
  });
});
