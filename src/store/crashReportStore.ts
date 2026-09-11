import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
  appendCrashReport,
  createCrashReport,
  CRASH_REPORT_QUEUE_LIMIT,
  sanitizeCrashReportQueue,
  type CrashReportInput,
  type CrashReportRecord,
} from '../lib/crashReports';

export const CRASH_REPORT_STORAGE_KEY = 'signal-loom-crash-reports';
export const CRASH_REPORT_BROADCAST_CHANNEL = 'signal-loom-crash-reports-events';

export type CrashReportBroadcastMessage =
  | { type: 'report'; report: CrashReportRecord }
  | { type: 'clear' }
  | { type: 'enabled'; enabled: boolean };

interface CrashReportState {
  reports: CrashReportRecord[];
  captureEnabled: boolean;
  recordReport: (input: CrashReportInput) => CrashReportRecord | null;
  mergeReports: (reports: CrashReportRecord[]) => void;
  setCaptureEnabled: (enabled: boolean, options?: { broadcast?: boolean }) => void;
  clearReports: (options?: { broadcast?: boolean }) => void;
}

export const useCrashReportStore = create<CrashReportState>()(
  persist(
    (set, get) => ({
      reports: [],
      captureEnabled: false,
      recordReport: (input) => {
        if (!get().captureEnabled) return null;
        const report = createCrashReport(input);
        set((state) => ({ reports: appendCrashReport(state.reports, report) }));
        postCrashReportMessage({ type: 'report', report });
        return report;
      },
      mergeReports: (reports) => {
        if (!Array.isArray(reports) || reports.length === 0) return;
        const sanitized = sanitizeCrashReportQueue(reports);
        if (sanitized.length === 0) return;
        set((state) => ({
          reports: sanitizeCrashReportQueue(
            [...sanitized, ...state.reports],
            CRASH_REPORT_QUEUE_LIMIT,
          ),
        }));
      },
      setCaptureEnabled: (enabled, options = {}) => {
        set({ captureEnabled: enabled });
        if (options.broadcast !== false) {
          postCrashReportMessage({ type: 'enabled', enabled });
        }
      },
      clearReports: (options = {}) => {
        set({ reports: [] });
        if (options.broadcast !== false) {
          postCrashReportMessage({ type: 'clear' });
        }
      },
    }),
    {
      name: CRASH_REPORT_STORAGE_KEY,
      storage: createJSONStorage(getCrashReportStorage),
      partialize: (state) => ({ reports: state.reports, captureEnabled: state.captureEnabled }),
      merge: (persisted, current) => ({
        ...current,
        captureEnabled: (persisted as Partial<CrashReportState> | undefined)?.captureEnabled === true,
        reports: sanitizeCrashReportQueue(
          (persisted as Partial<CrashReportState> | undefined)?.reports,
        ),
      }),
    },
  ),
);

export function getCrashReportBroadcastMessage(value: unknown): CrashReportBroadcastMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === 'clear') return { type: 'clear' };
  if (value.type === 'enabled' && typeof value.enabled === 'boolean') {
    return { type: 'enabled', enabled: value.enabled };
  }
  if (value.type === 'report' || value.type === 'event') {
    const report = sanitizeCrashReportQueue([value.report])[0];
    return report ? { type: 'report', report } : undefined;
  }
  return undefined;
}

export function installCrashReportBroadcastListener(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;

  const channel = new BroadcastChannel(CRASH_REPORT_BROADCAST_CHANNEL);
  channel.onmessage = (event) => {
    const message = getCrashReportBroadcastMessage(event.data);
    if (!message) return;
    const store = useCrashReportStore.getState();
    if (message.type === 'clear') {
      store.clearReports({ broadcast: false });
    } else if (message.type === 'enabled') {
      store.setCaptureEnabled(message.enabled, { broadcast: false });
    } else {
      store.mergeReports([message.report]);
    }
  };

  return () => {
    channel.close();
  };
}

function postCrashReportMessage(message: CrashReportBroadcastMessage): boolean {
  if (typeof BroadcastChannel === 'undefined') return false;
  try {
    const channel = new BroadcastChannel(CRASH_REPORT_BROADCAST_CHANNEL);
    channel.postMessage(message);
    channel.close();
    return true;
  } catch {
    return false;
  }
}

const memoryStorage = new Map<string, string>();

function getCrashReportStorage(): StateStorage {
  let browserStorage: Storage | undefined;
  try {
    browserStorage = typeof globalThis === 'undefined' ? undefined : globalThis.localStorage;
  } catch {
    browserStorage = undefined;
  }

  if (
    browserStorage &&
    typeof browserStorage.getItem === 'function' &&
    typeof browserStorage.setItem === 'function' &&
    typeof browserStorage.removeItem === 'function'
  ) {
    return {
      getItem: (name) => {
        try {
          return browserStorage.getItem(name);
        } catch {
          return null;
        }
      },
      setItem: (name, value) => {
        try {
          browserStorage.setItem(name, value);
        } catch {
          // Storage can be full or unavailable; crash reporting must never throw.
        }
      },
      removeItem: (name) => {
        try {
          browserStorage.removeItem(name);
        } catch {
          // Ignore unavailable storage.
        }
      },
    };
  }

  return {
    getItem: (name) => memoryStorage.get(name) ?? null,
    setItem: (name, value) => {
      memoryStorage.set(name, value);
    },
    removeItem: (name) => {
      memoryStorage.delete(name);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
