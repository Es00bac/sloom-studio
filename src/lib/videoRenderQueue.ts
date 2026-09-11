/**
 * Durable render-queue lifecycle for Video delivery jobs.
 *
 * The persisted `VideoDeliveryJobRecord[]` on a composition is the queue. This module owns every
 * transition over that persisted shape so the saved project is the single source of truth and the
 * queue survives a reload, a crash, or a workspace switch without an in-memory mirror to fall out
 * of sync with.
 *
 * Three rules make the lifecycle truthful rather than optimistic:
 *
 * 1. `running` is only ever true for the session that started the work. Nothing can still be running
 *    from a process that no longer exists, so `reconcileVideoRenderQueue` repairs a reloaded
 *    `running` output to `interrupted` — a state distinct from `failed`, because "the renderer went
 *    away" and "the render was attempted and did not work" call for different user decisions.
 * 2. Interrupted work parks. It never silently restarts, so a crash stays visible and a long encode
 *    the user may no longer want is never re-spent without an explicit action.
 * 3. A job freezes the composition signature it was planned against. Once the edit moves on, that
 *    job can no longer be honestly executed — rendering the current cut under the frozen signature
 *    would mislabel it — so stale jobs are refused rather than quietly rendered.
 *
 * Every exported transition is total and idempotent: it never throws, and re-applying it to its own
 * output changes nothing. The runner and the user race by construction (a cancel can land while an
 * output is mid-flight), so an inapplicable transition reports `changed: false` with a reason
 * instead of raising into an effect that has nowhere to put the error.
 *
 * This module performs no IPC, rendering, file writes, hashing, or downloads.
 */

import type { VideoDeliveryJobRecord } from '../types/videoProduction';
import {
  MAX_VIDEO_DELIVERY_JOBS,
  MAX_VIDEO_DELIVERY_OUTPUT_ATTEMPTS,
  pruneVideoDeliveryJobsToBound,
} from './videoProductionState';

/** Reused from persistence so reconciliation can never keep more records than a save will retain. */
export const MAX_VIDEO_RENDER_QUEUE_JOBS = MAX_VIDEO_DELIVERY_JOBS;
/** One at a time. Concurrent encodes contend for the same CPU, disk, and native renderer slot. */
export const MAX_CONCURRENT_VIDEO_RENDER_QUEUE_OUTPUTS = 1;
/**
 * Bounded starts per output. An output that hard-crashes the host on every attempt would otherwise
 * be resumed forever, so the third interruption parks permanently instead of looping. Shared with
 * the persistence clamp so the two can never drift apart.
 */
export const MAX_VIDEO_RENDER_QUEUE_ATTEMPTS = MAX_VIDEO_DELIVERY_OUTPUT_ATTEMPTS;
const MAX_QUEUE_MESSAGE_LENGTH = 2_000;

export type VideoRenderQueueRecord = VideoDeliveryJobRecord;
export type VideoRenderQueueJobStatus = VideoDeliveryJobRecord['status'];
export type VideoRenderQueueOutput = NonNullable<VideoDeliveryJobRecord['outputs']>[number];
export type VideoRenderQueueOutputStatus = VideoRenderQueueOutput['status'];

export const INTERRUPTED_OUTPUT_MESSAGE =
  'Interrupted: the session that was rendering this output stopped before it finished.';

export interface VideoRenderQueueSelection {
  jobId: string;
  outputId: string;
  target: 'native' | 'browser';
}

export interface VideoRenderQueueOutputResult {
  byteSize?: number;
  checksum?: string;
  reference?: string;
}

/** The persisted capability held by exactly one in-flight attempt. */
export interface VideoRenderQueueExecutionLease {
  id: string;
}

/**
 * Answers whether a previously delivered artifact is still there. Returning `undefined` means
 * "cannot tell from here", which is treated as "leave it alone" — an unverifiable artifact is never
 * downgraded on a guess, because that would re-run a finished render for no reason.
 */
export type VideoRenderQueueReferenceResolver = (reference: string) => boolean | undefined;

export const MISSING_OUTPUT_MESSAGE =
  'The delivered file is no longer where this job recorded it. Resume to render it again.';

export interface VideoRenderQueueTransition {
  records: VideoRenderQueueRecord[];
  changed: boolean;
  /** Why an inapplicable transition did nothing. Absent when `changed` is true. */
  reason?: string;
}

export interface VideoRenderQueueReconciliation extends VideoRenderQueueTransition {
  /** Outputs repaired from a `running` claim no live process could still be honouring. */
  interruptedOutputCount: number;
  repairedJobIds: string[];
}

export interface VideoRenderQueueSummary {
  jobs: number;
  queuedJobs: number;
  runningJobs: number;
  interruptedJobs: number;
  staleJobIds: string[];
  outputs: number;
  queuedOutputs: number;
  runningOutputs: number;
  interruptedOutputs: number;
  succeededOutputs: number;
  failedOutputs: number;
  blockedOutputs: number;
  cancelledOutputs: number;
  /** True when at least one output can be started right now. */
  hasRunnableWork: boolean;
  activeSelection?: VideoRenderQueueSelection;
}

export interface VideoRenderQueueContext {
  now: number;
  /**
   * The composition signature the editor currently holds. When supplied, jobs frozen against a
   * different signature are treated as stale and refused rather than rendered under a stale label.
   */
  currentCompositionSignature?: string;
}

type VideoRenderQueueCompletionContext = Pick<VideoRenderQueueContext, 'now'> & VideoRenderQueueExecutionLease;

/** Job statuses the scheduler will look inside for runnable outputs. */
const ADMITTED_JOB_STATUSES = new Set<VideoRenderQueueJobStatus>(['queued', 'running']);
/** Outputs whose story is over. Reconciliation, cancel, and retry all leave these untouched. */
const TERMINAL_OUTPUT_STATUSES = new Set<VideoRenderQueueOutputStatus>(['succeeded', 'blocked', 'cancelled']);

function createExecutionLeaseId(
  record: VideoRenderQueueRecord,
  output: VideoRenderQueueOutput,
  attempts: number,
  now: number,
): string {
  // Attempts never decrease, so the fallback stays distinct even if a restored session shares the
  // same millisecond clock value. The normal route is a random opaque capability; the runner only
  // returns it to the exact async operation it started.
  const nonce = globalThis.crypto?.randomUUID?.()
    ?? `${record.id}:${output.id}:${attempts}:${Math.max(0, Math.round(now))}`;
  return `queue:${nonce}`.slice(0, 256);
}

export function isVideoRenderQueueJobStale(
  record: VideoRenderQueueRecord,
  currentCompositionSignature: string | undefined,
): boolean {
  if (!currentCompositionSignature) return false;
  return record.compositionSignature !== currentCompositionSignature;
}

/**
 * Derives a job status from its outputs. Runnable states outrank terminal ones so a job is never
 * reported finished while work remains, and `interrupted` outranks every terminal state so a crash
 * is never rounded down to "partial" or "failed".
 */
export function deriveVideoRenderQueueJobStatus(
  outputs: readonly VideoRenderQueueOutput[],
  fallback: VideoRenderQueueJobStatus,
): VideoRenderQueueJobStatus {
  if (outputs.length === 0) return fallback;
  const count = (status: VideoRenderQueueOutputStatus) =>
    outputs.filter((output) => output.status === status).length;

  if (count('running') > 0) return 'running';
  if (count('queued') > 0) return 'queued';
  if (count('interrupted') > 0) return 'interrupted';

  const succeeded = count('succeeded');
  if (succeeded === outputs.length) return 'completed';

  const cancelled = count('cancelled');
  const failed = count('failed');
  const blocked = count('blocked');
  if (cancelled === outputs.length) return 'cancelled';
  if (succeeded > 0 && (failed > 0 || blocked > 0 || cancelled > 0)) return 'partial';
  if (failed > 0 || blocked > 0) return 'failed';
  return 'cancelled';
}

/**
 * Restart recovery. Call once when a composition is first observed in a session, before the runner
 * is allowed to start anything.
 *
 * Repairs each `running` output to `interrupted` and re-derives job status from the repaired
 * outputs. Terminal outputs and user-cancelled jobs are never touched, so a resumed queue can never
 * re-run work that already produced a deliverable. Returns the input array unchanged when there is
 * nothing to repair, which keeps a clean reload from dirtying the project.
 */
export function reconcileVideoRenderQueue(
  records: readonly VideoRenderQueueRecord[],
  context: Pick<VideoRenderQueueContext, 'now'> & { resolveReference?: VideoRenderQueueReferenceResolver },
): VideoRenderQueueReconciliation {
  const bounded = pruneVideoDeliveryJobsToBound(records, MAX_VIDEO_RENDER_QUEUE_JOBS);
  const repairedJobIds: string[] = [];
  let interruptedOutputCount = 0;

  const reconciled = bounded.map((record) => {
    // A cancelled job is the user's own terminal decision; reconciliation has no business reopening it.
    if (record.status === 'cancelled') return record;

    const outputs = record.outputs;
    if (!outputs || outputs.length === 0) {
      // Legacy record saved before per-output tracking existed. The job-level claim is all there is.
      if (record.status !== 'running') return record;
      repairedJobIds.push(record.id);
      return {
        ...record,
        status: 'interrupted' as const,
        updatedAt: context.now,
        message: INTERRUPTED_OUTPUT_MESSAGE,
      };
    }

    let outputsChanged = false;
    const repairedOutputs = outputs.map((output) => {
      if (output.status === 'succeeded') {
        // A delivered artifact that has since been deleted is no longer delivered. Only demote it
        // when the caller can actually prove the file is gone.
        const reference = output.result?.reference;
        if (!reference || context.resolveReference?.(reference) !== false) return output;
        outputsChanged = true;
        interruptedOutputCount += 1;
        return {
          ...output,
          status: 'interrupted' as const,
          executionLeaseId: undefined,
          error: MISSING_OUTPUT_MESSAGE,
        };
      }
      if (output.status !== 'running') return output;
      outputsChanged = true;
      interruptedOutputCount += 1;
      return {
        ...output,
        status: 'interrupted' as const,
        executionLeaseId: undefined,
        error: INTERRUPTED_OUTPUT_MESSAGE,
      };
    });

    const nextStatus = deriveVideoRenderQueueJobStatus(repairedOutputs, record.status);
    if (!outputsChanged && nextStatus === record.status) return record;

    repairedJobIds.push(record.id);
    return {
      ...record,
      status: nextStatus,
      outputs: repairedOutputs,
      updatedAt: context.now,
      ...(outputsChanged ? { message: INTERRUPTED_OUTPUT_MESSAGE } : {}),
    };
  });

  const changed = repairedJobIds.length > 0 || bounded.length !== records.length;
  return {
    records: changed ? reconciled : [...records],
    changed,
    interruptedOutputCount,
    repairedJobIds,
    ...(changed ? {} : { reason: 'No persisted render-queue record claimed work from a previous session.' }),
  };
}

/** Admits a planned job to the queue so the scheduler will consider its outputs. */
export function queueVideoRenderJob(
  records: readonly VideoRenderQueueRecord[],
  jobId: string,
  context: VideoRenderQueueContext,
): VideoRenderQueueTransition {
  return updateJob(records, jobId, (record) => {
    if (isVideoRenderQueueJobStale(record, context.currentCompositionSignature)) {
      return { reason: staleReason(jobId) };
    }
    if (record.status !== 'planned') {
      return { reason: `Delivery job ${jobId} is ${record.status}, not a plan awaiting admission.` };
    }
    const outputs = record.outputs;
    if (!outputs || !outputs.some((output) => output.status === 'queued')) {
      return { reason: `Delivery job ${jobId} has no runnable output to admit.` };
    }
    return {
      record: {
        ...record,
        status: deriveVideoRenderQueueJobStatus(outputs, 'queued'),
        updatedAt: context.now,
        message: 'Admitted to the durable render queue.',
      },
    };
  });
}

/**
 * Picks the next output to start, oldest job first, honouring the concurrency bound. Returns
 * nothing while an output is already running, so the runner cannot double-start across renders.
 */
export function selectNextVideoRenderQueueWork(
  records: readonly VideoRenderQueueRecord[],
  context: Pick<VideoRenderQueueContext, 'currentCompositionSignature'> = {},
): VideoRenderQueueSelection | undefined {
  if (countRunningOutputs(records) >= MAX_CONCURRENT_VIDEO_RENDER_QUEUE_OUTPUTS) return undefined;

  const ordered = [...records].sort((left, right) =>
    left.createdAt - right.createdAt || left.id.localeCompare(right.id));

  for (const record of ordered) {
    if (!ADMITTED_JOB_STATUSES.has(record.status)) continue;
    if (isVideoRenderQueueJobStale(record, context.currentCompositionSignature)) continue;
    for (const output of record.outputs ?? []) {
      if (output.status !== 'queued' || !output.target) continue;
      if ((output.attempts ?? 0) >= MAX_VIDEO_RENDER_QUEUE_ATTEMPTS) continue;
      return { jobId: record.id, outputId: output.id, target: output.target };
    }
  }
  return undefined;
}

/** Marks an output running and consumes one attempt. The attempt is spent on the start, not the outcome, so a crash loop is bounded. */
export function startVideoRenderQueueOutput(
  records: readonly VideoRenderQueueRecord[],
  selection: Pick<VideoRenderQueueSelection, 'jobId' | 'outputId'>,
  context: VideoRenderQueueContext,
): VideoRenderQueueTransition {
  if (countRunningOutputs(records) >= MAX_CONCURRENT_VIDEO_RENDER_QUEUE_OUTPUTS) {
    return unchanged(records, 'Another render-queue output is already running.');
  }
  return updateOutput(records, selection, (record, output) => {
    if (isVideoRenderQueueJobStale(record, context.currentCompositionSignature)) {
      return { reason: staleReason(record.id) };
    }
    if (!ADMITTED_JOB_STATUSES.has(record.status)) {
      return { reason: `Delivery job ${record.id} is ${record.status} and is not admitted to the queue.` };
    }
    if (output.status !== 'queued') {
      return { reason: `Output ${output.id} is ${output.status}, not queued.` };
    }
    if (!output.target) {
      return { reason: `Output ${output.id} has no execution target.` };
    }
    const attempts = (output.attempts ?? 0) + 1;
    if (attempts > MAX_VIDEO_RENDER_QUEUE_ATTEMPTS) {
      return { reason: `Output ${output.id} has used all ${MAX_VIDEO_RENDER_QUEUE_ATTEMPTS} attempts.` };
    }
    return {
      output: {
        ...output,
        status: 'running',
        attempts,
        executionLeaseId: createExecutionLeaseId(record, output, attempts, context.now),
        error: undefined,
      },
    };
  }, context.now, 'Rendering.');
}

/**
 * Records a real produced deliverable. Only a running output can succeed, which makes a callback
 * that arrives after a cancel or a reconciliation a no-op rather than a resurrection.
 */
export function completeVideoRenderQueueOutput(
  records: readonly VideoRenderQueueRecord[],
  selection: Pick<VideoRenderQueueSelection, 'jobId' | 'outputId'>,
  result: VideoRenderQueueOutputResult,
  context: VideoRenderQueueCompletionContext,
): VideoRenderQueueTransition {
  return updateOutput(records, selection, (_record, output) => {
    if (output.status !== 'running') {
      return { reason: `Output ${output.id} is ${output.status}, so a completion callback was discarded.` };
    }
    if (!output.executionLeaseId || output.executionLeaseId !== context.id) {
      return { reason: `Output ${output.id} is running under a newer execution lease, so a completion callback was discarded.` };
    }
    return {
      output: {
        ...output,
        status: 'succeeded',
        executionLeaseId: undefined,
        error: undefined,
        result: normalizeResult(result),
      },
    };
  }, context.now, 'Delivered.');
}

/** Records a real failure. Same running-only guard as completion. */
export function failVideoRenderQueueOutput(
  records: readonly VideoRenderQueueRecord[],
  selection: Pick<VideoRenderQueueSelection, 'jobId' | 'outputId'>,
  error: string,
  context: VideoRenderQueueCompletionContext,
): VideoRenderQueueTransition {
  const message = clampMessage(error) || 'The render failed without a reported reason.';
  return updateOutput(records, selection, (_record, output) => {
    if (output.status !== 'running') {
      return { reason: `Output ${output.id} is ${output.status}, so a failure callback was discarded.` };
    }
    if (!output.executionLeaseId || output.executionLeaseId !== context.id) {
      return { reason: `Output ${output.id} is running under a newer execution lease, so a failure callback was discarded.` };
    }
    return { output: { ...output, status: 'failed', executionLeaseId: undefined, error: message } };
  }, context.now, message);
}

/**
 * The single user action behind both Resume and Retry: re-queues every output that stopped without
 * delivering, provided it still has attempts left. Succeeded outputs are never re-queued, so
 * resuming a partly finished batch after a crash costs only the work that was actually lost.
 */
export function retryVideoRenderQueueJob(
  records: readonly VideoRenderQueueRecord[],
  jobId: string,
  context: VideoRenderQueueContext,
): VideoRenderQueueTransition {
  return updateJob(records, jobId, (record) => {
    if (isVideoRenderQueueJobStale(record, context.currentCompositionSignature)) {
      return { reason: staleReason(jobId) };
    }
    const outputs = record.outputs;
    if (!outputs || outputs.length === 0) {
      return { reason: `Delivery job ${jobId} has no per-output record to resume.` };
    }
    let exhausted = 0;
    let requeued = 0;
    const nextOutputs = outputs.map((output) => {
      if (output.status !== 'failed' && output.status !== 'interrupted') return output;
      if ((output.attempts ?? 0) >= MAX_VIDEO_RENDER_QUEUE_ATTEMPTS) {
        exhausted += 1;
        return {
          ...output,
          status: 'failed' as const,
          error: `Stopped after ${MAX_VIDEO_RENDER_QUEUE_ATTEMPTS} attempts. Re-plan this delivery to try again.`,
        };
      }
      requeued += 1;
      return { ...output, status: 'queued' as const, executionLeaseId: undefined, error: undefined };
    });
    if (requeued === 0) {
      return {
        reason: exhausted > 0
          ? `Every stopped output in ${jobId} has used all ${MAX_VIDEO_RENDER_QUEUE_ATTEMPTS} attempts.`
          : `Delivery job ${jobId} has no stopped output to resume.`,
      };
    }
    return {
      record: {
        ...record,
        status: deriveVideoRenderQueueJobStatus(nextOutputs, 'queued'),
        outputs: nextOutputs,
        updatedAt: context.now,
        message: `Re-queued ${requeued} stopped output${requeued === 1 ? '' : 's'}.`,
      },
    };
  });
}

/**
 * Cancels everything not yet delivered. Deliberately covers `running`: the runner checks the
 * persisted status before it commits a result, so a cancel that lands mid-flight is honoured rather
 * than overwritten by the in-flight completion.
 */
export function cancelVideoRenderQueueJob(
  records: readonly VideoRenderQueueRecord[],
  jobId: string,
  context: Pick<VideoRenderQueueContext, 'now'>,
): VideoRenderQueueTransition {
  return updateJob(records, jobId, (record) => {
    const outputs = record.outputs;
    if (!outputs || outputs.length === 0) {
      if (record.status === 'cancelled' || record.status === 'completed') {
        return { reason: `Delivery job ${jobId} is already ${record.status}.` };
      }
      return {
        record: {
          ...record,
          status: 'cancelled' as const,
          updatedAt: context.now,
          message: 'Cancelled before or during host execution.',
        },
      };
    }
    let cancelledCount = 0;
    const nextOutputs = outputs.map((output) => {
      if (TERMINAL_OUTPUT_STATUSES.has(output.status)) return output;
      cancelledCount += 1;
      return { ...output, status: 'cancelled' as const, executionLeaseId: undefined, error: undefined };
    });
    if (cancelledCount === 0) {
      return { reason: `Delivery job ${jobId} has no pending output left to cancel.` };
    }
    return {
      record: {
        ...record,
        status: deriveVideoRenderQueueJobStatus(nextOutputs, 'cancelled'),
        outputs: nextOutputs,
        updatedAt: context.now,
        message: 'Cancelled before or during host execution.',
      },
    };
  });
}

/** Counts for the mounted queue surface. Staleness is derived here, never persisted, so it always reflects the live edit. */
export function summarizeVideoRenderQueue(
  records: readonly VideoRenderQueueRecord[],
  context: Pick<VideoRenderQueueContext, 'currentCompositionSignature'> = {},
): VideoRenderQueueSummary {
  const summary: VideoRenderQueueSummary = {
    jobs: records.length,
    queuedJobs: 0,
    runningJobs: 0,
    interruptedJobs: 0,
    staleJobIds: [],
    outputs: 0,
    queuedOutputs: 0,
    runningOutputs: 0,
    interruptedOutputs: 0,
    succeededOutputs: 0,
    failedOutputs: 0,
    blockedOutputs: 0,
    cancelledOutputs: 0,
    hasRunnableWork: false,
  };

  for (const record of records) {
    if (record.status === 'queued') summary.queuedJobs += 1;
    if (record.status === 'running') summary.runningJobs += 1;
    if (record.status === 'interrupted') summary.interruptedJobs += 1;
    if (isVideoRenderQueueJobStale(record, context.currentCompositionSignature)) {
      summary.staleJobIds.push(record.id);
    }
    for (const output of record.outputs ?? []) {
      summary.outputs += 1;
      if (output.status === 'queued') summary.queuedOutputs += 1;
      if (output.status === 'running') summary.runningOutputs += 1;
      if (output.status === 'interrupted') summary.interruptedOutputs += 1;
      if (output.status === 'succeeded') summary.succeededOutputs += 1;
      if (output.status === 'failed') summary.failedOutputs += 1;
      if (output.status === 'blocked') summary.blockedOutputs += 1;
      if (output.status === 'cancelled') summary.cancelledOutputs += 1;
    }
  }

  const selection = selectNextVideoRenderQueueWork(records, context);
  summary.hasRunnableWork = selection !== undefined;
  if (selection) summary.activeSelection = selection;
  return summary;
}

function countRunningOutputs(records: readonly VideoRenderQueueRecord[]): number {
  return records.reduce(
    (total, record) => total + (record.outputs ?? []).filter((output) => output.status === 'running').length,
    0,
  );
}

function updateJob(
  records: readonly VideoRenderQueueRecord[],
  jobId: string,
  apply: (record: VideoRenderQueueRecord) => { record: VideoRenderQueueRecord } | { reason: string },
): VideoRenderQueueTransition {
  const index = records.findIndex((record) => record.id === jobId);
  if (index < 0) return unchanged(records, `No delivery job ${jobId} is present in the queue.`);
  const result = apply(records[index]);
  if ('reason' in result) return unchanged(records, result.reason);
  const next = [...records];
  next[index] = result.record;
  return { records: next, changed: true };
}

function updateOutput(
  records: readonly VideoRenderQueueRecord[],
  selection: Pick<VideoRenderQueueSelection, 'jobId' | 'outputId'>,
  apply: (
    record: VideoRenderQueueRecord,
    output: VideoRenderQueueOutput,
  ) => { output: VideoRenderQueueOutput } | { reason: string },
  now: number,
  message: string,
): VideoRenderQueueTransition {
  return updateJob(records, selection.jobId, (record) => {
    const outputs = record.outputs;
    const outputIndex = outputs?.findIndex((output) => output.id === selection.outputId) ?? -1;
    if (!outputs || outputIndex < 0) {
      return { reason: `Delivery job ${selection.jobId} has no output ${selection.outputId}.` };
    }
    const result = apply(record, outputs[outputIndex]);
    if ('reason' in result) return result;
    const nextOutputs = [...outputs];
    nextOutputs[outputIndex] = result.output;
    return {
      record: {
        ...record,
        status: deriveVideoRenderQueueJobStatus(nextOutputs, record.status),
        outputs: nextOutputs,
        updatedAt: now,
        message: clampMessage(message),
      },
    };
  });
}

function normalizeResult(result: VideoRenderQueueOutputResult): VideoRenderQueueOutputResult | undefined {
  const normalized: VideoRenderQueueOutputResult = {};
  if (Number.isSafeInteger(result.byteSize) && (result.byteSize ?? -1) >= 0) {
    normalized.byteSize = result.byteSize;
  }
  const checksum = result.checksum?.trim();
  if (checksum) normalized.checksum = checksum.slice(0, 512);
  const reference = result.reference?.trim();
  if (reference) normalized.reference = reference.slice(0, 2_048);
  return Object.keys(normalized).length ? normalized : undefined;
}

function staleReason(jobId: string): string {
  return `Delivery job ${jobId} was frozen against an earlier cut of this composition. Re-plan it so the delivered file matches the signature it claims.`;
}

function clampMessage(value: string): string {
  return value.trim().slice(0, MAX_QUEUE_MESSAGE_LENGTH);
}

function unchanged(records: readonly VideoRenderQueueRecord[], reason: string): VideoRenderQueueTransition {
  return { records: [...records], changed: false, reason };
}
