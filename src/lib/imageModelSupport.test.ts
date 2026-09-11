import { describe, expect, it } from 'vitest';
import {
  IMAGE_MASK_HANDLE,
  IMAGE_REFERENCE_HANDLES,
  isImageMaskHandle,
  supportsImageEditing,
  supportsImageReferenceGuidance,
  supportsImageSearchReplace,
  supportsTrueMaskInpaint,
} from './imageModelSupport';

describe('imageModelSupport', () => {
  it('uses model capability metadata for BFL and Stability image editing support', () => {
    expect(supportsImageEditing('bfl', 'flux-2-pro')).toBe(true);
    expect(supportsImageReferenceGuidance('bfl', 'flux-2-pro')).toBe(true);
    expect(supportsTrueMaskInpaint('stability', 'stable-image-edit-inpaint')).toBe(true);
    expect(supportsImageSearchReplace('stability', 'stable-image-edit-search-replace')).toBe(true);
  });

  it('keeps edit-only Stability models from advertising generic reference guidance', () => {
    expect(supportsImageReferenceGuidance('stability', 'stable-image-edit-search-replace')).toBe(false);
  });

  it('exposes multi-reference and mask handles for capability-specific image nodes', () => {
    expect(IMAGE_REFERENCE_HANDLES).toHaveLength(14);
    expect(IMAGE_REFERENCE_HANDLES.at(-1)).toBe('image-reference-14');
    expect(IMAGE_MASK_HANDLE).toBe('image-mask');
    expect(isImageMaskHandle('image-mask')).toBe(true);
    expect(isImageMaskHandle('image-edit-source')).toBe(false);
  });
});
