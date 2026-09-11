/**
 * Bounded server-authoritative team review state.
 *
 * The phone/LAN project-sync service supplies ordering and authentication. This module supplies the
 * review-specific policy: every accepted operation names its base revision, actor, and stable id;
 * the authority applies it once, or refuses it without mutation. It deliberately does not imply a
 * hosted service, account system, or internet persistence.
 */

export const TEAM_REVIEW_STATE_VERSION = 1 as const;
export const TEAM_REVIEW_CHANNEL = 'team-review' as const;
export const TEAM_REVIEW_MAX_MEMBERS = 64;
export const TEAM_REVIEW_MAX_THREADS = 500;
export const TEAM_REVIEW_MAX_MESSAGES_PER_THREAD = 200;
export const TEAM_REVIEW_MAX_TOTAL_MESSAGES = 5_000;
export const TEAM_REVIEW_MAX_TEXT = 2_000;
export const TEAM_REVIEW_MAX_APPLIED_OPERATION_IDS = 4_096;

export type TeamReviewRole = 'owner' | 'reviewer' | 'commenter' | 'viewer';
export type TeamReviewThreadStatus = 'open' | 'resolved' | 'rejected';

export interface TeamReviewMember {
  actorId: string;
  label: string;
  role: TeamReviewRole;
  joinedAt: number;
}

export interface TeamReviewMessage {
  id: string;
  actorId: string;
  actorLabel: string;
  body: string;
  createdAt: number;
}

export interface TeamReviewThread {
  id: string;
  title: string;
  body: string;
  authorId: string;
  authorLabel: string;
  status: TeamReviewThreadStatus;
  createdAt: number;
  updatedAt: number;
  messages: TeamReviewMessage[];
}

export interface TeamReviewState {
  version: typeof TEAM_REVIEW_STATE_VERSION;
  revision: number;
  members: TeamReviewMember[];
  threads: TeamReviewThread[];
  appliedOperationIds: string[];
}

interface OperationBase {
  opId: string;
  actorId: string;
  actorLabel: string;
  baseRevision: number;
  at: number;
}

export type TeamReviewOperation = OperationBase & (
  | { type: 'join' }
  | { type: 'grant-role'; memberId: string; role: Exclude<TeamReviewRole, 'owner'> }
  | { type: 'create-thread'; threadId: string; title: string; body: string }
  | { type: 'add-message'; threadId: string; messageId: string; body: string }
  | { type: 'set-status'; threadId: string; status: TeamReviewThreadStatus }
);

export type TeamReviewApplyResult =
  | { ok: true; state: TeamReviewState; duplicate: boolean }
  | { ok: false; state: TeamReviewState; reason: TeamReviewRefusal }
;

export type TeamReviewRefusal =
  | 'invalid-operation'
  | 'stale-revision'
  | 'permission-denied'
  | 'member-limit'
  | 'already-member'
  | 'unknown-member'
  | 'thread-limit'
  | 'unknown-thread'
  | 'message-limit'
  | 'duplicate-id'
  | 'invalid-text'
  | 'invalid-status';

const ROLES = new Set<TeamReviewRole>(['owner', 'reviewer', 'commenter', 'viewer']);
const STATUSES = new Set<TeamReviewThreadStatus>(['open', 'resolved', 'rejected']);
const nonBlank = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
};
const finiteTime = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const finiteRevision = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function createTeamReviewState(owner: TeamReviewMember, revision = 0): TeamReviewState {
  const actorId = nonBlank(owner.actorId, 300) ?? 'host';
  const label = nonBlank(owner.label, 160) ?? 'Project host';
  return {
    version: TEAM_REVIEW_STATE_VERSION,
    revision: finiteRevision(revision),
    members: [{ actorId, label, role: 'owner', joinedAt: finiteTime(owner.joinedAt) }],
    threads: [],
    appliedOperationIds: [],
  };
}

export function normalizeTeamReviewState(value: unknown, fallbackOwner: TeamReviewMember): TeamReviewState {
  const input = isRecord(value) ? value : {};
  const owner = createTeamReviewState(fallbackOwner).members[0];
  const members = Array.isArray(input.members)
    ? input.members.map(normalizeMember).filter(isDefined).slice(0, TEAM_REVIEW_MAX_MEMBERS)
    : [];
  const ownerIndex = members.findIndex((member) => member.role === 'owner');
  if (ownerIndex < 0) members.unshift(owner);
  else members[ownerIndex] = { ...members[ownerIndex], role: 'owner' };
  const uniqueMembers = dedupeById(members).slice(0, TEAM_REVIEW_MAX_MEMBERS);
  const threads = Array.isArray(input.threads)
    ? input.threads.map(normalizeThread).filter(isDefined).slice(0, TEAM_REVIEW_MAX_THREADS)
    : [];
  return {
    version: TEAM_REVIEW_STATE_VERSION,
    revision: finiteRevision(input.revision),
    members: uniqueMembers,
    threads: boundMessages(dedupeById(threads)),
    appliedOperationIds: Array.isArray(input.appliedOperationIds)
      ? input.appliedOperationIds.map((id) => nonBlank(id, 300)).filter(isDefined).slice(-TEAM_REVIEW_MAX_APPLIED_OPERATION_IDS)
      : [],
  };
}

export function serializeTeamReviewState(state: TeamReviewState): string {
  return `${JSON.stringify(normalizeTeamReviewState(state, state.members[0] ?? {
    actorId: 'host', label: 'Project host', role: 'owner', joinedAt: 0,
  }))}\n`;
}

export function parseTeamReviewState(text: string, fallbackOwner: TeamReviewMember): TeamReviewState {
  try {
    return normalizeTeamReviewState(JSON.parse(text) as unknown, fallbackOwner);
  } catch {
    return createTeamReviewState(fallbackOwner);
  }
}

export function applyTeamReviewOperation(
  inputState: TeamReviewState,
  operation: TeamReviewOperation,
): TeamReviewApplyResult {
  const state = normalizeTeamReviewState(inputState, inputState.members[0] ?? {
    actorId: 'host', label: 'Project host', role: 'owner', joinedAt: 0,
  });
  const opId = nonBlank(operation?.opId, 300);
  const actorId = nonBlank(operation?.actorId, 300);
  const actorLabel = nonBlank(operation?.actorLabel, 160);
  if (!opId || !actorId || !actorLabel || !isRecord(operation) || !isFiniteSafeInteger(operation.baseRevision)
    || !isFiniteNumber(operation.at) || !isValidOperationType(operation.type)) {
    return refuse(state, 'invalid-operation');
  }
  if (state.appliedOperationIds.includes(opId)) return { ok: true, state, duplicate: true };
  if (operation.baseRevision !== state.revision) return refuse(state, 'stale-revision');

  const member = state.members.find((candidate) => candidate.actorId === actorId);
  if (operation.type === 'join') {
    if (member) return refuse(state, 'already-member');
    if (state.members.length >= TEAM_REVIEW_MAX_MEMBERS) return refuse(state, 'member-limit');
    return accept({
      ...state,
      members: [...state.members, { actorId, label: actorLabel, role: 'reviewer', joinedAt: operation.at }],
    }, opId);
  }
  if (!member) return refuse(state, 'permission-denied');

  if (operation.type === 'grant-role') {
    if (member.role !== 'owner') return refuse(state, 'permission-denied');
    if (!ROLES.has(operation.role)) return refuse(state, 'invalid-operation');
    const target = state.members.find((candidate) => candidate.actorId === operation.memberId);
    if (!target) return refuse(state, 'unknown-member');
    return accept({
      ...state,
      members: state.members.map((candidate) => candidate.actorId === target.actorId
        ? { ...candidate, role: operation.role } : candidate),
    }, opId);
  }

  if (operation.type === 'create-thread') {
    if (member.role !== 'owner' && member.role !== 'reviewer') return refuse(state, 'permission-denied');
    const threadId = nonBlank(operation.threadId, 300);
    const title = nonBlank(operation.title, 240);
    const body = nonBlank(operation.body, TEAM_REVIEW_MAX_TEXT);
    if (!threadId || !title || !body) return refuse(state, 'invalid-text');
    if (state.threads.some((thread) => thread.id === threadId)) return refuse(state, 'duplicate-id');
    if (state.threads.length >= TEAM_REVIEW_MAX_THREADS) return refuse(state, 'thread-limit');
    return accept({
      ...state,
      threads: [...state.threads, {
        id: threadId,
        title,
        body,
        authorId: actorId,
        authorLabel: actorLabel,
        status: 'open',
        createdAt: operation.at,
        updatedAt: operation.at,
        messages: [],
      }],
    }, opId);
  }

  const thread = state.threads.find((candidate) => candidate.id === operation.threadId);
  if (!thread) return refuse(state, 'unknown-thread');
  if (operation.type === 'add-message') {
    if (member.role === 'viewer') return refuse(state, 'permission-denied');
    const messageId = nonBlank(operation.messageId, 300);
    const body = nonBlank(operation.body, TEAM_REVIEW_MAX_TEXT);
    if (!messageId || !body) return refuse(state, 'invalid-text');
    if (state.threads.some((candidate) => candidate.messages.some((message) => message.id === messageId))) {
      return refuse(state, 'duplicate-id');
    }
    const totalMessages = state.threads.reduce((total, candidate) => total + candidate.messages.length, 0);
    if (thread.messages.length >= TEAM_REVIEW_MAX_MESSAGES_PER_THREAD || totalMessages >= TEAM_REVIEW_MAX_TOTAL_MESSAGES) {
      return refuse(state, 'message-limit');
    }
    return accept({
      ...state,
      threads: state.threads.map((candidate) => candidate.id === thread.id
        ? {
          ...candidate,
          updatedAt: operation.at,
          messages: [...candidate.messages, { id: messageId, actorId, actorLabel, body, createdAt: operation.at }],
        }
        : candidate),
    }, opId);
  }

  if (member.role !== 'owner' && member.role !== 'reviewer') return refuse(state, 'permission-denied');
  if (!STATUSES.has(operation.status)) return refuse(state, 'invalid-status');
  return accept({
    ...state,
    threads: state.threads.map((candidate) => candidate.id === thread.id
      ? { ...candidate, status: operation.status, updatedAt: operation.at } : candidate),
  }, opId);
}

function accept(state: TeamReviewState, opId: string): TeamReviewApplyResult {
  return {
    ok: true,
    duplicate: false,
    state: {
      ...state,
      revision: state.revision + 1,
      appliedOperationIds: [...state.appliedOperationIds, opId].slice(-TEAM_REVIEW_MAX_APPLIED_OPERATION_IDS),
    },
  };
}

function refuse(state: TeamReviewState, reason: TeamReviewRefusal): TeamReviewApplyResult {
  return { ok: false, state, reason };
}

function normalizeMember(value: unknown): TeamReviewMember | null {
  if (!isRecord(value)) return null;
  const actorId = nonBlank(value.actorId, 300);
  const label = nonBlank(value.label, 160);
  const role = value.role;
  if (!actorId || !label || typeof role !== 'string' || !ROLES.has(role as TeamReviewRole)) return null;
  return { actorId, label, role: role as TeamReviewRole, joinedAt: finiteTime(value.joinedAt) };
}

function normalizeThread(value: unknown): TeamReviewThread | null {
  if (!isRecord(value)) return null;
  const id = nonBlank(value.id, 300);
  const title = nonBlank(value.title, 240);
  const body = nonBlank(value.body, TEAM_REVIEW_MAX_TEXT);
  const authorId = nonBlank(value.authorId, 300);
  const authorLabel = nonBlank(value.authorLabel, 160);
  const status = value.status;
  if (!id || !title || !body || !authorId || !authorLabel || typeof status !== 'string' || !STATUSES.has(status as TeamReviewThreadStatus)) return null;
  const messages = Array.isArray(value.messages) ? value.messages.map(normalizeMessage).filter(isDefined) : [];
  return {
    id, title, body, authorId, authorLabel, status: status as TeamReviewThreadStatus,
    createdAt: finiteTime(value.createdAt), updatedAt: finiteTime(value.updatedAt),
    messages: dedupeById(messages).slice(0, TEAM_REVIEW_MAX_MESSAGES_PER_THREAD),
  };
}

function normalizeMessage(value: unknown): TeamReviewMessage | null {
  if (!isRecord(value)) return null;
  const id = nonBlank(value.id, 300);
  const actorId = nonBlank(value.actorId, 300);
  const actorLabel = nonBlank(value.actorLabel, 160);
  const body = nonBlank(value.body, TEAM_REVIEW_MAX_TEXT);
  if (!id || !actorId || !actorLabel || !body) return null;
  return { id, actorId, actorLabel, body, createdAt: finiteTime(value.createdAt) };
}

function boundMessages(threads: TeamReviewThread[]): TeamReviewThread[] {
  let remaining = TEAM_REVIEW_MAX_TOTAL_MESSAGES;
  return threads.map((thread) => {
    const messages = thread.messages.slice(0, Math.min(TEAM_REVIEW_MAX_MESSAGES_PER_THREAD, remaining));
    remaining -= messages.length;
    return { ...thread, messages };
  });
}

function dedupeById<T extends { id?: string; actorId?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = item.id ?? item.actorId;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isDefined<T>(value: T | null): value is T { return value !== null; }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isFiniteSafeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function isValidOperationType(value: unknown): value is TeamReviewOperation['type'] {
  return value === 'join' || value === 'grant-role' || value === 'create-thread' || value === 'add-message' || value === 'set-status';
}
