import { getContextMenuPortalTarget } from '../../lib/sharedContextMenu';

export function getImageEditorContextMenuPortalTarget(
  doc: Pick<Document, 'body'> | undefined = typeof document === 'undefined' ? undefined : document,
): HTMLElement | undefined {
  return getContextMenuPortalTarget(doc);
}
