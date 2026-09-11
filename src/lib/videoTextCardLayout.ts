import type { EditorTextTypography, TextClipEffect } from '../types/flow';
import {
  createVideoTextCanvasMeasurer,
  layoutVideoText,
  type VideoTextLayoutResult,
  type VideoTextMeasurer,
} from './videoTextFlow';

/** Legacy text clips were authored as bold, tightly-led title cards. Keep those defaults for clips
 * that never claimed richer typography while routing both sizing and paint through one resolver. */
export const TEXT_CARD_DEFAULT_FONT_WEIGHT = 600;
export const TEXT_CARD_DEFAULT_LINE_HEIGHT_PERCENT = 112;
const TEXT_CARD_BASE_PADDING_FACTOR = 0.16;

export interface VideoTextCardLayoutOptions {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  effect: TextClipEffect;
  typography?: EditorTextTypography;
}

export interface ResolvedVideoTextCardLayout {
  layout: VideoTextLayoutResult;
  typography: EditorTextTypography;
  text: string;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  fontKerning: 'auto' | 'normal' | 'none';
  letterSpacingPx: number;
  paddingPx: number;
  width: number;
  height: number;
}

let sharedVideoTextMeasurer: VideoTextMeasurer | undefined;

/** One canvas measurer is shared by native pre-layout and final card paint. This matters for exact
 * managed faces: both consumers observe the same registered runtime alias and descriptor inputs. */
export function getVideoTextCanvasMeasurer(): VideoTextMeasurer {
  sharedVideoTextMeasurer ??= createVideoTextCanvasMeasurer();
  return sharedVideoTextMeasurer;
}

export function resolveVideoTextCardLayout(
  options: VideoTextCardLayoutOptions,
  measure: VideoTextMeasurer = getVideoTextCanvasMeasurer(),
): ResolvedVideoTextCardLayout {
  const typography: EditorTextTypography = {
    ...legacyTextEffectTypography(options.effect),
    ...(options.typography ?? {}),
  };
  const managedFace = typography.managedFace;
  // An exact managed identity owns its descriptors. Persisted mismatches are normally converted to
  // managedFaceIssue during normalization; resolving from the reference here keeps this low-level
  // rendering boundary exact even when called with unsanitized data.
  const fontWeight = managedFace?.weight ?? typography.fontWeight ?? TEXT_CARD_DEFAULT_FONT_WEIGHT;
  const fontStyle = managedFace?.style ?? typography.fontStyle ?? 'normal';
  const fontKerning = typography.fontKerning ?? 'auto';
  const letterSpacingPx = typography.letterSpacingPx ?? 0;
  const fontSizePx = Math.max(8, options.fontSizePx || 64);
  const text = options.text || 'Text';
  const fontFamily = options.fontFamily || 'Inter, system-ui, sans-serif';
  const layout = layoutVideoText(
    {
      text,
      fontFamily,
      fontSizePx,
      typography: {
        ...typography,
        fontWeight,
        fontStyle,
        fontKerning,
        lineHeightPercent: typography.lineHeightPercent ?? TEXT_CARD_DEFAULT_LINE_HEIGHT_PERCENT,
        letterSpacingPx,
        textAlign: typography.textAlign ?? 'center',
      },
    },
    measure,
  );

  const strokeWidthPx = Math.max(0, typography.strokeWidthPx ?? 0);
  const shadowBlurPx = Math.max(0, typography.shadowBlurPx ?? 0);
  const shadowOffsetXPx = typography.shadowOffsetXPx ?? 0;
  const shadowOffsetYPx = typography.shadowOffsetYPx ?? 0;
  const basePaddingPx = Math.max(8, fontSizePx * TEXT_CARD_BASE_PADDING_FACTOR);
  const strokeShadowPaddingPx = strokeWidthPx
    + shadowBlurPx
    + Math.max(Math.abs(shadowOffsetXPx), Math.abs(shadowOffsetYPx));
  const arcPaddingPx = typography.arcPercent ? fontSizePx * 1.5 : 0;
  const paddingPx = Math.ceil(basePaddingPx + strokeShadowPaddingPx + arcPaddingPx);

  return {
    layout,
    typography,
    text,
    fontFamily,
    fontSizePx,
    fontWeight,
    fontStyle,
    fontKerning,
    letterSpacingPx,
    paddingPx,
    width: Math.max(1, Math.ceil(Math.max(fontSizePx, layout.contentWidthPx) + paddingPx * 2)),
    height: Math.max(1, Math.ceil(Math.max(fontSizePx, layout.contentHeightPx) + paddingPx * 2)),
  };
}

/** Maps the old four-value effect control onto the richer canvas typography. Explicit typography
 * fields win in resolveVideoTextCardLayout, preserving the behavior of already-authored clips. */
function legacyTextEffectTypography(effect: TextClipEffect): Pick<
  EditorTextTypography,
  'strokeColor' | 'strokeWidthPx' | 'shadowColor' | 'shadowBlurPx' | 'shadowOffsetXPx' | 'shadowOffsetYPx'
> {
  if (effect === 'outline') {
    return {
      strokeColor: 'rgba(0,0,0,0.75)',
      strokeWidthPx: 2,
      shadowColor: 'rgba(0,0,0,0.5)',
      shadowBlurPx: 6,
      shadowOffsetYPx: 2,
    };
  }
  if (effect === 'shadow') {
    return { shadowColor: 'rgba(0,0,0,0.65)', shadowBlurPx: 20, shadowOffsetYPx: 6 };
  }
  if (effect === 'glow') {
    return { shadowColor: 'rgba(96,165,250,0.5)', shadowBlurPx: 32 };
  }
  return {};
}
