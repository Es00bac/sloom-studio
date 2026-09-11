import type { AudioGenerationMode, AudioProvider } from '../../types/flow';
import {
  createUnverifiedModelContract,
  defineProviderModelContracts,
  getProviderModelContract,
  type ModelOperation,
  type ModelParameterContract,
  type ProviderModelContract,
} from '../providerModelContracts';

const VERIFIED_AT = '2026-07-14';
const GEMINI_TTS_URL = 'https://ai.google.dev/gemini-api/docs/speech-generation';
const ELEVEN_MODELS_URL = 'https://elevenlabs.io/docs/overview/models';
const ELEVEN_TTS_URL = 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert';
const ELEVEN_STS_URL = 'https://elevenlabs.io/docs/api-reference/speech-to-speech/convert';
const ELEVEN_SFX_URL = 'https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert';
const ELEVEN_MUSIC_URL = 'https://elevenlabs.io/docs/api-reference/music/compose';
const HF_TTS_URL = 'https://huggingface.co/docs/inference-providers/en/tasks/text-to-speech';

const AUDIO_FORMAT_PARAMETER: ModelParameterContract = {
  id: 'outputFormat',
  apiName: 'output_format',
  label: 'Output format',
  type: 'string',
};

function geminiTtsContract(
  modelId: string,
  displayName: string,
  interactions: boolean,
): ProviderModelContract {
  return {
    providerId: 'gemini',
    providerName: 'Google Gemini',
    modelId,
    displayName,
    apiFamily: interactions ? 'google-interactions' : 'google-gemini',
    endpoint: interactions ? '/v1beta/interactions' : `/v1beta/models/${modelId}:generateContent`,
    auth: {
      type: 'api-key',
      credentialKey: 'gemini',
      notes: 'These TTS preview models are currently wired through the Gemini Developer API, not Vertex ADC.',
    },
    inputModalities: ['text'],
    outputModalities: ['audio'],
    operations: ['text-to-speech'],
    parameters: interactions
      ? [
          { id: 'prompt', apiName: 'input', label: 'Transcript and direction', type: 'string', required: true },
          { id: 'voice', apiName: 'generation_config.speech_config', label: 'Voice configuration', type: 'array', minItems: 1, maxItems: 2, required: true },
        ]
      : [
          { id: 'prompt', apiName: 'contents', label: 'Transcript and direction', type: 'array', minItems: 1, required: true },
          { id: 'voice', apiName: 'config.speechConfig', label: 'Voice configuration', type: 'object', required: true },
        ],
    lifecycle: 'preview',
    availability: 'documented',
    evidence: [{ title: 'Gemini text-to-speech generation', url: GEMINI_TTS_URL, verifiedAt: VERIFIED_AT }],
    limitations: [
      'Text-only input and audio-only output, with a 32k-token context window.',
      interactions
        ? 'Streaming is available on Gemini 3.1 TTS, but Flow currently waits for the complete audio result.'
        : 'Gemini 2.5 TTS does not support streaming.',
      'Long outputs can drift; split transcripts longer than a few minutes.',
    ],
    recommendedUse: interactions
      ? 'Fast expressive narration with audio tags and optional two-speaker dialogue.'
      : modelId.includes('pro') ? 'High-fidelity audiobook or podcast speech.' : 'Cost-efficient controllable narration.',
    flowExample: {
      summary: `Transcript -> ${displayName} -> WAV narration`,
      inputs: ['Connect text containing the transcript; add delivery direction in the node.'],
      outputs: ['Connect audio to Composition, File Output, or a video soundtrack workflow.'],
    },
    requestBuilder: interactions ? 'google-interactions' : 'google-gemini',
  };
}

interface ElevenTtsInput {
  modelId: string;
  displayName: string;
  characterLimit: number;
  recommendedUse: string;
}

function elevenTtsContract(input: ElevenTtsInput): ProviderModelContract {
  return {
    providerId: 'elevenlabs',
    providerName: 'ElevenLabs',
    modelId: input.modelId,
    displayName: input.displayName,
    apiFamily: 'elevenlabs',
    endpoint: '/v1/text-to-speech/{voice_id}',
    auth: { type: 'api-key', credentialKey: 'elevenlabs' },
    inputModalities: ['text'],
    outputModalities: ['audio'],
    operations: ['text-to-speech'],
    parameters: [
      { id: 'prompt', apiName: 'text', label: 'Transcript', type: 'string', required: true },
      { id: 'voice', apiName: 'voice_id', label: 'Voice', type: 'string', required: true },
      AUDIO_FORMAT_PARAMETER,
      { id: 'voiceSettings', apiName: 'voice_settings', label: 'Voice settings', type: 'object' },
      { id: 'seed', apiName: 'seed', label: 'Seed', type: 'integer', min: 0, max: 4_294_967_295 },
    ],
    lifecycle: 'stable',
    availability: 'documented',
    evidence: [
      { title: 'ElevenLabs model catalog', url: ELEVEN_MODELS_URL, verifiedAt: VERIFIED_AT },
      { title: 'ElevenLabs Create speech API', url: ELEVEN_TTS_URL, verifiedAt: VERIFIED_AT },
    ],
    limitations: [
      `A single request is limited to ${input.characterLimit.toLocaleString()} characters for this model.`,
      'Seed is best-effort only and does not guarantee identical output.',
    ],
    recommendedUse: input.recommendedUse,
    flowExample: {
      summary: `Transcript and chosen voice -> ${input.displayName} -> speech audio`,
      inputs: ['Connect text to the prompt handle and choose a voice available to the connected account.'],
      outputs: ['Connect audio to Composition, another Audio node in Voice mode, or File Output.'],
    },
    requestBuilder: 'elevenlabs',
  };
}

function elevenStsContract(modelId: string, displayName: string, englishOnly: boolean): ProviderModelContract {
  return {
    providerId: 'elevenlabs',
    providerName: 'ElevenLabs',
    modelId,
    displayName,
    apiFamily: 'elevenlabs',
    endpoint: '/v1/speech-to-speech/{voice_id}',
    auth: { type: 'api-key', credentialKey: 'elevenlabs' },
    inputModalities: ['audio'],
    outputModalities: ['audio'],
    operations: ['speech-to-speech'],
    parameters: [
      { id: 'audio', apiName: 'audio', label: 'Source audio', type: 'object', required: true },
      { id: 'voice', apiName: 'voice_id', label: 'Target voice', type: 'string', required: true },
      AUDIO_FORMAT_PARAMETER,
      { id: 'seed', apiName: 'seed', label: 'Seed', type: 'integer', min: 0, max: 4_294_967_295 },
      { id: 'removeBackgroundNoise', apiName: 'remove_background_noise', label: 'Remove background noise', type: 'boolean' },
    ],
    lifecycle: 'stable',
    availability: 'documented',
    evidence: [
      { title: 'ElevenLabs model catalog', url: ELEVEN_MODELS_URL, verifiedAt: VERIFIED_AT },
      { title: 'ElevenLabs Voice changer API', url: ELEVEN_STS_URL, verifiedAt: VERIFIED_AT },
    ],
    limitations: [
      englishOnly ? 'This model supports English only.' : 'This model supports the documented 29-language multilingual set.',
      'Source clips are limited to five minutes; split longer audio into chunks.',
    ],
    recommendedUse: 'Change a performance to a target voice while preserving timing and emotional delivery.',
    flowExample: {
      summary: `Audio performance and target voice -> ${displayName} -> transformed speech`,
      inputs: ['Connect an Audio node or imported audio asset to the Voice source handle.'],
      outputs: ['Connect transformed audio to Composition or File Output.'],
    },
    requestBuilder: 'elevenlabs',
  };
}

function elevenSfxContract(): ProviderModelContract {
  return {
    providerId: 'elevenlabs',
    providerName: 'ElevenLabs',
    modelId: 'eleven_text_to_sound_v2',
    displayName: 'Eleven Text to Sound v2',
    apiFamily: 'elevenlabs',
    endpoint: '/v1/sound-generation',
    auth: { type: 'api-key', credentialKey: 'elevenlabs' },
    inputModalities: ['text'],
    outputModalities: ['audio'],
    operations: ['text-to-sound-effect'],
    parameters: [
      { id: 'prompt', apiName: 'text', label: 'Sound description', type: 'string', required: true },
      AUDIO_FORMAT_PARAMETER,
      { id: 'loop', apiName: 'loop', label: 'Seamless loop', type: 'boolean' },
      { id: 'duration', apiName: 'duration_seconds', label: 'Duration', type: 'number', min: 0.5, max: 30 },
      { id: 'promptInfluence', apiName: 'prompt_influence', label: 'Prompt influence', type: 'number', min: 0, max: 1, defaultValue: 0.3 },
    ],
    lifecycle: 'stable',
    availability: 'documented',
    evidence: [{ title: 'ElevenLabs sound-effect generation API', url: ELEVEN_SFX_URL, verifiedAt: VERIFIED_AT }],
    limitations: ['Duration must be 0.5–30 seconds; omit it to let the model choose.', 'Looping is supported by v2.'],
    recommendedUse: 'Foley, ambience, transitions, impacts, and seamless background loops.',
    flowExample: {
      summary: 'Sound description -> Eleven Text to Sound v2 -> sound-effect audio',
      inputs: ['Connect a concise text description of the sound and its context.'],
      outputs: ['Connect audio to Composition or File Output.'],
    },
    requestBuilder: 'elevenlabs-sound-generation',
  };
}

function elevenMusicContract(): ProviderModelContract {
  return {
    providerId: 'elevenlabs',
    providerName: 'ElevenLabs',
    modelId: 'music_v2',
    displayName: 'Eleven Music v2',
    apiFamily: 'elevenlabs',
    endpoint: '/v1/music',
    auth: { type: 'api-key', credentialKey: 'elevenlabs', notes: 'Music API access requires a paid ElevenLabs plan.' },
    inputModalities: ['text'],
    outputModalities: ['audio'],
    operations: ['text-to-music'],
    parameters: [
      { id: 'prompt', apiName: 'prompt', label: 'Music prompt', type: 'string', required: true },
      AUDIO_FORMAT_PARAMETER,
      { id: 'duration', apiName: 'music_length_ms', label: 'Track duration', type: 'integer', min: 3000, max: 600_000 },
      { id: 'instrumental', apiName: 'force_instrumental', label: 'Force instrumental', type: 'boolean' },
      {
        id: 'seed',
        apiName: 'seed',
        label: 'Seed',
        type: 'integer',
        min: 0,
        max: 2_147_483_647,
        unsupportedReason: 'Seed cannot be combined with the simple prompt route; Flow does not yet expose composition-plan generation.',
      },
    ],
    lifecycle: 'stable',
    availability: 'account-dependent',
    evidence: [
      { title: 'ElevenLabs model catalog', url: ELEVEN_MODELS_URL, verifiedAt: VERIFIED_AT },
      { title: 'ElevenLabs Compose music API', url: ELEVEN_MUSIC_URL, verifiedAt: VERIFIED_AT },
    ],
    limitations: [
      'Simple-prompt generation supports 3–600 seconds and prompts up to 4,100 characters.',
      'Flow exposes prompt-based composition, duration, and instrumental output; composition plans and inpainting remain separate future operations.',
      'Commercial-use terms vary by plan and distribution context.',
    ],
    recommendedUse: 'Studio-grade songs, underscore, themes, and instrumental beds from a natural-language brief.',
    flowExample: {
      summary: 'Music brief -> Eleven Music v2 -> complete track',
      inputs: ['Connect text describing genre, structure, instruments, energy, and optional lyrics.'],
      outputs: ['Connect audio to Composition or File Output.'],
    },
    requestBuilder: 'elevenlabs',
  };
}

function hfTtsContract(modelId: string, displayName: string): ProviderModelContract {
  return {
    providerId: 'huggingface',
    providerName: 'Hugging Face Inference Providers',
    modelId,
    displayName,
    apiFamily: 'huggingface-inference',
    endpoint: `Inference Providers text-to-speech task for ${modelId}`,
    auth: { type: 'bearer', credentialKey: 'huggingface' },
    inputModalities: ['text'],
    outputModalities: ['audio'],
    operations: ['text-to-speech'],
    parameters: [{ id: 'prompt', apiName: 'inputs', label: 'Transcript', type: 'string', required: true }],
    lifecycle: 'unverified',
    availability: 'account-dependent',
    evidence: [
      { title: 'Hugging Face text-to-speech task', url: HF_TTS_URL, verifiedAt: VERIFIED_AT },
      { title: `${displayName} model card`, url: `https://huggingface.co/${modelId}`, verifiedAt: VERIFIED_AT },
    ],
    limitations: ['Voice, language, and routed-provider availability are model- and account-dependent; this Flow route sends text only.'],
    recommendedUse: 'Open-model speech generation when the selected model is served by the connected Hugging Face account.',
    flowExample: {
      summary: `Transcript -> ${displayName} -> speech audio`,
      inputs: ['Connect text to the prompt handle.'],
      outputs: ['Connect audio to Composition or File Output.'],
    },
    requestBuilder: 'huggingface-inference',
  };
}

const HF_MODELS = [
  ['hexgrad/Kokoro-82M', 'Kokoro 82M'],
  ['ResembleAI/chatterbox', 'Chatterbox'],
  ['coqui/XTTS-v2', 'XTTS v2'],
  ['microsoft/VibeVoice-1.5B', 'VibeVoice 1.5B'],
  ['suno/bark', 'Suno Bark'],
] as const;

export const AUDIO_MODEL_CONTRACTS = defineProviderModelContracts([
  geminiTtsContract('gemini-3.1-flash-tts-preview', 'Gemini 3.1 Flash TTS Preview', true),
  geminiTtsContract('gemini-2.5-flash-preview-tts', 'Gemini 2.5 Flash Preview TTS', false),
  geminiTtsContract('gemini-2.5-pro-preview-tts', 'Gemini 2.5 Pro Preview TTS', false),
  elevenTtsContract({ modelId: 'eleven_v3', displayName: 'Eleven v3', characterLimit: 5_000, recommendedUse: 'Emotionally rich performance, audio tags, dialogue, and multilingual character work.' }),
  elevenTtsContract({ modelId: 'eleven_multilingual_v2', displayName: 'Eleven Multilingual v2', characterLimit: 10_000, recommendedUse: 'Stable long-form high-fidelity narration across 29 languages.' }),
  elevenTtsContract({ modelId: 'eleven_flash_v2_5', displayName: 'Eleven Flash v2.5', characterLimit: 40_000, recommendedUse: 'Low-latency multilingual speech at lower per-character cost.' }),
  elevenTtsContract({ modelId: 'eleven_flash_v2', displayName: 'Eleven Flash v2', characterLimit: 30_000, recommendedUse: 'Low-latency English-only speech.' }),
  elevenStsContract('eleven_multilingual_sts_v2', 'Eleven Multilingual STS v2', false),
  elevenStsContract('eleven_english_sts_v2', 'Eleven English STS v2', true),
  elevenSfxContract(),
  elevenMusicContract(),
  ...HF_MODELS.map(([modelId, displayName]) => hfTtsContract(modelId, displayName)),
]);

export function audioModeToOperation(mode: AudioGenerationMode): ModelOperation {
  if (mode === 'soundEffect') return 'text-to-sound-effect';
  if (mode === 'voiceChange') return 'speech-to-speech';
  if (mode === 'music') return 'text-to-music';
  return 'text-to-speech';
}

export function getAudioModelContract(providerId: AudioProvider, modelId: string): ProviderModelContract {
  return getProviderModelContract(AUDIO_MODEL_CONTRACTS, providerId, modelId)
    ?? createUnverifiedModelContract({
      providerId,
      providerName: providerId === 'gemini' ? 'Google Gemini' : providerId === 'elevenlabs' ? 'ElevenLabs' : 'Hugging Face Inference Providers',
      modelId,
      displayName: modelId,
      apiFamily: providerId === 'gemini' ? 'google-gemini' : providerId === 'elevenlabs' ? 'elevenlabs' : 'huggingface-inference',
      endpoint: providerId === 'gemini' ? 'Configured Gemini TTS route' : providerId === 'elevenlabs' ? 'Configured ElevenLabs audio route' : 'Inference Providers text-to-speech task',
      auth: providerId === 'huggingface'
        ? { type: 'bearer', credentialKey: 'huggingface' }
        : { type: 'api-key', credentialKey: providerId },
      inputModalities: ['text'],
      outputModalities: ['audio'],
      operation: 'text-to-speech',
      requestBuilder: providerId === 'huggingface' ? 'huggingface-inference' : providerId === 'gemini' ? 'google-gemini' : 'elevenlabs',
    });
}

export interface AudioModelSupport {
  operationSupported: boolean;
  voice: boolean;
  outputFormat: boolean;
  voiceSettings: boolean;
  seed: boolean;
  duration: boolean;
  promptInfluence: boolean;
  loop: boolean;
  removeBackgroundNoise: boolean;
  instrumental: boolean;
}

export function getAudioModelSupport(
  providerId: AudioProvider,
  modelId: string,
  mode: AudioGenerationMode,
): AudioModelSupport {
  const contract = getAudioModelContract(providerId, modelId);
  const operation = audioModeToOperation(mode);
  const operationSupported = contract.availability !== 'unavailable' && contract.operations.includes(operation);
  const enabledParameter = (id: string) => operationSupported && contract.parameters.some(
    (parameter) => parameter.id === id && !parameter.unsupportedReason,
  );
  return {
    operationSupported,
    voice: enabledParameter('voice'),
    outputFormat: enabledParameter('outputFormat'),
    voiceSettings: enabledParameter('voiceSettings'),
    seed: enabledParameter('seed'),
    duration: enabledParameter('duration'),
    promptInfluence: enabledParameter('promptInfluence'),
    loop: enabledParameter('loop'),
    removeBackgroundNoise: enabledParameter('removeBackgroundNoise'),
    instrumental: enabledParameter('instrumental'),
  };
}

export function describeAudioModelCompatibility(
  provider: AudioProvider,
  modelId: string,
  audioMode: AudioGenerationMode,
): string | undefined {
  const contract = getAudioModelContract(provider, modelId);
  const operation = audioModeToOperation(audioMode);
  if (contract.availability === 'unavailable') {
    return `${contract.displayName} is no longer available.`;
  }
  if (contract.operations.includes(operation)) return undefined;
  const operationLabel = audioMode === 'soundEffect'
    ? 'sound effect generation'
    : audioMode === 'voiceChange'
      ? 'voice changing'
      : audioMode === 'music'
        ? 'music generation'
        : 'speech generation';
  return `${contract.displayName} does not support ${operationLabel}.`;
}
