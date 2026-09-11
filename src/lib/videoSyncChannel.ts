import { useFlowStore } from '../store/flowStore';
import { useFlowWorkspaceStore } from '../store/flowWorkspaceStore';
import type { NodeData } from '../types/flow';
import { isAndroidLanServerAvailable, notifyLanProjectChange } from './androidLanServer';
import { isServedLanSession } from './remoteHostClient';
import { ensureProjectSyncChannelStarted } from './projectSyncClient';
import {
  beginProjectSyncRemoteApply,
  endProjectSyncRemoteApply,
  isProjectSyncRemoteApplyActive,
} from './projectSyncRemoteApply';
import { registerProjectSyncChannel, type ProjectSyncChannel } from './projectSyncService';
import {
  createVideoTimelineCompositionUpdatedChange,
  createVideoTimelineCompositionSnapshot,
  createVideoTimelineWorkspaceSnapshot,
  isVideoTimelineNativeChange,
  videoTimelineCompositionFingerprint,
  VIDEO_TIMELINE_DATA_KEYS,
  type VideoTimelineCompositionSnapshot,
  type VideoTimelineDataKey,
  type VideoTimelineNativeChange,
} from './videoTimelineNativeSync';

export const VIDEO_SYNC_CHANNEL = 'video';

const EMIT_COALESCE_MS = 90;
const EMIT_MAX_WAIT_MS = 240;
const EMIT_RETRY_MS = 1_500;
const MAX_AUTOMATIC_PUBLISH_RETRIES = 8;

let applyingRemote = false;
let canEmit = false;
let initialized = false;
let unsubscribeStore: (() => void) | null = null;
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let firstPendingAt = 0;
let emitInFlight = false;
let flushRequestedWhileInFlight = false;
let consecutivePublishFailures = 0;
let retryBlockedFingerprint = '';
let lastCompositionFingerprints = new Map<string, string>();
let lastCompositionSnapshots = new Map<string, VideoTimelineCompositionSnapshot>();
let lastPublishedSnapshots = new Map<string, string>();
let inFlightSnapshots = new Map<string, string>();

function workspaceId(): string {
  return useFlowWorkspaceStore.getState().hydratedWorkspaceId;
}

function compositionNodes() {
  return useFlowStore.getState().nodes.filter((node) => node.type === 'composition');
}

function currentFingerprints(): Map<string, string> {
  const result = new Map<string, string>();
  for (const node of compositionNodes()) {
    const fingerprint = videoTimelineCompositionFingerprint(node);
    if (fingerprint) result.set(node.id, fingerprint);
  }
  return result;
}

function fingerprintSetSignature(fingerprints = currentFingerprints()): string {
  return JSON.stringify([...fingerprints.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function currentSnapshots(): Map<string, VideoTimelineCompositionSnapshot> {
  const result = new Map<string, VideoTimelineCompositionSnapshot>();
  for (const node of compositionNodes()) {
    const snapshot = createVideoTimelineCompositionSnapshot(node);
    if (snapshot) result.set(node.id, snapshot);
  }
  return result;
}

function resetBaselineToCurrent(): void {
  lastCompositionFingerprints = currentFingerprints();
  lastCompositionSnapshots = currentSnapshots();
  consecutivePublishFailures = 0;
  retryBlockedFingerprint = '';
}

function isVideoSyncActive(): boolean {
  return isAndroidLanServerAvailable() || isServedLanSession();
}

function hasPendingLocalEmit(): boolean {
  return emitTimer !== null || firstPendingAt > 0 || flushRequestedWhileInFlight;
}

function updateBaselineForComposition(compositionId: string): void {
  const node = compositionNodes().find((candidate) => candidate.id === compositionId);
  const snapshot = node ? createVideoTimelineCompositionSnapshot(node) : null;
  const fingerprint = node ? videoTimelineCompositionFingerprint(node) : null;
  if (!snapshot || !fingerprint) {
    lastCompositionFingerprints.delete(compositionId);
    lastCompositionSnapshots.delete(compositionId);
    return;
  }
  lastCompositionFingerprints.set(compositionId, fingerprint);
  lastCompositionSnapshots.set(compositionId, snapshot);
}

function compositionMatchesIdentity(snapshot: VideoTimelineCompositionSnapshot): boolean {
  const node = useFlowStore.getState().nodes.find((candidate) => candidate.id === snapshot.compositionId);
  if (!node || node.type !== 'composition') return false;
  const currentInstanceId = typeof node.data.nodeInstanceId === 'string' ? node.data.nodeInstanceId : undefined;
  return !snapshot.nodeInstanceId || !currentInstanceId || snapshot.nodeInstanceId === currentInstanceId;
}

/**
 * Preserve edits made locally during the coalescing window when a genuine remote snapshot arrives.
 * The wire mutation is a complete authored snapshot, so blindly applying it would erase the pending
 * local edit. Rebase only the locally changed authored fields over the remote snapshot; unrelated
 * remote fields survive, and a same-field conflict resolves to the user's still-pending local edit.
 */
function pendingLocalPatch(compositionId: string): Partial<NodeData> {
  if (!hasPendingLocalEmit()) return {};
  const baseline = lastCompositionSnapshots.get(compositionId)?.data ?? {};
  const currentNode = compositionNodes().find((node) => node.id === compositionId);
  const current = currentNode ? createVideoTimelineCompositionSnapshot(currentNode)?.data ?? {} : {};
  const patch: Partial<NodeData> = {};
  for (const key of VIDEO_TIMELINE_DATA_KEYS) {
    if (JSON.stringify(baseline[key]) !== JSON.stringify(current[key])) {
      (patch as Record<string, unknown>)[key] = current[key];
    }
  }
  return patch;
}

function changedTimelineKeys(
  baseline: VideoTimelineCompositionSnapshot | undefined,
  current: VideoTimelineCompositionSnapshot,
): VideoTimelineDataKey[] {
  return VIDEO_TIMELINE_DATA_KEYS.filter((key) =>
    JSON.stringify(baseline?.data[key]) !== JSON.stringify(current.data[key]));
}

function authorityCompositionFromChange(
  snapshot: VideoTimelineCompositionSnapshot,
  changedKeys?: readonly VideoTimelineDataKey[],
): VideoTimelineCompositionSnapshot {
  if (!changedKeys) return snapshot;
  const prior = lastCompositionSnapshots.get(snapshot.compositionId);
  if (!prior) return snapshot;
  const data = { ...prior.data };
  for (const key of changedKeys) {
    if (Object.hasOwn(snapshot.data, key)) {
      (data as Record<string, unknown>)[key] = snapshot.data[key];
    } else {
      delete (data as Record<string, unknown>)[key];
    }
  }
  return { ...snapshot, data };
}

function applyComposition(
  snapshot: VideoTimelineCompositionSnapshot,
  changedKeys?: readonly VideoTimelineDataKey[],
): boolean {
  const snapshotJson = JSON.stringify(snapshot);
  if (hasPendingLocalEmit()
    && (lastPublishedSnapshots.get(snapshot.compositionId) === snapshotJson
      || inFlightSnapshots.get(snapshot.compositionId) === snapshotJson)) {
    return false; // delayed self-echo of the previous publish must not roll back a newer local edit
  }
  if (!compositionMatchesIdentity(snapshot)) return false;
  const localPatch = pendingLocalPatch(snapshot.compositionId);
  const authoritySnapshot = authorityCompositionFromChange(snapshot, changedKeys);
  const node = useFlowStore.getState().nodes.find((candidate) => candidate.id === snapshot.compositionId)!;
  const before = videoTimelineCompositionFingerprint(node);
  // Every mutation is a complete authored composition snapshot. Explicitly clear keys absent from
  // the wire object; otherwise deleting the last marker/clip/asset on the authority would leave the
  // receiver's stale array in place forever because JSON cannot carry `undefined`.
  const replacement = Object.fromEntries(
    VIDEO_TIMELINE_DATA_KEYS.map((key) => [key, undefined]),
  ) as Partial<NodeData>;
  Object.assign(replacement, authoritySnapshot.data);
  const projected = { ...node, data: { ...node.data, ...replacement } };
  if (before === videoTimelineCompositionFingerprint(projected)) return false;
  // Use the canonical patch action so an inbound edit invalidates a render currently running on
  // this device and receives a fresh local inputRevision. The shared remote guard suppresses both
  // Flow and Video subscriptions while this set runs, so this cannot echo.
  useFlowStore.getState().patchNodeData(snapshot.compositionId, replacement);
  if (Object.keys(localPatch).length > 0) {
    useFlowStore.getState().patchNodeData(snapshot.compositionId, localPatch);
  }
  // Track the authority-only result rather than the live rebased node. Any retained local patch must
  // remain different from this baseline so the coalescer publishes it as the later ordered edit.
  lastCompositionSnapshots.set(snapshot.compositionId, authoritySnapshot);
  lastCompositionFingerprints.set(snapshot.compositionId, JSON.stringify(authoritySnapshot));
  return before !== videoTimelineCompositionFingerprint(
    useFlowStore.getState().nodes.find((candidate) => candidate.id === snapshot.compositionId)!,
  );
}

const videoChannel: ProjectSyncChannel<VideoTimelineNativeChange> = {
  id: VIDEO_SYNC_CHANNEL,
  applyRemote(change) {
    if (!isVideoTimelineNativeChange(change)) return false;
    // Video sync is new and every locally-created op carries this identity, so do not accept an
    // unscoped legacy-looking mutation: omission would let a delayed event target whichever workspace
    // happens to be open now.
    if (change.workspaceId !== workspaceId()) return false;
    if (change.type === 'video-timeline-sync-unavailable') {
      console.warn('[video-sync] authority timeline seed exceeds the bounded transport; keeping local state.');
      return false;
    }
    applyingRemote = true;
    beginProjectSyncRemoteApply();
    const matchingRemoteCompositionIds = (change.type === 'video-timeline-composition-updated'
      ? [change.composition]
      : change.compositions)
      .filter(compositionMatchesIdentity)
      .map((composition) => composition.compositionId);
    try {
      if (change.type === 'video-timeline-composition-updated') {
        return applyComposition(change.composition, change.changedKeys);
      }
      let changed = false;
      for (const composition of change.compositions) {
        if (applyComposition(composition)) changed = true;
      }
      return changed;
    } finally {
      endProjectSyncRemoteApply();
      applyingRemote = false;
      canEmit = true;
      if (!hasPendingLocalEmit()) {
        if (retryBlockedFingerprint) {
          // The authority wins for compositions it just supplied after this local fingerprint has
          // exhausted its retry budget. Keep old baselines for other locally-diverged compositions,
          // then rearm those rather than silently baking them in as if they were acknowledged.
          for (const compositionId of matchingRemoteCompositionIds) {
            updateBaselineForComposition(compositionId);
          }
          retryBlockedFingerprint = '';
          consecutivePublishFailures = 0;
          if (fingerprintSetSignature() !== fingerprintSetSignature(lastCompositionFingerprints)) {
            scheduleEmit();
          }
        } else {
          resetBaselineToCurrent();
        }
      }
    }
  },
  snapshot() {
    return createVideoTimelineWorkspaceSnapshot(compositionNodes(), workspaceId());
  },
};

function clearPendingEmit(): void {
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = null;
  firstPendingAt = 0;
}

async function flushEmit(): Promise<void> {
  clearPendingEmit();
  if (emitInFlight) {
    flushRequestedWhileInFlight = true;
    return;
  }
  if (!canEmit || !isVideoSyncActive() || applyingRemote || isProjectSyncRemoteApplyActive()) return;

  emitInFlight = true;
  try {
    const nextFingerprints = currentFingerprints();
    const nextFingerprintSignature = fingerprintSetSignature(nextFingerprints);
    if (retryBlockedFingerprint === nextFingerprintSignature) return;
    const changedIds = [...nextFingerprints].flatMap(([id, fingerprint]) =>
      lastCompositionFingerprints.get(id) === fingerprint ? [] : [id]);
    for (const existingId of [...lastCompositionFingerprints.keys()]) {
      if (!nextFingerprints.has(existingId)) {
        lastCompositionFingerprints.delete(existingId);
        lastCompositionSnapshots.delete(existingId);
        lastPublishedSnapshots.delete(existingId);
        inFlightSnapshots.delete(existingId);
      }
    }
    if (changedIds.length === 0) return;

    const nodesById = new Map(compositionNodes().map((node) => [node.id, node]));
    let shouldRetry = false;
    for (const id of changedIds) {
      const node = nodesById.get(id);
      if (!node) continue;
      const change = createVideoTimelineCompositionUpdatedChange(node, workspaceId());
      if (!change) {
        console.warn(`[video-sync] composition ${id} exceeds the bounded timeline schema; edit not published.`);
        continue;
      }
      const changedKeys = changedTimelineKeys(lastCompositionSnapshots.get(id), change.composition);
      const outbound = { ...change, changedKeys };
      const snapshotJson = JSON.stringify(change.composition);
      inFlightSnapshots.set(id, snapshotJson);
      let published = false;
      try {
        published = await notifyLanProjectChange(VIDEO_SYNC_CHANNEL, outbound);
      } catch {
        published = false;
      } finally {
        if (inFlightSnapshots.get(id) === snapshotJson) inFlightSnapshots.delete(id);
      }
      if (published) {
        // This is the exact snapshot acknowledged by the authority. A newer local edit may already
        // exist in the store; it remains different from this baseline and is sent by the queued flush.
        lastCompositionFingerprints.set(id, nextFingerprints.get(id)!);
        lastCompositionSnapshots.set(id, change.composition);
        lastPublishedSnapshots.set(id, snapshotJson);
      } else {
        shouldRetry = true;
      }
    }
    if (shouldRetry) {
      consecutivePublishFailures += 1;
      if (consecutivePublishFailures <= MAX_AUTOMATIC_PUBLISH_RETRIES && !emitTimer) {
        firstPendingAt = Date.now();
        emitTimer = setTimeout(() => void flushEmit(), EMIT_RETRY_MS);
      } else if (consecutivePublishFailures > MAX_AUTOMATIC_PUBLISH_RETRIES) {
        retryBlockedFingerprint = nextFingerprintSignature;
        console.warn('[video-sync] stopped automatic retries after repeated publish failures; a new timeline edit will retry.');
      }
    } else {
      consecutivePublishFailures = 0;
      retryBlockedFingerprint = '';
    }
  } finally {
    emitInFlight = false;
    if (flushRequestedWhileInFlight) {
      flushRequestedWhileInFlight = false;
      scheduleEmit();
    }
  }
}

function scheduleEmit(): void {
  const now = Date.now();
  if (!firstPendingAt) firstPendingAt = now;
  if (emitTimer) clearTimeout(emitTimer);
  const delay = Math.max(0, Math.min(EMIT_COALESCE_MS, EMIT_MAX_WAIT_MS - (now - firstPendingAt)));
  emitTimer = setTimeout(() => void flushEmit(), delay);
}

function handleStoreChange(): void {
  if (applyingRemote || isProjectSyncRemoteApplyActive()) {
    canEmit = true;
    // A blocked fingerprint needs composition-granular reconciliation in applyRemote's finally;
    // resetting the whole workspace here would silently bless unrelated unpublished local edits.
    if (!hasPendingLocalEmit() && !retryBlockedFingerprint) resetBaselineToCurrent();
    return;
  }
  if (!canEmit || !isVideoSyncActive()) return;
  const currentSignature = fingerprintSetSignature();
  if (retryBlockedFingerprint === currentSignature) return;
  if (retryBlockedFingerprint) {
    retryBlockedFingerprint = '';
    consecutivePublishFailures = 0;
  }
  scheduleEmit();
}

export function initializeVideoSyncChannel(): void {
  if (initialized) return;
  initialized = true;
  registerProjectSyncChannel(videoChannel);
  canEmit = isAndroidLanServerAvailable();
  resetBaselineToCurrent();
  unsubscribeStore = useFlowStore.subscribe(handleStoreChange);
  void ensureProjectSyncChannelStarted(VIDEO_SYNC_CHANNEL);
}

export function __resetVideoSyncChannelForTests(): void {
  applyingRemote = false;
  canEmit = false;
  emitInFlight = false;
  flushRequestedWhileInFlight = false;
  consecutivePublishFailures = 0;
  retryBlockedFingerprint = '';
  initialized = false;
  unsubscribeStore?.();
  unsubscribeStore = null;
  lastCompositionFingerprints = new Map();
  lastCompositionSnapshots = new Map();
  lastPublishedSnapshots = new Map();
  inFlightSnapshots = new Map();
  clearPendingEmit();
}

export async function __flushVideoSyncEmitForTests(): Promise<void> {
  await flushEmit();
}
