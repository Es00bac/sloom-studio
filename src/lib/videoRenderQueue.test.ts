import { describe, expect, it } from 'vitest';

import {
  INTERRUPTED_OUTPUT_MESSAGE,
  MAX_CONCURRENT_VIDEO_RENDER_QUEUE_OUTPUTS,
  MAX_VIDEO_RENDER_QUEUE_ATTEMPTS,
  MAX_VIDEO_RENDER_QUEUE_JOBS,
  MISSING_OUTPUT_MESSAGE,
  cancelVideoRenderQueueJob,
  completeVideoRenderQueueOutput,
  deriveVideoRenderQueueJobStatus,
  failVideoRenderQueueOutput,
  isVideoRenderQueueJobStale,
  queueVideoRenderJob,
  reconcileVideoRenderQueue,
  retryVideoRenderQueueJob,
  selectNextVideoRenderQueueWork,
  startVideoRenderQueueOutput,
  summarizeVideoRenderQueue,
  type VideoRenderQueueOutput,
  type VideoRenderQueueRecord,
} from './videoRenderQueue';
import { sanitizeEditorProfessionalWorkflowState } from './videoProductionState';

const SIGNATURE = 'composition-signature-a';
const NOW = 1_700_000_000_000;

function output(overrides: Partial<VideoRenderQueueOutput> = {}): VideoRenderQueueOutput {
  return {
    id: 'out-1',
    label: 'Review video',
    fileName: 'project-review.mp4',
    extension: 'mp4',
    container: 'mp4',
    codec: 'h264',
    target: 'browser',
    status: 'queued',
    missingCapabilities: [],
    checksumIntent: 'sha256',
    manifestIntent: 'write-json',
    executionDurability: 'browser-session-only',
    truthfulnessNote: 'Browser delivery is session-only.',
    attempts: 0,
    ...overrides,
  };
}

function job(overrides: Partial<VideoRenderQueueRecord> = {}): VideoRenderQueueRecord {
  return {
    id: 'job-1',
    profileId: 'standard-delivery',
    compositionSignature: SIGNATURE,
    status: 'queued',
    createdAt: NOW,
    updatedAt: NOW,
    hostDurability: 'browser-session-only',
    outputs: [output()],
    ...overrides,
  };
}

function executionLeaseIdOf(records: readonly VideoRenderQueueRecord[], jobId = 'job-1', outputId = 'out-1'): string {
  const executionLeaseId = records.find((record) => record.id === jobId)?.outputs
    ?.find((entry) => entry.id === outputId)?.executionLeaseId;
  if (!executionLeaseId) throw new Error(`Expected active execution lease for ${jobId}:${outputId}.`);
  return executionLeaseId;
}

describe('restart reconciliation', () => {
  it('repairs a running output the previous session can no longer be honouring', () => {
    const records = [job({ status: 'running', outputs: [output({ status: 'running', attempts: 1 })] })];

    const result = reconcileVideoRenderQueue(records, { now: NOW + 1_000 });

    expect(result.changed).toBe(true);
    expect(result.interruptedOutputCount).toBe(1);
    expect(result.repairedJobIds).toEqual(['job-1']);
    expect(result.records[0].status).toBe('interrupted');
    expect(result.records[0].outputs?.[0]).toMatchObject({
      status: 'interrupted',
      error: INTERRUPTED_OUTPUT_MESSAGE,
      // The attempt was spent when the render started; recovery must not refund it.
      attempts: 1,
    });
    expect(result.records[0].updatedAt).toBe(NOW + 1_000);
  });

  it('is idempotent, so repeated loads never re-repair or re-dirty the project', () => {
    const records = [job({ status: 'running', outputs: [output({ status: 'running', attempts: 1 })] })];

    const first = reconcileVideoRenderQueue(records, { now: NOW + 1_000 });
    const second = reconcileVideoRenderQueue(first.records, { now: NOW + 2_000 });

    expect(second.changed).toBe(false);
    expect(second.interruptedOutputCount).toBe(0);
    expect(second.records).toEqual(first.records);
    expect(second.records[0].updatedAt).toBe(NOW + 1_000);
  });

  it('leaves an already-clean queue untouched so opening a project does not mark it edited', () => {
    const records = [job({ status: 'queued' }), job({ id: 'job-2', status: 'completed', outputs: [output({ status: 'succeeded' })] })];

    const result = reconcileVideoRenderQueue(records, { now: NOW + 1_000 });

    expect(result.changed).toBe(false);
    expect(result.reason).toContain('No persisted render-queue record');
    expect(result.records).toEqual(records);
  });

  it('never re-opens work that already produced a deliverable', () => {
    const records = [job({
      status: 'running',
      outputs: [
        output({ id: 'done', status: 'succeeded', attempts: 1, result: { byteSize: 2_048, checksum: 'abc' } }),
        output({ id: 'lost', status: 'running', attempts: 1 }),
      ],
    })];

    const result = reconcileVideoRenderQueue(records, { now: NOW + 1_000 });

    expect(result.records[0].outputs?.[0]).toMatchObject({ status: 'succeeded', result: { byteSize: 2_048 } });
    expect(result.records[0].outputs?.[1].status).toBe('interrupted');
    expect(result.records[0].status).toBe('interrupted');
  });

  it('leaves a user-cancelled job alone', () => {
    const records = [job({ status: 'cancelled', outputs: [output({ status: 'cancelled' })] })];

    const result = reconcileVideoRenderQueue(records, { now: NOW + 1_000 });

    expect(result.changed).toBe(false);
    expect(result.records[0].status).toBe('cancelled');
  });

  it('repairs a legacy record saved before per-output tracking existed', () => {
    const records = [job({ status: 'running', outputs: undefined })];

    const result = reconcileVideoRenderQueue(records, { now: NOW + 1_000 });

    expect(result.changed).toBe(true);
    expect(result.records[0].status).toBe('interrupted');
    expect(result.records[0].message).toBe(INTERRUPTED_OUTPUT_MESSAGE);
  });

  it('bounds the reconciled queue to what persistence will keep', () => {
    const records = Array.from({ length: MAX_VIDEO_RENDER_QUEUE_JOBS + 5 }, (_, index) =>
      job({ id: `job-${index}`, createdAt: NOW + index }));

    const result = reconcileVideoRenderQueue(records, { now: NOW + 1_000 });

    expect(result.records).toHaveLength(MAX_VIDEO_RENDER_QUEUE_JOBS);
  });

  it('forgets finished jobs before pending ones when the queue is over its bound', () => {
    // The oldest records are all finished; the newest are still waiting to run.
    const records = [
      ...Array.from({ length: MAX_VIDEO_RENDER_QUEUE_JOBS }, (_, index) =>
        job({ id: `done-${index}`, status: 'completed', createdAt: NOW + index, outputs: [output({ status: 'succeeded' })] })),
      job({ id: 'still-queued', createdAt: NOW + 1_000 }),
      job({ id: 'still-interrupted', status: 'interrupted', createdAt: NOW + 1_001, outputs: [output({ status: 'interrupted', attempts: 1 })] }),
    ];

    const result = reconcileVideoRenderQueue(records, { now: NOW + 2_000 });

    expect(result.records).toHaveLength(MAX_VIDEO_RENDER_QUEUE_JOBS);
    const keptIds = result.records.map((record) => record.id);
    expect(keptIds).toContain('still-queued');
    expect(keptIds).toContain('still-interrupted');
  });

  it('parks a delivered output whose artifact has since been deleted', () => {
    const records = [job({
      status: 'completed',
      outputs: [output({ status: 'succeeded', attempts: 1, result: { byteSize: 12, reference: 'library-item-1' } })],
    })];

    const result = reconcileVideoRenderQueue(records, { now: NOW + 1, resolveReference: () => false });

    expect(result.records[0].outputs?.[0]).toMatchObject({ status: 'interrupted', error: MISSING_OUTPUT_MESSAGE });
    expect(result.records[0].status).toBe('interrupted');
  });

  it('leaves a delivered output alone when the artifact is present or unverifiable', () => {
    const records = [job({
      status: 'completed',
      outputs: [output({ status: 'succeeded', attempts: 1, result: { reference: 'library-item-1' } })],
    })];

    expect(reconcileVideoRenderQueue(records, { now: NOW + 1, resolveReference: () => true }).changed).toBe(false);
    // No resolver at all means the caller cannot tell; guessing would re-run a finished render.
    expect(reconcileVideoRenderQueue(records, { now: NOW + 1 }).changed).toBe(false);
    expect(reconcileVideoRenderQueue(records, { now: NOW + 1, resolveReference: () => undefined }).changed).toBe(false);
  });
});

describe('admission and scheduling', () => {
  it('admits a planned job and refuses to admit it twice', () => {
    const records = [job({ status: 'planned' })];

    const admitted = queueVideoRenderJob(records, 'job-1', { now: NOW + 1, currentCompositionSignature: SIGNATURE });
    expect(admitted.changed).toBe(true);
    expect(admitted.records[0].status).toBe('queued');

    const again = queueVideoRenderJob(admitted.records, 'job-1', { now: NOW + 2, currentCompositionSignature: SIGNATURE });
    expect(again.changed).toBe(false);
    expect(again.reason).toContain('not a plan awaiting admission');
  });

  it('ignores a planned job until it is admitted', () => {
    expect(selectNextVideoRenderQueueWork([job({ status: 'planned' })])).toBeUndefined();
  });

  it('takes the oldest admitted job first', () => {
    const records = [
      job({ id: 'newer', createdAt: NOW + 500 }),
      job({ id: 'older', createdAt: NOW }),
    ];

    expect(selectNextVideoRenderQueueWork(records)).toMatchObject({ jobId: 'older' });
  });

  it('holds the concurrency bound while an output is running', () => {
    expect(MAX_CONCURRENT_VIDEO_RENDER_QUEUE_OUTPUTS).toBe(1);
    const records = [
      job({ id: 'busy', status: 'running', outputs: [output({ status: 'running', attempts: 1 })] }),
      job({ id: 'waiting', createdAt: NOW + 1 }),
    ];

    expect(selectNextVideoRenderQueueWork(records)).toBeUndefined();
  });

  it('skips a job frozen against an earlier cut instead of rendering the wrong composition', () => {
    const records = [job({ compositionSignature: 'older-signature' })];

    expect(isVideoRenderQueueJobStale(records[0], SIGNATURE)).toBe(true);
    expect(selectNextVideoRenderQueueWork(records, { currentCompositionSignature: SIGNATURE })).toBeUndefined();
    // With no live signature to compare against, staleness is unknowable and must not be invented.
    expect(selectNextVideoRenderQueueWork(records)).toMatchObject({ jobId: 'job-1' });
  });

  it('skips an output that has used every attempt', () => {
    const records = [job({ outputs: [output({ attempts: MAX_VIDEO_RENDER_QUEUE_ATTEMPTS })] })];

    expect(selectNextVideoRenderQueueWork(records)).toBeUndefined();
  });

  it('skips a blocked output that no target can satisfy', () => {
    const records = [job({ outputs: [output({ status: 'blocked', target: undefined, missingCapabilities: ['encode:prores-422-hq'] })] })];

    expect(selectNextVideoRenderQueueWork(records)).toBeUndefined();
  });
});

describe('execution transitions', () => {
  const selection = { jobId: 'job-1', outputId: 'out-1' };

  it('consumes one attempt on start', () => {
    const started = startVideoRenderQueueOutput([job()], selection, { now: NOW + 1, currentCompositionSignature: SIGNATURE });

    expect(started.changed).toBe(true);
    expect(started.records[0].outputs?.[0]).toMatchObject({ status: 'running', attempts: 1 });
    expect(started.records[0].status).toBe('running');
  });

  it('refuses to start a second output while one is running', () => {
    const records = [
      job({ id: 'busy', status: 'running', outputs: [output({ status: 'running', attempts: 1 })] }),
      job({ id: 'job-1' }),
    ];

    const result = startVideoRenderQueueOutput(records, selection, { now: NOW + 1 });

    expect(result.changed).toBe(false);
    expect(result.reason).toContain('already running');
  });

  it('refuses to start a stale job', () => {
    const result = startVideoRenderQueueOutput(
      [job({ compositionSignature: 'older-signature' })],
      selection,
      { now: NOW + 1, currentCompositionSignature: SIGNATURE },
    );

    expect(result.changed).toBe(false);
    expect(result.reason).toContain('frozen against an earlier cut');
  });

  it('records measured evidence on success', () => {
    const started = startVideoRenderQueueOutput([job()], selection, { now: NOW + 1 });
    const done = completeVideoRenderQueueOutput(started.records, selection, { byteSize: 4_096, checksum: 'deadbeef' }, {
      now: NOW + 2,
      id: executionLeaseIdOf(started.records),
    });

    expect(done.records[0].outputs?.[0]).toMatchObject({
      status: 'succeeded',
      result: { byteSize: 4_096, checksum: 'deadbeef' },
    });
    expect(done.records[0].status).toBe('completed');
  });

  it('rejects a byte size that is not a real measurement', () => {
    const started = startVideoRenderQueueOutput([job()], selection, { now: NOW + 1 });
    const done = completeVideoRenderQueueOutput(started.records, selection, { byteSize: -1 }, {
      now: NOW + 2,
      id: executionLeaseIdOf(started.records),
    });

    expect(done.records[0].outputs?.[0].result).toBeUndefined();
  });

  it('discards a completion that lands after the user cancelled', () => {
    const started = startVideoRenderQueueOutput([job()], selection, { now: NOW + 1 });
    const executionLeaseId = executionLeaseIdOf(started.records);
    const cancelled = cancelVideoRenderQueueJob(started.records, 'job-1', { now: NOW + 2 });

    const late = completeVideoRenderQueueOutput(cancelled.records, selection, { byteSize: 4_096 }, { now: NOW + 3, id: executionLeaseId });

    expect(late.changed).toBe(false);
    expect(late.reason).toContain('discarded');
    expect(late.records[0].outputs?.[0].status).toBe('cancelled');
    expect(late.records[0].status).toBe('cancelled');
  });

  it('discards a failure that lands after reconciliation already parked the output', () => {
    const started = startVideoRenderQueueOutput([job()], selection, { now: NOW + 1 });
    const executionLeaseId = executionLeaseIdOf(started.records);
    const reconciled = reconcileVideoRenderQueue(started.records, { now: NOW + 2 });

    const late = failVideoRenderQueueOutput(reconciled.records, selection, 'encoder exited', { now: NOW + 3, id: executionLeaseId });

    expect(late.changed).toBe(false);
    expect(late.records[0].outputs?.[0].status).toBe('interrupted');
  });

  it('reports a real failure with its reason', () => {
    const started = startVideoRenderQueueOutput([job()], selection, { now: NOW + 1 });
    const failed = failVideoRenderQueueOutput(started.records, selection, 'encoder exited with code 1', {
      now: NOW + 2,
      id: executionLeaseIdOf(started.records),
    });

    expect(failed.records[0].outputs?.[0]).toMatchObject({ status: 'failed', error: 'encoder exited with code 1' });
    expect(failed.records[0].status).toBe('failed');
  });

  it('does nothing for an unknown job or output', () => {
    expect(startVideoRenderQueueOutput([job()], { jobId: 'nope', outputId: 'out-1' }, { now: NOW }).reason)
      .toContain('No delivery job nope');
    expect(startVideoRenderQueueOutput([job()], { jobId: 'job-1', outputId: 'nope' }, { now: NOW }).reason)
      .toContain('no output nope');
  });

  it('refuses a stale completion after restart recovery retries the same output under a newer lease', () => {
    const first = startVideoRenderQueueOutput([job()], selection, { now: NOW + 1 });
    const firstLeaseId = executionLeaseIdOf(first.records);
    const recovered = reconcileVideoRenderQueue(first.records, { now: NOW + 2 });
    const retried = retryVideoRenderQueueJob(recovered.records, 'job-1', { now: NOW + 3, currentCompositionSignature: SIGNATURE });
    const second = startVideoRenderQueueOutput(retried.records, selection, { now: NOW + 4, currentCompositionSignature: SIGNATURE });
    const secondLeaseId = executionLeaseIdOf(second.records);

    expect(secondLeaseId).not.toBe(firstLeaseId);
    const stale = completeVideoRenderQueueOutput(second.records, selection, { byteSize: 4_096 }, { now: NOW + 5, id: firstLeaseId });
    expect(stale.changed).toBe(false);
    expect(stale.reason).toContain('newer execution lease');
    expect(stale.records[0].outputs?.[0]).toMatchObject({ status: 'running', executionLeaseId: secondLeaseId });

    const completed = completeVideoRenderQueueOutput(second.records, selection, { byteSize: 4_096 }, { now: NOW + 6, id: secondLeaseId });
    expect(completed.records[0].outputs?.[0]).toMatchObject({ status: 'succeeded', executionLeaseId: undefined });
  });
});

describe('resume, retry, and cancellation', () => {

  it('resumes only the work that was lost, never what already delivered', () => {
    const records = [job({
      status: 'interrupted',
      outputs: [
        output({ id: 'done', status: 'succeeded', attempts: 1, result: { byteSize: 10 } }),
        output({ id: 'lost', status: 'interrupted', attempts: 1, error: INTERRUPTED_OUTPUT_MESSAGE }),
        output({ id: 'broken', status: 'failed', attempts: 1, error: 'encoder exited' }),
      ],
    })];

    const resumed = retryVideoRenderQueueJob(records, 'job-1', { now: NOW + 1, currentCompositionSignature: SIGNATURE });

    expect(resumed.changed).toBe(true);
    expect(resumed.records[0].outputs?.map((entry) => entry.status)).toEqual(['succeeded', 'queued', 'queued']);
    expect(resumed.records[0].outputs?.[1].error).toBeUndefined();
    expect(resumed.records[0].status).toBe('queued');
  });

  it('parks permanently once an output has burned every attempt', () => {
    const records = [job({
      status: 'interrupted',
      outputs: [output({ id: 'lost', status: 'interrupted', attempts: MAX_VIDEO_RENDER_QUEUE_ATTEMPTS })],
    })];

    const resumed = retryVideoRenderQueueJob(records, 'job-1', { now: NOW + 1 });

    expect(resumed.changed).toBe(false);
    expect(resumed.reason).toContain(`all ${MAX_VIDEO_RENDER_QUEUE_ATTEMPTS} attempts`);
  });

  it('bounds a crash loop that interrupts on every single start', () => {
    let records: VideoRenderQueueRecord[] = [job({ outputs: [output({ id: 'lost' })] })];
    let starts = 0;

    for (let round = 0; round < MAX_VIDEO_RENDER_QUEUE_ATTEMPTS + 3; round += 1) {
      const next = selectNextVideoRenderQueueWork(records, { currentCompositionSignature: SIGNATURE });
      if (next) {
        const started = startVideoRenderQueueOutput(records, next, { now: NOW + round, currentCompositionSignature: SIGNATURE });
        if (started.changed) starts += 1;
        // The host dies before reporting an outcome, exactly as a hard crash would.
        records = reconcileVideoRenderQueue(started.records, { now: NOW + round }).records;
      }
      records = retryVideoRenderQueueJob(records, 'job-1', { now: NOW + round, currentCompositionSignature: SIGNATURE }).records;
    }

    expect(starts).toBe(MAX_VIDEO_RENDER_QUEUE_ATTEMPTS);
    expect(selectNextVideoRenderQueueWork(records, { currentCompositionSignature: SIGNATURE })).toBeUndefined();
  });

  it('refuses to resume a job frozen against an earlier cut', () => {
    const records = [job({
      compositionSignature: 'older-signature',
      status: 'interrupted',
      outputs: [output({ id: 'lost', status: 'interrupted', attempts: 1 })],
    })];

    const resumed = retryVideoRenderQueueJob(records, 'job-1', { now: NOW + 1, currentCompositionSignature: SIGNATURE });

    expect(resumed.changed).toBe(false);
    expect(resumed.reason).toContain('Re-plan');
  });

  it('cancels pending work, spares delivered work, and is idempotent', () => {
    const records = [job({
      status: 'running',
      outputs: [
        output({ id: 'done', status: 'succeeded', attempts: 1 }),
        output({ id: 'live', status: 'running', attempts: 1 }),
        output({ id: 'waiting', status: 'queued' }),
      ],
    })];

    const cancelled = cancelVideoRenderQueueJob(records, 'job-1', { now: NOW + 1 });
    expect(cancelled.records[0].outputs?.map((entry) => entry.status)).toEqual(['succeeded', 'cancelled', 'cancelled']);
    expect(cancelled.records[0].status).toBe('partial');

    const again = cancelVideoRenderQueueJob(cancelled.records, 'job-1', { now: NOW + 2 });
    expect(again.changed).toBe(false);
    expect(again.records).toEqual(cancelled.records);
  });

  it('cancels a legacy record that has no per-output detail', () => {
    const cancelled = cancelVideoRenderQueueJob([job({ status: 'planned', outputs: undefined })], 'job-1', { now: NOW + 1 });

    expect(cancelled.changed).toBe(true);
    expect(cancelled.records[0].status).toBe('cancelled');
  });
});

describe('derived job status', () => {
  it.each([
    [['running', 'queued'], 'running'],
    [['queued', 'succeeded'], 'queued'],
    [['interrupted', 'succeeded'], 'interrupted'],
    [['succeeded', 'succeeded'], 'completed'],
    [['succeeded', 'failed'], 'partial'],
    [['succeeded', 'cancelled'], 'partial'],
    [['failed', 'blocked'], 'failed'],
    [['blocked'], 'failed'],
    [['cancelled', 'cancelled'], 'cancelled'],
  ] as const)('derives %s as %s', (statuses, expected) => {
    const outputs = statuses.map((status, index) => output({ id: `out-${index}`, status }));
    expect(deriveVideoRenderQueueJobStatus(outputs, 'queued')).toBe(expected);
  });

  it('keeps the record status when there is no per-output detail to derive from', () => {
    expect(deriveVideoRenderQueueJobStatus([], 'planned')).toBe('planned');
  });
});

describe('mounted queue summary', () => {
  it('counts every lifecycle state and flags stale plans', () => {
    const records = [
      job({ id: 'a', status: 'queued', outputs: [output({ status: 'queued' }), output({ id: 'b', status: 'succeeded' })] }),
      job({ id: 'stale', compositionSignature: 'older-signature', outputs: [output({ status: 'queued' })] }),
      job({ id: 'lost', status: 'interrupted', outputs: [output({ status: 'interrupted' })] }),
    ];

    const summary = summarizeVideoRenderQueue(records, { currentCompositionSignature: SIGNATURE });

    expect(summary).toMatchObject({
      jobs: 3,
      queuedJobs: 2,
      interruptedJobs: 1,
      outputs: 4,
      queuedOutputs: 2,
      succeededOutputs: 1,
      interruptedOutputs: 1,
      staleJobIds: ['stale'],
      hasRunnableWork: true,
    });
    expect(summary.activeSelection).toMatchObject({ jobId: 'a', outputId: 'out-1' });
  });

  it('reports no runnable work once everything is parked', () => {
    const summary = summarizeVideoRenderQueue(
      [job({ status: 'interrupted', outputs: [output({ status: 'interrupted', attempts: 1 })] })],
      { currentCompositionSignature: SIGNATURE },
    );

    expect(summary.hasRunnableWork).toBe(false);
    expect(summary.activeSelection).toBeUndefined();
  });
});

describe('persistence compatibility', () => {
  it('persists an active lease only long enough to reject stale callbacks after reopen', () => {
    const started = startVideoRenderQueueOutput([job()], { jobId: 'job-1', outputId: 'out-1' }, { now: NOW + 1 });
    const executionLeaseId = executionLeaseIdOf(started.records);
    const reopened = sanitizeEditorProfessionalWorkflowState({ deliveryJobs: started.records });

    expect(reopened.deliveryJobs[0].outputs?.[0]).toMatchObject({
      status: 'running',
      executionLeaseId,
      attempts: 1,
    });

    const recovered = reconcileVideoRenderQueue(reopened.deliveryJobs, { now: NOW + 2 });
    expect(recovered.records[0].outputs?.[0]).toMatchObject({
      status: 'interrupted',
      executionLeaseId: undefined,
      attempts: 1,
    });
  });

  it('round-trips the queue lifecycle through the saved project shape', () => {
    const started = startVideoRenderQueueOutput([job()], { jobId: 'job-1', outputId: 'out-1' }, { now: NOW + 1 });
    const done = completeVideoRenderQueueOutput(started.records, { jobId: 'job-1', outputId: 'out-1' }, { byteSize: 512, checksum: 'feed' }, {
      now: NOW + 2,
      id: executionLeaseIdOf(started.records),
    });
    const interrupted = reconcileVideoRenderQueue(
      [...done.records, job({ id: 'job-2', status: 'running', outputs: [output({ status: 'running', attempts: 2 })] })],
      { now: NOW + 3 },
    );

    const restored = sanitizeEditorProfessionalWorkflowState({ deliveryJobs: interrupted.records });

    expect(restored.deliveryJobs[0].outputs?.[0]).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      result: { byteSize: 512, checksum: 'feed' },
    });
    expect(restored.deliveryJobs[1].status).toBe('interrupted');
    expect(restored.deliveryJobs[1].outputs?.[0]).toMatchObject({ status: 'interrupted', attempts: 2 });
    // A reload of an already-repaired queue must stay clean.
    expect(reconcileVideoRenderQueue(restored.deliveryJobs, { now: NOW + 4 }).changed).toBe(false);
  });

  it('accepts a record written before the queue lifecycle existed', () => {
    const restored = sanitizeEditorProfessionalWorkflowState({
      deliveryJobs: [{
        id: 'legacy-job',
        profileId: 'standard-delivery',
        compositionSignature: SIGNATURE,
        status: 'running',
        createdAt: NOW,
        updatedAt: NOW,
        hostDurability: 'native-restart-check',
        outputs: [{
          id: 'legacy-output',
          label: 'Master video',
          fileName: 'master.mov',
          status: 'running',
          missingCapabilities: [],
          truthfulnessNote: 'Saved before per-attempt tracking.',
        }],
      }],
    });

    expect(restored.deliveryJobs[0].outputs?.[0]).toMatchObject({ status: 'running', attempts: 0 });

    const reconciled = reconcileVideoRenderQueue(restored.deliveryJobs, { now: NOW + 1 });

    expect(reconciled.changed).toBe(true);
    expect(reconciled.records[0].status).toBe('interrupted');
    // A legacy output starts with a full attempt budget, so recovery is still offered.
    expect(retryVideoRenderQueueJob(reconciled.records, 'legacy-job', { now: NOW + 2 }).changed).toBe(true);
  });

  it('clamps a hand-edited attempt count to the retry ceiling', () => {
    const restored = sanitizeEditorProfessionalWorkflowState({
      deliveryJobs: [{ ...job(), outputs: [{ ...output(), attempts: 9_999 }] }],
    });

    expect(restored.deliveryJobs[0].outputs?.[0].attempts).toBe(MAX_VIDEO_RENDER_QUEUE_ATTEMPTS);
    expect(selectNextVideoRenderQueueWork(restored.deliveryJobs)).toBeUndefined();
  });
});
