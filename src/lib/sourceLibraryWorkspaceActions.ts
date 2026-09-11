import type { SourceBinLibraryItem } from '../store/sourceBinStore';

export const SOURCE_LIBRARY_DRAG_MIME = 'application/x-flow-source-bin-item';

export type SourceLibraryWorkspaceId = 'flow' | 'image' | 'paper' | 'editor' | 'video';
export type SourceLibraryPrimaryAction = 'open-image-editor' | 'place-paper' | 'preview' | 'metadata';

export function resolveSourceLibraryPrimaryAction(
  workspaceId: SourceLibraryWorkspaceId,
  item: Pick<SourceBinLibraryItem, 'kind' | 'assetUrl' | 'text'>,
): SourceLibraryPrimaryAction {
  if (workspaceId === 'paper' && (item.kind === 'text' || item.kind === 'image' || item.kind === 'document')) {
    return 'place-paper';
  }
  if (workspaceId === 'image' && item.kind === 'image' && item.assetUrl) {
    return 'open-image-editor';
  }
  if (!item.assetUrl && !item.text) {
    return 'metadata';
  }
  return 'preview';
}

export function canOpenSourceLibraryItemInImageWorkspace(
  item: Pick<SourceBinLibraryItem, 'kind' | 'assetUrl' | 'text'>,
): boolean {
  return resolveSourceLibraryPrimaryAction('image', item) === 'open-image-editor';
}

export function hasDraggedSourceLibraryItem(
  dataTransfer: Pick<DataTransfer, 'types'> | { types: readonly string[] },
): boolean {
  const transferTypes = dataTransfer.types as DOMStringList | readonly string[];
  if (typeof (transferTypes as DOMStringList).contains === 'function') {
    return (transferTypes as DOMStringList).contains(SOURCE_LIBRARY_DRAG_MIME);
  }
  return Array.from(transferTypes as ArrayLike<string>).includes(SOURCE_LIBRARY_DRAG_MIME);
}

export function getDraggedSourceLibraryItemId(
  dataTransfer: Pick<DataTransfer, 'getData'>,
): string | undefined {
  const rawPayload = dataTransfer.getData(SOURCE_LIBRARY_DRAG_MIME);
  if (!rawPayload) return undefined;
  try {
    return (JSON.parse(rawPayload) as { itemId?: string }).itemId;
  } catch {
    return undefined;
  }
}
