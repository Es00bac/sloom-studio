/**
 * Local review annotations for a Video composition.
 *
 * This is an exchangeable project document, not a cloud collaboration service: it has no users,
 * permissions, presence, notifications, or server authority. Merge rules are deterministic and
 * idempotent so separately exchanged JSON reports can be reconciled safely.
 */

export const VIDEO_REVIEW_WORKFLOW_VERSION = 1 as const;
export const VIDEO_REVIEW_COLLABORATION_BOUNDARY = 'local-file-exchange-only' as const;
export const MAX_VIDEO_REVIEW_ANNOTATIONS = 5_000;
export const MAX_VIDEO_REVIEW_REPLIES_PER_ANNOTATION = 500;
export const MAX_VIDEO_REVIEW_TOTAL_REPLIES = 10_000;
export const MAX_VIDEO_REVIEW_PACKAGE_CHARACTERS = 8 * 1024 * 1024;

export type VideoReviewAnnotationStatus = 'open' | 'resolved' | 'wont-fix';
export type VideoReviewPriority = 'low' | 'normal' | 'high' | 'urgent';
export type VideoApprovalStatus = 'unreviewed' | 'in-review' | 'changes-requested' | 'approved' | 'invalidated';

export type VideoReviewTarget =
  | { kind: 'point'; timeMs: number }
  | { kind: 'range'; startMs: number; endMs: number }
  | { kind: 'clip'; clipId: string; timeMs?: number };

export interface VideoReviewReply {
  id: string;
  author: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface VideoReviewAnnotation {
  id: string;
  target: VideoReviewTarget;
  author: string;
  body: string;
  status: VideoReviewAnnotationStatus;
  assignee?: string;
  priority: VideoReviewPriority;
  createdAt: number;
  updatedAt: number;
  replies: VideoReviewReply[];
}

export interface VideoCompositionApproval {
  status: VideoApprovalStatus;
  reviewer?: string;
  note?: string;
  decidedAt?: number;
  /** Signature that was actually reviewed. Required for an effective approval. */
  compositionSignature?: string;
  invalidatedBySignature?: string;
}

export interface VideoReviewWorkflow {
  version: typeof VIDEO_REVIEW_WORKFLOW_VERSION;
  collaboration: typeof VIDEO_REVIEW_COLLABORATION_BOUNDARY;
  compositionId: string;
  compositionSignature: string;
  annotations: VideoReviewAnnotation[];
  approval: VideoCompositionApproval;
}

export interface VideoReviewApprovalEvaluation {
  effectiveStatus: VideoApprovalStatus;
  valid: boolean;
  reason: string;
}

const ANNOTATION_STATUSES = new Set<VideoReviewAnnotationStatus>(['open', 'resolved', 'wont-fix']);
const PRIORITIES = new Set<VideoReviewPriority>(['low', 'normal', 'high', 'urgent']);
const APPROVAL_STATUSES = new Set<VideoApprovalStatus>(['unreviewed', 'in-review', 'changes-requested', 'approved', 'invalidated']);

export function createVideoReviewWorkflow(compositionId: string, compositionSignature: string): VideoReviewWorkflow {
  return {
    version: VIDEO_REVIEW_WORKFLOW_VERSION,
    collaboration: VIDEO_REVIEW_COLLABORATION_BOUNDARY,
    compositionId: requiredText(compositionId, 'composition id', 300),
    compositionSignature: requiredText(compositionSignature, 'composition signature', 1_000),
    annotations: [],
    approval: { status: 'unreviewed' },
  };
}

export function normalizeVideoReviewWorkflow(
  value: unknown,
  fallback: { compositionId: string; compositionSignature: string },
): VideoReviewWorkflow {
  const input = isRecord(value) ? value : {};
  const compositionId = optionalText(input.compositionId, 300) ?? requiredText(fallback.compositionId, 'composition id', 300);
  const compositionSignature = optionalText(input.compositionSignature, 1_000)
    ?? requiredText(fallback.compositionSignature, 'composition signature', 1_000);
  const annotations = Array.isArray(input.annotations)
    ? normalizeAnnotationsBounded(input.annotations)
    : [];
  return invalidateVideoReviewApproval({
    version: VIDEO_REVIEW_WORKFLOW_VERSION,
    collaboration: VIDEO_REVIEW_COLLABORATION_BOUNDARY,
    compositionId,
    compositionSignature,
    annotations: dedupeLatest(annotations, (annotation) => annotation.id, (annotation) => annotation.updatedAt),
    approval: normalizeApproval(input.approval),
  }, compositionSignature);
}

export function parseVideoReviewPackageJson(
  text: string,
  fallback: { compositionId: string; compositionSignature: string },
): VideoReviewWorkflow {
  if (text.length > MAX_VIDEO_REVIEW_PACKAGE_CHARACTERS) {
    throw new Error('The review package exceeds the 8 MiB import limit.');
  }
  try {
    return normalizeVideoReviewWorkflow(JSON.parse(text) as unknown, fallback);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('The review package is not valid JSON.');
    throw error;
  }
}

export function upsertVideoReviewAnnotation(
  workflow: VideoReviewWorkflow,
  annotation: VideoReviewAnnotation,
): VideoReviewWorkflow {
  const normalized = normalizeAnnotation(annotation);
  if (!normalized) throw new Error('Review annotation is invalid.');
  return {
    ...workflow,
    annotations: mergeVideoReviewAnnotations(workflow.annotations, [normalized]),
  };
}

export function mergeVideoReviewAnnotations(
  local: readonly VideoReviewAnnotation[],
  incoming: readonly VideoReviewAnnotation[],
): VideoReviewAnnotation[] {
  const merged = new Map<string, VideoReviewAnnotation>();
  let remainingReplies = MAX_VIDEO_REVIEW_TOTAL_REPLIES;
  for (const candidate of [...local.slice(0, MAX_VIDEO_REVIEW_ANNOTATIONS), ...incoming.slice(0, MAX_VIDEO_REVIEW_ANNOTATIONS)]) {
    const normalized = normalizeAnnotation(candidate, remainingReplies);
    if (!normalized) continue;
    remainingReplies -= normalized.replies.length;
    const existing = merged.get(normalized.id);
    if (!existing) {
      merged.set(normalized.id, normalized);
      continue;
    }
    const winner = chooseLatest(existing, normalized);
    merged.set(normalized.id, {
      ...winner,
      replies: mergeVideoReviewReplies(existing.replies, normalized.replies),
    });
  }
  return boundTotalReplies([...merged.values()]
    .sort((left, right) => targetStartMs(left.target) - targetStartMs(right.target) || left.id.localeCompare(right.id))
    .slice(0, MAX_VIDEO_REVIEW_ANNOTATIONS));
}

export function mergeVideoReviewReplies(
  local: readonly VideoReviewReply[],
  incoming: readonly VideoReviewReply[],
): VideoReviewReply[] {
  return dedupeLatest(
    [...local, ...incoming].map(normalizeReply).filter(isDefined),
    (reply) => reply.id,
    (reply) => reply.updatedAt,
  )
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(0, MAX_VIDEO_REVIEW_REPLIES_PER_ANNOTATION);
}

export function mergeVideoReviewWorkflows(
  local: VideoReviewWorkflow,
  incoming: VideoReviewWorkflow,
  currentCompositionSignature: string,
): VideoReviewWorkflow {
  if (local.compositionId !== incoming.compositionId) {
    throw new Error('Review packages for different compositions cannot be merged.');
  }
  const signature = requiredText(currentCompositionSignature, 'composition signature', 1_000);
  const approval = chooseLatestApproval(local.approval, incoming.approval);
  return invalidateVideoReviewApproval({
    version: VIDEO_REVIEW_WORKFLOW_VERSION,
    collaboration: VIDEO_REVIEW_COLLABORATION_BOUNDARY,
    compositionId: local.compositionId,
    compositionSignature: signature,
    annotations: mergeVideoReviewAnnotations(local.annotations, incoming.annotations),
    approval,
  }, signature);
}

export function invalidateVideoReviewApproval(
  workflow: VideoReviewWorkflow,
  currentCompositionSignature: string,
): VideoReviewWorkflow {
  const signature = requiredText(currentCompositionSignature, 'composition signature', 1_000);
  const approval = workflow.approval;
  if (approval.status !== 'approved' || approval.compositionSignature === signature) {
    return workflow.compositionSignature === signature ? workflow : { ...workflow, compositionSignature: signature };
  }
  return {
    ...workflow,
    compositionSignature: signature,
    approval: {
      ...approval,
      status: 'invalidated',
      invalidatedBySignature: signature,
    },
  };
}

export function evaluateVideoReviewApproval(
  approval: VideoCompositionApproval,
  currentCompositionSignature: string,
): VideoReviewApprovalEvaluation {
  if (approval.status !== 'approved') {
    return {
      effectiveStatus: approval.status,
      valid: false,
      reason: approval.status === 'invalidated' ? 'The composition changed after approval.' : 'The composition is not approved.',
    };
  }
  if (!approval.compositionSignature || approval.compositionSignature !== currentCompositionSignature) {
    return { effectiveStatus: 'invalidated', valid: false, reason: 'The approved composition signature does not match the current edit.' };
  }
  return { effectiveStatus: 'approved', valid: true, reason: 'Approval matches the current composition signature.' };
}

export function exportVideoReviewPackageJson(workflow: VideoReviewWorkflow): string {
  const normalized = normalizeVideoReviewWorkflow(workflow, workflow);
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function exportVideoReviewPackageCsv(workflow: VideoReviewWorkflow): string {
  const rows: string[][] = [[
    'annotation_id', 'target_kind', 'start_ms', 'end_ms', 'clip_id', 'author', 'body',
    'status', 'assignee', 'priority', 'reply_count', 'replies', 'updated_at',
  ]];
  for (const annotation of workflow.annotations.slice(0, MAX_VIDEO_REVIEW_ANNOTATIONS)) {
    rows.push([
      annotation.id,
      annotation.target.kind,
      String(targetStartMs(annotation.target)),
      annotation.target.kind === 'range' ? String(annotation.target.endMs) : '',
      annotation.target.kind === 'clip' ? annotation.target.clipId : '',
      annotation.author,
      annotation.body,
      annotation.status,
      annotation.assignee ?? '',
      annotation.priority,
      String(annotation.replies.length),
      annotation.replies.map((reply) => `${reply.author}: ${reply.body}`).join(' | '),
      String(annotation.updatedAt),
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function normalizeAnnotation(
  value: unknown,
  remainingReplies = MAX_VIDEO_REVIEW_REPLIES_PER_ANNOTATION,
): VideoReviewAnnotation | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalText(value.id, 300);
  const author = optionalText(value.author, 200);
  const body = optionalText(value.body, 10_000);
  const target = normalizeTarget(value.target);
  if (!id || !author || !body || !target) return undefined;
  const createdAt = finiteNonNegativeInteger(value.createdAt);
  const updatedAt = Math.max(createdAt, finiteNonNegativeInteger(value.updatedAt));
  const replyLimit = Math.min(MAX_VIDEO_REVIEW_REPLIES_PER_ANNOTATION, Math.max(0, remainingReplies));
  const replies = Array.isArray(value.replies)
    ? mergeVideoReviewReplies([], value.replies.slice(0, replyLimit).map(normalizeReply).filter(isDefined))
    : [];
  return {
    id,
    target,
    author,
    body,
    status: isAnnotationStatus(value.status) ? value.status : 'open',
    assignee: optionalText(value.assignee, 200),
    priority: isPriority(value.priority) ? value.priority : 'normal',
    createdAt,
    updatedAt,
    replies,
  };
}

function normalizeAnnotationsBounded(values: readonly unknown[]): VideoReviewAnnotation[] {
  const annotations: VideoReviewAnnotation[] = [];
  let remainingReplies = MAX_VIDEO_REVIEW_TOTAL_REPLIES;
  for (const value of values.slice(0, MAX_VIDEO_REVIEW_ANNOTATIONS)) {
    const annotation = normalizeAnnotation(value, remainingReplies);
    if (!annotation) continue;
    annotations.push(annotation);
    remainingReplies -= annotation.replies.length;
  }
  return annotations;
}

function boundTotalReplies(annotations: readonly VideoReviewAnnotation[]): VideoReviewAnnotation[] {
  let remainingReplies = MAX_VIDEO_REVIEW_TOTAL_REPLIES;
  return annotations.map((annotation) => {
    const replies = annotation.replies.slice(0, remainingReplies);
    remainingReplies -= replies.length;
    return replies.length === annotation.replies.length ? annotation : { ...annotation, replies };
  });
}

function normalizeReply(value: unknown): VideoReviewReply | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalText(value.id, 300);
  const author = optionalText(value.author, 200);
  const body = optionalText(value.body, 5_000);
  if (!id || !author || !body) return undefined;
  const createdAt = finiteNonNegativeInteger(value.createdAt);
  return {
    id,
    author,
    body,
    createdAt,
    updatedAt: Math.max(createdAt, finiteNonNegativeInteger(value.updatedAt)),
  };
}

function normalizeTarget(value: unknown): VideoReviewTarget | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'point') return { kind: 'point', timeMs: finiteNonNegativeInteger(value.timeMs) };
  if (value.kind === 'range') {
    const startMs = finiteNonNegativeInteger(value.startMs);
    const endMs = finiteNonNegativeInteger(value.endMs);
    return endMs > startMs ? { kind: 'range', startMs, endMs } : undefined;
  }
  if (value.kind === 'clip') {
    const clipId = optionalText(value.clipId, 300);
    if (!clipId) return undefined;
    return { kind: 'clip', clipId, timeMs: value.timeMs === undefined ? undefined : finiteNonNegativeInteger(value.timeMs) };
  }
  return undefined;
}

function normalizeApproval(value: unknown): VideoCompositionApproval {
  if (!isRecord(value)) return { status: 'unreviewed' };
  return {
    status: isApprovalStatus(value.status) ? value.status : 'unreviewed',
    reviewer: optionalText(value.reviewer, 200),
    note: optionalText(value.note, 5_000),
    decidedAt: value.decidedAt === undefined ? undefined : finiteNonNegativeInteger(value.decidedAt),
    compositionSignature: optionalText(value.compositionSignature, 1_000),
    invalidatedBySignature: optionalText(value.invalidatedBySignature, 1_000),
  };
}

function chooseLatest<T extends { updatedAt: number }>(left: T, right: T): T {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? left : right;
  return stableValue(left) >= stableValue(right) ? left : right;
}

function chooseLatestApproval(left: VideoCompositionApproval, right: VideoCompositionApproval): VideoCompositionApproval {
  const leftTime = left.decidedAt ?? 0;
  const rightTime = right.decidedAt ?? 0;
  if (leftTime !== rightTime) return leftTime > rightTime ? normalizeApproval(left) : normalizeApproval(right);
  return stableValue(left) >= stableValue(right) ? normalizeApproval(left) : normalizeApproval(right);
}

function dedupeLatest<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  updatedAtOf: (item: T) => number,
): T[] {
  const latest = new Map<string, T>();
  for (const item of items) {
    const existing = latest.get(idOf(item));
    if (!existing || updatedAtOf(item) > updatedAtOf(existing)
      || (updatedAtOf(item) === updatedAtOf(existing) && stableValue(item) > stableValue(existing))) {
      latest.set(idOf(item), item);
    }
  }
  return [...latest.values()];
}

function targetStartMs(target: VideoReviewTarget): number {
  if (target.kind === 'range') return target.startMs;
  return target.timeMs ?? 0;
}

function stableValue(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function requiredText(value: string, field: string, maxLength: number): string {
  const text = optionalText(value, maxLength);
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) || undefined : undefined;
}

function finiteNonNegativeInteger(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.round(number));
}

function isAnnotationStatus(value: unknown): value is VideoReviewAnnotationStatus {
  return typeof value === 'string' && ANNOTATION_STATUSES.has(value as VideoReviewAnnotationStatus);
}

function isPriority(value: unknown): value is VideoReviewPriority {
  return typeof value === 'string' && PRIORITIES.has(value as VideoReviewPriority);
}

function isApprovalStatus(value: unknown): value is VideoApprovalStatus {
  return typeof value === 'string' && APPROVAL_STATUSES.has(value as VideoApprovalStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
