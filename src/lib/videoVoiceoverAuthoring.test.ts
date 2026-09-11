import { describe, expect, it } from 'vitest';
import { createEditorAudioClip } from './manualEditorState';
import {
  applyVideoGeneratedAudioPlacement,
  assertCredentialFreeVideoVoiceoverValue,
  buildVideoGeneratedAudioPlacementProposal,
  createVideoGeneratedAudioProvenance,
  createVideoRangeSfxRequest,
  createVideoVoiceoverParagraph,
  createVideoVoiceoverTtsRequest,
  normalizeVideoVoiceoverAlignment,
  regenerateVideoVoiceoverParagraph,
  type VideoGeneratedAudioAsset,
} from './videoVoiceoverAuthoring';

const provider = { providerId: 'provider-optional', modelId: 'multilingual-voice-v1' };

describe('professional Video voiceover and range SFX authoring', () => {
  it('preserves paragraph identity across bounded regeneration', () => {
    const paragraph = createVideoVoiceoverParagraph({
      id: 'paragraph-1',
      text: 'The first reading.',
      languageCode: 'en',
      voiceId: 'voice-a',
      originalReferenceIds: ['imported-scene-1'],
    });
    const regenerated = regenerateVideoVoiceoverParagraph(paragraph, {
      requestId: 'request-2',
      text: 'A revised reading.',
      voiceId: 'voice-b',
    });
    expect(regenerated).toMatchObject({
      id: 'paragraph-1',
      revision: 2,
      text: 'A revised reading.',
      voiceId: 'voice-b',
      lastRequestId: 'request-2',
      originalReferenceIds: ['imported-scene-1'],
    });
  });

  it('builds credential-free provider-optional TTS and range-SFX requests', () => {
    const paragraph = createVideoVoiceoverParagraph({
      id: 'paragraph-1', text: 'Hello world.', languageCode: 'en', voiceId: 'voice-a',
    });
    const tts = createVideoVoiceoverTtsRequest({
      requestId: 'tts-request', provider, paragraph,
      rightsAttestationId: 'rights-1', billingConsentId: 'billing-1',
    });
    const sfx = createVideoRangeSfxRequest({
      requestId: 'sfx-request', provider, prompt: 'A quiet door closes',
      timelineStartMs: 2_000, timelineEndMs: 3_500,
      rightsAttestationId: 'rights-1', billingConsentId: 'billing-2',
      originalReferenceIds: ['imported-scene-1'],
    });
    expect(tts.usageIntent).toEqual({ unit: 'characters', amount: 'Hello world.'.length });
    expect(sfx.usageIntent).toEqual({ unit: 'seconds', amount: 1.5 });
    const serialized = JSON.stringify({ tts, sfx }).toLowerCase();
    expect(serialized).not.toMatch(/api.?key|authorization|password|secret|credential|token/u);
    expect(() => assertCredentialFreeVideoVoiceoverValue({
      ...tts,
      provider: { ...tts.provider, apiKey: 'must-never-serialize' },
    })).toThrow(/credential field 'apiKey'/i);
  });

  it('normalizes character and derived word timing without losing authored text', () => {
    const text = 'Hi all';
    const characters = Array.from(text);
    const alignment = normalizeVideoVoiceoverAlignment(text, {
      characters,
      characterStartSeconds: characters.map((_, index) => index * 0.1),
      characterEndSeconds: characters.map((_, index) => (index + 1) * 0.1),
    });
    expect(alignment.characters.map((character) => character.text).join('')).toBe(text);
    expect(alignment.words.map((word) => [word.text, word.startMs, word.endMs])).toEqual([
      ['Hi', 0, 200],
      ['all', 300, 600],
    ]);
    expect(alignment.durationMs).toBe(600);
  });

  it('adds generated audio while preserving every imported original clip', () => {
    const imported = {
      ...createEditorAudioClip('imported-dialogue-node', 0, { sourceInMs: 1_000, sourceOutMs: 8_000 }),
      id: 'imported-original',
      volumePercent: 83,
      professional: { linkGroupId: 'camera-av', pan: -0.3, busId: 'dialogue' },
    };
    const provenance = createVideoGeneratedAudioProvenance({
      role: 'voiceover', provider, requestId: 'tts-request', generatedAt: '2026-08-17T12:00:00.000Z',
      originalReferenceIds: ['imported-original'], rightsAttestationId: 'rights-1',
      paragraph: { id: 'paragraph-1', revision: 2 },
    });
    const asset: VideoGeneratedAudioAsset = {
      id: 'generated-asset',
      sourceNodeId: 'generated-source-node',
      label: 'Voiceover paragraph 1',
      durationMs: 2_500,
      mimeType: 'audio/wav',
      provenance,
    };
    const proposal = buildVideoGeneratedAudioPlacementProposal({
      existingAudioClips: [imported], generatedAsset: asset, clipId: 'generated-clip',
      trackIndex: 1, startMs: 10_000, busId: 'voiceover',
    });
    const result = applyVideoGeneratedAudioPlacement([imported], proposal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preservedOriginalClipIds).toEqual(['imported-original']);
    expect(result.audioClips.find((clip) => clip.id === 'imported-original')).toEqual(imported);
    expect(result.audioClips.find((clip) => clip.id === 'generated-clip')).toMatchObject({
      sourceNodeId: 'generated-source-node',
      offsetMs: 10_000,
      sourceInMs: 0,
      sourceOutMs: 2_500,
      professional: { busId: 'voiceover' },
    });
    expect(provenance).toMatchObject({
      origin: 'generated',
      providerId: 'provider-optional',
      modelId: 'multilingual-voice-v1',
      requestId: 'tts-request',
      originalReferenceIds: ['imported-original'],
      paragraphId: 'paragraph-1',
      paragraphRevision: 2,
    });
  });

  it('rejects range SFX beyond the short-form boundary', () => {
    expect(() => createVideoRangeSfxRequest({
      requestId: 'sfx-too-long', provider, prompt: 'Long ambience',
      timelineStartMs: 0, timelineEndMs: 30_001,
      rightsAttestationId: 'rights-1', billingConsentId: 'billing-1',
    })).toThrow(/no longer than 30 seconds/i);
  });
});
