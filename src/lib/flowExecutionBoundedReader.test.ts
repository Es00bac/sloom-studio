import { describe, expect, it, vi } from 'vitest';
import { readBoundedResponseText } from './flowExecution';
import { NonRetryableError } from './exponentialBackoff';

/**
 * AUD-013 follow-up: a header-fast rejection (declared Content-Length above the cap) must still release
 * the connection. Before the fix the reader threw on the header alone WITHOUT ever touching the body, so
 * a large or stalled response could keep consuming the socket after the run had already failed. The body
 * must be cancelled exactly once, and a cancellation that itself rejects must never replace the original
 * (authoritative) size error. The streamed-overflow and AbortError paths are covered elsewhere and must
 * stay unchanged.
 */
describe('readBoundedResponseText — declared-oversize body cancellation', () => {
  const OVER = 'response exceeds the safety limit';

  function oversizeResponse(body: { cancel: () => Promise<void> } | null): Response {
    return {
      headers: new Headers({ 'content-length': '100' }),
      body,
    } as unknown as Response;
  }

  it('cancels the body exactly once before the non-retryable size rejection', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    await expect(readBoundedResponseText(oversizeResponse({ cancel }), 8, OVER))
      .rejects.toBeInstanceOf(NonRetryableError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the original size error when body cancellation itself rejects', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('hostile stream refused to cancel'));
    await expect(readBoundedResponseText(oversizeResponse({ cancel }), 8, OVER))
      .rejects.toMatchObject({ name: 'NonRetryableError', message: OVER });
    expect(cancel).toHaveBeenCalledTimes(1);
    // Let the rejected cancel() settle so a missing catch would surface as an unhandled rejection.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('still rejects (without throwing) when there is no body to cancel', async () => {
    await expect(readBoundedResponseText(oversizeResponse(null), 8, OVER))
      .rejects.toBeInstanceOf(NonRetryableError);
  });
});
