import type { Edge } from '@xyflow/react';
import type { AppNode, FlowNodeType, NodeData } from '../types/flow';
import type { FlowPortContract } from './flowNodeContracts';
import type { FlowDataType } from './flowPortTypes';
import {
  type FlowModelCardV1,
  type ModelCardRefV1,
  type ModelFieldV1,
  type ModelOutputV1,
} from './providerPackContracts';
import {
  modelCardInputHandle,
  modelCardOutputHandle,
} from './providerPackExecution';
import { providerPackRegistry } from './providerPackRegistry';

export interface ModelCardEdgeRemapStub {
  state: 'needs-remapping';
  previousOperationId: string;
  nextOperationId: string;
  semanticRole?: string;
  index: number;
  message: string;
}

export function nodeTypeForModelCard(card: FlowModelCardV1): FlowNodeType {
  const modality = card.modalities[0];
  if (modality === 'video') return 'videoGen';
  if (modality === 'audio') return 'audioGen';
  if (modality === 'text') return 'textNode';
  return 'imageGen';
}

export function createModelCardNodeData(
  packId: string,
  version: string,
  hash: string,
  card: FlowModelCardV1,
  providerId?: string,
): Partial<NodeData> {
  return {
    modelCardRef: { packId, version, hash, cardId: card.id },
    modelCardOperationId: card.operations[0]?.id,
    modelCardValues: Object.fromEntries(
      card.fields.flatMap((field) => field.defaultValue === undefined ? [] : [[field.id, field.defaultValue]]),
    ),
    provider: providerId as NodeData['provider'],
    modelId: card.modelId,
    mode: card.modalities[0] === 'text' ? 'generate' : undefined,
    mediaMode: card.modalities[0] === 'text' ? undefined : 'generate',
  };
}

export function resolveModelCardPorts(node: AppNode): FlowPortContract[] | undefined {
  const ref = parseModelCardRef(node.data.modelCardRef);
  if (!ref) return undefined;
  const resolved = providerPackRegistry.resolveCard(ref, node.data.embeddedProviderPackSnapshots);
  const operationId = typeof node.data.modelCardOperationId === 'string'
    ? node.data.modelCardOperationId
    : resolved.card.operations[0]?.id;
  const operation = resolved.card.operations.find((candidate) => candidate.id === operationId);
  if (!operation) return [];
  const ports: FlowPortContract[] = [];
  for (const fieldId of operation.inputPortFieldIds) {
    const field = resolved.card.fields.find((candidate) => candidate.id === fieldId);
    if (!field) continue;
    const count = field.cardinality === 'many'
      ? field.constraints?.maxItems ?? field.constraints?.visiblePortCount ?? 0
      : 1;
    for (let index = 0; index < count; index += 1) {
      ports.push({
        id: modelCardInputHandle(field.id, field.cardinality === 'many' ? index : undefined),
        direction: 'input',
        label: field.cardinality === 'many' ? `${field.label} ${index + 1}` : field.label,
        help: field.description ?? `${field.label} for ${operation.label}.`,
        types: [fieldFlowType(field)],
        required: Boolean(field.required && (field.cardinality === 'one' || index === 0)),
        minConnections: field.required && (field.cardinality === 'one' || index === 0) ? 1 : 0,
        maxConnections: 1,
        ordered: field.cardinality === 'many',
        side: 'left',
      });
    }
  }
  for (const outputId of operation.outputIds) {
    const output = resolved.card.outputs.find((candidate) => candidate.id === outputId);
    if (!output) continue;
    ports.push({
      id: modelCardOutputHandle(output.id),
      direction: 'output',
      label: output.label,
      help: `${output.label} from ${operation.label}.`,
      types: [outputFlowType(output)],
      required: false,
      minConnections: 0,
      maxConnections: null,
      ordered: output.cardinality === 'many',
      side: 'right',
    });
  }
  return ports;
}

export function migrateModelCardOperationEdges(input: {
  nodeId: string;
  edges: readonly Edge[];
  card: FlowModelCardV1;
  previousOperationId: string;
  nextOperationId: string;
}): Edge[] {
  const previous = input.card.operations.find((operation) => operation.id === input.previousOperationId);
  const next = input.card.operations.find((operation) => operation.id === input.nextOperationId);
  if (!previous || !next) return [...input.edges];
  return input.edges.map((edge) => {
    if (edge.target === input.nodeId) {
      const parsed = parseInputHandle(edge.targetHandle);
      if (!parsed) return edge;
      const oldField = input.card.fields.find((field) => field.id === parsed.fieldId);
      const candidates = next.inputPortFieldIds
        .map((fieldId) => input.card.fields.find((field) => field.id === fieldId))
        .filter((field): field is ModelFieldV1 => Boolean(field))
        .filter((field) =>
          oldField
          && field.semanticRole === oldField.semanticRole
          && field.valueType === oldField.valueType
        );
      const replacement = candidates[0];
      const maximum = replacement?.constraints?.maxItems ?? replacement?.constraints?.visiblePortCount ?? 1;
      if (replacement && parsed.index < maximum) {
        return clearRemapStub({
          ...edge,
          targetHandle: modelCardInputHandle(
            replacement.id,
            replacement.cardinality === 'many' ? parsed.index : undefined,
          ),
        });
      }
      return withRemapStub(edge, {
        state: 'needs-remapping',
        previousOperationId: previous.id,
        nextOperationId: next.id,
        semanticRole: oldField?.semanticRole,
        index: parsed.index,
        message: `${oldField?.label ?? parsed.fieldId} is not accepted by ${next.label}. Choose a new input port.`,
      });
    }
    if (edge.source === input.nodeId) {
      const outputId = parseOutputHandle(edge.sourceHandle);
      if (!outputId) return edge;
      const oldOutput = input.card.outputs.find((output) => output.id === outputId);
      const replacement = next.outputIds
        .map((id) => input.card.outputs.find((output) => output.id === id))
        .find((output) =>
          oldOutput
          && output?.semanticRole === oldOutput.semanticRole
          && output.resultType === oldOutput.resultType
        );
      if (replacement) {
        return clearRemapStub({ ...edge, sourceHandle: modelCardOutputHandle(replacement.id) });
      }
      return withRemapStub(edge, {
        state: 'needs-remapping',
        previousOperationId: previous.id,
        nextOperationId: next.id,
        semanticRole: oldOutput?.semanticRole,
        index: 0,
        message: `${oldOutput?.label ?? outputId} is not produced by ${next.label}. Choose a new output port.`,
      });
    }
    return edge;
  });
}

export function listNeedsRemappingEdges(edges: readonly Edge[]): Array<Edge & { data: { modelCardRemap: ModelCardEdgeRemapStub } }> {
  return edges.filter((edge): edge is Edge & { data: { modelCardRemap: ModelCardEdgeRemapStub } } =>
    isRecord(edge.data)
    && isRecord(edge.data.modelCardRemap)
    && edge.data.modelCardRemap.state === 'needs-remapping'
  );
}

function fieldFlowType(field: ModelFieldV1): FlowDataType {
  if (field.valueType === 'image') return { kind: 'image' };
  if (field.valueType === 'video') return { kind: 'video' };
  if (field.valueType === 'audio') return { kind: 'audio' };
  if (field.valueType === 'number' || field.valueType === 'integer') return { kind: 'number' };
  if (field.valueType === 'boolean') return { kind: 'boolean' };
  if (field.valueType === 'json' || field.valueType === 'binary') return { kind: 'json' };
  return { kind: 'text' };
}

function outputFlowType(output: ModelOutputV1): FlowDataType {
  if (output.cardinality === 'many' || output.resultType === 'list') {
    const itemKind = output.resultType === 'list'
      ? 'mixed'
      : output.resultType;
    return { kind: 'list', item: { kind: itemKind } };
  }
  return { kind: output.resultType };
}

function parseInputHandle(handle: string | null | undefined): { fieldId: string; index: number } | null {
  const match = /^model-card:(.+?)(?::(\d+))?$/.exec(handle ?? '');
  return match ? { fieldId: match[1], index: Number(match[2] ?? 0) } : null;
}

function parseOutputHandle(handle: string | null | undefined): string | null {
  return /^model-card-output:(.+)$/.exec(handle ?? '')?.[1] ?? null;
}

function parseModelCardRef(value: unknown): ModelCardRefV1 | null {
  if (
    !isRecord(value)
    || typeof value.packId !== 'string'
    || typeof value.version !== 'string'
    || typeof value.hash !== 'string'
    || typeof value.cardId !== 'string'
  ) {
    return null;
  }
  return value as unknown as ModelCardRefV1;
}

function withRemapStub(edge: Edge, stub: ModelCardEdgeRemapStub): Edge {
  return {
    ...edge,
    animated: true,
    style: { ...edge.style, stroke: '#f59e0b', strokeDasharray: '6 4' },
    data: { ...(isRecord(edge.data) ? edge.data : {}), modelCardRemap: stub },
  };
}

function clearRemapStub(edge: Edge): Edge {
  if (!isRecord(edge.data) || !('modelCardRemap' in edge.data)) return edge;
  const { modelCardRemap: _removed, ...rest } = edge.data;
  return {
    ...edge,
    data: rest,
    animated: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
