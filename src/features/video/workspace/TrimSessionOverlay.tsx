import type { KeyboardEvent } from 'react';
import type { AdvancedTrimClip } from '../../../lib/videoAdvancedTrim';
import type { VideoTrimToolSession } from '../../../lib/videoTimelineToolSessions';

export interface TrimSessionOverlayUpdate {
  deltaMs: number;
  source: 'numeric' | 'step';
}

export interface TrimSessionOverlayProps<TClip extends AdvancedTrimClip = AdvancedTrimClip> {
  session: VideoTrimToolSession<TClip>;
  onUpdate: (update: TrimSessionOverlayUpdate) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function TrimSessionOverlay<TClip extends AdvancedTrimClip>({
  session,
  onUpdate,
  onCommit,
  onCancel,
}: TrimSessionOverlayProps<TClip>) {
  const frameMs = 1_000 / session.framesPerSecond;
  const trim = session.trim;
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onCommit();
    }
  };

  return (
    <section
      aria-label={`${session.mode} trim session`}
      className="absolute bottom-4 left-1/2 z-50 w-[min(34rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-amber-300/35 bg-[#11151d]/95 p-3 shadow-2xl backdrop-blur"
      onKeyDown={handleKeyDown}
      role="region"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-200">{session.mode} trim</div>
          <div aria-live="polite" className="mt-0.5 text-xs text-gray-300">
            {formatSignedFrames(trim.appliedDeltaMs, session.framesPerSecond)} · {trim.affectedClipIds.length} affected clip{trim.affectedClipIds.length === 1 ? '' : 's'}
          </div>
        </div>
        <label className="text-[10px] text-gray-400">
          Delta milliseconds
          <input
            aria-label="Trim delta milliseconds"
            className="ml-2 w-28 rounded border border-gray-600 bg-black/30 px-2 py-1 font-mono text-xs text-gray-100"
            max={trim.maximumDeltaMs}
            min={trim.minimumDeltaMs}
            onChange={(event) => onUpdate({ deltaMs: Number(event.target.value), source: 'numeric' })}
            step={frameMs}
            type="number"
            value={roundMilliseconds(trim.requestedDeltaMs)}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="rounded-md border border-gray-600 px-2 py-1 text-xs text-gray-200" onClick={() => onUpdate({ deltaMs: trim.appliedDeltaMs - frameMs, source: 'step' })} type="button">−1 frame</button>
        <button className="rounded-md border border-gray-600 px-2 py-1 text-xs text-gray-200" onClick={() => onUpdate({ deltaMs: trim.appliedDeltaMs + frameMs, source: 'step' })} type="button">+1 frame</button>
        <span className="min-w-0 flex-1 text-right text-[10px] text-gray-500">Clamp {roundMilliseconds(trim.minimumDeltaMs)} to {roundMilliseconds(trim.maximumDeltaMs)} ms</span>
        <button className="rounded-md border border-gray-600 px-3 py-1 text-xs font-semibold text-gray-200" onClick={onCancel} type="button">Cancel</button>
        <button className="rounded-md border border-cyan-300/40 bg-cyan-400/15 px-3 py-1 text-xs font-semibold text-cyan-50" onClick={onCommit} type="button">Apply trim</button>
      </div>
    </section>
  );
}

function formatSignedFrames(deltaMs: number, framesPerSecond: number): string {
  const frames = Math.round((deltaMs * framesPerSecond) / 1_000);
  return `${frames >= 0 ? '+' : ''}${frames} frame${Math.abs(frames) === 1 ? '' : 's'}`;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
