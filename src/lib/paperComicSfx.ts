import type {
  PaperFrameKind,
  PaperFramePatch,
  PaperFrameVertex,
  PaperShapeKind,
  PaperTypography,
} from '../types/paper';

export const PAPER_COMIC_SFX_PRESET_IDS = [
  'bang',
  'kapow',
  'screech',
  'whirrrrr',
  'boom',
  'crash',
  'zap',
  'slam',
] as const;

export type PaperComicSfxPresetId = typeof PAPER_COMIC_SFX_PRESET_IDS[number];

export interface PaperComicSfxPreset {
  id: PaperComicSfxPresetId;
  label: string;
  text: string;
  fontFamily: string;
  fontSizePt: number;
  fillColor: string;
  strokeColor: string;
  strokeWidthMm: number;
  shadow: {
    color: string;
    offsetXMm: number;
    offsetYMm: number;
    blurMm: number;
  };
  warp: {
    skewXDeg: number;
    skewYDeg: number;
    scaleX: number;
    scaleY: number;
  };
  rotationDeg: number;
  tracking: number;
  trailingCopies: {
    count: number;
    offsetXMm: number;
    offsetYMm: number;
    scaleStep: number;
    opacityStep: number;
  };
  burst?: {
    fillColor: string;
    strokeColor: string;
    strokeWidthMm: number;
    points: number;
  };
  speedLines?: {
    count: number;
    color: string;
    strokeWidthMm: number;
    lengthMm: number;
    spacingMm: number;
    angleDeg: number;
    opacity: number;
  };
  halftone?: {
    count: number;
    color: string;
    radiusMm: number;
    spreadMm: number;
    opacity: number;
  };
}

export interface PaperComicSfxDesign {
  presetId: PaperComicSfxPresetId;
  text: string;
  fontFamily: string;
  fontSizePt: number;
  fillColor: string;
  strokeColor: string;
  strokeWidthMm: number;
  shadowColor: string;
  shadowOffsetXMm: number;
  shadowOffsetYMm: number;
  shadowBlurMm: number;
  skewXDeg: number;
  skewYDeg: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  tracking: number;
  trailingCopiesCount: number;
  trailOffsetXMm: number;
  trailOffsetYMm: number;
  trailScaleStep: number;
  trailOpacityStep: number;
  burstEnabled: boolean;
  burstFillColor: string;
  burstStrokeColor: string;
  burstStrokeWidthMm: number;
  burstPoints: number;
  speedLinesEnabled: boolean;
  speedLineCount: number;
  speedLineColor: string;
  speedLineStrokeWidthMm: number;
  speedLineLengthMm: number;
  speedLineSpacingMm: number;
  speedLineAngleDeg: number;
  speedLineOpacity: number;
  halftoneEnabled: boolean;
  halftoneCount: number;
  halftoneColor: string;
  halftoneRadiusMm: number;
  halftoneSpreadMm: number;
  halftoneOpacity: number;
}

export interface PaperComicSfxFrameDraft extends PaperFramePatch {
  id: string;
  kind: PaperFrameKind;
  label: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  zIndex: number;
  shapeKind?: PaperShapeKind;
  vertices?: PaperFrameVertex[];
  typography?: Partial<PaperTypography>;
}

export interface PaperComicSfxBuildOptions {
  presetId: PaperComicSfxPresetId;
  origin: { xMm: number; yMm: number };
  idPrefix?: string;
  text?: string;
  design?: PaperComicSfxDesign;
  zIndexStart?: number;
}

export interface PaperComicSfxBuildResult {
  preset: PaperComicSfxPreset;
  frames: PaperComicSfxFrameDraft[];
  primaryFrameId: string;
  selectedFrameIds: string[];
}

export interface PaperComicSfxDecalBuildResult {
  preset: PaperComicSfxPreset;
  frame: PaperComicSfxFrameDraft;
  primaryFrameId: string;
  selectedFrameIds: string[];
}

const PAPER_COMIC_SFX_PRESETS: Record<PaperComicSfxPresetId, PaperComicSfxPreset> = {
  bang: {
    id: 'bang',
    label: 'BANG!',
    text: 'BANG!',
    fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
    fontSizePt: 50,
    fillColor: '#facc15',
    strokeColor: '#111111',
    strokeWidthMm: 1.25,
    shadow: { color: 'rgba(0,0,0,0.48)', offsetXMm: 1.2, offsetYMm: 1.3, blurMm: 0.35 },
    warp: { skewXDeg: -6, skewYDeg: 0, scaleX: 1.08, scaleY: 1 },
    rotationDeg: -5,
    tracking: 1.2,
    trailingCopies: { count: 2, offsetXMm: -2.4, offsetYMm: 1.4, scaleStep: 0.04, opacityStep: 0.18 },
    burst: { fillColor: '#ef4444', strokeColor: '#111111', strokeWidthMm: 0.65, points: 14 },
  },
  kapow: {
    id: 'kapow',
    label: 'KAPOW!',
    text: 'KAPOW!',
    fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
    fontSizePt: 54,
    fillColor: '#f97316',
    strokeColor: '#111111',
    strokeWidthMm: 1.35,
    shadow: { color: 'rgba(0,0,0,0.52)', offsetXMm: 1.4, offsetYMm: 1.6, blurMm: 0.45 },
    warp: { skewXDeg: -9, skewYDeg: 0, scaleX: 1.12, scaleY: 1.04 },
    rotationDeg: -8,
    tracking: 1.5,
    trailingCopies: { count: 3, offsetXMm: -2.8, offsetYMm: 1.5, scaleStep: 0.045, opacityStep: 0.16 },
    burst: { fillColor: '#fde047', strokeColor: '#111111', strokeWidthMm: 0.7, points: 18 },
  },
  screech: {
    id: 'screech',
    label: 'SCREECH',
    text: 'SCREECH',
    fontFamily: '"Arial Narrow", Impact, "Arial Black", sans-serif',
    fontSizePt: 44,
    fillColor: '#f8fafc',
    strokeColor: '#0f172a',
    strokeWidthMm: 0.95,
    shadow: { color: 'rgba(56,189,248,0.55)', offsetXMm: 0.9, offsetYMm: 1, blurMm: 0.8 },
    warp: { skewXDeg: -14, skewYDeg: 0, scaleX: 1.26, scaleY: 0.88 },
    rotationDeg: -2,
    tracking: 2.8,
    trailingCopies: { count: 3, offsetXMm: -3.5, offsetYMm: 0.3, scaleStep: 0.03, opacityStep: 0.15 },
    speedLines: { count: 5, color: '#38bdf8', strokeWidthMm: 0.25, lengthMm: 34, spacingMm: 4.5, angleDeg: -8, opacity: 0.72 },
  },
  whirrrrr: {
    id: 'whirrrrr',
    label: 'WHIRRRR',
    text: 'WHIRRRR',
    fontFamily: '"Arial Narrow", Impact, "Arial Black", sans-serif',
    fontSizePt: 42,
    fillColor: '#22d3ee',
    strokeColor: '#083344',
    strokeWidthMm: 0.9,
    shadow: { color: 'rgba(8,51,68,0.45)', offsetXMm: 1, offsetYMm: 1.2, blurMm: 0.5 },
    warp: { skewXDeg: -11, skewYDeg: 0, scaleX: 1.32, scaleY: 0.92 },
    rotationDeg: 2,
    tracking: 2.4,
    trailingCopies: { count: 4, offsetXMm: -4.2, offsetYMm: 0.6, scaleStep: 0.035, opacityStep: 0.14 },
    speedLines: { count: 6, color: '#0891b2', strokeWidthMm: 0.22, lengthMm: 42, spacingMm: 4.2, angleDeg: 2, opacity: 0.68 },
  },
  boom: {
    id: 'boom',
    label: 'BOOM!',
    text: 'BOOM!',
    fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
    fontSizePt: 58,
    fillColor: '#ef4444',
    strokeColor: '#111111',
    strokeWidthMm: 1.45,
    shadow: { color: 'rgba(0,0,0,0.58)', offsetXMm: 1.6, offsetYMm: 1.8, blurMm: 0.55 },
    warp: { skewXDeg: -4, skewYDeg: 0, scaleX: 1.16, scaleY: 1.12 },
    rotationDeg: 4,
    tracking: 1,
    trailingCopies: { count: 2, offsetXMm: -3, offsetYMm: 2, scaleStep: 0.05, opacityStep: 0.2 },
    burst: { fillColor: '#f59e0b', strokeColor: '#111111', strokeWidthMm: 0.75, points: 16 },
  },
  crash: {
    id: 'crash',
    label: 'CRASH!',
    text: 'CRASH!',
    fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
    fontSizePt: 50,
    fillColor: '#e5e7eb',
    strokeColor: '#111827',
    strokeWidthMm: 1.25,
    shadow: { color: 'rgba(30,41,59,0.52)', offsetXMm: 1.2, offsetYMm: 1.5, blurMm: 0.45 },
    warp: { skewXDeg: 7, skewYDeg: 0, scaleX: 1.18, scaleY: 0.98 },
    rotationDeg: 7,
    tracking: 1.6,
    trailingCopies: { count: 3, offsetXMm: -2.6, offsetYMm: 1.2, scaleStep: 0.04, opacityStep: 0.15 },
    burst: { fillColor: '#94a3b8', strokeColor: '#111827', strokeWidthMm: 0.65, points: 12 },
  },
  zap: {
    id: 'zap',
    label: 'ZAP!',
    text: 'ZAP!',
    fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
    fontSizePt: 48,
    fillColor: '#a3e635',
    strokeColor: '#1a2e05',
    strokeWidthMm: 1.05,
    shadow: { color: 'rgba(132,204,22,0.45)', offsetXMm: 0.9, offsetYMm: 1.1, blurMm: 0.75 },
    warp: { skewXDeg: -12, skewYDeg: 0, scaleX: 1.22, scaleY: 0.96 },
    rotationDeg: -10,
    tracking: 1.8,
    trailingCopies: { count: 3, offsetXMm: -2.8, offsetYMm: 0.8, scaleStep: 0.04, opacityStep: 0.15 },
    speedLines: { count: 4, color: '#65a30d', strokeWidthMm: 0.28, lengthMm: 30, spacingMm: 5, angleDeg: -18, opacity: 0.7 },
  },
  slam: {
    id: 'slam',
    label: 'SLAM!',
    text: 'SLAM!',
    fontFamily: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
    fontSizePt: 52,
    fillColor: '#fb7185',
    strokeColor: '#111111',
    strokeWidthMm: 1.2,
    shadow: { color: 'rgba(0,0,0,0.5)', offsetXMm: 1.5, offsetYMm: 1.8, blurMm: 0.35 },
    warp: { skewXDeg: 0, skewYDeg: -3, scaleX: 1.1, scaleY: 1.08 },
    rotationDeg: 0,
    tracking: 1.3,
    trailingCopies: { count: 2, offsetXMm: -2.4, offsetYMm: 1.7, scaleStep: 0.05, opacityStep: 0.18 },
    burst: { fillColor: '#fecdd3', strokeColor: '#111111', strokeWidthMm: 0.6, points: 10 },
  },
};

export function listPaperComicSfxPresets(): PaperComicSfxPreset[] {
  return PAPER_COMIC_SFX_PRESET_IDS.map((id) => PAPER_COMIC_SFX_PRESETS[id]);
}

export function getPaperComicSfxPreset(id: PaperComicSfxPresetId): PaperComicSfxPreset {
  return PAPER_COMIC_SFX_PRESETS[id];
}

export function createPaperComicSfxDesign(
  presetId: PaperComicSfxPresetId,
  patch: Partial<PaperComicSfxDesign> = {},
): PaperComicSfxDesign {
  return normalizePaperComicSfxDesign({
    ...paperComicSfxPresetToDesign(getPaperComicSfxPreset(presetId)),
    ...patch,
    presetId,
  });
}

export function normalizePaperComicSfxDesign(design: PaperComicSfxDesign): PaperComicSfxDesign {
  return {
    ...design,
    text: sanitizeSfxText(design.text),
    fontFamily: design.fontFamily.trim() || getPaperComicSfxPreset(design.presetId).fontFamily,
    fontSizePt: clamp(roundPaperNumber(design.fontSizePt), 12, 96),
    fillColor: design.fillColor || getPaperComicSfxPreset(design.presetId).fillColor,
    strokeColor: design.strokeColor || getPaperComicSfxPreset(design.presetId).strokeColor,
    strokeWidthMm: clamp(roundPaperNumber(design.strokeWidthMm), 0, 4),
    shadowColor: design.shadowColor || getPaperComicSfxPreset(design.presetId).shadow.color,
    shadowOffsetXMm: clamp(roundPaperNumber(design.shadowOffsetXMm), -8, 8),
    shadowOffsetYMm: clamp(roundPaperNumber(design.shadowOffsetYMm), -8, 8),
    shadowBlurMm: clamp(roundPaperNumber(design.shadowBlurMm), 0, 6),
    skewXDeg: clamp(roundPaperNumber(design.skewXDeg), -35, 35),
    skewYDeg: clamp(roundPaperNumber(design.skewYDeg), -25, 25),
    scaleX: clamp(roundPaperNumber(design.scaleX), 0.4, 3),
    scaleY: clamp(roundPaperNumber(design.scaleY), 0.4, 3),
    rotationDeg: clamp(roundPaperNumber(design.rotationDeg), -45, 45),
    tracking: clamp(roundPaperNumber(design.tracking), -2, 8),
    trailingCopiesCount: Math.round(clamp(design.trailingCopiesCount, 0, 12)),
    trailOffsetXMm: clamp(roundPaperNumber(design.trailOffsetXMm), -12, 12),
    trailOffsetYMm: clamp(roundPaperNumber(design.trailOffsetYMm), -12, 12),
    trailScaleStep: clamp(roundPaperNumber(design.trailScaleStep), 0, 0.18),
    trailOpacityStep: clamp(roundPaperNumber(design.trailOpacityStep), 0, 0.5),
    burstFillColor: design.burstFillColor || '#fde047',
    burstStrokeColor: design.burstStrokeColor || '#111111',
    burstStrokeWidthMm: clamp(roundPaperNumber(design.burstStrokeWidthMm), 0, 2.5),
    burstPoints: Math.round(clamp(design.burstPoints, 4, 32)),
    speedLineCount: Math.round(clamp(design.speedLineCount, 1, 16)),
    speedLineColor: design.speedLineColor || '#38bdf8',
    speedLineStrokeWidthMm: clamp(roundPaperNumber(design.speedLineStrokeWidthMm), 0.05, 2),
    speedLineLengthMm: clamp(roundPaperNumber(design.speedLineLengthMm), 6, 80),
    speedLineSpacingMm: clamp(roundPaperNumber(design.speedLineSpacingMm), 1, 12),
    speedLineAngleDeg: clamp(roundPaperNumber(design.speedLineAngleDeg), -45, 45),
    speedLineOpacity: clamp(roundPaperNumber(design.speedLineOpacity), 0, 1),
    halftoneCount: Math.round(clamp(design.halftoneCount, 1, 48)),
    halftoneColor: design.halftoneColor || design.fillColor || '#fde047',
    halftoneRadiusMm: clamp(roundPaperNumber(design.halftoneRadiusMm), 0.4, 5),
    halftoneSpreadMm: clamp(roundPaperNumber(design.halftoneSpreadMm), 6, 80),
    halftoneOpacity: clamp(roundPaperNumber(design.halftoneOpacity), 0, 1),
  };
}

export function buildPaperComicSfxFrames(options: PaperComicSfxBuildOptions): PaperComicSfxBuildResult {
  const preset = options.design
    ? paperComicSfxDesignToPreset(normalizePaperComicSfxDesign(options.design))
    : getPaperComicSfxPreset(options.presetId);
  const text = sanitizeSfxText(options.text || preset.text);
  const groupId = options.idPrefix || makePaperComicSfxId(options.presetId);
  const zIndexStart = options.zIndexStart ?? 0;
  const widthMm = computeSfxWidthMm(text, preset);
  const heightMm = computeSfxHeightMm(widthMm, preset, text);
  const frames: PaperComicSfxFrameDraft[] = [];
  let zIndex = zIndexStart;

  if (preset.burst) {
    frames.push({
      id: `${groupId}-burst`,
      kind: 'shape',
      label: `${text} Burst`,
      xMm: options.origin.xMm - 7,
      yMm: options.origin.yMm - 6,
      widthMm: widthMm + 14,
      heightMm: heightMm + 12,
      rotationDeg: preset.rotationDeg * 0.4,
      shapeKind: 'polygon',
      vertices: buildStarBurstVertices(preset.burst.points),
      fillColor: preset.burst.fillColor,
      fillOpacity: 0.96,
      strokeColor: preset.burst.strokeColor,
      strokeOpacity: 1,
      strokeWidthMm: preset.burst.strokeWidthMm,
      strokeStyle: 'solid',
      cornerRadiusMm: 0,
      opacity: 0.98,
      zIndex: zIndex++,
    });
  }

  if (preset.halftone) {
    for (let index = 0; index < preset.halftone.count; index += 1) {
      const dot = buildHalftoneDot(index, preset.halftone.count, preset.halftone.spreadMm);
      const radius = preset.halftone.radiusMm * dot.scale;
      frames.push({
        id: `${groupId}-halftone-dot-${index + 1}`,
        kind: 'shape',
        label: `${text} Halftone Dot ${index + 1}`,
        xMm: options.origin.xMm + widthMm * 0.5 + dot.xMm - radius,
        yMm: options.origin.yMm + heightMm * 0.48 + dot.yMm - radius,
        widthMm: radius * 2,
        heightMm: radius * 2,
        rotationDeg: 0,
        shapeKind: 'ellipse',
        fillColor: preset.halftone.color,
        fillOpacity: preset.halftone.opacity * dot.opacity,
        strokeColor: 'transparent',
        strokeOpacity: 0,
        strokeWidthMm: 0,
        strokeStyle: 'solid',
        cornerRadiusMm: 100,
        opacity: preset.halftone.opacity * dot.opacity,
        zIndex: zIndex++,
      });
    }
  }

  if (preset.speedLines) {
    for (let index = 0; index < preset.speedLines.count; index += 1) {
      const centerOffset = index - (preset.speedLines.count - 1) / 2;
      frames.push({
        id: `${groupId}-speed-line-${index + 1}`,
        kind: 'shape',
        label: `${text} Speed Line ${index + 1}`,
        xMm: options.origin.xMm - preset.speedLines.lengthMm * 0.48,
        yMm: options.origin.yMm + heightMm * 0.48 + centerOffset * preset.speedLines.spacingMm,
        widthMm: preset.speedLines.lengthMm,
        heightMm: 1.2,
        rotationDeg: preset.speedLines.angleDeg + centerOffset * 1.4,
        shapeKind: 'line',
        vertices: [
          { xPercent: 0, yPercent: 50 },
          { xPercent: 100, yPercent: 50 },
        ],
        fillColor: 'transparent',
        fillOpacity: 0,
        strokeColor: preset.speedLines.color,
        strokeOpacity: preset.speedLines.opacity,
        strokeWidthMm: preset.speedLines.strokeWidthMm,
        strokeStyle: 'solid',
        cornerRadiusMm: 0,
        opacity: preset.speedLines.opacity,
        zIndex: zIndex++,
      });
    }
  }

  for (let index = 1; index <= preset.trailingCopies.count; index += 1) {
    const distance = index;
    frames.push(buildTextSfxFrame({
      id: `${groupId}-trail-${index}`,
      label: `${text} Trail ${index}`,
      text,
      preset,
      xMm: options.origin.xMm + preset.trailingCopies.offsetXMm * distance,
      yMm: options.origin.yMm + preset.trailingCopies.offsetYMm * distance,
      widthMm,
      heightMm,
      opacity: Math.max(0.14, 0.68 - preset.trailingCopies.opacityStep * (distance - 1)),
      scaleX: Math.max(0.55, preset.warp.scaleX - preset.trailingCopies.scaleStep * distance),
      scaleY: Math.max(0.55, preset.warp.scaleY - preset.trailingCopies.scaleStep * distance * 0.5),
      zIndex: zIndex++,
      strokeOpacity: 0.65,
      shadowOpacity: 0.35,
    }));
  }

  const primaryFrameId = `${groupId}-primary`;
  frames.push(buildTextSfxFrame({
    id: primaryFrameId,
    label: `${text} SFX`,
    text,
    preset,
    xMm: options.origin.xMm,
    yMm: options.origin.yMm,
    widthMm,
    heightMm,
    opacity: 1,
    scaleX: preset.warp.scaleX,
    scaleY: preset.warp.scaleY,
    zIndex: zIndex++,
    strokeOpacity: 1,
    shadowOpacity: 1,
  }));

  return {
    preset,
    frames,
    primaryFrameId,
    selectedFrameIds: frames.map((frame) => frame.id),
  };
}

export function buildPaperComicSfxDecalFrame(options: PaperComicSfxBuildOptions): PaperComicSfxDecalBuildResult {
  const normalizedDesign = options.design
    ? normalizePaperComicSfxDesign(options.design)
    : createPaperComicSfxDesign(options.presetId, options.text === undefined ? {} : { text: options.text });
  const preset = paperComicSfxDesignToPreset(normalizedDesign);
  const decalId = options.idPrefix || makePaperComicSfxId(options.presetId);
  const layered = buildPaperComicSfxFrames({
    presetId: options.presetId,
    design: normalizedDesign,
    idPrefix: `${decalId}-layer`,
    origin: { xMm: 0, yMm: 0 },
    zIndexStart: 0,
  });
  const minWidthMm = minimumSfxWidthMm(normalizedDesign.text);
  const minHeightMm = minimumSfxHeightMm(normalizedDesign.text);
  const bounds = expandSfxBounds(computeSfxBounds(layered.frames), minWidthMm, minHeightMm);
  const widthMm = roundPaperNumber(bounds.widthMm);
  const heightMm = roundPaperNumber(bounds.heightMm);
  const label = `${normalizedDesign.text} Comic SFX`;
  const vectorDpi = 1200;
  const frame: PaperComicSfxFrameDraft = {
    id: decalId,
    kind: 'image',
    label,
    xMm: options.origin.xMm,
    yMm: options.origin.yMm,
    widthMm,
    heightMm,
    rotationDeg: 0,
    text: normalizedDesign.text,
    asset: {
      label,
      kind: 'image',
      mimeType: 'image/svg+xml',
      pixelWidth: Math.max(1, Math.round((widthMm / 25.4) * vectorDpi)),
      pixelHeight: Math.max(1, Math.round((heightMm / 25.4) * vectorDpi)),
      embeddedAt: Date.now(),
    },
    fit: 'stretch',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    fillColor: 'transparent',
    fillOpacity: 0,
    strokeColor: 'transparent',
    strokeOpacity: 0,
    strokeWidthMm: 0,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity: 1,
    comicSfxDesign: normalizedDesign,
    zIndex: options.zIndexStart ?? 0,
  };

  return {
    preset,
    frame,
    primaryFrameId: decalId,
    selectedFrameIds: [decalId],
  };
}

/** Generates an ephemeral display/export URL from the retained editable recipe, never Paper state. */
export function paperComicSfxDesignToDataUrl(design: PaperComicSfxDesign): string {
  const normalizedDesign = normalizePaperComicSfxDesign(design);
  const layered = buildPaperComicSfxFrames({
    presetId: normalizedDesign.presetId,
    design: normalizedDesign,
    idPrefix: 'paper-comic-sfx-runtime',
    origin: { xMm: 0, yMm: 0 },
    zIndexStart: 0,
  });
  const bounds = expandSfxBounds(
    computeSfxBounds(layered.frames),
    minimumSfxWidthMm(normalizedDesign.text),
    minimumSfxHeightMm(normalizedDesign.text),
  );
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderPaperComicSfxSvg(layered.frames, bounds))}`;
}

export function buildPaperComicSfxDecalFrameUpdate(
  frame: Pick<PaperComicSfxFrameDraft, 'id' | 'xMm' | 'yMm' | 'zIndex'>,
  design: PaperComicSfxDesign,
): PaperFramePatch {
  const rebuilt = buildPaperComicSfxDecalFrame({
    presetId: design.presetId,
    design,
    idPrefix: frame.id,
    origin: { xMm: frame.xMm, yMm: frame.yMm },
    zIndexStart: frame.zIndex,
  }).frame;

  return {
    kind: 'image',
    label: rebuilt.label,
    text: rebuilt.text,
    asset: rebuilt.asset,
    fit: 'stretch',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    fillColor: 'transparent',
    fillOpacity: 0,
    strokeColor: 'transparent',
    strokeOpacity: 0,
    strokeWidthMm: 0,
    strokeStyle: 'solid',
    comicSfxDesign: rebuilt.comicSfxDesign,
  };
}

function paperComicSfxPresetToDesign(preset: PaperComicSfxPreset): PaperComicSfxDesign {
  return {
    presetId: preset.id,
    text: preset.text,
    fontFamily: preset.fontFamily,
    fontSizePt: preset.fontSizePt,
    fillColor: preset.fillColor,
    strokeColor: preset.strokeColor,
    strokeWidthMm: preset.strokeWidthMm,
    shadowColor: preset.shadow.color,
    shadowOffsetXMm: preset.shadow.offsetXMm,
    shadowOffsetYMm: preset.shadow.offsetYMm,
    shadowBlurMm: preset.shadow.blurMm,
    skewXDeg: preset.warp.skewXDeg,
    skewYDeg: preset.warp.skewYDeg,
    scaleX: preset.warp.scaleX,
    scaleY: preset.warp.scaleY,
    rotationDeg: preset.rotationDeg,
    tracking: preset.tracking,
    trailingCopiesCount: preset.trailingCopies.count,
    trailOffsetXMm: preset.trailingCopies.offsetXMm,
    trailOffsetYMm: preset.trailingCopies.offsetYMm,
    trailScaleStep: preset.trailingCopies.scaleStep,
    trailOpacityStep: preset.trailingCopies.opacityStep,
    burstEnabled: Boolean(preset.burst),
    burstFillColor: preset.burst?.fillColor ?? '#fde047',
    burstStrokeColor: preset.burst?.strokeColor ?? preset.strokeColor,
    burstStrokeWidthMm: preset.burst?.strokeWidthMm ?? 0.65,
    burstPoints: preset.burst?.points ?? 14,
    speedLinesEnabled: Boolean(preset.speedLines),
    speedLineCount: preset.speedLines?.count ?? 5,
    speedLineColor: preset.speedLines?.color ?? preset.strokeColor,
    speedLineStrokeWidthMm: preset.speedLines?.strokeWidthMm ?? 0.25,
    speedLineLengthMm: preset.speedLines?.lengthMm ?? 34,
    speedLineSpacingMm: preset.speedLines?.spacingMm ?? 4.5,
    speedLineAngleDeg: preset.speedLines?.angleDeg ?? preset.rotationDeg,
    speedLineOpacity: preset.speedLines?.opacity ?? 0.7,
    halftoneEnabled: Boolean(preset.halftone),
    halftoneCount: preset.halftone?.count ?? 12,
    halftoneColor: preset.halftone?.color ?? preset.fillColor,
    halftoneRadiusMm: preset.halftone?.radiusMm ?? 1.4,
    halftoneSpreadMm: preset.halftone?.spreadMm ?? 36,
    halftoneOpacity: preset.halftone?.opacity ?? 0.36,
  };
}

function paperComicSfxDesignToPreset(design: PaperComicSfxDesign): PaperComicSfxPreset {
  return {
    id: design.presetId,
    label: `${design.text} custom`,
    text: design.text,
    fontFamily: design.fontFamily,
    fontSizePt: design.fontSizePt,
    fillColor: design.fillColor,
    strokeColor: design.strokeColor,
    strokeWidthMm: design.strokeWidthMm,
    shadow: {
      color: design.shadowColor,
      offsetXMm: design.shadowOffsetXMm,
      offsetYMm: design.shadowOffsetYMm,
      blurMm: design.shadowBlurMm,
    },
    warp: {
      skewXDeg: design.skewXDeg,
      skewYDeg: design.skewYDeg,
      scaleX: design.scaleX,
      scaleY: design.scaleY,
    },
    rotationDeg: design.rotationDeg,
    tracking: design.tracking,
    trailingCopies: {
      count: design.trailingCopiesCount,
      offsetXMm: design.trailOffsetXMm,
      offsetYMm: design.trailOffsetYMm,
      scaleStep: design.trailScaleStep,
      opacityStep: design.trailOpacityStep,
    },
    burst: design.burstEnabled
      ? {
          fillColor: design.burstFillColor,
          strokeColor: design.burstStrokeColor,
          strokeWidthMm: design.burstStrokeWidthMm,
          points: design.burstPoints,
        }
      : undefined,
    speedLines: design.speedLinesEnabled
      ? {
          count: design.speedLineCount,
          color: design.speedLineColor,
          strokeWidthMm: design.speedLineStrokeWidthMm,
          lengthMm: design.speedLineLengthMm,
          spacingMm: design.speedLineSpacingMm,
          angleDeg: design.speedLineAngleDeg,
          opacity: design.speedLineOpacity,
        }
      : undefined,
    halftone: design.halftoneEnabled
      ? {
          count: design.halftoneCount,
          color: design.halftoneColor,
          radiusMm: design.halftoneRadiusMm,
          spreadMm: design.halftoneSpreadMm,
          opacity: design.halftoneOpacity,
        }
      : undefined,
  };
}

function buildTextSfxFrame({
  id,
  label,
  text,
  preset,
  xMm,
  yMm,
  widthMm,
  heightMm,
  opacity,
  scaleX,
  scaleY,
  zIndex,
  strokeOpacity,
  shadowOpacity,
}: {
  id: string;
  label: string;
  text: string;
  preset: PaperComicSfxPreset;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  opacity: number;
  scaleX: number;
  scaleY: number;
  zIndex: number;
  strokeOpacity: number;
  shadowOpacity: number;
}): PaperComicSfxFrameDraft {
  return {
    id,
    kind: 'text',
    label,
    text,
    xMm,
    yMm,
    widthMm,
    heightMm,
    rotationDeg: preset.rotationDeg,
    fillColor: 'transparent',
    fillOpacity: 0,
    strokeColor: 'transparent',
    strokeOpacity: 0,
    strokeWidthMm: 0,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity,
    typography: {
      fontFamily: preset.fontFamily,
      fontSizePt: preset.fontSizePt,
      fontWeight: '900',
      fontStyle: 'normal',
      leadingPt: Math.round(preset.fontSizePt * 0.9),
      tracking: preset.tracking,
      align: 'center',
      color: preset.fillColor,
      hyphenate: false,
    },
    columns: 1,
    textBoxXPercent: 0,
    textBoxYPercent: 0,
    textBoxWidthPercent: 100,
    textBoxHeightPercent: 100,
    textVerticalAlign: 'middle',
    textStrokeColor: withAlphaHint(preset.strokeColor, strokeOpacity),
    textStrokeWidthMm: preset.strokeWidthMm,
    textShadowColor: withShadowOpacity(preset.shadow.color, shadowOpacity),
    textShadowOffsetXMm: preset.shadow.offsetXMm,
    textShadowOffsetYMm: preset.shadow.offsetYMm,
    textShadowBlurMm: preset.shadow.blurMm,
    textSkewXDeg: preset.warp.skewXDeg,
    textSkewYDeg: preset.warp.skewYDeg,
    textScaleX: scaleX,
    textScaleY: scaleY,
    zIndex,
  };
}

function sanitizeSfxText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length ? normalized.toUpperCase().slice(0, 48) : 'BANG!';
}

function computeSfxWidthMm(text: string, preset: PaperComicSfxPreset): number {
  return clamp(text.length * (preset.fontSizePt / 12) * 1.7, minimumSfxWidthMm(text), 118);
}

function computeSfxHeightMm(widthMm: number, preset: PaperComicSfxPreset, text: string): number {
  return clamp(widthMm * 0.42 * preset.warp.scaleY, minimumSfxHeightMm(text), 58);
}

function minimumSfxWidthMm(text: string): number {
  return text.trim().length <= 3 ? 58 : 42;
}

function minimumSfxHeightMm(text: string): number {
  return text.trim().length <= 3 ? 32 : 20;
}

interface SfxBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  widthMm: number;
  heightMm: number;
}

function computeSfxBounds(frames: PaperComicSfxFrameDraft[]): SfxBounds {
  const first = frames[0];
  if (!first) return { minX: 0, minY: 0, maxX: 58, maxY: 32, widthMm: 58, heightMm: 32 };
  let minX = first.xMm;
  let minY = first.yMm;
  let maxX = first.xMm + first.widthMm;
  let maxY = first.yMm + first.heightMm;

  for (const frame of frames) {
    const overscan = frame.kind === 'text'
      ? Math.max(
          4,
          (frame.textStrokeWidthMm ?? 0) * 2,
          Math.abs(frame.textShadowOffsetXMm ?? 0) + Math.abs(frame.textShadowOffsetYMm ?? 0) + (frame.textShadowBlurMm ?? 0) * 2,
        )
      : Math.max(1.5, frame.strokeWidthMm ?? 0);
    minX = Math.min(minX, frame.xMm - overscan);
    minY = Math.min(minY, frame.yMm - overscan);
    maxX = Math.max(maxX, frame.xMm + frame.widthMm + overscan);
    maxY = Math.max(maxY, frame.yMm + frame.heightMm + overscan);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    widthMm: maxX - minX,
    heightMm: maxY - minY,
  };
}

function expandSfxBounds(bounds: SfxBounds, minWidthMm: number, minHeightMm: number): SfxBounds {
  let minX = bounds.minX;
  let minY = bounds.minY;
  let maxX = bounds.maxX;
  let maxY = bounds.maxY;

  if (bounds.widthMm < minWidthMm) {
    const padding = (minWidthMm - bounds.widthMm) / 2;
    minX -= padding;
    maxX += padding;
  }

  if (bounds.heightMm < minHeightMm) {
    const padding = (minHeightMm - bounds.heightMm) / 2;
    minY -= padding;
    maxY += padding;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    widthMm: maxX - minX,
    heightMm: maxY - minY,
  };
}

function renderPaperComicSfxSvg(frames: PaperComicSfxFrameDraft[], bounds: SfxBounds): string {
  const sorted = [...frames].sort((a, b) => a.zIndex - b.zIndex);
  const filters = sorted
    .filter((frame) => frame.kind === 'text' && frame.textShadowColor)
    .map((frame) => renderTextShadowFilter(frame))
    .join('');
  const body = sorted.map((frame) => renderPaperComicSfxSvgFrame(frame)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${formatSvgNumber(bounds.widthMm)}mm" height="${formatSvgNumber(bounds.heightMm)}mm" viewBox="${formatSvgNumber(bounds.minX)} ${formatSvgNumber(bounds.minY)} ${formatSvgNumber(bounds.widthMm)} ${formatSvgNumber(bounds.heightMm)}">${filters ? `<defs>${filters}</defs>` : ''}${body}</svg>`;
}

function renderTextShadowFilter(frame: PaperComicSfxFrameDraft): string {
  return `<filter id="${escapeXml(shadowFilterId(frame))}" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="${formatSvgNumber(frame.textShadowOffsetXMm ?? 0)}" dy="${formatSvgNumber(frame.textShadowOffsetYMm ?? 0)}" stdDeviation="${formatSvgNumber(frame.textShadowBlurMm ?? 0)}" flood-color="${escapeXml(frame.textShadowColor ?? 'rgba(0,0,0,0.35)')}"/></filter>`;
}

function renderPaperComicSfxSvgFrame(frame: PaperComicSfxFrameDraft): string {
  const opacity = formatSvgNumber(frame.opacity ?? 1);

  if (frame.kind === 'shape') {
    if (frame.shapeKind === 'ellipse') {
      return `<ellipse cx="${formatSvgNumber(frame.xMm + frame.widthMm / 2)}" cy="${formatSvgNumber(frame.yMm + frame.heightMm / 2)}" rx="${formatSvgNumber(frame.widthMm / 2)}" ry="${formatSvgNumber(frame.heightMm / 2)}" fill="${escapeXml(frame.fillColor ?? 'transparent')}" fill-opacity="${formatSvgNumber(frame.fillOpacity ?? 1)}" opacity="${opacity}" stroke="${escapeXml(frame.strokeColor ?? 'transparent')}" stroke-opacity="${formatSvgNumber(frame.strokeOpacity ?? 1)}" stroke-width="${formatSvgNumber(frame.strokeWidthMm ?? 0)}"/>`;
    }

    if (frame.shapeKind === 'line') {
      const vertices = frame.vertices && frame.vertices.length >= 2
        ? frame.vertices
        : [{ xPercent: 0, yPercent: 50 }, { xPercent: 100, yPercent: 50 }];
      const [start, end] = vertices;
      return `<line x1="${formatSvgNumber(frame.xMm + frame.widthMm * (start.xPercent / 100))}" y1="${formatSvgNumber(frame.yMm + frame.heightMm * (start.yPercent / 100))}" x2="${formatSvgNumber(frame.xMm + frame.widthMm * (end.xPercent / 100))}" y2="${formatSvgNumber(frame.yMm + frame.heightMm * (end.yPercent / 100))}" opacity="${opacity}" stroke="${escapeXml(frame.strokeColor ?? '#111111')}" stroke-linecap="round" stroke-opacity="${formatSvgNumber(frame.strokeOpacity ?? 1)}" stroke-width="${formatSvgNumber(frame.strokeWidthMm ?? 0.25)}" transform="${svgFrameTransform(frame)}"/>`;
    }

    const points = (frame.vertices ?? [])
      .map((vertex) => `${formatSvgNumber(frame.xMm + frame.widthMm * (vertex.xPercent / 100))},${formatSvgNumber(frame.yMm + frame.heightMm * (vertex.yPercent / 100))}`)
      .join(' ');
    return `<polygon points="${points}" fill="${escapeXml(frame.fillColor ?? 'transparent')}" fill-opacity="${formatSvgNumber(frame.fillOpacity ?? 1)}" opacity="${opacity}" stroke="${escapeXml(frame.strokeColor ?? 'transparent')}" stroke-linejoin="round" stroke-opacity="${formatSvgNumber(frame.strokeOpacity ?? 1)}" stroke-width="${formatSvgNumber(frame.strokeWidthMm ?? 0)}" transform="${svgFrameTransform(frame)}"/>`;
  }

  if (frame.kind === 'text') {
    const typography = frame.typography ?? {};
    const centerX = frame.xMm + frame.widthMm / 2;
    const centerY = frame.yMm + frame.heightMm / 2;
    const fontSizeMm = (typography.fontSizePt ?? 42) * 0.352778;
    const strokeWidth = frame.textStrokeWidthMm ?? 0;
    const stroke = strokeWidth > 0 ? ` stroke="${escapeXml(frame.textStrokeColor ?? '#111111')}" stroke-width="${formatSvgNumber(strokeWidth)}" paint-order="stroke fill"` : '';
    const filter = frame.textShadowColor ? ` filter="url(#${escapeXml(shadowFilterId(frame))})"` : '';
    const textTransform = svgTextTransform(frame);
    return `<text x="${formatSvgNumber(centerX)}" y="${formatSvgNumber(centerY)}" dominant-baseline="central" text-anchor="middle" fill="${escapeXml(typography.color ?? '#ffffff')}" font-family="${escapeXml(typography.fontFamily ?? 'Impact, sans-serif')}" font-size="${formatSvgNumber(fontSizeMm)}" font-style="${escapeXml(typography.fontStyle ?? 'normal')}" font-weight="${escapeXml(typography.fontWeight ?? '900')}" letter-spacing="${formatSvgNumber((typography.tracking ?? 0) * 0.01)}mm" opacity="${opacity}" transform="${textTransform}"${stroke}${filter}>${escapeXml(frame.text ?? '')}</text>`;
  }

  return '';
}

function svgFrameTransform(frame: PaperComicSfxFrameDraft): string {
  if (!frame.rotationDeg) return '';
  const centerX = frame.xMm + frame.widthMm / 2;
  const centerY = frame.yMm + frame.heightMm / 2;
  return `rotate(${formatSvgNumber(frame.rotationDeg)} ${formatSvgNumber(centerX)} ${formatSvgNumber(centerY)})`;
}

function svgTextTransform(frame: PaperComicSfxFrameDraft): string {
  const centerX = frame.xMm + frame.widthMm / 2;
  const centerY = frame.yMm + frame.heightMm / 2;
  const parts = [
    `translate(${formatSvgNumber(centerX)} ${formatSvgNumber(centerY)})`,
    frame.rotationDeg ? `rotate(${formatSvgNumber(frame.rotationDeg)})` : '',
    frame.textSkewXDeg ? `skewX(${formatSvgNumber(frame.textSkewXDeg)})` : '',
    frame.textSkewYDeg ? `skewY(${formatSvgNumber(frame.textSkewYDeg)})` : '',
    (frame.textScaleX && frame.textScaleX !== 1) || (frame.textScaleY && frame.textScaleY !== 1)
      ? `scale(${formatSvgNumber(frame.textScaleX ?? 1)} ${formatSvgNumber(frame.textScaleY ?? 1)})`
      : '',
    `translate(${formatSvgNumber(-centerX)} ${formatSvgNumber(-centerY)})`,
  ].filter(Boolean);
  return parts.join(' ');
}

function shadowFilterId(frame: PaperComicSfxFrameDraft): string {
  return `${frame.id}-shadow`;
}

function formatSvgNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildStarBurstVertices(points: number): PaperFrameVertex[] {
  const total = Math.max(8, points * 2);
  const vertices: PaperFrameVertex[] = [];
  for (let index = 0; index < total; index += 1) {
    const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
    const radius = index % 2 === 0 ? 49 : 28;
    vertices.push({
      xPercent: roundPercent(50 + Math.cos(angle) * radius),
      yPercent: roundPercent(50 + Math.sin(angle) * radius),
    });
  }
  return vertices;
}

function buildHalftoneDot(index: number, count: number, spreadMm: number): { xMm: number; yMm: number; scale: number; opacity: number } {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const normalized = count <= 1 ? 0 : index / (count - 1);
  const radius = Math.sqrt(normalized) * spreadMm;
  const angle = index * goldenAngle;
  return {
    xMm: Math.cos(angle) * radius,
    yMm: Math.sin(angle) * radius * 0.72,
    scale: clamp(1.12 - normalized * 0.62, 0.42, 1.12),
    opacity: clamp(1 - normalized * 0.58, 0.28, 1),
  };
}

function withAlphaHint(color: string, opacity: number): string {
  if (opacity >= 0.99) return color;
  if (color.startsWith('#') && color.length === 7) return `${color}${Math.round(clamp(opacity, 0, 1) * 255).toString(16).padStart(2, '0')}`;
  return color;
}

function withShadowOpacity(color: string, opacity: number): string {
  if (opacity >= 0.99) return color;
  if (!color.startsWith('rgba(')) return color;
  return color.replace(/,\s*[\d.]+\)$/, `,${roundPercent(clamp(opacity, 0, 1) * 0.5)})`);
}

function makePaperComicSfxId(presetId: PaperComicSfxPresetId): string {
  return `sfx-${presetId}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1000)}`}`;
}

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundPaperNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
