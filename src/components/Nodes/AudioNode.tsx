import { memo, useEffect } from 'react';
import { Download, Music, Upload } from 'lucide-react';
import { AttemptHistory } from './AttemptHistory';
import { BaseNode } from './BaseNode';
import { ExecutionTelemetryPanel } from './ExecutionTelemetryPanel';
import { MediaLoadingOverlay } from './MediaLoadingOverlay';
import { useLiveNodeResultAssetUrl } from './useLiveNodeResultAssetUrl';
import { saveImportedAsset } from '../../lib/assetStore';
import { buildDownloadFilename, downloadAsset } from '../../lib/downloadAsset';
import { EXPORT_BASENAME } from '../../lib/brand';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { assignVariableToResultAttempt } from '../../lib/flowVariables';
import { resultValueAsMediaUrl } from '../../lib/flowResultValues';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import {
  describeAudioModelCompatibility,
  getAudioModelContract,
  getAudioModelSupport,
} from '../../lib/modelContracts/audioModelContracts';
import {
  AUDIO_OUTPUT_FORMAT_OPTIONS,
  CAPABILITY_PROVIDERS,
  ensureVoiceOption,
  getConfiguredProviders,
  getModelOptions,
  getProviderLabel,
} from '../../lib/providerCatalog';
import { useCatalogStore } from '../../store/catalogStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { AppNodeProps, AudioGenerationMode, AudioProvider, MediaNodeMode } from '../../types/flow';

const selectClassName = withFlowNodeInteractionClasses(
  'w-full bg-[#111217]/50 text-gray-200 border border-gray-700/60 rounded-lg p-2 text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none shadow-inner',
);

const textAreaClassName = `${selectClassName} min-h-[84px] resize-y`;

const actionButtonClassName = withFlowNodeInteractionClasses(
  'inline-flex items-center gap-1 rounded-lg border border-gray-700/60 bg-[#111217]/40 px-2.5 py-1.5 text-[11px] font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white',
);

const GEMINI_VOICE_OPTIONS = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
].map((voiceName) => ({ value: voiceName, label: voiceName }));

const AUDIO_MODE_OPTIONS: Array<{ value: AudioGenerationMode; label: string }> = [
  { value: 'speech', label: 'Speech' },
  { value: 'soundEffect', label: 'SFX' },
  { value: 'voiceChange', label: 'Voice' },
  { value: 'music', label: 'Music' },
];

const VOICE_SETTING_INPUTS: Array<{
  field: 'audioStability' | 'audioSimilarityBoost' | 'audioStyleExaggeration' | 'audioSpeed';
  label: string;
  title: string;
  min: number;
  max: number;
}> = [
  { field: 'audioStability', label: 'Stability 0–1', title: 'Lower = broader emotional range, higher = steadier delivery', min: 0, max: 1 },
  { field: 'audioSimilarityBoost', label: 'Similarity 0–1', title: 'How closely the output sticks to the original voice', min: 0, max: 1 },
  { field: 'audioStyleExaggeration', label: 'Style 0–1', title: 'Style exaggeration; high values can reduce stability', min: 0, max: 1 },
  { field: 'audioSpeed', label: 'Speed 0.7–1.2', title: 'Playback speed of the generated speech', min: 0.7, max: 1.2 },
];

function AudioNodeComponent({ id, data }: AppNodeProps) {
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const providerSettings = useSettingsStore((state) => state.providerSettings);
  const defaultModels = useSettingsStore((state) => state.defaultModels.audio);
  const defaultVoiceId = useSettingsStore((state) => state.providerSettings.elevenlabsVoiceId);
  const modelCatalog = useCatalogStore((state) => state.modelCatalog);
  const elevenLabsVoices = useCatalogStore((state) => state.elevenLabsVoices);
  const mediaMode = (data.mediaMode ?? 'generate') as MediaNodeMode;
  const isCollapsed = Boolean(data.collapsed);
  const availableProviders = getConfiguredProviders('audio', apiKeys, providerSettings);
  const provider = ((data.provider as AudioProvider | undefined) ?? 'elevenlabs') as AudioProvider;
  const providerConfigured = availableProviders.includes(provider);
  const audioMode = ((data.audioGenerationMode as AudioGenerationMode | undefined) ?? 'speech') as AudioGenerationMode;
  // The store-owned `blob:` URL cached in `data.result` is revoked on rehydration, leaving a dead
  // preview; resolve the source-bin item's live URL instead (see useLiveNodeResultAssetUrl).
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
  const assetMimeType =
    mediaMode === 'import'
      ? data.sourceAssetMimeType
      : provider === 'gemini'
        ? 'audio/wav'
        : (data.audioOutputFormat ?? 'mp3_44100_128').startsWith('pcm')
          ? 'audio/wav'
          : 'audio/mpeg';

  useEffect(() => {
    if (provider !== 'elevenlabs' || audioMode === 'soundEffect' || audioMode === 'music' || data.voiceId) {
      return;
    }

    const availableVoiceId = data.voiceId ?? defaultVoiceId ?? elevenLabsVoices[0]?.value;

    if (availableVoiceId) {
      data.onChange?.('voiceId', availableVoiceId);
    }
  }, [audioMode, data, defaultVoiceId, elevenLabsVoices, provider]);

  useEffect(() => {
    if (provider !== 'gemini' || data.geminiVoiceName) {
      return;
    }

    data.onChange?.('geminiVoiceName', GEMINI_VOICE_OPTIONS[0]?.value ?? 'Kore');
  }, [data, provider]);

  const allModelOptions = getModelOptions(
    'audio',
    provider,
    modelCatalog,
    data.modelId ?? defaultModels[provider],
  );
  const modelOptions = allModelOptions;
  const selectedModelId = data.modelId ?? defaultModels[provider];
  const modelContract = getAudioModelContract(provider, selectedModelId);
  const modelSupport = getAudioModelSupport(provider, selectedModelId, audioMode);
  const compatibilityWarning = describeAudioModelCompatibility(provider, selectedModelId, audioMode);
  const runDisabledReason = !providerConfigured
    ? `Configure ${getProviderLabel(provider)} in Settings before running this node.`
    : modelContract.availability === 'unavailable'
      ? `${modelContract.displayName} is unavailable and cannot run.`
      : compatibilityWarning;
  const selectedVoiceId = data.voiceId ?? defaultVoiceId ?? elevenLabsVoices[0]?.value ?? '';
  const voiceOptions = ensureVoiceOption(elevenLabsVoices, selectedVoiceId);

  const handleModeChange = (nextMode: MediaNodeMode) => {
    data.onChange?.('mediaMode', nextMode);
    data.onChange?.('error', undefined);
    data.onChange?.('statusMessage', nextMode === 'import' ? 'Choose an audio file from your device.' : undefined);

    if (nextMode === 'import') {
      data.onChange?.('result', undefined);
      return;
    }

    data.onChange?.('provider', provider);
    data.onChange?.('modelId', data.modelId ?? defaultModels[provider]);
  };

  const handleProviderChange = (nextProvider: AudioProvider) => {
    data.onChange?.('provider', nextProvider);

    if (nextProvider !== 'elevenlabs') {
      data.onChange?.('audioGenerationMode', 'speech');
    }

    data.onChange?.('modelId', defaultModels[nextProvider]);
  };

  const handleAudioGenerationModeChange = (nextMode: AudioGenerationMode) => {
    data.onChange?.('audioGenerationMode', nextMode);
    data.onChange?.('error', undefined);
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
      data.onChange?.('error', error instanceof Error ? error.message : 'Audio import failed.');
    }
  };

  const handleDownload = async () => {
    if (!assetUrl) {
      return;
    }

    await downloadAsset(
      assetUrl,
      buildDownloadFilename(data.sourceAssetName ?? `${EXPORT_BASENAME}-audio`, assetMimeType, provider === 'gemini' ? 'wav' : 'mp3'),
    );
  };

  const previewPanel = (
    <div className="relative group mt-1">
      {assetUrl ? (
        <div className="rounded-lg overflow-hidden border border-gray-700/60 h-16 shadow-inner bg-black flex items-center justify-center p-2">
          <audio
            src={assetUrl}
            controls={!data.isRunning}
            className={`w-full h-full ${data.isRunning ? 'pointer-events-none opacity-40' : ''}`}
          />
        </div>
      ) : (
        <div className="w-full h-20 bg-[#111217]/30 border border-gray-700/60 border-dashed rounded-lg flex flex-col items-center justify-center text-gray-500 shadow-inner">
          <Music size={24} className="mb-2 opacity-50" />
          <span className="text-[11px] font-medium tracking-wide">
            {mediaMode === 'import'
              ? 'Import a local audio file'
              : provider === 'elevenlabs' && audioMode === 'voiceChange'
                ? 'Run with upstream audio'
                : 'Run with an upstream prompt'}
          </span>
        </div>
      )}

      {data.isRunning ? (
        <MediaLoadingOverlay
          detail="Audio playback is disabled until the provider finishes synthesizing the clip."
          title="Generating audio"
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
      icon={Music}
      nodeType="audioGen"
      isCollapsed={isCollapsed}
      title={mediaMode === 'import' ? 'Audio Asset' : 'Audio Generation'}
      outputActions={getCompatibleNodeActions('audioGen')}
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
                onChange={(event) => handleProviderChange(event.target.value as AudioProvider)}
                value={provider}
              >
                {CAPABILITY_PROVIDERS.audio.map((option) => (
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

              {provider === 'elevenlabs' ? (
                <div className="grid grid-cols-4 gap-2">
                  {AUDIO_MODE_OPTIONS.map((option) => (
                    <ModeButton
                      key={option.value}
                      active={audioMode === option.value}
                      label={option.label}
                      onClick={() => handleAudioGenerationModeChange(option.value)}
                    />
                  ))}
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

              {compatibilityWarning ? (
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
                  {compatibilityWarning} Choose a compatible model or mode before running; the selection is preserved so saved and live catalog entries are never silently replaced.
                </div>
              ) : null}

              {modelContract.lifecycle !== 'stable' ? (
                <div className="rounded-lg border border-gray-600/60 bg-[#111217]/35 px-2.5 py-2 text-[11px] text-gray-300">
                  {modelContract.lifecycle === 'preview'
                    ? `${modelContract.displayName} is a preview model and its availability or schema may change.`
                    : modelContract.lifecycle === 'unverified'
                      ? `${modelContract.displayName} came from a live/saved catalog entry without a curated capability contract; only its safe base operation is enabled.`
                      : `${modelContract.displayName} is ${modelContract.lifecycle}.`}
                </div>
              ) : null}
          </>

          <fieldset
            className={!modelSupport.operationSupported ? 'space-y-2 opacity-55' : 'contents'}
            disabled={!modelSupport.operationSupported}
          >
          {provider === 'gemini' ? (
            <>
              <select
                className={selectClassName}
                onChange={(event) => data.onChange?.('geminiVoiceName', event.target.value)}
                value={(data.geminiVoiceName as string | undefined) ?? 'Kore'}
              >
                {GEMINI_VOICE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <textarea
                className={textAreaClassName}
                onChange={(event) => data.onChange?.('audioStyleDescription', event.target.value)}
                placeholder="Style / accent directions, e.g. warm London radio host, fast pace, bright and excited delivery"
                rows={4}
                value={(data.audioStyleDescription as string | undefined) ?? ''}
              />

              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-100">
                Gemini TTS uses the upstream prompt as the spoken transcript. Use the field above for accent, style,
                pacing, or delivery notes. Inline tags like `[whispers]` can stay in the transcript itself. Output is
                exported as WAV at 24kHz mono PCM.
              </div>
            </>
          ) : null}

          {provider === 'elevenlabs' && audioMode !== 'soundEffect' && audioMode !== 'music' ? (
            <select
              className={selectClassName}
              onChange={(event) => data.onChange?.('voiceId', event.target.value)}
              value={selectedVoiceId}
            >
              {voiceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.category ? ` · ${option.category}` : ''}
                </option>
              ))}
            </select>
          ) : null}

          {provider === 'elevenlabs' ? (
            <>
              {audioMode === 'speech' ? (
                <>
                  <select
                    className={selectClassName}
                    onChange={(event) => data.onChange?.('audioOutputFormat', event.target.value)}
                    value={data.audioOutputFormat ?? 'mp3_44100_128'}
                  >
                    {AUDIO_OUTPUT_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <div className="space-y-1.5 rounded-md border border-gray-700/50 p-2">
                    <span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      Voice settings (blank = voice default)
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {VOICE_SETTING_INPUTS.map((setting) => (
                        <input
                          key={setting.field}
                          aria-label={setting.label}
                          className={selectClassName}
                          inputMode="decimal"
                          max={setting.max}
                          min={setting.min}
                          onChange={(event) =>
                            data.onChange?.(
                              setting.field,
                              event.target.value.trim() ? Number(event.target.value) : undefined,
                            )
                          }
                          placeholder={setting.label}
                          step={0.05}
                          title={setting.title}
                          type="number"
                          value={(data[setting.field] as number | undefined) ?? ''}
                        />
                      ))}
                    </div>
                    <input
                      aria-label="Seed"
                      className={selectClassName}
                      inputMode="numeric"
                      min={0}
                      onChange={(event) =>
                        data.onChange?.(
                          'audioSeed',
                          event.target.value.trim() ? Number(event.target.value) : undefined,
                        )
                      }
                      placeholder="Seed (repeatable takes)"
                      type="number"
                      value={data.audioSeed ?? ''}
                    />
                  </div>
                </>
              ) : null}

              {audioMode === 'soundEffect' ? (
                <>
                  <select
                    className={selectClassName}
                    onChange={(event) => data.onChange?.('audioOutputFormat', event.target.value)}
                    value={data.audioOutputFormat ?? 'mp3_44100_128'}
                  >
                    {AUDIO_OUTPUT_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className={selectClassName}
                      inputMode="decimal"
                      onChange={(event) =>
                        data.onChange?.(
                          'audioDurationSeconds',
                          event.target.value.trim() ? Number(event.target.value) : undefined,
                        )
                      }
                      placeholder="Duration seconds"
                      type="number"
                      value={data.audioDurationSeconds ?? ''}
                    />
                    <input
                      className={selectClassName}
                      inputMode="decimal"
                      max="1"
                      min="0"
                      onChange={(event) =>
                        data.onChange?.(
                          'audioPromptInfluence',
                          event.target.value.trim() ? Number(event.target.value) : undefined,
                        )
                      }
                      placeholder="Prompt influence"
                      step="0.1"
                      type="number"
                      value={data.audioPromptInfluence ?? 0.3}
                    />
                  </div>

                  <label className={withFlowNodeInteractionClasses('flex items-center gap-2 rounded-lg border border-gray-700/60 bg-[#111217]/25 px-2.5 py-2 text-[11px] text-gray-300')}>
                    <input
                      checked={Boolean(data.audioLoop)}
                      className={withFlowNodeInteractionClasses()}
                      onChange={(event) => data.onChange?.('audioLoop', event.target.checked)}
                      type="checkbox"
                    />
                    Seamless looping
                  </label>
                </>
              ) : null}

              {audioMode === 'voiceChange' ? (
                <>
                  <select
                    className={selectClassName}
                    onChange={(event) => data.onChange?.('audioOutputFormat', event.target.value)}
                    value={data.audioOutputFormat ?? 'mp3_44100_128'}
                  >
                    {AUDIO_OUTPUT_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <input
                    className={selectClassName}
                    inputMode="numeric"
                    onChange={(event) =>
                      data.onChange?.(
                        'audioSeed',
                        event.target.value.trim() ? Number(event.target.value) : undefined,
                      )
                    }
                    placeholder="Seed (optional)"
                    type="number"
                    value={data.audioSeed ?? ''}
                  />

                  <label className={withFlowNodeInteractionClasses('flex items-center gap-2 rounded-lg border border-gray-700/60 bg-[#111217]/25 px-2.5 py-2 text-[11px] text-gray-300')}>
                    <input
                      checked={Boolean(data.audioRemoveBackgroundNoise)}
                      className={withFlowNodeInteractionClasses()}
                      onChange={(event) => data.onChange?.('audioRemoveBackgroundNoise', event.target.checked)}
                      type="checkbox"
                    />
                    Remove background noise
                  </label>

                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-100">
                    Voice changer mode uses the left input handle for an upstream audio node or imported audio asset, then applies the selected ElevenLabs voice.
                  </div>
                </>
              ) : null}

              {audioMode === 'music' ? (
                <>
                  <select
                    className={selectClassName}
                    onChange={(event) => data.onChange?.('audioOutputFormat', event.target.value)}
                    value={data.audioOutputFormat ?? 'mp3_48000_192'}
                  >
                    {AUDIO_OUTPUT_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <input
                    className={selectClassName}
                    inputMode="numeric"
                    max="600"
                    min="3"
                    onChange={(event) =>
                      data.onChange?.(
                        'audioDurationSeconds',
                        event.target.value.trim() ? Number(event.target.value) : undefined,
                      )
                    }
                    placeholder="Track duration 3–600 seconds"
                    type="number"
                    value={data.audioDurationSeconds ?? ''}
                  />

                  <label className={withFlowNodeInteractionClasses('flex items-center gap-2 rounded-lg border border-gray-700/60 bg-[#111217]/25 px-2.5 py-2 text-[11px] text-gray-300')}>
                    <input
                      checked={Boolean(data.audioForceInstrumental)}
                      className={withFlowNodeInteractionClasses()}
                      onChange={(event) => data.onChange?.('audioForceInstrumental', event.target.checked)}
                      type="checkbox"
                    />
                    Force instrumental
                  </label>

                  <input
                    aria-label="Music seed"
                    className={selectClassName}
                    disabled
                    placeholder="Seed requires composition-plan mode"
                    title="The ElevenLabs prompt route cannot combine seed with prompt; composition plans are not exposed yet."
                    type="number"
                    value=""
                  />

                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-100">
                    Music v2 turns the upstream prompt into a complete track. Describe genre, instruments, energy, structure, and lyrics; API access requires a paid ElevenLabs plan.
                  </div>
                </>
              ) : null}
            </>
          ) : null}
          </fieldset>
        </>
      ) : (
        <label className={`${actionButtonClassName} justify-center cursor-pointer`}>
          <Upload size={12} />
          {data.sourceAssetName ? 'Replace Audio' : 'Import Audio'}
          <input
            accept="audio/*"
            className="hidden"
            onChange={(event) => void handleImport(event.target.files?.[0])}
            type="file"
          />
        </label>
      )}

      <ExecutionTelemetryPanel nodeId={id} usage={data.usage} />

      {previewPanel}

      {importedAssetNamePanel}
    </BaseNode>
  );
}

export const AudioNode = memo(AudioNodeComponent);

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
