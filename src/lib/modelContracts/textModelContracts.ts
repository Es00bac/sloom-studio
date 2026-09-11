import {
  createUnverifiedModelContract,
  defineProviderModelContracts,
  getProviderModelContract,
  type ModelLifecycle,
  type ModelParameterContract,
  type ProviderModelContract,
} from '../providerModelContracts';
import type { TextProvider } from '../../types/flow';

const VERIFIED_AT = '2026-07-14';
const GEMINI_MODELS_URL = 'https://ai.google.dev/gemini-api/docs/models';
const GEMINI_THINKING_URL = 'https://ai.google.dev/gemini-api/docs/generate-content/thinking';
const OPENAI_MODELS_URL = 'https://developers.openai.com/api/docs/models';
const HF_CHAT_URL = 'https://huggingface.co/docs/inference-providers/en/tasks/chat-completion';

const DEFAULT_THINKING_OPTIONS = [
  { value: 'default', label: 'Thinking: Default' },
  { value: 'minimal', label: 'Thinking: Minimal' },
  { value: 'low', label: 'Thinking: Low' },
  { value: 'medium', label: 'Thinking: Medium' },
  { value: 'high', label: 'Thinking: High' },
] as const;

const PRO_THINKING_OPTIONS = DEFAULT_THINKING_OPTIONS.filter(
  (option) => option.value !== 'minimal',
);

const GEMINI_MEDIA_RESOLUTION_OPTIONS = [
  { value: 'default', label: 'Media: Default' },
  { value: 'low', label: 'Media: Low' },
  { value: 'medium', label: 'Media: Medium' },
  { value: 'high', label: 'Media: High' },
  { value: 'ultraHigh', label: 'Media: Ultra High' },
] as const;

const TEXT_OUTPUT_OPTIONS = [
  { value: 'plain', label: 'Plain text' },
  { value: 'json', label: 'JSON' },
] as const;

interface GeminiTextContractInput {
  modelId: string;
  displayName: string;
  lifecycle: Extract<ModelLifecycle, 'stable' | 'preview'>;
  recommendedUse: string;
  thinkingOptions?: typeof DEFAULT_THINKING_OPTIONS | typeof PRO_THINKING_OPTIONS;
  gemini3?: boolean;
}

function geminiTextContract(input: GeminiTextContractInput): ProviderModelContract {
  const parameters: ModelParameterContract[] = [
    {
      id: 'prompt',
      apiName: 'contents',
      label: 'Prompt and media contents',
      type: 'array',
      minItems: 1,
      required: true,
    },
    {
      id: 'systemPrompt',
      apiName: 'systemInstruction',
      label: 'System prompt',
      type: 'string',
    },
    ...(input.thinkingOptions
      ? [
          {
            id: 'thinkingLevel',
            apiName: 'thinkingConfig',
            label: 'Thinking level',
            type: 'enum' as const,
            options: input.thinkingOptions,
            description: 'Controls the model reasoning depth; Default leaves provider behavior unchanged.',
          },
        ]
      : []),
    ...(input.gemini3
      ? [
          {
            id: 'mediaResolution',
            apiName: 'mediaResolution',
            label: 'Media resolution',
            type: 'enum' as const,
            options: GEMINI_MEDIA_RESOLUTION_OPTIONS,
            description: 'Sets per-media token resolution for Gemini 3 inputs.',
          },
        ]
      : []),
    {
      id: 'outputFormat',
      apiName: 'responseMimeType',
      label: 'Output format',
      type: 'enum',
      options: TEXT_OUTPUT_OPTIONS,
    },
    {
      id: 'googleSearch',
      apiName: 'tools.googleSearch',
      label: 'Google Search',
      type: 'boolean',
    },
    {
      id: 'codeExecution',
      apiName: 'tools.codeExecution',
      label: 'Code execution',
      type: 'boolean',
    },
  ];

  return {
    providerId: 'gemini',
    providerName: 'Google Gemini / Vertex AI',
    modelId: input.modelId,
    displayName: input.displayName,
    apiFamily: 'google-gemini',
    endpoint: 'models/{model}:generateContent or Vertex publishers/google/models/{model}:generateContent',
    auth: {
      type: 'api-key-or-vertex-adc',
      credentialKey: 'gemini',
      notes: 'Flow supports a Gemini API key or in-app Vertex ADC credentials.',
    },
    inputModalities: ['text', 'image', 'video', 'audio', 'pdf'],
    outputModalities: ['text'],
    operations: ['text-generation'],
    parameters,
    lifecycle: input.lifecycle,
    availability: input.lifecycle === 'preview' ? 'rollout-dependent' : 'documented',
    evidence: [
      { title: 'Gemini model catalog', url: GEMINI_MODELS_URL, verifiedAt: VERIFIED_AT },
      { title: 'Gemini thinking controls', url: GEMINI_THINKING_URL, verifiedAt: VERIFIED_AT },
    ],
    limitations: [
      input.lifecycle === 'preview'
        ? 'Preview availability, quotas, and identifiers can change before general availability.'
        : 'Availability and quotas vary by Gemini API tier and Vertex region.',
      'This Flow route produces text; native image, video, and audio generation use dedicated nodes.',
    ],
    recommendedUse: input.recommendedUse,
    flowExample: {
      summary: `Prompt or media -> ${input.displayName} -> downstream text workflow`,
      inputs: ['Connect a prompt and optionally image, video, audio, or document context.'],
      outputs: ['Connect the text output to an Image, Video, Audio, JSON, or Composition workflow.'],
    },
    requestBuilder: 'google-gemini',
  };
}

interface OpenAiTextContractInput {
  modelId: string;
  displayName: string;
  recommendedUse: string;
}

function openAiTextContract(input: OpenAiTextContractInput): ProviderModelContract {
  return {
    providerId: 'openai',
    providerName: 'OpenAI / Compatible',
    modelId: input.modelId,
    displayName: input.displayName,
    apiFamily: 'openai-chat-completions',
    endpoint: '/v1/chat/completions',
    auth: { type: 'api-key', credentialKey: 'openai' },
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    operations: ['text-generation'],
    parameters: [
      {
        id: 'messages',
        apiName: 'messages',
        label: 'Messages',
        type: 'array',
        minItems: 1,
        required: true,
      },
    ],
    lifecycle: 'stable',
    availability: 'documented',
    evidence: [
      {
        title: 'OpenAI model catalog',
        url: OPENAI_MODELS_URL,
        verifiedAt: VERIFIED_AT,
      },
      {
        title: `${input.displayName} model reference`,
        url: `https://developers.openai.com/api/docs/models/${input.modelId}`,
        verifiedAt: VERIFIED_AT,
      },
    ],
    limitations: [
      'Flow currently uses Chat Completions for OpenAI and compatible hosts, so Responses-only tools are not exposed.',
      'Audio, video, and PDF input are not enabled on this Flow route.',
    ],
    recommendedUse: input.recommendedUse,
    flowExample: {
      summary: `Prompt or image -> ${input.displayName} -> generated text`,
      inputs: ['Connect text and optionally image context to the Text Generation node.'],
      outputs: ['Connect generated text to an Image prompt, script utility, or Composition node.'],
    },
    requestBuilder: 'openai-chat-completions',
  };
}

function huggingFaceTextContract(modelId: string, displayName: string): ProviderModelContract {
  return {
    providerId: 'huggingface',
    providerName: 'Hugging Face Inference Providers',
    modelId,
    displayName,
    apiFamily: 'huggingface-inference',
    endpoint: 'https://router.huggingface.co/v1/chat/completions',
    auth: { type: 'bearer', credentialKey: 'huggingface' },
    inputModalities: ['text'],
    outputModalities: ['text'],
    operations: ['text-generation'],
    parameters: [
      {
        id: 'messages',
        apiName: 'messages',
        label: 'Messages',
        type: 'array',
        minItems: 1,
        required: true,
      },
    ],
    lifecycle: 'unverified',
    availability: 'account-dependent',
    evidence: [
      {
        title: 'Hugging Face chat-completion task and recommended models',
        url: HF_CHAT_URL,
        verifiedAt: VERIFIED_AT,
      },
      {
        title: `${displayName} model card`,
        url: `https://huggingface.co/${modelId}`,
        verifiedAt: VERIFIED_AT,
      },
    ],
    limitations: [
      'Inference Provider routing, provider suffixes, quotas, and availability depend on the user account.',
      'The model remains selectable, but only the chat messages supported by Flow are asserted here.',
    ],
    recommendedUse: 'Open-model conversational text generation when the selected Hugging Face route serves this model.',
    flowExample: {
      summary: `Prompt -> ${displayName} through Hugging Face -> generated text`,
      inputs: ['Connect a Text prompt; verify provider availability for the selected account.'],
      outputs: ['Connect the generated text to a compatible downstream text input.'],
    },
    requestBuilder: 'huggingface-inference',
  };
}

export const TEXT_MODEL_CONTRACTS = defineProviderModelContracts([
  geminiTextContract({
    modelId: 'gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash',
    lifecycle: 'stable',
    thinkingOptions: DEFAULT_THINKING_OPTIONS,
    gemini3: true,
    recommendedUse: 'Fast frontier multimodal analysis, coding, and sustained agentic work.',
  }),
  geminiTextContract({
    modelId: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro Preview',
    lifecycle: 'preview',
    thinkingOptions: PRO_THINKING_OPTIONS,
    gemini3: true,
    recommendedUse: 'Complex reasoning and coding when preview availability is acceptable.',
  }),
  geminiTextContract({
    modelId: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash Preview',
    lifecycle: 'preview',
    thinkingOptions: DEFAULT_THINKING_OPTIONS,
    gemini3: true,
    recommendedUse: 'Preview testing of the Gemini 3 Flash line with explicit thinking controls.',
  }),
  geminiTextContract({
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash-Lite',
    lifecycle: 'stable',
    thinkingOptions: DEFAULT_THINKING_OPTIONS,
    gemini3: true,
    recommendedUse: 'Low-latency, high-volume classification, extraction, translation, and summarization.',
  }),
  geminiTextContract({
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    lifecycle: 'stable',
    recommendedUse: 'Established price-performance multimodal text generation.',
  }),
  geminiTextContract({
    modelId: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    lifecycle: 'stable',
    recommendedUse: 'Established high-quality reasoning and coding workflows.',
  }),
  geminiTextContract({
    modelId: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash-Lite',
    lifecycle: 'stable',
    recommendedUse: 'Budget-sensitive, high-throughput multimodal text work.',
  }),
  openAiTextContract({
    modelId: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    recommendedUse: 'Complex professional reasoning, coding, and long-context work.',
  }),
  openAiTextContract({
    modelId: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    recommendedUse: 'Balanced intelligence and cost for most production text workflows.',
  }),
  openAiTextContract({
    modelId: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    recommendedUse: 'Cost-sensitive, high-volume text and vision workloads.',
  }),
  huggingFaceTextContract('Qwen/Qwen3-4B-Thinking-2507', 'Qwen 3 4B Thinking 2507'),
  huggingFaceTextContract('openai/gpt-oss-120b', 'GPT OSS 120B'),
  huggingFaceTextContract('Qwen/Qwen3-Coder-480B-A35B-Instruct', 'Qwen 3 Coder 480B A35B'),
  huggingFaceTextContract('zai-org/GLM-4.5', 'GLM 4.5'),
  huggingFaceTextContract('deepseek-ai/DeepSeek-R1', 'DeepSeek R1'),
]);

export function getTextModelContract(
  providerId: TextProvider,
  modelId: string,
): ProviderModelContract {
  return getProviderModelContract(TEXT_MODEL_CONTRACTS, providerId, modelId)
    ?? createUnverifiedModelContract({
      providerId,
      providerName: providerId === 'gemini'
        ? 'Google Gemini / Vertex AI'
        : providerId === 'openai'
          ? 'OpenAI / Compatible'
          : 'Hugging Face Inference Providers',
      modelId,
      displayName: modelId,
      apiFamily: providerId === 'gemini'
        ? 'google-gemini'
        : providerId === 'openai'
          ? 'openai-chat-completions'
          : 'huggingface-inference',
      endpoint: providerId === 'gemini'
        ? 'Configured Gemini generateContent route'
        : providerId === 'openai'
          ? '/v1/chat/completions'
          : 'Inference Providers chat-completion task',
      auth: providerId === 'gemini'
        ? { type: 'api-key-or-vertex-adc', credentialKey: 'gemini' }
        : { type: providerId === 'openai' ? 'api-key' : 'bearer', credentialKey: providerId },
      inputModalities: ['text'],
      outputModalities: ['text'],
      operation: 'text-generation',
      requestBuilder: providerId === 'gemini'
        ? 'google-gemini'
        : providerId === 'openai'
          ? 'openai-chat-completions'
          : 'huggingface-inference',
    });
}
