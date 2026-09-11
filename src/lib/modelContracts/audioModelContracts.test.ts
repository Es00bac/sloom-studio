import { describe, expect, it } from 'vitest';
import type { AudioProvider } from '../../types/flow';
import { FALLBACK_MODEL_OPTIONS } from '../providerCatalog';
import { getProviderModelContract } from '../providerModelContracts';
import {
  AUDIO_MODEL_CONTRACTS,
  audioModeToOperation,
  getAudioModelContract,
  getAudioModelSupport,
} from './audioModelContracts';

describe('audio model contracts', () => {
  it('maps every normal audio option to an explicit shared request contract', () => {
    for (const [providerId, options] of Object.entries(FALLBACK_MODEL_OPTIONS.audio) as Array<[
      AudioProvider,
      Array<{ value: string; label: string }>,
    ]>) {
      for (const option of options) {
        const contract = getProviderModelContract(AUDIO_MODEL_CONTRACTS, providerId, option.value);
        expect(contract, `${providerId}/${option.value}`).toBeDefined();
        expect(contract?.outputModalities).toContain('audio');
        expect(contract?.operations.length).toBeGreaterThan(0);
        expect(contract?.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps exact ElevenLabs endpoint families separate and removes vestigial models', () => {
    expect(getAudioModelContract('elevenlabs', 'eleven_v3').operations).toEqual(['text-to-speech']);
    expect(getAudioModelContract('elevenlabs', 'eleven_multilingual_sts_v2').operations).toEqual(['speech-to-speech']);
    expect(getAudioModelContract('elevenlabs', 'eleven_text_to_sound_v2').operations).toEqual(['text-to-sound-effect']);
    expect(getAudioModelContract('elevenlabs', 'music_v2').operations).toEqual(['text-to-music']);

    const normalIds = FALLBACK_MODEL_OPTIONS.audio.elevenlabs.map((option) => option.value);
    expect(normalIds).not.toContain('eleven_ttv_v3');
    expect(normalIds).not.toContain('eleven_turbo_v2_5');
    expect(normalIds).toContain('music_v2');
  });

  it('models Gemini 3.1 TTS as Interactions while retaining 2.5 generateContent routes', () => {
    expect(getAudioModelContract('gemini', 'gemini-3.1-flash-tts-preview')).toMatchObject({
      apiFamily: 'google-interactions',
      endpoint: '/v1beta/interactions',
      lifecycle: 'preview',
    });
    expect(getAudioModelContract('gemini', 'gemini-2.5-flash-preview-tts')).toMatchObject({
      apiFamily: 'google-gemini',
    });
  });

  it('derives UI controls and operation compatibility from the exact model', () => {
    expect(audioModeToOperation('music')).toBe('text-to-music');
    expect(getAudioModelSupport('elevenlabs', 'eleven_v3', 'soundEffect')).toMatchObject({
      operationSupported: false,
      voice: false,
      duration: false,
    });
    expect(getAudioModelSupport('elevenlabs', 'music_v2', 'music')).toMatchObject({
      operationSupported: true,
      duration: true,
      seed: false,
      instrumental: true,
    });
    expect(getAudioModelSupport('elevenlabs', 'eleven_text_to_sound_v2', 'soundEffect')).toMatchObject({
      operationSupported: true,
      duration: true,
      promptInfluence: true,
      loop: true,
    });
  });

  it('keeps unknown discovered models selectable with safe text-to-speech semantics', () => {
    const contract = getAudioModelContract('huggingface', 'vendor/new-tts');
    expect(contract).toMatchObject({
      lifecycle: 'unverified',
      availability: 'live',
      operations: ['text-to-speech'],
    });
    expect(contract.parameters.map((parameter) => parameter.id)).toEqual(['prompt']);
  });
});
