import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type {
  EditorSourceKind,
  EnvelopeItem,
  FlowNodeType,
  NodeData,
  NodeOutputArtifact,
  NodeResultAttempt,
  ResultType,
} from '../types/flow';

export type RestorableSourceBinItem = SourceBinLibraryItem & { assetUrl?: string };

const VALID_RESULT_TYPES = new Set<ResultType>(['text', 'number', 'boolean', 'json', 'image', 'video', 'audio', 'package', 'list', 'envelope']);
const GENERATED_RESULT_TYPES_BY_NODE: Partial<Record<FlowNodeType, readonly ResultType[]>> = {
  imageGen: ['image'],
  cropImageNode: ['image'],
  videoGen: ['video'],
  audioGen: ['audio'],
  composition: ['video'],
  packageNode: ['package'],
};

export function resultTypeForSourceKind(kind: EditorSourceKind): ResultType | undefined {
  switch (kind) {
    case 'text':
    case 'document':
    case 'subtitle':
      return 'text';
    case 'image':
      return 'image';
    case 'video':
    case 'composition':
      return 'video';
    case 'audio':
      return 'audio';
    case 'package':
      return 'package';
  }
}

export function sourceBinItemBelongsToFlowNode(item: Pick<RestorableSourceBinItem, 'originNodeId' | 'envelopeId'>, nodeId: string): boolean {
  return (
    item.originNodeId === nodeId ||
    item.envelopeId === nodeId ||
    Boolean(item.originNodeId?.startsWith(`${nodeId}:`))
  );
}

export function sourceBinItemValue(item: RestorableSourceBinItem): string | undefined {
  if (item.kind === 'text') {
    return item.text ?? item.assetUrl;
  }

  return item.assetUrl;
}

export function sourceBinItemToResultAttempt(item: RestorableSourceBinItem, index: number): NodeResultAttempt | undefined {
  const result = sourceBinItemValue(item);
  const resultType = resultTypeForSourceKind(item.kind);
  if (!result || !resultType) return undefined;

  return {
    id: `source-${item.id || index}`,
    result,
    resultType,
    statusMessage: `Restored ${item.label || resultType} from project source bin`,
    createdAt: new Date(item.createdAt || 0).toISOString(),
    sourceBinItemId: item.id || undefined,
  };
}

export function sourceBinItemToEnvelopeItem(item: RestorableSourceBinItem, index: number): EnvelopeItem | undefined {
  const value = sourceBinItemValue(item);
  const kind = resultTypeForSourceKind(item.kind);
  if (!value || !kind) return undefined;

  return {
    id: item.id || `source-envelope-${index}`,
    index: item.envelopeIndex ?? index,
    kind,
    label: item.label || `Envelope item ${index + 1}`,
    value,
    mimeType: item.mimeType,
    sourceBinItemId: item.id,
    sourceNodeId: item.originNodeId,
  };
}

function sortRestorableItems(items: RestorableSourceBinItem[]): RestorableSourceBinItem[] {
  return items
    .slice()
    .sort((a, b) => (a.envelopeIndex ?? a.createdAt ?? 0) - (b.envelopeIndex ?? b.createdAt ?? 0));
}

function isNodeResultAttempt(value: unknown): value is NodeResultAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attempt = value as Partial<NodeResultAttempt>;
  return (
    typeof attempt.id === 'string' &&
    typeof attempt.resultType === 'string' &&
    VALID_RESULT_TYPES.has(attempt.resultType as ResultType) &&
    (attempt.resultType === 'boolean'
      ? typeof attempt.result === 'boolean'
      : typeof attempt.result === 'string' && attempt.result.length > 0) &&
    typeof attempt.statusMessage === 'string' &&
    typeof attempt.createdAt === 'string'
  );
}

function selectAttempt(history: NodeResultAttempt[], selectedResultId: unknown): NodeResultAttempt | undefined {
  if (history.length === 0) return undefined;
  return (
    typeof selectedResultId === 'string'
      ? history.find((attempt) => attempt.id === selectedResultId)
      : undefined
  ) ?? history[history.length - 1];
}

export function collectSourceBinItemsForFlowNode(
  nodeId: string,
  sourceBinItems: RestorableSourceBinItem[],
): RestorableSourceBinItem[] {
  return sortRestorableItems(sourceBinItems.filter((item) => sourceBinItemBelongsToFlowNode(item, nodeId)));
}

export function rebindNodeOutputAssetsToSourceBin(
  outputs: Record<string, NodeOutputArtifact> | undefined,
  sourceBinItems: RestorableSourceBinItem[],
): Record<string, NodeOutputArtifact> | undefined {
  if (!outputs) return undefined;
  const itemsById = new Map(sourceBinItems.map((item) => [item.id, item]));
  return Object.fromEntries(Object.entries(outputs).map(([handle, output]) => {
    const sourceItem = output.sourceBinItemId ? itemsById.get(output.sourceBinItemId) : undefined;
    const restoredValue = sourceItem ? sourceBinItemValue(sourceItem) : undefined;
    return [handle, restoredValue ? {
      ...output,
      result: restoredValue,
      mimeType: sourceItem?.mimeType ?? output.mimeType,
      assetKind: sourceItem?.kind ?? output.assetKind,
    } : output];
  }));
}

export function buildFlowNodeGeneratedResultPatch(
  nodeId: string,
  nodeType: FlowNodeType,
  data: NodeData,
  sourceBinItems: RestorableSourceBinItem[],
  options: { replaceExistingHistory?: boolean } = {},
): Partial<NodeData> | undefined {
  const sourceItems = collectSourceBinItemsForFlowNode(nodeId, sourceBinItems);
  if (sourceItems.length === 0) return undefined;

  const compatibleResultTypes = GENERATED_RESULT_TYPES_BY_NODE[nodeType];
  if (!compatibleResultTypes) return undefined;

  const compatibleSourceItems = sourceItems.filter((item) => {
    const resultType = resultTypeForSourceKind(item.kind);
    return resultType !== undefined && compatibleResultTypes.includes(resultType);
  });
  const sourceHistory = compatibleSourceItems
    .map((item, index) => sourceBinItemToResultAttempt(item, index))
    .filter((attempt): attempt is NodeResultAttempt => Boolean(attempt));
  const existingHistory = Array.isArray(data.resultHistory)
    ? data.resultHistory.filter(isNodeResultAttempt)
    : [];
  const history = options.replaceExistingHistory || existingHistory.length === 0
    ? sourceHistory
    : existingHistory;
  const patch: Partial<NodeData> = {};

  if (history.length > 0) {
    const selected = selectAttempt(history, data.selectedResultId);

    patch.resultHistory = history;
    if (selected) {
      patch.selectedResultId = selected.id;
      patch.result = selected.result;
      patch.resultType = selected.resultType;
      patch.usage = selected.usage;
      patch.statusMessage = selected.statusMessage;
      patch.error = undefined;
    }
  }

  const sourceEnvelopeItems = compatibleSourceItems.filter((item) => item.envelopeId || item.envelopeIndex !== undefined);
  const existingEnvelopeItems = Array.isArray(data.envelopeItems) ? data.envelopeItems : [];
  if ((options.replaceExistingHistory || existingEnvelopeItems.length === 0) && sourceEnvelopeItems.length > 0) {
    const envelopeItems = sourceEnvelopeItems
      .map((item, index) => sourceBinItemToEnvelopeItem(item, index))
      .filter((item): item is EnvelopeItem => Boolean(item));

    if (envelopeItems.length > 0) {
      patch.envelopeItems = envelopeItems;
    }
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}
