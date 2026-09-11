import { beforeEach, describe, expect, it } from 'vitest';

import { deriveBatonAction, selectEditBaton, useEditLockStore } from './editLockStore';
import type { EditLockState } from '../lib/projectEditLock';

/**
 * Pins the pure baton derivations the Stage 3 UI renders from (memory: cross-device-sync-baton-model):
 * `selectEditBaton` (this device's standing) and `deriveBatonAction` (the single toggle's next action).
 */

const PHONE = { id: '__loom_host__', label: 'Phone' };
const DESKTOP = { id: 'desktop-1', label: 'Desktop browser' };

function lockHeldBy(holder: { id: string; label: string } | null, pending: { id: string; label: string } | null = null): EditLockState {
  return { holder, pending, heldSince: 1, expiresAt: 2, pendingExpiresAt: 0, revision: 1 };
}

beforeEach(() => {
  useEditLockStore.getState().setLock(null);
});

describe('edit ownership epoch', () => {
  it('stays stable across a normal same-holder heartbeat', () => {
    useEditLockStore.getState().setLock(lockHeldBy(DESKTOP));
    const initialEpoch = useEditLockStore.getState().ownershipEpoch;

    useEditLockStore.getState().setLock({
      ...lockHeldBy(DESKTOP),
      revision: 2,
      expiresAt: 30_000,
    });

    expect(useEditLockStore.getState().ownershipEpoch).toBe(initialEpoch);
  });

  it('advances across another holder and back even when the final device ID matches', () => {
    useEditLockStore.getState().setLock(lockHeldBy(DESKTOP));
    const initialEpoch = useEditLockStore.getState().ownershipEpoch;

    useEditLockStore.getState().setLock({ ...lockHeldBy(PHONE), heldSince: 2, revision: 2 });
    useEditLockStore.getState().setLock({ ...lockHeldBy(DESKTOP), heldSince: 3, revision: 3 });

    expect(useEditLockStore.getState().ownershipEpoch).toBe(initialEpoch + 2);
  });
});

describe('selectEditBaton', () => {
  it('treats a null lock as an unmanaged single-device session — fully editable', () => {
    const view = selectEditBaton(null, DESKTOP.id);
    expect(view).toMatchObject({ unmanaged: true, canEdit: true, isReadOnly: false });
  });

  it('marks this device read-only when another device holds the baton', () => {
    const view = selectEditBaton(lockHeldBy(PHONE), DESKTOP.id);
    expect(view).toMatchObject({ isReadOnly: true, isHeldByThisDevice: false, holderLabel: 'Phone' });
  });

  it('marks this device the holder when it holds the baton', () => {
    const view = selectEditBaton(lockHeldBy(DESKTOP), DESKTOP.id);
    expect(view).toMatchObject({ isHeldByThisDevice: true, isReadOnly: false, canEdit: true });
  });
});

describe('deriveBatonAction', () => {
  it('renders nothing in an unmanaged session', () => {
    const action = deriveBatonAction(selectEditBaton(null, DESKTOP.id), false);
    expect(action).toMatchObject({ kind: 'none', showButton: false });
  });

  it('a free baton offers an immediate take', () => {
    const action = deriveBatonAction(selectEditBaton(lockHeldBy(null), DESKTOP.id), false);
    expect(action).toMatchObject({ kind: 'take', label: 'Edit here', tone: 'cyan' });
  });

  it('the holder with nobody waiting can release control', () => {
    const action = deriveBatonAction(selectEditBaton(lockHeldBy(DESKTOP), DESKTOP.id), false);
    expect(action).toMatchObject({ kind: 'release', tone: 'emerald' });
  });

  it('the holder with a waiting device hands the baton off', () => {
    const action = deriveBatonAction(selectEditBaton(lockHeldBy(DESKTOP, PHONE), DESKTOP.id), false);
    expect(action).toMatchObject({ kind: 'yield', label: 'Hand to Phone', tone: 'amber' });
  });

  it('a read-only device offers a takeover', () => {
    const action = deriveBatonAction(selectEditBaton(lockHeldBy(PHONE), DESKTOP.id), false);
    expect(action).toMatchObject({ kind: 'take', label: 'Take over here', tone: 'slate' });
    expect(action.status).toContain('Phone');
  });

  it('a read-only device already queued escalates to a force takeover', () => {
    const action = deriveBatonAction(selectEditBaton(lockHeldBy(PHONE, DESKTOP), DESKTOP.id), true);
    expect(action).toMatchObject({ kind: 'force', label: 'Force takeover', tone: 'rose' });
  });
});
