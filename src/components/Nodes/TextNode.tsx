import { memo, useState } from 'react';
import { FileText, Image as ImageIcon, Music2, Type, Video, X } from 'lucide-react';
import { AttemptHistory } from './AttemptHistory';
import { BaseNode } from './BaseNode';
import { ExecutionTelemetryPanel } from './ExecutionTelemetryPanel';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import {
  CAPABILITY_PROVIDERS,
  getConfiguredProviders,
  getModelOptions,
  getProviderLabel,
} from '../../lib/providerCatalog';
import {
  GEMINI_MEDIA_RESOLUTION_OPTIONS,
  GEMINI_THINKING_LEVEL_OPTIONS,
  TEXT_OUTPUT_FORMAT_OPTIONS,
  getDefaultGeminiTextMimeType,
  getGeminiTextMediaPrompt,
  isGeminiTextMediaInputSupported,
} from '../../lib/geminiTextModel';
import { useCatalogStore } from '../../store/catalogStore';
import { useFlowStore } from '../../store/flowStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useSourceBinStore } from '../../store/sourceBinStore';
import { useShallow } from 'zustand/react/shallow';
import { getGeneratedTextDisplay } from '../../lib/textNodeDisplay';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { assignVariableToResultAttempt } from '../../lib/flowVariables';
import { FlowVariableTextarea } from './FlowVariableTextarea';
import { getTextModelContract } from '../../lib/modelContracts/textModelContracts';
import { getModelUiControls, type ModelModality } from '../../lib/providerModelContracts';
import type {
  AppNodeProps,
  EditorSourceKind,
  GeminiMediaResolution,
  GeminiThinkingLevel,
  TextNodeMode,
  TextOutputFormat,
  TextProvider,
} from '../../types/flow';

const selectClassName = withFlowNodeInteractionClasses(
  'w-full bg-[#111217]/50 text-gray-200 border border-gray-700/60 rounded-lg p-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none shadow-inner',
);

const promptTextAreaClassName = withFlowNodeInteractionClasses(
  'w-full bg-[#111217]/50 text-gray-200 border border-gray-700/60 rounded-lg p-2 pr-9 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-28 shadow-inner',
);

const instructionTextAreaClassName = withFlowNodeInteractionClasses(
  'w-full bg-[#111217]/50 text-gray-200 border border-gray-700/60 rounded-lg p-2 pr-9 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-20 shadow-inner',
);

const systemPromptTextAreaClassName = withFlowNodeInteractionClasses(
  'w-full bg-[#111217]/30 text-gray-300 border border-gray-800 rounded-lg p-2 pr-9 text-xs focus:ring-2 focus:ring-blue-500 outline-none resize-none h-16 shadow-inner',
);

const iconButtonClassName = withFlowNodeInteractionClasses(
  'rounded-md border border-gray-700/60 bg-[#111217]/60 p-1 text-gray-300 transition-colors hover:border-gray-500 hover:text-white',
);

function TextNodeComponent({ id, data }: AppNodeProps) {
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const providerSettings = useSettingsStore((state) => state.providerSettings);
  const defaultModels = useSettingsStore((state) => state.defaultModels.text);
  const modelCatalog = useCatalogStore((state) => state.modelCatalog);
  const sourceBinItems = useSourceBinStore(useShallow((state) => state.bins.flatMap((bin) => bin.items)));
  const mode = (data.mode ?? 'prompt') as TextNodeMode;
  const availableProviders = getConfiguredProviders('text', apiKeys, providerSettings);
  const provider = ((data.provider as TextProvider | undefined) ?? 'gemini') as TextProvider;
  const providerConfigured = availableProviders.includes(provider);
  const selectedModelId = data.modelId ?? defaultModels[provider];
  const modelContract = getTextModelContract(provider, selectedModelId);
  const modelControls = getModelUiControls(modelContract, 'text-generation', [
    { id: 'thinkingLevel', label: 'Thinking level' },
    { id: 'mediaResolution', label: 'Media resolution' },
    { id: 'outputFormat', label: 'Output format' },
    { id: 'googleSearch', label: 'Google Search' },
    { id: 'codeExecution', label: 'Code execution' },
  ]);
  const thinkingControl = modelControls.find((control) => control.id === 'thinkingLevel')!;
  const mediaResolutionControl = modelControls.find((control) => control.id === 'mediaResolution')!;
  const outputFormatControl = modelControls.find((control) => control.id === 'outputFormat')!;
  const searchControl = modelControls.find((control) => control.id === 'googleSearch')!;
  const codeExecutionControl = modelControls.find((control) => control.id === 'codeExecution')!;
  const lifecycleWarning = modelContract.lifecycle === 'preview'
    ? `${modelContract.displayName} is a preview model; availability and behavior can change.`
    : modelContract.lifecycle === 'unverified'
      ? `${modelContract.displayName} has no curated capability contract; only safe text input is enabled.`
      : modelContract.lifecycle === 'deprecated'
        ? `${modelContract.displayName} is deprecated.${modelContract.migrationModelId ? ` Migrate to ${modelContract.migrationModelId}.` : ''}`
        : modelContract.lifecycle === 'shutdown'
          ? `${modelContract.displayName} is shut down and retained only for saved-flow diagnostics.${modelContract.migrationModelId ? ` Choose ${modelContract.migrationModelId} to run.` : ''}`
          : undefined;
  const runDisabledReason = !providerConfigured
    ? `Configure ${getProviderLabel(provider)} in Settings before running this node.`
    : modelContract.availability === 'unavailable'
    ? `${modelContract.displayName} is unavailable and cannot run.`
    : undefined;
  const thinkingOptions = thinkingControl.parameter?.options ?? GEMINI_THINKING_LEVEL_OPTIONS;
  const mediaResolutionOptions = mediaResolutionControl.parameter?.options ?? GEMINI_MEDIA_RESOLUTION_OPTIONS;
  const outputFormatOptions = outputFormatControl.parameter?.options ?? TEXT_OUTPUT_FORMAT_OPTIONS;
  const selectedThinkingLevel = optionValueOrDefault(
    thinkingOptions,
    data.geminiThinkingLevel,
    'default',
  ) as GeminiThinkingLevel;
  const selectedMediaResolution = optionValueOrDefault(
    mediaResolutionOptions,
    data.geminiMediaResolution,
    'default',
  ) as GeminiMediaResolution;
  const selectedOutputFormat = optionValueOrDefault(
    outputFormatOptions,
    data.textOutputFormat,
    'plain',
  ) as TextOutputFormat;
  const mediaInputDescription = describeTextMediaInputs(modelContract.inputModalities);
  const supportsMediaInput = modelContract.inputModalities.some(
    (modality) => ['image', 'video', 'audio', 'pdf'].includes(modality),
  );
  const isCollapsed = Boolean(data.collapsed);
  const generatedTextDisplay = getGeneratedTextDisplay(data.result);
  const [isMediaDropActive, setMediaDropActive] = useState(false);
  const directMediaItem = sourceBinItems.find((item) => item.id === data.textVisionSourceItemId
    && isTextMediaKindSupported(item.kind, item.mimeType, modelContract.inputModalities)
    && isGeminiTextMediaInputSupported({
      kind: item.kind,
      mimeType: item.mimeType ?? getDefaultGeminiTextMimeType(item.kind),
    }));
  const connectedMediaInputCount = useFlowStore((state) =>
    state.edges.reduce((count, edge) => {
      if (edge.target !== id) return count;
      const sourceNode = state.nodes.find((node) => node.id === edge.source);
      return sourceNode && ['imageGen', 'cropImageNode', 'audioGen', 'videoGen', 'composition'].includes(sourceNode.type)
        ? count + 1
        : count;
    }, 0),
  );

  const handleModeChange = (nextMode: TextNodeMode) => {
    data.onChange?.('mode', nextMode);

    if (nextMode === 'generate') {
      data.onChange?.('provider', provider);
      data.onChange?.('modelId', data.modelId ?? defaultModels[provider]);
    }
  };

  const handleProviderChange = (nextProvider: TextProvider) => {
    data.onChange?.('provider', nextProvider);
    data.onChange?.('modelId', defaultModels[nextProvider]);
  };

  const modelOptions = getModelOptions(
    'text',
    provider,
    modelCatalog,
    selectedModelId,
  );
  const assignAttemptVariable = (attemptId: string, variableName: string) => {
    data.onChange?.('resultHistory', assignVariableToResultAttempt(data.resultHistory, attemptId, variableName));
  };

  const handleMediaSourceDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const rawPayload = event.dataTransfer.getData('application/x-flow-source-bin-item');

    if (!rawPayload) {
      return;
    }

    try {
      const { itemId } = JSON.parse(rawPayload) as { itemId?: string };
      const item = sourceBinItems.find((candidate) => candidate.id === itemId);

      if (!item || !item.assetUrl
        || !isTextMediaKindSupported(item.kind, item.mimeType, modelContract.inputModalities)
        || !isGeminiTextMediaInputSupported({
        kind: item.kind,
        mimeType: item.mimeType ?? getDefaultGeminiTextMimeType(item.kind),
      })) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setMediaDropActive(false);

      if (mode === 'prompt') {
        handleModeChange('generate');
      }

      data.onChange?.('textVisionSourceItemId', item.id);

      if (!(data.prompt ?? '').trim()) {
        data.onChange?.('prompt', getGeminiTextMediaPrompt(item.kind));
      }
    } catch {
      setMediaDropActive(false);
    }
  };

  return (
    <BaseNode
      nodeId={id}
      icon={Type}
      nodeType="textNode"
      title={mode === 'prompt' ? 'Prompt Input' : 'Text Generation'}
      hasInput={mode === 'generate'}
      outputActions={getCompatibleNodeActions('textNode')}
      onRun={mode === 'generate' ? data.onRun : undefined}
      runDisabledReason={mode === 'generate' ? runDisabledReason : undefined}
      isRunning={data.isRunning}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
      collapsedContent={
        mode === 'generate' ? (
          <GeneratedTextResultPanel compact text={generatedTextDisplay} />
        ) : undefined
      }
      containerClassName={mode === 'generate' && isCollapsed ? 'w-[300px]' : undefined}
      isCollapsed={mode === 'generate' ? isCollapsed : false}
      onToggleCollapsed={
        mode === 'generate'
          ? () => data.onChange?.('collapsed', !isCollapsed)
          : undefined
      }
    >
      {mode === 'generate' ? (
        <AttemptHistory
          attempts={data.resultHistory}
          onAssignVariable={assignAttemptVariable}
          onSelectAttempt={data.onSelectAttempt}
          selectedAttemptId={data.selectedResultId}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <ModeButton
          active={mode === 'prompt'}
          label="Prompt"
          onClick={() => handleModeChange('prompt')}
        />
        <ModeButton
          active={mode === 'generate'}
          label="Model"
          onClick={() => handleModeChange('generate')}
        />
      </div>

      {mode === 'prompt' ? (
        <FlowVariableTextarea
          placeholder="Enter the source prompt for downstream nodes..."
          className={promptTextAreaClassName}
          expandedTitle="Prompt Editor"
          onChange={(value) => data.onChange?.('prompt', value)}
          value={String(data.prompt ?? '')}
        />
      ) : (
        <>
          <>
              <select
                className={selectClassName}
                onChange={(event) => handleProviderChange(event.target.value as TextProvider)}
                value={provider}
              >
                {CAPABILITY_PROVIDERS.text.map((option) => (
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

              {lifecycleWarning ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-100">
                  {lifecycleWarning}
                </div>
              ) : null}

              {provider === 'gemini' ? (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className={controlClassName(thinkingControl.enabled)}
                    disabled={!thinkingControl.enabled}
                    title={thinkingControl.disabledReason}
                    onChange={(event) => data.onChange?.('geminiThinkingLevel', event.target.value as GeminiThinkingLevel)}
                    value={selectedThinkingLevel}
                  >
                    {thinkingOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className={controlClassName(mediaResolutionControl.enabled)}
                    disabled={!mediaResolutionControl.enabled}
                    title={mediaResolutionControl.disabledReason}
                    onChange={(event) => data.onChange?.('geminiMediaResolution', event.target.value as GeminiMediaResolution)}
                    value={selectedMediaResolution}
                  >
                    {mediaResolutionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className={controlClassName(outputFormatControl.enabled)}
                    disabled={!outputFormatControl.enabled}
                    title={outputFormatControl.disabledReason}
                    onChange={(event) => data.onChange?.('textOutputFormat', event.target.value as TextOutputFormat)}
                    value={selectedOutputFormat}
                  >
                    {outputFormatOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <label
                    className={controlLabelClassName(searchControl.enabled)}
                    title={searchControl.disabledReason}
                  >
                    <input
                      checked={Boolean(data.geminiGoogleSearchEnabled)}
                      className="h-3.5 w-3.5 accent-blue-500"
                      disabled={!searchControl.enabled}
                      onChange={(event) => data.onChange?.('geminiGoogleSearchEnabled', event.target.checked)}
                      type="checkbox"
                    />
                    Search
                  </label>
                  <label
                    className={`${controlLabelClassName(codeExecutionControl.enabled)} col-span-2`}
                    title={codeExecutionControl.disabledReason}
                  >
                    <input
                      checked={Boolean(data.geminiCodeExecutionEnabled)}
                      className="h-3.5 w-3.5 accent-blue-500"
                      disabled={!codeExecutionControl.enabled}
                      onChange={(event) => data.onChange?.('geminiCodeExecutionEnabled', event.target.checked)}
                      type="checkbox"
                    />
                    Code execution
                  </label>
                  {modelControls.some((control) => !control.enabled) ? (
                    <div className="col-span-2 rounded-lg border border-gray-700/60 bg-[#111217]/30 px-2.5 py-2 text-[10px] leading-4 text-gray-400">
                      {modelControls
                        .filter((control) => !control.enabled)
                        .map((control) => control.disabledReason)
                        .filter((reason): reason is string => Boolean(reason))
                        .join(' ')}
                    </div>
                  ) : null}
                </div>
              ) : null}
          </>

          <FlowVariableTextarea
            placeholder="Instruction for the model..."
            className={instructionTextAreaClassName}
            expandedTitle="Instruction Editor"
            onChange={(value) => data.onChange?.('prompt', value)}
            value={String(data.prompt ?? '')}
          />

          <div
            className={withFlowNodeInteractionClasses(`rounded-lg border border-dashed px-2.5 py-2 text-[11px] transition-colors ${
              isMediaDropActive
                ? 'border-blue-400/70 bg-blue-500/12 text-blue-100'
                : supportsMediaInput
                  ? 'border-gray-700/60 bg-[#111217]/25 text-gray-400'
                  : 'border-gray-800/60 bg-[#111217]/15 text-gray-600 opacity-70'
            }`)}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes('application/x-flow-source-bin-item')) {
                event.preventDefault();
                setMediaDropActive(true);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setMediaDropActive(false);
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes('application/x-flow-source-bin-item')) {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={handleMediaSourceDrop}
            title={supportsMediaInput ? undefined : `${modelContract.displayName} accepts text only on this route.`}
          >
            <div className="flex items-center gap-2 text-gray-200">
              <MediaKindIcon kind={directMediaItem?.kind} />
              <span className="font-semibold">Media Context</span>
            </div>
            <div className="mt-1 text-[11px] leading-5 text-gray-400">
              {mediaInputDescription}
            </div>
            {directMediaItem ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-gray-700/60 bg-[#0f131b] p-2">
                {directMediaItem.kind === 'image' && directMediaItem.assetUrl ? (
                  <img
                    alt={directMediaItem.label}
                    className="h-10 w-14 rounded object-cover"
                    src={directMediaItem.assetUrl}
                  />
                ) : (
                  <div className="flex h-10 w-14 items-center justify-center rounded bg-[#0b0d13] text-blue-200">
                    <MediaKindIcon kind={directMediaItem.kind} size={14} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-semibold text-gray-100">{directMediaItem.label}</div>
                  <div className="text-[10px] uppercase tracking-[0.16em] text-gray-500">
                    Dropped {formatMediaKind(directMediaItem.kind)}
                  </div>
                </div>
                <button
                  className={iconButtonClassName}
                  onClick={() => data.onChange?.('textVisionSourceItemId', undefined)}
                  type="button"
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            {connectedMediaInputCount > 0 ? (
              <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-100">
                {connectedMediaInputCount} connected media input{connectedMediaInputCount === 1 ? '' : 's'} will be included at run time.
              </div>
            ) : null}
          </div>

          <FlowVariableTextarea
            placeholder="Optional system prompt..."
            className={systemPromptTextAreaClassName}
            expandedTitle="System Prompt Editor"
            onChange={(value) => data.onChange?.('systemPrompt', value)}
            value={String(data.systemPrompt ?? '')}
          />

          <ExecutionTelemetryPanel nodeId={id} usage={data.usage} />

          <GeneratedTextResultPanel text={generatedTextDisplay} />
        </>
      )}
    </BaseNode>
  );
}

export const TextNode = memo(TextNodeComponent);

function controlClassName(enabled: boolean): string {
  return `${selectClassName}${enabled ? '' : ' cursor-not-allowed opacity-50'}`;
}

function controlLabelClassName(enabled: boolean): string {
  return withFlowNodeInteractionClasses(`flex min-h-9 items-center gap-2 rounded-lg border border-gray-700/60 bg-[#111217]/40 px-2 text-[11px] font-semibold ${
    enabled ? 'text-gray-300' : 'cursor-not-allowed text-gray-600 opacity-60'
  }`);
}

function optionValueOrDefault(
  options: readonly { value: string }[],
  value: string | undefined,
  fallback: string,
): string {
  return value && options.some((option) => option.value === value) ? value : fallback;
}

function isTextMediaKindSupported(
  kind: EditorSourceKind,
  _mimeType: string | undefined,
  modalities: readonly ModelModality[],
): boolean {
  switch (kind) {
    case 'image':
      return modalities.includes('image');
    case 'video':
    case 'composition':
      return modalities.includes('video');
    case 'audio':
      return modalities.includes('audio');
    case 'document':
    case 'subtitle':
    case 'text':
      return modalities.includes('pdf');
    case 'package':
      return false;
  }
}

function describeTextMediaInputs(modalities: readonly ModelModality[]): string {
  const labels = [
    ...(modalities.includes('image') ? ['images'] : []),
    ...(modalities.includes('audio') ? ['audio'] : []),
    ...(modalities.includes('video') ? ['video'] : []),
    ...(modalities.includes('pdf') ? ['PDF or text documents'] : []),
  ];

  if (labels.length === 0) {
    return 'This model accepts text only on the configured Flow route; media drops are blocked.';
  }

  return `Drop ${labels.join(', ')} for ${labels.length === 1 ? 'context' : 'multimodal context'}. Unsupported source types remain blocked.`;
}

function MediaKindIcon({
  kind,
  size = 12,
}: {
  kind?: EditorSourceKind;
  size?: number;
}) {
  if (kind === 'audio') {
    return <Music2 size={size} />;
  }

  if (kind === 'video' || kind === 'composition') {
    return <Video size={size} />;
  }

  if (kind === 'document' || kind === 'subtitle' || kind === 'package') {
    return <FileText size={size} />;
  }

  return <ImageIcon size={size} />;
}

function formatMediaKind(kind: EditorSourceKind): string {
  switch (kind) {
    case 'composition':
      return 'video';
    case 'subtitle':
      return 'document';
    default:
      return kind;
  }
}

function GeneratedTextResultPanel({
  compact = false,
  text,
}: {
  compact?: boolean;
  text: string;
}) {
  return (
    <div
      className={withFlowNodeInteractionClasses(`rounded-lg border border-gray-700/60 bg-[#111217]/30 p-2 text-xs leading-5 text-gray-300 whitespace-pre-wrap ${
        compact
          ? 'max-h-36 min-h-24 overflow-y-auto overscroll-contain pr-2'
          : 'max-h-72 min-h-20 overflow-y-auto overscroll-contain pr-2'
      }`)}
    >
      {text}
    </div>
  );
}

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
