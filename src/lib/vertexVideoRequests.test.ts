import { describe, expect, it } from 'vitest';
import {
  buildVertexOmniVideoRequestBody,
  buildVertexVeoVideoRequestBody,
  extractVertexGeneratedVideo,
} from './vertexVideoRequests';

describe('Vertex video requests', () => {
  it('builds the Vertex Veo predictLongRunning body without Gemini API-key-only video fields', () => {
    const request = buildVertexVeoVideoRequestBody(
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
      bytesBase64Encoded: 'CCC',
      mimeType: 'video/mp4',
    });
    expect(request.instances[0].video).not.toHaveProperty('encodedVideo');
    expect(request.parameters).toMatchObject({
      aspectRatio: '16:9',
      durationSeconds: 8,
      resolution: '720p',
    });
  });

  it('builds the experimental Vertex Gemini Omni generateContent body with video output modality', () => {
    expect(buildVertexOmniVideoRequestBody({
      prompt: 'Make this character wave at camera.',
      media: [
        {
          instruction: 'Use this as the first visual reference.',
          inlineData: {
            mimeType: 'image/png',
            data: 'AAA',
          },
        },
      ],
    })).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Make this character wave at camera.' },
            { text: 'Use this as the first visual reference.' },
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'AAA',
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['VIDEO'],
      },
    });
  });

  it('extracts Vertex video outputs from inline, GCS, and Gemini-shaped operation payloads', () => {
    expect(extractVertexGeneratedVideo({
      response: {
        videos: [{
          bytesBase64Encoded: 'VIDEO',
          mimeType: 'video/mp4',
        }],
      },
    })).toEqual({
      data: 'VIDEO',
      mimeType: 'video/mp4',
    });

    expect(extractVertexGeneratedVideo({
      response: {
        videos: [{
          gcsUri: 'gs://bucket/object.mp4',
          mimeType: 'video/mp4',
        }],
      },
    })).toEqual({
      gcsUri: 'gs://bucket/object.mp4',
      mimeType: 'video/mp4',
    });

    expect(extractVertexGeneratedVideo({
      response: {
        generateVideoResponse: {
          generatedSamples: [{
            video: {
              uri: 'https://example.test/video.mp4',
              encoding: 'video/mp4',
            },
          }],
        },
      },
    })).toEqual({
      uri: 'https://example.test/video.mp4',
      mimeType: 'video/mp4',
    });
  });
});
