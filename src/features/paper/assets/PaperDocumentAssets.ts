import {
  createBinaryAssetRecord,
  isBinaryAssetRef,
  type BinaryAssetId,
  type BinaryAssetRef,
} from '../../../shared/assets/contentAddressedAsset';
import type {
  PaperDocument,
  PaperFontAttestation,
  PaperFrame,
  PaperFrameAsset,
  PaperImportedFont,
  PaperManagedAssetLocator,
  PaperManagedFontFace,
  PaperPage,
} from '../../../types/paper';
import type { PaperAssetRepository } from './PaperAssetRepository';
import {
  normalizePaperFontFamilyId,
  normalizePaperFontStretch,
  normalizePaperFontVariationSettings,
  normalizePaperFontWeight,
} from '../../../lib/paperManagedFonts';
import { isPaperManagedIccProfile } from '../../../lib/paperManagedIccProfiles';
import { verifyBundledPaperFontProvenance } from '../../../lib/bundledPaperFontProvenance';

export type ManagedPaperAssetLocator = PaperManagedAssetLocator;
export type PaperAssetLocator = PaperManagedAssetLocator;
export type ManagedPaperFrameAsset = PaperFrameAsset;
export type ManagedPaperFrame = PaperFrame;
export type ManagedPaperPage = PaperPage;
export type ManagedPaperImportedFont = PaperImportedFont;
export type PaperDocumentWithManagedAssets = PaperDocument;

type LegacyPaperFrameAsset = PaperFrameAsset & { src?: unknown };
type LegacyPaperImportedFont = Partial<PaperImportedFont> & {
  assetRef?: unknown;
  dataBase64?: unknown;
  bold?: unknown;
  italic?: unknown;
  embeddable?: unknown;
  subfamilyName?: unknown;
};

interface LegacySlpprAssetRef {
  $slpprAsset: string;
  mime: string;
}

export interface LegacySlpprAssetPayload {
  bytes: Uint8Array;
  mimeType?: string;
}

export interface MigrateLegacyPaperBinaryOptions {
  legacySlpprAssets?: ReadonlyMap<string, LegacySlpprAssetPayload>;
}

function cloneDocument(document: PaperDocument): PaperDocumentWithManagedAssets {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(document) as unknown as PaperDocumentWithManagedAssets;
  }
  return JSON.parse(JSON.stringify(document)) as PaperDocumentWithManagedAssets;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLegacySlpprAssetRef(value: unknown): value is LegacySlpprAssetRef {
  return isRecord(value)
    && typeof value.$slpprAsset === 'string'
    && value.$slpprAsset.length > 0
    && typeof value.mime === 'string'
    && value.mime.length > 0;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function parseDataUrl(value: string): { bytes: Uint8Array; mimeType: string } | undefined {
  if (!/^data:/i.test(value)) return undefined;
  const match = /^data:([^,]*),(.*)$/is.exec(value);
  if (!match) throw new Error('Malformed Paper asset data URL.');
  const metadata = match[1].trim();
  const mimeType = metadata.split(';', 1)[0]?.trim();
  if (!mimeType) {
    throw new Error('Paper asset data URL must declare a MIME type.');
  }
  const payload = match[2];
  const isBase64 = metadata.split(';').some((part) => part.trim().toLowerCase() === 'base64');
  return {
    bytes: isBase64 ? decodeBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload)),
    mimeType,
  };
}

function fontMimeType(format: PaperImportedFont['format']): string {
  if (format === 'opentype-cff') return 'font/otf';
  if (format === 'truetype') return 'font/ttf';
  return 'font/sfnt';
}

function fontExtension(format: PaperImportedFont['format']): string {
  if (format === 'opentype-cff') return 'otf';
  if (format === 'truetype') return 'ttf';
  return 'ttc';
}

function hasManagedFontFormat(value: unknown): value is PaperManagedFontFace['format'] {
  return value === 'truetype' || value === 'opentype-cff' || value === 'collection';
}

function hasManagedFontStyle(value: unknown): value is PaperManagedFontFace['style'] {
  return value === 'normal' || value === 'italic' || value === 'oblique';
}

function hasFontEmbeddability(value: unknown): value is PaperManagedFontFace['embeddability'] {
  return value === 'installable'
    || value === 'print-preview'
    || value === 'editable'
    || value === 'restricted'
    || value === 'bitmap-only'
    || value === 'unknown';
}

function normalizeVariableAxes(value: unknown): PaperManagedFontFace['variableAxes'] {
  if (!isRecord(value)) return {};
  const axes: PaperManagedFontFace['variableAxes'] = {};
  for (const [tag, candidate] of Object.entries(value)) {
    if (!isRecord(candidate)) continue;
    const min = candidate.min;
    const defaultValue = candidate.default;
    const max = candidate.max;
    if (
      typeof min !== 'number' || !Number.isFinite(min)
      || typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)
      || typeof max !== 'number' || !Number.isFinite(max)
    ) continue;
    axes[tag] = { min, default: defaultValue, max };
  }
  return axes;
}

function normalizeUnicodeRanges(value: unknown): PaperManagedFontFace['unicodeRanges'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const start = candidate.start;
    const end = candidate.end;
    if (
      typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start > 0x10ffff
      || typeof end !== 'number' || !Number.isInteger(end) || end < start || end > 0x10ffff
    ) return [];
    return [{ start, end }];
  });
}

function isCanonicalBundledFontSource(value: Record<string, unknown>): boolean {
  if (
    value.kind !== 'bundled'
    || typeof value.url !== 'string'
    || value.url.length === 0
    || value.url.length > 2_048
    || value.url.trim() !== value.url
    || typeof value.version !== 'string'
    || value.version.length === 0
    || value.version.length > 256
    || value.version.trim() !== value.version
  ) return false;
  try {
    const url = new URL(value.url);
    if (
      url.href !== value.url
      || url.protocol !== 'signal-loom-font:'
      || url.hostname !== 'library'
      || url.username || url.password || url.port || url.search || url.hash
    ) return false;
    const segments = url.pathname.slice(1).split('/');
    if (segments.length < 2 || segments.some((segment) => !segment)) return false;
    const decoded = segments.map((segment) => decodeURIComponent(segment));
    return decoded.every((segment) => segment !== '.' && segment !== '..' && !/[\\/\0]/.test(segment))
      && /\.(?:otf|ttf)$/i.test(decoded.at(-1) ?? '');
  } catch {
    return false;
  }
}

function hasBundledLicenseEvidence(license: PaperManagedFontFace['license']): boolean {
  if (
    !license.id
    || !license.attribution
    || !isBinaryAssetRef(license.textAsset)
    || license.textAsset.mimeType !== 'text/plain'
    || license.textAsset.byteLength === 0
  ) return false;
  try {
    const attribution = new URL(license.attribution);
    return attribution.protocol === 'https:' || attribution.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeFontSource(
  value: unknown,
  license: PaperManagedFontFace['license'],
): PaperManagedFontFace['source'] {
  if (!isRecord(value)) return { kind: 'user-import' };
  if (value.kind === 'bundled') {
    if (!isCanonicalBundledFontSource(value) || !hasBundledLicenseEvidence(license)) {
      return { kind: 'user-import' };
    }
    return { kind: 'bundled', url: value.url as string, version: value.version as string };
  }
  if (value.kind !== 'open-catalog' && value.kind !== 'user-import') return { kind: 'user-import' };
  return {
    kind: value.kind,
    ...(typeof value.url === 'string' && value.url ? { url: value.url } : {}),
    ...(typeof value.version === 'string' && value.version ? { version: value.version } : {}),
  };
}

function normalizeFontLicense(value: unknown): PaperManagedFontFace['license'] {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.id === 'string' && value.id ? { id: value.id } : {}),
    ...(isBinaryAssetRef(value.textAsset) ? { textAsset: value.textAsset } : {}),
    ...(typeof value.attribution === 'string' && value.attribution ? { attribution: value.attribution } : {}),
  };
}

function normalizeFontAttestation(value: unknown): PaperFontAttestation | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.acceptedAt !== 'number' || !Number.isFinite(value.acceptedAt)
    || typeof value.assetSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.assetSha256)
    || typeof value.mayEmbedOutput !== 'boolean'
    || typeof value.mayPackageEditableProject !== 'boolean'
    || value.statementVersion !== 1
  ) return undefined;
  return {
    acceptedAt: value.acceptedAt,
    assetSha256: value.assetSha256.toLowerCase(),
    mayEmbedOutput: value.mayEmbedOutput,
    mayPackageEditableProject: value.mayPackageEditableProject,
    statementVersion: 1,
  };
}

/** Normalizes historical imported-font shapes into one explicit production-managed face. */
async function normalizeManagedFontFace(
  candidate: LegacyPaperImportedFont,
  fontAsset: BinaryAssetRef,
  repository: PaperAssetRepository,
): Promise<PaperManagedFontFace> {
  const familyName = typeof candidate.familyName === 'string' && candidate.familyName.trim()
    ? candidate.familyName.trim()
    : 'Imported Font';
  const weight = normalizePaperFontWeight(
    typeof candidate.weight === 'number' ? candidate.weight : candidate.bold === true ? 700 : 400,
  );
  const style = hasManagedFontStyle(candidate.style)
    ? candidate.style
    : candidate.italic === true ? 'italic' : 'normal';
  const obliqueAngleDeg = style === 'oblique' && typeof candidate.obliqueAngleDeg === 'number'
    && Number.isFinite(candidate.obliqueAngleDeg)
    ? Math.min(90, Math.max(-90, Math.round(candidate.obliqueAngleDeg * 100) / 100))
    : undefined;
  const collectionIndex = typeof candidate.collectionIndex === 'number'
    && Number.isInteger(candidate.collectionIndex)
    && candidate.collectionIndex >= 0
    ? candidate.collectionIndex
    : 0;
  const variableAxes = normalizeVariableAxes(candidate.variableAxes);
  const variationSettings = isRecord(candidate.variationSettings)
    ? normalizePaperFontVariationSettings(
      candidate.variationSettings as Record<string, number>,
      variableAxes,
    )
    : undefined;
  const license = normalizeFontLicense(candidate.license);
  const attestation = normalizeFontAttestation(candidate.attestation);
  const normalized: PaperManagedFontFace = {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `imported-font-${fontAsset.sha256.slice(0, 12)}`,
    familyId: typeof candidate.familyId === 'string' && candidate.familyId.trim()
      ? normalizePaperFontFamilyId(candidate.familyId)
      : normalizePaperFontFamilyId(familyName),
    familyName,
    postscriptName: typeof candidate.postscriptName === 'string' && candidate.postscriptName.trim()
      ? candidate.postscriptName.trim()
      : familyName,
    weight,
    style,
    ...(style === 'oblique' ? { obliqueAngleDeg: obliqueAngleDeg ?? 14 } : {}),
    stretchPercent: normalizePaperFontStretch(
      typeof candidate.stretchPercent === 'number' ? candidate.stretchPercent : undefined,
    ),
    collectionIndex,
    variableAxes,
    ...(variationSettings ? { variationSettings } : {}),
    unicodeRanges: normalizeUnicodeRanges(candidate.unicodeRanges),
    format: hasManagedFontFormat(candidate.format) ? candidate.format : 'truetype',
    fontAsset,
    embeddability: hasFontEmbeddability(candidate.embeddability)
      ? candidate.embeddability
      : candidate.embeddable === false ? 'restricted' : 'unknown',
    canSubset: candidate.canSubset !== false,
    source: normalizeFontSource(candidate.source, license),
    license,
    ...(attestation ? { attestation } : {}),
  };
  if (
    normalized.source.kind === 'bundled'
    && !await verifyBundledPaperFontProvenance(normalized, repository)
  ) {
    normalized.source = { kind: 'user-import' };
  }
  return normalized;
}

async function storePayload(
  repository: PaperAssetRepository,
  bytes: Uint8Array,
  metadata: { mimeType: string; fileName?: string },
): Promise<BinaryAssetRef> {
  const record = await createBinaryAssetRecord(bytes, metadata);
  return repository.put(record);
}

/** Converts a legacy inline payload at an import boundary into a managed binary reference. */
export async function storePaperBinaryAsset(
  repository: PaperAssetRepository,
  bytes: Uint8Array,
  metadata: { mimeType: string; fileName?: string },
): Promise<BinaryAssetRef> {
  return storePayload(repository, bytes, metadata);
}

export async function storePaperDataUrlAsset(
  repository: PaperAssetRepository,
  dataUrl: string,
  fileName?: string,
): Promise<BinaryAssetRef> {
  const payload = parseDataUrl(dataUrl);
  if (!payload) {
    throw new Error('Paper asset import requires a data URL.');
  }
  return storePaperBinaryAsset(repository, payload.bytes, { mimeType: payload.mimeType, fileName });
}

export function collectReachablePaperAssetIds(document: PaperDocument): BinaryAssetId[] {
  return collectReachablePaperAssetRefs(document).map((ref) => ref.id);
}

/**
 * Exact managed records reachable from one Paper document. Sync and packaging need the complete
 * reference, not only the digest id, so a receiver can reject metadata substitution before bytes
 * become usable. A single digest with conflicting metadata is invalid authored state.
 */
export function collectReachablePaperAssetRefs(document: PaperDocument): BinaryAssetRef[] {
  const managed = document as unknown as PaperDocumentWithManagedAssets;
  const refs = new Map<BinaryAssetId, BinaryAssetRef>();

  const add = (ref: BinaryAssetRef): void => {
    const existing = refs.get(ref.id);
    if (existing && (
      existing.sha256 !== ref.sha256
      || existing.mimeType !== ref.mimeType
      || existing.byteLength !== ref.byteLength
    )) {
      throw new Error(`Paper asset ${ref.id} has conflicting managed metadata.`);
    }
    if (!existing) refs.set(ref.id, { ...ref });
  };

  for (const page of [...(managed.pages ?? []), ...(managed.parentPages ?? [])]) {
    for (const frame of page.frames ?? []) {
      const locator = frame.asset?.locator;
      if (locator?.kind === 'managed' && isBinaryAssetRef(locator.ref)) {
        add(locator.ref);
      }
    }
  }

  for (const font of managed.importedFonts ?? []) {
    if (isBinaryAssetRef(font.fontAsset)) add(font.fontAsset);
    if (isBinaryAssetRef(font.license?.textAsset)) add(font.license.textAsset);
  }

  for (const profile of managed.managedIccProfiles ?? []) {
    if (isPaperManagedIccProfile(profile)) add(profile.asset);
  }

  return [...refs.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function migrateLegacyPaperBinaryFields(
  document: PaperDocument,
  repository: PaperAssetRepository,
  options: MigrateLegacyPaperBinaryOptions = {},
): Promise<PaperDocument> {
  const migrated = cloneDocument(document);

  for (const page of [...(migrated.pages ?? []), ...(migrated.parentPages ?? [])]) {
    for (const frame of page.frames ?? []) {
      const asset = frame.asset as LegacyPaperFrameAsset | undefined;
      if (!asset) continue;
      if (asset.locator?.kind === 'managed') {
        delete asset.src;
        continue;
      }

      const source = asset.src as unknown;
      let payload: LegacySlpprAssetPayload | undefined;
      if (typeof source === 'string') {
        payload = parseDataUrl(source);
      } else if (isLegacySlpprAssetRef(source)) {
        const legacy = options.legacySlpprAssets?.get(source.$slpprAsset);
        if (!legacy) {
          throw new Error(`Paper document is missing legacy asset ${source.$slpprAsset}.`);
        }
        payload = {
          bytes: new Uint8Array(legacy.bytes),
          mimeType: legacy.mimeType ?? source.mime,
        };
      }

      if (!payload) {
        delete asset.src;
        if (typeof source === 'string' && source.trim()) {
          if (/^blob:/i.test(source)) {
            throw new Error(`Paper asset ${asset.label || '<unknown>'} uses an expired legacy object URL.`);
          }
          asset.locator = { kind: 'external', url: source };
        } else if (source !== undefined) {
          throw new Error(`Paper asset ${asset.label || '<unknown>'} has an unsupported legacy source.`);
        }
        continue;
      }
      const ref = await storePayload(repository, payload.bytes, {
        mimeType: payload.mimeType ?? asset.mimeType ?? 'application/octet-stream',
      });
      delete asset.src;
      asset.locator = { kind: 'managed', ref };
      asset.mimeType = asset.mimeType ?? ref.mimeType;
    }
  }

  if (Array.isArray(migrated.importedFonts)) {
    migrated.importedFonts = await Promise.all(migrated.importedFonts.map(async (font) => {
      const candidate = font as unknown as LegacyPaperImportedFont;
      if (isBinaryAssetRef(candidate.fontAsset)) {
        return normalizeManagedFontFace(candidate, candidate.fontAsset, repository);
      }
      if (isBinaryAssetRef(candidate.assetRef)) {
        return normalizeManagedFontFace(candidate, candidate.assetRef, repository);
      }
      const dataBase64 = candidate.dataBase64;
      if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
        throw new Error(`Paper imported font ${candidate.id || '<unknown>'} has no managed bytes.`);
      }
      const ref = await storePayload(repository, decodeBase64(dataBase64), {
        mimeType: fontMimeType(hasManagedFontFormat(candidate.format) ? candidate.format : 'truetype'),
        fileName: `${candidate.id || 'font'}.${fontExtension(hasManagedFontFormat(candidate.format) ? candidate.format : 'truetype')}`,
      });
      return normalizeManagedFontFace(candidate, ref, repository);
    }));
  }

  return migrated as unknown as PaperDocument;
}
