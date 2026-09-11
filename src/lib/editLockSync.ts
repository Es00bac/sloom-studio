import { isAndroidLanServerAvailable } from './androidLanServer';
import { isServedLanSession, remoteHostFetch } from './remoteHostClient';
import { ensureProjectSyncChannelStarted } from './projectSyncClient';
import { registerProjectSyncChannel, type ProjectSyncChannel } from './projectSyncService';
import {
  EDIT_LOCK_CHANNEL,
  getEditLockState,
  type EditLockDevice,
  type EditLockState,
} from './projectEditLock';
import { hostClaim, hostForceClaim, hostHeartbeat, hostRelease, hostYield } from './editLockHost';
import { getLocalDevice } from './deviceIdentity';
import { useEditLockStore } from '../store/editLockStore';

/**
 * Policy + transport layer for the cross-device edit baton (memory: cross-device-sync-baton-model),
 * mirroring `flowSyncChannel`'s role for the Flow graph. It wires three things:
 *
 *  - **Channel:** registers the `edit-lock` {@link ProjectSyncChannel} so a served client seeds the
 *    current baton (`GET /project/edit-lock/snapshot`) and tails every transition over the shared
 *    long-poll; its `applyRemote` mirrors the authority's state into {@link useEditLockStore}.
 *  - **Actions:** the device-dispatching facade the UI calls — on the phone they mutate the authority
 *    directly (`editLockHost`); on a served client they POST `/lock/*` and apply the returned state.
 *  - **Heartbeat:** while THIS device holds the baton it re-proves liveness well inside the TTL, so an
 *    idle-but-alive holder isn't force-claimed out from under an active user.
 *
 * No websocket/SSE — everything rides the existing long-poll relay (memory: lan-host-security-and-sync).
 */

/** Re-prove the holder's liveness comfortably inside EDIT_LOCK_HOLD_TTL_MS (30s). */
const HEARTBEAT_INTERVAL_MS = 12_000;

let initialized = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const editLockChannel: ProjectSyncChannel<EditLockState> = {
  id: EDIT_LOCK_CHANNEL,
  // Client side: the authority broadcast a baton transition — mirror it for the UI. (Never invoked on
  // the host: the host mutates the baton through the `/lock/*` endpoints, not the generic mutate path.)
  applyRemote(state) {
    useEditLockStore.getState().setLock(state);
    return true;
  },
  // Host side: the current authoritative baton is the seed a client pulls.
  snapshot() {
    return getEditLockState();
  },
};

// --- Served-client transport (POST /lock/*) --------------------------------------------------------

async function clientLockFetch(path: string, device: EditLockDevice): Promise<EditLockState | null> {
  const res = await remoteHostFetch(path, { method: 'POST', body: JSON.stringify({ device }), timeoutMs: 8000 });
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => null)) as { state?: EditLockState } | null;
  const state = data?.state ?? null;
  if (state) useEditLockStore.getState().setLock(state);
  return state;
}

// --- Device-dispatching facade (what the UI calls) -------------------------------------------------

/**
 * Take the baton for THIS device. On the phone this grants immediately (it is the authority). On a
 * served client it may either grant or be queued as `pending` behind a live holder — the caller learns
 * which from the mirrored store; {@link forceTakeEditBaton} escalates once the grace window elapses.
 */
export async function takeEditBaton(): Promise<void> {
  const device = getLocalDevice();
  if (isAndroidLanServerAvailable()) {
    hostClaim(device);
    return;
  }
  if (isServedLanSession()) {
    await clientLockFetch('/lock/claim', device);
  }
}

/** Escalated take: only granted by the host when the current holder is stale/unresponsive. */
export async function forceTakeEditBaton(): Promise<void> {
  const device = getLocalDevice();
  if (isAndroidLanServerAvailable()) {
    hostForceClaim(device);
    return;
  }
  if (isServedLanSession()) {
    await clientLockFetch('/lock/force', device);
  }
}

/** Hand the baton to a device that has requested it (or release to free if none is waiting). */
export async function yieldEditBaton(): Promise<void> {
  const device = getLocalDevice();
  if (isAndroidLanServerAvailable()) {
    hostYield(device);
    return;
  }
  if (isServedLanSession()) {
    await clientLockFetch('/lock/yield', device);
  }
}

/** Voluntarily drop the baton to free (no transfer). */
export async function releaseEditBaton(): Promise<void> {
  const device = getLocalDevice();
  if (isAndroidLanServerAvailable()) {
    hostRelease(device);
    return;
  }
  if (isServedLanSession()) {
    await clientLockFetch('/lock/release', device);
  }
}

// --- Holder heartbeat ------------------------------------------------------------------------------

function startHeartbeatLoop(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const lock = useEditLockStore.getState().lock;
    const device = getLocalDevice();
    if (!lock || lock.holder?.id !== device.id) return; // only the current holder heartbeats
    if (isAndroidLanServerAvailable()) {
      hostHeartbeat(device);
    } else if (isServedLanSession()) {
      void clientLockFetch('/lock/heartbeat', device);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Register the edit-lock channel and start the heartbeat. Idempotent. Called once at app boot on every
 * platform: the phone must register the channel before any client seeds it, and a client must register
 * it before pairing so the post-pair `startAllRegisteredProjectChannels` picks it up.
 */
export function initializeEditLockSync(): void {
  if (initialized) return;
  initialized = true;

  registerProjectSyncChannel(editLockChannel);

  // The phone is the default active editor (memory: cross-device-sync-baton-model), so it *starts*
  // holding the baton. This is the damage-prevention default: a desktop client that later connects
  // seeds this state, sees the phone as holder, and is read-only until it explicitly takes over — rather
  // than seeing a free baton and editing the same file concurrently. `hostClaim` also mirrors the phone's
  // own UI store. (No-op everywhere but the phone host.)
  if (isAndroidLanServerAvailable()) {
    hostClaim(getLocalDevice());
  }
  // If we're already a served+paired session, begin tailing now; otherwise this no-ops and the
  // post-pair `startAllRegisteredProjectChannels` starts it.
  if (isServedLanSession()) {
    void ensureProjectSyncChannelStarted(EDIT_LOCK_CHANNEL);
  }

  startHeartbeatLoop();
}

/** Test-only: reset module state between cases. */
export function __resetEditLockSyncForTests(): void {
  initialized = false;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
