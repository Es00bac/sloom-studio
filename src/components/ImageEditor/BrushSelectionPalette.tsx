import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, Sparkles } from 'lucide-react';
import { useSettingsStore } from '../../store/settingsStore';
import { useImageEditorStore } from '../../store/imageEditorStore';
import {
  BRUSH_PRESET_GROUPS,
  IMAGE_BRUSH_PRESETS,
  applyBrushPreset,
  describeImageBrushPreset,
  exportUserBrushPresetPack,
  importUserBrushPresetPack,
  type ImageBrushPreset,
  type ImageBrushPresetGroup,
} from './ImageBrushPresets';
import { normalizeBrushSettings } from './ImageBrushEngine';
import { resolveActiveBrushState } from './brushActiveState';
import {
  applyTiltmarkBrushPreset,
  describeTiltmarkTip,
  getTiltmarkBrushPreset,
  TILTMARK_BRUSH_CATEGORIES,
  TILTMARK_BRUSH_PRESETS,
} from './tiltmark/TiltmarkCatalog';
import { TiltmarkEngineSelector } from './tiltmark/TiltmarkEngineUI';
import type { TiltmarkBrushPreset } from './tiltmark/TiltmarkTypes';

export function BrushSelectionPalette() {
  const settings = normalizeBrushSettings(useImageEditorStore((s) => s.brushSettings));
  const set = useImageEditorStore((s) => s.setBrushSettings);
  const customBrushPresets = useSettingsStore((s) => s.customBrushPresets);
  const saveCustomBrushPreset = useSettingsStore((s) => s.saveCustomBrushPreset);
  const renameCustomBrushPreset = useSettingsStore((s) => s.renameCustomBrushPreset);
  const deleteCustomBrushPreset = useSettingsStore((s) => s.deleteCustomBrushPreset);
  const setCustomBrushPresets = useSettingsStore((s) => s.setCustomBrushPresets);

  const activeBrush = resolveActiveBrushState(settings, [...IMAGE_BRUSH_PRESETS, ...customBrushPresets]);
  const groupedPresets = useMemo(() => BRUSH_PRESET_GROUPS.map((group) => ({
    group,
    presets: IMAGE_BRUSH_PRESETS.filter((preset) => preset.group === group),
  })).filter((entry) => entry.presets.length > 0), []);
  const activeBuiltInGroup = IMAGE_BRUSH_PRESETS.find((preset) => preset.id === activeBrush.activePresetId)?.group;

  const [presetName, setPresetName] = useState('');
  const [renamePresetId, setRenamePresetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [presetPackJson, setPresetPackJson] = useState('');
  const [presetPackError, setPresetPackError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<ImageBrushPresetGroup>>(
    () => new Set([activeBuiltInGroup ?? BRUSH_PRESET_GROUPS[0]]),
  );

  const applyPreset = (preset: ImageBrushPreset) => {
    setExpandedGroups((current) => current.has(preset.group) ? current : new Set([...current, preset.group]));
    set(applyBrushPreset(settings, preset));
  };

  const savePreset = () => {
    saveCustomBrushPreset(presetName, settings);
    setPresetName('');
    setPresetPackError('');
  };

  const exportPresets = () => {
    setPresetPackJson(exportUserBrushPresetPack(customBrushPresets));
    setPresetPackError('');
  };

  const importPresets = () => {
    try {
      const imported = importUserBrushPresetPack(
        presetPackJson,
        [...IMAGE_BRUSH_PRESETS, ...customBrushPresets].map((preset) => preset.id),
      );
      setCustomBrushPresets([
        ...customBrushPresets,
        ...imported,
      ]);
      setPresetPackError('');
    } catch {
      setPresetPackError('Invalid preset pack JSON.');
    }
  };

  const beginRename = (preset: ImageBrushPreset) => {
    setRenamePresetId(preset.id);
    setRenameValue(preset.label);
  };

  const commitRename = () => {
    if (!renamePresetId) return;
    renameCustomBrushPreset(renamePresetId, renameValue);
    setRenamePresetId(null);
    setRenameValue('');
  };

  const isActive = (preset: ImageBrushPreset) => activeBrush.activePresetId === preset.id;
  const toggleGroup = (group: ImageBrushPresetGroup) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  if (settings.brushEngine === 'tiltmark') {
    return <TiltmarkBrushPalette />;
  }

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <TiltmarkEngineSelector />
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-cyan-50/80">Brush Library</div>
            <div className="text-[10px] text-cyan-100/35">
              {IMAGE_BRUSH_PRESETS.length} brushes · {groupedPresets.length} collapsible sets
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              className="rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-1 text-[10px] text-cyan-100/55 hover:border-cyan-400/40 hover:text-white"
              onClick={() => setExpandedGroups(new Set())}
              type="button"
            >
              Collapse
            </button>
            <button
              className="rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-1 text-[10px] text-cyan-100/55 hover:border-cyan-400/40 hover:text-white"
              onClick={() => setExpandedGroups(new Set(groupedPresets.map((entry) => entry.group)))}
              type="button"
            >
              Expand
            </button>
          </div>
        </div>
        {groupedPresets.map((group) => (
          <div className="mb-1 overflow-hidden rounded border border-cyan-300/10 bg-[#151822]" data-brush-preset-group={group.group} key={group.group}>
            <button
              aria-controls={`brush-preset-group-${group.group.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
              aria-expanded={expandedGroups.has(group.group)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.11em] text-cyan-100/55 hover:bg-cyan-400/5 hover:text-cyan-50"
              onClick={() => toggleGroup(group.group)}
              type="button"
            >
              {expandedGroups.has(group.group) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span className="min-w-0 flex-1 truncate">{group.group}</span>
              <span className="rounded bg-cyan-100/5 px-1.5 py-0.5 text-[9px] tabular-nums text-cyan-100/35">{group.presets.length}</span>
            </button>
            {expandedGroups.has(group.group) ? (
              <div className="grid grid-cols-2 gap-1 border-t border-cyan-300/10 p-1" id={`brush-preset-group-${group.group.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>
                {group.presets.map((preset) => (
                  <PresetTile
                    active={isActive(preset)}
                    modified={isActive(preset) && activeBrush.modified}
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    preset={preset}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">My Presets</div>
        <div className="mb-2 flex gap-2">
          <input
            aria-label="Brush preset name"
            className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/80"
            onChange={(event) => setPresetName(event.target.value)}
            placeholder="Preset name"
            type="text"
            value={presetName}
          />
          <button
            className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] text-cyan-100/80 hover:border-cyan-400/40 hover:text-white"
            onClick={savePreset}
            type="button"
          >
            Save Preset
          </button>
        </div>
        {customBrushPresets.length > 0 ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1">
              {customBrushPresets.map((preset) => (
                <div className="rounded border border-cyan-300/10 bg-[#171922] p-1" key={preset.id}>
                  <PresetTile
                    active={isActive(preset)}
                    modified={isActive(preset) && activeBrush.modified}
                    onClick={() => applyPreset(preset)}
                    preset={preset}
                  />
                  {renamePresetId === preset.id ? (
                    <div className="mt-1 space-y-1">
                      <input
                        aria-label={`Rename ${preset.label}`}
                        className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] text-cyan-100/80"
                        onChange={(event) => setRenameValue(event.target.value)}
                        type="text"
                        value={renameValue}
                      />
                      <div className="flex gap-1">
                        <button
                          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] text-cyan-100/80 hover:border-cyan-400/40 hover:text-white"
                          onClick={commitRename}
                          type="button"
                        >
                          Apply Name
                        </button>
                        <button
                          className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] text-cyan-100/60 hover:border-cyan-400/40 hover:text-white"
                          onClick={() => {
                            setRenamePresetId(null);
                            setRenameValue('');
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex gap-1">
                      <button
                        aria-label={`Rename ${preset.label}`}
                        className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] text-cyan-100/60 hover:border-cyan-400/40 hover:text-white"
                        onClick={() => beginRename(preset)}
                        type="button"
                      >
                        Rename
                      </button>
                      <button
                        aria-label={`Delete ${preset.label}`}
                        className="rounded border border-red-400/15 bg-[#252630] px-2 py-1 text-[11px] text-red-100/70 hover:border-red-400/40 hover:text-red-50"
                        onClick={() => deleteCustomBrushPreset(preset.id)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-cyan-100/40">Saved custom presets appear here.</p>
        )}
        <div className="mt-2 space-y-1">
          <label className="block text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Brush preset pack JSON</label>
          <textarea
            aria-label="Brush preset pack JSON"
            className="min-h-24 w-full rounded border border-cyan-300/10 bg-[#0e1017] px-2 py-1.5 text-[11px] text-cyan-100/70"
            onChange={(event) => setPresetPackJson(event.target.value)}
            spellCheck={false}
            value={presetPackJson}
          />
          <div className="flex gap-1">
            <button
              className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] text-cyan-100/80 hover:border-cyan-400/40 hover:text-white"
              onClick={exportPresets}
              type="button"
            >
              Export Presets
            </button>
            <button
              className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] text-cyan-100/80 hover:border-cyan-400/40 hover:text-white"
              onClick={importPresets}
              type="button"
            >
              Import Presets
            </button>
          </div>
          {presetPackError ? <p className="text-[11px] text-red-100/75">{presetPackError}</p> : null}
        </div>
      </div>
    </div>
  );
}

function TiltmarkBrushPalette() {
  const settings = normalizeBrushSettings(useImageEditorStore((state) => state.brushSettings));
  const set = useImageEditorStore((state) => state.setBrushSettings);
  const activePreset = getTiltmarkBrushPreset(settings.tiltmarkPresetId);
  const [query, setQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set([activePreset.category]),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const grouped = useMemo(() => TILTMARK_BRUSH_CATEGORIES
    .map((category) => ({
      category,
      presets: TILTMARK_BRUSH_PRESETS.filter((preset) => (
        preset.category === category
        && (
          !normalizedQuery
          || preset.name.toLocaleLowerCase().includes(normalizedQuery)
          || preset.description.toLocaleLowerCase().includes(normalizedQuery)
          || preset.medium.toLocaleLowerCase().includes(normalizedQuery)
          || preset.tip.kind.toLocaleLowerCase().includes(normalizedQuery)
        )
      )),
    }))
    .filter((entry) => entry.presets.length > 0), [normalizedQuery]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const applyPreset = (preset: TiltmarkBrushPreset) => {
    setExpandedCategories((current) => (
      current.has(preset.category)
        ? current
        : new Set([...current, preset.category])
    ));
    set(applyTiltmarkBrushPreset(settings, preset));
  };

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <TiltmarkEngineSelector />
      <div className="rounded border border-amber-300/15 bg-amber-300/5 p-2">
        <div className="flex items-center gap-1.5 font-semibold text-amber-50">
          <Sparkles size={13} />
          Tiltmark Brush Library
        </div>
        <div className="mt-0.5 text-[10px] text-amber-100/45">
          {TILTMARK_BRUSH_PRESETS.length} Hane presets · Rust-authored physical contacts
        </div>
      </div>
      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-cyan-100/30"
          size={12}
        />
        <input
          aria-label="Search Tiltmark brushes"
          className="w-full rounded border border-cyan-300/10 bg-[#171922] py-1.5 pl-7 pr-2 text-[11px] text-cyan-50 placeholder:text-cyan-100/25"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search medium, tip, or brush…"
          type="search"
          value={query}
        />
      </label>
      <div>
        <div className="mb-1 flex justify-end gap-1">
          <button
            className="rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-1 text-[10px] text-cyan-100/55 hover:border-cyan-400/40 hover:text-white"
            onClick={() => setExpandedCategories(new Set())}
            type="button"
          >
            Collapse
          </button>
          <button
            className="rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-1 text-[10px] text-cyan-100/55 hover:border-cyan-400/40 hover:text-white"
            onClick={() => setExpandedCategories(new Set(grouped.map((entry) => entry.category)))}
            type="button"
          >
            Expand
          </button>
        </div>
        {grouped.map(({ category, presets }) => {
          const expanded = normalizedQuery.length > 0 || expandedCategories.has(category);
          const controlId = `tiltmark-category-${category.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
          return (
            <div
              className="mb-1 overflow-hidden rounded border border-amber-300/10 bg-[#151822]"
              data-tiltmark-category={category}
              key={category}
            >
              <button
                aria-controls={controlId}
                aria-expanded={expanded}
                className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.11em] text-amber-100/55 hover:bg-amber-300/5 hover:text-amber-50"
                onClick={() => toggleCategory(category)}
                type="button"
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="min-w-0 flex-1 truncate">{category}</span>
                <span className="rounded bg-amber-100/5 px-1.5 py-0.5 text-[9px] tabular-nums text-amber-100/35">
                  {presets.length}
                </span>
              </button>
              {expanded ? (
                <div className="grid grid-cols-2 gap-1 border-t border-amber-300/10 p-1" id={controlId}>
                  {presets.map((preset) => (
                    <TiltmarkPresetTile
                      active={preset.id === activePreset.id}
                      key={preset.id}
                      onClick={() => applyPreset(preset)}
                      preset={preset}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {grouped.length === 0 ? (
          <p className="rounded border border-cyan-300/10 bg-[#151822] p-3 text-center text-[11px] text-cyan-100/35">
            No Tiltmark brushes match “{query}”.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TiltmarkPresetTile({
  active,
  onClick,
  preset,
}: {
  active: boolean;
  onClick: () => void;
  preset: TiltmarkBrushPreset;
}) {
  const aspect = Math.max(0.12, Math.min(1, preset.tip.aspect ?? 1));
  return (
    <button
      className={`rounded border p-1.5 text-left text-[10px] transition-colors ${
        active
          ? 'border-amber-300/60 bg-amber-300/15 text-amber-50'
          : 'border-amber-300/10 bg-[#252630] text-amber-100/65 hover:border-amber-300/35 hover:text-white'
      }`}
      onClick={onClick}
      title={`${preset.name} — ${preset.description}`}
      type="button"
    >
      <span className="mb-1 flex h-7 items-center justify-center overflow-hidden rounded bg-[#10131b]">
        <span
          className={`block bg-current opacity-75 ${
            preset.tip.kind === 'graphite'
              ? 'h-3 w-6 [clip-path:polygon(100%_50%,0_0,15%_50%,0_100%)]'
              : preset.tip.kind === 'chisel'
                ? 'h-3 w-8 rounded-sm'
                : preset.tip.kind === 'bristle'
                  ? 'h-5 w-8 border-b-4 border-current bg-transparent opacity-70'
                  : preset.tip.kind === 'particle'
                    ? 'h-5 w-8 bg-[radial-gradient(circle,currentColor_1px,transparent_1.5px)] [background-size:6px_6px]'
                    : preset.tip.kind === 'ribbon'
                      ? 'h-2 w-9 rounded-full'
                      : 'h-4 w-4 rounded-full'
          }`}
          style={preset.tip.kind === 'chisel' ? {
            transform: `scaleY(${aspect}) rotate(${preset.tip.authoredAngleRad ?? 0}rad)`,
          } : undefined}
        />
      </span>
      <span className="block truncate font-medium">{preset.name}</span>
      <span className="mt-0.5 block truncate text-[9px] opacity-45">
        {preset.medium} · {describeTiltmarkTip(preset)}
      </span>
    </button>
  );
}

function PresetTile({
  active,
  modified,
  onClick,
  preset,
}: {
  active: boolean;
  modified?: boolean;
  onClick: () => void;
  preset: ImageBrushPreset;
}) {
  const settings = normalizeBrushSettings(preset.settings);
  const descriptor = describeImageBrushPreset(preset, preset.group === 'User' ? 'user' : 'built-in');
  const fill = preset.settings.color ?? '#9be7ff';

  // Reflect the brush's character in the thumbnail: a soft edge (low hardness) blurs the stroke,
  // and texture depth breaks it into a granular, patchy trail (pencil/charcoal/dry brush/screentone).
  const soft = Math.max(0, 1 - settings.hardness);
  const grain = Math.max(0, Math.min(1, settings.textureDepth ?? 0));

  const previewSize = Math.max(1, Math.min(14, settings.size / 4));
  const step = Math.max(1, previewSize * Math.max(0.01, settings.spacing));
  const curveLength = 64;
  const numSteps = Math.min(80, Math.max(3, Math.floor(curveLength / step)));

  return (
    <button
      className={`rounded border px-1.5 py-1 text-left text-[11px] hover:border-cyan-400/40 hover:text-white ${
        active
          ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-50'
          : 'border-cyan-300/10 bg-[#252630] text-cyan-100/65'
      }`}
      onClick={onClick}
      title={preset.label}
      type="button"
    >
      <svg
        className="mb-1 block h-6 w-full rounded bg-[#10131b]"
        data-brush-preset-preview={preset.id}
        data-brush-preset-preview-signature={descriptor.preview.signature}
        role="img"
        viewBox="0 0 72 18"
      >
        <defs>
          {soft > 0.25 ? (
            <filter height="200%" id={`brush-soft-${preset.id}`} width="160%" x="-30%" y="-50%">
              <feGaussianBlur stdDeviation={0.35 + soft * 1.7} />
            </filter>
          ) : null}
        </defs>
        <rect fill="#10131b" height="18" rx="3" width="72" x="0" y="0" />
        <g filter={soft > 0.25 ? `url(#brush-soft-${preset.id})` : undefined}>
          {Array.from({ length: numSteps }, (_, index) => {
            const t = numSteps > 1 ? index / (numSteps - 1) : 0.5;
            const u = 1 - t;

            // Bezier curve P0(6, 12), P1(26, 2), P2(46, 16), P3(66, 6)
            const x = u*u*u*6 + 3*u*u*t*26 + 3*u*t*t*46 + t*t*t*66;
            let y = u*u*u*12 + 3*u*u*t*2 + 3*u*t*t*16 + t*t*t*6;

            const hash = Math.sin(index * 12.9898) * 43758.5453;
            const rand = hash - Math.floor(hash);
            y += (rand - 0.5) * 2 * settings.scatter * 8;

            const pressure = Math.sin(t * Math.PI); // 0 at ends, 1 in middle
            const sizeMod = 1 - (settings.pressureSize || 0) * (1 - pressure);
            const opacityMod = 1 - (settings.pressureOpacity || 0) * (1 - Math.pow(pressure, 0.5));

            // Texture grain: jitter each dab's opacity + size so a textured brush reads as granular
            // (paper tooth / dots / spatter) instead of a smooth ribbon.
            const grainHash = Math.sin(index * 78.233 + 1.7) * 43758.5453;
            const grainRand = grainHash - Math.floor(grainHash);
            const grainOpacity = 1 - grain * (0.35 + 0.65 * grainRand);
            const sizeJitter = 1 - grain * 0.4 * grainRand;

            const currentSize = Math.max(0.4, previewSize * sizeMod * sizeJitter);
            const currentOpacity = Math.max(0, Math.min(1, settings.opacity * settings.flow * opacityMod * grainOpacity));
            const stretchY = Math.max(0.1, settings.roundness);
            const rx = Math.max(0.5, currentSize * 0.55 * (settings.tipShape === 'square' ? 1.15 : 1));
            const ry = Math.max(0.5, currentSize * stretchY);

            return (
              <ellipse
                cx={x}
                cy={y}
                fill={fill}
                fillOpacity={currentOpacity}
                key={`${preset.id}-${index}`}
                rx={rx}
                ry={ry}
                transform={`rotate(${settings.angleDeg} ${x} ${y})`}
              />
            );
          })}
        </g>
      </svg>
      <span className="block truncate">
        {preset.label}
        {modified ? <span className="ml-1 rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">modified</span> : null}
      </span>
    </button>
  );
}
