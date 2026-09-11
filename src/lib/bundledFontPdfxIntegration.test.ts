import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryPaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import { addFrameToPaperPage, createDefaultPaperDocument, DEFAULT_PAPER_TYPOGRAPHY } from './paperDocument';
import { createRgbToCmykTransform } from './paperIccEngine';
import type { PaperOutputProfileResolution } from './paperManagedIccProfiles';
import { exportPaperDocumentToPdfx } from './paperPdfxPipeline';
import { validatePaperPdfx } from './paperPdfxValidate';
import { installBundledPaperFontFace, parseBundledFontInventory } from './bundledFontLibrary';
import type { BinaryAssetId } from '../shared/assets/contentAddressedAsset';

const libraryRoot = resolve('build/font-library');
const inventory = parseBundledFontInventory(JSON.parse(readFileSync(join(libraryRoot, 'inventory/font-inventory.json'), 'utf8')));
const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));

const outputProfile: Extract<PaperOutputProfileResolution, { status: 'ready' }> = {
  status: 'ready',
  profile: {
    id: `sha256:${'f'.repeat(64)}` as BinaryAssetId,
    asset: { id: `sha256:${'f'.repeat(64)}` as BinaryAssetId, sha256: 'f'.repeat(64), mimeType: 'application/vnd.iccprofile', byteLength: fogra39.byteLength },
    description: 'ISO Coated v2 300% (ECI)',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'FOGRA39',
    source: { kind: 'user-import' },
  },
  bytes: fogra39,
};

function libraryFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  const prefix = 'signal-loom-font://library/';
  if (!url.startsWith(prefix)) return Promise.resolve(new Response('not found', { status: 404 }));
  const resource = decodeURIComponent(url.slice(prefix.length));
  const bytes = readFileSync(join(libraryRoot, resource));
  return Promise.resolve(new Response(bytes, { status: 200 }));
}

describe('bundled font PDF/X integration', () => {
  it('pins, shapes, subsets, and embeds an audited Japanese face in commercial output', async () => {
    const family = inventory.families.find((entry) => entry.family === 'BIZ UDPGothic');
    expect(family).toBeDefined();
    const face = family?.faces.find((entry) => entry.weight === 400 && entry.style === 'normal');
    expect(face).toBeDefined();
    if (!family || !face) return;

    const repository = new MemoryPaperAssetRepository();
    const installed = await installBundledPaperFontFace({ family, face, repository, fetchImpl: libraryFetch as typeof fetch });
    let document = createDefaultPaperDocument({ title: 'Sloom bundled font print proof', preset: 'us-letter' });
    const added = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text',
      xMm: 18,
      yMm: 20,
      widthMm: 170,
      heightMm: 70,
      text: 'SLOOM TYPOGRAPHY / AVATAR\n信号を、かたちへ。日本語組版の印刷証明',
      typography: {
        ...DEFAULT_PAPER_TYPOGRAPHY,
        fontFamily: family.family,
        fontSizePt: 22,
        leadingPt: 30,
        fontWeight: String(face.weight),
        fontKerning: 'normal',
        lineBreakStrict: true,
      },
    });
    document = { ...added.document, importedFonts: [installed] };

    const result = await exportPaperDocumentToPdfx(document, {
      standard: 'pdf-x-4',
      outputDpi: 300,
      outputProfile,
    }, {
      createTransform: (bytes) => createRgbToCmykTransform(bytes, { intent: 'relative' }),
      loadManagedFontBytes: async (assetRef) => {
        const record = await repository.get(assetRef.id);
        if (!record) throw new Error(`Missing managed font ${assetRef.id}.`);
        return record.bytes;
      },
      rasterizePage: async () => { throw new Error('Managed bundled text must stay native.'); },
    });

    expect(result.nativeEvidence.embeddedFontIds).toEqual([installed.id]);
    expect(result.nativeEvidence.flattenedObjectIds).toEqual([]);
    expect(Buffer.from(result.bytes).toString('latin1')).toContain('/FontFile2');
    expect((await validatePaperPdfx(result.bytes, { standard: 'pdf-x-4' })).pass).toBe(true);

    const outputDirectory = process.env.SLOOM_FONT_PROOF_OUTPUT_DIR;
    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(join(outputDirectory, 'Sloom-Bundled-Font-Print-Proof-PDFX4.pdf'), result.bytes);
    }
  }, 30_000);
});
