import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createImportedImageCmykProfile,
  loadBundledImageCmykProfile,
  resolveBundledImageCmykProfile,
} from './cmykProfiles';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));

describe('Image CMYK profile identities', () => {
  it('keeps a bundled profile identity tied to one shipped source and validates the loaded bytes', async () => {
    const result = await loadBundledImageCmykProfile('fogra39', async (url) => {
      expect(url).toContain('FOGRA39L_coated.icc');
      return fogra39;
    });
    expect(result.identity).toMatchObject({ source: { kind: 'bundled', id: 'fogra39' }, outputConditionId: 'FOGRA39' });
    expect(result.profile.colorSpace).toBe('CMYK');
  });

  it('refuses a made-up bundled identity instead of selecting another press condition', () => {
    expect(() => resolveBundledImageCmykProfile('closest-enough')).toThrow(/shipped CMYK/i);
  });

  it('makes imported profile asset identity exact and fail-closed', () => {
    expect(createImportedImageCmykProfile({
      assetId: 'asset-icc-fogra-custom',
      sha256: 'A'.repeat(64),
      label: 'Custom press profile',
    })).toMatchObject({ source: { kind: 'imported', assetId: 'asset-icc-fogra-custom', sha256: 'a'.repeat(64) } });
    expect(() => createImportedImageCmykProfile({ assetId: '', sha256: 'not-a-hash', label: '' })).toThrow(/invalid/i);
  });
});
