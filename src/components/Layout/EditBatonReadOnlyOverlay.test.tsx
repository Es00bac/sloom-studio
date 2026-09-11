import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditLockState } from '../../lib/projectEditLock';

const h = vi.hoisted(() => ({
  simultaneous: false,
  lock: {
    holder: { id: '__loom_host__', label: 'Phone' },
    pending: null,
    heldSince: 1,
    expiresAt: 2,
    pendingExpiresAt: 0,
    revision: 1,
  } as EditLockState,
}));

vi.mock('../../lib/deviceIdentity', () => ({ getLocalDeviceId: () => 'desktop-1' }));
vi.mock('../../lib/editLockSync', () => ({
  forceTakeEditBaton: vi.fn(),
  takeEditBaton: vi.fn(),
}));
vi.mock('../../lib/remoteHostClient', () => ({
  isSimultaneousProjectSyncSession: () => h.simultaneous,
}));
vi.mock('../../store/editLockStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/editLockStore')>();
  return {
    ...actual,
    useEditLockStore: (selector: (state: { lock: EditLockState }) => unknown) => selector({ lock: h.lock }),
  };
});

import { EditBatonReadOnlyOverlay } from './EditBatonReadOnlyOverlay';

afterEach(() => {
  h.simultaneous = false;
});

describe('EditBatonReadOnlyOverlay', () => {
  it('keeps the legacy shield for an older single-writer phone', () => {
    const html = renderToStaticMarkup(<EditBatonReadOnlyOverlay />);
    expect(html).toContain('data-edit-baton-readonly-overlay="true"');
  });

  it('leaves the workspace interactive for a simultaneous phone link', () => {
    h.simultaneous = true;
    const html = renderToStaticMarkup(<EditBatonReadOnlyOverlay />);
    expect(html).toBe('');
  });
});

