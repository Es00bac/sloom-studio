import type {
  AspectRatio,
  EditorClipFilter,
  EditorClipChromaKeySettings,
  EditorClipStrokeSettings,
  EditorStageBlendMode,
  EditorTextTypography,
  EditorVisualKeyframe,
  EditorVisualClip,
  EditorVisualSourceKind,
  TimelineAutomationPoint,
} from '../types/flow';
import type { EditorVisualClipProfessionalState } from '../types/videoProfessional';
import { sanitizeEditorVisualClipProfessionalState } from './videoProfessionalState';

export interface ManualEditorVisualSequenceSource {
  assetUrl?: string;
  nativeFilePath?: string;
  aspectRatio?: AspectRatio;
  text?: string;
  /** Source asset MIME type (e.g. `image/gif`) -- lets downstream FFmpeg export detect an
   *  animated GIF without guessing from the (often extension-less) blob: asset URL. */
  mimeType?: string;
}

export interface ManualEditorVisualSequenceClip {
  id?: string;
  sourceNodeId: string;
  sourceKind: EditorVisualSourceKind;
  trackIndex: number;
  startMs: number;
  aspectRatio?: AspectRatio;
  assetUrl?: string;
  nativeFilePath?: string;
  text?: string;
  mimeType?: string;
  sourceInMs: number;
  sourceOutMs?: number;
  durationSeconds?: number;
  trimStartMs: number;
  trimEndMs: number;
  playbackRate: number;
  reversePlayback: boolean;
  fitMode: 'contain' | 'cover' | 'stretch';
  scalePercent: number;
  scaleMotionEnabled: boolean;
  endScalePercent: number;
  opacityPercent: number;
  opacityAutomationPoints?: TimelineAutomationPoint[];
  keyframes?: EditorVisualKeyframe[];
  rotationDeg: number;
  rotationMotionEnabled: boolean;
  endRotationDeg: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
  positionX: number;
  positionY: number;
  motionEnabled: boolean;
  endPositionX: number;
  endPositionY: number;
  cropLeftPercent: number;
  cropRightPercent: number;
  cropTopPercent: number;
  cropBottomPercent: number;
  cropPanXPercent: number;
  cropPanYPercent: number;
  cropRotationDeg: number;
  filterStack: EditorClipFilter[];
  blendMode: EditorStageBlendMode;
  chromaKey?: EditorClipChromaKeySettings;
  stroke?: EditorClipStrokeSettings;
  transitionIn: 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down';
  transitionOut: 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down';
  transitionDurationMs: number;
  textContent?: string;
  textFontFamily: string;
  textSizePx: number;
  textColor: string;
  textEffect: 'none' | 'shadow' | 'glow' | 'outline';
  textBackgroundOpacityPercent: number;
  /** Paper-grade typography (weight/style/leading/tracking/align incl. justify/stroke/shadow/arc),
   *  carried by text AND comic clips — see `EditorVisualClip.textTypography`. */
  textTypography?: EditorTextTypography;
  shapeFillColor?: string;
  shapeBorderColor?: string;
  shapeBorderWidth?: number;
  shapeCornerRadius?: number;
  comicKind?: 'speech-bubble' | 'thought-bubble' | 'caption';
  comicTailAngleDeg?: number;
  comicTailLengthPx?: number;
  comicTailTipXPercent?: number;
  comicTailTipYPercent?: number;
  comicTailCurvePercent?: number;
  comicLineHeightPercent?: number;
  comicLetterSpacingPx?: number;
  comicTextAlign?: 'left' | 'center' | 'right';
  /** Assigned by the bounded Video Runtime IR; adjustment clips have no source-pixel pass. */
  runtimeRole?: 'media' | 'adjustment';
  professional?: EditorVisualClipProfessionalState;
}

export function buildManualEditorVisualSequenceClip(
  clip: EditorVisualClip,
  source: ManualEditorVisualSequenceSource,
): ManualEditorVisualSequenceClip {
  return {
    id: clip.id,
    sourceNodeId: clip.sourceNodeId,
    sourceKind: clip.sourceKind,
    trackIndex: clip.trackIndex,
    startMs: clip.startMs,
    aspectRatio: source.aspectRatio,
    assetUrl: source.assetUrl,
    nativeFilePath: source.nativeFilePath,
    text: source.text,
    mimeType: source.mimeType,
    sourceInMs: clip.sourceInMs,
    sourceOutMs: clip.sourceOutMs,
    durationSeconds: clip.durationSeconds,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
    playbackRate: clip.playbackRate,
    reversePlayback: clip.reversePlayback,
    fitMode: clip.fitMode,
    scalePercent: clip.scalePercent,
    scaleMotionEnabled: clip.scaleMotionEnabled,
    endScalePercent: clip.endScalePercent,
    opacityPercent: clip.opacityPercent,
    opacityAutomationPoints: cloneAutomationPoints(clip.opacityAutomationPoints),
    keyframes: clip.keyframes?.map((keyframe) => ({ ...keyframe })),
    rotationDeg: clip.rotationDeg,
    rotationMotionEnabled: clip.rotationMotionEnabled,
    endRotationDeg: clip.endRotationDeg,
    flipHorizontal: clip.flipHorizontal,
    flipVertical: clip.flipVertical,
    positionX: clip.positionX,
    positionY: clip.positionY,
    motionEnabled: clip.motionEnabled,
    endPositionX: clip.endPositionX,
    endPositionY: clip.endPositionY,
    cropLeftPercent: clip.cropLeftPercent ?? 0,
    cropRightPercent: clip.cropRightPercent ?? 0,
    cropTopPercent: clip.cropTopPercent ?? 0,
    cropBottomPercent: clip.cropBottomPercent ?? 0,
    cropPanXPercent: clip.cropPanXPercent ?? 0,
    cropPanYPercent: clip.cropPanYPercent ?? 0,
    cropRotationDeg: clip.cropRotationDeg ?? 0,
    filterStack: clip.filterStack?.map((filter) => ({ ...filter })) ?? [],
    blendMode: clip.blendMode ?? 'normal',
    chromaKey: clip.chromaKey ? { ...clip.chromaKey } : undefined,
    stroke: clip.stroke ? { ...clip.stroke } : undefined,
    transitionIn: clip.transitionIn,
    transitionOut: clip.transitionOut,
    transitionDurationMs: clip.transitionDurationMs,
    textContent: clip.textContent,
    textFontFamily: clip.textFontFamily,
    textSizePx: clip.textSizePx,
    textColor: clip.textColor,
    textEffect: clip.textEffect,
    textBackgroundOpacityPercent: clip.textBackgroundOpacityPercent,
    textTypography: clip.textTypography ? {
      ...clip.textTypography,
      managedFace: clip.textTypography.managedFace ? { ...clip.textTypography.managedFace } : undefined,
    } : undefined,
    shapeFillColor: clip.shapeFillColor,
    shapeBorderColor: clip.shapeBorderColor,
    shapeBorderWidth: clip.shapeBorderWidth,
    comicKind: clip.comicKind,
    comicTailAngleDeg: clip.comicTailAngleDeg,
    comicTailLengthPx: clip.comicTailLengthPx,
    comicTailTipXPercent: clip.comicTailTipXPercent,
    comicTailTipYPercent: clip.comicTailTipYPercent,
    comicTailCurvePercent: clip.comicTailCurvePercent,
    comicLineHeightPercent: clip.comicLineHeightPercent,
    comicLetterSpacingPx: clip.comicLetterSpacingPx,
    comicTextAlign: clip.comicTextAlign,
    shapeCornerRadius: clip.shapeCornerRadius,
    professional: sanitizeEditorVisualClipProfessionalState(clip.professional),
  };
}

function cloneAutomationPoints(
  points: TimelineAutomationPoint[] | undefined,
): TimelineAutomationPoint[] | undefined {
  return points?.map((point) => ({ ...point }));
}
