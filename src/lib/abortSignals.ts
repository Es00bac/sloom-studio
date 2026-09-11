/**
 * Shared cancellation primitives for the one run signal that Flow threads through every
 * provider transport (request preparation, upload, submit, poll, download, retry backoff).
 *
 * These exist because each transport previously grew its own copy, and the copies disagreed:
 * some slept unabortably (so Cancel waited out a full 2s/10s poll interval before it was
 * noticed), some leaked one `abort` listener per poll attempt onto a long-lived run signal,
 * and some rejected with a plain `Error` that callers could not tell apart from a genuine
 * provider failure — which is exactly how a cancelled run gets retried or reported as broken.
 */

const DEFAULT_ABORT_MESSAGE = 'The run was cancelled.';

/** Build the one abort rejection shape every Flow transport agrees on. */
export function createAbortError(message: string = DEFAULT_ABORT_MESSAGE): DOMException {
  return new DOMException(message, 'AbortError');
}

/**
 * True only for a cancellation. Checked structurally rather than by `instanceof` because an
 * abort can surface as a `DOMException` (our own throws, `AbortSignal`) or as a plain `Error`
 * named `AbortError` (some `fetch` implementations) — and must never be confused with a
 * provider error that merely mentions aborting.
 */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as { name?: unknown }).name === 'AbortError';
}

/** Fail fast on an already-cancelled run, before doing any further paid or local work. */
export function throwIfAborted(signal: AbortSignal | undefined, message?: string): void {
  if (signal?.aborted) {
    throw createAbortError(message);
  }
}

/**
 * `setTimeout` that a cancel interrupts immediately instead of running to completion.
 *
 * Cleans up on every exit path: the pending timer is cleared on abort, and the `abort`
 * listener is removed both when the sleep is aborted and when it elapses normally. The
 * normal-resolve removal is the one that matters most — a poll loop sleeps once per attempt
 * against a single run signal, so a listener left attached leaks a closure per attempt.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wait for work that cannot consume an AbortSignal itself (for example an
 * Electron IPC invocation) without letting its eventual value escape after the
 * run has been cancelled. The listener is removed on both the work and abort
 * paths; the underlying work may continue when its transport has no cancel API.
 */
export function raceWithAbort<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return work;
  }
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(createAbortError()));

    signal.addEventListener('abort', onAbort, { once: true });
    void work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
