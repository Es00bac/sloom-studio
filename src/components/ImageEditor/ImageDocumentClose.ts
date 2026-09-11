import type { ImageDocument } from '../../types/imageEditor';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { getSignalLoomNativeBridge } from '../../lib/nativeApp';
import { buildWorkspaceDownloadFilename, downloadBlob } from '../../shared/files/downloads';
import {
  completeLinkedImageDocumentClose,
  returnLinkedImageEdit,
} from '../../lib/imageLinkedEdit';
import { saveImageDocumentAsSlimg } from './ImageSlimgCodec';

export type ImageDocumentCloseDecision = 'save' | 'discard' | 'cancel';
export type ImageDocumentCloseSaveOutcome = 'saved' | 'canceled';

/**
 * Persist the editable layered document before a close. Linked .slimg edits overwrite their
 * already-authorized workfile; Paper-linked edits first get a native .slimg workfile and then
 * apply their flattened return to Paper. A canceled chooser is not a successful save.
 */
export async function saveImageDocumentForClose(
  document: ImageDocument,
): Promise<ImageDocumentCloseSaveOutcome> {
  if (document.linkedEdit?.kind === 'slimg-node') {
    await returnLinkedImageEdit(document);
    return 'saved';
  }

  const bytes = await saveImageDocumentAsSlimg(document);
  const bridge = getSignalLoomNativeBridge();
  if (bridge?.saveImageDocumentFileAs) {
    const result = await bridge.saveImageDocumentFileAs(bytes);
    if (result.canceled) return 'canceled';
  } else {
    downloadBlob(
      new Blob([bytes as BlobPart], { type: 'application/octet-stream' }),
      buildWorkspaceDownloadFilename(document.title, 'slimg'),
    );
  }

  if (document.linkedEdit?.kind === 'paper-frame') {
    await returnLinkedImageEdit(document);
  }
  return 'saved';
}

export async function finishImageDocumentClose(
  document: ImageDocument,
  decision: Exclude<ImageDocumentCloseDecision, 'cancel'>,
): Promise<ImageDocumentCloseSaveOutcome> {
  if (decision === 'discard') {
    useImageEditorStore.getState().discardDocument(document.id);
    await completeLinkedImageDocumentClose(document.linkedEdit);
    return 'saved';
  }

  const outcome = await saveImageDocumentForClose(document);
  if (outcome === 'canceled') return outcome;

  const store = useImageEditorStore.getState();
  store.markDocumentClean(document.id);
  store.closeDocument(document.id);
  await completeLinkedImageDocumentClose(document.linkedEdit);
  return 'saved';
}

/** Browser/Electron renderer shutdown cannot safely await a custom Save flow. Block unload so the
 * platform presents its native leave/cancel guard; tab and project actions use the full dialog. */
export function installDirtyImageDocumentUnloadGuard(target: Window): () => void {
  const handleBeforeUnload = (event: BeforeUnloadEvent | Event) => {
    if (!useImageEditorStore.getState().documents.some((document) => document.dirty)) return;
    event.preventDefault();
    (event as BeforeUnloadEvent).returnValue = '';
  };
  target.addEventListener('beforeunload', handleBeforeUnload);
  return () => target.removeEventListener('beforeunload', handleBeforeUnload);
}
