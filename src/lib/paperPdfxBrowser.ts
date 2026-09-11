// Browser/Electron adapter for the real PDF/X pipeline (docs/notes/836). Supplies the concrete
// dependencies the pure pipeline needs: resolve a managed exact ICC profile, rasterize each page (with
// bleed) to RGBA via the flatten-export canvas path, and build the real lcms2 sRGB→CMYK transform.
// Kept out of the pure pipeline so that module stays Node-testable.

import {
  buildFlattenedPaperPageSvgExportWithEmbeddedAssets,
  imageSourceToDataUrl,
  rasterizeFlattenedPaperPageToRgba,
} from './paperPageFlattenExport';
import { createRgbToCmykTransform } from './paperIccEngine';
import {
  exportPaperDocumentToPdfx,
  type PaperPdfxPipelineOptions,
} from './paperPdfxPipeline';
import { resolveExactPaperOutputProfile } from './paperManagedIccProfiles';
import type { PdfxExportResult } from './paperPdfxExport';
import type { PaperDocument } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import {
  materializePaperDocumentAssetUrls,
  buildPaperDocumentExactManagedFontOutput,
  paperAssetRepository,
} from '../features/paper/assets/PaperAssetRuntime';
import { useSourceBinStore } from '../store/sourceBinStore';
import { createPaperPlacedDocumentRasterizationGuard } from './paperPlacedDocumentRasterization';

async function loadManagedPaperFont(assetRef: BinaryAssetRef): Promise<Uint8Array> {
  const record = await paperAssetRepository.get(assetRef.id);
  if (!record || record.ref.sha256 !== assetRef.sha256 || record.ref.byteLength !== assetRef.byteLength) {
    throw new Error(`Managed Paper font ${assetRef.id} is unavailable or does not match its document reference.`);
  }
  return record.bytes;
}

/** Export a PaperDocument to a real PDF/X in the browser/Electron renderer. Returns the PDF bytes. */
export async function exportPaperDocumentToPdfxInBrowser(
  document: PaperDocument,
  options: Omit<PaperPdfxPipelineOptions, 'outputProfile'>,
): Promise<PdfxExportResult> {
  // PDF/X may flatten only selected groups, but a placed PDF has no trustworthy browser raster
  // adapter. Stop before profile/materialization work so no mixed-page handoff is created. The
  // current Source Library items are authoritative for linked frames whose persisted metadata
  // predates an in-place source replacement.
  const assertCurrentSources = createPaperPlacedDocumentRasterizationGuard(
    document,
    () => useSourceBinStore.getState().getAllItems(),
  );
  const outputProfile = await resolveExactPaperOutputProfile({
    profiles: document.managedIccProfiles ?? [],
    getAsset: (id) => paperAssetRepository.get(id),
  }, document.printProduction.outputIntentProfileAssetId);
  if (outputProfile.status !== 'ready') {
    const detail = outputProfile.status === 'invalid' ? `: ${outputProfile.reason}` : '';
    throw new Error(`The selected managed CMYK output profile is unavailable${detail}`);
  }
  assertCurrentSources();
  const materializedDocument = await materializePaperDocumentAssetUrls(
    document,
    assertCurrentSources.sourceItems,
  );
  assertCurrentSources();
  const exact = await buildPaperDocumentExactManagedFontOutput(materializedDocument);
  assertCurrentSources();
  const browserDocument = exact.document;
  const compositionDocument = exact.compositionDocument;
  const result = await exportPaperDocumentToPdfx(compositionDocument, { ...options, outputProfile }, {
    createTransform: (bytes) => createRgbToCmykTransform(bytes, { intent: 'relative' }),
    loadManagedFontBytes: loadManagedPaperFont,
    rasterizePage: async (pageId, outputDpi, rasterOptions) => {
      const svgExport = await buildFlattenedPaperPageSvgExportWithEmbeddedAssets(browserDocument, pageId, {
        includeBleed: true,
        outputDpi,
        backdropOnly: rasterOptions?.backdropOnly ?? false,
        excludeTextFrameIds: rasterOptions?.excludeTextFrameIds,
        excludeFrameFillIds: rasterOptions?.excludeFrameFillIds,
        excludeFrameStrokeIds: rasterOptions?.excludeFrameStrokeIds,
        renderFrameIds: rasterOptions?.renderFrameIds,
        includePageBackground: rasterOptions?.includePageBackground,
        resolveImageSrc: imageSourceToDataUrl,
        fontFaceCss: exact.fontFaceCss,
      });
      const raster = await rasterizeFlattenedPaperPageToRgba(svgExport);
      return { rgba: raster.rgba, widthPx: raster.widthPx, heightPx: raster.heightPx };
    },
  });
  assertCurrentSources();
  return result;
}
