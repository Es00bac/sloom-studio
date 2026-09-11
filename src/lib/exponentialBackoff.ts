import { abortableSleep, createAbortError, isAbortError, throwIfAborted } from './abortSignals';

export interface ExponentialBackoffOptions<T> {
  operation: () => Promise<T>;
  maxRetries: number;
  baseDelayMs: number;
  /** Stop before scheduling a retry that would cross this elapsed-time budget. */
  maxElapsedMs?: number;
  onRetry?: (attempt: number, maxRetries: number, delayMs: number, error: unknown) => void;
  abortSignal?: AbortSignal;
}

/**
 * A fail-closed error: a configuration, validation, auth, or missing-resource
 * problem that a retry cannot fix. Throw this (rather than relying on the exact
 * wording of a plain `Error`) anywhere inside a `withExponentialBackoff`
 * operation that must surface immediately instead of backing off.
 *
 * This replaces the old, fragile heuristic of sniffing the message for the
 * substring "require": rewording such a message silently turned a fail-fast
 * config error into a retryable one (10x exponential backoff before the user
 * ever saw it). Marking the error by type removes that trap.
 */
export class NonRetryableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NonRetryableError';
    // Keep `instanceof` reliable even when this class is transpiled down to ES5
    // (extending built-ins otherwise breaks the prototype chain).
    Object.setPrototypeOf(this, NonRetryableError.prototype);
  }
}

/**
 * An HTTP failure that retains the response status independently of provider
 * error-body wording. Backoff can therefore apply its permanent-client-error
 * policy even when the JSON body contains only a message.
 */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(`${message} (HTTP ${status})`, options);
    this.name = 'HttpStatusError';
    this.status = status;
    Object.setPrototypeOf(this, HttpStatusError.prototype);
  }
}

const PERMANENT_CLIENT_ERROR_STATUSES = new Set([
  400,
  401,
  403,
  404,
  405,
  410,
  413,
  415,
  422,
]);

export async function withExponentialBackoff<T>({
  operation,
  maxRetries,
  baseDelayMs,
  maxElapsedMs,
  onRetry,
  abortSignal,
}: ExponentialBackoffOptions<T>): Promise<T> {
  let attempt = 0;
  const startedAt = Date.now();
  const elapsedBudgetMs = maxElapsedMs === undefined
    ? undefined
    : Math.max(0, maxElapsedMs);

  while (true) {
    try {
      throwIfAborted(abortSignal);
      return await operation();
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      if (abortSignal?.aborted) {
        throw createAbortError();
      }

      // Do not retry on configuration, validation, auth, or missing-resource errors.
      // E.g. "Imagen models require Vertex AI mode..." or Vertex 404 model access errors.
      if (isNonRetryableError(error)) {
        throw error;
      }

      if (attempt >= maxRetries) {
        throw error;
      }

      attempt++;
      // Calculate delay: baseDelay * 2^(attempt - 1)
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);

      // `maxRetries` alone allowed the default 30-second backoff to schedule
      // more than eight hours of waits. Refuse a delay that would cross the
      // request's elapsed retry budget. An in-flight operation is not forcibly
      // interrupted here; callers can additionally supply an AbortSignal.
      if (
        elapsedBudgetMs !== undefined &&
        Date.now() - startedAt + delayMs > elapsedBudgetMs
      ) {
        throw error;
      }

      if (onRetry) {
        onRetry(attempt, maxRetries, delayMs, error);
      }

      await abortableSleep(delayMs, abortSignal);
    }
  }
}

function isNonRetryableError(error: unknown): boolean {
  // Our own fail-closed throws are marked by type — the authoritative signal.
  if (error instanceof NonRetryableError) {
    return true;
  }

  const httpStatus = extractHttpStatus(error);
  if (httpStatus !== undefined && isPermanentClientErrorStatus(httpStatus)) {
    return true;
  }

  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();

  // Provider/library errors we don't author can't be retyped, so classify them
  // by objective signals only. Vertex publisher-model access failures and the
  // explicit client-error statuses above are permanent. Other 4xx responses can
  // be transient during an existing async job (notably 408, 425, and 429).
  if (message.includes('publisher model') && (
    message.includes('not found') ||
    message.includes('does not have access')
  )) {
    return true;
  }

  // Some native/SDK bridges expose only a rendered message. Keep this narrow
  // compatibility fallback while direct fetch paths use HttpStatusError.
  return messageContainsPermanentHttpStatus(message);
}

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const record = error as Record<string, unknown>;
  for (const value of [record.status, record.statusCode]) {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  }

  const response = record.response;
  if (typeof response === 'object' && response !== null) {
    const status = (response as Record<string, unknown>).status;
    if (typeof status === 'number' && Number.isInteger(status)) return status;
  }

  return undefined;
}

function isPermanentClientErrorStatus(status: number): boolean {
  return PERMANENT_CLIENT_ERROR_STATUSES.has(status);
}

function messageContainsPermanentHttpStatus(message: string): boolean {
  const parenthesizedStatus = message.match(/\((?:http\s+)?(\d{3})\)/)?.[1];
  if (parenthesizedStatus && isPermanentClientErrorStatus(Number(parenthesizedStatus))) {
    return true;
  }

  const labeledStatus = message.match(/http\s+(\d{3})\b/)?.[1];
  return labeledStatus !== undefined && isPermanentClientErrorStatus(Number(labeledStatus));
}
