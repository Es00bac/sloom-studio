import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import {
  buildPaperComicSfxFrames,
  normalizePaperComicSfxDesign,
  type PaperComicSfxDesign,
  type PaperComicSfxFrameDraft,
} from '../../lib/paperComicSfx';
import { createBitmap } from './LayerBitmap';
import { formatFontFamily } from '../../lib/formatFontFamily';

export type ImageComicLayerKind = 'speechBubble' | 'thoughtBubble' | 'caption' | 'panelBorder' | 'mangaSpeedLine';

export interface ComicLayerPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function buildComicLayerPlacement(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  kind: ImageComicLayerKind,
): ComicLayerPlacement {
  const width = kind === 'caption'
    ? Math.min(520, Math.max(180, Math.round(doc.width * 0.55)))
    : kind === 'panelBorder'
      ? Math.min(640, Math.max(220, Math.round(doc.width * 0.7)))
      : Math.min(420, Math.max(160, Math.round(doc.width * 0.42)));
  const height = kind === 'caption'
    ? Math.min(130, Math.max(56, Math.round(doc.height * 0.12)))
    : kind === 'panelBorder'
      ? Math.min(480, Math.max(180, Math.round(doc.height * 0.65)))
      : Math.min(240, Math.max(96, Math.round(doc.height * 0.2)));

  return {
    width,
    height,
    x: Math.round((doc.width - width) / 2),
    y: Math.round((doc.height - height) / 2),
  };
}

export function createComicMangaLayer(
  doc: ImageDocument,
  kind: ImageComicLayerKind,
  options: {
    fill?: string;
    stroke?: string;
    text?: string;
  } = {},
): ImageLayer {
  const placement = buildComicLayerPlacement(doc, kind);
  const bitmap = createBitmap(placement.width, placement.height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create a comic/manga layer canvas.');
  }

  const fill = options.fill ?? (kind === 'panelBorder' || kind === 'mangaSpeedLine' ? 'rgba(255,255,255,0)' : '#ffffff');
  const stroke = options.stroke ?? '#111827';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (kind === 'speechBubble') {
    drawSpeechBubble(ctx, placement.width, placement.height, fill, stroke);
    drawCenteredText(ctx, options.text ?? 'Dialogue', placement.width, placement.height, stroke);
  } else if (kind === 'thoughtBubble') {
    drawThoughtBubble(ctx, placement.width, placement.height, fill, stroke);
    drawCenteredText(ctx, options.text ?? 'Thought', placement.width, placement.height, stroke);
  } else if (kind === 'caption') {
    drawCaptionBox(ctx, placement.width, placement.height, fill, stroke);
    drawCenteredText(ctx, options.text ?? 'Narration', placement.width, placement.height, stroke);
  } else if (kind === 'mangaSpeedLine') {
    drawMangaSpeedLines(ctx, placement.width, placement.height, stroke);
  } else {
    drawPanelBorder(ctx, placement.width, placement.height, stroke);
  }

  return {
    id: `layer-comic-${kind}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: comicLayerLabel(kind),
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: placement.x,
    y: placement.y,
    bitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

export function createComicSfxLayer(doc: ImageDocument, design: PaperComicSfxDesign): ImageLayer {
  const { bitmap, height, normalizedDesign, width } = rasterizeComicSfxBitmap(doc, design);
  return {
    id: `layer-comic-sfx-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: `${normalizedDesign.text} SFX`,
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: Math.max(0, Math.round((doc.width - width) / 2)),
    y: Math.max(0, Math.round((doc.height - height) / 2)),
    bitmap,
    bitmapVersion: 0,
    mask: null,
    metadata: {
      comicSfxDesign: normalizedDesign,
    },
  };
}

export function buildComicSfxLayerUpdate(
  doc: ImageDocument,
  layer: ImageLayer,
  design: PaperComicSfxDesign,
): ImageLayer {
  const { bitmap, normalizedDesign } = rasterizeComicSfxBitmap(doc, design);
  return {
    ...layer,
    name: `${normalizedDesign.text} SFX`,
    bitmap,
    bitmapVersion: layer.bitmapVersion + 1,
    metadata: {
      ...layer.metadata,
      comicSfxDesign: normalizedDesign,
    },
  };
}

function rasterizeComicSfxBitmap(doc: ImageDocument, design: PaperComicSfxDesign): {
  bitmap: OffscreenCanvas;
  height: number;
  normalizedDesign: PaperComicSfxDesign;
  width: number;
} {
  const normalizedDesign = normalizePaperComicSfxDesign(design);
  const frames = buildPaperComicSfxFrames({
    presetId: normalizedDesign.presetId,
    design: normalizedDesign,
    idPrefix: 'image-comic-sfx',
    origin: { xMm: 12, yMm: 12 },
  }).frames.sort((a, b) => a.zIndex - b.zIndex);
  const bounds = computeSfxFrameBounds(frames);
  const pxPerMm = Math.max(3, Math.min(8, Math.min(doc.width / 220, doc.height / 150)));
  const paddingMm = 8;
  const width = Math.max(96, Math.ceil((bounds.widthMm + paddingMm * 2) * pxPerMm));
  const height = Math.max(48, Math.ceil((bounds.heightMm + paddingMm * 2) * pxPerMm));
  const bitmap = createBitmap(width, height);
  const ctx = bitmap.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create a comic SFX layer canvas.');
  }

  for (const frame of frames) {
    drawSfxFrame(ctx, frame, {
      minX: bounds.minX - paddingMm,
      minY: bounds.minY - paddingMm,
      pxPerMm,
    });
  }

  return {
    bitmap,
    height,
    normalizedDesign,
    width,
  };
}

function drawSpeechBubble(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  fill: string,
  stroke: string,
): void {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(3, Math.round(Math.min(width, height) * 0.025));
  ctx.beginPath();
  ctx.ellipse(width * 0.48, height * 0.43, width * 0.42, height * 0.32, 0, 0, Math.PI * 2);
  ctx.moveTo(width * 0.66, height * 0.69);
  ctx.lineTo(width * 0.84, height * 0.94);
  ctx.lineTo(width * 0.58, height * 0.74);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawThoughtBubble(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  fill: string,
  stroke: string,
): void {
  drawSpeechBubble(ctx, width, height * 0.88, fill, stroke);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.018));
  ctx.beginPath();
  ctx.ellipse(width * 0.72, height * 0.77, width * 0.07, width * 0.07, 0, 0, Math.PI * 2);
  ctx.ellipse(width * 0.82, height * 0.91, width * 0.04, width * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawCaptionBox(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  fill: string,
  stroke: string,
): void {
  const pad = Math.max(5, Math.round(Math.min(width, height) * 0.08));
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.025));
  ctx.fillRect(pad, pad, width - pad * 2, height - pad * 2);
  ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2);
}

function drawPanelBorder(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  stroke: string,
): void {
  const inset = Math.max(8, Math.round(Math.min(width, height) * 0.04));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(4, Math.round(Math.min(width, height) * 0.025));
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
}

function drawMangaSpeedLines(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  stroke: string,
): void {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.012));
  const cx = width * 0.5;
  const cy = height * 0.5;
  for (let index = 0; index < 34; index += 1) {
    const angle = (index / 34) * Math.PI * 2;
    const inner = Math.min(width, height) * (0.15 + (index % 5) * 0.018);
    const outer = Math.max(width, height) * 0.72;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }
}

function drawCenteredText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.font = `700 ${Math.max(18, Math.round(Math.min(width, height) * 0.16))}px Inter, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height * 0.45, width * 0.75);
}

function computeSfxFrameBounds(frames: PaperComicSfxFrameDraft[]): {
  minX: number;
  minY: number;
  widthMm: number;
  heightMm: number;
} {
  const minX = Math.min(...frames.map((frame) => frame.xMm));
  const minY = Math.min(...frames.map((frame) => frame.yMm));
  const maxX = Math.max(...frames.map((frame) => frame.xMm + frame.widthMm));
  const maxY = Math.max(...frames.map((frame) => frame.yMm + frame.heightMm));
  return {
    minX,
    minY,
    widthMm: Math.max(1, maxX - minX),
    heightMm: Math.max(1, maxY - minY),
  };
}

function drawSfxFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: PaperComicSfxFrameDraft,
  layout: { minX: number; minY: number; pxPerMm: number },
): void {
  const pxPerMm = layout.pxPerMm;
  const x = (frame.xMm - layout.minX) * pxPerMm;
  const y = (frame.yMm - layout.minY) * pxPerMm;
  const width = frame.widthMm * pxPerMm;
  const height = frame.heightMm * pxPerMm;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(((frame.rotationDeg ?? 0) * Math.PI) / 180);
  ctx.translate(-width / 2, -height / 2);
  ctx.globalAlpha = frame.opacity ?? 1;

  if (frame.kind === 'shape') {
    drawSfxShape(ctx, frame, width, height, pxPerMm);
  } else {
    drawSfxText(ctx, frame, width, height, pxPerMm);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawSfxShape(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: PaperComicSfxFrameDraft,
  width: number,
  height: number,
  pxPerMm: number,
): void {
  ctx.fillStyle = frame.fillColor ?? 'transparent';
  ctx.strokeStyle = frame.strokeColor ?? 'transparent';
  ctx.lineWidth = Math.max(0, (frame.strokeWidthMm ?? 0) * pxPerMm);
  ctx.globalAlpha = (frame.opacity ?? 1) * (frame.fillOpacity ?? 1);

  if (frame.shapeKind === 'polygon' && frame.vertices?.length) {
    ctx.beginPath();
    frame.vertices.forEach((vertex, index) => {
      const vx = (vertex.xPercent / 100) * width;
      const vy = (vertex.yPercent / 100) * height;
      if (index === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    });
    ctx.closePath();
    ctx.fill();
    if ((frame.strokeWidthMm ?? 0) > 0) {
      ctx.globalAlpha = (frame.opacity ?? 1) * (frame.strokeOpacity ?? 1);
      ctx.stroke();
    }
    return;
  }

  if (frame.shapeKind === 'line') {
    ctx.globalAlpha = (frame.opacity ?? 1) * (frame.strokeOpacity ?? 1);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    return;
  }

  ctx.beginPath();
  ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  if ((frame.strokeWidthMm ?? 0) > 0) {
    ctx.globalAlpha = (frame.opacity ?? 1) * (frame.strokeOpacity ?? 1);
    ctx.stroke();
  }
}

function drawSfxText(
  ctx: OffscreenCanvasRenderingContext2D,
  frame: PaperComicSfxFrameDraft,
  width: number,
  height: number,
  pxPerMm: number,
): void {
  const fontSize = Math.max(12, (frame.typography?.fontSizePt ?? 36) * pxPerMm * 0.38);
  const skewX = Math.tan(((frame.textSkewXDeg ?? 0) * Math.PI) / 180);
  const skewY = Math.tan(((frame.textSkewYDeg ?? 0) * Math.PI) / 180);
  ctx.translate(width / 2, height / 2);
  ctx.transform(1, skewY, skewX, 1, 0, 0);
  ctx.scale(frame.textScaleX ?? 1, frame.textScaleY ?? 1);
  ctx.font = `${frame.typography?.fontStyle ?? 'normal'} ${frame.typography?.fontWeight ?? '900'} ${Math.round(fontSize)}px ${formatFontFamily(frame.typography?.fontFamily ?? 'Impact, sans-serif')}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0, (frame.textStrokeWidthMm ?? 0) * pxPerMm * 0.72);
  ctx.strokeStyle = frame.textStrokeColor ?? '#111111';
  ctx.fillStyle = frame.typography?.color ?? '#ffffff';
  ctx.shadowColor = frame.textShadowColor ?? 'transparent';
  ctx.shadowBlur = Math.max(0, (frame.textShadowBlurMm ?? 0) * pxPerMm);
  ctx.shadowOffsetX = (frame.textShadowOffsetXMm ?? 0) * pxPerMm;
  ctx.shadowOffsetY = (frame.textShadowOffsetYMm ?? 0) * pxPerMm;
  if ((frame.textStrokeWidthMm ?? 0) > 0) {
    ctx.strokeText(frame.text ?? '', 0, 0, width * 0.96);
  }
  ctx.fillText(frame.text ?? '', 0, 0, width * 0.96);
}

function comicLayerLabel(kind: ImageComicLayerKind): string {
  switch (kind) {
    case 'speechBubble':
      return 'Speech Bubble';
    case 'thoughtBubble':
      return 'Thought Bubble';
    case 'caption':
      return 'Caption Box';
    case 'panelBorder':
      return 'Comic Panel Border';
    case 'mangaSpeedLine':
      return 'Manga Speed Lines';
  }
}
