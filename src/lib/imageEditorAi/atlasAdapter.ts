import { useSettingsStore } from '../../store/settingsStore';
import type { GenerativeFillRequest, GenerativeFillResult } from '../imageEditorAi';
import { blobToFile, resolveReferenceImageInput } from './blobUtils';
import {
  isAtlasNativeImageModelId,
  normalizeAtlasBaseUrl,
  runAtlasNativeGenerativeFill,
} from './atlasNativeImage';

const DEFAULT_MODEL = 'gpt-image-2';

export async function runAtlasInpaint(
  request: GenerativeFillRequest,
): Promise<GenerativeFillResult> {
  const apiKey = useSettingsStore.getState().apiKeys.atlas?.trim();
  if (!apiKey) {
    throw new Error('Atlas API key not configured. Set it in Settings → API Keys.');
  }

  // Default to the native Atlas API so the Atlas key is never sent to api.openai.com.
  const baseUrl = normalizeAtlasBaseUrl(useSettingsStore.getState().providerSettings.atlasBaseUrl);
  const model = request.model ?? DEFAULT_MODEL;

  const { normalizeMaskBlobForProvider } = await import('../imageMask/maskConventions');
  const normalizedMask = await normalizeMaskBlobForProvider(request.mask, { provider: 'atlas', modelId: model });

  // Native Atlas models (FLUX, Nano Banana, Seedream, Qwen, …) use Atlas's own
  // /model/generateImage endpoint — not OpenAI's images.edit.
  if (isAtlasNativeImageModelId(model)) {
    const png = await runAtlasNativeGenerativeFill({
      apiKey,
      baseUrl,
      modelId: model,
      prompt: request.prompt,
      source: request.source,
      mask: normalizedMask,
      references: request.references,
      signal: request.abortSignal,
    });
    return { png, modelUsed: model };
  }

  // OpenAI-compatible Atlas route (e.g. gpt-image-*): pointed at the Atlas base URL.
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    dangerouslyAllowBrowser: true,
  });

  const sourceFile = await blobToFile(request.source, 'source.png');
  const maskFile = await blobToFile(normalizedMask, 'mask.png');
  // gpt-image edits accept multiple input images — resolve browser-local reference URLs to bytes
  // in-app (the server can't fetch blob:/signal-loom-asset:// URLs) and ride them after the source.
  const referenceFiles = (await Promise.all((request.references ?? []).map(async (reference, index) => {
    const resolved = await resolveReferenceImageInput(reference, { fetchHttp: true, signal: request.abortSignal });
    if (!resolved || !('blob' in resolved)) return null;
    return blobToFile(resolved.blob, `reference-${index + 1}.png`);
  }))).filter((file): file is File => Boolean(file));

  const response = await client.images.edit(
    {
      model,
      image: referenceFiles.length > 0 ? [sourceFile, ...referenceFiles] : sourceFile,
      ...(request.mask ? { mask: maskFile } : {}),
      prompt: request.prompt,
    },
    {
      signal: request.abortSignal,
    },
  );

  const image = response.data?.[0];
  if (image?.b64_json) {
    const bytes = Uint8Array.from(atob(image.b64_json), (c) => c.charCodeAt(0));
    return {
      png: new Blob([bytes as BlobPart], { type: 'image/png' }),
      modelUsed: model,
    };
  }
  if (image?.url) {
    const fetched = await fetch(image.url, { signal: request.abortSignal });
    const blob = await fetched.blob();
    return { png: blob, modelUsed: model };
  }
  throw new Error('Atlas returned no image data.');
}
