import { describe, expect, it } from 'vitest';

import {
  buildVertexGeminiTextRequestBody,
  extractVertexGeneratedText,
} from './vertexTextRequests';

describe('Vertex Gemini text requests', () => {
  it('builds a Vertex generateContent body with a user text prompt and JSON response config', () => {
    expect(buildVertexGeminiTextRequestBody({
      prompt: 'Organize this graph.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          nodes: { type: 'array' },
        },
      },
      maxOutputTokens: 4096,
      temperature: 0.1,
    })).toEqual({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: 'Organize this graph.',
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 4096,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            nodes: { type: 'array' },
          },
        },
      },
    });
  });

  it('extracts text from Vertex candidates', () => {
    expect(extractVertexGeneratedText({
      candidates: [
        {
          content: {
            parts: [
              { text: '{"nodes":[]}' },
              { text: '\n' },
            ],
          },
        },
      ],
    })).toBe('{"nodes":[]}');
  });
});
