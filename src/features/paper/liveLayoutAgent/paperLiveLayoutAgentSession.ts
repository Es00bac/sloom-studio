import { create } from 'zustand';
import {
  applyPaperLiveAgentOperation,
  buildPaperLiveAgentSnapshot,
  createPaperLiveAgentContext,
  parsePaperLiveAgentTurn,
  PaperLiveAgentValidationError,
  type PaperLiveAgentContext,
  type PaperLiveAgentIssue,
} from '../../../lib/paperLiveLayoutAgent';
import type { PaperDocument } from '../../../types/paper';
import type { UsageTelemetry } from '../../../types/flow';
import type { SourceBinLibraryItem } from '../../../store/sourceBinStore';
import type { PaperWritingProvider } from '../writing/paperWritingAssistant';
import type { PaperWritingTextExecutor } from '../writing/paperWritingAssistantService';

/**
 * Live layout agent session.
 *
 * The session store is module-level and the turn loop is driven from it — NOT
 * from a React component — so the agent keeps working on the open Paper
 * document while the person switches to another workspace. Document mutations
 * go through `mutateDocument`, which folds each operation against the live
 * document inside the Paper store, so concurrent human edits are never
 * clobbered and every operation is its own undo step.
 */

export const PAPER_LIVE_LAYOUT_AGENT_MAX_TURNS = 60;
const MAX_CONSECUTIVE_INVALID_TURNS = 3;
const MAX_ACTIVITY_LOG_ENTRIES = 300;
const MAX_RECENT_ACTIVITY_IN_PROMPT = 12;

export type PaperLiveLayoutAgentStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'done'
  | 'blocked'
  | 'cancelled'
  | 'error';

export interface PaperLiveLayoutAgentLogEntry {
  id: string;
  kind: 'status' | 'op' | 'issue' | 'note';
  text: string;
  at: number;
}

export interface PaperLiveLayoutAgentStartRequest {
  provider: PaperWritingProvider;
  modelId?: string;
  brief: string;
}

export interface PaperLiveLayoutAgentAdapters {
  executor: PaperWritingTextExecutor;
  /** Current live document (read fresh at the start of every turn). */
  getDocument: () => PaperDocument;
  /** Atomically folds one operation against the live document. Returns whether it changed. */
  mutateDocument: (mutate: (document: PaperDocument) => { document: PaperDocument; changed: boolean }) => boolean;
  /** Source Library items the agent may place (already filtered to placeable kinds). */
  listSourceItems: () => SourceBinLibraryItem[];
  /** Provider-reported usage for one turn, when available. */
  onUsage?: (usage: UsageTelemetry) => void;
  now?: () => number;
  createId?: () => string;
}

interface PaperLiveLayoutAgentSessionState {
  status: PaperLiveLayoutAgentStatus;
  provider?: PaperWritingProvider;
  modelId?: string;
  brief: string;
  turn: number;
  maxTurns: number;
  appliedOperations: number;
  log: PaperLiveLayoutAgentLogEntry[];
  errorMessage?: string;
  start: (request: PaperLiveLayoutAgentStartRequest, adapters: PaperLiveLayoutAgentAdapters) => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  dismiss: () => void;
}

interface PaperLiveLayoutAgentRuntime {
  adapters: PaperLiveLayoutAgentAdapters;
  context: PaperLiveAgentContext;
  abort: AbortController;
  pauseRequested: boolean;
  cancelRequested: boolean;
  feedbackIssues?: PaperLiveAgentIssue[];
  consecutiveInvalidTurns: number;
}

let runtime: PaperLiveLayoutAgentRuntime | undefined;

export function buildPaperLiveLayoutAgentSystemPrompt(): string {
  return [
    'You are a professional editorial designer and typesetter working live inside Sloom Studio Paper.',
    'You edit the OPEN document through typed operations. Each operation is applied immediately and the person can watch you work.',
    'Return exactly one JSON object and no Markdown, commentary, code fences, HTML, CSS, URLs, scripts, or tool calls, with this exact shape:',
    '{"status":"working"|"done"|"blocked","message":"one short sentence about what you just did","operations":[ ... up to 40 operations ... ]}',
    'Allowed operations:',
    '{"op":"addPage","id":"agent-page-<n>"}',
    '{"op":"addFrame","id":"agent-<name>","pageId":"<page id or your addPage alias>","kind":"text|image|speechBubble|thoughtBubble|caption|panel|shape","label":"...","geometry":{"xMm":0,"yMm":0,"widthMm":0,"heightMm":0,"rotationDeg":0},"text":"...","columns":1,"shapeKind":"ellipse|triangle|pentagon|hexagon|polygon","mediaPrompt":"...","style":{...}}',
    '{"op":"updateFrame","frameId":"agent-<name>","patch":{"label":"...","geometry":{...},"text":"...","columns":1,"locked":false,"mediaPrompt":"...","style":{...}}}',
    '{"op":"removeFrame","frameId":"agent-<name>"}',
    '{"op":"placeSourceAsset","frameId":"agent-<name>","sourceItemId":"<id from SOURCE_ITEMS>"}',
    '{"op":"setBackground","color":"#rrggbb"}',
    '{"op":"setMargins","margins":{"top":15,"right":15,"bottom":15,"left":15}}',
    'Style shape: {"fill":{"kind":"hex","value":"#rrggbb"}|{"kind":"none"},"fillOpacity":0-1,"stroke":{...},"strokeOpacity":0-1,"strokeWidthMm":0-50,"cornerRadiusMm":0,"opacity":0-1,"typography":{"fontFamily":"Local Family","fontSizePt":1-1000,"leadingPt":1-2000,"tracking":-1000..1000,"align":"left|center|right|justify","hyphenate":true|false,"color":"#rrggbb","fontWeight":100-900,"fontStyle":"normal|italic"}}',
    'Rules:',
    '- Every ID you invent MUST start with "agent-". You may update, remove, or place assets ONLY into frames listed as agent-owned in the snapshot. Never touch other frames.',
    '- Keep every frame inside the page plus bleed. Respect the document margins unless the brief says otherwise.',
    '- Geometry is in millimetres on the real page. Use the page size and margins from the snapshot.',
    '- Work in small steps: propose a handful of operations per turn, keep status "working", and you will receive an updated snapshot next turn. Set status "done" only when the layout is complete. Set status "blocked" if you need the person to change something.',
    '- Image frames are placeholders. A mediaPrompt is an inert generation brief (subject, composition, lighting, palette, print intent); it never generates by itself. To use existing artwork, place it with placeSourceAsset.',
    '- Fonts are local family names only. Use restrained, print-conscious typography with deliberate hierarchy.',
    '- If FEEDBACK lists validation issues, correct exactly those issues and resubmit a complete turn.',
  ].join('\n');
}

export function buildPaperLiveLayoutAgentUserPrompt(input: {
  brief: string;
  snapshot: string;
  turn: number;
  maxTurns: number;
  feedbackIssues?: PaperLiveAgentIssue[];
  recentActivity: string[];
}): string {
  return [
    `BRIEF\n${input.brief}`,
    `TURN ${input.turn} of at most ${input.maxTurns}`,
    `DOCUMENT_SNAPSHOT\n${input.snapshot}`,
    ...(input.recentActivity.length > 0
      ? [`RECENT_ACTIVITY (already applied)\n${input.recentActivity.map((line) => `- ${line}`).join('\n')}`]
      : []),
    ...(input.feedbackIssues?.length
      ? [`FEEDBACK (your previous response was rejected; fix these and resubmit a complete turn)\n${input.feedbackIssues.map((issue) => `- ${issue.path}: ${issue.message}`).join('\n')}`]
      : []),
  ].join('\n\n');
}

function appendLog(
  state: PaperLiveLayoutAgentSessionState,
  entry: Omit<PaperLiveLayoutAgentLogEntry, 'id' | 'at'>,
  now: () => number,
  createId: () => string,
): PaperLiveLayoutAgentLogEntry[] {
  const next = [...state.log, { ...entry, id: createId(), at: now() }];
  return next.length > MAX_ACTIVITY_LOG_ENTRIES ? next.slice(next.length - MAX_ACTIVITY_LOG_ENTRIES) : next;
}

export const usePaperLiveLayoutAgentSession = create<PaperLiveLayoutAgentSessionState>()((set, get) => {
  const now = () => runtime?.adapters.now?.() ?? Date.now();
  const createId = () => runtime?.adapters.createId?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? `agent-log-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const finish = (status: PaperLiveLayoutAgentStatus, note: string) => {
    const abort = runtime?.abort;
    runtime = undefined;
    abort?.abort();
    set((state) => ({
      status,
      ...(status === 'error' ? { errorMessage: note } : {}),
      log: appendLog(state, { kind: 'status', text: note }, now, createId),
    }));
  };

  const runLoop = async () => {
    const active = runtime;
    if (!active) return;
    const { adapters, context } = active;

    while (runtime === active && !active.cancelRequested) {
      if (active.pauseRequested) {
        set({ status: 'paused' });
        return;
      }
      const state = get();
      if (state.turn >= state.maxTurns) {
        finish('done', `Stopped at the ${state.maxTurns}-turn safety limit. Review the layout and continue with a new session if needed.`);
        return;
      }

      set((state) => ({
        status: 'running',
        turn: state.turn + 1,
        log: appendLog(state, { kind: 'note', text: `Turn ${state.turn + 1}: asking the model for the next step…` }, now, createId),
      }));

      let responseText: string;
      try {
        const sourceItems = adapters.listSourceItems()
          .filter((item) => item.kind === 'image')
          .map((item) => ({ id: item.id, label: item.label ?? item.id, kind: item.kind }));
        const snapshot = buildPaperLiveAgentSnapshot(adapters.getDocument(), context, sourceItems);
        const recentActivity = get().log
          .filter((entry) => entry.kind === 'op')
          .slice(-MAX_RECENT_ACTIVITY_IN_PROMPT)
          .map((entry) => entry.text);

        const result = await adapters.executor.execute({
          purpose: 'live-layout-agent',
          provider: state.provider as PaperWritingProvider,
          ...(state.modelId ? { modelId: state.modelId } : {}),
          systemPrompt: buildPaperLiveLayoutAgentSystemPrompt(),
          userPrompt: buildPaperLiveLayoutAgentUserPrompt({
            brief: state.brief,
            snapshot,
            turn: get().turn,
            maxTurns: state.maxTurns,
            ...(active.feedbackIssues ? { feedbackIssues: active.feedbackIssues } : {}),
            recentActivity,
          }),
          signal: active.abort.signal,
        });
        responseText = result.text;
        if (result.usage) adapters.onUsage?.(result.usage);
      } catch (error) {
        if (active.cancelRequested || active.abort.signal.aborted) return;
        finish('error', error instanceof Error ? error.message : 'The layout agent request failed.');
        return;
      }
      if (runtime !== active || active.cancelRequested) return;

      let turn;
      try {
        turn = parsePaperLiveAgentTurn(responseText);
        active.feedbackIssues = undefined;
        active.consecutiveInvalidTurns = 0;
      } catch (error) {
        active.consecutiveInvalidTurns += 1;
        const issues = error instanceof PaperLiveAgentValidationError
          ? error.issues
          : [{ path: '$', message: error instanceof Error ? error.message : 'unparseable response' }];
        active.feedbackIssues = issues;
        set((state) => ({
          log: appendLog(state, {
            kind: 'issue',
            text: `Response rejected (${issues.length} issue${issues.length === 1 ? '' : 's'}); asking the model to correct it.`,
          }, now, createId),
        }));
        if (active.consecutiveInvalidTurns >= MAX_CONSECUTIVE_INVALID_TURNS) {
          finish('error', `The model returned ${MAX_CONSECUTIVE_INVALID_TURNS} invalid responses in a row. First issue: ${issues[0]?.path ?? '$'} ${issues[0]?.message ?? ''}`.trim());
          return;
        }
        continue;
      }

      if (turn.message) {
        set((state) => ({ log: appendLog(state, { kind: 'note', text: turn.message ?? '' }, now, createId) }));
      }
      for (const operation of turn.operations) {
        if (runtime !== active || active.cancelRequested) return;
        let resultSummary = '';
        adapters.mutateDocument((document) => {
          const result = applyPaperLiveAgentOperation(document, operation, context);
          resultSummary = result.summary;
          return { document: result.document, changed: result.changed };
        });
        set((state) => ({
          appliedOperations: state.appliedOperations + 1,
          log: appendLog(state, { kind: 'op', text: resultSummary }, now, createId),
        }));
      }

      if (turn.status === 'done') {
        finish('done', `Layout complete — ${get().appliedOperations} operations applied across ${get().turn} turns. Everything stays editable and undoable.`);
        return;
      }
      if (turn.status === 'blocked') {
        finish('blocked', turn.message ?? 'The model reports it is blocked and needs your input.');
        return;
      }
    }
  };

  return {
    status: 'idle',
    brief: '',
    turn: 0,
    maxTurns: PAPER_LIVE_LAYOUT_AGENT_MAX_TURNS,
    appliedOperations: 0,
    log: [],

    start: (request, adapters) => {
      if (runtime) return;
      const brief = request.brief.trim();
      if (!brief) return;
      runtime = {
        adapters,
        context: createPaperLiveAgentContext(
          (sourceItemId) => adapters.listSourceItems().find((item) => item.id === sourceItemId),
        ),
        abort: new AbortController(),
        pauseRequested: false,
        cancelRequested: false,
        consecutiveInvalidTurns: 0,
      };
      set({
        status: 'running',
        provider: request.provider,
        ...(request.modelId ? { modelId: request.modelId } : {}),
        brief,
        turn: 0,
        appliedOperations: 0,
        errorMessage: undefined,
        log: [{
          id: createId(),
          kind: 'status',
          text: `Layout agent started with ${request.provider}${request.modelId ? ` · ${request.modelId}` : ''}. It edits only frames it creates (agent-…) and you can undo every step.`,
          at: now(),
        }],
      });
      void runLoop();
    },

    pause: () => {
      if (!runtime || get().status !== 'running') return;
      runtime.pauseRequested = true;
      runtime.abort.abort();
      set((state) => ({
        status: 'paused',
        log: appendLog(state, { kind: 'status', text: 'Paused. The document keeps every applied step; resume to continue.' }, now, createId),
      }));
    },

    resume: () => {
      const active = runtime;
      if (!active || get().status !== 'paused') return;
      active.pauseRequested = false;
      active.abort = new AbortController();
      set((state) => ({
        status: 'running',
        log: appendLog(state, { kind: 'status', text: 'Resumed.' }, now, createId),
      }));
      void runLoop();
    },

    cancel: () => {
      const active = runtime;
      if (!active) return;
      active.cancelRequested = true;
      active.abort.abort();
      runtime = undefined;
      set((state) => ({
        status: 'cancelled',
        log: appendLog(state, { kind: 'status', text: 'Cancelled. Everything already applied stays in the document and is undoable.' }, now, createId),
      }));
    },

    dismiss: () => {
      const status = get().status;
      if (status === 'running' || status === 'paused') return;
      runtime = undefined;
      set({
        status: 'idle',
        provider: undefined,
        modelId: undefined,
        brief: '',
        turn: 0,
        appliedOperations: 0,
        errorMessage: undefined,
        log: [],
      });
    },
  };
});
