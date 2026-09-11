import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { strToU8, zipSync } from 'fflate';
import type {
  AspectRatio,
  EditorClipChromaKeySettings,
  EditorClipFilter,
  EditorClipStrokeSettings,
  EditorAudioKeyframe,
  EditorAudioDuckingSettings,
  EditorAudioProcessingSettings,
  EditorStageBlendMode,
  EditorStageObject,
  EditorTextTypography,
  EditorVisualKeyframe,
  EditorVisualSourceKind,
  ProviderSettings,
  TimelineAutomationPoint,
  VideoResolution,
} from '../types/flow';
import { buildAutomationExpression } from './clipAutomation';
import { formatFontFamily } from './formatFontFamily';
import { bundledFontFaceRuntimeFamilyName, bundledFontFaceStyleDescriptor, ensureBundledFontDependenciesReady } from './bundledFontLibrary';
import { managedBundledFontDependenciesForState } from './managedBundledFonts';
import type { ManagedBundledFontFaceReference } from '../types/managedFont';
import type {
  EditorVisualClipProfessionalState,
  ProfessionalAudioBus,
  ProfessionalNumericParameterTrack,
} from '../types/videoProfessional';
import { compileVideoParamKeyframeTrackForFfmpeg, videoParamTrackFromProfessional } from './videoParamKeyframes';
import {
  audioKeyframesToVolumeAutomation,
  normalizeVisualKeyframes,
  visualKeyframesToOpacityAutomation,
} from './editorKeyframes';
import { buildClipEffectDescriptor, mapClipBlendModeToFFmpeg } from './editorClipEffects';
import { buildShapeLayoutDescriptor } from './editorVisualLayout';
import { resolveVisualClipSourceRangeMs } from './editorTimelineSourceRange';
import { resolveEditorAudioSourceRangeMs } from './editorAudioSourceRange';
import { buildEditorAudioPostMixFilters, buildEditorAudioPreMixFilters } from './editorAudioProcessing';
import { buildEditorAudioDuckingGraph } from './editorAudioDucking';
import { createMediaDurationResolver, type MediaDurationLoader } from './mediaDurationCache';
import { probeGifAnimation } from './gifFrames';
import { isGifAssetReference } from './mediaFormatRegistry';
import {
  analyzeLoudnessViaLocalNativeFFmpeg,
  renderViaLocalNativeFFmpeg,
  renderViaLocalNativeFFmpegToFile,
  renderViaLocalNativeFFmpegWithArtifacts,
  resolveNativeRenderTarget,
  type NativeRenderAssemblyManifest,
  type NativeRenderAssemblyResult,
  type NativeRenderSegmentArtifact,
} from './localNativeRender';
import {
  buildVideoLoudnessNormalizationPlan,
  parseVideoLoudnormAnalysisOutput,
  type VideoLoudnessNormalizationPlan,
} from './videoAudioMixer';
import {
  getNativeRenderThreadArgs,
  getNativeSequenceCommandPrefix,
  getNativeSequenceEncoderArgs,
  getNativeSequenceOutputFilter,
  type NativeRenderExecutionBackend,
} from './nativeRenderSupport';
import { getVideoCanvasDimensions } from './videoCanvas';
import {
  getVideoExportPresetAvailability,
  getVideoExportPresetFrameRateAvailability,
  resolveVideoExportPreset,
  type VideoExportPresetOption,
  type VideoExportExecutionTarget,
} from './videoPremiereParity';
import {
  COMIC_TAIL_DEFAULT_CURVE_PERCENT,
  COMIC_TAIL_DEFAULT_TIP_X_PERCENT,
  COMIC_TAIL_DEFAULT_TIP_Y_PERCENT,
  comicPolarTailToTipPercent,
  comicTailQuadraticPoint,
  resolveComicTailGeometry,
} from './videoComicTail';
import {
  computeArcTextGlyphs,
  layoutVideoText,
  resolveVideoCanvasFontStretch,
  type VideoTextLayoutResult,
} from './videoTextFlow';
import { getVideoTextCanvasMeasurer, resolveVideoTextCardLayout } from './videoTextCardLayout';
import { isLongFormSequence } from './videoLongFormTimeline';
import type { VideoCaptionEmbeddingPlan } from './videoCaptionEmbedding';
import {
  buildVideoAudioMixerFfmpegGraph,
  createVideoAudioMixerRoutingModel,
} from './videoAudioMixer';

interface CompositionCommandTrack {
  inputName: string;
  delayMs: number;
  volumePercent: number;
  enabled: boolean;
}

interface BuildCompositionCommandOptions {
  videoInputName: string;
  audioTracks: CompositionCommandTrack[];
  outputName: string;
  useVideoAudio?: boolean;
  videoAudioVolumePercent?: number;
}

interface ComposeAudioTrack {
  url: string;
  delayMs: number;
  volumePercent: number;
  enabled: boolean;
}

interface ComposeMediaOptions {
  videoUrl: string;
  audioTracks: ComposeAudioTrack[];
  useVideoAudio?: boolean;
  videoAudioVolumePercent?: number;
  providerSettings?: ProviderSettings;
}

export interface ComposeSequenceVisualClip {
  id?: string;
  /** Set only by Video Runtime IR. Adjustment clips transform the accumulated lower composite. */
  runtimeRole?: 'media' | 'adjustment';
  sourceNodeId: string;
  sourceKind: EditorVisualSourceKind;
  trackIndex: number;
  startMs: number;
  aspectRatio?: AspectRatio;
  assetUrl?: string;
  /** Authorized desktop backing path used by native FFmpeg without materializing source bytes. */
  nativeFilePath?: string;
  text?: string;
  /** Source asset MIME type (e.g. `image/gif`) -- used to detect an animated GIF image clip so
   *  the FFmpeg export can loop it instead of freezing it to its first frame. */
  mimeType?: string;
  sourceInMs?: number;
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
  cropLeftPercent?: number;
  cropRightPercent?: number;
  cropTopPercent?: number;
  cropBottomPercent?: number;
  cropPanXPercent?: number;
  cropPanYPercent?: number;
  cropRotationDeg?: number;
  filterStack?: EditorClipFilter[];
  blendMode?: EditorStageBlendMode;
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
  professional?: EditorVisualClipProfessionalState;
}

export interface ComposeSequenceAudioTrack {
  /** Stable timeline identity used by the persisted mixer route. Legacy callers may omit it. */
  id?: string;
  url: string;
  /** Authorized desktop backing path used by native FFmpeg without materializing source bytes. */
  nativeFilePath?: string;
  sourceNodeId: string;
  sourceKind: 'audio' | 'video' | 'composition';
  mimeType?: string;
  offsetMs: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  trackIndex: number;
  trackVolumePercent?: number;
  volumePercent: number;
  volumeAutomationPoints?: TimelineAutomationPoint[];
  volumeKeyframes?: EditorAudioKeyframe[];
  measuredMatchGainDb?: number;
  loudnessReferenceClipId?: string;
  audioProcessing?: EditorAudioProcessingSettings;
  /** Persisted native side-chain configuration for this timeline leg. */
  audioDucking?: EditorAudioDuckingSettings;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  enabled: boolean;
  professional?: {
    pan?: number;
    busId?: string;
    parameterKeyframes?: ProfessionalNumericParameterTrack[];
  };
}

export interface ComposeSequenceMediaOptions {
  visualClips: ComposeSequenceVisualClip[];
  audioTracks: ComposeSequenceAudioTrack[];
  stageObjects?: EditorStageObject[];
  aspectRatio?: AspectRatio;
  videoResolution?: VideoResolution;
  frameRate?: number;
  exportPresetId?: string;
  providerSettings?: ProviderSettings;
  nativeAssemblyManifest?: NativeRenderAssemblyManifest;
  /** Desktop project scratch directory used for zero-copy feature-length render output. */
  nativeOutputDirectoryPath?: string;
  /** Persisted bounded main-output bus records. Undefined preserves legacy mixing. */
  audioMixerBuses?: ProfessionalAudioBus[];
  /** Explicit persisted delivery intent. Undefined/disabled leaves existing output unchanged. */
  loudnessNormalization?: SequenceLoudnessNormalizationSettings;
  /** A validated, one-track SRT → MP4/MOV mov_text delivery input. */
  captionEmbedding?: VideoCaptionEmbeddingPlan;
}

export interface SequenceLoudnessNormalizationSettings {
  targetLufs: number;
  loudnessRangeLu: number;
  truePeakCeilingDbtp: number;
}

export interface SequenceImageManifest {
  version: 1;
  presetId: string;
  presetLabel: string;
  frameMimeType: string;
  frameExtension: string;
  frameRate: number;
  width: number;
  height: number;
  durationSeconds: number;
  frameCount: number;
  frames: string[];
}

export interface ComposeSequenceMediaResult {
  blob?: Blob;
  nativeFilePath?: string;
  mimeType: string;
  extension: string;
  fileName: string;
  renderBackend: NativeRenderExecutionBackend | 'browser';
  imageSequence?: boolean;
  frameCount?: number;
  manifest?: SequenceImageManifest;
  segmentArtifacts?: NativeRenderSegmentArtifact[];
  assemblyResult?: NativeRenderAssemblyResult;
}

export interface SequenceCanvas {
  width: number;
  height: number;
}

export interface PreparedSequenceVisualClip {
  clip: ComposeSequenceVisualClip;
  inputIndex: number;
  inputName: string;
  sourceUrl: string;
  sourceFilePath?: string;
  clipDurationSeconds: number;
  /** True when this is an `image` clip whose source is a real, multi-frame (animated) GIF --
   *  set by `prepareVisualClipInput`'s `detectAnimatedGifClip` probe. Undefined/false for every
   *  other clip, including static/non-animated GIFs, which keep the existing `-loop 1` behavior. */
  isAnimatedGif?: boolean;
  /** Adjustment passes deliberately own no source input or source bytes. */
  isRuntimeAdjustment?: boolean;
}

export interface PreparedSequenceAudioTrack {
  track: ComposeSequenceAudioTrack;
  inputName: string;
  sourceUrl: string;
  sourceFilePath?: string;
  sourceDurationSeconds?: number;
  /** Effective duration after applying the source range. */
  durationSeconds: number;
}

interface PreparedSequenceStageObject {
  object: EditorStageObject;
  inputIndex: number;
  inputName: string;
  sourceUrl: string;
}

let ffmpegPromise: Promise<FFmpeg> | undefined;
let browserFfmpegOperationSequence = 0;
const DEFAULT_SEQUENCE_FRAME_RATE = 30;
const MIN_SEQUENCE_VISUAL_SCALE_FACTOR = 0.1;

export function buildCompositionCommand({
  videoInputName,
  audioTracks,
  outputName,
  useVideoAudio = false,
  videoAudioVolumePercent = 100,
}: BuildCompositionCommandOptions): string[] {
  const enabledTracks = audioTracks.filter((track) => track.enabled);
  const videoAudioVolume = Math.max(0, videoAudioVolumePercent) / 100;

  if (enabledTracks.length === 0) {
    if (useVideoAudio) {
      if (videoAudioVolumePercent === 100) {
        return [
          '-y',
          '-i',
          videoInputName,
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-c:v',
          'copy',
          '-c:a',
          'copy',
          outputName,
        ];
      }

      return [
        '-y',
        '-i',
        videoInputName,
        '-filter_complex',
        `[0:a]volume=${videoAudioVolume.toFixed(2)}[aout]`,
        '-map',
        '0:v:0',
        '-map',
        '[aout]',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        outputName,
      ];
    }

    return [
      '-y',
      '-i',
      videoInputName,
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      '-an',
      outputName,
    ];
  }

  const args = ['-y', '-i', videoInputName];

  for (const track of enabledTracks) {
    args.push('-i', track.inputName);
  }

  const filterParts: string[] = [];
  const mixInputs: string[] = [];

  if (useVideoAudio) {
    filterParts.push(`[0:a]volume=${videoAudioVolume.toFixed(2)}[va0]`);
    mixInputs.push('[va0]');
  }

  enabledTracks.forEach((track, index) => {
    const inputIndex = index + 1;
    const label = `a${index}`;
    const volume = Math.max(0, track.volumePercent) / 100;
    filterParts.push(`[${inputIndex}:a]adelay=${track.delayMs}|${track.delayMs},volume=${volume.toFixed(2)}[${label}]`);
    mixInputs.push(`[${label}]`);
  });

  const filterComplex = `${filterParts.join(';')};${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest[aout]`;

  args.push(
    '-filter_complex',
    filterComplex,
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    outputName,
  );

  return args;
}

export async function composeMedia({
  videoUrl,
  audioTracks,
  useVideoAudio = false,
  videoAudioVolumePercent = 100,
  providerSettings,
}: ComposeMediaOptions): Promise<Blob> {
  const videoInputName = 'composition-input-video.mp4';
  const outputName = 'composition-output.mp4';
  const enabledTracks = audioTracks.filter((track) => track.enabled);

  const compositionTracks: CompositionCommandTrack[] = [];
  const nativeInputs: Array<{ name: string; url: string }> = [
    {
      name: videoInputName,
      url: videoUrl,
    },
  ];

  for (const [index, track] of enabledTracks.entries()) {
    const audioInputName = `composition-audio-${index + 1}.mp3`;
    compositionTracks.push({
      inputName: audioInputName,
      delayMs: track.delayMs,
      volumePercent: track.volumePercent,
      enabled: true,
    });
    nativeInputs.push({
      name: audioInputName,
      url: track.url,
    });
  }

  const baseCommand = buildCompositionCommand({
    videoInputName,
    audioTracks: compositionTracks,
    outputName,
    useVideoAudio,
    videoAudioVolumePercent,
  });
  const nativeCommand = [...getNativeRenderThreadArgs(), ...baseCommand];

  if (providerSettings) {
    const nativeBlob = await renderViaLocalNativeFFmpeg({
      providerSettings,
      outputName,
      command: nativeCommand,
      inputs: nativeInputs,
    });

    if (nativeBlob) {
      return nativeBlob;
    }
  }

  const ffmpeg = await getFFmpeg();
  const browserOperationId = createBrowserFfmpegOperationId();
  const browserVideoInputName = createBrowserFfmpegPath(videoInputName, browserOperationId);
  const browserOutputName = createBrowserFfmpegPath(outputName, browserOperationId);
  const browserTracks = compositionTracks.map((track) => ({
    ...track,
    inputName: createBrowserFfmpegPath(track.inputName, browserOperationId),
  }));
  const browserCommand = buildCompositionCommand({
    videoInputName: browserVideoInputName,
    audioTracks: browserTracks,
    outputName: browserOutputName,
    useVideoAudio,
    videoAudioVolumePercent,
  });

  return withBrowserFfmpegOperation(ffmpeg, async (operation) => {
    await operation.writeFile(browserVideoInputName, await fetchFile(videoUrl));

    for (const [index, track] of enabledTracks.entries()) {
      await operation.writeFile(browserTracks[index].inputName, await fetchFile(track.url));
    }

    try {
      await ffmpeg.exec(browserCommand);
    } catch (error) {
      await operation.trackExistingPaths((path) => path === browserOutputName);
      throw error;
    }
    operation.trackCreatedPath(browserOutputName);
    const output = await ffmpeg.readFile(browserOutputName);
    const bytes = output instanceof Uint8Array ? output : new TextEncoder().encode(String(output));
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);

    return new Blob([blobBytes], { type: 'video/mp4' });
  });
}

export async function composeSequenceMedia({
  visualClips,
  audioTracks,
  stageObjects = [],
  aspectRatio = '16:9',
  videoResolution = '1080p',
  frameRate = DEFAULT_SEQUENCE_FRAME_RATE,
  exportPresetId,
  providerSettings,
  nativeAssemblyManifest,
  nativeOutputDirectoryPath,
  audioMixerBuses,
  loudnessNormalization,
  captionEmbedding,
}: ComposeSequenceMediaOptions): Promise<ComposeSequenceMediaResult> {
  if (visualClips.length === 0 && stageObjects.length === 0) {
    throw new Error('Manual editor compositions need at least one visual clip or stage object.');
  }

  const exportPreset = resolveVideoExportPreset(exportPresetId);
  const outputName = exportPreset.imageSequence
    ? (exportPreset.outputPattern ?? `sequence-frame-%05d.${exportPreset.extension}`)
    : `sequence-output.${exportPreset.extension}`;
  const canvas = getSequenceCanvas(aspectRatio, videoResolution);
  const resolveMediaDuration = createMediaDurationResolver(getMediaDuration);
  const preparedClipDrafts = await Promise.all(
    visualClips.map(async (clip, index) => {
      const preparedInput = await prepareVisualClipInput(clip, index);

      return {
        clip,
        inputIndex: 0,
        inputName: preparedInput.inputName,
        sourceUrl: preparedInput.sourceUrl,
        sourceFilePath: preparedInput.sourceFilePath,
        isAnimatedGif: preparedInput.isAnimatedGif,
        isRuntimeAdjustment: clip.runtimeRole === 'adjustment',
        clipDurationSeconds: await resolveSequenceVisualClipDuration(clip, resolveMediaDuration),
      } satisfies PreparedSequenceVisualClip;
    }),
  );
  let nextVisualInputIndex = 1;
  const preparedClips = preparedClipDrafts.map((clip) => ({
    ...clip,
    inputIndex: clip.isRuntimeAdjustment ? 0 : nextVisualInputIndex++,
  }));
  const preparedMediaClips = preparedClips.filter((clip) => !clip.isRuntimeAdjustment);
  const enabledAudioTracks = exportPreset.imageSequence ? [] : audioTracks.filter((track) => track.enabled);
  const preparedAudioTracks = await Promise.all(
    enabledAudioTracks.map(async (track, index) => {
      const audioInputName = `sequence-audio-${index + 1}.${resolveSequenceAudioExtension(track)}`;
      const sourceDurationSeconds = await resolveMediaDuration(
        track.url,
        track.sourceKind === 'audio' ? 'audio' : 'video',
      );
      const sourceRange = resolveEditorAudioSourceRangeMs(track, sourceDurationSeconds);

      return {
        track,
        inputName: audioInputName,
        sourceUrl: track.url,
        sourceFilePath: track.nativeFilePath,
        sourceDurationSeconds,
        durationSeconds: sourceRange.durationMs / 1_000,
      } satisfies PreparedSequenceAudioTrack;
    }),
  );
  const preparedStageObjects = await Promise.all(
    stageObjects.map(async (object, index) => ({
      object,
      inputIndex: preparedMediaClips.length + index + 1,
      inputName: `sequence-stage-object-${index + 1}.png`,
      sourceUrl: await renderStageObjectImage(object, canvas),
    }) satisfies PreparedSequenceStageObject),
  );
  const timelineDurationSeconds = resolveSequenceTimelineDurationSeconds(preparedClips, preparedAudioTracks);
  const longFormSequence = isLongFormSequence(timelineDurationSeconds);
  let nativeBackend = providerSettings && !exportPreset.imageSequence
    ? (await resolveNativeSequenceBackend(providerSettings))
    : null;
  if (captionEmbedding && nativeBackend !== 'cpu') {
    throw new Error('Embedded mov_text captions require the local Native CPU renderer; browser and AMD VA-API delivery leave caption embedding unavailable.');
  }
  let renderTarget: VideoExportExecutionTarget = nativeBackend === 'cpu'
    ? 'native-cpu'
    : nativeBackend === 'amd-vaapi'
      ? 'native-amd-vaapi'
      : nativeBackend === 'nvidia-nvenc'
        ? 'native-nvidia-nvenc'
        : nativeBackend === 'intel-qsv' ? 'native-intel-qsv' : 'browser';
  let presetAvailability = getVideoExportPresetAvailability(exportPreset, renderTarget);

  // Auto is a policy, not a hardware claim: when the preferred probed encoder cannot represent
  // the selected preset (notably VP9 alpha), fall back to the already-probed native CPU route.
  // Forced targets continue to refuse so the user's explicit choice remains truthful.
  if (!presetAvailability.available
    && providerSettings?.renderBackendPreference === 'auto'
    && nativeBackend !== null
    && nativeBackend !== 'cpu') {
    nativeBackend = 'cpu';
    renderTarget = 'native-cpu';
    presetAvailability = getVideoExportPresetAvailability(exportPreset, renderTarget);
  }

  if (!presetAvailability.available) {
    throw new Error(`${exportPreset.label} is unavailable for ${presetAvailability.label} render. ${presetAvailability.reason ?? exportPreset.caveat}`);
  }

  const frameRateAvailability = getVideoExportPresetFrameRateAvailability(exportPreset, frameRate);
  if (!frameRateAvailability.available) {
    throw new Error(frameRateAvailability.reason);
  }

  const loudnessPlan = await resolveSequenceLoudnessNormalizationPlan({
    settings: loudnessNormalization,
    preparedAudioTracks,
    timelineDurationSeconds,
    providerSettings,
    nativeBackend,
    audioMixerBuses,
  });

  const command = buildSequenceCommand({
    preparedClips,
    preparedAudioTracks,
    preparedStageObjects,
    canvas,
    timelineDurationSeconds,
    frameRate,
    exportPreset,
    outputName,
    nativeBackend,
    audioMixerBuses,
    loudnessRenderFilter: loudnessPlan?.renderFilter,
    captionEmbedding,
  });

  if (providerSettings && nativeBackend) {
    const nativeRenderRequest = {
      providerSettings,
      outputName,
      command,
      inputs: [
        ...preparedMediaClips.map((clip) => ({
          name: clip.inputName,
          url: clip.sourceUrl,
          filePath: clip.sourceFilePath,
        })),
        ...preparedAudioTracks.map((track) => ({
          name: track.inputName,
          url: track.sourceUrl,
          filePath: track.sourceFilePath,
        })),
        ...preparedStageObjects.map((object) => ({
          name: object.inputName,
          url: object.sourceUrl,
        })),
        ...(captionEmbedding ? [{
          name: captionEmbedding.inputName,
          url: textToDataUrl(captionEmbedding.srt, 'application/x-subrip'),
        }] : []),
      ],
      // Cached segments contain video only.  A complete timed-text stream must be muxed against
      // the complete output once, so do not offer a segment-assembly request that could omit it.
      assemblyManifest: captionEmbedding ? undefined : nativeAssemblyManifest,
    };

    if (longFormSequence && nativeOutputDirectoryPath) {
      const nativeFile = await renderViaLocalNativeFFmpegToFile({
        providerSettings,
        outputName,
        outputDirectoryPath: nativeOutputDirectoryPath,
        command,
        inputs: nativeRenderRequest.inputs,
      });

      if (nativeFile) {
        return {
          nativeFilePath: nativeFile.filePath,
          mimeType: exportPreset.mimeType,
          extension: exportPreset.extension,
          fileName: nativeFile.fileName,
          renderBackend: nativeBackend,
        };
      }
    }

    // Segment artifacts contain encoded video spans only; the complete timed-text stream must be
    // muxed once against the completed sequence, never reconstructed from a partial cache.
    if (!captionEmbedding && !longFormSequence && nativeAssemblyManifest) {
      const nativeResult = await renderViaLocalNativeFFmpegWithArtifacts(nativeRenderRequest);

      if (nativeResult) {
        return {
          blob: nativeResult.blob,
          mimeType: exportPreset.mimeType,
          extension: exportPreset.extension,
          fileName: `sequence-output.${exportPreset.extension}`,
          renderBackend: nativeBackend,
          segmentArtifacts: nativeResult.segmentArtifacts,
          ...(nativeResult.assemblyResult ? { assemblyResult: nativeResult.assemblyResult } : {}),
        };
      }
    }

    const nativeBlob = longFormSequence ? null : await renderViaLocalNativeFFmpeg(nativeRenderRequest);

    if (nativeBlob) {
      return {
        blob: nativeBlob,
        mimeType: exportPreset.mimeType,
        extension: exportPreset.extension,
        fileName: `sequence-output.${exportPreset.extension}`,
        renderBackend: nativeBackend,
      };
    }
  }

  if (longFormSequence) {
    throw new Error(
      'Feature-length exports (30 minutes or longer) require the Sloom Studio desktop native renderer. '
      + 'Open or save the project to establish its scratch directory, start the local native render service, '
      + 'and choose Native CPU or AMD VA-API. Browser FFmpeg is disabled for long-form sequences because '
      + 'it must hold source and output media in memory.',
    );
  }

  const ffmpeg = await getFFmpeg();
  const browserOperationId = createBrowserFfmpegOperationId();
  const browserPreparedClips = preparedClips.map((preparedClip) => preparedClip.isRuntimeAdjustment
    ? preparedClip
    : { ...preparedClip, inputName: createBrowserFfmpegPath(preparedClip.inputName, browserOperationId) });
  const browserPreparedAudioTracks = preparedAudioTracks.map((preparedAudioTrack) => ({
    ...preparedAudioTrack,
    inputName: createBrowserFfmpegPath(preparedAudioTrack.inputName, browserOperationId),
  }));
  const browserPreparedStageObjects = preparedStageObjects.map((preparedStageObject) => ({
    ...preparedStageObject,
    inputName: createBrowserFfmpegPath(preparedStageObject.inputName, browserOperationId),
  }));
  const browserOutputName = createBrowserFfmpegPath(outputName, browserOperationId);
  const browserCommand = buildSequenceCommand({
    preparedClips: browserPreparedClips,
    preparedAudioTracks: browserPreparedAudioTracks,
    preparedStageObjects: browserPreparedStageObjects,
    canvas,
    timelineDurationSeconds,
    frameRate,
    exportPreset,
    outputName: browserOutputName,
    nativeBackend: null,
    audioMixerBuses,
    loudnessRenderFilter: loudnessPlan?.renderFilter,
  });

  return withBrowserFfmpegOperation(ffmpeg, async (operation) => {
    for (const preparedClip of browserPreparedClips.filter((clip) => !clip.isRuntimeAdjustment)) {
      await operation.writeFile(preparedClip.inputName, await fetchFile(preparedClip.sourceUrl));
    }

    for (const preparedAudioTrack of browserPreparedAudioTracks) {
      await operation.writeFile(preparedAudioTrack.inputName, await fetchFile(preparedAudioTrack.sourceUrl));
    }

    for (const preparedStageObject of browserPreparedStageObjects) {
      await operation.writeFile(preparedStageObject.inputName, await fetchFile(preparedStageObject.sourceUrl));
    }

    try {
      await ffmpeg.exec(browserCommand);
    } catch (error) {
      const matchesOutputPath: (path: string) => boolean = exportPreset.imageSequence
        ? (path) => buildSequenceOutputMatcher(browserOutputName).test(path)
        : (path: string) => path === browserOutputName;
      await operation.trackExistingPaths(matchesOutputPath);
      throw error;
    }

    if (exportPreset.imageSequence) {
      const frameEntries = await readSequenceFrameEntries(
        ffmpeg,
        exportPreset,
        browserOutputName,
        (path) => operation.trackCreatedPath(path),
        outputName,
      );
      return packageSequenceFramesAsZip({
        frames: frameEntries,
        exportPreset,
        canvas,
        frameRate,
        durationSeconds: timelineDurationSeconds,
      });
    }

    operation.trackCreatedPath(browserOutputName);
    const output = await ffmpeg.readFile(browserOutputName);
    const bytes = output instanceof Uint8Array ? output : new TextEncoder().encode(String(output));
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    return {
      blob: new Blob([blobBytes], { type: exportPreset.mimeType }),
      mimeType: exportPreset.mimeType,
      extension: exportPreset.extension,
      fileName: `sequence-output.${exportPreset.extension}`,
      renderBackend: 'browser',
    };
  });
}

export function packageSequenceFramesAsZip({
  frames,
  exportPreset,
  canvas,
  frameRate,
  durationSeconds,
}: {
  frames: Array<{ name: string; data: Uint8Array }>;
  exportPreset: VideoExportPresetOption;
  canvas: SequenceCanvas;
  frameRate: number;
  durationSeconds: number;
}): ComposeSequenceMediaResult {
  const sortedFrames = [...frames].sort((left, right) => left.name.localeCompare(right.name));
  const manifest: SequenceImageManifest = {
    version: 1,
    presetId: exportPreset.id,
    presetLabel: exportPreset.label,
    frameMimeType: exportPreset.mimeType,
    frameExtension: exportPreset.extension,
    frameRate,
    width: canvas.width,
    height: canvas.height,
    durationSeconds,
    frameCount: sortedFrames.length,
    frames: sortedFrames.map((frame) => frame.name),
  };
  const entries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };

  for (const frame of sortedFrames) {
    const bytes = new Uint8Array(frame.data.byteLength);
    bytes.set(frame.data);
    entries[frame.name] = bytes;
  }

  const zipped = zipSync(entries);

  return {
    blob: new Blob([zipped], { type: 'application/zip' }),
    mimeType: 'application/zip',
    extension: 'zip',
    fileName: `${exportPreset.id}.zip`,
    renderBackend: 'browser',
    imageSequence: true,
    frameCount: sortedFrames.length,
    manifest,
  };
}

export function describeSequenceRenderBackend(
  backend: NativeRenderExecutionBackend | 'browser',
): string {
  if (backend === 'amd-vaapi') {
    return 'AMD VAAPI GPU encode (h264_vaapi)';
  }

  if (backend === 'cpu') {
    return 'native CPU FFmpeg';
  }

  if (backend === 'nvidia-nvenc') {
    return 'NVIDIA NVENC GPU encode (h264_nvenc)';
  }

  if (backend === 'intel-qsv') {
    return 'Intel Quick Sync GPU encode (h264_qsv)';
  }

  return 'browser FFmpeg';
}

export function describeSequenceRenderBackendCaveat(
  backend: NativeRenderExecutionBackend | 'browser',
): string {
  if (backend === 'amd-vaapi') {
    return 'The final encode is GPU accelerated; timeline compositing and filters still run through FFmpeg software filters before VAAPI upload.';
  }

  if (backend === 'cpu') {
    return 'Native CPU FFmpeg handles this render with multithreaded software encoding.';
  }

  if (backend === 'nvidia-nvenc') {
    return 'The final H.264 encode uses NVIDIA NVENC only after the native service proves encoder/device availability; compositing and filters remain software FFmpeg.';
  }

  if (backend === 'intel-qsv') {
    return 'The final H.264 encode uses Intel Quick Sync only after the native service proves encoder/device availability; compositing and filters remain software FFmpeg.';
  }

  return 'Browser FFmpeg handles this render with maximum compatibility.';
}

async function readSequenceFrameEntries(
  ffmpeg: FFmpeg,
  exportPreset: VideoExportPresetOption,
  outputPattern: string,
  onFramePath?: (path: string) => void,
  publicOutputPattern = outputPattern,
): Promise<Array<{ name: string; data: Uint8Array }>> {
  const matcher = buildSequenceOutputMatcher(outputPattern);
  const entries = await ffmpeg.listDir('/');
  const frameNames = entries
    .filter((entry) => !entry.isDir && matcher.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (frameNames.length === 0) {
    throw new Error(`${exportPreset.label} did not produce any frames matching ${outputPattern}.`);
  }

  frameNames.forEach((name) => onFramePath?.(name));

  return Promise.all(frameNames.map(async (name) => {
    const output = await ffmpeg.readFile(name);
    const data = output instanceof Uint8Array ? output : new TextEncoder().encode(String(output));
    return {
      name: mapSequenceFrameNameToPublicName(name, outputPattern, publicOutputPattern),
      data,
    };
  }));
}

function mapSequenceFrameNameToPublicName(
  rawName: string,
  rawOutputPattern: string,
  publicOutputPattern: string,
): string {
  const framePlaceholder = /%0?\d*d/;
  const placeholderMatch = rawOutputPattern.match(framePlaceholder);
  if (!placeholderMatch || placeholderMatch.index === undefined) {
    return rawName;
  }

  const prefix = rawOutputPattern.slice(0, placeholderMatch.index);
  const suffix = rawOutputPattern.slice(placeholderMatch.index + placeholderMatch[0].length);
  const frameNumber = rawName.slice(prefix.length, rawName.length - suffix.length);

  if (!rawName.startsWith(prefix) || !rawName.endsWith(suffix) || !/^\d+$/.test(frameNumber)) {
    throw new Error(`Could not map browser FFmpeg frame ${rawName} to its public sequence name.`);
  }

  return publicOutputPattern.replace(framePlaceholder, frameNumber);
}

function buildSequenceOutputMatcher(outputPattern: string): RegExp {
  const escaped = outputPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/%0?\d*d/, '\\d+');
  return new RegExp(`^${pattern}$`, 'i');
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    const loadingPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm',
      });
      return ffmpeg;
    })();
    ffmpegPromise = loadingPromise;
    void loadingPromise.catch(() => {
      if (ffmpegPromise === loadingPromise) {
        ffmpegPromise = undefined;
      }
    });
  }

  return ffmpegPromise!;
}

/**
 * Owns the files a single browser FFmpeg invocation has actually created. Keeping this small
 * lifecycle wrapper shared between composition routes prevents one failure path from silently
 * retaining MEMFS files while another cleans them up.
 */
class BrowserFfmpegOperation {
  private readonly createdPaths = new Set<string>();
  private readonly ffmpeg: FFmpeg;

  constructor(ffmpeg: FFmpeg) {
    this.ffmpeg = ffmpeg;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.ffmpeg.writeFile(path, data);
    this.trackCreatedPath(path);
  }

  trackCreatedPath(path: string): void {
    this.createdPaths.add(path);
  }

  /**
   * An interrupted FFmpeg execution can still leave partial output behind. List the virtual FS
   * only on that failure path, so we clean files proven present without guessing or deleting a
   * path owned by another invocation.
   */
  async trackExistingPaths(matches: (path: string) => boolean): Promise<void> {
    try {
      const entries = await this.ffmpeg.listDir('/');
      for (const entry of entries) {
        if (!entry.isDir && matches(entry.name)) {
          this.trackCreatedPath(entry.name);
        }
      }
    } catch {
      // The caller already has an execution failure. Do not replace it with a best-effort probe.
    }
  }

  async cleanup(): Promise<void> {
    let cleanupError: unknown;

    for (const path of this.createdPaths) {
      try {
        await this.ffmpeg.deleteFile(path);
      } catch (error) {
        cleanupError ??= error;
      }
    }

    if (cleanupError !== undefined) {
      throw cleanupError;
    }
  }
}

async function withBrowserFfmpegOperation<T>(
  ffmpeg: FFmpeg,
  work: (operation: BrowserFfmpegOperation) => Promise<T>,
): Promise<T> {
  const operation = new BrowserFfmpegOperation(ffmpeg);
  let hasPrimaryError = false;
  let primaryError: unknown;
  let result: T | undefined;

  try {
    result = await work(operation);
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
  }

  try {
    await operation.cleanup();
  } catch (cleanupError) {
    if (!hasPrimaryError) {
      throw cleanupError;
    }
  }

  if (hasPrimaryError) {
    throw primaryError;
  }

  return result as T;
}

function createBrowserFfmpegOperationId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return randomId;
  }

  browserFfmpegOperationSequence += 1;
  return `${Date.now().toString(36)}-${browserFfmpegOperationSequence.toString(36)}`;
}

function createBrowserFfmpegPath(path: string, operationId: string): string {
  const extensionIndex = path.lastIndexOf('.');
  const stem = extensionIndex > 0 ? path.slice(0, extensionIndex) : path;
  const extension = extensionIndex > 0 ? path.slice(extensionIndex) : '';
  return `${stem}-${operationId}${extension}`;
}

async function prepareVisualClipInput(
  clip: ComposeSequenceVisualClip,
  index: number,
): Promise<{ inputName: string; sourceUrl: string; sourceFilePath?: string; isAnimatedGif?: boolean }> {
  if (clip.runtimeRole === 'adjustment') {
    return { inputName: '', sourceUrl: '' };
  }
  if (clip.sourceKind === 'text') {
    const renderedCard = await renderTextCard({
      text: clip.textContent ?? clip.text ?? '',
      fontFamily: clip.textFontFamily,
      fontSizePx: clip.textSizePx,
      color: clip.textColor,
      effect: clip.textEffect,
      opacityPercent: 100,
      typography: clip.textTypography,
    });
    const inputName = `sequence-text-${index + 1}.png`;
    return {
      inputName,
      sourceUrl: renderedCard,
    };
  }

  if (clip.sourceKind === 'shape') {
    const renderedCard = await renderShapeCard({
      fillColor: clip.shapeFillColor ?? '#0ea5e9',
      borderColor: clip.shapeBorderColor ?? '#f8fafc',
      borderWidth: clip.shapeBorderWidth ?? 2,
      cornerRadius: clip.shapeCornerRadius ?? 18,
      opacityPercent: clip.opacityPercent,
    });
    const inputName = `sequence-shape-${index + 1}.png`;
    return {
      inputName,
      sourceUrl: renderedCard,
    };
  }

  if (clip.sourceKind === 'comic') {
    const renderedCard = await renderComicCard(clip);
    const inputName = `sequence-comic-${index + 1}.png`;
    return {
      inputName,
      sourceUrl: renderedCard,
    };
  }

  if (!clip.assetUrl) {
    throw new Error('A manual editor clip is missing its source media.');
  }

  const extension =
    clip.sourceKind === 'image'
      ? 'png'
      : 'mp4';
  const inputName = `sequence-visual-${index + 1}.${extension}`;
  return {
    inputName,
    sourceUrl: clip.assetUrl,
    sourceFilePath: clip.nativeFilePath,
    isAnimatedGif: await detectAnimatedGifClip(clip),
  };
}

/**
 * Detects whether an `image` clip's source is a real, multi-frame (animated) GIF, so the FFmpeg
 * sequence command can loop it instead of freezing it to its first frame (see
 * `buildVisualClipInputArgs`). Cheaply gated by `isGifAssetReference` (mimeType/URL sniffing --
 * no I/O) before paying for the byte fetch + frame-count probe; never throws, since a detection
 * failure should just fall back to today's static-image behavior rather than break the export.
 */
export async function detectAnimatedGifClip(clip: ComposeSequenceVisualClip): Promise<boolean> {
  if (clip.sourceKind !== 'image' || !clip.assetUrl || !isGifAssetReference(clip.assetUrl, clip.mimeType)) {
    return false;
  }

  try {
    const bytes = await fetchFile(clip.assetUrl);
    return (await probeGifAnimation(bytes)).isAnimated;
  } catch {
    return false;
  }
}

export async function resolveSequenceVisualClipDuration(
  clip: ComposeSequenceVisualClip,
  resolveMediaDuration: MediaDurationLoader,
): Promise<number> {
  if (clip.runtimeRole === 'adjustment') {
    if (clip.sourceKind === 'video' && clip.assetUrl) {
      const sourceDurationSeconds = await resolveMediaDuration(clip.assetUrl, 'video');
      const availableMs = resolveVisualClipSourceRangeMs(clip, sourceDurationSeconds).durationMs;
      return availableMs > 0
        ? availableMs / 1_000 / Math.max(0.25, clip.playbackRate || 1)
        : 0.001;
    }
    if (clip.sourceKind === 'video') {
      const sourceRangeMs = resolveVisualClipSourceRangeMs(clip, 0).durationMs;
      return sourceRangeMs > 0
        ? sourceRangeMs / 1_000 / Math.max(0.25, clip.playbackRate || 1)
        : 0.001;
    }
    if (Number.isFinite(clip.durationSeconds) && (clip.durationSeconds ?? 0) > 0) {
      return Math.max(0.001, clip.durationSeconds as number);
    }
    const sourceRangeMs = resolveVisualClipSourceRangeMs(clip, 0).durationMs;
    return sourceRangeMs > 0
      ? sourceRangeMs / 1_000 / Math.max(0.25, clip.playbackRate || 1)
      : 0.001;
  }
  if (clip.sourceKind === 'image' || clip.sourceKind === 'text' || clip.sourceKind === 'shape' || clip.sourceKind === 'comic') {
    return Math.max(0.25, clip.durationSeconds ?? 4);
  }

  if (!clip.assetUrl) {
    return 0.25;
  }

  const sourceDurationSeconds = await resolveMediaDuration(clip.assetUrl, 'video');
  const availableMs = Math.max(250, resolveVisualClipSourceRangeMs(clip, sourceDurationSeconds).durationMs);

  return availableMs / 1000 / Math.max(0.25, clip.playbackRate || 1);
}

export function resolveSequenceTimelineDurationSeconds(
  visualClips: PreparedSequenceVisualClip[],
  audioTracks: PreparedSequenceAudioTrack[],
): number {
  const longestVisual = visualClips.reduce((maxSeconds, clip) => {
    return Math.max(maxSeconds, clip.clip.startMs / 1000 + clip.clipDurationSeconds);
  }, 0);
  const longestAudio = audioTracks.reduce((maxSeconds, track) => {
    return Math.max(maxSeconds, track.track.offsetMs / 1000 + track.durationSeconds);
  }, 0);

  return Math.max(1, longestVisual, longestAudio);
}

function getSequenceCanvas(aspectRatio: AspectRatio, videoResolution: VideoResolution): SequenceCanvas {
  return getVideoCanvasDimensions(aspectRatio, videoResolution);
}

/**
 * Builds the FFmpeg input-side args for one visual clip's input file.
 *
 * Animated GIFs (`isAnimatedGif`) skip `-loop 1` entirely -- that flag forces the image2 "single
 * still frame repeated forever" demuxer path, which is exactly what freezes a GIF to its first
 * frame. Left un-looped, FFmpeg reads a GIF as a genuine multi-frame video stream; `-ignore_loop 0`
 * additionally honors the GIF's own NETSCAPE loop-count header (instead of playing it through once
 * and stopping), so the animation repeats to fill `clipDurationSeconds` -- `-t` still truncates it
 * to the exact clip length either way. Every other case (including static/non-animated GIFs) keeps
 * the exact previous behavior: unchanged for callers that never set `isAnimatedGif`.
 */
export function buildVisualClipInputArgs(
  sourceKind: EditorVisualSourceKind,
  inputName: string,
  clipDurationSeconds: number,
  isAnimatedGif?: boolean,
): string[] {
  if (sourceKind === 'image' && isAnimatedGif) {
    return ['-ignore_loop', '0', '-t', formatSeconds(clipDurationSeconds), '-i', inputName];
  }

  if (sourceKind === 'image' || sourceKind === 'text' || sourceKind === 'shape' || sourceKind === 'comic') {
    return ['-loop', '1', '-t', formatSeconds(clipDurationSeconds), '-i', inputName];
  }

  return ['-i', inputName];
}

/**
 * Builds the shared trimmed/delayed source graph, then optionally routes it
 * through the persisted bounded mixer. Both legacy/browser composition and
 * native frame-server export call this exact helper so a bus change cannot
 * drift between delivery backends.
 */
export function buildSequenceAudioMixFilterGraph({
  preparedAudioTracks,
  inputIndexOffset,
  timelineDurationSeconds,
  audioMixerBuses,
}: {
  preparedAudioTracks: PreparedSequenceAudioTrack[];
  inputIndexOffset: number;
  timelineDurationSeconds: number;
  audioMixerBuses?: ProfessionalAudioBus[];
}): { filterParts: string[]; outputLabel?: string } {
  const filterParts: string[] = [];
  const inputLabels: Array<{ id: string; label: string }> = [];

  preparedAudioTracks.forEach((preparedAudioTrack, index) => {
    const { track } = preparedAudioTrack;
    const inputIndex = inputIndexOffset + index;
    const label = `a${index}`;
    const delay = Math.max(0, track.offsetMs);
    const audioFilter = buildSequenceAudioFilterChain(
      track,
      preparedAudioTrack.sourceDurationSeconds ?? preparedAudioTrack.durationSeconds,
      preparedAudioTrack.durationSeconds,
    );
    filterParts.push(`[${inputIndex}:a]${audioFilter},adelay=${delay}:all=1[${label}]`);
    inputLabels.push({
      id: track.id ?? `${track.sourceNodeId}:${track.trackIndex}:${index}`,
      label,
    });
  });

  if (inputLabels.length === 0) return { filterParts };

  // Ducking operates on decoded, trimmed, delayed clip legs before persisted bus routing.
  // The resulting labels are fed into the same mixer used by every delivery path.
  const duckingGraph = buildEditorAudioDuckingGraph(
    preparedAudioTracks.map((preparedAudioTrack, index) => ({
      label: inputLabels[index]?.label ?? `a${index}`,
      id: preparedAudioTrack.track.id,
      audioDucking: preparedAudioTrack.track.audioDucking,
    })),
    timelineDurationSeconds,
  );
  filterParts.push(...duckingGraph.filterParts);
  const routedInputLabels = inputLabels.map((input, index) => ({
    ...input,
    label: duckingGraph.audioLabels[index]?.replace(/^\[|\]$/g, '') ?? input.label,
  }));

  // Existing compositions without persisted bus state preserve their exact
  // historic filter graph. Once the mounted mixer saves a bus record, routing
  // becomes authoritative for both render backends.
  if (audioMixerBuses === undefined) {
    filterParts.push(
      `${routedInputLabels.map(({ label }) => `[${label}]`).join('')}amix=inputs=${routedInputLabels.length}:duration=longest,atrim=duration=${formatSeconds(timelineDurationSeconds)}[aout]`,
    );
    return { filterParts, outputLabel: 'aout' };
  }

  const model = createVideoAudioMixerRoutingModel({
    buses: audioMixerBuses,
    tracks: preparedAudioTracks.map((preparedAudioTrack, index) => ({
      id: routedInputLabels[index]?.id ?? '',
      pan: preparedAudioTrack.track.professional?.pan,
      busId: preparedAudioTrack.track.professional?.busId,
    })),
  });
  const mixerGraph = buildVideoAudioMixerFfmpegGraph({ model, inputs: routedInputLabels });
  if (!mixerGraph.ok) {
    throw new Error(`Audio mixer routing was refused before output: ${mixerGraph.reason}`);
  }
  filterParts.push(...mixerGraph.filterParts);
  if (!mixerGraph.outputLabel) {
    // A muted/soloed-away timeline intentionally has no encoded audio. Keep
    // FFmpeg's graph closed nevertheless: an unconsumed prepared input label
    // is an execution error, not silent output.
    filterParts.push(...routedInputLabels.map(({ label }) => `[${label}]anullsink`));
    return { filterParts };
  }
  filterParts.push(
    `[${mixerGraph.outputLabel}]atrim=duration=${formatSeconds(timelineDurationSeconds)}[aout]`,
  );
  return { filterParts, outputLabel: 'aout' };
}

/**
 * Executes the actual first pass against the same enabled-track mix used by
 * delivery. The only persisted value is the caller's target intent; the
 * returned measurement is held in memory solely long enough to construct the
 * immediately following final render.
 */
export async function resolveSequenceLoudnessNormalizationPlan({
  settings,
  preparedAudioTracks,
  timelineDurationSeconds,
  providerSettings,
  nativeBackend,
  audioMixerBuses,
}: {
  settings?: SequenceLoudnessNormalizationSettings;
  preparedAudioTracks: PreparedSequenceAudioTrack[];
  timelineDurationSeconds: number;
  providerSettings?: ProviderSettings;
  nativeBackend: NativeRenderExecutionBackend | null;
  audioMixerBuses?: ProfessionalAudioBus[];
}): Promise<VideoLoudnessNormalizationPlan | undefined> {
  if (!settings) return undefined;
  if (preparedAudioTracks.length === 0) {
    throw new Error('Final-mix loudness normalization needs at least one enabled sequence audio track. Silent and image-sequence outputs are not normalized.');
  }

  const draft = buildVideoLoudnessNormalizationPlan({
    integratedLufs: settings.targetLufs,
    loudnessRangeLu: settings.loudnessRangeLu,
    truePeakDbfs: settings.truePeakCeilingDbtp,
  });

  let report: string | null;
  if (providerSettings && nativeBackend) {
    report = await analyzeLoudnessViaLocalNativeFFmpeg({
      providerSettings,
      command: buildSequenceLoudnessAnalysisCommand({
        preparedAudioTracks,
        timelineDurationSeconds,
        analysisFilter: draft.analysisFilter,
        audioMixerBuses,
      }),
      inputs: preparedAudioTracks.map((track) => ({
        name: track.inputName,
        url: track.sourceUrl,
        filePath: track.sourceFilePath,
      })),
    });
    if (!report) {
      throw new Error('Final-mix loudness normalization requires the local native render service. Switch the render backend to Browser for a short sequence or disable normalization.');
    }
  } else {
    report = await analyzeSequenceLoudnessInBrowser({
      preparedAudioTracks,
      timelineDurationSeconds,
      analysisFilter: draft.analysisFilter,
      audioMixerBuses,
    });
  }

  const measured = parseVideoLoudnormAnalysisOutput(report);
  if (!measured) {
    throw new Error('Final-mix loudness analysis did not return complete measured loudnorm values. No output was delivered.');
  }

  return buildVideoLoudnessNormalizationPlan(draft.target, measured);
}

/** Builds an audio-only first pass, preserving each final mix input's trim,
 * automation, processing, delay, and duration without paying for visual
 * compositing before the final render. */
export function buildSequenceLoudnessAnalysisCommand({
  preparedAudioTracks,
  timelineDurationSeconds,
  analysisFilter,
  audioMixerBuses,
}: {
  preparedAudioTracks: PreparedSequenceAudioTrack[];
  timelineDurationSeconds: number;
  analysisFilter: string;
  audioMixerBuses?: ProfessionalAudioBus[];
}): string[] {
  const command = ['-y', '-loglevel', 'info'];
  for (const preparedAudioTrack of preparedAudioTracks) {
    command.push('-i', preparedAudioTrack.inputName);
  }
  const audioGraph = buildSequenceAudioMixFilterGraph({
    preparedAudioTracks,
    inputIndexOffset: 0,
    timelineDurationSeconds,
    audioMixerBuses,
  });
  if (!audioGraph.outputLabel) {
    throw new Error('Final-mix loudness normalization needs an audible mixer output.');
  }
  const filterParts = [...audioGraph.filterParts, `[${audioGraph.outputLabel}]${analysisFilter}[loudnorm_analysis]`];
  command.push('-filter_complex', filterParts.join(';'), '-map', '[loudnorm_analysis]', '-f', 'null', '-');
  return command;
}

async function analyzeSequenceLoudnessInBrowser({
  preparedAudioTracks,
  timelineDurationSeconds,
  analysisFilter,
  audioMixerBuses,
}: {
  preparedAudioTracks: PreparedSequenceAudioTrack[];
  timelineDurationSeconds: number;
  analysisFilter: string;
  audioMixerBuses?: ProfessionalAudioBus[];
}): Promise<string> {
  const ffmpeg = await getFFmpeg();
  const operationId = createBrowserFfmpegOperationId();
  const browserTracks = preparedAudioTracks.map((track) => ({
    ...track,
    inputName: createBrowserFfmpegPath(track.inputName, operationId),
  }));
  const messages: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    if (messages.join('\n').length < 64 * 1024) messages.push(message);
  };

  return withBrowserFfmpegOperation(ffmpeg, async (operation) => {
    for (const track of browserTracks) {
      await operation.writeFile(track.inputName, await fetchFile(track.sourceUrl));
    }
    ffmpeg.on('log', onLog);
    try {
      await ffmpeg.exec(buildSequenceLoudnessAnalysisCommand({
        preparedAudioTracks: browserTracks,
        timelineDurationSeconds,
        analysisFilter,
        audioMixerBuses,
      }));
    } catch (error) {
      throw new Error(`Browser FFmpeg could not complete final-mix loudness analysis: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      ffmpeg.off('log', onLog);
    }
    return messages.join('\n');
  });
}

export function buildSequenceCommand({
  preparedClips,
  preparedAudioTracks,
  preparedStageObjects = [],
  canvas,
  timelineDurationSeconds,
  frameRate = DEFAULT_SEQUENCE_FRAME_RATE,
  exportPreset = resolveVideoExportPreset(),
  outputName,
  nativeBackend,
  audioMixerBuses,
  loudnessRenderFilter,
  captionEmbedding,
}: {
  preparedClips: PreparedSequenceVisualClip[];
  preparedAudioTracks: PreparedSequenceAudioTrack[];
  preparedStageObjects?: PreparedSequenceStageObject[];
  canvas: SequenceCanvas;
  timelineDurationSeconds: number;
  frameRate?: number;
  exportPreset?: VideoExportPresetOption;
  outputName: string;
  nativeBackend: NativeRenderExecutionBackend | null;
  audioMixerBuses?: ProfessionalAudioBus[];
  loudnessRenderFilter?: string;
  captionEmbedding?: VideoCaptionEmbeddingPlan;
}): string[] {
  const command: string[] = ['-y'];
  const isImageSequence = Boolean(exportPreset.imageSequence);
  if (captionEmbedding && isImageSequence) {
    throw new Error('Embedded captions are unavailable for image-sequence outputs.');
  }
  const commandAudioTracks = isImageSequence ? [] : preparedAudioTracks;

  if (nativeBackend) {
    command.push(...getNativeSequenceCommandPrefix(nativeBackend));
  }

  command.push(
    '-f',
    'lavfi',
    '-t',
    formatSeconds(timelineDurationSeconds),
    '-i',
    `color=c=black:s=${canvas.width}x${canvas.height}:r=${formatFrameRate(frameRate)}`,
  );

  for (const preparedClip of preparedClips.filter((clip) => !clip.isRuntimeAdjustment)) {
    command.push(...buildVisualClipInputArgs(
      preparedClip.clip.sourceKind,
      preparedClip.inputName,
      preparedClip.clipDurationSeconds,
      preparedClip.isAnimatedGif,
    ));
  }

  for (const preparedStageObject of preparedStageObjects) {
    command.push('-loop', '1', '-t', formatSeconds(timelineDurationSeconds), '-i', preparedStageObject.inputName);
  }

  for (const preparedAudioTrack of commandAudioTracks) {
    command.push('-i', preparedAudioTrack.inputName);
  }
  if (captionEmbedding) {
    command.push('-i', captionEmbedding.inputName);
  }

  const filterParts: string[] = [];
  filterParts.push(`[0:v]format=rgba[base0]`);

  for (const preparedClip of preparedClips.filter((clip) => !clip.isRuntimeAdjustment)) {
    filterParts.push(buildSequenceVisualFilter(preparedClip, canvas, frameRate, preparedClips));
  }

  const overlayOrder = [...preparedClips].sort(
    (left, right) =>
      left.clip.trackIndex - right.clip.trackIndex ||
      left.clip.startMs - right.clip.startMs ||
      left.inputIndex - right.inputIndex,
  );

  let currentBaseLabel = 'base0';

  overlayOrder.forEach((preparedClip, index) => {
    const outputLabel = `base${index + 1}`;
    if (preparedClip.isRuntimeAdjustment) {
      filterParts.push(buildRuntimeAdjustmentCompositeFilter(currentBaseLabel, outputLabel, preparedClip));
      currentBaseLabel = outputLabel;
      return;
    }
    const clipLabel = `clip${preparedClip.inputIndex}`;
    filterParts.push(...buildClipCompositeFilters(currentBaseLabel, clipLabel, outputLabel, preparedClip, preparedClips));
    currentBaseLabel = outputLabel;
  });

  preparedStageObjects.forEach((preparedStageObject, index) => {
    const objectLabel = `stage${preparedStageObject.inputIndex}`;
    const outputLabel = `stagebase${index + 1}`;
    filterParts.push(`[${preparedStageObject.inputIndex}:v]format=rgba[${objectLabel}]`);
    filterParts.push(
      buildStageObjectOverlayFilter(currentBaseLabel, objectLabel, outputLabel, preparedStageObject.object),
    );
    currentBaseLabel = outputLabel;
  });

  filterParts.push(
    isImageSequence
      ? `[${currentBaseLabel}]format=${exportPreset.mimeType === 'image/jpeg' ? 'yuvj420p' : 'rgba'}[vout]`
      : nativeBackend
      ? getNativeSequenceOutputFilter(currentBaseLabel, nativeBackend, exportPreset)
      : `[${currentBaseLabel}]format=${exportPreset.preservesAlpha ? 'yuva420p' : 'yuv420p'}[vout]`,
  );

  const audioInputOffset = preparedClips.filter((clip) => !clip.isRuntimeAdjustment).length + preparedStageObjects.length + 1;
  const captionInputIndex = captionEmbedding
    ? audioInputOffset + commandAudioTracks.length
    : undefined;
  const audioGraph = buildSequenceAudioMixFilterGraph({
    preparedAudioTracks: commandAudioTracks,
    inputIndexOffset: audioInputOffset,
    timelineDurationSeconds,
    audioMixerBuses,
  });
  filterParts.push(...audioGraph.filterParts);

  const nativeAudioCodecArgs = nativeBackend ? exportPreset.nativeMapping?.[nativeBackend]?.audioCodecArgs : undefined;
  const audioCodecArgs = nativeBackend ? (nativeAudioCodecArgs ?? ['-c:a', 'aac']) : exportPreset.audioCodecArgs;
  let finalAudioLabel = audioGraph.outputLabel;
  if (finalAudioLabel && loudnessRenderFilter) {
    finalAudioLabel = 'aout_loudnorm';
    filterParts.push(`[${audioGraph.outputLabel}]${loudnessRenderFilter}[${finalAudioLabel}]`);
  }
  const shouldMapAudio = !isImageSequence && Boolean(finalAudioLabel) && audioCodecArgs.length > 0;

  command.push(
    '-filter_complex',
    filterParts.join(';'),
    '-map',
    '[vout]',
  );

  if (shouldMapAudio) {
    command.push('-map', `[${finalAudioLabel}]`);
  } else {
    command.push('-an');
  }
  if (captionInputIndex !== undefined && captionEmbedding) {
    command.push('-map', `${captionInputIndex}:0`);
  }

  if (isImageSequence) {
    command.push('-r', formatFrameRate(frameRate), '-frames:v', String(resolveSequenceFrameCount(timelineDurationSeconds, frameRate)), ...exportPreset.videoCodecArgs);
  } else if (nativeBackend) {
    command.push(...getNativeSequenceEncoderArgs(nativeBackend, exportPreset));
    if (shouldMapAudio) {
      command.push(...audioCodecArgs);
    }
  } else {
    command.push('-r', formatFrameRate(frameRate), ...exportPreset.videoCodecArgs);
    if (shouldMapAudio) {
      command.push(...audioCodecArgs);
    }
  }

  if (exportPreset.containerArgs?.length) {
    command.push(...exportPreset.containerArgs);
  }

  if (captionEmbedding) {
    command.push(
      '-c:s', 'mov_text',
      '-metadata:s:s:0', `language=${captionEmbedding.language}`,
      '-disposition:s:0', 'default',
    );
  }

  command.push(outputName);

  return command;
}

function textToDataUrl(text: string, mimeType: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8_192));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function resolveSequenceFrameCount(durationSeconds: number, frameRate: number): number {
  const safeDurationSeconds = Math.max(0.001, durationSeconds);
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : DEFAULT_SEQUENCE_FRAME_RATE;
  return Math.max(1, Math.ceil(safeDurationSeconds * safeFrameRate));
}

function buildStageObjectOverlayFilter(
  baseLabel: string,
  objectLabel: string,
  outputLabel: string,
  object: EditorStageObject,
): string {
  const ffmpegBlendMode = mapStageBlendModeToFFmpeg(object.blendMode);

  if (!ffmpegBlendMode) {
    return `[${baseLabel}][${objectLabel}]overlay=0:0[${outputLabel}]`;
  }

  return `[${baseLabel}][${objectLabel}]blend=all_mode=${ffmpegBlendMode}[${outputLabel}]`;
}

function mapStageBlendModeToFFmpeg(mode: EditorStageBlendMode): string | undefined {
  switch (mode) {
    case 'screen':
      return 'screen';
    case 'multiply':
      return 'multiply';
    case 'overlay':
      return 'overlay';
    case 'lighten':
      return 'lighten';
    case 'darken':
      return 'darken';
    case 'color-dodge':
      return 'colordodge';
    case 'color-burn':
      return 'colorburn';
    case 'normal':
      return undefined;
  }
}

/**
 * Canonical motion-comic card dimensions. The card is a fixed 1280x720 frame; the bubble BODY is a
 * fixed centred box (`COMIC_CARD_BODY_*`) leaving a uniform headroom margin so the bezier tail can
 * poke out of the body without changing the body's size as the tail animates. The body-to-card ratio
 * is the shared contract between this card and the stage tail-tip handle in VideoWorkspace — a tail
 * tip at percent 95/5 lands on the body edge, which sits at ~80%/~64% of the card (x/y).
 */
export const COMIC_CARD_WIDTH = 1280;
export const COMIC_CARD_HEIGHT = 720;
export const COMIC_CARD_BODY_WIDTH = 1020;
export const COMIC_CARD_BODY_HEIGHT = 460;

/** Progress-resolved tail override for the preview so a keyframed tail animates per playhead. */
export interface ComicCardTailSample {
  tipXPercent?: number;
  tipYPercent?: number;
  curvePercent?: number;
}

/**
 * Motion-comic clip card: renders the bubble/caption to the canonical card PNG through the SAME
 * painter the stage preview uses (drawComicStageObject), so timeline clip, program stage, and encode
 * all show identical pixels. The clip's fit/scale/position then place it on canvas.
 *
 * Tail keyframing: the preview passes `tailSample` (the tail tip + funnel resolved at the current
 * playhead progress) so the tail animates live and INDEPENDENTLY of the body. The export path calls
 * this WITHOUT a sample, baking the clip's static bezier tail (which Phase 1's
 * `syncVisualClipToKeyframes` mirrors from the first keyframe) — see docs/notes/830 for the export
 * per-frame-tail limitation.
 */
export async function renderComicCard(
  clip: {
    comicKind?: 'speech-bubble' | 'thought-bubble' | 'caption';
    textContent?: string;
    textFontFamily: string;
    textSizePx: number;
    textColor: string;
    shapeFillColor?: string;
    shapeBorderColor?: string;
    shapeBorderWidth?: number;
    comicTailAngleDeg?: number;
    comicTailLengthPx?: number;
    comicTailTipXPercent?: number;
    comicTailTipYPercent?: number;
    comicTailCurvePercent?: number;
    comicLineHeightPercent?: number;
    comicLetterSpacingPx?: number;
    comicTextAlign?: 'left' | 'center' | 'right';
    /** Paper-grade typography (weight/style/leading/tracking/align incl. justify/stroke/shadow/arc)
     *  — wins over the flat `comicLineHeightPercent`/`comicLetterSpacingPx`/`comicTextAlign` above
     *  when a field is set, per-field (see `EditorVisualClip.textTypography`'s doc). */
    textTypography?: EditorTextTypography;
  },
  tailSample?: ComicCardTailSample,
): Promise<string> {
  await ensureBundledFontDependenciesReady(managedBundledFontDependenciesForState(
    clip.textTypography?.managedFace,
    clip.textTypography?.managedFaceIssue,
  ));
  const canvas = document.createElement('canvas');
  canvas.width = COMIC_CARD_WIDTH;
  canvas.height = COMIC_CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create a canvas context for a motion-comic clip.');
  }
  const kind = clip.comicKind ?? 'speech-bubble';
  const typography = clip.textTypography;
  context.save();
  context.translate(COMIC_CARD_WIDTH / 2, COMIC_CARD_HEIGHT / 2);
  drawComicStageObject(context, {
    id: 'comic-card',
    kind,
    x: 0,
    y: 0,
    // Fixed body box with uniform tail headroom, so the body size is stable while the tail animates.
    width: COMIC_CARD_BODY_WIDTH,
    height: COMIC_CARD_BODY_HEIGHT,
    rotationDeg: 0,
    opacityPercent: 100,
    blendMode: 'normal',
    text: clip.textContent ?? '',
    fontFamily: clip.textFontFamily,
    fontSizePx: clip.textSizePx,
    textColor: clip.textColor,
    fillColor: clip.shapeFillColor ?? (kind === 'caption' ? '#fef3c7' : '#ffffff'),
    strokeColor: clip.shapeBorderColor ?? '#181b20',
    strokeWidthPx: clip.shapeBorderWidth ?? 4,
    // Legacy polar tail kept only as a fallback seed for the bezier tip.
    tailAngleDeg: clip.comicTailAngleDeg ?? 115,
    tailLengthPx: Math.max(0, clip.comicTailLengthPx ?? 90),
    // Bezier tail: the progress-resolved sample wins (preview), else the clip's static tail (export).
    tailTipXPercent: tailSample?.tipXPercent ?? clip.comicTailTipXPercent,
    tailTipYPercent: tailSample?.tipYPercent ?? clip.comicTailTipYPercent,
    tailCurvePercent: tailSample?.curvePercent ?? clip.comicTailCurvePercent,
    lineHeightPercent: typography?.lineHeightPercent ?? clip.comicLineHeightPercent ?? 120,
    letterSpacingPx: typography?.letterSpacingPx ?? clip.comicLetterSpacingPx ?? 0,
    textAlign: typography?.textAlign ?? clip.comicTextAlign ?? 'center',
    textFontWeight: typography?.fontWeight,
    textFontStyle: typography?.fontStyle,
    textManagedFace: typography?.managedFace,
    textFontKerning: typography?.fontKerning,
    textStrokeColor: typography?.strokeColor,
    textStrokeWidthPx: typography?.strokeWidthPx,
    textShadowColor: typography?.shadowColor,
    textShadowBlurPx: typography?.shadowBlurPx,
    textShadowOffsetXPx: typography?.shadowOffsetXPx,
    textShadowOffsetYPx: typography?.shadowOffsetYPx,
    textArcPercent: typography?.arcPercent,
  });
  context.restore();
  return canvas.toDataURL('image/png');
}

export async function renderStageObjectImage(
  object: EditorStageObject,
  canvasSize: SequenceCanvas,
): Promise<string> {
  await ensureBundledFontDependenciesReady(managedBundledFontDependenciesForState(
    object.kind === 'text' ? object.managedFace : undefined,
    object.kind === 'text' ? object.managedFaceIssue : undefined,
  ));
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize.width;
  canvas.height = canvasSize.height;

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Could not create a canvas context for a program-stage object.');
  }

  paintStageBlendNeutralBackground(context, object.blendMode, canvasSize);
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, object.opacityPercent / 100));
  context.translate(object.x + object.width / 2, object.y + object.height / 2);
  context.rotate((object.rotationDeg * Math.PI) / 180);

  if (object.kind === 'text') {
    drawTextStageObject(context, object);
  } else if (object.kind === 'rectangle') {
    drawRectangleStageObject(context, object);
  } else {
    drawComicStageObject(context, object);
  }

  context.restore();

  return canvas.toDataURL('image/png');
}

function paintStageBlendNeutralBackground(
  context: CanvasRenderingContext2D,
  blendMode: EditorStageBlendMode,
  canvasSize: SequenceCanvas,
) {
  if (blendMode === 'normal') {
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);
    return;
  }

  context.fillStyle = blendMode === 'darken' || blendMode === 'multiply' || blendMode === 'color-burn'
    ? '#ffffff'
    : '#000000';
  context.fillRect(0, 0, canvasSize.width, canvasSize.height);
}

/** Paint-time typography a `VideoTextLayoutResult` doesn't itself carry (color + stroke/shadow/arc,
 *  which are rendering concerns, not layout concerns — see `videoTextFlow.ts`'s module doc). */
interface TypesetPaintStyle {
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  managedFace?: ManagedBundledFontFaceReference;
  fontKerning?: 'auto' | 'normal' | 'none';
  letterSpacingPx: number;
  color: string;
  strokeColor?: string;
  strokeWidthPx?: number;
  shadowColor?: string;
  shadowBlurPx?: number;
  shadowOffsetXPx?: number;
  shadowOffsetYPx?: number;
  arcPercent?: number;
}

/**
 * Paints a `videoTextFlow` layout onto a canvas, honoring weight/style/stroke/shadow/arc. `origin`
 * places the layout's own (0,0) — the top-left of its content box, BEFORE per-line alignment offsets
 * — in the caller's current canvas transform (which may already be translated/rotated to a bubble or
 * object center). Isolated in its own save/restore so it never leaks font/shadow/stroke state into
 * the caller. This is the ONE place Video text actually gets painted to a canvas — shared by
 * `drawTextStageObject`, `drawComicStageObject`'s typesetting, and the text-clip export card
 * (`renderTextCard`), so all three stay pixel-consistent with each other and with `videoTextFlow`'s
 * layout math.
 */
function paintTypesetTextBlock(
  context: CanvasRenderingContext2D,
  layout: VideoTextLayoutResult,
  style: TypesetPaintStyle,
  origin: { xPx: number; yPx: number },
): void {
  assertCanvasCanPaintExactManagedVideoFace(style.managedFace);
  context.save();
  const stylePrefix = style.managedFace
    ? `${bundledFontFaceStyleDescriptor(style.managedFace)} `
    : style.fontStyle === 'normal' ? '' : `${style.fontStyle} `;
  const family = style.managedFace ? bundledFontFaceRuntimeFamilyName(style.managedFace) : style.fontFamily;
  context.font = `${stylePrefix}${style.fontWeight} ${style.fontSizePx}px ${formatFontFamily(family)}`;
  context.fontKerning = style.fontKerning ?? 'auto';
  if (style.managedFace && 'fontStretch' in context) {
    (context as unknown as { fontStretch: string }).fontStretch = resolveVideoCanvasFontStretch(style.managedFace.stretchPercent);
  }
  if ('letterSpacing' in context) {
    (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${style.letterSpacingPx}px`;
  }
  context.fillStyle = style.color;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';

  const hasStroke = (style.strokeWidthPx ?? 0) > 0;
  if (hasStroke) {
    context.strokeStyle = style.strokeColor ?? '#000000';
    context.lineWidth = style.strokeWidthPx as number;
    context.lineJoin = 'round';
  }

  const hasShadow = (style.shadowBlurPx ?? 0) > 0 || (style.shadowOffsetXPx ?? 0) !== 0 || (style.shadowOffsetYPx ?? 0) !== 0;
  if (hasShadow) {
    context.shadowColor = style.shadowColor ?? 'rgba(0,0,0,0.6)';
    context.shadowBlur = Math.max(0, style.shadowBlurPx ?? 0);
    context.shadowOffsetX = style.shadowOffsetXPx ?? 0;
    context.shadowOffsetY = style.shadowOffsetYPx ?? 0;
  }

  // Approximate ascent: converts a line's "top" (videoTextFlow's yPx reference) to its baseline.
  const baselineOffsetPx = style.fontSizePx * 0.8;

  for (const line of layout.lines) {
    const lineY = origin.yPx + line.yPx + baselineOffsetPx;

    if (style.arcPercent) {
      paintArcTextRun(context, line.text, line.widthPx, origin.xPx + line.xPx + line.widthPx / 2, lineY, style, hasStroke);
      continue;
    }

    const runs = line.words
      ? line.words.map((word) => ({ text: word.text, xPx: origin.xPx + word.xPx }))
      : [{ text: line.text, xPx: origin.xPx + line.xPx }];

    for (const run of runs) {
      if (hasStroke) {
        context.strokeText(run.text, run.xPx, lineY);
      }
      context.fillText(run.text, run.xPx, lineY);
    }
  }

  context.restore();
}

/** Canvas 2D cannot set variable coordinates through a standards-track API. */
export function assertCanvasCanPaintExactManagedVideoFace(face: ManagedBundledFontFaceReference | undefined): void {
  if (face?.variationSettings && Object.keys(face.variationSettings).length > 0) {
    throw new Error('Exact managed variable-font coordinates require a supported shaping/render route; Canvas 2D video paint is blocked before fallback pixels are produced.');
  }
}

/** Draws one line's text as individually-placed, individually-rotated glyphs along an arc (see
 *  `computeArcTextGlyphs`). `centerX`/`baselineY` is the line's own horizontal center / baseline. */
function paintArcTextRun(
  context: CanvasRenderingContext2D,
  text: string,
  lineWidthPx: number,
  centerX: number,
  baselineY: number,
  style: TypesetPaintStyle,
  hasStroke: boolean,
): void {
  const measurer = getVideoTextCanvasMeasurer();
  const font = {
    fontFamily: style.managedFace
      ? bundledFontFaceRuntimeFamilyName(style.managedFace)
      : style.fontFamily,
    fontSizePx: style.fontSizePx,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fontStretchPercent: style.managedFace?.stretchPercent ?? 100,
    fontKerning: style.fontKerning ?? 'auto',
    letterSpacingPx: style.letterSpacingPx,
  };
  const glyphs = computeArcTextGlyphs(
    text,
    lineWidthPx,
    style.arcPercent,
    (char) => measurer(char, font) + style.letterSpacingPx,
  );

  context.save();
  context.textAlign = 'center';

  for (const glyph of glyphs) {
    context.save();
    context.translate(centerX + glyph.xPx, baselineY + glyph.yPx);
    context.rotate((glyph.rotationDeg * Math.PI) / 180);
    if (hasStroke) {
      context.strokeText(glyph.char, 0, 0);
    }
    context.fillText(glyph.char, 0, 0);
    context.restore();
  }

  context.restore();
}

export function drawTextStageObject(
  context: CanvasRenderingContext2D,
  object: Extract<EditorStageObject, { kind: 'text' }> & { typography?: EditorTextTypography },
) {
  const typography = object.typography;
  const fontWeight = typography?.fontWeight ?? object.fontWeight ?? 400;
  const fontStyle = typography?.fontStyle ?? object.fontStyle ?? 'normal';
  const layout = layoutVideoText(
    {
      text: object.text,
      fontFamily: object.fontFamily,
      fontSizePx: object.fontSizePx,
      typography: {
        fontWeight,
        fontStyle,
        managedFace: typography?.managedFace ?? object.managedFace,
        managedFaceIssue: typography?.managedFaceIssue ?? object.managedFaceIssue,
        fontKerning: typography?.fontKerning,
        lineHeightPercent: typography?.lineHeightPercent ?? 115,
        letterSpacingPx: typography?.letterSpacingPx ?? 0,
        textAlign: typography?.textAlign ?? 'center',
      },
    },
    getVideoTextCanvasMeasurer(),
  );

  paintTypesetTextBlock(
    context,
    layout,
    {
      fontFamily: object.fontFamily,
      fontSizePx: object.fontSizePx,
      fontWeight,
      fontStyle,
      managedFace: typography?.managedFace ?? object.managedFace,
      fontKerning: typography?.fontKerning,
      letterSpacingPx: typography?.letterSpacingPx ?? 0,
      color: object.color,
      strokeColor: typography?.strokeColor,
      strokeWidthPx: typography?.strokeWidthPx,
      shadowColor: typography?.shadowColor,
      shadowBlurPx: typography?.shadowBlurPx,
      shadowOffsetXPx: typography?.shadowOffsetXPx,
      shadowOffsetYPx: typography?.shadowOffsetYPx,
      arcPercent: typography?.arcPercent,
    },
    { xPx: -layout.contentWidthPx / 2, yPx: -layout.contentHeightPx / 2 },
  );
}

/**
 * The comic painter input: an editor comic stage object plus the OPTIONAL Paper-style bezier tail
 * channels and Paper-grade text typography. The bezier tail (tip position + funnel curvature, both
 * as a percent of the bubble frame) is resolved per playhead progress from keyframes upstream and
 * passed in here so the tail tip and funnel animate INDEPENDENTLY of the bubble body's
 * position/scale/rotation. When the bezier fields are absent the painter falls back to the legacy
 * polar tail (`tailAngleDeg`/`tailLengthPx`) and finally to a sane default tip. `textAlign` is
 * widened to include `'justify'` (the base `EditorComicStageObject` only has left/center/right) via
 * `Omit` + re-declare, which still lets a plain `EditorComicStageObject` (narrower `textAlign`)
 * type-check here. Kept structural (not the flow.ts type) so callers passing a plain
 * `EditorComicStageObject` still type-check.
 */
type ComicPaintObject = Omit<
  Extract<EditorStageObject, { kind: 'speech-bubble' | 'thought-bubble' | 'caption' }>,
  'textAlign'
> & {
  tailTipXPercent?: number;
  tailTipYPercent?: number;
  tailCurvePercent?: number;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  textFontWeight?: number;
  textFontStyle?: 'normal' | 'italic' | 'oblique';
  textManagedFace?: ManagedBundledFontFaceReference;
  textFontKerning?: 'auto' | 'normal' | 'none';
  textStrokeColor?: string;
  textStrokeWidthPx?: number;
  textShadowColor?: string;
  textShadowBlurPx?: number;
  textShadowOffsetXPx?: number;
  textShadowOffsetYPx?: number;
  textArcPercent?: number;
};

/**
 * Motion-comic stage objects. One canvas painter serves BOTH the program-stage preview and the
 * export render (renderStageObjectImage / renderComicCard), so what you see is what encodes — no
 * parity drift. The tail is a real cubic-bezier funnel adopted from Paper's `buildSpeechBubblePath`
 * (see `src/lib/videoComicTail.ts` for the pure geometry).
 */
export function drawComicStageObject(
  context: CanvasRenderingContext2D,
  object: ComicPaintObject,
) {
  const halfW = object.width / 2;
  const halfH = object.height / 2;
  const stroke = Math.max(0, object.strokeWidthPx);

  context.fillStyle = object.fillColor;
  context.strokeStyle = object.strokeColor;
  context.lineWidth = stroke;
  context.lineJoin = 'round';

  if (object.kind === 'caption') {
    // Classic rectangular caption box, square corners — captions never carry a tail.
    context.beginPath();
    context.rect(-halfW, -halfH, object.width, object.height);
    context.fill();
    if (stroke > 0) context.stroke();
  } else {
    // Resolve the bezier tail (tip + funnel) from the keyframe-resolved bezier fields, falling back
    // to the legacy polar tail and finally to a default tip. This is the ONLY tail model now.
    const tail = resolveComicTailGeometryForObject(object, halfW, halfH);

    if (object.kind === 'speech-bubble') {
      // Body + bezier tail as ONE path so the outline stays continuous where they join.
      const radius = Math.min(object.height * 0.45, object.width * 0.3);
      const path = new Path2D();
      path.roundRect(-halfW, -halfH, object.width, object.height, radius);
      path.addPath(buildComicTailPath(tail));
      context.fill(path);
      if (stroke > 0) context.stroke(path);
      // Re-fill the body so the tail-join stroke segment inside the bubble disappears.
      context.save();
      context.lineWidth = 0;
      const bodyOnly = new Path2D();
      bodyOnly.roundRect(-halfW + stroke / 2, -halfH + stroke / 2, object.width - stroke, object.height - stroke, Math.max(0, radius - stroke / 2));
      context.fill(bodyOnly);
      context.restore();
    } else {
      // Thought bubble: elliptical cloud body + shrinking puffs riding the tail's bezier curve.
      context.beginPath();
      context.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2);
      context.fill();
      if (stroke > 0) context.stroke();
      const puffCount = 3;
      for (let index = 1; index <= puffCount; index += 1) {
        const t = index / (puffCount + 1);
        const puff = comicTailQuadraticPoint(tail.base, tail.curveHandle, tail.tip, t);
        const pr = Math.max(3, (1 - t) * Math.min(halfW, halfH) * 0.22);
        context.beginPath();
        context.ellipse(puff.x, puff.y, pr, pr * 0.82, 0, 0, Math.PI * 2);
        context.fill();
        if (stroke > 0) context.stroke();
      }
    }
  }

  // Comic typesetting: Paper-grade layout (leading, tracking, alignment incl. justify) plus
  // weight/style/stroke/shadow/arc, via the shared `videoTextFlow` engine (see
  // `paintTypesetTextBlock`) — the SAME engine `drawTextStageObject` and `renderTextCard` use, so a
  // caption/bubble's text reads identically to a plain text clip's.
  const padX = Math.max(10, object.width * 0.08);
  const maxTextWidth = Math.max(1, object.width - padX * 2);
  const fontWeight = object.textFontWeight ?? 600;
  const fontStyle = object.textFontStyle ?? 'normal';
  const layout = layoutVideoText(
    {
      text: object.text,
      fontFamily: object.fontFamily,
      fontSizePx: object.fontSizePx,
      maxWidthPx: maxTextWidth,
      typography: {
        fontWeight,
        fontStyle,
        managedFace: object.textManagedFace,
        fontKerning: object.textFontKerning,
        lineHeightPercent: object.lineHeightPercent,
        letterSpacingPx: object.letterSpacingPx,
        textAlign: object.textAlign,
      },
    },
    getVideoTextCanvasMeasurer(),
  );

  paintTypesetTextBlock(
    context,
    layout,
    {
      fontFamily: object.fontFamily,
      fontSizePx: object.fontSizePx,
      fontWeight,
      fontStyle,
      managedFace: object.textManagedFace,
      fontKerning: object.textFontKerning,
      letterSpacingPx: object.letterSpacingPx,
      color: object.textColor,
      strokeColor: object.textStrokeColor,
      strokeWidthPx: object.textStrokeWidthPx,
      shadowColor: object.textShadowColor,
      shadowBlurPx: object.textShadowBlurPx,
      shadowOffsetXPx: object.textShadowOffsetXPx,
      shadowOffsetYPx: object.textShadowOffsetYPx,
      arcPercent: object.textArcPercent,
    },
    { xPx: -halfW + padX, yPx: -layout.contentHeightPx / 2 },
  );
}

/**
 * Resolves the bezier tail geometry for a comic bubble body of the given half-extents. Tip + curve
 * come from the (keyframe-resolved) bezier fields; when absent they fall back to the legacy polar
 * tail and finally to a default down-right tip.
 */
function resolveComicTailGeometryForObject(
  object: ComicPaintObject,
  halfW: number,
  halfH: number,
): ReturnType<typeof resolveComicTailGeometry> {
  const polar = comicPolarTailToTipPercent(object.tailAngleDeg, object.tailLengthPx);
  const tipXPercent = firstFiniteNumber(object.tailTipXPercent, polar?.tipXPercent, COMIC_TAIL_DEFAULT_TIP_X_PERCENT);
  const tipYPercent = firstFiniteNumber(object.tailTipYPercent, polar?.tipYPercent, COMIC_TAIL_DEFAULT_TIP_Y_PERCENT);
  const curvePercent = firstFiniteNumber(object.tailCurvePercent, COMIC_TAIL_DEFAULT_CURVE_PERCENT);

  return resolveComicTailGeometry({
    halfWidth: halfW,
    halfHeight: halfH,
    tipXPercent,
    tipYPercent,
    curvePercent,
    bodyShape: object.kind === 'thought-bubble' ? 'ellipse' : 'rect',
  });
}

/** Builds the closed cubic-bezier tail outline (baseLeft → tip → baseRight) as a Path2D. */
function buildComicTailPath(tail: ReturnType<typeof resolveComicTailGeometry>): Path2D {
  const path = new Path2D();
  path.moveTo(tail.baseLeft.x, tail.baseLeft.y);
  path.bezierCurveTo(tail.leftControl1.x, tail.leftControl1.y, tail.leftControl2.x, tail.leftControl2.y, tail.tip.x, tail.tip.y);
  path.bezierCurveTo(tail.rightControl1.x, tail.rightControl1.y, tail.rightControl2.x, tail.rightControl2.y, tail.baseRight.x, tail.baseRight.y);
  path.closePath();
  return path;
}

function firstFiniteNumber(...values: Array<number | undefined>): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

export function drawRectangleStageObject(
  context: CanvasRenderingContext2D,
  object: Extract<EditorStageObject, { kind: 'rectangle' }>,
) {
  const left = -object.width / 2;
  const top = -object.height / 2;
  const radius = Math.min(object.cornerRadius, object.width / 2, object.height / 2);

  context.beginPath();
  context.roundRect(left, top, object.width, object.height, radius);
  context.fillStyle = object.fillColor;
  context.fill();

  if (object.borderWidth > 0) {
    context.lineWidth = object.borderWidth;
    context.strokeStyle = object.borderColor;
    context.stroke();
  }
}

export function buildSequenceAudioVolumeFilter(
  track: ComposeSequenceAudioTrack,
  durationSeconds: number,
): string {
  const trackVolume = Math.max(0, track.trackVolumePercent ?? 100) / 100;
  let volumeFilter: string;
  const professionalVolumeExpression = compileProfessionalParameterExpression(
    track.professional?.parameterKeyframes,
    'volume',
    track.volumePercent,
    { minValue: 0 },
  );

  if (professionalVolumeExpression) {
    volumeFilter = `volume='${trackVolume.toFixed(4)}*((${professionalVolumeExpression})/100)':eval=frame`;
  } else if ((track.volumeKeyframes?.length ?? 0) > 0) {
    const keyframeExpression = buildAutomationPercentExpression(
      audioKeyframesToVolumeAutomation(track),
      Math.max(0.001, durationSeconds),
      track.volumePercent,
      't',
      150,
    );

    volumeFilter = `volume='${trackVolume.toFixed(4)}*(${keyframeExpression})':eval=frame`;
  } else {
    const clipVolume = Math.max(0, track.volumePercent) / 100;
    const baseVolume = trackVolume * clipVolume;

    if ((track.volumeAutomationPoints?.length ?? 0) === 0) {
      volumeFilter = `volume=${baseVolume.toFixed(2)}`;
    } else {
      const automationExpression = buildAutomationExpression(
        track.volumeAutomationPoints,
        Math.max(0.001, durationSeconds),
        100,
        't',
      );
      volumeFilter = `volume='${baseVolume.toFixed(4)}*(${automationExpression})':eval=frame`;
    }
  }

  const fadeIn = Math.min(5, durationSeconds / 2, Math.max(0, track.fadeInSeconds ?? 0));
  const fadeOut = Math.min(5, durationSeconds / 2, Math.max(0, track.fadeOutSeconds ?? 0));
  return [
    volumeFilter,
    ...(fadeIn > 0 ? [`afade=t=in:st=0:d=${formatSeconds(fadeIn)}`] : []),
    ...(fadeOut > 0 ? [`afade=t=out:st=${formatSeconds(Math.max(0, durationSeconds - fadeOut))}:d=${formatSeconds(fadeOut)}`] : []),
  ].join(',');
}

function compileProfessionalParameterExpression(
  tracks: readonly ProfessionalNumericParameterTrack[] | undefined,
  parameterId: string,
  defaultValue: number,
  bounds: { minValue?: number; maxValue?: number } = {},
): string | undefined {
  const stored = tracks?.find((track) => track.parameter === parameterId);
  if (!stored) return undefined;
  try {
    const compiled = compileVideoParamKeyframeTrackForFfmpeg(videoParamTrackFromProfessional(stored, {
      defaultValue,
      ...bounds,
    }));
    return compiled.ok ? compiled.expression : undefined;
  } catch {
    return undefined;
  }
}

/** Shared dry-audio graph used by both browser composition and native frame-server export. */
export function buildSequenceAudioFilterChain(
  track: ComposeSequenceAudioTrack,
  sourceDurationSeconds: number,
  effectiveDurationSeconds?: number,
): string {
  const range = resolveEditorAudioSourceRangeMs(track, sourceDurationSeconds);
  const durationSeconds = effectiveDurationSeconds ?? range.durationMs / 1_000;
  const measuredGainDb = Math.min(12, Math.max(-12, track.measuredMatchGainDb ?? 0));
  const measuredGain = Math.pow(10, measuredGainDb / 20);
  return [
    `atrim=start=${formatSeconds(range.sourceInMs / 1_000)}:end=${formatSeconds(range.sourceOutMs / 1_000)}`,
    'asetpts=N/SR/TB',
    ...(Math.abs(measuredGainDb) >= 0.005 ? [`volume=${measuredGain.toFixed(6)}`] : []),
    ...buildEditorAudioPreMixFilters(track.audioProcessing),
    buildSequenceAudioVolumeFilter(track, durationSeconds),
    ...buildEditorAudioPostMixFilters(track.audioProcessing),
  ].join(',');
}

async function resolveNativeSequenceBackend(
  providerSettings: ProviderSettings,
): Promise<NativeRenderExecutionBackend | null> {
  const target = await resolveNativeRenderTarget(providerSettings);
  return target?.backend ?? null;
}

function buildSequenceVisualFilter(
  preparedClip: PreparedSequenceVisualClip,
  canvas: SequenceCanvas,
  frameRate = DEFAULT_SEQUENCE_FRAME_RATE,
  allPreparedClips: PreparedSequenceVisualClip[] = [preparedClip],
): string {
  const { clip, inputIndex, clipDurationSeconds } = preparedClip;
  const filters: string[] = [];

  if (clip.sourceKind === 'video' || clip.sourceKind === 'composition') {
    const sourceRange = resolveVisualClipSourceRangeMs(clip, 0);

    if (sourceRange.sourceInMs > 0) {
      filters.push(`trim=start=${formatSeconds(sourceRange.sourceInMs / 1000)}`);
    }

    if (clip.reversePlayback) {
      filters.push('reverse');
    }

    filters.push(`setpts=(PTS-STARTPTS)/${formatRate(clip.playbackRate)}`);
  } else {
    filters.push('setpts=PTS-STARTPTS');
  }

  filters.push(
    `trim=duration=${formatSeconds(clipDurationSeconds)}`,
    `fps=${formatFrameRate(frameRate)}`,
    'format=rgba',
  );

  const effectDescriptor = buildClipEffectDescriptor({
    sourceKind: clip.sourceKind,
    cropLeftPercent: clip.cropLeftPercent ?? 0,
    cropRightPercent: clip.cropRightPercent ?? 0,
    cropTopPercent: clip.cropTopPercent ?? 0,
    cropBottomPercent: clip.cropBottomPercent ?? 0,
    cropPanXPercent: clip.cropPanXPercent ?? 0,
    cropPanYPercent: clip.cropPanYPercent ?? 0,
    cropRotationDeg: clip.cropRotationDeg ?? 0,
    filterStack: clip.filterStack ?? [],
    blendMode: clip.blendMode,
    chromaKey: clip.chromaKey,
    stroke: clip.stroke,
    masks: clip.professional?.masks,
    stabilization: clip.professional?.stabilization,
  });

  // Apply fit-mode scaling BEFORE the crop so the crop percentages apply to
  // the already-fitted dimensions — matching the stage preview where the crop
  // is a CSS inset on the fitted container rather than a pre-scale source crop.
  if (clip.sourceKind !== 'text') {
    if (clip.fitMode === 'stretch') {
      filters.push(`scale=${canvas.width}:${canvas.height}`);
    } else {
      filters.push(
        `scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=${clip.fitMode === 'cover' ? 'increase' : 'decrease'}`,
      );
    }
  }

  filters.push('setsar=1');

  filters.push(...effectDescriptor.ffmpegFilters);
  if (effectDescriptor.maskExecution.status === 'unsupported') {
    throw new Error(`Video mask cannot be rendered: ${effectDescriptor.maskExecution.reason}`);
  }

  const startScaleFactor = Math.max(MIN_SEQUENCE_VISUAL_SCALE_FACTOR, clip.scalePercent / 100);
  const endScaleFactor = Math.max(
    MIN_SEQUENCE_VISUAL_SCALE_FACTOR,
    (clip.scaleMotionEnabled ? clip.endScalePercent : clip.scalePercent) / 100,
  );
  const hasVisualKeyframes = (clip.keyframes?.length ?? 0) > 0;
  const professionalScaleExpression = compileProfessionalParameterExpression(
    clip.professional?.parameterKeyframes,
    'scale',
    clip.scalePercent,
    { minValue: 1 },
  );

  if (professionalScaleExpression || hasVisualKeyframes || clip.scaleMotionEnabled || clip.scalePercent !== 100 || clip.endScalePercent !== 100) {
    const scaleExpression = professionalScaleExpression
      ? `((${professionalScaleExpression})/100)`
      : hasVisualKeyframes
      ? buildKeyframedValueExpression(
          normalizeVisualKeyframes(clip),
          clipDurationSeconds,
          't',
          (keyframe) => Math.max(MIN_SEQUENCE_VISUAL_SCALE_FACTOR, keyframe.scalePercent / 100).toFixed(4),
        )
      : clip.scaleMotionEnabled
      ? buildInterpolationValueExpression(
          startScaleFactor.toFixed(4),
          endScaleFactor.toFixed(4),
          0,
          clipDurationSeconds,
        )
      : startScaleFactor.toFixed(4);
    const evaluationMode = professionalScaleExpression || hasVisualKeyframes || clip.scaleMotionEnabled ? ':eval=frame' : '';
    filters.push(
      `scale='max(2,trunc(iw*(${scaleExpression})/2)*2)':'max(2,trunc(ih*(${scaleExpression})/2)*2)'${evaluationMode}`,
    );
  }

  if (clip.flipHorizontal) {
    filters.push('hflip');
  }

  if (clip.flipVertical) {
    filters.push('vflip');
  }

  const professionalRotationExpression = compileProfessionalParameterExpression(
    clip.professional?.parameterKeyframes,
    'rotation',
    clip.rotationDeg,
  );
  if (professionalRotationExpression || hasVisualKeyframes || clip.rotationMotionEnabled || clip.rotationDeg !== 0) {
    const startRotationRadians = (clip.rotationDeg * Math.PI / 180).toFixed(6);
    const endRotationRadians = (
      (clip.rotationMotionEnabled ? clip.endRotationDeg : clip.rotationDeg) * Math.PI / 180
    ).toFixed(6);
    const rotationExpression = professionalRotationExpression
      ? `((${professionalRotationExpression})*PI/180)`
      : hasVisualKeyframes
      ? buildKeyframedValueExpression(
          normalizeVisualKeyframes(clip),
          clipDurationSeconds,
          't',
          (keyframe) => (keyframe.rotationDeg * Math.PI / 180).toFixed(6),
        )
      : clip.rotationMotionEnabled
      ? buildInterpolationValueExpression(
          startRotationRadians,
          endRotationRadians,
          0,
          clipDurationSeconds,
        )
      : startRotationRadians;

    filters.push(
      `rotate='${rotationExpression}':c=none:ow=rotw(iw):oh=roth(ih)`,
    );
  }

  const transitionDurationSeconds = Math.min(
    clipDurationSeconds / 2,
    Math.max(0, clip.transitionDurationMs) / 1000,
  );

  const editPointOffsetSeconds = resolveEditPointCrossDissolveOffsetSeconds(preparedClip, allPreparedClips);

  if (clip.transitionIn === 'fade' && transitionDurationSeconds > 0) {
    filters.push(`fade=t=in:st=0:d=${formatSeconds(transitionDurationSeconds)}:alpha=1`);
  }

  if (clip.transitionOut === 'fade' && transitionDurationSeconds > 0) {
    filters.push(
      `fade=t=out:st=${formatSeconds(Math.max(0, clipDurationSeconds - transitionDurationSeconds))}:d=${formatSeconds(transitionDurationSeconds)}:alpha=1`,
    );
  }

  const opacityAutomationPoints = hasVisualKeyframes
    ? visualKeyframesToOpacityAutomation(clip)
    : clip.opacityAutomationPoints;
  const professionalOpacityExpression = compileProfessionalParameterExpression(
    clip.professional?.parameterKeyframes,
    'opacity',
    clip.opacityPercent,
    { minValue: 0, maxValue: 100 },
  );

  if (professionalOpacityExpression || (opacityAutomationPoints?.length ?? 0) > 0 || clip.opacityPercent !== 100) {
    const opacityExpression = professionalOpacityExpression
      ? `((${professionalOpacityExpression})/100)`
      : buildAutomationExpression(
          opacityAutomationPoints,
          clipDurationSeconds,
          clip.opacityPercent,
        );
    filters.push(
      `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${opacityExpression})'`,
    );
  }

  filters.push(`setpts=PTS-STARTPTS+${formatSeconds(Math.max(0, clip.startMs / 1000 - editPointOffsetSeconds))}/TB`);

  return `[${inputIndex}:v]${filters.join(',')}[clip${inputIndex}]`;
}

export function resolveEditPointCrossDissolveOffsetSeconds(
  preparedClip: PreparedSequenceVisualClip,
  allPreparedClips: PreparedSequenceVisualClip[],
): number {
  const transitionDurationSeconds = Math.min(
    preparedClip.clipDurationSeconds / 2,
    Math.max(0, preparedClip.clip.transitionDurationMs) / 1000,
  );

  return preparedClip.clip.transitionIn === 'fade'
    && transitionDurationSeconds > 0
    && allPreparedClips.some((candidate) => {
      if (candidate === preparedClip || candidate.clip.trackIndex !== preparedClip.clip.trackIndex) {
        return false;
      }

      const candidateEndMs = candidate.clip.startMs + candidate.clipDurationSeconds * 1000;
      return candidate.clip.transitionOut === 'fade' && Math.abs(candidateEndMs - preparedClip.clip.startMs) <= 1;
    })
    ? transitionDurationSeconds
    : 0;
}

function buildOverlayOptions(preparedClip: PreparedSequenceVisualClip, editPointOffsetSeconds = 0): string {
  const { clip, clipDurationSeconds } = preparedClip;
  const xExpression = buildOverlayXExpression(clip, clipDurationSeconds, editPointOffsetSeconds);
  const yExpression = buildOverlayYExpression(clip, clipDurationSeconds, editPointOffsetSeconds);

  return `x='${xExpression}':y='${yExpression}':eof_action=pass:eval=frame`;
}

function buildClipCompositeFilters(
  baseLabel: string,
  clipLabel: string,
  outputLabel: string,
  preparedClip: PreparedSequenceVisualClip,
  allPreparedClips: PreparedSequenceVisualClip[],
): string[] {
  const ffmpegBlendMode = mapClipBlendModeToFFmpeg(preparedClip.clip.blendMode);
  const editPointOffsetSeconds = resolveEditPointCrossDissolveOffsetSeconds(preparedClip, allPreparedClips);

  if (!ffmpegBlendMode) {
    return [`[${baseLabel}][${clipLabel}]overlay=${buildOverlayOptions(preparedClip, editPointOffsetSeconds)}[${outputLabel}]`];
  }

  const baseForBlendLabel = `${outputLabel}blendbase`;
  const blankSourceLabel = `${outputLabel}blanksrc`;
  const blankLabel = `clipblank${preparedClip.inputIndex}`;
  const layerLabel = `cliplayer${preparedClip.inputIndex}`;

  return [
    `[${baseLabel}]split=2[${baseForBlendLabel}][${blankSourceLabel}]`,
    `[${blankSourceLabel}]${getBlendNeutralFilter(ffmpegBlendMode)}[${blankLabel}]`,
    `[${blankLabel}][${clipLabel}]overlay=${buildOverlayOptions(preparedClip, editPointOffsetSeconds)}[${layerLabel}]`,
    `[${baseForBlendLabel}][${layerLabel}]blend=all_mode=${ffmpegBlendMode}[${outputLabel}]`,
  ];
}

/**
 * Applies an adjustment clip to the already composited lower-track frame, not to its source
 * pixels. `split` keeps the untouched lower composite alive outside the clip's record span;
 * FFmpeg evaluates the enabled overlay at each output frame, matching the bounded Canvas/monitor
 * path. The runtime planner places adjustment clips on a higher track than the content they own.
 */
export function buildRuntimeAdjustmentCompositeFilter(
  baseLabel: string,
  outputLabel: string,
  preparedClip: PreparedSequenceVisualClip,
): string {
  const descriptor = buildClipEffectDescriptor({
    cropLeftPercent: 0,
    cropRightPercent: 0,
    cropTopPercent: 0,
    cropBottomPercent: 0,
    cropPanXPercent: 0,
    cropPanYPercent: 0,
    cropRotationDeg: 0,
    filterStack: preparedClip.clip.filterStack ?? [],
    blendMode: 'normal',
    chromaKey: { enabled: false, color: '#000000', similarityPercent: 0, blendPercent: 0 },
    stroke: { enabled: false, color: '#000000', widthPx: 0, opacityPercent: 0 },
  });
  const rawLabel = `${outputLabel}raw`;
  const filteredLabel = `${outputLabel}adjusted`;
  const startSeconds = Math.max(0, preparedClip.clip.startMs / 1_000);
  const endSeconds = startSeconds + Math.max(0.001, preparedClip.clipDurationSeconds);
  const filters = descriptor.ffmpegFilters.length > 0
    ? descriptor.ffmpegFilters.join(',')
    : 'null';

  return `[${baseLabel}]split=2[${rawLabel}][${filteredLabel}];`
    + `[${filteredLabel}]${filters}[${filteredLabel}fx];`
    + `[${rawLabel}][${filteredLabel}fx]overlay=0:0:enable='between(t,${formatSeconds(startSeconds)},${formatSeconds(endSeconds)})'[${outputLabel}]`;
}

function getBlendNeutralFilter(ffmpegBlendMode: string): string {
  return ffmpegBlendMode === 'multiply' || ffmpegBlendMode === 'darken' || ffmpegBlendMode === 'colorburn'
    ? 'lutrgb=r=255:g=255:b=255,format=rgba'
    : 'lutrgb=r=0:g=0:b=0,format=rgba';
}

export function resolveSequenceAudioExtension(track: ComposeSequenceAudioTrack): string {
  const mimeType = track.mimeType ?? '';

  if (mimeType.includes('mp4') || track.sourceKind === 'video' || track.sourceKind === 'composition') {
    return 'mp4';
  }

  if (mimeType.includes('wav')) {
    return 'wav';
  }

  if (mimeType.includes('ogg')) {
    return 'ogg';
  }

  return 'mp3';
}

function buildOverlayXExpression(
  clip: ComposeSequenceVisualClip,
  clipDurationSeconds: number,
  editPointOffsetSeconds = 0,
): string {
  const transitionDurationSeconds = Math.min(
    clipDurationSeconds / 2,
    Math.max(0, clip.transitionDurationMs) / 1000,
  );
  const startSeconds = Math.max(0, clip.startMs / 1000 - editPointOffsetSeconds);
  const professionalPositionExpression = compileProfessionalParameterExpression(
    clip.professional?.parameterKeyframes,
    'position-x',
    clip.positionX,
  );
  const centerExpression = professionalPositionExpression
    ? `((W-w)/2+(${offsetProfessionalExpressionTime(professionalPositionExpression, startSeconds)}))`
    : (clip.keyframes?.length ?? 0) > 0
      ? buildKeyframedCenterExpression('W', clip, clipDurationSeconds)
      : buildAnimatedCenterExpression('W', clip.positionX, clip.endPositionX, clip.motionEnabled, startSeconds, clipDurationSeconds);
  let expression = centerExpression;
  const endSeconds = startSeconds + clipDurationSeconds;

  if (transitionDurationSeconds > 0) {
    if (clip.transitionIn === 'slide-left' || clip.transitionIn === 'slide-right') {
      const fromExpression = clip.transitionIn === 'slide-left' ? '-w' : 'W';
      expression = buildTimedInterpolationExpression(
        fromExpression,
        centerExpression,
        startSeconds,
        transitionDurationSeconds,
        expression,
      );
    }

    if (clip.transitionOut === 'slide-left' || clip.transitionOut === 'slide-right') {
      const toExpression = clip.transitionOut === 'slide-left' ? '-w' : 'W';
      expression = `if(gte(t,${formatSeconds(Math.max(0, endSeconds - transitionDurationSeconds))}),${buildInterpolationValueExpression(centerExpression, toExpression, Math.max(0, endSeconds - transitionDurationSeconds), transitionDurationSeconds)},${expression})`;
    }
  }

  return expression;
}

function buildOverlayYExpression(
  clip: ComposeSequenceVisualClip,
  clipDurationSeconds: number,
  editPointOffsetSeconds = 0,
): string {
  const transitionDurationSeconds = Math.min(
    clipDurationSeconds / 2,
    Math.max(0, clip.transitionDurationMs) / 1000,
  );
  const startSeconds = Math.max(0, clip.startMs / 1000 - editPointOffsetSeconds);
  const professionalPositionExpression = compileProfessionalParameterExpression(
    clip.professional?.parameterKeyframes,
    'position-y',
    clip.positionY,
  );
  const centerExpression = professionalPositionExpression
    ? `((H-h)/2+(${offsetProfessionalExpressionTime(professionalPositionExpression, startSeconds)}))`
    : (clip.keyframes?.length ?? 0) > 0
      ? buildKeyframedCenterExpression('H', clip, clipDurationSeconds)
      : buildAnimatedCenterExpression('H', clip.positionY, clip.endPositionY, clip.motionEnabled, startSeconds, clipDurationSeconds);
  let expression = centerExpression;
  const endSeconds = startSeconds + clipDurationSeconds;

  if (transitionDurationSeconds > 0) {
    if (clip.transitionIn === 'slide-up' || clip.transitionIn === 'slide-down') {
      const fromExpression = clip.transitionIn === 'slide-up' ? '-h' : 'H';
      expression = buildTimedInterpolationExpression(
        fromExpression,
        centerExpression,
        startSeconds,
        transitionDurationSeconds,
        expression,
      );
    }

    if (clip.transitionOut === 'slide-up' || clip.transitionOut === 'slide-down') {
      const toExpression = clip.transitionOut === 'slide-up' ? '-h' : 'H';
      expression = `if(gte(t,${formatSeconds(Math.max(0, endSeconds - transitionDurationSeconds))}),${buildInterpolationValueExpression(centerExpression, toExpression, Math.max(0, endSeconds - transitionDurationSeconds), transitionDurationSeconds)},${expression})`;
    }
  }

  return expression;
}

function offsetProfessionalExpressionTime(expression: string, startSeconds: number): string {
  const localTime = `(t-${formatSeconds(startSeconds)})`;
  return expression.replace(/\bt\b/gu, localTime);
}

function buildKeyframedCenterExpression(
  axisSize: 'W' | 'H',
  clip: ComposeSequenceVisualClip,
  clipDurationSeconds: number,
): string {
  const axis = axisSize === 'W' ? 'w' : 'h';
  const startSeconds = clip.startMs / 1000;

  return buildKeyframedValueExpression(
    normalizeVisualKeyframes(clip),
    clipDurationSeconds,
    't',
    (keyframe) => {
      const offset = axisSize === 'W' ? keyframe.positionX : keyframe.positionY;
      return `((${axisSize}-${axis})/2+${Math.round(offset)})`;
    },
    startSeconds,
  );
}

function buildAnimatedCenterExpression(
  axisSize: 'W' | 'H',
  startOffset: number,
  endOffset: number,
  motionEnabled: boolean,
  startSeconds: number,
  clipDurationSeconds: number,
): string {
  const axis = axisSize === 'W' ? 'w' : 'h';
  const startExpression = `((${axisSize}-${axis})/2+${Math.round(startOffset)})`;

  if (!motionEnabled) {
    return startExpression;
  }

  const endExpression = `((${axisSize}-${axis})/2+${Math.round(endOffset)})`;
  return buildInterpolationValueExpression(startExpression, endExpression, startSeconds, clipDurationSeconds);
}

function buildTimedInterpolationExpression(
  fromExpression: string,
  toExpression: string,
  startSeconds: number,
  durationSeconds: number,
  fallbackExpression: string,
): string {
  return `if(lt(t,${formatSeconds(startSeconds + durationSeconds)}),${buildInterpolationValueExpression(fromExpression, toExpression, startSeconds, durationSeconds)},${fallbackExpression})`;
}

function buildKeyframedValueExpression<T extends { timePercent: number }>(
  keyframes: T[],
  durationSeconds: number,
  variableName: string,
  formatValue: (keyframe: T) => string,
  startSeconds = 0,
): string {
  const safeDurationSeconds = Math.max(0.001, durationSeconds);
  const segments = keyframes.map((keyframe) => ({
    timeSeconds: startSeconds + (Math.max(0, Math.min(100, keyframe.timePercent)) / 100) * safeDurationSeconds,
    value: formatValue(keyframe),
  }));

  if (segments.length === 0) {
    return '0';
  }

  let expression = segments[segments.length - 1].value;

  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const start = segments[index];
    const end = segments[index + 1];
    const segmentDuration = Math.max(0.0001, end.timeSeconds - start.timeSeconds);
    const segmentExpression =
      Math.abs(end.timeSeconds - start.timeSeconds) < 0.0001
        ? end.value
        : buildInterpolationValueExpression(start.value, end.value, start.timeSeconds, segmentDuration);

    expression = `if(lte(${variableName},${end.timeSeconds.toFixed(4)}),${segmentExpression},${expression})`;
  }

  return expression;
}

function buildAutomationPercentExpression(
  points: TimelineAutomationPoint[] | undefined,
  durationSeconds: number,
  defaultValuePercent: number,
  variableName: string,
  maxValuePercent: number,
): string {
  return buildKeyframedValueExpression(
    (points ?? [
      { timePercent: 0, valuePercent: defaultValuePercent },
      { timePercent: 100, valuePercent: defaultValuePercent },
    ]).map((point) => ({
      timePercent: point.timePercent,
      valuePercent: Math.max(0, Math.min(maxValuePercent, point.valuePercent)),
    })),
    durationSeconds,
    variableName,
    (point) => (point.valuePercent / 100).toFixed(4),
  );
}

function buildInterpolationValueExpression(
  fromExpression: string,
  toExpression: string,
  startSeconds: number,
  durationSeconds: number,
): string {
  return `(${fromExpression})+((${toExpression})-(${fromExpression}))*min(max((t-${formatSeconds(startSeconds)})/${formatSeconds(durationSeconds)},0),1)`;
}

function formatRate(value: number): string {
  return Math.max(0.25, value || 1).toFixed(4);
}

function formatFrameRate(value: number): string {
  const safeValue = Number.isFinite(value) && value > 0 ? value : DEFAULT_SEQUENCE_FRAME_RATE;
  return Number.isInteger(safeValue) ? String(safeValue) : safeValue.toFixed(3);
}

function formatSeconds(value: number): string {
  return Math.max(0, value).toFixed(3);
}

export async function getMediaDuration(url: string, kind: 'audio' | 'video'): Promise<number> {
  return new Promise((resolve) => {
    const media = document.createElement(kind);
    const cleanup = () => {
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
    };
    media.preload = 'metadata';
    media.src = url;

    media.onloadedmetadata = () => {
      const durationSeconds = Number.isFinite(media.duration) ? media.duration : 0;
      cleanup();
      resolve(durationSeconds);
    };

    media.onerror = () => {
      cleanup();
      resolve(0);
    };
  });
}

/**
 * Renders a text CLIP's title card as a flat PNG for FFmpeg export, via the same
 * `paintTypesetTextBlock` canvas engine `drawTextStageObject`/`drawComicStageObject` use (this used
 * to render an SVG+`foreignObject`+CSS asset instead — see `editorTextRender.ts`'s
 * `buildTextOverlaySvgAsset`, still used for stage-object sizing elsewhere; switching to canvas here
 * gives text clips the same weight/style/leading/tracking/align+justify/stroke/shadow/arc support as
 * comic bubbles and stage text objects, from one shared paint routine). Auto-sized to the text's own
 * content (no forced wrap — only explicit "\n" breaks), matching the free-floating-title-card
 * behavior clips have always had.
 */
export async function renderTextCard({
  text,
  fontFamily,
  fontSizePx,
  color,
  effect,
  opacityPercent,
  typography,
}: {
  text: string;
  fontFamily: string;
  fontSizePx: number;
  color: string;
  effect: 'none' | 'shadow' | 'glow' | 'outline';
  opacityPercent: number;
  typography?: EditorTextTypography;
}): Promise<string> {
  await ensureBundledFontDependenciesReady(managedBundledFontDependenciesForState(
    typography?.managedFace,
    typography?.managedFaceIssue,
  ));
  const resolved = resolveVideoTextCardLayout({ text, fontFamily, fontSizePx, effect, typography });
  const { layout } = resolved;
  const strokeWidthPx = Math.max(0, resolved.typography.strokeWidthPx ?? 0);
  const shadowBlurPx = Math.max(0, resolved.typography.shadowBlurPx ?? 0);
  const shadowOffsetXPx = resolved.typography.shadowOffsetXPx ?? 0;
  const shadowOffsetYPx = resolved.typography.shadowOffsetYPx ?? 0;
  const arcPercent = resolved.typography.arcPercent ?? 0;

  const canvas = document.createElement('canvas');
  canvas.width = resolved.width;
  canvas.height = resolved.height;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to create a text title card for the manual editor.');
  }

  context.globalAlpha = Math.max(0.05, Math.min(1, opacityPercent / 100));
  paintTypesetTextBlock(
    context,
    layout,
    {
      fontFamily: resolved.fontFamily,
      fontSizePx: resolved.fontSizePx,
      fontWeight: resolved.fontWeight,
      fontStyle: resolved.fontStyle,
      managedFace: resolved.typography.managedFace,
      fontKerning: resolved.fontKerning,
      letterSpacingPx: resolved.letterSpacingPx,
      color: color || '#f3f4f6',
      strokeColor: resolved.typography.strokeColor,
      strokeWidthPx,
      shadowColor: resolved.typography.shadowColor,
      shadowBlurPx,
      shadowOffsetXPx,
      shadowOffsetYPx,
      arcPercent,
    },
    { xPx: resolved.paddingPx, yPx: resolved.paddingPx },
  );

  return canvas.toDataURL('image/png');
}

export async function renderShapeCard({
  fillColor,
  borderColor,
  borderWidth,
  cornerRadius,
  opacityPercent,
}: {
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  cornerRadius: number;
  opacityPercent: number;
}): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to create a shape card for the manual editor.');
  }

  const shape = buildShapeLayoutDescriptor({
    width: canvas.width,
    height: canvas.height,
    fillColor: fillColor || '#0ea5e9',
    borderColor: borderColor || '#f8fafc',
    borderWidth,
    cornerRadius,
  });

  context.save();
  void opacityPercent;
  context.beginPath();
  context.roundRect(shape.innerLeft, shape.innerTop, shape.innerWidth, shape.innerHeight, shape.cornerRadius);
  context.fillStyle = shape.fillColor;
  context.fill();

  if (shape.borderWidth > 0) {
    context.lineWidth = shape.borderWidth;
    context.strokeStyle = shape.borderColor;
    context.stroke();
  }

  context.restore();

  return canvas.toDataURL('image/png');
}
