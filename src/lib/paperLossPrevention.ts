import type { PaperDocument, PaperDocumentRecoveryReason, PaperDocumentSnapshot } from '../types/paper';
import {
  capturePaperWorkspaceAuthorization,
  isPaperWorkspaceAuthorizationCurrent,
  isPaperWorkspaceAuthorizationCurrentAfterTargetSave,
  usePaperStore,
  type PaperWorkspaceAuthorization,
} from '../store/paperStore';
import {
  usePaperLossPreventionStore,
  type PaperLossSaveResult,
} from '../store/paperLossPreventionStore';
import { savePaperDocumentEditable } from './paperDocumentSave';

const pendingCloseRequests = new Map<string, Promise<boolean>>();

async function saveAndRequireDocumentClean(
  documentId: string,
  save: () => Promise<PaperLossSaveResult>,
): Promise<PaperLossSaveResult> {
  const result = await save();
  if (result.status === 'success' && usePaperStore.getState().isDocumentDirty(documentId)) {
    return {
      status: 'failed',
      error: 'The Paper document changed while it was being saved. The newer changes remain open; save again before continuing.',
    };
  }
  return result;
}

/** Establishes project baselines from the exact acknowledged snapshot, never newer live content. */
export function acknowledgePaperProjectSnapshot(
  savedSnapshot: Partial<PaperDocumentSnapshot> | undefined,
): boolean {
  const paperState = usePaperStore.getState();
  if (savedSnapshot) paperState.markAllDocumentsProjectSaved(savedSnapshot);
  const current = usePaperStore.getState();
  return !(current.exportSnapshot().documents
    ?.some((document) => current.isDocumentDirty(document.id)) ?? false);
}

export async function requestClosePaperDocument(
  documentId: string,
  save: () => Promise<PaperLossSaveResult> = async () => savePaperDocumentEditable(documentId),
): Promise<boolean> {
  const existing = pendingCloseRequests.get(documentId);
  if (existing) return existing;

  const operation = closePaperDocumentWithPolicy(documentId, save)
    .finally(() => pendingCloseRequests.delete(documentId));
  pendingCloseRequests.set(documentId, operation);
  return operation;
}

async function closePaperDocumentWithPolicy(
  documentId: string,
  save: () => Promise<PaperLossSaveResult>,
): Promise<boolean> {
  const initialAuthorization = capturePaperWorkspaceAuthorization();
  const initialInstanceId = initialAuthorization.documents
    .find((document) => document.id === documentId)?.instanceId;
  if (!initialInstanceId) return false;

  for (;;) {
    const authorization = capturePaperWorkspaceAuthorization();
    const authorizedTarget = authorization.documents.find((document) => document.id === documentId);
    // A closed/reopened tab is a different target even when recovery reused its persisted id.
    if (!authorizedTarget || authorizedTarget.instanceId !== initialInstanceId) return false;
    const state = usePaperStore.getState();
    if (!authorizedTarget.dirty) {
      return state.closeDocument(documentId, { authorization });
    }
    const workspaceDocument = state.exportSnapshot().documents
      ?.find((candidate) => candidate.id === documentId);
    if (!workspaceDocument) return false;

    const decision = await usePaperLossPreventionStore.getState().requestDecision({
      key: `close:${documentId}`,
      title: `Save changes to “${workspaceDocument.document.title}”?`,
      message: 'Closing this tab will remove its current editable state from the project. Save an editable .slppr copy, discard with recovery, or cancel.',
      documentTitles: [workspaceDocument.document.title],
      save: () => saveAndRequireDocumentClean(documentId, save),
    });

    if (decision === 'cancel') return false;
    if (decision === 'save') {
      if (!isPaperWorkspaceAuthorizationCurrentAfterTargetSave(authorization, documentId)) continue;
      const savedAuthorization = capturePaperWorkspaceAuthorization();
      if (state.closeDocument(documentId, { authorization: savedAuthorization })) return true;
      continue;
    }
    if (!isPaperWorkspaceAuthorizationCurrent(authorization)) continue;
    if (state.closeDocument(documentId, {
      authorization,
      discard: true,
      recoveryReason: 'discard',
    })) return true;
  }
}

export async function requestPaperDestructiveAction(options: {
  key: string;
  title: string;
  message: string;
  reason: Exclude<PaperDocumentRecoveryReason, 'discard'>;
  save: () => Promise<PaperLossSaveResult>;
}): Promise<boolean> {
  for (;;) {
    const paperState = usePaperStore.getState();
    const documents = paperState.exportSnapshot().documents ?? [];
    const dirtyDocuments = documents.filter((document) => paperState.isDocumentDirty(document.id));
    if (!dirtyDocuments.length) return true;
    const decisionAuthorization = capturePaperWorkspaceAuthorization();

    const decision = await usePaperLossPreventionStore.getState().requestDecision({
      key: options.key,
      title: options.title,
      message: options.message,
      documentTitles: dirtyDocuments.map((document) => document.document.title),
      save: options.save,
    });
    if (decision === 'cancel') return false;
    if (decision === 'discard') {
      const current = usePaperStore.getState();
      // The decision covered the exact tab identities/content shown when the dialog opened.
      // A local or remote mutation during that dialog gets its own fresh decision and no stale
      // recovery copy is attributed to the rejected version.
      if (!isPaperWorkspaceAuthorizationCurrent(decisionAuthorization)) continue;
      current.captureDocumentRecovery(dirtyDocuments.map((document) => document.id), options.reason);
      return true;
    }
    if (decision === 'save') {
      const current = usePaperStore.getState();
      const stillDirty = (current.exportSnapshot().documents ?? [])
        .some((document) => current.isDocumentDirty(document.id));
      if (stillDirty) continue;
      return true;
    }
  }
}

export interface PaperDocumentReplacementAuthorization {
  documentId: string;
  workspace: PaperWorkspaceAuthorization;
  recoveryReason?: 'document-replacement';
}

/**
 * Authorize replacement of one exact runtime tab. The caller must pass the returned token to
 * replaceAuthorizedPaperDocument; a boolean approval is deliberately insufficient.
 */
export async function requestPaperDocumentReplacement(
  documentId: string,
  incomingLabel: string,
  save: () => Promise<PaperLossSaveResult> = async () => savePaperDocumentEditable(documentId),
): Promise<PaperDocumentReplacementAuthorization | null> {
  const initialAuthorization = capturePaperWorkspaceAuthorization();
  const initialInstanceId = initialAuthorization.documents
    .find((document) => document.id === documentId)?.instanceId;
  if (!initialInstanceId) return null;

  for (;;) {
    const authorization = capturePaperWorkspaceAuthorization();
    const authorizedTarget = authorization.documents.find((document) => document.id === documentId);
    if (!authorizedTarget || authorizedTarget.instanceId !== initialInstanceId) return null;
    const paperState = usePaperStore.getState();
    if (!authorizedTarget.dirty) return { documentId, workspace: authorization };
    const workspaceDocument = paperState.exportSnapshot().documents
      ?.find((candidate) => candidate.id === documentId);
    if (!workspaceDocument) return null;
    const decision = await usePaperLossPreventionStore.getState().requestDecision({
      key: `document-replacement:${documentId}`,
      title: `Save changes to “${workspaceDocument.document.title}”?`,
      message: `Importing “${incomingLabel}” replaces this Paper tab and clears its undo history. Save an editable copy, discard with recovery, or cancel.`,
      documentTitles: [workspaceDocument.document.title],
      save: () => saveAndRequireDocumentClean(documentId, save),
    });
    if (decision === 'cancel') return null;
    if (decision === 'save') {
      if (!isPaperWorkspaceAuthorizationCurrentAfterTargetSave(authorization, documentId)) continue;
      return { documentId, workspace: capturePaperWorkspaceAuthorization() };
    }
    if (!isPaperWorkspaceAuthorizationCurrent(authorization)) continue;
    return {
      documentId,
      workspace: authorization,
      recoveryReason: 'document-replacement',
    };
  }
}

/** Revalidate and replace the exact authorized tab in one synchronous store transaction. */
export function replaceAuthorizedPaperDocument(
  authorization: PaperDocumentReplacementAuthorization,
  document: PaperDocument,
): boolean {
  return usePaperStore.getState().replaceDocument(authorization.documentId, document, {
    authorization: authorization.workspace,
    recoveryReason: authorization.recoveryReason,
  });
}
