import { adjustmentLayerLabel, defaultAdjustmentSettings } from './ImageAdjustmentLayer';
import { describeGpuAdjustmentPreview, type GpuAdjustmentPreviewOptions } from './ImageAdjustmentGpuPreview';
import type { AdjustmentLayerKind, ImageAdjustmentSettings } from '../../types/imageEditor';
import { useImageEditorStore } from '../../store/imageEditorStore';
import {
  getHistogramChannelStats,
  summarizeHistogramBins,
  type ImageHistogram,
  type ImageHistogramChannel,
} from './ImageHistogram';

const ADJUSTMENT_LAYER_KINDS: AdjustmentLayerKind[] = [
  'brightnessContrast',
  'hueSaturation',
  'blackWhite',
  'invert',
  'exposure',
  'temperatureTint',
  'levels',
  'curves',
  'lut',
  'gradientMap',
  'channelMixer',
  'selectiveColor',
];

export interface AdjustmentLayerControlsProps {
  adjustment: ImageAdjustmentSettings;
  disabled?: boolean;
  histogram?: ImageHistogram | null;
  histogramError?: string | null;
  histogramLoading?: boolean;
  gpuPreviewOptions?: GpuAdjustmentPreviewOptions;
  onChange: (settings: ImageAdjustmentSettings) => void;
}

export function AdjustmentLayerControls({
  adjustment,
  disabled,
  histogram,
  histogramError,
  histogramLoading,
  gpuPreviewOptions,
  onChange,
}: AdjustmentLayerControlsProps) {
  const gpuPreview = describeGpuAdjustmentPreview(adjustment, gpuPreviewOptions);
  const setKind = (kind: AdjustmentLayerKind) => {
    onChange(defaultAdjustmentSettings(kind));
  };

  return (
    <div className="mt-2 border-t border-cyan-300/10 pt-2">
      <div className="mb-2 flex items-center gap-2">
        <label className="w-12 text-cyan-100/40">Adjust</label>
        <select
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onChange={(event) => setKind(event.target.value as AdjustmentLayerKind)}
          value={adjustment.kind}
        >
          {ADJUSTMENT_LAYER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {adjustmentLayerLabel(kind)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        {renderAdjustmentSettings(adjustment, disabled, histogram, onChange, histogramError, histogramLoading)}
      </div>
      <button
        className="mt-2 w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/55 hover:border-emerald-300/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        onClick={() => onChange(defaultAdjustmentSettings(adjustment.kind))}
        type="button"
      >
        Reset {adjustmentLayerLabel(adjustment.kind)}
      </button>
      <p
        className="mt-2 rounded border border-cyan-300/10 bg-cyan-300/5 px-2 py-1.5 text-[10px] leading-relaxed text-cyan-100/45"
        data-image-gpu-adjustment-preview
      >
        <span className="font-semibold text-cyan-100/65">GPU compositor: </span>
        {gpuPreview.reason}
      </p>
    </div>
  );
}


function renderAdjustmentSettings(
  adjustment: ImageAdjustmentSettings,
  disabled: boolean | undefined,
  histogram: ImageHistogram | null | undefined,
  onChange: (settings: ImageAdjustmentSettings) => void,
  histogramError?: string | null,
  histogramLoading?: boolean,
): React.ReactNode {
  switch (adjustment.kind) {
    case 'brightnessContrast':
      return (
        <>
          <AdjustmentSlider
            disabled={disabled}
            label="Bright"
            max={150}
            min={-150}
            onChange={(brightness) => onChange({ ...adjustment, brightness })}
            step={1}
            value={adjustment.brightness}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Contrast"
            max={100}
            min={-100}
            onChange={(contrast) => onChange({ ...adjustment, contrast })}
            step={1}
            value={adjustment.contrast}
          />
        </>
      );
    case 'hueSaturation':
      return (
        <>
          <AdjustmentSlider
            disabled={disabled}
            label="Hue"
            max={180}
            min={-180}
            onChange={(hue) => onChange({ ...adjustment, hue })}
            step={1}
            value={adjustment.hue}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Sat"
            max={100}
            min={-100}
            onChange={(saturation) => onChange({ ...adjustment, saturation })}
            step={1}
            value={adjustment.saturation}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Light"
            max={100}
            min={-100}
            onChange={(lightness) => onChange({ ...adjustment, lightness })}
            step={1}
            value={adjustment.lightness}
          />
        </>
      );
    case 'exposure':
      return (
        <>
          <AdjustmentSlider
            disabled={disabled}
            label="Expose"
            max={3}
            min={-3}
            onChange={(exposure) => onChange({ ...adjustment, exposure })}
            step={0.1}
            value={adjustment.exposure}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Offset"
            max={0.5}
            min={-0.5}
            onChange={(offset) => onChange({ ...adjustment, offset })}
            step={0.01}
            value={adjustment.offset}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Gamma"
            max={3}
            min={0.1}
            onChange={(gamma) => onChange({ ...adjustment, gamma })}
            step={0.05}
            value={adjustment.gamma}
          />
        </>
      );
    case 'temperatureTint':
      return (
        <>
          <AdjustmentSlider
            disabled={disabled}
            label="Temp"
            max={100}
            min={-100}
            onChange={(temperature) => onChange({ ...adjustment, temperature })}
            step={1}
            value={adjustment.temperature}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Tint"
            max={100}
            min={-100}
            onChange={(tint) => onChange({ ...adjustment, tint })}
            step={1}
            value={adjustment.tint}
          />
        </>
      );
    case 'levels':
      return (
        <>
          <AdjustmentChannelSelect
            disabled={disabled}
            value={adjustment.channel}
            onChange={(channel) => onChange({ ...adjustment, channel })}
          />
          <AdjustmentHistogramPreview
            adjustmentChannel={adjustment.channel}
            histogram={histogram}
            title="Levels Histogram"
            error={histogramError}
            loading={histogramLoading}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="In B"
            max={254}
            min={0}
            onChange={(inputBlack) => onChange({ ...adjustment, inputBlack })}
            step={1}
            value={adjustment.inputBlack}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="In W"
            max={255}
            min={1}
            onChange={(inputWhite) => onChange({ ...adjustment, inputWhite })}
            step={1}
            value={adjustment.inputWhite}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Gamma"
            max={3}
            min={0.1}
            onChange={(gamma) => onChange({ ...adjustment, gamma })}
            step={0.05}
            value={adjustment.gamma}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Out B"
            max={255}
            min={0}
            onChange={(outputBlack) => onChange({ ...adjustment, outputBlack })}
            step={1}
            value={adjustment.outputBlack}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Out W"
            max={255}
            min={0}
            onChange={(outputWhite) => onChange({ ...adjustment, outputWhite })}
            step={1}
            value={adjustment.outputWhite}
          />
        </>
      );
    case 'curves':
      return (
        <>
          <AdjustmentChannelSelect
            disabled={disabled}
            value={adjustment.channel}
            onChange={(channel) => onChange({ ...adjustment, channel })}
          />
          <AdjustmentHistogramPreview
            adjustmentChannel={adjustment.channel}
            histogram={histogram}
            title="Curves Histogram"
            error={histogramError}
            loading={histogramLoading}
          />
          <div className="grid grid-cols-2 gap-1">
            {adjustment.points.map((point, index) => (
              <div className="grid grid-cols-2 gap-1" key={index}>
                <input
                  className="rounded border border-cyan-300/10 bg-[#10131b] px-1 py-0.5 text-[11px] text-cyan-100/55"
                  disabled={disabled}
                  max={255}
                  min={0}
                  onChange={(event) => {
                    const points = adjustment.points.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, input: parseFloat(event.target.value) } : candidate);
                    onChange({ ...adjustment, points });
                  }}
                  title="Input"
                  type="number"
                  value={point.input}
                />
                <input
                  className="rounded border border-cyan-300/10 bg-[#10131b] px-1 py-0.5 text-[11px] text-cyan-100/55"
                  disabled={disabled}
                  max={255}
                  min={0}
                  onChange={(event) => {
                    const points = adjustment.points.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, output: parseFloat(event.target.value) } : candidate);
                    onChange({ ...adjustment, points });
                  }}
                  title="Output"
                  type="number"
                  value={point.output}
                />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button className="rounded border border-cyan-300/10 px-1.5 py-1 text-[10px] text-cyan-100/55 hover:text-white" disabled={disabled} onClick={() => onChange({ ...adjustment, points: [...adjustment.points, { input: 128, output: 128 }] })} type="button">Add Point</button>
            <button className="rounded border border-cyan-300/10 px-1.5 py-1 text-[10px] text-cyan-100/55 hover:text-white" disabled={disabled || adjustment.points.length <= 2} onClick={() => onChange({ ...adjustment, points: adjustment.points.slice(0, -1) })} type="button">Remove Point</button>
          </div>
          <AdjustmentSlider
            disabled={disabled}
            label="Shadow"
            max={120}
            min={-120}
            onChange={(shadows) => onChange({ ...adjustment, shadows })}
            step={1}
            value={adjustment.shadows}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="Mid"
            max={120}
            min={-120}
            onChange={(midtones) => onChange({ ...adjustment, midtones })}
            step={1}
            value={adjustment.midtones}
          />
          <AdjustmentSlider
            disabled={disabled}
            label="High"
            max={120}
            min={-120}
            onChange={(highlights) => onChange({ ...adjustment, highlights })}
            step={1}
            value={adjustment.highlights}
          />
        </>
      );
    case 'blackWhite':
      return <p className="text-[11px] text-cyan-100/35">Converts lower visible layers to monochrome.</p>;
    case 'invert':
      return <p className="text-[11px] text-cyan-100/35">Inverts lower visible layer colors.</p>;
    case 'lut': {
      const values = adjustment.lutData ? Array.from(adjustment.lutData) : (adjustment.lutDataValues ?? []);
      const preset = values.length === 256 && values.every((value, index) => value === 255 - index) ? 'invert' : 'identity';
      return <>
        <AdjustmentChannelSelect disabled={disabled} value={adjustment.channel} onChange={(channel) => onChange({ ...adjustment, channel })} />
        <label className="flex items-center gap-2 text-[11px] text-cyan-100/55"><span className="w-12">Preset</span><select aria-label="LUT preset" className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs" disabled={disabled} onChange={(event) => { const lutData = new Uint8ClampedArray(256); for (let index = 0; index < 256; index += 1) lutData[index] = event.target.value === 'invert' ? 255 - index : index; onChange({ ...adjustment, lutData, lutDataValues: Array.from(lutData) }); }} value={preset}><option value="identity">Identity</option><option value="invert">Invert</option></select></label>
      </>;
    }
    case 'gradientMap':
      return <label className="flex items-center gap-2 text-[11px] text-cyan-100/55"><span className="w-12">Preset</span><select aria-label="Gradient Map preset" className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs" disabled={disabled} onChange={(event) => onChange({ ...adjustment, stops: event.target.value === 'blue-red' ? [{ position: 0, color: [0, 0, 255] }, { position: 1, color: [255, 0, 0] }] : [{ position: 0, color: [0, 0, 0] }, { position: 1, color: [255, 255, 255] }] })} value={adjustment.stops[0]?.color[2] === 255 && adjustment.stops[0]?.color[0] === 0 ? 'blue-red' : 'black-white'}><option value="black-white">Black → White</option><option value="blue-red">Blue → Red</option></select></label>;
    case 'channelMixer':
      return (
        <>
          <p className="text-[10px] text-cyan-100/35">Output channels mix the source RGB channels. Values over 100% are allowed for creative grading.</p>
          <ChannelMixerRow disabled={disabled} label="Red out" onChange={(red) => onChange({ ...adjustment, red })} value={adjustment.red} />
          <ChannelMixerRow disabled={disabled} label="Green out" onChange={(green) => onChange({ ...adjustment, green })} value={adjustment.green} />
          <ChannelMixerRow disabled={disabled} label="Blue out" onChange={(blue) => onChange({ ...adjustment, blue })} value={adjustment.blue} />
        </>
      );
    case 'selectiveColor':
      return (
        <>
          <label className="flex items-center gap-2 text-[11px] text-cyan-100/55"><span className="w-12">Colors</span><select aria-label="Selective colour target" className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs" disabled={disabled} onChange={(event) => onChange({ ...adjustment, target: event.target.value as typeof adjustment.target })} value={adjustment.target}>{['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'].map((target) => <option key={target} value={target}>{target[0].toUpperCase() + target.slice(1)}</option>)}</select></label>
          <AdjustmentSlider disabled={disabled} label="Cyan" max={100} min={-100} onChange={(cyan) => onChange({ ...adjustment, cyan })} step={1} value={adjustment.cyan} />
          <AdjustmentSlider disabled={disabled} label="Magenta" max={100} min={-100} onChange={(magenta) => onChange({ ...adjustment, magenta })} step={1} value={adjustment.magenta} />
          <AdjustmentSlider disabled={disabled} label="Yellow" max={100} min={-100} onChange={(yellow) => onChange({ ...adjustment, yellow })} step={1} value={adjustment.yellow} />
          <AdjustmentSlider disabled={disabled} label="Black" max={100} min={-100} onChange={(black) => onChange({ ...adjustment, black })} step={1} value={adjustment.black} />
        </>
      );
  }
}

function ChannelMixerRow({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: [number, number, number]) => void;
  value: [number, number, number];
}) {
  return <div className="grid grid-cols-[3.4rem_repeat(3,minmax(0,1fr))] items-center gap-1 text-[10px] text-cyan-100/45"><span>{label}</span>{(['R', 'G', 'B'] as const).map((channel, index) => <label key={channel}><span className="sr-only">{label} {channel}</span><input aria-label={`${label} ${channel}`} className="w-full rounded border border-cyan-300/10 bg-[#10131b] px-1 py-0.5 text-[11px] text-cyan-100/70" disabled={disabled} max={200} min={-200} onChange={(event) => { const next = [...value] as [number, number, number]; next[index] = Number(event.target.value); onChange(next); }} step={1} type="number" value={value[index]} /></label>)}</div>;
}

export interface AdjustmentHistogramPreviewProps {
  adjustmentChannel: 'rgb' | 'red' | 'green' | 'blue';
  histogram?: ImageHistogram | null;
  title: string;
  error?: string | null;
  loading?: boolean;
}

function AdjustmentHistogramPreview({
  adjustmentChannel,
  histogram,
  title,
  error,
  loading,
}: AdjustmentHistogramPreviewProps) {
  if (error) {
    return (
      <div
        className="rounded border border-dashed border-red-300/20 bg-[#10131b] p-1.5"
        role="alert"
        aria-live="polite"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/45">
            {title}
          </span>
          <span className="font-mono text-[10px] text-red-300/75">
            Error
          </span>
        </div>
        <p className="text-[10px] text-red-300/65">
          {error}
        </p>
      </div>
    );
  }

  if (loading || !histogram) {
    return (
      <div
        className="rounded border border-dashed border-cyan-300/10 bg-[#10131b] p-1.5"
        aria-busy={loading}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/45">
            {title}
          </span>
          <span className="font-mono text-[10px] text-amber-200/55">
            {loading ? 'Computing' : 'Pending'}
          </span>
        </div>
        <p className="text-[10px] text-cyan-100/40">
          {loading ? 'Computing histogram from visible layers...' : 'Histogram preview pending'}
        </p>
        <p className="mt-0.5 text-[10px] text-cyan-100/35">
          Render lower visible layers to inspect Levels or Curves clipping before applying changes.
        </p>
      </div>
    );
  }
  const channel = getHistogramChannelForAdjustment(adjustmentChannel);
  const bins = summarizeHistogramBins(histogram.channels[channel], 32);
  const stats = getHistogramChannelStats(histogram, channel);
  const maxBin = Math.max(1, ...bins);
  const meanLabel = stats.mean === null ? '--' : String(stats.mean);
  const rangeLabel = stats.min === null || stats.max === null ? 'Empty' : `${stats.min}-${stats.max}`;

  const histogramLabel = `Document ${getHistogramChannelLabel(channel)} adjustment histogram, mean ${meanLabel}, range ${rangeLabel}, ${stats.sampleCount} pixels, ${stats.clippedShadows} shadow clipped, ${stats.clippedHighlights} highlight clipped`;

  return (
    <div className="rounded border border-cyan-300/10 bg-[#10131b] p-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/45">
          {title}
        </span>
        <span className="font-mono text-[10px] text-cyan-100/45">
          {getHistogramChannelLabel(channel)}
        </span>
      </div>
      <div
        aria-label={histogramLabel}
        className="flex h-8 items-end gap-px rounded border border-cyan-300/10 bg-[#070a10] px-1 py-1"
        role="img"
      >
        {bins.map((value, index) => (
          <span
            aria-hidden="true"
            className={`block flex-1 rounded-sm ${getHistogramBarClass(channel)}`}
            key={index}
            style={{ height: `${Math.max(2, Math.round((value / maxBin) * 24))}px` }}
            title={`Bin ${index}: ${value} pixels`}
          />
        ))}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-cyan-100/40">
        <span><abbr title="Average brightness/color value">Mean</abbr> <b className="font-mono text-cyan-100/65">{meanLabel}</b></span>
        <span><abbr title="Minimum to maximum brightness/color values">Range</abbr> <b className="font-mono text-cyan-100/65">{rangeLabel}</b></span>
        <span><abbr title="Non-transparent pixels sampled">Pixels</abbr> <b className="font-mono text-cyan-100/65">{stats.sampleCount}</b></span>
      </div>
      <div className="mt-0.5 grid grid-cols-2 gap-1 text-[10px] text-cyan-100/40">
        <span><abbr title="Pixels clipped to black (0)">Shadow Clip</abbr> <b className="font-mono text-cyan-100/65">{stats.clippedShadows}</b></span>
        <span><abbr title="Pixels clipped to white (255)">Highlight Clip</abbr> <b className="font-mono text-cyan-100/65">{stats.clippedHighlights}</b></span>
      </div>
    </div>
  );
}

function getHistogramChannelForAdjustment(channel: 'rgb' | 'red' | 'green' | 'blue'): ImageHistogramChannel {
  return channel === 'rgb' ? 'luminance' : channel;
}

function getHistogramChannelLabel(channel: ImageHistogramChannel): string {
  switch (channel) {
    case 'luminance':
      return 'Lum';
    case 'red':
      return 'Red';
    case 'green':
      return 'Green';
    case 'blue':
      return 'Blue';
    case 'alpha':
      return 'Alpha';
  }
}

function getHistogramBarClass(channel: ImageHistogramChannel): string {
  switch (channel) {
    case 'red':
      return 'bg-red-400/75';
    case 'green':
      return 'bg-emerald-400/75';
    case 'blue':
      return 'bg-sky-400/75';
    case 'alpha':
      return 'bg-cyan-50/70';
    case 'luminance':
      return 'bg-cyan-300/70';
  }
}

export function AdjustmentChannelSelect({
  disabled,
  value,
  onChange,
}: {
  disabled?: boolean;
  value: 'rgb' | 'red' | 'green' | 'blue';
  onChange: (value: 'rgb' | 'red' | 'green' | 'blue') => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-12 text-cyan-100/40">Channel</span>
      <select
        className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as 'rgb' | 'red' | 'green' | 'blue')}
        value={value}
      >
        <option value="rgb">RGB</option>
        <option value="red">Red</option>
        <option value="green">Green</option>
        <option value="blue">Blue</option>
      </select>
    </label>
  );
}

export function AdjustmentSlider({
  ariaLabel,
  disabled,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  ariaLabel?: string;
  disabled?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  const commit = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) return;
    onChange(Math.max(min, Math.min(max, nextValue)));
  };

  return (
    <div className="flex items-center gap-2">
      <label className="w-12 text-cyan-100/40">{label}</label>
      <input
        aria-label={ariaLabel}
        className="flex-1 cursor-pointer accent-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => commit(parseFloat(event.target.value))}
        onPointerDown={() => useImageEditorStore.getState().setIsDraggingSlider(true)}
        onPointerUp={() => useImageEditorStore.getState().setIsDraggingSlider(false)}
        onPointerCancel={() => useImageEditorStore.getState().setIsDraggingSlider(false)}
        step={step}
        type="range"
        value={value}
      />
      <input
        aria-label={ariaLabel ? `${ariaLabel} value` : undefined}
        className="w-12 rounded border border-cyan-300/10 bg-[#10131b] px-1 py-0.5 text-right text-[11px] text-cyan-100/55 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => commit(parseFloat(event.target.value))}
        step={step}
        type="number"
        value={Number.isInteger(value) ? value : Number(value.toFixed(2))}
      />
    </div>
  );
}
