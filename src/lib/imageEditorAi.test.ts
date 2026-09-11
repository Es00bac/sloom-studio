import { describe, expect, it } from 'vitest';
import { buildGenerativeFillPrompt } from './imageEditorAi';

describe('imageEditorAi', () => {
  it('preserves the main edit prompt and appends reference descriptions in a predictable block', () => {
    expect(buildGenerativeFillPrompt({
      prompt: 'replace the selected jacket',
      references: [
        { id: 'r1', description: 'use the red leather texture from reference 1' },
        { id: 'r2', label: 'Logo', description: 'preserve this exact logo shape' },
      ],
    })).toBe([
      'replace the selected jacket',
      '',
      'Reference guidance:',
      '1. use the red leather texture from reference 1',
      '2. Logo: preserve this exact logo shape',
    ].join('\n'));
  });
});
