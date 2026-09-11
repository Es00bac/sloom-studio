import { describe, expect, it } from 'vitest';
import { validateGeminiVideoRequest } from './geminiVideoValidation';

const baseInput = {
  aspectRatio: '16:9' as const,
  durationSeconds: 6,
  videoResolution: '720p' as const,
  modelId: 'veo-3.1-fast-generate-preview',
  promptProvided: true,
  hasStartImage: false,
  hasEndImage: false,
  referenceImageCount: 0,
  hasExtensionVideo: false,
};

describe('validateGeminiVideoRequest', () => {
  it('allows 720p interpolation at 8 seconds for Veo 3.1 Fast', () => {
    expect(() =>
      validateGeminiVideoRequest({
        ...baseInput,
        durationSeconds: 8,
        hasStartImage: true,
        hasEndImage: true,
      }),
    ).not.toThrow();
  });

  it('rejects non-8-second interpolation renders', () => {
    expect(() =>
      validateGeminiVideoRequest({
        ...baseInput,
        durationSeconds: 6,
        hasStartImage: true,
        hasEndImage: true,
      }),
    ).toThrow(
      'Gemini Veo interpolation currently requires an 8-second duration when both start and end frames are provided.',
    );
  });

  it('rejects an end frame without a start frame', () => {
    expect(() =>
      validateGeminiVideoRequest({
        ...baseInput,
        hasStartImage: false,
        hasEndImage: true,
      }),
    ).toThrow('Gemini Veo interpolation requires a start frame when an end frame is provided.');
  });

  it('rejects non-8-second 4k renders', () => {
    expect(() =>
      validateGeminiVideoRequest({
        ...baseInput,
        durationSeconds: 6,
        videoResolution: '4k',
        modelId: 'veo-3.1-generate-preview',
      }),
    ).toThrow('Gemini Veo currently supports 1080p and 4k output only for 8-second videos.');
  });

  it('rejects frame conditioning on unsupported models', () => {
    expect(() =>
      validateGeminiVideoRequest({
        ...baseInput,
        durationSeconds: 8,
        modelId: 'veo-3-generate-preview',
        hasStartImage: true,
        hasEndImage: true,
      }),
    ).toThrow('Start/end-frame video generation currently requires Veo 3.1 or Veo 3.1 Fast.');
  });
});
