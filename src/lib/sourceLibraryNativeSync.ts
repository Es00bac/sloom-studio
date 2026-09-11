import type { SourceBin, SourceBinLibraryItem, SourceBinProjectSnapshot } from '../store/sourceBinStore';
import type { NativeProjectAuthorityDescriptor, NativeProjectSaveRejection } from './nativeApp';
import {
  mergeSourceBinItemsIntoBins,
  removeSourceBinItemFromBins,
  renameSourceBinItemInBins,
} from './workspaceWindowCommands';

const TRANSIENT_RECOVERED_SCRATCH_BIN_ID = 'recovered-scratch-assets';
const TRANSIENT_RECOVERED_SCRATCH_SOURCE_KEY_PREFIX = 'recovered-scratch:';

export type SourceLibraryNativeChange =
  | {
      type: 'source-library-snapshot';
      snapshot: SourceBinProjectSnapshot;
    }
  | {
      type: 'source-bin-items-added';
      items: SourceBinLibraryItem[];
      targetBinId?: string;
    }
  | {
      type: 'source-bin-item-renamed';
      itemId: string;
      label: string;
    }
  | {
      type: 'source-bin-item-removed';
      itemId: string;
      sourceKey?: string;
    };

export interface SourceLibraryNativeEvent {
  version: number;
  change: SourceLibraryNativeChange;
  authority: NativeProjectAuthorityDescriptor;
}

export interface SourceLibraryNativeSnapshotResult {
  version: number;
  snapshot: SourceBinProjectSnapshot;
  authority: NativeProjectAuthorityDescriptor;
}

export type SourceLibraryNativeSnapshotResponse = SourceLibraryNativeSnapshotResult | {
  version?: undefined;
  snapshot?: undefined;
  authority?: undefined;
  rejected: NativeProjectSaveRejection;
  error: string;
};

export type SourceLibraryNativeSyncState = 'idle' | 'syncing' | 'repairing' | 'synced' | 'degraded';
export type SourceLibraryNativeRepairDirection = 'push-renderer-snapshot' | 'pull-native-snapshot';

export interface SourceLibraryNativeSyncStatus {
  state: SourceLibraryNativeSyncState;
  repairDirection?: SourceLibraryNativeRepairDirection;
  message?: string;
  lastAckVersion?: number;
  expectedNativeVersion?: number;
  updatedAt?: number;
}

export interface SourceLibraryNativeAckResult {
  ok?: boolean;
  version?: number;
  error?: string;
}

export interface SourceLibraryRendererState {
  bins: SourceBin[];
  dismissedSourceKeys: string[];
}

// Renderer-local native event progress is deliberately module-owned rather than held in a React
// ref. Project replacement can therefore reset and roll it back through a closed transaction
// primitive without accepting a caller callback with ambient store authority.
let sourceLibraryRendererNativeVersion = 0;

export function getSourceLibraryRendererNativeVersion(): number {
  return sourceLibraryRendererNativeVersion;
}

export function setSourceLibraryRendererNativeVersion(version: number): void {
  sourceLibraryRendererNativeVersion = version;
}

export function sourceLibraryNativeAckNeedsRepair(result: SourceLibraryNativeAckResult | undefined): boolean {
  return !result?.ok;
}

export function buildSourceLibraryNativeSyncStatus(
  state: SourceLibraryNativeSyncState,
  options: {
    error?: unknown;
    expectedNativeVersion?: number;
    lastAckVersion?: number;
    message?: string;
    now?: number;
    repairDirection?: SourceLibraryNativeRepairDirection;
  } = {},
): SourceLibraryNativeSyncStatus {
  const errorMessage = options.error instanceof Error
    ? options.error.message
    : typeof options.error === 'string'
      ? options.error
      : undefined;

  return {
    state,
    ...(options.repairDirection ? { repairDirection: options.repairDirection } : {}),
    ...(options.message || errorMessage ? { message: options.message ?? errorMessage } : {}),
    ...(typeof options.lastAckVersion === 'number' && Number.isFinite(options.lastAckVersion)
      ? { lastAckVersion: options.lastAckVersion }
      : {}),
    ...(typeof options.expectedNativeVersion === 'number' && Number.isFinite(options.expectedNativeVersion)
      ? { expectedNativeVersion: options.expectedNativeVersion }
      : {}),
    ...(typeof options.now === 'number' ? { updatedAt: options.now } : { updatedAt: Date.now() }),
  };
}

export function shouldAcceptSourceLibraryNativeVersion(currentVersion: number, incomingVersion: number): boolean {
  return Number.isFinite(incomingVersion) && incomingVersion > 0 && incomingVersion > currentVersion;
}

export function shouldRepairSourceLibraryNativeVersionGap(currentVersion: number, incomingVersion: number): boolean {
  return Number.isFinite(currentVersion)
    && Number.isFinite(incomingVersion)
    && currentVersion > 0
    && incomingVersion > currentVersion + 1;
}

export function applySourceLibraryNativeChange(
  state: SourceLibraryRendererState,
  change: SourceLibraryNativeChange,
): SourceLibraryRendererState {
  switch (change.type) {
    case 'source-library-snapshot':
      return applySourceLibrarySnapshot(change.snapshot);
    case 'source-bin-items-added':
      return {
        ...state,
        bins: mergeSourceBinItemsIntoBins(state.bins, change.items, change.targetBinId),
      };
    case 'source-bin-item-renamed':
      return {
        ...state,
        bins: renameSourceBinItemInBins(state.bins, change.itemId, change.label),
      };
    case 'source-bin-item-removed': {
      const nextDismissedSourceKeys = change.sourceKey && !state.dismissedSourceKeys.includes(change.sourceKey)
        ? [...state.dismissedSourceKeys, change.sourceKey]
        : state.dismissedSourceKeys;

      return {
        bins: removeSourceBinItemFromBins(state.bins, change.itemId),
        dismissedSourceKeys: nextDismissedSourceKeys,
      };
    }
  }
}

function applySourceLibrarySnapshot(
  snapshot: SourceBinProjectSnapshot | undefined,
): SourceLibraryRendererState {
  if (!snapshot) {
    return {
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: Date.now(),
        items: [],
      }],
      dismissedSourceKeys: [],
    };
  }

  const safeSnapshot = stripTransientRecoveredScratchAssets(snapshot);
  const snapshotBins = safeSnapshot.bins?.length
    ? safeSnapshot.bins
    : safeSnapshot.items?.length
      ? [{
          id: 'default',
          name: 'Source Library',
          collapsed: false,
          createdAt: Date.now(),
          items: safeSnapshot.items,
        }]
      : undefined;

  if (!snapshotBins?.length) {
    return {
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: Date.now(),
        items: [],
      }],
      dismissedSourceKeys: [],
    };
  }

  return {
    bins: snapshotBins.map((bin) => ({
      id: bin.id,
      name: bin.name,
      collapsed: Boolean(bin.collapsed),
      createdAt: bin.createdAt,
      items: bin.items.map((item) => ({ ...item })),
    })),
    dismissedSourceKeys: safeSnapshot.dismissedSourceKeys ? [...safeSnapshot.dismissedSourceKeys] : [],
  };
}

function stripTransientRecoveredScratchAssets(snapshot: SourceBinProjectSnapshot | undefined): SourceBinProjectSnapshot {
  if (!snapshot) {
    return { bins: [], items: [], dismissedSourceKeys: [] };
  }
  const bins = snapshot.bins
    ?.filter((bin) => bin.id !== TRANSIENT_RECOVERED_SCRATCH_BIN_ID)
    .map((bin) => ({
      ...bin,
      items: bin.items.filter((item) => !isTransientRecoveredScratchAssetItem(item)),
    }));
  const items = snapshot.items?.filter((item) => !isTransientRecoveredScratchAssetItem(item));

  return {
    ...snapshot,
    bins,
    items,
    dismissedSourceKeys: snapshot.dismissedSourceKeys ?? [],
  };
}

function isTransientRecoveredScratchAssetItem(item: SourceBinLibraryItem): boolean {
  return typeof item.sourceKey === 'string' && item.sourceKey.startsWith(TRANSIENT_RECOVERED_SCRATCH_SOURCE_KEY_PREFIX);
}
