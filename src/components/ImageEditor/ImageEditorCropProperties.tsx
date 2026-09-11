import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { useSettingsStore } from '../../store/settingsStore';
import {
  cropCustomPresetValue,
  formatCropRatioLabel,
  parseCropRatioInput,
} from './cropPresets';
import {
  getPerspectiveCropPreview,
  reconcileCropPreviewMode,
  seedPerspectiveCropQuadFromDocument,
  setPerspectiveCropQuad,
  subscribePerspectiveCropPreview,
} from './tools/cropTool';
import {
  isPerspectiveCropQuadValid,
  PERSPECTIVE_CROP_MAX_ABS_COORDINATE,
  PERSPECTIVE_CROP_QUAD_LABELS,
  resolvePerspectiveCropAvailability,
  resolvePerspectiveCropQuadValidity,
  type PerspectiveCropQuad,
} from './tools/perspectiveCropSession';
import { perspectiveCropOutputSize } from './tools/perspectiveCropDocument';
import type { CropAspectPreset, CropGuideMode, CropToolMode } from '../../types/imageEditor';
import { imageDocumentHasEditableTiltmarkSurface } from './tiltmark/ImageTiltmarkLayer';

const ASPECT_OPTIONS: Array<{ value: CropAspectPreset; label: string }> = [
  { value: 'free', label: 'Free' },
  { value: 'original', label: 'Original' },
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '4:5', label: '4:5' },
  { value: '16:9', label: '16:9' },
];

const GUIDE_OPTIONS: Array<{ value: CropGuideMode; label: string }> = [
  { value: 'none', label: 'Off' },
  { value: 'thirds', label: 'Thirds' },
  { value: 'grid', label: 'Grid' },
];

const MIN_CROP_ROTATION_DEG = -45;
const MAX_CROP_ROTATION_DEG = 45;

export function CropPanel() {
  const activeDoc = useImageEditorStore((state) =>
    state.documents.find((document) => document.id === state.activeDocId) ?? null,
  );
  const settings = useImageEditorStore((state) => state.cropToolSettings);
  const setCropToolSettings = useImageEditorStore((state) => state.setCropToolSettings);
  const customCropPresets = useSettingsStore((state) => state.customCropPresets);
  const saveCustomCropPreset = useSettingsStore((state) => state.saveCustomCropPreset);
  const deleteCustomCropPreset = useSettingsStore((state) => state.deleteCustomCropPreset);
  const [presetDraft, setPresetDraft] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);

  const saveAndApplyPreset = () => {
    const ratio = parseCropRatioInput(presetDraft);
    if (ratio === null) {
      setPresetError('Enter a ratio like 16:9, 4x5, or 1.85.');
      return;
    }
    saveCustomCropPreset(presetDraft, ratio);
    setCropToolSettings({ aspectPreset: cropCustomPresetValue(ratio) });
    setPresetDraft('');
    setPresetError(null);
  };

  const originalRatioLabel = useMemo(() => {
    if (!activeDoc || activeDoc.width <= 0 || activeDoc.height <= 0) return 'Current document ratio';
    const gcd = greatestCommonDivisor(activeDoc.width, activeDoc.height);
    return `${Math.round(activeDoc.width / gcd)}:${Math.round(activeDoc.height / gcd)}`;
  }, [activeDoc]);
  const rotationDeg = Number.isFinite(settings.rotationDeg) ? settings.rotationDeg : 0;
  const hasEditableTiltmarkSurface = imageDocumentHasEditableTiltmarkSurface(activeDoc);
  const perspectiveAvailability = resolvePerspectiveCropAvailability(activeDoc);

  const applyPerspectiveCrop = useImageEditorStore((state) => state.applyPerspectiveCrop);
  const docWidth = activeDoc?.width ?? 0;
  const docHeight = activeDoc?.height ?? 0;
  // The perspective quad lives in the crop-tool session so the on-canvas overlay and these
  // numeric fields always show the same geometry; editing here drives the canvas preview.
  const [perspectivePreviewVersion, setPerspectivePreviewVersion] = useState(0);
  useEffect(() => subscribePerspectiveCropPreview(() => {
    setPerspectivePreviewVersion((version) => version + 1);
  }), []);
  const livePerspectiveQuad = useMemo(() => {
    void perspectivePreviewVersion;
    return getPerspectiveCropPreview(activeDoc ?? undefined);
  }, [activeDoc, perspectivePreviewVersion]);
  const defaultCorners: PerspectiveCropQuad = [
    { x: 0, y: 0 },
    { x: docWidth, y: 0 },
    { x: docWidth, y: docHeight },
    { x: 0, y: docHeight },
  ];
  const effectiveQuad: PerspectiveCropQuad = livePerspectiveQuad ?? defaultCorners;
  const quadIsLive = livePerspectiveQuad !== null;
  const quadValidity = resolvePerspectiveCropQuadValidity(effectiveQuad);
  const quadIsValid = activeDoc !== null && isPerspectiveCropQuadValid(effectiveQuad);
  const perspectiveOutput = useMemo(
    () => perspectiveCropOutputSize([...effectiveQuad]),
    [effectiveQuad],
  );
  const setCornerCoord = (index: number, axis: 'x' | 'y', value: number) => {
    const next = effectiveQuad.map((corner, i) =>
      i === index ? { ...corner, [axis]: Number.isFinite(value) ? value : corner[axis] } : corner,
    ) as [typeof effectiveQuad[0], typeof effectiveQuad[1], typeof effectiveQuad[2], typeof effectiveQuad[3]];
    if (activeDoc) setPerspectiveCropQuad(next, activeDoc);
  };
  const resetPerspectiveQuad = () => {
    setPerspectiveCropQuad(null);
  };
  const seedFromDocument = () => {
    if (activeDoc) seedPerspectiveCropQuadFromDocument(activeDoc);
  };
  const applyPerspectiveFromSession = () => {
    if (!activeDoc || !quadIsValid) return;
    if (!perspectiveAvailability.available) return;
    applyPerspectiveCrop(activeDoc.id, [...effectiveQuad]);
    setPerspectiveCropQuad(null);
  };
  const cropMode: CropToolMode = settings.mode ?? 'rectangular';
  const setCropMode = (mode: CropToolMode) => {
    reconcileCropPreviewMode(mode);
    setCropToolSettings({ mode });
  };
  const updateRotationDeg = (value: number) => {
    setCropToolSettings({ rotationDeg: clampCropRotationDeg(value) });
  };

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <div>
        <label className="mb-1 block">Crop Mode</label>
        <div className="grid grid-cols-2 gap-1">
          {([['rectangular', 'Rectangular'], ['perspective', 'Perspective']] as const).map(([value, label]) => (
            <button
              key={value}
              className={`rounded border px-2 py-1 text-xs ${
                cropMode === value
                  ? 'border-cyan-400 bg-cyan-400/20 text-cyan-50'
                  : 'border-cyan-300/10 bg-[#252630] text-cyan-100/60 hover:border-cyan-400/40'
              }`}
              onClick={() => setCropMode(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block">Aspect</label>
        <div className="grid grid-cols-3 gap-1">
          {ASPECT_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`rounded border px-2 py-1 text-xs ${
                settings.aspectPreset === option.value
                  ? 'border-cyan-400 bg-cyan-400/20 text-cyan-50'
                  : 'border-cyan-300/10 bg-[#252630] text-cyan-100/60 hover:border-cyan-400/40'
              }`}
              onClick={() => setCropToolSettings({ aspectPreset: option.value })}
              title={option.value === 'original' ? originalRatioLabel : undefined}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1 block">Custom Presets</label>
        {customCropPresets.length > 0 ? (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {customCropPresets.map((preset) => {
              const value = cropCustomPresetValue(preset.ratio);
              const active = settings.aspectPreset === value;
              return (
                <span
                  key={preset.id}
                  className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${
                    active
                      ? 'border-cyan-400 bg-cyan-400/20 text-cyan-50'
                      : 'border-cyan-300/10 bg-[#252630] text-cyan-100/60'
                  }`}
                >
                  <button
                    className="hover:text-cyan-50"
                    onClick={() => setCropToolSettings({ aspectPreset: value })}
                    title={`Apply ${formatCropRatioLabel(preset.ratio)}`}
                    type="button"
                  >
                    {preset.label}
                  </button>
                  <button
                    aria-label={`Delete ${preset.label} crop preset`}
                    className="text-cyan-100/35 hover:text-red-300"
                    onClick={() => deleteCustomCropPreset(preset.id)}
                    type="button"
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] gap-1">
          <input
            aria-label="Custom crop ratio"
            className="min-w-0 rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-cyan-50 placeholder:text-cyan-100/30"
            onChange={(event) => { setPresetDraft(event.target.value); setPresetError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') saveAndApplyPreset(); }}
            placeholder="e.g. 21:9, 4x5, 1.85"
            value={presetDraft}
          />
          <button
            className="rounded border border-cyan-300/15 px-2 py-1 text-[11px] text-cyan-100/70 hover:border-cyan-300/45 hover:text-cyan-50 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!presetDraft.trim()}
            onClick={saveAndApplyPreset}
            type="button"
          >
            Save
          </button>
        </div>
        {presetError ? <p className="mt-1 text-[11px] text-red-300/80">{presetError}</p> : null}
      </div>
      <div>
        <label className="mb-1 block">Guides</label>
        <div className="grid grid-cols-3 gap-1">
          {GUIDE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`rounded border px-2 py-1 text-xs ${
                settings.guideMode === option.value
                  ? 'border-cyan-400 bg-cyan-400/20 text-cyan-50'
                  : 'border-cyan-300/10 bg-[#252630] text-cyan-100/60 hover:border-cyan-400/40'
              }`}
              onClick={() => setCropToolSettings({ guideMode: option.value })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#252630] p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="font-semibold text-cyan-100/70" htmlFor="image-crop-rotation">
            Straighten / Rotate Crop
          </label>
          <button
            className="rounded border border-cyan-300/15 px-2 py-0.5 text-[11px] text-cyan-100/60 hover:border-cyan-300/45 hover:text-cyan-50"
            onClick={() => updateRotationDeg(0)}
            type="button"
          >
            Reset Straighten
          </button>
        </div>
        <div className="grid grid-cols-[1fr_4.5rem] gap-2">
          <input
            aria-label="Crop rotation degrees"
            className="min-w-0 accent-cyan-400"
            id="image-crop-rotation"
            max={MAX_CROP_ROTATION_DEG}
            min={MIN_CROP_ROTATION_DEG}
            onChange={(event) => updateRotationDeg(event.currentTarget.valueAsNumber)}
            step={0.1}
            type="range"
            value={rotationDeg}
          />
          <input
            aria-label="Crop rotation degrees"
            className="w-full rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 text-right text-cyan-50"
            max={MAX_CROP_ROTATION_DEG}
            min={MIN_CROP_ROTATION_DEG}
            onChange={(event) => updateRotationDeg(event.currentTarget.valueAsNumber)}
            step={0.1}
            type="number"
            value={rotationDeg}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-cyan-100/70">
        <input
          aria-label="Delete Cropped Pixels"
          checked={settings.deleteCroppedPixels}
          className="h-3.5 w-3.5 accent-cyan-400"
          disabled={hasEditableTiltmarkSurface}
          onChange={(event) => setCropToolSettings({ deleteCroppedPixels: event.target.checked })}
          type="checkbox"
        />
        <span>Delete Cropped Pixels</span>
      </label>
      <label className="flex items-center gap-2 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-cyan-100/70">
        <input
          aria-label="Content-Aware Fill Crop Corners"
          checked={settings.cornerFillMode === 'content-aware'}
          className="h-3.5 w-3.5 accent-cyan-400"
          disabled={hasEditableTiltmarkSurface}
          onChange={(event) => setCropToolSettings({
            cornerFillMode: event.target.checked ? 'content-aware' : 'transparent',
          })}
          type="checkbox"
        />
        <span>Content-Aware Fill Crop Corners</span>
      </label>
      {settings.cornerFillMode === 'content-aware' ? (
        <p className="rounded border border-amber-300/20 bg-amber-300/5 px-2 py-1.5 text-[11px] text-amber-100/80">
          Applies deterministic local repair to transparent pixels in the active raster layer and bakes the crop into one undoable operation.
        </p>
      ) : null}
      <div className="rounded border border-cyan-300/10 bg-[#23242e] p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-cyan-100/70">Perspective Crop</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] tabular-nums text-cyan-100/45">
              {quadIsValid
                ? `${perspectiveOutput.width} × ${perspectiveOutput.height}px`
                : quadValidity === 'invalid-resource-limit'
                  ? 'Output too large'
                  : 'Adjust the quad'}
            </span>
            <button
              className="rounded border border-cyan-300/10 px-1.5 py-0.5 text-[10px] text-cyan-100/60 hover:border-cyan-400/40"
              onClick={seedFromDocument}
              title="Reset the quad to the document bounds"
              type="button"
            >
              Fit
            </button>
            {quadIsLive ? (
              <button
                className="rounded border border-cyan-300/10 px-1.5 py-0.5 text-[10px] text-cyan-100/60 hover:border-cyan-400/40"
                onClick={resetPerspectiveQuad}
                type="button"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {PERSPECTIVE_CROP_QUAD_LABELS.map((label, index) => (
            <div key={label} className="rounded bg-[#1c1d25] p-1">
              <div className="mb-0.5 text-[10px] text-cyan-100/45">{label}</div>
              <div className="flex gap-1">
                {(['x', 'y'] as const).map((axis) => (
                  <input
                    key={axis}
                    aria-label={`${label} ${axis.toUpperCase()}`}
                    className="w-full rounded border border-cyan-300/10 bg-[#252630] px-1 py-0.5 text-[11px] text-cyan-50"
                    max={PERSPECTIVE_CROP_MAX_ABS_COORDINATE}
                    min={-PERSPECTIVE_CROP_MAX_ABS_COORDINATE}
                    onChange={(event) => setCornerCoord(index, axis, Math.round(Number(event.target.value)))}
                    type="number"
                    value={Math.round(effectiveQuad[index][axis])}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          className="mt-1.5 w-full rounded border border-cyan-400/40 bg-cyan-400/15 px-2 py-1 text-xs text-cyan-50 enabled:hover:bg-cyan-400/25 disabled:opacity-40"
          disabled={!activeDoc || !quadIsValid || !perspectiveAvailability.available}
          onClick={applyPerspectiveFromSession}
          type="button"
        >
          Apply Perspective Crop
        </button>
        {perspectiveAvailability.refusal === 'high-bit-depth-requires-native-crop' ? (
          <p className="mt-1 rounded border border-fuchsia-300/20 bg-fuchsia-500/5 px-2 py-1.5 text-[10px] leading-tight text-fuchsia-100/75">
            Refused before mutation: Perspective Crop has no native high-bit implementation. The
            8-bit display proxy would lose precision; no pixels were changed.
          </p>
        ) : null}
        <p className="mt-1 text-[10px] leading-tight text-cyan-100/40">
          Drag the four corner handles on the canvas (Perspective mode) or type exact coordinates;
          Enter applies, Esc cancels. The marked quad is rectified into a straight rectangle and
          the document is flattened into one raster layer.
        </p>
      </div>
      {hasEditableTiltmarkSurface ? (
        <p className="rounded border border-fuchsia-300/20 bg-fuchsia-500/5 px-2 py-1.5 text-fuchsia-100/70">
          Editable Tiltmark surfaces support non-destructive crop framing. Delete Cropped Pixels
          and Perspective Crop require an explicit Convert to Raster action first.
        </p>
      ) : null}
      <p className="text-cyan-100/35">
        Drag to place the crop. Enter applies, Esc cancels, and the on-canvas controls stay with the crop box.
        Rotate the crop to straighten tilted artwork before committing.
        Leave cropped pixels off to keep hidden image data for later reframing.
        Perspective mode overlays a draggable four-corner quad whose projected guides preview the
        rectified result; committing flattens the document into one straightened raster layer
        (content-aware corner fill still remains a planning-only warning for rotated empty corners).
      </p>
    </div>
  );
}

function clampCropRotationDeg(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(MIN_CROP_ROTATION_DEG, Math.min(MAX_CROP_ROTATION_DEG, value));
  const rounded = Math.round(clamped * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.max(1, Math.round(Math.abs(a)));
  let y = Math.max(1, Math.round(Math.abs(b)));
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x || 1;
}
