import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eraser, Pencil, Trash2, X } from 'lucide-react';
import { DOODLE_PENCIL_COLOR, doodleCanvasDimensions } from '../../lib/doodleNode';
import { useMobilePhoneInterfaceDescriptor } from '../../lib/mobilePhoneInterface';
import { Z_INDEX } from '../../lib/zIndex';
import type { AspectRatio } from '../../types/flow';

interface DoodleCanvasDialogProps {
  open: boolean;
  aspectRatio: AspectRatio;
  initialSketch?: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

type DoodleMode = 'draw' | 'erase' | 'off';

/**
 * The expanded blue-pencil sketch canvas. Pointer events cover mouse, touch and
 * pen (S Pen / Wacom) uniformly; the "off" mode lets touch scroll/navigate
 * without drawing. Full-screen on phones, a large centred modal on desktop/DeX.
 */
export function DoodleCanvasDialog({ open, aspectRatio, initialSketch, onSave, onClose }: DoodleCanvasDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<DoodleMode>('draw');
  const mobilePhoneInterface = useMobilePhoneInterfaceDescriptor();
  const { width, height } = doodleCanvasDimensions(aspectRatio);

  // Prime the canvas with a white background (and the existing sketch) on open.
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (initialSketch) {
      const image = new Image();
      image.onload = () => ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = initialSketch;
    }
  }, [open, initialSketch, width, height]);

  const toCanvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode === 'off') return;
    event.preventDefault();
    canvasRef.current?.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = toCanvasPoint(event);
  }, [mode, toCanvasPoint]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || mode === 'off') return;
    const ctx = canvasRef.current?.getContext('2d');
    const last = lastPointRef.current;
    if (!ctx || !last) return;
    const point = toCanvasPoint(event);
    ctx.strokeStyle = mode === 'erase' ? '#ffffff' : DOODLE_PENCIL_COLOR;
    ctx.lineWidth = mode === 'erase' ? 24 : 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }, [mode, toCanvasPoint]);

  const endStroke = useCallback(() => {
    drawingRef.current = false;
    lastPointRef.current = null;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const handleDone = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onSave(canvas.toDataURL('image/png'));
    onClose();
  }, [onSave, onClose]);

  if (!open) return null;

  const overlay = (
    <div
      aria-label="Doodle canvas"
      aria-modal="true"
      className="signal-loom-themed theme-panel fixed inset-0 flex flex-col bg-[#11131b]"
      role="dialog"
      style={{
        zIndex: Z_INDEX.floatingPanelBase + 500,
        paddingTop: mobilePhoneInterface.enabled ? 'env(safe-area-inset-top)' : undefined,
        paddingBottom: mobilePhoneInterface.enabled ? 'env(safe-area-inset-bottom)' : undefined,
      }}
    >
      <div className="theme-surface theme-border flex items-center gap-2 border-b px-3 py-2">
        <Pencil size={16} className="text-sky-400" />
        <span className="text-sm font-semibold text-gray-100">Doodle</span>
        <div className="ml-2 flex gap-1">
          <ToolButton active={mode === 'draw'} icon={Pencil} label="Draw" onClick={() => setMode('draw')} />
          <ToolButton active={mode === 'erase'} icon={Eraser} label="Erase" onClick={() => setMode('erase')} />
          <ToolButton active={mode === 'off'} icon={null} label="Move" onClick={() => setMode('off')} />
        </div>
        <button
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 hover:text-white"
          onClick={clearCanvas}
          type="button"
        >
          <Trash2 size={14} /> Clear
        </button>
        <button
          className="rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-400"
          onClick={handleDone}
          type="button"
        >
          Done
        </button>
        <button
          aria-label="Close doodle canvas"
          className="rounded-md p-1.5 text-gray-300 hover:bg-gray-700 hover:text-white"
          onClick={onClose}
          type="button"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="max-h-full max-w-full rounded shadow-lg"
          style={{ aspectRatio: `${width} / ${height}`, touchAction: 'none', backgroundColor: '#ffffff' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

function ToolButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Pencil | null;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${active ? 'bg-sky-500/30 text-sky-100' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
      onClick={onClick}
      type="button"
    >
      {Icon ? <Icon size={14} /> : null}
      {label}
    </button>
  );
}
