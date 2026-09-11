import { useLayoutEffect, useMemo, useRef } from 'react';
import { renderTiltmarkDabs } from '../../../components/ImageEditor/tiltmark/TiltmarkRenderer';
import { buildPaperImageRenderStyle } from '../../../lib/paperLayoutTools';
import { useHaneStrokePreviewStore } from '../../../lib/haneStrokePreview';
import type { PaperFrame } from '../../../types/paper';

export function PaperHaneStrokePreviewCanvas({
  frame,
  pageId,
}: {
  frame: PaperFrame;
  pageId: string;
}) {
  const targetId = `${pageId}:${frame.id}`;
  const preview = useHaneStrokePreviewStore((state) => (
    state.targetId === targetId && state.overlays.length > 0 ? state : null
  ));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderStyle = useMemo(() => buildPaperImageRenderStyle(frame), [frame]);
  const width = preview?.documentWidth
    ?? frame.asset?.pixelWidth
    ?? 1;
  const height = preview?.documentHeight
    ?? frame.asset?.pixelHeight
    ?? 1;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview) return;
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    if (canvas.width !== safeWidth) canvas.width = safeWidth;
    if (canvas.height !== safeHeight) canvas.height = safeHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, safeWidth, safeHeight);
    renderTiltmarkDabs(
      context,
      preview.overlays.flatMap((overlay) => overlay.dabs),
      { ephemeralOverlay: true },
    );
  }, [height, preview, width]);

  if (!preview) return null;
  return (
    <canvas
      aria-hidden="true"
      className="pointer-events-none"
      data-hane-stroke-preview="ephemeral"
      data-hane-stroke-preview-version={preview.version}
      height={Math.max(1, Math.round(height))}
      ref={canvasRef}
      style={{
        ...renderStyle,
        pointerEvents: 'none',
        zIndex: 1,
      }}
      width={Math.max(1, Math.round(width))}
    />
  );
}
