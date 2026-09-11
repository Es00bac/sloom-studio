// Vets a user-supplied font file BEFORE it can be imported or embedded. A print deliverable is only as
// trustworthy as its fonts: a corrupt face, a missing outline table, or a font whose licence forbids
// embedding turns a "professional" PDF/X into a broken hand-off. This module is the gate — it parses the
// bytes with @pdf-lib/fontkit (the same engine that does the real subset-embed), confirms the essential
// tables are present, and reads the OS/2 fsType embedding permissions, so nothing broken or un-embeddable
// gets silently accepted. Framework-free + unit-testable; the raw bytes come from a file upload upstream.

import fontkit from '@pdf-lib/fontkit';
import {
  classifyFontEmbeddingRights,
  normalizePaperFontStretch,
  normalizePaperFontWeight,
} from './paperManagedFonts';
import type {
  PaperFontEmbeddability,
  PaperManagedFontAxisRange,
  PaperManagedFontFormat,
  PaperManagedFontStyle,
} from '../types/paper';

/** How the OS/2 fsType bits classify a face for print embedding. */
export type FontEmbeddability = PaperFontEmbeddability;

export type FontFormat = PaperManagedFontFormat | 'woff' | 'woff2' | 'unknown';

export interface FontVetFace {
  collectionIndex: number;
  ok: boolean;
  format: PaperManagedFontFormat;
  familyName?: string;
  subfamilyName?: string;
  postscriptName?: string;
  numGlyphs?: number;
  unitsPerEm?: number;
  weight: number;
  style: PaperManagedFontStyle;
  obliqueAngleDeg?: number;
  stretchPercent: number;
  variableAxes: Record<string, PaperManagedFontAxisRange>;
  unicodeRanges: Array<{ start: number; end: number }>;
  embeddable: boolean;
  canSubset: boolean;
  embeddability: FontEmbeddability;
  missingTables: string[];
  errors: string[];
  warnings: string[];
}

export interface FontVetResult {
  /** True only when the font parsed, has renderable outlines + required tables, and can be embedded. */
  ok: boolean;
  format: FontFormat;
  familyName?: string;
  subfamilyName?: string;
  postscriptName?: string;
  numGlyphs?: number;
  unitsPerEm?: number;
  /** fsType permits embedding this face in a print PDF. */
  embeddable: boolean;
  /** fsType permits subsetting (we always subset; a false here means embed the full font). */
  canSubset: boolean;
  embeddability: FontEmbeddability;
  /** Required tables that are absent (a non-empty list means the font can't be trusted to render). */
  missingTables: string[];
  /** Hard failures that make the font unusable (unparseable, no outlines, missing critical tables). */
  errors: string[];
  /** Soft issues worth surfacing but not blocking (no OS/2 or subsetting disallowed, for example). */
  warnings: string[];
  /** Every face in a collection, or its one face for standalone font files. */
  faces: FontVetFace[];
}

// Tables every sfnt-based face needs to lay out and render text. Absent → the font can't be trusted.
const BASE_REQUIRED_TABLES = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'post'] as const;

/** Read the 4-byte sfnt signature so we can classify wrappers fontkit may refuse to parse (WOFF/WOFF2). */
function sfntSignature(bytes: Uint8Array): FontFormat {
  if (bytes.length < 4) return 'unknown';
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'ttcf') return 'collection';
  if (tag === 'OTTO') return 'opentype-cff';
  // 0x00010000 ("\0\1\0\0"), 'true', 'typ1' are all TrueType-flavoured sfnt.
  if (tag === 'true' || tag === 'typ1' || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)) {
    return 'truetype';
  }
  return 'unknown';
}

interface FontkitFsType {
  noEmbedding?: boolean; // Restricted License embedding (bit 1) — must NOT embed
  viewOnly?: boolean; // Preview & Print embedding (bit 2)
  editable?: boolean; // Editable embedding (bit 3)
  noSubsetting?: boolean; // No subsetting (bit 8)
  bitmapOnly?: boolean; // Bitmap embedding only (bit 9)
}

interface FontkitFont {
  postscriptName?: string;
  familyName?: string;
  subfamilyName?: string;
  numGlyphs?: number;
  unitsPerEm?: number;
  directory?: { tables?: Record<string, unknown> };
  characterSet?: number[];
  variationAxes?: Record<string, { min?: number; default?: number; max?: number }>;
  italicAngle?: number;
  ['OS/2']?: {
    fsType?: FontkitFsType;
    usWeightClass?: number;
    usWidthClass?: number;
  };
  fonts?: FontkitFont[]; // present on a TrueType/OpenType Collection
}

function formatForFace(font: FontkitFont, fallback: FontFormat): PaperManagedFontFormat {
  const tables = font.directory?.tables ?? {};
  const has = (tag: string) => Object.prototype.hasOwnProperty.call(tables, tag);
  if (has('CFF ') || has('CFF2')) return 'opentype-cff';
  if (fallback === 'collection') return 'collection';
  return 'truetype';
}

function fontStyle(font: FontkitFont): PaperManagedFontStyle {
  const subfamily = `${font.subfamilyName ?? ''}`.toLowerCase();
  if (/oblique/.test(subfamily)) return 'oblique';
  if (/italic/.test(subfamily) || (typeof font.italicAngle === 'number' && font.italicAngle !== 0)) return 'italic';
  return 'normal';
}

function obliqueAngle(font: FontkitFont, style: PaperManagedFontStyle): number | undefined {
  if (style !== 'oblique') return undefined;
  const angle = font.italicAngle;
  // OpenType italicAngle is conventionally negative for right-leaning glyphs; CSS uses the
  // authored oblique angle sign. Preserve a finite value and retain the CSS default otherwise.
  return typeof angle === 'number' && Number.isFinite(angle) ? Math.min(90, Math.max(-90, angle)) : 14;
}

function inferredWeight(font: FontkitFont): number {
  const declared = font['OS/2']?.usWeightClass;
  if (typeof declared === 'number' && Number.isFinite(declared)) return normalizePaperFontWeight(declared);
  const subfamily = `${font.subfamilyName ?? ''}`.toLowerCase();
  if (/thin/.test(subfamily)) return 100;
  if (/extra[- ]?light|ultra[- ]?light/.test(subfamily)) return 200;
  if (/light/.test(subfamily)) return 300;
  if (/medium/.test(subfamily)) return 500;
  if (/semi[- ]?bold|demi[- ]?bold/.test(subfamily)) return 600;
  if (/extra[- ]?bold|ultra[- ]?bold/.test(subfamily)) return 800;
  if (/black|heavy/.test(subfamily)) return 900;
  if (/bold/.test(subfamily)) return 700;
  return 400;
}

function stretchPercent(font: FontkitFont): number {
  const widthClass = font['OS/2']?.usWidthClass;
  const stretchByClass: Record<number, number> = {
    1: 50,
    2: 62.5,
    3: 75,
    4: 87.5,
    5: 100,
    6: 112.5,
    7: 125,
    8: 150,
    9: 200,
  };
  return normalizePaperFontStretch(typeof widthClass === 'number' ? stretchByClass[widthClass] : undefined);
}

function normalizeVariableAxes(font: FontkitFont): Record<string, PaperManagedFontAxisRange> {
  const axes = font.variationAxes;
  if (!axes || typeof axes !== 'object') return {};
  const normalized: Record<string, PaperManagedFontAxisRange> = {};
  for (const [tag, axis] of Object.entries(axes)) {
    if (!axis || !Number.isFinite(axis.min) || !Number.isFinite(axis.default) || !Number.isFinite(axis.max)) continue;
    normalized[tag] = { min: axis.min!, default: axis.default!, max: axis.max! };
  }
  return normalized;
}

function unicodeRanges(characterSet: number[] | undefined): Array<{ start: number; end: number }> | undefined {
  if (!Array.isArray(characterSet)) return undefined;
  const codePoints = [...new Set(characterSet)]
    .filter((codePoint) => Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff)
    .sort((left, right) => left - right);
  if (codePoints.length === 0) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  let start = codePoints[0];
  let end = start;
  for (const codePoint of codePoints.slice(1)) {
    if (codePoint === end + 1) {
      end = codePoint;
      continue;
    }
    ranges.push({ start, end });
    start = codePoint;
    end = codePoint;
  }
  ranges.push({ start, end });
  return ranges;
}

function vetFace(font: FontkitFont, collectionIndex: number, fallbackFormat: FontFormat): FontVetFace {
  const tables = font.directory?.tables ?? {};
  const has = (tag: string) => Object.prototype.hasOwnProperty.call(tables, tag);
  const missingTables = BASE_REQUIRED_TABLES.filter((table) => !has(table));
  const errors: string[] = [];
  const warnings: string[] = [];
  const hasTrueType = has('glyf') && has('loca');
  const hasCff = has('CFF ') || has('CFF2');
  if (!hasTrueType && !hasCff) {
    errors.push('The font has no glyph outlines (missing glyf/loca or CFF table) — it cannot be embedded.');
  }
  if (missingTables.length > 0) {
    errors.push(`The font is missing required tables: ${missingTables.join(', ')}.`);
  }
  if (!has('OS/2')) {
    warnings.push('No OS/2 table — embedding permissions are unknown and require an attestation for production output.');
  }

  const rights = classifyFontEmbeddingRights(font['OS/2']?.fsType);
  if (!rights.embeddable) {
    errors.push(rights.reason === 'bitmap-only'
      ? 'This font permits bitmap embedding only and cannot be embedded as production vector text.'
      : "This font's licence forbids embedding (OS/2 fsType is Restricted-License). It can't be used in a print export.");
  } else if (!rights.canSubset) {
    warnings.push('This font disallows subsetting; the full font will be embedded, increasing file size.');
  }

  const safe = <T>(read: () => T): T | undefined => {
    try {
      return read();
    } catch {
      return undefined;
    }
  };
  const numGlyphs = safe(() => (typeof font.numGlyphs === 'number' ? font.numGlyphs : undefined));
  if (numGlyphs !== undefined && numGlyphs <= 0) {
    errors.push('The font reports zero glyphs — it is empty or corrupt.');
  }
  const coverage = safe(() => unicodeRanges(font.characterSet));
  if (!coverage || coverage.length === 0) {
    errors.push('The font Unicode coverage could not be read; it cannot be used for production output.');
  }

  const style = fontStyle(font);
  return {
    collectionIndex,
    ok: errors.length === 0,
    format: formatForFace(font, fallbackFormat),
    familyName: safe(() => font.familyName),
    subfamilyName: safe(() => font.subfamilyName),
    postscriptName: safe(() => font.postscriptName),
    numGlyphs,
    unitsPerEm: safe(() => (typeof font.unitsPerEm === 'number' ? font.unitsPerEm : undefined)),
    weight: inferredWeight(font),
    style,
    ...(style === 'oblique' ? { obliqueAngleDeg: obliqueAngle(font, style) } : {}),
    stretchPercent: stretchPercent(font),
    variableAxes: normalizeVariableAxes(font),
    unicodeRanges: coverage ?? [],
    embeddable: rights.embeddable,
    canSubset: rights.canSubset,
    embeddability: rights.embeddability,
    missingTables: [...missingTables],
    errors,
    warnings,
  };
}

/**
 * Vet raw font bytes for import + embedding. Never throws — a corrupt or unsupported file comes back as a
 * result with `ok: false` and a human-readable reason in `errors`, so the caller can reject it cleanly.
 */
export function vetFontBytes(bytes: Uint8Array): FontVetResult {
  const signature = sfntSignature(bytes);
  const base: FontVetResult = {
    ok: false,
    format: signature,
    embeddable: false,
    canSubset: false,
    embeddability: 'unknown',
    missingTables: [],
    errors: [],
    warnings: [],
    faces: [],
  };

  if (bytes.length === 0) {
    return { ...base, errors: ['The font file is empty.'] };
  }

  // @pdf-lib/fontkit cannot decompress WOFF/WOFF2 — reject with a precise, actionable message rather than
  // a cryptic parse error, so the user knows to convert to .ttf/.otf first.
  if (signature === 'woff' || signature === 'woff2') {
    return {
      ...base,
      errors: [
        `${signature.toUpperCase()} web fonts can't be embedded directly — convert this font to .ttf or .otf and re-import it.`,
      ],
    };
  }

  let parsed: FontkitFont;
  try {
    parsed = fontkit.create(bytes as Buffer) as unknown as FontkitFont;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ...base, errors: [`This file isn't a valid font (${reason}). It may be corrupt or the wrong file type.`] };
  }

  const collectionFaces = Array.isArray(parsed.fonts) && parsed.fonts.length > 0 ? parsed.fonts : [parsed];
  const faces = collectionFaces.map((face, index) => vetFace(face, index, signature));
  const primary = faces[0];
  if (!primary) {
    return { ...base, errors: ['This font does not contain any readable faces.'] };
  }
  const collectionWarning = collectionFaces.length > 1
    ? ['This is a font collection; every face is available for explicit selection.']
    : [];

  return {
    ...primary,
    format: signature === 'collection' ? 'collection' : primary.format,
    warnings: [...collectionWarning, ...primary.warnings],
    faces,
  };
}

/**
 * The distinct non-whitespace characters in `text` that this font has NO glyph for. An empty array means
 * full coverage. Single source of truth for glyph coverage: the exporter uses it to keep a font that can't
 * render the text out of the vector layer (so that frame rasters, where browser font-fallback draws the
 * missing glyphs), and preflight uses it to disclose *which* characters will rasterize instead of embedding
 * as selectable vector. De-duplicated and order-stable (first appearance wins).
 *
 * Fails CLOSED: unreadable coverage is treated as missing so strict export cannot embed a font whose glyph
 * mapping it cannot prove. This may route a draft preview through a non-production fallback, but it never
 * permits a silent production substitution.
 */
export function findUncoveredCharacters(bytes: Uint8Array, text: string): string[] {
  const missing = new Set<string>();
  const addCharacter = (character: string) => {
    if (character.trim() !== '') missing.add(character);
  };
  let parsed: FontkitFont;
  try {
    parsed = fontkit.create(bytes as Buffer) as unknown as FontkitFont;
  } catch {
    for (const character of text) addCharacter(character);
    return [...missing];
  }
  const font = (Array.isArray(parsed.fonts) && parsed.fonts.length > 0 ? parsed.fonts[0] : parsed) as FontkitFont & {
    hasGlyphForCodePoint?: (cp: number) => boolean;
  };
  if (typeof font.hasGlyphForCodePoint !== 'function') {
    for (const character of text) addCharacter(character);
    return [...missing];
  }
  const seen = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    // Skip whitespace — a font legitimately need not carry a glyph for space/tab/newline/CR.
    if (cp === undefined || cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d) continue;
    if (seen.has(cp)) continue;
    seen.add(cp);
    try {
      if (!font.hasGlyphForCodePoint(cp)) missing.add(ch);
    } catch {
      addCharacter(ch);
    }
  }
  return [...missing];
}
