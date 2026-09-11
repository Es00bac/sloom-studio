import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODELS, DEFAULT_PROVIDER_SETTINGS } from '../../../lib/providerCatalog';
import type { RuntimeSettingsSnapshot } from '../../../types/flow';
import { createPaperWritingSourceSnapshot } from './paperWritingAssistant';

const executionMocks = vi.hoisted(() => ({
  executeNodeRequest: vi.fn(async (..._args: unknown[]) => ({
    result: 'Provider result',
    resultType: 'text',
    statusMessage: 'Generated',
  })),
}));

vi.mock('../../../lib/flowExecution', () => ({
  executeNodeRequest: executionMocks.executeNodeRequest,
}));

import {
  createFlowPaperWritingTextExecutor,
  createNativeCliPaperWritingTextExecutor,
  createPaperWritingTextExecutor,
  generatePaperWritingPreview,
  type PaperWritingTextExecutor,
} from './paperWritingAssistantService';

const settings: RuntimeSettingsSnapshot = {
  apiKeys: {
    openai: 'configured-openai-secret',
    gemini: 'configured-gemini-secret',
    huggingface: '',
    elevenlabs: '',
    bfl: '',
    stability: '',
    atlas: '',
    byteplus: '',
  },
  defaultModels: DEFAULT_MODELS,
  providerSettings: DEFAULT_PROVIDER_SETTINGS,
};

function source() {
  return createPaperWritingSourceSnapshot({
    workspaceDocumentId: 'tab-1',
    documentInstanceId: 'instance-1',
    documentId: 'document-1',
    pageId: 'page-1',
    frameId: 'frame-1',
    sourceKind: 'plain-text',
    sourceRevision: 3,
    targetEditable: true,
    text: 'Teh headline.',
  });
}

describe('Paper writing assistant service', () => {
  it('creates a normalized preview only when explicitly invoked', async () => {
    const execute = vi.fn(async () => ({
      text: '```text\nThe headline.\n```',
      provider: 'openai' as const,
      modelId: 'test-model',
      usage: { source: 'actual' as const, confidence: 'measured' as const, inputTokens: 10, outputTokens: 5 },
    }));
    const executor: PaperWritingTextExecutor = { execute };

    expect(execute).not.toHaveBeenCalled();
    const result = await generatePaperWritingPreview({
      action: 'proofread',
      provider: 'openai',
      modelId: 'test-model',
      source: source(),
    }, executor, {
      createId: () => 'preview-1',
      now: () => new Date('2026-07-21T18:00:00.000Z'),
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      modelId: 'test-model',
      systemPrompt: expect.stringContaining('plain text'),
      userPrompt: expect.stringContaining('Teh headline.'),
    }));
    expect(result).toMatchObject({
      id: 'preview-1',
      generatedText: 'The headline.',
      provider: 'openai',
      modelId: 'test-model',
      createdAt: '2026-07-21T18:00:00.000Z',
      source: { fingerprint: source().fingerprint },
      usage: expect.objectContaining({ inputTokens: 10, outputTokens: 5 }),
    });
  });

  it('adapts Paper requests to the existing provider-neutral Flow text executor', async () => {
    executionMocks.executeNodeRequest.mockClear();
    const abortController = new AbortController();
    const executor = createFlowPaperWritingTextExecutor(settings);

    const result = await executor.execute({
      provider: 'gemini',
      systemPrompt: 'System policy',
      userPrompt: 'Edit this copy',
      signal: abortController.signal,
    });

    expect(executionMocks.executeNodeRequest).toHaveBeenCalledOnce();
    expect(executionMocks.executeNodeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'textNode',
        data: expect.objectContaining({
          mode: 'generate',
          provider: 'gemini',
          modelId: DEFAULT_MODELS.text.gemini,
          systemPrompt: 'System policy',
          prompt: 'Edit this copy',
          textOutputFormat: 'plain',
        }),
      }),
      expect.objectContaining({ prompt: '' }),
      settings,
      undefined,
      { signal: abortController.signal },
    );
    const outboundNode = executionMocks.executeNodeRequest.mock.calls[0]?.[0];
    expect(JSON.stringify(outboundNode)).not.toContain('configured-gemini-secret');
    expect(result).toEqual({
      text: 'Provider result',
      provider: 'gemini',
      modelId: DEFAULT_MODELS.text.gemini,
    });
  });

  it('routes native providers through the fixed desktop bridge without exposing executable details', async () => {
    const runNativeCliAgent = vi.fn(async (request) => ({
      ok: true,
      requestId: request.requestId,
      agent: request.agent,
      text: 'Corrected through the CLI.',
    }));
    const cancelNativeCliAgent = vi.fn(async () => ({ cancelled: true }));
    const native = createNativeCliPaperWritingTextExecutor({ runNativeCliAgent, cancelNativeCliAgent });
    const executor = createPaperWritingTextExecutor(createFlowPaperWritingTextExecutor(settings), native);

    const result = await executor.execute({
      purpose: 'writing-assistant',
      provider: 'native-cli:kimi',
      modelId: 'k3',
      systemPrompt: 'System policy',
      userPrompt: 'Edit this copy',
    });

    expect(runNativeCliAgent).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'kimi',
      purpose: 'writing-assistant',
      modelId: 'k3',
      systemPrompt: 'System policy',
      userPrompt: 'Edit this copy',
      requestId: expect.stringMatching(/^paper-writing-assistant-/),
    }));
    expect(JSON.stringify(runNativeCliAgent.mock.calls[0]?.[0])).not.toMatch(/executable|apiKey|configured-kimi-secret/i);
    expect(result).toEqual({
      text: 'Corrected through the CLI.',
      provider: 'native-cli:kimi',
      modelId: 'k3',
    });
  });

  it('propagates cancellation to the main-owned native process', async () => {
    let resolveRun: ((value: { ok: false; cancelled: true }) => void) | undefined;
    const runNativeCliAgent = vi.fn(() => new Promise<{ ok: false; cancelled: true }>((resolve) => {
      resolveRun = resolve;
    }));
    const cancelNativeCliAgent = vi.fn(async () => ({ cancelled: true }));
    const executor = createNativeCliPaperWritingTextExecutor({ runNativeCliAgent, cancelNativeCliAgent });
    const controller = new AbortController();
    const pending = executor.execute({
      provider: 'native-cli:codex',
      systemPrompt: 'System policy',
      userPrompt: 'Edit this copy',
      signal: controller.signal,
    });

    controller.abort();
    expect(cancelNativeCliAgent).toHaveBeenCalledWith(expect.stringMatching(/^paper-writing-assistant-/));
    resolveRun?.({ ok: false, cancelled: true });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
