import type { Edge } from '@xyflow/react';
import type { AppNode, EnvelopeItem, ListTargetHandle, ResultType } from '../types/flow';
import { resolveEffectiveSourceNode } from './virtualNodes';
import { buildMediaAssetSignaturePart } from './mediaAssetSignature';
import {
  getDefaultMimeTypeForFlowKind,
  isFixedEnvelopeItemKind,
  isFlowPrimitiveKind,
  isFlowResultKind,
  serializeManualEnvelopeValue,
} from './flowValueTypes';
import {
  parseCanonicalBoolean,
  resultValueAsMediaUrl,
  restoreResultValue,
  serializeResultValueForContainer,
} from './flowResultValues';
import { formatColorSwatchListPrompt, formatColorSwatchPrompt, normalizeHexColor } from './colorSwatchNode';
import { buildLoraWeightsJson } from './loraSpecNode';
import { analyzeTextSentiment, splitDialogueForPrefix } from './storyUtilityNodes';

export const LIST_ITEM_HANDLE_PREFIX = 'list-item-';

export interface FlowListItem {
  id: string;
  index: number;
  targetHandle: ListTargetHandle;
  nodeId: string;
  kind: ResultType;
  label: string;
  value: string;
  mimeType?: string;
  sourceBinItemId?: string;
  invalidReason?: string;
  text?: string;
}

export function buildListItemTargetHandle(index: number): ListTargetHandle {
  return `${LIST_ITEM_HANDLE_PREFIX}${Math.max(0, Math.floor(index))}` as ListTargetHandle;
}

export function isListItemTargetHandle(handle: string | null | undefined): handle is ListTargetHandle {
  return typeof handle === 'string' && /^list-item-\d+$/.test(handle);
}

export function getListItemIndexFromHandle(handle: string | null | undefined): number | undefined {
  if (!isListItemTargetHandle(handle)) {
    return undefined;
  }

  const value = Number(handle.slice(LIST_ITEM_HANDLE_PREFIX.length));
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The numbered List handles are the authoritative input sequence. Keep this
 * shared so previews, execution, signals, and cache inputs cannot depend on
 * the incidental order in which a saved edge array was serialized.
 */
export function getOrderedListInputEdges(listNodeId: string, edges: Edge[]): Edge[] {
  return edges
    .filter((edge) => edge.target === listNodeId && isListItemTargetHandle(edge.targetHandle))
    .sort((left, right) => (
      (getListItemIndexFromHandle(left.targetHandle) ?? 0) -
      (getListItemIndexFromHandle(right.targetHandle) ?? 0)
    ));
}

export function buildListNodeItems(
  listNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
): FlowListItem[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const slotEdges = getOrderedListInputEdges(listNodeId, edges);
  const latestEdgeBySlot = new Map<number, Edge>();

  for (const edge of slotEdges) {
    const index = getListItemIndexFromHandle(edge.targetHandle);
    if (index !== undefined) {
      latestEdgeBySlot.set(index, edge);
    }
  }

  const items = [...latestEdgeBySlot.entries()].flatMap(([index, edge]) => {
    const sourceNode = resolveConnectionSourceNode(edge.source, nodesById, edges, edge.sourceHandle);

    if (!sourceNode) {
      return [];
    }

    const item = buildListItemFromConnectionSource(sourceNode, nodes, edges, index, buildListItemTargetHandle(index), edge.sourceHandle);
    return item ? [item] : [];
  });
  const listKind = items[0]?.kind;

  return items.map((item) => {
    if (!listKind || item.kind === listKind) {
      return item;
    }

    return {
      ...item,
      invalidReason: `This list is typed as ${listKind}, so ${item.kind} outputs cannot be added.`,
    };
  });
}

export function getValidListNodeItems(items: FlowListItem[]): FlowListItem[] {
  return items.filter((item) => !item.invalidReason);
}

export function getListNodeKind(items: FlowListItem[]): ResultType | undefined {
  return getValidListNodeItems(items)[0]?.kind;
}

export function getListNodeSlotCount(items: FlowListItem[]): number {
  const highestIndex = items.reduce((highest, item) => Math.max(highest, item.index), -1);
  return highestIndex + 2;
}

export function resolveNodeListItemKind(node: AppNode, nodes?: AppNode[], edges?: Edge[]): ResultType | undefined {
  return buildListItemFromNode(node, 0, buildListItemTargetHandle(0), nodes, edges)?.kind;
}

export function buildLoopNodeItems(
  loopNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
): FlowListItem[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const loopNode = nodesById.get(loopNodeId);
  if (!loopNode) return [];

  const count = Number.isInteger(loopNode.data.count) ? Math.max(1, Number(loopNode.data.count)) : 5;
  const incomingEdge = edges.find((edge) => edge.target === loopNodeId);
  if (!incomingEdge) return [];

  const sourceNode = resolveConnectionSourceNode(incomingEdge.source, nodesById, edges, incomingEdge.sourceHandle);
  if (!sourceNode) return [];

  const item = buildListItemFromConnectionSource(sourceNode, nodes, edges, 0, buildListItemTargetHandle(0), incomingEdge.sourceHandle);
  if (!item) return [];

  return Array.from({ length: count }, (_, index) => ({
    ...item,
    id: `${loopNodeId}-loop-${index}`,
    index,
    targetHandle: buildListItemTargetHandle(index),
    nodeId: loopNodeId,
  }));
}

export function buildExpanderSourceItems(
  expanderNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
): FlowListItem[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const rawItems = edges
    .filter((edge) => edge.target === expanderNodeId && edge.targetHandle !== 'index')
    .flatMap((edge, edgeIndex) => {
      const sourceNode = resolveConnectionSourceNode(edge.source, nodesById, edges, edge.sourceHandle);
      if (!sourceNode) return [];

      if (sourceNode.type === 'list') {
        return getValidListNodeItems(buildListNodeItems(sourceNode.id, nodes, edges));
      }

      if (sourceNode.type === 'envelope') {
        return collectEnvelopeItemsForEnvelopeNode(sourceNode.id, nodes, edges).map((item) => ({
          id: `${sourceNode.id}-envelope-${item.index}`,
          index: item.index,
          targetHandle: buildListItemTargetHandle(item.index),
          nodeId: item.sourceNodeId ?? sourceNode.id,
          kind: item.kind,
          label: item.label,
          value: item.value,
          mimeType: item.mimeType,
          sourceBinItemId: item.sourceBinItemId,
        }));
      }

      if (sourceNode.type === 'loopNode') {
        return buildLoopNodeItems(sourceNode.id, nodes, edges);
      }

      const item = buildListItemFromNode(sourceNode, edgeIndex, buildListItemTargetHandle(edgeIndex), nodes, edges, edge.sourceHandle);
      return item ? [item] : [];
    });

  return rawItems.map((item, flatIdx) => ({
    ...item,
    id: `${expanderNodeId}-item-${flatIdx}-${item.id}`,
    index: flatIdx,
    targetHandle: buildListItemTargetHandle(flatIdx),
  }));
}

export function evaluateNodeTextForMonitor(
  nodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  visited: Set<string> = new Set<string>(),
): string {
  if (visited.has(nodeId)) {
    return ''; // Prevent infinite recursion on circular connections
  }
  visited.add(nodeId);

  const node = nodes.find(n => n.id === nodeId);
  if (!node) return '';

  // Handle virtual nodes (portals, switches, etc.) by resolving to their effective source
  if (['portal', 'switchNode', 'forkSwitchNode', 'valueMonitorNode', 'virtual'].includes(node.type)) {
    const nodesById = new Map(nodes.map(n => [n.id, n]));
    const effNode = resolveEffectiveSourceNode(node, nodesById, edges);
    if (!effNode) {
      return '';
    }
    if (effNode.id !== nodeId) {
      return evaluateNodeTextForMonitor(effNode.id, nodes, edges, visited);
    }
  }

  if (node.type === 'conditionalNode') {
    const conditionEdge = edges.find(e => e.target === nodeId && e.targetHandle === 'condition');
    const trueEdge = edges.find(e => e.target === nodeId && e.targetHandle === 'valueIfTrue');
    const falseEdge = edges.find(e => e.target === nodeId && e.targetHandle === 'valueIfFalse');

    let isTrue = false;
    if (conditionEdge) {
      const conditionVal = evaluateNodeTextForMonitor(conditionEdge.source, nodes, edges, new Set(visited));
      const lower = conditionVal.toLowerCase().trim();
      isTrue = (lower === 'true' || lower === '1');
    }

    const selectedEdge = isTrue ? trueEdge : falseEdge;
    if (selectedEdge) {
      return evaluateNodeTextForMonitor(selectedEdge.source, nodes, edges, new Set(visited));
    }
    return '';
  }

  if (node.type === 'textNode') {
    const mode = node.data.mode ?? 'prompt';
    return ((mode === 'generate' ? node.data.result : node.data.prompt) as string | undefined) || '';
  }

  if (node.type === 'numberNode') {
    return node.data.value !== undefined ? String(node.data.value) : '0';
  }

  if (node.type === 'expander') {
    const item = resolveExpandedListItemForNode(node, nodes, edges, visited);
    if (item) {
      if (item.kind === 'text') {
        return item.value || '';
      }
      if (item.kind === 'package') {
        return item.text || '';
      }
    }
    return '';
  }

  if (node.type === 'packageNode') {
    const pkg = resolvePackageNodeData(node.id, nodes, edges, visited);
    return pkg.text || '';
  }

  if (node.type === 'doodleNode') {
    const incomingEdge = edges.find((edge) => edge.target === node.id);
    if (incomingEdge) {
      const upstream = evaluateNodeTextForMonitor(incomingEdge.source, nodes, edges, new Set(visited));
      if (upstream.trim()) return upstream.trim();
    }
    return typeof node.data.doodleDescription === 'string' ? node.data.doodleDescription.trim() : '';
  }

  if (node.type === 'colorSwatchNode') {
    return formatColorSwatchPrompt(node.data);
  }

  if (node.type === 'colorSwatchListNode') {
    return formatColorSwatchListPrompt(node, nodes, edges);
  }

  if (node.type === 'loraSpecNode') {
    return buildLoraWeightsJson(node.data.loraEntries);
  }

  if (node.type === 'stringTemplateNode') {
    const template = (node.data.template as string) ?? '{A} and {B}';
    const edgeA = edges.find(e => e.target === nodeId && e.targetHandle === 'A');
    const edgeB = edges.find(e => e.target === nodeId && e.targetHandle === 'B');
    const edgeC = edges.find(e => e.target === nodeId && e.targetHandle === 'C');

    const valA = edgeA ? evaluateNodeTextForMonitor(edgeA.source, nodes, edges, new Set(visited)) : '';
    const valB = edgeB ? evaluateNodeTextForMonitor(edgeB.source, nodes, edges, new Set(visited)) : '';
    const valC = edgeC ? evaluateNodeTextForMonitor(edgeC.source, nodes, edges, new Set(visited)) : '';

    return template
      .replace(/{A}/g, valA)
      .replace(/{B}/g, valB)
      .replace(/{C}/g, valC);
  }

  if (node.type === 'promptsJoinerNode') {
    const delimiter = (node.data.delimiter as string) ?? ', ';
    const edgeA = edges.find(e => e.target === nodeId && e.targetHandle === 'A');
    const edgeB = edges.find(e => e.target === nodeId && e.targetHandle === 'B');
    const edgeC = edges.find(e => e.target === nodeId && e.targetHandle === 'C');

    const valA = edgeA ? evaluateNodeTextForMonitor(edgeA.source, nodes, edges, new Set(visited)) : '';
    const valB = edgeB ? evaluateNodeTextForMonitor(edgeB.source, nodes, edges, new Set(visited)) : '';
    const valC = edgeC ? evaluateNodeTextForMonitor(edgeC.source, nodes, edges, new Set(visited)) : '';

    return [valA, valB, valC]
      .map(v => v.trim())
      .filter(Boolean)
      .join(delimiter);
  }

  if (node.type === 'regexReplaceNode') {
    const pattern = (node.data.pattern as string) ?? '';
    const replacement = (node.data.replacement as string) ?? '';
    const incomingEdge = edges.find(e => e.target === nodeId);
    const val = incomingEdge ? evaluateNodeTextForMonitor(incomingEdge.source, nodes, edges, new Set(visited)) : '';

    if (!pattern) return val;
    try {
      const regex = new RegExp(pattern, 'g');
      return val.replace(regex, replacement);
    } catch {
      return val;
    }
  }

  if (node.type === 'listLengthNode') {
    const listEdge = edges.find(e => e.target === nodeId);
    if (!listEdge) return '0';

    const sourceNode = nodes.find(n => n.id === listEdge.source);
    if (!sourceNode) return '0';

    const nodesById = new Map(nodes.map(n => [n.id, n]));
    const effSourceNode = resolveEffectiveSourceNode(sourceNode, nodesById, edges, listEdge.sourceHandle);
    if (!effSourceNode) return '0';

    if (effSourceNode.type === 'list') {
      const items = buildListNodeItems(effSourceNode.id, nodes, edges);
      return String(items.filter(item => !item.invalidReason).length);
    } else if (effSourceNode.type === 'envelope') {
      const items = collectEnvelopeItemsForEnvelopeNode(effSourceNode.id, nodes, edges);
      return String(items.length);
    } else if (effSourceNode.type === 'loopNode') {
      const count = Number.isInteger(effSourceNode.data.count) ? Math.max(1, Number(effSourceNode.data.count)) : 5;
      return String(count);
    }

    if (Array.isArray(effSourceNode.data.envelopeItems)) {
      return String(effSourceNode.data.envelopeItems.length);
    }
    if (Array.isArray(effSourceNode.data.resultHistory)) {
      return String(effSourceNode.data.resultHistory.length);
    }

    return '0';
  }

  if (node.type === 'mathNode') {
    const op = node.data.operation ?? '+';
    const edgeA = edges.find(e => e.target === nodeId && e.targetHandle === 'A');
    const edgeB = edges.find(e => e.target === nodeId && e.targetHandle === 'B');

    const valA = edgeA ? evaluateNodeTextForMonitor(edgeA.source, nodes, edges, new Set(visited)) : String(node.data.valueA ?? 0);
    const valB = edgeB ? evaluateNodeTextForMonitor(edgeB.source, nodes, edges, new Set(visited)) : String(node.data.valueB ?? 0);

    const numA = valA.trim() === '' ? 0 : parseFloat(valA);
    const numB = valB.trim() === '' ? 0 : parseFloat(valB);

    if (isNaN(numA) || isNaN(numB)) {
      return '0';
    }

    let res = 0;
    if (op === '+') {
      res = numA + numB;
    } else if (op === '-') {
      res = numA - numB;
    } else if (op === '*') {
      res = numA * numB;
    } else if (op === '/') {
      res = numB !== 0 ? numA / numB : 0;
    } else if (op === 'modulo' || op === '%' || op === 'MOD') {
      res = numB !== 0 ? numA % numB : 0;
    }

    return String(res);
  }

  if (node.type === 'logicNode') {
    const op = node.data.operation ?? 'AND';
    const edgeA = edges.find(e => e.target === nodeId && e.targetHandle === 'A');
    const edgeB = edges.find(e => e.target === nodeId && e.targetHandle === 'B');

    const valA = edgeA ? evaluateNodeTextForMonitor(edgeA.source, nodes, edges, new Set(visited)) : '';
    const valB = edgeB ? evaluateNodeTextForMonitor(edgeB.source, nodes, edges, new Set(visited)) : '';

    const parseBool = (v: string) => {
      const lower = v.toLowerCase().trim();
      return lower === 'true' || lower === '1';
    };

    const boolA = parseBool(valA);
    const boolB = parseBool(valB);

    let res = false;
    if (op === 'AND') {
      res = boolA && boolB;
    } else if (op === 'OR') {
      res = boolA || boolB;
    } else if (op === 'XOR') {
      res = boolA !== boolB;
    } else if (op === 'NOT') {
      res = !boolA;
    }

    return res ? 'true' : 'false';
  }

  if (node.type === 'comparisonNode') {
    const op = node.data.operation ?? 'equals';
    const edgeA = edges.find(e => e.target === nodeId && e.targetHandle === 'A');
    const edgeB = edges.find(e => e.target === nodeId && e.targetHandle === 'B');

    const valA = edgeA ? evaluateNodeTextForMonitor(edgeA.source, nodes, edges, new Set(visited)) : '';
    const valB = edgeB ? evaluateNodeTextForMonitor(edgeB.source, nodes, edges, new Set(visited)) : '';

    const numA = parseFloat(valA);
    const numB = parseFloat(valB);

    let res = false;
    const isNumeric = !isNaN(numA) && !isNaN(numB);

    if (op === 'equals') {
      if (isNumeric) {
        res = numA === numB;
      } else {
        res = valA.trim() === valB.trim();
      }
    } else if (op === 'contains') {
      res = valA.toLowerCase().includes(valB.toLowerCase());
    } else if (op === 'greaterThan') {
      if (isNumeric) {
        res = numA > numB;
      } else {
        res = valA.localeCompare(valB) > 0;
      }
    } else if (op === 'lessThan') {
      if (isNumeric) {
        res = numA < numB;
      } else {
        res = valA.localeCompare(valB) < 0;
      }
    }

    return res ? 'true' : 'false';
  }

  if (node.type === 'visionVerifyNode') {
    const result = restoreResultValue(node.data.result, 'boolean');
    return typeof result === 'boolean' ? String(result) : '';
  }

  if (node.type === 'seedSequencerNode') {
    const incomingEdge = edges.find((edge) => edge.target === nodeId);
    const index = incomingEdge
      ? Number(evaluateNodeTextForMonitor(incomingEdge.source, nodes, edges, new Set(visited)))
      : 0;
    const seed = Number(node.data.seed ?? 12345);
    const increment = Number(node.data.increment ?? 1);
    return String(Math.trunc(seed) + (Number.isFinite(index) ? Math.trunc(index) : 0) * Math.trunc(increment));
  }

  if (node.type === 'storyStateNode') {
    const key = (node.data.key as string) ?? '';
    if (!key) return '';

    // If there's an incoming connection, evaluate it (acting as updater)
    const incomingEdge = edges.find(e => e.target === nodeId);
    if (incomingEdge) {
      return evaluateNodeTextForMonitor(incomingEdge.source, nodes, edges, new Set(visited));
    }

    // Static value fallback
    if (node.data.value !== undefined && node.data.value !== null && String(node.data.value).trim() !== '') {
      return String(node.data.value);
    }

    // Acting as reader - find matching writer/setter node for the same key
    const writerNode = nodes.find(n =>
      n.type === 'storyStateNode' &&
      n.id !== nodeId &&
      (n.data.key as string) === key &&
      (edges.some(e => e.target === n.id) || (n.data.value !== undefined && n.data.value !== null && String(n.data.value).trim() !== ''))
    );

    if (writerNode) {
      return evaluateNodeTextForMonitor(writerNode.id, nodes, edges, visited);
    }

    return '';
  }

  if (node.data.result !== undefined && node.data.result !== null && node.data.result !== '') {
    const kind = isResultType(node.data.resultType) ? node.data.resultType : undefined;
    const result = kind ? restoreResultValue(node.data.result, kind) : node.data.result;
    return result === undefined ? '' : String(result);
  }

  if (node.data.value !== undefined && node.data.value !== null && node.data.value !== '') {
    return String(node.data.value);
  }

  return '';
}

function resolveConnectedIndexValue(
  expanderNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  visited?: Set<string>,
): number | undefined {
  const indexEdge = edges.find((edge) => edge.target === expanderNodeId && edge.targetHandle === 'index');
  if (!indexEdge) {
    return undefined;
  }

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const rawSource = nodesById.get(indexEdge.source);
  if (!rawSource) {
    return undefined;
  }

  const sourceNode = resolveEffectiveSourceNode(rawSource, nodesById, edges, indexEdge.sourceHandle);
  if (!sourceNode) {
    return undefined;
  }

  const textVal = evaluateNodeTextForMonitor(sourceNode.id, nodes, edges, visited);

  if (textVal) {
    const parsed = parseInt(textVal.trim(), 10);
    if (!isNaN(parsed)) {
      return parsed - 1; // Subtract 1 to convert from user's 1-based numbering to 0-based indexing
    }
  }

  return undefined;
}

export function resolveExpandedListItemForNode(
  node: AppNode | undefined,
  nodes: AppNode[],
  edges: Edge[],
  visited?: Set<string>,
): FlowListItem | undefined {
  if (!node || node.type !== 'expander') return undefined;
  const items = buildExpanderSourceItems(node.id, nodes, edges);
  if (items.length === 0) return undefined;

  const visitedSet = visited ?? new Set<string>([node.id]);

  let selectedIndex = Number.isInteger(node.data.expandedItemIndex) ? Number(node.data.expandedItemIndex) : 0;
  const dynamicIndex = resolveConnectedIndexValue(node.id, nodes, edges, visitedSet);
  if (dynamicIndex !== undefined) {
    selectedIndex = dynamicIndex;
  }

  const selected = items.find((item) => item.index === selectedIndex) ?? items[selectedIndex] ?? items[0];
  if (!selected) return undefined;

  return {
    ...selected,
    id: `${node.id}-expanded-${selected.id}`,
    targetHandle: buildListItemTargetHandle(selected.index),
    nodeId: node.id,
  };
}

export function resolvePackageNodeData(
  packageNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  visited?: Set<string>,
): { text: string; image?: string } {
  const matchingEdges = edges.filter((edge) => edge.target === packageNodeId);
  const textPrompts: string[] = [];
  let imageUrl: string | undefined;

  for (const edge of matchingEdges) {
    const rawSourceNode = nodes.find((n) => n.id === edge.source);
    if (!rawSourceNode) continue;
    const sourceNode = resolveEffectiveSourceNode(rawSourceNode, new Map(nodes.map((n) => [n.id, n])), edges, edge.sourceHandle);
    if (!sourceNode) continue;

    if (edge.targetHandle === 'text' || !edge.targetHandle) {
      const value = evaluateNodeTextForMonitor(sourceNode.id, nodes, edges, visited);
      if (value?.trim()) {
        textPrompts.push(value.trim());
      }
    } else if (edge.targetHandle === 'image') {
      if (sourceNode.type === 'imageGen' || sourceNode.type === 'cropImageNode') {
        const val = resolveMediaNodeAsset(sourceNode);
        if (val) {
          imageUrl = val;
        }
      } else if (sourceNode.type === 'slimgNode' || sourceNode.type === 'advancedImageEditor') {
        const val = sourceNode.type === 'advancedImageEditor'
          ? (edge.sourceHandle === 'maskOutput' ? sourceNode.data.maskOutput : sourceNode.data.result)
          : resolveMediaNodeAsset(sourceNode);
        if (typeof val === 'string' && val) {
          imageUrl = val;
        }
      } else if (sourceNode.type === 'functionNode' && sourceNode.data.resultType === 'image') {
        if (typeof sourceNode.data.result === 'string' && sourceNode.data.result) {
          imageUrl = sourceNode.data.result;
        }
      } else if (sourceNode.type === 'expander') {
        const item = resolveExpandedListItemForNode(sourceNode, nodes, edges, visited);
        if (item?.kind === 'image' && item.value) {
          imageUrl = item.value;
        }
      }
    }
  }

  return {
    text: textPrompts.join('\n\n').trim(),
    image: imageUrl,
  };
}

function buildListItemFromConnectionSource(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  index: number,
  targetHandle: ListTargetHandle,
  sourceHandle?: string | null,
): FlowListItem | undefined {
  if (node.type === 'expander') {
    const selected = resolveExpandedListItemForNode(node, nodes, edges);
    return selected
      ? {
          ...selected,
          id: `${node.id}-${index}`,
          index,
          targetHandle,
          nodeId: node.id,
        }
      : undefined;
  }

  return buildListItemFromNode(node, index, targetHandle, nodes, edges, sourceHandle);
}

export function buildListItemFromNode(
  node: AppNode,
  index: number,
  targetHandle: ListTargetHandle,
  nodes?: AppNode[],
  edges?: Edge[],
  sourceHandle?: string | null,
): FlowListItem | undefined {
  if (node.type === 'textNode') {
    const mode = node.data.mode ?? 'prompt';
    const rawText = mode === 'generate' ? node.data.result : node.data.prompt;
    const text = typeof rawText === 'string' ? rawText.trim() : '';

    if (!text) {
      return undefined;
    }

    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'text',
      label: text.slice(0, 48),
      value: text,
      mimeType: 'text/plain',
    };
  }

  if (node.type === 'imageGen' || node.type === 'cropImageNode' || node.type === 'slimgNode') {
    const assetUrl = resolveMediaNodeAsset(node);

    if (!assetUrl) {
      return undefined;
    }

    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'image',
      label: node.type === 'cropImageNode' ? node.data.customTitle ?? 'Cropped image' : node.type === 'slimgNode' ? node.data.customTitle ?? '.slimg' : node.data.sourceAssetName ?? node.data.modelId ?? 'Image',
      value: assetUrl,
      mimeType: node.data.sourceAssetMimeType ?? node.data.resultMimeType ?? 'image/png',
    };
  }

  if (node.type === 'videoGen' || node.type === 'composition') {
    const assetUrl = resolveMediaNodeAsset(node);

    if (!assetUrl) {
      return undefined;
    }

    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'video',
      label: node.type === 'composition' ? 'Composition output' : node.data.sourceAssetName ?? node.data.modelId ?? 'Video',
      value: assetUrl,
      mimeType: node.data.sourceAssetMimeType ?? 'video/mp4',
    };
  }

  if (node.type === 'audioGen') {
    const assetUrl = resolveMediaNodeAsset(node);

    if (!assetUrl) {
      return undefined;
    }

    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'audio',
      label: node.data.sourceAssetName ?? node.data.voiceId ?? node.data.modelId ?? 'Audio',
      value: assetUrl,
      mimeType: node.data.sourceAssetMimeType ?? 'audio/mpeg',
    };
  }

  if (node.type === 'functionNode') {
    const kind = isResultType(node.data.resultType) ? node.data.resultType : 'text';
    const scalarResult = restoreResultValue(node.data.result, kind);
    if (scalarResult === undefined) {
      return undefined;
    }
    let result: string;
    try {
      result = serializeResultValueForContainer(scalarResult, kind);
    } catch {
      return undefined;
    }
    if (!result) return undefined;
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind,
      label: node.data.customTitle ?? node.data.functionNode?.title ?? 'Function output',
      value: result,
      mimeType: node.data.resultMimeType ?? getDefaultMimeType(kind),
    };
  }

  if (node.type === 'packageNode') {
    const pkg = nodes && edges ? resolvePackageNodeData(node.id, nodes, edges) : { text: '', image: undefined };

    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'package',
      label: node.data.customTitle ?? 'Package',
      value: pkg.image ?? '',
      text: pkg.text,
      mimeType: 'image/png',
    };
  }

  if (node.type === 'doodleNode') {
    const text = nodes && edges ? evaluateNodeTextForMonitor(node.id, nodes, edges) : String(node.data.doodleDescription ?? '').trim();
    const image = typeof node.data.doodleSketch === 'string' ? node.data.doodleSketch : '';
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'package',
      label: node.data.customTitle ?? 'Doodle package',
      value: image,
      text,
      mimeType: image.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png',
    };
  }

  if (node.type === 'colorSwatchNode') {
    const colorIndex = sourceHandle?.match(/^palette-color-(\d+)$/)?.[1];
    const selectedColor = colorIndex === undefined ? undefined : node.data.colorSwatchColors?.[Number(colorIndex)];
    const value = typeof selectedColor === 'string' ? normalizeHexColor(selectedColor) : formatColorSwatchPrompt(node.data);
    if (!value) {
      return undefined;
    }

    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'text',
      label: node.data.customTitle ?? 'Color palette',
      value,
      mimeType: 'text/plain',
    };
  }

  if (node.type === 'colorSwatchListNode') {
    const value = formatColorSwatchListPrompt(node, nodes ?? [], edges ?? []);
    if (!value) {
      return undefined;
    }

    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'text',
      label: node.data.customTitle ?? 'Color swatch',
      value,
      mimeType: 'text/plain',
    };
  }

  if (node.type === 'loraSpecNode') {
    const value = buildLoraWeightsJson(node.data.loraEntries);
    if (!value) {
      return undefined;
    }

    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'json',
      label: node.data.customTitle ?? 'LoRA spec',
      value,
      mimeType: 'application/json',
    };
  }

  if (node.type === 'numberNode') {
    const val = node.data.value !== undefined ? String(node.data.value) : '0';
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'number',
      label: node.data.customTitle ?? `Number: ${val}`,
      value: val,
      mimeType: 'text/plain',
    };
  }

  if (node.type === 'valueNode') {
    const kind = isFlowPrimitiveKind(node.data.valueKind) ? node.data.valueKind : 'text';
    const val = serializeManualEnvelopeValue(kind, node.data.value);
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind,
      label: node.data.customTitle ?? `${capitalizeKind(kind)}: ${val.slice(0, 32)}`,
      value: val,
      mimeType: getDefaultMimeType(kind),
    };
  }

  if (node.type === 'mathNode' || node.type === 'listLengthNode') {
    const val = nodes && edges ? evaluateNodeTextForMonitor(node.id, nodes, edges) : '0';
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'number',
      label: node.data.customTitle ?? (node.type === 'mathNode' ? 'Math Result' : 'List Length'),
      value: val,
      mimeType: 'text/plain',
    };
  }

  if (node.type === 'seedSequencerNode') {
    const val = nodes && edges ? evaluateNodeTextForMonitor(node.id, nodes, edges) : String(node.data.seed ?? 12345);
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'number',
      label: node.data.customTitle ?? 'Seed',
      value: val,
      mimeType: 'text/plain',
    };
  }

  if (node.type === 'list') {
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'list',
      label: node.data.customTitle ?? 'List',
      value: node.id,
      mimeType: 'application/json',
    };
  }

  if (node.type === 'envelope') {
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'envelope',
      label: node.data.customTitle ?? 'Envelope',
      value: node.id,
      mimeType: 'application/json',
    };
  }

  if ([
    'logicNode', 'comparisonNode', 'visionVerifyNode', 'loopBreakNode',
  ].includes(node.type)) {
    const val = nodes && edges ? evaluateNodeTextForMonitor(node.id, nodes, edges) : '';
    if (parseCanonicalBoolean(val) === undefined) {
      return undefined;
    }
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'boolean',
      label: node.data.customTitle ?? `${node.type} Output`,
      value: val,
      mimeType: getDefaultMimeType('boolean'),
    };
  }

  if (node.type === 'storyStateNode') {
    const key = String(node.data.key ?? 'state').trim() || 'state';
    const value = parseMonitorValue(nodes && edges ? evaluateNodeTextForMonitor(node.id, nodes, edges) : node.data.value);
    return jsonListItem(node, index, targetHandle, { [key]: value }, 'Story state');
  }

  if (node.type === 'textSentimentAnalysisNode') {
    const text = nodes && edges
      ? evaluateFirstIncomingText(node.id, nodes, edges)
      : '';
    return jsonListItem(node, index, targetHandle, analyzeTextSentiment(text), 'Sentiment');
  }

  if (node.type === 'imageFeatureExtractorNode') {
    const value = node.data.imageFeatures && typeof node.data.imageFeatures === 'object'
      ? node.data.imageFeatures
      : {};
    return jsonListItem(node, index, targetHandle, value, 'Image features');
  }

  if (node.type === 'dialogueScriptSplitterNode') {
    const script = nodes && edges ? evaluateFirstIncomingText(node.id, nodes, edges) : '';
    const lines = splitDialogueForPrefix(script, String(node.data.prefix ?? 'MARA:'));
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'list',
      label: node.data.customTitle ?? 'Dialogue lines',
      value: JSON.stringify(lines),
      mimeType: 'application/json',
    };
  }

  if ([
    'conditionalNode', 'valueMonitorNode',
    'stringTemplateNode', 'regexReplaceNode', 'promptsJoinerNode', 'negativePromptNode',
    'promptMixerNode', 'fallbackSelectorNode',
  ].includes(node.type)) {
    const val = nodes && edges ? evaluateNodeTextForMonitor(node.id, nodes, edges) : '';
    return {
      id: `${node.id}-${index}`,
      index,
      targetHandle,
      nodeId: node.id,
      kind: 'text',
      label: node.data.customTitle ?? `${node.type} Output`,
      value: val,
      mimeType: 'text/plain',
    };
  }

  return undefined;
}

export function normalizeEnvelopeItems(value: unknown): EnvelopeItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const usedIndexes = new Set<number>();
  return value.flatMap((item, fallbackIndex) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const candidate = item as Partial<EnvelopeItem>;

    if (
      typeof candidate.value !== 'string' ||
      typeof candidate.label !== 'string' ||
      !isResultType(candidate.kind)
    ) {
      return [];
    }

    // List/envelope payloads are intentionally strings. A Boolean item must
    // still use one of the two canonical spellings so it can be restored to a
    // real Boolean at the scalar node/history/project boundary.
    if (candidate.kind === 'boolean' && parseCanonicalBoolean(candidate.value) === undefined) {
      return [];
    }

    const index = resolveUniqueEnvelopeIndex(candidate.index, fallbackIndex, usedIndexes);

    return [{
      id: typeof candidate.id === 'string' ? candidate.id : `envelope-item-${index}`,
      index,
      kind: candidate.kind,
      label: candidate.label,
      value: serializeManualEnvelopeValue(candidate.kind, candidate.value),
      mimeType: typeof candidate.mimeType === 'string' ? candidate.mimeType : getDefaultMimeType(candidate.kind),
      sourceBinItemId: typeof candidate.sourceBinItemId === 'string' ? candidate.sourceBinItemId : undefined,
      sourceNodeId: typeof candidate.sourceNodeId === 'string' ? candidate.sourceNodeId : undefined,
      usage: candidate.usage,
      text: typeof candidate.text === 'string' ? candidate.text : undefined,
      invalidReason: typeof candidate.invalidReason === 'string' ? candidate.invalidReason : undefined,
    }];
  });
}

function resolveUniqueEnvelopeIndex(
  value: unknown,
  fallbackIndex: number,
  usedIndexes: Set<number>,
): number {
  let index = Number.isInteger(value) && Number(value) >= 0 && !usedIndexes.has(Number(value))
    ? Number(value)
    : fallbackIndex;

  while (usedIndexes.has(index)) {
    index += 1;
  }

  usedIndexes.add(index);
  return index;
}

export function collectEnvelopeItemsForEnvelopeNode(
  envelopeNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  visited = new Set<string>(),
): EnvelopeItem[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const envelopeNode = nodesById.get(envelopeNodeId);

  if (!envelopeNode) {
    return [];
  }

  const incoming = edges.filter((edge) => edge.target === envelopeNodeId);
  const persistedEnvelope = normalizeEnvelopeItems(envelopeNode.data.envelopeItems);
  const fixedKind = isFixedEnvelopeItemKind(envelopeNode.data.envelopeItemKind) ? envelopeNode.data.envelopeItemKind : undefined;

  if (incoming.length === 0 && persistedEnvelope.length > 0) {
    return applyEnvelopeTypeWarnings(persistedEnvelope.map((item, fallbackIndex) => ({
      ...item,
      index: Number.isInteger(item.index) ? item.index : fallbackIndex,
      sourceNodeId: item.sourceNodeId ?? envelopeNode.id,
    })), fixedKind);
  }

  const collected = incoming.flatMap((edge) => {
    const sourceNode = resolveConnectionSourceNode(edge.source, nodesById, edges, edge.sourceHandle);
    return sourceNode
      ? collectEnvelopeItemsFromSourceNode(sourceNode, nodes, edges, new Set([...visited, envelopeNodeId]))
      : [];
  });

  if (collected.length === 0) {
    return applyEnvelopeTypeWarnings(persistedEnvelope.map((item, fallbackIndex) => ({
      ...item,
      index: Number.isInteger(item.index) ? item.index : fallbackIndex,
      sourceNodeId: item.sourceNodeId ?? envelopeNode.id,
    })), fixedKind);
  }

  // Merge persistedEnvelope with collected to retain manual edits/deletions and drag connections
  const merged = [...persistedEnvelope];

  for (const colItem of collected) {
    const isDuplicate = merged.some((persisted) => {
      if (persisted.id === colItem.id) return true;
      if (persisted.sourceBinItemId && persisted.sourceBinItemId === colItem.sourceBinItemId) return true;
      if (persisted.value && colItem.value) {
        if (persisted.value === colItem.value) return true;
        if (buildMediaAssetSignaturePart(persisted.value) === buildMediaAssetSignaturePart(colItem.value)) return true;
      }
      return false;
    });

    if (!isDuplicate) {
      merged.push({
        ...colItem,
        sourceNodeId: colItem.sourceNodeId ?? envelopeNode.id,
      });
    }
  }

  const sortedMerged = merged.sort((left, right) => left.index - right.index);
  const usedIndexes = new Set<number>();

  return applyEnvelopeTypeWarnings(sortedMerged.map((item, idx) => ({
    ...item,
    index: resolveUniqueEnvelopeIndex(item.index, idx, usedIndexes),
  })), fixedKind);
}

function applyEnvelopeTypeWarnings(items: EnvelopeItem[], fixedKind?: ResultType): EnvelopeItem[] {
  if (!fixedKind) {
    return items;
  }

  return items.map((item) => item.kind === fixedKind
    ? { ...item, invalidReason: undefined }
    : {
      ...item,
      invalidReason: `This envelope is typed as ${fixedKind}, so ${item.kind} outputs cannot be added.`,
    });
}

export function collectEnvelopeItemsFromSourceNode(
  node: AppNode,
  nodes: AppNode[],
  edges: Edge[],
  visited = new Set<string>(),
): EnvelopeItem[] {
  if (visited.has(node.id)) {
    return [];
  }

  visited.add(node.id);

  if (node.type === 'envelope') {
    return collectEnvelopeItemsForEnvelopeNode(node.id, nodes, edges, visited);
  }

  const persistedEnvelope = normalizeEnvelopeItems(node.data.envelopeItems);
  if (persistedEnvelope.length > 0) {
    return persistedEnvelope.map((item, fallbackIndex) => ({
      ...item,
      index: Number.isInteger(item.index) ? item.index : fallbackIndex,
      sourceNodeId: item.sourceNodeId ?? node.id,
    }));
  }

  if (node.type === 'list') {
    return getValidListNodeItems(buildListNodeItems(node.id, nodes, edges)).map((item) => ({
      id: `${node.id}-list-${item.index}`,
      index: item.index,
      kind: item.kind,
      label: item.label,
      value: item.value,
      mimeType: item.mimeType,
      sourceBinItemId: item.sourceBinItemId,
      sourceNodeId: item.nodeId,
    }));
  }

  if (node.type === 'expander') {
    const item = resolveExpandedListItemForNode(node, nodes, edges);
    return item
      ? [{
          id: `${node.id}-single-0`,
          index: 0,
          kind: item.kind,
          label: item.label,
          value: item.value,
          mimeType: item.mimeType,
          sourceBinItemId: item.sourceBinItemId,
          sourceNodeId: item.nodeId,
        }]
      : [];
  }

  if (node.type === 'loopNode') {
    return buildLoopNodeItems(node.id, nodes, edges).map((item) => ({
      id: item.id,
      index: item.index,
      kind: item.kind,
      label: item.label,
      value: item.value,
      mimeType: item.mimeType,
      sourceBinItemId: item.sourceBinItemId,
      sourceNodeId: item.nodeId,
    }));
  }

  const item = buildListItemFromNode(node, 0, buildListItemTargetHandle(0), nodes, edges);

  return item
    ? [{
        id: `${node.id}-single-0`,
        index: 0,
        kind: item.kind,
        label: item.label,
        value: item.value,
        text: item.text,
        mimeType: item.mimeType,
        sourceBinItemId: item.sourceBinItemId,
        sourceNodeId: item.nodeId,
      }]
    : [];
}

function resolveConnectionSourceNode(
  sourceNodeId: string,
  nodesById: Map<string, AppNode>,
  edges: Edge[],
  sourceHandle?: string | null,
): AppNode | undefined {
  const rawSourceNode = nodesById.get(sourceNodeId);
  return rawSourceNode ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, sourceHandle) : undefined;
}

function resolveMediaNodeAsset(node: AppNode): string | undefined {
  if (node.type === 'imageGen' || node.type === 'cropImageNode' || node.type === 'videoGen' || node.type === 'audioGen') {
    const mode = node.data.mediaMode ?? 'generate';
    if (mode === 'import') {
      return resultValueAsMediaUrl(node.data.sourceAssetUrl) ?? resultValueAsMediaUrl(node.data.result);
    }
    return resultValueAsMediaUrl(node.data.result) ?? resultValueAsMediaUrl(node.data.sourceAssetUrl);
  }

  if (node.type === 'composition') {
    return resultValueAsMediaUrl(node.data.result);
  }

  if (node.type === 'slimgNode') {
    return resultValueAsMediaUrl(node.data.result);
  }

  return undefined;
}

export function getDefaultMimeType(kind: ResultType): string {
  return getDefaultMimeTypeForFlowKind(kind);
}

function isResultType(value: unknown): value is ResultType {
  return isFlowResultKind(value);
}

function capitalizeKind(kind: ResultType): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function evaluateFirstIncomingText(nodeId: string, nodes: AppNode[], edges: Edge[]): string {
  const edge = edges.find((candidate) => candidate.target === nodeId);
  return edge ? evaluateNodeTextForMonitor(edge.source, nodes, edges) : '';
}

function parseMonitorValue(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? '';
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed && Number.isFinite(Number(trimmed))) return Number(trimmed);
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function jsonListItem(
  node: AppNode,
  index: number,
  targetHandle: ListTargetHandle,
  value: unknown,
  fallbackLabel: string,
): FlowListItem {
  return {
    id: `${node.id}-${index}`,
    index,
    targetHandle,
    nodeId: node.id,
    kind: 'json',
    label: node.data.customTitle ?? fallbackLabel,
    value: JSON.stringify(value),
    mimeType: 'application/json',
  };
}
