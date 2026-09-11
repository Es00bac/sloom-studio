import { useEffect, useMemo, useState } from 'react';
import { getLocalDeviceId } from '../lib/deviceIdentity';
import { isAndroidLanServerAvailable } from '../lib/androidLanServer';
import {
  getTeamReviewState,
  makeTeamReviewOperation,
  submitTeamReviewOperation,
  subscribeTeamReviewState,
} from '../lib/teamReviewSync';
import type { TeamReviewRole, TeamReviewState } from '../lib/teamReviewAuthority';

const id = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

/** Mounted only inside the paired Sloom Link panel: review edits are ordered by the phone authority. */
export function TeamReviewStatusPanel() {
  const [state, setState] = useState<TeamReviewState>(() => getTeamReviewState());
  const [threadTitle, setThreadTitle] = useState('');
  const [threadBody, setThreadBody] = useState('');
  const [replyBody, setReplyBody] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const actor = useMemo(() => ({
    id: getLocalDeviceId(),
    label: isAndroidLanServerAvailable() ? 'Phone' : 'Desktop browser',
  }), []);
  const member = state.members.find((candidate) => candidate.actorId === actor.id);
  const canWrite = member?.role === 'owner' || member?.role === 'reviewer';

  useEffect(() => subscribeTeamReviewState(setState), []);

  const submit = async (operation: Parameters<typeof makeTeamReviewOperation>[0], fields?: Parameters<typeof makeTeamReviewOperation>[1]) => {
    const accepted = await submitTeamReviewOperation(makeTeamReviewOperation(operation, fields));
    setNotice(accepted ? 'Accepted by the phone authority.' : 'Refused: the review changed or this role is not permitted.');
  };

  return (
    <section
      aria-label="Team review"
      className="flex flex-col gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/5 p-2.5 text-emerald-50"
      data-team-review-panel="true"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <strong className="text-sm">Team review</strong>
          <small className="text-emerald-200/65">Phone-authoritative · revision {state.revision}</small>
        </span>
        <span className="rounded-full border border-emerald-300/20 px-2 py-1 text-[10px] text-emerald-200/70">
          {state.members.length} member{state.members.length === 1 ? '' : 's'}
        </span>
      </header>
      <p className="m-0 text-[11px] leading-4 text-emerald-100/65">
        Ordered over this paired LAN. Stale edits, unknown actors, viewers, and oversized comments are refused;
        hosted cloud accounts and internet continuity are not included.
      </p>
      {!member ? (
        <button
          className="rounded-lg border border-emerald-300/30 px-2.5 py-2 text-left font-semibold hover:bg-emerald-400/10"
          onClick={() => void submit('join')}
          type="button"
        >
          Join this review as reviewer
        </button>
      ) : null}
      {member ? (
        <span className="text-[11px] text-emerald-100/75">Signed in as {member.label} · {member.role}</span>
      ) : null}
      {canWrite ? (
        <div className="flex flex-col gap-1.5 border-t border-emerald-300/10 pt-2">
          <input
            aria-label="New review title"
            className="rounded-lg border border-emerald-300/20 bg-slate-950/50 px-2 py-1.5 text-xs text-emerald-50 outline-none focus:border-emerald-200"
            maxLength={240}
            onChange={(event) => setThreadTitle(event.target.value)}
            placeholder="Review topic"
            value={threadTitle}
          />
          <textarea
            aria-label="New review comment"
            className="min-h-12 rounded-lg border border-emerald-300/20 bg-slate-950/50 px-2 py-1.5 text-xs text-emerald-50 outline-none focus:border-emerald-200"
            maxLength={2_000}
            onChange={(event) => setThreadBody(event.target.value)}
            placeholder="What should the team review?"
            value={threadBody}
          />
          <button
            className="rounded-lg border border-emerald-300/30 px-2 py-1.5 text-xs font-semibold hover:bg-emerald-400/10 disabled:opacity-40"
            disabled={!threadTitle.trim() || !threadBody.trim()}
            onClick={() => {
              void submit('create-thread', { threadId: id('thread'), title: threadTitle, body: threadBody });
              setThreadTitle('');
              setThreadBody('');
            }}
            type="button"
          >
            Start review thread
          </button>
        </div>
      ) : null}
      {state.threads.map((thread) => (
        <article className="rounded-lg border border-emerald-300/15 bg-slate-950/35 p-2" key={thread.id}>
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <strong className="block truncate text-xs">{thread.title}</strong>
              <span className="text-[11px] text-emerald-100/70">{thread.body}</span>
            </span>
            <select
              aria-label={`Status for ${thread.title}`}
              className="rounded border border-emerald-300/20 bg-slate-950 px-1 py-1 text-[10px] text-emerald-100 disabled:opacity-45"
              disabled={!canWrite}
              onChange={(event) => void submit('set-status', { threadId: thread.id, status: event.target.value as 'open' | 'resolved' | 'rejected' })}
              value={thread.status}
            >
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          {thread.messages.map((message) => (
            <p className="m-0 mt-1 border-t border-emerald-300/10 pt-1 text-[11px] text-emerald-100/65" key={message.id}>
              <b>{message.actorLabel}:</b> {message.body}
            </p>
          ))}
          {member && member.role !== 'viewer' ? (
            <div className="mt-1.5 flex gap-1">
              <input
                aria-label={`Reply to ${thread.title}`}
                className="min-w-0 flex-1 rounded border border-emerald-300/20 bg-slate-950/50 px-2 py-1 text-[11px] text-emerald-50 outline-none"
                maxLength={2_000}
                onChange={(event) => setReplyBody((current) => ({ ...current, [thread.id]: event.target.value }))}
                placeholder="Add bounded comment"
                value={replyBody[thread.id] ?? ''}
              />
              <button
                aria-label={`Send reply to ${thread.title}`}
                className="rounded border border-emerald-300/30 px-2 py-1 text-[11px] font-semibold disabled:opacity-40"
                disabled={!replyBody[thread.id]?.trim()}
                onClick={() => {
                  void submit('add-message', { threadId: thread.id, messageId: id('message'), body: replyBody[thread.id] ?? '' });
                  setReplyBody((current) => ({ ...current, [thread.id]: '' }));
                }}
                type="button"
              >
                Send
              </button>
            </div>
          ) : null}
        </article>
      ))}
      {member?.role === 'owner' && state.members.some((candidate) => candidate.actorId !== actor.id) ? (
        <div className="border-t border-emerald-300/10 pt-2">
          <span className="text-[10px] uppercase tracking-wide text-emerald-200/55">Permissions</span>
          {state.members.filter((candidate) => candidate.actorId !== actor.id).map((candidate) => (
            <label className="mt-1 flex items-center justify-between gap-2 text-[11px]" key={candidate.actorId}>
              <span className="truncate">{candidate.label}</span>
              <select
                aria-label={`Role for ${candidate.label}`}
                className="rounded border border-emerald-300/20 bg-slate-950 px-1 py-1 text-[10px] text-emerald-100"
                onChange={(event) => void submit('grant-role', { memberId: candidate.actorId, role: event.target.value as Exclude<TeamReviewRole, 'owner'> })}
                value={candidate.role}
              >
                <option value="reviewer">Reviewer</option>
                <option value="commenter">Commenter</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
          ))}
        </div>
      ) : null}
      {notice ? <span className="text-[11px] text-amber-200/80" role="status">{notice}</span> : null}
    </section>
  );
}
