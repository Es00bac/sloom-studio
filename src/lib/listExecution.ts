import type { Edge } from '@xyflow/react';
import type { AppNode, CompositionTargetHandle, ListLoopMode, VideoReferenceType } from '../types/flow';
import type { ExecutionContext } from './flowExecution';
import {
  collectEnvelopeItemsForEnvelopeNode,
  buildListItemTargetHandle,
  buildListNodeItems,
  getListNodeKind,
  getValidListNodeItems,
  buildLoopNodeItems,
  type FlowListItem,
} from './listNodes';
import { getSignalIterationCount, isTextualSignal, type FlowSignal } from './flowSignals';
import {
  COMPOSITION_AUDIO_HANDLES,
  COMPOSITION_VIDEO_HANDLE,
  getCompositionTrackSettings,
} from './compositionTracks';
import { IMAGE_MASK_HANDLE, IMAGE_REFERENCE_HANDLES } from './imageModelSupport';
import { resolveEffectiveSourceNode } from './virtualNodes';

export interface ConnectedListInput {
  listNodeId: string;
  targetHandle?: string | null;
  items: FlowListItem[];
}

export interface LoopIterationItem {
  input: ConnectedListInput;
  item: FlowListItem;
}

export function normalizeListLoopMode(value: unknown): ListLoopMode {
  return value === 'allCombinations' ? 'allCombinations' : 'paired';
}

export function collectListLoopInputs(
  nodeId: string,
  nodes: AppNode[],
  edges: Edge[],
): ConnectedListInput[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  const getValidConnectedItems = (sourceNode: AppNode): FlowListItem[] => {
    if (sourceNode.type === 'list') {
      return getValidListNodeItems(buildListNodeItems(sourceNode.id, nodes, edges));
    }

    if (sourceNode.type === 'envelope') {
      const envelopeItems = collectEnvelopeItemsForEnvelopeNode(sourceNode.id, nodes, edges).map((item) => ({
        ...item,
        index: item.index,
        targetHandle: buildListItemTargetHandle(item.index),
        nodeId: item.sourceNodeId ?? sourceNode.id,
      }));
      const envelopeKind = getListNodeKind(envelopeItems);

      return envelopeItems.map((item) =>
        !envelopeKind || item.kind === envelopeKind
          ? item
          : {
            ...item,
            invalidReason: `This envelope is typed as ${envelopeKind}, so ${item.kind} outputs cannot be added.`,
          },
      );
    }

    if (sourceNode.type === 'loopNode') {
      return buildLoopNodeItems(sourceNode.id, nodes, edges);
    }

    return [];
  };

  return edges.flatMap((edge) => {
    if (edge.target !== nodeId) {
      return [];
    }

    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, edge.sourceHandle)
      : undefined;

    if (!sourceNode || !['list', 'envelope', 'loopNode'].includes(sourceNode.type)) {
      return [];
    }

    const items = getValidConnectedItems(sourceNode);

    return [{
      listNodeId: sourceNode.id,
      targetHandle: edge.targetHandle,
      items,
    }];
  });
}

export function getLoopIterationCount(
  inputs: ConnectedListInput[],
  mode: ListLoopMode = 'paired',
): number {
  if (inputs.length === 0) {
    return 0;
  }

  if (mode === 'allCombinations') {
    return inputs.reduce((total, input) => total * input.items.length, 1);
  }

  const counts = inputs.map((input) => input.items.length);
  if (counts.some((count) => count === 0)) {
    return 0;
  }

  const maxCount = Math.max(...counts);

  const invalidInput = counts.find(
    (count) => count !== 1 && count !== maxCount,
  );

  if (invalidInput !== undefined) {
    throw new Error('Connected lists must have the same number of items or a single broadcastable item.');
  }

  return maxCount;
}

export function getLoopItemForIteration(input: ConnectedListInput, index: number): FlowListItem {
  return input.items[input.items.length === 1 ? 0 : index]!;
}

const TEXTUAL_LIST_ITEM_KINDS = new Set<FlowListItem['kind']>([
  'text',
  'number',
  'boolean',
  'json',
  'package',
]);

export function isTextualListItem(item: FlowListItem): boolean {
  return TEXTUAL_LIST_ITEM_KINDS.has(item.kind);
}

export function buildRoutedLoopInputs(
  loopInputs: ConnectedListInput[],
  promptSignal: FlowSignal,
): ConnectedListInput[] {
  if (!isTextualSignal(promptSignal)) {
    return loopInputs;
  }

  return loopInputs
    .map((input) => ({
      ...input,
      items: input.items.filter((item) => !isTextualListItem(item)),
    }))
    .filter((input) => input.items.length > 0);
}

export function resolveCombinedLoopIterationCount(
  explicitLoopCount: number,
  promptSignalLoopCount: number,
): number {
  if (promptSignalLoopCount <= 1) {
    return explicitLoopCount;
  }

  if (explicitLoopCount <= 1) {
    return promptSignalLoopCount;
  }

  if (explicitLoopCount === promptSignalLoopCount) {
    return explicitLoopCount;
  }

  throw new Error('Prompt batches and connected media lists must have the same length, or one side must be a single broadcastable item.');
}

export function resolveLoopRunCount(
  loopInputs: ConnectedListInput[],
  loopMode: ListLoopMode,
  promptSignal: FlowSignal,
): number {
  const promptSignalLoopCount = getSignalIterationCount(promptSignal);

  if (loopMode === 'allCombinations') {
    const hasLoopInputs = loopInputs.length > 0;
    const hasPromptLoop = promptSignalLoopCount > 0;
    if (!hasLoopInputs && !hasPromptLoop) {
      return 0;
    }
    const explicitLoopCount = hasLoopInputs
      ? getLoopIterationCount(loopInputs, 'allCombinations')
      : 1;
    return explicitLoopCount * (hasPromptLoop ? promptSignalLoopCount : 1);
  }

  const explicitLoopCount = getLoopIterationCount(loopInputs, loopMode);
  if (explicitLoopCount === 0 && promptSignalLoopCount > 0) {
    return promptSignalLoopCount;
  }
  return resolveCombinedLoopIterationCount(explicitLoopCount, promptSignalLoopCount);
}

export function resolveAllCombinationSubIndices(
  index: number,
  loopIterationCount: number,
  promptSignalIterationCount: number,
  loopMode: ListLoopMode,
): { directIndex: number; promptIndex: number } {
  if (loopMode !== 'allCombinations' || promptSignalIterationCount <= 1) {
    return { directIndex: index, promptIndex: index };
  }

  return {
    directIndex: loopIterationCount > 0 ? index % loopIterationCount : 0,
    promptIndex: Math.floor(index / (loopIterationCount || 1)),
  };
}

export function buildLoopIterationItems(
  inputs: ConnectedListInput[],
  index: number,
  mode: ListLoopMode = 'paired',
): LoopIterationItem[] {
  return inputs.map((input, inputIndex) => ({
    input,
    item: mode === 'allCombinations'
      ? getCombinationLoopItemForIteration(inputs, inputIndex, index)
      : getLoopItemForIteration(input, index),
  }));
}

function getCombinationLoopItemForIteration(
  inputs: ConnectedListInput[],
  inputIndex: number,
  index: number,
): FlowListItem {
  const input = inputs[inputIndex];
  const trailingProduct = inputs
    .slice(inputIndex + 1)
    .reduce((total, nextInput) => total * nextInput.items.length, 1);
  const itemIndex = Math.floor(index / trailingProduct) % input.items.length;

  return input.items[itemIndex]!;
}

export function applyListItemsToExecutionContext(
  context: ExecutionContext,
  node: AppNode,
  iterationItems: LoopIterationItem[],
): ExecutionContext {
  const nextContext: ExecutionContext = {
    ...context,
    textImageInputs: context.textImageInputs ? [...context.textImageInputs] : undefined,
    editReferenceImageInputs: context.editReferenceImageInputs ? [...context.editReferenceImageInputs] : undefined,
    referenceImageInputs: context.referenceImageInputs ? [...context.referenceImageInputs] : undefined,
    audioInputs: context.audioInputs ? [...context.audioInputs] : undefined,
  };

  for (const { input, item } of iterationItems) {
    applyListItem(nextContext, node, input.targetHandle, item);
  }

  return nextContext;
}

function applyListItem(
  context: ExecutionContext,
  node: AppNode,
  targetHandle: string | null | undefined,
  item: FlowListItem,
): void {
  if (item.kind === 'text' || item.kind === 'number' || item.kind === 'boolean' || item.kind === 'json') {
    context.prompt = appendPrompt(context.prompt, item.value);
    return;
  }

  if (item.kind === 'image') {
    applyImageListItem(context, node, targetHandle, item);
    return;
  }

  if (item.kind === 'video') {
    if (node.type === 'imageGen') {
      context.sourceVideoInput = item.value;
      return;
    }

    if (node.type === 'videoGen' && targetHandle === 'video-source-video') {
      context.extensionVideoInput = item.value;
      return;
    }

    if (node.type === 'composition' && (targetHandle === COMPOSITION_VIDEO_HANDLE || !targetHandle)) {
      context.videoInput = item.value;
    }

    return;
  }

  if (item.kind === 'audio') {
    if (node.type === 'audioGen') {
      context.audioSourceInput = item.value;
      return;
    }

    if (node.type === 'composition' && isCompositionAudioHandle(targetHandle)) {
      const settings = getCompositionTrackSettings(node.data, targetHandle);
      context.audioInputs = [
        ...(context.audioInputs ?? []).filter((audioInput) => audioInput.sourceNodeId !== `${item.nodeId}:${targetHandle}`),
        {
          url: item.value,
          sourceNodeId: `${item.nodeId}:${targetHandle}`,
          delayMs: settings.offsetMs,
          volumePercent: settings.volumePercent,
          enabled: settings.enabled,
        },
      ];
    }
  }
}

function applyImageListItem(
  context: ExecutionContext,
  node: AppNode,
  targetHandle: string | null | undefined,
  item: FlowListItem,
): void {
  if (node.type === 'textNode') {
    context.textImageInputs = [...(context.textImageInputs ?? []), item.value];
    return;
  }

  if (node.type === 'imageGen') {
    if (targetHandle === 'image-edit-source' || !targetHandle) {
      context.editImageInput = item.value;
      return;
    }

    if (targetHandle === IMAGE_MASK_HANDLE) {
      context.editMaskImageInput = item.value;
      return;
    }

    if (IMAGE_REFERENCE_HANDLES.includes(targetHandle as typeof IMAGE_REFERENCE_HANDLES[number])) {
      context.editReferenceImageInputs = [...(context.editReferenceImageInputs ?? []), item.value];
    }

    return;
  }

  if (node.type === 'cropImageNode') {
    if (targetHandle === 'image' || !targetHandle) {
      context.editImageInput = item.value;
    }

    return;
  }

  if (node.type === 'videoGen') {
    if (targetHandle === 'video-start-frame') {
      context.startImageInput = item.value;
      return;
    }

    if (targetHandle === 'video-end-frame') {
      context.endImageInput = item.value;
      return;
    }

    if (targetHandle === 'video-reference-1' || targetHandle === 'video-reference-2' || targetHandle === 'video-reference-3') {
      context.referenceImageInputs = [
        ...(context.referenceImageInputs ?? []).filter((input) => input.url !== item.value),
        {
          url: item.value,
          referenceType: getVideoReferenceType(node, targetHandle),
        },
      ];
    }
  }
}

function appendPrompt(currentPrompt: string, nextPrompt: string): string {
  const current = currentPrompt.trim();
  const next = nextPrompt.trim();

  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  return `${current}\n\n${next}`;
}

function getVideoReferenceType(
  node: AppNode,
  handle: 'video-reference-1' | 'video-reference-2' | 'video-reference-3',
): VideoReferenceType {
  const index = Number(handle.replace('video-reference-', ''));
  const value = node.data[`videoReference${index}Type`];
  return value === 'style' ? 'style' : 'asset';
}

function isCompositionAudioHandle(handle: string | null | undefined): handle is CompositionTargetHandle {
  return COMPOSITION_AUDIO_HANDLES.includes(handle as (typeof COMPOSITION_AUDIO_HANDLES)[number]);
}
