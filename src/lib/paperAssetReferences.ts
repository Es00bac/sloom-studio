import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperFrameAsset } from '../types/paper';

type PaperSourceAsset = Pick<
  SourceBinLibraryItem,
  'id' | 'label' | 'kind' | 'mimeType' | 'assetUrl' | 'text' | 'pixelWidth' | 'pixelHeight'
>;

export function isPaperPersistableExternalUrl(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && !/^(?:data:|blob:)/i.test(value);
}

/**
 * Converts a Source Library item to Paper state without copying its runtime URL or binary payload.
 * The source-bin id remains the durable project-level link; durable URLs are supplemental locators.
 */
export function buildPaperFrameAssetFromSourceItem(item: PaperSourceAsset): PaperFrameAsset {
  return {
    sourceBinItemId: item.id,
    label: item.label,
    kind: item.kind,
    ...(isPaperPersistableExternalUrl(item.assetUrl) ? { locator: { kind: 'external' as const, url: item.assetUrl } } : {}),
    ...(item.mimeType ? { mimeType: item.mimeType } : {}),
    ...(item.text ? { text: item.text } : {}),
    ...(item.pixelWidth ? { pixelWidth: item.pixelWidth } : {}),
    ...(item.pixelHeight ? { pixelHeight: item.pixelHeight } : {}),
  };
}

/** Returns the currently usable display/export URL without persisting it in Paper document state. */
export function resolvePaperFrameAssetUrl(
  asset: PaperFrameAsset | undefined,
  sourceItem?: Pick<SourceBinLibraryItem, 'id' | 'assetUrl'>,
): string | undefined {
  if (!asset) return undefined;
  if (asset.sourceBinItemId && sourceItem?.id === asset.sourceBinItemId && sourceItem.assetUrl) {
    return sourceItem.assetUrl;
  }
  // Export-only copies intentionally use data:/blob: URLs here after managed bytes resolve. Persistent
  // Paper state rejects those locators at construction/restore boundaries; this runtime resolver must
  // still render the transient copy without feeding it back into state.
  if (asset.locator?.kind === 'external') {
    return asset.locator.url;
  }
  return undefined;
}

export function hasPaperAssetReference(asset: PaperFrameAsset | undefined): boolean {
  return Boolean(asset?.sourceBinItemId || asset?.locator);
}
