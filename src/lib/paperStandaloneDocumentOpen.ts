import {
  paperAssetRepository,
} from '../features/paper/assets/PaperAssetRuntime';
import {
  prepareSlpprDocument,
} from '../features/paper/SlpprFormat';
import type { PaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import { selectEditBaton, useEditLockStore } from '../store/editLockStore';
import {
  capturePaperWorkspaceAuthorization,
  isPaperWorkspaceAuthorizationCurrent,
  usePaperStore,
  type PaperWorkspaceAuthorization,
} from '../store/paperStore';
import { getLocalDeviceId } from './deviceIdentity';
import { parsePaperDocument } from './paperDocument';
import { isSimultaneousProjectSyncSession } from './remoteHostClient';

interface PaperEditBatonScope {
  deviceId: string;
  signature: string;
  simultaneous: boolean;
}

export interface StandaloneSlpprOpenOptions {
  repository?: PaperAssetRepository;
  path?: string;
  /** Desktop callers bind this to the exact non-stale ProjectAuthorityClient state they captured. */
  isProjectAuthorityCurrent?: () => boolean;
}

// Standalone packages can contain the same content-addressed record. Their rollback snapshots are
// only exclusive while the complete prepare/publish/tab-commit transaction is exclusive too: two
// prepares that both observe an absent digest cannot safely decide which later write they own.
// Keep this queue local to standalone opens; unrelated Paper and project work remains concurrent.
let standaloneOpenTail: Promise<void> = Promise.resolve();

function enqueueStandaloneOpen<T>(open: () => Promise<T>): Promise<T> {
  const result = standaloneOpenTail.then(open, open);
  standaloneOpenTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function stableBatonOwnershipSignature(): string {
  const { lock, ownershipEpoch } = useEditLockStore.getState();
  // Heartbeats intentionally advance revision/expiry while ownership stays unchanged. Binding to
  // the store's continuity epoch also distinguishes release/transfer/reacquisition sequences whose
  // final holder happens to match the initial holder.
  return JSON.stringify(lock
    ? {
        mode: 'managed',
        holderId: lock.holder?.id ?? null,
        holderEpoch: lock.holder ? lock.heldSince : null,
        ownershipEpoch,
      }
    : { mode: 'unmanaged', ownershipEpoch });
}

function projectAuthorityIsCurrent(guard: (() => boolean) | undefined): boolean {
  try {
    return guard?.() !== false;
  } catch {
    return false;
  }
}

function captureEditBatonScope(): PaperEditBatonScope {
  const lock = useEditLockStore.getState().lock;
  const deviceId = getLocalDeviceId();
  const baton = selectEditBaton(lock, deviceId);
  const simultaneous = isSimultaneousProjectSyncSession();
  if (!simultaneous && !baton.canEdit) {
    throw new Error(`${baton.holderLabel ?? 'Another device'} is editing this project. Take over before opening a Paper layout.`);
  }
  return Object.freeze({ deviceId, signature: stableBatonOwnershipSignature(), simultaneous });
}

function isEditBatonScopeCurrent(scope: PaperEditBatonScope): boolean {
  const lock = useEditLockStore.getState().lock;
  if (scope.simultaneous) {
    return scope.deviceId === getLocalDeviceId() && isSimultaneousProjectSyncSession();
  }
  return scope.deviceId === getLocalDeviceId()
    && scope.signature === stableBatonOwnershipSignature()
    && selectEditBaton(lock, scope.deviceId).canEdit;
}

function assertOwnershipCurrent(
  paper: PaperWorkspaceAuthorization,
  baton: PaperEditBatonScope,
  projectGuard: (() => boolean) | undefined,
): void {
  if (!projectAuthorityIsCurrent(projectGuard)) {
    throw new Error('The desktop project authority changed while the Paper layout was opening. Retry from the current project window.');
  }
  if (!isEditBatonScopeCurrent(baton)) {
    throw new Error('Paper edit-baton ownership changed while the layout was opening. Retry after taking edit control.');
  }
  if (!isPaperWorkspaceAuthorizationCurrent(paper)) {
    throw new Error('The Paper workspace changed while the layout was opening. Retry the open operation.');
  }
}

/**
 * Add a standalone `.slppr` as a clean Paper tab through one exact ownership transaction. Package
 * bytes are validated and staged first; managed records and the tab become live only while the
 * original Paper workspace, edit baton, and optional desktop project authority are still current.
 */
async function runStandaloneSlpprOpen(
  bytes: Uint8Array,
  options: StandaloneSlpprOpenOptions = {},
): Promise<string> {
  if (!projectAuthorityIsCurrent(options.isProjectAuthorityCurrent)) {
    throw new Error('This window does not hold current project authority for opening a Paper layout.');
  }
  const baton = captureEditBatonScope();
  const paper = capturePaperWorkspaceAuthorization();
  const prepared = await prepareSlpprDocument(bytes, options.repository ?? paperAssetRepository);
  try {
    // Parse before any live repository/store commit. This retains the existing strict Paper
    // sanitizer while making malformed packages a zero-side-effect failure.
    const document = parsePaperDocument(JSON.stringify(prepared.document));
    assertOwnershipCurrent(paper, baton, options.isProjectAuthorityCurrent);
    await prepared.commitAssets();
    assertOwnershipCurrent(paper, baton, options.isProjectAuthorityCurrent);
    const documentId = usePaperStore.getState().openDocumentJson(JSON.stringify(document), {
      authorization: paper,
      source: 'standalone',
      ...(options.path ? { path: options.path } : {}),
    });
    if (!documentId) {
      throw new Error('The Paper workspace changed at the standalone layout commit boundary. Retry the open operation.');
    }
    prepared.finalize();
    return documentId;
  } catch (error) {
    await prepared.rollbackAssets();
    throw error;
  }
}

export async function openStandaloneSlpprDocument(
  bytes: Uint8Array,
  options: StandaloneSlpprOpenOptions = {},
): Promise<string> {
  // Own the mutable request bytes and option values at submission time. Workspace/baton/project
  // authority is deliberately captured only when this request reaches the head of the queue.
  const ownedBytes = new Uint8Array(bytes);
  const ownedOptions: StandaloneSlpprOpenOptions = {
    ...(options.repository ? { repository: options.repository } : {}),
    ...(options.path ? { path: options.path } : {}),
    ...(options.isProjectAuthorityCurrent
      ? { isProjectAuthorityCurrent: options.isProjectAuthorityCurrent }
      : {}),
  };
  return enqueueStandaloneOpen(() => runStandaloneSlpprOpen(ownedBytes, ownedOptions));
}
