import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeNodeRequest } from './flowExecution';
import { DEFAULT_EXECUTION_CONFIG } from './providerCatalog';
import type { AppNode, RuntimeSettingsSnapshot } from '../types/flow';

const hfCapture = vi.hoisted(() => ({
  textToImageArgs: undefined as Record<string, unknown> | undefined,
}));
vi.mock('@huggingface/inference', () => ({
  HfInference: class {
    textToImage = async (args: Record<string, unknown>) => {
      hfCapture.textToImageArgs = args;
      return new Blob(['IMG'], { type: 'image/png' });
    };
  },
}));

const settings = {
  apiKeys: { gemini: '', openai: '', atlas: '', huggingface: 'hf-key', elevenlabs: '' },
  defaultModels: {
    text: { gemini: 'g', openai: 'o', huggingface: 'h' },
    image: {
      gemini: 'g', openai: 'o', atlas: 'a', huggingface: 'black-forest-labs/FLUX.1-dev',
      bfl: 'b', stability: 's', localOpen: 'l', android: 'd', byteplus: 'p',
    },
    video: { gemini: 'g', huggingface: 'h', atlas: 'a' },
    audio: { gemini: 'g', elevenlabs: 'e', huggingface: 'h' },
  },
  providerSettings: {
    openaiBaseUrl: '',
    elevenlabsVoiceId: '',
    renderBackendPreference: 'auto',
    localNativeRenderUrl: '',
    backendProxyEnabled: false,
    backendProxyBaseUrl: '',
    geminiCredentialMode: 'api-key',
    batchMaxRetries: 10,
    batchRetryBaseDelayMs: 30000,
    androidLanServerEnabled: false,
    androidLanServerPin: '',
  },
} as unknown as RuntimeSettingsSnapshot;

function createHfImageNode(data: AppNode['data'] = {}): AppNode {
  return {
    id: 'image-1',
    type: 'imageGen',
    position: { x: 0, y: 0 },
    data: {
      provider: 'huggingface',
      modelId: 'black-forest-labs/FLUX.1-dev',
      ...data,
    },
  } as AppNode;
}

describe('executeNodeRequest Hugging Face image parameters', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes negative_prompt, seed, and guidance_scale through to textToImage when set', async () => {
    hfCapture.textToImageArgs = undefined;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hf-image');

    await executeNodeRequest(
      createHfImageNode({
        imageNegativePrompt: 'blurry, extra fingers',
        imageSeed: 1234.9,
        imageGuidanceScale: 6.5,
      }),
      { prompt: 'an isometric workshop', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    );

    const textToImageArgs = hfCapture.textToImageArgs as Record<string, unknown> | undefined;
    expect(textToImageArgs).toMatchObject({
      model: 'black-forest-labs/FLUX.1-dev',
      inputs: 'an isometric workshop',
    });
    expect(textToImageArgs?.parameters).toMatchObject({
      negative_prompt: 'blurry, extra fingers',
      seed: 1234,
      guidance_scale: 6.5,
    });
  });

  it('omits the optional parameters when the node leaves them blank', async () => {
    hfCapture.textToImageArgs = undefined;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hf-image');

    await executeNodeRequest(
      createHfImageNode(),
      { prompt: 'an isometric workshop', config: DEFAULT_EXECUTION_CONFIG },
      settings,
    );

    const parameters = (hfCapture.textToImageArgs as Record<string, unknown> | undefined)?.parameters as Record<string, unknown>;
    expect(parameters.negative_prompt).toBeUndefined();
    expect(parameters.seed).toBeUndefined();
    expect(parameters.guidance_scale).toBeUndefined();
    expect(parameters.num_inference_steps).toBe(DEFAULT_EXECUTION_CONFIG.steps);
  });
});
