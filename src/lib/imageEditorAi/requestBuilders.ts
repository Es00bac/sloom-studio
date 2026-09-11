import type { AspectRatio, ImageOutputFormat } from '../../types/flow';
import { mapAspectRatioToImageDimensions } from '../providerCatalog';
import {
  estimateImageModelCostUsd,
  getImageModelCapabilities,
  getImageModelDefinition,
  type ImageModelOperation,
} from '../imageProviderCapabilities';

export interface BflFlux2RequestInput {
  modelId: string;
  prompt: string;
  sourceImage?: string;
  referenceImages?: string[];
  aspectRatio?: AspectRatio;
  outputFormat?: ImageOutputFormat;
  seed?: number;
  operation: Extract<ImageModelOperation, 'text-to-image' | 'image-edit'>;
}

export interface BflFlux2Request {
  endpoint: string;
  body: Record<string, unknown>;
  estimatedCostUsd?: number;
}

export interface StabilityEditRequestInput {
  operation: Extract<
    ImageModelOperation,
    | 'mask-inpaint'
    | 'outpaint'
    | 'erase'
    | 'search-replace'
    | 'search-recolor'
    | 'remove-background'
    | 'replace-background-relight'
  >;
  prompt?: string;
  searchPrompt?: string;
  outputFormat: ImageOutputFormat;
  outpaint?: {
    left: number;
    right: number;
    up: number;
    down: number;
    creativity?: number;
  };
}

export interface StabilityEditRequest {
  endpoint: string;
  fields: Record<string, string | number>;
  estimatedCostUsd?: number;
  /** Form field name the source image must be appended under (`subject_image` for replace-background-relight). */
  imageFieldName: 'image' | 'subject_image';
  /** True when the endpoint is asynchronous: it returns `{id}` and the result must be polled at /v2beta/results/{id}. */
  async: boolean;
}

export interface StabilityGenerationRequestInput {
  modelId: string;
  prompt: string;
  aspectRatio: AspectRatio;
  outputFormat: ImageOutputFormat;
}

export interface StabilityGenerationRequest {
  endpoint: string;
  fields: Record<string, string | number>;
  estimatedCostUsd?: number;
}

export interface StabilityUpscaleRequestInput {
  mode: 'fast' | 'conservative';
  outputFormat: ImageOutputFormat;
  prompt?: string;
  creativity?: number;
}

export interface StabilityUpscaleRequest {
  endpoint: string;
  fields: Record<string, string | number>;
  estimatedCostUsd?: number;
}

export interface LocalOpenImageEditRequestInput {
  model: string;
  prompt: string;
  image: string;
  mask?: string;
  referenceImages?: string[];
  outputFormat: ImageOutputFormat;
}

export interface LocalOpenImageEditRequest {
  model: string;
  prompt: string;
  image: string;
  mask?: string;
  referenceImages: string[];
  outputFormat: ImageOutputFormat;
}

const BFL_BASE_URL = 'https://api.bfl.ai/v1';

const STABILITY_EDIT_ENDPOINTS: Record<StabilityEditRequestInput['operation'], string> = {
  'mask-inpaint': 'https://api.stability.ai/v2beta/stable-image/edit/inpaint',
  outpaint: 'https://api.stability.ai/v2beta/stable-image/edit/outpaint',
  erase: 'https://api.stability.ai/v2beta/stable-image/edit/erase',
  'search-replace': 'https://api.stability.ai/v2beta/stable-image/edit/search-and-replace',
  'search-recolor': 'https://api.stability.ai/v2beta/stable-image/edit/search-and-recolor',
  'remove-background': 'https://api.stability.ai/v2beta/stable-image/edit/remove-background',
  'replace-background-relight': 'https://api.stability.ai/v2beta/stable-image/edit/replace-background-and-relight',
};

const STABILITY_GENERATE_ENDPOINTS: Record<string, string> = {
  'stable-image-core': 'https://api.stability.ai/v2beta/stable-image/generate/core',
  'stable-image-ultra': 'https://api.stability.ai/v2beta/stable-image/generate/ultra',
};

const STABILITY_UPSCALE_ENDPOINTS: Record<StabilityUpscaleRequestInput['mode'], string> = {
  fast: 'https://api.stability.ai/v2beta/stable-image/upscale/fast',
  conservative: 'https://api.stability.ai/v2beta/stable-image/upscale/conservative',
};

const STABILITY_UPSCALE_MODEL_IDS: Record<StabilityUpscaleRequestInput['mode'], string> = {
  fast: 'stable-image-upscale-fast',
  conservative: 'stable-image-upscale-conservative',
};

export function buildBflFlux2Request(input: BflFlux2RequestInput): BflFlux2Request {
  const model = getImageModelDefinition('bfl', input.modelId);
  const capabilities = getImageModelCapabilities('bfl', input.modelId);
  const referenceImages = input.referenceImages ?? [];

  if (referenceImages.length > capabilities.maxReferenceImages) {
    throw new Error(`${model.label} supports at most ${capabilities.maxReferenceImages} reference images via API.`);
  }

  const body: Record<string, unknown> = {
    prompt: input.prompt,
  };

  if (input.aspectRatio) {
    const dimensions = mapAspectRatioToImageDimensions(input.aspectRatio);
    body.width = dimensions.width;
    body.height = dimensions.height;
  }

  if (input.outputFormat) {
    body.output_format = input.outputFormat;
  }

  if (Number.isInteger(input.seed) && input.seed !== undefined) {
    body.seed = input.seed;
  }

  if (input.sourceImage) {
    body.input_image = input.sourceImage;
  }

  referenceImages.forEach((referenceImage, index) => {
    const imageIndex = input.sourceImage ? index + 2 : index + 1;
    body[`input_image${imageIndex === 1 ? '' : `_${imageIndex}`}`] = referenceImage;
  });

  const estimate = estimateImageModelCostUsd({
    providerId: 'bfl',
    modelId: model.modelId,
    operation: input.operation,
    imageCount: 1,
  });

  return {
    endpoint: `${BFL_BASE_URL}/${model.modelId}`,
    body,
    estimatedCostUsd: estimate.costUsd,
  };
}

export function buildStabilityGenerationRequest(
  input: StabilityGenerationRequestInput,
): StabilityGenerationRequest {
  const model = getImageModelDefinition('stability', input.modelId);
  const endpoint = STABILITY_GENERATE_ENDPOINTS[model.modelId];

  if (!endpoint) {
    throw new Error(`${model.label} is not a Stability text-to-image generation model.`);
  }

  const fields: Record<string, string | number> = {
    prompt: input.prompt,
    aspect_ratio: input.aspectRatio,
    output_format: input.outputFormat,
  };
  const estimate = estimateImageModelCostUsd({
    providerId: 'stability',
    modelId: model.modelId,
    operation: 'text-to-image',
    imageCount: 1,
  });

  return {
    endpoint,
    fields,
    estimatedCostUsd: estimate.costUsd,
  };
}

export function buildStabilityEditRequest(input: StabilityEditRequestInput): StabilityEditRequest {
  const fields: Record<string, string | number> = {
    output_format: input.outputFormat,
  };

  if (input.prompt?.trim()) {
    // Replace Background & Relight has no generic `prompt` field — the text prompt describes the NEW
    // background and must be sent as `background_prompt` (the API rejects/ignores `prompt`).
    // Erase is prompt-less by design (image + mask only), so an upstream prompt must not ride along.
    if (input.operation === 'replace-background-relight') {
      fields.background_prompt = input.prompt.trim();
    } else if (input.operation !== 'erase') {
      fields.prompt = input.prompt.trim();
    }
  }

  if (input.searchPrompt?.trim()) {
    // Search & Replace names the selection field `search_prompt`; Search & Recolor names it
    // `select_prompt` — sending the wrong one is a 400 (select_prompt is required for recolor).
    if (input.operation === 'search-recolor') {
      fields.select_prompt = input.searchPrompt.trim();
    } else {
      fields.search_prompt = input.searchPrompt.trim();
    }
  }

  if (input.outpaint) {
    fields.left = Math.max(0, Math.round(input.outpaint.left));
    fields.right = Math.max(0, Math.round(input.outpaint.right));
    fields.up = Math.max(0, Math.round(input.outpaint.up));
    fields.down = Math.max(0, Math.round(input.outpaint.down));

    if (input.outpaint.creativity !== undefined) {
      fields.creativity = input.outpaint.creativity;
    }
  }

  const modelId = stabilityModelIdForOperation(input.operation);
  const estimate = estimateImageModelCostUsd({
    providerId: 'stability',
    modelId,
    operation: input.operation,
    imageCount: 1,
  });

  return {
    endpoint: STABILITY_EDIT_ENDPOINTS[input.operation],
    fields,
    estimatedCostUsd: estimate.costUsd,
    // Replace Background & Relight is Stability's one ASYNC edit endpoint: the source rides as
    // `subject_image` and the response is `{id}` to poll at /v2beta/results/{id} — treating it as a
    // synchronous `image` upload (the old behavior) breaks the operation twice over.
    imageFieldName: input.operation === 'replace-background-relight' ? 'subject_image' : 'image',
    async: input.operation === 'replace-background-relight',
  };
}

export function buildStabilityUpscaleRequest(input: StabilityUpscaleRequestInput): StabilityUpscaleRequest {
  const fields: Record<string, string | number> = {
    output_format: input.outputFormat,
  };

  if (input.mode === 'conservative') {
    if (input.prompt?.trim()) {
      fields.prompt = input.prompt.trim();
    }

    if (input.creativity !== undefined) {
      fields.creativity = input.creativity;
    }
  }

  const modelId = STABILITY_UPSCALE_MODEL_IDS[input.mode];
  const estimate = estimateImageModelCostUsd({
    providerId: 'stability',
    modelId,
    operation: 'upscale',
    imageCount: 1,
  });

  return {
    endpoint: STABILITY_UPSCALE_ENDPOINTS[input.mode],
    fields,
    estimatedCostUsd: estimate.costUsd,
  };
}

export function buildLocalOpenImageEditRequest(
  input: LocalOpenImageEditRequestInput,
): LocalOpenImageEditRequest {
  return {
    model: input.model,
    prompt: input.prompt,
    image: input.image,
    mask: input.mask,
    referenceImages: input.referenceImages ?? [],
    outputFormat: input.outputFormat,
  };
}

function stabilityModelIdForOperation(operation: StabilityEditRequestInput['operation']): string {
  switch (operation) {
    case 'mask-inpaint':
      return 'stable-image-edit-inpaint';
    case 'erase':
      return 'stable-image-edit-erase';
    case 'outpaint':
      return 'stable-image-edit-outpaint';
    case 'search-replace':
      return 'stable-image-edit-search-replace';
    case 'search-recolor':
      return 'stable-image-edit-search-recolor';
    case 'remove-background':
      return 'stable-image-edit-remove-background';
    case 'replace-background-relight':
      return 'stable-image-edit-replace-background-relight';
  }
}
