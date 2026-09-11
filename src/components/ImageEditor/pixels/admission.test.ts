import { describe, expect, it } from 'vitest';
import {
  HIGH_BIT_ADMISSION_BUDGET_BYTES,
  HIGH_BIT_RUNTIME_RESERVE_BYTES,
  BYTES_PER_DISPLAY_PROXY_PIXEL,
  checkHighBitAdmission,
  describeHighBitAdmissionRefusal,
  estimateHighBitDocumentBytes,
} from './admission';

const MIB = 1024 * 1024;

describe('high-bit admission (D7 gate with Wave-0 P5 reserve)', () => {
  it('uses the 1.5 GiB D7 default budget and the P5-derived reserve floor', () => {
    expect(HIGH_BIT_ADMISSION_BUDGET_BYTES).toBe(Math.round(1.5 * 1024 * 1024 * 1024));
    // P5 measured >= 50.9 MiB of runtime overhead above raw bytes; 64 MiB is
    // the documented minimum honest floor.
    expect(HIGH_BIT_RUNTIME_RESERVE_BYTES).toBe(64 * MIB);
    expect(BYTES_PER_DISPLAY_PROXY_PIXEL).toBe(4);
  });

  it('refuses the exact P5 probe document (4000x3000 f32 x 8) before allocation', () => {
    const layers = Array.from({ length: 8 }, () => ({ width: 4000, height: 3000 }));
    const result = checkHighBitAdmission({ depth: 'f32', layers });
    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    const rawBytes = 4000 * 3000 * 4 * 4 * 8;
    expect(result.authorityBytes).toBe(rawBytes);
    expect(result.authorityBytes).toBe(1_536_000_000);
    expect(result.proxyBytes).toBe(4000 * 3000 * 4 * 8);
    expect(result.estimatedBytes).toBe(
      result.authorityBytes + result.proxyBytes + HIGH_BIT_RUNTIME_RESERVE_BYTES,
    );
    expect(result.estimatedBytes).toBeGreaterThan(HIGH_BIT_ADMISSION_BUDGET_BYTES);
  });

  it('admits the same document at 16-bit working depth with the full reserve intact', () => {
    const layers = Array.from({ length: 8 }, () => ({ width: 4000, height: 3000 }));
    const result = checkHighBitAdmission({ depth: 'u16', layers });
    expect(result.admitted).toBe(true);
    if (!result.admitted) return;
    expect(result.authorityBytes).toBe(4000 * 3000 * 4 * 2 * 8);
    expect(result.estimatedBytes).toBeLessThanOrEqual(HIGH_BIT_ADMISSION_BUDGET_BYTES);
  });

  it('refuses against a settable smaller budget', () => {
    const result = checkHighBitAdmission({
      depth: 'u16',
      layers: [{ width: 64, height: 64 }],
      budgetBytes: 64 * 1024,
    });
    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.overBytes).toBe(
      result.estimatedBytes - 64 * 1024,
    );
  });

  it('admits small documents with room for the whole reserve', () => {
    const result = checkHighBitAdmission({ depth: 'f32', layers: [{ width: 64, height: 64 }] });
    expect(result.admitted).toBe(true);
    if (!result.admitted) return;
    expect(result.estimatedBytes)
      .toBe(64 * 64 * 16 + 64 * 64 * 4 + HIGH_BIT_RUNTIME_RESERVE_BYTES);
  });

  it('names every cost component and advice in the refusal message', () => {
    const refusal = checkHighBitAdmission({
      depth: 'f32',
      layers: Array.from({ length: 8 }, () => ({ width: 4000, height: 3000 })),
    });
    expect(refusal.admitted).toBe(false);
    if (refusal.admitted) return;
    const message = describeHighBitAdmissionRefusal(refusal);
    expect(message).toContain('refused before allocation');
    expect(message).toContain('1464.8 MiB');
    expect(message).toContain('366.2 MiB');
    expect(message).toContain('64.0 MiB');
    expect(message).toContain('1536.0 MiB');
    expect(message).toContain('16-bit');
  });

  it('estimates proxy bytes from the 8-bit display derivative, not the authority depth', () => {
    const estimate = estimateHighBitDocumentBytes({
      depth: 'f32',
      layers: [{ width: 10, height: 10 }],
    });
    expect(estimate.authorityBytes).toBe(10 * 10 * 4 * 4);
    expect(estimate.proxyBytes).toBe(10 * 10 * 4);
  });

  it('rejects non-finite, non-positive, and overflowing dimensions before allocation', () => {
    for (const dimensions of [
      { width: Number.NEGATIVE_INFINITY, height: Number.NEGATIVE_INFINITY },
      { width: Number.POSITIVE_INFINITY, height: 2 },
      { width: Number.NaN, height: 2 },
      { width: 0, height: 2 },
      { width: -1, height: 2 },
      { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
    ]) {
      const result = checkHighBitAdmission({ depth: 'f32', layers: [dimensions] });
      expect(result.admitted).toBe(false);
      if (!result.admitted) expect(result.advice).toMatch(/Refused before allocation|overflow/);
    }
  });
});
