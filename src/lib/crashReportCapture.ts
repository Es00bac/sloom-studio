import { useCrashReportStore } from '../store/crashReportStore';
import type { CrashReportInput, CrashReportRecord } from './crashReports';
import type { SignalLoomNativeBridge } from './nativeApp';

let installed = false;
let capturing = false;

export function crashReportCaptureInstalled(): boolean {
  return installed;
}

export function installCrashReportCapture(target: Window | undefined = getDefaultWindow()): () => void {
  if (!target || installed) return () => undefined;
  installed = true;

  const onError = (event: ErrorEvent) => {
    recordUncaughtError(event.error ?? event.message, event.filename);
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    recordUnhandledRejection(event.reason);
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onUnhandledRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onUnhandledRejection);
    installed = false;
  };
}

export function recordRendererCrashReport(input: CrashReportInput): CrashReportRecord | null {
  return safelyRecord(() => useCrashReportStore.getState().recordReport({
    platform: getRendererPlatform(),
    ...input,
  }));
}

function recordUncaughtError(error: unknown, filename: string | undefined): void {
  safelyRecord(() => useCrashReportStore.getState().recordReport({
    kind: 'renderer-unhandled-error',
    message: error instanceof Error ? error : String(error ?? 'Unknown uncaught error'),
    stack: error instanceof Error ? error.stack : undefined,
    surface: filename ? filename : undefined,
    platform: getRendererPlatform(),
  }));
}

function recordUnhandledRejection(reason: unknown): void {
  safelyRecord(() => useCrashReportStore.getState().recordReport({
    kind: 'renderer-unhandled-rejection',
    message: reason instanceof Error ? reason : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
    platform: getRendererPlatform(),
  }));
}

function safelyRecord(record: () => CrashReportRecord | null): CrashReportRecord | null {
  if (capturing) return null;
  capturing = true;
  try {
    const report = record();
    if (report) mirrorReportToNative(report);
    return report;
  } catch {
    return null;
  } finally {
    capturing = false;
  }
}

function mirrorReportToNative(report: CrashReportRecord): void {
  try {
    const bridge = getNativeBridge();
    void bridge?.crashReportRecord?.(report)?.catch?.(() => undefined);
  } catch {
    // The mirror is best-effort; the renderer queue remains the source of truth.
  }
}

function getNativeBridge(): SignalLoomNativeBridge | undefined {
  try {
    const scope = globalThis as typeof globalThis & { signalLoomNative?: SignalLoomNativeBridge };
    return typeof scope !== 'undefined' ? scope.signalLoomNative : undefined;
  } catch {
    return undefined;
  }
}

function getRendererPlatform(): string | undefined {
  try {
    const nav = globalThis.navigator;
    if (!nav) return undefined;
    const uaData = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    return uaData?.platform ?? nav.platform ?? undefined;
  } catch {
    return undefined;
  }
}

function getDefaultWindow(): Window | undefined {
  try {
    if (typeof globalThis === 'undefined') return undefined;
    const candidate = globalThis as unknown as { addEventListener?: unknown; removeEventListener?: unknown };
    return typeof candidate.addEventListener === 'function'
      ? (candidate as unknown as Window)
      : undefined;
  } catch {
    return undefined;
  }
}
