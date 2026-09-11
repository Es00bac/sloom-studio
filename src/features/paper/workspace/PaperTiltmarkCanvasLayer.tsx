import { useEffect, useMemo, useRef, useState } from 'react';
import { paperPixelsFromMm } from '../../../lib/paperDocument';
import { paperFrameLayerIsLocked } from '../../../lib/paperLayers';
import { createBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import { useImageEditorStore } from '../../../store/imageEditorStore';
import { usePaperStore } from '../../../store/paperStore';
import type { PaperDocument, PaperFrame, PaperPage } from '../../../types/paper';
import { normalizeBrushSettings } from '../../../components/ImageEditor/ImageBrushEngine';
import {
  createTiltmarkStrokeSession,
  isTiltmarkRuntimeReady,
  type TiltmarkStrokeSession,
} from '../../../components/ImageEditor/tiltmark/TiltmarkRuntime';
import {
  EMPTY_TILTMARK_MIXER_STATE,
  renderTiltmarkDabs,
  resolveTiltmarkRasterInteractions,
  type TiltmarkMixerState,
} from '../../../components/ImageEditor/tiltmark/TiltmarkRenderer';
import type { TiltmarkStrokeAppendResult } from '../../../components/ImageEditor/tiltmark/TiltmarkTypes';
import { paperAssetRepository } from '../assets/PaperAssetRuntime';
import { usePaperAssetUrl } from '../assets/usePaperAssetUrl';

export const PAPER_TILTMARK_PAINT_FORMAT = 'tiltmark-paint-v1';

export function isPaperTiltmarkPaintFrame(frame: Pick<PaperFrame, 'kind' | 'asset'>): boolean {
  return frame.kind === 'image' && frame.asset?.format === PAPER_TILTMARK_PAINT_FORMAT;
}

interface PaperTiltmarkCanvasLayerProps {
  doc: PaperDocument;
  leftPx: number;
  page: PaperPage;
  topPx: number;
  zoom: number;
}

interface ActiveStroke {
  pointerId: number;
  session: TiltmarkStrokeSession;
  documentId: string;
  paintFrameId: string | null;
  paintAssetId: string | null;
}

function managedAssetId(frame: PaperFrame | undefined): string | null {
  return frame?.asset?.locator?.kind === 'managed' ? frame.asset.locator.ref.id : null;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Paper could not encode the Tiltmark paint layer.'));
    }, 'image/png');
  });
}

export function PaperTiltmarkCanvasLayer({
  doc,
  leftPx,
  page,
  topPx,
  zoom,
}: PaperTiltmarkCanvasLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeStrokeRef = useRef<ActiveStroke | null>(null);
  const mixerRef = useRef<TiltmarkMixerState>({ ...EMPTY_TILTMARK_MIXER_STATE });
  const loadedKeyRef = useRef<string | null>(null);
  const [baseLoaded, setBaseLoaded] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const settings = normalizeBrushSettings(useImageEditorStore((state) => state.brushSettings));
  const backgroundColor = useImageEditorStore((state) => state.backgroundColor);
  const paintFrame = useMemo(
    () => page.frames.find(isPaperTiltmarkPaintFrame),
    [page.frames],
  );
  const assetUrl = usePaperAssetUrl(paintFrame?.asset);
  const pixelWidth = Math.max(1, paperPixelsFromMm(doc.page.widthMm, doc.page.dpi));
  const pixelHeight = Math.max(1, paperPixelsFromMm(doc.page.heightMm, doc.page.dpi));
  const paintAssetId = managedAssetId(paintFrame);
  const paintLocked = paintFrame ? paperFrameLayerIsLocked(doc, paintFrame) : false;
  const loadKey = `${pixelWidth}x${pixelHeight}:${paintAssetId ?? 'empty'}:${reloadRevision}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      setError('Paper could not create a 2D canvas for Tiltmark.');
      return;
    }
    if (loadedKeyRef.current === loadKey) {
      setBaseLoaded(true);
      return;
    }
    if (paintAssetId && !assetUrl) {
      setBaseLoaded(false);
      return;
    }

    let active = true;
    setBaseLoaded(false);
    setError(null);
    context.clearRect(0, 0, canvas.width, canvas.height);
    mixerRef.current = { ...EMPTY_TILTMARK_MIXER_STATE };
    if (!assetUrl) {
      loadedKeyRef.current = loadKey;
      setBaseLoaded(true);
      return;
    }

    const image = new window.Image();
    image.onload = () => {
      if (!active) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      loadedKeyRef.current = loadKey;
      setBaseLoaded(true);
    };
    image.onerror = () => {
      if (!active) return;
      setError('Paper could not load the existing Tiltmark paint layer.');
      setBaseLoaded(false);
    };
    image.src = assetUrl;
    return () => {
      active = false;
    };
  }, [assetUrl, loadKey, paintAssetId, pixelHeight, pixelWidth]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height),
    };
  };

  const paintResult = (result: TiltmarkStrokeAppendResult) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context || result.dabs.length === 0) return;
    const dabs = resolveTiltmarkRasterInteractions(
      context,
      result.dabs,
      mixerRef.current,
      { x: 0, y: 0 },
    );
    renderTiltmarkDabs(context, dabs);
  };

  const reloadBasePixels = () => {
    loadedKeyRef.current = null;
    setBaseLoaded(false);
    setReloadRevision((revision) => revision + 1);
  };

  const isStrokeAuthorityCurrent = (stroke: ActiveStroke): boolean => {
    const state = usePaperStore.getState();
    if (state.document.id !== stroke.documentId) return false;
    const currentPage = state.document.pages.find((candidate) => candidate.id === page.id);
    const currentFrame = currentPage?.frames.find(isPaperTiltmarkPaintFrame);
    return (currentFrame?.id ?? null) === stroke.paintFrameId
      && managedAssetId(currentFrame) === stroke.paintAssetId;
  };

  const commitCanvas = async (stroke: ActiveStroke) => {
    const canvas = canvasRef.current;
    if (!canvas || !isStrokeAuthorityCurrent(stroke)) return;
    setCommitting(true);
    setError(null);
    try {
      const blob = await canvasToPngBlob(canvas);
      if (!isStrokeAuthorityCurrent(stroke)) return;
      const record = await createBinaryAssetRecord(
        new Uint8Array(await blob.arrayBuffer()),
        { mimeType: 'image/png', fileName: `Tiltmark Paint – Page ${page.pageNumber}.png` },
      );
      if (!isStrokeAuthorityCurrent(stroke)) return;
      const ref = await paperAssetRepository.put(record);
      if (!isStrokeAuthorityCurrent(stroke)) return;
      const asset: NonNullable<PaperFrame['asset']> = {
        label: `Tiltmark Paint – Page ${page.pageNumber}.png`,
        kind: 'image',
        mimeType: 'image/png',
        format: PAPER_TILTMARK_PAINT_FORMAT,
        pixelWidth: canvas.width,
        pixelHeight: canvas.height,
        locator: { kind: 'managed', ref },
        embeddedAt: Date.now(),
      };
      const paper = usePaperStore.getState();
      const currentPage = paper.document.pages.find((candidate) => candidate.id === page.id);
      const currentFrame = currentPage?.frames.find(isPaperTiltmarkPaintFrame);
      if (currentFrame) {
        paper.updateFrame(page.id, currentFrame.id, { asset });
      } else {
        paper.addFrameToPage(page.id, 'image', {
          label: 'Tiltmark Paint',
          xMm: 0,
          yMm: 0,
          widthMm: doc.page.widthMm,
          heightMm: doc.page.heightMm,
          rotationDeg: 0,
          locked: false,
          fit: 'stretch',
          fillOpacity: 0,
          strokeOpacity: 0,
          strokeWidthMm: 0,
          asset,
        });
      }
      loadedKeyRef.current = `${canvas.width}x${canvas.height}:${ref.id}:${reloadRevision}`;
      usePaperStore.getState().setTool('tiltmark');
    } catch (commitError) {
      if (isStrokeAuthorityCurrent(stroke)) reloadBasePixels();
      setError(commitError instanceof Error ? commitError.message : String(commitError));
    } finally {
      setCommitting(false);
    }
  };

  const beginStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      event.pointerType === 'touch'
      || (event.button !== 0 && event.pointerType !== 'pen')
      || !baseLoaded
      || committing
      || activeStrokeRef.current
      || !isTiltmarkRuntimeReady()
    ) {
      return;
    }
    if (paintLocked) {
      setError('Unlock the Tiltmark Paint frame or its Paper layer before painting.');
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    try {
      const session = createTiltmarkStrokeSession({
        settings: { ...settings, brushEngine: 'tiltmark' },
        backgroundColor,
        seed: (Date.now() ^ Math.round(event.clientX * 31 + event.clientY * 17)) >>> 0,
        forceEraser: false,
      });
      const stroke: ActiveStroke = {
        pointerId: event.pointerId,
        session,
        documentId: doc.id,
        paintFrameId: paintFrame?.id ?? null,
        paintAssetId,
      };
      activeStrokeRef.current = stroke;
      mixerRef.current = { ...EMPTY_TILTMARK_MIXER_STATE };
      paintResult(session.begin(pointFromEvent(event), event.nativeEvent));
    } catch (strokeError) {
      setError(strokeError instanceof Error ? strokeError.message : String(strokeError));
    }
  };

  const moveStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = activeStrokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    paintResult(stroke.session.append(pointFromEvent(event), event.nativeEvent));
  };

  const endStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = activeStrokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    paintResult(stroke.session.end(pointFromEvent(event), event.nativeEvent));
    stroke.session.dispose();
    activeStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void commitCanvas(stroke);
  };

  const cancelStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = activeStrokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    stroke.session.cancel();
    stroke.session.dispose();
    reloadBasePixels();
    activeStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  useEffect(() => () => {
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    stroke.session.cancel();
    stroke.session.dispose();
    activeStrokeRef.current = null;
  }, []);

  return (
    <>
      <canvas
        aria-label={`Tiltmark paint layer for page ${page.pageNumber}`}
        className={`absolute touch-none ${baseLoaded && !committing ? 'cursor-crosshair' : 'cursor-wait'}`}
        data-paper-tiltmark-canvas="true"
        height={pixelHeight}
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={cancelStroke}
        onPointerDown={beginStroke}
        onPointerMove={moveStroke}
        onPointerUp={endStroke}
        ref={canvasRef}
        style={{
          left: leftPx,
          top: topPx,
          width: doc.page.widthMm * 3.7795275591 * zoom,
          height: doc.page.heightMm * 3.7795275591 * zoom,
          zIndex: 1_000_000,
        }}
        width={pixelWidth}
      />
      {error ? (
        <div
          className="pointer-events-none absolute rounded bg-rose-950/90 px-2 py-1 text-[10px] text-rose-100 shadow-lg"
          role="alert"
          style={{ left: leftPx + 8, top: topPx + 8, zIndex: 1_000_001 }}
        >
          {error}
        </div>
      ) : null}
    </>
  );
}
