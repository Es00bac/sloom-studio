import { useEffect, useMemo, useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { cloneBitmap } from './LayerBitmap';
import { imageCmykDocumentUsesNativeAuthority } from './cmyk/ImageCmykDocument';
import {
  applyLiquifyToBitmap,
  buildLiquifyWorkspaceUiDescriptor,
  type ImageLiquifyFalloff,
  type ImageLiquifyMode,
  type ImageLiquifyOptions,
} from './ImageLiquify';

const LIQUIFY_FALLOFF_MODES: ImageLiquifyFalloff[] = ['quadratic', 'linear', 'constant'];

export function ImageLiquifyWorkspacePanel() {
  const documents = useImageEditorStore((state) => state.documents);
  const activeDocId = useImageEditorStore((state) => state.activeDocId);
  const pushOperation = useImageEditorStore((state) => state.pushOperation);
  const updateLayer = useImageEditorStore((state) => state.updateLayer);
  const document = documents.find((candidate) => candidate.id === activeDocId) ?? null;
  const layer = document?.layers.find((candidate) => candidate.id === document.activeLayerId) ?? null;
  const canUseActiveLayer = isLiquifyPixelLayer(layer);
  const defaultCenter = getDefaultLiquifyCenter(document?.width ?? 1, document?.height ?? 1, layer);
  const [mode, setMode] = useState<ImageLiquifyMode>('push');
  const [radius, setRadius] = useState(32);
  const [strength, setStrength] = useState(0.5);
  const [falloff, setFalloff] = useState<ImageLiquifyFalloff>('quadratic');
  const [centerX, setCenterX] = useState(defaultCenter.x);
  const [centerY, setCenterY] = useState(defaultCenter.y);
  const [previewActive, setPreviewActive] = useState(false);

  useEffect(() => {
    setCenterX(defaultCenter.x);
    setCenterY(defaultCenter.y);
    setPreviewActive(false);
  }, [defaultCenter.x, defaultCenter.y, document?.id, layer?.id]);

  const options = useMemo<ImageLiquifyOptions>(() => ({
    mode,
    center: { x: centerX, y: centerY },
    radius,
    strength,
    falloff,
    previewScale: 1,
    direction: { x: 1, y: 0 },
  }), [centerX, centerY, falloff, mode, radius, strength]);

  const descriptor = useMemo(() => buildLiquifyWorkspaceUiDescriptor(options, {
    documentId: document?.id ?? 'no-document',
    layerId: layer?.id ?? 'no-layer',
    sourceKind: layer?.metadata?.sourceLink ? 'source-linked-layer' : 'bitmap-layer',
    hasActivePixelLayer: canUseActiveLayer,
    hasPreviewSession: canUseActiveLayer,
    preserveSmartObjects: Boolean(layer?.metadata?.sourceLink),
    requestedModes: [mode, 'reconstruct', 'smooth'],
    requestedFaceAware: true,
    requestedNonDestructiveMesh: true,
  }), [canUseActiveLayer, document?.id, layer?.id, layer?.metadata?.sourceLink, mode, options]);

  const applyPreview = () => {
    if (!document || !isLiquifyPixelLayer(layer) || !descriptor.commands.apply.enabled) return;
    if (imageCmykDocumentUsesNativeAuthority(document)) {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sloom-cmyk-tool-refused', {
        detail: { tool: 'liquify', disclosure: 'Liquify is refused for native CMYK because it only deforms the RGB display proxy; no ink authority or history was changed.' },
      }));
      return;
    }
    const before = cloneBitmap(layer.bitmap);
    const after = cloneBitmap(layer.bitmap);
    applyLiquifyToBitmap(after, options);
    pushOperation({
      kind: 'paint',
      docId: document.id,
      layerId: layer.id,
      before,
      after,
    });
    updateLayer(document.id, layer.id, { bitmap: after });
    setPreviewActive(false);
  };

  return (
    <section
      className="mt-4 space-y-3 rounded border border-cyan-300/15 bg-[#10131b] p-3 text-xs text-cyan-100/65"
      data-image-liquify-preview-active={previewActive ? 'true' : 'false'}
      data-image-liquify-workspace-panel="true"
      data-image-liquify-workspace-signature={descriptor.signature}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
            Liquify Workspace
          </h3>
          <p className="mt-1 text-[11px] text-cyan-100/45">
            Local bitmap deformation with preview, apply, cancel, and explicit unsupported Photoshop controls.
          </p>
        </div>
        <span
          className={`rounded border px-2 py-1 text-[10px] font-semibold uppercase ${
            canUseActiveLayer
              ? 'border-emerald-300/30 text-emerald-200'
              : 'border-amber-300/30 text-amber-200'
          }`}
        >
          {canUseActiveLayer ? 'Ready' : 'Select pixels'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1">
        {descriptor.modeControls.map((control) => (
          <button
            className={`h-8 border text-[11px] ${
              mode === control.mode
                ? 'border-cyan-200 bg-cyan-300 text-slate-950'
                : 'border-cyan-300/15 bg-[#151720] text-cyan-100/70 hover:bg-cyan-400/10'
            }`}
            data-image-liquify-mode={control.mode}
            key={control.mode}
            onClick={() => {
              setMode(control.mode);
              setPreviewActive(false);
            }}
            type="button"
          >
            {control.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberControl
          ariaLabel="Liquify center X"
          label="Center X"
          max={document?.width ?? 1}
          min={0}
          onChange={(value) => {
            setCenterX(value);
            setPreviewActive(false);
          }}
          step={1}
          value={centerX}
        />
        <NumberControl
          ariaLabel="Liquify center Y"
          label="Center Y"
          max={document?.height ?? 1}
          min={0}
          onChange={(value) => {
            setCenterY(value);
            setPreviewActive(false);
          }}
          step={1}
          value={centerY}
        />
        <NumberControl
          ariaLabel="Liquify radius"
          label="Radius"
          max={descriptor.brushControls.radius.max}
          min={descriptor.brushControls.radius.min}
          onChange={(value) => {
            setRadius(value);
            setPreviewActive(false);
          }}
          step={descriptor.brushControls.radius.step}
          value={radius}
        />
        <NumberControl
          ariaLabel="Liquify strength"
          label="Strength"
          max={descriptor.brushControls.strength.max}
          min={descriptor.brushControls.strength.min}
          onChange={(value) => {
            setStrength(value);
            setPreviewActive(false);
          }}
          step={descriptor.brushControls.strength.step}
          value={strength}
        />
      </div>

      <label className="block space-y-1">
        <span>Falloff</span>
        <select
          aria-label="Liquify falloff"
          className="w-full rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 text-cyan-100"
          onChange={(event) => {
            setFalloff(event.target.value as ImageLiquifyFalloff);
            setPreviewActive(false);
          }}
          value={falloff}
        >
          {LIQUIFY_FALLOFF_MODES.map((candidate) => (
            <option key={candidate} value={candidate}>
              {formatLiquifyLabel(candidate)}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-3 gap-1">
        <button
          className="h-8 border border-cyan-300/20 bg-cyan-400/10 text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!descriptor.commands.preview.enabled}
          onClick={() => setPreviewActive(true)}
          type="button"
        >
          Preview
        </button>
        <button
          className="h-8 border border-emerald-300/25 bg-emerald-400/12 text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!descriptor.commands.apply.enabled}
          onClick={applyPreview}
          type="button"
        >
          Apply
        </button>
        <button
          className="h-8 border border-cyan-300/15 bg-[#151720] text-cyan-100/70"
          onClick={() => setPreviewActive(false)}
          type="button"
        >
          Cancel
        </button>
      </div>

      <div className="rounded border border-cyan-300/10 bg-black/20 p-2 font-mono text-[10px] text-cyan-100/45">
        <div>Preview: {descriptor.preview.signature}</div>
        <div>Apply: {descriptor.commands.apply.enabled ? 'ready' : 'blocked'}</div>
        <div>
          Freeze/Thaw: {descriptor.freezeThawControls.effectiveFrozenPixelCount} frozen ·{' '}
          {descriptor.freezeThawControls.thawedPixelCount} thawed
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/55">
          Unsupported controls
        </div>
        <div className="flex flex-wrap gap-1">
          {descriptor.unsupportedControls.map((control) => (
            <span
              className="rounded border border-amber-300/20 px-2 py-1 text-[10px] text-amber-100/80"
              data-image-liquify-unsupported-control={control.feature}
              key={control.feature}
              title={control.fallback}
            >
              {control.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function NumberControl({
  ariaLabel,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  ariaLabel: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <label className="block space-y-1">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        className="w-full rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 font-mono text-cyan-100"
        max={max}
        min={min}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

function isLiquifyPixelLayer(layer: ImageLayer | null): layer is ImageLayer & { bitmap: LayerBitmap } {
  return Boolean(layer && layer.type === 'image' && layer.bitmap && !layer.locked && !layer.locks?.pixels);
}

function getDefaultLiquifyCenter(documentWidth: number, documentHeight: number, layer: ImageLayer | null) {
  const width = layer?.bitmap?.width ?? documentWidth;
  const height = layer?.bitmap?.height ?? documentHeight;
  return {
    x: Math.max(0, Math.floor(width / 2)),
    y: Math.max(0, Math.floor(height / 2)),
  };
}

function formatLiquifyLabel(value: string): string {
  return value.replace(/(^|-)([a-z])/g, (_match, separator: string, letter: string) =>
    `${separator ? ' ' : ''}${letter.toUpperCase()}`,
  );
}
