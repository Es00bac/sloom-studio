import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Archive, AudioLines, Boxes, Captions, Film, Gauge, Layers3, Palette, Sparkles, WandSparkles } from 'lucide-react';
import type { EditorAudioClip, EditorVisualClip } from '../../../types/flow';
import {
  createDefaultEditorProfessionalVideoState,
  type EditorProfessionalVideoState,
  type ProfessionalMask,
  type ProfessionalSequenceReference,
  type ProfessionalTrack,
} from '../../../types/videoProfessional';
import type { SourceBinItem } from '../../../lib/sourceBin';
import { createEditorAudioClip, createEditorVisualClip } from '../../../lib/manualEditorState';
import {
  buildPrimaryColorCorrectionPatch,
  hasPrimaryColorCorrection,
  resetPrimaryColorCorrection,
} from '../../../lib/videoPrimaryColor';
import { MaskTrackingMediaError, runBrowserMaskTracking } from '../../../lib/videoRotoTracking';
import {
  exportCmx3600Edl,
  exportOtioJson,
  exportSloomAafHandoff,
  getAafInterchangeAvailability,
  importAaf,
  importCmx3600Edl,
  importOtioJson,
  importProfessionalFcp7Xml,
  importSloomAafHandoff,
  type ProfessionalInterchangeImportResult,
  type ProfessionalInterchangeSequence,
} from '../../../lib/videoProfessionalInterchange';
import {
  ProfessionalWorkflowToolsPanel,
  type ProfessionalWorkflowToolsPanelProps,
} from './ProfessionalWorkflowToolsPanel';
import { ExternalMonitoringControlPanel } from './ExternalMonitoringControlPanel';

type ProfessionalTab = 'media' | 'timeline' | 'finish' | 'delivery' | 'workflow' | 'editorial' | 'external';

export interface ProfessionalVideoToolsPanelProps {
  state?: EditorProfessionalVideoState;
  sourceItems: readonly SourceBinItem[];
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  selectedVisualClip?: EditorVisualClip;
  selectedAudioClip?: EditorAudioClip;
  /** Current Program Monitor refusal for malformed persisted mixer state. */
  mixerRuntimeError?: string;
  frameRate: number;
  playheadMs?: number;
  onChange: (state: EditorProfessionalVideoState, label: string) => void;
  onUpdateVisualClip: (clipId: string, patch: Partial<EditorVisualClip>, label: string) => void;
  /** Commits the child timeline and its root reference in one ordinary editor-history mutation. */
  onCreateNestedSequence?: (sequence: ProfessionalSequenceReference, referenceClip: EditorVisualClip, label: string) => void;
  onUpdateAudioClip: (clipId: string, patch: Partial<EditorAudioClip>, label: string) => void;
  onImportTimelineClips: (visualClips: EditorVisualClip[], audioClips: EditorAudioClip[], label: string) => void;
  onExportFcpXml: () => void;
  workflowToolsProps?: ProfessionalWorkflowToolsPanelProps;
  editorialTools?: ReactNode;
}

const TABS: Array<{ id: ProfessionalTab; label: string }> = [
  { id: 'media', label: 'Media' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'finish', label: 'Finish' },
  { id: 'delivery', label: 'Text & I/O' },
  { id: 'workflow', label: 'Next 10' },
  { id: 'editorial', label: 'Pro Edit' },
  { id: 'external', label: 'External I/O' },
];

const buttonClassName = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-50 transition-colors hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800/40 disabled:text-gray-600';
const inputClassName = 'w-full rounded-md border border-gray-700 bg-[#0b0f16] px-2 py-1.5 text-xs text-gray-100 outline-none focus:border-cyan-400/50';

function createMulticamCutId(): string {
  return `cut-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function isSameProfessionalMask(left: ProfessionalMask, right: ProfessionalMask): boolean {
  return left.id === right.id
    && left.kind === right.kind
    && left.inverted === right.inverted
    && left.featherPercent === right.featherPercent
    && left.opacityPercent === right.opacityPercent
    && left.points.length === right.points.length
    && left.points.every((point, index) => point.x === right.points[index]?.x && point.y === right.points[index]?.y);
}

export function ProfessionalVideoToolsPanel({
  state,
  sourceItems,
  visualClips,
  audioClips,
  selectedVisualClip,
  selectedAudioClip,
  mixerRuntimeError,
  frameRate,
  playheadMs = 0,
  onChange,
  onUpdateVisualClip,
  onCreateNestedSequence,
  onUpdateAudioClip,
  onImportTimelineClips,
  onExportFcpXml,
  workflowToolsProps,
  editorialTools,
}: ProfessionalVideoToolsPanelProps) {
  const [tab, setTab] = useState<ProfessionalTab>('media');
  const [status, setStatus] = useState('Professional state is saved with this composition.');
  const [trackingRunning, setTrackingRunning] = useState(false);
  const importRef = useRef<HTMLInputElement | null>(null);
  const trackingAbortRef = useRef<AbortController | undefined>(undefined);
  const livePanelRef = useRef({ visualClips, onUpdateVisualClip });
  useEffect(() => {
    livePanelRef.current = { visualClips, onUpdateVisualClip };
  });
  const value = state ?? createDefaultEditorProfessionalVideoState();
  const importedItems = sourceItems.filter((item) => item.professional?.origin === 'imported' || (!item.professional && item.isGenerated !== true));
  const generatedItems = sourceItems.filter((item) => item.professional?.origin === 'generated' || (!item.professional && item.isGenerated === true));
  const proxyReady = sourceItems.filter((item) => item.professional?.proxy?.status === 'ready').length;
  const offline = sourceItems.filter((item) => item.professional?.onlineState === 'offline' || item.professional?.onlineState === 'stale').length;
  const transcriptCueCount = sourceItems.reduce((total, item) => total + (item.professional?.transcript?.cues.length ?? 0), 0);
  const videoItems = sourceItems.filter((item) => item.kind === 'video' || item.kind === 'composition');
  const sourceItemById = useMemo(() => new Map(sourceItems.map((item) => [item.id, item])), [sourceItems]);
  const sequence = useMemo(
    () => buildInterchangeSequence(visualClips, audioClips, sourceItems, frameRate),
    [audioClips, frameRate, sourceItems, visualClips],
  );
  const loudnessNormalization = value.loudnessNormalization ?? createDefaultEditorProfessionalVideoState().loudnessNormalization;

  const commit = (patch: Partial<EditorProfessionalVideoState>, label: string) => {
    onChange({ ...value, ...patch }, label);
  };

  const addTrack = (kind: ProfessionalTrack['kind']) => {
    const baseTracks = value.tracks.length > 0 ? value.tracks : createLegacyProjectionTracks();
    if (baseTracks.length >= 64) {
      setStatus('Track limit reached (64). This bound keeps long-form projects predictable.');
      return;
    }
    const kindTracks = baseTracks.filter((track) => track.kind === kind);
    const prefix = kind === 'video' ? 'V' : kind === 'audio' ? 'A' : 'S';
    const track: ProfessionalTrack = {
      id: `${kind}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      kind,
      name: `${prefix}${kindTracks.length + 1}`,
      order: baseTracks.length,
      enabled: true,
      locked: false,
      muted: false,
      solo: false,
      syncLocked: true,
      sourcePatched: true,
      role: kind === 'video' ? 'standard' : kind === 'audio' ? 'dialogue' : undefined,
    };
    commit({ tracks: [...baseTracks, track] }, `Add ${kind} track`);
    setStatus(`${track.name} added to the visible timeline. Legacy projects open with four video and four audio lanes; projects can grow to 64 total tracks.`);
  };

  const createNestedSequence = () => {
    if (value.sequences.length >= 128) return;
    if (!selectedVisualClip) {
      setStatus('Select one visual clip to create an executable nested sequence.');
      return;
    }
    const id = `sequence-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    const durationMs = Math.max(1_000, Math.round((selectedVisualClip.durationSeconds ?? 4) * 1_000));
    const childClip = structuredClone(selectedVisualClip);
    childClip.professional = { ...childClip.professional, nestedSequenceId: undefined };
    const nestedSequence: ProfessionalSequenceReference = {
      id,
      name: `Nested Sequence ${value.sequences.length + 1}`,
      durationMs,
      frameRate,
      visualClips: [childClip],
    };
    const referenceClip: EditorVisualClip = {
      ...selectedVisualClip,
      sourceInMs: 0,
      sourceOutMs: durationMs,
      durationSeconds: durationMs / 1_000,
      professional: { ...selectedVisualClip.professional, nestedSequenceId: id, adjustmentLayer: false },
    };
    if (onCreateNestedSequence) {
      onCreateNestedSequence(nestedSequence, referenceClip, 'Nest selected visual clip');
      setStatus('Nested sequence now executes in the Program Monitor and export. Cycles and nesting deeper than eight levels are refused.');
      return;
    }
    // The isolated panel is also used by legacy callers. Preserve their descriptor behaviour but
    // say why it cannot execute until they adopt the atomic history callback above.
    commit({ sequences: [...value.sequences, nestedSequence] }, 'Create nested sequence');
    setStatus('Nested sequence definition saved. This host must provide the Video runtime commit callback before it can execute.');
  };

  const createMulticam = () => {
    const angles = videoItems.slice(0, 4);
    if (angles.length < 2) return;
    commit({
      multicamSources: [...value.multicamSources, {
        id: `multicam-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
        name: `Multicam ${value.multicamSources.length + 1}`,
        angleSourceIds: angles.map((item) => item.id),
        syncMethod: 'manual',
        activeAngleId: angles[0].id,
        cuts: [{ id: 'opening', timelineMs: 0, angleSourceId: angles[0].id }],
        audioFollowsVideo: false,
      }],
    }, 'Create multicam source');
    setStatus(`Created a ${angles.length}-angle multicam source. Select a normal-speed timeline clip, attach it, then record camera cuts at the playhead.`);
  };

  const selectedMulticamSource = value.multicamSources.find((source) => source.id === selectedVisualClip?.professional?.multicamSourceId)
    ?? value.multicamSources[0];

  const attachSelectedClipToMulticam = () => {
    if (!selectedVisualClip || !selectedMulticamSource) return;
    if (selectedVisualClip.playbackRate !== 1 || selectedVisualClip.reversePlayback) {
      setStatus('Multicam hosts must use normal-speed forward playback. Change speed before attaching this clip.');
      return;
    }
    updateSelectedVisualProfessional({
      multicamSourceId: selectedMulticamSource.id,
      multicamAngleId: selectedMulticamSource.activeAngleId ?? selectedMulticamSource.angleSourceIds[0],
    }, 'Attach clip to multicam source');
    setStatus(`Attached the selected clip to ${selectedMulticamSource.name}. Program Monitor and sequence export now use its persisted camera cuts.`);
  };

  const recordMulticamAngleCut = (angleSourceId: string) => {
    if (!selectedVisualClip || !selectedMulticamSource || selectedVisualClip.professional?.multicamSourceId !== selectedMulticamSource.id) return;
    const durationMs = selectedVisualClip.sourceOutMs !== undefined
      ? selectedVisualClip.sourceOutMs - selectedVisualClip.sourceInMs
      : (selectedVisualClip.durationSeconds ?? 0) * 1_000;
    const timelineMs = Math.round(playheadMs - selectedVisualClip.startMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || timelineMs < 0 || timelineMs >= durationMs) {
      setStatus('Move the playhead inside the attached clip before recording a camera cut.');
      return;
    }
    const cuts = [...(selectedMulticamSource.cuts ?? [])]
      .filter((cut) => cut.timelineMs !== timelineMs)
      .concat({ id: createMulticamCutId(), timelineMs, angleSourceId })
      .sort((left, right) => left.timelineMs - right.timelineMs || left.id.localeCompare(right.id));
    if (cuts.length > 1_000) {
      setStatus('The 1,000-cut multicam bound is reached. Remove or split the source before recording more.');
      return;
    }
    commit({ multicamSources: value.multicamSources.map((source) => source.id === selectedMulticamSource.id ? {
      ...source,
      activeAngleId: angleSourceId,
      cuts,
    } : source) }, 'Record multicam camera cut');
    setStatus(`Recorded ${sourceItemById.get(angleSourceId)?.label ?? 'camera'} at ${Math.max(0, timelineMs)} ms. Preview and export share this cut list.`);
  };

  const updateSelectedVisualProfessional = (
    patch: Partial<NonNullable<EditorVisualClip['professional']>>,
    label: string,
    legacyPatch: Partial<EditorVisualClip> = {},
  ) => {
    if (!selectedVisualClip) return;
    onUpdateVisualClip(selectedVisualClip.id, {
      ...legacyPatch,
      professional: {
        ...selectedVisualClip.professional,
        ...patch,
      },
    }, label);
  };

  const runSelectedMaskTracking = async () => {
    if (!selectedVisualClip || trackingRunning) return;
    const masks = selectedVisualClip.professional?.masks ?? [];
    const mask = masks[0];
    const source = sourceItems.find((item) => item.nodeId === selectedVisualClip.sourceNodeId || item.id === selectedVisualClip.sourceNodeId);
    if (!mask || masks.length !== 1 || source?.kind !== 'video' || !source.assetUrl) {
      setStatus('Tracking needs one selected rectangle or ellipse mask on a browser-readable video source.');
      return;
    }
    const targetClipId = selectedVisualClip.id;
    const controller = new AbortController();
    trackingAbortRef.current = controller;
    setTrackingRunning(true);
    try {
      const sourceStartMs = Math.max(0, Math.round(selectedVisualClip.sourceInMs ?? 0));
      const sourceDurationMs = Math.max(1, Math.round((selectedVisualClip.sourceOutMs ?? ((selectedVisualClip.durationSeconds ?? 0) * 1_000)) - sourceStartMs));
      const result = await runBrowserMaskTracking({
        assetUrl: source.assetUrl,
        mask,
        startMs: sourceStartMs,
        durationMs: sourceDurationMs,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const live = livePanelRef.current;
      const currentClip = live.visualClips.find((clip) => clip.id === targetClipId);
      const currentMasks = currentClip?.professional?.masks ?? [];
      if (!currentClip || currentMasks.length !== 1 || !isSameProfessionalMask(currentMasks[0]!, mask)) {
        setStatus('Mask tracking finished, but the clip or its mask changed during the run; no keyframes were saved.');
        return;
      }
      live.onUpdateVisualClip(targetClipId, {
        professional: {
          ...currentClip.professional,
          masks: currentMasks.map((candidate) => ({
            ...candidate,
            tracking: {
              status: 'ready' as const,
              keyframes: result.keyframes.map((keyframe) => ({ ...keyframe, timeMs: Math.max(0, keyframe.timeMs - sourceStartMs) })),
            },
          })),
        },
      }, 'Track selected mask from bounded decoded frames');
      setStatus(`Decoded ${result.sampledFrames} bounded frames and saved tracker keyframes. Stage and browser/native delivery now resolve the tracked mask at clip time.`);
    } catch (error) {
      if (controller.signal.aborted) setStatus('Mask tracking cancelled; no keyframes were saved.');
      else if (error instanceof MaskTrackingMediaError) setStatus(`Mask tracking failed: ${error.message} No keyframes were saved.`);
      else setStatus(error instanceof Error ? `Mask tracking unavailable: ${error.message}` : 'Mask tracking did not complete; no keyframes were saved.');
    } finally {
      if (trackingAbortRef.current === controller) trackingAbortRef.current = undefined;
      setTrackingRunning(false);
    }
  };

  const selectedPrimaryColor = selectedVisualClip?.professional?.color;
  const updatePrimaryColor = (
    patch: Parameters<typeof buildPrimaryColorCorrectionPatch>[2],
    label: string,
  ) => {
    if (!selectedVisualClip) return;
    const next = buildPrimaryColorCorrectionPatch(
      selectedVisualClip.filterStack ?? [],
      selectedPrimaryColor,
      patch,
    );
    updateSelectedVisualProfessional({ color: next.color }, label, { filterStack: next.filterStack });
    setStatus('Primary correction is saved with this clip and executes through the Program Monitor, stage-frame output, and the existing native/browser render chain.');
  };

  const resetPrimaryColor = () => {
    if (!selectedVisualClip) return;
    const next = resetPrimaryColorCorrection(selectedVisualClip.filterStack ?? [], selectedPrimaryColor);
    updateSelectedVisualProfessional({ color: next.color }, 'Reset primary color correction', { filterStack: next.filterStack });
    setStatus('Primary exposure, contrast, and saturation were reset. Unrelated clip effects and retained setup metadata were kept.');
  };

  const toggleSelectedAdjustmentLayer = () => {
    if (!selectedVisualClip) return;
    const becomesAdjustment = !selectedVisualClip.professional?.adjustmentLayer;
    if (!becomesAdjustment) {
      updateSelectedVisualProfessional({ adjustmentLayer: false }, 'Unset adjustment layer');
      return;
    }

    // FFmpeg has no independent z-plane for clips sharing one track. Put a newly created
    // adjustment pass on a dedicated higher lane, so monitor and export both mean "lower
    // tracks only". Persisted same-track adjustment plans are refused by the runtime planner.
    const highestTrack = Math.max(-1, ...visualClips.map((clip) => clip.trackIndex));
    if (highestTrack >= 63) {
      setStatus('An adjustment layer needs a dedicated higher video track; the 64-track limit is already reached.');
      return;
    }
    updateSelectedVisualProfessional(
      { adjustmentLayer: true },
      'Make adjustment layer',
      { trackIndex: highestTrack + 1 },
    );
    setStatus(`Adjustment layer moved to V${highestTrack + 2}. Its enabled filters now affect lower tracks only in monitor and export.`);
  };

  const updateSelectedAudioProfessional = (
    patch: Partial<NonNullable<EditorAudioClip['professional']>>,
    label: string,
  ) => {
    if (!selectedAudioClip) return;
    onUpdateAudioClip(selectedAudioClip.id, {
      professional: {
        pan: 0,
        ...selectedAudioClip.professional,
        ...patch,
      },
    }, label);
  };

  const updateAudioBus = (
    busId: string,
    patch: Partial<EditorProfessionalVideoState['audioBuses'][number]>,
    label: string,
  ) => {
    const bus = value.audioBuses.find((candidate) => candidate.id === busId);
    if (!bus) return;
    commit({ audioBuses: value.audioBuses.map((candidate) => candidate.id === busId ? { ...candidate, ...patch } : candidate) }, label);
  };

  const exportInterchange = (format: 'edl' | 'otio' | 'aaf-handoff') => {
    try {
      const result = format === 'edl'
        ? exportCmx3600Edl(sequence)
        : format === 'otio'
          ? exportOtioJson(sequence)
          : exportSloomAafHandoff(sequence);
      downloadText(result.data, `sloom-sequence${result.fileExtension}`, result.mediaType);
      const label = format === 'edl' ? 'CMX 3600 EDL' : format === 'otio' ? 'OpenTimelineIO JSON' : 'Sloom AAF handoff manifest';
      setStatus(`${label} exported${result.warnings.length ? ` with ${result.warnings.length} explicit limitation(s)` : ''}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Interchange export failed.');
    }
  };

  const importInterchange = async (file: File) => {
    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.aaf')) {
        // Do not materialize an arbitrary binary AAF in browser memory just to refuse it.
        importAaf();
      }
      const text = await file.text();
      const result = lowerName.endsWith('.sloom-aaf.json')
        ? importSloomAafHandoff(text)
        : lowerName.endsWith('.xml')
        ? importProfessionalFcp7Xml(text)
        : lowerName.endsWith('.edl')
          ? importCmx3600Edl(text, { frameRate: normalizeEdlFrameRate(frameRate) })
          : importOtioJson(text);
      const applied = applyInterchangeResult(result, value, sourceItems, onChange, onImportTimelineClips);
      setStatus(`Imported ${result.sequence.tracks.length} track(s) and placed ${applied.placedClips} editable clip(s). ${applied.unlinkedClips} clip(s) still need media relinking; ${result.report.dropped.length} source item(s) were dropped by the format reader.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Interchange import failed.');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0d121a]" data-professional-video-tools="true">
      <div className="border-b border-gray-700/70 bg-[#111823] px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Professional Video</div>
            <div className="mt-1 text-[11px] leading-4 text-gray-400">Bounded tools for feature-length projects. Preview may use proxies; export always requires originals.</div>
          </div>
          <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-100">v{value.version}</span>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1 rounded-lg border border-gray-700/60 bg-[#090d13] p-1" role="tablist">
          {TABS.map((entry) => (
            <button
              className={`rounded-md px-1.5 py-1.5 text-[10px] font-semibold ${tab === entry.id ? 'bg-cyan-400/15 text-cyan-50' : 'text-gray-500 hover:text-gray-200'}`}
              key={entry.id}
              onClick={() => setTab(entry.id)}
              role="tab"
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className={tab === 'workflow' || tab === 'editorial' || tab === 'external' ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 space-y-3 overflow-y-auto p-3'}>
        {tab === 'media' ? (
          <>
            <FeatureCard icon={<Archive size={14} />} number="01" title="Ingest, proxies & relink">
              <div className="grid grid-cols-4 gap-1.5 text-center">
                <Metric label="Imported" value={importedItems.length} />
                <Metric label="Generated" value={generatedItems.length} />
                <Metric label="Proxies" value={proxyReady} />
                <Metric label="Offline" value={offline} tone={offline ? 'warning' : 'normal'} />
              </div>
              <label className="mt-2 flex items-center justify-between gap-3 rounded-md border border-gray-700/60 bg-black/20 px-2.5 py-2 text-xs text-gray-200">
                Proxy playback
                <input checked={value.proxyPlaybackEnabled} onChange={(event) => commit({ proxyPlaybackEnabled: event.target.checked }, 'Toggle proxy playback')} type="checkbox" />
              </label>
              <p className="mt-2 text-[10px] leading-4 text-gray-500">Proxy/relink/consolidation jobs are capability-handle plans. Disk operations only run through an authorized native host.</p>
            </FeatureCard>
            <FeatureCard icon={<Gauge size={14} />} number="Scale" title="Long-form performance">
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <Metric label="Duration" value={formatDuration(sequenceDurationMs(sequence))} />
                <Metric label="Clips" value={visualClips.length + audioClips.length} />
                <Metric label="Tracks" value={value.tracks.length} />
              </div>
              <p className="mt-2 text-[10px] leading-4 text-gray-500">Virtualized timeline windows, bounded 64-track state, proxy-first preview, cache hashes, and incremental render plans avoid work proportional to the full feature.</p>
            </FeatureCard>
          </>
        ) : null}

        {tab === 'timeline' ? (
          <>
            <FeatureCard icon={<Layers3 size={14} />} number="02" title="Dynamic tracks & linked A/V">
              <div className="flex flex-wrap gap-1.5">
                <button className={buttonClassName} onClick={() => addTrack('video')} type="button"><Film size={12} /> Add video track</button>
                <button className={buttonClassName} onClick={() => addTrack('audio')} type="button"><AudioLines size={12} /> Add audio track</button>
                <button className={buttonClassName} onClick={() => addTrack('subtitle')} type="button"><Captions size={12} /> Add subtitle track</button>
              </div>
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {value.tracks.length ? value.tracks.map((track) => (
                  <label className="flex items-center gap-2 rounded-md border border-gray-700/60 bg-black/20 px-2 py-1.5 text-[11px]" key={track.id}>
                    <input checked={track.enabled} onChange={(event) => commit({ tracks: value.tracks.map((candidate) => candidate.id === track.id ? { ...candidate, enabled: event.target.checked } : candidate) }, 'Toggle track')} type="checkbox" />
                    <span className="min-w-0 flex-1 truncate text-gray-200">{track.name}</span>
                    <span className="text-[9px] uppercase text-gray-600">{track.kind}</span>
                    <button className="text-[10px] text-gray-400 hover:text-white" onClick={() => commit({ tracks: value.tracks.map((candidate) => candidate.id === track.id ? { ...candidate, locked: !candidate.locked } : candidate) }, 'Toggle track lock')} type="button">{track.locked ? 'Unlock' : 'Lock'}</button>
                  </label>
                )) : <p className="text-[10px] text-gray-500">Add named tracks; linked groups, sync locks, and source patches are saved per track/clip.</p>}
              </div>
            </FeatureCard>
            <FeatureCard icon={<Boxes size={14} />} number="03" title="Nested sequences & adjustment layers">
              <div className="flex flex-wrap gap-1.5">
                <button className={buttonClassName} onClick={createNestedSequence} type="button">New nested sequence</button>
                <button
                  className={buttonClassName}
                  disabled={!selectedVisualClip}
                  onClick={toggleSelectedAdjustmentLayer}
                  type="button"
                >
                  {selectedVisualClip?.professional?.adjustmentLayer ? 'Unset adjustment layer' : 'Make adjustment layer'}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-gray-500">{value.sequences.length} retained nested sequence(s). The selected clip becomes a saved child timeline; monitor/export expand it together and refuse missing, cyclic, or deeper-than-eight definitions. Adjustment layers suppress their own source and apply enabled filters to lower tracks only.</p>
            </FeatureCard>
            <FeatureCard icon={<Film size={14} />} number="04" title="Multicam">
              <button className={buttonClassName} disabled={videoItems.length < 2} onClick={createMulticam} type="button">Create from first {Math.min(4, videoItems.length)} camera clips</button>
              {selectedMulticamSource ? (
                <div className="mt-2 space-y-2" data-multicam-route="executable">
                  <button className={buttonClassName} disabled={!selectedVisualClip} onClick={attachSelectedClipToMulticam} type="button">Attach selected clip to {selectedMulticamSource.name}</button>
                  <div className="flex flex-wrap gap-1">
                    {selectedMulticamSource.angleSourceIds.map((angleSourceId, index) => (
                      <button
                        className={buttonClassName}
                        disabled={selectedVisualClip?.professional?.multicamSourceId !== selectedMulticamSource.id}
                        key={angleSourceId}
                        onClick={() => recordMulticamAngleCut(angleSourceId)}
                        type="button"
                      >
                        Record Camera {index + 1}{sourceItemById.get(angleSourceId) ? ` · ${sourceItemById.get(angleSourceId)?.label}` : ''}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500">{selectedMulticamSource.cuts?.length ?? 0} persisted video cut(s). Up to four manually aligned resolved angles execute through Program Monitor and both sequence export routes; a normal-speed forward host is required. Audio-follow-video and automatic sync are unavailable.</p>
                </div>
              ) : <p className="mt-2 text-[10px] text-gray-500">Create one source from two to four resolved Video Source angles, then attach a selected timeline clip to record its cuts.</p>}
            </FeatureCard>
            <FeatureCard icon={<Gauge size={14} />} number="08" title="Retime & speed ramps">
              <label className="text-[10px] uppercase tracking-wider text-gray-500">Selected clip speed
                <select
                  className={`${inputClassName} mt-1`}
                  disabled={!selectedVisualClip}
                  onChange={(event) => {
                    const speedPercent = Number(event.target.value);
                    updateSelectedVisualProfessional({
                      retime: [{ id: 'primary', timelineStartMs: 0, timelineEndMs: Math.max(1, Math.round((selectedVisualClip?.durationSeconds ?? 1) * 1_000)), speedPercent, interpolation: 'blend' }],
                    }, 'Set professional retime', {
                      playbackRate: Math.max(0.01, Math.abs(speedPercent) / 100),
                      reversePlayback: speedPercent < 0,
                    });
                  }}
                  value={selectedVisualClip?.professional?.retime?.[0]?.speedPercent ?? 100}
                >
                  <option value={25}>25%</option><option value={50}>50%</option><option value={100}>100%</option><option value={200}>200%</option><option value={400}>400%</option>
                </select>
              </label>
              <p className="mt-2 text-[10px] text-gray-500">Uniform speed and reverse apply to current preview/export. Segmented ramps, holds, blend, and optical-flow plans are saved but await render-host wiring.</p>
            </FeatureCard>
          </>
        ) : null}

        {tab === 'finish' ? (
          <>
            <FeatureCard icon={<Palette size={14} />} number="05" title="Primary colour correction">
              <div className="space-y-2" data-primary-color-route="executable">
                <label className="block text-[10px] uppercase tracking-wider text-gray-500">Exposure trim
                  <input aria-label="Exposure trim" className="mt-1 w-full" disabled={!selectedVisualClip} max={10} min={-10} onChange={(event) => {
                    updatePrimaryColor({ exposureStops: Number(event.target.value) }, 'Adjust primary exposure');
                  }} step={0.1} type="range" value={selectedPrimaryColor?.exposureStops ?? 0} />
                </label>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500">Contrast
                  <input aria-label="Primary contrast" className="mt-1 w-full" disabled={!selectedVisualClip} max={100} min={-100} onChange={(event) => {
                    updatePrimaryColor({ contrast: Number(event.target.value) }, 'Adjust primary contrast');
                  }} step={1} type="range" value={selectedPrimaryColor?.contrast ?? 0} />
                </label>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500">Saturation
                  <input aria-label="Primary saturation" className="mt-1 w-full" disabled={!selectedVisualClip} max={200} min={0} onChange={(event) => {
                    updatePrimaryColor({ saturation: Number(event.target.value) }, 'Adjust primary saturation');
                  }} step={1} type="range" value={selectedPrimaryColor?.saturation ?? 100} />
                </label>
                <button className={buttonClassName} disabled={!selectedVisualClip || !hasPrimaryColorCorrection(selectedPrimaryColor)} onClick={resetPrimaryColor} type="button">Reset primary correction</button>
              </div>
              <label className="mt-3 block text-[10px] uppercase tracking-wider text-gray-500">Working colour metadata
                <select className={`${inputClassName} mt-1`} onChange={(event) => commit({ workingColorSpace: event.target.value as EditorProfessionalVideoState['workingColorSpace'] }, 'Set working colour metadata')} value={value.workingColorSpace}>
                  <option value="rec709">Rec.709 SDR</option><option value="display-p3">Display P3</option><option value="rec2020-pq">Rec.2020 PQ</option><option value="rec2020-hlg">Rec.2020 HLG</option>
                </select>
              </label>
              <label className="mt-2 flex items-center justify-between gap-2 text-xs text-gray-300">HDR-to-SDR tone-map setup<input checked={value.toneMapping === 'hdr-to-sdr'} onChange={(event) => commit({ toneMapping: event.target.checked ? 'hdr-to-sdr' : 'none' }, 'Toggle tone-map setup')} type="checkbox" /></label>
              <p className="mt-2 text-[10px] text-gray-500">Exposure trim, contrast, and saturation execute through the shared preview and render-effect chain. Working-space metadata, HDR tone-map setup, LUT references, RGB lift/gamma/gain, qualifiers, curves, and scopes remain unavailable for output until a real runtime consumer is added.</p>
            </FeatureCard>
            <FeatureCard icon={<WandSparkles size={14} />} number="07" title="Masks, tracking, stabilization & keying">
              <div className="grid grid-cols-2 gap-1.5">
                <select className={inputClassName} disabled={!selectedVisualClip} onChange={(event) => {
                  const chromaKeyMode = event.target.value as NonNullable<EditorVisualClip['professional']>['chromaKeyMode'];
                  updateSelectedVisualProfessional({ chromaKeyMode }, 'Set chroma key mode', {
                    chromaKey: {
                      enabled: chromaKeyMode !== 'off',
                      color: chromaKeyMode === 'blue' ? '#0000ff' : selectedVisualClip?.chromaKey?.color ?? '#00ff00',
                      similarityPercent: selectedVisualClip?.chromaKey?.similarityPercent ?? 24,
                      blendPercent: selectedVisualClip?.chromaKey?.blendPercent ?? 8,
                    },
                  });
                }} value={selectedVisualClip?.professional?.chromaKeyMode ?? 'off'}>
                  <option value="off">Key off</option><option value="green">Green screen</option><option value="blue">Blue screen</option><option value="custom">Custom key</option>
                </select>
                <button className={buttonClassName} disabled={!selectedVisualClip} onClick={() => updateSelectedVisualProfessional({ stabilization: { enabled: !selectedVisualClip?.professional?.stabilization?.enabled, strengthPercent: 50, cropMode: 'auto-scale' } }, 'Toggle stabilization setup')} type="button">{selectedVisualClip?.professional?.stabilization?.enabled ? 'Setup saved' : 'Save stab setup'}</button>
                <button className={`${buttonClassName} col-span-2`} disabled={!selectedVisualClip || selectedVisualClip.sourceKind === 'text'} onClick={() => updateSelectedVisualProfessional({ masks: [...(selectedVisualClip?.professional?.masks ?? []), { id: `mask-${Date.now()}`, kind: 'ellipse', points: [{ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }], featherPercent: 10, opacityPercent: 100, inverted: false }] }, 'Add clip mask')} type="button">Add ellipse mask</button>
                <button className={buttonClassName} disabled={!selectedVisualClip?.professional?.masks?.length || trackingRunning} onClick={() => void runSelectedMaskTracking()} type="button">{trackingRunning ? 'Tracking…' : 'Track mask (bounded)'}</button>
                <button className={buttonClassName} disabled={!trackingRunning} onClick={() => trackingAbortRef.current?.abort()} type="button">Cancel tracking</button>
              </div>
              <p className="mt-2 text-[10px] text-gray-500">Chroma key and one simple non-inverted mask reach current preview/export. Bounded tracking decodes at most 16 small frames across 60 seconds and persists no partial run; tracked masks interpolate at the active clip time across stage and browser/native delivery. Text, inverted, Bezier, and multiple masks refuse. Enabled stabilization consumes a bounded analysis artifact when present and otherwise refuses.</p>
            </FeatureCard>
            <FeatureCard icon={<AudioLines size={14} />} number="06" title="Audio mixer, buses & loudness">
              <div className="flex gap-1.5">
                <button className={buttonClassName} disabled={value.audioBuses.length >= 32} onClick={() => commit({ audioBuses: [...value.audioBuses, { id: `bus-${Date.now()}`, name: `Submix ${value.audioBuses.length}`, kind: 'submix', gainDb: 0, pan: 0, muted: false, solo: false, outputBusId: 'master' }] }, 'Add audio submix')} type="button">Add submix</button>
                <button className={buttonClassName} disabled={!selectedAudioClip} onClick={() => updateSelectedAudioProfessional({ pan: 0, busId: 'master' }, 'Route audio to master')} type="button">Route selected to master</button>
              </div>
              <div className="mt-3 space-y-2" data-video-audio-mixer="executable">
                {selectedAudioClip ? <div className="grid grid-cols-2 gap-1.5 rounded-md border border-gray-700/60 bg-black/20 p-2">
                  <label className="text-[9px] uppercase tracking-wide text-gray-500">Selected clip bus
                    <select aria-label="Selected audio clip bus" className={`${inputClassName} mt-1`} onChange={(event) => updateSelectedAudioProfessional({ busId: event.target.value }, 'Route selected audio clip')} value={selectedAudioClip.professional?.busId ?? 'master'}>
                      {value.audioBuses.map((bus) => <option key={bus.id} value={bus.id}>{bus.name}</option>)}
                    </select>
                  </label>
                  <label className="text-[9px] uppercase tracking-wide text-gray-500">Selected clip pan
                    <input aria-label="Selected audio clip pan" className={`${inputClassName} mt-1`} max={1} min={-1} onChange={(event) => updateSelectedAudioProfessional({ pan: Number(event.target.value) }, 'Pan selected audio clip')} step={0.01} type="range" value={selectedAudioClip.professional?.pan ?? 0} />
                  </label>
                </div> : <p className="rounded-md border border-gray-700/60 bg-black/20 p-2 text-[10px] text-gray-500">Select an audio clip in the Timeline to route and pan it.</p>}
                <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                  {value.audioBuses.map((bus) => <div className="grid grid-cols-[minmax(5rem,1fr)_4rem_4rem_auto_auto] items-center gap-1 rounded-md border border-gray-700/60 bg-black/20 p-1.5" data-video-audio-bus={bus.id} key={bus.id}>
                    <span className="truncate text-[10px] text-gray-200" title={bus.name}>{bus.name}</span>
                    <label className="text-[8px] uppercase text-gray-500">Gain
                      <input aria-label={`${bus.name} gain dB`} className="mt-0.5 w-full rounded border border-gray-700 bg-[#0b0f16] px-1 py-0.5 text-[10px] text-gray-100" max={24} min={-96} onChange={(event) => updateAudioBus(bus.id, { gainDb: Number(event.target.value) }, `Set ${bus.name} bus gain`)} step={0.1} type="number" value={bus.gainDb} />
                    </label>
                    <label className="text-[8px] uppercase text-gray-500">Pan
                      <input aria-label={`${bus.name} pan`} className="mt-0.5 w-full" max={1} min={-1} onChange={(event) => updateAudioBus(bus.id, { pan: Number(event.target.value) }, `Pan ${bus.name} bus`)} step={0.01} type="range" value={bus.pan ?? 0} />
                    </label>
                    <button aria-pressed={bus.muted} className={buttonClassName} onClick={() => updateAudioBus(bus.id, { muted: !bus.muted }, bus.muted ? `Unmute ${bus.name} bus` : `Mute ${bus.name} bus`)} type="button">{bus.muted ? 'Unmute' : 'Mute'}</button>
                    <button aria-pressed={bus.solo} className={buttonClassName} onClick={() => updateAudioBus(bus.id, { solo: !bus.solo }, bus.solo ? `Unsolo ${bus.name} bus` : `Solo ${bus.name} bus`)} type="button">{bus.solo ? 'Unsolo' : 'Solo'}</button>
                  </div>)}
                </div>
              </div>
              {mixerRuntimeError ? <p className="mt-2 rounded border border-amber-300/25 bg-amber-400/10 p-2 text-[10px] leading-4 text-amber-100" data-video-audio-mixer-status="refused">Audio routing is refused: {mixerRuntimeError}. Fix the saved bus route before preview or export.</p> : null}
              <p className="mt-2 text-[10px] text-gray-500">{value.audioBuses.length} persisted bus definition(s). Selected-clip routing plus bus gain/pan/mute/solo execute in Program Monitor and browser/native sequence export through one main-output chain. Sends, channel maps, effects returns, and live meters are unavailable; loudness requires its separate final-render route.</p>
              <div className="mt-3 rounded-md border border-cyan-300/15 bg-cyan-400/5 p-2" data-video-loudness-normalization="true">
                <label className="flex items-center justify-between gap-2 text-xs font-medium text-cyan-50">
                  Normalize final rendered mix
                  <input
                    checked={loudnessNormalization.enabled}
                    onChange={(event) => commit({ loudnessNormalization: { ...loudnessNormalization, enabled: event.target.checked } }, event.target.checked ? 'Enable final-mix loudness normalization' : 'Disable final-mix loudness normalization')}
                    type="checkbox"
                  />
                </label>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <label className="text-[9px] uppercase tracking-wide text-gray-500">Integrated LUFS
                    <input aria-label="Final mix target LUFS" className={`${inputClassName} mt-1`} disabled={!loudnessNormalization.enabled} max={-5} min={-70} onChange={(event) => commit({ loudnessNormalization: { ...loudnessNormalization, targetLufs: Number(event.target.value) } }, 'Set final-mix loudness target')} step={0.1} type="number" value={loudnessNormalization.targetLufs} />
                  </label>
                  <label className="text-[9px] uppercase tracking-wide text-gray-500">Range LU
                    <input aria-label="Final mix loudness range" className={`${inputClassName} mt-1`} disabled={!loudnessNormalization.enabled} max={50} min={1} onChange={(event) => commit({ loudnessNormalization: { ...loudnessNormalization, loudnessRangeLu: Number(event.target.value) } }, 'Set final-mix loudness range')} step={0.1} type="number" value={loudnessNormalization.loudnessRangeLu} />
                  </label>
                  <label className="text-[9px] uppercase tracking-wide text-gray-500">True peak dBTP
                    <input aria-label="Final mix true peak ceiling" className={`${inputClassName} mt-1`} disabled={!loudnessNormalization.enabled} max={0} min={-9} onChange={(event) => commit({ loudnessNormalization: { ...loudnessNormalization, truePeakCeilingDbtp: Number(event.target.value) } }, 'Set final-mix true peak ceiling')} step={0.1} type="number" value={loudnessNormalization.truePeakCeilingDbtp} />
                  </label>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-gray-400">When enabled, the current enabled sequence mix receives an offline FFmpeg loudnorm first pass, then its measured second pass at final render. If measurement, audio, or the required FFmpeg filter is unavailable, render stops before delivery. This setting is saved with the composition; reports and media bytes are not.</p>
              </div>
            </FeatureCard>
          </>
        ) : null}

        {tab === 'delivery' ? (
          <>
            <FeatureCard icon={<Captions size={14} />} number="09" title="Transcript-based editing">
              <div className="grid grid-cols-2 gap-1.5 text-center"><Metric label="Transcript cues" value={transcriptCueCount} /><Metric label="Removed cues" value={value.transcriptRemovedCueIds.length} /></div>
              <p className="mt-2 text-[10px] leading-4 text-gray-500">The bounded engine can search and propose word/time or silence ripple deletes. Applying those proposals from a transcript view is not yet connected.</p>
            </FeatureCard>
            <FeatureCard icon={<Sparkles size={14} />} number="10" title="Professional interchange">
              <div className="grid grid-cols-2 gap-1.5">
                <button className={buttonClassName} onClick={onExportFcpXml} type="button">Export FCP7 XML</button>
                <button className={buttonClassName} onClick={() => exportInterchange('edl')} type="button">Export CMX EDL</button>
                <button className={buttonClassName} onClick={() => exportInterchange('otio')} type="button">Export OTIO JSON</button>
                <button className={buttonClassName} onClick={() => exportInterchange('aaf-handoff')} type="button">Export Sloom AAF handoff</button>
                <button className={buttonClassName} onClick={() => importRef.current?.click()} type="button">Import timeline…</button>
                <button className={`${buttonClassName} col-span-2`} disabled title={getAafInterchangeAvailability().reason} type="button">AAF binary unavailable — handoff is JSON</button>
              </div>
              <input accept=".xml,.edl,.otio,.sloom-aaf.json,.json,.aaf,application/xml,text/plain,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importInterchange(file); event.target.value = ''; }} ref={importRef} type="file" />
              <p className="mt-2 text-[10px] leading-4 text-gray-500">FCP7 imports, cuts-only non-drop CMX 3600, OTIO, and the Sloom JSON handoff report mapped, approximated, and dropped data. Arbitrary AAF binaries still refuse before timeline mutation.</p>
            </FeatureCard>
          </>
        ) : null}
        {tab === 'workflow' ? (
          workflowToolsProps
            ? <ProfessionalWorkflowToolsPanel {...workflowToolsProps} />
            : <p className="p-3 text-[10px] text-gray-500">Select a composition to load professional workflow tools.</p>
        ) : null}
        {tab === 'editorial' ? (
          editorialTools ?? <p className="p-3 text-[10px] text-gray-500">Select a composition to load professional editorial tools.</p>
        ) : null}
        {tab === 'external' ? <ExternalMonitoringControlPanel /> : null}
      </div>
      <div className="border-t border-gray-700/70 bg-[#101620] px-3 py-2 text-[10px] leading-4 text-gray-400" aria-live="polite">{status}</div>
    </div>
  );
}

function FeatureCard({ icon, number, title, children }: { icon: ReactNode; number: string; title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-700/60 bg-[#111821]/70 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-gray-100"><span className="text-cyan-300">{icon}</span><span className="text-[9px] font-bold tracking-wider text-cyan-200/60">{number}</span>{title}</div>
      {children}
    </section>
  );
}

function Metric({ label, value, tone = 'normal' }: { label: string; value: string | number; tone?: 'normal' | 'warning' }) {
  return <div className={`rounded-md border px-1 py-2 ${tone === 'warning' ? 'border-amber-300/25 bg-amber-400/10 text-amber-100' : 'border-gray-700/60 bg-black/20 text-gray-100'}`}><div className="text-sm font-semibold tabular-nums">{value}</div><div className="mt-0.5 text-[8px] uppercase tracking-wider text-gray-500">{label}</div></div>;
}

function buildInterchangeSequence(
  visualClips: readonly EditorVisualClip[],
  audioClips: readonly EditorAudioClip[],
  sourceItems: readonly SourceBinItem[],
  frameRate: number,
): ProfessionalInterchangeSequence {
  const sourceById = new Map(sourceItems.flatMap((item) => [[item.id, item], [item.nodeId, item]]));
  const visualTracks = new Map<number, ProfessionalInterchangeSequence['tracks'][number]>();
  visualClips.forEach((clip) => {
    const track = visualTracks.get(clip.trackIndex) ?? { id: `video:${clip.trackIndex}`, name: `V${clip.trackIndex + 1}`, kind: 'video' as const, index: clip.trackIndex, items: [] };
    const durationMs = Math.max(1, Math.round((clip.durationSeconds ?? ((clip.sourceOutMs ?? 1_000) - clip.sourceInMs) / 1_000) * 1_000));
    const source = sourceById.get(clip.sourceNodeId);
    track.items.push({ type: 'clip', id: clip.id, name: source?.label ?? clip.id, startMs: clip.startMs, durationMs, sourceInMs: clip.sourceInMs + clip.trimStartMs, mediaReference: source?.nativeFilePath, enabled: true, speed: clip.playbackRate * (clip.reversePlayback ? -1 : 1) });
    visualTracks.set(clip.trackIndex, track);
  });
  const audioTracks = new Map<number, ProfessionalInterchangeSequence['tracks'][number]>();
  audioClips.forEach((clip) => {
    const track = audioTracks.get(clip.trackIndex) ?? { id: `audio:${clip.trackIndex}`, name: `A${clip.trackIndex + 1}`, kind: 'audio' as const, index: clip.trackIndex, items: [] };
    const sourceInMs = clip.sourceInMs ?? 0;
    const durationMs = Math.max(1, (clip.sourceOutMs ?? sourceInMs + 1_000) - sourceInMs);
    const source = sourceById.get(clip.sourceNodeId);
    track.items.push({ type: 'clip', id: clip.id, name: source?.label ?? clip.id, startMs: clip.offsetMs, durationMs, sourceInMs, mediaReference: source?.nativeFilePath, enabled: clip.enabled, speed: 1 });
    audioTracks.set(clip.trackIndex, track);
  });
  return { name: 'Sloom Studio Sequence', frameRate, tracks: [...visualTracks.values(), ...audioTracks.values()] };
}

function sequenceDurationMs(sequence: ProfessionalInterchangeSequence): number {
  return sequence.tracks.reduce((maximum, track) => Math.max(maximum, ...track.items.map((item) => item.startMs + item.durationMs), 0), 0);
}

function createLegacyProjectionTracks(): ProfessionalTrack[] {
  return [
    ...Array.from({ length: 4 }, (_, index): ProfessionalTrack => ({
      id: `video-${index}`,
      kind: 'video',
      name: `V${index + 1}`,
      order: index,
      enabled: true,
      locked: false,
      syncLocked: true,
      sourcePatched: true,
      role: 'standard',
    })),
    ...Array.from({ length: 4 }, (_, index): ProfessionalTrack => ({
      id: `audio-${index}`,
      kind: 'audio',
      name: `A${index + 1}`,
      order: index + 4,
      enabled: true,
      locked: false,
      muted: false,
      solo: false,
      syncLocked: true,
      sourcePatched: true,
      role: 'dialogue',
    })),
  ];
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function normalizeEdlFrameRate(frameRate: number): 24 | 25 | 30 {
  return [24, 25, 30].reduce((closest, candidate) => Math.abs(candidate - frameRate) < Math.abs(closest - frameRate) ? candidate : closest, 24) as 24 | 25 | 30;
}

export function applyInterchangeResult(
  result: ProfessionalInterchangeImportResult,
  state: EditorProfessionalVideoState,
  sourceItems: readonly SourceBinItem[],
  onChange: ProfessionalVideoToolsPanelProps['onChange'],
  onImportTimelineClips: ProfessionalVideoToolsPanelProps['onImportTimelineClips'],
): { placedClips: number; unlinkedClips: number } {
  const tracks: ProfessionalTrack[] = result.sequence.tracks.slice(0, 64).map((track, order) => ({
    id: track.id,
    name: track.name,
    kind: track.kind,
    order,
    enabled: true,
    locked: false,
    muted: false,
    solo: false,
    syncLocked: true,
    sourcePatched: true,
    role: track.kind === 'video' ? 'standard' : 'dialogue',
  }));
  const visualClips: EditorVisualClip[] = [];
  const audioClips: EditorAudioClip[] = [];
  const integrationWarnings: string[] = [];
  let unlinkedClips = 0;
  for (const track of result.sequence.tracks.slice(0, 64)) {
    for (const item of track.items) {
      if (item.type !== 'clip') continue;
      const resolution = resolveInterchangeSourceItem(item.mediaReference, item.name, sourceItems);
      const source = resolution.source;
      if (!source) {
        unlinkedClips += 1;
        continue;
      }
      if (resolution.basis !== 'exact-path') {
        integrationWarnings.push(`Clip "${item.name}" linked by ${resolution.basis === 'basename' ? 'unique filename' : 'unique source label'}; verify the media before finishing.`);
      }
      const trackIndex = Math.max(0, Math.min(63, Math.round(track.index)));
      const sourceDurationMs = Math.max(1, Math.round(item.durationMs * Math.abs(item.speed || 1)));
      if (track.kind === 'video' && isVisualInterchangeSource(source)) {
        const visualClip = createEditorVisualClip(source.nodeId, source.kind, {
          id: `imported-${item.id}-${visualClips.length}`,
          trackIndex,
          startMs: Math.max(0, Math.round(item.startMs)),
          sourceInMs: Math.max(0, Math.round(item.sourceInMs)),
          sourceOutMs: Math.max(0, Math.round(item.sourceInMs)) + sourceDurationMs,
          durationSeconds: Math.max(0.001, item.durationMs / 1_000),
          playbackRate: Math.max(0.01, Math.abs(item.speed || 1)),
          reversePlayback: item.speed < 0,
          opacityPercent: item.enabled ? 100 : 0,
        });
        visualClips.push({
          ...visualClip,
          professional: { ...visualClip.professional, trackId: track.id },
        });
        if (!item.enabled) {
          integrationWarnings.push(`Disabled visual clip "${item.name}" was approximated as zero opacity because the current visual clip model has no enabled switch.`);
        }
      } else if (track.kind === 'audio' && isAudioInterchangeSource(source) && item.speed === 1) {
        const audioClip = createEditorAudioClip(source.nodeId, trackIndex, {
          id: `imported-${item.id}-${audioClips.length}`,
          offsetMs: Math.max(0, Math.round(item.startMs)),
          sourceInMs: Math.max(0, Math.round(item.sourceInMs)),
          sourceOutMs: Math.max(0, Math.round(item.sourceInMs)) + sourceDurationMs,
          enabled: item.enabled,
        });
        audioClips.push({
          ...audioClip,
          professional: { pan: 0, ...audioClip.professional, trackId: track.id },
        });
      } else {
        // The editor cannot truthfully represent this source/track pairing (including audio retimes).
        unlinkedClips += 1;
      }
    }
  }
  onImportTimelineClips(visualClips, audioClips, 'Import professional timeline clips');
  onChange({
    ...state,
    tracks,
    interchangeHistory: [...state.interchangeHistory, {
      id: `interchange-${Date.now()}`,
      format: result.report.format === 'cmx3600' ? 'edl' : result.report.format === 'otio-json' ? 'otio' : result.report.format === 'sloom-aaf-handoff' ? 'aaf-handoff' : 'fcp7-xml',
      direction: 'import',
      createdAt: Date.now(),
      warnings: [
        ...result.report.approximated.map((entry) => entry.message),
        ...result.report.dropped.map((entry) => entry.message),
        ...integrationWarnings,
      ].slice(0, 100),
    }],
  }, 'Import professional timeline');
  return { placedClips: visualClips.length + audioClips.length, unlinkedClips };
}

export function findInterchangeSourceItem(
  mediaReference: string | undefined,
  clipName: string,
  sourceItems: readonly SourceBinItem[],
): SourceBinItem | undefined {
  return resolveInterchangeSourceItem(mediaReference, clipName, sourceItems).source;
}

function resolveInterchangeSourceItem(
  mediaReference: string | undefined,
  clipName: string,
  sourceItems: readonly SourceBinItem[],
): { source?: SourceBinItem; basis?: 'exact-path' | 'basename' | 'label' } {
  if (mediaReference) {
    const normalizedReference = normalizeMediaReference(mediaReference);
    const exactMatches = sourceItems.filter((source) => (
      source.nativeFilePath && normalizeMediaReference(source.nativeFilePath) === normalizedReference
    ));
    if (exactMatches.length === 1) return { source: exactMatches[0], basis: 'exact-path' };
    if (exactMatches.length > 1) return {};

    const referenceName = mediaBasename(normalizedReference).toLocaleLowerCase();
    const basenameMatches = sourceItems.filter((source) => (
      source.nativeFilePath && mediaBasename(normalizeMediaReference(source.nativeFilePath)).toLocaleLowerCase() === referenceName
    ));
    if (basenameMatches.length === 1) return { source: basenameMatches[0], basis: 'basename' };
    if (basenameMatches.length > 1) return {};
  }
  const normalizedName = clipName.trim().toLocaleLowerCase();
  if (!normalizedName) return {};
  const nameMatches = sourceItems.filter((source) => source.label.trim().toLocaleLowerCase() === normalizedName);
  return nameMatches.length === 1 ? { source: nameMatches[0], basis: 'label' } : {};
}

function normalizeMediaReference(value: string): string {
  const withoutScheme = value.trim()
    .replace(/^file:\/\/localhost(?=\/)/i, '')
    .replace(/^file:\/\//i, '');
  try {
    return decodeURIComponent(withoutScheme).replace(/\\/g, '/').replace(/^\/+([a-zA-Z]:\/)/, '$1');
  } catch {
    return withoutScheme.replace(/\\/g, '/').replace(/^\/+([a-zA-Z]:\/)/, '$1');
  }
}

function mediaBasename(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1);
}

function isVisualInterchangeSource(source: SourceBinItem): source is SourceBinItem & { kind: 'image' | 'video' | 'composition' } {
  return source.kind === 'image' || source.kind === 'video' || source.kind === 'composition';
}

function isAudioInterchangeSource(source: SourceBinItem): boolean {
  return source.kind === 'audio' || source.kind === 'video' || source.kind === 'composition';
}

function downloadText(data: string, fileName: string, mediaType: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mediaType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
