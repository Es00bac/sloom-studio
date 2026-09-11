import { describe, expect, it } from 'vitest';
import {
  buildVertexGeminiImageRequestBody,
  buildVertexImagenUpscaleRequestBody,
  buildVertexImagenPredictRequestBody,
  dataUrlToVertexInlineImage,
  extractVertexGeneratedImage,
  getVertexImageRoute,
  isVertexImagenModelId,
  VERTEX_IMAGEN_UPSCALE_MODEL_ID,
} from './vertexImageRequests';

describe('vertex image request helpers', () => {
  it('builds the Vertex Gemini generateContent image body used by gcloud ADC', () => {
    expect(
      buildVertexGeminiImageRequestBody({
        prompt: 'Generate a 16:9 comic panel.',
        aspectRatio: '16:9',
        sourceImage: { mimeType: 'image/png', data: 'SOURCE' },
        references: [{ image: { mimeType: 'image/jpeg', data: 'REFERENCE' } }],
      }),
    ).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Generate a 16:9 comic panel.' },
            { inlineData: { mimeType: 'image/png', data: 'SOURCE' } },
            { inlineData: { mimeType: 'image/jpeg', data: 'REFERENCE' } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: '16:9',
        },
      },
    });
  });

  it('places numbered reference guidance immediately before its own image part (AUD-011)', () => {
    const body = buildVertexGeminiImageRequestBody({
      prompt: 'Compose the hero shot.',
      aspectRatio: '1:1',
      references: [
        { image: { mimeType: 'image/png', data: 'FIRST' }, instruction: 'Reference 1: preserve logo' },
        { image: { mimeType: 'image/png', data: 'SECOND' } },
      ],
    }) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    expect(body.contents[0].parts).toEqual([
      { text: 'Compose the hero shot.' },
      { text: 'Reference 1: preserve logo' },
      { inlineData: { mimeType: 'image/png', data: 'FIRST' } },
      { inlineData: { mimeType: 'image/png', data: 'SECOND' } },
    ]);
  });

  it('includes the Gemini 3.x image_size tier only when requested', () => {
    const withSize = buildVertexGeminiImageRequestBody({
      prompt: 'Poster-resolution hero panel.',
      aspectRatio: '16:9',
      imageSize: '4K',
    }) as { generationConfig: { imageConfig: Record<string, unknown> } };
    expect(withSize.generationConfig.imageConfig).toEqual({ aspectRatio: '16:9', imageSize: '4K' });

    const withoutSize = buildVertexGeminiImageRequestBody({
      prompt: 'Default-resolution panel.',
      aspectRatio: '16:9',
    }) as { generationConfig: { imageConfig: Record<string, unknown> } };
    expect(withoutSize.generationConfig.imageConfig).toEqual({ aspectRatio: '16:9' });
  });

  it('builds the Vertex Imagen predict body with explicit aspect ratio and sample count', () => {
    expect(
      buildVertexImagenPredictRequestBody({
        prompt: 'A clean text-free panel background.',
        aspectRatio: '4:3',
      }),
    ).toEqual({
      instances: [{ prompt: 'A clean text-free panel background.' }],
      parameters: {
        sampleCount: 1,
        aspectRatio: '4:3',
      },
    });
  });

  it('builds the Vertex Imagen upscale body used by Paper print upscale', () => {
    expect(VERTEX_IMAGEN_UPSCALE_MODEL_ID).toBe('imagen-4.0-upscale-preview');
    expect(dataUrlToVertexInlineImage('data:image/jpeg;base64,SOURCE')).toEqual({
      mimeType: 'image/jpeg',
      data: 'SOURCE',
    });
    expect(
      buildVertexImagenUpscaleRequestBody({
        image: { mimeType: 'image/jpeg', data: 'SOURCE' },
        outputMimeType: 'image/png',
        upscaleFactor: 'x3',
      }),
    ).toEqual({
      instances: [
        {
          prompt: 'Upscale the image',
          image: {
            bytesBase64Encoded: 'SOURCE',
          },
        },
      ],
      parameters: {
        mode: 'upscale',
        outputOptions: {
          mimeType: 'image/png',
        },
        upscaleConfig: {
          upscaleFactor: 'x3',
        },
      },
    });
  });

  it('routes Imagen model IDs to predict and Gemini image IDs to generateContent', () => {
    expect(isVertexImagenModelId('imagen-4.0-ultra-generate-001')).toBe(true);
    expect(getVertexImageRoute('imagen-4.0-fast-generate-001')).toBe('imagen-predict');
    expect(getVertexImageRoute('gemini-3-pro-image-preview')).toBe('gemini-generate-content');
  });

  it('extracts generated inline images from Gemini and Imagen Vertex responses', () => {
    expect(
      extractVertexGeneratedImage({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: 'GEMINI' } }],
            },
          },
        ],
      }),
    ).toEqual({ mimeType: 'image/png', data: 'GEMINI' });

    expect(
      extractVertexGeneratedImage({
        predictions: [{ mimeType: 'image/jpeg', bytesBase64Encoded: 'IMAGEN' }],
      }),
    ).toEqual({ mimeType: 'image/jpeg', data: 'IMAGEN' });
  });
});
