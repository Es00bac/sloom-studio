import {
  createBinaryAssetRecord,
  isBinaryAssetRef,
  verifyBinaryAssetRecord,
  type BinaryAssetId,
  type BinaryAssetRecord,
  type BinaryAssetRef,
} from '../shared/assets/contentAddressedAsset';
import type { PaperManagedIccProfile } from '../types/paper';
import { describeIccProfile, validateCmykOutputProfileTransform } from './paperIccEngine';
import { resolveBundledAssetUrl } from './bundledAssetUrl';
import { findBundledProfile } from './paperIccProfiles';

const ICC_HEADER_BYTES = 128;
export const MAX_PAPER_ICC_PROFILE_BYTES = 512 * 1024 * 1024;

export interface ParsedPaperCmykOutputProfile {
  description: string;
  deviceClass: 'prtr';
  colorSpace: 'CMYK';
  pcs: 'Lab ' | 'XYZ ';
  declaredByteLength: number;
}

export interface PaperManagedIccProfileRegistry {
  profiles: readonly PaperManagedIccProfile[];
  getAsset: (id: BinaryAssetId) => Promise<BinaryAssetRecord | undefined>;
}

export type PaperOutputProfileResolution =
  | { status: 'ready'; profile: PaperManagedIccProfile; bytes: Uint8Array }
  | { status: 'missing'; profileId: string }
  | { status: 'invalid'; profileId: string; reason: string };

export interface CreatePaperManagedIccProfileOptions {
  outputConditionId: string;
  registryName?: string;
  source: PaperManagedIccProfile['source'];
}

export interface PaperIccImportFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Minimal asset-write contract so ICC import remains independent of the renderer repository class. */
export interface PaperManagedIccAssetStore {
  put(record: BinaryAssetRecord): Promise<BinaryAssetRef>;
}

export type PaperBundledIccBytesLoader = (url: string) => Promise<Uint8Array>;

export interface InstalledBundledPaperManagedIccProfile {
  profile: PaperManagedIccProfile;
  outputConditionId: string;
}

function iccTag(bytes: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > bytes.byteLength) return '';
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function sameAssetRef(left: BinaryAssetRef, right: BinaryAssetRef): boolean {
  return left.id === right.id
    && left.sha256 === right.sha256
    && left.byteLength === right.byteLength
    && left.mimeType === right.mimeType;
}

function nonEmptyString(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

export function isPaperManagedIccProfile(value: unknown): value is PaperManagedIccProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!isBinaryAssetRef(candidate.asset) || candidate.id !== candidate.asset.id) return false;
  if (
    !nonEmptyString(candidate.description)
    || candidate.deviceClass !== 'prtr'
    || candidate.colorSpace !== 'CMYK'
    || (candidate.pcs !== 'Lab ' && candidate.pcs !== 'XYZ ')
    || !nonEmptyString(candidate.outputConditionId)
  ) return false;
  if (candidate.registryName !== undefined && !nonEmptyString(candidate.registryName, 1_024)) return false;
  if (typeof candidate.source !== 'object' || candidate.source === null || Array.isArray(candidate.source)) return false;
  const source = candidate.source as Record<string, unknown>;
  if (source.kind !== 'bundled' && source.kind !== 'downloaded' && source.kind !== 'user-import') return false;
  return (source.url === undefined || (nonEmptyString(source.url, 4_096) && !/^(?:data:|blob:)/i.test(source.url)))
    && (source.licenseId === undefined || nonEmptyString(source.licenseId, 256));
}

/** Parses the ICC header, then asks lcms to open a disposable real CMYK transform. */
export async function parseAndValidateCmykOutputProfile(bytes: Uint8Array): Promise<ParsedPaperCmykOutputProfile> {
  if (bytes.byteLength < ICC_HEADER_BYTES) throw new Error('The ICC profile header is incomplete.');
  if (bytes.byteLength > MAX_PAPER_ICC_PROFILE_BYTES) throw new Error('The ICC profile exceeds the Paper import limit.');

  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredByteLength = header.getUint32(0, false);
  if (declaredByteLength < ICC_HEADER_BYTES || declaredByteLength > bytes.byteLength) {
    throw new Error('The ICC profile declares an invalid size.');
  }
  if (iccTag(bytes, 36) !== 'acsp') throw new Error('The file is not an ICC profile (missing acsp signature).');
  const deviceClass = iccTag(bytes, 12);
  if (deviceClass !== 'prtr') throw new Error(`PDF/X CMYK output requires a printer ICC profile, not "${deviceClass || 'unknown'}".`);
  const colorSpace = iccTag(bytes, 16);
  if (colorSpace !== 'CMYK') throw new Error(`PDF/X CMYK output requires a CMYK output profile, not "${colorSpace || 'unknown'}".`);
  const pcs = iccTag(bytes, 20);
  if (pcs !== 'Lab ' && pcs !== 'XYZ ') throw new Error(`PDF/X CMYK output requires a Lab or XYZ PCS, not "${pcs || 'unknown'}".`);

  const info = await describeIccProfile(bytes);
  if (info.colorSpace !== 'CMYK') throw new Error(`PDF/X CMYK output requires a CMYK output profile, not "${info.colorSpace || 'unknown'}".`);
  await validateCmykOutputProfileTransform(bytes);

  return {
    description: info.name,
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs,
    declaredByteLength,
  };
}

export function createPaperManagedIccProfile(
  asset: BinaryAssetRef,
  parsed: ParsedPaperCmykOutputProfile,
  options: CreatePaperManagedIccProfileOptions,
): PaperManagedIccProfile {
  const outputConditionId = options.outputConditionId.trim();
  if (!outputConditionId) throw new Error('An output condition identifier is required for a managed ICC profile.');
  return {
    id: asset.id,
    asset: { ...asset },
    description: parsed.description,
    deviceClass: parsed.deviceClass,
    colorSpace: parsed.colorSpace,
    pcs: parsed.pcs,
    outputConditionId,
    ...(options.registryName?.trim() ? { registryName: options.registryName.trim() } : {}),
    source: { ...options.source },
  };
}

function isIccFileName(name: string): boolean {
  return /\.(?:icc|icm)$/i.test(name.trim());
}

function profileMimeType(file: Pick<PaperIccImportFile, 'type'>): string {
  return file.type.trim() || 'application/vnd.iccprofile';
}

/** Imports a CMYK printer profile without ever serializing its bytes into document JSON. */
export async function importPaperManagedIccProfile(
  file: PaperIccImportFile,
  options: Pick<CreatePaperManagedIccProfileOptions, 'outputConditionId' | 'registryName'>,
  store: PaperManagedIccAssetStore,
): Promise<PaperManagedIccProfile> {
  const outputConditionId = options.outputConditionId.trim();
  if (!outputConditionId) throw new Error('An output condition identifier is required before importing an ICC profile.');
  if (!isIccFileName(file.name)) throw new Error('Choose an .icc or .icm CMYK output profile.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = await parseAndValidateCmykOutputProfile(bytes);
  const record = await createBinaryAssetRecord(bytes, {
    mimeType: profileMimeType(file),
    fileName: file.name,
  });
  const asset = await store.put(record);
  return createPaperManagedIccProfile(asset, parsed, {
    outputConditionId,
    registryName: options.registryName,
    source: { kind: 'user-import' },
  });
}

async function fetchBundledIccBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Bundled ICC profile could not be loaded (HTTP ${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Explicitly installs one shipped profile as the document's exact content-addressed managed asset. */
export async function installBundledPaperManagedIccProfile(
  profileId: string,
  store: PaperManagedIccAssetStore,
  load: PaperBundledIccBytesLoader = fetchBundledIccBytes,
): Promise<InstalledBundledPaperManagedIccProfile> {
  const bundled = findBundledProfile(profileId);
  if (!bundled?.url || !bundled.outputConditionId) {
    throw new Error('The selected bundled CMYK profile is unavailable.');
  }
  const resolvedUrl = resolveBundledAssetUrl(bundled.url);
  const bytes = await load(resolvedUrl);
  const parsed = await parseAndValidateCmykOutputProfile(bytes);
  const fileName = bundled.url.split('/').filter(Boolean).at(-1) ?? `${bundled.id}.icc`;
  const record = await createBinaryAssetRecord(bytes, {
    mimeType: 'application/vnd.iccprofile',
    fileName,
  });
  const asset = await store.put(record);
  return {
    outputConditionId: bundled.outputConditionId,
    profile: createPaperManagedIccProfile(asset, parsed, {
      outputConditionId: bundled.outputConditionId,
      registryName: bundled.registryName,
      source: {
        kind: 'bundled',
        url: bundled.url,
        licenseId: bundled.licenseId ?? 'LicenseRef-NoKnownCopyrightRestrictions',
      },
    }),
  };
}

/**
 * Resolves the profile the document explicitly selected. It deliberately has no default and never maps
 * an output-condition label to a different ICC file: missing and invalid records remain export blockers.
 */
export async function resolveExactPaperOutputProfile(
  registry: PaperManagedIccProfileRegistry,
  profileId: string | undefined,
): Promise<PaperOutputProfileResolution> {
  const requestedId = profileId ?? '';
  const profile = registry.profiles.find((candidate) => candidate.id === requestedId);
  if (!profile) return { status: 'missing', profileId: requestedId };
  if (!isPaperManagedIccProfile(profile)) {
    return { status: 'invalid', profileId: requestedId, reason: 'The document profile record is malformed.' };
  }

  const record = await registry.getAsset(profile.asset.id);
  if (!record) return { status: 'missing', profileId: requestedId };
  if (!sameAssetRef(record.ref, profile.asset)) {
    return { status: 'invalid', profileId: requestedId, reason: 'The stored profile does not match its document asset reference.' };
  }
  if (!(await verifyBinaryAssetRecord(record))) {
    return { status: 'invalid', profileId: requestedId, reason: 'The stored profile bytes do not match their content hash.' };
  }

  try {
    const parsed = await parseAndValidateCmykOutputProfile(record.bytes);
    if (
      parsed.deviceClass !== profile.deviceClass
      || parsed.colorSpace !== profile.colorSpace
      || parsed.pcs !== profile.pcs
    ) {
      return { status: 'invalid', profileId: requestedId, reason: 'The stored profile header no longer matches its document record.' };
    }
    return { status: 'ready', profile, bytes: new Uint8Array(record.bytes) };
  } catch (error) {
    return {
      status: 'invalid',
      profileId: requestedId,
      reason: error instanceof Error ? error.message : 'The stored profile could not be validated.',
    };
  }
}

export type { PaperManagedIccProfile } from '../types/paper';
