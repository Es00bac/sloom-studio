import {
  EDIT_LOCK_CHANNEL,
  claimLock,
  forceClaim,
  getEditLockState,
  heartbeat,
  releaseLock,
  yieldLock,
  type EditLockClaimResult,
  type EditLockDevice,
  type EditLockState,
} from './projectEditLock';
import { recordProjectSyncChange } from './projectSyncService';
import { useEditLockStore } from '../store/editLockStore';

/**
 * Host-authority wrappers around the pure {@link projectEditLock} state machine. Each mutator updates
 * the authoritative baton and then **propagates** it two ways: (1) onto the shared project-sync log so
 * served clients tail the change over the long-poll they already run, and (2) into the phone's own
 * {@link useEditLockStore} so the host UI reflects its baton without round-tripping through the network.
 *
 * Called from two places — the phone's relay handler (`androidLanServer`, on behalf of a served client)
 * and the phone's own UI (directly). Kept free of an `androidLanServer` import so the relay can import
 * THIS without an import cycle. Heartbeats deliberately do NOT broadcast: a TTL refresh isn't relevant
 * to other devices (which gate on holder/pending, not `expiresAt`), so it would only spam the log.
 */
function applyHostLockState(broadcast: boolean): EditLockState {
  const state = getEditLockState();
  if (broadcast) recordProjectSyncChange(EDIT_LOCK_CHANNEL, state);
  useEditLockStore.getState().setLock(state);
  return state;
}

export function hostClaim(device: EditLockDevice): EditLockClaimResult {
  const result = claimLock(device);
  applyHostLockState(true);
  return result;
}

export function hostYield(device: EditLockDevice): EditLockState {
  yieldLock(device);
  return applyHostLockState(true);
}

export function hostRelease(device: EditLockDevice): EditLockState {
  releaseLock(device);
  return applyHostLockState(true);
}

export function hostForceClaim(device: EditLockDevice): EditLockClaimResult {
  const result = forceClaim(device);
  applyHostLockState(true);
  return result;
}

export function hostHeartbeat(device: EditLockDevice): EditLockState {
  heartbeat(device);
  return applyHostLockState(false);
}
