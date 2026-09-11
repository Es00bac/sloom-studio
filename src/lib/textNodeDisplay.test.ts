import { describe, expect, it } from 'vitest';
import { getGeneratedTextDisplay } from './textNodeDisplay';

describe('getGeneratedTextDisplay', () => {
  it('preserves full generated text for scrollable result panes', () => {
    const longText = Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join('\n');

    expect(getGeneratedTextDisplay(longText)).toBe(longText);
  });

  it('returns a compact placeholder when no text has been generated', () => {
    expect(getGeneratedTextDisplay(undefined)).toBe('Generated text will appear here.');
    expect(getGeneratedTextDisplay('   ')).toBe('Generated text will appear here.');
  });
});
