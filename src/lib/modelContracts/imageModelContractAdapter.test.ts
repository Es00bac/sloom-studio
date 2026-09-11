import { describe, expect, it } from 'vitest';
import type { ImageProvider } from '../../types/flow';
import {
  getImageModelDefinition,
  hasRegisteredImageModelDefinition,
} from '../imageProviderCapabilities';
import { inferImageModelCapabilities } from '../imageModelInference';
import { FALLBACK_MODEL_OPTIONS } from '../providerCatalog';
import { getProviderModelContract } from '../providerModelContracts';
import { IMAGE_MODEL_CONTRACTS } from './imageModelContractAdapter';

describe('image model contract adapter', () => {
  it('maps every normal image option to an exact registered definition and shared contract', () => {
    for (const [providerId, options] of Object.entries(FALLBACK_MODEL_OPTIONS.image) as Array<[
      ImageProvider,
      Array<{ value: string; label: string }>,
    ]>) {
      for (const option of options) {
        expect(
          hasRegisteredImageModelDefinition(providerId, option.value),
          `${providerId}/${option.value}`,
        ).toBe(true);

        const contract = getProviderModelContract(
          IMAGE_MODEL_CONTRACTS,
          providerId,
          option.value,
        );
        expect(contract, `${providerId}/${option.value}`).toBeDefined();
        expect(contract?.outputModalities).toContain('image');
        expect(contract?.operations.length).toBeGreaterThan(0);
        expect(contract?.requestBuilder).toBeTruthy();
        if (contract?.lifecycle !== 'unverified') {
          expect(contract?.evidence.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps unknown live models selectable but enables only safe endpoint-level controls', () => {
    const unknown = getImageModelDefinition('atlas', 'new-vendor/new-image-model');

    expect(unknown).toMatchObject({
      lifecycle: 'unverified',
      capabilityConfidence: 'unverified',
      supportedOperations: ['text-to-image'],
      visibleControls: ['prompt', 'outputFormat'],
      capabilities: {
        textToImage: true,
        imageToImage: false,
        referenceImages: false,
        customDimensions: false,
      },
    });
    expect(unknown.recommendedUse).toMatch(/not inferred from its name/i);
  });

  it('labels slug inference as unverified rather than verified capability evidence', () => {
    expect(inferImageModelCapabilities('atlas', 'vendor/flux-2-mystery/edit')).toMatchObject({
      confidence: 'unverified',
    });
  });

  it('records shut-down, deprecated, preview, and stable image lifecycles exactly', () => {
    expect(getImageModelDefinition('gemini', 'gemini-3.1-flash-image-preview')).toMatchObject({
      lifecycle: 'shutdown',
      shutdownAt: '2026-06-25',
      migrationModelId: 'gemini-3.1-flash-image',
    });
    expect(getImageModelDefinition('gemini', 'imagen-4.0-generate-001')).toMatchObject({
      lifecycle: 'deprecated',
      shutdownAt: '2026-08-17',
      migrationModelId: 'gemini-3.1-flash-image',
    });
    expect(getImageModelDefinition('bfl', 'flux-2-klein-9b-preview')).toMatchObject({
      lifecycle: 'preview',
    });
    expect(getImageModelDefinition('openai', 'gpt-image-2')).toMatchObject({
      lifecycle: 'stable',
      capabilityConfidence: 'verified',
    });
  });
});
