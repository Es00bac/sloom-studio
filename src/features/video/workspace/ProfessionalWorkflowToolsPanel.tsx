import { useMemo, useState, type ReactNode } from 'react';
import {
  Captions,
  ClipboardCheck,
  Clock3,
  Film,
  History,
  ListChecks,
  PackageCheck,
  Scissors,
  Tags,
  UsersRound,
} from 'lucide-react';
import type { EditorAudioClip, EditorVisualClip } from '../../../types/flow';
import {
  createDefaultEditorProfessionalWorkflowState,
  type EditorProfessionalWorkflowState,
  type VideoProductionTimebase,
} from '../../../types/videoProduction';
import type { SourceBinItem } from '../../../lib/sourceBin';
import {
  MAX_VIDEO_MEDIA_LOG_ITEMS,
  MAX_VIDEO_SMART_BINS,
  matchesVideoSmartBin,
  type VideoMediaLogBatchPatch,
  type VideoMediaLoggingState,
} from '../../../lib/videoMediaLogging';
import {
  MAX_VIDEO_REVIEW_PACKAGE_CHARACTERS,
  MAX_VIDEO_REVIEW_ANNOTATIONS,
  evaluateVideoReviewApproval,
  type VideoReviewPriority,
  type VideoReviewWorkflow,
} from '../../../lib/videoReviewWorkflow';
import {
  MAX_VIDEO_CAPTION_CUES,
  MAX_VIDEO_CAPTION_SOURCE_BYTES,
  analyzeVideoCaptionQc,
  type VideoCaptionDocument,
  type VideoCaptionFormat,
} from '../../../lib/videoCaptionAuthoring';
import type { VideoStructuralQcReport } from '../../../lib/videoStructuralQc';
import {
  MAX_VIDEO_RENDER_QUEUE_ATTEMPTS,
  isVideoRenderQueueJobStale,
  summarizeVideoRenderQueue,
  type VideoRenderQueueOutput,
  type VideoRenderQueueRecord,
} from '../../../lib/videoRenderQueue';
import type { VideoDecodedSignalQcReport } from '../../../lib/videoDecodedSignalQc';
import {
  createVideoTimecodeContext,
  getKnownVideoTimebase,
  secondsToFrames,
  timelineFrameToRecordTimecode,
  type KnownVideoTimebaseId,
} from '../../../lib/videoTimebase';

type WorkflowTab = 'edit' | 'media' | 'review' | 'captions' | 'delivery';

export interface ProfessionalWorkflowHistoryEntry {
  id: string;
  label: string;
  current?: boolean;
  timestamp?: string;
}

export interface ProfessionalTrimSessionSummary {
  kind: 'ripple' | 'roll' | 'slip' | 'slide';
  description: string;
  deltaFrames: number;
}

export type ProfessionalHistoryCommand =
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'jump'; entryId: string };

export type ProfessionalBatchCommand =
  | { kind: 'move'; clipIds: string[]; deltaFrames: number }
  | { kind: 'track-shift'; clipIds: string[]; trackDelta: number }
  | { kind: 'duplicate'; clipIds: string[]; deltaFrames: number }
  | { kind: 'toggle-enabled'; clipIds: string[] }
  | { kind: 'delete'; clipIds: string[] };

export type ProfessionalSourceRecordCommand =
  | { kind: 'lift' | 'extract'; playheadMs: number }
  | { kind: 'replace'; playheadMs: number; sourceItemId?: string }
  | { kind: 'match-frame'; playheadMs: number; clipId?: string }
  | { kind: 'previous-edit' | 'next-edit'; playheadMs: number };

export type ProfessionalTrimCommand =
  | { kind: 'begin'; mode: ProfessionalTrimSessionSummary['kind']; deltaFrames: number }
  | { kind: 'update'; deltaFrames: number }
  | { kind: 'commit' | 'cancel' };

export type ProfessionalMediaLoggingCommand =
  | { kind: 'patch-selected'; sourceItemIds: string[]; patch: VideoMediaLogBatchPatch }
  | { kind: 'create-subclip'; sourceItemId: string; name: string; sourceInMs: number; sourceOutMs: number }
  | { kind: 'save-smart-bin'; name: string; query: string }
  | { kind: 'apply-smart-bin'; smartBinId?: string }
  | { kind: 'suggest-duplicates' };

export type ProfessionalReviewCommand =
  | { kind: 'add-annotation'; body: string; author: string; priority: VideoReviewPriority; playheadMs: number; clipId?: string }
  | { kind: 'set-approval'; status: 'approved' | 'changes-requested'; compositionSignature: string }
  | { kind: 'navigate'; annotationId: string }
  | { kind: 'resolve'; annotationId: string }
  | { kind: 'import-report'; data: string }
  | { kind: 'export-report'; format: 'json' | 'csv' };

export type ProfessionalCaptionCommand =
  | { kind: 'add-cue'; playheadMs: number }
  | { kind: 'import'; data: string; format: VideoCaptionFormat; language?: string }
  | { kind: 'set-language'; language: string }
  | { kind: 'set-embedding'; enabled: boolean }
  | { kind: 'update-cue'; cueId: string; startMs: number; endMs: number; text: string }
  | { kind: 'split-cue'; cueId: string }
  | { kind: 'delete-cue'; cueId: string }
  | { kind: 'find-replace'; find: string; replacement: string }
  | { kind: 'run-accessibility-qc' }
  | { kind: 'export'; format: VideoCaptionFormat };

export type ProfessionalQcCommand =
  | { kind: 'run-structural' }
  | { kind: 'run-decoded-signal' }
  | { kind: 'cancel-decoded-signal' }
  | { kind: 'navigate'; issueId: string };

export type ProfessionalDeliveryCommand =
  | { kind: 'plan'; profileId: string; compositionSignature: string }
  /** Admits a plan to the durable queue. Execution only ever begins from this explicit action. */
  | { kind: 'queue'; jobId: string }
  /** Starts this session's queue after a restart parked it. */
  | { kind: 'resume-queue' }
  /** The one action behind both Resume and Retry: re-queue whatever stopped without delivering. */
  | { kind: 'retry'; jobId: string }
  | { kind: 'cancel'; jobId: string }
  | { kind: 'export-manifest'; jobId: string };

export interface ProfessionalWorkflowToolsPanelProps {
  state?: EditorProfessionalWorkflowState;
  sourceItems: readonly SourceBinItem[];
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  selectedClipIds: readonly string[];
  selectedSourceItemIds: readonly string[];
  playheadMs: number;
  compositionSignature: string;
  historyEntries?: readonly ProfessionalWorkflowHistoryEntry[];
  canUndo?: boolean;
  canRedo?: boolean;
  trimSession?: ProfessionalTrimSessionSummary;
  mediaLogging?: VideoMediaLoggingState;
  activeSmartBinId?: string;
  reviewWorkflow?: VideoReviewWorkflow;
  captionDocument?: VideoCaptionDocument;
  structuralQcReport?: VideoStructuralQcReport;
  /** True while this session is actually working the queue. Never persisted; a reload starts false. */
  renderQueueRunning?: boolean;
  decodedSignalQcReport?: VideoDecodedSignalQcReport;
  decodedSignalQcRunning?: boolean;
  onWorkflowStateChange: (state: EditorProfessionalWorkflowState, label: string) => void;
  onHistoryCommand: (command: ProfessionalHistoryCommand) => void;
  onBatchCommand: (command: ProfessionalBatchCommand) => void;
  onSourceRecordCommand: (command: ProfessionalSourceRecordCommand) => void;
  onTrimCommand: (command: ProfessionalTrimCommand) => void;
  onMediaLoggingCommand: (command: ProfessionalMediaLoggingCommand) => void;
  onReviewCommand: (command: ProfessionalReviewCommand) => void;
  onCaptionCommand: (command: ProfessionalCaptionCommand) => void;
  onQcCommand: (command: ProfessionalQcCommand) => void;
  onDeliveryCommand: (command: ProfessionalDeliveryCommand) => void;
}

const TABS: Array<{ id: WorkflowTab; label: string }> = [
  { id: 'edit', label: 'Edit' },
  { id: 'media', label: 'Time & Media' },
  { id: 'review', label: 'Review' },
  { id: 'captions', label: 'Captions' },
  { id: 'delivery', label: 'QC & Delivery' },
];

const TIMEBASES: KnownVideoTimebaseId[] = ['23.976', '24', '25', '29.97-df', '29.97-ndf', '30', '50', '59.94-df', '59.94-ndf', '60'];
const inputClassName = 'w-full rounded-md border border-gray-700 bg-[#090e15] px-2 py-1.5 text-[11px] text-gray-100 outline-none focus:border-cyan-300/60';
const buttonClassName = 'inline-flex items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-50 transition-colors hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800/40 disabled:text-gray-600';
const neutralButtonClassName = 'inline-flex items-center justify-center rounded-md border border-gray-700 bg-[#111823] px-2.5 py-1.5 text-[11px] font-semibold text-gray-200 hover:border-gray-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40';

export function ProfessionalWorkflowToolsPanel(props: ProfessionalWorkflowToolsPanelProps) {
  const {
    sourceItems,
    visualClips,
    audioClips,
    selectedClipIds,
    selectedSourceItemIds,
    playheadMs,
    compositionSignature,
    historyEntries = [],
    canUndo = false,
    canRedo = false,
    trimSession,
    mediaLogging = { records: [], smartBins: [] },
    activeSmartBinId,
    reviewWorkflow,
    captionDocument,
    structuralQcReport,
    renderQueueRunning = false,
    decodedSignalQcReport,
    decodedSignalQcRunning = false,
    onWorkflowStateChange,
    onHistoryCommand,
    onBatchCommand,
    onSourceRecordCommand,
    onTrimCommand,
    onMediaLoggingCommand,
    onReviewCommand,
    onCaptionCommand,
    onQcCommand,
    onDeliveryCommand,
  } = props;
  const value = props.state ?? createDefaultEditorProfessionalWorkflowState();
  const [tab, setTab] = useState<WorkflowTab>('edit');
  const [batchFrames, setBatchFrames] = useState(1);
  const [trackDelta, setTrackDelta] = useState(1);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [logScene, setLogScene] = useState('');
  const [logTags, setLogTags] = useState('');
  const [logRating, setLogRating] = useState(0);
  const [logStatus, setLogStatus] = useState<'unreviewed' | 'select' | 'hold' | 'reject' | 'approved'>('unreviewed');
  const [subclipName, setSubclipName] = useState('Select');
  const [subclipInMs, setSubclipInMs] = useState(0);
  const [subclipOutMs, setSubclipOutMs] = useState(1_000);
  const [smartBinName, setSmartBinName] = useState('Selects');
  const [smartBinQuery, setSmartBinQuery] = useState('rating >= 4');
  const [reviewAuthor, setReviewAuthor] = useState('Local reviewer');
  const [reviewBody, setReviewBody] = useState('');
  const [reviewPriority, setReviewPriority] = useState<VideoReviewPriority>('normal');
  const [reviewFilter, setReviewFilter] = useState<'open' | 'all'>('open');
  const [reviewImportError, setReviewImportError] = useState<string>();
  const [captionFind, setCaptionFind] = useState('');
  const [captionReplacement, setCaptionReplacement] = useState('');
  const [captionImportError, setCaptionImportError] = useState<string>();
  const captionQc = useMemo(() => captionDocument ? analyzeVideoCaptionQc(captionDocument) : [], [captionDocument]);
  const smartBinMatchCounts = useMemo(() => new Map(mediaLogging.smartBins.map((bin) => [
    bin.id,
    mediaLogging.records.reduce((count, record) => count + Number(matchesVideoSmartBin(record, bin)), 0),
  ])), [mediaLogging]);
  const renderQueue = useMemo(
    () => summarizeVideoRenderQueue(value.deliveryJobs, { currentCompositionSignature: compositionSignature }),
    [compositionSignature, value.deliveryJobs],
  );
  const profileNames = useMemo(
    () => new Map(value.deliveryProfiles.map((profile) => [profile.id, profile.name])),
    [value.deliveryProfiles],
  );
  const firstSelectedSource = sourceItems.find((item) => selectedSourceItemIds.includes(item.id));
  const firstSelectedClipId = selectedClipIds[0];
  const activeApproval = reviewWorkflow?.approval;
  const approvalEvaluation = activeApproval
    ? evaluateVideoReviewApproval(activeApproval, compositionSignature)
    : undefined;
  const recordTimecode = resolveRecordTimecode(value.timebase, playheadMs);

  const updateTimebase = (timebase: VideoProductionTimebase, label: string) => {
    onWorkflowStateChange({ ...value, timebase }, label);
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0b1017] text-gray-100" data-professional-workflow-tools="true" aria-label="Professional workflow tools">
      <header className="border-b border-gray-700/70 bg-[#111823] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Professional Workflow</div>
            <p className="mt-1 text-[10px] leading-4 text-gray-400">Bounded editorial, review, QC, and delivery planning for feature-length projects.</p>
          </div>
          <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[9px] font-semibold uppercase text-emerald-100">v{value.version}</span>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-1 rounded-lg border border-gray-700/60 bg-[#070b10] p-1" role="tablist" aria-label="Professional workflow groups">
          {TABS.map((entry) => (
            <button
              aria-controls={`professional-workflow-panel-${entry.id}`}
              aria-selected={tab === entry.id}
              className={`rounded-md px-1 py-1.5 text-[9px] font-semibold ${tab === entry.id ? 'bg-cyan-400/15 text-cyan-50' : 'text-gray-500 hover:text-gray-200'}`}
              id={`professional-workflow-tab-${entry.id}`}
              key={entry.id}
              onClick={() => setTab(entry.id)}
              role="tab"
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      <div
        aria-labelledby={`professional-workflow-tab-${tab}`}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        id={`professional-workflow-panel-${tab}`}
        role="tabpanel"
      >
        {tab === 'edit' ? (
          <>
            <WorkflowCard icon={<History size={14} />} number="01" title="Complete history">
              <div className="flex gap-1.5">
                <button className={neutralButtonClassName} disabled={!canUndo} onClick={() => onHistoryCommand({ kind: 'undo' })} type="button">Undo</button>
                <button className={neutralButtonClassName} disabled={!canRedo} onClick={() => onHistoryCommand({ kind: 'redo' })} type="button">Redo</button>
              </div>
              <div className="mt-2 max-h-28 space-y-1 overflow-y-auto" aria-label="Editor history entries">
                {historyEntries.length ? historyEntries.slice(-80).reverse().map((entry) => (
                  <button
                    aria-current={entry.current ? 'step' : undefined}
                    className={`flex w-full items-center justify-between rounded-md border px-2 py-1 text-left text-[10px] ${entry.current ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-50' : 'border-gray-700/60 bg-black/20 text-gray-300'}`}
                    key={entry.id}
                    onClick={() => onHistoryCommand({ kind: 'jump', entryId: entry.id })}
                    type="button"
                  >
                    <span className="truncate">{entry.label}</span><span className="ml-2 text-gray-600">{entry.timestamp}</span>
                  </button>
                )) : <EmptyLine>No history entries supplied by the editor runtime.</EmptyLine>}
              </div>
              <Boundary>Runtime edit history · bounded to the host’s last 80 transactions; not crash-persistent project versioning.</Boundary>
            </WorkflowCard>

            <WorkflowCard icon={<ListChecks size={14} />} number="02" title="Multi-select & batch actions">
              <MetricStrip values={[["Selected", selectedClipIds.length], ["Video", visualClips.length], ["Audio", audioClips.length]]} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <NumberInput label="Move frames" value={batchFrames} onChange={setBatchFrames} />
                <NumberInput label="Track shift" value={trackDelta} onChange={setTrackDelta} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className={buttonClassName} disabled={!selectedClipIds.length} onClick={() => onBatchCommand({ kind: 'move', clipIds: [...selectedClipIds], deltaFrames: batchFrames })} type="button">Move selected</button>
                <button className={buttonClassName} disabled={!selectedClipIds.length} onClick={() => onBatchCommand({ kind: 'track-shift', clipIds: [...selectedClipIds], trackDelta })} type="button">Shift tracks</button>
                <button className={buttonClassName} disabled={!selectedClipIds.length} onClick={() => onBatchCommand({ kind: 'duplicate', clipIds: [...selectedClipIds], deltaFrames: batchFrames })} type="button">Duplicate</button>
                <button className={neutralButtonClassName} disabled={!selectedClipIds.length} onClick={() => onBatchCommand({ kind: 'toggle-enabled', clipIds: [...selectedClipIds] })} type="button">Toggle enabled</button>
                <button className="rounded-md border border-red-300/25 bg-red-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-100 disabled:opacity-40" disabled={!selectedClipIds.length} onClick={() => setConfirmDelete(true)} type="button">Delete selected…</button>
              </div>
              {confirmDelete ? (
                <div className="mt-2 rounded-md border border-red-300/30 bg-red-950/30 p-2" role="alert">
                  <p className="text-[10px] text-red-100">Delete {selectedClipIds.length} selected clip{selectedClipIds.length === 1 ? '' : 's'} as one undoable transaction?</p>
                  <div className="mt-2 flex gap-1.5">
                    <button className={neutralButtonClassName} onClick={() => setConfirmDelete(false)} type="button">Cancel</button>
                    <button className="rounded-md bg-red-400 px-2 py-1 text-[10px] font-semibold text-red-950" onClick={() => { onBatchCommand({ kind: 'delete', clipIds: [...selectedClipIds] }); setConfirmDelete(false); }} type="button">Confirm delete</button>
                  </div>
                </div>
              ) : null}
              <Boundary>Runtime proposals · selection is capped at 2,000 clips and commits once to history.</Boundary>
            </WorkflowCard>

            <WorkflowCard icon={<Film size={14} />} number="03" title="Source / record edits">
              <div className="flex flex-wrap gap-1.5">
                <button className={buttonClassName} onClick={() => onSourceRecordCommand({ kind: 'previous-edit', playheadMs })} type="button">Previous edit</button>
                <button className={buttonClassName} onClick={() => onSourceRecordCommand({ kind: 'next-edit', playheadMs })} type="button">Next edit</button>
                <button className={buttonClassName} onClick={() => onSourceRecordCommand({ kind: 'match-frame', playheadMs, clipId: firstSelectedClipId })} type="button">Match frame</button>
                <button className={neutralButtonClassName} onClick={() => onSourceRecordCommand({ kind: 'lift', playheadMs })} type="button">Lift range</button>
                <button className={neutralButtonClassName} onClick={() => onSourceRecordCommand({ kind: 'extract', playheadMs })} type="button">Extract range</button>
                <button className={neutralButtonClassName} onClick={() => onSourceRecordCommand({ kind: 'replace', playheadMs, sourceItemId: firstSelectedSource?.id })} type="button">Replace from source</button>
              </div>
              <Boundary>Runtime edit proposals · respect record targets, track locks, linked clips, and one-step undo.</Boundary>
            </WorkflowCard>

            <WorkflowCard icon={<Scissors size={14} />} number="04" title="Trim session & slide">
              <div className="flex flex-wrap gap-1.5">
                {(['ripple', 'roll', 'slip', 'slide'] as const).map((mode) => (
                  <button className={buttonClassName} key={mode} onClick={() => onTrimCommand({ kind: 'begin', mode, deltaFrames: batchFrames })} type="button">Start {mode}</button>
                ))}
              </div>
              {trimSession ? (
                <div className="mt-2 rounded-md border border-amber-300/25 bg-amber-400/10 p-2">
                  <div className="text-[10px] font-semibold text-amber-100">{trimSession.kind.toUpperCase()} · {trimSession.deltaFrames} frames</div>
                  <p className="mt-1 text-[10px] text-amber-50/75">{trimSession.description}</p>
                  <div className="mt-2 flex gap-1.5"><button className={buttonClassName} onClick={() => onTrimCommand({ kind: 'commit' })} type="button">Apply trim</button><button className={neutralButtonClassName} onClick={() => onTrimCommand({ kind: 'cancel' })} type="button">Cancel session</button></div>
                </div>
              ) : <EmptyLine>No active trim session. Start a mode to preview bounded timeline math.</EmptyLine>}
            </WorkflowCard>
          </>
        ) : null}

        {tab === 'media' ? (
          <>
            <WorkflowCard icon={<Clock3 size={14} />} number="05" title="Rational timebase & record timecode">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[10px] text-gray-400">Sequence timebase
                  <select
                    aria-label="Sequence timebase"
                    className={`${inputClassName} mt-1`}
                    onChange={(event) => {
                      const resolved = getKnownVideoTimebase(event.target.value as KnownVideoTimebaseId);
                      updateTimebase({ ...value.timebase, numerator: resolved.numerator, denominator: resolved.denominator, dropFrame: resolved.dropFrame }, 'Set rational Video timebase');
                    }}
                    value={resolveTimebaseId(value.timebase)}
                  >
                    {TIMEBASES.map((id) => <option key={id} value={id}>{id.replace('-df', ' DF').replace('-ndf', ' NDF')} fps</option>)}
                  </select>
                </label>
                <label className="text-[10px] text-gray-400">Sequence start timecode
                  <input className={`${inputClassName} mt-1 font-mono`} onBlur={(event) => updateTimebase({ ...value.timebase, sequenceStartTimecode: event.target.value }, 'Set sequence start timecode')} defaultValue={value.timebase.sequenceStartTimecode} />
                </label>
              </div>
              <label className="mt-2 block text-[10px] text-gray-400">Mixed-rate policy
                <select className={`${inputClassName} mt-1`} onChange={(event) => updateTimebase({ ...value.timebase, mixedRatePolicy: event.target.value as VideoProductionTimebase['mixedRatePolicy'] }, 'Set mixed-rate policy')} value={value.timebase.mixedRatePolicy}>
                  <option value="preserve-time">Preserve source time</option><option value="preserve-frame-number">Preserve frame number</option><option value="reject">Reject mixed rates</option>
                </select>
              </label>
              <Boundary>Runtime timing state · drop-frame is available only at 30000/1001 or 60000/1001.</Boundary>
            </WorkflowCard>

            <WorkflowCard icon={<Tags size={14} />} number="06" title="Media logging, subclips & smart bins">
              <MetricStrip values={[["Sources", sourceItems.length], ["Logged", mediaLogging.records.length], ["Smart bins", mediaLogging.smartBins.length]]} />
              <p className="mt-2 text-[10px] text-gray-400">Selected: {firstSelectedSource?.label ?? 'No source selected'}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="text-[10px] text-gray-400">Scene<input className={`${inputClassName} mt-1`} onChange={(event) => setLogScene(event.target.value)} value={logScene} /></label>
                <label className="text-[10px] text-gray-400">Tags, comma separated<input className={`${inputClassName} mt-1`} onChange={(event) => setLogTags(event.target.value)} value={logTags} /></label>
                <label className="text-[10px] text-gray-400">Rating<select className={`${inputClassName} mt-1`} onChange={(event) => setLogRating(Number(event.target.value))} value={logRating}>{[0, 1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating === 0 ? 'Unrated' : `${rating} star${rating === 1 ? '' : 's'}`}</option>)}</select></label>
                <label className="text-[10px] text-gray-400">Status<select className={`${inputClassName} mt-1`} onChange={(event) => setLogStatus(event.target.value as typeof logStatus)} value={logStatus}><option value="unreviewed">Unreviewed</option><option value="select">Select</option><option value="hold">Hold</option><option value="reject">Reject</option><option value="approved">Approved</option></select></label>
              </div>
              <button className={`${buttonClassName} mt-2`} disabled={!selectedSourceItemIds.length} onClick={() => onMediaLoggingCommand({ kind: 'patch-selected', sourceItemIds: [...selectedSourceItemIds], patch: { scene: logScene, addTags: splitTags(logTags), rating: logRating, status: logStatus } })} type="button">Apply logging to selected</button>
              <div className="mt-3 rounded-md border border-gray-700/60 bg-black/20 p-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Non-destructive subclip</div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="text-[9px] text-gray-500">Name<input className={`${inputClassName} mt-1`} onChange={(event) => setSubclipName(event.target.value)} value={subclipName} /></label>
                  <NumberInput label="In ms" value={subclipInMs} onChange={setSubclipInMs} />
                  <NumberInput label="Out ms" value={subclipOutMs} onChange={setSubclipOutMs} />
                </div>
                <button className={`${neutralButtonClassName} mt-2`} disabled={!firstSelectedSource || subclipOutMs <= subclipInMs} onClick={() => firstSelectedSource && onMediaLoggingCommand({ kind: 'create-subclip', sourceItemId: firstSelectedSource.id, name: subclipName, sourceInMs: subclipInMs, sourceOutMs: subclipOutMs })} type="button">Save source range</button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <label className="text-[9px] text-gray-500">Smart-bin name<input className={`${inputClassName} mt-1`} onChange={(event) => setSmartBinName(event.target.value)} value={smartBinName} /></label>
                <label className="text-[9px] text-gray-500">Saved query<input className={`${inputClassName} mt-1`} onChange={(event) => setSmartBinQuery(event.target.value)} placeholder="rating &gt;= 4 and tag:hero" title="Supports rating comparisons, tag:, status:, has-subclips:, and logging fields such as scene:, camera:, or notes:." value={smartBinQuery} /></label>
                <button className={`${neutralButtonClassName} self-end`} disabled={!smartBinName.trim() || !smartBinQuery.trim()} onClick={() => onMediaLoggingCommand({ kind: 'save-smart-bin', name: smartBinName, query: smartBinQuery })} type="button">Save bin</button>
              </div>
              {mediaLogging.smartBins.length ? (
                <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="Saved smart bins">
                  {mediaLogging.smartBins.slice(0, 100).map((bin) => {
                    const matches = smartBinMatchCounts.get(bin.id) ?? 0;
                    return <button className={activeSmartBinId === bin.id ? buttonClassName : neutralButtonClassName} key={bin.id} onClick={() => onMediaLoggingCommand({ kind: 'apply-smart-bin', smartBinId: activeSmartBinId === bin.id ? undefined : bin.id })} type="button">{bin.name} · {matches}</button>;
                  })}
                </div>
              ) : null}
              <button className={`${neutralButtonClassName} mt-2`} onClick={() => onMediaLoggingCommand({ kind: 'suggest-duplicates' })} type="button">Suggest duplicates</button>
              <Boundary>Project metadata only · {MAX_VIDEO_MEDIA_LOG_ITEMS.toLocaleString()} items / {MAX_VIDEO_SMART_BINS} smart bins. Queries support rating, tag, status, subclip, and logging-text predicates. Duplicate matches are suggestions, never automatic deletion.</Boundary>
            </WorkflowCard>
          </>
        ) : null}

        {tab === 'review' ? (
          <WorkflowCard icon={<UsersRound size={14} />} number="07" title="Local review & approval">
            <div className="rounded-md border border-amber-300/25 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-100">Local file exchange only — no cloud users, presence, notifications, or server approval authority.</div>
            <MetricStrip values={[["Notes", reviewWorkflow?.annotations.length ?? value.reviewAnnotations.length], ["Limit", MAX_VIDEO_REVIEW_ANNOTATIONS], ["Approval", approvalEvaluation?.effectiveStatus ?? 'unreviewed']]} />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-[10px] text-gray-400">Author<input className={`${inputClassName} mt-1`} onChange={(event) => setReviewAuthor(event.target.value)} value={reviewAuthor} /></label>
              <label className="text-[10px] text-gray-400">Priority<select className={`${inputClassName} mt-1`} onChange={(event) => setReviewPriority(event.target.value as VideoReviewPriority)} value={reviewPriority}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
            </div>
            <label className="mt-2 block text-[10px] text-gray-400">Review note<textarea className={`${inputClassName} mt-1 min-h-16 resize-y`} onChange={(event) => setReviewBody(event.target.value)} value={reviewBody} /></label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button className={buttonClassName} disabled={!reviewBody.trim()} onClick={() => onReviewCommand({ kind: 'add-annotation', body: reviewBody.trim(), author: reviewAuthor.trim() || 'Local reviewer', priority: reviewPriority, playheadMs, clipId: firstSelectedClipId })} type="button">Add local note</button>
              <button className={neutralButtonClassName} onClick={() => onReviewCommand({ kind: 'set-approval', status: 'approved', compositionSignature })} type="button">Approve this signature</button>
              <button className={neutralButtonClassName} onClick={() => onReviewCommand({ kind: 'set-approval', status: 'changes-requested', compositionSignature })} type="button">Request changes</button>
              <button className={neutralButtonClassName} onClick={() => onReviewCommand({ kind: 'export-report', format: 'json' })} type="button">Export JSON</button>
              <button className={neutralButtonClassName} onClick={() => onReviewCommand({ kind: 'export-report', format: 'csv' })} type="button">Export CSV</button>
              <label className={`${neutralButtonClassName} cursor-pointer`}>Import JSON<input accept="application/json,.json" className="hidden" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                if (file.size > MAX_VIDEO_REVIEW_PACKAGE_CHARACTERS) {
                  setReviewImportError('Review JSON must be 8 MiB or smaller.');
                  return;
                }
                void file.text()
                  .then((data) => {
                    setReviewImportError(undefined);
                    onReviewCommand({ kind: 'import-report', data });
                  })
                  .catch(() => setReviewImportError('The selected review JSON could not be read.'));
              }} type="file" /></label>
            </div>
            {reviewImportError ? <p className="mt-2 text-[10px] text-red-300" role="alert">{reviewImportError}</p> : null}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Review notes</span>
              <select aria-label="Review note filter" className="rounded border border-gray-700 bg-[#090e15] px-2 py-1 text-[9px] text-gray-200" onChange={(event) => setReviewFilter(event.target.value as 'open' | 'all')} value={reviewFilter}><option value="open">Open only</option><option value="all">All notes</option></select>
            </div>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto" aria-label="Review annotation list">
              {(reviewWorkflow?.annotations ?? []).filter((annotation) => reviewFilter === 'all' || annotation.status === 'open').slice(0, 100).map((annotation) => (
                <div className="rounded-md border border-gray-700/60 bg-black/20 p-2" key={annotation.id}>
                  <div className="flex items-start justify-between gap-2"><p className="min-w-0 flex-1 text-[10px] leading-4 text-gray-200">{annotation.body}</p><span className="text-[8px] uppercase text-gray-600">{annotation.priority}</span></div>
                  <div className="mt-1 text-[9px] text-gray-600">{annotation.author} · {annotation.status}</div>
                  <div className="mt-2 flex gap-1.5"><button className={neutralButtonClassName} onClick={() => onReviewCommand({ kind: 'navigate', annotationId: annotation.id })} type="button">Go to</button>{annotation.status !== 'resolved' ? <button className={neutralButtonClassName} onClick={() => onReviewCommand({ kind: 'resolve', annotationId: annotation.id })} type="button">Resolve</button> : null}</div>
                </div>
              ))}
            </div>
            <Boundary>Approval is tied to the immutable composition signature and invalidates after any edit changes it.</Boundary>
          </WorkflowCard>
        ) : null}

        {tab === 'captions' ? (
          <WorkflowCard icon={<Captions size={14} />} number="08" title="Semantic captions & accessibility QC">
            <MetricStrip values={[["Cues", captionDocument?.cues.length ?? 0], ["QC issues", captionQc.length], ["Limit", MAX_VIDEO_CAPTION_CUES]]} />
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="text-[10px] text-gray-400">Find<input className={`${inputClassName} mt-1`} onChange={(event) => setCaptionFind(event.target.value)} value={captionFind} /></label>
              <label className="text-[10px] text-gray-400">Replace<input className={`${inputClassName} mt-1`} onChange={(event) => setCaptionReplacement(event.target.value)} value={captionReplacement} /></label>
              <label className="text-[10px] text-gray-400">Delivery language<input aria-label="Caption delivery language" className={`${inputClassName} mt-1`} defaultValue={captionDocument?.language ?? 'und'} maxLength={16} onBlur={(event) => onCaptionCommand({ kind: 'set-language', language: event.target.value })} /></label>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button className={buttonClassName} onClick={() => onCaptionCommand({ kind: 'add-cue', playheadMs })} type="button">Add cue at playhead</button>
              <label className={`${neutralButtonClassName} cursor-pointer`}>
                Import SRT / VTT / TTML
                <input accept=".srt,.vtt,.webvtt,.ttml,application/x-subrip,text/vtt,application/ttml+xml" className="hidden" onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (!file) return;
                  const lowerName = file.name.toLowerCase();
                  const format = lowerName.endsWith('.srt') ? 'srt' as const
                    : lowerName.endsWith('.vtt') || lowerName.endsWith('.webvtt') ? 'vtt' as const
                      : lowerName.endsWith('.ttml') ? 'ttml' as const
                        : undefined;
                  if (!format) {
                    setCaptionImportError('Choose an SRT, WebVTT, or bounded TTML text file.');
                    return;
                  }
                  if (file.size > MAX_VIDEO_CAPTION_SOURCE_BYTES) {
                    setCaptionImportError('Caption source must be 2 MiB or smaller.');
                    return;
                  }
                  void file.text().then((data) => {
                    setCaptionImportError(undefined);
                    onCaptionCommand({ kind: 'import', data, format, language: captionDocument?.language });
                  }).catch(() => setCaptionImportError('The selected caption file could not be read.'));
                }} type="file" />
              </label>
              <button className={neutralButtonClassName} disabled={!captionFind} onClick={() => onCaptionCommand({ kind: 'find-replace', find: captionFind, replacement: captionReplacement })} type="button">Find & replace</button>
              <button className={neutralButtonClassName} onClick={() => onCaptionCommand({ kind: 'run-accessibility-qc' })} type="button">Run accessibility QC</button>
              {(['srt', 'vtt', 'ttml'] as const).map((format) => <button className={neutralButtonClassName} key={format} onClick={() => onCaptionCommand({ kind: 'export', format })} type="button">Export {format.toUpperCase()}</button>)}
            </div>
            {captionImportError ? <p className="mt-2 text-[10px] text-red-300" role="alert">{captionImportError}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-cyan-300/20 bg-cyan-400/5 p-2">
              <button
                aria-pressed={value.captionEmbedding.enabled}
                className={value.captionEmbedding.enabled ? buttonClassName : neutralButtonClassName}
                disabled={!value.captionEmbedding.enabled && !(captionDocument?.cues.length)}
                onClick={() => onCaptionCommand({ kind: 'set-embedding', enabled: !value.captionEmbedding.enabled })}
                type="button"
              >
                {value.captionEmbedding.enabled ? 'Embedded MP4/MOV captions on' : 'Embed primary captions in MP4/MOV'}
              </button>
              <span className="text-[9px] text-gray-400">Native CPU only · one `mov_text` track · plain timing/text only</span>
            </div>
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto" aria-label="Caption cue table">
              {captionDocument?.cues.slice(0, 100).map((cue) => (
                <div className="grid grid-cols-[76px_76px_minmax(0,1fr)_auto] gap-1 rounded-md border border-gray-700/60 bg-black/20 p-1.5" key={cue.id}>
                  <input aria-label={`Start ${cue.id}`} className={inputClassName} defaultValue={cue.startMs} min={0} onBlur={(event) => onCaptionCommand({ kind: 'update-cue', cueId: cue.id, startMs: Number(event.target.value), endMs: cue.endMs, text: cue.text })} type="number" />
                  <input aria-label={`End ${cue.id}`} className={inputClassName} defaultValue={cue.endMs} min={cue.startMs + 1} onBlur={(event) => onCaptionCommand({ kind: 'update-cue', cueId: cue.id, startMs: cue.startMs, endMs: Number(event.target.value), text: cue.text })} type="number" />
                  <input aria-label={`Text ${cue.id}`} className={inputClassName} defaultValue={cue.text} onBlur={(event) => onCaptionCommand({ kind: 'update-cue', cueId: cue.id, startMs: cue.startMs, endMs: cue.endMs, text: event.target.value })} />
                  <div className="flex gap-1"><button aria-label={`Split ${cue.id}`} className={neutralButtonClassName} onClick={() => onCaptionCommand({ kind: 'split-cue', cueId: cue.id })} type="button">Split</button><button aria-label={`Delete ${cue.id}`} className={neutralButtonClassName} onClick={() => onCaptionCommand({ kind: 'delete-cue', cueId: cue.id })} type="button">×</button></div>
                </div>
              ))}
            </div>
            {captionQc.length ? <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">{captionQc.slice(0, 20).map((issue, index) => <div className="rounded border border-amber-300/20 bg-amber-950/20 px-2 py-1 text-[9px] text-amber-50" key={`${issue.cueId}-${issue.code}-${index}`}>{issue.cueId} · {issue.detail}</div>)}</div> : <EmptyLine>No semantic caption QC issues in the supplied document.</EmptyLine>}
            <Boundary>Imports and authoring use bounded SRT/VTT/TTML text. Enabled delivery muxes one primary SRT track as MP4/MOV `mov_text`; it preserves timing, text, and language, not authoring font/color/background/position styling. CEA-608/708, SCC, broadcast certification, WebM/image output, browser/VAAPI embedding, and custom caption styling remain unavailable.</Boundary>
          </WorkflowCard>
        ) : null}

        {tab === 'delivery' ? (
          <>
            <WorkflowCard icon={<ClipboardCheck size={14} />} number="09" title="Decoded-signal QC">
              <MetricStrip values={[["Analyzed", decodedSignalQcReport?.summary.analyzedSources ?? 0], ["Partial", decodedSignalQcReport?.summary.partialSources ?? 0], ["Unavailable", decodedSignalQcReport?.summary.unavailableSources ?? 0], ["Errors", decodedSignalQcReport?.summary.errors ?? 0]]} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button className={buttonClassName} disabled={decodedSignalQcRunning} onClick={() => onQcCommand({ kind: 'run-decoded-signal' })} type="button">{decodedSignalQcRunning ? 'Decoding signal…' : 'Run decoded-signal QC'}</button>
                {decodedSignalQcRunning ? <button className={neutralButtonClassName} onClick={() => onQcCommand({ kind: 'cancel-decoded-signal' })} type="button">Cancel analysis</button> : null}
              </div>
              {decodedSignalQcReport?.issues.length ? <div className="mt-2 max-h-36 space-y-1 overflow-y-auto" aria-label="Decoded-signal QC issues">{decodedSignalQcReport.issues.slice(0, 50).map((issue) => <button className="w-full rounded-md border border-gray-700/60 bg-black/20 px-2 py-1.5 text-left text-[10px] text-gray-200" key={issue.id} onClick={() => onQcCommand({ kind: 'navigate', issueId: issue.id })} type="button"><span className="font-semibold">{issue.title}</span><span className="mt-0.5 block text-gray-500">{issue.detail}</span></button>)}</div> : <EmptyLine>{decodedSignalQcReport ? 'No sampled decoded-signal findings were retained.' : 'No decoded-signal report supplied yet.'}</EmptyLine>}
              {decodedSignalQcReport && decodedSignalQcReport.compositionSignature !== compositionSignature ? <p className="mt-2 rounded border border-amber-300/20 bg-amber-950/20 px-2 py-1 text-[9px] text-amber-100">The saved report belongs to an earlier composition signature; run it again before delivery.</p> : null}
              <Boundary>Samples browser-decoded frames and PCM windows from bounded local source URLs. A failed frame or PCM side remains visible as a partial source, while fully blocked, unsupported, or over-limit sources remain unavailable; this is not a full-frame, loudness, gamut, or stream-integrity certification.</Boundary>
            </WorkflowCard>

            <WorkflowCard icon={<ClipboardCheck size={14} />} number="10" title="Structural QC">
              <MetricStrip values={[["Errors", structuralQcReport?.summary.errors ?? 0], ["Warnings", structuralQcReport?.summary.warnings ?? 0], ["Info", structuralQcReport?.summary.info ?? 0]]} />
              <button className={`${buttonClassName} mt-2`} onClick={() => onQcCommand({ kind: 'run-structural' })} type="button">Run structural QC</button>
              {structuralQcReport?.issues.length ? <div className="mt-2 max-h-36 space-y-1 overflow-y-auto" aria-label="Structural QC issues">{structuralQcReport.issues.slice(0, 50).map((issue) => <button className="w-full rounded-md border border-gray-700/60 bg-black/20 px-2 py-1.5 text-left text-[10px] text-gray-200" key={issue.id} onClick={() => onQcCommand({ kind: 'navigate', issueId: issue.id })} type="button"><span className="font-semibold">{issue.title}</span><span className="mt-0.5 block text-gray-500">{issue.detail}</span></button>)}</div> : <EmptyLine>{structuralQcReport ? 'No structural issues found in saved descriptors.' : 'No structural report supplied yet.'}</EmptyLine>}
              <Boundary>Saved-descriptor checks only. No claims about black/frozen frames, silence, clipping, loudness, gamut, or stream integrity.</Boundary>
            </WorkflowCard>

            <WorkflowCard icon={<PackageCheck size={14} />} number="11" title="Durable render queue">
              <MetricStrip values={[["Queued", renderQueue.queuedOutputs], ["Running", renderQueue.runningOutputs], ["Interrupted", renderQueue.interruptedOutputs], ["Delivered", renderQueue.succeededOutputs]]} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {value.deliveryProfiles.map((profile) => <button className={buttonClassName} key={profile.id} onClick={() => onDeliveryCommand({ kind: 'plan', profileId: profile.id, compositionSignature })} type="button">Plan {profile.name}</button>)}
              </div>
              {renderQueue.interruptedOutputs > 0 ? (
                <p className="mt-2 rounded border border-amber-300/25 bg-amber-950/25 px-2 py-1 text-[9px] text-amber-50" role="status">
                  {renderQueue.interruptedOutputs} output{renderQueue.interruptedOutputs === 1 ? '' : 's'} stopped when a previous session ended. Nothing restarts on its own — resume the job to pick up only the work that was lost.
                </p>
              ) : null}
              {renderQueue.hasRunnableWork && !renderQueueRunning ? (
                <div className="mt-2 flex items-center justify-between gap-2 rounded border border-amber-300/25 bg-amber-950/25 px-2 py-1.5" role="status">
                  <span className="text-[9px] text-amber-50">Queue paused — nothing is running. Opening a project never starts a render on its own.</span>
                  <button className={buttonClassName} onClick={() => onDeliveryCommand({ kind: 'resume-queue' })} type="button">Resume queue</button>
                </div>
              ) : null}
              {value.deliveryJobs.length ? (
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto" aria-label="Durable render queue">
                  {value.deliveryJobs.slice(-20).reverse().map((job) => (
                    <RenderQueueJobRow
                      job={job}
                      key={job.id}
                      onDeliveryCommand={onDeliveryCommand}
                      profileName={profileNames.get(job.profileId) ?? job.profileId}
                      stale={isVideoRenderQueueJobStale(job, compositionSignature)}
                    />
                  ))}
                </div>
              ) : <EmptyLine>Nothing is queued. Plan a delivery to put work in the queue.</EmptyLine>}
              <Boundary>The queue itself is durable: it is saved with the project, and work interrupted by a crash, a reload, or a workspace switch is reported honestly and resumed without re-running anything already delivered. Rendering still only runs while Video is open — nothing renders in the background after the app closes — and master/audio outputs stay blocked until a native renderer provides their codecs.</Boundary>
            </WorkflowCard>
          </>
        ) : null}
      </div>
      <footer className="border-t border-gray-700/70 bg-[#101722] px-3 py-2 text-[9px] text-gray-500" aria-live="polite">
        {selectedClipIds.length} clip{selectedClipIds.length === 1 ? '' : 's'} selected · record <span className="font-mono text-cyan-100">{recordTimecode}</span> · {shortSignature(compositionSignature)}
      </footer>
    </section>
  );
}

/** Status colours carry the same distinction the lifecycle does: parked work is not failed work. */
const RENDER_QUEUE_STATUS_TONE: Record<VideoRenderQueueRecord['status'], string> = {
  planned: 'text-gray-400',
  queued: 'text-cyan-200',
  running: 'text-cyan-100',
  interrupted: 'text-amber-200',
  completed: 'text-emerald-200',
  partial: 'text-amber-200',
  failed: 'text-rose-200',
  cancelled: 'text-gray-500',
};

function RenderQueueJobRow({ job, onDeliveryCommand, profileName, stale }: {
  job: VideoRenderQueueRecord;
  onDeliveryCommand: (command: ProfessionalDeliveryCommand) => void;
  profileName: string;
  stale: boolean;
}) {
  const outputs = job.outputs ?? [];
  const resumable = outputs.some((output) => (
    (output.status === 'interrupted' || output.status === 'failed')
    && (output.attempts ?? 0) < MAX_VIDEO_RENDER_QUEUE_ATTEMPTS
  ));
  const cancellable = outputs.length
    ? outputs.some((output) => output.status === 'queued' || output.status === 'running' || output.status === 'interrupted')
    : job.status !== 'cancelled' && job.status !== 'completed';
  // Resume and Retry are the same transition; the wording follows why the work stopped.
  const resumeLabel = job.status === 'interrupted' ? 'Resume' : 'Retry';

  return (
    <div className="rounded-md border border-gray-700/60 bg-black/20 p-2">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="truncate font-semibold text-gray-200">{profileName}</span>
        <span className={`uppercase ${RENDER_QUEUE_STATUS_TONE[job.status]}`}>{job.status}</span>
      </div>
      {stale ? (
        <p className="mt-1 text-[9px] text-amber-200">Frozen against an earlier cut. Re-plan it so the delivered file matches the signature it claims.</p>
      ) : null}
      {job.message ? <p className="mt-1 text-[9px] text-gray-500">{job.message}</p> : null}
      {outputs.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {outputs.map((output) => (
            <li className="flex items-center justify-between gap-2 text-[9px] text-gray-400" key={output.id}>
              <span className="truncate">{output.label}</span>
              <span className="shrink-0 font-mono text-gray-500">{describeRenderQueueOutput(output)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {job.status === 'planned' && !stale ? <button className={buttonClassName} onClick={() => onDeliveryCommand({ kind: 'queue', jobId: job.id })} type="button">Queue</button> : null}
        {resumable && !stale ? <button className={buttonClassName} onClick={() => onDeliveryCommand({ kind: 'retry', jobId: job.id })} type="button">{resumeLabel}</button> : null}
        <button className={neutralButtonClassName} onClick={() => onDeliveryCommand({ kind: 'export-manifest', jobId: job.id })} type="button">Manifest</button>
        {cancellable ? <button className={neutralButtonClassName} onClick={() => onDeliveryCommand({ kind: 'cancel', jobId: job.id })} type="button">Cancel</button> : null}
      </div>
    </div>
  );
}

/** Reports what actually happened to one output — measured bytes on success, the real reason otherwise. */
function describeRenderQueueOutput(output: VideoRenderQueueOutput): string {
  if (output.status === 'succeeded') {
    return output.result?.byteSize !== undefined ? `delivered · ${formatByteSize(output.result.byteSize)}` : 'delivered';
  }
  if (output.status === 'blocked') {
    return output.missingCapabilities.length ? `blocked · needs ${output.missingCapabilities[0]}` : 'blocked';
  }
  const attempts = output.attempts ?? 0;
  if (output.status === 'interrupted' || output.status === 'failed') {
    return `${output.status} · attempt ${attempts}/${MAX_VIDEO_RENDER_QUEUE_ATTEMPTS}`;
  }
  return output.status;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function WorkflowCard({ icon, number, title, children }: { icon: ReactNode; number: string; title: string; children: ReactNode }) {
  return <section className="rounded-lg border border-gray-700/70 bg-[#111720] p-3"><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-gray-100"><span className="text-cyan-200" aria-hidden="true">{icon}</span><span className="rounded bg-black/25 px-1.5 py-0.5 font-mono text-[9px] text-gray-500">{number}</span><h3>{title}</h3></div>{children}</section>;
}

function MetricStrip({ values }: { values: Array<[string, string | number]> }) {
  return <div className="mt-2 grid gap-1.5 text-center" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>{values.map(([label, value]) => <div className="rounded-md border border-gray-700/60 bg-black/20 px-1 py-1.5" key={label}><div className="truncate text-[9px] uppercase tracking-wider text-gray-600">{label}</div><div className="mt-0.5 truncate text-[11px] font-semibold text-gray-200">{value}</div></div>)}</div>;
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="text-[9px] text-gray-500">{label}<input className={`${inputClassName} mt-1`} onChange={(event) => onChange(Number(event.target.value) || 0)} type="number" value={value} /></label>;
}

function Boundary({ children }: { children: ReactNode }) {
  return <p className="mt-2 border-l-2 border-cyan-300/20 pl-2 text-[9px] leading-4 text-gray-500">{children}</p>;
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="mt-2 rounded-md border border-dashed border-gray-700/60 px-2 py-2 text-[10px] text-gray-600">{children}</p>;
}

function resolveTimebaseId(timebase: VideoProductionTimebase): KnownVideoTimebaseId {
  for (const id of TIMEBASES) {
    const candidate = getKnownVideoTimebase(id);
    if (candidate.numerator === timebase.numerator && candidate.denominator === timebase.denominator && candidate.dropFrame === timebase.dropFrame) return id;
  }
  return '30';
}

function splitTags(value: string): string[] {
  return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))].slice(0, 64);
}

function shortSignature(value: string): string {
  const normalized = value.trim();
  if (!normalized) return 'signature unavailable';
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sig ${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function formatMilliseconds(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function resolveRecordTimecode(timebase: VideoProductionTimebase, playheadMs: number): string {
  try {
    const normalized = {
      numerator: timebase.numerator,
      denominator: timebase.denominator,
      nominalFps: Math.max(1, Math.round(timebase.numerator / timebase.denominator)),
      dropFrame: timebase.dropFrame,
    };
    const context = createVideoTimecodeContext({ timebase: normalized, startTimecode: timebase.sequenceStartTimecode });
    return timelineFrameToRecordTimecode(secondsToFrames(playheadMs / 1_000, normalized), context);
  } catch {
    return formatMilliseconds(playheadMs);
  }
}
