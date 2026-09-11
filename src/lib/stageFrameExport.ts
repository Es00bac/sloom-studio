/**
 * The frame-server export driver (docs/gpu-frame-server-export-brief.md): a deterministic,
 * fixed-timestep alternative to `composeSequenceMedia`'s ffmpeg `filter_complex` translation.
 *
 * Drop-in replacement contract: `renderStageFrameSequence` takes the SAME options as
 * `composeSequenceMedia` and returns the same `ComposeSequenceMediaResult` shape, so callers (see
 * `flowExecution.ts`'s `executeCompositionNode`) can pick one or the other behind a setting
 * (`ProviderSettings.exportCompositorPreference`) without touching anything downstream.
 *
 * How it stays WYSIWYG: every frame is drawn by stepping the SAME layout/effect functions the Edit
 * Stage preview calls (`src/lib/stageFrameCompositor.ts` — read that module's doc comment first).
 * This module's own job is everything AROUND that: resolving media (durations/dimensions) once up
 * front, stepping time deterministically (`t = n / fps`, fully decoupled from `requestAnimationFrame`
 * / wall clock — see `computeStageFrameCount`/`computeStageFrameTimestamps`), maintaining a small
 * pool of seeked `<video>` elements for frame-accurate video sampling, reading back each composited
 * frame as raw RGBA, and streaming those frames plus the (legacy-identical) audio graph to the native
 * render service's `/render-stream` endpoint.
 *
 * Honest caveat (video sources): a clip whose source is `video`/`composition` is sampled by seeking
 * an `HTMLVideoElement` to the exact target time and awaiting its `seeked` event once per output
 * frame. This is frame-ACCURATE in the sense that it asks for and waits on the exact timestamp, but
 * it is not a guaranteed frame-EXACT decode on every codec/container — some decoders snap a seek to
 * the nearest keyframe/GOP boundary rather than decoding forward to the precise requested frame,
 * exactly the caveat every non-linear editor has for compressed source video. For this milestone,
 * stills + transforms + transitions (the common case for the motion-comic workflow this shipped for)
 * are exact; video-in-video composites should be spot-checked against the stage before trusting them
 * frame-for-frame. Out of scope this pass: a browser-without-native-service WebCodecs fallback (the
 * engine requires the native render service to be reachable; otherwise callers fall back to the
 * legacy path, which still has the browser ffmpeg.wasm fallback).
 */
import {
  buildSequenceAudioMixFilterGraph,
  detectAnimatedGifClip,
  getMediaDuration,
  renderComicCard,
  renderShapeCard,
  renderTextCard,
  resolveSequenceLoudnessNormalizationPlan,
  resolveSequenceAudioExtension,
  resolveSequenceTimelineDurationSeconds,
  resolveSequenceVisualClipDuration,
  type ComposeSequenceMediaOptions,
  type ComposeSequenceMediaResult,
  type ComposeSequenceVisualClip,
  type PreparedSequenceAudioTrack,
  type PreparedSequenceVisualClip,
} from './mediaComposition';
import {
  computeStageFrameDrawPlan,
  computeStageObjectDrawPlan,
  paintCropFrameOutline,
  paintCroppedBitmap,
  paintPlannedClip,
  resolveActiveStageFrameClips,
  resolveComicTailSample,
  drawComicStageObject,
  drawRectangleStageObject,
  drawTextStageObject,
  type ActiveStageFrameClip,
  type StageFrameCanvasSize,
  type StageFrameTimelineClip,
} from './stageFrameCompositor';
import { applyChromaKeyToImageData } from './chromaKeyPreview';
import { buildClipEffectDescriptor } from './editorClipEffects';
import { createMediaDurationResolver, type MediaDurationLoader } from './mediaDurationCache';
import { resolveEditorAudioSourceRangeMs } from './editorAudioSourceRange';
import { resolveVisualClipSourceRangeMs } from './editorTimelineSourceRange';
import { resolveStageSourceTimeSeconds } from '../components/Editor/ManualEditorWorkspaceUtils';
import { resolveTextSourceDimensions } from './editorVisualLayout';
import { isGifAssetReference } from './mediaFormatRegistry';
import { decodeGifFrames, selectGifFrameIndexAtTime, type GifDecodeResult } from './gifFrames';
import { getVideoCanvasDimensions } from './videoCanvas';
import {
  getVideoExportPresetAvailability,
  getVideoExportPresetFrameRateAvailability,
  resolveVideoExportPreset,
} from './videoPremiereParity';
import {
  getNativeRenderThreadArgs,
  getNativeSequenceCommandPrefix,
  getNativeSequenceEncoderArgs,
  getNativeSequencePixelFormatFilter,
  type NativeRenderExecutionBackend,
} from './nativeRenderSupport';
import { renderViaLocalNativeFFmpeg, resolveNativeRenderTarget } from './localNativeRender';
import { fetchAsStreamAudioInput, renderStageFrameStream, type StageFrameStreamMetadata } from './nativeRenderStream';
import type { EditorStageObject } from '../types/flow';
import { ensureBundledFontDependenciesReady } from './bundledFontLibrary';
import { collectVideoBundledFontDependencies } from './managedBundledFonts';
import { isLongFormSequence } from './videoLongFormTimeline';

/** `t = n / fps` for `n` in `[0, frameCount)` — the deterministic stepper. Pure function of its
 *  inputs: no `requestAnimationFrame`, no `Date.now()`, no wall-clock dependence anywhere. Calling
 *  it twice with the same arguments always yields the identical array, and the SAME timestamps drive
 *  both the frame loop below and (by construction, since it's the only place frame count is decided)
 *  the `-frames:v`-equivalent duration of the resulting encode. */
export function computeStageFrameCount(durationSeconds: number, fps: number): number {
  const safeDuration = Math.max(0, durationSeconds);
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  return Math.max(1, Math.ceil(safeDuration * safeFps));
}

export function computeStageFrameTimestamps(durationSeconds: number, fps: number): number[] {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const frameCount = computeStageFrameCount(durationSeconds, safeFps);
  return Array.from({ length: frameCount }, (_, index) => index / safeFps);
}

/** The browser stage compositor seeks and reads back every output frame as RGBA. That path is
 * intentionally limited to short work; feature-length sequences use native FFmpeg's media graph. */
export function supportsStageFrameExportDuration(durationSeconds: number): boolean {
  return !isLongFormSequence(durationSeconds);
}

export interface DirectNativeVideoRenderPlan {
  inputName: string;
  outputName: string;
  command: string[];
}

/**
 * Builds the deliberately narrow native fast path for the common "one untouched video on V1"
 * sequence. The normal frame compositor remains authoritative as soon as the timeline contains an
 * actual edit. This predicate is intentionally structural rather than heuristic: an edited clip
 * must never silently take a route that cannot reproduce its stage pixels.
 *
 * The source is handed to native FFmpeg once (by linked path when available, otherwise by the
 * already-hydrated asset URL), uploaded once per decoded frame, then scaled and encoded on VAAPI.
 * That removes the expensive browser seek -> canvas paint -> RGBA readback -> HTTP upload loop
 * while preserving the selected output size, frame rate, duration, and hardware preset.
 */
export function buildDirectNativeVideoRenderPlan({
  clip,
  visualClipCount,
  enabledAudioTrackCount,
  stageObjectCount,
  sourceWidth,
  sourceHeight,
  sourceDurationSeconds,
  clipDurationSeconds,
  canvas,
  timelineDurationSeconds,
  frameRate,
  backend,
  exportPreset,
}: {
  clip: ComposeSequenceVisualClip;
  visualClipCount: number;
  enabledAudioTrackCount: number;
  stageObjectCount: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceDurationSeconds: number;
  clipDurationSeconds: number;
  canvas: StageFrameCanvasSize;
  timelineDurationSeconds: number;
  frameRate: number;
  backend: NativeRenderExecutionBackend;
  exportPreset: ReturnType<typeof resolveVideoExportPreset>;
}): DirectNativeVideoRenderPlan | null {
  if (
    backend !== 'amd-vaapi'
    || visualClipCount !== 1
    || enabledAudioTrackCount !== 0
    || stageObjectCount !== 0
    || (clip.sourceKind !== 'video' && clip.sourceKind !== 'composition')
    || clip.runtimeRole === 'adjustment'
    || !clip.assetUrl
    || exportPreset.imageSequence
    || exportPreset.preservesAlpha
    || getNativeSequencePixelFormatFilter(backend, exportPreset) !== 'format=nv12,hwupload'
  ) {
    return null;
  }

  const sourceRange = resolveVisualClipSourceRangeMs(clip, sourceDurationSeconds);
  const sourceDurationMs = Math.max(0, Math.round(sourceDurationSeconds * 1_000));
  const durationToleranceMs = Math.max(2, 1_000 / Math.max(1, frameRate));
  const usesWholeSource = (clip.sourceInMs ?? 0) === 0
    && clip.trimStartMs === 0
    && clip.trimEndMs === 0
    && sourceRange.sourceInMs === 0
    && sourceRange.sourceOutMs === sourceDurationMs;
  const hasMatchingDuration = Math.abs(clipDurationSeconds - timelineDurationSeconds) <= durationToleranceMs / 1_000;
  const fitNeedsNoLetterboxOrCrop = clip.fitMode === 'stretch'
    || (sourceWidth > 0
      && sourceHeight > 0
      && canvas.width > 0
      && canvas.height > 0
      && sourceWidth * canvas.height === sourceHeight * canvas.width);
  const filtersAreInactive = !(clip.filterStack ?? []).some((filter) => filter.enabled);
  const opacityAutomationIsIdentity = (clip.opacityAutomationPoints ?? [])
    .every((point) => point.valuePercent === 100);
  const keyframesAreIdentity = (clip.keyframes ?? []).every((keyframe) => (
    keyframe.positionX === 0
    && keyframe.positionY === 0
    && keyframe.scalePercent === 100
    && keyframe.rotationDeg === 0
    && keyframe.opacityPercent === 100
    && keyframe.tailTipXPercent === undefined
    && keyframe.tailTipYPercent === undefined
    && keyframe.tailCurvePercent === undefined
  ));
  const professionalStateIsInactive = (clip.professional?.parameterKeyframes?.length ?? 0) === 0
    && (clip.professional?.masks?.length ?? 0) === 0
    && (clip.professional?.retime?.length ?? 0) === 0
    && !clip.professional?.color
    && !clip.professional?.stabilization?.enabled
    && !clip.professional?.nestedSequenceId
    && !clip.professional?.adjustmentLayer
    && !clip.professional?.multicamSourceId
    && !clip.professional?.multicamAngleId
    && (!clip.professional?.chromaKeyMode || clip.professional.chromaKeyMode === 'off');

  if (
    clip.startMs !== 0
    || !usesWholeSource
    || !hasMatchingDuration
    || clip.playbackRate !== 1
    || clip.reversePlayback
    || !fitNeedsNoLetterboxOrCrop
    || clip.scalePercent !== 100
    || clip.scaleMotionEnabled
    || clip.endScalePercent !== 100
    || clip.opacityPercent !== 100
    || !opacityAutomationIsIdentity
    || !keyframesAreIdentity
    || clip.rotationDeg !== 0
    || clip.rotationMotionEnabled
    || clip.endRotationDeg !== 0
    || clip.flipHorizontal
    || clip.flipVertical
    || clip.positionX !== 0
    || clip.positionY !== 0
    || clip.motionEnabled
    || clip.endPositionX !== 0
    || clip.endPositionY !== 0
    || (clip.cropLeftPercent ?? 0) !== 0
    || (clip.cropRightPercent ?? 0) !== 0
    || (clip.cropTopPercent ?? 0) !== 0
    || (clip.cropBottomPercent ?? 0) !== 0
    || (clip.cropPanXPercent ?? 0) !== 0
    || (clip.cropPanYPercent ?? 0) !== 0
    || (clip.cropRotationDeg ?? 0) !== 0
    || !filtersAreInactive
    || (clip.blendMode ?? 'normal') !== 'normal'
    || clip.chromaKey?.enabled
    || clip.stroke?.enabled
    || clip.transitionIn !== 'none'
    || clip.transitionOut !== 'none'
    || !professionalStateIsInactive
  ) {
    return null;
  }

  const inputName = 'sequence-direct-video-source.mp4';
  const outputName = `sequence-output.${exportPreset.extension}`;
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const formattedFrameRate = Number(safeFrameRate.toFixed(3)).toString();
  const formattedDuration = Math.max(0.001, timelineDurationSeconds).toFixed(3);

  return {
    inputName,
    outputName,
    command: [
      '-y',
      ...getNativeSequenceCommandPrefix(backend),
      '-i', inputName,
      // Container and elementary video durations can differ by a fraction of a second. Clone the
      // final decoded frame for a bounded interval and let the authoritative `-t` below cap it, so
      // the optimized route ends at the same timeline boundary as the frame compositor.
      '-vf', `tpad=stop_mode=clone:stop_duration=${formattedDuration},format=nv12,hwupload,scale_vaapi=w=${canvas.width}:h=${canvas.height}:format=nv12:mode=hq:reset_sar=1`,
      '-map', '0:v:0',
      '-an',
      '-r', formattedFrameRate,
      '-t', formattedDuration,
      ...getNativeSequenceEncoderArgs(backend, exportPreset),
      ...(exportPreset.containerArgs ?? []),
      outputName,
    ],
  };
}

interface ResolvedVisualClip {
  clip: ComposeSequenceVisualClip;
  clipDurationSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceDurationSeconds: number;
  isAnimatedGif: boolean;
}

/**
 * Attempts the frame-server export. Returns `null` (never throws for unreachability) when the
 * native render service isn't configured/reachable or the requested export preset is an image
 * sequence (a different, non-video code path this milestone doesn't touch) — callers should fall
 * back to `composeSequenceMedia` in either case, exactly like `renderViaLocalNativeFFmpeg`'s
 * null-means-fallback contract elsewhere in this codebase.
 */
export async function renderStageFrameSequence({
  visualClips,
  audioTracks,
  stageObjects = [],
  aspectRatio = '16:9',
  videoResolution = '1080p',
  frameRate = 30,
  exportPresetId,
  providerSettings,
  audioMixerBuses,
  loudnessNormalization,
  captionEmbedding,
}: ComposeSequenceMediaOptions): Promise<ComposeSequenceMediaResult | null> {
  await ensureBundledFontDependenciesReady(collectVideoBundledFontDependencies({
    visualClips,
    stageObjects,
  }));
  if (visualClips.length === 0 && stageObjects.length === 0) {
    throw new Error('Manual editor compositions need at least one visual clip or stage object.');
  }

  // The frame-stream protocol currently accepts raw video frames plus audio inputs only. Returning
  // null intentionally sends this request through the legacy native FFmpeg graph, where the same
  // validated SRT input is muxed as one complete mov_text stream instead of being dropped.
  if (captionEmbedding) return null;

  if (!providerSettings) {
    return null;
  }

  const exportPreset = resolveVideoExportPreset(exportPresetId);

  if (exportPreset.imageSequence) {
    // Image-sequence export has no encode/mux step to stream frames into — out of scope this pass.
    return null;
  }

  const target = await resolveNativeRenderTarget(providerSettings);

  if (!target) {
    return null;
  }

  const presetAvailability = getVideoExportPresetAvailability(exportPreset, `native-${target.backend}` as const);

  if (!presetAvailability.available) {
    throw new Error(`${exportPreset.label} is unavailable for ${presetAvailability.label} render. ${presetAvailability.reason ?? exportPreset.caveat}`);
  }

  const frameRateAvailability = getVideoExportPresetFrameRateAvailability(exportPreset, frameRate);
  if (!frameRateAvailability.available) {
    throw new Error(frameRateAvailability.reason);
  }

  const canvas = getVideoCanvasDimensions(aspectRatio, videoResolution);
  const resolveMediaDuration = createMediaDurationResolver(getMediaDuration);
  const resolvedClips = await Promise.all(
    visualClips.map((clip) => resolveVisualClipMedia(clip, resolveMediaDuration)),
  );

  if (resolvedClips.some((entry) => entry.clip.sourceKind === 'video' || entry.clip.sourceKind === 'composition')) {
    // eslint-disable-next-line no-console
    console.warn(
      'stageFrameExport: this project has video/composition-sourced clips. Frame sampling seeks each '
      + 'output frame and awaits the decoder\'s "seeked" event, which is frame-ACCURATE but not a '
      + 'guaranteed frame-EXACT decode on every codec — spot-check video-in-video composites against '
      + 'the stage. See stageFrameExport.ts\'s module doc comment.',
    );
  }

  const enabledAudioTracks = audioTracks.filter((track) => track.enabled);
  const preparedAudioTracks = await Promise.all(
    enabledAudioTracks.map(async (track, index) => {
      const sourceDurationSeconds = await resolveMediaDuration(track.url, track.sourceKind === 'audio' ? 'audio' : 'video');
      const sourceRange = resolveEditorAudioSourceRangeMs(track, sourceDurationSeconds);
      return {
        track,
        inputName: `sequence-audio-${index + 1}.${resolveSequenceAudioExtension(track)}`,
        sourceUrl: track.url,
        sourceDurationSeconds,
        durationSeconds: sourceRange.durationMs / 1_000,
      } satisfies PreparedSequenceAudioTrack;
    }),
  );

  const timelineClips: StageFrameTimelineClip[] = resolvedClips.map((entry) => ({
    clip: entry.clip,
    clipDurationSeconds: entry.clipDurationSeconds,
    sourceWidth: entry.sourceWidth,
    sourceHeight: entry.sourceHeight,
    sourceDurationSeconds: entry.sourceDurationSeconds,
  }));
  const preparedClipsForDuration: PreparedSequenceVisualClip[] = resolvedClips.map((entry, index) => ({
    clip: entry.clip,
    inputIndex: index + 1,
    inputName: '',
    sourceUrl: entry.clip.assetUrl ?? '',
    clipDurationSeconds: entry.clipDurationSeconds,
  }));
  const timelineDurationSeconds = resolveSequenceTimelineDurationSeconds(preparedClipsForDuration, preparedAudioTracks);
  if (!supportsStageFrameExportDuration(timelineDurationSeconds)) {
    return null;
  }
  const loudnessPlan = await resolveSequenceLoudnessNormalizationPlan({
    settings: loudnessNormalization,
    preparedAudioTracks,
    timelineDurationSeconds,
    providerSettings,
    nativeBackend: target.backend,
    audioMixerBuses,
  });

  const directVideoPlan = resolvedClips.length === 1
    ? buildDirectNativeVideoRenderPlan({
      clip: resolvedClips[0].clip,
      visualClipCount: resolvedClips.length,
      enabledAudioTrackCount: preparedAudioTracks.length,
      stageObjectCount: stageObjects.length,
      sourceWidth: resolvedClips[0].sourceWidth,
      sourceHeight: resolvedClips[0].sourceHeight,
      sourceDurationSeconds: resolvedClips[0].sourceDurationSeconds,
      clipDurationSeconds: resolvedClips[0].clipDurationSeconds,
      canvas,
      timelineDurationSeconds,
      frameRate,
      backend: target.backend,
      exportPreset,
    })
    : null;

  if (directVideoPlan) {
    const blob = await renderViaLocalNativeFFmpeg({
      providerSettings,
      outputName: directVideoPlan.outputName,
      command: directVideoPlan.command,
      inputs: [{
        name: directVideoPlan.inputName,
        url: resolvedClips[0].clip.assetUrl,
        filePath: resolvedClips[0].clip.nativeFilePath,
      }],
    });

    if (blob) {
      return {
        blob,
        mimeType: exportPreset.mimeType,
        extension: exportPreset.extension,
        fileName: directVideoPlan.outputName,
        renderBackend: target.backend,
      };
    }
  }

  const frameTimestamps = computeStageFrameTimestamps(timelineDurationSeconds, frameRate);

  const stageCanvas = document.createElement('canvas');
  stageCanvas.width = canvas.width;
  stageCanvas.height = canvas.height;
  const ctx = stageCanvas.getContext('2d', { alpha: true, willReadFrequently: true });

  if (!ctx) {
    throw new Error('The frame-server export needs a 2D canvas context, which this environment does not provide.');
  }

  const mediaPool = createStageFrameMediaPool();

  try {
    const frameGenerator = (async function* generateFrames(): AsyncGenerator<Uint8Array> {
      for (const timeSeconds of frameTimestamps) {
        await paintStageFrame(ctx, canvas, {
          timelineClips,
          stageObjects,
          timeSeconds,
          mediaPool,
        });
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        yield new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
      }
    })();

    const audioInputs = await Promise.all(
      preparedAudioTracks.map((track) => fetchAsStreamAudioInput(track.inputName, track.sourceUrl)),
    );
    const { middleArgs } = buildStageFrameStreamMiddleArgs({
      backend: target.backend,
      exportPreset,
      preparedAudioTracks,
      timelineDurationSeconds,
      audioMixerBuses,
      loudnessRenderFilter: loudnessPlan?.renderFilter,
    });

    const metadata: StageFrameStreamMetadata = {
      width: canvas.width,
      height: canvas.height,
      fps: frameRate,
      frameCount: frameTimestamps.length,
      outputName: `sequence-output.${exportPreset.extension}`,
      backend: target.backend,
      commandPrefix: [...getNativeSequenceCommandPrefix(target.backend), ...getNativeRenderThreadArgs()],
      middleArgs,
      audioInputs,
    };

    const blob = await renderStageFrameStream(providerSettings, metadata, frameGenerator);

    if (!blob) {
      return null;
    }

    return {
      blob,
      mimeType: exportPreset.mimeType,
      extension: exportPreset.extension,
      fileName: `sequence-output.${exportPreset.extension}`,
      renderBackend: target.backend,
    };
  } finally {
    mediaPool.dispose();
  }
}

/** Internal command seam shared with focused native-wrapper regression coverage. */
export function buildStageFrameStreamMiddleArgs({
  backend,
  exportPreset,
  preparedAudioTracks,
  timelineDurationSeconds,
  audioMixerBuses,
  loudnessRenderFilter,
}: {
  backend: NativeRenderExecutionBackend;
  exportPreset: ReturnType<typeof resolveVideoExportPreset>;
  preparedAudioTracks: PreparedSequenceAudioTrack[];
  timelineDurationSeconds: number;
  audioMixerBuses?: ComposeSequenceMediaOptions['audioMixerBuses'];
  loudnessRenderFilter?: string;
}): { middleArgs: string[] } {
  const audioGraph = buildSequenceAudioMixFilterGraph({
    preparedAudioTracks,
    inputIndexOffset: 1, // input 0 is the rawvideo pipe; audio inputs follow it
    timelineDurationSeconds,
    audioMixerBuses,
  });
  const filterParts = [...audioGraph.filterParts];

  const nativeAudioCodecArgs = exportPreset.nativeMapping?.[backend]?.audioCodecArgs;
  const audioCodecArgs = nativeAudioCodecArgs ?? ['-c:a', 'aac'];
  let finalAudioLabel = audioGraph.outputLabel;
  if (finalAudioLabel && loudnessRenderFilter) {
    finalAudioLabel = 'aout_loudnorm';
    filterParts.push(`[${audioGraph.outputLabel}]${loudnessRenderFilter}[${finalAudioLabel}]`);
  }
  const shouldMapAudio = Boolean(finalAudioLabel) && audioCodecArgs.length > 0;

  const middleArgs: string[] = [];

  if (filterParts.length > 0) {
    middleArgs.push('-filter_complex', filterParts.join(';'));
  }

  // The compositor already produced the final RGBA pixels — video needs a pix_fmt conversion for
  // the encoder, not a `-filter_complex` (there is only one video stream; no compositing left to
  // do). This mirrors `nativeRenderSupport.ts`'s `getNativeSequenceOutputFilter`'s two branches in
  // spirit, expressed as a plain `-vf` because that function's `[label]...[vout]` shape is for a
  // multi-stream `-filter_complex`, which no longer applies here.
  middleArgs.push('-vf', getNativeSequencePixelFormatFilter(backend, exportPreset));
  middleArgs.push('-map', '0:v:0');
  middleArgs.push(...(shouldMapAudio ? ['-map', `[${finalAudioLabel}]`] : ['-an']));
  middleArgs.push(...getNativeSequenceEncoderArgs(backend, exportPreset));

  if (shouldMapAudio) {
    middleArgs.push(...audioCodecArgs);
  }

  if (exportPreset.containerArgs?.length) {
    middleArgs.push(...exportPreset.containerArgs);
  }

  return { middleArgs };
}

async function resolveVisualClipMedia(
  clip: ComposeSequenceVisualClip,
  resolveMediaDuration: MediaDurationLoader,
): Promise<ResolvedVisualClip> {
  const clipDurationSeconds = await resolveSequenceVisualClipDuration(clip, resolveMediaDuration);

  if (clip.runtimeRole === 'adjustment') {
    // Adjustment passes own no source pixels. Their filter is applied to the accumulated canvas
    // at the deterministic timeline point below.
    return { clip, clipDurationSeconds, sourceWidth: 1, sourceHeight: 1, sourceDurationSeconds: 0, isAnimatedGif: false };
  }

  if (clip.sourceKind === 'text') {
    const dims = await resolveStageFrameTextClipDimensions(clip);
    return { clip, clipDurationSeconds, sourceWidth: dims.width, sourceHeight: dims.height, sourceDurationSeconds: 0, isAnimatedGif: false };
  }

  if (clip.sourceKind === 'shape') {
    // Matches `renderShapeCard`'s fixed 1280x720 card and the DOM preview's
    // `getStageClipSourceDimensions` shape fallback.
    return { clip, clipDurationSeconds, sourceWidth: 1280, sourceHeight: 720, sourceDurationSeconds: 0, isAnimatedGif: false };
  }

  if (clip.sourceKind === 'comic') {
    // Matches the DOM preview's `getStageClipSourceDimensions` DEFAULT branch (comic isn't
    // special-cased there) — both this and the card's actual 1280x720 are 16:9, so the fitted box
    // comes out identical either way (see stageFrameCompositor.ts's module doc).
    return { clip, clipDurationSeconds, sourceWidth: 1920, sourceHeight: 1080, sourceDurationSeconds: 0, isAnimatedGif: false };
  }

  if (!clip.assetUrl) {
    return { clip, clipDurationSeconds, sourceWidth: 1920, sourceHeight: 1080, sourceDurationSeconds: 0, isAnimatedGif: false };
  }

  if (clip.sourceKind === 'image') {
    const isAnimatedGif = await detectAnimatedGifClip(clip);
    const dims = await probeImageDimensions(clip.assetUrl);
    return { clip, clipDurationSeconds, sourceWidth: dims.width, sourceHeight: dims.height, sourceDurationSeconds: 0, isAnimatedGif };
  }

  const [dims, sourceDurationSeconds] = await Promise.all([
    probeVideoDimensions(clip.assetUrl),
    resolveMediaDuration(clip.assetUrl, 'video'),
  ]);

  return { clip, clipDurationSeconds, sourceWidth: dims.width, sourceHeight: dims.height, sourceDurationSeconds, isAnimatedGif: false };
}

/** Native frame-export text pre-layout is an explicitly registered boundary. Keeping readiness in
 * this helper (as well as the whole-export preflight) prevents future direct callers from measuring
 * an exact face before its audited bytes and runtime alias are available. */
export async function resolveStageFrameTextClipDimensions(
  clip: ComposeSequenceVisualClip,
): Promise<{ width: number; height: number }> {
  await ensureBundledFontDependenciesReady(collectVideoBundledFontDependencies({ visualClips: [clip] }));
  return resolveTextSourceDimensions({
    text: clip.textContent ?? clip.text ?? 'Text',
    fontSizePx: clip.textSizePx || 64,
    effect: clip.textEffect,
    fontFamily: clip.textFontFamily,
    typography: clip.textTypography,
  });
}

function probeImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth || 1920, height: image.naturalHeight || 1080 });
      image.removeAttribute('src');
    };
    image.onerror = () => resolve({ width: 1920, height: 1080 });
    image.src = url;
  });
}

function probeVideoDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
    };

    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth || 1920, height: video.videoHeight || 1080 });
      cleanup();
    };
    video.onerror = () => {
      resolve({ width: 1920, height: 1080 });
      cleanup();
    };
    video.src = url;
  });
}

/** Caches decoded/rendered per-clip content across frames so static content (images, text/shape/
 *  comic cards' non-tail portions, decoded GIF frame sets) is only fetched/decoded/rasterized ONCE,
 *  and keeps one live, seekable `<video>` element per video/composition clip. */
interface StageFrameMediaPool {
  getImage(url: string): Promise<HTMLImageElement>;
  getVideo(clip: ComposeSequenceVisualClip, targetSeconds: number): Promise<HTMLVideoElement>;
  getGif(url: string): Promise<GifDecodeResult>;
  dispose(): void;
}

function createStageFrameMediaPool(): StageFrameMediaPool {
  const images = new Map<string, Promise<HTMLImageElement>>();
  const videos = new Map<string, HTMLVideoElement>();
  const gifs = new Map<string, Promise<GifDecodeResult>>();

  return {
    getImage(url) {
      let pending = images.get(url);

      if (!pending) {
        pending = new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(`Failed to load image asset for export: ${url}`));
          image.src = url;
        });
        images.set(url, pending);
      }

      return pending;
    },

    async getVideo(clip, targetSeconds) {
      const key = clip.id ?? `${clip.sourceNodeId}:${clip.startMs}`;
      let video = videos.get(key);

      if (!video) {
        video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.src = clip.assetUrl ?? '';
        videos.set(key, video);
        await waitForVideoEvent(video, 'loadedmetadata');
      }

      await seekVideoElement(video, targetSeconds);
      return video;
    },

    getGif(url) {
      let pending = gifs.get(url);

      if (!pending) {
        pending = fetch(url).then((response) => response.blob()).then((blob) => decodeGifFrames(blob));
        gifs.set(url, pending);
      }

      return pending;
    },

    dispose() {
      for (const video of videos.values()) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      videos.clear();
      images.clear();
      gifs.clear();
    },
  };
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadedmetadata'): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handleSuccess = () => {
      video.removeEventListener('error', handleError);
      resolve();
    };
    const handleError = () => {
      video.removeEventListener(eventName, handleSuccess);
      reject(video.error ?? new Error(`Video export sampling failed while waiting for ${eventName}.`));
    };

    video.addEventListener(eventName, handleSuccess, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
}

/** Seeks a video element to `targetSeconds` and awaits the browser's `seeked` event — the
 *  frame-accurate (not frame-exact; see this module's doc comment) sampling the task calls for.
 *  Registers listeners BEFORE assigning `currentTime` to avoid the race where the seek resolves
 *  before the listener attaches (same pattern as `videoFrameExtraction.ts`'s `seekVideoToTime`). */
function seekVideoElement(video: HTMLVideoElement, targetSeconds: number): Promise<void> {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const boundedTime = Math.max(0, duration > 0 ? Math.min(duration, targetSeconds) : targetSeconds);

  if (Math.abs(video.currentTime - boundedTime) < 0.001) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('error', handleError);
    };
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(video.error ?? new Error('Video export sampling failed while seeking.'));
    };

    video.addEventListener('seeked', handleSeeked, { once: true });
    video.addEventListener('error', handleError, { once: true });
    video.currentTime = boundedTime;
  });
}

async function paintStageFrame(
  ctx: CanvasRenderingContext2D,
  canvas: StageFrameCanvasSize,
  {
    timelineClips,
    stageObjects,
    timeSeconds,
    mediaPool,
  }: {
    timelineClips: StageFrameTimelineClip[];
    stageObjects: EditorStageObject[];
    timeSeconds: number;
    mediaPool: StageFrameMediaPool;
  },
): Promise<void> {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  const activeClips = resolveActiveStageFrameClips(timelineClips, timeSeconds);

  for (const activeClip of activeClips) {
    if (activeClip.clip.runtimeRole === 'adjustment') {
      applyStageFrameAdjustmentLayer(ctx, activeClip.clip);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop -- frames must paint in stage z-order, sequentially
    await paintActiveClip(ctx, canvas, activeClip, mediaPool);
  }

  for (const object of stageObjects) {
    paintStageObject(ctx, object);
  }
}

/** Applies a retained adjustment layer to the already composited lower-track canvas. */
export function applyStageFrameAdjustmentLayer(
  ctx: CanvasRenderingContext2D,
  clip: ComposeSequenceVisualClip,
): void {
  const descriptor = buildClipEffectDescriptor({
    cropLeftPercent: 0,
    cropRightPercent: 0,
    cropTopPercent: 0,
    cropBottomPercent: 0,
    cropPanXPercent: 0,
    cropPanYPercent: 0,
    cropRotationDeg: 0,
    filterStack: clip.filterStack ?? [],
    blendMode: 'normal',
    chromaKey: { enabled: false, color: '#000000', similarityPercent: 0, blendPercent: 0 },
    stroke: { enabled: false, color: '#000000', widthPx: 0, opacityPercent: 0 },
  });
  if (!descriptor.cssFilter) return;

  const snapshot = document.createElement('canvas');
  snapshot.width = ctx.canvas.width;
  snapshot.height = ctx.canvas.height;
  const snapshotContext = snapshot.getContext('2d');
  if (!snapshotContext) {
    throw new Error('Adjustment-layer export could not allocate its bounded compositing snapshot.');
  }
  snapshotContext.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.filter = descriptor.cssFilter;
  ctx.drawImage(snapshot, 0, 0);
  ctx.restore();
}

async function paintActiveClip(
  ctx: CanvasRenderingContext2D,
  canvas: StageFrameCanvasSize,
  activeClip: ActiveStageFrameClip,
  mediaPool: StageFrameMediaPool,
): Promise<void> {
  const plan = computeStageFrameDrawPlan(activeClip, canvas);
  const { clip } = activeClip;

  if (clip.sourceKind === 'text') {
    const cardUrl = await renderTextCard({
      text: clip.textContent ?? clip.text ?? '',
      fontFamily: clip.textFontFamily,
      fontSizePx: clip.textSizePx,
      color: clip.textColor,
      effect: clip.textEffect,
      opacityPercent: 100,
      typography: clip.textTypography,
    });
    const image = await mediaPool.getImage(cardUrl);
    paintPlannedClip(ctx, plan, (context) => {
      context.save();
      context.globalAlpha *= 1;
      context.filter = plan.effect.cssFilter || 'none';
      context.drawImage(image, -plan.layout.width / 2, -plan.layout.height / 2, plan.layout.width, plan.layout.height);
      context.restore();
    });
    return;
  }

  if (clip.sourceKind === 'shape') {
    const cardUrl = await renderShapeCard({
      fillColor: clip.shapeFillColor ?? '#0ea5e9',
      borderColor: clip.shapeBorderColor ?? '#f8fafc',
      borderWidth: clip.shapeBorderWidth ?? 2,
      cornerRadius: clip.shapeCornerRadius ?? 18,
      opacityPercent: clip.opacityPercent,
    });
    const image = await mediaPool.getImage(cardUrl);
    paintPlannedClip(ctx, plan, (context) => {
      context.drawImage(image, -plan.layout.width / 2, -plan.layout.height / 2, plan.layout.width, plan.layout.height);
    });
    return;
  }

  if (clip.sourceKind === 'comic') {
    // Sampled per frame (not baked to the clip's static start pose like the legacy ffmpeg export —
    // see docs/notes/830's "KNOWN LIMITATION" and "to lift it later" note) so a keyframed tail
    // animates in this export exactly like it does live on the stage. The frame-server engine
    // renders every frame from scratch already, which is exactly the mechanism 830 says the
    // limitation needs — see `resolveComicTailSample`'s doc comment in stageFrameCompositor.ts.
    const tailSample = resolveComicTailSample(clip, activeClip.progressPercent);
    const cardUrl = await renderComicCard(clip, tailSample);
    const image = await mediaPool.getImage(cardUrl);
    paintPlannedClip(ctx, plan, (context) => {
      context.drawImage(image, -plan.layout.width / 2, -plan.layout.height / 2, plan.layout.width, plan.layout.height);
    });
    return;
  }

  if (!clip.assetUrl) {
    return;
  }

  const source = await resolveClipBitmapSource(clip, activeClip, mediaPool);

  if (!source) {
    return;
  }

  paintPlannedClip(ctx, plan, (context) => {
    paintCroppedBitmap(context, plan.layout, source, plan.effect.cssFilter);

    if (plan.effect.cssOutline) {
      paintCropFrameOutline(context, plan.layout, plan.effect.cssOutline);
    }
  });
}

async function resolveClipBitmapSource(
  clip: ComposeSequenceVisualClip,
  activeClip: ActiveStageFrameClip,
  mediaPool: StageFrameMediaPool,
): Promise<CanvasImageSource | null> {
  if (!clip.assetUrl) {
    return null;
  }

  const isGif = clip.sourceKind === 'image' && isGifAssetReference(clip.assetUrl, clip.mimeType);

  if (isGif) {
    const decoded = await mediaPool.getGif(clip.assetUrl);

    if (decoded.frames.length === 0) {
      return null;
    }

    const frameIndex = selectGifFrameIndexAtTime(decoded.frames, Math.max(0, activeClip.localTimeSeconds) * 1000);
    const frame = decoded.frames[frameIndex];
    return frameToBitmapSource(frame.bitmap, decoded.width, decoded.height);
  }

  if (clip.sourceKind === 'image') {
    const source = await mediaPool.getImage(clip.assetUrl);
    return applyChromaKeyIfNeeded(clip, source, source.naturalWidth, source.naturalHeight);
  }

  // `resolveStageSourceTimeSeconds` internally calls `resolveVisualClipSourceRangeMs` against the
  // REAL source duration to resolve trim in/out — it must be the actual probed media length
  // (`activeClip.sourceDurationSeconds`, resolved once up front in `resolveVisualClipMedia`), not a
  // placeholder, or a clip trimmed relative to "end of source" would seek to the wrong point.
  const targetSeconds = resolveStageSourceTimeSeconds(clip, activeClip.sourceDurationSeconds, activeClip.localTimeSeconds);
  const video = await mediaPool.getVideo(clip, targetSeconds);
  return applyChromaKeyIfNeeded(clip, video, video.videoWidth, video.videoHeight);
}

async function applyChromaKeyIfNeeded(
  clip: ComposeSequenceVisualClip,
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<CanvasImageSource> {
  if (!clip.chromaKey?.enabled || width === 0 || height === 0) {
    return source;
  }

  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });

  if (!scratchCtx) {
    return source;
  }

  scratchCtx.drawImage(source, 0, 0, width, height);
  const imageData = scratchCtx.getImageData(0, 0, width, height);
  applyChromaKeyToImageData(imageData, clip.chromaKey);
  scratchCtx.putImageData(imageData, 0, 0);
  return scratch;
}

function frameToBitmapSource(bitmap: ImageBitmap | ImageData, width: number, height: number): CanvasImageSource {
  if (typeof ImageData !== 'undefined' && bitmap instanceof ImageData) {
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const scratchCtx = scratch.getContext('2d');
    scratchCtx?.putImageData(bitmap, 0, 0);
    return scratch;
  }

  return bitmap as ImageBitmap;
}

function paintStageObject(ctx: CanvasRenderingContext2D, object: EditorStageObject): void {
  const plan = computeStageObjectDrawPlan(object);

  ctx.save();
  ctx.globalAlpha = plan.alpha;
  ctx.globalCompositeOperation = plan.compositeOperation;
  ctx.translate(plan.centerX, plan.centerY);
  ctx.rotate((plan.layout.rotationDeg * Math.PI) / 180);

  if (object.kind === 'text') {
    drawTextStageObject(ctx, object);
  } else if (object.kind === 'rectangle') {
    drawRectangleStageObject(ctx, object);
  } else {
    drawComicStageObject(ctx, object);
  }

  ctx.restore();
}
