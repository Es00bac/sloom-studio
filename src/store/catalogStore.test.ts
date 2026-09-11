import { describe, expect, it } from 'vitest';
import { buildEmptyModelCatalog, FALLBACK_MODEL_OPTIONS } from '../lib/providerCatalog';
import { addGeminiModelRecordToCatalog, addOpenAICompatibleModelRecordToCatalog, mergeCatalog } from './catalogStore';

describe('addGeminiModelRecordToCatalog', () => {
  it('classifies Gemini Omni as video-only instead of exposing invalid text/image/audio routes', () => {
    const catalog = buildEmptyModelCatalog();

    addGeminiModelRecordToCatalog(catalog, {
      name: 'models/gemini-omni-flash-preview',
      displayName: 'Gemini Omni Flash Preview',
      description: 'Live keynote model surface before static docs are indexed.',
    });

    const expectedOption = expect.objectContaining({
      value: 'gemini-omni-flash-preview',
      label: 'Gemini Omni Flash Preview',
    });

    expect(catalog.text.gemini).toEqual([]);
    expect(catalog.image.gemini).toEqual([]);
    expect(catalog.video.gemini).toEqual([expectedOption]);
    expect(catalog.audio.gemini).toEqual([]);
  });
});

describe('mergeCatalog', () => {
  it('retains verified curated models while appending newly discovered models', () => {
    const live = buildEmptyModelCatalog();
    live.audio.elevenlabs = [{ value: 'account-new-tts', label: 'Account New TTS' }];
    const merged = mergeCatalog(FALLBACK_MODEL_OPTIONS, live);

    expect(merged.audio.elevenlabs.map((option) => option.value)).toEqual(expect.arrayContaining([
      'eleven_v3',
      'music_v2',
      'account-new-tts',
    ]));
  });

  it('does not resurrect vestigial or shut-down IDs returned by a provider discovery API', () => {
    const live = buildEmptyModelCatalog();
    live.audio.elevenlabs = [
      { value: 'eleven_ttv_v3', label: 'Voice design (wrong endpoint)' },
      { value: 'eleven_turbo_v2_5', label: 'Deprecated Turbo' },
    ];
    live.video.gemini = [{ value: 'veo-3.0-generate-001', label: 'Veo 3' }];
    const merged = mergeCatalog(FALLBACK_MODEL_OPTIONS, live);

    expect(merged.audio.elevenlabs.map((option) => option.value)).not.toContain('eleven_ttv_v3');
    expect(merged.audio.elevenlabs.map((option) => option.value)).not.toContain('eleven_turbo_v2_5');
    expect(merged.video.gemini.map((option) => option.value)).not.toContain('veo-3.0-generate-001');
  });
});

describe('addOpenAICompatibleModelRecordToCatalog', () => {
  it('keeps discovered Atlas Cloud image models under the Atlas provider instead of OpenAI', () => {
    const catalog = buildEmptyModelCatalog();

    addOpenAICompatibleModelRecordToCatalog(catalog, {
      id: 'black-forest-labs/flux-schnell',
    }, 'atlas');

    expect(catalog.image.atlas).toEqual([
      expect.objectContaining({
        value: 'black-forest-labs/flux-schnell',
        label: 'black-forest-labs/flux-schnell',
      }),
    ]);
    expect(catalog.image.openai).toEqual([]);
  });

  it('maps a discovered native Atlas nano-banana slug into the atlas image catalog', () => {
    const catalog = buildEmptyModelCatalog();
    addOpenAICompatibleModelRecordToCatalog(catalog, { id: 'google/nano-banana-2/reference-to-image' }, 'atlas');
    expect(catalog.image.atlas.some((option) => option.value === 'google/nano-banana-2/reference-to-image')).toBe(true);
  });

  it('maps discovered Atlas video routes into the video catalog', () => {
    const catalog = buildEmptyModelCatalog();
    addOpenAICompatibleModelRecordToCatalog(catalog, { id: 'bytedance/seedance-2.0/image-to-video' }, 'atlas');
    expect(catalog.video.atlas.map((option) => option.value)).toEqual([
      'bytedance/seedance-2.0/image-to-video',
    ]);
    expect(catalog.image.atlas).toEqual([]);
  });
});
