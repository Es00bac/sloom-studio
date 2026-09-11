import React from 'react';
import { Download, LoaderCircle, Trash2 } from 'lucide-react';
import { Section } from './SettingsInputs';
import { useCrashReportStore } from '../../store/crashReportStore';
import {
  formatCrashReportsExportText,
  mergeCrashReports,
  type CrashReportRecord,
} from '../../lib/crashReports';
import { downloadTextFileWithOutcome } from '../../shared/files/downloads';
import type { NativeCrashReportState } from '../../lib/nativeApp';

export function CrashReportsSection() {
  const reports = useCrashReportStore((state) => state.reports);
  const captureEnabled = useCrashReportStore((state) => state.captureEnabled);
  const setCaptureEnabled = useCrashReportStore((state) => state.setCaptureEnabled);
  const clearReports = useCrashReportStore((state) => state.clearReports);

  const [nativeState, setNativeState] = React.useState<NativeCrashReportState | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'export' | 'clear' | null>(null);

  const nativeStateBridge = typeof window !== 'undefined' ? window.signalLoomNative?.crashReportState : undefined;
  const nativeSetEnabledBridge = typeof window !== 'undefined' ? window.signalLoomNative?.crashReportSetEnabled : undefined;
  const nativeClearBridge = typeof window !== 'undefined' ? window.signalLoomNative?.crashReportClear : undefined;

  React.useEffect(() => {
    if (!nativeStateBridge) return;
    let cancelled = false;
    void nativeStateBridge().then((state) => {
      if (!cancelled) setNativeState(state ?? null);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [nativeStateBridge, captureEnabled, reports.length]);

  const allReports = React.useMemo(
    () => mergeCrashReports(reports, nativeState?.reports ?? []),
    [reports, nativeState],
  );

  const onToggleCapture = (enabled: boolean) => {
    setCaptureEnabled(enabled);
    if (nativeSetEnabledBridge) {
      void nativeSetEnabledBridge(enabled).catch(() => undefined);
    }
    setStatus(enabled
      ? 'Crash capture is on. Reports stay on this device and are never transmitted.'
      : 'Crash capture is off. No new crash reports are recorded.');
  };

  const onExport = async () => {
    setBusy('export');
    setStatus(null);
    try {
      const text = formatCrashReportsExportText(allReports, {
        exportedAt: Date.now(),
        reportCount: allReports.length,
        captureEnabled,
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outcome = await downloadTextFileWithOutcome(
        `sloom-crash-reports-${stamp}.json`,
        text,
        'application/json',
      );
      setStatus(outcome.status === 'failed'
        ? `Export failed: ${outcome.error}`
        : outcome.status === 'saved'
          ? `Exported ${allReports.length} report${allReports.length === 1 ? '' : 's'} to ${outcome.location}.`
          : `Export started for ${allReports.length} report${allReports.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const onClearConfirmed = async () => {
    setConfirmClear(false);
    setBusy('clear');
    setStatus(null);
    try {
      clearReports();
      if (nativeClearBridge) {
        const result = await nativeClearBridge();
        setNativeState((previous) => previous ? { ...previous, reports: [], pendingMinidumpCount: 0 } : previous);
        setStatus(result
          ? result.ok
            ? `Cleared local crash reports${result.minidumpsRemoved > 0 ? ` and ${result.minidumpsRemoved} minidump${result.minidumpsRemoved === 1 ? '' : 's'}` : ''}.`
            : `Cleared in-memory reports, but persisted clearing failed: ${result.persistError ?? 'unknown error'}`
          : 'Cleared local crash reports.');
        return;
      }
      setStatus('Cleared local crash reports.');
    } catch (error) {
      setStatus(`Clear failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Crash Reports">
      <p className="text-sm text-gray-400">
        Optional, privacy-first diagnostics. When enabled, Sloom Studio keeps a bounded local
        queue of crash reports (renderer, main process, and native minidumps on desktop).
        Secrets and credentials are structurally redacted before anything is stored, reports
        never leave this device, and no third-party crash service is used.
      </p>

      <label className="flex items-center gap-3 text-sm text-gray-200">
        <input
          aria-label="Enable local crash reporting"
          checked={captureEnabled}
          data-testid="crash-report-capture-toggle"
          onChange={(event) => onToggleCapture(event.target.checked)}
          type="checkbox"
        />
        <span>
          Enable local crash reporting
          {nativeState ? (
            <span className="ml-2 text-xs text-gray-500">
              (desktop queue {nativeState.enabled ? 'on' : 'off'}
              {nativeState.pendingMinidumpCount > 0
                ? `, ${nativeState.pendingMinidumpCount} pending minidump${nativeState.pendingMinidumpCount === 1 ? '' : 's'}`
                : ''}
              )
            </span>
          ) : null}
        </span>
      </label>

      {nativeState?.crashDumpsPath ? (
        <p className="text-xs text-gray-500">
          Native minidumps (no upload, local only) are written under {nativeState.crashDumpsPath}.
          Disabling capture stops new minidumps after the next app restart.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-[#111217]/60 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-50"
          disabled={busy !== null || allReports.length === 0}
          name="crash-report-export"
          onClick={() => void onExport()}
          type="button"
        >
          {busy === 'export' ? <LoaderCircle className="animate-spin" size={13} /> : <Download size={13} />}
          Export {allReports.length} report{allReports.length === 1 ? '' : 's'} (JSON)
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-[#111217]/60 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:opacity-50"
          disabled={busy !== null || (allReports.length === 0 && !nativeState)}
          name="crash-report-clear"
          onClick={() => setConfirmClear((value) => !value)}
          type="button"
        >
          {busy === 'clear' ? <LoaderCircle className="animate-spin" size={13} /> : <Trash2 size={13} />}
          Clear local crash reports
        </button>
      </div>

      {confirmClear ? (
        <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-3">
          <p className="text-xs text-amber-50">
            This permanently deletes every locally stored crash report and pending minidump on this
            device. Nothing is transmitted. This cannot be undone.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-md border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-50 hover:bg-amber-300/20"
              name="crash-report-clear-confirm"
              onClick={() => void onClearConfirmed()}
              type="button"
            >
              Delete crash reports
            </button>
            <button
              className="rounded-md border border-gray-600 bg-[#111217]/60 px-3 py-2 text-xs font-semibold text-gray-200 hover:border-gray-400"
              name="crash-report-clear-cancel"
              onClick={() => setConfirmClear(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {status ? <p className="text-xs text-cyan-100/80" role="status">{status}</p> : null}

      {allReports.length === 0 ? (
        <p className="text-sm text-gray-500">
          {captureEnabled
            ? 'No crashes recorded yet. When something fails, a redacted report will appear here.'
            : 'Crash capture is off, so nothing is recorded.'}
        </p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-gray-800 bg-[#0b1018] p-3">
          {allReports.map((report) => <CrashReportRow key={report.id} report={report} />)}
        </div>
      )}
    </Section>
  );
}

function CrashReportRow({ report }: { report: CrashReportRecord }) {
  const when = new Date(report.timestamp).toISOString();
  return (
    <details className="rounded border border-gray-800 bg-black/20">
      <summary className="cursor-pointer select-none p-2 text-sm text-gray-200">
        <span className="font-mono text-xs text-gray-400">{when}</span>
        <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-300">{report.kind}</span>
        <span className="ml-2">{report.message.slice(0, 120)}</span>
        {report.occurrenceCount && report.occurrenceCount > 1 ? (
          <span className="ml-2 text-xs text-amber-200/80">×{report.occurrenceCount}</span>
        ) : null}
      </summary>
      <div className="space-y-2 p-2 pt-0">
        {report.surface ? <p className="text-xs text-gray-500">Surface: {report.surface}</p> : null}
        {report.detail ? <p className="text-xs text-gray-500">Detail: {report.detail}</p> : null}
        {report.platform ? <p className="text-xs text-gray-500">Platform: {report.platform}</p> : null}
        {report.appVersion ? <p className="text-xs text-gray-500">App version: {report.appVersion}</p> : null}
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-gray-800 bg-black/30 p-2 text-[11px] leading-snug text-gray-400">
          {report.stack ?? report.componentStack ?? 'No stack captured.'}
        </pre>
      </div>
    </details>
  );
}
