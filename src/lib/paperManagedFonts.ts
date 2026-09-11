import { isBinaryAssetRef, type BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type {
  PaperDocument,
  PaperFontEmbeddability,
  PaperManagedFontAxisRange,
  PaperManagedFontFace,
  PaperManagedFontStyle,
} from '../types/paper';

export interface PaperFontEmbeddingFlags {
  noEmbedding?: boolean;
  viewOnly?: boolean;
  editable?: boolean;
  noSubsetting?: boolean;
  bitmapOnly?: boolean;
}

/** Licenses whose authoritative text may authorize a version-pinned Fontsource face without a user attestation. */
export const OPEN_CATALOG_LICENSE_IDS = ['OFL-1.1', 'Apache-2.0', 'MIT'] as const;
type OpenCatalogLicenseId = (typeof OPEN_CATALOG_LICENSE_IDS)[number];

const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export type PaperFontRightsReason =
  | 'restricted'
  | 'bitmap-only'
  | 'rights-unknown'
  | 'attestation-required'
  | 'attestation-mismatch';

export interface PaperFontRights {
  embeddability: PaperFontEmbeddability;
  embeddable: boolean;
  canSubset: boolean;
  reason?: PaperFontRightsReason;
}

/** Maps OS/2 fsType flags to the stricter production-facing rights contract. */
export function classifyFontEmbeddingRights(flags: PaperFontEmbeddingFlags | undefined): PaperFontRights {
  if (!flags) {
    return {
      embeddability: 'unknown',
      // Import is allowed so the user can inspect/attest, but strict export checks attestation separately.
      embeddable: true,
      canSubset: true,
      reason: 'rights-unknown',
    };
  }
  if (flags.bitmapOnly) {
    return { embeddability: 'bitmap-only', embeddable: false, canSubset: false, reason: 'bitmap-only' };
  }
  if (flags.noEmbedding) {
    return { embeddability: 'restricted', embeddable: false, canSubset: false, reason: 'restricted' };
  }
  return {
    embeddability: flags.editable ? 'editable' : flags.viewOnly ? 'print-preview' : 'installable',
    embeddable: true,
    canSubset: !flags.noSubsetting,
  };
}

export function canUseManagedFontForProduction(face: PaperManagedFontFace):
  | { allowed: true }
  | { allowed: false; reason: PaperFontRightsReason } {
  if (face.embeddability === 'bitmap-only') return { allowed: false, reason: 'bitmap-only' };
  if (face.embeddability === 'restricted') return { allowed: false, reason: 'restricted' };
  if (face.embeddability !== 'unknown') return { allowed: true };

  if (hasAuthoritativeOpenCatalogLicense(face)) return { allowed: true };

  if (!face.attestation) return { allowed: false, reason: 'attestation-required' };
  if (face.attestation.assetSha256 !== face.fontAsset.sha256) {
    return { allowed: false, reason: 'attestation-mismatch' };
  }
  if (!face.attestation.mayEmbedOutput) return { allowed: false, reason: 'attestation-required' };
  return { allowed: true };
}

export type PaperFontPackagingVerdict =
  | { allowed: true; licenseTextRequired: boolean }
  | { allowed: false; reason: PaperFontRightsReason; detail: string };

/**
 * Whether this exact face's BYTES may be redistributed inside a portable editable project or a
 * print package. This is a stricter right than embedding rendered output: fsType installable and
 * editable embedding cover a travelling editable document, while preview/print-only and
 * unknown-rights faces need the explicit byte-bound `mayPackageEditableProject` attestation.
 * Disallowed faces must fail closed in strict flows — never be silently omitted or substituted.
 */
export function classifyPaperFontPackaging(face: PaperManagedFontFace): PaperFontPackagingVerdict {
  const identity = `"${face.familyName}" (${face.postscriptName})`;
  if (face.embeddability === 'bitmap-only') {
    return {
      allowed: false,
      reason: 'bitmap-only',
      detail: `${identity} permits bitmap embedding only, so its font file cannot be packaged. Replace this font or remove it from the document.`,
    };
  }
  if (face.embeddability === 'restricted') {
    return {
      allowed: false,
      reason: 'restricted',
      detail: `${identity} forbids embedding (OS/2 fsType Restricted License), so its font file cannot be packaged. Replace this font or remove it from the document.`,
    };
  }
  if (face.source.kind === 'bundled' || hasAuthoritativeOpenCatalogLicense(face)) {
    return { allowed: true, licenseTextRequired: isBinaryAssetRef(face.license.textAsset) };
  }

  const attestation = face.attestation;
  if (attestation && attestation.assetSha256 !== face.fontAsset.sha256) {
    return {
      allowed: false,
      reason: 'attestation-mismatch',
      detail: `${identity} carries a rights attestation for different font bytes. Re-confirm the packaging rights for the current file in the font manager.`,
    };
  }
  if (attestation?.mayPackageEditableProject) {
    return { allowed: true, licenseTextRequired: isBinaryAssetRef(face.license.textAsset) };
  }
  if (face.embeddability === 'installable' || face.embeddability === 'editable') {
    return { allowed: true, licenseTextRequired: isBinaryAssetRef(face.license.textAsset) };
  }
  return {
    allowed: false,
    reason: 'attestation-required',
    detail: face.embeddability === 'print-preview'
      ? `${identity} permits print/preview embedding only. Attest that you hold packaging rights for this font in the font manager, or remove it from the document.`
      : `${identity} has unknown embedding rights. Attest that you hold packaging rights for this font in the font manager, or remove it from the document.`,
  };
}

/**
 * The download flow fetches and hashes the license text before producing these metadata fields. This exception
 * exists only for the approved, version-pinned catalog shape; every user-imported unknown-rights font still
 * requires the explicit byte-bound attestation below.
 */
function hasAuthoritativeOpenCatalogLicense(face: PaperManagedFontFace): boolean {
  if (face.source.kind !== 'open-catalog') return false;
  if (!face.source.url || !face.source.version || !SEMVER_PATTERN.test(face.source.version)) return false;
  if (!OPEN_CATALOG_LICENSE_IDS.includes(face.license.id as OpenCatalogLicenseId)) return false;
  if (!isBinaryAssetRef(face.fontAsset) || !isBinaryAssetRef(face.license.textAsset)) return false;
  if (face.license.textAsset.mimeType !== 'text/plain' || face.license.textAsset.byteLength === 0) return false;

  try {
    const url = new URL(face.source.url);
    const escapedVersion = face.source.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return url.protocol === 'https:'
      && url.hostname === 'cdn.jsdelivr.net'
      && new RegExp(`^/fontsource/fonts/[a-z0-9][a-z0-9-]*@${escapedVersion}/[^/]+\\.ttf$`).test(url.pathname);
  } catch {
    return false;
  }
}

export interface PaperManagedFontFaceRequest {
  familyId: string;
  weight: number;
  style: PaperManagedFontStyle;
  obliqueAngleDeg?: number;
  stretchPercent?: number;
  variationSettings?: Record<string, number>;
}

export type PaperManagedFontFaceSelection =
  | { status: 'selected'; face: PaperManagedFontFace }
  | { status: 'missing-family'; familyId: string }
  | {
    status: 'missing-face';
    familyId: string;
    requestedWeight: number;
    requestedStyle: PaperManagedFontStyle;
    requestedObliqueAngleDeg?: number;
    requestedStretchPercent: number;
  }
  | { status: 'ambiguous-face'; faceIds: string[] };

/** Oblique is an exact descriptor: CSS's omitted-angle default is 14deg, not italic. */
export function canonicalPaperFontObliqueAngle(style: PaperManagedFontStyle, angle?: number): number | undefined {
  if (style !== 'oblique') return undefined;
  const resolved = angle === undefined ? 14 : angle;
  return Number.isFinite(resolved) ? Math.min(90, Math.max(-90, Math.round(resolved * 100) / 100)) : 14;
}

/** Stable, bounded OpenType variation coordinates. Unknown axes and non-finite values never reach output. */
export function normalizePaperFontVariationSettings(
  value: Record<string, number> | undefined,
  axes: Record<string, PaperManagedFontAxisRange> | undefined,
): Record<string, number> | undefined {
  if (!value) return undefined;
  const output: Record<string, number> = {};
  for (const [tag, coordinate] of Object.entries(value)) {
    const axis = axes?.[tag];
    if (!/^[ -~]{4}$/.test(tag) || !axis || !Number.isFinite(coordinate)
      || coordinate < axis.min || coordinate > axis.max) return undefined;
    output[tag] = Math.round(coordinate * 1000) / 1000;
  }
  return Object.keys(output).length ? Object.fromEntries(Object.entries(output).sort(([left], [right]) => left.localeCompare(right))) : undefined;
}

export function paperFontVariationSettingsEqual(
  left: Record<string, number> | undefined,
  right: Record<string, number> | undefined,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

/**
 * Finds only an exact family/weight/style/stretch face. Production never synthesizes bold, italic, or a
 * nearby weight from a different file because those substitutions change metrics and glyph outlines.
 */
export function selectManagedFontFace(
  faces: readonly PaperManagedFontFace[],
  request: PaperManagedFontFaceRequest,
): PaperManagedFontFaceSelection {
  const familyId = normalizePaperFontFamilyId(request.familyId);
  const requestedWeight = normalizePaperFontWeight(request.weight);
  const requestedStyle = request.style;
  const requestedObliqueAngleDeg = canonicalPaperFontObliqueAngle(requestedStyle, request.obliqueAngleDeg);
  const requestedStretchPercent = normalizePaperFontStretch(request.stretchPercent);
  const familyFaces = faces.filter((face) => normalizePaperFontFamilyId(face.familyId) === familyId);
  if (familyFaces.length === 0) return { status: 'missing-family', familyId };

  const matches = familyFaces.filter((candidate) => {
    const requestedVariations = normalizePaperFontVariationSettings(
      request.variationSettings ?? candidate.variationSettings,
      candidate.variableAxes,
    );
    return (
    candidate.weight === requestedWeight
    && candidate.style === requestedStyle
    && canonicalPaperFontObliqueAngle(candidate.style, candidate.obliqueAngleDeg) === requestedObliqueAngleDeg
    && candidate.stretchPercent === requestedStretchPercent
    && (!(request.variationSettings ?? candidate.variationSettings) || requestedVariations !== undefined)
    );
  });
  if (matches.length === 0) {
    return {
      status: 'missing-face', familyId, requestedWeight, requestedStyle,
      ...(requestedObliqueAngleDeg !== undefined ? { requestedObliqueAngleDeg } : {}),
      requestedStretchPercent,
    };
  }
  if (matches.length > 1) return { status: 'ambiguous-face', faceIds: matches.map((face) => face.id).sort() };
  return { status: 'selected', face: matches[0] };
}

/** Stable document-facing family identifier derived from a foundry family name. */
export function normalizePaperFontFamilyId(value: string): string {
  const normalized = value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
  return normalized || 'unnamed-font';
}

export function normalizePaperFontWeight(value: number): number {
  if (!Number.isFinite(value)) return 400;
  return Math.min(1000, Math.max(1, Math.round(value)));
}

export function normalizePaperFontStretch(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 100;
  return Math.min(200, Math.max(50, Math.round(value * 100) / 100));
}

/** Returns every binary record needed to preserve the supplied managed faces and their license evidence. */
export function collectManagedFontDependencies(
  input: readonly PaperManagedFontFace[] | Pick<PaperDocument, 'importedFonts'>,
): BinaryAssetRef[] {
  const faces: readonly PaperManagedFontFace[] = Array.isArray(input)
    ? input as readonly PaperManagedFontFace[]
    : (input as Pick<PaperDocument, 'importedFonts'>).importedFonts ?? [];
  const dependencies = new Map<string, BinaryAssetRef>();
  for (const face of faces) {
    dependencies.set(face.fontAsset.id, face.fontAsset);
    if (face.license.textAsset) dependencies.set(face.license.textAsset.id, face.license.textAsset);
  }
  return [...dependencies.values()].sort((left, right) => left.id.localeCompare(right.id));
}
