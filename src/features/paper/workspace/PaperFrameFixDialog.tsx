import React from 'react';
import { LoaderCircle, Sparkles, X } from 'lucide-react';
import { useSettingsStore } from '../../../store/settingsStore';
import { runGenerativeFill } from '../../../lib/imageEditorAi';
import { getConfiguredImageProviders, getModelsForOperation } from '../../../components/ImageEditor/GenerativeFillBar';
import {
  buildFrameFixPrompt,
  buildFrameFixReferences,
  normalizeFrameFixMarquee,
  type FrameFixMarqueeRect,
  type FrameFixSiblingCandidate,
} from '../../../lib/paperFrameFix';

export interface PaperFrameFixDialogProps {
  frameLabel: string;
  /** Data/blob URL of the frame's current art. */
  frameImageUrl: string;
  siblings: FrameFixSiblingCandidate[];
  onApply: (resultDataUrl: string) => void;
  onClose: () => void;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the fixed image.'));
    reader.readAsDataURL(blob);
  });
}

/** White-on-transparent mask PNG: full frame, or just the marquee region. */
async function buildMaskBlob(
  imageUrl: string,
  marquee: FrameFixMarqueeRect | null,
): Promise<{ mask: Blob; source: Blob }> {
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Could not load the frame art.'));
    image.src = imageUrl;
  });

  const width = Math.max(1, image.naturalWidth);
  const height = Math.max(1, image.naturalHeight);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  sourceCanvas.getContext('2d')!.drawImage(image, 0, 0);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.fillStyle = '#ffffff';
  if (marquee) {
    maskCtx.fillRect(
      (marquee.xPercent / 100) * width,
      (marquee.yPercent / 100) * height,
      (marquee.widthPercent / 100) * width,
      (marquee.heightPercent / 100) * height,
    );
  } else {
    maskCtx.fillRect(0, 0, width, height);
  }

  const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Encoding failed.'))), 'image/png');
  });
  return { mask: await toBlob(maskCanvas), source: await toBlob(sourceCanvas) };
}

export const PaperFrameFixDialog: React.FC<PaperFrameFixDialogProps> = ({
  frameLabel,
  frameImageUrl,
  siblings,
  onApply,
  onClose,
}) => {
  const apiKeys = useSettingsStore((state) => state.apiKeys);
  const providerSettings = useSettingsStore((state) => state.providerSettings);

  const configuredProviders = React.useMemo(
    () => getConfiguredImageProviders(apiKeys, providerSettings),
    [apiKeys, providerSettings],
  );
  const modelOptions = React.useMemo(
    () => getModelsForOperation(configuredProviders, 'inpaint'),
    [configuredProviders],
  );

  const [modelKey, setModelKey] = React.useState('');
  const selectedModel = modelOptions.find((entry) => `${entry.providerId}:${entry.modelId}` === modelKey)
    ?? modelOptions[0];
  const [selectedSiblingIds, setSelectedSiblingIds] = React.useState<string[]>(
    () => siblings.slice(0, 2).map((sibling) => sibling.frameId),
  );
  const [correctDescription, setCorrectDescription] = React.useState('');
  const [incorrectDescription, setIncorrectDescription] = React.useState('');
  const [marquee, setMarquee] = React.useState<FrameFixMarqueeRect | null>(null);
  const dragStartRef = React.useRef<{ xPercent: number; yPercent: number } | null>(null);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resultDataUrl, setResultDataUrl] = React.useState<string | null>(null);

  const previewRef = React.useRef<HTMLDivElement | null>(null);

  const pointerPercent = (event: React.PointerEvent): { xPercent: number; yPercent: number } => {
    const bounds = previewRef.current!.getBoundingClientRect();
    return {
      xPercent: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100,
      yPercent: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100,
    };
  };

  const runFix = async () => {
    if (!selectedModel || running) {
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const { mask, source } = await buildMaskBlob(frameImageUrl, marquee);
      const selectedSiblings = siblings.filter((sibling) => selectedSiblingIds.includes(sibling.frameId));
      const result = await runGenerativeFill({
        source,
        mask,
        prompt: buildFrameFixPrompt({
          correctDescription,
          incorrectDescription,
          referenceCount: selectedSiblings.length,
        }),
        provider: selectedModel.providerId,
        model: selectedModel.modelId,
        operation: 'inpaint',
        references: buildFrameFixReferences(selectedSiblings),
      });
      setResultDataUrl(await blobToDataUrl(result.png));
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'The frame fix failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60" data-paper-frame-fix-dialog="true">
      <div className="mx-4 flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-2xl border border-gray-700/70 bg-[#10141d] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-base font-semibold text-gray-100">
            <Sparkles className="text-cyan-300" size={16} />
            AI Fix Frame — {frameLabel}
          </div>
          <button className="rounded-md p-1 text-gray-400 hover:bg-gray-700 hover:text-white" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {resultDataUrl ? 'Fixed result' : 'This frame — drag to fix only a region'}
            </div>
            <div
              className="relative cursor-crosshair select-none overflow-hidden rounded-lg border border-gray-700/60"
              ref={previewRef}
              onPointerDown={(event) => {
                if (resultDataUrl) return;
                dragStartRef.current = pointerPercent(event);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!dragStartRef.current || resultDataUrl) return;
                setMarquee(normalizeFrameFixMarquee(dragStartRef.current, pointerPercent(event)));
              }}
              onPointerUp={() => {
                dragStartRef.current = null;
              }}
            >
              <img alt={frameLabel} className="block w-full" draggable={false} src={resultDataUrl ?? frameImageUrl} />
              {!resultDataUrl && marquee ? (
                <div
                  className="pointer-events-none absolute border-2 border-cyan-300/90 bg-cyan-400/15"
                  style={{
                    left: `${marquee.xPercent}%`,
                    top: `${marquee.yPercent}%`,
                    width: `${marquee.widthPercent}%`,
                    height: `${marquee.heightPercent}%`,
                  }}
                />
              ) : null}
            </div>
            {!resultDataUrl && marquee ? (
              <button className="mt-1.5 text-[11px] text-gray-400 hover:text-gray-200" onClick={() => setMarquee(null)} type="button">
                Clear region — fix the whole frame
              </button>
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            {siblings.length > 0 ? (
              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  Correct examples from this page
                </div>
                <div className="flex flex-wrap gap-2">
                  {siblings.map((sibling) => {
                    const selected = selectedSiblingIds.includes(sibling.frameId);
                    return (
                      <button
                        key={sibling.frameId}
                        className={`relative h-16 w-16 overflow-hidden rounded-md border-2 transition-colors ${
                          selected ? 'border-cyan-300' : 'border-gray-700/60 opacity-60 hover:opacity-100'
                        }`}
                        onClick={() => setSelectedSiblingIds((current) => (
                          selected ? current.filter((id) => id !== sibling.frameId) : [...current, sibling.frameId]
                        ))}
                        title={sibling.label}
                        type="button"
                      >
                        <img alt={sibling.label} className="h-full w-full object-cover" src={sibling.imageUrl} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              What SHOULD it look like?
              <textarea
                className="h-16 resize-none rounded-lg border border-gray-700/70 bg-[#0b0f16] p-2 text-sm normal-case tracking-normal text-gray-200 outline-none focus:border-cyan-400/50"
                onChange={(event) => setCorrectDescription(event.target.value)}
                placeholder="e.g. Wren has a scar over her LEFT eye and copper hair"
                value={correctDescription}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              What is WRONG in this frame?
              <textarea
                className="h-16 resize-none rounded-lg border border-gray-700/70 bg-[#0b0f16] p-2 text-sm normal-case tracking-normal text-gray-200 outline-none focus:border-cyan-400/50"
                onChange={(event) => setIncorrectDescription(event.target.value)}
                placeholder="e.g. the scar is on the wrong eye and the hair is brown"
                value={incorrectDescription}
              />
            </label>

            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Edit model
              <select
                className="rounded-lg border border-gray-700/70 bg-[#0b0f16] p-2 text-sm normal-case tracking-normal text-gray-200"
                onChange={(event) => setModelKey(event.target.value)}
                value={selectedModel ? `${selectedModel.providerId}:${selectedModel.modelId}` : ''}
              >
                {modelOptions.map((entry) => (
                  <option key={`${entry.providerId}:${entry.modelId}`} value={`${entry.providerId}:${entry.modelId}`}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            {modelOptions.length === 0 ? (
              <div className="text-xs text-amber-200/90">
                No edit-capable image model is configured — add a provider key in Settings.
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</div>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          {resultDataUrl ? (
            <>
              <button
                className="rounded-lg border border-gray-700/70 px-3 py-2 text-sm font-semibold text-gray-300 hover:text-white"
                onClick={() => setResultDataUrl(null)}
                type="button"
              >
                Try again
              </button>
              <button
                className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 hover:border-emerald-300/70"
                data-paper-frame-fix-apply="true"
                onClick={() => onApply(resultDataUrl)}
                type="button"
              >
                Apply to frame
              </button>
            </>
          ) : (
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 hover:border-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={running || !selectedModel || (!correctDescription.trim() && !incorrectDescription.trim())}
              onClick={() => void runFix()}
              type="button"
            >
              {running ? <LoaderCircle className="animate-spin" size={14} /> : <Sparkles size={14} />}
              {running ? 'Fixing…' : marquee ? 'Fix selected region' : 'Fix frame'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
