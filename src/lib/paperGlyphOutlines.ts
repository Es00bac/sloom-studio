// Convert text to filled glyph OUTLINES (vector curves) for the PDF/X exporter — the "convert to curves"
// path a professional uses when text can't be embedded as a live font (a display face the user doesn't
// own, a layout the linear engine can't reproduce as selectable text). Outlined text is resolution-
// independent vector — crisp at any size, press-perfect — NOT rasterized pixels. It isn't selectable
// (curves carry no text), so it's the SECOND tier: prefer embedded selectable type, fall back to outlines,
// and only rasterize when we genuinely lack the glyphs.
//
// Pure + framework-free: takes a fontkit-parsed face and returns PDF path ops in user space (pt). The
// caller (exporter) owns line-breaking (via paperTextLayout) and content-stream emission.

import fontkit from '@pdf-lib/fontkit';

/** A single PDF path operator in user space (pt). 'm' move, 'l' line, 'c' cubic Bézier, 'h' close subpath. */
export type GlyphPathOp =
  | { op: 'm'; x: number; y: number }
  | { op: 'l'; x: number; y: number }
  | { op: 'c'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'h' };

export interface OutlinedRun {
  /** Fill path for the whole run (every glyph), ready to emit + fill with the frame's CMYK. */
  ops: GlyphPathOp[];
  /** Total advance of the run in pt (pen end − pen start), for alignment / the next run. */
  advancePt: number;
}

/** Minimal structural view of the bits of a fontkit face we use (there are no bundled type defs). */
export interface FontkitOutlineFont {
  unitsPerEm: number;
  /** Typographic ascent in font units (for the first-baseline model). May be absent on odd faces. */
  ascent?: number;
  layout: (text: string) => {
    glyphs: Array<{ path?: { commands?: Array<{ command: string; args: number[] }> } }>;
    positions: Array<{ xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }>;
  };
}

/** Parse font bytes into a fontkit face for outlining. Returns undefined if the bytes aren't a valid font. */
export function createOutlineFont(bytes: Uint8Array): FontkitOutlineFont | undefined {
  try {
    const font = fontkit.create(bytes as Buffer) as unknown as FontkitOutlineFont;
    if (typeof font.layout !== 'function' || typeof font.unitsPerEm !== 'number') return undefined;
    return font;
  } catch {
    return undefined;
  }
}

/**
 * Outline a run of text to filled glyph curves in PDF user space (pt), positioned along a baseline. The pen
 * starts at (penXPt, baselineYPt); baselineYPt is the PDF y of the baseline (PDF is Y-up, and font glyph
 * space is Y-up too, so glyph y adds directly — no flip). PDF has no quadratic Bézier, so quadratic curve
 * segments are converted to cubic. `trackingPt` adds extra advance after each glyph (letter-spacing).
 *
 * Fails soft: an unlayoutable run yields an empty path (advance 0) rather than throwing.
 */
export function outlineTextRun(
  font: FontkitOutlineFont,
  text: string,
  fontSizePt: number,
  penXPt: number,
  baselineYPt: number,
  trackingPt = 0,
): OutlinedRun {
  const ops: GlyphPathOp[] = [];
  if (!text || font.unitsPerEm <= 0) return { ops, advancePt: 0 };
  const scale = fontSizePt / font.unitsPerEm;
  let run: ReturnType<FontkitOutlineFont['layout']>;
  try {
    run = font.layout(text);
  } catch {
    return { ops, advancePt: 0 };
  }

  let penX = penXPt;
  const count = Math.min(run.glyphs.length, run.positions.length);
  for (let i = 0; i < count; i++) {
    const glyph = run.glyphs[i];
    const pos = run.positions[i];
    const originX = penX + pos.xOffset * scale;
    const originY = baselineYPt + pos.yOffset * scale;
    const X = (fx: number) => originX + fx * scale;
    const Y = (fy: number) => originY + fy * scale;

    // Track the current point in FONT units so a quadratic segment can be promoted to cubic about it.
    let curFx = 0;
    let curFy = 0;
    for (const cmd of glyph.path?.commands ?? []) {
      const a = cmd.args;
      switch (cmd.command) {
        case 'moveTo':
          curFx = a[0]; curFy = a[1];
          ops.push({ op: 'm', x: X(a[0]), y: Y(a[1]) });
          break;
        case 'lineTo':
          curFx = a[0]; curFy = a[1];
          ops.push({ op: 'l', x: X(a[0]), y: Y(a[1]) });
          break;
        case 'quadraticCurveTo': {
          // Quadratic (P0,C,P1) → cubic: C1 = P0 + 2/3(C−P0), C2 = P1 + 2/3(C−P1). Args: cx,cy,x,y.
          const [cx, cy, x, y] = a;
          const c1x = curFx + (2 / 3) * (cx - curFx);
          const c1y = curFy + (2 / 3) * (cy - curFy);
          const c2x = x + (2 / 3) * (cx - x);
          const c2y = y + (2 / 3) * (cy - y);
          ops.push({ op: 'c', x1: X(c1x), y1: Y(c1y), x2: X(c2x), y2: Y(c2y), x: X(x), y: Y(y) });
          curFx = x; curFy = y;
          break;
        }
        case 'bezierCurveTo': {
          const [c1x, c1y, c2x, c2y, x, y] = a;
          ops.push({ op: 'c', x1: X(c1x), y1: Y(c1y), x2: X(c2x), y2: Y(c2y), x: X(x), y: Y(y) });
          curFx = x; curFy = y;
          break;
        }
        case 'closePath':
          ops.push({ op: 'h' });
          break;
        default:
          break;
      }
    }
    penX += pos.xAdvance * scale + trackingPt;
  }
  return { ops, advancePt: penX - penXPt };
}

/** Advance width of a text run in pt (Σ glyph advances + tracking per glyph). Used as the layout engine's
 * measureText so outlined text wraps by the SAME metrics it's drawn with. Fails soft to 0. */
export function measureTextWidthPt(
  font: FontkitOutlineFont,
  text: string,
  fontSizePt: number,
  trackingPt = 0,
): number {
  if (!text || font.unitsPerEm <= 0) return 0;
  const scale = fontSizePt / font.unitsPerEm;
  let run: ReturnType<FontkitOutlineFont['layout']>;
  try {
    run = font.layout(text);
  } catch {
    return 0;
  }
  let width = 0;
  for (const pos of run.positions) width += pos.xAdvance * scale;
  return width + trackingPt * run.positions.length;
}

/** Serialize outline ops to a PDF content-stream path fragment (numbers fixed to 3 dp; ops end unfilled). */
export function glyphOpsToContentStream(ops: readonly GlyphPathOp[]): string {
  const n = (v: number) => (Math.abs(v) < 1e-4 ? '0' : v.toFixed(3));
  const parts: string[] = [];
  for (const op of ops) {
    switch (op.op) {
      case 'm': parts.push(`${n(op.x)} ${n(op.y)} m`); break;
      case 'l': parts.push(`${n(op.x)} ${n(op.y)} l`); break;
      case 'c': parts.push(`${n(op.x1)} ${n(op.y1)} ${n(op.x2)} ${n(op.y2)} ${n(op.x)} ${n(op.y)} c`); break;
      case 'h': parts.push('h'); break;
    }
  }
  return parts.join('\n');
}
