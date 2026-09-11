import { describe, expect, it } from 'vitest';
import { compareProjectSizeReports, measureProjectSize } from './projectSizeReport';

describe('project size report', () => {
  it('accounts for nested embedded media and durable Source Library references', () => {
    const report = measureProjectSize({
      flow: { nodes: [{ data: { value: 'data:image/png;base64,AAEC' } }] },
      paper: { frames: [{ asset: { src: 'data:text/plain,hello%20world' } }] },
      sourceBin: { items: [{ assetUrl: 'signal-loom-asset://file/hero' }] },
    });

    expect(report.documentBytes).toBeGreaterThan(0);
    expect(report.embeddedMediaCount).toBe(2);
    expect(report.embeddedMediaBytes).toBe(14);
    expect(report.embeddedMediaJsonBytes).toBeGreaterThan(report.embeddedMediaBytes);
    expect(report.externalReferenceCount).toBe(1);
  });

  it('compares normalized before/after payloads without negative savings', () => {
    const before = measureProjectSize({ value: 'data:image/png;base64,' + 'A'.repeat(400) });
    const after = measureProjectSize({ value: 'signal-loom-asset://file/hero' });
    const comparison = compareProjectSizeReports(before, after);

    expect(comparison.documentBytesSaved).toBeGreaterThan(0);
    expect(comparison.embeddedJsonBytesSaved).toBeGreaterThan(0);
    expect(comparison.reductionPercent).toBeGreaterThan(0);
    expect(compareProjectSizeReports(after, before).documentBytesSaved).toBe(0);
  });

  it('fails safely on cyclic values and marks a non-JSON report truncated', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const report = measureProjectSize(cycle);
    expect(report.documentBytes).toBe(0);
    expect(report.truncated).toBe(true);
  });

  it('walks a large array without exceeding the engine argument limit', () => {
    const values = Array.from({ length: 150_000 }, () => 0);
    const report = measureProjectSize({ values });

    expect(report.truncated).toBe(false);
  });

  it('marks a scan beyond the bounded value budget instead of throwing', () => {
    const values = Array.from({ length: 250_001 }, () => 'signal-loom-asset://file/asset');

    const report = measureProjectSize({ values });

    expect(report.truncated).toBe(true);
    expect(report.externalReferenceCount).toBeGreaterThan(0);
  });

  it('keeps partial accounting when a nested getter is hostile', () => {
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, 'toJSON', {
      value: () => ({ safe: hostile.safe }),
      enumerable: false,
    });
    Object.defineProperty(hostile, 'hostile', {
      enumerable: true,
      get: () => {
        throw new Error('hostile getter');
      },
    });
    hostile.safe = 'signal-loom-asset://file/safe';

    const report = measureProjectSize({ hostile });

    expect(report.externalReferenceCount).toBe(1);
    expect(report.truncated).toBe(true);
  });
});
