import { serializeSlppr } from '../features/paper/SlpprFormat';
import { paperAssetRepository } from '../features/paper/assets/PaperAssetRuntime';
import { fingerprintPaperAuthoredContent, usePaperStore } from '../store/paperStore';
import { downloadBlob, buildWorkspaceDownloadFilename } from '../shared/files/downloads';
import { getSignalLoomNativeBridge, type SignalLoomNativeBridge } from './nativeApp';

export type PaperEditableSaveResult =
  | { status: 'success'; path: string }
  | { status: 'canceled' }
  | { status: 'failed'; error: string }
  | { status: 'unacknowledged'; error: string };

export interface PaperEditableSaveDependencies {
  bridge?: Pick<SignalLoomNativeBridge, 'savePaperDocumentFileAs' | 'writePaperDocumentFile'>;
  download?: typeof downloadBlob;
  serialize?: typeof serializeSlppr;
}

/** BlobPart must own an ArrayBuffer; serialized views may be backed by SharedArrayBuffer. */
function copyBytesToOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Saves one editable Paper tab. Dirty truth changes only after the native bridge acknowledges that
 * bytes reached a standalone path. Browser/Capacitor downloads remain useful exports, but cannot
 * honestly establish an editable baseline because this synchronous API receives no durable-write ack.
 */
export async function savePaperDocumentEditable(
  documentId: string,
  options: { forceSaveAs?: boolean; allowUnacknowledgedDownload?: boolean } = {},
  dependencies: PaperEditableSaveDependencies = {},
): Promise<PaperEditableSaveResult> {
  const paperState = usePaperStore.getState();
  const workspaceDocument = paperState.exportSnapshot({ includeLocalPersistence: true }).documents
    ?.find((candidate) => candidate.id === documentId);
  if (!workspaceDocument) {
    return { status: 'failed', error: 'The Paper document is no longer open.' };
  }

  try {
    const serialize = dependencies.serialize ?? serializeSlppr;
    const savedFingerprint = fingerprintPaperAuthoredContent(workspaceDocument.document);
    const bytes = await serialize(workspaceDocument.document, paperAssetRepository);
    const bridge = dependencies.bridge ?? getSignalLoomNativeBridge();
    const knownPath = workspaceDocument.persistence?.path;

    if (bridge) {
      if (!options.forceSaveAs && knownPath && bridge.writePaperDocumentFile) {
        const result = await bridge.writePaperDocumentFile(knownPath, bytes);
        if (!result.ok) {
          return { status: 'failed', error: result.error ?? 'The standalone Paper document was not written.' };
        }
        const path = result.path ?? knownPath;
        usePaperStore.getState().markDocumentSaved(documentId, {
          kind: 'standalone',
          path,
          savedFingerprint,
        });
        return { status: 'success', path };
      }

      const result = await bridge.savePaperDocumentFileAs(bytes);
      if (result.canceled || !result.path) return { status: 'canceled' };
      usePaperStore.getState().markDocumentSaved(documentId, {
        kind: 'standalone',
        path: result.path,
        savedFingerprint,
      });
      return { status: 'success', path: result.path };
    }

    if (options.allowUnacknowledgedDownload) {
      const download = dependencies.download ?? downloadBlob;
      download(
        new Blob([copyBytesToOwnedArrayBuffer(bytes)], { type: 'application/octet-stream' }),
        buildWorkspaceDownloadFilename(workspaceDocument.document.title, 'slppr'),
      );
    }
    return {
      status: 'unacknowledged',
      error: 'The download could not be acknowledged as an editable save, so this tab remains unsaved.',
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'The Paper document could not be saved.',
    };
  }
}
