import type {
  AppNode,
  AspectRatio,
  DynamicValue,
  EditorAudioKeyframe,
  EditorAudioDuckingSettings,
  EditorAudioProcessingSettings,
  EditorStageObject,
  AudioProvider,
  AudioTtsTimingMetadata,
  ExecutionConfig,
  FunctionNodeConfig,
  FunctionNodeOutput,
  ImageProvider,
  NodeOutputArtifact,
  NodeData,
  ResultType,
  RuntimeSettingsSnapshot,
  TextProvider,
  UsageTelemetry,
  VideoExportPresetId,
  VideoRenderAssemblyManifestData,
  VideoReferenceType,
  VideoProvider,
} from '../types/flow';
import type { GenerateContentConfig, PartUnion } from '@google/genai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { sha256Hex } from '../shared/crypto/sha256';
import {
  isApiRequesterCredentialFieldName,
  isApiRequesterSensitiveHeaderName,
  isPersistedApiRequesterCredential,
} from './apiRequesterCredentials';
import {
  canRunNode,
  createElevenLabsTtsUsage,
  createGeminiImageUsage,
  createGeminiVideoUsage,
  createLocalImageCropUsage,
  createLocalCompositionUsage,
  createLocalFrameExtractionUsage,
  createMeasuredTextUsage,
} from './costEstimation';
import type { Edge } from '@xyflow/react';
import {
  supportsImageEditing,
  supportsImageReferenceGuidance,
  supportsTrueMaskInpaint,
} from './imageModelSupport';
import {
  estimateImageModelCostUsd,
  getImageModelDefinition,
  type ImageModelOperation,
} from './imageProviderCapabilities';
import { canDecodeImages, getDataUrlDimensions, normalizeMaskForProvider } from './imageMask/maskConventions';
import {
  buildBflFlux2Request,
  buildLocalOpenImageEditRequest,
  buildStabilityEditRequest,
  buildStabilityGenerationRequest,
  buildStabilityUpscaleRequest,
  type StabilityEditRequestInput,
} from './imageEditorAi/requestBuilders';
import { applyAtlasImageInputs, atlasModelSupportsMask, resolveAtlasDimensionBody, applyAtlasModelParams, filterAtlasBodyToAcceptedFields, getAtlasModelParams } from './imageEditorAi/atlasNativeImage';
import { extractStabilityGenerationId, fetchStabilityAsyncResultBlob } from './imageEditorAi/stabilityAsyncResult';
import { normalizeBytePlusBaseUrl, bytePlusGenerateImage } from './imageEditorAi/bytePlusImage';
import { createUnknownActualUsageForExecution } from './projectUsageRecording';
import { buildGeminiImagePrompt } from './geminiImagePrompt';
import { buildGeminiTtsPrompt } from './geminiTtsPrompt';
import { validateGeminiVideoRequest } from './geminiVideoValidation';
import { buildGeminiVideoRequest } from './geminiVideoRequest';
import {
  buildVertexOmniVideoRequestBody,
  buildVertexVeoVideoRequestBody,
} from './vertexVideoRequests';
import { loadProviderModule } from './dynamicImportRecovery';
import {
  composeMedia,
  composeSequenceMedia,
  describeSequenceRenderBackend,
  describeSequenceRenderBackendCaveat,
} from './mediaComposition';
import { renderStageFrameSequence } from './stageFrameExport';
import { getVideoExportPresetOption } from './videoPremiereParity';
import type { VideoCaptionEmbeddingResolution } from './videoCaptionEmbedding';
import type { ManualEditorVisualSequenceClip } from './manualEditorSequence';
import type {
  ProfessionalAudioBus,
  ProfessionalLoudnessNormalization,
  ProfessionalNumericParameterTrack,
} from '../types/videoProfessional';
import type { ProviderSettings, TimelineAutomationPoint } from '../types/flow';
import {
  getSupportedImageAspectRatio,
  mapAspectRatioToImageDimensions,
  mapAspectRatioToImageSize,
  supportsGeminiImageSizeTiers,
} from './providerCatalog';
import { getSignalLoomNativeBridge } from './nativeApp';
import type {
  NativeVertexImageRequest,
  NativeVertexTextRequest,
  NativeVertexVideoRequest,
} from './nativeApp';
import {
  fetchDownstreamMediaBlob,
  fetchRemoteMediaAsDataUrl,
  type DownstreamMediaKind,
} from './remoteMediaFetch';
import { getVertexProjectConfig } from './vertexProviderSettings';
import {
  generateVertexImageDirect,
  generateVertexTextDirect,
  generateVertexVideoDirect,
  isVertexDirectRestAvailable,
} from './vertexDirectRest';
import {
  buildVertexGeminiImageRequestBody,
  buildVertexImagenPredictRequestBody,
  getVertexImageRoute,
  isVertexImagenModelId,
  type VertexImageRoute,
} from './vertexImageRequests';
import {
  materializeStabilityImageUpscaleResponse,
  runVertexImagenImageUpscale,
  submitStabilityImageUpscale,
} from './cloudImageUpscale';
import {
  normalizeAndroidAcceleratorBaseUrl,
  runAndroidAcceleratorGenerate,
  runAndroidAcceleratorUpscale,
} from './androidAccelerator';
import { runAndroidNativeImageUpscale } from './androidNativeImageUpscaler';
import {
  runLocalCpuUpscaler,
  type LocalCpuUpscalerInput,
} from './localCpuUpscaler';
import {
  resolveUniversalConfiguredUpscalePlan,
  type UniversalConfiguredUpscalePlan,
} from './universalImageUpscale';
import { extractSelectedVideoFrame } from './videoFrameExtraction';
import {
  isGeminiOmniModelId,
  normalizeGeminiVideoModelId,
} from './videoModelSupport';
import { getVideoModelContract } from './modelContracts/videoModelContracts';
import { getTextModelContract } from './modelContracts/textModelContracts';
import {
  audioModeToOperation,
  getAudioModelContract,
} from './modelContracts/audioModelContracts';
import {
  buildBackendProxyExecuteRequest,
  shouldUseBackendProxy,
} from './backendProxy';
import {
  MAX_BACKEND_PROXY_RESULT_WIRE_BYTES,
  decodeBackendProxyResultEnvelope,
  type DecodedBackendProxyResult,
} from './backendProxyResultEnvelope';
import {
  buildGeminiTextConfig,
  buildGeminiTextInlinePart,
  getDefaultGeminiTextMimeType,
  isGeminiTextMediaInputSupported,
  type GeminiTextMediaInput,
} from './geminiTextModel';
import {
  createDefaultFunctionNodeConfig,
  assertFunctionOutputBindingHandle,
  executeFunctionNodeConfig,
  prepareFunctionSubgraph,
  resolveFunctionInputBindings,
  resolveFunctionOutputFromGraph,
  serializeFunctionExecutionOutcome,
  type FunctionExecutionOutcome,
  type PreparedFunctionSubgraph,
} from './functionNodes';
import {
  collectPromptSignalForNode,
  getBlockingSignalDiagnostics,
  type FlowSignal,
} from './flowSignals';
import {
  cropImageDataUrl,
  resolveCropImageNodeSettings,
} from './cropImageNode';
import {
  getBlockingFlowDiagnostics,
} from './flowDiagnostics';
import { resultValueAsMediaUrl } from './flowResultValues';
import type { FlowGraphContractContext } from './flowConnectionContracts';
import {
  appendReferenceGuidanceBlockToPrompt,
  buildReferenceGuidancePromptBlock,
  formatReferenceGroupInstruction,
  referenceGroupHasGuidance,
  type FlowReferenceGroup,
} from './referenceGroups';
import { abortableSleep, createAbortError, isAbortError, raceWithAbort, throwIfAborted } from './abortSignals';
import { materializeElevenLabsAudioResult } from './elevenLabsAudioResult';
import {
  normalizeElevenLabsForcedAlignmentResponse,
  normalizeElevenLabsScribeResponse,
  timedTranscriptToCaptionCues,
  TRANSCRIPTION_OUTPUT_HANDLES,
  type TimedTranscriptV1,
} from './timedTranscript';
import { AUDIO_PROCESS_OUTPUT_HANDLES } from './audioProcess';
import { serializeSrtCaptions, serializeWebVttCaptions } from './videoCaptions';
import type { FlowModelCardV1, ModelCardRefV1 } from './providerPackContracts';
import { providerPackRegistry } from './providerPackRegistry';
import {
  collectModelCardConnectedValues,
  executeProviderPackCard,
  resolveBuiltInEngine,
} from './providerPackExecution';

export interface ExecutionContext {
  prompt: string;
  config: ExecutionConfig;
  textImageInputs?: string[];
  textMediaInputs?: GeminiTextMediaInput[];
  editImageInput?: string;
  refImageInput?: string;
  editMaskImageInput?: string;
  editReferenceImageInputs?: string[];
  /**
   * AUD-011 canonical numbered reference groups: each `Reference N` slot's image together with
   * the textual/JSON guidance authored onto that same numbered handle. When present this is the
   * authoritative reference representation — the flat image arrays above/below are derived from
   * it — and it participates in the execution fingerprint so re-associating guidance invalidates
   * resume even when every flattened byte is unchanged.
   */
  referenceGroups?: FlowReferenceGroup[];
  /** loras JSON from a connected LoRA Spec node (feeds FLUX LoRA models' `loras` field). */
  loraWeightsJson?: string;
  audioSourceInput?: string;
  sourceVideoInput?: string;
  startImageInput?: string;
  endImageInput?: string;
  referenceImageInputs?: Array<{
    url: string;
    referenceType: VideoReferenceType;
  }>;
  extensionVideoInput?: string;
  videoInput?: string;
  audioInputs?: Array<{
    url: string;
    sourceNodeId: string;
    delayMs: number;
    volumePercent: number;
    enabled: boolean;
  }>;
  useVideoAudio?: boolean;
  videoAudioVolumePercent?: number;
  visualSequenceClips?: ManualEditorVisualSequenceClip[];
  /** A malformed nested/adjustment plan must fail closed rather than render raw descriptor clips. */
  videoRuntimeError?: string;
  stageObjects?: EditorStageObject[];
  sequenceAudioInputs?: Array<{
    id?: string;
    url: string;
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
    audioDucking?: EditorAudioDuckingSettings;
    fadeInSeconds?: number;
    fadeOutSeconds?: number;
    enabled: boolean;
    professional?: {
      pan?: number;
      busId?: string;
      parameterKeyframes?: ProfessionalNumericParameterTrack[];
    };
  }>;
  /** Persisted bounded bus records for the same sequence audio inputs. */
  sequenceAudioMixerBuses?: ProfessionalAudioBus[];
  nativeAssemblyManifest?: VideoRenderAssemblyManifestData;
  nativeOutputDirectoryPath?: string;
  sequenceLoudnessNormalization?: ProfessionalLoudnessNormalization;
  /** A preflighted one-track caption plan or its explicit refusal reason. */
  captionEmbedding?: VideoCaptionEmbeddingResolution;
  functionInputs?: Record<string, DynamicValue>;
  exportPresetId?: VideoExportPresetId;
}

/**
 * Store-provided primitives the collapsed-function executor needs to run an internal
 * subgraph exactly the way the top-level flow executor runs the canvas: the real
 * per-node ExecutionContext builder and the real dependency planner. They are injected
 * (rather than imported) because they live in the flow store, which itself imports this
 * module.
 */
export interface FunctionNodeExecutionRuntime {
  buildContext: (node: AppNode, nodes: AppNode[], edges: Edge[], promptSignal?: FlowSignal) => ExecutionContext;
  getDependencies: (node: AppNode, edges: Edge[], nodesById: Map<string, AppNode>) => string[];
}

export interface ExecuteNodeRequestOptions {
  signal?: AbortSignal;
  graph?: FlowGraphContractContext;
  /**
   * Required for collapsed reusable functions whose internal graph contains
   * provider-backed nodes; execution fails closed without it rather than serving a
   * stored result frozen at collapse time.
   */
  functionRuntime?: FunctionNodeExecutionRuntime;
  /**
   * Internal recursion ownership: the chain of collapsed-function node ids currently
   * executing above this request. A function node whose id already appears in the chain
   * is a recursion cycle and is rejected explicitly.
   */
  functionOwnerChain?: string[];
  /** Persist successful internal provider attribution before a later step fails/cancels. */
  onInternalUsage?: (entry: { node: AppNode; usage: UsageTelemetry }) => void;
}

interface ExecutionResult {
  result: string | boolean;
  resultType: ResultType;
  statusMessage: string;
  blob?: Blob;
  nativeFilePath?: string;
  usage?: UsageTelemetry;
  mimeType?: string;
  extension?: string;
  fileName?: string;
  outputMetadata?: Record<string, unknown>;
  /**
   * Extra outputs beyond `result` when a SINGLE call returns multiple images — e.g. Seedream Sequential
   * (`max_images` up to 15 cohesive images from one prompt). The run path expands these into an envelope so
   * every image lands in the Source Library / downstream list instead of being dropped.
   */
  additionalResults?: Array<{ result: string; mimeType?: string }>;
  functionOutputs?: Record<string, FunctionNodeOutput>;
  namedOutputs?: Record<string, NodeOutputArtifact>;
  usageAttributions?: Array<{ node: AppNode; usage: UsageTelemetry }>;
}

interface GeminiVideoOperation {
  name?: string;
  done?: boolean;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: Array<{
        video?: {
          uri?: string;
        };
      }>;
    };
  };
}

import { HttpStatusError, NonRetryableError, withExponentialBackoff } from './exponentialBackoff';
import { getProviderLimiter } from './providerRateLimiter';

const FLOW_PROVIDER_RETRY_BUDGET_MS = 5 * 60_000;

export async function executeNodeRequest(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string, retryState?: { attempt: number; max: number; nextAttemptAt: number }) => void,
  options: ExecuteNodeRequestOptions = {},
): Promise<ExecutionResult> {
  if (options.graph) {
    assertFlowExecutionPreflight(options.graph, node.id);
  }

  // Composition/render nodes drive a LOCAL, deterministic, CPU/GPU-bound export (the frame-server
  // engine or the legacy ffmpeg graph) — not a flaky external API call. The generic
  // exponential-backoff retry below exists for rate-limited AI provider calls; applying it here
  // meant a render that failed because the local render service was killed (or crashed) got
  // silently, automatically RETRIED (up to `batchMaxRetries`, 30s+ apart) — and because systemd
  // restarts a killed render service within `RestartSec=2`, well inside even the first backoff
  // window, the "retry" routinely succeeded in re-firing the SAME expensive render the operator had
  // just killed. Composition nodes bypass the wrapper entirely: a render failure surfaces once,
  // immediately, to the user — it is never silently resurrected.
  if (node.type === 'composition') {
    throwIfAborted(options.signal);
    return raceWithAbort(executeCompositionNode(node, context, settings, onStatus), options.signal);
  }

  // API Requester targets are arbitrary user endpoints and Function nodes are
  // local deterministic transforms. Neither belongs to the shared AI-provider
  // throttle, and both are already submit-once operations.
  if (node.type === 'apiFetchNode') {
    return executeApiFetchNode(node, context, onStatus, options.signal);
  }
  // Collapsed reusable functions are pure orchestration: their provider spend happens inside
  // the internal subgraph, where each provider node acquires its own limiter slot and retry
  // budget through this same function. Running the orchestrator itself inside the retry
  // wrapper would re-run the WHOLE internal subgraph (duplicate provider spend) whenever one
  // internal call exhausted its retries. The orchestrator also has no provider request start
  // of its own, so it must not consume an admission interval before those internal calls.
  if (node.type === 'functionNode') {
    throwIfAborted(options.signal);
    return executeFunctionNode(node, context, settings, onStatus, options);
  }

  const providerPolicyKey = resolveProviderStartPolicyKey(node, settings);
  const limiter = getProviderLimiter(providerPolicyKey);

  const operation = () => limiter.acquire(async () => {
    throwIfAborted(options.signal);

    const execution = await (async (): Promise<ExecutionResult> => {
      const modelCardRef = parseModelCardRef(node.data.modelCardRef);
      const resolvedModelCard = modelCardRef
        ? providerPackRegistry.resolveCard(modelCardRef, node.data.embeddedProviderPackSnapshots)
        : undefined;
      const modelCardOperationId = resolvedModelCard
        ? (typeof node.data.modelCardOperationId === 'string'
            ? node.data.modelCardOperationId
            : resolvedModelCard.card.operations[0]?.id)
        : undefined;
      const builtInEngine = resolvedModelCard && modelCardOperationId
        ? resolveBuiltInEngine(resolvedModelCard.pack, resolvedModelCard.card, modelCardOperationId)
        : undefined;
      const connectedModelCardValues = resolvedModelCard && modelCardOperationId && options.graph
        ? collectModelCardConnectedValues({
            node,
            nodes: options.graph.nodes,
            edges: options.graph.edges,
            card: resolvedModelCard.card,
            operationId: modelCardOperationId,
          })
        : {};
      const resolvedModelCardValues = {
        ...(isRecord(node.data.modelCardValues) ? node.data.modelCardValues : {}),
        ...connectedModelCardValues,
      };
      if (resolvedModelCard && modelCardOperationId) {
        if (!resolvedModelCard.executable) {
          throw new NonRetryableError(resolvedModelCard.missingReason ?? 'This provider pack is not approved for execution.');
        }
        providerPackRegistry.assertExecutionAllowed(
          resolvedModelCard.pack,
          resolvedModelCard.card,
          modelCardOperationId,
          resolvedModelCardValues,
        );
      }
      if (resolvedModelCard && modelCardOperationId && !builtInEngine) {
        return executeProviderPackCard({
          pack: resolvedModelCard.pack,
          card: resolvedModelCard.card,
          operationId: modelCardOperationId,
          values: resolvedModelCardValues,
          signal: options.signal,
          onStatus,
        });
      }
      const routedNode = resolvedModelCard && modelCardOperationId && builtInEngine
        ? createBuiltInModelCardCompatibilityNode(
            node,
            resolvedModelCard.card,
            resolvedModelCard.card.modelId,
            modelCardOperationId,
            builtInEngine,
          )
        : node;
      const routedContext = resolvedModelCard && modelCardOperationId && builtInEngine
        ? createBuiltInModelCardCompatibilityContext(
            context,
            resolvedModelCard.card,
            resolvedModelCardValues,
          )
        : context;
      if (shouldProxyNodeExecution(routedNode, settings)) {
        const proxied = await executeNodeViaBackendProxy(routedNode, routedContext, settings, onStatus, options.signal);
        // Auto-upscale is client-side post-processing: the plan and every credential it can use
        // (Android accelerator token, local endpoints, Stability key, Vertex auth) stay on this
        // device, so a proxied image result takes exactly the same upscale path as a direct
        // provider result instead of silently skipping the node's requested upscale.
        return applyConfiguredAutoUpscaleIfRequested({ node: routedNode, context: routedContext, settings, result: proxied, onStatus, abortSignal: options.signal });
      }

      switch (routedNode.type) {
        case 'textNode':
          return executeTextNode(routedNode, routedContext, settings, onStatus, options.signal);
        case 'imageGen':
          return executeImageNode(routedNode, routedContext, settings, onStatus, options.signal);
        case 'cropImageNode':
          return executeCropImageNode(routedNode, routedContext, onStatus, options.signal);
        case 'videoGen':
          return executeVideoNode(routedNode, routedContext, settings, onStatus, options.signal);
        case 'audioGen':
          return executeAudioNode(routedNode, routedContext, settings, onStatus, options.signal);
        case 'transcriptionNode':
          return executeTranscriptionNode(routedNode, routedContext, settings, onStatus, options.signal);
        case 'audioProcessNode':
          return executeAudioProcessNode(routedNode, routedContext, settings, onStatus, options.signal);
        // 'composition' is handled above, before the retry wrapper — see that comment.
        case 'visionVerifyNode':
          return executeVisionVerifyNode(routedNode, routedContext, settings, onStatus, options.signal);
        default:
          throw new NonRetryableError(`Unsupported node type: ${routedNode.type}`);
      }
    })();

    return retainSuccessfulUsageIdentity(node, settings, execution);
  }, options.signal);

  // These direct-provider routes submit paid, non-idempotent asynchronous jobs.
  // Retrying the whole operation after a poll/download fault can create another
  // charge. They submit once; their poll/materialize phases retry the existing
  // prediction ID, polling URL, or operation name inside the provider function.
  // API Requester targets are user-defined. There is no provider-specific operation ID that
  // lets us distinguish a failed submission from a completed side effect, so replaying any
  // request here would be dishonest (and can duplicate a POST, PUT, PATCH, or DELETE).
  if (isDirectPaidAsyncRequest(node, settings)) {
    return emitSuccessfulUsageAttributions(await operation(), options.onInternalUsage);
  }

  const execution = await withExponentialBackoff({
    maxRetries: settings.providerSettings.batchMaxRetries ?? 10,
    baseDelayMs: settings.providerSettings.batchRetryBaseDelayMs ?? 30000,
    maxElapsedMs: FLOW_PROVIDER_RETRY_BUDGET_MS,
    abortSignal: options.signal,
    onRetry: (attempt, max, delay, error) => {
      const delaySec = Math.round(delay / 1000);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      onStatus?.(
        `API Error (${errorMsg}). Retrying ${attempt} of ${max}... Next attempt in ${delaySec}s`,
        { attempt, max, nextAttemptAt: Date.now() + delay }
      );
    },
    operation,
  });
  return emitSuccessfulUsageAttributions(execution, options.onInternalUsage);
}

function parseModelCardRef(value: unknown): ModelCardRefV1 | undefined {
  return isRecord(value)
    && typeof value.packId === 'string'
    && typeof value.version === 'string'
    && typeof value.hash === 'string'
    && typeof value.cardId === 'string'
    ? value as unknown as ModelCardRefV1
    : undefined;
}

function createBuiltInModelCardCompatibilityNode(
  node: AppNode,
  card: FlowModelCardV1,
  modelId: string,
  operationId: string,
  provider: string,
): AppNode {
  const values = isRecord(node.data.modelCardValues) ? node.data.modelCardValues : {};
  const data: AppNode['data'] = {
    ...node.data,
    ...values,
    provider: provider as NodeData['provider'],
    modelId,
    mode: node.type === 'textNode' ? 'generate' : node.data.mode,
    mediaMode: node.type === 'imageGen' || node.type === 'videoGen' || node.type === 'audioGen'
      ? 'generate'
      : node.data.mediaMode,
    imageOperation: operationId === 'image-upscale' ? 'upscale' : operationId,
    audioGenerationMode: operationId === 'speech-to-speech'
      ? 'voiceChange'
      : operationId === 'text-to-sound-effect'
        ? 'soundEffect'
        : operationId === 'text-to-music'
          ? 'music'
          : 'speech',
  };
  for (const field of card.fields) {
    const value = values[field.id];
    if (value === undefined) continue;
    if (field.semanticRole === 'prompt' && typeof value === 'string') data.prompt = value;
    if (field.semanticRole === 'system-instruction' && typeof value === 'string') data.systemPrompt = value;
    if (field.semanticRole === 'duration' && typeof value === 'number') data.durationSeconds = value;
    if (field.semanticRole === 'frame-rate' && typeof value === 'number') data.videoFrameRate = value;
    if (field.semanticRole === 'width' && typeof value === 'number') data.imageWidth = value;
    if (field.semanticRole === 'height' && typeof value === 'number') data.imageHeight = value;
    if (field.semanticRole === 'seed' && typeof value === 'number') {
      if (node.type === 'audioGen') data.audioSeed = value;
      else data.imageSeed = value;
    }
    if (field.semanticRole === 'voice' && typeof value === 'string') data.voiceId = value;
    if (field.semanticRole === 'style' && typeof value === 'string') data.audioStyleDescription = value;
    if (field.semanticRole === 'format' && typeof value === 'string') {
      if (node.type === 'audioGen') data.audioOutputFormat = value as AppNode['data']['audioOutputFormat'];
      else if (node.type === 'imageGen') data.imageOutputFormat = value as AppNode['data']['imageOutputFormat'];
    }
    if (field.semanticRole === 'resolution' && typeof value === 'string') {
      if (node.type === 'videoGen') data.videoResolution = value as AppNode['data']['videoResolution'];
      else if (node.type === 'imageGen' && ['1K', '2K', '4K'].includes(value)) {
        data.imageResolutionTier = value as AppNode['data']['imageResolutionTier'];
      }
    }
  }
  return { ...node, data };
}

function createBuiltInModelCardCompatibilityContext(
  context: ExecutionContext,
  card: FlowModelCardV1,
  values: Record<string, unknown>,
): ExecutionContext {
  const next: ExecutionContext = { ...context };
  const referenceImages: string[] = [];
  for (const field of card.fields) {
    const value = values[field.id];
    const first = Array.isArray(value) ? value[0] : value;
    const strings = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : typeof value === 'string' ? [value] : [];
    if (field.semanticRole === 'prompt' && typeof first === 'string') next.prompt = first;
    if (field.semanticRole === 'source-image' && typeof first === 'string') next.editImageInput = first;
    if (field.semanticRole === 'mask' && typeof first === 'string') next.editMaskImageInput = first;
    if (field.semanticRole === 'reference-image') referenceImages.push(...strings);
    if (field.semanticRole === 'source-video' && typeof first === 'string') next.sourceVideoInput = first;
    if (field.semanticRole === 'start-frame' && typeof first === 'string') next.startImageInput = first;
    if (field.semanticRole === 'end-frame' && typeof first === 'string') next.endImageInput = first;
    if (field.semanticRole === 'reference-video') {
      next.referenceImageInputs = strings.map((url) => ({ url, referenceType: 'asset' }));
    }
    if (field.semanticRole === 'source-audio' && typeof first === 'string') next.audioSourceInput = first;
  }
  if (referenceImages.length) next.editReferenceImageInputs = referenceImages;
  return next;
}

function emitSuccessfulUsageAttributions(
  execution: ExecutionResult,
  record: ExecuteNodeRequestOptions['onInternalUsage'],
): ExecutionResult {
  for (const attribution of execution.usageAttributions ?? []) record?.(attribution);
  return execution;
}

function retainSuccessfulUsageIdentity(
  node: AppNode,
  settings: RuntimeSettingsSnapshot,
  execution: ExecutionResult,
): ExecutionResult {
  const identity = resolveSuccessfulUsageIdentity(node, settings, execution);
  if (!execution.usage) {
    const usage = createUnknownActualUsageForExecution(node, identity);
    return usage ? { ...execution, usage } : execution;
  }

  const usage = {
    ...execution.usage,
    ...(execution.usage.provider || !identity.provider ? {} : { provider: identity.provider }),
    ...(execution.usage.modelId || !identity.modelId ? {} : { modelId: identity.modelId }),
    ...(execution.usage.imageCount !== undefined || identity.imageCount === undefined
      ? {}
      : { imageCount: identity.imageCount }),
  };
  return { ...execution, usage };
}

function resolveSuccessfulUsageIdentity(
  node: AppNode,
  settings: RuntimeSettingsSnapshot,
  execution: ExecutionResult,
): { provider?: string; modelId?: string; imageCount?: number } {
  const modelCardRef = parseModelCardRef(node.data.modelCardRef);
  if (modelCardRef) {
    const resolved = providerPackRegistry.resolveCard(modelCardRef, node.data.embeddedProviderPackSnapshots);
    return {
      provider: resolved.pack.packId,
      modelId: resolved.card.modelId,
      imageCount: execution.resultType === 'image' ? 1 + (execution.additionalResults?.length ?? 0) : undefined,
    };
  }
  if (node.type === 'textNode') {
    const provider = (node.data.provider as TextProvider | undefined) ?? 'gemini';
    return { provider, modelId: getModelId(settings, 'text', provider, node.data.modelId) };
  }
  if (node.type === 'imageGen') {
    const provider = (node.data.provider as ImageProvider | undefined) ?? 'gemini';
    return {
      provider,
      modelId: getModelId(settings, 'image', provider, node.data.modelId),
      imageCount: execution.resultType === 'image' ? 1 + (execution.additionalResults?.length ?? 0) : undefined,
    };
  }
  if (node.type === 'videoGen') {
    const provider = (node.data.provider as VideoProvider | undefined) ?? 'gemini';
    const modelId = getModelId(settings, 'video', provider, node.data.modelId);
    return { provider, modelId: provider === 'gemini' ? normalizeGeminiVideoModelId(modelId) : modelId };
  }
  if (node.type === 'audioGen') {
    const provider = (node.data.provider as AudioProvider | undefined) ?? 'elevenlabs';
    return { provider, modelId: getModelId(settings, 'audio', provider, node.data.modelId) };
  }
  if (node.type === 'transcriptionNode') {
    return {
      provider: 'elevenlabs',
      modelId: node.data.transcriptionOperation === 'align' ? 'forced_alignment' : 'scribe_v2',
    };
  }
  if (node.type === 'audioProcessNode') {
    return { provider: 'elevenlabs', modelId: 'audio_isolation' };
  }
  if (node.type === 'visionVerifyNode') {
    return { provider: 'gemini', modelId: node.data.modelId ?? 'gemini-3.5-flash' };
  }
  return {};
}

function isDirectPaidAsyncRequest(node: AppNode, settings: RuntimeSettingsSnapshot): boolean {
  const modelCardRef = parseModelCardRef(node.data.modelCardRef);
  if (modelCardRef) {
    const resolved = providerPackRegistry.resolveCard(modelCardRef, node.data.embeddedProviderPackSnapshots);
    const operationId = typeof node.data.modelCardOperationId === 'string'
      ? node.data.modelCardOperationId
      : resolved.card.operations[0]?.id;
    const operation = resolved.card.operations.find((candidate) => candidate.id === operationId);
    const transport = resolved.pack.transports.find((candidate) => candidate.id === operation?.transportProfileId);
    if (transport?.kind === 'submit-poll') return true;
  }
  if (shouldProxyNodeExecution(node, settings)) return false;

  // A transport failure after Scribe accepts the upload may already have spent
  // credits. Submit the file once instead of replaying the whole transcription.
  if (node.type === 'transcriptionNode' || node.type === 'audioProcessNode') return true;

  if (node.type === 'imageGen') {
    const provider = (node.data.provider as ImageProvider | undefined) ?? 'gemini';
    const modelId = getModelId(settings, 'image', provider, node.data.modelId);
    return provider === 'bfl'
      || (provider === 'atlas' && isAtlasNativeImageModelId(modelId))
      || (provider === 'stability'
        && resolveStabilityOperation(modelId, node.data.imageOperation, true) === 'replace-background-relight');
  }

  if (node.type === 'videoGen') {
    const provider = (node.data.provider as VideoProvider | undefined) ?? 'gemini';
    if (provider === 'atlas') return true;
    if (provider !== 'gemini' || settings.providerSettings.geminiCredentialMode === 'vertex-adc') return false;

    const modelId = normalizeGeminiVideoModelId(getModelId(settings, 'video', provider, node.data.modelId));
    return !isGeminiOmniModelId(modelId);
  }

  return false;
}

function retryExistingAsyncJobPhase<T>(input: {
  phaseLabel: string;
  operation: () => Promise<T>;
  settings: RuntimeSettingsSnapshot;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
  maxRetries?: number;
  baseDelayMs?: number;
}): Promise<T> {
  return withExponentialBackoff({
    operation: input.operation,
    maxRetries: input.maxRetries ?? input.settings.providerSettings.batchMaxRetries ?? 10,
    baseDelayMs: input.baseDelayMs ?? input.settings.providerSettings.batchRetryBaseDelayMs ?? 30000,
    maxElapsedMs: FLOW_PROVIDER_RETRY_BUDGET_MS,
    abortSignal: input.abortSignal,
    onRetry: (attempt, max, delay, error) => {
      const message = error instanceof Error ? error.message : 'Unknown error';
      input.onStatus?.(
        `${input.phaseLabel} (${message}). Retrying the existing job ${attempt} of ${max} in ${Math.round(delay / 1000)}s…`,
      );
    },
  });
}

export function assertFlowExecutionPreflight(
  graph: FlowGraphContractContext,
  rootNodeId?: string,
): void {
  const diagnostics = getBlockingFlowDiagnostics([...graph.nodes], [...graph.edges], rootNodeId);
  if (diagnostics.length === 0) return;

  const summary = diagnostics.slice(0, 5).map((diagnostic) => {
    const location = diagnostic.edgeId
      ? `Edge ${diagnostic.edgeId}`
      : diagnostic.nodeId ? `Node ${diagnostic.nodeId}` : 'Flow';
    return `${location}: ${diagnostic.message}`;
  }).join('\n');
  const remaining = diagnostics.length > 5
    ? `\n${diagnostics.length - 5} more blocking issue${diagnostics.length - 5 === 1 ? '' : 's'} are listed in Diagnostics.`
    : '';
  throw new Error(`Flow cannot run until these connection issues are fixed:\n${summary}${remaining}`);
}

export async function hashExecutionParameters(nodeData: unknown, context: ExecutionContext): Promise<string> {
  const payload = JSON.stringify({ nodeData, context });
  const buffer = new TextEncoder().encode(payload);
  return sha256Hex(buffer);
}

const MAX_FUNCTION_SUBGRAPH_DEPTH = 8;

async function executeFunctionNode(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
  options: ExecuteNodeRequestOptions = {},
): Promise<ExecutionResult> {
  throwIfAborted(options.signal);
  const config = node.data.functionNode ?? createDefaultFunctionNodeConfig('Reusable function');
  const ownerChain = options.functionOwnerChain ?? [];

  if (ownerChain.includes(node.id)) {
    throw new NonRetryableError(
      `Reusable function "${config.title}" recursively contains itself (${[...ownerChain, node.id].join(' → ')}). Break the cycle before running.`,
    );
  }
  if (ownerChain.length >= MAX_FUNCTION_SUBGRAPH_DEPTH) {
    throw new NonRetryableError(
      `Reusable functions are nested more than ${MAX_FUNCTION_SUBGRAPH_DEPTH} levels deep (${ownerChain.join(' → ')}). Flatten the function graph before running.`,
    );
  }

  const explicitFunctionInputs = context.functionInputs ?? {};
  const flowInputs = resolveFunctionInputBindings(config, {
    ...explicitFunctionInputs,
    prompt: context.prompt,
    'input-flow': context.prompt,
    image: context.editImageInput ?? '',
    video: context.videoInput ?? context.sourceVideoInput ?? '',
    audio: context.audioSourceInput ?? '',
  });

  const outputBinding = config.outputBindings[0];
  const prepared = prepareFunctionSubgraph(config, flowInputs);

  // Validate exact named output identity before provider planning. Runtime resolution
  // repeats this guard so an impossible handle can never degrade to primary data.
  for (const binding of config.outputBindings) {
    assertFunctionOutputBindingHandle(config, binding, prepared);
  }

  // No binding or an empty internal graph: the synchronous resolution path is the whole
  // truth (defaults, expressions, missing strategies) and there is no provider work.
  if (!outputBinding || !prepared) {
    return withoutProviderSpend(executeFunctionNodeConfig(config, flowInputs));
  }

  const nodesById = new Map(prepared.nodes.map((entry) => [entry.id, entry]));
  const plan = planInternalProviderExecution(
    prepared,
    config.outputBindings.map((binding) => binding.sourceNodeId),
    options.functionRuntime,
    nodesById,
  );

  validateFunctionExecutionPreflight(config, prepared, plan, settings);

  if (plan.length === 0) {
    const functionOutputs: Record<string, FunctionNodeOutput> = {};
    let primaryOutcome: FunctionExecutionOutcome | undefined;
    for (const binding of config.outputBindings) {
      const rawValue = resolveFunctionOutputFromGraph(config, binding, prepared, flowInputs);
      const outcome = serializeFunctionExecutionOutcome(config, binding, rawValue);
      functionOutputs[binding.targetOutputPortId] = outcome;
      if (binding === outputBinding) primaryOutcome = outcome;
    }
    if (!primaryOutcome) {
      throw new Error('Function primary output could not be resolved.');
    }
    // `FunctionExecutionOutcome` owns the boundary status message, whereas named
    // outputs intentionally retain only routable values and media metadata.
    return { ...withoutProviderSpend(primaryOutcome), functionOutputs, namedOutputs: functionOutputs };
  }

  if (!options.functionRuntime) {
    throw new NonRetryableError(
      `Reusable function "${config.title}" contains ${plan.length} provider-backed internal node${plan.length === 1 ? '' : 's'}, but this execution path did not supply the flow runtime needed to run them. Refusing to return a result frozen at collapse time.`,
    );
  }

  // Isolation: strip stale outputs from every runnable internal node so nothing — signal
  // evaluation, context collectors, or the output binding — can serve a provider result
  // frozen at collapse time. Import-mode media nodes and carriers are sources, not
  // runnable nodes, and keep their data.
  for (const internalNode of prepared.nodes) {
    if (canRunNode(internalNode)) {
      internalNode.data = {
        ...internalNode.data,
        result: undefined,
        resultType: undefined,
        resultMimeType: undefined,
        envelopeItems: undefined,
        usage: undefined,
        statusMessage: undefined,
        error: undefined,
      };
    }
  }

  const usages: UsageTelemetry[] = [];
  const usageAttributions: Array<{ node: AppNode; usage: UsageTelemetry }> = [];
  const internalResults = new Map<string, ExecutionResult>();
  for (const [index, internalId] of plan.entries()) {
    throwIfAborted(options.signal);

    const internalNode = nodesById.get(internalId);
    if (!internalNode) {
      continue;
    }

    const promptSignal = collectPromptSignalForNode(internalId, prepared.nodes, prepared.edges);
    const blockingDiagnostics = getBlockingSignalDiagnostics(promptSignal);
    if (blockingDiagnostics.length > 0) {
      throw new NonRetryableError(
        `Reusable function "${config.title}" internal node ${internalId}: ${blockingDiagnostics[0].message}`,
      );
    }

    const internalContext = options.functionRuntime.buildContext(internalNode, prepared.nodes, prepared.edges, promptSignal);
    const stepLabel = `${index + 1}/${plan.length}`;
    const execution = await executeNodeRequest(
      internalNode,
      internalContext,
      settings,
      (statusMessage) => {
        onStatus?.(`${config.title} · internal ${internalNode.type} ${stepLabel}: ${statusMessage}`);
      },
      {
        signal: options.signal,
        functionRuntime: options.functionRuntime,
        functionOwnerChain: [...ownerChain, node.id],
      },
    );

    internalNode.data = {
      ...internalNode.data,
      result: execution.result,
      resultType: execution.resultType,
      resultMimeType: execution.mimeType,
      resultExtension: execution.extension,
      resultFileName: execution.fileName,
      resultOutputMetadata: execution.outputMetadata,
      functionOutputs: execution.functionOutputs,
      namedOutputs: execution.namedOutputs,
      envelopeItems: undefined,
      statusMessage: execution.statusMessage,
      error: undefined,
    };
    internalResults.set(internalId, execution);

    const internalUsage = execution.usage ?? {
      source: 'actual' as const,
      confidence: 'unknown' as const,
      provider: typeof internalNode.data.provider === 'string' ? internalNode.data.provider : undefined,
      modelId: typeof internalNode.data.modelId === 'string' ? internalNode.data.modelId : undefined,
      imageCount: execution.resultType === 'image' ? 1 : undefined,
      notes: ['Internal provider call completed, but the provider did not report numeric usage or cost.'],
    };
    usages.push(internalUsage);
    const attributions = execution.usageAttributions?.length
      ? execution.usageAttributions
      : [{ node: { ...internalNode, data: { ...internalNode.data } }, usage: internalUsage }];
    for (const attribution of attributions) {
      usageAttributions.push(attribution);
      options.onInternalUsage?.(attribution);
    }
  }

  throwIfAborted(options.signal);

  const resolvedOutputs: Record<string, FunctionNodeOutput> = {};
  for (const binding of config.outputBindings) {
    const rawValue = resolveFunctionOutputFromGraph(config, binding, prepared, flowInputs);
    const outcome = serializeFunctionExecutionOutcome(config, binding, rawValue);
    const source = binding.sourceNodeId ? nodesById.get(binding.sourceNodeId) : undefined;
    const sourceExecution = binding.sourceNodeId ? internalResults.get(binding.sourceNodeId) : undefined;
    const namedSourceOutput = binding.sourceHandle
      ? (source?.data.namedOutputs?.[binding.sourceHandle] ?? source?.data.functionOutputs?.[binding.sourceHandle])
      : undefined;
    const matchesPrimaryExecution = Boolean(sourceExecution && outcome.result === sourceExecution.result);
    const matchesSourceResult = Boolean(source && outcome.result === source.data.result);
    resolvedOutputs[binding.targetOutputPortId] = {
      result: outcome.result,
      resultType: outcome.resultType,
      blob: namedSourceOutput?.blob ?? (matchesPrimaryExecution ? sourceExecution?.blob : undefined),
      mimeType: namedSourceOutput?.mimeType ?? (matchesSourceResult ? source?.data.resultMimeType : undefined),
      extension: namedSourceOutput?.extension ?? (matchesSourceResult ? source?.data.resultExtension : undefined),
      fileName: namedSourceOutput?.fileName ?? (matchesSourceResult ? source?.data.resultFileName : undefined),
      outputMetadata: namedSourceOutput?.outputMetadata ?? (matchesSourceResult ? source?.data.resultOutputMetadata : undefined),
      additionalResults: namedSourceOutput?.additionalResults
        ?? (matchesPrimaryExecution ? sourceExecution?.additionalResults : undefined),
    };
  }
  const outcome = resolvedOutputs[outputBinding.targetOutputPortId];
  return {
    ...outcome,
    statusMessage: `Executed ${config.title}: ${plan.length} provider node${plan.length === 1 ? '' : 's'} across ${config.graph.nodes.length} internal node${config.graph.nodes.length === 1 ? '' : 's'}`,
    blob: outcome.blob,
    functionOutputs: resolvedOutputs,
    namedOutputs: resolvedOutputs,
    usageAttributions,
    usage: aggregateFunctionSubgraphUsage(usages, plan.length),
  };
}

/** Validate persisted Function wiring and credentials before the first provider call.
 * This deliberately does not attempt to repair malformed saved graphs: a repair could
 * silently select a different paid path. */
function validateFunctionExecutionPreflight(
  config: FunctionNodeConfig,
  prepared: PreparedFunctionSubgraph,
  plan: string[],
  settings: RuntimeSettingsSnapshot,
): void {
  // A provider-free missing binding retains its documented local missing strategy.
  // Strict persisted-wiring rejection begins exactly where a malformed graph could
  // otherwise select or conceal paid work.
  if (plan.length === 0) return;
  if (!Array.isArray(config.graph.edges)) {
    throw new NonRetryableError('Reusable function wiring is malformed (edges must be an array). No provider request was sent.');
  }
  const persistedIds = new Set(config.graph.nodes.map((node) => node.id));
  for (const edge of config.graph.edges) {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string' || !persistedIds.has(edge.source) || !persistedIds.has(edge.target)) {
      throw new NonRetryableError('Reusable function wiring references a missing internal node. No provider request was sent.');
    }
  }
  const inputIds = new Set(config.contract.inputPorts.map((port) => port.id));
  const outputIds = new Set(config.contract.outputPorts.map((port) => port.id));
  if (config.inputBindings.some((binding) => !inputIds.has(binding.targetInputPortId)) ||
      config.outputBindings.some((binding) => !outputIds.has(binding.targetOutputPortId) || !persistedIds.has(binding.sourceNodeId))) {
    throw new NonRetryableError('Reusable function bindings reference a missing port or internal source. No provider request was sent.');
  }
  for (const id of plan) {
    const internal = prepared.nodes.find((node) => node.id === id);
    if (!internal) continue;
    assertInternalProviderCredentials(internal, settings);
  }
}

function assertInternalProviderCredentials(node: AppNode, settings: RuntimeSettingsSnapshot): void {
  const provider = typeof node.data.provider === 'string' ? node.data.provider : '';
  const requires = (key: keyof RuntimeSettingsSnapshot['apiKeys'], label: string) => {
    if (!settings.apiKeys[key]?.trim()) {
      throw new NonRetryableError(`Reusable function cannot start: ${label} API key is missing. No provider request was sent.`);
    }
  };
  if (node.type === 'textNode' || node.type === 'visionVerifyNode') {
    if (provider === 'openai') requires('openai', 'OpenAI');
    else if (provider === 'gemini') requires('gemini', 'Gemini');
    else if (provider === 'huggingface') requires('huggingface', 'Hugging Face');
  } else if (node.type === 'imageGen') {
    if (provider === 'openai') requires('openai', 'OpenAI');
    else if (provider === 'atlas') requires('atlas', 'Atlas');
    else if (provider === 'gemini' && settings.providerSettings.geminiCredentialMode !== 'vertex-adc') requires('gemini', 'Gemini');
    else if (provider === 'huggingface') requires('huggingface', 'Hugging Face');
    else if (provider === 'bfl') requires('bfl', 'Black Forest Labs');
    else if (provider === 'stability') requires('stability', 'Stability AI');
    else if (provider === 'byteplus') requires('byteplus', 'BytePlus');
  } else if (node.type === 'videoGen') {
    if (provider === 'gemini') requires('gemini', 'Gemini');
    else if (provider === 'atlas') requires('atlas', 'Atlas');
    else if (provider === 'huggingface') requires('huggingface', 'Hugging Face');
  } else if (node.type === 'audioGen') {
    if (provider === 'gemini') requires('gemini', 'Gemini');
    else if (provider === 'elevenlabs') requires('elevenlabs', 'ElevenLabs');
    else if (provider === 'huggingface') requires('huggingface', 'Hugging Face');
  } else if (node.type === 'transcriptionNode') {
    requires('elevenlabs', 'ElevenLabs');
  } else if (node.type === 'audioProcessNode') {
    requires('elevenlabs', 'ElevenLabs');
  }
}

function withoutProviderSpend(outcome: FunctionExecutionOutcome): ExecutionResult {
  return {
    ...outcome,
    usage: {
      source: 'actual',
      confidence: 'fixed',
      costUsd: 0,
      notes: ['Function nodes route existing graph outputs and local transforms without provider spend.'],
    },
  };
}

/**
 * Runnable internal nodes the bound output depends on, in dependency order. Planning uses
 * the injected store dependency walker when available (portal/list routing aware); without
 * it, a plain edge-ancestor walk still classifies whether provider work exists so the
 * caller can fail closed instead of serving stale data.
 */
function planInternalProviderExecution(
  prepared: PreparedFunctionSubgraph,
  outputSourceNodeIds: Array<string | undefined>,
  runtime: FunctionNodeExecutionRuntime | undefined,
  nodesById: Map<string, AppNode>,
): string[] {
  const order: string[] = [];
  const visited = new Set<string>();

  const visit = (currentId: string, stack: Set<string>) => {
    if (visited.has(currentId)) {
      return;
    }
    if (stack.has(currentId)) {
      throw new NonRetryableError(
        'Reusable function execution cannot continue because the internal graph contains a dependency cycle.',
      );
    }

    const current = nodesById.get(currentId);
    if (!current) {
      return;
    }

    const nextStack = new Set(stack);
    nextStack.add(currentId);

    const dependencyIds = runtime
      ? runtime.getDependencies(current, prepared.edges, nodesById)
      : fallbackEdgeDependencies(current, prepared.edges, nodesById);
    for (const dependencyId of dependencyIds) {
      visit(dependencyId, nextStack);
    }

    visited.add(currentId);
    if (canRunNode(current)) {
      order.push(currentId);
    }
  };

  for (const outputSourceNodeId of outputSourceNodeIds) {
    if (outputSourceNodeId && nodesById.has(outputSourceNodeId)) {
      visit(outputSourceNodeId, new Set());
    }
  }
  return order;
}

function fallbackEdgeDependencies(node: AppNode, edges: Edge[], nodesById: Map<string, AppNode>): string[] {
  const dependencies = new Set<string>();
  for (const edge of edges) {
    if (edge.target === node.id && edge.source !== node.id && nodesById.has(edge.source)) {
      dependencies.add(edge.source);
    }
  }
  return [...dependencies];
}

function aggregateFunctionSubgraphUsage(usages: UsageTelemetry[], providerNodeCount: number): UsageTelemetry {
  const executionNote = `Executed ${providerNodeCount} internal provider node${providerNodeCount === 1 ? '' : 's'} with fresh inputs.`;

  if (usages.length === 0) {
    return {
      source: 'actual',
      confidence: 'unknown',
      notes: [executionNote, 'Internal provider nodes did not report usage telemetry.'],
    };
  }

  if (usages.length === 1 && providerNodeCount === 1) {
    return {
      ...usages[0],
      source: 'actual',
      notes: [executionNote, ...(usages[0].notes ?? [])],
    };
  }

  const confidenceRank: Record<UsageTelemetry['confidence'], number> = {
    measured: 0,
    heuristic: 1,
    fixed: 2,
    unknown: 3,
  };
  const sumOf = (select: (usage: UsageTelemetry) => number | undefined): number | undefined => {
    const present = usages.filter((usage) => typeof select(usage) === 'number');
    if (present.length === 0) {
      return undefined;
    }
    return usages.reduce((total, usage) => total + (select(usage) ?? 0), 0);
  };

  const allIncurredCostsKnown = usages.length === providerNodeCount
    && usages.every((usage) => typeof usage.costUsd === 'number');
  const hasIncompleteTelemetry = usages.length < providerNodeCount;
  return {
    source: 'actual',
    confidence: hasIncompleteTelemetry || !allIncurredCostsKnown
      ? 'unknown'
      : usages.reduce(
          (worst, usage) => (confidenceRank[usage.confidence] > confidenceRank[worst] ? usage.confidence : worst),
          'measured' as UsageTelemetry['confidence'],
        ),
    costUsd: allIncurredCostsKnown
      ? usages.reduce((total, usage) => total + (usage.costUsd ?? 0), 0)
      : undefined,
    inputTokens: sumOf((usage) => usage.inputTokens),
    outputTokens: sumOf((usage) => usage.outputTokens),
    totalTokens: sumOf((usage) => usage.totalTokens),
    characters: sumOf((usage) => usage.characters),
    durationSeconds: sumOf((usage) => usage.durationSeconds),
    imageCount: sumOf((usage) => usage.imageCount),
    notes: [
      executionNote,
      ...(!allIncurredCostsKnown
        ? ['Aggregate cost is omitted because at least one incurred internal provider cost is unknown.']
        : []),
      ...usages.flatMap((usage) => {
        const label = [usage.provider, usage.modelId].filter(Boolean).join(' ');
        return label ? [`Internal spend: ${label}.`] : [];
      }),
    ],
  };
}

async function executeApiFetchNode(
  node: AppNode,
  context: ExecutionContext,
  onStatus?: (statusMessage: string) => void,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  onStatus?.('Preparing API Web Request...');
  const rawUrl = String(context.prompt || node.data.url || '').trim();
  const method = String(node.data.method ?? 'GET').toUpperCase();
  const rawHeaders = String(node.data.headers ?? '').trim();
  const rawBody = String(node.data.body ?? '').trim();

  if (!rawUrl) {
    throw new NonRetryableError('API Requester node needs a valid URL to run.');
  }
  const url = validateApiRequesterUrl(rawUrl);
  assertApiRequesterCredentialsAreLive(rawHeaders, rawBody);

  // Headers#set has the fetch-standard, case-insensitive replacement semantics. A plain object
  // can carry both Content-Type and content-type, which fetch combines into an invalid value.
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (rawHeaders) {
    try {
      const lines = rawHeaders.split('\n');
      lines.forEach((line) => {
        const colonIndex = line.indexOf(':');
        if (colonIndex !== -1) {
          const name = line.substring(0, colonIndex).trim();
          const val = line.substring(colonIndex + 1).trim();
          if (name) headers.set(name, val);
        }
      });
    } catch (err) {
      throw new Error(`Failed to parse custom headers: ${(err as Error).message}`);
    }
  }

  // Format body
  let body: BodyInit | null = null;
  if (method !== 'GET' && rawBody) {
    if (rawBody.startsWith('{') || rawBody.startsWith('[')) {
      try {
        JSON.parse(rawBody);
        body = rawBody;
      } catch {
        body = rawBody;
      }
    } else {
      body = rawBody;
    }
  }

  onStatus?.(`Sending ${method} request…`);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? body : undefined,
      signal,
    });

    onStatus?.('Parsing API Response...');
    const text = await readBoundedApiResponse(response, signal);

    if (!response.ok) {
      // Server error pages can reflect credentials. Keep the useful status but never store the body.
      throw new HttpStatusError(response.status, 'API request failed');
    }

    const contentType = normalizeApiRequesterMimeType(response.headers.get('content-type'));
    if (contentType && !isApiRequesterTextMimeType(contentType)) {
      throw new NonRetryableError(
        `API Requester only accepts text or JSON responses; received ${contentType.split(';', 1)[0]}.`,
      );
    }
    let result: unknown = text;
    let resultType: ResultType = 'text';
    const declaredOutputType = node.data.declaredOutputType;

    if (declaredOutputType === 'json') {
      try {
        result = JSON.parse(text);
        resultType = 'json';
      } catch (error) {
        throw new NonRetryableError(
          'API Requester declared JSON output, but the response body is not valid JSON. Change Output type to Text or fix the endpoint response.',
          { cause: error },
        );
      }
    } else if (declaredOutputType !== 'text' && isApiRequesterJsonMimeType(contentType)) {
      try {
        result = JSON.parse(text);
        resultType = 'json';
      } catch {
        // Auto-detection is best-effort when no output type has been declared.
      }
    }

    return {
      result: typeof result === 'string' ? result : JSON.stringify(result),
      resultType,
      statusMessage: `Completed with status ${response.status}`,
      mimeType: contentType.split(';', 1)[0] || (resultType === 'json' ? 'application/json' : 'text/plain'),
      usage: {
        source: 'actual',
        confidence: 'unknown',
        provider: 'api-requester',
        notes: ['External API Requester pricing is not known to Sloom Studio.'],
      },
    };
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      throw isAbortError(err) ? err : createAbortError();
    }
    if (err instanceof NonRetryableError || err instanceof HttpStatusError) {
      throw err;
    }
    throw new Error(`Network request failed: ${redactApiRequesterMessage((err as Error).message)}`);
  }
}

const API_REQUESTER_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const API_REQUESTER_SECRET_QUERY_KEYS = /^(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret|token)$/i;

function validateApiRequesterUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new NonRetryableError('API Requester node needs an absolute HTTP or HTTPS URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new NonRetryableError('API Requester only permits HTTP and HTTPS URLs.');
  }
  if (parsed.username || parsed.password || [...parsed.searchParams.keys()].some((key) => API_REQUESTER_SECRET_QUERY_KEYS.test(key))) {
    throw new NonRetryableError('Put API credentials in request headers, not the URL.');
  }
  return parsed.toString();
}

function assertApiRequesterCredentialsAreLive(rawHeaders: string, rawBody: string): void {
  if (hasPersistedApiRequesterCredential(rawHeaders, rawBody)) {
    throw new NonRetryableError(
      'This API Requester contains redacted credentials from persisted data. Replace each redacted value before running it.',
    );
  }
}

function isApiRequesterTextMimeType(contentType: string): boolean {
  return isApiRequesterJsonMimeType(contentType) || contentType.startsWith('text/');
}

function normalizeApiRequesterMimeType(contentType: string | null): string {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function isApiRequesterJsonMimeType(mimeType: string): boolean {
  return mimeType === 'application/json' || mimeType === 'application/problem+json' || mimeType.endsWith('+json');
}

function hasPersistedApiRequesterCredential(rawHeaders: string, rawBody: string): boolean {
  for (const line of rawHeaders.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (isApiRequesterSensitiveHeaderName(name) && isPersistedApiRequesterCredential(value)) return true;
  }

  try {
    const visit = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(visit);
      if (!value || typeof value !== 'object') return false;
      return Object.entries(value).some(([key, entry]) => (
        (isApiRequesterCredentialFieldName(key) && isPersistedApiRequesterCredential(entry)) || visit(entry)
      ));
    };
    return visit(JSON.parse(rawBody));
  } catch {
    return rawBody.split('&').some((part) => {
      const separator = part.indexOf('=');
      if (separator < 0) return false;
      const rawKey = part.slice(0, separator);
      const rawValue = part.slice(separator + 1);
      let key = rawKey;
      let value = rawValue;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
        value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
      } catch {
        // A malformed form is submitted as-is; only an exact explicit marker blocks it.
      }
      return isApiRequesterCredentialFieldName(key) && isPersistedApiRequesterCredential(value);
    });
  }
}

/**
 * Read a response body as text with a hard overall byte ceiling. Both the DECLARED Content-Length and
 * the actually-streamed bytes are checked; an over-limit body rejects non-retryably before it is fully
 * buffered (and, for the declared case, before the body is read at all). The reader is cancelled and
 * its lock released on every exit, and an in-flight abort is surfaced as an AbortError, never swallowed.
 */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  overLimitMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    // Reject on the header alone, but first release the body best-effort so a large or stalled response
    // cannot keep consuming the connection after this early failure. The size error stays authoritative:
    // a cancel() that throws or rejects is swallowed and never replaces it, and it is called exactly once.
    if (response.body) {
      try {
        void Promise.resolve(response.body.cancel()).catch(() => undefined);
      } catch {
        // The size error below remains authoritative.
      }
    }
    throw new NonRetryableError(overLimitMessage);
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let cancelled = false;
  const cancelReaderOnce = (): void => {
    if (cancelled) return;
    cancelled = true;
    // `cancel()` is best-effort cleanup. Some hostile/broken stream implementations never
    // settle it; do not let that retain this run or its lock forever. Attach a rejection
    // handler immediately so a late failure cannot become an unhandled rejection.
    try {
      void Promise.resolve(reader.cancel()).catch(() => undefined);
    } catch {
      // The primary read/abort error remains authoritative.
    }
  };

  const readNext = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (signal?.aborted) {
      cancelReaderOnce();
      throw new DOMException('The run was cancelled.', 'AbortError');
    }

    if (!signal) return reader.read();

    return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      let settled = false;
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = () => {
        cancelReaderOnce();
        settle(() => reject(new DOMException('The run was cancelled.', 'AbortError')));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(reader.read()).then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  };

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('The run was cancelled.', 'AbortError');
      const { done, value } = await readNext();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        cancelReaderOnce();
        throw new NonRetryableError(overLimitMessage);
      }
      chunks.push(value);
    }
  } finally {
    if (signal?.aborted) cancelReaderOnce();
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function readBoundedApiResponse(response: Response, signal?: AbortSignal): Promise<string> {
  return readBoundedResponseText(
    response,
    API_REQUESTER_MAX_RESPONSE_BYTES,
    'API response exceeds the 5 MB safety limit.',
    signal,
  );
}

function redactApiRequesterMessage(message: string): string {
  return message
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|token|password|secret)=)[^\s&]+/gi, '$1[redacted]');
}

/**
 * Name the transport and upstream quota that own this operation start. Saved
 * nodes may omit their provider, so use the same per-node defaults as the
 * executors instead of collapsing those valid routes into one `default` queue.
 * Local transforms/endpoints get explicit zero-delay policies; Function/API
 * Requester/Composition nodes stay outside this scheduler before reaching here.
 */
export function resolveProviderStartPolicyKey(
  node: AppNode,
  settings: RuntimeSettingsSnapshot,
): string {
  const modelCardRef = parseModelCardRef(node.data.modelCardRef);
  if (modelCardRef) {
    const resolved = providerPackRegistry.resolveCard(modelCardRef, node.data.embeddedProviderPackSnapshots);
    const operationId = typeof node.data.modelCardOperationId === 'string'
      ? node.data.modelCardOperationId
      : resolved.card.operations[0]?.id;
    const builtInEngine = operationId
      ? resolveBuiltInEngine(resolved.pack, resolved.card, operationId)
      : undefined;
    if (!builtInEngine) return `provider-pack:${modelCardRef.packId}`;
  }
  let provider: string;
  switch (node.type) {
    case 'textNode':
      provider = (node.data.mode ?? 'prompt') === 'prompt'
        ? 'local'
        : ((node.data.provider as TextProvider | undefined) ?? 'gemini');
      break;
    case 'imageGen':
      provider = (node.data.provider as ImageProvider | undefined) ?? 'gemini';
      break;
    case 'videoGen':
      provider = (node.data.provider as VideoProvider | undefined) ?? 'gemini';
      break;
    case 'audioGen':
      provider = (node.data.provider as AudioProvider | undefined) ?? 'elevenlabs';
      break;
    case 'transcriptionNode':
      provider = 'elevenlabs';
      break;
    case 'audioProcessNode':
      provider = 'elevenlabs';
      break;
    case 'visionVerifyNode':
      provider = 'gemini';
      break;
    case 'cropImageNode':
      provider = 'local';
      break;
    default:
      provider = 'local';
      break;
  }

  return shouldProxyNodeExecution(node, settings)
    ? `backend-proxy:${provider}`
    : provider;
}

function shouldProxyNodeExecution(node: AppNode, settings: RuntimeSettingsSnapshot): boolean {
  const modelCardRef = parseModelCardRef(node.data.modelCardRef);
  if (modelCardRef) {
    const resolved = providerPackRegistry.resolveCard(modelCardRef, node.data.embeddedProviderPackSnapshots);
    const operationId = typeof node.data.modelCardOperationId === 'string'
      ? node.data.modelCardOperationId
      : resolved.card.operations[0]?.id;
    if (!operationId || !resolveBuiltInEngine(resolved.pack, resolved.card, operationId)) return false;
  }
  if (!shouldUseBackendProxy(settings.providerSettings)) return false;

  if (node.type === 'textNode') {
    // Prompt mode only publishes its saved text. It has no provider start and
    // must stay on-device even when generated-text routes use the proxy.
    return (node.data.mode ?? 'prompt') !== 'prompt';
  }

  if (node.type === 'imageGen') {
    // Android generation needs the paired device address/token that the proxy
    // DTO intentionally withholds. Local/Open remains proxy-capable because
    // its sanitized endpoint and selected model are explicitly forwarded.
    return ((node.data.provider as ImageProvider | undefined) ?? 'gemini') !== 'android';
  }

  return node.type === 'videoGen' ||
    node.type === 'audioGen' ||
    node.type === 'visionVerifyNode';
}

async function executeNodeViaBackendProxy(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const proxyBaseUrl = settings.providerSettings.backendProxyBaseUrl.trim();
  const request = buildBackendProxyExecuteRequest({
    baseUrl: proxyBaseUrl,
    node,
    context,
    settings: {
      defaultModels: settings.defaultModels,
      providerSettings: settings.providerSettings,
    },
  });

  onStatus?.('Submitting provider run through backend proxy…');

  const response = await fetch(request.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request.body),
    signal,
  });

  if (!response.ok) {
    throw new HttpStatusError(response.status, 'Backend proxy request failed');
  }

  const payload = await decodeBackendProxyExecutionPayload(response, signal);

  if (node.type === 'visionVerifyNode') {
    // Vision Verify shares the common versioned/legacy decoder — same version, status, usage, and
    // metadata (depth/size/JSON-safe) validation as every other result — and then layers its stricter
    // literal-Boolean and decision-agreement contract on top of the already-validated result.
    const decoded = decodeBackendProxyResultEnvelope(payload);
    const verification = validateBackendProxyVisionVerificationResult(decoded);
    const existingNotes = decoded.usage?.notes ?? [];
    const hasExplicitStatus = typeof payload.statusMessage === 'string' && payload.statusMessage.length > 0;
    return {
      result: verification.value,
      resultType: 'boolean',
      statusMessage: hasExplicitStatus ? decoded.statusMessage : `Verified: ${verification.value ? 'TRUE' : 'FALSE'}`,
      usage: {
        source: decoded.usage?.source ?? 'actual',
        confidence: decoded.usage?.confidence ?? 'unknown',
        ...decoded.usage,
        notes: verification.explanation && !existingNotes.includes(verification.explanation)
          ? [verification.explanation, ...existingNotes]
          : existingNotes,
      },
      outputMetadata: verification.outputMetadata,
    };
  }

  // Every remaining field of a full ExecutionResult (MIME/extension/file name, JSON-safe output
  // metadata, a reconstructed Blob, and ordered additionalResults) is validated and carried through
  // the versioned envelope so a proxied result is semantically equivalent to the same direct result.
  // A malformed or unsupported envelope is a processed terminal response: it throws a non-retryable
  // error here, and is never resubmitted through the outer retry wrapper.
  const decoded = decodeBackendProxyResultEnvelope(payload);
  // The generic decoder accepts any well-formed result type; the execution boundary additionally
  // demands the type each node's direct executor actually produces, so imageGen can never accept a
  // package/video envelope merely because it is well-formed.
  assertProxyResultTypeMatchesNode(node.type, decoded.resultType);
  return decoded;
}

/** The single result type each proxied node's direct executor produces (Vision Verify handled separately). */
const PROXIED_NODE_RESULT_TYPE: Partial<Record<AppNode['type'], ResultType>> = {
  textNode: 'text',
  imageGen: 'image',
  videoGen: 'video',
  audioGen: 'audio',
};

function assertProxyResultTypeMatchesNode(nodeType: AppNode['type'], resultType: ResultType): void {
  const expected = PROXIED_NODE_RESULT_TYPE[nodeType];
  if (expected === undefined) {
    throw new NonRetryableError(`Backend proxy returned a result for an unsupported node type: ${String(nodeType)}.`);
  }
  if (resultType !== expected) {
    throw new NonRetryableError(`Backend proxy returned a ${resultType} result for a ${String(nodeType)} node, which requires ${expected}.`);
  }
}

type BackendProxyExecutionPayload = Record<string, unknown> & Partial<ExecutionResult>;

/**
 * Once a proxy has replied 200, the provider run has been processed and must never be re-submitted
 * merely because its response cannot be decoded. The body is read through a bounded streaming reader
 * (one named overall wire cap) so an oversized declared Content-Length or streamed body is rejected
 * non-retryably BEFORE any JSON allocation. Transport/network failures stay outside this boundary so
 * their existing retry policy is unchanged; an in-flight abort surfaces as an AbortError.
 */
async function decodeBackendProxyExecutionPayload(
  response: Response,
  signal?: AbortSignal,
): Promise<BackendProxyExecutionPayload> {
  const wireText = await readBoundedResponseText(
    response,
    MAX_BACKEND_PROXY_RESULT_WIRE_BYTES,
    `Backend proxy completed the request but its response exceeds the ${MAX_BACKEND_PROXY_RESULT_WIRE_BYTES}-byte safety limit.`,
    signal,
  );

  let payload: unknown;
  try {
    payload = JSON.parse(wireText);
  } catch (cause) {
    throw new NonRetryableError('Backend proxy completed the request but returned malformed JSON.', { cause });
  }

  if (!isRecord(payload) || Array.isArray(payload)) {
    throw new NonRetryableError('Backend proxy completed the request but returned an invalid execution payload.');
  }

  return payload as BackendProxyExecutionPayload;
}

/**
 * Vision Verify is deliberately stricter than direct/Vertex text parsing: the proxy protocol transports
 * a typed decision, so its result must already be a literal Boolean. This runs on the ALREADY-decoded
 * result (the common envelope decoder has validated version, the literal-Boolean primary, status, usage,
 * and metadata bounds, and rejected any provider error); here we add the decision-agreement contract —
 * metadata repeats the typed decision for downstream auditability and must agree exactly with the primary.
 */
function validateBackendProxyVisionVerificationResult(
  decoded: DecodedBackendProxyResult,
): { value: boolean; explanation: string; outputMetadata: Record<string, unknown> } {
  if (decoded.resultType !== 'boolean' || typeof decoded.result !== 'boolean') {
    throw new NonRetryableError('Backend proxy returned a Vision Verify result that is not a literal Boolean.');
  }
  const metadata = decoded.outputMetadata;
  if (!isRecord(metadata) || Array.isArray(metadata)) {
    throw new NonRetryableError('Backend proxy returned Vision Verify without required Boolean decision metadata.');
  }
  if (typeof metadata.decision !== 'boolean' || metadata.resultType !== 'boolean') {
    throw new NonRetryableError('Backend proxy returned incomplete Vision Verify Boolean decision metadata.');
  }
  if (metadata.decision !== decoded.result) {
    throw new NonRetryableError('Backend proxy returned contradictory Vision Verify Boolean decisions.');
  }

  return { value: decoded.result, explanation: '', outputMetadata: metadata };
}

async function executeVisionVerifyNode(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const modelId = node.data.modelId ?? 'gemini-3.5-flash';

  onStatus?.(`Initializing multimodal verification with ${modelId}…`);

  const prompt = context.prompt || 'Verify consistency';
  const image = context.editImageInput;
  const refImage = context.refImageInput;

  if (!image) {
    throw new NonRetryableError('Vision Verification requires an input image to analyze. Connect an image to verify.');
  }

  let verificationPrompt = '';
  const geminiParts: Array<{ text: string } | { inlineData: Awaited<ReturnType<typeof dataUrlToInlineImage>> }> = [];

  if (refImage) {
    verificationPrompt = [
      'You are a visual consistency and character verification agent.',
      'You are provided with two images:',
      '1. Subject Image (the generated panel or scene)',
      '2. Reference Image (the reference character design or item)',
      '',
      'Compare both images side-by-side.',
      'Verify if the character, item, or style shown in the Reference Image is consistent with and present inside the Subject Image.',
      'You must respond in exactly this format:',
      'Line 1: exactly the word "true" if consistent, or "false" if inconsistent',
      'Line 2: a brief one-sentence reason explaining why.',
      '',
      `ADDITIONAL GUIDANCE / TEXT DESCRIPTION:`,
      prompt,
    ].join('\n');

    geminiParts.push(
      { text: verificationPrompt },
      { inlineData: await dataUrlToInlineImage(image, signal) },
      { inlineData: await dataUrlToInlineImage(refImage, signal) }
    );
  } else {
    verificationPrompt = [
      'You are a visual consistency and verification agent.',
      'Compare the provided image with the description below.',
      'Determine if the image content and characters match the description.',
      'You must respond in exactly this format:',
      'Line 1: exactly the word "true" if consistent, or "false" if inconsistent',
      'Line 2: a brief one-sentence reason explaining why.',
      '',
      `TEXT DESCRIPTION:`,
      prompt,
    ].join('\n');

    geminiParts.push(
      { text: verificationPrompt },
      { inlineData: await dataUrlToInlineImage(image, signal) }
    );
  }

  if (settings.providerSettings.geminiCredentialMode === 'vertex-adc') {
    const responseText = (await executeVertexGeminiTextContent({
      modelId,
      settings,
      body: buildVertexGeminiGenerateContentBody({
        parts: geminiParts,
        config: {},
      }),
      label: 'Vertex Gemini vision verification',
      signal,
    }));
    const verification = parseVisionVerificationResponse(responseText);

    return {
      result: verification.value,
      resultType: 'boolean',
      statusMessage: `Verified: ${verification.value ? 'TRUE' : 'FALSE'}`,
      usage: {
        source: 'actual',
        confidence: 'unknown',
        provider: 'gemini',
        modelId,
        notes: [verification.explanation, 'Generated through Vertex AI desktop auth.'],
      },
    };
  }

  const apiKey = settings.apiKeys.gemini?.trim();
  if (!apiKey) {
    throw new NonRetryableError('Gemini API key is required. Add it in settings.');
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: modelId,
    contents: geminiParts,
    config: { abortSignal: signal },
  });

  const verification = parseVisionVerificationResponse(response.text);

  return {
    result: verification.value,
    resultType: 'boolean',
    statusMessage: `Verified: ${verification.value ? 'TRUE' : 'FALSE'}`,
    usage: {
      source: 'actual',
      confidence: finiteUsageNumber(response.usageMetadata?.promptTokenCount) !== undefined
        || finiteUsageNumber(response.usageMetadata?.totalTokenCount) !== undefined
        ? 'measured'
        : 'unknown',
      provider: 'gemini',
      modelId,
      ...(finiteUsageNumber(response.usageMetadata?.promptTokenCount) !== undefined
        ? { inputTokens: response.usageMetadata?.promptTokenCount }
        : {}),
      ...(finiteUsageNumber(response.usageMetadata?.totalTokenCount) !== undefined
        ? { totalTokens: response.usageMetadata?.totalTokenCount }
        : {}),
      notes: [verification.explanation],
    },
  };
}

/**
 * Gemini is instructed to emit the decision on line one and a human-readable
 * explanation after it. Keep that provider parsing contract, but turn the
 * decision into the actual Boolean carried by the Flow port.
 */
export function parseVisionVerificationResponse(response: unknown): { value: boolean; explanation: string } {
  if (typeof response === 'boolean') {
    return { value: response, explanation: '' };
  }

  if (typeof response !== 'string') {
    throw new NonRetryableError('Vision Verify returned no Boolean decision.');
  }

  const trimmed = response.trim();
  if (!trimmed) {
    throw new NonRetryableError('Vision Verify returned an empty Boolean decision.');
  }

  const lines = trimmed.split(/\r?\n/);
  const decisionLine = lines[0]?.trim() ?? '';
  if (!/^(true|false)$/i.test(decisionLine)) {
    throw new NonRetryableError('Vision Verify returned an invalid Boolean decision. Expected exactly true or false on the first decision line.');
  }

  // A later standalone decision is not an explanation. Reject it rather than
  // silently accepting a contradictory provider response after a paid call.
  if (lines.slice(1).some((line) => /^(true|false)$/i.test(line.trim()))) {
    throw new NonRetryableError('Vision Verify returned contradictory Boolean decisions.');
  }

  return {
    value: decisionLine.toLowerCase() === 'true',
    explanation: lines.slice(1).join('\n').trim(),
  };
}

async function executeCropImageNode(
  node: AppNode,
  context: ExecutionContext,
  onStatus?: (statusMessage: string) => void,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const sourceImageInput = context.editImageInput;
  if (!sourceImageInput) {
    throw new NonRetryableError('Crop Image nodes need one connected image input.');
  }

  onStatus?.('Cropping image locally…');
  const cropResult = await cropImageDataUrl(
    sourceImageInput,
    resolveCropImageNodeSettings(node.data),
    { mimeType: 'image/png', signal },
  );

  return {
    result: cropResult.dataUrl,
    resultType: 'image',
    statusMessage: `Cropped image to ${cropResult.width}x${cropResult.height}`,
    usage: createLocalImageCropUsage('actual'),
    mimeType: cropResult.mimeType,
    extension: 'png',
    outputMetadata: {
      cropRect: cropResult.rect,
      height: cropResult.height,
      width: cropResult.width,
    },
  };
}

function createReportedTextUsage(
  provider: TextProvider,
  modelId: string,
  reported: { inputTokens?: number; outputTokens?: number; totalTokens?: number },
): UsageTelemetry {
  const inputTokens = finiteUsageNumber(reported.inputTokens);
  const outputTokens = finiteUsageNumber(reported.outputTokens);
  const totalTokens = finiteUsageNumber(reported.totalTokens);
  if (inputTokens !== undefined && outputTokens !== undefined) {
    return {
      ...createMeasuredTextUsage(provider, modelId, { inputTokens, outputTokens }),
      ...(totalTokens !== undefined ? { totalTokens } : {}),
    };
  }

  const hasMeasuredCount = inputTokens !== undefined || outputTokens !== undefined || totalTokens !== undefined;
  return {
    source: 'actual',
    confidence: hasMeasuredCount ? 'measured' : 'unknown',
    provider,
    modelId,
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    notes: ['The provider omitted one or more token counts, so missing counts and pricing remain unknown.'],
  };
}

function finiteUsageNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function executeTextNode(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const mode = node.data.mode ?? 'prompt';
  const promptText = (node.data.prompt ?? '').trim();

  if (mode === 'prompt') {
    if (!promptText) {
      throw new NonRetryableError('Prompt nodes need text before they can feed the flow.');
    }

    return {
      result: promptText,
      resultType: 'text',
      statusMessage: 'Prompt ready',
    };
  }

  const provider = (node.data.provider as TextProvider | undefined) ?? 'gemini';
  const modelId = getModelId(settings, 'text', provider, node.data.modelId);
  const modelContract = getTextModelContract(provider, modelId);
  const combinedPrompt = composePrompt(context.prompt, promptText);
  const textMediaInputs = normalizeTextMediaInputs(context);
  const textImageInputs = textMediaInputs.filter(isImageMediaInput).map((input) => input.url);
  const unsupportedTextMediaInputs = textMediaInputs.filter((input) => !isGeminiTextMediaInputSupported(input));
  const unsupportedModelInputs = textMediaInputs.filter((input) => {
    const modality = textMediaInputModality(input);
    return !modality || !modelContract.inputModalities.includes(modality);
  });
  const effectivePrompt = combinedPrompt || (textMediaInputs.length > 0 ? 'Analyze the connected media in detail.' : '');
  const systemPrompt = (node.data.systemPrompt ?? '').trim();

  if (!effectivePrompt) {
    throw new NonRetryableError('Connect a prompt source or enter an instruction in this text node.');
  }

  if (unsupportedModelInputs.length > 0) {
    const labels = unsupportedModelInputs
      .map((input) => input.label ?? input.mimeType ?? input.kind ?? 'media')
      .join(', ');
    throw new NonRetryableError(`${modelContract.displayName} cannot accept these connected inputs on its configured Flow route: ${labels}.`);
  }

  switch (provider) {
    case 'gemini': {
      if (unsupportedTextMediaInputs.length > 0) {
        const labels = unsupportedTextMediaInputs
          .map((input) => input.label ?? input.mimeType ?? input.kind ?? 'media')
          .join(', ');
        throw new NonRetryableError(`Gemini text analysis does not support this media input yet: ${labels}.`);
      }

      const mediaResolution = modelContract.parameters.some((parameter) => parameter.id === 'mediaResolution')
        ? node.data.geminiMediaResolution
        : undefined;
      const mediaParts = await Promise.all(
        textMediaInputs.map(async (input) => {
          const inlineData = await dataUrlToInlineData(
            input.url,
            input.mimeType ?? getDefaultGeminiTextMimeType(input.kind) ?? 'application/octet-stream',
            undefined,
            signal,
          );

          return buildGeminiTextInlinePart({
            data: inlineData.data,
            mimeType: inlineData.mimeType,
            mediaResolution,
          });
        }),
      );
      const geminiConfig = {
        ...buildGeminiTextConfig(node.data, modelId),
        systemInstruction: systemPrompt || undefined,
        abortSignal: signal,
      } as GenerateContentConfig;
      const geminiContents = [
        ...mediaParts,
        { text: effectivePrompt },
      ] as unknown as PartUnion[];

      if (settings.providerSettings.geminiCredentialMode === 'vertex-adc') {
        onStatus?.(textMediaInputs.length > 0 ? 'Analyzing media with Vertex Gemini…' : 'Generating text with Vertex Gemini…');
        const result = await executeVertexGeminiTextContent({
          modelId,
          settings,
          body: buildVertexGeminiGenerateContentBody({
            parts: geminiContents as unknown[],
            config: buildGeminiTextConfig(node.data, modelId),
            systemPrompt,
          }),
          label: 'Vertex Gemini text',
          signal,
        });

        return {
          result,
          resultType: 'text',
          statusMessage: `Generated with ${modelId}`,
        };
      }

      onStatus?.(textMediaInputs.length > 0 ? 'Analyzing media with Gemini…' : 'Generating text with Gemini…');
      const { GoogleGenAI } = await loadProviderModule(
        () => import('@google/genai'),
        'Google Gemini text',
      );
      const apiKey = requireApiKey(settings.apiKeys.gemini, 'Google Gemini');
      const client = new GoogleGenAI({
        apiKey,
        ...(mediaResolution && mediaResolution !== 'default' ? { apiVersion: 'v1alpha' } : {}),
      });
      const response = await client.models.generateContent({
        model: modelId,
        contents: geminiContents,
        config: geminiConfig,
      });
      const usage = response.usageMetadata;
      const result = extractGeminiTextResponse(response);

      if (!result) {
        throw new Error('Gemini returned an empty text response.');
      }

      return {
        result,
        resultType: 'text',
        statusMessage: `Generated with ${modelId}`,
        usage:
          usage
            ? createReportedTextUsage('gemini', modelId, {
                inputTokens: usage.promptTokenCount,
                outputTokens: usage.candidatesTokenCount,
                totalTokens: usage.totalTokenCount,
              })
            : undefined,
      };
    }
    case 'openai': {
      const unsupportedOpenAIInputs = textMediaInputs.filter((input) => !isImageMediaInput(input));

      if (unsupportedOpenAIInputs.length > 0) {
        throw new NonRetryableError('Audio, video, and document-to-text analysis are wired for Gemini text models in this app.');
      }

      onStatus?.(textImageInputs.length > 0 ? 'Analyzing image with OpenAI…' : 'Generating text with OpenAI…');
      const { default: OpenAI } = await loadProviderModule(
        () => import('openai'),
        'OpenAI text',
      );
      const apiKey = requireApiKey(settings.apiKeys.openai, 'OpenAI');
      const client = new OpenAI({
        apiKey,
        baseURL: normalizeOptionalString(settings.providerSettings.openaiBaseUrl),
        dangerouslyAllowBrowser: true,
      });
      const response = await client.chat.completions.create({
        model: modelId,
        messages: await buildOpenAITextMessages(systemPrompt, effectivePrompt, textImageInputs),
      }, { signal });
      const message = response.choices[0]?.message?.content;
      const result = typeof message === 'string' ? message.trim() : '';

      if (!result) {
        throw new Error('OpenAI returned an empty text response.');
      }

      return {
        result,
        resultType: 'text',
        statusMessage: `Generated with ${modelId}`,
        usage:
          response.usage
            ? createMeasuredTextUsage('openai', modelId, {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
              })
            : undefined,
      };
    }
    case 'huggingface': {
      if (textMediaInputs.length > 0) {
        throw new NonRetryableError('Media-to-text analysis is currently wired for Gemini and OpenAI text models in this app.');
      }

      onStatus?.('Generating text with Hugging Face…');
      const { HfInference } = await loadProviderModule(
        () => import('@huggingface/inference'),
        'Hugging Face text',
      );
      const apiKey = requireApiKey(settings.apiKeys.huggingface, 'Hugging Face');
      const client = new HfInference(apiKey);
      const response = await client.chatCompletion({
        model: modelId,
        messages: buildChatMessages(systemPrompt, effectivePrompt),
      }, { signal });
      const content = response.choices?.[0]?.message?.content;
      const result = extractTextContent(content);

      if (!result) {
        throw new Error('Hugging Face returned an empty text response.');
      }

      return {
        result,
        resultType: 'text',
        statusMessage: `Generated with ${modelId}`,
      };
    }
  }
}

async function executeImageNode(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
  abortSignal?: AbortSignal,
): Promise<ExecutionResult> {
  const provider = (node.data.provider as ImageProvider | undefined) ?? 'gemini';
  const modelId = getModelId(settings, 'image', provider, node.data.modelId);
  const prompt = context.prompt.trim();
  const sourceImageInput = context.editImageInput;
  const maskImageInput = context.editMaskImageInput;
  // The structured groups are authoritative when present; the flat ordered list only serves
  // contexts authored before AUD-011 (and providers that need nothing but the image bytes).
  const referenceGroups = context.referenceGroups;
  const referenceImageInputs = referenceGroups
    ? referenceGroups.flatMap((group) => group.imageUrl ? [group.imageUrl] : [])
    : (context.editReferenceImageInputs ?? []);
  const sourceVideoInput = context.sourceVideoInput;
  const videoFrameSelection = ((node.data.videoFrameSelection as 'first' | 'last' | undefined) ?? 'last');
  const modelDefinition = getImageModelDefinition(provider, modelId);

  if (sourceVideoInput) {
    onStatus?.(`Extracting ${videoFrameSelection} video frame locally…`);
    const sourceVideo = await fetchDownstreamMediaBlob(sourceVideoInput, {
      kind: 'video',
      errorLabel: 'Upstream video reference could not be materialized',
    }, abortSignal);
    const sourceVideoUrl = URL.createObjectURL(sourceVideo.blob);
    let frameBlob: Blob;
    try {
      frameBlob = await raceWithAbort(
        extractSelectedVideoFrame(sourceVideoUrl, videoFrameSelection),
        abortSignal,
      );
    } finally {
      URL.revokeObjectURL(sourceVideoUrl);
    }

    return {
      result: await toResultUrl(frameBlob),
      resultType: 'image',
      statusMessage: `Extracted ${videoFrameSelection} frame from upstream video`,
      usage: createLocalFrameExtractionUsage('actual'),
    };
  }

  if (!prompt) {
    throw new NonRetryableError('Image nodes need an upstream text prompt. Connect text and optionally an image to edit.');
  }

  if (sourceImageInput && !supportsImageEditing(provider, modelId)) {
    throw new NonRetryableError('The selected image model does not currently support upstream image editing in this app.');
  }

  if (maskImageInput && !supportsTrueMaskInpaint(provider, modelId)) {
    throw new NonRetryableError('The selected image model does not accept an explicit mask input. Choose a mask-aware image edit model.');
  }

  if (referenceImageInputs.length > modelDefinition.capabilities.maxReferenceImages) {
    throw new NonRetryableError(`${modelDefinition.label} supports at most ${modelDefinition.capabilities.maxReferenceImages} reference image${modelDefinition.capabilities.maxReferenceImages === 1 ? '' : 's'}.`);
  }

  if (referenceImageInputs.length > 0 && !supportsImageReferenceGuidance(provider, modelId)) {
    throw new NonRetryableError('The selected image model does not accept reference-image guidance.');
  }

  // Structured-group bounds fail closed BEFORE any provider submission: a guidance-only slot has
  // no image to describe, an out-of-range slot exceeds what the model can associate, and textual
  // guidance on a reference-incapable model would otherwise be silently flattened or dropped.
  for (const group of referenceGroups ?? []) {
    if (!group.imageUrl && referenceGroupHasGuidance(group)) {
      throw new NonRetryableError(`Reference ${group.slot} has text/JSON guidance but no image. Connect an image to Reference ${group.slot} or move the guidance to the prompt input.`);
    }
    if (group.slot > modelDefinition.capabilities.maxReferenceImages) {
      throw new NonRetryableError(`Reference ${group.slot} exceeds ${modelDefinition.label}'s limit of ${modelDefinition.capabilities.maxReferenceImages} reference image${modelDefinition.capabilities.maxReferenceImages === 1 ? '' : 's'}. Move its connections to a lower-numbered reference input.`);
    }
  }
  if ((referenceGroups ?? []).some(referenceGroupHasGuidance) && !supportsImageReferenceGuidance(provider, modelId)) {
    throw new NonRetryableError('The selected image model does not accept reference-image guidance.');
  }

  const operationPrompt = buildImageOperationPrompt(prompt, node.data);

  switch (provider) {
    case 'gemini': {
      onStatus?.(
        sourceImageInput
          ? 'Editing image with Gemini…'
          : referenceImageInputs.length > 0
            ? 'Generating reference-guided image with Gemini…'
            : 'Generating image with Gemini…',
      );
      const geminiAspectRatio = getSupportedImageAspectRatio('gemini', modelId, context.config.aspectRatio);
      // Gemini 3.x image models take image_size ('1K'/'2K'/'4K'); guard on the model so a stale node
      // field can never reach a model (2.5 / Imagen) that rejects the parameter.
      const geminiImageSize = supportsGeminiImageSizeTiers(modelId)
        ? (node.data.imageResolutionTier as '1K' | '2K' | '4K' | undefined)
        : undefined;

      if (isVertexImagenModelId(modelId) && settings.providerSettings.geminiCredentialMode !== 'vertex-adc') {
        throw new NonRetryableError('Imagen models require Vertex AI mode. Enable Vertex mode in Settings and set the Vertex project ID.');
      }

      if (settings.providerSettings.geminiCredentialMode === 'vertex-adc') {
        return executeVertexImageNode({
          modelId,
          prompt: operationPrompt,
          aspectRatio: geminiAspectRatio,
          imageSize: geminiImageSize,
          sourceImageInput,
          referenceImageInputs,
          referenceGroups,
          settings,
          onStatus,
          abortSignal,
        });
      }

      const { GoogleGenAI } = await loadProviderModule(
        () => import('@google/genai'),
        'Google Gemini image',
      );
      const apiKey = requireApiKey(settings.apiKeys.gemini, 'Google Gemini');
      const client = new GoogleGenAI({ apiKey });
      const geminiParts: Array<{ text: string } | { inlineData: Awaited<ReturnType<typeof dataUrlToInlineImage>> }> = [{
          text: buildGeminiImagePrompt(operationPrompt, {
            hasSourceImage: Boolean(sourceImageInput),
            referenceImageCount: referenceImageInputs.length,
          }),
      }];

      if (sourceImageInput) {
        geminiParts.push({
          inlineData: await dataUrlToInlineImage(sourceImageInput, abortSignal),
        });
      }

      for (const referenceEntry of collectReferencePartEntries(referenceGroups, referenceImageInputs)) {
        // Guidance rides as its own text part immediately BEFORE the image it describes, so the
        // numbered association is explicit and positional; image-only slots stay byte-identical
        // to the legacy flat request.
        if (referenceEntry.instruction) {
          geminiParts.push({ text: referenceEntry.instruction });
        }
        geminiParts.push({
          inlineData: await dataUrlToInlineImage(referenceEntry.url, abortSignal),
        });
      }

      const response = await client.models.generateContent({
        model: modelId,
        contents: [{
          parts: geminiParts,
        }],
        config: {
          abortSignal,
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: geminiAspectRatio,
            ...(geminiImageSize ? { imageSize: geminiImageSize } : {}),
          },
        },
      });
      const imagePart = extractGeminiInlineData(response);

      if (!imagePart) {
        throw new Error('Gemini returned text only. Try a more explicit image-generation prompt.');
      }

      return applyConfiguredAutoUpscaleIfRequested({
        node,
        settings,
        context,
        result: {
        result: `data:${imagePart.mimeType};base64,${imagePart.data}`,
        resultType: 'image',
        statusMessage: `Generated with ${modelId}`,
        usage: createGeminiImageUsage(
          modelId,
          operationPrompt,
          geminiAspectRatio,
          'actual',
          response.usageMetadata?.promptTokenCount,
        ),
        },
        onStatus,
        abortSignal,
      });
    }
    case 'openai': {
      return executeOpenAiCompatibleImageNode({
        provider: 'openai',
        modelId,
        prompt: operationPrompt,
        sourceImageInput,
        maskImageInput,
        referenceImageInputs,
        referenceGroups,
        context,
        node,
        settings,
        onStatus,
        abortSignal,
      });
    }
    case 'atlas': {
      if (isAtlasNativeImageModelId(modelId)) {
        return applyConfiguredAutoUpscaleIfRequested({
          node,
          settings,
          context,
          result: await executeAtlasNativeImageNode({
            modelId,
            prompt: operationPrompt,
            context,
            node,
            settings,
            sourceImageInput,
            maskImageInput,
            referenceImageInputs,
            referenceGroups,
            onStatus,
            abortSignal,
          }),
          onStatus,
          abortSignal,
        });
      }

      return executeOpenAiCompatibleImageNode({
        provider: 'atlas',
        modelId,
        prompt: operationPrompt,
        sourceImageInput,
        maskImageInput,
        referenceImageInputs,
        referenceGroups,
        context,
        node,
        settings,
        onStatus,
        abortSignal,
      });
    }
    case 'byteplus': {
      // FIRST-PARTY BytePlus/ModelArk (Seedream). This Flow route intentionally exposes only the
      // documented Image Generation API; edit/reference controls stay blocked until their request
      // contract is represented explicitly rather than inferred from a model name.
      if (sourceImageInput || referenceImageInputs.length > 0) {
        throw new NonRetryableError('BytePlus Seedream currently supports text-to-image generation in Sloom Studio; image editing and reference guidance are pending the ModelArk edit API.');
      }
      onStatus?.('Generating image with BytePlus…');
      const apiKey = requireApiKey(settings.apiKeys.byteplus ?? '', 'BytePlus');
      const baseUrl = normalizeBytePlusBaseUrl(settings.providerSettings.bytePlusBaseUrl);
      const bytePlusWidth = coerceOptionalNumber(node.data.imageWidth);
      const bytePlusHeight = coerceOptionalNumber(node.data.imageHeight);
      const urlOrData = await bytePlusGenerateImage({
        apiKey,
        baseUrl,
        modelId,
        prompt: operationPrompt,
        size: bytePlusWidth !== undefined && bytePlusHeight !== undefined
          ? `${Math.round(bytePlusWidth)}x${Math.round(bytePlusHeight)}`
          : undefined,
        seed: coerceOptionalNumber(node.data.imageSeed),
        signal: abortSignal,
      });
      const bytePlusResult = urlOrData.startsWith('data:')
        ? { result: urlOrData, resultType: 'image' as const, statusMessage: `Generated with ${modelId}` }
        : await (async () => {
            const materialized = await materializeRemoteMediaResult(urlOrData, 'BytePlus result download failed', undefined, abortSignal);
            return { result: materialized.result, resultType: 'image' as const, mimeType: materialized.mimeType, statusMessage: `Generated with ${modelId}` };
          })();
      return applyConfiguredAutoUpscaleIfRequested({ node, settings, context, result: bytePlusResult, onStatus, abortSignal });
    }
    case 'huggingface': {
      if (sourceImageInput || referenceImageInputs.length > 0) {
        throw new NonRetryableError('Hugging Face image models are text-to-image only in Sloom Studio. For source or reference-image edits choose a Gemini, OpenAI, Atlas, BFL, Stability, or Local/Open edit model.');
      }

      onStatus?.('Generating image with Hugging Face…');
      const { HfInference } = await loadProviderModule(
        () => import('@huggingface/inference'),
        'Hugging Face image',
      );
      const apiKey = requireApiKey(settings.apiKeys.huggingface, 'Hugging Face');
      const client = new HfInference(apiKey);
      const { width, height } = mapAspectRatioToImageDimensions(context.config.aspectRatio);
      // negative_prompt / seed / guidance_scale are first-class HF text-to-image parameters; the
      // node already collects them (they previously fed only Atlas), so pass them through when set.
      const hfNegativePrompt = normalizeOptionalString(node.data.imageNegativePrompt as string | undefined);
      const hfSeed = coerceOptionalNumber(node.data.imageSeed);
      const hfGuidanceScale = coerceOptionalNumber(node.data.imageGuidanceScale);
      const blob = await client.textToImage({
        model: modelId,
        inputs: operationPrompt,
        parameters: {
          num_inference_steps: context.config.steps,
          width,
          height,
          ...(hfNegativePrompt ? { negative_prompt: hfNegativePrompt } : {}),
          ...(hfSeed !== undefined ? { seed: Math.max(0, Math.floor(hfSeed)) } : {}),
          ...(hfGuidanceScale !== undefined ? { guidance_scale: hfGuidanceScale } : {}),
        },
      }, { signal: abortSignal });

      return applyConfiguredAutoUpscaleIfRequested({
        node,
        settings,
        context,
        result: {
        result: await toResultUrl(blob),
        resultType: 'image',
        statusMessage: `Generated with ${modelId}`,
        },
        onStatus,
        abortSignal,
      });
    }
    case 'bfl':
      return applyConfiguredAutoUpscaleIfRequested({
        node,
        settings,
        context,
        result: await executeBflImageNode({
        modelId,
        prompt: operationPrompt,
        aspectRatio: getSupportedImageAspectRatio('bfl', modelId, context.config.aspectRatio),
        outputFormat: context.config.imageOutputFormat,
        seed: coerceOptionalNumber(node.data.imageSeed),
        sourceImageInput,
        referenceImageInputs,
        referenceGroups,
        apiKey: requireApiKey(settings.apiKeys.bfl ?? '', 'Black Forest Labs'),
        settings,
        onStatus,
        abortSignal,
        }),
        onStatus,
        abortSignal,
      });
    case 'stability':
      return applyConfiguredAutoUpscaleIfRequested({
        node,
        settings,
        context,
        result: await executeStabilityImageNode({
        modelId,
        prompt: operationPrompt,
        context,
        nodeData: node.data,
        sourceImageInput,
        maskImageInput,
        apiKey: requireApiKey(settings.apiKeys.stability ?? '', 'Stability AI'),
        settings,
        onStatus,
        abortSignal,
        }),
        onStatus,
        abortSignal,
      });
    case 'localOpen':
      return applyConfiguredAutoUpscaleIfRequested({
        node,
        settings,
        context,
        result: await executeLocalOpenImageNode({
        modelId,
        prompt: operationPrompt,
        context,
        settings,
        sourceImageInput,
        maskImageInput,
        referenceImageInputs,
        referenceGroups,
        onStatus,
        abortSignal,
        }),
        onStatus,
        abortSignal,
      });
    case 'android':
      return applyConfiguredAutoUpscaleIfRequested({
        node,
        settings,
        context,
        result: await executeAndroidAcceleratorImageNode({
          modelId,
          prompt: operationPrompt,
          context,
          settings,
          seed: coerceOptionalNumber(node.data.imageSeed),
          onStatus,
          abortSignal,
        }),
        onStatus,
        abortSignal,
      });
  }
}

interface BflCreateResponse {
  id?: string;
  polling_url?: string;
  cost?: number | null;
  error?: string | { message?: string };
}

interface BflPollResponse {
  status?: string;
  result?: {
    sample?: string;
  };
  error?: string | { message?: string };
}

interface AtlasCreateResponse {
  id?: string;
  prediction_id?: string;
  output?: string | string[];
  outputs?: string[];
  image?: string;
  images?: string[];
  result?: string | string[];
  error?: string | { message?: string };
  data?: {
    id?: string;
    prediction_id?: string;
    output?: string | string[];
    outputs?: string[];
    image?: string;
    images?: string[];
    result?: string | string[];
    error?: string | { message?: string };
  };
}

interface AtlasPollResponse extends AtlasCreateResponse {
  status?: string;
  data?: AtlasCreateResponse['data'] & {
    status?: string;
  };
}

interface AtlasUploadResponse {
  url?: string;
  download_url?: string;
  data?: {
    url?: string;
    download_url?: string;
  };
}

const ATLAS_NATIVE_IMAGE_MODEL_IDS = new Set([
  'black-forest-labs/flux-schnell',
  'black-forest-labs/flux-dev',
  'black-forest-labs/flux-dev-lora',
  'z-image/turbo',
  'bytedance/seedream-v5.0-lite',
  'google/nano-banana-pro/text-to-image',
  'black-forest-labs/flux-kontext-dev',
  'bytedance/seedream-v5.0-lite/edit',
  'atlascloud/qwen-image/edit',
]);

async function executeAtlasNativeImageNode(input: {
  modelId: string;
  prompt: string;
  context: ExecutionContext;
  node: AppNode;
  settings: RuntimeSettingsSnapshot;
  sourceImageInput?: string;
  maskImageInput?: string;
  referenceImageInputs: string[];
  referenceGroups?: FlowReferenceGroup[];
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  throwIfAborted(input.abortSignal);
  const definition = getImageModelDefinition('atlas', input.modelId);
  const isEditOperation = Boolean(input.sourceImageInput || input.maskImageInput || input.referenceImageInputs.length > 0);

  if (!isEditOperation && !definition.capabilities.textToImage) {
    throw new NonRetryableError(`${definition.label} needs a connected source image. Choose an Atlas text-to-image model for prompt-only generation.`);
  }

  const apiKey = requireApiKey(input.settings.apiKeys.atlas ?? '', 'Atlas');
  const baseUrl = normalizeAtlasBaseUrl(input.settings.providerSettings.atlasBaseUrl);
  const aspectRatio = getSupportedImageAspectRatio('atlas', input.modelId, input.context.config.aspectRatio);
  // Custom width/height (px) from the node override the aspect-ratio preset for models that accept an
  // arbitrary output size (capabilities.customDimensions); clamp to a sane 64–4096 range, else fall back.
  const presetDimensions = mapAspectRatioToImageDimensions(aspectRatio);
  const customDimension = (value: unknown): number | undefined => {
    const parsed = coerceOptionalNumber(value);
    return parsed !== undefined && parsed >= 64 && parsed <= 4096 ? Math.round(parsed) : undefined;
  };
  const width = customDimension(input.node.data.imageWidth) ?? presetDimensions.width;
  const height = customDimension(input.node.data.imageHeight) ?? presetDimensions.height;
  const sourceImage = input.sourceImageInput
    ? await uploadAtlasMedia(baseUrl, apiKey, input.sourceImageInput, 'flow-atlas-source.png', input.abortSignal)
    : undefined;
  const maskImage = input.maskImageInput && input.sourceImageInput
    ? await uploadAtlasMedia(
        baseUrl,
        apiKey,
        `data:image/png;base64,${await blobToBase64(await normalizeMaskBlob(input.maskImageInput, input.sourceImageInput, 'atlas', input.modelId, input.abortSignal), input.abortSignal)}`,
        'flow-atlas-mask.png',
        input.abortSignal,
      )
    : undefined;
  const referenceImages = await Promise.all(
    input.referenceImageInputs.map((imageInput, index) =>
      uploadAtlasMedia(baseUrl, apiKey, imageInput, `flow-atlas-reference-${index + 1}.png`, input.abortSignal)),
  );
  const seed = coerceOptionalNumber(input.node.data.imageSeed);
  const guidanceScale = coerceOptionalNumber(input.node.data.imageGuidanceScale);
  const editStrength = coerceOptionalNumber(input.node.data.imageEditStrength);
  // Prefer the node's own LoRA field; otherwise use loras JSON from a connected LoRA Spec node.
  const loraWeights = parseAtlasLoraWeights(input.node.data.imageLoraWeightsJson || input.context.loraWeightsJson);
  // Set the output size using the model's OWN documented field — `size:"W*H"`/`"WxH"`, a `"1K"/"2K"` tier,
  // or `aspect_ratio:"16:9"` — NOT the generic width/height the API ignores (which left every size/aspect
  // model defaulting to a square). Aspect-ratio presets and custom W×H both flow through here.
  const dimensionBody = resolveAtlasDimensionBody(input.modelId, { width, height, aspectRatio });
  // Atlas native models have one prompt string beside their ordered image field, so numbered
  // guidance is serialized as an explicit Reference N block naming each image list position.
  const atlasPrompt = imageReferencePromptWithGuidance({
    prompt: input.prompt,
    referenceGroups: input.referenceGroups,
    imageOrdinalOffset: input.sourceImageInput ? 1 : 0,
    positionNoun: 'input image',
    totalImages: (input.sourceImageInput ? 1 : 0) + input.referenceImageInputs.length,
  });
  const body: Record<string, unknown> = {
    model: input.modelId,
    prompt: atlasPrompt,
    ...dimensionBody,
    // Atlas image models name the step field `num_inference_steps` (the old `steps` was silently ignored).
    num_inference_steps: input.context.config.steps,
    output_format: input.context.config.imageOutputFormat,
    // Censorship/safety checker is OFF by default; the node exposes a toggle to turn it on.
    enable_safety_checker: input.node.data.imageSafetyCheckerEnabled ?? false,
  };

  const negativePrompt = typeof input.node.data.imageNegativePrompt === 'string'
    ? input.node.data.imageNegativePrompt.trim()
    : '';
  if (negativePrompt) {
    body.negative_prompt = negativePrompt;
  }
  if (seed !== undefined) {
    body.seed = seed;
  }
  if (guidanceScale !== undefined) {
    body.guidance_scale = guidanceScale;
  }
  if (editStrength !== undefined && isEditOperation) {
    body.strength = editStrength;
  }
  if (loraWeights !== undefined) {
    body.loras = loraWeights;
  }
  // Model-specific documented inputs the user set (resolution, quality, n, thinking_mode, input_fidelity,
  // web search, stylize, …) — each coerced to its schema type and sent only when the model documents it.
  applyAtlasModelParams(body, input.modelId, input.node.data.atlasParams as Record<string, unknown> | undefined);
  // Censorship off by default across EVERY safety/moderation field a model documents, unless the user
  // overrode it: numeric `safety_tolerance` → the most-permissive value the schema allows; OpenAI's
  // `moderation` → "low" (its least-strict setting). (`enable_safety_checker` already defaults to false
  // above.) Note: some providers — BFL FLUX.2, Google, OpenAI — also enforce a hard model-level filter that
  // no API parameter can disable; use an uncensored model for explicit content.
  if (body.safety_tolerance === undefined) {
    const safetyParam = getAtlasModelParams(input.modelId).find((param) => param.name === 'safety_tolerance');
    if (safetyParam && typeof safetyParam.max === 'number') {
      body.safety_tolerance = safetyParam.max;
    }
  }
  if (body.moderation === undefined && getAtlasModelParams(input.modelId).some((param) => param.name === 'moderation')) {
    body.moderation = 'low';
  }
  // Place source + references under the model's ACTUAL input field (images[] / image / image_urls).
  // Sending the wrong field is silently IGNORED by Atlas — an "edit" degrades to text-to-image and
  // references do nothing (there is no `reference_images` field on any model). See docs/notes/732.
  applyAtlasImageInputs(body, input.modelId, { source: sourceImage, references: referenceImages });
  if (maskImage && atlasModelSupportsMask(input.modelId)) {
    body.mask_image = maskImage;
  }

  input.onStatus?.(isEditOperation ? 'Editing image with Atlas Cloud...' : 'Generating image with Atlas Cloud...');
  // Send ONLY the fields this model documents — undocumented fields make some models reject the request.
  const requestBody = filterAtlasBodyToAcceptedFields(body, input.modelId);
  const response = await fetch(`${baseUrl}/model/generateImage`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: input.abortSignal,
  });

  if (!response.ok) {
    throw await createHttpStatusError(response, 'Atlas image generation failed');
  }

  const created = (await response.json()) as AtlasCreateResponse;
  if (created.error || created.data?.error) {
    throw new Error(extractProviderError(created.error ?? created.data?.error, 'Atlas image generation failed.'));
  }

  // Capture EVERY output URL — sequential/batch models (Seedream `max_images`) return several images in one
  // response, and dropping all but the first defeats their purpose.
  const immediateOutputs = extractAllAtlasOutputUrls(created);
  const predictionId = extractAtlasPredictionId(created);
  const outputUrls = immediateOutputs.length > 0
    ? immediateOutputs
    : (predictionId
        ? await retryExistingAsyncJobPhase({
            phaseLabel: `Atlas image prediction ${predictionId} polling failed`,
            operation: () => pollAtlasPredictionResult(baseUrl, apiKey, predictionId, input.onStatus, 'image', input.abortSignal),
            settings: input.settings,
            onStatus: input.onStatus,
            abortSignal: input.abortSignal,
          })
        : []);

  if (outputUrls.length === 0) {
    throw new Error('Atlas did not return a prediction ID or image output.');
  }

  const operation = resolveAtlasOperation(input.sourceImageInput, input.maskImageInput, referenceImages);
  const estimate = estimateImageModelCostUsd({
    providerId: 'atlas',
    modelId: input.modelId,
    operation,
    imageCount: outputUrls.length,
  });

  const materialized = await Promise.all(outputUrls.map((url) => materializeAcceptedProviderResult({
    resultUrl: normalizeAtlasResultUrl(url, input.context.config.imageOutputFormat),
    downloadErrorLabel: 'Atlas result download failed',
    phaseLabel: 'Atlas image result materialization failed',
    settings: input.settings,
    onStatus: input.onStatus,
    abortSignal: input.abortSignal,
  })));

  const countLabel = materialized.length > 1 ? ` (${materialized.length} images)` : '';
  return {
    result: materialized[0].result,
    resultType: 'image',
    mimeType: materialized[0].mimeType,
    additionalResults: materialized.slice(1).map((item) => ({ result: item.result, mimeType: item.mimeType })),
    statusMessage: `${isEditOperation ? 'Edited' : 'Generated'} with ${input.modelId}${countLabel}`,
    usage: buildImageUsage('atlas', input.modelId, {
      costUsd: estimate.costUsd,
      confidence: imageUsageConfidenceFromEstimate(estimate.confidence),
      imageCount: materialized.length,
      notes: estimate.notes,
    }),
  };
}

function isAtlasNativeImageModelId(modelId: string): boolean {
  const normalizedModelId = modelId.trim().toLowerCase();
  return ATLAS_NATIVE_IMAGE_MODEL_IDS.has(normalizedModelId) ||
    (normalizedModelId.includes('/') && !normalizedModelId.startsWith('openai/'));
}

function normalizeAtlasBaseUrl(baseUrl: string | undefined): string {
  const trimmed = baseUrl?.trim().replace(/\/+$/, '');

  if (!trimmed) {
    return 'https://api.atlascloud.ai/api/v1';
  }

  if (trimmed === 'https://api.atlascloud.ai') {
    return 'https://api.atlascloud.ai/api/v1';
  }

  return trimmed;
}

async function uploadAtlasMedia(
  baseUrl: string,
  apiKey: string,
  imageInput: string,
  filename: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  if (/^https?:\/\//i.test(imageInput)) {
    return imageInput;
  }

  const formData = new FormData();
  formData.append('file', await dataUrlToFile(imageInput, filename, signal));
  const response = await fetch(`${baseUrl}/model/uploadMedia`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal,
  });

  if (!response.ok) {
    throw await createHttpStatusError(response, 'Atlas media upload failed');
  }

  const payload = (await response.json()) as AtlasUploadResponse;
  const uploadedUrl = payload.data?.download_url ?? payload.data?.url ?? payload.download_url ?? payload.url;

  if (!uploadedUrl) {
    throw new Error('Atlas media upload did not return a URL.');
  }

  return uploadedUrl;
}

async function pollAtlasPredictionResult(
  baseUrl: string,
  apiKey: string,
  predictionId: string,
  onStatus?: (statusMessage: string) => void,
  mediaLabel: 'image' | 'video' = 'image',
  signal?: AbortSignal,
): Promise<string[]> {
  // Video jobs take longer than images, so allow a longer poll window.
  const maxAttempts = mediaLabel === 'video' ? 300 : 120;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`${baseUrl}/model/prediction/${encodeURIComponent(predictionId)}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
    });

    if (!response.ok) {
      throw await createHttpStatusError(response, `Atlas ${mediaLabel} polling failed`);
    }

    const payload = (await response.json()) as AtlasPollResponse;
    const outputUrls = extractAllAtlasOutputUrls(payload);
    const status = extractAtlasPredictionStatus(payload);

    if (status && isAtlasFailureStatus(status)) {
      throw new NonRetryableError(extractProviderError(payload.error ?? payload.data?.error ?? status, `Atlas ${mediaLabel} generation failed.`));
    }

    if (outputUrls.length > 0 && (!status || isAtlasSuccessStatus(status))) {
      return outputUrls;
    }

    if (status && isAtlasSuccessStatus(status)) {
      throw new NonRetryableError(`Atlas completed the ${mediaLabel} job without an output URL.`);
    }

    onStatus?.(`Atlas ${mediaLabel} is still in progress... ${attempt + 1} check${attempt === 0 ? '' : 's'} so far`);
    await abortableSleep(2000, signal);
  }

  throw new NonRetryableError(`Atlas ${mediaLabel} generation timed out.`);
}

function extractAtlasPredictionId(payload: AtlasCreateResponse): string | undefined {
  return firstNonEmptyString(
    payload.data?.id,
    payload.data?.prediction_id,
    payload.id,
    payload.prediction_id,
  );
}

function extractAtlasPredictionStatus(payload: AtlasPollResponse): string | undefined {
  return firstNonEmptyString(payload.data?.status, payload.status)?.toLowerCase();
}

function extractAtlasOutputUrl(payload: AtlasCreateResponse): string | undefined {
  return firstNonEmptyString(
    firstStringFromUnknown(payload.data?.outputs),
    firstStringFromUnknown(payload.data?.output),
    firstStringFromUnknown(payload.data?.images),
    firstStringFromUnknown(payload.data?.image),
    firstStringFromUnknown(payload.data?.result),
    firstStringFromUnknown(payload.outputs),
    firstStringFromUnknown(payload.output),
    firstStringFromUnknown(payload.images),
    firstStringFromUnknown(payload.image),
    firstStringFromUnknown(payload.result),
  );
}

/** Flatten a string or (nested) array of strings into a flat list of non-empty URLs, de-duplicated. */
function collectStringsFromUnknown(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStringsFromUnknown(item, out);
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['outputs', 'output', 'url', 'image', 'images']) {
      if (key in record) collectStringsFromUnknown(record[key], out);
    }
  }
}

/**
 * ALL output URLs from an Atlas image response. Sequential/batch models (e.g. Seedream Sequential's
 * `max_images`) return several images in one response under `outputs`/`images`; we must keep every one,
 * not just the first (which `extractAtlasOutputUrl` returns).
 */
function extractAllAtlasOutputUrls(payload: AtlasCreateResponse): string[] {
  const out: string[] = [];
  collectStringsFromUnknown(payload.data?.outputs ?? payload.data?.images ?? payload.data?.output ?? payload.data?.image, out);
  if (out.length === 0) {
    collectStringsFromUnknown(payload.outputs ?? payload.images ?? payload.output ?? payload.image, out);
  }
  return [...new Set(out)];
}

function firstStringFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const itemString = firstStringFromUnknown(item);
      if (itemString) {
        return itemString;
      }
    }
    return undefined;
  }

  // Atlas video predictions can nest the URL under an object, e.g.
  // `{ outputs: [url] }` or `{ url: ... }` — probe the common output keys.
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['outputs', 'output', 'url', 'video', 'videos', 'download_url']) {
      const nested = firstStringFromUnknown(record[key]);
      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0);
}

function isAtlasSuccessStatus(status: string): boolean {
  return ['succeeded', 'success', 'completed', 'complete', 'done', 'ready'].includes(status.toLowerCase());
}

function isAtlasFailureStatus(status: string): boolean {
  return ['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(status.toLowerCase());
}

function normalizeAtlasResultUrl(resultUrl: string, outputFormat: ExecutionConfig['imageOutputFormat']): string {
  if (/^(https?:|blob:|data:)/i.test(resultUrl)) {
    return resultUrl;
  }

  return `data:image/${outputFormat};base64,${resultUrl}`;
}

/**
 * Turn a provider's remote result URL into a node result. Downloads + inlines
 * the bytes so the asset embeds/persists; but provider result CDNs (Atlas
 * `static.atlascloud.ai`, BFL `delivery.bfl.ai`, …) don't send CORS headers, so
 * a renderer `fetch()` is blocked under the default web-security policy
 * (Electron + Android WebView). When the download fails we fall back to the
 * remote URL itself — an `<img>`/`<video src>` loads it cross-origin without
 * CORS, so the generated media still appears instead of vanishing.
 */
async function materializeRemoteMediaResult(
  resultUrl: string,
  downloadErrorLabel: string,
  fallbackMimeType?: string,
  signal?: AbortSignal,
): Promise<{ result: string; mimeType?: string }> {
  throwIfAborted(signal);
  if (!/^https?:\/\//i.test(resultUrl)) {
    return { result: resultUrl, mimeType: resultUrl.match(/^data:([^;,]+)/)?.[1] ?? fallbackMimeType };
  }
  try {
    const blob = await fetchImageResultBlob(resultUrl, downloadErrorLabel, signal);
    return { result: await toResultUrl(blob), mimeType: blob.type || fallbackMimeType };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw isAbortError(error) ? error : createAbortError();
    }
    // The renderer fetch is CORS-blocked (provider result CDNs send no CORS
    // headers). The raw URL won't display either — those CDNs force-download
    // (Content-Disposition: attachment), so an <img src> of it refuses to
    // render. Pull the bytes through a non-CORS-bound native path (Electron
    // main net.fetch / Android CapacitorHttp) and inline them as a data URL.
    const native = await fetchRemoteMediaAsDataUrl(resultUrl, undefined, signal);
    throwIfAborted(signal);
    if (native) {
      return { result: native.dataUrl, mimeType: native.mimeType ?? fallbackMimeType };
    }
    // Last resort (plain web/dev with no native bridge): hand back the URL.
    return { result: resultUrl, mimeType: fallbackMimeType };
  }
}

async function materializeRemoteMediaResultStrict(
  resultUrl: string,
  downloadErrorLabel: string,
  fallbackMimeType?: string,
  signal?: AbortSignal,
): Promise<{ result: string; mimeType?: string }> {
  throwIfAborted(signal);
  if (!/^https?:\/\//i.test(resultUrl)) {
    return { result: resultUrl, mimeType: resultUrl.match(/^data:([^;,]+)/)?.[1] ?? fallbackMimeType };
  }

  try {
    const blob = await fetchImageResultBlob(resultUrl, downloadErrorLabel, signal);
    return { result: await toResultUrl(blob), mimeType: blob.type || fallbackMimeType };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw isAbortError(error) ? error : createAbortError();
    }
    const native = await fetchRemoteMediaAsDataUrl(resultUrl, undefined, signal);
    throwIfAborted(signal);
    if (native) {
      return { result: native.dataUrl, mimeType: native.mimeType ?? fallbackMimeType };
    }
    throw error;
  }
}

async function materializeAcceptedProviderResult(input: {
  resultUrl: string;
  downloadErrorLabel: string;
  phaseLabel: string;
  settings: RuntimeSettingsSnapshot;
  fallbackMimeType?: string;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<{ result: string; mimeType?: string }> {
  try {
    return await retryExistingAsyncJobPhase({
      phaseLabel: input.phaseLabel,
      operation: () => materializeRemoteMediaResultStrict(
        input.resultUrl,
        input.downloadErrorLabel,
        input.fallbackMimeType,
        input.abortSignal,
      ),
      settings: input.settings,
      onStatus: input.onStatus,
      abortSignal: input.abortSignal,
      // One immediate retry distinguishes a transient accepted-response read
      // from an unavailable renderer/native materialization path without
      // stalling the established URL fallback or ever repeating submission.
      maxRetries: 1,
      baseDelayMs: 0,
    });
  } catch (error) {
    if (isAbortError(error) || input.abortSignal?.aborted) {
      throw isAbortError(error) ? error : createAbortError();
    }
    // Once the bounded download retries are exhausted, preserve the established
    // URL/native fallback. The accepted provider submission is never repeated.
    return materializeRemoteMediaResult(
      input.resultUrl,
      input.downloadErrorLabel,
      input.fallbackMimeType,
      input.abortSignal,
    );
  }
}

function parseAtlasLoraWeights(value: unknown): unknown {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function resolveAtlasOperation(
  sourceImageInput: string | undefined,
  maskImageInput: string | undefined,
  referenceImages: string[],
): ImageModelOperation {
  if (maskImageInput) {
    return 'mask-inpaint';
  }

  if (sourceImageInput || referenceImages.length > 0) {
    return 'image-edit';
  }

  return 'text-to-image';
}

function imageUsageConfidenceFromEstimate(
  confidence: ReturnType<typeof estimateImageModelCostUsd>['confidence'],
): UsageTelemetry['confidence'] {
  switch (confidence) {
    case 'published-fixed':
      return 'fixed';
    case 'published-minimum':
    case 'token-estimate':
    case 'heuristic':
      return 'heuristic';
    case 'provider-defined':
    case 'unknown':
      return 'unknown';
  }
}

async function executeBflImageNode(input: {
  modelId: string;
  prompt: string;
  aspectRatio: AspectRatio;
  outputFormat: ExecutionConfig['imageOutputFormat'];
  seed?: number;
  sourceImageInput?: string;
  referenceImageInputs: string[];
  referenceGroups?: FlowReferenceGroup[];
  apiKey: string;
  settings: RuntimeSettingsSnapshot;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  input.onStatus?.(input.sourceImageInput ? 'Editing image with BFL FLUX.2…' : 'Generating image with BFL FLUX.2…');
  const sourceImage = input.sourceImageInput
    ? await normalizeRemoteImageInput(input.sourceImageInput, input.abortSignal)
    : undefined;
  const referenceImages = await Promise.all(
    input.referenceImageInputs.map((imageInput) => normalizeRemoteImageInput(imageInput, input.abortSignal)),
  );
  const built = buildBflFlux2Request({
    modelId: input.modelId,
    // FLUX.2 takes one prompt beside its ordered input_image fields; numbered guidance travels
    // as an explicit Reference N block naming each input image position.
    prompt: imageReferencePromptWithGuidance({
      prompt: input.prompt,
      referenceGroups: input.referenceGroups,
      imageOrdinalOffset: input.sourceImageInput ? 1 : 0,
      positionNoun: 'input image',
      totalImages: (input.sourceImageInput ? 1 : 0) + input.referenceImageInputs.length,
    }),
    sourceImage,
    referenceImages,
    aspectRatio: input.aspectRatio,
    outputFormat: input.outputFormat,
    seed: input.seed,
    operation: input.sourceImageInput || input.referenceImageInputs.length > 0 ? 'image-edit' : 'text-to-image',
  });

  const response = await fetch(built.endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'x-key': input.apiKey,
    },
    body: JSON.stringify(built.body),
    signal: input.abortSignal,
  });

  if (!response.ok) {
    throw await createHttpStatusError(response, 'BFL image generation failed');
  }

  const created = (await response.json()) as BflCreateResponse;
  if (created.error) {
    throw new Error(extractProviderError(created.error, 'BFL image generation failed.'));
  }
  if (!created.polling_url) {
    throw new Error('BFL did not return a polling URL.');
  }

  input.onStatus?.('Waiting for BFL image result…');
  const resultUrl = await retryExistingAsyncJobPhase({
    phaseLabel: `BFL job ${created.id ?? created.polling_url} polling failed`,
    operation: () => pollBflImageResult(created.polling_url!, input.apiKey, input.onStatus, input.abortSignal),
    settings: input.settings,
    onStatus: input.onStatus,
    abortSignal: input.abortSignal,
  });
  const result = (await retryExistingAsyncJobPhase({
    phaseLabel: 'BFL image result materialization failed',
    operation: () => materializeRemoteMediaResult(resultUrl, 'BFL result download failed', undefined, input.abortSignal),
    settings: input.settings,
    onStatus: input.onStatus,
    abortSignal: input.abortSignal,
  })).result;
  const estimatedCost = created.cost !== null && created.cost !== undefined
    ? created.cost * 0.01
    : built.estimatedCostUsd;

  return {
    result,
    resultType: 'image',
    statusMessage: `Generated with ${input.modelId}`,
    usage: buildImageUsage('bfl', input.modelId, {
      costUsd: estimatedCost,
      confidence: estimatedCost === undefined ? 'unknown' : 'measured',
      notes: created.cost === undefined ? ['Published BFL estimate; actual cost may vary with megapixels.'] : undefined,
    }),
  };
}

async function applyConfiguredAutoUpscaleIfRequested(input: {
  node: AppNode;
  context: ExecutionContext;
  settings: RuntimeSettingsSnapshot;
  result: ExecutionResult;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  throwIfAborted(input.abortSignal);
  if (!input.node.data.imageAutoUpscale || input.result.resultType !== 'image') {
    return input.result;
  }

  const plan = resolveUniversalConfiguredUpscalePlan({
    providerSettings: input.settings.providerSettings,
    apiKeys: input.settings.apiKeys,
  });

  if (!plan.canRun) {
    throw new NonRetryableError(plan.unavailableReason ?? 'The configured image upscaler is not available.');
  }

  const generationResult = retainSuccessfulUsageIdentity(input.node, input.settings, input.result);

  input.onStatus?.(`Auto-upscaling with ${plan.label}...`);
  const sourceImage = resultValueAsMediaUrl(generationResult.result);
  if (!sourceImage) {
    throw new NonRetryableError('The image executor returned a non-media value.');
  }
  const upscaled = await runConfiguredFlowImageUpscale({
    sourceImage,
    outputFormat: input.context.config.imageOutputFormat,
    fallbackDimensions: mapAspectRatioToImageDimensions(input.context.config.aspectRatio),
    plan,
    prompt: input.context.prompt,
    settings: input.settings,
    abortSignal: input.abortSignal,
    onStatus: input.onStatus,
  });
  throwIfAborted(input.abortSignal);

  // The upscale replaced the primary bytes. Every field DERIVED from the original bytes is now stale and
  // must not ride along on the `...input.result` spread: the Source Library persists `blob` in preference
  // to the result URL, so a retained original Blob would store the pre-upscale image; extension, fileName,
  // and outputMetadata (e.g. width/height) likewise describe the old bytes. Clear them so the store
  // re-derives from the upscaled data URL. Any additional (unscaled) sibling results are left untouched.
  return {
    ...generationResult,
    result: upscaled.result,
    mimeType: upscaled.mimeType ?? generationResult.mimeType,
    blob: undefined,
    extension: undefined,
    fileName: undefined,
    outputMetadata: undefined,
    statusMessage: `${generationResult.statusMessage}; auto-upscaled with ${plan.label}`,
    usage: mergeImageUpscaleUsage(generationResult.usage, plan),
    ...paidStabilityUpscaleAttributions(input.node, generationResult, plan),
  };
}

function paidStabilityUpscaleAttributions(
  node: AppNode,
  generation: ExecutionResult,
  plan: UniversalConfiguredUpscalePlan,
): Pick<ExecutionResult, 'usageAttributions'> {
  const modelId = plan.provider === 'stability-fast'
    ? 'stable-image-upscale-fast'
    : plan.provider === 'stability-conservative'
      ? 'stable-image-upscale-conservative'
      : undefined;
  if (!modelId || !generation.usage) return {};

  const upscaleNode = {
    ...node,
    data: {
      ...node.data,
      provider: 'stability',
      modelId,
      imageOperation: 'upscale',
      imageAutoUpscale: false,
    },
  } as AppNode;
  const upscaleUsage = buildImageUsage('stability', modelId, {
    costUsd: plan.costUsd,
    confidence: plan.costUsd === undefined ? 'unknown' : 'fixed',
    notes: [`Auto-upscaled with ${plan.label}.`],
  });
  return {
    usageAttributions: [
      ...(generation.usageAttributions?.length
        ? generation.usageAttributions
        : [{ node: { ...node, data: { ...node.data } }, usage: generation.usage }]),
      { node: upscaleNode, usage: upscaleUsage },
    ],
  };
}

async function runConfiguredFlowImageUpscale(input: {
  sourceImage: string;
  outputFormat: ExecutionConfig['imageOutputFormat'];
  fallbackDimensions: { width: number; height: number };
  plan: UniversalConfiguredUpscalePlan;
  prompt: string;
  settings: RuntimeSettingsSnapshot;
  abortSignal?: AbortSignal;
  onStatus?: (statusMessage: string) => void;
}): Promise<{ result: string; mimeType?: string }> {
  if (input.plan.provider === 'android-accelerator') {
    const dimensions = await resolveImageDimensions(input.sourceImage, input.abortSignal).catch((error) => {
      if (isAbortError(error)) throw error;
      if (input.abortSignal?.aborted) throw createAbortError();
      return input.fallbackDimensions;
    });
    const sourceDataUrl = await normalizeRemoteImageInput(input.sourceImage, input.abortSignal);
    const result = await runAndroidAcceleratorUpscale({
      baseUrl: normalizeAndroidAcceleratorBaseUrl(input.settings.providerSettings.androidAcceleratorBaseUrl),
      authToken: input.settings.providerSettings.androidAcceleratorAuthToken,
      sourceDataUrl,
      targetWidthPx: dimensions.width * 2,
      targetHeightPx: dimensions.height * 2,
      upscalerId: input.settings.providerSettings.androidAcceleratorDefaultUpscaler ?? 'upscaler_realistic',
      outputFormat: input.outputFormat,
      abortSignal: input.abortSignal,
    });
    return {
      result: result.dataUrl,
      mimeType: result.mimeType,
    };
  }

  if (input.plan.provider === 'android-native') {
    const dimensions = await resolveImageDimensions(input.sourceImage, input.abortSignal).catch((error) => {
      if (isAbortError(error)) throw error;
      if (input.abortSignal?.aborted) throw createAbortError();
      return input.fallbackDimensions;
    });
    const sourceDataUrl = await normalizeRemoteImageInput(input.sourceImage, input.abortSignal);
    const result = await raceWithAbort(runAndroidNativeImageUpscale({
      sourceDataUrl,
      targetWidthPx: dimensions.width * 2,
      targetHeightPx: dimensions.height * 2,
      outputFormat: input.outputFormat,
    }), input.abortSignal);
    return {
      result: result.dataUrl,
      mimeType: result.mimeType,
    };
  }

  if (input.plan.provider === 'local-ai-cpu') {
    const dimensions = await resolveImageDimensions(input.sourceImage, input.abortSignal).catch((error) => {
      if (isAbortError(error)) throw error;
      if (input.abortSignal?.aborted) throw createAbortError();
      return input.fallbackDimensions;
    });
    const sourceDataUrl = await normalizeRemoteImageInput(input.sourceImage, input.abortSignal);
    const result = await runLocalCpuUpscaler({
      baseUrl: input.settings.providerSettings.localAiCpuEndpointUrl ?? '',
      authHeader: input.settings.providerSettings.localAiCpuAuthHeader,
      sourceDataUrl,
      targetWidthPx: dimensions.width * 2,
      targetHeightPx: dimensions.height * 2,
      model: input.settings.providerSettings.localAiCpuModel,
      outputFormat: input.outputFormat,
      abortSignal: input.abortSignal,
    } as LocalCpuUpscalerInput);

    return {
      result: result.dataUrl,
      mimeType: result.mimeType,
    };
  }

  if (input.plan.provider === 'stability-fast' || input.plan.provider === 'stability-conservative') {
    const isConservative = input.plan.provider === 'stability-conservative';
    const stabilityInput = {
      sourceImage: input.sourceImage,
      mode: isConservative ? 'conservative' : 'fast',
      prompt: input.prompt,
      outputFormat: input.outputFormat,
      apiKey: requireApiKey(input.settings.apiKeys.stability ?? '', 'Stability AI'),
      sourceFilename: 'flow-auto-upscale-source.png',
      errorLabel: 'Configured Stability image upscale failed',
      signal: input.abortSignal,
    } as const;
    const acceptedResponse = await withExponentialBackoff({
      operation: () => submitStabilityImageUpscale(stabilityInput),
      maxRetries: input.settings.providerSettings.batchMaxRetries ?? 10,
      baseDelayMs: input.settings.providerSettings.batchRetryBaseDelayMs ?? 30000,
      maxElapsedMs: FLOW_PROVIDER_RETRY_BUDGET_MS,
      abortSignal: input.abortSignal,
      onRetry: (attempt, max, delay, error) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        input.onStatus?.(
          `${input.plan.label} submission failed before acceptance (${message}). Retrying ${attempt} of ${max} in ${Math.round(delay / 1000)}s…`,
        );
      },
    });
    return retryExistingAsyncJobPhase({
      phaseLabel: `${input.plan.label} accepted-response materialization failed`,
      operation: () => materializeStabilityImageUpscaleResponse(
        acceptedResponse,
        input.outputFormat,
        input.abortSignal,
      ),
      settings: input.settings,
      onStatus: input.onStatus,
      abortSignal: input.abortSignal,
    });
  }

  if (input.plan.provider === 'vertex-imagen') {
    return runVertexImagenImageUpscale({
      sourceImage: input.sourceImage,
      providerSettings: input.settings.providerSettings,
      outputFormat: input.outputFormat,
      generateVertexImage: resolveVertexImageGenerator(input.settings.providerSettings),
      normalizeSourceImage: (image) => normalizeRemoteImageInput(image, input.abortSignal),
      signal: input.abortSignal,
    });
  }

  const dimensions = await resolveImageDimensions(input.sourceImage, input.abortSignal).catch((error) => {
    if (isAbortError(error)) throw error;
    if (input.abortSignal?.aborted) throw createAbortError();
    return input.fallbackDimensions;
  });
  return {
    result: await locallyScaleImageResult(input.sourceImage, dimensions.width * 2, dimensions.height * 2, input.outputFormat, input.abortSignal),
    mimeType: `image/${input.outputFormat}`,
  };
}

async function resolveImageDimensions(imageInput: string, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  const response = await fetch(imageInput, { signal });
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    return {
      width: Math.max(1, bitmap.width),
      height: Math.max(1, bitmap.height),
    };
  } finally {
    bitmap.close();
  }
}

async function locallyScaleImageResult(
  imageInput: string,
  width: number,
  height: number,
  outputFormat: ExecutionConfig['imageOutputFormat'],
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(imageInput, { signal });
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Local image upscale needs a 2D canvas context.');
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return toResultUrl(await canvas.convertToBlob({ type: `image/${outputFormat}` }));
  } finally {
    bitmap.close();
  }
}

function mergeImageUpscaleUsage(
  usage: UsageTelemetry | undefined,
  plan: UniversalConfiguredUpscalePlan,
): UsageTelemetry | undefined {
  if (!usage) {
    return plan.costUsd === undefined
      ? buildImageUsage(plan.provider, 'configured-upscaler', {
          confidence: 'unknown',
          notes: [`Auto-upscaled with ${plan.label}; cost is not mapped.`],
        })
      : buildImageUsage(plan.provider, 'configured-upscaler', {
          costUsd: plan.costUsd,
          confidence: 'fixed',
          notes: [`Auto-upscaled with ${plan.label}.`],
        });
  }

  const nextCost = usage.costUsd === undefined || plan.costUsd === undefined
    ? undefined
    : Math.round((usage.costUsd + plan.costUsd) * 10000) / 10000;

  return {
    ...usage,
    costUsd: nextCost,
    confidence: nextCost === undefined ? 'unknown' : usage.confidence,
    notes: [
      ...(usage.notes ?? []),
      `Auto-upscaled with ${plan.label}; upscale cost ${plan.costLabel}.`,
    ],
  };
}

async function pollBflImageResult(
  pollingUrl: string,
  apiKey: string,
  onStatus?: (statusMessage: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await fetch(pollingUrl, {
      headers: {
        accept: 'application/json',
        'x-key': apiKey,
      },
      signal,
    });

    if (!response.ok) {
      throw await createHttpStatusError(response, 'BFL image polling failed');
    }

    const payload = (await response.json()) as BflPollResponse;
    if (payload.status === 'Ready' && payload.result?.sample) {
      return payload.result.sample;
    }
    if (payload.status === 'Error' || payload.status === 'Failed' || payload.error) {
      throw new NonRetryableError(extractProviderError(payload.error ?? payload.status, 'BFL image generation failed.'));
    }

    onStatus?.(`BFL image is still in progress… ${attempt + 1} check${attempt === 0 ? '' : 's'} so far`);
    await abortableSleep(2000, signal);
  }

  throw new NonRetryableError('BFL image generation timed out after 240 seconds.');
}

async function executeStabilityImageNode(input: {
  modelId: string;
  prompt: string;
  context: ExecutionContext;
  nodeData: AppNode['data'];
  sourceImageInput?: string;
  maskImageInput?: string;
  apiKey: string;
  settings: RuntimeSettingsSnapshot;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  const operation = resolveStabilityOperation(input.modelId, input.nodeData.imageOperation, Boolean(input.sourceImageInput));
  const headers = {
    Authorization: `Bearer ${input.apiKey}`,
    Accept: 'image/*',
  };

  if (operation === 'text-to-image') {
    input.onStatus?.('Generating image with Stability AI…');
    const built = buildStabilityGenerationRequest({
      modelId: input.modelId,
      prompt: input.prompt,
      aspectRatio: getSupportedImageAspectRatio('stability', input.modelId, input.context.config.aspectRatio),
      outputFormat: input.context.config.imageOutputFormat,
    });
    const formData = formDataFromFields(built.fields);
    const response = await fetch(built.endpoint, {
      method: 'POST',
      headers,
      body: formData,
      signal: input.abortSignal,
    });

    if (!response.ok) {
      throw await createHttpStatusError(response, 'Stability AI image generation failed');
    }

    return {
      result: await toResultUrl(await response.blob()),
      resultType: 'image',
      statusMessage: `Generated with ${input.modelId}`,
      usage: buildImageUsage('stability', input.modelId, {
        costUsd: built.estimatedCostUsd,
        confidence: built.estimatedCostUsd === undefined ? 'unknown' : 'fixed',
      }),
    };
  }

  if (operation === 'upscale') {
    if (!input.sourceImageInput) {
      throw new NonRetryableError('This Stability AI upscale model needs a connected source image.');
    }

    input.onStatus?.('Upscaling image with Stability AI...');
    const isConservative = input.modelId === 'stable-image-upscale-conservative';
    const built = buildStabilityUpscaleRequest({
      mode: isConservative ? 'conservative' : 'fast',
      prompt: isConservative ? input.prompt : undefined,
      creativity: isConservative ? coerceOptionalNumber(input.nodeData.imageCreativity) : undefined,
      outputFormat: input.context.config.imageOutputFormat,
    });
    const formData = formDataFromFields(built.fields);
    formData.append('image', await dataUrlToFile(input.sourceImageInput, 'flow-stability-upscale-source.png', input.abortSignal));
    const response = await fetch(built.endpoint, {
      method: 'POST',
      headers,
      body: formData,
      signal: input.abortSignal,
    });

    if (!response.ok) {
      throw await createHttpStatusError(response, 'Stability AI image upscale failed');
    }

    return {
      result: await toResultUrl(await response.blob()),
      resultType: 'image',
      statusMessage: `Upscaled with ${input.modelId}`,
      usage: buildImageUsage('stability', input.modelId, {
        costUsd: built.estimatedCostUsd,
        confidence: built.estimatedCostUsd === undefined ? 'unknown' : 'fixed',
      }),
    };
  }

  if (!input.sourceImageInput) {
    throw new NonRetryableError('This Stability AI edit model needs a connected source image.');
  }

  if ((operation === 'mask-inpaint' || operation === 'erase') && !input.maskImageInput) {
    throw new NonRetryableError('This Stability AI edit model needs a connected mask image.');
  }

  const searchPrompt = normalizeOptionalString(input.nodeData.imageSearchPrompt as string | undefined);
  if ((operation === 'search-replace' || operation === 'search-recolor') && !searchPrompt) {
    throw new NonRetryableError('This Stability AI edit model needs a search prompt describing what to find.');
  }

  input.onStatus?.('Editing image with Stability AI…');
  const built = buildStabilityEditRequest({
    operation,
    prompt: operation === 'remove-background' ? undefined : input.prompt,
    searchPrompt,
    outputFormat: input.context.config.imageOutputFormat,
    outpaint: operation === 'outpaint'
      ? {
          left: coerceOptionalNumber(input.nodeData.imageOutpaintLeft) ?? 0,
          right: coerceOptionalNumber(input.nodeData.imageOutpaintRight) ?? 0,
          up: coerceOptionalNumber(input.nodeData.imageOutpaintUp) ?? 0,
          down: coerceOptionalNumber(input.nodeData.imageOutpaintDown) ?? 0,
          creativity: coerceOptionalNumber(input.nodeData.imageCreativity),
        }
      : undefined,
  });
  const formData = formDataFromFields(built.fields);
  formData.append(built.imageFieldName, await dataUrlToFile(input.sourceImageInput, 'flow-stability-source.png', input.abortSignal));

  if (input.maskImageInput) {
    const maskBlob = await normalizeMaskBlob(input.maskImageInput, input.sourceImageInput, 'stability', input.modelId, input.abortSignal);
    formData.append('mask', new File([maskBlob], 'flow-stability-mask.png', { type: 'image/png' }));
  }

  const response = await fetch(built.endpoint, {
    method: 'POST',
    headers: built.async ? { ...headers, Accept: 'application/json' } : headers,
    body: formData,
    signal: input.abortSignal,
  });

  if (!response.ok) {
    throw await createHttpStatusError(response, 'Stability AI image edit failed');
  }

  // Replace Background & Relight is async: the POST returns `{id}` and the finished image is
  // polled from /v2beta/results/{id} (one poll per 10s per Stability's rate limit).
  const resultBlob = built.async
    ? await (async () => {
        const generationId = extractStabilityGenerationId(await response.json());
        if (!generationId) {
          throw new Error('Stability AI did not return an async generation ID for this edit.');
        }
        return retryExistingAsyncJobPhase({
          phaseLabel: `Stability generation ${generationId} polling/materialization failed`,
          operation: () => fetchStabilityAsyncResultBlob({
            apiKey: input.apiKey,
            generationId,
            signal: input.abortSignal,
            onStatus: input.onStatus,
          }),
          settings: input.settings,
          onStatus: input.onStatus,
          abortSignal: input.abortSignal,
        });
      })()
    : await response.blob();

  return {
    result: await toResultUrl(resultBlob),
    resultType: 'image',
    statusMessage: `Edited with ${input.modelId}`,
    usage: buildImageUsage('stability', input.modelId, {
      costUsd: built.estimatedCostUsd,
      confidence: built.estimatedCostUsd === undefined ? 'unknown' : 'fixed',
    }),
  };
}

async function executeLocalOpenImageNode(input: {
  modelId: string;
  prompt: string;
  context: ExecutionContext;
  settings: RuntimeSettingsSnapshot;
  sourceImageInput?: string;
  maskImageInput?: string;
  referenceImageInputs: string[];
  referenceGroups?: FlowReferenceGroup[];
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  const endpoint = normalizeOptionalString(input.settings.providerSettings.localOpenImageEndpointUrl);
  if (!endpoint) {
    throw new NonRetryableError('Local/Open image endpoint is missing. Add it in Settings before running this model.');
  }
  if (!input.sourceImageInput) {
    throw new NonRetryableError('Local/Open image edit models need a connected source image.');
  }

  input.onStatus?.('Editing image with Local/Open endpoint…');
  const referenceImages = await Promise.all(
    input.referenceImageInputs.map((imageInput) => imageInputToBase64(imageInput, input.abortSignal)),
  );
  const body = buildLocalOpenImageEditRequest({
    model: input.modelId || input.settings.providerSettings.localOpenImageDefaultModel || 'Qwen/Qwen-Image-Edit',
    // The local endpoint takes references as a separate array, so guidance names positions
    // within that reference array rather than the combined image sequence.
    prompt: imageReferencePromptWithGuidance({
      prompt: input.prompt,
      referenceGroups: input.referenceGroups,
      imageOrdinalOffset: 0,
      positionNoun: 'reference image',
      totalImages: input.referenceImageInputs.length,
    }),
    image: await imageInputToBase64(input.sourceImageInput, input.abortSignal),
    mask: input.maskImageInput
      ? await blobToBase64(await normalizeMaskBlob(input.maskImageInput, input.sourceImageInput, 'localOpen', input.modelId, input.abortSignal), input.abortSignal)
      : undefined,
    referenceImages,
    outputFormat: input.context.config.imageOutputFormat,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const auth = normalizeOptionalString(input.settings.providerSettings.localOpenImageAuthHeader);

  if (auth) {
    headers.Authorization = auth;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: input.abortSignal,
  });

  if (!response.ok) {
    throw await createHttpStatusError(response, 'Local/Open image edit failed');
  }

  const contentType = response.headers.get('content-type') ?? '';
  const result = contentType.startsWith('image/')
    ? await toResultUrl(await response.blob())
    : await localOpenJsonResultToUrl(response);
  const estimate = estimateImageModelCostUsd({
    providerId: 'localOpen',
    modelId: input.modelId,
    operation: 'local-open-edit',
    imageCount: 1,
  });

  return {
    result,
    resultType: 'image',
    statusMessage: `Edited with ${body.model}`,
    usage: buildImageUsage('localOpen', body.model, {
      costUsd: estimate.costUsd,
      confidence: 'unknown',
      notes: estimate.notes,
    }),
  };
}

async function executeAndroidAcceleratorImageNode(input: {
  modelId: string;
  prompt: string;
  context: ExecutionContext;
  settings: RuntimeSettingsSnapshot;
  seed?: number;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  const baseUrl = normalizeAndroidAcceleratorBaseUrl(input.settings.providerSettings.androidAcceleratorBaseUrl);
  if (!baseUrl) {
    throw new NonRetryableError('Android accelerator URL is missing. Pair the phone and paste its LAN URL in Settings.');
  }

  const dimensions = mapAspectRatioToImageDimensions(input.context.config.aspectRatio);
  input.onStatus?.('Generating image on Android accelerator...');
  const result = await runAndroidAcceleratorGenerate({
    baseUrl,
    authToken: input.settings.providerSettings.androidAcceleratorAuthToken,
    modelId: input.modelId || input.settings.providerSettings.androidAcceleratorDefaultImageModel || 'local-dream-active',
    prompt: input.prompt,
    width: dimensions.width,
    height: dimensions.height,
    steps: input.context.config.steps,
    seed: input.seed,
    outputFormat: input.context.config.imageOutputFormat,
    abortSignal: input.abortSignal,
  });

  return {
    result: result.dataUrl,
    resultType: 'image',
    statusMessage: `Generated on Android accelerator with ${result.modelUsed ?? input.modelId}`,
    mimeType: result.mimeType,
    usage: buildImageUsage('android', result.modelUsed ?? input.modelId, {
      costUsd: 0,
      confidence: 'fixed',
      notes: [`Generated on ${result.accelerator ?? 'Android accelerator'} with $0 provider spend.`],
    }),
  };
}

function buildImageOperationPrompt(prompt: string, data: AppNode['data']): string {
  const additions = [
    ['Exact color or palette', normalizeOptionalString(data.imageExactColor as string | undefined)],
    ['Text in image instruction', normalizeOptionalString(data.imageTextEditPrompt as string | undefined)],
  ].flatMap(([label, value]) => value ? [`${label}: ${value}`] : []);

  return additions.length > 0
    ? `${prompt}\n\n${additions.join('\n')}`
    : prompt;
}

/**
 * AUD-011: the ordered reference entries a multimodal-parts request sends — one entry per
 * numbered slot that carries an image, each with the slot's guidance rendered as the adjacent
 * instruction text. Falls back to the flat URL list for contexts authored before groups existed.
 */
function collectReferencePartEntries(
  referenceGroups: FlowReferenceGroup[] | undefined,
  referenceImageInputs: string[],
): Array<{ url: string; instruction?: string }> {
  if (!referenceGroups) {
    return referenceImageInputs.map((url) => ({ url }));
  }
  return referenceGroups.flatMap((group) => group.imageUrl
    ? [{
        url: group.imageUrl,
        instruction: referenceGroupHasGuidance(group) ? formatReferenceGroupInstruction(group) : undefined,
      }]
    : []);
}

/**
 * AUD-011: serializes numbered reference guidance into the prompt for providers whose only text
 * channel is the prompt string. `imageOrdinalOffset` is how many non-reference images (source,
 * mask excluded — masks are not part of the ordered image sequence) precede the references in
 * the request, so each line can prove which attached image it describes.
 */
function imageReferencePromptWithGuidance(input: {
  prompt: string;
  referenceGroups: FlowReferenceGroup[] | undefined;
  imageOrdinalOffset: number;
  positionNoun: string;
  totalImages: number;
}): string {
  if (!input.referenceGroups) return input.prompt;
  const block = buildReferenceGuidancePromptBlock(input.referenceGroups, (_group, imageOrdinal) =>
    `${input.positionNoun} ${input.imageOrdinalOffset + imageOrdinal} of ${input.totalImages}`);
  return appendReferenceGuidanceBlockToPrompt(input.prompt, block);
}

function resolveStabilityOperation(
  modelId: string,
  override: unknown,
  hasSourceImage: boolean,
): StabilityEditRequestInput['operation'] | 'text-to-image' | 'upscale' {
  if (isStabilityOperation(override)) {
    return override;
  }

  const definition = getImageModelDefinition('stability', modelId);
  const operation = definition.supportedOperations[0];

  if (operation === 'upscale') {
    return 'upscale';
  }

  if (operation && operation !== 'image-edit' && operation !== 'local-open-edit') {
    return operation;
  }

  return hasSourceImage ? 'mask-inpaint' : 'text-to-image';
}

function isStabilityOperation(value: unknown): value is StabilityEditRequestInput['operation'] {
  if (value === 'upscale') {
    return false;
  }

  return value === 'mask-inpaint'
    || value === 'outpaint'
    || value === 'erase'
    || value === 'search-replace'
    || value === 'search-recolor'
    || value === 'remove-background'
    || value === 'replace-background-relight';
}

function formDataFromFields(fields: Record<string, string | number>): FormData {
  const formData = new FormData();

  Object.entries(fields).forEach(([key, value]) => {
    formData.append(key, String(value));
  });

  return formData;
}

async function normalizeRemoteImageInput(imageInput: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const inline = await dataUrlToInlineData(imageInput, 'image/png', undefined, signal);
  return `data:${inline.mimeType};base64,${inline.data}`;
}

async function imageInputToBase64(imageInput: string, signal?: AbortSignal): Promise<string> {
  return (await dataUrlToInlineData(imageInput, 'image/png', undefined, signal)).data;
}

async function fetchImageResultBlob(url: string, fallback: string, signal?: AbortSignal): Promise<Blob> {
  const response = await (signal ? fetch(url, { signal }) : fetch(url));

  if (!response.ok) {
    throw await createHttpStatusError(response, fallback);
  }

  return response.blob();
}

async function localOpenJsonResultToUrl(response: Response): Promise<string> {
  const payload = (await response.json()) as {
    image?: string;
    mimeType?: string;
    modelUsed?: string;
    error?: string;
  };

  if (payload.error) {
    throw new Error(payload.error);
  }
  if (!payload.image) {
    throw new Error('Local/Open image endpoint response did not include an image field.');
  }

  if (payload.image.startsWith('data:')) {
    return payload.image;
  }

  return toResultUrl(inlineDataToBlob(payload.image, payload.mimeType ?? 'image/png'));
}

function extractProviderError(error: string | { message?: string } | undefined, fallback: string): string {
  if (!error) {
    return fallback;
  }
  if (typeof error === 'string') {
    return error;
  }
  return error.message ?? fallback;
}

function buildImageUsage(
  provider: string,
  modelId: string,
  options: {
    costUsd?: number;
    confidence: UsageTelemetry['confidence'];
    imageCount?: number;
    notes?: string[];
  },
): UsageTelemetry {
  return {
    source: 'actual',
    confidence: options.confidence,
    provider,
    modelId,
    imageCount: options.imageCount ?? 1,
    costUsd: options.costUsd,
    notes: options.notes,
  };
}

async function executeVertexImageNode(input: {
  modelId: string;
  prompt: string;
  aspectRatio: AspectRatio;
  imageSize?: '1K' | '2K' | '4K';
  sourceImageInput?: string;
  referenceImageInputs: string[];
  referenceGroups?: FlowReferenceGroup[];
  settings: RuntimeSettingsSnapshot;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  const vertexConfig = getVertexProjectConfig(input.settings.providerSettings);

  if (!vertexConfig.projectId) {
    throw new NonRetryableError('Vertex AI project ID is missing. Add it in Settings before running Vertex image models.');
  }

  const generateVertexImage = resolveVertexImageGenerator(input.settings.providerSettings);

  if (!generateVertexImage) {
    throw new NonRetryableError('Vertex AI requires the Sloom Studio desktop app, or a service-account key on this device (Settings > Providers > Vertex AI).');
  }

  const route = getVertexImageRoute(input.modelId);
  const body = await buildVertexImageRequestBody({
    route,
    modelId: input.modelId,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    sourceImageInput: input.sourceImageInput,
    referenceImageInputs: input.referenceImageInputs,
    referenceGroups: input.referenceGroups,
    signal: input.abortSignal,
  });

  input.onStatus?.(route === 'imagen-predict' ? 'Generating image with Vertex Imagen…' : 'Generating image with Vertex Gemini…');

  const result = await generateVertexImage({
    projectId: vertexConfig.projectId,
    location: vertexConfig.location,
    auth: vertexConfig.auth,
    modelId: input.modelId,
    route,
    body,
  }, input.abortSignal);

  if (result.error) {
    throw new Error(result.error);
  }

  if (!result.result) {
    throw new Error('Vertex AI did not return an image payload.');
  }

  return {
    result: result.result,
    resultType: 'image',
    statusMessage: result.statusMessage ?? `Generated with ${input.modelId}`,
    mimeType: result.mimeType,
    usage: route === 'gemini-generate-content'
      ? createGeminiImageUsage(input.modelId, input.prompt, input.aspectRatio, 'actual')
      : undefined,
  };
}

async function buildVertexImageRequestBody(input: {
  route: VertexImageRoute;
  modelId: string;
  prompt: string;
  aspectRatio: AspectRatio;
  imageSize?: '1K' | '2K' | '4K';
  sourceImageInput?: string;
  referenceImageInputs: string[];
  referenceGroups?: FlowReferenceGroup[];
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  if (input.route === 'imagen-predict') {
    if (input.sourceImageInput || input.referenceImageInputs.length > 0) {
      throw new NonRetryableError('Imagen text-to-image models do not support upstream image editing or reference guidance in Flow yet.');
    }

    return buildVertexImagenPredictRequestBody({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
    });
  }

  const referenceEntries = collectReferencePartEntries(input.referenceGroups, input.referenceImageInputs);
  const references = await Promise.all(
    referenceEntries.map(async (entry) => ({
      image: await dataUrlToInlineImage(entry.url, input.signal),
      ...(entry.instruction ? { instruction: entry.instruction } : {}),
    })),
  );
  const sourceImage = input.sourceImageInput ? await dataUrlToInlineImage(input.sourceImageInput, input.signal) : undefined;

  return buildVertexGeminiImageRequestBody({
    prompt: buildGeminiImagePrompt(input.prompt, {
      hasSourceImage: Boolean(input.sourceImageInput),
      referenceImageCount: references.length,
    }),
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    sourceImage,
    references,
  });
}

// Vertex execution resolvers: prefer the Electron bridge (gcloud auth), fall
// back to direct REST with the user's service-account key (mobile standalone —
// the same credential "Test connection" proves in Settings). Returns undefined
// when neither path is available so callers keep their explicit errors.
function resolveVertexImageGenerator(providerSettings: ProviderSettings) {
  const bridge = getSignalLoomNativeBridge();
  if (bridge?.generateVertexImage) {
    return (request: NativeVertexImageRequest, signal?: AbortSignal) => runCancelableVertexBridgeRequest(
      request,
      bridge.generateVertexImage,
      bridge.cancelVertexGeneration,
      signal,
    );
  }
  if (isVertexDirectRestAvailable(providerSettings)) {
    return (request: NativeVertexImageRequest, signal?: AbortSignal) => generateVertexImageDirect(request, providerSettings, { signal });
  }
  return undefined;
}

function resolveVertexTextGenerator(providerSettings: ProviderSettings) {
  const bridge = getSignalLoomNativeBridge();
  if (bridge?.generateVertexText) {
    return (request: NativeVertexTextRequest, signal?: AbortSignal) => runCancelableVertexBridgeRequest(
      request,
      bridge.generateVertexText,
      bridge.cancelVertexGeneration,
      signal,
    );
  }
  if (isVertexDirectRestAvailable(providerSettings)) {
    return (request: NativeVertexTextRequest, signal?: AbortSignal) => generateVertexTextDirect(request, providerSettings, { signal });
  }
  return undefined;
}

function resolveVertexVideoGenerator(providerSettings: ProviderSettings) {
  const bridge = getSignalLoomNativeBridge();
  if (bridge?.generateVertexVideo) {
    return (request: NativeVertexVideoRequest, signal?: AbortSignal) => runCancelableVertexBridgeRequest(
      request,
      bridge.generateVertexVideo,
      bridge.cancelVertexGeneration,
      signal,
    );
  }
  if (isVertexDirectRestAvailable(providerSettings)) {
    return (request: NativeVertexVideoRequest, signal?: AbortSignal) => generateVertexVideoDirect(request, providerSettings, { signal });
  }
  return undefined;
}

let vertexBridgeRequestSequence = 0;

async function runCancelableVertexBridgeRequest<
  TRequest extends NativeVertexImageRequest | NativeVertexTextRequest | NativeVertexVideoRequest,
  TResult,
>(
  request: TRequest,
  invoke: (request: TRequest) => Promise<TResult>,
  cancel: ((cancellationId: string) => Promise<{ cancelled?: boolean }>) | undefined,
  signal?: AbortSignal,
): Promise<TResult> {
  throwIfAborted(signal);
  if (!signal || !cancel) {
    return raceWithAbort(invoke(request), signal);
  }

  vertexBridgeRequestSequence += 1;
  const cancellationId = `flow-vertex-${Date.now()}-${vertexBridgeRequestSequence}`;
  let cancellationSent = false;
  const cancelNativeRequest = () => {
    if (cancellationSent) return;
    cancellationSent = true;
    void cancel(cancellationId).catch(() => undefined);
  };
  signal.addEventListener('abort', cancelNativeRequest, { once: true });
  try {
    return await raceWithAbort(invoke({ ...request, cancellationId }), signal);
  } finally {
    signal.removeEventListener('abort', cancelNativeRequest);
  }
}

async function executeVertexGeminiTextContent(input: {
  modelId: string;
  settings: RuntimeSettingsSnapshot;
  body: Record<string, unknown>;
  label: string;
  signal?: AbortSignal;
}): Promise<string> {
  const vertexConfig = getVertexProjectConfig(input.settings.providerSettings);

  if (!vertexConfig.projectId) {
    throw new NonRetryableError(`${input.label} requires a configured Vertex AI project ID in Settings.`);
  }

  const generateVertexText = resolveVertexTextGenerator(input.settings.providerSettings);

  if (!generateVertexText) {
    throw new NonRetryableError(`${input.label} requires the Sloom Studio desktop app, or a service-account key on this device (Settings > Providers > Vertex AI).`);
  }

  const result = await generateVertexText({
    projectId: vertexConfig.projectId,
    location: vertexConfig.location,
    auth: vertexConfig.auth,
    modelId: input.modelId,
    body: input.body,
  }, input.signal);

  if (result.error) {
    throw new NonRetryableError(result.error);
  }

  if (typeof result.text !== 'string' || !result.text.trim()) {
    throw new NonRetryableError('Vertex AI returned no text content.');
  }

  return result.text.trim();
}

function buildVertexGeminiGenerateContentBody(input: {
  parts: unknown[];
  config: ReturnType<typeof buildGeminiTextConfig>;
  systemPrompt?: string;
}): Record<string, unknown> {
  const config = input.config as Record<string, unknown>;
  const tools = Array.isArray(config.tools) ? config.tools : undefined;
  const generationConfig = Object.fromEntries(
    Object.entries(config).filter(([key]) => key !== 'tools'),
  );

  return {
    contents: [
      {
        role: 'user',
        parts: input.parts,
      },
    ],
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    ...(tools ? { tools } : {}),
    ...(input.systemPrompt?.trim()
      ? {
          systemInstruction: {
            parts: [{ text: input.systemPrompt.trim() }],
          },
        }
      : {}),
  };
}

async function executeVideoNode(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
  abortSignal?: AbortSignal,
): Promise<ExecutionResult> {
  const provider = (node.data.provider as VideoProvider | undefined) ?? 'gemini';
  const rawModelId = getModelId(settings, 'video', provider, node.data.modelId);
  const modelId = provider === 'gemini' ? normalizeGeminiVideoModelId(rawModelId) : rawModelId;
  const modelContract = getVideoModelContract(provider, modelId);
  const prompt = context.prompt.trim();

  if (!prompt && !context.startImageInput && !context.extensionVideoInput) {
    throw new NonRetryableError('Video nodes need an upstream text prompt.');
  }

  // AUD-011 structured-group bounds, before any provider submission: guidance needs its numbered
  // image, and only the Gemini Veo/Omni routes can express the numbered association at all.
  const videoReferenceGroups = context.referenceGroups ?? [];
  for (const group of videoReferenceGroups) {
    if (!group.imageUrl && referenceGroupHasGuidance(group)) {
      throw new NonRetryableError(`Reference ${group.slot} has text/JSON guidance but no image. Connect an image to Reference ${group.slot} or move the guidance to the prompt input.`);
    }
  }
  if (videoReferenceGroups.some(referenceGroupHasGuidance) && provider !== 'gemini') {
    throw new NonRetryableError('This video provider route cannot express numbered reference guidance. Use a Gemini Veo 3.1 or Gemini Omni model for reference-guided video.');
  }

  switch (provider) {
    case 'gemini': {
      if (modelContract.availability === 'unavailable') {
        throw new NonRetryableError(`${modelContract.displayName} is unavailable.${modelContract.migrationModelId ? ` Select ${modelContract.migrationModelId} instead.` : ''}`);
      }
      if (settings.providerSettings.geminiCredentialMode === 'vertex-adc') {
        if (modelContract.apiFamily === 'google-gemini') {
          throw new NonRetryableError(`${modelContract.displayName} uses a Gemini Developer API model ID. Select the matching -001 Vertex model or switch Google credentials to API-key mode.`);
        }
        return isGeminiOmniModelId(modelId)
          ? executeVertexOmniVideoNode({
              modelId,
              prompt,
              context,
              settings,
              onStatus,
              abortSignal,
            })
          : executeVertexVeoVideoNode({
              modelId,
              prompt,
              context,
              settings,
              seed: coerceOptionalNumber(node.data.videoSeed),
              negativePrompt: normalizeOptionalString(node.data.videoNegativePrompt as string | undefined),
              sampleCount: coerceOptionalNumber(node.data.videoBatchCount),
              onStatus,
              abortSignal,
            });
      }

      const apiKey = requireApiKey(settings.apiKeys.gemini, 'Google Gemini');

      if (modelContract.apiFamily === 'google-vertex') {
        throw new NonRetryableError(`${modelContract.displayName} uses a Vertex model ID. Select the matching -preview Gemini API model or switch Google credentials to Vertex ADC.`);
      }

      if (isGeminiOmniModelId(modelId)) {
        return executeGeminiOmniVideoNode(apiKey, modelId, prompt, context, onStatus, abortSignal);
      }

      onStatus?.('Submitting video render to Gemini…');
      const operation = await startGeminiVideoGeneration(
        apiKey,
        modelId,
        videoReferencePromptWithGuidance(prompt, context),
        context,
        coerceOptionalNumber(node.data.videoSeed),
        normalizeOptionalString(node.data.videoNegativePrompt as string | undefined),
        coerceOptionalNumber(node.data.videoBatchCount),
        abortSignal,
      );
      const videoBlob = await retryExistingAsyncJobPhase({
        phaseLabel: `Gemini operation ${operation.name ?? 'result'} polling/materialization failed`,
        operation: () => pollGeminiVideoResult(apiKey, operation, onStatus, abortSignal),
        settings,
        onStatus,
        abortSignal,
      });

      return {
        result: await toResultUrl(videoBlob),
        resultType: 'video',
        statusMessage: `Generated ${context.config.durationSeconds}s ${context.config.videoResolution} video with ${modelId}`,
        usage: createGeminiVideoUsage(
          modelId,
          context.config.durationSeconds,
          context.config.videoResolution,
          'actual',
        ),
      };
    }
    case 'huggingface': {
      if (context.startImageInput || context.endImageInput) {
        throw new NonRetryableError('Hugging Face video models are text-to-video only in Sloom Studio. For a start frame use Gemini Veo or an Atlas image-to-video model.');
      }

      const { HfInference } = await loadProviderModule(
        () => import('@huggingface/inference'),
        'Hugging Face video',
      );
      onStatus?.('Generating video with Hugging Face…');
      const apiKey = requireApiKey(settings.apiKeys.huggingface, 'Hugging Face');
      const client = new HfInference(apiKey);
      const blob = await client.textToVideo({
        model: modelId,
        inputs: prompt,
      }, { signal: abortSignal });

      return {
        result: await toResultUrl(blob),
        resultType: 'video',
        statusMessage: `Generated with ${modelId}`,
      };
    }
    case 'atlas': {
      return executeAtlasVideoNode({ modelId, prompt, context, node, settings, onStatus, abortSignal });
    }
  }
}

async function executeAtlasVideoNode(input: {
  modelId: string;
  prompt: string;
  context: ExecutionContext;
  node: AppNode;
  settings: RuntimeSettingsSnapshot;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  const apiKey = requireApiKey(input.settings.apiKeys.atlas ?? '', 'Atlas');
  const baseUrl = normalizeAtlasBaseUrl(input.settings.providerSettings.atlasBaseUrl);
  // Image-to-video models take an uploaded start frame; text-to-video does not.
  const startImage = input.context.startImageInput
    ? await uploadAtlasMedia(baseUrl, apiKey, input.context.startImageInput, 'flow-atlas-video-start.png', input.abortSignal)
    : undefined;
  const body: Record<string, unknown> = {
    model: input.modelId,
    prompt: input.prompt,
    duration: input.context.config.durationSeconds,
    resolution: input.context.config.videoResolution,
    aspect_ratio: input.context.config.aspectRatio,
    generate_audio: input.node.data.videoGenerateAudio ?? true,
  };
  const seed = coerceOptionalNumber(input.node.data.videoSeed);
  if (seed !== undefined) body.seed = seed;
  const negativePrompt = normalizeOptionalString(input.node.data.videoNegativePrompt as string | undefined);
  if (negativePrompt) body.negative_prompt = negativePrompt;
  if (startImage) body.image = startImage;

  input.onStatus?.('Generating video with Atlas Cloud…');
  const response = await fetch(`${baseUrl}/model/generateVideo`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: input.abortSignal,
  });

  if (!response.ok) {
    throw await createHttpStatusError(response, 'Atlas video generation failed');
  }

  const created = (await response.json()) as AtlasCreateResponse;
  if (created.error || created.data?.error) {
    throw new Error(extractProviderError(created.error ?? created.data?.error, 'Atlas video generation failed.'));
  }

  const immediateOutput = extractAtlasOutputUrl(created);
  const predictionId = extractAtlasPredictionId(created);
  const resultUrl = immediateOutput ?? (predictionId
    ? (await retryExistingAsyncJobPhase({
        phaseLabel: `Atlas video prediction ${predictionId} polling failed`,
        operation: () => pollAtlasPredictionResult(baseUrl, apiKey, predictionId, input.onStatus, 'video', input.abortSignal),
        settings: input.settings,
        onStatus: input.onStatus,
        abortSignal: input.abortSignal,
      }))[0]
    : undefined);

  if (!resultUrl) {
    throw new Error('Atlas did not return a prediction ID or video output.');
  }

  const materialized = await retryExistingAsyncJobPhase({
    phaseLabel: 'Atlas video result materialization failed',
    operation: () => materializeAtlasVideoResult(resultUrl, input.abortSignal),
    settings: input.settings,
    onStatus: input.onStatus,
    abortSignal: input.abortSignal,
  });
  return {
    result: materialized.result,
    resultType: 'video',
    mimeType: materialized.mimeType,
    statusMessage: `Generated ${input.context.config.durationSeconds}s ${input.context.config.videoResolution} video with ${input.modelId}`,
  };
}

function materializeAtlasVideoResult(resultUrl: string, signal?: AbortSignal): Promise<{ result: string; mimeType?: string }> {
  return materializeRemoteMediaResult(resultUrl, 'Atlas video download failed', 'video/mp4', signal);
}

async function executeVertexVeoVideoNode(input: {
  modelId: string;
  prompt: string;
  context: ExecutionContext;
  settings: RuntimeSettingsSnapshot;
  seed?: number;
  negativePrompt?: string;
  sampleCount?: number;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  const vertexConfig = getVertexProjectConfig(input.settings.providerSettings);

  if (!vertexConfig.projectId) {
    throw new NonRetryableError('Vertex AI project ID is missing. Add it in Settings before running Vertex video models.');
  }

  const generateVertexVideo = resolveVertexVideoGenerator(input.settings.providerSettings);

  if (!generateVertexVideo) {
    throw new NonRetryableError('Vertex AI video requires the Sloom Studio desktop app, or a service-account key on this device (Settings > Providers > Vertex AI).');
  }

  validateGeminiVeoVideoRequest(input.modelId, input.prompt, input.context);
  const videoInputs = await buildGeminiVideoRequestInputs(input.context, input.abortSignal);
  const body = buildVertexVeoVideoRequestBody(
    {
      prompt: videoReferencePromptWithGuidance(input.prompt, input.context),
      ...videoInputs,
    },
    {
      aspectRatio: input.context.config.aspectRatio,
      durationSeconds: input.context.config.durationSeconds,
      videoResolution: input.context.config.videoResolution,
      seed: input.seed,
      negativePrompt: input.negativePrompt,
      sampleCount: input.sampleCount,
    },
  );

  input.onStatus?.('Submitting video render to Vertex AI Veo…');
  const result = await generateVertexVideo({
    projectId: vertexConfig.projectId,
    location: resolveVertexVideoLocation(vertexConfig.location),
    auth: vertexConfig.auth,
    modelId: input.modelId,
    route: 'veo-predict-long-running',
    body,
  }, input.abortSignal);

  if (result.error) {
    throw new Error(result.error);
  }

  if (!result.result) {
    throw new Error('Vertex AI did not return a video payload.');
  }

  return {
    result: result.result,
    resultType: 'video',
    statusMessage: result.statusMessage ?? `Generated ${input.context.config.durationSeconds}s ${input.context.config.videoResolution} video with ${input.modelId}`,
    usage: createGeminiVideoUsage(
      input.modelId,
      input.context.config.durationSeconds,
      input.context.config.videoResolution,
      'actual',
    ),
    mimeType: result.mimeType,
    extension: result.mimeType?.includes('webm') ? 'webm' : 'mp4',
  };
}

async function executeVertexOmniVideoNode(input: {
  modelId: string;
  prompt: string;
  context: ExecutionContext;
  settings: RuntimeSettingsSnapshot;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  validateOmniVideoRequest(input.context);
  const vertexConfig = getVertexProjectConfig(input.settings.providerSettings);

  if (!vertexConfig.projectId) {
    throw new NonRetryableError('Vertex AI project ID is missing. Add it in Settings before running Vertex Gemini Omni video.');
  }

  const generateVertexVideo = resolveVertexVideoGenerator(input.settings.providerSettings);

  if (!generateVertexVideo) {
    throw new NonRetryableError('Vertex AI Gemini Omni video requires the Sloom Studio desktop app, or a service-account key on this device (Settings > Providers > Vertex AI).');
  }

  const media = await buildOmniVideoMediaParts(input.context, input.abortSignal);

  if (!input.prompt.trim() && media.length === 0) {
    throw new NonRetryableError('Gemini Omni video needs a prompt, image reference, or video reference.');
  }

  input.onStatus?.('Submitting video render to Vertex Gemini Omni…');
  const result = await generateVertexVideo({
    projectId: vertexConfig.projectId,
    location: resolveVertexVideoLocation(vertexConfig.location),
    auth: vertexConfig.auth,
    modelId: input.modelId,
    route: 'gemini-generate-content',
    apiVersion: 'v1beta1',
    body: buildVertexOmniVideoRequestBody({
      prompt: input.prompt,
      media,
    }),
  }, input.abortSignal);

  if (result.error) {
    throw new Error(result.error);
  }

  if (!result.result) {
    throw new Error('Vertex Gemini Omni did not return a video payload.');
  }

  return {
    result: result.result,
    resultType: 'video',
    statusMessage: result.statusMessage ?? `Generated video with ${input.modelId}`,
    usage: createGeminiVideoUsage(
      input.modelId,
      input.context.config.durationSeconds,
      input.context.config.videoResolution,
      'actual',
    ),
    mimeType: result.mimeType,
    extension: result.mimeType?.includes('webm') ? 'webm' : 'mp4',
  };
}

async function executeGeminiOmniVideoNode(
  apiKey: string,
  modelId: string,
  prompt: string,
  context: ExecutionContext,
  onStatus?: (statusMessage: string) => void,
  abortSignal?: AbortSignal,
): Promise<ExecutionResult> {
  validateOmniVideoRequest(context);
  onStatus?.('Generating video with Gemini Omni…');
  const { GoogleGenAI } = await loadProviderModule(
    () => import('@google/genai'),
    'Google Gemini Omni video',
  );
  const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
  const media = await buildOmniVideoMediaParts(context, abortSignal);

  if (!prompt.trim() && media.length === 0) {
    throw new NonRetryableError('Gemini Omni video needs a prompt, image reference, or video reference.');
  }

  const interactionInput: Array<Record<string, string>> = [];
  if (prompt.trim()) {
    interactionInput.push({ type: 'text', text: prompt.trim() });
  }
  for (const item of media) {
    if (item.instruction) interactionInput.push({ type: 'text', text: item.instruction });
    interactionInput.push({
      type: item.inlineData.mimeType.startsWith('video/') ? 'video' : 'image',
      data: item.inlineData.data,
      mime_type: item.inlineData.mimeType,
    });
  }

  const task = context.extensionVideoInput
    ? 'edit'
    : (context.referenceImageInputs?.length ?? 0) > 0
      ? 'reference_to_video'
      : context.startImageInput
        ? 'image_to_video'
        : 'text_to_video';

  const interactionRequest = {
    model: modelId,
    input: interactionInput as never,
    response_format: {
      type: 'video',
      aspect_ratio: context.config.aspectRatio,
    },
    generation_config: {
      video_config: {
        task,
        duration: context.config.durationSeconds,
      },
    } as never,
  };
  const interaction = abortSignal
    ? await client.interactions.create(interactionRequest, { signal: abortSignal })
    : await client.interactions.create(interactionRequest);
  const videoPart = extractOmniInteractionVideo(interaction);

  if (!videoPart) {
    throw new Error('Gemini Omni completed without a video output in the Interactions API response.');
  }

  const result = videoPart.data
    ? await toResultUrl(inlineDataToBlob(videoPart.data, videoPart.mimeType))
    : await materializeRemoteMediaResult(videoPart.uri as string, 'Gemini Omni video download failed', videoPart.mimeType, abortSignal);

  return {
    result: typeof result === 'string' ? result : result.result,
    resultType: 'video',
    statusMessage: `Generated video with ${modelId}`,
    usage: createGeminiVideoUsage(
      modelId,
      context.config.durationSeconds,
      context.config.videoResolution,
      'actual',
    ),
    mimeType: videoPart.mimeType,
    extension: videoPart.mimeType.includes('webm') ? 'webm' : 'mp4',
  };
}

function validateOmniVideoRequest(context: ExecutionContext): void {
  if (context.endImageInput) {
    throw new NonRetryableError('Gemini Omni Flash does not support first/last-frame interpolation. Use Veo 3.1 for an End Frame input.');
  }

  const referenceImageCount = context.referenceImageInputs?.length ?? 0;
  if (referenceImageCount > 3) {
    throw new NonRetryableError('The Flow Gemini Omni interface supports up to three reference images. Remove extra reference-image edges before running.');
  }
}

function extractOmniInteractionVideo(interaction: unknown): {
  data?: string;
  uri?: string;
  mimeType: string;
} | undefined {
  if (!interaction || typeof interaction !== 'object') return undefined;
  const record = interaction as Record<string, unknown>;
  const convenience = (record.output_video ?? record.outputVideo) as Record<string, unknown> | undefined;
  const outputs = Array.isArray(record.outputs) ? record.outputs : [];
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const stepContents = steps.flatMap((step) => {
    const content = step && typeof step === 'object' ? (step as Record<string, unknown>).content : undefined;
    return Array.isArray(content) ? content : [];
  });
  const candidate = [convenience, ...outputs, ...stepContents].find((item) =>
    item && typeof item === 'object' && (item as Record<string, unknown>).type === 'video'
  ) ?? convenience;
  if (!candidate || typeof candidate !== 'object') return undefined;
  const video = candidate as Record<string, unknown>;
  const data = typeof video.data === 'string' ? video.data : undefined;
  const uri = typeof video.uri === 'string' ? video.uri : undefined;
  if (!data && !uri) return undefined;
  const mimeType = typeof video.mime_type === 'string'
    ? video.mime_type
    : typeof video.mimeType === 'string' ? video.mimeType : 'video/mp4';
  return { data, uri, mimeType };
}

function validateGeminiVeoVideoRequest(
  modelId: string,
  prompt: string,
  context: ExecutionContext,
): void {
  validateGeminiVideoRequest({
    aspectRatio: context.config.aspectRatio,
    durationSeconds: context.config.durationSeconds,
    videoResolution: context.config.videoResolution,
    modelId,
    promptProvided: Boolean(prompt.trim()),
    hasStartImage: Boolean(context.startImageInput),
    hasEndImage: Boolean(context.endImageInput),
    referenceImageCount: context.referenceImageInputs?.length ?? 0,
    hasExtensionVideo: Boolean(context.extensionVideoInput),
  });
}

/**
 * AUD-011: Veo's native referenceImages structure associates image↔type but has no per-image
 * text channel, so numbered guidance is serialized into the prompt with each Reference N's
 * provable position in the referenceImages array. Empty prompts stay empty — Veo's own
 * "guidance requires a prompt" validation must keep firing on the authored prompt.
 */
function videoReferencePromptWithGuidance(prompt: string, context: ExecutionContext): string {
  const groups = context.referenceGroups;
  if (!groups) return prompt;
  const referenceImageCount = groups.filter((group) => group.imageUrl).length;
  const block = buildReferenceGuidancePromptBlock(groups, (_group, imageOrdinal) =>
    `reference image ${imageOrdinal} of ${referenceImageCount}`);
  return appendReferenceGuidanceBlockToPrompt(prompt, block);
}

async function buildGeminiVideoRequestInputs(context: ExecutionContext, signal?: AbortSignal): Promise<{
  startImage?: Awaited<ReturnType<typeof dataUrlToGeminiImage>>;
  endImage?: Awaited<ReturnType<typeof dataUrlToGeminiImage>>;
  referenceImages?: Array<{
    image: Awaited<ReturnType<typeof dataUrlToGeminiImage>>;
    referenceType: VideoReferenceType;
  }>;
  extensionVideo?: Awaited<ReturnType<typeof dataUrlToGeminiVideo>>;
}> {
  const startImage = context.startImageInput ? await dataUrlToGeminiImage(context.startImageInput, signal) : undefined;
  const endImage = context.endImageInput ? await dataUrlToGeminiImage(context.endImageInput, signal) : undefined;
  const referenceImages = context.referenceImageInputs
    ? await Promise.all(
        context.referenceImageInputs.map(async (reference) => ({
          image: await dataUrlToGeminiImage(reference.url, signal),
          referenceType: reference.referenceType,
        })),
      )
    : [];
  const extensionVideo = context.extensionVideoInput
    ? await dataUrlToGeminiVideo(context.extensionVideoInput, signal)
    : undefined;

  return {
    ...(startImage ? { startImage } : {}),
    ...(endImage ? { endImage } : {}),
    ...(referenceImages.length > 0 ? { referenceImages } : {}),
    ...(extensionVideo ? { extensionVideo } : {}),
  };
}

async function buildOmniVideoMediaParts(context: ExecutionContext, signal?: AbortSignal): Promise<Array<{
  inlineData: {
    data: string;
    mimeType: string;
  };
  instruction?: string;
}>> {
  const media: Array<{
    inlineData: {
      data: string;
      mimeType: string;
    };
    instruction?: string;
  }> = [];

  if (context.startImageInput) {
    media.push({
      instruction: 'Use this as the starting visual reference.',
      inlineData: await dataUrlToInlineImage(context.startImageInput, signal),
    });
  }

  if (context.referenceGroups) {
    for (const group of context.referenceGroups) {
      if (!group.imageUrl) continue;
      media.push({
        // Omni's per-media instruction IS the native per-image guidance channel: guided slots
        // carry their numbered Reference N text; image-only slots keep the legacy instruction.
        instruction: referenceGroupHasGuidance(group)
          ? formatReferenceGroupInstruction(group)
          : `Use this as a ${group.referenceType ?? 'asset'} reference.`,
        inlineData: await dataUrlToInlineImage(group.imageUrl, signal),
      });
    }
  } else {
    for (const reference of context.referenceImageInputs ?? []) {
      media.push({
        instruction: `Use this as a ${reference.referenceType} reference.`,
        inlineData: await dataUrlToInlineImage(reference.url, signal),
      });
    }
  }

  if (context.extensionVideoInput) {
    media.push({
      instruction: 'Continue, remix, or edit this source video.',
      inlineData: await dataUrlToInlineData(context.extensionVideoInput, 'video/mp4', undefined, signal),
    });
  }

  if (media.length > 5) {
    throw new Error('Gemini Omni video currently accepts up to five connected media references.');
  }

  return media;
}

function resolveVertexVideoLocation(location: string): string {
  const normalized = location.trim();
  return normalized === 'global' || normalized === 'us-west2'
    ? 'us-central1'
    : normalized || 'us-central1';
}

const ELEVENLABS_TRANSCRIPTION_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const ELEVENLABS_TTS_TIMING_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const ELEVENLABS_TTS_TIMING_MAX_CHARACTERS = 40_000;
const ELEVENLABS_TTS_TIMING_MAX_WORDS = 10_000;
const ELEVENLABS_TTS_TIMING_MAX_DURATION_MS = 10 * 60 * 1_000;

async function executeTranscriptionNode(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
  abortSignal?: AbortSignal,
): Promise<ExecutionResult> {
  const operation = node.data.transcriptionOperation ?? 'transcribe';
  const sourceUrl = context.audioSourceInput ?? context.sourceVideoInput;
  if (!sourceUrl) {
    throw new NonRetryableError(`${operation === 'align' ? 'Forced alignment' : 'Transcription'} needs one connected audio or video source.`);
  }

  const sourceKind: DownstreamMediaKind = context.audioSourceInput ? 'audio' : 'video';
  onStatus?.(`Preparing ${sourceKind} for ElevenLabs ${operation === 'align' ? 'Forced Alignment' : 'Scribe'}…`);
  const { blob: sourceBlob, mimeType } = await fetchDownstreamMediaBlob(sourceUrl, {
    kind: sourceKind,
    errorLabel: `Upstream ${sourceKind} could not be materialized for ${operation === 'align' ? 'forced alignment' : 'transcription'}`,
  }, abortSignal);

  const apiKey = requireApiKey(settings.apiKeys.elevenlabs, 'ElevenLabs');
  const formData = new FormData();
  formData.append('file', sourceBlob, `flow-transcription-input.${extensionForTranscriptionMime(mimeType ?? sourceBlob.type, sourceKind)}`);
  let endpoint: string;
  let failureLabel: string;
  let exactAlignmentText = '';
  if (operation === 'align') {
    const connectedText = context.prompt;
    const authoredText = node.data.transcriptionAlignmentText ?? '';
    exactAlignmentText = connectedText.trim() ? connectedText : authoredText;
    if (!exactAlignmentText.trim()) {
      throw new NonRetryableError('Forced alignment needs the exact spoken transcript in the node or from a connected Text node.');
    }
    if (exactAlignmentText.length > 675_000) {
      throw new NonRetryableError('Forced alignment text is limited to 675,000 characters.');
    }
    formData.append('text', exactAlignmentText);
    endpoint = 'https://api.elevenlabs.io/v1/forced-alignment';
    failureLabel = 'ElevenLabs forced alignment failed';
    onStatus?.('Aligning the known transcript with ElevenLabs…');
  } else {
    formData.append('model_id', 'scribe_v2');
    formData.append('timestamps_granularity', node.data.transcriptionTimestampGranularity ?? 'word');
    formData.append('diarize', String(node.data.transcriptionDiarize ?? true));
    formData.append('tag_audio_events', String(node.data.transcriptionTagAudioEvents ?? true));
    formData.append('no_verbatim', String(node.data.transcriptionNoVerbatim ?? false));

    const languageCode = normalizeOptionalString(node.data.transcriptionLanguageCode);
    if (languageCode && languageCode !== 'auto') formData.append('language_code', languageCode);

    const speakerCount = coerceOptionalNumber(node.data.transcriptionNumSpeakers);
    if (speakerCount !== undefined) {
      formData.append('num_speakers', String(Math.min(32, Math.max(1, Math.round(speakerCount)))));
    }

    for (const keyterm of splitTranscriptionKeyterms(node.data.transcriptionKeyterms)) {
      formData.append('keyterms', keyterm);
    }
    endpoint = 'https://api.elevenlabs.io/v1/speech-to-text';
    failureLabel = 'ElevenLabs transcription failed';
    onStatus?.('Transcribing with ElevenLabs Scribe v2…');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: formData,
    signal: abortSignal,
  });

  if (!response.ok) {
    throw await createHttpStatusError(response, failureLabel);
  }

  const rawText = await readBoundedResponseText(
    response,
    ELEVENLABS_TRANSCRIPTION_MAX_RESPONSE_BYTES,
    `ElevenLabs ${operation === 'align' ? 'forced-alignment' : 'transcription'} response exceeds the 64 MB safety limit.`,
    abortSignal,
  );
  let payload: unknown;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new NonRetryableError(`ElevenLabs ${operation === 'align' ? 'forced alignment' : 'transcription'} returned invalid JSON.`);
  }

  let timedTranscript: TimedTranscriptV1;
  try {
    timedTranscript = operation === 'align'
      ? normalizeElevenLabsForcedAlignmentResponse(payload, exactAlignmentText)
      : normalizeElevenLabsScribeResponse(payload);
  } catch (error) {
    throw new NonRetryableError(error instanceof Error ? error.message : 'ElevenLabs returned invalid timing data.');
  }

  return materializeTimedTranscriptResult(timedTranscript, operation);
}

async function materializeTimedTranscriptResult(
  timedTranscript: TimedTranscriptV1,
  operation: 'transcribe' | 'align',
): Promise<ExecutionResult> {

  const cues = timedTranscriptToCaptionCues(timedTranscript);
  const vttText = serializeWebVttCaptions(cues);
  const srtText = serializeSrtCaptions(cues);
  const vttBlob = new Blob([vttText], { type: 'text/vtt' });
  const srtBlob = new Blob([srtText], { type: 'application/x-subrip' });
  const timedJson = JSON.stringify(timedTranscript, null, 2);
  const namedOutputs: Record<string, NodeOutputArtifact> = {
    [TRANSCRIPTION_OUTPUT_HANDLES.text]: {
      result: timedTranscript.text,
      resultType: 'text',
      mimeType: 'text/plain',
      extension: 'txt',
      fileName: 'transcript.txt',
    },
    [TRANSCRIPTION_OUTPUT_HANDLES.timed]: {
      result: timedJson,
      resultType: 'json',
      mimeType: 'application/json',
      extension: 'json',
      fileName: 'timed-transcript.json',
      outputMetadata: { timedTranscript },
    },
    [TRANSCRIPTION_OUTPUT_HANDLES.vtt]: {
      result: await toResultUrl(vttBlob),
      resultType: 'text',
      assetKind: 'subtitle',
      blob: vttBlob,
      mimeType: 'text/vtt',
      extension: 'vtt',
      fileName: operation === 'align' ? 'aligned-captions.vtt' : 'captions.vtt',
    },
    [TRANSCRIPTION_OUTPUT_HANDLES.srt]: {
      result: await toResultUrl(srtBlob),
      resultType: 'text',
      assetKind: 'subtitle',
      blob: srtBlob,
      mimeType: 'application/x-subrip',
      extension: 'srt',
      fileName: operation === 'align' ? 'aligned-captions.srt' : 'captions.srt',
    },
  };
  const durationSeconds = timedTranscript.words.reduce(
    (maximum, word) => Math.max(maximum, (word.endMs ?? 0) / 1_000),
    0,
  );

  return {
    result: timedTranscript.text,
    resultType: 'text',
    statusMessage: cues.length > 0
      ? `${operation === 'align' ? 'Aligned the known transcript' : 'Transcribed with Scribe v2'} and created ${cues.length} caption cue${cues.length === 1 ? '' : 's'}`
      : `${operation === 'align' ? 'Forced alignment' : 'Scribe v2'} completed without usable caption timings`,
    mimeType: 'text/plain',
    extension: 'txt',
    fileName: 'transcript.txt',
    outputMetadata: { timedTranscript, captionCueCount: cues.length },
    namedOutputs,
    usage: {
      source: 'actual',
      confidence: 'unknown',
      provider: 'elevenlabs',
      modelId: operation === 'align' ? 'forced_alignment' : 'scribe_v2',
      ...(durationSeconds > 0 ? { durationSeconds } : {}),
      notes: [operation === 'align'
        ? 'ElevenLabs forced-alignment usage completed; its pricing follows Speech to Text and is not currently mapped in the app.'
        : 'ElevenLabs Scribe usage completed; transcription pricing is not currently mapped in the app.'],
    },
  };
}

async function executeAudioProcessNode(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
  abortSignal?: AbortSignal,
): Promise<ExecutionResult> {
  if ((node.data.audioProcessOperation ?? 'isolate-voice') !== 'isolate-voice') {
    throw new NonRetryableError('This Audio Process operation is not available in the current build.');
  }
  const sourceUrl = context.audioSourceInput ?? context.sourceVideoInput;
  if (!sourceUrl) throw new NonRetryableError('Voice Isolation needs one connected audio or video source.');

  const sourceKind: DownstreamMediaKind = context.audioSourceInput ? 'audio' : 'video';
  onStatus?.(`Preparing ${sourceKind} for ElevenLabs Voice Isolator…`);
  const { blob: sourceBlob, mimeType } = await fetchDownstreamMediaBlob(sourceUrl, {
    kind: sourceKind,
    errorLabel: `Upstream ${sourceKind} could not be materialized for voice isolation`,
  }, abortSignal);
  const formData = new FormData();
  formData.append('audio', sourceBlob, `flow-voice-isolation-input.${extensionForTranscriptionMime(mimeType ?? sourceBlob.type, sourceKind)}`);
  formData.append('file_format', 'other');

  onStatus?.('Isolating dialogue with ElevenLabs…');
  const response = await fetch('https://api.elevenlabs.io/v1/audio-isolation', {
    method: 'POST',
    headers: { 'xi-api-key': requireApiKey(settings.apiKeys.elevenlabs, 'ElevenLabs') },
    body: formData,
    signal: abortSignal,
  });
  if (!response.ok) throw await createHttpStatusError(response, 'ElevenLabs Voice Isolation failed');

  const usage = buildAudioUsage('elevenlabs', 'audio_isolation', {
    confidence: 'unknown',
    notes: ['Voice Isolation is billed by source duration; the accepted response did not expose exact run cost.'],
  });
  const materialized = await materializeAcceptedElevenLabsExecutionAudio(
    response,
    context.config.audioOutputFormat,
    usage,
    abortSignal,
  );
  const fileName = `isolated-dialogue.${materialized.extension ?? 'mp3'}`;
  const namedOutputs: Record<string, NodeOutputArtifact> = {
    [AUDIO_PROCESS_OUTPUT_HANDLES.isolatedAudio]: {
      result: materialized.result,
      resultType: 'audio',
      assetKind: 'audio',
      blob: materialized.blob,
      mimeType: materialized.mimeType,
      extension: materialized.extension,
      fileName,
      outputMetadata: { operation: 'audio_isolation', ...(materialized.outputMetadata ?? {}) },
    },
  };

  return {
    ...materialized,
    resultType: 'audio',
    fileName,
    statusMessage: 'Isolated dialogue with ElevenLabs Voice Isolator',
    outputMetadata: { operation: 'audio_isolation', ...(materialized.outputMetadata ?? {}) },
    namedOutputs,
  };
}

function splitTranscriptionKeyterms(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function extensionForTranscriptionMime(mimeType: string | undefined, kind: DownstreamMediaKind): string {
  const normalized = (mimeType ?? '').toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('quicktime')) return 'mov';
  if (normalized.includes('mp4')) return 'mp4';
  return kind === 'audio' ? 'wav' : 'mp4';
}

async function executeAudioNode(
  node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
  abortSignal?: AbortSignal,
): Promise<ExecutionResult> {
  const provider = (node.data.provider as AudioProvider | undefined) ?? 'elevenlabs';
  const modelId = getModelId(settings, 'audio', provider, node.data.modelId);
  const audioMode = (node.data.audioGenerationMode as string | undefined) ?? 'speech';
  const prompt = context.prompt.trim();

  const modelContract = getAudioModelContract(provider, modelId);
  const operation = audioModeToOperation(audioMode as import('../types/flow').AudioGenerationMode);
  if (modelContract.availability === 'unavailable') {
    throw new NonRetryableError(`${modelContract.displayName} is unavailable.${modelContract.migrationModelId ? ` Choose ${modelContract.migrationModelId}.` : ''}`);
  }
  if (!modelContract.operations.includes(operation)) {
    throw new NonRetryableError(`${modelContract.displayName} does not support ${operation.replaceAll('-', ' ')}. Choose a compatible model or audio mode.`);
  }

  if (audioMode !== 'voiceChange' && !prompt) {
    throw new NonRetryableError('Audio nodes need an upstream text prompt.');
  }

  switch (provider) {
    case 'gemini': {
      if (audioMode !== 'speech') {
        throw new NonRetryableError('Gemini audio nodes currently support text-to-speech only.');
      }

      // Gemini TTS runs on the Gemini API key even in Vertex mode (Vertex does not serve the TTS
      // models in this build). Only fail when no key exists — the provider dropdown already lists
      // Google for audio ONLY when a key is configured, so hard-throwing on vertex-adc mode
      // (the default) made every listed Gemini TTS run fail.
      if (!settings.apiKeys.gemini?.trim()) {
        // Wording note: "requires" keeps this non-retryable for the backoff classifier.
        throw new NonRetryableError('Gemini TTS requires a Gemini API key (Vertex sign-in alone cannot run the TTS models). Add the key in Settings.');
      }

      onStatus?.('Synthesizing audio with Gemini TTS…');
      const { GoogleGenAI } = await loadProviderModule(
        () => import('@google/genai'),
        'Google Gemini audio',
      );
      const apiKey = requireApiKey(settings.apiKeys.gemini, 'Google Gemini');
      const client = new GoogleGenAI({ apiKey });
      const voiceName = normalizeOptionalString(node.data.geminiVoiceName as string | undefined) ?? 'Kore';
      const ttsPrompt = buildGeminiTtsPrompt(
        prompt,
        normalizeOptionalString(node.data.audioStyleDescription as string | undefined),
      );
      let audioBase64: string | undefined;
      if (modelContract.apiFamily === 'google-interactions') {
        const interactionRequest = {
          model: modelId,
          input: ttsPrompt,
          response_format: { type: 'audio' },
          generation_config: {
            speech_config: [{ voice: voiceName }],
          },
        } as never;
        const interaction = abortSignal
          ? await client.interactions.create(interactionRequest, { signal: abortSignal })
          : await client.interactions.create(interactionRequest);
        audioBase64 = extractGeminiInteractionAudio(interaction);
      } else {
        const response = await client.models.generateContent({
          model: modelId,
          contents: [{ parts: [{ text: ttsPrompt }] }],
          config: {
            abortSignal,
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
          },
        });
        audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      }

      if (!audioBase64) {
        throw new Error('Gemini TTS did not return audio data.');
      }

      return {
        result: await toResultUrl(await pcmBase64ToWavBlob(audioBase64)),
        resultType: 'audio',
        statusMessage: `Generated with ${modelId}`,
        usage: buildAudioUsage('gemini', modelId, {
          confidence: 'unknown',
          notes: ['Gemini TTS pricing is not currently mapped in the app.'],
        }),
      };
    }
    case 'elevenlabs': {
      const apiKey = requireApiKey(settings.apiKeys.elevenlabs, 'ElevenLabs');
      const voiceId =
        normalizeOptionalString(node.data.voiceId as string | undefined) ??
        normalizeOptionalString(settings.providerSettings.elevenlabsVoiceId);

      if (audioMode === 'speech') {
        if (!voiceId) {
          throw new NonRetryableError('Choose an ElevenLabs voice in the node or settings.');
        }

        onStatus?.('Synthesizing audio with ElevenLabs…');
        // voice_settings/seed ride along only when the user set them — otherwise the voice's own
        // provider-side defaults apply (sending a partial object would override them with API defaults).
        const voiceSettings = buildElevenLabsVoiceSettings(node.data);
        const speechSeed = coerceOptionalNumber(node.data.audioSeed);
        const withTimestamps = node.data.audioTtsWithTimestamps === true;
        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}${withTimestamps ? '/with-timestamps' : ''}?output_format=${context.config.audioOutputFormat}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': apiKey,
            },
            body: JSON.stringify({
              text: prompt,
              model_id: modelId,
              ...(speechSeed !== undefined ? { seed: Math.min(4_294_967_295, Math.max(0, Math.floor(speechSeed))) } : {}),
              ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
            }),
            signal: abortSignal,
          },
        );

        if (!response.ok) {
          throw await createHttpStatusError(response, 'ElevenLabs TTS failed');
        }

        const usage = createElevenLabsTtsUsage(modelId, prompt, 'actual');
        const materialized = withTimestamps
          ? await materializeAcceptedElevenLabsTimestampedSpeech(
              response,
              context.config.audioOutputFormat,
              prompt,
              usage,
              abortSignal,
            )
          : await materializeAcceptedElevenLabsExecutionAudio(
              response,
              context.config.audioOutputFormat,
              usage,
              abortSignal,
            );

        return {
          ...materialized,
          resultType: 'audio',
          statusMessage: `Generated with ${modelId}`,
        };
      }

      if (audioMode === 'soundEffect') {
        onStatus?.('Generating sound effect with ElevenLabs…');
        const response = await fetch(
          `https://api.elevenlabs.io/v1/sound-generation?output_format=${context.config.audioOutputFormat}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': apiKey,
            },
            body: JSON.stringify({
              text: prompt,
              model_id: modelId,
              loop: Boolean(node.data.audioLoop),
              duration_seconds: clampOptionalNumber(coerceOptionalNumber(node.data.audioDurationSeconds), 0.5, 30),
              prompt_influence: clampOptionalNumber(coerceOptionalNumber(node.data.audioPromptInfluence), 0, 1),
            }),
            signal: abortSignal,
          },
        );

        if (!response.ok) {
          throw await createHttpStatusError(response, 'ElevenLabs sound effect generation failed');
        }

        return {
          ...await materializeAcceptedElevenLabsExecutionAudio(
            response,
            context.config.audioOutputFormat,
            buildAudioUsage('elevenlabs', modelId, {
              characters: prompt.length,
              confidence: 'unknown',
              notes: ['ElevenLabs sound-effect pricing is not currently mapped in the app.'],
            }),
            abortSignal,
          ),
          resultType: 'audio',
          statusMessage: `Generated sound effect with ${modelId}`,
        };
      }

      if (audioMode === 'music') {
        if (prompt.length > 4_100) {
          throw new NonRetryableError('Eleven Music v2 prompts are limited to 4,100 characters. Shorten the upstream prompt before running.');
        }

        onStatus?.('Composing music with ElevenLabs Music v2…');
        const durationSeconds = clampOptionalNumber(coerceOptionalNumber(node.data.audioDurationSeconds), 3, 600);
        const outputFormat = context.config.audioOutputFormat;
        const response = await fetch(
          `https://api.elevenlabs.io/v1/music?output_format=${outputFormat}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': apiKey,
            },
            body: JSON.stringify({
              prompt,
              model_id: modelId,
              ...(durationSeconds !== undefined ? { music_length_ms: Math.round(durationSeconds * 1_000) } : {}),
              force_instrumental: Boolean(node.data.audioForceInstrumental),
            }),
            signal: abortSignal,
          },
        );

        if (!response.ok) {
          throw await createHttpStatusError(response, 'ElevenLabs music generation failed');
        }

        return {
          ...await materializeAcceptedElevenLabsExecutionAudio(
            response,
            outputFormat,
            buildAudioUsage('elevenlabs', modelId, {
              characters: prompt.length,
              confidence: 'unknown',
              notes: ['ElevenLabs music pricing is not currently mapped in the app.'],
            }),
            abortSignal,
          ),
          resultType: 'audio',
          statusMessage: `Generated music with ${modelId}`,
        };
      }

      if (!voiceId) {
        throw new NonRetryableError('Choose an ElevenLabs voice in the node or settings.');
      }

      if (!context.audioSourceInput) {
        throw new NonRetryableError('Voice changer mode needs an upstream audio node or imported audio asset.');
      }

      onStatus?.('Changing voice with ElevenLabs…');
      const { blob: sourceBlob } = await fetchDownstreamMediaBlob(context.audioSourceInput, {
        kind: 'audio',
        errorLabel: 'Upstream audio reference could not be materialized',
      }, abortSignal);
      const formData = new FormData();
      formData.append('audio', sourceBlob, 'flow-audio-input.wav');
      formData.append('model_id', modelId);

      if (node.data.audioRemoveBackgroundNoise) {
        formData.append('remove_background_noise', 'true');
      }

      const seedValue = coerceOptionalNumber(node.data.audioSeed);

      if (seedValue !== undefined) {
        formData.append('seed', String(Math.min(4_294_967_295, Math.max(0, Math.floor(seedValue)))));
      }

      const response = await fetch(
        `https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}?output_format=${context.config.audioOutputFormat}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
          },
          body: formData,
          signal: abortSignal,
        },
      );

      if (!response.ok) {
        throw await createHttpStatusError(response, 'ElevenLabs voice changer failed');
      }

      return {
        ...await materializeAcceptedElevenLabsExecutionAudio(
          response,
          context.config.audioOutputFormat,
          buildAudioUsage('elevenlabs', modelId, {
            confidence: 'unknown',
            notes: ['ElevenLabs voice changer pricing is not currently mapped in the app.'],
          }),
          abortSignal,
        ),
        resultType: 'audio',
        statusMessage: `Changed voice with ${modelId}`,
      };
    }
    case 'huggingface': {
      if (audioMode !== 'speech') {
        throw new NonRetryableError('Hugging Face audio nodes currently support text-to-speech only.');
      }

      onStatus?.('Generating audio with Hugging Face…');
      const { HfInference } = await loadProviderModule(
        () => import('@huggingface/inference'),
        'Hugging Face audio',
      );
      const apiKey = requireApiKey(settings.apiKeys.huggingface, 'Hugging Face');
      const client = new HfInference(apiKey);
      const blob = await client.textToSpeech({
        model: modelId,
        inputs: prompt,
      }, { signal: abortSignal });

      return {
        result: await toResultUrl(blob),
        resultType: 'audio',
        statusMessage: `Generated with ${modelId}`,
      };
    }
  }
}

async function materializeAcceptedElevenLabsTimestampedSpeech(
  response: Response,
  providerOutputFormat: string,
  prompt: string,
  usage: UsageTelemetry,
  signal?: AbortSignal,
): Promise<Pick<ExecutionResult, 'result' | 'blob' | 'mimeType' | 'extension' | 'outputMetadata' | 'usage'>> {
  try {
    const rawText = await readBoundedResponseText(
      response,
      ELEVENLABS_TTS_TIMING_MAX_RESPONSE_BYTES,
      'ElevenLabs TTS-with-timestamps response exceeds the 64 MB safety limit.',
      signal,
    );
    let payload: unknown;
    try {
      payload = JSON.parse(rawText);
    } catch {
      throw new NonRetryableError('ElevenLabs TTS-with-timestamps returned invalid JSON.');
    }

    const { audioBase64, timing } = normalizeElevenLabsTtsTimestampPayload(payload, prompt);
    const audioResponse = new Response(
      decodeElevenLabsTtsBase64Audio(audioBase64),
      { headers: { 'content-type': 'application/octet-stream' } },
    );
    const materialized = await materializeAcceptedElevenLabsExecutionAudio(
      audioResponse,
      providerOutputFormat,
      usage,
      signal,
    );
    return {
      ...materialized,
      outputMetadata: {
        ...(materialized.outputMetadata ?? {}),
        ttsTiming: timing,
      },
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw Object.assign(
        createAbortError(error instanceof Error ? error.message : undefined),
        { usage },
      );
    }
    throw Object.assign(
      new NonRetryableError(
        error instanceof Error
          ? error.message
          : 'ElevenLabs returned an invalid TTS-with-timestamps result.',
        { cause: error },
      ),
      { usage },
    );
  }
}

function normalizeElevenLabsTtsTimestampPayload(
  payload: unknown,
  prompt: string,
): { audioBase64: string; timing: AudioTtsTimingMetadata } {
  if (!isRecord(payload) || typeof payload.audio_base64 !== 'string' || !payload.audio_base64) {
    throw new NonRetryableError('ElevenLabs TTS-with-timestamps did not return audio_base64.');
  }

  const alignmentSource = isRecord(payload.alignment)
    ? 'alignment'
    : isRecord(payload.normalized_alignment) ? 'normalized_alignment' : undefined;
  if (!alignmentSource) {
    throw new NonRetryableError('ElevenLabs TTS-with-timestamps did not return alignment data.');
  }
  const alignment = payload[alignmentSource];
  if (!isRecord(alignment)
    || !Array.isArray(alignment.characters)
    || !Array.isArray(alignment.character_start_times_seconds)
    || !Array.isArray(alignment.character_end_times_seconds)) {
    throw new NonRetryableError('ElevenLabs TTS-with-timestamps returned malformed alignment arrays.');
  }

  const characters = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  if (characters.length === 0 || characters.length > ELEVENLABS_TTS_TIMING_MAX_CHARACTERS) {
    throw new NonRetryableError(
      `ElevenLabs TTS timing must contain between 1 and ${ELEVENLABS_TTS_TIMING_MAX_CHARACTERS.toLocaleString()} characters.`,
    );
  }
  if (starts.length !== characters.length || ends.length !== characters.length) {
    throw new NonRetryableError('ElevenLabs TTS character timing arrays must have equal lengths.');
  }

  let previousStartMs = -1;
  const normalizedCharacters: AudioTtsTimingMetadata['characters'] = [];
  for (let index = 0; index < characters.length; index += 1) {
    const text = characters[index];
    if (typeof text !== 'string' || !text) {
      throw new NonRetryableError(`ElevenLabs TTS alignment character ${index + 1} is invalid.`);
    }
    const startMs = normalizeElevenLabsTtsTime(starts[index], `character ${index + 1} start`);
    const endMs = normalizeElevenLabsTtsTime(ends[index], `character ${index + 1} end`);
    if (startMs < previousStartMs || endMs < startMs) {
      throw new NonRetryableError('ElevenLabs TTS character timings must be ordered and non-negative.');
    }
    if (endMs > ELEVENLABS_TTS_TIMING_MAX_DURATION_MS) {
      throw new NonRetryableError('ElevenLabs TTS-with-timestamps audio is limited to 10 minutes per run.');
    }
    previousStartMs = startMs;
    normalizedCharacters.push({ index, text, startMs, endMs });
  }

  const words: AudioTtsTimingMetadata['words'] = [];
  let wordStart: number | undefined;
  for (let index = 0; index <= normalizedCharacters.length; index += 1) {
    const character = normalizedCharacters[index];
    const isWordCharacter = character !== undefined && !/^\s+$/u.test(character.text);
    if (isWordCharacter && wordStart === undefined) wordStart = index;
    if (isWordCharacter || wordStart === undefined) continue;

    const first = normalizedCharacters[wordStart];
    const last = normalizedCharacters[index - 1];
    if (!first || !last) {
      throw new NonRetryableError('ElevenLabs TTS word timing could not be derived from its character timing.');
    }
    words.push({
      index: words.length,
      text: normalizedCharacters.slice(wordStart, index).map((entry) => entry.text).join(''),
      startCharacterIndex: wordStart,
      endCharacterIndex: index,
      startMs: first.startMs,
      endMs: last.endMs,
    });
    if (words.length > ELEVENLABS_TTS_TIMING_MAX_WORDS) {
      throw new NonRetryableError(
        `ElevenLabs TTS timing exceeds ${ELEVENLABS_TTS_TIMING_MAX_WORDS.toLocaleString()} derived words.`,
      );
    }
    wordStart = undefined;
  }

  const text = normalizedCharacters.map((character) => character.text).join('');
  return {
    audioBase64: payload.audio_base64,
    timing: {
      version: 1,
      provider: 'elevenlabs',
      alignmentSource,
      text,
      textMatchesPrompt: text === prompt,
      durationMs: normalizedCharacters.at(-1)?.endMs ?? 0,
      characters: normalizedCharacters,
      words,
    },
  };
}

function normalizeElevenLabsTtsTime(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new NonRetryableError(`ElevenLabs TTS ${label} is invalid.`);
  }
  return Math.round(value * 1_000 * 1_000) / 1_000;
}

function decodeElevenLabsTtsBase64Audio(value: string): Blob {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new NonRetryableError('ElevenLabs TTS-with-timestamps returned invalid audio_base64.');
  }
  try {
    return inlineDataToBlob(value, 'application/octet-stream');
  } catch (error) {
    throw new NonRetryableError('ElevenLabs TTS-with-timestamps returned invalid audio_base64.', { cause: error });
  }
}

async function materializeAcceptedElevenLabsExecutionAudio(
  response: Response,
  providerOutputFormat: string,
  usage: UsageTelemetry,
  signal?: AbortSignal,
): Promise<Pick<ExecutionResult, 'result' | 'blob' | 'mimeType' | 'extension' | 'outputMetadata' | 'usage'>> {
  try {
    const audio = await materializeElevenLabsAudioResult(response, providerOutputFormat, signal);
    throwIfAborted(signal);
    return {
      result: await toResultUrl(audio.blob),
      blob: audio.blob,
      mimeType: audio.mimeType,
      extension: audio.extension,
      outputMetadata: audio.outputMetadata,
      usage,
    };
  } catch (error) {
    // A successful provider response is the irreversible billing boundary. Everything after it
    // is local materialization: repeating the outer operation would submit and charge again.
    // Carry the accepted attempt's usage on both failures and cancellation so Flow can ledger the
    // financial fact exactly once without publishing a stale or incomplete result.
    if (isAbortError(error)) {
      throw Object.assign(
        createAbortError(error instanceof Error ? error.message : undefined),
        { usage },
      );
    }
    throw Object.assign(
      new NonRetryableError(
        error instanceof Error
          ? error.message
          : 'ElevenLabs returned audio, but the accepted response could not be materialized.',
        { cause: error },
      ),
      { usage },
    );
  }
}

async function executeCompositionNode(
  _node: AppNode,
  context: ExecutionContext,
  settings: RuntimeSettingsSnapshot,
  onStatus?: (statusMessage: string) => void,
): Promise<ExecutionResult> {
  if (context.videoRuntimeError) {
    throw new Error(`Video Runtime IR refused this monitor/export plan: ${context.videoRuntimeError}`);
  }
  const visualSequenceClips = context.visualSequenceClips ?? [];
  const stageObjects = context.stageObjects ?? [];

  if (visualSequenceClips.length > 0 || stageObjects.length > 0) {
    onStatus?.('Rendering editor sequence locally…');
    const exportPreset = getVideoExportPresetOption(context.exportPresetId);
    const captionEmbeddingResolution = context.captionEmbedding;
    if (captionEmbeddingResolution && !captionEmbeddingResolution.ok) {
      throw new Error(captionEmbeddingResolution.reason);
    }
    const captionEmbedding = captionEmbeddingResolution?.ok
      ? captionEmbeddingResolution.value
      : undefined;
    const sequenceMediaOptions = {
      visualClips: visualSequenceClips,
      audioTracks: context.sequenceAudioInputs ?? [],
      stageObjects,
      aspectRatio: context.config.aspectRatio,
      videoResolution: context.config.videoResolution,
      frameRate: context.config.videoFrameRate,
      exportPresetId: context.exportPresetId,
      providerSettings: settings.providerSettings,
      audioMixerBuses: context.sequenceAudioMixerBuses,
      nativeAssemblyManifest: context.nativeAssemblyManifest,
      nativeOutputDirectoryPath: context.nativeOutputDirectoryPath,
      captionEmbedding,
      loudnessNormalization: context.sequenceLoudnessNormalization?.enabled
        ? context.sequenceLoudnessNormalization
        : undefined,
    };
    // Frame-server export (docs/gpu-frame-server-export-brief.md) is the DEFAULT compositor: it
    // steps the same layout/effect math the Edit Stage preview uses, so the render matches what was
    // approved on the stage. It returns `null` (never throws for this) when there's no reachable
    // native render service or the preset is an image sequence — in both cases we fall back to the
    // legacy ffmpeg-graph path below, which still has the browser ffmpeg.wasm fallback. A REAL error
    // from the new engine (a thrown exception, as opposed to `null`) is a genuine failure and is
    // allowed to propagate rather than being silently swallowed into a legacy re-render.
    const exportCompositorPreference = settings.providerSettings.exportCompositorPreference;
    const sequenceOutput = exportCompositorPreference === 'legacy'
      ? await composeSequenceMedia(sequenceMediaOptions)
      : (await renderStageFrameSequence(sequenceMediaOptions)) ?? (await composeSequenceMedia(sequenceMediaOptions));
    const isImageSequence = Boolean(sequenceOutput.imageSequence);
    const segmentArtifacts = sequenceOutput.segmentArtifacts?.length
      ? sequenceOutput.segmentArtifacts
      : undefined;
    const assemblyResult = sequenceOutput.assemblyResult;
    const outputMetadata = sequenceOutput.manifest || segmentArtifacts || assemblyResult
      ? {
        ...(sequenceOutput.manifest
          ? {
            imageSequence: true,
            frameCount: sequenceOutput.frameCount ?? sequenceOutput.manifest.frameCount,
            manifest: sequenceOutput.manifest,
          }
          : {}),
        ...(segmentArtifacts ? { segmentArtifacts } : {}),
        ...(assemblyResult ? { assemblyResult } : {}),
      }
      : undefined;

    if (!sequenceOutput.blob && !sequenceOutput.nativeFilePath) {
      throw new Error('The sequence renderer returned neither an in-memory output nor a native output file.');
    }

    return {
      result: sequenceOutput.nativeFilePath ?? await toResultUrl(sequenceOutput.blob as Blob),
      resultType: isImageSequence ? 'package' : 'video',
      blob: sequenceOutput.blob,
      nativeFilePath: sequenceOutput.nativeFilePath,
      statusMessage: isImageSequence
        ? `Rendered ${sequenceOutput.frameCount ?? 0} ${exportPreset.extension.toUpperCase()} sequence frame${sequenceOutput.frameCount === 1 ? '' : 's'} at ${context.config.videoFrameRate} fps using ${exportPreset.label} with ${describeSequenceRenderBackend(sequenceOutput.renderBackend)}. Output is a ZIP archive with manifest.json; audio tracks are ignored for image sequence exports. ${describeSequenceRenderBackendCaveat(sequenceOutput.renderBackend)}`
        : `Rendered editor sequence with ${visualSequenceClips.length} visual clip${visualSequenceClips.length === 1 ? '' : 's'} and ${stageObjects.length} stage object${stageObjects.length === 1 ? '' : 's'} at ${context.config.videoFrameRate} fps using ${exportPreset.label} with ${describeSequenceRenderBackend(sequenceOutput.renderBackend)}.${captionEmbedding ? ` Embedded ${captionEmbedding.cueCount} plain timed-text cue${captionEmbedding.cueCount === 1 ? '' : 's'} as one ${captionEmbedding.format} track; authoring position/font/color/background styling is not encoded.` : ''}${context.sequenceLoudnessNormalization?.enabled ? ` Final mix normalized by measured two-pass FFmpeg loudnorm to ${context.sequenceLoudnessNormalization.targetLufs} LUFS and ${context.sequenceLoudnessNormalization.truePeakCeilingDbtp} dBTP.` : ''} ${describeSequenceRenderBackendCaveat(sequenceOutput.renderBackend)}`,
      usage: createLocalCompositionUsage('actual'),
      mimeType: sequenceOutput.mimeType,
      extension: sequenceOutput.extension,
      fileName: sequenceOutput.fileName,
      outputMetadata,
    };
  }

  if (!context.videoInput) {
    throw new Error('Composition nodes need an upstream video connected to the Video track.');
  }

  onStatus?.('Mixing video and audio locally…');
  const audioInputs = context.audioInputs ?? [];
  const enabledAudioInputs = audioInputs.filter((track) => track.enabled);

  if (enabledAudioInputs.length === 0 && !context.useVideoAudio) {
    return {
      result: context.videoInput,
      resultType: 'video',
      statusMessage: 'Composition is previewing the connected video only.',
      usage: createLocalCompositionUsage('actual'),
    };
  }

  const blob = await composeMedia({
    videoUrl: context.videoInput,
    audioTracks: audioInputs,
    useVideoAudio: context.useVideoAudio,
    videoAudioVolumePercent: context.videoAudioVolumePercent,
    providerSettings: settings.providerSettings,
  });

  return {
    result: await toResultUrl(blob),
    resultType: 'video',
    blob,
    statusMessage:
      enabledAudioInputs.length > 0
        ? `Mixed ${enabledAudioInputs.length} audio track${enabledAudioInputs.length === 1 ? '' : 's'} into the composition.`
        : 'Composition preserved the source video audio.',
    usage: createLocalCompositionUsage('actual'),
  };
}

function composePrompt(upstreamPrompt: string, nodePrompt: string): string {
  const contextPrompt = upstreamPrompt.trim();
  const instructionPrompt = nodePrompt.trim();

  if (contextPrompt && instructionPrompt) {
    return `Context:\n${contextPrompt}\n\nInstruction:\n${instructionPrompt}`;
  }

  return instructionPrompt || contextPrompt;
}

function normalizeTextMediaInputs(context: ExecutionContext): GeminiTextMediaInput[] {
  if (context.textMediaInputs) {
    return context.textMediaInputs;
  }

  return (context.textImageInputs ?? []).map((url) => ({
    url,
    mimeType: 'image/png',
    kind: 'image',
  }));
}

function isImageMediaInput(input: GeminiTextMediaInput): boolean {
  return input.kind === 'image' || input.mimeType?.toLowerCase().startsWith('image/') === true;
}

function textMediaInputModality(
  input: GeminiTextMediaInput,
): 'image' | 'video' | 'audio' | 'pdf' | undefined {
  const mimeType = input.mimeType?.toLowerCase() ?? '';
  if (input.kind === 'image' || mimeType.startsWith('image/')) return 'image';
  if (input.kind === 'video' || input.kind === 'composition' || mimeType.startsWith('video/')) return 'video';
  if (input.kind === 'audio' || mimeType.startsWith('audio/')) return 'audio';
  if (
    input.kind === 'document'
    || input.kind === 'subtitle'
    || input.kind === 'text'
    || mimeType === 'application/pdf'
    || mimeType.startsWith('text/')
  ) {
    return 'pdf';
  }
  return undefined;
}

function buildChatMessages(systemPrompt: string, userPrompt: string) {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

  if (systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }

  messages.push({ role: 'user', content: userPrompt });
  return messages;
}

async function buildOpenAITextMessages(
  systemPrompt: string,
  userPrompt: string,
  imageInputs: string[],
): Promise<ChatCompletionMessageParam[]> {
  if (imageInputs.length === 0) {
    return buildChatMessages(systemPrompt, userPrompt);
  }

  const messages: ChatCompletionMessageParam[] = [];

  if (systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }

  messages.push({
    role: 'user',
    content: [
      { type: 'text', text: userPrompt },
      ...imageInputs.map((url) => ({
        type: 'image_url' as const,
        image_url: { url },
      })),
    ],
  });

  return messages;
}

function getModelId<TCapability extends keyof RuntimeSettingsSnapshot['defaultModels']>(
  settings: RuntimeSettingsSnapshot,
  capability: TCapability,
  provider: keyof RuntimeSettingsSnapshot['defaultModels'][TCapability],
  override?: string,
): string {
  const defaults = settings.defaultModels[capability] as Record<string, string>;
  return normalizeOptionalString(override) ?? defaults[String(provider)] ?? '';
}

function requireApiKey(value: string, label: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new NonRetryableError(`${label} API key is missing. Add it in Settings.`);
  }

  return trimmed;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function extractTextContent(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (isRecord(part) && typeof part.text === 'string') {
          return part.text;
        }

        return '';
      })
      .join('')
      .trim();
  }

  return '';
}

function extractGeminiInlineData(
  response: {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: {
            mimeType?: string;
            data?: string;
          };
        }>;
      };
    }>;
  },
): { mimeType: string; data: string } | null {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part): part is { inlineData: { mimeType?: string; data?: string } } =>
    Boolean(part.inlineData?.data),
  );

  if (!imagePart?.inlineData?.data) {
    return null;
  }

  return {
    mimeType: imagePart.inlineData.mimeType ?? 'image/png',
    data: imagePart.inlineData.data,
  };
}

function extractGeminiTextResponse(
  response: {
    text?: string;
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
          thought?: boolean;
          executableCode?: {
            code?: string;
            language?: string;
          };
          codeExecutionResult?: {
            output?: string;
          };
        }>;
      };
    }>;
  },
): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const renderedParts = parts.flatMap((part) => {
    if (part.text && !part.thought) {
      return [part.text.trim()];
    }

    if (part.executableCode?.code) {
      const language = part.executableCode.language?.toLowerCase() ?? 'python';
      return [`\`\`\`${language}\n${part.executableCode.code.trim()}\n\`\`\``];
    }

    if (part.codeExecutionResult?.output) {
      return [`Code execution result:\n${part.codeExecutionResult.output.trim()}`];
    }

    return [];
  });

  return (renderedParts.length > 0 ? renderedParts.join('\n\n') : response.text ?? '').trim();
}

async function startGeminiVideoGeneration(
  apiKey: string,
  modelId: string,
  prompt: string,
  context: ExecutionContext,
  seed?: number,
  negativePrompt?: string,
  sampleCount?: number,
  signal?: AbortSignal,
): Promise<GeminiVideoOperation> {
  const normalizedModelId = normalizeGeminiVideoModelId(modelId);

  validateGeminiVideoRequest({
    aspectRatio: context.config.aspectRatio,
    durationSeconds: context.config.durationSeconds,
    videoResolution: context.config.videoResolution,
    modelId: normalizedModelId,
    promptProvided: Boolean(prompt.trim()),
    hasStartImage: Boolean(context.startImageInput),
    hasEndImage: Boolean(context.endImageInput),
    referenceImageCount: context.referenceImageInputs?.length ?? 0,
    hasExtensionVideo: Boolean(context.extensionVideoInput),
  });

  const videoInputs = await buildGeminiVideoRequestInputs(context, signal);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${normalizedModelId}:predictLongRunning`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(
          buildGeminiVideoRequest(
            {
              prompt,
              ...videoInputs,
            },
            {
              aspectRatio: context.config.aspectRatio,
              durationSeconds: context.config.durationSeconds,
              videoResolution: context.config.videoResolution,
              seed,
              negativePrompt,
              sampleCount,
            },
          ),
        ),
        signal,
      },
    );

    if (!response.ok) {
      throw await createHttpStatusError(response, 'Gemini video generation failed');
    }

    return (await response.json()) as GeminiVideoOperation;
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw isAbortError(error) ? error : createAbortError();
    }
    if (error instanceof HttpStatusError || error instanceof NonRetryableError) {
      throw error;
    }
    throw new Error(extractSdkErrorMessage(error, 'Gemini video generation failed'));
  }
}

async function pollGeminiVideoResult(
  apiKey: string,
  operation: GeminiVideoOperation,
  onStatus?: (statusMessage: string) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  let currentOperation = operation;

  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (currentOperation.error) {
      throw new NonRetryableError(extractSdkOperationError(currentOperation.error));
    }

    if (currentOperation.done) {
      const video = currentOperation.response?.generateVideoResponse?.generatedSamples?.[0]?.video;

      if (!video) {
        throw new NonRetryableError('Gemini finished the job but did not provide a generated video.');
      }

      if (!video.uri) {
        throw new NonRetryableError('Gemini finished the job but did not provide a downloadable video URI.');
      }

      onStatus?.('Downloading completed video…');
      const videoResponse = await fetch(video.uri, {
        headers: {
          'x-goog-api-key': apiKey,
        },
        signal,
      });

      if (!videoResponse.ok) {
        throw await createHttpStatusError(videoResponse, 'Failed to download Gemini video');
      }

      return videoResponse.blob();
    }

    onStatus?.(`Video render is still in progress… ${attempt + 1} check${attempt === 0 ? '' : 's'} so far`);
    await abortableSleep(10_000, signal);

    if (!currentOperation.name) {
      throw new NonRetryableError('Gemini video generation started without an operation name.');
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${currentOperation.name}`, {
      headers: {
        'x-goog-api-key': apiKey,
      },
      signal,
    });

    if (!response.ok) {
      throw await createHttpStatusError(response, 'Gemini video status polling failed');
    }

    currentOperation = (await response.json()) as GeminiVideoOperation;
  }

  throw new NonRetryableError('Gemini video generation timed out after waiting 7.5 minutes.');
}

function extractOpenAIImageUsage(
  response: unknown,
  modelId: string,
  provider: 'openai' | 'atlas',
): UsageTelemetry | undefined {
  const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage;

  if (!usage) {
    return undefined;
  }

  return {
    source: 'actual',
    confidence: 'measured',
    provider,
    modelId,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
    notes: ['Pricing for this OpenAI image model is not currently mapped in the app.'],
  };
}

async function executeOpenAiCompatibleImageNode(input: {
  provider: 'openai' | 'atlas';
  modelId: string;
  prompt: string;
  sourceImageInput?: string;
  maskImageInput?: string;
  referenceImageInputs?: string[];
  referenceGroups?: FlowReferenceGroup[];
  context: ExecutionContext;
  node: AppNode;
  settings: RuntimeSettingsSnapshot;
  onStatus?: (statusMessage: string) => void;
  abortSignal?: AbortSignal;
}): Promise<ExecutionResult> {
  // GPT image models accept up to 16 images on /images/edit (source + references). Only the
  // first-party OpenAI endpoint is known to take the array shape, so Atlas's OpenAI-compatible
  // route keeps the single-image contract it was verified against — and rejects reference work
  // non-retryably, because no amount of retrying makes the route able to express it.
  const referenceImageInputs = input.provider === 'openai' ? (input.referenceImageInputs ?? []) : [];
  if (input.provider === 'atlas' && (input.referenceImageInputs?.length || input.referenceGroups?.some(referenceGroupHasGuidance))) {
    throw new NonRetryableError('This Atlas GPT-image route supports source image and mask edits, but not separate reference-image guidance.');
  }

  const providerLabel = input.provider === 'atlas' ? 'Atlas' : 'OpenAI';
  const apiKey = requireApiKey(
    input.provider === 'atlas' ? (input.settings.apiKeys.atlas ?? '') : input.settings.apiKeys.openai,
    providerLabel,
  );
  // The provider — NOT the model slug — decides the endpoint. Atlas-hosted OpenAI-compatible models
  // (e.g. `openai/gpt-image-1/edit`) must hit Atlas's base URL with the Atlas key; resolve through
  // normalizeAtlasBaseUrl so an empty `atlasBaseUrl` setting can never fall back to api.openai.com
  // (which would send the Atlas key to OpenAI and get rejected).
  const baseUrl = input.provider === 'atlas'
    ? normalizeAtlasBaseUrl(input.settings.providerSettings.atlasBaseUrl)
    : normalizeOptionalString(input.settings.providerSettings.openaiBaseUrl);
  const aspectRatio = getSupportedImageAspectRatio('openai', input.modelId, input.context.config.aspectRatio);
  const { default: OpenAI } = await loadProviderModule(
    () => import('openai'),
    `${providerLabel} image`,
  );

  input.onStatus?.(input.sourceImageInput ? `Editing image with ${providerLabel}…` : `Generating image with ${providerLabel}…`);
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    dangerouslyAllowBrowser: true,
  });
  // GPT-image-only params, first-party OpenAI only: honor the node's output-format select (it was
  // silently ignored before — everything came back as the API default), pass the optional quality
  // pick, and keep moderation at its least-strict documented setting per the app-wide policy.
  const isGptImageModel = input.modelId.toLowerCase().includes('gpt-image');
  const outputFormat = input.context.config.imageOutputFormat;
  const qualityValue = typeof input.node.data.imageQuality === 'string' && input.node.data.imageQuality !== 'auto'
    ? input.node.data.imageQuality as 'low' | 'medium' | 'high'
    : undefined;
  const gptImageParams = input.provider === 'openai' && isGptImageModel
    ? {
        output_format: outputFormat,
        ...(qualityValue ? { quality: qualityValue } : {}),
      }
    : {};
  const useEditEndpoint = Boolean(input.sourceImageInput) || referenceImageInputs.length > 0;
  const editImages: File[] = [];

  if (useEditEndpoint) {
    if (input.sourceImageInput) {
      editImages.push(await dataUrlToFile(input.sourceImageInput, 'flow-image-edit.png', input.abortSignal));
    }
    for (const [index, referenceInput] of referenceImageInputs.entries()) {
      editImages.push(await dataUrlToFile(referenceInput, `flow-image-reference-${index + 1}.png`, input.abortSignal));
    }
  }

  // images.edit has one prompt string for the whole ordered image array, so numbered guidance is
  // serialized as an explicit block that names each Reference N's provable attachment position.
  const editPrompt = imageReferencePromptWithGuidance({
    prompt: input.prompt,
    referenceGroups: input.referenceGroups,
    imageOrdinalOffset: input.sourceImageInput ? 1 : 0,
    positionNoun: 'attached image',
    totalImages: editImages.length,
  });

  const response = useEditEndpoint
    ? await client.images.edit({
        model: input.modelId,
        image: editImages.length === 1 ? editImages[0] : editImages,
        ...(input.maskImageInput && input.sourceImageInput ? { mask: new File([await normalizeMaskBlob(input.maskImageInput, input.sourceImageInput, input.provider, input.modelId, input.abortSignal)], 'flow-image-mask.png', { type: 'image/png' }) } : {}),
        prompt: editPrompt,
        size: mapAspectRatioToImageSize(aspectRatio),
        ...gptImageParams,
      }, { signal: input.abortSignal })
    : await client.images.generate({
        model: input.modelId,
        prompt: input.prompt,
        size: mapAspectRatioToImageSize(aspectRatio),
        ...(input.provider === 'openai' && isGptImageModel ? { moderation: 'low' as const } : {}),
        ...gptImageParams,
      }, { signal: input.abortSignal });
  const image = response.data?.[0];
  const b64MimeType = input.provider === 'openai' && isGptImageModel ? `image/${outputFormat}` : 'image/png';

  if (image?.b64_json) {
    return applyConfiguredAutoUpscaleIfRequested({
      node: input.node,
      settings: input.settings,
      context: input.context,
      result: {
        result: `data:${b64MimeType};base64,${image.b64_json}`,
        resultType: 'image',
        mimeType: b64MimeType,
        statusMessage: `Generated with ${input.modelId}`,
        usage: extractOpenAIImageUsage(response, input.modelId, input.provider),
      },
      onStatus: input.onStatus,
      abortSignal: input.abortSignal,
    });
  }

  if (image?.url) {
    // Materialize the remote URL the same way every other provider result does: a raw provider CDN URL
    // (no CORS + Content-Disposition: attachment) refuses to render in an <img>, so download + inline it
    // (renderer fetch, else native net.fetch / CapacitorHttp) to a data: URL. Without this an OpenAI /
    // Atlas-OpenAI-compatible model that returns a `url` instead of `b64_json` shows a broken-image glyph.
    const materialized = await materializeRemoteMediaResult(image.url, `${providerLabel} result download failed`, undefined, input.abortSignal);
    return applyConfiguredAutoUpscaleIfRequested({
      node: input.node,
      settings: input.settings,
      context: input.context,
      result: {
        result: materialized.result,
        resultType: 'image',
        mimeType: materialized.mimeType,
        statusMessage: `Generated with ${input.modelId}`,
        usage: extractOpenAIImageUsage(response, input.modelId, input.provider),
      },
      onStatus: input.onStatus,
      abortSignal: input.abortSignal,
    });
  }

  throw new Error(`${providerLabel} did not return an image payload.`);
}

async function dataUrlToInlineImage(dataUrl: string, signal?: AbortSignal): Promise<{ mimeType: string; data: string }> {
  return dataUrlToInlineData(dataUrl, 'image/png', 'Unsupported image data URL format.', signal);
}

async function dataUrlToInlineData(
  dataUrl: string,
  fallbackMimeType: string,
  dataUrlError: string | undefined = 'Unsupported media data URL format.',
  signal?: AbortSignal,
): Promise<{ mimeType: string; data: string }> {
  throwIfAborted(signal);
  const expectedKind = downstreamMediaKindForMime(fallbackMimeType);
  const { blob, mimeType } = await fetchDownstreamMediaBlob(dataUrl, {
    kind: expectedKind,
    errorLabel: dataUrl.startsWith('data:') && dataUrlError
      ? dataUrlError.replace(/\.$/, '')
      : `Downstream ${expectedKind} reference could not be materialized`,
  }, signal);
  const base64 = await blobToBase64(blob, signal);

  return {
    mimeType,
    data: base64,
  };
}

function downstreamMediaKindForMime(mimeType: string): DownstreamMediaKind {
  const normalized = mimeType.split(';', 1)[0].trim().toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  return 'document';
}

async function dataUrlToGeminiImage(dataUrl: string, signal?: AbortSignal): Promise<{ imageBytes: string; mimeType: string }> {
  const inline = await dataUrlToInlineData(dataUrl, 'image/png', 'Unsupported image data URL format.', signal);
  return { mimeType: inline.mimeType, imageBytes: inline.data };
}

async function dataUrlToGeminiVideo(dataUrl: string, signal?: AbortSignal): Promise<{ videoBytes: string; mimeType: string }> {
  const inline = await dataUrlToInlineData(dataUrl, 'video/mp4', 'Unsupported video data URL format.', signal);
  return { mimeType: inline.mimeType, videoBytes: inline.data };
}

async function dataUrlToFile(dataUrl: string, filename: string, signal?: AbortSignal): Promise<File> {
  throwIfAborted(signal);
  const blob = (await fetchDownstreamMediaBlob(dataUrl, {
    kind: 'image',
    errorLabel: 'Downstream image reference could not be materialized',
  }, signal)).blob;
  throwIfAborted(signal);
  const mimeType = blob.type || 'image/png';

  return new File([blob], filename, { type: mimeType });
}

/** Normalize a canonical painted/connected mask to the encoding `provider`/`modelId` expects, sized to the source image. */
async function normalizeMaskBlob(
  maskDataUrl: string,
  sourceDataUrl: string,
  provider: string,
  modelId: string | undefined,
  signal?: AbortSignal,
): Promise<Blob> {
  throwIfAborted(signal);
  if (!canDecodeImages()) {
    // Skip Image/canvas dimension probing in headless envs; normalizeMaskForProvider passes through.
    return raceWithAbort(normalizeMaskForProvider(maskDataUrl, { provider, modelId, width: 0, height: 0 }), signal);
  }
  const { width, height } = await raceWithAbort(getDataUrlDimensions(sourceDataUrl), signal);
  return raceWithAbort(normalizeMaskForProvider(maskDataUrl, { provider, modelId, width, height }), signal);
}

async function toResultUrl(value: Blob | string): Promise<string> {
  return typeof value === 'string' ? value : URL.createObjectURL(value);
}

async function blobToBase64(blob: Blob, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  if (typeof FileReader === 'undefined') {
    const arrayBuffer = await raceWithAbort(blob.arrayBuffer(), signal);
    return Buffer.from(arrayBuffer).toString('base64');
  }
  const dataUrl = await raceWithAbort(new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read blob.'));
    reader.readAsDataURL(blob);
  }), signal);

  const [, base64 = ''] = dataUrl.split(',', 2);
  return base64;
}

function inlineDataToBlob(data: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

async function extractErrorBody(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();

  if (contentType.includes('application/json')) {
    try {
      const payload = JSON.parse(text) as { error?: { message?: string }; message?: string };
      return (payload.error?.message ?? payload.message ?? text) || fallback;
    } catch {
      return text || fallback;
    }
  }

  return text || fallback;
}

async function createHttpStatusError(response: Response, fallback: string): Promise<HttpStatusError> {
  return new HttpStatusError(response.status, await extractErrorBody(response, fallback));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function coerceOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

async function pcmBase64ToWavBlob(base64: string, sampleRate = 24_000): Promise<Blob> {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = sampleRate * 2;

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + bytes.length, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, bytes.length, true);

  return new Blob([header, bytes], { type: 'audio/wav' });
}

function extractGeminiInteractionAudio(interaction: unknown): string | undefined {
  if (!interaction || typeof interaction !== 'object') return undefined;
  const record = interaction as Record<string, unknown>;
  const output = (record.output_audio ?? record.outputAudio) as Record<string, unknown> | undefined;
  if (output && typeof output.data === 'string') return output.data;

  const outputs = Array.isArray(record.outputs) ? record.outputs : [];
  for (const candidate of outputs) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Record<string, unknown>;
    if (item.type === 'audio' && typeof item.data === 'string') return item.data;
  }
  return undefined;
}

function clampOptionalNumber(value: number | undefined, min: number, max: number): number | undefined {
  return value === undefined ? undefined : Math.min(max, Math.max(min, value));
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

/**
 * ElevenLabs voice_settings from the node's optional sliders. Returns undefined when the user set
 * nothing so the voice's saved defaults stay in charge; each field is clamped to its documented range
 * (stability/similarity/style 0–1, speed 0.7–1.2).
 */
function buildElevenLabsVoiceSettings(data: AppNode['data']): Record<string, number> | undefined {
  const clamp = (value: number | undefined, min: number, max: number): number | undefined =>
    value === undefined ? undefined : Math.min(max, Math.max(min, value));
  const entries: Array<[string, number | undefined]> = [
    ['stability', clamp(coerceOptionalNumber(data.audioStability), 0, 1)],
    ['similarity_boost', clamp(coerceOptionalNumber(data.audioSimilarityBoost), 0, 1)],
    ['style', clamp(coerceOptionalNumber(data.audioStyleExaggeration), 0, 1)],
    ['speed', clamp(coerceOptionalNumber(data.audioSpeed), 0.7, 1.2)],
  ];
  const set = entries.filter((entry): entry is [string, number] => entry[1] !== undefined);

  return set.length > 0 ? Object.fromEntries(set) : undefined;
}

function buildAudioUsage(
  provider: string,
  modelId: string,
  options: {
    characters?: number;
    confidence: UsageTelemetry['confidence'];
    notes?: string[];
  },
): UsageTelemetry {
  return {
    source: 'actual',
    confidence: options.confidence,
    provider,
    modelId,
    characters: options.characters,
    notes: options.notes,
  };
}

function extractSdkErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }

  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }

  return fallback;
}

function extractSdkOperationError(error: Record<string, unknown>): string {
  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return JSON.stringify(error);
}
