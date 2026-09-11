import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryPaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import {
  createBundledFontFaceReference,
  ensureBundledFontFaceReferencesRegistered,
  normalizeBundledFontFaceState,
  bundledFontResourceUrl,
  bundledFontFaceCssDescriptor,
  bundledFontFaceRuntimeFamilyName,
  installBundledPaperFontFace,
  loadBundledFontCatalog,
  parseBundledFontInventory,
  queryBundledFontLibraryCapability,
  resolveBundledFontFaceReference,
  selectBundledFontFace,
  upgradeLegacyBundledFontFaceIssue,
} from './bundledFontLibrary';

function sampleInventory() {
  return {
    schemaVersion: 1,
    catalogFamilyCount: 1,
    faceCount: 2,
    criticalErrorCount: 0,
    families: [{
      collection: 'base',
      family: 'Liberation Sans',
      slug: 'liberationsans',
      source: { url: 'https://example.test/liberation', commit: 'release-2.1.5' },
      licenses: [{
        file: 'collection/base/liberationsans/LICENSE',
        spdx: 'OFL-1.1',
        sha256: '93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b',
        byteLength: 4414,
      }],
      faces: [
        {
          file: 'collection/base/liberationsans/LiberationSans-Regular.ttf',
          collectionIndex: 0,
          sha256: 'baccc64becc3eb7d104b7c84d99f5314a0a1f896e2b3ea6c2f22fc08d2003bee',
          byteLength: 410820,
          family: 'Liberation Sans',
          subfamily: 'Regular',
          fullName: 'Liberation Sans Regular',
          postscriptName: 'LiberationSans-Regular',
          version: 'Version 2.1.5',
          weight: 400,
          stretchPercent: 100,
          glyphCount: 2327,
          variable: false,
          axes: [],
          fsType: 0,
          restrictedEmbedding: false,
          noSubsetting: false,
          bitmapEmbeddingOnly: false,
          hasVerticalSubstitution: false,
        },
        {
          file: 'collection/base/liberationsans/LiberationSans-BoldItalic.ttf',
          collectionIndex: 0,
          sha256: 'b'.repeat(64),
          byteLength: 1,
          family: 'Liberation Sans',
          subfamily: 'Bold Italic',
          fullName: 'Liberation Sans Bold Italic',
          postscriptName: 'LiberationSans-BoldItalic',
          version: 'Version 2.1.5',
          weight: 700,
          stretchPercent: 100,
          glyphCount: 2327,
          variable: false,
          axes: [],
          fsType: 0,
          restrictedEmbedding: false,
          noSubsetting: false,
          bitmapEmbeddingOnly: false,
          hasVerticalSubstitution: false,
        },
      ],
      errors: [],
      warnings: [],
    }],
  };
}

describe('bundled font library', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses audited family/face metadata and exposes exact face choices', () => {
    const catalog = parseBundledFontInventory(sampleInventory());
    const family = catalog.families[0];

    expect(catalog).toMatchObject({ familyCount: 1, faceCount: 2 });
    expect(family).toMatchObject({ family: 'Liberation Sans', collection: 'base', licenseId: 'OFL-1.1' });
    expect(family.faces).toEqual(expect.arrayContaining([
      expect.objectContaining({ weight: 400, style: 'normal', variable: false }),
      expect.objectContaining({ weight: 700, style: 'italic', variable: false }),
    ]));
    expect(selectBundledFontFace(family, 700, 'italic')).toMatchObject({ weight: 700, style: 'italic' });
    expect(selectBundledFontFace(family, 600, 'normal')).toMatchObject({ weight: 400, style: 'normal' });
    expect(bundledFontResourceUrl(family.faces[0].file)).toBe(
      'signal-loom-font://library/collection/base/liberationsans/LiberationSans-Regular.ttf',
    );
    expect(bundledFontFaceCssDescriptor(family.faces[0])).toEqual({ weight: '400', style: 'normal', stretch: '100%' });
  });

  it('rejects an inventory with critical audit errors or unsafe resource paths', () => {
    expect(() => parseBundledFontInventory({ ...sampleInventory(), criticalErrorCount: 1 })).toThrow(/critical/i);
    const unsafe = sampleInventory();
    unsafe.families[0].faces[0].file = '../outside.ttf';
    expect(() => parseBundledFontInventory(unsafe)).toThrow(/path/i);
  });

  it('resolves duplicate face IDs and family names only by the complete content and collection identity', () => {
    const inventory = sampleInventory();
    const duplicateFamily = structuredClone(inventory.families[0]);
    duplicateFamily.slug = 'liberationsans-collection';
    duplicateFamily.faces = [duplicateFamily.faces[0]];
    duplicateFamily.faces[0].file = 'collection/base/liberationsans/LiberationSans-Regular-collection.ttc';
    duplicateFamily.faces[0].collectionIndex = 1;
    duplicateFamily.faces[0].sha256 = 'c'.repeat(64);
    duplicateFamily.faces[0].byteLength = 900000;
    inventory.families.push(duplicateFamily);
    inventory.catalogFamilyCount = 2;
    inventory.faceCount = 3;
    const catalog = parseBundledFontInventory(inventory);
    const first = catalog.families[0].faces.find((face) => face.weight === 400)!;
    const secondFamily = catalog.families[1];
    const second = secondFamily.faces[0];
    second.id = first.id;

    const secondReference = createBundledFontFaceReference(secondFamily, second);
    const firstReference = createBundledFontFaceReference(catalog.families[0], first);
    expect(bundledFontFaceRuntimeFamilyName(secondReference)).not.toBe(bundledFontFaceRuntimeFamilyName(firstReference));
    expect(resolveBundledFontFaceReference(secondReference, catalog)).toEqual({ family: secondFamily, face: second });
    expect(() => resolveBundledFontFaceReference({ ...secondReference, collectionIndex: 0 }, catalog)).toThrow(/collection\/content identity/i);
    expect(() => resolveBundledFontFaceReference({ ...secondReference, sha256: first.sha256 }, catalog)).toThrow(/collection\/content identity/i);

    secondFamily.faces.push({ ...second });
    expect(() => resolveBundledFontFaceReference(secondReference, catalog)).toThrow(/duplicate complete identity/i);
  });

  it('rejects truncated hashes and every canonical metadata mismatch instead of normalizing them exact', async () => {
    const catalog = parseBundledFontInventory(sampleInventory());
    const family = catalog.families[0];
    const face = family.faces.find((candidate) => candidate.weight === 400)!;
    const reference = createBundledFontFaceReference(family, face);

    expect(normalizeBundledFontFaceState({ ...reference, sha256: reference.sha256.slice(0, 12) })).toMatchObject({
      managedFaceIssue: { reason: 'invalid-reference' },
    });
    await expect(ensureBundledFontFaceReferencesRegistered([
      { ...reference, sha256: reference.sha256.slice(0, 12) } as typeof reference,
    ], { catalog })).rejects.toThrow(/truncated content identity/i);
    for (const changed of [
      { ...reference, family: 'Same Name System Font' },
      { ...reference, weight: 500 },
      { ...reference, style: 'italic' as const },
      { ...reference, stretchPercent: 87.5 },
      { ...reference, collectionIndex: 1 },
      { ...reference, sha256: 'd'.repeat(64) },
      { ...reference, byteLength: reference.byteLength + 1 },
    ]) {
      expect(() => resolveBundledFontFaceReference(changed, catalog)).toThrow(/identity/i);
    }
  });

  it('rejects a full-hash byte mutation before FontFace registration', async () => {
    const catalog = parseBundledFontInventory(sampleInventory());
    const family = catalog.families[0];
    const face = family.faces.find((candidate) => candidate.weight === 400)!;
    const reference = createBundledFontFaceReference(family, face);
    const bytes = new Uint8Array(readFileSync(resolve(process.cwd(), 'public/fonts/liberation/LiberationSans-Regular.ttf')));
    bytes[bytes.length - 1] ^= 1;
    const fetchImpl = vi.fn(async () => new Response(bytes)) as unknown as typeof fetch;
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    vi.stubGlobal('document', { fonts: { add: vi.fn() } });

    await expect(ensureBundledFontFaceReferencesRegistered([reference], { catalog, fetchImpl })).rejects.toThrow(/integrity verification/i);
    vi.unstubAllGlobals();
  });

  it('keeps v1 references unverified until catalog and full bytes promote them to v2', async () => {
    const catalog = parseBundledFontInventory(sampleInventory());
    const family = catalog.families[0];
    const face = family.faces.find((candidate) => candidate.weight === 400)!;
    const legacy = {
      kind: 'bundled', faceId: face.id, family: family.family, weight: face.weight,
      style: face.style, stretchPercent: face.stretchPercent,
    };
    const state = normalizeBundledFontFaceState(legacy);
    expect(state).toMatchObject({ managedFaceIssue: { reason: 'legacy-reference', original: legacy } });
    const bytes = readFileSync(resolve(process.cwd(), 'public/fonts/liberation/LiberationSans-Regular.ttf'));
    const fetchImpl = vi.fn(async () => new Response(bytes)) as unknown as typeof fetch;
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    vi.stubGlobal('document', { fonts: { add: vi.fn() } });

    const upgraded = await upgradeLegacyBundledFontFaceIssue(state.managedFaceIssue!, { catalog, fetchImpl });
    expect(upgraded).toEqual(createBundledFontFaceReference(family, face));
    expect(upgraded?.sha256).toHaveLength(64);
    vi.unstubAllGlobals();
  });

  it('verifies and registers exact font bytes without SubtleCrypto on an insecure LAN origin', async () => {
    const catalog = parseBundledFontInventory(sampleInventory());
    const family = catalog.families[0];
    const face = family.faces.find((candidate) => candidate.weight === 400)!;
    const reference = createBundledFontFaceReference(family, face);
    const bytes = readFileSync(resolve(process.cwd(), 'public/fonts/liberation/LiberationSans-Regular.ttf'));
    const fetchImpl = vi.fn(async () => new Response(bytes)) as unknown as typeof fetch;
    vi.stubGlobal('crypto', {});
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    vi.stubGlobal('document', { fonts: { add: vi.fn() } });

    await expect(ensureBundledFontFaceReferencesRegistered([
      reference,
    ], { catalog, fetchImpl })).resolves.toMatchObject({
      ready: true,
      registeredFaceIds: [reference.faceId],
    });
  });

  it('pins exact bundled bytes and license evidence into a Paper document repository', async () => {
    const catalog = parseBundledFontInventory(sampleInventory());
    const family = catalog.families[0];
    const face = family.faces[0];
    const fontBytes = readFileSync(resolve(process.cwd(), 'public/fonts/liberation/LiberationSans-Regular.ttf'));
    const licenseText = readFileSync(resolve(process.cwd(), 'public/fonts/liberation/LICENSE'));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('LiberationSans-Regular.ttf')) return new Response(fontBytes);
      if (url.endsWith('/LICENSE')) return new Response(licenseText);
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    const repository = new MemoryPaperAssetRepository();

    const installed = await installBundledPaperFontFace({ family, face, repository, fetchImpl });

    expect(installed).toMatchObject({
      familyId: 'liberation sans',
      familyName: 'Liberation Sans',
      postscriptName: 'LiberationSans-Regular',
      weight: 400,
      style: 'normal',
      source: { kind: 'bundled', version: 'release-2.1.5' },
      license: { id: 'OFL-1.1' },
    });
    expect(installed.fontAsset.sha256).toBe(face.sha256);
    expect(installed.license.textAsset).toBeDefined();
    expect(await repository.listRefs()).toHaveLength(2);
  });
});

describe('bundled font library platform capability gate (FBL-025)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is unavailable and loadBundledFontCatalog fails closed before any fetch without a native bridge', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;

    await expect(queryBundledFontLibraryCapability()).resolves.toBe(false);
    await expect(loadBundledFontCatalog(fetchImpl)).rejects.toThrow(/desktop app/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is unavailable and fails closed the same way with a malformed/incomplete general bridge', async () => {
    vi.stubGlobal('window', { signalLoomNative: { getNativeState: vi.fn() } });
    const fetchImpl = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;

    await expect(queryBundledFontLibraryCapability()).resolves.toBe(false);
    await expect(loadBundledFontCatalog(fetchImpl)).rejects.toThrow(/desktop app/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is unavailable with a complete general bridge that has no dedicated bundledFontLibraryStatus method', async () => {
    // Generic shape (getNativeState + onMenuCommand) alone is exactly the flaw Terra caught:
    // it does not prove signal-loom-font:// has a usable root. An older/partial bridge without
    // the dedicated capability method must still fail closed.
    vi.stubGlobal('window', { signalLoomNative: { getNativeState: vi.fn(), onMenuCommand: vi.fn() } });
    const fetchImpl = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;

    await expect(queryBundledFontLibraryCapability()).resolves.toBe(false);
    await expect(loadBundledFontCatalog(fetchImpl)).rejects.toThrow(/desktop app/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is unavailable when a complete bridge reports no resolved font-library root (packaged build with a missing font pack)', async () => {
    const bundledFontLibraryStatus = vi.fn(async () => ({ available: false }));
    vi.stubGlobal('window', {
      signalLoomNative: { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus },
    });
    const fetchImpl = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;

    await expect(queryBundledFontLibraryCapability()).resolves.toBe(false);
    await expect(loadBundledFontCatalog(fetchImpl)).rejects.toThrow(/desktop app/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(bundledFontLibraryStatus).toHaveBeenCalled();
  });

  it('fails closed before any fetch when the dedicated capability transport rejects', async () => {
    const bundledFontLibraryStatus = vi.fn(async () => { throw new Error('renderer IPC disconnected'); });
    vi.stubGlobal('window', {
      signalLoomNative: { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus },
    });
    const fetchImpl = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;

    await expect(queryBundledFontLibraryCapability()).resolves.toBe(false);
    await expect(loadBundledFontCatalog(fetchImpl)).rejects.toThrow(/desktop app/i);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(bundledFontLibraryStatus).toHaveBeenCalledTimes(1);
  });

  it('is available and loads the catalog over signal-loom-font:// only once the dedicated capability positively confirms a root', async () => {
    const bundledFontLibraryStatus = vi.fn(async () => ({ available: true }));
    vi.stubGlobal('window', {
      signalLoomNative: { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus },
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('signal-loom-font://library/inventory/font-inventory.json');
      return new Response(JSON.stringify(sampleInventory()), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(queryBundledFontLibraryCapability()).resolves.toBe(true);
    const catalog = await loadBundledFontCatalog(fetchImpl);
    expect(catalog.familyCount).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares one capability query per bridge instance but never carries a stale positive across a bridge reset', async () => {
    const firstStatus = vi.fn(async () => ({ available: true }));
    vi.stubGlobal('window', {
      signalLoomNative: { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: firstStatus },
    });
    await expect(Promise.all([
      queryBundledFontLibraryCapability(),
      queryBundledFontLibraryCapability(),
      queryBundledFontLibraryCapability(),
    ])).resolves.toEqual([true, true, true]);
    expect(firstStatus).toHaveBeenCalledTimes(1);

    // A fresh bridge instance (renderer reload / new test environment) must re-query rather than
    // replay the previous bridge's cached positive answer, even though nothing else changed.
    const secondStatus = vi.fn(async () => ({ available: false }));
    vi.stubGlobal('window', {
      signalLoomNative: { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: secondStatus },
    });
    await expect(queryBundledFontLibraryCapability()).resolves.toBe(false);
    expect(secondStatus).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a catalog authorized by an earlier bridge after bridge replacement', async () => {
    const firstStatus = vi.fn(async () => ({ available: true }));
    vi.stubGlobal('window', {
      signalLoomNative: { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: firstStatus },
    });
    const firstFetch = vi.fn(async () => new Response(JSON.stringify(sampleInventory()), { status: 200 })) as unknown as typeof fetch;

    await expect(loadBundledFontCatalog(firstFetch)).resolves.toMatchObject({ familyCount: 1 });
    expect(firstFetch).toHaveBeenCalledTimes(1);

    const replacementStatus = vi.fn(async () => ({ available: false }));
    vi.stubGlobal('window', {
      signalLoomNative: { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: replacementStatus },
    });
    const replacementFetch = vi.fn(async () => new Response(JSON.stringify(sampleInventory()), { status: 200 })) as unknown as typeof fetch;

    await expect(loadBundledFontCatalog(replacementFetch)).rejects.toThrow(/desktop app/i);
    expect(replacementStatus).toHaveBeenCalledTimes(1);
    expect(replacementFetch).not.toHaveBeenCalled();
  });

  it('does not fetch or publish A\'s catalog when A turns positive after the current bridge becomes negative B', async () => {
    let resolveFirstStatus: ((status: { available: boolean }) => void) | undefined;
    const firstStatus = vi.fn(() => new Promise<{ available: boolean }>((resolve) => { resolveFirstStatus = resolve; }));
    const firstBridge = { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: firstStatus };
    vi.stubGlobal('window', { signalLoomNative: firstBridge });
    const firstFetch = vi.fn(async () => new Response(JSON.stringify(sampleInventory()), { status: 200 })) as unknown as typeof fetch;

    const pendingCatalog = loadBundledFontCatalog(firstFetch);
    await vi.waitFor(() => expect(firstStatus).toHaveBeenCalledTimes(1));

    const replacementStatus = vi.fn(async () => ({ available: false }));
    vi.stubGlobal('window', {
      signalLoomNative: { getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: replacementStatus },
    });
    resolveFirstStatus?.({ available: true });

    await expect(pendingCatalog).rejects.toThrow(/desktop app/i);
    expect(firstFetch).not.toHaveBeenCalled();
  });

  it('rejects an A-authorized catalog when its bridge changes before JSON publication', async () => {
    const firstBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    vi.stubGlobal('window', { signalLoomNative: firstBridge });
    let resolveJson: ((inventory: ReturnType<typeof sampleInventory>) => void) | undefined;
    const firstFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: () => new Promise<ReturnType<typeof sampleInventory>>((resolve) => { resolveJson = resolve; }),
    })) as unknown as typeof fetch;

    const pendingCatalog = loadBundledFontCatalog(firstFetch);
    await vi.waitFor(() => expect(firstFetch).toHaveBeenCalledTimes(1));

    const replacementBridge = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus: vi.fn(async () => ({ available: true })),
    };
    vi.stubGlobal('window', { signalLoomNative: replacementBridge });
    resolveJson?.(sampleInventory());

    await expect(pendingCatalog).rejects.toThrow(/bridge changed/i);

    const replacementFetch = vi.fn(async () => new Response(JSON.stringify(sampleInventory()), { status: 200 })) as unknown as typeof fetch;
    await expect(loadBundledFontCatalog(replacementFetch)).resolves.toMatchObject({ familyCount: 1 });
    expect(replacementBridge.bundledFontLibraryStatus).toHaveBeenCalledTimes(1);
    expect(replacementFetch).toHaveBeenCalledTimes(1);
  });
});
