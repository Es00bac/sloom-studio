import { useEffect, useMemo, useRef, useState } from 'react';
import {
  normalizePaperAssistedLayoutSourceBundle,
  type PaperAssistedLayoutSourceBundleV1,
} from '../../../lib/paperAssistedLayout';
import type { PaperDocument } from '../../../types/paper';
import type { PaperWritingProviderOption } from '../writing/PaperWritingAssistantPanel';
import type { PaperWritingProvider } from '../writing/paperWritingAssistant';
import type {
  PaperAssistedLayoutGenerateRequest,
  PaperAssistedLayoutPreview,
} from './paperAssistedLayoutService';

export type PaperAssistedLayoutProviderOption = PaperWritingProviderOption;

export interface PaperAssistedLayoutPanelProps {
  providers: readonly PaperAssistedLayoutProviderOption[];
  locale?: string;
  onGeneratePreview: (
    request: PaperAssistedLayoutGenerateRequest,
    signal: AbortSignal,
  ) => Promise<PaperAssistedLayoutPreview>;
  onOpenAsNewDocument: (document: PaperDocument, preview: PaperAssistedLayoutPreview) => void;
  onOpenProviderSettings?: () => void;
}

interface ProviderGroup {
  provider: PaperWritingProvider;
  label: string;
  models: Array<PaperAssistedLayoutProviderOption & { key: string }>;
}

export function PaperAssistedLayoutPanel({
  providers,
  locale,
  onGeneratePreview,
  onOpenAsNewDocument,
  onOpenProviderSettings,
}: PaperAssistedLayoutPanelProps) {
  const [files, setFiles] = useState<readonly File[]>([]);
  const [sources, setSources] = useState<PaperAssistedLayoutSourceBundleV1 | null>(null);
  const [brief, setBrief] = useState('');
  const [providerId, setProviderId] = useState<PaperWritingProvider | ''>('');
  const [modelKey, setModelKey] = useState('');
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [preview, setPreview] = useState<PaperAssistedLayoutPreview | null>(null);
  const [previewHistory, setPreviewHistory] = useState<PaperAssistedLayoutPreview[]>([]);
  const [revisionBrief, setRevisionBrief] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPreparing, setIsPreparing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const requestSequenceRef = useRef(0);
  const sourceSequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const providerGroups = useMemo(() => groupProviders(providers), [providers]);
  const selectedGroup = providerGroups.find((group) => group.provider === providerId)
    ?? providerGroups.find((group) => group.models.some((model) => model.available));
  const selectedModel = selectedGroup?.models.find((model) => model.key === modelKey && model.available)
    ?? selectedGroup?.models.find((model) => model.available);
  const canGenerate = Boolean(
    sources
    && selectedModel
    && privacyConfirmed
    && !isPreparing
    && !isGenerating,
  );

  useEffect(() => () => {
    requestSequenceRef.current += 1;
    sourceSequenceRef.current += 1;
    abortRef.current?.abort();
  }, []);

  const invalidateGeneration = () => {
    requestSequenceRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setPreview(null);
    setPreviewHistory([]);
    setRevisionBrief('');
    setErrorMessage('');
  };

  const selectFiles = async (nextFiles: readonly File[]) => {
    const sequence = sourceSequenceRef.current + 1;
    sourceSequenceRef.current = sequence;
    invalidateGeneration();
    setFiles(nextFiles);
    setSources(null);
    setPrivacyConfirmed(false);
    if (nextFiles.length === 0) return;

    setIsPreparing(true);
    try {
      const normalized = await normalizePaperAssistedLayoutSourceBundle(nextFiles, {
        bundleId: 'paper-assisted-layout-sources',
      });
      if (sourceSequenceRef.current === sequence) setSources(normalized);
    } catch (error) {
      if (sourceSequenceRef.current === sequence) {
        setErrorMessage(error instanceof Error ? error.message : 'The selected source files could not be read.');
      }
    } finally {
      if (sourceSequenceRef.current === sequence) setIsPreparing(false);
    }
  };

  const generatePreview = async (previous?: PaperAssistedLayoutPreview) => {
    if (!sources || !selectedModel || !canGenerate) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    if (!previous) setPreview(null);
    setErrorMessage('');
    setIsGenerating(true);

    try {
      const nextPreview = await onGeneratePreview({
        provider: selectedModel.provider,
        ...(selectedModel.modelId ? { modelId: selectedModel.modelId } : {}),
        sources,
        ...(brief.trim() ? { brief: brief.trim() } : {}),
        ...(locale ? { locale } : {}),
        ...(previous ? {
          previousPlan: previous.plan,
          parentPreviewId: previous.id,
          revision: previous.revision + 1,
          revisionBrief: revisionBrief.trim(),
        } : { revision: 1 }),
      }, controller.signal);
      if (requestSequenceRef.current === sequence && !controller.signal.aborted) {
        setPreview(nextPreview);
        setPreviewHistory((current) => previous ? [...current, nextPreview] : [nextPreview]);
        if (previous) setRevisionBrief('');
      }
    } catch (error) {
      if (requestSequenceRef.current === sequence && !controller.signal.aborted) {
        setErrorMessage(error instanceof Error ? error.message : 'The layout preview could not be generated.');
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
    setErrorMessage('Layout generation cancelled. No document was created or changed.');
  };

  const changeProvider = (provider: PaperWritingProvider) => {
    invalidateGeneration();
    setProviderId(provider);
    setModelKey('');
    setPrivacyConfirmed(false);
  };

  const changeModel = (nextModelKey: string) => {
    invalidateGeneration();
    setModelKey(nextModelKey);
    setPrivacyConfirmed(false);
  };

  return (
    <section
      aria-label="Assisted layout"
      className="flex h-full min-h-0 flex-col bg-[#08111e] text-cyan-50"
      data-paper-assisted-layout="true"
    >
      <div className="border-b border-cyan-300/10 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100/70">
          Assisted layout
        </div>
        <p className="mt-1 text-[11px] leading-4 text-cyan-100/45">
          Optional, provider-backed starting layouts. A proposal is always previewed and is never applied automatically.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <label className="block text-[11px] font-semibold text-cyan-100/60">
          Source documents
          <input
            accept=".txt,.md,.markdown,.rtf,.html,.htm,.docx,.csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Assisted layout source documents"
            className="paper-input mt-1 block w-full text-[11px]"
            multiple
            onChange={(event) => { void selectFiles(Array.from(event.target.files ?? [])); }}
            type="file"
          />
        </label>
        <p className="-mt-2 text-[10px] leading-4 text-cyan-100/40">
          Add TXT, Markdown, RTF, HTML, Word, CSV, TSV, or XLSX files. Spreadsheet values are imported as inert table text; formulas and legacy .xls files are not supported. File order is preserved.
        </p>

        <div className="rounded-lg border border-cyan-300/10 bg-[#0b1625] p-2 text-[11px] leading-4 text-cyan-100/55">
          {isPreparing ? 'Reading source documents locally…' : null}
          {!isPreparing && files.length === 0 ? 'No source documents selected.' : null}
          {!isPreparing && files.length > 0 ? (
            <>
              <div className="font-semibold text-cyan-100/70">
                {files.length} source {files.length === 1 ? 'document' : 'documents'}
                {sources ? ` · ${sources.totalCharacters.toLocaleString()} characters` : ''}
              </div>
              <ul className="mt-1 space-y-0.5" data-paper-assisted-layout-files="true">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${index}`}>{index + 1}. {file.name}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <label className="block text-[11px] font-semibold text-cyan-100/60">
          Design direction
          <textarea
            aria-label="Assisted layout design direction"
            className="paper-input mt-1 min-h-24 resize-y"
            onChange={(event) => {
              invalidateGeneration();
              setBrief(event.target.value);
            }}
            placeholder="Audience, publication type, tone, trim size, typographic mood, or other preferences."
            value={brief}
          />
        </label>

        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          <label className="block text-[11px] font-semibold text-cyan-100/60">
            Provider
            <select
              aria-label="Assisted layout provider"
              className="paper-input mt-1"
              disabled={providerGroups.length === 0}
              onChange={(event) => changeProvider(event.target.value as PaperWritingProvider)}
              value={selectedGroup?.provider ?? ''}
            >
              {providerGroups.length === 0 ? <option value="">No provider configured</option> : null}
              {providerGroups.map((group) => (
                <option
                  disabled={!group.models.some((model) => model.available)}
                  key={group.provider}
                  value={group.provider}
                >
                  {group.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-cyan-100/60">
            Model
            <select
              aria-label="Assisted layout model"
              className="paper-input mt-1"
              disabled={!selectedGroup}
              onChange={(event) => changeModel(event.target.value)}
              value={selectedModel?.key ?? ''}
            >
              {!selectedGroup ? <option value="">No model available</option> : null}
              {selectedGroup?.models.map((model) => (
                <option disabled={!model.available} key={model.key} value={model.key}>
                  {model.modelId || 'Provider default'}{model.available ? '' : ' · unavailable'}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!selectedModel && onOpenProviderSettings ? (
          <button
            className="rounded-md border border-cyan-300/20 px-2 py-1.5 text-[11px] font-semibold text-cyan-100/70 hover:bg-cyan-300/10"
            onClick={onOpenProviderSettings}
            type="button"
          >
            Open provider settings
          </button>
        ) : null}

        <div className="rounded-lg border border-amber-300/20 bg-amber-950/15 p-2 text-[11px] leading-4 text-amber-50/75">
          <div className="font-semibold text-amber-50/90">Before anything is sent</div>
          <p className="mt-1">
            Generate sends the extracted text from every selected document, file names, and your design direction to the selected provider/model. It does not send the original files or change the open Paper document.
          </p>
          <label className="mt-2 flex items-start gap-2">
            <input
              aria-label="Confirm assisted layout data sharing"
              checked={privacyConfirmed}
              className="mt-0.5"
              onChange={(event) => {
                if (!event.target.checked) invalidateGeneration();
                setPrivacyConfirmed(event.target.checked);
              }}
              type="checkbox"
            />
            <span>I understand what will be shared for this preview.</span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md bg-cyan-500 px-3 py-1.5 text-[11px] font-bold text-[#061019] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canGenerate}
            onClick={() => { void generatePreview(); }}
            type="button"
          >
            {isGenerating ? 'Generating layout…' : 'Generate layout preview'}
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
          <div className="space-y-2 rounded-lg border border-emerald-300/20 bg-[#0b1625] p-2" data-paper-assisted-layout-preview="true">
            <div className="text-[11px] font-semibold text-emerald-100/85">Layout proposal ready</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-cyan-100/55">
              <SummaryStat label="Pages" value={preview.summary.pages} />
              <SummaryStat label="Frames" value={preview.summary.frames} />
              <SummaryStat label="Text frames" value={preview.summary.textFrames} />
              <SummaryStat label="Image placeholders" value={preview.summary.imagePlaceholders} />
              <SummaryStat label="Media briefs" value={preview.summary.mediaPrompts} />
              <SummaryStat label="Fonts" value={preview.summary.fonts} />
              <SummaryStat label="Swatches" value={preview.summary.swatches} />
            </dl>
            <div className="text-[10px] text-cyan-100/35">
              Revision {preview.revision} · {preview.provider}{preview.modelId ? ` · ${preview.modelId}` : ''}
            </div>
            <p className="text-[10px] leading-4 text-cyan-100/45">
              Nothing has been applied. Opening creates a separate editable Paper document for review and refinement.
            </p>
            <button
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-[#061019]"
              onClick={() => onOpenAsNewDocument(preview.document, preview)}
              type="button"
            >
              Open as new document
            </button>
            <div className="border-t border-cyan-300/10 pt-2">
              <label className="block text-[10px] font-semibold text-cyan-100/55">
                Refine this proposal
                <textarea
                  aria-label="Assisted layout revision direction"
                  className="paper-input mt-1 min-h-16 resize-y"
                  onChange={(event) => setRevisionBrief(event.currentTarget.value)}
                  placeholder="Keep the IDs and hierarchy, but tighten the opening spread and make image direction more specific."
                  value={revisionBrief}
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  className="rounded-md border border-cyan-300/25 px-3 py-1.5 text-[11px] font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:opacity-35"
                  disabled={!revisionBrief.trim() || isGenerating || !privacyConfirmed}
                  onClick={() => { void generatePreview(preview); }}
                  type="button"
                >
                  {isGenerating ? 'Revising proposal…' : 'Revise proposal'}
                </button>
                {previewHistory.length > 1 ? (
                  <select
                    aria-label="Assisted layout proposal revision"
                    className="paper-input w-auto text-[10px]"
                    onChange={(event) => {
                      const selected = previewHistory.find((candidate) => candidate.id === event.currentTarget.value);
                      if (selected) setPreview(selected);
                    }}
                    value={preview.id}
                  >
                    {previewHistory.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>Revision {candidate.revision}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="font-semibold text-cyan-50/80">{value.toLocaleString()}</dd>
    </div>
  );
}

function groupProviders(providers: readonly PaperAssistedLayoutProviderOption[]): ProviderGroup[] {
  const groups = new Map<PaperWritingProvider, ProviderGroup>();
  providers.forEach((option) => {
    const group = groups.get(option.provider) ?? {
      provider: option.provider,
      label: option.label,
      models: [],
    };
    group.models.push({
      ...option,
      key: `${option.provider}\u001f${option.modelId ?? ''}`,
    });
    groups.set(option.provider, group);
  });
  return [...groups.values()];
}
