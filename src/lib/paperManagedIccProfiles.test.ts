import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBinaryAssetRecord } from '../shared/assets/contentAddressedAsset';
import { MemoryPaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import type { PaperManagedIccProfile } from '../types/paper';
import {
  installBundledPaperManagedIccProfile,
  parseAndValidateCmykOutputProfile,
  resolveExactPaperOutputProfile,
  type PaperManagedIccProfileRegistry,
} from './paperManagedIccProfiles';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));

async function profileFixture(): Promise<{
  profile: PaperManagedIccProfile;
  registry: PaperManagedIccProfileRegistry;
}> {
  const repository = new MemoryPaperAssetRepository();
  const record = await createBinaryAssetRecord(fogra39, {
    mimeType: 'application/vnd.iccprofile',
    fileName: 'FOGRA39L_coated.icc',
  });
  await repository.put(record);
  const parsed = await parseAndValidateCmykOutputProfile(fogra39);
  const profile: PaperManagedIccProfile = {
    id: record.ref.id,
    asset: record.ref,
    description: parsed.description,
    deviceClass: parsed.deviceClass,
    colorSpace: parsed.colorSpace,
    pcs: parsed.pcs,
    outputConditionId: 'FOGRA39',
    source: { kind: 'user-import' },
  };
  return {
    profile,
    registry: {
      profiles: [profile],
      getAsset: (id) => repository.get(id),
    },
  };
}

describe('managed Paper CMYK output profiles', () => {
  it('installs the exact selected bundled profile as a content-addressed managed asset', async () => {
    const repository = new MemoryPaperAssetRepository();

    const installed = await installBundledPaperManagedIccProfile(
      'fogra39',
      repository,
      async (url) => {
        expect(url).toContain('icc/FOGRA39L_coated.icc');
        return fogra39;
      },
    );

    expect(installed.outputConditionId).toBe('FOGRA39');
    expect(installed.profile).toMatchObject({
      id: `sha256:${installed.profile.asset.sha256}`,
      outputConditionId: 'FOGRA39',
      colorSpace: 'CMYK',
      source: {
        kind: 'bundled',
        url: '/icc/FOGRA39L_coated.icc',
      },
    });
    expect(await repository.get(installed.profile.asset.id)).toMatchObject({
      ref: installed.profile.asset,
      bytes: fogra39,
    });
  });

  it('never substitutes a different output condition', async () => {
    const { registry } = await profileFixture();

    await expect(resolveExactPaperOutputProfile(registry, `sha256:${'0'.repeat(64)}`)).resolves.toEqual({
      status: 'missing',
      profileId: `sha256:${'0'.repeat(64)}`,
    });
  });

  it('rejects RGB display profiles for PDF/X CMYK output', async () => {
    const rgbHeader = new Uint8Array(fogra39);
    rgbHeader.set(new TextEncoder().encode('RGB '), 16);

    await expect(parseAndValidateCmykOutputProfile(rgbHeader)).rejects.toThrow(/CMYK output/i);
  });

  it('resolves only verified bytes for the selected managed profile', async () => {
    const { profile, registry } = await profileFixture();

    const result = await resolveExactPaperOutputProfile(registry, profile.id);

    expect(result).toMatchObject({ status: 'ready', profile });
    if (result.status === 'ready') expect(result.bytes).toEqual(fogra39);
  });
});
