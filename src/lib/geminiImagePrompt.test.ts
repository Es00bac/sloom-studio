import { describe, expect, it } from 'vitest';
import { buildGeminiImagePrompt } from './geminiImagePrompt';

describe('buildGeminiImagePrompt', () => {
  it('wraps source-image edits with explicit edit instructions', () => {
    expect(
      buildGeminiImagePrompt('Turn this into a watercolor painting.', {
        hasSourceImage: true,
        referenceImageCount: 0,
      }),
    ).toContain('Edit the attached source image');
  });

  it('distinguishes the source image from attached references', () => {
    const prompt = buildGeminiImagePrompt('Put the reference outfit on the source person.', {
      hasSourceImage: true,
      referenceImageCount: 2,
    });

    expect(prompt).toContain('first attached image as the source image');
    expect(prompt).toContain('remaining 2 attached images as reference guidance only');
  });

  it('describes reference-only image generation when no base image is connected', () => {
    expect(
      buildGeminiImagePrompt('Generate a movie poster with this same costume style.', {
        hasSourceImage: false,
        referenceImageCount: 1,
      }),
    ).toContain('Generate a new image using the attached reference image');
  });
});
