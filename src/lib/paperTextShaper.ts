import {
  Blob as HarfBuzzBlob,
  Buffer as HarfBuzzBuffer,
  ClusterLevel,
  Direction,
  Face,
  Feature,
  Font,
  shape as harfBuzzShape,
  Variation,
} from 'harfbuzzjs';

export interface PaperShapeRequest {
  text: string;
  direction: 'ltr' | 'rtl' | 'ttb';
  script: string;
  language: string;
  fontSizePt: number;
  features: Record<string, boolean | number>;
  variations?: Record<string, number>;
}

export interface PaperShapedGlyph {
  glyphId: number;
  cluster: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
}

export interface PaperShapedRun {
  direction: PaperShapeRequest['direction'];
  glyphs: PaperShapedGlyph[];
  advanceX: number;
  advanceY: number;
}

export interface PaperTextShaper {
  /** Native glyph path scale. Consumers use this instead of assuming a 1000-upem font. */
  readonly unitsPerEm?: number;
  shape(request: PaperShapeRequest): PaperShapedRun;
  /** Returns an SVG path in the face's units-per-em coordinate space. */
  glyphPath(glyphId: number, variations?: Record<string, number>): string;
  /** Releases this wrapper's references and makes future calls fail closed. */
  destroy(): void;
}

export interface CreateHarfBuzzPaperTextShaperOptions {
  collectionIndex?: number;
}

const POINT_SCALE = 64;
const FEATURE_TAG = /^[ -~]{4}$/;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function requireFinitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`);
  return value;
}

function requireOpenTypeTag(value: string, label: string): string {
  if (!FEATURE_TAG.test(value)) throw new Error(`${label} must be a four-character printable OpenType tag.`);
  return value;
}

function directionFor(value: PaperShapeRequest['direction']): Direction {
  if (value === 'rtl') return Direction.RTL;
  if (value === 'ttb') return Direction.TTB;
  return Direction.LTR;
}

function featuresFor(features: PaperShapeRequest['features']): Feature[] {
  return Object.entries(features)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, value]) => {
      const normalized = typeof value === 'boolean' ? Number(value) : value;
      if (!Number.isFinite(normalized) || normalized < 0 || !Number.isInteger(normalized)) {
        throw new Error(`Feature ${tag} must be a non-negative integer or boolean.`);
      }
      return new Feature(requireOpenTypeTag(tag, 'Feature'), normalized);
    });
}

function variationsFor(variations: PaperShapeRequest['variations']): Variation[] {
  return Object.entries(variations ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, value]) => {
      if (!Number.isFinite(value)) throw new Error(`Variation ${tag} must be finite.`);
      return new Variation(requireOpenTypeTag(tag, 'Variation'), value);
    });
}

class HarfBuzzPaperTextShaper implements PaperTextShaper {
  readonly unitsPerEm: number;
  private blob: HarfBuzzBlob | undefined;
  private face: Face | undefined;
  private font: Font | undefined;
  private buffer: HarfBuzzBuffer | undefined;
  private destroyed = false;

  constructor(bytes: Uint8Array, collectionIndex: number) {
    if (!Number.isInteger(collectionIndex) || collectionIndex < 0) {
      throw new Error('Font collection index must be a non-negative integer.');
    }
    if (bytes.byteLength === 0) throw new Error('Cannot shape an empty font file.');
    this.blob = new HarfBuzzBlob(toArrayBuffer(bytes));
    this.face = new Face(this.blob, collectionIndex);
    if (!Number.isFinite(this.face.upem) || this.face.upem <= 0) {
      throw new Error('The HarfBuzz face has an invalid units-per-em value.');
    }
    this.unitsPerEm = this.face.upem;
    this.font = new Font(this.face);
    this.font.setScale(this.face.upem, this.face.upem);
    this.buffer = new HarfBuzzBuffer();
  }

  shape(request: PaperShapeRequest): PaperShapedRun {
    const font = this.requireFont();
    const face = this.requireFace();
    const buffer = this.requireBuffer();
    const fontSizePt = requireFinitePositive(request.fontSizePt, 'Font size');
    if (!request.script || !/^[ -~]{4}$/.test(request.script)) {
      throw new Error('Script must be a four-character HarfBuzz script tag.');
    }
    if (!request.language || !/^[A-Za-z0-9-]+$/.test(request.language)) {
      throw new Error('Language must be a non-empty BCP 47-like tag.');
    }

    const scale = Math.max(1, Math.round(fontSizePt * POINT_SCALE));
    buffer.reset();
    font.setScale(scale, scale);
    font.setVariations(variationsFor(request.variations));
    try {
      buffer.addText(request.text);
      buffer.setClusterLevel(ClusterLevel.CHARACTERS);
      buffer.setDirection(directionFor(request.direction));
      buffer.setScript(request.script);
      buffer.setLanguage(request.language);
      harfBuzzShape(font, buffer, featuresFor(request.features));

      const glyphs = buffer.getGlyphInfosAndPositions().map((glyph) => ({
        glyphId: glyph.codepoint,
        cluster: glyph.cluster,
        xAdvance: (glyph.xAdvance ?? 0) / POINT_SCALE,
        yAdvance: (glyph.yAdvance ?? 0) / POINT_SCALE,
        xOffset: (glyph.xOffset ?? 0) / POINT_SCALE,
        yOffset: (glyph.yOffset ?? 0) / POINT_SCALE,
      }));
      return {
        direction: request.direction,
        glyphs,
        advanceX: glyphs.reduce((total, glyph) => total + glyph.xAdvance, 0),
        advanceY: glyphs.reduce((total, glyph) => total + glyph.yAdvance, 0),
      };
    } finally {
      // The one retained buffer is reset before every request; its native handle follows the wrapper lifetime.
      font.setScale(face.upem, face.upem);
      font.setVariations([]);
    }
  }

  glyphPath(glyphId: number, variations?: Record<string, number>): string {
    if (!Number.isInteger(glyphId) || glyphId < 0) throw new Error('Glyph id must be a non-negative integer.');
    const font = this.requireFont();
    font.setVariations(variationsFor(variations));
    try {
      return font.glyphToPath(glyphId);
    } finally {
      font.setVariations([]);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // v1.4 exposes no manual disposal method. Dropping all owned references is immediate and prevents
    // further use; its documented FinalizationRegistry releases the corresponding WASM handles.
    this.font = undefined;
    this.face = undefined;
    this.blob = undefined;
    this.buffer = undefined;
  }

  private requireFont(): Font {
    if (this.destroyed || !this.font) throw new Error('Paper text shaper has been destroyed.');
    return this.font;
  }

  private requireFace(): Face {
    if (this.destroyed || !this.face) throw new Error('Paper text shaper has been destroyed.');
    return this.face;
  }

  private requireBuffer(): HarfBuzzBuffer {
    if (this.destroyed || !this.buffer) throw new Error('Paper text shaper has been destroyed.');
    return this.buffer;
  }
}

/** Creates a shape-only adapter around one exact managed font face. */
export async function createHarfBuzzPaperTextShaper(
  bytes: Uint8Array,
  options: CreateHarfBuzzPaperTextShaperOptions = {},
): Promise<PaperTextShaper> {
  return new HarfBuzzPaperTextShaper(bytes, options.collectionIndex ?? 0);
}
