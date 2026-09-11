import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createBinaryAssetRecord } from '../../shared/assets/contentAddressedAsset';
import { packContainer } from '../../shared/files/SignalLoomContainer';
import { packValidatedAssetContainer } from '../../shared/files/ValidatedAssetContainer';
import type { PaperDocument } from '../../types/paper';
import { classifyPaperFontPackaging } from '../../lib/paperManagedFonts';
import {
  collectReachablePaperAssetIds,
  type PaperDocumentWithManagedAssets,
} from './assets/PaperDocumentAssets';
import { MemoryPaperAssetRepository } from './assets/PaperAssetRepository';
import { installTestBundledPaperFontFace } from './assets/testBundledPaperFontFixture';
import {
  deserializeSlppr,
  serializeSlppr,
  SLPPR_FORMAT,
  SLPPR_FORMAT_VERSION,
} from './SlpprFormat';

function documentWithManagedFrames(
  ref: Awaited<ReturnType<typeof createBinaryAssetRecord>>['ref'],
): PaperDocument {
  return {
    id: 'paper-1',
    title: 'Managed zine',
    pages: [{
      id: 'page-1',
      frames: [
        { id: 'frame-1', asset: { locator: { kind: 'managed', ref } } },
        { id: 'frame-2', asset: { locator: { kind: 'managed', ref } } },
      ],
    }],
  } as unknown as PaperDocument;
}

function legacyVersionOneFixture(): Uint8Array {
  return packContainer(
    {
      format: SLPPR_FORMAT,
      formatVersion: 1,
      kind: 'paper',
      document: {
        id: 'legacy-paper',
        title: 'Legacy zine',
        pages: [{
          id: 'page-1',
          frames: [
            {
              id: 'frame-1',
              asset: {
                label: 'Panel',
                kind: 'image',
                src: { $slpprAsset: 'asset-0.bin', mime: 'image/png' },
              },
            },
            {
              id: 'frame-2',
              asset: {
                label: 'Panel duplicate',
                kind: 'image',
                src: { $slpprAsset: 'asset-0.bin', mime: 'image/png' },
              },
            },
            {
              id: 'frame-3',
              asset: {
                label: 'Legacy inline panel',
                kind: 'image',
                src: 'data:image/png;base64,AQID',
              },
            },
          ],
        }],
        importedFonts: [{
          id: 'font-1',
          familyName: 'Legacy Sans',
          bold: false,
          italic: false,
          format: 'truetype',
          embeddable: true,
          canSubset: true,
          dataBase64: 'BAUG',
        }],
      },
      assets: ['asset-0.bin'],
    },
    new Map([['asset-0.bin', new Uint8Array([1, 2, 3])]]),
  );
}

describe('SlpprFormat', () => {
  it('writes duplicate Paper payloads once by hash and restores managed references', async () => {
    const repository = new MemoryPaperAssetRepository();
    const record = await createBinaryAssetRecord(new Uint8Array([1, 2, 3]), {
      mimeType: 'image/png',
      fileName: 'panel.png',
    });
    await repository.put(record);

    const bytes = await serializeSlppr(documentWithManagedFrames(record.ref), repository);
    const archive = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(archive['manifest.json'])) as {
      formatVersion: number;
      assets: unknown[];
      document: unknown;
    };

    expect(SLPPR_FORMAT_VERSION).toBe(2);
    expect(manifest.formatVersion).toBe(2);
    expect(manifest.assets).toEqual([record.ref]);
    expect(Object.keys(archive).filter((path) => path.startsWith('assets/'))).toHaveLength(1);
    expect(JSON.stringify(manifest)).not.toMatch(/data:|dataBase64|AQID/);

    const restoredRepository = new MemoryPaperAssetRepository();
    const restored = await deserializeSlppr(bytes, restoredRepository);
    expect(collectReachablePaperAssetIds(restored)).toEqual([record.ref.id]);
    expect(await restoredRepository.get(record.ref.id)).toEqual(record);
  });

  it('migrates legacy in-memory binary fields before writing a version-2 manifest', async () => {
    const legacy = {
      id: 'legacy-save',
      pages: [{
        frames: [{ asset: { src: 'data:image/png;base64,AQID' } }],
      }],
      importedFonts: [{
        id: 'font-1',
        format: 'truetype',
        dataBase64: 'BAUG',
      }],
    } as unknown as PaperDocument;

    const bytes = await serializeSlppr(legacy, new MemoryPaperAssetRepository());
    const archive = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(archive['manifest.json'])) as {
      document: unknown;
      assets: unknown[];
    };

    expect(JSON.stringify(legacy)).toMatch(/data:|dataBase64/);
    expect(JSON.stringify(manifest.document)).not.toMatch(/data:|dataBase64|AQID|BAUG/);
    expect(manifest.assets).toHaveLength(2);
  });

  it('round-trips bundled font identity and license evidence through an actual version-2 package', async () => {
    const repository = new MemoryPaperAssetRepository();
    const face = await installTestBundledPaperFontFace(repository);
    const document = { id: 'bundled-paper', title: 'Bundled type', pages: [], importedFonts: [face] } as unknown as PaperDocument;

    const bytes = await serializeSlppr(document, repository);
    const restoredRepository = new MemoryPaperAssetRepository();
    const restored = await deserializeSlppr(bytes, restoredRepository);
    const restoredFace = restored.importedFonts?.[0];

    expect(restoredFace).toEqual(face);
    expect(restoredFace && classifyPaperFontPackaging(restoredFace)).toEqual(classifyPaperFontPackaging(face));
    expect(await restoredRepository.get(face.fontAsset.id)).toBeDefined();
    expect(await restoredRepository.get(face.license.textAsset!.id)).toBeDefined();
  });

  it('downgrades canonical-looking arbitrary font bytes across version-2 package save/open', async () => {
    const repository = new MemoryPaperAssetRepository();
    const installed = await installTestBundledPaperFontFace(repository);
    const arbitrary = await createBinaryAssetRecord(new Uint8Array([8, 8, 8, 8]), { mimeType: 'font/ttf' });
    await repository.put(arbitrary);
    const document = {
      id: 'spoofed-bundled-package',
      pages: [],
      importedFonts: [{ ...installed, fontAsset: arbitrary.ref, embeddability: 'unknown' }],
    } as unknown as PaperDocument;

    const bytes = await serializeSlppr(document, repository);
    const restored = await deserializeSlppr(bytes, new MemoryPaperAssetRepository());

    expect(restored.importedFonts?.[0]?.source).toEqual({ kind: 'user-import' });
    expect(restored.importedFonts?.[0] && classifyPaperFontPackaging(restored.importedFonts[0]))
      .toMatchObject({ allowed: false });
  });

  it('rejects a package save when bundled license bytes are absent', async () => {
    const repository = new MemoryPaperAssetRepository();
    const face = await installTestBundledPaperFontFace(repository);
    await repository.delete(face.license.textAsset!.id);

    await expect(serializeSlppr(
      { id: 'missing-license-package', pages: [], importedFonts: [face] } as unknown as PaperDocument,
      repository,
    )).rejects.toThrow(/missing required asset/i);
  });

  it('migrates version-1 asset references, data URLs, and imported-font Base64 once', async () => {
    const repository = new MemoryPaperAssetRepository();

    const restored = await deserializeSlppr(legacyVersionOneFixture(), repository);
    const managed = restored as PaperDocumentWithManagedAssets;
    const serializedDocument = JSON.stringify(restored);
    const refs = await repository.listRefs();

    expect(serializedDocument).not.toMatch(/data:|dataBase64|AQID|BAUG/);
    expect(refs).toHaveLength(2);
    expect(managed.pages[0]?.frames[0]?.asset?.locator).toEqual(
      managed.pages[0]?.frames[1]?.asset?.locator,
    );
    expect(managed.pages[0]?.frames[0]?.asset?.locator).toEqual(
      managed.pages[0]?.frames[2]?.asset?.locator,
    );
    expect(managed.importedFonts?.[0]?.fontAsset.id).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(collectReachablePaperAssetIds(restored)).toEqual(refs.map((ref) => ref.id).sort());
    await expect(Promise.all(refs.map((ref) => repository.get(ref.id)))).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bytes: new Uint8Array([1, 2, 3]) }),
        expect.objectContaining({ bytes: new Uint8Array([4, 5, 6]) }),
      ]),
    );
  });

  it('rejects a save when a referenced Paper asset is missing', async () => {
    const record = await createBinaryAssetRecord(new Uint8Array([9]), { mimeType: 'image/png' });

    await expect(
      serializeSlppr(documentWithManagedFrames(record.ref), new MemoryPaperAssetRepository()),
    ).rejects.toThrow(`Paper document is missing required asset ${record.ref.id}.`);
  });

  it('rejects foreign and unsupported-version containers', async () => {
    const foreign = packContainer(
      { format: 'signal-loom-image', formatVersion: 1, kind: 'image', document: {}, assets: [] },
      new Map(),
    );
    const future = packValidatedAssetContainer(
      { format: SLPPR_FORMAT, formatVersion: 3, kind: 'paper', document: {}, assets: [] },
      [],
    );

    await expect(deserializeSlppr(foreign, new MemoryPaperAssetRepository())).rejects.toThrow(/not a \.slppr/i);
    await expect(deserializeSlppr(future, new MemoryPaperAssetRepository())).rejects.toThrow(/version 3/i);
  });
});
