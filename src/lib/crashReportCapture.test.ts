import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  crashReportCaptureInstalled,
  installCrashReportCapture,
  recordRendererCrashReport,
} from './crashReportCapture';
import { useCrashReportStore } from '../store/crashReportStore';

const realRecordReport = useCrashReportStore.getState().recordReport;
const windowTarget = new EventTarget();

function dispatchErrorEvent(message: string, stack?: string): void {
  const event = new Event('error');
  (event as Event & { error?: Error }).error = Object.assign(new Error(message), stack ? { stack } : undefined);
  windowTarget.dispatchEvent(event);
}

function dispatchRejectionEvent(reason: unknown): void {
  const event = new Event('unhandledrejection');
  (event as Event & { reason?: unknown }).reason = reason;
  windowTarget.dispatchEvent(event);
}

describe('crash report capture', () => {
  let uninstall: () => void;

  beforeEach(() => {
    useCrashReportStore.setState({ reports: [], captureEnabled: false, recordReport: realRecordReport });
    uninstall = installCrashReportCapture(windowTarget as unknown as Window);
  });

  afterEach(() => {
    uninstall();
    delete (globalThis as { signalLoomNative?: unknown }).signalLoomNative;
  });

  it('installs exactly once and uninstalls cleanly', () => {
    expect(crashReportCaptureInstalled()).toBe(true);
    const secondUninstall = installCrashReportCapture();
    expect(crashReportCaptureInstalled()).toBe(true);

    dispatchErrorEvent('ignored double install');
    expect(useCrashReportStore.getState().reports).toHaveLength(0);

    secondUninstall();
    expect(crashReportCaptureInstalled()).toBe(true);
    uninstall();
    expect(crashReportCaptureInstalled()).toBe(false);
  });

  it('records uncaught errors only while capture is enabled', () => {
    dispatchErrorEvent('failure while disabled');
    expect(useCrashReportStore.getState().reports).toHaveLength(0);

    useCrashReportStore.setState({ captureEnabled: true });
    dispatchErrorEvent('uncaught boom', 'Error: uncaught boom\n    at job (app.mjs:1:1)');

    const reports = useCrashReportStore.getState().reports;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: 'renderer-unhandled-error', message: 'uncaught boom' });
    expect(reports[0]?.stack).toContain('at job (app.mjs:1:1)');
  });

  it('records unhandled rejections with the reason message', () => {
    useCrashReportStore.setState({ captureEnabled: true });
    dispatchRejectionEvent(new Error('async job failed'));

    expect(useCrashReportStore.getState().reports[0]).toMatchObject({
      kind: 'renderer-unhandled-rejection',
      message: 'async job failed',
    });
  });

  it('never lets a failure inside recording escape as a new capture loop', () => {
    useCrashReportStore.setState({ captureEnabled: true });
    const recordReport = vi.fn(() => {
      throw new Error('storage exploded during recording');
    });
    useCrashReportStore.setState({ recordReport });

    expect(() => dispatchErrorEvent('original failure')).not.toThrow();
    expect(recordReport).toHaveBeenCalledTimes(1);
  });

  it('mirrors records to the Electron main queue when the native bridge exists', async () => {
    const crashReportRecord = vi.fn().mockResolvedValue({ recorded: true });
    (globalThis as { signalLoomNative?: unknown }).signalLoomNative = { crashReportRecord };
    useCrashReportStore.setState({ captureEnabled: true });

    dispatchErrorEvent('mirrored failure');
    await Promise.resolve();

    expect(crashReportRecord).toHaveBeenCalledTimes(1);
    expect(crashReportRecord.mock.calls[0]?.[0]).toMatchObject({
      kind: 'renderer-unhandled-error',
      message: 'mirrored failure',
    });
  });

  it('exposes a direct recording helper for recovery boundaries', () => {
    useCrashReportStore.setState({ captureEnabled: true });

    const report = recordRendererCrashReport({
      kind: 'renderer-render',
      message: 'boundary failure',
      surface: 'Flow Canvas',
    });

    expect(report).toMatchObject({ kind: 'renderer-render', message: 'boundary failure', surface: 'Flow Canvas' });
    expect(useCrashReportStore.getState().reports[0]?.id).toBe(report?.id);
  });
});
