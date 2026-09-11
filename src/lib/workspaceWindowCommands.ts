import type { SourceBin, SourceBinLibraryItem } from '../store/sourceBinStore';
import type { ImageDocumentLinkedEdit } from '../types/imageEditor';
import {
  isWorkspaceWindowView,
  type WorkspaceWindowView,
} from './workspaceWindows';
import { getCurrentProjectAuthorityClaim, type NativeProjectAuthorityDescriptor } from './nativeApp';

export const WORKSPACE_WINDOW_COMMAND_CHANNEL = 'signal-loom-workspace-window-commands';

export type WorkspaceWindowCommand =
  | {
      type: 'source-bin-items-added';
      items: SourceBinLibraryItem[];
      targetWorkspace?: WorkspaceWindowView;
      targetBinId?: string;
    }
  | {
      type: 'source-bin-item-renamed';
      itemId: string;
      label: string;
      targetWorkspace?: WorkspaceWindowView;
    }
  | {
      type: 'source-bin-item-removed';
      itemId: string;
      sourceKey?: string;
      targetWorkspace?: WorkspaceWindowView;
    }
  | {
      type: 'flow-create-source-node';
      item: SourceBinLibraryItem;
      targetWorkspace: 'flow';
      targetFlowWorkspaceId?: string;
      targetBinId?: string;
    }
  | {
      type: 'flow-create-generation-node';
      prompt: string;
      label: string;
      targetWorkspace: 'flow';
      targetFlowWorkspaceId?: string;
    }
  | {
      type: 'video-select-source-item';
      item: SourceBinLibraryItem;
      targetWorkspace: 'editor';
    }
  | {
      /** A linked image edit returning to its Paper frame: merge the item, place it in the frame. */
      type: 'paper-place-source-asset';
      item: SourceBinLibraryItem;
      pageId: string;
      frameId: string;
      targetWorkspace: 'paper';
    }
  | {
      /**
       * Open a Source Library image as an (optionally linked) document in the Image
       * WINDOW. The document is rebuilt on the receiving side — ImageDocument holds
       * OffscreenCanvas bitmaps, which cannot ride a BroadcastChannel.
       */
      type: 'image-open-linked-document';
      item: SourceBinLibraryItem;
      linkedEdit?: ImageDocumentLinkedEdit;
      targetWorkspace: 'image';
    }
  | {
      /** A linked .slimg edit was written to disk: refresh Flow nodes bound to that file. */
      type: 'flow-slimg-file-updated';
      filePath: string;
      /** Flattened PNG data URL — becomes the node output without another disk read. */
      flattened: string;
      targetWorkspace: 'flow';
    };

export interface WorkspaceWindowCommandEnvelope {
  senderId: string;
  command: WorkspaceWindowCommand;
  authority: NativeProjectAuthorityDescriptor;
}

let cachedSenderId: string | undefined;

export function getWorkspaceWindowSenderId(): string {
  cachedSenderId ??= globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return cachedSenderId;
}

export function shouldRunFlowOwnedSourceBinIngest(activeWorkspaceView: WorkspaceWindowView): boolean {
  return activeWorkspaceView === 'flow';
}

export function createWorkspaceWindowCommandEnvelope(
  senderId: string,
  command: WorkspaceWindowCommand,
): WorkspaceWindowCommandEnvelope {
  const authority = getCurrentProjectAuthorityClaim();
  if (!authority) {
    throw new Error('A workspace command requires exact current project authority.');
  }
  return {
    senderId,
    command,
    authority,
  };
}

export function postWorkspaceWindowCommand(command: WorkspaceWindowCommand): boolean {
  const authority = getCurrentProjectAuthorityClaim();
  if (typeof BroadcastChannel === 'undefined' || !authority) {
    return false;
  }

  const channel = new BroadcastChannel(WORKSPACE_WINDOW_COMMAND_CHANNEL);
  channel.postMessage({
    senderId: getWorkspaceWindowSenderId(),
    command,
    authority,
  } satisfies WorkspaceWindowCommandEnvelope);
  channel.close();
  return true;
}

export function getWorkspaceWindowCommandForWorkspace(
  envelope: unknown,
  localSenderId: string,
  activeWorkspaceView: WorkspaceWindowView,
): WorkspaceWindowCommand | undefined {
  if (!isWorkspaceWindowCommandEnvelope(envelope) || envelope.senderId === localSenderId) {
    return undefined;
  }

  const { command } = envelope;
  const localAuthority = getCurrentProjectAuthorityClaim();
  if (
    !localAuthority
    || !envelope.authority
    || envelope.authority.authorityId !== localAuthority.authorityId
    || envelope.authority.version !== localAuthority.version
  ) {
    return undefined;
  }
  if (command.targetWorkspace && command.targetWorkspace !== activeWorkspaceView) {
    return undefined;
  }

  return command;
}

export function mergeSourceBinItemsIntoBins(
  bins: SourceBin[],
  items: SourceBinLibraryItem[],
  targetBinId?: string,
): SourceBin[] {
  const incomingItems = items.filter(isSourceBinLibraryItem);
  if (incomingItems.length === 0) {
    return bins;
  }

  const incomingItemsById = new Map(incomingItems.map((item) => [item.id, item]));
  let didReplaceExisting = false;
  const binsWithReplacements = bins.map((bin) => {
    let didReplaceInBin = false;
    const items = bin.items.map((item) => {
      const replacement = incomingItemsById.get(item.id);
      if (!replacement) {
        return item;
      }

      if (sourceBinLibraryItemsEqual(item, replacement)) {
        return item;
      }

      didReplaceExisting = true;
      didReplaceInBin = true;
      return replacement;
    });

    return didReplaceInBin ? { ...bin, items } : bin;
  });

  const existingIds = new Set(binsWithReplacements.flatMap((bin) => bin.items.map((item) => item.id)));
  const existingSourceKeys = new Set(
    binsWithReplacements
      .flatMap((bin) => bin.items)
      .map((item) => item.sourceKey)
      .filter((sourceKey): sourceKey is string => Boolean(sourceKey)),
  );
  const uniqueIncomingItems = incomingItems.filter((item) => {
    if (existingIds.has(item.id)) {
      return false;
    }

    if (item.sourceKey && existingSourceKeys.has(item.sourceKey)) {
      return false;
    }

    existingIds.add(item.id);
    if (item.sourceKey) {
      existingSourceKeys.add(item.sourceKey);
    }
    return true;
  });

  if (uniqueIncomingItems.length === 0) {
    return didReplaceExisting ? binsWithReplacements : bins;
  }

  const targetIndex = targetBinId
    ? bins.findIndex((bin) => bin.id === targetBinId)
    : 0;

  if (targetIndex >= 0) {
    return binsWithReplacements.map((bin, index) => (
      index === targetIndex
        ? { ...bin, collapsed: false, items: [...uniqueIncomingItems, ...bin.items] }
        : bin
    ));
  }

  return [
    ...binsWithReplacements,
    {
      id: targetBinId ?? 'default',
      name: 'Source Library',
      items: uniqueIncomingItems,
      collapsed: false,
      createdAt: Date.now(),
    },
  ];
}

// Every SourceBinLibraryItem field is a flat scalar, so a keyed compare is exhaustive. The
// `satisfies Record<keyof …, true>` fails to compile when a field is added without being listed
// here. This replaces a JSON.stringify comparison that serialized both items — including any
// multi-MB data: assetUrl — on every incoming cross-window merge (docs/notes/811 F5).
const SOURCE_BIN_ITEM_COMPARE_FIELDS = {
  id: true,
  label: true,
  kind: true,
  mimeType: true,
  assetId: true,
  assetUrl: true,
  scratchFileName: true,
  nativeFilePath: true,
  text: true,
  pixelWidth: true,
  pixelHeight: true,
  createdAt: true,
  sourceKey: true,
  originNodeId: true,
  originWorkspaceId: true,
  originRunId: true,
  starred: true,
  collapsed: true,
  envelopeId: true,
  envelopeLabel: true,
  envelopeIndex: true,
  envelopeCollapsed: true,
  isGenerated: true,
  durability: true,
  durabilityMessage: true,
  professional: true,
} satisfies Record<keyof SourceBinLibraryItem, true>;

const SOURCE_BIN_ITEM_COMPARE_KEYS = Object.keys(
  SOURCE_BIN_ITEM_COMPARE_FIELDS,
) as Array<keyof SourceBinLibraryItem>;

function sourceBinLibraryItemsEqual(left: SourceBinLibraryItem, right: SourceBinLibraryItem): boolean {
  return SOURCE_BIN_ITEM_COMPARE_KEYS.every((key) => (
    key === 'professional'
      ? JSON.stringify(left.professional) === JSON.stringify(right.professional)
      : left[key] === right[key]
  ));
}

export function renameSourceBinItemInBins(
  bins: SourceBin[],
  itemId: string,
  label: string,
): SourceBin[] {
  const normalizedLabel = label.trim();
  if (!itemId.trim() || !normalizedLabel) {
    return bins;
  }

  let didRename = false;
  const nextBins = bins.map((bin) => ({
    ...bin,
    items: bin.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      didRename = true;
      return { ...item, label: normalizedLabel };
    }),
  }));

  return didRename ? nextBins : bins;
}

export function removeSourceBinItemFromBins(
  bins: SourceBin[],
  itemId: string,
): SourceBin[] {
  if (!itemId.trim()) {
    return bins;
  }

  let didRemove = false;
  const nextBins = bins.map((bin) => {
    const nextItems = bin.items.filter((item) => item.id !== itemId);
    if (nextItems.length !== bin.items.length) {
      didRemove = true;
    }

    return nextItems === bin.items ? bin : { ...bin, items: nextItems };
  });

  return didRemove ? nextBins : bins;
}

function isWorkspaceWindowCommandEnvelope(value: unknown): value is WorkspaceWindowCommandEnvelope {
  if (!isPlainRecord(value)) {
    return false;
  }

  return typeof value.senderId === 'string'
    && isWorkspaceWindowCommand(value.command)
    && isProjectAuthorityDescriptor(value.authority);
}

function isProjectAuthorityDescriptor(value: unknown): value is NativeProjectAuthorityDescriptor {
  return isPlainRecord(value)
    && typeof value.authorityId === 'string'
    && value.authorityId.length > 0
    && Number.isInteger(value.version);
}

function isWorkspaceWindowCommand(value: unknown): value is WorkspaceWindowCommand {
  if (!isPlainRecord(value) || typeof value.type !== 'string') {
    return false;
  }

  const targetWorkspace = value.targetWorkspace;
  if (targetWorkspace !== undefined && !isWorkspaceWindowView(targetWorkspace)) {
    return false;
  }

  switch (value.type) {
    case 'source-bin-items-added':
      return Array.isArray(value.items);
    case 'source-bin-item-renamed':
      return typeof value.itemId === 'string' && typeof value.label === 'string';
    case 'source-bin-item-removed':
      return typeof value.itemId === 'string' && (value.sourceKey === undefined || typeof value.sourceKey === 'string');
    case 'flow-create-source-node':
      return value.targetWorkspace === 'flow'
        && (value.targetFlowWorkspaceId === undefined || typeof value.targetFlowWorkspaceId === 'string')
        && isSourceBinLibraryItem(value.item);
    case 'flow-create-generation-node':
      return value.targetWorkspace === 'flow'
        && typeof value.prompt === 'string'
        && value.prompt.length > 0
        && value.prompt.length <= 4_000
        && typeof value.label === 'string'
        && value.label.length > 0
        && value.label.length <= 256
        && (value.targetFlowWorkspaceId === undefined || typeof value.targetFlowWorkspaceId === 'string');
    case 'video-select-source-item':
      return value.targetWorkspace === 'editor' && isSourceBinLibraryItem(value.item);
    case 'paper-place-source-asset':
      return value.targetWorkspace === 'paper'
        && typeof value.pageId === 'string'
        && typeof value.frameId === 'string'
        && isSourceBinLibraryItem(value.item);
    case 'image-open-linked-document':
      return value.targetWorkspace === 'image'
        && isSourceBinLibraryItem(value.item)
        && (value.linkedEdit === undefined || isImageDocumentLinkedEdit(value.linkedEdit));
    case 'flow-slimg-file-updated':
      return value.targetWorkspace === 'flow'
        && typeof value.filePath === 'string'
        && typeof value.flattened === 'string';
    default:
      return false;
  }
}

function isSourceBinLibraryItem(value: unknown): value is SourceBinLibraryItem {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    (
      value.assetUrl === undefined ||
      typeof value.assetUrl === 'string'
    )
  );
}

function isImageDocumentLinkedEdit(value: unknown): value is ImageDocumentLinkedEdit {
  if (!isPlainRecord(value)) {
    return false;
  }

  if (value.kind === 'paper-frame') {
    return typeof value.pageId === 'string'
      && typeof value.frameId === 'string'
      && typeof value.sourceLabel === 'string';
  }

  if (value.kind === 'slimg-node') {
    return typeof value.filePath === 'string';
  }

  return false;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
