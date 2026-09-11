import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROVIDER_START_POLICY_MIN_DELAYS_MS,
  ProviderRateLimiter,
  providerLimiters,
} from './providerRateLimiter';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(turns = 5): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

describe('ProviderRateLimiter start admission', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces same-policy starts without waiting for the previous task lifetime', async () => {
    const limiter = new ProviderRateLimiter(1_500);
    const firstLifetime = deferred<string>();
    const starts: number[] = [];

    const first = limiter.acquire(async () => {
      starts.push(Date.now());
      return firstLifetime.promise;
    });
    const second = limiter.acquire(async () => {
      starts.push(Date.now());
      return 'second';
    });
    await flushMicrotasks();

    expect(starts).toEqual([Date.now()]);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(starts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe('second');
    expect(starts).toEqual([
      Date.parse('2026-07-18T12:00:00.000Z'),
      Date.parse('2026-07-18T12:00:01.500Z'),
    ]);

    firstLifetime.resolve('first');
    await expect(first).resolves.toBe('first');
  });

  it('removes a cancelled queued start without consuming a spacing interval', async () => {
    const limiter = new ProviderRateLimiter(1_000);
    const cancelled = new AbortController();
    const starts: string[] = [];

    const first = limiter.acquire(async () => {
      starts.push('first');
      return 'first';
    });
    const skipped = limiter.acquire(async () => {
      starts.push('cancelled');
      return 'cancelled';
    }, cancelled.signal);
    const third = limiter.acquire(async () => {
      starts.push('third');
      return 'third';
    });
    skipped.catch(() => undefined);
    await flushMicrotasks();

    cancelled.abort();
    await expect(skipped).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(first).resolves.toBe('first');
    await expect(third).resolves.toBe('third');
    expect(starts).toEqual(['first', 'third']);
  });

  it('continues admitting queued starts after a task fails', async () => {
    const limiter = new ProviderRateLimiter(750);
    const failure = deferred<never>();
    const starts: string[] = [];

    const first = limiter.acquire(async () => {
      starts.push('first');
      return failure.promise;
    });
    first.catch(() => undefined);
    const second = limiter.acquire(async () => {
      starts.push('second');
      return 'recovered';
    });
    await flushMicrotasks();

    failure.reject(new Error('provider start failed'));
    await expect(first).rejects.toThrow('provider start failed');
    await vi.advanceTimersByTimeAsync(750);

    await expect(second).resolves.toBe('recovered');
    expect(starts).toEqual(['first', 'second']);
  });

  it('instantiates every declared policy with its own limiter object', () => {
    const policies = Object.keys(PROVIDER_START_POLICY_MIN_DELAYS_MS);
    const entries = Object.entries(providerLimiters);

    expect(entries.map(([policy]) => policy).sort()).toEqual([...policies].sort());
    expect(new Set(entries.map(([, limiter]) => limiter)).size).toBe(entries.length);
    for (const [policy, minDelayMs] of Object.entries(PROVIDER_START_POLICY_MIN_DELAYS_MS)) {
      expect(providerLimiters[policy as keyof typeof providerLimiters].minDelayMs).toBe(minDelayMs);
    }
  });
});
