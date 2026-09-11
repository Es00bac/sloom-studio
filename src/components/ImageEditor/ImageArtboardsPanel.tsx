import { Download, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import type {
  ImageArtboardMetadata,
  ImageArtboardPagePreset,
  ImageArtboardsMetadata,
  ImageDocument,
} from '../../types/imageEditor';
import {
  applyImageArtboardsMetadata,
  buildImageArtboardsPrintExportReadiness,
  buildImageArtboardsPrintStatus,
  createImageArtboardFromDocument,
  getImageArtboardsMetadata,
  IMAGE_ARTBOARD_PAGE_PRESETS,
} from './ImageArtboards';
import { exportImageArtboardsToPng } from './ImageArtboardRasterExport';

export function ImageArtboardsPanel() {
  const subscribedActiveDoc = useImageEditorStore((s) =>
    s.documents.find((document) => document.id === s.activeDocId) ?? null,
  );
  const stateSnapshot = useImageEditorStore.getState();
  const activeDoc = subscribedActiveDoc
    ?? stateSnapshot.documents.find((document) => document.id === stateSnapshot.activeDocId)
    ?? null;
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const exportControllerRef = useRef<AbortController | null>(null);

  if (!activeDoc) return null;

  const metadata = getImageArtboardsMetadata(activeDoc);
  const status = buildImageArtboardsPrintStatus(activeDoc);
  const readiness = buildImageArtboardsPrintExportReadiness(activeDoc);

  const updateArtboards = (nextMetadata: ImageArtboardsMetadata) => {
    useImageEditorStore.setState((state) => {
      let changed = false;
      const documents = state.documents.map((document: ImageDocument) => {
        if (document.id !== activeDoc.id) return document;
        const nextDocument = applyImageArtboardsMetadata(document, nextMetadata);
        if (nextDocument !== document) changed = true;
        return nextDocument;
      });
      return changed ? { documents } : state;
    });
  };

  const updateArtboard = (artboardId: string, patch: Partial<ImageArtboardMetadata>) => {
    updateArtboards({
      ...metadata,
      artboards: metadata.artboards.map((artboard) => (
        artboard.id === artboardId ? { ...artboard, ...patch } : artboard
      )),
    });
  };

  const updatePage = (
    artboardId: string,
    patch: Partial<ImageArtboardMetadata['page']>,
    nextPreset?: ImageArtboardPagePreset,
  ) => {
    updateArtboards({
      ...metadata,
      artboards: metadata.artboards.map((artboard) => (
        artboard.id === artboardId
          ? {
              ...artboard,
              page: {
                ...artboard.page,
                ...patch,
                ...(nextPreset ? { preset: nextPreset } : {}),
              },
            }
          : artboard
      )),
    });
  };

  const addArtboard = () => {
    updateArtboards({
      ...metadata,
      artboards: [
        ...metadata.artboards,
        createImageArtboardFromDocument(activeDoc, metadata.artboards.length),
      ],
    });
  };

  const removeArtboard = (artboardId: string) => {
    const artboards = metadata.artboards.filter((artboard) => artboard.id !== artboardId);
    if (artboards.length === 0) return;
    updateArtboards({
      activeArtboardId: metadata.activeArtboardId === artboardId ? artboards[0]?.id : metadata.activeArtboardId,
      artboards,
    });
  };

  const exportPngArtboards = async () => {
    if (isExporting) return;
    const controller = new AbortController();
    exportControllerRef.current = controller;
    setIsExporting(true);
    try {
      const results = await exportImageArtboardsToPng(activeDoc, { signal: controller.signal });
      let exported = 0;
      let skipped = 0;
      let failed = 0;
      let cancelled = 0;
      for (const result of results) {
        if (result.status === 'exported' && result.blob && typeof URL.createObjectURL === 'function') {
          const url = URL.createObjectURL(result.blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = result.filename;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          exported += 1;
        } else if (result.status === 'skipped') {
          skipped += 1;
        } else if (result.status === 'cancelled') {
          cancelled += 1;
        } else {
          failed += 1;
        }
      }
      setExportNotice(`Trim PNG artboards: ${exported} downloaded, ${skipped} skipped, ${failed} failed, ${cancelled} cancelled. Files are flattened RGB/RGBA trim derivatives only; bleed pixels, ICC conversion/embedding, and press-ready output are not produced.`);
    } catch (error) {
      setExportNotice(`Trim PNG artboards could not start: ${error instanceof Error ? error.message : 'unexpected export error'}`);
    } finally {
      if (exportControllerRef.current === controller) exportControllerRef.current = null;
      setIsExporting(false);
    }
  };

  const cancelPngArtboards = () => exportControllerRef.current?.abort();

  return (
    <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-xs text-cyan-100/65">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-[0.14em] text-cyan-100/50">Artboards / Print Proof</span>
        <div className="flex items-center gap-1">
          <button
            aria-label={isExporting ? 'Cancel artboard PNG export' : 'Export artboards as trim PNG'}
            className="inline-flex h-7 items-center gap-1 rounded border border-cyan-300/10 bg-[#070b12] px-2 text-[11px] text-cyan-100/70 transition hover:border-cyan-300/20 hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-cyan-100/25"
            onClick={() => {
              if (isExporting) cancelPngArtboards();
              else void exportPngArtboards();
            }}
            type="button"
          >
            {isExporting ? <X className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
            <span>{isExporting ? 'Cancel' : 'Trim PNG'}</span>
          </button>
          <button
            aria-label="Add artboard"
            className="inline-flex h-7 items-center gap-1 rounded border border-cyan-300/10 bg-[#070b12] px-2 text-[11px] text-cyan-100/70 transition hover:border-cyan-300/20 hover:text-cyan-100"
            onClick={addArtboard}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add</span>
          </button>
        </div>
      </div>
      <div className="text-[11px] leading-4 text-cyan-100/40">
        Image exports one flattened trim PNG per artboard. Bleed extension, ICC conversion/embedding, PDF/X, printer marks, imposition, and packages remain outside this local raster workflow.
      </div>
      {exportNotice ? <div className="rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1.5 text-[10px] leading-4 text-cyan-100/55">{exportNotice}</div> : null}
      <div className="space-y-3">
        {metadata.artboards.map((artboard, index) => {
          const artboardStatus = status.artboards.find((entry) => entry.id === artboard.id);
          const artboardReadiness = readiness.artboards.find((entry) => entry.id === artboard.id);
          return (
            <div className="border-t border-cyan-300/10 pt-2 first:border-t-0 first:pt-0" key={artboard.id}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="font-semibold text-cyan-100/75">{artboard.name || `Artboard ${index + 1}`}</span>
                {metadata.artboards.length > 1 ? (
                  <button
                    aria-label={`Remove artboard ${artboard.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-cyan-300/10 bg-[#070b12] text-cyan-100/55 transition hover:border-red-300/25 hover:text-red-200"
                    onClick={() => removeArtboard(artboard.id)}
                    type="button"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Name</span>
                  <input
                    aria-label="Artboard name"
                    className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                    onChange={(event) => updateArtboard(artboard.id, { name: event.target.value })}
                    type="text"
                    value={artboard.name}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Proof Label</span>
                  <input
                    aria-label="Artboard proof label"
                    className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                    onChange={(event) => updateArtboard(artboard.id, { proofLabel: event.target.value })}
                    type="text"
                    value={artboard.proofLabel ?? ''}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Preset</span>
                  <select
                    aria-label="Artboard page preset"
                    className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                    onChange={(event) => {
                      const preset = event.target.value as ImageArtboardPagePreset;
                      const presetSize = IMAGE_ARTBOARD_PAGE_PRESETS.find((item) => item.value === preset);
                      updatePage(
                        artboard.id,
                        preset !== 'custom' && presetSize
                          ? { widthMm: presetSize.widthMm, heightMm: presetSize.heightMm }
                          : {},
                        preset,
                      );
                    }}
                    value={artboard.page.preset}
                  >
                    {IMAGE_ARTBOARD_PAGE_PRESETS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Target DPI</span>
                  <input
                    aria-label="Artboard target DPI"
                    className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                    min={72}
                    onChange={(event) => updatePage(artboard.id, { dpi: Number(event.target.value) || artboard.page.dpi })}
                    step={1}
                    type="number"
                    value={artboard.page.dpi}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Width (mm)</span>
                  <input
                    aria-label="Artboard page width mm"
                    className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                    min={1}
                    onChange={(event) => updatePage(artboard.id, { widthMm: Number(event.target.value) || artboard.page.widthMm }, 'custom')}
                    step={0.1}
                    type="number"
                    value={artboard.page.widthMm}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Height (mm)</span>
                  <input
                    aria-label="Artboard page height mm"
                    className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                    min={1}
                    onChange={(event) => updatePage(artboard.id, { heightMm: Number(event.target.value) || artboard.page.heightMm }, 'custom')}
                    step={0.1}
                    type="number"
                    value={artboard.page.heightMm}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Bleed (mm)</span>
                  <input
                    aria-label="Artboard bleed mm"
                    className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                    min={0}
                    onChange={(event) => updatePage(artboard.id, { bleedMm: Number(event.target.value) || 0 })}
                    step={0.1}
                    type="number"
                    value={artboard.page.bleedMm}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">X</span>
                    <input
                      aria-label="Artboard x"
                      className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                      onChange={(event) => updateArtboard(artboard.id, { x: Number(event.target.value) || 0 })}
                      step={1}
                      type="number"
                      value={artboard.x}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Y</span>
                    <input
                      aria-label="Artboard y"
                      className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                      onChange={(event) => updateArtboard(artboard.id, { y: Number(event.target.value) || 0 })}
                      step={1}
                      type="number"
                      value={artboard.y}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Width (px)</span>
                    <input
                      aria-label="Artboard width px"
                      className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                      min={1}
                      onChange={(event) => updateArtboard(artboard.id, { width: Number(event.target.value) || artboard.width })}
                      step={1}
                      type="number"
                      value={artboard.width}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Height (px)</span>
                    <input
                      aria-label="Artboard height px"
                      className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
                      min={1}
                      onChange={(event) => updateArtboard(artboard.id, { height: Number(event.target.value) || artboard.height })}
                      step={1}
                      type="number"
                      value={artboard.height}
                    />
                  </label>
                </div>
              </div>
              {artboardStatus ? (
                <>
                  <div className="mt-2 text-[11px] leading-4 text-cyan-100/50">
                    <div>Trim: {artboardStatus.bounds.trimWidthPx} x {artboardStatus.bounds.trimHeightPx} px</div>
                    <div>Bleed: {artboardStatus.bounds.bleedWidthPx} x {artboardStatus.bounds.bleedHeightPx} px</div>
                    <div>{artboardStatus.pageLabel} proof "{artboardStatus.proofLabel}" at {artboardStatus.targetDpi} DPI; source resolves to {artboardStatus.actualPpi} PPI.</div>
                    {artboardReadiness ? (
                      <>
                        <div>
                          Print {artboardReadiness.readiness.printReady ? 'ready' : 'needs review'}; Paper {artboardReadiness.handoff.paper.ready ? 'ready' : 'blocked'}; Source Bin {artboardReadiness.handoff.sourceBin.ready ? 'safe' : 'blocked'}; batch proof {artboardReadiness.batch.printProof.ready ? 'ready' : 'flagged'}.
                        </div>
                        <div>Media Box {artboardReadiness.pageBoxes.mediaBox.documentRect.width} x {artboardReadiness.pageBoxes.mediaBox.documentRect.height} px</div>
                        <div>Filename policy: {artboardReadiness.filenamePolicy.resolvedBasename}</div>
                        <div>Raster bounds: trim {artboardReadiness.exportBounds.outputTrimSizePx.width} x {artboardReadiness.exportBounds.outputTrimSizePx.height} px, bleed {artboardReadiness.exportBounds.outputBleedSizePx.width} x {artboardReadiness.exportBounds.outputBleedSizePx.height} px</div>
                        {readiness.proofProfile.profileLabel ? (
                          <div>Proof profile: {readiness.proofProfile.profileLabel} metadata only; ICC embedding unsupported.</div>
                        ) : null}
                        <div>Unsupported: auto bleed extension, Image slices, printer marks/PDF/X, and true contract proof output.</div>
                        <div>Export summary: {artboardReadiness.suitability.export}</div>
                        <div>Proof summary: {artboardReadiness.suitability.proof}</div>
                      </>
                    ) : null}
                  </div>
                  {artboardReadiness?.blockers.length ? (
                    <ul className="mt-2 space-y-1 text-[11px] leading-4 text-red-100/70">
                      {artboardReadiness.blockers.map((blocker) => (
                        <li key={`${artboard.id}-${blocker.code}`}>{blocker.summary}</li>
                      ))}
                    </ul>
                  ) : null}
                  {artboardStatus.warnings.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-[11px] leading-4 text-amber-100/65">
                      {artboardStatus.warnings.map((warning) => (
                        <li key={`${artboard.id}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
