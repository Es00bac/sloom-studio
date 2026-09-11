import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Brush, Eraser, RotateCcw, Save, Sparkles, Trash2, X } from 'lucide-react';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';

interface ImageMaskPainterDialogProps {
  brushSize: number;
  initialMaskDataUrl?: string;
  mode: 'mask' | 'outpaint';
  onBrushSizeChange: (size: number) => void;
  onClose: () => void;
  onSave: (maskDataUrl: string) => void;
  sourceImageUrl: string;
  detectorLabel?: string;
  onDetect?: (phrase: string) => Promise<string>;
}

type PaintTool = 'brush' | 'eraser';

export function ImageMaskPainterDialog({
  brushSize,
  initialMaskDataUrl,
  mode,
  onBrushSizeChange,
  onClose,
  onSave,
  sourceImageUrl,
  detectorLabel,
  onDetect,
}: ImageMaskPainterDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const activeStrokeRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [tool, setTool] = useState<PaintTool>('brush');
  const [error, setError] = useState<string | undefined>();
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const [detectPhrase, setDetectPhrase] = useState('');
  const [isDetecting, setIsDetecting] = useState(false);

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !image || !maskCanvas) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    let overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvasRef.current = overlayCanvas;
    }
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;

    const overlayCtx = overlayCanvas.getContext('2d');
    if (!overlayCtx) {
      return;
    }

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.fillStyle = 'rgba(236, 72, 153, 0.78)';
    overlayCtx.fillRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCtx.globalCompositeOperation = 'destination-in';
    overlayCtx.drawImage(maskCanvas, 0, 0);
    overlayCtx.globalCompositeOperation = 'source-over';

    ctx.drawImage(overlayCanvas, 0, 0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) {
        return;
      }

      const width = Math.max(1, image.naturalWidth || image.width);
      const height = Math.max(1, image.naturalHeight || image.height);
      imageRef.current = image;
      setCanvasSize({ width, height });

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      maskCanvasRef.current = maskCanvas;

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
      }

      if (!initialMaskDataUrl) {
        renderCanvas();
        return;
      }

      const maskImage = new Image();
      maskImage.onload = () => {
        if (cancelled) {
          return;
        }
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx?.drawImage(maskImage, 0, 0, width, height);
        renderCanvas();
      };
      maskImage.onerror = () => renderCanvas();
      maskImage.src = initialMaskDataUrl;
    };
    image.onerror = () => {
      if (!cancelled) {
        setError('Unable to load the source image for mask painting.');
      }
    };
    image.src = sourceImageUrl;

    return () => {
      cancelled = true;
    };
  }, [initialMaskDataUrl, renderCanvas, sourceImageUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const getCanvasPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const paintAt = (x: number, y: number, previous?: { x: number; y: number } | null) => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) {
      return;
    }

    const ctx = maskCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';

    ctx.beginPath();
    if (previous) {
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    renderCanvas();
  };

  const clearMask = () => {
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    if (!maskCanvas || !ctx) {
      return;
    }
    ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    renderCanvas();
  };

  const invertMask = () => {
    const maskCanvas = maskCanvasRef.current;
    const ctx = maskCanvas?.getContext('2d');
    if (!maskCanvas || !ctx) {
      return;
    }

    const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    for (let index = 0; index < imageData.data.length; index += 4) {
      const nextAlpha = 255 - imageData.data[index + 3];
      imageData.data[index] = 255;
      imageData.data[index + 1] = 255;
      imageData.data[index + 2] = 255;
      imageData.data[index + 3] = nextAlpha;
    }
    ctx.putImageData(imageData, 0, 0);
    renderCanvas();
  };

  const saveMask = () => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) {
      return;
    }
    onSave(maskCanvas.toDataURL('image/png'));
  };

  const title = mode === 'outpaint' ? 'Outpaint Workspace' : 'Mask Painter';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className={withFlowNodeInteractionClasses('flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-700 bg-[#111621] shadow-2xl')}>
        <div className="flex items-center justify-between border-b border-gray-800 bg-[#171c27] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-100">{title}</div>
            <div className="mt-0.5 text-[11px] text-gray-400">
              {mode === 'outpaint' ? 'Painted mask is saved for planning; margin controls drive Stability outpaint.' : 'White/magenta areas are submitted as the editable mask.'}
            </div>
          </div>
          <button
            className="rounded-md border border-gray-700 bg-gray-900 p-1.5 text-gray-300 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-3 border-r border-gray-800 bg-[#0d111a] p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-semibold ${tool === 'brush' ? 'border-pink-300 bg-pink-500/20 text-pink-50' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                onClick={() => setTool('brush')}
                type="button"
              >
                <Brush size={14} /> Brush
              </button>
              <button
                className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-semibold ${tool === 'eraser' ? 'border-cyan-300 bg-cyan-500/20 text-cyan-50' : 'border-gray-700 text-gray-300 hover:text-white'}`}
                onClick={() => setTool('eraser')}
                type="button"
              >
                <Eraser size={14} /> Eraser
              </button>
            </div>

            <label className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              Size {brushSize}px
              <input
                className="mt-2 w-full accent-pink-400"
                max={160}
                min={4}
                onChange={(event) => onBrushSizeChange(Number(event.target.value))}
                step={2}
                type="range"
                value={brushSize}
              />
            </label>

            {onDetect ? (
              <div className="space-y-1">
                <input
                  className="w-full rounded-md border border-gray-700 bg-[#111217] px-2 py-1.5 text-xs text-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                  onChange={(event) => setDetectPhrase(event.target.value)}
                  placeholder={`Detect with ${detectorLabel ?? 'AI'}, e.g. the cat`}
                  value={detectPhrase}
                />
                <button
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-blue-400/50 bg-blue-500/15 px-2 py-2 text-xs font-semibold text-blue-50 hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isDetecting || !detectPhrase.trim()}
                  onClick={async () => {
                    if (!onDetect) {
                      return;
                    }
                    setIsDetecting(true);
                    setError(undefined);
                    try {
                      const maskCanvas = maskCanvasRef.current;
                      const detectedUrl = await onDetect(detectPhrase.trim());
                      const detected = new Image();
                      detected.onload = () => {
                        const ctx = maskCanvas?.getContext('2d');
                        if (maskCanvas && ctx) {
                          ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
                          ctx.drawImage(detected, 0, 0, maskCanvas.width, maskCanvas.height);
                          renderCanvas();
                        }
                      };
                      detected.src = detectedUrl;
                    } catch (detectError) {
                      setError(detectError instanceof Error ? detectError.message : 'Object detection failed.');
                    } finally {
                      setIsDetecting(false);
                    }
                  }}
                  type="button"
                >
                  <Sparkles size={14} /> {isDetecting ? 'Detecting…' : 'Detect object'}
                </button>
              </div>
            ) : null}

            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-700 px-2 py-2 text-xs font-semibold text-gray-300 hover:text-white"
              onClick={invertMask}
              type="button"
            >
              <RotateCcw size={14} /> Invert
            </button>
            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-700 px-2 py-2 text-xs font-semibold text-gray-300 hover:text-white"
              onClick={clearMask}
              type="button"
            >
              <Trash2 size={14} /> Clear
            </button>
            <button
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-300/50 bg-emerald-500/15 px-2 py-2 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/25"
              onClick={saveMask}
              type="button"
            >
              <Save size={14} /> Save mask
            </button>

            <div className="rounded-md border border-gray-800 bg-black/20 p-2 text-[10px] leading-4 text-gray-500">
              Canvas: {canvasSize.width} x {canvasSize.height}
            </div>
          </div>

          <div className="min-h-0 overflow-auto bg-[#090c12] p-4">
            {error ? (
              <div className="rounded-md border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
            ) : (
              <canvas
                ref={canvasRef}
                className="mx-auto block max-h-[72vh] max-w-full cursor-crosshair rounded-lg border border-gray-700 bg-black shadow-2xl"
                height={canvasSize.height}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  activeStrokeRef.current = true;
                  const point = getCanvasPoint(event);
                  lastPointRef.current = point;
                  paintAt(point.x, point.y);
                }}
                onPointerMove={(event) => {
                  if (!activeStrokeRef.current) {
                    return;
                  }
                  const point = getCanvasPoint(event);
                  paintAt(point.x, point.y, lastPointRef.current);
                  lastPointRef.current = point;
                }}
                onPointerUp={(event) => {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                  activeStrokeRef.current = false;
                  lastPointRef.current = null;
                }}
                width={canvasSize.width}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
