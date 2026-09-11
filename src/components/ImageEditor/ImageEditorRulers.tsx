import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DocumentViewport } from '../../types/imageEditor';
import { generateRulerTicks } from './ImageRulersGuides';

export const IMAGE_RULER_SIZE = 20;

interface ImageEditorRulersProps {
  viewport: DocumentViewport;
  /** Cursor position in canvas-local (wrapper) px, or null when off-canvas. */
  cursor: { x: number; y: number } | null;
  /** Called on release of a drag started from a ruler, to drop a guide. */
  onCreateGuide: (axis: 'x' | 'y', clientX: number, clientY: number) => void;
}

/**
 * Top + left rulers (and the corner box) for the Image canvas. Overlays the
 * wrapper edges and shares the wrapper's origin, so a tick at document value `v`
 * sits at screen `v * zoom + pan`. Dragging off a ruler drops a guide.
 */
export function ImageEditorRulers({ viewport, cursor, onCreateGuide }: ImageEditorRulersProps) {
  return (
    <>
      <div
        className="pointer-events-none absolute left-0 top-0 z-20 border-b border-r border-cyan-300/15 bg-[#0b0d12]"
        data-image-ruler-corner="true"
        style={{ width: IMAGE_RULER_SIZE, height: IMAGE_RULER_SIZE }}
      />
      <RulerStrip axis="horizontal" viewport={viewport} cursor={cursor} onCreateGuide={onCreateGuide} />
      <RulerStrip axis="vertical" viewport={viewport} cursor={cursor} onCreateGuide={onCreateGuide} />
    </>
  );
}

function RulerStrip({
  axis,
  viewport,
  cursor,
  onCreateGuide,
}: {
  axis: 'horizontal' | 'vertical';
  viewport: DocumentViewport;
  cursor: { x: number; y: number } | null;
  onCreateGuide: (guideAxis: 'x' | 'y', clientX: number, clientY: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const horizontal = axis === 'horizontal';
  const pan = horizontal ? viewport.panX : viewport.panY;
  const cursorPos = cursor ? (horizontal ? cursor.x : cursor.y) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const render = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const lengthCss = horizontal ? parent.clientWidth : parent.clientHeight;
      const cssW = horizontal ? lengthCss : IMAGE_RULER_SIZE;
      const cssH = horizontal ? IMAGE_RULER_SIZE : lengthCss;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#0b0d12';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.strokeStyle = 'rgba(190,210,240,0.35)';
      ctx.fillStyle = 'rgba(190,210,240,0.7)';
      ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
      ctx.lineWidth = 1;

      const ticks = generateRulerTicks(lengthCss, pan, viewport.zoom);
      ctx.beginPath();
      for (const tick of ticks) {
        const p = Math.round(tick.screen) + 0.5;
        const markLen = tick.major ? IMAGE_RULER_SIZE : IMAGE_RULER_SIZE * 0.45;
        if (horizontal) {
          ctx.moveTo(p, IMAGE_RULER_SIZE);
          ctx.lineTo(p, IMAGE_RULER_SIZE - markLen);
        } else {
          ctx.moveTo(IMAGE_RULER_SIZE, p);
          ctx.lineTo(IMAGE_RULER_SIZE - markLen, p);
        }
      }
      ctx.stroke();

      for (const tick of ticks) {
        if (!tick.major) continue;
        const label = String(Math.round(tick.value));
        if (horizontal) {
          ctx.fillText(label, tick.screen + 2, 8);
        } else {
          ctx.save();
          ctx.translate(8, tick.screen - 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }

      // Cursor position indicator.
      if (cursorPos !== null) {
        ctx.strokeStyle = 'rgba(0,200,255,0.95)';
        ctx.beginPath();
        const p = Math.round(cursorPos) + 0.5;
        if (horizontal) {
          ctx.moveTo(p, 0);
          ctx.lineTo(p, IMAGE_RULER_SIZE);
        } else {
          ctx.moveTo(0, p);
          ctx.lineTo(IMAGE_RULER_SIZE, p);
        }
        ctx.stroke();
      }
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [horizontal, pan, viewport.zoom, cursorPos]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const guideAxis: 'x' | 'y' = horizontal ? 'y' : 'x';
    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointerup', onUp);
      onCreateGuide(guideAxis, upEvent.clientX, upEvent.clientY);
    };
    window.addEventListener('pointerup', onUp);
  };

  return (
    <canvas
      className={`pointer-events-auto absolute z-20 ${horizontal ? 'cursor-row-resize' : 'cursor-col-resize'}`}
      data-image-ruler={horizontal ? 'horizontal' : 'vertical'}
      onPointerDown={handlePointerDown}
      ref={canvasRef}
      style={
        horizontal
          ? { left: IMAGE_RULER_SIZE, right: 0, top: 0, height: IMAGE_RULER_SIZE }
          : { top: IMAGE_RULER_SIZE, bottom: 0, left: 0, width: IMAGE_RULER_SIZE }
      }
    />
  );
}
