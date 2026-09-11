import { describe, expect, it } from 'vitest';
import { buildGeminiVideoRequest } from './geminiVideoRequest';

describe('buildGeminiVideoRequest', () => {
  it('builds the minimal documented REST shape for plain text-to-video', () => {
    const request = buildGeminiVideoRequest(
      {
        prompt: 'looping bear prompt',
      },
      {
        aspectRatio: '16:9',
        durationSeconds: 4,
        videoResolution: '720p',
      },
    );

    expect(request.instances[0].prompt).toBe('looping bear prompt');
    expect(request.parameters?.durationSeconds).toBe(4);
    expect(request.parameters?.resolution).toBe('720p');
  });

  it('serializes negative prompts and sample counts when supplied', () => {
    const request = buildGeminiVideoRequest(
      {
        prompt: 'cinematic city flythrough',
      },
      {
        aspectRatio: '16:9',
        durationSeconds: 6,
        videoResolution: '720p',
        negativePrompt: 'blur, low detail',
        sampleCount: 3,
      },
    );

    expect(request.parameters?.negativePrompt).toBe('blur, low detail');
    expect(request.parameters?.sampleCount).toBe(1);
    expect(request.parameters?.personGeneration).toBe('allow_all');
  });

  it('maps interpolation inputs onto the Gemini video MLDev image fields', () => {
    const request = buildGeminiVideoRequest(
      {
        prompt: 'looping bear prompt',
        startImage: {
          mimeType: 'image/png',
          imageBytes: 'AAA',
        },
        endImage: {
          mimeType: 'image/png',
          imageBytes: 'BBB',
        },
      },
      {
        aspectRatio: '16:9',
        durationSeconds: 8,
        videoResolution: '1080p',
      },
    );

    expect(request.instances[0].image).toEqual({
      bytesBase64Encoded: 'AAA',
      mimeType: 'image/png',
    });
    expect(request.instances[0].lastFrame).toEqual({
      bytesBase64Encoded: 'BBB',
      mimeType: 'image/png',
    });
    expect(request.parameters?.personGeneration).toBe('allow_adult');
  });

  it('maps reference-image guidance to the REST referenceImages shape', () => {
    const request = buildGeminiVideoRequest(
      {
        prompt: 'stylized cyberpunk portrait walk',
        referenceImages: [
          {
            image: {
              mimeType: 'image/png',
              imageBytes: 'AAA',
            },
            referenceType: 'asset',
          },
          {
            image: {
              mimeType: 'image/png',
              imageBytes: 'BBB',
            },
            referenceType: 'style',
          },
        ],
      },
      {
        aspectRatio: '9:16',
        durationSeconds: 8,
        videoResolution: '720p',
        seed: 42,
      },
    );

    expect(request.instances[0].referenceImages).toEqual([
      {
        image: {
          bytesBase64Encoded: 'AAA',
          mimeType: 'image/png',
        },
        referenceType: 'asset',
      },
      {
        image: {
          bytesBase64Encoded: 'BBB',
          mimeType: 'image/png',
        },
        referenceType: 'style',
      },
    ]);
    expect(request.parameters?.seed).toBe(42);
    expect(request.parameters?.personGeneration).toBe('allow_adult');
  });

  it('maps video extension to the documented REST video field', () => {
    const request = buildGeminiVideoRequest(
      {
        prompt: 'extend the scene with a slow camera pullback',
        extensionVideo: {
          mimeType: 'video/mp4',
          videoBytes: 'CCC',
        },
      },
      {
        aspectRatio: '16:9',
        durationSeconds: 8,
        videoResolution: '720p',
      },
    );

    expect(request.instances[0].video).toEqual({
      encodedVideo: 'CCC',
      encoding: 'video/mp4',
    });
    expect(request.parameters?.personGeneration).toBe('allow_all');
  });
});
