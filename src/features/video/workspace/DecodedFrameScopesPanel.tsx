import { useState, type RefObject } from 'react';
import type { VideoScopeBin } from '../../../lib/videoColorPipeline';
import {
  compactVideoScopeBinsForDisplay,
  measureDecodedVideoFrameScopes,
  type DecodedVideoFrameScopeResult,
} from '../../../lib/videoDecodedFrameScopes';

export interface DecodedFrameScopesPanelProps {
  hasPlayablePreview: boolean;
  isImageSequenceOutput: boolean;
  isRenderedPreview: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
}

function ScopePlot({
  bins,
  color,
  height,
  label,
  width,
}: {
  bins: readonly VideoScopeBin[];
  color: string;
  height: number;
  label: string;
  width: number;
}) {
  const points = compactVideoScopeBinsForDisplay(bins, width, height);
  const highestCount = Math.max(1, ...points.map((point) => point.count));
  return (
    <svg
      aria-label={label}
      className="h-20 w-full rounded border border-gray-700/60 bg-black/35"
      data-video-scope-plot={label}
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <title>{label}</title>
      {points.map((point) => (
        <rect
          fill={color}
          height={Math.max(1, Math.ceil(height / 64))}
          key={`${point.x}-${point.y}`}
          opacity={Math.min(1, 0.16 + (0.84 * Math.sqrt(point.count / highestCount)))}
          width={Math.max(1, Math.ceil(width / 128))}
          x={point.x}
          y={point.y}
        />
      ))}
    </svg>
  );
}

function Histogram({ values }: { values: readonly number[] }) {
  const maximum = Math.max(1, ...values);
  return (
    <svg
      aria-label="Luma histogram"
      className="h-20 w-full rounded border border-gray-700/60 bg-black/35"
      data-video-scope-plot="Luma histogram"
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 256 100"
    >
      <title>Luma histogram</title>
      {values.slice(0, 256).map((count, index) => {
        const barHeight = Math.max(0, Math.round((count / maximum) * 100));
        return <rect fill="#d1d5db" height={barHeight} key={index} width="1" x={index} y={100 - barHeight} />;
      })}
    </svg>
  );
}

function unavailableMessage({
  hasPlayablePreview,
  isImageSequenceOutput,
  isRenderedPreview,
}: Pick<DecodedFrameScopesPanelProps, 'hasPlayablePreview' | 'isImageSequenceOutput' | 'isRenderedPreview'>): string | undefined {
  if (!isRenderedPreview) return 'Switch the Program Monitor to Rendered Preview before measuring decoded pixels.';
  if (isImageSequenceOutput) return 'An image-sequence archive has no mounted decoded Program Monitor video to measure.';
  if (!hasPlayablePreview) return 'Render the Program Monitor to create a playable preview before measuring scopes.';
  return undefined;
}

/** A non-persistent Program Monitor diagnostic for the frame the browser actually decoded. */
export function DecodedFrameScopesPanel({
  hasPlayablePreview,
  isImageSequenceOutput,
  isRenderedPreview,
  videoRef,
}: DecodedFrameScopesPanelProps) {
  const [measurement, setMeasurement] = useState<DecodedVideoFrameScopeResult | undefined>();
  const unavailable = unavailableMessage({ hasPlayablePreview, isImageSequenceOutput, isRenderedPreview });

  const result = measurement?.ok ? measurement.value : undefined;
  const refusal = measurement && !measurement.ok ? measurement : undefined;
  const state = unavailable ? 'unavailable' : result ? 'ready' : refusal ? 'refused' : 'idle';

  return (
    <section
      className="rounded-lg border border-cyan-300/20 bg-cyan-500/5 p-3"
      data-video-decoded-scopes={state}
      data-video-decoded-scopes-source="rendered-program-monitor"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-cyan-100">Decoded frame scopes</h3>
          <p className="mt-1 text-[10px] leading-4 text-gray-400">
            Measures only pixels already decoded by the mounted rendered Program Monitor. It does not measure the edit stage, a source monitor, proxy/original metadata, or an export file.
          </p>
        </div>
        <button
          className="shrink-0 rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-50 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800/40 disabled:text-gray-600"
          data-video-measure-decoded-scopes="true"
          disabled={Boolean(unavailable)}
          onClick={() => setMeasurement(measureDecodedVideoFrameScopes(videoRef.current))}
          title={unavailable}
          type="button"
        >
          Measure frame
        </button>
      </div>

      <div aria-live="polite" className="mt-2 text-[10px] leading-4 text-gray-400" data-video-decoded-scopes-status={state}>
        {unavailable ?? (refusal ? refusal.message : result
          ? `Measured ${result.capturedAtMilliseconds} ms · ${result.sampledDimensions.width}×${result.sampledDimensions.height} sampled from ${result.sourceDimensions.width}×${result.sourceDimensions.height} decoded pixels · ${result.scopes.sampleCount.toLocaleString()} samples.`
          : 'No frame has been measured. Measurement is explicit and runs only when you select Measure frame.')}
      </div>

      {result ? (
        <div className="mt-3 grid gap-2">
          <div>
            <div className="mb-1 text-[10px] font-medium text-gray-300">Luma histogram</div>
            <Histogram values={result.scopes.histogram} />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-medium text-gray-300">Waveform</div>
            <ScopePlot bins={result.scopes.waveform.bins} color="#67e8f9" height={result.scopes.waveform.height} label="Luma waveform" width={result.scopes.waveform.width} />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-medium text-gray-300">RGB parade</div>
            <div className="grid grid-cols-3 gap-1">
              <ScopePlot bins={result.scopes.rgbParade.red} color="#f87171" height={result.scopes.rgbParade.height} label="Red parade" width={result.scopes.rgbParade.width} />
              <ScopePlot bins={result.scopes.rgbParade.green} color="#4ade80" height={result.scopes.rgbParade.height} label="Green parade" width={result.scopes.rgbParade.width} />
              <ScopePlot bins={result.scopes.rgbParade.blue} color="#60a5fa" height={result.scopes.rgbParade.height} label="Blue parade" width={result.scopes.rgbParade.width} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-medium text-gray-300">Vectorscope</div>
            <ScopePlot bins={result.scopes.vectorscope.bins} color="#e879f9" height={result.scopes.vectorscope.size} label="Vectorscope" width={result.scopes.vectorscope.size} />
          </div>
          <p className="text-[10px] leading-4 text-gray-500">
            The raw frame is discarded after measurement. Scope readings are transient monitor diagnostics and are not saved with the composition.
          </p>
        </div>
      ) : null}
    </section>
  );
}
