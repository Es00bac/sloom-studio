import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  installBundledPaperFontFace,
  parseBundledFontInventory,
} from '../../../lib/bundledFontLibrary';
import { createBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import type { PaperManagedFontFace } from '../../../types/paper';
import type { PaperAssetRepository } from './PaperAssetRepository';

/** Installs one locally audited test-catalog face through the same production installer as Paper. */
export async function installTestBundledPaperFontFace(
  repository: PaperAssetRepository,
): Promise<PaperManagedFontFace> {
  const fontBytes = new Uint8Array(readFileSync(
    resolve(process.cwd(), 'public/fonts/liberation/LiberationSans-Regular.ttf'),
  ));
  const licenseBytes = new Uint8Array(readFileSync(
    resolve(process.cwd(), 'public/fonts/liberation/LICENSE'),
  ));
  const [fontRecord, licenseRecord] = await Promise.all([
    createBinaryAssetRecord(fontBytes, { mimeType: 'font/ttf', fileName: 'LiberationSans-Regular.ttf' }),
    createBinaryAssetRecord(licenseBytes, { mimeType: 'text/plain', fileName: 'LICENSE' }),
  ]);
  const catalog = parseBundledFontInventory({
    schemaVersion: 1,
    catalogFamilyCount: 1,
    faceCount: 1,
    criticalErrorCount: 0,
    families: [{
      collection: 'base',
      family: 'Liberation Sans',
      slug: 'liberationsans',
      source: { url: 'https://example.test/liberation', commit: 'test-catalog-2.1.5' },
      licenses: [{
        file: 'collection/base/liberationsans/LICENSE',
        spdx: 'OFL-1.1',
        sha256: licenseRecord.ref.sha256,
        byteLength: licenseRecord.ref.byteLength,
      }],
      faces: [{
        file: 'collection/base/liberationsans/LiberationSans-Regular.ttf',
        collectionIndex: 0,
        sha256: fontRecord.ref.sha256,
        byteLength: fontRecord.ref.byteLength,
        family: 'Liberation Sans',
        subfamily: 'Regular',
        fullName: 'Liberation Sans Regular',
        postscriptName: 'LiberationSans-Regular',
        version: 'Version 2.1.5',
        weight: 400,
        stretchPercent: 100,
        glyphCount: 2327,
        variable: true,
        axes: [{ tag: 'wght', minimum: 200, default: 400, maximum: 900 }],
        fsType: 0,
        restrictedEmbedding: false,
        noSubsetting: false,
        bitmapEmbeddingOnly: false,
        hasVerticalSubstitution: false,
      }],
      errors: [],
      warnings: [],
    }],
  });
  const family = catalog.families[0];
  const face = family.faces[0];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('LiberationSans-Regular.ttf')) return new Response(fontBytes);
    if (url.endsWith('/LICENSE')) return new Response(licenseBytes);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  const installed = await installBundledPaperFontFace({ family, face, repository, fetchImpl });
  return { ...installed, variationSettings: { wght: 425 } };
}
