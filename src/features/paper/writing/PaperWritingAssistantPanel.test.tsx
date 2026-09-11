// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPaperWritingSourceSnapshot, type PaperWritingGenerateRequest } from './paperWritingAssistant';
import { PaperWritingAssistantPanel } from './PaperWritingAssistantPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const provider = [{
  provider: 'gemini' as const,
  label: 'Google Gemini',
  modelId: 'configured-gemini-model',
  available: true,
}];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

function source(text = 'Teh moon rises.', sourceKind: 'plain-text' | 'rich-text' = 'plain-text', revision = 1) {
  return createPaperWritingSourceSnapshot({
    workspaceDocumentId: 'tab-1',
    documentInstanceId: 'instance-1',
    documentId: 'document-1',
    pageId: 'page-1',
    frameId: 'frame-1',
    sourceKind,
    sourceRevision: revision,
    targetEditable: true,
    text,
  });
}

function generatedPreview(request: PaperWritingGenerateRequest) {
  return {
    id: 'preview-1',
    action: request.action,
    provider: request.provider,
    ...(request.modelId ? { modelId: request.modelId } : {}),
    generatedText: 'The moon rises.',
    source: request.source,
    createdAt: '2026-07-21T18:00:00.000Z',
  };
}

function buttonByText(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return button;
}

describe('PaperWritingAssistantPanel', () => {
  it('does not call a configured model until Generate preview is deliberately clicked', async () => {
    const onGeneratePreview = vi.fn(async (request: PaperWritingGenerateRequest) => generatedPreview(request));
    const onApplyPlainText = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);

    await act(async () => root.render(
      <PaperWritingAssistantPanel
        onApplyPlainText={onApplyPlainText}
        onGeneratePreview={onGeneratePreview}
        providers={provider}
        source={source()}
      />,
    ));

    expect(host.textContent).toContain('Nothing is sent until you choose Generate preview');
    expect(host.textContent).toContain('generated text is never applied automatically');
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Text sent to writing provider"]')?.value).toBe('Teh moon rises.');
    expect(onGeneratePreview).not.toHaveBeenCalled();
    expect(onApplyPlainText).not.toHaveBeenCalled();

    await act(async () => buttonByText(host, 'Generate preview').click());
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelector('[data-paper-writing-preview="true"]')).not.toBeNull());
    });

    expect(onGeneratePreview).toHaveBeenCalledOnce();
    expect(onApplyPlainText).not.toHaveBeenCalled();
    await act(async () => buttonByText(host, 'Apply plain text').click());
    expect(onApplyPlainText).toHaveBeenCalledWith('The moon rises.', expect.objectContaining({ id: 'preview-1' }));
  });

  it('blocks direct apply for rich text so formatting cannot be discarded', async () => {
    const onGeneratePreview = vi.fn(async (request: PaperWritingGenerateRequest) => generatedPreview(request));
    const onApplyPlainText = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);

    await act(async () => root.render(
      <PaperWritingAssistantPanel
        onApplyPlainText={onApplyPlainText}
        onGeneratePreview={onGeneratePreview}
        providers={provider}
        source={source('Styled moon text.', 'rich-text')}
      />,
    ));
    await act(async () => buttonByText(host, 'Generate preview').click());
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Direct Apply is disabled for rich text'));
    });

    const apply = buttonByText(host, 'Apply plain text');
    expect(apply.disabled).toBe(true);
    await act(async () => apply.click());
    expect(onApplyPlainText).not.toHaveBeenCalled();
  });

  it('marks a completed preview stale when the selected source changes', async () => {
    const onGeneratePreview = vi.fn(async (request: PaperWritingGenerateRequest) => generatedPreview(request));
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);
    const render = (currentSource: ReturnType<typeof source>) => (
      <PaperWritingAssistantPanel
        onApplyPlainText={vi.fn()}
        onGeneratePreview={onGeneratePreview}
        providers={provider}
        source={currentSource}
      />
    );

    await act(async () => root.render(render(source())));
    await act(async () => buttonByText(host, 'Generate preview').click());
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelector('[data-paper-writing-preview="true"]')).not.toBeNull());
    });
    await act(async () => root.render(render(source('Changed while the provider was working.', 'plain-text', 2))));

    expect(host.textContent).toContain('The source changed after this preview was requested');
    expect(buttonByText(host, 'Apply plain text').disabled).toBe(true);
  });

  it('supports brief-only drafting without a selected frame and offers an explicit copy action', async () => {
    const onGeneratePreview = vi.fn(async (request: PaperWritingGenerateRequest) => generatedPreview(request));
    const onCopyPlainText = vi.fn();
    const briefOnlySource = createPaperWritingSourceSnapshot({
      workspaceDocumentId: 'tab-1',
      documentInstanceId: 'instance-1',
      documentId: 'document-1',
      sourceKind: 'plain-text',
      sourceRevision: 1,
      targetEditable: false,
      text: '',
    });
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);

    await act(async () => root.render(
      <PaperWritingAssistantPanel
        onApplyPlainText={vi.fn()}
        onCopyPlainText={onCopyPlainText}
        onGeneratePreview={onGeneratePreview}
        providers={provider}
        source={briefOnlySource}
      />,
    ));

    const action = host.querySelector('[aria-label="Writing action"]');
    const direction = host.querySelector('[aria-label="Writing direction or brief"]');
    if (!(action instanceof HTMLSelectElement) || !(direction instanceof HTMLTextAreaElement)) {
      throw new Error('Missing writing controls');
    }
    await act(async () => {
      action.value = 'draft';
      action.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      const setTextareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setTextareaValue?.call(direction, 'Draft a concise opening for a lunar field guide.');
      direction.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(host.textContent).toContain('no document text will be sent');
    const generate = buttonByText(host, 'Generate preview');
    expect(generate.disabled).toBe(false);
    await act(async () => generate.click());
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('No editable text frame was selected'));
    });
    expect(buttonByText(host, 'Apply plain text').disabled).toBe(true);
    await act(async () => buttonByText(host, 'Copy preview').click());
    expect(onCopyPlainText).toHaveBeenCalledWith('The moon rises.');
  });

  it('aborts and discards an in-flight result when request-defining controls change', async () => {
    let resolvePreview: ((preview: ReturnType<typeof generatedPreview>) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const onGeneratePreview = vi.fn((_request: PaperWritingGenerateRequest, signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<ReturnType<typeof generatedPreview>>((resolve) => {
        resolvePreview = resolve;
      });
    });
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <PaperWritingAssistantPanel
        onApplyPlainText={vi.fn()}
        onGeneratePreview={onGeneratePreview}
        providers={provider}
        source={source()}
      />,
    ));

    await act(async () => buttonByText(host, 'Generate preview').click());
    const action = host.querySelector('[aria-label="Writing action"]');
    if (!(action instanceof HTMLSelectElement)) throw new Error('Missing writing action');
    await act(async () => {
      action.value = 'grammar';
      action.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(receivedSignal?.aborted).toBe(true);

    await act(async () => {
      resolvePreview?.(generatedPreview(onGeneratePreview.mock.calls[0][0]));
      await Promise.resolve();
    });
    expect(host.querySelector('[data-paper-writing-preview="true"]')).toBeNull();
    expect(buttonByText(host, 'Generate preview').textContent).toBe('Generate preview');
  });
});
