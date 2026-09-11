import { useMemo, useState } from 'react';
import type { PaperBackgroundSpec, PaperFrame } from '../../../types/paper';

export type PaperHaneBlankBackground = 'transparent' | 'white' | 'paper';

export interface PaperHaneBlankImageSpec {
  label: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  background: PaperHaneBlankBackground;
}

const MAX_DIMENSION_PX = 16_384;
const MAX_PIXEL_COUNT = 64_000_000;

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function defaultPaperHaneBlankImageSpec(
  frame: Pick<PaperFrame, 'label' | 'widthMm' | 'heightMm'>,
  documentDpi: number,
): PaperHaneBlankImageSpec {
  const dpi = boundedInteger(documentDpi, 36, 1_200);
  return {
    label: frame.label.trim() || 'Untitled illustration',
    widthPx: boundedInteger((frame.widthMm / 25.4) * dpi, 1, MAX_DIMENSION_PX),
    heightPx: boundedInteger((frame.heightMm / 25.4) * dpi, 1, MAX_DIMENSION_PX),
    dpi,
    background: 'transparent',
  };
}

export function paperHaneBlankImageValidationError(
  spec: PaperHaneBlankImageSpec,
): string | null {
  if (!spec.label.trim()) return 'Enter a name for the new illustration.';
  if (!Number.isInteger(spec.widthPx) || spec.widthPx < 1 || spec.widthPx > MAX_DIMENSION_PX) {
    return `Width must be between 1 and ${MAX_DIMENSION_PX.toLocaleString()} pixels.`;
  }
  if (!Number.isInteger(spec.heightPx) || spec.heightPx < 1 || spec.heightPx > MAX_DIMENSION_PX) {
    return `Height must be between 1 and ${MAX_DIMENSION_PX.toLocaleString()} pixels.`;
  }
  if (spec.widthPx * spec.heightPx > MAX_PIXEL_COUNT) {
    return 'The new illustration must contain no more than 64 million pixels.';
  }
  if (!Number.isInteger(spec.dpi) || spec.dpi < 36 || spec.dpi > 1_200) {
    return 'Resolution must be between 36 and 1,200 pixels per inch.';
  }
  return null;
}

export function createPaperHaneBlankImageDataUrl(
  spec: PaperHaneBlankImageSpec,
  paperBackground: PaperBackgroundSpec,
): string {
  const validationError = paperHaneBlankImageValidationError(spec);
  if (validationError) throw new Error(validationError);
  if (typeof document === 'undefined') {
    throw new Error('A browser canvas is required to create the new illustration.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = spec.widthPx;
  canvas.height = spec.heightPx;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This device could not create the new illustration canvas.');
  if (spec.background !== 'transparent') {
    if (spec.background === 'white' || paperBackground.type === 'solid') {
      context.fillStyle = spec.background === 'white' ? '#ffffff' : paperBackground.color;
    } else if (paperBackground.type === 'linear-gradient') {
      const angle = (paperBackground.angleDeg * Math.PI) / 180;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const radius = Math.abs(canvas.width * Math.cos(angle))
        + Math.abs(canvas.height * Math.sin(angle));
      const gradient = context.createLinearGradient(
        centerX - (Math.cos(angle) * radius) / 2,
        centerY - (Math.sin(angle) * radius) / 2,
        centerX + (Math.cos(angle) * radius) / 2,
        centerY + (Math.sin(angle) * radius) / 2,
      );
      gradient.addColorStop(0, paperBackground.fromColor);
      gradient.addColorStop(1, paperBackground.toColor);
      context.fillStyle = gradient;
    } else {
      const gradient = context.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        0,
        canvas.width / 2,
        canvas.height / 2,
        Math.max(canvas.width, canvas.height) / 2,
      );
      gradient.addColorStop(0, paperBackground.fromColor);
      gradient.addColorStop(1, paperBackground.toColor);
      context.fillStyle = gradient;
    }
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL('image/png');
}

export function PaperHaneBlankImageDialog({
  busy,
  documentDpi,
  frame,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  documentDpi: number;
  frame: Pick<PaperFrame, 'label' | 'widthMm' | 'heightMm'>;
  onCancel: () => void;
  onCreate: (spec: PaperHaneBlankImageSpec) => void;
}) {
  const initial = useMemo(
    () => defaultPaperHaneBlankImageSpec(frame, documentDpi),
    [documentDpi, frame],
  );
  const [spec, setSpec] = useState(initial);
  const validationError = paperHaneBlankImageValidationError(spec);

  const updateNumber = (
    field: 'widthPx' | 'heightPx' | 'dpi',
    value: string,
  ) => {
    setSpec((current) => ({
      ...current,
      [field]: value === '' ? 0 : Math.round(Number(value)),
    }));
  };

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[410] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      data-paper-hane-blank-image-dialog="true"
      role="dialog"
    >
      <form
        className="w-full max-w-md rounded-2xl border border-cyan-300/25 bg-[#0b121d] p-5 text-sm text-cyan-50 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !validationError) onCreate({ ...spec, label: spec.label.trim() });
        }}
      >
        <h2 className="text-lg font-semibold text-white">Create Image for Hane Mobile</h2>
        <p className="mt-1 text-xs leading-relaxed text-cyan-100/65">
          This blank image will be placed in the selected Paper frame, opened in Hane, and
          refreshed here as a flattened image while you draw.
        </p>

        <label className="mt-4 block text-xs font-semibold text-cyan-100/80">
          Image name
          <input
            autoFocus
            className="mt-1 w-full rounded-md border border-cyan-300/25 bg-slate-950/70 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
            disabled={busy}
            onChange={(event) => setSpec((current) => ({ ...current, label: event.target.value }))}
            value={spec.label}
          />
        </label>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <label className="text-xs font-semibold text-cyan-100/80">
            Width (px)
            <input
              className="mt-1 w-full rounded-md border border-cyan-300/25 bg-slate-950/70 px-2 py-2 text-white outline-none focus:border-cyan-300/60"
              disabled={busy}
              inputMode="numeric"
              min={1}
              max={MAX_DIMENSION_PX}
              onChange={(event) => updateNumber('widthPx', event.target.value)}
              type="number"
              value={spec.widthPx || ''}
            />
          </label>
          <label className="text-xs font-semibold text-cyan-100/80">
            Height (px)
            <input
              className="mt-1 w-full rounded-md border border-cyan-300/25 bg-slate-950/70 px-2 py-2 text-white outline-none focus:border-cyan-300/60"
              disabled={busy}
              inputMode="numeric"
              min={1}
              max={MAX_DIMENSION_PX}
              onChange={(event) => updateNumber('heightPx', event.target.value)}
              type="number"
              value={spec.heightPx || ''}
            />
          </label>
          <label className="text-xs font-semibold text-cyan-100/80">
            Resolution
            <input
              className="mt-1 w-full rounded-md border border-cyan-300/25 bg-slate-950/70 px-2 py-2 text-white outline-none focus:border-cyan-300/60"
              disabled={busy}
              inputMode="numeric"
              min={36}
              max={1_200}
              onChange={(event) => updateNumber('dpi', event.target.value)}
              type="number"
              value={spec.dpi || ''}
            />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-cyan-100/50">
          Resolution is pixels per inch; the starting pixel dimensions match this frame at the
          Paper document’s current print resolution.
        </p>

        <label className="mt-3 block text-xs font-semibold text-cyan-100/80">
          Background
          <select
            className="mt-1 w-full rounded-md border border-cyan-300/25 bg-slate-950 px-3 py-2 text-white outline-none focus:border-cyan-300/60"
            disabled={busy}
            onChange={(event) => setSpec((current) => ({
              ...current,
              background: event.target.value as PaperHaneBlankBackground,
            }))}
            value={spec.background}
          >
            <option value="transparent">Transparent</option>
            <option value="white">White</option>
            <option value="paper">Paper background</option>
          </select>
        </label>

        <div className="mt-4 min-h-5 text-xs text-amber-200" role="status">
          {validationError ?? (busy ? 'Sending the new image to Hane…' : '')}
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button
            className="rounded-md border border-slate-400/25 px-3 py-2 text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-md border border-cyan-300/40 bg-cyan-400/15 px-3 py-2 font-semibold text-cyan-50 hover:bg-cyan-400/25 disabled:opacity-50"
            disabled={busy || Boolean(validationError)}
            type="submit"
          >
            {busy ? 'Opening in Hane…' : 'Create & Open in Hane'}
          </button>
        </div>
      </form>
    </div>
  );
}
