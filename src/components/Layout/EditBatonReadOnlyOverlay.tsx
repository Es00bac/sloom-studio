import React from 'react';
import { Lock, MonitorSmartphone } from 'lucide-react';

import { getLocalDeviceId } from '../../lib/deviceIdentity';
import { forceTakeEditBaton, takeEditBaton } from '../../lib/editLockSync';
import { isSimultaneousProjectSyncSession } from '../../lib/remoteHostClient';
import { deriveBatonAction, selectEditBaton, useEditLockStore } from '../../store/editLockStore';

/**
 * Read-only shield for the active workspace when ANOTHER device holds the cross-device edit baton
 * (Stage 3, memory: cross-device-sync-baton-model). It intercepts pointer events over the workspace
 * surface so a read-only device can't damage the file the other device is editing — the file only
 * transfers by snapshot on handoff (Stage 4), so live edits here would diverge. The backdrop is kept
 * faint so the current content stays visible; a single card explains who's editing and offers takeover
 * (which escalates to a force-claim once this device has been queued past the grace window).
 *
 * Renders nothing unless this device is specifically read-only — a normal single-device session, a free
 * baton, or holding the baton here all pass through untouched.
 */
export const EditBatonReadOnlyOverlay: React.FC = () => {
  const lock = useEditLockStore((state) => state.lock);
  const deviceId = React.useMemo(() => getLocalDeviceId(), []);
  const baton = selectEditBaton(lock, deviceId);
  const isPendingHere = lock?.pending?.id === deviceId;
  const action = deriveBatonAction(baton, Boolean(isPendingHere));
  const [busy, setBusy] = React.useState(false);

  // Current phone links use one host-ordered mutation log, so both screens remain interactive. Keep
  // this legacy shield only when an older phone explicitly lacks the simultaneous capability.
  if (isSimultaneousProjectSyncSession()) return null;
  if (!baton.isReadOnly) return null;

  const takeOver = async () => {
    setBusy(true);
    try {
      if (action.kind === 'force') {
        await forceTakeEditBaton();
      } else {
        await takeEditBaton();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-[#05080d]/35 backdrop-blur-[1px]"
      data-edit-baton-readonly-overlay="true"
      // Swallow every pointer interaction so no edit reaches the workspace beneath.
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      role="status"
    >
      <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-cyan-300/20 bg-[#0c1422]/95 px-6 py-5 text-center shadow-[0_18px_50px_rgba(0,0,0,0.5)]">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-amber-300/30 bg-amber-400/10 text-amber-100">
          <Lock size={20} />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-cyan-50">
            {baton.holderLabel ?? 'Another device'} is editing
          </p>
          <p className="text-xs leading-relaxed text-cyan-100/55">
            This workspace is read-only until you take over. Changes transfer when you do — nothing is lost.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-400/15 px-4 py-2 text-sm font-semibold text-cyan-50 transition-colors hover:border-cyan-100/70 hover:bg-cyan-300/25 hover:text-white disabled:cursor-progress disabled:opacity-70"
          data-edit-baton-takeover={action.kind}
          disabled={busy}
          onClick={() => void takeOver()}
          type="button"
        >
          <MonitorSmartphone size={16} />
          {action.kind === 'force' ? 'Force takeover' : 'Take over here'}
        </button>
        {isPendingHere && action.kind === 'force' ? (
          <p className="text-[11px] text-rose-200/70">
            Takeover requested — the other device hasn’t responded. Forcing it claims the baton now.
          </p>
        ) : null}
      </div>
    </div>
  );
};
