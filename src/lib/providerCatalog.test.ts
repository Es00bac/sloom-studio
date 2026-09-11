import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODELS,
  DEFAULT_PROVIDER_SETTINGS,
  FALLBACK_MODEL_OPTIONS,
  getAudioOutputFormat,
  getConfiguredProviders,
  getImageAspectRatioOptions,
  getSupportedImageAspectRatio,
  getVideoDurationOptions,
  mapAspectRatioToImageDimensions,
  mapAspectRatioToImageSize,
  RENDER_BACKEND_OPTIONS,
} from './providerCatalog';

describe('FALLBACK_MODEL_OPTIONS', () => {
  it('preserves the valid ElevenLabs 48kHz 192kbps music output format', () => {
    expect(getAudioOutputFormat('mp3_48000_192')).toBe('mp3_48000_192');
  });

  it('makes the local render auto option explicit about AMD VAAPI GPU acceleration', () => {
    expect(RENDER_BACKEND_OPTIONS.find((option) => option.value === 'auto')?.label).toContain('AMD VAAPI GPU');
    expect(RENDER_BACKEND_OPTIONS.find((option) => option.value === 'native-amd-vaapi')?.label).toContain('AMD VAAPI GPU');
  });

  it('defaults Gemini text generation to the documented Gemini 3 Flash API model', () => {
    expect(DEFAULT_MODELS.text.gemini).toBe('gemini-3.5-flash');
  });

  it('keeps documented Gemini 3 text model IDs available without inventing an Omni alias', () => {
    const geminiTextModelIds = FALLBACK_MODEL_OPTIONS.text.gemini.map((option) => option.value);

    expect(geminiTextModelIds).toEqual(expect.arrayContaining([
      'gemini-3.5-flash',
      'gemini-3-flash-preview',
      'gemini-3.1-pro-preview',
      'gemini-3.1-flash-lite',
    ]));
    expect(geminiTextModelIds).not.toContain('gemini-3.1-flash-lite-preview');
    expect(geminiTextModelIds).not.toContain('gemini-omni-flash');
  });

  it('keeps current Hugging Face image, video, and audio choices available', () => {
    expect(FALLBACK_MODEL_OPTIONS.image.huggingface.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'black-forest-labs/FLUX.1-dev',
        'Qwen/Qwen-Image',
        'Tongyi-MAI/Z-Image-Turbo',
        'black-forest-labs/FLUX.1-Kontext-dev',
      ]),
    );
    expect(FALLBACK_MODEL_OPTIONS.video.huggingface.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'Lightricks/LTX-2.3',
        'Wan-AI/Wan2.2-T2V-A14B',
      ]),
    );
    expect(FALLBACK_MODEL_OPTIONS.audio.huggingface.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'hexgrad/Kokoro-82M',
        'ResembleAI/chatterbox',
        'coqui/XTTS-v2',
      ]),
    );
  });

  it('adds the worthwhile Vertex Imagen 4 generation models to the Gemini image picker', () => {
    expect(FALLBACK_MODEL_OPTIONS.image.gemini.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'imagen-4.0-fast-generate-001',
        'imagen-4.0-generate-001',
        'imagen-4.0-ultra-generate-001',
      ]),
    );
  });

  it('uses current stable Gemini image IDs and removes shut-down preview aliases from new nodes', () => {
    const ids = FALLBACK_MODEL_OPTIONS.image.gemini.map((option) => option.value);

    expect(ids).toEqual(expect.arrayContaining([
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
      'gemini-3-pro-image',
      'gemini-2.5-flash-image',
    ]));
    expect(ids).not.toContain('gemini-3.1-flash-image-preview');
    expect(ids).not.toContain('gemini-3-pro-image-preview');
  });

  it('uses current OpenAI, BytePlus, and BFL image endpoint IDs', () => {
    expect(FALLBACK_MODEL_OPTIONS.image.openai.map((option) => option.value)).toEqual([
      'gpt-image-2',
    ]);
    expect(DEFAULT_MODELS.image.byteplus).toBe('seedream-5-0-260128');
    expect(FALLBACK_MODEL_OPTIONS.image.byteplus.map((option) => option.value)).toEqual([
      'seedream-5-0-260128',
      'seedream-4-5-251128',
      'seedream-4-0-250828',
    ]);
    expect(FALLBACK_MODEL_OPTIONS.image.bfl.map((option) => option.value)).toContain(
      'flux-2-klein-9b-preview',
    );
  });

  it('adds cloud and local advanced image editing providers to the image picker catalog', () => {
    expect(FALLBACK_MODEL_OPTIONS.image.bfl.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'flux-2-pro',
        'flux-2-flex',
        'flux-2-max',
      ]),
    );
    expect(FALLBACK_MODEL_OPTIONS.image.stability.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'stable-image-edit-inpaint',
        'stable-image-edit-erase',
        'stable-image-edit-outpaint',
        'stable-image-edit-search-replace',
      ]),
    );
    expect(FALLBACK_MODEL_OPTIONS.image.localOpen.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'Qwen/Qwen-Image-Edit',
        'black-forest-labs/FLUX.1-Kontext-dev',
      ]),
    );
  });

  it('adds the requested Atlas Cloud native image models to the image picker catalog', () => {
    expect(FALLBACK_MODEL_OPTIONS.image.atlas.map((option) => option.value)).toEqual(
      expect.arrayContaining([
        'black-forest-labs/flux-schnell',
        'black-forest-labs/flux-dev',
        'black-forest-labs/flux-dev-lora',
        'z-image/turbo',
        'bytedance/seedream-v5.0-lite',
        'google/nano-banana-pro/text-to-image',
        'black-forest-labs/flux-kontext-dev',
        'bytedance/seedream-v5.0-lite/edit',
        'atlascloud/qwen-image/edit',
        'qwen/qwen-image-2.0-pro/text-to-image',
        'google/imagen4',
        'bytedance/seedream-v4.5',
        'black-forest-labs/flux-2-pro/text-to-image',
        'openai/gpt-image-2/text-to-image',
        'openai/gpt-image-1/text-to-image',
      ]),
    );
  });

  it('no longer offers Atlas image slugs that are absent from the live /models catalog', () => {
    const atlasValues = FALLBACK_MODEL_OPTIONS.image.atlas.map((option) => option.value);
    expect(atlasValues).not.toContain('atlascloud/qwen-image/edit-2511');
    expect(atlasValues).not.toContain('fireredteam/firered-image-edit-1.0');
    // Bare OpenAI slugs aren't valid Atlas model ids — Atlas namespaces them.
    expect(atlasValues).not.toContain('gpt-image-2');
    expect(atlasValues).not.toContain('gpt-image-1');
  });
});

describe('getConfiguredProviders', () => {
  it('does not ship a developer project ID or treat a fresh install as Vertex-configured', () => {
    expect(DEFAULT_PROVIDER_SETTINGS.vertexProjectId).toBe('');
    expect(
      getConfiguredProviders(
        'image',
        { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
        DEFAULT_PROVIDER_SETTINGS,
      ),
    ).toEqual([]);
  });

  it('exposes providers without browser keys when backend proxy mode is enabled', () => {
    expect(
      getConfiguredProviders(
        'image',
        { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
        { backendProxyEnabled: true, backendProxyBaseUrl: 'http://127.0.0.1:8787' },
      ),
    ).toEqual(['gemini', 'openai', 'atlas', 'byteplus', 'huggingface', 'bfl', 'stability', 'localOpen']);
  });

  it('exposes Android image generation only when the phone accelerator URL is configured', () => {
    expect(
      getConfiguredProviders(
        'image',
        { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
        { androidAcceleratorBaseUrl: 'http://192.168.1.42:8788' },
      ),
    ).toEqual(['android']);
  });

  it('exposes Gemini image generation without a browser key when Vertex ADC image mode is configured', () => {
    expect(
      getConfiguredProviders(
        'image',
        { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
        {
          backendProxyEnabled: false,
          backendProxyBaseUrl: '',
          geminiCredentialMode: 'vertex-adc',
          vertexProjectId: 'gen-lang-client-0529114074',
        },
      ),
    ).toEqual(['gemini']);
  });

  it('exposes Gemini image generation when the Vertex project comes only from a GOOGLE_CLOUD_PROJECT env var', () => {
    // Regression: the gate used to read the raw vertexProjectId field only, so a project set via
    // env var (as getVertexProjectConfig / the auth-status badge resolve it) dropped Google entirely.
    expect(
      getConfiguredProviders(
        'image',
        { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
        {
          geminiCredentialMode: 'vertex-adc',
          vertexProjectId: '',
          vertexEnvironmentVariables: 'GOOGLE_CLOUD_PROJECT=env-project-123',
        },
      ),
    ).toContain('gemini');
  });

  it('exposes Gemini text generation when Vertex ADC is configured', () => {
    // Vertex ADC drives both nano-banana image AND Gemini text (executeVertexGeminiTextContent),
    // so an authenticated Vertex project must surface Google as a text provider too.
    expect(
      getConfiguredProviders(
        'text',
        { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
        {
          backendProxyEnabled: false,
          backendProxyBaseUrl: '',
          geminiCredentialMode: 'vertex-adc',
          vertexProjectId: 'gen-lang-client-0529114074',
        },
      ),
    ).toEqual(['gemini']);
  });

  it('exposes Gemini video generation when Vertex ADC is configured', () => {
    // Vertex ADC also drives video (executeVertexVeoVideoNode / executeVertexOmniVideoNode via the
    // desktop bridge), so an authenticated Vertex project must surface Google as a video provider —
    // the 0.9.8 fix covered image + text only and left Veo unreachable for Vertex-only users.
    expect(
      getConfiguredProviders(
        'video',
        { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
        {
          backendProxyEnabled: false,
          backendProxyBaseUrl: '',
          geminiCredentialMode: 'vertex-adc',
          vertexProjectId: 'gen-lang-client-0529114074',
        },
      ),
    ).toEqual(['gemini']);
  });

  it('keeps Gemini audio gated on the API key even when Vertex ADC is configured', () => {
    // Gemini TTS has no Vertex execution path in this build; surfacing it on Vertex auth alone
    // would list a provider every run of which fails.
    expect(
      getConfiguredProviders(
        'audio',
        { gemini: '', openai: '', huggingface: '', elevenlabs: '' },
        {
          backendProxyEnabled: false,
          backendProxyBaseUrl: '',
          geminiCredentialMode: 'vertex-adc',
          vertexProjectId: 'gen-lang-client-0529114074',
        },
      ),
    ).toEqual([]);
  });

  it('exposes BFL, Stability, and Local/Open when their cloud keys or endpoint are configured', () => {
    expect(
      getConfiguredProviders(
        'image',
        { gemini: '', openai: '', huggingface: '', elevenlabs: '', bfl: 'bfl-key', stability: 'sk-stability' },
        {
          backendProxyEnabled: false,
          backendProxyBaseUrl: '',
          localOpenImageEndpointUrl: 'http://127.0.0.1:8188/signal-loom-image-edit',
        },
      ),
    ).toEqual(['bfl', 'stability', 'localOpen']);
  });
});

describe('getVideoDurationOptions', () => {
  it('locks Gemini interpolation flows to 8 seconds', () => {
    expect(getVideoDurationOptions(true)).toEqual([{ value: '8', label: '8 seconds' }]);
  });

  it('keeps the standard duration set for non-interpolation flows', () => {
    expect(getVideoDurationOptions(false)).toEqual([
      { value: '4', label: '4 seconds' },
      { value: '6', label: '6 seconds' },
      { value: '8', label: '8 seconds' },
    ]);
  });
});

describe('getImageAspectRatioOptions', () => {
  it('exposes Gemini ImageConfig aspect ratios for Gemini image models', () => {
    expect(getImageAspectRatioOptions('gemini', 'gemini-3-pro-image-preview').map((option) => option.value)).toEqual([
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9',
    ]);
  });

  it('uses the Gemini 3 ImageConfig aspect ratio set for Gemini 3.1 Flash Image', () => {
    expect(getImageAspectRatioOptions('gemini', 'gemini-3.1-flash-image-preview').map((option) => option.value)).toEqual([
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9',
    ]);
  });

  it('keeps Gemini 2.5 Flash Image limited to its documented ratios', () => {
    expect(getImageAspectRatioOptions('gemini', 'gemini-2.5-flash-image').map((option) => option.value)).toEqual([
      '1:1',
      '3:4',
      '4:3',
      '9:16',
      '16:9',
    ]);
  });

  it('keeps Imagen 4 generation models on Vertex-supported ratios', () => {
    expect(getImageAspectRatioOptions('gemini', 'imagen-4.0-generate-001').map((option) => option.value)).toEqual([
      '1:1',
      '3:4',
      '4:3',
      '9:16',
      '16:9',
    ]);
  });

  it('limits OpenAI image options to native request sizes', () => {
    expect(getImageAspectRatioOptions('openai', 'gpt-image-1').map((option) => option.value)).toEqual([
      '1:1',
      '3:2',
      '2:3',
    ]);
  });

  it('uses full image aspect-ratio controls for BFL and Local/Open while hiding ratios for edit-only Stability models', () => {
    expect(getImageAspectRatioOptions('bfl', 'flux-2-pro').map((option) => option.value)).toEqual([
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9',
    ]);
    expect(getImageAspectRatioOptions('localOpen', 'Qwen/Qwen-Image-Edit').map((option) => option.value)).toEqual([
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9',
    ]);
    expect(getImageAspectRatioOptions('stability', 'stable-image-edit-search-replace')).toEqual([]);
  });

  it('normalizes provider-specific unsupported ratios before the node writes them', () => {
    expect(getSupportedImageAspectRatio('openai', 'gpt-image-1', '16:9')).toBe('3:2');
    expect(getSupportedImageAspectRatio('openai', 'gpt-image-1', '4:3')).toBe('3:2');
    expect(getSupportedImageAspectRatio('gemini', 'gemini-3-pro-image-preview', '4:3')).toBe('4:3');
  });
});

describe('mapAspectRatioToImageDimensions', () => {
  it('maps landscape images to their actual requested ratio', () => {
    expect(mapAspectRatioToImageDimensions('16:9')).toEqual({ width: 1376, height: 768 });
    expect(mapAspectRatioToImageDimensions('4:3')).toEqual({ width: 1200, height: 896 });
    expect(mapAspectRatioToImageDimensions('5:4')).toEqual({ width: 1152, height: 928 });
    expect(mapAspectRatioToImageDimensions('21:9')).toEqual({ width: 1584, height: 672 });
  });

  it('maps portrait images to their actual requested ratio', () => {
    expect(mapAspectRatioToImageDimensions('9:16')).toEqual({ width: 768, height: 1376 });
    expect(mapAspectRatioToImageDimensions('3:4')).toEqual({ width: 896, height: 1200 });
    expect(mapAspectRatioToImageDimensions('4:5')).toEqual({ width: 928, height: 1152 });
  });

  it('keeps square images square', () => {
    expect(mapAspectRatioToImageDimensions('1:1')).toEqual({ width: 1024, height: 1024 });
  });
});

describe('mapAspectRatioToImageSize', () => {
  it('maps exact OpenAI image aspect ratios to native request sizes', () => {
    expect(mapAspectRatioToImageSize('1:1')).toBe('1024x1024');
    expect(mapAspectRatioToImageSize('3:2')).toBe('1536x1024');
    expect(mapAspectRatioToImageSize('2:3')).toBe('1024x1536');
  });

  it('keeps legacy landscape and portrait labels compatible with existing flows', () => {
    expect(mapAspectRatioToImageSize('16:9')).toBe('1536x1024');
    expect(mapAspectRatioToImageSize('9:16')).toBe('1024x1536');
  });

  it('rejects ratios OpenAI cannot request natively instead of silently changing the composition', () => {
    expect(() => mapAspectRatioToImageSize('4:3')).toThrow('OpenAI image generation does not support 4:3 output.');
  });
});
