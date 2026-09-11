import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  CRASH_REPORT_QUEUE_LIMIT,
  redactText,
  createCrashReportFileStore,
  createCrashReportController,
  createCrashReportRecord,
} = require('../../electron/crashReports.cjs') as {
  CRASH_REPORT_QUEUE_LIMIT: number;
  redactText: (text: string) => string;
  createCrashReportRecord: (input: Record<string, unknown>, now: number) => { message: string };
  createCrashReportFileStore: (options: {
    directoryPath: string;
    fs: Record<string, (...args: never[]) => unknown>;
    now?: () => number;
  }) => {
    queueFilePath: string;
    settingsFilePath: string;
    loadReports: () => unknown[];
    persistReports: (reports: unknown[]) => { ok: boolean; error?: string };
    loadEnabled: () => boolean;
    persistEnabled: (enabled: boolean) => { ok: boolean; error?: string };
  };
  createCrashReportController: (options: Record<string, unknown>) => {
    append: (kind: string, message: unknown, extra?: Record<string, unknown>) => unknown;
    setEnabled: (enabled: boolean) => { enabled: boolean; persistResult: { ok: boolean; error?: string } };
    getEnabled: () => boolean;
    installProcessCapture: () => () => void;
    attachWebContentsCapture: (webContents: unknown, surface: string) => () => void;
    attachChildProcessCapture: (appLike: unknown) => () => void;
    recordRendererReport: (payload: unknown) => { recorded: boolean; reason?: string; report?: unknown };
    clearReports: () => { ok: boolean; persistError?: string; minidumpsRemoved: number; minidumpError?: string };
    getState: () => {
      enabled: boolean;
      reports: unknown[];
      nativeReporterStarted: boolean;
      crashDumpsPath?: string;
      pendingMinidumpCount: number;
    };
  };
};

const realFs = {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync: (from: string, to: string) => {
    const { renameSync } = require('node:fs') as { renameSync: (from: string, to: string) => void };
    renameSync(from, to);
  },
  unlinkSync: (path: string) => {
    const { unlinkSync } = require('node:fs') as { unlinkSync: (path: string) => void };
    unlinkSync(path);
  },
  readdirSync,
};

const tempRoots: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function readJson(filePath: string): any {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('electron crash report redaction parity', () => {
  it('removes credentials exactly like the renderer redactor', () => {
    const redacted = redactText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y at https://a.io/x?token=hunter2');

    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9.x.y');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).toContain('[redacted]');
  });

  it('redacts bare secret-named keys with double-quoted values, including short realistic provider keys', () => {
    const redacted = redactText([
      'api_key: "nv-9876543210abcdef"',
      'password: "hunter2"',
      'api_key: "AIzaSyB1234567890abcdefghijklmnopqrstu"',
    ].join('\n'));

    expect(redacted).not.toContain('nv-9876543210abcdef');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('AIzaSyB1234567890abcdefghijklmnopqrstu');
    expect(redacted.match(/api_key: \[redacted\]/g)?.length).toBe(2);
    expect(redacted).toContain('password: [redacted]');
  });

  it('redacts single-quoted and truncated quoted secret values while JSON-quoted keys still route through the field pass', () => {
    const redacted = redactText([
      '{"api_key": "json-secret-1"}',
      "client_secret: 'single-quoted-secret'",
      'refresh_token: "cut-off-value',
    ].join('\n'));

    expect(redacted).not.toContain('json-secret-1');
    expect(redacted).not.toContain('single-quoted-secret');
    expect(redacted).not.toContain('cut-off-value');
    expect(redacted).toContain('client_secret: [redacted]');
    expect(redacted).toContain('refresh_token: [redacted]');
  });

  it('redacts a secret value framed by escaped quotes inside a serialized error body', () => {
    const providerKey = 'AIzaSyB1234567890abcdefghijklmnopqrstu';
    const redacted = redactText(
      String.raw`{"error": "api_key: \"${providerKey}\" is invalid"}`,
    );

    expect(redacted).not.toContain(providerKey);
    expect(redacted).toContain('api_key: [redacted] is invalid');
    expect(() => JSON.parse(redacted)).not.toThrow();
  });

  it('redacts a doubly serialized escaped-quote value through the public record path', () => {
    const providerKey = 'AIzaSyB1234567890abcdefghijklmnopqrstu';
    const report = createCrashReportRecord({
      kind: 'main-unhandled-rejection',
      message: {
        responseBody: String.raw`{"error": "api_key: \\"${providerKey}\\" is invalid"}`,
      },
    }, 1_000);

    expect(report.message).not.toContain(providerKey);
    expect(report.message).toContain('api_key: [redacted] is invalid');
    expect(() => JSON.parse(report.message)).not.toThrow();
  });

  it('redacts escaped secret keys in nested JSON response strings through the public record path', () => {
    const providerKey = 'AIzaSyB1234567890abcdefghijklmnopqrstu';
    const bearerToken = 'bearer-credential-123456789';
    for (const serializationDepth of [1, 2, 3]) {
      let responseBody: unknown = {
        api_key: providerKey,
        authorization: `Bearer ${bearerToken}`,
        signature: 123456,
      };
      for (let depth = 0; depth < serializationDepth; depth += 1) {
        responseBody = JSON.stringify(responseBody);
      }
      const report = createCrashReportRecord({
        kind: 'main-unhandled-rejection',
        message: { error: 'Request failed', responses: [responseBody] },
      }, 1_000);

      expect(report.message).not.toContain(providerKey);
      expect(report.message).not.toContain(bearerToken);
      const outer = JSON.parse(report.message) as { responses: unknown[] };
      let decoded = outer.responses[0];
      for (let depth = 0; depth < serializationDepth; depth += 1) {
        decoded = JSON.parse(String(decoded));
      }
      expect(decoded).toEqual({
        api_key: '[redacted]',
        authorization: '[redacted]',
        signature: '[redacted]',
      });
    }
  });
});

describe('crash report file store', () => {
  it('persists the queue atomically and reloads it across controller restarts', () => {
    const dir = makeTempDir('sloom-crash-store-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    const controller = createCrashReportController({ store, fs: realFs, now: () => 1_000 });

    controller.setEnabled(true);
    controller.append('main-uncaught-exception', 'first crash');
    controller.append('main-unhandled-rejection', 'second crash');

    const reloaded = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    expect(reloaded.loadEnabled()).toBe(true);
    const reports = reloaded.loadReports() as Array<{ message: string }>;
    expect(reports.map((report) => report.message)).toEqual(['second crash', 'first crash']);
  });

  it('quarantines a corrupted queue file and starts empty instead of failing', () => {
    const dir = makeTempDir('sloom-crash-corrupt-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    writeFileSync(store.queueFilePath, '{not json at all', 'utf8');

    const reports = store.loadReports();

    expect(reports).toEqual([]);
    const quarantined = readdirSync(dir).filter((name) => name.includes('corrupt-'));
    expect(quarantined).toHaveLength(1);
  });

  it('tolerates a failing filesystem without throwing', () => {
    const dir = makeTempDir('sloom-crash-failfs-');
    const brokenFs = {
      ...realFs,
      mkdirSync: () => {
        throw new Error('disk unavailable');
      },
      writeFileSync: () => {
        throw new Error('disk full');
      },
    };
    const store = createCrashReportFileStore({ directoryPath: dir, fs: brokenFs });
    const controller = createCrashReportController({ store, fs: brokenFs, now: () => 2_000 });

    controller.setEnabled(true);
    const record = controller.append('main-uncaught-exception', 'crash on a broken disk');

    expect(record).toMatchObject({ message: 'crash on a broken disk' });
    expect(existsSync(store.queueFilePath)).toBe(false);
  });
});

describe('crash report controller', () => {
  it('records main-process uncaught exceptions and rethrows to preserve crash semantics', () => {
    const dir = makeTempDir('sloom-crash-main-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    const fakeProcess = new EventEmitter();
    const controller = createCrashReportController({ store, fs: realFs, targetProcess: fakeProcess, now: () => 3_000 });
    controller.setEnabled(true);
    controller.installProcessCapture();

    const crash = new Error('main exploded');
    expect(() => fakeProcess.emit('uncaughtException', crash)).toThrow(crash);

    const reports = store.loadReports() as Array<{ kind: string; message: string }>;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: 'main-uncaught-exception', message: 'main exploded' });
  });

  it('records unhandled rejections without rethrowing and records nothing while disabled', () => {
    const dir = makeTempDir('sloom-crash-rejection-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    const fakeProcess = new EventEmitter();
    const controller = createCrashReportController({ store, fs: realFs, targetProcess: fakeProcess, now: () => 4_000 });
    controller.installProcessCapture();

    expect(() => fakeProcess.emit('unhandledRejection', new Error('quiet rejection'))).not.toThrow();
    expect(store.loadReports()).toEqual([]);

    controller.setEnabled(true);
    fakeProcess.emit('unhandledRejection', new Error('loud rejection'));
    const reports = store.loadReports() as Array<{ kind: string; message: string }>;
    expect(reports[0]).toMatchObject({ kind: 'main-unhandled-rejection', message: 'loud rejection' });
  });

  it('records renderer-process-gone with the crash reason and surface', () => {
    const dir = makeTempDir('sloom-crash-rendergone-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    const controller = createCrashReportController({ store, fs: realFs, now: () => 5_000 });
    controller.setEnabled(true);

    const webContents = new EventEmitter();
    controller.attachWebContentsCapture(webContents, 'flow');
    webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 5 });

    const reports = store.loadReports() as Array<{ kind: string; surface: string; detail: string }>;
    expect(reports[0]).toMatchObject({
      kind: 'renderer-process-gone',
      surface: 'flow',
      detail: 'reason=oom exitCode=5',
    });
  });

  it('records child-process-gone through the app event surface', () => {
    const dir = makeTempDir('sloom-crash-child-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    const fakeApp = new EventEmitter();
    const controller = createCrashReportController({ store, fs: realFs, now: () => 6_000 });
    controller.setEnabled(true);
    controller.attachChildProcessCapture(fakeApp);

    fakeApp.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 139, name: '' });

    const reports = store.loadReports() as Array<{ kind: string; detail: string }>;
    expect(reports[0]).toMatchObject({ kind: 'child-process-gone', detail: 'type=GPU reason=crashed exitCode=139 name=' });
  });

  it('sanitizes and re-redacts untrusted renderer mirrors and rejects main-side kinds', () => {
    const dir = makeTempDir('sloom-crash-mirror-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    const controller = createCrashReportController({ store, fs: realFs, now: () => 7_000 });
    controller.setEnabled(true);

    const accepted = controller.recordRendererReport({
      id: 'from-renderer-1',
      timestamp: 7_100,
      kind: 'renderer-render',
      message: 'Boundary hit after Bearer abcdef123456789012345678 leaked',
      stack: 'Error: Boundary hit\n    at /home/eve/app.js:1:1',
    });
    const rejectedKind = controller.recordRendererReport({
      id: 'forged-1',
      timestamp: 7_200,
      kind: 'main-uncaught-exception',
      message: 'forged main crash',
    });
    const rejectedShape = controller.recordRendererReport('nonsense');

    expect(accepted.recorded).toBe(true);
    expect((accepted.report as { message: string }).message).not.toContain('abcdef123456789012345678');
    expect((accepted.report as { stack: string }).stack).toContain('/home/[redacted]/app.js');
    expect(rejectedKind).toMatchObject({ recorded: false, reason: 'invalid-report' });
    expect(rejectedShape).toMatchObject({ recorded: false, reason: 'invalid-report' });
  });

  it('mirrors nothing while capture is disabled', () => {
    const dir = makeTempDir('sloom-crash-mirror-off-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    const controller = createCrashReportController({ store, fs: realFs, now: () => 8_000 });

    const result = controller.recordRendererReport({
      id: 'r1',
      timestamp: 8_100,
      kind: 'renderer-render',
      message: 'quiet failure',
    });

    expect(result).toMatchObject({ recorded: false, reason: 'capture-disabled' });
    expect(store.loadReports()).toEqual([]);
  });

  it('bounds the queue to the shared limit', () => {
    const dir = makeTempDir('sloom-crash-bound-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    const controller = createCrashReportController({ store, fs: realFs, now: () => 9_000 });
    controller.setEnabled(true);

    for (let index = 0; index < CRASH_REPORT_QUEUE_LIMIT + 10; index += 1) {
      controller.append('main-uncaught-exception', `failure ${index}`);
    }

    const reports = store.loadReports() as Array<{ message: string }>;
    expect(reports).toHaveLength(CRASH_REPORT_QUEUE_LIMIT);
    expect(reports[0]?.message).toBe(`failure ${CRASH_REPORT_QUEUE_LIMIT + 9}`);
  });

  it('starts the native crash reporter only when enabled and never uploads', () => {
    const dir = makeTempDir('sloom-crash-native-');
    const store = createCrashReportFileStore({ directoryPath: dir, fs: realFs });
    const startCalls: Array<Record<string, unknown>> = [];
    const crashReporter = {
      start: (options: Record<string, unknown>) => {
        startCalls.push(options);
      },
    };

    const disabled = createCrashReportController({ store, fs: realFs, crashReporter, now: () => 10_000 });
    expect(disabled.getEnabled()).toBe(false);
    expect(startCalls).toHaveLength(0);

    disabled.setEnabled(true);
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0]).toMatchObject({ uploadToServer: false });

    const enabledAtBoot = createCrashReportController({
      store: createCrashReportFileStore({ directoryPath: dir, fs: realFs }),
      fs: realFs,
      crashReporter,
      now: () => 10_100,
    });
    expect(enabledAtBoot.getState().nativeReporterStarted).toBe(true);
    expect(startCalls).toHaveLength(2);
  });

  it('clears the queue and pending minidumps, reporting honest results', () => {
    const dir = makeTempDir('sloom-crash-clear-');
    const crashDumpsDir = join(dir, 'Crashpad', 'reports');
    mkdirSync(crashDumpsDir, { recursive: true });
    writeFileSync(join(crashDumpsDir, 'a.dmp'), 'x');
    writeFileSync(join(crashDumpsDir, 'b.dmp'), 'y');
    writeFileSync(join(crashDumpsDir, 'keep.txt'), 'z');

    const fakeApp = {
      getPath: (name: string) => (name === 'crashDumps' ? join(dir, 'Crashpad') : dir),
    };
    const store = createCrashReportFileStore({ directoryPath: join(dir, 'queue'), fs: realFs });
    const controller = createCrashReportController({
      store,
      fs: realFs,
      app: fakeApp,
      now: () => 11_000,
    });
    controller.setEnabled(true);
    controller.append('main-uncaught-exception', 'crash before clear');

    expect(controller.getState().pendingMinidumpCount).toBe(2);
    const cleared = controller.clearReports();

    expect(cleared.ok).toBe(true);
    expect(cleared.minidumpsRemoved).toBe(2);
    expect(controller.getState().reports).toEqual([]);
    expect(readdirSync(crashDumpsDir)).toEqual(['keep.txt']);
    expect(readJson(store.settingsFilePath)).toMatchObject({ captureEnabled: true });
  });
});
