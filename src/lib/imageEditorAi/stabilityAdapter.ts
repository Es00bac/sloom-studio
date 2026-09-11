import { useSettingsStore } from '../../store/settingsStore';
import type { GenerativeFillRequest, GenerativeFillResult } from '../imageEditorAi';
import { blobToFile, readBinaryImageResponseBlob } from './blobUtils';
import {
  buildStabilityEditRequest,
  type StabilityEditRequestInput,
} from './requestBuilders';
import {
  extractStabilityGenerationId,
  fetchStabilityAsyncResultBlob,
} from './stabilityAsyncResult';

export async function runStabilityInpaint(
  request: GenerativeFillRequest,
): Promise<GenerativeFillResult> {
  const apiKey = useSettingsStore.getState().apiKeys.stability;
  if (!apiKey) {
    throw new Error('Stability AI API key not configured. Set it in Settings -> API Keys.');
  }

  const operation = stabilityOperationForRequest(request);
  const built = buildStabilityEditRequest({
    operation,
    prompt: request.prompt,
    searchPrompt: request.searchPrompt,
    outpaint: operation === 'outpaint' ? request.outpaint : undefined,
    outputFormat: 'png',
  });
  const formData = new FormData();
  formData.append(built.imageFieldName, await blobToFile(request.source, 'source.png'));
  if (operation === 'mask-inpaint' || operation === 'erase') {
    const { normalizeMaskBlobForProvider } = await import('../imageMask/maskConventions');
    const normalizedMask = await normalizeMaskBlobForProvider(request.mask, { provider: 'stability', modelId: request.model });
    formData.append('mask', await blobToFile(normalizedMask, 'mask.png'));
  }

  Object.entries(built.fields).forEach(([key, value]) => {
    formData.append(key, String(value));
  });

  const response = await fetch(built.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: built.async ? 'application/json' : 'image/*',
    },
    body: formData,
    signal: request.abortSignal,
  });

  if (!response.ok) {
    throw new Error(`Stability AI inpaint failed (${response.status}): ${await response.text()}`);
  }

  // Replace Background & Relight is async: the POST returns `{id}` and the finished image is polled
  // from /v2beta/results/{id}; every other edit endpoint answers with the image bytes directly.
  const resultBlob = built.async
    ? await (async () => {
        const generationId = extractStabilityGenerationId(await response.json());
        if (!generationId) {
          throw new Error('Stability AI did not return an async generation ID for this edit.');
        }
        return fetchStabilityAsyncResultBlob({
          apiKey,
          generationId,
          signal: request.abortSignal,
        });
      })()
    : await readBinaryImageResponseBlob(response);

  return {
    png: resultBlob,
    modelUsed: request.model ?? stabilityModelForOperation(operation),
    approximateCostUsd: built.estimatedCostUsd,
  };
}

function stabilityOperationForRequest(
  request: GenerativeFillRequest,
): StabilityEditRequestInput['operation'] {
  switch (request.operation) {
    case 'erase':
      return 'erase';
    case 'outpaint':
      return 'outpaint';
    case 'searchReplace':
      return 'search-replace';
    case 'searchRecolor':
      return 'search-recolor';
    case 'removeBackground':
      return 'remove-background';
    case 'replaceBackground':
    case 'relight':
      return 'replace-background-relight';
    case 'inpaint':
    case 'editImage':
    case 'upscale':
    case 'resizeImage':
    case 'resizeCanvas':
    case undefined:
      return 'mask-inpaint';
  }
}

function stabilityModelForOperation(operation: StabilityEditRequestInput['operation']): string {
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
