import type { FlowListItem } from './listNodes';

export type ExpanderPreviewKind = 'image' | 'video';

export function getExpanderPreviewKind(
  item: Pick<FlowListItem, 'kind' | 'value'> | undefined,
): ExpanderPreviewKind | undefined {
  if (!item?.value.trim()) {
    return undefined;
  }

  if (item.kind === 'image' || item.kind === 'video') {
    return item.kind;
  }

  return undefined;
}
