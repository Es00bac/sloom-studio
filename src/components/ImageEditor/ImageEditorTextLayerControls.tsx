import { useState } from 'react';
import { AdjustmentSlider } from './ImageEditorAdjustmentControls';
import type { ImageLayer, TextLayerOpenTypeFeatures, TextLayerStyle } from '../../types/imageEditor';
import { AdvancedColorPicker } from '../Common/AdvancedColorPicker';
import { BundledFontBrowser } from '../Common/BundledFontBrowser';
import { createBundledFontFaceReference } from '../../lib/bundledFontLibrary';
import {
  buildImageTextExportSourceBinHandoffDescriptor,
  buildImageTextLayerDescriptor,
  describeImageTextFontCatalog,
  describeImageTextTypographyParityProgress,
  describeImageTextTypographySupportMatrix,
  IMAGE_TEXT_VISIBLE_OPENTYPE_FEATURES,
  normalizeImageTextOpenTypeFeatures,
  toggleImageTextOpenTypeFeature,
  type ImageTextTypographyParityProgressDescriptor,
  type ImageTextTypographySupportMatrixDescriptor,
} from './ImageTextLayer';
import {
  IMAGE_TEXT_PRESETS,
  IMAGE_TEXT_STYLE_PRESETS,
  applyImageTextStylePresetToStyle,
  type ImageTextPresetId,
} from './ImageTextPresets';

type TextFontStackPatch = Partial<Pick<TextLayerStyle, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'managedFace' | 'managedFaceIssue'>>;

export function TextFontStackControls({
  customAriaLabel,
  disabled,
  onChange,
  selectAriaLabel,
  style = 'normal',
  value,
  weight = 400,
}: {
  customAriaLabel: string;
  disabled?: boolean;
  onChange: (patch: TextFontStackPatch) => void;
  selectAriaLabel: string;
  style?: 'normal' | 'italic' | 'oblique';
  value: string;
  weight?: number | string;
}) {
  const catalog = describeImageTextFontCatalog(value);
  const selectedValue = catalog.selectedStack?.stack ?? '__custom__';
  const resolvedWeight = typeof weight === 'number' ? weight : Number.parseInt(weight, 10) || 400;

  return (
    <div className="mt-2 grid gap-1">
      <BundledFontBrowser
        disabled={disabled}
        onSelect={(family, face) => onChange({
          fontFamily: family.family,
          fontWeight: String(face.weight),
          fontStyle: face.style,
          managedFace: createBundledFontFaceReference(family, face),
          managedFaceIssue: undefined,
        })}
        style={style}
        value={value}
        weight={resolvedWeight}
      />
      <label className="block">
        <span className="mb-1 block text-cyan-100/40">Font Stack</span>
        <select
          aria-label={selectAriaLabel}
          className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value !== '__custom__') {
              onChange({ fontFamily: event.target.value, managedFace: undefined, managedFaceIssue: undefined });
            }
          }}
          value={selectedValue}
        >
          <option value="__custom__">Custom stack</option>
          {catalog.standardStacks.map((font) => (
            <option key={font.id} value={font.stack}>
              {font.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-cyan-100/40">Custom Font</span>
        <input
          aria-label={customAriaLabel}
          className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onChange={(event) => onChange({ fontFamily: event.target.value, managedFace: undefined, managedFaceIssue: undefined })}
          value={value}
        />
      </label>
    </div>
  );
}

export function TextOpenTypeFeatureControls({
  ariaLabelPrefix = '',
  disabled,
  onChange,
  value,
}: {
  ariaLabelPrefix?: string;
  disabled?: boolean;
  onChange: (features: TextLayerOpenTypeFeatures) => void;
  value?: Partial<TextLayerOpenTypeFeatures> | null;
}) {
  const features = normalizeImageTextOpenTypeFeatures(value);

  return (
    <div className="mt-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-cyan-100/35">OpenType</div>
      <div className="grid grid-cols-2 gap-1">
        {IMAGE_TEXT_VISIBLE_OPENTYPE_FEATURES.map((feature) => (
          <label
            className="flex items-center gap-1.5 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-1 text-[10px] text-cyan-100/65"
            key={feature.tag}
            title={feature.description}
          >
            <input
              aria-label={`${ariaLabelPrefix}OpenType ${feature.ariaLabel}`}
              checked={features.enabled.includes(feature.tag)}
              className="h-3 w-3 accent-cyan-300 disabled:cursor-not-allowed"
              disabled={disabled}
              onChange={(event) => onChange(toggleImageTextOpenTypeFeature(value, feature.tag, event.currentTarget.checked))}
              type="checkbox"
            />
            <span>{feature.label}</span>
          </label>
        ))}
      </div>
      {features.unsupported?.length ? (
        <p className="mt-1 text-[10px] text-amber-200/70">Ignored tags: {features.unsupported.join(', ')}</p>
      ) : null}
    </div>
  );
}

export function TypographyParityCheckSummary({
  progress,
}: {
  progress: ImageTextTypographyParityProgressDescriptor;
}) {
  return (
    <div className="mt-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/35">Typography parity checks</span>
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/30">{progress.status}</span>
      </div>
      <div className="grid gap-1">
        {progress.checks.map((check) => (
          <div className="grid grid-cols-[1fr_auto] gap-2 text-[10px] leading-4 text-cyan-100/50" key={check.id}>
            <span>{check.label}</span>
            <span className={check.status === 'blocked' ? 'text-amber-200/75' : check.status === 'limited' ? 'text-cyan-100/45' : 'text-emerald-200/70'}>
              {check.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TypographySupportMatrixSummary({
  matrix,
}: {
  matrix: ImageTextTypographySupportMatrixDescriptor;
}) {
  return (
    <div className="mt-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/35">Typography support matrix</span>
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/30">{matrix.summary.ready} ready</span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[10px] leading-4 text-cyan-100/50">
        <span>Limited {matrix.summary.limited}</span>
        <span>Unsupported capabilities {matrix.summary.unsupported}</span>
        <span>States {matrix.capabilities.length}</span>
      </div>
      <div className="mt-1 text-[10px] leading-4 text-amber-200/70">
        {matrix.unsupportedCapabilityIds.join(', ')}
      </div>
    </div>
  );
}

export function EditableTextLayerControls({
  disabled,
  layer,
  onAttachToPath,
  onChange,
  onClearTextPath,
  onApplyPreset,
  pathTargets = [],
}: {
  disabled?: boolean;
  layer: ImageLayer;
  onAttachToPath?: (pathLayerId: string, options: { startOffset: number; reverse: boolean }) => void;
  onChange: (patch: Partial<TextLayerStyle>) => void;
  onClearTextPath?: () => void;
  onApplyPreset?: (presetId: ImageTextPresetId) => void;
  pathTargets?: ImageLayer[];
}) {
  const text = layer.text;
  const descriptor = buildImageTextLayerDescriptor(layer);
  const handoffDescriptor = buildImageTextExportSourceBinHandoffDescriptor([layer]);
  const textOnPathHandoffCaveat = handoffDescriptor.caveats.find((caveat) => caveat.code === 'text-on-path-style-handoff');
  const parityProgress = describeImageTextTypographyParityProgress([layer]);
  const supportMatrix = describeImageTextTypographySupportMatrix([layer]);
  const [pathTargetId, setPathTargetId] = useState(text?.pathReference?.layerId ?? pathTargets[0]?.id ?? '');
  const [pathStartOffset, setPathStartOffset] = useState(text?.pathLayout?.startOffset ?? 0);
  const [pathReverse, setPathReverse] = useState(text?.pathLayout?.reverse ?? false);
  if (!text) {
    return (
      <div className="mt-2 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-[11px] text-cyan-100/35">
        This text layer has no retained text style metadata to edit.
      </div>
    );
  }

  return (
    <div className="mt-2 border-t border-cyan-300/10 pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-cyan-100/40">Text Layer</label>
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/30">Editable</span>
      </div>
      {descriptor ? (
        <div className="mb-2 rounded border border-cyan-300/10 bg-cyan-950/20 px-2 py-1.5 text-[10px] leading-4 text-cyan-100/45">
          <div className="font-semibold text-cyan-100/65">Retained live text</div>
          <div>
            On-canvas edit {descriptor.liveEditStatus.editable ? (descriptor.rasterizedPreview ? 'ready' : 'waiting for raster preview') : 'metadata only'}
          </div>
          <div>Canvas raster preview: {descriptor.rasterPreview.status === 'rasterized-from-retained-text' ? 'current' : 'missing'}</div>
          <div>Installed font fallback: {descriptor.fontDiscovery.preferredFamily}{descriptor.fontDiscovery.fallbackFamilies.length ? ` -> ${descriptor.fontDiscovery.fallbackFamilies.join(', ')}` : ' -> none declared'}</div>
          <div>
            OpenType intent: {descriptor.openTypeSupport.supportedTags.length
              ? descriptor.openTypeSupport.supportedTags.join(', ')
              : 'default features'}
          </div>
          <div>{descriptor.nativePsdTextRoundtrip.message}</div>
          {textOnPathHandoffCaveat ? (
            <div>{textOnPathHandoffCaveat.message}</div>
          ) : null}
        </div>
      ) : null}
      <TypographyParityCheckSummary progress={parityProgress} />
      <TypographySupportMatrixSummary matrix={supportMatrix} />
      {onApplyPreset ? (
        <div className="mb-2 space-y-2">
          <div className="grid grid-cols-2 gap-1">
            {IMAGE_TEXT_PRESETS.map((preset) => (
              <button
                className="rounded border border-cyan-300/10 px-1.5 py-1 text-left text-[10px] font-semibold text-cyan-100/60 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                disabled={disabled}
                key={preset.id}
                onClick={() => onApplyPreset(preset.id)}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-cyan-100/35">Type Styles</div>
            <div className="grid grid-cols-2 gap-1">
              {IMAGE_TEXT_STYLE_PRESETS.map((preset) => (
                <button
                  className="rounded border border-cyan-300/10 px-1.5 py-1 text-left text-[10px] font-semibold text-cyan-100/60 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={disabled}
                  key={preset.id}
                  onClick={() => onChange(applyImageTextStylePresetToStyle(text, preset.id))}
                  type="button"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <textarea
        className="mb-2 min-h-20 w-full resize-y rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        onChange={(event) => onChange({ content: event.target.value })}
        value={text.content}
      />
      <div className="grid grid-cols-2 gap-2">
        <AdjustmentSlider
          disabled={disabled}
          label="Size"
          max={180}
          min={6}
          onChange={(fontSize) => onChange({ fontSize })}
          step={1}
          value={text.fontSize}
        />
        <AdjustmentSlider
          disabled={disabled}
          label="Leading"
          max={2.5}
          min={0.8}
          onChange={(lineHeight) => onChange({ lineHeight })}
          step={0.05}
          value={text.lineHeight}
        />
        <AdjustmentSlider
          ariaLabel="Text tracking"
          disabled={disabled}
          label="Tracking"
          max={80}
          min={-20}
          onChange={(letterSpacing) => onChange({ letterSpacing })}
          step={1}
          value={text.letterSpacing}
        />
        <AdjustmentSlider
          ariaLabel="Text baseline shift"
          disabled={disabled}
          label="Baseline"
          max={128}
          min={-128}
          onChange={(baselineShift) => onChange({ baselineShift })}
          step={1}
          value={text.baselineShift}
        />
      </div>
      <TextFontStackControls
        customAriaLabel="Text custom font family"
        disabled={disabled}
        onChange={onChange}
        selectAriaLabel="Text font stack"
        style={text.fontStyle}
        value={text.fontFamily}
        weight={text.fontWeight}
      />
      {text.managedFaceIssue ? (
        <div className="mt-2 rounded border border-red-300/25 bg-red-500/10 px-2 py-1.5 text-[11px] leading-4 text-red-100">
          {text.managedFaceIssue.message}
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-cyan-100/40">Kerning</span>
          <select
            aria-label="Text kerning"
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onChange={(event) => onChange({ fontKerning: event.target.value as TextLayerStyle['fontKerning'] })}
            value={text.fontKerning}
          >
            <option value="auto">Auto</option>
            <option value="normal">Metrics</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-cyan-100/40">Caps</span>
          <select
            aria-label="Text caps"
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onChange={(event) => onChange({ fontVariantCaps: event.target.value as TextLayerStyle['fontVariantCaps'] })}
            value={text.fontVariantCaps}
          >
            <option value="normal">Normal</option>
            <option value="small-caps">Small Caps</option>
            <option value="all-small-caps">All Small Caps</option>
          </select>
        </label>
      </div>
      <TextOpenTypeFeatureControls
        disabled={disabled}
        onChange={(openTypeFeatures) => onChange({ openTypeFeatures })}
        value={text.openTypeFeatures}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-cyan-100/40">Orientation</span>
          <select
            aria-label="Text orientation"
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onChange={(event) => onChange({ orientation: event.target.value as TextLayerStyle['orientation'] })}
            value={text.orientation ?? 'horizontal'}
          >
            <option value="horizontal">Horizontal</option>
            <option value="vertical-rl">Vertical RL</option>
            <option value="vertical-lr">Vertical LR</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-cyan-100/40">Warp</span>
          <select
            aria-label="Text warp"
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            onChange={(event) => onChange({ warp: event.target.value as TextLayerStyle['warp'] })}
            value={text.warp}
          >
            <option value="none">None</option>
            <option value="arc">Arc</option>
            <option value="flag">Flag</option>
            <option value="bulge">Bulge</option>
          </select>
        </label>
      </div>
      {pathTargets.length > 0 || text.pathReference || text.pathLayout ? (
        <div className="mt-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wide text-cyan-100/35">Text Path</span>
            <span className="truncate text-[10px] text-cyan-100/35">
              {descriptor?.textOnPath.status === 'ready'
                ? descriptor.textOnPath.geometry === 'bezier-sampled-path'
                  ? 'Retained Bézier path'
                  : 'Retained straight path'
                : 'No path'}
            </span>
          </div>
          <label className="block">
            <span className="mb-1 block text-cyan-100/40">Target</span>
            <select
              aria-label="Text path target"
              className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || pathTargets.length === 0}
              onChange={(event) => setPathTargetId(event.target.value)}
              value={pathTargetId}
            >
              {pathTargets.length === 0 ? <option value="">No path layers</option> : null}
              {pathTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
            <label className="block">
              <span className="mb-1 block text-cyan-100/40">Offset</span>
              <input
                aria-label="Text path start offset"
                className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                min={0}
                onChange={(event) => setPathStartOffset(Number.parseFloat(event.target.value) || 0)}
                step={1}
                type="number"
                value={pathStartOffset}
              />
            </label>
            <label className="mt-5 flex items-center gap-1.5 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[10px] text-cyan-100/65">
              <input
                aria-label="Reverse text path"
                checked={pathReverse}
                className="h-3 w-3 accent-cyan-300"
                disabled={disabled}
                onChange={(event) => setPathReverse(event.currentTarget.checked)}
                type="checkbox"
              />
              Reverse
            </label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button
              className="rounded border border-cyan-300/10 px-1.5 py-1 text-left text-[10px] font-semibold text-cyan-100/60 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={disabled || !onAttachToPath || !pathTargetId}
              onClick={() => onAttachToPath?.(pathTargetId, { startOffset: pathStartOffset, reverse: pathReverse })}
              type="button"
            >
              Attach
            </button>
            <button
              className="rounded border border-cyan-300/10 px-1.5 py-1 text-left text-[10px] font-semibold text-cyan-100/60 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={disabled || !onClearTextPath}
              onClick={() => onClearTextPath?.()}
              type="button"
            >
              Clear
            </button>
          </div>
          {descriptor?.textOnPath.status === 'ready' ? (
            <p className="mt-1 text-[10px] text-amber-200/70">PSD editable text-on-path export is not supported yet.</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <label className="w-12 text-cyan-100/40">Color</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          label="Text layer color"
          onChange={(color) => onChange({ color })}
          value={text.color}
        />
        <input
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onChange={(event) => onChange({ color: event.target.value })}
          type="text"
          value={text.color}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {(['left', 'center', 'right'] as const).map((align) => (
          <button
            className={`rounded border px-2 py-1 text-[11px] font-semibold capitalize disabled:cursor-not-allowed disabled:opacity-40 ${
              text.align === align
                ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100'
                : 'border-cyan-300/10 bg-[#252630] text-cyan-100/55 hover:border-cyan-300/30'
            }`}
            disabled={disabled}
            key={align}
            onClick={() => onChange({ align })}
            type="button"
          >
            {align}
          </button>
        ))}
      </div>
    </div>
  );
}
