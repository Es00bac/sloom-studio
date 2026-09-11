// Native PDF/X content writer for the typed Paper render plan. It keeps authored CMYK/spot values and
// managed font bytes inspectable in the PDF instead of deriving final print output from a browser raster.

import fontkit from '@pdf-lib/fontkit';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  type PDFFont,
  type PDFPage,
  concatTransformationMatrix,
  endText,
  fill,
  fillAndStroke,
  popGraphicsState,
  pushGraphicsState,
  setFillingCmykColor,
  setFillingGrayscaleColor,
  setFontAndSize as setNativeFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingCmykColor,
  setStrokingGrayscaleColor,
  setTextMatrix,
  showText,
  beginText,
  stroke,
  type LineCapStyle,
  type LineJoinStyle,
} from 'pdf-lib';
import { svgPathToOperators } from 'pdf-lib/cjs/api/svgPath';
import type { IccCmykTransform } from './paperColorManagement';
import type {
  PaperAffineTransform,
  PaperFlattenGroup,
  PaperRenderImageNode,
  PaperRenderNode,
  PaperRenderPathNode,
  PaperRenderTextNode,
} from './paperRenderPlan';
import type { PaperPrintPaint } from './paperPrintPaint';
import { assertCmykPaintWithinInkLimit } from './paperInkLimit';
import type { PaperManagedFontFace } from '../types/paper';

export type PaperPdfxNativeStandard = 'pdf-x-1a' | 'pdf-x-4';

export interface PaperPdfxNativeEvidence {
  processObjectIds: string[];
  spotPlates: Array<{ name: string; objectIds: string[] }>;
  embeddedFontIds: string[];
  outlinedObjectIds: string[];
  flattenedObjectIds: Array<{ objectId: string; reasons: string[] }>;
  overprintObjectIds: string[];
}

interface SpotDefinition {
  alternate: { c: number; m: number; y: number; k: number };
  colorSpaceRef?: ReturnType<PDFDocument['context']['register']>;
}

export interface PaperPdfxNativeContext {
  pdf: PDFDocument;
  standard: PaperPdfxNativeStandard;
  /** Full media height, in PDF points. Render-plan coordinates are top-left/y-down. */
  mediaHeightPt: number;
  /** Translate authored bleed-media coordinates into an expanded marks/slug sheet. */
  coordinateOffsetPt?: { x: number; y: number };
  transform: IccCmykTransform;
  /** Loads the exact content-addressed bytes of one authorized managed face. */
  loadManagedFontBytes: (face: PaperManagedFontFace) => Promise<Uint8Array>;
  /** PDF document-wide managed-font cache; pass one cache across all pages. */
  fontCache: Map<string, PDFFont>;
  /** PDF document-wide spot definitions; same name must always resolve to the same alternate. */
  spotDefinitions: Map<string, SpotDefinition>;
  /** TAC is measured and blocks output; authored CMYK is never rewritten. */
  totalInkLimitPercent?: number;
  /** Hosts rasterize only deliberate flatten groups through the selected ICC transform. */
  appendFlattenedGroup?: (group: PaperFlattenGroup, evidence: PaperPdfxNativeEvidence) => Promise<void>;
  /** Hosts emit managed image nodes as CMYK image XObjects. */
  appendImage?: (image: PaperRenderImageNode, evidence: PaperPdfxNativeEvidence) => Promise<void>;
}

interface CmykPaint {
  c: number;
  m: number;
  y: number;
  k: number;
}

function emptyEvidence(): PaperPdfxNativeEvidence {
  return {
    processObjectIds: [],
    spotPlates: [],
    embeddedFontIds: [],
    outlinedObjectIds: [],
    flattenedObjectIds: [],
    overprintObjectIds: [],
  };
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function contentOp(name: string, args: (PDFName | PDFNumber)[] = []): PDFOperator {
  return PDFOperator.of(name as unknown as Parameters<typeof PDFOperator.of>[0], args);
}

function sameAlternate(left: CmykPaint, right: CmykPaint): boolean {
  return Math.abs(left.c - right.c) < 0.000001
    && Math.abs(left.m - right.m) < 0.000001
    && Math.abs(left.y - right.y) < 0.000001
    && Math.abs(left.k - right.k) < 0.000001;
}

function encodePdfName(name: string): string {
  let out = '';
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    const regular = code > 0x20 && code < 0x7f && !'#()<>[]{}/%'.includes(char);
    out += regular ? char : `#${code.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function cmykForPaint(paint: Exclude<PaperPrintPaint, { kind: 'spot' | 'gray' }>, transform: IccCmykTransform): CmykPaint {
  if (paint.kind === 'process-cmyk') {
    return {
      c: clampUnit(paint.c) * clampUnit(paint.tint),
      m: clampUnit(paint.m) * clampUnit(paint.tint),
      y: clampUnit(paint.y) * clampUnit(paint.tint),
      k: clampUnit(paint.k) * clampUnit(paint.tint),
    };
  }
  const converted = transform.rgbToCmyk({ r: clampUnit(paint.r) * 255, g: clampUnit(paint.g) * 255, b: clampUnit(paint.b) * 255 });
  return { c: clampUnit(converted.c / 100), m: clampUnit(converted.m / 100), y: clampUnit(converted.y / 100), k: clampUnit(converted.k / 100) };
}

function mediaTransform(
  transform: PaperAffineTransform | undefined,
  mediaHeightPt: number,
  coordinateOffsetPt: { x: number; y: number } = { x: 0, y: 0 },
): [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = transform ?? [1, 0, 0, 1, 0, 0];
  // Combine the render-plan's y-down affine with the single PDF y-up conversion in one matrix.
  return [a, -b, c, -d, e + coordinateOffsetPt.x, mediaHeightPt - f - coordinateOffsetPt.y];
}

function dashFor(style: PaperRenderPathNode['strokeStyle'], width: number): number[] | undefined {
  const unit = Math.max(0.5, width);
  if (style === 'dashed') return [unit * 3, unit * 2];
  if (style === 'dotted') return [0, unit * 2];
  return undefined;
}

function graphicsState(
  page: PDFPage,
  context: PaperPdfxNativeContext,
  values: { opacity: number; fillOpacity: number; strokeOpacity: number; overprint: boolean },
): PDFName | undefined {
  const fillOpacity = clampUnit(values.opacity) * clampUnit(values.fillOpacity);
  const strokeOpacity = clampUnit(values.opacity) * clampUnit(values.strokeOpacity);
  const usesTransparency = fillOpacity < 1 || strokeOpacity < 1;
  if (context.standard === 'pdf-x-1a' && usesTransparency) {
    throw new Error('PDF/X-1a cannot preserve live transparency; flatten this object before export.');
  }
  if (!usesTransparency && !values.overprint) return undefined;
  const prefix = values.overprint ? 'GSOP' : 'GS';
  const extGState = page.node.normalizedEntries().ExtGState;
  let index = 1;
  let name = PDFName.of(`${prefix}${index}`);
  while (extGState.has(name)) name = PDFName.of(`${prefix}${++index}`);
  const dict = context.pdf.context.obj({
    Type: 'ExtGState',
    ...(usesTransparency ? { ca: fillOpacity, CA: strokeOpacity } : {}),
    ...(values.overprint ? { OP: true, op: true, OPM: 1 } : {}),
  });
  page.node.setExtGState(name, context.pdf.context.register(dict));
  return name;
}

function spotResource(
  page: PDFPage,
  paint: Extract<PaperPrintPaint, { kind: 'spot' }>,
  context: PaperPdfxNativeContext,
): string {
  const alternate = {
    c: clampUnit(paint.alternate.c),
    m: clampUnit(paint.alternate.m),
    y: clampUnit(paint.alternate.y),
    k: clampUnit(paint.alternate.k),
  };
  const known = context.spotDefinitions.get(paint.name);
  if (known && !sameAlternate(known.alternate, alternate)) {
    throw new Error(`Spot color "${paint.name}" has a different alternate CMYK recipe in this PDF/X export.`);
  }
  const definition = known ?? { alternate };
  if (!definition.colorSpaceRef) {
    const tintFunction = context.pdf.context.obj({
      FunctionType: 2,
      Domain: [0, 1],
      C0: [0, 0, 0, 0],
      C1: [alternate.c, alternate.m, alternate.y, alternate.k],
      N: 1,
    });
    definition.colorSpaceRef = context.pdf.context.register(context.pdf.context.obj([
      PDFName.of('Separation'),
      PDFName.of(encodePdfName(paint.name)),
      PDFName.of('DeviceCMYK'),
      context.pdf.context.register(tintFunction),
    ]));
    context.spotDefinitions.set(paint.name, definition);
  }
  const resources = page.node.Resources() ?? context.pdf.context.obj({});
  let colorSpaces = resources.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
  if (!colorSpaces) {
    colorSpaces = context.pdf.context.obj({});
    resources.set(PDFName.of('ColorSpace'), colorSpaces);
  }
  page.node.set(PDFName.of('Resources'), resources);
  let index = 1;
  let resource = `SP${index}`;
  while (colorSpaces.has(PDFName.of(resource))) resource = `SP${++index}`;
  colorSpaces.set(PDFName.of(resource), definition.colorSpaceRef);
  return resource;
}

function paintOperators(
  page: PDFPage,
  paint: PaperPrintPaint,
  target: 'fill' | 'stroke',
  context: PaperPdfxNativeContext,
  objectId: string,
): PDFOperator[] {
  if (paint.kind === 'spot') {
    assertCmykPaintWithinInkLimit({
      c: clampUnit(paint.alternate.c) * clampUnit(paint.tint),
      m: clampUnit(paint.alternate.m) * clampUnit(paint.tint),
      y: clampUnit(paint.alternate.y) * clampUnit(paint.tint),
      k: clampUnit(paint.alternate.k) * clampUnit(paint.tint),
    }, context.totalInkLimitPercent, objectId);
    const resource = spotResource(page, paint, context);
    return target === 'fill'
      ? [contentOp('cs', [PDFName.of(resource)]), contentOp('scn', [PDFNumber.of(clampUnit(paint.tint))])]
      : [contentOp('CS', [PDFName.of(resource)]), contentOp('SCN', [PDFNumber.of(clampUnit(paint.tint))])];
  }
  if (paint.kind === 'gray') {
    // Paper gray percentage is ink coverage (1 = black), while DeviceGray is luminance (0 = black).
    const gray = 1 - clampUnit(paint.gray) * clampUnit(paint.tint);
    return [target === 'fill' ? setFillingGrayscaleColor(gray) : setStrokingGrayscaleColor(gray)];
  }
  const cmyk = cmykForPaint(paint, context.transform);
  assertCmykPaintWithinInkLimit(cmyk, context.totalInkLimitPercent, objectId);
  return [target === 'fill'
    ? setFillingCmykColor(cmyk.c, cmyk.m, cmyk.y, cmyk.k)
    : setStrokingCmykColor(cmyk.c, cmyk.m, cmyk.y, cmyk.k)];
}

function addSpotEvidence(evidence: PaperPdfxNativeEvidence, name: string, objectId: string): void {
  const plate = evidence.spotPlates.find((candidate) => candidate.name === name);
  if (plate) plate.objectIds.push(objectId);
  else evidence.spotPlates.push({ name, objectIds: [objectId] });
}

function addPaintEvidence(evidence: PaperPdfxNativeEvidence, paint: PaperPrintPaint | undefined, objectId: string): void {
  if (!paint) return;
  if (paint.kind === 'spot') addSpotEvidence(evidence, paint.name, objectId);
  else if (!evidence.processObjectIds.includes(objectId)) evidence.processObjectIds.push(objectId);
}

function appendPath(
  node: PaperRenderPathNode,
  page: PDFPage,
  context: PaperPdfxNativeContext,
  evidence: PaperPdfxNativeEvidence,
): void {
  page.pushOperators(...pathOperators(node, page, context));
  addPaintEvidence(evidence, node.fill, node.objectId);
  addPaintEvidence(evidence, node.stroke, node.objectId);
  if (node.overprint && !evidence.overprintObjectIds.includes(node.objectId)) evidence.overprintObjectIds.push(node.objectId);
}

function textPath(
  text: PaperRenderTextNode,
  suffix: string,
  path: string,
  bounds: { x: number; y: number; width: number; height: number },
  paint: { fill?: PaperPrintPaint; stroke?: PaperPrintPaint; strokeWidthPt?: number },
): PaperRenderPathNode {
  return {
    kind: 'path',
    objectId: `${text.objectId}:${suffix}`,
    sourceFrameId: text.sourceFrameId,
    path,
    fill: paint.fill,
    stroke: paint.stroke,
    opacity: text.opacity,
    fillOpacity: 1,
    strokeOpacity: 1,
    strokeWidthPt: paint.strokeWidthPt ?? 0,
    strokeStyle: 'solid',
    overprint: text.overprint,
    transform: text.transform,
    boundsPt: bounds,
  };
}

function rectanglePath(x: number, y: number, width: number, height: number): string {
  return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
}

function runBounds(run: PaperRenderTextNode['composed']['lines'][number]['runs'][number]): { x: number; y: number; width: number; height: number; vertical: boolean } | undefined {
  if (run.glyphs.length === 0) return undefined;
  const vertical = (run.advanceYPt ?? 0) > (run.advanceXPt ?? 0);
  const rotated = run.glyphRotationDeg === 90;
  const minX = Math.min(...run.glyphs.map((glyph) => glyph.xPt - run.fontSizePt * (rotated ? 0.24 : 0.08)));
  const minY = Math.min(...run.glyphs.map((glyph) => glyph.yPt - run.fontSizePt * (rotated ? 0.08 : 0.82)));
  const maxX = Math.max(...run.glyphs.map((glyph) => glyph.xPt + run.fontSizePt * (rotated ? 0.82 : 0.88)));
  const maxY = Math.max(...run.glyphs.map((glyph) => glyph.yPt + run.fontSizePt * (rotated ? 0.88 : 0.24)));
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY), vertical };
}

function circlePath(x: number, y: number, radius: number): string {
  const k = 0.5522847498307936;
  return [
    `M ${x + radius} ${y}`,
    `C ${x + radius} ${y + radius * k} ${x + radius * k} ${y + radius} ${x} ${y + radius}`,
    `C ${x - radius * k} ${y + radius} ${x - radius} ${y + radius * k} ${x - radius} ${y}`,
    `C ${x - radius} ${y - radius * k} ${x - radius * k} ${y - radius} ${x} ${y - radius}`,
    `C ${x + radius * k} ${y - radius} ${x + radius} ${y - radius * k} ${x + radius} ${y} Z`,
  ].join(' ');
}

function sesamePath(x: number, y: number, radius: number): string {
  return [
    `M ${x} ${y - radius}`,
    `C ${x + radius * 0.85} ${y - radius * 0.45} ${x + radius} ${y + radius * 0.45} ${x} ${y + radius}`,
    `C ${x - radius * 0.5} ${y + radius * 0.25} ${x - radius * 0.45} ${y - radius * 0.4} ${x} ${y - radius} Z`,
  ].join(' ');
}

function pathOperators(node: PaperRenderPathNode, page: PDFPage, context: PaperPdfxNativeContext): PDFOperator[] {
  const state = graphicsState(page, context, {
    opacity: node.opacity,
    fillOpacity: node.fill ? node.fillOpacity : 1,
    strokeOpacity: node.stroke ? node.strokeOpacity : 1,
    overprint: node.overprint,
  });
  const transform = mediaTransform(node.transform, context.mediaHeightPt, context.coordinateOffsetPt);
  const operators: PDFOperator[] = [pushGraphicsState()];
  if (state) operators.push(setGraphicsState(state));
  operators.push(concatTransformationMatrix(...transform));
  if (node.fill) operators.push(...paintOperators(page, node.fill, 'fill', context, node.objectId));
  if (node.stroke) {
    operators.push(...paintOperators(page, node.stroke, 'stroke', context, node.objectId));
    operators.push(setLineWidth(Math.max(0, node.strokeWidthPt)));
    operators.push(setLineJoin(1 as LineJoinStyle), setLineCap(node.strokeStyle === 'dotted' ? 1 as LineCapStyle : 0 as LineCapStyle));
    const dash = dashFor(node.strokeStyle, node.strokeWidthPt);
    if (dash) operators.push(contentOp('d', [PDFNumber.of(dash[0]), PDFNumber.of(dash[1]), PDFNumber.of(0)]));
  }
  operators.push(...svgPathToOperators(node.path));
  if (node.fill && node.stroke) operators.push(fillAndStroke());
  else if (node.fill) operators.push(fill());
  else if (node.stroke) operators.push(stroke());
  operators.push(popGraphicsState());
  return operators;
}

async function embeddedFont(page: PDFPage, face: PaperManagedFontFace, context: PaperPdfxNativeContext): Promise<{ font: PDFFont; resource: PDFName }> {
  let font = context.fontCache.get(face.id);
  if (!font) {
    const bytes = await context.loadManagedFontBytes(face);
    if (!bytes.byteLength) throw new Error(`Managed font ${face.id} is empty and cannot be embedded.`);
    context.pdf.registerFontkit(fontkit);
    // Positioned HarfBuzz glyph IDs are the layout authority. Keep an Identity-H full-face mapping so each
    // glyph can be shown at its exact composed coordinate rather than re-shaped through a second engine.
    font = await context.pdf.embedFont(bytes, { subset: false });
    context.fontCache.set(face.id, font);
  }
  const resource = page.node.newFontDictionary('F', font.ref);
  return { font, resource };
}

function paintForRun(node: PaperRenderTextNode, lineIndex: number, runIndex: number): PaperPrintPaint {
  const paint = node.paints.runs.find((candidate) => candidate.lineIndex === lineIndex && candidate.runIndex === runIndex)?.fill;
  if (!paint) throw new Error(`Rich text run ${node.objectId}:${lineIndex}:${runIndex} has no resolved print paint.`);
  return paint;
}

function appendParagraphBoxes(node: PaperRenderTextNode, page: PDFPage, context: PaperPdfxNativeContext, evidence: PaperPdfxNativeEvidence): void {
  for (const [index, box] of (node.composed.paragraphBoxes ?? []).entries()) {
    const paints = node.paints.paragraphBoxes.find((candidate) => candidate.paragraphIndex === index);
    const bounds = { x: box.xPt, y: box.yPt, width: box.widthPt, height: box.heightPt };
    if (paints?.fill) {
      appendPath(textPath(node, `paragraph:${index}:fill`, rectanglePath(box.xPt, box.yPt, box.widthPt, box.heightPt), bounds, { fill: paints.fill }), page, context, evidence);
    }
    const borders = paints?.borders;
    const edge = (name: 'top' | 'right' | 'bottom' | 'left', path: string, width: number | undefined) => {
      const paint = borders?.[name];
      if (!paint || !width || width <= 0) return;
      appendPath(textPath(node, `paragraph:${index}:${name}`, path, bounds, { stroke: paint, strokeWidthPt: width }), page, context, evidence);
    };
    edge('top', `M ${box.xPt} ${box.yPt} L ${box.xPt + box.widthPt} ${box.yPt}`, box.borders?.top?.widthPt);
    edge('right', `M ${box.xPt + box.widthPt} ${box.yPt} L ${box.xPt + box.widthPt} ${box.yPt + box.heightPt}`, box.borders?.right?.widthPt);
    edge('bottom', `M ${box.xPt} ${box.yPt + box.heightPt} L ${box.xPt + box.widthPt} ${box.yPt + box.heightPt}`, box.borders?.bottom?.widthPt);
    edge('left', `M ${box.xPt} ${box.yPt} L ${box.xPt} ${box.yPt + box.heightPt}`, box.borders?.left?.widthPt);
  }
}

function appendRunDecorations(
  node: PaperRenderTextNode,
  lineIndex: number,
  runIndex: number,
  page: PDFPage,
  context: PaperPdfxNativeContext,
  evidence: PaperPdfxNativeEvidence,
  phase: 'background' | 'foreground',
): void {
  const run = node.composed.lines[lineIndex]?.runs[runIndex];
  const bounds = run ? runBounds(run) : undefined;
  if (!run || !bounds) return;
  const paint = node.paints.runs.find((candidate) => candidate.lineIndex === lineIndex && candidate.runIndex === runIndex);
  if (!paint) return;
  if (phase === 'background' && paint.highlight) {
    appendPath(textPath(node, `highlight:${lineIndex}:${runIndex}`, rectanglePath(bounds.x, bounds.y, bounds.width, bounds.height), bounds, { fill: paint.highlight }), page, context, evidence);
  }
  if (phase !== 'foreground') return;
  const width = Math.max(0.45, run.fontSizePt * 0.055);
  if (run.decorations?.underline) {
    const path = bounds.vertical
      ? `M ${bounds.x + bounds.width} ${bounds.y} L ${bounds.x + bounds.width} ${bounds.y + bounds.height}`
      : `M ${bounds.x} ${bounds.y + bounds.height} L ${bounds.x + bounds.width} ${bounds.y + bounds.height}`;
    appendPath(textPath(node, `underline:${lineIndex}:${runIndex}`, path, bounds, { stroke: paint.fill, strokeWidthPt: width }), page, context, evidence);
  }
  if (run.decorations?.strike) {
    const path = bounds.vertical
      ? `M ${bounds.x + bounds.width / 2} ${bounds.y} L ${bounds.x + bounds.width / 2} ${bounds.y + bounds.height}`
      : `M ${bounds.x} ${bounds.y + bounds.height * 0.55} L ${bounds.x + bounds.width} ${bounds.y + bounds.height * 0.55}`;
    appendPath(textPath(node, `strike:${lineIndex}:${runIndex}`, path, bounds, { stroke: paint.fill, strokeWidthPt: width }), page, context, evidence);
  }
}

function appendEmphasisMarks(node: PaperRenderTextNode, page: PDFPage, context: PaperPdfxNativeContext, evidence: PaperPdfxNativeEvidence): void {
  for (const [index, mark] of (node.composed.emphasisMarks ?? []).entries()) {
    const paint = node.paints.emphasisMarks[index];
    if (!paint) continue;
    const bounds = { x: mark.xPt - mark.radiusPt, y: mark.yPt - mark.radiusPt, width: mark.radiusPt * 2, height: mark.radiusPt * 2 };
    const path = mark.style === 'sesame'
      ? sesamePath(mark.xPt, mark.yPt, mark.radiusPt)
      : circlePath(mark.xPt, mark.yPt, mark.radiusPt);
    const markPaint = mark.style === 'open-dot'
      ? { stroke: paint, strokeWidthPt: Math.max(0.35, mark.radiusPt * 0.35) }
      : { fill: paint };
    appendPath(textPath(node, `emphasis:${index}:${mark.style}`, path, bounds, markPaint), page, context, evidence);
  }
}

function glyphTextMatrix(
  transform: [number, number, number, number, number, number],
  rotationDeg: number | undefined,
): [number, number, number, number] {
  const [a, b, c, d] = transform;
  const radians = (rotationDeg ?? 0) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  // Compose the page transform with the authored y-down rotation and the font-space y inversion.
  const matrix: [number, number, number, number] = [
    a * cosine + c * sine,
    b * cosine + d * sine,
    a * sine - c * cosine,
    b * sine - d * cosine,
  ];
  return matrix.map((value) => Math.abs(value) < 1e-12 ? 0 : value) as [number, number, number, number];
}

async function appendText(node: PaperRenderTextNode, page: PDFPage, context: PaperPdfxNativeContext, evidence: PaperPdfxNativeEvidence): Promise<void> {
  if (node.composed.missingFaces.length || node.composed.missingGlyphs.length) {
    throw new Error(`Managed text ${node.objectId} has unresolved fonts or glyphs and cannot be exported faithfully.`);
  }
  appendParagraphBoxes(node, page, context, evidence);
  for (const [lineIndex, line] of node.composed.lines.entries()) {
    for (const [runIndex, run] of line.runs.entries()) {
      if (run.glyphs.length === 0) continue;
      const { resource } = await embeddedFont(page, run.face, context);
      const paint = paintForRun(node, lineIndex, runIndex);
      const state = graphicsState(page, context, { opacity: node.opacity, fillOpacity: 1, strokeOpacity: 1, overprint: node.overprint });
      appendRunDecorations(node, lineIndex, runIndex, page, context, evidence, 'background');
      for (const glyph of run.glyphs) {
        if (!Number.isInteger(glyph.glyphId) || glyph.glyphId < 0 || glyph.glyphId > 0xffff) {
          throw new Error(`Managed text ${node.objectId} contains an unsupported glyph identifier.`);
        }
        const [a, b, c, d, e, f] = mediaTransform(node.transform, context.mediaHeightPt, context.coordinateOffsetPt);
        const x = a * glyph.xPt + c * glyph.yPt + e;
        const y = b * glyph.xPt + d * glyph.yPt + f;
        const [textA, textB, textC, textD] = glyphTextMatrix([a, b, c, d, e, f], run.glyphRotationDeg);
        const operators: PDFOperator[] = [pushGraphicsState()];
        if (state) operators.push(setGraphicsState(state));
        operators.push(...paintOperators(page, paint, 'fill', context, node.objectId));
        operators.push(
          beginText(),
          setNativeFontAndSize(resource, run.fontSizePt),
          // Glyph outlines are already y-up in font space. `mediaTransform` flips only authored page
          // coordinates, so compose it with the font-space y inversion instead of mirroring the glyphs.
          setTextMatrix(textA, textB, textC, textD, x, y),
          showText(PDFHexString.of(glyph.glyphId.toString(16).toUpperCase().padStart(4, '0'))),
          endText(),
          popGraphicsState(),
        );
        page.pushOperators(...operators);
      }
      appendRunDecorations(node, lineIndex, runIndex, page, context, evidence, 'foreground');
      addPaintEvidence(evidence, paint, node.objectId);
      if (!evidence.embeddedFontIds.includes(run.face.id)) evidence.embeddedFontIds.push(run.face.id);
      if (node.overprint && !evidence.overprintObjectIds.includes(node.objectId)) evidence.overprintObjectIds.push(node.objectId);
    }
  }
  appendEmphasisMarks(node, page, context, evidence);
}

async function appendNode(node: PaperRenderNode, page: PDFPage, context: PaperPdfxNativeContext, evidence: PaperPdfxNativeEvidence): Promise<void> {
  if (node.kind === 'path') {
    appendPath(node, page, context, evidence);
    return;
  }
  if (node.kind === 'text') {
    await appendText(node, page, context, evidence);
    return;
  }
  if (node.kind === 'image') {
    if (!context.appendImage) throw new Error(`Managed image ${node.objectId} has no CMYK image emitter.`);
    await context.appendImage(node, evidence);
    return;
  }
  evidence.flattenedObjectIds.push({ objectId: node.objectId, reasons: [...node.reasonCodes] });
  if (!context.appendFlattenedGroup) throw new Error(`Flatten group ${node.objectId} has no isolated raster source.`);
  await context.appendFlattenedGroup(node, evidence);
}

/** Append one render-plan page in authoring order and return inspectable native-output evidence. */
export async function appendPaperNativeContent(
  pdf: PDFDocument,
  page: PDFPage,
  nodes: readonly PaperRenderNode[],
  context: PaperPdfxNativeContext,
): Promise<PaperPdfxNativeEvidence> {
  if (context.pdf !== pdf) throw new Error('Native PDF/X context belongs to a different PDF document.');
  const evidence = emptyEvidence();
  for (const node of nodes) await appendNode(node, page, context, evidence);
  return evidence;
}
