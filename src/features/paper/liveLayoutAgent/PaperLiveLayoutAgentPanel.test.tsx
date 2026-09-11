// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaperLiveLayoutAgentPanel } from './PaperLiveLayoutAgentPanel';
import { usePaperLiveLayoutAgentSession } from './paperLiveLayoutAgentSession';
import { createDefaultPaperDocument } from '../../../lib/paperDocument';
import type { PaperLiveLayoutAgentStartRequest } from './paperLiveLayoutAgentSession';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const providers = [
  { provider: 'openai' as const, label: 'OpenAI', modelId: 'gpt-default', available: true },
  { provider: 'native-cli:claude' as const, label: 'Claude Code · existing CLI sign-in', available: true },
];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  globalThis.localStorage?.clear();
});

beforeEach(() => {
  usePaperLiveLayoutAgentSession.getState().cancel();
  usePaperLiveLayoutAgentSession.getState().dismiss();
});

function buttonByText(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return button;
}

async function setTextarea(host: HTMLElement, ariaLabel: string, value: string) {
  const field = host.querySelector(`[aria-label="${ariaLabel}"]`);
  if (!(field instanceof HTMLTextAreaElement)) throw new Error(`Missing textarea: ${ariaLabel}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('PaperLiveLayoutAgentPanel', () => {
  it('requires consent, starts the session with a typed model override, and remembers it', async () => {
    const onStart = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <PaperLiveLayoutAgentPanel onStart={onStart} providers={providers} />,
    ));

    expect(host.textContent).toContain('switch workspaces while it keeps working');
    const start = buttonByText(host, 'Start live layout');
    expect(start.disabled).toBe(true);

    await setTextarea(host, 'Live layout agent design direction', 'A moody two-page zine cover spread.');
    const modelField = host.querySelector('[aria-label="Live layout agent model"]');
    if (!(modelField instanceof HTMLInputElement)) throw new Error('Missing model input');
    expect(modelField.placeholder).toBe('gpt-default');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(modelField, 'gpt-sol-2');
      modelField.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const consent = host.querySelector('[aria-label="Confirm live layout agent data sharing"]');
    if (!(consent instanceof HTMLInputElement)) throw new Error('Missing consent checkbox');
    await act(async () => consent.click());
    expect(start.disabled).toBe(false);

    await act(async () => start.click());
    expect(onStart).toHaveBeenCalledWith({
      provider: 'openai',
      modelId: 'gpt-sol-2',
      brief: 'A moody two-page zine cover spread.',
    } satisfies PaperLiveLayoutAgentStartRequest);

    // The override is remembered per provider for the next session.
    const host2 = document.createElement('div');
    const root2 = createRoot(host2);
    roots.push(root2);
    await act(async () => root2.render(
      <PaperLiveLayoutAgentPanel onStart={vi.fn()} providers={providers} />,
    ));
    const modelField2 = host2.querySelector('[aria-label="Live layout agent model"]');
    expect(modelField2).toHaveProperty('value', 'gpt-sol-2');
  });

  it('drives pause/resume/stop from the shared session and renders the live log', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <PaperLiveLayoutAgentPanel onStart={vi.fn()} providers={providers} />,
    ));

    const session = usePaperLiveLayoutAgentSession.getState();
    session.start(
      { provider: 'openai', brief: 'hold' },
      {
        executor: {
          execute: (request) => new Promise((_, reject) => {
            request.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')), { once: true });
          }),
        },
        getDocument: () => createDefaultPaperDocument({ title: 'panel test' }),
        mutateDocument: () => false,
        listSourceItems: () => [],
      },
    );
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Turn 1/60'));
    });
    expect(host.textContent).toContain('Layout agent started with openai');

    await act(async () => buttonByText(host, 'Pause').click());
    expect(host.textContent).toContain('Paused');
    await act(async () => buttonByText(host, 'Resume').click());
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Working live'));
    });
    await act(async () => buttonByText(host, 'Stop').click());
    expect(host.textContent).toContain('Stopped');
    await act(async () => buttonByText(host, 'Clear session').click());
    expect(host.textContent).not.toContain('Stopped');
  });
});
