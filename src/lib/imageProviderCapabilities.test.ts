import { describe, expect, it } from 'vitest';
import { FALLBACK_MODEL_OPTIONS } from './providerCatalog';
import type { ImageProvider } from '../types/flow';
import {
  estimateImageModelCostUsd,
  getImageModelCapabilities,
  getImageModelDefinition,
  getImageNodeControlModel,
  hasRegisteredImageModelDefinition,
  listImageModelDefinitions,
  listImageModelPricingEntries,
  listImageProviderHelpEntries,
  listImageProviderIds,
} from './imageProviderCapabilities';

describe('imageProviderCapabilities', () => {
  it('lists every first-class cloud/local image provider needed by the Image node', () => {
    expect(listImageProviderIds()).toEqual(expect.arrayContaining([
      'gemini',
      'openai',
      'atlas',
      'byteplus',
      'bfl',
      'stability',
      'huggingface',
      'localOpen',
      'android',
    ]));
  });

  it('describes BFL FLUX.2 Pro as a multi-reference text/image editing model', () => {
    expect(getImageModelDefinition('bfl', 'flux-2-pro')).toMatchObject({
      providerId: 'bfl',
      modelId: 'flux-2-pro',
      label: 'FLUX.2 Pro',
    });

    expect(getImageModelCapabilities('bfl', 'flux-2-pro')).toMatchObject({
      textToImage: true,
      imageToImage: true,
      promptEdit: true,
      referenceImages: true,
      maxReferenceImages: 8,
      exactColorControl: true,
      typography: true,
      maxOutputMegapixels: 4,
    });
  });

  it('estimates BFL FLUX.2 pricing separately for generation and image editing', () => {
    expect(estimateImageModelCostUsd({
      providerId: 'bfl',
      modelId: 'flux-2-pro',
      operation: 'text-to-image',
      outputMegapixels: 1,
      imageCount: 1,
    })).toMatchObject({
      costUsd: 0.03,
      confidence: 'published-minimum',
      unitLabel: 'from $0.03/image',
    });

    expect(estimateImageModelCostUsd({
      providerId: 'bfl',
      modelId: 'flux-2-pro',
      operation: 'image-edit',
      outputMegapixels: 1,
      imageCount: 2,
    })).toMatchObject({
      costUsd: 0.09,
      confidence: 'published-minimum',
      unitLabel: 'from $0.045/edit',
    });
  });

  it('describes Stability search and replace as an edit-only operation with a search prompt control', () => {
    const controls = getImageNodeControlModel('stability', 'stable-image-edit-search-replace');

    expect(controls.supportedOperations).toContain('search-replace');
    expect(controls.visibleControls).toEqual(expect.arrayContaining([
      'prompt',
      'sourceImage',
      'searchPrompt',
      'outputFormat',
    ]));
    expect(controls.visibleControls).not.toContain('aspectRatio');

    expect(estimateImageModelCostUsd({
      providerId: 'stability',
      modelId: 'stable-image-edit-search-replace',
      operation: 'search-replace',
      imageCount: 1,
    })).toMatchObject({
      costUsd: 0.05,
      confidence: 'published-fixed',
      unitLabel: '5 credits',
    });
  });

  it('treats local/open Qwen editing as provider-defined cost rather than always free', () => {
    expect(getImageModelCapabilities('localOpen', 'Qwen/Qwen-Image-Edit')).toMatchObject({
      imageToImage: true,
      promptEdit: true,
      textInImageEditing: true,
      localEndpoint: true,
    });

    expect(estimateImageModelCostUsd({
      providerId: 'localOpen',
      modelId: 'Qwen/Qwen-Image-Edit',
      operation: 'image-edit',
      imageCount: 1,
    })).toMatchObject({
      costUsd: undefined,
      confidence: 'provider-defined',
      unitLabel: 'local/provider-defined',
    });
  });

  it('describes Atlas Cloud native text-to-image models with their model-specific node controls and pricing', () => {
    const fluxDevLora = getImageNodeControlModel('atlas', 'black-forest-labs/flux-dev-lora');

    expect(fluxDevLora.supportedOperations).toContain('text-to-image');
    // Controls derive from the documented flux-dev-lora schema: prompt/size(+custom dimensions)/seed/
    // guidance_scale/loras + exact-colour prompt. It has no num_inference_steps or output_format field.
    expect(fluxDevLora.visibleControls).toEqual(expect.arrayContaining([
      'prompt',
      'aspectRatio',
      'dimensions',
      'seed',
      'guidanceScale',
      'loraWeights',
    ]));

    expect(estimateImageModelCostUsd({
      providerId: 'atlas',
      modelId: 'black-forest-labs/flux-schnell',
      operation: 'text-to-image',
      imageCount: 1,
    })).toMatchObject({
      costUsd: 0.003,
      confidence: 'published-fixed',
      unitLabel: '$0.003/image',
    });

    expect(estimateImageModelCostUsd({
      providerId: 'atlas',
      modelId: 'black-forest-labs/flux-dev',
      operation: 'text-to-image',
      imageCount: 1,
    })).toMatchObject({
      costUsd: 0.012,
      confidence: 'published-fixed',
      unitLabel: '$0.012/image',
    });

    expect(estimateImageModelCostUsd({
      providerId: 'atlas',
      modelId: 'z-image/turbo',
      operation: 'text-to-image',
      imageCount: 1,
    })).toMatchObject({
      costUsd: 0.005,
      confidence: 'published-fixed',
      unitLabel: '$0.005/image',
    });
  });

  it('describes Atlas Cloud native edit models with source, mask, reference, and text editing controls', () => {
    // flux-kontext-dev takes a SINGLE `image` (its documented schema) — an edit/source control, not a
    // multi-reference budget. (The previous catalog wrongly advertised 4 reference images.)
    const kontext = getImageNodeControlModel('atlas', 'black-forest-labs/flux-kontext-dev');
    expect(kontext.supportedOperations).toContain('image-edit');
    expect(kontext.capabilities.referenceImages).toBe(false);
    expect(kontext.visibleControls).toEqual(expect.arrayContaining([
      'prompt',
      'sourceImage',
      'guidanceScale',
      'seed',
    ]));

    const qwenEdit = getImageNodeControlModel('atlas', 'atlascloud/qwen-image/edit');
    expect(qwenEdit.supportedOperations).toContain('image-edit');
    // Qwen edit has no mask field in its Atlas schema — no 'mask' control, no maskInpaint capability.
    expect(qwenEdit.supportedOperations).not.toContain('mask-inpaint');
    expect(qwenEdit.visibleControls).toEqual(expect.arrayContaining([
      'prompt',
      'sourceImage',
      'textEditPrompt',
    ]));
    expect(qwenEdit.visibleControls).not.toContain('mask');
    expect(getImageModelCapabilities('atlas', 'atlascloud/qwen-image/edit')).toMatchObject({
      imageToImage: true,
      promptEdit: true,
      maskInpaint: false,
      textInImageEditing: true,
    });

    expect(estimateImageModelCostUsd({
      providerId: 'atlas',
      modelId: 'atlascloud/qwen-image/edit',
      operation: 'image-edit',
      imageCount: 1,
    })).toMatchObject({
      costUsd: 0.032,
      confidence: 'published-fixed',
      unitLabel: '$0.032/edit',
    });
  });

  it('has setup/help entries for all first-class providers', () => {
    const helpProviderIds = listImageProviderHelpEntries().map((entry) => entry.providerId);

    expect(helpProviderIds).toEqual(expect.arrayContaining(listImageProviderIds()));
  });

  it('treats Stability erase as a dedicated masked cleanup operation', () => {
    const controls = getImageNodeControlModel('stability', 'stable-image-edit-erase');

    expect(controls.supportedOperations).toContain('erase');
    expect(controls.visibleControls).toEqual(expect.arrayContaining([
      'sourceImage',
      'mask',
      'outputFormat',
    ]));
    expect(controls.visibleControls).not.toContain('aspectRatio');

    expect(estimateImageModelCostUsd({
      providerId: 'stability',
      modelId: 'stable-image-edit-erase',
      operation: 'erase',
      imageCount: 1,
    })).toMatchObject({
      costUsd: 0.05,
      confidence: 'published-fixed',
      unitLabel: '5 credits',
    });
  });

  it('records source-backed pricing metadata for every visible image model operation', () => {
    const pricingEntries = listImageModelPricingEntries();
    const pricingKeys = new Set(
      pricingEntries.map((entry) => `${entry.providerId}:${entry.modelId}:${entry.operation}`),
    );

    for (const definition of listImageModelDefinitions()) {
      for (const operation of definition.supportedOperations) {
        expect(pricingKeys.has(`${definition.providerId}:${definition.modelId}:${operation}`)).toBe(true);
      }
    }

    for (const entry of pricingEntries) {
      expect(entry.sourceUrl).toMatch(/^https:\/\//);
      expect(entry.lastVerifiedDate).toBe('2026-05-24');
      expect(entry.visibility).toMatch(/^(exact|estimated|local-or-provider-defined|unknown-disabled)$/);
      expect(entry.unit).not.toHaveLength(0);
      expect(entry.freeTierOrCredits).not.toHaveLength(0);
    }
  });

  it('has an explicit capability registry entry for every fallback image model shown in the model picker', () => {
    for (const [providerId, options] of Object.entries(FALLBACK_MODEL_OPTIONS.image) as Array<[
      ImageProvider,
      Array<{ value: string; label: string }>,
    ]>) {
      for (const option of options) {
        expect(hasRegisteredImageModelDefinition(providerId, option.value), `${providerId}:${option.value}`).toBe(true);
        expect(getImageModelDefinition(providerId, option.value), `${providerId}:${option.value}`).toMatchObject({
          providerId,
          modelId: option.value,
        });
      }
    }
  });

  it('expands provider help cards into setup, operation, spend-control, and troubleshooting wiki content', () => {
    for (const entry of listImageProviderHelpEntries()) {
      expect(entry.setupSteps.length).toBeGreaterThan(1);
      expect(entry.supportedOperations.length).toBeGreaterThan(0);
      expect(entry.spendControls.length).toBeGreaterThan(0);
      expect(entry.troubleshooting.length).toBeGreaterThan(0);
      expect(entry.lastVerifiedDate).toBe('2026-05-24');
    }
  });
});
