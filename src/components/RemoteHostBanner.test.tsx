// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditLockState } from '../lib/projectEditLock';

/**
 * Task #54: the paired served-session banner must (a) NEVER say the project is read-only — the old
 * "Projects open read-only" framing is gone now that the workspace channels + edit baton make a served
 * browser a fully-live editor — (b) surface live baton presence (who is the active editor), and (c) keep
 * the one honest caveat: Video timelines don't sync yet. The presence wiring runs through the REAL
 * {@link selectEditBaton}; only the store hook is swapped so the test can drive the mirrored lock
 * (renderToStaticMarkup reads zustand's *initial* snapshot, so the live store can't be set from a test).
 */

// Hoisted so the vi.mock factory (which runs during import) can close over the mutable lock the tests set.
const h = vi.hoisted(() => ({
  lock: null as EditLockState | null,
  served: true,
  nativeAvailable: false,
  nativeActive: false,
  qrAvailable: false,
  haneProvider: false,
  collaborationMode: 'baton' as 'baton' | 'simultaneous',
  workspaceView: 'flow' as 'flow' | 'image',
  activeImageDocumentId: 'local-image' as string | null,
  syncedImageDocumentId: null as string | null,
  syncedImageDocumentTitle: null as string | null,
  selectedImageDocuments: [] as string[],
  selectedWorkspaces: [] as string[],
  pairing: 'paired' as 'unknown' | 'unpaired' | 'paired',
  pairingSubscriber: null as null | ((state: 'unknown' | 'unpaired' | 'paired') => void),
  disconnectResult: { ok: true } as { ok: boolean; localSaveSuspended?: boolean },
}));

vi.mock('../lib/remoteHostClient', () => ({
  connectNativePhoneHost: async () => ({ ok: true }),
  disconnectNativePhoneHost: async () => {
    h.served = false;
    h.pairing = 'unknown';
    h.pairingSubscriber?.('unknown');
    return h.disconnectResult;
  },
  getRememberedNativePhoneHostAddress: () => '',
  getRemoteHostCollaborationMode: () => h.collaborationMode,
  isServedLanSession: () => h.served,
  isNativePhoneHostConnectionAvailable: () => h.nativeAvailable,
  isNativePhoneHostSession: () => h.nativeActive,
  isHaneLinkProviderSession: () => h.haneProvider,
  getRemoteHostPairingState: () => h.pairing,
  subscribeRemoteHostPairing: (
    subscriber: (state: 'unknown' | 'unpaired' | 'paired') => void,
  ) => {
    h.pairingSubscriber = subscriber;
    return () => {
      if (h.pairingSubscriber === subscriber) h.pairingSubscriber = null;
    };
  },
  pairServedSession: async () => ({ ok: true }),
  REMOTE_HOST_SYNC_ERROR_EVENT: 'sloom-remote-host-sync-error',
}));

vi.mock('../lib/haneQrPairing', () => ({
  isHaneQrPairingAvailable: () => h.qrAvailable,
}));

vi.mock('../lib/haneLinkedEdit', () => ({
  stopHaneLinkedEdit: vi.fn(),
  useHaneLinkedEditStore: () => ({
    status: 'idle',
    target: null,
    pendingFrameId: null,
    error: null,
  }),
}));

vi.mock('../lib/deviceIdentity', () => ({
  getLocalDeviceId: () => 'desktop-1',
}));

vi.mock('../store/editLockStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/editLockStore')>();
  return {
    ...actual, // keep the real selectEditBaton so the presence derivation is genuinely exercised
    useEditLockStore: (selector: (s: { lock: EditLockState | null }) => unknown) =>
      selector({ lock: h.lock }),
  };
});

vi.mock('../store/editorStore', () => ({
  useEditorStore: (selector: (state: {
    workspaceView: 'flow' | 'image';
    setWorkspaceView: (workspace: string) => void;
  }) => unknown) => selector({
    workspaceView: h.workspaceView,
    setWorkspaceView: (workspace) => h.selectedWorkspaces.push(workspace),
  }),
}));

vi.mock('../store/imageEditorStore', () => ({
  useImageEditorStore: (selector: (state: {
    activeDocId: string | null;
    syncedImageDocumentId: string | null;
    documents: Array<{ id: string; title: string }>;
    setActiveDocument: (documentId: string) => void;
  }) => unknown) => selector({
    activeDocId: h.activeImageDocumentId,
    syncedImageDocumentId: h.syncedImageDocumentId,
    documents: h.syncedImageDocumentId && h.syncedImageDocumentTitle
      ? [{ id: h.syncedImageDocumentId, title: h.syncedImageDocumentTitle }]
      : [],
    setActiveDocument: (documentId) => h.selectedImageDocuments.push(documentId),
  }),
}));

import { RemoteHostBanner } from './RemoteHostBanner';

function lockHeldBy(holder: { id: string; label: string } | null): EditLockState {
  return { holder, pending: null, heldSince: 1, expiresAt: 2, pendingExpiresAt: 0, revision: 1 };
}

afterEach(() => {
  h.lock = null;
  h.served = true;
  h.nativeAvailable = false;
  h.nativeActive = false;
  h.qrAvailable = false;
  h.haneProvider = false;
  h.collaborationMode = 'baton';
  h.workspaceView = 'flow';
  h.activeImageDocumentId = 'local-image';
  h.syncedImageDocumentId = null;
  h.syncedImageDocumentTitle = null;
  h.selectedImageDocuments = [];
  h.selectedWorkspaces = [];
  h.pairing = 'paired';
  h.pairingSubscriber = null;
  h.disconnectResult = { ok: true };
});

describe('RemoteHostBanner — paired served session (#54)', () => {
  it('keeps pairing collapsed into a compact QR-first launcher with manual details closed', () => {
    h.served = false;
    h.nativeAvailable = true;
    h.qrAvailable = true;
    const html = renderToStaticMarkup(<RemoteHostBanner />);
    const container = document.createElement('div');
    container.innerHTML = html;
    const control = container.querySelector<HTMLDetailsElement>('[data-sloom-link-control="true"]');
    const manual = container.querySelector<HTMLDetailsElement>('[data-manual-phone-link-fallback="true"]');

    expect(control?.open).toBe(false);
    expect(manual?.open).toBe(false);
    expect(html).toContain('data-sloom-link-launcher="unpaired"');
    expect(html).toContain('data-native-phone-link-form="true"');
    expect(html).toContain('data-hane-qr-pairing-open="true"');
    expect(html).toContain('Show QR for Hane');
    expect(html).toContain('Manual connection');
    expect(html).toContain('data-manual-phone-link-fallback="true"');
    expect(html).toContain('Hane address');
    expect(html).not.toContain('Scan once; Hane connects');
  });

  it('never tells the user the project is read-only, and names every live-linked workspace', () => {
    h.lock = null; // no baton seeded yet → unmanaged
    const html = renderToStaticMarkup(<RemoteHostBanner />);

    expect(html).toContain('data-remote-host-paired-banner="true"');
    expect(html).toContain('sync live');
    expect(html).toContain('Flow, Paper, Image, Video, and Source Library sync live.');
    expect(html.toLowerCase()).not.toContain('read-only');
    expect(html.toLowerCase()).not.toContain('read only');
  });

  it('states that both screens can edit when the phone advertises simultaneous collaboration', () => {
    h.collaborationMode = 'simultaneous';
    h.lock = lockHeldBy({ id: '__loom_host__', label: 'Phone' });
    const html = renderToStaticMarkup(<RemoteHostBanner />);

    expect(html).toContain('data-remote-host-collaboration="simultaneous"');
    expect(html).toContain('phone and desktop can edit together');
    expect(html).not.toContain('Phone is editing');
  });

  it('shows "editing here" when this device holds the baton', () => {
    h.lock = lockHeldBy({ id: 'desktop-1', label: 'This desktop' });
    const html = renderToStaticMarkup(<RemoteHostBanner />);

    expect(html).toContain('data-remote-host-presence="true"');
    expect(html).toContain('editing here');
  });

  it('names the remote holder when another device holds the baton', () => {
    h.lock = lockHeldBy({ id: '__loom_host__', label: 'Phone' });
    const html = renderToStaticMarkup(<RemoteHostBanner />);

    expect(html).toContain('data-remote-host-presence="true"');
    expect(html).toContain('Phone is editing');
    expect(html.toLowerCase()).not.toContain('read-only');
  });

  it('reads "available to edit" when the baton is free (no holder)', () => {
    h.lock = lockHeldBy(null);
    const html = renderToStaticMarkup(<RemoteHostBanner />);

    expect(html).toContain('available to edit');
  });

  it('offers and activates an explicit Hane phone-canvas follow action', () => {
    h.collaborationMode = 'simultaneous';
    h.syncedImageDocumentId = 'hane-live-canvas';
    h.syncedImageDocumentTitle = 'Hane Sketch';
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | null = createRoot(container);

    act(() => {
      root?.render(<RemoteHostBanner />);
    });

    const follow = container.querySelector<HTMLButtonElement>('[data-follow-phone-image="true"]');
    expect(follow?.textContent).toContain('Follow Hane Sketch');
    expect(follow?.title).toContain('New Hane strokes continue appearing');

    act(() => {
      follow?.click();
    });

    expect(h.selectedImageDocuments).toEqual(['hane-live-canvas']);
    expect(h.selectedWorkspaces).toEqual(['image']);

    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
  });

  it('shows a concise additive Hane mount state without a persistent tutorial', () => {
    h.haneProvider = true;
    const html = renderToStaticMarkup(<RemoteHostBanner />);
    const container = document.createElement('div');
    container.innerHTML = html;

    expect(html).toContain('Hane connected');
    expect(html).toContain('Source Library mounted');
    expect(container.querySelector<HTMLDetailsElement>('[data-sloom-link-control="true"]')?.open).toBe(false);
    expect(html).not.toContain('right-click an image frame');
    expect(html).not.toContain('Flow, Paper, Image, Video');
    expect(html).not.toContain('data-remote-host-presence="true"');
  });

  it('replaces the stale connected label with an authority-preserving Hane disconnect notice', async () => {
    h.haneProvider = true;
    h.nativeAvailable = true;
    h.nativeActive = true;
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | null = createRoot(container);

    await act(async () => {
      root?.render(<RemoteHostBanner />);
    });

    const disconnect = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Disconnect');
    expect(disconnect).toBeDefined();

    await act(async () => {
      disconnect?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(
      'Hane disconnected. Its Source Library bins were removed; your open project remains here.',
    );
    expect(container.textContent).not.toContain('Hane connected —');

    act(() => {
      root?.unmount();
    });
    root = null;
    container.remove();
  });
});
