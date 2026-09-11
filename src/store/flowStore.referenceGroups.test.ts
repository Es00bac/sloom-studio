// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';
import type { ExecutionContext } from '../lib/flowExecution';
import { executeNodeRequest, hashExecutionParameters } from '../lib/flowExecution';
import { createDefaultFunctionNodeConfig } from '../lib/functionNodes';
import { useFlowStore } from './flowStore';
import { useConfirmationStore } from './confirmationStore';
import { useSettingsStore } from './settingsStore';
import { useSourceBinStore } from './sourceBinStore';
import { useProjectUsageStore } from './projectUsageStore';

/**
 * AUD-011: the run pipeline must carry a structured, slot-numbered reference-group representation
 * from the authored edges into every ExecutionContext, keep numbered guidance out of the global
 * prompt, and make slot association part of the execution fingerprint so swapping two descriptions
 * (with identical flattened bytes) invalidates resume instead of silently reusing stale output.
 */

const capturedContexts: {
  nodeId: string;
  context: ExecutionContext;
}[] = [];

function imageResultDataUrl(nodeId: string, index: number): string {
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),
    (character) => character.charCodeAt(0),
  );
  const payload = new TextEncoder().encode(`Result\0${nodeId}:${index}`);
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4);
  chunk.set(payload, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, 8 + payload.length)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  view.setUint32(8 + payload.length, (crc ^ 0xffffffff) >>> 0);
  const bytes = new Uint8Array(png.length + chunk.length);
  bytes.set(png.subarray(0, 33));
  bytes.set(chunk, 33);
  bytes.set(png.subarray(33), 33 + chunk.length);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

vi.mock('../lib/flowExecution', async () => {
  const actual = await vi.importActual<typeof import('../lib/flowExecution')>('../lib/flowExecution');
  return {
    ...actual,
    hashExecutionParameters: vi.fn(actual.hashExecutionParameters),
    executeNodeRequest: vi.fn(async (node: AppNode, context: ExecutionContext) => {
      capturedContexts.push({ nodeId: node.id, context });
      return {
        result: imageResultDataUrl(node.id, capturedContexts.length),
        resultType: 'image' as const,
        statusMessage: 'Done',
      };
    }),
  };
});

const IMAGE_A = 'data:image/png;base64,QUFB';
const IMAGE_B = 'data:image/png;base64,QkJC';
const IMAGE_F = 'data:image/png;base64,RkZG';

function createNode(id: string, type: AppNode['type'], data: Record<string, unknown> = {}): AppNode {
  return { id, type, position: { x: 0, y: 0 }, data } as AppNode;
}

function createRootImageNode(id = 'root', data: Record<string, unknown> = {}): AppNode {
  return createNode(id, 'imageGen', {
    mediaMode: 'generate',
    provider: 'bfl',
    modelId: 'flux-2-pro',
    ...data,
  });
}

function createStaticImageSource(id: string, assetUrl: string): AppNode {
  // Import-mode image nodes are pure asset sources (canRunNode false), so the run pipeline can
  // never re-execute them and their URL stays byte-stable across both runs of a test.
  return createNode(id, 'imageGen', { mediaMode: 'import', sourceAssetUrl: assetUrl, resultType: 'image' });
}

function createTextEnvelopeNode(id: string, values: string[]) {
  return createNode(id, 'envelope', {
    envelopeItemKind: 'text',
    envelopeItems: values.map((value, index) => ({
      id: `${id}-${index}`,
      index,
      kind: 'text',
      label: `Prompt ${index + 1}`,
      value,
    })),
  });
}

function createImageEnvelopeNode(id: string, values: string[]) {
  return createNode(id, 'envelope', {
    envelopeItemKind: 'image',
    envelopeItems: values.map((value, index) => ({
      id: `${id}-${index}`,
      index,
      kind: 'image',
      label: `Image ${index + 1}`,
      value,
      mimeType: 'image/png',
    })),
  });
}

function rootContexts(rootId: string): ExecutionContext[] {
  return capturedContexts.filter((call) => call.nodeId === rootId).map((call) => call.context);
}

const baselineRuntimeSettings: RuntimeSettingsSnapshot = {
  apiKeys: { ...useSettingsStore.getState().apiKeys },
  defaultModels: {
    text: { ...useSettingsStore.getState().defaultModels.text },
    image: { ...useSettingsStore.getState().defaultModels.image },
    video: { ...useSettingsStore.getState().defaultModels.video },
    audio: { ...useSettingsStore.getState().defaultModels.audio },
  },
  providerSettings: { ...useSettingsStore.getState().providerSettings },
};

describe('runNode structured reference groups (AUD-011)', () => {
  let requestConfirmationSpy: ReturnType<typeof vi.fn<(message: string, title?: string) => Promise<boolean>>>;

  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [], bookmarkSidebarOpen: true });
    useSourceBinStore.setState({
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: Date.now(),
        items: [],
      }],
      dismissedSourceKeys: [],
      sidebarOpen: true,
    });
    requestConfirmationSpy = vi.fn<(message: string, title?: string) => Promise<boolean>>(() => Promise.resolve(true));
    useConfirmationStore.setState({
      activeRequest: null,
      requestConfirmation: requestConfirmationSpy,
      respond: () => {},
    });
    useProjectUsageStore.getState().restoreSnapshot();
    capturedContexts.length = 0;
    vi.mocked(hashExecutionParameters).mockClear();
  });

  afterEach(() => {
    useSettingsStore.setState({
      apiKeys: { ...baselineRuntimeSettings.apiKeys },
      defaultModels: {
        text: { ...baselineRuntimeSettings.defaultModels.text },
        image: { ...baselineRuntimeSettings.defaultModels.image },
        video: { ...baselineRuntimeSettings.defaultModels.video },
        audio: { ...baselineRuntimeSettings.defaultModels.audio },
      },
      providerSettings: { ...baselineRuntimeSettings.providerSettings },
    });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keeps each numbered reference description with its image and out of the global prompt', async () => {
    const prompt = createNode('prompt', 'textNode', { mode: 'prompt', prompt: 'studio portrait' });
    const imageA = createStaticImageSource('img-a', IMAGE_A);
    const imageB = createStaticImageSource('img-b', IMAGE_B);
    const text1 = createNode('txt-1', 'textNode', { mode: 'prompt', prompt: 'preserve logo' });
    const text2 = createNode('txt-2', 'textNode', { mode: 'prompt', prompt: 'preserve identity' });
    const root = createRootImageNode();

    useFlowStore.setState({
      nodes: [prompt, imageA, imageB, text1, text2, root],
      edges: [
        { id: 'e-prompt', source: prompt.id, target: root.id },
        { id: 'e-img-a', source: imageA.id, target: root.id, targetHandle: 'image-reference-1' },
        { id: 'e-txt-1', source: text1.id, target: root.id, targetHandle: 'image-reference-1' },
        { id: 'e-img-b', source: imageB.id, target: root.id, targetHandle: 'image-reference-2' },
        { id: 'e-txt-2', source: text2.id, target: root.id, targetHandle: 'image-reference-2' },
      ],
    });

    await useFlowStore.getState().runNode(root.id);

    const contexts = rootContexts(root.id);
    expect(contexts).toHaveLength(1);
    const context = contexts[0];
    expect(context.prompt).toBe('studio portrait');
    expect(context.editReferenceImageInputs).toEqual([IMAGE_A, IMAGE_B]);
    expect(context.referenceGroups).toEqual([
      { slot: 1, imageUrl: IMAGE_A, descriptions: ['preserve logo'], jsonGuidance: [] },
      { slot: 2, imageUrl: IMAGE_B, descriptions: ['preserve identity'], jsonGuidance: [] },
    ]);
  });

  it('keeps JSON guidance with its numbered image, deterministically serialized', async () => {
    const prompt = createNode('prompt', 'textNode', { mode: 'prompt', prompt: 'product shot' });
    const imageB = createStaticImageSource('img-b', IMAGE_B);
    const jsonGuide = createNode('json-guide', 'valueNode', { valueKind: 'json', value: '{"weight":2,"palette":["#0057ff"]}' });
    const root = createRootImageNode();

    useFlowStore.setState({
      nodes: [prompt, imageB, jsonGuide, root],
      edges: [
        { id: 'e-prompt', source: prompt.id, target: root.id },
        { id: 'e-img-b', source: imageB.id, target: root.id, targetHandle: 'image-reference-2' },
        { id: 'e-json', source: jsonGuide.id, target: root.id, targetHandle: 'image-reference-2' },
      ],
    });

    await useFlowStore.getState().runNode(root.id);

    const context = rootContexts(root.id)[0];
    expect(context.prompt).toBe('product shot');
    expect(context.referenceGroups).toEqual([
      { slot: 2, imageUrl: IMAGE_B, descriptions: [], jsonGuidance: ['{"palette":["#0057ff"],"weight":2}'] },
    ]);
    expect(JSON.stringify(context)).not.toContain('[object Object]');
  });

  it('changes the execution fingerprint and invalidates resume when two descriptions swap slots', async () => {
    const prompts = createTextEnvelopeNode('prompts', ['alpha take', 'beta take']);
    const imageA = createStaticImageSource('img-a', IMAGE_A);
    const imageB = createStaticImageSource('img-b', IMAGE_B);
    const text1 = createNode('txt-1', 'textNode', { mode: 'prompt', prompt: 'preserve logo' });
    const text2 = createNode('txt-2', 'textNode', { mode: 'prompt', prompt: 'preserve identity' });
    const root = createRootImageNode('root', { listLoopMode: 'allCombinations' });
    const buildEdges = (swapped: boolean): Edge[] => [
      { id: 'e-prompts', source: prompts.id, target: root.id },
      { id: 'e-img-a', source: imageA.id, target: root.id, targetHandle: 'image-reference-1' },
      { id: 'e-img-b', source: imageB.id, target: root.id, targetHandle: 'image-reference-2' },
      // The edge ORDER never changes; only the numbered handle each description targets swaps,
      // so every flattened byte (prompt concatenation, image URL list) stays identical.
      { id: 'e-txt-1', source: text1.id, target: root.id, targetHandle: swapped ? 'image-reference-2' : 'image-reference-1' },
      { id: 'e-txt-2', source: text2.id, target: root.id, targetHandle: swapped ? 'image-reference-1' : 'image-reference-2' },
    ];

    useFlowStore.setState({
      nodes: [prompts, imageA, imageB, text1, text2, root],
      edges: buildEdges(false),
    });
    await useFlowStore.getState().runNode(root.id);
    expect(rootContexts(root.id)).toHaveLength(2);
    const firstRunEnvelopeIds = new Set(
      useSourceBinStore.getState().getAllItems()
        .filter((item) => item.originNodeId === root.id)
        .map((item) => item.envelopeId),
    );
    expect(firstRunEnvelopeIds.size).toBeGreaterThan(0);

    capturedContexts.length = 0;
    vi.mocked(executeNodeRequest).mockClear();
    requestConfirmationSpy.mockClear();
    useFlowStore.setState({ edges: buildEdges(true) });

    await useFlowStore.getState().runNode(root.id);

    // Swapped associations are different authored work: the fingerprint must change and the
    // previous outputs must NOT be resumed even though every flattened value is unchanged.
    expect(rootContexts(root.id)).toHaveLength(2);
    const secondRunItems = useSourceBinStore.getState().getAllItems()
      .filter((item) => item.originNodeId === root.id && !firstRunEnvelopeIds.has(item.envelopeId));
    expect(secondRunItems.length).toBeGreaterThan(0);

    const [firstRunGroups, secondRunGroups] = [
      rootContexts(root.id)[0]?.referenceGroups,
      rootContexts(root.id)[1]?.referenceGroups,
    ];
    expect(firstRunGroups).toEqual([
      { slot: 1, imageUrl: IMAGE_A, descriptions: ['preserve identity'], jsonGuidance: [] },
      { slot: 2, imageUrl: IMAGE_B, descriptions: ['preserve logo'], jsonGuidance: [] },
    ]);
    expect(secondRunGroups).toEqual(firstRunGroups);
  });

  it('keeps package and function outputs on their numbered slot without duplicate provider calls', async () => {
    const prompt = createNode('prompt', 'textNode', { mode: 'prompt', prompt: 'hero banner' });
    const packageText = createNode('pkg-text', 'textNode', { mode: 'prompt', prompt: 'brand kit sheet' });
    const packageImageSource = createStaticImageSource('pkg-img-src', IMAGE_A);
    const pkg = createNode('pkg', 'packageNode', {});
    const fnConfig = createDefaultFunctionNodeConfig('Stored render');
    const fn = createNode('fn', 'functionNode', {
      resultType: 'image',
      result: IMAGE_F,
      functionNode: {
        ...fnConfig,
        contract: {
          ...fnConfig.contract,
          outputPorts: [{ ...fnConfig.contract.outputPorts[0], resultType: 'image' as const }],
        },
      },
    });
    const root = createRootImageNode();

    useFlowStore.setState({
      nodes: [prompt, packageText, packageImageSource, pkg, fn, root],
      edges: [
        { id: 'e-prompt', source: prompt.id, target: root.id },
        { id: 'e-pkg-text', source: packageText.id, target: pkg.id, targetHandle: 'text' },
        { id: 'e-pkg-img', source: packageImageSource.id, target: pkg.id, targetHandle: 'image' },
        { id: 'e-pkg-root', source: pkg.id, target: root.id, targetHandle: 'image-reference-1' },
        { id: 'e-fn-root', source: fn.id, sourceHandle: 'output-result', target: root.id, targetHandle: 'image-reference-2' },
      ],
    });

    await useFlowStore.getState().runNode(root.id);

    expect(useFlowStore.getState().nodes.find((node) => node.id === root.id)?.data.error).toBeUndefined();
    // The function dependency evaluates exactly once (local, plan-authorized) and the root pays
    // for exactly one provider call — the reference slots add no extra evaluations.
    expect(capturedContexts.filter((call) => call.nodeId === fn.id)).toHaveLength(1);
    const contexts = rootContexts(root.id);
    expect(contexts).toHaveLength(1);
    const fnExecutedResult = imageResultDataUrl(fn.id, 1);
    const groups = contexts[0].referenceGroups ?? [];
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ slot: 1, imageUrl: IMAGE_A });
    expect(groups[0]?.descriptions.join(' ')).toContain('brand kit sheet');
    expect(groups[1]).toMatchObject({ slot: 2, imageUrl: fnExecutedResult, descriptions: [] });
    expect(contexts[0].prompt).toBe('hero banner');
  });

  it('keeps envelope-driven reference images on their numbered slot for every iteration', async () => {
    const prompt = createNode('prompt', 'textNode', { mode: 'prompt', prompt: 'poster series' });
    const staticImage = createStaticImageSource('img-a', IMAGE_A);
    const referenceEnvelope = createImageEnvelopeNode('ref-env', [IMAGE_B, IMAGE_F]);
    const slotText = createNode('txt-2', 'textNode', { mode: 'prompt', prompt: 'match this face' });
    const root = createRootImageNode('root', { listLoopMode: 'paired' });

    useFlowStore.setState({
      nodes: [prompt, staticImage, referenceEnvelope, slotText, root],
      edges: [
        { id: 'e-prompt', source: prompt.id, target: root.id },
        { id: 'e-img-a', source: staticImage.id, target: root.id, targetHandle: 'image-reference-1' },
        { id: 'e-env', source: referenceEnvelope.id, target: root.id, targetHandle: 'image-reference-2' },
        { id: 'e-txt-2', source: slotText.id, target: root.id, targetHandle: 'image-reference-2' },
      ],
    });

    await useFlowStore.getState().runNode(root.id);

    const contexts = rootContexts(root.id);
    expect(contexts).toHaveLength(2);
    expect(contexts[0].referenceGroups).toEqual([
      { slot: 1, imageUrl: IMAGE_A, descriptions: [], jsonGuidance: [] },
      { slot: 2, imageUrl: IMAGE_B, descriptions: ['match this face'], jsonGuidance: [] },
    ]);
    expect(contexts[1].referenceGroups).toEqual([
      { slot: 1, imageUrl: IMAGE_A, descriptions: [], jsonGuidance: [] },
      { slot: 2, imageUrl: IMAGE_F, descriptions: ['match this face'], jsonGuidance: [] },
    ]);
    expect(contexts[0].prompt).toBe('poster series');
    expect(contexts[1].prompt).toBe('poster series');
  });
});
