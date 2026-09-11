import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./automationBypass', () => ({
  shouldBypassConfirmations: () => false,
}));

import { createDefaultPaperDocument } from './paperDocument';
import {
  replaceAuthorizedPaperDocument,
  requestClosePaperDocument,
  requestPaperDestructiveAction,
  requestPaperDocumentReplacement,
} from './paperLossPrevention';
import {
  resetPaperLossPreventionForTests,
  usePaperLossPreventionStore,
} from '../store/paperLossPreventionStore';
import { fingerprintPaperAuthoredContent, usePaperStore } from '../store/paperStore';

beforeEach(() => {
  resetPaperLossPreventionForTests();
  const document = createDefaultPaperDocument({ title: 'Project replacement' });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
  usePaperStore.getState().addPage();
});

describe('requestPaperDestructiveAction', () => {
  it('Cancel preserves the exact dirty workspace and creates no recovery copy', async () => {
    const before = usePaperStore.getState();
    const request = requestPaperDestructiveAction({
      key: 'replace:cancel',
      title: 'Replace?',
      message: 'Choose.',
      reason: 'project-replacement',
      save: vi.fn(),
    });
    usePaperLossPreventionStore.getState().cancel();

    await expect(request).resolves.toBe(false);
    const after = usePaperStore.getState();
    expect(after.document).toBe(before.document);
    expect(after.undoStack).toBe(before.undoStack);
    expect(after.activeDocumentId).toBe(before.activeDocumentId);
    expect(after.discardedDocumentRecoveries).toHaveLength(0);
  });

  it('Discard captures every dirty tab before allowing replacement', async () => {
    usePaperStore.getState().createNewDocument({ title: 'Second dirty' });
    const request = requestPaperDestructiveAction({
      key: 'replace:discard',
      title: 'Replace?',
      message: 'Choose.',
      reason: 'project-replacement',
      save: vi.fn(),
    });
    usePaperLossPreventionStore.getState().discard();

    await expect(request).resolves.toBe(true);
    expect(usePaperStore.getState().discardedDocumentRecoveries.map((entry) => entry.snapshot.document.title))
      .toEqual(['Project replacement', 'Second dirty']);
  });

  it('Save allows replacement only after acknowledged success and does not create discard recovery', async () => {
    const save = vi.fn().mockImplementation(async () => {
      usePaperStore.getState().markAllDocumentsProjectSaved();
      return { status: 'success' as const };
    });
    const request = requestPaperDestructiveAction({
      key: 'replace:save',
      title: 'Replace?',
      message: 'Choose.',
      reason: 'project-replacement',
      save,
    });
    await usePaperLossPreventionStore.getState().save();

    await expect(request).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(usePaperStore.getState().isDocumentDirty()).toBe(false);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });

  it.each([
    { status: 'canceled' as const },
    { status: 'failed' as const, error: 'Project write failed' },
  ])('keeps replacement blocked after Save returns $status', async (saveResult) => {
    const request = requestPaperDestructiveAction({
      key: `replace:${saveResult.status}`,
      title: 'Replace?',
      message: 'Choose.',
      reason: 'project-replacement',
      save: vi.fn().mockResolvedValue(saveResult),
    });
    await usePaperLossPreventionStore.getState().save();

    expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull();
    usePaperLossPreventionStore.getState().cancel();
    await expect(request).resolves.toBe(false);
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
  });
});

describe('requestPaperDocumentReplacement', () => {
  it('requires explicit discard and snapshots the exact tab before standalone import replacement', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    const before = usePaperStore.getState().document;
    const request = requestPaperDocumentReplacement(documentId, 'incoming.docx');
    usePaperLossPreventionStore.getState().discard();

    const authorization = await request;
    expect(authorization).not.toBeNull();
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
    const incoming = createDefaultPaperDocument({ title: 'Imported replacement' });
    expect(replaceAuthorizedPaperDocument(authorization!, incoming)).toBe(true);
    const recovery = usePaperStore.getState().discardedDocumentRecoveries.at(-1);
    expect(recovery?.reason).toBe('document-replacement');
    expect(fingerprintPaperAuthoredContent(recovery!.snapshot.document))
      .toBe(fingerprintPaperAuthoredContent(before));
    expect(usePaperStore.getState().document.title).toBe('Imported replacement');
  });

  it('does not replace the newly active dirty tab or capture stale recovery after Discard', async () => {
    const authorizedId = usePaperStore.getState().activeDocumentId;
    const authorizedFingerprint = fingerprintPaperAuthoredContent(usePaperStore.getState().document);
    usePaperStore.getState().createNewDocument({ title: 'Dirty tab B' });
    const tabBId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    usePaperStore.getState().setActiveDocument(authorizedId);
    const request = requestPaperDocumentReplacement(authorizedId, 'incoming.slppr');

    usePaperStore.getState().setActiveDocument(tabBId);
    usePaperLossPreventionStore.getState().discard();
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    usePaperLossPreventionStore.getState().cancel();

    await expect(request).resolves.toBeNull();
    expect(usePaperStore.getState().activeDocumentId).toBe(tabBId);
    expect(usePaperStore.getState().document.title).toBe('Dirty tab B');
    expect(fingerprintPaperAuthoredContent(
      usePaperStore.getState().documents.find((document) => document.id === authorizedId)!.document,
    )).toBe(authorizedFingerprint);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });

  it('after reauthorization replaces only the original tab and recovers only its approved version', async () => {
    const authorizedId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().createNewDocument({ title: 'Dirty tab B' });
    const tabBId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    usePaperStore.getState().setActiveDocument(authorizedId);
    const request = requestPaperDocumentReplacement(authorizedId, 'incoming.slppr');

    usePaperStore.getState().setActiveDocument(tabBId);
    usePaperLossPreventionStore.getState().discard();
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    usePaperLossPreventionStore.getState().discard();
    const authorization = await request;

    expect(replaceAuthorizedPaperDocument(
      authorization!,
      createDefaultPaperDocument({ title: 'Imported into tab A' }),
    )).toBe(true);
    expect(usePaperStore.getState().activeDocumentId).toBe(tabBId);
    expect(usePaperStore.getState().document.title).toBe('Dirty tab B');
    expect(usePaperStore.getState().documents.find((document) => document.id === authorizedId)?.document.title)
      .toBe('Imported into tab A');
    const recovery = usePaperStore.getState().discardedDocumentRecoveries.at(-1);
    expect(recovery?.snapshot.id).toBe(authorizedId);
    expect(recovery?.snapshot.document.title).toBe('Project replacement');
  });

  it('re-prompts on remote/local, reorder, and unrelated-tab drift without stale recovery', async () => {
    const authorizedId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().createNewDocument({ title: 'Unrelated clean tab' });
    usePaperStore.getState().markDocumentSaved(usePaperStore.getState().activeDocumentId, { kind: 'project' });
    usePaperStore.getState().setActiveDocument(authorizedId);
    const request = requestPaperDocumentReplacement(authorizedId, 'incoming.slppr');

    usePaperStore.getState().applyRemotePaperDocumentChange({
      type: 'paper-document-snapshot',
      document: { ...usePaperStore.getState().document, title: 'Remote target version' },
    });
    usePaperLossPreventionStore.getState().discard();
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest?.documentTitles)
      .toContain('Remote target version'));

    usePaperStore.setState((state) => ({ documents: [...state.documents].reverse() }));
    usePaperStore.getState().addPage();
    usePaperLossPreventionStore.getState().discard();
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    usePaperLossPreventionStore.getState().cancel();

    await expect(request).resolves.toBeNull();
    expect(usePaperStore.getState().document.title).toBe('Remote target version');
    expect(usePaperStore.getState().document.pages).toHaveLength(3);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });

  it('aborts when the target tab is closed and reopened with the same id', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    const request = requestPaperDocumentReplacement(documentId, 'incoming.slppr');
    expect(usePaperStore.getState().closeDocument(documentId, {
      discard: true,
      recoveryReason: 'discard',
    })).toBe(true);
    const recoveryId = usePaperStore.getState().discardedDocumentRecoveries.at(-1)!.id;
    expect(usePaperStore.getState().restoreDiscardedDocument(recoveryId)).toBe(documentId);
    usePaperLossPreventionStore.getState().discard();

    await expect(request).resolves.toBeNull();
    expect(usePaperStore.getState().documents.map((document) => document.id)).toContain(documentId);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });

  it('Save authorizes only the original tab and final mutation revalidation fails closed', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().createNewDocument({ title: 'Dirty tab B' });
    const tabBId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    usePaperStore.getState().setActiveDocument(documentId);
    const save = vi.fn().mockImplementation(async () => {
      usePaperStore.getState().markDocumentSaved(documentId, { kind: 'standalone' });
      return { status: 'success' as const };
    });
    const request = requestPaperDocumentReplacement(documentId, 'incoming.slppr', save);
    usePaperStore.getState().setActiveDocument(tabBId);
    await usePaperLossPreventionStore.getState().save();

    const authorization = await request;
    expect(authorization?.documentId).toBe(documentId);
    usePaperStore.getState().addPage();
    expect(replaceAuthorizedPaperDocument(
      authorization!,
      createDefaultPaperDocument({ title: 'Must not replace' }),
    )).toBe(false);
    expect(usePaperStore.getState().document.title).toBe('Dirty tab B');
    expect(usePaperStore.getState().documents.find((document) => document.id === documentId)?.document.title)
      .toBe('Project replacement');
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });

  it('Cancel returns no mutation token and preserves the exact target', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    const before = usePaperStore.getState().document;
    const request = requestPaperDocumentReplacement(documentId, 'incoming.slppr');
    usePaperLossPreventionStore.getState().cancel();

    await expect(request).resolves.toBeNull();
    expect(usePaperStore.getState().document).toBe(before);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });
});

describe('requestClosePaperDocument stale authorization', () => {
  it('re-prompts after active-tab and unrelated authored drift, then Cancel closes nothing', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().createNewDocument({ title: 'Dirty close tab B' });
    const tabBId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    usePaperStore.getState().setActiveDocument(documentId);
    const request = requestClosePaperDocument(documentId);

    usePaperStore.getState().setActiveDocument(tabBId);
    usePaperLossPreventionStore.getState().discard();
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    usePaperStore.getState().addPage();
    usePaperLossPreventionStore.getState().discard();
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    usePaperLossPreventionStore.getState().cancel();

    await expect(request).resolves.toBe(false);
    expect(usePaperStore.getState().documents.map((document) => document.id))
      .toEqual(expect.arrayContaining([documentId, tabBId]));
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });

  it('does not close a remote-edited target from a stale Discard', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    const request = requestClosePaperDocument(documentId);
    usePaperStore.getState().applyRemotePaperDocumentChange({
      type: 'paper-document-snapshot',
      document: { ...usePaperStore.getState().document, title: 'Remote close version' },
    });
    usePaperLossPreventionStore.getState().discard();
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest?.documentTitles)
      .toContain('Remote close version'));
    usePaperLossPreventionStore.getState().cancel();

    await expect(request).resolves.toBe(false);
    expect(usePaperStore.getState().documents.map((document) => document.id)).toContain(documentId);
    expect(usePaperStore.getState().document.title).toBe('Remote close version');
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });

  it('after reauthorization closes only the original tab and recovers its approved version', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().createNewDocument({ title: 'Dirty close tab B' });
    const tabBId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    usePaperStore.getState().setActiveDocument(documentId);
    const request = requestClosePaperDocument(documentId);

    usePaperStore.getState().setActiveDocument(tabBId);
    usePaperLossPreventionStore.getState().discard();
    await vi.waitFor(() => expect(usePaperLossPreventionStore.getState().activeRequest).not.toBeNull());
    usePaperLossPreventionStore.getState().discard();

    await expect(request).resolves.toBe(true);
    expect(usePaperStore.getState().documents.map((document) => document.id)).not.toContain(documentId);
    expect(usePaperStore.getState().activeDocumentId).toBe(tabBId);
    expect(usePaperStore.getState().document.title).toBe('Dirty close tab B');
    const recovery = usePaperStore.getState().discardedDocumentRecoveries.at(-1);
    expect(recovery?.snapshot.id).toBe(documentId);
    expect(recovery?.snapshot.document.title).toBe('Project replacement');
  });

  it('does not close a target that was closed and reopened while its dialog was open', async () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    const request = requestClosePaperDocument(documentId);
    usePaperStore.getState().closeDocument(documentId, { discard: true, recoveryReason: 'discard' });
    const recoveryId = usePaperStore.getState().discardedDocumentRecoveries.at(-1)!.id;
    usePaperStore.getState().restoreDiscardedDocument(recoveryId);
    usePaperLossPreventionStore.getState().discard();

    await expect(request).resolves.toBe(false);
    expect(usePaperStore.getState().documents.map((document) => document.id)).toContain(documentId);
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(0);
  });
});
