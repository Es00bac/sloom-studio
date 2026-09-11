import { create } from 'zustand';

import type { EditLockState } from '../lib/projectEditLock';

/**
 * Client-visible mirror of the cross-device edit baton (memory: cross-device-sync-baton-model). The
 * authority (phone) broadcasts its {@link EditLockState} over the `edit-lock` project-sync channel; the
 * channel's `applyRemote` writes it here, and the phone seeds it locally for its own UI. Workspaces
 * subscribe through {@link selectEditBaton} to render their read-only state. `lock === null` means no
 * baton info at all — a normal single-device session — and everything stays editable as usual.
 */
interface EditLockStoreState {
  lock: EditLockState | null;
  /** Local continuity token; changes only when edit ownership changes, not for normal heartbeats. */
  ownershipEpoch: number;
  setLock(lock: EditLockState | null): void;
}

function stableOwnershipIdentity(lock: EditLockState | null): string {
  if (!lock) return 'unmanaged';
  if (!lock.holder) return 'managed:free';
  // `heldSince` is assigned by each grant and deliberately remains stable across heartbeats.
  return `managed:${lock.holder.id}:${lock.heldSince}`;
}

export const useEditLockStore = create<EditLockStoreState>((set) => ({
  lock: null,
  ownershipEpoch: 0,
  setLock: (lock) => set((current) => ({
    lock,
    ownershipEpoch: current.ownershipEpoch
      + (stableOwnershipIdentity(current.lock) === stableOwnershipIdentity(lock) ? 0 : 1),
  })),
}));

export interface EditBatonView {
  /** No baton info (normal non-sync session, or before the first seed) — edit as usual. */
  unmanaged: boolean;
  /** This device may edit right now: it holds the baton, or the baton is free. */
  canEdit: boolean;
  /** Another device holds the baton — this device is read-only until it takes over. */
  isReadOnly: boolean;
  /** This device currently holds the baton. */
  isHeldByThisDevice: boolean;
  /** The baton is free (no holder) — editing here should claim it. */
  isFree: boolean;
  /** Label of whoever holds the baton (for the read-only banner), or null. */
  holderLabel: string | null;
  /** Label of a device that has requested takeover (handoff pending), or null. */
  pendingLabel: string | null;
}

/**
 * Derive this device's baton standing from the mirrored lock state. Pure, so workspaces can call it
 * inside a zustand selector. Defaults to fully editable whenever there is no baton info.
 */
export function selectEditBaton(lock: EditLockState | null, deviceId: string): EditBatonView {
  if (!lock) {
    return {
      unmanaged: true,
      canEdit: true,
      isReadOnly: false,
      isHeldByThisDevice: false,
      isFree: true,
      holderLabel: null,
      pendingLabel: null,
    };
  }
  const isFree = lock.holder === null;
  const isHeldByThisDevice = lock.holder?.id === deviceId;
  const isReadOnly = !isFree && !isHeldByThisDevice;
  return {
    unmanaged: false,
    canEdit: isFree || Boolean(isHeldByThisDevice),
    isReadOnly,
    isHeldByThisDevice: Boolean(isHeldByThisDevice),
    isFree,
    holderLabel: lock.holder?.label ?? null,
    pendingLabel: lock.pending?.label ?? null,
  };
}

/** The action the single baton toggle performs next, given this device's standing. */
export type BatonActionKind = 'take' | 'force' | 'yield' | 'release' | 'none';

export interface BatonAction {
  /** Which facade call the button fires (`none` → render nothing). */
  kind: BatonActionKind;
  /** Button label. */
  label: string;
  /** Status pill text shown beside the button. */
  status: string;
  /** Visual tone key (maps to the top-bar theme colours). */
  tone: 'emerald' | 'cyan' | 'amber' | 'rose' | 'slate';
  /** Whether the control should appear at all (false in a normal single-device session). */
  showButton: boolean;
}

/**
 * Map this device's baton standing to the single toggle's next action + presentation. Pure so the UI
 * can render straight from it and a test can pin every state. `isPendingHere` is whether THIS device is
 * the queued requester (so the take button escalates to a force once the grace window elapses).
 *
 *  - holds the baton, someone waiting → **yield** (hand the baton to the requester).
 *  - holds the baton, nobody waiting → **release** (drop to free so the other device can take it).
 *  - read-only + already queued here → **force** (break a baton stuck on a stale/unresponsive holder).
 *  - read-only, not yet queued → **take** (request takeover; may queue behind a live holder).
 *  - free → **take** (claim immediately).
 *  - unmanaged (no baton at all) → **none** (single-device session — show nothing).
 */
export function deriveBatonAction(baton: EditBatonView, isPendingHere: boolean): BatonAction {
  if (baton.unmanaged) {
    return { kind: 'none', label: '', status: '', tone: 'slate', showButton: false };
  }
  if (baton.isHeldByThisDevice) {
    if (baton.pendingLabel) {
      return { kind: 'yield', label: `Hand to ${baton.pendingLabel}`, status: 'Editing here', tone: 'amber', showButton: true };
    }
    return { kind: 'release', label: 'Release control', status: 'Editing here', tone: 'emerald', showButton: true };
  }
  if (isPendingHere) {
    return {
      kind: 'force',
      label: 'Force takeover',
      status: `${baton.holderLabel ?? 'Other device'} still editing`,
      tone: 'rose',
      showButton: true,
    };
  }
  if (baton.isReadOnly) {
    return {
      kind: 'take',
      label: 'Take over here',
      status: `${baton.holderLabel ?? 'Another device'} is editing`,
      tone: 'slate',
      showButton: true,
    };
  }
  return { kind: 'take', label: 'Edit here', status: 'Available', tone: 'cyan', showButton: true };
}
