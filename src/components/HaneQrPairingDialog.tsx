import { LoaderCircle, QrCode, RefreshCw, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toDataURL } from 'qrcode';

import {
  beginHaneQrPairing,
  cancelHaneQrPairing,
  pollHaneQrPairing,
  type HaneQrInvitation,
} from '../lib/haneQrPairing';
import { connectNativePhoneHostFromQr } from '../lib/remoteHostClient';

interface HaneQrPairingDialogProps {
  onClose: () => void;
  onConnected: (deviceLabel: string) => void;
}

type DialogState = 'starting' | 'waiting' | 'connecting' | 'expired' | 'error';

const POLL_INTERVAL_MS = 400;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function HaneQrPairingDialog({
  onClose,
  onConnected,
}: HaneQrPairingDialogProps) {
  const [attempt, setAttempt] = useState(0);
  const [invitation, setInvitation] = useState<HaneQrInvitation | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [state, setState] = useState<DialogState>('starting');
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    let disposed = false;
    let invitationId = '';
    let consumed = false;

    const run = async () => {
      setInvitation(null);
      setQrImage('');
      setError(null);
      setState('starting');
      try {
        const nextInvitation = await beginHaneQrPairing();
        invitationId = nextInvitation.invitationId;
        const image = await toDataURL(nextInvitation.payload, {
          width: 360,
          margin: 3,
          errorCorrectionLevel: 'M',
          color: {
            dark: '#07111f',
            light: '#ffffff',
          },
        });
        if (disposed) return;
        setInvitation(nextInvitation);
        setQrImage(image);
        setState('waiting');

        while (!disposed) {
          await delay(POLL_INTERVAL_MS);
          if (disposed) return;
          const result = await pollHaneQrPairing(invitationId);
          if (result.status === 'pending') continue;
          if (result.status === 'expired') {
            setState('expired');
            return;
          }
          if (result.status === 'invalid') {
            setError(result.error);
            setState('error');
            return;
          }
          consumed = true;
          setState('connecting');
          const connected = await connectNativePhoneHostFromQr(result);
          if (disposed) return;
          if (!connected.ok) {
            setError(connected.error || 'Hane paired, but the live link could not start.');
            setState('error');
            return;
          }
          onConnected(result.haneDeviceLabel);
          return;
        }
      } catch (reason) {
        if (disposed) return;
        setError(reason instanceof Error ? reason.message : 'Could not create a Hane pairing QR.');
        setState('error');
      }
    };

    void run();
    return () => {
      disposed = true;
      if (invitationId && !consumed) void cancelHaneQrPairing(invitationId);
    };
  }, [attempt, onConnected]);

  useEffect(() => {
    if (!invitation || state !== 'waiting') {
      setSecondsLeft(0);
      return;
    }
    const update = () => {
      setSecondsLeft(Math.max(0, Math.ceil((invitation.expiresAt - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [invitation, state]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || state === 'connecting') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, state]);

  const retry = () => setAttempt((value) => value + 1);

  return (
    <div
      className="fixed inset-0 z-[650] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm"
      data-hane-qr-pairing-dialog="true"
    >
      <section
        aria-labelledby="hane-qr-pairing-title"
        aria-modal="true"
        className="theme-popover relative flex max-h-[96vh] w-full max-w-md flex-col overflow-auto rounded-2xl border border-cyan-400/30 bg-[#0b1220] p-4 text-slate-100 shadow-2xl sm:p-5"
        role="dialog"
      >
        <button
          aria-label="Close Hane QR pairing"
          className="absolute right-3 top-3 rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
          disabled={state === 'connecting'}
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>

        <div className="flex items-center gap-3 pr-9">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300">
            <QrCode aria-hidden="true" size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold" id="hane-qr-pairing-title">Scan with Hane</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Sloom Link → Scan QR
            </p>
          </div>
        </div>

        <div className="mt-4 flex min-h-60 items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-950/60 p-3">
          {state === 'starting' ? (
            <div className="flex flex-col items-center gap-3 text-sm text-slate-300" role="status">
              <LoaderCircle className="animate-spin text-cyan-300" size={28} />
              Creating a private local invitation…
            </div>
          ) : qrImage && (state === 'waiting' || state === 'connecting') ? (
            <div className="flex flex-col items-center gap-3">
              <img
                alt="QR code for pairing Hane with this Sloom Studio device"
                className={`aspect-square w-[min(68vw,300px)] max-w-full rounded-xl bg-white shadow-lg ${
                  state === 'connecting' ? 'opacity-35' : ''
                }`}
                draggable={false}
                src={qrImage}
              />
              {state === 'connecting' ? (
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-200" role="status">
                  <LoaderCircle className="animate-spin" size={17} /> Hane found — starting the live link…
                </span>
              ) : (
                <span className="text-xs font-medium text-slate-400" role="status">
                  Single use · expires in {secondsLeft} second{secondsLeft === 1 ? '' : 's'}
                </span>
              )}
            </div>
          ) : (
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <Smartphone aria-hidden="true" className="text-amber-300" size={30} />
              <p className="text-sm font-semibold text-slate-100">
                {state === 'expired' ? 'That QR expired before Hane connected.' : 'The pairing invitation could not be completed.'}
              </p>
              {error ? <p className="text-xs leading-relaxed text-amber-200">{error}</p> : null}
              <button
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/35 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20"
                onClick={retry}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={14} /> Show a new QR
              </button>
            </div>
          )}
        </div>

        <p className="mt-3 text-center text-[11px] text-slate-500">Private local connection · no account required</p>
      </section>
    </div>
  );
}
