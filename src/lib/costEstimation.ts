import type { Edge } from '@xyflow/react';
import {
  COMPOSITION_AUDIO_HANDLES,
} from './compositionTracks';
import { isCompositionVideoConnection } from './compositionEdgeMigration';
import {
  DEFAULT_EXECUTION_CONFIG,
  getAudioOutputFormat,
  getImageOutputFormat,
  getNodeAspectRatio,
  getVideoResolution,
} from './providerCatalog';
import {
  isVideoExtensionHandle,
  isVideoImageConditioningHandle,
  normalizeGeminiVideoModelId,
} from './videoModelSupport';
import {
  estimateImageModelCostUsd,
  getImageModelDefinition,
  type ImageModelOperation,
} from './imageProviderCapabilities';
import type { GenerativeFillProvider } from './imageEditorAi';
import { addConfiguredUpscaleCost } from './universalImageUpscale';
import {
  isListItemTargetHandle,
  resolveExpandedListItemForNode,
  resolveNodeListItemKind,
  resolvePackageNodeData,
  collectEnvelopeItemsForEnvelopeNode,
  evaluateNodeTextForMonitor,
} from './listNodes';
import { resolveEffectiveSourceNode } from './virtualNodes';
import { resultValueAsMediaUrl } from './flowResultValues';
import type {
  AppNode,
  AudioProvider,
  DynamicValue,
  ExecutionConfig,
  FlowNodeType,
  ImageProvider,
  NodeData,
  RuntimeSettingsSnapshot,
  TextProvider,
  UsageTelemetry,
  VideoProvider,
  VideoResolution,
  VideoTargetHandle,
} from '../types/flow';
import {
  getFunctionNodeOutput,
  prepareFunctionSubgraph,
  resolveFunctionInputBindings,
} from './functionNodes';

import { useSourceBinStore } from '../store/sourceBinStore';

interface TokenUsageEstimate {
  inputTokens: number;
  outputTokens: number;
}

interface TokenPricing {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export interface ExecutionContextEstimate {
  prompt: string;
  config: ExecutionConfig;
  functionInputs?: Record<string, DynamicValue>;
  editImageInput?: string;
  refImageInput?: string;
  audioSourceInput?: string;
  sourceVideoInput?: string;
  extensionVideoInput?: string;
}

export interface UsageRollup {
  totalKnownCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  characters: number;
  durationSeconds: number;
  imageCount: number;
  knownCostCount: number;
  unknownCostCount: number;
}

export interface ExecutionPlanEstimate {
  nodeIds: string[];
  telemetries: Array<{ nodeId: string; telemetry: UsageTelemetry }>;
  rollup: UsageRollup;
}

export interface ExecutionPlanRuntime {
  getDependencies: (node: AppNode, edges: Edge[], nodesById: Map<string, AppNode>) => string[];
  shouldReuseExistingOutput: (node: AppNode, nodes: AppNode[], edges: Edge[]) => boolean;
}

/**
 * Atlas sequential Seedream models return a bounded image envelope from one
 * provider request.  The envelope cardinality is spend-affecting for every
 * downstream loop, so planning must use the same bound as execution.
 */
export function projectedImageOutputCount(node: Pick<AppNode, 'type' | 'data'>): number {
  if (node.type !== 'imageGen' || node.data.provider !== 'atlas') return 1;
  const modelId = typeof node.data.modelId === 'string' ? node.data.modelId.toLowerCase() : '';
  if (!modelId.includes('seedream') || !modelId.includes('sequential')) return 1;
  const configured = Number((node.data.atlasParams as Record<string, unknown> | undefined)?.max_images);
  return Number.isFinite(configured) ? Math.max(1, Math.min(15, Math.floor(configured))) : 1;
}

const GEMINI_TEXT_PRICING: Array<{ match: (modelId: string) => boolean; pricing: TokenPricing }> = [
  {
    match: (modelId) => modelId.startsWith('gemini-3.5-flash') || modelId.startsWith('gemini-1.5-flash'),
    pricing: { inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.3 },
  },
  {
    match: (modelId) => modelId.startsWith('gemini-1.5-pro'),
    pricing: { inputUsdPerMillion: 1.25, outputUsdPerMillion: 5.0 },
  },
  {
    match: (modelId) => modelId.startsWith('gemini-3.1-pro-preview'),
    pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 12 },
  },
  {
    match: (modelId) => modelId.startsWith('gemini-3.1-flash-lite-preview'),
    pricing: { inputUsdPerMillion: 0.25, outputUsdPerMillion: 1.5 },
  },
  {
    match: (modelId) => modelId.startsWith('gemini-3-flash-preview'),
    pricing: { inputUsdPerMillion: 0.5, outputUsdPerMillion: 3 },
  },
  {
    match: (modelId) => modelId.startsWith('gemini-2.5-flash-lite'),
    pricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.4 },
  },
  {
    match: (modelId) => modelId.startsWith('gemini-2.5-flash'),
    pricing: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 2.5 },
  },
];

const OPENAI_TEXT_PRICING: Array<{ match: (modelId: string) => boolean; pricing: TokenPricing }> = [
  {
    match: (modelId) => modelId === 'gpt-5.4',
    pricing: { inputUsdPerMillion: 2.5, outputUsdPerMillion: 15 },
  },
  {
    match: (modelId) => modelId === 'gpt-5.4-mini',
    pricing: { inputUsdPerMillion: 0.75, outputUsdPerMillion: 4.5 },
  },
  {
    match: (modelId) => modelId === 'gpt-5.4-nano',
    pricing: { inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.25 },
  },
];

const GEMINI_VIDEO_PRICING: Array<{ match: (modelId: string) => boolean; usdPerSecond: number }> = [
  {
    match: (modelId) => modelId.includes('veo-3.1-fast'),
    usdPerSecond: 0.15,
  },
  {
    match: (modelId) => modelId.includes('veo-3.1'),
    usdPerSecond: 0.4,
  },
];

const ELEVENLABS_CHARACTER_PRICING: Array<{ match: (modelId: string) => boolean; usdPerThousandChars: number }> = [
  {
    match: (modelId) => modelId === 'eleven_v3' || modelId === 'eleven_multilingual_v2',
    usdPerThousandChars: 0.1,
  },
  {
    match: (modelId) =>
      modelId === 'eleven_flash_v2_5' || modelId === 'eleven_flash_v2' || modelId === 'eleven_turbo_v2_5',
    usdPerThousandChars: 0.05,
  },
];
function getGeminiTextPricing(modelId: string): TokenPricing | undefined {
  const normalized = modelId.trim().toLowerCase();
  return GEMINI_TEXT_PRICING.find((entry) => entry.match(normalized))?.pricing;
}

function getOpenAITextPricing(modelId: string): TokenPricing | undefined {
  const normalized = modelId.trim().toLowerCase();
  return OPENAI_TEXT_PRICING.find((entry) => entry.match(normalized))?.pricing;
}

function getGeminiVideoRate(modelId: string): number | undefined {
  const normalized = normalizeGeminiVideoModelId(modelId).trim().toLowerCase();
  return GEMINI_VIDEO_PRICING.find((entry) => entry.match(normalized))?.usdPerSecond;
}

function getElevenLabsCharacterRate(modelId: string): number | undefined {
  const normalized = modelId.trim().toLowerCase();
  return ELEVENLABS_CHARACTER_PRICING.find((entry) => entry.match(normalized))?.usdPerThousandChars;
}

export function estimateTokensFromText(text: string): number {
  const normalized = text.trim();

  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function estimateTextOutputTokens(inputTokens: number): number {
  if (inputTokens <= 0) {
    return 0;
  }

  return Math.max(128, Math.min(2048, Math.round(inputTokens * 1.25)));
}

function sumTextCost(pricing: TokenPricing, usage: TokenUsageEstimate): number {
  return (
    (usage.inputTokens * pricing.inputUsdPerMillion) / 1_000_000 +
    (usage.outputTokens * pricing.outputUsdPerMillion) / 1_000_000
  );
}

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }

  return String(Math.round(value));
}

export function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'Unknown';
  }

  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }

  return `$${value.toFixed(2)}`;
}

export function estimateGeminiTextCostUsd(modelId: string, usage: TokenUsageEstimate): number | undefined {
  const pricing = getGeminiTextPricing(modelId);
  return pricing ? sumTextCost(pricing, usage) : undefined;
}

export function estimateOpenAITextCostUsd(modelId: string, usage: TokenUsageEstimate): number | undefined {
  const pricing = getOpenAITextPricing(modelId);
  return pricing ? sumTextCost(pricing, usage) : undefined;
}

export function estimateGenerativeFillCostUsd(
  provider: GenerativeFillProvider,
  modelId?: string,
  megapixels?: number,
  prompt?: string,
): number {
  const textInputTokens = prompt ? estimateTokensFromText(prompt) : undefined;
  switch (provider) {
    case 'openai':
      return estimateImageModelCostUsd({
        providerId: 'openai',
        modelId: modelId ?? 'gpt-image-1',
        operation: 'mask-inpaint',
        outputMegapixels: megapixels,
        textInputTokens,
      }).costUsd ?? 0.04;
    case 'atlas':
      return estimateImageModelCostUsd({
        providerId: 'atlas',
        modelId: modelId ?? 'gpt-image-1',
        operation: 'mask-inpaint',
        outputMegapixels: megapixels,
        textInputTokens,
      }).costUsd ?? 0.04;
    case 'byteplus':
      return estimateImageModelCostUsd({
        providerId: 'byteplus',
        modelId: modelId ?? 'seedream-5-0-260128',
        operation: 'text-to-image',
        outputMegapixels: megapixels,
        textInputTokens,
      }).costUsd ?? 0;
    case 'gemini':
      return estimateImageModelCostUsd({
        providerId: 'gemini',
        modelId: modelId ?? 'gemini-2.5-flash-image',
        operation: 'image-edit',
        outputMegapixels: megapixels,
        textInputTokens,
      }).costUsd ?? 0.039;
    case 'huggingface':
      return estimateImageModelCostUsd({
        providerId: 'huggingface',
        modelId: modelId ?? 'black-forest-labs/FLUX.1-dev',
        operation: 'text-to-image',
        outputMegapixels: megapixels,
        textInputTokens,
      }).costUsd ?? 0.005;
    case 'bfl':
      return estimateImageModelCostUsd({
        providerId: 'bfl',
        modelId: modelId ?? 'flux-2-pro',
        operation: 'image-edit',
        outputMegapixels: megapixels,
        textInputTokens,
      }).costUsd ?? 0.045;
    case 'stability': {
      const selectedModelId = modelId ?? 'stable-image-edit-inpaint';
      const stabilityDefinition = getImageModelDefinition('stability', selectedModelId);
      const stabilityOperation = resolveStabilityOperationForModel(stabilityDefinition.supportedOperations);
      return estimateImageModelCostUsd({
        providerId: 'stability',
        modelId: selectedModelId,
        operation: stabilityOperation,
        outputMegapixels: megapixels,
        textInputTokens,
      }).costUsd ?? 0.05;
    }
    case 'localOpen':
      return 0;
    case 'generic':
      return 0.0;
  }
}

function resolveStabilityOperationForModel(operations: ImageModelOperation[]): ImageModelOperation {
  if (operations.includes('replace-background-relight')) {
    return 'replace-background-relight';
  }
  if (operations.includes('search-recolor')) {
    return 'search-recolor';
  }
  if (operations.includes('search-replace')) {
    return 'search-replace';
  }
  if (operations.includes('remove-background')) {
    return 'remove-background';
  }
  if (operations.includes('outpaint')) {
    return 'outpaint';
  }
  if (operations.includes('erase')) {
    return 'erase';
  }

  return operations.includes('mask-inpaint') ? 'mask-inpaint' : 'image-edit';
}

function estimateGeminiImageCostUsd(
  modelId: string,
  inputTokens: number,
  aspectRatio: ExecutionConfig['aspectRatio'],
): number | undefined {
  const normalized = modelId.trim().toLowerCase();

  if (normalized.includes('flash-image')) {
    return (inputTokens * 0.3) / 1_000_000 + 0.039;
  }

  if (normalized.includes('image-preview')) {
    const outputCost = aspectRatio === '1:1' ? 0.067 : 0.101;
    return (inputTokens * 0.5) / 1_000_000 + outputCost;
  }

  return undefined;
}

export function estimateGeminiVideoCostUsd(
  modelId: string,
  durationSeconds: number,
  resolution: VideoResolution,
): number | undefined {
  void resolution;
  const rate = getGeminiVideoRate(modelId);

  if (rate === undefined) {
    return undefined;
  }

  return Math.max(0, durationSeconds) * rate;
}

export function estimateElevenLabsTtsCostUsd(modelId: string, characters: number): number | undefined {
  const rate = getElevenLabsCharacterRate(modelId);

  if (rate === undefined) {
    return undefined;
  }

  return (Math.max(0, characters) / 1_000) * rate;
}

function buildUsageTelemetry(
  source: UsageTelemetry['source'],
  confidence: UsageTelemetry['confidence'],
  details: Omit<UsageTelemetry, 'source' | 'confidence'>,
): UsageTelemetry {
  return {
    source,
    confidence,
    ...details,
  };
}

export function createMeasuredTextUsage(
  provider: TextProvider | 'unknown',
  modelId: string,
  usage: TokenUsageEstimate,
): UsageTelemetry {
  const pricing =
    provider === 'gemini'
      ? estimateGeminiTextCostUsd(modelId, usage)
      : provider === 'openai'
        ? estimateOpenAITextCostUsd(modelId, usage)
        : undefined;

  return buildUsageTelemetry('actual', 'measured', {
    provider,
    modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.inputTokens + usage.outputTokens,
    costUsd: pricing,
    notes: pricing === undefined ? ['Pricing for this text model is not currently mapped in the app.'] : undefined,
  });
}

export function createGeminiVideoUsage(
  modelId: string,
  durationSeconds: number,
  resolution: VideoResolution,
  source: UsageTelemetry['source'],
): UsageTelemetry {
  const costUsd = estimateGeminiVideoCostUsd(modelId, durationSeconds, resolution);

  return buildUsageTelemetry(source, costUsd === undefined ? 'unknown' : 'fixed', {
    provider: 'gemini',
    modelId,
    durationSeconds,
    costUsd,
    notes: costUsd === undefined ? ['Pricing for this Veo model is not currently mapped in the app.'] : undefined,
  });
}

export function createElevenLabsTtsUsage(
  modelId: string,
  text: string,
  source: UsageTelemetry['source'],
): UsageTelemetry {
  const characters = text.length;
  const costUsd = estimateElevenLabsTtsCostUsd(modelId, characters);

  return buildUsageTelemetry(source, costUsd === undefined ? 'unknown' : 'fixed', {
    provider: 'elevenlabs',
    modelId,
    characters,
    costUsd,
    notes: costUsd === undefined ? ['Pricing for this ElevenLabs model is not currently mapped in the app.'] : undefined,
  });
}

export function createGeminiImageUsage(
  modelId: string,
  promptText: string,
  aspectRatio: ExecutionConfig['aspectRatio'],
  source: UsageTelemetry['source'],
  inputTokenOverride?: number,
): UsageTelemetry {
  const inputTokens = inputTokenOverride ?? estimateTokensFromText(promptText);
  const costUsd = estimateGeminiImageCostUsd(modelId, inputTokens, aspectRatio);

  return buildUsageTelemetry(source, costUsd === undefined ? 'unknown' : source === 'actual' ? 'measured' : 'fixed', {
    provider: 'gemini',
    modelId,
    inputTokens,
    totalTokens: inputTokens,
    imageCount: 1,
    costUsd,
    notes: costUsd === undefined ? ['Pricing for this Gemini image model is not currently mapped in the app.'] : undefined,
  });
}

export function createLocalCompositionUsage(source: UsageTelemetry['source']): UsageTelemetry {
  return buildUsageTelemetry(source, 'fixed', {
    provider: 'local',
    modelId: 'ffmpeg-browser',
    costUsd: 0,
    notes: ['Browser-side FFmpeg composition does not call a paid model.'],
  });
}

export function createLocalFrameExtractionUsage(source: UsageTelemetry['source']): UsageTelemetry {
  return buildUsageTelemetry(source, 'fixed', {
    provider: 'local',
    modelId: 'browser-video-frame-extraction',
    costUsd: 0,
    imageCount: 1,
    notes: ['Video frame extraction runs locally in the browser and does not call a paid model.'],
  });
}

export function createLocalImageCropUsage(source: UsageTelemetry['source']): UsageTelemetry {
  return buildUsageTelemetry(source, 'fixed', {
    provider: 'local',
    modelId: 'browser-image-crop',
    costUsd: 0,
    imageCount: 1,
    notes: ['Image cropping runs locally in the browser and does not call a paid model.'],
  });
}

function resolveNodeOutputAsset(node: AppNode): string | undefined {
  if (
    (node.type === 'imageGen' || node.type === 'audioGen' || node.type === 'videoGen') &&
    (node.data.mediaMode ?? 'generate') === 'import'
  ) {
    const sourceAssetUrl = resultValueAsMediaUrl(node.data.sourceAssetUrl);
    if (sourceAssetUrl) {
      return sourceAssetUrl;
    }
    const result = resultValueAsMediaUrl(node.data.result);
    if (result) {
      return result;
    }
    if (node.data.sourceBinItemId) {
      const item = useSourceBinStore.getState().getAllItems().find((item) => item.id === node.data.sourceBinItemId);
      if (item?.assetUrl) {
        return item.assetUrl;
      }
    }
    return undefined;
  }

  return resultValueAsMediaUrl(node.data.result);
}

function shouldReuseExistingNodeOutput(node: AppNode): boolean {
  if (!['imageGen', 'cropImageNode', 'videoGen', 'audioGen', 'composition', 'functionNode'].includes(node.type)) {
    return false;
  }

  return Boolean(resolveNodeOutputAsset(node));
}

export function canRunNode(node: AppNode): boolean {
  if (
    node.type === 'composition' ||
    node.type === 'cropImageNode' ||
    node.type === 'visionVerifyNode' ||
    node.type === 'functionNode' ||
    node.type === 'apiFetchNode' ||
    node.type === 'transcriptionNode' ||
    node.type === 'audioProcessNode'
  ) {
    return true;
  }

  if (node.type === 'textNode') {
    return (node.data.mode ?? 'prompt') === 'generate';
  }

  if (node.type === 'imageGen' || node.type === 'audioGen' || node.type === 'videoGen') {
    return (node.data.mediaMode ?? 'generate') === 'generate';
  }

  return false;
}

function getModelId<TCapability extends keyof RuntimeSettingsSnapshot['defaultModels']>(
  settings: RuntimeSettingsSnapshot,
  capability: TCapability,
  provider: keyof RuntimeSettingsSnapshot['defaultModels'][TCapability],
  override?: string,
): string {
  const defaults = settings.defaultModels[capability] as Record<string, string>;
  return normalizeOptionalString(override) ?? defaults[String(provider)] ?? '';
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildNodeMap(nodes: AppNode[]): Map<string, AppNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

function buildIncomingMap(edges: Edge[]): Map<string, string[]> {
  const incoming = new Map<string, string[]>();

  for (const edge of edges) {
    const existing = incoming.get(edge.target) ?? [];
    existing.push(edge.source);
    incoming.set(edge.target, existing);
  }

  return incoming;
}

function getEffectiveSources(
  nodeId: string,
  edges: Edge[],
  nodesById: Map<string, AppNode>,
  visited = new Set<string>()
): AppNode[] {
  if (visited.has(nodeId)) {
    return [];
  }
  visited.add(nodeId);

  const node = nodesById.get(nodeId);
  if (!node) {
    return [];
  }

  if (canRunNode(node)) {
    return [node];
  }

  const sources: AppNode[] = [];
  const resolvedNode = resolveEffectiveSourceNode(node, nodesById, edges);
  if (resolvedNode && resolvedNode.id !== node.id) {
    return getEffectiveSources(resolvedNode.id, edges, nodesById, visited);
  }

  for (const edge of edges) {
    if (edge.target === nodeId) {
      const parentSources = getEffectiveSources(edge.source, edges, nodesById, visited);
      for (const src of parentSources) {
        if (!sources.some((s) => s.id === src.id)) {
          sources.push(src);
        }
      }
    }
  }

  if (sources.length === 0) {
    return [node];
  }

  return sources;
}

function getExecutionDependencies(
  node: AppNode,
  edges: Edge[],
  nodesById: Map<string, AppNode>,
): string[] {
  const dependencies = new Set<string>();

  for (const edge of edges) {
    if (edge.target !== node.id) {
      continue;
    }

    const rawSourceNode = nodesById.get(edge.source);
    if (!rawSourceNode) {
      continue;
    }

    const effectiveSources = getEffectiveSources(rawSourceNode.id, edges, nodesById);

    for (const sourceNode of effectiveSources) {
      if (sourceNode.type === 'settings') {
        dependencies.add(sourceNode.id);
        continue;
      }

      if (node.type === 'list') {
        const sourceKind = resolveNodeListItemKind(sourceNode);

        if (sourceKind && isListItemTargetHandle(edge.targetHandle)) {
          dependencies.add(sourceNode.id);
        }

        continue;
      }

      if (node.type === 'envelope') {
        dependencies.add(sourceNode.id);
        continue;
      }

      if (node.type === 'expander') {
        if (
          sourceNode.type === 'list' ||
          sourceNode.type === 'envelope' ||
          resolveNodeListItemKind(sourceNode)
        ) {
          dependencies.add(sourceNode.id);
        }

        continue;
      }

      if (sourceNode.type === 'expander') {
        const expandedItem = resolveExpandedListItemForNode(sourceNode, [...nodesById.values()], edges);
        if (expandedItem) {
          dependencies.add(sourceNode.id);
        }

        continue;
      }

      if (sourceNode.type === 'list' || sourceNode.type === 'envelope') {
        dependencies.add(sourceNode.id);
        continue;
      }

      if (sourceNode.type === 'packageNode') {
        dependencies.add(sourceNode.id);
        continue;
      }

      if (sourceNode.type === 'colorSwatchNode') {
        dependencies.add(sourceNode.id);
        continue;
      }

      if (node.type === 'functionNode') {
        if (sourceNode.type !== 'groupNode') {
          dependencies.add(sourceNode.id);
        }
        continue;
      }

      if (node.type === 'textNode') {
        if (sourceNode.type === 'textNode' || sourceNode.type === 'imageGen' || sourceNode.type === 'cropImageNode' || sourceNode.type === 'functionNode') {
          dependencies.add(sourceNode.id);
        }

        continue;
      }

      if (node.type === 'imageGen') {
        if (
          sourceNode.type === 'textNode' ||
          sourceNode.type === 'imageGen' ||
          sourceNode.type === 'cropImageNode' ||
          sourceNode.type === 'videoGen' ||
          sourceNode.type === 'composition' ||
          sourceNode.type === 'functionNode'
        ) {
          dependencies.add(sourceNode.id);
        }

        continue;
      }

      if (node.type === 'cropImageNode') {
        if (
          sourceNode.type === 'imageGen' ||
          sourceNode.type === 'cropImageNode' ||
          sourceNode.type === 'functionNode'
        ) {
          dependencies.add(sourceNode.id);
        }

        continue;
      }

      if (node.type === 'audioGen') {
        const audioMode = (node.data.audioGenerationMode as string | undefined) ?? 'speech';

        if (audioMode === 'voiceChange') {
          if (sourceNode.type === 'audioGen') {
            dependencies.add(sourceNode.id);
          }

          continue;
        }

        if (sourceNode.type === 'textNode' || sourceNode.type === 'functionNode') {
          dependencies.add(sourceNode.id);
        }

        continue;
      }

      if (node.type === 'videoGen') {
        if (sourceNode.type === 'textNode' || sourceNode.type === 'functionNode') {
          dependencies.add(sourceNode.id);
          continue;
        }

        if (
          (sourceNode.type === 'imageGen' || sourceNode.type === 'cropImageNode') &&
          isVideoImageConditioningHandle(edge.targetHandle as VideoTargetHandle | undefined)
        ) {
          dependencies.add(sourceNode.id);
          continue;
        }

        if (
          (sourceNode.type === 'videoGen' || sourceNode.type === 'composition') &&
          isVideoExtensionHandle(edge.targetHandle as VideoTargetHandle | undefined)
        ) {
          dependencies.add(sourceNode.id);
        }

        continue;
      }

      if (node.type === 'composition') {
        if (
          (isCompositionVideoConnection(edge) && ['videoGen', 'composition', 'functionNode'].includes(sourceNode.type)) ||
          (COMPOSITION_AUDIO_HANDLES.includes(edge.targetHandle as typeof COMPOSITION_AUDIO_HANDLES[number]) &&
            (sourceNode.type === 'audioGen' || sourceNode.type === 'functionNode'))
        ) {
          dependencies.add(sourceNode.id);
        }
      }

      if (node.type === 'visionVerifyNode') {
        if (
          sourceNode.type === 'textNode' ||
          sourceNode.type === 'imageGen' ||
          sourceNode.type === 'cropImageNode' ||
          sourceNode.type === 'visionVerifyNode' ||
          sourceNode.type === 'functionNode'
        ) {
          dependencies.add(sourceNode.id);
        }
        continue;
      }
    }
  }

  return [...dependencies].filter((depId) => depId !== node.id);
}

export function collectTextInputs(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
  edges: Edge[],
): string {
  const sourceIds = incoming.get(nodeId) ?? [];
  const prompts = sourceIds.flatMap((sourceId) =>
    collectTextInputsFromSource(sourceId, nodesById, incoming, edges, new Set()),
  );

  return prompts.join('\n\n').trim();
}

function collectTextInputsFromSource(
  sourceId: string,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
  edges: Edge[],
  visited: Set<string>,
): string[] {
  if (visited.has(sourceId)) {
    return [];
  }

  visited.add(sourceId);

  const node = nodesById.get(sourceId);
  if (!node) {
    return [];
  }

  if (node.type === 'settings') {
    return (incoming.get(sourceId) ?? []).flatMap((upstreamId) =>
      collectTextInputsFromSource(upstreamId, nodesById, incoming, edges, visited),
    );
  }

  if (node.type === 'virtual') {
    return (incoming.get(sourceId) ?? []).flatMap((upstreamId) =>
      collectTextInputsFromSource(upstreamId, nodesById, incoming, edges, visited),
    );
  }

  const listAndUtilityNodeTypes = [
    'textNode',
    'expander',
    'packageNode',
    'colorSwatchNode',
    'conditionalNode',
    'stringTemplateNode',
    'promptsJoinerNode',
    'regexReplaceNode',
    'listLengthNode',
    'mathNode',
    'logicNode',
    'comparisonNode',
    'visionVerifyNode',
    'valueMonitorNode',
    'numberNode',
    'functionNode',
    'doodleNode',
  ];

  if (listAndUtilityNodeTypes.includes(node.type)) {
    const monitorVisited = new Set(visited);
    monitorVisited.delete(node.id);
    const value = evaluateNodeTextForMonitor(node.id, Array.from(nodesById.values()), edges, monitorVisited);
    return value.trim() ? [value.trim()] : [];
  }

  if (node.type === 'envelope') {
    const items = collectEnvelopeItemsForEnvelopeNode(node.id, Array.from(nodesById.values()), edges);
    return items.flatMap((item) => {
      if (item.kind === 'text' && item.value?.trim()) {
        return [item.value.trim()];
      }
      if (item.kind === 'package' && item.text?.trim()) {
        return [item.text.trim()];
      }
      return [];
    });
  }

  return [];
}

function collectImageInputFromSource(
  sourceId: string,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
  edges: Edge[],
  visited: Set<string>,
): string | undefined {
  if (visited.has(sourceId)) {
    return undefined;
  }

  visited.add(sourceId);

  const node = nodesById.get(sourceId);
  if (!node) {
    return undefined;
  }

  if (node.type === 'settings') {
    for (const upstreamId of incoming.get(sourceId) ?? []) {
      const image = collectImageInputFromSource(upstreamId, nodesById, incoming, edges, visited);

      if (image) {
        return image;
      }
    }

    return undefined;
  }

  if (node.type === 'virtual') {
    for (const upstreamId of incoming.get(sourceId) ?? []) {
      const image = collectImageInputFromSource(upstreamId, nodesById, incoming, edges, visited);

      if (image) {
        return image;
      }
    }

    return undefined;
  }

  if (node.type === 'imageGen' || node.type === 'cropImageNode') {
    if ((node.data.mediaMode ?? 'generate') === 'import') {
      const sourceAssetUrl = resultValueAsMediaUrl(node.data.sourceAssetUrl);
      if (sourceAssetUrl) {
        return sourceAssetUrl;
      }
      const result = resultValueAsMediaUrl(node.data.result);
      if (result) {
        return result;
      }
      if (node.data.sourceBinItemId) {
        const item = useSourceBinStore.getState().getAllItems().find((item) => item.id === node.data.sourceBinItemId);
        if (item?.assetUrl) {
          return item.assetUrl;
        }
      }
      return undefined;
    }
    return resultValueAsMediaUrl(node.data.result);
  }

  if (node.type === 'functionNode') {
    return node.data.resultType === 'image' && typeof node.data.result === 'string'
      ? node.data.result
      : undefined;
  }

  if (node.type === 'packageNode') {
    const pkg = resolvePackageNodeData(node.id, Array.from(nodesById.values()), edges);
    return pkg.image;
  }

  if (node.type === 'doodleNode') {
    return typeof node.data.doodleSketch === 'string' && node.data.doodleSketch
      ? node.data.doodleSketch
      : undefined;
  }

  if (node.type === 'slimgNode') {
    return typeof node.data.result === 'string' && node.data.result ? node.data.result : undefined;
  }

  if (node.type === 'envelope') {
    const items = collectEnvelopeItemsForEnvelopeNode(node.id, Array.from(nodesById.values()), edges);
    const imgItem = items.find((item) => (item.kind === 'image' || item.kind === 'package') && item.value);
    return imgItem?.value;
  }

  if (node.type === 'expander') {
    const item = resolveExpandedListItemForNode(node, Array.from(nodesById.values()), edges);
    return item?.kind === 'image' ? item.value : undefined;
  }

  return undefined;
}

export function collectUpstreamImageInput(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const explicitSource = collectUpstreamImageInputForHandles(
    nodeId,
    ['image-edit-source', 'image'],
    nodesById,
    edges,
  );

  if (explicitSource) {
    return explicitSource;
  }

  const incoming = buildIncomingMap(edges);
  const matchingEdges = edges.filter(
    (edge) => edge.target === nodeId && (edge.targetHandle == null || edge.targetHandle === ''),
  );

  for (const edge of matchingEdges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, edge.sourceHandle)
      : undefined;

    const allowedTypes: FlowNodeType[] = ['imageGen', 'cropImageNode', 'slimgNode', 'packageNode', 'doodleNode', 'envelope', 'expander', 'functionNode'];
    if (!sourceNode || !allowedTypes.includes(sourceNode.type)) {
      continue;
    }

    const image = collectImageInputFromSource(edge.source, nodesById, incoming, edges, new Set());

    if (image) {
      return image;
    }
  }

  return undefined;
}

export function collectUpstreamImageInputForHandles(
  nodeId: string,
  targetHandles: Array<string | undefined>,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const incoming = buildIncomingMap(edges);
  const matchingEdges = edges.filter(
    (edge) => edge.target === nodeId && targetHandles.includes(edge.targetHandle ?? undefined),
  );

  for (const edge of matchingEdges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, edge.sourceHandle)
      : undefined;

    const allowedTypes: FlowNodeType[] = ['imageGen', 'cropImageNode', 'slimgNode', 'packageNode', 'doodleNode', 'envelope', 'expander', 'functionNode'];
    if (!sourceNode || !allowedTypes.includes(sourceNode.type)) {
      continue;
    }

    const image = collectImageInputFromSource(edge.source, nodesById, incoming, edges, new Set());

    if (image) {
      return image;
    }
  }

  return undefined;
}

function collectUpstreamVideoInput(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const matchingEdges = edges.filter((edge) => edge.target === nodeId);

  for (const edge of matchingEdges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
      : undefined;

    if (!sourceNode || !['videoGen', 'composition', 'functionNode'].includes(sourceNode.type)) {
      continue;
    }

    const asset = resolveNodeOutputAsset(sourceNode);

    if (asset) {
      return asset;
    }
  }

  return undefined;
}

function collectUpstreamAudioInput(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const matchingEdges = edges.filter((edge) => edge.target === nodeId);

  for (const edge of matchingEdges) {
    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
      : undefined;

    if (!sourceNode || !['audioGen', 'functionNode'].includes(sourceNode.type)) {
      continue;
    }

    const asset = resolveNodeOutputAsset(sourceNode);

    if (asset) {
      return asset;
    }
  }

  return undefined;
}

function collectVideoExtensionInput(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): string | undefined {
  const edge = edges.find(
    (candidate) => candidate.target === nodeId && candidate.targetHandle === 'video-source-video',
  );

  if (!edge) {
    return undefined;
  }

  const rawSourceNode = nodesById.get(edge.source);
  const sourceNode = rawSourceNode
    ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges)
    : undefined;

  if (!sourceNode || !['videoGen', 'composition', 'functionNode'].includes(sourceNode.type)) {
    return undefined;
  }

  return resolveNodeOutputAsset(sourceNode);
}

function collectExecutionConfig(
  nodeId: string,
  currentNode: AppNode,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
): ExecutionConfig {
  const configNodes: NodeData[] = [];
  visitConfigNodes(nodeId, nodesById, incoming, new Set(), configNodes);
  const baseConfig = getDefaultExecutionConfigForNode(currentNode.type);
  const mergedConfig = configNodes.reduce<ExecutionConfig>(
    (current, data) => mergeExecutionConfig(current, data),
    baseConfig,
  );

  return mergeExecutionConfig(mergedConfig, currentNode.data);
}

function visitConfigNodes(
  nodeId: string,
  nodesById: Map<string, AppNode>,
  incoming: Map<string, string[]>,
  visited: Set<string>,
  collected: NodeData[],
): void {
  if (visited.has(nodeId)) {
    return;
  }

  visited.add(nodeId);

  for (const sourceId of incoming.get(nodeId) ?? []) {
    visitConfigNodes(sourceId, nodesById, incoming, visited, collected);
    const sourceNode = nodesById.get(sourceId);

    if (sourceNode?.type === 'settings') {
      collected.push(sourceNode.data);
    }
  }
}

function mergeExecutionConfig(current: ExecutionConfig, data: NodeData): ExecutionConfig {
  return {
    aspectRatio: getNodeAspectRatio((data.aspectRatio as string | undefined) ?? current.aspectRatio),
    steps: coerceNumber(data.steps, current.steps),
    durationSeconds: coerceNumber(data.durationSeconds, current.durationSeconds),
    videoResolution: getVideoResolution((data.videoResolution as string | undefined) ?? current.videoResolution),
    videoFrameRate: coerceFrameRate(data.videoFrameRate, current.videoFrameRate),
    imageOutputFormat: getImageOutputFormat(
      (data.imageOutputFormat as string | undefined) ?? current.imageOutputFormat,
    ),
    audioOutputFormat: getAudioOutputFormat(
      (data.audioOutputFormat as string | undefined) ?? current.audioOutputFormat,
    ),
  };
}

function coerceFrameRate(value: unknown, fallback: number): number {
  const next = coerceNumber(value as number | string | undefined, fallback);
  return [24, 25, 30, 60].includes(next) ? next : fallback;
}

function coerceNumber(value: number | string | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function getDefaultExecutionConfigForNode(nodeType: FlowNodeType): ExecutionConfig {
  if (nodeType === 'videoGen') {
    return {
      ...DEFAULT_EXECUTION_CONFIG,
      aspectRatio: '16:9',
    };
  }

  return DEFAULT_EXECUTION_CONFIG;
}

function composePrompt(upstreamPrompt: string, nodePrompt: string): string {
  const contextPrompt = upstreamPrompt.trim();
  const instructionPrompt = nodePrompt.trim();

  if (contextPrompt && instructionPrompt) {
    return `Context:\n${contextPrompt}\n\nInstruction:\n${instructionPrompt}`;
  }

  return instructionPrompt || contextPrompt;
}

function estimateNodeOwnTelemetry(
  node: AppNode,
  context: ExecutionContextEstimate,
  settings: RuntimeSettingsSnapshot,
  planningRuntime?: Pick<ExecutionPlanRuntime, 'getDependencies'>,
): UsageTelemetry | undefined {
  if (!canRunNode(node)) {
    return undefined;
  }

  if (node.type === 'textNode') {
    const provider = (node.data.provider as TextProvider | undefined) ?? 'gemini';
    const modelId = getModelId(settings, 'text', provider, node.data.modelId);
    const prompt = composePrompt(context.prompt, (node.data.prompt ?? '').trim());
    const systemPrompt = (node.data.systemPrompt ?? '').trim();
    const inputText = [systemPrompt, prompt].filter(Boolean).join('\n\n');
    const inputTokens = estimateTokensFromText(inputText);
    const outputTokens = estimateTextOutputTokens(inputTokens);

    if (!inputTokens) {
      return undefined;
    }

    const costUsd =
      provider === 'gemini'
        ? estimateGeminiTextCostUsd(modelId, { inputTokens, outputTokens })
        : provider === 'openai'
          ? estimateOpenAITextCostUsd(modelId, { inputTokens, outputTokens })
          : undefined;

    return buildUsageTelemetry('estimate', costUsd === undefined ? 'unknown' : 'heuristic', {
      provider,
      modelId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd,
      notes: costUsd === undefined ? ['Pricing for this text model is not currently mapped in the app.'] : ['Output tokens are estimated heuristically before generation.'],
    });
  }

  if (node.type === 'cropImageNode') {
    return context.editImageInput
      ? createLocalImageCropUsage('estimate')
      : undefined;
  }

  if (node.type === 'imageGen') {
    if ((node.data.mediaMode ?? 'generate') !== 'generate') {
      return undefined;
    }

    if (context.sourceVideoInput) {
      return createLocalFrameExtractionUsage('estimate');
    }

    const provider = (node.data.provider as ImageProvider | undefined) ?? 'gemini';
    const modelId = getModelId(settings, 'image', provider, node.data.modelId);
    const prompt = context.prompt.trim();
    const inputTokens = estimateTokensFromText(prompt);

    if (!prompt) {
      return undefined;
    }

    if (provider === 'gemini') {
      return withAutoUpscaleEstimate(
        createGeminiImageUsage(modelId, prompt, context.config.aspectRatio, 'estimate', inputTokens),
        node.data,
        settings,
      );
    }

    if (provider === 'android') {
      return withAutoUpscaleEstimate(buildUsageTelemetry('estimate', 'fixed', {
        provider: 'android',
        modelId,
        imageCount: 1,
        costUsd: 0,
        notes: ['Android Accelerator generation runs on the paired phone with $0 provider spend.'],
      }), node.data, settings);
    }

    const modelDefinition = getImageModelDefinition(provider, modelId);
    const operation = resolveImageOperationForEstimate(
      modelDefinition.supportedOperations,
      Boolean(context.editImageInput),
    );
    const imageCount = projectedImageOutputCount(node);
    const imageCost = estimateImageModelCostUsd({
      providerId: provider,
      modelId,
      operation,
      imageCount,
      textInputTokens: inputTokens,
    });

    return withAutoUpscaleEstimate(buildUsageTelemetry('estimate', imageCost.confidence === 'unknown' ? 'unknown' : 'heuristic', {
      provider,
      modelId,
      inputTokens,
      totalTokens: inputTokens,
      imageCount,
      costUsd: imageCost.costUsd,
      notes: imageCost.notes,
    }), node.data, settings);
  }

  if (node.type === 'videoGen') {
    const provider = (node.data.provider as VideoProvider | undefined) ?? 'gemini';
    const modelId = getModelId(settings, 'video', provider, node.data.modelId);
    const prompt = context.prompt.trim();

    if (!prompt && !context.extensionVideoInput && !context.sourceVideoInput) {
      return undefined;
    }

    if (provider === 'gemini') {
      return createGeminiVideoUsage(modelId, context.config.durationSeconds, context.config.videoResolution, 'estimate');
    }

    return buildUsageTelemetry('estimate', 'unknown', {
      provider,
      modelId,
      durationSeconds: context.config.durationSeconds,
      notes: ['Pricing for this video provider is not currently mapped in the app.'],
    });
  }

  if (node.type === 'audioGen') {
    if ((node.data.mediaMode ?? 'generate') !== 'generate') {
      return undefined;
    }

    const provider = (node.data.provider as AudioProvider | undefined) ?? 'elevenlabs';
    const modelId = getModelId(settings, 'audio', provider, node.data.modelId);
    const audioMode = (node.data.audioGenerationMode as string | undefined) ?? 'speech';
    const prompt = context.prompt.trim();

    if (audioMode === 'voiceChange') {
      if (!context.audioSourceInput) {
        return undefined;
      }

      return buildUsageTelemetry('estimate', 'unknown', {
        provider,
        modelId,
        notes: ['Voice changer pricing is not currently mapped in the app.'],
      });
    }

    if (!prompt) {
      return undefined;
    }

    if (provider === 'elevenlabs' && audioMode === 'speech') {
      return createElevenLabsTtsUsage(modelId, prompt, 'estimate');
    }

    return buildUsageTelemetry('estimate', 'unknown', {
      provider,
      modelId,
      characters: prompt.length,
      notes: ['Pricing for this audio provider is not currently mapped in the app.'],
    });
  }

  if (node.type === 'transcriptionNode') {
    if (!context.audioSourceInput && !context.sourceVideoInput) return undefined;
    const alignment = node.data.transcriptionOperation === 'align';
    return buildUsageTelemetry('estimate', 'unknown', {
      provider: 'elevenlabs',
      modelId: alignment ? 'forced_alignment' : 'scribe_v2',
      notes: [`${alignment ? 'Forced Alignment' : 'Scribe v2'} pricing depends on source duration; the app cannot inspect duration before materializing the connected media.`],
    });
  }

  if (node.type === 'audioProcessNode') {
    if (!context.audioSourceInput && !context.sourceVideoInput) return undefined;
    return buildUsageTelemetry('estimate', 'unknown', {
      provider: 'elevenlabs',
      modelId: 'audio_isolation',
      notes: ['Voice Isolation is billed by source duration; the app cannot inspect duration before materializing the connected media.'],
    });
  }

  if (node.type === 'composition') {
    return createLocalCompositionUsage('estimate');
  }

  if (node.type === 'visionVerifyNode') {
    const provider = 'gemini';
    const modelId = node.data.modelId ?? 'gemini-3.5-flash';
    const prompt = context.prompt || 'Verify consistency';
    let inputTokens = estimateTokensFromText(prompt);

    if (context.editImageInput) {
      inputTokens += 258;
    }
    if (context.refImageInput) {
      inputTokens += 258;
    }

    const outputTokens = 512;

    const costUsd = estimateGeminiTextCostUsd(modelId, { inputTokens, outputTokens });

    return buildUsageTelemetry('estimate', costUsd === undefined ? 'unknown' : 'heuristic', {
      provider,
      modelId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd,
      notes: costUsd === undefined ? ['Pricing for this model is not currently mapped in the app.'] : ['Multimodal verification pricing includes prompt text and image tokens.'],
    });
  }

  if (node.type === 'functionNode') {
    const config = node.data.functionNode;
    if (!config || !Array.isArray(config.graph.nodes)) {
      return buildUsageTelemetry('estimate', 'unknown', {
        notes: ['Function wiring is malformed; provider cost cannot be estimated.'],
      });
    }
    const flowInputs = resolveFunctionInputBindings(config, {
      ...(context.functionInputs ?? {}),
      prompt: context.prompt,
      'input-flow': context.prompt,
      image: context.editImageInput ?? '',
      video: context.sourceVideoInput ?? '',
      audio: context.audioSourceInput ?? '',
    });
    const prepared = prepareFunctionSubgraph(config, flowInputs);
    if (!prepared) {
      return buildUsageTelemetry('estimate', 'fixed', {
        costUsd: 0,
        notes: ['Function has no reachable provider-backed internal node.'],
      });
    }

    const internalNodesById = buildNodeMap(prepared.nodes);
    const internalIncoming = buildIncomingMap(prepared.edges);
    const internalNodeIds = planFunctionProviderCalls(
      config.outputBindings.map((binding) => binding.sourceNodeId),
      prepared.edges,
      internalNodesById,
      planningRuntime?.getDependencies,
    );
    const internal = internalNodeIds
      .map((internalId) => {
        const internalNode = internalNodesById.get(internalId);
        if (!internalNode) return undefined;
        return estimateNodeOwnTelemetry(internalNode, {
          prompt: collectTextInputs(internalId, internalNodesById, internalIncoming, prepared.edges),
          functionInputs: internalNode.type === 'functionNode'
            ? collectFunctionInputsForEstimate(internalNode, internalNodesById, prepared.edges)
            : undefined,
          editImageInput: collectUpstreamImageInput(internalId, internalNodesById, prepared.edges),
          refImageInput: collectUpstreamImageInputForHandles(internalId, ['refImage'], internalNodesById, prepared.edges),
          audioSourceInput: collectUpstreamAudioInput(internalId, internalNodesById, prepared.edges),
          sourceVideoInput: collectUpstreamVideoInput(internalId, internalNodesById, prepared.edges),
          extensionVideoInput: collectVideoExtensionInput(internalId, internalNodesById, prepared.edges),
          config: collectExecutionConfig(internalId, internalNode, internalNodesById, internalIncoming),
        }, settings, planningRuntime);
      })
      .filter((entry): entry is UsageTelemetry => Boolean(entry));
    if (internal.length === 0) {
      return buildUsageTelemetry('estimate', 'fixed', {
        costUsd: 0,
        notes: ['Function has no reachable provider-backed internal node.'],
      });
    }
    const costKnown = internal.every((entry) => entry.costUsd !== undefined);
    return buildUsageTelemetry('estimate', costKnown ? 'heuristic' : 'unknown', {
      costUsd: costKnown ? internal.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0) : undefined,
      inputTokens: internal.reduce((sum, entry) => sum + (entry.inputTokens ?? 0), 0),
      outputTokens: internal.reduce((sum, entry) => sum + (entry.outputTokens ?? 0), 0),
      imageCount: internal.reduce((sum, entry) => sum + (entry.imageCount ?? 0), 0),
      notes: [`Estimated ${internal.length} reachable internal provider call${internal.length === 1 ? '' : 's'} after resolving Function inputs and output bindings.`],
    });
  }

  if (node.type === 'apiFetchNode') {
    return buildUsageTelemetry('estimate', 'unknown', {
      provider: 'api-requester',
      notes: ['External API Requester pricing is not known to Sloom Studio.'],
    });
  }

  return undefined;
}

export function estimateNodeExecutionTelemetry(
  node: AppNode,
  context: ExecutionContextEstimate,
  settings: RuntimeSettingsSnapshot,
): UsageTelemetry | undefined {
  return estimateNodeOwnTelemetry(node, context, settings);
}

function withAutoUpscaleEstimate(
  telemetry: UsageTelemetry,
  nodeData: NodeData,
  settings: RuntimeSettingsSnapshot,
): UsageTelemetry {
  if (!nodeData.imageAutoUpscale) {
    return telemetry;
  }

  const estimated = addConfiguredUpscaleCost({
    baseCostUsd: telemetry.costUsd,
    enabled: true,
    providerSettings: settings.providerSettings,
    apiKeys: settings.apiKeys,
  });

  return {
    ...telemetry,
    costUsd: estimated.costUsd,
    notes: [
      ...(telemetry.notes ?? []),
      ...estimated.notes,
    ],
  };
}

function resolveImageOperationForEstimate(
  operations: ImageModelOperation[],
  hasEditSource: boolean,
): ImageModelOperation {
  if (hasEditSource && operations.includes('image-edit')) {
    return 'image-edit';
  }
  if (hasEditSource && operations.includes('mask-inpaint')) {
    return 'mask-inpaint';
  }
  return operations[0] ?? 'text-to-image';
}

export function aggregateUsageTelemetries(telemetries: UsageTelemetry[]): UsageRollup {
  return telemetries.reduce<UsageRollup>(
    (rollup, telemetry) => {
      rollup.totalKnownCostUsd += telemetry.costUsd ?? 0;
      rollup.inputTokens += telemetry.inputTokens ?? 0;
      rollup.outputTokens += telemetry.outputTokens ?? 0;
      rollup.totalTokens += telemetry.totalTokens ?? (telemetry.inputTokens ?? 0) + (telemetry.outputTokens ?? 0);
      rollup.characters += telemetry.characters ?? 0;
      rollup.durationSeconds += telemetry.durationSeconds ?? 0;
      rollup.imageCount += telemetry.imageCount ?? 0;

      if (telemetry.costUsd === undefined && telemetry.provider !== 'local') {
        rollup.unknownCostCount += 1;
      } else {
        rollup.knownCostCount += 1;
      }

      return rollup;
    },
    {
      totalKnownCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      characters: 0,
      durationSeconds: 0,
      imageCount: 0,
      knownCostCount: 0,
      unknownCostCount: 0,
    },
  );
}

export function scaleUsageTelemetry(telemetry: UsageTelemetry, factor: number): UsageTelemetry {
  if (factor <= 0) {
    return {
      ...telemetry,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      characters: 0,
      durationSeconds: 0,
      imageCount: 0,
      costUsd: 0,
      notes: telemetry.notes ? [...telemetry.notes, 'Scaled to zero because all iterations are resumable.'] : ['Scaled to zero because all iterations are resumable.'],
    };
  }
  return {
    ...telemetry,
    inputTokens: (telemetry.inputTokens ?? 0) * factor,
    outputTokens: (telemetry.outputTokens ?? 0) * factor,
    totalTokens: (telemetry.totalTokens ?? 0) * factor,
    characters: (telemetry.characters ?? 0) * factor,
    durationSeconds: (telemetry.durationSeconds ?? 0) * factor,
    imageCount: (telemetry.imageCount ?? 0) * factor,
    costUsd: telemetry.costUsd === undefined ? undefined : telemetry.costUsd * factor,
  };
}

export function scaleUsageRollup(rollup: UsageRollup, factor: number): UsageRollup {
  if (factor <= 0) {
    return {
      totalKnownCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      characters: 0,
      durationSeconds: 0,
      imageCount: 0,
      knownCostCount: 0,
      unknownCostCount: 0,
    };
  }
  return {
    totalKnownCostUsd: rollup.totalKnownCostUsd * factor,
    inputTokens: rollup.inputTokens * factor,
    outputTokens: rollup.outputTokens * factor,
    totalTokens: rollup.totalTokens * factor,
    characters: rollup.characters * factor,
    durationSeconds: rollup.durationSeconds * factor,
    imageCount: rollup.imageCount * factor,
    knownCostCount: rollup.knownCostCount * factor,
    unknownCostCount: rollup.unknownCostCount * factor,
  };
}

export function mergeUsageRollups(a: UsageRollup, b: UsageRollup): UsageRollup {
  return {
    totalKnownCostUsd: a.totalKnownCostUsd + b.totalKnownCostUsd,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    characters: a.characters + b.characters,
    durationSeconds: a.durationSeconds + b.durationSeconds,
    imageCount: a.imageCount + b.imageCount,
    knownCostCount: a.knownCostCount + b.knownCostCount,
    unknownCostCount: a.unknownCostCount + b.unknownCostCount,
  };
}

export function estimateExecutionPlan(
  nodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  settings: RuntimeSettingsSnapshot,
  runtime?: ExecutionPlanRuntime,
): ExecutionPlanEstimate {
  const nodesById = buildNodeMap(nodes);
  const incoming = buildIncomingMap(edges);
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (currentId: string) => {
    if (visited.has(currentId)) {
      return;
    }

    visited.add(currentId);
    const currentNode = nodesById.get(currentId);

    if (!currentNode) {
      return;
    }

    if (currentId !== nodeId && (runtime
      ? runtime.shouldReuseExistingOutput(currentNode, nodes, edges)
      : shouldReuseExistingNodeOutput(currentNode))) {
      return;
    }

    const dependencyIds = runtime
      ? runtime.getDependencies(currentNode, edges, nodesById)
      : getExecutionDependencies(currentNode, edges, nodesById);
    for (const dependencyId of dependencyIds) {
      visit(dependencyId);
    }

    order.push(currentId);
  };

  visit(nodeId);

  const telemetries = order.flatMap((currentId) => {
    const currentNode = nodesById.get(currentId);

    if (!currentNode) {
      return [];
    }

    const telemetry = estimateNodeOwnTelemetry(
      currentNode,
      {
        prompt: collectTextInputs(currentId, nodesById, incoming, edges),
        functionInputs: currentNode.type === 'functionNode'
          ? collectFunctionInputsForEstimate(currentNode, nodesById, edges)
          : undefined,
        editImageInput: collectUpstreamImageInput(currentId, nodesById, edges),
        refImageInput: collectUpstreamImageInputForHandles(currentId, ['refImage'], nodesById, edges),
        audioSourceInput: collectUpstreamAudioInput(currentId, nodesById, edges),
        sourceVideoInput: collectUpstreamVideoInput(currentId, nodesById, edges),
        extensionVideoInput: collectVideoExtensionInput(currentId, nodesById, edges),
        config: collectExecutionConfig(currentId, currentNode, nodesById, incoming),
      },
      settings,
      runtime,
    );

    return telemetry ? [{ nodeId: currentId, telemetry }] : [];
  });

  return {
    nodeIds: order,
    telemetries,
    rollup: aggregateUsageTelemetries(telemetries.map((entry) => entry.telemetry)),
  };
}

function planFunctionProviderCalls(
  outputSourceNodeIds: Array<string | undefined>,
  edges: Edge[],
  nodesById: Map<string, AppNode>,
  dependencyPlanner: ExecutionPlanRuntime['getDependencies'] = getExecutionDependencies,
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (nodeId: string, stack: Set<string>) => {
    if (visited.has(nodeId) || stack.has(nodeId)) return;
    const node = nodesById.get(nodeId);
    if (!node) return;
    const nextStack = new Set(stack);
    nextStack.add(nodeId);
    for (const dependencyId of dependencyPlanner(node, edges, nodesById)) {
      visit(dependencyId, nextStack);
    }
    visited.add(nodeId);
    if (canRunNode(node)) order.push(nodeId);
  };

  for (const sourceNodeId of outputSourceNodeIds) {
    if (sourceNodeId) visit(sourceNodeId, new Set());
  }
  return order;
}

function collectFunctionInputsForEstimate(
  node: AppNode,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
): Record<string, DynamicValue> {
  const config = node.data.functionNode;
  if (!config) return {};
  const portsById = new Map(config.contract.inputPorts.map((port) => [port.id, port]));
  const inputs: Record<string, DynamicValue> = {};

  for (const edge of edges) {
    if (edge.target !== node.id || !edge.targetHandle) continue;
    const port = portsById.get(edge.targetHandle);
    const sourceNode = nodesById.get(edge.source);
    if (!port || !sourceNode) continue;
    const namedOutput = getFunctionNodeOutput(sourceNode, edge.sourceHandle);
    const value = namedOutput?.result
      ?? sourceNode.data.result
      ?? sourceNode.data.value
      ?? sourceNode.data.prompt
      ?? sourceNode.data.sourceAssetUrl
      ?? '';
    inputs[port.id] = value as DynamicValue;
    inputs[port.key] = value as DynamicValue;
  }
  return inputs;
}

export function estimateCanvasRunCosts(
  nodes: AppNode[],
  edges: Edge[],
  settings: RuntimeSettingsSnapshot,
): UsageRollup {
  const nodesById = buildNodeMap(nodes);
  const incoming = buildIncomingMap(edges);
  const telemetries = nodes.flatMap((node) => {
    const telemetry = estimateNodeOwnTelemetry(
      node,
      {
        prompt: collectTextInputs(node.id, nodesById, incoming, edges),
        editImageInput: collectUpstreamImageInput(node.id, nodesById, edges),
        refImageInput: collectUpstreamImageInputForHandles(node.id, ['refImage'], nodesById, edges),
        audioSourceInput: collectUpstreamAudioInput(node.id, nodesById, edges),
        sourceVideoInput: collectUpstreamVideoInput(node.id, nodesById, edges),
        extensionVideoInput: collectVideoExtensionInput(node.id, nodesById, edges),
        config: collectExecutionConfig(node.id, node, nodesById, incoming),
      },
      settings,
    );

    return telemetry ? [telemetry] : [];
  });

  return aggregateUsageTelemetries(telemetries);
}

export function collectActualUsageRollup(nodes: AppNode[]): UsageRollup {
  const telemetries = nodes.flatMap((node) =>
    (Array.isArray(node.data.resultHistory) ? node.data.resultHistory : [])
      .flatMap((attempt) => (attempt.usage ? [attempt.usage] : [])),
  );

  return aggregateUsageTelemetries(telemetries);
}

export function formatUsageSummary(telemetry: UsageTelemetry | undefined, prefix?: string): string | undefined {
  if (!telemetry) {
    return undefined;
  }

  const parts: string[] = [];

  if (telemetry.inputTokens || telemetry.outputTokens) {
    const tokenParts: string[] = [];

    if (telemetry.inputTokens) {
      tokenParts.push(`${formatCompactCount(telemetry.inputTokens)} in`);
    }

    if (telemetry.outputTokens) {
      tokenParts.push(`${formatCompactCount(telemetry.outputTokens)} out`);
    }

    parts.push(tokenParts.join(' / '));
  }

  if (telemetry.characters) {
    parts.push(`${formatCompactCount(telemetry.characters)} chars`);
  }

  if (telemetry.durationSeconds) {
    parts.push(`${telemetry.durationSeconds}s video`);
  }

  if (telemetry.imageCount) {
    parts.push(`${telemetry.imageCount} image${telemetry.imageCount === 1 ? '' : 's'}`);
  }

  if (telemetry.costUsd !== undefined) {
    parts.push(formatUsd(telemetry.costUsd));
  } else {
    parts.push('pricing unknown');
  }

  return [prefix, parts.join(' · ')].filter(Boolean).join(': ');
}

export function formatRollupSummary(rollup: UsageRollup, prefix: string): string {
  const parts: string[] = [];

  if (rollup.totalKnownCostUsd > 0) {
    parts.push(formatUsd(rollup.totalKnownCostUsd));
  }

  if (rollup.inputTokens > 0 || rollup.outputTokens > 0) {
    parts.push(`${formatCompactCount(rollup.inputTokens)} in / ${formatCompactCount(rollup.outputTokens)} out`);
  }

  if (rollup.characters > 0) {
    parts.push(`${formatCompactCount(rollup.characters)} chars`);
  }

  if (rollup.durationSeconds > 0) {
    parts.push(`${rollup.durationSeconds}s video`);
  }

  if (rollup.imageCount > 0) {
    parts.push(`${rollup.imageCount} image${rollup.imageCount === 1 ? '' : 's'}`);
  }

  if (rollup.unknownCostCount > 0) {
    parts.push(`${rollup.unknownCostCount} unknown-rate model${rollup.unknownCostCount === 1 ? '' : 's'}`);
  }

  return `${prefix}: ${parts.join(' · ') || 'No billable model usage detected'}`;
}
