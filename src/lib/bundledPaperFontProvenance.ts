import type { PaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import {
  verifyBinaryAssetRecord,
  type BinaryAssetRef,
} from '../shared/assets/contentAddressedAsset';
import type { PaperManagedFontFace, PaperManagedFontStyle } from '../types/paper';
import type { BundledFontFace, BundledFontFamily } from './bundledFontLibrary';
import { normalizePaperFontFamilyId } from './paperManagedFonts';

export interface BundledPaperFontProvenanceIdentity {
  sourceUrl: string;
  sourceVersion: string;
  fontId: string;
  fontSha256: string;
  fontByteLength: number;
  fontMimeType: 'font/otf' | 'font/ttf';
  licenseId: string;
  licenseSha256: string;
  licenseByteLength: number;
  licenseAttribution: string;
  familyId: string;
  familyName: string;
  postscriptName: string;
  weight: number;
  style: PaperManagedFontStyle;
  stretchPercent: number;
  collectionIndex: number;
  variableAxes: PaperManagedFontFace['variableAxes'];
  canSubset: boolean;
}

// Successful installation is positive local evidence even before the next catalog read. Reopen
// after a renderer restart resolves the same identity from the current audited catalog below.
const installedPaperFontProvenance = new Map<string, BundledPaperFontProvenanceIdentity>();

export function registerBundledPaperFontProvenance(
  identity: BundledPaperFontProvenanceIdentity,
): void {
  installedPaperFontProvenance.set(identity.sourceUrl, structuredClone(identity));
}

function provenanceIdentityFromCatalog(
  family: BundledFontFamily,
  face: BundledFontFace,
  resourceUrl: (path: string) => string,
): BundledPaperFontProvenanceIdentity {
  return {
    sourceUrl: resourceUrl(face.file),
    sourceVersion: family.sourceVersion,
    fontId: `bundled-${face.id}`,
    fontSha256: face.sha256,
    fontByteLength: face.byteLength,
    fontMimeType: face.file.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf',
    licenseId: family.licenseId,
    licenseSha256: family.licenseSha256,
    licenseByteLength: family.licenseByteLength,
    licenseAttribution: family.sourceUrl,
    familyId: normalizePaperFontFamilyId(family.family),
    familyName: family.family,
    postscriptName: face.postscriptName,
    weight: face.weight,
    style: face.style,
    stretchPercent: face.stretchPercent,
    collectionIndex: face.collectionIndex,
    variableAxes: structuredClone(face.axes),
    canSubset: face.canSubset,
  };
}

function sameManagedAssetRef(left: BinaryAssetRef, right: BinaryAssetRef): boolean {
  return left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength
    && left.fileName === right.fileName;
}

function sameVariableAxes(
  left: PaperManagedFontFace['variableAxes'],
  right: PaperManagedFontFace['variableAxes'],
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

async function resolveBundledPaperFontProvenanceIdentity(
  sourceUrl: string,
): Promise<BundledPaperFontProvenanceIdentity | undefined> {
  const installed = installedPaperFontProvenance.get(sourceUrl);
  if (installed) return installed;
  try {
    // Catalog loading brings the desktop bridge and font-vetting stack with it. Keep that behind
    // this rare fallback so ordinary Paper asset normalization stays in its small production chunk.
    const { bundledFontResourceUrl, loadBundledFontCatalog } = await import('./bundledFontLibrary');
    const catalog = await loadBundledFontCatalog();
    const matches = catalog.families.flatMap((family) => family.faces
      .filter((face) => bundledFontResourceUrl(face.file) === sourceUrl)
      .map((face) => provenanceIdentityFromCatalog(family, face, bundledFontResourceUrl)));
    return matches.length === 1 ? matches[0] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Retains `bundled` provenance only when the document face is bound to a current catalog or a
 * successful local installer identity and both exact managed records are present and verified.
 * This is a provenance check, not a new licensing-policy audit.
 */
export async function verifyBundledPaperFontProvenance(
  candidate: PaperManagedFontFace,
  repository: PaperAssetRepository,
): Promise<boolean> {
  if (candidate.source.kind !== 'bundled' || !candidate.source.url || !candidate.source.version) {
    return false;
  }
  const expected = await resolveBundledPaperFontProvenanceIdentity(candidate.source.url);
  const licenseRef = candidate.license.textAsset;
  if (
    !expected
    || !licenseRef
    || candidate.source.version !== expected.sourceVersion
    || candidate.id !== expected.fontId
    || candidate.fontAsset.sha256 !== expected.fontSha256
    || candidate.fontAsset.byteLength !== expected.fontByteLength
    || candidate.fontAsset.mimeType !== expected.fontMimeType
    || candidate.license.id !== expected.licenseId
    || licenseRef.sha256 !== expected.licenseSha256
    || licenseRef.byteLength !== expected.licenseByteLength
    || licenseRef.mimeType !== 'text/plain'
    || candidate.license.attribution !== expected.licenseAttribution
    || candidate.familyId !== expected.familyId
    || candidate.familyName !== expected.familyName
    || candidate.postscriptName !== expected.postscriptName
    || candidate.weight !== expected.weight
    || candidate.style !== expected.style
    || candidate.stretchPercent !== expected.stretchPercent
    || candidate.collectionIndex !== expected.collectionIndex
    || !sameVariableAxes(candidate.variableAxes, expected.variableAxes)
    || candidate.canSubset !== expected.canSubset
  ) return false;

  try {
    const [fontRecord, licenseRecord] = await Promise.all([
      repository.get(candidate.fontAsset.id),
      repository.get(licenseRef.id),
    ]);
    if (
      !fontRecord
      || !licenseRecord
      || !sameManagedAssetRef(candidate.fontAsset, fontRecord.ref)
      || !sameManagedAssetRef(licenseRef, licenseRecord.ref)
    ) return false;
    const [fontVerified, licenseVerified] = await Promise.all([
      verifyBinaryAssetRecord(fontRecord),
      verifyBinaryAssetRecord(licenseRecord),
    ]);
    return fontVerified && licenseVerified;
  } catch {
    return false;
  }
}
