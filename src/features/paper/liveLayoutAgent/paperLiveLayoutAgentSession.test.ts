import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePaperLiveLayoutAgentSession } from './paperLiveLayoutAgentSession';
import { createDefaultPaperDocument } from '../../../lib/paperDocument';
import type { PaperDocument } from '../../../types/paper';
import type { PaperWritingTextExecutionRequest, PaperWritingTextExecutor } from '../writing/paperWritingAssistantService';

function makeAdapters(responses: Array<string | Error>, initialDocument?: PaperDocument) {
  let document: PaperDocument = initialDocument ?? createDefaultPaperDocument({ title: 'Agent session test' });
  const requests: PaperWritingTextExecutionRequest[] = [];
  const executor: PaperWritingTextExecutor = {
    execute: async (request) => {
      requests.push(request);
      const next = responses.length > 1 ? responses.shift() : responses[0];
      if (next instanceof Error) throw next;
      if (typeof next !== 'string') throw new Error('no scripted response left');
      return { text: next, provider: request.provider };
    },
  };
  return {
    requests,
    getDocument: () => document,
    adapters: {
      executor,
      getDocument: () => document,
      mutateDocument: (mutate: (doc: PaperDocument) => { document: PaperDocument; changed: boolean }) => {
        const result = mutate(document);
        if (result.changed) document = result.document;
        return result.changed;
      },
      listSourceItems: () => [],
      now: () => 1_000,
      createId: () => `log-${requests.length}-${Math.random().toString(36).slice(2)}`,
    },
  };
}

async function waitForStatus(...statuses: string[]) {
  await vi.waitFor(() => {
    expect(statuses).toContain(usePaperLiveLayoutAgentSession.getState().status);
  }, { timeout: 5_000, interval: 10 });
}

describe('paperLiveLayoutAgentSession', () => {
  beforeEach(() => {
    usePaperLiveLayoutAgentSession.getState().cancel();
    usePaperLiveLayoutAgentSession.getState().dismiss();
  });

  it('runs a multi-turn session that edits the live document and finishes', async () => {
    const initialDocument = createDefaultPaperDocument({ title: 'Agent session test' });
    const pageId = initialDocument.pages[0].id;
    const turn1 = JSON.stringify({
      status: 'working',
      message: 'Placing the title block.',
      operations: [{
        op: 'addFrame',
        id: 'agent-title',
        pageId,
        kind: 'text',
        label: 'Title',
        geometry: { xMm: 20, yMm: 20, widthMm: 170, heightMm: 25 },
        text: 'Live Agent Times',
        style: { typography: { fontSizePt: 28, align: 'center' } },
      }],
    });
    const turn2 = JSON.stringify({ status: 'done', message: 'All set.', operations: [] });
    const { adapters, getDocument, requests } = makeAdapters([turn1, turn2], initialDocument);

    usePaperLiveLayoutAgentSession.getState().start(
      { provider: 'openai', modelId: 'gpt-sol-1', brief: 'Make a bold newsletter front page.' },
      adapters,
    );
    await waitForStatus('done');

    const state = usePaperLiveLayoutAgentSession.getState();
    expect(state.turn).toBe(2);
    expect(state.appliedOperations).toBe(1);
    const frame = getDocument().pages[0].frames.find((candidate) => candidate.id === 'agent-title');
    expect(frame?.text).toBe('Live Agent Times');
    expect(frame?.typography?.fontSizePt).toBe(28);
    expect(requests).toHaveLength(2);
    expect(requests[0].purpose).toBe('live-layout-agent');
    expect(requests[0].modelId).toBe('gpt-sol-1');
    expect(requests[1].userPrompt).toContain('agent-title');
    expect(requests[1].userPrompt).toContain('RECENT_ACTIVITY');
  });

  it('feeds validation issues back to the model and recovers', async () => {
    const bad = '```json\n{"status":"done"}\n```';
    const good = JSON.stringify({ status: 'done', message: 'Recovered.', operations: [] });
    const { adapters, requests } = makeAdapters([bad, good]);

    usePaperLiveLayoutAgentSession.getState().start(
      { provider: 'native-cli:claude', brief: 'A simple cover.' },
      adapters,
    );
    await waitForStatus('done');

    const state = usePaperLiveLayoutAgentSession.getState();
    expect(state.log.some((entry) => entry.kind === 'issue')).toBe(true);
    expect(requests[1].userPrompt).toContain('FEEDBACK');
  });

  it('errors out after repeated invalid responses', async () => {
    const { adapters } = makeAdapters(['not json at all']);
    usePaperLiveLayoutAgentSession.getState().start(
      { provider: 'gemini', brief: 'A poster.' },
      adapters,
    );
    await waitForStatus('error');
    expect(usePaperLiveLayoutAgentSession.getState().errorMessage).toContain('invalid responses');
  });

  it('cancel stops the session and keeps applied steps', async () => {
    let resolveSecond: ((text: string) => void) | undefined;
    let document: PaperDocument = createDefaultPaperDocument({ title: 'Cancel test' });
    const pageId = document.pages[0].id;
    const executor: PaperWritingTextExecutor = {
      execute: async (request) => {
        if (request.purpose === 'live-layout-agent' && !resolveSecond) {
          resolveSecond = () => undefined;
          return {
            text: JSON.stringify({
              status: 'working',
              operations: [{
                op: 'addFrame',
                id: 'agent-block',
                pageId,
                kind: 'text',
                label: 'Block',
                geometry: { xMm: 10, yMm: 10, widthMm: 50, heightMm: 20 },
                text: 'Kept after cancel',
              }],
            }),
            provider: request.provider,
          };
        }
        await new Promise<void>((resolve) => {
          request.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new DOMException('cancelled', 'AbortError');
      },
    };
    usePaperLiveLayoutAgentSession.getState().start(
      { provider: 'openai', brief: 'Keep going forever.' },
      {
        executor,
        getDocument: () => document,
        mutateDocument: (mutate) => {
          const result = mutate(document);
          if (result.changed) document = result.document;
          return result.changed;
        },
        listSourceItems: () => [],
      },
    );

    await vi.waitFor(() => {
      expect(document.pages[0].frames.some((frame) => frame.id === 'agent-block')).toBe(true);
    }, { timeout: 5_000, interval: 10 });
    usePaperLiveLayoutAgentSession.getState().cancel();
    await waitForStatus('cancelled');
    expect(document.pages[0].frames.some((frame) => frame.id === 'agent-block')).toBe(true);
    expect(resolveSecond).toBeDefined();
  });
});
