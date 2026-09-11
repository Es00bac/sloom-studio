import { useEffect, useMemo, useRef, useState } from 'react';
import type { PaperWritingProviderOption } from '../writing/PaperWritingAssistantPanel';
import type { PaperWritingProvider } from '../writing/paperWritingAssistant';
import {
  usePaperLiveLayoutAgentSession,
  type PaperLiveLayoutAgentStartRequest,
} from './paperLiveLayoutAgentSession';

export type PaperLiveLayoutAgentProviderOption = PaperWritingProviderOption;

export interface PaperLiveLayoutAgentPanelProps {
  providers: readonly PaperLiveLayoutAgentProviderOption[];
  onStart: (request: PaperLiveLayoutAgentStartRequest) => void;
  onOpenProviderSettings?: () => void;
}

interface ProviderGroup {
  provider: PaperWritingProvider;
  label: string;
  models: Array<PaperLiveLayoutAgentProviderOption & { key: string }>;
}

const MODEL_OVERRIDE_STORAGE_KEY = 'signal-loom-paper-live-layout-agent-models';

// Some runtimes (tests, privacy-restricted webviews) expose no localStorage at all. The
// in-memory mirror keeps per-provider recall working for the session in that case.
const memoryModelOverrides: Record<string, string> = {};

function readModelOverrides(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(MODEL_OVERRIDE_STORAGE_KEY);
    if (!raw) return { ...memoryModelOverrides };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...memoryModelOverrides };
    }
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && value.trim().length > 0 && value.length <= 192)
      .map(([key, value]) => [key, (value as string).trim()]));
  } catch {
    return { ...memoryModelOverrides };
  }
}

function writeModelOverride(provider: string, modelId: string): void {
  if (modelId.trim()) memoryModelOverrides[provider] = modelId.trim();
  else delete memoryModelOverrides[provider];
  try {
    const overrides = readModelOverrides();
    if (modelId.trim()) overrides[provider] = modelId.trim();
    else delete overrides[provider];
    globalThis.localStorage?.setItem(MODEL_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // A full or unavailable localStorage must never break the panel.
  }
}

export function PaperLiveLayoutAgentPanel({
  providers,
  onStart,
  onOpenProviderSettings,
}: PaperLiveLayoutAgentPanelProps) {
  const session = usePaperLiveLayoutAgentSession();
  const [brief, setBrief] = useState('');
  const [providerId, setProviderId] = useState<PaperWritingProvider | ''>('');
  const [modelDraft, setModelDraft] = useState('');
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  const providerGroups = useMemo(() => groupProviders(providers), [providers]);
  const selectedGroup = providerGroups.find((group) => group.provider === providerId)
    ?? providerGroups.find((group) => group.models.some((model) => model.available));
  const defaultModelId = selectedGroup?.models.find((model) => model.available)?.modelId ?? '';
  const effectiveModelId = modelDraft.trim() || defaultModelId;

  useEffect(() => {
    setModelDraft(readModelOverrides()[selectedGroup?.provider ?? ''] ?? '');
    setPrivacyConfirmed(false);
  }, [selectedGroup?.provider]);

  useEffect(() => {
    const node = logScrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [session.log.length]);

  const busy = session.status === 'running' || session.status === 'paused';
  const canStart = Boolean(
    brief.trim()
    && selectedGroup
    && privacyConfirmed
    && !busy,
  );

  const start = () => {
    if (!canStart || !selectedGroup) return;
    writeModelOverride(selectedGroup.provider, modelDraft);
    onStart({
      provider: selectedGroup.provider,
      ...(effectiveModelId ? { modelId: effectiveModelId } : {}),
      brief: brief.trim(),
    });
  };

  return (
    <section
      aria-label="Live layout agent"
      className="flex h-full min-h-0 flex-col bg-[#08111e] text-cyan-50"
      data-paper-live-layout-agent="true"
    >
      <div className="border-b border-cyan-300/10 p-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100/70">
          Live layout agent
        </div>
        <p className="mt-1 text-[11px] leading-4 text-cyan-100/45">
          A connected model builds and refines the open document step by step. You can watch every
          edit, undo any step, or switch workspaces while it keeps working.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <label className="block text-[11px] font-semibold text-cyan-100/60">
          Design direction
          <textarea
            aria-label="Live layout agent design direction"
            className="paper-input mt-1 min-h-24 resize-y"
            disabled={busy}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Publication type, audience, tone, page structure, what art to place from the Source Library, or how to restyle what is on the page."
            value={brief}
          />
        </label>

        <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
          <label className="block text-[11px] font-semibold text-cyan-100/60">
            Provider
            <select
              aria-label="Live layout agent provider"
              className="paper-input mt-1"
              disabled={busy || providerGroups.length === 0}
              onChange={(event) => setProviderId(event.target.value as PaperWritingProvider)}
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
            <input
              aria-label="Live layout agent model"
              className="paper-input mt-1"
              disabled={busy || !selectedGroup}
              onChange={(event) => setModelDraft(event.target.value)}
              placeholder={defaultModelId || 'Provider default'}
              spellCheck={false}
              value={modelDraft}
            />
          </label>
        </div>
        <p className="-mt-1 text-[10px] leading-4 text-cyan-100/40">
          Type any model ID your provider or local CLI sign-in can run — it is remembered per
          provider. Leave empty for the configured default{defaultModelId ? ` (${defaultModelId})` : ''}.
        </p>
        {!selectedGroup && onOpenProviderSettings ? (
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
            Each turn sends your design direction and a compact snapshot of the open document (page
            size, frame labels and geometry, short text previews, placeable Source Library item
            names) to the selected provider/model. The agent can only create and edit its own
            agent-… frames; every step is a normal undoable edit.
          </p>
          <label className="mt-2 flex items-start gap-2">
            <input
              aria-label="Confirm live layout agent data sharing"
              checked={privacyConfirmed}
              className="mt-0.5"
              disabled={busy}
              onChange={(event) => setPrivacyConfirmed(event.target.checked)}
              type="checkbox"
            />
            <span>I understand what will be shared on every turn.</span>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {!busy ? (
            <button
              className="rounded-md bg-cyan-500 px-3 py-1.5 text-[11px] font-bold text-[#061019] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canStart}
              onClick={start}
              type="button"
            >
              Start live layout
            </button>
          ) : null}
          {session.status === 'running' ? (
            <button
              className="rounded-md border border-cyan-300/25 px-3 py-1.5 text-[11px] font-semibold text-cyan-50"
              onClick={session.pause}
              type="button"
            >
              Pause
            </button>
          ) : null}
          {session.status === 'paused' ? (
            <button
              className="rounded-md bg-cyan-500 px-3 py-1.5 text-[11px] font-bold text-[#061019]"
              onClick={session.resume}
              type="button"
            >
              Resume
            </button>
          ) : null}
          {busy ? (
            <button
              className="rounded-md border border-rose-300/30 px-3 py-1.5 text-[11px] font-semibold text-rose-100/80"
              onClick={session.cancel}
              type="button"
            >
              Stop
            </button>
          ) : null}
          {session.status !== 'idle' && !busy ? (
            <button
              className="rounded-md border border-cyan-300/20 px-3 py-1.5 text-[11px] font-semibold text-cyan-100/70"
              onClick={session.dismiss}
              type="button"
            >
              Clear session
            </button>
          ) : null}
        </div>

        {session.status !== 'idle' ? (
          <div
            className="rounded-lg border border-cyan-300/10 bg-[#0b1625] p-2"
            data-paper-live-layout-agent-log="true"
          >
            <div className="flex items-center justify-between text-[10px] text-cyan-100/50">
              <span className="font-semibold uppercase tracking-[0.14em]">
                {statusLabel(session.status)}
              </span>
              <span>
                Turn {session.turn}/{session.maxTurns} · {session.appliedOperations} edits
                {session.provider ? ` · ${session.provider}` : ''}
                {session.modelId ? ` · ${session.modelId}` : ''}
              </span>
            </div>
            <div
              aria-live="polite"
              className="mt-2 max-h-64 space-y-1 overflow-y-auto text-[11px] leading-4"
              ref={logScrollRef}
            >
              {session.log.map((entry) => (
                <div
                  className={entry.kind === 'issue'
                    ? 'text-amber-100/75'
                    : entry.kind === 'op'
                      ? 'text-cyan-100/70'
                      : entry.kind === 'status'
                        ? 'font-semibold text-cyan-50/85'
                        : 'text-cyan-100/50'}
                  key={entry.id}
                >
                  {entry.kind === 'op' ? '▸ ' : ''}{entry.text}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'running': return 'Working live';
    case 'paused': return 'Paused';
    case 'done': return 'Done';
    case 'blocked': return 'Needs you';
    case 'cancelled': return 'Stopped';
    case 'error': return 'Error';
    default: return 'Idle';
  }
}

function groupProviders(providers: readonly PaperLiveLayoutAgentProviderOption[]): ProviderGroup[] {
  const groups = new Map<PaperWritingProvider, ProviderGroup>();
  providers.forEach((option) => {
    const group = groups.get(option.provider) ?? {
      provider: option.provider,
      label: option.label,
      models: [],
    };
    group.models.push({
      ...option,
      key: `${option.provider}${option.modelId ?? ''}`,
    });
    groups.set(option.provider, group);
  });
  return [...groups.values()];
}
