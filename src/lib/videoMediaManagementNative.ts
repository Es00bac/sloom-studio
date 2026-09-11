import type { AppNode } from '../types/flow';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import { getEditorAssets } from './editorAssets';
import { buildSourceBinLibraryItemLookup } from './editorSourceItems';
import { getEditorAudioClips, getEditorVisualClips } from './manualEditorState';
import {
  captureProjectAuthorityMutationScope,
  getSignalLoomNativeBridge,
  isCurrentProjectAuthorityMutationScope,
  type NativeVideoMediaConsolidationResult,
  type NativeVideoMediaRelinkResult,
} from './nativeApp';

const MAX_CONSOLIDATION_ITEMS = 1_000;

export function isVideoMediaManagementItem(
  item: SourceBinLibraryItem | undefined,
): item is SourceBinLibraryItem {
  return item?.kind === 'image'
    || item?.kind === 'video'
    || item?.kind === 'audio'
    || item?.kind === 'composition';
}

export function isNativeVideoMediaManagementAvailable(): boolean {
  const bridge = getSignalLoomNativeBridge();
  return Boolean(bridge?.relinkVideoMedia && bridge?.consolidateVideoMedia);
}

export function collectUsedVideoMediaItemIds(
  nodes: readonly AppNode[],
  items: readonly SourceBinLibraryItem[],
): string[] {
  const itemLookup = buildSourceBinLibraryItemLookup([...items]);
  const usedItemIds = new Set<string>();

  const include = (sourceId: string | undefined) => {
    if (!sourceId) return;
    const item = itemLookup.get(sourceId);
    if (isVideoMediaManagementItem(item)) usedItemIds.add(item.id);
  };

  for (const node of nodes) {
    if (node.type !== 'composition') continue;
    const editorAssets = new Map(getEditorAssets(node.data).map((asset) => [asset.id, asset]));
    for (const clip of getEditorVisualClips(node.data)) {
      const editorAsset = editorAssets.get(clip.sourceNodeId);
      include(editorAsset?.kind === 'image' ? editorAsset.imageSourceId : clip.sourceNodeId);
    }
    for (const clip of getEditorAudioClips(node.data)) include(clip.sourceNodeId);
  }

  return items.flatMap((item) => usedItemIds.has(item.id) ? [item.id] : []);
}

export async function relinkVideoMediaItem(itemId: string): Promise<NativeVideoMediaRelinkResult> {
  const normalizedItemId = itemId.trim();
  if (!normalizedItemId) throw new Error('Select a Source Library media item to relink.');
  const bridge = getSignalLoomNativeBridge();
  if (!bridge?.relinkVideoMedia) throw new Error('Media relink requires the Sloom Studio desktop app.');
  const scope = captureProjectAuthorityMutationScope();
  if (!scope) throw new Error('Media relink requires an open project with current edit authority.');

  const result = await bridge.relinkVideoMedia({ itemId: normalizedItemId, claim: scope.claim });
  assertCurrentResult(scope, result, 'Media relink');
  return result;
}

export async function consolidateVideoMediaItems(
  itemIds: readonly string[],
): Promise<NativeVideoMediaConsolidationResult> {
  const normalizedItemIds = [...new Set(itemIds.flatMap((itemId) => (
    typeof itemId === 'string' && itemId.trim() ? [itemId.trim()] : []
  )))];
  if (normalizedItemIds.length === 0) throw new Error('No used native media is available to consolidate.');
  if (normalizedItemIds.length > MAX_CONSOLIDATION_ITEMS) {
    throw new Error(`Media consolidation is limited to ${MAX_CONSOLIDATION_ITEMS} items per operation.`);
  }
  const bridge = getSignalLoomNativeBridge();
  if (!bridge?.consolidateVideoMedia) throw new Error('Media consolidation requires the Sloom Studio desktop app.');
  const scope = captureProjectAuthorityMutationScope();
  if (!scope) throw new Error('Media consolidation requires an open project with current edit authority.');

  const result = await bridge.consolidateVideoMedia({ itemIds: normalizedItemIds, claim: scope.claim });
  assertCurrentResult(scope, result, 'Media consolidation');
  return result;
}

function assertCurrentResult(
  scope: NonNullable<ReturnType<typeof captureProjectAuthorityMutationScope>>,
  result: NativeVideoMediaRelinkResult | NativeVideoMediaConsolidationResult,
  operation: string,
): void {
  if (!isCurrentProjectAuthorityMutationScope(scope)) {
    throw new Error(`${operation} finished after the active project changed, so its result was discarded.`);
  }
  const error = result.error ?? result.rejected?.message;
  if (error) throw new Error(error);
  if (!result.canceled && !result.ok) throw new Error(`${operation} did not commit.`);
}
