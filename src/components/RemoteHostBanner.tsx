import { Link2, LockKeyhole, QrCode, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  connectNativePhoneHost,
  disconnectNativePhoneHost,
  getRememberedNativePhoneHostAddress,
  getRemoteHostCollaborationMode,
  getRemoteHostPairingState,
  isHaneLinkProviderSession,
  isNativePhoneHostConnectionAvailable,
  isNativePhoneHostSession,
  isServedLanSession,
  pairServedSession,
  REMOTE_HOST_SYNC_ERROR_EVENT,
  subscribeRemoteHostPairing,
  type RemoteHostPairingState,
} from '../lib/remoteHostClient';
import { isHaneQrPairingAvailable } from '../lib/haneQrPairing';
import {
  stopHaneLinkedEdit,
  useHaneLinkedEditStore,
} from '../lib/haneLinkedEdit';
import { HaneQrPairingDialog } from './HaneQrPairingDialog';
import { getLocalDeviceId } from '../lib/deviceIdentity';
import { useConfirmationStore } from '../store/confirmationStore';
import { selectEditBaton, useEditLockStore } from '../store/editLockStore';
import { useEditorStore } from '../store/editorStore';
import { useImageEditorStore } from '../store/imageEditorStore';
import { TeamReviewStatusPanel } from './TeamReviewStatusPanel';

/**
 * Quiet Sloom Link controller for native and phone-served sessions.
 *
 * Link state is represented by a small, persistent launcher. Pairing instructions, manual LAN
 * details, presence, and disconnect controls are shown only after the artist opens it. This keeps
 * URLs, PINs, and transport language off the canvas while preserving the complete fallback path.
 *
 * Renders nothing in any other runtime.
 */
export function RemoteHostBanner() {
  const [pairing, setPairing] = useState<RemoteHostPairingState>(() => getRemoteHostPairingState());
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [phoneAddress, setPhoneAddress] = useState(() => getRememberedNativePhoneHostAddress());
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const workspaceView = useEditorStore((state) => state.workspaceView);
  const setWorkspaceView = useEditorStore((state) => state.setWorkspaceView);
  const activeImageDocumentId = useImageEditorStore((state) => state.activeDocId);
  const syncedImageDocumentId = useImageEditorStore((state) => state.syncedImageDocumentId);
  const syncedImageDocumentTitle = useImageEditorStore((state) =>
    state.documents.find((document) => document.id === state.syncedImageDocumentId)?.title,
  );
  const setActiveImageDocument = useImageEditorStore((state) => state.setActiveDocument);
  const haneLinkedEdit = useHaneLinkedEditStore();
  const baton = selectEditBaton(
    useEditLockStore((state) => state.lock),
    getLocalDeviceId(),
  );

  useEffect(() => subscribeRemoteHostPairing(setPairing), []);
  useEffect(() => {
    const onSyncError = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      setError(message ?? 'A phone synchronization operation failed.');
      setPanelOpen(true);
    };
    window.addEventListener(REMOTE_HOST_SYNC_ERROR_EVENT, onSyncError);
    return () => window.removeEventListener(REMOTE_HOST_SYNC_ERROR_EVENT, onSyncError);
  }, []);

  const nativeLinkAvailable = isNativePhoneHostConnectionAvailable();
  const nativeLinkActive = isNativePhoneHostSession();
  const qrLinkAvailable = isHaneQrPairingAvailable();
  const handleQrConnected = useCallback((deviceLabel: string) => {
    setQrOpen(false);
    setError(null);
    setDisconnectNotice(`${deviceLabel} connected.`);
    setPanelOpen(false);
  }, []);

  if (!isServedLanSession()) {
    if (!nativeLinkAvailable) return null;

    const connect = async () => {
      if (busy) return;
      const confirmed = await useConfirmationStore.getState().requestConfirmation(
        'Connect to this trusted device? Hane adds its canvases beside your open project. A full '
          + 'Sloom Studio phone connection may replace the workspaces currently in memory.',
        'Link this device?',
      );
      if (!confirmed) return;
      setBusy(true);
      setError(null);
      setDisconnectNotice(null);
      const result = await connectNativePhoneHost(phoneAddress);
      if (!result.ok) {
        setError(result.error ?? 'Could not connect to the phone.');
        setPanelOpen(true);
      } else {
        setPanelOpen(false);
      }
      setBusy(false);
    };

    return (
      <>
        <details
          className="group fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-3 z-[400] sm:bottom-3"
          data-sloom-link-control="true"
          onToggle={(event) => setPanelOpen(event.currentTarget.open)}
          open={panelOpen}
        >
          <summary
            aria-label="Open Sloom Link"
            className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-sky-300/35 bg-slate-950/92 px-3 text-xs font-semibold text-sky-100 shadow-xl backdrop-blur hover:bg-slate-900 [&::-webkit-details-marker]:hidden"
            data-sloom-link-launcher="unpaired"
            title="Sloom Link"
          >
            <Link2 aria-hidden="true" size={17} />
            <span>Link</span>
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-sky-300/70" />
          </summary>
          <section
            className="absolute bottom-[calc(100%+0.5rem)] right-0 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-3 rounded-2xl border border-sky-400/35 bg-slate-950/97 p-3 text-xs text-sky-100 shadow-2xl backdrop-blur"
            data-native-phone-link-form="true"
            data-sloom-link-panel="true"
          >
            <header className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <strong className="text-sm text-sky-50">Sloom Link</strong>
                <small className="text-sky-200/65">Pair Hane on this network</small>
              </span>
              <button
                aria-label="Close Sloom Link"
                className="rounded-lg p-1.5 text-sky-100/55 hover:bg-white/10 hover:text-white"
                onClick={() => setPanelOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </header>
            {qrLinkAvailable ? (
              <button
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-300/45 bg-cyan-400/15 px-3 py-2 font-semibold text-cyan-50 hover:bg-cyan-400/25"
                data-hane-qr-pairing-open="true"
                onClick={() => {
                  setError(null);
                  setDisconnectNotice(null);
                  setPanelOpen(false);
                  setQrOpen(true);
                }}
                type="button"
              >
                <QrCode aria-hidden="true" size={17} /> Show QR for Hane
              </button>
            ) : null}
            <details className="rounded-xl border border-sky-400/15 px-2.5" data-manual-phone-link-fallback="true">
              <summary className="flex min-h-10 cursor-pointer select-none items-center font-medium text-sky-200/70 hover:text-sky-100">
                Manual connection
              </summary>
              <div className="flex flex-wrap items-center gap-2 border-t border-sky-400/15 py-2.5">
                <label className="sr-only" htmlFor="native-phone-host-address">Hane address</label>
                <input
                  className="min-w-0 flex-1 rounded-lg border border-sky-400/40 bg-slate-900 px-2.5 py-2 text-sky-50 outline-none focus:border-sky-300"
                  id="native-phone-host-address"
                  onChange={(event) => setPhoneAddress(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void connect();
                  }}
                  placeholder="Hane address"
                  value={phoneAddress}
                />
                <button
                  className="shrink-0 rounded-lg border border-sky-400/40 px-3 py-2 font-semibold hover:bg-sky-500/20 disabled:opacity-50"
                  disabled={busy || phoneAddress.trim().length === 0}
                  onClick={() => void connect()}
                  type="button"
                >
                  {busy ? 'Linking…' : 'Link'}
                </button>
                <span className="basis-full text-sky-200/55">
                  Use this only when Hane cannot scan the QR.
                </span>
              </div>
            </details>
            {error && <span className="text-amber-300/90" role="status">{error}</span>}
            {disconnectNotice && <span className="text-amber-200/80" role="status">{disconnectNotice}</span>}
          </section>
        </details>
        {qrOpen ? (
          <HaneQrPairingDialog
            onClose={() => setQrOpen(false)}
            onConnected={handleQrConnected}
          />
        ) : null}
      </>
    );
  }

  if (pairing === 'unpaired') {
    const submit = async () => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const result = await pairServedSession(pin);
      if (!result.ok) {
        setError(result.error ?? 'Pairing failed.');
        setPanelOpen(true);
        setBusy(false);
        return;
      }
      setPin('');
      setPanelOpen(false);
      setBusy(false);
    };

    return (
      <details
        className="group fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-3 z-[400] sm:bottom-3"
        data-sloom-link-control="true"
        onToggle={(event) => setPanelOpen(event.currentTarget.open)}
        open={panelOpen}
      >
        <summary
          aria-label="Connect Sloom Link"
          className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-amber-300/35 bg-slate-950/92 px-3 text-xs font-semibold text-amber-100 shadow-xl backdrop-blur hover:bg-slate-900 [&::-webkit-details-marker]:hidden"
          data-sloom-link-launcher="pin"
          title="Connect to the serving device"
        >
          <LockKeyhole aria-hidden="true" size={16} />
          <span>Connect</span>
        </summary>
        <section
          className="absolute bottom-[calc(100%+0.5rem)] right-0 flex w-[min(21rem,calc(100vw-1.5rem))] flex-col gap-3 rounded-2xl border border-amber-400/35 bg-slate-950/97 p-3 text-xs text-amber-100 shadow-2xl backdrop-blur"
          data-served-phone-pairing-panel="true"
          data-sloom-link-panel="true"
        >
          <header className="flex items-start justify-between gap-3">
            <span className="flex flex-col">
              <strong className="text-sm text-amber-50">Connect to Sloom</strong>
              <small className="text-amber-200/65">Enter the code on the serving device</small>
            </span>
            <button
              aria-label="Close connection panel"
              className="rounded-lg p-1.5 text-amber-100/55 hover:bg-white/10 hover:text-white"
              onClick={() => setPanelOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </header>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="served-phone-pin">Pairing code</label>
            <input
              className="min-w-0 flex-1 rounded-lg border border-amber-400/40 bg-slate-900 px-3 py-2 text-center font-semibold tracking-[0.2em] text-amber-50 outline-none focus:border-amber-300"
              id="served-phone-pin"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
              placeholder="000000"
              value={pin}
            />
            <button
              className="shrink-0 rounded-lg border border-amber-400/40 px-3 py-2 font-semibold hover:bg-amber-500/20 disabled:opacity-50"
              disabled={busy || pin.length === 0}
              onClick={() => void submit()}
              type="button"
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          {error && <span className="text-amber-300/90" role="status">{error}</span>}
        </section>
      </details>
    );
  }

  if (pairing === 'paired') {
    const haneProvider = isHaneLinkProviderSession();
    const simultaneous = getRemoteHostCollaborationMode() === 'simultaneous';
    // Live presence from the baton: who is the active editor right now. `unmanaged` means the baton hasn't
    // seeded yet (treat as available); otherwise show this device or the holder.
    const editor = haneProvider
      ? null
      : simultaneous
      ? 'phone and desktop can edit together'
      : baton.unmanaged
        ? null
        : baton.isHeldByThisDevice
          ? 'editing here'
          : baton.holderLabel
            ? `${baton.holderLabel} is editing`
            : 'available to edit';
    const disconnect = async () => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const result = await disconnectNativePhoneHost();
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? 'Could not disconnect from the phone.');
        setPanelOpen(true);
        return;
      }
      if (result.localSaveSuspended) {
        setDisconnectNotice('Disconnected. Use File > New or File > Open before saving a local project.');
      } else if (haneProvider) {
        setDisconnectNotice('Hane disconnected. Its Source Library bins were removed; your open project remains here.');
      } else {
        setDisconnectNotice('Device disconnected.');
      }
      setPanelOpen(true);
    };
    const followPhoneCanvas = () => {
      if (!syncedImageDocumentId) return;
      setActiveImageDocument(syncedImageDocumentId);
      setWorkspaceView('image');
    };
    const followingPhoneCanvas = Boolean(
      syncedImageDocumentId
      && activeImageDocumentId === syncedImageDocumentId
      && workspaceView === 'image',
    );

    return (
      <details
        className="group fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-3 z-[400] sm:bottom-3"
        data-sloom-link-control="true"
        onToggle={(event) => setPanelOpen(event.currentTarget.open)}
        open={panelOpen}
      >
        <summary
          aria-label={haneProvider ? 'Hane connected. Open Sloom Link' : 'Device connected. Open Sloom Link'}
          className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-emerald-300/40 bg-slate-950/92 px-3 text-xs font-semibold text-emerald-100 shadow-xl backdrop-blur hover:bg-slate-900 [&::-webkit-details-marker]:hidden"
          data-sloom-link-launcher="paired"
          title={haneLinkedEdit.target ? `Live edit: ${haneLinkedEdit.target.sourceLabel}` : 'Sloom Link connected'}
        >
          <Link2 aria-hidden="true" size={17} />
          <span>{haneLinkedEdit.target ? 'Live' : haneProvider ? 'Hane' : 'Linked'}</span>
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.75)]" />
        </summary>
        <section
          className="absolute bottom-[calc(100%+0.5rem)] right-0 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-3 rounded-2xl border border-emerald-400/35 bg-slate-950/97 p-3 text-xs text-emerald-100 shadow-2xl backdrop-blur"
          data-remote-host-paired-banner="true"
          data-sloom-link-panel="true"
        >
          <header className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col">
              <strong className="text-sm text-emerald-50">
                {haneProvider ? 'Hane connected' : 'Devices linked'}
              </strong>
              <small className="text-emerald-200/65">
                {haneProvider ? 'Source Library mounted' : 'Workspaces sync live'}
              </small>
            </span>
            <button
              aria-label="Close Sloom Link"
              className="rounded-lg p-1.5 text-emerald-100/55 hover:bg-white/10 hover:text-white"
              onClick={() => setPanelOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </header>
          {!haneProvider ? (
            <span className="text-emerald-200/75">
              Flow, Paper, Image, Video, and Source Library sync live.
            </span>
          ) : null}
          {!haneProvider ? <TeamReviewStatusPanel /> : null}
          {editor ? (
            <span className="text-emerald-200/80">
              <span
                data-remote-host-collaboration={simultaneous ? 'simultaneous' : 'baton'}
                data-remote-host-presence="true"
              >
                {editor}
              </span>
            </span>
          ) : null}
          {error && (
            <span className="text-amber-200/90" data-remote-host-sync-error="true" role="status">
              {error}
            </span>
          )}
          {haneProvider && haneLinkedEdit.target ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-2.5">
              <span
                className="min-w-0 truncate text-cyan-100"
                data-hane-linked-paper-target="true"
                title={haneLinkedEdit.target.sourceLabel}
              >
                Live: {haneLinkedEdit.target.sourceLabel}
              </span>
              <button
                className="shrink-0 rounded-lg border border-cyan-300/40 px-2.5 py-1.5 font-semibold hover:bg-cyan-400/15"
                onClick={() => void stopHaneLinkedEdit()}
                type="button"
              >
                Stop
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {!haneProvider && syncedImageDocumentId ? (
              <button
                className={`rounded-lg border px-3 py-2 font-semibold ${
                  followingPhoneCanvas
                    ? 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100'
                    : 'border-emerald-400/30 hover:bg-emerald-500/20'
                }`}
                data-follow-phone-image="true"
                onClick={followPhoneCanvas}
                title="Open the phone-owned Image document. New Hane strokes continue appearing here as they arrive."
                type="button"
              >
                {followingPhoneCanvas ? 'Following Phone Canvas' : `Follow ${syncedImageDocumentTitle || 'Phone Canvas'}`}
              </button>
            ) : null}
            {nativeLinkActive ? (
              <button
                className="rounded-lg border border-emerald-400/30 px-3 py-2 font-semibold hover:bg-emerald-500/20 disabled:opacity-50"
                disabled={busy}
                onClick={() => void disconnect()}
                type="button"
              >
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : null}
          </div>
        </section>
      </details>
    );
  }

  return null;
}
