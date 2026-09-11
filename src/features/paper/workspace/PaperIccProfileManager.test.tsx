// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import { MemoryPaperAssetRepository } from '../assets/PaperAssetRepository';
import { importPaperManagedIccProfile } from '../../../lib/paperManagedIccProfiles';
import { PaperIccProfileManager } from './PaperIccProfileManager';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

describe('PaperIccProfileManager', () => {
  it('stores imported ICC bytes as an exact managed asset and binds its output condition', async () => {
    const repository = new MemoryPaperAssetRepository();

    const profile = await importPaperManagedIccProfile({
      name: 'FOGRA39L_coated.icc',
      type: 'application/vnd.iccprofile',
      arrayBuffer: async () => fogra39.slice().buffer,
    }, {
      outputConditionId: 'FOGRA39',
      registryName: 'https://www.color.org',
    }, repository);

    expect(profile).toMatchObject({
      id: profile.asset.id,
      colorSpace: 'CMYK',
      outputConditionId: 'FOGRA39',
      source: { kind: 'user-import' },
    });
    expect(await repository.has(profile.asset.id)).toBe(true);
  });

  it('refuses an unnamed output condition before it writes an ICC asset', async () => {
    const repository = new MemoryPaperAssetRepository();

    await expect(importPaperManagedIccProfile({
      name: 'FOGRA39L_coated.icc',
      type: 'application/vnd.iccprofile',
      arrayBuffer: async () => fogra39.slice().buffer,
    }, {
      outputConditionId: '   ',
    }, repository)).rejects.toThrow(/output condition identifier/i);

    expect(await repository.listRefs()).toEqual([]);
  });

  it('selects an existing managed profile without introducing a fallback profile', async () => {
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(fogra39, { mimeType: 'application/vnd.iccprofile' });
    const updates = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(
        <PaperIccProfileManager
          outputConditionId="FOGRA39"
          profiles={[{
            id: record.ref.id,
            asset: record.ref,
            description: 'ISO Coated v2',
            deviceClass: 'prtr',
            colorSpace: 'CMYK',
            pcs: 'Lab ',
            outputConditionId: 'FOGRA39',
            source: { kind: 'user-import' },
          }]}
          repository={repository}
          selectedProfileAssetId={undefined}
          onChange={updates}
        />,
      );
    });

    const select = host.querySelector('button[aria-label="Use ISO Coated v2"]') as HTMLButtonElement;
    expect(select).not.toBeNull();
    await act(async () => select.click());
    expect(updates).toHaveBeenCalledWith(expect.objectContaining({ selectedProfileAssetId: record.ref.id }));
  });

  it('offers the redistribution-cleared bundled profile catalog as an explicit setup action', async () => {
    const repository = new MemoryPaperAssetRepository();
    const updates = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);

    await act(async () => {
      root.render(
        <PaperIccProfileManager
          outputConditionId=""
          profiles={[]}
          repository={repository}
          selectedProfileAssetId={undefined}
          onChange={updates}
        />,
      );
    });

    const bundled = host.querySelector('[aria-label="Bundled CMYK profile"]') as HTMLSelectElement;
    expect(bundled).not.toBeNull();
    expect([...bundled.options].map((option) => option.textContent)).toContain(
      'ISO Coated v2 / FOGRA39 (coated)',
    );
    expect(host.querySelector('button[aria-label="Use bundled CMYK profile"]')).not.toBeNull();
  });
});
