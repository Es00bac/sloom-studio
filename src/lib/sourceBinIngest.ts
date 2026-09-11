import type { SourceBinItem } from './sourceBin';
import { buildMediaAssetSignaturePart } from './mediaAssetSignature';

export interface PendingSourceBinIngestItem {
  item: SourceBinItem;
  sourceKey: string;
}

export function buildConnectedItemSourceKey(item: SourceBinItem): string | undefined {
  if (item.kind === 'text') {
    return item.text ? `${item.kind}:${item.nodeId}:${item.text}` : undefined;
  }

  if (!item.assetUrl) {
    return undefined;
  }

  return `${item.kind}:${item.nodeId}:${buildMediaAssetSignaturePart(item.assetUrl)}`;
}

export function buildSourceBinIngestSignature(items: SourceBinItem[]): string {
  return items
    .map((item) => buildConnectedItemSourceKey(item))
    .filter((sourceKey): sourceKey is string => Boolean(sourceKey))
    .sort()
    .join('|');
}

export function takePendingSourceBinIngestItems(
  items: SourceBinItem[],
  options: {
    existingSourceKeys: ReadonlySet<string>;
    existingItemIds?: ReadonlySet<string>;
    pendingSourceKeys: Set<string>;
    dismissedSourceKeys?: ReadonlySet<string>;
  },
): PendingSourceBinIngestItem[] {
  return items.flatMap((item) => {
    if (item.sourceBinItemId && options.existingItemIds?.has(item.sourceBinItemId)) {
      return [];
    }

    const sourceKey = buildConnectedItemSourceKey(item);

    if (
      !sourceKey ||
      options.existingSourceKeys.has(sourceKey) ||
      options.pendingSourceKeys.has(sourceKey) ||
      // The user deleted this item from the library while its node stayed wired —
      // don't resurrect it on the next ingest pass (docs/notes/811 F1).
      options.dismissedSourceKeys?.has(sourceKey)
    ) {
      return [];
    }

    options.pendingSourceKeys.add(sourceKey);
    return [{ item, sourceKey }];
  });
}
