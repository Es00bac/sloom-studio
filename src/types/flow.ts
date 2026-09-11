import type { Edge, Node, NodeProps } from '@xyflow/react';
import type { ManagedBundledFontFaceIssue, ManagedBundledFontFaceReference } from './managedFont';
import type {
  EmbeddedProviderPackSnapshotV1,
  ModelCardLayoutOverrideV1,
  ModelCardRefV1,
} from '../lib/providerPackContracts';
import type {
  EditorAudioClipProfessionalState,
  EditorProfessionalVideoState,
  EditorVisualClipProfessionalState,
} from './videoProfessional';
import type { EditorProfessionalWorkflowState } from './videoProduction';
import type { EditorAudioDuckingSettings } from '../lib/editorAudioDucking';
export type { EditorAudioDuckingSettings } from '../lib/editorAudioDucking';

export const FLOW_NODE_TYPES = [
  'textNode',
  'imageGen',
  'cropImageNode',
  'videoGen',
  'audioGen',
  'transcriptionNode',
  'audioProcessNode',
  'settings',
  'composition',
  'sourceBin',
  'valueNode',
  'list',
  'expander',
  'envelope',
  'virtual',
  'portal',
  'advancedImageEditor',
  'switchNode',
  'forkSwitchNode',
  'runMeNode',
  'packageNode',
  'loopNode',
  'visionVerifyNode',
  'logicNode',
  'conditionalNode',
  'comparisonNode',
  'loopGateNode',
  'loopBreakNode',
  'mathNode',
  'listLengthNode',
  'valueMonitorNode',
  'stringTemplateNode',
  'regexReplaceNode',
  'switchCaseNode',
  'promptsJoinerNode',
  'negativePromptNode',
  'seedSequencerNode',
  'promptMixerNode',
  'storyStateNode',
  'arrayFlatNode',
  'textSentimentAnalysisNode',
  'imageFeatureExtractorNode',
  'fallbackSelectorNode',
  'dialogueScriptSplitterNode',
  'numberNode',
  'colorSwatchNode',
  'colorSwatchListNode',
  'loraSpecNode',
  'slimgNode',
  'doodleNode',
  'groupNode',
  'functionNode',
  'functionInputNode',
  'functionOutputNode',
  'javascriptNode',
  'jsonQueryNode',
  'regexParseNode',
  'pythonNode',
  'jsonBuilderNode',
  'htmlSandboxNode',
  'apiFetchNode',
  'sqlQueryNode',
  'csvParserNode',
  'mathExpressionNode',
  'xmlYamlNode',
] as const;

export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];

export type TextNodeMode = 'prompt' | 'generate';
export type MediaNodeMode = 'generate' | 'import';
export type TextProvider = 'gemini' | 'openai' | 'huggingface';
export type ImageProvider = 'gemini' | 'openai' | 'huggingface' | 'bfl' | 'stability' | 'localOpen' | 'android' | 'atlas' | 'byteplus';
export type VideoProvider = 'gemini' | 'huggingface' | 'atlas';
export type AudioProvider = 'gemini' | 'elevenlabs' | 'huggingface';
export type ColorSwatchUsageMode = 'primary' | 'theme' | 'brand' | 'grade';
export type AudioGenerationMode = 'speech' | 'soundEffect' | 'voiceChange' | 'music';
export type TranscriptionOperation = 'transcribe' | 'align';
export type AudioProcessOperation = 'isolate-voice';
export interface AudioTtsCharacterTiming {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}
export interface AudioTtsWordTiming {
  index: number;
  text: string;
  startCharacterIndex: number;
  /** Exclusive character index. */
  endCharacterIndex: number;
  startMs: number;
  endMs: number;
}
/** Credential-free, bounded timing metadata returned by opt-in TTS-with-timestamps runs. */
export interface AudioTtsTimingMetadata {
  version: 1;
  provider: 'elevenlabs';
  alignmentSource: 'alignment' | 'normalized_alignment';
  text: string;
  textMatchesPrompt: boolean;
  durationMs: number;
  characters: AudioTtsCharacterTiming[];
  words: AudioTtsWordTiming[];
}
export type AspectRatio =
  | '1:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9';
export type VideoResolution = '720p' | '1080p' | '4k';
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp';
export type AudioOutputFormat = 'mp3_48000_192' | 'mp3_44100_128' | 'mp3_44100_64' | 'pcm_44100';
export type ResultType = 'text' | 'number' | 'boolean' | 'json' | 'image' | 'video' | 'audio' | 'package' | 'list' | 'envelope';
export const FUNCTION_NODE_SCHEMA_VERSION = 1 as const;
export type DynamicValue = string | number | boolean | null | Record<string, unknown> | unknown[];
export type FunctionBindingSourceMode = 'flow' | 'constant' | 'expression';
export type FunctionValueKind = ResultType | 'any';
export type FunctionExpressionLanguage = 'mustache' | 'jsonata' | 'javascript';
export type FunctionMissingStrategy = 'default' | 'null' | 'error' | 'skip';
export type TransformKind =
  | 'identity'
  | 'set'
  | 'defaultValue'
  | 'trim'
  | 'toText'
  | 'toNumber'
  | 'toBoolean'
  | 'toJson'
  | 'coalesce'
  | 'prefix'
  | 'suffix'
  | 'replace'
  | 'regexReplace'
  | 'slice'
  | 'split'
  | 'join'
  | 'take'
  | 'drop'
  | 'append'
  | 'prepend'
  | 'template'
  | 'case'
  | 'ifEmpty'
  | 'jsonPath'
  | 'pick'
  | 'map'
  | 'filter';
export type ListLoopMode = 'paired' | 'allCombinations';
export type SerializableNodeValue = unknown;
export type VideoFrameSelection = 'first' | 'last';
export type VideoReferenceType = 'asset' | 'style';
export type RenderBackendPreference =
  | 'auto'
  | 'browser'
  | 'native-cpu'
  | 'native-amd-vaapi'
  | 'native-nvidia-nvenc'
  | 'native-intel-qsv';
/**
 * Which compositor draws export frames. `stage` (the default) steps the SAME layout/effect math
 * the Edit Stage preview uses (`buildVisualClipLayoutDescriptor` et al.) through a canvas, one frame
 * at a time, so what you see on the stage is what renders. `legacy` keeps the pre-existing ffmpeg
 * `filter_complex` translation (`mediaComposition.ts`'s `buildSequenceCommand`) as a fallback — see
 * docs/gpu-frame-server-export-brief.md for why `stage` exists at all.
 */
export type ExportCompositorPreference = 'stage' | 'legacy';
export type VideoExportPresetId =
  | 'review-h264-1080p'
  | 'social-vertical-h264'
  | 'archive-high-quality'
  | 'webm-vp9-opus'
  | 'webm-vp9-alpha'
  | 'gif-preview'
  | 'prores-mov'
  | 'hevc-h265-mp4'
  | 'hevc-h265-mov'
  | 'broadcast-mxf'
  | 'png-image-sequence'
  | 'jpeg-image-sequence';
export type VideoExportPresetPlanId = VideoExportPresetId;
export type GeminiThinkingLevel = 'default' | 'minimal' | 'low' | 'medium' | 'high';
export type GeminiMediaResolution = 'default' | 'low' | 'medium' | 'high' | 'ultraHigh';
export type GeminiCredentialMode = 'api-key' | 'vertex-adc';
export type VertexAuthMode = 'gcloud-user' | 'gcloud-adc';
export type PaperPrintUpscaleMethod =
  | 'auto'
  | 'local-browser'
  | 'stability-fast'
  | 'stability-conservative'
  | 'vertex-imagen'
  | 'android-accelerator'
  | 'local-ai-cpu';
export type PaperPdfRasterPreset = 'print-png' | 'balanced-jpeg' | 'proof-jpeg';
export type TextOutputFormat = 'plain' | 'json';
export type ImageTargetHandle =
  | 'image'
  | 'refImage'
  | 'sourceImage'
  | 'mask'
  | 'reference'
  | 'image-edit-source'
  | 'image-mask'
  | 'image-reference-1'
  | 'image-reference-2'
  | 'image-reference-3'
  | 'image-reference-4'
  | 'image-reference-5'
  | 'image-reference-6'
  | 'image-reference-7'
  | 'image-reference-8'
  | 'image-reference-9'
  | 'image-reference-10'
  | 'image-reference-11'
  | 'image-reference-12'
  | 'image-reference-13'
  | 'image-reference-14';
export type VideoTargetHandle =
  | 'video-prompt'
  | 'video-start-frame'
  | 'video-end-frame'
  | 'video-reference-1'
  | 'video-reference-2'
  | 'video-reference-3'
  | 'video-source-video';
export type CompositionTargetHandle =
  | 'composition-video'
  | 'composition-audio-1'
  | 'composition-audio-2'
  | 'composition-audio-3'
  | 'composition-audio-4';
export type ListTargetHandle = `list-item-${number}`;
export type CompositionAudioMigrationWarningReason = 'overflow' | 'malformed';
export interface CompositionAudioMigrationWarning {
  handle: string;
  reason: CompositionAudioMigrationWarningReason;
  message: string;
}
export type Capability = 'text' | 'image' | 'video' | 'audio';
export type UsageTelemetrySource = 'estimate' | 'actual';
export type UsageTelemetryConfidence = 'measured' | 'heuristic' | 'fixed' | 'unknown';
export type WorkspaceView = 'flow' | 'editor' | 'image' | 'paper';
export type EditorSourceKind = 'text' | 'image' | 'video' | 'audio' | 'composition' | 'document' | 'subtitle' | 'package';
export type EditorVisualSourceKind = 'text' | 'shape' | 'image' | 'video' | 'composition' | 'comic';
/** Timeline track role. `overlay` tracks are reserved for text/comic clips that composite on top of
 *  the standard media tracks; `standard` tracks carry the regular image/video/composition clips. */
export type EditorVisualTrackKind = 'standard' | 'overlay';
export type VisualClipTransition = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down';
export type EditorVisualFitMode = 'contain' | 'cover' | 'stretch';
export type TextClipEffect = 'none' | 'shadow' | 'glow' | 'outline';
export type EditorAssetKind = 'text' | 'shape' | 'image' | 'comic';
export type EditorShapeKind = 'rectangle';
export type EditorClipFilterKind =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'blur'
  | 'grayscale'
  | 'sepia'
  | 'invert'
  | 'hue-rotate';
export type EditorStageObjectKind = 'text' | 'rectangle' | 'speech-bubble' | 'thought-bubble' | 'caption';
/**
 * Video stage/clip blend modes — widened to the full 16-mode Photoshop/canvas set to match the
 * Image editor's `BlendMode` (src/types/imageEditor.ts). CSS mix-blend-mode names map 1:1; the
 * FFmpeg `blend=` names map 1:1 for the separable modes, while the four non-separable HSL modes
 * (hue/saturation/color/luminosity) have no FFmpeg blend equivalent and fall back to normal on export.
 */
export type EditorStageBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface FunctionPortKind {
  id: string;
  key: string;
  label: string;
  description?: string;
  resultType: FunctionValueKind;
  required: boolean;
  defaultValue?: DynamicValue;
  allowMultiple?: boolean;
  order: number;
}

export interface FunctionContract {
  id: string;
  title: string;
  description?: string;
  inputPorts: FunctionPortKind[];
  outputPorts: FunctionPortKind[];
  version: 1;
}

export interface FunctionFlowSource {
  mode: 'flow';
  sourceType: 'nodeOutput' | 'nodeInput';
  sourceNodeId?: string;
  sourceHandle?: string;
  sourceVariable?: string;
}

export interface FunctionConstantSource {
  mode: 'constant';
  valueType: ResultType | 'json' | 'boolean' | 'number' | 'string' | 'null';
  value: DynamicValue;
}

export interface FunctionExpressionSource {
  mode: 'expression';
  language: FunctionExpressionLanguage;
  expression: string;
}

export type FunctionBindingSource = FunctionFlowSource | FunctionConstantSource | FunctionExpressionSource;

export interface FunctionTransformStepBase {
  id: string;
  kind: TransformKind;
  label?: string;
}

export interface FunctionTransformDefaultValue extends FunctionTransformStepBase {
  kind: 'defaultValue';
  value: DynamicValue;
}

export interface FunctionTransformPrefixSuffix extends FunctionTransformStepBase {
  kind: 'prefix' | 'suffix' | 'prepend' | 'append';
  text: string;
}

export interface FunctionTransformReplace extends FunctionTransformStepBase {
  kind: 'replace';
  find: string;
  replacement: string;
}

export interface FunctionTransformRegexReplace extends FunctionTransformStepBase {
  kind: 'regexReplace';
  pattern: string;
  replacement: string;
  flags?: string;
}

export interface FunctionTransformJsonPath extends FunctionTransformStepBase {
  kind: 'jsonPath';
  path: string;
  fallback?: DynamicValue;
}

export interface FunctionTransformCase extends FunctionTransformStepBase {
  kind: 'case';
  when: 'lower' | 'upper' | 'title' | 'camel' | 'pascal' | 'kebab' | 'snake';
}

export interface FunctionTransformJsonParse extends FunctionTransformStepBase {
  kind: 'toJson';
}

export interface FunctionTransformIfEmpty extends FunctionTransformStepBase {
  kind: 'ifEmpty';
  fallback: DynamicValue;
}

export interface FunctionTransformTemplate extends FunctionTransformStepBase {
  kind: 'template';
  template: string;
}

export interface FunctionTransformTakeDrop extends FunctionTransformStepBase {
  kind: 'take' | 'drop';
  count: number;
}

export interface FunctionTransformSet extends FunctionTransformStepBase {
  kind: 'set';
  sourcePath: string;
}

export type FunctionTransformStep =
  | FunctionTransformStepBase
  | FunctionTransformDefaultValue
  | FunctionTransformPrefixSuffix
  | FunctionTransformReplace
  | FunctionTransformRegexReplace
  | FunctionTransformJsonPath
  | FunctionTransformCase
  | FunctionTransformJsonParse
  | FunctionTransformIfEmpty
  | FunctionTransformTemplate
  | FunctionTransformTakeDrop
  | FunctionTransformSet;

export interface FunctionInputBinding {
  id: string;
  targetInputPortId: string;
  source: FunctionBindingSource;
  transforms: FunctionTransformStep[];
  resultType: FunctionValueKind;
  missing: {
    strategy: FunctionMissingStrategy;
    value?: DynamicValue;
  };
}

export interface FunctionOutputBinding {
  id: string;
  targetOutputPortId: string;
  sourceNodeId: string;
  sourceHandle?: string;
  expression?: string;
  transforms: FunctionTransformStep[];
  resultType: FunctionValueKind;
  missing: {
    strategy: FunctionMissingStrategy;
    value?: DynamicValue;
  };
}

export interface FunctionBoundaryLink {
  id: string;
  edgeId: string;
  portId: string;
  internalNodeId: string;
  internalHandle?: string;
  externalNodeId?: string;
  externalHandle?: string;
}

export interface PersistedFunctionNodeGraph {
  version: 1;
  nodes: Array<Pick<Node, 'id' | 'type' | 'position' | 'data'> & { data: Record<string, unknown> }>;
  edges: Edge[];
  inputBoundaryLinks?: FunctionBoundaryLink[];
  outputBoundaryLinks?: FunctionBoundaryLink[];
  bounds?: { x: number; y: number; width: number; height: number };
  viewport?: { x: number; y: number; zoom: number };
}

export interface FunctionNodeConfig {
  schemaVersion: typeof FUNCTION_NODE_SCHEMA_VERSION;
  title: string;
  description?: string;
  contract: FunctionContract;
  graph: PersistedFunctionNodeGraph;
  inputBindings: FunctionInputBinding[];
  outputBindings: FunctionOutputBinding[];
  tags?: string[];
  isLocked?: boolean;
  lastRunRuntime?: {
    result: 'success' | 'partial' | 'error' | 'idle';
    lastRunAt: number;
    nodeCount: number;
    edgeCount: number;
  };
}

export interface GroupNodeConfig {
  title: string;
  description?: string;
  childNodeIds: string[];
  childEdgeIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
  collapsed: boolean;
  color?: string;
}

export interface TimelineAutomationPoint {
  timePercent: number;
  valuePercent: number;
}

export interface EditorVisualKeyframe {
  timePercent: number;
  positionX: number;
  positionY: number;
  scalePercent: number;
  rotationDeg: number;
  opacityPercent: number;
  /**
   * Optional comic-bubble tail channels. When present they animate the bubble's tail tip position
   * (0–100% of the bubble frame, origin top-left, center = 50/50) and funnel curvature (0–100,
   * 50 = straight) independently of the bubble body's position/scale/rotation/opacity. Omitted on
   * non-comic clips and on comic clips with a static tail — resolution then falls back to the clip's
   * static bezier tail (the comicTailTip / comicTailCurvePercent clip fields) and finally to sane
   * painter defaults.
   */
  tailTipXPercent?: number;
  tailTipYPercent?: number;
  tailCurvePercent?: number;
}

export interface EditorAudioKeyframe {
  timePercent: number;
  volumePercent: number;
}

export interface EditorClipFilter {
  id: string;
  kind: EditorClipFilterKind;
  amount: number;
  enabled: boolean;
}

export interface EditorClipChromaKeySettings {
  enabled: boolean;
  color: string;
  similarityPercent: number;
  blendPercent: number;
}

export interface EditorClipStrokeSettings {
  enabled: boolean;
  color: string;
  widthPx: number;
  opacityPercent: number;
}

export interface EditorTextDefaults {
  text: string;
  fontFamily: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  managedFace?: ManagedBundledFontFaceReference;
  managedFaceIssue?: ManagedBundledFontFaceIssue;
  fontSizePx: number;
  color: string;
  textEffect: TextClipEffect;
  textBackgroundOpacityPercent: number;
}

/**
 * Rich typesetting for Video text & comic clips — a px/percent-unit subset of Paper's
 * `PaperTypography` (src/types/paper.ts, which uses mm/pt). Carried by both text AND comic clips via
 * `EditorVisualClip.textTypography` so they share Paper-grade type controls (weight, style, leading,
 * tracking, alignment, stroke, drop shadow, arc) on the Video program stage.
 */
export interface EditorTextTypography {
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  managedFace?: ManagedBundledFontFaceReference;
  managedFaceIssue?: ManagedBundledFontFaceIssue;
  fontKerning?: 'auto' | 'normal' | 'none';
  lineHeightPercent?: number;
  letterSpacingPx?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  strokeColor?: string;
  strokeWidthPx?: number;
  shadowColor?: string;
  shadowBlurPx?: number;
  shadowOffsetXPx?: number;
  shadowOffsetYPx?: number;
  arcPercent?: number;
}

export interface EditorShapeDefaults {
  shape: EditorShapeKind;
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  cornerRadius: number;
}

export interface EditorComicDefaults {
  comicKind: 'speech-bubble' | 'thought-bubble' | 'caption';
  text: string;
  fontFamily: string;
  fontSizePx: number;
  textColor: string;
  fillColor: string;
  strokeColor: string;
  strokeWidthPx: number;
  tailAngleDeg: number;
  tailLengthPx: number;
  lineHeightPercent: number;
  letterSpacingPx: number;
  textAlign: 'left' | 'center' | 'right';
}

export interface EditorAsset {
  id: string;
  kind: EditorAssetKind;
  label: string;
  createdAt: number;
  updatedAt: number;
  imageSourceId?: string;
  textDefaults?: EditorTextDefaults;
  shapeDefaults?: EditorShapeDefaults;
  comicDefaults?: EditorComicDefaults;
}

export interface EditorVisualClip {
  id: string;
  sourceNodeId: string;
  sourceKind: EditorVisualSourceKind;
  trackIndex: number;
  startMs: number;
  sourceInMs: number;
  sourceOutMs?: number;
  durationSeconds?: number;
  trimStartMs: number;
  trimEndMs: number;
  playbackRate: number;
  reversePlayback: boolean;
  fitMode: EditorVisualFitMode;
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
  blendMode?: EditorStageBlendMode;
  chromaKey?: EditorClipChromaKeySettings;
  stroke?: EditorClipStrokeSettings;
  transitionIn: VisualClipTransition;
  transitionOut: VisualClipTransition;
  transitionDurationMs: number;
  textContent?: string;
  textFontFamily: string;
  textSizePx: number;
  textColor: string;
  textEffect: TextClipEffect;
  textBackgroundOpacityPercent: number;
  /** Paper-grade typesetting shared by text AND comic clips (weight/style/leading/tracking/align/
   *  stroke/shadow/arc). Optional; when unset the clip falls back to the flat text* fields. */
  textTypography?: EditorTextTypography;
  shapeFillColor?: string;
  shapeBorderColor?: string;
  shapeBorderWidth?: number;
  shapeCornerRadius?: number;
  /** Motion-comic clips (sourceKind 'comic'): bubble/caption variant + comic typesetting.
   *  Text content/font/size/color reuse the text* fields; fill/stroke reuse shape* fields. */
  comicKind?: 'speech-bubble' | 'thought-bubble' | 'caption';
  comicTailAngleDeg?: number;
  comicTailLengthPx?: number;
  /** Bezier tail model mirroring Paper's speech bubbles (see src/types/paper.ts tailXPercent/
   *  tailYPercent/bubbleTailCurvePercent and src/lib/paperBubblePaths.ts): the tail tip position as a
   *  percent of the bubble frame (0–100, origin top-left, center = 50/50) and funnel curvature
   *  (0–100, 50 = straight). Supersedes the legacy polar comicTailAngleDeg/comicTailLengthPx, which
   *  are kept for back-compat and auto-migrated (manualEditorState) to these tip fields on read. Each
   *  can be keyframed independently of the bubble body via the EditorVisualKeyframe tail channels. */
  comicTailTipXPercent?: number;
  comicTailTipYPercent?: number;
  comicTailCurvePercent?: number;
  comicLineHeightPercent?: number;
  comicLetterSpacingPx?: number;
  comicTextAlign?: 'left' | 'center' | 'right';
  /** Additive professional-NLE decisions. Omitted by legacy projects. */
  professional?: EditorVisualClipProfessionalState;
}

export interface EditorAudioClip {
  id: string;
  sourceNodeId: string;
  offsetMs: number;
  /** Inclusive source-media start and exclusive source-media end. Omitted means the full source. */
  sourceInMs?: number;
  sourceOutMs?: number;
  trackIndex: number;
  volumePercent: number;
  volumeAutomationPoints?: TimelineAutomationPoint[];
  volumeKeyframes?: EditorAudioKeyframe[];
  /** Measured speech-level correction, kept separate from the user's creative volume envelope. */
  measuredMatchGainDb?: number;
  /** Original clip used as the reference for measured speech-level matching. */
  loudnessReferenceClipId?: string;
  loudnessReferenceSourceNodeId?: string;
  loudnessReferenceSourceInMs?: number;
  loudnessReferenceSourceOutMs?: number;
  speechLevelMatchMeasurement?: {
    method: 'active-rms-v1';
    measuredAt: number;
    referenceClipId?: string;
    referenceSourceNodeId: string;
    targetSourceNodeId: string;
    referenceSourceInMs: number;
    referenceSourceOutMs: number;
    targetSourceInMs: number;
    targetSourceOutMs: number;
    originalActiveRmsDbfs: number;
    cleanActiveRmsDbfs: number;
    cleanSamplePeakDbfs: number;
    gainDb: number;
    activeDurationSeconds: number;
    peakLimited: boolean;
  };
  audioProcessing?: EditorAudioProcessingSettings;
  /** Optional native side-chain ducking against another persisted audio clip. */
  audioDucking?: EditorAudioDuckingSettings;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  enabled: boolean;
  /** Additive professional mixer/linking decisions. Omitted by legacy projects. */
  professional?: EditorAudioClipProfessionalState;
}

export interface EditorAudioProcessingSettings {
  /** Master DSP bypass; source trim, speech-match gain, creative volume/fades, and mute/solo remain active. */
  processingEnabled: boolean;
  highPassEnabled: boolean;
  highPassHz: number;
  lowPassEnabled: boolean;
  lowPassHz: number;
  gateEnabled: boolean;
  gateThresholdDbfs: number;
  gateRangeDb: number;
  gateRatio: number;
  gateAttackMs: number;
  gateReleaseMs: number;
  compressorEnabled: boolean;
  compressorThresholdDbfs: number;
  compressorRatio: number;
  compressorAttackMs: number;
  compressorReleaseMs: number;
  compressorMakeupGainDb: number;
  limiterEnabled: boolean;
  limiterCeilingDbfs: number;
  limiterReleaseMs: number;
}

interface EditorStageObjectBase {
  id: string;
  kind: EditorStageObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  opacityPercent: number;
  blendMode: EditorStageBlendMode;
}

export interface EditorTextStageObject extends EditorStageObjectBase {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic' | 'oblique';
  managedFace?: ManagedBundledFontFaceReference;
  managedFaceIssue?: ManagedBundledFontFaceIssue;
  fontSizePx: number;
  color: string;
}

export interface EditorRectangleStageObject extends EditorStageObjectBase {
  kind: 'rectangle';
  fillColor: string;
  borderColor: string;
  borderWidth: number;
  cornerRadius: number;
}

/**
 * Motion-comic stage objects (speech/thought bubbles + caption boxes) — the Paper vocabulary,
 * live on the Video program stage: placeable, keyframable like any stage object, with comic
 * typesetting (font, line height, letter spacing, alignment) and a draggable tail.
 */
export interface EditorComicStageObject extends EditorStageObjectBase {
  kind: 'speech-bubble' | 'thought-bubble' | 'caption';
  text: string;
  fontFamily: string;
  fontSizePx: number;
  textColor: string;
  fillColor: string;
  strokeColor: string;
  strokeWidthPx: number;
  /** Tail direction (degrees, 0 = right, 90 = down) and length; captions ignore both. */
  tailAngleDeg: number;
  tailLengthPx: number;
  lineHeightPercent: number;
  letterSpacingPx: number;
  textAlign: 'left' | 'center' | 'right';
}

export type EditorStageObject = EditorTextStageObject | EditorRectangleStageObject | EditorComicStageObject;

export interface UsageTelemetry {
  source: UsageTelemetrySource;
  confidence: UsageTelemetryConfidence;
  provider?: string;
  modelId?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  characters?: number;
  durationSeconds?: number;
  imageCount?: number;
  notes?: string[];
}

/** A named result exposed by a collapsed reusable Function.  Unlike `result`, this
 * preserves the declared output-handle identity so two outputs cannot alias the
 * first completed value. */
export interface NodeOutputArtifact {
  result: ResultValue;
  resultType: ResultType;
  /** Optional Source Bin/editor identity when the value is also a reusable asset. */
  assetKind?: EditorSourceKind;
  sourceBinItemId?: string;
  /** Runtime-only bytes used while publishing media/document outputs to Source Bin. */
  blob?: Blob;
  mimeType?: string;
  extension?: string;
  fileName?: string;
  outputMetadata?: Record<string, unknown>;
  additionalResults?: Array<{ result: string; mimeType?: string }>;
}

/** Backwards-compatible name retained for reusable Function contracts. */
export type FunctionNodeOutput = NodeOutputArtifact;

export interface VideoExportPresetPlanData {
  presetId: VideoExportPresetId;
  notes?: string;
}

/**
 * The value retained at node, history, and project boundaries. Containers
 * deliberately use string payloads, but scalar Boolean ports retain a real
 * Boolean so `false` cannot be lost to string/truthiness checks.
 */
export type ResultValue = string | boolean;

export interface NodeResultAttempt {
  id: string;
  /** The typed value emitted by a node. Media and text results are strings; Boolean ports retain booleans. */
  result: ResultValue;
  resultType: ResultType;
  statusMessage: string;
  createdAt: string;
  usage?: UsageTelemetry;
  /** Output descriptors travel with each run so selecting an older media result restores its export details. */
  mimeType?: string;
  extension?: string;
  fileName?: string;
  outputMetadata?: Record<string, unknown>;
  variableName?: string;
  /**
   * The source-bin item id backing this attempt's asset, when the result was stored in the source bin.
   * `result` is a phone-local asset URL that a served browser can't fetch; this stable id lets the
   * served second screen re-resolve the bytes by item id (the universal `/source-asset/:id` path).
   */
  sourceBinItemId?: string;
}

export interface EnvelopeItem {
  id: string;
  index: number;
  kind: ResultType;
  label: string;
  value: string;
  mimeType?: string;
  sourceBinItemId?: string;
  sourceNodeId?: string;
  usage?: UsageTelemetry;
  text?: string;
  invalidReason?: string;
}

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface VoiceOption extends SelectOption {
  previewUrl?: string;
  category?: string;
}

export interface CapabilityProviderMap {
  text: TextProvider;
  image: ImageProvider;
  video: VideoProvider;
  audio: AudioProvider;
}

export type ProviderForCapability<TCapability extends Capability> = CapabilityProviderMap[TCapability];

export type ModelCatalog = {
  [TCapability in Capability]: Record<ProviderForCapability<TCapability>, SelectOption[]>;
};

export interface ApiKeys {
  openai: string;
  gemini: string;
  huggingface: string;
  elevenlabs: string;
  bfl?: string;
  stability?: string;
  atlas?: string;
  byteplus?: string;
}

export interface ProviderSettings {
  openaiBaseUrl: string;
  elevenlabsVoiceId: string;
  renderBackendPreference: RenderBackendPreference;
  exportCompositorPreference: ExportCompositorPreference;
  localNativeRenderUrl: string;
  localNativeRenderToken?: string;
  backendProxyEnabled: boolean;
  backendProxyBaseUrl: string;
  geminiCredentialMode: GeminiCredentialMode;
  vertexAuthMode: VertexAuthMode;
  vertexProjectId: string;
  vertexLocation: string;
  vertexQuotaProjectId: string;
  vertexEnvironmentVariables: string;
  vertexServiceAccountJson: string;
  paperPrintUpscaleMethod: PaperPrintUpscaleMethod;
  paperPdfRasterPreset: PaperPdfRasterPreset;
  localOpenImageEndpointUrl?: string;
  localOpenImageAuthHeader?: string;
  localOpenImageDefaultModel?: string;
  genericImageEndpointUrl?: string;
  genericImageAuthHeader?: string;
  localAiCpuEndpointUrl?: string;
  localAiCpuAuthHeader?: string;
  localAiCpuModel?: string;
  atlasBaseUrl?: string;
  bytePlusBaseUrl?: string;
  androidAcceleratorBaseUrl?: string;
  androidAcceleratorAuthToken?: string;
  androidAcceleratorDefaultUpscaler?: string;
  androidAcceleratorDefaultImageModel?: string;
  batchMaxRetries: number;
  batchRetryBaseDelayMs: number;
  androidLanServerEnabled: boolean;
  androidLanServerPin: string;
}

export interface VertexNativeAuthConfig {
  mode: VertexAuthMode;
  quotaProjectId?: string;
  environmentVariables?: string;
  /** Encrypted-at-rest imported ADC JSON, passed only to the native in-app auth broker at request time. */
  credentialJson?: string;
}

export interface DefaultModelSettings {
  text: Record<TextProvider, string>;
  image: Record<ImageProvider, string>;
  video: Record<VideoProvider, string>;
  audio: Record<AudioProvider, string>;
}

export interface RuntimeSettingsSnapshot {
  apiKeys: ApiKeys;
  defaultModels: DefaultModelSettings;
  providerSettings: ProviderSettings;
}

export interface ExecutionConfig {
  aspectRatio: AspectRatio;
  steps: number;
  durationSeconds: number;
  videoResolution: VideoResolution;
  videoFrameRate: number;
  imageOutputFormat: ImageOutputFormat;
  audioOutputFormat: AudioOutputFormat;
}

export interface VideoRenderAssemblyManifestData {
  version: 1;
  kind: 'video-render-segment-assembly';
  mode: 'safe-artifact-assembly' | 'planning-only';
  summary?: string;
  caveat?: string;
  segments: Array<{
    key: string;
    startMs: number;
    endMs: number;
    activeClipIds: string[];
    signature: string;
    action: 'reuse-cached-segment' | 'render-dirty-span';
    cachedUrl?: string;
    reason?: string;
  }>;
}

export interface VideoRenderAssemblyResultData {
  assembledFromSegments: boolean;
  assemblyUnavailableReason?: string;
}

export interface NodeData {
  [key: string]: unknown;
  onChange?: (key: string, value: SerializableNodeValue) => void;
  onRun?: () => void;
  onSelectAttempt?: (attemptId: string) => void;
  isRunning?: boolean;
  retryState?: { attempt: number; max: number; nextAttemptAt: number };
  error?: string;
  statusMessage?: string;
  collapsed?: boolean;
  customTitle?: string;
  /**
   * Immutable identity token for this node instance. New nodes get a fresh token;
   * duplicate workspaces clone it, but recreating a deleted node with the same id
   * yields a different token so stale async completions can be rejected.
   */
  nodeInstanceId?: string;
  /**
   * Revision of execution-relevant inputs. Bumped when non-runtime node data changes
   * so a run started with one input revision can be rejected after the inputs change.
   */
  inputRevision?: string;
  /** The typed value emitted by a node. Media and text results are strings; Boolean ports retain booleans. */
  result?: ResultValue;
  resultType?: ResultType;
  declaredOutputType?: ResultType;
  resultHistory?: NodeResultAttempt[];
  selectedResultId?: string;
  usage?: UsageTelemetry;
  flowVariableName?: string;
  envelopeItems?: EnvelopeItem[];
  envelopeItemKind?: ResultType | 'mixed';
  expandedItemIndex?: number;
  listLoopMode?: ListLoopMode;
  valueKind?: 'text' | 'number' | 'boolean' | 'json';
  value?: DynamicValue;
  colorSwatchColors?: string[];
  colorSwatchDraftColor?: string;
  doodleSketch?: string;
  doodleDescription?: string;
  imageFeatures?: {
    width: number;
    height: number;
    aspectRatio?: number;
    orientation?: 'square' | 'landscape' | 'portrait';
    averageColor?: string;
    mimeType?: string;
    samplingWarning?: string;
  };
  colorSwatchSelectedIndex?: number;
  colorSwatchUsageMode?: ColorSwatchUsageMode;
  /** Color Swatch node: per-entry labels keyed by `${sourcePaletteNodeId}:${sourceHandleId}`. */
  colorSwatchEntryLabels?: Record<string, string>;
  /** LoRA Spec node: up to 3 `{ path, scale }` weights for FLUX LoRA models. */
  loraEntries?: Array<{ path: string; scale: number }>;
  /** .slimg node: path of the .slimg file it last saved / imported / read from disk. */
  slimgFilePath?: string;
  loopBreakReason?: string;
  prompt?: string;
  systemPrompt?: string;
  mode?: TextNodeMode | string;
  mediaMode?: MediaNodeMode;
  provider?: TextProvider | ImageProvider | VideoProvider | AudioProvider;
  modelId?: string;
  /** Portable provider-pack identity pinned by exact content hash. */
  modelCardRef?: ModelCardRefV1;
  /** Active adaptive operation within one portable model card. */
  modelCardOperationId?: string;
  /** Values keyed only by immutable ModelFieldV1 ids. */
  modelCardValues?: Record<string, unknown>;
  /** Presentation-only node-instance layout override. */
  modelCardLayoutOverride?: ModelCardLayoutOverrideV1;
  /** Optional credential-free pack snapshots carried by a portable project boundary. */
  embeddedProviderPackSnapshots?: EmbeddedProviderPackSnapshotV1[];
  aspectRatio?: AspectRatio;
  steps?: number;
  durationSeconds?: number;
  videoResolution?: VideoResolution;
  videoFrameRate?: number;
  imageOutputFormat?: ImageOutputFormat;
  imageOperation?: string;
  imageAutoUpscale?: boolean;
  imageSearchPrompt?: string;
  imageExactColor?: string;
  imageTextEditPrompt?: string;
  imageSeed?: number;
  imageGuidanceScale?: number;
  imageEditStrength?: number;
  /** Optional custom output size (px) for models that accept an arbitrary `size`; overrides the aspect-ratio preset when both are set. */
  imageWidth?: number;
  imageHeight?: number;
  /** Negative prompt for models whose Atlas schema accepts `negative_prompt` (qwen, wan, imagen, …). */
  imageNegativePrompt?: string;
  /** Per-model documented input parameters (resolution, quality, n, thinking_mode, …) keyed by schema field name. */
  atlasParams?: Record<string, string | number | boolean>;
  imageLoraWeightsJson?: string;
  imageSafetyCheckerEnabled?: boolean;
  imageOutpaintLeft?: number;
  imageOutpaintRight?: number;
  imageOutpaintUp?: number;
  imageOutpaintDown?: number;
  imageCreativity?: number;
  imagePaintedMaskDataUrl?: string;
  imagePaintedMaskUpdatedAt?: number;
  imageMaskBrushSize?: number;
  cropXPercent?: number;
  cropYPercent?: number;
  cropWidthPercent?: number;
  cropHeightPercent?: number;
  /** GPT-image quality tier; 'auto' (default) lets the provider pick. */
  imageQuality?: 'low' | 'medium' | 'high' | 'auto';
  /** Gemini 3.x image output resolution (image_size); unset = provider default (1K). */
  imageResolutionTier?: '1K' | '2K' | '4K';
  audioOutputFormat?: AudioOutputFormat;
  voiceId?: string;
  geminiVoiceName?: string;
  audioStyleDescription?: string;
  audioGenerationMode?: AudioGenerationMode;
  /** Opts ElevenLabs speech generation into its JSON TTS-with-timestamps endpoint. */
  audioTtsWithTimestamps?: boolean;
  audioSeed?: number;
  /** ElevenLabs voice_settings — sent only when the user sets a value (provider default otherwise). */
  audioStability?: number;
  audioSimilarityBoost?: number;
  audioStyleExaggeration?: number;
  audioSpeed?: number;
  audioLoop?: boolean;
  audioDurationSeconds?: number;
  audioPromptInfluence?: number;
  audioRemoveBackgroundNoise?: boolean;
  audioForceInstrumental?: boolean;
  transcriptionModelId?: 'scribe_v2';
  transcriptionOperation?: TranscriptionOperation;
  transcriptionAlignmentText?: string;
  transcriptionLanguageCode?: string;
  transcriptionDiarize?: boolean;
  transcriptionTagAudioEvents?: boolean;
  transcriptionNumSpeakers?: number;
  transcriptionNoVerbatim?: boolean;
  transcriptionKeyterms?: string;
  transcriptionTimestampGranularity?: 'word' | 'character';
  audioProcessOperation?: AudioProcessOperation;
  videoSeed?: number;
  videoReference1Type?: VideoReferenceType;
  videoReference2Type?: VideoReferenceType;
  videoReference3Type?: VideoReferenceType;
  sourceBinItemId?: string;
  sourceAssetId?: string;
  sourceAssetUrl?: string;
  sourceAssetName?: string;
  sourceAssetMimeType?: string;
  portalRole?: 'entry' | 'exit';
  portalPairId?: string;
  portalLabel?: string;
  textVisionSourceItemId?: string;
  geminiThinkingLevel?: GeminiThinkingLevel;
  geminiMediaResolution?: GeminiMediaResolution;
  geminiGoogleSearchEnabled?: boolean;
  geminiCodeExecutionEnabled?: boolean;
  textOutputFormat?: TextOutputFormat;
  videoFrameSelection?: VideoFrameSelection;
  compositionAudioTrackCount?: number;
  compositionTimelineSeconds?: number;
  compositionUseVideoAudio?: boolean;
  compositionVideoAudioVolume?: number;
  compositionAudio1OffsetMs?: number;
  compositionAudio2OffsetMs?: number;
  compositionAudio3OffsetMs?: number;
  compositionAudio4OffsetMs?: number;
  compositionAudio1Volume?: number;
  compositionAudio2Volume?: number;
  compositionAudio3Volume?: number;
  compositionAudio4Volume?: number;
  compositionAudio1Enabled?: boolean;
  compositionAudio2Enabled?: boolean;
  compositionAudio3Enabled?: boolean;
  compositionAudio4Enabled?: boolean;
  /**
   * Durable, bounded record of persisted Composition audio-track handles dropped as
   * overflow/malformed during edge normalization (FBL-019). Independent of the transient
   * `error`/`statusMessage` runtime fields so an unrelated successful operation can never
   * silently erase it; survives local persistence and project/workspace snapshot export.
   */
  compositionAudioMigrationWarnings?: CompositionAudioMigrationWarning[];
  editorVisualClips?: EditorVisualClip[];
  /** Per-visual-track role (index-aligned with the visual tracks). Lets text/comic clips live on
   *  dedicated `overlay` tracks that composite above the `standard` media tracks. */
  editorVisualTrackKinds?: EditorVisualTrackKind[];
  editorAudioClips?: EditorAudioClip[];
  editorAudioTrackVolumes?: number[];
  editorMutedAudioTracks?: number[];
  editorSoloAudioTracks?: number[];
  editorAssets?: EditorAsset[];
  editorStageObjects?: EditorStageObject[];
  editorTimelineSnapPoints?: number[];
  editorTimelineMarkers?: Array<{
    id: string;
    seconds: number;
    endSeconds?: number;
    label: string;
    color: string;
    kind?: 'comment' | 'chapter' | 'review' | 'sync' | 'export' | 'edit' | 'qc';
    notes?: string;
    clipId?: string;
    /** Stable clip-owned offset in milliseconds from the owning clip's timeline start. */
    clipOffsetMs?: number;
    createdAt?: number;
    updatedAt?: number;
  }>;
  editorLockedVisualTracks?: number[];
  editorLockedAudioTracks?: number[];
  editorCollapsedVisualTracks?: number[];
  editorCollapsedAudioTracks?: number[];
  editorExportPresetPlan?: VideoExportPresetPlanData;
  /** Versioned professional-NLE project state; media bytes and local cache paths are excluded. */
  editorProfessionalState?: EditorProfessionalVideoState;
  /** Additive second-wave editorial, review, caption, timebase, QC, and delivery decisions. */
  editorProfessionalWorkflowState?: EditorProfessionalWorkflowState;
  editorRenderCacheCompositionSignature?: string;
  editorRenderCacheSegmentSignatures?: Record<string, string>;
  editorRenderCacheSegmentArtifacts?: Record<string, {
    key: string;
    signature: string;
    url: string;
    startMs: number;
    endMs: number;
    updatedAt?: string;
  }>;
  editorRenderCacheAssemblyManifest?: VideoRenderAssemblyManifestData;
  editorRenderCacheLastAssemblyManifest?: VideoRenderAssemblyManifestData;
  editorRenderCacheLastAssemblyResult?: VideoRenderAssemblyResultData;
  editorRenderCacheUpdatedAt?: string;
  resultMimeType?: string;
  resultExtension?: string;
  resultFileName?: string;
  resultOutputMetadata?: Record<string, unknown>;
  /** Runtime result table keyed by the declared Function output port id. */
  functionOutputs?: Record<string, FunctionNodeOutput>;
  /** Runtime result table keyed by stable output handles for any multi-output node. */
  namedOutputs?: Record<string, NodeOutputArtifact>;
  /** Stable snapshot of the inputs used to produce the current reusable result. */
  resultInputSignature?: string;
  functionNode?: FunctionNodeConfig;
  groupNode?: GroupNodeConfig;
}

export type AppNode = Node<NodeData, FlowNodeType>;
export type AppNodeProps = NodeProps<AppNode>;
export type PersistedNodeData = Omit<
  NodeData,
  | 'onChange'
  | 'onRun'
  | 'onSelectAttempt'
  | 'isRunning'
  | 'error'
  | 'statusMessage'
  | 'result'
  | 'resultType'
  | 'resultHistory'
  | 'selectedResultId'
  | 'usage'
>;
