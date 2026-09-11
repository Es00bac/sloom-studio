import { describe, expect, it } from 'vitest';
import {
  buildGeminiTextConfig,
  buildGeminiTextInlinePart,
  isGeminiTextMediaInputSupported,
  resolveGeminiMediaResolutionLevel,
  type GeminiTextMediaInput,
} from './geminiTextModel';

describe('buildGeminiTextConfig', () => {
  it('maps text-node Gemini controls to the GenAI generateContent config shape', () => {
    expect(buildGeminiTextConfig({
      geminiThinkingLevel: 'medium',
      textOutputFormat: 'json',
      geminiGoogleSearchEnabled: true,
      geminiCodeExecutionEnabled: true,
    })).toEqual({
      thinkingConfig: {
        thinkingLevel: 'MEDIUM',
      },
      responseMimeType: 'application/json',
      tools: [
        { googleSearch: {} },
        { codeExecution: {} },
      ],
    });
  });

  it('omits optional Gemini config when controls stay on defaults', () => {
    expect(buildGeminiTextConfig({})).toEqual({});
  });

  it('omits Gemini 3-only controls for Gemini 2.5 even when stale values remain saved', () => {
    expect(buildGeminiTextConfig({
      geminiThinkingLevel: 'high',
      geminiGoogleSearchEnabled: true,
      geminiCodeExecutionEnabled: true,
      textOutputFormat: 'json',
    }, 'gemini-2.5-flash')).toEqual({
      responseMimeType: 'application/json',
      tools: [{ googleSearch: {} }, { codeExecution: {} }],
    });
  });
});

describe('Gemini text media inputs', () => {
  it('accepts image, audio, video, PDF, and text document MIME types', () => {
    const supportedInputs: GeminiTextMediaInput[] = [
      { url: 'data:image/png;base64,AAAA', mimeType: 'image/png', kind: 'image' },
      { url: 'data:audio/wav;base64,AAAA', mimeType: 'audio/wav', kind: 'audio' },
      { url: 'data:video/mp4;base64,AAAA', mimeType: 'video/mp4', kind: 'video' },
      { url: 'data:application/pdf;base64,AAAA', mimeType: 'application/pdf', kind: 'document' },
      { url: 'data:text/markdown;base64,AAAA', mimeType: 'text/markdown', kind: 'document' },
    ];

    expect(supportedInputs.every(isGeminiTextMediaInputSupported)).toBe(true);
    expect(isGeminiTextMediaInputSupported({
      url: 'data:application/zip;base64,AAAA',
      mimeType: 'application/zip',
      kind: 'package',
    })).toBe(false);
  });

  it('adds per-part media resolution for media parts when requested', () => {
    expect(buildGeminiTextInlinePart({
      data: 'AAAA',
      mimeType: 'image/png',
      mediaResolution: 'high',
    })).toEqual({
      inlineData: {
        data: 'AAAA',
        mimeType: 'image/png',
      },
      mediaResolution: {
        level: 'MEDIA_RESOLUTION_HIGH',
      },
    });
  });

  it('leaves media resolution unset by default', () => {
    expect(resolveGeminiMediaResolutionLevel('default')).toBeUndefined();
  });
});
