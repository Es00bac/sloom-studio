import type { GeminiCredentialMode, VideoProvider, VideoResolution } from '../../types/flow';
import {
  createUnverifiedModelContract,
  defineProviderModelContracts,
  getProviderModelContract,
  type ModelLifecycle,
  type ModelOperation,
  type ModelParameterContract,
  type ProviderModelContract,
} from '../providerModelContracts';

const VERIFIED_AT = '2026-07-14';
const GEMINI_VIDEO_URL = 'https://ai.google.dev/gemini-api/docs/veo';
const GEMINI_OMNI_URL = 'https://ai.google.dev/gemini-api/docs/omni';
const GEMINI_CHANGELOG_URL = 'https://ai.google.dev/gemini-api/docs/changelog';
const VERTEX_VEO_URL = 'https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate';
const HF_VIDEO_URL = 'https://huggingface.co/docs/inference-providers/en/tasks/text-to-video';
const ATLAS_MODELS_URL = 'https://www.atlascloud.ai/models';

const ASPECT_OPTIONS = [
  { value: '16:9', label: '16:9 Landscape' },
  { value: '9:16', label: '9:16 Portrait' },
] as const;

const VEO_DURATION_OPTIONS = [
  { value: '4', label: '4 seconds' },
  { value: '6', label: '6 seconds' },
  { value: '8', label: '8 seconds' },
] as const;

const OMNI_DURATION_OPTIONS = Array.from({ length: 8 }, (_, index) => {
  const seconds = index + 3;
  return { value: String(seconds), label: `${seconds} seconds` };
});

const RESOLUTION_4K_OPTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4K' },
] as const;

const RESOLUTION_1080_OPTIONS = RESOLUTION_4K_OPTIONS.filter((option) => option.value !== '4k');

const OMNI_TASK_OPTIONS = [
  { value: 'text_to_video', label: 'Text to video' },
  { value: 'image_to_video', label: 'Image to video' },
  { value: 'reference_to_video', label: 'Reference to video' },
  { value: 'edit', label: 'Edit video' },
] as const;

export interface VideoModelSupport {
  imageToVideo: boolean;
  interpolation: boolean;
  referenceImages: boolean;
  maxReferenceImages: number;
  videoExtension: boolean;
  videoEdit: boolean;
  negativePrompt: boolean;
  generatedAudio: boolean;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  fixedResolution?: VideoResolution;
  maxResolution?: VideoResolution;
}

function operationsParameter(
  id: string,
  apiName: string,
  label: string,
  type: ModelParameterContract['type'],
  operations: readonly ModelOperation[],
  required = false,
): ModelParameterContract {
  return { id, apiName, label, type, conditions: { operations }, required };
}

interface VeoContractInput {
  modelId: string;
  displayName: string;
  lifecycle: Extract<ModelLifecycle, 'stable' | 'preview' | 'shutdown'>;
  availability: ProviderModelContract['availability'];
  lite?: boolean;
  supportsReferences?: boolean;
  supportsExtension?: boolean;
  migrationModelId?: string;
  shutdownAt?: string;
}

function veoContract(input: VeoContractInput): ProviderModelContract {
  const operations: ModelOperation[] = [
    'text-to-video',
    'image-to-video',
    'frame-interpolation',
    ...(input.supportsReferences ? ['reference-to-video' as const] : []),
    ...(input.supportsExtension ? ['video-extension' as const] : []),
  ];
  const evidenceUrl = input.modelId.endsWith('-001') ? VERTEX_VEO_URL : GEMINI_VIDEO_URL;
  return {
    providerId: 'gemini',
    providerName: 'Google Gemini / Vertex AI',
    modelId: input.modelId,
    displayName: input.displayName,
    apiFamily: input.modelId.endsWith('-001') ? 'google-vertex' : 'google-gemini',
    endpoint: input.modelId.endsWith('-001')
      ? `Vertex publishers/google/models/${input.modelId}:predictLongRunning`
      : `/v1beta/models/${input.modelId}:predictLongRunning`,
    auth: {
      type: 'api-key-or-vertex-adc',
      credentialKey: 'gemini',
      notes: 'The -preview identifiers are Gemini Developer API IDs; -001 identifiers are Vertex/Enterprise IDs.',
    },
    inputModalities: ['text', 'image', ...(input.supportsExtension ? ['video' as const] : [])],
    outputModalities: ['video', 'audio'],
    operations,
    parameters: [
      { id: 'prompt', apiName: 'instances[].prompt', label: 'Prompt', type: 'string' },
      operationsParameter('startFrame', 'instances[].image', 'Start frame', 'object', ['image-to-video', 'frame-interpolation']),
      operationsParameter('endFrame', 'instances[].lastFrame', 'End frame', 'object', ['frame-interpolation'], true),
      ...(input.supportsReferences
        ? [{
            id: 'referenceImages',
            apiName: 'instances[].referenceImages',
            label: 'Reference images',
            type: 'array' as const,
            maxItems: 3,
            conditions: { operations: ['reference-to-video' as const] },
          }]
        : []),
      ...(input.supportsExtension
        ? [operationsParameter('extensionVideo', 'instances[].video', 'Video to extend', 'object', ['video-extension'], true)]
        : []),
      { id: 'aspectRatio', apiName: 'parameters.aspectRatio', label: 'Aspect ratio', type: 'enum', options: ASPECT_OPTIONS },
      { id: 'duration', apiName: 'parameters.durationSeconds', label: 'Duration', type: 'enum', options: VEO_DURATION_OPTIONS },
      {
        id: 'resolution',
        apiName: 'parameters.resolution',
        label: 'Resolution',
        type: 'enum',
        options: input.lite ? RESOLUTION_1080_OPTIONS : RESOLUTION_4K_OPTIONS,
      },
      { id: 'negativePrompt', apiName: 'parameters.negativePrompt', label: 'Negative prompt', type: 'string' },
      { id: 'seed', apiName: 'parameters.seed', label: 'Seed', type: 'integer', min: 0 },
      { id: 'sampleCount', apiName: 'parameters.sampleCount', label: 'Videos per request', type: 'integer', min: 1, max: 1 },
    ],
    lifecycle: input.lifecycle,
    availability: input.availability,
    evidence: [
      { title: `${input.displayName} API documentation`, url: evidenceUrl, verifiedAt: VERIFIED_AT },
      { title: 'Gemini video lifecycle release notes', url: GEMINI_CHANGELOG_URL, verifiedAt: VERIFIED_AT },
    ],
    limitations: [
      input.lite ? 'Lite does not support reference images or 4K output on this route.' : 'Reference guidance is limited to three images.',
      'Interpolation, reference guidance, and extension impose model-specific duration, aspect, and resolution constraints.',
      input.lifecycle === 'shutdown' ? `This endpoint shut down on ${input.shutdownAt}; it is retained only for saved-flow diagnostics.` : 'Availability and quotas vary between Gemini Developer API and Vertex AI.',
    ],
    recommendedUse: input.lite
      ? 'Cost-efficient prompt or start-frame video generation.'
      : 'Cinematic generation requiring explicit last-frame, reference-image, or extension controls.',
    flowExample: {
      summary: `Prompt and optional conditioning media -> ${input.displayName} -> video with audio`,
      inputs: ['Connect text to Prompt and images/videos only to controls supported by this exact route.'],
      outputs: ['Connect video to Frame Extract, Composition, or File Output; generated audio remains embedded.'],
    },
    requestBuilder: input.modelId.endsWith('-001') ? 'google-vertex' : 'google-gemini',
    migrationModelId: input.migrationModelId,
    shutdownAt: input.shutdownAt,
  };
}

function omniContract(): ProviderModelContract {
  return {
    providerId: 'gemini',
    providerName: 'Google Gemini / Vertex AI',
    modelId: 'gemini-omni-flash-preview',
    displayName: 'Gemini Omni Flash Preview',
    apiFamily: 'google-interactions',
    endpoint: '/v1beta/interactions',
    auth: { type: 'api-key-or-vertex-adc', credentialKey: 'gemini' },
    inputModalities: ['text', 'image', 'video'],
    outputModalities: ['video', 'audio'],
    operations: ['text-to-video', 'image-to-video', 'reference-to-video', 'video-edit'],
    parameters: [
      { id: 'input', apiName: 'input', label: 'Prompt and media', type: 'array', minItems: 1, required: true },
      { id: 'referenceImages', apiName: 'input[].image', label: 'Reference images', type: 'array', maxItems: 3, conditions: { operations: ['reference-to-video'] } },
      { id: 'aspectRatio', apiName: 'response_format.aspect_ratio', label: 'Aspect ratio', type: 'enum', options: ASPECT_OPTIONS },
      { id: 'duration', apiName: 'generation_config.video_config.duration', label: 'Duration', type: 'enum', options: OMNI_DURATION_OPTIONS },
      { id: 'task', apiName: 'generation_config.video_config.task', label: 'Task', type: 'enum', options: OMNI_TASK_OPTIONS },
      { id: 'previousInteraction', apiName: 'previous_interaction_id', label: 'Previous interaction', type: 'string', conditions: { operations: ['video-edit'] } },
    ],
    lifecycle: 'preview',
    availability: 'documented',
    evidence: [
      { title: 'Gemini Omni Flash guide', url: GEMINI_OMNI_URL, verifiedAt: VERIFIED_AT },
      { title: 'Gemini video model overview', url: 'https://ai.google.dev/gemini-api/docs/video', verifiedAt: VERIFIED_AT },
    ],
    limitations: [
      'Output is 720p at 24 FPS and 3–10 seconds.',
      'Video extension and first/last-frame interpolation are not supported.',
      'Negative prompts and uploaded audio references are not supported; put exclusions and audio direction in the main prompt.',
      'Uploaded-video editing has regional restrictions and video references are currently unreliable.',
    ],
    recommendedUse: 'Default high-speed text/image-to-video generation, multi-image subject guidance, and conversational editing.',
    flowExample: {
      summary: 'Prompt and up to three image inputs -> Gemini Omni Flash -> short 720p video with audio',
      inputs: ['Connect a prompt and optionally start/reference images. Use a video input only for edit, not extension.'],
      outputs: ['Connect the video output to Composition, Frame Extract, or File Output.'],
    },
    requestBuilder: 'google-interactions',
  };
}

function hfContract(modelId: string, displayName: string): ProviderModelContract {
  return {
    providerId: 'huggingface',
    providerName: 'Hugging Face Inference Providers',
    modelId,
    displayName,
    apiFamily: 'huggingface-inference',
    endpoint: `Inference Providers text-to-video task for ${modelId}`,
    auth: { type: 'bearer', credentialKey: 'huggingface' },
    inputModalities: ['text'],
    outputModalities: ['video'],
    operations: ['text-to-video'],
    parameters: [
      { id: 'prompt', apiName: 'inputs', label: 'Prompt', type: 'string', required: true },
      { id: 'frames', apiName: 'parameters.num_frames', label: 'Frame count', type: 'integer', min: 1 },
      { id: 'guidanceScale', apiName: 'parameters.guidance_scale', label: 'Guidance scale', type: 'number' },
      { id: 'negativePrompt', apiName: 'parameters.negative_prompt', label: 'Negative prompt', type: 'array' },
      { id: 'steps', apiName: 'parameters.num_inference_steps', label: 'Inference steps', type: 'integer', min: 1 },
      { id: 'seed', apiName: 'parameters.seed', label: 'Seed', type: 'integer', min: 0 },
    ],
    lifecycle: modelId.includes('preview') ? 'preview' : 'stable',
    availability: 'account-dependent',
    evidence: [{ title: 'Hugging Face text-to-video task', url: HF_VIDEO_URL, verifiedAt: VERIFIED_AT }],
    limitations: ['Only the text-to-video task is wired in Flow; runtime provider/model availability is account-dependent.'],
    recommendedUse: 'Open-model text-to-video generation through a Hugging Face routed provider.',
    flowExample: {
      summary: `Prompt -> ${displayName} -> video`,
      inputs: ['Connect text to Prompt; image and video conditioning are disabled for this route.'],
      outputs: ['Connect video to Composition, Frame Extract, or File Output.'],
    },
    requestBuilder: 'huggingface-inference',
  };
}

function atlasContract(modelId: string, displayName: string): ProviderModelContract {
  const imageToVideo = modelId.endsWith('/image-to-video');
  return {
    providerId: 'atlas',
    providerName: 'Atlas Cloud',
    modelId,
    displayName,
    apiFamily: 'atlas',
    endpoint: 'POST /api/v1/model/generateVideo',
    auth: { type: 'bearer', credentialKey: 'atlas' },
    inputModalities: imageToVideo ? ['text', 'image'] : ['text'],
    outputModalities: ['video', 'audio'],
    operations: imageToVideo ? ['image-to-video'] : ['text-to-video'],
    parameters: [
      { id: 'model', apiName: 'model', label: 'Model', type: 'string', required: true },
      { id: 'prompt', apiName: 'prompt', label: 'Prompt', type: 'string', required: true },
      ...(imageToVideo ? [{ id: 'startFrame', apiName: 'image', label: 'Start frame', type: 'string' as const, required: true }] : []),
      { id: 'duration', apiName: 'duration', label: 'Duration', type: 'integer', min: 1 },
      { id: 'resolution', apiName: 'resolution', label: 'Resolution', type: 'string' },
      { id: 'aspectRatio', apiName: 'aspect_ratio', label: 'Aspect ratio', type: 'enum', options: ASPECT_OPTIONS },
      { id: 'generatedAudio', apiName: 'generate_audio', label: 'Generate audio', type: 'boolean' },
      { id: 'negativePrompt', apiName: 'negative_prompt', label: 'Negative prompt', type: 'string' },
      { id: 'seed', apiName: 'seed', label: 'Seed', type: 'integer', min: 0 },
    ],
    lifecycle: 'stable',
    availability: 'account-dependent',
    evidence: [{ title: `${displayName} model page`, url: `${ATLAS_MODELS_URL}/${modelId}`, verifiedAt: VERIFIED_AT }],
    limitations: ['Availability and optional parameters depend on the connected Atlas account and exact model page.'],
    recommendedUse: imageToVideo ? 'Atlas-native start-frame animation.' : 'Atlas-native text-to-video generation.',
    flowExample: {
      summary: `${imageToVideo ? 'Prompt and start image' : 'Prompt'} -> ${displayName} -> video`,
      inputs: [imageToVideo ? 'Connect text and one start image.' : 'Connect text to Prompt.'],
      outputs: ['Connect video to Composition, Frame Extract, or File Output.'],
    },
    requestBuilder: 'atlas',
  };
}

const HF_MODELS = [
  ['Lightricks/LTX-2.3', 'LTX 2.3'],
  ['Wan-AI/Wan2.2-T2V-A14B', 'Wan 2.2 T2V A14B'],
  ['Wan-AI/Wan2.2-TI2V-5B', 'Wan 2.2 TI2V 5B'],
  ['tencent/HunyuanVideo', 'Hunyuan Video'],
  ['genmo/mochi-1-preview', 'Mochi 1 Preview'],
  ['Lightricks/LTX-Video', 'LTX Video'],
] as const;

const ATLAS_MODELS = [
  ['google/veo3.1/text-to-video', 'Atlas Veo 3.1'],
  ['google/veo3.1/image-to-video', 'Atlas Veo 3.1 (Image→Video)'],
  ['google/veo3.1-fast/text-to-video', 'Atlas Veo 3.1 Fast'],
  ['bytedance/seedance-2.0/text-to-video', 'Atlas Seedance 2.0'],
  ['bytedance/seedance-2.0/image-to-video', 'Atlas Seedance 2.0 (Image→Video)'],
  ['alibaba/wan-2.7/text-to-video', 'Atlas Wan 2.7'],
  ['alibaba/wan-2.7/image-to-video', 'Atlas Wan 2.7 (Image→Video)'],
  ['xai/grok-imagine-video/text-to-video', 'Atlas Grok Imagine Video'],
] as const;

export const VIDEO_MODEL_CONTRACTS = defineProviderModelContracts([
  omniContract(),
  veoContract({ modelId: 'veo-3.1-generate-preview', displayName: 'Veo 3.1 Preview (Gemini API)', lifecycle: 'preview', availability: 'documented', supportsReferences: true, supportsExtension: true }),
  veoContract({ modelId: 'veo-3.1-fast-generate-preview', displayName: 'Veo 3.1 Fast Preview (Gemini API)', lifecycle: 'preview', availability: 'documented', supportsReferences: true, supportsExtension: true }),
  veoContract({ modelId: 'veo-3.1-lite-generate-preview', displayName: 'Veo 3.1 Lite Preview (Gemini API)', lifecycle: 'preview', availability: 'documented', lite: true }),
  veoContract({ modelId: 'veo-3.1-generate-001', displayName: 'Veo 3.1 (Vertex GA)', lifecycle: 'stable', availability: 'account-dependent', supportsReferences: true, supportsExtension: true }),
  veoContract({ modelId: 'veo-3.1-fast-generate-001', displayName: 'Veo 3.1 Fast (Vertex GA)', lifecycle: 'stable', availability: 'account-dependent', supportsReferences: true, supportsExtension: true }),
  veoContract({ modelId: 'veo-3.1-lite-generate-001', displayName: 'Veo 3.1 Lite (Vertex)', lifecycle: 'preview', availability: 'account-dependent', lite: true, supportsExtension: true }),
  veoContract({ modelId: 'veo-3.0-generate-001', displayName: 'Veo 3 (shut down)', lifecycle: 'shutdown', availability: 'unavailable', migrationModelId: 'veo-3.1-generate-preview', shutdownAt: '2026-06-30' }),
  ...HF_MODELS.map(([modelId, displayName]) => hfContract(modelId, displayName)),
  ...ATLAS_MODELS.map(([modelId, displayName]) => atlasContract(modelId, displayName)),
]);

export function getVideoModelContract(providerId: VideoProvider, modelId: string): ProviderModelContract {
  return getProviderModelContract(VIDEO_MODEL_CONTRACTS, providerId, modelId)
    ?? createUnverifiedModelContract({
      providerId,
      providerName: providerId === 'atlas' ? 'Atlas Cloud' : providerId === 'huggingface' ? 'Hugging Face Inference Providers' : 'Google Gemini / Vertex AI',
      modelId,
      displayName: modelId,
      apiFamily: providerId === 'atlas' ? 'atlas' : providerId === 'huggingface' ? 'huggingface-inference' : 'google-gemini',
      endpoint: providerId === 'atlas' ? 'Configured Atlas video route' : providerId === 'huggingface' ? 'Inference Providers text-to-video task' : 'Configured Gemini video route',
      auth: providerId === 'gemini'
        ? { type: 'api-key-or-vertex-adc', credentialKey: 'gemini' }
        : { type: 'bearer', credentialKey: providerId },
      inputModalities: ['text'],
      outputModalities: ['video'],
      operation: 'text-to-video',
      requestBuilder: providerId === 'atlas' ? 'atlas' : providerId === 'huggingface' ? 'huggingface-inference' : 'google-gemini',
    });
}

export function getVideoModelSupport(providerId: VideoProvider, modelId: string): VideoModelSupport {
  const contract = getVideoModelContract(providerId, modelId);
  const available = contract.availability !== 'unavailable';
  const duration = contract.parameters.find((parameter) => parameter.id === 'duration');
  const durationValues = duration?.options?.map((option) => Number(option.value)).filter(Number.isFinite) ?? [];
  const resolution = contract.parameters.find((parameter) => parameter.id === 'resolution');
  const resolutions = resolution?.options?.map((option) => option.value as VideoResolution) ?? [];
  return {
    imageToVideo: available && contract.operations.includes('image-to-video'),
    interpolation: available && contract.operations.includes('frame-interpolation'),
    referenceImages: available && contract.operations.includes('reference-to-video'),
    maxReferenceImages: contract.parameters.find((parameter) => parameter.id === 'referenceImages')?.maxItems ?? 0,
    videoExtension: available && contract.operations.includes('video-extension'),
    videoEdit: available && contract.operations.includes('video-edit'),
    negativePrompt: available && contract.parameters.some((parameter) => parameter.id === 'negativePrompt'),
    generatedAudio: available && contract.outputModalities.includes('audio'),
    minDurationSeconds: durationValues.length > 0 ? Math.min(...durationValues) : undefined,
    maxDurationSeconds: durationValues.length > 0 ? Math.max(...durationValues) : undefined,
    fixedResolution: contract.modelId === 'gemini-omni-flash-preview'
      ? '720p'
      : resolutions.length === 1 ? resolutions[0] : undefined,
    maxResolution: resolutions.includes('4k') ? '4k' : resolutions.includes('1080p') ? '1080p' : resolutions.includes('720p') ? '720p' : undefined,
  };
}

export function getVideoCredentialRouteWarning(
  contract: ProviderModelContract,
  credentialMode: GeminiCredentialMode,
): string | undefined {
  if (contract.providerId !== 'gemini') return undefined;
  if (contract.apiFamily === 'google-vertex' && credentialMode !== 'vertex-adc') {
    return 'This -001 model ID is a Vertex route. Switch Google credentials to Vertex ADC before running it.';
  }
  if (contract.apiFamily === 'google-gemini' && credentialMode === 'vertex-adc') {
    return 'This -preview model ID is a Gemini Developer API route. Select the matching -001 Vertex model or switch to API-key credentials.';
  }
  return undefined;
}
