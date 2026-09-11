import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest, type ExecutionContext } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import { NonRetryableError } from './exponentialBackoff';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

/**
 * AUD-011: numbered Reference 1/2/3 handles accept an image plus textual/JSON guidance, and the
 * provider request must preserve WHICH guidance belongs to WHICH numbered image. These regressions
 * fail on the pre-correction runtime (flat URL list + globally concatenated prompt) and pin the
 * canonical structured-group serialization for every reference-capable provider route.
 */

const geminiCapture = vi.hoisted(() => ({
  generateContent: vi.fn(async (_request: Record<string, unknown>) => ({
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'SU1H' } }] } }],
  })),
  interactionsCreate: vi.fn(async (_request: Record<string, unknown>) => ({
    outputs: [{ type: 'video', mime_type: 'video/mp4', data: 'T01OSQ==' }],
  })),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: geminiCapture.generateContent };
    interactions = { create: geminiCapture.interactionsCreate };
  },
}));

const openAiCapture = vi.hoisted(() => ({
  generateArgs: undefined as Record<string, unknown> | undefined,
  editArgs: undefined as Record<string, unknown> | undefined,
}));

vi.mock('openai', () => ({
  default: class {
    images = {
      generate: async (args: Record<string, unknown>) => {
        openAiCapture.generateArgs = args;
        return { data: [{ b64_json: 'aW1n' }] };
      },
      edit: async (args: Record<string, unknown>) => {
        openAiCapture.editArgs = args;
        return { data: [{ b64_json: 'aW1n' }] };
      },
    };
  },
}));

const IMAGE_A = 'data:image/png;base64,QUFB';
const IMAGE_B = 'data:image/png;base64,QkJC';
const SOURCE_IMAGE = 'data:image/png;base64,U1JD';

const baseSettings: RuntimeSettingsSnapshot = {
  apiKeys: {
    gemini: 'gemini-key',
    openai: 'openai-key',
    atlas: 'atlas-key',
    huggingface: '',
    elevenlabs: '',
    bfl: 'bfl-key',
    stability: 'stability-key',
  },
  defaultModels: {
    text: {
      gemini: 'gemini-3-flash-preview',
      openai: 'gpt-4.1-mini',
      huggingface: 'Qwen/Qwen3-4B-Instruct-2507',
    },
    image: {
      gemini: 'gemini-3.1-flash-image',
      openai: 'gpt-image-2',
      atlas: 'gpt-image-2',
      huggingface: 'black-forest-labs/FLUX.1-dev',
      bfl: 'flux-2-pro',
      stability: 'stable-image-core',
      localOpen: 'Qwen/Qwen-Image-Edit',
      android: 'local-dream-active',
      byteplus: 'seedream-4.5',
    },
    video: {
      gemini: 'veo-3.1-generate-001',
      huggingface: 'Wan-AI/Wan2.2-T2V-A14B',
      atlas: 'google/veo3.1/text-to-video',
    },
    audio: {
      gemini: 'gemini-3.1-flash-tts-preview',
      elevenlabs: 'eleven_multilingual_v2',
      huggingface: 'hexgrad/Kokoro-82M',
    },
  },
  providerSettings: {
    openaiBaseUrl: '',
    elevenlabsVoiceId: '',
    renderBackendPreference: 'auto',
    exportCompositorPreference: 'stage',
    localNativeRenderUrl: 'http://127.0.0.1:41736',
    backendProxyEnabled: false,
    backendProxyBaseUrl: '',
    geminiCredentialMode: 'api-key',
    vertexAuthMode: 'gcloud-user',
    vertexProjectId: '',
    vertexLocation: 'global',
    vertexQuotaProjectId: '',
    vertexEnvironmentVariables: '',
    vertexServiceAccountJson: '',
    paperPrintUpscaleMethod: 'auto',
    paperPdfRasterPreset: 'balanced-jpeg',
    localOpenImageEndpointUrl: '',
    localOpenImageAuthHeader: '',
    localOpenImageDefaultModel: 'Qwen/Qwen-Image-Edit',
    batchMaxRetries: 0,
    batchRetryBaseDelayMs: 1,
    androidLanServerEnabled: false,
    androidLanServerPin: '',
  },
} as RuntimeSettingsSnapshot;

function createImageNode(provider: string, modelId: string, data: AppNode['data'] = {}): AppNode {
  return {
    id: 'image-1',
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: { provider, modelId, ...data },
  } as AppNode;
}

function createVideoNode(modelId: string, data: AppNode['data'] = {}): AppNode {
  return {
    id: 'video-1',
    type: 'videoGen',
    position: { x: 0, y: 0 },
    data: { provider: 'gemini', modelId, ...data },
  } as AppNode;
}

function context(overrides: Partial<ExecutionContext>): ExecutionContext {
  return {
    prompt: 'ordinary prompt text',
    config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '1:1', imageOutputFormat: 'png' },
    ...overrides,
  } as ExecutionContext;
}

const TWO_SLOT_GROUPS = [
  { slot: 1, imageUrl: IMAGE_A, descriptions: ['preserve logo'], jsonGuidance: [] },
  { slot: 2, imageUrl: IMAGE_B, descriptions: ['preserve identity'], jsonGuidance: [] },
];

type GeminiPart = { text?: string; inlineData?: { data?: string; mimeType?: string } };

function capturedGeminiParts(): GeminiPart[] {
  const request = geminiCapture.generateContent.mock.calls.at(-1)?.[0] as {
    contents?: Array<{ parts?: GeminiPart[] }>;
  };
  return request?.contents?.[0]?.parts ?? [];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  geminiCapture.generateContent.mockClear();
  geminiCapture.interactionsCreate.mockClear();
  openAiCapture.generateArgs = undefined;
  openAiCapture.editArgs = undefined;
});

describe('Gemini direct image reference groups', () => {
  it('labels each numbered reference adjacent to its image and keeps the ordinary prompt separate', async () => {
    await executeNodeRequest(
      createImageNode('gemini', 'gemini-3.1-flash-image'),
      context({
        editReferenceImageInputs: [IMAGE_A, IMAGE_B],
        referenceGroups: TWO_SLOT_GROUPS,
      }),
      baseSettings,
    );

    const parts = capturedGeminiParts();
    expect(parts[0]?.text).toContain('ordinary prompt text');
    expect(parts[0]?.text).not.toContain('preserve logo');
    expect(parts[0]?.text).not.toContain('preserve identity');

    const referenceOneIndex = parts.findIndex((part) =>
      part.text?.includes('Reference 1') && part.text?.includes('preserve logo'));
    const referenceTwoIndex = parts.findIndex((part) =>
      part.text?.includes('Reference 2') && part.text?.includes('preserve identity'));
    expect(referenceOneIndex).toBeGreaterThan(0);
    expect(referenceTwoIndex).toBeGreaterThan(referenceOneIndex);
    // Association is positional: the labeled guidance part is immediately followed by its image.
    expect(parts[referenceOneIndex + 1]?.inlineData?.data).toBe('QUFB');
    expect(parts[referenceTwoIndex + 1]?.inlineData?.data).toBe('QkJC');
    // No cross-slot leakage.
    expect(parts[referenceOneIndex]?.text).not.toContain('preserve identity');
    expect(parts[referenceTwoIndex]?.text).not.toContain('preserve logo');
  });

  it('keeps an image-only reference request byte-identical to the legacy flat shape', async () => {
    await executeNodeRequest(
      createImageNode('gemini', 'gemini-3.1-flash-image'),
      context({
        editReferenceImageInputs: [IMAGE_A, IMAGE_B],
        referenceGroups: [
          { slot: 1, imageUrl: IMAGE_A, descriptions: [], jsonGuidance: [] },
          { slot: 2, imageUrl: IMAGE_B, descriptions: [], jsonGuidance: [] },
        ],
      }),
      baseSettings,
    );

    const parts = capturedGeminiParts();
    expect(parts).toHaveLength(3);
    expect(parts[0]?.text).toContain('ordinary prompt text');
    expect(parts[1]?.inlineData?.data).toBe('QUFB');
    expect(parts[2]?.inlineData?.data).toBe('QkJC');
  });

  it('serializes JSON guidance deterministically next to its numbered image without [object Object]', async () => {
    await executeNodeRequest(
      createImageNode('gemini', 'gemini-3.1-flash-image'),
      context({
        editReferenceImageInputs: [IMAGE_A],
        referenceGroups: [
          { slot: 2, imageUrl: IMAGE_A, descriptions: [], jsonGuidance: ['{"palette":["#0057ff"],"weight":2}'] },
        ],
      }),
      baseSettings,
    );

    const parts = capturedGeminiParts();
    const guidancePart = parts.find((part) => part.text?.includes('Reference 2'));
    expect(guidancePart?.text).toContain('{"palette":["#0057ff"],"weight":2}');
    expect(parts[parts.indexOf(guidancePart!) + 1]?.inlineData?.data).toBe('QUFB');
    for (const part of parts) {
      expect(part.text ?? '').not.toContain('[object Object]');
    }
  });

  it('rejects a numbered slot beyond the model reference limit before any provider submission', async () => {
    await expect(executeNodeRequest(
      createImageNode('gemini', 'gemini-2.5-flash-image'),
      context({
        editReferenceImageInputs: [IMAGE_A],
        referenceGroups: [
          { slot: 4, imageUrl: IMAGE_A, descriptions: ['out of range'], jsonGuidance: [] },
        ],
      }),
      baseSettings,
    )).rejects.toThrow(/Reference 4|at most 3/i);
    expect(geminiCapture.generateContent).not.toHaveBeenCalled();
  });
});

describe('OpenAI image reference groups', () => {
  it('maps numbered references to attachment positions inside the edit prompt', async () => {
    await executeNodeRequest(
      createImageNode('openai', 'gpt-image-2'),
      context({
        editImageInput: SOURCE_IMAGE,
        editReferenceImageInputs: [IMAGE_A, IMAGE_B],
        referenceGroups: TWO_SLOT_GROUPS,
      }),
      baseSettings,
    );

    expect(openAiCapture.editArgs).toBeDefined();
    const images = openAiCapture.editArgs?.image as File[];
    expect(images).toHaveLength(3);
    const prompt = String(openAiCapture.editArgs?.prompt ?? '');
    expect(prompt).toContain('ordinary prompt text');
    // Attachment 1 is the source image, so Reference 1/2 are attachments 2/3, provably in order.
    expect(prompt).toContain('Reference 1 (attached image 2 of 3): preserve logo');
    expect(prompt).toContain('Reference 2 (attached image 3 of 3): preserve identity');
    expect(prompt.indexOf('ordinary prompt text')).toBeLessThan(prompt.indexOf('Reference 1'));
  });

  it('keeps guidance-free OpenAI reference edits on the legacy prompt exactly', async () => {
    await executeNodeRequest(
      createImageNode('openai', 'gpt-image-2'),
      context({
        editReferenceImageInputs: [IMAGE_A],
        referenceGroups: [{ slot: 1, imageUrl: IMAGE_A, descriptions: [], jsonGuidance: [] }],
      }),
      baseSettings,
    );

    expect(String(openAiCapture.editArgs?.prompt ?? '')).toBe('ordinary prompt text');
  });

  it('rejects Atlas OpenAI-compatible reference guidance with a non-retryable diagnostic', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(
      createImageNode('atlas', 'openai/gpt-image-1'),
      context({
        editReferenceImageInputs: [IMAGE_A],
        referenceGroups: [{ slot: 1, imageUrl: IMAGE_A, descriptions: ['hold identity'], jsonGuidance: [] }],
      }),
      baseSettings,
    )).rejects.toBeInstanceOf(NonRetryableError);
    expect(openAiCapture.editArgs).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reference groups on routes without reference support', () => {
  it('fails closed before submission when guidance rides a provider without reference support', async () => {
    const fetchMock = vi.fn(async () => new Response(new Blob(['PNG'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeNodeRequest(
      createImageNode('stability', 'stable-image-core'),
      context({
        referenceGroups: [{ slot: 1, descriptions: ['guidance without support'], jsonGuidance: [] }],
      }),
      baseSettings,
    )).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects reference guidance that has no image on its numbered slot', async () => {
    await expect(executeNodeRequest(
      createImageNode('gemini', 'gemini-3.1-flash-image'),
      context({
        referenceGroups: [{ slot: 2, descriptions: ['description with no image'], jsonGuidance: [] }],
      }),
      baseSettings,
    )).rejects.toThrow(/Reference 2/);
    expect(geminiCapture.generateContent).not.toHaveBeenCalled();
  });
});

describe('video reference groups', () => {
  it('carries Veo reference types natively and serializes numbered guidance into the prompt', async () => {
    const generateVertexVideo = vi.fn().mockResolvedValue({
      result: 'data:video/mp4;base64,VERTEX',
      resultType: 'video',
      statusMessage: 'Generated with veo-3.1-generate-001',
      mimeType: 'video/mp4',
    });
    vi.stubGlobal('window', { signalLoomNative: { generateVertexVideo } });

    await executeNodeRequest(
      createVideoNode('veo-3.1-generate-001'),
      context({
        prompt: 'ordinary video prompt',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', durationSeconds: 8, videoResolution: '720p' },
        referenceImageInputs: [
          { url: IMAGE_A, referenceType: 'asset' },
          { url: IMAGE_B, referenceType: 'style' },
        ],
        referenceGroups: [
          { slot: 1, imageUrl: IMAGE_A, descriptions: ['preserve mascot identity'], jsonGuidance: [], referenceType: 'asset' },
          { slot: 2, imageUrl: IMAGE_B, descriptions: ['match the poster style'], jsonGuidance: [], referenceType: 'style' },
        ],
      }),
      {
        ...baseSettings,
        providerSettings: {
          ...baseSettings.providerSettings,
          geminiCredentialMode: 'vertex-adc',
          vertexAuthMode: 'gcloud-adc',
          vertexProjectId: 'test-project',
          vertexLocation: 'us-central1',
        },
      } as RuntimeSettingsSnapshot,
    );

    const body = generateVertexVideo.mock.calls[0][0].body as {
      instances: Array<{
        prompt?: string;
        referenceImages?: Array<{ image: { bytesBase64Encoded: string }; referenceType: string }>;
      }>;
    };
    const instance = body.instances[0];
    expect(instance.referenceImages).toEqual([
      { image: { bytesBase64Encoded: 'QUFB', mimeType: 'image/png' }, referenceType: 'asset' },
      { image: { bytesBase64Encoded: 'QkJC', mimeType: 'image/png' }, referenceType: 'style' },
    ]);
    expect(instance.prompt).toContain('ordinary video prompt');
    expect(instance.prompt).toContain('Reference 1 (reference image 1 of 2): preserve mascot identity');
    expect(instance.prompt).toContain('Reference 2 (reference image 2 of 2): match the poster style');
  });

  it('places numbered guidance in the Omni per-image instruction and keeps image-only slots legacy', async () => {
    await executeNodeRequest(
      createVideoNode('gemini-omni-flash-preview'),
      context({
        prompt: 'ordinary omni prompt',
        config: { ...DEFAULT_EXECUTION_CONFIG, aspectRatio: '16:9', durationSeconds: 6, videoResolution: '720p' },
        referenceImageInputs: [
          { url: IMAGE_A, referenceType: 'asset' },
          { url: IMAGE_B, referenceType: 'style' },
        ],
        referenceGroups: [
          { slot: 1, imageUrl: IMAGE_A, descriptions: ['hold the brand mark'], jsonGuidance: [], referenceType: 'asset' },
          { slot: 2, imageUrl: IMAGE_B, descriptions: [], jsonGuidance: [], referenceType: 'style' },
        ],
      }),
      baseSettings,
    );

    const request = geminiCapture.interactionsCreate.mock.calls.at(-1)?.[0] as {
      input: Array<{ type: string; text?: string; data?: string }>;
    };
    const input = request.input;
    const guidanceIndex = input.findIndex((item) =>
      item.type === 'text' && item.text?.includes('Reference 1') && item.text?.includes('hold the brand mark'));
    expect(guidanceIndex).toBeGreaterThan(-1);
    expect(input[guidanceIndex + 1]).toMatchObject({ type: 'image', data: 'QUFB' });
    const legacyIndex = input.findIndex((item) => item.text === 'Use this as a style reference.');
    expect(legacyIndex).toBeGreaterThan(guidanceIndex);
    expect(input[legacyIndex + 1]).toMatchObject({ type: 'image', data: 'QkJC' });
  });
});

describe('backend proxy reference-group DTO', () => {
  const proxySettings = {
    ...baseSettings,
    providerSettings: {
      ...baseSettings.providerSettings,
      backendProxyEnabled: true,
      backendProxyBaseUrl: 'https://proxy.example',
    },
  } as RuntimeSettingsSnapshot;

  it('round-trips structured groups through the proxy DTO without extra keys', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({
      result: 'data:image/png;base64,Q09SRQ==',
      resultType: 'image',
      statusMessage: 'Generated through backend proxy',
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);

    const groups = [
      { slot: 1, imageUrl: IMAGE_A, descriptions: ['preserve logo'], jsonGuidance: ['{"a":1}'] },
      { slot: 2, imageUrl: IMAGE_B, descriptions: ['preserve identity'], jsonGuidance: [] },
    ];
    await executeNodeRequest(
      createImageNode('stability', 'stable-image-core'),
      context({
        editReferenceImageInputs: [IMAGE_A, IMAGE_B],
        referenceGroups: [
          // A credential-shaped stray key must never travel to the proxy.
          { ...groups[0], authToken: 'super-secret' } as never,
          groups[1],
        ],
      }),
      proxySettings,
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      context: { referenceGroups?: Array<Record<string, unknown>> };
    };
    expect(body.context.referenceGroups).toEqual(groups);
    expect(JSON.stringify(body.context.referenceGroups)).not.toContain('super-secret');
  });

  it('bounds malformed or oversized reference groups before any proxy processing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    let nested: unknown = 1;
    for (let depth = 0; depth < 40; depth += 1) {
      nested = [nested];
    }
    await expect(executeNodeRequest(
      createImageNode('stability', 'stable-image-core'),
      context({
        referenceGroups: [
          { slot: 1, imageUrl: IMAGE_A, descriptions: [], jsonGuidance: [JSON.stringify(nested)] },
        ],
      }),
      proxySettings,
    )).rejects.toBeInstanceOf(NonRetryableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
