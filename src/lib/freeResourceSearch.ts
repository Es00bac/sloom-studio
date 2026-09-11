const OPENVERSE_IMAGES_URL = 'https://api.openverse.org/v1/images/';
const MAX_PAGE_SIZE = 20;

export interface FreeImageResource {
  id: string;
  provider: 'Openverse';
  title: string;
  assetUrl: string;
  thumbnailUrl?: string;
  creator?: string;
  creatorUrl?: string;
  license: string;
  licenseUrl?: string;
  sourceUrl?: string;
  sourceName?: string;
  mimeType: string;
}

interface OpenverseImageResult {
  id?: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  creator?: string;
  creator_url?: string;
  license?: string;
  license_version?: string;
  license_url?: string;
  foreign_landing_url?: string;
  source?: string;
}

interface OpenverseImageResponse {
  results?: OpenverseImageResult[];
}

export function buildOpenverseImageSearchUrl(
  query: string,
  options: { pageSize?: number } = {},
): URL {
  const url = new URL(OPENVERSE_IMAGES_URL);
  url.searchParams.set('q', query.trim());
  url.searchParams.set('page_size', String(clampPageSize(options.pageSize ?? 12)));
  return url;
}

export async function searchFreeImageResources(
  query: string,
  options: { pageSize?: number; signal?: AbortSignal } = {},
): Promise<FreeImageResource[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const response = await fetch(buildOpenverseImageSearchUrl(trimmed, options), {
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Openverse image search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as OpenverseImageResponse;
  return (payload.results ?? [])
    .map(mapOpenverseImageResult)
    .filter((result): result is FreeImageResource => Boolean(result));
}

export function inferResourceMimeType(url: string): string {
  const pathname = safeUrlPathname(url).toLowerCase();
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.avif')) return 'image/avif';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  return 'image/jpeg';
}

function mapOpenverseImageResult(result: OpenverseImageResult): FreeImageResource | undefined {
  if (!result.id || !result.url) return undefined;
  const license = formatOpenverseLicense(result.license, result.license_version);
  return {
    id: `openverse:${result.id}`,
    provider: 'Openverse',
    title: result.title?.trim() || 'Openverse image',
    assetUrl: result.url,
    thumbnailUrl: result.thumbnail,
    creator: result.creator,
    creatorUrl: result.creator_url,
    license,
    licenseUrl: result.license_url,
    sourceUrl: result.foreign_landing_url,
    sourceName: result.source,
    mimeType: inferResourceMimeType(result.url),
  };
}

function formatOpenverseLicense(license?: string, version?: string): string {
  if (!license) return 'License unavailable';
  const upper = license.toUpperCase();
  const normalized = upper.startsWith('CC') ? upper.replace(/^CC-?/, 'CC ') : `CC ${upper}`;
  return version ? `${normalized} ${version}` : normalized;
}

function safeUrlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

function clampPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return 12;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(pageSize)));
}
