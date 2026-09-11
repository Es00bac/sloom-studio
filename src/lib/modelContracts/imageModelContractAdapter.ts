import type { SelectOption } from '../../types/flow';
import {
  listImageModelDefinitions,
  type FirstClassImageProviderId,
  type ImageModelDefinition,
  type ImageModelOperation,
  type ImageNodeVisibleControl,
} from '../imageProviderCapabilities';
import { getImageAspectRatioOptions } from '../providerCatalog';
import {
  defineProviderModelContracts,
  type ApiFamily,
  type ModelAuthContract,
  type ModelOperation,
  type ModelParameterContract,
  type ModelRequestBuilderFamily,
  type ProviderModelContract,
} from '../providerModelContracts';

const OUTPUT_FORMATS: SelectOption[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
];

const QUALITY_OPTIONS: SelectOption[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const GEMINI_IMAGE_SIZES: SelectOption[] = [
  { value: '0.5K', label: '0.5K' },
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

const PROVIDER_NAMES: Record<FirstClassImageProviderId, string> = {
  gemini: 'Google Gemini / Vertex AI',
  openai: 'OpenAI',
  atlas: 'Atlas Cloud',
  byteplus: 'BytePlus ModelArk',
  huggingface: 'Hugging Face Inference Providers',
  bfl: 'Black Forest Labs',
  stability: 'Stability AI',
  localOpen: 'Local / Open Models',
  android: 'Android Accelerator',
};

const PROVIDER_API_FAMILIES: Record<FirstClassImageProviderId, ApiFamily> = {
  gemini: 'google-gemini',
  openai: 'openai-images',
  atlas: 'atlas',
  byteplus: 'byteplus-modelark',
  huggingface: 'huggingface-inference',
  bfl: 'bfl',
  stability: 'stability',
  localOpen: 'local-open',
  android: 'android-accelerator',
};

const PROVIDER_AUTH: Record<FirstClassImageProviderId, ModelAuthContract> = {
  gemini: {
    type: 'api-key-or-vertex-adc',
    credentialKey: 'gemini',
    notes: 'Gemini image models accept a Gemini API key; Vertex routes use the in-app ADC broker.',
  },
  openai: { type: 'api-key', credentialKey: 'openai' },
  atlas: { type: 'api-key', credentialKey: 'atlas' },
  byteplus: { type: 'bearer', credentialKey: 'byteplus' },
  huggingface: { type: 'bearer', credentialKey: 'huggingface' },
  bfl: { type: 'api-key', credentialKey: 'bfl' },
  stability: { type: 'bearer', credentialKey: 'stability' },
  localOpen: { type: 'none', notes: 'An optional endpoint-specific Authorization header may be configured.' },
  android: { type: 'none', notes: 'Uses the paired Android companion URL and pairing token.' },
};

const PROMPTLESS_OPERATIONS: readonly ModelOperation[] = [
  'image-upscale',
  'erase',
  'remove-background',
];

function mapOperation(operation: ImageModelOperation): ModelOperation {
  return operation === 'upscale' ? 'image-upscale' : operation;
}

function endpointFor(definition: ImageModelDefinition): string {
  const { providerId, modelId } = definition;
  switch (providerId) {
    case 'gemini':
      return modelId.startsWith('imagen-')
        ? `Vertex publishers/google/models/${modelId}:predict`
        : `models/${modelId}:generateContent or Vertex publishers/google/models/${modelId}:generateContent`;
    case 'openai':
      return '/v1/images/generations or /v1/images/edits';
    case 'atlas':
      return `POST /api/v1/model/${modelId}`;
    case 'byteplus':
      return 'POST /api/v3/images/generations';
    case 'huggingface':
      return `Inference Providers text-to-image task for ${modelId}`;
    case 'bfl':
      return `POST /v1/${modelId}`;
    case 'stability':
      return stabilityEndpoint(modelId);
    case 'localOpen':
      return 'Configured local/open image endpoint';
    case 'android':
      return 'Configured Android Accelerator /generate endpoint';
  }
}

function stabilityEndpoint(modelId: string): string {
  const suffix = modelId
    .replace('stable-image-edit-', 'edit/')
    .replace('replace-background-relight', 'replace-background-and-relight')
    .replace('stable-image-upscale-', 'upscale/')
    .replace('stable-image-', 'generate/');
  return `/v2beta/stable-image/${suffix}`;
}

function controlParameter(
  definition: ImageModelDefinition,
  control: ImageNodeVisibleControl,
): ModelParameterContract {
  const operations = definition.supportedOperations.map(mapOperation);
  const providerId = definition.providerId;
  const promptOperations = operations.filter((operation) => !PROMPTLESS_OPERATIONS.includes(operation));

  switch (control) {
    case 'prompt':
      return {
        id: control,
        apiName: promptApiName(definition),
        label: 'Prompt',
        type: providerId === 'gemini' && !definition.modelId.startsWith('imagen-') ? 'array' : 'string',
        required: promptOperations.length === operations.length,
        conditions: promptOperations.length === operations.length ? undefined : { operations: promptOperations },
      };
    case 'negativePrompt':
      return stringParameter(control, 'negative_prompt', 'Negative prompt');
    case 'aspectRatio': {
      const options = getImageAspectRatioOptions(providerId, definition.modelId);
      return {
        id: control,
        apiName: providerId === 'openai' ? 'size' : 'aspect_ratio',
        label: 'Aspect ratio',
        type: options.length > 0 ? 'enum' : 'string',
        options: options.length > 0 ? options : undefined,
      };
    }
    case 'steps':
      return numberParameter(control, providerId === 'huggingface' ? 'num_inference_steps' : 'steps', 'Inference steps', 1, 150, true);
    case 'seed':
      return numberParameter(control, 'seed', 'Seed', 0, 2_147_483_647, true);
    case 'sourceImage':
      return {
        id: control,
        apiName: sourceImageApiName(definition),
        label: 'Source image',
        type: 'string',
        required: !operations.includes('text-to-image'),
        conditions: { operations: operations.filter((operation) => operation !== 'text-to-image') },
      };
    case 'mask':
      return {
        id: control,
        apiName: 'mask',
        label: 'Mask image',
        type: 'string',
        required: true,
        conditions: { operations: ['mask-inpaint', 'erase'] },
      };
    case 'referenceImages':
      return {
        id: control,
        apiName: referenceImagesApiName(definition),
        label: 'Reference images',
        type: 'array',
        maxItems: definition.capabilities.maxReferenceImages,
      };
    case 'searchPrompt':
      return stringParameter(control, 'search_prompt', 'Search prompt', true);
    case 'outpaintMargins':
      return { id: control, apiName: 'left/right/up/down', label: 'Outpaint margins', type: 'object' };
    case 'creativity':
      return numberParameter(control, 'creativity', 'Creativity', 0, 1);
    case 'outputFormat':
      return {
        id: control,
        apiName: outputFormatApiName(definition),
        label: 'Output format',
        type: 'enum',
        options: OUTPUT_FORMATS,
      };
    case 'localEndpoint':
      return stringParameter(control, 'endpoint', 'Endpoint URL', true);
    case 'exactColorPrompt':
      return stringParameter(control, 'prompt_upsampling/color_prompt', 'Exact color instruction');
    case 'textEditPrompt':
      return stringParameter(control, 'text_edit_prompt', 'Text edit instruction');
    case 'guidanceScale':
      return numberParameter(control, 'guidance_scale', 'Guidance scale', 0, 30);
    case 'editStrength':
      return numberParameter(control, 'strength', 'Edit strength', 0, 1);
    case 'loraWeights':
      return { id: control, apiName: 'loras', label: 'LoRA weights', type: 'array' };
    case 'safetyChecker':
      return { id: control, apiName: 'enable_safety_checker', label: 'Safety checker', type: 'boolean' };
    case 'dimensions':
      return stringParameter(control, 'size', 'Output dimensions');
    case 'quality':
      return { id: control, apiName: 'quality', label: 'Quality', type: 'enum', options: QUALITY_OPTIONS };
    case 'imageSize':
      return {
        id: control,
        apiName: 'generationConfig.imageConfig.imageSize',
        label: 'Image size',
        type: 'enum',
        options: definition.modelId === 'gemini-3.1-flash-lite-image'
          ? GEMINI_IMAGE_SIZES.filter((option) => option.value === '1K')
          : GEMINI_IMAGE_SIZES,
      };
  }
}

function stringParameter(
  id: ImageNodeVisibleControl,
  apiName: string,
  label: string,
  required = false,
): ModelParameterContract {
  return { id, apiName, label, type: 'string', required };
}

function numberParameter(
  id: ImageNodeVisibleControl,
  apiName: string,
  label: string,
  min: number,
  max: number,
  integer = false,
): ModelParameterContract {
  return { id, apiName, label, type: integer ? 'integer' : 'number', min, max };
}

function promptApiName(definition: ImageModelDefinition): string {
  if (definition.providerId === 'gemini') {
    return definition.modelId.startsWith('imagen-')
      ? 'instances[].prompt'
      : 'contents[].parts[].text';
  }
  if (definition.providerId === 'huggingface') return 'inputs';
  return 'prompt';
}

function sourceImageApiName(definition: ImageModelDefinition): string {
  switch (definition.providerId) {
    case 'gemini': return 'contents[1].parts[0].inlineData';
    case 'openai': return 'image[0]';
    case 'bfl': return 'input_image';
    case 'stability': return definition.modelId.includes('replace-background') ? 'subject_image' : 'image';
    case 'atlas': return 'image';
    case 'byteplus': return 'image';
    case 'huggingface': return 'image';
    case 'localOpen': return 'image';
    case 'android': return 'image';
  }
}

function referenceImagesApiName(definition: ImageModelDefinition): string {
  switch (definition.providerId) {
    case 'gemini': return 'contents[2+].parts[0].inlineData';
    case 'openai': return 'image[1+]';
    case 'bfl': return 'input_image_2...input_image_8';
    case 'atlas': return 'images';
    case 'byteplus': return 'images';
    case 'huggingface': return 'images';
    case 'stability': return 'images';
    case 'localOpen': return 'referenceImages';
    case 'android': return 'referenceImages';
  }
}

function outputFormatApiName(definition: ImageModelDefinition): string {
  if (definition.providerId === 'gemini') {
    return definition.modelId.startsWith('imagen-')
      ? 'parameters.outputOptions.mimeType'
      : 'generationConfig.imageConfig.outputMimeType';
  }
  return 'output_format';
}

function limitationsFor(definition: ImageModelDefinition): string[] {
  const limitations: string[] = [];
  if (definition.lifecycle === 'preview') {
    limitations.push('Preview behavior, availability, and model identifiers can change.');
  } else if (definition.lifecycle === 'deprecated') {
    limitations.push(`Deprecated model; migrate to ${definition.migrationModelId ?? 'a supported replacement'}.`);
  } else if (definition.lifecycle === 'shutdown') {
    limitations.push(`Provider shut this model down${definition.shutdownAt ? ` on ${definition.shutdownAt}` : ''}; it is retained only for saved-flow diagnostics.`);
  } else if (definition.lifecycle === 'unverified') {
    limitations.push('Capabilities depend on the configured endpoint and are not inferred from the model name.');
  }
  if (definition.capabilities.referenceImages) {
    limitations.push(`Accepts at most ${definition.capabilities.maxReferenceImages} reference images on this route.`);
  }
  if (definition.availability === 'account-dependent') {
    limitations.push('Model availability and price depend on the connected account or routed provider.');
  }
  return limitations;
}

function toContract(definition: ImageModelDefinition): ProviderModelContract {
  const apiFamily = PROVIDER_API_FAMILIES[definition.providerId];
  const operations = definition.supportedOperations.map(mapOperation);
  const acceptsImage = definition.capabilities.imageToImage || definition.capabilities.referenceImages;
  return {
    providerId: definition.providerId,
    providerName: PROVIDER_NAMES[definition.providerId],
    modelId: definition.modelId,
    displayName: definition.label,
    apiFamily,
    endpoint: endpointFor(definition),
    auth: PROVIDER_AUTH[definition.providerId],
    inputModalities: acceptsImage ? ['text', 'image'] : ['text'],
    outputModalities: ['image'],
    operations,
    parameters: definition.visibleControls.map((control) => controlParameter(definition, control)),
    lifecycle: definition.lifecycle ?? 'unverified',
    availability: definition.availability ?? 'account-dependent',
    evidence: definition.evidence ?? [],
    limitations: limitationsFor(definition),
    recommendedUse: definition.recommendedUse,
    flowExample: {
      summary: `${acceptsImage ? 'Prompt and optional image inputs' : 'Prompt'} -> ${definition.label} -> image`,
      inputs: acceptsImage
        ? ['Connect text to Prompt and compatible image outputs to Source or Reference Image handles.']
        : ['Connect a Text or prompt-building node to Prompt.'],
      outputs: ['Connect the image output to Image Edit, Video, Composition, or File Output nodes.'],
    },
    requestBuilder: apiFamily as ModelRequestBuilderFamily,
    migrationModelId: definition.migrationModelId,
    shutdownAt: definition.shutdownAt,
  };
}

export const IMAGE_MODEL_CONTRACTS = defineProviderModelContracts(
  listImageModelDefinitions().map(toContract),
);
