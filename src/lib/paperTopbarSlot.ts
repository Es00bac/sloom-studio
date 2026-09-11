export const PAPER_TOPBAR_SLOT_ID = 'signal-loom-paper-topbar-slot';

export function observePaperTopbarSlot(
  documentRef: Document,
  onResolve: (slot: HTMLElement | null) => void,
): () => void {
  const resolveSlot = () => {
    const slot = documentRef.getElementById(PAPER_TOPBAR_SLOT_ID);
    onResolve(slot instanceof HTMLElement ? slot : null);
    return slot instanceof HTMLElement ? slot : null;
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
