import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { HttpStatusError, NonRetryableError, withExponentialBackoff } from './exponentialBackoff';

describe('withExponentialBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves immediately if the operation succeeds', async () => {
    const operation = vi.fn().mockResolvedValue('success');
    const onRetry = vi.fn();

    const promise = withExponentialBackoff({
      operation,
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry,
    });

    await expect(promise).resolves.toBe('success');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries up to maxRetries times and resolves if a subsequent attempt succeeds', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('success on 3');

    const onRetry = vi.fn();

    const promise = withExponentialBackoff({
      operation,
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(1000); // 1st retry delay
    await vi.advanceTimersByTimeAsync(2000); // 2nd retry delay

    await expect(promise).resolves.toBe('success on 3');

    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 3, 1000, expect.any(Error));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 3, 2000, expect.any(Error));
  });

  it('fails after maxRetries is exhausted', async () => {
    const error = new Error('permanent fail');
    const operation = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();

    const promise = withExponentialBackoff({
      operation,
      maxRetries: 2,
      baseDelayMs: 1000,
      onRetry,
    });

    promise.catch(() => {}); // prevent unhandled rejection

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000); // shouldn't trigger another retry

    await expect(promise).rejects.toThrow('permanent fail');

    expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('stops before an exponential delay would exceed the total elapsed retry budget', async () => {
    const error = new Error('upstream unavailable');
    const operation = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();

    const promise = withExponentialBackoff({
      operation,
      maxRetries: 10,
      baseDelayMs: 30_000,
      maxElapsedMs: 5 * 60_000,
      onRetry,
    });
    promise.catch(() => undefined);

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('upstream unavailable');
    // 30s + 60s + 120s = 210s. The next 240s delay would cross the
    // five-minute budget, so the old 8h31m schedule is never created.
    expect(operation).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('does not retry a NonRetryableError (type is the authoritative signal)', async () => {
    const error = new NonRetryableError('Vertex AI video requires a service-account key on this device.');
    const operation = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();

    await expect(withExponentialBackoff({
      operation,
      maxRetries: 10,
      baseDelayMs: 1000,
      onRetry,
    })).rejects.toBeInstanceOf(NonRetryableError);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 405, 410, 413, 415, 422])(
    'does not retry permanent structured HTTP %i errors',
    async (status) => {
      const error = new HttpStatusError(status, 'invalid request body');
      const operation = vi.fn().mockRejectedValue(error);
      const onRetry = vi.fn();

      await expect(withExponentialBackoff({
        operation,
        maxRetries: 10,
        baseDelayMs: 1000,
        onRetry,
      })).rejects.toBe(error);

      expect(operation).toHaveBeenCalledTimes(1);
      expect(onRetry).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['HTTP 429', new HttpStatusError(429, 'rate limited')],
    ['HTTP 408', Object.assign(new Error('request timeout'), { statusCode: '408' })],
    ['HTTP 425', Object.assign(new Error('request arrived too early'), { status: 425 })],
  ])('retries transient structured %s errors', async (_label, error) => {
    const operation = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('recovered');
    const onRetry = vi.fn();

    const promise = withExponentialBackoff({
      operation,
      maxRetries: 2,
      baseDelayMs: 1000,
      onRetry,
    });
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['HTTP 429', new Error('provider polling failed (HTTP 429)')],
    ['HTTP 408', new Error('provider polling failed HTTP 408')],
    ['HTTP 425', new Error('provider polling failed (425)')],
  ])('retries transient message-only %s errors', async (_label, error) => {
    const operation = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('recovered');
    const onRetry = vi.fn();

    const promise = withExponentialBackoff({
      operation,
      maxRetries: 2,
      baseDelayMs: 1000,
      onRetry,
    });
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not treat an arbitrary numeric SDK code as an HTTP status', async () => {
    const error = Object.assign(new Error('temporary provider SDK failure'), { code: 404 });
    const operation = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('recovered');
    const onRetry = vi.fn();

    const promise = withExponentialBackoff({
      operation,
      maxRetries: 2,
      baseDelayMs: 1000,
      onRetry,
    });
    promise.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('DOES retry a plain Error whose message merely contains "require"', async () => {
    // Regression guard: classification must key off the error TYPE, not the
    // wording. The old heuristic sniffed the substring "require", so rewording a
    // fail-closed message silently turned it retryable (and, worse, a transient
    // error that happened to mention "required" was wrongly failed fast).
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('temporary upstream blip (a required field was momentarily null)'))
      .mockResolvedValueOnce('recovered');
    const onRetry = vi.fn();

    const promise = withExponentialBackoff({
      operation,
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe('recovered');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-retryable Vertex 4xx configuration errors', async () => {
    const error = new Error('Vertex AI video generation failed (404): Publisher Model was not found or your project does not have access to it.');
    const operation = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();

    await expect(withExponentialBackoff({
      operation,
      maxRetries: 10,
      baseDelayMs: 1000,
      onRetry,
    })).rejects.toThrow('Publisher Model');

    expect(operation).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
