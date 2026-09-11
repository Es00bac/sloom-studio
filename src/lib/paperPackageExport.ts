import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperDocument } from '../types/paper';
import { deflateSync, strToU8, unzipSync, zipSync } from 'fflate';
import { serializePaperDocument } from './paperDocument';
import {
  analyzePaperPreflight,
  collectPaperColorInventory,
  collectPaperFontInventory,
  collectPaperLinkedAssets,
  type PaperPreflightProfileId,
} from './paperPreflight';
import { buildPaperPrintProductionMetadata, type PaperPrintProductionMetadata } from './paperPrintProduction';
import { paperAssetRepository } from '../features/paper/assets/PaperAssetRuntime';
import type { PaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import {
  collectVerifiedPaperAssetRecords,
  type PaperPortableAssetRole,
} from '../features/paper/assets/PaperPortableAssets';
import {
  createBinaryAssetRecord,
  type BinaryAssetRecord,
} from '../shared/assets/contentAddressedAsset';

export type PaperPackagedAssetRole = PaperPortableAssetRole | 'linked-source';

/** One real file included in the package, addressed by digest for printer/validator verification. */
export interface PaperPackagedAssetFile {
  path: string;
  role: PaperPackagedAssetRole;
  label: string;
  sha256: string;
  byteLength: number;
  mimeType: string;
  fileName?: string;
}

/** A linked resource the package could NOT embed — recorded explicitly, never silently dropped. */
export interface PaperPackageUnpackagedLink {
  label: string;
  sourceId?: string;
  frameId?: string;
  reason: string;
}

export interface PaperPackageManifest {
  app: 'Sloom Studio Paper';
  version: 2;
  title: string;
  createdAt: string;
  documentId: string;
  pageCount: number;
  files: Array<{ path: string; type: string; bytes: number }>;
  /** Actual embedded art/font/license/profile files with their digests, sorted by path. */
  packagedAssets: PaperPackagedAssetFile[];
  /** Linked resources that are not embedded, with the reason each one is absent. */
  unpackagedLinks: PaperPackageUnpackagedLink[];
  linkedAssets: ReturnType<typeof collectPaperLinkedAssets>;
  fonts: ReturnType<typeof collectPaperFontInventory>;
  colors: ReturnType<typeof collectPaperColorInventory>;
  production: PaperPrintProductionMetadata;
}

export interface PaperPackageExport {
  fileName: string;
  mimeType: 'application/json' | 'application/zip';
  manifest: PaperPackageManifest;
  blob: Blob;
  json: string;
  fallbackJsonFileName: string;
  entries: string[];
}

export interface PaperPackageExportOptions {
  profileId?: PaperPreflightProfileId;
  repository?: PaperAssetRepository;
  /** Injectable only for platform/integration tests of ZIP failure handling. */
  zip?: (entries: Record<string, Uint8Array>) => Uint8Array;
}

/** A package is never downgraded to a JSON inventory after a ZIP failure. */
export class PaperPackageExportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`Paper print package: ${message}`, options);
    this.name = 'PaperPackageExportError';
  }
}

const FIXED_ENTRY_PATHS = ['document.sloom-paper.json', 'preflight-report.json', 'manifest.json'] as const;
const MAX_PACKAGE_MEMBER_PATH_BYTES = 240;
const MAX_PACKAGE_LABEL_BYTES = 96;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_PACKER_VERSION = 20;
const ZIP_PACKER_BLOCK_BYTES = 7000;
const WINDOWS_RESERVED_PATH_PARTS = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

const PACKAGE_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/icc': 'icc',
  'application/pdf': 'pdf',
  'application/vnd.iccprofile': 'icc',
  'font/otf': 'otf',
  'font/sfnt': 'ttc',
  'font/ttf': 'ttf',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
  'text/plain': 'txt',
};

function packageDirectoryForRole(role: PaperPackagedAssetRole): string {
  if (role === 'font') return 'Fonts';
  if (role === 'font-license') return 'Fonts/Licenses';
  if (role === 'icc-profile') return 'Profiles';
  return 'Links';
}

function extensionForAsset(ref: { mimeType: string; fileName?: string }): string {
  if (ref.fileName) {
    const lastDot = ref.fileName.lastIndexOf('.');
    const candidate = lastDot >= 0 ? ref.fileName.slice(lastDot + 1).toLowerCase() : '';
    if (/^[a-z0-9]{1,16}$/.test(candidate)) return candidate;
  }
  const normalized = ref.mimeType.trim().toLowerCase().split(';', 1)[0];
  const known = PACKAGE_MIME_EXTENSIONS[normalized];
  if (known) return known;
  const subtype = normalized.split('/', 2)[1]?.replace(/^x-/, '').split('+', 1)[0].split('.').at(-1);
  return subtype && /^[a-z0-9]{1,16}$/.test(subtype) ? subtype : 'bin';
}

interface PackagedBinary {
  file: PaperPackagedAssetFile;
  bytes: Uint8Array;
}

interface PackageMemberPathRequest {
  directory: string;
  extension: string;
  stem: string;
  /** Stable identity used only to make collision suffixes deterministic. */
  identity: string;
}

/**
 * Allocates every ZIP member namespace (metadata and bytes alike) before the archive exists.
 * The archive format's filename limit is much larger, but this conservative bound remains safe
 * for common filesystem extractors and makes hostile labels incapable of forcing ZIP fallback.
 */
function allocatePackageMemberPaths(
  requests: readonly PackageMemberPathRequest[],
  reservedPaths: readonly string[] = FIXED_ENTRY_PATHS,
): string[] {
  const allocated = new Set(reservedPaths);
  const portableAllocated = new Set(reservedPaths.map(portablePackagePathKey));
  const results = new Array<string>(requests.length);
  const ordered = requests.map((request, index) => ({ request, index })).sort((left, right) => (
    left.request.identity.localeCompare(right.request.identity)
    || left.request.directory.localeCompare(right.request.directory)
    || left.request.stem.localeCompare(right.request.stem)
    || left.request.extension.localeCompare(right.request.extension)
    || left.index - right.index
  ));

  for (const { request, index } of ordered) {
    let ordinal = 1;
    let path = buildBoundedPackagePath(request, ordinal);
    while (allocated.has(path) || portableAllocated.has(portablePackagePathKey(path))) {
      ordinal += 1;
      path = buildBoundedPackagePath(request, ordinal);
    }
    allocated.add(path);
    portableAllocated.add(portablePackagePathKey(path));
    results[index] = path;
  }

  return results;
}

function buildBoundedPackagePath(request: PackageMemberPathRequest, ordinal: number): string {
  const extension = request.extension.replace(/[^a-z0-9]/gi, '').slice(0, 16) || 'bin';
  const suffix = ordinal === 1 ? '' : `-${ordinal}`;
  const fixedBytes = byteLength(`${request.directory}/.${extension}${suffix}`);
  const maximumStemBytes = MAX_PACKAGE_MEMBER_PATH_BYTES - fixedBytes;
  if (maximumStemBytes < 1) {
    throw new PaperPackageExportError('internal path allocation exceeded the safe archive-path limit.');
  }
  return `${request.directory}/${truncateAscii(safePathPart(request.stem, MAX_PACKAGE_LABEL_BYTES), maximumStemBytes)}${suffix}.${extension}`;
}

function decodeSourceDataUrl(url: string): { bytes: Uint8Array; mimeType?: string } | undefined {
  const match = /^data:([^,]*),(.*)$/is.exec(url);
  if (!match) return undefined;
  const metadata = match[1].trim();
  const mimeType = metadata.split(';', 1)[0]?.trim() || undefined;
  const isBase64 = metadata.split(';').some((part) => part.trim().toLowerCase() === 'base64');
  try {
    if (!isBase64) {
      return { bytes: new TextEncoder().encode(decodeURIComponent(match[2])), mimeType };
    }
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { bytes, mimeType };
  } catch {
    return undefined;
  }
}

async function collectLinkedSourceBinaries(
  document: PaperDocument,
  sourceItems: SourceBinLibraryItem[],
  alreadyPackagedIds: ReadonlySet<string>,
): Promise<{ binaries: Array<{ record: BinaryAssetRecord; label: string }>; unpackaged: PaperPackageUnpackagedLink[] }> {
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const binaries: Array<{ record: BinaryAssetRecord; label: string }> = [];
  const unpackaged: PaperPackageUnpackagedLink[] = [];
  const seenSourceIds = new Set<string>();

  for (const page of document.pages) {
    for (const frame of page.frames) {
      if (!['image', 'document'].includes(frame.kind) || !frame.asset?.sourceBinItemId) continue;
      // Managed locators already travel as verified repository records.
      if (frame.asset.locator?.kind === 'managed') continue;
      const sourceId = frame.asset.sourceBinItemId;
      if (seenSourceIds.has(sourceId)) continue;
      seenSourceIds.add(sourceId);
      const label = frame.asset.label || frame.label || sourceId;
      const item = sourceById.get(sourceId);
      if (!item) {
        unpackaged.push({ label, sourceId, frameId: frame.id, reason: 'The linked Source Library item was not found in this project.' });
        continue;
      }
      const url = item.assetUrl;
      if (!url) {
        unpackaged.push({ label, sourceId, frameId: frame.id, reason: 'The linked Source Library item has no stored bytes or durable URL.' });
        continue;
      }
      if (/^blob:/i.test(url)) {
        unpackaged.push({ label, sourceId, frameId: frame.id, reason: 'The linked bytes exist only behind a runtime object URL; re-export from the device that holds the file.' });
        continue;
      }
      if (!/^data:/i.test(url)) {
        unpackaged.push({ label, sourceId, frameId: frame.id, reason: 'The link points at an external URL that is not embedded; deliver that file alongside this package.' });
        continue;
      }
      const decoded = decodeSourceDataUrl(url);
      if (!decoded || decoded.bytes.byteLength === 0) {
        unpackaged.push({ label, sourceId, frameId: frame.id, reason: 'The stored data URL could not be decoded.' });
        continue;
      }
      const record = await createBinaryAssetRecord(decoded.bytes, {
        mimeType: decoded.mimeType || item.mimeType || 'application/octet-stream',
      });
      if (alreadyPackagedIds.has(record.ref.id) || binaries.some((entry) => entry.record.ref.id === record.ref.id)) continue;
      binaries.push({ record, label });
    }
  }

  return { binaries, unpackaged };
}

/**
 * Builds the "Package for print" deliverable. The ZIP contains the document JSON, preflight
 * report, manifest, per-link metadata, AND the actual bytes a printer needs to reproduce the
 * document: placed art, exact managed font files, their license texts, and ICC output profiles —
 * all digest-verified through the shared portable-asset contract. Fonts whose rights forbid
 * packaging and missing managed records fail the whole package with actionable diagnostics.
 */
export async function buildPaperPackageExport(
  document: PaperDocument,
  sourceItems: SourceBinLibraryItem[] = [],
  options: PaperPackageExportOptions = {},
): Promise<PaperPackageExport> {
  const repository = options.repository ?? paperAssetRepository;
  const { records } = await collectVerifiedPaperAssetRecords([document], repository, { strict: true });
  const managedIds = new Set(records.map((entry) => entry.record.ref.id));
  const linked = await collectLinkedSourceBinaries(document, sourceItems, managedIds);

  const documentJson = serializePaperDocument(document);
  const preflightReport = analyzePaperPreflight(document, sourceItems, options.profileId);
  const linkedAssets = collectPaperLinkedAssets(document, sourceItems);
  const fonts = collectPaperFontInventory(document);
  const colors = collectPaperColorInventory(document);
  const production = buildPaperPrintProductionMetadata(document);
  const metadataMembers = linkedAssets.map((asset) => {
    const source = packageSourceMetadata(sourceItems.find((item) => item.id === asset.sourceId));
    return {
      type: 'linked-asset-metadata',
      source,
      asset,
      json: packageJson({ source, asset }),
    };
  });
  const binaryMembers = [
    ...records.map(({ record, source }) => ({ record, role: source.role, label: source.label })),
    ...linked.binaries.map(({ record, label }) => ({ record, role: 'linked-source' as const, label })),
  ];
  const memberRequests: PackageMemberPathRequest[] = [
    ...metadataMembers.map((member) => ({
      directory: 'Links',
      extension: 'json',
      stem: member.asset.sourceLabel,
      identity: `metadata:${member.asset.id}`,
    })),
    ...binaryMembers.map((member) => ({
      directory: packageDirectoryForRole(member.role),
      extension: extensionForAsset(member.record.ref),
      stem: `${safePathPart(member.label)}-${member.record.ref.sha256.slice(0, 12)}`,
      identity: `binary:${member.role}:${member.record.ref.id}`,
    })),
  ];
  const allocatedPaths = allocatePackageMemberPaths(memberRequests);
  const assetFiles = metadataMembers.map((member, index) => ({
    ...member,
    path: allocatedPaths[index],
    bytes: byteLength(member.json),
  })).sort((left, right) => left.path.localeCompare(right.path));
  const packagedBinaries: PackagedBinary[] = binaryMembers.map((member, index) => ({
    file: {
      path: allocatedPaths[metadataMembers.length + index],
      role: member.role,
      label: member.label,
      sha256: member.record.ref.sha256,
      byteLength: member.record.ref.byteLength,
      mimeType: member.record.ref.mimeType,
      ...(member.record.ref.fileName ? { fileName: member.record.ref.fileName } : {}),
    },
    bytes: member.record.bytes,
  })).sort((left, right) => left.file.path.localeCompare(right.file.path));
  const packagedAssets = packagedBinaries.map((entry) => entry.file);
  const files = [
    { path: 'document.sloom-paper.json', type: 'document', bytes: byteLength(documentJson) },
    { path: 'preflight-report.json', type: 'preflight', bytes: byteLength(packageJson(preflightReport)) },
    { path: 'manifest.json', type: 'manifest', bytes: 0 },
    ...assetFiles.map(({ path, type, bytes }) => ({ path, type, bytes })),
    ...packagedAssets.map((asset) => ({ path: asset.path, type: asset.role, bytes: asset.byteLength })),
  ];
  const manifest: PaperPackageManifest = {
    app: 'Sloom Studio Paper',
    version: 2,
    title: document.title,
    createdAt: new Date().toISOString(),
    documentId: document.id,
    pageCount: document.pages.length,
    files,
    packagedAssets,
    unpackagedLinks: linked.unpackaged,
    linkedAssets,
    fonts,
    colors,
    production,
  };
  const manifestJson = finalizeManifestJson(manifest);
  const bundle = {
    manifest,
    document: JSON.parse(documentJson) as PaperDocument,
    preflightReport,
    linkedAssetInventory: linkedAssets,
    fontInventory: fonts,
    colorInventory: colors,
    production,
    assets: assetFiles.map(({ source, asset }) => ({ source, asset })),
  };
  const json = `${JSON.stringify(bundle, null, 2)}\n`;
  const fallbackJsonFileName = `${safePathPart(document.title || 'paper-document')}.sloom-paper-package.json`;
  const zipEntries: Record<string, Uint8Array> = {
    'document.sloom-paper.json': strToU8(documentJson),
    'preflight-report.json': strToU8(packageJson(preflightReport)),
    'manifest.json': strToU8(manifestJson),
  };
  for (const assetFile of assetFiles) {
    zipEntries[assetFile.path] = strToU8(assetFile.json);
  }
  for (const binary of packagedBinaries) {
    zipEntries[binary.file.path] = binary.bytes;
  }
  assertManifestMatchesArchive(manifest, zipEntries);
  let zipped: Uint8Array;
  try {
    zipped = (options.zip ?? zipSync)(zipEntries);
    assertReturnedZipMatchesPackage(zipped, zipEntries, manifest);
  } catch (error) {
    throw new PaperPackageExportError(
      'could not create and validate the self-contained ZIP; no file was downloaded. Remove or re-import the affected assets and try again.',
      { cause: error },
    );
  }
  return {
    fileName: `${safePathPart(document.title || 'paper-document')}.sloom-paper-package.zip`,
    mimeType: 'application/zip',
    manifest,
    blob: new Blob([ownedArrayBuffer(zipped)], { type: 'application/zip' }),
    json,
    fallbackJsonFileName,
    entries: Object.keys(zipEntries),
  };
}

/** Package metadata may name a durable Source Library URL, but never serializes runtime bytes. */
function packageSourceMetadata(source: SourceBinLibraryItem | undefined): SourceBinLibraryItem | undefined {
  if (!source) return undefined;
  const { assetUrl, ...metadata } = source;
  if (assetUrl && !/^(?:data:|blob:)/i.test(assetUrl)) {
    return { ...metadata, assetUrl };
  }
  return metadata;
}

function safePathPart(value: string, maximumBytes = MAX_PACKAGE_LABEL_BYTES): string {
  const normalized = value.normalize('NFKC').trim();
  const sanitized = replaceAsciiControls(normalized)
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const bounded = truncateAscii(sanitized, maximumBytes).replace(/[-. ]+$/g, '');
  const candidate = bounded && bounded !== '.' && bounded !== '..' ? bounded : 'paper-document';
  if (!WINDOWS_RESERVED_PATH_PARTS.test(candidate)) return candidate;
  return `${truncateAscii(candidate, Math.max(1, maximumBytes - 5))}-file`;
}

function replaceAsciiControls(value: string): string {
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? '-' : character;
  }).join('');
}

function truncateAscii(value: string, maximumBytes: number): string {
  return value.slice(0, Math.max(0, maximumBytes));
}

function packageJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function finalizeManifestJson(manifest: PaperPackageManifest): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const json = packageJson(manifest);
    const bytes = byteLength(json);
    const manifestFile = manifest.files.find((file) => file.path === 'manifest.json');
    if (!manifestFile) throw new PaperPackageExportError('internal manifest construction omitted manifest.json.');
    if (manifestFile.bytes === bytes) return json;
    manifestFile.bytes = bytes;
  }
  throw new PaperPackageExportError('internal manifest size did not stabilize.');
}

function assertManifestMatchesArchive(manifest: PaperPackageManifest, entries: Record<string, Uint8Array>): void {
  const manifestPaths = manifest.files.map((file) => file.path).sort();
  const archivePaths = Object.keys(entries).sort();
  if (new Set(manifestPaths).size !== manifestPaths.length || manifestPaths.join('\n') !== archivePaths.join('\n')) {
    throw new PaperPackageExportError('internal manifest and archive member lists disagree; no file was downloaded.');
  }
  for (const file of manifest.files) {
    const bytes = entries[file.path];
    if (!bytes || bytes.byteLength !== file.bytes) {
      throw new PaperPackageExportError(`internal archive member "${file.path}" does not match its manifest size; no file was downloaded.`);
    }
  }
}

interface ZipCentralDirectoryMember {
  path: string;
  pathBytes: Uint8Array;
  flags: number;
  crc32: number;
  compressedBytes: number;
  uncompressedBytes: number;
  compressionMethod: number;
  localHeaderOffset: number;
  dataStart: number;
  dataEnd: number;
}

/**
 * The compressor is an integration boundary, not a trusted implementation detail. Inspect its
 * central directory before decompression so declared sizes cannot make an arbitrary returned ZIP
 * consume unbounded memory, and so duplicate/extra/encrypted members never get silently merged.
 */
function assertReturnedZipMatchesPackage(
  zipped: Uint8Array,
  intendedEntries: Record<string, Uint8Array>,
  intendedManifest: PaperPackageManifest,
): void {
  if (!(zipped instanceof Uint8Array) || zipped.byteLength === 0) {
    throw new Error('the compressor returned no ZIP bytes.');
  }
  const expectedPaths = Object.keys(intendedEntries).sort();
  if (zipped.byteLength > maximumCanonicalZipBytes(intendedEntries)) {
    throw new Error('the compressor returned ZIP bytes beyond the bounded canonical package size.');
  }
  const members = inspectZipCentralDirectory(zipped, expectedPaths.length);
  const actualPaths = members.map((member) => member.path).sort();
  if (actualPaths.length !== expectedPaths.length || actualPaths.join('\n') !== expectedPaths.join('\n')) {
    throw new Error('the returned ZIP has missing or unexpected members.');
  }
  const portablePaths = new Set<string>();
  for (const member of members) {
    assertSafePackageMemberPath(member.path);
    const portablePath = portablePackagePathKey(member.path);
    if (portablePaths.has(portablePath)) throw new Error(`the returned ZIP duplicates portable path "${member.path}".`);
    portablePaths.add(portablePath);
    const intended = intendedEntries[member.path];
    if (!intended || member.uncompressedBytes !== intended.byteLength) {
      throw new Error(`the returned ZIP member "${member.path}" declares an unexpected uncompressed size.`);
    }
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipped);
  } catch (error) {
    throw new Error('the returned ZIP cannot be safely decompressed.', { cause: error });
  }
  const decompressedPaths = Object.keys(entries).sort();
  if (decompressedPaths.length !== expectedPaths.length || decompressedPaths.join('\n') !== expectedPaths.join('\n')) {
    throw new Error('the decompressed ZIP member list does not match the requested package.');
  }
  for (const path of expectedPaths) {
    if (!sameBytes(entries[path], intendedEntries[path])) {
      throw new Error(`the returned ZIP changed requested member "${path}".`);
    }
    const member = members.find((candidate) => candidate.path === path);
    if (!member) throw new Error(`the returned ZIP omitted requested member "${path}".`);
    assertZipMemberIntegrity(zipped, member, entries[path]);
  }

  let returnedManifest: unknown;
  try {
    returnedManifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entries['manifest.json']));
  } catch (error) {
    throw new Error('the returned ZIP has an invalid manifest.json.', { cause: error });
  }
  if (!isPaperPackageManifest(returnedManifest)) {
    throw new Error('the returned ZIP manifest.json has an invalid package shape.');
  }
  assertManifestMatchesArchive(returnedManifest, entries);
  if (JSON.stringify(returnedManifest) !== JSON.stringify(intendedManifest)) {
    throw new Error('the returned ZIP manifest.json does not describe the requested package.');
  }
}

function inspectZipCentralDirectory(bytes: Uint8Array, maximumMembers: number): ZipCentralDirectoryMember[] {
  const endOffset = findZipEndOfCentralDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const commentBytes = readU16(view, endOffset + 20, 'ZIP comment length');
  if (endOffset + 22 + commentBytes !== bytes.byteLength || commentBytes !== 0) throw new Error('the ZIP end record is malformed or outside the private packer subset.');
  if (readU16(view, endOffset + 4, 'ZIP disk number') !== 0 || readU16(view, endOffset + 6, 'ZIP central disk number') !== 0) {
    throw new Error('multi-volume ZIP archives are not supported.');
  }
  const entriesOnDisk = readU16(view, endOffset + 8, 'ZIP disk entry count');
  const entryCount = readU16(view, endOffset + 10, 'ZIP entry count');
  const centralBytes = readU32(view, endOffset + 12, 'ZIP central directory size');
  const centralOffset = readU32(view, endOffset + 16, 'ZIP central directory offset');
  if (entriesOnDisk !== entryCount || entryCount === 0 || entryCount > maximumMembers || entriesOnDisk === 0xffff || entryCount === 0xffff || centralBytes === 0xffff_ffff || centralOffset === 0xffff_ffff) {
    throw new Error('the ZIP uses unsupported or malformed directory metadata.');
  }
  if (centralOffset + centralBytes !== endOffset || centralOffset > endOffset) {
    throw new Error('the ZIP central directory is truncated or misplaced.');
  }

  const members: ZipCentralDirectoryMember[] = [];
  const exactPaths = new Set<string>();
  let previousLocalHeaderOffset = -1;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(view, offset, 'ZIP central header') !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error('the ZIP central directory has an invalid member header.');
    }
    const versionMadeBy = readU16(view, offset + 4, 'ZIP member creator version');
    const versionNeeded = readU16(view, offset + 6, 'ZIP member version');
    const flags = readU16(view, offset + 8, 'ZIP member flags');
    const compressionMethod = readU16(view, offset + 10, 'ZIP compression method');
    const crc32 = readU32(view, offset + 16, 'ZIP member CRC-32');
    const compressedBytes = readU32(view, offset + 20, 'ZIP compressed size');
    const uncompressedBytes = readU32(view, offset + 24, 'ZIP uncompressed size');
    const nameBytes = readU16(view, offset + 28, 'ZIP file name length');
    const extraBytes = readU16(view, offset + 30, 'ZIP extra field length');
    const memberCommentBytes = readU16(view, offset + 32, 'ZIP member comment length');
    const localHeaderOffset = readU32(view, offset + 42, 'ZIP local header offset');
    const nextOffset = offset + 46 + nameBytes + extraBytes + memberCommentBytes;
    if (nextOffset > endOffset) throw new Error('the ZIP central directory is truncated.');
    if (versionMadeBy !== ZIP_PACKER_VERSION || versionNeeded !== ZIP_PACKER_VERSION || flags !== 0 || compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error('the ZIP has encrypted, streamed, or unsupported members.');
    }
    if (extraBytes !== 0 || memberCommentBytes !== 0 || localHeaderOffset === 0xffff_ffff) throw new Error('the ZIP has unsupported member metadata.');
    if (localHeaderOffset <= previousLocalHeaderOffset) {
      throw new Error('the ZIP central directory is not in the canonical local-record order.');
    }
    if (compressionMethod === 0 && compressedBytes !== uncompressedBytes) throw new Error('the ZIP stored member has inconsistent size metadata.');
    if (compressionMethod === 8 && compressedBytes > maximumCanonicalDeflateBytes(uncompressedBytes)) throw new Error('the ZIP compressed member exceeds the bounded private packer input.');
    const pathBytes = bytes.slice(offset + 46, offset + 46 + nameBytes);
    const path = decodeZipPath(pathBytes);
    assertSafePackageMemberPath(path);
    if (exactPaths.has(path)) throw new Error(`the ZIP has duplicate member "${path}".`);
    exactPaths.add(path);
    const local = assertMatchingLocalZipHeader(bytes, path, pathBytes, flags, compressionMethod, crc32, compressedBytes, uncompressedBytes, localHeaderOffset);
    members.push({ path, pathBytes, flags, crc32, compressedBytes, uncompressedBytes, compressionMethod, localHeaderOffset, ...local });
    previousLocalHeaderOffset = localHeaderOffset;
    offset = nextOffset;
  }
  if (offset !== endOffset) throw new Error('the ZIP central directory contains trailing data.');
  let expectedLocalOffset = 0;
  for (const member of members) {
    if (member.localHeaderOffset !== expectedLocalOffset) {
      throw new Error('the ZIP local records contain a preamble, gap, overlap, or out-of-order offset.');
    }
    expectedLocalOffset = member.dataEnd;
  }
  if (expectedLocalOffset !== centralOffset) throw new Error('the ZIP local records do not cover exactly through the central directory.');
  return members;
}

function assertMatchingLocalZipHeader(
  bytes: Uint8Array,
  expectedPath: string,
  expectedPathBytes: Uint8Array,
  expectedFlags: number,
  expectedMethod: number,
  expectedCrc32: number,
  expectedCompressedBytes: number,
  expectedUncompressedBytes: number,
  offset: number,
): { dataStart: number; dataEnd: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readU32(view, offset, 'ZIP local header') !== ZIP_LOCAL_FILE_HEADER) throw new Error('the ZIP has an invalid local member header.');
  const versionNeeded = readU16(view, offset + 4, 'ZIP local member version');
  const flags = readU16(view, offset + 6, 'ZIP local member flags');
  const method = readU16(view, offset + 8, 'ZIP local compression method');
  const crc32 = readU32(view, offset + 14, 'ZIP local CRC-32');
  const compressedBytes = readU32(view, offset + 18, 'ZIP local compressed size');
  const uncompressedBytes = readU32(view, offset + 22, 'ZIP local uncompressed size');
  const nameBytes = readU16(view, offset + 26, 'ZIP local file name length');
  const extraBytes = readU16(view, offset + 28, 'ZIP local extra field length');
  const dataOffset = offset + 30 + nameBytes + extraBytes;
  const dataEnd = dataOffset + compressedBytes;
  if (dataEnd > bytes.byteLength || versionNeeded !== ZIP_PACKER_VERSION || extraBytes !== 0 || flags !== expectedFlags || method !== expectedMethod || crc32 !== expectedCrc32
    || compressedBytes !== expectedCompressedBytes || uncompressedBytes !== expectedUncompressedBytes
    || !sameBytes(bytes.subarray(offset + 30, offset + 30 + nameBytes), expectedPathBytes)
    || decodeZipPath(bytes.subarray(offset + 30, offset + 30 + nameBytes)) !== expectedPath) {
    throw new Error(`the ZIP local header for "${expectedPath}" disagrees with its central directory.`);
  }
  return { dataStart: dataOffset, dataEnd };
}

function findZipEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= Math.max(0, bytes.byteLength - 0x10016); offset -= 1) {
    if (readU32(view, offset, 'ZIP end record') !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
    const commentBytes = readU16(view, offset + 20, 'ZIP comment length');
    if (offset + 22 + commentBytes === bytes.byteLength) return offset;
  }
  throw new Error('the returned bytes are not a complete ZIP archive.');
}

function maximumCanonicalDeflateBytes(uncompressedBytes: number): number {
  return uncompressedBytes + 5 * (1 + Math.ceil(uncompressedBytes / ZIP_PACKER_BLOCK_BYTES));
}

function maximumCanonicalZipBytes(entries: Record<string, Uint8Array>): number {
  const entryCount = Object.keys(entries).length;
  const payloadBytes = Object.values(entries).reduce((total, entry) => total + maximumCanonicalDeflateBytes(entry.byteLength), 0);
  return payloadBytes + entryCount * (30 + 46 + 2 * MAX_PACKAGE_MEMBER_PATH_BYTES) + 22;
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function assertZipMemberIntegrity(bytes: Uint8Array, member: ZipCentralDirectoryMember, output: Uint8Array): void {
  if (crc32(output) !== member.crc32) throw new Error(`the ZIP CRC-32 does not match member "${member.path}".`);
  const compressed = bytes.subarray(member.dataStart, member.dataEnd);
  if (member.compressionMethod === 0) {
    if (!sameBytes(compressed, output)) throw new Error(`the ZIP stored member "${member.path}" does not cover its declared data exactly.`);
    return;
  }
  // fflate at level 6 is the only deflater used by the app. Equality against
  // its deterministic raw stream proves this member consumes its entire slice,
  // including bytes an inflater may otherwise treat as ignorable trailing data.
  if (!sameBytes(deflateSync(output, { level: 6 }), compressed)) {
    throw new Error(`the ZIP deflate member "${member.path}" is non-canonical or does not consume its declared data exactly.`);
  }
}

function readU16(view: DataView, offset: number, label: string): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new Error(`${label} is truncated.`);
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number, label: string): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error(`${label} is truncated.`);
  return view.getUint32(offset, true);
}

function decodeZipPath(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('the ZIP has an invalid UTF-8 member path.', { cause: error });
  }
}

function assertSafePackageMemberPath(path: string): void {
  const segments = path.split('/');
  if (!path || path.normalize('NFKC') !== path || byteLength(path) > MAX_PACKAGE_MEMBER_PATH_BYTES || path.includes('\\')
    || [...path].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || /[. ]$/.test(segment) || WINDOWS_RESERVED_PATH_PARTS.test(segment))) {
    throw new Error(`the ZIP has an unsafe member path "${path}".`);
  }
}

function portablePackagePathKey(path: string): string {
  return path.normalize('NFKC').toLocaleLowerCase('en-US');
}

function isPaperPackageManifest(value: unknown): value is PaperPackageManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Partial<PaperPackageManifest>;
  return manifest.app === 'Sloom Studio Paper'
    && manifest.version === 2
    && Array.isArray(manifest.files)
    && manifest.files.every((file) => Boolean(file)
      && typeof file.path === 'string'
      && typeof file.type === 'string'
      && Number.isSafeInteger(file.bytes)
      && file.bytes >= 0);
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Blob accepts ArrayBuffer, while a generic Uint8Array may be backed by SharedArrayBuffer. */
function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
