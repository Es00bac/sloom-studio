import type { Edge } from '@xyflow/react';
import type { AppNode, EnvelopeItem, FunctionNodeOutput, ResultType, VideoReferenceType } from '../types/flow';
import {
  referenceSlotNumberForHandle,
  stableReferenceGuidanceJson,
  type FlowReferenceGroup,
} from './referenceGroups';
import {
  getOrderedListInputEdges,
  resolveExpandedListItemForNode,
  resolvePackageNodeData,
  type FlowListItem,
} from './listNodes';
import { resolveEffectiveSourceNode } from './virtualNodes';
import { LOOP_BREAK_TARGET_HANDLE } from './flowControlHandles';
import { isFlowPrimitiveKind } from './flowValueTypes';
import { formatColorSwatchListPrompt, formatColorSwatchPrompt } from './colorSwatchNode';
import { resolveFlowVariablesInText } from './flowVariables';
import { buildLoraWeightsJson } from './loraSpecNode';
import { buildDoodleAssetPackage } from './doodleNode';
import { analyzeTextSentiment, splitDialogueForPrefix } from './storyUtilityNodes';
import {
  deserializeResultValueFromContainer,
  resultValueAsMediaUrl,
  restoreResultValue,
} from './flowResultValues';

export type FlowSignalKind = ResultType | 'boolean' | 'any';
export type FlowDiagnosticSeverity = 'info' | 'warning' | 'critical';

export interface FlowDiagnostic {
  id: string;
  severity: FlowDiagnosticSeverity;
  message: string;
  nodeId?: string;
  edgeId?: string;
  suggestedFix?: string;
  blocksRun: boolean;
}

export interface FlowSignal {
  kind: FlowSignalKind;
  value: unknown;
  items?: FlowSignal[];
  label?: string;
  sourceNodeId?: string;
  mimeType?: string;
  diagnostics: FlowDiagnostic[];
}

type SignalRecord = Record<string, FlowSignal>;

const TEXTUAL_KINDS = new Set<FlowSignalKind>(['text', 'number', 'boolean', 'json', 'package']);
const MAX_SIGNAL_DEPTH = 256;

export function evaluateNodeSignal(
  nodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string> = new Set<string>(),
  nodesById: Map<string, AppNode> = new Map(nodes.map((candidate) => [candidate.id, candidate])),
  sourceHandle?: string | null,
): FlowSignal {
  if (visited.has(nodeId)) {
    return emptySignal('text', nodeId, [
      {
        id: `cycle-${nodeId}`,
        severity: 'critical',
        nodeId,
        message: 'Flow signal evaluation stopped because this utility chain contains a cycle.',
        suggestedFix: 'Remove the circular utility-node connection or route the loop through an explicit loop node.',
        blocksRun: true,
      },
    ]);
  }

  if (visited.size >= MAX_SIGNAL_DEPTH) {
    return emptySignal('text', nodeId, [
      {
        id: `too-deep-${nodeId}`,
        severity: 'critical',
        nodeId,
        message: 'Flow signal evaluation stopped because this utility chain is too deep.',
        suggestedFix: 'Collapse repeated logic into a reusable function or insert an explicit list/loop boundary.',
        blocksRun: true,
      },
    ]);
  }

  const nextVisited = new Set(visited);
  nextVisited.add(nodeId);

  const node = nodesById.get(nodeId);
  if (!node) {
    return emptySignal('text', nodeId);
  }

  if (node.type === 'valueMonitorNode') {
    const incomingEdge = edges.find((edge) => edge.target === node.id);
    return incomingEdge
      ? evaluateNodeSignal(incomingEdge.source, nodes, edges, nextVisited, nodesById, incomingEdge.sourceHandle)
      : emptySignal('text', node.id);
  }

  if (['portal', 'virtual'].includes(node.type)) {
    const effectiveNode = resolveEffectiveSourceNode(node, nodesById, edges, sourceHandle);
    if (effectiveNode && effectiveNode.id !== node.id) {
      return evaluateNodeSignal(effectiveNode.id, nodes, edges, nextVisited, nodesById);
    }
  }

  const namedOutput = sourceHandle
    ? (node.data.namedOutputs?.[sourceHandle] ?? node.data.functionOutputs?.[sourceHandle])
    : undefined;
  if (namedOutput) {
    return scalarSignal(namedOutput.resultType, deserializeFunctionOutputValue(namedOutput), node.id, {
      label: node.data.customTitle,
      mimeType: namedOutput.mimeType,
    });
  }

  switch (node.type) {
    case 'textNode': {
      const mode = node.data.mode ?? 'prompt';
      if (mode === 'generate' && Array.isArray(node.data.envelopeItems)) {
        return listSignal(node.data.envelopeItems.map((item) => signalFromEnvelopeItem(item)), node.id, 'envelope');
      }
      const resolved = resolveFlowVariablesInText(
        String((mode === 'generate' ? node.data.result : node.data.prompt) ?? ''),
        nodes,
        edges,
      );
      return scalarSignal('text', resolved.text, node.id, { diagnostics: resolved.diagnostics });
    }
    case 'valueNode':
      return evaluateValueNode(node);
    case 'numberNode':
      return scalarSignal('number', coerceNumber(node.data.value, 0), node.id);
    case 'list':
      return evaluateListLikeNode(node, nodes, edges, nextVisited, nodesById, 'list');
    case 'envelope':
      return evaluateListLikeNode(node, nodes, edges, nextVisited, nodesById, 'envelope');
    case 'loopNode':
      return evaluateLoopNode(node, nodes, edges, nextVisited, nodesById);
    case 'loopBreakNode':
      return evaluateLoopBreakNode(node, nodes, edges, nextVisited, nodesById);
    case 'expander': {
      const item = resolveExpandedListItemForNode(node, nodes, edges, nextVisited);
      return item ? signalFromListItem(item) : emptySignal('text', node.id);
    }
    case 'packageNode': {
      const pkg = resolvePackageNodeData(node.id, nodes, edges, nextVisited);
      return scalarSignal('package', pkg.text || pkg.image || '', node.id, { label: node.data.customTitle as string | undefined });
    }
    case 'colorSwatchNode':
      if (sourceHandle?.startsWith('palette-color-')) {
        const index = Number(sourceHandle.slice('palette-color-'.length));
        const color = normalizeHexColor(node.data.colorSwatchColors?.[index]);
        return scalarSignal('text', color, node.id);
      }
      return scalarSignal('text', formatColorSwatchPrompt(node.data), node.id, {
        label: node.data.customTitle as string | undefined,
      });
    case 'doodleNode': {
      // The description is the doodle's text half of its asset package; an
      // attached Text node (upstream) overrides the typed box.
      const own = String(node.data.doodleDescription ?? '').trim();
      const incomingEdge = edges.find((edge) => edge.target === node.id);
      const upstream = incomingEdge
        ? signalToText(evaluateNodeSignal(incomingEdge.source, nodes, edges, nextVisited, nodesById, incomingEdge.sourceHandle)).trim()
        : '';
      const pkg = buildDoodleAssetPackage({
        sketch: node.data.doodleSketch,
        ownDescription: own,
        upstreamText: upstream,
      });
      return scalarSignal('package', pkg.description, node.id, { mimeType: pkg.image ? 'image/png' : undefined });
    }
    case 'settings':
      return evaluateSettingsNode(node);
    case 'advancedImageEditor':
      return scalarSignal('image', resultValueAsMediaUrl(sourceHandle === 'maskOutput' ? node.data.maskOutput : node.data.result) ?? '', node.id);
    case 'switchNode':
      return evaluateSwitchNode(node, nodes, edges, nextVisited, nodesById);
    case 'forkSwitchNode':
      return evaluateForkSwitchNode(node, nodes, edges, nextVisited, nodesById, sourceHandle);
    case 'stringTemplateNode':
      return evaluateStringTemplateNode(node, nodes, edges, nextVisited, nodesById);
    case 'promptsJoinerNode':
      return evaluatePromptsJoinerNode(node, nodes, edges, nextVisited, nodesById);
    case 'regexReplaceNode':
      return evaluateRegexReplaceNode(node, nodes, edges, nextVisited, nodesById);
    case 'mathNode':
      return evaluateMathNode(node, nodes, edges, nextVisited, nodesById);
    case 'logicNode':
      return evaluateLogicNode(node, nodes, edges, nextVisited, nodesById);
    case 'comparisonNode':
      return evaluateComparisonNode(node, nodes, edges, nextVisited, nodesById);
    case 'conditionalNode':
      return evaluateConditionalNode(node, nodes, edges, nextVisited, nodesById);
    case 'listLengthNode':
      return scalarSignal('number', resolveListLikeLength(node, nodes, edges, nextVisited, nodesById), node.id);
    case 'arrayFlatNode':
      return evaluateArrayFlatNode(node, nodes, edges, nextVisited, nodesById);
    case 'loopGateNode':
      return evaluateLoopGateNode(node, nodes, edges, nextVisited, nodesById);
    case 'switchCaseNode':
      return evaluateSwitchCaseNode(node, nodes, edges, nextVisited, nodesById, sourceHandle);
    case 'negativePromptNode':
      return evaluateNegativePromptNode(node, nodes, edges, nextVisited, nodesById);
    case 'seedSequencerNode':
      return evaluateSeedSequencerNode(node, nodes, edges, nextVisited, nodesById);
    case 'promptMixerNode':
      return evaluatePromptMixerNode(node, nodes, edges, nextVisited, nodesById);
    case 'storyStateNode':
      return evaluateStoryStateNode(node, nodes, edges, nextVisited, nodesById);
    case 'textSentimentAnalysisNode':
      return evaluateTextSentimentNode(node, nodes, edges, nextVisited, nodesById);
    case 'imageFeatureExtractorNode':
      return evaluateImageFeatureExtractorNode(node, nodes, edges, nextVisited, nodesById);
    case 'fallbackSelectorNode':
      return evaluateFallbackSelectorNode(node, nodes, edges, nextVisited, nodesById);
    case 'dialogueScriptSplitterNode':
      return evaluateDialogueScriptSplitterNode(node, nodes, edges, nextVisited, nodesById);
    case 'colorSwatchListNode':
      return scalarSignal('text', formatColorSwatchListPrompt(node, nodes, edges), node.id);
    case 'loraSpecNode':
      return evaluateLoraSpecNode(node);
    case 'slimgNode':
      return scalarSignal('image', resultValueAsMediaUrl(node.data.result) ?? '', node.id, { mimeType: node.data.resultMimeType });
    case 'visionVerifyNode': {
      const value = restoreResultValue(node.data.result, 'boolean');
      if (typeof value !== 'boolean') return invalidBooleanSignal(node.id, 'Vision Verify');
      return scalarSignal('boolean', value, node.id, { label: String(value) });
    }
    case 'imageGen':
    case 'cropImageNode':
      return mediaSignal(node, 'image');
    case 'videoGen':
    case 'composition':
      return mediaSignal(node, 'video');
    case 'audioGen':
    case 'audioProcessNode':
      return mediaSignal(node, 'audio');
    case 'functionNode': {
      if (Array.isArray(node.data.envelopeItems) && node.data.envelopeItems.length > 0) {
        return listSignal(node.data.envelopeItems.map((item) => signalFromEnvelopeItem(item)), node.id, 'envelope');
      }
      const kind = isResultType(node.data.resultType) ? node.data.resultType : inferKindFromValue(node.data.result);
      const value = restoreResultValue(node.data.result, kind);
      if (value === undefined) {
        return kind === 'boolean'
          ? invalidBooleanSignal(node.id, node.data.customTitle ?? node.data.functionNode?.title ?? 'Function')
          : emptySignal(kind, node.id);
      }
      return scalarSignal(kind, value, node.id, {
        label: node.data.customTitle ?? node.data.functionNode?.title,
        mimeType: node.data.resultMimeType,
      });
    }
    case 'functionOutputNode': {
      const incomingEdge = edges.find((edge) => edge.target === node.id);
      if (incomingEdge) {
        return evaluateNodeSignal(incomingEdge.source, nodes, edges, nextVisited, nodesById, incomingEdge.sourceHandle);
      }
      const val = node.data.result !== undefined ? node.data.result : (node.data.value !== undefined ? node.data.value : '');
      const kind = isResultType(node.data.resultType) ? node.data.resultType : inferKindFromValue(val);
      const value = restoreResultValue(val, kind);
      return value === undefined && kind === 'boolean'
        ? invalidBooleanSignal(node.id, 'Function output')
        : scalarSignal(kind, value ?? '', node.id);
    }
    case 'functionInputNode': {
      const val = node.data.result !== undefined ? node.data.result : (node.data.value !== undefined ? node.data.value : '');
      const kind = isResultType(node.data.resultType) ? node.data.resultType : inferKindFromValue(val);
      const value = restoreResultValue(val, kind);
      return value === undefined && kind === 'boolean'
        ? invalidBooleanSignal(node.id, 'Function input')
        : scalarSignal(kind, value ?? '', node.id);
    }
    case 'javascriptNode':
      return evaluateJavaScriptNode(node, nodes, edges, nextVisited, nodesById);
    case 'jsonQueryNode':
      return evaluateJsonQueryNode(node, nodes, edges, nextVisited, nodesById);
    case 'regexParseNode':
      return evaluateRegexParseNode(node, nodes, edges, nextVisited, nodesById);
    case 'pythonNode':
      return evaluatePythonNode(node, nodes, edges, nextVisited, nodesById);
    case 'jsonBuilderNode':
      return evaluateJsonBuilderNode(node, nodes, edges, nextVisited, nodesById);
    case 'htmlSandboxNode':
      return evaluateHtmlSandboxNode(node, nodes, edges, nextVisited, nodesById);
    case 'apiFetchNode':
      return evaluateApiFetchNode(node, nodes, edges, nextVisited, nodesById);
    case 'sqlQueryNode':
      return evaluateSqlQueryNode(node, nodes, edges, nextVisited, nodesById);
    case 'csvParserNode':
      return evaluateCsvParserNode(node, nodes, edges, nextVisited, nodesById);
    case 'mathExpressionNode':
      return evaluateMathExpressionNode(node, nodes, edges, nextVisited, nodesById);
    case 'xmlYamlNode':
      return evaluateXmlYamlNode(node, nodes, edges, nextVisited, nodesById);
    default:
      if (node.data.result !== undefined && node.data.result !== null) {
        const kind = isResultType(node.data.resultType) ? node.data.resultType : inferKindFromValue(node.data.result);
        const value = restoreResultValue(node.data.result, kind);
        return value === undefined && kind === 'boolean'
          ? invalidBooleanSignal(node.id, node.type)
          : scalarSignal(kind, value ?? '', node.id);
      }
      if (node.data.value !== undefined && node.data.value !== null) {
        return scalarSignal(inferKindFromValue(node.data.value), node.data.value, node.id);
      }
      return emptySignal('text', node.id);
  }
}

export interface NodePromptSignals {
  /**
   * Every incoming textual signal combined exactly as before AUD-011 — this remains the single
   * cardinality and diagnostics authority for loop planning, so numbered reference guidance
   * still participates in iteration counts and list-length validation.
   */
  combined: FlowSignal;
  /** Textual signals from unnumbered handles only — the honest global prompt. */
  prompt: FlowSignal;
  /** Ordered textual signals per numbered reference target handle. */
  referenceTextSignals: Map<string, FlowSignal[]>;
}

export function collectNodePromptSignals(nodeId: string, nodes: AppNode[], edges: Edge[]): NodePromptSignals {
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const targetNodeType = nodesById.get(nodeId)?.type;
  const incomingEdges = edges.filter((edge) =>
    edge.target === nodeId
    && edge.targetHandle !== LOOP_BREAK_TARGET_HANDLE
    && nodesById.get(edge.source)?.type !== 'settings'
    && nodesById.get(edge.source)?.type !== 'loraSpecNode'
  );
  const textualEdgeSignals = incomingEdges.flatMap((edge) => {
    const signal = evaluateNodeSignal(edge.source, nodes, edges, new Set<string>(), nodesById, edge.sourceHandle);
    return isTextualSignal(signal) ? [{ edge, signal }] : [];
  });

  const referenceTextSignals = new Map<string, FlowSignal[]>();
  const promptSignals: FlowSignal[] = [];
  for (const { edge, signal } of textualEdgeSignals) {
    const slot = referenceSlotNumberForHandle(targetNodeType, edge.targetHandle);
    if (slot === undefined) {
      promptSignals.push(signal);
      continue;
    }
    const handle = edge.targetHandle as string;
    referenceTextSignals.set(handle, [...(referenceTextSignals.get(handle) ?? []), signal]);
  }

  return {
    combined: combineTextualPromptSignals(nodeId, textualEdgeSignals.map(({ signal }) => signal)),
    prompt: combineTextualPromptSignals(nodeId, promptSignals),
    referenceTextSignals,
  };
}

export function collectPromptSignalForNode(nodeId: string, nodes: AppNode[], edges: Edge[]): FlowSignal {
  return collectNodePromptSignals(nodeId, nodes, edges).combined;
}

function combineTextualPromptSignals(nodeId: string, promptSignals: FlowSignal[]): FlowSignal {
  if (promptSignals.length === 0) {
    return scalarSignal('text', '', nodeId);
  }

  if (promptSignals.length === 1) {
    return promptSignals[0];
  }

  return vectorizeRecord(nodeId, Object.fromEntries(promptSignals.map((signal, index) => [`input${index}`, signal])), (values) =>
    scalarSignal(
      'text',
      Object.values(values)
        .map((value) => signalToText(value).trim())
        .filter(Boolean)
        .join('\n\n'),
      nodeId,
    ),
  );
}

/**
 * Resolves the signal that applies to one loop iteration: non-lists broadcast, single-item
 * lists broadcast, longer lists take the iteration's item — the same selection rule
 * `signalToTextAt` uses for the prompt, so numbered reference guidance and the prompt stay on
 * the same iteration axis.
 */
export function signalAtIterationIndex(signal: FlowSignal, index: number): FlowSignal {
  if (!isListSignal(signal)) {
    return signal;
  }

  if (signal.items.length === 0) {
    return emptySignal('text', signal.sourceNodeId);
  }

  return signal.items[signal.items.length === 1 ? 0 : index] ?? signal.items[0];
}

export interface ReferenceSlotInputs {
  /** 1-based numbered slot (`Reference N`). */
  slot: number;
  /** The slot's statically resolved image, if an image-like connection exists. */
  imageUrl?: string;
  /** Video slots carry the authored asset/style type. */
  referenceType?: VideoReferenceType;
  /** Ordered textual/JSON signals authored onto this numbered handle. */
  textSignals: FlowSignal[];
}

/**
 * Materializes the canonical AUD-011 reference groups for one iteration. Empty slots are
 * omitted; slot order is the deterministic Reference 1..N order the inputs were collected in.
 */
export function resolveReferenceGroupsAtIndex(
  slots: readonly ReferenceSlotInputs[],
  index: number,
): FlowReferenceGroup[] {
  return slots.flatMap((slot) => {
    const descriptions: string[] = [];
    const jsonGuidance: string[] = [];
    for (const signal of slot.textSignals) {
      const item = signalAtIterationIndex(signal, index);
      if (item.kind === 'json') {
        jsonGuidance.push(stableReferenceGuidanceJson(item.value));
        continue;
      }
      const text = signalToText(item).trim();
      // A text-less Package signal falls back to its image URL; that image already IS the
      // slot's image, so it is not guidance.
      if (!text || text === slot.imageUrl) continue;
      descriptions.push(text);
    }

    if (!slot.imageUrl && descriptions.length === 0 && jsonGuidance.length === 0) {
      return [];
    }

    return [{
      slot: slot.slot,
      ...(slot.imageUrl ? { imageUrl: slot.imageUrl } : {}),
      descriptions,
      jsonGuidance,
      ...(slot.referenceType ? { referenceType: slot.referenceType } : {}),
    }];
  });
}

export function getSignalIterationCount(signal: FlowSignal): number {
  return isListSignal(signal) ? signal.items.length : 0;
}

export function signalToTextList(signal: FlowSignal): string[] {
  if (isListSignal(signal)) {
    return signal.items.map((item) => signalToText(item));
  }

  const text = signalToText(signal);
  return text.trim() ? [text] : [];
}

export function signalToTextAt(signal: FlowSignal, index: number): string {
  if (!isListSignal(signal)) {
    return signalToText(signal);
  }

  if (signal.items.length === 0) {
    return '';
  }

  return signalToText(signal.items[signal.items.length === 1 ? 0 : index] ?? signal.items[0]);
}

export function signalToText(signal: FlowSignal): string {
  if (isListSignal(signal)) {
    return signal.items.map((item) => signalToText(item)).join('\n\n').trim();
  }

  if (signal.kind === 'boolean') {
    return signal.value ? 'true' : 'false';
  }

  if (typeof signal.value === 'string') {
    return signal.value;
  }

  if (typeof signal.value === 'number') {
    return String(signal.value);
  }

  if (signal.value === null || signal.value === undefined) {
    return '';
  }

  return JSON.stringify(signal.value);
}

export function getBlockingSignalDiagnostics(signal: FlowSignal): FlowDiagnostic[] {
  return collectSignalDiagnostics(signal).filter((diagnostic) => diagnostic.blocksRun);
}

export function collectSignalDiagnostics(signal: FlowSignal): FlowDiagnostic[] {
  return [
    ...signal.diagnostics,
    ...(signal.items ?? []).flatMap((item) => collectSignalDiagnostics(item)),
  ];
}

function evaluateStringTemplateNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const variableResolvedTemplate = resolveFlowVariablesInText(String(node.data.template ?? '{A} and {B}'), nodes, edges);
  const template = variableResolvedTemplate.text;
  const inputs = collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A');

  return vectorizeRecord(node.id, inputs, (values) => {
    let rendered = template;
    for (const [key, value] of Object.entries(values)) {
      rendered = replaceTemplateToken(rendered, key, signalToText(value));
    }
    for (const key of ['A', 'B', 'C']) {
      rendered = replaceTemplateToken(rendered, key, '');
    }
    return scalarSignal('text', rendered, node.id, { diagnostics: variableResolvedTemplate.diagnostics });
  });
}

function evaluatePromptsJoinerNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const delimiter = String(node.data.delimiter ?? ', ');
  const inputs = collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A');
  const orderedInputs = orderPortRecord(inputs, ['A', 'B', 'C']);

  return vectorizeRecord(node.id, orderedInputs, (values) =>
    scalarSignal(
      'text',
      Object.values(values)
        .map((value) => signalToText(value).trim())
        .filter(Boolean)
        .join(delimiter),
      node.id,
    ),
  );
}

function evaluateRegexReplaceNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const pattern = String(node.data.pattern ?? '');
  const replacement = String(node.data.replacement ?? '');
  const input = firstIncomingSignal(node.id, nodes, edges, visited, nodesById);

  if (!pattern) {
    return input;
  }

  return vectorizeRecord(node.id, { input }, (values) => {
    const text = signalToText(values.input);
    try {
      return scalarSignal('text', text.replace(new RegExp(pattern, 'g'), replacement), node.id);
    } catch {
      return scalarSignal('text', text, node.id);
    }
  });
}

function evaluateMathNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(
    collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A'),
    {
      A: scalarSignal('number', coerceNumber(node.data.valueA, 0), node.id),
      B: scalarSignal('number', coerceNumber(node.data.valueB, 0), node.id),
    },
  );
  const operation = String(node.data.operation ?? '+');

  return vectorizeRecord(node.id, { A: inputs.A, B: inputs.B }, (values) => {
    const a = coerceNumber(signalToText(values.A), 0);
    const b = coerceNumber(signalToText(values.B), 0);
    if (operation === '-') return scalarSignal('number', a - b, node.id);
    if (operation === '*') return scalarSignal('number', a * b, node.id);
    if (operation === '/') return scalarSignal('number', b === 0 ? 0 : a / b, node.id);
    if (operation === 'modulo' || operation === '%' || operation === 'MOD') return scalarSignal('number', b === 0 ? 0 : a % b, node.id);
    return scalarSignal('number', a + b, node.id);
  });
}

function evaluateLogicNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A'), {
    A: scalarSignal('boolean', false, node.id),
    B: scalarSignal('boolean', false, node.id),
  });
  const operation = String(node.data.operation ?? 'AND');

  return vectorizeRecord(node.id, { A: inputs.A, B: inputs.B }, (values) => {
    const a = parseBoolean(signalToText(values.A));
    const b = parseBoolean(signalToText(values.B));
    if (operation === 'OR') return scalarSignal('boolean', a || b, node.id);
    if (operation === 'XOR') return scalarSignal('boolean', a !== b, node.id);
    if (operation === 'NOT') return scalarSignal('boolean', !a, node.id);
    return scalarSignal('boolean', a && b, node.id);
  });
}

function evaluateComparisonNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A'), {
    A: scalarSignal('text', '', node.id),
    B: scalarSignal('text', '', node.id),
  });
  const operation = String(node.data.operation ?? 'equals');

  return vectorizeRecord(node.id, { A: inputs.A, B: inputs.B }, (values) => {
    const a = signalToText(values.A);
    const b = signalToText(values.B);
    const numA = Number(a);
    const numB = Number(b);
    const numeric = Number.isFinite(numA) && Number.isFinite(numB);
    let result = false;
    if (operation === 'contains') result = a.toLowerCase().includes(b.toLowerCase());
    else if (operation === 'greaterThan') result = numeric ? numA > numB : a.localeCompare(b) > 0;
    else if (operation === 'lessThan') result = numeric ? numA < numB : a.localeCompare(b) < 0;
    else result = numeric ? numA === numB : a.trim() === b.trim();
    return scalarSignal('boolean', result, node.id);
  });
}

function evaluateConditionalNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'condition'), {
    condition: scalarSignal('boolean', false, node.id),
    valueIfTrue: scalarSignal('text', '', node.id),
    valueIfFalse: scalarSignal('text', '', node.id),
  });

  return vectorizeRecord(node.id, inputs, (values) =>
    parseBoolean(signalToText(values.condition))
      ? scalarSignal(values.valueIfTrue.kind, values.valueIfTrue.value, node.id, { items: values.valueIfTrue.items })
      : scalarSignal(values.valueIfFalse.kind, values.valueIfFalse.value, node.id, { items: values.valueIfFalse.items }),
  );
}

function evaluateSettingsNode(node: AppNode): FlowSignal {
  return scalarSignal('json', {
    aspectRatio: node.data.aspectRatio ?? '1:1',
    steps: coerceNumber(node.data.steps, 30),
    durationSeconds: coerceNumber(node.data.durationSeconds, 6),
    videoResolution: node.data.videoResolution ?? '720p',
    audioOutputFormat: node.data.audioOutputFormat ?? 'mp3_44100_128',
  }, node.id);
}

function evaluateSwitchNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const input = incomingSignalForHandle(node.id, 'input', nodes, edges, visited, nodesById);
  const conditionEdge = edges.find((edge) => edge.target === node.id && edge.targetHandle === 'condition');
  const enabled = conditionEdge
    ? parseBoolean(signalToText(evaluateNodeSignal(conditionEdge.source, nodes, edges, visited, nodesById, conditionEdge.sourceHandle)))
    : node.data.state !== 'off';
  return enabled ? cloneSignalForNode(input, node.id) : emptyLikeSignal(input, node.id);
}

function evaluateForkSwitchNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
  sourceHandle?: string | null,
): FlowSignal {
  const input = incomingSignalForHandle(node.id, 'input', nodes, edges, visited, nodesById);
  const conditionEdge = edges.find((edge) => edge.target === node.id && edge.targetHandle === 'condition');
  const activeOutput = conditionEdge
    ? parseBoolean(signalToText(evaluateNodeSignal(conditionEdge.source, nodes, edges, visited, nodesById, conditionEdge.sourceHandle))) ? 'A' : 'B'
    : node.data.selectedOutput === 'B' ? 'B' : 'A';
  return !sourceHandle || sourceHandle === activeOutput
    ? cloneSignalForNode(input, node.id)
    : emptyLikeSignal(input, node.id);
}

function evaluateSwitchCaseNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
  sourceHandle?: string | null,
): FlowSignal {
  const key = incomingSignalForHandle(node.id, 'key', nodes, edges, visited, nodesById);
  const keyText = signalToText(key).trim();
  const matches: Record<string, string> = {
    case1: String(node.data.case1Val ?? 'A').trim(),
    case2: String(node.data.case2Val ?? 'B').trim(),
    case3: String(node.data.case3Val ?? 'C').trim(),
  };
  const activeHandle = Object.entries(matches).find(([, value]) => value === keyText)?.[0];
  return !sourceHandle || sourceHandle === activeHandle
    ? cloneSignalForNode(key, node.id)
    : emptyLikeSignal(key, node.id);
}

function evaluateLoopGateNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const input = incomingSignalForHandle(node.id, 'input', nodes, edges, visited, nodesById);
  const condition = incomingSignalForHandle(node.id, 'condition', nodes, edges, visited, nodesById);
  return parseBoolean(signalToText(condition))
    ? cloneSignalForNode(input, node.id)
    : emptyLikeSignal(input, node.id);
}

function evaluateNegativePromptNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'text'), {
    text: scalarSignal('text', '', node.id),
    exclude: scalarSignal('text', '', node.id),
  });
  return vectorizeRecord(node.id, inputs, (values) => {
    const prompt = signalToText(values.text).trim();
    const exclusions = signalToText(values.exclude).trim();
    return scalarSignal('text', [prompt, exclusions ? `Avoid: ${exclusions}` : ''].filter(Boolean).join('\n'), node.id);
  });
}

function evaluateSeedSequencerNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const input = firstIncomingSignal(node.id, nodes, edges, visited, nodesById);
  const base = Math.trunc(coerceNumber(node.data.seed, 12345));
  const increment = Math.trunc(coerceNumber(node.data.increment, 1));
  return vectorizeRecord(node.id, { index: input }, (values) =>
    scalarSignal('number', base + Math.trunc(coerceNumber(values.index.value, 0)) * increment, node.id));
}

function evaluatePromptMixerNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A'), {
    A: scalarSignal('text', '', node.id),
    B: scalarSignal('text', '', node.id),
  });
  const weightA = Math.max(0, Math.min(100, Math.round(coerceNumber(node.data.weight, 50))));
  return vectorizeRecord(node.id, inputs, (values) => {
    const a = signalToText(values.A).trim();
    const b = signalToText(values.B).trim();
    if (!a) return scalarSignal('text', b, node.id);
    if (!b) return scalarSignal('text', a, node.id);
    if (weightA === 100) return scalarSignal('text', a, node.id);
    if (weightA === 0) return scalarSignal('text', b, node.id);
    return scalarSignal('text', `[${a} — ${weightA}% emphasis]\n[${b} — ${100 - weightA}% emphasis]`, node.id);
  });
}

function evaluateStoryStateNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const key = String(node.data.key ?? 'state').trim() || 'state';
  const edge = edges.find((candidate) => candidate.target === node.id);
  const override = edge
    ? evaluateNodeSignal(edge.source, nodes, edges, visited, nodesById, edge.sourceHandle)
    : scalarSignal(inferKindFromValue(parseConfiguredValue(node.data.value)), parseConfiguredValue(node.data.value), node.id);
  return vectorizeRecord(node.id, { value: override }, (values) =>
    scalarSignal('json', { [key]: values.value.value }, node.id));
}

function evaluateTextSentimentNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const input = firstIncomingSignal(node.id, nodes, edges, visited, nodesById);
  return vectorizeRecord(node.id, { text: input }, (values) => {
    return scalarSignal('json', analyzeTextSentiment(signalToText(values.text)), node.id);
  });
}

function evaluateImageFeatureExtractorNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const source = firstIncomingSignal(node.id, nodes, edges, visited, nodesById);
  const stored = node.data.imageFeatures;
  const value = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored
    : {
        source: typeof source.value === 'string' ? source.value : '',
        mimeType: source.mimeType ?? inferDataUrlMimeType(source.value),
      };
  return scalarSignal('json', value, node.id, { diagnostics: source.diagnostics });
}

function evaluateFallbackSelectorNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const primary = incomingSignalForHandle(node.id, 'primary', nodes, edges, visited, nodesById);
  const fallback = incomingSignalForHandle(node.id, 'fallback', nodes, edges, visited, nodesById);
  const primaryFailed = collectSignalDiagnostics(primary).some((diagnostic) => diagnostic.blocksRun);
  return !primaryFailed && !isEmptySignalValue(primary)
    ? cloneSignalForNode(primary, node.id)
    : cloneSignalForNode(fallback, node.id);
}

function evaluateDialogueScriptSplitterNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const input = firstIncomingSignal(node.id, nodes, edges, visited, nodesById);
  const prefix = String(node.data.prefix ?? 'MARA:').trim();
  const lines = splitDialogueForPrefix(signalToText(input), prefix)
    .map((dialogue) => scalarSignal('text', dialogue, node.id));
  return listSignal(lines, node.id, 'list', input.diagnostics);
}

function evaluateLoraSpecNode(node: AppNode): FlowSignal {
  const json = buildLoraWeightsJson(node.data.loraEntries);
  try {
    return scalarSignal('json', json ? JSON.parse(json) : [], node.id);
  } catch {
    return scalarSignal('json', [], node.id, {
      diagnostics: [{
        id: `invalid-lora-spec-${node.id}`,
        severity: 'critical',
        nodeId: node.id,
        message: 'LoRA Spec could not serialize its path and scale entries.',
        suggestedFix: 'Remove the invalid entry and add the LoRA path and scale again.',
        blocksRun: true,
      }],
    });
  }
}

function evaluateArrayFlatNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const input = firstIncomingSignal(node.id, nodes, edges, visited, nodesById);
  if (!isListSignal(input)) {
    return input;
  }

  const flattened = input.items.flatMap((item) => isListSignal(item) ? item.items : [item]);
  return listSignal(flattened, node.id, 'list', input.diagnostics);
}

function evaluateValueNode(node: AppNode): FlowSignal {
  const valueKind = isFlowPrimitiveKind(node.data.valueKind) ? node.data.valueKind : 'text';
  const value = node.data.value;

  if (valueKind === 'number') {
    return scalarSignal('number', coerceNumber(value, 0), node.id);
  }

  if (valueKind === 'boolean') {
    return scalarSignal('boolean', parseBoolean(value), node.id);
  }

  if (valueKind === 'json') {
    if (typeof value === 'string') {
      try {
        return scalarSignal('json', JSON.parse(value), node.id);
      } catch {
        return scalarSignal('json', value, node.id, {
          diagnostics: [{
            id: `invalid-json-${node.id}`,
            severity: 'warning',
            nodeId: node.id,
            message: 'JSON value node contains text that is not valid JSON.',
            suggestedFix: 'Enter valid JSON or change the value type to Text.',
            blocksRun: false,
          }],
        });
      }
    }
    return scalarSignal('json', value ?? {}, node.id);
  }

  return scalarSignal('text', String(value ?? ''), node.id);
}

function evaluateLoopBreakNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const conditionEdge = edges.find((edge) => edge.target === node.id && (edge.targetHandle === 'condition' || !edge.targetHandle));
  if (!conditionEdge) {
    return scalarSignal('boolean', parseBoolean(node.data.value), node.id);
  }

  const condition = evaluateNodeSignal(conditionEdge.source, nodes, edges, visited, nodesById, conditionEdge.sourceHandle);
  return vectorizeRecord(node.id, { condition }, (values) =>
    scalarSignal('boolean', parseBoolean(signalToText(values.condition)), node.id, {
      label: typeof node.data.loopBreakReason === 'string' ? node.data.loopBreakReason : undefined,
    }),
  );
}

function evaluateListLikeNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
  kind: Extract<FlowSignalKind, 'list' | 'envelope'>,
): FlowSignal {
  const incomingEdges = node.type === 'list'
    ? getOrderedListInputEdges(node.id, edges)
    : edges.filter((edge) => edge.target === node.id && edge.targetHandle !== LOOP_BREAK_TARGET_HANDLE);

  if (incomingEdges.length === 0 && Array.isArray(node.data.envelopeItems)) {
    return listSignal(node.data.envelopeItems.map((item) => signalFromEnvelopeItem(item)), node.id, kind);
  }

  const items = incomingEdges.flatMap((edge) => {
    const signal = evaluateNodeSignal(edge.source, nodes, edges, visited, nodesById, edge.sourceHandle);
    return isListSignal(signal) ? signal.items : [signal];
  });

  return listSignal(items, node.id, kind);
}

function evaluateLoopNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const incomingEdge = edges.find((edge) => edge.target === node.id);
  if (!incomingEdge) {
    return listSignal([], node.id, 'list');
  }

  const count = Number.isInteger(node.data.count) ? Math.max(1, Number(node.data.count)) : 5;
  const sourceSignal = evaluateNodeSignal(incomingEdge.source, nodes, edges, visited, nodesById, incomingEdge.sourceHandle);
  const sourceItems = isListSignal(sourceSignal) ? sourceSignal.items : [sourceSignal];

  if (sourceItems.length === 0) {
    return listSignal([], node.id, 'list', sourceSignal.diagnostics);
  }

  return listSignal(
    Array.from({ length: count }, (_, index) => sourceItems[sourceItems.length === 1 ? 0 : index % sourceItems.length]),
    node.id,
    'list',
    sourceSignal.diagnostics,
  );
}

function collectIncomingSignalsByHandle(
  nodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
  fallbackHandle: string,
): SignalRecord {
  const record: SignalRecord = {};
  for (const edge of edges.filter((candidate) => candidate.target === nodeId)) {
    const handle = edge.targetHandle || fallbackHandle;
    record[handle] = evaluateNodeSignal(edge.source, nodes, edges, visited, nodesById, edge.sourceHandle);
  }
  return record;
}

function firstIncomingSignal(
  nodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const edge = edges.find((candidate) => candidate.target === nodeId);
  return edge
    ? evaluateNodeSignal(edge.source, nodes, edges, visited, nodesById, edge.sourceHandle)
    : scalarSignal('text', '', nodeId);
}

function vectorizeRecord(
  nodeId: string,
  inputs: SignalRecord,
  render: (values: SignalRecord) => FlowSignal,
): FlowSignal {
  const diagnostics = Object.values(inputs).flatMap((signal) => collectSignalDiagnostics(signal));
  const entries = Object.entries(inputs);
  const listLengths = entries.flatMap(([, signal]) => isListSignal(signal) ? [signal.items.length] : []);

  if (listLengths.length === 0) {
    const rendered = render(inputs);
    return {
      ...rendered,
      diagnostics: [...diagnostics, ...rendered.diagnostics],
    };
  }

  if (listLengths.some((length) => length === 0)) {
    return listSignal([], nodeId, 'list', diagnostics);
  }

  const maxLength = Math.max(...listLengths);
  const invalidLength = listLengths.find((length) => length !== 1 && length !== maxLength);
  if (invalidLength !== undefined) {
    return listSignal([], nodeId, 'list', [
      ...diagnostics,
      {
        id: `list-length-mismatch-${nodeId}`,
        severity: 'critical',
        nodeId,
        message: 'Connected lists must have the same length or a single broadcastable item.',
        suggestedFix: 'Use equal-length lists, a one-item list for broadcast, or flatten/remap the data before this node.',
        blocksRun: true,
      },
    ]);
  }

  const items = Array.from({ length: maxLength }, (_, index) => {
    const values = Object.fromEntries(entries.map(([key, signal]) => [key, pickSignalAt(signal, index)])) as SignalRecord;
    return render(values);
  });

  return listSignal(items, nodeId, 'list', diagnostics);
}

function pickSignalAt(signal: FlowSignal, index: number): FlowSignal {
  if (!isListSignal(signal)) {
    return signal;
  }
  return signal.items[signal.items.length === 1 ? 0 : index] ?? emptySignal('text', signal.sourceNodeId);
}

function withDefaultSignals(inputs: SignalRecord, defaults: SignalRecord): SignalRecord {
  return {
    ...defaults,
    ...inputs,
  };
}

function signalFromListItem(item: FlowListItem): FlowSignal {
  const value = item.kind === 'package'
    ? item.text ?? item.value
    : deserializeResultValueFromContainer(item.value, item.kind);
  if (value === undefined) {
    return emptySignal(item.kind, item.nodeId, [{
      id: `invalid-list-boolean-${item.id}`,
      severity: 'critical',
      nodeId: item.nodeId,
      message: 'This Boolean list item is not a canonical true/false value.',
      suggestedFix: 'Replace the invalid list item with true or false.',
      blocksRun: true,
    }]);
  }
  return scalarSignal(item.kind, value, item.nodeId, {
    label: item.label,
    mimeType: item.mimeType,
  });
}

function signalFromEnvelopeItem(item: EnvelopeItem): FlowSignal {
  const value = item.kind === 'package'
    ? item.text ?? item.value
    : deserializeResultValueFromContainer(item.value, item.kind);
  if (value === undefined) {
    return emptySignal(item.kind, item.sourceNodeId, [{
      id: `invalid-envelope-boolean-${item.id}`,
      severity: 'critical',
      nodeId: item.sourceNodeId,
      message: 'This Boolean envelope item is not a canonical true/false value.',
      suggestedFix: 'Replace the invalid envelope item with true or false.',
      blocksRun: true,
    }]);
  }
  return scalarSignal(item.kind, value, item.sourceNodeId, {
    label: item.label,
    mimeType: item.mimeType,
  });
}

function mediaSignal(node: AppNode, kind: Extract<ResultType, 'image' | 'video' | 'audio'>): FlowSignal {
  const value = node.data.mediaMode === 'import' ? node.data.sourceAssetUrl ?? node.data.result : node.data.result ?? node.data.sourceAssetUrl;
  return scalarSignal(kind, resultValueAsMediaUrl(value) ?? '', node.id, {
    label: node.data.sourceAssetName ?? node.data.customTitle ?? node.id,
    mimeType: node.data.sourceAssetMimeType ?? node.data.resultMimeType,
  });
}

function resolveListLikeLength(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): number {
  const input = firstIncomingSignal(node.id, nodes, edges, visited, nodesById);
  return isListSignal(input) ? input.items.length : signalToText(input).trim() ? 1 : 0;
}

function listSignal(
  items: FlowSignal[],
  nodeId: string | undefined,
  kind: Extract<FlowSignalKind, 'list' | 'envelope'> = 'list',
  diagnostics: FlowDiagnostic[] = [],
): FlowSignal {
  return {
    kind,
    value: items.map((item) => item.value),
    items,
    sourceNodeId: nodeId,
    diagnostics,
  };
}

function incomingSignalForHandle(
  nodeId: string,
  targetHandle: string,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const edge = edges.find((candidate) => candidate.target === nodeId && candidate.targetHandle === targetHandle);
  return edge
    ? evaluateNodeSignal(edge.source, nodes, edges, visited, nodesById, edge.sourceHandle)
    : scalarSignal('text', '', nodeId);
}

function cloneSignalForNode(signal: FlowSignal, nodeId: string): FlowSignal {
  return {
    ...signal,
    sourceNodeId: nodeId,
    items: signal.items?.map((item) => ({ ...item })),
    diagnostics: [...signal.diagnostics],
  };
}

function emptyLikeSignal(signal: FlowSignal, nodeId: string): FlowSignal {
  if (signal.kind === 'list' || signal.kind === 'envelope') {
    return listSignal([], nodeId, signal.kind, signal.diagnostics);
  }
  return scalarSignal(signal.kind, '', nodeId, { diagnostics: signal.diagnostics, mimeType: signal.mimeType });
}

function isEmptySignalValue(signal: FlowSignal): boolean {
  if (isListSignal(signal)) return signal.items.length === 0;
  if (signal.value === null || signal.value === undefined) return true;
  if (typeof signal.value === 'string') return signal.value.trim().length === 0;
  return false;
}

function parseConfiguredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? '';
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed && Number.isFinite(Number(trimmed))) return Number(trimmed);
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function inferDataUrlMimeType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.match(/^data:([^;,]+)/)?.[1];
}

function normalizeHexColor(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed.slice(1).split('').map((part) => part.repeat(2)).join('')}`.toUpperCase();
  }
  return trimmed;
}

function scalarSignal(
  kind: FlowSignalKind,
  value: unknown,
  nodeId?: string,
  options: {
    label?: string;
    mimeType?: string;
    diagnostics?: FlowDiagnostic[];
    items?: FlowSignal[];
  } = {},
): FlowSignal {
  return {
    kind,
    value,
    label: options.label,
    sourceNodeId: nodeId,
    mimeType: options.mimeType,
    items: options.items,
    diagnostics: options.diagnostics ?? [],
  };
}

/** Function results cross the execution boundary as strings for persistence, so restore
 * declared scalar/container values before routing a named output to another node. */
function deserializeFunctionOutputValue(output: FunctionNodeOutput): unknown {
  if (output.resultType === 'number') {
    const value = Number(output.result);
    return Number.isFinite(value) ? value : 0;
  }
  if (output.resultType === 'boolean') {
    return typeof output.result === 'boolean' ? output.result : output.result === 'true';
  }
  if (output.resultType === 'json' || output.resultType === 'list' || output.resultType === 'envelope' || output.resultType === 'package') {
    if (typeof output.result !== 'string') return output.result;
    try {
      return JSON.parse(output.result) as unknown;
    } catch {
      return output.result;
    }
  }
  return output.result;
}

function emptySignal(kind: FlowSignalKind, nodeId?: string, diagnostics: FlowDiagnostic[] = []): FlowSignal {
  return scalarSignal(kind, '', nodeId, { diagnostics });
}

function isListSignal(signal: FlowSignal): signal is FlowSignal & { items: FlowSignal[] } {
  return Array.isArray(signal.items);
}

export function isTextualSignal(signal: FlowSignal): boolean {
  if (isListSignal(signal)) {
    return signal.items.every(isTextualSignal);
  }
  return TEXTUAL_KINDS.has(signal.kind);
}

function orderPortRecord(inputs: SignalRecord, preferredOrder: string[]): SignalRecord {
  const ordered: SignalRecord = {};
  for (const key of preferredOrder) {
    if (inputs[key]) {
      ordered[key] = inputs[key];
    }
  }
  for (const [key, value] of Object.entries(inputs)) {
    if (!ordered[key]) {
      ordered[key] = value;
    }
  }
  return ordered;
}

function replaceTemplateToken(template: string, key: string, value: string): string {
  const escaped = escapeRegExp(key);
  return template.replace(
    new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}|\\{\\s*${escaped}\\s*\\}`, 'gi'),
    value,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function inferKindFromValue(value: unknown): ResultType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  if (value && typeof value === 'object') return 'json';
  if (typeof value === 'string') {
    if (value.startsWith('data:image/') || value.startsWith('blob:')) return 'image';
    if (value.startsWith('data:video/')) return 'video';
    if (value.startsWith('data:audio/')) return 'audio';
  }
  return 'text';
}

function isResultType(value: unknown): value is ResultType {
  return ['text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope'].includes(value as string);
}

function signalWithDeclaredOutput(
  node: AppNode,
  value: unknown,
  actualKind: ResultType = inferKindFromValue(value),
): FlowSignal {
  const declaredKind = node.data.declaredOutputType;
  if (!isResultType(declaredKind) || declaredKind === actualKind) {
    return scalarSignal(actualKind, value, node.id);
  }

  return scalarSignal(actualKind, value, node.id, {
    diagnostics: [{
      id: `declared-output-mismatch-${node.id}`,
      severity: 'critical',
      nodeId: node.id,
      message: `${node.data.customTitle ?? node.type} declared a ${declaredKind} output but returned ${actualKind}.`,
      suggestedFix: `Change the node logic to return ${declaredKind}, or update Output type to ${actualKind}. Flow does not coerce flexible-node results implicitly.`,
      blocksRun: true,
    }],
  });
}

function evaluateJavaScriptNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(
    collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A'),
    {
      A: scalarSignal('text', '', node.id),
      B: scalarSignal('text', '', node.id),
      C: scalarSignal('text', '', node.id),
    }
  );
  const code = String(node.data.code ?? '// Return some value using A, B, C\nreturn A + " " + B;');

  return vectorizeRecord(node.id, inputs, (values) => {
    const A = values['A']?.value;
    const B = values['B']?.value;
    const C = values['C']?.value;

    try {
      const fn = new Function('A', 'B', 'C', code);
      const outputVal = fn(A, B, C);
      return signalWithDeclaredOutput(node, outputVal !== undefined ? outputVal : '');
    } catch (err) {
      return emptySignal('text', node.id, [
        {
          id: `js-error-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          message: `JavaScript execution error: ${(err as Error).message}`,
          blocksRun: false,
        },
      ]);
    }
  });
}

function evaluateJsonQueryNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'json');
  const defaultJsonSignal = scalarSignal('json', '{}', node.id);
  const defaultQuerySignal = scalarSignal('text', String(node.data.query ?? ''), node.id);

  const finalInputs = withDefaultSignals(inputs, {
    json: defaultJsonSignal,
    query: defaultQuerySignal,
  });

  return vectorizeRecord(node.id, finalInputs, (values) => {
    let jsonVal = values['json']?.value;
    const queryStr = String(values['query']?.value ?? node.data.query ?? '').trim();

    if (typeof jsonVal === 'string') {
      try {
        jsonVal = JSON.parse(jsonVal);
      } catch {
        // Keep original string if parsing fails
      }
    }

    if (!queryStr) {
      return signalWithDeclaredOutput(node, jsonVal);
    }

    try {
      let cleanedQuery = queryStr;
      if (cleanedQuery.startsWith('$.')) {
        cleanedQuery = cleanedQuery.substring(2);
      }

      let expr = cleanedQuery;
      if (!expr.startsWith('json') && !expr.startsWith('Object.') && !expr.startsWith('Array.')) {
        expr = `json.${expr}`;
      }

      const evaluator = new Function('json', `try { return ${expr}; } catch (e) { return undefined; }`);
      const outputVal = evaluator(jsonVal);
      return signalWithDeclaredOutput(node, outputVal !== undefined ? outputVal : '');
    } catch (err) {
      return emptySignal('text', node.id, [
        {
          id: `json-query-error-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          message: `JSON Query execution error: ${(err as Error).message}`,
          blocksRun: false,
        },
      ]);
    }
  });
}

function evaluateRegexParseNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'text');
  const defaultTextSignal = scalarSignal('text', '', node.id);
  const defaultRegexSignal = scalarSignal('text', String(node.data.regex ?? ''), node.id);

  const finalInputs = withDefaultSignals(inputs, {
    text: defaultTextSignal,
    regex: defaultRegexSignal,
  });

  return vectorizeRecord(node.id, finalInputs, (values) => {
    const textVal = signalToText(values['text']);
    const regexStr = String(values['regex']?.value ?? node.data.regex ?? '').trim();

    if (!regexStr) {
      return scalarSignal('text', textVal, node.id);
    }

    try {
      let pattern = regexStr;
      let flags = '';
      if (regexStr.startsWith('/') && regexStr.lastIndexOf('/') > 0) {
        const lastSlashIndex = regexStr.lastIndexOf('/');
        pattern = regexStr.slice(1, lastSlashIndex);
        flags = regexStr.slice(lastSlashIndex + 1);
      }

      const re = new RegExp(pattern, flags);

      if (flags.includes('g')) {
        const matches = [...textVal.matchAll(re)];
        const results = matches.map((match) => {
          if (match.length > 1) {
            return match.length === 2 ? match[1] : match.slice(1);
          }
          return match[0];
        });

        return listSignal(
          results.map((r) => scalarSignal(inferKindFromValue(r), r, node.id)),
          node.id,
          'list'
        );
      } else {
        const match = textVal.match(re);
        if (!match) {
          return scalarSignal('text', '', node.id);
        }

        if (match.length > 1) {
          if (match.length === 2) {
            return scalarSignal(inferKindFromValue(match[1]), match[1], node.id);
          }
          const results = match.slice(1);
          return scalarSignal('json', results, node.id);
        }

        return scalarSignal('text', match[0], node.id);
      }
    } catch (err) {
      return emptySignal('text', node.id, [
        {
          id: `regex-parse-error-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          message: `Regex Parse error: ${(err as Error).message}`,
          blocksRun: false,
        },
      ]);
    }
  });
}

function evaluatePythonNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(
    collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A'),
    {
      A: scalarSignal('text', '', node.id),
      B: scalarSignal('text', '', node.id),
      C: scalarSignal('text', '', node.id),
    }
  );
  const code = String(node.data.code ?? '# Return some value using A, B, C\nreturn A + " " + B;');

  return vectorizeRecord(node.id, inputs, (values) => {
    const A = values['A']?.value;
    const B = values['B']?.value;
    const C = values['C']?.value;

    try {
      const transpiledJs = transpilePythonToJs(code);
      const fn = new Function('A', 'B', 'C', transpiledJs);
      const outputVal = fn(A, B, C);
      return signalWithDeclaredOutput(node, outputVal !== undefined ? outputVal : '');
    } catch (err) {
      return emptySignal('text', node.id, [
        {
          id: `python-error-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          message: `Python execution error: ${(err as Error).message}`,
          blocksRun: false,
        },
      ]);
    }
  });
}

function transpilePythonToJs(py: string): string {
  const lines = py.split('\n');
  const jsLines = lines.map((line) => {
    // 1. Comments
    const commentIndex = line.indexOf('#');
    let codePart = line;
    let commentPart = '';
    if (commentIndex !== -1) {
      codePart = line.substring(0, commentIndex);
      commentPart = '//' + line.substring(commentIndex + 1);
    }

    // 2. Control flow structures
    const trimmed = codePart.trim();
    if (trimmed.endsWith(':')) {
      const base = trimmed.substring(0, trimmed.length - 1).trim();
      if (base === 'else') {
        codePart = codePart.replace('else:', 'else {');
      } else if (base.startsWith('if ')) {
        codePart = codePart.replace(/if\s+(.*):/, 'if ($1) {');
      } else if (base.startsWith('elif ')) {
        codePart = codePart.replace(/elif\s+(.*):/, 'else if ($1) {');
      } else if (base.startsWith('while ')) {
        codePart = codePart.replace(/while\s+(.*):/, 'while ($1) {');
      } else if (base.startsWith('def ')) {
        codePart = codePart.replace(/def\s+(.*):/, 'function $1 {');
      }
    }

    // 3. Builtin keywords
    const convertedCode = codePart
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null')
      .replace(/\band\b/g, '&&')
      .replace(/\bor\b/g, '||')
      .replace(/\bnot\b/g, '!');

    return convertedCode + commentPart;
  });

  // 4. Handle Python indentation block closing
  const indentStack: number[] = [];
  const finalLines: string[] = [];
  jsLines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      finalLines.push(line);
      return;
    }
    const indent = line.length - line.trimStart().length;
    while (indentStack.length > 0 && indent < indentStack[indentStack.length - 1]) {
      indentStack.pop();
      finalLines.push(' '.repeat(indent) + '}');
    }
    if (line.includes('{')) {
      indentStack.push(indent);
    }
    finalLines.push(line);
  });
  while (indentStack.length > 0) {
    indentStack.pop();
    finalLines.push('}');
  }

  return finalLines.join('\n');
}

function evaluateJsonBuilderNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A');
  const finalInputs = withDefaultSignals(inputs, {
    A: scalarSignal('text', '', node.id),
    B: scalarSignal('text', '', node.id),
    C: scalarSignal('text', '', node.id),
    D: scalarSignal('text', '', node.id),
    E: scalarSignal('text', '', node.id),
  });

  return vectorizeRecord(node.id, finalInputs, (values) => {
    const template = String(node.data.template ?? '{\n  "A": "{{A}}"\n}');
    let rendered = template;
    ['A', 'B', 'C', 'D', 'E'].forEach((key) => {
      const val = values[key]?.value ?? '';
      const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
      // Escape for JSON string slots
      rendered = rendered.replace(new RegExp(`"\\{\\{${key}\\}\\}"`, 'g'), JSON.stringify(val));
      rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), strVal);
    });

    let parsed: unknown = {};
    try {
      parsed = JSON.parse(rendered);
      return scalarSignal('json', parsed, node.id);
    } catch {
      return scalarSignal('text', rendered, node.id);
    }
  });
}

function evaluateHtmlSandboxNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'html');
  const finalInputs = withDefaultSignals(inputs, {
    html: scalarSignal('text', String(node.data.html ?? '<h1>Hello World</h1>'), node.id),
    css: scalarSignal('text', String(node.data.css ?? ''), node.id),
    js: scalarSignal('text', String(node.data.js ?? ''), node.id),
  });

  return vectorizeRecord(node.id, finalInputs, (values) => {
    const html = signalToText(values['html'] ?? scalarSignal('text', String(node.data.html ?? ''), node.id));
    const css = signalToText(values['css'] ?? scalarSignal('text', String(node.data.css ?? ''), node.id));
    const js = signalToText(values['js'] ?? scalarSignal('text', String(node.data.js ?? ''), node.id));

    const combinedDoc = `<!DOCTYPE html>
<html>
<head>
  <style>${css}</style>
</head>
<body>
  ${html}
  <script>${js}</script>
</body>
</html>`;

    return scalarSignal('text', combinedDoc, node.id);
  });
}

function evaluateApiFetchNode(
  node: AppNode,
  _nodes?: AppNode[],
  _edges?: Edge[],
  _visited?: Set<string>,
  _nodesById?: Map<string, AppNode>,
): FlowSignal {
  const val = node.data.result !== undefined ? node.data.result : '';
  const resultType = isResultType(node.data.resultType) ? node.data.resultType : inferKindFromValue(val);
  const value = restoreResultValue(val, resultType);
  return value === undefined && resultType === 'boolean'
    ? invalidBooleanSignal(node.id, node.data.customTitle ?? 'API Fetch')
    : signalWithDeclaredOutput(node, value ?? '', resultType);
}

function invalidBooleanSignal(nodeId: string, label: string): FlowSignal {
  return emptySignal('boolean', nodeId, [{
    id: `invalid-boolean-result-${nodeId}`,
    severity: 'critical',
    nodeId,
    message: `${label} has no canonical Boolean result. Run it again or reopen the migrated project.`,
    suggestedFix: 'Use only the exact persisted true or false Boolean encoding, or run the node again.',
    blocksRun: true,
  }]);
}

function evaluateSqlQueryNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(
    collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A'),
    {
      A: scalarSignal('json', '[]', node.id),
      B: scalarSignal('json', '[]', node.id),
      query: scalarSignal('text', String(node.data.query ?? 'SELECT * FROM A'), node.id),
    }
  );

  return vectorizeRecord(node.id, inputs, (values) => {
    const A = values['A']?.value;
    const B = values['B']?.value;
    const query = String(values['query']?.value ?? node.data.query ?? '').trim();

    const parseList = (val: unknown): unknown[] => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) return parsed;
          return [parsed];
        } catch {
          return [val];
        }
      }
      return val !== undefined && val !== null ? [val] : [];
    };

    const listA = parseList(A);
    const listB = parseList(B);

    if (!query) {
      return listSignal(listA.map((item) => scalarSignal(inferKindFromValue(item), item, node.id)), node.id, 'list');
    }

    try {
      const normalizedQuery = query.replace(/\s+/g, ' ');
      const selectMatch = normalizedQuery.match(/^SELECT\s+(.+?)\s+FROM\s+(A|B)(?:\s+JOIN\s+(A|B)\s+ON\s+(.+?))?(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i);

      if (!selectMatch) {
        throw new Error('Unsupported SQL syntax. Supported: SELECT <fields> FROM <A|B> [JOIN <A|B> ON <cond>] [WHERE <cond>] [ORDER BY <field> [ASC|DESC]] [LIMIT <n>]');
      }

      const [, selectFieldsRaw, fromTableRaw, joinTableRaw, joinOnRaw, whereRaw, orderByRaw, limitRaw] = selectMatch;

      const fromTable = fromTableRaw.toUpperCase();
      const joinTable = joinTableRaw?.toUpperCase();
      const selectFields = selectFieldsRaw.split(',').map((f) => f.trim());

      let combined: { A?: unknown; B?: unknown; [key: string]: unknown }[] = [];

      if (joinTable && joinOnRaw) {
        const joinOnParts = joinOnRaw.match(/([AB]\.[A-Za-z0-9_]+)\s*=\s*([AB]\.[A-Za-z0-9_]+)/i);
        if (!joinOnParts) {
          throw new Error('Unsupported JOIN ON syntax. Supported: A.key = B.otherKey');
        }
        const [, key1, key2] = joinOnParts;
        const [table1, prop1] = key1.split('.');
        const [_table2, prop2] = key2.split('.');

        const getVal = (item: unknown, _table: string, prop: string) => {
          if (typeof item === 'object' && item !== null) {
            return (item as Record<string, unknown>)[prop];
          }
          return undefined;
        };

        const leftList = fromTable === 'A' ? listA : listB;
        const rightList = joinTable === 'A' ? listA : listB;

        leftList.forEach((leftItem) => {
          const val1 = getVal(leftItem, fromTable, fromTable === table1 ? prop1 : prop2);
          rightList.forEach((rightItem) => {
            const val2 = getVal(rightItem, joinTable, joinTable === table1 ? prop1 : prop2);
            if (val1 !== undefined && val2 !== undefined && String(val1) === String(val2)) {
              combined.push({
                A: fromTable === 'A' ? leftItem : rightItem,
                B: fromTable === 'B' ? leftItem : rightItem,
              });
            }
          });
        });
      } else {
        const baseList = fromTable === 'A' ? listA : listB;
        combined = baseList.map((item) => ({
          [fromTable]: item,
          ...(typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}),
          A: fromTable === 'A' ? item : undefined,
          B: fromTable === 'B' ? item : undefined,
        }));
      }

      let filtered = combined;
      if (whereRaw) {
        let jsCondition = whereRaw
          .replace(/(<=|>=|!=|==|=)/g, (match) => (match === '=' ? '===' : match))
          .replace(/\band\b/gi, '&&')
          .replace(/\bor\b/gi, '||')
          .replace(/\bnot\b/gi, '!');

        jsCondition = jsCondition.replace(/\b([AB])\.([A-Za-z0-9_]+)\b/g, '$1?.$2');

        const filterFn = new Function('A', 'B', 'row', `try { return ${jsCondition}; } catch(e) { return false; }`);
        filtered = combined.filter((row) => {
          return filterFn(row.A, row.B, row);
        });
      }

      let projected = filtered.map((row) => {
        if (selectFields.length === 1 && selectFields[0] === '*') {
          if (!joinTable) {
            return row[fromTable];
          }
          return { A: row.A, B: row.B };
        }

        const projectedItem: Record<string, unknown> = {};
        selectFields.forEach((field) => {
          const fieldParts = field.match(/^([AB])\.([A-Za-z0-9_]+)$/i);
          if (fieldParts) {
            const [, table, prop] = fieldParts;
            const tableObj = table === 'A' ? row.A : row.B;
            if (typeof tableObj === 'object' && tableObj !== null) {
              projectedItem[prop] = (tableObj as Record<string, unknown>)[prop];
            } else {
              projectedItem[prop] = undefined;
            }
          } else {
            const baseObj = row[fromTable];
            if (typeof baseObj === 'object' && baseObj !== null) {
              projectedItem[field] = (baseObj as Record<string, unknown>)[field];
            } else {
              projectedItem[field] = undefined;
            }
          }
        });
        return projectedItem;
      });

      if (orderByRaw) {
        const orderParts = orderByRaw.trim().split(' ');
        const orderFieldRaw = orderParts[0];
        const direction = orderParts[1]?.toUpperCase() === 'DESC' ? -1 : 1;
        const orderField = orderFieldRaw.includes('.') ? orderFieldRaw.split('.')[1] : orderFieldRaw;

        projected.sort((a, b) => {
          const valA = (typeof a === 'object' && a !== null) ? (a as Record<string, unknown>)[orderField] : a;
          const valB = (typeof b === 'object' && b !== null) ? (b as Record<string, unknown>)[orderField] : b;

          if (valA === undefined || valA === null) return 1 * direction;
          if (valB === undefined || valB === null) return -1 * direction;

          if (typeof valA === 'number' && typeof valB === 'number') {
            return (valA - valB) * direction;
          }
          return String(valA).localeCompare(String(valB)) * direction;
        });
      }

      if (limitRaw) {
        const limitVal = parseInt(limitRaw, 10);
        if (!isNaN(limitVal)) {
          projected = projected.slice(0, limitVal);
        }
      }

      return listSignal(
        projected.map((item) => scalarSignal(inferKindFromValue(item), item, node.id)),
        node.id,
        'list'
      );
    } catch (err) {
      return emptySignal('text', node.id, [
        {
          id: `sql-query-error-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          message: `SQL Query error: ${(err as Error).message}`,
          blocksRun: false,
        },
      ]);
    }
  });
}

function evaluateCsvParserNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(
    collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'csv'),
    {
      csv: scalarSignal('text', '', node.id),
      mode: scalarSignal('text', String(node.data.mode ?? 'parse'), node.id),
      delimiter: scalarSignal('text', String(node.data.delimiter ?? ','), node.id),
    }
  );

  return vectorizeRecord(node.id, inputs, (values) => {
    const csvStr = signalToText(values['csv']).trim();
    const mode = String(values['mode']?.value ?? node.data.mode ?? 'parse').toLowerCase();
    const delimiter = String(values['delimiter']?.value ?? node.data.delimiter ?? ',');

    if (mode === 'format') {
      const rawVal = values['csv']?.value;
      let arrayToFormat: unknown[] = [];
      if (Array.isArray(rawVal)) {
        arrayToFormat = rawVal;
      } else if (typeof rawVal === 'string' && rawVal.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(rawVal);
          if (Array.isArray(parsed)) arrayToFormat = parsed;
        } catch {
          arrayToFormat = [rawVal];
        }
      } else if (rawVal !== undefined && rawVal !== null) {
        arrayToFormat = [rawVal];
      }

      if (arrayToFormat.length === 0) {
        return scalarSignal('text', '', node.id);
      }

      const headers = new Set<string>();
      arrayToFormat.forEach((item) => {
        if (typeof item === 'object' && item !== null) {
          Object.keys(item).forEach((k) => headers.add(k));
        }
      });

      const headerList = Array.from(headers);
      const escapeCsvVal = (val: unknown): string => {
        if (val === undefined || val === null) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const lines: string[] = [];
      if (headerList.length > 0) {
        lines.push(headerList.map(escapeCsvVal).join(delimiter));
        arrayToFormat.forEach((item) => {
          if (typeof item === 'object' && item !== null) {
            const row = item as Record<string, unknown>;
            lines.push(headerList.map((h) => escapeCsvVal(row[h])).join(delimiter));
          } else {
            lines.push(escapeCsvVal(item));
          }
        });
      } else {
        arrayToFormat.forEach((item) => {
          lines.push(escapeCsvVal(item));
        });
      }

      return scalarSignal('text', lines.join('\n'), node.id);
    } else {
      if (!csvStr) {
        return listSignal([], node.id, 'list');
      }

      const parseCsvRow = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
              current += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === delimiter && !inQuotes) {
            result.push(current);
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current);
        return result;
      };

      const lines = csvStr.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) {
        return listSignal([], node.id, 'list');
      }

      const headers = parseCsvRow(lines[0]).map((h) => h.trim());
      const records: Record<string, unknown>[] = [];

      for (let i = 1; i < lines.length; i++) {
        const rowVals = parseCsvRow(lines[i]);
        const record: Record<string, unknown> = {};
        headers.forEach((header, index) => {
          const rawVal = rowVals[index]?.trim() ?? '';
          if (rawVal !== '' && !isNaN(Number(rawVal))) {
            record[header] = Number(rawVal);
          } else if (rawVal.toLowerCase() === 'true') {
            record[header] = true;
          } else if (rawVal.toLowerCase() === 'false') {
            record[header] = false;
          } else {
            record[header] = rawVal;
          }
        });
        records.push(record);
      }

      return listSignal(
        records.map((item) => scalarSignal('json', item, node.id)),
        node.id,
        'list'
      );
    }
  });
}

function evaluateMathExpressionNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(
    collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'A'),
    {
      A: scalarSignal('number', 0, node.id),
      B: scalarSignal('number', 0, node.id),
      C: scalarSignal('number', 0, node.id),
      expression: scalarSignal('text', String(node.data.expression ?? 'A + B * C'), node.id),
    }
  );

  return vectorizeRecord(node.id, inputs, (values) => {
    const A = Number(values['A']?.value ?? 0);
    const B = Number(values['B']?.value ?? 0);
    const C = Number(values['C']?.value ?? 0);
    const expression = String(values['expression']?.value ?? node.data.expression ?? '').trim();

    if (!expression) {
      return scalarSignal('number', 0, node.id);
    }

    try {
      const cleanedExpr = expression
        .replace(/\bsin\b/g, 'Math.sin')
        .replace(/\bcos\b/g, 'Math.cos')
        .replace(/\btan\b/g, 'Math.tan')
        .replace(/\blog\b/g, 'Math.log')
        .replace(/\bsqrt\b/g, 'Math.sqrt')
        .replace(/\babs\b/g, 'Math.abs')
        .replace(/\bpow\b/g, 'Math.pow')
        .replace(/\bPI\b/g, 'Math.PI')
        .replace(/\bE\b/g, 'Math.E')
        .replace(/\bround\b/g, 'Math.round')
        .replace(/\bfloor\b/g, 'Math.floor')
        .replace(/\bceil\b/g, 'Math.ceil');

      const evaluator = new Function('A', 'B', 'C', `try { return Number(${cleanedExpr}); } catch(e) { return 0; }`);
      const result = evaluator(A, B, C);
      return scalarSignal('number', isNaN(result) ? 0 : result, node.id);
    } catch (err) {
      return emptySignal('number', node.id, [
        {
          id: `math-expr-error-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          message: `Math Expression error: ${(err as Error).message}`,
          blocksRun: false,
        },
      ]);
    }
  });
}

function evaluateXmlYamlNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string>,
  nodesById: Map<string, AppNode>,
): FlowSignal {
  const inputs = withDefaultSignals(
    collectIncomingSignalsByHandle(node.id, nodes, edges, visited, nodesById, 'text'),
    {
      text: scalarSignal('text', '', node.id),
      mode: scalarSignal('text', String(node.data.mode ?? 'xml-to-json'), node.id),
    }
  );

  return vectorizeRecord(node.id, inputs, (values) => {
    const rawVal = values['text']?.value;
    const textVal = signalToText(values['text']).trim();
    const mode = String(values['mode']?.value ?? node.data.mode ?? 'xml-to-json').toLowerCase();

    const jsonToXml = (obj: unknown, rootName?: string): string => {
      if (obj === undefined || obj === null) return '';
      if (typeof obj !== 'object') {
        const tag = rootName || 'root';
        return `<${tag}>${String(obj)}</${tag}>`;
      }

      if (Array.isArray(obj)) {
        const itemsXml = obj.map((item) => jsonToXml(item, 'item')).join('');
        if (!rootName) {
          return `<root>${itemsXml}</root>`;
        }
        return itemsXml;
      }

      const rec = obj as Record<string, unknown>;
      const keys = Object.keys(rec);

      if (!rootName) {
        if (keys.length === 1) {
          const key = keys[0];
          return `<${key}>${jsonToXml(rec[key], key)}</${key}>`;
        } else {
          let children = '';
          keys.forEach((key) => {
            children += jsonToXml(rec[key], key);
          });
          return `<root>${children}</root>`;
        }
      }

      let children = '';
      keys.forEach((key) => {
        const val = rec[key];
        if (Array.isArray(val)) {
          children += val.map((item) => jsonToXml(item, key)).join('');
        } else if (typeof val === 'object' && val !== null) {
          children += `<${key}>${jsonToXml(val, key)}</${key}>`;
        } else {
          children += `<${key}>${val !== undefined && val !== null ? String(val) : ''}</${key}>`;
        }
      });
      return children;
    };

    const xmlToJson = (xml: string): Record<string, unknown> | string => {
      const tagRegex = /<([A-Za-z0-9_:-]+)>([\s\S]*?)<\/\1>/g;
      const result: Record<string, unknown> = {};
      let match;
      let hasTags = false;

      while ((match = tagRegex.exec(xml)) !== null) {
        hasTags = true;
        const [, tagName, content] = match;
        const parsedContent = xmlToJson(content.trim());

        if (result[tagName] !== undefined) {
          if (Array.isArray(result[tagName])) {
            (result[tagName] as unknown[]).push(parsedContent);
          } else {
            result[tagName] = [result[tagName], parsedContent];
          }
        } else {
          result[tagName] = parsedContent;
        }
      }

      if (!hasTags) {
        const trimmed = xml.trim();
        if (trimmed !== '' && !isNaN(Number(trimmed))) {
          return Number(trimmed) as unknown as Record<string, unknown>;
        }
        if (trimmed.toLowerCase() === 'true') return true as unknown as Record<string, unknown>;
        if (trimmed.toLowerCase() === 'false') return false as unknown as Record<string, unknown>;
        return trimmed as unknown as Record<string, unknown>;
      }

      return result;
    };

    const jsonToYaml = (obj: unknown, indent = 0): string => {
      const spaces = ' '.repeat(indent);
      if (obj === undefined || obj === null) return 'null';
      if (typeof obj !== 'object') {
        const str = String(obj);
        if (str.includes('\n') || str.includes(':') || str.includes('#')) {
          return `"${str.replace(/"/g, '\\"')}"`;
        }
        return str;
      }

      if (Array.isArray(obj)) {
        if (obj.length === 0) return '[]';
        return '\n' + obj.map((item) => `${spaces}- ${jsonToYaml(item, indent + 2).trim()}`).join('\n');
      }

      const rec = obj as Record<string, unknown>;
      const keys = Object.keys(rec);
      if (keys.length === 0) return '{}';

      const lines = keys.map((key) => {
        const val = rec[key];
        const valStr = jsonToYaml(val, indent + 2);
        if (typeof val === 'object' && val !== null) {
          return `${spaces}${key}:${valStr}`;
        }
        return `${spaces}${key}: ${valStr}`;
      });
      return '\n' + lines.join('\n');
    };

    const yamlToJson = (yaml: string): Record<string, unknown> | unknown[] => {
      const lines = yaml.split(/\r?\n/).filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'));
      const root: Record<string, unknown> = {};
      let currentKey = '';
      const stack: { indent: number; obj: Record<string, unknown> | unknown[] }[] = [{ indent: -1, obj: root }];

      lines.forEach((line) => {
        const indent = line.search(/\S/);
        const trimmed = line.trim();

        if (trimmed.startsWith('- ')) {
          const valStr = trimmed.substring(2).trim();
          let parsedVal: unknown = valStr;
          if (valStr !== '' && !isNaN(Number(valStr))) {
            parsedVal = Number(valStr);
          } else if (valStr.toLowerCase() === 'true') {
            parsedVal = true;
          } else if (valStr.toLowerCase() === 'false') {
            parsedVal = false;
          }

          while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
          }

          const parent = stack[stack.length - 1].obj;
          if (Array.isArray(parent)) {
            parent.push(parsedVal);
          } else if (currentKey) {
            if (!Array.isArray(parent[currentKey])) {
              parent[currentKey] = [];
            }
            (parent[currentKey] as unknown[]).push(parsedVal);
          }
          return;
        }

        const colonIndex = trimmed.indexOf(':');
        if (colonIndex !== -1) {
          const key = trimmed.substring(0, colonIndex).trim();
          const valStr = trimmed.substring(colonIndex + 1).trim();

          let parsedVal: unknown = valStr;
          let isContainer = false;

          if (valStr === '') {
            isContainer = true;
            parsedVal = {};
          } else if (!isNaN(Number(valStr))) {
            parsedVal = Number(valStr);
          } else if (valStr.toLowerCase() === 'true') {
            parsedVal = true;
          } else if (valStr.toLowerCase() === 'false') {
            parsedVal = false;
          } else if (valStr.startsWith('"') && valStr.endsWith('"')) {
            parsedVal = valStr.slice(1, -1);
          }

          while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
          }

          const parent = stack[stack.length - 1].obj;
          if (!Array.isArray(parent)) {
            parent[key] = parsedVal;
          }
          currentKey = key;

          if (isContainer) {
            stack.push({ indent, obj: parsedVal as Record<string, unknown> });
          }
        }
      });

      return root;
    };

    try {
      if (mode === 'xml-to-json') {
        const parsed = xmlToJson(textVal);
        return scalarSignal('json', parsed, node.id);
      } else if (mode === 'json-to-xml') {
        const xml = jsonToXml(rawVal);
        return scalarSignal('text', xml, node.id);
      } else if (mode === 'yaml-to-json') {
        const parsed = yamlToJson(textVal);
        return scalarSignal('json', parsed, node.id);
      } else if (mode === 'json-to-yaml') {
        const yaml = jsonToYaml(rawVal);
        return scalarSignal('text', yaml.trim(), node.id);
      } else {
        throw new Error(`Unsupported mode: ${mode}`);
      }
    } catch (err) {
      return emptySignal('text', node.id, [
        {
          id: `xml-yaml-error-${node.id}`,
          severity: 'warning',
          nodeId: node.id,
          message: `XML/YAML Interop error: ${(err as Error).message}`,
          blocksRun: false,
        },
      ]);
    }
  });
}
