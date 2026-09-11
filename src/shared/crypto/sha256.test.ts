import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('matches the standard SHA-256 empty-input vector without Web Crypto', () => {
    vi.stubGlobal('crypto', {});
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
