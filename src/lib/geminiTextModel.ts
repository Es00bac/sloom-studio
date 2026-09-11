import type {
  EditorSourceKind,
  GeminiMediaResolution,
  GeminiThinkingLevel,
  NodeData,
  ResultType,
  TextOutputFormat,
} from '../types/flow';
import { getTextModelContract } from './modelContracts/textModelContracts';

export interface GeminiTextMediaInput {
  url: string;
  mimeType?: string;
  kind?: EditorSourceKind | ResultType;
  label?: string;
}

export type GeminiMediaResolutionLevel =
  | 'MEDIA_RESOLUTION_LOW'
  | 'MEDIA_RESOLUTION_MEDIUM'
  | 'MEDIA_RESOLUTION_HIGH'
  | 'MEDIA_RESOLUTION_ULTRA_HIGH';

export type GeminiThinkingLevelValue = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface GeminiTextInlinePartInput {
  data: string;
  mimeType: string;
  mediaResolution?: GeminiMediaResolution;
}

export interface GeminiTextInlinePart {
  inlineData: {
    data: string;
    mimeType: string;
  };
  mediaResolution?: {
    level: GeminiMediaResolutionLevel;
  };
}

export interface GeminiTextConfig {
  thinkingConfig?: {
    thinkingLevel: GeminiThinkingLevelValue;
  };
  responseMimeType?: 'application/json';
  tools?: Array<{ googleSearch: Record<string, never> } | { codeExecution: Record<string, never> }>;
}

export const GEMINI_THINKING_LEVEL_OPTIONS = [
  { value: 'default', label: 'Thinking: Default' },
  { value: 'minimal', label: 'Thinking: Minimal' },
  { value: 'low', label: 'Thinking: Low' },
  { value: 'medium', label: 'Thinking: Medium' },
  { value: 'high', label: 'Thinking: High' },
] satisfies Array<{ value: GeminiThinkingLevel; label: string }>;

export const GEMINI_MEDIA_RESOLUTION_OPTIONS = [
  { value: 'default', label: 'Media: Default' },
  { value: 'low', label: 'Media: Low' },
  { value: 'medium', label: 'Media: Medium' },
  { value: 'high', label: 'Media: High' },
  { value: 'ultraHigh', label: 'Media: Ultra High' },
] satisfies Array<{ value: GeminiMediaResolution; label: string }>;

export const TEXT_OUTPUT_FORMAT_OPTIONS = [
  { value: 'plain', label: 'Plain text' },
  { value: 'json', label: 'JSON' },
] satisfies Array<{ value: TextOutputFormat; label: string }>;

const TEXT_DOCUMENT_MIME_TYPES = new Set([
  'application/json',
  'application/pdf',
  'application/rtf',
  'application/xml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/tab-separated-values',
  'text/xml',
]);

export function buildGeminiTextConfig(data: Pick<NodeData,
  | 'geminiThinkingLevel'
  | 'geminiGoogleSearchEnabled'
  | 'geminiCodeExecutionEnabled'
  | 'textOutputFormat'
>, modelId?: string): GeminiTextConfig {
  const config: GeminiTextConfig = {};
  const contract = modelId ? getTextModelContract('gemini', modelId) : undefined;
  const supportedParameters = contract
    ? new Set(contract.parameters.map((parameter) => parameter.id))
    : undefined;
  const supports = (parameterId: string) => supportedParameters?.has(parameterId) ?? true;
  const supportsEnumValue = (parameterId: string, value: string | undefined) => {
    if (!contract || value === undefined) return true;
    const parameter = contract.parameters.find((candidate) => candidate.id === parameterId);
    return parameter?.options?.some((option) => option.value === value) ?? false;
  };
  const thinkingLevel = supports('thinkingLevel')
    && supportsEnumValue('thinkingLevel', data.geminiThinkingLevel)
    ? normalizeGeminiThinkingLevel(data.geminiThinkingLevel)
    : undefined;

  if (thinkingLevel) {
    config.thinkingConfig = {
      thinkingLevel,
    };
  }

  if (
    supports('outputFormat')
    && supportsEnumValue('outputFormat', data.textOutputFormat)
    && data.textOutputFormat === 'json'
  ) {
    config.responseMimeType = 'application/json';
  }

  const tools: GeminiTextConfig['tools'] = [];

  if (supports('googleSearch') && data.geminiGoogleSearchEnabled) {
    tools.push({ googleSearch: {} });
  }

  if (supports('codeExecution') && data.geminiCodeExecutionEnabled) {
    tools.push({ codeExecution: {} });
  }

  if (tools.length > 0) {
    config.tools = tools;
  }

  return config;
}

export function buildGeminiTextInlinePart(input: GeminiTextInlinePartInput): GeminiTextInlinePart {
  const mediaResolutionLevel = resolveGeminiMediaResolutionLevel(input.mediaResolution);

  return {
    inlineData: {
      data: input.data,
      mimeType: input.mimeType,
    },
    ...(mediaResolutionLevel
      ? {
          mediaResolution: {
            level: mediaResolutionLevel,
          },
        }
      : {}),
  };
}

export function normalizeGeminiThinkingLevel(value?: GeminiThinkingLevel): GeminiThinkingLevelValue | undefined {
  switch (value) {
    case 'minimal':
      return 'MINIMAL';
    case 'low':
      return 'LOW';
    case 'medium':
      return 'MEDIUM';
    case 'high':
      return 'HIGH';
    case 'default':
    case undefined:
      return undefined;
  }
}

export function resolveGeminiMediaResolutionLevel(
  value?: GeminiMediaResolution,
): GeminiMediaResolutionLevel | undefined {
  switch (value) {
    case 'low':
      return 'MEDIA_RESOLUTION_LOW';
    case 'medium':
      return 'MEDIA_RESOLUTION_MEDIUM';
    case 'high':
      return 'MEDIA_RESOLUTION_HIGH';
    case 'ultraHigh':
      return 'MEDIA_RESOLUTION_ULTRA_HIGH';
    case 'default':
    case undefined:
      return undefined;
  }
}

export function isGeminiTextMediaInputSupported(input: Partial<GeminiTextMediaInput>): boolean {
  const mimeType = input.mimeType?.toLowerCase().split(';', 1)[0].trim();

  if (mimeType?.startsWith('image/') || mimeType?.startsWith('audio/') || mimeType?.startsWith('video/')) {
    return true;
  }

  if (mimeType && TEXT_DOCUMENT_MIME_TYPES.has(mimeType)) {
    return true;
  }

  return input.kind === 'image' || input.kind === 'audio' || input.kind === 'video';
}

export function getDefaultGeminiTextMimeType(kind?: EditorSourceKind | ResultType): string | undefined {
  switch (kind) {
    case 'image':
      return 'image/png';
    case 'audio':
      return 'audio/mpeg';
    case 'video':
    case 'composition':
      return 'video/mp4';
    case 'document':
      return 'application/pdf';
    case 'subtitle':
    case 'text':
    case 'number':
    case 'boolean':
      return 'text/plain';
    case 'json':
      return 'application/json';
    default:
      return undefined;
  }
}

export function getGeminiTextMediaPrompt(kind?: EditorSourceKind | ResultType): string {
  switch (kind) {
    case 'audio':
      return 'Analyze this audio.';
    case 'video':
    case 'composition':
      return 'Analyze this video.';
    case 'document':
    case 'subtitle':
      return 'Analyze this document.';
    case 'image':
      return 'Describe this image in detail.';
    default:
      return 'Analyze the connected media in detail.';
  }
}
