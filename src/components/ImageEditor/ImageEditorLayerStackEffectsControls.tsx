import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { AdvancedColorPicker } from '../Common/AdvancedColorPicker';
import {
  buildLayerEffectReadinessSummary,
  createDefaultLayerEffect,
  layerEffectLabel,
  synchronizeLayerEffectsGlobalLight,
} from './ImageLayerEffects';
import { createDefaultLayerFilter, createLayerFilterMask, layerFilterLabel, setLayerFilterMaskCoverage } from './ImageLayerFilters';
import type { ImageLayerStylePreset } from './ImageLayerStyleClipboard';
import type {
  BlendMode,
  ImageLayerEffect,
  ImageLayerFilter,
  LayerEffectKind,
  LayerFilterKind,
  PatternOverlayPattern,
} from '../../types/imageEditor';

const LAYER_EFFECT_KINDS: LayerEffectKind[] = [
  'stroke',
  'bevelEmboss',
  'dropShadow',
  'innerShadow',
  'outerGlow',
  'innerGlow',
  'colorOverlay',
  'satin',
  'patternOverlay',
  'gradientOverlay',
];

const PATTERN_OVERLAY_PATTERNS: PatternOverlayPattern[] = ['checker', 'diagonal', 'dots', 'grid'];

const LAYER_FILTER_KINDS: LayerFilterKind[] = [
  'blur',
  'sharpen',
  'grayscale',
  'sepia',
  'invert',
  'noise',
  'denoise',
  'pixelate',
];

const FILTER_BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

export function LayerEffectsControls({
  disabled,
  effects,
  globalLightAngle,
  onApplyStylePreset,
  onChange,
  onGlobalLightAngleChange,
  onSaveStylePreset,
  stylePresets,
}: {
  disabled?: boolean;
  effects: ImageLayerEffect[];
  globalLightAngle?: number;
  onApplyStylePreset?: (presetId: string) => void;
  onChange: (effects: ImageLayerEffect[]) => void;
  onGlobalLightAngleChange?: (angle: number) => void;
  onSaveStylePreset?: () => void;
  stylePresets?: ImageLayerStylePreset[];
}) {
  const addEffect = (kind: LayerEffectKind) => {
    onChange([...effects, createDefaultLayerEffect(kind)]);
  };
  const updateEffect = (effectId: string, patch: Partial<ImageLayerEffect>) => {
    onChange(
      effects.map((effect) =>
        effect.id === effectId ? ({ ...effect, ...patch } as ImageLayerEffect) : effect,
      ),
    );
  };
  const removeEffect = (effectId: string) => {
    onChange(effects.filter((effect) => effect.id !== effectId));
  };
  const updateGlobalLightAngle = (angle: number) => {
    onGlobalLightAngleChange?.(angle);
    onChange(synchronizeLayerEffectsGlobalLight(effects, angle));
  };
  const hasShadowEffect = effects.some((effect) => effect.kind === 'dropShadow' || effect.kind === 'innerShadow' || effect.kind === 'bevelEmboss');
  const showGlobalLight = hasShadowEffect || onGlobalLightAngleChange;
  const showPresetControls = Boolean(onApplyStylePreset || onSaveStylePreset || (stylePresets?.length ?? 0) > 0);
  const readinessSummary = buildLayerEffectControlsReadinessSummary(effects);

  return (
    <div className="mt-2 border-t border-cyan-300/10 pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-cyan-100/40">Effects</label>
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/30">
          {effects.filter((effect) => effect.enabled).length} active
        </span>
      </div>
      <select
        aria-label="Add layer effect"
        className="mb-2 w-full rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-1 text-[11px] text-cyan-100/70 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        onChange={(event) => {
          if (!event.target.value) return;
          addEffect(event.target.value as LayerEffectKind);
          event.target.value = '';
        }}
        value=""
      >
        <option value="">Add effect…</option>
        {LAYER_EFFECT_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {layerEffectLabel(kind)}
          </option>
        ))}
      </select>
      {showGlobalLight ? (
        <div className="mb-2 rounded border border-cyan-300/10 bg-[#10131b] p-1.5">
          <MiniEffectSlider
            disabled={disabled}
            label="Light"
            inputAriaLabel="Global light angle"
            max={180}
            min={-180}
            onChange={updateGlobalLightAngle}
            step={1}
            value={globalLightAngle ?? firstShadowAngle(effects)}
            format={(value) => `${Math.round(value)}°`}
          />
        </div>
      ) : null}
      <div
        className="mb-2 truncate text-[10px] text-cyan-100/35"
        data-layer-effect-readiness-signature={readinessSummary.signature}
        data-layer-effect-readiness-status={readinessSummary.status}
        title={readinessSummary.title}
      >
        {readinessSummary.label}
      </div>
      {showPresetControls ? (
        <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] gap-1">
          <select
            aria-label="Layer style preset"
            className="min-w-0 rounded border border-cyan-300/10 bg-[#252630] px-1 py-1 text-[11px] text-cyan-100/70 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={disabled || !onApplyStylePreset || (stylePresets?.length ?? 0) === 0}
            onChange={(event) => {
              if (!event.target.value) return;
              onApplyStylePreset?.(event.target.value);
              event.target.value = '';
            }}
            value=""
          >
            <option value="">Style preset</option>
            {(stylePresets ?? []).map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <button
            className="rounded border border-cyan-300/10 px-1.5 py-1 text-[10px] text-cyan-100/60 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={disabled || !onSaveStylePreset}
            onClick={onSaveStylePreset}
            title="Save current layer style"
            type="button"
          >
            Save Style
          </button>
        </div>
      ) : null}
      <div className="space-y-2">
        {effects.map((effect) => (
          <LayerEffectRow
            disabled={disabled}
            effect={effect}
            key={effect.id}
            onRemove={() => removeEffect(effect.id)}
            onUpdate={(patch) => updateEffect(effect.id, patch)}
          />
        ))}
        {effects.length === 0 ? (
          <p className="text-[11px] text-cyan-100/30">
            Add a stroke, shadow, glow, or overlay to style this layer.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function LayerFiltersControls({
  disabled,
  filters,
  layerSize,
  onChange,
}: {
  disabled?: boolean;
  filters: ImageLayerFilter[];
  layerSize?: { width: number; height: number };
  onChange: (filters: ImageLayerFilter[]) => void;
}) {
  const addFilter = (kind: LayerFilterKind) => {
    onChange([...filters, createDefaultLayerFilter(kind)]);
  };
  const updateFilter = (filterId: string, patch: Partial<ImageLayerFilter>) => {
    onChange(filters.map((filter) => (filter.id === filterId ? { ...filter, ...patch } : filter)));
  };
  const removeFilter = (filterId: string) => {
    onChange(filters.filter((filter) => filter.id !== filterId));
  };
  const moveFilter = (filterId: string, direction: -1 | 1) => {
    const index = filters.findIndex((filter) => filter.id === filterId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= filters.length) return;
    const next = [...filters];
    const [filter] = next.splice(index, 1);
    next.splice(targetIndex, 0, filter);
    onChange(next);
  };

  return (
    <div className="mt-2 border-t border-cyan-300/10 pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-cyan-100/40">Filters</label>
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/30">
          {filters.filter((filter) => filter.enabled).length} active
        </span>
      </div>
      <select
        aria-label="Add layer filter"
        className="mb-2 w-full rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-1 text-[11px] text-cyan-100/70 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        onChange={(event) => {
          if (!event.target.value) return;
          addFilter(event.target.value as LayerFilterKind);
          event.target.value = '';
        }}
        value=""
      >
        <option value="">Add filter…</option>
        {LAYER_FILTER_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {layerFilterLabel(kind)}
          </option>
        ))}
      </select>
      <div className="space-y-1.5">
        {filters.map((filter, index) => (
          <LayerFilterRow
            canMoveDown={index < filters.length - 1}
            canMoveUp={index > 0}
            disabled={disabled}
            filter={filter}
            key={filter.id}
            onMoveDown={() => moveFilter(filter.id, 1)}
            onMoveUp={() => moveFilter(filter.id, -1)}
            onRemove={() => removeFilter(filter.id)}
            onUpdate={(patch) => updateFilter(filter.id, patch)}
            layerSize={layerSize}
          />
        ))}
        {filters.length === 0 ? (
          <p className="text-[11px] text-cyan-100/30">
            Add blur, sharpen, grayscale, sepia, invert, noise, Reduce Noise, or pixelate filters to this layer.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function buildLayerEffectControlsReadinessSummary(effects: ImageLayerEffect[]): {
  label: string;
  signature: string;
  status: 'ready' | 'warning' | 'blocked';
  title: string;
} {
  const readiness = buildLayerEffectReadinessSummary(effects, { exportTarget: 'flattened' });
  const globalLightCount = readiness.globalLight.effectIds.length;
  const status = readiness.blockers.length > 0
    ? 'blocked'
    : readiness.warnings.length > 0 || globalLightCount > 0
      ? 'warning'
      : 'ready';
  const globalLightLabel = globalLightCount === 1
    ? '1 global-light effect'
    : `${globalLightCount} global-light effects`;
  return {
    label: `${globalLightLabel} / Photoshop live effects flatten on export`,
    signature: readiness.signatures.stack,
    status,
    title: 'Layer effects, This-Layer Blend If, and Bevel & Emboss are editable inside Sloom Studio presets; native PSD live effects and Smart Object effect preservation remain unavailable.',
  };
}

function firstShadowAngle(effects: ImageLayerEffect[]): number {
  const shadow = effects.find((effect) => effect.kind === 'dropShadow' || effect.kind === 'innerShadow');
  return shadow && 'angle' in shadow ? shadow.angle : 45;
}

function getLayerFilterParityTitle(): string {
  return 'Editable in Sloom Studio: amount, blend mode, opacity, enabled state, stack order, and per-filter alpha masks. Advanced parameters and native Photoshop Smart Filter roundtrip remain unsupported.';
}

function getLayerEffectParityTitle(): string {
  return 'Portable inside Sloom Studio with deterministic preview/export signatures. This-Layer Blend If and bounded Bevel & Emboss are executable; Photoshop Underlying Layer, split sliders, contour, and noise parity remain unavailable.';
}

export function LayerFilterRow({
  canMoveDown,
  canMoveUp,
  disabled,
  filter,
  layerSize,
  onMoveDown,
  onMoveUp,
  onRemove,
  onUpdate,
}: {
  canMoveDown: boolean;
  canMoveUp: boolean;
  disabled?: boolean;
  filter: ImageLayerFilter;
  layerSize?: { width: number; height: number };
  onMoveDown: () => void;
  onMoveUp: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<ImageLayerFilter>) => void;
}) {
  const maskCoverage = filter.mask && filter.mask.alpha.length > 0
    ? Math.round((filter.mask.alpha.reduce((sum, value) => sum + value, 0) / filter.mask.alpha.length / 255) * 100)
    : 100;
  const updateMaskCoverage = (coverage: number) => {
    const base = filter.mask ?? createLayerFilterMask(layerSize?.width ?? 1, layerSize?.height ?? 1);
    onUpdate({ mask: setLayerFilterMaskCoverage(base, coverage / 100) });
  };
  return (
    <div className="rounded border border-cyan-300/10 bg-[#10131b] p-1.5">
      <div className="mb-1 flex items-center gap-1.5">
        <input
          checked={filter.enabled}
          disabled={disabled}
          onChange={(event) => onUpdate({ enabled: event.target.checked })}
          title="Enable filter"
          type="checkbox"
        />
        <span className="min-w-0 flex-1 truncate text-[11px] text-cyan-100/65" title={getLayerFilterParityTitle()}>
          {layerFilterLabel(filter.kind)}
        </span>
        <button
          aria-label="Move filter up"
          className="rounded p-0.5 text-cyan-100/35 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || !canMoveUp}
          onClick={onMoveUp}
          title="Move filter up"
          type="button"
        >
          <ArrowUp size={12} />
        </button>
        <button
          aria-label="Move filter down"
          className="rounded p-0.5 text-cyan-100/35 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || !canMoveDown}
          onClick={onMoveDown}
          title="Move filter down"
          type="button"
        >
          <ArrowDown size={12} />
        </button>
        <button
          className="rounded p-0.5 text-cyan-100/35 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled}
          onClick={onRemove}
          title="Remove filter"
          type="button"
        >
          <X size={12} />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-cyan-100/45">
        <span className="w-10 shrink-0">Mask</span>
        <input
          aria-label={`Mask coverage for ${layerFilterLabel(filter.kind)}`}
          className="min-w-0 flex-1 accent-cyan-400"
          disabled={disabled}
          max={100}
          min={0}
          onChange={(event) => updateMaskCoverage(Number(event.target.value))}
          type="range"
          value={maskCoverage}
        />
        <span className="w-7 text-right tabular-nums">{maskCoverage}%</span>
        <button
          aria-label={`Reset ${layerFilterLabel(filter.kind)} mask`}
          className="rounded border border-cyan-300/10 px-1 py-0.5 hover:bg-cyan-400/10 disabled:opacity-40"
          disabled={disabled}
          onClick={() => onUpdate({ mask: undefined })}
          type="button"
        >
          All
        </button>
      </div>
      <MiniEffectSlider
        disabled={disabled}
        label="Amount"
        inputAriaLabel="Filter amount"
        max={filter.kind === 'blur' || filter.kind === 'pixelate' ? 32 : 100}
        min={0}
        onChange={(amount) => onUpdate({ amount })}
        step={1}
        value={filter.amount}
        format={(value) => (filter.kind === 'blur' || filter.kind === 'pixelate' ? `${Math.round(value)}px` : `${Math.round(value)}%`)}
      />
      <select
        aria-label="Filter blend mode"
        className="mt-1 w-full rounded border border-cyan-300/10 bg-[#252630] px-1 py-0.5 text-[11px] text-cyan-100/70 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        onChange={(event) => onUpdate({ blendMode: event.target.value as BlendMode })}
        value={filter.blendMode ?? 'normal'}
      >
        {FILTER_BLEND_MODES.map((blendMode) => (
          <option key={blendMode} value={blendMode}>
            {blendMode}
          </option>
        ))}
      </select>
      <MiniEffectSlider
        disabled={disabled}
        label="Opacity"
        inputAriaLabel="Filter opacity"
        max={1}
        min={0}
        onChange={(opacity) => onUpdate({ opacity })}
        step={0.01}
        value={filter.opacity ?? 1}
        format={(value) => `${Math.round(value * 100)}%`}
      />
    </div>
  );
}

export function LayerEffectRow({
  disabled,
  effect,
  onRemove,
  onUpdate,
}: {
  disabled?: boolean;
  effect: ImageLayerEffect;
  onRemove: () => void;
  onUpdate: (patch: Partial<ImageLayerEffect>) => void;
}) {
  return (
    <div className="rounded border border-cyan-300/10 bg-[#10131b] p-1.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <input
          checked={effect.enabled}
          disabled={disabled}
          onChange={(event) => onUpdate({ enabled: event.target.checked })}
          title="Enable effect"
          type="checkbox"
        />
        <span className="min-w-0 flex-1 truncate text-[11px] text-cyan-100/65" title={getLayerEffectParityTitle()}>
          {layerEffectLabel(effect.kind)}
        </span>
        {'color' in effect ? (
          <AdvancedColorPicker
            className="h-5 w-7"
            buttonClassName="rounded border border-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={disabled}
            label="Effect color"
            onChange={(color) => onUpdate({ color } as Partial<ImageLayerEffect>)}
            title="Effect color"
            value={effect.color}
          />
        ) : null}
        {effect.kind === 'bevelEmboss' ? (
          <AdvancedColorPicker
            className="h-5 w-7"
            buttonClassName="rounded border border-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={disabled}
            label="Bevel highlight color"
            onChange={(highlightColor) => onUpdate({ highlightColor } as Partial<ImageLayerEffect>)}
            title="Bevel highlight color"
            value={effect.highlightColor}
          />
        ) : null}
        <button
          className="rounded p-0.5 text-cyan-100/35 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled}
          onClick={onRemove}
          title="Remove effect"
          type="button"
        >
          <X size={12} />
        </button>
      </div>
      <div className="space-y-1">
        {'opacity' in effect ? (
          <MiniEffectSlider
            disabled={disabled}
            label="Opacity"
            max={1}
            min={0}
            onChange={(opacity) => onUpdate({ opacity } as Partial<ImageLayerEffect>)}
            step={0.01}
            value={effect.opacity}
            format={(value) => `${Math.round(value * 100)}%`}
          />
        ) : null}
        {effect.kind === 'bevelEmboss' ? (
          <>
            <MiniEffectSlider
              disabled={disabled}
              label="Size"
              inputAriaLabel="Bevel size"
              max={64}
              min={1}
              onChange={(size) => onUpdate({ size } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.size}
              format={(value) => `${Math.round(value)}px`}
            />
            <MiniEffectSlider
              disabled={disabled}
              label="Angle"
              inputAriaLabel="Bevel light angle"
              max={180}
              min={-180}
              onChange={(angle) => onUpdate({ angle } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.angle}
              format={(value) => `${Math.round(value)}°`}
            />
            <div className="flex items-center justify-between gap-2 text-[11px] text-cyan-100/35">
              <span>Shadow</span>
              <AdvancedColorPicker
                className="h-5 w-7"
                buttonClassName="rounded border border-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={disabled}
                label="Bevel shadow color"
                onChange={(shadowColor) => onUpdate({ shadowColor } as Partial<ImageLayerEffect>)}
                title="Bevel shadow color"
                value={effect.shadowColor}
              />
            </div>
          </>
        ) : null}
        {effect.kind === 'stroke' ? (
          <>
            <MiniEffectSlider
              disabled={disabled}
              label="Size"
              max={64}
              min={1}
              onChange={(size) => onUpdate({ size } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.size}
              format={(value) => `${Math.round(value)}px`}
            />
            <select
              className="w-full rounded border border-cyan-300/10 bg-[#252630] px-1 py-0.5 text-[11px] text-cyan-100/70 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={disabled}
              onChange={(event) =>
                onUpdate({ position: event.target.value as 'outside' | 'inside' | 'center' } as Partial<ImageLayerEffect>)
              }
              value={effect.position}
            >
              <option value="outside">Outside</option>
              <option value="center">Center</option>
              <option value="inside">Inside</option>
            </select>
          </>
        ) : null}
        {effect.kind === 'dropShadow' || effect.kind === 'innerShadow' ? (
          <>
            <MiniEffectSlider
              disabled={disabled}
              label="Distance"
              inputAriaLabel={effect.kind === 'innerShadow' ? 'Inner shadow distance' : 'Drop shadow distance'}
              max={96}
              min={0}
              onChange={(distance) => onUpdate({ distance } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.distance}
              format={(value) => `${Math.round(value)}px`}
            />
            <MiniEffectSlider
              disabled={disabled}
              label="Size"
              inputAriaLabel={effect.kind === 'innerShadow' ? 'Inner shadow size' : 'Drop shadow size'}
              max={96}
              min={0}
              onChange={(size) => onUpdate({ size } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.size}
              format={(value) => `${Math.round(value)}px`}
            />
            <MiniEffectSlider
              disabled={disabled}
              label="Angle"
              inputAriaLabel={effect.kind === 'innerShadow' ? 'Inner shadow angle' : 'Drop shadow angle'}
              max={180}
              min={-180}
              onChange={(angle) => onUpdate({ angle } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.angle}
              format={(value) => `${Math.round(value)}°`}
            />
          </>
        ) : null}
        {effect.kind === 'satin' ? (
          <>
            <MiniEffectSlider
              disabled={disabled}
              label="Distance"
              inputAriaLabel="Satin distance"
              max={96}
              min={0}
              onChange={(distance) => onUpdate({ distance } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.distance}
              format={(value) => `${Math.round(value)}px`}
            />
            <MiniEffectSlider
              disabled={disabled}
              label="Size"
              inputAriaLabel="Satin size"
              max={96}
              min={1}
              onChange={(size) => onUpdate({ size } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.size}
              format={(value) => `${Math.round(value)}px`}
            />
            <MiniEffectSlider
              disabled={disabled}
              label="Angle"
              inputAriaLabel="Satin angle"
              max={180}
              min={-180}
              onChange={(angle) => onUpdate({ angle } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.angle}
              format={(value) => `${Math.round(value)}°`}
            />
            <label className="flex items-center gap-1.5 text-[11px] text-cyan-100/45">
              <input
                aria-label="Invert satin"
                checked={effect.invert}
                className="h-3.5 w-3.5 accent-cyan-400"
                disabled={disabled}
                onChange={(event) => onUpdate({ invert: event.target.checked } as Partial<ImageLayerEffect>)}
                type="checkbox"
              />
              Invert
            </label>
          </>
        ) : null}
        {effect.kind === 'outerGlow' ? (
          <MiniEffectSlider
            disabled={disabled}
            label="Size"
            max={96}
            min={1}
            onChange={(size) => onUpdate({ size } as Partial<ImageLayerEffect>)}
            step={1}
            value={effect.size}
            format={(value) => `${Math.round(value)}px`}
          />
        ) : null}
        {effect.kind === 'innerGlow' ? (
          <MiniEffectSlider
            disabled={disabled}
            label="Size"
            inputAriaLabel="Inner glow size"
            max={96}
            min={0}
            onChange={(size) => onUpdate({ size } as Partial<ImageLayerEffect>)}
            step={1}
            value={effect.size}
            format={(value) => `${Math.round(value)}px`}
          />
        ) : null}
        {effect.kind === 'patternOverlay' ? (
          <>
            <select
              aria-label="Pattern overlay pattern"
              className="w-full rounded border border-cyan-300/10 bg-[#252630] px-1 py-0.5 text-[11px] text-cyan-100/70 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={disabled}
              onChange={(event) =>
                onUpdate({ pattern: event.target.value as PatternOverlayPattern } as Partial<ImageLayerEffect>)
              }
              value={effect.pattern}
            >
              {PATTERN_OVERLAY_PATTERNS.map((pattern) => (
                <option key={pattern} value={pattern}>
                  {formatPatternOverlayLabel(pattern)}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-between gap-2 text-[11px] text-cyan-100/35">
              <span>Back</span>
              <AdvancedColorPicker
                className="h-5 w-7"
                buttonClassName="rounded border border-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={disabled}
                label="Pattern overlay background color"
                onChange={(backgroundColor) => onUpdate({ backgroundColor } as Partial<ImageLayerEffect>)}
                title="Pattern overlay background color"
                value={effect.backgroundColor}
              />
            </div>
            <MiniEffectSlider
              disabled={disabled}
              label="Scale"
              inputAriaLabel="Pattern overlay scale"
              max={64}
              min={1}
              onChange={(scale) => onUpdate({ scale } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.scale}
              format={(value) => `${Math.round(value)}px`}
            />
          </>
        ) : null}
        {effect.kind === 'gradientOverlay' ? (
          <>
            <div className="flex items-center justify-between gap-2 text-[11px] text-cyan-100/35">
              <span>End</span>
              <AdvancedColorPicker
                className="h-5 w-7"
                buttonClassName="rounded border border-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={disabled}
                label="Gradient overlay end color"
                onChange={(secondaryColor) => onUpdate({ secondaryColor } as Partial<ImageLayerEffect>)}
                title="Gradient overlay end color"
                value={effect.secondaryColor}
              />
            </div>
            <MiniEffectSlider
              disabled={disabled}
              label="Angle"
              inputAriaLabel="Gradient overlay angle"
              max={180}
              min={-180}
              onChange={(angle) => onUpdate({ angle } as Partial<ImageLayerEffect>)}
              step={1}
              value={effect.angle}
              format={(value) => `${Math.round(value)}°`}
            />
            <MiniEffectSlider
              disabled={disabled}
              label="Scale"
              inputAriaLabel="Gradient overlay scale"
              max={4}
              min={0.1}
              onChange={(scale) => onUpdate({ scale } as Partial<ImageLayerEffect>)}
              step={0.1}
              value={effect.scale}
              format={(value) => `${Math.round(value * 100)}%`}
            />
            <label className="flex items-center gap-1.5 text-[11px] text-cyan-100/45">
              <input
                aria-label="Reverse gradient overlay"
                checked={effect.reverse}
                className="h-3.5 w-3.5 accent-cyan-400"
                disabled={disabled}
                onChange={(event) => onUpdate({ reverse: event.target.checked } as Partial<ImageLayerEffect>)}
                type="checkbox"
              />
              Reverse
            </label>
          </>
        ) : null}
      </div>
    </div>
  );
}

function formatPatternOverlayLabel(pattern: PatternOverlayPattern): string {
  switch (pattern) {
    case 'checker':
      return 'Checker';
    case 'diagonal':
      return 'Diagonal';
    case 'dots':
      return 'Dots';
    case 'grid':
      return 'Grid';
  }
}

export function MiniEffectSlider({
  disabled,
  format,
  inputAriaLabel,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  disabled?: boolean;
  format: (value: number) => string;
  inputAriaLabel?: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <label className="w-12 text-cyan-100/35">{label}</label>
      <input
        aria-label={inputAriaLabel ?? label}
        className="min-w-0 flex-1 cursor-pointer accent-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
      <span className="w-9 text-right text-cyan-100/35">{format(value)}</span>
    </div>
  );
}
