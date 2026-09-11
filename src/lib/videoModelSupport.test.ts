import { describe, expect, it } from 'vitest';
import {
  filterGeminiVideoModelsForConditioning,
  isExplicitVideoFrameHandle,
  isGeminiOmniModelId,
  isVideoExtensionHandle,
  isVideoImageConditioningHandle,
  isVideoReferenceHandle,
  normalizeGeminiVideoModelId,
  supportsGeminiFrameConditioning,
  supportsGeminiReferenceImages,
  supportsGeminiVideoExtension,
} from './videoModelSupport';

describe('normalizeGeminiVideoModelId', () => {
  it('maps legacy aliases without rewriting current Gemini preview IDs to Vertex IDs', () => {
    expect(normalizeGeminiVideoModelId('veo-3.1')).toBe('veo-3.1-generate-preview');
    expect(normalizeGeminiVideoModelId('veo-3.1-fast')).toBe('veo-3.1-fast-generate-preview');
    expect(normalizeGeminiVideoModelId('veo-3.1-generate-preview')).toBe('veo-3.1-generate-preview');
    expect(normalizeGeminiVideoModelId('veo-3-generate-preview')).toBe('veo-3.0-generate-001');
    expect(normalizeGeminiVideoModelId('gemini-omni-flash')).toBe('gemini-omni-flash-preview');
  });
});

describe('isGeminiOmniModelId', () => {
  it('recognizes live-announced Gemini Omni model ids without treating Veo as Omni', () => {
    expect(isGeminiOmniModelId('gemini-omni-flash-preview')).toBe(true);
    expect(isGeminiOmniModelId('gemini-omni-flash')).toBe(true);
    expect(isGeminiOmniModelId('models/gemini-omni')).toBe(false);
    expect(isGeminiOmniModelId('veo-3.1-generate-preview')).toBe(false);
  });
});

describe('supportsGeminiFrameConditioning', () => {
  it('accepts current Gemini image-to-video capable Veo models', () => {
    expect(supportsGeminiFrameConditioning('veo-3.1-generate-preview')).toBe(true);
    expect(supportsGeminiFrameConditioning('veo-3.1-fast-generate-preview')).toBe(true);
    expect(supportsGeminiFrameConditioning('veo-3.1-generate-001')).toBe(true);
    expect(supportsGeminiFrameConditioning('veo-3.1-fast-generate-001')).toBe(true);
    expect(supportsGeminiFrameConditioning('veo-3.1')).toBe(true);
    expect(supportsGeminiFrameConditioning('veo-3.1-fast')).toBe(true);
    expect(supportsGeminiFrameConditioning('gemini-omni-flash')).toBe(false);
  });

  it('accepts documented Lite interpolation but rejects missing model ids', () => {
    expect(supportsGeminiFrameConditioning('veo-3.1-lite-preview')).toBe(true);
    expect(supportsGeminiFrameConditioning('')).toBe(false);
  });
});

describe('supportsGeminiReferenceImages', () => {
  it('only accepts Veo 3.1 and Veo 3.1 Fast for reference images', () => {
    expect(supportsGeminiReferenceImages('veo-3.1-generate-preview')).toBe(true);
    expect(supportsGeminiReferenceImages('veo-3.1-fast-generate-preview')).toBe(true);
    expect(supportsGeminiReferenceImages('veo-3.1-generate-001')).toBe(true);
    expect(supportsGeminiReferenceImages('veo-3.1-fast-generate-001')).toBe(true);
    expect(supportsGeminiReferenceImages('gemini-omni-flash-preview')).toBe(true);
    expect(supportsGeminiReferenceImages('veo-3-generate-preview')).toBe(false);
  });
});

describe('supportsGeminiVideoExtension', () => {
  it('only accepts Veo 3.1 and Veo 3.1 Fast for video extension', () => {
    expect(supportsGeminiVideoExtension('veo-3.1-generate-preview')).toBe(true);
    expect(supportsGeminiVideoExtension('veo-3.1-fast-generate-preview')).toBe(true);
    expect(supportsGeminiVideoExtension('veo-3.1-generate-001')).toBe(true);
    expect(supportsGeminiVideoExtension('veo-3.1-fast-generate-001')).toBe(true);
    expect(supportsGeminiVideoExtension('gemini-omni-flash-preview')).toBe(false);
    expect(supportsGeminiVideoExtension('veo-3.1-lite-generate-preview')).toBe(false);
    expect(supportsGeminiVideoExtension('veo-3-generate-preview')).toBe(false);
  });
});

describe('filterGeminiVideoModelsForConditioning', () => {
  it('keeps only Gemini video options that support advanced conditioning', () => {
    const options = [
      { value: 'veo-3.1-lite-preview', label: 'Veo 3.1 Lite' },
      { value: 'gemini-omni-flash-preview', label: 'Gemini Omni Flash Preview' },
      { value: 'veo-3.1-fast-generate-001', label: 'Veo 3.1 Fast' },
      { value: 'veo-3-generate-preview', label: 'Veo 3' },
      { value: 'veo-3.1-generate-001', label: 'Veo 3.1' },
    ];

    expect(filterGeminiVideoModelsForConditioning(options)).toEqual([
      { value: 'veo-3.1-lite-preview', label: 'Veo 3.1 Lite' },
      { value: 'gemini-omni-flash-preview', label: 'Gemini Omni Flash Preview' },
      { value: 'veo-3.1-fast-generate-001', label: 'Veo 3.1 Fast' },
      { value: 'veo-3.1-generate-001', label: 'Veo 3.1' },
    ]);
  });
});

describe('isExplicitVideoFrameHandle', () => {
  it('treats only the dedicated start/end frame handles as valid frame inputs', () => {
    expect(isExplicitVideoFrameHandle('video-start-frame')).toBe(true);
    expect(isExplicitVideoFrameHandle('video-end-frame')).toBe(true);
    expect(isExplicitVideoFrameHandle('video-prompt')).toBe(false);
    expect(isExplicitVideoFrameHandle('video-reference-1')).toBe(false);
    expect(isExplicitVideoFrameHandle(undefined)).toBe(false);
  });
});

describe('video handle helpers', () => {
  it('classifies reference-image and extension handles', () => {
    expect(isVideoReferenceHandle('video-reference-1')).toBe(true);
    expect(isVideoReferenceHandle('video-reference-3')).toBe(true);
    expect(isVideoReferenceHandle('video-start-frame')).toBe(false);
    expect(isVideoImageConditioningHandle('video-reference-2')).toBe(true);
    expect(isVideoImageConditioningHandle('video-start-frame')).toBe(true);
    expect(isVideoImageConditioningHandle('video-source-video')).toBe(false);
    expect(isVideoExtensionHandle('video-source-video')).toBe(true);
    expect(isVideoExtensionHandle('video-reference-1')).toBe(false);
  });
});
