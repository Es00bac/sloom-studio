import { IndexedDbPaperAssetRepository } from './PaperIndexedDbAssetRepository';
import { PaperAssetUrlRegistry } from './PaperAssetUrlRegistry';
import { MemoryPaperAssetRepository, type PaperAssetRepository } from './PaperAssetRepository';
import { verifyBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import type { SourceBinLibraryItem } from '../../../store/sourceBinStore';
import type { PaperDocument, PaperFrame } from '../../../types/paper';
import { resolvePaperDocumentEffectiveTypographyForOutput } from '../../../lib/paperDocument';
import { resolvePaperFrameAssetUrl } from '../../../lib/paperAssetReferences';
import type { BinaryAssetRef } from '../../../shared/assets/contentAddressedAsset';
import {
  aliasPaperDocumentManagedFontFamiliesForOutput,
  assertNoConflictingPaperManagedFontDescriptors,
  buildExactPaperManagedFontCss,
  collectExactPaperManagedFaces,
} from '../../../lib/paperExactManagedFonts';
import { paperFrameLayerIsPrintable, paperParentPageIsApplied } from '../../../lib/paperLayers';

/** Shared renderer-side Paper asset storage. Native project storage joins this contract in Project 3. */
export const paperAssetRepository: PaperAssetRepository = globalThis.indexedDB
  ? new IndexedDbPaperAssetRepository(globalThis.indexedDB)
  : new MemoryPaperAssetRepository();

/** Object URLs are runtime leases only and never become Paper document state. */
export const paperAssetUrlRegistry = new PaperAssetUrlRegistry(paperAssetRepository);

export interface PaperExactManagedFontOutput {
  /** Browser-paint projection whose managed families are digest-derived CSS aliases. */
  document: PaperDocument;
  /** Native-composition projection retaining the authored managed-family identities. */
  compositionDocument: PaperDocument;
  fontFaceCss?: string;
}

/** Exact isolated-document payload for browser print, SVG flattening, soft proof and Electron PDF. */
export async function buildPaperDocumentExactManagedFontOutput(document: PaperDocument): Promise<PaperExactManagedFontOutput> {
  // Paragraph/character styles supply the effective face at render time, so face collection and
  // aliasing must run on the export-only effective projection — otherwise a style-linked frame
  // paints a raw style family the alias CSS never declares.
  const effectiveDocument = resolvePaperDocumentEffectiveTypographyForOutput(document);
  const activeParentPages = effectiveDocument.parentPages.filter((parentPage) => (
    paperParentPageIsApplied(effectiveDocument, parentPage.id)
  ));
  const frames = [...effectiveDocument.pages, ...activeParentPages]
    .flatMap((page) => page.frames)
    .filter((frame) => paperFrameLayerIsPrintable(effectiveDocument, frame));
  const faces = collectExactPaperManagedFaces(frames, document.importedFonts);
  // An unused face on a hidden/non-printing layer cannot make visible output ambiguous.
  assertNoConflictingPaperManagedFontDescriptors(faces);
  if (faces.length === 0) {
    return { document: effectiveDocument, compositionDocument: effectiveDocument };
  }
  const fontFaceCss = await buildExactPaperManagedFontCss(faces, async (ref) => {
    const record = await paperAssetRepository.get(ref.id);
    if (!record || record.ref.id !== ref.id || record.ref.sha256 !== ref.sha256 || record.ref.byteLength !== ref.byteLength || record.ref.mimeType !== ref.mimeType || !(await verifyBinaryAssetRecord(record))) {
      throw new Error(`Managed font ${ref.id} is unavailable or does not match its document reference.`);
    }
    return record.bytes;
  });
  return {
    document: aliasPaperDocumentManagedFontFamiliesForOutput(effectiveDocument),
    compositionDocument: effectiveDocument,
    fontFaceCss,
  };
}

/**
 * Produces an export-only Paper document whose image/document locators are concrete URLs. Managed records
 * become transient data URLs in this returned copy; the live document, history, and project JSON retain
 * only their content-addressed references.
 */
export async function materializePaperDocumentAssetUrls(
  document: PaperDocument,
  sourceItems: readonly Pick<SourceBinLibraryItem, 'id' | 'assetUrl' | 'mimeType'>[] = [],
): Promise<PaperDocument> {
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const [pages, parentPages] = await Promise.all([
    Promise.all(document.pages.map((page) => materializePaperFrameContainer(document, page, sourceById))),
    Promise.all(document.parentPages.map((page) => (
      paperParentPageIsApplied(document, page.id)
        ? materializePaperFrameContainer(document, page, sourceById)
        : Promise.resolve({ value: page, changed: false })
    ))),
  ]);
  const changed = [...pages, ...parentPages].some((entry) => entry.changed);
  if (!changed) return document;
  return {
    ...document,
    pages: pages.map((entry) => entry.value),
    parentPages: parentPages.map((entry) => entry.value),
  };
}

async function materializePaperFrameContainer<T extends { frames: PaperFrame[] }>(
  document: PaperDocument,
  container: T,
  sourceById: ReadonlyMap<string, Pick<SourceBinLibraryItem, 'id' | 'assetUrl' | 'mimeType'>>,
): Promise<{ value: T; changed: boolean }> {
  let changed = false;
  const frames = await Promise.all(container.frames.map(async (frame) => {
    // Preserve authored references for project save/package/sync, but do not demand bytes for
    // content that this output cannot paint.
    if (!paperFrameLayerIsPrintable(document, frame)) return frame;
    const asset = frame.asset;
    if (!asset) return frame;
    const linkedSourceItem = asset.sourceBinItemId ? sourceById.get(asset.sourceBinItemId) : undefined;
    let url = resolvePaperFrameAssetUrl(asset, linkedSourceItem);
    // An in-place Source Library replacement changes the payload without rewriting persisted frame
    // metadata. When the export copy adopts the item's current URL it must adopt the item's current
    // media type with it, or downstream whole-document classification trusts a stale MIME.
    const currentSourceMimeType = url && url === linkedSourceItem?.assetUrl
      ? linkedSourceItem.mimeType
      : undefined;
    if (!url && asset.locator?.kind === 'managed') {
      const record = await paperAssetRepository.get(asset.locator.ref.id);
      if (!record) {
        throw new Error(`Paper asset ${asset.locator.ref.id} is unavailable for export.`);
      }
      assertMatchingManagedAssetRef(record.ref, asset.locator.ref);
      if (!(await verifyBinaryAssetRecord(record))) {
        throw new Error(`Paper asset ${asset.locator.ref.id} fails its content hash verification.`);
      }
      url = await paperBytesToDataUrl(record.bytes, record.ref.mimeType);
    }
    if (!url && (frame.kind === 'image' || frame.kind === 'document')) {
      throw new Error(`Paper ${frame.kind} frame "${frame.label}" has no resolvable asset reference.`);
    }
    if (!url) return frame;
    changed = true;
    return {
      ...frame,
      asset: {
        ...asset,
        ...(currentSourceMimeType ? { mimeType: currentSourceMimeType } : {}),
        locator: { kind: 'external' as const, url },
      },
    };
  }));
  return changed ? { value: { ...container, frames }, changed } : { value: container, changed };
}

function assertMatchingManagedAssetRef(record: BinaryAssetRef, declared: BinaryAssetRef): void {
  if (
    record.id !== declared.id
    || record.sha256 !== declared.sha256
    || record.mimeType !== declared.mimeType
    || record.byteLength !== declared.byteLength
  ) {
    throw new Error(`Paper asset ${declared.id} does not match its document reference.`);
  }
}

function paperBytesToDataUrl(bytes: Uint8Array, mimeType: string): Promise<string> {
  if (typeof FileReader === 'undefined') {
    // Node-side export tests have no FileReader. This data URL exists only in the ephemeral export copy,
    // never in Paper state or its serialized snapshots.
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return Promise.resolve(`data:${mimeType};base64,${btoa(binary)}`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Paper managed asset could not be materialized for export.'));
    };
    reader.onerror = () => reject(new Error('Paper managed asset could not be materialized for export.'));
    reader.readAsDataURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
  });
}
