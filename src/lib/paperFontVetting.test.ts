import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findUncoveredCharacters, vetFontBytes } from './paperFontVetting';

const LIBERATION = resolve(process.cwd(), 'public/fonts/liberation/LiberationSerif-Regular.ttf');
const validFont = (): Uint8Array => new Uint8Array(readFileSync(LIBERATION));

/** Locate a table's byte offset in an sfnt directory (numTables@4, 16-byte records from offset 12). */
function tableOffset(bytes: Uint8Array, tag: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const recTag = String.fromCharCode(bytes[rec], bytes[rec + 1], bytes[rec + 2], bytes[rec + 3]);
    if (recTag === tag) return view.getUint32(rec + 8);
  }
  throw new Error(`table ${tag} not found`);
}

/** Return a copy of a real font with its OS/2 fsType (uint16 at OS/2+8) overwritten. */
function patchFsType(bytes: Uint8Array, fsType: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  const os2 = tableOffset(copy, 'OS/2');
  new DataView(copy.buffer).setUint16(os2 + 8, fsType);
  return copy;
}

describe('vetFontBytes', () => {
  it('accepts a real, embeddable TrueType face and reports its identity', () => {
    const result = vetFontBytes(validFont());
    expect(result.ok).toBe(true);
    expect(result.format).toBe('truetype');
    expect(result.familyName).toBe('Liberation Serif');
    expect(result.subfamilyName).toBe('Regular');
    expect(result.postscriptName).toBe('LiberationSerif');
    expect(result.numGlyphs).toBeGreaterThan(0);
    expect(result.unitsPerEm).toBe(2048);
    expect(result.embeddable).toBe(true);
    expect(result.canSubset).toBe(true);
    expect(result.embeddability).toBe('installable');
    expect(result.missingTables).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('rejects non-font garbage without throwing', () => {
    const result = vetFontBytes(new TextEncoder().encode('this is definitely not a font file at all'));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/isn't a valid font|corrupt|wrong file type/i);
  });

  it('rejects an empty file', () => {
    const result = vetFontBytes(new Uint8Array(0));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/empty/i);
  });

  it('rejects WOFF/WOFF2 wrappers with an actionable message (fontkit cannot decompress them)', () => {
    const woff = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 0, 0, 0]); // 'wOFF'
    const woff2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]); // 'wOF2'
    const rWoff = vetFontBytes(woff);
    const rWoff2 = vetFontBytes(woff2);
    expect(rWoff.ok).toBe(false);
    expect(rWoff.format).toBe('woff');
    expect(rWoff.errors.join(' ')).toMatch(/convert this font to \.ttf or \.otf/i);
    expect(rWoff2.ok).toBe(false);
    expect(rWoff2.format).toBe('woff2');
  });

  it('blocks a font whose licence forbids embedding (Restricted-License fsType)', () => {
    const restricted = patchFsType(validFont(), 0x0002); // noEmbedding bit
    const result = vetFontBytes(restricted);
    expect(result.embeddable).toBe(false);
    expect(result.embeddability).toBe('restricted');
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/licence forbids embedding|Restricted-License/i);
  });

  it('allows a no-subsetting font but warns and embeds it whole', () => {
    const noSubset = patchFsType(validFont(), 0x0100); // noSubsetting bit
    const result = vetFontBytes(noSubset);
    expect(result.ok).toBe(true);
    expect(result.embeddable).toBe(true);
    expect(result.canSubset).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/disallows subsetting|full font will be embedded/i);
  });

  it('blocks bitmap-only embedding rights', () => {
    const bitmapOnly = patchFsType(validFont(), 0x0200);
    const result = vetFontBytes(bitmapOnly);
    expect(result.ok).toBe(false);
    expect(result.embeddable).toBe(false);
    expect(result.embeddability).toBe('bitmap-only');
    expect(result.errors.join(' ')).toMatch(/bitmap/i);
  });

  it('treats Editable/Preview&Print fsType as embeddable', () => {
    expect(vetFontBytes(patchFsType(validFont(), 0x0008)).embeddability).toBe('editable');
    expect(vetFontBytes(patchFsType(validFont(), 0x0004)).embeddability).toBe('print-preview');
    expect(vetFontBytes(patchFsType(validFont(), 0x0008)).embeddable).toBe(true);
    expect(vetFontBytes(patchFsType(validFont(), 0x0004)).embeddable).toBe(true);
  });
});

describe('findUncoveredCharacters', () => {
  it('returns [] when the font covers all of the text', () => {
    // Liberation Serif is a full Latin face — it covers ASCII plus common accents/punctuation.
    expect(findUncoveredCharacters(validFont(), 'Hello, world! — café')).toEqual([]);
  });

  it('reports the distinct characters the font has no glyph for', () => {
    // Liberation Serif has no CJK glyphs.
    expect(findUncoveredCharacters(validFont(), '你好')).toEqual(['你', '好']);
  });

  it('de-duplicates repeated missing characters (first appearance order)', () => {
    expect(findUncoveredCharacters(validFont(), '猫猫犬')).toEqual(['猫', '犬']);
  });

  it('ignores whitespace (a font need not carry a space glyph to "cover" text)', () => {
    expect(findUncoveredCharacters(validFont(), 'a b\tc\nd')).toEqual([]);
  });

  it('reports only the uncovered characters from mixed covered/uncovered text', () => {
    expect(findUncoveredCharacters(validFont(), 'Neko 猫 chan')).toEqual(['猫']);
  });

  it('fails closed when coverage bytes cannot be parsed', () => {
    expect(findUncoveredCharacters(new TextEncoder().encode('not a font'), '你 好')).toEqual(['你', '好']);
  });
});
