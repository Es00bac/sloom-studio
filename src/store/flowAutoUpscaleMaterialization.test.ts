// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from '../lib/flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from '../lib/providerCatalog';
import { BACKEND_PROXY_RESULT_ENVELOPE_VERSION } from '../lib/backendProxyResultEnvelope';
import { useSourceBinStore } from './sourceBinStore';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

/**
 * AUD-013 finding 1 (store/materialization): the auto-upscale replaces the primary image bytes, so the
 * pre-upscale Blob is stale. The Source Library materializer persists a supplied Blob in PREFERENCE to
 * the result data URL, so a retained stale Blob would store the ORIGINAL bytes, not the upscaled output.
 *
 * This exercises the real path end-to-end: real executeNodeRequest (backend proxy returns a versioned
 * image + its ORIGINAL binary), real client-side auto-upscale (Android accelerator → UPSCALED), then the
 * exact addAssetItem call the store's runNode makes. The IndexedDB sink is mocked purely to capture which
 * branch persisted and with what bytes.
 */

const V = BACKEND_PROXY_RESULT_ENVELOPE_VERSION;
const ORIGINAL_TEXT = 'ORIGINAL';
const UPSCALED_TEXT = 'ANDROID';
const ORIGINAL_BASE64 = Buffer.from(ORIGINAL_TEXT).toString('base64');
const UPSCALED_DATA_URL = `data:image/png;base64,${Buffer.from(UPSCALED_TEXT).toString('base64')}`;

// jsdom's Blob predates Blob.arrayBuffer(); the real client-side upscale path decodes the upscaler's
// image response through it, so provide the standard implementation when the environment lacks it.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    value(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

const persisted: Array<{ via: 'blob' | 'dataUrl'; text: string }> = [];

vi.mock('../lib/assetStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/assetStore')>();
  return {
    ...actual,
    saveImportedAsset: vi.fn(async (file: File) => {
      persisted.push({ via: 'blob', text: await file.text() });
      return { id: 'stored-blob', name: file.name, mimeType: file.type || 'application/octet-stream', dataUrl: `data:${file.type};base64,${ORIGINAL_BASE64}`, byteLength: file.size, createdAt: 0 };
    }),
    saveDataUrlAsset: vi.fn(async (input: { name: string; mimeType: string; dataUrl: string }) => {
      const base64 = input.dataUrl.slice(input.dataUrl.indexOf(',') + 1);
      persisted.push({ via: 'dataUrl', text: Buffer.from(base64, 'base64').toString('binary') });
      return { id: 'stored-dataurl', name: input.name, mimeType: input.mimeType, dataUrl: input.dataUrl, byteLength: base64.length, createdAt: 0 };
    }),
  };
});

const PROXY_EXECUTE_URL = 'https://proxy.example/api/flow/execute-node';

function proxySettings(): RuntimeSettingsSnapshot {
  return {
    apiKeys: { gemini: '', openai: '', atlas: '', huggingface: '', elevenlabs: '', bfl: '', stability: '' },
    defaultModels: {
      text: { gemini: 'gemini-3-flash-preview', openai: 'gpt-4.1-mini', huggingface: 'Qwen/Qwen3-4B-Instruct-2507' },
      image: {
        gemini: 'gemini-3-pro-image-preview', openai: 'gpt-image-2', atlas: 'gpt-image-2',
        huggingface: 'black-forest-labs/FLUX.1-dev', bfl: 'flux-2-pro', stability: 'stable-image-core',
        localOpen: 'Qwen/Qwen-Image-Edit', android: 'local-dream-active', byteplus: 'seedream-4.5',
      },
      video: { gemini: 'veo-3.1-generate-preview', huggingface: 'Wan-AI/Wan2.2-T2V-A14B', atlas: 'google/veo3.1/text-to-video' },
      audio: { gemini: 'gemini-3.1-flash-tts-preview', elevenlabs: 'eleven_multilingual_v2', huggingface: 'hexgrad/Kokoro-82M' },
    },
    providerSettings: {
      openaiBaseUrl: '', elevenlabsVoiceId: '', renderBackendPreference: 'auto', exportCompositorPreference: 'stage',
      localNativeRenderUrl: 'http://127.0.0.1:41736', backendProxyEnabled: true, backendProxyBaseUrl: 'https://proxy.example',
      geminiCredentialMode: 'api-key', vertexAuthMode: 'gcloud-user', vertexProjectId: '', vertexLocation: 'global',
      vertexQuotaProjectId: '', vertexEnvironmentVariables: '', vertexServiceAccountJson: '',
      paperPrintUpscaleMethod: 'auto', paperPdfRasterPreset: 'balanced-jpeg', localOpenImageEndpointUrl: '',
      localOpenImageAuthHeader: '', localOpenImageDefaultModel: 'Qwen/Qwen-Image-Edit',
      batchMaxRetries: 0, batchRetryBaseDelayMs: 1,
      androidLanServerEnabled: false, androidLanServerPin: '',
      androidAcceleratorBaseUrl: 'http://192.168.1.42:8788',
      androidAcceleratorAuthToken: 'pair-token',
      androidAcceleratorDefaultUpscaler: 'upscaler_realistic',
    },
  } as RuntimeSettingsSnapshot;
}

function imageResponse(body: string): Response {
  // Raw bytes (not a jsdom Blob, which the Response wrapper coerces to the string "[object Blob]").
  return new Response(new TextEncoder().encode(body), { status: 200, headers: { 'content-type': 'image/png' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  persisted.length = 0;
});

describe('AUD-013: proxied image → auto-upscale → Source Library materialization', () => {
  it('stores the UPSCALED output, never the stale original binary bytes', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      const stringUrl = String(url);
      if (stringUrl === PROXY_EXECUTE_URL) {
        return new Response(JSON.stringify({
          envelopeVersion: V,
          // The versioned envelope ships the ORIGINAL image both as the primary data URL and as its
          // byte-identical binary, plus byte-derived file metadata that becomes stale after the upscale.
          result: `data:image/png;base64,${ORIGINAL_BASE64}`,
          resultType: 'image',
          mimeType: 'image/png',
          extension: 'png',
          fileName: 'original.png',
          outputMetadata: { width: 512, height: 512 },
          binary: { encoding: 'base64', mimeType: 'image/png', byteLength: ORIGINAL_TEXT.length, data: ORIGINAL_BASE64 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (stringUrl.includes('/v1/capabilities')) {
        return new Response(JSON.stringify({ ok: true, models: [], upscalers: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (stringUrl.includes('/v1/upscale')) {
        return imageResponse(UPSCALED_TEXT);
      }
      throw new Error(`unexpected fetch: ${stringUrl}`);
    }));

    const node = { id: 'img', type: 'imageGen', position: { x: 0, y: 0 }, data: { provider: 'stability', modelId: 'stable-image-core', imageAutoUpscale: true } } as AppNode;
    const execution = await executeNodeRequest(node, { prompt: 'a castle', config: DEFAULT_EXECUTION_CONFIG }, proxySettings());

    // The upscale ran and the byte-derived fields were cleared, not carried through the spread.
    expect(execution.result).toBe(UPSCALED_DATA_URL);
    expect(execution.blob).toBeUndefined();
    expect(execution.extension).toBeUndefined();
    expect(execution.fileName).toBeUndefined();
    expect(execution.outputMetadata).toBeUndefined();

    // Materialize exactly as the store's runNode does (dataUrl from result, blob from result.blob).
    await useSourceBinStore.getState().addAssetItem({
      label: 'result', kind: 'image', mimeType: execution.mimeType ?? 'application/octet-stream',
      dataUrl: execution.result as string, blob: execution.blob, originNodeId: node.id,
    });

    // The persisted bytes are the upscaled output, via the data-URL branch — never the original Blob.
    expect(persisted).toContainEqual({ via: 'dataUrl', text: UPSCALED_TEXT });
    expect(persisted.some((entry) => entry.text === ORIGINAL_TEXT)).toBe(false);
  });
});
