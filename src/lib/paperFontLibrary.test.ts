import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PaperImportedFont } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import { vetFontBytes } from './paperFontVetting';
import {
  buildImportedFont,
  normalizeFamilyName,
  resolveTextFace,
  selectImportedFace,
} from './paperFontLibrary';

function fontRef(byteLength = 4): BinaryAssetRef {
  const sha256 = '0'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength };
}

const face = (patch: Partial<PaperImportedFont>): PaperImportedFont => ({
  id: 'f',
  familyId: 'brandon grotesque',
  familyName: 'Brandon Grotesque',
  postscriptName: 'BrandonGrotesque-Regular',
  weight: 400,
  style: 'normal',
  stretchPercent: 100,
  collectionIndex: 0,
  variableAxes: {},
  unicodeRanges: [{ start: 0x20, end: 0x7e }],
  format: 'truetype',
  fontAsset: fontRef(),
  embeddability: 'installable',
  canSubset: true,
  source: { kind: 'user-import' },
  license: {},
  ...patch,
});

describe('normalizeFamilyName', () => {
  it('takes the first token, unquoted + lowercased', () => {
    expect(normalizeFamilyName('"Brandon Grotesque", sans-serif')).toBe('brandon grotesque');
    expect(normalizeFamilyName("'Georgia', serif")).toBe('georgia');
    expect(normalizeFamilyName('Inter')).toBe('inter');
    expect(normalizeFamilyName('')).toBe('');
  });
});

describe('selectImportedFace', () => {
  const regular = face({ id: 'r', weight: 400, style: 'normal' });
  const bold = face({ id: 'b', weight: 700, style: 'normal' });
  const boldItalic = face({ id: 'bi', weight: 700, style: 'italic' });

  it('returns undefined when no family matches', () => {
    expect(selectImportedFace('helvetica', false, false, [regular, bold])).toBeUndefined();
  });
  it('prefers an exact weight+style match', () => {
    expect(selectImportedFace('brandon grotesque', true, true, [regular, bold, boldItalic])?.id).toBe('bi');
    expect(selectImportedFace('brandon grotesque', true, false, [regular, bold, boldItalic])?.id).toBe('b');
  });
  it('does not silently select a nearby face for a missing requested weight', () => {
    expect(selectImportedFace('brandon grotesque', true, false, [regular])).toBeUndefined();
  });
  it('ignores faces whose licence forbids embedding', () => {
    const restricted = face({ id: 'x', embeddability: 'restricted' });
    expect(selectImportedFace('brandon grotesque', false, false, [restricted])).toBeUndefined();
  });
});

describe('resolveTextFace', () => {
  it('embeds the user\'s real font when a family matches', () => {
    const imported = face({ id: 'r', fontAsset: fontRef(3) });
    const resolved = resolveTextFace({ fontFamily: '"Brandon Grotesque", sans-serif' }, [imported]);
    expect(resolved.embeddedReal).toBe(true);
    expect(resolved.id).toBe('imported-r');
    expect(resolved.url).toBeUndefined();
    expect(resolved.assetRef).toEqual(imported.fontAsset);
    expect(resolved.familyName).toBe('Brandon Grotesque');
  });

  it('falls back to the bundled Liberation face (unchanged behaviour) when nothing matches', () => {
    const resolved = resolveTextFace({ fontFamily: 'Georgia, serif' }, undefined);
    expect(resolved.embeddedReal).toBe(false);
    expect(resolved.id).toBe('LiberationSerif-Regular');
    expect(resolved.url).toBe('/fonts/liberation/LiberationSerif-Regular.ttf');
    expect(resolved.assetRef).toBeUndefined();
  });

  it('does not use a matching-but-restricted imported font', () => {
    const restricted = face({ id: 'x', embeddability: 'restricted' });
    const resolved = resolveTextFace({ fontFamily: 'Brandon Grotesque' }, [restricted]);
    expect(resolved.embeddedReal).toBe(false);
    expect(resolved.url).toContain('/fonts/liberation/');
  });

  it('does not use unknown-rights bytes without an attestation', () => {
    const unknown = face({ id: 'unknown', embeddability: 'unknown' });
    const resolved = resolveTextFace({ fontFamily: 'Brandon Grotesque' }, [unknown]);
    expect(resolved.embeddedReal).toBe(false);
    expect(resolved.url).toContain('/fonts/liberation/');
  });

  it('selects an exact numeric weight instead of coercing it to bold', () => {
    const semibold = face({ id: 'semibold', weight: 600 });
    const resolved = resolveTextFace({ fontFamily: 'Brandon Grotesque', fontWeight: '600' }, [semibold]);
    expect(resolved.id).toBe('imported-semibold');
    expect(resolved.embeddedReal).toBe(true);
  });
});

describe('buildImportedFont', () => {
  const bytesOf = (rel: string) => new Uint8Array(readFileSync(resolve(process.cwd(), rel)));

  it('builds a persisted record from a real vetted font and managed asset ref', () => {
    const bytes = bytesOf('public/fonts/liberation/LiberationSans-Bold.ttf');
    const assetRef = fontRef(bytes.byteLength);
    const built = buildImportedFont(vetFontBytes(bytes), assetRef, 'font-1')!;
    expect(built).not.toBeNull();
    expect(built.familyName).toBe('Liberation Sans');
    expect(built.weight).toBe(700);
    expect(built.style).toBe('normal');
    expect(built.format).toBe('truetype');
    expect(built.embeddability).toBe('installable');
    expect(built.fontAsset).toEqual(assetRef);
  });

  it('refuses a font that failed vetting', () => {
    const garbage = new TextEncoder().encode('nope');
    expect(buildImportedFont(vetFontBytes(garbage), fontRef(garbage.byteLength), 'font-2')).toBeNull();
  });
});
