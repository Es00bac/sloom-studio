import type { FlowNodeType, ResultType } from '../types/flow';

export type FlowAtomicDataKind =
  | 'text'
  | 'number'
  | 'boolean'
  | 'json'
  | 'image'
  | 'video'
  | 'audio'
  | 'package'
  | 'control'
  | 'unknown';

export interface FlowAtomicDataType {
  kind: FlowAtomicDataKind;
}

export interface FlowMixedDataType {
  kind: 'mixed';
}

export interface FlowContainerDataType {
  kind: 'list' | 'envelope';
  item: FlowDataType | FlowMixedDataType;
}

export type FlowDataType = FlowAtomicDataType | FlowContainerDataType;

export interface FlowTypeCompatibility {
  compatible: boolean;
  source: FlowDataType;
  accepted: readonly FlowDataType[];
  reason?: string;
  converterNodeTypes?: readonly FlowNodeType[];
}

export type FlowLinePattern = 'solid' | 'container' | 'control' | 'unknown';

export interface FlowTypeLineStyle {
  color: string;
  pattern: FlowLinePattern;
  strokeWidth: number;
  dashArray?: string;
}

const TYPE_COLORS: Record<FlowAtomicDataKind | 'mixed', string> = {
  text: '#22d3ee',
  number: '#f59e0b',
  boolean: '#fb7185',
  json: '#a78bfa',
  image: '#34d399',
  video: '#60a5fa',
  audio: '#f472b6',
  package: '#fb923c',
  control: '#e2e8f0',
  unknown: '#9ca3af',
  mixed: '#9ca3af',
};

export function flowDataTypeEquals(left: FlowDataType, right: FlowDataType): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== 'list' && left.kind !== 'envelope') return true;
  if (right.kind !== 'list' && right.kind !== 'envelope') return false;
  return flowContainerItemEquals(left.item, right.item);
}

export function isFlowTypeAccepted(
  source: FlowDataType,
  accepted: readonly FlowDataType[],
): FlowTypeCompatibility {
  if (accepted.some((candidate) => flowDataTypeEquals(source, candidate))) {
    return { compatible: true, source, accepted };
  }

  const acceptedLabel = accepted.length > 0
    ? accepted.map(describeFlowDataType).join(' or ')
    : 'no value';

  return {
    compatible: false,
    source,
    accepted,
    reason: `${describeFlowDataType(source)} cannot connect to ${acceptedLabel}`,
    converterNodeTypes: suggestConverterNodeTypes(source, accepted),
  };
}

export function describeFlowDataType(type: FlowDataType | FlowMixedDataType): string {
  if (type.kind === 'list' || type.kind === 'envelope') {
    return `${type.kind}<${describeFlowDataType(type.item)}>`;
  }
  return type.kind;
}

export function flowDataTypeColor(type: FlowDataType | FlowMixedDataType): string {
  if (type.kind === 'list' || type.kind === 'envelope') {
    return flowDataTypeColor(type.item);
  }
  return TYPE_COLORS[type.kind];
}

export function flowTypeLineStyle(type: FlowDataType): FlowTypeLineStyle {
  if (type.kind === 'list' || type.kind === 'envelope') {
    return {
      color: flowDataTypeColor(type),
      pattern: 'container',
      strokeWidth: 2.5,
      dashArray: '8 4 2 4',
    };
  }
  if (type.kind === 'control') {
    return { color: flowDataTypeColor(type), pattern: 'control', strokeWidth: 2.5, dashArray: '3 3' };
  }
  if (type.kind === 'unknown') {
    return { color: flowDataTypeColor(type), pattern: 'unknown', strokeWidth: 2, dashArray: '2 5' };
  }
  return { color: flowDataTypeColor(type), pattern: 'solid', strokeWidth: 2.5 };
}

export function runtimeTypeFromResultType(type: ResultType): FlowDataType {
  if (type === 'list' || type === 'envelope') {
    return { kind: type, item: { kind: 'mixed' } };
  }
  return { kind: type };
}

export function resultTypeFromRuntimeType(type: FlowDataType): ResultType | undefined {
  if (type.kind === 'control' || type.kind === 'unknown') return undefined;
  return type.kind;
}

function flowContainerItemEquals(
  left: FlowDataType | FlowMixedDataType,
  right: FlowDataType | FlowMixedDataType,
): boolean {
  if (left.kind === 'mixed' || right.kind === 'mixed') return left.kind === right.kind;
  return flowDataTypeEquals(left, right);
}

function suggestConverterNodeTypes(
  source: FlowDataType,
  accepted: readonly FlowDataType[],
): readonly FlowNodeType[] {
  if (source.kind === 'control' || source.kind === 'unknown' || accepted.length === 0) return [];

  if (source.kind === 'text' && accepted.some((type) => type.kind === 'list')) {
    return ['csvParserNode', 'javascriptNode'];
  }
  if (source.kind === 'json' && accepted.some((type) => type.kind === 'text')) {
    return ['xmlYamlNode', 'javascriptNode'];
  }
  return ['javascriptNode'];
}
