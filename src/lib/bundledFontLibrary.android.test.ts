import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryPaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';

const fontRoot = resolve(process.cwd(), 'build/font-library');
const mocks = vi.hoisted(() => ({
  available: true,
  verified: true,
  corruptPath: '' as string,
  readResource: vi.fn<(path: string) => Promise<Uint8Array>>(),
}));

vi.mock('./androidFontPack', () => ({
  isAndroidFontPackRuntime: () => true,
  getAndroidFontPackStatus: vi.fn(async () => ({
    supported: true,
    packName: 'sloom_fonts',
    downloaded: mocks.available,
    available: mocks.available,
    verified: mocks.verified,
    status: mocks.available ? 'completed' : 'not-installed',
    bytesDownloaded: 0,
    totalBytes: 0,
    errorCode: 0,
  })),
  readAndroidFontPackResource: (path: string) => mocks.readResource(path),
}));

describe('bundled font library over Android Play Asset Delivery', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.available = true;
    mocks.verified = true;
    mocks.corruptPath = '';
    mocks.readResource.mockReset();
    mocks.readResource.mockImplementation(async (path) => {
      const bytes = new Uint8Array(readFileSync(join(fontRoot, path)));
      if (path === mocks.corruptPath) bytes[0] ^= 0xff;
      return bytes;
    });
  });

  it('fails closed until the Android pack is both downloaded and verified', async () => {
    mocks.verified = false;
    const library = await import('./bundledFontLibrary');

    await expect(library.queryBundledFontLibraryCapability()).resolves.toBe(false);
    await expect(library.loadBundledFontCatalog()).rejects.toThrow(/not downloaded and verified/i);
    expect(mocks.readResource).not.toHaveBeenCalled();
  });

  it('loads the audited catalog and installs an exact font plus its license through native bytes', async () => {
    const library = await import('./bundledFontLibrary');
    await expect(library.queryBundledFontLibraryCapability()).resolves.toBe(true);
    const catalog = await library.loadBundledFontCatalog();
    const family = catalog.families.find((candidate) => candidate.faces.length > 0)!;
    const repository = new MemoryPaperAssetRepository();

    const installed = await library.installBundledPaperFontFace({
      family,
      face: family.faces[0],
      repository,
    });

    expect(installed.fontAsset.sha256).toBe(family.faces[0].sha256);
    expect(installed.license.textAsset).toBeDefined();
    expect(await repository.listRefs()).toHaveLength(2);
    expect(mocks.readResource).toHaveBeenCalledWith('inventory/font-inventory.json');
    expect(mocks.readResource).toHaveBeenCalledWith(family.faces[0].file);
    expect(mocks.readResource).toHaveBeenCalledWith(family.licenseFile);
  });

  it('rejects corrupted font and license bytes after the native verification boundary', async () => {
    const library = await import('./bundledFontLibrary');
    const catalog = await library.loadBundledFontCatalog();
    const family = catalog.families.find((candidate) => candidate.faces.length > 0)!;

    mocks.corruptPath = family.faces[0].file;
    await expect(library.installBundledPaperFontFace({
      family,
      face: family.faces[0],
      repository: new MemoryPaperAssetRepository(),
    })).rejects.toThrow(/font hash/i);

    mocks.corruptPath = family.licenseFile;
    await expect(library.installBundledPaperFontFace({
      family,
      face: family.faces[0],
      repository: new MemoryPaperAssetRepository(),
    })).rejects.toThrow(/license hash/i);
  });
});
