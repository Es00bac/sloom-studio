import { AlertTriangle, FileSearch, FolderOpen, History, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { NativeStartupProjectRecovery } from '../../lib/nativeApp';
import type { StartupProjectRecoveryAction } from '../../lib/startupProjectRecovery';

interface StartupProjectRecoveryDialogProps {
  recovery: NativeStartupProjectRecovery;
  busyAction?: StartupProjectRecoveryAction;
  onAction: (action: StartupProjectRecoveryAction, backupPath?: string) => void;
}

const failureLabels: Record<NativeStartupProjectRecovery['failure']['code'], string> = {
  missing: 'The remembered project is not currently available.',
  unreadable: 'The remembered project could not be read.',
  corrupt: 'The remembered project contains invalid JSON.',
  'invalid-project': 'The remembered file is not a valid Sloom Studio project.',
  'preparation-failed': 'The remembered project could not be prepared for opening.',
};

export function StartupProjectRecoveryDialog({
  recovery,
  busyAction,
  onAction,
}: StartupProjectRecoveryDialogProps) {
  const [requestedBackupPath, setRequestedBackupPath] = useState(recovery.backups[0]?.filePath ?? '');
  const backupPath = recovery.backups.some((backup) => backup.filePath === requestedBackupPath)
    ? requestedBackupPath
    : recovery.backups[0]?.filePath ?? '';
  const busy = Boolean(busyAction);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      onAction('continue-blank');
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [busy, onAction]);

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
      <section
        aria-describedby="startup-project-recovery-message"
        aria-labelledby="startup-project-recovery-title"
        aria-modal="true"
        className="theme-popover flex w-full max-w-2xl flex-col gap-5 rounded-xl border border-amber-400/25 bg-[#13161f] p-6 shadow-2xl"
        role="alertdialog"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
            <AlertTriangle aria-hidden="true" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-gray-100" id="startup-project-recovery-title">
              The remembered project did not open
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-300" id="startup-project-recovery-message">
              {failureLabels[recovery.failure.code]} The blank workspace is open and safe to use while you choose what to do.
            </p>
            <p className="mt-3 break-all rounded-md border border-gray-700/70 bg-black/20 px-3 py-2 font-mono text-xs text-gray-300">
              {recovery.filePath}
            </p>
            <p aria-live="polite" className="mt-2 text-xs text-amber-200" role="status">
              {recovery.failure.message}
            </p>
          </div>
        </div>

        {recovery.backups.length > 0 ? (
          <label className="flex flex-col gap-2 text-xs font-medium text-gray-300">
            Available project backup
            <select
              className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100"
              disabled={busy}
              onChange={(event) => setRequestedBackupPath(event.currentTarget.value)}
              value={backupPath}
            >
              {recovery.backups.map((backup) => (
                <option key={backup.filePath} value={backup.filePath}>
                  {backup.filePath.split(/[\\/]/).pop()} — {new Date(backup.modifiedAtMs).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="rounded-lg border border-gray-800 bg-black/15 px-3 py-2 text-xs text-gray-400">
            No matching project backups were found beside the remembered file.
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-800/70 pt-4">
          <button
            autoFocus
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
            disabled={busy}
            onClick={() => onAction('continue-blank')}
            type="button"
          >
            <FileSearch aria-hidden="true" size={14} /> Continue Blank
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/40 px-4 py-2 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-50"
            disabled={busy}
            onClick={() => onAction('open-another')}
            type="button"
          >
            <FolderOpen aria-hidden="true" size={14} /> {busyAction === 'open-another' ? 'Opening…' : 'Open Another'}
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/20 disabled:opacity-50"
            disabled={busy || !backupPath}
            onClick={() => onAction('recover-backup', backupPath)}
            type="button"
          >
            <History aria-hidden="true" size={14} /> {busyAction === 'recover-backup' ? 'Recovering…' : 'Recover Backup'}
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-progress disabled:opacity-60"
            disabled={busy}
            onClick={() => onAction('retry')}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={14} /> {busyAction === 'retry' ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      </section>
    </div>
  );
}
