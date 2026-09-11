import { beforeEach, describe, expect, it, vi } from 'vitest';

const remoteMode = vi.hoisted(() => ({ simultaneous: false }));
vi.mock('./remoteHostClient', () => ({
  isSimultaneousProjectSyncSession: () => remoteMode.simultaneous,
}));

import { serializeSlppr } from '../features/paper/SlpprFormat';
import {
  MemoryPaperAssetRepository,
  type PaperAssetRepository,
} from '../features/paper/assets/PaperAssetRepository';
import { createBinaryAssetRecord, type BinaryAssetRecord } from '../shared/assets/contentAddressedAsset';
import { useEditLockStore } from '../store/editLockStore';
import { usePaperStore } from '../store/paperStore';
import type { PaperDocument } from '../types/paper';
import { getLocalDevice } from './deviceIdentity';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import type { EditLockDevice, EditLockState } from './projectEditLock';
import { openStandaloneSlpprDocument } from './paperStandaloneDocumentOpen';

function resetPaperStore(): void {
  const document = createDefaultPaperDocument({ title: 'Existing project layout' });
  usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
}

function importedDocument(
  record: BinaryAssetRecord,
  id = 'standalone-paper',
  title = 'Imported standalone layout',
): PaperDocument {
  let document = createDefaultPaperDocument({ title });
  document.id = id;
  document = addFrameToPaperPage(document, document.pages[0].id, {
    id: 'standalone-image',
    kind: 'image',
    label: 'Managed cover',
    xMm: 10,
    yMm: 10,
    widthMm: 50,
    heightMm: 40,
    asset: {
      label: 'cover.png',
      kind: 'image',
      mimeType: 'image/png',
      locator: { kind: 'managed', ref: record.ref },
    },
  }).document;
  return document;
}

function heldLock(
  holder: EditLockDevice,
  revision: number,
  expiresAt = Date.now() + 60_000,
  heldSince = Date.now(),
): EditLockState {
  return {
    revision,
    holder,
    pending: null,
    heldSince,
    expiresAt,
    pendingExpiresAt: 0,
  };
}

function freeLock(revision: number): EditLockState {
  return {
    revision,
    holder: null,
    pending: null,
    heldSince: 0,
    expiresAt: 0,
    pendingExpiresAt: 0,
  };
}

async function standaloneFixture(options: {
  recordBytes?: readonly number[];
  documentId?: string;
  title?: string;
  fileName?: string;
} = {}): Promise<{
  bytes: Uint8Array;
  document: PaperDocument;
  record: BinaryAssetRecord;
}> {
  const source = new MemoryPaperAssetRepository();
  const record = await createBinaryAssetRecord(new Uint8Array(options.recordBytes ?? [1, 3, 5, 7]), {
    mimeType: 'image/png',
    fileName: options.fileName ?? 'cover.png',
  });
  await source.put(record);
  const document = importedDocument(record, options.documentId, options.title);
  return { bytes: await serializeSlppr(document, source), document, record };
}

class DelayedReadRepository implements PaperAssetRepository {
  readonly inner = new MemoryPaperAssetRepository();
  readCount = 0;
  private releaseRead: (() => void) | undefined;
  readonly readStarted = new Promise<void>((resolve) => {
    this.releaseRead = resolve;
  });
  private continueRead: (() => void) | undefined;
  private readonly readCanContinue = new Promise<void>((resolve) => {
    this.continueRead = resolve;
  });
  private notifySecondRead: (() => void) | undefined;
  readonly secondReadStarted = new Promise<void>((resolve) => {
    this.notifySecondRead = resolve;
  });
  private delayed = false;

  release(): void {
    this.continueRead?.();
  }

  put(record: BinaryAssetRecord) {
    return this.inner.put(record);
  }

  putAllAtomic(records: readonly BinaryAssetRecord[]) {
    return this.inner.putAllAtomic(records);
  }

  async get(id: BinaryAssetRecord['ref']['id']) {
    this.readCount += 1;
    if (this.readCount === 2) this.notifySecondRead?.();
    if (!this.delayed) {
      this.delayed = true;
      this.releaseRead?.();
      await this.readCanContinue;
    }
    return this.inner.get(id);
  }

  has(id: BinaryAssetRecord['ref']['id']) {
    return this.inner.has(id);
  }

  delete(id: BinaryAssetRecord['ref']['id']) {
    return this.inner.delete(id);
  }

  listRefs() {
    return this.inner.listRefs();
  }
}

class FailFirstAtomicRepository extends MemoryPaperAssetRepository {
  private shouldFail = true;

  override async putAllAtomic(records: readonly BinaryAssetRecord[]) {
    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error('injected first publication failure');
    }
    return super.putAllAtomic(records);
  }
}

beforeEach(() => {
  remoteMode.simultaneous = false;
  resetPaperStore();
  useEditLockStore.getState().setLock(null);
});

describe('standalone .slppr ownership transaction (FBL-031)', () => {
  it('adds a validated package as a clean standalone tab and preserves its managed bytes and path', async () => {
    const { bytes, document, record } = await standaloneFixture();
    const target = new MemoryPaperAssetRepository();
    const existingIds = usePaperStore.getState().documents.map(({ id }) => id);

    const openedId = await openStandaloneSlpprDocument(bytes, {
      repository: target,
      path: '/layouts/cover.slppr',
    });

    const state = usePaperStore.getState();
    expect(openedId).toBe('standalone-paper');
    expect(state.documents.map(({ id }) => id)).toEqual([...existingIds, openedId]);
    expect(state.document).toMatchObject({ id: document.id, title: document.title });
    expect(state.documents.at(-1)?.persistence).toMatchObject({
      kind: 'standalone',
      path: '/layouts/cover.slppr',
    });
    expect(state.isDocumentDirty(openedId)).toBe(false);
    expect(await target.get(record.ref.id)).toEqual(record);
  });

  it('refuses a local open while another device holds the edit baton without staging bytes or changing tabs', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new MemoryPaperAssetRepository();
    const before = usePaperStore.getState().exportSnapshot({ includeLocalPersistence: true });
    useEditLockStore.getState().setLock(heldLock({ id: 'phone-other', label: 'Phone' }, 9));

    await expect(openStandaloneSlpprDocument(bytes, { repository: target }))
      .rejects.toThrow(/is editing this project/i);

    expect(usePaperStore.getState().exportSnapshot({ includeLocalPersistence: true })).toEqual(before);
    expect(await target.get(record.ref.id)).toBeUndefined();
  });

  it('allows a standalone open while both devices edit in simultaneous mode', async () => {
    const { bytes } = await standaloneFixture();
    remoteMode.simultaneous = true;
    useEditLockStore.getState().setLock(heldLock({ id: 'phone-other', label: 'Phone' }, 10));

    await expect(openStandaloneSlpprDocument(bytes, {
      repository: new MemoryPaperAssetRepository(),
    })).resolves.toBe('standalone-paper');
  });

  it('accepts the open when this device holds the edit baton', async () => {
    const { bytes } = await standaloneFixture();
    const local = getLocalDevice();
    useEditLockStore.getState().setLock(heldLock(local, 3));

    await expect(openStandaloneSlpprDocument(bytes, {
      repository: new MemoryPaperAssetRepository(),
    })).resolves.toBe('standalone-paper');
  });

  it('rolls managed records back exactly when baton ownership changes during the asynchronous open', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();
    const corruptPrevious = { ...record, bytes: new Uint8Array([9, 9, 9, 9]) };
    await target.put(corruptPrevious);
    const local = getLocalDevice();
    useEditLockStore.getState().setLock(heldLock(local, 10));
    const before = usePaperStore.getState().exportSnapshot({ includeLocalPersistence: true });

    const opening = openStandaloneSlpprDocument(bytes, { repository: target });
    await target.readStarted;
    useEditLockStore.getState().setLock(heldLock({ id: 'phone-other', label: 'Phone' }, 11));
    target.release();

    await expect(opening).rejects.toThrow(/ownership changed/i);
    expect(usePaperStore.getState().exportSnapshot({ includeLocalPersistence: true })).toEqual(before);
    expect(await target.get(record.ref.id)).toEqual(corruptPrevious);
  });

  it('does not mistake a same-holder heartbeat for an ownership transfer', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();
    const local = getLocalDevice();
    const holderEpoch = 1_000;
    useEditLockStore.getState().setLock(heldLock(local, 20, Date.now() + 30_000, holderEpoch));
    const ownershipEpoch = useEditLockStore.getState().ownershipEpoch;

    const opening = openStandaloneSlpprDocument(bytes, { repository: target });
    await target.readStarted;
    useEditLockStore.getState().setLock(heldLock(local, 21, Date.now() + 60_000, holderEpoch));
    expect(useEditLockStore.getState().ownershipEpoch).toBe(ownershipEpoch);
    target.release();

    await expect(opening).resolves.toBe('standalone-paper');
    expect(await target.get(record.ref.id)).toEqual(record);
  });

  it('rejects a release while baseline capture is paused and restores the exact prior record', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();
    const priorRecord = { ...record, bytes: new Uint8Array([7, 7, 7, 7]) };
    await target.put(priorRecord);
    const local = getLocalDevice();
    useEditLockStore.getState().setLock(heldLock(local, 30, Date.now() + 60_000, 1_000));

    const opening = openStandaloneSlpprDocument(bytes, { repository: target });
    await target.readStarted;
    useEditLockStore.getState().setLock(freeLock(31));
    target.release();

    await expect(opening).rejects.toThrow(/ownership changed/i);
    expect(await target.get(record.ref.id)).toEqual(priorRecord);
    expect(usePaperStore.getState().documents).toHaveLength(1);
  });

  it('rejects local-to-other-to-local reacquisition even when the final holder ID matches', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();
    const priorRecord = { ...record, bytes: new Uint8Array([6, 6, 6, 6]) };
    await target.put(priorRecord);
    const local = getLocalDevice();
    useEditLockStore.getState().setLock(heldLock(local, 40, Date.now() + 60_000, 1_000));

    const opening = openStandaloneSlpprDocument(bytes, { repository: target });
    await target.readStarted;
    useEditLockStore.getState().setLock(heldLock(
      { id: 'phone-other', label: 'Phone' },
      41,
      Date.now() + 60_000,
      2_000,
    ));
    useEditLockStore.getState().setLock(heldLock(local, 42, Date.now() + 60_000, 3_000));
    target.release();

    await expect(opening).rejects.toThrow(/ownership changed/i);
    expect(await target.get(record.ref.id)).toEqual(priorRecord);
    expect(usePaperStore.getState().documents).toHaveLength(1);
  });

  it('rejects an unmanaged-to-managed-to-unmanaged continuity break', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();
    const local = getLocalDevice();
    useEditLockStore.getState().setLock(null);

    const opening = openStandaloneSlpprDocument(bytes, { repository: target });
    await target.readStarted;
    useEditLockStore.getState().setLock(heldLock(local, 50, Date.now() + 60_000, 4_000));
    useEditLockStore.getState().setLock(null);
    target.release();

    await expect(opening).rejects.toThrow(/ownership changed/i);
    expect(await target.get(record.ref.id)).toBeUndefined();
    expect(usePaperStore.getState().documents).toHaveLength(1);
  });

  it('admits a queued request against the ownership epoch current when it reaches the queue head', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();
    const local = getLocalDevice();
    useEditLockStore.getState().setLock(heldLock(local, 60, Date.now() + 60_000, 5_000));

    const staleFirst = openStandaloneSlpprDocument(bytes, { repository: target });
    await target.readStarted;
    const queuedCurrent = openStandaloneSlpprDocument(bytes, { repository: target });
    useEditLockStore.getState().setLock(heldLock(
      { id: 'phone-other', label: 'Phone' },
      61,
      Date.now() + 60_000,
      6_000,
    ));
    useEditLockStore.getState().setLock(heldLock(local, 62, Date.now() + 60_000, 7_000));
    target.release();

    await expect(staleFirst).rejects.toThrow(/ownership changed/i);
    await expect(queuedCurrent).resolves.toBe('standalone-paper');
    expect(await target.get(record.ref.id)).toEqual(record);
    expect(usePaperStore.getState().documents).toHaveLength(2);
  });

  it('rolls managed records back when Paper changes before the commit boundary', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();
    const beforeIds = usePaperStore.getState().documents.map(({ id }) => id);

    const opening = openStandaloneSlpprDocument(bytes, { repository: target });
    await target.readStarted;
    usePaperStore.getState().addPage();
    target.release();

    await expect(opening).rejects.toThrow(/workspace changed/i);
    expect(usePaperStore.getState().documents.map(({ id }) => id)).toEqual(beforeIds);
    expect(await target.get(record.ref.id)).toBeUndefined();
  });

  it('honors a desktop project-authority guard at start and revalidates it after asset publication', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();
    let projectAuthorityCurrent = true;

    const opening = openStandaloneSlpprDocument(bytes, {
      repository: target,
      isProjectAuthorityCurrent: () => projectAuthorityCurrent,
    });
    await target.readStarted;
    projectAuthorityCurrent = false;
    target.release();

    await expect(opening).rejects.toThrow(/project authority changed/i);
    expect(usePaperStore.getState().documents).toHaveLength(1);
    expect(await target.get(record.ref.id)).toBeUndefined();

    await expect(openStandaloneSlpprDocument(bytes, {
      repository: target,
      isProjectAuthorityCurrent: () => false,
    })).rejects.toThrow(/project authority/i);
    expect(await target.get(record.ref.id)).toBeUndefined();
  });

  it('reopens the same standalone document as a distinct clean tab without changing the first backing path', async () => {
    const { bytes } = await standaloneFixture();
    const target = new MemoryPaperAssetRepository();

    const first = await openStandaloneSlpprDocument(bytes, {
      repository: target,
      path: '/layouts/first.slppr',
    });
    const second = await openStandaloneSlpprDocument(bytes, {
      repository: target,
      path: '/layouts/second.slppr',
    });

    expect(first).toBe('standalone-paper');
    expect(second).toBe('standalone-paper-2');
    expect(usePaperStore.getState().documents.slice(-2).map(({ id, persistence }) => ({
      id,
      kind: persistence?.kind,
      path: persistence?.path,
    }))).toEqual([
      { id: 'standalone-paper', kind: 'standalone', path: '/layouts/first.slppr' },
      { id: 'standalone-paper-2', kind: 'standalone', path: '/layouts/second.slppr' },
    ]);
    expect(usePaperStore.getState().isDocumentDirty(first)).toBe(false);
    expect(usePaperStore.getState().isDocumentDirty(second)).toBe(false);
  });

  it('serializes concurrent same-record opens so a successful tab always retains its shared managed record', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();

    const first = openStandaloneSlpprDocument(bytes, {
      repository: target,
      path: '/layouts/concurrent-first.slppr',
    });
    await target.readStarted;
    const second = openStandaloneSlpprDocument(bytes, {
      repository: target,
      path: '/layouts/concurrent-second.slppr',
    });

    const secondEnteredBeforeRelease = await Promise.race([
      target.secondReadStarted.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(secondEnteredBeforeRelease).toBe(false);
    expect(target.readCount).toBe(1);

    target.release();
    await expect(Promise.all([first, second])).resolves.toEqual([
      'standalone-paper',
      'standalone-paper-2',
    ]);
    expect(await target.get(record.ref.id)).toEqual(record);
    expect(usePaperStore.getState().documents.slice(-2).map(({ persistence }) => persistence?.path))
      .toEqual(['/layouts/concurrent-first.slppr', '/layouts/concurrent-second.slppr']);
  });

  it('settles concurrent different-record opens without losing either package asset', async () => {
    const firstFixture = await standaloneFixture();
    const secondFixture = await standaloneFixture({
      recordBytes: [2, 4, 6, 8],
      documentId: 'second-standalone-paper',
      title: 'Second standalone layout',
      fileName: 'second-cover.png',
    });
    const target = new MemoryPaperAssetRepository();

    await expect(Promise.all([
      openStandaloneSlpprDocument(firstFixture.bytes, { repository: target }),
      openStandaloneSlpprDocument(secondFixture.bytes, { repository: target }),
    ])).resolves.toEqual(['standalone-paper', 'second-standalone-paper']);

    expect(await target.get(firstFixture.record.ref.id)).toEqual(firstFixture.record);
    expect(await target.get(secondFixture.record.ref.id)).toEqual(secondFixture.record);
  });

  it('continues the queue after a publication failure and commits the following request', async () => {
    const failedFixture = await standaloneFixture();
    const successfulFixture = await standaloneFixture({
      recordBytes: [8, 6, 4, 2],
      documentId: 'recovered-standalone-paper',
      title: 'Recovered standalone layout',
      fileName: 'recovered-cover.png',
    });
    const target = new FailFirstAtomicRepository();

    const failed = openStandaloneSlpprDocument(failedFixture.bytes, { repository: target });
    const recovered = openStandaloneSlpprDocument(successfulFixture.bytes, { repository: target });

    await expect(failed).rejects.toThrow(/injected first publication failure/i);
    await expect(recovered).resolves.toBe('recovered-standalone-paper');
    expect(await target.get(failedFixture.record.ref.id)).toBeUndefined();
    expect(await target.get(successfulFixture.record.ref.id)).toEqual(successfulFixture.record);
  });

  it('rechecks queued project authority before staging while preserving the preceding winner', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new DelayedReadRepository();
    let queuedAuthorityCurrent = true;

    const winner = openStandaloneSlpprDocument(bytes, { repository: target });
    await target.readStarted;
    const stale = openStandaloneSlpprDocument(bytes, {
      repository: target,
      isProjectAuthorityCurrent: () => queuedAuthorityCurrent,
    });
    queuedAuthorityCurrent = false;
    target.release();

    await expect(winner).resolves.toBe('standalone-paper');
    await expect(stale).rejects.toThrow(/does not hold current project authority/i);
    expect(await target.get(record.ref.id)).toEqual(record);
    expect(usePaperStore.getState().documents).toHaveLength(2);
  });

  it('keeps committed managed bytes when a Paper store observer throws after the tab assignment', async () => {
    const { bytes, record } = await standaloneFixture();
    const target = new MemoryPaperAssetRepository();
    const unsubscribe = usePaperStore.subscribe(() => {
      throw new Error('broken Paper observer');
    });

    try {
      await expect(openStandaloneSlpprDocument(bytes, { repository: target }))
        .resolves.toBe('standalone-paper');
    } finally {
      unsubscribe();
    }

    expect(usePaperStore.getState().activeDocumentId).toBe('standalone-paper');
    expect(await target.get(record.ref.id)).toEqual(record);
  });
});
