import type { PointerEvent } from 'react';
import {
  timelineMillisecondsToRatio,
  timelineRatioToMilliseconds,
  type VideoTimelineNavigationModel,
  type VideoTimelineRange,
} from '../../../lib/videoTimelineNavigation';

export type TimelineMinimapNavigation =
  | { kind: 'seek'; timeMs: number }
  | { kind: 'viewport'; range: VideoTimelineRange }
  | { kind: 'work-area'; range: VideoTimelineRange | undefined };

export interface TimelineMinimapProps {
  model: VideoTimelineNavigationModel;
  playheadMs: number;
  label?: string;
  onNavigate: (navigation: TimelineMinimapNavigation) => void;
}

export function TimelineMinimap({
  model,
  playheadMs,
  label = 'Timeline overview',
  onNavigate,
}: TimelineMinimapProps) {
  const viewportLeft = timelineMillisecondsToRatio(model.viewport.startMs, model.durationMs) * 100;
  const viewportWidth = ((model.viewport.endMs - model.viewport.startMs) / model.durationMs) * 100;
  const workAreaLeft = model.workArea ? timelineMillisecondsToRatio(model.workArea.startMs, model.durationMs) * 100 : 0;
  const workAreaWidth = model.workArea ? ((model.workArea.endMs - model.workArea.startMs) / model.durationMs) * 100 : 0;
  const viewportSpan = model.viewport.endMs - model.viewport.startMs;
  const moveViewport = (direction: -1 | 1) => {
    const startMs = Math.max(0, Math.min(model.durationMs - viewportSpan, model.viewport.startMs + direction * viewportSpan * 0.8));
    onNavigate({ kind: 'viewport', range: { startMs, endMs: startMs + viewportSpan } });
  };
  const handleOverviewPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;
    onNavigate({
      kind: 'seek',
      timeMs: timelineRatioToMilliseconds((event.clientX - bounds.left) / bounds.width, model.durationMs),
    });
  };

  return (
    <section aria-label={label} className="rounded-lg border border-gray-700/70 bg-[#0b1017] p-2" role="region">
      <div className="flex items-center gap-2">
        <button aria-label="Move timeline viewport earlier" className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300" onClick={() => moveViewport(-1)} type="button">←</button>
        <div
          aria-label="Seek in timeline overview"
          className="relative h-12 min-w-0 flex-1 cursor-crosshair overflow-hidden rounded border border-gray-700 bg-black/30"
          onPointerDown={handleOverviewPointer}
          role="presentation"
        >
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${model.buckets.length} 100`}>
            {model.buckets.map((bucket) => (
              <rect
                fill={bucket.audioClipCount > bucket.videoClipCount ? '#22d3ee' : '#60a5fa'}
                height={Math.max(1, bucket.density * 88)}
                key={bucket.index}
                opacity={bucket.clipCount > 0 ? 0.75 : 0.12}
                width="1"
                x={bucket.index}
                y={100 - Math.max(1, bucket.density * 88)}
              />
            ))}
          </svg>
          {model.workArea ? <div className="pointer-events-none absolute inset-y-0 border-x border-emerald-300/70 bg-emerald-400/10" style={{ left: `${workAreaLeft}%`, width: `${workAreaWidth}%` }} /> : null}
          <div className="pointer-events-none absolute inset-y-0 rounded border-2 border-cyan-200/90 bg-cyan-300/10" style={{ left: `${viewportLeft}%`, width: `${Math.max(0.4, viewportWidth)}%` }} />
          <div className="pointer-events-none absolute inset-y-0 w-px bg-red-300" style={{ left: `${timelineMillisecondsToRatio(playheadMs, model.durationMs) * 100}%` }} />
        </div>
        <button aria-label="Move timeline viewport later" className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300" onClick={() => moveViewport(1)} type="button">→</button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-500">
        <label className="min-w-0 flex flex-1 items-center gap-2">
          <span>Playhead</span>
          <input
            aria-label="Timeline overview playhead"
            className="min-w-0 flex-1"
            max={model.durationMs}
            min={0}
            onChange={(event) => onNavigate({ kind: 'seek', timeMs: Number(event.target.value) })}
            step={1}
            type="range"
            value={Math.max(0, Math.min(model.durationMs, playheadMs))}
          />
        </label>
        <span>{model.clipCount.toLocaleString()} clips · {model.buckets.length} buckets</span>
        {model.workArea ? <button className="rounded border border-gray-700 px-1.5 py-0.5" onClick={() => onNavigate({ kind: 'work-area', range: undefined })} type="button">Clear work area</button> : null}
      </div>
    </section>
  );
}
