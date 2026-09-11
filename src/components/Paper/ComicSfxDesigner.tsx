import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Save, Sparkles, Trash2, X } from 'lucide-react';
import { AdvancedColorPicker } from '../Common/AdvancedColorPicker';
import {
  buildPaperComicSfxFrames,
  createPaperComicSfxDesign,
  getPaperComicSfxPreset,
  normalizePaperComicSfxDesign,
  PAPER_COMIC_SFX_PRESET_IDS,
  type PaperComicSfxDesign,
  type PaperComicSfxFrameDraft,
  type PaperComicSfxPresetId,
} from '../../lib/paperComicSfx';
import { useComicSfxDesignerStore } from '../../store/comicSfxDesignerStore';

interface ComicSfxDesignerProps {
  initialDesign?: PaperComicSfxDesign;
  initialPresetId: PaperComicSfxPresetId;
  onClose: () => void;
  onPlace: (design: PaperComicSfxDesign) => void;
  placeLabel?: string;
}

const PREVIEW_WIDTH = 420;
const PREVIEW_HEIGHT = 260;

export function ComicSfxDesigner({
  initialDesign,
  initialPresetId,
  onClose,
  onPlace,
  placeLabel = 'Place on Page',
}: ComicSfxDesignerProps) {
  const lastDesign = useComicSfxDesignerStore((state) => state.lastDesign);
  const savedStyles = useComicSfxDesignerStore((state) => state.savedStyles);
  const setLastDesign = useComicSfxDesignerStore((state) => state.setLastDesign);
  const saveStyle = useComicSfxDesignerStore((state) => state.saveStyle);
  const deleteStyle = useComicSfxDesignerStore((state) => state.deleteStyle);
  const [design, setDesign] = useState(() =>
    initialDesign
      ? normalizePaperComicSfxDesign(initialDesign)
      : lastDesign.presetId === initialPresetId
      ? lastDesign
      : createPaperComicSfxDesign(initialPresetId, { text: lastDesign.text || getPaperComicSfxPreset(initialPresetId).text }),
  );
  const [styleName, setStyleName] = useState('');

  const normalizedDesign = useMemo(() => normalizePaperComicSfxDesign(design), [design]);
  const previewFrames = useMemo(
    () => buildPaperComicSfxFrames({
      presetId: normalizedDesign.presetId,
      design: normalizedDesign,
      idPrefix: 'preview-sfx',
      origin: { xMm: 24, yMm: 28 },
    }).frames,
    [normalizedDesign],
  );
  const previewLayout = useMemo(() => computePreviewLayout(previewFrames), [previewFrames]);

  const patchDesign = (patch: Partial<PaperComicSfxDesign>) => {
    setDesign((current) => normalizePaperComicSfxDesign({ ...current, ...patch }));
  };

  const applyPreset = (presetId: PaperComicSfxPresetId) => {
    setDesign((current) => createPaperComicSfxDesign(presetId, { text: current.text }));
  };

  const handlePlace = () => {
    setLastDesign(normalizedDesign);
    onPlace(normalizedDesign);
  };

  const handleSaveStyle = () => {
    const id = saveStyle(styleName || `${normalizedDesign.text} SFX`, normalizedDesign);
    setStyleName('');
    setDesign((current) => ({ ...current }));
    return id;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-md border border-amber-300/25 bg-[#0b121d] text-cyan-50 shadow-2xl">
        <div className="flex items-center justify-between border-b border-cyan-300/15 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-amber-100">
              <Sparkles size={16} />
              Comic SFX Designer
            </div>
            <div className="mt-1 text-xs text-cyan-100/60">Preview, customize, save, and place comic onomatopoeia lettering.</div>
          </div>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md border border-cyan-300/20 bg-slate-950/70 text-cyan-100 hover:border-cyan-200 hover:text-white"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_28rem]">
          <section className="flex min-h-0 flex-col gap-4">
            <div className="rounded-md border border-cyan-300/15 bg-slate-950/55 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/65">Preview</div>
              <div className="flex justify-center overflow-hidden rounded-md border border-amber-300/20 bg-[#fff7dd] p-3">
                <div
                  className="relative overflow-hidden rounded bg-white shadow-inner"
                  style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
                >
                  {previewFrames.map((frame) => (
                    <PreviewFrame frame={frame} key={frame.id} layout={previewLayout} />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Panel title="Text">
                <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/65">Lettering</label>
                <input
                  className="mt-1 w-full rounded-md border border-cyan-300/20 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300"
                  onChange={(event) => patchDesign({ text: event.target.value })}
                  value={design.text}
                />
                <label className="mt-3 block text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-100/65">Font family</label>
                <input
                  className="mt-1 w-full rounded-md border border-cyan-300/20 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300"
                  onChange={(event) => patchDesign({ fontFamily: event.target.value })}
                  value={design.fontFamily}
                />
                <Slider label="Font size" max={96} min={12} onChange={(fontSizePt) => patchDesign({ fontSizePt })} step={1} suffix="pt" value={design.fontSizePt} />
                <Slider label="Tracking" max={8} min={-2} onChange={(tracking) => patchDesign({ tracking })} step={0.1} value={design.tracking} />
              </Panel>

              <Panel title="Paint">
                <ColorField label="Fill" onChange={(fillColor) => patchDesign({ fillColor })} value={design.fillColor} />
                <ColorField label="Stroke" onChange={(strokeColor) => patchDesign({ strokeColor })} value={design.strokeColor} />
                <Slider label="Stroke width" max={4} min={0} onChange={(strokeWidthMm) => patchDesign({ strokeWidthMm })} step={0.05} suffix="mm" value={design.strokeWidthMm} />
                <ColorField label="Shadow" onChange={(shadowColor) => patchDesign({ shadowColor })} value={design.shadowColor} />
                <Slider label="Shadow blur" max={6} min={0} onChange={(shadowBlurMm) => patchDesign({ shadowBlurMm })} step={0.05} suffix="mm" value={design.shadowBlurMm} />
              </Panel>

              <Panel title="Warp">
                <Slider label="Rotation" max={45} min={-45} onChange={(rotationDeg) => patchDesign({ rotationDeg })} step={1} suffix="deg" value={design.rotationDeg} />
                <Slider label="Skew X" max={35} min={-35} onChange={(skewXDeg) => patchDesign({ skewXDeg })} step={1} suffix="deg" value={design.skewXDeg} />
                <Slider label="Skew Y" max={25} min={-25} onChange={(skewYDeg) => patchDesign({ skewYDeg })} step={1} suffix="deg" value={design.skewYDeg} />
                <Slider label="Scale X" max={3} min={0.4} onChange={(scaleX) => patchDesign({ scaleX })} step={0.01} value={design.scaleX} />
                <Slider label="Scale Y" max={3} min={0.4} onChange={(scaleY) => patchDesign({ scaleY })} step={0.01} value={design.scaleY} />
              </Panel>

              <Panel title="Trail">
                <Slider label="Echo copies" max={12} min={0} onChange={(trailingCopiesCount) => patchDesign({ trailingCopiesCount })} step={1} value={design.trailingCopiesCount} />
                <Slider label="Trail X" max={12} min={-12} onChange={(trailOffsetXMm) => patchDesign({ trailOffsetXMm })} step={0.1} suffix="mm" value={design.trailOffsetXMm} />
                <Slider label="Trail Y" max={12} min={-12} onChange={(trailOffsetYMm) => patchDesign({ trailOffsetYMm })} step={0.1} suffix="mm" value={design.trailOffsetYMm} />
                <Slider label="Trail scale" max={0.18} min={0} onChange={(trailScaleStep) => patchDesign({ trailScaleStep })} step={0.005} value={design.trailScaleStep} />
                <Slider label="Fade step" max={0.5} min={0} onChange={(trailOpacityStep) => patchDesign({ trailOpacityStep })} step={0.01} value={design.trailOpacityStep} />
              </Panel>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-3">
            <Panel title="Presets">
              <div className="grid grid-cols-2 gap-2">
                {PAPER_COMIC_SFX_PRESET_IDS.map((presetId) => {
                  const preset = getPaperComicSfxPreset(presetId);
                  return (
                    <button
                      className={`rounded-md border px-3 py-2 text-left text-xs font-black uppercase tracking-[0.08em] ${
                        design.presetId === presetId
                          ? 'border-amber-300/70 bg-amber-300/20 text-amber-50'
                          : 'border-cyan-300/15 bg-slate-950/70 text-cyan-100/75 hover:border-cyan-300/40 hover:text-white'
                      }`}
                      key={presetId}
                      onClick={() => applyPreset(presetId)}
                      type="button"
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Comic Effects">
              <Toggle
                checked={design.burstEnabled}
                label="Burst backing"
                onChange={(burstEnabled) => patchDesign({ burstEnabled })}
              />
              <ColorField label="Burst fill" onChange={(burstFillColor) => patchDesign({ burstFillColor })} value={design.burstFillColor} />
              <ColorField label="Burst stroke" onChange={(burstStrokeColor) => patchDesign({ burstStrokeColor })} value={design.burstStrokeColor} />
              <Slider label="Burst stroke width" max={2.5} min={0} onChange={(burstStrokeWidthMm) => patchDesign({ burstStrokeWidthMm })} step={0.05} suffix="mm" value={design.burstStrokeWidthMm} />
              <Slider label="Burst points" max={32} min={4} onChange={(burstPoints) => patchDesign({ burstPoints })} step={1} value={design.burstPoints} />

              <Toggle
                checked={design.speedLinesEnabled}
                label="Speed lines"
                onChange={(speedLinesEnabled) => patchDesign({ speedLinesEnabled })}
              />
              <ColorField label="Line color" onChange={(speedLineColor) => patchDesign({ speedLineColor })} value={design.speedLineColor} />
              <Slider label="Line count" max={16} min={1} onChange={(speedLineCount) => patchDesign({ speedLineCount })} step={1} value={design.speedLineCount} />
              <Slider label="Line width" max={2} min={0.05} onChange={(speedLineStrokeWidthMm) => patchDesign({ speedLineStrokeWidthMm })} step={0.05} suffix="mm" value={design.speedLineStrokeWidthMm} />
              <Slider label="Line length" max={80} min={6} onChange={(speedLineLengthMm) => patchDesign({ speedLineLengthMm })} step={1} suffix="mm" value={design.speedLineLengthMm} />
              <Slider label="Line spacing" max={12} min={1} onChange={(speedLineSpacingMm) => patchDesign({ speedLineSpacingMm })} step={0.1} suffix="mm" value={design.speedLineSpacingMm} />
              <Slider label="Line angle" max={45} min={-45} onChange={(speedLineAngleDeg) => patchDesign({ speedLineAngleDeg })} step={1} suffix="deg" value={design.speedLineAngleDeg} />
              <Slider label="Line opacity" max={1} min={0} onChange={(speedLineOpacity) => patchDesign({ speedLineOpacity })} step={0.05} value={design.speedLineOpacity} />

              <Toggle
                checked={design.halftoneEnabled}
                label="Halftone dots"
                onChange={(halftoneEnabled) => patchDesign({ halftoneEnabled })}
              />
              <ColorField label="Dot color" onChange={(halftoneColor) => patchDesign({ halftoneColor })} value={design.halftoneColor} />
              <Slider label="Dot count" max={48} min={1} onChange={(halftoneCount) => patchDesign({ halftoneCount })} step={1} value={design.halftoneCount} />
              <Slider label="Dot radius" max={5} min={0.4} onChange={(halftoneRadiusMm) => patchDesign({ halftoneRadiusMm })} step={0.1} suffix="mm" value={design.halftoneRadiusMm} />
              <Slider label="Dot spread" max={80} min={6} onChange={(halftoneSpreadMm) => patchDesign({ halftoneSpreadMm })} step={1} suffix="mm" value={design.halftoneSpreadMm} />
              <Slider label="Dot opacity" max={1} min={0} onChange={(halftoneOpacity) => patchDesign({ halftoneOpacity })} step={0.05} value={design.halftoneOpacity} />
            </Panel>

            <Panel title="Reusable Styles">
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-cyan-300/20 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-300"
                  onChange={(event) => setStyleName(event.target.value)}
                  placeholder="Style name"
                  value={styleName}
                />
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-400/10 text-cyan-100 hover:border-cyan-200"
                  onClick={handleSaveStyle}
                  title="Save style"
                  type="button"
                >
                  <Save size={14} />
                </button>
              </div>
              <div className="mt-3 max-h-40 space-y-1 overflow-y-auto">
                {savedStyles.length ? savedStyles.map((style) => (
                  <div className="flex items-center gap-2 rounded border border-cyan-300/10 bg-slate-950/55 px-2 py-1.5" key={style.id}>
                    <button className="min-w-0 flex-1 truncate text-left text-xs text-cyan-100 hover:text-white" onClick={() => setDesign(style.design)} type="button">
                      {style.name}
                    </button>
                    <button className="text-rose-200 hover:text-rose-100" onClick={() => deleteStyle(style.id)} title="Delete style" type="button">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )) : (
                  <div className="rounded border border-cyan-300/10 bg-slate-950/40 px-2 py-2 text-xs text-cyan-100/50">No saved SFX styles yet.</div>
                )}
              </div>
            </Panel>
          </aside>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-cyan-300/15 px-4 py-3">
          <button
            className="rounded-md border border-cyan-300/20 bg-slate-950 px-4 py-2 text-sm text-cyan-100 hover:border-cyan-200 hover:text-white"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="flex items-center gap-2 rounded-md border border-amber-200/60 bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-200"
            onClick={handlePlace}
            type="button"
          >
            <Check size={16} />
            {placeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewFrame({ frame, layout }: { frame: PaperComicSfxFrameDraft; layout: PreviewLayout }) {
  const strokeWidthMm = frame.strokeWidthMm ?? 0;
  const style: CSSProperties = {
    left: (frame.xMm - layout.minX) * layout.scale + layout.offsetX,
    top: (frame.yMm - layout.minY) * layout.scale + layout.offsetY,
    width: frame.widthMm * layout.scale,
    height: frame.heightMm * layout.scale,
    opacity: frame.opacity,
    transform: `rotate(${frame.rotationDeg}deg)`,
    transformOrigin: 'center',
    zIndex: frame.zIndex,
  };

  if (frame.kind === 'shape') {
    if (frame.shapeKind === 'polygon' && frame.vertices?.length) {
      return (
        <svg className="absolute overflow-visible" style={style} viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon
            fill={frame.fillColor}
            fillOpacity={frame.fillOpacity}
            points={frame.vertices.map((vertex) => `${vertex.xPercent},${vertex.yPercent}`).join(' ')}
            stroke={frame.strokeColor}
            strokeOpacity={frame.strokeOpacity}
            strokeWidth={Math.max(0, strokeWidthMm * layout.scale)}
          />
        </svg>
      );
    }
    if (frame.shapeKind === 'line') {
      return (
        <div
          className="absolute origin-center"
          style={{
            ...style,
            height: Math.max(1, strokeWidthMm * layout.scale),
            background: frame.strokeColor,
          }}
        />
      );
    }
    return (
      <div
        className="absolute rounded-full"
        style={{
          ...style,
          background: frame.fillColor,
          border: strokeWidthMm > 0 ? `${Math.max(1, strokeWidthMm * layout.scale)}px solid ${frame.strokeColor}` : undefined,
        }}
      />
    );
  }

  const textStyle: CSSProperties & { WebkitTextStroke?: string } = {
    ...style,
    alignItems: 'center',
    color: frame.typography?.color,
    display: 'flex',
    fontFamily: frame.typography?.fontFamily,
    fontSize: `${Math.max(9, (frame.typography?.fontSizePt ?? 32) * layout.scale * 0.38)}px`,
    fontStyle: frame.typography?.fontStyle,
    fontWeight: frame.typography?.fontWeight,
    justifyContent: 'center',
    letterSpacing: `${(frame.typography?.tracking ?? 0) * layout.scale * 0.25}px`,
    lineHeight: 0.95,
    textAlign: 'center',
    textShadow: frame.textShadowColor
      ? `${(frame.textShadowOffsetXMm ?? 0) * layout.scale}px ${(frame.textShadowOffsetYMm ?? 0) * layout.scale}px ${(frame.textShadowBlurMm ?? 0) * layout.scale}px ${frame.textShadowColor}`
      : undefined,
    transform: `rotate(${frame.rotationDeg}deg) skew(${frame.textSkewXDeg ?? 0}deg, ${frame.textSkewYDeg ?? 0}deg) scale(${frame.textScaleX ?? 1}, ${frame.textScaleY ?? 1})`,
    WebkitTextStroke: frame.textStrokeWidthMm && frame.textStrokeColor
      ? `${Math.max(0, frame.textStrokeWidthMm * layout.scale * 0.7)}px ${frame.textStrokeColor}`
      : undefined,
  };

  return (
    <div className="absolute select-none whitespace-nowrap" style={textStyle}>
      {frame.text}
    </div>
  );
}

interface PreviewLayout {
  minX: number;
  minY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function computePreviewLayout(frames: PaperComicSfxFrameDraft[]): PreviewLayout {
  if (!frames.length) {
    return { minX: 0, minY: 0, scale: 1, offsetX: 0, offsetY: 0 };
  }
  const minX = Math.min(...frames.map((frame) => frame.xMm));
  const minY = Math.min(...frames.map((frame) => frame.yMm));
  const maxX = Math.max(...frames.map((frame) => frame.xMm + frame.widthMm));
  const maxY = Math.max(...frames.map((frame) => frame.yMm + frame.heightMm));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min((PREVIEW_WIDTH - 40) / width, (PREVIEW_HEIGHT - 34) / height);
  return {
    minX,
    minY,
    scale,
    offsetX: (PREVIEW_WIDTH - width * scale) / 2,
    offsetY: (PREVIEW_HEIGHT - height * scale) / 2,
  };
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-cyan-300/15 bg-slate-950/50 p-3">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/65">{title}</div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-xs text-cyan-100/75">
      <span>{label}</span>
      <input
        className="min-w-0 rounded-md border border-cyan-300/20 bg-slate-950 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-300"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      <AdvancedColorPicker
        className="h-8 w-10"
        buttonClassName="rounded border border-cyan-300/20"
        label={label}
        onChange={onChange}
        value={colorInputValue(value)}
      />
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs text-cyan-100/75">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono text-cyan-100/55">{formatSliderValue(value)}{suffix}</span>
      </div>
      <input
        className="w-full accent-amber-300"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-cyan-300/10 bg-slate-950/50 px-2 py-2 text-xs text-cyan-100/75">
      <span>{label}</span>
      <input
        checked={checked}
        className="h-4 w-4 accent-amber-300"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function colorInputValue(value: string): string {
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : '#ffffff';
}

function formatSliderValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
