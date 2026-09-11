import { describe, expect, it } from 'vitest';
import { createDefaultPaperDocument } from './paperDocument';
import { updatePaperDocumentSetup } from './paperDocument';
import type { PaperDocument, PaperFrame, PaperImportedFont } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperSwatch } from './paperSwatches';
import type { IccCmykTransform } from './paperColorManagement';
import { buildOutlineTextFrameSpecs, buildVectorTextFrameSpecs, frameTextHasManagedFaces, frameTextIsOutlineable, pageTextIsVectorizable } from './paperPdfxVectorTextFrames';

function fontRef(byteLength = 4): BinaryAssetRef {
  const sha256 = '1'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength };
}

const PT_PER_MM = 72 / 25.4;

// Fake transform: reports pure black K for any colour (enough to assert the 0..1 CMYK plumbing).
const blackTransform: IccCmykTransform = {
  kind: 'icc',
  profileName: 'test',
  rgbToCmyk: () => ({ c: 0, m: 0, y: 0, k: 100 }),
};

// Fake transform: reports a RICH black (heavy CMY under the K) for any colour — exercises black policy.
const richBlackTransform: IccCmykTransform = {
  kind: 'icc',
  profileName: 'test',
  rgbToCmyk: () => ({ c: 60, m: 40, y: 40, k: 100 }),
};

function docWithFrames(frames: Partial<PaperFrame>[], bleedMm = 0): PaperDocument {
  let doc = createDefaultPaperDocument({ title: 'vec', preset: 'us-letter' });
  doc = updatePaperDocumentSetup(doc, { bleedMm });
  const template = doc.pages[0].frames[0];
  const built = frames.map((patch, i) => ({
    ...(template ?? ({} as PaperFrame)),
    id: `f${i}`,
    kind: 'text',
    label: `f${i}`,
    xMm: 10, yMm: 20, widthMm: 50, heightMm: 30, rotationDeg: 0, locked: false,
    fit: 'contain', imageScale: 1, imageOffsetXPercent: 0, imageOffsetYPercent: 0, imageRotationDeg: 0,
    columns: 1, fillColor: 'transparent', fillOpacity: 1, strokeColor: 'transparent', strokeOpacity: 1,
    strokeWidthMm: 0, strokeStyle: 'solid', cornerRadiusMm: 0, opacity: 1,
    typography: { ...(template?.typography ?? ({} as PaperFrame['typography'])) },
    ...patch,
  } as PaperFrame));
  return { ...doc, pages: doc.pages.map((p, i) => (i === 0 ? { ...p, frames: built } : p)) };
}

describe('buildVectorTextFrameSpecs', () => {
  it('maps geometry mm→pt with bleed and converts colour to 0..1 CMYK', () => {
    const doc = docWithFrames([
      { text: 'Hello', xMm: 10, yMm: 20, widthMm: 50, heightMm: 30,
        typography: { fontFamily: 'Georgia', fontSizePt: 12, leadingPt: 16, tracking: 0, hyphenate: false, align: 'left', color: '#000000', fontWeight: 'normal', fontStyle: 'normal' } },
    ], 5);
    const [spec] = buildVectorTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(spec.text).toBe('Hello');
    expect(spec.fontId).toBe('LiberationSerif-Regular');
    expect(spec.fontUrl).toBe('/fonts/liberation/LiberationSerif-Regular.ttf');
    // Geometry matches the print/flatten render: frame inset by border(0) + 2mm content padding.
    expect(spec.xPt).toBeCloseTo((5 + 10 + 2) * PT_PER_MM, 4);
    expect(spec.yTopPt).toBeCloseTo((5 + 20 + 2) * PT_PER_MM, 4);
    expect(spec.widthPt).toBeCloseTo((50 - 4) * PT_PER_MM, 4);
    expect(spec.heightPt).toBeCloseTo((30 - 4) * PT_PER_MM, 4);
    expect(spec.cmyk).toEqual({ c: 0, m: 0, y: 0, k: 1 });
    expect(spec.align).toBe('left');
  });

  it('skips empty and rotated text frames', () => {
    const doc = docWithFrames([
      { text: '   ', typography: { fontFamily: 'Arial', fontSizePt: 12, leadingPt: 14, tracking: 0, hyphenate: false, align: 'left', color: '#111', fontWeight: 'normal', fontStyle: 'normal' } },
      { text: 'rotated', rotationDeg: 15, typography: { fontFamily: 'Arial', fontSizePt: 12, leadingPt: 14, tracking: 0, hyphenate: false, align: 'left', color: '#111', fontWeight: 'normal', fontStyle: 'normal' } },
      { text: 'keep', rotationDeg: 0, typography: { fontFamily: 'Arial', fontSizePt: 12, leadingPt: 14, tracking: 0, hyphenate: false, align: 'left', color: '#111', fontWeight: 'normal', fontStyle: 'normal' } },
    ]);
    const specs = buildVectorTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(specs.map((s) => s.text)).toEqual(['keep']);
  });

  it('reports a page unvectorizable when any text frame is rotated', () => {
    const rotated = docWithFrames([{ text: 'x', rotationDeg: 90, typography: { fontFamily: 'Arial', fontSizePt: 12, leadingPt: 14, tracking: 0, hyphenate: false, align: 'left', color: '#000', fontWeight: 'normal', fontStyle: 'normal' } }]);
    const upright = docWithFrames([{ text: 'x', rotationDeg: 0, typography: { fontFamily: 'Arial', fontSizePt: 12, leadingPt: 14, tracking: 0, hyphenate: false, align: 'left', color: '#000', fontWeight: 'normal', fontStyle: 'normal' } }]);
    expect(pageTextIsVectorizable(rotated.pages[0])).toBe(false);
    expect(pageTextIsVectorizable(upright.pages[0])).toBe(true);
  });

  it('gates features the linear engine cannot reproduce (raster fallback), but allows hyphenation', () => {
    const baseTypo = { fontFamily: 'Arial', fontSizePt: 12, leadingPt: 14, tracking: 0, hyphenate: true, align: 'left' as const, color: '#000', fontWeight: 'normal', fontStyle: 'normal' as const };
    // hyphenation alone stays vectorizable (raster doesn't actually hyphenate)
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', typography: baseTypo }]).pages[0])).toBe(true);
    // each unsupported feature forces a raster fallback
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', columns: 2, typography: baseTypo }]).pages[0])).toBe(false);
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', textArcPercent: 40, typography: baseTypo }]).pages[0])).toBe(false);
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', bubbleShape: 'oval', typography: baseTypo }]).pages[0])).toBe(false);
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', textStrokeWidthMm: 0.3, typography: baseTypo }]).pages[0])).toBe(false);
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', typography: { ...baseTypo, tracking: 40 } }]).pages[0])).toBe(false);
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', typography: { ...baseTypo, dropCapLines: 3 } }]).pages[0])).toBe(false);
  });

  it('rasterizes rich-text frames with real runs or paragraph formatting, keeps uniform rich text vector-safe', () => {
    const baseTypo = { fontFamily: 'Georgia, serif', fontSizePt: 11, leadingPt: 14, tracking: 0, hyphenate: false, align: 'left' as const, color: '#000', fontWeight: 'normal', fontStyle: 'normal' as const };
    // A bold run mid-paragraph: single-style vector would flatten it → the page must raster (runs draw right).
    const boldRun = docWithFrames([{ text: 'a b', richText: [{ runs: [{ text: 'a ' }, { text: 'b', fontWeight: '700' }] }], typography: baseTypo }]);
    expect(pageTextIsVectorizable(boldRun.pages[0])).toBe(false);
    expect(buildVectorTextFrameSpecs(boldRun.pages[0], boldRun, blackTransform)).toHaveLength(0);
    expect(frameTextIsOutlineable(boldRun.pages[0].frames[0])).toBe(false); // outline path also single-style → raster
    // A shaded paragraph → must raster.
    const shaded = docWithFrames([{ text: 'x', richText: [{ runs: [{ text: 'x' }], shading: '#dddddd' }], typography: baseTypo }]);
    expect(pageTextIsVectorizable(shaded.pages[0])).toBe(false);
    // Uniform richText (a lone plain run) is fully represented by the frame typography → still vector-safe.
    const uniform = docWithFrames([{ text: 'x', richText: [{ runs: [{ text: 'x' }] }], typography: baseTypo }]);
    expect(pageTextIsVectorizable(uniform.pages[0])).toBe(true);
    expect(buildVectorTextFrameSpecs(uniform.pages[0], uniform, blackTransform)).toHaveLength(1);
  });

  it('rasterizes display/decorative fonts (no faithful Liberation substitute) but vectorizes text faces', () => {
    const typo = (fontFamily: string) => ({ fontFamily, fontSizePt: 18, leadingPt: 20, tracking: 0, hyphenate: false, align: 'center' as const, color: '#000', fontWeight: '700', fontStyle: 'normal' as const });
    // Text faces Liberation stands in for → vectorized.
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', typography: typo('Inter, system-ui, sans-serif') }]).pages[0])).toBe(true);
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', typography: typo('Georgia, serif') }]).pages[0])).toBe(true);
    // Display/decorative faces → rasterized (real glyphs), not vector-substituted.
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', typography: typo('Impact, Haettenschweiler, sans-serif') }]).pages[0])).toBe(false);
    expect(pageTextIsVectorizable(docWithFrames([{ text: 'x', typography: typo('Bangers, cursive') }]).pages[0])).toBe(false);
    // A display frame is skipped by the spec builder even though it has non-empty text.
    const mixed = docWithFrames([
      { text: 'body', typography: typo('Georgia, serif') },
      { text: 'BOOM', typography: typo('Impact, sans-serif') },
    ]);
    const specs = buildVectorTextFrameSpecs(mixed.pages[0], mixed, blackTransform);
    expect(specs.map((s) => s.text)).toEqual(['body']);
    expect(specs[0].frameId).toBe('f0'); // spec carries the source frame id for raster exclusion
  });

  it('applies the force-100k-text black policy to vector text (avoids rich-black fringing)', () => {
    const serif = { fontFamily: 'Georgia', fontSizePt: 10, leadingPt: 13, tracking: 0, hyphenate: false, align: 'left' as const, color: '#111111', fontWeight: 'normal', fontStyle: 'normal' as const };
    const doc = docWithFrames([{ text: 'body', typography: serif }], 0);

    const forced = { ...doc, printProduction: { ...doc.printProduction, blackPolicy: 'force-100k-text' as const } };
    const [forcedSpec] = buildVectorTextFrameSpecs(forced.pages[0], forced, richBlackTransform);
    expect(forcedSpec.cmyk).toEqual({ c: 0, m: 0, y: 0, k: 1 }); // rewritten to pure K

    const allowed = { ...doc, printProduction: { ...doc.printProduction, blackPolicy: 'allow-rich-black' as const } };
    const [allowedSpec] = buildVectorTextFrameSpecs(allowed.pages[0], allowed, richBlackTransform);
    expect(allowedSpec.cmyk).toEqual({ c: 0.6, m: 0.4, y: 0.4, k: 1 }); // rich black preserved
  });

  it('vectorizes caption frames with their vertical alignment; plain text frames stay top-aligned', () => {
    // A caption is single-column text with a visible box; its text is vectorized and the raster keeps the
    // box (blanked text). The caption gets a flex vertical-align in the raster, so the vector carries it.
    const caption = docWithFrames([
      { kind: 'caption', text: 'Narration', xMm: 10, yMm: 10, widthMm: 60, heightMm: 40, textVerticalAlign: 'middle',
        typography: { fontFamily: 'Georgia, serif', fontSizePt: 10, leadingPt: 13, tracking: 0, hyphenate: false, align: 'left', color: '#000', fontWeight: 'normal', fontStyle: 'normal' } },
    ], 0);
    const [capSpec] = buildVectorTextFrameSpecs(caption.pages[0], caption, blackTransform);
    expect(capSpec.text).toBe('Narration');
    expect(capSpec.verticalAlign).toBe('middle');
    // padding-inset geometry (border 0 + 2mm): x = 10+2, w = 60-4.
    expect(capSpec.xPt).toBeCloseTo((10 + 2) * PT_PER_MM, 4);
    expect(capSpec.widthPt).toBeCloseTo((60 - 4) * PT_PER_MM, 4);

    // A plain text frame's vertical-align is NOT applied by the raster (block flow) → spec omits it.
    const text = docWithFrames([
      { kind: 'text', text: 'Body', textVerticalAlign: 'middle', columns: 1,
        typography: { fontFamily: 'Arial', fontSizePt: 12, leadingPt: 14, tracking: 0, hyphenate: false, align: 'left', color: '#000', fontWeight: 'normal', fontStyle: 'normal' } },
    ], 0);
    const [textSpec] = buildVectorTextFrameSpecs(text.pages[0], text, blackTransform);
    expect(textSpec.verticalAlign).toBeUndefined();
  });
});

describe('imported fonts in the vector-text builder', () => {
  const typo = (fontFamily: string) => ({ fontFamily, fontSizePt: 14, leadingPt: 18, tracking: 0, hyphenate: false, align: 'left' as const, color: '#000', fontWeight: 'normal', fontStyle: 'normal' as const });
  const importedFace = (patch: Partial<PaperImportedFont>): PaperImportedFont => {
    const familyName = patch.familyName ?? 'Brandon Grotesque';
    return {
      id: 'brandon', familyId: patch.familyId ?? familyName.toLowerCase(), familyName,
      postscriptName: 'BrandonGrotesque-Regular', weight: 400, style: 'normal', stretchPercent: 100,
      collectionIndex: 0, variableAxes: {}, unicodeRanges: [{ start: 0x20, end: 0x7e }],
      format: 'truetype', fontAsset: fontRef(), embeddability: 'installable', canSubset: true,
      source: { kind: 'user-import' }, license: {}, ...patch,
    };
  };
  const withImports = (doc: PaperDocument, fonts: PaperImportedFont[]): PaperDocument => ({ ...doc, importedFonts: fonts });

  it('requires exact managed faces for production-facing vector-text claims', () => {
    const bare = docWithFrames([{ text: 'Body', typography: typo('Georgia, serif') }]);
    expect(frameTextHasManagedFaces(bare.pages[0].frames[0], bare.importedFonts)).toBe(false);

    const managed = withImports(docWithFrames([{ text: 'Body', typography: typo('Brandon Grotesque') }]), [importedFace({})]);
    expect(frameTextHasManagedFaces(managed.pages[0].frames[0], managed.importedFonts)).toBe(true);

    const mixed = withImports(docWithFrames([{
      text: 'Body',
      richText: [{ runs: [{ text: 'Body ' }, { text: 'fallback', fontFamily: 'Unknown Browser Font' }] }],
      typography: typo('Brandon Grotesque'),
    }]), [importedFace({})]);
    expect(frameTextHasManagedFaces(mixed.pages[0].frames[0], mixed.importedFonts)).toBe(false);
  });

  it('carries the imported font asset reference (no inline bytes or URL) when a frame matches it', () => {
    const doc = withImports(
      docWithFrames([{ text: 'Hi', typography: typo('"Brandon Grotesque", sans-serif') }]),
      [importedFace({})],
    );
    const [spec] = buildVectorTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(spec.fontId).toBe('imported-brandon');
    expect(spec.fontAssetRef).toEqual(fontRef());
    expect(spec.fontUrl).toBeUndefined();
  });

  it('lets an imported display font vectorize (real glyphs) instead of rasterizing', () => {
    const doc = withImports(
      docWithFrames([{ text: 'BOOM', typography: typo('Bangers, cursive') }]),
      [importedFace({ id: 'bangers', familyName: 'Bangers' })],
    );
    // Without the import the display font rasterizes; with it, we embed the user's real face.
    expect(pageTextIsVectorizable(doc.pages[0])).toBe(false);
    expect(pageTextIsVectorizable(doc.pages[0], doc.importedFonts)).toBe(true);
    const [spec] = buildVectorTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(spec.text).toBe('BOOM');
    expect(spec.fontId).toBe('imported-bangers');
  });

  it('marks the spec whole-font (subset false) when the imported font disallows subsetting', () => {
    const doc = withImports(
      docWithFrames([{ text: 'x', typography: typo('Brandon Grotesque') }]),
      [importedFace({ canSubset: false })],
    );
    const [spec] = buildVectorTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(spec.subset).toBe(false);
  });

  it('ignores an imported font whose licence forbids embedding (falls back to Liberation)', () => {
    const doc = withImports(
      docWithFrames([{ text: 'x', typography: typo('Brandon Grotesque') }]),
      [importedFace({ embeddability: 'restricted' })],
    );
    const [spec] = buildVectorTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(spec.fontId).toBe('LiberationSans-Regular');
    expect(spec.fontUrl).toBe('/fonts/liberation/LiberationSans-Regular.ttf');
    expect(spec.fontAssetRef).toBeUndefined();
  });

  it('defers managed-font glyph coverage to the async PDF/X asset loader', () => {
    const font = importedFace({ id: 'test', familyName: 'Test Face' });
    const cjk = withImports(docWithFrames([{ text: 'Hello 日本語', typography: typo('Test Face') }]), [font]);
    const [spec] = buildVectorTextFrameSpecs(cjk.pages[0], cjk, blackTransform);
    expect(spec.fontId).toBe('imported-test');
    expect(spec.fontAssetRef).toEqual(font.fontAsset);
  });
});

describe('outline-text (convert to curves) builder', () => {
  const strokeTypo = { fontFamily: 'Georgia, serif', fontSizePt: 24, leadingPt: 28, tracking: 0, hyphenate: false, align: 'left' as const, color: '#000000', fontWeight: 'normal', fontStyle: 'normal' as const };

  it('marks a stroked-but-otherwise-plain text frame outlineable (and NOT selectable-vector)', () => {
    const frame = { text: 'BOOM', textStrokeWidthMm: 0.4, textStrokeColor: '#ffffff', typography: strokeTypo } as const;
    const doc = docWithFrames([frame]);
    const f = doc.pages[0].frames[0];
    expect(frameTextIsOutlineable(f)).toBe(true);
    // A stroke makes it NOT vector-safe (can't be selectable type), so it's handled as outlines instead.
    expect(pageTextIsVectorizable(doc.pages[0])).toBe(false);
  });

  it('does NOT mark a plain (un-stroked) frame outlineable — that stays selectable vector', () => {
    const doc = docWithFrames([{ text: 'body', typography: strokeTypo }]);
    expect(frameTextIsOutlineable(doc.pages[0].frames[0])).toBe(false);
  });

  it('does NOT outline a frame that is unsafe for a reason outlining does not yet handle (e.g. arc)', () => {
    // Arc / on-a-curve text needs per-glyph placement the outline path doesn't do yet → stays raster.
    const doc = docWithFrames([{ text: 'BOOM', textStrokeWidthMm: 0.4, textArcPercent: 40, typography: strokeTypo }]);
    expect(frameTextIsOutlineable(doc.pages[0].frames[0])).toBe(false);
  });

  const spotSwatch: PaperSwatch = { id: 'sw-spot', name: 'Brand', type: 'spot', model: 'cmyk', spotName: 'PANTONE 185 C', rgb: { r: 227, g: 6, b: 19 }, cmyk: { c: 0, m: 90, y: 85, k: 0 } };
  const withSpotText = (policy: 'preserve-named' | 'warn') => {
    const doc = docWithFrames([{ text: 'LOGO', typography: { ...strokeTypo, colorSwatchId: 'sw-spot' } }]);
    return { ...doc, swatches: [spotSwatch], printProduction: { ...doc.printProduction, spotColorPolicy: policy } };
  };

  it('plates spot-coloured text as a /Separation outline and skips the selectable path', () => {
    const doc = withSpotText('preserve-named');
    // The selectable process-text path skips it (so it is not drawn twice)…
    expect(buildVectorTextFrameSpecs(doc.pages[0], doc, blackTransform)).toHaveLength(0);
    // …and the outline path plates it with the named spot ink at full tint.
    const [spec] = buildOutlineTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(spec.spot?.name).toBe('PANTONE 185 C');
    expect(spec.spot?.cmyk).toEqual({ c: 0, m: 0.9, y: 0.85, k: 0 });
    expect(spec.spot?.tint).toBe(1);
  });

  it('leaves spot-coloured text as normal process type when the policy is not preserve-named', () => {
    const doc = withSpotText('warn');
    // Not preserving spots → normal selectable process text, no spot outline.
    expect(buildVectorTextFrameSpecs(doc.pages[0], doc, blackTransform)).toHaveLength(1);
    expect(buildOutlineTextFrameSpecs(doc.pages[0], doc, blackTransform)).toHaveLength(0);
  });

  it('outlines a rotated text frame, carrying the angle + frame-centre pivot', () => {
    const doc = docWithFrames([
      { text: 'TILT', xMm: 40, yMm: 30, widthMm: 90, heightMm: 20, rotationDeg: 20, typography: strokeTypo },
    ], 5);
    // Rotation alone (no stroke) makes the frame outline-only, not selectable-vector.
    expect(frameTextIsOutlineable(doc.pages[0].frames[0])).toBe(true);
    const [spec] = buildOutlineTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(spec.rotationDeg).toBe(20);
    // Pivot is the FRAME centre (bleed 5 + x/y + half w/h), matching CSS transform-origin: center.
    expect(spec.centerXPt).toBeCloseTo((5 + 40 + 90 / 2) * PT_PER_MM, 4);
    expect(spec.centerYTopPt).toBeCloseTo((5 + 30 + 20 / 2) * PT_PER_MM, 4);
  });

  it('outlines letter-spaced (tracked) text and bakes tracking into the advance (tracking/1000 em)', () => {
    const trackedTypo = { ...strokeTypo, tracking: 100 }; // 100/1000 em = 0.1em
    const doc = docWithFrames([{ text: 'WIDE', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20, typography: trackedTypo }]);
    // Tracking alone (no stroke) makes it outline-only, not selectable-vector.
    expect(frameTextIsOutlineable(doc.pages[0].frames[0])).toBe(true);
    const [spec] = buildOutlineTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(spec.trackingPt).toBeCloseTo((100 / 1000) * trackedTypo.fontSizePt, 6); // 0.1 × 24 = 2.4pt
    expect(spec.strokeWidthPt).toBe(0); // no stroke on this one
  });

  it('builds an outline spec carrying the fill, the stroke, and the font url/geometry', () => {
    const doc = docWithFrames([
      { text: 'BOOM', xMm: 10, yMm: 20, widthMm: 50, heightMm: 30, textStrokeWidthMm: 0.5, textStrokeColor: '#ffffff', typography: strokeTypo },
    ], 3);
    const [spec] = buildOutlineTextFrameSpecs(doc.pages[0], doc, blackTransform);
    expect(spec.text).toBe('BOOM');
    expect(spec.fontUrl).toBe('/fonts/liberation/LiberationSerif-Regular.ttf');
    // The fake blackTransform maps EVERY colour to pure K, so fill + stroke both resolve to K (this test
    // exercises the plumbing/geometry, not colour fidelity — that's covered by the real ICC tests).
    expect(spec.cmyk).toEqual({ c: 0, m: 0, y: 0, k: 1 });
    expect(spec.strokeCmyk).toEqual({ c: 0, m: 0, y: 0, k: 1 });
    expect(spec.strokeWidthPt).toBeCloseTo(0.5 * PT_PER_MM, 4);
    // Geometry: bleed 3 + x/y 10/20 + 2mm padding (border 0).
    expect(spec.xPt).toBeCloseTo((3 + 10 + 2) * PT_PER_MM, 4);
    expect(spec.widthPt).toBeCloseTo((50 - 4) * PT_PER_MM, 4);
  });
});
