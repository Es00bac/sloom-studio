import { existsSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import type { BinaryAssetRecord, BinaryAssetRef } from '../../../src/shared/assets/contentAddressedAsset';
import { createBinaryAssetRecord, verifyBinaryAssetRecord } from '../../../src/shared/assets/contentAddressedAsset';
import { MemoryPaperAssetRepository } from '../../../src/features/paper/assets/PaperAssetRepository';
import { addFrameToPaperPage, createDefaultPaperDocument, paperPixelsFromMm, updatePaperDocumentSetup } from '../../../src/lib/paperDocument';
import { createRgbToCmykTransform } from '../../../src/lib/paperIccEngine';
import type { PaperOutputProfileResolution } from '../../../src/lib/paperManagedIccProfiles';
import { exportPaperDocumentToPdfx } from '../../../src/lib/paperPdfxPipeline';
import type { PdfxStandard } from '../../../src/lib/paperPdfxExport';
import { validatePaperPdfx } from '../../../src/lib/paperPdfxValidate';
import type { ExportValidatedPaperPdfxDependencies } from '../../../src/lib/paperProductionPreflight';
import type { PaperDocument, PaperManagedFontFace, PaperManagedIccProfile } from '../../../src/types/paper';
import type { PaperSwatch } from '../../../src/lib/paperSwatches';

const FIXED_TIMESTAMP = Date.parse('2024-01-01T00:00:00.000Z');
const FIXED_CREATED_AT = new Date('2024-01-01T00:00:00.000Z');
const CJK_FONT_CANDIDATES = [
  process.env.PAPER_GOLDEN_CJK_FONT,
  '/usr/share/fonts/droid/DroidSansJapanese.ttf',
].filter((candidate): candidate is string => Boolean(candidate?.trim()));

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PaperProductionGoldenFixture {
  document: PaperDocument;
  /** The source has a local exact Japanese face only when a caller has supplied or installed one. */
  verticalJapaneseAvailable: boolean;
  /** Full-strength and half-strength instances of the same named spot. */
  spotTints: readonly [100, 50];
  deps(
    standard: PdfxStandard,
    download: (bytes: Uint8Array) => void | Promise<void>,
  ): ExportValidatedPaperPdfxDependencies;
}

function fileBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

function sameReference(left: BinaryAssetRef, right: BinaryAssetRef): boolean {
  return left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength;
}

function managedFace(input: {
  id: string;
  familyId: string;
  familyName: string;
  postscriptName: string;
  asset: BinaryAssetRef;
  unicodeRanges?: Array<{ start: number; end: number }>;
}): PaperManagedFontFace {
  return {
    id: input.id,
    familyId: input.familyId,
    familyName: input.familyName,
    postscriptName: input.postscriptName,
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: input.unicodeRanges ?? [{ start: 0x20, end: 0x7e }],
    format: 'truetype',
    fontAsset: input.asset,
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
  };
}

function syntheticSrgbRaster(): { rgba: Uint8Array; widthPx: number; heightPx: number } {
  const widthPx = 600;
  const heightPx = 400;
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const offset = (y * widthPx + x) * 4;
      rgba[offset] = 32 + ((x * 191) / (widthPx - 1));
      rgba[offset + 1] = 48 + ((y * 159) / (heightPx - 1));
      rgba[offset + 2] = 210 - (((x + y) * 140) / (widthPx + heightPx - 2));
      rgba[offset + 3] = 255;
    }
  }
  return { rgba, widthPx, heightPx };
}

function fullPageImageSelectionRaster(document: PaperDocument, pageId: string, dpi: number): { rgba: Uint8Array; widthPx: number; heightPx: number } {
  const frame = document.pages.find((page) => page.id === pageId)?.frames.find((candidate) => candidate.id === 'stability-upscaled-srgb-image');
  if (!frame) throw new Error(`Golden fixture could not resolve the selected image frame on page ${pageId}.`);
  const widthPx = paperPixelsFromMm(document.page.widthMm + document.page.bleedMm * 2, dpi);
  const heightPx = paperPixelsFromMm(document.page.heightMm + document.page.bleedMm * 2, dpi);
  const left = paperPixelsFromMm(document.page.bleedMm + frame.xMm, dpi);
  const top = paperPixelsFromMm(document.page.bleedMm + frame.yMm, dpi);
  const imageWidthPx = paperPixelsFromMm(frame.widthMm, dpi);
  const imageHeightPx = paperPixelsFromMm(frame.heightMm, dpi);
  const source = syntheticSrgbRaster();
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  for (let y = 0; y < imageHeightPx && top + y < heightPx; y += 1) {
    const sourceY = Math.min(source.heightPx - 1, Math.floor(y / imageHeightPx * source.heightPx));
    for (let x = 0; x < imageWidthPx && left + x < widthPx; x += 1) {
      const sourceX = Math.min(source.widthPx - 1, Math.floor(x / imageWidthPx * source.widthPx));
      const sourceOffset = (sourceY * source.widthPx + sourceX) * 4;
      const targetOffset = ((top + y) * widthPx + left + x) * 4;
      rgba.set(source.rgba.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
  return { rgba, widthPx, heightPx };
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, pngCrc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

function encodeRgbaPng({ rgba, widthPx, heightPx }: { rgba: Uint8Array; widthPx: number; heightPx: number }): Uint8Array {
  const raw = new Uint8Array(heightPx * (widthPx * 4 + 1));
  for (let y = 0; y < heightPx; y += 1) {
    const sourceOffset = y * widthPx * 4;
    const targetOffset = y * (widthPx * 4 + 1);
    raw[targetOffset] = 0;
    raw.set(rgba.subarray(sourceOffset, sourceOffset + widthPx * 4), targetOffset + 1);
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, widthPx);
  headerView.setUint32(4, heightPx);
  header[8] = 8;
  header[9] = 6;
  return concatBytes([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', new Uint8Array(deflateSync(raw))),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

// This binary is a real 600x400 PNG and matches the explicit source dimensions carried by the managed asset.
const STABILITY_UPSCALED_PNG_FIXTURE = encodeRgbaPng(syntheticSrgbRaster());

function addGoldenFrame(document: PaperDocument, frame: Parameters<typeof addFrameToPaperPage>[2]): PaperDocument {
  return addFrameToPaperPage(document, document.pages[0].id, frame).document;
}

function exactProfile(asset: BinaryAssetRef): PaperManagedIccProfile {
  return {
    id: asset.id,
    asset,
    description: 'ISO Coated v2 300% (ECI)',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'FOGRA39',
    registryName: 'https://www.color.org/chardata/rgb/FOGRA39.xalter',
    source: { kind: 'user-import' },
  };
}

function goldenSwatches(): PaperSwatch[] {
  return [
    {
      id: 'exact-process-cmyk',
      name: 'Exact CMYK panel',
      type: 'process',
      model: 'cmyk',
      rgb: { r: 44, g: 34, b: 28 },
      cmyk: { c: 12, m: 34, y: 56, k: 78 },
    },
    {
      id: 'spot-pantone-185-c',
      name: 'PANTONE 185 C',
      type: 'spot',
      model: 'cmyk',
      spotName: 'PANTONE 185 C',
      rgb: { r: 227, g: 6, b: 19 },
      cmyk: { c: 0, m: 90, y: 85, k: 0 },
    },
  ];
}

/**
 * Produces a local-only source document. No fixture font is copied into the repository: a caller can point
 * PAPER_GOLDEN_CJK_FONT at an installed managed face, and this Linux fixture uses its installed Droid face.
 */
export async function buildPaperProductionGoldenFixture(
  input: { standard: PdfxStandard },
): Promise<PaperProductionGoldenFixture> {
  const profileRecord = await createBinaryAssetRecord(
    fileBytes('public/icc/FOGRA39L_coated.icc'),
    { mimeType: 'application/vnd.iccprofile', fileName: 'FOGRA39L_coated.icc' },
  );
  const serifRecord = await createBinaryAssetRecord(
    fileBytes('public/fonts/liberation/LiberationSerif-Regular.ttf'),
    { mimeType: 'font/ttf', fileName: 'LiberationSerif-Regular.ttf' },
  );
  const sansRecord = await createBinaryAssetRecord(
    fileBytes('public/fonts/liberation/LiberationSans-Regular.ttf'),
    { mimeType: 'font/ttf', fileName: 'LiberationSans-Regular.ttf' },
  );
  const imageRecord = await createBinaryAssetRecord(
    STABILITY_UPSCALED_PNG_FIXTURE,
    { mimeType: 'image/png', fileName: 'stability-upscaled-golden.png' },
  );
  const cjkPath = CJK_FONT_CANDIDATES.find((candidate) => existsSync(candidate));
  const cjkRecord = cjkPath
    ? await createBinaryAssetRecord(fileBytes(cjkPath), { mimeType: 'font/ttf', fileName: 'managed-japanese.ttf' })
    : undefined;

  const repository = new MemoryPaperAssetRepository();
  const records: BinaryAssetRecord[] = [profileRecord, serifRecord, sansRecord, imageRecord, ...(cjkRecord ? [cjkRecord] : [])];
  await Promise.all(records.map((record) => repository.put(record)));

  const serifFace = managedFace({
    id: 'golden-managed-serif',
    familyId: 'golden managed serif',
    familyName: 'Golden Managed Serif',
    postscriptName: 'GoldenManagedSerif-Regular',
    asset: serifRecord.ref,
  });
  const sansFace = managedFace({
    id: 'golden-managed-sans',
    familyId: 'golden managed sans',
    familyName: 'Golden Managed Sans',
    postscriptName: 'GoldenManagedSans-Regular',
    asset: sansRecord.ref,
  });
  const verticalFace = cjkRecord
    ? managedFace({
      id: 'golden-managed-japanese',
      familyId: 'golden managed japanese',
      familyName: 'Golden Managed Japanese',
      postscriptName: 'GoldenManagedJapanese-Regular',
      asset: cjkRecord.ref,
      unicodeRanges: [{ start: 0x20, end: 0x10ffff }],
    })
    : sansFace;
  const profile = exactProfile(profileRecord.ref);
  const outputProfile: Extract<PaperOutputProfileResolution, { status: 'ready' }> = {
    status: 'ready',
    profile,
    bytes: new Uint8Array(profileRecord.bytes),
  };

  let document = createDefaultPaperDocument({ title: 'Paper production golden', preset: 'a4', dpi: 300 });
  document = updatePaperDocumentSetup(document, {
    bleedMm: 3,
    printProduction: {
      pdfStandard: input.standard,
      outputIntentProfileId: 'custom',
      outputIntentProfileAssetId: profile.id,
      customOutputIntentName: 'FOGRA39',
      totalInkLimitPercent: 300,
      spotColorPolicy: 'preserve-named',
      overprintPreview: true,
    },
    managedIccProfiles: [profile],
  });
  document = {
    ...document,
    swatches: goldenSwatches(),
    importedFonts: cjkRecord ? [serifFace, sansFace, verticalFace] : [serifFace, sansFace],
  };

  document = addGoldenFrame(document, {
    id: 'exact-cmyk-panel', kind: 'panel', label: 'Exact CMYK panel',
    xMm: 12, yMm: 12, widthMm: 76, heightMm: 34,
    fillColor: '#2c221c', fillSwatchId: 'exact-process-cmyk',
    strokeColor: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0,
  });
  document = addGoldenFrame(document, {
    id: 'spot-full-strength', kind: 'panel', label: 'PANTONE 185 C 100%',
    xMm: 12, yMm: 53, widthMm: 36, heightMm: 22,
    fillColor: '#e30613', fillSwatchId: 'spot-pantone-185-c', fillTintPercent: 100,
    strokeColor: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0,
  });
  document = addGoldenFrame(document, {
    id: 'spot-half-tint', kind: 'panel', label: 'PANTONE 185 C 50%',
    xMm: 52, yMm: 53, widthMm: 36, heightMm: 22,
    fillColor: '#f18389', fillSwatchId: 'spot-pantone-185-c', fillTintPercent: 50,
    strokeColor: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0,
  });
  document = addGoldenFrame(document, {
    id: 'stability-upscaled-srgb-image', kind: 'image', label: 'Stability upscaled sRGB image',
    xMm: 108, yMm: 12, widthMm: 50.8, heightMm: 33.8,
    fillColor: 'transparent', fillOpacity: 0, strokeColor: 'transparent', strokeWidthMm: 0,
    asset: {
      label: 'Stability upscaled golden image', kind: 'image', mimeType: imageRecord.ref.mimeType,
      locator: { kind: 'managed', ref: imageRecord.ref }, pixelWidth: 600, pixelHeight: 400,
      printUpscale: {
        provider: 'stability', mode: 'conservative', providerWidthPx: 600, providerHeightPx: 400,
        effectivePpi: 300, requiredPpi: 300, printReady: true,
      },
    },
  });
  document = addGoldenFrame(document, {
    id: 'mixed-managed-rich-text', kind: 'text', label: 'Mixed managed rich text',
    xMm: 12, yMm: 86, widthMm: 145, heightMm: 32,
    fillColor: 'transparent', fillOpacity: 0, strokeColor: 'transparent', strokeWidthMm: 0,
    typography: {
      fontFamily: serifFace.familyName, fontSizePt: 16, leadingPt: 20, tracking: 0,
      align: 'left', hyphenate: false, color: '#172033', fontWeight: '400', fontStyle: 'normal',
    },
    richText: [{ runs: [
      { text: 'Managed serif ' },
      { text: 'and managed sans', fontFamily: sansFace.familyName, color: '#0f766e' },
      { text: ' rich text.' },
    ] }],
  });
  document = addGoldenFrame(document, {
    id: 'vertical-japanese-type', kind: 'text', label: 'Vertical Japanese managed type',
    xMm: 165, yMm: 12, widthMm: 30, heightMm: 106,
    fillColor: 'transparent', fillOpacity: 0, strokeColor: 'transparent', strokeWidthMm: 0,
    typography: {
      fontFamily: verticalFace.familyName, fontSizePt: 15, leadingPt: 19, tracking: 0,
      align: 'left', hyphenate: false, color: '#25213a', fontWeight: '400', fontStyle: 'normal',
      writingMode: 'vertical-rl', textOrientation: 'mixed', lineBreakStrict: true,
    },
    text: cjkRecord ? '印刷のための縦書き日本語。' : 'VERTICAL TYPE',
  });
  document = addGoldenFrame(document, {
    id: input.standard === 'pdf-x-4' ? 'native-x4-transparency' : 'flattened-x1a-transparency',
    kind: 'panel', label: input.standard === 'pdf-x-4' ? 'Native X-4 transparency' : 'Flattened X-1a transparency equivalent',
    xMm: 12, yMm: 128, widthMm: 80, heightMm: 30,
    fillColor: input.standard === 'pdf-x-4' ? '#4f6f9f' : '#8ea0b5',
    opacity: input.standard === 'pdf-x-4' ? 0.5 : 1,
    strokeColor: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0,
  });

  document = {
    ...document,
    id: 'paper-production-golden',
    pages: document.pages.map((page) => ({ ...page, id: 'paper-production-golden-page-1' })),
    parentPages: document.parentPages.map((parent, index) => ({ ...parent, id: `paper-production-golden-parent-${index + 1}` })),
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  };

  const assetExists = async (reference: BinaryAssetRef): Promise<boolean> => {
    const record = await repository.get(reference.id);
    return Boolean(record && sameReference(record.ref, reference) && await verifyBinaryAssetRecord(record));
  };
  const loadManagedFontBytes = async (reference: BinaryAssetRef): Promise<Uint8Array> => {
    const record = await repository.get(reference.id);
    if (!record || !sameReference(record.ref, reference) || !(await verifyBinaryAssetRecord(record))) {
      throw new Error(`Golden fixture cannot resolve managed font ${reference.id}.`);
    }
    return new Uint8Array(record.bytes);
  };

  return {
    document,
    verticalJapaneseAvailable: Boolean(cjkRecord),
    spotTints: [100, 50],
    deps: (standard, download) => ({
      standard,
      requiredPpi: 300,
      assetExists,
      generate: (frozenDocument) => exportPaperDocumentToPdfx(
        frozenDocument,
        {
          standard,
          outputDpi: 300,
          outputProfile,
          title: 'Paper production golden',
          createdAt: FIXED_CREATED_AT,
          documentId: standard === 'pdf-x-1a'
            ? '00112233445566778899aabbccddeeff'
            : 'ffeeddccbbaa99887766554433221100',
        },
        {
          createTransform: (bytes) => createRgbToCmykTransform(bytes, { intent: 'relative' }),
          loadManagedFontBytes,
          rasterizePage: async (pageId, dpi, options) => {
            const frameIds = options?.renderFrameIds ?? [];
            if (frameIds.length !== 1 || frameIds[0] !== 'stability-upscaled-srgb-image') {
              throw new Error(`Golden fixture received an unexpected raster request: ${frameIds.join(', ') || 'none'}.`);
            }
            return fullPageImageSelectionRaster(frozenDocument, pageId, dpi);
          },
        },
      ),
      validate: validatePaperPdfx,
      download,
    }),
  };
}
