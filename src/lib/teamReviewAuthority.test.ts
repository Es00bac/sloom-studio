import { describe, expect, it } from 'vitest';
import {
  applyTeamReviewOperation,
  createTeamReviewState,
  normalizeTeamReviewState,
  parseTeamReviewState,
  serializeTeamReviewState,
  type TeamReviewOperation,
} from './teamReviewAuthority';

const owner = { actorId: 'host', label: 'Phone', role: 'owner' as const, joinedAt: 1 };
const op = (state: ReturnType<typeof createTeamReviewState>, extra: Record<string, unknown>): TeamReviewOperation => ({
  opId: `op-${state.revision}-${Math.random()}`,
  actorId: 'host',
  actorLabel: 'Phone',
  baseRevision: state.revision,
  at: state.revision + 2,
  type: 'join',
  ...extra,
} as TeamReviewOperation);

describe('team review authority', () => {
  it('orders accepted operations, deduplicates retries, and refuses stale writers', () => {
    let state = createTeamReviewState(owner);
    const create = op(state, { type: 'create-thread', threadId: 'thread-1', title: 'Cut', body: 'Review this beat' });
    const accepted = applyTeamReviewOperation(state, create);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    state = accepted.state;
    expect(applyTeamReviewOperation(state, create)).toMatchObject({ ok: true, duplicate: true });
    const stale = applyTeamReviewOperation(state, { ...op(createStateAt(0), { type: 'set-status', threadId: 'thread-1', status: 'resolved' }), opId: 'stale' });
    expect(stale).toMatchObject({ ok: false, reason: 'stale-revision' });
    expect(state.threads[0]?.status).toBe('open');
  });

  it('requires a join and enforces reviewer/commenter/viewer permissions', () => {
    let state = createTeamReviewState(owner);
    const initialThread = applyTeamReviewOperation(state, op(state, { type: 'create-thread', threadId: 'thread-1', title: 'Topic', body: 'Body' }));
    expect(initialThread.ok).toBe(true);
    if (!initialThread.ok) return;
    state = initialThread.state;
    const denied = applyTeamReviewOperation(state, {
      ...op(state, { type: 'create-thread', threadId: 'x', title: 'x', body: 'x' }), actorId: 'unknown', actorLabel: 'Guest', opId: 'unknown',
    });
    expect(denied).toMatchObject({ ok: false, reason: 'permission-denied' });
    const joined = applyTeamReviewOperation(state, {
      ...op(state, { type: 'join' }), actorId: 'reviewer', actorLabel: 'Reviewer', opId: 'join',
    });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    state = joined.state;
    const viewerState = applyTeamReviewOperation(state, {
      ...op(state, { type: 'grant-role', memberId: 'reviewer', role: 'viewer' }), opId: 'grant',
    });
    expect(viewerState.ok).toBe(true);
    if (!viewerState.ok) return;
    state = viewerState.state;
    const viewerComment = applyTeamReviewOperation(state, {
      ...op(state, { type: 'add-message', threadId: 'thread-1', messageId: 'm', body: 'No' }), actorId: 'reviewer', actorLabel: 'Reviewer', opId: 'viewer-comment',
    });
    expect(viewerComment).toMatchObject({ ok: false, reason: 'permission-denied' });
  });

  it('round-trips bounded state and refuses malformed text without mutation', () => {
    let state = createTeamReviewState(owner);
    const create = op(state, { type: 'create-thread', threadId: 'thread-1', title: 'Cut', body: 'Review this beat' });
    const result = applyTeamReviewOperation(state, create);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    const restored = parseTeamReviewState(serializeTeamReviewState(state), owner);
    expect(restored).toEqual(state);
    const malformed = applyTeamReviewOperation(state, { ...op(state, { type: 'add-message', threadId: 'thread-1', messageId: 'm', body: ' '.repeat(2_001) }), opId: 'bad' });
    expect(malformed).toMatchObject({ ok: false, reason: 'invalid-text' });
    expect(malformed.state).toEqual(state);
    const hostile = normalizeTeamReviewState({ members: [{ actorId: '__proto__', label: 'x', role: 'viewer' }], threads: [] }, owner);
    expect(hostile.members.some((member) => member.actorId === '__proto__')).toBe(true);
  });
});

function createStateAt(revision: number) {
  return createTeamReviewState(owner, revision);
}
