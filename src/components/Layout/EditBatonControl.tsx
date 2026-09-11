import React from 'react';
import { Hand, Lock, MonitorSmartphone, Unlock } from 'lucide-react';

import { getLocalDeviceId } from '../../lib/deviceIdentity';
import {
  forceTakeEditBaton,
  releaseEditBaton,
  takeEditBaton,
  yieldEditBaton,
} from '../../lib/editLockSync';
import { isSimultaneousProjectSyncSession } from '../../lib/remoteHostClient';
import {
  deriveBatonAction,
  selectEditBaton,
  useEditLockStore,
  type BatonAction,
} from '../../store/editLockStore';

/**
 * The single cross-device edit-baton toggle (Stage 3, memory: cross-device-sync-baton-model). It reads
 * the mirrored baton, derives this device's standing with the pure {@link deriveBatonAction}, and fires
 * the matching facade call. It renders **nothing** in a normal single-device session (no baton), so it
 * is safe to mount unconditionally in the chrome. The actual read-only enforcement on the workspaces is
 * the sibling {@link EditBatonReadOnlyOverlay}; this is just the control to claim/hand off.
 */

const TONE_CLASSES: Record<BatonAction['tone'], string> = {
  emerald: 'border-emerald-300/40 bg-emerald-400/15 text-emerald-100 hover:border-emerald-100/70 hover:bg-emerald-300/25 hover:text-white',
  cyan: 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100 hover:border-cyan-100/70 hover:bg-cyan-300/25 hover:text-white',
  amber: 'border-amber-300/40 bg-amber-400/15 text-amber-100 hover:border-amber-100/70 hover:bg-amber-300/25 hover:text-white',
  rose: 'border-rose-300/45 bg-rose-400/15 text-rose-100 hover:border-rose-100/70 hover:bg-rose-300/25 hover:text-white',
  slate: 'border-slate-300/30 bg-slate-400/10 text-slate-100 hover:border-slate-100/55 hover:bg-slate-300/20 hover:text-white',
};

function ActionIcon({ kind, size }: { kind: BatonAction['kind']; size: number }) {
  switch (kind) {
    case 'release':
      return <Unlock size={size} />;
    case 'yield':
      return <Hand size={size} />;
    case 'force':
      return <Lock size={size} />;
    default:
      return <MonitorSmartphone size={size} />;
  }
}

export const EditBatonControl: React.FC<{ variant?: 'topbar' | 'mobile' }> = ({ variant = 'topbar' }) => {
  const lock = useEditLockStore((state) => state.lock);
  const deviceId = React.useMemo(() => getLocalDeviceId(), []);
  const baton = selectEditBaton(lock, deviceId);
  const isPendingHere = lock?.pending?.id === deviceId;
  const action = deriveBatonAction(baton, Boolean(isPendingHere));
  const [busy, setBusy] = React.useState(false);

  if (isSimultaneousProjectSyncSession()) return null;
  if (!action.showButton) return null;

  const runAction = async () => {
    setBusy(true);
    try {
      switch (action.kind) {
        case 'take':
          await takeEditBaton();
          break;
        case 'force':
          await forceTakeEditBaton();
          break;
        case 'yield':
          await yieldEditBaton();
          break;
        case 'release':
          await releaseEditBaton();
          break;
        default:
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'mobile') {
    return (
      <button
        className={`col-span-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:cursor-progress disabled:opacity-70 ${TONE_CLASSES[action.tone]}`}
        data-edit-baton-control="mobile"
        disabled={busy}
        onClick={() => void runAction()}
        title={`${action.status} — ${action.label}`}
        type="button"
      >
        <ActionIcon kind={action.kind} size={16} />
        <span className="truncate">{action.label}</span>
        <span className="text-[11px] font-medium opacity-70">· {action.status}</span>
      </button>
    );
  }

  return (
    <button
      className={`pointer-events-auto inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors disabled:cursor-progress disabled:opacity-70 ${TONE_CLASSES[action.tone]}`}
      data-edit-baton-control="topbar"
      data-edit-baton-kind={action.kind}
      disabled={busy}
      onClick={() => void runAction()}
      title={`${action.status} — ${action.label}`}
      type="button"
    >
      <ActionIcon kind={action.kind} size={15} />
      <span className="hidden truncate min-[1500px]:inline">{action.label}</span>
      <span className="hidden text-[11px] font-medium opacity-70 min-[2000px]:inline">· {action.status}</span>
    </button>
  );
};
