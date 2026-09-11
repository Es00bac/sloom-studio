import { useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import {
  DEFAULT_GRADIENT_TOOL_SETTINGS,
  STANDARD_GRADIENT_TOOL_PRESETS,
  type BlendMode,
  type GradientToolColorStop,
  type ImageLayer,
} from '../../types/imageEditor';
import type { PaperComicSfxDesign, PaperComicSfxPresetId } from '../../lib/paperComicSfx';
import { AdvancedColorPicker } from '../Common/AdvancedColorPicker';
import { ComicSfxDesigner } from '../Paper/ComicSfxDesigner';
import {
  buildComicSfxLayerUpdate,
  createComicMangaLayer,
  createComicSfxLayer,
  type ImageComicLayerKind,
} from './ImageComicTools';
import {
  IMAGE_TEXT_PRESETS,
  IMAGE_TEXT_STYLE_PRESETS,
  applyImageTextPresetToStyle,
  applyImageTextStylePresetToStyle,
} from './ImageTextPresets';
import {
  TextFontStackControls,
  TextOpenTypeFeatureControls,
  TypographyParityCheckSummary,
  TypographySupportMatrixSummary,
} from './ImageEditorTextLayerControls';
import {
  applyImageTextFindReplace,
  describeImageTextFontPersistence,
  describeImageTextTypographyParityProgress,
  describeImageTextTypographyReadiness,
  describeImageTextTypographySupportMatrix,
  planImageTextDictionarySpellcheck,
  serializeImageTextStylePackage,
} from './ImageTextLayer';
import { Slider } from './ImageEditorPropertyControls';

const PAINT_BUCKET_BLEND_MODES: BlendMode[] = [
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

export function TextPanel() {
  const settings = useImageEditorStore((s) => s.textToolSettings);
  const set = useImageEditorStore((s) => s.setTextToolSettings);
  const fontPersistence = describeImageTextFontPersistence(settings.fontFamily);
  const openTypeFeatures = serializeImageTextStylePackage(settings).characterStyle.openTypeFeatures;
  const openTypeTags = [...openTypeFeatures.disabled, ...openTypeFeatures.enabled];
  const supportMatrix = describeImageTextTypographySupportMatrix([
    {
      id: 'text-tool-settings',
      name: 'Text Tool Settings',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 0,
      mask: null,
      text: settings,
      metadata: { editableText: true },
    } satisfies ImageLayer,
  ]);
  const applyPreset = (presetId: (typeof IMAGE_TEXT_PRESETS)[number]['id']) => {
    set(applyImageTextPresetToStyle(settings, presetId));
  };

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <div>
        <div className="mb-1 text-cyan-100/45">Presets</div>
        <div className="grid grid-cols-2 gap-1">
          {IMAGE_TEXT_PRESETS.map((preset) => (
            <button
              className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-left text-[11px] font-semibold text-cyan-100/65 hover:border-cyan-400/40 hover:text-white"
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-cyan-100/45">Type Styles</div>
        <div className="grid grid-cols-2 gap-1">
          {IMAGE_TEXT_STYLE_PRESETS.map((preset) => (
            <button
              className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-left text-[11px] font-semibold text-cyan-100/65 hover:border-cyan-400/40 hover:text-white"
              key={preset.id}
              onClick={() => set(applyImageTextStylePresetToStyle(settings, preset.id))}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block">Content</span>
        <textarea
          className="min-h-24 w-full resize-y rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50"
          onChange={(e) => set({ content: e.target.value })}
          value={settings.content}
        />
      </label>
      <TextFontStackControls
        customAriaLabel="Text tool custom font family"
        onChange={(patch) => set(patch)}
        selectAriaLabel="Text tool font stack"
        style={settings.fontStyle}
        value={settings.fontFamily}
        weight={settings.fontWeight}
      />
      <div className="grid grid-cols-2 gap-2">
        <Slider
          label="Size"
          value={settings.fontSize}
          max={180}
          min={6}
          step={1}
          onChange={(v) => set({ fontSize: v })}
          format={(v) => `${Math.round(v)}px`}
        />
        <Slider
          label="Leading"
          value={settings.lineHeight}
          max={2.5}
          min={0.8}
          step={0.05}
          onChange={(v) => set({ lineHeight: v })}
          format={(v) => `${v.toFixed(2)}x`}
        />
        <Slider
          label="Tracking"
          value={settings.letterSpacing}
          max={40}
          min={-5}
          step={1}
          onChange={(v) => set({ letterSpacing: v })}
          format={(v) => `${Math.round(v)}px`}
        />
        <Slider
          label="Baseline"
          value={settings.baselineShift}
          max={128}
          min={-128}
          step={1}
          onChange={(v) => set({ baselineShift: v })}
          format={(v) => `${Math.round(v)}px`}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Slider label="Box W" value={settings.boxWidth ?? 0} max={1200} min={0} step={10} onChange={(v) => set({ boxWidth: v > 0 ? v : null })} format={(v) => v > 0 ? `${Math.round(v)}px` : 'Auto'} />
        <Slider label="Box H" value={settings.boxHeight ?? 0} max={1200} min={0} step={10} onChange={(v) => set({ boxHeight: v > 0 ? v : null })} format={(v) => v > 0 ? `${Math.round(v)}px` : 'Auto'} />
      </div>
      <div className="flex items-center gap-2">
        <label className="w-16">Color</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10"
          label="Text color"
          onChange={(color) => set({ color })}
          value={settings.color}
        />
        <input
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
          onChange={(e) => set({ color: e.target.value })}
          type="text"
          value={settings.color}
        />
      </div>
      <div>
        <label className="mb-1 block">Weight</label>
        <select
          className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85"
          onChange={(e) => set({ fontWeight: e.target.value, managedFace: undefined, managedFaceIssue: undefined })}
          value={settings.fontWeight}
        >
          <option value="300">Light</option>
          <option value="400">Regular</option>
          <option value="600">Semibold</option>
          <option value="700">Bold</option>
          <option value="900">Black</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block">Kerning</span>
          <select
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85"
            onChange={(e) => set({ fontKerning: e.target.value as typeof settings.fontKerning })}
            value={settings.fontKerning}
          >
            <option value="auto">Auto</option>
            <option value="normal">Metrics</option>
            <option value="none">None</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block">Caps</span>
          <select
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85"
            onChange={(e) => set({ fontVariantCaps: e.target.value as typeof settings.fontVariantCaps })}
            value={settings.fontVariantCaps}
          >
            <option value="normal">Normal</option>
            <option value="small-caps">Small Caps</option>
            <option value="all-small-caps">All Small Caps</option>
          </select>
        </label>
      </div>
      <TextOpenTypeFeatureControls
        ariaLabelPrefix="Text tool "
        onChange={(openTypeFeatures) => set({ openTypeFeatures })}
        value={settings.openTypeFeatures}
      />
      <div className="grid grid-cols-3 gap-1">
        {(['normal', 'italic'] as const).map((fontStyle) => (
          <button className={`rounded border px-2 py-1 text-[11px] font-semibold capitalize ${settings.fontStyle === fontStyle ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100' : 'border-cyan-300/10 bg-[#252630] text-cyan-100/55 hover:border-cyan-300/30'}`} key={fontStyle} onClick={() => set({ fontStyle, managedFace: undefined, managedFaceIssue: undefined })} type="button">{fontStyle}</button>
        ))}
        <button className={`rounded border px-2 py-1 text-[11px] font-semibold ${settings.wrap ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100' : 'border-cyan-300/10 bg-[#252630] text-cyan-100/55 hover:border-cyan-300/30'}`} onClick={() => set({ wrap: !settings.wrap })} type="button">Wrap</button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {(['left', 'center', 'right', 'justify'] as const).map((align) => (
          <button
            className={`rounded border px-2 py-1 text-[11px] font-semibold capitalize ${
              settings.align === align
                ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100'
                : 'border-cyan-300/10 bg-[#252630] text-cyan-100/55 hover:border-cyan-300/30'
            }`}
            key={align}
            onClick={() => set({ align })}
            type="button"
          >
            {align}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {(['top', 'middle', 'bottom'] as const).map((verticalAlign) => (
          <button className={`rounded border px-2 py-1 text-[11px] font-semibold capitalize ${settings.verticalAlign === verticalAlign ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100' : 'border-cyan-300/10 bg-[#252630] text-cyan-100/55 hover:border-cyan-300/30'}`} key={verticalAlign} onClick={() => set({ verticalAlign })} type="button">{verticalAlign}</button>
        ))}
      </div>
      <select className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85" onChange={(e) => set({ warp: e.target.value as 'none' | 'arc' | 'flag' | 'bulge' })} value={settings.warp}>
        <option value="none">No warp</option>
        <option value="arc">Arc warp</option>
        <option value="flag">Flag warp</option>
        <option value="bulge">Bulge warp</option>
      </select>
      <div className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/50">
        <div>On-canvas text placement keeps retained metadata and generates a raster preview.</div>
        <div>Installed font fallback: {fontPersistence.preferredFamily}{fontPersistence.fallbackFamilies.length ? ` -> ${fontPersistence.fallbackFamilies.join(', ')}` : ' -> none declared'}</div>
        <div>Kerning {settings.fontKerning}</div>
        <div>Baseline {Math.round(settings.baselineShift)}px</div>
        <div>OpenType intent {openTypeTags.length ? openTypeTags.join(', ') : 'default features'}</div>
        <div>Retained text style stays editable in Sloom Studio; the supported PSD text subset writes native editable text layers, while unsupported typography falls back truthfully.</div>
      </div>
      <TypographySupportMatrixSummary matrix={supportMatrix} />
      <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
        Click the canvas to place the configured multiline text as a new raster text layer.
      </p>
      <TextLayerTypographyReadinessPanel />
    </div>
  );
}

export function TextLayerTypographyReadinessPanel() {
  const activeDoc = useImageEditorStore((s) =>
    s.documents.find((d) => d.id === s.activeDocId) ?? null,
  );
  const pushOperation = useImageEditorStore((s) => s.pushOperation);
  const updateLayer = useImageEditorStore((s) => s.updateLayer);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  const selectedLayer = activeDoc?.layers.find((layer) => layer.id === activeDoc.activeLayerId) ?? null;
  const selectedTextLayer = selectedLayer?.text ? selectedLayer : null;
  const spellcheck = planImageTextDictionarySpellcheck(selectedTextLayer ? [selectedTextLayer] : []);
  const readiness = describeImageTextTypographyReadiness(
    selectedTextLayer ? [selectedTextLayer] : [],
    {
      findReplace: {
        find,
        replace,
        caseSensitive,
        wholeWord,
      },
    },
  );
  const parityProgress = describeImageTextTypographyParityProgress(
    selectedTextLayer ? [selectedTextLayer] : [],
    {
      findReplace: {
        find,
        replace,
        caseSensitive,
        wholeWord,
      },
    },
  );
  const proposal = readiness.operations.findReplace.plan.proposedReplacements[0];
  const readability = readiness.operations.spellcheckReadability.readability;
  const blockedByLayer = readiness.layerReadiness.find((layer) => layer.layerId === selectedLayer?.id);
  const matchCount = proposal?.matchCount ?? 0;
  const canApply = Boolean(
    selectedTextLayer &&
      readiness.operations.findReplace.status === 'ready' &&
      blockedByLayer?.status !== 'blocked' &&
      matchCount > 0,
  );

  const apply = () => {
    if (!activeDoc || !selectedTextLayer || !canApply) return;
    const result = applyImageTextFindReplace([selectedTextLayer], {
      find,
      replace,
      caseSensitive,
      wholeWord,
    });
    const updated = result.layers.find((layer) => layer.id === selectedTextLayer.id);
    if (!updated || !updated.text) return;
    const nextLayers = activeDoc.layers.map((layer) => (
      layer.id === selectedTextLayer.id ? updated : layer
    ));
    pushOperation({
      kind: 'layerOp',
      docId: activeDoc.id,
      before: activeDoc.layers,
      after: nextLayers,
    });
    updateLayer(activeDoc.id, selectedTextLayer.id, updated);
  };

  if (!selectedTextLayer) return null;

  return (
    <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-xs text-cyan-100/60">
      <div className="font-semibold uppercase tracking-[0.16em] text-cyan-100/45">Typography Readability</div>
      <div
        aria-atomic="true"
        aria-label="Image text spellcheck results"
        aria-live="polite"
        className="rounded border border-cyan-300/10 bg-[#151925] px-2 py-1.5 text-[11px]"
        role={spellcheck.misspellings.length > 0 ? 'alert' : 'status'}
      >
        <div className="font-semibold text-cyan-100/70">Local dictionary spellcheck</div>
        <div aria-label={`Spellcheck misspelling count: ${spellcheck.misspellings.length}`}>
          Misspellings {spellcheck.misspellings.length}
        </div>
        {spellcheck.misspellings.length > 0 ? (
          <ul aria-label="Misspelled words" className="mt-1 space-y-1 text-cyan-100/65">
            {spellcheck.misspellings.map((misspelling) => (
              <li className="flex flex-wrap gap-x-2" key={misspelling.normalized}>
                <span className="font-semibold text-amber-200/85">{misspelling.word}</span>
                <span aria-label={`Suggestions for ${misspelling.word}`}>
                  Suggestions {misspelling.suggestions.length ? misspelling.suggestions.join(', ') : 'none locally'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-cyan-100/50">No misspellings found</div>
        )}
        <p className="mt-1 text-[10px] text-cyan-100/45">
          Compact local dictionary only: coverage is intentionally limited; no network dictionary is used.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[10px] text-cyan-100/50">
        <span>Characters {readability.characterCount}</span>
        <span>Words {readability.wordCount}</span>
        <span>Sentences {readability.sentenceCount}</span>
        <span>Avg Words/Sent {readability.averageWordsPerSentence}</span>
        <span>Longest Line {readability.longestLineLength}</span>
        <span>Matches {matchCount}</span>
      </div>
      <TypographyParityCheckSummary progress={parityProgress} />
      <div className="grid gap-2 text-[11px]">
        <label className="block">
          <span className="mb-1 block text-cyan-100/45">Find</span>
          <input
            aria-label="Typography find"
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50"
            onChange={(event) => setFind(event.target.value)}
            type="text"
            value={find}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-cyan-100/45">Replace</span>
          <input
            aria-label="Typography replace"
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50"
            onChange={(event) => setReplace(event.target.value)}
            type="text"
            value={replace}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-cyan-100/65">
          <label className="flex items-center gap-1.5">
            <input
              aria-label="Typography case sensitive"
              checked={caseSensitive}
              onChange={(event) => setCaseSensitive(event.target.checked)}
              type="checkbox"
            />
            <span>Case sensitive</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input
              aria-label="Typography whole word"
              checked={wholeWord}
              onChange={(event) => setWholeWord(event.target.checked)}
              type="checkbox"
            />
            <span>Whole word</span>
          </label>
        </div>
      </div>
      {readiness.blockers.length > 0 ? (
        <p className="rounded border border-amber-200/25 bg-amber-200/5 px-2 py-1 text-[10px] text-amber-200/75">
          {readiness.blockers.map((blocker) => blocker.message).join(' | ')}
        </p>
      ) : null}
      <button
        aria-label="Apply typography find and replace"
        className={`w-full rounded border px-2 py-1.5 text-[11px] font-semibold ${canApply ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100 hover:border-cyan-300/75' : 'border-cyan-300/20 bg-[#252630] text-cyan-100/35 disabled:cursor-not-allowed'}`}
        disabled={!canApply}
        onClick={apply}
        type="button"
      >
        Apply typography find and replace
      </button>
    </div>
  );
}

export function ComicMangaPanel() {
  const activeDoc = useImageEditorStore((s) =>
    s.documents.find((d) => d.id === s.activeDocId) ?? null,
  );
  const addLayer = useImageEditorStore((s) => s.addLayer);
  const updateLayer = useImageEditorStore((s) => s.updateLayer);
  const pushOperation = useImageEditorStore((s) => s.pushOperation);
  const [sfxDesignerPreset, setSfxDesignerPreset] = useState<PaperComicSfxPresetId | null>(null);
  const [editingSfxLayerId, setEditingSfxLayerId] = useState<string | null>(null);
  const activeLayer = activeDoc?.layers.find((layer) => layer.id === activeDoc.activeLayerId) ?? null;
  const activeSfxDesign = activeLayer?.metadata?.comicSfxDesign ?? null;

  const addComicLayer = (kind: ImageComicLayerKind) => {
    if (!activeDoc) return;
    const before = activeDoc.layers;
    const layer = createComicMangaLayer(activeDoc, kind);
    addLayer(activeDoc.id, layer);
    const after = useImageEditorStore.getState()
      .documents.find((doc) => doc.id === activeDoc.id)?.layers;
    if (!after) return;
    pushOperation({
      kind: 'layerOp',
      docId: activeDoc.id,
      before,
      after,
    });
  };

  const addSfxLayer = (design: PaperComicSfxDesign) => {
    if (!activeDoc) return;
    const before = activeDoc.layers;
    if (editingSfxLayerId) {
      const layer = activeDoc.layers.find((candidate) => candidate.id === editingSfxLayerId);
      if (!layer) {
        setEditingSfxLayerId(null);
        setSfxDesignerPreset(null);
        return;
      }
      updateLayer(activeDoc.id, layer.id, buildComicSfxLayerUpdate(activeDoc, layer, design));
    } else {
      const layer = createComicSfxLayer(activeDoc, design);
      addLayer(activeDoc.id, layer);
    }
    const after = useImageEditorStore.getState()
      .documents.find((doc) => doc.id === activeDoc.id)?.layers;
    if (after) {
      pushOperation({
        kind: 'layerOp',
        docId: activeDoc.id,
        before,
        after,
      });
    }
    setEditingSfxLayerId(null);
    setSfxDesignerPreset(null);
  };

  return (
    <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-xs text-cyan-100/60">
      <div className="font-semibold uppercase tracking-[0.16em] text-cyan-100/45">Comic / Manga</div>
      <div className="grid grid-cols-2 gap-1">
        <ComicButton disabled={!activeDoc} label="Speech" onClick={() => addComicLayer('speechBubble')} />
        <ComicButton disabled={!activeDoc} label="Thought" onClick={() => addComicLayer('thoughtBubble')} />
        <ComicButton disabled={!activeDoc} label="Caption" onClick={() => addComicLayer('caption')} />
        <ComicButton disabled={!activeDoc} label="Panel" onClick={() => addComicLayer('panelBorder')} />
        <ComicButton disabled={!activeDoc} label="Speed Lines" onClick={() => addComicLayer('mangaSpeedLine')} wide />
        <ComicButton disabled={!activeDoc} label="SFX Designer" onClick={() => setSfxDesignerPreset('bang')} wide />
        <ComicButton
          disabled={!activeDoc || !activeSfxDesign || !activeLayer}
          label="Edit Selected SFX"
          onClick={() => {
            if (!activeLayer || !activeSfxDesign) return;
            setEditingSfxLayerId(activeLayer.id);
            setSfxDesignerPreset(activeSfxDesign.presetId);
          }}
          wide
        />
      </div>
      {sfxDesignerPreset ? (
        <ComicSfxDesigner
          initialDesign={editingSfxLayerId && activeSfxDesign ? activeSfxDesign : undefined}
          initialPresetId={sfxDesignerPreset}
          onClose={() => {
            setEditingSfxLayerId(null);
            setSfxDesignerPreset(null);
          }}
          onPlace={addSfxLayer}
          placeLabel={editingSfxLayerId ? 'Update Layer' : 'Place Layer'}
        />
      ) : null}
    </div>
  );
}

export function ComicButton({
  disabled,
  label,
  onClick,
  wide,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  wide?: boolean;
}) {
  return (
    <button
      className={`rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-left text-[11px] font-semibold text-cyan-100/65 hover:border-cyan-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${wide ? 'col-span-2' : ''}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

export function ShapePanel() {
  const settings = useImageEditorStore((s) => s.shapeToolSettings);
  const set = useImageEditorStore((s) => s.setShapeToolSettings);
  const usesPolygonSides = settings.presetKind === 'polygon' || settings.presetKind === 'star';

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <label className="block">
        <span className="mb-1 block">Preset</span>
        <select
          aria-label="Shape preset"
          className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85"
          onChange={(event) => set({ presetKind: event.target.value as typeof settings.presetKind })}
          value={settings.presetKind}
        >
          <option value="rect">Rectangle</option>
          <option value="line">Line</option>
          <option value="triangle">Triangle</option>
          <option value="diamond">Diamond</option>
          <option value="polygon">Polygon</option>
          <option value="star">Star</option>
        </select>
      </label>
      {usesPolygonSides ? (
        <label className="block">
          <span className="mb-1 flex items-center justify-between">
            <span>{settings.presetKind === 'star' ? 'Points' : 'Sides'}</span>
            <span className="text-cyan-100/40">{settings.polygonSides}</span>
          </span>
          <input
            aria-label="Polygon sides"
            className="w-full cursor-pointer accent-cyan-400"
            max={12}
            min={3}
            onChange={(event) => set({ polygonSides: parseInt(event.target.value, 10) })}
            step={1}
            type="range"
            value={settings.polygonSides}
          />
        </label>
      ) : null}
      {settings.presetKind === 'star' ? (
        <label className="block">
          <span className="mb-1 flex items-center justify-between">
            <span>Inner Radius</span>
            <span className="text-cyan-100/40">{settings.starInnerRadius.toFixed(2)}</span>
          </span>
          <input
            aria-label="Star inner radius"
            className="w-full cursor-pointer accent-cyan-400"
            max={0.9}
            min={0.1}
            onChange={(event) => set({ starInnerRadius: parseFloat(event.target.value) })}
            step={0.01}
            type="range"
            value={settings.starInnerRadius}
          />
        </label>
      ) : null}
      <Slider
        label="Fill Opacity"
        value={settings.fillOpacity}
        max={1}
        min={0}
        step={0.01}
        onChange={(v) => set({ fillOpacity: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Stroke"
        value={settings.strokeWidth}
        max={64}
        min={0}
        step={1}
        onChange={(v) => set({ strokeWidth: v })}
        format={(v) => `${Math.round(v)}px`}
      />
      <div className="flex items-center gap-2">
        <label className="w-16">Fill</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10"
          label="Shape fill color"
          onChange={(fillColor) => set({ fillColor })}
          value={settings.fillColor}
        />
        <input
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
          onChange={(e) => set({ fillColor: e.target.value })}
          type="text"
          value={settings.fillColor}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="w-16">Stroke</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10"
          label="Shape stroke color"
          onChange={(strokeColor) => set({ strokeColor })}
          value={settings.strokeColor}
        />
        <input
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
          onChange={(e) => set({ strokeColor: e.target.value })}
          type="text"
          value={settings.strokeColor}
        />
      </div>
      <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
        The rectangle shape tool can also emit retained line, triangle, diamond, polygon, and star path layers. The ellipse tool remains dedicated.
      </p>
    </div>
  );
}

export function PenPanel() {
  const settings = useImageEditorStore((s) => s.shapeToolSettings);
  const set = useImageEditorStore((s) => s.setShapeToolSettings);

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <Slider
        label="Fill Opacity"
        value={settings.fillOpacity}
        max={1}
        min={0}
        step={0.01}
        onChange={(v) => set({ fillOpacity: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Stroke Width"
        value={settings.strokeWidth}
        max={64}
        min={0}
        step={1}
        onChange={(v) => set({ strokeWidth: v })}
        format={(v) => `${Math.round(v)}px`}
      />
      <div className="flex items-center gap-2">
        <label className="w-16">Fill</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10"
          label="Pen path fill color"
          onChange={(fillColor) => set({ fillColor })}
          value={settings.fillColor}
        />
        <input
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
          onChange={(e) => set({ fillColor: e.target.value })}
          type="text"
          value={settings.fillColor}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="w-16">Stroke</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10"
          label="Pen path stroke color"
          onChange={(strokeColor) => set({ strokeColor })}
          value={settings.strokeColor}
        />
        <input
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
          onChange={(e) => set({ strokeColor: e.target.value })}
          type="text"
          value={settings.strokeColor}
        />
      </div>
      <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
        Click to add anchor points. Press Enter to commit the retained path layer, or Escape to cancel the active path.
      </p>
    </div>
  );
}

export function GradientPanel() {
  const brushSettings = useImageEditorStore((s) => s.brushSettings);
  const backgroundColor = useImageEditorStore((s) => s.backgroundColor);
  const gradientSettings = useImageEditorStore((s) => s.gradientToolSettings ?? DEFAULT_GRADIENT_TOOL_SETTINGS);
  const setBrush = useImageEditorStore((s) => s.setBrushSettings);
  const setGradient = useImageEditorStore((s) => s.setGradientToolSettings);
  const colorStops = getGradientPanelStops(gradientSettings.colorStops, brushSettings.color, backgroundColor);
  const selectedPresetId = gradientSettings.presetId ?? 'custom';
  const setPreset = (presetId: string) => {
    if (presetId === 'custom') {
      setGradient({ presetId, colorMode: 'multiStop', colorStops });
      return;
    }
    const preset = STANDARD_GRADIENT_TOOL_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    setGradient({
      colorMode: 'multiStop',
      presetId: preset.id,
      colorStops: preset.colorStops.map((stop) => ({ ...stop })),
    });
  };
  const setStopColor = (index: number, color: string) => {
    setGradient({
      colorMode: 'multiStop',
      presetId: 'custom',
      colorStops: colorStops.map((stop, stopIndex) => (
        stopIndex === index ? { ...stop, color } : stop
      )),
    });
  };
  const setStopOffset = (index: number, offset: number) => {
    setGradient({
      colorMode: 'multiStop',
      presetId: 'custom',
      colorStops: colorStops
        .map((stop, stopIndex) => (
          stopIndex === index ? { ...stop, offset: clampStopUnit(offset) } : stop
        ))
        .sort((a, b) => a.offset - b.offset),
    });
  };
  const setStopOpacity = (index: number, opacity: number) => {
    setGradient({
      colorMode: 'multiStop',
      presetId: 'custom',
      colorStops: colorStops.map((stop, stopIndex) => (
        stopIndex === index ? { ...stop, opacity: clampStopUnit(opacity) } : stop
      )),
    });
  };
  const addStop = () => {
    setGradient({
      colorMode: 'multiStop',
      presetId: 'custom',
      colorStops: insertGradientStop(colorStops),
    });
  };
  const removeStop = (index: number) => {
    if (colorStops.length <= 2) return;
    setGradient({
      colorMode: 'multiStop',
      presetId: 'custom',
      colorStops: colorStops.filter((_stop, stopIndex) => stopIndex !== index),
    });
  };
  const setColorMode = (colorMode: typeof gradientSettings.colorMode) => {
    setGradient({
      colorMode,
      presetId: colorMode === 'multiStop' ? selectedPresetId : undefined,
      colorStops: colorMode === 'multiStop' ? colorStops : gradientSettings.colorStops,
    });
  };

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block">Gradient Mode</span>
          <select
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85"
            onChange={(e) => setGradient({ mode: e.target.value as typeof gradientSettings.mode })}
            value={gradientSettings.mode}
          >
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
            <option value="angle">Angle</option>
            <option value="reflected">Reflected</option>
            <option value="diamond">Diamond</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block">Preset</span>
          <select
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85"
            onChange={(e) => setColorMode(e.target.value as typeof gradientSettings.colorMode)}
            value={gradientSettings.colorMode}
          >
            <option value="foregroundToBackground">Foreground → Background</option>
            <option value="foregroundToTransparent">Foreground → Transparent</option>
            <option value="multiStop">Custom Stops</option>
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block">Gradient Preset</span>
        <select
          className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85"
          onChange={(e) => setPreset(e.target.value)}
          value={selectedPresetId}
        >
          <option value="custom">Custom Stops</option>
          {STANDARD_GRADIENT_TOOL_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
      </label>
      <Slider
        label="Opacity"
        value={brushSettings.opacity}
        max={1}
        min={0}
        step={0.01}
        onChange={(v) => setBrush({ opacity: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <div className="flex items-center gap-2">
        <input
          checked={gradientSettings.reverse}
          id="gradient-reverse"
          onChange={(e) => setGradient({ reverse: e.target.checked })}
          type="checkbox"
        />
        <label htmlFor="gradient-reverse">Reverse Gradient</label>
      </div>
      <div className="flex items-center gap-2">
        <input
          checked={gradientSettings.dither}
          id="gradient-dither"
          onChange={(e) => setGradient({ dither: e.target.checked })}
          type="checkbox"
        />
        <label htmlFor="gradient-dither">Dither</label>
      </div>
      <div className="flex items-center gap-2">
        <label className="w-16">Foreground</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10"
          label="Gradient foreground color"
          onChange={(color) => setBrush({ color })}
          value={brushSettings.color}
        />
        <input
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
          onChange={(e) => setBrush({ color: e.target.value })}
          type="text"
          value={brushSettings.color}
        />
      </div>
      <div className="space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold uppercase tracking-[0.16em] text-cyan-100/45">Gradient Stops</div>
          <button
            className="rounded border border-cyan-300/15 px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/40"
            onClick={addStop}
            type="button"
          >
            Add Stop
          </button>
        </div>
        <div className="grid grid-cols-[1fr_72px_72px_72px] gap-2 text-[10px] uppercase tracking-[0.12em] text-cyan-100/35">
          <span>Color</span>
          <span>Offset</span>
          <span>Stop Opacity</span>
          <span>Remove</span>
        </div>
        {colorStops.map((stop, index) => (
          <div className="grid grid-cols-[1fr_72px_72px_72px] items-center gap-2" key={`${stop.offset}-${index}`}>
            <div className="flex min-w-0 items-center gap-2">
              <label className="w-20 shrink-0">{getGradientStopLabel(index, colorStops.length)}</label>
              <AdvancedColorPicker
                className="h-6 w-10 shrink-0"
                buttonClassName="rounded border border-cyan-300/10"
                label={`Gradient ${getGradientStopAriaLabel(index, colorStops.length)} color`}
                onChange={(color) => setStopColor(index, color)}
                value={stop.color}
              />
              <input
                aria-label={`Gradient ${getGradientStopAriaLabel(index, colorStops.length)} color`}
                className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
                onChange={(e) => setStopColor(index, e.target.value)}
                type="text"
                value={stop.color}
              />
            </div>
            <input
              aria-label={`Gradient ${getGradientStopAriaLabel(index, colorStops.length)} offset`}
              className="rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
              max={1}
              min={0}
              onChange={(e) => setStopOffset(index, Number(e.target.value))}
              step={0.01}
              type="number"
              value={roundStopUnit(stop.offset)}
            />
            <input
              aria-label={`Gradient ${getGradientStopAriaLabel(index, colorStops.length)} opacity`}
              className="rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
              max={1}
              min={0}
              onChange={(e) => setStopOpacity(index, Number(e.target.value))}
              step={0.01}
              type="number"
              value={roundStopUnit(stop.opacity ?? 1)}
            />
            <button
              className="rounded border border-cyan-300/15 px-2 py-1 text-[11px] font-semibold text-cyan-100/65 hover:border-cyan-300/40 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={colorStops.length <= 2}
              onClick={() => removeStop(index)}
              type="button"
            >
              Remove Stop
            </button>
          </div>
        ))}
      </div>
      <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
        Drag to apply a linear, radial, angle, reflected, or diamond gradient using foreground/background colors or saved stops. Reverse, dither, preset, and stop changes stay active until you change them.
      </p>
    </div>
  );
}

function getGradientPanelStops(
  stops: GradientToolColorStop[] | undefined,
  foregroundColor: string,
  backgroundColor: string,
): GradientToolColorStop[] {
  if (stops && stops.length >= 2) {
    return stops
      .map((stop) => ({
        offset: clampStopUnit(stop.offset),
        color: stop.color,
        opacity: stop.opacity === undefined ? undefined : clampStopUnit(stop.opacity),
      }))
      .sort((a, b) => a.offset - b.offset);
  }
  return [
    { offset: 0, color: foregroundColor, opacity: 1 },
    { offset: 0.5, color: '#808080', opacity: 1 },
    { offset: 1, color: backgroundColor, opacity: 1 },
  ];
}

function getGradientStopLabel(index: number, total: number): string {
  if (index === 0) return 'Start Stop';
  if (index === total - 1) return 'End Stop';
  if (index === 1) return 'Middle Stop';
  return `Stop ${index + 1}`;
}

function getGradientStopAriaLabel(index: number, total: number): string {
  if (index === 0) return 'start stop';
  if (index === total - 1) return 'end stop';
  if (index === 1) return 'middle stop';
  return `stop ${index + 1}`;
}

function insertGradientStop(stops: GradientToolColorStop[]): GradientToolColorStop[] {
  const sorted = [...stops].sort((a, b) => a.offset - b.offset);
  let insertAfter = 0;
  let largestGap = -1;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index].offset - sorted[index - 1].offset;
    if (gap > largestGap) {
      largestGap = gap;
      insertAfter = index - 1;
    }
  }
  const previous = sorted[insertAfter] ?? { offset: 0, color: '#ffffff', opacity: 1 };
  const next = sorted[insertAfter + 1] ?? { offset: 1, color: previous.color, opacity: previous.opacity };
  const stop: GradientToolColorStop = {
    offset: roundStopUnit((previous.offset + next.offset) / 2),
    color: previous.color,
    opacity: previous.opacity ?? 1,
  };
  return [...sorted.slice(0, insertAfter + 1), stop, ...sorted.slice(insertAfter + 1)];
}

function clampStopUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundStopUnit(value: number): number {
  return Math.round(clampStopUnit(value) * 100) / 100;
}

export function PaintBucketPanel() {
  const settings = useImageEditorStore((s) => s.brushSettings);
  const selectionSettings = useImageEditorStore((s) => s.selectionToolSettings);
  const setBrush = useImageEditorStore((s) => s.setBrushSettings);
  const setSelection = useImageEditorStore((s) => s.setSelectionToolSettings);

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <Slider
        label="Tolerance"
        value={selectionSettings.magicWandTolerance}
        max={255}
        min={0}
        step={1}
        onChange={(v) => setSelection({ magicWandTolerance: v })}
        format={(v) => `${Math.round(v)}`}
      />
      <Slider
        label="Opacity"
        value={settings.opacity}
        max={1}
        min={0}
        step={0.01}
        onChange={(v) => setBrush({ opacity: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <label className="block">
        <span className="mb-1 block">Mode</span>
        <select
          aria-label="Paint bucket blend mode"
          className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/80"
          onChange={(e) => setSelection({ paintBucketBlendMode: e.target.value as BlendMode })}
          value={selectionSettings.paintBucketBlendMode}
        >
          {PAINT_BUCKET_BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <input
          checked={selectionSettings.sampleAllLayers}
          id="paint-bucket-sample-all-layers"
          onChange={(e) => setSelection({ sampleAllLayers: e.target.checked })}
          type="checkbox"
        />
        <label htmlFor="paint-bucket-sample-all-layers">Sample All Layers</label>
      </div>
      <div className="flex items-center gap-2">
        <input
          checked={selectionSettings.contiguous}
          id="paint-bucket-contiguous"
          onChange={(e) => setSelection({ contiguous: e.target.checked })}
          type="checkbox"
        />
        <label htmlFor="paint-bucket-contiguous">Contiguous</label>
      </div>
      <div className="flex items-center gap-2">
        <input
          checked={selectionSettings.paintBucketPreserveTransparency}
          id="paint-bucket-preserve-transparency"
          onChange={(e) => setSelection({ paintBucketPreserveTransparency: e.target.checked })}
          type="checkbox"
        />
        <label htmlFor="paint-bucket-preserve-transparency">Preserve Transparency</label>
      </div>
      <div className="flex items-center gap-2">
        <label className="w-16">Color</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10"
          label="Paint bucket color"
          onChange={(color) => setBrush({ color })}
          value={settings.color}
        />
        <input
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
          onChange={(e) => setBrush({ color: e.target.value })}
          type="text"
          value={settings.color}
        />
      </div>
      <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
        Click to fill matching colors on the active layer. Tolerance, sample source, and contiguous matching share the Magic Wand settings.
      </p>
    </div>
  );
}
