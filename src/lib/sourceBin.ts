import type { Edge } from '@xyflow/react';
import type { AppNode, EditorSourceKind } from '../types/flow';
import type { SourceBinProfessionalMediaState } from '../types/videoProfessional';
import {
  collectEnvelopeItemsFromSourceNode,
  getDefaultMimeType,
  normalizeEnvelopeItems,
  resolvePackageNodeData,
} from './listNodes';
import { evaluateNodeSignal, signalToText } from './flowSignals';
import { resolveEffectiveSourceNode } from './virtualNodes';
import { resultValueAsMediaUrl } from './flowResultValues';

type SourceBinItemKind = 'text' | 'image' | 'video' | 'audio' | 'subtitle' | 'package';

function isSourceBinItemKind(value: string): value is SourceBinItemKind {
  return value === 'text' || value === 'image' || value === 'video' || value === 'audio' || value === 'subtitle' || value === 'package';
}

export interface SourceBinItem {
  id: string;
  nodeId: string;
  kind: EditorSourceKind;
  label: string;
  assetUrl?: string;
  /** Desktop-only authorized backing path. Kept alongside the preview URL for zero-copy native work. */
  nativeFilePath?: string;
  /** Project-scratch copy name. Its absence alongside nativeFilePath means a linked original. */
  scratchFileName?: string;
  text?: string;
  mimeType?: string;
  sourceBinItemId?: string;
  createdAt?: number;
  starred?: boolean;
  collapsed?: boolean;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
  envelopeCollapsed?: boolean;
  isGenerated?: boolean;
  durability?: 'recovery-inline' | 'session-only' | 'unavailable';
  professional?: SourceBinProfessionalMediaState;
}

export function collectSourceBinItems(
  nodes: AppNode[],
  edges: Edge[],
  sourceBinId: string,
): SourceBinItem[] {
  const hasSourceBin = nodes.some((node) => node.type === 'sourceBin' && node.id === sourceBinId);

  if (!hasSourceBin) {
    return [];
  }

  return collectGlobalSourceBinItems(nodes, edges);
}

export function collectGlobalSourceBinItems(
  nodes: AppNode[],
  edges: Edge[],
): SourceBinItem[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const sourceBinIds = new Set(nodes.filter((node) => node.type === 'sourceBin').map((node) => node.id));
  const deduped = new Map<string, SourceBinItem>();

  for (const edge of edges) {
    if (!sourceBinIds.has(edge.target)) {
      continue;
    }

    const rawSourceNode = nodesById.get(edge.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, edge.sourceHandle)
      : undefined;

    if (!sourceNode) {
      continue;
    }

    const items = buildSourceBinItems(sourceNode, nodes, edges, edge.sourceHandle);

    for (const item of items) {
      if (!deduped.has(item.id)) {
        deduped.set(item.id, item);
      }
    }
  }

  return [...deduped.values()];
}

export function buildSourceBinItems(node: AppNode, nodes?: AppNode[], edges?: Edge[], sourceHandle?: string | null): SourceBinItem[] {
  const sourceNodesById = nodes ? new Map(nodes.map((item) => [item.id, item])) : undefined;
  const isEnvelopeBacked = node.type === 'envelope' || node.type === 'list' || node.type === 'expander';
  // A generation/media node carries its OWN multi-result batch (loop) output in `data.envelopeItems`.
  // Expand those so all N images of a batch are recognised as connected source items — otherwise the
  // source-bin reconciliation (ingestConnectedItems) sees only the node's single `result` and prunes every
  // batch result but the first. Only when there are 2+ (a real batch): a single run collapses to one
  // node-level item (see sourceBin.test.ts), matching the long-standing single-generation behaviour.
  const ownEnvelopeItems = normalizeEnvelopeItems(node.data.envelopeItems);
  const envelopeItems = isEnvelopeBacked
    ? (nodes && edges
        ? collectEnvelopeItemsFromSourceNode(node, nodes, edges)
        : ownEnvelopeItems)
    : (ownEnvelopeItems.length > 1 ? ownEnvelopeItems : []);

  if (envelopeItems.length > 0) {
    const envelopeLabel = node.data.customTitle ?? getEnvelopeSourceLabel(node);
    return envelopeItems.filter((item) => isSourceBinItemKind(item.kind)).map((item) => {
      const baseSourceNodeId = item.sourceNodeId
        ? (item.sourceNodeId.includes(':') ? item.sourceNodeId.split(':')[0] : item.sourceNodeId)
        : node.id;

      return {
        id: `source-${item.id}`,
        nodeId: item.sourceNodeId
          ? (item.sourceNodeId.includes(':') ? item.sourceNodeId : `${item.sourceNodeId}:${item.index}`)
          : `${node.id}:${item.index}`,
        kind: item.kind as EditorSourceKind,
        label: item.label,
        assetUrl: item.kind === 'text' ? undefined : item.value,
        text: item.kind === 'text' ? item.value : (item.kind === 'package' ? item.text : undefined),
        mimeType: item.mimeType ?? getDefaultMimeType(item.kind),
        sourceBinItemId: item.sourceBinItemId,
        envelopeId: node.id,
        envelopeLabel,
        envelopeIndex: item.index,
        isGenerated: isSourceNodeGenerationOutput(sourceNodesById?.get(baseSourceNodeId)),
      };
    });
  }

  const item = buildSourceBinItem(node, nodes, edges, sourceHandle);
  return item ? [item] : [];
}

export function buildSourceBinItem(node: AppNode, nodes?: AppNode[], edges?: Edge[], sourceHandle?: string | null): SourceBinItem | undefined {
  const isGenerated = isSourceNodeGenerationOutput(node);
  const namedOutput = sourceHandle
    ? (node.data.namedOutputs?.[sourceHandle] ?? node.data.functionOutputs?.[sourceHandle])
    : undefined;

  if (namedOutput) {
    const kind = namedOutput.assetKind ?? namedOutput.resultType;
    if (isSourceBinItemKind(kind) && typeof namedOutput.result === 'string' && namedOutput.result) {
      return {
        id: `source-${node.id}-${sourceHandle}`,
        nodeId: node.id,
        kind,
        label: namedOutput.fileName ?? node.data.customTitle ?? `${kind[0].toUpperCase()}${kind.slice(1)}`,
        assetUrl: kind === 'text' ? undefined : namedOutput.result,
        text: kind === 'text' ? namedOutput.result : undefined,
        mimeType: namedOutput.mimeType ?? getDefaultMimeType(kind === 'subtitle' ? 'text' : kind),
        sourceBinItemId: namedOutput.sourceBinItemId,
        isGenerated,
      };
    }
  }

  switch (node.type) {
    case 'imageGen': {
      const assetUrl = resolveMediaNodeAsset(node);
      return assetUrl
        ? {
            id: `source-${node.id}`,
            nodeId: node.id,
            kind: 'image',
            label: node.data.sourceAssetName ?? node.data.modelId ?? 'Image',
            assetUrl,
            mimeType: resolveImportedMimeType(node),
            isGenerated,
          }
        : undefined;
    }
    case 'cropImageNode': {
      const assetUrl = resolveMediaNodeAsset(node);
      return assetUrl
        ? {
            id: `source-${node.id}`,
            nodeId: node.id,
            kind: 'image',
            label: node.data.customTitle ?? 'Cropped image',
            assetUrl,
            mimeType: node.data.resultMimeType ?? 'image/png',
            isGenerated,
          }
        : undefined;
    }
    case 'videoGen': {
      const assetUrl = resolveMediaNodeAsset(node);
      return assetUrl
        ? {
            id: `source-${node.id}`,
            nodeId: node.id,
            kind: 'video',
            label: node.data.sourceAssetName ?? node.data.modelId ?? 'Video',
            assetUrl,
            mimeType: resolveImportedMimeType(node) ?? 'video/mp4',
            isGenerated,
          }
        : undefined;
    }
    case 'audioGen': {
      const assetUrl = resolveMediaNodeAsset(node);
      return assetUrl
        ? {
            id: `source-${node.id}`,
            nodeId: node.id,
            kind: 'audio',
            label: node.data.sourceAssetName ?? node.data.voiceId ?? node.data.modelId ?? 'Audio',
            assetUrl,
            mimeType: resolveImportedMimeType(node) ?? 'audio/mpeg',
            isGenerated,
          }
        : undefined;
    }
    case 'composition': {
      const assetUrl = resultValueAsMediaUrl(node.data.result);
      return assetUrl
        ? {
            id: `source-${node.id}`,
            nodeId: node.id,
            kind: node.data.resultType === 'package' ? 'package' : 'composition',
            label: node.data.resultType === 'package' ? 'Composition package' : 'Composition output',
            assetUrl,
            mimeType: typeof node.data.resultMimeType === 'string'
              ? node.data.resultMimeType
              : node.data.resultType === 'package'
                ? 'application/zip'
                : 'video/mp4',
          }
        : undefined;
    }
    case 'functionNode': {
      const result = typeof node.data.result === 'string' ? node.data.result : undefined;
      if (!result) {
        return undefined;
      }
      if (node.data.resultType === 'text') {
        return {
          id: `source-${node.id}`,
          nodeId: node.id,
          kind: 'text',
          label: node.data.customTitle ?? node.data.functionNode?.title ?? 'Function output',
          text: result,
          mimeType: 'text/plain',
        };
      }
      if (
        node.data.resultType === 'image' ||
        node.data.resultType === 'video' ||
        node.data.resultType === 'audio' ||
        node.data.resultType === 'package'
      ) {
        return {
          id: `source-${node.id}`,
          nodeId: node.id,
          kind: node.data.resultType,
          label: node.data.customTitle ?? node.data.functionNode?.title ?? 'Function output',
          assetUrl: result,
          mimeType: node.data.resultMimeType ?? getDefaultMimeType(node.data.resultType),
        };
      }
      return undefined;
    }
    case 'textNode': {
      const mode = node.data.mode ?? 'prompt';
      const rawText = mode === 'generate' ? node.data.result : node.data.prompt;
      const text = typeof rawText === 'string' ? rawText.trim() : '';
      return text
        ? {
            id: `source-${node.id}`,
            nodeId: node.id,
            kind: 'text',
            label: text.slice(0, 48),
            text,
          }
        : undefined;
    }
    case 'packageNode': {
      const pkg = resolvePackageNodeData(node.id, nodes ?? [node], edges ?? []);
      return pkg.image || pkg.text
        ? {
            id: `source-${node.id}`,
            nodeId: node.id,
            kind: 'package',
            label: node.data.customTitle ?? 'Asset package',
            assetUrl: pkg.image,
            text: pkg.text,
            mimeType: 'image/png',
          }
        : undefined;
    }
    case 'doodleNode': {
      const text = signalToText(evaluateNodeSignal(node.id, nodes ?? [node], edges ?? [], new Set(), undefined, sourceHandle)).trim();
      const assetUrl = typeof node.data.doodleSketch === 'string' ? node.data.doodleSketch : undefined;
      return assetUrl || text
        ? {
            id: `source-${node.id}`,
            nodeId: node.id,
            kind: 'package',
            label: node.data.customTitle ?? 'Doodle package',
            assetUrl,
            text,
            mimeType: assetUrl?.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
          }
        : undefined;
    }
    default: {
      const signal = evaluateNodeSignal(node.id, nodes ?? [node], edges ?? [], new Set(), undefined, sourceHandle);
      if (!isSourceBinItemKind(signal.kind)) return undefined;
      const value = signalToText(signal).trim();
      if (!value) return undefined;
      if (signal.kind === 'text') {
        return {
          id: `source-${node.id}${sourceHandle ? `-${sourceHandle}` : ''}`,
          nodeId: node.id,
          kind: 'text',
          label: node.data.customTitle ?? value.slice(0, 48),
          text: value,
          mimeType: 'text/plain',
        };
      }
      return {
        id: `source-${node.id}${sourceHandle ? `-${sourceHandle}` : ''}`,
        nodeId: node.id,
        kind: signal.kind,
        label: node.data.customTitle ?? `${signal.kind[0].toUpperCase()}${signal.kind.slice(1)}`,
        assetUrl: value,
        mimeType: signal.mimeType ?? getDefaultMimeType(signal.kind),
      };
    }
  }
}

function getEnvelopeSourceLabel(node: AppNode): string {
  switch (node.type) {
    case 'textNode':
      return 'Text envelope';
    case 'imageGen':
      return 'Image envelope';
    case 'cropImageNode':
      return 'Cropped image envelope';
    case 'videoGen':
      return 'Video envelope';
    case 'audioGen':
      return 'Audio envelope';
    case 'transcriptionNode':
      return 'Transcription envelope';
    case 'audioProcessNode':
      return 'Processed audio envelope';
    case 'composition':
      return 'Composition envelope';
    case 'envelope':
      return 'Envelope';
    case 'list':
      return 'List';
    case 'expander':
      return 'Expander';
    case 'settings':
      return 'Settings';
    case 'sourceBin':
      return 'Source Bin';
    case 'valueNode':
      return 'Value';
    case 'virtual':
      return 'Virtual node';
    case 'portal':
      return 'Portal';
    case 'advancedImageEditor':
      return 'Image editor';
    case 'switchNode':
      return 'Switch';
    case 'forkSwitchNode':
      return 'Fork switch';
    case 'runMeNode':
      return 'RUN ME Trigger';
    case 'packageNode':
      return 'Asset Package';
    case 'loopNode':
      return 'Simple Loop';
    case 'visionVerifyNode':
      return 'Vision Verify';
    case 'logicNode':
      return 'Logic';
    case 'conditionalNode':
      return 'Conditional';
    case 'comparisonNode':
      return 'Comparison';
    case 'loopGateNode':
      return 'Loop Gate';
    case 'loopBreakNode':
      return 'Stop When';
    case 'mathNode':
      return 'Math Operator';
    case 'listLengthNode':
      return 'List Length';
    case 'valueMonitorNode':
      return 'Value Monitor';
    case 'stringTemplateNode':
      return 'String Template';
    case 'regexReplaceNode':
      return 'Regex Replace';
    case 'switchCaseNode':
      return 'Switch Case';
    case 'promptsJoinerNode':
      return 'Prompts Joiner';
    case 'negativePromptNode':
      return 'Negative Prompt';
    case 'seedSequencerNode':
      return 'Seed Sequencer';
    case 'promptMixerNode':
      return 'Prompt Mixer';
    case 'storyStateNode':
      return 'Story State Setter';
    case 'arrayFlatNode':
      return 'List Flattener';
    case 'textSentimentAnalysisNode':
      return 'Text Sentiment Analyzer';
    case 'imageFeatureExtractorNode':
      return 'Image Feature Extractor';
    case 'fallbackSelectorNode':
      return 'Fallback Selector';
    case 'dialogueScriptSplitterNode':
      return 'Dialogue Script Splitter';
    case 'numberNode':
      return 'Number';
    case 'colorSwatchNode':
      return 'Color Swatch';
    case 'colorSwatchListNode':
      return 'Color Swatch List';
    case 'loraSpecNode':
      return 'LoRA Spec';
    case 'slimgNode':
      return '.slimg';
    case 'doodleNode':
      return 'Doodle';
    case 'functionNode':
      return 'Function';
    case 'groupNode':
      return 'Group';
    case 'functionInputNode':
      return 'Function Input Marker';
    case 'functionOutputNode':
      return 'Function Output Marker';
    case 'javascriptNode':
      return 'JavaScript';
    case 'jsonQueryNode':
      return 'JSON Query';
    case 'regexParseNode':
      return 'Regex Parse';
    case 'pythonNode':
      return 'Python Script';
    case 'jsonBuilderNode':
      return 'JSON Builder';
    case 'htmlSandboxNode':
      return 'HTML Sandbox';
    case 'apiFetchNode':
      return 'API Requester';
    case 'sqlQueryNode':
      return 'SQL Query';
    case 'csvParserNode':
      return 'CSV Interop';
    case 'mathExpressionNode':
      return 'Math Expression';
    case 'xmlYamlNode':
      return 'XML/YAML Interop';
    default:
      return 'Custom Node';
  }
}

function isSourceNodeGenerationOutput(node: AppNode | undefined): boolean {
  if (!node) {
    return false;
  }

  if (node.type !== 'imageGen' && node.type !== 'cropImageNode' && node.type !== 'videoGen' && node.type !== 'audioGen' && node.type !== 'transcriptionNode' && node.type !== 'audioProcessNode') {
    return false;
  }

  if (node.type === 'cropImageNode') {
    return true;
  }

  if (node.type === 'transcriptionNode' || node.type === 'audioProcessNode') {
    return true;
  }

  return (node.data.mediaMode ?? 'generate') === 'generate';
}

export function resolveMediaNodeAsset(node: AppNode): string | undefined {
  if (node.type === 'imageGen' || node.type === 'cropImageNode' || node.type === 'videoGen' || node.type === 'audioGen') {
    return (node.data.mediaMode ?? 'generate') === 'import'
      ? resultValueAsMediaUrl(node.data.sourceAssetUrl)
      : resultValueAsMediaUrl(node.data.result);
  }

  if (node.type === 'composition') {
    return resultValueAsMediaUrl(node.data.result);
  }

  if (node.type === 'audioProcessNode') {
    return resultValueAsMediaUrl(node.data.result);
  }

  if (node.type === 'functionNode') {
    return typeof node.data.result === 'string' ? node.data.result : undefined;
  }

  if (node.type === 'slimgNode' || node.type === 'advancedImageEditor') {
    return typeof node.data.result === 'string' ? node.data.result : undefined;
  }

  return undefined;
}

function resolveImportedMimeType(node: AppNode): string | undefined {
  if (node.type === 'imageGen' || node.type === 'cropImageNode' || node.type === 'videoGen' || node.type === 'audioGen') {
    return (node.data.mediaMode ?? 'generate') === 'import'
      ? node.data.sourceAssetMimeType
      : undefined;
  }

  return undefined;
}
