import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  deleteImportedAsset,
  createStoredAssetTransportMetadata,
  createStoredAssetTransportRecord,
  createStoredAssetTransportSample,
  loadImportedAsset,
  loadImportedAssetAsDataUrl,
  loadImportedAssetBlob,
  loadImportedAssetRecord,
  saveDataUrlAsset,
  saveImportedAsset,
  type StoredAssetPayload,
  type StoredAssetRecord,
} from '../lib/assetStore';
import { readBoundedBytesResponse } from '../lib/boundedResponse';
import { visitBase64DataUrlBytes } from '../lib/boundedDataUrl';
import { MAX_BINARY_RESUME_BYTES } from '../lib/binaryResumeSniffer';
import {
  loadScratchAssetBlob,
  storeScratchAssetBlob,
} from '../lib/fileSystemWorkspace';
import {
  isAndroidSourceAssetPermissionError,
  materializeAndroidSourceAsset,
} from '../lib/androidSourceAssetStorage';
import { buildMediaAssetSignaturePart } from '../lib/mediaAssetSignature';
import { isSignalLoomAssetUrl, parseSignalLoomAssetId } from '../lib/signalLoomAssetUrl';
import {
  captureProjectAuthorityMutationScope,
  getSignalLoomNativeBridge,
  isCurrentProjectAuthorityMutationScope,
  type ProjectAuthorityMutationScope,
} from '../lib/nativeApp';
import { initializeLanServerProxy, notifyLanSourceLibraryChange } from '../lib/androidLanServer';
import { getHostSourceLibraryVersion } from '../lib/lanHostService';
import {
  applySourceLibraryNativeChange,
  buildSourceLibraryNativeSyncStatus,
  sourceLibraryNativeAckNeedsRepair,
  type SourceLibraryNativeAckResult,
  type SourceLibraryNativeChange,
  type SourceLibraryNativeSyncStatus,
} from '../lib/sourceLibraryNativeSync';
import { localizeAssetForProject } from '../lib/sourceBinPersistence';
import type { EditorSourceKind } from '../types/flow';
import { VIDEO_PROFESSIONAL_STATE_VERSION, type SourceBinProfessionalMediaState } from '../types/videoProfessional';
import { sanitizeSourceBinProfessionalMediaState } from '../lib/videoProfessionalState';
import type { SourceBinItem } from '../lib/sourceBin';
import {
  takePendingSourceBinIngestItems,
  buildConnectedItemSourceKey,
} from '../lib/sourceBinIngest';
import {
  getDefaultMimeTypeForKind,
  inferDownloadExtension,
  inferMimeTypeFromFile,
  inferSourceKindFromFile,
} from '../lib/mediaFormatRegistry';
import {
  canInlineFailedMediaImport,
  shouldSessionLinkBrowserMedia,
} from '../lib/browserMediaIngestPolicy';
import { createSourceAssetHandlePool } from '../lib/sourceAssetHandlePool';
import { postWorkspaceWindowCommand } from '../lib/workspaceWindowCommands';
import {
  createSourceBin,
  getAllSourceBinItems,
  removeSourceBin,
  renameSourceBin,
  setSourceBinCollapsed,
} from './sourceBin/slices/libraryActions';
import {
  removeSourceBinItem,
  renameSourceBinItem,
  updateSourceBinItemProfessionalState,
  setSourceBinEnvelopeCollapsed,
  setAllSourceBinItemsCollapsed,
  setSourceBinItemCollapsed,
  toggleSourceBinItemStarred,
} from './sourceBin/slices/itemActions';
import { showAlertDialog } from './alertDialogStore';
import {
  isHaneProviderBinId,
  isHaneProviderSourceItem,
} from '../lib/haneLinkProviderContract';

export interface SourceBinLibraryItem {
  id: string;
  label: string;
  kind: EditorSourceKind;
  mimeType?: string;
  assetId?: string;
  assetUrl?: string;
  scratchFileName?: string;
  nativeFilePath?: string;
  text?: string;
  pixelWidth?: number;
  pixelHeight?: number;
  createdAt: number;
  sourceKey?: string;
  originNodeId?: string;
  originWorkspaceId?: string;
  originRunId?: string;
  starred?: boolean;
  collapsed?: boolean;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
  envelopeCollapsed?: boolean;
  isGenerated?: boolean;
  durability?: SourceLibraryItemDurability;
  durabilityMessage?: string;
  /** Imported/generated identity, online/proxy state, color metadata, and transcript sidecar. */
  professional?: SourceBinProfessionalMediaState;
}

export type SourceLibraryItemDurability = 'recovery-inline' | 'session-only' | 'unavailable';

export interface SourceLibraryDurabilityStatus {
  state: 'ready' | 'degraded';
  message?: string;
  affectedItemIds?: string[];
  updatedAt?: number;
}

export interface SourceBin {
  id: string;
  name: string;
  items: SourceBinLibraryItem[];
  collapsed: boolean;
  createdAt: number;
}

export interface SourceBinProjectSnapshot {
  bins?: Array<SourceBin & { items: Array<SourceBinLibraryItem & { assetUrl?: string }> }>;
  items?: Array<SourceBinLibraryItem & { assetUrl?: string }>;
  dismissedSourceKeys: string[];
}

export type PersistedSourceBinState = {
  bins?: SourceBin[];
  items?: SourceBinLibraryItem[];
  dismissedSourceKeys?: string[];
  sidebarOpen?: boolean;
  nativeScratchDirectoryPath?: string;
  durabilityStatus?: SourceLibraryDurabilityStatus;
};

/**
 * Decide which `assetUrl` (if any) is safe to PERSIST to localStorage for a source-bin item.
 *
 * Persistence normally stores a small, durable POINTER rather than resolved asset bytes. The one
 * exception is a fallback-only item whose durable asset write failed: its `recovery-inline` data
 * URL is the last recoverable copy, so it must survive a reload if localStorage has room. A
 * native-file item carries a tiny native/capacitor pointer (`file://…` / `https://localhost/
 * _capacitor_file_/…`, ~150 chars) worth persisting so the native file can be re-opened. But a
 * `data:` / `blob:` URL is resolved bytes: on a phone-served LAN desktop client, `hydrateAssets`
 * REPLACES a native item's (unreachable) capacitor `assetUrl` with the multi-MB `data:` thumbnail
 * it streamed from the host — while `nativeFilePath` stays set. Persisting those re-derivable
 * base64 thumbnails (one per item, several MB each) blows the ~5 MB localStorage quota; the
 * `setItem` then throws,
 * which propagates through zustand's persist into EVERY subsequent `setState` — breaking live-sync
 * apply (the item never lands → no thumbnail → "Preview unavailable") and Image export ("The quota
 * has been exceeded"). Those bytes are re-derivable at runtime (re-streamed via
 * `/source-asset/:itemId`, keyed by the persisted `item.id`), so we do not persist them.
 */
export function persistableSourceBinAssetUrl(
  item: Pick<SourceBinLibraryItem, 'assetId' | 'scratchFileName' | 'nativeFilePath' | 'assetUrl' | 'durability'>,
): string | undefined {
  const url = item.assetUrl;
  if (!url) {
    return undefined;
  }
  const hasDurableBacking = Boolean(item.assetId || item.scratchFileName || item.nativeFilePath);
  if (url.startsWith('data:')) {
    return !hasDurableBacking && item.durability === 'recovery-inline' ? url : undefined;
  }
  if (url.startsWith('blob:')) {
    return undefined;
  }
  return item.nativeFilePath ? url : undefined;
}

const SOURCE_LIBRARY_STORAGE_WARNING = 'Source Library storage is degraded. Some items may require regeneration or reimport after reload; review affected items before closing Sloom Studio.';
const SOURCE_LIBRARY_QUOTA_ITEM_WARNING = 'Recovery bytes did not fit in browser storage. The item record was kept, but its preview must be regenerated or reimported after reload.';
const LEGACY_NATIVE_ASSET_WARNING = 'Some legacy project media points to external bytes that are not available on this device. Recoverable Source Library copies were restored; relink or reimport the remaining listed items.';
const LEGACY_NATIVE_ASSET_ITEM_WARNING = 'This legacy project reference has no recoverable local bytes on this device. Relink or reimport the source media.';
const NATIVE_MEDIA_RELINK_REQUIRED_ITEM_WARNING = 'This saved media location is not authorized in this desktop session. Use Relink… to select it again.';
const REMOTE_HOST_ASSET_ITEM_WARNING = 'This media is temporarily unavailable from the connected phone. Keep the phone server connected; Sloom Studio will retry automatically.';

function markLegacyNativeAssetUnavailable(item: SourceBinLibraryItem): SourceBinLibraryItem {
  const parsedAssetId = parseSignalLoomAssetId(item.assetUrl);
  return {
    ...item,
    assetId: item.assetId ?? parsedAssetId ?? undefined,
    // Browsers and Android cannot resolve Electron's protocol. Leaving the URL in `src` makes every
    // thumbnail/render retry a guaranteed failing network request and floods the console without
    // improving recovery. Keep the identity/provenance, but make the missing state explicit.
    assetUrl: undefined,
    durability: 'unavailable',
    durabilityMessage: LEGACY_NATIVE_ASSET_ITEM_WARNING,
    professional: item.professional ? { ...item.professional, onlineState: 'offline' } : item.professional,
  };
}

function markNativeMediaRelinkRequired(item: SourceBinLibraryItem): SourceBinLibraryItem {
  return {
    ...markLegacyNativeAssetUnavailable(item),
    durabilityMessage: NATIVE_MEDIA_RELINK_REQUIRED_ITEM_WARNING,
  };
}

function markNativeMediaAvailable(item: SourceBinLibraryItem): SourceBinLibraryItem {
  return {
    ...item,
    durability: undefined,
    durabilityMessage: undefined,
    professional: item.professional ? { ...item.professional, onlineState: 'online' } : item.professional,
  };
}

function markRemoteHostAssetTemporarilyUnavailable(item: SourceBinLibraryItem): SourceBinLibraryItem {
  return {
    ...item,
    // Do not let an unreachable phone-local URL churn the browser console. Identity is retained and
    // every later hydration retries the authenticated host route.
    assetUrl: undefined,
    durability: 'unavailable',
    durabilityMessage: REMOTE_HOST_ASSET_ITEM_WARNING,
  };
}

async function loadImportedAssetIfAvailable(assetId: string): Promise<Awaited<ReturnType<typeof loadImportedAsset>> | undefined> {
  try {
    return await loadImportedAsset(assetId);
  } catch {
    return undefined;
  }
}

export function recoverSourceBinStorageValueAfterQuotaFailure(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.state) || !Array.isArray(parsed.state.bins)) {
      return undefined;
    }

    let changed = false;
    const bins = parsed.state.bins.map((bin) => {
      if (!isRecord(bin) || !Array.isArray(bin.items)) return bin;
      const items = bin.items.map((item) => {
        if (
          !isRecord(item)
          || item.durability !== 'recovery-inline'
          || typeof item.assetUrl !== 'string'
          || !item.assetUrl.startsWith('data:')
        ) {
          return item;
        }
        changed = true;
        return {
          ...item,
          assetUrl: undefined,
          durability: 'unavailable',
          durabilityMessage: SOURCE_LIBRARY_QUOTA_ITEM_WARNING,
        };
      });
      return { ...bin, items };
    });
    if (!changed) return undefined;

    return JSON.stringify({
      ...parsed,
      state: {
        ...parsed.state,
        bins,
        durabilityStatus: {
          state: 'degraded',
          message: SOURCE_LIBRARY_STORAGE_WARNING,
          updatedAt: Date.now(),
        },
      },
    });
  } catch {
    return undefined;
  }
}

/**
 * Defense-in-depth: a persist write must NEVER throw into `setState`. zustand's persist middleware
 * calls `storage.setItem` synchronously inside the state update; a `QuotaExceededError` (or any
 * storage failure) thrown there propagates out of `set(...)` and breaks the action that triggered
 * it — which is precisely how a full quota turned into broken live-sync and an "Image Export Failed"
 * dialog. With {@link persistableSourceBinAssetUrl} the normal persisted payload is tiny, but we
 * still wrap every storage operation so quota/availability errors cannot corrupt the running
 * session. If inline recovery bytes exceed quota, the wrapper retries with the item metadata and
 * an explicit unavailable marker instead of dropping the whole state update. Returns `undefined`
 * (persistence disabled) when there is no window, matching zustand's default behavior.
 */
export function createQuotaSafeJSONStorage() {
  return createJSONStorage(() => {
    // Reference window.localStorage directly (like zustand's default): if it's unavailable (SSR /
    // node tests) this throws, createJSONStorage catches it and returns undefined, and persist
    // no-ops gracefully — matching prior behavior. When it IS available, every operation is
    // guarded so a quota or availability failure becomes visible degraded state rather than an
    // exception escaping into application actions.
    const base = window.localStorage;
    return {
      getItem: (name: string) => {
        try {
          return base.getItem(name);
        } catch (error) {
          scheduleSourceLibraryDurabilityFailure(SOURCE_LIBRARY_STORAGE_WARNING);
          console.warn('[sourceBinStore] persisted Source Library state unavailable:', error);
          return null;
        }
      },
      setItem: (name: string, value: string) => {
        try {
          base.setItem(name, value);
        } catch (error) {
          const recoveryValue = recoverSourceBinStorageValueAfterQuotaFailure(value);
          if (recoveryValue) {
            try {
              base.setItem(name, recoveryValue);
            } catch {
              // The runtime warning below remains the only safe recovery when storage is unavailable.
            }
          }
          scheduleSourceLibraryDurabilityFailure(SOURCE_LIBRARY_STORAGE_WARNING);
          console.warn('[sourceBinStore] persist skipped (storage quota/availability):', error);
        }
      },
      removeItem: (name: string) => {
        try {
          base.removeItem(name);
        } catch (error) {
          scheduleSourceLibraryDurabilityFailure(SOURCE_LIBRARY_STORAGE_WARNING);
          console.warn('[sourceBinStore] persisted Source Library state could not be removed:', error);
        }
      },
    };
  });
}

export interface SourceBinState {
  bins: SourceBin[];
  dismissedSourceKeys: string[];
  sidebarOpen: boolean;
  nativeSyncStatus: SourceLibraryNativeSyncStatus;
  durabilityStatus: SourceLibraryDurabilityStatus;
  scratchDirectoryHandle?: FileSystemDirectoryHandle;
  nativeScratchDirectoryPath?: string;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setNativeSyncStatus: (status: SourceLibraryNativeSyncStatus) => void;
  retryNativeSourceLibrarySync: () => void;
  setScratchDirectoryHandle: (scratchDirectoryHandle: FileSystemDirectoryHandle | undefined) => void;
  setNativeScratchDirectoryPath: (nativeScratchDirectoryPath: string | undefined) => void;
  migrateAssetsToScratch: (scratchDirectoryHandle: FileSystemDirectoryHandle) => Promise<number>;
  hydrateAssets: () => Promise<void>;
  reconcileWithNativeSourceLibrarySnapshot: () => Promise<void>;
  exportProjectSnapshot: (options?: { includeAssetData?: boolean }) => Promise<SourceBinProjectSnapshot>;
  prepareProjectSnapshot: (snapshot?: SourceBinProjectSnapshot) => Promise<PreparedSourceBinProjectSnapshot>;
  commitPreparedProjectSnapshot: (snapshot: PreparedSourceBinProjectSnapshot, options?: { publishNative?: boolean }) => void;
  restoreProjectSnapshot: (snapshot?: SourceBinProjectSnapshot, options?: { publishNative?: boolean }) => Promise<void>;
  getAllItems: () => SourceBinLibraryItem[];
  createBin: (name?: string) => string;
  renameBin: (id: string, name: string) => void;
  removeBin: (id: string) => void;
  setBinCollapsed: (id: string, collapsed: boolean) => void;
  addAssetItem: (item: {
    id?: string;
    label: string;
    kind: Exclude<EditorSourceKind, 'text'>;
    mimeType: string;
    dataUrl: string;
    blob?: Blob;
    nativeFilePath?: string;
    pixelWidth?: number;
    pixelHeight?: number;
    isGenerated?: boolean;
    sourceKey?: string;
    originNodeId?: string;
    originWorkspaceId?: string;
    originRunId?: string;
    envelopeId?: string;
    envelopeLabel?: string;
    envelopeIndex?: number;
    envelopeCollapsed?: boolean;
    professional?: SourceBinProfessionalMediaState;
  }, targetBinId?: string, options?: { deferPublication?: boolean }) => Promise<SourceBinLibraryItem>;
  publishProvisionalAssetItem: (id: string, targetBinId?: string) => SourceBinLibraryItem | undefined;
  discardProvisionalAssetItem: (id: string) => SourceBinLibraryItem | undefined;
  ingestConnectedItems: (
    items: SourceBinItem[],
    targetBinId?: string,
    options?: { graphNodeIds?: ReadonlySet<string> },
  ) => Promise<void>;
  importFiles: (files: File[] | FileList, targetBinId?: string) => Promise<SourceBinLibraryItem[]>;
  importNativeFiles: (items: Array<SourceBinLibraryItem & { nativeFilePath?: string }>, targetBinId?: string) => Promise<void>;
  toggleItemStarred: (id: string) => void;
  renameItem: (id: string, label: string) => void;
  updateItemProfessional: (id: string, professional: SourceBinProfessionalMediaState) => void;
  updateItemsProfessional: (updates: readonly { id: string; professional: SourceBinProfessionalMediaState }[]) => void;
  setItemCollapsed: (id: string, collapsed: boolean) => void;
  setEnvelopeCollapsed: (envelopeId: string, collapsed: boolean) => void;
  setAllItemsCollapsed: (collapsed: boolean) => void;
  removeItem: (id: string) => SourceBinLibraryItem | undefined;
  updateAssetItemData: (id: string, item: {
    label?: string;
    mimeType: string;
    dataUrl: string;
    pixelWidth?: number;
    pixelHeight?: number;
  }) => Promise<SourceBinLibraryItem>;
}

export interface PreparedSourceBinProjectSnapshot {
  bins: SourceBin[];
  dismissedSourceKeys: string[];
}

function withMountedHaneProviderBins(
  localBins: readonly SourceBin[],
  currentBins: readonly SourceBin[],
): SourceBin[] {
  return [
    ...localBins.filter((bin) => !isHaneProviderBinId(bin.id)),
    ...currentBins.filter((bin) => isHaneProviderBinId(bin.id)),
  ];
}

export function buildPersistedSourceBinState(
  state: Pick<SourceBinState, 'sidebarOpen' | 'dismissedSourceKeys' | 'nativeScratchDirectoryPath' | 'durabilityStatus' | 'bins'>,
): PersistedSourceBinState {
  return {
    sidebarOpen: state.sidebarOpen,
    dismissedSourceKeys: state.dismissedSourceKeys,
    nativeScratchDirectoryPath: state.nativeScratchDirectoryPath,
    durabilityStatus: state.durabilityStatus,
    // Hane is an attached provider, never part of the desktop project's durable
    // Source Library. A crash/reload must not turn its temporary mounted bins
    // into local project data.
    bins: state.bins.filter((bin) => !isHaneProviderBinId(bin.id)).map((bin) => ({
      id: bin.id,
      name: bin.name,
      collapsed: bin.collapsed,
      createdAt: bin.createdAt,
      items: bin.items.map((item) => ({
        id: item.id,
        label: item.label,
        kind: item.kind,
        mimeType: item.mimeType,
        assetId: item.assetId,
        scratchFileName: item.scratchFileName,
        nativeFilePath: item.nativeFilePath,
        assetUrl: persistableSourceBinAssetUrl(item),
        text: item.text,
        durability: item.durability === 'session-only' ? 'unavailable' : item.durability,
        durabilityMessage: item.durability === 'session-only'
          ? 'Temporary preview bytes were available only in the previous session. Regenerate or reimport this item.'
          : item.durabilityMessage,
        createdAt: item.createdAt,
        sourceKey: item.sourceKey,
        originNodeId: item.originNodeId,
        isGenerated: item.isGenerated,
        starred: item.starred,
        collapsed: item.collapsed,
        envelopeId: item.envelopeId,
        envelopeLabel: item.envelopeLabel,
        envelopeIndex: item.envelopeIndex,
        envelopeCollapsed: item.envelopeCollapsed,
        professional: item.professional,
      })),
    })),
  };
}

const STORAGE_KEY = 'flow-global-source-bin';
const pendingConnectedSourceKeys = new Set<string>();
const provisionalSourceBinItemIds = new Set<string>();
const VALID_SOURCE_KINDS: readonly EditorSourceKind[] = ['text', 'image', 'video', 'audio', 'composition', 'document', 'subtitle', 'package'];
const TRANSIENT_RECOVERED_SCRATCH_BIN_ID = 'recovered-scratch-assets';
const TRANSIENT_RECOVERED_SCRATCH_SOURCE_KEY_PREFIX = 'recovered-scratch:';
const PROJECT_IMPORT_ENVELOPE_ID = 'project-imports';
const PROJECT_IMPORT_ENVELOPE_LABEL = 'Project imports';
let androidSourceAssetPermissionAlertOpen = false;
let pendingDurabilityMessage: string | undefined;
const pendingDurabilityItemIds = new Set<string>();
let lastReportedDurabilityFingerprint: string | undefined;

function createProfessionalMediaState(
  origin: SourceBinProfessionalMediaState['origin'],
): SourceBinProfessionalMediaState {
  return {
    version: VIDEO_PROFESSIONAL_STATE_VERSION,
    origin,
    onlineState: 'online',
    proxy: { status: 'none' },
    tags: [],
  };
}
const revocableSourceAssetHandles = createSourceAssetHandlePool((url) => {
  revokeObjectUrl(url);
});

// 811 F2: provenance of blob: URLs hydrateAssets minted from scratch files. Without it, every
// hydrate pass (which fires on ANY library add/broadcast/reconcile) re-read every scratch item
// from disk and re-minted a fresh blob URL — an O(N) I/O + allocation storm per single-item event
// that also made every scratch item look "changed" and re-rendered all subscribers. A blob URL
// whose recorded provenance still matches the item's scratchFileName is alive and correct: skip.
const scratchBlobProvenance = new Map<string, string>();

function createDefaultBin(name = 'Source Library'): SourceBin {
  return {
    id: 'default',
    name,
    items: [],
    collapsed: false,
    createdAt: Date.now(),
  };
}

function collectRevocableObjectUrlItems(bins: SourceBin[]): Map<string, string> {
  return new Map(
    bins
      .flatMap((bin) => bin.items)
      .flatMap((item) => (
        isRevocableObjectUrl(item.assetUrl)
          ? [[item.id, item.assetUrl] as const]
          : []
      )),
  );
}

function syncRevocableObjectUrls(previousBins: SourceBin[], nextBins: SourceBin[]): void {
  const previousItems = collectRevocableObjectUrlItems(previousBins);
  const nextItems = collectRevocableObjectUrlItems(nextBins);

  // Snapshots restored from persistence or tests can predate the runtime handle registry. Adopt
  // every live URL before replacing anything so transaction leases and shared URLs participate in
  // the same URL-level lifetime accounting.
  for (const [itemId, url] of previousItems.entries()) {
    if (!revocableSourceAssetHandles.has(itemId)) {
      revocableSourceAssetHandles.replace(itemId, url);
    }
  }

  for (const [itemId, url] of nextItems.entries()) {
    revocableSourceAssetHandles.replace(itemId, url);
  }

  for (const [itemId] of previousItems.entries()) {
    if (!nextItems.has(itemId)) {
      revocableSourceAssetHandles.release(itemId);
    }
  }
}

function revokeSourceBinItemObjectUrl(item: SourceBinLibraryItem | undefined): void {
  if (isRevocableObjectUrl(item?.assetUrl)) {
    if (!revocableSourceAssetHandles.has(item.id)) {
      revocableSourceAssetHandles.replace(item.id, item.assetUrl);
    }
    revocableSourceAssetHandles.release(item.id);
  }
}

function isRevocableObjectUrl(url: string | undefined): url is string {
  return typeof url === 'string' && url.startsWith('blob:');
}

function revokeObjectUrl(url: string): void {
  scratchBlobProvenance.delete(url);
  try {
    URL.revokeObjectURL?.(url);
  } catch {
    // Object URL revocation is best-effort cleanup.
  }
}

let sourceUrlLeaseSequence = 0;

/**
 * Retain every temporary URL in a prepared/live Source snapshot until a project transaction is
 * either finalized or rolled back. Lease ids are deliberately independent from item ids so an
 * A item and a B item with the same id can own different URLs during the handoff.
 */
export function leaseSourceBinProjectSnapshotObjectUrls(
  snapshot: PreparedSourceBinProjectSnapshot,
  options: { adoptSnapshotOwnership?: boolean } = {},
): () => void {
  const leaseId = ++sourceUrlLeaseSequence;
  const snapshotHandles = snapshot.bins
    .flatMap((bin) => bin.items)
    .flatMap((item, index) => (
      isRevocableObjectUrl(item.assetUrl)
        ? [{ itemId: item.id, leaseId: `project-source-url-lease:${leaseId}:${index}`, url: item.assetUrl }]
        : []
    ));
  let released = false;

  for (const handle of snapshotHandles) {
    if (options.adoptSnapshotOwnership) {
      // Some import/live-sync paths install a blob URL directly in Zustand before the runtime
      // registry sees it. Adopt that live store ownership before taking the transaction lease, so
      // a first-stage failure can release the lease without revoking the still-observable A URL.
      revocableSourceAssetHandles.replace(handle.itemId, handle.url);
    }
    revocableSourceAssetHandles.acquire(handle.leaseId, handle.url);
  }

  return () => {
    if (released) return;
    released = true;
    for (const handle of snapshotHandles) {
      try {
        revocableSourceAssetHandles.release(handle.leaseId);
      } catch {
        // URL cleanup is best-effort and must never mask the project transaction result.
      }
    }
  };
}

function getNextEnvelopeIndex(items: readonly SourceBinLibraryItem[], envelopeId: string): number {
  return items.reduce((nextIndex, item) => {
    if (item.envelopeId !== envelopeId || item.envelopeIndex === undefined) {
      return nextIndex;
    }

    return Math.max(nextIndex, item.envelopeIndex + 1);
  }, 0);
}

function assignProjectImportEnvelopeMetadata(
  items: readonly SourceBinLibraryItem[],
  existingItems: readonly SourceBinLibraryItem[],
): SourceBinLibraryItem[] {
  let nextEnvelopeIndex = getNextEnvelopeIndex(existingItems, PROJECT_IMPORT_ENVELOPE_ID);

  return items.map((item) => {
    if (item.envelopeId) {
      return item;
    }

    const nextItem = {
      ...item,
      envelopeId: PROJECT_IMPORT_ENVELOPE_ID,
      envelopeLabel: PROJECT_IMPORT_ENVELOPE_LABEL,
      envelopeIndex: nextEnvelopeIndex,
    };
    nextEnvelopeIndex += 1;
    return nextItem;
  });
}

/**
 * Cross-window / native-bridge / LAN broadcasts must not carry resolved asset bytes (811 F3): a
 * multi-MB data: URL is structured-cloned into every window and serialized over the native bridge
 * on each add, and a blob: URL is document-scoped — dead on arrival in every receiver. When the
 * item has durable backing (assetId / scratchFileName / nativeFilePath) each receiver re-resolves
 * it through its own hydrateAssets (or the host `/source-asset/:id` endpoint on LAN), so the bytes
 * are pure overhead. A fallback item whose data: URL is all it has keeps it — that is the only
 * copy. (blob: URLs are stripped unconditionally; they can never load outside this document.)
 */
export function broadcastableSourceBinItem(item: SourceBinLibraryItem): SourceBinLibraryItem {
  const url = item.assetUrl;
  if (!url) {
    return item;
  }

  const hasDurableBacking = Boolean(item.assetId || item.scratchFileName || item.nativeFilePath);

  if (url.startsWith('blob:') || (url.startsWith('data:') && hasDurableBacking)) {
    return { ...item, assetUrl: undefined };
  }

  return item;
}

function broadcastSourceBinItemsAdded(items: SourceBinLibraryItem[], targetBinId?: string): void {
  if (items.length === 0) {
    return;
  }

  const change = {
    type: 'source-bin-items-added',
    items: items.map(broadcastableSourceBinItem),
    ...(targetBinId ? { targetBinId } : {}),
  } satisfies SourceLibraryNativeChange;

  postWorkspaceWindowCommand(change);
  publishNativeSourceLibraryChange(change);
  notifyLanSourceLibraryChange(change);
}

function broadcastSourceBinItemRenamed(itemId: string, label: string): void {
  const normalizedLabel = label.trim();
  if (!itemId.trim() || !normalizedLabel) {
    return;
  }

  const change = {
    type: 'source-bin-item-renamed',
    itemId,
    label: normalizedLabel,
  } satisfies SourceLibraryNativeChange;

  postWorkspaceWindowCommand(change);
  publishNativeSourceLibraryChange(change);
  notifyLanSourceLibraryChange(change);
}

function broadcastSourceBinItemRemoved(item: SourceBinLibraryItem): void {
  const change = {
    type: 'source-bin-item-removed',
    itemId: item.id,
    ...(item.sourceKey ? { sourceKey: item.sourceKey } : {}),
  } satisfies SourceLibraryNativeChange;

  postWorkspaceWindowCommand(change);
  publishNativeSourceLibraryChange(change);
  notifyLanSourceLibraryChange(change);
}

function syncNativeSourceLibrarySnapshot(snapshot: SourceBinProjectSnapshot): void {
  const bridge = getSignalLoomNativeBridge();
  const scope = captureProjectAuthorityMutationScope();
  if (!bridge?.syncSourceLibrarySnapshot || !scope) {
    return;
  }

  setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('syncing', {
    message: 'Syncing Source Library snapshot with native windows.',
  }));

  void bridge.syncSourceLibrarySnapshot({ snapshot, claim: scope.claim })
    .then((result) => {
      if (!isCurrentProjectAuthorityMutationScope(scope)) return;
      if (sourceLibraryNativeAckNeedsRepair(result)) {
        setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('degraded', {
          message: describeNativeSourceLibraryAckFailure(result, 'Native Source Library snapshot sync was rejected.'),
          repairDirection: 'push-renderer-snapshot',
        }));
        return;
      }

      setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('synced', {
        lastAckVersion: result.version,
        message: 'Source Library snapshot synced with native windows.',
      }));
    })
    .catch((error) => {
      if (!isCurrentProjectAuthorityMutationScope(scope)) return;
      setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('degraded', { error }));
    });
}

function publishNativeSourceLibraryChange(change: SourceLibraryNativeChange): void {
  const bridge = getSignalLoomNativeBridge();
  const scope = captureProjectAuthorityMutationScope();
  if (!bridge?.applySourceLibraryChange || !scope) {
    return;
  }

  setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('syncing', {
    message: 'Sending Source Library change to native windows.',
  }));

  void bridge.applySourceLibraryChange({ change, claim: scope.claim })
    .then((result) => {
      if (!isCurrentProjectAuthorityMutationScope(scope)) return undefined;
      if (sourceLibraryNativeAckNeedsRepair(result)) {
        return repairNativeSourceLibrarySnapshot(describeNativeSourceLibraryAckFailure(
          result,
          'Native Source Library change was not acknowledged.',
        ), scope);
      }

      setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('synced', {
        lastAckVersion: result.version,
        message: 'Source Library change acknowledged by native windows.',
      }));
      return undefined;
    })
    .catch((error) => (
      isCurrentProjectAuthorityMutationScope(scope)
        ? repairNativeSourceLibrarySnapshot(error, scope)
        : undefined
    ));
}

function describeNativeSourceLibraryAckFailure(
  result: SourceLibraryNativeAckResult | undefined,
  fallback: string,
): string {
  return typeof result?.error === 'string' && result.error.trim() ? result.error : fallback;
}

function setNativeSourceLibrarySyncStatus(status: SourceLibraryNativeSyncStatus): void {
  useSourceBinStore.setState({ nativeSyncStatus: status });
}

async function repairNativeSourceLibrarySnapshot(
  reason: unknown,
  requestedScope: ProjectAuthorityMutationScope | undefined = captureProjectAuthorityMutationScope(),
): Promise<void> {
  const bridge = getSignalLoomNativeBridge();
  if (!bridge?.syncSourceLibrarySnapshot) {
    setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('degraded', {
      error: reason,
      message: 'Native Source Library bridge is unavailable.',
    }));
    return;
  }
  if (!isCurrentProjectAuthorityMutationScope(requestedScope) || !requestedScope) return;

  setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('repairing', {
    error: reason,
    message: 'Repairing native Source Library sync from the current project snapshot.',
    repairDirection: 'push-renderer-snapshot',
  }));

  try {
    const snapshot = await useSourceBinStore.getState().exportProjectSnapshot();
    if (!isCurrentProjectAuthorityMutationScope(requestedScope)) return;
    const result = await bridge.syncSourceLibrarySnapshot({ snapshot, claim: requestedScope.claim });
    if (!isCurrentProjectAuthorityMutationScope(requestedScope)) return;
    if (sourceLibraryNativeAckNeedsRepair(result)) {
      setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('degraded', {
        message: describeNativeSourceLibraryAckFailure(result, 'Native Source Library snapshot repair was rejected.'),
        repairDirection: 'push-renderer-snapshot',
      }));
      return;
    }

    setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('synced', {
      lastAckVersion: result.version,
      message: 'Source Library sync repaired from the current project snapshot.',
    }));
  } catch (error) {
    if (!isCurrentProjectAuthorityMutationScope(requestedScope)) return;
    setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('degraded', { error }));
  }
}

async function prepareSourceBinProjectSnapshot(
  snapshot: SourceBinProjectSnapshot | undefined,
  scratchDirectoryHandle?: FileSystemDirectoryHandle,
): Promise<PreparedSourceBinProjectSnapshot> {
  if (!snapshot) {
    return { bins: [createDefaultBin()], dismissedSourceKeys: [] };
  }
  const safeSnapshot = sanitizePersistedSourceBinState(snapshot);
  const snapshotBins = Array.isArray(safeSnapshot.bins) && safeSnapshot.bins.length > 0
    ? safeSnapshot.bins
    : Array.isArray(safeSnapshot.items)
      ? [{ ...createDefaultBin(), items: safeSnapshot.items }]
      : [createDefaultBin()];
  const createdObjectUrls: string[] = [];
  try {
    const bins: SourceBin[] = [];
    for (const bin of snapshotBins) {
      const items: SourceBinLibraryItem[] = [];
      for (const item of bin.items) {
        if (item.kind === 'text') {
          items.push({ ...item, assetUrl: undefined });
          continue;
        }
        if (item.scratchFileName && scratchDirectoryHandle) {
          const file = await loadScratchAssetBlob(scratchDirectoryHandle, item.scratchFileName).catch(() => undefined);
          if (file) {
            const assetUrl = URL.createObjectURL(file);
            createdObjectUrls.push(assetUrl);
            items.push({ ...item, mimeType: file.type || item.mimeType, assetUrl });
            continue;
          }
        }
        const lookupId = item.assetId ?? parseSignalLoomAssetId(item.assetUrl);
        if (lookupId) {
          const storedAsset = await loadImportedAssetIfAvailable(lookupId);
          if (storedAsset) {
            items.push({
              ...item,
              assetId: item.assetId ?? lookupId,
              mimeType: storedAsset.mimeType,
              assetUrl: storedAsset.dataUrl,
            });
            continue;
          }
        }
        if (item.nativeFilePath || item.scratchFileName || item.assetUrl || item.durability === 'unavailable') {
          items.push({ ...item, mimeType: item.mimeType ?? getDefaultMimeType(item.kind) });
        }
      }
      bins.push({
        id: bin.id ?? globalThis.crypto?.randomUUID?.() ?? `bin-${Date.now()}`,
        name: bin.name || 'Source Library',
        collapsed: Boolean(bin.collapsed),
        createdAt: bin.createdAt ?? Date.now(),
        items,
      });
    }
    return { bins, dismissedSourceKeys: safeSnapshot.dismissedSourceKeys ?? [] };
  } catch (error) {
    for (const url of new Set(createdObjectUrls)) revokeObjectUrl(url);
    throw error;
  }
}

export const useSourceBinStore = create<SourceBinState>()(
  persist(
    (set, get) => ({
      bins: [createDefaultBin()],
      dismissedSourceKeys: [],
      sidebarOpen: true,
      nativeSyncStatus: { state: 'idle' },
      durabilityStatus: { state: 'ready' },
      scratchDirectoryHandle: undefined,
      nativeScratchDirectoryPath: undefined,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setNativeSyncStatus: (nativeSyncStatus) => set({ nativeSyncStatus }),
      retryNativeSourceLibrarySync: () => {
        const currentStatus = get().nativeSyncStatus;
        if (currentStatus.repairDirection === 'pull-native-snapshot') {
          const bridge = getSignalLoomNativeBridge();
          const scope = captureProjectAuthorityMutationScope();
          if (!bridge?.getSourceLibrarySnapshot || !scope) {
            setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('degraded', {
              expectedNativeVersion: currentStatus.expectedNativeVersion,
              message: 'Native Source Library snapshot retry is unavailable.',
              repairDirection: 'pull-native-snapshot',
            }));
            return;
          }

          void bridge.getSourceLibrarySnapshot({ claim: scope.claim })
            .then((result) => {
              if (
                !result?.snapshot
                || !isCurrentProjectAuthorityMutationScope(scope)
                || result.authority.authorityId !== scope.claim.authorityId
                || result.authority.version !== scope.claim.version
                || (typeof currentStatus.expectedNativeVersion === 'number' && result.version < currentStatus.expectedNativeVersion)
              ) {
                throw new Error('Native Source Library snapshot retry returned a stale or empty snapshot.');
              }

              let repaired = false;
              useSourceBinStore.setState((state) => {
                const nextState = applySourceLibraryNativeChange({
                  bins: state.bins,
                  dismissedSourceKeys: state.dismissedSourceKeys,
                }, {
                  type: 'source-library-snapshot',
                  snapshot: result.snapshot,
                });

                repaired = nextState.bins !== state.bins || nextState.dismissedSourceKeys !== state.dismissedSourceKeys;
                return {
                  ...(repaired ? nextState : {}),
                  nativeSyncStatus: buildSourceLibraryNativeSyncStatus('synced', {
                    lastAckVersion: result.version,
                    message: 'Source Library repaired from native snapshot retry.',
                    repairDirection: 'pull-native-snapshot',
                  }),
                };
              });
              if (repaired) {
                void get().hydrateAssets();
              }
            })
            .catch((error) => {
              if (!isCurrentProjectAuthorityMutationScope(scope)) return;
              setNativeSourceLibrarySyncStatus(buildSourceLibraryNativeSyncStatus('degraded', {
                error,
                expectedNativeVersion: currentStatus.expectedNativeVersion,
                repairDirection: 'pull-native-snapshot',
              }));
            });
          return;
        }

        void repairNativeSourceLibrarySnapshot('Manual Source Library sync retry requested.');
      },
      setScratchDirectoryHandle: (scratchDirectoryHandle) => set({ scratchDirectoryHandle }),
      setNativeScratchDirectoryPath: (nativeScratchDirectoryPath) => set({ nativeScratchDirectoryPath }),
      getAllItems: () => getAllSourceBinItems(get().bins),
      createBin: (name) => {
        const bin = createSourceBin(name);
        set((state) => ({ bins: [...state.bins, bin] }));
        return bin.id;
      },
      renameBin: (id, name) =>
        set((state) => ({ bins: renameSourceBin(state.bins, id, name) })),
      removeBin: (id) =>
        set((state) => {
          const bins = removeSourceBin(state.bins, id);
          return bins ? { bins } : state;
        }),
      setBinCollapsed: (id, collapsed) =>
        set((state) => ({ bins: setSourceBinCollapsed(state.bins, id, collapsed) })),
      migrateAssetsToScratch: async (scratchDirectoryHandle) => {
        let migratedCount = 0;

        set((state) => {
          const nextBins = state.bins.map((bin) => {
            const nextItems: SourceBinLibraryItem[] = [];

            for (const item of bin.items) {
              if (item.kind === 'text' || item.scratchFileName) {
                nextItems.push(item);
                continue;
              }

              nextItems.push(item);
            }

            return { ...bin, items: nextItems };
          });

          return { scratchDirectoryHandle, bins: nextBins };
        });

        const state = get();
        const nextBins: SourceBin[] = [];

        for (const bin of state.bins) {
          const nextItems: SourceBinLibraryItem[] = [];

          for (const item of bin.items) {
            if (item.kind === 'text' || item.scratchFileName) {
              nextItems.push(item);
              continue;
            }

            const blob = item.assetId
              ? (await loadImportedAssetBlob(item.assetId).catch(() => undefined))?.blob
              : item.assetUrl
                ? await assetUrlToBlob(item.assetUrl, item.mimeType)
                : undefined;

            if (!blob) {
              nextItems.push(item);
              continue;
            }

            const stored = await storeScratchAssetBlob({
              scratchDirectoryHandle,
              item,
              blob,
            });

            if (item.assetId) {
              await deleteImportedAsset(item.assetId).catch(() => undefined);
            }

            migratedCount += 1;
            nextItems.push({
              ...item,
              assetId: undefined,
              assetUrl: stored.assetUrl,
              scratchFileName: stored.fileName,
            });
          }

          nextBins.push({ ...bin, items: nextItems });
        }

        const previousBins = get().bins;
        set({ bins: nextBins });
        syncRevocableObjectUrls(previousBins, nextBins);
        return migratedCount;
      },
      hydrateAssets: async () => {
        const nativeBridge = getSignalLoomNativeBridge();
        const authorityScope = captureProjectAuthorityMutationScope();
        if (nativeBridge && !authorityScope) {
          return;
        }
        const scratchDirectoryHandle = get().scratchDirectoryHandle;
        const startingBins = get().bins;

        // Phone-served desktop session: the phone is the single source of truth. The local stores
        // (scratch dir, IndexedDB) don't hold the phone's bytes, and a native-file-backed item carries
        // an unreachable phone-local `https://localhost/_capacitor_file_/…` assetUrl — so its thumbnail
        // `<img>` fails with ERR_CONNECTION_REFUSED. Resolve every non-text item through the host's
        // universal `/source-asset/:itemId` endpoint so the thumbnail (and any other assetUrl consumer)
        // renders the SAME file the phone uses. Already-resolved items keep a `data:` assetUrl, so we
        // skip them to avoid re-streaming the bytes on every live-sync tick. Dynamic import keeps this
        // central store free of a static dependency on the remote-host client (cycle-avoidance).
        const {
          isHaneLinkProviderSession,
          isServedLanSession,
          fetchRemoteHostSourceAssetDataUrl,
        } = await import('../lib/remoteHostClient');
        const servedClient = isServedLanSession();
        const haneProviderClient = isHaneLinkProviderSession();
        const nativeMediaItemIds = startingBins
          .flatMap((bin) => bin.items)
          .filter((item) => item.nativeFilePath && isSignalLoomAssetUrl(item.assetUrl))
          .map((item) => item.id);
        const nativeMediaItemIdSet = new Set(nativeMediaItemIds);
        let nativeAvailabilityVerified = false;
        const nativeMediaAvailability = new Map<string, boolean>();
        if (nativeBridge && authorityScope && nativeMediaItemIds.length > 0 && nativeBridge.getVideoMediaAvailability) {
          nativeAvailabilityVerified = true;
          for (let index = 0; index < nativeMediaItemIds.length; index += 1_000) {
            const requestedItemIds = nativeMediaItemIds.slice(index, index + 1_000);
            const availability = await nativeBridge.getVideoMediaAvailability({
              itemIds: requestedItemIds,
              claim: authorityScope.claim,
            }).catch(() => undefined);
            if (
              !availability?.ok
              || availability.authority?.authorityId !== authorityScope.claim.authorityId
              || availability.authority.version !== authorityScope.claim.version
              || !isCurrentProjectAuthorityMutationScope(authorityScope)
            ) {
              nativeAvailabilityVerified = false;
              break;
            }
            for (const item of availability.items ?? []) {
              if (nativeMediaItemIdSet.has(item.itemId)) nativeMediaAvailability.set(item.itemId, item.available === true);
            }
          }
        }

        const nextBins = await Promise.all(
          startingBins.map(async (bin) => {
            const hydratedItems = await Promise.all(
              bin.items.map(async (item) => {
                if (servedClient && (!haneProviderClient || isHaneProviderSourceItem(item))) {
                  if (item.kind === 'text' || (typeof item.assetUrl === 'string' && item.assetUrl.startsWith('data:'))) {
                    return item;
                  }
                  const hosted = await fetchRemoteHostSourceAssetDataUrl(item.id).catch(() => null);
                  return hosted
                    ? { ...item, assetUrl: hosted, durability: undefined, durabilityMessage: undefined }
                    : markRemoteHostAssetTemporarilyUnavailable(item);
                }

                if (item.scratchFileName && scratchDirectoryHandle) {
                  // Already minted for this exact scratch file on a previous pass — still live (F2).
                  if (
                    item.assetUrl?.startsWith('blob:')
                    && scratchBlobProvenance.get(item.assetUrl) === item.scratchFileName
                  ) {
                    return item;
                  }

                  const file = await loadScratchAssetBlob(scratchDirectoryHandle, item.scratchFileName).catch(() => undefined);

                  if (file) {
                    const assetUrl = URL.createObjectURL(file);
                    scratchBlobProvenance.set(assetUrl, item.scratchFileName);
                    return {
                      ...item,
                      assetUrl,
                      mimeType: file.type || item.mimeType,
                    };
                  }
                }

                // Already carrying resolved bytes — a data: URL cannot go stale, and the overwrite
                // path (updateAssetItemData) swaps in a fresh URL itself. Skip the IndexedDB
                // round-trip that used to run for every such item on every pass (F2).
                if (item.assetUrl?.startsWith('data:')) {
                  return item;
                }

                // An opaque native URL plus its registered file path is already the desktop
                // renderer's durable preview source. Do not reinterpret the Source Library item
                // id as a browser IndexedDB asset id: relink/consolidate deliberately preserve the
                // Source identity while retargeting that native capability.
                if (nativeBridge && item.nativeFilePath && isSignalLoomAssetUrl(item.assetUrl)) {
                  if (!nativeAvailabilityVerified || nativeMediaAvailability.get(item.id) !== true) {
                    return markNativeMediaRelinkRequired(item);
                  }
                  return markNativeMediaAvailable(item);
                }

                // Resolve by assetId, or by the id embedded in a
                // `signal-loom-asset://asset/<id>` URL (that scheme only loads
                // natively on Electron — Android/web need the local bytes).
                const lookupId = item.assetId ?? parseSignalLoomAssetId(item.assetUrl);
                if (!lookupId) {
                  return item;
                }

                const storedAsset = await loadImportedAssetIfAvailable(lookupId);

                if (!storedAsset) {
                  return isSignalLoomAssetUrl(item.assetUrl)
                    ? markLegacyNativeAssetUnavailable(item)
                    : item;
                }

                return {
                  ...item,
                  assetId: item.assetId ?? lookupId,
                  assetUrl: storedAsset.dataUrl,
                  mimeType: storedAsset.mimeType ?? item.mimeType,
                  label: storedAsset.name ?? item.label,
                  durability: undefined,
                  durabilityMessage: undefined,
                };
              }),
            );

            return { ...bin, items: hydratedItems };
          }),
        );

        // Collect only the items hydration actually resolved, keyed by id, remembering each item's
        // PRE-resolution assetUrl. We merge these back into whatever bins are current NOW rather than
        // committing the whole `nextBins` snapshot wholesale. The live-sync path fires hydrateAssets()
        // on every host event (`applyHostSourceLibraryEvent`), so those calls overlap and a concurrent
        // change — a second exported item, an overlapping hydrate that set() first — routinely lands
        // during the async host-fetch window. The old all-or-nothing stale guard discarded the ENTIRE
        // pass whenever the bins signature shifted, so a freshly drawn Image→Flow export kept its
        // unreachable phone-local capacitor assetUrl (no thumbnail + "Preview unavailable" on open).
        // Per-item merge fixes that without resurrecting stale state:
        //  - an item that no longer exists (a whole-document swap / project restore) is skipped, so a
        //    stale pass can't bring it back (preserves the "newer restored snapshot wins" contract);
        //  - an item whose assetUrl changed independently since we snapshotted is left untouched;
        //  - every other resolved item still receives its streamed bytes, even if some OTHER item
        //    changed meanwhile.
        const resolutions = new Map<string, { before: string | undefined; resolved: SourceBinLibraryItem }>();
        startingBins.forEach((bin, binIndex) => {
          bin.items.forEach((item, itemIndex) => {
            const resolved = nextBins[binIndex].items[itemIndex];
            if (resolved !== item) {
              resolutions.set(item.id, { before: item.assetUrl, resolved });
            }
          });
        });

        if (resolutions.size === 0) {
          return;
        }

        if (nativeBridge && !isCurrentProjectAuthorityMutationScope(authorityScope)) {
          return;
        }

        const previousBins = get().bins;
        let mutated = false;
        const mergedBins = previousBins.map((bin) => {
          let binChanged = false;
          const items = bin.items.map((item) => {
            const resolution = resolutions.get(item.id);
            if (!resolution || item.assetUrl !== resolution.before) {
              return item;
            }
            binChanged = true;
            const { resolved } = resolution;
            return {
              ...item,
              assetUrl: resolved.assetUrl,
              mimeType: resolved.mimeType ?? item.mimeType,
              assetId: resolved.assetId ?? item.assetId,
              label: resolved.label ?? item.label,
              durability: resolved.durability,
              durabilityMessage: resolved.durabilityMessage,
              professional: resolved.professional ?? item.professional,
            };
          });
          if (binChanged) {
            mutated = true;
            return { ...bin, items };
          }
          return bin;
        });

        if (!mutated) {
          return;
        }

        const unavailableItemIds = mergedBins
          .flatMap((bin) => bin.items)
          .filter((item) => item.durability === 'unavailable' && item.durabilityMessage === LEGACY_NATIVE_ASSET_ITEM_WARNING)
          .map((item) => item.id);
        const currentDurability = get().durabilityStatus;
        set({
          bins: mergedBins,
          durabilityStatus: unavailableItemIds.length > 0
            ? {
                state: 'degraded',
                message: LEGACY_NATIVE_ASSET_WARNING,
                affectedItemIds: unavailableItemIds,
                updatedAt: Date.now(),
              }
            : currentDurability.message === LEGACY_NATIVE_ASSET_WARNING
              ? { state: 'ready' }
              : currentDurability,
        });
        syncRevocableObjectUrls(previousBins, mergedBins);
      },
      exportProjectSnapshot: async (options) => {
        const includeAssetData = Boolean(options?.includeAssetData);
        const exportedBins = await Promise.all(
          get().bins
            .filter((bin) => !isHaneProviderBinId(bin.id))
            .map(async (bin) => {
            const exportedItems = await Promise.all(
              bin.items.map(async (item) => {
                if (item.kind === 'text') {
                  return {
                    id: item.id,
                    label: item.label,
                    kind: item.kind,
                    mimeType: item.mimeType,
                    assetId: item.assetId,
                    scratchFileName: item.scratchFileName,
                    nativeFilePath: item.nativeFilePath,
                    assetUrl: undefined,
                    text: item.text,
                    pixelWidth: item.pixelWidth,
                    pixelHeight: item.pixelHeight,
                    createdAt: item.createdAt,
            sourceKey: item.sourceKey,
            originNodeId: item.originNodeId,
            isGenerated: item.isGenerated,
            starred: item.starred,
            collapsed: item.collapsed,
            envelopeId: item.envelopeId,
                    envelopeLabel: item.envelopeLabel,
                    envelopeIndex: item.envelopeIndex,
                    envelopeCollapsed: item.envelopeCollapsed,
                    professional: item.professional,
                    durability: item.durability,
                    durabilityMessage: item.durabilityMessage,
                  };
                }

                const assetDataUrl = includeAssetData ? await loadItemAsDataUrl(item, get().scratchDirectoryHandle) : undefined;

                return {
                  id: item.id,
                  label: item.label,
                  kind: item.kind,
                  mimeType: item.mimeType,
                  assetId: item.assetId,
                  scratchFileName: item.scratchFileName,
                  nativeFilePath: item.nativeFilePath,
                  assetUrl: includeAssetData
                    ? assetDataUrl ?? item.assetUrl
                    : item.nativeFilePath
                      ? item.assetUrl
                      : item.assetId || item.scratchFileName
                        ? undefined
                        : item.assetUrl,
                  text: item.text,
                  pixelWidth: item.pixelWidth,
                  pixelHeight: item.pixelHeight,
                  createdAt: item.createdAt,
                  sourceKey: item.sourceKey,
                  originNodeId: item.originNodeId,
                  isGenerated: item.isGenerated,
                  starred: item.starred,
                  collapsed: item.collapsed,
                  envelopeId: item.envelopeId,
                  envelopeLabel: item.envelopeLabel,
                  envelopeIndex: item.envelopeIndex,
                  envelopeCollapsed: item.envelopeCollapsed,
                  professional: item.professional,
                  durability: item.durability,
                  durabilityMessage: item.durabilityMessage,
                };
              }),
            );

            return {
              id: bin.id,
              name: bin.name,
              items: exportedItems,
              collapsed: bin.collapsed,
              createdAt: bin.createdAt,
            };
          }),
        );

        return {
          bins: exportedBins,
          dismissedSourceKeys: [...get().dismissedSourceKeys],
        };
      },
      prepareProjectSnapshot: (snapshot) => prepareSourceBinProjectSnapshot(snapshot, get().scratchDirectoryHandle),
      commitPreparedProjectSnapshot: (snapshot, options = {}) => {
        const previousBins = get().bins;
        const localSnapshot = {
          bins: snapshot.bins.filter((bin) => !isHaneProviderBinId(bin.id)),
          dismissedSourceKeys: snapshot.dismissedSourceKeys,
        };
        const nextBins = withMountedHaneProviderBins(localSnapshot.bins, previousBins);
        let observerError: unknown;
        try {
          set({ bins: nextBins, dismissedSourceKeys: localSnapshot.dismissedSourceKeys });
        } catch (error) {
          // Zustand observers run inside set(). The state is already replaced when one throws, so
          // finish URL ownership and publication before letting the transaction classify the error
          // as an observer failure rather than leaving the new snapshot with unregistered URLs.
          observerError = error;
        }
        syncRevocableObjectUrls(previousBins, nextBins);
        if (options.publishNative ?? true) syncNativeSourceLibrarySnapshot(localSnapshot);
        if (observerError) throw observerError;
      },
      restoreProjectSnapshot: async (snapshot, options = {}) => {
        const publishNative = options.publishNative ?? true;
        if (!snapshot) {
          const previousBins = get().bins;
          const emptySnapshot = { bins: [createDefaultBin()], dismissedSourceKeys: [] };
          const nextBins = withMountedHaneProviderBins(emptySnapshot.bins, previousBins);
          set({ ...emptySnapshot, bins: nextBins });
          syncRevocableObjectUrls(previousBins, nextBins);
          if (publishNative) {
            syncNativeSourceLibrarySnapshot(emptySnapshot);
          }
          return;
        }

        const safeSnapshot = sanitizePersistedSourceBinState(snapshot);
        const safeLocalBins = Array.isArray(safeSnapshot.bins)
          ? safeSnapshot.bins.filter((bin) => !isHaneProviderBinId(bin.id))
          : [];
        const snapshotBins: Array<SourceBin & { items: Array<SourceBinLibraryItem & { assetUrl?: string }> }> =
          safeLocalBins.length > 0
            ? safeLocalBins
            : Array.isArray(safeSnapshot.items)
              ? [{ ...createDefaultBin(), items: safeSnapshot.items }]
              : [createDefaultBin()];

        const scratchDirectoryHandle = get().scratchDirectoryHandle;

        const restoredBins = await Promise.all(
          snapshotBins.map(async (bin) => {
            const restoredItems = await Promise.all(
              (Array.isArray(bin.items) ? bin.items : []).map(async (item) => {
                if (item.kind === 'text') {
                  return {
                    id: item.id,
                    label: item.label,
                    kind: item.kind,
                    mimeType: item.mimeType,
                    scratchFileName: item.scratchFileName,
                    nativeFilePath: item.nativeFilePath,
                    assetUrl: undefined,
                    text: item.text,
                    pixelWidth: item.pixelWidth,
                    pixelHeight: item.pixelHeight,
                    createdAt: item.createdAt,
                    sourceKey: item.sourceKey,
                    originNodeId: item.originNodeId,
                    isGenerated: item.isGenerated,
                    starred: Boolean(item.starred),
                    collapsed: Boolean(item.collapsed),
                    envelopeId: item.envelopeId,
                    envelopeLabel: item.envelopeLabel,
                    envelopeIndex: item.envelopeIndex,
                    envelopeCollapsed: item.envelopeCollapsed,
                    professional: item.professional,
                  } satisfies SourceBinLibraryItem;
                }

                if (item.scratchFileName && scratchDirectoryHandle) {
                  const file = await loadScratchAssetBlob(scratchDirectoryHandle, item.scratchFileName).catch(() => undefined);

                  if (file) {
                    return {
                      id: item.id,
                      label: item.label,
                      kind: item.kind,
                      mimeType: file.type || item.mimeType,
                      scratchFileName: item.scratchFileName,
                      nativeFilePath: item.nativeFilePath,
                      assetUrl: URL.createObjectURL(file),
                      text: item.text,
                      createdAt: item.createdAt,
                      sourceKey: item.sourceKey,
                      originNodeId: item.originNodeId,
                      isGenerated: item.isGenerated,
                      starred: Boolean(item.starred),
                      collapsed: Boolean(item.collapsed),
                      envelopeId: item.envelopeId,
                      envelopeLabel: item.envelopeLabel,
                      envelopeIndex: item.envelopeIndex,
                      envelopeCollapsed: item.envelopeCollapsed,
                      professional: item.professional,
                    } satisfies SourceBinLibraryItem;
                  }
                }

                // Resolve by assetId, or by the id in a `signal-loom-asset://asset/<id>`
                // URL — that scheme only loads on Electron, so Android/web items must
                // be backed by local bytes here or they render MISSING.
                const lookupId = item.assetId ?? parseSignalLoomAssetId(item.assetUrl);
                if (lookupId) {
                  const storedAsset = await loadImportedAssetIfAvailable(lookupId);

                  if (storedAsset) {
                    return {
                      id: item.id,
                      label: item.label,
                      kind: item.kind,
                      mimeType: storedAsset.mimeType,
                      assetId: item.assetId ?? lookupId,
                      scratchFileName: item.scratchFileName,
                      nativeFilePath: item.nativeFilePath,
                      assetUrl: storedAsset.dataUrl,
                      text: item.text,
                      pixelWidth: item.pixelWidth,
                      pixelHeight: item.pixelHeight,
                      createdAt: item.createdAt,
                      sourceKey: item.sourceKey,
                      originNodeId: item.originNodeId,
                      isGenerated: item.isGenerated,
                      starred: Boolean(item.starred),
                      collapsed: Boolean(item.collapsed),
                      envelopeId: item.envelopeId,
                      envelopeLabel: item.envelopeLabel,
                      envelopeIndex: item.envelopeIndex,
                      envelopeCollapsed: item.envelopeCollapsed,
                      professional: item.professional,
                    } satisfies SourceBinLibraryItem;
                  }
                }

                if (item.nativeFilePath || item.scratchFileName) {
                  return {
                    id: item.id,
                    label: item.label,
                    kind: item.kind,
                    mimeType: item.mimeType ?? getDefaultMimeType(item.kind),
                    assetId: item.assetId,
                    scratchFileName: item.scratchFileName,
                    nativeFilePath: item.nativeFilePath,
                    assetUrl: item.assetUrl,
                    text: item.text,
                    pixelWidth: item.pixelWidth,
                    pixelHeight: item.pixelHeight,
                      createdAt: item.createdAt,
                      sourceKey: item.sourceKey,
                      originNodeId: item.originNodeId,
                      isGenerated: item.isGenerated,
                      starred: Boolean(item.starred),
                      collapsed: Boolean(item.collapsed),
                      envelopeId: item.envelopeId,
                    envelopeLabel: item.envelopeLabel,
                    envelopeIndex: item.envelopeIndex,
                    envelopeCollapsed: item.envelopeCollapsed,
                    professional: item.professional,
                  } satisfies SourceBinLibraryItem;
                }

                if (item.durability === 'unavailable') {
                  return { ...item, assetUrl: undefined } satisfies SourceBinLibraryItem;
                }

                if (!item.assetUrl) {
                  return undefined;
                }

                return persistLibraryAssetItemWithFallback({
                  id: item.id,
                  label: item.label,
                  kind: item.kind,
                  mimeType: item.mimeType ?? getDefaultMimeType(item.kind),
                  dataUrl: item.assetUrl,
                  sourceKey: item.sourceKey,
                  originNodeId: item.originNodeId,
                  isGenerated: item.isGenerated,
                  pixelWidth: item.pixelWidth,
                  pixelHeight: item.pixelHeight,
                  createdAt: item.createdAt,
                  starred: Boolean(item.starred),
                  collapsed: Boolean(item.collapsed),
                  envelopeId: item.envelopeId,
                  envelopeLabel: item.envelopeLabel,
                  envelopeIndex: item.envelopeIndex,
                  envelopeCollapsed: item.envelopeCollapsed,
                  professional: item.professional,
                }, scratchDirectoryHandle);
              }),
            );

            return {
              id: bin.id ?? globalThis.crypto?.randomUUID?.() ?? `bin-${Date.now()}`,
              name: bin.name || 'Source Library',
              items: restoredItems.filter((item): item is SourceBinLibraryItem => Boolean(item)),
              collapsed: Boolean(bin.collapsed),
              createdAt: bin.createdAt ?? Date.now(),
            };
          }),
        );

        const restoredSnapshot = {
          bins: restoredBins,
          dismissedSourceKeys: safeSnapshot.dismissedSourceKeys ?? [],
        };

        const previousBins = get().bins;
        const nextBins = withMountedHaneProviderBins(restoredBins, previousBins);
        set({ ...restoredSnapshot, bins: nextBins });
        syncRevocableObjectUrls(previousBins, nextBins);
        if (publishNative) {
          syncNativeSourceLibrarySnapshot(restoredSnapshot);
        }
      },
      reconcileWithNativeSourceLibrarySnapshot: async () => {
        // In the desktop multi-window app each workspace opens in its own window/store, and the
        // Source Library is a *global* resource whose authoritative state lives in the native main
        // process (`sourceLibrarySnapshot` = the project's saved bin + anything generated/added in
        // other windows since the last save). A freshly-opened window's `restoreProjectSnapshot`
        // replaces the Source Library with the *static* saved-project bin, which clobbers those
        // live cross-window assets. Re-apply the authoritative native snapshot so they survive.
        // No-op without the native bridge (web / mobile single-window — nothing to reconcile).
        const bridge = getSignalLoomNativeBridge();
        const scope = captureProjectAuthorityMutationScope();
        if (!bridge?.getSourceLibrarySnapshot || !scope) {
          return;
        }

        const result = await bridge.getSourceLibrarySnapshot({ claim: scope.claim }).catch(() => undefined);
        if (
          !result?.snapshot
          || !(result.version > 0)
          || !isCurrentProjectAuthorityMutationScope(scope)
          || result.authority.authorityId !== scope.claim.authorityId
          || result.authority.version !== scope.claim.version
        ) {
          return;
        }

        let changed = false;
        set((state) => {
          const nextState = applySourceLibraryNativeChange(
            { bins: state.bins, dismissedSourceKeys: state.dismissedSourceKeys },
            { type: 'source-library-snapshot', snapshot: result.snapshot },
          );
          changed = nextState.bins !== state.bins || nextState.dismissedSourceKeys !== state.dismissedSourceKeys;
          return changed ? nextState : {};
        });

        if (changed) {
          await get().hydrateAssets().catch(() => undefined);
        }
      },
      addAssetItem: async (item, targetBinId, options) => {
        const existingSourceKeyItem = item.sourceKey
          ? get().bins.flatMap((bin) => bin.items).find((candidate) => candidate.sourceKey === item.sourceKey)
          : undefined;
        // A deferred run publication must never mutate or assume ownership of an
        // already-published deduplicated item. Returning it unchanged also makes a
        // later stale-run discard an intentional no-op.
        if (options?.deferPublication && existingSourceKeyItem) {
          return existingSourceKeyItem;
        }
        const nextItem = await persistLibraryAssetItemWithFallback({
          ...item,
          professional: item.professional ?? createProfessionalMediaState(item.isGenerated ? 'generated' : 'imported'),
          id: existingSourceKeyItem?.id ?? item.id,
          createdAt: existingSourceKeyItem?.createdAt ?? Date.now(),
          starred: existingSourceKeyItem?.starred,
          collapsed: existingSourceKeyItem?.collapsed,
        }, get().scratchDirectoryHandle);
        if (item.originWorkspaceId) {
          nextItem.originWorkspaceId = item.originWorkspaceId;
        }
        if (item.originRunId) {
          nextItem.originRunId = item.originRunId;
        }
        let resultItem = nextItem;

        set((state) => {
          const targetIndex = targetBinId
            ? state.bins.findIndex((bin) => bin.id === targetBinId)
            : 0;
          const binIndex = targetIndex >= 0 ? targetIndex : 0;
          // An explicit add is the user intentionally (re-)creating this asset — clear any
          // standing dismissal for its key so the ingest guard (811 F1) doesn't fight it.
          const dismissedSourceKeys = nextItem.sourceKey && state.dismissedSourceKeys.includes(nextItem.sourceKey)
            ? state.dismissedSourceKeys.filter((key) => key !== nextItem.sourceKey)
            : state.dismissedSourceKeys;

          if (nextItem.sourceKey) {
            let didReplace = false;
            const bins = state.bins.map((bin) => {
              const items: SourceBinLibraryItem[] = [];

              for (const existingItem of bin.items) {
                if (existingItem.sourceKey !== nextItem.sourceKey) {
                  items.push(existingItem);
                  continue;
                }

                if (didReplace) {
                  revokeSourceBinItemObjectUrl(existingItem);
                  continue;
                }

                if (existingItem.assetUrl !== nextItem.assetUrl && existingItem.assetUrl?.startsWith('blob:')) {
                  revokeObjectUrl(existingItem.assetUrl);
                }

                resultItem = {
                  ...existingItem,
                  label: nextItem.label,
                  kind: nextItem.kind,
                  mimeType: nextItem.mimeType,
                  assetId: nextItem.assetId,
                  assetUrl: nextItem.assetUrl,
                  scratchFileName: nextItem.scratchFileName,
                  nativeFilePath: nextItem.nativeFilePath,
                  text: nextItem.text,
                  pixelWidth: nextItem.pixelWidth,
                  pixelHeight: nextItem.pixelHeight,
                  sourceKey: nextItem.sourceKey,
                  originNodeId: nextItem.originNodeId,
                  originWorkspaceId: nextItem.originWorkspaceId,
                  originRunId: nextItem.originRunId,
                  isGenerated: nextItem.isGenerated,
                  professional: nextItem.professional,
                  envelopeId: nextItem.envelopeId,
                  envelopeLabel: nextItem.envelopeLabel,
                  envelopeIndex: nextItem.envelopeIndex,
                  envelopeCollapsed: nextItem.envelopeCollapsed ?? existingItem.envelopeCollapsed,
                  durability: nextItem.durability,
                  durabilityMessage: nextItem.durabilityMessage,
                  createdAt: existingItem.createdAt,
                  starred: existingItem.starred,
                  collapsed: existingItem.collapsed,
                };
                items.push(resultItem);
                didReplace = true;
              }

              return items === bin.items ? bin : { ...bin, items };
            });

            if (didReplace) {
              return { bins, dismissedSourceKeys };
            }
          }

          return {
            bins: state.bins.map((bin, index) =>
              index === binIndex ? { ...bin, items: [nextItem, ...bin.items] } : bin,
            ),
            dismissedSourceKeys,
          };
        });

        const isNewDeferredItem = Boolean(options?.deferPublication)
          && !existingSourceKeyItem
          && resultItem.id === nextItem.id;
        if (isNewDeferredItem) {
          provisionalSourceBinItemIds.add(resultItem.id);
        } else {
          broadcastSourceBinItemsAdded([resultItem], targetBinId);
        }
        return resultItem;
      },
      publishProvisionalAssetItem: (id, targetBinId) => {
        if (!provisionalSourceBinItemIds.delete(id)) {
          return undefined;
        }
        const item = get().bins.flatMap((bin) => bin.items).find((candidate) => candidate.id === id);
        if (!item) {
          return undefined;
        }
        broadcastSourceBinItemsAdded([item], targetBinId);
        return item;
      },
      discardProvisionalAssetItem: (id) => {
        if (!provisionalSourceBinItemIds.delete(id)) {
          return undefined;
        }
        const result = removeSourceBinItem(get().bins, id);
        if (!result) {
          return undefined;
        }
        set({ bins: result.bins });
        revokeSourceBinItemObjectUrl(result.removedItem);
        return result.removedItem;
      },
      ingestConnectedItems: async (connectedItems, targetBinId, ingestOptions) => {
        const initialState = get();
        const allExistingItems = initialState.bins.flatMap((bin) => bin.items);

        // Upgrade legacy sourceKeys in place. Older builds/tooling wrote keys without the
        // media-signature suffix (`kind:nodeId` only). When such an item owns the exact asset a
        // connected item carries, it IS that item — but the exact-key checks below both miss it:
        // the dedupe re-ingests it (duplicating the library one visited tab at a time) and the
        // stale-envelope cleanup prunes it (docs/notes/802). Upgrading the stored key first makes
        // every downstream exact-match path agree.
        const upgradedSourceKeysById = new Map<string, string>();
        for (const connectedItem of connectedItems) {
          if (connectedItem.kind === 'text' || !connectedItem.assetUrl) {
            continue;
          }
          const fullKey = buildConnectedItemSourceKey(connectedItem);
          const legacyKey = `${connectedItem.kind}:${connectedItem.nodeId}`;
          if (!fullKey || fullKey === legacyKey) {
            continue;
          }
          const legacyMatch = allExistingItems.find((item) => item.sourceKey === legacyKey);
          if (
            legacyMatch?.assetUrl &&
            buildMediaAssetSignaturePart(legacyMatch.assetUrl) === buildMediaAssetSignaturePart(connectedItem.assetUrl)
          ) {
            upgradedSourceKeysById.set(legacyMatch.id, fullKey);
          }
        }

        if (upgradedSourceKeysById.size > 0) {
          set((state) => ({
            bins: state.bins.map((bin) => ({
              ...bin,
              items: bin.items.map((item) => {
                const sourceKey = upgradedSourceKeysById.get(item.id);
                return sourceKey ? { ...item, sourceKey } : item;
              }),
            })),
          }));
        }

        const effectiveExistingItems = upgradedSourceKeysById.size > 0
          ? allExistingItems.map((item) => {
              const sourceKey = upgradedSourceKeysById.get(item.id);
              return sourceKey ? { ...item, sourceKey } : item;
            })
          : allExistingItems;

        // Check for existing library items that need their envelope metadata updated:
        const updatedItemsById = new Map<string, Partial<SourceBinLibraryItem>>();
        for (const connectedItem of connectedItems) {
          if (connectedItem.sourceBinItemId) {
            const existing = effectiveExistingItems.find((x) => x.id === connectedItem.sourceBinItemId);
            if (existing) {
              const needsUpdate =
                existing.envelopeId !== connectedItem.envelopeId ||
                existing.envelopeLabel !== connectedItem.envelopeLabel ||
                existing.envelopeIndex !== connectedItem.envelopeIndex;

              if (needsUpdate) {
                updatedItemsById.set(existing.id, {
                  envelopeId: connectedItem.envelopeId,
                  envelopeLabel: connectedItem.envelopeLabel,
                  envelopeIndex: connectedItem.envelopeIndex,
                });
              }
            }
          }
        }

        if (updatedItemsById.size > 0) {
          set((state) => ({
            bins: state.bins.map((bin) => ({
              ...bin,
              items: bin.items.map((item) => {
                const patch = updatedItemsById.get(item.id);
                return patch ? { ...item, ...patch } : item;
              }),
            })),
          }));
        }

        // Check for envelope items in the library that are no longer routed to any source bin:
        const connectedEnvelopeIds = new Set(
          connectedItems
            .map((item) => item.envelopeId)
            .filter((id): id is string => Boolean(id))
        );

        // Track active keys and active IDs for each connected envelope
        const activeConnectedKeysByEnvelope = new Map<string, Set<string>>();
        const activeConnectedIdsByEnvelope = new Map<string, Set<string>>();

        for (const connectedItem of connectedItems) {
          if (!connectedItem.envelopeId) continue;

          if (!activeConnectedKeysByEnvelope.has(connectedItem.envelopeId)) {
            activeConnectedKeysByEnvelope.set(connectedItem.envelopeId, new Set());
          }
          const key = buildConnectedItemSourceKey(connectedItem);
          if (key) {
            activeConnectedKeysByEnvelope.get(connectedItem.envelopeId)!.add(key);
          }

          if (connectedItem.sourceBinItemId) {
            if (!activeConnectedIdsByEnvelope.has(connectedItem.envelopeId)) {
              activeConnectedIdsByEnvelope.set(connectedItem.envelopeId, new Set());
            }
            activeConnectedIdsByEnvelope.get(connectedItem.envelopeId)!.add(connectedItem.sourceBinItemId);
          }
        }

        // Any source-bin item id referenced by a currently-connected item, across ALL envelopes. A batch
        // run tags its generated items with a per-run envelope hash that differs from the node-id envelope
        // the connected set reports, so the per-envelope match below misses them — this global id set keeps
        // every still-connected result (all N images of a batch), not just the first.
        const globalConnectedIds = new Set(
          connectedItems
            .map((item) => item.sourceBinItemId)
            .filter((id): id is string => Boolean(id)),
        );

        const itemsToRemove = effectiveExistingItems.filter((item) => {
          // If the item doesn't have an envelopeId, it wasn't ingested from an envelope. Keep it.
          if (!item.envelopeId) {
            return false;
          }

          // Still referenced by a connected item anywhere (e.g. a batch result) — keep it.
          if (globalConnectedIds.has(item.id)) {
            return false;
          }

          // The envelope isn't connected here. That means one of two very different things:
          // (a) it was disconnected from the source bin in THIS graph — its ingested items are
          //     stale, prune them — or (b) it was never part of this graph at all (an envelope in
          //     another flow-workspace tab or window). The library is GLOBAL across workspaces, so
          //     pruning (b) mass-deletes every other workspace's ingested assets the moment any
          //     tab's source-bin node ingests (the WnM1 73→1 library wipe, docs/notes/801). Only
          //     prune when the envelope node verifiably exists in the caller's graph; without
          //     graph context, never prune.
          if (!connectedEnvelopeIds.has(item.envelopeId)) {
            return ingestOptions?.graphNodeIds?.has(item.envelopeId) ?? false;
          }

          // The envelope is still connected.
          // Is this specific item still in the connected envelope?
          const activeKeys = activeConnectedKeysByEnvelope.get(item.envelopeId);
          const activeIds = activeConnectedIdsByEnvelope.get(item.envelopeId);

          const keyMatches = activeKeys && item.sourceKey && activeKeys.has(item.sourceKey);
          const idMatches = activeIds && activeIds.has(item.id);

          if (keyMatches || idMatches) {
            return false;
          }

          // Not found in the active connected items for this envelope, so remove it!
          return true;
        });

        if (itemsToRemove.length > 0) {
          set((state) => ({
            bins: state.bins.map((bin) => ({
              ...bin,
              items: bin.items.filter((item) => !itemsToRemove.some((x) => x.id === item.id)),
            })),
          }));
        }

        const pendingItems = takePendingSourceBinIngestItems(connectedItems, {
          dismissedSourceKeys: new Set(get().dismissedSourceKeys),
          existingItemIds: new Set(effectiveExistingItems.map((item) => item.id)),
          existingSourceKeys: new Set(
            effectiveExistingItems
              .map((item) => item.sourceKey)
              .filter((sourceKey): sourceKey is string => Boolean(sourceKey)),
          ),
          pendingSourceKeys: pendingConnectedSourceKeys,
        });
        const savedItems: SourceBinLibraryItem[] = [];

        try {
          for (const { item, sourceKey } of pendingItems) {
            try {
              if (item.kind === 'text' && item.text) {
                if (item.text.trim().startsWith('{') || item.text.trim().startsWith('[')) {
                  try {
                    const { parseSloomScriptToItems } = await import('../lib/sourceBinIngestScripts');
                    const scriptItems = parseSloomScriptToItems(item.text, item.label || 'Script');
                    for (const scriptItem of scriptItems) {
                      scriptItem.originNodeId = item.nodeId;
                      scriptItem.sourceKey = `${sourceKey}:${scriptItem.envelopeIndex}`;
                      savedItems.push(scriptItem);
                    }
                    continue;
                  } catch {
                    // Fall through and save as plain text
                  }
                }

                savedItems.push({
                  id: globalThis.crypto?.randomUUID?.() ?? `source-bin-${Date.now()}`,
                  label: item.label,
                  kind: 'text',
                  text: item.text,
                  createdAt: Date.now(),
                  sourceKey,
                  originNodeId: item.nodeId,
                  isGenerated: item.isGenerated,
                  envelopeId: item.envelopeId,
                  envelopeLabel: item.envelopeLabel,
                  envelopeIndex: item.envelopeIndex,
                  envelopeCollapsed: item.envelopeCollapsed,
                });
                continue;
              }

              if (!item.assetUrl) {
                continue;
              }

              const mimeType = item.mimeType ?? getDefaultMimeType(item.kind);
              savedItems.push(await persistLibraryAssetItemWithFallback({
                label: item.label,
                kind: item.kind as Exclude<EditorSourceKind, 'text'>,
                mimeType,
                dataUrl: item.assetUrl,
                sourceKey,
                originNodeId: item.nodeId,
                isGenerated: item.isGenerated,
                envelopeId: item.envelopeId,
                envelopeLabel: item.envelopeLabel,
                envelopeIndex: item.envelopeIndex,
                envelopeCollapsed: item.envelopeCollapsed,
              }, get().scratchDirectoryHandle));
            } catch (error) {
              // Keep the batch resilient, but never silently: a swallowed persist failure looks
              // exactly like "my asset disappeared" to the user (docs/notes/811 F4).
              console.warn(
                `[sourceBin] ingest skipped "${item.label ?? item.nodeId}" (${item.kind}) — the asset was not added to the library:`,
                error,
              );
              continue;
            }
          }

          if (savedItems.length === 0) {
            return;
          }

          let broadcastItems: SourceBinLibraryItem[] = [];

          set((state) => {
            const targetIndex = targetBinId
              ? state.bins.findIndex((bin) => bin.id === targetBinId)
              : 0;
            const binIndex = targetIndex >= 0 ? targetIndex : 0;

            const currentSourceKeys = new Set(
              state.bins
                .flatMap((bin) => bin.items)
                .map((item) => item.sourceKey)
                .filter((sourceKey): sourceKey is string => Boolean(sourceKey)),
            );
            const uniqueSavedItems = savedItems.filter((item) => {
              if (!item.sourceKey || currentSourceKeys.has(item.sourceKey)) {
                return false;
              }

              currentSourceKeys.add(item.sourceKey);
              return true;
            });

            if (uniqueSavedItems.length === 0) {
              return state;
            }

            broadcastItems = [...uniqueSavedItems];
            return {
              bins: state.bins.map((bin, index) =>
                index === binIndex
                  ? { ...bin, items: [...uniqueSavedItems.reverse(), ...bin.items] }
                  : bin,
              ),
            };
          });
          broadcastSourceBinItemsAdded(broadcastItems, targetBinId);
        } finally {
          for (const pendingItem of pendingItems) {
            pendingConnectedSourceKeys.delete(pendingItem.sourceKey);
          }
        }
      },
      importFiles: async (files, targetBinId) => {
        const fileList = Array.from(files);
        const importedItems: SourceBinLibraryItem[] = [];
        const scratchDirectoryHandle = get().scratchDirectoryHandle;

        for (const file of fileList) {
          if (file.name.toLowerCase().endsWith('.sloom-script') || file.name.toLowerCase().endsWith('.sloom-script.json')) {
            const text = await file.text().catch(() => undefined);
            if (text) {
              try {
                const { parseSloomScriptToItems } = await import('../lib/sourceBinIngestScripts');
                const items = parseSloomScriptToItems(text, file.name)
                  .map((item) => ({
                    ...item,
                    isGenerated: false,
                    professional: item.professional ?? createProfessionalMediaState('imported'),
                  }));
                importedItems.unshift(...items.reverse());
                continue;
              } catch {
                // fall through
              }
            }
          }

          const kind = inferSourceKindFromFile(file.name, file.type);

          if (!kind) {
            continue;
          }

          const id = globalThis.crypto?.randomUUID?.() ?? `source-bin-${Date.now()}`;
          const mimeType = file.type || inferMimeTypeFromFile(file.name, kind) || getDefaultMimeType(kind);
          const text = kind === 'document' && isBrowserTextDocument(file.name, mimeType)
            ? await file.text().catch(() => undefined)
            : undefined;

          if (shouldSessionLinkBrowserMedia({
            fileSize: file.size,
            hasScratchDirectory: Boolean(scratchDirectoryHandle),
            kind,
          })) {
            const fallbackItem = createFallbackLibraryAssetItem({
              id,
              label: file.name,
              kind,
              mimeType,
              dataUrl: createObjectAssetUrl(file),
              text,
              isGenerated: false,
            });
            fallbackItem.professional = createProfessionalMediaState('imported');
            importedItems.unshift(fallbackItem);
            reportSourceLibraryDurabilityFailure(
              fallbackItem,
              new Error('Large browser media was session-linked to avoid duplicating the full source in browser storage.'),
            );
            continue;
          }

          try {
            const storedAsset = scratchDirectoryHandle
              ? await storeScratchAssetBlob({
                  scratchDirectoryHandle,
                  item: {
                    id,
                    label: file.name,
                    kind,
                    mimeType,
                  },
                  blob: file,
                })
              : await saveImportedAsset(file);
            importedItems.unshift({
              id,
              label: file.name,
              kind,
              mimeType,
              assetId: scratchDirectoryHandle ? undefined : 'id' in storedAsset ? storedAsset.id : undefined,
              scratchFileName: scratchDirectoryHandle && 'fileName' in storedAsset ? storedAsset.fileName : undefined,
              assetUrl: 'assetUrl' in storedAsset ? storedAsset.assetUrl : storedAsset.dataUrl,
              text,
              createdAt: Date.now(),
              isGenerated: false,
              professional: createProfessionalMediaState('imported'),
            });
          } catch (error) {
            const recoveryDataUrl = canInlineFailedMediaImport(file.size)
              ? await blobToDataUrl(file).catch(() => createObjectAssetUrl(file))
              : createObjectAssetUrl(file);
            const fallbackItem = createFallbackLibraryAssetItem({
              id,
              label: file.name,
              kind,
              mimeType,
              dataUrl: recoveryDataUrl,
              text,
              isGenerated: false,
            });
            fallbackItem.professional = createProfessionalMediaState('imported');
            importedItems.unshift(fallbackItem);
            reportSourceLibraryDurabilityFailure(fallbackItem, error);
          }
        }

        let broadcastItems: SourceBinLibraryItem[] = [];
        set((state) => {
          const targetIndex = targetBinId
            ? state.bins.findIndex((bin) => bin.id === targetBinId)
            : 0;
          const binIndex = targetIndex >= 0 ? targetIndex : 0;
          const nextItems = assignProjectImportEnvelopeMetadata(
            importedItems,
            state.bins.flatMap((bin) => bin.items),
          );

          if (nextItems.length === 0) {
            return state;
          }

          broadcastItems = [...nextItems];

          return {
            bins: state.bins.map((bin, index) =>
              index === binIndex ? { ...bin, collapsed: false, items: [...nextItems, ...bin.items] } : bin,
            ),
          };
        });
        broadcastSourceBinItemsAdded(broadcastItems, targetBinId);
        return broadcastItems;
      },
      importNativeFiles: async (items, targetBinId) => {
        let broadcastItems: SourceBinLibraryItem[] = [];

        set((state) => {
          const targetIndex = targetBinId
            ? state.bins.findIndex((bin) => bin.id === targetBinId)
            : 0;
          const binIndex = targetIndex >= 0 ? targetIndex : 0;

          const allExistingItems = state.bins.flatMap((bin) => bin.items);
          const existingIds = new Set(allExistingItems.map((item) => item.id));
          const existingNativePaths = new Set(
            allExistingItems.map((item) => item.nativeFilePath).filter((value): value is string => Boolean(value)),
          );
          const rawNextItems = items.flatMap<SourceBinLibraryItem>((item) => {
            if (!item.assetUrl || existingIds.has(item.id) || (item.nativeFilePath && existingNativePaths.has(item.nativeFilePath))) {
              return [];
            }

            existingIds.add(item.id);

            if (item.nativeFilePath) {
              existingNativePaths.add(item.nativeFilePath);
            }

            return [{
              id: item.id,
              label: item.label,
              kind: item.kind,
              mimeType: item.mimeType ?? getDefaultMimeType(item.kind),
              assetUrl: item.assetUrl,
              scratchFileName: item.scratchFileName,
              nativeFilePath: item.nativeFilePath,
              text: item.text,
              pixelWidth: item.pixelWidth,
              pixelHeight: item.pixelHeight,
              createdAt: item.createdAt ?? Date.now(),
              sourceKey: item.sourceKey,
              originNodeId: item.originNodeId,
              isGenerated: item.isGenerated ?? false,
              professional: item.professional ?? createProfessionalMediaState(item.isGenerated ? 'generated' : 'imported'),
              starred: item.starred,
              collapsed: item.collapsed,
                envelopeId: item.envelopeId,
                envelopeLabel: item.envelopeLabel,
                envelopeIndex: item.envelopeIndex,
                envelopeCollapsed: item.envelopeCollapsed,
              }];
          });
          const nextItems = assignProjectImportEnvelopeMetadata(rawNextItems, allExistingItems);

          if (nextItems.length === 0) {
            return state;
          }

          broadcastItems = [...nextItems];
          return {
            bins: state.bins.map((bin, index) =>
              index === binIndex ? { ...bin, items: [...nextItems, ...bin.items] } : bin,
            ),
          };
        });
        broadcastSourceBinItemsAdded(broadcastItems, targetBinId);
      },
      toggleItemStarred: (id) =>
        set((state) => {
          const bins = toggleSourceBinItemStarred(state.bins, id);
          return bins ? { bins } : state;
        }),
      renameItem: (id, label) => {
        let didRename = false;
        set((state) => {
          const bins = renameSourceBinItem(state.bins, id, label);
          didRename = Boolean(bins);
          return bins ? { bins } : state;
        });
        if (didRename) {
          broadcastSourceBinItemRenamed(id, label);
        }
      },
      updateItemProfessional: (id, professional) => {
        const sanitized = sanitizeSourceBinProfessionalMediaState(professional);
        if (!sanitized) return;
        let updatedItem: SourceBinLibraryItem | undefined;
        let targetBinId: string | undefined;
        set((state) => {
          const bin = state.bins.find((candidate) => candidate.items.some((item) => item.id === id));
          if (!bin) return state;
          const bins = updateSourceBinItemProfessionalState(state.bins, id, sanitized);
          if (!bins) return state;
          targetBinId = bin.id;
          updatedItem = bins.flatMap((candidate) => candidate.items).find((item) => item.id === id);
          return { bins };
        });
        if (updatedItem) broadcastSourceBinItemsAdded([updatedItem], targetBinId);
      },
      updateItemsProfessional: (updates) => {
        const sanitizedById = new Map<string, SourceBinProfessionalMediaState>();
        for (const update of updates.slice(0, 2_000)) {
          const id = update.id.trim();
          const professional = sanitizeSourceBinProfessionalMediaState(update.professional);
          if (id && professional) sanitizedById.set(id, professional);
        }
        if (sanitizedById.size === 0) return;
        const updatedByBin = new Map<string, SourceBinLibraryItem[]>();
        set((state) => {
          let changed = false;
          const bins = state.bins.map((bin) => {
            let binChanged = false;
            const items = bin.items.map((item) => {
              const professional = sanitizedById.get(item.id);
              if (!professional) return item;
              const updated = { ...item, professional };
              const collected = updatedByBin.get(bin.id) ?? [];
              collected.push(updated);
              updatedByBin.set(bin.id, collected);
              binChanged = true;
              changed = true;
              return updated;
            });
            return binChanged ? { ...bin, items } : bin;
          });
          return changed ? { bins } : state;
        });
        for (const [binId, items] of updatedByBin) broadcastSourceBinItemsAdded(items, binId);
      },
      setItemCollapsed: (id, collapsed) =>
        set((state) => {
          const bins = setSourceBinItemCollapsed(state.bins, id, collapsed);
          return bins ? { bins } : state;
        }),
      setEnvelopeCollapsed: (envelopeId, collapsed) =>
        set((state) => {
          const bins = setSourceBinEnvelopeCollapsed(state.bins, envelopeId, collapsed);
          return bins ? { bins } : state;
        }),
      setAllItemsCollapsed: (collapsed) =>
        set((state) => ({ bins: setAllSourceBinItemsCollapsed(state.bins, collapsed) })),
      removeItem: (id) => {
        provisionalSourceBinItemIds.delete(id);
        const result = removeSourceBinItem(get().bins, id);

        if (!result) {
          return undefined;
        }

        // Record the dismissal so the ingest effect can't resurrect a still-wired
        // generated asset the user just deleted (docs/notes/811 F1). Bounded FIFO —
        // dismissals only need to outlive the node connections that produced them.
        const removedSourceKey = result.removedItem.sourceKey;
        set((state) => ({
          bins: result.bins,
          dismissedSourceKeys: removedSourceKey && !state.dismissedSourceKeys.includes(removedSourceKey)
            ? [...state.dismissedSourceKeys, removedSourceKey].slice(-300)
            : state.dismissedSourceKeys,
        }));
        revokeSourceBinItemObjectUrl(result.removedItem);
        broadcastSourceBinItemRemoved(result.removedItem);

        // Notify flowStore to remove references to the deleted item:
        import('./flowStore').then(({ useFlowStore }) => {
          useFlowStore.getState().onSourceBinItemRemoved(id, result.removedItem);
        }).catch(() => {});

        return result.removedItem;
      },
      updateAssetItemData: async (id, itemUpdate) => {
        const persisted = await persistLibraryAssetItemWithFallback({
          label: itemUpdate.label ?? 'updated-asset',
          kind: 'image',
          mimeType: itemUpdate.mimeType,
          dataUrl: itemUpdate.dataUrl,
          pixelWidth: itemUpdate.pixelWidth,
          pixelHeight: itemUpdate.pixelHeight,
        }, get().scratchDirectoryHandle);

        let updatedItem: SourceBinLibraryItem | undefined = undefined;

        set((state) => {
          const bins = state.bins.map((bin) => {
            const index = bin.items.findIndex((it) => it.id === id);
            if (index < 0) return bin;

            const existingItem = bin.items[index];
            if (existingItem.assetUrl !== persisted.assetUrl && existingItem.assetUrl?.startsWith('blob:')) {
              revokeObjectUrl(existingItem.assetUrl);
            }

            const nextItem = {
              ...existingItem,
              label: itemUpdate.label ?? existingItem.label,
              mimeType: persisted.mimeType,
              assetId: persisted.assetId,
              assetUrl: persisted.assetUrl,
              scratchFileName: persisted.scratchFileName,
              nativeFilePath: persisted.nativeFilePath,
              durability: persisted.durability,
              durabilityMessage: persisted.durabilityMessage,
              pixelWidth: persisted.pixelWidth,
              pixelHeight: persisted.pixelHeight,
              createdAt: Date.now(),
            } satisfies SourceBinLibraryItem;
            updatedItem = nextItem;

            const items = [...bin.items];
            items[index] = nextItem;
            return { ...bin, items };
          });

          return { bins };
        });

        const resultItem = updatedItem || persisted;
        if (updatedItem) {
          broadcastSourceBinItemsAdded([updatedItem]);
        }
        return resultItem;
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createQuotaSafeJSONStorage(),
      migrate: (persistedState, version) => {
        const persisted = sanitizePersistedSourceBinState(persistedState);
        if (version === 0 || !Array.isArray(persisted.bins)) {
          const oldItems = Array.isArray(persisted.items) ? persisted.items : [];
          return {
            ...persisted,
            sidebarOpen: persisted.sidebarOpen ?? true,
            dismissedSourceKeys: persisted.dismissedSourceKeys ?? [],
            nativeScratchDirectoryPath: persisted.nativeScratchDirectoryPath,
            durabilityStatus: persisted.durabilityStatus,
            bins: [{
              id: 'default',
              name: 'Source Library',
              items: oldItems,
              collapsed: false,
              createdAt: Date.now(),
            }],
          } as never;
        }
        return {
          ...persisted,
          sidebarOpen: persisted.sidebarOpen ?? true,
          dismissedSourceKeys: persisted.dismissedSourceKeys ?? [],
          nativeScratchDirectoryPath: persisted.nativeScratchDirectoryPath,
          durabilityStatus: persisted.durabilityStatus,
          bins: persisted.bins,
        } as never;
      },
      merge: (persisted, current) => {
        const safe = sanitizePersistedSourceBinState(persisted);
        return {
          ...current,
          sidebarOpen: safe.sidebarOpen ?? current.sidebarOpen,
          dismissedSourceKeys: safe.dismissedSourceKeys ?? current.dismissedSourceKeys,
          nativeScratchDirectoryPath: safe.nativeScratchDirectoryPath,
          durabilityStatus: safe.durabilityStatus ?? current.durabilityStatus,
          bins: (safe.bins ?? (safe.items ? [{ ...createDefaultBin(), items: safe.items }] : current.bins))
            .filter((bin) => !isHaneProviderBinId(bin.id)),
        };
      },
      partialize: (state: SourceBinState): PersistedSourceBinState => buildPersistedSourceBinState(state),
    },
  ),
);

function scheduleSourceLibraryDurabilityFailure(message: string, itemId?: string): void {
  pendingDurabilityMessage = message;
  if (itemId) pendingDurabilityItemIds.add(itemId);
  const fingerprint = `${message}:${[...pendingDurabilityItemIds].sort().join(',')}`;
  if (fingerprint === lastReportedDurabilityFingerprint) return;
  lastReportedDurabilityFingerprint = fingerprint;

  queueMicrotask(() => {
    const queuedMessage = pendingDurabilityMessage;
    const affectedItemIds = [...pendingDurabilityItemIds];
    pendingDurabilityMessage = undefined;
    pendingDurabilityItemIds.clear();
    if (!queuedMessage) return;
    useSourceBinStore.setState({
      durabilityStatus: {
        state: 'degraded',
        message: queuedMessage,
        ...(affectedItemIds.length > 0 ? { affectedItemIds } : {}),
        updatedAt: Date.now(),
      },
    });
  });
}

function getDefaultMimeType(kind: EditorSourceKind): string {
  return getDefaultMimeTypeForKind(kind);
}

// Phone-as-host: serve this device's live source library to a served desktop browser, and (Phase B)
// apply source-library mutations a served client pushes back. The seed carries the authority's current
// version so the client can tail the change log from the right point. Asset bytes are excluded from the
// seed — the served client streams them on demand via `/__loom/api/asset/:id`. No-op off native Android.
initializeLanServerProxy({
  getSourceLibrary: async () => {
    const snapshot = await useSourceBinStore.getState().exportProjectSnapshot({
      includeAssetData: false,
    });
    return { version: getHostSourceLibraryVersion(), snapshot };
  },
  // Bind metadata, sample, and materialized payload to one exact bounded
  // transport identity. This prevents a replaced LAN asset from reusing an
  // earlier sample or stale middle bytes.
  getSourceAssetMetadata: async (itemId) => {
    const record = await loadSourceAssetTransportRecord(itemId, MAX_BINARY_RESUME_BYTES);
    return record ? createStoredAssetTransportMetadata(record) : null;
  },
  getSourceAssetSample: async (itemId, request) => {
    if (!request) return null;
    const record = await loadSourceAssetTransportRecord(itemId, request.maxBytes);
    return record ? createStoredAssetTransportSample(record, request) : null;
  },
  getSourceAsset: async (itemId, request) => {
    if (!request) return null;
    const record = await loadSourceAssetTransportRecord(itemId, request.maxBytes);
    return record ? createStoredAssetTransportRecord(record, request) : null;
  },
  applySourceLibraryMutation: async (change) => {
    // Apply via the reducer (not the public actions) so this incoming change isn't re-broadcast back
    // through the normal hooks, then record it on the host log so other served clients tail it. Reducer
    // ops are idempotent by id, so the originating client's own long-poll echo is harmless.
    let changed = false;
    useSourceBinStore.setState((state) => {
      const next = applySourceLibraryNativeChange(
        { bins: state.bins, dismissedSourceKeys: state.dismissedSourceKeys },
        change,
      );
      changed = next.bins !== state.bins || next.dismissedSourceKeys !== state.dismissedSourceKeys;
      return changed ? next : {};
    });
    if (changed) {
      notifyLanSourceLibraryChange(change);
      void useSourceBinStore.getState().hydrateAssets();
    }
  },
});

export function sanitizePersistedSourceBinState(value: unknown): PersistedSourceBinState {
  const input = isRecord(value) ? value : {};
  const bins = Array.isArray(input.bins)
    ? input.bins.map((bin, index) => normalizeSourceBin(bin, index)).filter((bin): bin is SourceBin => Boolean(bin))
    : undefined;
  const items = Array.isArray(input.items)
    ? repairDuplicateSourceBinEnvelopeIndexes(
        input.items.map(normalizeSourceBinLibraryItem).filter((item): item is SourceBinLibraryItem => Boolean(item)),
      )
    : undefined;
  return {
    bins: bins && bins.length > 0 ? bins : undefined,
    items,
    dismissedSourceKeys: Array.isArray(input.dismissedSourceKeys)
      ? input.dismissedSourceKeys.filter((key): key is string => typeof key === 'string')
      : [],
    sidebarOpen: typeof input.sidebarOpen === 'boolean' ? input.sidebarOpen : true,
    nativeScratchDirectoryPath: typeof input.nativeScratchDirectoryPath === 'string' ? input.nativeScratchDirectoryPath : undefined,
    durabilityStatus: normalizeSourceLibraryDurabilityStatus(input.durabilityStatus),
  };
}

function normalizeSourceLibraryDurabilityStatus(value: unknown): SourceLibraryDurabilityStatus | undefined {
  const input = isRecord(value) ? value : undefined;
  if (!input || (input.state !== 'ready' && input.state !== 'degraded')) return undefined;
  return {
    state: input.state,
    message: optionalString(input.message),
    affectedItemIds: Array.isArray(input.affectedItemIds)
      ? input.affectedItemIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    updatedAt: typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : undefined,
  };
}

function normalizeSourceBin(value: unknown, index: number): SourceBin | undefined {
  const input = isRecord(value) ? value : undefined;
  if (!input) return undefined;
  if (input.id === TRANSIENT_RECOVERED_SCRATCH_BIN_ID) return undefined;
  const items = Array.isArray(input.items)
    ? input.items.map(normalizeSourceBinLibraryItem).filter((item): item is SourceBinLibraryItem => Boolean(item))
    : [];
  return {
    id: stringOr(input.id, index === 0 ? 'default' : `bin-${index}`),
    name: stringOr(input.name, index === 0 ? 'Source Library' : 'Recovered Bin'),
    items: repairDuplicateSourceBinEnvelopeIndexes(items),
    collapsed: Boolean(input.collapsed),
    createdAt: finiteOr(input.createdAt, Date.now()),
  };
}

function repairDuplicateSourceBinEnvelopeIndexes(items: SourceBinLibraryItem[]): SourceBinLibraryItem[] {
  const manualItems = items.filter((item) => !item.envelopeId || item.envelopeIndex === undefined);
  const envelopeItems = items.filter((item) => item.envelopeId && item.envelopeIndex !== undefined);

  const itemsByEnvelope = new Map<string, SourceBinLibraryItem[]>();
  for (const item of envelopeItems) {
    const envId = item.envelopeId!;
    const list = itemsByEnvelope.get(envId) ?? [];
    list.push(item);
    itemsByEnvelope.set(envId, list);
  }

  const repairedEnvelopeItems: SourceBinLibraryItem[] = [];

  for (const [envelopeId, group] of itemsByEnvelope.entries()) {
    const seenIds = new Set<string>();
    const seenSignatures = new Set<string>();

    const uniqueGroup: SourceBinLibraryItem[] = [];

    for (const item of group) {
      const content = item.assetUrl || item.text;
      const signature = content ? `${item.kind}:${buildMediaAssetSignaturePart(content)}` : undefined;

      let originSlot = item.originNodeId;
      if (originSlot && originSlot.includes(':')) {
        const parts = originSlot.split(':');
        if (parts.length > 2) {
          originSlot = `${parts[0]}:${parts[1]}`;
        }
      }

      if (seenIds.has(item.id)) continue;
      if (signature && seenSignatures.has(signature)) continue;

      seenIds.add(item.id);
      if (signature) seenSignatures.add(signature);

      uniqueGroup.push({
        ...item,
        originNodeId: originSlot,
      });
    }

    const sorted = uniqueGroup.sort((left, right) => (left.envelopeIndex ?? 0) - (right.envelopeIndex ?? 0));

    const processedGroup = sorted.map((item, index) => {
      const originalIndex = item.envelopeIndex!;
      const nextIndex = index;

      return {
        ...item,
        envelopeIndex: nextIndex,
        originNodeId: rewriteEnvelopeIndexedValue(item.originNodeId, envelopeId, originalIndex, nextIndex),
        sourceKey: rewriteEnvelopeSourceKey(item.sourceKey, item.kind, envelopeId, originalIndex, nextIndex, item.originNodeId),
      };
    });

    repairedEnvelopeItems.push(...processedGroup);
  }

  return [...manualItems, ...repairedEnvelopeItems];
}

function rewriteEnvelopeIndexedValue(
  value: string | undefined,
  envelopeId: string,
  originalIndex: number,
  nextIndex: number,
): string | undefined {
  if (!value) return value;

  if (value === `${envelopeId}:${originalIndex}`) {
    return `${envelopeId}:${nextIndex}`;
  }

  // Support any node ID structure with a trailing index (e.g. imageGen-1:1 or subNodeId:index)
  const regex = /:(\d+)$/;
  if (regex.test(value)) {
    return value.replace(regex, `:${nextIndex}`);
  }

  return value;
}

function rewriteEnvelopeSourceKey(
  value: string | undefined,
  kind: EditorSourceKind,
  envelopeId: string,
  originalIndex: number,
  nextIndex: number,
  originNodeId?: string,
): string | undefined {
  if (!value) return value;

  const oldNodeId = originNodeId || `${envelopeId}:${originalIndex}`;
  const newNodeId = rewriteEnvelopeIndexedValue(oldNodeId, envelopeId, originalIndex, nextIndex) || `${envelopeId}:${nextIndex}`;

  const oldPrefix = `${kind}:${oldNodeId}:`;
  const newPrefix = `${kind}:${newNodeId}:`;

  if (value.startsWith(oldPrefix)) {
    return `${newPrefix}${value.slice(oldPrefix.length)}`;
  }

  // Fallback to direct envelope prefix
  const fallbackOldPrefix = `${kind}:${envelopeId}:${originalIndex}:`;
  const fallbackNewPrefix = `${kind}:${envelopeId}:${nextIndex}:`;
  if (value.startsWith(fallbackOldPrefix)) {
    return `${fallbackNewPrefix}${value.slice(fallbackOldPrefix.length)}`;
  }

  return value;
}

function normalizeSourceBinLibraryItem(value: unknown): SourceBinLibraryItem | undefined {
  const input = isRecord(value) ? value : undefined;
  if (!input) return undefined;
  const kind = isEditorSourceKind(input.kind) ? input.kind : undefined;
  if (!kind) return undefined;
  const assetId = optionalString(input.assetId);
  const assetUrl = optionalString(input.assetUrl);
  const scratchFileName = optionalString(input.scratchFileName);
  const nativeFilePath = optionalString(input.nativeFilePath);
  const text = optionalString(input.text);
  const sourceKey = optionalString(input.sourceKey);
  const durability = input.durability === 'recovery-inline'
    || input.durability === 'session-only'
    || input.durability === 'unavailable'
    ? input.durability
    : undefined;
  if (sourceKey?.startsWith(TRANSIENT_RECOVERED_SCRATCH_SOURCE_KEY_PREFIX)) return undefined;
  if (kind === 'text' && !text && !assetUrl) return undefined;
  if (kind !== 'text' && !assetId && !assetUrl && !scratchFileName && !nativeFilePath && durability !== 'unavailable') return undefined;
  const label = stringOr(input.label, 'Untitled Source');
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType : getDefaultMimeType(kind);
  return {
    id: stringOr(input.id, `source-bin-${Date.now()}`),
    label,
    kind,
    mimeType,
    assetId,
    assetUrl,
    scratchFileName,
    nativeFilePath,
    text,
    pixelWidth: optionalFinitePositive(input.pixelWidth),
    pixelHeight: optionalFinitePositive(input.pixelHeight),
    createdAt: finiteOr(input.createdAt, Date.now()),
    sourceKey,
    originNodeId: optionalString(input.originNodeId),
    isGenerated: typeof input.isGenerated === 'boolean' ? input.isGenerated : undefined,
    starred: Boolean(input.starred),
    collapsed: Boolean(input.collapsed),
    envelopeId: optionalString(input.envelopeId),
    envelopeLabel: optionalString(input.envelopeLabel),
    envelopeIndex: typeof input.envelopeIndex === 'number' && Number.isFinite(input.envelopeIndex) ? input.envelopeIndex : undefined,
    envelopeCollapsed: typeof input.envelopeCollapsed === 'boolean' ? input.envelopeCollapsed : undefined,
    durability,
    durabilityMessage: optionalString(input.durabilityMessage),
    professional: sanitizeSourceBinProfessionalMediaState(input.professional),
  };
}

function isEditorSourceKind(value: unknown): value is EditorSourceKind {
  return typeof value === 'string' && VALID_SOURCE_KINDS.includes(value as EditorSourceKind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalFinitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeAssetLabel(label: string, kind: EditorSourceKind, mimeType: string): string {
  if (label.includes('.')) {
    return label;
  }

  const extension = inferDownloadExtension(mimeType, getDefaultExtension(kind));
  return `${label}.${extension}`;
}

function getDefaultExtension(kind: EditorSourceKind): string {
  switch (kind) {
    case 'image':
      return 'png';
    case 'video':
    case 'composition':
      return 'mp4';
    case 'audio':
      return 'mp3';
    case 'text':
      return 'txt';
    case 'document':
      return 'pdf';
    case 'subtitle':
      return 'vtt';
    case 'package':
      return 'zip';
  }
}

function isBrowserTextDocument(fileName: string, mimeType: string): boolean {
  const lowerName = fileName.toLowerCase();
  const normalizedMime = mimeType.split(';', 1)[0].toLowerCase();
  return normalizedMime.startsWith('text/')
    || normalizedMime === 'application/rtf'
    || lowerName.endsWith('.txt')
    || lowerName.endsWith('.md')
    || lowerName.endsWith('.markdown')
    || lowerName.endsWith('.rtf')
    || lowerName.endsWith('.html')
    || lowerName.endsWith('.htm');
}

async function persistLibraryAssetItem(item: {
  id?: string;
  label: string;
  kind: Exclude<EditorSourceKind, 'text'>;
  mimeType: string;
  dataUrl: string;
  blob?: Blob;
  nativeFilePath?: string;
  sourceKey?: string;
  originNodeId?: string;
  isGenerated?: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  createdAt?: number;
  starred?: boolean;
  collapsed?: boolean;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
  envelopeCollapsed?: boolean;
  professional?: SourceBinProfessionalMediaState;
}, scratchDirectoryHandle?: FileSystemDirectoryHandle): Promise<SourceBinLibraryItem> {
  if (item.nativeFilePath) {
    const nativeOutputAsset = await materializeLibraryAssetItemWithNativeBridge(item);
    if (nativeOutputAsset) {
      return nativeOutputAsset;
    }
  }

  if (scratchDirectoryHandle) {
    const id = item.id ?? globalThis.crypto?.randomUUID?.() ?? `source-bin-${Date.now()}`;
    const blob = await assetUrlToBlob(item.dataUrl, item.mimeType);
    const storedAsset = await storeScratchAssetBlob({
      scratchDirectoryHandle,
      item: {
        id,
        label: item.label,
        kind: item.kind,
        mimeType: item.mimeType,
      },
      blob,
    });

    return {
      id,
      label: item.label,
      kind: item.kind,
      mimeType: blob.type || item.mimeType,
      scratchFileName: storedAsset.fileName,
      assetUrl: storedAsset.assetUrl,
      createdAt: item.createdAt ?? Date.now(),
      sourceKey: item.sourceKey,
      originNodeId: item.originNodeId,
      isGenerated: item.isGenerated,
      pixelWidth: item.pixelWidth,
      pixelHeight: item.pixelHeight,
      starred: item.starred,
      collapsed: item.collapsed,
      envelopeId: item.envelopeId,
      envelopeLabel: item.envelopeLabel,
      envelopeIndex: item.envelopeIndex,
      envelopeCollapsed: item.envelopeCollapsed,
      professional: item.professional,
    };
  }

  const nativeAsset = item.nativeFilePath
    ? undefined
    : await materializeLibraryAssetItemWithNativeBridge(item);
  if (nativeAsset) {
    return nativeAsset;
  }

  try {
    const androidAsset = await materializeAndroidSourceAsset(item);
    if (androidAsset) {
      return androidAsset;
    }
  } catch (error) {
    if (isAndroidSourceAssetPermissionError(error)) {
      notifyAndroidSourceAssetPermissionRequired(item.label);
    }
    throw error;
  }

  // For blob URLs, fetch the blob directly and store it without the expensive
  // base64 round-trip through localizeAssetForProject. This avoids OOM failures
  // on large generated videos and ensures they get a reliable assetId.
  let storedAsset: StoredAssetPayload;
  if (item.blob || item.dataUrl.startsWith('blob:')) {
    const blob = item.blob ?? await assetUrlToBlob(item.dataUrl, item.mimeType);
    const fileName = normalizeAssetLabel(item.label, item.kind, blob.type || item.mimeType);
    storedAsset = await saveImportedAsset(new File([blob], fileName, { type: blob.type || item.mimeType }));
  } else {
    const localizedAsset = await localizeAssetForProject(item.dataUrl, item.mimeType);
    storedAsset = await saveDataUrlAsset({
      name: normalizeAssetLabel(item.label, item.kind, localizedAsset.mimeType),
      mimeType: localizedAsset.mimeType,
      dataUrl: localizedAsset.dataUrl,
    });
  }

  return {
    id: item.id ?? globalThis.crypto?.randomUUID?.() ?? `source-bin-${Date.now()}`,
    label: item.label,
    kind: item.kind,
    mimeType: storedAsset.mimeType,
    assetId: storedAsset.id,
    assetUrl: storedAsset.dataUrl,
    createdAt: item.createdAt ?? Date.now(),
      sourceKey: item.sourceKey,
      originNodeId: item.originNodeId,
      isGenerated: item.isGenerated,
      pixelWidth: item.pixelWidth,
    pixelHeight: item.pixelHeight,
    starred: item.starred,
    collapsed: item.collapsed,
    envelopeId: item.envelopeId,
    envelopeLabel: item.envelopeLabel,
    envelopeIndex: item.envelopeIndex,
    envelopeCollapsed: item.envelopeCollapsed,
    professional: item.professional,
  };
}

async function materializeLibraryAssetItemWithNativeBridge(item: {
  id?: string;
  label: string;
  kind: Exclude<EditorSourceKind, 'text'>;
  mimeType: string;
  dataUrl: string;
  blob?: Blob;
  nativeFilePath?: string;
  sourceKey?: string;
  originNodeId?: string;
  isGenerated?: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  createdAt?: number;
  starred?: boolean;
  collapsed?: boolean;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
  envelopeCollapsed?: boolean;
  professional?: SourceBinProfessionalMediaState;
}): Promise<SourceBinLibraryItem | undefined> {
  const bridge = getSignalLoomNativeBridge();
  const scope = captureProjectAuthorityMutationScope();
  if (!bridge?.materializeSourceAsset || !scope) {
    return undefined;
  }

  const materializeBlob = item.blob ?? (item.dataUrl.startsWith('blob:')
    ? await assetUrlToBlob(item.dataUrl, item.mimeType)
    : undefined);
  const binaryData = materializeBlob
    ? new Uint8Array(await materializeBlob.arrayBuffer())
    : undefined;

  const id = item.id ?? globalThis.crypto?.randomUUID?.() ?? `source-bin-${Date.now()}`;
  const result = await bridge.materializeSourceAsset({
    claim: scope.claim,
    id,
    label: item.label,
    kind: item.kind,
    mimeType: item.mimeType,
    dataUrl: item.dataUrl,
    nativeFilePath: item.nativeFilePath,
    ...(binaryData ? { binaryData } : {}),
    sourceKey: item.sourceKey,
    originNodeId: item.originNodeId,
    isGenerated: item.isGenerated,
    pixelWidth: item.pixelWidth,
    pixelHeight: item.pixelHeight,
    createdAt: item.createdAt,
    envelopeId: item.envelopeId,
    envelopeLabel: item.envelopeLabel,
    envelopeIndex: item.envelopeIndex,
    envelopeCollapsed: item.envelopeCollapsed,
    professional: item.professional,
  });

  if (!isCurrentProjectAuthorityMutationScope(scope) || !result.item || result.error) {
    return undefined;
  }

  return {
    ...result.item,
    id: result.item.id ?? id,
    label: result.item.label ?? item.label,
    kind: result.item.kind ?? item.kind,
    mimeType: result.item.mimeType ?? item.mimeType,
    createdAt: result.item.createdAt ?? item.createdAt ?? Date.now(),
    sourceKey: result.item.sourceKey ?? item.sourceKey,
    originNodeId: result.item.originNodeId ?? item.originNodeId,
    isGenerated: result.item.isGenerated ?? item.isGenerated,
    pixelWidth: result.item.pixelWidth ?? item.pixelWidth,
    pixelHeight: result.item.pixelHeight ?? item.pixelHeight,
    starred: result.item.starred ?? item.starred,
    collapsed: result.item.collapsed ?? item.collapsed,
    envelopeId: result.item.envelopeId ?? item.envelopeId,
    envelopeLabel: result.item.envelopeLabel ?? item.envelopeLabel,
    envelopeIndex: result.item.envelopeIndex ?? item.envelopeIndex,
    envelopeCollapsed: result.item.envelopeCollapsed ?? item.envelopeCollapsed,
    professional: result.item.professional ?? item.professional,
  };
}

async function persistLibraryAssetItemWithFallback(item: {
  id?: string;
  label: string;
  kind: Exclude<EditorSourceKind, 'text'>;
  mimeType: string;
  dataUrl: string;
  blob?: Blob;
  nativeFilePath?: string;
  sourceKey?: string;
  originNodeId?: string;
  isGenerated?: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  createdAt?: number;
  starred?: boolean;
  collapsed?: boolean;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
  envelopeCollapsed?: boolean;
  professional?: SourceBinProfessionalMediaState;
}, scratchDirectoryHandle?: FileSystemDirectoryHandle): Promise<SourceBinLibraryItem> {
  try {
    return await persistLibraryAssetItem(item, scratchDirectoryHandle);
  } catch (error) {
    let recoveryDataUrl = item.dataUrl;
    if (!recoveryDataUrl.startsWith('data:')) {
      recoveryDataUrl = await (async () => {
        const blob = item.blob ?? await assetUrlToBlob(item.dataUrl, item.mimeType);
        return blobToDataUrl(blob);
      })().catch(() => item.dataUrl);
    }
    const fallbackItem = createFallbackLibraryAssetItem({ ...item, dataUrl: recoveryDataUrl });
    reportSourceLibraryDurabilityFailure(fallbackItem, error);
    return fallbackItem;
  }
}

function reportSourceLibraryDurabilityFailure(item: SourceBinLibraryItem, error: unknown): void {
  const message = `“${item.label}” is available, but its Source Library bytes could not be saved to durable storage. Keep this session open until you regenerate, reimport, or save the item to a project scratch folder.`;
  scheduleSourceLibraryDurabilityFailure(message, item.id);
  console.warn(`[sourceBinStore] durable storage failed for "${item.label}"; retained a recovery item:`, error);
}

function notifyAndroidSourceAssetPermissionRequired(label: string): void {
  if (androidSourceAssetPermissionAlertOpen) {
    return;
  }

  androidSourceAssetPermissionAlertOpen = true;
  void showAlertDialog({
    title: 'Storage Permission Required',
    message: `Sloom Studio needs Android file storage access to save generated asset "${label}" into the Source Library. Tap Allow when Android asks for file access, then regenerate or reimport the asset if it was saved only as a temporary preview.`,
    confirmLabel: 'OK',
    tone: 'warning',
  }).finally(() => {
    androidSourceAssetPermissionAlertOpen = false;
  });
}

function createFallbackLibraryAssetItem(item: {
  id?: string;
  label: string;
  kind: Exclude<EditorSourceKind, 'text'>;
  mimeType: string;
  dataUrl?: string;
  text?: string;
  sourceKey?: string;
  originNodeId?: string;
  isGenerated?: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  createdAt?: number;
  starred?: boolean;
  collapsed?: boolean;
  envelopeId?: string;
  envelopeLabel?: string;
  envelopeIndex?: number;
  envelopeCollapsed?: boolean;
  professional?: SourceBinProfessionalMediaState;
}): SourceBinLibraryItem {
  const assetUrl = item.dataUrl;
  const durability: SourceLibraryItemDurability = assetUrl?.startsWith('data:')
    ? 'recovery-inline'
    : 'session-only';
  return {
    id: item.id ?? globalThis.crypto?.randomUUID?.() ?? `source-bin-${Date.now()}`,
    label: item.label,
    kind: item.kind,
    mimeType: item.mimeType,
    assetUrl,
    text: item.text,
    createdAt: item.createdAt ?? Date.now(),
    sourceKey: item.sourceKey,
    originNodeId: item.originNodeId,
    isGenerated: item.isGenerated,
    pixelWidth: item.pixelWidth,
    pixelHeight: item.pixelHeight,
    starred: item.starred,
    collapsed: item.collapsed,
    envelopeId: item.envelopeId,
    envelopeLabel: item.envelopeLabel,
    envelopeIndex: item.envelopeIndex,
    envelopeCollapsed: item.envelopeCollapsed,
    professional: item.professional,
    durability,
    durabilityMessage: durability === 'recovery-inline'
      ? 'Durable asset storage failed. Recovery bytes are stored inline and should be regenerated or reimported when convenient.'
      : 'Durable asset storage failed. This preview is available only in the current session and must be regenerated or reimported before closing.',
  };
}

async function loadSourceAssetTransportRecord(
  itemId: string,
  maxBytes: number,
): Promise<StoredAssetRecord | undefined> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_BINARY_RESUME_BYTES) return undefined;
  const state = useSourceBinStore.getState();
  const item = state.bins.flatMap((bin) => bin.items).find((candidate) => candidate.id === itemId);
  if (!item || item.kind === 'text') return undefined;

  let source: StoredAssetRecord | undefined;
  if (item.scratchFileName && state.scratchDirectoryHandle) {
    const blob = await loadScratchAssetBlob(state.scratchDirectoryHandle, item.scratchFileName).catch(() => undefined);
    if (blob) source = {
      id: item.id, name: item.label, mimeType: blob.type || item.mimeType || 'application/octet-stream',
      blob, byteLength: blob.size, createdAt: item.createdAt,
    };
  } else if (item.assetId) {
    const stored = await loadImportedAssetRecord(item.assetId).catch(() => undefined);
    if (stored) source = { ...stored, id: item.id, name: item.label, mimeType: item.mimeType || stored.mimeType };
  } else if (item.assetUrl?.startsWith('data:')) {
    source = {
      id: item.id, name: item.label, mimeType: item.mimeType || 'application/octet-stream',
      dataUrl: item.assetUrl, createdAt: item.createdAt,
    };
  } else if (item.assetUrl) {
    const blob = await assetUrlToBlob(item.assetUrl, item.mimeType, maxBytes).catch(() => undefined);
    if (blob) source = {
      id: item.id, name: item.label, mimeType: blob.type || item.mimeType || 'application/octet-stream',
      blob, byteLength: blob.size, createdAt: item.createdAt,
    };
  }
  return source ? {
    ...source,
    id: item.id,
    name: item.label,
    createdAt: item.createdAt,
    transportRevision: `source-v1:${source.transportRevision ?? item.scratchFileName ?? item.nativeFilePath ?? item.id}`,
  } : undefined;
}

async function loadItemAsDataUrl(
  item: SourceBinLibraryItem,
  scratchDirectoryHandle?: FileSystemDirectoryHandle,
): Promise<string | undefined> {
  if (item.scratchFileName && scratchDirectoryHandle) {
    const file = await loadScratchAssetBlob(scratchDirectoryHandle, item.scratchFileName).catch(() => undefined);
    return file ? blobToDataUrl(file) : undefined;
  }

  if (item.assetId) {
    return (await loadImportedAssetAsDataUrl(item.assetId).catch(() => undefined))?.dataUrl;
  }

  if (item.nativeFilePath && item.assetUrl) {
    const blob = await assetUrlToBlob(item.assetUrl, item.mimeType).catch(() => undefined);
    return blob ? blobToDataUrl(blob) : item.assetUrl;
  }

  if (item.assetUrl?.startsWith('data:')) {
    return item.assetUrl;
  }

  if (item.assetUrl) {
    const blob = await assetUrlToBlob(item.assetUrl, item.mimeType).catch(() => undefined);
    return blob ? await blobToDataUrl(blob) : undefined;
  }

  return undefined;
}

/** Materialize one existing Source Library item for an explicit cross-workspace handoff. */
export function materializeSourceBinItemDataUrl(
  item: SourceBinLibraryItem,
): Promise<string | undefined> {
  return loadItemAsDataUrl(item, useSourceBinStore.getState().scratchDirectoryHandle);
}

function createObjectAssetUrl(blob: Blob): string | undefined {
  try {
    return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(blob)
      : undefined;
  } catch {
    return undefined;
  }
}

async function assetUrlToBlob(
  url: string,
  fallbackMimeType?: string,
  maxBytes = MAX_BINARY_RESUME_BYTES,
): Promise<Blob> {
  if (url.startsWith('data:')) {
    const chunks: ArrayBuffer[] = [];
    const analysis = visitBase64DataUrlBytes(url, maxBytes, (bytes) => {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      chunks.push(copy.buffer);
    });
    if (!analysis) throw new Error('The source asset data URL is malformed or exceeds the decoded byte limit.');
    return new Blob(chunks, { type: analysis.mimeType || fallbackMimeType });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const bytes = await readBoundedBytesResponse(response, maxBytes, undefined, 15_000);
  if (!bytes) throw new Error('The source asset response is missing a bounded fixed-length body.');
  const mimeType = response.headers.get('content-type')?.split(';', 1)[0].trim()
    || fallbackMimeType
    || 'application/octet-stream';
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type: mimeType });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = '';

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
    }

    return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error ?? new Error('Failed to convert the scratch asset into a data URL.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The scratch asset could not be converted into a data URL.'));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}
