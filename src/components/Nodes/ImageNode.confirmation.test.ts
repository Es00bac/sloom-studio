import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ImageNode confirmation wiring', () => {
  it('uses the themed confirmation dialog instead of browser confirm for image deletion', () => {
    const source = readFileSync(new URL('./ImageNode.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('window.confirm');
    expect(source).toContain('useConfirmationStore');
    expect(source).toContain('requestConfirmation');
    expect(source).toContain('Delete Image');
  });
});
