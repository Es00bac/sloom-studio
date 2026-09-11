import type { EditorStageObject, EditorTextTypography, EditorVisualClip, TextClipEffect } from '../types/flow';
import { getAutomationValueAtLocalTime } from './clipAutomation';
import { buildClipEffectDescriptorForClip, type ClipCropSettings, type ClipEffectSourceClip } from './editorClipEffects';
import { getVisualKeyframeStateAtProgress, type VisualKeyframeClip } from './editorKeyframes';
import { measureTextObjectBounds } from './editorTextRender';
import { resolveVideoTextCardLayout } from './videoTextCardLayout';
import { evaluateProfessionalVideoParameter } from './videoParamKeyframes';

/**
 * The subset of `EditorVisualClip` the layout descriptor actually reads. Widened (rather than left
 * nominal `EditorVisualClip`) so `buildVisualClipLayoutDescriptor` is callable from both the Edit
 * Stage preview and the frame-server export driver's flattened `ComposeSequenceVisualClip` — see
 * `ClipEffectSourceClip`'s doc comment in `editorClipEffects.ts` for why that matters.
 */
export type VisualLayoutClip = VisualKeyframeClip & ClipEffectSourceClip & Pick<
  EditorVisualClip,
  | 'sourceKind'
  | 'fitMode'
  | 'opacityAutomationPoints'
  | 'transitionIn'
  | 'transitionOut'
  | 'transitionDurationMs'
  | 'flipHorizontal'
  | 'flipVertical'
  | 'textContent'
  | 'textFontFamily'
  | 'textSizePx'
  | 'textColor'
  | 'textEffect'
  | 'textTypography'
  | 'shapeFillColor'
  | 'shapeBorderColor'
  | 'shapeBorderWidth'
  | 'shapeCornerRadius'
  | 'professional'
> & {
  // Required on `EditorVisualClip`; optional on `ComposeSequenceVisualClip` (the export driver's
  // flattened clip shape, which doesn't always carry the authored id) — see `clipId: clip.id ?? ''`
  // below for the corresponding default.
  id?: string;
};

export interface VisualLayoutCanvas {
  width: number;
  height: number;
}

export interface VisualSourceDimensions {
  width: number;
  height: number;
}

export interface VisualClipLayoutDescriptor {
  clipId: string;
  sourceKind: EditorVisualClip['sourceKind'];
  progressPercent: number;
  fitMode: EditorVisualClip['fitMode'] | 'text-object';
  fitWidth: number;
  fitHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  positionX: number;
  positionY: number;
  scalePercent: number;
  rotationDeg: number;
  opacityPercent: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  crop: CropLayoutDescriptor;
  text?: TextLayoutDescriptor;
  shape?: ShapeLayoutDescriptor;
}

export interface CropLayoutDescriptor extends ClipCropSettings {
  frameLeftPercent: number;
  frameRightPercent: number;
  frameTopPercent: number;
  frameBottomPercent: number;
  contentTranslateXPercent: number;
  contentTranslateYPercent: number;
  visibleWidthPercent: number;
  visibleHeightPercent: number;
  renderCropXPercent: number;
  renderCropYPercent: number;
}

export interface TextLayoutDescriptor {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  lineHeight: number;
  lineHeightPx: number;
  color: string;
  effect: TextClipEffect;
  effectPaddingPx: number;
  width: number;
  height: number;
  outlineWidthPx: number;
}

export interface ShapeLayoutDescriptor {
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  cornerRadius: number;
  insetPercent: number;
  innerLeft: number;
  innerTop: number;
  innerWidth: number;
  innerHeight: number;
}

export interface StageObjectLayoutDescriptor {
  objectId: string;
  kind: EditorStageObject['kind'];
  left: number;
  top: number;
  width: number;
  height: number;
  rotationDeg: number;
  opacityPercent: number;
  blendMode: EditorStageObject['blendMode'];
  text?: TextLayoutDescriptor;
  shape?: ShapeLayoutDescriptor;
}

export const MIN_VISUAL_SCALE_FACTOR = 0.1;
export const TEXT_LINE_HEIGHT = 1.12;
export const SHAPE_INSET_PERCENT = 10;

export function buildVisualClipLayoutDescriptor({
  clip,
  canvas,
  source,
  progressPercent = 0,
  localTimeSeconds,
  durationSeconds,
  text,
}: {
  clip: VisualLayoutClip;
  canvas: VisualLayoutCanvas;
  source: VisualSourceDimensions;
  progressPercent?: number;
  localTimeSeconds?: number;
  durationSeconds?: number;
  text?: string;
}): VisualClipLayoutDescriptor {
  const fitMode = clip.sourceKind === 'text' ? 'text-object' : clip.fitMode;
  const fit = fitVisualDimensions(source, canvas, fitMode);
  const legacyState = getVisualKeyframeStateAtProgress(clip, progressPercent);
  const localTimeMs = Math.max(0, (localTimeSeconds ?? 0) * 1_000);
  const parameterTracks = clip.professional?.parameterKeyframes;
  const state = parameterTracks?.length ? {
    ...legacyState,
    positionX: evaluateProfessionalVideoParameter(parameterTracks, 'position-x', localTimeMs, { defaultValue: legacyState.positionX }),
    positionY: evaluateProfessionalVideoParameter(parameterTracks, 'position-y', localTimeMs, { defaultValue: legacyState.positionY }),
    scalePercent: evaluateProfessionalVideoParameter(parameterTracks, 'scale', localTimeMs, { defaultValue: legacyState.scalePercent, minValue: 1 }),
    rotationDeg: evaluateProfessionalVideoParameter(parameterTracks, 'rotation', localTimeMs, { defaultValue: legacyState.rotationDeg }),
    opacityPercent: evaluateProfessionalVideoParameter(parameterTracks, 'opacity', localTimeMs, { defaultValue: legacyState.opacityPercent, minValue: 0, maxValue: 100 }),
  } : legacyState;
  const baseOpacityPercent = parameterTracks?.some((track) => track.parameter === 'opacity')
    ? state.opacityPercent
    : clip.keyframes?.length
    ? state.opacityPercent
    : getAutomationValueAtLocalTime(clip.opacityAutomationPoints, localTimeSeconds ?? 0, durationSeconds ?? 1, clip.opacityPercent);
  const opacityPercent = baseOpacityPercent * getTransitionOpacityFactor(clip, localTimeSeconds ?? 0, durationSeconds ?? 1);
  const scaleFactor = Math.max(MIN_VISUAL_SCALE_FACTOR, state.scalePercent / 100);
  const width = fit.width * scaleFactor;
  const height = fit.height * scaleFactor;

  return {
    clipId: clip.id ?? '',
    sourceKind: clip.sourceKind,
    progressPercent,
    fitMode,
    fitWidth: fit.width,
    fitHeight: fit.height,
    left: canvas.width / 2 - width / 2 + state.positionX,
    top: canvas.height / 2 - height / 2 + state.positionY,
    width,
    height,
    positionX: state.positionX,
    positionY: state.positionY,
    scalePercent: state.scalePercent,
    rotationDeg: state.rotationDeg,
    opacityPercent,
    flipHorizontal: clip.flipHorizontal,
    flipVertical: clip.flipVertical,
    crop: buildCropLayoutDescriptor(clip),
    text: clip.sourceKind === 'text'
      ? buildTextLayoutDescriptor({
          text: text ?? clip.textContent ?? 'Text',
          fontFamily: clip.textFontFamily,
          fontSizePx: clip.textSizePx,
          color: clip.textColor,
          effect: clip.textEffect,
          videoTextCard: { typography: clip.textTypography },
        })
      : undefined,
    shape: clip.sourceKind === 'shape'
      ? buildShapeLayoutDescriptor({
          width: fit.width,
          height: fit.height,
          fillColor: clip.shapeFillColor ?? '#0ea5e9',
          borderColor: clip.shapeBorderColor ?? '#f8fafc',
          borderWidth: clip.shapeBorderWidth ?? 2,
          cornerRadius: clip.shapeCornerRadius ?? 18,
        })
      : undefined,
  };
}

export function getTransitionOpacityFactor(
  clip: Pick<EditorVisualClip, 'transitionIn' | 'transitionOut' | 'transitionDurationMs'>,
  localTimeSeconds: number,
  durationSeconds: number,
): number {
  const transitionSeconds = Math.min(Math.max(0, durationSeconds) / 2, Math.max(0, clip.transitionDurationMs) / 1000);
  let factor = 1;

  if (clip.transitionIn === 'fade' && transitionSeconds > 0 && localTimeSeconds < transitionSeconds) {
    factor *= Math.max(0, Math.min(1, localTimeSeconds / transitionSeconds));
  }

  if (clip.transitionOut === 'fade' && transitionSeconds > 0 && localTimeSeconds > durationSeconds - transitionSeconds) {
    factor *= Math.max(0, Math.min(1, (durationSeconds - localTimeSeconds) / transitionSeconds));
  }

  return factor;
}

export function buildStageObjectLayoutDescriptor(object: EditorStageObject): StageObjectLayoutDescriptor {
  return {
    objectId: object.id,
    kind: object.kind,
    left: object.x,
    top: object.y,
    width: object.width,
    height: object.height,
    rotationDeg: object.rotationDeg,
    opacityPercent: object.opacityPercent,
    blendMode: object.blendMode,
    text: object.kind === 'text'
      ? buildTextLayoutDescriptor({
          text: object.text,
          fontFamily: object.fontFamily,
          fontSizePx: object.fontSizePx,
          color: object.color,
          effect: 'none',
        })
      : undefined,
    shape: object.kind === 'rectangle'
      ? buildShapeLayoutDescriptor({
          width: object.width,
          height: object.height,
          fillColor: object.fillColor,
          borderColor: object.borderColor,
          borderWidth: object.borderWidth,
          cornerRadius: object.cornerRadius,
          insetPercent: 0,
        })
      : undefined,
  };
}

export function resolveTextSourceDimensions({
  text,
  fontSizePx,
  effect,
  fontFamily,
  typography,
}: {
  text: string;
  fontSizePx: number;
  effect: TextClipEffect;
  fontFamily: string;
  typography?: EditorTextTypography;
}): VisualSourceDimensions {
  const resolved = resolveVideoTextCardLayout({ text, fontSizePx, effect, fontFamily, typography });
  return { width: resolved.width, height: resolved.height };
}

export function fitVisualDimensions(
  source: VisualSourceDimensions,
  canvas: VisualLayoutCanvas,
  fitMode: EditorVisualClip['fitMode'] | 'text-object',
): VisualSourceDimensions {
  const safeWidth = Math.max(1, source.width);
  const safeHeight = Math.max(1, source.height);

  if (fitMode === 'text-object') {
    return { width: safeWidth, height: safeHeight };
  }

  if (fitMode === 'stretch') {
    return { width: canvas.width, height: canvas.height };
  }

  const scale = fitMode === 'cover'
    ? Math.max(canvas.width / safeWidth, canvas.height / safeHeight)
    : Math.min(canvas.width / safeWidth, canvas.height / safeHeight);

  return {
    width: safeWidth * scale,
    height: safeHeight * scale,
  };
}

export function buildCropLayoutDescriptor(clip: ClipEffectSourceClip): CropLayoutDescriptor {
  const crop = buildClipEffectDescriptorForClip(clip).crop;
  const visibleWidthPercent = Math.max(1, 100 - crop.cropLeftPercent - crop.cropRightPercent);
  const visibleHeightPercent = Math.max(1, 100 - crop.cropTopPercent - crop.cropBottomPercent);
  const maxXPercent = 1 - visibleWidthPercent / 100;
  const maxYPercent = 1 - visibleHeightPercent / 100;
  const renderCropXPercent = clampFloat(
    crop.cropLeftPercent / 100 - (crop.cropPanXPercent / 100) * (maxXPercent / 2),
    0,
    maxXPercent,
  ) * 100;
  const renderCropYPercent = clampFloat(
    crop.cropTopPercent / 100 - (crop.cropPanYPercent / 100) * (maxYPercent / 2),
    0,
    maxYPercent,
  ) * 100;

  return {
    ...crop,
    frameLeftPercent: crop.cropLeftPercent,
    frameRightPercent: crop.cropRightPercent,
    frameTopPercent: crop.cropTopPercent,
    frameBottomPercent: crop.cropBottomPercent,
    contentTranslateXPercent: crop.cropPanXPercent,
    contentTranslateYPercent: crop.cropPanYPercent,
    visibleWidthPercent,
    visibleHeightPercent,
    renderCropXPercent,
    renderCropYPercent,
  };
}

export function buildTextLayoutDescriptor({
  text,
  fontFamily,
  fontSizePx,
  color,
  effect,
  videoTextCard,
}: {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  color: string;
  effect: TextClipEffect;
  videoTextCard?: { typography?: EditorTextTypography };
}): TextLayoutDescriptor {
  const safeFontSize = Math.max(8, fontSizePx || 64);
  const bounds = videoTextCard
    ? resolveVideoTextCardLayout({ text, fontSizePx: safeFontSize, effect, fontFamily, typography: videoTextCard.typography })
    : measureTextObjectBounds({ text, fontSizePx: safeFontSize, effect, fontFamily });

  return {
    text: text || 'Text',
    fontFamily: fontFamily || 'Inter, system-ui, sans-serif',
    fontSizePx: safeFontSize,
    lineHeight: TEXT_LINE_HEIGHT,
    lineHeightPx: safeFontSize * TEXT_LINE_HEIGHT,
    color: color || '#f3f4f6',
    effect,
    effectPaddingPx: getTextEffectPadding(effect, safeFontSize),
    width: bounds.width,
    height: bounds.height,
    outlineWidthPx: effect === 'outline' ? 2 : 0,
  };
}

export function buildShapeLayoutDescriptor({
  width,
  height,
  fillColor,
  borderColor,
  borderWidth,
  cornerRadius,
  insetPercent = SHAPE_INSET_PERCENT,
}: {
  width: number;
  height: number;
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  cornerRadius: number;
  insetPercent?: number;
}): ShapeLayoutDescriptor {
  const insetX = width * (Math.max(0, insetPercent) / 100);
  const insetY = height * (Math.max(0, insetPercent) / 100);
  const innerWidth = Math.max(1, width - insetX * 2);
  const innerHeight = Math.max(1, height - insetY * 2);

  return {
    fillColor,
    borderColor,
    borderWidth: Math.max(0, borderWidth),
    cornerRadius: Math.max(0, Math.min(cornerRadius, innerWidth / 2, innerHeight / 2)),
    insetPercent,
    innerLeft: insetX,
    innerTop: insetY,
    innerWidth,
    innerHeight,
  };
}

function getTextEffectPadding(effect: TextClipEffect, fontSizePx: number): number {
  if (effect === 'glow') {
    return Math.ceil(fontSizePx * 0.28);
  }

  if (effect === 'shadow') {
    return Math.ceil(fontSizePx * 0.18);
  }

  if (effect === 'outline') {
    return Math.ceil(fontSizePx * 0.08);
  }

  return 0;
}

function clampFloat(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
