import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortableSleep, createAbortError, isAbortError, raceWithAbort, throwIfAborted } from './abortSignals';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('isAbortError', () => {
  it('recognizes a DOMException AbortError', () => {
    expect(isAbortError(new DOMException('The run was cancelled.', 'AbortError'))).toBe(true);
  });

  it('recognizes a plain Error whose name was set to AbortError', () => {
    // `fetch` in some runtimes rejects with an Error-shaped abort rather than a DOMException.
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('does not classify an ordinary provider failure as an abort', () => {
    expect(isAbortError(new Error('Atlas image generation failed'))).toBe(false);
    expect(isAbortError('Operation aborted')).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('throwIfAborted', () => {
  it('does nothing while the signal is live', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
  });

  it('does nothing when no signal is supplied', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
  });

  it('throws an AbortError once the signal is aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
  });
});

describe('abortableSleep', () => {
  it('resolves after the requested delay', async () => {
    vi.useFakeTimers();
    const sleep = abortableSleep(2000);
    let settled = false;
    void sleep.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(sleep).resolves.toBeUndefined();
  });

  it('rejects immediately with an AbortError when the signal aborts mid-sleep', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    // A 2s provider poll interval: cancellation must not wait it out.
    const sleep = abortableSleep(2000, controller.signal);
    const assertion = expect(sleep).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();

    // No timer advance: the rejection must land on the abort itself, not on the delay elapsing.
    await assertion;
  });

  it('rejects without starting a timer when the signal is already aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await expect(abortableSleep(10_000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('removes its abort listener after resolving normally', async () => {
    // A poll loop sleeps once per attempt against ONE long-lived run signal. Leaving the
    // listener attached leaks one closure per attempt for the life of the run.
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const sleep = abortableSleep(50, controller.signal);
    await vi.advanceTimersByTimeAsync(50);
    await sleep;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes its abort listener after rejecting on abort', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const sleep = abortableSleep(50, controller.signal);
    const assertion = expect(sleep).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('clears its pending timer when aborted so the delay cannot fire later', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    const sleep = abortableSleep(5000, controller.signal);
    const assertion = expect(sleep).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;

    expect(clearSpy).toHaveBeenCalled();
    // Nothing is left scheduled that could resolve a cancelled sleep.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sleeps unabortably when no signal is supplied', async () => {
    vi.useFakeTimers();
    const sleep = abortableSleep(10);
    await vi.advanceTimersByTimeAsync(10);
    await expect(sleep).resolves.toBeUndefined();
  });
});

describe('createAbortError', () => {
  it('builds a DOMException named AbortError carrying the supplied message', () => {
    const error = createAbortError('The run was cancelled.');
    expect(error.name).toBe('AbortError');
    expect(error.message).toBe('The run was cancelled.');
    expect(isAbortError(error)).toBe(true);
  });
});

describe('raceWithAbort', () => {
  it('returns work normally and removes the abort listener', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    await expect(raceWithAbort(Promise.resolve('done'), controller.signal)).resolves.toBe('done');
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects immediately when already aborted without observing stale work', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(raceWithAbort(Promise.resolve('stale'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects on abort and removes the listener while underlying non-abortable work may continue', async () => {
    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    let resolveWork: (value: string) => void = () => undefined;
    const work = new Promise<string>((resolve) => { resolveWork = resolve; });
    const raced = raceWithAbort(work, controller.signal);

    controller.abort();
    await expect(raced).rejects.toMatchObject({ name: 'AbortError' });
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));

    resolveWork('late');
    await expect(work).resolves.toBe('late');
  });
});
