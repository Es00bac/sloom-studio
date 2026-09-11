// PDF/X-1a and PDF/X-4 writer for Paper's typed render plan. Native paths preserve authored CMYK/gray,
// named spots, overprint, and exact managed fonts. Only intentional flatten groups and image content are
// rasterized through the selected ICC profile, then embedded as isolated DeviceCMYK image XObjects.
// The document carries its ICC OutputIntent (/S /GTS_PDFX), PDF/X XMP + Info metadata, and TrimBox/
// BleedBox. PDF/X-1a blocks live transparency; PDF/X-4 retains supported opacity states.
//
// The legacy full-page-raster interfaces remain for proof/backward-compatible exports. Production Paper
// PDF/X uses the native render-plan branch below, while this module stays platform-agnostic and testable.

import {
  PDFDocument,
  PDFName,
  PDFString,
  PDFHexString,
  PDFDict,
  PDFNumber,
  PDFOperator,
  cmyk as cmykColor,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFFont,
  type PDFRef,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { IccCmykTransform } from './paperColorManagement';
import { layoutParagraphText, type PaperTextAlign } from './paperTextLayout';
import {
  assertCmykBufferWithinInkLimit,
  assertCmykPaintWithinInkLimit,
  correctCmykQuantizationOvershoot,
} from './paperInkLimit';
import { createOutlineFont, measureTextWidthPt, outlineTextRun, type FontkitOutlineFont, type GlyphPathOp } from './paperGlyphOutlines';
import {
  appendPaperNativeContent,
  type PaperPdfxNativeEvidence,
} from './paperPdfxNativeContent';
import type { PaperRenderPathNode, PaperRenderPlan, PaperRenderPlanPage } from './paperRenderPlan';
import type { PaperManagedFontFace } from '../types/paper';
import type { PaperPrintJobInfo } from '../types/paper';
import type { PaperPrintSheetPlan } from './paperPrintMarks';

export type PdfxStandard = 'pdf-x-1a' | 'pdf-x-4';

/** One rasterized page, already rendered at export DPI and INCLUDING any bleed margin. */
export interface PdfxRasterPage {
  /** 1-based page number (metadata/debug only). */
  pageNumber?: number;
  /** Interleaved RGBA, row-major top-to-bottom (canvas `getImageData` order). Length = width*height*4. */
  rgba: Uint8Array | Uint8ClampedArray;
  widthPx: number;
  heightPx: number;
  /** Finished trim size in PostScript points (1 pt = 1/72"). */
  trimWidthPt: number;
  trimHeightPt: number;
  /** Symmetric bleed in points included on every side of the raster (0 when there is no bleed). */
  bleedPt?: number;
  /** Expanded press sheet and native control marks retained even when authored content is flattened. */
  printSheet?: PaperPrintSheetPlan;
  productionMarks?: readonly PaperRenderPathNode[];
  /**
   * Optional real vector text drawn ON TOP of the raster (hybrid PDF/X). When present, these frames'
   * text was excluded from `rgba` (rasterized backdrop-only) and is re-drawn here as embedded,
   * selectable, resolution-independent CMYK type. Omit for a fully flattened page.
   */
  textFrames?: readonly PdfxVectorTextFrame[];
  /**
   * Optional solid spot-colour fills drawn as real `/Separation` plates on top of the raster. Each frame's
   * fill was knocked out of `rgba` (rendered as paper) so the spot ink lives ONLY on its named plate — it
   * survives as a separation instead of flattening to process CMYK. Drawn under the vector text.
   */
  spotFills?: readonly PdfxSpotFill[];
  /**
   * Optional text drawn as filled glyph OUTLINES (vector curves) rather than embedded selectable type —
   * the "convert to curves" tier. Used when the text can't be embedded as live type (a stroked/decorated
   * face) but must stay crisp vector, not raster. Like `textFrames`, these frames' text is knocked out of
   * `rgba`; unlike them, the glyphs carry no font (they're geometry), so the text isn't selectable.
   */
  outlineFrames?: readonly PdfxOutlineTextFrame[];
}

export interface PdfxRasterPlacement {
  /** Left edge in points from the media-left edge. */
  xPt: number;
  /** Top edge in points from the media-top edge. */
  yTopPt: number;
  widthPt: number;
  heightPt: number;
}

/** Isolated RGBA output for one render-plan selection. It contains no native siblings. */
export interface PdfxFlattenedGroupRaster {
  objectId: string;
  rgba: Uint8Array | Uint8ClampedArray;
  widthPx: number;
  heightPx: number;
  /** Omitted for a full-media raster. Managed image selections carry their physical crop bounds. */
  placement?: PdfxRasterPlacement;
}

/** A plan-driven hybrid PDF/X page. Native paths/text stay native; only listed flatten groups use rasters. */
export interface PdfxNativePage {
  pageNumber?: number;
  trimWidthPt: number;
  trimHeightPt: number;
  bleedPt?: number;
  renderPlanPage: PaperRenderPlanPage;
  flattenedGroups?: readonly PdfxFlattenedGroupRaster[];
  /** Managed image nodes are emitted as isolated CMYK image XObjects, not page-wide backdrops. */
  rasterizedImages?: readonly PdfxFlattenedGroupRaster[];
  /** Resolves exact managed-font bytes while the plan's positioned runs are emitted. */
  loadManagedFontBytes: (face: PaperManagedFontFace) => Promise<Uint8Array>;
}

export type PdfxExportPage = PdfxRasterPage | PdfxNativePage;

/** One solid spot-colour fill emitted as a `/Separation` colorspace rectangle (a real named plate). */
export interface PdfxSpotFill {
  /** Spot/Pantone name as it should appear on the plate (e.g. "PANTONE 185 C"). */
  name: string;
  /** Alternate DeviceCMYK at FULL strength (0..1) — how the spot previews/prints on a process press. */
  cmyk: { c: number; m: number; y: number; k: number };
  /** Tint 0..1 (1 = full strength). */
  tint: number;
  /** Rectangle in points from the media (bleed) TOP-LEFT, y increasing downward (flipped internally). */
  xPt: number;
  yTopPt: number;
  widthPt: number;
  heightPt: number;
  /** Optional rotation of the plate rect about the frame centre (matches CSS transform: rotate). */
  rotationDeg?: number;
  centerXPt?: number;
  centerYTopPt?: number;
  /** Optional corner radius in points — the plate draws as a rounded rectangle instead of a sharp one. */
  cornerRadiusPt?: number;
  /** Optional polygon (≥3 points, media TOP-left coords) — the plate draws this shape instead of the rect. */
  polygon?: readonly { xPt: number; yTopPt: number }[];
  /** When set, the shape is STROKED (a spot border) at this line width instead of filled — the plate draws
   * the outline with the stroking `/Separation` colour, matching a knocked-out frame border. */
  stroke?: { widthPt: number };
}

/** One text box drawn as embedded vector type over the CMYK raster. Geometry is in points, measured
 * from the media (bleed) TOP-LEFT with y increasing downward — the exporter flips to PDF space. */
export interface PdfxVectorTextFrame {
  text: string;
  /** Embed-cache key (the font face id, e.g. "LiberationSerif-Bold"). */
  fontId: string;
  /** TrueType/OpenType bytes to embed. Only embedded once per `fontId`. */
  fontBytes: Uint8Array;
  /** Subset the embedded font (default true). False embeds the whole font — required when the font's
   * OS/2 fsType disallows subsetting. */
  subset?: boolean;
  fontSizePt: number;
  leadingPt: number;
  align: PaperTextAlign;
  /** Fill colour as DeviceCMYK components in 0..1 (converted through the same output profile). */
  cmyk: { c: number; m: number; y: number; k: number };
  /** Content-box top-left X from the media left edge, in points. */
  xPt: number;
  /** Content-box top-left Y from the media TOP edge, in points (flipped internally). */
  yTopPt: number;
  /** Content-box width, in points (the wrap width). */
  widthPt: number;
  /** Content-box height, in points (used to clip overset lines + vertical alignment). */
  heightPt: number;
  /** Baseline offset from the box top for the first line, in points (defaults to 0.8·fontSize). */
  ascentPt?: number;
  /** Vertical placement of the text block within the box (default top). */
  verticalAlign?: 'top' | 'middle' | 'bottom';
}

/** One text box drawn as filled glyph OUTLINES (vector curves) — same geometry model as
 * `PdfxVectorTextFrame`, but the glyphs are painted as paths (optionally fill + stroke) instead of
 * selectable embedded type. Used for stroked/decorated text the live-type path can't reproduce. */
export interface PdfxOutlineTextFrame {
  text: string;
  /** Parse cache key for the outline font (distinct per face). */
  fontId: string;
  /** TrueType/OpenType bytes to outline glyphs from. */
  fontBytes: Uint8Array;
  fontSizePt: number;
  leadingPt: number;
  align: PaperTextAlign;
  /** Fill colour as DeviceCMYK components in 0..1 (converted through the output profile). */
  cmyk: { c: number; m: number; y: number; k: number };
  /** Content-box top-left X from the media left edge, in points. */
  xPt: number;
  /** Content-box top-left Y from the media TOP edge, in points (flipped internally). */
  yTopPt: number;
  /** Content-box width (wrap width) in points. */
  widthPt: number;
  /** Content-box height in points (clips overset lines + drives vertical alignment). */
  heightPt: number;
  ascentPt?: number;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** Extra advance per glyph (letter-spacing) in points. */
  trackingPt?: number;
  /** Optional stroke around the glyphs (comic-style outlined lettering). */
  strokeCmyk?: { c: number; m: number; y: number; k: number };
  strokeWidthPt?: number;
  /** When set, the glyphs fill with this named spot /Separation ink (tint 0..1) instead of process CMYK —
   * the text becomes a real named plate. `cmyk` is the alternate at full strength. */
  spot?: { name: string; cmyk: { c: number; m: number; y: number; k: number }; tint: number };
  /** Optional rotation of the whole block about the frame centre (matches CSS `transform: rotate`,
   * clockwise-positive in screen space). Requires centreXPt + centreYTopPt. */
  rotationDeg?: number;
  /** Rotation pivot: frame-centre X from the media left edge, in points. */
  centerXPt?: number;
  /** Rotation pivot: frame-centre Y from the media TOP edge, in points (flipped internally). */
  centerYTopPt?: number;
}

export interface PdfxOutputProfile {
  /** Raw ICC profile bytes — the CMYK output condition (bundled/system/custom). */
  iccBytes: Uint8Array;
  /** Registry identifier, e.g. "FOGRA39" or "CGATS TR 006" (emitted as /OutputConditionIdentifier). */
  outputConditionIdentifier: string;
  /** Human description of the print condition (e.g. "Coated FOGRA39 (ISO 12647-2:2004)"). */
  outputCondition?: string;
  /** ICC characterization registry. Defaults to the ICC registry. */
  registryName?: string;
}

export interface PdfxExportOptions {
  standard: PdfxStandard;
  profile: PdfxOutputProfile;
  /**
   * RGB→CMYK transform built from the SAME output profile (see `paperIccEngine.createRgbToCmykTransform`).
   * MUST expose `transformRgbBuffer` (bulk image conversion). Using an `approximate` transform still
   * produces a structurally valid PDF/X, but the color is not press-accurate and `approximateColor` is set.
   */
  transform: IccCmykTransform;
  title?: string;
  author?: string;
  jobInfo?: Partial<PaperPrintJobInfo>;
  creator?: string;
  producer?: string;
  createdAt?: Date;
  /** 16-byte hex document id for the trailer /ID (defaults to random). Fixed value keeps tests deterministic. */
  docId?: string;
  /** Total-ink (TAC) ceiling as a percent, e.g. 280. Over-limit output is blocked, never rewritten. */
  totalInkLimitPercent?: number;
  /** Correct only a one-byte ICC quantization overshoot before enforcing the TAC ceiling. */
  correctOneStepInkQuantization?: boolean;
}

export interface PdfxExportResult {
  bytes: Uint8Array;
  standard: PdfxStandard;
  pageCount: number;
  /** The ICC output profile name used for the OutputIntent. */
  profileName: string;
  /** True when the color conversion was not ICC-backed (structurally valid, but not press-accurate). */
  approximateColor: boolean;
  /** Inspectable proof of native vector/text/spot content retained in a hybrid export. */
  nativeEvidence: PaperPdfxNativeEvidence;
  /** In-memory semantic plan used to produce this file. It is never persisted in document state. */
  renderPlan?: PaperRenderPlan;
}

interface StandardMeta {
  /** GTS_PDFXVersion string. */
  version: string;
  /** GTS_PDFXConformance (X-1a/X-3 only). */
  conformance?: string;
  /** PDF header version digit to stamp. */
  pdfVersion: string;
}

const STANDARD_META: Record<PdfxStandard, StandardMeta> = {
  'pdf-x-1a': { version: 'PDF/X-1a:2003', conformance: 'PDF/X-1a:2003', pdfVersion: '1.4' },
  'pdf-x-4': { version: 'PDF/X-4', pdfVersion: '1.6' },
};

const DEFAULT_CREATOR = 'Sloom Studio';

/** Composite interleaved RGBA over white → interleaved RGB (3 bytes/pixel) for the ICC transform. */
function flattenRgbaToRgb(rgba: Uint8Array | Uint8ClampedArray, pixelCount: number): Uint8Array {
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i += 1) {
    const s = i * 4;
    const a = rgba[s + 3] / 255;
    const inv = 1 - a;
    const d = i * 3;
    // Straight-alpha composite over an opaque white sheet.
    rgb[d] = Math.round(rgba[s] * a + 255 * inv);
    rgb[d + 1] = Math.round(rgba[s + 1] * a + 255 * inv);
    rgb[d + 2] = Math.round(rgba[s + 2] * a + 255 * inv);
  }
  return rgb;
}

/** Drop alpha without compositing for a PDF/X-4 image that carries a matching soft mask. */
function rgbaToRgb(rgba: Uint8Array | Uint8ClampedArray, pixelCount: number): Uint8Array {
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i += 1) {
    const source = i * 4;
    const target = i * 3;
    rgb[target] = rgba[source];
    rgb[target + 1] = rgba[source + 1];
    rgb[target + 2] = rgba[source + 2];
  }
  return rgb;
}

function hasTransparency(rgba: Uint8Array | Uint8ClampedArray, pixelCount: number): boolean {
  for (let i = 0; i < pixelCount; i += 1) {
    if (rgba[i * 4 + 3] !== 255) return true;
  }
  return false;
}

function emptyNativeEvidence(): PaperPdfxNativeEvidence {
  return {
    processObjectIds: [],
    spotPlates: [],
    embeddedFontIds: [],
    outlinedObjectIds: [],
    flattenedObjectIds: [],
    overprintObjectIds: [],
  };
}

function mergeNativeEvidence(target: PaperPdfxNativeEvidence, source: PaperPdfxNativeEvidence): void {
  for (const id of source.processObjectIds) if (!target.processObjectIds.includes(id)) target.processObjectIds.push(id);
  for (const id of source.embeddedFontIds) if (!target.embeddedFontIds.includes(id)) target.embeddedFontIds.push(id);
  for (const id of source.outlinedObjectIds) if (!target.outlinedObjectIds.includes(id)) target.outlinedObjectIds.push(id);
  for (const id of source.overprintObjectIds) if (!target.overprintObjectIds.includes(id)) target.overprintObjectIds.push(id);
  target.flattenedObjectIds.push(...source.flattenedObjectIds);
  for (const plate of source.spotPlates) {
    const known = target.spotPlates.find((candidate) => candidate.name === plate.name);
    if (known) {
      for (const id of plate.objectIds) if (!known.objectIds.includes(id)) known.objectIds.push(id);
    } else {
      target.spotPlates.push({ name: plate.name, objectIds: [...plate.objectIds] });
    }
  }
}

function isNativePage(page: PdfxExportPage): page is PdfxNativePage {
  return 'renderPlanPage' in page;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** PDF date string: D:YYYYMMDDHHmmSS+00'00' (UTC). */
function pdfDate(date: Date): string {
  return (
    `D:${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}+00'00'`
  );
}

/** ISO-8601 date (UTC, second precision) for XMP. */
function xmpDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the PDF/X XMP metadata packet (the authoritative GTS_PDFXVersion carrier). */
function buildXmp(meta: StandardMeta, opts: PdfxExportOptions, date: Date): string {
  const title = escapeXml(opts.title ?? 'Untitled');
  const creator = escapeXml(opts.creator ?? DEFAULT_CREATOR);
  const producer = escapeXml(opts.producer ?? DEFAULT_CREATOR);
  const author = escapeXml(opts.author ?? '');
  const iso = xmpDate(date);
  const conformance = meta.conformance
    ? `\n     <pdfxid:GTS_PDFXConformance>${escapeXml(meta.conformance)}</pdfxid:GTS_PDFXConformance>`
    : '';
  const authorBlock = author
    ? `\n     <dc:creator><rdf:Seq><rdf:li>${author}</rdf:li></rdf:Seq></dc:creator>`
    : '';
  const jobInfo = opts.jobInfo;
  const jobInfoBlock = jobInfo
    ? [
        `\n     <sloom:JobName>${escapeXml(jobInfo.jobName ?? '')}</sloom:JobName>`,
        `\n     <sloom:JobNumber>${escapeXml(jobInfo.jobNumber ?? '')}</sloom:JobNumber>`,
        `\n     <sloom:Client>${escapeXml(jobInfo.client ?? '')}</sloom:Client>`,
        `\n     <sloom:Notes>${escapeXml(jobInfo.notes ?? '')}</sloom:Notes>`,
      ].join('')
    : '';
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
     xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/"
     xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
     xmlns:xmp="http://ns.adobe.com/xap/1.0/"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:sloom="https://sloom.studio/ns/paper/1.0/">
     <pdfxid:GTS_PDFXVersion>${escapeXml(meta.version)}</pdfxid:GTS_PDFXVersion>${conformance}
     <pdf:Producer>${producer}</pdf:Producer>
     <pdf:Trapped>False</pdf:Trapped>
     <xmp:CreatorTool>${creator}</xmp:CreatorTool>
     <xmp:CreateDate>${iso}</xmp:CreateDate>
     <xmp:ModifyDate>${iso}</xmp:ModifyDate>
     <dc:format>application/pdf</dc:format>
     <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>${authorBlock}${jobInfoBlock}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function randomDocId(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Emit a raw PDF content operator pdf-lib doesn't expose a helper for (cs/scn/re/f for /Separation fills).
 * pdf-lib types `of` to its own operator enum; these are valid operators it just doesn't enumerate. */
function contentOp(name: string, args: (PDFName | PDFNumber)[] = []): PDFOperator {
  return PDFOperator.of(name as unknown as Parameters<typeof PDFOperator.of>[0], args);
}

/** A `cm` operator that rotates content about a pivot given in media TOP-left coords, matching the editor's
 * CSS `transform: rotate` (clockwise-positive on screen; PDF user space is y-up so the angle is negated)
 * about `transform-origin: center`. Returns null when there's no rotation. cm = T(c)·R(-deg)·T(-c). */
function rotateAboutPivotOp(
  rotationDeg: number | undefined,
  centerXPt: number | undefined,
  centerYTopPt: number | undefined,
  mediaHpt: number,
): PDFOperator | null {
  if (!rotationDeg || centerXPt === undefined || centerYTopPt === undefined) return null;
  const phi = (-rotationDeg * Math.PI) / 180;
  const cx = centerXPt;
  const cy = mediaHpt - centerYTopPt;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  return concatTransformationMatrix(cos, sin, -sin, cos, cx * (1 - cos) + cy * sin, cy * (1 - cos) - cx * sin);
}

/** Path ops for a rectangle with rounded corners (radius clamped to half the shorter side), from the
 * bottom-left in PDF user space. Corners use the standard circle-to-Bézier constant. Falls back to a plain
 * `re` rectangle when the radius is ~0. Coordinates in points. */
function roundedRectOps(xPt: number, yBottomPt: number, wPt: number, hPt: number, rPt: number): PDFOperator[] {
  const r = Math.max(0, Math.min(rPt, wPt / 2, hPt / 2));
  if (r < 0.01) {
    return [contentOp('re', [PDFNumber.of(xPt), PDFNumber.of(yBottomPt), PDFNumber.of(wPt), PDFNumber.of(hPt)])];
  }
  const k = 0.5522847498307936; // 4/3·(√2−1): quarter-circle Bézier control-point distance
  const x0 = xPt;
  const y0 = yBottomPt;
  const x1 = xPt + wPt;
  const y1 = yBottomPt + hPt;
  const N = (v: number) => PDFNumber.of(v);
  const m = (x: number, y: number) => contentOp('m', [N(x), N(y)]);
  const l = (x: number, y: number) => contentOp('l', [N(x), N(y)]);
  const c = (a: number, b: number, d: number, e: number, f: number, g: number) => contentOp('c', [N(a), N(b), N(d), N(e), N(f), N(g)]);
  // Start after the bottom-left corner, go counter-clockwise, rounding each corner with one cubic.
  return [
    m(x0 + r, y0),
    l(x1 - r, y0),
    c(x1 - r + k * r, y0, x1, y0 + r - k * r, x1, y0 + r),
    l(x1, y1 - r),
    c(x1, y1 - r + k * r, x1 - r + k * r, y1, x1 - r, y1),
    l(x0 + r, y1),
    c(x0 + r - k * r, y1, x0, y1 - r + k * r, x0, y1 - r),
    l(x0, y0 + r),
    c(x0, y0 + r - k * r, x0 + r - k * r, y0, x0 + r, y0),
    contentOp('h'),
  ];
}

/** Path ops for a closed polygon given points in media TOP-left coords (y down); flips each to PDF y-up. */
function polygonOps(points: readonly { xPt: number; yTopPt: number }[], mediaHpt: number): PDFOperator[] {
  const ops: PDFOperator[] = [];
  points.forEach((p, i) => {
    const args = [PDFNumber.of(p.xPt), PDFNumber.of(mediaHpt - p.yTopPt)];
    ops.push(contentOp(i === 0 ? 'm' : 'l', args));
  });
  ops.push(contentOp('h'));
  return ops;
}

/** Encode a string as a PDF name body: chars outside the printable regular set become `#XX`. A spot name
 * like "PANTONE 185 C" → "PANTONE#20185#20C", so the colorant round-trips through Ghostscript/RIPs. */
function encodePdfName(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    const isRegular = code > 0x20 && code < 0x7f && !'#()<>[]{}/%'.includes(ch);
    out += isRegular ? ch : `#${code.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function registerIsolatedRgbaImage(
  pdf: PDFDocument,
  group: PdfxFlattenedGroupRaster,
  transform: IccCmykTransform,
  standard: PdfxStandard,
  totalInkLimitPercent: number | undefined,
): PDFRef {
  const pixelCount = group.widthPx * group.heightPx;
  if (group.rgba.length < pixelCount * 4) {
    throw new Error(`Flatten group ${group.objectId} is smaller than ${group.widthPx}×${group.heightPx} RGBA.`);
  }
  const transparent = hasTransparency(group.rgba, pixelCount);
  if (standard === 'pdf-x-1a' && transparent) {
    throw new Error(`PDF/X-1a cannot preserve transparency in flatten group ${group.objectId}; use PDF/X-4 or flatten against an approved opaque backdrop.`);
  }
  const bulk = transform.transformRgbBuffer;
  if (!bulk) throw new Error('The provided ICC transform does not support bulk image conversion (transformRgbBuffer).');
  const rgb = transparent ? rgbaToRgb(group.rgba, pixelCount) : flattenRgbaToRgb(group.rgba, pixelCount);
  const cmyk = bulk(rgb, pixelCount);
  if (cmyk.length < pixelCount * 4) throw new Error('ICC transform returned fewer CMYK samples than expected.');
  assertCmykBufferWithinInkLimit(cmyk, totalInkLimitPercent);
  const context = pdf.context;
  let alphaRef: PDFRef | undefined;
  if (transparent) {
    const alpha = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i += 1) alpha[i] = group.rgba[i * 4 + 3];
    alphaRef = context.register(context.flateStream(alpha, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: group.widthPx,
      Height: group.heightPx,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 8,
    }));
  }
  return context.register(context.flateStream(cmyk.subarray(0, pixelCount * 4), {
    Type: 'XObject',
    Subtype: 'Image',
    Width: group.widthPx,
    Height: group.heightPx,
    ColorSpace: 'DeviceCMYK',
    BitsPerComponent: 8,
    ...(alphaRef ? { SMask: alphaRef } : {}),
  }));
}

function drawIsolatedFlattenGroup(
  pdf: PDFDocument,
  page: import('pdf-lib').PDFPage,
  group: PdfxFlattenedGroupRaster,
  mediaWidthPt: number,
  mediaHeightPt: number,
  transform: IccCmykTransform,
  standard: PdfxStandard,
  totalInkLimitPercent: number | undefined,
  coordinateOffsetPt: { x: number; y: number } = { x: 0, y: 0 },
  contentMediaSizePt: { width: number; height: number } = { width: mediaWidthPt, height: mediaHeightPt },
): void {
  const imageRef = registerIsolatedRgbaImage(pdf, group, transform, standard, totalInkLimitPercent);
  const resource = page.node.newXObject('Fg', imageRef);
  const authoredPlacement = group.placement ?? {
    xPt: 0,
    yTopPt: 0,
    widthPt: contentMediaSizePt.width,
    heightPt: contentMediaSizePt.height,
  };
  const placement = {
    ...authoredPlacement,
    xPt: authoredPlacement.xPt + coordinateOffsetPt.x,
    yTopPt: authoredPlacement.yTopPt + coordinateOffsetPt.y,
  };
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(
      placement.widthPt,
      0,
      0,
      placement.heightPt,
      placement.xPt,
      mediaHeightPt - placement.yTopPt - placement.heightPt,
    ),
    drawObject(resource),
    popGraphicsState(),
  );
}

/**
 * Build a conformant PDF/X (X-1a or X-4) from legacy full-page rasters or typed native render-plan pages.
 * Native plan pages retain vector paths, named spots, managed fonts, and supported PDF/X-4 transparency.
 */
export async function buildPaperPdfx(
  pages: readonly PdfxExportPage[],
  options: PdfxExportOptions,
): Promise<PdfxExportResult> {
  if (pages.length === 0) throw new Error('Cannot export a PDF/X with no pages.');
  const bulk = options.transform.transformRgbBuffer;
  if (!bulk) {
    throw new Error('The provided ICC transform does not support bulk image conversion (transformRgbBuffer).');
  }
  // A ceiling of 400% (the 4-channel max) can never be exceeded → treat it as "no limit".
  const inkLimitPercent = options.totalInkLimitPercent !== undefined && options.totalInkLimitPercent < 400
    ? options.totalInkLimitPercent
    : undefined;
  const meta = STANDARD_META[options.standard];
  const date = options.createdAt ?? new Date();
  const doc = await PDFDocument.create();
  const ctx = doc.context;

  // --- Embedded ICC output profile (shared by every page's OutputIntent) ---
  const iccStream = ctx.flateStream(options.profile.iccBytes, { N: 4 });
  const iccRef = ctx.register(iccStream);

  // Fonts for the optional vector-text layer are embedded once per face and reused across pages.
  const hasVectorText = pages.some((page) => !isNativePage(page) && (page.textFrames?.length ?? 0) > 0);
  if (hasVectorText) doc.registerFontkit(fontkit);
  const fontCache = new Map<string, { font: PDFFont; ascentRatio: number }>();
  const embedFace = async (fontId: string, fontBytes: Uint8Array, subset = true): Promise<{ font: PDFFont; ascentRatio: number }> => {
    let entry = fontCache.get(fontId);
    if (!entry) {
      const font = await doc.embedFont(fontBytes, { subset });
      // Read the real typographic ascent so the first baseline matches the CSS line box.
      let ascentRatio = 0.8;
      try {
        const create = (fontkit as unknown as { create?: (b: Uint8Array) => { ascent?: number; unitsPerEm?: number } }).create;
        const fk = create?.(fontBytes);
        if (fk && typeof fk.ascent === 'number' && fk.unitsPerEm) ascentRatio = fk.ascent / fk.unitsPerEm;
      } catch {
        // Fall back to the 0.8·em approximation if the face can't be parsed for metrics.
      }
      entry = { font, ascentRatio };
      fontCache.set(fontId, entry);
    }
    return entry;
  };

  // Spot-colour /Separation colorspaces are built once per spot name and reused across pages. The alternate
  // is DeviceCMYK with a Type-2 (exponential) tint transform mapping tint 0..1 → the spot's CMYK.
  const spotCsCache = new Map<string, PDFRef>();
  const spotColorSpaceRef = (name: string, ink: { c: number; m: number; y: number; k: number }): PDFRef => {
    let ref = spotCsCache.get(name);
    if (!ref) {
      const tintFn = ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [ink.c, ink.m, ink.y, ink.k], N: 1 });
      const separation = ctx.obj([PDFName.of('Separation'), PDFName.of(encodePdfName(name)), PDFName.of('DeviceCMYK'), ctx.register(tintFn)]);
      ref = ctx.register(separation);
      spotCsCache.set(name, ref);
    }
    return ref;
  };

  // Parsed outline fonts, cached per face across pages (fontkit parse is the costly step).
  const outlineFontCache = new Map<string, FontkitOutlineFont | undefined>();
  const outlineFontFor = (fontId: string, bytes: Uint8Array): FontkitOutlineFont | undefined => {
    let font = outlineFontCache.get(fontId);
    if (font === undefined && !outlineFontCache.has(fontId)) {
      font = createOutlineFont(bytes);
      outlineFontCache.set(fontId, font);
    }
    return font;
  };

  const nativeFontCache = new Map<string, PDFFont>();
  const nativeSpotDefinitions = new Map<string, { alternate: { c: number; m: number; y: number; k: number }; colorSpaceRef?: PDFRef }>();
  const nativeEvidence = emptyNativeEvidence();

  // --- Pages: legacy full-page rasters or plan-driven native hybrid pages ---
  for (const page of pages) {
    const bleedPt = page.bleedPt ?? 0;
    const printSheet = isNativePage(page) ? page.renderPlanPage.printSheet : page.printSheet;
    const contentMediaWpt = page.trimWidthPt + bleedPt * 2;
    const contentMediaHpt = page.trimHeightPt + bleedPt * 2;
    const mediaWpt = printSheet?.mediaBox.widthPt ?? contentMediaWpt;
    const mediaHpt = printSheet?.mediaBox.heightPt ?? contentMediaHpt;
    const pdfPage = doc.addPage([mediaWpt, mediaHpt]);
    // TrimBox/BleedBox come from the same canonical sheet that owns explicit mark geometry.
    const trimBox = printSheet?.trimBox;
    const bleedBox = printSheet?.bleedBox;
    pdfPage.node.set(PDFName.of('TrimBox'), ctx.obj(trimBox
      ? [trimBox.xPt, mediaHpt - trimBox.yTopPt - trimBox.heightPt, trimBox.xPt + trimBox.widthPt, mediaHpt - trimBox.yTopPt]
      : [bleedPt, bleedPt, bleedPt + page.trimWidthPt, bleedPt + page.trimHeightPt]));
    pdfPage.node.set(PDFName.of('BleedBox'), ctx.obj(bleedBox
      ? [bleedBox.xPt, mediaHpt - bleedBox.yTopPt - bleedBox.heightPt, bleedBox.xPt + bleedBox.widthPt, mediaHpt - bleedBox.yTopPt]
      : [0, 0, mediaWpt, mediaHpt]));

    if (isNativePage(page)) {
      const flattenedById = new Map((page.flattenedGroups ?? []).map((group) => [group.objectId, group]));
      const imagesById = new Map((page.rasterizedImages ?? []).map((image) => [image.objectId, image]));
      const coordinateOffsetPt = printSheet?.contentOffsetPt ?? { x: 0, y: 0 };
      const nodes = page.renderPlanPage.background
        ? [page.renderPlanPage.background, ...page.renderPlanPage.nodes]
        : page.renderPlanPage.nodes;
      const evidence = await appendPaperNativeContent(doc, pdfPage, nodes, {
        pdf: doc,
        standard: options.standard,
        mediaHeightPt: mediaHpt,
        coordinateOffsetPt,
        transform: options.transform,
        totalInkLimitPercent: inkLimitPercent,
        loadManagedFontBytes: page.loadManagedFontBytes,
        fontCache: nativeFontCache,
        spotDefinitions: nativeSpotDefinitions,
        appendFlattenedGroup: async (group) => {
          const raster = flattenedById.get(group.objectId);
          if (!raster) throw new Error(`Flatten group ${group.objectId} has no isolated raster in this PDF/X export.`);
          drawIsolatedFlattenGroup(doc, pdfPage, raster, mediaWpt, mediaHpt, options.transform, options.standard, inkLimitPercent, coordinateOffsetPt, {
            width: contentMediaWpt,
            height: contentMediaHpt,
          });
        },
        appendImage: async (image, evidence) => {
          const raster = imagesById.get(image.objectId);
          if (!raster) throw new Error(`Managed image ${image.objectId} has no isolated CMYK raster in this PDF/X export.`);
          drawIsolatedFlattenGroup(doc, pdfPage, raster, mediaWpt, mediaHpt, options.transform, options.standard, inkLimitPercent, coordinateOffsetPt, {
            width: contentMediaWpt,
            height: contentMediaHpt,
          });
          if (!evidence.processObjectIds.includes(image.objectId)) evidence.processObjectIds.push(image.objectId);
        },
      });
      mergeNativeEvidence(nativeEvidence, evidence);
      if (page.renderPlanPage.productionMarks?.length) {
        const markEvidence = await appendPaperNativeContent(doc, pdfPage, page.renderPlanPage.productionMarks, {
          pdf: doc,
          standard: options.standard,
          mediaHeightPt: mediaHpt,
          transform: options.transform,
          // Calibration/control marks intentionally exercise every process plate. They are outside
          // authored trim content and must not be rejected by the document artwork TAC policy.
          totalInkLimitPercent: undefined,
          loadManagedFontBytes: page.loadManagedFontBytes,
          fontCache: nativeFontCache,
          spotDefinitions: nativeSpotDefinitions,
        });
        mergeNativeEvidence(nativeEvidence, markEvidence);
      }
      continue;
    }

    const pixelCount = page.widthPx * page.heightPx;
    if (page.rgba.length < pixelCount * 4) {
      throw new Error(`Page raster is smaller than ${page.widthPx}×${page.heightPx} RGBA.`);
    }
    const rgb = flattenRgbaToRgb(page.rgba, pixelCount);
    const cmyk = bulk(rgb, pixelCount); // raw 0–255 DeviceCMYK samples
    if (cmyk.length < pixelCount * 4) {
      throw new Error('ICC transform returned fewer CMYK samples than expected.');
    }
    // ICC output may land one byte above its stated TAC after 8-bit quantization. KDP's deliberate
    // full-page conversion corrects only that rounding step; real excess remains a blocker.
    if (options.correctOneStepInkQuantization) {
      correctCmykQuantizationOvershoot(cmyk, inkLimitPercent);
    }
    assertCmykBufferWithinInkLimit(cmyk, inkLimitPercent);

    const imageStream = ctx.flateStream(cmyk.subarray(0, pixelCount * 4), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: page.widthPx,
      Height: page.heightPx,
      ColorSpace: 'DeviceCMYK',
      BitsPerComponent: 8,
    });
    const imageRef = ctx.register(imageStream);

    pdfPage.node.setXObject(PDFName.of('Im0'), imageRef);
    const rasterOffset = printSheet?.contentOffsetPt ?? { x: 0, y: 0 };
    pdfPage.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(
        contentMediaWpt,
        0,
        0,
        contentMediaHpt,
        rasterOffset.x,
        mediaHpt - rasterOffset.y - contentMediaHpt,
      ),
      drawObject('Im0'),
      popGraphicsState(),
    );

    if (page.productionMarks?.length) {
      const markEvidence = await appendPaperNativeContent(doc, pdfPage, page.productionMarks, {
        pdf: doc,
        standard: options.standard,
        mediaHeightPt: mediaHpt,
        transform: options.transform,
        // Press controls intentionally use the full registration plate and are not authored artwork.
        totalInkLimitPercent: undefined,
        loadManagedFontBytes: async () => {
          throw new Error('Production sheet controls cannot request managed font bytes.');
        },
        fontCache: nativeFontCache,
        spotDefinitions: nativeSpotDefinitions,
      });
      mergeNativeEvidence(nativeEvidence, markEvidence);
    }

    // Register a spot /Separation colorspace on THIS page's resources (cached per colorant), returning its
    // /SpN resource name. Shared by spot FILLS and spot-coloured TEXT so both draw on the same named plate.
    const spotResName = new Map<string, string>();
    const ensureSpotCs = (name: string, ink: { c: number; m: number; y: number; k: number }): string => {
      const existing = spotResName.get(name);
      if (existing) return existing;
      const resources = pdfPage.node.Resources() ?? ctx.obj({});
      let csDict = resources.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
      if (!csDict) {
        csDict = ctx.obj({});
        resources.set(PDFName.of('ColorSpace'), csDict);
      }
      pdfPage.node.set(PDFName.of('Resources'), resources);
      const resName = `Sp${spotResName.size}`;
      csDict.set(PDFName.of(resName), spotColorSpaceRef(name, ink));
      spotResName.set(name, resName);
      return resName;
    };

    // --- Spot-colour /Separation fills (under the vector text): real named plates, not process. ---
    if (page.spotFills && page.spotFills.length > 0) {
      for (const spot of page.spotFills) {
        const resName = ensureSpotCs(spot.name, spot.cmyk);
        const yBottom = mediaHpt - (spot.yTopPt + spot.heightPt); // flip to PDF's bottom-left origin
        const tint = Math.max(0, Math.min(1, spot.tint));
        const spotRotate = rotateAboutPivotOp(spot.rotationDeg, spot.centerXPt, spot.centerYTopPt, mediaHpt);
        const spotDraw: PDFOperator[] = [pushGraphicsState()];
        if (spotRotate) spotDraw.push(spotRotate); // rotate the plate rect about the frame centre
        // A polygon draws its own path; else rounded corners draw a path; else a plain `re`.
        const pathOps = spot.polygon && spot.polygon.length >= 3
          ? polygonOps(spot.polygon, mediaHpt)
          : roundedRectOps(spot.xPt, yBottom, spot.widthPt, spot.heightPt, spot.cornerRadiusPt ?? 0);
        if (spot.stroke) {
          // Spot BORDER: set the STROKING colour space/tint (uppercase CS/SCN), line width, then stroke (S).
          spotDraw.push(
            contentOp('CS', [PDFName.of(resName)]),
            contentOp('SCN', [PDFNumber.of(tint)]),
            contentOp('w', [PDFNumber.of(spot.stroke.widthPt)]),
            ...pathOps,
            contentOp('S'),
            popGraphicsState(),
          );
        } else {
          // Spot FILL: non-stroking colour space/tint (lowercase cs/scn), then fill (f).
          spotDraw.push(
            contentOp('cs', [PDFName.of(resName)]),
            contentOp('scn', [PDFNumber.of(tint)]),
            ...pathOps,
            contentOp('f'),
            popGraphicsState(),
          );
        }
        pdfPage.pushOperators(...spotDraw);
      }
    }

    // --- Vector text layer (hybrid PDF/X): real embedded, selectable CMYK type over the raster ---
    for (const frame of page.textFrames ?? []) {
      if (!frame.text.trim()) continue;
      const { font, ascentRatio } = await embedFace(frame.fontId, frame.fontBytes, frame.subset !== false);
      assertCmykPaintWithinInkLimit(frame.cmyk, inkLimitPercent, `legacy-text:${frame.fontId}`);
      const fill = cmykColor(frame.cmyk.c, frame.cmyk.m, frame.cmyk.y, frame.cmyk.k);
      // First-baseline model matching a CSS line box: half the extra leading, then the font's ascent.
      const ascentPt = frame.ascentPt ?? (frame.leadingPt - frame.fontSizePt) / 2 + ascentRatio * frame.fontSizePt;
      const layout = layoutParagraphText({
        text: frame.text,
        maxWidthPt: frame.widthPt,
        fontSizePt: frame.fontSizePt,
        leadingPt: frame.leadingPt,
        align: frame.align,
        ascentPt,
        measureText: (t) => font.widthOfTextAtSize(t, frame.fontSizePt),
      });
      // Vertical alignment: shift the whole text block down within the box (top = no shift).
      const slack = Math.max(0, frame.heightPt - layout.totalHeightPt);
      const vShift = frame.verticalAlign === 'middle' ? slack / 2 : frame.verticalAlign === 'bottom' ? slack : 0;
      for (const line of layout.lines) {
        // Clip overset lines: skip baselines that fall past the frame's bottom edge.
        if (line.baselineYPt > frame.heightPt + frame.fontSizePt) continue;
        const yPt = mediaHpt - (frame.yTopPt + vShift + line.baselineYPt);
        for (const segment of line.runs) {
          if (!segment.text) continue;
          pdfPage.drawText(segment.text, {
            x: frame.xPt + segment.xPt,
            y: yPt,
            size: frame.fontSizePt,
            font,
            color: fill,
          });
        }
      }
    }

    // --- Outline text layer: glyphs painted as filled/stroked vector CURVES (not selectable type) ---
    for (const frame of page.outlineFrames ?? []) {
      if (!frame.text.trim()) continue;
      const font = outlineFontFor(frame.fontId, frame.fontBytes);
      if (!font) continue;
      const tracking = frame.trackingPt ?? 0;
      // Same first-baseline model as the selectable-text path (half the extra leading, then the ascent).
      const ascentRatio = font.ascent && font.unitsPerEm ? font.ascent / font.unitsPerEm : 0.8;
      const ascentPt = frame.ascentPt ?? (frame.leadingPt - frame.fontSizePt) / 2 + ascentRatio * frame.fontSizePt;
      const layout = layoutParagraphText({
        text: frame.text,
        maxWidthPt: frame.widthPt,
        fontSizePt: frame.fontSizePt,
        leadingPt: frame.leadingPt,
        align: frame.align,
        ascentPt,
        measureText: (t) => measureTextWidthPt(font, t, frame.fontSizePt, tracking),
      });
      const slack = Math.max(0, frame.heightPt - layout.totalHeightPt);
      const vShift = frame.verticalAlign === 'middle' ? slack / 2 : frame.verticalAlign === 'bottom' ? slack : 0;
      // Accumulate every glyph's outline into one path, then fill (or fill+stroke) it once.
      const glyphOps: GlyphPathOp[] = [];
      for (const line of layout.lines) {
        if (line.baselineYPt > frame.heightPt + frame.fontSizePt) continue;
        const baselineYPt = mediaHpt - (frame.yTopPt + vShift + line.baselineYPt);
        for (const segment of line.runs) {
          if (!segment.text) continue;
          const run = outlineTextRun(font, segment.text, frame.fontSizePt, frame.xPt + segment.xPt, baselineYPt, tracking);
          for (const glyphOp of run.ops) glyphOps.push(glyphOp);
        }
      }
      if (glyphOps.length === 0) continue;
      assertCmykPaintWithinInkLimit(frame.cmyk, inkLimitPercent, `legacy-outline:${frame.fontId}`);
      const ink = frame.cmyk;
      const hasStroke = !!frame.strokeCmyk && (frame.strokeWidthPt ?? 0) > 0;
      const draw: PDFOperator[] = [pushGraphicsState()];
      // Rotate the whole block about the frame centre to match the editor's CSS transform (see helper).
      const textRotate = rotateAboutPivotOp(frame.rotationDeg, frame.centerXPt, frame.centerYTopPt, mediaHpt);
      if (textRotate) draw.push(textRotate);
      if (frame.spot) {
        // Spot-coloured text: fill the glyph outlines with the named /Separation ink → a real plate.
        const resName = ensureSpotCs(frame.spot.name, frame.spot.cmyk);
        draw.push(contentOp('cs', [PDFName.of(resName)]), contentOp('scn', [PDFNumber.of(Math.max(0, Math.min(1, frame.spot.tint)))]));
      } else {
        draw.push(contentOp('k', [PDFNumber.of(ink.c), PDFNumber.of(ink.m), PDFNumber.of(ink.y), PDFNumber.of(ink.k)]));
      }
      if (hasStroke) {
        assertCmykPaintWithinInkLimit(frame.strokeCmyk!, inkLimitPercent, `legacy-outline-stroke:${frame.fontId}`);
        const sInk = frame.strokeCmyk!;
        draw.push(contentOp('K', [PDFNumber.of(sInk.c), PDFNumber.of(sInk.m), PDFNumber.of(sInk.y), PDFNumber.of(sInk.k)]));
        draw.push(contentOp('w', [PDFNumber.of(frame.strokeWidthPt!)]));
        draw.push(contentOp('j', [PDFNumber.of(1)])); // round joins read cleaner on letterforms
      }
      for (const glyphOp of glyphOps) {
        if (glyphOp.op === 'm') draw.push(contentOp('m', [PDFNumber.of(glyphOp.x), PDFNumber.of(glyphOp.y)]));
        else if (glyphOp.op === 'l') draw.push(contentOp('l', [PDFNumber.of(glyphOp.x), PDFNumber.of(glyphOp.y)]));
        else if (glyphOp.op === 'c') draw.push(contentOp('c', [PDFNumber.of(glyphOp.x1), PDFNumber.of(glyphOp.y1), PDFNumber.of(glyphOp.x2), PDFNumber.of(glyphOp.y2), PDFNumber.of(glyphOp.x), PDFNumber.of(glyphOp.y)]));
        else draw.push(contentOp('h'));
      }
      draw.push(hasStroke ? contentOp('B') : contentOp('f')); // B = fill then stroke (nonzero winding)
      draw.push(popGraphicsState());
      pdfPage.pushOperators(...draw);
    }
  }

  // --- OutputIntent (/S /GTS_PDFX) with the embedded DestOutputProfile ---
  const outputIntent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    OutputConditionIdentifier: PDFString.of(options.profile.outputConditionIdentifier),
    OutputCondition: PDFString.of(options.profile.outputCondition ?? options.profile.outputConditionIdentifier),
    RegistryName: PDFString.of(options.profile.registryName ?? 'http://www.color.org'),
    Info: PDFString.of(options.profile.outputCondition ?? options.profile.outputConditionIdentifier),
    DestOutputProfile: iccRef,
  });
  doc.catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(outputIntent)]));

  // --- XMP metadata (authoritative PDF/X version carrier) ---
  const xmpStream = ctx.stream(utf8Bytes(buildXmp(meta, options, date)), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(xmpStream));

  // --- Document information dictionary ---
  doc.setTitle(options.title ?? 'Untitled');
  if (options.author) doc.setAuthor(options.author);
  doc.setCreator(options.creator ?? DEFAULT_CREATOR);
  doc.setProducer(options.producer ?? DEFAULT_CREATOR);
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  const infoRef = ctx.trailerInfo.Info;
  const info = infoRef ? ctx.lookupMaybe(infoRef, PDFDict) : undefined;
  if (info) {
    info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of(meta.version));
    if (meta.conformance) info.set(PDFName.of('GTS_PDFXConformance'), PDFString.of(meta.conformance));
    info.set(PDFName.of('Trapped'), PDFName.of('False'));
    info.set(PDFName.of('CreationDate'), PDFString.of(pdfDate(date)));
    info.set(PDFName.of('ModDate'), PDFString.of(pdfDate(date)));
    if (options.jobInfo?.jobName) info.set(PDFName.of('JobName'), PDFString.of(options.jobInfo.jobName));
    if (options.jobInfo?.jobNumber) info.set(PDFName.of('JobNumber'), PDFString.of(options.jobInfo.jobNumber));
    if (options.jobInfo?.client) info.set(PDFName.of('Client'), PDFString.of(options.jobInfo.client));
  }

  // --- Trailer /ID (required by PDF/X): two identical strings on first write ---
  const id = options.docId ?? randomDocId();
  const idString = PDFHexString.of(id);
  ctx.trailerInfo.ID = ctx.obj([idString, idString]);

  // Classic xref (no object/xref streams) keeps X-1a at PDF 1.4 and is valid for X-4 too.
  let bytes = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });

  // Stamp the header version (pdf-lib always writes %PDF-1.7).
  bytes = stampPdfVersion(bytes, meta.pdfVersion);

  return {
    bytes,
    standard: options.standard,
    pageCount: pages.length,
    profileName: options.transform.profileName,
    approximateColor: options.transform.kind !== 'icc',
    nativeEvidence,
  };
}

/** Rewrite the "%PDF-1.7" header to the target version (same byte length → xref offsets unaffected). */
function stampPdfVersion(bytes: Uint8Array, version: string): Uint8Array {
  // Header is "%PDF-1.x" at offset 0; replace the two chars after "%PDF-1.".
  const prefix = utf8Bytes('%PDF-');
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) return bytes; // unexpected header — leave untouched
  }
  const verBytes = utf8Bytes(version); // e.g. "1.4"
  bytes.set(verBytes, prefix.length);
  return bytes;
}
