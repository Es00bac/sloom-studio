// Canvas layer for deterministic managed Paper text. It paints HarfBuzz-positioned glyph paths, while the
// browser's contentEditable surface remains available only when the user enters text editing mode.

import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties, type MouseEventHandler } from 'react';
import type { PaperDocument, PaperFrame, PaperManagedFontFace } from '../../../types/paper';
import type { BinaryAssetRef } from '../../../shared/assets/contentAddressedAsset';
import { verifyBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import {
  composePaperTextFrame,
  type PaperComposedEmphasisMark,
  type PaperComposedParagraphBox,
  type PaperComposedTextFrame,
  type PaperManagedFontResolver,
  type PaperPositionedGlyphRun,
} from '../../../lib/paperTextComposition';
import { createHarfBuzzPaperTextShaper, type PaperTextShaper } from '../../../lib/paperTextShaper';
import { paperAssetRepository } from '../assets/PaperAssetRuntime';

const PT_TO_PX = 96 / 72;

interface ManagedLayerState {
  sourceKey: string;
  fontsKey: string;
  document: Pick<PaperDocument, 'importedFonts'> & Partial<Pick<PaperDocument, 'layout'>>;
  frame: PaperFrame;
  composition: PaperComposedTextFrame;
  shapers: Map<string, PaperTextShaper>;
}

export interface PaperManagedTextLayerProps {
  /** A supplied composition is useful for pure preview/export tests and avoids touching the asset repository. */
  composition?: PaperComposedTextFrame;
  document?: Pick<PaperDocument, 'importedFonts'> & Partial<Pick<PaperDocument, 'layout'>>;
  frame?: PaperFrame;
  zoom: number;
  /** Optional direct outline resolver for tests or an already-owned export renderer. */
  glyphPathFor?: (face: PaperManagedFontFace, glyphId: number, variations?: Record<string, number>) => string | undefined;
  onReadyChange?: (ready: boolean) => void;
  onDoubleClick?: MouseEventHandler<SVGSVGElement>;
  /** Editor-only composed line guides. They are never used by Paper's export renderers. */
  showBaselines?: boolean;
  style?: CSSProperties;
}

function refsMatch(left: BinaryAssetRef, right: BinaryAssetRef): boolean {
  return left.id === right.id
    && left.sha256 === right.sha256
    && left.mimeType === right.mimeType
    && left.byteLength === right.byteLength;
}

function documentFontKey(document: PaperManagedTextLayerProps['document']): string {
  return JSON.stringify({
    importedFonts: document?.importedFonts ?? [],
    baselineGrid: document?.layout?.baselineGrid,
  });
}

function frameKey(frame: PaperFrame | undefined): string {
  if (!frame) return '';
  return JSON.stringify({
    id: frame.id,
    kind: frame.kind,
    text: frame.text,
    richText: frame.richText,
    typography: frame.typography,
    widthMm: frame.widthMm,
    heightMm: frame.heightMm,
    columns: frame.columns,
    columnGutterMm: frame.columnGutterMm,
    textBoxXPercent: frame.textBoxXPercent,
    textBoxYPercent: frame.textBoxYPercent,
    textBoxWidthPercent: frame.textBoxWidthPercent,
    textBoxHeightPercent: frame.textBoxHeightPercent,
    textVerticalAlign: frame.textVerticalAlign,
  });
}

function runBounds(run: PaperPositionedGlyphRun): { xPt: number; yPt: number; widthPt: number; heightPt: number; vertical: boolean } | undefined {
  if (run.glyphs.length === 0) return undefined;
  const vertical = (run.advanceYPt ?? 0) > (run.advanceXPt ?? 0);
  const rotated = run.glyphRotationDeg === 90;
  const minX = Math.min(...run.glyphs.map((glyph) => glyph.xPt - run.fontSizePt * (rotated ? 0.24 : 0.08)));
  const minY = Math.min(...run.glyphs.map((glyph) => glyph.yPt - run.fontSizePt * (rotated ? 0.08 : 0.82)));
  const maxX = Math.max(...run.glyphs.map((glyph) => glyph.xPt + run.fontSizePt * (rotated ? 0.82 : 0.88)));
  const maxY = Math.max(...run.glyphs.map((glyph) => glyph.yPt + run.fontSizePt * (rotated ? 0.88 : 0.24)));
  return { xPt: minX, yPt: minY, widthPt: Math.max(0, maxX - minX), heightPt: Math.max(0, maxY - minY), vertical };
}

function PaperManagedParagraphBox({ box }: { box: PaperComposedParagraphBox }) {
  const border = box.borders;
  return (
    <g>
      {box.fill ? <rect fill={box.fill.color} height={box.heightPt} width={box.widthPt} x={box.xPt} y={box.yPt} /> : null}
      {border?.top ? <line stroke={border.top.color} strokeWidth={border.top.widthPt} x1={box.xPt} x2={box.xPt + box.widthPt} y1={box.yPt} y2={box.yPt} /> : null}
      {border?.right ? <line stroke={border.right.color} strokeWidth={border.right.widthPt} x1={box.xPt + box.widthPt} x2={box.xPt + box.widthPt} y1={box.yPt} y2={box.yPt + box.heightPt} /> : null}
      {border?.bottom ? <line stroke={border.bottom.color} strokeWidth={border.bottom.widthPt} x1={box.xPt} x2={box.xPt + box.widthPt} y1={box.yPt + box.heightPt} y2={box.yPt + box.heightPt} /> : null}
      {border?.left ? <line stroke={border.left.color} strokeWidth={border.left.widthPt} x1={box.xPt} x2={box.xPt} y1={box.yPt} y2={box.yPt + box.heightPt} /> : null}
    </g>
  );
}

function sesamePath(mark: PaperComposedEmphasisMark): string {
  const { xPt: x, yPt: y, radiusPt: radius } = mark;
  return [
    `M ${x} ${y - radius}`,
    `C ${x + radius * 0.85} ${y - radius * 0.45} ${x + radius} ${y + radius * 0.45} ${x} ${y + radius}`,
    `C ${x - radius * 0.5} ${y + radius * 0.25} ${x - radius * 0.45} ${y - radius * 0.4} ${x} ${y - radius} Z`,
  ].join(' ');
}

function PaperManagedEmphasisMark({ mark }: { mark: PaperComposedEmphasisMark }) {
  const strokeWidth = Math.max(0.35, mark.radiusPt * 0.35);
  return (
    <g data-paper-emphasis-style={mark.style}>
      {mark.style === 'sesame' ? (
        <path d={sesamePath(mark)} fill={mark.color.color} />
      ) : (
        <circle
          cx={mark.xPt}
          cy={mark.yPt}
          fill={mark.style === 'open-dot' ? 'none' : mark.color.color}
          r={mark.radiusPt}
          stroke={mark.style === 'open-dot' ? mark.color.color : undefined}
          strokeWidth={mark.style === 'open-dot' ? strokeWidth : undefined}
        />
      )}
    </g>
  );
}

function PaperManagedGlyphRun({
  pathFor,
  run,
}: {
  pathFor: (face: PaperManagedFontFace, glyphId: number, variations?: Record<string, number>) => string | undefined;
  run: PaperPositionedGlyphRun;
}) {
  const bounds = runBounds(run);
  const decorationWidth = Math.max(0.45, run.fontSizePt * 0.055);
  return (
    <g fill={run.color.color}>
      {run.decorations?.highlight && bounds ? (
        <rect fill={run.decorations.highlight} height={bounds.heightPt} width={bounds.widthPt} x={bounds.xPt} y={bounds.yPt} />
      ) : null}
      {run.decorations?.underline && bounds ? (
        bounds.vertical
          ? <line stroke={run.color.color} strokeWidth={decorationWidth} x1={bounds.xPt + bounds.widthPt} x2={bounds.xPt + bounds.widthPt} y1={bounds.yPt} y2={bounds.yPt + bounds.heightPt} />
          : <line stroke={run.color.color} strokeWidth={decorationWidth} x1={bounds.xPt} x2={bounds.xPt + bounds.widthPt} y1={bounds.yPt + bounds.heightPt} y2={bounds.yPt + bounds.heightPt} />
      ) : null}
      {run.decorations?.strike && bounds ? (
        bounds.vertical
          ? <line stroke={run.color.color} strokeWidth={decorationWidth} x1={bounds.xPt + bounds.widthPt / 2} x2={bounds.xPt + bounds.widthPt / 2} y1={bounds.yPt} y2={bounds.yPt + bounds.heightPt} />
          : <line stroke={run.color.color} strokeWidth={decorationWidth} x1={bounds.xPt} x2={bounds.xPt + bounds.widthPt} y1={bounds.yPt + bounds.heightPt * 0.55} y2={bounds.yPt + bounds.heightPt * 0.55} />
      ) : null}
      {run.glyphs.map((glyph, glyphIndex) => {
        const path = pathFor(run.face, glyph.glyphId, run.variations);
        if (!path) return null;
        const scale = run.fontSizePt / Math.max(1, run.unitsPerEm);
        return (
          <path
            d={path}
            key={`${glyphIndex}-${glyph.glyphId}-${glyph.cluster}`}
            transform={`translate(${glyph.xPt} ${glyph.yPt})${run.glyphRotationDeg ? ` rotate(${run.glyphRotationDeg})` : ''} scale(${scale} ${-scale})`}
          />
        );
      })}
    </g>
  );
}

/**
 * Render the exact glyph paths selected by `composePaperTextFrame`. A composition with missing fonts or glyphs
 * intentionally paints nothing; the caller can keep its non-production browser preview visible in that case.
 */
export function PaperManagedTextLayer({
  composition: suppliedComposition,
  document,
  frame,
  zoom,
  glyphPathFor,
  onReadyChange,
  onDoubleClick,
  showBaselines = false,
  style,
}: PaperManagedTextLayerProps) {
  const [automatic, setAutomatic] = useState<ManagedLayerState>();
  const fontsKey = useMemo(() => documentFontKey(document), [document]);
  const sourceKey = useMemo(() => frameKey(frame), [frame]);

  useEffect(() => {
    if (suppliedComposition || !document || !frame) return undefined;
    let active = true;
    const shapers = new Map<string, PaperTextShaper>();
    const resolver: PaperManagedFontResolver = async (face) => {
      const existing = shapers.get(face.id);
      if (existing) return existing;
      const record = await paperAssetRepository.get(face.fontAsset.id);
      if (!record || !refsMatch(record.ref, face.fontAsset) || !(await verifyBinaryAssetRecord(record))) return undefined;
      if (!active) return undefined;
      const shaper = await createHarfBuzzPaperTextShaper(record.bytes, { collectionIndex: face.collectionIndex });
      if (!active) {
        shaper.destroy();
        return undefined;
      }
      shapers.set(face.id, shaper);
      return shaper;
    };

    void composePaperTextFrame(frame, document, resolver)
      .then((composition) => {
        if (active) setAutomatic({ sourceKey, fontsKey, document, frame, composition, shapers });
        else {
          shapers.forEach((shaper) => shaper.destroy());
          shapers.clear();
        }
      })
      .catch(() => {
        shapers.forEach((shaper) => shaper.destroy());
        shapers.clear();
      });

    return () => {
      active = false;
      shapers.forEach((shaper) => shaper.destroy());
    };
  }, [document, fontsKey, frame, sourceKey, suppliedComposition]);

  const state = suppliedComposition
    || automatic?.sourceKey !== sourceKey
    || automatic.fontsKey !== fontsKey
    || automatic.document !== document
    || automatic.frame !== frame
    ? undefined
    : automatic;
  const composition = suppliedComposition ?? state?.composition;
  const hasGlyphs = Boolean(composition?.lines.some((line) => line.runs.some((run) => run.glyphs.length > 0)));
  const hasOutlineResolver = Boolean(glyphPathFor || state?.shapers.size);
  const ready = Boolean(
    composition
    && composition.missingFaces.length === 0
    && composition.missingGlyphs.length === 0
    && (!hasGlyphs || hasOutlineResolver),
  );

  useLayoutEffect(() => {
    onReadyChange?.(ready);
  }, [onReadyChange, ready]);

  if (!composition || !ready) return null;
  const { bounds } = composition;
  const pathFor = glyphPathFor ?? ((face: PaperManagedFontFace, glyphId: number, variations?: Record<string, number>) => {
    try {
      return state?.shapers.get(face.id)?.glyphPath(glyphId, variations);
    } catch {
      return undefined;
    }
  });

  return (
    <svg
      aria-hidden
      className="absolute overflow-hidden"
      data-paper-managed-text="ready"
      onDoubleClick={onDoubleClick}
      preserveAspectRatio="none"
      style={{
        left: bounds.xPt * PT_TO_PX * zoom,
        top: bounds.yPt * PT_TO_PX * zoom,
        width: bounds.widthPt * PT_TO_PX * zoom,
        height: bounds.heightPt * PT_TO_PX * zoom,
        pointerEvents: onDoubleClick ? 'auto' : 'none',
        ...style,
      }}
      viewBox={`${bounds.xPt} ${bounds.yPt} ${bounds.widthPt} ${bounds.heightPt}`}
    >
      {composition.paragraphBoxes?.map((box, index) => <PaperManagedParagraphBox box={box} key={`paragraph-${index}`} />)}
      {showBaselines ? (
        <g
          data-paper-editor-overlay="text-baselines"
          fill="none"
          opacity={0.8}
          pointerEvents="none"
          stroke="#22d3ee"
          strokeDasharray="3 2"
          strokeWidth={0.55}
        >
          {composition.lines.map((line, lineIndex) => composition.writingMode === 'vertical-rl' ? (
            <line
              key={`baseline-${lineIndex}`}
              vectorEffect="non-scaling-stroke"
              x1={line.originXPt}
              x2={line.originXPt}
              y1={line.layoutBounds?.yPt ?? bounds.yPt}
              y2={(line.layoutBounds?.yPt ?? bounds.yPt) + (line.layoutBounds?.heightPt ?? bounds.heightPt)}
            />
          ) : (
            <line
              key={`baseline-${lineIndex}`}
              vectorEffect="non-scaling-stroke"
              x1={line.layoutBounds?.xPt ?? bounds.xPt}
              x2={(line.layoutBounds?.xPt ?? bounds.xPt) + (line.layoutBounds?.widthPt ?? bounds.widthPt)}
              y1={line.originYPt}
              y2={line.originYPt}
            />
          ))}
        </g>
      ) : null}
      {composition.lines.flatMap((line, lineIndex) => line.runs.map((run, runIndex) => (
        <PaperManagedGlyphRun key={`${lineIndex}-${runIndex}`} pathFor={pathFor} run={run} />
      )))}
      {composition.emphasisMarks?.map((mark, index) => (
        <PaperManagedEmphasisMark key={`emphasis-${index}`} mark={mark} />
      ))}
    </svg>
  );
}
