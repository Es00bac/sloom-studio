/**
 * Baton handoff document snapshots (owner report, 2026-07-03): drawing on the phone, releasing
 * control, and taking over in a served desktop browser showed an EMPTY Image workspace — the
 * baton is a pure lock, and open Image documents never traveled with it.
 *
 * Fix rides entirely on proven machinery: when THIS device loses the baton (release, yield, or
 * force-taken), every open Image document is serialized to layered .slimg bytes and saved into
 * the shared Source Library under the "Baton handoff" envelope with a per-document sourceKey —
 * so repeats replace in place, and the library's existing live sync carries it to the other
 * device. The gaining device's Image workspace offers "Continue" cards for fresh handoff items
 * and opens them with full layers via deserializeSlimg.
 */
import { useEditLockStore } from '../store/editLockStore';
import { useSourceBinStore, type SourceBinLibraryItem } from '../store/sourceBinStore';
import { usePaperStore } from '../store/paperStore';
import { getLocalDevice } from './deviceIdentity';
import { isSimultaneousProjectSyncSession } from './remoteHostClient';

export const BATON_HANDOFF_ENVELOPE_ID = 'baton-handoff';
export const BATON_HANDOFF_ENVELOPE_LABEL = 'Baton handoff';
export const BATON_HANDOFF_SOURCE_KEY_PREFIX = 'baton-handoff:';
export const SLIMG_HANDOFF_MIME_TYPE = 'application/x-sloom-slimg';
export const SLPPR_HANDOFF_MIME_TYPE = 'application/x-sloom-slppr';
export const PAPER_BATON_HANDOFF_SOURCE_KEY_PREFIX = 'paper-baton-handoff:';

/** Handoffs older than this stop being offered as "Continue" cards (still in the library). */
const HANDOFF_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const MAX_PAPER_HANDOFF_BATCHES = 8;
const PAPER_HANDOFF_BATCH_ENVELOPE_PREFIX = 'paper-baton-handoff-batch:';

export function buildBatonHandoffSourceKey(documentId: string): string {
  return `${BATON_HANDOFF_SOURCE_KEY_PREFIX}${documentId}`;
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).includes('base64')) return null;
  try {
    const binary = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Library items that are fresh baton handoffs, newest first. */
export function listFreshBatonHandoffItems(
  items: SourceBinLibraryItem[],
  now = Date.now(),
): SourceBinLibraryItem[] {
  return items
    .filter((item) => item.sourceKey?.startsWith(BATON_HANDOFF_SOURCE_KEY_PREFIX)
      && now - item.createdAt < HANDOFF_FRESHNESS_MS)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Serialize every open Image document into the Source Library. Failures are logged, never
 * thrown — a broken snapshot must not block the baton transfer itself.
 */
async function captureImageHandoffSnapshots(): Promise<void> {
  try {
    const [{ useImageEditorStore }, { saveImageDocumentAsSlimg }] = await Promise.all([
      import('../store/imageEditorStore'),
      import('../components/ImageEditor/ImageSlimgCodec'),
    ]);
    const documents = useImageEditorStore.getState().documents.slice(0, 8);
    for (const doc of documents) {
      try {
        // A document with no pixel-bearing layers is a shell (e.g. a not-yet-synced remote doc)
        // — snapshotting it would overwrite a good handoff with a hollow one.
        if (!doc.layers.some((layer) => layer.bitmap || layer.bitmapData)) continue;
        const bytes = await saveImageDocumentAsSlimg(doc);
        // Re-handoffs must not stack the suffix onto an already-suffixed title.
        const baseTitle = (doc.title || 'Image').replace(/ — continue on another device/g, '');
        await useSourceBinStore.getState().addAssetItem({
          label: `${baseTitle} — continue on another device`,
          kind: 'image',
          mimeType: SLIMG_HANDOFF_MIME_TYPE,
          dataUrl: bytesToDataUrl(bytes, SLIMG_HANDOFF_MIME_TYPE),
          sourceKey: buildBatonHandoffSourceKey(doc.id),
          envelopeId: BATON_HANDOFF_ENVELOPE_ID,
          envelopeLabel: BATON_HANDOFF_ENVELOPE_LABEL,
        });
      } catch (error) {
        console.warn(`[baton-handoff] snapshot failed for "${doc.title}":`, error);
      }
    }
  } catch (error) {
    console.warn('[baton-handoff] snapshot pass failed:', error);
  }
}

async function capturePaperHandoffSnapshots(): Promise<void> {
  // This entire read + local recovery write runs before the first await. Losing the baton therefore
  // always leaves one unsplit local batch containing every dirty tab, even if module loading,
  // serialization, persistence, or cross-device transport fails afterward.
  const state = usePaperStore.getState();
  const dirtyDocuments = (state.exportSnapshot().documents ?? []).flatMap((document, originalIndex) => (
    state.isDocumentDirty(document.id) ? [{ document, originalIndex }] : []
  ));
  if (!dirtyDocuments.length) return;
  state.captureDocumentRecovery(dirtyDocuments.map(({ document }) => document.id), 'baton-handoff');

  try {
    const [{ serializeSlppr }, { paperAssetRepository }] = await Promise.all([
      import('../features/paper/SlpprFormat'),
      import('../features/paper/assets/PaperAssetRuntime'),
    ]);
    const serialized = await Promise.all(dirtyDocuments.map(async ({ document, originalIndex }) => ({
      workspaceDocument: document,
      originalIndex,
      bytes: await serializeSlppr(document.document, paperAssetRepository),
    })));
    const batchId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const envelopeId = `${PAPER_HANDOFF_BATCH_ENVELOPE_PREFIX}${batchId}`;
    const batchSourceKeyPrefix = `${PAPER_BATON_HANDOFF_SOURCE_KEY_PREFIX}${batchId}:${serialized.length}:`;

    try {
      for (const { workspaceDocument, originalIndex, bytes } of serialized) {
        await useSourceBinStore.getState().addAssetItem({
          label: `${workspaceDocument.document.title} — continue Paper on another device`,
          kind: 'document',
          mimeType: SLPPR_HANDOFF_MIME_TYPE,
          dataUrl: bytesToDataUrl(bytes, SLPPR_HANDOFF_MIME_TYPE),
          sourceKey: `${batchSourceKeyPrefix}${workspaceDocument.id}`,
          envelopeId,
          envelopeLabel: BATON_HANDOFF_ENVELOPE_LABEL,
          envelopeIndex: originalIndex,
        });
      }
    } catch (error) {
      // A partial envelope must never be offered as a complete transfer. Unique per-batch keys let
      // cleanup remove this failed attempt without overwriting or damaging an older good batch.
      for (const item of useSourceBinStore.getState().getAllItems()) {
        if (item.envelopeId === envelopeId || item.sourceKey?.startsWith(batchSourceKeyPrefix)) {
          useSourceBinStore.getState().removeItem(item.id);
        }
      }
      throw error;
    }

    for (const item of getExpiredOrExcessPaperHandoffItems(
      useSourceBinStore.getState().getAllItems(),
      Date.now(),
    )) {
      if (item.envelopeId !== envelopeId) {
        useSourceBinStore.getState().removeItem(item.id);
      }
    }
  } catch (error) {
    console.warn('[baton-handoff] Paper snapshot pass failed:', error);
  }
}

function paperHandoffBatchId(item: SourceBinLibraryItem): string {
  if (item.envelopeId?.startsWith(PAPER_HANDOFF_BATCH_ENVELOPE_PREFIX)) return item.envelopeId;
  // Legacy handoffs shared one envelope and had no batch key. Treat the complete legacy set as one
  // batch so cleanup never applies an item limit that splits it further.
  return item.envelopeId === BATON_HANDOFF_ENVELOPE_ID
    ? 'paper-baton-handoff-legacy-batch'
    : item.sourceKey ?? item.id;
}

function expectedPaperHandoffBatchSize(item: SourceBinLibraryItem): number | undefined {
  if (!item.envelopeId?.startsWith(PAPER_HANDOFF_BATCH_ENVELOPE_PREFIX) || !item.sourceKey) return undefined;
  const encoded = item.sourceKey.slice(PAPER_BATON_HANDOFF_SOURCE_KEY_PREFIX.length).split(':');
  const expected = Number(encoded[1]);
  return Number.isSafeInteger(expected) && expected > 0 ? expected : undefined;
}

function isCompletePaperHandoffBatch(batch: SourceBinLibraryItem[]): boolean {
  const expected = expectedPaperHandoffBatchSize(batch[0]);
  if (expected === undefined) return true;
  return batch.length === expected
    && batch.every((item) => expectedPaperHandoffBatchSize(item) === expected)
    && new Set(batch.map((item) => item.envelopeIndex)).size === expected;
}

function getExpiredOrExcessPaperHandoffItems(
  items: SourceBinLibraryItem[],
  now: number,
): SourceBinLibraryItem[] {
  const batches = new Map<string, SourceBinLibraryItem[]>();
  for (const item of items) {
    if (!item.sourceKey?.startsWith(PAPER_BATON_HANDOFF_SOURCE_KEY_PREFIX)) continue;
    const batchId = paperHandoffBatchId(item);
    batches.set(batchId, [...(batches.get(batchId) ?? []), item]);
  }
  const orderedBatches = [...batches.values()]
    .sort((left, right) => Math.max(...right.map((item) => item.createdAt)) - Math.max(...left.map((item) => item.createdAt)));
  let completeBatchIndex = 0;
  return orderedBatches.flatMap((batch) => {
    const newestCreatedAt = Math.max(...batch.map((item) => item.createdAt));
    const complete = isCompletePaperHandoffBatch(batch);
    const index = complete ? completeBatchIndex++ : -1;
    return !complete
      || index >= MAX_PAPER_HANDOFF_BATCHES
      || now - newestCreatedAt >= HANDOFF_FRESHNESS_MS
      ? batch
      : [];
  });
}

export async function captureBatonHandoffSnapshots(): Promise<void> {
  await Promise.all([
    captureImageHandoffSnapshots(),
    capturePaperHandoffSnapshots(),
  ]);
}

export function listFreshPaperBatonHandoffItems(
  items: SourceBinLibraryItem[],
  now = Date.now(),
): SourceBinLibraryItem[] {
  const fresh = items
    .filter((item) => item.sourceKey?.startsWith(PAPER_BATON_HANDOFF_SOURCE_KEY_PREFIX)
      && item.mimeType === SLPPR_HANDOFF_MIME_TYPE
      && now - item.createdAt < HANDOFF_FRESHNESS_MS);
  const batchCreatedAt = new Map<string, number>();
  const batches = new Map<string, SourceBinLibraryItem[]>();
  for (const item of fresh) {
    const batchId = paperHandoffBatchId(item);
    batchCreatedAt.set(batchId, Math.max(batchCreatedAt.get(batchId) ?? 0, item.createdAt));
    batches.set(batchId, [...(batches.get(batchId) ?? []), item]);
  }
  return fresh.filter((item) => isCompletePaperHandoffBatch(batches.get(paperHandoffBatchId(item)) ?? []))
    .sort((left, right) => {
      const batchDelta = (batchCreatedAt.get(paperHandoffBatchId(right)) ?? 0)
        - (batchCreatedAt.get(paperHandoffBatchId(left)) ?? 0);
      if (batchDelta) return batchDelta;
      return (left.envelopeIndex ?? 0) - (right.envelopeIndex ?? 0);
    });
}

export async function openPaperBatonHandoffItem(item: SourceBinLibraryItem): Promise<boolean> {
  try {
    if (!item.assetUrl) return false;
    let bytes = item.assetUrl.startsWith('data:') ? dataUrlToBytes(item.assetUrl) : null;
    if (!bytes) {
      const response = await fetch(item.assetUrl);
      if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (!bytes?.length) return false;
    const { openStandaloneSlpprDocument } = await import('./paperStandaloneDocumentOpen');
    await openStandaloneSlpprDocument(bytes);
    return true;
  } catch (error) {
    console.warn('[baton-handoff] Paper open failed:', error);
    return false;
  }
}

/** Open a handoff item (layered) into the Image editor. Returns false when the bytes are gone. */
export async function openBatonHandoffItem(item: SourceBinLibraryItem): Promise<boolean> {
  try {
    if (!item.assetUrl) return false;
    // The item's bytes may live behind ANY url shape: a data: URL (fresh capture / served
    // hydrate), or a native/capacitor file URL on the device that persisted it. Resolve all.
    let bytes = item.assetUrl.startsWith('data:') ? dataUrlToBytes(item.assetUrl) : null;
    if (!bytes) {
      try {
        const response = await fetch(item.assetUrl);
        if (response.ok) bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        bytes = null;
      }
    }
    if (!bytes || bytes.length === 0) return false;
    const [{ useImageEditorStore }, { openSlimgDocument }] = await Promise.all([
      import('../store/imageEditorStore'),
      import('../components/ImageEditor/ImageSlimgCodec'),
    ]);
    const doc = await openSlimgDocument(bytes);
    // The handoff LABEL carries the suffix; the document title must not (double-suffix source).
    doc.title = doc.title.replace(/ — continue on another device/g, '');
    useImageEditorStore.getState().openDocument(doc);
    return true;
  } catch (error) {
    console.warn('[baton-handoff] open failed:', error);
    return false;
  }
}

let initialized = false;

/**
 * Watch baton transitions: the instant THIS device stops being the holder, capture snapshots.
 * (The capture is fire-and-forget and races nothing: the library add + its broadcast work the
 * same whether we still hold the baton or not.)
 */
export function initializeBatonHandoffSnapshots(): void {
  if (initialized) return;
  initialized = true;

  let wasHolder = useEditLockStore.getState().lock?.holder?.id === getLocalDevice().id;
  useEditLockStore.subscribe((state) => {
    const isHolder = state.lock?.holder?.id === getLocalDevice().id;
    // A current phone link streams the live Image/Paper state continuously. Legacy snapshots are
    // retained only for an older single-writer peer; generating them on a presence-only baton change
    // would duplicate a document that is already open on both screens.
    if (wasHolder && !isHolder && !isSimultaneousProjectSyncSession()) {
      void captureBatonHandoffSnapshots();
    }
    wasHolder = isHolder;
  });
}
