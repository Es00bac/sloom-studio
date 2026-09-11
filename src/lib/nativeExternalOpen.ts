import type {
  NativeExternalOpenIntent,
  NativeExternalOpenTransitionResult,
  NativeProjectFileResult,
  SignalLoomNativeBridge,
} from './nativeApp';

export interface NativeExternalOpenErrorContext {
  kind: string;
  filePath?: string;
  message: string;
}

export interface NativeExternalOpenHandlers {
  /** Run the renderer-owned dirty-document guard before main may stage canonical project state. */
  authorizeProject: (result: NativeProjectFileResult) => Promise<boolean | void> | boolean | void;
  /** Apply a prepared project after main acknowledges acceptance. */
  applyProject: (result: NativeProjectFileResult) => Promise<void> | void;
  /** Publish renderer-local path/scratch ownership only after main commits. */
  onProjectCommitted: (
    result: NativeProjectFileResult,
    transition: NativeExternalOpenTransitionResult,
  ) => Promise<void> | void;
  applyPaper: (bytes: Uint8Array, filePath?: string) => Promise<void> | void;
  onError: (context: NativeExternalOpenErrorContext) => Promise<void> | void;
  /** Roll back renderer-local accepted project state if the consumer is disposed mid-commit. */
  onProjectAbandoned?: () => Promise<void> | void;
}

export interface NativeExternalOpenConsumerOptions {
  /** Delays before commit-only retries after the first failed commit attempt. */
  commitRetryDelaysMs?: readonly number[];
  wait?: (delayMs: number) => Promise<void>;
  runProjectTransition?: <T>(operation: () => Promise<T>) => Promise<T>;
}

const DEFAULT_COMMIT_RETRY_DELAYS_MS = [100, 250, 500, 1_000] as const;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertTransition(
  result: NativeExternalOpenTransitionResult,
  expected: NativeExternalOpenTransitionResult['status'],
): void {
  if (result.status !== expected) {
    throw new Error(result.error ?? `External open ${expected} failed (${result.status}).`);
  }
}

function validateIntent(intent: NativeExternalOpenIntent): void {
  if (intent.error) throw new Error(intent.error);
  if (intent.kind === 'project' && !intent.result?.document) {
    throw new Error('The external project open intent was malformed.');
  }
  if (intent.kind === 'paper' && !intent.bytes) {
    throw new Error('The external Paper open intent was malformed.');
  }
}

/**
 * Register the one renderer allowed to transact external document opens. Main chooses whether
 * this renderer is the designated live Flow window and returns an epoch when authorized. Every
 * intent then follows offer → renderer guard → accept → apply → commit. Rejecting an offer does
 * not consume its idempotency key, and stale epochs cannot drain or mutate the queue.
 */
export function registerNativeExternalOpenConsumer(
  bridge: SignalLoomNativeBridge | undefined,
  handlers: NativeExternalOpenHandlers,
  options: NativeExternalOpenConsumerOptions = {},
): () => void {
  const authorize = bridge?.authorizeExternalOpenRenderer;
  const next = bridge?.nextExternalOpenIntent;
  const accept = bridge?.acceptExternalOpenIntent;
  const reject = bridge?.rejectExternalOpenIntent;
  const commit = bridge?.commitExternalOpenIntent;
  if (!authorize || !next || !accept || !reject || !commit) return () => {};

  let disposed = false;
  let epoch: string | undefined;
  let chain: Promise<void> = Promise.resolve();
  const commitRetryDelaysMs = options.commitRetryDelaysMs ?? DEFAULT_COMMIT_RETRY_DELAYS_MS;
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  }));
  const runProjectTransition = options.runProjectTransition ?? (async <T>(operation: () => Promise<T>) => operation());

  const ensureAuthorization = async (): Promise<string | undefined> => {
    if (epoch) return epoch;
    const result = await authorize();
    if (!result.authorized || !result.epoch) return undefined;
    epoch = result.epoch;
    return epoch;
  };

  const drain = () => {
    chain = chain.then(() => runProjectTransition(async () => {
      if (disposed) return;
      let activeEpoch: string | undefined;
      try {
        activeEpoch = await ensureAuthorization();
      } catch (error) {
        await handlers.onError({ kind: 'authorize', message: toErrorMessage(error) });
        return;
      }
      if (!activeEpoch || disposed) return;

      while (!disposed) {
        let response;
        try {
          response = await next(activeEpoch);
        } catch (error) {
          await handlers.onError({ kind: 'next', message: toErrorMessage(error) });
          return;
        }
        if (response.status === 'unauthorized') {
          epoch = undefined;
          return;
        }
        if (response.status !== 'offered' || !response.intent) return;

        const intent = response.intent;
        const request = { epoch: activeEpoch, intentId: intent.id };

        const commitAcceptedIntent = async (): Promise<boolean> => {
          let lastError: unknown;
          let committed = false;
          let committedTransition: NativeExternalOpenTransitionResult | undefined;
          for (let attempt = 0; attempt <= commitRetryDelaysMs.length; attempt += 1) {
            if (disposed) return false;
            try {
              const result = await commit(request);
              if (result.status !== 'committed' && result.status !== 'error') {
                lastError = new Error(result.error ?? `External open commit failed (${result.status}).`);
                break;
              }
              assertTransition(result, 'committed');
              committed = true;
              committedTransition = result;
              break;
            } catch (error) {
              lastError = error;
              if (attempt >= commitRetryDelaysMs.length) break;
              await wait(commitRetryDelaysMs[attempt]);
            }
          }
          if (!committed && !disposed) {
            await handlers.onError({
              kind: intent.kind,
              filePath: intent.filePath,
              message: toErrorMessage(lastError),
            });
          }
          if (!committed || disposed) return false;
          if (intent.kind === 'project' && intent.result) {
            try {
              await handlers.onProjectCommitted(intent.result, committedTransition!);
            } catch (error) {
              await handlers.onError({
                kind: intent.kind,
                filePath: intent.filePath,
                message: toErrorMessage(error),
              });
              return false;
            }
          }
          return true;
        };

        // An accepted intent has already been applied by this renderer; only its durable main
        // commit needs retrying. Reapplying would violate exactly-once behavior.
        if (response.state === 'accepted') {
          if (!await commitAcceptedIntent()) return;
          continue;
        }

        let applySucceeded = false;
        try {
          validateIntent(intent);
          if (intent.kind === 'project') {
            const authorized = await handlers.authorizeProject(intent.result!);
            if (authorized === false) {
              await reject({ ...request, reason: 'Project replacement canceled.' }).catch(() => undefined);
              continue;
            }
          }
          assertTransition(await accept(request), 'accepted');
          if (intent.kind === 'project') {
            await handlers.applyProject(intent.result!);
          } else {
            await handlers.applyPaper(new Uint8Array(intent.bytes!), intent.filePath);
          }
          applySucceeded = true;
          if (!await commitAcceptedIntent()) return;
        } catch (error) {
          // Apply failures are safe to reject: project restore rolls renderer state back and main
          // rolls its accepted staging state back. A commit failure is different — apply already
          // succeeded, so retain the accepted intent for a commit-only retry.
          if (!applySucceeded) {
            await reject({ ...request, reason: toErrorMessage(error) }).catch(() => undefined);
          }
          if (!applySucceeded) {
            await handlers.onError({
              kind: intent.kind,
              filePath: intent.filePath,
              message: toErrorMessage(error),
            });
          }
          if (applySucceeded) return;
        }
      }
    }));
  };

  const unsubscribe = bridge?.onExternalOpenPending?.(drain);
  drain();

  return () => {
    disposed = true;
    unsubscribe?.();
    void chain.finally(() => {
      void Promise.resolve(handlers.onProjectAbandoned?.()).finally(() => {
        if (epoch) void bridge?.releaseExternalOpenRenderer?.(epoch);
      });
    });
  };
}
