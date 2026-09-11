import type { Edge } from '@xyflow/react';
import type { AppNode, EnvelopeItem, NodeResultAttempt, ResultType } from '../types/flow';
import {
  buildListNodeItems,
  collectEnvelopeItemsForEnvelopeNode,
  getValidListNodeItems,
  type FlowListItem,
} from './listNodes';
import { restoreResultValue, serializeResultValueForContainer } from './flowResultValues';

export interface FlowVariableDiagnostic {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  nodeId?: string;
  suggestedFix?: string;
  blocksRun: boolean;
}

export interface FlowVariableItem {
  id: string;
  position: number;
  kind: ResultType;
  label: string;
  value: string;
  mimeType?: string;
  sourceNodeId?: string;
}

export interface FlowVariableBinding {
  name: string;
  nodeId: string;
  kind: ResultType;
  label: string;
  value?: string;
  mimeType?: string;
  sourceNodeId?: string;
  attemptId?: string;
  items?: FlowVariableItem[];
}

export interface FlowVariableResolution {
  text: string;
  diagnostics: FlowVariableDiagnostic[];
}

export interface FlowVariableAutocompleteSuggestion {
  insertText: string;
  label: string;
  detail: string;
  kind: ResultType;
}

export interface FlowVariableAutocompleteState {
  query: string;
  replaceRange: { start: number; end: number };
  suggestions: FlowVariableAutocompleteSuggestion[];
}

const FLOW_VARIABLE_REFERENCE_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\[(?:\d+|\*)\])?(?:\.[A-Za-z][A-Za-z0-9_]*)?)\s*\}\}/g;
const LOCAL_TEMPLATE_TOKENS = new Set(['a', 'b', 'c']);

export function normalizeFlowVariableName(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    return '';
  }

  return /^[a-z_]/.test(normalized) ? normalized : `v_${normalized}`;
}

export function collectFlowVariableBindings(nodes: AppNode[], edges: Edge[]): FlowVariableBinding[] {
  const bindings: FlowVariableBinding[] = [];

  for (const node of nodes) {
    const attemptBindings = collectAttemptBindings(node);
    bindings.push(...attemptBindings);

    const collectionName = normalizeFlowVariableName(node.data.flowVariableName);
    if (!collectionName) {
      continue;
    }

    if (node.type === 'list') {
      bindings.push({
        name: collectionName,
        nodeId: node.id,
        kind: 'list',
        label: node.data.customTitle ?? collectionName,
        items: getValidListNodeItems(buildListNodeItems(node.id, nodes, edges)).map(flowListItemToVariableItem),
      });
      continue;
    }

    if (node.type === 'envelope') {
      bindings.push({
        name: collectionName,
        nodeId: node.id,
        kind: 'envelope',
        label: node.data.customTitle ?? collectionName,
        items: collectEnvelopeItemsForEnvelopeNode(node.id, nodes, edges)
          .filter((item) => !item.invalidReason)
          .map(envelopeItemToVariableItem),
      });
    }
  }

  return bindings;
}

export function resolveFlowVariablesInText(
  text: string,
  nodes: AppNode[],
  edges: Edge[],
): FlowVariableResolution {
  const bindings = collectFlowVariableBindings(nodes, edges);
  const diagnostics: FlowVariableDiagnostic[] = [];
  const rendered = text.replace(FLOW_VARIABLE_REFERENCE_PATTERN, (token, rawReference: string) => {
    const resolution = resolveFlowVariableReference(rawReference, bindings);

    if (!resolution) {
      return token;
    }

    if (!resolution.ok) {
      diagnostics.push(resolution.diagnostic);
      return token;
    }

    return resolution.value;
  });

  return { text: rendered, diagnostics };
}

export function getFlowVariableAutocompleteState(
  text: string,
  cursorIndex: number,
  bindings: FlowVariableBinding[],
): FlowVariableAutocompleteState | undefined {
  const safeCursor = Math.max(0, Math.min(text.length, cursorIndex));
  const beforeCursor = text.slice(0, safeCursor);
  const tokenStart = beforeCursor.lastIndexOf('{{');

  if (tokenStart < 0) {
    return undefined;
  }

  const afterStart = beforeCursor.slice(tokenStart + 2);
  if (afterStart.includes('}}') || /\s/.test(afterStart)) {
    return undefined;
  }

  const query = afterStart.trim().toLowerCase();
  const suggestions = buildAutocompleteSuggestions(bindings)
    .filter((suggestion) => suggestion.insertText.toLowerCase().includes(query))
    .slice(0, 12);

  if (suggestions.length === 0) {
    return undefined;
  }

  return {
    query,
    replaceRange: { start: tokenStart, end: safeCursor },
    suggestions,
  };
}

export function applyFlowVariableAutocompleteSuggestion(
  text: string,
  replaceRange: { start: number; end: number },
  insertText: string,
): { text: string; cursorIndex: number } {
  const nextText = `${text.slice(0, replaceRange.start)}${insertText}${text.slice(replaceRange.end)}`;
  return {
    text: nextText,
    cursorIndex: replaceRange.start + insertText.length,
  };
}

export function assignVariableToResultAttempt(
  attempts: NodeResultAttempt[] | undefined,
  attemptId: string,
  rawVariableName: string,
): NodeResultAttempt[] {
  const variableName = normalizeFlowVariableName(rawVariableName);
  return (Array.isArray(attempts) ? attempts : []).map((attempt) => attempt.id === attemptId
    ? {
      ...attempt,
      variableName: variableName || undefined,
    }
    : attempt);
}

function collectAttemptBindings(node: AppNode): FlowVariableBinding[] {
  if (!Array.isArray(node.data.resultHistory)) {
    return [];
  }

  return node.data.resultHistory.flatMap((attempt, attemptIndex) => {
    const name = normalizeFlowVariableName(attempt.variableName);
    if (!name) {
      return [];
    }

    let value: string;
    try {
      // Variable substitution is a text/presentation boundary. Keep the
      // attempt itself typed, including a false decision, and serialize only
      // the rendered reference.
      const result = restoreResultValue(attempt.result, attempt.resultType);
      if (result === undefined) return [];
      value = serializeResultValueForContainer(result, attempt.resultType);
    } catch {
      return [];
    }

    return [{
      name,
      nodeId: node.id,
      kind: attempt.resultType,
      label: node.data.customTitle ?? `${node.type} run ${attemptIndex + 1}`,
      value,
      sourceNodeId: node.id,
      attemptId: attempt.id,
    }];
  });
}

function flowListItemToVariableItem(item: FlowListItem): FlowVariableItem {
  return {
    id: item.id,
    position: item.index + 1,
    kind: item.kind,
    label: item.label,
    value: item.kind === 'package' ? item.text ?? item.value : item.value,
    mimeType: item.mimeType,
    sourceNodeId: item.nodeId,
  };
}

function envelopeItemToVariableItem(item: EnvelopeItem): FlowVariableItem {
  return {
    id: item.id,
    position: item.index + 1,
    kind: item.kind,
    label: item.label,
    value: item.kind === 'package' ? item.text ?? item.value : item.value,
    mimeType: item.mimeType,
    sourceNodeId: item.sourceNodeId,
  };
}

type ReferenceParseResult = {
  name: string;
  index?: number;
  allItems: boolean;
  property?: string;
};

function resolveFlowVariableReference(
  rawReference: string,
  bindings: FlowVariableBinding[],
): { ok: true; value: string } | { ok: false; diagnostic: FlowVariableDiagnostic } | undefined {
  const parsed = parseFlowVariableReference(rawReference);
  if (!parsed) {
    return undefined;
  }

  if (LOCAL_TEMPLATE_TOKENS.has(parsed.name) && !bindings.some((binding) => binding.name === parsed.name)) {
    return undefined;
  }

  const binding = [...bindings].reverse().find((candidate) => candidate.name === parsed.name);
  if (!binding) {
    return missingDiagnostic(parsed.name);
  }

  if (binding.items) {
    return resolveCollectionReference(binding, parsed);
  }

  if (parsed.index !== undefined || parsed.allItems) {
    return invalidDiagnostic(parsed.name, `Variable "${parsed.name}" is not a list or envelope.`);
  }

  return { ok: true, value: resolveBindingProperty(binding, parsed.property) };
}

function resolveCollectionReference(
  binding: FlowVariableBinding,
  parsed: ReferenceParseResult,
): { ok: true; value: string } | { ok: false; diagnostic: FlowVariableDiagnostic } {
  const items = binding.items ?? [];

  if (parsed.property === 'length' && parsed.index === undefined && !parsed.allItems) {
    return { ok: true, value: String(items.length) };
  }

  if (parsed.allItems) {
    return { ok: true, value: items.map((item) => resolveItemProperty(item, parsed.property)).join('\n\n') };
  }

  if (parsed.index === undefined) {
    if (parsed.property) {
      return invalidDiagnostic(parsed.name, `Variable "${parsed.name}" needs an item index before ".${parsed.property}".`);
    }
    return { ok: true, value: items.map((item) => item.value).join('\n\n') };
  }

  const item = items.find((candidate) => candidate.position === parsed.index);
  if (!item) {
    return invalidDiagnostic(parsed.name, `Variable "${parsed.name}" has no item at position ${parsed.index}.`);
  }

  return { ok: true, value: resolveItemProperty(item, parsed.property) };
}

function parseFlowVariableReference(rawReference: string): ReferenceParseResult | undefined {
  const match = rawReference.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+|\*)\])?(?:\.([A-Za-z][A-Za-z0-9_]*))?$/);
  if (!match) {
    return undefined;
  }

  return {
    name: normalizeFlowVariableName(match[1]),
    index: match[2] && match[2] !== '*' ? Number(match[2]) : undefined,
    allItems: match[2] === '*',
    property: match[3],
  };
}

function resolveBindingProperty(binding: FlowVariableBinding, property: string | undefined): string {
  switch (property) {
    case undefined:
    case 'value':
      return binding.value ?? '';
    case 'label':
      return binding.label;
    case 'kind':
      return binding.kind;
    case 'mimeType':
      return binding.mimeType ?? '';
    case 'sourceNodeId':
      return binding.sourceNodeId ?? binding.nodeId;
    default:
      return binding.value ?? '';
  }
}

function resolveItemProperty(item: FlowVariableItem, property: string | undefined): string {
  switch (property) {
    case undefined:
    case 'value':
      return item.value;
    case 'label':
      return item.label;
    case 'kind':
      return item.kind;
    case 'position':
      return String(item.position);
    case 'mimeType':
      return item.mimeType ?? '';
    case 'sourceNodeId':
      return item.sourceNodeId ?? '';
    default:
      return item.value;
  }
}

function buildAutocompleteSuggestions(bindings: FlowVariableBinding[]): FlowVariableAutocompleteSuggestion[] {
  const dedupedBindings = [...new Map(bindings.map((binding) => [binding.name, binding])).values()];

  return dedupedBindings.flatMap((binding) => {
    const isCollection = Array.isArray(binding.items);
    const base: FlowVariableAutocompleteSuggestion = {
      insertText: isCollection ? `{{${binding.name}[*]}}` : `{{${binding.name}}}`,
      label: isCollection ? `${binding.name}[*]` : binding.name,
      detail: isCollection ? `${binding.kind} all items` : binding.kind,
      kind: binding.kind,
    };
    const itemSuggestions = (binding.items ?? []).slice(0, 8).map((item) => ({
      insertText: `{{${binding.name}[${item.position}]}}`,
      label: `${binding.name}[${item.position}]`,
      detail: item.label,
      kind: item.kind,
    }));

    return [base, ...itemSuggestions];
  });
}

function missingDiagnostic(name: string): { ok: false; diagnostic: FlowVariableDiagnostic } {
  return invalidDiagnostic(name, `Flow variable "${name}" is not declared.`);
}

function invalidDiagnostic(name: string, message: string): { ok: false; diagnostic: FlowVariableDiagnostic } {
  return {
    ok: false,
    diagnostic: {
      id: `flow-variable-${name}`,
      severity: 'critical',
      message,
      suggestedFix: 'Assign the variable on a generated result, list, or envelope, or remove the template reference.',
      blocksRun: true,
    },
  };
}
