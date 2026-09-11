import { describe, expect, it } from 'vitest';
import {
  describeDynamicImportLoadFailure,
  isDynamicImportLoadFailure,
} from './dynamicImportRecovery';

describe('dynamic import recovery', () => {
  it('detects the stale Vite chunk error shown by browser module loading failures', () => {
    const error = new TypeError(
      'error loading dynamically imported module: https://loom.opencasagent.com/assets/web-Byag6nia.js',
    );

    expect(isDynamicImportLoadFailure(error)).toBe(true);
  });

  it('turns raw provider chunk failures into a user-facing reload instruction', () => {
    const message = describeDynamicImportLoadFailure(
      new TypeError('Failed to fetch dynamically imported module'),
      'Google Gemini audio',
    );

    expect(message).toContain('Google Gemini audio');
    expect(message).toContain('app updated');
    expect(message).toContain('refresh Sloom Studio');
    expect(message).not.toContain('dynamically imported module');
  });
});
