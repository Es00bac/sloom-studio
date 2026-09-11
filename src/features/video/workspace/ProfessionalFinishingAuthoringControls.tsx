import type { VideoParamKeyframe, VideoParamKeyframeTrack } from '../../../lib/videoParamKeyframes';
import { MAX_TRANSCRIPT_SEARCH_QUERY_CHARACTERS } from '../../../lib/videoTranscriptEditing';
import type { TranscriptEditProposal, TranscriptSearchMatch } from '../../../lib/videoTranscriptEditing';
import type { VideoAudioProviderSelection, VideoVoiceoverParagraph } from '../../../lib/videoVoiceoverAuthoring';

const fieldClassName = 'rounded border border-gray-700 bg-[#0c1119] px-2 py-1 text-xs text-gray-100 disabled:opacity-50';
const buttonClassName = 'rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-gray-100 disabled:cursor-not-allowed disabled:opacity-40';

export interface ParameterKeyframeEditorProps {
  tracks: readonly VideoParamKeyframeTrack[];
  selectedTrackId?: string;
  currentTimeMs: number;
  durationMs: number;
  disabledReason?: string;
  onSelectTrack: (trackId: string) => void;
  onAddKeyframe: (trackId: string, timeMs: number) => void;
  onChangeKeyframe: (
    trackId: string,
    keyframeId: string,
    patch: Partial<Pick<VideoParamKeyframe, 'timeMs' | 'value' | 'interpolation' | 'bezier'>>,
  ) => void;
  onRemoveKeyframe: (trackId: string, keyframeId: string) => void;
}

export function ParameterKeyframeEditor({
  tracks,
  selectedTrackId,
  currentTimeMs,
  durationMs,
  disabledReason,
  onSelectTrack,
  onAddKeyframe,
  onChangeKeyframe,
  onRemoveKeyframe,
}: ParameterKeyframeEditorProps) {
  const selected = tracks.find((track) => track.id === selectedTrackId) ?? tracks[0];
  const disabled = Boolean(disabledReason || !selected);
  return (
    <section aria-label="Parameter keyframe editor" className="space-y-3 rounded-lg border border-gray-700 bg-[#080c12] p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-44 flex-1 text-xs text-gray-300">
          Automated parameter
          <select
            aria-label="Automated parameter"
            className={`${fieldClassName} mt-1 w-full`}
            disabled={tracks.length === 0}
            onChange={(event) => onSelectTrack(event.currentTarget.value)}
            value={selected?.id ?? ''}
          >
            {tracks.map((track) => <option key={track.id} value={track.id}>{track.label ?? track.parameterId}</option>)}
          </select>
        </label>
        <button
          className={buttonClassName}
          disabled={disabled || currentTimeMs < 0 || currentTimeMs > durationMs}
          onClick={() => selected && onAddKeyframe(selected.id, currentTimeMs)}
          type="button"
        >
          Add at playhead
        </button>
      </div>
      <p aria-live="polite" className="text-[11px] text-gray-400">
        {disabledReason ?? `${selected?.keyframes.length ?? 0} keyframes · playhead ${formatMilliseconds(currentTimeMs)}`}
      </p>
      {selected ? (
        <ol aria-label={`${selected.label ?? selected.parameterId} keyframes`} className="space-y-2">
          {selected.keyframes.map((keyframe, index) => (
            <li className="rounded border border-gray-700/70 bg-black/20 p-2" key={keyframe.id}>
              <fieldset className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <legend className="sr-only">Keyframe {index + 1}</legend>
                <label className="text-[11px] text-gray-400">
                  Time (ms)
                  <input
                    aria-label={`Keyframe ${index + 1} time in milliseconds`}
                    className={`${fieldClassName} mt-1 w-full`}
                    disabled={disabled}
                    max={durationMs}
                    min={0}
                    onChange={(event) => onChangeKeyframe(selected.id, keyframe.id, { timeMs: Number(event.currentTarget.value) })}
                    step={1}
                    type="number"
                    value={keyframe.timeMs}
                  />
                </label>
                <label className="text-[11px] text-gray-400">
                  Value {selected.unit ? `(${selected.unit})` : ''}
                  <input
                    aria-label={`Keyframe ${index + 1} value`}
                    className={`${fieldClassName} mt-1 w-full`}
                    disabled={disabled}
                    max={selected.maxValue}
                    min={selected.minValue}
                    onChange={(event) => onChangeKeyframe(selected.id, keyframe.id, { value: Number(event.currentTarget.value) })}
                    step="any"
                    type="number"
                    value={keyframe.value}
                  />
                </label>
                <label className="text-[11px] text-gray-400">
                  Interpolation
                  <select
                    aria-label={`Keyframe ${index + 1} interpolation`}
                    className={`${fieldClassName} mt-1 w-full`}
                    disabled={disabled || index === selected.keyframes.length - 1}
                    onChange={(event) => onChangeKeyframe(selected.id, keyframe.id, {
                      interpolation: event.currentTarget.value as VideoParamKeyframe['interpolation'],
                    })}
                    value={keyframe.interpolation}
                  >
                    <option value="hold">Hold</option>
                    <option value="linear">Linear</option>
                    <option value="cubic-bezier">Cubic Bezier</option>
                  </select>
                </label>
                <button
                  aria-label={`Remove keyframe ${index + 1}`}
                  className={`${buttonClassName} self-end`}
                  disabled={disabled}
                  onClick={() => onRemoveKeyframe(selected.id, keyframe.id)}
                  type="button"
                >
                  Remove
                </button>
                {keyframe.interpolation === 'cubic-bezier' ? (
                  <div aria-label={`Keyframe ${index + 1} cubic Bezier controls`} className="col-span-2 grid grid-cols-2 gap-2 md:col-span-4 md:grid-cols-4" role="group">
                    {([
                      ['x1', 'Outgoing X'],
                      ['y1', 'Outgoing Y'],
                      ['x2', 'Incoming X'],
                      ['y2', 'Incoming Y'],
                    ] as const).map(([control, label]) => (
                      <label className="text-[11px] text-gray-400" key={control}>
                        {label}
                        <input
                          aria-label={`Keyframe ${index + 1} ${label}`}
                          className={`${fieldClassName} mt-1 w-full`}
                          disabled={disabled || index === selected.keyframes.length - 1}
                          max={control === 'x1' || control === 'x2' ? 1 : 10}
                          min={control === 'x1' || control === 'x2' ? 0 : -10}
                          onChange={(event) => onChangeKeyframe(selected.id, keyframe.id, {
                            bezier: {
                              ...(keyframe.bezier ?? { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }),
                              [control]: Number(event.currentTarget.value),
                            },
                          })}
                          step={0.01}
                          type="number"
                          value={keyframe.bezier?.[control] ?? ({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 } as const)[control]}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </fieldset>
            </li>
          ))}
        </ol>
      ) : <p className="text-xs text-gray-500">No automatable parameter is selected.</p>}
    </section>
  );
}

export interface TranscriptEditingPanelProps {
  wordCount: number;
  query: string;
  matches: readonly TranscriptSearchMatch[];
  selectedRangeLabel?: string;
  pendingProposal?: TranscriptEditProposal;
  disabledReason?: string;
  searchError?: string;
  previewSummary?: string;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onSelectMatch: (match: TranscriptSearchMatch) => void;
  onPreviewProposal: () => void;
  onApplyProposal: () => void;
  onClearSelection: () => void;
}

export function TranscriptEditingPanel({
  wordCount,
  query,
  matches,
  selectedRangeLabel,
  pendingProposal,
  disabledReason,
  searchError,
  previewSummary,
  onQueryChange,
  onSearch,
  onSelectMatch,
  onPreviewProposal,
  onApplyProposal,
  onClearSelection,
}: TranscriptEditingPanelProps) {
  const disabled = Boolean(disabledReason);
  return (
    <section aria-label="Transcript editing" className="space-y-3 rounded-lg border border-gray-700 bg-[#080c12] p-3">
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); onSearch(query); }} role="search">
        <label className="min-w-0 flex-1 text-xs text-gray-300">
          Search {wordCount.toLocaleString()} transcript words
          <input
            aria-label="Search transcript"
            className={`${fieldClassName} mt-1 w-full`}
            disabled={disabled}
            maxLength={MAX_TRANSCRIPT_SEARCH_QUERY_CHARACTERS}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="Words or phrase"
            type="search"
            value={query}
          />
        </label>
        <button className={`${buttonClassName} self-end`} disabled={disabled || !query.trim()} type="submit">Search</button>
      </form>
      {disabledReason ? <p role="alert" className="text-xs text-amber-300">{disabledReason}</p> : null}
      {searchError ? <p role="alert" className="text-xs text-amber-300">{searchError}</p> : null}
      <ol aria-label="Transcript search results" className="max-h-40 space-y-1 overflow-y-auto">
        {matches.map((match, index) => (
          <li key={`${match.startMs}:${match.endMs}:${index}`}>
            <button className="w-full rounded border border-gray-700 px-2 py-1 text-left text-xs text-gray-200" onClick={() => onSelectMatch(match)} type="button">
              <span>{match.text}</span>
              <span className="ml-2 text-gray-500">{formatMilliseconds(match.startMs)}–{formatMilliseconds(match.endMs)}</span>
            </button>
          </li>
        ))}
      </ol>
      <div aria-live="polite" className="rounded border border-gray-700/70 bg-black/20 p-2 text-xs text-gray-300">
        <p>{selectedRangeLabel ?? 'No transcript range selected.'}</p>
        {pendingProposal ? <p className="mt-1 text-gray-400">{pendingProposal.title}: {pendingProposal.commands.length} ripple command{pendingProposal.commands.length === 1 ? '' : 's'}</p> : null}
        {previewSummary ? <p className="mt-1 text-cyan-200">{previewSummary}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClassName} disabled={disabled || !selectedRangeLabel} onClick={onClearSelection} type="button">Clear selection</button>
        <button className={buttonClassName} disabled={disabled || !selectedRangeLabel} onClick={onPreviewProposal} type="button">Preview timeline patch</button>
        <button className={buttonClassName} disabled={disabled || !pendingProposal} onClick={onApplyProposal} type="button">Apply as one edit</button>
      </div>
    </section>
  );
}

export interface VoiceoverSfxDialogDraft {
  paragraphText: string;
  languageCode: string;
  voiceId: string;
  sfxPrompt: string;
  rangeStartMs: number;
  rangeEndMs: number;
}

export interface VoiceoverSfxDialogProps {
  open: boolean;
  mode: 'voiceover' | 'range-sfx';
  providers: readonly (VideoAudioProviderSelection & { label: string })[];
  selectedProviderId?: string;
  draft: Readonly<VoiceoverSfxDialogDraft>;
  paragraphs: readonly VideoVoiceoverParagraph[];
  rightsConfirmed: boolean;
  billingConfirmed: boolean;
  busy?: boolean;
  statusMessage?: string;
  onClose: () => void;
  onModeChange: (mode: VoiceoverSfxDialogProps['mode']) => void;
  onProviderChange: (providerId: string) => void;
  onDraftChange: (patch: Partial<VoiceoverSfxDialogDraft>) => void;
  onRightsConfirmedChange: (confirmed: boolean) => void;
  onBillingConfirmedChange: (confirmed: boolean) => void;
  onGenerateVoiceover: (request: Pick<VoiceoverSfxDialogDraft, 'paragraphText' | 'languageCode' | 'voiceId'> & { providerId: string }) => void;
  onGenerateRangeSfx: (request: Pick<VoiceoverSfxDialogDraft, 'sfxPrompt' | 'rangeStartMs' | 'rangeEndMs'> & { providerId: string }) => void;
  onRegenerateParagraph: (paragraphId: string) => void;
}

export function VoiceoverSfxDialog(props: VoiceoverSfxDialogProps) {
  if (!props.open) return null;
  const selectedProvider = props.providers.find((provider) => provider.providerId === props.selectedProviderId) ?? props.providers[0];
  const approved = props.rightsConfirmed && props.billingConfirmed && !props.busy && Boolean(selectedProvider);
  const voiceoverValid = approved && Boolean(props.draft.paragraphText.trim() && props.draft.languageCode.trim() && props.draft.voiceId.trim());
  const sfxValid = approved && Boolean(props.draft.sfxPrompt.trim()) && props.draft.rangeEndMs > props.draft.rangeStartMs;
  return (
    <div aria-labelledby="voiceover-sfx-title" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog">
      <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-gray-700 bg-[#0b1018] p-4 text-gray-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold" id="voiceover-sfx-title">Voiceover & range sound effects</h2>
            <p className="mt-1 text-xs text-gray-400">Generated audio is added as a new asset and clip. Imported originals are never replaced.</p>
          </div>
          <button aria-label="Close voiceover and sound effects" className={buttonClassName} onClick={props.onClose} type="button">Close</button>
        </div>
        <fieldset>
          <legend className="text-xs font-medium text-gray-300">Authoring mode</legend>
          <div className="mt-1 flex gap-3">
            <label className="text-xs"><input checked={props.mode === 'voiceover'} onChange={() => props.onModeChange('voiceover')} type="radio" /> Voiceover</label>
            <label className="text-xs"><input checked={props.mode === 'range-sfx'} onChange={() => props.onModeChange('range-sfx')} type="radio" /> Range SFX</label>
          </div>
        </fieldset>
        <label className="block text-xs text-gray-300">
          Audio provider
          <select aria-label="Audio provider" className={`${fieldClassName} mt-1 w-full`} onChange={(event) => props.onProviderChange(event.currentTarget.value)} value={selectedProvider?.providerId ?? ''}>
            {props.providers.map((provider) => <option key={`${provider.providerId}:${provider.modelId}`} value={provider.providerId}>{provider.label} · {provider.modelId}</option>)}
          </select>
        </label>
        {props.mode === 'voiceover' ? (
          <div className="space-y-2">
            <label className="block text-xs text-gray-300">Paragraph<textarea aria-label="Voiceover paragraph" className={`${fieldClassName} mt-1 min-h-24 w-full`} maxLength={5_000} onChange={(event) => props.onDraftChange({ paragraphText: event.currentTarget.value })} value={props.draft.paragraphText} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-300">Language<input aria-label="Voiceover language" className={`${fieldClassName} mt-1 w-full`} onChange={(event) => props.onDraftChange({ languageCode: event.currentTarget.value })} value={props.draft.languageCode} /></label>
              <label className="text-xs text-gray-300">Voice ID<input aria-label="Voice ID" className={`${fieldClassName} mt-1 w-full`} onChange={(event) => props.onDraftChange({ voiceId: event.currentTarget.value })} value={props.draft.voiceId} /></label>
            </div>
            {props.paragraphs.length ? (
              <ul aria-label="Authored voiceover paragraphs" className="space-y-1">
                {props.paragraphs.map((paragraph) => (
                  <li className="flex items-center justify-between gap-2 rounded border border-gray-700 px-2 py-1 text-xs" key={paragraph.id}>
                    <span className="min-w-0 truncate">{paragraph.text} · revision {paragraph.revision}</span>
                    <button className={buttonClassName} disabled={!approved} onClick={() => props.onRegenerateParagraph(paragraph.id)} type="button">Regenerate</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs text-gray-300">Sound description<textarea aria-label="Sound effect description" className={`${fieldClassName} mt-1 min-h-20 w-full`} maxLength={1_000} onChange={(event) => props.onDraftChange({ sfxPrompt: event.currentTarget.value })} value={props.draft.sfxPrompt} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-300">Range start (ms)<input aria-label="Sound effect range start" className={`${fieldClassName} mt-1 w-full`} min={0} onChange={(event) => props.onDraftChange({ rangeStartMs: Number(event.currentTarget.value) })} type="number" value={props.draft.rangeStartMs} /></label>
              <label className="text-xs text-gray-300">Range end (ms)<input aria-label="Sound effect range end" className={`${fieldClassName} mt-1 w-full`} min={0} onChange={(event) => props.onDraftChange({ rangeEndMs: Number(event.currentTarget.value) })} type="number" value={props.draft.rangeEndMs} /></label>
            </div>
          </div>
        )}
        <div className="space-y-2 rounded border border-amber-400/30 bg-amber-400/5 p-2">
          <label className="flex gap-2 text-xs"><input checked={props.rightsConfirmed} onChange={(event) => props.onRightsConfirmedChange(event.currentTarget.checked)} type="checkbox" /> I confirm I have the rights and consent required for these voices and source recordings.</label>
          <label className="flex gap-2 text-xs"><input checked={props.billingConfirmed} onChange={(event) => props.onBillingConfirmedChange(event.currentTarget.checked)} type="checkbox" /> I approve this potentially billable provider request.</label>
        </div>
        {props.statusMessage ? <p aria-live="polite" className="text-xs text-cyan-200">{props.statusMessage}</p> : null}
        <button
          className={`${buttonClassName} w-full`}
          disabled={props.mode === 'voiceover' ? !voiceoverValid : !sfxValid}
          onClick={() => {
            if (!selectedProvider) return;
            if (props.mode === 'voiceover') {
              props.onGenerateVoiceover({
                paragraphText: props.draft.paragraphText,
                languageCode: props.draft.languageCode,
                voiceId: props.draft.voiceId,
                providerId: selectedProvider.providerId,
              });
            } else {
              props.onGenerateRangeSfx({
                sfxPrompt: props.draft.sfxPrompt,
                rangeStartMs: props.draft.rangeStartMs,
                rangeEndMs: props.draft.rangeEndMs,
                providerId: selectedProvider.providerId,
              });
            }
          }}
          type="button"
        >
          {props.busy ? 'Submitting…' : props.mode === 'voiceover' ? 'Generate voiceover with timestamps' : 'Generate sound for range'}
        </button>
      </div>
    </div>
  );
}

function formatMilliseconds(milliseconds: number): string {
  const safe = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const remainder = Math.round(safe % 1_000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`;
}
