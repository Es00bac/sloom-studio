/**
 * Context menus follow the selection convention used by professional desktop editors:
 * right-clicking an already-selected object opens actions for the complete selection instead of
 * collapsing it to the clicked object. An unselected object still becomes the context target.
 */
export function shouldReplacePaperFrameSelectionForContextMenu(isSelected: boolean): boolean {
  return !isSelected;
}

export function resolvePaperFrameSelectionMode(modifiers?: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): 'replace' | 'add' | 'toggle' {
  if (modifiers?.shiftKey) return 'add';
  if (modifiers?.ctrlKey || modifiers?.metaKey) return 'toggle';
  return 'replace';
}

const CONTEXT_MENU_CLICK_GUARD_MS = 500;

/** Keep a platform-generated Ctrl-click context menu from toggling selection again on its trailing click. */
export function shouldTogglePaperFrameSelectionOnModifiedClick(input: {
  modified: boolean;
  lastContextMenuAt: number;
  now: number;
}): boolean {
  return input.modified && input.now - input.lastContextMenuAt > CONTEXT_MENU_CLICK_GUARD_MS;
}
