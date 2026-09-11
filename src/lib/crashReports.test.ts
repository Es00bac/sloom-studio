import { describe, expect, it } from 'vitest';
import {
  appendCrashReport,
  CRASH_REPORT_QUEUE_LIMIT,
  createCrashReport,
  crashReportFingerprint,
  formatCrashReportsExportText,
  mergeCrashReports,
  redactCrashReportText,
  sanitizeCrashReportQueue,
} from './crashReports';

describe('redactCrashReportText', () => {
  it('removes complete labeled and detached bearer and basic credentials', () => {
    const text = [
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload-hash',
      'failed at bearer sk-1234567890abcdefghij end',
      'Authorization: basic dXNlcjpwYXNzd29yZA==',
    ].join('\n');

    const redacted = redactCrashReportText(text);

    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9.payload-hash');
    expect(redacted).not.toContain('sk-1234567890abcdefghij');
    expect(redacted).not.toContain('dXNlcjpwYXNzd29yZA==');
    expect(redacted.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps ordinary prose that merely mentions bearer or basic words', () => {
    const redacted = redactCrashReportText('The basic renderer failed while a bearer of news arrived.');

    expect(redacted).toBe('The basic renderer failed while a bearer of news arrived.');
  });

  it('redacts secret-named key/value pairs, JSON fields, and query parameters while keeping hosts and status', () => {
    const text = 'Request to https://api.example.com/v1/x?api_key=supersecret&mode=fast failed with 401 after api_key: hunter2 and {"token": "abc123"}';

    const redacted = redactCrashReportText(text);

    expect(redacted).toContain('https://api.example.com/v1/x');
    expect(redacted).toContain('mode=fast');
    expect(redacted).toContain('401');
    expect(redacted).not.toContain('supersecret');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('abc123');
  });

  it('redacts bare secret-named keys with double-quoted values, including short realistic provider keys', () => {
    const text = [
      'api_key: "nv-9876543210abcdef"',
      'password: "hunter2"',
      'api_key: "AIzaSyB1234567890abcdefghijklmnopqrstu"',
    ].join('\n');

    const redacted = redactCrashReportText(text);

    expect(redacted).not.toContain('nv-9876543210abcdef');
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('AIzaSyB1234567890abcdefghijklmnopqrstu');
    expect(redacted.match(/api_key: \[redacted\]/g)?.length).toBe(2);
    expect(redacted).toContain('password: [redacted]');
  });

  it('redacts single-quoted and truncated quoted secret values while JSON-quoted keys still route through the field pass', () => {
    const redacted = redactCrashReportText([
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
    const redacted = redactCrashReportText(
      String.raw`{"error": "api_key: \"${providerKey}\" is invalid"}`,
    );

    expect(redacted).not.toContain(providerKey);
    expect(redacted).toContain('api_key: [redacted] is invalid');
    expect(() => JSON.parse(redacted)).not.toThrow();
  });

  it('redacts a doubly serialized escaped-quote value through the public capture path', () => {
    const providerKey = 'AIzaSyB1234567890abcdefghijklmnopqrstu';
    const report = createCrashReport({
      kind: 'renderer-unhandled-rejection',
      message: {
        responseBody: String.raw`{"error": "api_key: \\"${providerKey}\\" is invalid"}`,
      },
    });

    expect(report.message).not.toContain(providerKey);
    expect(report.message).toContain('api_key: [redacted] is invalid');
    expect(() => JSON.parse(report.message)).not.toThrow();
  });

  it('redacts escaped secret keys in nested JSON response strings through the public capture path', () => {
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
      const report = createCrashReport({
        kind: 'renderer-unhandled-rejection',
        message: { error: 'Request failed', responses: [responseBody] },
      });

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

  it('redacts data, blob, and asset URLs, userinfo, provider tokens, and home-directory usernames', () => {
    const text = [
      'loaded data:image/png;base64,AAAA then blob:https://x/1234 and signal-loom-asset://item-9',
      'https://user:pass@cdn.example.com/file.png at /home/alice/secret-project',
    ].join(' ');

    const redacted = redactCrashReportText(text);

    expect(redacted).not.toContain('base64,AAAA');
    expect(redacted).not.toContain('1234');
    expect(redacted).not.toContain('user:pass');
    expect(redacted).not.toContain('alice');
    expect(redacted).toContain('/home/[redacted]/secret-project');
  });

  it('redacts long high-entropy tokens in stack traces while keeping normal frames', () => {
    const stack = `Error: boom\n    at fetchJob (https://app.local/assets/index-3f2b81c04d9a17e6b2c8f5a0d1e3b4c5a6d7e8f9.js:1:2)\n    at run (app.mjs:10:5)`;

    const redacted = redactCrashReportText(stack);

    expect(redacted).toContain('Error: boom');
    expect(redacted).toContain('at run (app.mjs:10:5)');
    expect(redacted).not.toContain('3f2b81c04d9a17e6b2c8f5a0d1e3b4c5a6d7e8f9');
  });
});

describe('createCrashReport', () => {
  it('bounds every free-text field and redacts at capture time', () => {
    const report = createCrashReport({
      kind: 'renderer-render',
      message: `x`.repeat(10_000),
      stack: `Error: ${'Bearer eyJhbGciOiJIUzI1NiJ9.sig.sig\n'}${'at f\n'.repeat(5_000)}`,
      surface: 's'.repeat(500),
      detail: 'd'.repeat(1_000),
    });

    expect(report.message.length).toBeLessThanOrEqual(512);
    expect(report.stack?.length ?? 0).toBeLessThanOrEqual(8192);
    expect(report.surface?.length ?? 0).toBeLessThanOrEqual(96);
    expect(report.detail?.length ?? 0).toBeLessThanOrEqual(256);
    expect(report.stack).not.toContain('eyJhbGciOiJIUzI1NiJ9.sig.sig');
  });

  it('serializes non-error message payloads without crashing on cycles', () => {
    const cyclic: Record<string, unknown> = { name: 'job' };
    cyclic.self = cyclic;

    const report = createCrashReport({ kind: 'renderer-unhandled-rejection', message: cyclic });

    expect(report.message).toContain('job');
    expect(report.message).toContain('circular');
  });
});

describe('appendCrashReport', () => {
  it('deduplicates repeated crashes into one entry with occurrence counts', () => {
    const first = createCrashReport({ kind: 'renderer-render', message: 'canvas exploded' });
    const second = appendCrashReport([first], createCrashReport({ kind: 'renderer-render', message: 'canvas exploded' }));
    const third = appendCrashReport(second, createCrashReport({ kind: 'renderer-render', message: 'canvas exploded' }));

    expect(third).toHaveLength(1);
    expect(third[0]?.occurrenceCount).toBe(3);
    expect(third[0]?.firstSeenAt).toBe(first.timestamp);
  });

  it('keeps only the newest bounded entries', () => {
    let reports: ReturnType<typeof createCrashReport>[] = [];
    for (let index = 0; index < CRASH_REPORT_QUEUE_LIMIT + 10; index += 1) {
      reports = appendCrashReport(reports, createCrashReport({
        kind: 'renderer-unhandled-error',
        message: `failure number ${index}`,
      }));
    }

    expect(reports).toHaveLength(CRASH_REPORT_QUEUE_LIMIT);
    expect(reports[0]?.message).toBe(`failure number ${CRASH_REPORT_QUEUE_LIMIT + 9}`);
  });
});

describe('sanitizeCrashReportQueue', () => {
  it('drops malformed records and re-redacts tampered persisted text', () => {
    const legit = createCrashReport({ kind: 'main-uncaught-exception', message: 'honest failure' });
    const tampered = createCrashReport({ kind: 'renderer-unhandled-error', message: 'stole Bearer abcdef123456789012345678' });

    const queue = sanitizeCrashReportQueue([
      'not a record',
      null,
      { kind: 'renderer-render' },
      { ...tampered, id: 'tampered-1' },
      legit,
    ]);

    expect(queue).toHaveLength(2);
    expect(queue.some((record) => record.id === legit.id)).toBe(true);
    expect(queue.find((record) => record.id === 'tampered-1')?.message).not.toContain('abcdef123456789012345678');
  });

  it('rejects unknown kinds and non-array payloads entirely', () => {
    expect(sanitizeCrashReportQueue({ no: 'array' })).toEqual([]);
    expect(
      sanitizeCrashReportQueue([{ id: 'x', timestamp: Date.now(), kind: 'not-a-kind', message: 'x' }]),
    ).toEqual([]);
  });
});

describe('mergeCrashReports', () => {
  it('merges multi-window queues by fingerprint without double counting', () => {
    const shared = createCrashReport({ kind: 'renderer-render', message: 'shared failure' });
    const windowA = appendCrashReport([shared], createCrashReport({ kind: 'renderer-render', message: 'shared failure' }));
    const windowB = [createCrashReport({ kind: 'main-uncaught-exception', message: 'main failure' })];

    const merged = mergeCrashReports(windowA, windowB);

    expect(merged.filter((record) => crashReportFingerprint(record) === crashReportFingerprint(shared))).toHaveLength(1);
    expect(merged.find((record) => record.kind === 'renderer-render')?.occurrenceCount).toBe(2);
    expect(merged.find((record) => record.kind === 'main-uncaught-exception')).toBeDefined();
  });
});

describe('formatCrashReportsExportText', () => {
  it('exports a self-describing redacted JSON document', () => {
    const report = createCrashReport({ kind: 'renderer-unhandled-error', message: 'export me' });
    const text = formatCrashReportsExportText([report], {
      exportedAt: 1_787_000_000_000,
      reportCount: 1,
      captureEnabled: true,
    });
    const parsed = JSON.parse(text);

    expect(parsed.type).toBe('sloom-studio-crash-reports');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.reportCount).toBe(1);
    expect(parsed.captureEnabled).toBe(true);
    expect(parsed.notice).toContain('No data was transmitted');
    expect(parsed.reports[0]?.message).toBe('export me');
  });
});
