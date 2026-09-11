import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Position, useUpdateNodeInternals } from '@xyflow/react';
import { Download, GripVertical, Image as ImageIcon, Maximize2, Upload, X } from 'lucide-react';
import { AttemptHistory } from './AttemptHistory';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { CollapsedConnectionHandles } from './CollapsedConnectionHandles';
import { ExecutionTelemetryPanel } from './ExecutionTelemetryPanel';
import { ImageGenerationProgressBackdrop } from './ImageGenerationProgressBackdrop';
import { ImagePreviewPane } from './ImagePreviewPane';
import { MediaLoadingOverlay } from './MediaLoadingOverlay';
import { MediaPreviewModal } from './MediaPreviewModal';
import { ImageMaskPainterDialog } from './ImageMaskPainterDialog';
import { resolveImportedAssetDataUrl, saveImportedAsset } from '../../lib/assetStore';
import { fetchRemoteHostSourceAssetDataUrl, isServedLanSession } from '../../lib/remoteHostClient';
import { useLiveNodeResultAssetUrl } from './useLiveNodeResultAssetUrl';
import { getAtlasModelParams, getAtlasDimensionSpec, atlasModelAcceptsField } from '../../lib/imageEditorAi/atlasNativeImage';
import { buildDownloadFilename, downloadAsset } from '../../lib/downloadAsset';
import { EXPORT_BASENAME } from '../../lib/brand';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { getImageGenerationProgressDetail } from '../../lib/imageGenerationProgress';
import {
  hasConnectedImageEditSource,
  hasConnectedImageMaskSource,
  hasConnectedImageReferenceSource,
  hasConnectedImageInput,
  resolveConnectedImageEditAsset,
  resolveConnectedImageInputAsset,
  resolveConnectedImageMaskAsset,
  resolveConnectedImageReferenceAsset,
} from '../../lib/imageEditConnections';
import {
  IMAGE_REFERENCE_HANDLES,
  supportsImageEditing,
  supportsImageReferenceGuidance,
} from '../../lib/imageModelSupport';
import { configureDetectorKeys, listConfiguredDetectors } from '../../lib/imageMask/objectMaskDetectors';
import {
  getImageModelDefinition,
  getImageNodeControlModel,
  type ImageNodeVisibleControl,
} from '../../lib/imageProviderCapabilities';
import {
  getImageNodeCapabilityBadges,
  getImageNodeOperationCostRows,
} from '../../lib/imageNodeTemplates';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import { assignVariableToResultAttempt } from '../../lib/flowVariables';
import { resolveFlowNodePorts, type FlowPortContract } from '../../lib/flowNodeContracts';
import { resolveUniversalConfiguredUpscalePlan } from '../../lib/universalImageUpscale';
import { hasConnectedVideoSource } from '../../lib/videoSourceConnections';
import {
  CAPABILITY_PROVIDERS,
  getConfiguredProviders,
  getImageAspectRatioOptions,
  getModelOptions,
  getProviderLabel,
  getSupportedImageAspectRatio,
  IMAGE_OUTPUT_FORMAT_OPTIONS,
  IMAGE_STEP_OPTIONS,
} from '../../lib/providerCatalog';
import { useFlowStore } from '../../store/flowStore';
import { useSourceBinStore } from '../../store/sourceBinStore';
import { useConfirmationStore } from '../../store/confirmationStore';
import { useCatalogStore } from '../../store/catalogStore';
import { useSettingsStore } from '../../store/settingsStore';
import type {
  AppNodeProps,
  ImageProvider,
  MediaNodeMode,
  RuntimeSettingsSnapshot,
  VideoFrameSelection,
} from '../../types/flow';
import type {
  CardHandlePlacementV1,
  CardLayoutElementV1,
  FlowModelCardV1,
} from '../../lib/providerPackContracts';
import {
  listModelCardLayoutHandles,
  resolveAllCardHandlePlacements,
} from '../../lib/providerCardHandles';
import { modelCardInputHandle } from '../../lib/providerPackExecution';

interface ImageReferenceConnectionState {
  handleId: string;
  imageUrl?: string;
  isConnected: boolean;
}

const selectClassName = withFlowNodeInteractionClasses(
  'w-full bg-[#111217]/50 text-gray-200 border border-gray-700/60 rounded-lg p-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none shadow-inner',
);

const actionButtonClassName = withFlowNodeInteractionClasses(
  'inline-flex items-center gap-1 rounded-lg border border-gray-700/60 bg-[#111217]/40 px-2.5 py-1.5 text-[11px] font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white',
);

const textInputClassName = withFlowNodeInteractionClasses(
  'w-full rounded-lg border border-gray-700/60 bg-[#111217]/50 px-2.5 py-2 text-xs font-medium text-gray-200 outline-none focus:ring-2 focus:ring-blue-500',
);

const AUDITED_IMAGE_CONTROLS = [
  'aspectRatio',
  'dimensions',
  'imageSize',
  'quality',
  'steps',
  'seed',
  'guidanceScale',
  'editStrength',
  'loraWeights',
  'safetyChecker',
  'outputFormat',
  'searchPrompt',
  'exactColorPrompt',
  'textEditPrompt',
  'negativePrompt',
  'outpaintMargins',
  'creativity',
] as const satisfies readonly ImageNodeVisibleControl[];

const IMAGE_CONTROL_LABELS: Record<(typeof AUDITED_IMAGE_CONTROLS)[number], string> = {
  aspectRatio: 'Aspect ratio',
  dimensions: 'Custom dimensions',
  imageSize: 'Resolution tier',
  quality: 'Quality',
  steps: 'Inference steps',
  seed: 'Seed',
  guidanceScale: 'Guidance scale',
  editStrength: 'Edit strength',
  loraWeights: 'LoRA weights',
  safetyChecker: 'Safety checker',
  outputFormat: 'Output format',
  searchPrompt: 'Search prompt',
  exactColorPrompt: 'Exact-color instruction',
  textEditPrompt: 'Text-edit instruction',
  negativePrompt: 'Negative prompt',
  outpaintMargins: 'Outpaint margins',
  creativity: 'Creativity',
};

function ImageNodeComponent({ id, data }: AppNodeProps) {
  const builderCard = data.modelCardBuilderCard as FlowModelCardV1 | undefined;
  const isBuilderPreview = data.modelCardBuilderPreview === true;
  const builderOperationId = typeof data.modelCardBuilderOperationId === 'string'
    ? data.modelCardBuilderOperationId
    : builderCard?.operations[0]?.id;
  const builderOperation = builderCard?.operations.find((candidate) => candidate.id === builderOperationId)
    ?? builderCard?.operations[0];
  const builderReferenceField = builderCard?.fields.find((field) =>
    field.semanticRole === 'reference-image'
    && (!builderOperation || builderOperation.visibleFieldIds.includes(field.id))
  );
  const builderReferenceElement = builderReferenceField
    ? builderCard?.layout.elements.find((element) => element.fieldId === builderReferenceField.id)
    : undefined;
  const builderReferenceContainer = builderReferenceElement
    ? builderCard?.layout.containers.find((container) => container.id === builderReferenceElement.containerId)
    : undefined;
  const builderReferenceColumns = builderReferenceContainer
    ? builderReferenceContainer.operationColumns?.[builderOperation?.id ?? '']
      ?? builderReferenceContainer.columns
      ?? 2
    : 2;
  const builderReferenceTileHeight = builderReferenceContainer?.height;
  const builderFirstContainerOrder = builderCard
    ? Math.min(...builderCard.layout.containers.map((container) => container.order))
    : 0;
  const builderHandlePlacements = builderCard && builderOperation
    ? resolveAllCardHandlePlacements(
        builderCard.layout,
        listModelCardLayoutHandles(builderCard, builderOperation),
      )
    : [];
  const builderSelectElement = typeof data.modelCardBuilderSelectElement === 'function'
    ? data.modelCardBuilderSelectElement as (elementId: string) => void
    : undefined;
  const builderSelectHandle = typeof data.modelCardBuilderSelectHandle === 'function'
    ? data.modelCardBuilderSelectHandle as (handleId: string, elementId?: string) => void
    : undefined;
  const builderMoveElement = typeof data.modelCardBuilderMoveElement === 'function'
    ? data.modelCardBuilderMoveElement as (
        elementId: string,
        targetContainerId: string,
        beforeElementId?: string,
      ) => void
    : undefined;
  const builderSelectedElementId = typeof data.modelCardBuilderSelectedElementId === 'string'
    ? data.modelCardBuilderSelectedElementId
    : undefined;
  const modelCardOperationChange = typeof data.modelCardOperationChange === 'function'
    ? data.modelCardOperationChange as (operationId: string) => void
    : undefined;
  const renderLayoutItem = (
    identity: { fieldId?: string; outputId?: string },
    children: ReactNode,
  ): ReactNode => {
    if (!builderCard) return children;
    const element = builderCard.layout.elements.find((candidate) =>
      identity.fieldId ? candidate.fieldId === identity.fieldId : candidate.outputId === identity.outputId
    );
    if (!element) return null;
    if (
      element.fieldId
      && builderOperation
      && !builderOperation.visibleFieldIds.includes(element.fieldId)
    ) return null;
    const container = builderCard.layout.containers.find((candidate) => candidate.id === element.containerId);
    const field = element.fieldId
      ? builderCard.fields.find((candidate) => candidate.id === element.fieldId)
      : undefined;
    return (
      <ProductionLayoutItem
        autoHeight={field?.semanticRole === 'reference-image'}
        clipContent={Boolean(element.outputId) || field?.semanticRole === 'source-image' || field?.semanticRole === 'mask'}
        element={element}
        freeform={container?.kind === 'freeform'}
        handles={field?.semanticRole === 'reference-image'
          ? []
          : builderHandlePlacements.filter(({ handle, placement }) =>
              handle.elementId === element.id && placement.anchor === 'element'
            )}
        key={element.id}
        onMoveElement={builderMoveElement}
        onSelect={builderSelectElement}
        onSelectHandle={builderSelectHandle}
        order={(container?.order ?? 0) === builderFirstContainerOrder
          ? -10_000 + element.order
          : (container?.order ?? 0) * 1_000 + element.order}
        previewHandles={isBuilderPreview}
        selected={builderSelectedElementId === element.id}
      >
        {children}
      </ProductionLayoutItem>
    );
  };
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const providerSettings = useSettingsStore((state) => state.providerSettings);
  const defaultModels = useSettingsStore((state) => state.defaultModels.image);
  const defaultImageNodeModel = useSettingsStore((state) => state.defaultImageNodeModel);
  const setDefaultImageNodeModel = useSettingsStore((state) => state.setDefaultImageNodeModel);
  const modelCatalog = useCatalogStore((state) => state.modelCatalog);
  const mediaMode = (data.mediaMode ?? 'generate') as MediaNodeMode;
  const isCollapsed = Boolean(data.collapsed);
  const updateNodeInternals = useUpdateNodeInternals();
  // Re-measure handle positions when collapsing/expanding so edges re-anchor to the collapsed stub
  // handles (collapsed) or the full per-row handles (expanded); see CollapsedConnectionHandles.
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, isCollapsed, updateNodeInternals]);
  const onDataChange = data.onChange;
  const currentAspectRatio = data.aspectRatio;
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const [isMaskPainterOpen, setMaskPainterOpen] = useState(false);
  const [resolvedImportUrl, setResolvedImportUrl] = useState<string | undefined>(undefined);
  const [resolvedResultUrl, setResolvedResultUrl] = useState<string | undefined>(undefined);
  const availableProviders = useMemo(
    () => getConfiguredProviders('image', apiKeys, providerSettings),
    [apiKeys, providerSettings],
  );
  const provider = ((data.provider as ImageProvider | undefined) ?? 'gemini') as ImageProvider;
  const providerConfigured = availableProviders.includes(provider);
  const getDefaultImageModel = (imageProvider: ImageProvider) => (
    imageProvider === 'android'
      ? providerSettings.androidAcceleratorDefaultImageModel ?? defaultModels[imageProvider]
      : defaultModels[imageProvider]
  );
  const selectedModelId = data.modelId ?? getDefaultImageModel(provider);
  const modelDefinition = getImageModelDefinition(provider, selectedModelId);
  const usesInferredAtlasOperation = provider === 'atlas'
    && modelDefinition.capabilityConfidence === 'unverified'
    && modelDefinition.supportedOperations.some((operation) => operation !== 'text-to-image');
  const controlModel = getImageNodeControlModel(provider, selectedModelId);
  const resolvedPortContracts = resolveFlowNodePorts({
    node: {
      id,
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: { ...data, provider, modelId: selectedModelId },
    },
    nodes: [],
    edges: [],
  });
  const portContract = (handleId: string) => resolvedPortContracts.find((port) =>
    port.direction === 'input' && port.id === handleId
  );
  const modelCardEdgeHandles = builderCard && !isBuilderPreview
    ? builderHandlePlacements
        .filter(({ placement }) => placement.anchor === 'card')
        .map(({ handle, placement }) => (
          <Handle
            className="nodrag nopan !h-5 !w-5 !border-[3px] !border-[#1e2027]"
            contract={resolvedPortContracts.find((port) => port.id === handle.portId)}
            id={handle.portId}
            key={handle.portId}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              builderSelectHandle?.(handle.portId, handle.elementId);
            }}
            position={positionForCardHandleSide(placement.side)}
            style={cardEdgeHandleStyle(placement)}
            title={`${handle.label} · ${placement.side} ${placement.offsetPercent}%`}
            type={handle.direction === 'input' ? 'target' : 'source'}
          />
        ))
    : undefined;
  const capabilityBadges = useMemo(
    () => getImageNodeCapabilityBadges(provider, selectedModelId),
    [provider, selectedModelId],
  );
  const operationCostRows = useMemo(
    () => getImageNodeOperationCostRows(provider, selectedModelId),
    [provider, selectedModelId],
  );
  const autoUpscalePlan = useMemo(
    () => resolveUniversalConfiguredUpscalePlan({ apiKeys, providerSettings }),
    [apiKeys, providerSettings],
  );
  const autoUpscaleEnabled = Boolean(data.imageAutoUpscale);
  const hasControl = (control: ImageNodeVisibleControl) => controlModel.visibleControls.includes(control);
  const unavailableControls = AUDITED_IMAGE_CONTROLS.filter((control) => !hasControl(control));
  const lifecycleWarning = modelDefinition.lifecycle === 'preview'
    ? `${modelDefinition.label} is a preview model; availability and its API contract can change.`
    : modelDefinition.lifecycle === 'deprecated'
      ? `${modelDefinition.label} is deprecated.${modelDefinition.migrationModelId ? ` Migrate to ${modelDefinition.migrationModelId}.` : ''}`
      : modelDefinition.lifecycle === 'shutdown'
        ? `${modelDefinition.label} is shut down and retained only so saved flows remain understandable.${modelDefinition.migrationModelId ? ` Choose ${modelDefinition.migrationModelId} to run.` : ''}`
        : modelDefinition.lifecycle === 'unverified'
          ? usesInferredAtlasOperation
            ? `${modelDefinition.label} has no curated capability contract; operation-shaped controls are inferred from its Atlas route ID and all other controls stay blocked.`
            : `${modelDefinition.label} has no curated capability contract; only safe baseline controls are enabled.`
          : undefined;
  const runDisabledReason = modelDefinition.availability === 'unavailable'
    ? `${modelDefinition.label} is unavailable and cannot run.${modelDefinition.migrationModelId ? ` Choose ${modelDefinition.migrationModelId} instead.` : ''}`
    : !providerConfigured
      ? `Configure ${getProviderLabel(provider)} in Settings before running this node.`
      : undefined;
  const visibleReferenceHandles = builderReferenceField
    ? IMAGE_REFERENCE_HANDLES.map((_, index) => modelCardInputHandle(builderReferenceField.id, index))
    : [...IMAGE_REFERENCE_HANDLES];
  const builderSourceField = builderCard?.fields.find((field) =>
    field.semanticRole === 'source-image' && builderOperation?.visibleFieldIds.includes(field.id)
  );
  const builderMaskField = builderCard?.fields.find((field) =>
    field.semanticRole === 'mask' && builderOperation?.visibleFieldIds.includes(field.id)
  );
  const editSourceHandleId = builderSourceField
    ? modelCardInputHandle(builderSourceField.id)
    : 'image-edit-source';
  const maskHandleId = builderMaskField
    ? modelCardInputHandle(builderMaskField.id)
    : 'image-mask';
  const servedSession = isServedLanSession();
  const sourceAssetId = typeof data.sourceAssetId === 'string' ? data.sourceAssetId : undefined;
  const nodeSourceBinItemId = typeof data.sourceBinItemId === 'string' ? data.sourceBinItemId : undefined;

  // A URL we can actually paint in THIS origin. On a served browser the node's own URLs are phone-local
  // (capacitor / blob / `signal-loom-asset:` / the inline `sourceAssetUrl` that read-only project-open
  // restores) and fail to load — only a `data:` URL is safe. Off a served session every URL is local, so
  // anything paints. Painting an unloadable URL is what produced the broken-image glyph on the desktop.
  const canPaint = (url: unknown): url is string =>
    typeof url === 'string' && url.length > 0 && (!servedSession || url.startsWith('data:'));

  // Import mode. A node dragged from the source library carries `sourceBinItemId` (the library item id)
  // and/or `sourceAssetId`; a directly-imported file carries `sourceAssetId` (IndexedDB). On a served
  // browser the inline `sourceAssetUrl` can't paint, so resolve the bytes from the host: prefer the
  // library item id over the UNIVERSAL `/source-asset/:id` (the only path that covers native-file- and
  // scratch-backed items, which have no `assetId`), falling back to the imported-asset id over
  // `/asset/:id`. This is the same byte path the working source-library panel already rides.
  const needsImportResolution =
    mediaMode === 'import' && !canPaint(data.sourceAssetUrl) && (Boolean(nodeSourceBinItemId) || Boolean(sourceAssetId));

  useEffect(() => {
    if (!needsImportResolution) {
      setResolvedImportUrl(undefined);
      return;
    }

    let cancelled = false;
    void (async () => {
      let url: string | undefined;
      if (servedSession && nodeSourceBinItemId) {
        url = (await fetchRemoteHostSourceAssetDataUrl(nodeSourceBinItemId).catch(() => null)) ?? undefined;
      }
      if (!url && sourceAssetId) {
        url = await resolveImportedAssetDataUrl(sourceAssetId).catch(() => undefined);
      }
      if (!cancelled) {
        setResolvedImportUrl(url);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [needsImportResolution, servedSession, nodeSourceBinItemId, sourceAssetId]);

  // Generate mode renders `data.result`, the selected attempt's source-bin asset URL — a phone-local URL
  // that survives Flow sync but a served browser can't fetch. The selected attempt carries the stable
  // `sourceBinItemId`, so on a served session resolve the bytes from the host by item id (the universal
  // `/source-asset/:id` path the source library rides) and render that instead of a blank placeholder.
  const selectedResultAttempt = Array.isArray(data.resultHistory)
    ? (data.resultHistory.find((attempt) => attempt.id === data.selectedResultId)
      ?? data.resultHistory[data.resultHistory.length - 1])
    : undefined;
  const resultSourceBinItemId = selectedResultAttempt?.sourceBinItemId ?? nodeSourceBinItemId;
  const needsResultResolution =
    mediaMode === 'generate' && Boolean(resultSourceBinItemId) && servedSession && !canPaint(data.result);

  useEffect(() => {
    if (!needsResultResolution || !resultSourceBinItemId) {
      setResolvedResultUrl(undefined);
      return;
    }

    let cancelled = false;
    void fetchRemoteHostSourceAssetDataUrl(resultSourceBinItemId).then((url) => {
      if (!cancelled) {
        setResolvedResultUrl(url ?? undefined);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [needsResultResolution, resultSourceBinItemId]);

  // Served-session linkage fallback. An EXISTING project's nodes predate the per-attempt `sourceBinItemId`
  // plumbing, and their own URLs are unreachable in a served browser (import: the inline `sourceAssetUrl`
  // is stripped by sync and `/asset/:id` is IndexedDB-only, so native-file-backed imports miss; generate:
  // `data.result` is a phone-local URL). But `hydrateAssets()` already resolved EVERY source-library item
  // to a `data:` URL through the universal `/source-asset/:itemId` endpoint, and the node's asset is linked
  // there structurally — directly by `sourceBinItemId` (the most reliable link, set on every node dragged
  // from the library), else generated items by `originNodeId`, imported items by `assetId`. Reuse that
  // already-resolved `data:` URL so the node renders the SAME bytes the library panel does, no refetch.
  const servedLinkedAssetUrl = useSourceBinStore((state) => {
    if (!servedSession) return undefined;
    const linked = state.getAllItems().filter(
      (item) =>
        (Boolean(nodeSourceBinItemId) && item.id === nodeSourceBinItemId) ||
        item.originNodeId === id ||
        (typeof item.originNodeId === 'string' && item.originNodeId.startsWith(`${id}:`)) ||
        (Boolean(sourceAssetId) && item.assetId === sourceAssetId),
    );
    if (linked.length === 0) return undefined;
    const latest = linked.reduce((best, item) => (item.createdAt > best.createdAt ? item : best));
    return canPaint(latest.assetUrl) ? latest.assetUrl : undefined;
  });

  // Live generated-result URL from the source-bin store (the asset's authority). `data.result` caches the
  // `assetUrl` from generation time, which for IndexedDB-/scratch-backed assets is a `blob:` URL the store
  // revokes on rehydration — leaving the cached value pointing at a dead blob (the broken-image glyph). See
  // useLiveNodeResultAssetUrl for the full rationale; resolving reactively always yields the still-valid URL.
  const liveResultAssetUrl = useLiveNodeResultAssetUrl({
    nodeId: id,
    enabled: mediaMode === 'generate',
    resultSourceBinItemId,
  });

  const assetUrl = mediaMode === 'import'
    ? ((canPaint(data.sourceAssetUrl) ? data.sourceAssetUrl : undefined) ?? resolvedImportUrl ?? servedLinkedAssetUrl)
    : (resolvedResultUrl ?? liveResultAssetUrl ?? servedLinkedAssetUrl ?? (canPaint(data.result) ? data.result : undefined));
  const assetMimeType = mediaMode === 'import' ? data.sourceAssetMimeType : 'image/png';
  const isImageGenerating = Boolean(data.isRunning);

  const connections = useFlowStore(
    useShallow((state) => ({
      hasVideoSourceConnection: hasConnectedVideoSource(state.nodes, state.edges, id),
      hasEditSourceConnection: builderSourceField
        ? hasConnectedImageInput(state.nodes, state.edges, id, [editSourceHandleId])
        : hasConnectedImageEditSource(state.nodes, state.edges, id),
      hasMaskConnection: builderMaskField
        ? hasConnectedImageInput(state.nodes, state.edges, id, [maskHandleId])
        : hasConnectedImageMaskSource(state.nodes, state.edges, id),
      editSourcePreviewUrl: builderSourceField
        ? resolveConnectedImageInputAsset(state.nodes, state.edges, id, [editSourceHandleId])
        : resolveConnectedImageEditAsset(state.nodes, state.edges, id),
      maskPreviewUrl: builderMaskField
        ? resolveConnectedImageInputAsset(state.nodes, state.edges, id, [maskHandleId])
        : resolveConnectedImageMaskAsset(state.nodes, state.edges, id),
      referenceStateJson: JSON.stringify(visibleReferenceHandles.map((handleId) => ({
        handleId,
        imageUrl: resolveConnectedImageReferenceAsset(state.nodes, state.edges, id, [handleId]),
        isConnected: hasConnectedImageReferenceSource(state.nodes, state.edges, id, [handleId]),
      } satisfies ImageReferenceConnectionState))),
    })),
  );
  const {
    hasVideoSourceConnection,
    hasEditSourceConnection,
    hasMaskConnection,
    editSourcePreviewUrl,
    maskPreviewUrl,
    referenceStateJson,
  } = connections;
  const references = useMemo<ImageReferenceConnectionState[]>(() => {
    try {
      const parsed = JSON.parse(referenceStateJson) as ImageReferenceConnectionState[];
      return parsed.filter((reference): reference is ImageReferenceConnectionState =>
        typeof reference.handleId === 'string'
        && typeof reference.isConnected === 'boolean' &&
        (reference.imageUrl === undefined || typeof reference.imageUrl === 'string'));
    } catch {
      return [];
    }
  }, [referenceStateJson]);
  const hasReferenceConnections = references.some((reference) => reference.isConnected);
  const canEditConnectedImage = supportsImageEditing(provider, selectedModelId);
  const canUseReferenceGuidance = supportsImageReferenceGuidance(provider, selectedModelId);
  const paintedMaskUrl = typeof data.imagePaintedMaskDataUrl === 'string' ? data.imagePaintedMaskDataUrl : undefined;
  const effectiveMaskPreviewUrl = maskPreviewUrl ?? paintedMaskUrl;
  const hasPaintedMask = Boolean(paintedMaskUrl);
  const parsedMaskBrushSize = Number(data.imageMaskBrushSize);
  const maskBrushSize = Number.isFinite(parsedMaskBrushSize)
    ? Math.max(4, Math.min(160, parsedMaskBrushSize))
    : 36;
  const maskPainterMode = hasControl('outpaintMargins') && !hasControl('mask') ? 'outpaint' : 'mask';
  const maskPainterSourceUrl = editSourcePreviewUrl
    ?? (typeof data.result === 'string' ? data.result : undefined)
    ?? (typeof data.sourceAssetUrl === 'string' ? data.sourceAssetUrl : undefined);
  const canOpenMaskPainter = Boolean(maskPainterSourceUrl);
  const settingsSnapshot = useMemo(
    () => ({ apiKeys, providerSettings }) as RuntimeSettingsSnapshot,
    [apiKeys, providerSettings],
  );
  const maskDetector = useMemo(() => listConfiguredDetectors(settingsSnapshot)[0], [settingsSnapshot]);
  const isVideoFrameMode = mediaMode === 'generate' && hasVideoSourceConnection;
  const builderForcesEditing = Boolean(
    builderOperation
    && builderOperation.id !== 'text-to-image'
    && builderOperation.visibleFieldIds.some((fieldId) =>
      builderCard?.fields.find((field) => field.id === fieldId)?.semanticRole === 'source-image'
    )
  );
  const isEditingMode = mediaMode === 'generate' && (hasEditSourceConnection || builderForcesEditing);
  const isReferenceGuidedMode = mediaMode === 'generate' && !isEditingMode && hasReferenceConnections;
  const selectedVideoFrame = (data.videoFrameSelection as VideoFrameSelection | undefined) ?? 'last';
  const configuredAspectRatio = getSupportedImageAspectRatio(
    provider,
    selectedModelId,
    data.aspectRatio as string | undefined,
  );
  const aspectRatioOptions = getImageAspectRatioOptions(provider, selectedModelId);
  // Documented model-specific parameters (resolution, quality, n, thinking_mode, …) for the selected Atlas
  // model — rendered as a generic section so every feature the model exposes is reachable from the node.
  const atlasModelParams = provider === 'atlas' ? getAtlasModelParams(selectedModelId) : [];
  // Only show output-size controls the SELECTED model actually supports (from its documented schema):
  // aspect-ratio presets when the model takes an aspect_ratio or a W×H `size`; custom width/height only for
  // free-range `size`. Tier-only models (e.g. Wan 2.7 — resolution 1K/2K, aspect follows the source) and
  // models with no size field show neither (their `size`/resolution appears in Model parameters instead).
  const atlasDimSpec = provider === 'atlas' ? getAtlasDimensionSpec(selectedModelId) : undefined;
  const atlasIsSizeField = atlasDimSpec?.field === 'size' || atlasDimSpec?.field === 'image_size';
  const atlasAspectControllable = provider !== 'atlas'
    ? true
    : atlasDimSpec?.field === 'aspect_ratio'
      || atlasDimSpec?.field === 'wh'
      || (atlasIsSizeField && atlasDimSpec?.format !== 'tier');
  const atlasCustomDimsControllable = provider !== 'atlas'
    ? true
    : (atlasIsSizeField && Boolean(atlasDimSpec?.free)) || atlasDimSpec?.field === 'wh';
  // The boolean "safety checker" toggle only applies to models that document `enable_safety_checker`.
  // Models with a numeric `safety_tolerance` (e.g. FLUX.2) expose that in Model parameters instead.
  const atlasAcceptsSafetyToggle = provider !== 'atlas' || atlasModelAcceptsField(selectedModelId, 'enable_safety_checker');
  const atlasParamValues = (data.atlasParams ?? {}) as Record<string, string | number | boolean>;
  const setAtlasParam = (name: string, value: string | number | boolean | undefined) => {
    const next: Record<string, string | number | boolean> = { ...atlasParamValues };
    if (value === undefined || value === '') {
      delete next[name];
    } else {
      next[name] = value;
    }
    data.onChange?.('atlasParams', next);
  };

  useEffect(() => {
    if (mediaMode !== 'generate' || isVideoFrameMode || currentAspectRatio === configuredAspectRatio) {
      return;
    }

    onDataChange?.('aspectRatio', configuredAspectRatio);
  }, [configuredAspectRatio, currentAspectRatio, isVideoFrameMode, mediaMode, onDataChange]);

  const handleModeChange = (nextMode: MediaNodeMode) => {
    data.onChange?.('mediaMode', nextMode);
    data.onChange?.('error', undefined);
    data.onChange?.('statusMessage', nextMode === 'import' ? 'Choose an image from your device.' : undefined);

    if (nextMode === 'import') {
      data.onChange?.('result', undefined);
      return;
    }

    data.onChange?.('provider', provider);
    data.onChange?.('modelId', data.modelId ?? getDefaultImageModel(provider));
  };

  const handleProviderChange = (nextProvider: ImageProvider) => {
    const nextModelId = getDefaultImageModel(nextProvider);
    data.onChange?.('provider', nextProvider);
    data.onChange?.('modelId', nextModelId);
    data.onChange?.(
      'aspectRatio',
      getSupportedImageAspectRatio(nextProvider, nextModelId, data.aspectRatio as string | undefined),
    );
  };

  const handleModelChange = (nextModelId: string) => {
    data.onChange?.('modelId', nextModelId);
    data.onChange?.(
      'aspectRatio',
      getSupportedImageAspectRatio(provider, nextModelId, data.aspectRatio as string | undefined),
    );
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
      data.onChange?.('error', error instanceof Error ? error.message : 'Image import failed.');
    }
  };

  const handleDownload = async () => {
    if (!assetUrl) {
      return;
    }

    await downloadAsset(
      assetUrl,
      buildDownloadFilename(data.sourceAssetName ?? `${EXPORT_BASENAME}-image`, assetMimeType, 'png'),
    );
  };

  const modelOptions = getModelOptions(
    'image',
    provider,
    modelCatalog,
    data.modelId ?? defaultModels[provider],
  );

  const previewPanel = (
    <div className="relative group mt-1">
      {isImageGenerating && !assetUrl ? (
        <ImageGenerationProgressBackdrop />
      ) : (
        <button
          className={withFlowNodeInteractionClasses('block w-full text-left')}
          disabled={!assetUrl}
          onClick={() => setPreviewOpen(true)}
          title={assetUrl ? 'Open image preview' : undefined}
          type="button"
        >
          <ImagePreviewPane
            alt="Flow node output"
            fallbackAspectRatio={configuredAspectRatio}
            imageMaxHeightClassName={
              isImageGenerating ? 'max-h-[18rem] scale-[1.02] blur-[2px] opacity-60' : 'max-h-[18rem]'
            }
            minHeightClassName="min-h-[9rem]"
            placeholder={(
              <div className="flex flex-col items-center justify-center text-gray-500">
                <ImageIcon size={24} className="mb-2 opacity-50" />
                <span className="text-center text-[11px] font-medium tracking-wide">
                  {mediaMode === 'import'
                    ? 'Import a local image'
                    : isVideoFrameMode
                      ? `Run to extract the ${selectedVideoFrame} frame from the connected video`
                    : isEditingMode
                      ? 'Run with a prompt to edit the connected source image'
                    : isReferenceGuidedMode
                      ? 'Run with a prompt to generate from the connected reference images'
                      : 'Run with an upstream prompt'}
                </span>
              </div>
            )}
            src={assetUrl}
          />
        </button>
      )}

      {assetUrl && !isImageGenerating ? (
        <button
          className={withFlowNodeInteractionClasses(
            'absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-red-500/50 bg-black/75 text-red-400 transition-all hover:scale-110 hover:border-red-500 hover:bg-red-500 hover:text-white shadow-lg cursor-pointer'
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void (async () => {
              const confirmed = await useConfirmationStore.getState().requestConfirmation(
                'Delete this image? It will be removed from your project source library and canvas envelopes.',
                'Delete Image',
              );
              if (!confirmed) {
                return;
              }

              const sourceBinState = useSourceBinStore.getState();
              const matchedItem = sourceBinState.getAllItems().find((item) => item.assetUrl === assetUrl);
              if (matchedItem) {
                sourceBinState.removeItem(matchedItem.id);
              }

              // Clear generated result fields
              data.onChange?.('result', undefined);
              data.onChange?.('resultType', undefined);
              data.onChange?.('resultMimeType', undefined);
              data.onChange?.('resultExtension', undefined);
              data.onChange?.('resultFileName', undefined);
              data.onChange?.('resultHistory', undefined);
              data.onChange?.('selectedResultId', undefined);

              // Also clear imported asset fields if in import mode
              if (mediaMode === 'import') {
                data.onChange?.('sourceAssetId', undefined);
                data.onChange?.('sourceAssetUrl', undefined);
                data.onChange?.('sourceAssetName', undefined);
                data.onChange?.('sourceAssetMimeType', undefined);
              }
            })();
          }}
          title="Delete image"
          type="button"
        >
          <X size={12} />
        </button>
      ) : null}

      {isImageGenerating ? (
        <MediaLoadingOverlay
          detail={getImageGenerationProgressDetail(Boolean(assetUrl))}
          title="Generating image"
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
      containerClassName={builderCard ? 'overflow-visible' : undefined}
      containerStyle={builderCard ? { width: builderCard.layout.width } : undefined}
      customHandles={modelCardEdgeHandles}
      hasInput={!builderCard}
      hasOutput={!builderCard}
      showLoopBreak={!builderCard}
      collapsedContent={
        <div className="space-y-2">
          {previewPanel}
          {importedAssetNamePanel}
          <CollapsedConnectionHandles nodeId={id} />
        </div>
      }
      nodeId={id}
      icon={ImageIcon}
      nodeType="imageGen"
      isCollapsed={isCollapsed}
      title={
        builderCard
          ? builderCard.displayName
          : mediaMode === 'import'
          ? 'Image Asset'
          : isVideoFrameMode
            ? 'Video Frame'
          : isEditingMode
            ? 'Image Editing'
          : isReferenceGuidedMode
            ? 'Reference-Guided Image'
            : 'Image Generation'
      }
      outputActions={getCompatibleNodeActions('imageGen')}
      onRun={mediaMode === 'generate' ? data.onRun : undefined}
      runDisabledReason={mediaMode === 'generate' ? runDisabledReason : undefined}
      isRunning={data.isRunning}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
      onToggleCollapsed={() => data.onChange?.('collapsed', !isCollapsed)}
      footerActions={
        assetUrl ? (
          <button className={actionButtonClassName} onClick={() => void handleDownload()} type="button">
            <Download size={12} />
            Save
          </button>
        ) : null
      }
    >
      {builderCard ? <span className="hidden" data-production-image-model-card="true" /> : null}
      {mediaMode === 'generate' && !builderCard ? (
        <AttemptHistory
          attempts={data.resultHistory}
          onAssignVariable={(attemptId, variableName) => data.onChange?.('resultHistory', assignVariableToResultAttempt(data.resultHistory, attemptId, variableName))}
          onSelectAttempt={data.onSelectAttempt}
          selectedAttemptId={data.selectedResultId}
        />
      ) : null}

      {!builderCard ? <div className="grid grid-cols-2 gap-2">
        <ModeButton active={mediaMode === 'generate'} label="Generate" onClick={() => handleModeChange('generate')} />
        <ModeButton active={mediaMode === 'import'} label="Import" onClick={() => handleModeChange('import')} />
      </div> : null}

      {builderCard && modelCardOperationChange && builderCard.operations.length > 1 ? (
        <div
          className="grid gap-1"
          data-production-model-card-operation-switcher="true"
          style={{ gridTemplateColumns: `repeat(${Math.min(4, builderCard.operations.length)}, minmax(0, 1fr))` }}
        >
          {builderCard.operations.map((operation) => (
            <button
              className={withFlowNodeInteractionClasses(`rounded-lg border px-2 py-1.5 text-[10px] font-semibold ${
                operation.id === builderOperation?.id
                  ? 'border-cyan-300/55 bg-cyan-400/15 text-cyan-50'
                  : 'border-gray-700/70 bg-[#0a1018] text-gray-400 hover:text-gray-100'
              }`)}
              key={operation.id}
              onClick={() => modelCardOperationChange(operation.id)}
              type="button"
            >
              {operation.label}
            </button>
          ))}
        </div>
      ) : null}

      {mediaMode === 'generate' ? (
        <>
          {isVideoFrameMode ? (
            <>
              <select
                className={selectClassName}
                onChange={(event) => data.onChange?.('videoFrameSelection', event.target.value)}
                value={selectedVideoFrame}
              >
                <option value="last">Last video frame</option>
                <option value="first">First video frame</option>
              </select>

              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-100">
                An upstream video is connected. This node will extract the selected frame locally without calling an image model.
              </div>
            </>
          ) : builderCard ? null : (
            <>
              <select
                className={selectClassName}
                onChange={(event) => handleProviderChange(event.target.value as ImageProvider)}
                value={provider}
              >
                {CAPABILITY_PROVIDERS.image.map((option) => (
                  <option key={option} value={option}>
                    {getProviderLabel(option)}
                  </option>
                ))}
              </select>

              <select
                className={selectClassName}
                onChange={(event) => handleModelChange(event.target.value)}
                value={selectedModelId}
              >
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <label className={withFlowNodeInteractionClasses('flex items-center gap-2 text-[11px] text-gray-400')}>
                <input
                  checked={defaultImageNodeModel?.provider === provider && defaultImageNodeModel?.modelId === selectedModelId}
                  className="h-3.5 w-3.5 shrink-0 accent-blue-400"
                  onChange={(event) => setDefaultImageNodeModel(
                    event.target.checked ? { provider, modelId: selectedModelId } : null,
                  )}
                  type="checkbox"
                />
                Default for new image nodes
              </label>

              {!providerConfigured ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-100">
                  Configure {getProviderLabel(provider)} in Settings to run this model. The provider and model remain selectable so you can design the flow first.
                </div>
              ) : null}
            </>
          )}

          {!builderCard && !isVideoFrameMode && lifecycleWarning ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-100">
              {lifecycleWarning}
            </div>
          ) : null}

          {!builderCard && !isVideoFrameMode && unavailableControls.length > 0 ? (
            <details className={withFlowNodeInteractionClasses('rounded-lg border border-gray-700/60 bg-[#111217]/25 px-2.5 py-2 text-[10px] text-gray-400')}>
              <summary className="cursor-pointer font-semibold text-gray-300">
                Unavailable model controls ({unavailableControls.length})
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {unavailableControls.map((control) => (
                  <span
                    aria-disabled="true"
                    className="cursor-not-allowed rounded border border-gray-800 bg-[#0b0d13] px-1.5 py-1 text-[9px] text-gray-600 line-through"
                    key={control}
                    title={`${modelDefinition.label} does not expose ${IMAGE_CONTROL_LABELS[control]} on this API route.`}
                  >
                    {IMAGE_CONTROL_LABELS[control]}
                  </span>
                ))}
              </div>
              <div className="mt-2 leading-4 text-amber-200/70">
                Unsupported values are blocked and never sent to this model API.
              </div>
            </details>
          ) : null}

          {!isVideoFrameMode ? (
            <>
              {hasControl('aspectRatio') && atlasAspectControllable && aspectRatioOptions.length > 0 ? (
                renderLayoutItem({ fieldId: 'aspectRatio' }, (
                  <select
                    className={selectClassName}
                    onChange={(event) => data.onChange?.('aspectRatio', event.target.value)}
                    value={configuredAspectRatio}
                  >
                    {aspectRatioOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ))
              ) : null}

              {hasControl('dimensions') && atlasCustomDimsControllable ? (
                renderLayoutItem({ fieldId: 'dimensions' }, (
                  <div className="flex gap-2">
                    <input
                      aria-label="Custom width (px)"
                      className={textInputClassName}
                      max={4096}
                      min={64}
                      onChange={(event) => data.onChange?.(
                        'imageWidth',
                        event.target.value === '' ? undefined : Number(event.target.value),
                      )}
                      placeholder="Width"
                      step={8}
                      type="number"
                      value={data.imageWidth === undefined ? '' : String(data.imageWidth)}
                    />
                    <input
                      aria-label="Custom height (px)"
                      className={textInputClassName}
                      max={4096}
                      min={64}
                      onChange={(event) => data.onChange?.(
                        'imageHeight',
                        event.target.value === '' ? undefined : Number(event.target.value),
                      )}
                      placeholder="Height"
                      step={8}
                      type="number"
                      value={data.imageHeight === undefined ? '' : String(data.imageHeight)}
                    />
                  </div>
                ))
              ) : null}

              {hasControl('steps') ? (
                renderLayoutItem({ fieldId: 'steps' }, (
                  <select
                    className={selectClassName}
                    onChange={(event) => data.onChange?.('steps', Number(event.target.value))}
                    value={String(data.steps ?? 30)}
                  >
                    {IMAGE_STEP_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ))
              ) : null}

              {hasControl('seed') ? (
                renderLayoutItem({ fieldId: 'seed' }, (
                  <input
                    className={textInputClassName}
                    min={0}
                    onChange={(event) => data.onChange?.(
                      'imageSeed',
                      event.target.value === '' ? undefined : Number(event.target.value),
                    )}
                    placeholder="Seed"
                    type="number"
                    value={data.imageSeed === undefined ? '' : String(data.imageSeed)}
                  />
                ))
              ) : null}

              {hasControl('guidanceScale') ? (
                renderLayoutItem({ fieldId: 'guidanceScale' }, (
                  <input
                    className={textInputClassName}
                    max={20}
                    min={0}
                    onChange={(event) => data.onChange?.(
                      'imageGuidanceScale',
                      event.target.value === '' ? undefined : Number(event.target.value),
                    )}
                    placeholder="Guidance scale"
                    step={0.5}
                    type="number"
                    value={data.imageGuidanceScale === undefined ? '' : String(data.imageGuidanceScale)}
                  />
                ))
              ) : null}

              {hasControl('editStrength') ? (
                renderLayoutItem({ fieldId: 'editStrength' }, (
                  <label className="space-y-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Edit strength
                    <input
                      className={withFlowNodeInteractionClasses('w-full accent-blue-500')}
                      max={1}
                      min={0}
                      onChange={(event) => data.onChange?.('imageEditStrength', Number(event.target.value))}
                      step={0.05}
                      type="range"
                      value={String(data.imageEditStrength ?? 0.65)}
                    />
                  </label>
                ))
              ) : null}

              {hasControl('loraWeights') ? (
                renderLayoutItem({ fieldId: 'loraWeights' }, (
                  <textarea
                    className={`${textInputClassName} min-h-16 resize-y`}
                    onChange={(event) => data.onChange?.('imageLoraWeightsJson', event.target.value)}
                    placeholder="LoRA JSON for Atlas, e.g. [{&quot;path&quot;:&quot;...&quot;,&quot;scale&quot;:0.8}]"
                    value={data.imageLoraWeightsJson ?? ''}
                  />
                ))
              ) : null}

              {hasControl('safetyChecker') && atlasAcceptsSafetyToggle ? (
                renderLayoutItem({ fieldId: 'safetyChecker' }, (
                  <label className={withFlowNodeInteractionClasses('flex items-start gap-2 rounded-lg border border-gray-700/50 bg-[#111217]/30 px-2.5 py-2 text-[11px] text-gray-300 hover:border-gray-600')}>
                    <input
                      checked={data.imageSafetyCheckerEnabled ?? false}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-blue-400"
                      onChange={(event) => data.onChange?.('imageSafetyCheckerEnabled', event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <span className="block font-semibold text-gray-100">Provider safety checker</span>
                      <span className="mt-0.5 block leading-4 text-gray-400">
                        Pass the Atlas model-level safety checker flag when the model supports it.
                      </span>
                    </span>
                  </label>
                ))
              ) : null}

              {hasControl('imageSize') ? (
                renderLayoutItem({ fieldId: 'imageSize' }, (
                  <select
                    aria-label="Output resolution"
                    className={selectClassName}
                    onChange={(event) => data.onChange?.(
                      'imageResolutionTier',
                      event.target.value === 'default' ? undefined : event.target.value,
                    )}
                    value={data.imageResolutionTier ?? 'default'}
                  >
                    <option value="default">Resolution: Default (1K)</option>
                    <option value="1K">Resolution: 1K</option>
                    <option value="2K">Resolution: 2K</option>
                    <option value="4K">Resolution: 4K</option>
                  </select>
                ))
              ) : null}

              {hasControl('quality') ? (
                renderLayoutItem({ fieldId: 'quality' }, (
                  <select
                    aria-label="Image quality"
                    className={selectClassName}
                    onChange={(event) => data.onChange?.('imageQuality', event.target.value)}
                    value={data.imageQuality ?? 'auto'}
                  >
                    <option value="auto">Quality: Auto</option>
                    <option value="low">Quality: Low (cheapest)</option>
                    <option value="medium">Quality: Medium</option>
                    <option value="high">Quality: High</option>
                  </select>
                ))
              ) : null}

              {hasControl('outputFormat') ? (
                renderLayoutItem({ fieldId: 'outputFormat' }, (
                  <select
                    className={selectClassName}
                    onChange={(event) => data.onChange?.('imageOutputFormat', event.target.value)}
                    value={data.imageOutputFormat ?? 'png'}
                  >
                    {IMAGE_OUTPUT_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ))
              ) : null}

              {hasControl('searchPrompt') ? (
                renderLayoutItem({ fieldId: 'searchPrompt' }, (
                  <input
                    className={textInputClassName}
                    onChange={(event) => data.onChange?.('imageSearchPrompt', event.target.value)}
                    placeholder="Object to find, e.g. red mug"
                    type="text"
                    value={data.imageSearchPrompt ?? ''}
                  />
                ))
              ) : null}

              {hasControl('exactColorPrompt') ? (
                renderLayoutItem({ fieldId: 'exactColorPrompt' }, (
                  <input
                    className={textInputClassName}
                    onChange={(event) => data.onChange?.('imageExactColor', event.target.value)}
                    placeholder="Exact color or palette, e.g. #0057ff"
                    type="text"
                    value={data.imageExactColor ?? ''}
                  />
                ))
              ) : null}

              {hasControl('textEditPrompt') ? (
                renderLayoutItem({ fieldId: 'textEditPrompt' }, (
                  <input
                    className={textInputClassName}
                    onChange={(event) => data.onChange?.('imageTextEditPrompt', event.target.value)}
                    placeholder="Text edit target, e.g. replace sign with OPEN LATE"
                    type="text"
                    value={data.imageTextEditPrompt ?? ''}
                  />
                ))
              ) : null}

              {hasControl('negativePrompt') ? (
                renderLayoutItem({ fieldId: 'negativePrompt' }, (
                  <input
                    className={textInputClassName}
                    onChange={(event) => data.onChange?.('imageNegativePrompt', event.target.value)}
                    placeholder="Negative prompt, e.g. blurry, extra fingers"
                    type="text"
                    value={data.imageNegativePrompt ?? ''}
                  />
                ))
              ) : null}

              {atlasModelParams.length > 0 ? (
                <div className="space-y-1.5 rounded-md border border-gray-700/50 p-2">
                  <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Model parameters
                  </span>
                  {atlasModelParams.map((param) => {
                    const current = atlasParamValues[param.name];
                    const defaultHint = param.default !== undefined ? ` (default ${param.default})` : '';
                    if (param.type === 'boolean') {
                      const checked = current === undefined ? Boolean(param.default) : Boolean(current);
                      return (
                        <label key={param.name} className="flex items-center gap-2 text-[11px] text-gray-300" title={param.description}>
                          <input
                            checked={checked}
                            onChange={(event) => setAtlasParam(param.name, event.target.checked)}
                            type="checkbox"
                          />
                          {param.label}
                        </label>
                      );
                    }
                    if (param.type === 'enum') {
                      return (
                        <select
                          key={param.name}
                          className={selectClassName}
                          onChange={(event) => setAtlasParam(param.name, event.target.value || undefined)}
                          title={param.description}
                          value={current === undefined ? '' : String(current)}
                        >
                          <option value="">{`${param.label}${defaultHint}`}</option>
                          {(param.enum ?? []).map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      );
                    }
                    return (
                      <input
                        key={param.name}
                        className={textInputClassName}
                        max={param.max}
                        min={param.min}
                        onChange={(event) => setAtlasParam(
                          param.name,
                          event.target.value === ''
                            ? undefined
                            : (param.type === 'string' ? event.target.value : Number(event.target.value)),
                        )}
                        placeholder={`${param.label}${defaultHint}`}
                        title={param.description}
                        type={param.type === 'string' ? 'text' : 'number'}
                        value={current === undefined ? '' : String(current)}
                      />
                    );
                  })}
                </div>
              ) : null}

              {hasControl('outpaintMargins') ? (
                renderLayoutItem({ fieldId: 'outpaintMargins' }, (
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { field: 'imageOutpaintLeft', label: 'L' },
                        { field: 'imageOutpaintRight', label: 'R' },
                        { field: 'imageOutpaintUp', label: 'U' },
                        { field: 'imageOutpaintDown', label: 'D' },
                      ].map(({ field, label }) => (
                        <label key={field} className="space-y-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                          {label}
                          <input
                            className={textInputClassName}
                            min={0}
                            onChange={(event) => data.onChange?.(field, Number(event.target.value))}
                            step={64}
                            type="number"
                            value={String(Number(data[field] ?? 0))}
                          />
                        </label>
                      ))}
                    </div>
                    <button
                      className={`${actionButtonClassName} w-full justify-center disabled:cursor-not-allowed disabled:opacity-50`}
                      disabled={!canOpenMaskPainter}
                      onClick={() => setMaskPainterOpen(true)}
                      type="button"
                    >
                      <Maximize2 size={12} />
                      Open outpaint workspace
                    </button>
                  </div>
                ))
              ) : null}

              {hasControl('creativity') ? (
                renderLayoutItem({ fieldId: 'creativity' }, (
                  <label className="space-y-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Creativity
                    <input
                      className={withFlowNodeInteractionClasses('w-full accent-blue-500')}
                      max={1}
                      min={0}
                      onChange={(event) => data.onChange?.('imageCreativity', Number(event.target.value))}
                      step={0.05}
                      type="range"
                      value={String(data.imageCreativity ?? 0.35)}
                    />
                  </label>
                ))
              ) : null}

              {!builderCard ? <label className={withFlowNodeInteractionClasses(`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] transition-colors ${
                autoUpscaleEnabled
                  ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-50'
                  : 'border-gray-700/50 bg-[#111217]/30 text-gray-400 hover:border-gray-600'
              }`)}>
                <input
                  checked={autoUpscaleEnabled}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cyan-400"
                  onChange={(event) => data.onChange?.('imageAutoUpscale', event.target.checked)}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-gray-100">Auto-upscale result</span>
                  <span className="mt-0.5 block leading-4 text-gray-400">
                    {autoUpscalePlan.label} · {autoUpscalePlan.canRun ? autoUpscalePlan.costLabel : 'not configured'}
                  </span>
                  {autoUpscaleEnabled && !autoUpscalePlan.canRun ? (
                    <span className="mt-1 block leading-4 text-amber-200">
                      {autoUpscalePlan.unavailableReason ?? 'Choose a configured upscaler in Settings.'}
                    </span>
                  ) : null}
                </span>
              </label> : null}

              {!builderCard ? <ImageModelSummary
                autoUpscale={autoUpscaleEnabled ? {
                  canRun: autoUpscalePlan.canRun,
                  costLabel: autoUpscalePlan.costLabel,
                  label: autoUpscalePlan.label,
                } : undefined}
                capabilityBadges={capabilityBadges}
                costRows={operationCostRows}
                fallbackCostLabel={controlModel.costEstimateLabel}
                showEndpointNote={hasControl('localEndpoint')}
              /> : null}
            </>
          ) : null}
        </>
      ) : (
        <label className={`${actionButtonClassName} justify-center cursor-pointer`}>
          <Upload size={12} />
          {data.sourceAssetName ? 'Replace Image' : 'Import Image'}
          <input
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleImport(event.target.files?.[0])}
            type="file"
          />
        </label>
      )}

      {isEditingMode && !isVideoFrameMode ? (
        canEditConnectedImage ? (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-100">
            An upstream image is connected as the editable base image. This node will modify that source image with the current prompt.
          </div>
        ) : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
            The selected provider/model is currently wired for text-to-image only in this app. Switch to a Gemini image model or GPT Image to edit the connected source image.
          </div>
        )
      ) : null}

      {hasReferenceConnections && !isVideoFrameMode ? (
        canUseReferenceGuidance ? (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-100">
            Reference images are connected. This model will use them as style, asset, character, or composition guidance rather than treating them as the editable base image.
          </div>
        ) : (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
            The selected model does not accept reference images. Switch to a reference-capable image model to use connected references.
          </div>
        )
      ) : null}

      {mediaMode === 'generate' && !isVideoFrameMode ? (
        <>
          {renderLayoutItem({ fieldId: builderCard?.fields.find((field) => field.semanticRole === 'source-image')?.id ?? 'sourceImage' }, (
            <ImageEditSourceSlot
              contract={portContract(editSourceHandleId)}
              disabledReason={canEditConnectedImage ? undefined : 'The selected model does not support image editing.'}
              imageUrl={editSourcePreviewUrl}
              isConnected={hasEditSourceConnection}
              showHandle={!builderCard}
            />
          ))}
          {renderLayoutItem({ fieldId: builderCard?.fields.find((field) => field.semanticRole === 'mask')?.id ?? 'mask' }, (
            <ImageMaskSlot
              canOpenPainter={canOpenMaskPainter && hasControl('mask')}
              contract={portContract(maskHandleId)}
              disabledReason={hasControl('mask') ? undefined : 'The selected model does not support mask inpainting.'}
              hasPaintedMask={hasPaintedMask}
              imageUrl={effectiveMaskPreviewUrl}
              isConnected={hasMaskConnection}
              onOpenPainter={() => setMaskPainterOpen(true)}
              showHandle={!builderCard}
            />
          ))}
          {renderLayoutItem({ fieldId: builderReferenceField?.id ?? 'referenceImages' }, (
            <div
              className="grid gap-2"
              data-image-reference-gallery="true"
              style={{ gridTemplateColumns: `repeat(${builderReferenceColumns}, minmax(0, 1fr))` }}
            >
              {references.map((reference, index) => {
                const supported = canUseReferenceGuidance
                  && index < controlModel.capabilities.maxReferenceImages;
                return (
                  <ImageReferenceSlot
                    contract={portContract(reference.handleId)}
                    disabledReason={supported ? undefined : canUseReferenceGuidance
                      ? `This model supports at most ${controlModel.capabilities.maxReferenceImages} reference images.`
                      : 'The selected model does not support reference images.'}
                    handleId={reference.handleId}
                    imageUrl={reference.imageUrl}
                    isConnected={reference.isConnected}
                    key={reference.handleId}
                    label={`Reference ${index + 1}`}
                    modelCardHandleId={builderHandlePlacements.find(({ handle }) =>
                      handle.fieldId === builderReferenceField?.id && handle.index === index
                    )?.handle.portId}
                    onSelectHandle={builderSelectHandle}
                    placement={builderHandlePlacements.find(({ handle }) =>
                      handle.fieldId === builderReferenceField?.id && handle.index === index
                    )?.placement}
                    previewHandle={isBuilderPreview}
                    side={index % 2 === 0 ? 'left' : 'right'}
                    tileHeight={builderReferenceTileHeight}
                  />
                );
              })}
            </div>
          ))}
        </>
      ) : null}

      {isVideoFrameMode && (hasEditSourceConnection || hasReferenceConnections) ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
          A video source is connected, so this node is currently in frame-extraction mode. Disconnect the upstream video if you want to use image editing or reference guidance instead.
        </div>
      ) : null}

      <ExecutionTelemetryPanel nodeId={id} usage={data.usage} />

      {renderLayoutItem(
        { outputId: builderCard?.outputs.find((output) => output.primary)?.id ?? 'image-output' },
        previewPanel,
      )}

      {importedAssetNamePanel}
      {assetUrl && isPreviewOpen ? (
        <MediaPreviewModal
          kind="image"
          label={data.sourceAssetName ?? data.modelId ?? 'Image'}
          onClose={() => setPreviewOpen(false)}
          src={assetUrl}
        />
      ) : null}
      {isMaskPainterOpen && maskPainterSourceUrl ? (
        <ImageMaskPainterDialog
          brushSize={maskBrushSize}
          initialMaskDataUrl={paintedMaskUrl}
          mode={maskPainterMode}
          onBrushSizeChange={(size) => data.onChange?.('imageMaskBrushSize', size)}
          onClose={() => setMaskPainterOpen(false)}
          onSave={(maskDataUrl) => {
            data.onChange?.('imagePaintedMaskDataUrl', maskDataUrl);
            data.onChange?.('imagePaintedMaskUpdatedAt', Date.now());
            setMaskPainterOpen(false);
          }}
          sourceImageUrl={maskPainterSourceUrl}
          detectorLabel={maskDetector?.label}
          onDetect={maskDetector && maskPainterSourceUrl ? async (phrase) => {
            configureDetectorKeys(settingsSnapshot);
            const { getDataUrlDimensions } = await import('../../lib/imageMask/maskConventions');
            const { width, height } = await getDataUrlDimensions(maskPainterSourceUrl);
            const detection = await maskDetector.detect({ sourceImageDataUrl: maskPainterSourceUrl, phrase, width, height });
            return detection.maskDataUrl;
          } : undefined}
        />
      ) : null}
    </BaseNode>
  );
}

export const ImageNode = memo(ImageNodeComponent);

interface ImageModelSummaryProps {
  autoUpscale?: {
    canRun: boolean;
    costLabel: string;
    label: string;
  };
  capabilityBadges: string[];
  costRows: ReturnType<typeof getImageNodeOperationCostRows>;
  fallbackCostLabel: string;
  showEndpointNote: boolean;
}

function ImageModelSummary({
  autoUpscale,
  capabilityBadges,
  costRows,
  fallbackCostLabel,
  showEndpointNote,
}: ImageModelSummaryProps) {
  return (
    <div className="space-y-2 rounded-lg border border-gray-700/50 bg-[#111217]/30 px-2.5 py-2 text-[10px] text-gray-400">
      <div>
        <div className="mb-1 font-semibold uppercase tracking-[0.14em] text-gray-500">Capabilities</div>
        {capabilityBadges.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {capabilityBadges.map((badge) => (
              <span
                className="rounded border border-gray-700/70 bg-[#0c1018] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-300"
                key={badge}
              >
                {badge}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-gray-500">Generation only</div>
        )}
      </div>
      <div>
        <div className="mb-1 font-semibold uppercase tracking-[0.14em] text-gray-500">Pre-run cost</div>
        {costRows.length > 0 ? (
          <div className="grid gap-1">
            {costRows.map((row) => (
              <div className="flex items-center justify-between gap-2" key={row.operation}>
                <span className="truncate text-gray-400">{row.label}</span>
                <span className="shrink-0 text-gray-200">{row.estimateLabel}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-gray-200">{fallbackCostLabel}</div>
        )}
        {autoUpscale ? (
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-gray-800/80 pt-1">
            <span className="truncate text-gray-400">Auto-upscale · {autoUpscale.label}</span>
            <span className={`shrink-0 ${autoUpscale.canRun ? 'text-cyan-100' : 'text-amber-200'}`}>
              {autoUpscale.canRun ? autoUpscale.costLabel : 'not configured'}
            </span>
          </div>
        ) : null}
      </div>
      {showEndpointNote ? (
        <div className="rounded border border-blue-500/20 bg-blue-500/10 px-2 py-1.5 text-[10px] leading-4 text-blue-100">
          Uses the Local/Open endpoint and auth header from Settings.
        </div>
      ) : null}
    </div>
  );
}

interface ModeButtonProps {
  active: boolean;
  label: string;
  onClick: () => void;
}

function ProductionLayoutItem({
  autoHeight,
  children,
  clipContent,
  element,
  freeform,
  handles,
  onMoveElement,
  onSelect,
  onSelectHandle,
  order,
  previewHandles,
  selected,
}: {
  autoHeight: boolean;
  children: ReactNode;
  clipContent: boolean;
  element: CardLayoutElementV1;
  freeform: boolean;
  handles: Array<{
    handle: ReturnType<typeof listModelCardLayoutHandles>[number];
    placement: CardHandlePlacementV1;
  }>;
  onMoveElement?: (elementId: string, targetContainerId: string, beforeElementId?: string) => void;
  onSelect?: (elementId: string) => void;
  onSelectHandle?: (handleId: string, elementId?: string) => void;
  order: number;
  previewHandles: boolean;
  selected: boolean;
}) {
  return (
    <div
      className={`group/model-card-element relative rounded-lg ${
        selected ? 'outline outline-2 outline-cyan-300/80 outline-offset-2' : ''
      }`}
      data-model-card-builder-element-id={element.id}
      onClickCapture={() => onSelect?.(element.id)}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const draggedId = event.dataTransfer.getData('application/x-sloom-model-card-element');
        if (draggedId && draggedId !== element.id) {
          onMoveElement?.(draggedId, element.containerId, element.id);
        }
      }}
      style={{
        display: element.hidden ? 'none' : undefined,
        height: autoHeight ? undefined : element.height,
        left: freeform ? element.x : undefined,
        minHeight: autoHeight ? undefined : element.height,
        order,
        position: freeform ? 'relative' : undefined,
        top: freeform ? element.y : undefined,
        width: element.width,
      }}
    >
      {clipContent ? (
        <div className="h-full w-full overflow-hidden rounded-[inherit]">{children}</div>
      ) : children}
      {handles.map(({ handle, placement }) => previewHandles ? (
        <button
          aria-label={`Edit ${handle.label} handle`}
          className={`nodrag nopan absolute z-40 h-5 w-5 rounded-full border-[3px] border-[#1e2027] ${
            handle.direction === 'input' ? 'bg-blue-500' : 'bg-violet-500'
          }`}
          data-production-handle-editor={handle.portId}
          key={handle.portId}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect?.(element.id);
            onSelectHandle?.(handle.portId, element.id);
          }}
          style={cardHandleEditorStyle(placement)}
          title={`${handle.label} · ${placement.side} ${placement.offsetPercent}%`}
          type="button"
        />
      ) : (
        <Handle
          className="nodrag nopan !z-40 !h-5 !w-5 !border-[3px] !border-[#1e2027]"
          data-production-handle-editor={handle.portId}
          id={handle.portId}
          key={handle.portId}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect?.(element.id);
            onSelectHandle?.(handle.portId, element.id);
          }}
          position={positionForCardHandleSide(placement.side)}
          style={cardHandleEditorStyle(placement)}
          title={`${handle.label} · ${placement.side} ${placement.offsetPercent}%`}
          type={handle.direction === 'input' ? 'target' : 'source'}
        />
      ))}
      {onMoveElement || onSelect ? <button
        aria-label={`Move ${element.id}`}
        className="nodrag nopan absolute right-1 top-1 z-30 hidden cursor-grab rounded border border-cyan-200/35 bg-[#06111b]/95 p-1 text-cyan-100 shadow-lg group-hover/model-card-element:block focus:block active:cursor-grabbing"
        draggable
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onSelect?.(element.id);
        }}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-sloom-model-card-element', element.id);
          onSelect?.(element.id);
        }}
        title="Drag this real Flow-card element"
        type="button"
      >
        <GripVertical size={13} />
      </button> : null}
    </div>
  );
}

function cardHandleEditorStyle(placement: CardHandlePlacementV1): CSSProperties {
  if (placement.side === 'top') {
    return { left: `${placement.offsetPercent}%`, top: 0, transform: 'translate(-50%, -50%)' };
  }
  if (placement.side === 'bottom') {
    return { bottom: 0, left: `${placement.offsetPercent}%`, transform: 'translate(-50%, 50%)' };
  }
  if (placement.side === 'right') {
    return { right: 0, top: `${placement.offsetPercent}%`, transform: 'translate(50%, -50%)' };
  }
  return { left: 0, top: `${placement.offsetPercent}%`, transform: 'translate(-50%, -50%)' };
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

interface EditSourcePreviewProps {
  contract?: FlowPortContract;
  disabledReason?: string;
  isConnected: boolean;
  imageUrl?: string;
  showHandle?: boolean;
}

function ImageEditSourceSlot({ contract, disabledReason, imageUrl, isConnected, showHandle = true }: EditSourcePreviewProps) {
  return (
    <div className="relative rounded-lg border border-gray-700/60 bg-[#111217]/35 p-2 pl-5">
      {showHandle ? <Handle
        contract={contract}
        id="image-edit-source"
        type="target"
        position={Position.Left}
        className={`nodrag nopan !left-0 !top-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-6 !h-6 !border-[3px] !border-[#1e2027] ${isConnected ? '!bg-emerald-500' : '!bg-blue-500'}`}
      /> : null}
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
        Source Image
      </div>
      {disabledReason ? (
        <div className="text-[10px] leading-4 text-amber-200/80">{disabledReason}</div>
      ) : (
        <ImagePreviewPane
          alt="Connected image edit source"
          fallbackAspectRatio="1:1"
          imageMaxHeightClassName="max-h-24"
          minHeightClassName="min-h-[5.5rem]"
          placeholder={(
            <div className="px-4 text-center text-[10px] text-gray-500">
              {isConnected
                ? 'An image source is wired. The preview appears after the upstream image is generated or imported.'
                : 'Connect the image you want this node to edit.'}
            </div>
          )}
          src={imageUrl}
        />
      )}
    </div>
  );
}

interface ImageMaskSlotProps extends EditSourcePreviewProps {
  canOpenPainter: boolean;
  hasPaintedMask: boolean;
  onOpenPainter: () => void;
}

function ImageMaskSlot({
  canOpenPainter,
  contract,
  disabledReason,
  hasPaintedMask,
  imageUrl,
  isConnected,
  onOpenPainter,
  showHandle = true,
}: ImageMaskSlotProps) {
  return (
    <div className="relative rounded-lg border border-gray-700/60 bg-[#111217]/35 p-2 pl-5">
      {showHandle ? <Handle
        contract={contract}
        id="image-mask"
        type="target"
        position={Position.Left}
        className={`nodrag nopan !left-0 !top-1/2 !-translate-x-1/2 !-translate-y-1/2 !w-6 !h-6 !border-[3px] !border-[#1e2027] ${isConnected ? '!bg-emerald-500' : '!bg-violet-500'}`}
      /> : null}
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
        Mask Image
      </div>
      {disabledReason ? (
        <div className="text-[10px] leading-4 text-amber-200/80">{disabledReason}</div>
      ) : <ImagePreviewPane
        alt="Connected image edit mask"
        fallbackAspectRatio="1:1"
        imageMaxHeightClassName="max-h-24"
        minHeightClassName="min-h-[5.5rem]"
        placeholder={(
          <div className="px-4 text-center text-[10px] text-gray-500">
            {isConnected
              ? 'A mask source is wired. White/opaque regions are submitted as the editable selection.'
              : hasPaintedMask
                ? 'Node-painted mask saved. White/opaque regions are submitted as the editable selection.'
                : 'Connect a black-and-white mask or paint one from the source image.'}
          </div>
        )}
        src={imageUrl}
      />}
      {!disabledReason ? <button
        className={`${actionButtonClassName} mt-2 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50`}
        disabled={!canOpenPainter}
        onClick={onOpenPainter}
        type="button"
      >
        <Maximize2 size={12} />
        Paint mask
      </button> : null}
      {isConnected && hasPaintedMask ? (
        <div className="mt-1 text-[9px] leading-3 text-gray-500">
          Connected mask overrides the saved painted mask.
        </div>
      ) : null}
    </div>
  );
}

interface ImageReferenceSlotProps {
  contract?: FlowPortContract;
  disabledReason?: string;
  handleId: string;
  imageUrl?: string;
  isConnected: boolean;
  label: string;
  modelCardHandleId?: string;
  onSelectHandle?: (handleId: string, elementId?: string) => void;
  placement?: CardHandlePlacementV1;
  previewHandle?: boolean;
  side: 'left' | 'right';
  tileHeight?: number;
}

function ImageReferenceSlot({
  contract,
  disabledReason,
  handleId,
  imageUrl,
  isConnected,
  label,
  modelCardHandleId,
  onSelectHandle,
  placement,
  previewHandle = false,
  side,
  tileHeight,
}: ImageReferenceSlotProps) {
  const resolvedSide = placement?.anchor === 'element' ? placement.side : side;
  const isLeft = resolvedSide === 'left';
  const isHorizontal = resolvedSide === 'left' || resolvedSide === 'right';
  const showSlotHandle = !modelCardHandleId || placement?.anchor === 'element';
  const handlePosition = positionForCardHandleSide(resolvedSide);
  const handleStyle = cardHandleStyle(placement, resolvedSide);
  const previewHeight = tileHeight === undefined ? undefined : Math.max(28, tileHeight - 38);
  return (
    <div
      className={`relative min-w-0 rounded-lg border border-gray-700/60 bg-[#111217]/35 p-2 ${
        showSlotHandle
          ? isHorizontal ? (isLeft ? 'pl-5' : 'pr-5') : resolvedSide === 'top' ? 'pt-5' : 'pb-5'
          : ''
      }`}
      data-image-reference-slot={label}
      data-reference-side={resolvedSide}
      style={tileHeight === undefined ? undefined : { minHeight: tileHeight }}
    >
      {showSlotHandle ? <span
        aria-hidden="true"
        className={`pointer-events-none absolute bg-blue-400/70 ${
          isHorizontal
            ? `top-1/2 h-px w-4 -translate-y-1/2 ${isLeft ? 'left-0' : 'right-0'}`
            : `left-1/2 h-4 w-px -translate-x-1/2 ${resolvedSide === 'top' ? 'top-0' : 'bottom-0'}`
        }`}
      /> : null}
      {showSlotHandle ? previewHandle && modelCardHandleId ? (
        <button
          aria-label={`Edit ${label} handle`}
          className={`nodrag nopan absolute z-40 h-6 w-6 rounded-full border-[3px] border-[#1e2027] ${
            isConnected ? 'bg-emerald-500' : 'bg-blue-500'
          }`}
          data-production-handle-editor={modelCardHandleId}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelectHandle?.(modelCardHandleId, placement?.elementId);
          }}
          style={handleStyle}
          type="button"
        />
      ) : (
        <Handle
          contract={contract}
          id={handleId}
          type="target"
          position={handlePosition}
          className={`nodrag nopan !w-6 !h-6 !border-[3px] !border-[#1e2027] ${isConnected ? '!bg-emerald-500' : '!bg-blue-500'}`}
          onClick={(event) => {
            if (!modelCardHandleId) return;
            event.preventDefault();
            event.stopPropagation();
            onSelectHandle?.(modelCardHandleId, placement?.elementId);
          }}
          style={handleStyle}
        />
      ) : null}
      <div className="mb-2 truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400" title={label}>{label}</div>
      {disabledReason ? (
        <div className="min-h-8 text-[9px] leading-3 text-amber-200/75">{disabledReason}</div>
      ) : <ImagePreviewPane
        alt={label}
        fallbackAspectRatio="1:1"
        fixedHeightPx={previewHeight}
        imageMaxHeightClassName="max-h-24"
        minHeightClassName="min-h-[5.5rem]"
        placeholder={<div className="px-2 text-center text-[9px] text-gray-500">Connect reference image</div>}
        src={imageUrl}
      />}
    </div>
  );
}

function positionForCardHandleSide(side: CardHandlePlacementV1['side']): Position {
  if (side === 'right') return Position.Right;
  if (side === 'top') return Position.Top;
  if (side === 'bottom') return Position.Bottom;
  return Position.Left;
}

function cardHandleStyle(
  placement: CardHandlePlacementV1 | undefined,
  side: CardHandlePlacementV1['side'],
): CSSProperties | undefined {
  if (!placement || placement.anchor !== 'element') return undefined;
  const offset = `${placement.offsetPercent}%`;
  if (side === 'top') return { left: offset, top: 0, transform: 'translate(-50%, -50%)' };
  if (side === 'bottom') return { bottom: 0, left: offset, top: 'auto', transform: 'translate(-50%, 50%)' };
  if (side === 'right') return { left: 'auto', right: 0, top: offset, transform: 'translate(50%, -50%)' };
  return { left: 0, top: offset, transform: 'translate(-50%, -50%)' };
}

function cardEdgeHandleStyle(placement: CardHandlePlacementV1): CSSProperties {
  const offset = `${placement.offsetPercent}%`;
  if (placement.side === 'top') return { left: offset, top: 0, transform: 'translate(-50%, -50%)' };
  if (placement.side === 'bottom') return { bottom: 0, left: offset, top: 'auto', transform: 'translate(-50%, 50%)' };
  if (placement.side === 'right') return { left: 'auto', right: 0, top: offset, transform: 'translate(50%, -50%)' };
  return { left: 0, top: offset, transform: 'translate(-50%, -50%)' };
}
