import { Eye, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageDocument } from '../../types/imageEditor';
import { renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';
import { getBitmapImageData } from './LayerBitmap';
import {
  ImageMultiShotCancelledError,
  openImageMultiShotResult,
  paintImageMultiShotPreview,
  runImageMultiShotStack,
  validateImageMultiShotSelections,
  type ImageMultiShotMode,
  type ImageMultiShotResult,
  type ImageMultiShotSource,
} from './ImageMultiShotStacking';

const MODE_COPY: Record<ImageMultiShotMode, { label: string; detail: string }> = {
  hdr: {
    label: 'HDR merge',
    detail: 'Fuses usable exposure regions. It does not perform blind averaging or HDR file interchange.',
  },
  panorama: {
    label: 'Panorama stitch',
    detail: 'Measures bounded translation overlap and feather-blends seams. It refuses featureless or weak-overlap input.',
  },
  focus: {
    label: 'Focus stack',
    detail: 'Chooses locally sharper regions with a one-pixel seam cleanup. It does not infer missing focus detail.',
  },
};

function collectSources(documents: readonly ImageDocument[], selectedIds: ReadonlySet<string>): ImageMultiShotSource[] {
  return documents
    .filter((document) => selectedIds.has(document.id))
    .map((document) => {
      const bitmap = renderImageDocumentLayersToBitmap(document);
      const imageData = getBitmapImageData(bitmap);
      return {
        id: document.id,
        title: document.title,
        pixels: {
          width: imageData.width,
          height: imageData.height,
          data: new Uint8ClampedArray(imageData.data),
        },
        bitDepth: document.metadata?.sourceBitDepth ?? 8,
      };
    });
}

export function ImageMultiShotStackingPanel() {
  const subscribedDocuments = useImageEditorStore((state) => state.documents);
  const subscribedActiveDocId = useImageEditorStore((state) => state.activeDocId);
  // Keep static/pre-rendered dock panels on the current store snapshot while the subscriptions
  // still make a mounted panel react to tabs opening, closing, and changing.
  const snapshot = useImageEditorStore.getState();
  const documents = snapshot.documents.length > 0 ? snapshot.documents : subscribedDocuments;
  const activeDocId = snapshot.activeDocId ?? subscribedActiveDocId;
  const [mode, setMode] = useState<ImageMultiShotMode>('hdr');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(activeDocId ? [activeDocId] : []));
  const [result, setResult] = useState<ImageMultiShotResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const selectedDocuments = useMemo(
    () => documents.filter((document) => selectedIds.has(document.id)),
    [documents, selectedIds],
  );
  const lightweightSources = useMemo(
    () => selectedDocuments.map((document) => ({
      id: document.id,
      title: document.title,
      width: document.width,
      height: document.height,
      bitDepth: document.metadata?.sourceBitDepth ?? 8,
    })),
    [selectedDocuments],
  );
  const validation = validateImageMultiShotSelections(mode, lightweightSources);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !result) return;
    canvas.width = result.pixels.width;
    canvas.height = result.pixels.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    paintImageMultiShotPreview(context, result);
  }, [result]);

  const toggleDocument = (id: string) => {
    setResult(null);
    setNotice(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const preview = async () => {
    if (validation || busy) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setNotice(null);
    setResult(null);
    try {
      // Yield first so a cancel click can win before a bounded CPU pass starts.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const sources = collectSources(useImageEditorStore.getState().documents, selectedIds);
      const next = runImageMultiShotStack(mode, sources, controller.signal);
      if (!controller.signal.aborted) {
        setResult(next);
        setNotice(next.description);
      }
    } catch (error) {
      setNotice(error instanceof ImageMultiShotCancelledError
        ? 'Preview cancelled. Source documents were not changed.'
        : error instanceof Error ? error.message : 'The stack preview could not be created.');
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
    }
  };

  const cancel = () => controllerRef.current?.abort();

  const createDocument = () => {
    if (!result || busy) return;
    const doc = openImageMultiShotResult(result);
    setNotice(`Opened editable “${doc.title}”. Undo removes the generated layer; redo restores it.`);
  };

  return (
    <section className="mt-3 rounded border border-cyan-300/10 bg-[#10131b] p-2" data-image-multi-shot-stacking="ready">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/65">Multi-shot stack</div>
        <span className="text-[10px] text-emerald-200/70">local CPU · bounded</span>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-cyan-100/45">
        Choose two to six compatible open Image documents. Previews are disposable; sources remain unchanged until you explicitly create a new editable Image document.
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1" role="group" aria-label="Multi-shot stack mode">
        {(Object.keys(MODE_COPY) as ImageMultiShotMode[]).map((candidate) => (
          <button
            aria-pressed={mode === candidate}
            className={`rounded border px-1.5 py-1 text-[10px] font-semibold ${mode === candidate
              ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-50'
              : 'border-cyan-300/10 text-cyan-100/55 hover:border-cyan-300/25 hover:text-cyan-100'}`}
            key={candidate}
            onClick={() => { setMode(candidate); setResult(null); setNotice(null); }}
            type="button"
          >
            {MODE_COPY[candidate].label}
          </button>
        ))}
      </div>
      <div className="mt-2 space-y-1" data-image-multi-shot-sources>
        {documents.map((document) => (
          <label className="flex items-center justify-between gap-2 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-[10px] text-cyan-100/65" key={document.id}>
            <span className="min-w-0 truncate">{document.title} · {document.width}×{document.height}</span>
            <input
              aria-label={`Use ${document.title} in multi-shot stack`}
              checked={selectedIds.has(document.id)}
              onChange={() => toggleDocument(document.id)}
              type="checkbox"
            />
          </label>
        ))}
        {documents.length === 0 ? <div className="text-[10px] text-cyan-100/35">Open compatible source images first.</div> : null}
      </div>
      <p className={`mt-2 text-[10px] leading-4 ${validation ? 'text-amber-200/80' : 'text-cyan-100/45'}`} data-image-multi-shot-boundary>
        {validation ?? MODE_COPY[mode].detail}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <button
          aria-label="Preview multi-shot stack"
          className="inline-flex items-center justify-center gap-1 rounded border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold text-cyan-50 hover:border-cyan-300/45 disabled:cursor-not-allowed disabled:opacity-35"
          disabled={Boolean(validation) || busy}
          onClick={() => void preview()}
          type="button"
        ><Eye size={11} /> {busy ? 'Preparing…' : 'Preview'}</button>
        {busy ? (
          <button aria-label="Cancel multi-shot stack" className="inline-flex items-center justify-center gap-1 rounded border border-rose-300/20 bg-rose-400/10 px-2 py-1 text-[10px] font-semibold text-rose-100 hover:border-rose-300/45" onClick={cancel} type="button"><X size={11} /> Cancel</button>
        ) : (
          <button aria-label="Create editable multi-shot image" className="inline-flex items-center justify-center gap-1 rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-100 hover:border-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-35" disabled={!result} onClick={createDocument} type="button"><Plus size={11} /> Create image</button>
        )}
      </div>
      {result ? (
        <div className="mt-2 rounded border border-cyan-300/10 bg-[#070b12] p-1.5" data-image-multi-shot-preview>
          <canvas aria-label="Multi-shot stack preview" className="max-h-36 w-full object-contain" ref={previewCanvasRef} />
          <div className="mt-1 text-[10px] text-cyan-100/45">{result.pixels.width}×{result.pixels.height} · {result.description}</div>
        </div>
      ) : null}
      {notice ? <div className="mt-2 text-[10px] leading-4 text-cyan-100/60" role="status">{notice}</div> : null}
    </section>
  );
}
