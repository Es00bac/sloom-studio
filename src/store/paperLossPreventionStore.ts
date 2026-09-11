import { create } from 'zustand';
import { shouldBypassConfirmations } from '../lib/automationBypass';

export type PaperLossDecision = 'save' | 'discard' | 'cancel';
export type PaperLossSaveResult =
  | { status: 'success' }
  | { status: 'canceled'; error?: string }
  | { status: 'failed' | 'unacknowledged'; error: string };

export interface PaperLossRequestOptions {
  key: string;
  title: string;
  message: string;
  documentTitles: readonly string[];
  save: () => Promise<PaperLossSaveResult>;
}
export interface PaperLossRequest extends PaperLossRequestOptions {
  id: string;
  error?: string;
  saving: boolean;
}

interface PaperLossPreventionState {
  activeRequest: PaperLossRequest | null;
  requestDecision: (options: PaperLossRequestOptions) => Promise<PaperLossDecision>;
  cancel: (requestId?: string) => void;
  discard: (requestId?: string) => void;
  save: (requestId?: string) => Promise<void>;
}

interface PendingPaperLossRequest {
  id: string;
  options: Readonly<PaperLossRequestOptions>;
  promise: Promise<PaperLossDecision>;
  settle: (decision: PaperLossDecision) => void;
}

export const PAPER_LOSS_PREVENTION_QUEUE_LIMIT = 32;

let activePendingRequest: PendingPaperLossRequest | undefined;
let queuedRequests: PendingPaperLossRequest[] = [];

function visibleRequest(entry: PendingPaperLossRequest): PaperLossRequest {
  return {
    ...entry.options,
    id: entry.id,
    saving: false,
  };
}

function createPendingRequest(options: PaperLossRequestOptions): PendingPaperLossRequest {
  let settled = false;
  let resolve!: (decision: PaperLossDecision) => void;
  const promise = new Promise<PaperLossDecision>((settle) => {
    resolve = settle;
  });
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    options: Object.freeze({
      ...options,
      documentTitles: Object.freeze([...options.documentTitles]),
    }),
    promise,
    settle: (decision) => {
      if (settled) return;
      settled = true;
      resolve(decision);
    },
  };
}

function completeActiveRequest(
  set: (patch: Partial<PaperLossPreventionState>) => void,
  decision: PaperLossDecision,
): void {
  const completed = activePendingRequest;
  if (!completed) return;
  activePendingRequest = queuedRequests.shift();
  completed.settle(decision);
  set({ activeRequest: activePendingRequest ? visibleRequest(activePendingRequest) : null });
}

function settleActiveRequest(
  state: PaperLossPreventionState,
  set: (patch: Partial<PaperLossPreventionState>) => void,
  decision: PaperLossDecision,
  requestId?: string,
): void {
  const request = state.activeRequest;
  if (!request || request.saving || (requestId && request.id !== requestId)) return;
  completeActiveRequest(set, decision);
}

export const usePaperLossPreventionStore = create<PaperLossPreventionState>()((set, get) => ({
  activeRequest: null,

  requestDecision: (options) => {
    if (shouldBypassConfirmations()) return Promise.resolve('discard');
    // Every invocation owns its content, callback, and decision. A shared key is routing metadata,
    // not proof that two independently captured workspaces are equivalent. At the hard bound, the
    // newest caller fails closed as Cancel without disturbing or retaining any earlier request.
    if ((activePendingRequest ? 1 : 0) + queuedRequests.length
      >= PAPER_LOSS_PREVENTION_QUEUE_LIMIT) return Promise.resolve('cancel');

    const pending = createPendingRequest(options);
    if (activePendingRequest) {
      queuedRequests.push(pending);
    } else {
      activePendingRequest = pending;
      set({ activeRequest: visibleRequest(pending) });
    }
    return pending.promise;
  },

  cancel: (requestId) => settleActiveRequest(get(), set, 'cancel', requestId),
  discard: (requestId) => settleActiveRequest(get(), set, 'discard', requestId),

  save: async (requestId) => {
    const request = get().activeRequest;
    if (!request || request.saving || (requestId && request.id !== requestId)) return;
    set({ activeRequest: { ...request, saving: true, error: undefined } });
    try {
      const result = await request.save();
      const current = get().activeRequest;
      if (!current || current.id !== request.id) return;
      if (result.status === 'success') {
        completeActiveRequest(set, 'save');
        return;
      }
      set({
        activeRequest: {
          ...current,
          saving: false,
          error: result.error ?? 'Save was canceled. The Paper document remains open and unchanged.',
        },
      });
    } catch (error) {
      const current = get().activeRequest;
      if (!current || current.id !== request.id) return;
      set({
        activeRequest: {
          ...current,
          saving: false,
          error: error instanceof Error ? error.message : 'Save failed. The Paper document remains open.',
        },
      });
    }
  },
}));

/** Fail closed and release every visible/queued decision, including during application unmount. */
export function resetPaperLossPrevention(): void {
  activePendingRequest?.settle('cancel');
  for (const request of queuedRequests) request.settle('cancel');
  activePendingRequest = undefined;
  queuedRequests = [];
  usePaperLossPreventionStore.setState({ activeRequest: null });
}

export const resetPaperLossPreventionForTests = resetPaperLossPrevention;
