import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/automationBypass', () => ({
  shouldBypassConfirmations: () => false,
}));

import {
  PAPER_LOSS_PREVENTION_QUEUE_LIMIT,
  resetPaperLossPrevention,
  resetPaperLossPreventionForTests,
  usePaperLossPreventionStore,
} from './paperLossPreventionStore';

function request(key: string, title: string) {
  return usePaperLossPreventionStore.getState().requestDecision({
    key,
    title,
    message: `${title} message`,
    documentTitles: [`${title} document`],
    save: async () => ({ status: 'failed', error: 'not selected' }),
  });
}

beforeEach(() => {
  resetPaperLossPreventionForTests();
});

describe('Paper loss-prevention request serialization', () => {
  it('queues a different destructive request and surfaces it after the active decision', async () => {
    const first = request('file:open', 'Open Project');
    const second = request('file:new', 'New Project');

    expect(usePaperLossPreventionStore.getState().activeRequest?.title).toBe('Open Project');
    usePaperLossPreventionStore.getState().cancel();

    await expect(first).resolves.toBe('cancel');
    expect(usePaperLossPreventionStore.getState().activeRequest?.title).toBe('New Project');
    usePaperLossPreventionStore.getState().discard();
    await expect(second).resolves.toBe('discard');
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
  });

  it('keeps same-key invocations distinct and pairs each visible decision in FIFO order', async () => {
    const first = request('file:open', 'Open Project');
    const duplicate = request('file:open', 'Second Open');
    const queued = request('file:new', 'New Project');

    expect(duplicate).not.toBe(first);
    const firstId = usePaperLossPreventionStore.getState().activeRequest!.id;
    usePaperLossPreventionStore.getState().discard(firstId);
    await expect(first).resolves.toBe('discard');
    expect(usePaperLossPreventionStore.getState().activeRequest?.title).toBe('Second Open');

    usePaperLossPreventionStore.getState().cancel(firstId);
    expect(usePaperLossPreventionStore.getState().activeRequest?.title).toBe('Second Open');
    usePaperLossPreventionStore.getState().discard();
    await expect(duplicate).resolves.toBe('discard');
    expect(usePaperLossPreventionStore.getState().activeRequest?.title).toBe('New Project');

    usePaperLossPreventionStore.getState().cancel();
    await expect(queued).resolves.toBe('cancel');
  });

  it('calls only the save callback paired with each same-key request, once and in order', async () => {
    const calls: string[] = [];
    const firstSave = vi.fn(async () => {
      calls.push('first');
      return { status: 'success' as const };
    });
    const secondSave = vi.fn(async () => {
      calls.push('second');
      return { status: 'success' as const };
    });
    const first = usePaperLossPreventionStore.getState().requestDecision({
      key: 'same-key', title: 'First', message: 'First message', documentTitles: ['First document'], save: firstSave,
    });
    const second = usePaperLossPreventionStore.getState().requestDecision({
      key: 'same-key', title: 'Second', message: 'Second message', documentTitles: ['Second document'], save: secondSave,
    });

    await usePaperLossPreventionStore.getState().save();
    await expect(first).resolves.toBe('save');
    expect(usePaperLossPreventionStore.getState().activeRequest?.title).toBe('Second');
    expect(firstSave).toHaveBeenCalledTimes(1);
    expect(secondSave).not.toHaveBeenCalled();

    await usePaperLossPreventionStore.getState().save();
    await expect(second).resolves.toBe('save');
    expect(calls).toEqual(['first', 'second']);
    expect(firstSave).toHaveBeenCalledTimes(1);
    expect(secondSave).toHaveBeenCalledTimes(1);
  });

  it('keeps failure/retry on its paired request and reset settles every remaining promise once', async () => {
    let releaseSave!: () => void;
    const retrySave = vi.fn()
      .mockResolvedValueOnce({ status: 'failed', error: 'disk full' })
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { releaseSave = resolve; });
        return { status: 'success' as const };
      });
    const laterSave = vi.fn(async () => ({ status: 'success' as const }));
    const first = usePaperLossPreventionStore.getState().requestDecision({
      key: 'retry', title: 'Retry', message: 'Retry message', documentTitles: ['Retry document'], save: retrySave,
    });
    const second = usePaperLossPreventionStore.getState().requestDecision({
      key: 'retry', title: 'Later', message: 'Later message', documentTitles: ['Later document'], save: laterSave,
    });

    await usePaperLossPreventionStore.getState().save();
    expect(usePaperLossPreventionStore.getState().activeRequest).toMatchObject({
      title: 'Retry', saving: false, error: 'disk full',
    });
    const retry = usePaperLossPreventionStore.getState().save();
    expect(retrySave).toHaveBeenCalledTimes(2);
    resetPaperLossPrevention();

    await expect(first).resolves.toBe('cancel');
    await expect(second).resolves.toBe('cancel');
    expect(laterSave).not.toHaveBeenCalled();
    releaseSave();
    await retry;
    await expect(first).resolves.toBe('cancel');
    expect(usePaperLossPreventionStore.getState().activeRequest).toBeNull();
  });

  it('bounds retained requests and fails excess callers closed without displacing the FIFO', async () => {
    const decisions = Array.from({ length: PAPER_LOSS_PREVENTION_QUEUE_LIMIT + 1 }, (_, index) => (
      request('bounded', `Request ${index}`)
    ));

    await expect(decisions.at(-1)).resolves.toBe('cancel');
    expect(usePaperLossPreventionStore.getState().activeRequest?.title).toBe('Request 0');
    resetPaperLossPrevention();
    await expect(Promise.all(decisions.slice(0, -1))).resolves
      .toEqual(Array(PAPER_LOSS_PREVENTION_QUEUE_LIMIT).fill('cancel'));
  });
});
