import { describe, expect, it } from 'vitest';
import { getImageModelCapabilities, getImageNodeControlModel } from './imageProviderCapabilities';

describe('cross-provider nano-banana reference parity', () => {
  it('exposes references on Gemini and Atlas nano-banana routes alike', () => {
    // Gemini "nano banana" = gemini-3-pro-image (also used in Vertex-ADC mode)
    expect(getImageModelCapabilities('gemini', 'gemini-3-pro-image').referenceImages).toBe(true);
    // Atlas nano-banana-2 reference + edit routes must match
    expect(getImageModelCapabilities('atlas', 'google/nano-banana-2/reference-to-image').referenceImages).toBe(true);
    expect(getImageModelCapabilities('atlas', 'google/nano-banana-2/edit').referenceImages).toBe(true);
  });

  it('gives the Atlas nano-banana routes a comparable reference budget (per documented schemas)', () => {
    const gemini = getImageModelCapabilities('gemini', 'gemini-3-pro-image');
    // Atlas nano-banana-2/edit accepts up to 14 images — the same budget as the Gemini route.
    expect(getImageModelCapabilities('atlas', 'google/nano-banana-2/edit').maxReferenceImages).toBe(
      gemini.maxReferenceImages,
    );
    // The reference-to-image route documents a 10-image budget (still a strong multi-reference count).
    expect(
      getImageModelCapabilities('atlas', 'google/nano-banana-2/reference-to-image').maxReferenceImages,
    ).toBeGreaterThanOrEqual(10);
  });
});

describe('BFL reference + Stability mask audits', () => {
  it('BFL FLUX.2 Pro accepts multiple reference images', () => {
    const caps = getImageModelCapabilities('bfl', 'flux-2-pro');
    expect(caps.referenceImages).toBe(true);
    expect(caps.maxReferenceImages).toBeGreaterThanOrEqual(4);
  });
  it('Stability inpaint exposes mask inpainting', () => {
    expect(getImageModelCapabilities('stability', 'stable-image-edit-inpaint').maskInpaint).toBe(true);
  });
  it('Stability search-replace exposes word-driven editing (no manual mask)', () => {
    expect(getImageModelCapabilities('stability', 'stable-image-edit-search-replace').searchReplace).toBe(true);
  });
});

describe('unverified pricing surfaces provider-billed and still runs', () => {
  it('an inferred Atlas model shows a provider-billed label and remains runnable', () => {
    const model = getImageNodeControlModel('atlas', 'somevendor/whatever/text-to-image');
    expect(model.costEstimateLabel.toLowerCase()).toContain('provider-billed');
    expect(model.supportedOperations.length).toBeGreaterThan(0);
  });
});
