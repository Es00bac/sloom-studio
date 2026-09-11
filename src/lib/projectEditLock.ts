/**
 * Host-authority edit lock — the "baton" for single-active-editor cross-device sync
 * (memory: cross-device-sync-baton-model; docs/notes/770). One device edits a project at a time;
 * every other device is read-only until the baton is handed over. This eliminates the concurrent-
 * merge problem for heavy canvases (Image/Paper) entirely: there is never a second writer to merge.
 *
 * The phone is the authority and owns this state singleton. Each transition is broadcast to served
 * clients over the existing project-sync log as the {@link EDIT_LOCK_CHANNEL} channel (the relay
 * handler records `getEditLockState()` after each mutator), so the *other* device learns it lost or
 * gained the baton through the same long-poll it already runs — no new transport, no websocket/SSE.
 *
 * Handoff is a safe two-phase exchange so the previous holder's last edits are never lost:
 *   1. the claimer calls {@link claimLock}; if the baton is held by another live device the state goes
 *      `pending` (an event the holder tails) instead of transferring,
 *   2. the holder flushes its final snapshot, then calls {@link yieldLock} → the baton transfers,
 *   3. if the holder never yields within the grace window (offline / asleep), the claimer may
 *      {@link forceClaim} — safe because an offline holder cannot have edited past its last flush.
 * A holder {@link heartbeat}s to keep the baton fresh; a missed heartbeat past the TTL makes it stale
 * and force-claimable so a crashed device never strands the project.
 *
 * This module is a pure state machine with NO imports: every mutator returns the new state, and the
 * caller (the phone's relay handler) is responsible for broadcasting it. That keeps it fully unit-
 * testable and free of an import cycle with `projectSyncService`.
 */

/** Channel id the lock rides on the shared project-sync log. */
export const EDIT_LOCK_CHANNEL = 'edit-lock';

/** Reserved device id for the phone host's own editor identity (its UI claims the baton under this). */
export const EDIT_LOCK_HOST_DEVICE_ID = '__loom_host__';

/** A holder must re-prove liveness within this window or the baton goes stale (force-claimable). */
export const EDIT_LOCK_HOLD_TTL_MS = 30_000;

/** A takeover request the current holder doesn't answer within this grace becomes force-claimable. */
export const EDIT_LOCK_PENDING_GRACE_MS = 5_000;

export interface EditLockDevice {
  /** Stable per-device id (persisted client-side; the host uses {@link EDIT_LOCK_HOST_DEVICE_ID}). */
  id: string;
  /** Human label shown in the UI, e.g. "Phone", "Desktop browser", "Desktop app". */
  label: string;
}

export interface EditLockState {
  /** Current baton holder, or null when free (a free baton may be claimed without a handshake). */
  holder: EditLockDevice | null;
  /** A device that requested takeover and is awaiting the holder's yield, or null. */
  pending: EditLockDevice | null;
  /** Start of the holder's uninterrupted grant; stable across heartbeats and 0 when free. */
  heldSince: number;
  /** TTL deadline for the current holder; at/after this with no heartbeat the baton is stale. */
  expiresAt: number;
  /** Deadline after which an unanswered `pending` takeover becomes force-claimable; 0 when none. */
  pendingExpiresAt: number;
  /** Monotonic; bumped on every transition so clients can order/dedupe lock updates. */
  revision: number;
}

export interface EditLockClaimResult {
  /** True when the caller now holds the baton; false when it was only queued as `pending`. */
  granted: boolean;
  state: EditLockState;
}

function freshState(): EditLockState {
  return { holder: null, pending: null, heldSince: 0, expiresAt: 0, pendingExpiresAt: 0, revision: 0 };
}

let state: EditLockState = freshState();

/** The current authoritative baton state (host) — also the `edit-lock` channel's snapshot. */
export function getEditLockState(): EditLockState {
  return state;
}

function sameDevice(a: EditLockDevice | null, b: EditLockDevice | null): boolean {
  return Boolean(a && b && a.id === b.id);
}

/** A holder that has blown its TTL with no heartbeat — treated as gone, so the baton is reclaimable. */
function isHolderStale(now: number): boolean {
  return state.holder !== null && state.expiresAt !== 0 && now >= state.expiresAt;
}

/** Merge a patch and bump the revision. Always produces a new state object (never mutates in place). */
function commit(patch: Partial<Omit<EditLockState, 'revision'>>): EditLockState {
  state = { ...state, ...patch, revision: state.revision + 1 };
  return state;
}

/** Hand the baton to `device` outright, clearing any pending request and arming a fresh TTL. */
function grant(device: EditLockDevice, now: number): EditLockState {
  return commit({
    holder: device,
    pending: null,
    heldSince: now,
    expiresAt: now + EDIT_LOCK_HOLD_TTL_MS,
    pendingExpiresAt: 0,
  });
}

/**
 * Claim the baton. Grants immediately when the baton is free, stale, or already held by the caller
 * (a re-claim doubles as a heartbeat). When another live device holds it, the caller is queued as
 * `pending` instead — the holder must {@link yieldLock} (or the caller later {@link forceClaim}s).
 */
export function claimLock(device: EditLockDevice, now: number = Date.now()): EditLockClaimResult {
  if (state.holder === null || isHolderStale(now)) {
    return { granted: true, state: grant(device, now) };
  }
  if (sameDevice(state.holder, device)) {
    return { granted: true, state: heartbeat(device, now) };
  }
  if (!sameDevice(state.pending, device)) {
    commit({ pending: device, pendingExpiresAt: now + EDIT_LOCK_PENDING_GRACE_MS });
  }
  return { granted: false, state };
}

/**
 * The current holder hands the baton over. If a device is waiting (`pending`), the baton transfers to
 * it; otherwise the baton is released to free. A no-op (and unchanged state) if `device` isn't the holder.
 */
export function yieldLock(device: EditLockDevice, now: number = Date.now()): EditLockState {
  if (!sameDevice(state.holder, device)) return state;
  if (state.pending) return grant(state.pending, now);
  return commit({ holder: null, pending: null, heldSince: 0, expiresAt: 0, pendingExpiresAt: 0 });
}

/**
 * The current holder voluntarily drops the baton to free (no transfer), e.g. closing the workspace.
 * A no-op if `device` isn't the holder.
 */
export function releaseLock(device: EditLockDevice): EditLockState {
  if (!sameDevice(state.holder, device)) return state;
  return commit({ holder: null, pending: null, heldSince: 0, expiresAt: 0, pendingExpiresAt: 0 });
}

/**
 * Escalated claim used when the holder won't (or can't) yield: granted only when the baton is free,
 * the holder has gone stale (TTL elapsed), the caller already holds it, or the caller's own pending
 * request has outlived its grace window. Otherwise denied — a live, responsive holder is never stolen
 * from without first getting the chance to flush.
 */
export function forceClaim(device: EditLockDevice, now: number = Date.now()): EditLockClaimResult {
  const claimable =
    state.holder === null ||
    isHolderStale(now) ||
    sameDevice(state.holder, device) ||
    (sameDevice(state.pending, device) && state.pendingExpiresAt !== 0 && now >= state.pendingExpiresAt);
  if (!claimable) return { granted: false, state };
  return { granted: true, state: grant(device, now) };
}

/** Refresh the holder's TTL. A no-op if `device` isn't the holder. */
export function heartbeat(device: EditLockDevice, now: number = Date.now()): EditLockState {
  if (!sameDevice(state.holder, device)) return state;
  return commit({ expiresAt: now + EDIT_LOCK_HOLD_TTL_MS });
}

/** Test/teardown helper — reset the baton to a pristine (free) state. */
export function resetEditLock(): void {
  state = freshState();
}
