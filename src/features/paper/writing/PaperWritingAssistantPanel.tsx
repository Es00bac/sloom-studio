import { useEffect, useMemo, useRef, useState } from 'react';
import {
  canApplyPaperWritingPreview,
  getPaperWritingActionDescriptor,
  PAPER_WRITING_ACTIONS,
  type PaperWritingAction,
  type PaperWritingGenerateRequest,
  type PaperWritingPreview,
  type PaperWritingProvider,
  type PaperWritingSourceSnapshot,
} from './paperWritingAssistant';

export interface PaperWritingProviderOption {
  provider: PaperWritingProvider;
  label: string;
  modelId?: string;
  available: boolean;
  unavailableReason?: string;
}

export interface PaperWritingAssistantPanelProps {
  source: PaperWritingSourceSnapshot | null;
  providers: readonly PaperWritingProviderOption[];
  locale?: string;
  onGeneratePreview: (
    request: PaperWritingGenerateRequest,
    signal: AbortSignal,
  ) => Promise<PaperWritingPreview>;
  onApplyPlainText: (text: string, preview: PaperWritingPreview) => void;
  onCopyPlainText?: (text: string) => void | Promise<void>;
  onOpenProviderSettings?: () => void;
}

export function PaperWritingAssistantPanel({
  source,
  providers,
  locale,
  onGeneratePreview,
  onApplyPlainText,
  onCopyPlainText,
  onOpenProviderSettings,
}: PaperWritingAssistantPanelProps) {
  const [action, setAction] = useState<PaperWritingAction>('proofread');
  const [instruction, setInstruction] = useState('');
  const [providerKey, setProviderKey] = useState('');
  const [preview, setPreview] = useState<PaperWritingPreview | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);

  const providerOptions = useMemo(() => providers.map((option) => ({
    ...option,
    key: paperWritingProviderKey(option),
  })), [providers]);
  const selectedProvider = providerOptions.find((option) => option.key === providerKey && option.available)
    ?? providerOptions.find((option) => option.available);
  const actionDescriptor = getPaperWritingActionDescriptor(action);
  const applyDecision = canApplyPaperWritingPreview(preview, source);
  const generationDisabled = !source
    || !selectedProvider
    || (actionDescriptor.sourceTextRequired && !source.text.trim())
    || ((action === 'rewrite' || action === 'change-tone') && !instruction.trim())
    || ((action === 'draft' || action === 'ideas') && !source.text.trim() && !instruction.trim())
    || isGenerating;

  useEffect(() => () => {
    requestSequenceRef.current += 1;
    abortRef.current?.abort();
  }, []);

  const invalidateGeneration = () => {
    requestSequenceRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setPreview(null);
    setErrorMessage('');
  };

  const generatePreview = async () => {
    if (!source || !selectedProvider || generationDisabled) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    setErrorMessage('');
    setPreview(null);
    setIsGenerating(true);

    try {
      const nextPreview = await onGeneratePreview({
        action,
        provider: selectedProvider.provider,
        ...(selectedProvider.modelId ? { modelId: selectedProvider.modelId } : {}),
        source,
        ...(instruction.trim() ? { instruction: instruction.trim() } : {}),
        ...(locale ? { locale } : {}),
      }, controller.signal);
      if (requestSequenceRef.current === sequence && !controller.signal.aborted) {
        setPreview(nextPreview);
      }
    } catch (error) {
      if (requestSequenceRef.current === sequence && !controller.signal.aborted) {
        setErrorMessage(error instanceof Error ? error.message : 'The writing preview could not be generated.');
      }
    } finally {
      if (requestSequenceRef.current === sequence) {
        setIsGenerating(false);
        abortRef.current = null;
      }
    }
  };

  const cancelGeneration = () => {
    requestSequenceRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setErrorMessage('Preview generation cancelled. No result was applied.');
  };

  const applyPreview = () => {
    if (!preview || !applyDecision.allowed) return;
    onApplyPlainText(preview.generatedText, preview);
  };

  return (
    <section
      aria-label="Writing assistant"
      className="flex h-full min-h-0 flex-col bg-[#08111e] text-cyan-50"
      data-paper-writing-assistant="true"
    >
      <div className="border-b border-cyan-300/10 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100/70">
          Writing assistant
        </div>
        <p className="mt-1 text-[11px] leading-4 text-cyan-100/45">
          Optional and provider-backed. Nothing is sent until you choose Generate preview, and generated text is never applied automatically.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <label className="block text-[11px] font-semibold text-cyan-100/60">
          Action
          <select
            aria-label="Writing action"
            className="paper-input mt-1"
            onChange={(event) => {
              invalidateGeneration();
              setAction(event.target.value as PaperWritingAction);
            }}
            value={action}
          >
            {PAPER_WRITING_ACTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <p className="-mt-2 text-[10px] leading-4 text-cyan-100/40">{actionDescriptor.description}</p>

        <label className="block text-[11px] font-semibold text-cyan-100/60">
          Configured provider
          <select
            aria-label="Writing provider"
            className="paper-input mt-1"
            disabled={providerOptions.length === 0}
            onChange={(event) => {
              invalidateGeneration();
              setProviderKey(event.target.value);
            }}
            value={selectedProvider?.key ?? ''}
          >
            {!selectedProvider ? <option value="">No text provider configured</option> : null}
            {providerOptions.map((option) => (
              <option disabled={!option.available} key={option.key} value={option.key}>
                {option.label}{option.modelId ? ` · ${option.modelId}` : ''}{option.available ? '' : ' · unavailable'}
              </option>
            ))}
          </select>
        </label>
        {!selectedProvider && onOpenProviderSettings ? (
          <button
            className="rounded-md border border-cyan-300/20 px-2 py-1.5 text-[11px] font-semibold text-cyan-100/70 hover:bg-cyan-300/10"
            onClick={onOpenProviderSettings}
            type="button"
          >
            Open provider settings
          </button>
        ) : null}

        <label className="block text-[11px] font-semibold text-cyan-100/60">
          Direction or brief
          <textarea
            aria-label="Writing direction or brief"
            className="paper-input mt-1 min-h-20 resize-y"
            onChange={(event) => {
              invalidateGeneration();
              setInstruction(event.target.value);
            }}
            placeholder="Optional for most actions; required for Rewrite and Change tone."
            value={instruction}
          />
        </label>

        <div className="rounded-lg border border-cyan-300/10 bg-[#0b1625] p-2 text-[11px] leading-4 text-cyan-100/50">
          {source?.frameId ? (
            <>
              <div>{source.text.length.toLocaleString()} source characters</div>
              <div>{source.sourceKind === 'rich-text' ? 'Rich-text selection' : 'Plain-text selection'}</div>
            </>
          ) : source
            ? 'No text frame selected. Draft and Ideas can start from your brief; no document text will be sent.'
            : 'Select a text frame, or choose Draft or Ideas and enter a brief.'}
        </div>
        {source?.text ? (
          <label className="block text-[11px] font-semibold text-cyan-100/60">
            Text sent to provider
            <textarea
              aria-label="Text sent to writing provider"
              className="paper-input mt-1 min-h-24 resize-y font-mono text-[10px]"
              readOnly
              value={source.text}
            />
          </label>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md bg-cyan-500 px-3 py-1.5 text-[11px] font-bold text-[#061019] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={generationDisabled}
            onClick={() => { void generatePreview(); }}
            type="button"
          >
            {isGenerating ? 'Generating preview…' : 'Generate preview'}
          </button>
          {isGenerating ? (
            <button
              className="rounded-md border border-cyan-300/20 px-3 py-1.5 text-[11px] font-semibold text-cyan-100/70"
              onClick={cancelGeneration}
              type="button"
            >
              Cancel
            </button>
          ) : null}
        </div>

        {errorMessage ? (
          <div aria-live="polite" className="rounded-lg border border-rose-300/20 bg-rose-950/20 p-2 text-[11px] text-rose-100/80" role="status">
            {errorMessage}
          </div>
        ) : null}

        {preview ? (
          <div className="space-y-2 rounded-lg border border-cyan-300/15 bg-[#0b1625] p-2" data-paper-writing-preview="true">
            <label className="block text-[11px] font-semibold text-cyan-100/60">
              Preview (editable)
              <textarea
                aria-label="Generated writing preview"
                className="paper-input mt-1 min-h-40 resize-y font-serif leading-relaxed"
                onChange={(event) => setPreview({ ...preview, generatedText: event.target.value })}
                value={preview.generatedText}
              />
            </label>
            <div className="text-[10px] text-cyan-100/35">
              {preview.provider}{preview.modelId ? ` · ${preview.modelId}` : ''}
            </div>
            {!applyDecision.allowed ? (
              <div className="text-[11px] leading-4 text-amber-100/75" role="status">
                {paperWritingApplyBlockMessage(applyDecision.reason)}
              </div>
            ) : null}
            <button
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-[#061019] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!applyDecision.allowed || isGenerating}
              onClick={applyPreview}
              type="button"
            >
              Apply plain text
            </button>
            {onCopyPlainText ? (
              <button
                className="ml-2 rounded-md border border-cyan-300/20 px-3 py-1.5 text-[11px] font-semibold text-cyan-100/75 hover:bg-cyan-300/10"
                onClick={() => { void onCopyPlainText(preview.generatedText); }}
                type="button"
              >
                Copy preview
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function paperWritingProviderKey(option: PaperWritingProviderOption): string {
  return `${option.provider}\u001f${option.modelId ?? ''}`;
}

function paperWritingApplyBlockMessage(reason: ReturnType<typeof canApplyPaperWritingPreview>['reason']): string {
  switch (reason) {
    case 'rich-text-source':
      return 'Direct Apply is disabled for rich text so generated output cannot silently discard runs, styles, links, ruby, or paragraph formatting. Copy or review the suggestion manually.';
    case 'no-editable-target':
      return 'No editable text frame was selected for this request. Copy the suggestion or create a text frame before applying it.';
    case 'stale-source':
      return 'The source changed after this preview was requested. Generate a fresh preview before applying.';
    case 'empty-output':
      return 'Enter preview text before applying.';
    case 'no-preview':
    default:
      return 'Generate a preview before applying.';
  }
}
