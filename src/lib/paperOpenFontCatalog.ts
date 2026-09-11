import {
  createBinaryAssetRecord,
  isBinaryAssetRef,
} from '../shared/assets/contentAddressedAsset';
import type { PaperManagedFontFace } from '../types/paper';
import type { PaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import { buildImportedFont } from './paperFontLibrary';
import { vetFontBytes } from './paperFontVetting';
import {
  normalizePaperFontFamilyId,
  OPEN_CATALOG_LICENSE_IDS,
} from './paperManagedFonts';

const FONTS_URL = 'https://api.fontsource.org/v1/fonts';
const FONT_SOURCE_CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';
const FONT_SOURCE_PACKAGE_CDN = 'https://cdn.jsdelivr.net/npm/@fontsource';
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const OPEN_FONT_LICENSE_IDS = OPEN_CATALOG_LICENSE_IDS;
export type OpenFontLicenseId = (typeof OPEN_CATALOG_LICENSE_IDS)[number];
export type OpenFontStyle = 'normal' | 'italic';

export interface OpenFontCatalogFamily {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  styles: OpenFontStyle[];
  defaultSubset: string;
}

export interface OpenFontCatalogFace {
  familyId: string;
  family: string;
  subset: string;
  weight: number;
  style: OpenFontStyle;
  version: string;
  ttfUrl: string;
  license: {
    id: OpenFontLicenseId;
    url: string;
    attribution: string;
    text: string;
  };
  bytes: Uint8Array;
}

/** A downloaded face remains metadata-only in Settings; its bytes stay in the managed asset repository. */
export interface OpenFontLibraryFace {
  face: PaperManagedFontFace;
  subset: string;
  retrievedAt: number;
}

export interface OpenFontCatalogClient {
  listFamilies: () => Promise<OpenFontCatalogFamily[]>;
  getFamily: (id: string) => Promise<OpenFontCatalogFamily>;
  downloadFace: (id: string, weight: number, style: OpenFontStyle, subset?: string) => Promise<OpenFontCatalogFace>;
}

export interface OpenFontCatalogClientOptions {
  fetchImpl?: typeof fetch;
}

export interface DownloadOpenFontFaceInput {
  id: string;
  weight: number;
  style: OpenFontStyle;
  subset?: string;
  repository: PaperAssetRepository;
  client?: OpenFontCatalogClient;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireFontId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error('The selected Fontsource family id is invalid.');
  }
  return normalized;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))];
}

function weightArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is number =>
    typeof entry === 'number' && Number.isInteger(entry) && entry >= 1 && entry <= 1000,
  ))].sort((left, right) => left - right);
}

function styles(value: unknown): OpenFontStyle[] {
  return stringArray(value).flatMap((entry) => entry === 'normal' || entry === 'italic' ? [entry] : []);
}

function normalizeFamily(value: unknown): OpenFontCatalogFamily {
  if (!isRecord(value)) throw new Error('Fontsource returned an invalid family record.');
  const id = typeof value.id === 'string' ? requireFontId(value.id) : '';
  const family = typeof value.family === 'string' ? value.family.trim() : '';
  const subsets = stringArray(value.subsets);
  const weights = weightArray(value.weights);
  const availableStyles = styles(value.styles);
  const requestedDefault = typeof value.defSubset === 'string' ? value.defSubset : '';
  const defaultSubset = subsets.includes(requestedDefault) ? requestedDefault : subsets[0] ?? '';
  if (!id || !family || !defaultSubset || weights.length === 0 || availableStyles.length === 0) {
    throw new Error('Fontsource returned incomplete family metadata.');
  }
  return { id, family, subsets, weights, styles: availableStyles, defaultSubset };
}

async function fetchResponse(
  fetchImpl: typeof fetch,
  url: string,
  accept: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: accept },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not contact Fontsource: ${message}`);
  }
  if (!response.ok) {
    throw new Error(`Fontsource request failed (${response.status}) for ${url}.`);
  }
  return response;
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchResponse(fetchImpl, url, 'application/json');
  try {
    return await response.json();
  } catch {
    throw new Error(`Fontsource returned invalid JSON for ${url}.`);
  }
}

function assertVersion(version: unknown): string {
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error('Fontsource did not provide a strict package version.');
  }
  return version;
}

function versionFromPayload(value: unknown): string {
  if (typeof value === 'string') return assertVersion(value);
  if (isRecord(value)) {
    const version = typeof value.latest === 'string' ? value.latest : value.version;
    return assertVersion(version);
  }
  throw new Error('Fontsource did not provide a package version.');
}

function assertPinnedResponse(response: Response, requestedUrl: string, requiredPathPrefix: string): void {
  const effectiveUrl = response.url || requestedUrl;
  try {
    const requested = new URL(requestedUrl);
    const effective = new URL(effectiveUrl);
    if (effective.origin !== requested.origin || !effective.pathname.startsWith(requiredPathPrefix)) {
      throw new Error('Fontsource redirected a required file away from its pinned package identity.');
    }
  } catch (error) {
    if (error instanceof Error && /Fontsource redirected/.test(error.message)) throw error;
    throw new Error('Fontsource returned an invalid URL for a required pinned package file.');
  }
}

function licenseIdFromMetadata(metadata: unknown): { id: OpenFontLicenseId; attribution: string } {
  if (!isRecord(metadata)) throw new Error('Fontsource license metadata is missing.');
  const license = metadata.license;
  const id = typeof license === 'string'
    ? license
    : isRecord(license)
      ? typeof license.id === 'string'
        ? license.id
        : license.type
      : undefined;
  if (!OPEN_FONT_LICENSE_IDS.includes(id as OpenFontLicenseId)) {
    throw new Error('Fontsource did not provide an allowed authoritative license record.');
  }
  const attribution = typeof metadata.attribution === 'string'
    ? metadata.attribution.trim()
    : isRecord(license) && typeof license.attribution === 'string'
      ? license.attribution.trim()
      : '';
  return { id: id as OpenFontLicenseId, attribution };
}

function licenseTextMatches(id: OpenFontLicenseId, text: string): boolean {
  if (!text.trim()) return false;
  if (id === 'OFL-1.1') return /open\s+font\s+license/i.test(text) && /version\s+1\.1/i.test(text);
  if (id === 'Apache-2.0') return /apache\s+license/i.test(text) && /version\s+2\.0/i.test(text);
  return /\bmit\s+license\b/i.test(text);
}

function faceUrl(id: string, version: string, subset: string, weight: number, style: OpenFontStyle): string {
  return `${FONT_SOURCE_CDN}/${id}@${version}/${encodeURIComponent(subset)}-${weight}-${style}.ttf`;
}

export function createOpenFontCatalogClient(input: OpenFontCatalogClientOptions = {}): OpenFontCatalogClient {
  const fetchImpl = input.fetchImpl ?? fetch;

  const getFamily = async (rawId: string): Promise<OpenFontCatalogFamily> => {
    const id = requireFontId(rawId);
    return normalizeFamily(await fetchJson(fetchImpl, `${FONTS_URL}/${encodeURIComponent(id)}`));
  };

  return {
    listFamilies: async () => {
      const payload = await fetchJson(fetchImpl, FONTS_URL);
      if (!Array.isArray(payload)) throw new Error('Fontsource returned an invalid family catalog.');
      return payload.map(normalizeFamily).sort((left, right) => left.family.localeCompare(right.family));
    },
    getFamily,
    downloadFace: async (rawId, weight, style, requestedSubset) => {
      const family = await getFamily(rawId);
      if (!family.weights.includes(weight) || !family.styles.includes(style)) {
        throw new Error('The selected Fontsource face is not available.');
      }
      const subset = requestedSubset ?? family.defaultSubset;
      if (!family.subsets.includes(subset)) throw new Error('The selected Fontsource subset is not available.');

      const versionPayload = await fetchJson(fetchImpl, `${FONTS_URL.replace('/fonts', '/version')}/${encodeURIComponent(family.id)}`);
      const version = versionFromPayload(versionPayload);
      const metadataUrl = `${FONT_SOURCE_PACKAGE_CDN}/${family.id}@${version}/metadata.json`;
      const metadataResponse = await fetchResponse(fetchImpl, metadataUrl, 'application/json');
      const packagePath = `/npm/@fontsource/${family.id}@${version}/`;
      assertPinnedResponse(metadataResponse, metadataUrl, packagePath);
      let metadata: unknown;
      try {
        metadata = await metadataResponse.json();
      } catch {
        throw new Error('Fontsource license metadata is not valid JSON.');
      }
      const license = licenseIdFromMetadata(metadata);

      const licenseUrl = `${FONT_SOURCE_PACKAGE_CDN}/${family.id}@${version}/LICENSE`;
      const licenseResponse = await fetchResponse(fetchImpl, licenseUrl, 'text/plain');
      assertPinnedResponse(licenseResponse, licenseUrl, packagePath);
      const licenseText = await licenseResponse.text();
      if (!licenseTextMatches(license.id, licenseText)) {
        throw new Error('Fontsource license text does not match the authoritative license identifier.');
      }

      const ttfUrl = faceUrl(family.id, version, subset, weight, style);
      const fontResponse = await fetchResponse(fetchImpl, ttfUrl, 'font/ttf,application/octet-stream');
      assertPinnedResponse(fontResponse, ttfUrl, `/fontsource/fonts/${family.id}@${version}/`);
      const bytes = new Uint8Array(await fontResponse.arrayBuffer());
      if (bytes.byteLength === 0) throw new Error('Fontsource returned an empty font file.');

      return {
        familyId: family.id,
        family: family.family,
        subset,
        weight,
        style,
        version,
        ttfUrl,
        license: { id: license.id, url: licenseUrl, attribution: license.attribution, text: licenseText },
        bytes,
      };
    },
  };
}

export function listOpenFontFamilies(input: OpenFontCatalogClientOptions = {}): Promise<OpenFontCatalogFamily[]> {
  return createOpenFontCatalogClient(input).listFamilies();
}

export function fetchOpenFontFamily(id: string, input: OpenFontCatalogClientOptions = {}): Promise<OpenFontCatalogFamily> {
  return createOpenFontCatalogClient(input).getFamily(id);
}

/** Downloads, vets, hashes, and stores a catalog face and its authoritative license text locally. */
export async function downloadOpenFontFace(input: DownloadOpenFontFaceInput): Promise<OpenFontLibraryFace> {
  const client = input.client ?? createOpenFontCatalogClient({ fetchImpl: input.fetchImpl });
  const downloaded = await client.downloadFace(input.id, input.weight, input.style, input.subset);
  const vet = vetFontBytes(downloaded.bytes);
  if (!vet.ok) {
    throw new Error(vet.errors[0] ?? 'The downloaded font did not pass production vetting.');
  }

  const fontRecord = await createBinaryAssetRecord(downloaded.bytes, {
    mimeType: 'font/ttf',
    fileName: `${downloaded.familyId}-${downloaded.subset}-${downloaded.weight}-${downloaded.style}.ttf`,
  });
  const licenseRecord = await createBinaryAssetRecord(new TextEncoder().encode(downloaded.license.text), {
    mimeType: 'text/plain',
    fileName: `${downloaded.familyId}-${downloaded.version}-LICENSE.txt`,
  });
  const [fontAsset, licenseAsset] = await Promise.all([
    input.repository.put(fontRecord),
    input.repository.put(licenseRecord),
  ]);
  const face = buildImportedFont(
    vet,
    fontAsset,
    `open-${downloaded.familyId}-${downloaded.subset}-${downloaded.weight}-${downloaded.style}-${fontAsset.sha256.slice(0, 12)}`,
    {
      source: { kind: 'open-catalog', url: downloaded.ttfUrl, version: downloaded.version },
      license: {
        id: downloaded.license.id,
        textAsset: licenseAsset,
        ...(downloaded.license.attribution ? { attribution: downloaded.license.attribution } : {}),
      },
    },
  );
  if (!face) throw new Error('The downloaded font cannot be embedded as a managed face.');
  if (normalizePaperFontFamilyId(face.familyName) !== normalizePaperFontFamilyId(downloaded.family)) {
    throw new Error('The downloaded font family does not match the selected Fontsource family.');
  }
  return { face, subset: downloaded.subset, retrievedAt: (input.now ?? Date.now)() };
}

/** Reference-only shape safe to persist in Settings; bytes stay in the Paper asset repository. */
export function isOpenFontLibraryFace(value: unknown): value is OpenFontLibraryFace {
  if (!isRecord(value) || !isRecord(value.face) || typeof value.subset !== 'string') return false;
  const retrievedAt = value.retrievedAt;
  const face = value.face;
  return typeof retrievedAt === 'number'
    && Number.isFinite(retrievedAt)
    && typeof face.id === 'string'
    && typeof face.familyId === 'string'
    && typeof face.familyName === 'string'
    && typeof face.postscriptName === 'string'
    && isRecord(face.source)
    && face.source.kind === 'open-catalog'
    && typeof face.source.url === 'string'
    && typeof face.source.version === 'string'
    && isRecord(face.license)
    && OPEN_FONT_LICENSE_IDS.includes(face.license.id as OpenFontLicenseId)
    && isBinaryAssetRef(face.fontAsset)
    && isBinaryAssetRef(face.license.textAsset);
}
