import { beforeEach, describe, expect, it } from 'vitest';
import type { ManagedBundledFontFaceReference } from '../../types/managedFont';
import {
  buildTextLayerName,
  buildImageTextBezierPathLayout,
  buildImageTextLayerDescriptor,
  buildImageTextFontFallbackSignature,
  buildImageTextNativeExportStateSignature,
  buildImageTextStylePackageSignature,
  buildImageTextExportSourceBinHandoffDescriptor,
  attachTextLayerToVectorPath,
  assertImageTextRasterAllocation,
  applyImageTextFindReplace,
  describeImageTextAdvancedTypographySupport,
  describeImageTextFontCatalog,
  describeImageTextTypographySupportMatrix,
  describeImageTextTypographyParityProgress,
  describeImageTextTypographyReadiness,
  describeUnsupportedImageTextOnPath,
  IMAGE_TEXT_STANDARD_FONT_STACKS,
  IMAGE_TEXT_RASTER_MAX_DIMENSION,
  IMAGE_TEXT_RASTER_MAX_PIXELS,
  IMAGE_TEXT_VISIBLE_OPENTYPE_FEATURES,
  ImageTextRasterBudgetError,
  planImageTextFindReplace,
  planImageTextDictionarySpellcheck,
  planImageTextSpellcheckReadability,
  planImageTextOnPath,
  describeImageTextFontPersistence,
  imageTextCanvasFont,
  measureImageTextBlock,
  normalizeImageTextStyle,
  normalizeImageTextOpenTypeFeatures,
  rasterizeImageTextStyle,
  assertCanvasCanPaintManagedImageText,
  serializeImageTextStylePackage,
  serializeImageTextCharacterStyle,
  serializeImageTextParagraphStyle,
  toggleImageTextOpenTypeFeature,
  updateTextLayerFromStyle,
} from './ImageTextLayer';
import {
  applyImageTextStylePresetToStyle,
  applyImageTextPresetToLayer,
  applyImageTextPresetToStyle,
  buildImageTextStylePresetDescriptor,
  getImageTextEditOverlayBounds,
  imageTextLayerContainsPoint,
} from './ImageTextPresets';
import type { ImageLayer } from '../../types/imageEditor';

class FakeTextContext {
  font = '';
  fontKerning = '';
  fontVariantCaps = '';
  fillStyle = '';
  textBaseline = '';
  fills: Array<{ text: string; x: number; y: number }> = [];
  transforms: Array<{ kind: 'save' | 'restore' | 'translate' | 'rotate'; x?: number; y?: number; angle?: number }> = [];

  measureText(line: string) {
    // Simulate the metric difference that Chromium shows for all-small-caps so the raster path is
    // forced to measure with typography already applied.
    const factor = this.fontVariantCaps === 'all-small-caps' ? 1.5 : 1;
    return { width: line.length * 10 * factor };
  }

  fillText(text: string, x: number, y: number) {
    this.fills.push({ text, x, y });
  }

  save() {
    this.transforms.push({ kind: 'save' });
  }

  restore() {
    this.transforms.push({ kind: 'restore' });
  }

  translate(x: number, y: number) {
    this.transforms.push({ kind: 'translate', x, y });
  }

  rotate(angle: number) {
    this.transforms.push({ kind: 'rotate', angle });
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context = new FakeTextContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

describe('ImageTextLayer', () => {
  it('varies preview/cache signatures across the complete managed-face identity', () => {
    const managedFace = {
      kind: 'bundled' as const, schemaVersion: 2 as const, faceId: 'face-a', family: 'Duplicate Family',
      weight: 400, style: 'normal' as const, stretchPercent: 100, collectionIndex: 0,
      sha256: 'a'.repeat(64), byteLength: 100,
    };
    const signatureFor = (reference: ManagedBundledFontFaceReference) => serializeImageTextStylePackage(normalizeImageTextStyle({
      content: 'Exact title', fontFamily: reference.family, fontWeight: String(reference.weight),
      fontStyle: reference.style, managedFace: reference,
    })).preview.signature;
    const base = signatureFor(managedFace);
    for (const changed of [
      { ...managedFace, faceId: 'face-b' },
      { ...managedFace, family: 'Other Family' }, { ...managedFace, weight: 500 },
      { ...managedFace, style: 'italic' as const },
      { ...managedFace, stretchPercent: 87.5 }, { ...managedFace, collectionIndex: 1 },
      { ...managedFace, variationSettings: { opsz: 18 } },
      { ...managedFace, sha256: 'b'.repeat(64) }, { ...managedFace, byteLength: 101 },
    ]) expect(signatureFor(changed)).not.toBe(base);
  });

  it('fails closed instead of assigning non-standard Canvas variation settings', () => {
    expect(() => assertCanvasCanPaintManagedImageText({ managedFace: {
      kind: 'bundled', schemaVersion: 2, faceId: 'variable', family: 'Variable', weight: 400, style: 'normal', stretchPercent: 100,
      collectionIndex: 0, variationSettings: { opsz: 18 }, sha256: 'a'.repeat(64), byteLength: 100,
    } })).toThrow(/Canvas 2D raster paint is blocked/i);
  });

  beforeEach(() => {
    installCanvasStub();
  });

  it('normalizes configurable text settings for canvas placement', () => {
    const style = normalizeImageTextStyle({
      content: '  Signal\nLoom  ',
      fontFamily: 'Inter',
      fontSize: 64,
      fontWeight: '700',
      fontStyle: 'italic',
      letterSpacing: 2,
      boxWidth: 120,
      boxHeight: 200,
      color: '#facc15',
      lineHeight: 1.2,
      align: 'center',
      verticalAlign: 'middle',
      baselineShift: 7,
      fontKerning: 'none',
      fontVariantCaps: 'small-caps',
      warp: 'arc',
    });

    expect(style).toEqual({
      content: 'Signal\nLoom',
      fontFamily: 'Inter',
      fontSize: 64,
      fontWeight: '700',
      fontStyle: 'italic',
      letterSpacing: 2,
      boxWidth: 120,
      boxHeight: 200,
      wrap: true,
      color: '#facc15',
      lineHeight: 1.2,
      align: 'center',
      verticalAlign: 'middle',
      baselineShift: 7,
      fontKerning: 'none',
      fontVariantCaps: 'small-caps',
      warp: 'arc',
    });
  });

  it('measures multiline text blocks with explicit leading and alignment metadata', () => {
    const layout = measureImageTextBlock(
      normalizeImageTextStyle({
        content: 'A\nwide line',
        fontSize: 50,
        lineHeight: 1.4,
        align: 'right',
      }),
      (line) => line.length * 10,
    );

    expect(layout.lines.map((line) => line.text)).toEqual(['A', 'wide line']);
    expect(layout.width).toBe(90);
    expect(layout.lineHeightPx).toBe(70);
    expect(layout.height).toBe(140);
    expect(layout.align).toBe('right');
  });

  it('wraps text into source style box dimensions and preserves the box as raster bounds', () => {
    const layout = measureImageTextBlock(
      normalizeImageTextStyle({
        content: 'Signal Loom captions wrap',
        fontSize: 20,
        boxWidth: 90,
        boxHeight: 120,
        verticalAlign: 'bottom',
      }),
      (line) => line.length * 10,
    );

    expect(layout.lines.map((line) => line.text)).toEqual(['Signal', 'Loom', 'captions', 'wrap']);
    expect(layout.width).toBe(90);
    expect(layout.height).toBe(120);
    expect(layout.lines[0].baseline).toBeGreaterThan(20);
  });

  it('builds readable text layer names from the actual content', () => {
    expect(buildTextLayerName('  The first balloon line is long enough to trim cleanly.  ')).toBe(
      'The first balloon line is...',
    );
    expect(buildTextLayerName('\n\n')).toBe('Text');
  });

  it('rasterizes text styles into measured bitmap bounds', () => {
    const bitmap = rasterizeImageTextStyle({ content: 'Hi\nThere', fontSize: 20, lineHeight: 1.5 });

    expect(bitmap.width).toBe(50);
    expect(bitmap.height).toBe(60);
    expect((bitmap as unknown as FakeOffscreenCanvas).context.fills.map((fill) => fill.text)).toEqual(['Hi', 'There']);
  });

  it('normalizes, rasterizes, and retains a distinct Bulge text warp', () => {
    expect(normalizeImageTextStyle({ warp: 'bulge' }).warp).toBe('bulge');
    expect(normalizeImageTextStyle({ warp: 'untrusted' as never }).warp).toBe('none');

    const bitmap = rasterizeImageTextStyle({ content: 'ABC', fontSize: 20, warp: 'bulge' });
    const fills = (bitmap as unknown as FakeOffscreenCanvas).context.fills;
    expect(fills.map((fill) => fill.text)).toEqual(['A', 'B', 'C']);
    expect(fills[1]!.y).toBeGreaterThan(fills[0]!.y);
    expect(fills[1]!.y).toBeGreaterThan(fills[2]!.y);
    expect(fills[0]!.y).toBeCloseTo(fills[2]!.y, 8);

    const boxed = rasterizeImageTextStyle({ content: 'ABC', fontSize: 20, boxWidth: 200, warp: 'bulge' });
    const boxedFills = (boxed as unknown as FakeOffscreenCanvas).context.fills;
    expect(boxedFills[1]!.y).toBeGreaterThan(boxedFills[0]!.y);
    expect(boxedFills[1]!.y).toBeGreaterThan(boxedFills[2]!.y);
    expect(boxedFills[0]!.y).toBeCloseTo(boxedFills[2]!.y, 8);
  });

  it('keeps ordinary Bulge words inside a bounded padded raster', () => {
    const bitmap = rasterizeImageTextStyle({ content: 'ABCDEFGH', fontSize: 20, warp: 'bulge' });
    const fills = (bitmap as unknown as FakeOffscreenCanvas).context.fills;
    const yPositions = fills.map((fill) => fill.y);

    expect(bitmap.height).toBe(57);
    expect(Math.min(...yPositions)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...yPositions)).toBeLessThan(bitmap.height);
    expect(yPositions[3]!).toBeGreaterThan(yPositions[0]!);
    expect(yPositions[3]!).toBeCloseTo(yPositions[4]!, 8);
    expect(yPositions[0]!).toBeCloseTo(yPositions[7]!, 8);
  });

  it('applies typography controls while rasterizing retained text', () => {
    const bitmap = rasterizeImageTextStyle({
      content: 'Caps',
      fontFamily: 'Inter',
      fontSize: 20,
      baselineShift: -6,
      fontKerning: 'none',
      fontVariantCaps: 'small-caps',
    });
    const context = (bitmap as unknown as FakeOffscreenCanvas).context;

    expect(context.font).toContain('small-caps');
    expect(context.fontKerning).toBe('none');
    expect(context.fills[0]).toMatchObject({ text: 'Caps', y: 14 });
  });

  it('serializes Canvas font declarations with quoted multi-word families (FBL-012)', () => {
    const font = imageTextCanvasFont({
      fontFamily: 'M PLUS 1, Inter, sans-serif',
      fontSize: 24,
      fontWeight: '400',
      fontStyle: 'normal',
      fontVariantCaps: 'normal',
    });
    expect(font).toBe('normal 400 24px "M PLUS 1", Inter, sans-serif');
  });

  it('renders all-small-caps through the canvas fontVariantCaps property without mutating content (FBL-013)', () => {
    const font = imageTextCanvasFont({
      fontFamily: 'Inter',
      fontSize: 20,
      fontWeight: '700',
      fontStyle: 'normal',
      fontVariantCaps: 'all-small-caps',
    });
    expect(font).not.toContain('small-caps');
    expect(font).not.toContain('all-small-caps');

    const bitmap = rasterizeImageTextStyle({
      content: 'HEADLINE',
      fontFamily: 'Inter',
      fontSize: 20,
      fontWeight: '700',
      fontVariantCaps: 'all-small-caps',
    });
    const context = (bitmap as unknown as FakeOffscreenCanvas).context;
    expect(context.fontVariantCaps).toBe('all-small-caps');
    expect(context.fills[0].text).toBe('HEADLINE');
  });

  it('preserves mixed-case and expanded Unicode content for all-small-caps', () => {
    const bitmap = rasterizeImageTextStyle({
      content: 'Sloom スタジオ',
      fontFamily: 'Inter',
      fontSize: 20,
      fontWeight: '400',
      fontVariantCaps: 'all-small-caps',
    });
    const context = (bitmap as unknown as FakeOffscreenCanvas).context;

    expect(context.fontVariantCaps).toBe('all-small-caps');
    expect(context.fills[0].text).toBe('Sloom スタジオ');
  });

  it('applies typography before measuring so all-small-caps changes layout metrics', () => {
    const normal = rasterizeImageTextStyle({
      content: 'HEADLINE',
      fontFamily: 'Inter',
      fontSize: 20,
      fontWeight: '700',
      fontVariantCaps: 'normal',
    });
    const allSmallCaps = rasterizeImageTextStyle({
      content: 'HEADLINE',
      fontFamily: 'Inter',
      fontSize: 20,
      fontWeight: '700',
      fontVariantCaps: 'all-small-caps',
    });

    expect(allSmallCaps.width).toBeGreaterThan(normal.width);
  });

  it('wraps and aligns all-small-caps Unicode text using caps-aware metrics', () => {
    const block = measureImageTextBlock(
      normalizeImageTextStyle({
        content: 'Sloom スタジオ alpha beta',
        fontFamily: 'Inter',
        fontSize: 20,
        fontWeight: '400',
        fontVariantCaps: 'all-small-caps',
        wrap: true,
        boxWidth: 120,
        align: 'center',
      }),
      (line) => line.length * 10 * 1.5,
    );

    expect(block.lines.length).toBeGreaterThan(1);
    expect(block.lines[0].x).toBeGreaterThan(0);
  });

  it('updates retained text metadata and rerasterizes the layer bitmap', () => {
    const layer = {
      id: 'text-1',
      name: 'Old',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 12,
      y: 24,
      bitmap: null,
      bitmapVersion: 3,
      mask: null,
      text: normalizeImageTextStyle({ content: 'Old', fontSize: 20 }),
      metadata: { editableText: true },
    } satisfies ImageLayer;

    const updated = updateTextLayerFromStyle(layer, { content: 'New title', color: '#ff0000' });

    expect(updated.name).toBe('New title');
    expect(updated.text?.content).toBe('New title');
    expect(updated.text?.color).toBe('#ff0000');
    expect(updated.bitmapVersion).toBe(4);
    expect(updated.x).toBe(12);
    expect(updated.y).toBe(24);
    expect(updated.metadata?.editableText).toBe(true);
    expect(updated.bitmap).not.toBe(layer.bitmap);
  });

  it('applies title and comic text presets without replacing user content', () => {
    const current = normalizeImageTextStyle({ content: 'My Cover', fontSize: 20 });
    const stylePatch = applyImageTextPresetToStyle(current, 'coverTitle');

    expect(stylePatch.content).toBe('My Cover');
    expect(stylePatch.fontWeight).toBe('900');
    expect(stylePatch.warp).toBe('arc');

    const layer = {
      id: 'text-1',
      name: 'Old',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 12,
      y: 24,
      bitmap: rasterizeImageTextStyle(current),
      bitmapVersion: 3,
      mask: null,
      text: current,
      metadata: { editableText: true },
    } satisfies ImageLayer;

    const updated = applyImageTextPresetToLayer(layer, 'comicSfx');

    expect(updated.text?.content).toBe('My Cover');
    expect(updated.text?.fontWeight).toBe('900');
    expect(updated.effects?.map((effect) => effect.kind)).toEqual(['stroke', 'stroke', 'dropShadow']);
    expect(updated.bitmapVersion).toBe(4);
  });

  it('applies named typography style presets without replacing layer content', () => {
    const current = normalizeImageTextStyle({
      content: 'Chapter One',
      color: '#fefefe',
      fontSize: 20,
      fontWeight: '400',
      fontStyle: 'normal',
      letterSpacing: 0,
      baselineShift: 0,
      fontKerning: 'auto',
      fontVariantCaps: 'normal',
      align: 'left',
      lineHeight: 1,
    });

    const stylePatch = applyImageTextStylePresetToStyle(current, 'editorialItalic');

    expect(stylePatch).toMatchObject({
      content: 'Chapter One',
      color: '#fefefe',
      fontFamily: 'Cormorant Garamond, Georgia, serif',
      fontWeight: '600',
      fontStyle: 'italic',
      fontSize: 48,
      fontKerning: 'normal',
      fontVariantCaps: 'small-caps',
      letterSpacing: 1,
      baselineShift: 0,
      align: 'center',
      lineHeight: 1.08,
    });
  });

  it('normalizes OpenType feature descriptors for deterministic helper planning', () => {
    const features = normalizeImageTextOpenTypeFeatures({
      enabled: [' Liga ', 'SS01', 'smcp', '', 'bad-tag!', 'SS01'],
      disabled: ['liga', ' Dlig ', 'bad', 'cv12345'],
    });

    expect(features).toEqual({
      enabled: ['smcp', 'ss01'],
      disabled: ['dlig', 'liga'],
      unsupported: ['bad', 'badtag', 'cv12345'],
    });
  });

  it('persists explicit OpenType features and describes the standard font catalog', () => {
    const style = normalizeImageTextStyle({
      content: 'Feature test',
      fontFamily: 'Inter, system-ui, sans-serif',
      openTypeFeatures: {
        enabled: [' Liga ', 'salt', 'SS01', 'bad-tag!'],
        disabled: ['kern', 'liga'],
      },
    });

    expect(style.openTypeFeatures).toEqual({
      enabled: ['salt', 'ss01'],
      disabled: ['kern', 'liga'],
      unsupported: ['badtag'],
    });
    expect(serializeImageTextStylePackage(style).characterStyle.openTypeFeatures).toEqual({
      enabled: ['salt', 'ss01'],
      disabled: ['kern', 'liga'],
      unsupported: ['badtag'],
      css: "'kern' 0, 'liga' 0, 'salt' 1, 'ss01' 1",
    });
    expect(IMAGE_TEXT_STANDARD_FONT_STACKS[0]).toMatchObject({
      label: 'Inter / System UI',
      stack: 'Inter, system-ui, sans-serif',
      category: 'Sans',
    });
    expect(IMAGE_TEXT_VISIBLE_OPENTYPE_FEATURES.map((feature) => feature.tag)).toEqual([
      'liga',
      'kern',
      'dlig',
      'salt',
      'swsh',
      'ss01',
    ]);
    expect(describeImageTextFontCatalog(style.fontFamily)).toMatchObject({
      selectedStack: {
        label: 'Inter / System UI',
        stack: 'Inter, system-ui, sans-serif',
      },
      standardStacks: expect.arrayContaining([
        expect.objectContaining({
          label: 'Inter / System UI',
          selected: true,
        }),
      ]),
      customFamily: null,
    });
    expect(toggleImageTextOpenTypeFeature(style.openTypeFeatures, 'liga', true)).toEqual({
      enabled: ['liga', 'salt', 'ss01'],
      disabled: ['kern'],
      unsupported: ['badtag'],
    });
  });

  it('serializes text styles with deterministic warnings and preview signatures', () => {
    const style = normalizeImageTextStyle({
      content: 'Headline',
      fontFamily: 'Poster Font, Inter, sans-serif',
      fontSize: 72,
      fontVariantCaps: 'small-caps',
      boxWidth: 320,
      wrap: true,
      warp: 'arc',
    });

    expect(
      serializeImageTextStylePackage(style, {
        enabled: ['smcp', 'salt', 'xxxxxx'],
        disabled: ['liga'],
      }),
    ).toEqual({
      characterStyle: {
        fontFamily: 'Poster Font, Inter, sans-serif',
        fontSize: 72,
        fontWeight: '400',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'small-caps',
        letterSpacing: 0,
        baselineShift: 0,
        openTypeFeatures: {
          enabled: ['salt', 'smcp'],
          disabled: ['liga'],
          unsupported: ['xxxxxx'],
          css: "'liga' 0, 'salt' 1, 'smcp' 1",
        },
      },
      paragraphStyle: {
        align: 'left',
        lineHeight: 1.15,
        verticalAlign: 'top',
        wrap: true,
        boxWidth: 320,
        boxHeight: null,
      },
      warnings: [
        'OpenType feature tags must be exactly four alphanumeric characters; unsupported tags were ignored: xxxxxx.',
        'Arc, flag, and bulge text warps are rasterized approximations and are not editable vector type.',
      ],
      preview: {
        contentLength: 8,
        lineCount: 1,
        signature: 'text:8:Poster Font, Inter, sans-serif:72:400:normal:small-caps:liga=0|salt=1|smcp=1:left:1.15:320:auto:arc',
      },
    });
    expect(buildImageTextStylePackageSignature(style, {
      enabled: ['smcp', 'salt', 'xxxxxx'],
      disabled: ['liga'],
    })).toBe(
      'image-text-style-package:v1:{"styleSignature":"text:8:Poster Font, Inter, sans-serif:72:400:normal:small-caps:liga=0|salt=1|smcp=1:left:1.15:320:auto:arc","character":"Poster Font, Inter, sans-serif|72|400|normal|small-caps|auto|0|0|liga=0|salt=1|smcp=1","paragraph":"left|1.15|top|wrap|320|auto","warningCodes":["opentype-unsupported-tags","rasterized-warp"]}',
    );
  });

  it('serializes retained character and paragraph styles without claiming live type parity', () => {
    const style = normalizeImageTextStyle({
      content: 'Layout copy',
      fontFamily: 'Inter',
      fontSize: 36,
      fontWeight: '600',
      fontStyle: 'italic',
      fontKerning: 'normal',
      fontVariantCaps: 'all-small-caps',
      letterSpacing: 1.25,
      baselineShift: -3,
      boxWidth: 540,
      boxHeight: 180,
      wrap: false,
      lineHeight: 1.4,
      align: 'justify',
      verticalAlign: 'bottom',
    });

    expect(
      serializeImageTextCharacterStyle(style, {
        enabled: ['smcp', 'liga'],
        disabled: ['dlig', 'liga'],
      }),
    ).toEqual({
      fontFamily: 'Inter',
      fontSize: 36,
      fontWeight: '600',
      fontStyle: 'italic',
      fontKerning: 'normal',
      fontVariantCaps: 'all-small-caps',
      letterSpacing: 1.25,
      baselineShift: -3,
      openTypeFeatures: {
        enabled: ['smcp'],
        disabled: ['dlig', 'liga'],
        css: "'dlig' 0, 'liga' 0, 'smcp' 1",
      },
    });

    expect(serializeImageTextParagraphStyle(style)).toEqual({
      align: 'justify',
      lineHeight: 1.4,
      verticalAlign: 'bottom',
      wrap: false,
      boxWidth: 540,
      boxHeight: 180,
    });
  });

  it('builds planning descriptors for unsupported text-on-path requests', () => {
    const plan = planImageTextOnPath({
      textLayerId: 'text-2',
      pathLayerId: 'path-7',
      pathReference: {
        kind: 'vector-layer',
        layerId: 'path-7',
        pathId: 'outline',
        revision: 4,
      },
      startOffset: 18.4,
      reverse: true,
    });

    expect(plan).toEqual({
      status: 'unsupported',
      feature: 'text-on-path',
      textLayerId: 'text-2',
      pathLayerId: 'path-7',
      pathReference: {
        kind: 'vector-layer',
        layerId: 'path-7',
        pathId: 'outline',
        revision: 4,
      },
      startOffset: 18.4,
      reverse: true,
      fallback: 'retain point text metadata and rasterize current glyph layout',
      requiredMetadata: ['textLayerId', 'pathReference.kind', 'pathReference.layerId'],
      reason: 'Sloom Studio does not support editable text-on-path layers yet.',
      warnings: [
        'Editable text-on-path is not available; preserve the path reference so a future text engine can restore intent.',
      ],
    });

    expect(describeUnsupportedImageTextOnPath({ pathLayerId: 'path-7' }).pathReference).toBeNull();
  });

  it('attaches retained text to a straight-segment vector path and rasterizes glyphs along the path', () => {
    const text = {
      id: 'text-2',
      name: 'Text',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 4,
      mask: null,
      text: normalizeImageTextStyle({ content: 'ARC', fontSize: 20, letterSpacing: 2, color: '#ffffff' }),
      metadata: { editableText: true },
    } satisfies ImageLayer;
    const path = {
      id: 'path-1',
      name: 'Caption arc',
      type: 'vector',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 40,
      y: 50,
      bitmap: null,
      bitmapVersion: 2,
      mask: null,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 120,
          height: 50,
          points: [
            { x: 0, y: 40 },
            { x: 60, y: 0 },
            { x: 120, y: 40 },
          ],
          closed: false,
          fillColor: 'transparent',
          fillOpacity: 0,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWidth: 2,
        },
      },
    } satisfies ImageLayer;

    const attached = attachTextLayerToVectorPath(text, path, { startOffset: 6, reverse: true });
    const context = (attached.bitmap as unknown as FakeOffscreenCanvas).context;

    expect(attached.text?.pathReference).toEqual({
      kind: 'vector-layer',
      layerId: 'path-1',
      pathId: 'Caption arc',
      revision: 2,
    });
    expect(attached.text?.pathLayout).toMatchObject({
      sourceLayerId: 'path-1',
      closed: false,
      startOffset: 6,
      reverse: true,
    });
    expect(attached.x).toBeLessThanOrEqual(40);
    expect(attached.y).toBeLessThanOrEqual(50);
    expect(attached.bitmapVersion).toBe(5);
    expect(context.fills.map((fill) => fill.text)).toEqual(['A', 'R', 'C']);
    expect(context.transforms.filter((transform) => transform.kind === 'rotate').map((transform) => transform.angle)).not.toEqual([0, 0, 0]);
  });

  it('retains cubic vector handles, samples the curve, and respects offset/reverse attachment controls', () => {
    const text = {
      id: 'bezier-text',
      name: 'Bezier Text',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 4,
      mask: null,
      text: normalizeImageTextStyle({ content: 'ARC', fontSize: 20, letterSpacing: 2, color: '#ffffff' }),
      metadata: { editableText: true },
    } satisfies ImageLayer;
    const path = {
      id: 'bezier-path',
      name: 'Bezier Caption Path',
      type: 'vector',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 40,
      y: 50,
      bitmap: null,
      bitmapVersion: 9,
      mask: null,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 240,
          height: 120,
          points: [
            { x: 0, y: 72, outHandle: { x: 64, y: -12 } },
            { x: 240, y: 48, inHandle: { x: 176, y: 108 } },
          ],
          closed: false,
          fillColor: 'transparent',
          fillOpacity: 0,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWidth: 2,
        },
      },
    } satisfies ImageLayer;

    const attached = attachTextLayerToVectorPath(text, path, { startOffset: 12, reverse: true });
    const layout = attached.text?.pathLayout;
    const context = (attached.bitmap as unknown as FakeOffscreenCanvas).context;

    expect(layout).toMatchObject({
      sourceLayerId: 'bezier-path',
      geometry: 'bezier-sampled-path',
      startOffset: 12,
      reverse: true,
      closed: false,
    });
    expect(layout?.bezierSegments?.map((segment) => ({
      from: { x: segment.from.x + attached.x, y: segment.from.y + attached.y },
      control1: { x: segment.control1.x + attached.x, y: segment.control1.y + attached.y },
      control2: { x: segment.control2.x + attached.x, y: segment.control2.y + attached.y },
      to: { x: segment.to.x + attached.x, y: segment.to.y + attached.y },
    }))).toEqual([
      {
        from: { x: 40, y: 122 },
        control1: { x: 104, y: 38 },
        control2: { x: 216, y: 158 },
        to: { x: 280, y: 98 },
      },
    ]);
    expect(layout?.points.length).toBeGreaterThan(2);
    expect(layout?.pathLength).toBeGreaterThan(0);
    expect(context.fills.map((fill) => fill.text)).toEqual(['A', 'R', 'C']);
    expect(context.transforms.filter((transform) => transform.kind === 'rotate').map((transform) => transform.angle)).not.toEqual([0, 0, 0]);
    expect(buildImageTextLayerDescriptor(attached)?.warnings).toContain(
      'Text follows a retained cubic Bezier vector path; native PSD editable text-on-path export is still unsupported.',
    );

    const repeated = attachTextLayerToVectorPath(text, path, { startOffset: 12, reverse: true });
    expect(repeated.text?.pathLayout).toEqual(layout);

    const changedPath = {
      ...path,
      bitmapVersion: 10,
      metadata: {
        vectorShape: {
          ...path.metadata!.vectorShape!,
          points: [
            { x: 0, y: 72, outHandle: { x: 64, y: 144 } },
            { x: 240, y: 48, inHandle: { x: 176, y: -48 } },
          ],
        },
      },
    } satisfies ImageLayer;
    const changed = attachTextLayerToVectorPath(text, changedPath, { startOffset: 12, reverse: true });
    expect(changed.text?.pathLayout?.previewSignature).not.toBe(layout?.previewSignature);
  });

  it('fails closed for missing, degenerate, and oversized vector paths', () => {
    const text = {
      id: 'safe-text',
      name: 'Safe Text',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 8,
      y: 12,
      bitmap: null,
      bitmapVersion: 1,
      mask: null,
      text: normalizeImageTextStyle({ content: 'Safe', fontSize: 20 }),
      metadata: { editableText: true },
    } satisfies ImageLayer;
    const pathWith = (points: Array<{ x: number; y: number }>): ImageLayer => ({
      id: 'safe-path',
      name: 'Safe Path',
      type: 'vector',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 1,
      mask: null,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: Math.max(1, ...points.map((point) => point.x)),
          height: Math.max(1, ...points.map((point) => point.y)),
          points,
          closed: false,
          fillColor: 'transparent',
          fillOpacity: 0,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWidth: 1,
        },
      },
    });

    expect(attachTextLayerToVectorPath(text, { ...pathWith([{ x: 0, y: 0 }]), metadata: undefined })).toBe(text);
    expect(attachTextLayerToVectorPath(text, pathWith([{ x: 10, y: 10 }, { x: 10, y: 10 }]))).toBe(text);
    expect(attachTextLayerToVectorPath(text, pathWith([{ x: 0, y: 0 }, { x: 5000, y: 0 }]))).toBe(text);
    expect(attachTextLayerToVectorPath(text, pathWith([{ x: 0, y: 0 }, { x: 4080, y: 0 }]))).toBe(text);
    expect(attachTextLayerToVectorPath(text, pathWith([{ x: 0, y: 0 }, { x: 4037, y: 0 }]))).toBe(text);
    expect(attachTextLayerToVectorPath(text, pathWith([{ x: Number.NaN, y: 0 }, { x: 10, y: 0 }]))).toBe(text);
    expect(attachTextLayerToVectorPath(text, pathWith(Array.from({ length: 66 }, (_, index) => ({ x: index, y: 0 }))))).toBe(text);

    const boundary = attachTextLayerToVectorPath(text, pathWith([{ x: 0, y: 0 }, { x: 4036, y: 0 }]));
    expect(boundary).not.toBe(text);
    expect(boundary.bitmap?.width).toBe(4096);
    expect(Math.max(...(boundary.text?.pathLayout?.points.map((point) => point.x) ?? [])))
      .toBeLessThan(boundary.bitmap!.width);
  });

  it('rejects empty or invalid cubic input and derives persisted bounds from actual geometry', () => {
    expect(buildImageTextBezierPathLayout({ segments: [] })).toBeNull();
    expect(buildImageTextBezierPathLayout({
      segments: [{
        from: { x: 0, y: 0 },
        control1: { x: Number.NaN, y: 0 },
        control2: { x: 10, y: 0 },
        to: { x: 20, y: 0 },
      }],
    })).toBeNull();

    const repairedBounds = normalizeImageTextStyle({
      content: 'Safe bounds',
      fontSize: 20,
      pathLayout: {
        geometry: 'straight-segment-path',
        points: [{ x: 0, y: 0 }, { x: 500, y: 0 }],
        closed: false,
        startOffset: 0,
        reverse: false,
        pathLength: 500,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        previewSignature: 'untrusted',
      },
    });
    expect(repairedBounds.pathLayout?.bounds).toEqual({ x: 0, y: 0, width: 500, height: 1 });
    expect(rasterizeImageTextStyle(repairedBounds).width).toBe(560);

    const failedClosed = rasterizeImageTextStyle({
      content: 'Never fall back to point text',
      fontSize: 20,
      pathLayout: {
        geometry: 'bezier-sampled-path',
        points: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
        bezierSegments: [{
          from: { x: 0, y: 0 },
          control1: { x: Number.NaN, y: 0 },
          control2: { x: 10, y: 0 },
          to: { x: 20, y: 0 },
        }],
        closed: false,
        startOffset: 0,
        reverse: false,
        pathLength: 20,
        bounds: { x: 0, y: 0, width: 20, height: 1 },
        previewSignature: 'untrusted',
      },
    });
    expect(failedClosed.width).toBe(1);
    expect(failedClosed.height).toBe(1);

    const forgedOversize = normalizeImageTextStyle({
      content: 'Forged bounds',
      fontSize: 20,
      pathLayout: {
        geometry: 'bezier-sampled-path',
        points: [{ x: 0, y: 0 }, { x: 10_000, y: 0 }],
        closed: false,
        startOffset: 0,
        reverse: false,
        pathLength: 10_000,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        previewSignature: 'untrusted',
      },
    });
    expect(forgedOversize.pathLayout).toBeNull();
  });

  it('describes straight-segment text-on-path as retained and preview-backed without claiming native PSD type parity', () => {
    const layer = attachTextLayerToVectorPath({
      id: 'text-path',
      name: 'Text',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 0,
      mask: null,
      text: normalizeImageTextStyle({ content: 'Path Type', fontSize: 18 }),
      metadata: { editableText: true },
    } satisfies ImageLayer, {
      id: 'path-source',
      name: 'Path Source',
      type: 'vector',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 10,
      y: 20,
      bitmap: null,
      bitmapVersion: 3,
      mask: null,
      metadata: {
        vectorShape: {
          kind: 'path',
          width: 80,
          height: 20,
          points: [{ x: 0, y: 0 }, { x: 80, y: 20 }],
          closed: false,
          fillColor: 'transparent',
          fillOpacity: 0,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWidth: 1,
        },
      },
    } satisfies ImageLayer);

    const descriptor = buildImageTextLayerDescriptor(layer);

    expect(descriptor?.textOnPath).toMatchObject({
      status: 'ready',
      feature: 'text-on-path',
      textLayerId: 'text-path',
      pathLayerId: 'path-source',
      geometry: 'straight-segment-path',
      editableSource: 'retained-text-and-vector-path-reference',
      nativePsdRoundtrip: 'unsupported',
    });
    expect(descriptor?.textOnPath.warnings).toContain('native-psd-text-on-path-export-unsupported');
    expect(descriptor?.warnings).toContain('Text follows a retained straight-segment vector path; native PSD editable text-on-path export is still unsupported.');
  });

  it('describes retained text layer editability, rasterization, and font fallback persistence', () => {
    const layer = {
      id: 'text-1',
      name: 'Headline',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 10,
      y: 20,
      bitmap: rasterizeImageTextStyle({ content: 'Headline', fontSize: 20 }),
      bitmapVersion: 2,
      mask: null,
      text: normalizeImageTextStyle({
        content: 'Headline',
        fontFamily: 'Poster Font, Inter, sans-serif',
        fontSize: 20,
        fontVariantCaps: 'all-small-caps',
      }),
      metadata: { editableText: true },
    } satisfies ImageLayer;

    const descriptor = buildImageTextLayerDescriptor(layer);

    expect(descriptor).toEqual({
      layerId: 'text-1',
      editable: true,
      rasterizedPreview: true,
      bitmapVersion: 2,
      liveEditStatus: {
        status: 'retained-live-edit',
        editable: true,
        retainedMetadata: true,
        caveats: [
          'Live edits update Sloom Studio text metadata and regenerate a canvas raster preview.',
        ],
      },
      previewId: 'image-text-layer:text-1',
      previewSignature: 'image-text-layer:v1:{"layerId":"text-1","bitmapVersion":2,"styleSignature":"text:8:Poster Font, Inter, sans-serif:20:400:normal:all-small-caps:c2sc=1|smcp=1:left:1.15:auto:auto:none","rasterizedPreview":true,"editable":true}',
      preview: {
        previewId: 'image-text-style:text-1',
        contentLength: 8,
        lineCount: 1,
        signature: 'text-layer:text-1:v2:text:8:Poster Font, Inter, sans-serif:20:400:normal:all-small-caps:c2sc=1|smcp=1:left:1.15:auto:auto:none',
      },
      warnings: [
        'Canvas raster preview is regenerated from retained text metadata; exported pixels may not preserve live type editability.',
      ],
      fontPersistence: {
        requestedFamily: 'Poster Font, Inter, sans-serif',
        preferredFamily: 'Poster Font',
        fallbackFamilies: ['Inter', 'sans-serif'],
        discoveryStatus: 'fallback-stack-recorded',
        fallbackStatus: 'fallbacks-available',
        persistenceNote: 'Persist the full font-family stack; browser canvas may render with the first installed fallback.',
      },
      fontDiscovery: {
        status: 'fallback-stack-recorded',
        requestedFamily: 'Poster Font, Inter, sans-serif',
        preferredFamily: 'Poster Font',
        fallbackFamilies: ['Inter', 'sans-serif'],
        warning: 'Browser canvas font resolution is environment-dependent; keep the full stack for deterministic metadata.',
      },
      openTypeSupport: {
        status: 'supported-subset',
        supportedTags: ['c2sc', 'smcp'],
        unsupportedTags: [],
        css: "'c2sc' 1, 'smcp' 1",
      },
      textOnPath: {
        status: 'unsupported',
        feature: 'text-on-path',
        textLayerId: 'text-1',
        pathLayerId: null,
        pathReference: null,
        startOffset: 0,
        reverse: false,
        fallback: 'retain point text metadata and rasterize current glyph layout',
        requiredMetadata: ['textLayerId', 'pathReference.kind', 'pathReference.layerId'],
        reason: 'Sloom Studio does not support editable text-on-path layers yet.',
        warnings: [
          'Editable text-on-path is not available; preserve the path reference so a future text engine can restore intent.',
        ],
      },
      rasterPreview: {
        status: 'rasterized-from-retained-text',
        editableSource: 'retained-text-style',
        caveat: 'Preview pixels are rasterized for canvas/export and are not native editable glyph outlines.',
      },
      nativePsdTextRoundtrip: {
        status: 'limited',
        warningCode: 'native-psd-editable-text-subset',
        message: 'PSD export writes native editable records for ordinary horizontal unwarped solid-colour text; path, vertical, warped, masked, effected, and unsupported-style text remains raster fallback with retained Sloom Studio metadata.',
      },
    });

    expect(describeImageTextFontPersistence('Inter')).toEqual({
      requestedFamily: 'Inter',
      preferredFamily: 'Inter',
      fallbackFamilies: [],
      discoveryStatus: 'fallback-stack-recorded',
      fallbackStatus: 'no-fallbacks-declared',
      persistenceNote: 'Persist the full font-family stack; browser canvas may render with the first installed fallback.',
    });
    expect(buildImageTextFontFallbackSignature(describeImageTextFontPersistence('Poster Font, Inter, sans-serif'))).toBe(
      'image-text-font-fallback:v1:{"requestedFamily":"Poster Font, Inter, sans-serif","preferredFamily":"Poster Font","fallbackFamilies":["Inter","sans-serif"],"fallbackStatus":"fallbacks-available","discoveryStatus":"fallback-stack-recorded"}',
    );
    expect(buildImageTextNativeExportStateSignature(descriptor!.nativePsdTextRoundtrip)).toBe(
      'image-text-native-export:v1:{"status":"limited","warningCode":"native-psd-editable-text-subset"}',
    );
  });

  it('describes inspectable typography support matrix and explicit unsupported capability states', () => {
    const layers = [
      {
        id: 'title',
        name: 'Title',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'AI title', fontSize: 20 }),
        bitmapVersion: 3,
        mask: null,
        text: normalizeImageTextStyle({
          content: 'AI title',
          fontFamily: 'Poster Font, Inter, sans-serif',
          fontSize: 32,
          openTypeFeatures: {
            enabled: ['ss01', 'bad-tag!'],
            disabled: ['liga'],
          },
          warp: 'arc',
        }),
        metadata: { editableText: true },
      },
    ] satisfies ImageLayer[];

    const matrix = describeImageTextTypographySupportMatrix(layers);

    expect(matrix.summary).toEqual({
      ready: 11,
      limited: 6,
      unsupported: 0,
    });
    expect(matrix.capabilities.map((capability) => [capability.id, capability.status])).toEqual([
      ['live-text-editing', 'ready'],
      ['character-options', 'ready'],
      ['paragraph-options', 'ready'],
      ['style-package-signatures', 'ready'],
      ['text-preview-signatures', 'limited'],
      ['font-fallback-persistence', 'limited'],
      ['installed-font-browsing', 'ready'],
      ['opentype-feature-intent', 'limited'],
      ['advanced-shaping', 'ready'],
      ['find-replace', 'ready'],
      ['readability-diagnostics', 'limited'],
      ['dictionary-backed-spellcheck', 'ready'],
      ['straight-segment-text-on-path', 'limited'],
      ['bezier-text-on-path-editing', 'ready'],
      ['vertical-type', 'ready'],
      ['editable-text-warp', 'ready'],
      ['native-psd-editable-text-export', 'limited'],
    ]);
    expect(matrix.capabilities.find((capability) => capability.id === 'installed-font-browsing')).toMatchObject({
      implemented: true,
      caveats: ['Local Font Access is optional; standard stack fallback remains available when native font enumeration is unavailable.'],
    });
    expect(matrix.capabilities.find((capability) => capability.id === 'native-psd-editable-text-export')?.signature).toBe(
      'image-text-typography-capability:v1:{"id":"native-psd-editable-text-export","status":"limited","implemented":true,"blockerCode":null}',
    );
    expect(matrix.previewSignature).toBe(
      'image-text-typography-support-matrix:v1:{"layerIds":["title"],"capabilities":[["live-text-editing","ready"],["character-options","ready"],["paragraph-options","ready"],["style-package-signatures","ready"],["text-preview-signatures","limited"],["font-fallback-persistence","limited"],["installed-font-browsing","ready"],["opentype-feature-intent","limited"],["advanced-shaping","ready"],["find-replace","ready"],["readability-diagnostics","limited"],["dictionary-backed-spellcheck","ready"],["straight-segment-text-on-path","limited"],["bezier-text-on-path-editing","ready"],["vertical-type","ready"],["editable-text-warp","ready"],["native-psd-editable-text-export","limited"]],"summary":{"ready":11,"limited":6,"unsupported":0}}',
    );
  });

  it('supports the completed Text tool atoms: installed fonts, dictionary spellcheck, shaping, vertical type, Bezier paths, and editable warps', () => {
    const bezierLayout = buildImageTextBezierPathLayout({
      sourceLayerId: 'curve-path',
      samples: 16,
      startOffset: 6,
      reverse: false,
      segments: [
        {
          from: { x: 0, y: 48 },
          control1: { x: 60, y: -24 },
          control2: { x: 160, y: 96 },
          to: { x: 240, y: 32 },
        },
      ],
    });
    expect(bezierLayout).not.toBeNull();
    if (!bezierLayout) throw new Error('Expected valid Bezier layout.');
    const layers = [
      {
        id: 'vertical-title',
        name: 'Vertical Title',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({
          content: '魔法',
          fontSize: 32,
          orientation: 'vertical-rl',
        }),
        bitmapVersion: 1,
        mask: null,
        text: normalizeImageTextStyle({
          content: 'Leylinee firewall',
          fontFamily: 'Atkinson Hyperlegible, Inter, sans-serif',
          fontSize: 32,
          orientation: 'vertical-rl',
          warp: 'arc',
        }),
        metadata: { editableText: true },
      },
      {
        id: 'curve-caption',
        name: 'Curve Caption',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 80,
        bitmap: null,
        bitmapVersion: 2,
        mask: null,
        text: normalizeImageTextStyle({
          content: 'Signal Loom',
          fontSize: 28,
          pathReference: {
            kind: 'vector-layer',
            layerId: 'curve-path',
            pathId: 'Bezier Caption Path',
            revision: 4,
          },
          pathLayout: bezierLayout,
        }),
        metadata: { editableText: true },
      },
    ] satisfies ImageLayer[];

    const spellcheck = planImageTextDictionarySpellcheck(layers, {
      dictionary: ['leyline', 'firewall', 'signal', 'loom'],
    });
    const support = describeImageTextAdvancedTypographySupport(layers, {
      selectedFontFamily: 'Atkinson Hyperlegible, Inter, sans-serif',
      installedFonts: [
        {
          family: 'Atkinson Hyperlegible',
          fullName: 'Atkinson Hyperlegible Regular',
          postscriptName: 'AtkinsonHyperlegible-Regular',
          style: 'Regular',
        },
      ],
      dictionary: ['leyline', 'firewall', 'signal', 'loom'],
    });
    const matrix = describeImageTextTypographySupportMatrix(layers);
    const verticalBitmap = rasterizeImageTextStyle({
      content: 'AB',
      fontSize: 20,
      orientation: 'vertical-rl',
    });
    const verticalContext = (verticalBitmap as unknown as FakeOffscreenCanvas).context;

    expect(bezierLayout.geometry).toBe('bezier-sampled-path');
    expect(bezierLayout.bezierSegments).toHaveLength(1);
    expect(bezierLayout.points).toHaveLength(17);
    expect(spellcheck.status).toBe('ready');
    expect(spellcheck.misspellings).toEqual([
      {
        word: 'Leylinee',
        normalized: 'leylinee',
        layerIds: ['vertical-title'],
        suggestions: ['leyline'],
      },
    ]);
    expect(support).toMatchObject({
      descriptorId: 'image-text-advanced-typography-support:v1',
      installedFonts: {
        supported: true,
        source: 'local-font-access-api-or-injected-font-list',
        selectedFamilyAvailable: true,
      },
      fontBrowser: {
        supported: true,
      },
      dictionarySpellcheck: {
        supported: true,
        status: 'ready',
        misspellingCount: 1,
      },
      advancedShaping: {
        supported: true,
        engine: 'browser-canvas-intl-segmenter',
      },
      verticalType: {
        supported: true,
        layerIds: ['vertical-title'],
      },
      bezierTextOnPath: {
        supported: true,
        layerIds: ['curve-caption'],
      },
      editableTextWarp: {
        supported: true,
        layerIds: ['vertical-title'],
      },
    });
    expect(matrix.capabilities.map((capability) => [capability.id, capability.status])).toEqual([
      ['live-text-editing', 'ready'],
      ['character-options', 'ready'],
      ['paragraph-options', 'ready'],
      ['style-package-signatures', 'ready'],
      ['text-preview-signatures', 'limited'],
      ['font-fallback-persistence', 'limited'],
      ['installed-font-browsing', 'ready'],
      ['opentype-feature-intent', 'limited'],
      ['advanced-shaping', 'ready'],
      ['find-replace', 'ready'],
      ['readability-diagnostics', 'limited'],
      ['dictionary-backed-spellcheck', 'ready'],
      ['straight-segment-text-on-path', 'limited'],
      ['bezier-text-on-path-editing', 'ready'],
      ['vertical-type', 'ready'],
      ['editable-text-warp', 'ready'],
      ['native-psd-editable-text-export', 'limited'],
    ]);
    expect(verticalBitmap.height).toBeGreaterThan(verticalBitmap.width);
    expect(verticalContext.fills.map((fill) => fill.text)).toEqual(['A', 'B']);
  });

  it('renders explicit vertical Japanese columns in source order with distinct RL and LR progression', () => {
    const shared = {
      content: '日本\n縦書',
      fontSize: 20,
      lineHeight: 1,
      boxWidth: 100,
      boxHeight: 60,
    } as const;
    const rightToLeft = rasterizeImageTextStyle({ ...shared, orientation: 'vertical-rl' });
    const leftToRight = rasterizeImageTextStyle({ ...shared, orientation: 'vertical-lr' });
    const rlFills = (rightToLeft as unknown as FakeOffscreenCanvas).context.fills;
    const lrFills = (leftToRight as unknown as FakeOffscreenCanvas).context.fills;

    expect([rightToLeft.width, rightToLeft.height]).toEqual([100, 60]);
    expect([leftToRight.width, leftToRight.height]).toEqual([100, 60]);
    expect(rlFills.map((fill) => fill.text)).toEqual(['日', '本', '縦', '書']);
    expect(lrFills.map((fill) => fill.text)).toEqual(['日', '本', '縦', '書']);
    expect(rlFills.map((fill) => [fill.x, fill.y])).toEqual([
      [90, 10], [90, 30], [70, 10], [70, 30],
    ]);
    expect(lrFills.map((fill) => [fill.x, fill.y])).toEqual([
      [10, 10], [10, 30], [30, 10], [30, 30],
    ]);
    expect(serializeImageTextParagraphStyle(normalizeImageTextStyle({
      ...shared,
      orientation: 'vertical-rl',
    }))).toMatchObject({ orientation: 'vertical-rl' });
  });

  it('wraps a vertical source column by box height without reordering Unicode graphemes', () => {
    const bitmap = rasterizeImageTextStyle({
      content: '日😀本語縦',
      fontSize: 20,
      lineHeight: 1,
      boxWidth: 100,
      boxHeight: 40,
      wrap: true,
      orientation: 'vertical-rl',
    });
    const fills = (bitmap as unknown as FakeOffscreenCanvas).context.fills;

    expect(fills.map((fill) => fill.text)).toEqual(['日', '😀', '本', '語', '縦']);
    expect(fills.map((fill) => fill.x)).toEqual([90, 90, 70, 70, 50]);
    expect(fills.map((fill) => fill.y)).toEqual([10, 30, 10, 30, 10]);
  });

  it('rejects unsafe text raster dimensions and pixel counts before allocating a canvas', () => {
    let allocations = 0;
    class AllocationSpyCanvas extends FakeOffscreenCanvas {
      constructor(width: number, height: number) {
        allocations += 1;
        super(width, height);
      }
    }
    globalThis.OffscreenCanvas = AllocationSpyCanvas as unknown as typeof OffscreenCanvas;

    expect(() => assertImageTextRasterAllocation(IMAGE_TEXT_RASTER_MAX_DIMENSION + 1, 1))
      .toThrow(ImageTextRasterBudgetError);
    expect(() => rasterizeImageTextStyle({
      content: '幅',
      fontSize: 20,
      orientation: 'vertical-lr',
      boxWidth: IMAGE_TEXT_RASTER_MAX_DIMENSION + 1,
      boxHeight: 1,
    })).toThrow(ImageTextRasterBudgetError);
    expect(() => rasterizeImageTextStyle({
      content: '巨大',
      fontSize: 20,
      orientation: 'vertical-rl',
      boxWidth: IMAGE_TEXT_RASTER_MAX_DIMENSION,
      boxHeight: IMAGE_TEXT_RASTER_MAX_DIMENSION,
    })).toThrow(expect.objectContaining({
      code: 'IMAGE_TEXT_RASTER_BUDGET_EXCEEDED',
      pixelCount: IMAGE_TEXT_RASTER_MAX_DIMENSION ** 2,
      maxPixels: IMAGE_TEXT_RASTER_MAX_PIXELS,
    }));
    expect(allocations).toBe(0);
  });

  it('builds preset descriptors with serialized style helpers for professional typography planning', () => {
    const descriptor = buildImageTextStylePresetDescriptor(
      normalizeImageTextStyle({
        content: 'Credits',
        color: '#fefefe',
      }),
      'captionSmallCaps',
    );

    expect(descriptor).toEqual({
      presetId: 'captionSmallCaps',
      label: 'Caption Caps',
      previewId: 'image-text-style-preset:captionSmallCaps',
      previewSignature: 'image-text-style-preset:v1:{"presetId":"captionSmallCaps","label":"Caption Caps","styleSignature":"text:7:Inter, system-ui, sans-serif:28:700:normal:all-small-caps:c2sc=1|smcp=1:left:1.18:auto:auto:none"}',
      characterStyle: {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 28,
        fontWeight: '700',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'all-small-caps',
        letterSpacing: 1.5,
        baselineShift: 0,
        openTypeFeatures: {
          enabled: ['c2sc', 'smcp'],
          disabled: [],
          css: "'c2sc' 1, 'smcp' 1",
        },
      },
      paragraphStyle: {
        align: 'left',
        lineHeight: 1.18,
        verticalAlign: 'top',
        wrap: true,
        boxWidth: null,
        boxHeight: null,
      },
      portability: {
        status: 'portable-with-font-fallbacks',
        preserves: ['font-family-stack', 'character-style', 'paragraph-style', 'opentype-feature-intent'],
        caveats: [
          'Preset portability depends on installed fonts; fallback family stack is retained.',
          'Native PSD editable text preset roundtrip is not supported.',
        ],
      },
    });
  });

  it('resolves in-canvas text edit bounds and hit testing for retained text layers', () => {
    const layer = {
      id: 'text-1',
      name: 'Title',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 20,
      y: 30,
      bitmap: rasterizeImageTextStyle({ content: 'Edit me', fontSize: 20 }),
      bitmapVersion: 0,
      mask: null,
      text: normalizeImageTextStyle({ content: 'Edit me', fontSize: 20 }),
      metadata: { editableText: true },
    } satisfies ImageLayer;

    expect(imageTextLayerContainsPoint(layer, { x: 25, y: 35 })).toBe(true);
    expect(imageTextLayerContainsPoint(layer, { x: 5, y: 35 })).toBe(false);

    const bounds = getImageTextEditOverlayBounds(layer, { zoom: 2, panX: 10, panY: 5 });

    expect(bounds).toMatchObject({
      x: 50,
      y: 65,
      rotationDeg: 0,
    });
    expect(bounds?.width).toBeGreaterThanOrEqual(36);
    expect(bounds?.height).toBeGreaterThanOrEqual(24);
  });

  it('rotates the text edit overlay bounds around the view center under canvas view rotation', () => {
    const layer = {
      id: 'text-layer',
      name: 'Text',
      type: 'image' as const,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal' as const,
      x: 20,
      y: 30,
      bitmap: rasterizeImageTextStyle({ content: 'Edit me at a comfortable size', fontSize: 72 }),
      bitmapVersion: 0,
      mask: null,
      text: normalizeImageTextStyle({ content: 'Edit me at a comfortable size', fontSize: 72 }),
      metadata: { editableText: true },
    } satisfies ImageLayer;

    const view = { width: 800, height: 600 };
    const upright = getImageTextEditOverlayBounds(layer, { zoom: 1, panX: 0, panY: 0 }, view);
    const rotated = getImageTextEditOverlayBounds(
      layer,
      { zoom: 1, panX: 0, panY: 0, rotationDeg: 180 },
      view,
    );

    expect(upright).not.toBeNull();
    expect(rotated).not.toBeNull();
    // At 180 degrees around the view center (400, 300), the doc-space rect (20, 30, w, h)
    // maps onto (780 - w, 570 - h, w, h): sizes match the upright box and the far edges land
    // exactly on the rotated origin corner (780, 570). Font size 72 keeps both dimensions
    // above the overlay's 36x24 clamps so the sizes are the true rasterized extents.
    expect(rotated?.width).toBeCloseTo(upright?.width ?? -1, 6);
    expect(rotated?.height).toBeCloseTo(upright?.height ?? -1, 6);
    expect((rotated?.x ?? 0) + (rotated?.width ?? 0)).toBeCloseTo(780, 6);
    expect((rotated?.y ?? 0) + (rotated?.height ?? 0)).toBeCloseTo(570, 6);
  });

  it('plans deterministic find and replace across retained text layers while skipping rasterized layers', () => {
    const layers = [
      {
        id: 'title',
        name: 'Title',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'AI poster AI', fontSize: 20 }),
        bitmapVersion: 1,
        mask: null,
        text: normalizeImageTextStyle({ content: 'AI poster AI', fontSize: 20 }),
        metadata: { editableText: true },
      },
      {
        id: 'caption',
        name: 'Caption',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 24,
        bitmap: rasterizeImageTextStyle({ content: 'plain ai and braid', fontSize: 16 }),
        bitmapVersion: 2,
        mask: null,
        text: normalizeImageTextStyle({ content: 'plain ai and braid', fontSize: 16 }),
        metadata: { editableText: true },
      },
      {
        id: 'pixels',
        name: 'Flattened lettering',
        type: 'image',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'AI pixels', fontSize: 20 }),
        bitmapVersion: 0,
        mask: null,
      },
    ] satisfies ImageLayer[];

    const plan = planImageTextFindReplace(layers, {
      find: 'AI',
      replace: 'Signal',
      caseSensitive: false,
      wholeWord: true,
    });

    expect(plan).toEqual({
      query: 'AI',
      replacement: 'Signal',
      caseSensitive: false,
      wholeWord: true,
      affectedLayerIds: ['title', 'caption'],
      searchableTextLayers: [
        { layerId: 'title', name: 'Title', contentLength: 12, lineCount: 1, editable: true },
        { layerId: 'caption', name: 'Caption', contentLength: 18, lineCount: 1, editable: true },
      ],
      proposedReplacements: [
        {
          layerId: 'title',
          matchCount: 2,
          originalContent: 'AI poster AI',
          proposedContent: 'Signal poster Signal',
        },
        {
          layerId: 'caption',
          matchCount: 1,
          originalContent: 'plain ai and braid',
          proposedContent: 'plain Signal and braid',
        },
      ],
      skippedLayers: [
        {
          layerId: 'pixels',
          name: 'Flattened lettering',
          reason: 'non-text-or-rasterized-layer',
        },
      ],
      unsupportedStates: [],
      previewSignature: 'image-text-find-replace:v1:{"query":"AI","replacement":"Signal","caseSensitive":false,"wholeWord":true,"affectedLayerIds":["title","caption"],"proposals":[["title",2,"Signal poster Signal"],["caption",1,"plain Signal and braid"]],"skippedLayerIds":["pixels"]}',
    });
  });

  it('applies find and replace as a pure retained text layer update', () => {
    const textLayer = {
      id: 'title',
      name: 'Title',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: rasterizeImageTextStyle({ content: 'draft title', fontSize: 20 }),
      bitmapVersion: 3,
      mask: null,
      text: normalizeImageTextStyle({ content: 'draft title', fontSize: 20 }),
      metadata: { editableText: true },
    } satisfies ImageLayer;
    const rasterLayer = {
      id: 'pixels',
      name: 'Pixels',
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: rasterizeImageTextStyle({ content: 'draft pixels', fontSize: 20 }),
      bitmapVersion: 0,
      mask: null,
    } satisfies ImageLayer;

    const result = applyImageTextFindReplace([textLayer, rasterLayer], {
      find: 'draft',
      replace: 'final',
      caseSensitive: true,
    });

    expect(result.plan.affectedLayerIds).toEqual(['title']);
    expect(result.layers[0]).not.toBe(textLayer);
    expect(result.layers[0].text?.content).toBe('final title');
    expect(result.layers[0].bitmapVersion).toBe(4);
    expect(result.layers[1]).toBe(rasterLayer);
  });

  it('plans spellcheck and readability without claiming dictionary support', () => {
    const layers = [
      {
        id: 'headline',
        name: 'Headline',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: null,
        bitmapVersion: 0,
        mask: null,
        text: normalizeImageTextStyle({ content: 'Short line.\nLonger readable caption here.', fontSize: 24 }),
        metadata: { editableText: true },
      },
      {
        id: 'flattened',
        name: 'Flattened',
        type: 'image',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'Flattened typo', fontSize: 20 }),
        bitmapVersion: 0,
        mask: null,
      },
    ] satisfies ImageLayer[];

    expect(planImageTextSpellcheckReadability(layers)).toEqual({
      affectedLayerIds: ['headline'],
      searchableTextLayers: [
        { layerId: 'headline', name: 'Headline', contentLength: 41, lineCount: 2, editable: true },
      ],
      skippedLayers: [
        {
          layerId: 'flattened',
          name: 'Flattened',
          reason: 'non-text-or-rasterized-layer',
        },
      ],
      readability: {
        characterCount: 41,
        wordCount: 6,
        sentenceCount: 2,
        averageWordsPerSentence: 3,
        longestLineLength: 29,
      },
      unsupportedStates: [],
      previewSignature: 'image-text-spellcheck-readability:v1:{"affectedLayerIds":["headline"],"readability":{"characterCount":41,"wordCount":6,"sentenceCount":2,"averageWordsPerSentence":3,"longestLineLength":29},"skippedLayerIds":["flattened"]}',
    });
  });

  it('describes export and source-bin handoff caveats for retained typography layers', () => {
    const layers = [
      {
        id: 'title',
        name: 'Title',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'Poster Title', fontSize: 20 }),
        bitmapVersion: 4,
        mask: null,
        text: normalizeImageTextStyle({
          content: 'Poster Title',
          fontFamily: 'Poster Font, Inter, sans-serif',
          fontSize: 48,
          openTypeFeatures: {
            enabled: ['salt', 'badtag'],
            disabled: [],
          },
          pathReference: {
            kind: 'vector-layer',
            layerId: 'title-path',
            pathId: 'Poster Arc',
            revision: 2,
          },
          pathLayout: {
            sourceLayerId: 'title-path',
            points: [{ x: 0, y: 12 }, { x: 240, y: 0 }],
            bounds: { x: 0, y: 0, width: 240, height: 12 },
            pathLength: 240.3,
            startOffset: 10,
            reverse: false,
            closed: false,
            previewSignature: 'path:title-path:v2',
          },
        }),
        metadata: { editableText: true },
      },
      {
        id: 'pixels',
        name: 'Flattened Letters',
        type: 'image',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'Pixels', fontSize: 20 }),
        bitmapVersion: 1,
        mask: null,
      },
    ] satisfies ImageLayer[];

    expect(buildImageTextExportSourceBinHandoffDescriptor(layers)).toEqual({
      status: 'limited',
      retainedTextLayerIds: ['title'],
      flattenedLayerIds: ['pixels'],
      exportRoute: {
        target: 'visible-raster-export',
        preservesEditableText: false,
        preservesStylePackage: true,
        sourceBinPayload: 'flattened-preview-with-signal-loom-text-metadata',
      },
      caveats: [
        {
          code: 'export-flattens-live-type',
          scope: 'export',
          layerIds: ['title'],
          message: 'Visible image exports and source-bin thumbnails flatten text to pixels; Sloom Studio text metadata must travel as sidecar project data to stay editable.',
        },
        {
          code: 'font-fallback-on-reopen',
          scope: 'source-bin',
          layerIds: ['title'],
          message: 'Source-bin handoff retains font-family stacks, but reopened previews may resolve to installed fallbacks.',
        },
        {
          code: 'opentype-support-on-reopen',
          scope: 'source-bin',
          layerIds: ['title'],
          message: 'OpenType feature intent is serialized, but glyph support after handoff depends on the resolved font.',
        },
        {
          code: 'text-on-path-style-handoff',
          scope: 'source-bin',
          layerIds: ['title'],
          message: 'Text-on-path handoff keeps the vector path reference and text style metadata, but exported/source-bin previews flatten the current glyph layout to pixels.',
        },
        {
          code: 'flattened-text-not-recoverable',
          scope: 'source-bin',
          layerIds: ['pixels'],
          message: 'Flattened lettering without retained text metadata cannot be recovered as editable text from source-bin assets.',
        },
      ],
      previewSignature: 'image-text-export-source-bin-handoff:v1:{"status":"limited","retainedTextLayerIds":["title"],"flattenedLayerIds":["pixels"],"caveatCodes":["export-flattens-live-type","font-fallback-on-reopen","opentype-support-on-reopen","text-on-path-style-handoff","flattened-text-not-recoverable"]}',
    });
  });

  it('describes typography readiness with retained editability, style packages, caveats, and operation signatures', () => {
    const layers = [
      {
        id: 'title',
        name: 'Title',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'AI title', fontSize: 20 }),
        bitmapVersion: 5,
        mask: null,
        text: normalizeImageTextStyle({
          content: 'AI title',
          fontFamily: 'Poster Font, Inter, sans-serif',
          fontSize: 40,
          fontVariantCaps: 'small-caps',
          warp: 'arc',
          openTypeFeatures: {
            enabled: ['smcp', 'salt', 'xxxxxx'],
            disabled: ['liga'],
          },
        }),
        metadata: { editableText: true },
      },
      {
        id: 'locked-caption',
        name: 'Locked Caption',
        type: 'text',
        visible: true,
        locked: true,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 52,
        bitmap: null,
        bitmapVersion: 1,
        mask: null,
        text: normalizeImageTextStyle({ content: 'AI caption', fontSize: 22 }),
        metadata: { editableText: true },
      },
      {
        id: 'native-only',
        name: 'Native-only Text',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 90,
        bitmap: null,
        bitmapVersion: 0,
        mask: null,
        text: normalizeImageTextStyle({ content: 'Preserved PSD text', fontSize: 18 }),
        metadata: { editableText: false },
      },
      {
        id: 'pixels',
        name: 'Flattened lettering',
        type: 'image',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'AI pixels', fontSize: 20 }),
        bitmapVersion: 0,
        mask: null,
      },
    ] satisfies ImageLayer[];

    const readiness = describeImageTextTypographyReadiness(layers, {
      findReplace: {
        find: 'AI',
        replace: 'Signal',
        wholeWord: true,
      },
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.layerReadiness.map((layer) => [layer.layerId, layer.status, layer.retainedEditability.status])).toEqual([
      ['title', 'limited', 'retained-live-edit'],
      ['locked-caption', 'blocked', 'retained-live-edit'],
      ['native-only', 'blocked', 'metadata-only'],
      ['pixels', 'blocked', 'not-editable'],
    ]);
    expect(readiness.layerReadiness[0]).toMatchObject({
      layerId: 'title',
      stylePackage: {
        warnings: [
          'OpenType feature tags must be exactly four alphanumeric characters; unsupported tags were ignored: xxxxxx.',
          'Arc, flag, and bulge text warps are rasterized approximations and are not editable vector type.',
        ],
        preview: {
          signature: 'text:8:Poster Font, Inter, sans-serif:40:400:normal:small-caps:liga=0|salt=1|smcp=1:left:1.15:auto:auto:arc',
        },
      },
      fontPersistence: {
        preferredFamily: 'Poster Font',
        fallbackFamilies: ['Inter', 'sans-serif'],
        fallbackStatus: 'fallbacks-available',
      },
      openTypeSupport: {
        status: 'unsupported-tags-ignored',
        supportedTags: ['liga', 'salt', 'smcp'],
        unsupportedTags: ['xxxxxx'],
      },
      nativePsdTextWarning: {
        status: 'limited',
        warningCode: 'native-psd-editable-text-subset',
      },
      previewSignature: 'image-text-readiness-layer:v1:{"layerId":"title","status":"limited","retained":true,"editable":true,"locked":false,"bitmapVersion":5,"styleSignature":"text:8:Poster Font, Inter, sans-serif:40:400:normal:small-caps:liga=0|salt=1|smcp=1:left:1.15:auto:auto:arc","blockerCodes":[],"warningCodes":["raster-preview-only","font-fallback-stack-recorded","opentype-unsupported-tags-ignored","opentype-feature-caveat","text-warp-rasterized","native-psd-editable-text-subset"]}',
    });
    expect(readiness.operations.findReplace).toMatchObject({
      status: 'ready',
      affectedLayerIds: ['title', 'locked-caption'],
      previewSignature: 'image-text-find-replace:v1:{"query":"AI","replacement":"Signal","caseSensitive":false,"wholeWord":true,"affectedLayerIds":["title","locked-caption"],"proposals":[["title",1,"Signal title"],["locked-caption",1,"Signal caption"]],"skippedLayerIds":["native-only","pixels"]}',
    });
    expect(readiness.operations.spellcheckReadability).toMatchObject({
      status: 'ready',
      affectedLayerIds: ['title', 'locked-caption'],
      readability: {
        characterCount: 19,
        wordCount: 4,
        sentenceCount: 1,
        averageWordsPerSentence: 4,
        longestLineLength: 10,
      },
    });
    expect(readiness.operations.nativePsdText).toEqual({
      status: 'limited',
      warningCode: 'native-psd-editable-text-subset',
      affectedLayerIds: ['title', 'locked-caption', 'native-only'],
      message: 'PSD-native text records are available for the bounded horizontal unwarped solid-colour subset; other retained text uses raster fallback plus Sloom Studio metadata.',
    });
    expect(readiness.blockers).toEqual([
      {
        code: 'locked-layer',
        scope: 'layer',
        layerId: 'locked-caption',
        message: 'Layer is locked; retained text edits must be unblocked before mutation.',
      },
      {
        code: 'non-editable-text-metadata',
        scope: 'layer',
        layerId: 'native-only',
        message: 'Layer has retained text metadata but is marked non-editable.',
      },
      {
        code: 'missing-retained-text',
        scope: 'layer',
        layerId: 'pixels',
        message: 'Layer does not retain editable Sloom Studio text metadata.',
      },
    ]);
    expect(readiness.warnings.map((warning) => warning.code)).toEqual([
      'raster-preview-only',
      'font-fallback-stack-recorded',
      'opentype-unsupported-tags-ignored',
      'opentype-feature-caveat',
      'text-warp-rasterized',
      'native-psd-editable-text-subset',
      'missing-raster-preview',
      'native-psd-editable-text-subset',
      'missing-raster-preview',
      'native-psd-editable-text-subset',
    ]);
    expect(readiness.previewSignature).toBe(
      'image-text-typography-readiness:v1:{"status":"blocked","layerStatuses":[["title","limited"],["locked-caption","blocked"],["native-only","blocked"],["pixels","blocked"]],"blockerCodes":["locked-layer","non-editable-text-metadata","missing-retained-text"],"warningCodes":["raster-preview-only","font-fallback-stack-recorded","opentype-unsupported-tags-ignored","opentype-feature-caveat","text-warp-rasterized","native-psd-editable-text-subset","missing-raster-preview","native-psd-editable-text-subset","missing-raster-preview","native-psd-editable-text-subset"],"findReplace":"image-text-find-replace:v1:{\\"query\\":\\"AI\\",\\"replacement\\":\\"Signal\\",\\"caseSensitive\\":false,\\"wholeWord\\":true,\\"affectedLayerIds\\":[\\"title\\",\\"locked-caption\\"],\\"proposals\\":[[\\"title\\",1,\\"Signal title\\"],[\\"locked-caption\\",1,\\"Signal caption\\"]],\\"skippedLayerIds\\":[\\"native-only\\",\\"pixels\\"]}","spellcheckReadability":"image-text-spellcheck-readability:v1:{\\"affectedLayerIds\\":[\\"title\\",\\"locked-caption\\"],\\"readability\\":{\\"characterCount\\":19,\\"wordCount\\":4,\\"sentenceCount\\":1,\\"averageWordsPerSentence\\":4,\\"longestLineLength\\":10},\\"skippedLayerIds\\":[\\"native-only\\",\\"pixels\\"]}"}',
    );
  });

  it('aggregates Photoshop and GIMP typography parity progress checks with stable signatures', () => {
    const layers = [
      {
        id: 'title',
        name: 'Title',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'AI title', fontSize: 20 }),
        bitmapVersion: 6,
        mask: null,
        text: normalizeImageTextStyle({
          content: 'AI title',
          fontFamily: 'Poster Font, Inter, sans-serif',
          fontSize: 44,
          openTypeFeatures: {
            enabled: ['salt', 'bad-tag!'],
            disabled: ['liga'],
          },
          pathReference: {
            kind: 'vector-layer',
            layerId: 'title-path',
            pathId: 'Title Path',
            revision: 2,
          },
          pathLayout: {
            sourceLayerId: 'title-path',
            points: [{ x: 0, y: 16 }, { x: 220, y: 0 }],
            bounds: { x: 0, y: 0, width: 220, height: 16 },
            pathLength: 220.58,
            startOffset: 8,
            reverse: false,
            closed: false,
            previewSignature: 'path:title-path:v2',
          },
        }),
        metadata: { editableText: true },
      },
      {
        id: 'caption',
        name: 'Caption',
        type: 'text',
        visible: true,
        locked: true,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 48,
        bitmap: null,
        bitmapVersion: 1,
        mask: null,
        text: normalizeImageTextStyle({ content: 'AI caption', fontFamily: 'Inter, system-ui, sans-serif', fontSize: 22 }),
        metadata: { editableText: true },
      },
    ] satisfies ImageLayer[];

    const progress = describeImageTextTypographyParityProgress(layers, {
      findReplace: {
        find: 'AI',
        replace: 'Signal',
        wholeWord: true,
      },
    });

    expect(progress.checks.map((check) => [check.id, check.status])).toEqual([
      ['live-edit-readiness', 'blocked'],
      ['font-fallback-persistence', 'limited'],
      ['opentype-unsupported-states', 'limited'],
      ['style-package-metadata', 'ready'],
      ['text-on-path-caveats', 'limited'],
      ['find-replace-planning', 'ready'],
      ['spellcheck-readability-planning', 'ready'],
      ['stable-signatures', 'ready'],
    ]);
    expect(progress.checks.find((check) => check.id === 'live-edit-readiness')).toMatchObject({
      evidence: ['Editable retained layers: title, caption', 'Blocked retained layers: caption'],
      caveats: ['Layer is locked; retained text edits must be unblocked before mutation.'],
    });
    expect(progress.checks.find((check) => check.id === 'font-fallback-persistence')).toMatchObject({
      evidence: [
        'title: Poster Font -> Inter, sans-serif',
        'caption: Inter -> system-ui, sans-serif',
      ],
      caveats: [
        'Installed-font discovery is unsupported; persisted font-family stacks are metadata only.',
      ],
    });
    expect(progress.checks.find((check) => check.id === 'opentype-unsupported-states')).toMatchObject({
      evidence: ['title: supported liga, salt; unsupported badtag', 'caption: default features'],
      caveats: [
        'Unsupported OpenType feature tags are ignored instead of being applied to canvas text.',
        'OpenType glyph availability depends on the resolved font fallback.',
      ],
    });
    expect(progress.checks.find((check) => check.id === 'style-package-metadata')).toMatchObject({
      evidence: ['Character and paragraph packages: title, caption'],
      caveats: ['Style packages are Sloom Studio metadata and do not create native PSD editable text records.'],
    });
    expect(progress.checks.find((check) => check.id === 'text-on-path-caveats')).toMatchObject({
      evidence: ['Retained straight text path metadata: title'],
      caveats: [
        'Text-on-path exports flatten current glyph layout to pixels; native PSD editable text-on-path remains unsupported.',
        'Curved Bezier text-on-path editing uses retained cubic controls plus sampled glyph baselines for canvas preview/export.',
      ],
    });
    expect(progress.stableSignatures.checks).toHaveLength(8);
    expect(new Set(progress.stableSignatures.checks).size).toBe(8);
    expect(progress.previewSignature).toBe(describeImageTextTypographyParityProgress(layers, {
      findReplace: {
        find: 'AI',
        replace: 'Signal',
        wholeWord: true,
      },
    }).previewSignature);
    expect(progress.previewSignature).toContain('image-text-typography-parity-progress:v1:');
  });

  it('reports an operation blocker when find/replace has no query but readability remains planned', () => {
    const layers = [
      {
        id: 'headline',
        name: 'Headline',
        type: 'text',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        x: 0,
        y: 0,
        bitmap: rasterizeImageTextStyle({ content: 'Readable copy.', fontSize: 20 }),
        bitmapVersion: 2,
        mask: null,
        text: normalizeImageTextStyle({ content: 'Readable copy.', fontSize: 20 }),
        metadata: { editableText: true },
      },
    ] satisfies ImageLayer[];

    const readiness = describeImageTextTypographyReadiness(layers, {
      findReplace: {
        find: '',
        replace: 'ignored',
      },
    });

    expect(readiness.status).toBe('blocked');
    expect(readiness.operations.findReplace).toMatchObject({
      status: 'blocked',
      affectedLayerIds: [],
      blockers: [
        {
          code: 'empty-find-query',
          scope: 'operation',
          message: 'Find/replace requires a non-empty search query.',
        },
      ],
    });
    expect(readiness.operations.spellcheckReadability).toMatchObject({
      status: 'ready',
      affectedLayerIds: ['headline'],
      readability: {
        characterCount: 14,
        wordCount: 2,
        sentenceCount: 1,
        averageWordsPerSentence: 2,
        longestLineLength: 14,
      },
    });
    expect(readiness.blockers).toEqual([
      {
        code: 'empty-find-query',
        scope: 'operation',
        message: 'Find/replace requires a non-empty search query.',
      },
    ]);
    expect(readiness.operations.findReplace.previewSignature).toBe(
      'image-text-readiness-find-replace:v1:{"status":"blocked","blockerCodes":["empty-find-query"],"planSignature":"image-text-find-replace:v1:{\\"query\\":\\"\\",\\"replacement\\":\\"ignored\\",\\"caseSensitive\\":false,\\"wholeWord\\":false,\\"affectedLayerIds\\":[],\\"proposals\\":[],\\"skippedLayerIds\\":[]}"}',
    );
  });
});
