import { useId, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, MapPin, Plus, Search, Trash2, Upload } from 'lucide-react';
import {
  MAX_VIDEO_RICH_MARKER_TIME_MS,
  MAX_VIDEO_RICH_MARKERS,
  navigateVideoRichMarkers,
  sortVideoRichMarkers,
  type VideoRichMarker,
  type VideoRichMarkerKind,
  type VideoRichMarkerTarget,
} from '../../../lib/videoRichMarkers';
import {
  MAX_VIDEO_TIMELINE_SEARCH_RESULTS,
  searchVideoTimelineIndex,
  type VideoTimelineSearchEntityKind,
  type VideoTimelineSearchIndex,
  type VideoTimelineSearchOnlineState,
  type VideoTimelineSearchProxyState,
  type VideoTimelineSearchResult,
} from '../../../lib/videoTimelineSearchIndex';

type SearchMarkersTab = 'search' | 'markers';

export type SearchMarkersNavigation =
  | { kind: 'search-result'; result: VideoTimelineSearchResult }
  | { kind: 'marker'; marker: VideoRichMarker };

export interface VideoMarkerDraft {
  name: string;
  notes: string;
  kind: VideoRichMarkerKind;
  color: string;
  target: VideoRichMarkerTarget;
}

export type SearchMarkersCommand =
  | { kind: 'add-marker'; draft: VideoMarkerDraft }
  | { kind: 'delete-marker'; markerId: string }
  | { kind: 'request-import'; format: 'json' | 'csv' }
  | { kind: 'request-export'; format: 'json' | 'csv' };

export interface SearchMarkersPanelProps {
  index: VideoTimelineSearchIndex;
  markers: readonly VideoRichMarker[];
  currentTimeMs: number;
  activeSequenceId?: string;
  selectedClipId?: string;
  initialQuery?: string;
  onNavigate: (navigation: SearchMarkersNavigation) => void;
  onMarkerCommand: (command: SearchMarkersCommand) => void;
  onQueryChange?: (query: string) => void;
  nativeSyncWarning?: string;
  className?: string;
}

export const VIDEO_MARKER_PAGE_SIZE = 250;

const inputClassName = 'w-full rounded border border-gray-700 bg-[#090e15] px-2 py-1.5 text-[11px] text-gray-100 outline-none focus:border-cyan-300/60';
const buttonClassName = 'rounded border border-gray-700 bg-[#111823] px-2 py-1.5 text-[11px] text-gray-200 hover:border-cyan-400/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40';

export function SearchMarkersPanel({
  index,
  markers,
  currentTimeMs,
  activeSequenceId,
  selectedClipId,
  initialQuery = '',
  onNavigate,
  onMarkerCommand,
  onQueryChange,
  nativeSyncWarning,
  className = '',
}: SearchMarkersPanelProps) {
  const [tab, setTab] = useState<SearchMarkersTab>('search');
  const [query, setQuery] = useState(initialQuery);
  const [entityKind, setEntityKind] = useState<VideoTimelineSearchEntityKind | 'all'>('all');
  const [onlineState, setOnlineState] = useState<VideoTimelineSearchOnlineState | 'all'>('all');
  const [proxyState, setProxyState] = useState<VideoTimelineSearchProxyState | 'all'>('all');
  const [effectName, setEffectName] = useState('');
  const [markerName, setMarkerName] = useState('');
  const [markerNotes, setMarkerNotes] = useState('');
  const [markerKind, setMarkerKind] = useState<VideoRichMarkerKind>('comment');
  const [markerColor, setMarkerColor] = useState('#22d3ee');
  const [markerTarget, setMarkerTarget] = useState<VideoRichMarkerTarget['kind']>('point');
  const [rangeDurationMs, setRangeDurationMs] = useState(5_000);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string>();
  const [markerPageIndex, setMarkerPageIndex] = useState(0);
  const controlId = useId();
  const sortedMarkers = useMemo(() => sortVideoRichMarkers(markers), [markers]);
  const markerPageCount = Math.max(1, Math.ceil(sortedMarkers.length / VIDEO_MARKER_PAGE_SIZE));
  const visibleMarkerPageIndex = Math.min(markerPageIndex, markerPageCount - 1);
  const visibleMarkerStart = visibleMarkerPageIndex * VIDEO_MARKER_PAGE_SIZE;
  const visibleMarkers = sortedMarkers.slice(visibleMarkerStart, visibleMarkerStart + VIDEO_MARKER_PAGE_SIZE);
  const authoredTimeMs = Number.isFinite(currentTimeMs)
    ? Math.min(MAX_VIDEO_RICH_MARKER_TIME_MS, Math.max(0, Math.round(currentTimeMs)))
    : 0;
  const rangeAtProjectCeiling = markerTarget === 'range' && authoredTimeMs >= MAX_VIDEO_RICH_MARKER_TIME_MS;
  const rangeLimitMessageId = `${controlId}-range-limit`;
  const results = useMemo(() => searchVideoTimelineIndex(index, {
    text: query,
    sequenceId: activeSequenceId,
    entityKinds: entityKind === 'all' ? undefined : [entityKind],
    onlineStates: onlineState === 'all' ? undefined : [onlineState],
    proxyStates: proxyState === 'all' ? undefined : [proxyState],
    effectNames: effectName.trim() ? [effectName.trim()] : undefined,
    limit: MAX_VIDEO_TIMELINE_SEARCH_RESULTS,
  }), [activeSequenceId, effectName, entityKind, index, onlineState, proxyState, query]);

  const navigateAdjacent = (direction: 'previous' | 'next') => {
    const marker = navigateVideoRichMarkers(markers, currentTimeMs, direction, true);
    if (marker) onNavigate({ kind: 'marker', marker });
  };

  const submitMarker = () => {
    if (rangeAtProjectCeiling) return;
    const name = markerName.trim() || `${markerKind[0].toUpperCase()}${markerKind.slice(1)} marker`;
    const target: VideoRichMarkerTarget = markerTarget === 'range'
      ? {
          kind: 'range',
          startMs: authoredTimeMs,
          endMs: Math.min(MAX_VIDEO_RICH_MARKER_TIME_MS, authoredTimeMs + Math.max(1, Math.round(rangeDurationMs))),
        }
      : markerTarget === 'clip' && selectedClipId
        ? { kind: 'clip', clipId: selectedClipId, timeMs: authoredTimeMs }
        : { kind: 'point', timeMs: authoredTimeMs };
    onMarkerCommand({
      kind: 'add-marker',
      draft: { name, notes: markerNotes.trim(), kind: markerKind, color: markerColor, target },
    });
    setMarkerName('');
    setMarkerNotes('');
  };

  return (
    <section aria-label="Timeline search and markers" className={`flex min-h-0 flex-col rounded-lg border border-gray-800 bg-[#0b111a] text-gray-100 ${className}`}>
      <header className="border-b border-gray-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-200">Search &amp; Markers</h2>
        <p className="mt-0.5 text-[10px] text-gray-500">Revision-indexed project metadata · no media scanning</p>
      </header>
      <div role="tablist" aria-label="Search and marker views" className="grid grid-cols-2 gap-1 border-b border-gray-800 p-2">
        {(['search', 'markers'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${controlId}-${value}-tab`}
            aria-controls={`${controlId}-${value}-panel`}
            aria-selected={tab === value}
            className={`${buttonClassName} ${tab === value ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-100' : ''}`}
            onClick={() => setTab(value)}
          >
            {value === 'search' ? 'Search' : `Markers · ${markers.length}`}
          </button>
        ))}
      </div>

      {tab === 'search' ? (
        <div
          aria-labelledby={`${controlId}-search-tab`}
          className="flex min-h-0 flex-1 flex-col"
          id={`${controlId}-search-panel`}
          role="tabpanel"
        >
          <div className="space-y-2 border-b border-gray-800 p-2">
            <label className="relative block">
              <span className="sr-only">Search project metadata</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-gray-500" />
              <input
                type="search"
                className={`${inputClassName} pl-7`}
                aria-label="Search project metadata"
                value={query}
                onChange={(event) => { setQuery(event.target.value); onQueryChange?.(event.target.value); }}
                placeholder="Clips, logs, captions, transcripts, markers…"
              />
            </label>
            <div className="grid grid-cols-3 gap-1">
              <select aria-label="Result type" className={inputClassName} value={entityKind} onChange={(event) => setEntityKind(event.target.value as VideoTimelineSearchEntityKind | 'all')}>
                <option value="all">All types</option>
                <option value="clip">Clips</option>
                <option value="media-log">Media logs</option>
                <option value="caption">Captions</option>
                <option value="transcript">Transcripts</option>
                <option value="marker">Markers</option>
              </select>
              <select aria-label="Media online state" className={inputClassName} value={onlineState} onChange={(event) => setOnlineState(event.target.value as VideoTimelineSearchOnlineState | 'all')}>
                <option value="all">Any media</option>
                <option value="online">Online</option>
                <option value="offline">Offline</option>
                <option value="stale">Stale</option>
              </select>
              <select aria-label="Proxy state" className={inputClassName} value={proxyState} onChange={(event) => setProxyState(event.target.value as VideoTimelineSearchProxyState | 'all')}>
                <option value="all">Any proxy</option>
                <option value="none">No proxy</option>
                <option value="queued">Queued</option>
                <option value="building">Building</option>
                <option value="ready">Ready</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <input aria-label="Effect name filter" className={inputClassName} value={effectName} onChange={(event) => setEffectName(event.target.value)} placeholder="Effect name (exact)" />
            <p aria-live="polite" className="text-[10px] text-gray-500">{results.length}{results.length === MAX_VIDEO_TIMELINE_SEARCH_RESULTS ? '+' : ''} results · capped at {MAX_VIDEO_TIMELINE_SEARCH_RESULTS}</p>
          </div>
          <div role="list" aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto p-2">
            {results.length === 0 ? <p className="text-[10px] text-gray-500">No indexed metadata matches these filters.</p> : null}
            {results.map((result) => (
              <button
                key={`${result.document.entityKind}:${result.document.id}`}
                type="button"
                role="listitem"
                className="mb-1 block w-full rounded border border-gray-800 bg-[#0e151f] px-2 py-1.5 text-left hover:border-cyan-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                onClick={() => onNavigate({ kind: 'search-result', result })}
              >
                <span className="block truncate text-[11px] text-gray-100">{result.document.label}</span>
                <span className="mt-0.5 flex gap-2 text-[9px] uppercase tracking-wide text-gray-500">
                  <span>{result.document.entityKind}</span>
                  {result.document.startMs !== undefined ? <span>{formatTime(result.document.startMs)}</span> : null}
                  {result.document.onlineState ? <span>{result.document.onlineState}</span> : null}
                  {result.document.proxyState && result.document.proxyState !== 'none' ? <span>proxy {result.document.proxyState}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          aria-labelledby={`${controlId}-markers-tab`}
          className="flex min-h-0 flex-1 flex-col"
          id={`${controlId}-markers-panel`}
          role="tabpanel"
        >
          <div className="space-y-2 border-b border-gray-800 p-2">
            {nativeSyncWarning ? (
              <p
                aria-live="assertive"
                className="rounded border border-amber-300/30 bg-amber-300/5 px-2 py-1.5 text-[10px] leading-4 text-amber-100"
                data-marker-native-sync="unavailable"
                role="alert"
              >
                {nativeSyncWarning}
              </p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-1">
                <button type="button" className={buttonClassName} aria-label="Previous marker" onClick={() => navigateAdjacent('previous')}><ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" /></button>
                <button type="button" className={buttonClassName} aria-label="Next marker" onClick={() => navigateAdjacent('next')}><ChevronRight aria-hidden="true" className="h-3.5 w-3.5" /></button>
              </div>
              <span aria-live="polite" className="text-[10px] text-gray-500">
                {markers.length.toLocaleString()}/{MAX_VIDEO_RICH_MARKERS.toLocaleString()} markers
              </span>
            </div>
            <form aria-label="Add marker" className="space-y-1.5" onSubmit={(event) => { event.preventDefault(); submitMarker(); }}>
              <input aria-label="Marker name" className={inputClassName} maxLength={240} value={markerName} onChange={(event) => setMarkerName(event.target.value)} placeholder={`Marker at ${formatTime(currentTimeMs)}`} />
              <textarea aria-label="Marker notes" className={`${inputClassName} min-h-14 resize-y`} maxLength={8_000} value={markerNotes} onChange={(event) => setMarkerNotes(event.target.value)} placeholder="Editorial notes" />
              <div className="grid grid-cols-3 gap-1">
                <select aria-label="Marker kind" className={inputClassName} value={markerKind} onChange={(event) => setMarkerKind(event.target.value as VideoRichMarkerKind)}>
                  <option value="comment">Comment</option><option value="chapter">Chapter</option><option value="edit">Edit</option><option value="sync">Sync</option><option value="qc">QC</option>
                </select>
                <select aria-label="Marker target" className={inputClassName} value={markerTarget} onChange={(event) => setMarkerTarget(event.target.value as VideoRichMarkerTarget['kind'])}>
                  <option value="point">Point</option><option value="range">Range</option><option value="clip" disabled={!selectedClipId}>Selected clip</option>
                </select>
                <label className="flex items-center gap-1 rounded border border-gray-700 bg-[#090e15] px-2 text-[10px] text-gray-400">
                  Color <input aria-label="Marker color" type="color" value={markerColor} onChange={(event) => setMarkerColor(event.target.value)} className="h-6 min-w-7 bg-transparent" />
                </label>
              </div>
              {markerTarget === 'range' ? <input aria-label="Marker range duration milliseconds" className={inputClassName} type="number" min={1} value={rangeDurationMs} onChange={(event) => setRangeDurationMs(Math.max(1, Number(event.target.value) || 1))} /> : null}
              {rangeAtProjectCeiling ? (
                <p
                  className="rounded border border-amber-300/30 bg-amber-300/5 px-2 py-1.5 text-[10px] leading-4 text-amber-100"
                  data-marker-range-limit="reached"
                  id={rangeLimitMessageId}
                  role="alert"
                >
                  A range marker needs time after its start. Move the playhead earlier than the 12-hour project limit, or choose Point.
                </p>
              ) : null}
              <button
                aria-describedby={rangeAtProjectCeiling ? rangeLimitMessageId : undefined}
                className={buttonClassName}
                disabled={markers.length >= MAX_VIDEO_RICH_MARKERS || rangeAtProjectCeiling}
                type="submit"
              >
                <Plus aria-hidden="true" className="mr-1 inline h-3 w-3" />Add at playhead
              </button>
            </form>
            <div className="flex flex-wrap gap-1">
              <button type="button" className={buttonClassName} onClick={() => onMarkerCommand({ kind: 'request-import', format: 'json' })}><Upload aria-hidden="true" className="mr-1 inline h-3 w-3" />Import JSON</button>
              <button type="button" className={buttonClassName} onClick={() => onMarkerCommand({ kind: 'request-import', format: 'csv' })}>Import CSV</button>
              <button type="button" className={buttonClassName} onClick={() => onMarkerCommand({ kind: 'request-export', format: 'json' })}><Download aria-hidden="true" className="mr-1 inline h-3 w-3" />Export JSON</button>
              <button type="button" className={buttonClassName} onClick={() => onMarkerCommand({ kind: 'request-export', format: 'csv' })}>Export CSV</button>
            </div>
          </div>
          {sortedMarkers.length > VIDEO_MARKER_PAGE_SIZE ? (
            <nav aria-label="Marker pages" className="flex items-center justify-between gap-2 border-b border-gray-800 px-2 py-1.5 text-[10px] text-gray-400">
              <span aria-live="polite">
                Showing {visibleMarkerStart + 1}–{visibleMarkerStart + visibleMarkers.length} of {sortedMarkers.length.toLocaleString()} markers · page {visibleMarkerPageIndex + 1} of {markerPageCount}
              </span>
              <span className="flex gap-1">
                <button
                  aria-label="Previous marker page"
                  className={buttonClassName}
                  disabled={visibleMarkerPageIndex === 0}
                  onClick={() => setMarkerPageIndex((current) => Math.max(0, current - 1))}
                  type="button"
                >
                  Previous
                </button>
                <button
                  aria-label="Next marker page"
                  className={buttonClassName}
                  disabled={visibleMarkerPageIndex >= markerPageCount - 1}
                  onClick={() => setMarkerPageIndex((current) => Math.min(markerPageCount - 1, current + 1))}
                  type="button"
                >
                  Next
                </button>
              </span>
            </nav>
          ) : null}
          <div role="list" aria-label="Sequence markers" className="min-h-0 flex-1 overflow-y-auto p-2">
            {sortedMarkers.length === 0 ? <p className="text-[10px] text-gray-500">No sequence markers.</p> : null}
            {visibleMarkers.map((marker) => (
              <div key={marker.id} role="listitem" className="mb-1 flex items-start gap-1 rounded border border-gray-800 bg-[#0e151f] p-1.5">
                <button
                  aria-label={`Go to ${marker.name}, ${marker.kind} ${marker.target.kind} marker at ${formatTime(marker.target.kind === 'range' ? marker.target.startMs : marker.target.timeMs)}, color ${marker.color}`}
                  className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  onClick={() => onNavigate({ kind: 'marker', marker })}
                  type="button"
                >
                  <span className="flex items-center gap-1 truncate text-[11px]"><MapPin aria-hidden="true" className="h-3 w-3" style={{ color: marker.color }} />{marker.name}</span>
                  <span className="text-[9px] uppercase tracking-wide text-gray-500">{formatTime(marker.target.kind === 'range' ? marker.target.startMs : marker.target.timeMs)} · {marker.kind} · {marker.target.kind} · color {marker.color}</span>
                </button>
                <button
                  aria-controls={`${controlId}-remove-confirmation`}
                  aria-expanded={confirmDeleteId === marker.id}
                  aria-label={`Delete ${marker.name}`}
                  className="rounded p-1 text-gray-500 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  onClick={() => setConfirmDeleteId(marker.id)}
                  type="button"
                ><Trash2 aria-hidden="true" className="h-3 w-3" /></button>
              </div>
            ))}
            {confirmDeleteId ? (
              <div
                aria-label="Confirm marker removal"
                className="sticky bottom-0 rounded border border-red-500/30 bg-[#241016] p-2 text-[10px] text-red-100"
                id={`${controlId}-remove-confirmation`}
                role="alertdialog"
              >
                Remove this marker? This action should be recorded by the host history transaction.
                <div className="mt-1 flex gap-1">
                  <button type="button" className={buttonClassName} onClick={() => { onMarkerCommand({ kind: 'delete-marker', markerId: confirmDeleteId }); setConfirmDeleteId(undefined); }}>Confirm remove</button>
                  <button type="button" className={buttonClassName} onClick={() => setConfirmDeleteId(undefined)}>Cancel</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

function formatTime(timeMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, timeMs) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = Math.floor(Math.max(0, timeMs) % 1_000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}
