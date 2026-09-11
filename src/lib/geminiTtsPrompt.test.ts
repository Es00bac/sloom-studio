import { describe, expect, it } from 'vitest';
import { buildGeminiTtsPrompt } from './geminiTtsPrompt';

describe('buildGeminiTtsPrompt', () => {
  it('returns the raw transcript when no style guidance is provided', () => {
    expect(buildGeminiTtsPrompt('Hello there.')).toBe('Hello there.');
  });

  it('wraps style and accent guidance as director notes ahead of the transcript', () => {
    const prompt = buildGeminiTtsPrompt(
      'Welcome back to the show.',
      'Warm London radio host, smiling delivery, brisk pace.',
    );

    expect(prompt).toContain('Read the transcript exactly as written.');
    expect(prompt).toContain("# DIRECTOR'S NOTES\nWarm London radio host, smiling delivery, brisk pace.");
    expect(prompt).toContain('# TRANSCRIPT\nWelcome back to the show.');
  });
});
