import { beforeEach, describe, expect, it } from 'vitest';
import {
  getCrashReportBroadcastMessage,
  useCrashReportStore,
} from './crashReportStore';
import { createCrashReport } from '../lib/crashReports';

describe('crash report store', () => {
  beforeEach(() => {
    useCrashReportStore.setState({ reports: [], captureEnabled: false });
  });

  it('records nothing while capture is disabled and records once enabled', () => {
    const { recordReport, setCaptureEnabled } = useCrashReportStore.getState();

    expect(recordReport({ kind: 'renderer-render', message: 'ignored while off' })).toBeNull();
    expect(useCrashReportStore.getState().reports).toHaveLength(0);

    setCaptureEnabled(true);
    const report = recordReport({ kind: 'renderer-render', message: 'captured failure' });

    expect(report).not.toBeNull();
    expect(useCrashReportStore.getState().reports).toEqual([
      expect.objectContaining({ kind: 'renderer-render', message: 'captured failure' }),
    ]);
  });

  it('bounds the persisted queue and clears it', () => {
    useCrashReportStore.setState({ captureEnabled: true });
    const { recordReport } = useCrashReportStore.getState();

    for (let index = 0; index < 60; index += 1) {
      recordReport({ kind: 'renderer-unhandled-error', message: `failure ${index}` });
    }

    expect(useCrashReportStore.getState().reports).toHaveLength(50);
    expect(useCrashReportStore.getState().reports[0]?.message).toBe('failure 59');

    useCrashReportStore.getState().clearReports();
    expect(useCrashReportStore.getState().reports).toHaveLength(0);
  });

  it('sanitizes a corrupted persisted payload down to valid reports instead of failing', () => {
    const healthy = createCrashReport({ kind: 'renderer-unhandled-error', message: 'healthy' });
    const malicious = {
      id: 'bad-1',
      timestamp: Date.now(),
      kind: 'renderer-unhandled-error' as const,
      message: 'leaked Bearer abcdef123456789012345678 token',
    };

    useCrashReportStore.getState().mergeReports([healthy, malicious, 'garbage' as unknown as never]);

    const reports = useCrashReportStore.getState().reports;
    expect(reports.map((record) => record.id)).toContain(healthy.id);
    expect(reports.find((record) => record.id === 'bad-1')?.message).not.toContain('abcdef123456789012345678');
  });

  it('parses broadcast messages and rejects malformed ones', () => {
    expect(getCrashReportBroadcastMessage({ type: 'clear' })).toEqual({ type: 'clear' });
    expect(getCrashReportBroadcastMessage({ type: 'enabled', enabled: true })).toEqual({
      type: 'enabled',
      enabled: true,
    });
    const report = createCrashReport({ kind: 'renderer-render', message: 'window B failure' });
    expect(getCrashReportBroadcastMessage({ type: 'report', report })).toEqual({
      type: 'report',
      report: expect.objectContaining({ id: report.id }),
    });
    expect(getCrashReportBroadcastMessage({ type: 'report', report: { kind: 'nope' } })).toBeUndefined();
    expect(getCrashReportBroadcastMessage('nonsense')).toBeUndefined();
  });

  it('merges broadcast reports from other windows into the local queue', () => {
    useCrashReportStore.setState({ captureEnabled: true });
    const remote = createCrashReport({ kind: 'renderer-render', message: 'other window crashed' });

    useCrashReportStore.getState().mergeReports([remote]);

    expect(useCrashReportStore.getState().reports.map((record) => record.id)).toContain(remote.id);
  });
});
