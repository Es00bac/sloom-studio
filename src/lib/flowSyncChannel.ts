import { useFlowStore } from '../store/flowStore';
import type { NodeData } from '../types/flow';
import { isAndroidLanServerAvailable, notifyLanProjectChange } from './androidLanServer';
import { isServedLanSession } from './remoteHostClient';
import { ensureProjectSyncChannelStarted } from './projectSyncClient';
import { registerProjectSyncChannel, type ProjectSyncChannel } from './projectSyncService';
import {
  beginProjectSyncRemoteApply,
  endProjectSyncRemoteApply,
  isProjectSyncRemoteApplyActive,
} from './projectSyncRemoteApply';
import {
  stripVideoCompositionLocalOnlyData,
  stripVideoOwnedCompositionData,
} from './videoTimelineNativeSync';
import {
  applyFlowGraphNativeChange,
  diffFlowGraphNativeChanges,
  isFlowGraphNativeChange,
  type FlowGraphNativeChange,
  type FlowGraphRendererState,
} from './flowGraphNativeSync';

/**
 * Flow workspace's seat on the unified cross-device op-sync (task #51). This is the **policy** layer
 * that connects the pure op model ([[flowGraphNativeSync]]) and the live store (`flowStore`) to the
 * shared transport ([[projectSyncService]] + `androidLanServer` + `projectSyncClient`):
 *
 *  - **Apply (inbound):** registers a `ProjectSyncChannel` whose `applyRemote` drives
 *    `flowStore.applyRemoteFlowGraphChange` inside an **echo guard**, and whose `snapshot` exports the
 *    serializable graph for a client's seed.
 *  - **Emit (outbound):** a single passive `useFlowStore.subscribe` that diffs the serializable graph
 *    after every store change and pushes the minimal granular ops via `notifyLanProjectChange`.
 *
 * Why a passive subscription instead of threading emit through each store action: the flow graph is
 * mutated from ~a dozen code paths (drag, connect, paste, group, collapse, run-result writeback, …) and
 * the store re-normalizes nodes/edges (portals, exclusive video frames, list edges) inside `set`. Diffing
 * the *post-`set`* serializable result is the only robust seam — it captures every path and never emits a
 * transient runtime field. The diff is O(nodes+edges) and gated so it is a true no-op off a sync session.
 *
 * Echo-loop + authority safety:
 *  - `applyingRemote` suppresses the emit that our own `applyRemote` provokes (it would otherwise diff and
 *    re-broadcast the very op we just received).
 *  - `canEmit` starts true only on the phone authority. A served client stays mute until it has applied
 *    its first remote op (the seed snapshot), so it can **never push its stale local graph over the
 *    phone's** on connect — it only emits the deltas a user makes *after* it is in sync.
 *  - mid-drag changes are skipped; the drag-end commit (`dragging:false`) emits the final position only.
 */

export const FLOW_SYNC_CHANNEL = 'flow';
const EMIT_RETRY_MS = 1_500;
const MAX_AUTOMATIC_PUBLISH_RETRIES = 8;

/** True while we are applying a remote op — the emit subscription must not re-broadcast it. */
let applyingRemote = false;
/** A served client only earns the right to emit after it has synced from the authority once. */
let canEmit = false;
/** Baseline serializable graph the subscription diffs against; null until the first observation. */
let lastGraph: FlowGraphRendererState | null = null;
let initialized = false;
let unsubscribeStore: (() => void) | null = null;
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let operationTail: Promise<void> = Promise.resolve();
let consecutivePublishFailures = 0;
let retryBlockedFingerprint = '';

/** The fully-serialized (runtime-stripped) graph — the shape the op model + diff operate on. */
function currentSerializableGraph(): FlowGraphRendererState {
  const snapshot = useFlowStore.getState().exportProjectFlowSnapshot();
  return {
    nodes: snapshot.nodes.map((node) => {
      // Project/workspace duplication deliberately retains an active run marker, but that marker
      // is device-local and must never become a cross-device Flow mutation or seed field.
      const { isRunning: _isRunning, retryState: _retryState, ...syncData } = node.data;
      return node.type === 'composition'
        ? { ...node, data: stripVideoCompositionLocalOnlyData(syncData) }
        : { ...node, data: syncData };
    }),
    edges: snapshot.edges,
  };
}

/** Cheap predicate: does this client participate in project sync at all? Keeps non-sync sessions free. */
function isFlowSyncActive(): boolean {
  return isAndroidLanServerAvailable() || isServedLanSession();
}

const flowChannel: ProjectSyncChannel<FlowGraphNativeChange> = {
  id: FLOW_SYNC_CHANNEL,
  applyRemote(change) {
    if (!isFlowGraphNativeChange(change)) return false;
    const work = operationTail.then(() => {
      const shouldRebaseLocal = change.type === 'flow-graph-snapshot' && canEmit && lastGraph !== null;
      const localBefore = shouldRebaseLocal ? currentSerializableGraph() : null;
      const pendingLocalOps = shouldRebaseLocal && localBefore
        ? diffFlowGraphNativeChanges(lastGraph!, localBefore)
        : [];
      applyingRemote = true;
      beginProjectSyncRemoteApply();
      try {
        let changed = useFlowStore.getState().applyRemoteFlowGraphChange(change);
        if (change.type === 'flow-graph-snapshot' && shouldRebaseLocal) {
          // A gap repair is an authority replacement, but the renderer may contain edits whose
          // publication never received an acknowledgement. Replay that local delta over the new
          // authority graph, exactly as Paper/Image/Video do, while retaining the authority-only
          // baseline so the replayed edits remain pending for the next successful publish.
          for (const localOp of pendingLocalOps) {
            if (useFlowStore.getState().applyRemoteFlowGraphChange(localOp)) changed = true;
          }
          lastGraph = {
            nodes: change.snapshot.nodes.map((node) => ({ ...node, data: { ...node.data } })),
            edges: change.snapshot.edges.map((edge) => ({ ...edge })),
          };
          consecutivePublishFailures = 0;
          retryBlockedFingerprint = '';
          if (projectedFlowOps(lastGraph, currentSerializableGraph()).length > 0) scheduleEmit();
        }
        return changed;
      } finally {
        endProjectSyncRemoteApply();
        applyingRemote = false;
      }
    });
    operationTail = work.then(() => undefined, () => undefined);
    return work;
  },
  snapshot() {
    const work = operationTail.then(() => {
      const snapshot = useFlowStore.getState().exportProjectFlowSnapshot();
      const graph = currentSerializableGraph();
      return { type: 'flow-graph-snapshot' as const, snapshot: { ...snapshot, ...graph } };
    });
    operationTail = work.then(() => undefined, () => undefined);
    return work;
  },
};

function flowFingerprint(graph = currentSerializableGraph()): string {
  return JSON.stringify(graph);
}

function projectedFlowOps(
  previous: FlowGraphRendererState,
  next: FlowGraphRendererState,
): FlowGraphNativeChange[] {
  return diffFlowGraphNativeChanges(previous, next).flatMap<FlowGraphNativeChange>((op) => {
    if (op.type !== 'flow-node-data-updated') return [op];
    const nextNode = next.nodes.find((node) => node.id === op.nodeId);
    if (nextNode?.type !== 'composition') return [op];
    const previousNode = previous.nodes.find((node) => node.id === op.nodeId);
    const projectedPatch = stripVideoOwnedCompositionData(op.patch as NodeData);
    const projectedPrevious = previousNode ? stripVideoOwnedCompositionData(previousNode.data) : {};
    const projectedUnsetKeys = (op.unsetKeys ?? []).filter((key) => Object.hasOwn(projectedPrevious, key));
    if (Object.keys(projectedPatch).length === 0 && projectedUnsetKeys.length === 0) return [];
    return [{
      ...op,
      patch: projectedPatch,
      ...(projectedUnsetKeys.length ? { unsetKeys: projectedUnsetKeys } : { unsetKeys: undefined }),
    }];
  });
}

function clearEmitTimer(): void {
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = null;
}

function scheduleEmit(delayMs = 0): void {
  clearEmitTimer();
  emitTimer = setTimeout(() => void flushEmit(), delayMs);
}

async function flushEmitWork(): Promise<void> {
  if (!canEmit || !isFlowSyncActive() || applyingRemote || isProjectSyncRemoteApplyActive()) return;
  if (useFlowStore.getState().nodes.some((node) => node.dragging)) return;

  const next = currentSerializableGraph();
  const fingerprint = flowFingerprint(next);
  if (retryBlockedFingerprint === fingerprint) return;
  if (lastGraph === null) {
    lastGraph = next;
    return;
  }
  const ops = projectedFlowOps(lastGraph, next);
  if (ops.length === 0) {
    lastGraph = next;
    consecutivePublishFailures = 0;
    retryBlockedFingerprint = '';
    return;
  }
  for (const op of ops) {
    if (!await notifyLanProjectChange(FLOW_SYNC_CHANNEL, op)) {
      throw new Error('Flow mutation was not acknowledged by the authority.');
    }
    lastGraph = applyFlowGraphNativeChange(lastGraph!, op);
  }
  // The projected operations intentionally omit Video-owned composition keys. Once every Flow op is
  // acknowledged, bless the complete captured graph so those delegated fields do not reappear in diffs.
  lastGraph = next;
  consecutivePublishFailures = 0;
  retryBlockedFingerprint = '';
  if (flowFingerprint() !== fingerprint) scheduleEmit();
}

function flushEmit(): Promise<void> {
  clearEmitTimer();
  const work = operationTail.then(flushEmitWork);
  operationTail = work.catch((error: unknown) => {
    console.warn('[flow-sync] Graph publication deferred.', error);
    const fingerprint = flowFingerprint();
    consecutivePublishFailures += 1;
    if (consecutivePublishFailures <= MAX_AUTOMATIC_PUBLISH_RETRIES) {
      scheduleEmit(EMIT_RETRY_MS);
    } else {
      retryBlockedFingerprint = fingerprint;
      console.warn('[flow-sync] stopped automatic retries after repeated publish failures; a new Flow edit will retry.');
    }
  });
  return operationTail;
}

function handleStoreChange(): void {
  if (applyingRemote) {
    // We just synced from the authority. From now on our edits are safe to push, and the baseline must
    // track the applied state so the next user edit diffs against it (not the pre-apply graph).
    canEmit = true;
    lastGraph = currentSerializableGraph();
    return;
  }
  if (isProjectSyncRemoteApplyActive()) {
    // Video also updates composition nodes in this store. Its remote apply must advance Flow's local
    // baseline to suppress an echo, but it must not arm Flow publication before Flow's own seed lands.
    lastGraph = currentSerializableGraph();
    return;
  }
  if (!canEmit || !isFlowSyncActive()) return;
  if (useFlowStore.getState().nodes.some((node) => node.dragging)) return;
  const fingerprint = flowFingerprint();
  if (retryBlockedFingerprint === fingerprint) return;
  if (retryBlockedFingerprint) {
    retryBlockedFingerprint = '';
    consecutivePublishFailures = 0;
  }
  scheduleEmit();
}

/**
 * Register the Flow channel and wire its passive emit subscription. Idempotent. Called when `flowStore`
 * loads (so channel-init is tied to the Flow workspace being present, with zero app-startup cost), and
 * it asks the client to begin syncing this channel if a served session is already paired.
 */
export function initializeFlowSyncChannel(): void {
  if (initialized) return;
  initialized = true;

  registerProjectSyncChannel(flowChannel);
  // The phone authority's own edits are canonical — emit from the start. A served client earns `canEmit`
  // only after its first remote apply (the seed), so it cannot clobber the authority on connect.
  canEmit = isAndroidLanServerAvailable();
  lastGraph = currentSerializableGraph();
  unsubscribeStore = useFlowStore.subscribe(handleStoreChange);

  // If we're a served+paired session, start tailing this channel now; otherwise this no-ops and the
  // post-pair `startAllRegisteredProjectChannels` picks it up.
  void ensureProjectSyncChannelStarted(FLOW_SYNC_CHANNEL);
}

/** Test-only: reset module state between cases. */
export function __resetFlowSyncChannelForTests(): void {
  applyingRemote = false;
  canEmit = false;
  lastGraph = null;
  initialized = false;
  unsubscribeStore?.();
  unsubscribeStore = null;
  operationTail = Promise.resolve();
  consecutivePublishFailures = 0;
  retryBlockedFingerprint = '';
  clearEmitTimer();
}

/** Test-only: await the serialized Flow publisher without depending on timer timing. */
export function __flushFlowSyncEmitForTests(): Promise<void> {
  return flushEmit();
}
