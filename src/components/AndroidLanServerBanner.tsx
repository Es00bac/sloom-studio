import { Share2, Wifi, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  isAndroidLanServerAvailable,
  OPEN_ANDROID_LAN_SERVER_EVENT,
  startAndroidLanServer,
  stopAndroidLanServer,
  type SignalLoomLanServerStatus,
} from '../lib/androidLanServer';
import { TeamReviewStatusPanel } from './TeamReviewStatusPanel';

import { useSettingsStore } from '../store/settingsStore';

/**
 * Quiet controller for the optional Android LAN server.
 *
 * Starting the service must not cover an artist's canvas with an implementation URL or PIN.
 * Status and enable/disable live in the existing mobile navigation control; connection details
 * appear only when the artist deliberately opens Sloom Link.
 */
export function AndroidLanServerBanner() {
  const [status, setStatus] = useState<SignalLoomLanServerStatus | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'shared' | 'failed'>('idle');
  const { providerSettings, setProviderSetting } = useSettingsStore();

  useEffect(() => {
    if (!isAndroidLanServerAvailable()) return;
    let cancelled = false;

    if (providerSettings.androidLanServerEnabled) {
      void startAndroidLanServer(
        undefined,
        providerSettings.androidLanServerPin,
      ).then((next) => {
        if (!cancelled) setStatus(next);
      });
    } else {
      void stopAndroidLanServer().then(() => {
        if (!cancelled) setStatus(null);
      });
    }

    return () => {
      cancelled = true;
    };
  }, [
    providerSettings.androidLanServerEnabled,
    providerSettings.androidLanServerPin,
  ]);

  useEffect(() => {
    if (!isAndroidLanServerAvailable()) return;
    const openPanel = () => {
      setShareStatus('idle');
      setPanelOpen(true);
    };
    window.addEventListener(OPEN_ANDROID_LAN_SERVER_EVENT, openPanel);
    return () => window.removeEventListener(OPEN_ANDROID_LAN_SERVER_EVENT, openPanel);
  }, []);

  if (!panelOpen) return null;

  const shareAddress = async () => {
    if (!status?.url) return;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({
          title: 'Sloom Studio browser workspace',
          text: 'Open Sloom Studio from this device',
          url: status.url,
        });
      } else {
        await navigator.clipboard.writeText(status.url);
      }
      setShareStatus('shared');
    } catch {
      setShareStatus('failed');
    }
  };

  return (
    <section
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5rem)] right-3 z-[410] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-3 rounded-2xl border border-cyan-400/35 bg-slate-950/97 p-3 text-xs text-cyan-100 shadow-2xl backdrop-blur"
      data-android-lan-server-panel="true"
    >
      <header className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-400/12 text-cyan-200">
            <Wifi aria-hidden="true" size={18} />
          </span>
          <span className="flex min-w-0 flex-col">
            <strong className="text-sm text-cyan-50">Serve to another screen</strong>
            <small className="text-cyan-200/65">
              {status?.running ? 'Ready on this network' : 'Starting…'}
            </small>
          </span>
        </span>
        <button
          aria-label="Close serving details"
          className="rounded-lg p-1.5 text-cyan-100/55 hover:bg-white/10 hover:text-white"
          onClick={() => setPanelOpen(false)}
          type="button"
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      {status?.running && status.url ? (
        <>
          {status.pin ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2.5">
              <span className="text-cyan-200/65">Pairing code</span>
              <code className="font-semibold tracking-[0.2em] text-cyan-50">{status.pin}</code>
            </div>
          ) : null}
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-300/40 bg-cyan-400/15 px-3 py-2 font-semibold text-cyan-50 hover:bg-cyan-400/25"
            onClick={() => void shareAddress()}
            type="button"
          >
            <Share2 aria-hidden="true" size={16} />
            {shareStatus === 'shared' ? 'Link ready to share' : 'Share browser link'}
          </button>
          {shareStatus === 'failed' ? (
            <span className="text-amber-200" role="status">Sharing was unavailable. Use the manual address below.</span>
          ) : null}
          <details
            className="rounded-xl border border-cyan-400/15 px-2.5"
            data-android-lan-manual-address="true"
          >
            <summary className="flex min-h-10 cursor-pointer items-center text-cyan-200/70">
              Manual browser address
            </summary>
            <code className="block break-all border-t border-cyan-400/15 py-2.5 text-cyan-50">
              {status.url}
            </code>
          </details>
          <TeamReviewStatusPanel />
          <button
            className="self-end rounded-lg border border-cyan-400/25 px-3 py-2 font-semibold text-cyan-100/75 hover:bg-cyan-500/15 hover:text-white"
            onClick={() => {
              setProviderSetting('androidLanServerEnabled', false);
              setPanelOpen(false);
            }}
            type="button"
          >
            Stop serving
          </button>
        </>
      ) : (
        <span className="rounded-xl border border-cyan-400/15 bg-cyan-400/5 px-3 py-2.5 text-cyan-100/70" role="status">
          Preparing the local connection…
        </span>
      )}
    </section>
  );
}
