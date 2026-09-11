import { memo, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Position } from '@xyflow/react';
import { Download, Image as ImageIcon, Upload, Video } from 'lucide-react';
import { AttemptHistory } from './AttemptHistory';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { ExecutionTelemetryPanel } from './ExecutionTelemetryPanel';
import { ImagePreviewPane } from './ImagePreviewPane';
import { MediaLoadingOverlay } from './MediaLoadingOverlay';
import { MediaPreviewModal } from './MediaPreviewModal';
import { VideoDurationSlider } from './VideoDurationSlider';
import { useLiveNodeResultAssetUrl } from './useLiveNodeResultAssetUrl';
import { saveImportedAsset } from '../../lib/assetStore';
import { buildDownloadFilename, downloadAsset } from '../../lib/downloadAsset';
import { EXPORT_BASENAME } from '../../lib/brand';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import { assignVariableToResultAttempt } from '../../lib/flowVariables';
import { resultValueAsMediaUrl } from '../../lib/flowResultValues';
import {
  CAPABILITY_PROVIDERS,
  getConfiguredProviders,
  getModelOptions,
  getProviderLabel,
  getVideoResolutionOptions,
} from '../../lib/providerCatalog';
import { captureFrameFromVideoElement } from '../../lib/videoFrameExtraction';
import {
  isGeminiOmniModelId,
} from '../../lib/videoModelSupport';
import {
  getVideoModelContract,
  getVideoCredentialRouteWarning,
  getVideoModelSupport,
} from '../../lib/modelContracts/videoModelContracts';
import {
  findMiswiredVideoImageSources,
  hasConnectedVideoFrameSource,
  hasConnectedVideoSource,
  resolveConnectedVideoFrameAsset,
  resolveConnectedVideoSourceAsset,
} from '../../lib/videoFrameConnections';
import { useCatalogStore } from '../../store/catalogStore';
import { useFlowStore } from '../../store/flowStore';
import { useSettingsStore } from '../../store/settingsStore';
import type {
  AppNodeProps,
  AspectRatio,
  MediaNodeMode,
  VideoProvider,
  VideoReferenceType,
} from '../../types/flow';

const selectClassName = withFlowNodeInteractionClasses(
  'w-full bg-[#111217]/50 text-gray-200 border border-gray-700/60 rounded-lg p-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none shadow-inner',
);

const actionButtonClassName = withFlowNodeInteractionClasses(
  'inline-flex items-center gap-1 rounded-lg border border-gray-700/60 bg-[#111217]/40 px-2.5 py-1.5 text-[11px] font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white',
);

const VIDEO_ASPECT_RATIO_OPTIONS = [
  { value: '16:9', label: '16:9 Landscape' },
  { value: '9:16', label: '9:16 Portrait' },
] as const;

const VIDEO_REFERENCE_TYPE_OPTIONS: Array<{ value: VideoReferenceType; label: string }> = [
  { value: 'asset', label: 'Asset' },
  { value: 'style', label: 'Style' },
];

function VideoNodeComponent({ id, data }: AppNodeProps) {
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const providerSettings = useSettingsStore((state) => state.providerSettings);
  const defaultModels = useSettingsStore((state) => state.defaultModels.video);
  const modelCatalog = useCatalogStore((state) => state.modelCatalog);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const mediaMode = (data.mediaMode ?? 'generate') as MediaNodeMode;
  const isCollapsed = Boolean(data.collapsed);
  const availableProviders = getConfiguredProviders('video', apiKeys, providerSettings);
  const provider = ((data.provider as VideoProvider | undefined) ?? 'gemini') as VideoProvider;
  const providerConfigured = availableProviders.includes(provider);
  const selectedModelId = data.modelId ?? defaultModels[provider];
  const modelContract = getVideoModelContract(provider, selectedModelId);
  const modelSupport = getVideoModelSupport(provider, selectedModelId);
  const modelParameterIds = new Set(modelContract.parameters.map((parameter) => parameter.id));
  // The store-owned `blob:` URL cached in `data.result` is revoked on rehydration, leaving a dead
  // thumbnail/preview; resolve the source-bin item's live URL instead (see useLiveNodeResultAssetUrl).
  const selectedResultAttempt = Array.isArray(data.resultHistory)
    ? (data.resultHistory.find((attempt) => attempt.id === data.selectedResultId)
      ?? data.resultHistory[data.resultHistory.length - 1])
    : undefined;
  const resultSourceBinItemId = selectedResultAttempt?.sourceBinItemId
    ?? (typeof data.sourceBinItemId === 'string' ? data.sourceBinItemId : undefined);
  const liveResultAssetUrl = useLiveNodeResultAssetUrl({
    nodeId: id,
    enabled: mediaMode === 'generate',
    resultSourceBinItemId,
  });
  const assetUrl = mediaMode === 'import'
    ? resultValueAsMediaUrl(data.sourceAssetUrl)
    : (liveResultAssetUrl ?? resultValueAsMediaUrl(data.result));
  const assetMimeType = mediaMode === 'import' ? data.sourceAssetMimeType : 'video/mp4';

  const connections = useFlowStore(
    useShallow((state) => ({
      hasStartFrameConnection: hasConnectedVideoFrameSource(state.nodes, state.edges, id, ['video-start-frame']),
      hasEndFrameConnection: hasConnectedVideoFrameSource(state.nodes, state.edges, id, ['video-end-frame']),
      hasReference1Connection: hasConnectedVideoFrameSource(state.nodes, state.edges, id, ['video-reference-1']),
      hasReference2Connection: hasConnectedVideoFrameSource(state.nodes, state.edges, id, ['video-reference-2']),
      hasReference3Connection: hasConnectedVideoFrameSource(state.nodes, state.edges, id, ['video-reference-3']),
      hasExtensionConnection: hasConnectedVideoSource(state.nodes, state.edges, id, ['video-source-video']),
      startFrame: resolveConnectedVideoFrameAsset(state.nodes, state.edges, id, ['video-start-frame']),
      endFrame: resolveConnectedVideoFrameAsset(state.nodes, state.edges, id, ['video-end-frame']),
      reference1: resolveConnectedVideoFrameAsset(state.nodes, state.edges, id, ['video-reference-1']),
      reference2: resolveConnectedVideoFrameAsset(state.nodes, state.edges, id, ['video-reference-2']),
      reference3: resolveConnectedVideoFrameAsset(state.nodes, state.edges, id, ['video-reference-3']),
      extensionSource: resolveConnectedVideoSourceAsset(state.nodes, state.edges, id, ['video-source-video']),
    })),
  );
  const miswiredImageSources = useFlowStore(
    useShallow((state) => findMiswiredVideoImageSources(state.nodes, state.edges, id)),
  );
  const {
    hasStartFrameConnection,
    hasEndFrameConnection,
    hasReference1Connection,
    hasReference2Connection,
    hasReference3Connection,
    hasExtensionConnection,
    startFrame,
    endFrame,
    reference1,
    reference2,
    reference3,
    extensionSource,
  } = connections;
  const hasReferenceConnections = hasReference1Connection || hasReference2Connection || hasReference3Connection;
  const hasFrameInputs = hasStartFrameConnection || hasEndFrameConnection;
  const requiresEightSecondDuration = !isGeminiOmniModelId(selectedModelId) && (
    (hasEndFrameConnection && modelSupport.interpolation)
    || (hasReferenceConnections && modelSupport.referenceImages)
    || (hasExtensionConnection && modelSupport.videoExtension)
  );
  const durationValue = data.durationSeconds ?? 6;
  const durationSteps = isGeminiOmniModelId(selectedModelId)
    ? [3, 4, 5, 6, 7, 8, 9, 10]
    : [4, 6, 8];
  const configuredAspectRatio = (data.aspectRatio as AspectRatio | undefined) ?? '16:9';
  const baseResolutionOptions = getVideoResolutionOptions(durationValue, hasExtensionConnection && modelSupport.videoExtension);
  const resolutionOptions = modelSupport.fixedResolution
    ? baseResolutionOptions.filter((option) => option.value === modelSupport.fixedResolution)
    : modelSupport.maxResolution === '1080p'
      ? baseResolutionOptions.filter((option) => option.value !== '4k')
      : baseResolutionOptions;

  useEffect(() => {
    const selectedResolution = data.videoResolution ?? '720p';
    if (resolutionOptions.some((option) => option.value === selectedResolution)) {
      return;
    }

    data.onChange?.('videoResolution', resolutionOptions[0]?.value ?? '720p');
  }, [data, resolutionOptions]);

  useEffect(() => {
    if (!requiresEightSecondDuration || durationValue === 8) {
      return;
    }

    data.onChange?.('durationSeconds', 8);
  }, [data, durationValue, requiresEightSecondDuration]);

  const allModelOptions = getModelOptions(
    'video',
    provider,
    modelCatalog,
    selectedModelId,
  );
  const modelOptions = allModelOptions;

  useEffect(() => {
    if (provider === 'gemini' && typeof data.videoBatchCount === 'number' && data.videoBatchCount !== 1) {
      data.onChange?.('videoBatchCount', 1);
    }
  }, [data, provider]);

  const lifecycleWarning = modelContract.lifecycle === 'shutdown'
    ? `${modelContract.displayName} is shut down and retained only so saved flows remain understandable.${modelContract.migrationModelId ? ` Choose ${modelContract.migrationModelId} to run.` : ''}`
    : modelContract.lifecycle === 'deprecated'
      ? `${modelContract.displayName} is deprecated.${modelContract.migrationModelId ? ` Migrate to ${modelContract.migrationModelId}.` : ''}`
      : modelContract.lifecycle === 'preview'
        ? `${modelContract.displayName} is a preview model; availability and behavior can change.`
        : modelContract.lifecycle === 'unverified'
          ? 'This live model has no curated capability contract. Only safe text-to-video controls are enabled.'
          : undefined;
  const credentialRouteWarning = getVideoCredentialRouteWarning(
    modelContract,
    providerSettings.geminiCredentialMode,
  );
  const runDisabledReason = modelContract.availability === 'unavailable'
    ? lifecycleWarning
    : credentialRouteWarning
      ?? (!providerConfigured
        ? `Configure ${getProviderLabel(provider)} in Settings before running this node.`
        : undefined);
  const startFrameDisabledReason = modelSupport.imageToVideo ? undefined : `${modelContract.displayName} does not support image-to-video through this route.`;
  const endFrameDisabledReason = modelSupport.interpolation ? undefined : `${modelContract.displayName} does not support first/last-frame interpolation.`;
  const referenceDisabledReason = modelSupport.referenceImages ? undefined : `${modelContract.displayName} does not support reference-image guidance.`;
  const extensionDisabledReason = modelSupport.videoExtension || modelSupport.videoEdit
    ? undefined
    : `${modelContract.displayName} does not support video extension or video editing through this route.`;

  const handleProviderChange = (nextProvider: VideoProvider) => {
    data.onChange?.('provider', nextProvider);
    data.onChange?.('modelId', defaultModels[nextProvider]);
  };

  const handleModeChange = (nextMode: MediaNodeMode) => {
    data.onChange?.('mediaMode', nextMode);
    data.onChange?.('error', undefined);
    data.onChange?.('statusMessage', nextMode === 'import' ? 'Choose a video file from your device.' : undefined);

    if (nextMode === 'import') {
      data.onChange?.('result', undefined);
      return;
    }

    data.onChange?.('provider', provider);
    data.onChange?.('modelId', data.modelId ?? defaultModels[provider]);
  };

  const handleImport = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const storedAsset = await saveImportedAsset(file);
      data.onChange?.('sourceAssetId', storedAsset.id);
      data.onChange?.('sourceAssetUrl', storedAsset.dataUrl);
      data.onChange?.('sourceAssetName', storedAsset.name);
      data.onChange?.('sourceAssetMimeType', storedAsset.mimeType);
      data.onChange?.('result', undefined);
      data.onChange?.('error', undefined);
      data.onChange?.('statusMessage', `Imported ${storedAsset.name}`);
    } catch (error) {
      data.onChange?.('error', error instanceof Error ? error.message : 'Video import failed.');
    }
  };

  const handleDownload = async () => {
    if (!assetUrl) {
      return;
    }

    await downloadAsset(
      assetUrl,
      buildDownloadFilename(data.sourceAssetName ?? `${EXPORT_BASENAME}-video`, assetMimeType, 'mp4'),
    );
  };

  const handleCaptureFrame = async () => {
    const video = videoElementRef.current;

    if (!video) {
      return;
    }

    const frameBlob = await captureFrameFromVideoElement(video);
    const frameUrl = URL.createObjectURL(frameBlob);

    try {
      await downloadAsset(
        frameUrl,
        buildDownloadFilename(`${data.sourceAssetName ?? `${EXPORT_BASENAME}-video`}-frame`, 'image/png', 'png'),
      );
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(frameUrl), 1_000);
    }
  };

  const previewPanel = (
    <div className="relative group mt-1">
      {assetUrl ? (
        <div className="flex min-h-[9rem] items-center justify-center rounded-lg border border-gray-700/60 bg-black p-2 shadow-inner">
          <video
            ref={videoElementRef}
            src={assetUrl}
            controls={!data.isRunning}
            className={withFlowNodeInteractionClasses(`block max-h-[18rem] h-auto w-auto max-w-full object-contain transition-all ${data.isRunning ? 'pointer-events-none blur-[2px] opacity-50' : ''}`)}
            onClick={() => {
              if (!data.isRunning) {
                setPreviewOpen(true);
              }
            }}
            title="Open video preview"
          />
        </div>
      ) : (
        <div
          className="flex min-h-[9rem] w-full flex-col items-center justify-center rounded-lg border border-dashed border-gray-700/60 bg-[#111217]/30 p-4 text-gray-500 shadow-inner"
          style={{ aspectRatio: String(configuredAspectRatio === '9:16' ? 9 / 16 : 16 / 9) }}
        >
          <Video size={24} className="mb-2 opacity-50" />
          <span className="text-center text-[11px] font-medium tracking-wide">
            {mediaMode === 'import' ? 'Import a local video' : 'Run with a prompt, image, or video source'}
          </span>
        </div>
      )}

      {data.isRunning ? (
        <MediaLoadingOverlay
          detail="Video playback stays disabled while the provider is still rendering the final clip."
          title="Generating video"
        />
      ) : null}
    </div>
  );

  const importedAssetNamePanel =
    mediaMode === 'import' && data.sourceAssetName ? (
      <div className="rounded-lg border border-gray-700/60 bg-[#111217]/30 px-2.5 py-2 text-[11px] text-gray-300">
        {data.sourceAssetName}
      </div>
    ) : null;

  return (
    <BaseNode
      collapsedContent={
        <div className="space-y-2">
          {previewPanel}
          {importedAssetNamePanel}
        </div>
      }
      nodeId={id}
      icon={Video}
      nodeType="videoGen"
      isCollapsed={isCollapsed}
      title={mediaMode === 'import' ? 'Video Asset' : 'Video Generation'}
      hasInput={false}
      outputActions={getCompatibleNodeActions('videoGen')}
      customHandles={
        mediaMode === 'generate' ? (
          <>
            <LabeledTargetHandle id="video-prompt" label="Prompt / Config" topClassName="top-[18%]" />
          </>
        ) : undefined
      }
      onRun={mediaMode === 'generate' ? data.onRun : undefined}
      runDisabledReason={mediaMode === 'generate' ? runDisabledReason : undefined}
      isRunning={data.isRunning}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
      onToggleCollapsed={() => data.onChange?.('collapsed', !isCollapsed)}
      footerActions={
        assetUrl ? (
          <>
            <button className={actionButtonClassName} onClick={() => void handleDownload()} type="button">
              <Download size={12} />
              Save
            </button>
            <button className={actionButtonClassName} onClick={() => void handleCaptureFrame()} type="button">
              <ImageIcon size={12} />
              Capture Frame
            </button>
          </>
        ) : null
      }
    >
      {mediaMode === 'generate' ? (
        <AttemptHistory
          attempts={data.resultHistory}
          onAssignVariable={(attemptId, variableName) => data.onChange?.('resultHistory', assignVariableToResultAttempt(data.resultHistory, attemptId, variableName))}
          onSelectAttempt={data.onSelectAttempt}
          selectedAttemptId={data.selectedResultId}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <ModeButton active={mediaMode === 'generate'} label="Generate" onClick={() => handleModeChange('generate')} />
        <ModeButton active={mediaMode === 'import'} label="Import" onClick={() => handleModeChange('import')} />
      </div>

      {mediaMode === 'generate' ? (
        <>
          <>
              <select
                className={selectClassName}
                onChange={(event) => handleProviderChange(event.target.value as VideoProvider)}
                value={provider}
              >
                {CAPABILITY_PROVIDERS.video.map((option) => (
                  <option key={option} value={option}>
                    {getProviderLabel(option)}
                  </option>
                ))}
              </select>

              {!providerConfigured ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-100">
                  Configure {getProviderLabel(provider)} in Settings to run this model. The provider and model remain selectable so you can design the flow first.
                </div>
              ) : null}

              <select
                className={selectClassName}
                onChange={(event) => data.onChange?.('modelId', event.target.value)}
                value={selectedModelId}
              >
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              {lifecycleWarning || credentialRouteWarning ? (
                <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
                  {lifecycleWarning ? <div>{lifecycleWarning}</div> : null}
                  {credentialRouteWarning ? <div>{credentialRouteWarning}</div> : null}
                </div>
              ) : null}
          </>

          <div className="grid grid-cols-3 gap-2">
            <select
              className={selectClassName}
              onChange={(event) => data.onChange?.('aspectRatio', event.target.value)}
              value={data.aspectRatio ?? '16:9'}
            >
              {VIDEO_ASPECT_RATIO_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <div className="rounded-lg border border-gray-700/60 bg-[#111217]/50 px-2 py-2 shadow-inner">
              <VideoDurationSlider
                disabled={requiresEightSecondDuration}
                onChange={(value) => data.onChange?.('durationSeconds', value)}
                steps={durationSteps}
                value={durationValue}
              />
            </div>

            <select
              className={selectClassName}
              disabled={Boolean(modelSupport.fixedResolution)}
              onChange={(event) => data.onChange?.('videoResolution', event.target.value)}
              title={modelSupport.fixedResolution ? `${modelContract.displayName} outputs ${modelSupport.fixedResolution}.` : undefined}
              value={data.videoResolution ?? '720p'}
            >
              {resolutionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
                ))}
              </select>
          </div>

          <input
            className={selectClassName}
            disabled={!modelParameterIds.has('seed')}
            inputMode="numeric"
            onChange={(event) =>
              data.onChange?.(
                'videoSeed',
                event.target.value.trim() ? Number(event.target.value) : undefined,
              )
            }
            placeholder="Seed (optional, improves repeatability slightly)"
            title={modelParameterIds.has('seed') ? undefined : `${modelContract.displayName} does not expose a seed control.`}
            type="number"
            value={data.videoSeed ?? ''}
          />

          <input
            className={selectClassName}
            disabled={!modelSupport.negativePrompt}
            onChange={(event) => data.onChange?.('videoNegativePrompt', event.target.value)}
            placeholder={modelSupport.negativePrompt
              ? 'Negative prompt (optional: blur, artifacts, low detail)'
              : 'Negative prompt unsupported — put exclusions in the main prompt'}
            title={modelSupport.negativePrompt ? undefined : `${modelContract.displayName} does not expose a negative-prompt API field.`}
            type="text"
            value={typeof data.videoNegativePrompt === 'string' ? data.videoNegativePrompt : ''}
          />

          {provider === 'atlas' ? (
            <label className={withFlowNodeInteractionClasses('flex items-center gap-2 rounded-lg border border-gray-700/60 bg-[#111217]/50 px-2.5 py-2 text-[11px] text-gray-300')}>
              <input
                checked={data.videoGenerateAudio !== false}
                className="accent-blue-500"
                onChange={(event) => data.onChange?.('videoGenerateAudio', event.target.checked)}
                type="checkbox"
              />
              Generate audio when this Atlas model supports it
            </label>
          ) : null}

          {provider === 'gemini' ? (
            <>
              <label className={withFlowNodeInteractionClasses('grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-gray-700/60 bg-[#111217]/50 px-2.5 py-2 text-[11px] text-gray-300 shadow-inner')}>
                <span>Videos per request</span>
                <input
                  className={withFlowNodeInteractionClasses('w-16 rounded-md border border-gray-700/60 bg-[#0d0f15] px-2 py-1 text-right text-xs text-gray-500 outline-none')}
                  disabled
                  max={1}
                  min={1}
                  onChange={() => data.onChange?.('videoBatchCount', 1)}
                  type="number"
                  value={1}
                />
              </label>
            </>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <FrameSlot
              disabledReason={startFrameDisabledReason}
              fallbackAspectRatio={configuredAspectRatio}
              handleId="video-start-frame"
              imageUrl={startFrame}
              isConnected={hasStartFrameConnection}
              label="Start Frame"
            />
            <FrameSlot
              disabledReason={endFrameDisabledReason}
              fallbackAspectRatio={configuredAspectRatio}
              handleId="video-end-frame"
              imageUrl={endFrame}
              isConnected={hasEndFrameConnection}
              label="End Frame"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <ReferenceImageSlot
              disabledReason={referenceDisabledReason}
              fallbackAspectRatio={configuredAspectRatio}
              handleId="video-reference-1"
              imageUrl={reference1}
              isConnected={hasReference1Connection}
              label="Reference 1"
              referenceType={(data.videoReference1Type as VideoReferenceType | undefined) ?? 'asset'}
              onReferenceTypeChange={(value) => data.onChange?.('videoReference1Type', value)}
            />
            <ReferenceImageSlot
              disabledReason={referenceDisabledReason}
              fallbackAspectRatio={configuredAspectRatio}
              handleId="video-reference-2"
              imageUrl={reference2}
              isConnected={hasReference2Connection}
              label="Reference 2"
              referenceType={(data.videoReference2Type as VideoReferenceType | undefined) ?? 'asset'}
              onReferenceTypeChange={(value) => data.onChange?.('videoReference2Type', value)}
            />
            <ReferenceImageSlot
              disabledReason={referenceDisabledReason}
              fallbackAspectRatio={configuredAspectRatio}
              handleId="video-reference-3"
              imageUrl={reference3}
              isConnected={hasReference3Connection}
              label="Reference 3"
              referenceType={(data.videoReference3Type as VideoReferenceType | undefined) ?? 'asset'}
              onReferenceTypeChange={(value) => data.onChange?.('videoReference3Type', value)}
            />
          </div>

          <VideoExtensionSlot
            disabledReason={extensionDisabledReason}
            handleId="video-source-video"
            isConnected={hasExtensionConnection}
            sourceUrl={extensionSource}
          />

          <div className="rounded-lg border border-gray-700/60 bg-[#111217]/30 px-2.5 py-2 text-[11px] text-gray-400">
            Wire prompt or config nodes into <span className="text-gray-200">Prompt / Config</span>. Wire a single image into
            <span className="text-gray-200"> Start Frame</span> for image-to-video. Add
            <span className="text-gray-200"> End Frame</span> for interpolation. Use up to three
            <span className="text-gray-200"> Reference</span> images to guide assets or style, or connect an upstream video to
            <span className="text-gray-200"> Extend / Edit Video</span> to transform an existing clip. The selected model keeps every slot visible and explains or blocks unsupported combinations.
          </div>

          {provider === 'gemini' && isGeminiOmniModelId(selectedModelId) ? (
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-100">
              Gemini Omni Flash uses the Interactions API for API-key mode. It supports text, start/reference images, and video editing, but not Veo-style extension or first/last-frame interpolation. Output is 720p and 3–10 seconds.
            </div>
          ) : null}

          {provider === 'gemini' && !isGeminiOmniModelId(selectedModelId) && (hasFrameInputs || hasReferenceConnections || hasExtensionConnection) ? (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-100">
              Gemini Veo now supports prompt-only video, image-to-video, interpolation, reference-image guidance, and video extension in this node. Reference-image guidance and extension lock the duration to 8 seconds. Extension also locks the output to 720p.
            </div>
          ) : null}

          {hasEndFrameConnection && !hasStartFrameConnection ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
              An end frame is wired, but Veo interpolation requires a start frame too. With only an end-frame edge, the run will be rejected.
            </div>
          ) : null}

          {hasFrameInputs && (!startFrame || (hasEndFrameConnection && !endFrame)) ? (
            <div className="rounded-lg border border-gray-700/60 bg-[#111217]/25 px-2.5 py-2 text-[11px] text-gray-400">
              Frame edges are connected. The preview thumbnails stay empty until the upstream image nodes finish generating or import an asset.
            </div>
          ) : null}

          {hasReferenceConnections && (!reference1 || (hasReference2Connection && !reference2) || (hasReference3Connection && !reference3)) ? (
            <div className="rounded-lg border border-gray-700/60 bg-[#111217]/25 px-2.5 py-2 text-[11px] text-gray-400">
              Reference-image edges are connected. Those thumbnails stay empty until the upstream image nodes finish generating or import an asset.
            </div>
          ) : null}

          {hasReferenceConnections && hasFrameInputs ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
              Reference-image guidance cannot be combined with start/end frames. Disconnect one mode before running the video node.
            </div>
          ) : null}

          {hasReferenceConnections && hasExtensionConnection ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
              Reference-image guidance cannot be combined with video extension in the same Veo request.
            </div>
          ) : null}

          {miswiredImageSources.length > 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
              {miswiredImageSources.length === 1 ? 'An image node is' : `${miswiredImageSources.length} image nodes are`} connected to a non-image video input and will be ignored for Veo conditioning. Reconnect image outputs to <span className="font-semibold text-amber-50">Start Frame</span>, <span className="font-semibold text-amber-50">End Frame</span>, or one of the <span className="font-semibold text-amber-50">Reference</span> slots.
            </div>
          ) : null}
        </>
      ) : (
        <>
          <label className={`${actionButtonClassName} justify-center cursor-pointer`}>
            <Upload size={12} />
            {data.sourceAssetName ? 'Replace Video' : 'Import Video'}
            <input
              accept="video/*"
              className="hidden"
              onChange={(event) => void handleImport(event.target.files?.[0])}
              type="file"
            />
          </label>

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-100">
            Imported videos keep a scrubber in the preview. Use <span className="font-semibold text-blue-50">Capture Frame</span> to export the current frame as a still image.
          </div>
        </>
      )}

      <ExecutionTelemetryPanel nodeId={id} usage={data.usage} />

      {previewPanel}

      {importedAssetNamePanel}
      {assetUrl && isPreviewOpen ? (
        <MediaPreviewModal
          kind="video"
          label={data.sourceAssetName ?? data.modelId ?? 'Video'}
          onClose={() => setPreviewOpen(false)}
          src={assetUrl}
        />
      ) : null}
    </BaseNode>
  );
}

export const VideoNode = memo(VideoNodeComponent);

interface ModeButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

function ModeButton({ active, label, onClick }: ModeButtonProps) {
  return (
    <button
      className={withFlowNodeInteractionClasses(`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
        active ? 'bg-blue-500 text-white' : 'bg-[#111217]/40 text-gray-400 hover:text-white'
      }`)}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

interface FrameSlotProps {
  disabledReason?: string;
  handleId: string;
  isConnected: boolean;
  label: string;
  imageUrl?: string;
  fallbackAspectRatio: AspectRatio;
}

function FrameSlot({ disabledReason, handleId, isConnected, label, imageUrl, fallbackAspectRatio }: FrameSlotProps) {
  return (
    <div className="relative rounded-lg border border-gray-700/60 bg-[#111217]/35 p-2 pl-5">
      <Handle
        id={handleId}
        type="target"
        position={Position.Left}
        className={`nodrag nopan !left-0 !top-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-6 !h-6 !border-[3px] !border-[#1e2027] ${isConnected ? '!bg-emerald-500' : '!bg-blue-500'}`}
        isConnectable={!disabledReason}
      />
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</div>
      {disabledReason ? (
        <div className="min-h-[5.5rem] text-[10px] leading-4 text-amber-200/80">{disabledReason}</div>
      ) : <ImagePreviewPane
        alt={label}
        fallbackAspectRatio={fallbackAspectRatio}
        imageMaxHeightClassName="max-h-24"
        minHeightClassName="min-h-[5.5rem]"
        placeholder={<div className="text-center text-[10px] text-gray-500">Connect an image node</div>}
        src={imageUrl}
      />}
    </div>
  );
}

interface ReferenceImageSlotProps extends FrameSlotProps {
  referenceType: VideoReferenceType;
  onReferenceTypeChange: (value: VideoReferenceType) => void;
}

function ReferenceImageSlot({
  disabledReason,
  handleId,
  isConnected,
  label,
  imageUrl,
  fallbackAspectRatio,
  referenceType,
  onReferenceTypeChange,
}: ReferenceImageSlotProps) {
  return (
    <div className="relative rounded-lg border border-gray-700/60 bg-[#111217]/35 p-2 pl-5">
      <Handle
        id={handleId}
        type="target"
        position={Position.Left}
        className={`nodrag nopan !left-0 !top-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-6 !h-6 !border-[3px] !border-[#1e2027] ${isConnected ? '!bg-emerald-500' : '!bg-blue-500'}`}
        isConnectable={!disabledReason}
      />
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</div>
      {disabledReason ? (
        <div className="min-h-[5.5rem] text-[9px] leading-3 text-amber-200/75">{disabledReason}</div>
      ) : <ImagePreviewPane
        alt={label}
        fallbackAspectRatio={fallbackAspectRatio}
        imageMaxHeightClassName="max-h-24"
        minHeightClassName="min-h-[5.5rem]"
        placeholder={<div className="text-center text-[10px] text-gray-500">Connect reference image</div>}
        src={imageUrl}
      />}
      <select
        className={withFlowNodeInteractionClasses('mt-2 w-full rounded-md border border-gray-700/60 bg-[#0d0f15] p-1.5 text-[10px] font-medium text-gray-200 outline-none')}
        disabled={Boolean(disabledReason)}
        onChange={(event) => onReferenceTypeChange(event.target.value as VideoReferenceType)}
        value={referenceType}
      >
        {VIDEO_REFERENCE_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface VideoExtensionSlotProps {
  disabledReason?: string;
  handleId: string;
  isConnected: boolean;
  sourceUrl?: string;
}

function VideoExtensionSlot({ disabledReason, handleId, isConnected, sourceUrl }: VideoExtensionSlotProps) {
  return (
    <div className="relative rounded-lg border border-gray-700/60 bg-[#111217]/35 p-2 pl-5">
      <Handle
        id={handleId}
        type="target"
        position={Position.Left}
        className={`nodrag nopan !left-0 !top-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-6 !h-6 !border-[3px] !border-[#1e2027] ${isConnected ? '!bg-emerald-500' : '!bg-blue-500'}`}
        isConnectable={!disabledReason}
      />
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">{disabledReason ? 'Video Input' : 'Extend / Edit Video'}</div>
      <div className="rounded-md border border-gray-700/60 bg-[#090a0f] px-2 py-3 text-[10px] text-gray-400">
        {disabledReason ?? (sourceUrl ? 'Upstream video connected.' : 'Connect a generated or imported video')}
      </div>
    </div>
  );
}

interface LabeledTargetHandleProps {
  id: string;
  label: string;
  topClassName: string;
}

function LabeledTargetHandle({ id, label, topClassName }: LabeledTargetHandleProps) {
  return (
    <>
      <div
        className={`pointer-events-none absolute left-3 ${topClassName} -translate-y-1/2 rounded-full border border-gray-700 bg-[#111217]/90 px-2 py-0.5 text-[10px] font-medium text-gray-300`}
      >
        {label}
      </div>
      <Handle
        id={id}
        type="target"
        position={Position.Left}
        className={`nodrag nopan !left-0 ${topClassName} !-translate-x-1/2 !w-6 !h-6 !bg-blue-500 !border-[3px] !border-[#1e2027]`}
      />
    </>
  );
}
