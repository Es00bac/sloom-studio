import { describe, expect, it } from 'vitest';
import type { PaperFrame, PaperManagedFontFace } from '../types/paper';
import {
  aliasPaperDocumentManagedFontFamilies,
  assertNoConflictingPaperManagedFontDescriptors,
  buildExactPaperManagedFontCss,
  collectExactPaperManagedFaces,
  PaperExactManagedFontError,
  paperManagedFontCssSource,
  paperManagedFontDescriptor,
  paperFontStyleDescriptor,
  paperManagedFontLoadTimeoutMs,
  paperManagedFontFamilyForLivePaint,
  readPaperManagedFontManifest,
  verifyExactPaperManagedFontReadiness,
} from './paperExactManagedFonts';
import { createDefaultPaperDocument } from './paperDocument';

const asset = { id: `sha256:${'a'.repeat(64)}`, sha256: 'a'.repeat(64), mimeType: 'font/ttf', byteLength: 3 } as const;
function face(overrides: Partial<PaperManagedFontFace> = {}): PaperManagedFontFace {
  return { id: 'oblique-12', familyId: 'managed-serif', familyName: 'Managed Serif', postscriptName: 'ManagedSerif-Oblique', weight: 900, style: 'oblique', obliqueAngleDeg: 12, stretchPercent: 75, collectionIndex: 0, variableAxes: {}, unicodeRanges: [], format: 'truetype', fontAsset: asset, embeddability: 'installable', canSubset: true, source: { kind: 'user-import' }, license: {}, ...overrides };
}
function frame(): PaperFrame {
  return { id: 'frame', kind: 'text', label: 'Exact text', xMm: 0, yMm: 0, widthMm: 30, heightMm: 10, rotationDeg: 0, locked: false, fit: 'cover', imageScale: 1, imageOffsetXPercent: 0, imageOffsetYPercent: 0, imageRotationDeg: 0, columns: 1, typography: { fontFamily: 'Managed Serif', fontWeight: '700', fontStyle: 'oblique 12deg', fontStretch: 'condensed', fontSizePt: 10, leadingPt: 12, tracking: 0, align: 'left', hyphenate: false, color: '#000' }, fillColor: 'transparent', fillOpacity: 0, strokeColor: 'transparent', strokeOpacity: 0, strokeWidthMm: 0, strokeStyle: 'solid', cornerRadiusMm: 0, opacity: 1, textBoxXPercent: 0, textBoxYPercent: 0, textBoxWidthPercent: 100, textBoxHeightPercent: 100, textRotationDeg: 0, textVerticalAlign: 'top', zIndex: 0, richText: [{ id: 'p', runs: [{ id: 'r', text: 'Exact', fontWeight: 'bolder' }] }] };
}

describe('exact managed Paper font identities', () => {
  it('keeps an oblique angle, stretch, and inherited relative weight through collection and aliasing', () => {
    const exact = face();
    const stale = face({ id: 'wrong-angle', obliqueAngleDeg: 14 });
    expect(collectExactPaperManagedFaces([frame()], [exact, stale]).map((item) => item.id)).toEqual(['oblique-12']);
    const document = createDefaultPaperDocument();
    document.pages[0].frames = [frame()];
    document.importedFonts = [exact, stale];
    const aliased = aliasPaperDocumentManagedFontFamilies(document);
    expect(aliased.pages[0].frames[0].richText?.[0].runs[0].fontFamily).toContain('oblique-12');
    expect(paperFontStyleDescriptor('oblique', exact.obliqueAngleDeg)).toBe('oblique 12deg');
  });

  it('blocks a hostile unrelated returned face before paint', async () => {
    const css = await buildExactPaperManagedFontCss([face({ style: 'normal', obliqueAngleDeg: undefined, stretchPercent: 100 })], async () => Uint8Array.from([1, 2, 3]));
    const fonts = {
      ready: Promise.resolve(),
      load: async () => new Set([{ family: 'not-the-requested-alias', status: 'loaded' }]),
      check: () => true,
    };
    await expect(verifyExactPaperManagedFontReadiness({ fonts } as unknown as Document, css)).rejects.toThrow(/requested identity/i);
  });

  it('uses Chromium-parseable shorthand keywords for exact stretch identity', () => {
    expect(paperManagedFontDescriptor({
      identity: 'condensed', familyAlias: 'exact-condensed', postscriptName: 'Exact-Condensed',
      weight: 400, style: 'normal', stretchPercent: 75, format: 'truetype', collectionIndex: 0,
    })).toBe('normal 400 condensed 16px "exact-condensed"');
    expect(() => paperManagedFontDescriptor({
      identity: 'noncanonical', familyAlias: 'exact-custom', postscriptName: 'Exact-Custom',
      weight: 400, style: 'normal', stretchPercent: 82, format: 'truetype', collectionIndex: 0,
    })).toThrow(/no exact CSS shorthand keyword/i);
  });

  it('scales large-face registration timeouts while keeping them bounded', () => {
    expect(paperManagedFontLoadTimeoutMs(3)).toBe(5_000);
    expect(paperManagedFontLoadTimeoutMs(9_589_900)).toBe(22_500);
    expect(paperManagedFontLoadTimeoutMs(100 * 1024 * 1024)).toBe(30_000);
  });

  it.each([
    ['selected nonzero member', { collectionIndex: 1, postscriptName: 'ManagedSerif-Oblique' }],
    ['old member-zero masquerade', { collectionIndex: 0, postscriptName: 'ManagedSerif-Oblique' }],
    ['nonexistent named member', { collectionIndex: 9, postscriptName: 'No-Such-PostScript-Name' }],
  ])('fails closed for a collection source before CSS paint: %s', async (_label, overrides) => {
    const collection = face({ id: 'collection-face', format: 'collection', ...overrides });
    expect(() => paperManagedFontCssSource(collection, Uint8Array.from([1, 2, 3])))
      .toThrow(PaperExactManagedFontError);
    await expect(buildExactPaperManagedFontCss([collection], async () => Uint8Array.from([1, 2, 3])))
      .rejects.toThrow(/Collection member|standalone/i);
  });

  it('records standalone format and exact variable coordinates in the authenticated manifest', async () => {
    const variable = face({
      id: 'variable', format: 'truetype', collectionIndex: 0,
      variableAxes: { opsz: { min: 8, default: 12, max: 72 } },
      variationSettings: { opsz: 18 },
    });
    const css = await buildExactPaperManagedFontCss([variable], async () => Uint8Array.from([1, 2, 3]));
    expect(css).not.toContain('format("collection")');
    expect(css).not.toContain('#ManagedSerif-Oblique');
    expect(readPaperManagedFontManifest(css)?.faces[0]).toMatchObject({ format: 'truetype', collectionIndex: 0, variationSettings: { opsz: 18 } });
  });

  it('rejects conflicting descriptor bytes before a registration order can choose one', () => {
    expect(() => assertNoConflictingPaperManagedFontDescriptors([
      face(), face({ id: 'same-descriptor-other-bytes', fontAsset: { ...asset, sha256: 'b'.repeat(64), id: `sha256:${'b'.repeat(64)}` } }),
    ])).toThrow(/descriptor collision/i);
  });

  it('maps live managed paint to its registered alias and blocks an unmatched descriptor', () => {
    const exact = face();
    expect(paperManagedFontFamilyForLivePaint({ ...frame().typography, fontWeight: '900' }, [exact])).toContain('sloom-managed-oblique-12');
    expect(paperManagedFontFamilyForLivePaint({ ...frame().typography, fontWeight: '400' }, [exact])).toBe('"sloom-managed-font-blocked"');
  });
});
