/**
 * A deliberately small boundary around the browser Local Font Access API.
 *
 * The API is permission-gated and is only called from an explicit user action
 * in the settings UI. We keep the names supplied by the browser, never call
 * FontData.blob(), and never retain a permission token or font bytes.
 */

export const LOCAL_FONT_DISCOVERY_LIMIT = 500;

export interface LocalFontRecord {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

export type LocalFontDiscoveryStatus = 'success' | 'unsupported' | 'permission-denied' | 'error';

export interface LocalFontDiscoveryResult {
  status: LocalFontDiscoveryStatus;
  fonts: LocalFontRecord[];
  truncated: boolean;
}

interface LocalFontDataLike {
  family?: unknown;
  fullName?: unknown;
  postscriptName?: unknown;
  style?: unknown;
}

export type QueryLocalFonts = () => Promise<readonly LocalFontDataLike[]>;

function queryLocalFontsFromGlobal(): QueryLocalFonts | undefined {
  if (typeof globalThis === 'undefined') return undefined;
  const candidate = (globalThis as typeof globalThis & { queryLocalFonts?: unknown }).queryLocalFonts;
  return typeof candidate === 'function' ? candidate.bind(globalThis) as QueryLocalFonts : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeFont(value: LocalFontDataLike): LocalFontRecord | null {
  const family = text(value.family);
  const fullName = text(value.fullName);
  const postscriptName = text(value.postscriptName);
  const style = text(value.style) || 'normal';
  if (!family || !fullName || !postscriptName) return null;
  return { family, fullName, postscriptName, style };
}

function sortFonts(fonts: LocalFontRecord[]): LocalFontRecord[] {
  return fonts.sort((left, right) => (
    left.family.localeCompare(right.family, 'en-US')
    || left.fullName.localeCompare(right.fullName, 'en-US')
    || left.postscriptName.localeCompare(right.postscriptName, 'en-US')
    || left.style.localeCompare(right.style, 'en-US')
  ));
}

/** True when this renderer exposes the permission-gated discovery API. */
export function isLocalFontDiscoverySupported(): boolean {
  return queryLocalFontsFromGlobal() !== undefined;
}

/**
 * Query local font metadata after an explicit user gesture.
 *
 * This function fails closed when the API is absent or permission is refused,
 * and bounds the metadata returned to the UI so a large system font catalogue
 * cannot create an unbounded render/update.
 */
export async function discoverLocalFonts(query: QueryLocalFonts | undefined = queryLocalFontsFromGlobal()): Promise<LocalFontDiscoveryResult> {
  if (!query) return { status: 'unsupported', fonts: [], truncated: false };

  try {
    const rawFonts = await query();
    const unique = new Map<string, LocalFontRecord>();
    for (const rawFont of rawFonts) {
      const font = normalizeFont(rawFont);
      if (!font) continue;
      const key = [font.family, font.fullName, font.postscriptName, font.style].join('\u0000').toLocaleLowerCase('en-US');
      if (!unique.has(key)) unique.set(key, font);
    }
    const fonts = sortFonts([...unique.values()]);
    return {
      status: 'success',
      fonts: fonts.slice(0, LOCAL_FONT_DISCOVERY_LIMIT),
      truncated: fonts.length > LOCAL_FONT_DISCOVERY_LIMIT,
    };
  } catch (reason) {
    const errorName = reason instanceof Error
      ? reason.name
      : reason && typeof reason === 'object' && 'name' in reason && typeof reason.name === 'string'
        ? reason.name
        : '';
    return {
      status: errorName === 'NotAllowedError' ? 'permission-denied' : 'error',
      fonts: [],
      truncated: false,
    };
  }
}
