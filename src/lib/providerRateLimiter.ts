import { abortableSleep, createAbortError, throwIfAborted } from './abortSignals';

interface QueueWaiter {
  grant: () => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ProviderRateLimiter {
  private schedulingStart = false;
  private readonly waiters: QueueWaiter[] = [];
  private lastStartTime: number | undefined;
  minDelayMs: number;

  constructor(minDelayMs: number) {
    this.minDelayMs = minDelayMs;
  }

  async acquire<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquireStart(signal);
    throwIfAborted(signal);
    return task();
  }

  /**
   * Admit one outbound operation start. The scheduler owns only the spacing
   * between starts; it deliberately does not own the returned task lifetime.
   * A provider job may therefore poll or materialize for minutes without
   * serializing later starts behind its completion.
   */
  private acquireStart(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);

    return new Promise<void>((resolve, reject) => {
      const waiter: QueueWaiter = {
        reject,
        signal,
        grant: () => {
          if (waiter.onAbort) {
            signal?.removeEventListener('abort', waiter.onAbort);
          }
          resolve();
        },
      };

      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        signal?.removeEventListener('abort', waiter.onAbort!);
        reject(createAbortError());
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      this.scheduleNextStart();
    });
  }

  private scheduleNextStart(): void {
    if (this.schedulingStart) return;

    const next = this.waiters.shift();
    if (!next) return;

    this.schedulingStart = true;
    if (next.onAbort) {
      next.signal?.removeEventListener('abort', next.onAbort);
    }

    void this.grantStartWhenReady(next);
  }

  private async grantStartWhenReady(waiter: QueueWaiter): Promise<void> {
    try {
      throwIfAborted(waiter.signal);
      if (this.lastStartTime !== undefined) {
        // Wall clocks and test clocks can move backwards. Treat that as no
        // elapsed delay and require one fresh spacing interval.
        const elapsed = Math.max(0, Date.now() - this.lastStartTime);
        const remainingDelay = Math.max(0, this.minDelayMs - elapsed);
        if (remainingDelay > 0) {
          await abortableSleep(remainingDelay, waiter.signal);
        }
      }
      throwIfAborted(waiter.signal);
      this.lastStartTime = Date.now();
      waiter.grant();
    } catch (error) {
      waiter.reject(error);
    } finally {
      this.schedulingStart = false;
      this.scheduleNextStart();
    }
  }
}

/**
 * Every supported Flow start policy, including each real backend-proxy route.
 * Keep this declaration exhaustive and instantiate every entry independently:
 * falling through to `default` or reusing one limiter object would couple
 * otherwise unrelated transports.
 */
export const PROVIDER_START_POLICY_MIN_DELAYS_MS = {
  bfl: 2500,
  gemini: 1500,
  openai: 1500,
  stability: 2000,
  huggingface: 2000,
  elevenlabs: 2000,
  atlas: 1500,
  byteplus: 1500,
  localOpen: 0,
  android: 0,
  local: 0,
  'backend-proxy:bfl': 2500,
  'backend-proxy:gemini': 1500,
  'backend-proxy:openai': 1500,
  'backend-proxy:stability': 2000,
  'backend-proxy:huggingface': 2000,
  'backend-proxy:elevenlabs': 2000,
  'backend-proxy:atlas': 1500,
  'backend-proxy:byteplus': 1500,
  // Local/Open is deliberately proxy-capable: its sanitized endpoint and
  // model are part of the proxy DTO, while any proxy-side credentials remain
  // owned by that service. It does not share a remote-provider quota.
  'backend-proxy:localOpen': 0,
  default: 1500,
} as const;

export type ProviderStartPolicyKey = keyof typeof PROVIDER_START_POLICY_MIN_DELAYS_MS;

export const providerLimiters = Object.fromEntries(
  Object.entries(PROVIDER_START_POLICY_MIN_DELAYS_MS).map(([policy, minDelayMs]) => [
    policy,
    new ProviderRateLimiter(minDelayMs),
  ]),
) as Record<ProviderStartPolicyKey, ProviderRateLimiter>;

export function getProviderLimiter(provider: string): ProviderRateLimiter {
  return Object.prototype.hasOwnProperty.call(providerLimiters, provider)
    ? providerLimiters[provider as ProviderStartPolicyKey]
    : providerLimiters.default;
}
