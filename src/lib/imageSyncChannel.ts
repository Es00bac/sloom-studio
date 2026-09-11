import { useImageEditorStore } from '../store/imageEditorStore';
import { isAndroidLanServerAvailable, notifyLanProjectChange } from './androidLanServer';
import { isHaneLinkProviderSession, isServedLanSession } from './remoteHostClient';
import { ensureProjectSyncChannelStarted } from './projectSyncClient';
import { registerProjectSyncChannel, type ProjectSyncChannel } from './projectSyncService';
import {
  commitVerifiedProjectSyncAssets,
  getProjectSyncAsset,
  prepareVerifiedProjectSyncAssets,
  putProjectSyncAsset,
} from './projectSyncAssets';
import {
  applyImageDocumentNativeChange,
  diffImageDocumentNativeChanges,
  toImageDocumentWire,
  type ImageDocumentNativeChange,
  type ImageDocumentWire,
} from './imageDocumentNativeSync';
import {
  defaultImageLayerPixelCodec,
  type ImageLayerPixelCodec,
} from '../components/ImageEditor/ImageLayerProjectPixels';
import type { ImageDocument } from '../types/imageEditor';
import { getLocalDeviceId } from './deviceIdentity';
import { releaseTiltmarkLayerSubstrate } from '../components/ImageEditor/tiltmark/TiltmarkRuntime';
import {
  decodeImageTiltmarkSimulation,
  MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH,
} from '../components/ImageEditor/tiltmark/ImageTiltmarkLayer';

/**
 * Image workspace's seat on the unified cross-device op-sync (task #53; design `docs/notes/768`). The
 * **policy** layer wiring the pure op model ([[imageDocumentNativeSync]]) and the live store
 * (`imageEditorStore`) to the shared transport ([[projectSyncService]] + `androidLanServer` +
 * `projectSyncClient`). The Image analog of [[flowSyncChannel]] / [[paperSyncChannel]] — but with the one
 * structural difference that makes Image the hard channel: **a layer's pixels are a live multi-MB
 * `OffscreenCanvas`, non-serializable, so they cannot ride inside the JSON op.**
 *
 * The split (note 768):
 *  - The JSON op stream carries only a pixel **pointer** — `image-layer-pixels-updated` is
 *    `{ layerId, bitmapVersion, hasBitmap, hasMask }`, no bytes.
 *  - The bytes travel **out-of-band** under a layer/version/peer-revision key (with a `:mask` sibling)
 *    over [[projectSyncAssets]] (`PUT`/`GET /project/image/asset/:assetId`). The revision prevents two
 *    simultaneous peers that reach the same numeric version from overwriting or deduplicating each
 *    other's pixels.
 *
 *  - **Emit (outbound):** one passive `useImageEditorStore.subscribe` that diffs the active document's
 *    canvas-free wire after store changes; for each pixel-bearing op it first encodes + PUTs the layer's
 *    live bitmap/mask, **then** publishes the pointer op (bytes-before-pointer, so a fast receiver always
 *    finds them). Coalesced like Paper — a brush stroke commits a burst of per-move store writes, collapsed
 *    into the final frame plus a max-wait for liveness.
 *  - **Apply (inbound):** `applyRemote` first runs the structural/metadata op through
 *    `applyRemoteImageDocumentChange` (which preserves each surviving layer's live `OffscreenCanvas` by id
 *    and creates null shells for new/seeded layers), then fetches + decodes the out-of-band bytes for each
 *    pixel target and flips them in atomically via `applyRemoteLayerPixels`.
 *  - **Seed:** `snapshot` publishes every current layer's bytes to the out-of-band store *before* returning
 *    the wire, so a freshly-connecting client can fetch them (the host may have loaded the doc from disk and
 *    never drawn, so nothing would be cached otherwise).
 *
 * Echo-loop + authority safety (identical to Flow/Paper):
 *  - `applyingRemote` suppresses the emit our own `applyRemote` provokes.
 *  - `canEmit` starts true only on the phone authority; a served client stays mute until it has applied its
 *    first remote op (the seed), so it can never push its stale local document over the phone's on connect.
 */

export const IMAGE_SYNC_CHANNEL = 'image';

/** Trailing-debounce window — collapses the per-pointer-move writes of a brush stroke into one emit. */
const EMIT_COALESCE_MS = 90;
/** …but never hold a sustained stroke longer than this before streaming an interim op (liveness). */
const EMIT_MAX_WAIT_MS = 220;
const EMIT_RETRY_MS = 1_500;
const MAX_AUTOMATIC_PUBLISH_RETRIES = 8;

/** True while we are applying a remote op — the emit subscription must not re-broadcast it. */
let applyingRemote = false;
/** A served client only earns the right to emit after it has synced from the authority once. */
let canEmit = false;
/** Authority baseline per document. Keeping one baseline per id prevents active tabs on two devices
 * from bouncing full snapshots back and forth when each person edits a different Image document. */
const authorityDocuments = new Map<string, ImageDocumentWire>();
let initialized = false;
let remoteApplyGeneration = 0;
/** One queue covers local publication, inbound applies, and seed snapshots so asset inventories can
 * never prune bytes that another Image transaction has staged but not yet referenced. */
let operationTail: Promise<void> = Promise.resolve();
/** Pending coalesced-emit timer + when the current pending burst began (for the max-wait). */
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let firstPendingAt = 0;
let consecutivePublishFailures = 0;
let retryBlockedFingerprint = '';
/** Per-document/layer revision already decoded inbound, so a re-seed never re-fetches held pixels. */
const appliedVersionByLayer = new Map<string, string>();

/** Injectable so the round-trip can be unit-tested without a real canvas backend. */
let codec: ImageLayerPixelCodec = defaultImageLayerPixelCodec;
let putAsset = putProjectSyncAsset;
let getAsset = getProjectSyncAsset;

const pixelAssetKey = (target: Pick<PixelTarget, 'layerId' | 'version' | 'revision'>): string =>
  target.revision
    ? `${target.layerId}@${target.version}:${target.revision}`
    : `${target.layerId}@${target.version}`;
const bitmapAssetId = (target: PixelTarget): string => pixelAssetKey(target);
const maskAssetId = (target: PixelTarget): string => `${pixelAssetKey(target)}:mask`;
const tiltmarkBaseAssetId = (target: PixelTarget): string => `${pixelAssetKey(target)}:tiltmark-base`;
const tiltmarkStateAssetId = (target: PixelTarget): string => `${pixelAssetKey(target)}:tiltmark-state`;

function newPixelAssetRevision(): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${getLocalDeviceId().slice(0, 48)}-${random}`;
}

function activeDocument(): ImageDocument | null {
  return useImageEditorStore.getState().getActiveDocument() ?? null;
}

function currentWire(): ImageDocumentWire | null {
  const doc = activeDocument();
  return doc ? toImageDocumentWire(doc) : null;
}

function wireFingerprint(document = currentWire()): string {
  return document ? JSON.stringify(document) : '';
}

function liveDocumentById(documentId: string): ImageDocument | null {
  return useImageEditorStore.getState().documents.find((document) => document.id === documentId) ?? null;
}

function targetDocumentId(change: ImageDocumentNativeChange): string {
  if (change.type === 'image-document-snapshot') return change.document.id;
  return change.documentId
    ?? useImageEditorStore.getState().syncedImageDocumentId
    ?? currentWire()?.id
    ?? '';
}

/** New peers always name the document on granular operations. Old peers remain readable through the
 * optional field and the store's legacy seeded-document fallback. */
function withDocumentTarget(
  change: ImageDocumentNativeChange,
  documentId: string,
): ImageDocumentNativeChange {
  return change.type === 'image-document-snapshot' ? change : { ...change, documentId };
}

/** Cheap predicate: does this client participate in project sync at all? Keeps non-sync sessions free. */
function isImageSyncActive(): boolean {
  return isAndroidLanServerAvailable() || isServedLanSession();
}

/** The layers whose out-of-band pixels an op implies (added layer, pixel update, or a full snapshot). */
type PixelTarget = {
  layerId: string;
  version: number;
  hasBitmap: boolean;
  hasMask: boolean;
  hasTiltmarkBase?: boolean;
  hasTiltmarkSimulation?: boolean;
  revision?: string;
};

function pixelTargets(change: ImageDocumentNativeChange): PixelTarget[] {
  switch (change.type) {
    case 'image-layer-pixels-updated':
      return [{
        layerId: change.layerId,
        version: change.bitmapVersion,
        hasBitmap: change.hasBitmap,
        hasMask: change.hasMask,
        hasTiltmarkBase: change.hasTiltmarkBase,
        hasTiltmarkSimulation: change.hasTiltmarkSimulation,
        revision: change.pixelAssetRevision,
      }];
    case 'image-layer-added':
      return change.layer.hasBitmap || change.layer.hasMask
        || change.layer.hasTiltmarkBase || change.layer.hasTiltmarkSimulation
        ? [{
            layerId: change.layer.id,
            version: change.layer.bitmapVersion,
            hasBitmap: change.layer.hasBitmap,
            hasMask: change.layer.hasMask,
            hasTiltmarkBase: change.layer.hasTiltmarkBase,
            hasTiltmarkSimulation: change.layer.hasTiltmarkSimulation,
            revision: change.pixelAssetRevision,
          }]
        : [];
    case 'image-document-snapshot':
      return change.document.layers
        .filter((layer) => layer.hasBitmap || layer.hasMask
          || layer.hasTiltmarkBase || layer.hasTiltmarkSimulation)
        .map((layer) => ({
          layerId: layer.id,
          version: layer.bitmapVersion,
          hasBitmap: layer.hasBitmap,
          hasMask: layer.hasMask,
          hasTiltmarkBase: layer.hasTiltmarkBase,
          hasTiltmarkSimulation: layer.hasTiltmarkSimulation,
          revision: change.pixelAssetRevisions?.[layer.id],
        }));
    default:
      return [];
  }
}

function pixelAssetIds(change: ImageDocumentNativeChange): string[] {
  return pixelTargets(change).flatMap((target) => [
    ...(target.hasBitmap ? [bitmapAssetId(target)] : []),
    ...(target.hasMask ? [maskAssetId(target)] : []),
    ...(target.hasTiltmarkBase ? [tiltmarkBaseAssetId(target)] : []),
    ...(target.hasTiltmarkSimulation ? [tiltmarkStateAssetId(target)] : []),
  ]);
}

function withFreshPixelAssetRevisions(change: ImageDocumentNativeChange): ImageDocumentNativeChange {
  switch (change.type) {
    case 'image-layer-pixels-updated':
      return { ...change, pixelAssetRevision: newPixelAssetRevision() };
    case 'image-layer-added':
      return change.layer.hasBitmap || change.layer.hasMask
        || change.layer.hasTiltmarkBase || change.layer.hasTiltmarkSimulation
        ? { ...change, pixelAssetRevision: newPixelAssetRevision() }
        : change;
    case 'image-document-snapshot':
      return {
        ...change,
        pixelAssetRevisions: Object.fromEntries(
          change.document.layers
            .filter((layer) => layer.hasBitmap || layer.hasMask
              || layer.hasTiltmarkBase || layer.hasTiltmarkSimulation)
            .map((layer) => [layer.id, newPixelAssetRevision()]),
        ),
      };
    default:
      return change;
  }
}

// ---------------------------------------------------------------------------------------------------
// Emit (outbound): diff → encode + PUT bytes → publish pointer op
// ---------------------------------------------------------------------------------------------------

/** Encode + PUT a layer's live bitmap/mask under their content-addressed ids (no-op if buffers absent). */
async function publishLayerAssets(doc: ImageDocument, target: PixelTarget): Promise<void> {
  const layer = doc.layers.find((l) => l.id === target.layerId);
  if (!layer) return;
  if (target.hasBitmap) {
    const encoded = layer.bitmap ? await codec.encode(layer.bitmap) : layer.bitmapData;
    if (!encoded || !await putAsset(IMAGE_SYNC_CHANNEL, bitmapAssetId(target), encoded)) {
      throw new Error(`Image bitmap ${bitmapAssetId(target)} was not acknowledged by the authority.`);
    }
    console.info(`[image-sync] published ${bitmapAssetId(target)} (${encoded.length}b)`);
  }
  if (target.hasMask) {
    const encoded = layer.mask ? await codec.encode(layer.mask) : layer.maskData;
    if (!encoded || !await putAsset(IMAGE_SYNC_CHANNEL, maskAssetId(target), encoded)) {
      throw new Error(`Image mask ${maskAssetId(target)} was not acknowledged by the authority.`);
    }
  }
  if (target.hasTiltmarkBase) {
    const encoded = layer.tiltmarkBaseBitmap
      ? await codec.encode(layer.tiltmarkBaseBitmap)
      : layer.tiltmarkBaseBitmapData;
    if (!encoded || !await putAsset(IMAGE_SYNC_CHANNEL, tiltmarkBaseAssetId(target), encoded)) {
      throw new Error(`Tiltmark base ${tiltmarkBaseAssetId(target)} was not acknowledged by the authority.`);
    }
  }
  if (target.hasTiltmarkSimulation) {
    const encoded = layer.tiltmarkSimulationData;
    if (!encoded || !await putAsset(IMAGE_SYNC_CHANNEL, tiltmarkStateAssetId(target), encoded)) {
      throw new Error(`Tiltmark state ${tiltmarkStateAssetId(target)} was not acknowledged by the authority.`);
    }
  }
}

function clearPendingEmit(): void {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  firstPendingAt = 0;
}

/**
 * Diff the live document against the baseline and push the minimal ops, encoding+PUTting each pixel op's
 * bytes BEFORE publishing its pointer (so a receiver fetching on the op always finds them). Async, but the
 * baseline + `lastDocument` advance synchronously up front so a concurrent store change can't interleave a
 * stale diff. Resets the coalescer.
 */
async function flushEmitWork(): Promise<void> {
  const liveDoc = activeDocument();
  if (!canEmit || !isImageSyncActive() || !liveDoc) {
    if (liveDoc) authorityDocuments.set(liveDoc.id, toImageDocumentWire(liveDoc));
    return;
  }
  const next = toImageDocumentWire(liveDoc);
  const nextFingerprint = wireFingerprint(next);
  if (retryBlockedFingerprint === nextFingerprint) return;
  const baseline = authorityDocuments.get(next.id) ?? null;
  // A document switch (different id) is not a delta — but connected clients still need to hear
  // about it (owner flow: pair FIRST, open/draw SECOND — without this, nothing ever re-seeds and
  // the client stares at a stale shell forever, note 819). Publish the new document as a full
  // snapshot op, pixels-before-pointer like every other emit.
  if (baseline === null) {
    const snapshotOp = withFreshPixelAssetRevisions({
      type: 'image-document-snapshot',
      document: next,
    });
    const assetIds = pixelAssetIds(snapshotOp);
    if (assetIds.length > 0 && !await prepareVerifiedProjectSyncAssets(IMAGE_SYNC_CHANNEL, assetIds)) {
      throw new Error('Image snapshot asset inventory was not acknowledged by the authority.');
    }
    const generationBeforePublish = remoteApplyGeneration;
    for (const target of pixelTargets(snapshotOp)) await publishLayerAssets(liveDoc, target);
    if (isAndroidLanServerAvailable() && remoteApplyGeneration !== generationBeforePublish) {
      // A desktop mutation landed while the phone encoded this local frame. Re-apply the exact
      // bytes/pointer we are about to append so the authority's live store matches log order.
      await imageChannel.applyRemote(snapshotOp);
    }
    if (!await notifyLanProjectChange(IMAGE_SYNC_CHANNEL, snapshotOp)) {
      throw new Error('Image snapshot mutation was not acknowledged by the authority.');
    }
    if (!await commitVerifiedProjectSyncAssets(IMAGE_SYNC_CHANNEL, assetIds)) {
      throw new Error('Image snapshot asset inventory could not be committed.');
    }
    authorityDocuments.set(next.id, next);
    consecutivePublishFailures = 0;
    retryBlockedFingerprint = '';
    if (wireFingerprint() !== nextFingerprint) scheduleEmit();
    return;
  }
  const ops = diffImageDocumentNativeChanges(baseline, next);
  let acknowledgedBaseline = baseline;
  for (const rawOp of ops) {
    const op = withFreshPixelAssetRevisions(withDocumentTarget(rawOp, next.id));
    const assetIds = pixelAssetIds(op);
    if (assetIds.length > 0 && !await prepareVerifiedProjectSyncAssets(IMAGE_SYNC_CHANNEL, assetIds)) {
      throw new Error('Image asset inventory was not acknowledged by the authority.');
    }
    const generationBeforePublish = remoteApplyGeneration;
    for (const target of pixelTargets(op)) await publishLayerAssets(liveDoc, target);
    if (isAndroidLanServerAvailable() && remoteApplyGeneration !== generationBeforePublish) {
      await imageChannel.applyRemote(op);
    }
    if (!await notifyLanProjectChange(IMAGE_SYNC_CHANNEL, op)) {
      throw new Error('Image mutation was not acknowledged by the authority.');
    }
    if (assetIds.length > 0
      && !await commitVerifiedProjectSyncAssets(IMAGE_SYNC_CHANNEL, assetIds)) {
      throw new Error('Image asset inventory could not be committed.');
    }
    acknowledgedBaseline = applyImageDocumentNativeChange(acknowledgedBaseline, op);
    // Keep each acknowledged prefix. If a later operation fails, retry diffs only the unsent suffix;
    // otherwise a valid idempotent prefix can be mistaken for an authority rejection.
    authorityDocuments.set(next.id, acknowledgedBaseline);
  }
  authorityDocuments.set(next.id, next);
  consecutivePublishFailures = 0;
  retryBlockedFingerprint = '';
  if (wireFingerprint() !== nextFingerprint) scheduleEmit();
}

function flushEmit(): Promise<void> {
  clearPendingEmit();
  const work = operationTail.then(flushEmitWork);
  operationTail = work.catch((error: unknown) => {
    console.warn('[image-sync] Pixel publication deferred.', error);
    const fingerprint = wireFingerprint();
    consecutivePublishFailures += 1;
    if (consecutivePublishFailures <= MAX_AUTOMATIC_PUBLISH_RETRIES) {
      firstPendingAt = Date.now();
      emitTimer = setTimeout(() => void flushEmit(), EMIT_RETRY_MS);
    } else {
      retryBlockedFingerprint = fingerprint;
      console.warn('[image-sync] stopped automatic retries after repeated publish failures; a new Image edit will retry.');
    }
  });
  return operationTail;
}

/** Schedule a coalesced emit: debounce by EMIT_COALESCE_MS, but never wait past EMIT_MAX_WAIT_MS. */
function scheduleEmit(): void {
  const now = Date.now();
  if (!firstPendingAt) firstPendingAt = now;
  if (emitTimer) clearTimeout(emitTimer);
  const delay = Math.max(0, Math.min(EMIT_COALESCE_MS, EMIT_MAX_WAIT_MS - (now - firstPendingAt)));
  emitTimer = setTimeout(() => void flushEmit(), delay);
}

function handleStoreChange(): void {
  if (applyingRemote) {
    // applyRemote owns the authority baseline and any pending-local rebase. Updating lastDocument here
    // would incorrectly bless an unpublished phone/desktop edit and make it disappear from the next diff.
    // A complete Sloom phone workspace is multi-writer. Hane's provider image is different: Hane
    // owns the linked canvas pixels, while the desktop consumes and flattens them into Paper.
    canEmit = !isHaneLinkProviderSession();
    return;
  }
  if (!canEmit || !isImageSyncActive()) return;
  const fingerprint = wireFingerprint();
  if (retryBlockedFingerprint === fingerprint) return;
  if (retryBlockedFingerprint) {
    retryBlockedFingerprint = '';
    consecutivePublishFailures = 0;
  }
  scheduleEmit();
}

// ---------------------------------------------------------------------------------------------------
// Apply (inbound): structural op → fetch + decode out-of-band bytes → flip pixels in
// ---------------------------------------------------------------------------------------------------

interface ResolvedInboundPixels {
  target: PixelTarget;
  appliedKey: string;
  bitmap: ImageDocument['layers'][number]['bitmap'];
  mask: ImageDocument['layers'][number]['mask'];
  tiltmarkBaseBitmap: ImageDocument['layers'][number]['tiltmarkBaseBitmap'];
  tiltmarkSimulationData: ImageDocument['layers'][number]['tiltmarkSimulationData'];
}

/** Fetch + decode without touching the store, so the user remains free to edit during slow Wi-Fi. */
async function resolveInboundPixels(
  target: PixelTarget,
  documentId: string,
): Promise<ResolvedInboundPixels | null> {
  const layerKey = `${documentId}\u0000${target.layerId}`;
  const appliedKey = `${target.version}:${target.revision ?? 'legacy'}`;
  if (appliedVersionByLayer.get(layerKey) === appliedKey) return null;
  let bitmap = null;
  let mask = null;
  let tiltmarkBaseBitmap: OffscreenCanvas | null | undefined =
    target.hasTiltmarkBase === undefined ? undefined : null;
  let tiltmarkSimulationData: string | null | undefined =
    target.hasTiltmarkSimulation === undefined ? undefined : null;
  if (target.hasBitmap) {
    const url = await getAsset(IMAGE_SYNC_CHANNEL, bitmapAssetId(target));
    if (url) { try { bitmap = await codec.decode(url); } catch { bitmap = null; } }
    // The op promised pixels we couldn't fetch/decode — do NOT flip a null over whatever the
    // layer currently shows; leave it for the retry the next op/seed provides.
    if (!bitmap) {
      console.warn(`[image-sync] inbound ${bitmapAssetId(target)}: `
        + `${url ? 'decode failed' : 'asset missing'} — keeping current pixels`);
      throw new Error(`Image sync deferred because ${bitmapAssetId(target)} could not be fetched and decoded.`);
    }
    console.info(`[image-sync] decoded inbound ${bitmapAssetId(target)} (${url?.length ?? 0}b url)`);
  }
  if (target.hasMask) {
    const url = await getAsset(IMAGE_SYNC_CHANNEL, maskAssetId(target));
    if (url) { try { mask = await codec.decode(url); } catch { mask = null; } }
    if (!mask) {
      throw new Error(`Image sync deferred because ${maskAssetId(target)} could not be fetched and decoded.`);
    }
  }
  if (target.hasTiltmarkBase) {
    const url = await getAsset(IMAGE_SYNC_CHANNEL, tiltmarkBaseAssetId(target));
    if (url) {
      try { tiltmarkBaseBitmap = await codec.decode(url); } catch { tiltmarkBaseBitmap = null; }
    }
    if (!tiltmarkBaseBitmap) {
      throw new Error(`Image sync deferred because ${tiltmarkBaseAssetId(target)} could not be fetched and decoded.`);
    }
  }
  if (target.hasTiltmarkSimulation) {
    tiltmarkSimulationData = await getAsset(IMAGE_SYNC_CHANNEL, tiltmarkStateAssetId(target));
    if (!tiltmarkSimulationData) {
      throw new Error(`Image sync deferred because ${tiltmarkStateAssetId(target)} could not be fetched.`);
    }
    const liveLayer = useImageEditorStore.getState().documents
      .find((document) => document.id === documentId)
      ?.layers.find((layer) => layer.id === target.layerId);
    const stateWidth = bitmap?.width
      ?? tiltmarkBaseBitmap?.width
      ?? liveLayer?.bitmap?.width
      ?? liveLayer?.tiltmarkBaseBitmap?.width;
    const stateHeight = bitmap?.height
      ?? tiltmarkBaseBitmap?.height
      ?? liveLayer?.bitmap?.height
      ?? liveLayer?.tiltmarkBaseBitmap?.height;
    if (
      new TextEncoder().encode(tiltmarkSimulationData).byteLength
        > MAX_IMAGE_TILTMARK_STATE_DATA_LENGTH
      || !stateWidth
      || !stateHeight
      || !decodeImageTiltmarkSimulation(tiltmarkSimulationData, stateWidth, stateHeight)
    ) {
      throw new Error(`Image sync deferred because ${tiltmarkStateAssetId(target)} is not a valid bounded Tiltmark checkpoint.`);
    }
  }
  return {
    target,
    appliedKey: `${layerKey}\u0000${appliedKey}`,
    bitmap,
    mask,
    tiltmarkBaseBitmap,
    tiltmarkSimulationData,
  };
}

async function applyRemoteImageChange(change: ImageDocumentNativeChange): Promise<boolean> {
    remoteApplyGeneration += 1;
    const documentId = targetDocumentId(change);
    const resolvedPixels = (await Promise.all(
      pixelTargets(change).map((target) => resolveInboundPixels(target, documentId)),
    )).filter((pixels): pixels is ResolvedInboundPixels => pixels !== null);

    // Capture local state only after slow asset fetch/decode completes. Edits made while Wi-Fi was in
    // flight are therefore part of the pending-local rebase rather than being silently blessed or
    // overwritten when the inbound pixels land.
    const baselineBefore = authorityDocuments.get(documentId) ?? null;
    const liveBefore = liveDocumentById(documentId);
    const wireBefore = liveBefore ? toImageDocumentWire(liveBefore) : null;
    const canRebaseLocal = Boolean(
      baselineBefore && wireBefore && baselineBefore.id === wireBefore.id
      && (change.type !== 'image-document-snapshot' || change.document.id === wireBefore.id),
    );
    const pendingLocalOps = canRebaseLocal
      ? diffImageDocumentNativeChanges(baselineBefore!, wireBefore!)
      : [];
    const pendingLocalPixels = new Map<string, {
      bitmap: ImageDocument['layers'][number]['bitmap'];
      mask: ImageDocument['layers'][number]['mask'];
      tiltmarkBaseBitmap: ImageDocument['layers'][number]['tiltmarkBaseBitmap'];
      tiltmarkSimulationData: ImageDocument['layers'][number]['tiltmarkSimulationData'];
      bitmapVersion: number;
    }>();
    if (liveBefore) {
      const pixelLayerIds = new Set(pendingLocalOps.flatMap((op) => {
        if (op.type === 'image-layer-pixels-updated') return [op.layerId];
        if (op.type === 'image-layer-added' && (
          op.layer.hasBitmap
          || op.layer.hasMask
          || op.layer.hasTiltmarkBase
          || op.layer.hasTiltmarkSimulation
        )) return [op.layer.id];
        return [];
      }));
      for (const layer of liveBefore.layers) {
        if (pixelLayerIds.has(layer.id)) {
          pendingLocalPixels.set(layer.id, {
            bitmap: layer.bitmap,
            mask: layer.mask,
            tiltmarkBaseBitmap: layer.tiltmarkBaseBitmap,
            tiltmarkSimulationData: layer.tiltmarkSimulationData,
            bitmapVersion: layer.bitmapVersion,
          });
        }
      }
    }
    applyingRemote = true;
    try {
      // 1. Structural/metadata: preserves surviving live bitmaps, null-shells the new/seeded layers.
      //    A pure pixel-pointer op skips this step entirely — applyRemoteLayerPixels flips the
      //    pixels AND the version in one set, so a layer never advertises a version whose bytes
      //    it doesn't hold (e.g. when the out-of-band fetch fails and we keep the old pixels).
      let changed = change.type === 'image-layer-pixels-updated'
        ? false
        : useImageEditorStore.getState().applyRemoteImageDocumentChange(change);
      // 2. Out-of-band pixels were fetched before entering the remote-apply critical section. Flip
      // them in synchronously, then immediately restore any pending local buffers below.
      for (const pixels of resolvedPixels) {
        const pixelChanged = useImageEditorStore.getState().applyRemoteLayerPixels(pixels.target.layerId, {
          bitmap: pixels.bitmap,
          mask: pixels.mask,
          tiltmarkBaseBitmap: pixels.tiltmarkBaseBitmap,
          tiltmarkSimulationData: pixels.tiltmarkSimulationData,
          bitmapVersion: pixels.target.version,
          documentId,
        });
        if (pixelChanged) {
          if (pixels.target.hasTiltmarkSimulation !== undefined) {
            releaseTiltmarkLayerSubstrate(documentId, pixels.target.layerId);
          }
          const separator = pixels.appliedKey.lastIndexOf('\u0000');
          appliedVersionByLayer.set(pixels.appliedKey.slice(0, separator), pixels.appliedKey.slice(separator + 1));
          changed = true;
        }
      }

      // A remote granular op is applied to the live document that already contains this device's
      // coalesced, unpublished edits. Replay those edits over the remote state, then retain an
      // authority-only baseline so the next flush still publishes them. Pixel buffers are captured by
      // reference before the inbound flip; a same-version collision is bumped above the authority's
      // numeric version and receives its own revision on publication.
      let authorityBaseline = change.type === 'image-document-snapshot'
        ? change.document
        : baselineBefore;
      if (authorityBaseline && change.type !== 'image-document-snapshot') {
        authorityBaseline = applyImageDocumentNativeChange(authorityBaseline, change);
      }
      for (const localOp of pendingLocalOps) {
        if (localOp.type !== 'image-layer-pixels-updated') {
          useImageEditorStore.getState().applyRemoteImageDocumentChange(localOp);
        }
        const layerId = localOp.type === 'image-layer-pixels-updated'
          ? localOp.layerId
          : localOp.type === 'image-layer-added'
            ? localOp.layer.id
            : null;
        const pixels = layerId ? pendingLocalPixels.get(layerId) : undefined;
        if (layerId && pixels) {
          const authorityVersion = authorityBaseline?.layers.find((layer) => layer.id === layerId)?.bitmapVersion ?? -1;
          const bitmapVersion = pixels.bitmapVersion <= authorityVersion
            ? authorityVersion + 1
            : pixels.bitmapVersion;
          useImageEditorStore.getState().applyRemoteLayerPixels(layerId, {
            bitmap: pixels.bitmap,
            mask: pixels.mask,
            tiltmarkBaseBitmap: pixels.tiltmarkBaseBitmap,
            tiltmarkSimulationData: pixels.tiltmarkSimulationData,
            bitmapVersion,
            documentId,
          });
        }
      }
      const inboundAssetIds = pixelAssetIds(change);
      if (inboundAssetIds.length > 0) {
        if (!await commitVerifiedProjectSyncAssets(IMAGE_SYNC_CHANNEL, inboundAssetIds)) {
          throw new Error('Image sync deferred because the inbound asset inventory could not be retained.');
        }
      }
      if (pendingLocalOps.length > 0 && authorityBaseline) {
        authorityDocuments.set(documentId, authorityBaseline);
        scheduleEmit();
      } else {
        // A remote snapshot may create/update a document alongside a different locally-active tab.
        // Store its own authority baseline without changing the active tab's baseline or focus.
        if (authorityBaseline) authorityDocuments.set(documentId, authorityBaseline);
        const liveAfter = liveDocumentById(documentId);
        if (authorityBaseline && liveAfter
          && diffImageDocumentNativeChanges(authorityBaseline, toImageDocumentWire(liveAfter)).length > 0) {
          scheduleEmit();
        } else if (currentWire()?.id === documentId) {
          clearPendingEmit();
        }
      }
      return changed;
    } finally {
      applyingRemote = false;
    }
}

const imageChannel: ProjectSyncChannel<ImageDocumentNativeChange> = {
  id: IMAGE_SYNC_CHANNEL,
  applyRemote(change) {
    const work = operationTail.then(() => applyRemoteImageChange(change));
    operationTail = work.then(() => undefined, (error: unknown) => {
      console.warn('[image-sync] Remote image application failed.', error);
    });
    return work;
  },
  snapshot() {
    const work = operationTail.then(async () => {
      const doc = activeDocument();
      if (!doc) {
        return {
          type: 'image-document-snapshot' as const,
          document: { layers: [] } as unknown as ImageDocumentWire,
        };
      }
      // Ensure every current layer's bytes are in the out-of-band store so a seeding client can fetch them
      // (the host may have loaded this document from disk and never drawn — nothing cached otherwise).
      const wire = toImageDocumentWire(doc);
      const change = withFreshPixelAssetRevisions({ type: 'image-document-snapshot', document: wire });
      const assetIds = pixelAssetIds(change);
      if (assetIds.length > 0 && !await prepareVerifiedProjectSyncAssets(IMAGE_SYNC_CHANNEL, assetIds)) {
        throw new Error('Image seed asset inventory was not acknowledged by the authority.');
      }
      for (const target of pixelTargets(change)) await publishLayerAssets(doc, target);
      if (!await commitVerifiedProjectSyncAssets(IMAGE_SYNC_CHANNEL, assetIds)) {
        throw new Error('Image seed asset inventory could not be committed.');
      }
      return change;
    });
    operationTail = work.then(() => undefined, () => undefined);
    return work;
  },
};

/**
 * Register the Image channel and wire its passive (coalesced) emit subscription. Idempotent. Called when
 * `imageEditorStore` loads (channel-init tied to the Image workspace being present, zero app-startup cost),
 * and it asks the client to begin syncing this channel if a served session is already paired.
 */
export function initializeImageSyncChannel(): void {
  if (initialized) return;
  initialized = true;

  registerProjectSyncChannel(imageChannel);
  canEmit = isAndroidLanServerAvailable();
  const initialDocument = currentWire();
  if (initialDocument) authorityDocuments.set(initialDocument.id, initialDocument);
  if (canEmit && initialDocument?.id) {
    useImageEditorStore.setState({ syncedImageDocumentId: initialDocument.id });
  }
  useImageEditorStore.subscribe(handleStoreChange);

  void ensureProjectSyncChannelStarted(IMAGE_SYNC_CHANNEL);
}

/** Test-only: reset module state between cases. */
export function __resetImageSyncChannelForTests(): void {
  applyingRemote = false;
  canEmit = false;
  authorityDocuments.clear();
  initialized = false;
  remoteApplyGeneration = 0;
  operationTail = Promise.resolve();
  consecutivePublishFailures = 0;
  retryBlockedFingerprint = '';
  appliedVersionByLayer.clear();
  codec = defaultImageLayerPixelCodec;
  putAsset = putProjectSyncAsset;
  getAsset = getProjectSyncAsset;
  clearPendingEmit();
}

/** Test-only: inject a canvas-free codec + in-memory asset transport so the round-trip runs under jsdom. */
export function __setImageSyncDepsForTests(deps: {
  codec?: ImageLayerPixelCodec;
  putAsset?: typeof putProjectSyncAsset;
  getAsset?: typeof getProjectSyncAsset;
}): void {
  if (deps.codec) codec = deps.codec;
  if (deps.putAsset) putAsset = deps.putAsset;
  if (deps.getAsset) getAsset = deps.getAsset;
}

/** Test-only: force any pending coalesced emit to run now (bypasses the debounce timer). */
export async function __flushImageSyncEmitForTests(): Promise<void> {
  await flushEmit();
}
