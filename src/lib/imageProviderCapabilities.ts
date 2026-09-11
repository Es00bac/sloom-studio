import { ATLAS_GENERATED_IMAGE_MODELS } from './atlasImageCatalog.generated';
import { inferImageModelCapabilities } from './imageModelInference';
import type {
  ModelAvailability,
  ModelLifecycle,
  ModelOfficialEvidence,
} from './providerModelContracts';

export type FirstClassImageProviderId =
  | 'gemini'
  | 'openai'
  | 'atlas'
  | 'byteplus'
  | 'huggingface'
  | 'bfl'
  | 'stability'
  | 'localOpen'
  | 'android';

export type ImageModelCostConfidence =
  | 'published-fixed'
  | 'published-minimum'
  | 'token-estimate'
  | 'heuristic'
  | 'provider-defined'
  | 'unknown';

export type ImageModelOperation =
  | 'text-to-image'
  | 'image-edit'
  | 'mask-inpaint'
  | 'outpaint'
  | 'erase'
  | 'search-replace'
  | 'search-recolor'
  | 'remove-background'
  | 'replace-background-relight'
  | 'upscale'
  | 'local-open-edit';

export type ImageNodeVisibleControl =
  | 'prompt'
  | 'negativePrompt'
  | 'aspectRatio'
  | 'steps'
  | 'seed'
  | 'sourceImage'
  | 'mask'
  | 'referenceImages'
  | 'searchPrompt'
  | 'outpaintMargins'
  | 'creativity'
  | 'outputFormat'
  | 'localEndpoint'
  | 'exactColorPrompt'
  | 'textEditPrompt'
  | 'guidanceScale'
  | 'editStrength'
  | 'loraWeights'
  | 'safetyChecker'
  | 'dimensions'
  | 'quality'
  | 'imageSize';

export interface ImageModelCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  promptEdit: boolean;
  maskInpaint: boolean;
  outpaint: boolean;
  erase: boolean;
  searchReplace: boolean;
  searchRecolor: boolean;
  removeBackground: boolean;
  replaceBackgroundRelight: boolean;
  upscale: boolean;
  referenceImages: boolean;
  maxReferenceImages: number;
  exactColorControl: boolean;
  typography: boolean;
  textInImageEditing: boolean;
  localEndpoint: boolean;
  /** Model accepts an arbitrary output `size` (W×H) rather than only fixed aspect-ratio presets. */
  customDimensions: boolean;
  maxOutputMegapixels?: number;
}

export interface ImageModelDefinition {
  providerId: FirstClassImageProviderId;
  modelId: string;
  label: string;
  recommendedUse: string;
  capabilities: ImageModelCapabilities;
  supportedOperations: ImageModelOperation[];
  visibleControls: ImageNodeVisibleControl[];
  cost: {
    textToImageUsd?: number;
    imageEditUsd?: number;
    fixedByOperationUsd?: Partial<Record<ImageModelOperation, number>>;
    unitLabel?: string;
    confidence: ImageModelCostConfidence;
  };
  docsUrl: string;
  lifecycle?: ModelLifecycle;
  availability?: ModelAvailability;
  capabilityConfidence?: 'verified' | 'unverified';
  evidence?: readonly ModelOfficialEvidence[];
  migrationModelId?: string;
  shutdownAt?: string;
}

export interface ImageProviderHelpEntry {
  providerId: FirstClassImageProviderId;
  label: string;
  signupUrl: string;
  apiKeyUrl?: string;
  pricingUrl: string;
  setupSteps: string[];
  costNotes: string[];
  supportedOperations: ImageModelOperation[];
  spendControls: string[];
  troubleshooting: string[];
  lastVerifiedDate: string;
  capabilitySummary: string;
}

export interface ImageModelCostInput {
  providerId: FirstClassImageProviderId;
  modelId: string;
  operation: ImageModelOperation;
  imageCount?: number;
  outputMegapixels?: number;
  textInputTokens?: number;
  imageInputTokens?: number;
  outputImageTokens?: number;
}

export interface ImageModelCostEstimate {
  costUsd?: number;
  confidence: ImageModelCostConfidence;
  unitLabel: string;
  notes: string[];
}

export type ImageModelPricingVisibility =
  | 'exact'
  | 'estimated'
  | 'local-or-provider-defined'
  | 'unknown-disabled';

export interface ImageModelPricingEntry {
  providerId: FirstClassImageProviderId;
  modelId: string;
  operation: ImageModelOperation;
  unit: string;
  unitPriceUsd?: number;
  freeTierOrCredits: string;
  lastVerifiedDate: string;
  sourceUrl: string;
  visibility: ImageModelPricingVisibility;
  notes: string[];
}

export interface ImageNodeControlModel {
  providerId: FirstClassImageProviderId;
  modelId: string;
  supportedOperations: ImageModelOperation[];
  visibleControls: ImageNodeVisibleControl[];
  capabilities: ImageModelCapabilities;
  costEstimateLabel: string;
}

const DEFAULT_CAPABILITIES: ImageModelCapabilities = {
  textToImage: false,
  imageToImage: false,
  promptEdit: false,
  maskInpaint: false,
  outpaint: false,
  erase: false,
  searchReplace: false,
  searchRecolor: false,
  removeBackground: false,
  replaceBackgroundRelight: false,
  upscale: false,
  referenceImages: false,
  maxReferenceImages: 0,
  exactColorControl: false,
  typography: false,
  textInImageEditing: false,
  localEndpoint: false,
  customDimensions: false,
};

const PRICING_LAST_VERIFIED_DATE = '2026-05-24';

const PROVIDER_FREE_TIER_NOTES: Record<FirstClassImageProviderId, string> = {
  gemini: 'Google lists a Free tier for some Gemini API usage, but the visible paid image models in Sloom Studio are marked not available on the free tier.',
  openai: 'OpenAI API usage is billed separately from ChatGPT subscriptions; no free image API tier is assumed.',
  atlas: 'Atlas Cloud native image models bill through your Atlas account; GPT Image routes remain token-priced when selected.',
  byteplus: 'BytePlus (ModelArk) Seedream image models bill through your own BytePlus account (bring your own key); a free trial may be available.',
  huggingface: 'Hugging Face Inference Providers include small monthly credits, then pay-as-you-go or custom provider-key billing.',
  bfl: 'BFL uses credits where 1 credit equals $0.01 USD; [dev] is free and Playground credits are prepaid.',
  stability: 'Stability AI uses credits where 1 credit equals $0.01 USD; trial credits may vary by account and region.',
  localOpen: 'Local/Open costs depend on the configured local, LAN, rented GPU, or hosted wrapper endpoint.',
  android: 'Android Accelerator runs on a paired local-network Android device; Sloom Studio assumes $0 provider spend after setup.',
};

const PROVIDER_SPEND_CONTROLS: Record<FirstClassImageProviderId, string[]> = {
  gemini: [
    'Use Google AI Studio or Google Cloud billing budgets before running production batches.',
    'Prefer batch/flex lanes where available for cheaper non-urgent work.',
    'Keep Vertex project IDs scoped per project when multiple productions share one machine.',
  ],
  openai: [
    'Set monthly budgets and email thresholds in the OpenAI billing dashboard.',
    'Use project-level billing restrictions for separate client or comic projects.',
    'Treat GPT Image 2 estimates as token estimates until actual image-token usage is returned.',
  ],
  atlas: [
    'Use your Atlas Cloud billing dashboard and model-level policy to monitor and limit image usage.',
    'Use Atlas model IDs consistently across generated scenes to keep spend predictable.',
    'Prefer FLUX Schnell for cheap iteration, then switch to FLUX Dev, Z-Image Turbo, or edit-specific models for final passes.',
  ],
  byteplus: [
    'Set spend limits and monitor usage in the BytePlus / ModelArk console.',
    'Use the free-trial / startup credits for development and QA before enabling production batches.',
    'Prefer a lower-tier Seedream resolution (2K) for iteration and reserve 4K for finals.',
  ],
  huggingface: [
    'Start with monthly credits for tests, then buy credits before production runs.',
    'Use custom provider keys when you need provider-direct spend controls.',
    'For organizations, set billing and provider restrictions in Hugging Face organization settings.',
  ],
  bfl: [
    'Preload only the credits needed for the current batch or project.',
    'Use FLUX.2 [klein] for cheap iteration and reserve Pro/Max/Flex for finals.',
    'Check the API response cost field after generation because FLUX.2 pricing can scale with megapixels.',
  ],
  stability: [
    'Buy credits in small batches until a workflow is proven.',
    'Use fixed-credit edit operations for predictable inpaint/search/background costs.',
    'Keep one Stability key per production when budget separation matters.',
  ],
  localOpen: [
    'Use local endpoints for free tests when hardware is sufficient.',
    'For cloud GPU endpoints, set prepaid limits or hourly shutdown automation with the host.',
    'Keep endpoint auth headers in Settings and rotate hosted endpoint tokens after shared testing.',
  ],
  android: [
    'Keep generation on the paired phone when zero provider spend matters more than cloud speed.',
    'Use the companion server status check before production batches.',
    'Switch to a cloud provider when the phone model cannot satisfy the requested size or style.',
  ],
};

const PROVIDER_TROUBLESHOOTING: Record<FirstClassImageProviderId, string[]> = {
  gemini: [
    'If API-key mode fails, verify the key in AI Studio and check whether the selected image model is available to your billing tier.',
    'If Vertex mode fails, confirm the selected auth mode, project ID, location, quota project, and billing.',
    'Gemini image edits may use prompt-guided region replacement rather than true provider mask endpoints.',
  ],
  openai: [
    'If edits fail, confirm the API key is from the OpenAI platform dashboard, not only a ChatGPT subscription.',
    'Check project billing limits when requests work in one project but not another.',
    'GPT Image 2 pricing is token-based, so exact final cost can differ from pre-run estimates.',
  ],
  atlas: [
    'Verify the Atlas API key is active and has native image model access before adding it to Settings.',
    'If a native model errors, confirm the Atlas model ID in the picker matches the model slug enabled for your account.',
    'If GPT Image routes error, confirm whether your Atlas base URL is an OpenAI-compatible endpoint or the native Atlas API URL.',
  ],
  byteplus: [
    'Verify your BytePlus API key (ModelArk → API Keys) is active and image model access is enabled.',
    'If requests fail, confirm the ModelArk base URL/region in Settings matches your account.',
    'Confirm the Seedream model ID matches one enabled for your account.',
  ],
  huggingface: [
    'If routed calls fail, check token scopes and whether the selected provider is enabled for your account.',
    'If costs look unexpected, inspect the provider selected by Hugging Face routing.',
    'Use custom provider keys when the routed provider blocks a specific feature.',
  ],
  bfl: [
    'If polling never completes, check the returned polling URL and account credit balance.',
    'If reference edits fail, reduce reference count to the selected model limit.',
    'If prices are higher than expected, check output megapixels and the API response cost field.',
  ],
  stability: [
    'If an edit endpoint rejects a request, switch to the matching Stability edit model for that operation.',
    'For search replace/recolor, provide a concrete search prompt and a replacement prompt.',
    'For inpaint, verify that both source image and mask are present.',
  ],
  localOpen: [
    'If requests fail, test the endpoint URL outside Sloom Studio with a small image first.',
    'Confirm the wrapper accepts the Sloom Studio local/open JSON contract: image, mask, references, prompt, and outputFormat.',
    'For rented GPUs, check server logs before assuming the Sloom Studio request failed.',
  ],
  android: [
    'If requests fail, confirm the phone and desktop are on the same LAN or use adb port forwarding for development.',
    'Confirm the Android foreground-service notification is active and the pairing token matches.',
    'In bridge mode, open Local Dream on the phone first so its backend and downloaded model are available.',
  ],
};

function caps(capabilities: Partial<ImageModelCapabilities>): ImageModelCapabilities {
  return {
    ...DEFAULT_CAPABILITIES,
    ...capabilities,
  };
}

const TEXT_TO_IMAGE_CONTROLS: ImageNodeVisibleControl[] = [
  'prompt',
  'aspectRatio',
  'outputFormat',
];

const HUGGING_FACE_TEXT_TO_IMAGE_CONTROLS: ImageNodeVisibleControl[] = [
  'prompt',
  'negativePrompt',
  'aspectRatio',
  'steps',
  'seed',
  'guidanceScale',
  'outputFormat',
];

const PROMPT_EDIT_CONTROLS: ImageNodeVisibleControl[] = [
  'prompt',
  'sourceImage',
  'outputFormat',
];

const BFL_CONTROLS: ImageNodeVisibleControl[] = [
  'prompt',
  'aspectRatio',
  'seed',
  'sourceImage',
  'referenceImages',
  'exactColorPrompt',
  'textEditPrompt',
  'outputFormat',
];

const OPENAI_CONTROLS: ImageNodeVisibleControl[] = [
  'prompt',
  'aspectRatio',
  'sourceImage',
  'mask',
  'referenceImages',
  'quality',
  'outputFormat',
];

// Atlas image-model node controls are now derived per model in `atlasImageCatalog.generated.ts`
// directly from each model's documented Atlas OpenAPI schema (verified 2026-06-28), so the hand-written
// ATLAS_*_CONTROLS arrays were removed — they could not track per-model differences (e.g. flux-kontext-dev
// takes a single image, flux-2 up to 8 references) and drifted from the docs.

const MODEL_DEFINITIONS: ImageModelDefinition[] = [
  {
    providerId: 'gemini',
    modelId: 'gemini-3.1-flash-image',
    label: 'Gemini 3.1 Flash Image',
    recommendedUse: 'Fast Google multimodal image generation and reference-guided edits.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 14,
      maxOutputMegapixels: 17,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: ['prompt', 'aspectRatio', 'imageSize', 'sourceImage', 'referenceImages', 'outputFormat'],
    cost: { imageEditUsd: 0.067, textToImageUsd: 0.067, unitLabel: '$0.067/image', confidence: 'heuristic' },
    docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3.1-flash-lite-image',
    label: 'Gemini 3.1 Flash Lite Image',
    recommendedUse: 'Lowest-latency Google image generation and editing at fixed 1K output.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 14,
      typography: true,
      textInImageEditing: true,
      maxOutputMegapixels: 1.1,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: ['prompt', 'aspectRatio', 'sourceImage', 'referenceImages', 'outputFormat'],
    cost: { unitLabel: 'token priced', confidence: 'provider-defined' },
    docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image Preview',
    recommendedUse: 'Fast Google multimodal image generation and reference-guided edits.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 14,
      maxOutputMegapixels: 2,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: ['prompt', 'aspectRatio', 'imageSize', 'sourceImage', 'referenceImages', 'outputFormat'],
    cost: { imageEditUsd: 0.067, textToImageUsd: 0.067, unitLabel: '$0.067/image', confidence: 'heuristic' },
    docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
    lifecycle: 'shutdown',
    availability: 'unavailable',
    capabilityConfidence: 'verified',
    migrationModelId: 'gemini-3.1-flash-image',
    shutdownAt: '2026-06-25',
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3-pro-image',
    label: 'Gemini 3 Pro Image',
    recommendedUse: 'Google multimodal image generation and reference-guided edits.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 14,
      maxOutputMegapixels: 17,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: ['prompt', 'aspectRatio', 'imageSize', 'sourceImage', 'referenceImages', 'outputFormat'],
    cost: { imageEditUsd: 0.101, textToImageUsd: 0.067, unitLabel: '$0.067-$0.101/image', confidence: 'heuristic' },
    docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-3-pro-image-preview',
    label: 'Gemini 3 Pro Image Preview',
    recommendedUse: 'Google multimodal image generation and reference-guided edits.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 14,
      maxOutputMegapixels: 2,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: ['prompt', 'aspectRatio', 'imageSize', 'sourceImage', 'referenceImages', 'outputFormat'],
    cost: { imageEditUsd: 0.101, textToImageUsd: 0.067, unitLabel: '$0.067-$0.101/image', confidence: 'heuristic' },
    docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
    lifecycle: 'shutdown',
    availability: 'unavailable',
    capabilityConfidence: 'verified',
    migrationModelId: 'gemini-3-pro-image',
    shutdownAt: '2026-06-25',
  },
  {
    providerId: 'gemini',
    modelId: 'gemini-2.5-flash-image',
    label: 'Gemini 2.5 Flash Image',
    recommendedUse: 'Low-cost Google image generation and editing.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 3,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: ['prompt', 'aspectRatio', 'sourceImage', 'referenceImages', 'outputFormat'],
    cost: { imageEditUsd: 0.039, textToImageUsd: 0.039, unitLabel: '$0.039/image', confidence: 'heuristic' },
    docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
  },
  {
    providerId: 'gemini',
    modelId: 'imagen-4.0-fast-generate-001',
    label: 'Vertex Imagen 4 Fast',
    recommendedUse: 'Lowest-cost Vertex Imagen 4 generation through Google Cloud.',
    capabilities: caps({
      textToImage: true,
      maxOutputMegapixels: 1,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: TEXT_TO_IMAGE_CONTROLS,
    cost: { textToImageUsd: 0.02, unitLabel: '$0.02/image', confidence: 'published-fixed' },
    docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images',
    lifecycle: 'deprecated',
    migrationModelId: 'gemini-3.1-flash-image',
    shutdownAt: '2026-08-17',
  },
  {
    providerId: 'gemini',
    modelId: 'imagen-4.0-generate-001',
    label: 'Vertex Imagen 4 Generate',
    recommendedUse: 'Standard-quality Vertex Imagen 4 generation through Google Cloud.',
    capabilities: caps({
      textToImage: true,
      maxOutputMegapixels: 1,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: TEXT_TO_IMAGE_CONTROLS,
    cost: { textToImageUsd: 0.04, unitLabel: '$0.04/image', confidence: 'published-fixed' },
    docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images',
    lifecycle: 'deprecated',
    migrationModelId: 'gemini-3.1-flash-image',
    shutdownAt: '2026-08-17',
  },
  {
    providerId: 'gemini',
    modelId: 'imagen-4.0-ultra-generate-001',
    label: 'Vertex Imagen 4 Ultra',
    recommendedUse: 'Highest-quality Vertex Imagen 4 generation through Google Cloud.',
    capabilities: caps({
      textToImage: true,
      maxOutputMegapixels: 1,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: TEXT_TO_IMAGE_CONTROLS,
    cost: { textToImageUsd: 0.06, unitLabel: '$0.06/image', confidence: 'published-fixed' },
    docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images',
    lifecycle: 'deprecated',
    migrationModelId: 'gemini-3.1-flash-image',
    shutdownAt: '2026-08-17',
  },
  {
    providerId: 'openai',
    modelId: 'gpt-image-2',
    label: 'GPT Image 2',
    recommendedUse: 'High-fidelity OpenAI generation and image edits with token-based pricing.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      maskInpaint: true,
      typography: true,
      textInImageEditing: true,
      // images.edit accepts up to 16 input images for GPT image models — source + 15 references.
      referenceImages: true,
      maxReferenceImages: 15,
      maxOutputMegapixels: 8.3,
    }),
    supportedOperations: ['text-to-image', 'image-edit', 'mask-inpaint'],
    visibleControls: OPENAI_CONTROLS,
    cost: { unitLabel: 'token priced', confidence: 'token-estimate' },
    docsUrl: 'https://developers.openai.com/api/docs/models/gpt-image-2',
  },
  {
    providerId: 'openai',
    modelId: 'gpt-image-1',
    label: 'GPT Image 1',
    recommendedUse: 'Existing OpenAI image generation/edit path.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      maskInpaint: true,
      // images.edit accepts up to 16 input images for GPT image models — source + 15 references.
      referenceImages: true,
      maxReferenceImages: 15,
    }),
    supportedOperations: ['text-to-image', 'image-edit', 'mask-inpaint'],
    visibleControls: OPENAI_CONTROLS,
    cost: { imageEditUsd: 0.04, textToImageUsd: 0.04, unitLabel: '~$0.04/image', confidence: 'heuristic' },
    docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
    lifecycle: 'deprecated',
    migrationModelId: 'gpt-image-2',
  },
  ...ATLAS_GENERATED_IMAGE_MODELS,
  {
    providerId: 'byteplus',
    modelId: 'seedream-5-0-260128',
    label: 'Seedream 5.0 Lite (260128)',
    recommendedUse: 'Current BytePlus visual reasoning and high-fidelity text-to-image generation.',
    capabilities: caps({
      textToImage: true,
      typography: true,
      textInImageEditing: true,
      customDimensions: true,
      maxOutputMegapixels: 8.3,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: ['prompt', 'aspectRatio', 'dimensions', 'seed', 'outputFormat'],
    cost: { unitLabel: 'BytePlus account billed', confidence: 'provider-defined' },
    docsUrl: 'https://docs.byteplus.com/en/docs/ModelArk/1824121',
  },
  {
    providerId: 'byteplus',
    modelId: 'seedream-4-5-251128',
    label: 'Seedream 4.5 (251128)',
    recommendedUse: 'Established BytePlus image generation with strong subject and text consistency.',
    capabilities: caps({
      textToImage: true,
      typography: true,
      customDimensions: true,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: ['prompt', 'aspectRatio', 'dimensions', 'seed', 'outputFormat'],
    cost: { unitLabel: 'BytePlus account billed', confidence: 'provider-defined' },
    docsUrl: 'https://docs.byteplus.com/en/docs/ModelArk/1824121',
  },
  {
    providerId: 'byteplus',
    modelId: 'seedream-4-0-250828',
    label: 'Seedream 4.0 (250828)',
    recommendedUse: 'Established BytePlus image generation where the 4.0 revision is required.',
    capabilities: caps({
      textToImage: true,
      typography: true,
      customDimensions: true,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: ['prompt', 'aspectRatio', 'dimensions', 'seed', 'outputFormat'],
    cost: { unitLabel: 'BytePlus account billed', confidence: 'provider-defined' },
    docsUrl: 'https://docs.byteplus.com/en/docs/ModelArk/1824121',
  },
  {
    providerId: 'huggingface',
    modelId: 'black-forest-labs/FLUX.1-dev',
    label: 'FLUX.1 Dev',
    recommendedUse: 'Open FLUX text-to-image generation through Hugging Face routing.',
    capabilities: caps({
      textToImage: true,
      maxOutputMegapixels: 2,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: HUGGING_FACE_TEXT_TO_IMAGE_CONTROLS,
    cost: { unitLabel: 'provider routed', confidence: 'provider-defined' },
    docsUrl: 'https://huggingface.co/black-forest-labs/FLUX.1-dev',
  },
  {
    providerId: 'huggingface',
    modelId: 'Tongyi-MAI/Z-Image-Turbo',
    label: 'Z-Image Turbo',
    recommendedUse: 'Fast open-model text-to-image generation through Hugging Face routing.',
    capabilities: caps({
      textToImage: true,
      maxOutputMegapixels: 2,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: HUGGING_FACE_TEXT_TO_IMAGE_CONTROLS,
    cost: { unitLabel: 'provider routed', confidence: 'provider-defined' },
    docsUrl: 'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo',
  },
  {
    providerId: 'huggingface',
    modelId: 'Qwen/Qwen-Image',
    label: 'Qwen Image',
    recommendedUse: 'Open Qwen text-to-image generation with strong text rendering through Hugging Face routing.',
    capabilities: caps({
      textToImage: true,
      typography: true,
      maxOutputMegapixels: 2,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: HUGGING_FACE_TEXT_TO_IMAGE_CONTROLS,
    cost: { unitLabel: 'provider routed', confidence: 'provider-defined' },
    docsUrl: 'https://huggingface.co/Qwen/Qwen-Image',
  },
  {
    providerId: 'huggingface',
    modelId: 'black-forest-labs/FLUX.1-Kontext-dev',
    label: 'FLUX.1 Kontext Dev',
    recommendedUse: 'Open FLUX Kontext generation through Hugging Face routing; use the Local/Open or BFL lanes for source-image edits.',
    capabilities: caps({
      textToImage: true,
      maxOutputMegapixels: 2,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: HUGGING_FACE_TEXT_TO_IMAGE_CONTROLS,
    cost: { unitLabel: 'provider routed', confidence: 'provider-defined' },
    docsUrl: 'https://huggingface.co/docs/api-inference/en/pricing',
  },
  {
    providerId: 'huggingface',
    modelId: 'stabilityai/stable-diffusion-3.5-large',
    label: 'Stable Diffusion 3.5 Large',
    recommendedUse: 'High-quality Stable Diffusion text-to-image generation through Hugging Face routing.',
    capabilities: caps({
      textToImage: true,
      maxOutputMegapixels: 2,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: HUGGING_FACE_TEXT_TO_IMAGE_CONTROLS,
    cost: { unitLabel: 'provider routed', confidence: 'provider-defined' },
    docsUrl: 'https://huggingface.co/stabilityai/stable-diffusion-3.5-large',
  },
  {
    providerId: 'huggingface',
    modelId: 'stabilityai/stable-diffusion-xl-base-1.0',
    label: 'SDXL Base 1.0',
    recommendedUse: 'Legacy SDXL text-to-image generation through Hugging Face routing.',
    capabilities: caps({
      textToImage: true,
      maxOutputMegapixels: 1,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: HUGGING_FACE_TEXT_TO_IMAGE_CONTROLS,
    cost: { unitLabel: 'provider routed', confidence: 'provider-defined' },
    docsUrl: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0',
  },
  {
    providerId: 'bfl',
    modelId: 'flux-2-klein-4b',
    label: 'FLUX.2 Klein 4B',
    recommendedUse: 'Lowest-cost FLUX.2 cloud generation/editing or local Apache-licensed model workflow.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 4,
      exactColorControl: true,
      typography: true,
      textInImageEditing: true,
      maxOutputMegapixels: 4,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: BFL_CONTROLS,
    cost: { textToImageUsd: 0.014, imageEditUsd: 0.014, unitLabel: 'from $0.014/image', confidence: 'published-minimum' },
    docsUrl: 'https://docs.bfl.ai/flux_2',
  },
  {
    providerId: 'bfl',
    modelId: 'flux-2-klein-9b',
    label: 'FLUX.2 Klein 9B',
    recommendedUse: 'Balanced low-cost FLUX.2 cloud generation/editing.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 4,
      exactColorControl: true,
      typography: true,
      textInImageEditing: true,
      maxOutputMegapixels: 4,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: BFL_CONTROLS,
    cost: { textToImageUsd: 0.015, imageEditUsd: 0.015, unitLabel: 'from $0.015/image', confidence: 'published-minimum' },
    docsUrl: 'https://docs.bfl.ai/flux_2',
  },
  {
    providerId: 'bfl',
    modelId: 'flux-2-klein-9b-preview',
    label: 'FLUX.2 Klein 9B Preview',
    recommendedUse: 'Latest FLUX.2 Klein 9B improvements when a changing preview endpoint is acceptable.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 4,
      exactColorControl: true,
      typography: true,
      textInImageEditing: true,
      maxOutputMegapixels: 4,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: BFL_CONTROLS,
    cost: { textToImageUsd: 0.015, imageEditUsd: 0.015, unitLabel: 'from $0.015/image', confidence: 'published-minimum' },
    docsUrl: 'https://docs.bfl.ai/flux_2/flux2_overview',
    lifecycle: 'preview',
  },
  {
    providerId: 'bfl',
    modelId: 'flux-2-pro',
    label: 'FLUX.2 Pro',
    recommendedUse: 'Production FLUX.2 generation/editing with strong multi-reference support.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 8,
      exactColorControl: true,
      typography: true,
      textInImageEditing: true,
      maxOutputMegapixels: 4,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: BFL_CONTROLS,
    cost: { textToImageUsd: 0.03, imageEditUsd: 0.045, unitLabel: 'from $0.03/image', confidence: 'published-minimum' },
    docsUrl: 'https://docs.bfl.ai/flux_2/flux2_image_editing',
  },
  {
    providerId: 'bfl',
    modelId: 'flux-2-pro-preview',
    label: 'FLUX.2 Pro Preview',
    recommendedUse: 'Latest FLUX.2 Pro behavior before pinning to the stable model.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 8,
      exactColorControl: true,
      typography: true,
      textInImageEditing: true,
      maxOutputMegapixels: 4,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: BFL_CONTROLS,
    cost: { textToImageUsd: 0.03, imageEditUsd: 0.045, unitLabel: 'from $0.03/image', confidence: 'published-minimum' },
    docsUrl: 'https://docs.bfl.ai/flux_2/flux2_image_editing',
  },
  {
    providerId: 'bfl',
    modelId: 'flux-2-max',
    label: 'FLUX.2 Max',
    recommendedUse: 'Highest-quality FLUX.2 generation/editing and grounding search.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 8,
      exactColorControl: true,
      typography: true,
      textInImageEditing: true,
      maxOutputMegapixels: 4,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: BFL_CONTROLS,
    cost: { textToImageUsd: 0.07, imageEditUsd: 0.07, unitLabel: 'from $0.07/image', confidence: 'published-minimum' },
    docsUrl: 'https://docs.bfl.ai/flux_2',
  },
  {
    providerId: 'bfl',
    modelId: 'flux-2-flex',
    label: 'FLUX.2 Flex',
    recommendedUse: 'Fine-grained FLUX.2 editing, typography, and control-heavy work.',
    capabilities: caps({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 8,
      exactColorControl: true,
      typography: true,
      textInImageEditing: true,
      maxOutputMegapixels: 4,
    }),
    supportedOperations: ['text-to-image', 'image-edit'],
    visibleControls: BFL_CONTROLS,
    cost: { textToImageUsd: 0.06, imageEditUsd: 0.06, unitLabel: 'from $0.06/image', confidence: 'published-minimum' },
    docsUrl: 'https://docs.bfl.ai/flux_2',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-core',
    label: 'Stable Image Core',
    recommendedUse: 'Simple Stability AI text-to-image cloud generation.',
    capabilities: caps({ textToImage: true }),
    supportedOperations: ['text-to-image'],
    visibleControls: TEXT_TO_IMAGE_CONTROLS,
    cost: { textToImageUsd: 0.03, unitLabel: '3 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/docs/getting-started/stable-image',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-ultra',
    label: 'Stable Image Ultra',
    recommendedUse: 'Highest-quality Stability AI generation.',
    capabilities: caps({ textToImage: true }),
    supportedOperations: ['text-to-image'],
    visibleControls: TEXT_TO_IMAGE_CONTROLS,
    cost: { textToImageUsd: 0.08, unitLabel: '8 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/pricing',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-upscale-fast',
    label: 'Stable Image Upscale: Fast',
    recommendedUse: 'Low-cost 4x AI upscaling for print preparation before exact local DPI fitting.',
    capabilities: caps({ imageToImage: true, upscale: true, maxOutputMegapixels: 4 }),
    supportedOperations: ['upscale'],
    visibleControls: ['sourceImage', 'outputFormat'],
    cost: { fixedByOperationUsd: { upscale: 0.02 }, unitLabel: '2 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/docs/api-reference#tag/Upscale/paths/~1v2beta~1stable-image~1upscale~1fast/post',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-upscale-conservative',
    label: 'Stable Image Upscale: Conservative',
    recommendedUse: 'Higher-cost faithful enhancement for low-resolution artwork that needs a 4MP print-ready intermediate.',
    capabilities: caps({ imageToImage: true, upscale: true, promptEdit: true, maxOutputMegapixels: 4 }),
    supportedOperations: ['upscale'],
    visibleControls: ['prompt', 'sourceImage', 'creativity', 'outputFormat'],
    cost: { fixedByOperationUsd: { upscale: 0.4 }, unitLabel: '40 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/docs/api-reference#tag/Upscale/paths/~1v2beta~1stable-image~1upscale~1conservative/post',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-edit-inpaint',
    label: 'Stable Image Edit: Inpaint',
    recommendedUse: 'True mask-aware generative fill.',
    capabilities: caps({ imageToImage: true, maskInpaint: true, promptEdit: true }),
    supportedOperations: ['mask-inpaint'],
    visibleControls: ['prompt', 'sourceImage', 'mask', 'outputFormat'],
    cost: { fixedByOperationUsd: { 'mask-inpaint': 0.05 }, unitLabel: '5 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/docs/getting-started/stable-image',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-edit-erase',
    label: 'Stable Image Edit: Erase',
    recommendedUse: 'Mask-aware content removal and cleanup workflows.',
    capabilities: caps({
      imageToImage: true,
      maskInpaint: true,
      promptEdit: false,
      erase: true,
    }),
    supportedOperations: ['erase'],
    visibleControls: ['sourceImage', 'mask', 'outputFormat'],
    cost: { fixedByOperationUsd: { erase: 0.05 }, unitLabel: '5 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/docs/api-reference#tag/StableImageEdit/paths/~1v2beta~1stable-image~1edit~1erase/post',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-edit-outpaint',
    label: 'Stable Image Edit: Outpaint',
    recommendedUse: 'Canvas expansion in any direction.',
    capabilities: caps({ imageToImage: true, outpaint: true, promptEdit: true }),
    supportedOperations: ['outpaint'],
    visibleControls: ['prompt', 'sourceImage', 'outpaintMargins', 'creativity', 'outputFormat'],
    cost: { fixedByOperationUsd: { outpaint: 0.04 }, unitLabel: '4 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/pricing',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-edit-search-replace',
    label: 'Stable Image Edit: Search and Replace',
    recommendedUse: 'Find an object from words and replace it without manual masking.',
    capabilities: caps({ imageToImage: true, searchReplace: true, promptEdit: true }),
    supportedOperations: ['search-replace'],
    visibleControls: ['prompt', 'sourceImage', 'searchPrompt', 'outputFormat'],
    cost: { fixedByOperationUsd: { 'search-replace': 0.05 }, unitLabel: '5 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/pricing',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-edit-search-recolor',
    label: 'Stable Image Edit: Search and Recolor',
    recommendedUse: 'Find an object from words and change its color.',
    capabilities: caps({ imageToImage: true, searchRecolor: true, exactColorControl: true }),
    supportedOperations: ['search-recolor'],
    visibleControls: ['prompt', 'sourceImage', 'searchPrompt', 'exactColorPrompt', 'outputFormat'],
    cost: { fixedByOperationUsd: { 'search-recolor': 0.05 }, unitLabel: '5 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/pricing',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-edit-remove-background',
    label: 'Stable Image Edit: Remove Background',
    recommendedUse: 'Foreground/background separation.',
    capabilities: caps({ imageToImage: true, removeBackground: true }),
    supportedOperations: ['remove-background'],
    visibleControls: ['sourceImage', 'outputFormat'],
    cost: { fixedByOperationUsd: { 'remove-background': 0.05 }, unitLabel: '5 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/pricing',
  },
  {
    providerId: 'stability',
    modelId: 'stable-image-edit-replace-background-relight',
    label: 'Stable Image Edit: Replace Background and Relight',
    recommendedUse: 'Product/composite background swap with lighting match.',
    capabilities: caps({ imageToImage: true, replaceBackgroundRelight: true, promptEdit: true }),
    supportedOperations: ['replace-background-relight'],
    visibleControls: ['prompt', 'sourceImage', 'outputFormat'],
    cost: { fixedByOperationUsd: { 'replace-background-relight': 0.08 }, unitLabel: '8 credits', confidence: 'published-fixed' },
    docsUrl: 'https://platform.stability.ai/pricing',
  },
  {
    providerId: 'localOpen',
    modelId: 'Qwen/Qwen-Image-Edit',
    label: 'Qwen Image Edit',
    recommendedUse: 'Local/open prompt editing with strong bilingual text-in-image edits.',
    capabilities: caps({
      imageToImage: true,
      promptEdit: true,
      maskInpaint: true,
      referenceImages: true,
      maxReferenceImages: 1,
      typography: true,
      textInImageEditing: true,
      localEndpoint: true,
    }),
    supportedOperations: ['image-edit', 'mask-inpaint', 'local-open-edit'],
    visibleControls: ['prompt', 'sourceImage', 'mask', 'referenceImages', 'localEndpoint', 'textEditPrompt', 'outputFormat'],
    cost: { unitLabel: 'local/provider-defined', confidence: 'provider-defined' },
    docsUrl: 'https://huggingface.co/Qwen/Qwen-Image-Edit',
  },
  {
    providerId: 'localOpen',
    modelId: 'Qwen/Qwen-Image-Edit-2511',
    label: 'Qwen Image Edit 2511',
    recommendedUse: 'Newer Qwen-compatible local/open prompt editing endpoint.',
    capabilities: caps({
      imageToImage: true,
      promptEdit: true,
      maskInpaint: true,
      referenceImages: true,
      maxReferenceImages: 1,
      typography: true,
      textInImageEditing: true,
      localEndpoint: true,
    }),
    supportedOperations: ['image-edit', 'mask-inpaint', 'local-open-edit'],
    visibleControls: ['prompt', 'sourceImage', 'mask', 'referenceImages', 'localEndpoint', 'textEditPrompt', 'outputFormat'],
    cost: { unitLabel: 'local/provider-defined', confidence: 'provider-defined' },
    docsUrl: 'https://huggingface.co/Qwen/Qwen-Image-Edit-2511',
  },
  {
    providerId: 'localOpen',
    modelId: 'black-forest-labs/FLUX.1-Kontext-dev',
    label: 'FLUX.1 Kontext Dev',
    recommendedUse: 'Local/open prompt editing via a compatible HTTP wrapper.',
    capabilities: caps({
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 1,
      localEndpoint: true,
    }),
    supportedOperations: ['image-edit', 'local-open-edit'],
    visibleControls: PROMPT_EDIT_CONTROLS.concat(['localEndpoint', 'referenceImages']),
    cost: { unitLabel: 'local/provider-defined', confidence: 'provider-defined' },
    docsUrl: 'https://docs.bfl.ai/kontext/kontext_overview',
  },
  {
    providerId: 'android',
    modelId: 'local-dream-active',
    label: 'Local Dream Active Model',
    recommendedUse: 'Phone-side text-to-image generation through the paired Android accelerator gateway.',
    capabilities: caps({
      textToImage: true,
      localEndpoint: true,
      maxOutputMegapixels: 1,
    }),
    supportedOperations: ['text-to-image'],
    visibleControls: ['prompt', 'aspectRatio', 'steps', 'seed', 'outputFormat'],
    cost: { textToImageUsd: 0, unitLabel: '$0 provider spend', confidence: 'published-fixed' },
    docsUrl: 'docs/notes/246-android-accelerator-local-dream-live-bridge.md',
  },
];

type RawImageProviderHelpEntry = Omit<
  ImageProviderHelpEntry,
  'supportedOperations' | 'spendControls' | 'troubleshooting' | 'lastVerifiedDate'
>;

const PROVIDER_HELP: RawImageProviderHelpEntry[] = [
  {
    providerId: 'gemini',
    label: 'Google Gemini / Vertex AI',
    signupUrl: 'https://aistudio.google.com/app/apikey',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    capabilitySummary: 'Gemini image models support text-to-image, source-image editing, and reference-guided generation in Sloom Studio.',
    setupSteps: [
      'Create a Google AI Studio API key, or configure Vertex AI desktop auth in the app.',
      'Paste the API key in Settings or switch Google image credential mode to Vertex AI.',
      'Select a Gemini image model in an Image node.',
    ],
    costNotes: [
      'Gemini image estimates are model-specific and shown before generation.',
      'Vertex Imagen models require a billing-enabled Google Cloud project.',
    ],
  },
  {
    providerId: 'openai',
    label: 'OpenAI',
    signupUrl: 'https://platform.openai.com/signup',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    pricingUrl: 'https://openai.com/api/pricing/',
    capabilitySummary: 'OpenAI GPT Image models support generation and image edits, with GPT Image 2 priced by image/text tokens.',
    setupSteps: [
      'Create an OpenAI platform account and add billing.',
      'Create an API key from the OpenAI dashboard.',
      'Paste it in Sloom Studio Settings and select GPT Image 2 or GPT Image 1.',
    ],
    costNotes: [
      'GPT Image 2 is token-priced, so Sloom Studio shows a token estimate rather than a fixed image price.',
      'OpenAI API billing is separate from ChatGPT subscriptions.',
    ],
  },
  {
    providerId: 'atlas',
    label: 'Atlas Cloud',
    signupUrl: 'https://app.atlas-cloud.ai/',
    apiKeyUrl: 'https://app.atlas-cloud.ai/',
    pricingUrl: 'https://www.atlascloud.ai/',
    capabilitySummary: 'Atlas Cloud exposes native text-to-image and image editing models in Sloom Studio, while preserving GPT Image routes for OpenAI-compatible Atlas endpoints.',
    setupSteps: [
      'Create an Atlas Cloud account and add an API key.',
      'Enter the key in Sloom Studio Settings; native image models use https://api.atlascloud.ai/api/v1 by default.',
      'Select Atlas in an Image node and choose a native FLUX, Seedream, Nano Banana, Qwen, or FireRed image model.',
    ],
    costNotes: [
      'FLUX Schnell, FLUX Dev, Z-Image Turbo, and Qwen Image Edit show fixed estimates where Atlas has published per-image prices.',
      'Other Atlas native models are labeled Atlas account billed until exact per-model pricing is published or returned by the API.',
      'GPT Image 2 remains token-priced when selected through an OpenAI-compatible Atlas endpoint.',
    ],
  },
  {
    providerId: 'byteplus',
    label: 'BytePlus ModelArk',
    signupUrl: 'https://console.byteplus.com/auth/signup/',
    apiKeyUrl: 'https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey',
    pricingUrl: 'https://docs.byteplus.com/en/docs/ModelArk/1544106',
    capabilitySummary: 'BytePlus ModelArk exposes current Seedream image-generation models through the documented Image Generation API.',
    setupSteps: [
      'Create a BytePlus account and enable ModelArk in a supported region.',
      'Create a ModelArk API key in the BytePlus console and paste it in Sloom Studio Settings.',
      'Select an exact Seedream endpoint ID in an Image node; Sloom Studio does not rewrite display names into API IDs.',
    ],
    costNotes: [
      'Seedream usage is billed by your BytePlus ModelArk account and region.',
      'Sloom Studio labels the estimate as provider-billed until the account-specific price can be confirmed.',
    ],
  },
  {
    providerId: 'huggingface',
    label: 'Hugging Face',
    signupUrl: 'https://huggingface.co/join',
    apiKeyUrl: 'https://huggingface.co/settings/tokens',
    pricingUrl: 'https://huggingface.co/docs/api-inference/en/pricing',
    capabilitySummary: 'Hugging Face routes open and hosted image models, with provider-specific prices and small monthly credits.',
    setupSteps: [
      'Create a Hugging Face account.',
      'Create a user access token.',
      'Paste it in Sloom Studio Settings and select a Hugging Face image model.',
    ],
    costNotes: [
      'Costs depend on the routed provider and model.',
      'Free monthly credits are useful for testing but should not be treated as production capacity.',
    ],
  },
  {
    providerId: 'bfl',
    label: 'Black Forest Labs',
    signupUrl: 'https://dashboard.bfl.ai/',
    apiKeyUrl: 'https://dashboard.bfl.ai/',
    pricingUrl: 'https://docs.us.bfl.ai/quick_start/pricing',
    capabilitySummary: 'BFL FLUX.2 adds cloud multi-reference editing, text edits, exact color prompting, and up to 4MP output.',
    setupSteps: [
      'Create a BFL account from the dashboard.',
      'Add credits and create an API key.',
      'Paste the key in Sloom Studio Settings and select a FLUX.2 model.',
    ],
    costNotes: [
      'BFL uses credit pricing where 1 credit equals $0.01.',
      'FLUX.2 pricing starts at published per-image minimums and can scale with output megapixels.',
    ],
  },
  {
    providerId: 'stability',
    label: 'Stability AI',
    signupUrl: 'https://platform.stability.ai/',
    apiKeyUrl: 'https://platform.stability.ai/account/keys',
    pricingUrl: 'https://platform.stability.ai/pricing',
    capabilitySummary: 'Stability AI adds true inpaint masks, outpaint, search-replace, search-recolor, background removal, relighting, and fixed-cost Fast/Conservative upscaling.',
    setupSteps: [
      'Create a Stability AI platform account.',
      'Claim trial credits or buy credits.',
      'Create an API key and paste it in Sloom Studio Settings.',
    ],
    costNotes: [
      'Stability uses credits; 1 credit equals $0.01.',
      'Edit operations expose fixed credit estimates in Sloom Studio.',
      'Fast Upscale is 2 credits / $0.02 per image; Conservative Upscale is 40 credits / $0.40 per image.',
    ],
  },
  {
    providerId: 'localOpen',
    label: 'Local / Open Models',
    signupUrl: 'https://huggingface.co/Qwen/Qwen-Image-Edit',
    pricingUrl: 'https://huggingface.co/docs/api-inference/en/pricing',
    capabilitySummary: 'Local/Open Models let Sloom Studio call a Qwen/ComfyUI/local HTTP endpoint without relying on the RX 5700 XT for every cloud run.',
    setupSteps: [
      'Run a compatible local, LAN, or rented-cloud model server that accepts the Sloom Studio local/open image endpoint contract.',
      'Paste the endpoint URL and optional Authorization header in Settings.',
      'Select Local / Open Models in an Image node or Image workspace fill action.',
    ],
    costNotes: [
      'Sloom Studio labels this as local/provider-defined because costs depend on your machine or rented GPU provider.',
      'Use this lane for free local experiments or prepaid cloud GPU wrappers.',
    ],
  },
  {
    providerId: 'android',
    label: 'Android Accelerator',
    signupUrl: 'https://github.com/xororz/local-dream',
    pricingUrl: 'https://github.com/xororz/local-dream',
    capabilitySummary: 'Android Accelerator lets Sloom Studio call models and upscalers running on a paired Snapdragon/Local Dream phone over the local network.',
    setupSteps: [
      'Install and start the Sloom Studio Android Accelerator companion on the phone.',
      'Paste the companion URL and pairing token in Sloom Studio Settings.',
      'In bridge mode, open Local Dream on the phone and select/download the model there.',
      'Select Android Accelerator in an Image node for phone-side generation.',
    ],
    costNotes: [
      'Sloom Studio treats Android Accelerator runs as $0 provider spend after setup.',
      'Phone battery, heat, and model availability are the practical constraints.',
    ],
  },
];

const PROVIDER_IDS: FirstClassImageProviderId[] = [
  'gemini',
  'openai',
  'atlas',
  'byteplus',
  'huggingface',
  'bfl',
  'stability',
  'localOpen',
  'android',
];

export function listImageProviderIds(): FirstClassImageProviderId[] {
  return [...PROVIDER_IDS];
}

export function listImageProviderHelpEntries(): ImageProviderHelpEntry[] {
  return PROVIDER_HELP.map(enrichProviderHelpEntry);
}

export function listImageModelDefinitions(providerId?: FirstClassImageProviderId): ImageModelDefinition[] {
  const definitions = providerId
    ? MODEL_DEFINITIONS.filter((definition) => definition.providerId === providerId)
    : MODEL_DEFINITIONS;

  return definitions.map(cloneModelDefinition);
}

export function hasRegisteredImageModelDefinition(
  providerId: FirstClassImageProviderId,
  modelId: string | undefined,
): boolean {
  const normalizedModelId = normalizeModelId(modelId);
  return MODEL_DEFINITIONS.some(
    (definition) =>
      definition.providerId === providerId &&
      definition.modelId.toLowerCase() === normalizedModelId,
  );
}

export function listImageModelPricingEntries(
  providerId?: FirstClassImageProviderId,
): ImageModelPricingEntry[] {
  const definitions = providerId
    ? MODEL_DEFINITIONS.filter((definition) => definition.providerId === providerId)
    : MODEL_DEFINITIONS;

  return definitions.flatMap((definition) =>
    definition.supportedOperations.map((operation) =>
      buildPricingEntryForOperation(definition, operation),
    ),
  );
}

export function getImageModelDefinition(
  providerId: FirstClassImageProviderId,
  modelId: string | undefined,
): ImageModelDefinition {
  const normalizedModelId = normalizeModelId(modelId);
  const exact = MODEL_DEFINITIONS.find(
    (definition) => definition.providerId === providerId && definition.modelId.toLowerCase() === normalizedModelId,
  );

  if (exact) {
    return cloneModelDefinition(exact);
  }

  if (modelId && modelId.trim()) {
    if (providerId === 'atlas') {
      const inferred = inferImageModelCapabilities(providerId, modelId);
      const hasExplicitNonGenerationOperation = inferred.supportedOperations.some(
        (operation) => operation !== 'text-to-image',
      );
      if (hasExplicitNonGenerationOperation) {
        return {
          providerId,
          modelId,
          label: inferred.label,
          recommendedUse: 'Live Atlas model with operation-shaped controls inferred from its route ID; verify availability for the connected account.',
          capabilities: inferred.capabilities,
          supportedOperations: inferred.supportedOperations,
          visibleControls: inferred.visibleControls,
          cost: { confidence: 'unknown', unitLabel: 'provider-billed' },
          docsUrl: '',
          lifecycle: 'unverified',
          availability: 'live',
          capabilityConfidence: 'unverified',
          evidence: [],
        };
      }
    }
    return {
      providerId,
      modelId,
      label: modelId,
      recommendedUse: 'Live or saved model with unverified capabilities; capabilities are not inferred from its name.',
      capabilities: caps({ textToImage: true }),
      supportedOperations: ['text-to-image'],
      visibleControls: ['prompt', 'outputFormat'],
      cost: { confidence: 'unknown', unitLabel: 'provider-billed' },
      docsUrl: '',
      lifecycle: 'unverified',
      availability: 'live',
      capabilityConfidence: 'unverified',
      evidence: [],
    };
  }

  const providerDefault = MODEL_DEFINITIONS.find((definition) => definition.providerId === providerId);
  if (providerDefault) {
    return cloneModelDefinition(providerDefault);
  }

  return {
    providerId,
    modelId: modelId ?? 'unknown',
    label: modelId ?? 'Unknown image model',
    recommendedUse: 'Unregistered image model.',
    capabilities: caps({ textToImage: true }),
    supportedOperations: ['text-to-image'],
    visibleControls: TEXT_TO_IMAGE_CONTROLS,
    cost: { confidence: 'unknown', unitLabel: 'unknown' },
    docsUrl: '',
    lifecycle: 'unverified',
    availability: 'live',
    capabilityConfidence: 'unverified',
    evidence: [],
  };
}

export function getImageModelCapabilities(
  providerId: FirstClassImageProviderId,
  modelId: string | undefined,
): ImageModelCapabilities {
  return { ...getImageModelDefinition(providerId, modelId).capabilities };
}

export function getImageNodeControlModel(
  providerId: FirstClassImageProviderId,
  modelId: string | undefined,
): ImageNodeControlModel {
  const definition = getImageModelDefinition(providerId, modelId);
  const cost = estimateImageModelCostUsd({
    providerId,
    modelId: definition.modelId,
    operation: definition.supportedOperations[0] ?? 'text-to-image',
    imageCount: 1,
  });

  return {
    providerId,
    modelId: definition.modelId,
    supportedOperations: [...definition.supportedOperations],
    visibleControls: [...definition.visibleControls],
    capabilities: { ...definition.capabilities },
    costEstimateLabel: formatImageCostEstimate(cost),
  };
}

export function estimateImageModelCostUsd(input: ImageModelCostInput): ImageModelCostEstimate {
  const definition = getImageModelDefinition(input.providerId, input.modelId);
  const imageCount = Math.max(1, Math.floor(input.imageCount ?? 1));

  if ((input.providerId === 'openai' || input.providerId === 'atlas') && definition.modelId === 'gpt-image-2') {
    return estimateGptImage2Cost(input, imageCount);
  }

  const fixedOperationCost = definition.cost.fixedByOperationUsd?.[input.operation];
  if (fixedOperationCost !== undefined) {
    return {
      costUsd: roundUsd(fixedOperationCost * imageCount),
      confidence: definition.cost.confidence,
      unitLabel: definition.cost.unitLabel ?? formatUsd(fixedOperationCost),
      notes: [`Published estimate for ${definition.label}.`],
    };
  }

  const baseCost = input.operation === 'text-to-image'
    ? definition.cost.textToImageUsd
    : definition.cost.imageEditUsd ?? definition.cost.textToImageUsd;

  if (baseCost !== undefined) {
    return {
      costUsd: roundUsd(baseCost * imageCount),
      confidence: definition.cost.confidence,
      unitLabel: operationUnitLabel(definition, input.operation, baseCost),
      notes: definition.cost.confidence === 'published-minimum'
        ? ['Published minimum; exact price can rise with output megapixels or provider routing.']
        : [`Estimate for ${definition.label}.`],
    };
  }

  return {
    costUsd: undefined,
    confidence: definition.cost.confidence,
    unitLabel: definition.cost.unitLabel ?? 'unknown',
    notes: [`${definition.label} cost depends on the configured provider or runtime.`],
  };
}

function estimateGptImage2Cost(input: ImageModelCostInput, imageCount: number): ImageModelCostEstimate {
  const textInputTokens = input.textInputTokens ?? 250;
  const imageInputTokens = input.imageInputTokens ?? 0;
  const outputImageTokens = input.outputImageTokens ?? estimateOutputImageTokens(input.outputMegapixels ?? 1);
  const cost =
    (textInputTokens * 5) / 1_000_000 +
    (imageInputTokens * 8) / 1_000_000 +
    (outputImageTokens * 30) / 1_000_000;

  return {
    costUsd: roundUsd(cost * imageCount),
    confidence: 'token-estimate',
    unitLabel: 'token priced',
    notes: [
      'GPT Image 2 is charged by text, input-image, and output-image tokens.',
      'This estimate uses Sloom Studio token heuristics until actual usage metadata is available.',
    ],
  };
}

function buildPricingEntryForOperation(
  definition: ImageModelDefinition,
  operation: ImageModelOperation,
): ImageModelPricingEntry {
  const estimate = estimateImageModelCostUsd({
    providerId: definition.providerId,
    modelId: definition.modelId,
    operation,
    imageCount: 1,
  });

  return {
    providerId: definition.providerId,
    modelId: definition.modelId,
    operation,
    unit: estimate.unitLabel,
    unitPriceUsd: estimate.costUsd,
    freeTierOrCredits: PROVIDER_FREE_TIER_NOTES[definition.providerId],
    lastVerifiedDate: PRICING_LAST_VERIFIED_DATE,
    sourceUrl: pricingSourceUrlForProvider(definition.providerId),
    visibility: pricingVisibilityForEstimate(estimate),
    notes: estimate.notes,
  };
}

function enrichProviderHelpEntry(entry: RawImageProviderHelpEntry): ImageProviderHelpEntry {
  return {
    ...entry,
    setupSteps: [...entry.setupSteps],
    costNotes: [...entry.costNotes],
    supportedOperations: supportedOperationsForProvider(entry.providerId),
    spendControls: [...PROVIDER_SPEND_CONTROLS[entry.providerId]],
    troubleshooting: [...PROVIDER_TROUBLESHOOTING[entry.providerId]],
    lastVerifiedDate: PRICING_LAST_VERIFIED_DATE,
  };
}

function supportedOperationsForProvider(providerId: FirstClassImageProviderId): ImageModelOperation[] {
  return Array.from(new Set(
    MODEL_DEFINITIONS
      .filter((definition) => definition.providerId === providerId)
      .flatMap((definition) => definition.supportedOperations),
  ));
}

function pricingSourceUrlForProvider(providerId: FirstClassImageProviderId): string {
  return PROVIDER_HELP.find((entry) => entry.providerId === providerId)?.pricingUrl
    ?? 'https://github.com/cabewse/signal-loom';
}

function pricingVisibilityForEstimate(estimate: ImageModelCostEstimate): ImageModelPricingVisibility {
  switch (estimate.confidence) {
    case 'published-fixed':
      return 'exact';
    case 'published-minimum':
    case 'token-estimate':
    case 'heuristic':
      return 'estimated';
    case 'provider-defined':
      return 'local-or-provider-defined';
    case 'unknown':
      return 'unknown-disabled';
  }
}

function estimateOutputImageTokens(outputMegapixels: number): number {
  return Math.max(500, Math.round(Math.max(0.25, outputMegapixels) * 1_300));
}

function operationUnitLabel(
  definition: ImageModelDefinition,
  operation: ImageModelOperation,
  costUsd: number,
): string {
  if (definition.providerId === 'bfl' && operation === 'image-edit') {
    return `from ${formatUsd(costUsd)}/edit`;
  }

  if (definition.cost.unitLabel) {
    return definition.cost.unitLabel;
  }

  return `${formatUsd(costUsd)}/image`;
}

function formatImageCostEstimate(cost: ImageModelCostEstimate): string {
  if (cost.costUsd === undefined) {
    return cost.unitLabel;
  }

  return `${formatUsd(cost.costUsd)} (${cost.unitLabel})`;
}

function cloneModelDefinition(definition: ImageModelDefinition): ImageModelDefinition {
  const lifecycle = definition.lifecycle ?? defaultLifecycleForImageDefinition(definition);
  const availability = definition.availability ?? defaultAvailabilityForImageDefinition(definition, lifecycle);
  const capabilityConfidence = definition.capabilityConfidence
    ?? defaultCapabilityConfidenceForImageDefinition(definition);
  const evidence = definition.evidence
    ?? (definition.docsUrl.startsWith('https://')
      ? [{
          title: `${definition.label} official model or endpoint documentation`,
          url: definition.docsUrl,
          verifiedAt: '2026-07-14',
        }]
      : []);

  return {
    ...definition,
    lifecycle,
    availability,
    capabilityConfidence,
    evidence: evidence.map((entry) => ({ ...entry })),
    capabilities: { ...definition.capabilities },
    supportedOperations: [...definition.supportedOperations],
    visibleControls: [...definition.visibleControls],
    cost: {
      ...definition.cost,
      fixedByOperationUsd: definition.cost.fixedByOperationUsd
        ? { ...definition.cost.fixedByOperationUsd }
        : undefined,
    },
  };
}

function defaultLifecycleForImageDefinition(definition: ImageModelDefinition): ModelLifecycle {
  if (definition.modelId.includes('preview')) return 'preview';
  if (definition.providerId === 'localOpen' || definition.providerId === 'android') return 'unverified';
  return 'stable';
}

function defaultAvailabilityForImageDefinition(
  definition: ImageModelDefinition,
  lifecycle: ModelLifecycle,
): ModelAvailability {
  if (lifecycle === 'shutdown') return 'unavailable';
  if (lifecycle === 'preview') return 'rollout-dependent';
  if (definition.providerId === 'gemini' || definition.providerId === 'openai') return 'documented';
  if (definition.providerId === 'localOpen' || definition.providerId === 'android') return 'live';
  return 'account-dependent';
}

function defaultCapabilityConfidenceForImageDefinition(
  definition: ImageModelDefinition,
): 'verified' | 'unverified' {
  return definition.providerId === 'localOpen' || definition.providerId === 'android'
    ? 'unverified'
    : 'verified';
}

function normalizeModelId(modelId: string | undefined): string {
  return (modelId ?? '').trim().toLowerCase();
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatUsd(value: number): string {
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }

  return `$${value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
}
