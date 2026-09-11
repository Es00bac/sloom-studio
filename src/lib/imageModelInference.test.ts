import { describe, expect, it } from 'vitest';
import { inferImageModelCapabilities } from './imageModelInference';
import { getImageModelDefinition } from './imageProviderCapabilities';

describe('inferImageModelCapabilities', () => {
  it('nano-banana reference-to-image exposes references with a high max', () => {
    const inferred = inferImageModelCapabilities('atlas', 'google/nano-banana-2/reference-to-image');
    expect(inferred.capabilities.referenceImages).toBe(true);
    expect(inferred.capabilities.maxReferenceImages).toBeGreaterThanOrEqual(3);
    expect(inferred.supportedOperations).toContain('image-edit');
    expect(inferred.visibleControls).toContain('referenceImages');
  });
  it('nano-banana text-to-image is generation-only with typography', () => {
    const inferred = inferImageModelCapabilities('atlas', 'google/nano-banana-2/text-to-image');
    expect(inferred.capabilities.textToImage).toBe(true);
    expect(inferred.capabilities.imageToImage).toBe(false);
    expect(inferred.capabilities.typography).toBe(true);
  });
  it('strips -developer and treats nano-banana edit-developer as an edit with references', () => {
    const inferred = inferImageModelCapabilities('atlas', 'google/nano-banana-2/edit-developer');
    expect(inferred.capabilities.imageToImage).toBe(true);
    expect(inferred.capabilities.referenceImages).toBe(true);
    expect(inferred.supportedOperations).toContain('image-edit');
  });
  it('qwen edit exposes prompt-edit, mask inpaint and text-in-image editing', () => {
    const inferred = inferImageModelCapabilities('atlas', 'qwen/qwen-image-2.0/edit');
    expect(inferred.capabilities.promptEdit).toBe(true);
    expect(inferred.capabilities.maskInpaint).toBe(true);
    expect(inferred.capabilities.textInImageEditing).toBe(true);
    expect(inferred.visibleControls).toContain('mask');
  });
  it('a flux fill/inpaint slug exposes mask inpaint', () => {
    const inferred = inferImageModelCapabilities('atlas', 'black-forest-labs/flux.1-fill-pro/inpaint');
    expect(inferred.capabilities.maskInpaint).toBe(true);
    expect(inferred.supportedOperations).toContain('mask-inpaint');
  });
  it('an unknown plain text-to-image slug still generates and stays conservative', () => {
    const inferred = inferImageModelCapabilities('atlas', 'somevendor/whatever/text-to-image');
    expect(inferred.capabilities.textToImage).toBe(true);
    expect(inferred.capabilities.referenceImages).toBe(false);
    expect(inferred.supportedOperations).toEqual(['text-to-image']);
  });
  it('an unknown edit slug edits but stays conservative on references', () => {
    const inferred = inferImageModelCapabilities('atlas', 'somevendor/whatever/edit');
    expect(inferred.capabilities.imageToImage).toBe(true);
    expect(inferred.capabilities.referenceImages).toBe(false);
  });
});

describe('getImageModelDefinition inference fallback', () => {
  it('an uncurated Atlas reference slug exposes references (not the t2i default)', () => {
    const def = getImageModelDefinition('atlas', 'totallyunseen/model-x/reference-to-image');
    expect(def.capabilities.referenceImages).toBe(true);
    expect(def.visibleControls).toContain('referenceImages');
    expect(def.modelId).toBe('totallyunseen/model-x/reference-to-image');
  });
});
