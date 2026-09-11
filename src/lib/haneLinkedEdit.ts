import { create } from 'zustand';
import { imageDocumentToDataUrl } from '../components/ImageEditor/ImageDocumentExport';
import {
  materializeSourceBinItemDataUrl,
  useSourceBinStore,
  type SourceBinLibraryItem,
} from '../store/sourceBinStore';
import { useImageEditorStore } from '../store/imageEditorStore';
import { usePaperStore } from '../store/paperStore';
import type { PaperDocument } from '../types/paper';
import {
  getRemoteHostPairingState,
  isHaneLinkProviderSession,
  remoteHostFetch,
} from './remoteHostClient';
import {
  startHaneStrokePreviewStream,
  stopHaneStrokePreviewStream,
  synchronizeHaneStrokePreviewDurable,
} from './haneStrokePreview';

const UPLOAD_CHUNK_CHARACTERS = 512 * 1024;
const MAX_HANDOFF_DATA_URL_CHARACTERS = 128 * 1024 * 1024;
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20_000;
const COMMIT_TIMEOUT_MS = 90_000;
const FLATTEN_COALESCE_MS = 180;

export interface HaneLinkedEditTarget {
  sessionId: string;
  documentId: string;
  paperDocumentId: string;
  pageId: string;
  frameId: string;
  sourceItemId: string;
  sourceLabel: string;
  haneSourceItemId?: string;
  startedAt: number;
  lastFlattenedAt?: number;
}

export interface HaneLinkedEditState {
  status: 'idle' | 'sending' | 'active' | 'recovering' | 'error';
  target: HaneLinkedEditTarget | null;
  pendingFrameId: string | null;
  error: string | null;
}

export const useHaneLinkedEditStore = create<HaneLinkedEditState>(() => ({
  status: 'idle',
  target: null,
  pendingFrameId: null,
  error: null,
}));

export function haneLinkedEditDocumentId(
  pageId: string,
  frameId: string,
  sourceItemId: string,
): string {
  return `hane-paper:${pageId}:${frameId}:${sourceItemId}`.slice(0, 240);
}

export type HaneLinkedEditPaperTargetLoss =
  | 'paper-document-closed'
  | 'frame-deleted'
  | 'frame-replaced';

export function haneLinkedEditPaperTargetLoss(
  target: HaneLinkedEditTarget,
  document: PaperDocument | undefined,
): HaneLinkedEditPaperTargetLoss | null {
  if (!document) return 'paper-document-closed';
  const frame = document.pages
    .find((page) => page.id === target.pageId)
    ?.frames.find((candidate) => candidate.id === target.frameId);
  if (!frame) return 'frame-deleted';
  if (
    frame.kind !== 'image'
    || frame.asset?.sourceBinItemId !== target.sourceItemId
  ) {
    return 'frame-replaced';
  }
  return null;
}

function boundedRecoveryIdentity(value: string): string {
  return encodeURIComponent(value).slice(0, 240);
}

export function haneLinkedEditRecoverySourceKey(target: HaneLinkedEditTarget): string {
  const returnedSourceIdentity = target.haneSourceItemId || target.sessionId;
  return [
    'paper-hane-recovered',
    boundedRecoveryIdentity(target.paperDocumentId),
    boundedRecoveryIdentity(returnedSourceIdentity),
  ].join(':');
}

function handoffMimeType(dataUrl: string, fallback: string): string {
  const match = dataUrl.match(/^data:([^;,]+);base64,/i);
  return (match?.[1] || fallback || 'image/png').toLowerCase();
}

function newUploadId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `hane-upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function writeHaneJson(
  path: string,
  value: unknown,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await remoteHostFetch(path, {
        method: 'PUT',
        body: JSON.stringify(value),
        timeoutMs,
      });
      const result = await response?.json().catch(() => null) as Record<string, unknown> | null;
      if (response?.ok && result?.ok === true) return result;
      if (response?.ok && typeof result?.error === 'string') {
        throw new Error(`Hane rejected the linked image (${result.error}).`);
      }
      if (response && response.status >= 400 && response.status < 500) {
        throw new Error(typeof result?.error === 'string' ? result.error : 'Hane rejected the linked image.');
      }
    } catch (error) {
      if (attempt === REQUEST_ATTEMPTS) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw new Error('Hane did not acknowledge the linked image.');
}

let startGeneration = 0;
let imageStoreUnsubscribe: (() => void) | null = null;
let paperStoreUnsubscribe: (() => void) | null = null;
let flattenTimer: ReturnType<typeof setTimeout> | null = null;
let flattenTail: Promise<void> = Promise.resolve();
let pendingFlattenGeneration = 0;
let targetFinalization: {
  sessionId: string;
  promise: Promise<SourceBinLibraryItem | null>;
} | null = null;

function ensureImageWatcher(): void {
  if (imageStoreUnsubscribe) return;
  imageStoreUnsubscribe = useImageEditorStore.subscribe((state, previous) => {
    if (state.remoteImageApplyEpoch === previous.remoteImageApplyEpoch) return;
    const target = useHaneLinkedEditStore.getState().target;
    if (!target || state.syncedImageDocumentId !== target.documentId) return;
    scheduleHaneFlatten();
  });
}

function paperDocumentForLinkedTarget(target: HaneLinkedEditTarget): PaperDocument | undefined {
  const state = usePaperStore.getState();
  if (state.activeDocumentId === target.paperDocumentId) {
    return state.document;
  }
  return state.documents.find((candidate) => candidate.id === target.paperDocumentId)?.document;
}

function ensurePaperWatcher(): void {
  if (paperStoreUnsubscribe) return;
  paperStoreUnsubscribe = usePaperStore.subscribe(() => {
    const state = useHaneLinkedEditStore.getState();
    const target = state.target;
    if (
      !target
      || state.status === 'idle'
      || state.status === 'sending'
      || state.status === 'recovering'
    ) return;
    const reason = haneLinkedEditPaperTargetLoss(
      target,
      paperDocumentForLinkedTarget(target),
    );
    if (reason) {
      void recoverHaneLinkedEditAfterPaperTargetLoss(reason).catch(() => undefined);
    }
  });
}

interface HaneLinkedEditRaster {
  dataUrl: string;
  width: number;
  height: number;
}

async function renderHaneLinkedEditTarget(
  target: HaneLinkedEditTarget,
): Promise<HaneLinkedEditRaster | null> {
  const document = useImageEditorStore.getState().documents
    .find((candidate) => candidate.id === target.documentId);
  if (!document) return null;
  const dataUrl = await imageDocumentToDataUrl(document);
  const current = useHaneLinkedEditStore.getState().target;
  if (!current || current.sessionId !== target.sessionId) return null;
  return {
    dataUrl,
    width: document.width,
    height: document.height,
  };
}

async function flattenHaneTargetIntoPaper(target: HaneLinkedEditTarget): Promise<void> {
  const raster = await renderHaneLinkedEditTarget(target);
  if (!raster) return;
  await useSourceBinStore.getState().updateAssetItemData(target.sourceItemId, {
    mimeType: 'image/png',
    dataUrl: raster.dataUrl,
    pixelWidth: raster.width,
    pixelHeight: raster.height,
  });
  const completedAt = Date.now();
  useHaneLinkedEditStore.setState((live) => (
    live.target?.sessionId === target.sessionId
      ? { target: { ...live.target, lastFlattenedAt: completedAt } }
      : {}
  ));
}

export async function preserveHaneLinkedEditTargetAsRecoveredSourceItem(
  target: HaneLinkedEditTarget,
): Promise<SourceBinLibraryItem> {
  const raster = await renderHaneLinkedEditTarget(target);
  if (!raster) {
    throw new Error('The final Hane canvas is not available for Source Library recovery.');
  }
  return useSourceBinStore.getState().addAssetItem({
    label: `${target.sourceLabel} — Recovered from Hane`,
    kind: 'image',
    mimeType: 'image/png',
    dataUrl: raster.dataUrl,
    pixelWidth: raster.width,
    pixelHeight: raster.height,
    sourceKey: haneLinkedEditRecoverySourceKey(target),
    originWorkspaceId: target.paperDocumentId,
    ...(target.haneSourceItemId
      ? { originRunId: target.haneSourceItemId }
      : {}),
  });
}

function scheduleHaneFlatten(): void {
  pendingFlattenGeneration += 1;
  if (flattenTimer) clearTimeout(flattenTimer);
  flattenTimer = setTimeout(() => {
    flattenTimer = null;
    const requestedGeneration = pendingFlattenGeneration;
    const work = flattenTail.then(async () => {
      const state = useHaneLinkedEditStore.getState();
      const target = state.status === 'active' ? state.target : null;
      if (!target) return;
      await flattenHaneTargetIntoPaper(target);
      if (pendingFlattenGeneration !== requestedGeneration) scheduleHaneFlatten();
    });
    flattenTail = work.catch((error: unknown) => {
      const message = error instanceof Error
        ? error.message
        : 'The live Hane canvas could not be flattened into Paper.';
      useHaneLinkedEditStore.setState({ status: 'error', error: message });
    });
  }, FLATTEN_COALESCE_MS);
}

export async function startHaneLinkedEdit(input: {
  paperDocumentId: string;
  pageId: string;
  frameId: string;
  sourceItem: SourceBinLibraryItem;
}): Promise<HaneLinkedEditTarget> {
  if (!isHaneLinkProviderSession() || getRemoteHostPairingState() !== 'paired') {
    throw new Error('Connect and pair Hane before opening a Paper image on the phone.');
  }
  const generation = ++startGeneration;
  stopHaneStrokePreviewStream();
  useHaneLinkedEditStore.setState({
    status: 'sending',
    pendingFrameId: input.frameId,
    error: null,
  });
  ensureImageWatcher();
  ensurePaperWatcher();

  try {
    const dataUrl = await materializeSourceBinItemDataUrl(input.sourceItem);
    if (!dataUrl) throw new Error('The selected Paper image bytes are unavailable.');
    if (dataUrl.length > MAX_HANDOFF_DATA_URL_CHARACTERS) {
      throw new Error('The selected image exceeds Hane Link’s 128 MB handoff limit.');
    }
    const mimeType = handoffMimeType(dataUrl, input.sourceItem.mimeType || 'image/png');
    const documentId = haneLinkedEditDocumentId(
      input.pageId,
      input.frameId,
      input.sourceItem.id,
    );
    const sessionId = documentId;
    const uploadId = newUploadId();
    const basePath = `/linked-edit/asset-upload/${encodeURIComponent(sessionId)}`;
    const chunkCount = Math.ceil(dataUrl.length / UPLOAD_CHUNK_CHARACTERS);
    await writeHaneJson(`${basePath}/begin`, {
      uploadId,
      sessionId,
      documentId,
      desktopSourceItemId: input.sourceItem.id,
      pageId: input.pageId,
      frameId: input.frameId,
      name: input.sourceItem.label,
      mimeType,
      totalLength: dataUrl.length,
      chunkCount,
    });
    for (let index = 0; index < chunkCount; index += 1) {
      if (generation !== startGeneration) {
        throw new Error('A newer Hane edit target replaced this handoff.');
      }
      await writeHaneJson(`${basePath}/chunk/${index}`, {
        uploadId,
        chunk: dataUrl.slice(
          index * UPLOAD_CHUNK_CHARACTERS,
          (index + 1) * UPLOAD_CHUNK_CHARACTERS,
        ),
      });
    }
    const committed = await writeHaneJson(
      `${basePath}/commit`,
      { uploadId },
      COMMIT_TIMEOUT_MS,
    );
    if (generation !== startGeneration) {
      throw new Error('A newer Hane edit target replaced this handoff.');
    }
    const target: HaneLinkedEditTarget = {
      sessionId,
      documentId,
      paperDocumentId: input.paperDocumentId,
      pageId: input.pageId,
      frameId: input.frameId,
      sourceItemId: input.sourceItem.id,
      sourceLabel: input.sourceItem.label,
      ...(typeof committed.haneSourceItemId === 'string'
        ? { haneSourceItemId: committed.haneSourceItemId }
        : {}),
      startedAt: Date.now(),
    };
    useHaneLinkedEditStore.setState({
      status: 'active',
      target,
      pendingFrameId: null,
      error: null,
    });
    startHaneStrokePreviewStream({
      sessionId: target.sessionId,
      targetId: `${target.pageId}:${target.frameId}`,
      documentId: target.documentId,
      async onDurableSnapshotInstalled() {
        const current = useHaneLinkedEditStore.getState().target;
        if (!current || current.sessionId !== target.sessionId) return;
        await flattenHaneTargetIntoPaper(current);
      },
      onLeaseLost() {
        const current = useHaneLinkedEditStore.getState().target;
        if (current?.sessionId !== target.sessionId) return;
        useHaneLinkedEditStore.setState({
          status: 'error',
          error: 'This Hane canvas is now owned by another linked-edit session.',
        });
      },
    });
    const targetLoss = haneLinkedEditPaperTargetLoss(
      target,
      paperDocumentForLinkedTarget(target),
    );
    if (targetLoss) {
      await recoverHaneLinkedEditAfterPaperTargetLoss(targetLoss);
      throw new Error(
        'The Paper frame changed during handoff. The returned Hane image was preserved in the Source Library.',
      );
    }
    return target;
  } catch (error) {
    if (generation === startGeneration) {
      const message = error instanceof Error ? error.message : 'The image could not be opened in Hane.';
      useHaneLinkedEditStore.setState({
        status: 'error',
        pendingFrameId: null,
        error: message,
      });
    }
    throw error;
  }
}

async function performHaneLinkedEditFinalization(
  target: HaneLinkedEditTarget,
  disposition: 'return-to-paper' | 'recover-source-library',
): Promise<SourceBinLibraryItem | null> {
  startGeneration += 1;
  pendingFlattenGeneration += 1;
  if (flattenTimer) {
    clearTimeout(flattenTimer);
    flattenTimer = null;
  }
  if (disposition === 'recover-source-library') {
    useHaneLinkedEditStore.setState((state) => (
      state.target?.sessionId === target.sessionId
        ? { status: 'recovering', error: null }
        : {}
    ));
  }
  await flattenTail.catch(() => undefined);
  await synchronizeHaneStrokePreviewDurable().catch(() => false);
  stopHaneStrokePreviewStream();

  let recoveredItem: SourceBinLibraryItem | null = null;
  try {
    const livePaperTargetLoss = haneLinkedEditPaperTargetLoss(
      target,
      paperDocumentForLinkedTarget(target),
    );
    if (disposition === 'recover-source-library' || livePaperTargetLoss) {
      useHaneLinkedEditStore.setState((state) => (
        state.target?.sessionId === target.sessionId
          ? { status: 'recovering', error: null }
          : {}
      ));
      recoveredItem = await preserveHaneLinkedEditTargetAsRecoveredSourceItem(target);
    } else {
      await flattenHaneTargetIntoPaper(target);
    }
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : disposition === 'recover-source-library'
        ? 'The final Hane canvas could not be preserved in the Source Library.'
        : 'The final Hane canvas could not be flattened into Paper.';
    useHaneLinkedEditStore.setState((state) => (
      state.target?.sessionId === target.sessionId
        ? { status: 'error', error: message }
        : {}
    ));
    throw error;
  } finally {
    await remoteHostFetch(
      `/linked-edit/lease/${encodeURIComponent(target.sessionId)}/release`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        timeoutMs: REQUEST_TIMEOUT_MS,
      },
    ).catch(() => null);
  }

  pendingFlattenGeneration += 1;
  if (flattenTimer) {
    clearTimeout(flattenTimer);
    flattenTimer = null;
  }
  useHaneLinkedEditStore.setState((state) => (
    state.target?.sessionId === target.sessionId
      ? {
          status: 'idle',
          target: null,
          pendingFrameId: null,
          error: null,
        }
      : {}
  ));
  return recoveredItem;
}

function finalizeHaneLinkedEditTarget(
  target: HaneLinkedEditTarget,
  disposition: 'return-to-paper' | 'recover-source-library',
): Promise<SourceBinLibraryItem | null> {
  if (targetFinalization?.sessionId === target.sessionId) {
    return targetFinalization.promise;
  }
  const promise = performHaneLinkedEditFinalization(target, disposition);
  targetFinalization = { sessionId: target.sessionId, promise };
  void promise.finally(() => {
    if (targetFinalization?.promise === promise) {
      targetFinalization = null;
    }
  }).catch(() => undefined);
  return promise;
}

export async function recoverHaneLinkedEditAfterPaperTargetLoss(
  _reason: HaneLinkedEditPaperTargetLoss,
): Promise<SourceBinLibraryItem | null> {
  const target = useHaneLinkedEditStore.getState().target;
  if (!target) return null;
  return finalizeHaneLinkedEditTarget(target, 'recover-source-library');
}

export async function stopHaneLinkedEdit(): Promise<void> {
  const target = useHaneLinkedEditStore.getState().target;
  if (target) {
    await finalizeHaneLinkedEditTarget(target, 'return-to-paper');
    return;
  }
  startGeneration += 1;
  stopHaneStrokePreviewStream();
  useHaneLinkedEditStore.setState({
    status: 'idle',
    target: null,
    pendingFrameId: null,
    error: null,
  });
}
