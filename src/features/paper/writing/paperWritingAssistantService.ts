import { executeNodeRequest } from '../../../lib/flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from '../../../lib/providerCatalog';
import type { AppNode, RuntimeSettingsSnapshot, TextProvider, UsageTelemetry } from '../../../types/flow';
import type { SignalLoomNativeBridge } from '../../../lib/nativeApp';
import {
  buildPaperWritingPrompt,
  normalizePaperWritingOutput,
  paperWritingNativeCliAgent,
  type PaperWritingGenerateRequest,
  type PaperWritingPreview,
  type PaperWritingProvider,
} from './paperWritingAssistant';

export interface PaperWritingTextExecutionRequest {
  purpose?: 'writing-assistant' | 'assisted-layout' | 'live-layout-agent';
  provider: PaperWritingProvider;
  modelId?: string;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

export interface PaperWritingTextExecutionResult {
  text: string;
  provider: PaperWritingProvider;
  modelId?: string;
  usage?: UsageTelemetry;
}

/**
 * The assistant owns prompt and preview policy; provider execution stays replaceable so Paper does
 * not learn about API keys, SDK clients, native Vertex auth, or backend-proxy credentials.
 */
export interface PaperWritingTextExecutor {
  execute: (request: PaperWritingTextExecutionRequest) => Promise<PaperWritingTextExecutionResult>;
}

export interface GeneratePaperWritingPreviewOptions {
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
  now?: () => Date;
  createId?: () => string;
}

/**
 * Performs exactly one explicit preview request. Callers must invoke this from a user action; this
 * module has no mount, selection-change, timer, or background execution path.
 */
export async function generatePaperWritingPreview(
  request: PaperWritingGenerateRequest,
  executor: PaperWritingTextExecutor,
  options: GeneratePaperWritingPreviewOptions = {},
): Promise<PaperWritingPreview> {
  const prompt = buildPaperWritingPrompt(request);
  const result = await executor.execute({
    purpose: 'writing-assistant',
    provider: request.provider,
    ...(request.modelId ? { modelId: request.modelId } : {}),
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onStatus ? { onStatus: options.onStatus } : {}),
  });
  const generatedText = normalizePaperWritingOutput(result.text);
  if (!generatedText) throw new Error('The configured writing model returned an empty preview.');

  return {
    id: options.createId?.() ?? createPaperWritingPreviewId(),
    action: request.action,
    provider: result.provider,
    ...(result.modelId ? { modelId: result.modelId } : {}),
    generatedText,
    source: request.source,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

/**
 * Reuses Flow's existing provider-neutral text execution route. Provider credentials remain in the
 * existing runtime snapshot and are consumed by that route; Paper never persists or serializes them.
 */
export function createFlowPaperWritingTextExecutor(
  settings: RuntimeSettingsSnapshot,
): PaperWritingTextExecutor {
  return {
    execute: async (request) => {
      if (paperWritingNativeCliAgent(request.provider)) {
        throw new Error('A local coding-agent request cannot use the Flow provider executor.');
      }
      const provider = request.provider as TextProvider;
      const resolvedModelId = request.modelId ?? settings.defaultModels.text[provider];
      const node: AppNode = {
        id: 'paper-writing-assistant-preview',
        type: 'textNode',
        position: { x: 0, y: 0 },
        data: {
          mode: 'generate',
          provider,
          modelId: resolvedModelId,
          prompt: request.userPrompt,
          systemPrompt: request.systemPrompt,
          textOutputFormat: 'plain',
        },
      };

      const result = await executeNodeRequest(
        node,
        { prompt: '', config: DEFAULT_EXECUTION_CONFIG },
        settings,
        request.onStatus,
        request.signal ? { signal: request.signal } : {},
      );
      if (typeof result.result !== 'string') {
        throw new Error('The configured writing model did not return text.');
      }
      return {
        text: result.result,
        provider,
        modelId: resolvedModelId,
        ...(result.usage ? { usage: result.usage } : {}),
      };
    },
  };
}

export function createNativeCliPaperWritingTextExecutor(
  bridge: Pick<SignalLoomNativeBridge, 'runNativeCliAgent' | 'cancelNativeCliAgent'>,
): PaperWritingTextExecutor {
  return {
    execute: async (request) => {
      const agent = paperWritingNativeCliAgent(request.provider);
      if (!agent) throw new Error('Choose an installed local coding agent.');
      if (!bridge.runNativeCliAgent) throw new Error('Local coding agents require the Sloom Studio desktop app.');
      if (request.signal?.aborted) throw createAbortError();
      const purpose = request.purpose ?? 'writing-assistant';
      const requestId = createNativeCliRequestId(purpose);
      const cancel = () => { void bridge.cancelNativeCliAgent?.(requestId); };
      request.signal?.addEventListener('abort', cancel, { once: true });
      try {
        const result = await bridge.runNativeCliAgent({
          requestId,
          agent,
          purpose,
          systemPrompt: request.systemPrompt,
          userPrompt: request.userPrompt,
          ...(request.modelId ? { modelId: request.modelId } : {}),
        });
        if (request.signal?.aborted || result.cancelled) throw createAbortError();
        if (!result.ok || typeof result.text !== 'string') {
          throw new Error(result.error || 'The local coding agent did not return text.');
        }
        return {
          text: result.text,
          provider: request.provider,
          ...(request.modelId ? { modelId: request.modelId } : {}),
        };
      } finally {
        request.signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

export function createPaperWritingTextExecutor(
  flowExecutor: PaperWritingTextExecutor,
  nativeExecutor?: PaperWritingTextExecutor,
): PaperWritingTextExecutor {
  return {
    execute: (request) => paperWritingNativeCliAgent(request.provider)
      ? nativeExecutor?.execute(request) ?? Promise.reject(new Error('Local coding agents require the Sloom Studio desktop app.'))
      : flowExecutor.execute(request),
  };
}

function createPaperWritingPreviewId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ?? `paper-writing-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createNativeCliRequestId(purpose: 'writing-assistant' | 'assisted-layout' | 'live-layout-agent'): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `paper-${purpose}-${suffix}`;
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') return new DOMException('The request was cancelled.', 'AbortError');
  const error = new Error('The request was cancelled.');
  error.name = 'AbortError';
  return error;
}
