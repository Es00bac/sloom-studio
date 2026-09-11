import {
  estimateImageModelCostUsd,
  getImageModelDefinition,
  type FirstClassImageProviderId,
  type ImageModelCostEstimate,
  type ImageModelOperation,
} from './imageProviderCapabilities';

export type ImageEditorOperationId =
  | 'inpaint'
  | 'editImage'
  | 'outpaint'
  | 'searchReplace'
  | 'searchRecolor'
  | 'erase'
  | 'removeBackground'
  | 'replaceBackground'
  | 'relight'
  | 'upscale'
  | 'resizeImage'
  | 'resizeCanvas';

export type ImageEditorProviderId = FirstClassImageProviderId | 'generic';

export interface ImageEditorOperationDefinition {
  id: ImageEditorOperationId;
  label: string;
  description: string;
  providerOperation?: ImageModelOperation;
  localOnly: boolean;
  requiresSourceLayer: boolean;
  requiresSelection: boolean;
  supportsPrompt: boolean;
  supportsSearchPrompt: boolean;
  supportsReferenceImages: boolean;
}

export interface ImageEditorRunCheckInput {
  operationId: ImageEditorOperationId;
  providerId: ImageEditorProviderId;
  modelId?: string;
  hasActiveLayer: boolean;
  hasSelection: boolean;
}

export type ImageEditorRunCheck =
  | { ok: true }
  | { ok: false; reason: string };

const LOCAL_COST_ESTIMATE: ImageModelCostEstimate = {
  costUsd: 0,
  confidence: 'published-fixed',
  unitLabel: 'local',
  notes: ['Runs inside the editor without a paid model call.'],
};

const GENERIC_COST_ESTIMATE: ImageModelCostEstimate = {
  costUsd: undefined,
  confidence: 'provider-defined',
  unitLabel: 'provider-defined',
  notes: ['Generic HTTP costs depend on the configured endpoint.'],
};

const OPERATION_DEFINITIONS: ImageEditorOperationDefinition[] = [
  {
    id: 'inpaint',
    label: 'Inpaint',
    description: 'Regenerate the selected or masked region while preserving the rest of the image.',
    providerOperation: 'mask-inpaint',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: true,
    supportsPrompt: true,
    supportsSearchPrompt: false,
    supportsReferenceImages: true,
  },
  {
    id: 'editImage',
    label: 'Edit (whole image)',
    description: 'Edit the entire image from a prompt and optional references. This model has no mask support, so it does not preserve an unselected region — use a true Inpaint model for localized fills.',
    providerOperation: 'image-edit',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: false,
    supportsPrompt: true,
    supportsSearchPrompt: false,
    supportsReferenceImages: true,
  },
  {
    id: 'erase',
    label: 'Erase',
    description: 'Erase content inside the selected area and redraw nearby structure.',
    providerOperation: 'erase',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: true,
    supportsPrompt: false,
    supportsSearchPrompt: false,
    supportsReferenceImages: false,
  },
  {
    id: 'outpaint',
    label: 'Outpaint',
    description: 'Extend an image beyond its current canvas edges.',
    providerOperation: 'outpaint',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: false,
    supportsPrompt: true,
    supportsSearchPrompt: false,
    supportsReferenceImages: true,
  },
  {
    id: 'searchReplace',
    label: 'Search Replace',
    description: 'Find a described object or region and replace it from the prompt.',
    providerOperation: 'search-replace',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: false,
    supportsPrompt: true,
    supportsSearchPrompt: true,
    supportsReferenceImages: false,
  },
  {
    id: 'searchRecolor',
    label: 'Search Recolor',
    description: 'Find a described object or region and recolor it precisely.',
    providerOperation: 'search-recolor',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: false,
    supportsPrompt: true,
    supportsSearchPrompt: true,
    supportsReferenceImages: false,
  },
  {
    id: 'removeBackground',
    label: 'Remove Background',
    description: 'Separate the foreground from the background.',
    providerOperation: 'remove-background',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: false,
    supportsPrompt: false,
    supportsSearchPrompt: false,
    supportsReferenceImages: false,
  },
  {
    id: 'replaceBackground',
    label: 'Replace Background',
    description: 'Replace the background and preserve foreground lighting context.',
    providerOperation: 'replace-background-relight',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: false,
    supportsPrompt: true,
    supportsSearchPrompt: false,
    supportsReferenceImages: true,
  },
  {
    id: 'relight',
    label: 'Relight',
    description: 'Adjust the image lighting through a relight-capable provider edit.',
    providerOperation: 'replace-background-relight',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: false,
    supportsPrompt: true,
    supportsSearchPrompt: false,
    supportsReferenceImages: true,
  },
  {
    id: 'upscale',
    label: 'Upscale',
    description: 'Increase output resolution through a provider upscaler when available.',
    providerOperation: 'upscale',
    localOnly: false,
    requiresSourceLayer: true,
    requiresSelection: false,
    supportsPrompt: false,
    supportsSearchPrompt: false,
    supportsReferenceImages: false,
  },
  {
    id: 'resizeImage',
    label: 'Resize Image',
    description: 'Resample the full document and all layer pixels to a new size.',
    localOnly: true,
    requiresSourceLayer: false,
    requiresSelection: false,
    supportsPrompt: false,
    supportsSearchPrompt: false,
    supportsReferenceImages: false,
  },
  {
    id: 'resizeCanvas',
    label: 'Resize Canvas',
    description: 'Change the document canvas while preserving layer pixels.',
    localOnly: true,
    requiresSourceLayer: false,
    requiresSelection: false,
    supportsPrompt: false,
    supportsSearchPrompt: false,
    supportsReferenceImages: false,
  },
];

const OPERATION_BY_ID = new Map(OPERATION_DEFINITIONS.map((operation) => [operation.id, operation]));

export function listImageEditorOperationDefinitions(): ImageEditorOperationDefinition[] {
  return OPERATION_DEFINITIONS.map(cloneOperationDefinition);
}

export function getImageEditorOperationDefinition(
  id: ImageEditorOperationId,
): ImageEditorOperationDefinition {
  const definition = OPERATION_BY_ID.get(id);
  if (!definition) {
    throw new Error(`Unknown image editor operation: ${id}`);
  }
  return cloneOperationDefinition(definition);
}

export function getImageEditorOperationsForModel(
  providerId: ImageEditorProviderId,
  modelId?: string,
): ImageEditorOperationDefinition[] {
  return OPERATION_DEFINITIONS.filter((operation) =>
    isOperationAvailableForModel(operation, providerId, modelId),
  ).map(cloneOperationDefinition);
}

export function canRunImageEditorOperation(input: ImageEditorRunCheckInput): ImageEditorRunCheck {
  const definition = getImageEditorOperationDefinition(input.operationId);

  if (!isOperationAvailableForModel(definition, input.providerId, input.modelId)) {
    return {
      ok: false,
      reason: `${definition.label} is not supported by the selected model.`,
    };
  }

  if (definition.requiresSourceLayer && !input.hasActiveLayer) {
    return {
      ok: false,
      reason: `Select a source layer before running ${definition.label}.`,
    };
  }

  if (definition.requiresSelection && !input.hasSelection) {
    return {
      ok: false,
      reason: `Select or mask an area before running ${definition.label}.`,
    };
  }

  return { ok: true };
}

export function estimateImageEditorOperationCostUsd(input: {
  operationId: ImageEditorOperationId;
  providerId: ImageEditorProviderId;
  modelId?: string;
}): ImageModelCostEstimate {
  const definition = getImageEditorOperationDefinition(input.operationId);
  if (definition.localOnly) {
    return { ...LOCAL_COST_ESTIMATE, notes: [...LOCAL_COST_ESTIMATE.notes] };
  }

  if (input.providerId === 'generic') {
    return { ...GENERIC_COST_ESTIMATE, notes: [...GENERIC_COST_ESTIMATE.notes] };
  }

  const providerOperation = resolveProviderOperationForModel(
    definition,
    input.providerId,
    input.modelId,
  );

  if (!providerOperation) {
    return { ...LOCAL_COST_ESTIMATE, notes: [...LOCAL_COST_ESTIMATE.notes] };
  }
  const model = getImageModelDefinition(input.providerId, input.modelId);

  return estimateImageModelCostUsd({
    providerId: input.providerId,
    modelId: model.modelId,
    operation: providerOperation,
    imageCount: 1,
  });
}

function isOperationAvailableForModel(
  operation: ImageEditorOperationDefinition,
  providerId: ImageEditorProviderId,
  modelId?: string,
): boolean {
  if (operation.localOnly) return true;

  if (providerId === 'generic') {
    return operation.id === 'inpaint';
  }

  return Boolean(resolveProviderOperationForModel(operation, providerId, modelId));
}

function resolveProviderOperationForModel(
  operation: ImageEditorOperationDefinition,
  providerId: ImageEditorProviderId,
  modelId?: string,
): ImageModelOperation | null {
  if (operation.localOnly || providerId === 'generic') return null;
  const model = getImageModelDefinition(providerId, modelId);

  if (operation.providerOperation && model.supportedOperations.includes(operation.providerOperation)) {
    return operation.providerOperation;
  }

  // Inpaint intentionally has NO fallback: only models that truly honour a mask ('mask-inpaint') may
  // offer it. Edit-capable models without a mask surface the honest 'Edit (whole image)' operation
  // instead, so the user never paints a mask that the model silently ignores.
  return null;
}

function cloneOperationDefinition(
  definition: ImageEditorOperationDefinition,
): ImageEditorOperationDefinition {
  return { ...definition };
}
