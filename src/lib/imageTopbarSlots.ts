export const IMAGE_TOPBAR_CENTER_SLOT_ID = 'signal-loom-image-topbar-center-slot';
export const IMAGE_TOPBAR_RIGHT_SLOT_ID = 'signal-loom-image-topbar-right-slot';

/**
 * Resolves a top-nav-bar slot element by id, retrying via a MutationObserver until it appears (the
 * nav bar and the workspace mount independently). Mirrors the Paper top-strip slot pattern so the
 * Image workspace can portal its controls into the shared top bar's empty centre/right regions.
 */
export function observeTopbarSlot(
  documentRef: Document,
  slotId: string,
  onResolve: (slot: HTMLElement | null) => void,
): () => void {
  const resolveSlot = () => {
    const slot = documentRef.getElementById(slotId);
    const resolved = slot instanceof HTMLElement ? slot : null;
    onResolve(resolved);
    return resolved;
  };

  if (resolveSlot()) {
    return () => {};
  }
  if (typeof MutationObserver === 'undefined') {
    return () => {};
  }
  const root = documentRef.documentElement;
  if (!root) {
    return () => {};
  }
  const observer = new MutationObserver(() => {
    if (resolveSlot()) {
      observer.disconnect();
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
