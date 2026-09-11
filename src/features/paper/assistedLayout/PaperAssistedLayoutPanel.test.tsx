// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertPaperAssistedLayoutPlanToDocument, type PaperAssistedLayoutPlanV1 } from '../../../lib/paperAssistedLayout';
import type { PaperAssistedLayoutGenerateRequest, PaperAssistedLayoutPreview } from './paperAssistedLayoutService';
import { summarizePaperAssistedLayoutPreview } from './paperAssistedLayoutService';
import { PaperAssistedLayoutPanel } from './PaperAssistedLayoutPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../lib/paperAssistedLayout', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/paperAssistedLayout')>();
  return {
    ...original,
    normalizePaperAssistedLayoutSourceBundle: vi.fn(async (files: readonly File[], options?: { bundleId?: string }) => ({
      version: 1 as const,
      id: options?.bundleId ?? 'source-bundle',
      files: files.map((file, index) => ({
        id: `source-${String(index + 1).padStart(4, '0')}`,
        order: index,
        name: file.name,
        title: file.name,
        format: file.name.endsWith('.md') ? 'markdown' as const : 'txt' as const,
        originalBytes: file.size,
        blocks: [{
          id: `source-${String(index + 1).padStart(4, '0')}-block-0001`,
          order: 0,
          role: 'paragraph' as const,
          text: 'Test',
        }],
      })),
      totalCharacters: files.length * 4,
    })),
  };
});

const roots: Root[] = [];
const providers = [
  { provider: 'openai' as const, label: 'OpenAI', modelId: 'layout-model-a', available: true },
  { provider: 'openai' as const, label: 'OpenAI', modelId: 'layout-model-b', available: true },
  { provider: 'gemini' as const, label: 'Google Gemini', modelId: 'gemini-layout', available: true },
];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

function plan(): PaperAssistedLayoutPlanV1 {
  return {
    version: 1,
    document: {
      id: 'preview-document',
      title: 'Preview Document',
      page: { widthMm: 210, heightMm: 297, bleedMm: 3, dpi: 300 },
      marginsMm: { top: 15, right: 15, bottom: 15, left: 15 },
      background: { kind: 'hex', value: '#ffffff' },
      fonts: [],
      swatches: [],
      pages: [{
        id: 'page-1',
        frames: [{
          id: 'frame-1',
          kind: 'text',
          label: 'Title',
          geometry: { xMm: 15, yMm: 15, widthMm: 180, heightMm: 30 },
          content: { kind: 'literal', text: 'A proposed title' },
        }],
      }],
    },
  };
}

function makePreview(request: PaperAssistedLayoutGenerateRequest): PaperAssistedLayoutPreview {
  const proposedPlan = plan();
  return {
    id: `preview-${request.revision ?? 1}`,
    provider: request.provider,
    ...(request.modelId ? { modelId: request.modelId } : {}),
    sources: request.sources,
    plan: proposedPlan,
    document: convertPaperAssistedLayoutPlanToDocument(proposedPlan, { sources: request.sources }),
    summary: summarizePaperAssistedLayoutPreview(request.sources, proposedPlan),
    createdAt: '2026-07-21T20:00:00.000Z',
    revision: request.revision ?? 1,
    ...(request.parentPreviewId ? { parentPreviewId: request.parentPreviewId } : {}),
  };
}

function buttonByText(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return button;
}

async function chooseSourceFiles(host: HTMLElement, names = ['chapter.md', 'credits.txt']) {
  const input = host.querySelector('[aria-label="Assisted layout source documents"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Missing source input');
  const files = names.map((name, index) => {
    const file = new File([index === 0 ? '# Chapter\n\nOpening text.' : 'Credits copy.'], name, {
      type: name.endsWith('.md') ? 'text/markdown' : 'text/plain',
    });
    return file;
  });
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => {
    const expectedLabel = files.length === 1 ? '1 source document' : `${files.length} source documents`;
    await vi.waitFor(() => expect(host.textContent).toContain(expectedLabel));
  });
}

describe('PaperAssistedLayoutPanel', () => {
  it('requires explicit disclosure consent, previews without applying, then opens only on command', async () => {
    const onGeneratePreview = vi.fn(async (request: PaperAssistedLayoutGenerateRequest) => makePreview(request));
    const onOpenAsNewDocument = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);

    await act(async () => root.render(
      <PaperAssistedLayoutPanel
        onGeneratePreview={onGeneratePreview}
        onOpenAsNewDocument={onOpenAsNewDocument}
        providers={providers}
      />,
    ));

    expect(host.textContent).toContain('never applied automatically');
    expect(host.textContent).toContain('extracted text from every selected document');
    expect(host.textContent).toContain('CSV, TSV, or XLSX');
    expect(host.textContent).toContain('formulas and legacy .xls files are not supported');
    const sourceInput = host.querySelector('[aria-label="Assisted layout source documents"]');
    expect(sourceInput?.getAttribute('accept')).toContain('.xlsx');
    expect(onGeneratePreview).not.toHaveBeenCalled();
    await chooseSourceFiles(host);

    const generate = buttonByText(host, 'Generate layout preview');
    expect(generate.disabled).toBe(true);
    const confirmation = host.querySelector('[aria-label="Confirm assisted layout data sharing"]');
    if (!(confirmation instanceof HTMLInputElement)) throw new Error('Missing privacy confirmation');
    await act(async () => confirmation.click());
    expect(generate.disabled).toBe(false);

    await act(async () => generate.click());
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelector('[data-paper-assisted-layout-preview="true"]')).not.toBeNull());
    });

    expect(onGeneratePreview).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      modelId: 'layout-model-a',
      sources: expect.objectContaining({ files: expect.arrayContaining([
        expect.objectContaining({ name: 'chapter.md' }),
        expect.objectContaining({ name: 'credits.txt' }),
      ]) }),
    }), expect.any(AbortSignal));
    expect(onOpenAsNewDocument).not.toHaveBeenCalled();
    expect(host.textContent).toContain('1');
    expect(host.textContent).toContain('Nothing has been applied');

    const revision = host.querySelector('[aria-label="Assisted layout revision direction"]');
    if (!(revision instanceof HTMLTextAreaElement)) throw new Error('Missing revision direction');
    await act(async () => {
      const setTextareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setTextareaValue?.call(revision, 'Tighten the opening spread and preserve stable frame IDs.');
      revision.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => buttonByText(host, 'Revise proposal').click());
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Revision 2'));
    });
    expect(onGeneratePreview).toHaveBeenLastCalledWith(expect.objectContaining({
      previousPlan: expect.objectContaining({ version: 1 }),
      parentPreviewId: 'preview-1',
      revision: 2,
      revisionBrief: expect.stringContaining('stable frame IDs'),
    }), expect.any(AbortSignal));
    expect(host.querySelector('[aria-label="Assisted layout proposal revision"]')).not.toBeNull();

    await act(async () => buttonByText(host, 'Open as new document').click());
    expect(onOpenAsNewDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'preview-document' }),
      expect.objectContaining({ id: 'preview-2', revision: 2, parentPreviewId: 'preview-1' }),
    );
  });

  it('cancels an in-flight provider request without creating or opening a document', async () => {
    let receivedSignal: AbortSignal | undefined;
    const onGeneratePreview = vi.fn((_request: PaperAssistedLayoutGenerateRequest, signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<PaperAssistedLayoutPreview>(() => undefined);
    });
    const onOpenAsNewDocument = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <PaperAssistedLayoutPanel
        onGeneratePreview={onGeneratePreview}
        onOpenAsNewDocument={onOpenAsNewDocument}
        providers={providers}
      />,
    ));
    await chooseSourceFiles(host, ['story.txt']);
    const confirmation = host.querySelector('[aria-label="Confirm assisted layout data sharing"]');
    if (!(confirmation instanceof HTMLInputElement)) throw new Error('Missing privacy confirmation');
    await act(async () => confirmation.click());
    await act(async () => buttonByText(host, 'Generate layout preview').click());
    await act(async () => {
      await vi.waitFor(() => expect(buttonByText(host, 'Cancel')).toBeTruthy());
    });

    await act(async () => buttonByText(host, 'Cancel').click());
    expect(receivedSignal?.aborted).toBe(true);
    expect(host.textContent).toContain('No document was created or changed');
    expect(onOpenAsNewDocument).not.toHaveBeenCalled();
  });

  it('aborts and discards an in-flight layout when its design brief changes', async () => {
    let resolvePreview: ((preview: PaperAssistedLayoutPreview) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;
    const onGeneratePreview = vi.fn((_request: PaperAssistedLayoutGenerateRequest, signal: AbortSignal) => {
      receivedSignal = signal;
      return new Promise<PaperAssistedLayoutPreview>((resolve) => {
        resolvePreview = resolve;
      });
    });
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(
      <PaperAssistedLayoutPanel
        onGeneratePreview={onGeneratePreview}
        onOpenAsNewDocument={vi.fn()}
        providers={providers}
      />,
    ));
    await chooseSourceFiles(host, ['story.txt']);
    const confirmation = host.querySelector('[aria-label="Confirm assisted layout data sharing"]');
    if (!(confirmation instanceof HTMLInputElement)) throw new Error('Missing privacy confirmation');
    await act(async () => confirmation.click());
    await act(async () => buttonByText(host, 'Generate layout preview').click());

    const brief = host.querySelector('[aria-label="Assisted layout design direction"]');
    if (!(brief instanceof HTMLTextAreaElement)) throw new Error('Missing design direction');
    await act(async () => {
      const setTextareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setTextareaValue?.call(brief, 'Use a restrained editorial grid.');
      brief.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(receivedSignal?.aborted).toBe(true);

    await act(async () => {
      resolvePreview?.(makePreview(onGeneratePreview.mock.calls[0][0]));
      await Promise.resolve();
    });
    expect(host.querySelector('[data-paper-assisted-layout-preview="true"]')).toBeNull();
    expect(buttonByText(host, 'Generate layout preview').disabled).toBe(false);
  });
});
