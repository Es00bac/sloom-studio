import type {
  ApiKeys,
  AspectRatio,
  AudioOutputFormat,
  Capability,
  DefaultModelSettings,
  ExecutionConfig,
  ExportCompositorPreference,
  ImageOutputFormat,
  ModelCatalog,
  ProviderSettings,
  RenderBackendPreference,
  ProviderForCapability,
  SelectOption,
  VideoResolution,
  VoiceOption,
} from '../types/flow';
import { ATLAS_IMAGE_MODEL_OPTIONS } from './atlasImageModelOptions.generated';
import { getVertexProjectConfig } from './vertexProviderSettings';

export const PROVIDER_LABELS = {
  gemini: 'Google Gemini',
  openai: 'OpenAI / Compatible',
  atlas: 'Atlas Cloud',
  byteplus: 'BytePlus',
  huggingface: 'Hugging Face',
  bfl: 'Black Forest Labs',
  stability: 'Stability AI',
  localOpen: 'Local / Open Models',
  android: 'Android Accelerator',
  elevenlabs: 'ElevenLabs',
} as const;

export const CAPABILITY_PROVIDERS = {
  text: ['gemini', 'openai', 'huggingface'],
  image: ['gemini', 'openai', 'atlas', 'byteplus', 'huggingface', 'bfl', 'stability', 'localOpen', 'android'],
  video: ['gemini', 'huggingface', 'atlas'],
  audio: ['gemini', 'elevenlabs', 'huggingface'],
} as const;

export const DEFAULT_MODELS: DefaultModelSettings = {
  text: {
    gemini: 'gemini-3.5-flash',
    openai: 'gpt-5.6-terra',
    huggingface: 'Qwen/Qwen3-4B-Thinking-2507',
  },
  image: {
    gemini: 'gemini-3.1-flash-image',
    openai: 'gpt-image-2',
    atlas: 'black-forest-labs/flux-schnell',
    huggingface: 'black-forest-labs/FLUX.1-dev',
    bfl: 'flux-2-pro',
    stability: 'stable-image-core',
    localOpen: 'Qwen/Qwen-Image-Edit',
    android: 'local-dream-active',
    byteplus: 'seedream-5-0-260128',
  },
  video: {
    gemini: 'gemini-omni-flash-preview',
    huggingface: 'Wan-AI/Wan2.2-T2V-A14B',
    atlas: 'google/veo3.1/text-to-video',
  },
  audio: {
    gemini: 'gemini-3.1-flash-tts-preview',
    elevenlabs: 'eleven_multilingual_v2',
    huggingface: 'hexgrad/Kokoro-82M',
  },
};

export const DEFAULT_PROVIDER_SETTINGS = {
  openaiBaseUrl: '',
  atlasBaseUrl: '',
  bytePlusBaseUrl: '',
  elevenlabsVoiceId: '',
  renderBackendPreference: 'auto' as RenderBackendPreference,
  exportCompositorPreference: 'stage' as ExportCompositorPreference,
  localNativeRenderUrl: 'http://127.0.0.1:41736',
  localNativeRenderToken: '',
  backendProxyEnabled: false,
  backendProxyBaseUrl: '',
  geminiCredentialMode: 'vertex-adc',
  vertexAuthMode: 'gcloud-adc',
  vertexProjectId: '',
  vertexLocation: 'us-central1',
  vertexQuotaProjectId: '',
  vertexEnvironmentVariables: '',
  vertexServiceAccountJson: '',
  paperPrintUpscaleMethod: 'auto',
  paperPdfRasterPreset: 'balanced-jpeg',
  localOpenImageEndpointUrl: '',
  localOpenImageAuthHeader: '',
  localOpenImageDefaultModel: 'Qwen/Qwen-Image-Edit',
  genericImageEndpointUrl: '',
  genericImageAuthHeader: '',
  localAiCpuEndpointUrl: '',
  localAiCpuAuthHeader: '',
  localAiCpuModel: 'realesrgan-4x',
  androidAcceleratorBaseUrl: '',
  androidAcceleratorAuthToken: '',
  androidAcceleratorDefaultUpscaler: 'upscaler_realistic',
  androidAcceleratorDefaultImageModel: 'local-dream-active',
  batchMaxRetries: 10,
  batchRetryBaseDelayMs: 30000,
  androidLanServerEnabled: false,
  androidLanServerPin: '',
} as ProviderSettings;

export const RENDER_BACKEND_OPTIONS: SelectOption[] = [
  { value: 'auto', label: 'Auto (prefer AMD VAAPI GPU, then detected NVENC/QSV, CPU, browser)' },
  { value: 'browser', label: 'Browser FFmpeg (maximum compatibility)' },
  { value: 'native-cpu', label: 'Native FFmpeg CPU (multithreaded)' },
  { value: 'native-amd-vaapi', label: 'Native FFmpeg AMD VAAPI GPU (forced)' },
  { value: 'native-nvidia-nvenc', label: 'Native FFmpeg NVIDIA NVENC GPU (forced; probe required)' },
  { value: 'native-intel-qsv', label: 'Native FFmpeg Intel Quick Sync GPU (forced; probe required)' },
];

export const EXPORT_COMPOSITOR_OPTIONS: SelectOption[] = [
  { value: 'stage', label: 'Stage (exact) — same compositor as the Edit Stage preview' },
  { value: 'legacy', label: 'Legacy (ffmpeg graph) — pre-frame-server export path' },
];

export const VERTEX_AUTH_MODE_OPTIONS: SelectOption[] = [
  { value: 'gcloud-adc', label: 'Application Default Credentials (recommended)' },
  { value: 'gcloud-user', label: 'Google Cloud SDK user login (fallback)' },
];

export const PAPER_PRINT_UPSCALE_METHOD_OPTIONS: SelectOption[] = [
  { value: 'auto', label: 'Auto: Android accelerator when configured, then Stability Fast, then Vertex, then local' },
  { value: 'android-accelerator', label: 'Android accelerator (LAN NPU/GPU upscaler, free after setup)' },
  { value: 'stability-fast', label: 'Stability Fast (AI 4x, 2 credits / $0.02, then exact local fit)' },
  { value: 'stability-conservative', label: 'Stability Conservative (AI 4MP, 40 credits / $0.40, then exact local fit)' },
  { value: 'vertex-imagen', label: 'Vertex Imagen upscale when available' },
  { value: 'local-ai-cpu', label: 'Local Vulkan AI upscaler (managed Real-ESRGAN; no CPU fallback)' },
  { value: 'local-browser', label: 'Local browser scaling only (free, no cloud call)' },
];

export const PAPER_PDF_RASTER_PRESET_OPTIONS: SelectOption[] = [
  { value: 'balanced-jpeg', label: 'Balanced JPEG PDF (smaller, 240 DPI cap)' },
  { value: 'print-png', label: 'Print PNG PDF (lossless, largest)' },
  { value: 'proof-jpeg', label: 'Proof JPEG PDF (small, 150 DPI cap)' },
];

export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  aspectRatio: '1:1',
  steps: 30,
  durationSeconds: 6,
  videoResolution: '720p',
  videoFrameRate: 30,
  imageOutputFormat: 'png',
  audioOutputFormat: 'mp3_44100_128',
};

export const ASPECT_RATIO_OPTIONS: SelectOption[] = [
  { value: '1:1', label: '1:1 Square' },
  { value: '16:9', label: '16:9 Landscape' },
  { value: '9:16', label: '9:16 Portrait' },
];

export const GEMINI_IMAGE_ASPECT_RATIO_OPTIONS: SelectOption[] = [
  { value: '1:1', label: '1:1 Square' },
  { value: '2:3', label: '2:3 Portrait' },
  { value: '3:2', label: '3:2 Landscape' },
  { value: '3:4', label: '3:4 Portrait' },
  { value: '4:3', label: '4:3 Landscape' },
  { value: '4:5', label: '4:5 Portrait' },
  { value: '5:4', label: '5:4 Landscape' },
  { value: '9:16', label: '9:16 Portrait' },
  { value: '16:9', label: '16:9 Landscape' },
  { value: '21:9', label: '21:9 Ultrawide' },
];

export const GEMINI_25_FLASH_IMAGE_ASPECT_RATIO_OPTIONS: SelectOption[] = [
  { value: '1:1', label: '1:1 Square' },
  { value: '3:4', label: '3:4 Portrait' },
  { value: '4:3', label: '4:3 Landscape' },
  { value: '9:16', label: '9:16 Portrait' },
  { value: '16:9', label: '16:9 Landscape' },
];

export const VERTEX_IMAGEN_IMAGE_ASPECT_RATIO_OPTIONS: SelectOption[] = [
  ...GEMINI_25_FLASH_IMAGE_ASPECT_RATIO_OPTIONS,
];

export const OPENAI_IMAGE_ASPECT_RATIO_OPTIONS: SelectOption[] = [
  { value: '1:1', label: '1:1 Square' },
  { value: '3:2', label: '3:2 Landscape' },
  { value: '2:3', label: '2:3 Portrait' },
];

export const HUGGING_FACE_IMAGE_ASPECT_RATIO_OPTIONS: SelectOption[] = [
  ...GEMINI_IMAGE_ASPECT_RATIO_OPTIONS,
];

export const IMAGE_ASPECT_RATIO_OPTIONS: SelectOption[] = [
  ...GEMINI_IMAGE_ASPECT_RATIO_OPTIONS,
];

export const IMAGE_STEP_OPTIONS: SelectOption[] = [
  { value: '20', label: '20 steps' },
  { value: '30', label: '30 steps' },
  { value: '40', label: '40 steps' },
  { value: '50', label: '50 steps' },
  { value: '60', label: '60 steps' },
];

export const VIDEO_DURATION_OPTIONS: SelectOption[] = [
  { value: '4', label: '4 seconds' },
  { value: '6', label: '6 seconds' },
  { value: '8', label: '8 seconds' },
];

export const VIDEO_RESOLUTION_OPTIONS: SelectOption[] = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '4k', label: '4k' },
];

export const IMAGE_OUTPUT_FORMAT_OPTIONS: SelectOption[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WEBP' },
];

export const AUDIO_OUTPUT_FORMAT_OPTIONS: Array<SelectOption & { value: AudioOutputFormat }> = [
  { value: 'mp3_48000_192', label: 'MP3 48kHz 192kbps' },
  { value: 'mp3_44100_128', label: 'MP3 44.1kHz 128kbps' },
  { value: 'mp3_44100_64', label: 'MP3 44.1kHz 64kbps' },
  { value: 'pcm_44100', label: 'PCM 44.1kHz' },
];

/** Provider IDs discovery may still return but normal Flow selection must omit. */
export const VESTIGIAL_MODEL_IDS = [
  'eleven_ttv_v3',
  'eleven_multilingual_ttv_v2',
  'eleven_turbo_v2_5',
  'eleven_turbo_v2',
  'eleven_monolingual_v1',
  'eleven_multilingual_v1',
] as const;

export const FALLBACK_MODEL_OPTIONS: ModelCatalog = {
  text: {
    gemini: [
      { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
      { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
      { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
      { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    ],
    openai: [
      { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    ],
    huggingface: [
      { value: 'Qwen/Qwen3-4B-Thinking-2507', label: 'Qwen 3 4B Thinking 2507' },
      { value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B' },
      { value: 'Qwen/Qwen3-Coder-480B-A35B-Instruct', label: 'Qwen 3 Coder 480B A35B' },
      { value: 'zai-org/GLM-4.5', label: 'GLM 4.5' },
      { value: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
    ],
  },
  image: {
    gemini: [
      { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image' },
      { value: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite Image' },
      { value: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image' },
      { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
      { value: 'imagen-4.0-fast-generate-001', label: 'Vertex Imagen 4 Fast' },
      { value: 'imagen-4.0-generate-001', label: 'Vertex Imagen 4 Generate' },
      { value: 'imagen-4.0-ultra-generate-001', label: 'Vertex Imagen 4 Ultra' },
    ],
    openai: [
      { value: 'gpt-image-2', label: 'GPT Image 2' },
    ],
    // Every documented Atlas 2D image model (generated from the live catalog) so every model — and thus
    // every feature it exposes (references, edit, mask, custom size, …) — is selectable from the node.
    atlas: ATLAS_IMAGE_MODEL_OPTIONS,
    // BytePlus / ModelArk (ByteDance) date-stamped IDs accepted by /api/v3/images/generations.
    byteplus: [
      { value: 'seedream-5-0-260128', label: 'Seedream 5.0 Lite (260128)' },
      { value: 'seedream-4-5-251128', label: 'Seedream 4.5 (251128)' },
      { value: 'seedream-4-0-250828', label: 'Seedream 4.0 (250828)' },
    ],
    bfl: [
      { value: 'flux-2-klein-4b', label: 'FLUX.2 Klein 4B' },
      { value: 'flux-2-klein-9b', label: 'FLUX.2 Klein 9B' },
      { value: 'flux-2-klein-9b-preview', label: 'FLUX.2 Klein 9B Preview' },
      { value: 'flux-2-pro', label: 'FLUX.2 Pro' },
      { value: 'flux-2-pro-preview', label: 'FLUX.2 Pro Preview' },
      { value: 'flux-2-flex', label: 'FLUX.2 Flex' },
      { value: 'flux-2-max', label: 'FLUX.2 Max' },
    ],
    stability: [
      { value: 'stable-image-core', label: 'Stable Image Core' },
      { value: 'stable-image-ultra', label: 'Stable Image Ultra' },
      { value: 'stable-image-upscale-fast', label: 'Stable Image Upscale: Fast' },
      { value: 'stable-image-upscale-conservative', label: 'Stable Image Upscale: Conservative' },
      { value: 'stable-image-edit-inpaint', label: 'Stable Image Edit: Inpaint' },
      { value: 'stable-image-edit-erase', label: 'Stable Image Edit: Erase' },
      { value: 'stable-image-edit-outpaint', label: 'Stable Image Edit: Outpaint' },
      { value: 'stable-image-edit-search-replace', label: 'Stable Image Edit: Search and Replace' },
      { value: 'stable-image-edit-search-recolor', label: 'Stable Image Edit: Search and Recolor' },
      { value: 'stable-image-edit-remove-background', label: 'Stable Image Edit: Remove Background' },
      { value: 'stable-image-edit-replace-background-relight', label: 'Stable Image Edit: Replace Background & Relight' },
    ],
    localOpen: [
      { value: 'Qwen/Qwen-Image-Edit', label: 'Qwen Image Edit' },
      { value: 'Qwen/Qwen-Image-Edit-2511', label: 'Qwen Image Edit 2511' },
      { value: 'black-forest-labs/FLUX.1-Kontext-dev', label: 'FLUX.1 Kontext Dev' },
    ],
    android: [
      { value: 'local-dream-active', label: 'Local Dream Active Model' },
    ],
    huggingface: [
      { value: 'black-forest-labs/FLUX.1-dev', label: 'FLUX.1 Dev' },
      { value: 'Tongyi-MAI/Z-Image-Turbo', label: 'Z-Image Turbo' },
      { value: 'Qwen/Qwen-Image', label: 'Qwen Image' },
      { value: 'black-forest-labs/FLUX.1-Kontext-dev', label: 'FLUX.1 Kontext Dev' },
      { value: 'stabilityai/stable-diffusion-3.5-large', label: 'Stable Diffusion 3.5 Large' },
      { value: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL Base 1.0' },
    ],
  },
  video: {
    gemini: [
      { value: 'gemini-omni-flash-preview', label: 'Gemini Omni Flash Preview' },
      { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 Preview (Gemini API)' },
      { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast Preview (Gemini API)' },
      { value: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite Preview (Gemini API)' },
      { value: 'veo-3.1-generate-001', label: 'Veo 3.1 (Vertex GA)' },
      { value: 'veo-3.1-fast-generate-001', label: 'Veo 3.1 Fast (Vertex GA)' },
      { value: 'veo-3.1-lite-generate-001', label: 'Veo 3.1 Lite (Vertex)' },
    ],
    huggingface: [
      { value: 'Lightricks/LTX-2.3', label: 'LTX 2.3' },
      { value: 'Wan-AI/Wan2.2-T2V-A14B', label: 'Wan 2.2 T2V A14B' },
      { value: 'Wan-AI/Wan2.2-TI2V-5B', label: 'Wan 2.2 TI2V 5B' },
      { value: 'tencent/HunyuanVideo', label: 'Hunyuan Video' },
      { value: 'genmo/mochi-1-preview', label: 'Mochi 1 Preview' },
      { value: 'Lightricks/LTX-Video', label: 'LTX Video' },
    ],
    // Live Atlas Cloud video slugs (verified against the account /models list).
    atlas: [
      { value: 'google/veo3.1/text-to-video', label: 'Atlas Veo 3.1' },
      { value: 'google/veo3.1/image-to-video', label: 'Atlas Veo 3.1 (Image→Video)' },
      { value: 'google/veo3.1-fast/text-to-video', label: 'Atlas Veo 3.1 Fast' },
      { value: 'bytedance/seedance-2.0/text-to-video', label: 'Atlas Seedance 2.0' },
      { value: 'bytedance/seedance-2.0/image-to-video', label: 'Atlas Seedance 2.0 (Image→Video)' },
      { value: 'alibaba/wan-2.7/text-to-video', label: 'Atlas Wan 2.7' },
      { value: 'alibaba/wan-2.7/image-to-video', label: 'Atlas Wan 2.7 (Image→Video)' },
      { value: 'xai/grok-imagine-video/text-to-video', label: 'Atlas Grok Imagine Video' },
    ],
  },
  audio: {
    gemini: [
      { value: 'gemini-3.1-flash-tts-preview', label: 'Gemini 3.1 Flash TTS Preview' },
      { value: 'gemini-2.5-flash-preview-tts', label: 'Gemini 2.5 Flash Preview TTS' },
      { value: 'gemini-2.5-pro-preview-tts', label: 'Gemini 2.5 Pro Preview TTS' },
    ],
    elevenlabs: [
      { value: 'eleven_v3', label: 'Eleven v3' },
      { value: 'eleven_multilingual_v2', label: 'Eleven Multilingual v2' },
      { value: 'eleven_flash_v2_5', label: 'Eleven Flash v2.5' },
      { value: 'eleven_flash_v2', label: 'Eleven Flash v2' },
      { value: 'eleven_multilingual_sts_v2', label: 'Eleven Multilingual STS v2' },
      { value: 'eleven_english_sts_v2', label: 'Eleven English STS v2' },
      { value: 'eleven_text_to_sound_v2', label: 'Eleven Text to Sound v2' },
      { value: 'music_v2', label: 'Eleven Music v2' },
    ],
    huggingface: [
      { value: 'hexgrad/Kokoro-82M', label: 'Kokoro 82M' },
      { value: 'ResembleAI/chatterbox', label: 'Chatterbox' },
      { value: 'coqui/XTTS-v2', label: 'XTTS v2' },
      { value: 'microsoft/VibeVoice-1.5B', label: 'VibeVoice 1.5B' },
      { value: 'suno/bark', label: 'Suno Bark' },
    ],
  },
};

export const FALLBACK_VOICE_OPTIONS: VoiceOption[] = [];

export function buildEmptyModelCatalog(): ModelCatalog {
  return {
    text: {
      gemini: [],
      openai: [],
      huggingface: [],
    },
  image: {
      gemini: [],
      openai: [],
      atlas: [],
      byteplus: [],
      huggingface: [],
      bfl: [],
      stability: [],
      localOpen: [],
      android: [],
    },
    video: {
      gemini: [],
      huggingface: [],
      atlas: [],
    },
    audio: {
      gemini: [],
      elevenlabs: [],
      huggingface: [],
    },
  };
}

export function cloneModelCatalog(modelCatalog: ModelCatalog): ModelCatalog {
  return {
    text: {
      gemini: [...modelCatalog.text.gemini],
      openai: [...modelCatalog.text.openai],
      huggingface: [...modelCatalog.text.huggingface],
    },
    image: {
      gemini: [...modelCatalog.image.gemini],
      openai: [...modelCatalog.image.openai],
      atlas: [...modelCatalog.image.atlas],
      byteplus: [...modelCatalog.image.byteplus],
      huggingface: [...modelCatalog.image.huggingface],
      bfl: [...modelCatalog.image.bfl],
      stability: [...modelCatalog.image.stability],
      localOpen: [...modelCatalog.image.localOpen],
      android: [...modelCatalog.image.android],
    },
    video: {
      gemini: [...modelCatalog.video.gemini],
      huggingface: [...modelCatalog.video.huggingface],
      atlas: [...modelCatalog.video.atlas],
    },
    audio: {
      gemini: [...modelCatalog.audio.gemini],
      elevenlabs: [...modelCatalog.audio.elevenlabs],
      huggingface: [...modelCatalog.audio.huggingface],
    },
  };
}

export function getConfiguredProviders<TCapability extends Capability>(
  capability: TCapability,
  apiKeys: ApiKeys,
  providerSettings?: Partial<ProviderSettings>,
): ProviderForCapability<TCapability>[] {
  if (providerSettings?.backendProxyEnabled && providerSettings.backendProxyBaseUrl?.trim()) {
    return CAPABILITY_PROVIDERS[capability].filter((provider) =>
      provider !== 'android' || Boolean(providerSettings.androidAcceleratorBaseUrl?.trim()),
    ) as ProviderForCapability<TCapability>[];
  }

  return CAPABILITY_PROVIDERS[capability].filter((provider) => {
    switch (provider) {
      case 'gemini':
        // Google is available with a Gemini API key, OR via Vertex ADC for image + text + video (all
        // three execution paths support Vertex — video runs Veo/Omni through the desktop bridge, the
        // same bridge the Vertex image path already requires). Resolve the project the SAME way the
        // auth status does — through getVertexProjectConfig, which also reads GOOGLE_CLOUD_PROJECT /
        // CLOUDSDK_* env vars — so a project set anywhere (not just the raw field) still surfaces
        // the provider. Audio (Gemini TTS) still needs the API key.
        return Boolean(apiKeys.gemini.trim()) || (
          providerSettings != null
          && (capability === 'image' || capability === 'text' || capability === 'video')
          && providerSettings.geminiCredentialMode === 'vertex-adc'
          && Boolean(getVertexProjectConfig({ ...DEFAULT_PROVIDER_SETTINGS, ...providerSettings }).projectId)
        );
      case 'openai':
        return Boolean(apiKeys.openai.trim());
      case 'atlas':
        return Boolean(apiKeys.atlas?.trim());
      case 'byteplus':
        return capability === 'image' && Boolean(apiKeys.byteplus?.trim());
      case 'huggingface':
        return Boolean(apiKeys.huggingface.trim());
      case 'bfl':
        return capability === 'image' && Boolean(apiKeys.bfl?.trim());
      case 'stability':
        return capability === 'image' && Boolean(apiKeys.stability?.trim());
      case 'localOpen':
        return capability === 'image' && Boolean(providerSettings?.localOpenImageEndpointUrl?.trim());
      case 'android':
        return capability === 'image' && Boolean(providerSettings?.androidAcceleratorBaseUrl?.trim());
      case 'elevenlabs':
        return Boolean(apiKeys.elevenlabs.trim());
      default:
        return false;
    }
  }) as ProviderForCapability<TCapability>[];
}

export function ensureOption(options: SelectOption[], value: string, label?: string): SelectOption[] {
  const trimmedValue = value.trim();

  if (!trimmedValue || options.some((option) => option.value === trimmedValue)) {
    return options;
  }

  return [{ value: trimmedValue, label: label ?? trimmedValue }, ...options];
}

export function ensureVoiceOption(options: VoiceOption[], value: string, label?: string): VoiceOption[] {
  const trimmedValue = value.trim();

  if (!trimmedValue || options.some((option) => option.value === trimmedValue)) {
    return options;
  }

  return [{ value: trimmedValue, label: label ?? trimmedValue }, ...options];
}

export function getModelOptions<TCapability extends Capability>(
  capability: TCapability,
  provider: ProviderForCapability<TCapability>,
  modelCatalog: ModelCatalog,
  fallbackValue?: string,
): SelectOption[] {
  const catalogOptions = modelCatalog[capability][provider];

  if (catalogOptions.length > 0) {
    return ensureOption(catalogOptions, fallbackValue ?? '');
  }

  return ensureOption(FALLBACK_MODEL_OPTIONS[capability][provider], fallbackValue ?? '');
}

export function getProviderLabel(provider: keyof typeof PROVIDER_LABELS): string {
  return PROVIDER_LABELS[provider];
}

export function getImageAspectRatioOptions(
  provider: ProviderForCapability<'image'>,
  modelId?: string,
): SelectOption[] {
  switch (provider) {
    case 'gemini':
      if (isVertexImagenModelId(modelId)) {
        return VERTEX_IMAGEN_IMAGE_ASPECT_RATIO_OPTIONS;
      }

      if (supportsGemini25FlashImageAspectRatios(modelId)) {
        return GEMINI_25_FLASH_IMAGE_ASPECT_RATIO_OPTIONS;
      }

      if (supportsGemini31FlashOrProImageAspectRatios(modelId)) {
        return GEMINI_IMAGE_ASPECT_RATIO_OPTIONS;
      }

      return GEMINI_IMAGE_ASPECT_RATIO_OPTIONS;
    case 'openai':
      return OPENAI_IMAGE_ASPECT_RATIO_OPTIONS;
    case 'atlas':
      return isAtlasNativeImageModelId(modelId) ? IMAGE_ASPECT_RATIO_OPTIONS : OPENAI_IMAGE_ASPECT_RATIO_OPTIONS;
    case 'huggingface':
      return HUGGING_FACE_IMAGE_ASPECT_RATIO_OPTIONS;
    case 'bfl':
    case 'localOpen':
    case 'android':
    case 'byteplus':
      return IMAGE_ASPECT_RATIO_OPTIONS;
    case 'stability':
      if ((modelId ?? '').includes('-edit-')) {
        return [];
      }
      return IMAGE_ASPECT_RATIO_OPTIONS;
  }
}

function isAtlasNativeImageModelId(modelId: string | undefined): boolean {
  const normalizedModelId = modelId?.trim().toLowerCase() ?? '';
  return normalizedModelId.includes('/') && !normalizedModelId.startsWith('openai/');
}

export function getSupportedImageAspectRatio(
  provider: ProviderForCapability<'image'>,
  modelId: string | undefined,
  value: string | undefined,
): AspectRatio {
  const options = getImageAspectRatioOptions(provider, modelId);
  const requested = getNodeAspectRatio(value);

  if (options.some((option) => option.value === requested)) {
    return requested;
  }

  return findNearestAspectRatio(requested, options);
}

export function mapAspectRatioToImageSize(aspectRatio: AspectRatio): '1024x1024' | '1536x1024' | '1024x1536' {
  switch (aspectRatio) {
    case '3:2':
    case '16:9':
      return '1536x1024';
    case '2:3':
    case '9:16':
      return '1024x1536';
    case '1:1':
      return '1024x1024';
    default:
      throw new Error(`OpenAI image generation does not support ${aspectRatio} output.`);
  }
}

export function mapAspectRatioToImageDimensions(aspectRatio: AspectRatio): { width: number; height: number } {
  switch (aspectRatio) {
    case '2:3':
      return { width: 848, height: 1264 };
    case '3:4':
      return { width: 896, height: 1200 };
    case '4:5':
      return { width: 928, height: 1152 };
    case '21:9':
      return { width: 1584, height: 672 };
    case '16:9':
      return { width: 1376, height: 768 };
    case '3:2':
      return { width: 1264, height: 848 };
    case '4:3':
      return { width: 1200, height: 896 };
    case '5:4':
      return { width: 1152, height: 928 };
    case '9:16':
      return { width: 768, height: 1376 };
    case '1:1':
    default:
      return { width: 1024, height: 1024 };
  }
}

export function getNodeAspectRatio(value: string | undefined): AspectRatio {
  if (isAspectRatio(value)) {
    return value;
  }

  return '1:1';
}

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string'
    && (
      value === '1:1'
      || value === '2:3'
      || value === '3:2'
      || value === '3:4'
      || value === '4:3'
      || value === '4:5'
      || value === '5:4'
      || value === '9:16'
      || value === '16:9'
      || value === '21:9'
    );
}

function supportsGemini25FlashImageAspectRatios(modelId: string | undefined): boolean {
  const normalized = (modelId ?? '').trim().toLowerCase();
  return normalized.includes('2.5-flash-image');
}

function supportsGemini31FlashOrProImageAspectRatios(modelId: string | undefined): boolean {
  const normalized = (modelId ?? '').trim().toLowerCase();
  return normalized.includes('3.1-flash-image') || normalized.includes('3-pro-image');
}

/**
 * Gemini 3.x image models accept `imageConfig.imageSize` ('1K' | '2K' | '4K', uppercase K required).
 * 2.5-generation models and Imagen do not; 3.1 Flash-Lite Image is 1K-only, and its id does not
 * match this predicate ('3.1-flash-lite-image' contains neither substring).
 */
export function supportsGeminiImageSizeTiers(modelId: string | undefined): boolean {
  return supportsGemini31FlashOrProImageAspectRatios(modelId);
}

export function isVertexImagenModelId(modelId: string | undefined): boolean {
  return (modelId ?? '').trim().toLowerCase().startsWith('imagen-');
}

function findNearestAspectRatio(value: AspectRatio, options: SelectOption[]): AspectRatio {
  const target = getAspectRatioNumericValue(value);
  const candidates = options
    .map((option) => getNodeAspectRatio(option.value))
    .filter((option, index, list) => list.indexOf(option) === index);

  return candidates.reduce((nearest, candidate) => {
    const nearestDelta = Math.abs(getAspectRatioNumericValue(nearest) - target);
    const candidateDelta = Math.abs(getAspectRatioNumericValue(candidate) - target);
    return candidateDelta < nearestDelta ? candidate : nearest;
  }, candidates[0] ?? '1:1');
}

function getAspectRatioNumericValue(value: AspectRatio): number {
  const [width, height] = value.split(':').map((part) => Number(part));
  return width / height;
}

export function getVideoResolution(value: string | undefined): VideoResolution {
  if (value === '1080p' || value === '4k') {
    return value;
  }

  return '720p';
}

export function getImageOutputFormat(value: string | undefined): ImageOutputFormat {
  if (value === 'jpeg' || value === 'webp') {
    return value;
  }

  return 'png';
}

export function getAudioOutputFormat(value: string | undefined): AudioOutputFormat {
  return AUDIO_OUTPUT_FORMAT_OPTIONS.find((option) => option.value === value)?.value ?? 'mp3_44100_128';
}

export function getVideoDurationOptions(hasInterpolationFrames: boolean): SelectOption[] {
  return hasInterpolationFrames
    ? VIDEO_DURATION_OPTIONS.filter((option) => option.value === '8')
    : VIDEO_DURATION_OPTIONS;
}

export function getVideoResolutionOptions(durationSeconds: number, hasExtensionVideo = false): SelectOption[] {
  if (hasExtensionVideo) {
    return VIDEO_RESOLUTION_OPTIONS.filter((option) => option.value === '720p');
  }

  return durationSeconds === 8
    ? VIDEO_RESOLUTION_OPTIONS
    : VIDEO_RESOLUTION_OPTIONS.filter((option) => option.value === '720p');
}
