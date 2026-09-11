/**
 * Generative-fill provider dispatch for the image editor.
 *
 * Adapters take a flattened source image, a binary mask, and a prompt, and
 * return a PNG Blob the caller wraps into a new layer. New adapters can be
 * registered without modifying the dispatcher.
 */
import type { ImageProvider } from '../types/flow';
import { runOpenAiInpaint } from './imageEditorAi/openAiAdapter';
import { runAtlasInpaint } from './imageEditorAi/atlasAdapter';
import { runBytePlusImage } from './imageEditorAi/bytePlusImage';
import { runGeminiInpaint } from './imageEditorAi/geminiAdapter';
import { runHuggingFaceInpaint } from './imageEditorAi/huggingFaceAdapter';
import { runGenericHttpInpaint } from './imageEditorAi/genericHttpAdapter';
import { runBflInpaint } from './imageEditorAi/bflAdapter';
import { runStabilityInpaint } from './imageEditorAi/stabilityAdapter';
import { runLocalOpenInpaint } from './imageEditorAi/localOpenAdapter';
import { estimateGenerativeFillCostUsd } from './costEstimation';
import type { ImageEditorOperationId } from './imageEditorOperations';

export type GenerativeFillProvider = Exclude<ImageProvider, 'android'> | 'generic';

export interface GenerativeFillReferenceInput {
  id: string;
  label?: string;
  description?: string;
  /** Data URL, Blob URL, or HTTP URL for providers that accept reference images. */
  imageUrl?: string;
  /** Browser-provided image data for local request building. */
  image?: Blob;
}

export interface GenerativeFillRequest {
  /** PNG of the flattened composite at document resolution (white-on-zero alpha for mask region OK). */
  source: Blob;
  /** PNG of the binary mask: 255 alpha where the AI should fill, 0 where to keep. */
  mask: Blob;
  /** User-supplied prompt. */
  prompt: string;
  /** Provider key — extensible by registering new adapters. */
  provider: GenerativeFillProvider;
  /** Optional model id; falls back to a per-provider default. */
  model?: string;
  /** Editor operation being requested; adapters can map this to provider-specific endpoints. */
  operation?: ImageEditorOperationId;
  /** Search target for search-replace/search-recolor providers. */
  searchPrompt?: string;
  /** Outpaint margins in source pixels for providers with canvas extension endpoints. */
  outpaint?: {
    left: number;
    right: number;
    up: number;
    down: number;
    creativity?: number;
  };
  /** Optional reference images and text guidance collected in the editor. */
  references?: GenerativeFillReferenceInput[];
  /** AbortSignal — cancellation will reject the returned promise. */
  abortSignal?: AbortSignal;
}

export interface GenerativeFillResult {
  png: Blob;
  modelUsed: string;
  approximateCostUsd?: number;
}

export type GenerativeFillAdapter = (
  request: GenerativeFillRequest,
) => Promise<GenerativeFillResult>;

const ADAPTERS: Record<GenerativeFillProvider, GenerativeFillAdapter> = {
  openai: runOpenAiInpaint,
  atlas: runAtlasInpaint,
  byteplus: runBytePlusImage,
  gemini: runGeminiInpaint,
  huggingface: runHuggingFaceInpaint,
  bfl: runBflInpaint,
  stability: runStabilityInpaint,
  localOpen: runLocalOpenInpaint,
  generic: runGenericHttpInpaint,
};

export async function runGenerativeFill(
  request: GenerativeFillRequest,
): Promise<GenerativeFillResult> {
  const adapter = ADAPTERS[request.provider];
  if (!adapter) {
    throw new Error(`No generative-fill adapter registered for provider: ${request.provider}`);
  }
  return adapter(request);
}

export function registerGenerativeFillAdapter(
  provider: GenerativeFillProvider,
  adapter: GenerativeFillAdapter,
): void {
  ADAPTERS[provider] = adapter;
}

export function buildGenerativeFillPrompt(input: {
  prompt: string;
  references?: GenerativeFillReferenceInput[];
}): string {
  const prompt = input.prompt.trim();
  const referenceLines = (input.references ?? [])
    .map((reference, index) => {
      const description = reference.description?.trim();
      if (!description) return null;
      const label = reference.label?.trim();
      return `${index + 1}. ${label ? `${label}: ` : ''}${description}`;
    })
    .filter((line): line is string => Boolean(line));

  if (referenceLines.length === 0) return prompt;

  return [
    prompt,
    '',
    'Reference guidance:',
    ...referenceLines,
  ].join('\n');
}

export { estimateGenerativeFillCostUsd };
