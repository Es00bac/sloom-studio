import { describe, expect, it } from 'vitest';
import type { VideoProvider } from '../../types/flow';
import { FALLBACK_MODEL_OPTIONS } from '../providerCatalog';
import { getProviderModelContract } from '../providerModelContracts';
import {
  getVideoModelContract,
  getVideoModelSupport,
  VIDEO_MODEL_CONTRACTS,
} from './videoModelContracts';

describe('video model contracts', () => {
  it('maps every normal video option to a shared request contract', () => {
    for (const [providerId, options] of Object.entries(FALLBACK_MODEL_OPTIONS.video) as Array<[
      VideoProvider,
      Array<{ value: string; label: string }>,
    ]>) {
      for (const option of options) {
        const contract = getProviderModelContract(VIDEO_MODEL_CONTRACTS, providerId, option.value);
        expect(contract, `${providerId}/${option.value}`).toBeDefined();
        expect(contract?.outputModalities).toContain('video');
        expect(contract?.operations.length).toBeGreaterThan(0);
        expect(contract?.requestBuilder).toBeTruthy();
        if (contract?.lifecycle !== 'unverified') {
          expect(contract?.evidence.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('encodes Omni as Interactions video generation/editing without Veo-only controls', () => {
    const contract = getVideoModelContract('gemini', 'gemini-omni-flash-preview');
    const support = getVideoModelSupport('gemini', 'gemini-omni-flash-preview');

    expect(contract).toMatchObject({
      apiFamily: 'google-interactions',
      endpoint: '/v1beta/interactions',
      lifecycle: 'preview',
      requestBuilder: 'google-interactions',
    });
    expect(contract.operations).toEqual(expect.arrayContaining([
      'text-to-video',
      'image-to-video',
      'reference-to-video',
      'video-edit',
    ]));
    expect(support).toMatchObject({
      imageToVideo: true,
      interpolation: false,
      referenceImages: true,
      videoExtension: false,
      maxReferenceImages: 3,
      negativePrompt: false,
      fixedResolution: '720p',
    });
  });

  it('keeps current Gemini Veo preview IDs distinct from Vertex GA IDs', () => {
    expect(getVideoModelContract('gemini', 'veo-3.1-generate-preview')).toMatchObject({
      lifecycle: 'preview',
      availability: 'documented',
    });
    expect(getVideoModelContract('gemini', 'veo-3.1-generate-001')).toMatchObject({
      lifecycle: 'stable',
      availability: 'account-dependent',
    });
    expect(getVideoModelContract('gemini', 'veo-3.1-lite-generate-preview').operations).not.toContain('video-extension');
    expect(getVideoModelSupport('gemini', 'veo-3.1-lite-generate-preview')).toMatchObject({
      referenceImages: false,
      videoExtension: false,
      maxResolution: '1080p',
    });
  });

  it('retains shut-down Veo 3 only for saved-flow diagnostics', () => {
    expect(getVideoModelContract('gemini', 'veo-3.0-generate-001')).toMatchObject({
      lifecycle: 'shutdown',
      availability: 'unavailable',
      shutdownAt: '2026-06-30',
      migrationModelId: 'veo-3.1-generate-preview',
    });
    expect(FALLBACK_MODEL_OPTIONS.video.gemini.map((option) => option.value)).not.toContain(
      'veo-3.0-generate-001',
    );
  });

  it('keeps unknown discovered video IDs selectable with safe text-only semantics', () => {
    const contract = getVideoModelContract('atlas', 'vendor/new-video-model');
    expect(contract).toMatchObject({
      lifecycle: 'unverified',
      availability: 'live',
      operations: ['text-to-video'],
    });
    expect(contract.parameters.map((parameter) => parameter.id)).toEqual(['prompt']);
  });
});
