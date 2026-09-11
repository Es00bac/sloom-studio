import type { EditorSourceKind, FlowNodeType, NodeData } from '../types/flow';
import {
  getGeminiTextMediaPrompt,
  isGeminiTextMediaInputSupported,
} from './geminiTextModel';

export interface SourceBinFlowItem {
  id: string;
  label?: string;
  kind: EditorSourceKind;
  assetId?: string;
  assetUrl?: string;
  mimeType?: string;
  text?: string;
}

type FlowSourceRestoreData = Partial<Pick<
  NodeData,
  | 'mediaMode'
  | 'sourceBinItemId'
  | 'sourceAssetId'
  | 'sourceAssetUrl'
  | 'sourceAssetName'
  | 'sourceAssetMimeType'
  | 'textVisionSourceItemId'
>>;

function normalizeSourceReference(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isAssetSourceBinItem(item: SourceBinFlowItem): boolean {
  return item.kind !== 'text' && Boolean(item.assetUrl || item.assetId || item.mimeType);
}

function findRestoredSourceBinItem(
  data: FlowSourceRestoreData,
  sourceBinItems: SourceBinFlowItem[],
): SourceBinFlowItem | undefined {
  const assetItems = sourceBinItems.filter(isAssetSourceBinItem);
  const directItemId =
    normalizeSourceReference(data.sourceBinItemId) ??
    normalizeSourceReference(data.textVisionSourceItemId);

  if (directItemId) {
    const directItem = assetItems.find((item) => item.id === directItemId);
    if (directItem) {
      return directItem;
    }
  }

  const sourceAssetId = normalizeSourceReference(data.sourceAssetId);
  if (sourceAssetId) {
    const assetMatch = assetItems.find((item) => item.assetId === sourceAssetId);
    if (assetMatch) {
      return assetMatch;
    }
  }

  const sourceAssetUrl = normalizeSourceReference(data.sourceAssetUrl);
  if (sourceAssetUrl) {
    const urlMatch = assetItems.find((item) => item.assetUrl === sourceAssetUrl);
    if (urlMatch) {
      return urlMatch;
    }
  }

  const sourceAssetName = normalizeSourceReference(data.sourceAssetName);
  const sourceAssetMimeType = normalizeSourceReference(data.sourceAssetMimeType);
  if (sourceAssetName && sourceAssetMimeType) {
    return assetItems.find((item) => (
      item.label === sourceAssetName &&
      item.mimeType === sourceAssetMimeType
    ));
  }

  return undefined;
}

export function buildFlowNodePatchForRestoredSourceBinItem(
  data: FlowSourceRestoreData,
  sourceBinItems: SourceBinFlowItem[],
): Partial<NodeData> | undefined {
  const restoredItem = findRestoredSourceBinItem(data, sourceBinItems);

  if (!restoredItem) {
    return undefined;
  }

  return {
    sourceBinItemId: restoredItem.id,
    ...(restoredItem.assetId ? { sourceAssetId: restoredItem.assetId } : {}),
    ...(restoredItem.assetUrl ? { sourceAssetUrl: restoredItem.assetUrl } : {}),
    ...(restoredItem.label ? { sourceAssetName: restoredItem.label } : {}),
    ...(restoredItem.mimeType ? { sourceAssetMimeType: restoredItem.mimeType } : {}),
  };
}

export function getFlowNodeTypeForSourceBinItem(
  item: Pick<SourceBinFlowItem, 'kind'>,
): FlowNodeType {
  switch (item.kind) {
    case 'image':
      return 'imageGen';
    case 'video':
    case 'composition':
      return 'videoGen';
    case 'audio':
      return 'audioGen';
    case 'text':
    case 'document':
    case 'subtitle':
    case 'package':
      return 'textNode';
  }
}

export function buildFlowNodePatchForSourceBinItem(
  item: SourceBinFlowItem,
): Partial<NodeData> {
  if (
    (item.kind === 'document' || item.kind === 'subtitle') &&
    item.assetUrl &&
    isGeminiTextMediaInputSupported({
      kind: item.kind,
      mimeType: item.mimeType,
    })
  ) {
    return {
      mode: 'generate',
      prompt: getGeminiTextMediaPrompt(item.kind),
      sourceBinItemId: item.id,
      textVisionSourceItemId: item.id,
      sourceAssetId: item.assetId,
      sourceAssetUrl: item.assetUrl,
      sourceAssetName: item.label,
      sourceAssetMimeType: item.mimeType,
    };
  }

  if (item.kind === 'text' || item.kind === 'document' || item.kind === 'subtitle' || item.kind === 'package') {
    return {
      mode: 'prompt',
      prompt: item.text ?? item.label ?? item.assetUrl ?? '',
    };
  }

  return {
    mediaMode: 'import',
    sourceBinItemId: item.id,
    sourceAssetId: item.assetId,
    sourceAssetUrl: item.assetUrl,
    sourceAssetName: item.label,
    sourceAssetMimeType: item.mimeType,
  };
}
