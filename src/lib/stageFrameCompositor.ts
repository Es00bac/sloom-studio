/**
 * The frame-server export compositor: draws ONE output frame at ONE exact timestamp by calling the
 * SAME layout/effect math the Edit Stage (Program Monitor) preview uses to draw a frame at time t —
 * `buildVisualClipLayoutDescriptor` (src/lib/editorVisualLayout.ts), `buildClipEffectDescriptorForClip`
 * (src/lib/editorClipEffects.ts), and the shared canvas painters `drawComicStageObject` /
 * `drawTextStageObject` / `drawRectangleStageObject` / `renderTextCard` (src/lib/mediaComposition.ts).
 *
 * This module is the "one compositor" docs/gpu-frame-server-export-brief.md calls for: it does NOT
 * re-derive clip position/scale/rotation/opacity/crop/blend/transition math independently. Every
 * number that ends up on the canvas comes from the exact function the DOM preview also calls — the
 * only place this module makes its OWN decision is which CanvasRenderingContext2D primitive
 * reproduces a given CSS rule (e.g. `ctx.filter` for `cssFilter`, `ctx.globalCompositeOperation` for
 * `cssBlendMode` — both accept the identical CSS Compositing spec keyword strings, so there is no
 * translation table to drift, unlike the legacy ffmpeg `blend=` path which mistranslates/drops modes
 * — see `mapClipBlendModeToFFmpeg`'s doc comment in editorClipEffects.ts).
 *
 * Split into pure "resolve" / "compute" functions (deterministic given plain data, no Canvas/DOM
 * needed) and thin "paint" functions (the only parts that touch a real CanvasRenderingContext2D) so
 * the deterministic parts are unit-testable without a browser canvas implementation.
 */
import {
  buildStageObjectLayoutDescriptor,
  buildVisualClipLayoutDescriptor,
  type StageObjectLayoutDescriptor,
  type VisualClipLayoutDescriptor,
  type VisualLayoutClip,
  type VisualLayoutCanvas,
} from './editorVisualLayout';
import { buildClipEffectDescriptorForClip, type ClipEffectDescriptor } from './editorClipEffects';
import { getVisualKeyframeStateAtProgress } from './editorKeyframes';
import {
  drawComicStageObject,
  drawRectangleStageObject,
  drawTextStageObject,
  renderTextCard,
  resolveEditPointCrossDissolveOffsetSeconds,
  type ComposeSequenceVisualClip,
  type PreparedSequenceVisualClip,
} from './mediaComposition';
import { applyChromaKeyToImageData } from './chromaKeyPreview';
import type { VideoMaskModel } from './videoVfxPipeline';
import type { EditorStageObject } from '../types/flow';

export interface StageFrameCanvasSize {
  width: number;
  height: number;
}

/** A visual clip plus everything about it that's resolved ONCE up front (media probing / duration
 *  resolution), reused across every frame the deterministic stepper visits. `sourceDurationSeconds`
 *  is the underlying media's real duration (0 for text/shape/comic/image, where it's meaningless) —
 *  needed by `resolveStageSourceTimeSeconds` to correctly resolve trim in/out against the ACTUAL
 *  source length, not a placeholder. */
export interface StageFrameTimelineClip {
  clip: ComposeSequenceVisualClip;
  clipDurationSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceDurationSeconds: number;
}

export interface ActiveStageFrameClip {
  clip: ComposeSequenceVisualClip;
  sourceWidth: number;
  sourceHeight: number;
  sourceDurationSeconds: number;
  localTimeSeconds: number;
  progressPercent: number;
  clipDurationSeconds: number;
}

/**
 * Resolves the SAME "cross-dissolve overlap" offset the legacy ffmpeg export path already computes
 * (`resolveEditPointCrossDissolveOffsetSeconds`) so an incoming clip whose `transitionIn` is a fade
 * against an adjacent same-track clip's `transitionOut` fade starts playing `transitionDurationMs`
 * early, exactly like the Edit Stage preview's `getPreviewEditPointDissolveOffsetSeconds`
 * (ManualEditorWorkspaceUtils.tsx) — both express "the two clips overlap for the crossfade" but were
 * written against different clip-array shapes, so this one call site is where that equivalence gets
 * exercised for the new engine. `inputIndex`/`inputName`/`sourceUrl` are ffmpeg-input bookkeeping
 * this function never reads — dummy values are inert here.
 */
export function resolveDissolveOffsetSeconds(
  clip: StageFrameTimelineClip,
  allClips: StageFrameTimelineClip[],
): number {
  const toPrepared = (entry: StageFrameTimelineClip): PreparedSequenceVisualClip => ({
    clip: entry.clip,
    inputIndex: 0,
    inputName: '',
    sourceUrl: '',
    clipDurationSeconds: entry.clipDurationSeconds,
  });

  return resolveEditPointCrossDissolveOffsetSeconds(toPrepared(clip), allClips.map(toPrepared));
}

/**
 * Which clips are on stage at `timeSeconds`, and each one's local playhead position — the
 * deterministic, DOM-free equivalent of `getProgramStageClips` (ManualEditorWorkspaceUtils.tsx),
 * operating on the export driver's flattened `ComposeSequenceVisualClip` instead of a `SourceBinItem`
 * lookup. Pure function of its inputs: same `timeSeconds` always yields the same result, with no
 * wall-clock or `requestAnimationFrame` dependence anywhere in the call chain.
 */
export function resolveActiveStageFrameClips(
  clips: StageFrameTimelineClip[],
  timeSeconds: number,
): ActiveStageFrameClip[] {
  return clips
    .flatMap((entry) => {
      const startSeconds = entry.clip.startMs / 1000;
      const dissolveOffsetSeconds = resolveDissolveOffsetSeconds(entry, clips);
      const effectiveStartSeconds = Math.max(0, startSeconds - dissolveOffsetSeconds);
      const endSeconds = startSeconds + entry.clipDurationSeconds;

      if (timeSeconds < effectiveStartSeconds || timeSeconds > endSeconds) {
        return [];
      }

      const localTimeSeconds = Math.max(0, timeSeconds - effectiveStartSeconds);
      const progressPercent = entry.clipDurationSeconds > 0
        ? Math.max(0, Math.min(1, localTimeSeconds / Math.max(entry.clipDurationSeconds, 0.001))) * 100
        : 0;

      return [{
        clip: entry.clip,
        sourceWidth: entry.sourceWidth,
        sourceHeight: entry.sourceHeight,
        sourceDurationSeconds: entry.sourceDurationSeconds,
        localTimeSeconds,
        progressPercent,
        clipDurationSeconds: entry.clipDurationSeconds,
      } satisfies ActiveStageFrameClip];
    })
    .sort((left, right) => left.clip.trackIndex - right.clip.trackIndex || left.clip.startMs - right.clip.startMs);
}

/** The plain-number draw plan for one clip's frame — everything a canvas paint step needs, with NO
 *  canvas dependency, so this is unit-testable in plain Node/jsdom without a Canvas2D polyfill. */
export interface StageFrameDrawPlan {
  layout: VisualClipLayoutDescriptor;
  effect: ClipEffectDescriptor;
  centerX: number;
  centerY: number;
  alpha: number;
  compositeOperation: GlobalCompositeOperation;
}

export function computeStageFrameDrawPlan(
  activeClip: ActiveStageFrameClip,
  canvas: VisualLayoutCanvas,
): StageFrameDrawPlan {
  const layoutClip = activeClip.clip as unknown as VisualLayoutClip;
  const layout = buildVisualClipLayoutDescriptor({
    clip: layoutClip,
    canvas,
    source: { width: activeClip.sourceWidth, height: activeClip.sourceHeight },
    progressPercent: activeClip.progressPercent,
    localTimeSeconds: activeClip.localTimeSeconds,
    durationSeconds: activeClip.clipDurationSeconds,
    text: activeClip.clip.textContent ?? activeClip.clip.text,
  });
  const effect = buildClipEffectDescriptorForClip(layoutClip, activeClip.localTimeSeconds * 1_000);

  return {
    layout,
    effect,
    centerX: layout.left + layout.width / 2,
    centerY: layout.top + layout.height / 2,
    alpha: Math.max(0, Math.min(1, layout.opacityPercent / 100)),
    compositeOperation: mapBlendModeToCanvasComposite(effect.cssBlendMode),
  };
}

export function computeStageObjectDrawPlan(object: EditorStageObject): {
  layout: StageObjectLayoutDescriptor;
  centerX: number;
  centerY: number;
  alpha: number;
  compositeOperation: GlobalCompositeOperation;
} {
  const layout = buildStageObjectLayoutDescriptor(object);

  return {
    layout,
    centerX: layout.left + layout.width / 2,
    centerY: layout.top + layout.height / 2,
    alpha: Math.max(0, Math.min(1, layout.opacityPercent / 100)),
    compositeOperation: mapBlendModeToCanvasComposite(layout.blendMode),
  };
}

/**
 * Canvas `globalCompositeOperation` and CSS `mix-blend-mode` both implement the W3C Compositing and
 * Blending spec's blend-mode keywords verbatim (`multiply`, `screen`, `overlay`, `darken`, `lighten`,
 * `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`,
 * `saturation`, `color`, `luminosity`) — so, unlike FFmpeg's `blend=all_mode=` (which needs a name
 * table and has no equivalent at all for the four non-separable HSL modes, see
 * `mapClipBlendModeToFFmpeg`), this is an identity mapping, not a translation. That is a genuine
 * correctness improvement over the legacy export path, not just a port.
 */
export function mapBlendModeToCanvasComposite(cssBlendMode: string): GlobalCompositeOperation {
  if (cssBlendMode === 'normal') {
    return 'source-over';
  }

  return cssBlendMode as GlobalCompositeOperation;
}

/**
 * Applies a resolved draw plan's transform/alpha/blend/filter to `ctx`, calls `paintContent` to draw
 * the clip's own pixels (image/video/canvas-card) in the clip's LOCAL, unrotated, unflipped
 * width/height space (top-left at `-width/2,-height/2`), then restores. Isolated from
 * `computeStageFrameDrawPlan` so the plan itself stays unit-testable without a Canvas2D context.
 */
export function paintPlannedClip(
  ctx: CanvasRenderingContext2D,
  plan: StageFrameDrawPlan,
  paintContent: (ctx: CanvasRenderingContext2D, layout: VisualClipLayoutDescriptor) => void,
): void {
  ctx.save();
  ctx.globalAlpha = plan.alpha;
  ctx.globalCompositeOperation = plan.compositeOperation;
  ctx.translate(plan.centerX, plan.centerY);
  ctx.rotate((plan.layout.rotationDeg * Math.PI) / 180);
  ctx.scale(plan.layout.flipHorizontal ? -1 : 1, plan.layout.flipVertical ? -1 : 1);
  if (plan.effect.stabilizationExecution.status === 'unsupported') {
    throw new Error(`Video stabilization cannot be previewed: ${plan.effect.stabilizationExecution.reason}`);
  }
  if (plan.effect.stabilizationExecution.status === 'ready') {
    ctx.translate(plan.effect.stabilizationExecution.offsetX! * plan.layout.width, plan.effect.stabilizationExecution.offsetY! * plan.layout.height);
    ctx.scale(plan.effect.stabilizationExecution.scale!, plan.effect.stabilizationExecution.scale!);
  }
  if (plan.effect.maskExecution.status === 'unsupported') {
    throw new Error(`Video mask cannot be previewed: ${plan.effect.maskExecution.reason}`);
  }
  if (plan.effect.maskExecution.status === 'ready') {
    clipVideoMaskToCanvas(ctx, plan.effect.maskExecution.model, plan.layout.width, plan.layout.height);
    ctx.globalAlpha *= plan.effect.maskExecution.model.shapes[0]?.opacity ?? 1;
  }
  paintContent(ctx, plan.layout);
  ctx.restore();
}

/** Applies the same bounded one-shape mask geometry used by the native alpha filter. */
export function clipVideoMaskToCanvas(
  ctx: CanvasRenderingContext2D,
  mask: VideoMaskModel,
  width: number,
  height: number,
): void {
  const shape = mask.shapes[0];
  if (!shape || mask.inverted) throw new Error('Only a non-inverted executable video mask can be previewed.');
  const localX = (value: number) => -width / 2 + value * width;
  const localY = (value: number) => -height / 2 + value * height;
  ctx.beginPath();
  if (shape.kind === 'rect') {
    ctx.rect(localX(shape.x), localY(shape.y), shape.width * width, shape.height * height);
  } else if (shape.kind === 'ellipse') {
    ctx.ellipse(localX(shape.centerX), localY(shape.centerY), shape.radiusX * width, shape.radiusY * height, 0, 0, Math.PI * 2);
  } else {
    throw new Error('Bezier video masks are not executable in this bounded route.');
  }
  ctx.clip();
}

/**
 * Draws an already-decoded bitmap (image frame, seeked video frame, or GIF frame) into the clip's
 * box, honoring the SAME crop-frame/content-translate/rotate/filter rules
 * `ProgramStageMedia`'s CSS (`cropFrameStyle` + `cropContentStyle`) applies: crop is an inset on the
 * already-fitted box (not a pre-scale source crop — the fit scaling happened upstream in
 * `buildVisualClipLayoutDescriptor`/`fitVisualDimensions`), then the crop CONTENT pans/rotates inside
 * that inset frame.
 */
export function paintCroppedBitmap(
  ctx: CanvasRenderingContext2D,
  layout: VisualClipLayoutDescriptor,
  source: CanvasImageSource,
  cssFilter = '',
): void {
  const frame = resolveCropFrameRect(layout);

  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.x, frame.y, frame.width, frame.height);
  ctx.clip();
  ctx.filter = cssFilter || 'none';
  ctx.translate(
    frame.x + frame.width / 2 + (layout.crop.contentTranslateXPercent / 100) * layout.width,
    frame.y + frame.height / 2 + (layout.crop.contentTranslateYPercent / 100) * layout.height,
  );
  ctx.rotate((layout.crop.cropRotationDeg * Math.PI) / 180);
  // The DOM's crop content fills `h-full w-full` (100%/100% of the FRAME box, i.e. object-cover of
  // the already-fitted media at frame size), positioned back at the frame's own center.
  ctx.drawImage(source, -frame.width / 2, -frame.height / 2, frame.width, frame.height);
  ctx.restore();
}

function resolveCropFrameRect(layout: VisualClipLayoutDescriptor): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const { width, height, crop } = layout;
  const frameLeft = (crop.frameLeftPercent / 100) * width;
  const frameRight = (crop.frameRightPercent / 100) * width;
  const frameTop = (crop.frameTopPercent / 100) * height;
  const frameBottom = (crop.frameBottomPercent / 100) * height;

  return {
    x: -width / 2 + frameLeft,
    y: -height / 2 + frameTop,
    width: Math.max(0, width - frameLeft - frameRight),
    height: Math.max(0, height - frameTop - frameBottom),
  };
}

/**
 * Draws the clip stroke/outline effect (`ClipEffectDescriptor.cssOutline`) as an inset ring around
 * the crop frame, matching `ProgramStageMedia`'s `boxShadow: inset 0 0 0 Npx color` overlay div.
 * A plain `strokeRect` inset by half the line width reproduces an INSET box-shadow ring closely
 * (both hug the inside edge of the frame); this is a cosmetic clip effect, not position/timing math,
 * so pixel-perfect edge antialiasing parity is not claimed — see docs/render-parity for evidence.
 */
export function paintCropFrameOutline(
  ctx: CanvasRenderingContext2D,
  layout: VisualClipLayoutDescriptor,
  outline: NonNullable<ClipEffectDescriptor['cssOutline']>,
): void {
  const frame = resolveCropFrameRect(layout);
  const lineWidth = Math.max(1, outline.widthPx);

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, outline.opacityPercent / 100));
  ctx.strokeStyle = outline.color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(
    frame.x + lineWidth / 2,
    frame.y + lineWidth / 2,
    Math.max(0, frame.width - lineWidth),
    Math.max(0, frame.height - lineWidth),
  );
  ctx.restore();
}

/** Chroma-keys `source` (an already-drawn-to-scratch-canvas ImageData) exactly as
 *  `ChromaKeyPreviewMedia` does for the live preview, then returns a bitmap-ready canvas. */
export function applyChromaKeyToCanvasSource(
  scratch: HTMLCanvasElement | OffscreenCanvas,
  chromaKey: NonNullable<ClipEffectDescriptor['chromaKey']>,
): void {
  const context = scratch.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (!context) {
    return;
  }

  const imageData = context.getImageData(0, 0, scratch.width, scratch.height);
  applyChromaKeyToImageData(imageData, chromaKey);
  context.putImageData(imageData, 0, 0);
}

/** Draws a comic bubble/caption clip's card. Unlike the legacy export (`renderComicCard` called
 *  WITHOUT a `tailSample`, baking the clip's static first-keyframe tail — see that function's doc
 *  comment in mediaComposition.ts), this samples the tail at THIS frame's exact progress, so a
 *  keyframed tail animates in the export exactly like it does live on the stage. This fixes a real,
 *  previously-documented preview/export divergence as a side effect of sampling per frame. */
export function resolveComicTailSample(
  clip: ComposeSequenceVisualClip,
  progressPercent: number,
): { tipXPercent?: number; tipYPercent?: number; curvePercent?: number } {
  const state = getVisualKeyframeStateAtProgress(clip, progressPercent);
  return {
    tipXPercent: state.tailTipXPercent,
    tipYPercent: state.tailTipYPercent,
    curvePercent: state.tailCurvePercent,
  };
}

export {
  drawComicStageObject,
  drawRectangleStageObject,
  drawTextStageObject,
  renderTextCard,
};
