import { usePaperStore } from '../store/paperStore';

export interface PaperBeforeUnloadEvent {
  preventDefault: () => void;
  returnValue: string;
}
/**
 * Synchronous shutdown boundary: capture bounded local recovery first, then ask the platform to
 * present its Leave/Cancel affordance. Async Save is intentionally not claimed from beforeunload.
 */
export function protectDirtyPaperBeforeUnload(event: PaperBeforeUnloadEvent): boolean {
  const paperState = usePaperStore.getState();
  const dirtyIds = paperState.exportSnapshot().documents
    ?.filter((document) => paperState.isDocumentDirty(document.id))
    .map((document) => document.id) ?? [];
  if (!dirtyIds.length) return false;

  paperState.captureDocumentRecovery(dirtyIds, 'shutdown');
  event.preventDefault();
  event.returnValue = '';
  return true;
}

export function installPaperBeforeUnloadProtection(target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const handler = (event: BeforeUnloadEvent) => {
    protectDirtyPaperBeforeUnload(event);
  };
  target.addEventListener('beforeunload', handler);
  return () => target.removeEventListener('beforeunload', handler);
}
