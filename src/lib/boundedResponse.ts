const cancelledBodies = new WeakSet<ReadableStream<Uint8Array>>();
const DEFAULT_BODY_READ_TIMEOUT_MS = 15_000;

export async function cancelResponseBody(response: Response): Promise<void> {
  const body = response.body;
  if (!body || cancelledBodies.has(body)) return;
  cancelledBodies.add(body);
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Cancellation cleanup must not replace the response outcome.
  }
}

export async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_BODY_READ_TIMEOUT_MS,
): Promise<unknown | undefined> {
  if (!response.ok) {
    await cancelResponseBody(response);
    return undefined;
  }
  if (signal?.aborted) {
    await cancelResponseBody(response);
    throw abortError();
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    await cancelResponseBody(response);
    return undefined;
  }

  const declaredLength = parseContentLength(response.headers.get('content-length'));
  if (declaredLength === undefined || declaredLength <= 0 || declaredLength > maxBytes) {
    await cancelResponseBody(response);
    return undefined;
  }

  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let received = 0;
  let completed = false;
  let cancelled = false;
  const cancel = async () => {
    if (cancelled || completed) return;
    cancelled = true;
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      // Cancellation cleanup must not replace the primary result.
    }
  };

  try {
    while (received < declaredLength) {
      const next = await readWithDeadline(reader, signal, timeoutMs);
      if (next.done) {
        completed = true;
        return undefined;
      }
      if (!next.value || next.value.length === 0) continue;
      received += next.value.length;
      if (received > declaredLength || received > maxBytes) {
        await cancel();
        return undefined;
      }
      chunks.push(next.value);
    }

    const terminal = await readWithDeadline(reader, signal, timeoutMs);
    if (!terminal.done) {
      await cancel();
      return undefined;
    }
    completed = true;
  } catch {
    await cancel();
    if (signal?.aborted) throw abortError();
    return undefined;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock release is best-effort cleanup and must not replace the primary parse/read outcome.
    }
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function readBoundedBytesResponse(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_BODY_READ_TIMEOUT_MS,
): Promise<Uint8Array | undefined> {
  if (!response.ok || signal?.aborted || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    await cancelResponseBody(response);
    if (signal?.aborted) throw abortError();
    return undefined;
  }
  const declaredLength = parseContentLength(response.headers.get('content-length'));
  if (declaredLength === undefined || declaredLength <= 0 || declaredLength > maxBytes) {
    await cancelResponseBody(response);
    return undefined;
  }
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const bytes = new Uint8Array(declaredLength);
  let received = 0;
  let completed = false;
  let cancelled = false;
  const cancel = () => {
    if (cancelled || completed) return;
    cancelled = true;
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      // Cancellation cleanup must not replace the primary result.
    }
  };
  try {
    while (received < declaredLength) {
      const next = await readWithDeadline(reader, signal, timeoutMs);
      if (next.done || !next.value) return undefined;
      if (received + next.value.length > declaredLength) {
        cancel();
        return undefined;
      }
      bytes.set(next.value, received);
      received += next.value.length;
    }
    const terminal = await readWithDeadline(reader, signal, timeoutMs);
    if (!terminal.done) {
      cancel();
      return undefined;
    }
    completed = true;
    return bytes;
  } catch {
    cancel();
    if (signal?.aborted) throw abortError();
    return undefined;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock release is best-effort cleanup and must not replace the primary read outcome.
    }
  }
}

function parseContentLength(value: string | null): number | undefined {
  if (!/^\d+$/.test(value ?? '')) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException('The run was cancelled.', 'AbortError');
}

function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('Response body read timed out.'));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => { finish(); resolve(result); },
      (error) => { finish(); reject(error); },
    );
  });
}
