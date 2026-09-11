import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { SourceBinItem } from './sourceBin';

export function mapLibraryItemToEditorSourceItem(item: SourceBinLibraryItem): SourceBinItem {
  return {
    id: item.id,
    nodeId: item.id,
    kind: item.kind,
    label: item.label,
    assetUrl: item.assetUrl,
    nativeFilePath: item.nativeFilePath,
    text: item.text,
    mimeType: item.mimeType,
    createdAt: item.createdAt,
    starred: item.starred,
    collapsed: item.collapsed,
    envelopeId: item.envelopeId,
    envelopeLabel: item.envelopeLabel,
    envelopeIndex: item.envelopeIndex,
    envelopeCollapsed: item.envelopeCollapsed,
    isGenerated: item.isGenerated,
    scratchFileName: item.scratchFileName,
    durability: item.durability,
    professional: item.professional,
  };
}

export function buildEditorSourceItemLookup(items: SourceBinLibraryItem[]): Map<string, SourceBinItem> {
  const lookup = new Map<string, SourceBinItem>();

  for (const item of items) {
    const sourceItem = mapLibraryItemToEditorSourceItem(item);
    lookup.set(item.id, sourceItem);

    if (item.originNodeId && !lookup.has(item.originNodeId)) {
      lookup.set(item.originNodeId, sourceItem);
    }
  }

  return lookup;
}

export function buildSourceBinLibraryItemLookup(
  items: SourceBinLibraryItem[],
): Map<string, SourceBinLibraryItem> {
  const lookup = new Map<string, SourceBinLibraryItem>();

  for (const item of items) {
    lookup.set(item.id, item);

    if (item.originNodeId && !lookup.has(item.originNodeId)) {
      lookup.set(item.originNodeId, item);
    }
  }

  return lookup;
}
