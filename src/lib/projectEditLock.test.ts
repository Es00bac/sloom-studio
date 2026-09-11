import { afterEach, describe, expect, it } from 'vitest';

import {
  EDIT_LOCK_HOLD_TTL_MS,
  EDIT_LOCK_PENDING_GRACE_MS,
  claimLock,
  forceClaim,
  getEditLockState,
  heartbeat,
  releaseLock,
  resetEditLock,
  yieldLock,
  type EditLockDevice,
} from './projectEditLock';

const phone: EditLockDevice = { id: 'phone-1', label: 'Phone' };
const desktop: EditLockDevice = { id: 'desktop-1', label: 'Desktop browser' };
const T0 = 1_000_000;

afterEach(() => resetEditLock());

describe('projectEditLock', () => {
  it('grants a free baton immediately and arms a TTL', () => {
    const result = claimLock(phone, T0);
    expect(result.granted).toBe(true);
    expect(result.state.holder).toEqual(phone);
    expect(result.state.pending).toBeNull();
    expect(result.state.expiresAt).toBe(T0 + EDIT_LOCK_HOLD_TTL_MS);
    expect(getEditLockState().holder).toEqual(phone);
  });

  it('re-claim by the holder acts as a heartbeat (granted, extended TTL)', () => {
    claimLock(phone, T0);
    const result = claimLock(phone, T0 + 5_000);
    expect(result.granted).toBe(true);
    expect(result.state.holder).toEqual(phone);
    expect(result.state.heldSince).toBe(T0);
    expect(result.state.expiresAt).toBe(T0 + 5_000 + EDIT_LOCK_HOLD_TTL_MS);
  });

  it('queues a second device as pending instead of stealing a live holder', () => {
    claimLock(phone, T0);
    const result = claimLock(desktop, T0 + 1_000);
    expect(result.granted).toBe(false);
    expect(result.state.holder).toEqual(phone);
    expect(result.state.pending).toEqual(desktop);
    expect(result.state.pendingExpiresAt).toBe(T0 + 1_000 + EDIT_LOCK_PENDING_GRACE_MS);
  });

  it('yield transfers the baton to the waiting device (two-phase handoff)', () => {
    claimLock(phone, T0);
    claimLock(desktop, T0 + 1_000);
    const result = yieldLock(phone, T0 + 2_000);
    expect(result.holder).toEqual(desktop);
    expect(result.pending).toBeNull();
    expect(result.expiresAt).toBe(T0 + 2_000 + EDIT_LOCK_HOLD_TTL_MS);
  });

  it('yield with no waiter releases the baton to free', () => {
    claimLock(phone, T0);
    const result = yieldLock(phone, T0 + 1_000);
    expect(result.holder).toBeNull();
    expect(result.pending).toBeNull();
  });

  it('only the holder may yield or release', () => {
    claimLock(phone, T0);
    expect(yieldLock(desktop, T0 + 1).holder).toEqual(phone);
    expect(releaseLock(desktop).holder).toEqual(phone);
  });

  it('refuses to force-claim a live holder before the pending grace elapses', () => {
    claimLock(phone, T0);
    claimLock(desktop, T0 + 1_000); // desktop pending
    const tooSoon = forceClaim(desktop, T0 + 1_000 + EDIT_LOCK_PENDING_GRACE_MS - 1);
    expect(tooSoon.granted).toBe(false);
    expect(tooSoon.state.holder).toEqual(phone);
  });

  it('lets the pending device force-claim once its grace window elapses (holder unresponsive)', () => {
    claimLock(phone, T0);
    claimLock(desktop, T0 + 1_000);
    const result = forceClaim(desktop, T0 + 1_000 + EDIT_LOCK_PENDING_GRACE_MS);
    expect(result.granted).toBe(true);
    expect(result.state.holder).toEqual(desktop);
    expect(result.state.pending).toBeNull();
  });

  it('treats a holder past its TTL as stale: a fresh claim grants without a handshake', () => {
    claimLock(phone, T0);
    const result = claimLock(desktop, T0 + EDIT_LOCK_HOLD_TTL_MS);
    expect(result.granted).toBe(true);
    expect(result.state.holder).toEqual(desktop);
  });

  it('heartbeat from a non-holder is a no-op', () => {
    claimLock(phone, T0);
    const before = getEditLockState().revision;
    const after = heartbeat(desktop, T0 + 1_000);
    expect(after.holder).toEqual(phone);
    expect(after.revision).toBe(before);
  });

  it('bumps the revision monotonically across transitions', () => {
    const r0 = getEditLockState().revision;
    claimLock(phone, T0);
    claimLock(desktop, T0 + 1_000);
    yieldLock(phone, T0 + 2_000);
    expect(getEditLockState().revision).toBeGreaterThan(r0);
    expect(getEditLockState().revision).toBe(r0 + 3);
  });
});
