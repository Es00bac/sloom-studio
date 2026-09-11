import {
  createBinaryAssetRecord,
  isBinaryAssetRef,
  verifyBinaryAssetRecord,
  type BinaryAssetId,
  type BinaryAssetRecord,
  type BinaryAssetRef,
} from '../../../shared/assets/contentAddressedAsset';
import type { PaperDocument, PaperManagedFontFace } from '../../../types/paper';
import type { PaperAssetRepository } from './PaperAssetRepository';
import { collectReachablePaperAssetIds } from './PaperDocumentAssets';
import { classifyPaperFontPackaging } from '../../../lib/paperManagedFonts';
import { isPaperManagedIccProfile } from '../../../lib/paperManagedIccProfiles';

/**
 * Portable Paper asset contract (AUD-004). A portable `.sloom` is documented as self-contained,
 * but Paper's managed bytes (placed images, exact font faces, license texts, ICC profiles) live
 * in profile-local storage. This module is the single validated content-addressed section that
 * carries those bytes inside project JSON, and the shared enumeration/policy core the print
 * package reuses — the same record model `.slppr` v2 already proves out.
 */

export const PAPER_PORTABLE_ASSETS_SCHEMA = 'signal-loom/paper-portable-assets';
export const PAPER_PORTABLE_ASSETS_VERSION = 1;

export interface PaperPortableAssetLimits {
  maxEntries: number;
  maxAssetBytes: number;
  maxTotalBytes: number;
}

/**
 * JSON sections ride inside the project document, so the ceilings sit well below the binary
 * `.slppr` container limits: base64 inflates by 4/3 and V8 caps a single string near 512 MiB.
 */
export const PAPER_PORTABLE_ASSET_LIMITS: PaperPortableAssetLimits = {
  maxEntries: 4_096,
  maxAssetBytes: 128 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

export type PaperPortableAssetRole = 'image' | 'document' | 'font' | 'font-license' | 'icc-profile';

export interface PaperPortableAssetEntry {
  ref: BinaryAssetRef;
  dataBase64: string;
}

export interface PaperPortableFontExclusion {
  faceId: string;
  familyName: string;
  postscriptName: string;
  assetId: BinaryAssetId;
  reason: string;
  detail: string;
}

export interface PaperPortableMissingAsset {
  id: BinaryAssetId;
  context: string;
}

export interface PaperPortableAssetsSection {
  schema: typeof PAPER_PORTABLE_ASSETS_SCHEMA;
  version: typeof PAPER_PORTABLE_ASSETS_VERSION;
  assets: PaperPortableAssetEntry[];
  /** Faces whose rights forbid packaging — recorded explicitly, never silently dropped. */
  excludedFonts?: PaperPortableFontExclusion[];
  /** Reachable records the repository could not supply at save time. */
  missingAssets?: PaperPortableMissingAsset[];
}

export class PaperPortableAssetsError extends Error {
  constructor(message: string) {
    super(`Portable Paper assets: ${message}`);
    this.name = 'PaperPortableAssetsError';
  }
}

/** Fail-closed policy failure for strict flows (portable export, print package). */
export class PaperAssetPolicyError extends Error {
  readonly exclusions: readonly PaperPortableFontExclusion[];
  readonly missing: readonly PaperPortableMissingAsset[];

  constructor(exclusions: readonly PaperPortableFontExclusion[], missing: readonly PaperPortableMissingAsset[]) {
    const lines: string[] = [];
    for (const exclusion of exclusions) {
      lines.push(`Font "${exclusion.familyName}" (${exclusion.postscriptName}): ${exclusion.detail}`);
    }
    for (const entry of missing) {
      lines.push(`Missing managed record ${entry.id} (${entry.context}). Re-import the source file, then export again.`);
    }
    super(`This export cannot be completed as a self-contained package:\n${lines.join('\n')}`);
    this.name = 'PaperAssetPolicyError';
    this.exclusions = [...exclusions];
    this.missing = [...missing];
  }
}

export interface PaperPortableAssetSource {
  ref?: BinaryAssetRef;
  id: BinaryAssetId;
  role: PaperPortableAssetRole;
  label: string;
  documentTitle: string;
}

export interface PaperPortableAssetPlan {
  /** Deduplicated reachable ids across every supplied document, sorted for determinism. */
  sources: PaperPortableAssetSource[];
  exclusions: PaperPortableFontExclusion[];
  /** Ids excluded by font policy (font bytes plus license texts used only by excluded faces). */
  excludedAssetIds: Set<BinaryAssetId>;
  /** License-text ids that MUST accompany their permitted faces for redistribution. */
  requiredLicenseAssetIds: Set<BinaryAssetId>;
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function encodePaperAssetBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(''));
}

export function decodePaperAssetBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !BASE64_PATTERN.test(text)) {
    throw new PaperPortableAssetsError('an asset payload is not canonical base64.');
  }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** File names are metadata only, but they must never be able to escape an extraction directory. */
export function assertSafePortableAssetFileName(fileName: string | undefined, id: string): void {
  if (fileName === undefined) return;
  const segments = fileName.split('/');
  if (
    fileName.length === 0
    || fileName.length > 256
    || fileName.includes('\0')
    || fileName.includes('\\')
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new PaperPortableAssetsError(`asset ${id} declares an unsafe file name ("${fileName}"); traversal segments are rejected.`);
  }
}

function resolveLimits(overrides?: Partial<PaperPortableAssetLimits>): PaperPortableAssetLimits {
  return { ...PAPER_PORTABLE_ASSET_LIMITS, ...overrides };
}

function sanitizeFontExclusion(value: unknown): PaperPortableFontExclusion | undefined {
  if (!isRecord(value)) return undefined;
  const { faceId, familyName, postscriptName, assetId, reason, detail } = value;
  if (
    typeof faceId !== 'string'
    || typeof familyName !== 'string'
    || typeof postscriptName !== 'string'
    || typeof assetId !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(assetId)
    || typeof reason !== 'string' || !reason
    || typeof detail !== 'string'
  ) return undefined;
  return { faceId, familyName, postscriptName, assetId: assetId as BinaryAssetId, reason, detail };
}

function sanitizeMissingAsset(value: unknown): PaperPortableMissingAsset | undefined {
  if (!isRecord(value)) return undefined;
  const { id, context } = value;
  if (typeof id !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(id) || typeof context !== 'string') return undefined;
  return { id: id as BinaryAssetId, context };
}

/**
 * Validates section structure, identity metadata, and declared sizes WITHOUT decoding payloads,
 * so oversized or malformed sections are rejected before any expensive work. Byte-level digest
 * verification happens in {@link importPaperPortableAssetsSection}.
 */
export function validatePaperPortableAssetsSectionShape(
  value: unknown,
  limitOverrides?: Partial<PaperPortableAssetLimits>,
): PaperPortableAssetsSection {
  const limits = resolveLimits(limitOverrides);
  if (!isRecord(value)) {
    throw new PaperPortableAssetsError('the section must be a JSON object.');
  }
  if (value.schema !== PAPER_PORTABLE_ASSETS_SCHEMA) {
    throw new PaperPortableAssetsError('the section declares an unknown schema.');
  }
  if (value.version !== PAPER_PORTABLE_ASSETS_VERSION) {
    throw new PaperPortableAssetsError(`unsupported section version ${String(value.version)}.`);
  }
  if (!Array.isArray(value.assets)) {
    throw new PaperPortableAssetsError('the section asset list is malformed.');
  }
  if (value.assets.length > limits.maxEntries) {
    throw new PaperPortableAssetsError(`the section exceeds the entries limit (${value.assets.length} > ${limits.maxEntries}).`);
  }

  const seen = new Set<BinaryAssetId>();
  let declaredTotal = 0;
  const assets: PaperPortableAssetEntry[] = value.assets.map((entry, index) => {
    if (!isRecord(entry) || !isBinaryAssetRef(entry.ref) || typeof entry.dataBase64 !== 'string') {
      throw new PaperPortableAssetsError(`asset entry ${index + 1} is malformed.`);
    }
    const ref = entry.ref;
    assertSafePortableAssetFileName(ref.fileName, ref.id);
    if (ref.byteLength > limits.maxAssetBytes) {
      throw new PaperPortableAssetsError(`asset ${ref.id} exceeds the per-asset limit (${ref.byteLength} > ${limits.maxAssetBytes}).`);
    }
    const maxEncodedLength = 4 * Math.ceil(ref.byteLength / 3);
    if (!Number.isSafeInteger(maxEncodedLength) || entry.dataBase64.length > maxEncodedLength) {
      throw new PaperPortableAssetsError(
        `asset ${ref.id} encoded payload exceeds the length permitted by its declared byte length `
        + `(${entry.dataBase64.length} > ${maxEncodedLength}).`,
      );
    }
    if (!BASE64_PATTERN.test(entry.dataBase64) || entry.dataBase64.length % 4 !== 0) {
      throw new PaperPortableAssetsError(`asset ${ref.id} payload is not canonical base64.`);
    }
    if (seen.has(ref.id)) {
      throw new PaperPortableAssetsError(`duplicate asset entry ${ref.id}.`);
    }
    seen.add(ref.id);
    declaredTotal += ref.byteLength;
    if (!Number.isSafeInteger(declaredTotal) || declaredTotal > limits.maxTotalBytes) {
      throw new PaperPortableAssetsError(`the section exceeds the total size limit (${declaredTotal} > ${limits.maxTotalBytes}).`);
    }
    return { ref: { ...ref }, dataBase64: entry.dataBase64 };
  });

  const excludedFonts = Array.isArray(value.excludedFonts)
    ? value.excludedFonts.map(sanitizeFontExclusion).filter((entry): entry is PaperPortableFontExclusion => Boolean(entry))
    : undefined;
  const missingAssets = Array.isArray(value.missingAssets)
    ? value.missingAssets.map(sanitizeMissingAsset).filter((entry): entry is PaperPortableMissingAsset => Boolean(entry))
    : undefined;

  return {
    schema: PAPER_PORTABLE_ASSETS_SCHEMA,
    version: PAPER_PORTABLE_ASSETS_VERSION,
    assets,
    ...(excludedFonts && excludedFonts.length > 0 ? { excludedFonts } : {}),
    ...(missingAssets && missingAssets.length > 0 ? { missingAssets } : {}),
  };
}

/** Project sanitize passthrough: absent stays absent; a present-but-corrupt section fails closed. */
export function sanitizePaperPortableAssetsSection(value: unknown): PaperPortableAssetsSection | undefined {
  if (value === undefined || value === null) return undefined;
  return validatePaperPortableAssetsSectionShape(value);
}

function faceExclusion(face: PaperManagedFontFace, reason: string, detail: string): PaperPortableFontExclusion {
  return {
    faceId: face.id,
    familyName: face.familyName,
    postscriptName: face.postscriptName,
    assetId: face.fontAsset.id,
    reason,
    detail,
  };
}

/**
 * Enumerates only assets actually reachable from the supplied Paper documents, assigns each a
 * role/label for diagnostics and package naming, and applies the per-face font packaging policy.
 * A font byte record is excluded when ANY face carried by those bytes is disallowed; license
 * texts used only by excluded faces are excluded with them.
 */
export function planPaperPortableAssets(documents: readonly PaperDocument[]): PaperPortableAssetPlan {
  const sourcesById = new Map<BinaryAssetId, PaperPortableAssetSource>();
  const exclusions: PaperPortableFontExclusion[] = [];
  const seenFaceIds = new Set<string>();
  const disallowedFontAssetIds = new Set<BinaryAssetId>();
  const allowedLicenseAssetIds = new Set<BinaryAssetId>();
  const excludedLicenseCandidateIds = new Set<BinaryAssetId>();
  const requiredLicenseAssetIds = new Set<BinaryAssetId>();

  const rememberSource = (source: PaperPortableAssetSource) => {
    if (!sourcesById.has(source.id)) sourcesById.set(source.id, source);
  };

  for (const document of documents) {
    for (const page of [...(document.pages ?? []), ...(document.parentPages ?? [])]) {
      for (const frame of page.frames ?? []) {
        const locator = frame.asset?.locator;
        if (locator?.kind !== 'managed' || !isBinaryAssetRef(locator.ref)) continue;
        rememberSource({
          ref: locator.ref,
          id: locator.ref.id,
          role: frame.kind === 'document' ? 'document' : 'image',
          label: frame.asset?.label || frame.label || 'Placed asset',
          documentTitle: document.title,
        });
      }
    }

    for (const face of document.importedFonts ?? []) {
      if (!isBinaryAssetRef(face.fontAsset)) continue;
      rememberSource({
        ref: face.fontAsset,
        id: face.fontAsset.id,
        role: 'font',
        label: face.postscriptName || face.familyName || face.id,
        documentTitle: document.title,
      });
      const licenseRef = face.license?.textAsset;
      if (isBinaryAssetRef(licenseRef)) {
        rememberSource({
          ref: licenseRef,
          id: licenseRef.id,
          role: 'font-license',
          label: face.license.id ? `${face.license.id}` : `${face.postscriptName || face.familyName} license`,
          documentTitle: document.title,
        });
      }

      const verdict = classifyPaperFontPackaging(face);
      if (!verdict.allowed) {
        disallowedFontAssetIds.add(face.fontAsset.id);
        if (isBinaryAssetRef(licenseRef)) excludedLicenseCandidateIds.add(licenseRef.id);
        if (!seenFaceIds.has(face.id)) {
          seenFaceIds.add(face.id);
          exclusions.push(faceExclusion(face, verdict.reason, verdict.detail));
        }
        continue;
      }
      if (isBinaryAssetRef(licenseRef)) {
        allowedLicenseAssetIds.add(licenseRef.id);
        if (verdict.licenseTextRequired) requiredLicenseAssetIds.add(licenseRef.id);
      }
    }

    for (const profile of document.managedIccProfiles ?? []) {
      if (!isPaperManagedIccProfile(profile)) continue;
      rememberSource({
        ref: profile.asset,
        id: profile.asset.id,
        role: 'icc-profile',
        label: profile.description,
        documentTitle: document.title,
      });
    }
  }

  const excludedAssetIds = new Set<BinaryAssetId>(disallowedFontAssetIds);
  for (const licenseId of excludedLicenseCandidateIds) {
    if (!allowedLicenseAssetIds.has(licenseId)) excludedAssetIds.add(licenseId);
  }

  // collectReachablePaperAssetIds stays the single source of truth for reachability; the walk
  // above only adds roles/labels. Anything reachable but unlabeled still travels (as 'image').
  for (const document of documents) {
    for (const id of collectReachablePaperAssetIds(document)) {
      rememberSource({ id, role: 'image', label: id, documentTitle: document.title });
    }
  }

  const sources = [...sourcesById.values()]
    .filter((source) => !excludedAssetIds.has(source.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  return { sources, exclusions, excludedAssetIds, requiredLicenseAssetIds };
}

export interface VerifiedPaperAssetRecord {
  record: BinaryAssetRecord;
  source: PaperPortableAssetSource;
}

export interface CollectVerifiedPaperAssetsResult {
  records: VerifiedPaperAssetRecord[];
  plan: PaperPortableAssetPlan;
  missing: PaperPortableMissingAsset[];
}

/**
 * Shared verified-record collection for the portable project section and the print package.
 * Every returned record has been digest-verified against its document reference; a repository
 * record that fails verification is a hard error in every mode — corrupt bytes must never be
 * serialized as if they were the referenced content.
 */
export async function collectVerifiedPaperAssetRecords(
  documents: readonly PaperDocument[],
  repository: PaperAssetRepository,
  options: { strict?: boolean; limits?: Partial<PaperPortableAssetLimits> } = {},
): Promise<CollectVerifiedPaperAssetsResult> {
  const limits = resolveLimits(options.limits);
  const plan = planPaperPortableAssets(documents);
  const records: VerifiedPaperAssetRecord[] = [];
  const missing: PaperPortableMissingAsset[] = [];

  for (const source of plan.sources) {
    const record = await repository.get(source.id);
    if (!record) {
      missing.push({ id: source.id, context: `${source.role} "${source.label}" in document "${source.documentTitle}"` });
      continue;
    }
    if (record.ref.id !== source.id || !(await verifyBinaryAssetRecord(record))) {
      throw new PaperPortableAssetsError(
        `repository record ${source.id} (${source.role} "${source.label}") failed digest verification; re-import the source file before exporting.`,
      );
    }
    if (source.ref && (
      source.ref.id !== record.ref.id
      || source.ref.sha256 !== record.ref.sha256
      || source.ref.byteLength !== record.ref.byteLength
      || source.ref.mimeType !== record.ref.mimeType
      || source.ref.fileName !== record.ref.fileName
    )) {
      throw new PaperPortableAssetsError(
        `repository record ${source.id} does not match the document reference for ${source.role} "${source.label}".`,
      );
    }
    records.push({ record, source });
  }

  for (const licenseId of plan.requiredLicenseAssetIds) {
    if (!records.some((entry) => entry.record.ref.id === licenseId) && !missing.some((entry) => entry.id === licenseId)) {
      missing.push({ id: licenseId, context: 'required font license text' });
    }
  }

  if (records.length > limits.maxEntries) {
    throw new PaperPortableAssetsError(`the export exceeds the entries limit (${records.length} > ${limits.maxEntries}).`);
  }
  let totalBytes = 0;
  for (const { record, source } of records) {
    if (record.bytes.byteLength > limits.maxAssetBytes) {
      throw new PaperPortableAssetsError(
        `${source.role} "${source.label}" exceeds the per-asset limit (${record.bytes.byteLength} > ${limits.maxAssetBytes} bytes).`,
      );
    }
    totalBytes += record.bytes.byteLength;
    if (totalBytes > limits.maxTotalBytes) {
      throw new PaperPortableAssetsError(
        `the export exceeds the total embedded-asset limit (${totalBytes} > ${limits.maxTotalBytes} bytes).`,
      );
    }
  }

  if (options.strict && (plan.exclusions.length > 0 || missing.length > 0)) {
    throw new PaperAssetPolicyError(plan.exclusions, missing);
  }

  return { records, plan, missing };
}

export interface BuildPaperPortableAssetsResult {
  section?: PaperPortableAssetsSection;
  exclusions: PaperPortableFontExclusion[];
  missing: PaperPortableMissingAsset[];
}

/**
 * Builds the portable `.sloom` section. In strict mode (explicit portable export) any policy
 * exclusion or missing record fails closed; in save mode exclusions/missing are recorded
 * explicitly in the section so a clean-profile open can report exactly what is absent and why.
 */
export async function buildPaperPortableAssetsSection(
  documents: readonly PaperDocument[],
  repository: PaperAssetRepository,
  options: { strict?: boolean; limits?: Partial<PaperPortableAssetLimits> } = {},
): Promise<BuildPaperPortableAssetsResult> {
  const { records, plan, missing } = await collectVerifiedPaperAssetRecords(documents, repository, options);
  if (records.length === 0 && plan.exclusions.length === 0 && missing.length === 0) {
    return { exclusions: [], missing: [] };
  }
  const assets = records.map(({ record }) => ({
    ref: { ...record.ref },
    dataBase64: encodePaperAssetBase64(record.bytes),
  }));
  return {
    section: {
      schema: PAPER_PORTABLE_ASSETS_SCHEMA,
      version: PAPER_PORTABLE_ASSETS_VERSION,
      assets,
      ...(plan.exclusions.length > 0 ? { excludedFonts: plan.exclusions } : {}),
      ...(missing.length > 0 ? { missingAssets: missing } : {}),
    },
    exclusions: plan.exclusions,
    missing,
  };
}

interface StagedAssetJournalEntry {
  id: BinaryAssetId;
  previous?: BinaryAssetRecord;
}

export interface PaperPortableAssetsImportResult {
  importedIds: BinaryAssetId[];
  repairedIds: BinaryAssetId[];
  skippedExistingIds: BinaryAssetId[];
  /** Restores the repository to its pre-import state. Safe to call at most once. */
  rollback: () => Promise<void>;
}

function sameRef(left: BinaryAssetRef, right: BinaryAssetRef): boolean {
  return left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength
    && left.fileName === right.fileName;
}

/**
 * Validates every entry's metadata AND bytes before any repository mutation, then stages the
 * records transactionally. Existing records with the same id are kept when they verify; records
 * whose stored bytes no longer match their digest are repaired from the verified incoming copy.
 * Any failure rolls the repository back to its pre-import state.
 */
export async function importPaperPortableAssetsSection(
  sectionInput: unknown,
  repository: PaperAssetRepository,
  limitOverrides?: Partial<PaperPortableAssetLimits>,
): Promise<PaperPortableAssetsImportResult> {
  const section = validatePaperPortableAssetsSectionShape(sectionInput, limitOverrides);

  // Phase 1: decode + digest-verify EVERYTHING before the first repository write.
  const verified: BinaryAssetRecord[] = [];
  for (const entry of section.assets) {
    const bytes = (() => {
      try {
        return decodePaperAssetBase64(entry.dataBase64);
      } catch (error) {
        throw error instanceof PaperPortableAssetsError
          ? new PaperPortableAssetsError(`asset ${entry.ref.id} payload is corrupt: ${error.message}`)
          : error;
      }
    })();
    if (bytes.byteLength !== entry.ref.byteLength) {
      throw new PaperPortableAssetsError(
        `asset ${entry.ref.id} is truncated or padded: decoded length ${bytes.byteLength} does not match the declared length ${entry.ref.byteLength}.`,
      );
    }
    const rebuilt = await createBinaryAssetRecord(bytes, {
      mimeType: entry.ref.mimeType,
      ...(entry.ref.fileName ? { fileName: entry.ref.fileName } : {}),
    });
    if (!sameRef(rebuilt.ref, entry.ref)) {
      throw new PaperPortableAssetsError(
        `asset ${entry.ref.id} failed content hash verification; the project file is corrupt.`,
      );
    }
    verified.push(rebuilt);
  }

  // Phase 2: transactional staging with a rollback journal.
  const journal: StagedAssetJournalEntry[] = [];
  const importedIds: BinaryAssetId[] = [];
  const repairedIds: BinaryAssetId[] = [];
  const skippedExistingIds: BinaryAssetId[] = [];
  let rolledBack = false;

  const rollback = async () => {
    if (rolledBack) return;
    rolledBack = true;
    for (const entry of [...journal].reverse()) {
      try {
        if (entry.previous) await repository.put(entry.previous);
        else await repository.delete(entry.id);
      } catch {
        // Rollback is best effort per record; continue restoring the remaining entries.
      }
    }
  };

  try {
    for (const record of verified) {
      const existing = await repository.get(record.ref.id);
      if (existing && sameRef(existing.ref, record.ref) && await verifyBinaryAssetRecord(existing)) {
        skippedExistingIds.push(record.ref.id);
        continue;
      }
      journal.push({ id: record.ref.id, ...(existing ? { previous: existing } : {}) });
      await repository.put(record);
      if (existing) repairedIds.push(record.ref.id);
      else importedIds.push(record.ref.id);
    }
  } catch (error) {
    await rollback();
    throw error;
  }

  return { importedIds, repairedIds, skippedExistingIds, rollback };
}

/**
 * Explicit missing-asset diagnostics for open/import: names every reachable record the repository
 * cannot supply after staging, with the save-time exclusion reason when one was recorded. Legacy
 * `.sloom` files without the section produce these instead of fabricated completeness.
 */
export async function collectMissingPaperAssetDiagnostics(
  documents: readonly PaperDocument[],
  repository: PaperAssetRepository,
  section?: Pick<PaperPortableAssetsSection, 'excludedFonts' | 'missingAssets'>,
): Promise<string[]> {
  const plan = planPaperPortableAssets(documents);
  const exclusionsByAssetId = new Map((section?.excludedFonts ?? []).map((entry) => [entry.assetId, entry]));
  const messages: string[] = [];
  const reported = new Set<BinaryAssetId>();

  const report = async (id: BinaryAssetId, describe: () => string) => {
    if (reported.has(id) || await repository.has(id)) return;
    reported.add(id);
    messages.push(describe());
  };

  for (const source of plan.sources) {
    await report(source.id, () =>
      `Paper ${source.role} "${source.label}" in document "${source.documentTitle}" is not available: `
      + `record ${source.id} was not packaged in this project file. Re-import the source file to restore exact output.`);
  }
  for (const exclusion of plan.exclusions) {
    await report(exclusion.assetId, () =>
      `Paper font "${exclusion.familyName}" (${exclusion.postscriptName}) was not packaged: ${exclusion.detail} `
      + 'Re-import the font on this machine to restore exact output.');
  }
  for (const entry of exclusionsByAssetId.values()) {
    await report(entry.assetId, () =>
      `Paper font "${entry.familyName}" (${entry.postscriptName}) was not packaged: ${entry.detail} `
      + 'Re-import the font on this machine to restore exact output.');
  }
  for (const entry of section?.missingAssets ?? []) {
    await report(entry.id, () =>
      `Paper asset ${entry.id} (${entry.context}) was already missing when this project was saved. `
      + 'Re-import the source file to restore exact output.');
  }

  return messages.sort();
}
