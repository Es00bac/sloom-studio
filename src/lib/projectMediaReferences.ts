import type { AppNode, EnvelopeItem } from '../types/flow';
import type { PaperDocument, PaperFrame, PaperFrameAsset } from '../types/paper';
import type { SourceBinLibraryItem, SourceBinProjectSnapshot } from '../store/sourceBinStore';
import type { FlowProjectDocument } from './projectLibrary';
import { buildMediaAssetSignaturePart } from './mediaAssetSignature';
import { buildPaperFrameAssetFromSourceItem } from './paperAssetReferences';
import { collectReachablePaperAssetIds } from '../features/paper/assets/PaperDocumentAssets';

export interface ProjectMediaReferenceStats {
  paperEmbeddedMediaReplaced: number;
  paperEmbeddedMediaUnmatched: number;
  flowEmbeddedMediaReplaced: number;
  flowEmbeddedMediaUnmatched: number;
}

interface SourceItemIndex {
  byId: Map<string, SourceBinLibraryItem>;
  bySourceKey: Map<string, SourceBinLibraryItem>;
  byOriginNodeId: Map<string, SourceBinLibraryItem[]>;
  byMediaSignature: Map<string, SourceBinLibraryItem[]>;
}

const EMPTY_STATS: ProjectMediaReferenceStats = {
  paperEmbeddedMediaReplaced: 0,
  paperEmbeddedMediaUnmatched: 0,
  flowEmbeddedMediaReplaced: 0,
  flowEmbeddedMediaUnmatched: 0,
};

export function normalizeProjectMediaReferencesForSave(document: FlowProjectDocument): {
  document: FlowProjectDocument;
  stats: ProjectMediaReferenceStats;
} {
  const sourceIndex = buildSourceItemIndex(collectSourceItemsFromSnapshot(document.sourceBin));
  const stats = { ...EMPTY_STATS };

  return {
    document: {
      ...document,
      flow: normalizeFlowMediaReferences(document.flow, sourceIndex, stats),
      flowWorkspaces: normalizeFlowWorkspaceMediaReferences(document.flowWorkspaces, sourceIndex, stats),
      paper: normalizePaperMediaReferences(document.paper, sourceIndex, stats),
    },
    stats,
  };
}

export function resolveProjectMediaReferencesForRestore(
  document: FlowProjectDocument,
  sourceItems: readonly SourceBinLibraryItem[],
): FlowProjectDocument {
  const sourceIndex = buildSourceItemIndex(sourceItems);
  const stats = { ...EMPTY_STATS };

  return {
    ...document,
    flow: normalizeFlowMediaReferences(document.flow, sourceIndex, stats),
    flowWorkspaces: normalizeFlowWorkspaceMediaReferences(document.flowWorkspaces, sourceIndex, stats),
    paper: normalizePaperMediaReferences(document.paper, sourceIndex, stats),
  };
}

export function collectSourceItemsFromSnapshot(snapshot: SourceBinProjectSnapshot | undefined): SourceBinLibraryItem[] {
  if (!snapshot) {
    return [];
  }

  const binnedItems = Array.isArray(snapshot.bins)
    ? snapshot.bins.flatMap((bin) => Array.isArray(bin.items) ? bin.items : [])
    : [];
  const flatItems = Array.isArray(snapshot.items) ? snapshot.items : [];
  const deduped = new Map<string, SourceBinLibraryItem>();

  for (const item of [...binnedItems, ...flatItems]) {
    if (item?.id && !deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  }

  return [...deduped.values()];
}

function normalizeFlowMediaReferences(
  flow: FlowProjectDocument['flow'],
  sourceIndex: SourceItemIndex,
  stats: ProjectMediaReferenceStats,
): FlowProjectDocument['flow'] {
  return {
    ...flow,
    nodes: flow.nodes.map((node) => normalizeFlowNodeMediaReferences(node, sourceIndex, stats)),
  };
}

function normalizeFlowWorkspaceMediaReferences(
  flowWorkspaces: FlowProjectDocument['flowWorkspaces'],
  sourceIndex: SourceItemIndex,
  stats: ProjectMediaReferenceStats,
): FlowProjectDocument['flowWorkspaces'] {
  if (!flowWorkspaces || flowWorkspaces.length === 0) {
    return flowWorkspaces;
  }

  return flowWorkspaces.map((workspace) => ({
    ...workspace,
    flow: normalizeFlowMediaReferences(workspace.flow, sourceIndex, stats),
  }));
}

function normalizeFlowNodeMediaReferences(
  node: AppNode,
  sourceIndex: SourceItemIndex,
  stats: ProjectMediaReferenceStats,
): AppNode {
  // Exclude generator and composition nodes from having their envelopeItems normalized
  if (['imageGen', 'cropImageNode', 'videoGen', 'audioGen', 'composition'].includes(node.type)) {
    return node;
  }

  const envelopeItems = node.data.envelopeItems;

  if (!Array.isArray(envelopeItems) || envelopeItems.length === 0) {
    return node;
  }

  let changed = false;
  const nextEnvelopeItems = envelopeItems.map((item, fallbackIndex) => {
    if (!isEnvelopeItemLike(item)) {
      return item;
    }

    const sourceItem = findSourceItemForEnvelopeItem(node.id, item, fallbackIndex, sourceIndex);
    if (!sourceItem?.assetUrl) {
      if (isEmbeddedMediaValue(item.value)) {
        stats.flowEmbeddedMediaUnmatched += 1;
      }
      return item;
    }

    const shouldReplaceValue = isEmbeddedMediaValue(item.value) || item.sourceBinItemId !== sourceItem.id;
    if (!shouldReplaceValue) {
      return item;
    }

    changed = true;
    if (isEmbeddedMediaValue(item.value)) {
      stats.flowEmbeddedMediaReplaced += 1;
    }

    return {
      ...item,
      sourceBinItemId: sourceItem.id,
      value: sourceItem.assetUrl,
      mimeType: item.mimeType ?? sourceItem.mimeType,
    };
  });

  return changed
    ? { ...node, data: { ...node.data, envelopeItems: nextEnvelopeItems } }
    : node;
}

function normalizePaperMediaReferences(
  paper: FlowProjectDocument['paper'],
  sourceIndex: SourceItemIndex,
  stats: ProjectMediaReferenceStats,
): FlowProjectDocument['paper'] {
  if (!paper?.document?.pages) {
    return paper;
  }

  if (paper.documents?.length) {
    let changed = false;
    const documents = paper.documents.map((workspaceDocument) => {
      const normalizedDocument = normalizePaperDocumentMediaReferences(workspaceDocument.document, sourceIndex, stats);
      if (normalizedDocument === workspaceDocument.document) return workspaceDocument;
      changed = true;
      // Remapping locators changes which managed records the document reaches, so the captured
      // inventory must be rewritten in the same step or restore validation sees a stale list.
      return {
        ...workspaceDocument,
        document: normalizedDocument,
        assetIds: collectReachablePaperAssetIds(normalizedDocument),
      };
    });
    const activeDocument = documents.find((workspaceDocument) => workspaceDocument.id === paper.activeDocumentId)
      ?? documents[0];
    if (activeDocument && activeDocument.document !== paper.document) changed = true;
    return changed
      ? {
        ...paper,
        documents,
        document: activeDocument?.document ?? paper.document,
        assetIds: [...new Set(documents.flatMap((workspaceDocument) => workspaceDocument.assetIds ?? []))].sort(),
      }
      : paper;
  }

  const document = normalizePaperDocumentMediaReferences(paper.document, sourceIndex, stats);
  return document === paper.document
    ? paper
    : { ...paper, document, assetIds: collectReachablePaperAssetIds(document) };
}

function normalizePaperDocumentMediaReferences(
  document: PaperDocument,
  sourceIndex: SourceItemIndex,
  stats: ProjectMediaReferenceStats,
): PaperDocument {
  const normalizedPages = normalizePaperFrameContainers(document.pages, sourceIndex, stats);
  const normalizedParentPages = normalizePaperFrameContainers(document.parentPages ?? [], sourceIndex, stats);

  return normalizedPages.changed || normalizedParentPages.changed
    ? {
      ...document,
      pages: normalizedPages.containers,
      parentPages: normalizedParentPages.containers,
    }
    : document;
}

function normalizePaperFrameContainers<T extends { frames: PaperFrame[] }>(
  containers: readonly T[],
  sourceIndex: SourceItemIndex,
  stats: ProjectMediaReferenceStats,
): { containers: T[]; changed: boolean } {
  let changed = false;
  const normalized = containers.map((container) => {
    let containerChanged = false;
    const frames = container.frames.map((frame) => {
      if (!frame.asset) return frame;

      const asset = normalizePaperFrameAsset(frame.asset, sourceIndex, stats);
      if (asset === frame.asset) return frame;

      changed = true;
      containerChanged = true;
      return { ...frame, asset };
    });
    return containerChanged ? { ...container, frames } : container;
  });
  return { containers: normalized, changed };
}

function normalizePaperFrameAsset(
  asset: PaperFrameAsset,
  sourceIndex: SourceItemIndex,
  stats: ProjectMediaReferenceStats,
): PaperFrameAsset {
  const legacy = asset as PaperFrameAsset & { src?: unknown };
  const embeddedLegacySrc = typeof legacy.src === 'string' && isEmbeddedMediaValue(legacy.src);
  const sourceItem = asset.sourceBinItemId ? sourceIndex.byId.get(asset.sourceBinItemId) : undefined;

  if (!sourceItem?.assetUrl) {
    if (embeddedLegacySrc) stats.paperEmbeddedMediaUnmatched += 1;
    return asset;
  }

  const { src: _legacySrc, ...storedAsset } = legacy;
  const normalized: PaperFrameAsset = {
    ...storedAsset,
    ...buildPaperFrameAssetFromSourceItem(sourceItem),
    label: asset.label || sourceItem.label,
    kind: asset.kind ?? sourceItem.kind,
    mimeType: asset.mimeType ?? sourceItem.mimeType,
    pixelWidth: asset.pixelWidth ?? sourceItem.pixelWidth,
    pixelHeight: asset.pixelHeight ?? sourceItem.pixelHeight,
  };
  if (embeddedLegacySrc) stats.paperEmbeddedMediaReplaced += 1;
  return JSON.stringify(normalized) === JSON.stringify(asset) ? asset : normalized;
}

function findSourceItemForEnvelopeItem(
  nodeId: string,
  item: EnvelopeItem,
  fallbackIndex: number,
  sourceIndex: SourceItemIndex,
): SourceBinLibraryItem | undefined {
  const valueSignature = buildMediaAssetSignaturePart(item.value);

  if (item.sourceBinItemId) {
    const direct = sourceIndex.byId.get(item.sourceBinItemId);
    if (direct && sourceItemMatchesSignature(direct, valueSignature)) {
      return direct;
    }
  }

  const itemIndex = Number.isInteger(item.index) ? item.index : fallbackIndex;
  const sourceKey = `${item.kind}:${nodeId}:${itemIndex}:${valueSignature}`;
  const bySourceKey = sourceIndex.bySourceKey.get(sourceKey);
  if (bySourceKey) {
    return bySourceKey;
  }

  const bySignature = sourceIndex.byMediaSignature.get(valueSignature)?.find((sourceItem) => sourceItem.kind === item.kind);
  if (bySignature) {
    return bySignature;
  }

  const originNodeId = `${nodeId}:${itemIndex}`;
  const originMatches = sourceIndex.byOriginNodeId.get(originNodeId) ?? [];
  const byOriginSignature = originMatches.find((sourceItem) => sourceItemMatchesSignature(sourceItem, valueSignature));
  if (byOriginSignature) {
    return byOriginSignature;
  }

  if (item.sourceBinItemId) {
    const direct = sourceIndex.byId.get(item.sourceBinItemId);
    if (direct) return direct;
  }

  return originMatches[0];
}

function buildSourceItemIndex(items: readonly SourceBinLibraryItem[]): SourceItemIndex {
  const byId = new Map<string, SourceBinLibraryItem>();
  const bySourceKey = new Map<string, SourceBinLibraryItem>();
  const byOriginNodeId = new Map<string, SourceBinLibraryItem[]>();
  const byMediaSignature = new Map<string, SourceBinLibraryItem[]>();

  for (const item of items) {
    byId.set(item.id, item);

    if (item.sourceKey) {
      bySourceKey.set(item.sourceKey, item);
    }

    if (item.originNodeId) {
      const matches = byOriginNodeId.get(item.originNodeId) ?? [];
      matches.push(item);
      byOriginNodeId.set(item.originNodeId, matches);
    }

    const mediaSignature = sourceItemMediaSignature(item);
    if (mediaSignature) {
      const matches = byMediaSignature.get(mediaSignature) ?? [];
      matches.push(item);
      byMediaSignature.set(mediaSignature, matches);
    }
  }

  return { byId, bySourceKey, byOriginNodeId, byMediaSignature };
}

function sourceItemMatchesSignature(item: SourceBinLibraryItem, signature: string): boolean {
  return sourceItemMediaSignature(item) === signature || item.sourceKey?.endsWith(signature) === true;
}

function sourceItemMediaSignature(item: SourceBinLibraryItem): string | undefined {
  const value = item.kind === 'text'
    ? item.text ?? item.assetUrl
    : item.assetUrl;
  return value ? buildMediaAssetSignaturePart(value) : undefined;
}

function isEnvelopeItemLike(value: unknown): value is EnvelopeItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<EnvelopeItem>;
  return typeof candidate.value === 'string'
    && typeof candidate.label === 'string'
    && typeof candidate.kind === 'string';
}

function isEmbeddedMediaValue(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}
