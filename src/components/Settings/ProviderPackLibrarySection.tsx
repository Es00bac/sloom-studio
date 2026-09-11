import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson2,
  FlaskConical,
  GripVertical,
  Import,
  LayoutGrid,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Undo2,
  WandSparkles,
  X,
} from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import { DockableDialog } from '../DockablePanel';
import { ImageNode } from '../Nodes/ImageNode';
import type { ImageProvider, NodeData } from '../../types/flow';
import {
  CARD_WIDTH_MAX,
  CARD_WIDTH_MIN,
  CARD_WIDTH_PRESETS,
  type CardColumnCountV1,
  type CardHandlePlacementV1,
  type CardLayoutContainerV1,
  type CardLayoutElementV1,
  type FlowModelCardV1,
  type ModelFieldV1,
  type ModelCardValidationIssue,
  type ProviderPackDifference,
  type ProviderPackRuntimeRecord,
} from '../../lib/providerPackContracts';
import {
  listModelCardLayoutHandles,
  resolveAllCardHandlePlacements,
  setCardHandlePlacement,
  setCardHandlePlacements,
  type ModelCardLayoutHandle,
} from '../../lib/providerCardHandles';
import {
  autoArrangeCard,
  buildCardFitReport,
  CardLayoutHistory,
  compactCardLayout,
  distributeCardElements,
  moveCardElement,
  resizeCardElement,
  setContainerColumns,
} from '../../lib/providerCardLayout';
import {
  generateProviderPackCommunityPost,
  serializeProviderPack,
} from '../../lib/providerPackPortability';
import {
  discoverProvider,
  type ProviderDiscoveryResult,
} from '../../lib/providerDiscovery';
import {
  initializeProviderPackRegistry,
  providerPackRegistry,
} from '../../lib/providerPackRegistry';
import {
  previewProviderPackRequest,
  executeProviderPackCard,
  resolveBuiltInEngine,
} from '../../lib/providerPackExecution';
import {
  validateModelCard,
  validateProviderPack,
} from '../../lib/providerPackValidation';
import { inspectProviderPackExtension } from '../../lib/providerPackExtension';
import { downloadTextFile } from '../../shared/files/downloads';
import { PROVIDER_PACK_RELEASE_METADATA } from '../../lib/providerPackReleaseMetadata';
import { ModelFieldControl } from '../Nodes/AdaptiveModelCardNode';
import './ProviderPackLibrarySection.css';

export function ProviderPackLibrarySection() {
  useSyncExternalStore(
    providerPackRegistry.subscribe,
    providerPackRegistry.getSnapshot,
    providerPackRegistry.getSnapshot,
  );
  const [query, setQuery] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [builderTarget, setBuilderTarget] = useState<{ record: ProviderPackRuntimeRecord; cardId: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    record: ProviderPackRuntimeRecord;
    differences: ProviderPackDifference[];
  } | null>(null);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    void initializeProviderPackRegistry();
  }, []);
  const records = providerPackRegistry.listRecords();
  const activeRecords = records.filter((record) => record.active);
  const filtered = records.filter((record) => {
    const search = `${record.pack.displayName} ${record.pack.provider.name} ${record.pack.cards.map((card) => card.displayName).join(' ')}`.toLowerCase();
    return search.includes(query.trim().toLowerCase());
  });

  const importFile = async (file: File) => {
    const text = await file.text();
    const imported = await providerPackRegistry.importText(text, {
      provenance: 'community',
      sourceLabel: file.name,
      approveOrigins: false,
      activate: false,
    });
    setPendingImport(imported);
    setNotice(`Imported ${imported.record.pack.displayName} for review. Credentials were not read from the file.`);
  };

  return (
    <section className="provider-pack-library space-y-4 rounded-2xl border border-cyan-300/15 p-4" data-provider-pack-library="true">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Providers &amp; Model Cards</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-400">
            Connect → Discover → Design → Test → Activate. Packs contain no credentials; named local slots stay encrypted on this device.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={primaryButton} onClick={() => setConnectOpen(true)} type="button"><Plus size={13} />Connect provider</button>
          <button className={secondaryButton} onClick={() => inputRef.current?.click()} type="button"><Import size={13} />Import pack</button>
          <input
            ref={inputRef}
            accept=".json,.sloom-provider.json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file).catch((error) => setNotice(error instanceof Error ? error.message : 'Import failed.'));
              event.currentTarget.value = '';
            }}
            type="file"
          />
        </div>
      </div>

      <div className="provider-pack-summary-grid grid gap-2">
        <Summary label="Active providers" value={activeRecords.length} />
        <Summary label="Text cards" value={countModality(activeRecords, 'text')} />
        <Summary label="Image / video" value={countModality(activeRecords, 'image') + countModality(activeRecords, 'video')} />
        <Summary label="Audio cards" value={countModality(activeRecords, 'audio')} />
      </div>

      <label className="flex items-center gap-2 rounded-xl border border-gray-800 bg-[#090e16] px-3 py-2">
        <Search className="text-gray-500" size={14} />
        <input
          className="min-w-0 flex-1 bg-transparent text-xs text-gray-200 outline-none"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search providers or model cards"
          value={query}
        />
      </label>

      {notice ? <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-xs text-cyan-100">{notice}</div> : null}
      {pendingImport ? (
        <ImportReview
          differences={pendingImport.differences}
          onActivate={async () => {
            await providerPackRegistry.approveOrigins(
              pendingImport.record.pack.packId,
              pendingImport.record.hash,
              pendingImport.record.pack.approvedOrigins.map((origin) => origin.origin),
            );
            await providerPackRegistry.activate(pendingImport.record.pack.packId, pendingImport.record.hash);
            setNotice(`${pendingImport.record.pack.displayName} is active. Configure its named credential slots before execution.`);
            setPendingImport(null);
          }}
          onDismiss={() => setPendingImport(null)}
          record={pendingImport.record}
        />
      ) : null}

      <div className="grid gap-3">
        {filtered.map((record) => (
          <ProviderRecordCard
            key={`${record.pack.packId}:${record.hash}:${record.provenance}`}
            onDiscover={() => setConnectOpen(true)}
            onEdit={(cardId) => setBuilderTarget({ record, cardId })}
            onNotice={setNotice}
            record={record}
          />
        ))}
      </div>

      <ConnectProviderDialog
        onClose={() => setConnectOpen(false)}
        onDiscovered={(result, credential, approvedOrigin) => {
          setConnectOpen(false);
          void (async () => {
            const serialized = serializeProviderPack(result.pack);
            const imported = await providerPackRegistry.importText(serialized.json, {
              provenance: 'local',
              sourceLabel: 'Guided discovery',
              approveOrigins: false,
              activate: false,
            });
            await providerPackRegistry.approveOrigins(
              imported.record.pack.packId,
              imported.record.hash,
              [approvedOrigin],
            );
            const slot = result.pack.credentialSlots.find((candidate) =>
              candidate.approvedOrigin === approvedOrigin
            );
            if (slot && credential) await providerPackRegistry.setCredential(result.pack.packId, slot.id, credential);
            setNotice(`Discovered ${result.models.length} model card${result.models.length === 1 ? '' : 's'}. Review and activate when ready.`);
            setPendingImport(imported);
            const first = imported.record.pack.cards[0];
            if (first) setBuilderTarget({ record: imported.record, cardId: first.id });
          })().catch((error) => setNotice(error instanceof Error ? error.message : 'Could not store discovery result.'));
        }}
        open={connectOpen}
      />

      {builderTarget ? (
        <ModelCardBuilderDialog
          cardId={builderTarget.cardId}
          onClose={() => setBuilderTarget(null)}
          onNotice={setNotice}
          record={builderTarget.record}
        />
      ) : null}
    </section>
  );
}

function ProviderRecordCard({
  onDiscover,
  onEdit,
  onNotice,
  record,
}: {
  onDiscover: () => void;
  onEdit: (cardId: string) => void;
  onNotice: (message: string) => void;
  record: ProviderPackRuntimeRecord;
}) {
  const [modelQuery, setModelQuery] = useState('');
  const validation = validateProviderPack(record.pack, { provenance: record.provenance });
  const extensionReport = inspectProviderPackExtension(record, {
    isCredentialConfigured: (slotId) => providerPackRegistry.hasCredential(record.pack.packId, slotId),
    releasePolicy: providerPackRegistry.getReleasePolicy(),
    isSuperseded: providerPackRegistry.listRecords().some((candidate) =>
      candidate.pack.packId === record.pack.packId && candidate.hash !== record.hash && candidate.active
    ),
  });
  const counts = Object.fromEntries(['text', 'image', 'video', 'audio'].map((modality) => [
    modality,
    record.pack.cards.filter((card) => card.modalities.includes(modality as 'text')).length,
  ]));
  const exportPack = () => {
    const serialized = serializeProviderPack(record.pack);
    downloadTextFile(serialized.fileName, serialized.json, 'application/json');
    onNotice(`Started credential-free export. SHA-256 ${serialized.hash}.`);
  };
  const exportPost = () => {
    const post = generateProviderPackCommunityPost({
      pack: record.pack,
      sloomVersion: PROVIDER_PACK_RELEASE_METADATA.minimumSloomVersion,
      testedAt: latestTestDate(record),
      dataHandlingNotes: 'Credentials stay in local encrypted slots and are not included in this post or pack.',
    });
    downloadTextFile(`${record.pack.packId}-${record.pack.version}-community-post.md`, post, 'text/markdown');
  };
  const bundledFallback = providerPackRegistry.listRecords().find((candidate) =>
    candidate.provenance === 'bundled' && candidate.pack.packId === record.pack.packId
  );
  const visibleCards = record.pack.cards.filter((card) => {
    const search = `${card.displayName} ${card.modelId} ${card.modalities.join(' ')} ${card.operations.map((operation) => operation.label).join(' ')}`.toLowerCase();
    return search.includes(modelQuery.trim().toLowerCase());
  });
  return (
    <article className={`rounded-xl border p-3 ${record.active ? 'border-emerald-400/25 bg-emerald-400/[0.04]' : 'border-gray-800 bg-[#0a0f17]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-xs font-semibold text-gray-100">{record.pack.displayName}</h4>
            <StatusBadge record={record} validation={validation} />
          </div>
          <div className="mt-1 text-[10px] text-gray-500">
            {record.provenance} · v{record.pack.version} · {record.hash.slice(0, 12)} · {record.pack.cards.length} models
          </div>
          <div className="mt-1 text-[9px] leading-4 text-gray-600">
            Approved origins: {record.pack.approvedOrigins.map((origin) => origin.origin).join(', ') || 'none'}
            {bundledFallback && record.provenance !== 'bundled'
              ? ` · bundled fallback v${bundledFallback.pack.version} (${bundledFallback.hash.slice(0, 8)})`
              : ''}
          </div>
          <div
            aria-label={`${extensionReport.displayName} declarative extension report`}
            className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-gray-500"
            data-provider-pack-extension-report="true"
            data-provider-pack-extension-readiness={extensionReport.readiness}
          >
            <span className="rounded-full border border-cyan-400/25 px-2 py-0.5 text-cyan-200">Declarative extension</span>
            <span className={`rounded-full border px-2 py-0.5 ${extensionReport.readiness === 'ready'
              ? 'border-emerald-400/30 text-emerald-200'
              : extensionReport.readiness === 'blocked'
                ? 'border-rose-400/30 text-rose-200'
                : 'border-amber-400/30 text-amber-200'}`}
            >
              {extensionReport.readiness}
            </span>
            <span>{extensionReport.cardCount} cards · {extensionReport.operationCount} operations</span>
            <span>{extensionReport.credentialMaterial}</span>
            <span>execution {extensionReport.executionApproved ? 'approved' : 'review required'}</span>
            <span>{extensionReport.supersession}</span>
            <span>release policy {extensionReport.releasePolicy}</span>
            {extensionReport.readinessReasons.length ? <span>{extensionReport.readinessReasons.join(' · ')}</span> : null}
            <span>no arbitrary code</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[9px] text-cyan-300/70">
            {record.pack.provider.documentationUrl ? <a href={record.pack.provider.documentationUrl} rel="noreferrer" target="_blank">Documentation</a> : null}
            {record.pack.provider.privacyUrl ? <a href={record.pack.provider.privacyUrl} rel="noreferrer" target="_blank">Privacy</a> : null}
            {record.pack.provider.termsUrl ? <a href={record.pack.provider.termsUrl} rel="noreferrer" target="_blank">Terms</a> : null}
            {record.pack.release?.forumCategoryUrl ? <a href={record.pack.release.forumCategoryUrl} rel="noreferrer" target="_blank">Forum packs</a> : null}
            {record.pack.release?.githubDiscussionsCategoryUrl ? <a href={record.pack.release.githubDiscussionsCategoryUrl} rel="noreferrer" target="_blank">GitHub Discussions</a> : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1 text-[9px] text-gray-400">
            {Object.entries(counts).map(([modality, count]) => (
              <span className="rounded-full border border-gray-700 px-2 py-0.5" key={modality}>{modality} {count}</span>
            ))}
            {record.pack.credentialSlots.length ? (
              <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-amber-200">
                {record.pack.credentialSlots.every((slot) => providerPackRegistry.hasCredential(record.pack.packId, slot.id)) ? 'configured' : 'needs key'}
              </span>
            ) : <span className="rounded-full border border-gray-700 px-2 py-0.5">no key</span>}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <button className={tinyButton} onClick={onDiscover} type="button"><RefreshCcw size={11} />Discover models</button>
          <button className={tinyButton} onClick={exportPack} type="button"><Download size={11} />Export</button>
          <button className={tinyButton} onClick={exportPost} type="button"><FileJson2 size={11} />Post</button>
          <button
            className={tinyButton}
            onClick={() => {
              const url = record.pack.release?.githubDiscussionsCategoryUrl
                ?? record.pack.provider.documentationUrl;
              if (url) window.open(url, '_blank', 'noopener,noreferrer');
              else onNotice('No update URL is configured for this pack. Import an updated .sloom-provider.json file manually.');
            }}
            type="button"
          ><RefreshCcw size={11} />Check for update</button>
          {record.provenance !== 'bundled' ? (
            <button
              className={tinyButton}
              onClick={() => void providerPackRegistry.removeOverride(record.pack.packId, record.hash)}
              type="button"
            ><Trash2 size={11} />Remove override</button>
          ) : null}
          {record.provenance !== 'bundled' && providerPackRegistry.listRecords().some((candidate) =>
            candidate.provenance === 'bundled' && candidate.pack.packId === record.pack.packId
          ) ? (
            <button className={tinyButton} onClick={() => void providerPackRegistry.restoreBundled(record.pack.packId)} type="button">
              <RotateCcw size={11} />Restore bundled
            </button>
          ) : null}
        </div>
      </div>
      {record.pack.cards.length > 6 ? (
        <label className="mt-3 flex items-center gap-2 rounded-lg border border-gray-800 bg-[#080d14] px-2.5 py-1.5">
          <Search className="text-gray-600" size={11} />
          <input
            className="min-w-0 flex-1 bg-transparent text-[10px] text-gray-300 outline-none"
            onChange={(event) => setModelQuery(event.target.value)}
            placeholder={`Search ${record.pack.cards.length} discovered models`}
            value={modelQuery}
          />
        </label>
      ) : null}
      <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {visibleCards.slice(0, 80).map((card) => (
          <button
            className="rounded-lg border border-gray-800 bg-[#080d14] px-2.5 py-2 text-left hover:border-cyan-300/30"
            key={card.id}
            onClick={() => onEdit(card.id)}
            type="button"
          >
            <span className="flex items-center justify-between gap-2 text-[10px] font-semibold text-gray-200">
              <span className="truncate">{card.displayName}</span><Pencil className="shrink-0 text-gray-600" size={10} />
            </span>
            <span className="mt-1 block truncate text-[9px] text-gray-500">
              {card.operations.map((operation) => operation.label).join(' · ')}
            </span>
            <span className="mt-1 flex flex-wrap gap-1">
              <span className="rounded-full border border-cyan-400/20 px-1.5 py-0.5 text-[8px] font-semibold text-cyan-200/70">
                {confidenceLabel(card.confidence)}
              </span>
              {card.modalities.map((modality) => (
                <span className="rounded-full border border-gray-700 px-1.5 py-0.5 text-[8px] text-gray-500" key={modality}>{modality}</span>
              ))}
            </span>
          </button>
        ))}
        {visibleCards.length > 80 ? (
          <div className="rounded-lg border border-dashed border-gray-800 px-2.5 py-2 text-[10px] text-gray-500">
            {visibleCards.length - 80} more matching cards — narrow the model search.
          </div>
        ) : null}
        {!visibleCards.length ? (
          <div className="rounded-lg border border-dashed border-gray-800 px-2.5 py-2 text-[10px] text-gray-500">
            No model cards match this search.
          </div>
        ) : null}
      </div>
      {record.active && record.pack.credentialSlots.length ? (
        <CredentialSlotControls onNotice={onNotice} record={record} />
      ) : null}
    </article>
  );
}

function CredentialSlotControls({
  onNotice,
  record,
}: {
  onNotice: (message: string) => void;
  record: ProviderPackRuntimeRecord;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="mt-3 rounded-xl border border-gray-800 bg-[#080d14] p-3">
      <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-gray-500">Local credential slots</div>
      <div className="grid gap-2 md:grid-cols-2">
        {record.pack.credentialSlots.map((slot) => (
          <div className="flex items-end gap-2" key={slot.id}>
            <label className="min-w-0 flex-1 text-[10px] text-gray-400">
              <span className="mb-1 block">
                {slot.label} · {new URL(slot.approvedOrigin).origin}
                {providerPackRegistry.hasCredential(record.pack.packId, slot.id) ? ' · configured' : ''}
              </span>
              <input
                className={dialogInput}
                onChange={(event) => setValues((current) => ({ ...current, [slot.id]: event.target.value }))}
                placeholder={providerPackRegistry.hasCredential(record.pack.packId, slot.id) ? 'Replace saved credential' : 'Enter credential'}
                type="password"
                value={values[slot.id] ?? ''}
              />
            </label>
            <button
              className={tinyButton}
              onClick={() => void providerPackRegistry.setCredential(record.pack.packId, slot.id, values[slot.id] ?? '').then(() => {
                setValues((current) => ({ ...current, [slot.id]: '' }));
                onNotice(values[slot.id] ? `Saved ${slot.label} locally.` : `Cleared ${slot.label}.`);
              })}
              type="button"
            >
              <Save size={11} />Save
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectProviderDialog({
  onClose,
  onDiscovered,
  open,
}: {
  onClose: () => void;
  onDiscovered: (result: ProviderDiscoveryResult, credential: string, approvedOrigin: string) => void;
  open: boolean;
}) {
  const [endpoint, setEndpoint] = useState('');
  const [providerName, setProviderName] = useState('');
  const [authType, setAuthType] = useState<'bearer' | 'api-key-header' | 'none'>('bearer');
  const [credential, setCredential] = useState('');
  const [schemaText, setSchemaText] = useState('');
  const [docsUrl, setDocsUrl] = useState('');
  const [sample, setSample] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setWorking(true);
    setError('');
    try {
      const result = await discoverProvider({
        baseEndpoint: endpoint,
        providerName: providerName || undefined,
        authentication: { type: authType, value: credential || undefined },
        schemaText: schemaText || undefined,
        documentationUrl: docsUrl || undefined,
        sampleRequest: sample || undefined,
      });
      onDiscovered(result, credential, new URL(endpoint).origin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Discovery failed.');
    } finally {
      setWorking(false);
    }
  };
  return (
    <DockableDialog
      defaultFloatingRect={{ x: 180, y: 90, width: 760, height: 680 }}
      dialogId="connect-provider"
      minSize={{ width: 320, height: 420 }}
      onClose={onClose}
      open={open}
      title="Connect a provider"
      workspaceId="app-dialogs"
    >
      <div className="theme-panel h-full overflow-y-auto p-5">
        <div className="mb-5 flex items-center gap-2 text-xs text-gray-400">
          {['Connect', 'Discover', 'Design', 'Test', 'Activate'].map((step, index) => (
            <span className={index === 0 ? 'text-cyan-200' : ''} key={step}>{index ? '→ ' : ''}{step}</span>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="API base endpoint *" onChange={setEndpoint} placeholder="https://api.example.com" value={endpoint} />
          <Input label="Provider name — optional" onChange={setProviderName} placeholder="My provider" value={providerName} />
          <label className="text-xs text-gray-400">
            <span className="mb-1.5 block font-semibold">Authentication</span>
            <select className={dialogInput} onChange={(event) => setAuthType(event.target.value as typeof authType)} value={authType}>
              <option value="bearer">Bearer token</option>
              <option value="api-key-header">API key header</option>
              <option value="none">No authentication</option>
            </select>
          </label>
          <Input
            label="Key or token — stored locally"
            onChange={setCredential}
            placeholder={authType === 'none' ? 'Not needed' : 'Credential is never added to the pack'}
            type="password"
            value={credential}
          />
          <Input label="Documentation link — optional" onChange={setDocsUrl} placeholder="https://docs.example.com" value={docsUrl} />
          <label className="text-xs text-gray-400">
            <span className="mb-1.5 block font-semibold">OpenAPI / JSON Schema — optional</span>
            <textarea className={`${dialogInput} min-h-28 resize-y`} onChange={(event) => setSchemaText(event.target.value)} placeholder="Paste JSON schema" value={schemaText} />
            <input
              accept=".json,application/json"
              className="mt-2 block w-full text-[10px] text-gray-500 file:mr-2 file:rounded-md file:border file:border-gray-700 file:bg-[#111722] file:px-2 file:py-1 file:text-gray-300"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) {
                  setError('Schema files are limited to 10 MiB.');
                  event.currentTarget.value = '';
                  return;
                }
                void file.text().then(setSchemaText).catch(() => setError('Could not read the schema file.'));
                event.currentTarget.value = '';
              }}
              type="file"
            />
          </label>
          <label className="text-xs text-gray-400 md:col-span-2">
            <span className="mb-1.5 block font-semibold">Sample cURL or JSON request — optional</span>
            <textarea className={`${dialogInput} min-h-28 resize-y font-mono`} onChange={(event) => setSample(event.target.value)} placeholder="Parsed as text only. Sloom never invokes a shell." value={sample} />
          </label>
        </div>
        <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-[11px] leading-5 text-emerald-100/80">
          Credentials are sent only to the exact origin above. Cross-origin schemas are fetched without credentials. Redirects never carry credentials.
        </div>
        {error ? <div className="mt-3 rounded-lg border border-rose-400/30 bg-rose-400/10 p-2 text-xs text-rose-100">{error}</div> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button className={secondaryButton} onClick={onClose} type="button">Cancel</button>
          <button className={primaryButton} disabled={!endpoint || working} onClick={() => void run()} type="button">
            {working ? <RefreshCcw className="animate-spin" size={13} /> : <WandSparkles size={13} />}
            {working ? 'Discovering…' : 'Discover models'}
          </button>
        </div>
      </div>
    </DockableDialog>
  );
}

function ModelCardBuilderDialog({
  cardId,
  onClose,
  onNotice,
  record,
}: {
  cardId: string;
  onClose: () => void;
  onNotice: (message: string) => void;
  record: ProviderPackRuntimeRecord;
}) {
  const [pack, setPack] = useState(() => clone(record.pack));
  const [selectedElementId, setSelectedElementId] = useState<string>();
  const [selectedHandleId, setSelectedHandleId] = useState<string>();
  const [operationId, setOperationId] = useState(() =>
    record.pack.cards.find((card) => card.id === cardId)?.operations[0]?.id ?? ''
  );
  const [requestPreview, setRequestPreview] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testValues, setTestValues] = useState<Record<string, unknown>>({});
  const [testedOperations, setTestedOperations] = useState<Set<string>>(() => new Set(
    Object.entries(record.testStatusByOperation)
      .filter(([, status]) => status === 'passed')
      .map(([key]) => key.split(':').at(-1) ?? ''),
  ));
  const [mobilePane, setMobilePane] = useState<'fields' | 'preview' | 'inspector'>('preview');
  const [measuredCardHeight, setMeasuredCardHeight] = useState<number>();
  const cardIndex = pack.cards.findIndex((card) => card.id === cardId);
  const card = pack.cards[cardIndex];
  const [history] = useState(() => {
    const initialCard = record.pack.cards.find((candidate) => candidate.id === cardId);
    return initialCard ? new CardLayoutHistory(initialCard.layout) : null;
  });
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });
  const operation = card?.operations.find((candidate) => candidate.id === operationId) ?? card?.operations[0];
  const issues = card
    ? validateModelCard(
        card,
        new Set(pack.transports.map((transport) => transport.id)),
        new Set(pack.optionCatalogs.map((catalog) => catalog.id)),
        record.provenance,
      )
    : [];
  const fit = card && operation ? buildCardFitReport(card, operation) : undefined;
  const selectedElement = card?.layout.elements.find((element) => element.id === selectedElementId);
  const selectedField = selectedElement?.fieldId
    ? card?.fields.find((field) => field.id === selectedElement.fieldId)
    : undefined;
  const selectedContainer = selectedElement
    ? card?.layout.containers.find((container) => container.id === selectedElement.containerId)
    : undefined;
  const selectedColumns = selectedContainer
    ? selectedContainer.operationColumns?.[operation?.id ?? ''] ?? selectedContainer.columns ?? 1
    : 1;
  const layoutHandles = card && operation ? listModelCardLayoutHandles(card, operation) : [];
  const resolvedLayoutHandles = card
    ? resolveAllCardHandlePlacements(card.layout, layoutHandles)
    : [];
  const selectedHandle = resolvedLayoutHandles.find(({ handle }) => handle.portId === selectedHandleId);
  const selectedElementHandles = selectedElement
    ? resolvedLayoutHandles.filter(({ handle }) => handle.elementId === selectedElement.id)
    : [];
  useEffect(() => {
    if (
      selectedHandleId
      && selectedElement
      && !selectedElementHandles.some(({ handle }) => handle.portId === selectedHandleId)
    ) {
      setSelectedHandleId(undefined);
    }
  }, [selectedElement, selectedElementHandles, selectedHandleId]);
  const selectedTransport = card && operation
    ? pack.transports.find((transport) => transport.id === operation.transportProfileId)
    : undefined;
  useEffect(() => {
    if (!card || !operation) return;
    void previewProviderPackRequest({
      pack,
      card,
      operationId: operation.id,
      values: Object.fromEntries(card.fields.flatMap((field) =>
        testValues[field.id] === undefined && field.defaultValue === undefined
          ? []
          : [[field.id, testValues[field.id] ?? field.defaultValue]]
      )),
    }).then((preview) => setRequestPreview(preview.text)).catch((error) => setRequestPreview(error instanceof Error ? error.message : 'Preview unavailable.'));
  }, [card, operation, pack, testValues]);
  if (!card || !operation) return null;

  const updateCard = (next: FlowModelCardV1) => {
    setPack((current) => ({
      ...current,
      cards: current.cards.map((candidate) => candidate.id === next.id ? next : candidate),
    }));
  };
  const commitLayout = (layout: FlowModelCardV1['layout']) => {
    history?.commit(layout);
    setHistoryAvailability({
      canUndo: history?.canUndo ?? false,
      canRedo: history?.canRedo ?? false,
    });
    updateCard({ ...card, layout });
  };
  const undo = () => {
    if (!history) return;
    updateCard({ ...card, layout: history.undo() });
    setHistoryAvailability({
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
  };
  const redo = () => {
    if (!history) return;
    updateCard({ ...card, layout: history.redo() });
    setHistoryAvailability({
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
  };
  const saveDraft = async () => {
    const version = incrementPatch(pack.version);
    const draftPack = { ...pack, version };
    await providerPackRegistry.saveDraft(`${pack.packId}:${version}`, draftPack);
    onNotice(`Saved editable draft ${version}. Drafts can remain incomplete and cannot execute while blocking issues remain.`);
  };
  const activate = async () => {
    const activationPack = clone(pack);
    activationPack.version = incrementPatch(pack.version);
    activationPack.cards = activationPack.cards.map((candidate) => candidate.id === card.id
      ? {
          ...candidate,
          status: candidate.operations.every((candidateOperation) => testedOperations.has(candidateOperation.id))
            ? 'tested'
            : 'ready-untested',
        }
      : candidate
    );
    const validation = validateProviderPack(activationPack, { provenance: record.provenance });
    if (!validation.activatable) {
      setTestMessage(validation.issues.find((issue) => issue.severity === 'blocking')?.message ?? 'Fix blocking issues before activation.');
      return;
    }
    const serialized = serializeProviderPack(activationPack);
    const imported = await providerPackRegistry.importText(serialized.json, {
      provenance: 'local',
      sourceLabel: 'Model Card Builder',
      approveOrigins: true,
      activate: true,
    });
    for (const testedOperation of testedOperations) {
      await providerPackRegistry.setOperationTestStatus(
        imported.record.pack.packId,
        imported.record.hash,
        card.id,
        testedOperation,
        'passed',
      );
    }
    onNotice(`Activated ${imported.record.pack.displayName} ${imported.record.pack.version}. Live testing remains optional.`);
    onClose();
  };
  const optionalTest = async () => {
    if (pack.approvedOrigins.some((origin) => !record.trustApprovedOrigins.includes(origin.origin))) {
      setTestMessage('Approve every exact origin in the import review before sending a live test.');
      return;
    }
    if (resolveBuiltInEngine(pack, card, operation.id)) {
      setTestMessage('This bundled card uses a registered Sloom engine. Add it to Flow and run it there to retain normal spend confirmation and cancellation.');
      return;
    }
    setTestMessage('Running a live provider test. This request may incur provider charges…');
    try {
      const result = await executeProviderPackCard({
        pack,
        card: { ...card, status: 'ready-untested' },
        operationId: operation.id,
        values: {
          ...Object.fromEntries(card.fields.flatMap((field) =>
            field.defaultValue === undefined ? [] : [[field.id, field.defaultValue]]
          )),
          ...testValues,
        },
      });
      setTestedOperations((current) => new Set([...current, operation.id]));
      await providerPackRegistry.setOperationTestStatus(
        record.pack.packId,
        record.hash,
        card.id,
        operation.id,
        'passed',
      );
      setTestMessage(`Live test passed: ${result.statusMessage}`);
    } catch (error) {
      await providerPackRegistry.setOperationTestStatus(
        record.pack.packId,
        record.hash,
        card.id,
        operation.id,
        'failed',
      );
      setTestMessage(error instanceof Error ? `Live test failed: ${error.message}` : 'Live test failed.');
    }
  };
  const updateField = (fieldId: string, patch: Partial<FlowModelCardV1['fields'][number]>) => {
    updateCard({
      ...card,
      fields: card.fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field),
      operations: card.operations.map((candidate) => ({
        ...candidate,
        requestBindings: candidate.requestBindings?.map((binding) =>
          binding.fieldId === fieldId && patch.apiPath
            ? { ...binding, requestPath: patch.apiPath }
            : binding
        ),
      })),
    });
  };
  const updateOperation = (patch: Partial<FlowModelCardV1['operations'][number]>) => {
    updateCard({
      ...card,
      operations: card.operations.map((candidate) =>
        candidate.id === operation.id ? { ...candidate, ...patch } : candidate
      ),
    });
  };
  const duplicateSelectedField = () => {
    if (!selectedField || !selectedElement) return;
    let suffix = 2;
    while (card.fields.some((field) => field.id === `${selectedField.id}-${suffix}`)) suffix += 1;
    const id = `${selectedField.id}-${suffix}`;
    const apiPath = `${selectedField.apiPath}_${suffix}`;
    const field = { ...clone(selectedField), id, apiPath, label: `${selectedField.label} ${suffix}` };
    const elementId = `field:${id}`;
    updateCard({
      ...card,
      fields: [...card.fields, field],
      operations: card.operations.map((candidate) =>
        selectedField.operationIds.includes(candidate.id)
          ? {
              ...candidate,
              visibleFieldIds: [...candidate.visibleFieldIds, id],
              inputPortFieldIds: selectedField.connectable ? [...candidate.inputPortFieldIds, id] : candidate.inputPortFieldIds,
              requestBindings: [
                ...(candidate.requestBindings ?? []),
                { fieldId: id, requestPath: apiPath, omitWhenEmpty: !field.required, encoding: field.encoding },
              ],
            }
          : candidate
      ),
      layout: {
        ...card.layout,
        elements: [...card.layout.elements, {
          ...clone(selectedElement),
          id: elementId,
          fieldId: id,
          order: card.layout.elements.length,
          x: (selectedElement.x ?? 0) + 16,
          y: (selectedElement.y ?? 0) + 16,
        }],
      },
    });
    setSelectedElementId(elementId);
  };
  const moveSelectedToAdvanced = () => {
    if (!selectedElement) return;
    const existing = card.layout.containers.find((container) =>
      container.kind === 'collapsible' && /advanced/i.test(container.label ?? container.id)
    );
    const advancedId = existing?.id ?? 'advanced';
    commitLayout({
      ...card.layout,
      containers: existing ? card.layout.containers : [...card.layout.containers, {
        id: advancedId,
        kind: 'collapsible',
        label: 'Advanced — optional',
        order: Math.max(0, ...card.layout.containers.map((container) => container.order)) + 1,
        columns: 2,
        collapsedByDefault: true,
      }],
      elements: card.layout.elements.map((element) =>
        element.id === selectedElement.id
          ? { ...element, containerId: advancedId, hidden: false }
          : element
      ),
    });
  };
  const applyIssueRepair = (issue: ModelCardValidationIssue) => {
    if (issue.elementId) setSelectedElementId(issue.elementId);
    if (issue.repair?.id === 'auto-arrange') {
      commitLayout(autoArrangeCard(card, { operationId: issue.operationId ?? operation.id }));
      return;
    }
    if (issue.repair?.id === 'increase-width') {
      commitLayout({
        ...card.layout,
        width: Math.min(CARD_WIDTH_MAX, Math.max(CARD_WIDTH_PRESETS.wide, card.layout.width + 130)),
      });
      return;
    }
    if (issue.repair?.id === 'four-columns') {
      const containerId = issue.containerId ?? selectedElement?.containerId;
      if (containerId) commitLayout(setContainerColumns(card.layout, containerId, 4, operation.id));
      return;
    }
    if (issue.repair?.id === 'move-inside' && issue.elementId) {
      const fallbackContainerId = card.layout.containers[0]?.id;
      commitLayout({
        ...moveCardElement(card.layout, issue.elementId, { x: 0, y: 0 }).layout,
        elements: card.layout.elements.map((element) =>
          element.id === issue.elementId
            ? {
                ...element,
                containerId: card.layout.containers.some((container) => container.id === element.containerId)
                  ? element.containerId
                  : fallbackContainerId ?? element.containerId,
                hidden: false,
                x: 0,
                y: 0,
              }
            : element
        ),
      });
      return;
    }
    if (issue.repair?.id === 'move-to-advanced') {
      moveSelectedToAdvanced();
      return;
    }
    if (issue.repair?.id === 'bind-source-image' && issue.fieldId) {
      const field = card.fields.find((candidate) => candidate.id === issue.fieldId);
      if (!field) return;
      const isImageRole = ['source-image', 'mask', 'reference-image', 'control-image', 'start-frame', 'end-frame']
        .includes(field.semanticRole);
      const valueType = isImageRole ? 'image' : field.valueType;
      updateCard({
        ...card,
        fields: card.fields.map((candidate) => candidate.id === field.id
          ? {
              ...candidate,
              valueType,
              connectable: true,
              control: candidate.cardinality === 'many' ? 'reference-gallery' : 'media',
              constraints: candidate.cardinality === 'many' && !candidate.constraints?.maxItems
                ? { ...candidate.constraints, visiblePortCount: candidate.constraints?.visiblePortCount ?? 4 }
                : candidate.constraints,
            }
          : candidate
        ),
        operations: card.operations.map((candidate) =>
          field.operationIds.includes(candidate.id) && !candidate.inputPortFieldIds.includes(field.id)
            ? { ...candidate, inputPortFieldIds: [...candidate.inputPortFieldIds, field.id] }
            : candidate
        ),
      });
      return;
    }
    if (issue.repair?.id === 'add-output') {
      const targetOperationId = issue.operationId ?? operation.id;
      const targetOperation = card.operations.find((candidate) => candidate.id === targetOperationId) ?? operation;
      const existingPrimary = card.outputs.find((output) => output.primary)
        ?? card.outputs.find((output) => targetOperation.outputIds.includes(output.id));
      const modality = card.modalities[0] ?? 'text';
      const output = existingPrimary ?? {
        id: `${modality}-output`,
        label: `${modality[0].toUpperCase()}${modality.slice(1)} output`,
        semanticRole: `${modality}-output` as FlowModelCardV1['outputs'][number]['semanticRole'],
        resultType: modality as FlowModelCardV1['outputs'][number]['resultType'],
        cardinality: 'one' as const,
        primary: true,
        operationIds: [targetOperation.id],
      };
      const outputContainer = card.layout.containers.find((container) => container.kind === 'pinned-media');
      const containerId = outputContainer?.id ?? 'output';
      const hasElement = card.layout.elements.some((element) => element.outputId === output.id);
      updateCard({
        ...card,
        outputs: existingPrimary ? card.outputs : [...card.outputs, output],
        operations: card.operations.map((candidate) => {
          if (candidate.id !== targetOperation.id) return candidate;
          const transport = pack.transports.find((entry) => entry.id === candidate.transportProfileId);
          const hasExtraction = (candidate.outputExtractions ?? []).some((entry) => entry.outputId === output.id);
          const extraction = transport?.kind === 'sse'
            ? { outputId: output.id, kind: 'sse-text' as const, pointer: '/delta' }
            : { outputId: output.id, kind: 'json-pointer' as const, pointer: '/output' };
          return {
            ...candidate,
            outputIds: candidate.outputIds.includes(output.id)
              ? candidate.outputIds
              : [...candidate.outputIds, output.id],
            outputExtractions: transport?.kind === 'built-in' || hasExtraction
              ? candidate.outputExtractions
              : [...(candidate.outputExtractions ?? []), extraction],
          };
        }),
        layout: {
          ...card.layout,
          containers: outputContainer ? card.layout.containers : [...card.layout.containers, {
            id: containerId,
            kind: 'pinned-media',
            label: 'Output',
            order: Math.max(0, ...card.layout.containers.map((container) => container.order)) + 1,
            columns: 1,
          }],
          elements: hasElement ? card.layout.elements : [...card.layout.elements, {
            id: `output:${output.id}`,
            outputId: output.id,
            containerId,
            order: card.layout.elements.length,
          }],
        },
      });
    }
  };

  return (
    <DockableDialog
      bodyClassName="min-h-0 flex-1 overflow-hidden p-0"
      defaultFloatingRect={{ x: 32, y: 40, width: 1480, height: 900 }}
      dialogId={`model-card-builder-${safeDomId(card.id)}`}
      minSize={{ width: 320, height: 480 }}
      onClose={onClose}
      open
      title={`Model Card Builder — ${card.displayName}`}
      workspaceId="app-dialogs"
    >
      <div className="provider-card-builder theme-panel flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-3 py-2">
          <button className={tinyButton} disabled={!historyAvailability.canUndo} onClick={undo} type="button"><Undo2 size={11} />Undo</button>
          <button className={tinyButton} disabled={!historyAvailability.canRedo} onClick={redo} type="button"><RefreshCcw size={11} />Redo</button>
          <button className={tinyButton} onClick={() => commitLayout(autoArrangeCard({ ...card, layout: card.layout }, { operationId: operation.id }))} type="button"><WandSparkles size={11} />Auto Arrange</button>
          <button className={tinyButton} onClick={() => commitLayout(compactCardLayout(card))} type="button"><LayoutGrid size={11} />Compact Card</button>
          <select className={smallSelect} onChange={(event) => setOperationId(event.target.value)} value={operation.id}>
            {card.operations.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
          <select
            className={smallSelect}
            onChange={(event) => commitLayout({ ...card.layout, fitTarget: event.target.value as '1080p' })}
            value={card.layout.fitTarget}
          >
            <option value="1080p">1080p fit</option>
            <option value="1440p">1440p fit</option>
            <option value="4k">4K fit</option>
          </select>
          <span className={`ml-auto rounded-full border px-2 py-1 text-[10px] ${issues.some((issue) => issue.severity === 'blocking') ? 'border-rose-400/35 text-rose-200' : 'border-emerald-400/35 text-emerald-200'}`}>
            {issues.filter((issue) => issue.severity === 'blocking').length} blocking · {issues.filter((issue) => issue.severity === 'warning').length} warnings
          </span>
          <button className={secondaryButton} onClick={() => void saveDraft()} type="button"><Save size={12} />Save draft</button>
          <button className={primaryButton} onClick={() => void activate()} type="button"><ShieldCheck size={12} />Activate</button>
        </div>

        <div className="provider-card-builder-pane-tabs flex gap-1 border-b border-gray-800 p-2">
          {(['fields', 'preview', 'inspector'] as const).map((pane) => (
            <button
              className={mobilePane === pane ? primaryButton : tinyButton}
              key={pane}
              onClick={() => setMobilePane(pane)}
              type="button"
            >
              {pane}
            </button>
          ))}
        </div>

        <div className="provider-card-builder-grid grid min-h-0 flex-1">
          <aside
            className="provider-card-builder-pane min-h-0 overflow-y-auto border-r border-gray-800 p-3"
            data-pane-active={mobilePane === 'fields'}
          >
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Available fields</h4>
            <p className="mt-1 text-[9px] leading-4 text-gray-600">Select a field, or duplicate one as a starting point for a new provider parameter.</p>
            <div className="mt-2 grid gap-1">
              {card.fields.map((field) => {
                const element = card.layout.elements.find((candidate) => candidate.fieldId === field.id);
                return (
                  <button
                    className={`rounded-lg border px-2.5 py-2 text-left ${selectedElementId === element?.id ? 'border-cyan-300/45 bg-cyan-400/10' : 'border-gray-800 bg-[#090e16]'}`}
                    draggable={Boolean(element)}
                    key={field.id}
                    onClick={() => setSelectedElementId(element?.id)}
                    onDragStart={(event) => {
                      if (!element) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData(MODEL_CARD_ELEMENT_DRAG_TYPE, element.id);
                    }}
                    title={element ? 'Drag this real control onto a group in the card preview' : undefined}
                    type="button"
                  >
                    <span className="block text-[10px] font-semibold text-gray-200">{field.label}{field.required ? ' *' : ''}</span>
                    <span className="mt-0.5 block text-[9px] text-gray-500">{field.semanticRole} · {field.valueType}{field.cardinality === 'many' ? ` ×${field.constraints?.maxItems ?? '?'}` : ''}</span>
                  </button>
                );
              })}
            </div>
            {card.outputs.length ? (
              <>
                <h4 className="mt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Outputs</h4>
                <div className="mt-2 grid gap-1">
                  {card.outputs.map((output) => {
                    const element = card.layout.elements.find((candidate) => candidate.outputId === output.id);
                    return (
                      <button
                        className={`rounded-lg border px-2.5 py-2 text-left ${
                          selectedElementId === element?.id
                            ? 'border-violet-300/45 bg-violet-400/10'
                            : 'border-gray-800 bg-[#090e16]'
                        }`}
                        draggable={Boolean(element)}
                        key={output.id}
                        onClick={() => setSelectedElementId(element?.id)}
                        onDragStart={(event) => {
                          if (!element) {
                            event.preventDefault();
                            return;
                          }
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData(MODEL_CARD_ELEMENT_DRAG_TYPE, element.id);
                        }}
                        title={element ? 'Drag this real output panel anywhere in the card' : undefined}
                        type="button"
                      >
                        <span className="block text-[10px] font-semibold text-gray-200">{output.label}</span>
                        <span className="mt-0.5 block text-[9px] text-gray-500">{output.resultType} output</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}
          </aside>

          <main
            className="provider-card-builder-pane min-h-0 overflow-auto bg-[#060a10] p-4 lg:p-8"
            data-pane-active={mobilePane === 'preview'}
          >
            <BuilderCanvas
              card={card}
              onCommitLayout={commitLayout}
              onOperationChange={setOperationId}
              onMeasuredHeight={setMeasuredCardHeight}
              onSelect={setSelectedElementId}
              onSelectHandle={(handleId, elementId) => {
                setSelectedHandleId(handleId);
                if (elementId) setSelectedElementId(elementId);
              }}
              operationId={operation.id}
              packId={pack.packId}
              providerName={pack.provider.name}
              selectedElementId={selectedElementId}
              selectedHandleId={selectedHandleId}
            />
          </main>

          <aside
            className="provider-card-builder-pane min-h-0 overflow-y-auto border-l border-gray-800 p-3"
            data-pane-active={mobilePane === 'inspector'}
          >
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Inspector</h4>
            <div className="mt-3 space-y-3 rounded-xl border border-cyan-300/15 bg-cyan-400/5 p-3" data-visual-layout-sliders="true">
              <VisualRange
                label="Card width"
                max={CARD_WIDTH_MAX}
                min={CARD_WIDTH_MIN}
                onChange={(width) => commitLayout({ ...card.layout, width })}
                step={10}
                suffix="px"
                value={card.layout.width}
              />
              {selectedContainer ? (
                <VisualRange
                  label="Group columns"
                  max={14}
                  min={1}
                  onChange={(columns) => commitLayout(setContainerColumns(
                    card.layout,
                    selectedContainer.id,
                    columns as CardColumnCountV1,
                    operation.id,
                  ))}
                  step={1}
                  value={selectedColumns}
                />
              ) : null}
              {selectedContainer?.kind === 'reference-gallery' ? (
                <VisualRange
                  label="Reference tile height"
                  max={240}
                  min={64}
                  onChange={(height) => commitLayout({
                    ...card.layout,
                    containers: card.layout.containers.map((container) =>
                      container.id === selectedContainer.id ? { ...container, height } : container
                    ),
                  })}
                  step={4}
                  suffix="px"
                  value={selectedContainer.height ?? galleryItemHeightForColumns(selectedColumns)}
                />
              ) : null}
              {selectedElement && selectedContainer?.kind !== 'freeform' ? (
                <VisualRange
                  label="Control span"
                  max={selectedColumns}
                  min={1}
                  onChange={(columnSpan) => commitLayout({
                    ...card.layout,
                    elements: card.layout.elements.map((element) =>
                      element.id === selectedElement.id
                        ? { ...element, columnSpan: columnSpan as CardColumnCountV1 }
                        : element
                    ),
                  })}
                  step={1}
                  value={Math.min(
                    selectedColumns,
                    selectedElement.columnSpan ?? (selectedField?.control === 'reference-gallery' ? selectedColumns : 1),
                  )}
                />
              ) : null}
              {selectedElement ? (
                <>
                  <VisualRange
                    label="Element width"
                    max={card.layout.width}
                    min={32}
                    onChange={(width) => commitLayout(resizeCardElement(card.layout, selectedElement.id, {
                      width,
                      height: selectedElement.height ?? 54,
                    }))}
                    step={2}
                    suffix="px"
                    value={Math.min(card.layout.width, selectedElement.width ?? Math.max(32, card.layout.width - 24))}
                  />
                  <VisualRange
                    label="Element height"
                    max={1_040}
                    min={32}
                    onChange={(height) => commitLayout(resizeCardElement(card.layout, selectedElement.id, {
                      width: selectedElement.width ?? Math.max(32, card.layout.width - 24),
                      height,
                    }))}
                    step={2}
                    suffix="px"
                    value={selectedElement.height ?? 54}
                  />
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      className={tinyButton}
                      onClick={() => {
                        const firstContainer = [...card.layout.containers]
                          .sort((left, right) => left.order - right.order)[0];
                        const firstElement = firstContainer
                          ? card.layout.elements
                              .filter((element) =>
                                element.containerId === firstContainer.id && element.id !== selectedElement.id
                              )
                              .sort((left, right) => left.order - right.order)[0]
                          : undefined;
                        if (firstContainer) {
                          commitLayout(reorderCardElement(
                            card.layout,
                            selectedElement.id,
                            firstContainer.id,
                            firstElement?.id,
                          ));
                        }
                      }}
                      type="button"
                    >
                      Move to card top
                    </button>
                    <button
                      className={tinyButton}
                      onClick={() => {
                        const lastContainer = [...card.layout.containers]
                          .sort((left, right) => right.order - left.order)[0];
                        if (lastContainer) {
                          commitLayout(reorderCardElement(
                            card.layout,
                            selectedElement.id,
                            lastContainer.id,
                          ));
                        }
                      }}
                      type="button"
                    >
                      Move to card bottom
                    </button>
                  </div>
                </>
              ) : null}
              <div className="text-[9px] leading-4 text-cyan-100/55">
                Drag the grip on any real control to reorder it or move it into another group.
              </div>
            </div>
            {selectedElementHandles.length ? (
              <div className="mt-3 rounded-xl border border-violet-300/20 bg-violet-400/5 p-3" data-handle-layout-inspector="true">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-semibold text-violet-100">Flow handles</div>
                  <span className="text-[9px] text-violet-200/55">{selectedElementHandles.length} on this control</span>
                </div>
                <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                  {selectedElementHandles.map(({ handle }, index) => (
                    <button
                      aria-label={`Edit handle ${handle.label}`}
                      className={selectedHandleId === handle.portId ? primaryButton : tinyButton}
                      key={handle.portId}
                      onClick={() => setSelectedHandleId(handle.portId)}
                      title={handle.portId}
                      type="button"
                    >
                      {handle.index === undefined ? handle.label : index + 1}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  <button
                    className={tinyButton}
                    onClick={() => commitLayout(setCardHandlePlacements(
                      card.layout,
                      selectedElementHandles.map(({ handle }) => handle),
                      { anchor: 'element', elementId: selectedElement?.id },
                    ))}
                    type="button"
                  >
                    Attach all to control
                  </button>
                  <button
                    className={tinyButton}
                    onClick={() => commitLayout(setCardHandlePlacements(
                      card.layout,
                      selectedElementHandles.map(({ handle }) => handle),
                      { anchor: 'card', elementId: undefined },
                    ))}
                    type="button"
                  >
                    Attach all to card
                  </button>
                </div>
                {selectedHandle ? (
                  <div className="mt-3 space-y-2 border-t border-violet-300/15 pt-3">
                    <div className="text-[9px] font-semibold text-violet-100">{selectedHandle.handle.label}</div>
                    <label className="block text-[9px] text-gray-500">
                      Attach handle to
                      <select
                        className={`${dialogInput} mt-1`}
                        onChange={(event) => commitLayout(setCardHandlePlacement(
                          card.layout,
                          selectedHandle.handle.portId,
                          event.target.value === 'element'
                            ? { anchor: 'element', elementId: selectedHandle.handle.elementId ?? selectedElement?.id }
                            : { anchor: 'card', elementId: undefined },
                          selectedHandle.placement,
                        ))}
                        value={selectedHandle.placement.anchor}
                      >
                        <option value="card">Main card edge</option>
                        <option disabled={!selectedHandle.handle.elementId} value="element">This control edge</option>
                      </select>
                    </label>
                    <div>
                      <div className="mb-1 text-[9px] text-gray-500">Handle side</div>
                      <div className="grid grid-cols-4 gap-1">
                        {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
                          <button
                            className={selectedHandle.placement.side === side ? primaryButton : tinyButton}
                            key={side}
                            onClick={() => commitLayout(setCardHandlePlacement(
                              card.layout,
                              selectedHandle.handle.portId,
                              { side },
                              selectedHandle.placement,
                            ))}
                            type="button"
                          >
                            {side}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[9px] text-gray-500">Corner presets</div>
                      <div className="grid grid-cols-4 gap-1">
                        {([
                          ['top', 0, 'Top left'],
                          ['top', 100, 'Top right'],
                          ['bottom', 0, 'Bottom left'],
                          ['bottom', 100, 'Bottom right'],
                        ] as const).map(([side, offsetPercent, label]) => (
                          <button
                            className={tinyButton}
                            key={label}
                            onClick={() => commitLayout(setCardHandlePlacement(
                              card.layout,
                              selectedHandle.handle.portId,
                              { side, offsetPercent },
                              selectedHandle.placement,
                            ))}
                            title={label}
                            type="button"
                          >
                            {label.replace('Top ', 'T').replace('Bottom ', 'B').replace('left', 'L').replace('right', 'R')}
                          </button>
                        ))}
                      </div>
                    </div>
                    <VisualRange
                      label="Position on edge"
                      max={100}
                      min={0}
                      onChange={(offsetPercent) => commitLayout(setCardHandlePlacement(
                        card.layout,
                        selectedHandle.handle.portId,
                        { offsetPercent },
                        selectedHandle.placement,
                      ))}
                      step={1}
                      suffix="%"
                      value={selectedHandle.placement.offsetPercent}
                    />
                  </div>
                ) : (
                  <div className="mt-2 text-[9px] leading-4 text-violet-100/55">
                    Select a numbered handle on the card or above to place it precisely.
                  </div>
                )}
              </div>
            ) : null}
            {selectedField && selectedElement ? (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-gray-100">{selectedField.label}</div>
                  <div className="mt-1 text-[10px] leading-4 text-gray-500">{selectedField.description ?? 'No description supplied.'}</div>
                </div>
                <label className="block text-[10px] text-gray-400">
                  Container
                  <select
                    className={`${dialogInput} mt-1`}
                    onChange={(event) => commitLayout({
                      ...card.layout,
                      elements: card.layout.elements.map((element) =>
                        element.id === selectedElement.id ? { ...element, containerId: event.target.value } : element
                      ),
                    })}
                    value={selectedElement.containerId}
                  >
                    {card.layout.containers.map((container) => <option key={container.id} value={container.id}>{container.label ?? container.id}</option>)}
                  </select>
                </label>
                <button
                  className={secondaryButton}
                  onClick={() => commitLayout({
                    ...card.layout,
                    elements: card.layout.elements.map((element) =>
                      element.id === selectedElement.id ? { ...element, hidden: !element.hidden } : element
                    ),
                  })}
                  type="button"
                >
                  {selectedElement.hidden ? 'Show control' : 'Hide control'}
                </button>
                <button className={secondaryButton} onClick={duplicateSelectedField} type="button">
                  <Plus size={12} />Duplicate as new field
                </button>
                <button className={secondaryButton} onClick={moveSelectedToAdvanced} type="button">
                  Move into Advanced
                </button>
                {selectedContainer?.kind === 'freeform' ? (
                  <div className="grid grid-cols-2 gap-1">
                    <button className={tinyButton} onClick={() => commitLayout(moveCardElement(card.layout, selectedElement.id, { x: 0, y: selectedElement.y ?? 0 }).layout)} type="button">Align left</button>
                    <button className={tinyButton} onClick={() => commitLayout(moveCardElement(card.layout, selectedElement.id, { x: selectedElement.x ?? 0, y: 0 }).layout)} type="button">Align top</button>
                    <button
                      className={tinyButton}
                      onClick={() => commitLayout(distributeCardElements(
                        card.layout,
                        card.layout.elements.filter((element) => element.containerId === selectedContainer.id).map((element) => element.id),
                        'x',
                      ))}
                      type="button"
                    >Distribute X</button>
                    <button
                      className={tinyButton}
                      onClick={() => commitLayout(distributeCardElements(
                        card.layout,
                        card.layout.elements.filter((element) => element.containerId === selectedContainer.id).map((element) => element.id),
                        'y',
                      ))}
                      type="button"
                    >Distribute Y</button>
                  </div>
                ) : null}
                {selectedContainer ? (
                  <label className="block text-[10px] text-gray-400">
                    Container style
                    <select
                      className={`${dialogInput} mt-1`}
                      onChange={(event) => commitLayout({
                        ...card.layout,
                        containers: card.layout.containers.map((container) =>
                          container.id === selectedContainer.id
                            ? { ...container, kind: event.target.value as typeof container.kind }
                            : container
                        ),
                      })}
                      value={selectedContainer.kind}
                    >
                      {['freeform', 'grid', 'reference-gallery', 'collapsible', 'tabs', 'inline-row', 'pinned-media'].map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="rounded-xl border border-gray-800 bg-[#090e16] p-3">
                  <div className="text-[10px] font-semibold text-gray-300">Advanced — optional</div>
                  <div className="mt-2 grid gap-2 text-[9px]">
                    <div><div className="text-gray-600">Immutable field ID</div><div className="break-all text-gray-300">{selectedField.id}</div></div>
                    <InspectorInput
                      label="Request path"
                      onChange={(value) => updateField(selectedField.id, { apiPath: value })}
                      value={selectedField.apiPath}
                    />
                    <label className="text-gray-600">
                      Semantic role
                      <select className={`${dialogInput} mt-1`} onChange={(event) => updateField(selectedField.id, { semanticRole: event.target.value as typeof selectedField.semanticRole })} value={selectedField.semanticRole}>
                        {FIELD_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                      </select>
                    </label>
                    <label className="text-gray-600">
                      Value type
                      <select className={`${dialogInput} mt-1`} onChange={(event) => updateField(selectedField.id, { valueType: event.target.value as typeof selectedField.valueType })} value={selectedField.valueType}>
                        {FIELD_TYPES.map((valueType) => <option key={valueType} value={valueType}>{valueType}</option>)}
                      </select>
                    </label>
                    <label className="text-gray-600">
                      Encoding
                      <select className={`${dialogInput} mt-1`} onChange={(event) => updateField(selectedField.id, { encoding: event.target.value as typeof selectedField.encoding })} value={selectedField.encoding ?? 'json'}>
                        {FIELD_ENCODINGS.map((encoding) => <option key={encoding} value={encoding}>{encoding}</option>)}
                      </select>
                    </label>
                    <div><div className="text-gray-600">Operations</div><div className="text-gray-300">{selectedField.operationIds.join(', ')}</div></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-xs leading-5 text-gray-500">Select a field in the list or preview to inspect it.</div>
            )}
            <div className="mt-5">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Group columns</h4>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {[1, 2, 3, 4].map((columns) => (
                  <button
                    className={tinyButton}
                    key={columns}
                    onClick={() => {
                      const containerId = selectedElement?.containerId ?? card.layout.containers[0]?.id;
                      if (containerId) commitLayout(setContainerColumns(card.layout, containerId, columns as 1, operation.id));
                    }}
                    type="button"
                  >{columns}</button>
                ))}
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-gray-800 bg-[#090e16] p-3">
              <h4 className="text-[10px] font-semibold text-gray-300">Advanced operation route — optional</h4>
              <div className="mt-2 grid gap-2">
                <InspectorInput label="Endpoint path" onChange={(value) => updateOperation({ endpointPath: value })} value={operation.endpointPath ?? selectedTransport?.endpointPath ?? ''} />
                <label className="text-[9px] text-gray-600">
                  Transport
                  <select className={`${dialogInput} mt-1`} onChange={(event) => updateOperation({ transportProfileId: event.target.value })} value={operation.transportProfileId}>
                    {pack.transports.map((transport) => <option key={transport.id} value={transport.id}>{transport.label} · {transport.kind}</option>)}
                  </select>
                </label>
                <InspectorInput
                  label="Primary output JSON Pointer"
                  onChange={(value) => {
                    const primaryOutputId = operation.outputIds.find((outputId) => card.outputs.find((output) => output.id === outputId)?.primary)
                      ?? operation.outputIds[0];
                    if (!primaryOutputId) return;
                    updateOperation({
                      outputExtractions: [{
                        outputId: primaryOutputId,
                        kind: selectedTransport?.kind === 'sse' ? 'sse-text' : 'json-pointer',
                        pointer: value,
                      }],
                    });
                  }}
                  value={operation.outputExtractions?.[0]?.pointer ?? selectedTransport?.outputExtractions?.[0]?.pointer ?? ''}
                />
                {selectedTransport?.kind === 'submit-poll' ? (
                  <div className="rounded border border-gray-800 p-2 text-[9px] leading-4 text-gray-500">
                    Poll: {selectedTransport.poll?.statusPath} → {selectedTransport.poll?.resultPath}<br />
                    Cancel: {selectedTransport.poll?.cancelPath ?? 'not configured'}
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        </div>

        <div className="grid max-h-64 grid-cols-1 border-t border-gray-800 lg:grid-cols-2">
          <div className="overflow-auto p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Issues &amp; fit</h4>
              <span className="text-[10px] text-gray-500">
                {card.layout.width}px × {measuredCardHeight ? `${measuredCardHeight}px actual` : `about ${fit?.estimatedHeight ?? 0}px`}
              </span>
            </div>
            <div className="grid gap-1">
              {issues.length ? issues.slice(0, 12).map((issue, index) => (
                <button
                  className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[10px] ${issue.severity === 'blocking' ? 'bg-rose-400/10 text-rose-100' : 'bg-amber-400/10 text-amber-100'}`}
                  key={`${issue.code}:${index}`}
                  onClick={() => applyIssueRepair(issue)}
                  type="button"
                >
                  <AlertTriangle className="mt-0.5 shrink-0" size={11} />
                  <span>{issue.message}{issue.repair ? ` — ${issue.repair.label}` : ''}</span>
                </button>
              )) : <div className="flex items-center gap-2 text-xs text-emerald-200"><CheckCircle2 size={13} />Ready to activate. Live test is recommended but optional.</div>}
            </div>
          </div>
          <div className="overflow-auto border-l border-gray-800 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Redacted request preview</h4>
              <button className={tinyButton} onClick={() => void optionalTest()} type="button"><FlaskConical size={11} />Run optional live test</button>
            </div>
            <div className="mb-2 grid max-h-24 grid-cols-2 gap-1 overflow-y-auto">
              {card.fields.filter((field) => operation.visibleFieldIds.includes(field.id)).map((field) => (
                <input
                  className={dialogInput}
                  key={field.id}
                  onChange={(event) => setTestValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  placeholder={`${field.label}${field.required ? ' *' : ''} test value`}
                  value={String(testValues[field.id] ?? '')}
                />
              ))}
            </div>
            {testMessage ? <div className="mb-2 rounded-lg border border-amber-400/20 bg-amber-400/10 p-2 text-[10px] text-amber-100">{testMessage}</div> : null}
            <pre className="whitespace-pre-wrap text-[9px] leading-4 text-gray-400">{requestPreview}</pre>
          </div>
        </div>
      </div>
    </DockableDialog>
  );
}

export function BuilderCanvas({
  card,
  onCommitLayout,
  onMeasuredHeight,
  onOperationChange,
  onSelect,
  onSelectHandle,
  operationId,
  packId,
  providerName,
  selectedElementId,
  selectedHandleId,
}: {
  card: FlowModelCardV1;
  onCommitLayout: (layout: FlowModelCardV1['layout']) => void;
  onMeasuredHeight?: (height: number) => void;
  onOperationChange: (operationId: string) => void;
  onSelect: (id: string) => void;
  onSelectHandle: (handleId: string, elementId?: string) => void;
  operationId: string;
  packId?: string;
  providerName: string;
  selectedElementId?: string;
  selectedHandleId?: string;
}) {
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});
  const [collapsedContainers, setCollapsedContainers] = useState<Record<string, boolean>>({});
  const [guides, setGuides] = useState<Array<{ axis: 'x' | 'y'; position: number }>>([]);
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(card.fields.flatMap((field) =>
      field.defaultValue === undefined ? [] : [[field.id, field.defaultValue]]
    ))
  );
  const cardPreviewRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const preview = cardPreviewRef.current;
    if (!preview || !onMeasuredHeight) return;
    const measure = () => {
      const height = Math.ceil(preview.getBoundingClientRect().height);
      if (height > 0) onMeasuredHeight(height);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [onMeasuredHeight, operationId]);
  const operation = card.operations.find((candidate) => candidate.id === operationId) ?? card.operations[0];
  if (!operation) return null;
  const layoutHandles = resolveAllCardHandlePlacements(
    card.layout,
    listModelCardLayoutHandles(card, operation),
  );
  const elementHandles = new Map<string, BuilderResolvedHandle[]>();
  for (const handle of layoutHandles) {
    if (handle.placement.anchor !== 'element' || !handle.placement.elementId) continue;
    elementHandles.set(handle.placement.elementId, [
      ...(elementHandles.get(handle.placement.elementId) ?? []),
      handle,
    ]);
  }
  const primaryOutput = card.outputs.find((output) =>
    output.primary && output.operationIds.includes(operation.id)
  );
  const resizeCard = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = card.layout.width;
    const move = (moveEvent: PointerEvent) => onCommitLayout({
      ...card.layout,
      width: clamp(startWidth + moveEvent.clientX - startX, CARD_WIDTH_MIN, CARD_WIDTH_MAX),
    });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  const moveFreeform = (event: ReactPointerEvent<HTMLButtonElement>, element: CardLayoutElementV1) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(element.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: element.x ?? 0, y: element.y ?? 0 };
    const move = (moveEvent: PointerEvent) => {
      const moved = moveCardElement(card.layout, element.id, {
        x: origin.x + moveEvent.clientX - startX,
        y: origin.y + moveEvent.clientY - startY,
      });
      setGuides(moved.guides.map((guide) => ({ axis: guide.axis, position: guide.position })));
      onCommitLayout(moved.layout);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuides([]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  const resizeElement = (event: ReactPointerEvent<HTMLSpanElement>, element: CardLayoutElementV1) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = element.width ?? 160;
    const startHeight = element.height ?? 54;
    const move = (moveEvent: PointerEvent) => onCommitLayout(resizeCardElement(
      card.layout,
      element.id,
      {
        width: startWidth + moveEvent.clientX - startX,
        height: startHeight + moveEvent.clientY - startY,
      },
    ));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  const dropElement = (event: ReactDragEvent<HTMLElement>, containerId: string, beforeElementId?: string) => {
    event.preventDefault();
    event.stopPropagation();
    const elementId = event.dataTransfer.getData(MODEL_CARD_ELEMENT_DRAG_TYPE);
    if (!elementId) return;
    onCommitLayout(reorderCardElement(card.layout, elementId, containerId, beforeElementId));
    onSelect(elementId);
  };

  if (card.modalities.includes('image') && productionImageProvider(packId)) {
    return (
      <ProductionImageCardPreview
        card={card}
        cardPreviewRef={cardPreviewRef}
        onCommitLayout={onCommitLayout}
        onOperationChange={onOperationChange}
        onSelect={onSelect}
        onSelectHandle={onSelectHandle}
        operationId={operation.id}
        packId={packId!}
        selectedElementId={selectedElementId}
        selectedHandleId={selectedHandleId}
      />
    );
  }

  return (
    <div className="mx-auto" data-model-card-builder-wysiwyg="true">
      <div className="mb-3 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-cyan-200/60">Actual Flow card</span>
        {Object.entries(CARD_WIDTH_PRESETS).map(([label, width]) => (
          <button className={tinyButton} key={label} onClick={() => onCommitLayout({ ...card.layout, width })} type="button">{label} {width}</button>
        ))}
      </div>
      <div
        className="relative mx-auto rounded-2xl border border-cyan-300/35 bg-[#111722] p-3 shadow-2xl"
        data-flow-model-card-preview="true"
        ref={cardPreviewRef}
        style={{ width: card.layout.width, minHeight: 220 }}
      >
        <div className="mb-3 flex items-start justify-between gap-2 border-b border-gray-800 pb-2">
          <div className="min-w-0">
            <div className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-200/70">{providerName}</div>
            <div className="truncate text-sm font-semibold text-gray-100">{card.displayName}</div>
            <div className="truncate text-[9px] text-gray-500">{card.modelId}</div>
          </div>
          <span className="rounded-full border border-amber-400/30 px-2 py-1 text-[9px] font-semibold text-amber-200">Builder preview</span>
        </div>
        {card.operations.length > 1 ? (
          <div className="mb-3 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(4, card.operations.length)}, minmax(0, 1fr))` }}>
            {card.operations.map((candidate) => (
              <button
                className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold ${
                  candidate.id === operation.id
                    ? 'border-cyan-300/55 bg-cyan-400/15 text-cyan-50'
                    : 'border-gray-700/70 bg-[#0a1018] text-gray-400 hover:text-gray-100'
                }`}
                key={candidate.id}
                onClick={() => onOperationChange(candidate.id)}
                type="button"
              >
                {candidate.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3">
          {[...card.layout.containers]
            .filter((container) => !container.parentId)
            .filter((container) => builderContainerVisible(container, operation.id))
            .sort((left, right) => left.order - right.order)
            .map((container) => (
              <WysiwygCardContainer
                activeTab={activeTabs[container.id]}
                card={card}
                collapsed={collapsedContainers[container.id] ?? Boolean(container.collapsedByDefault)}
                container={container}
                elementHandles={elementHandles}
                key={container.id}
                onDropElement={dropElement}
                onMoveFreeform={moveFreeform}
                onResizeElement={resizeElement}
                onSelect={onSelect}
                onSelectHandle={onSelectHandle}
                onSetActiveTab={(tab) => setActiveTabs((current) => ({ ...current, [container.id]: tab }))}
                onToggleCollapsed={() => setCollapsedContainers((current) => ({
                  ...current,
                  [container.id]: !(current[container.id] ?? Boolean(container.collapsedByDefault)),
                }))}
                operationId={operation.id}
                previewValues={previewValues}
                selectedElementId={selectedElementId}
                selectedHandleId={selectedHandleId}
                setPreviewValue={(fieldId, value) => setPreviewValues((current) => ({ ...current, [fieldId]: value }))}
              />
            ))}
        </div>
        <BuilderHandleMarkers
          handles={layoutHandles.filter(({ placement }) => placement.anchor === 'card')}
          onSelectHandle={onSelectHandle}
          selectedHandleId={selectedHandleId}
        />
        {guides.map((guide, index) => (
          <div
            className="pointer-events-none absolute bg-cyan-300/70"
            key={`${guide.axis}:${guide.position}:${index}`}
            style={guide.axis === 'x'
              ? { bottom: 0, left: guide.position, top: 0, width: 1 }
              : { height: 1, left: 0, right: 0, top: guide.position }}
          />
        ))}
        {primaryOutput ? (
          <section className="relative mt-3 rounded-xl border border-violet-400/20 bg-violet-400/5 p-2">
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-violet-200/60">{primaryOutput.label}</div>
            <div className="flex min-h-14 items-center justify-center text-[10px] text-gray-500">Output appears here after a run.</div>
            <BuilderHandleMarkers
              handles={elementHandles.get(
                card.layout.elements.find((element) => element.outputId === primaryOutput.id)?.id ?? ''
              ) ?? []}
              onSelectHandle={onSelectHandle}
              selectedHandleId={selectedHandleId}
            />
          </section>
        ) : null}
        <div
          aria-label="Resize card width"
          className="absolute bottom-1 right-1 h-5 w-5 cursor-ew-resize border-b-2 border-r-2 border-cyan-300/70"
          onPointerDown={resizeCard}
          role="separator"
        />
      </div>
    </div>
  );
}

function ProductionImageCardPreview({
  card,
  cardPreviewRef,
  onCommitLayout,
  onOperationChange,
  onSelect,
  onSelectHandle,
  operationId,
  packId,
  selectedElementId,
  selectedHandleId,
}: {
  card: FlowModelCardV1;
  cardPreviewRef: RefObject<HTMLDivElement | null>;
  onCommitLayout: (layout: FlowModelCardV1['layout']) => void;
  onOperationChange: (operationId: string) => void;
  onSelect: (id: string) => void;
  onSelectHandle: (handleId: string, elementId?: string) => void;
  operationId: string;
  packId: string;
  selectedElementId?: string;
  selectedHandleId?: string;
}) {
  const provider = productionImageProvider(packId)!;
  const [previewData, setPreviewData] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(card.fields.flatMap((field) =>
      field.defaultValue === undefined ? [] : [[field.id, field.defaultValue]]
    ))
  );
  useEffect(() => {
    setPreviewData((current) => ({ ...current, provider, modelId: card.modelId, mediaMode: 'generate' }));
  }, [card.modelId, provider]);
  const layoutHandles = resolveAllCardHandlePlacements(
    card.layout,
    listModelCardLayoutHandles(card, operationId),
  );
  const resizeCard = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = card.layout.width;
    const move = (moveEvent: PointerEvent) => onCommitLayout({
      ...card.layout,
      width: clamp(startWidth + moveEvent.clientX - startX, CARD_WIDTH_MIN, CARD_WIDTH_MAX),
    });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  const data: NodeData = {
    ...previewData,
    mediaMode: 'generate',
    modelCardBuilderCard: card,
    modelCardBuilderPreview: true,
    modelCardBuilderOperationId: operationId,
    modelCardBuilderMoveElement: (
      elementId: string,
      targetContainerId: string,
      beforeElementId?: string,
    ) => onCommitLayout(reorderCardElement(card.layout, elementId, targetContainerId, beforeElementId)),
    modelCardBuilderSelectElement: onSelect,
    modelCardBuilderSelectHandle: onSelectHandle,
    modelCardBuilderSelectedElementId: selectedElementId,
    modelCardOperationChange: onOperationChange,
    modelId: card.modelId,
    onChange: (key, value) => {
      if (key === 'provider' || key === 'modelId') return;
      setPreviewData((current) => ({ ...current, [key]: value }));
    },
    onRun: () => undefined,
    provider,
  };

  return (
    <div className="mx-auto" data-model-card-builder-wysiwyg="true">
      <div className="mb-3 flex flex-wrap items-center justify-center gap-1">
        <span className="mr-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-cyan-200/60">
          Production Flow renderer
        </span>
        {Object.entries(CARD_WIDTH_PRESETS).map(([label, width]) => (
          <button className={tinyButton} key={label} onClick={() => onCommitLayout({ ...card.layout, width })} type="button">
            {label} {width}
          </button>
        ))}
      </div>
      {card.operations.length > 1 ? (
        <div className="mx-auto mb-3 flex flex-wrap justify-center gap-1" data-builder-operation-switcher="true">
          {card.operations.map((operation) => (
            <button
              className={operation.id === operationId ? primaryButton : tinyButton}
              key={operation.id}
              onClick={() => onOperationChange(operation.id)}
              type="button"
            >
              {operation.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="relative mx-auto"
        data-flow-model-card-preview="production"
        ref={cardPreviewRef}
        style={{ width: card.layout.width }}
      >
        <ReactFlowProvider>
          <ImageNode
            data={data}
            deletable={false}
            dragging={false}
            draggable={false}
            id={`model-card-builder:${card.id}`}
            isConnectable
            positionAbsoluteX={0}
            positionAbsoluteY={0}
            selectable={false}
            selected={false}
            type="imageGen"
            zIndex={0}
          />
        </ReactFlowProvider>
        <BuilderHandleMarkers
          handles={layoutHandles.filter(({ placement }) => placement.anchor === 'card')}
          onSelectHandle={onSelectHandle}
          selectedHandleId={selectedHandleId}
        />
        <div
          aria-label="Resize card width"
          className="absolute bottom-1 right-1 z-30 h-6 w-6 cursor-ew-resize border-b-2 border-r-2 border-cyan-300/80"
          onPointerDown={resizeCard}
          role="separator"
          title={`Drag to resize ${CARD_WIDTH_MIN}–${CARD_WIDTH_MAX}px`}
        />
      </div>
    </div>
  );
}

function productionImageProvider(packId: string | undefined): ImageProvider | undefined {
  const providerId = packId?.startsWith('sloom.bundled.')
    ? packId.slice('sloom.bundled.'.length)
    : undefined;
  return [
    'gemini',
    'openai',
    'atlas',
    'byteplus',
    'huggingface',
    'bfl',
    'stability',
    'localOpen',
    'android',
  ].includes(providerId ?? '')
    ? providerId as ImageProvider
    : undefined;
}

function WysiwygCardContainer({
  activeTab,
  card,
  collapsed,
  container,
  elementHandles,
  onDropElement,
  onMoveFreeform,
  onResizeElement,
  onSelect,
  onSelectHandle,
  onSetActiveTab,
  onToggleCollapsed,
  operationId,
  previewValues,
  selectedElementId,
  selectedHandleId,
  setPreviewValue,
}: {
  activeTab?: string;
  card: FlowModelCardV1;
  collapsed: boolean;
  container: CardLayoutContainerV1;
  elementHandles: ReadonlyMap<string, BuilderResolvedHandle[]>;
  onDropElement: (event: ReactDragEvent<HTMLElement>, containerId: string, beforeElementId?: string) => void;
  onMoveFreeform: (event: ReactPointerEvent<HTMLButtonElement>, element: CardLayoutElementV1) => void;
  onResizeElement: (event: ReactPointerEvent<HTMLSpanElement>, element: CardLayoutElementV1) => void;
  onSelect: (id: string) => void;
  onSelectHandle: (handleId: string, elementId?: string) => void;
  onSetActiveTab: (tab: string) => void;
  onToggleCollapsed: () => void;
  operationId: string;
  previewValues: Record<string, unknown>;
  selectedElementId?: string;
  selectedHandleId?: string;
  setPreviewValue: (fieldId: string, value: unknown) => void;
}) {
  const childTabs = container.kind === 'tabs'
    ? card.layout.containers.filter((candidate) => candidate.parentId === container.id)
    : [];
  const columns = container.operationColumns?.[operationId] ?? container.columns ?? 1;
  const entriesFor = (containerId: string) => card.layout.elements
    .filter((element) =>
      element.containerId === containerId
      && !element.hidden
      && builderElementVisible(element, operationId)
    )
    .sort((left, right) => left.order - right.order)
    .flatMap((element) => {
      const field = element.fieldId
        ? card.fields.find((candidate) => candidate.id === element.fieldId)
        : undefined;
      return field && field.operationIds.includes(operationId) ? [{ element, field }] : [];
    });
  if (container.id === 'outputs') return null;

  if (container.kind === 'tabs') {
    if (!childTabs.length) return null;
    const tabs = childTabs.map((tab) => tab.tabId ?? tab.label ?? tab.id);
    const selectedTab = activeTab && tabs.includes(activeTab) ? activeTab : tabs[0];
    const selectedChild = childTabs.find((tab) => (tab.tabId ?? tab.label ?? tab.id) === selectedTab) ?? childTabs[0];
    return (
      <section className="rounded-xl border border-gray-800/80 bg-[#0b1018]/70 p-2">
        <div className="mb-2 flex gap-1">
          {tabs.map((tab) => (
            <button
              className={`rounded px-2 py-1 text-[9px] ${tab === selectedTab ? 'bg-cyan-400/15 text-cyan-100' : 'text-gray-500'}`}
              key={tab}
              onClick={() => onSetActiveTab(tab)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>
        <WysiwygFieldLayout
          columns={columns}
          container={selectedChild}
          elementHandles={elementHandles}
          entries={entriesFor(selectedChild.id)}
          onDropElement={onDropElement}
          onMoveFreeform={onMoveFreeform}
          onResizeElement={onResizeElement}
          onSelect={onSelect}
          onSelectHandle={onSelectHandle}
          previewValues={previewValues}
          selectedElementId={selectedElementId}
          selectedHandleId={selectedHandleId}
          setPreviewValue={setPreviewValue}
        />
      </section>
    );
  }

  const entries = entriesFor(container.id);
  if (!entries.length) return null;
  if (container.kind === 'collapsible') {
    const requiredCount = entries.filter(({ field }) => field.required).length;
    return (
      <section className="rounded-xl border border-gray-800/80 bg-[#0b1018]/70">
        <button className="flex w-full items-center justify-between px-2.5 py-2 text-left text-[10px] font-semibold text-gray-300" onClick={onToggleCollapsed} type="button">
          <span>{container.label ?? 'Advanced — optional'}</span>
          <span className="text-gray-500">{requiredCount ? `${requiredCount} required · ` : ''}{collapsed ? 'Show' : 'Hide'}</span>
        </button>
        {!collapsed ? (
          <WysiwygFieldLayout
            columns={columns}
            container={container}
            elementHandles={elementHandles}
            entries={entries}
            onDropElement={onDropElement}
            onMoveFreeform={onMoveFreeform}
            onResizeElement={onResizeElement}
            onSelect={onSelect}
            onSelectHandle={onSelectHandle}
            previewValues={previewValues}
            selectedElementId={selectedElementId}
            selectedHandleId={selectedHandleId}
            setPreviewValue={setPreviewValue}
          />
        ) : null}
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-gray-800/70 bg-[#0b1018]/45 p-2">
      {container.label ? (
        <div className="mb-2 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.15em] text-gray-500">
          <span>{container.label}</span><span>{columns} col</span>
        </div>
      ) : null}
      <WysiwygFieldLayout
        columns={columns}
        container={container}
        elementHandles={elementHandles}
        entries={entries}
        onDropElement={onDropElement}
        onMoveFreeform={onMoveFreeform}
        onResizeElement={onResizeElement}
        onSelect={onSelect}
        onSelectHandle={onSelectHandle}
        previewValues={previewValues}
        selectedElementId={selectedElementId}
        selectedHandleId={selectedHandleId}
        setPreviewValue={setPreviewValue}
      />
    </section>
  );
}

function WysiwygFieldLayout({
  columns,
  container,
  elementHandles,
  entries,
  onDropElement,
  onMoveFreeform,
  onResizeElement,
  onSelect,
  onSelectHandle,
  previewValues,
  selectedElementId,
  selectedHandleId,
  setPreviewValue,
}: {
  columns: number;
  container: CardLayoutContainerV1;
  elementHandles: ReadonlyMap<string, BuilderResolvedHandle[]>;
  entries: Array<{ element: CardLayoutElementV1; field: ModelFieldV1 }>;
  onDropElement: (event: ReactDragEvent<HTMLElement>, containerId: string, beforeElementId?: string) => void;
  onMoveFreeform: (event: ReactPointerEvent<HTMLButtonElement>, element: CardLayoutElementV1) => void;
  onResizeElement: (event: ReactPointerEvent<HTMLSpanElement>, element: CardLayoutElementV1) => void;
  onSelect: (id: string) => void;
  onSelectHandle: (handleId: string, elementId?: string) => void;
  previewValues: Record<string, unknown>;
  selectedElementId?: string;
  selectedHandleId?: string;
  setPreviewValue: (fieldId: string, value: unknown) => void;
}) {
  const freeform = container.kind === 'freeform';
  return (
    <div
      className={freeform ? 'relative min-h-32' : 'grid min-h-12 gap-2'}
      data-wysiwyg-drop-container={container.id}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => onDropElement(event, container.id)}
      style={freeform
        ? { height: Math.max(128, container.height ?? 220) }
        : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {entries.map(({ element, field }) => (
        <div
          className={`group relative rounded-lg border p-1 transition-colors ${
            selectedElementId === element.id
              ? 'border-cyan-300/80 bg-cyan-400/5 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]'
              : 'border-transparent hover:border-cyan-300/35'
          }`}
          data-wysiwyg-field-control={field.id}
          key={element.id}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => onDropElement(event, container.id, element.id)}
          onPointerDownCapture={() => onSelect(element.id)}
          style={freeform
            ? {
                height: element.height ?? 72,
                left: element.x ?? 0,
                position: 'absolute',
                top: element.y ?? 0,
                width: element.width ?? 180,
              }
            : {
                gridColumn: `span ${Math.min(
                  columns,
                  element.columnSpan ?? (field.control === 'reference-gallery' ? columns : 1),
                )}`,
              }}
        >
          <button
            aria-label={`Drag ${field.label}`}
            className="absolute -right-2 -top-2 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded-md border border-cyan-300/35 bg-[#07111b] text-cyan-200 opacity-70 shadow-lg hover:opacity-100 active:cursor-grabbing"
            draggable={!freeform}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData(MODEL_CARD_ELEMENT_DRAG_TYPE, element.id);
            }}
            onPointerDown={freeform ? (event) => onMoveFreeform(event, element) : undefined}
            title={freeform ? 'Drag to move this control' : 'Drag to reorder or move this control'}
            type="button"
          >
            <GripVertical size={13} />
          </button>
          <ModelFieldControl
            disabled={false}
            field={field}
            galleryColumns={columns}
            galleryItemHeight={container.kind === 'reference-gallery' ? container.height : undefined}
            onChange={(value) => setPreviewValue(field.id, value)}
            onOpenMaskPainter={() => undefined}
            value={previewValues[field.id]}
          />
          <BuilderHandleMarkers
            handles={elementHandles.get(element.id) ?? []}
            onSelectHandle={onSelectHandle}
            selectedHandleId={selectedHandleId}
          />
          {freeform ? (
            <span
              aria-label={`Resize ${field.label}`}
              className="absolute bottom-0.5 right-0.5 h-3 w-3 cursor-nwse-resize border-b border-r border-cyan-300/70"
              onPointerDown={(event) => onResizeElement(event, element)}
              role="separator"
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

type BuilderResolvedHandle = {
  handle: ModelCardLayoutHandle;
  placement: CardHandlePlacementV1;
};

function BuilderHandleMarkers({
  handles,
  onSelectHandle,
  selectedHandleId,
}: {
  handles: readonly BuilderResolvedHandle[];
  onSelectHandle: (handleId: string, elementId?: string) => void;
  selectedHandleId?: string;
}) {
  return handles.map(({ handle, placement }) => (
    <button
      aria-label={`Position ${handle.label} handle`}
      className={`absolute z-20 flex h-4 min-w-4 items-center justify-center rounded-full border px-0.5 text-[7px] font-bold shadow-md ${
        selectedHandleId === handle.portId
          ? 'border-white bg-violet-400 text-white ring-2 ring-violet-300/40'
          : handle.direction === 'input'
            ? 'border-emerald-200/80 bg-emerald-500 text-emerald-950'
            : 'border-violet-200/80 bg-violet-500 text-white'
      }`}
      data-wysiwyg-handle={handle.portId}
      key={handle.portId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelectHandle(handle.portId, handle.elementId);
      }}
      style={builderHandleEdgeStyle(placement)}
      title={`${handle.label} · ${placement.anchor} ${placement.side} ${placement.offsetPercent}%`}
      type="button"
    >
      {handle.index === undefined ? (handle.direction === 'input' ? 'I' : 'O') : handle.index + 1}
    </button>
  ));
}

function builderHandleEdgeStyle(placement: CardHandlePlacementV1): CSSProperties {
  if (placement.side === 'top' || placement.side === 'bottom') {
    return {
      left: `${placement.offsetPercent}%`,
      [placement.side]: -8,
      transform: 'translateX(-50%)',
    };
  }
  return {
    top: `${placement.offsetPercent}%`,
    [placement.side]: -8,
    transform: 'translateY(-50%)',
  };
}

export function reorderCardElement(
  layout: FlowModelCardV1['layout'],
  elementId: string,
  containerId: string,
  beforeElementId?: string,
): FlowModelCardV1['layout'] {
  const dragged = layout.elements.find((element) => element.id === elementId);
  if (!dragged) return layout;
  const targetIds = layout.elements
    .filter((element) => element.containerId === containerId && element.id !== elementId)
    .sort((left, right) => left.order - right.order)
    .map((element) => element.id);
  const targetIndex = beforeElementId ? targetIds.indexOf(beforeElementId) : -1;
  targetIds.splice(targetIndex >= 0 ? targetIndex : targetIds.length, 0, elementId);
  const orderById = new Map(targetIds.map((id, order) => [id, order]));
  return {
    ...layout,
    elements: layout.elements.map((element) => {
      if (element.id === elementId) {
        return { ...element, containerId, order: orderById.get(element.id) ?? element.order };
      }
      if (element.containerId === containerId) {
        return { ...element, order: orderById.get(element.id) ?? element.order };
      }
      return element;
    }),
  };
}

function builderContainerVisible(container: CardLayoutContainerV1, operationId: string): boolean {
  return !container.conditions?.some((condition) =>
    condition.operationIds && !condition.operationIds.includes(operationId)
  );
}

function builderElementVisible(element: CardLayoutElementV1, operationId: string): boolean {
  return !element.conditions?.some((condition) =>
    condition.operationIds && !condition.operationIds.includes(operationId)
  );
}

function ImportReview({
  differences,
  onActivate,
  onDismiss,
  record,
}: {
  differences: ProviderPackDifference[];
  onActivate: () => void;
  onDismiss: () => void;
  record: ProviderPackRuntimeRecord;
}) {
  return (
    <div className="rounded-xl border border-amber-300/25 bg-amber-400/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-amber-100">Review override: {record.pack.displayName}</div>
          <div className="mt-1 text-[10px] text-amber-100/60">
            Exact origins: {record.pack.approvedOrigins.map((entry) => entry.origin).join(', ') || 'none'}
          </div>
        </div>
        <button className="text-gray-500 hover:text-white" onClick={onDismiss} type="button"><X size={14} /></button>
      </div>
      <div className="mt-2 grid max-h-32 gap-1 overflow-y-auto">
        {differences.length ? differences.map((difference, index) => (
          <div className="rounded border border-gray-800 bg-[#090e16] px-2 py-1.5 text-[10px] text-gray-300" key={`${difference.path}:${index}`}>
            <span className={difference.severity === 'breaking' ? 'text-rose-300' : difference.severity === 'warning' ? 'text-amber-300' : 'text-cyan-300'}>
              {difference.category} · {difference.severity}
            </span>{' '}{difference.message}
          </div>
        )) : <div className="text-[10px] text-gray-500">No same-ID installed pack to compare.</div>}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className={secondaryButton} onClick={onDismiss} type="button">Keep inactive</button>
        <button className={primaryButton} onClick={onActivate} type="button"><ShieldCheck size={12} />Approve origins &amp; activate</button>
      </div>
    </div>
  );
}

function StatusBadge({
  record,
  validation,
}: {
  record: ProviderPackRuntimeRecord;
  validation: ReturnType<typeof validateProviderPack>;
}) {
  const label = !validation.activatable
    ? 'draft / blocked'
    : record.active
      ? record.pack.credentialSlots.some((slot) => slot.required && !providerPackRegistry.hasCredential(record.pack.packId, slot.id))
        ? 'needs key'
        : Object.values(record.testStatusByOperation).some((status) => status === 'failed')
          ? 'connection error'
          : Object.values(record.testStatusByOperation).every((status) => status === 'passed')
            ? 'tested'
            : 'untested'
      : 'inactive override';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${
      label === 'tested' ? 'border-emerald-400/35 text-emerald-200'
        : label === 'connection error' || label === 'draft / blocked' ? 'border-rose-400/35 text-rose-200'
          : 'border-amber-400/35 text-amber-200'
    }`}>{label}</span>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-gray-800 bg-[#090e16] p-3"><div className="text-lg font-semibold text-gray-100">{value}</div><div className="text-[10px] text-gray-500">{label}</div></div>;
}

function Input({
  label,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className="text-xs text-gray-400">
      <span className="mb-1.5 block font-semibold">{label}</span>
      <input className={dialogInput} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} value={value} />
    </label>
  );
}

function InspectorInput({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="text-[9px] text-gray-600">
      {label}
      <input className={`${dialogInput} mt-1`} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function VisualRange({
  label,
  max,
  min,
  onChange,
  step,
  suffix = '',
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix?: string;
  value: number;
}) {
  const safeMax = Math.max(min, max);
  const safeValue = Math.max(min, Math.min(safeMax, value));
  return (
    <label className="block text-[9px] text-gray-400">
      <span className="mb-1 flex items-center justify-between gap-2">
        <span>{label}</span>
        <output className="font-semibold tabular-nums text-cyan-100">{safeValue}{suffix}</output>
      </span>
      <input
        aria-label={label}
        className="w-full accent-cyan-400"
        data-visual-range={label.toLowerCase().replaceAll(' ', '-')}
        max={safeMax}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={safeValue}
      />
    </label>
  );
}

function galleryItemHeightForColumns(columns: number): number {
  if (columns >= 4) return 84;
  if (columns === 3) return 92;
  if (columns === 2) return 104;
  return 112;
}

function countModality(records: ProviderPackRuntimeRecord[], modality: 'text' | 'image' | 'video' | 'audio'): number {
  return records.reduce((count, record) => count + record.pack.cards.filter((card) => card.modalities.includes(modality)).length, 0);
}

function latestTestDate(record: ProviderPackRuntimeRecord): string | undefined {
  return Object.values(record.testStatusByOperation).some((status) => status === 'passed')
    ? new Date(record.importedAt || Date.now()).toISOString().slice(0, 10)
    : undefined;
}

function confidenceLabel(confidence: FlowModelCardV1['confidence']): string {
  if (confidence === 'provider-verified') return 'Provider verified';
  if (confidence === 'sloom-recognized') return 'Sloom recognized';
  if (confidence === 'inferred') return 'Inferred — please check';
  if (confidence === 'manual') return 'Manual';
  return 'Untested';
}

function incrementPatch(version: string): string {
  const parts = version.split('.').map(Number);
  return `${parts[0] || 1}.${parts[1] || 0}.${(parts[2] || 0) + 1}`;
}

function safeDomId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-');
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

const primaryButton = 'inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/35 bg-cyan-400/15 px-3 py-2 text-xs font-semibold text-cyan-50 hover:border-cyan-200/70 disabled:opacity-40';
const secondaryButton = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-[#111722] px-3 py-2 text-xs font-semibold text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-40';
const tinyButton = 'inline-flex items-center justify-center gap-1 rounded-md border border-gray-700 bg-[#0a1018] px-2 py-1.5 text-[10px] font-semibold text-gray-400 hover:border-gray-500 hover:text-white disabled:opacity-30';
const dialogInput = 'w-full rounded-lg border border-gray-700 bg-[#090e16] px-3 py-2 text-xs text-gray-100 outline-none focus:border-cyan-300/60';
const smallSelect = 'rounded-lg border border-gray-700 bg-[#090e16] px-2 py-1.5 text-[10px] text-gray-200 outline-none';
const MODEL_CARD_ELEMENT_DRAG_TYPE = 'application/x-sloom-model-card-element';
const FIELD_ROLES = [
  'prompt', 'system-instruction', 'context', 'media-context', 'source-image', 'mask',
  'reference-image', 'control-image', 'source-video', 'start-frame', 'end-frame',
  'reference-video', 'script', 'source-audio', 'voice', 'style', 'duration',
  'frame-rate', 'width', 'height', 'resolution', 'format', 'seed', 'quantity',
  'advanced', 'metadata',
] as const;
const FIELD_TYPES = ['string', 'number', 'integer', 'boolean', 'enum', 'image', 'video', 'audio', 'json', 'binary'] as const;
const FIELD_ENCODINGS = ['json', 'url', 'data-uri', 'base64', 'binary', 'multipart', 'raw'] as const;
