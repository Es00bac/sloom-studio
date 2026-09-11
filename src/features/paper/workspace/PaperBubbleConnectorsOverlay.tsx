import type { PaperFrame } from '../../../types/paper';
import { buildPaperCanvasBubbleConnectorLayers } from '../../../lib/paperCanvasStacking';
import {
  buildPaperBubbleConnectorSegments,
  getPaperBubbleCompoundFallbackSegments,
  paperBubbleCompoundStrokeDasharray,
  type PaperBubbleConnectorHandle,
  type PaperBubbleConnectorSegment,
} from '../../../lib/paperBubbleChains';
import { PAPER_SCREEN_PX_PER_MM as PX_PER_MM } from '../../../lib/paperLayoutTools';

export interface PaperBubbleConnectorsOverlayProps {
  frames: PaperFrame[];
  pageHeightMm: number;
  pageOriginXPx: number;
  pageOriginYPx: number;
  pageWidthMm: number;
  zoom: number;
  selectedFrameIds?: readonly string[];
  onBeginConnectorHandle?: (
    segment: PaperBubbleConnectorSegment,
    handle: PaperBubbleConnectorHandle,
  ) => void;
}

/** Non-interactive connector artwork, split into the frame-relative layers resolved by the canvas stack. */
export function PaperBubbleConnectorsOverlay({
  frames,
  pageHeightMm,
  pageOriginXPx,
  pageOriginYPx,
  pageWidthMm,
  zoom,
  selectedFrameIds = [],
  onBeginConnectorHandle,
}: PaperBubbleConnectorsOverlayProps) {
  const connectorLayers = buildPaperCanvasBubbleConnectorLayers(frames);
  if (!connectorLayers.length) return null;
  const framesById = new Map(frames.map((frame) => [frame.id, frame]));
  const selectedIds = new Set(selectedFrameIds);
  const compoundFallbackIds = new Set(getPaperBubbleCompoundFallbackSegments(frames).map((segment) => segment.id));
  const editableSegments = onBeginConnectorHandle
    ? buildPaperBubbleConnectorSegments(frames).filter((segment) => (
        segment.style === 'bridge'
        && (selectedIds.has(segment.fromFrameId) || selectedIds.has(segment.toFrameId))
      ))
    : [];
  const pageScale = PX_PER_MM * zoom;

  return (
    <>
      {connectorLayers.map(({ canvasZIndex, compoundShapes, segments }) => (
        <svg
          className="pointer-events-none absolute overflow-visible"
          data-paper-bubble-connectors="true"
          data-paper-canvas-z-index={canvasZIndex}
          key={canvasZIndex}
          preserveAspectRatio="none"
          style={{
            left: pageOriginXPx,
            top: pageOriginYPx,
            width: pageWidthMm * PX_PER_MM * zoom,
            height: pageHeightMm * PX_PER_MM * zoom,
            zIndex: canvasZIndex,
          }}
          viewBox={`0 0 ${pageWidthMm} ${pageHeightMm}`}
        >
          {compoundShapes.map((shape) => {
            const sourceFrame = framesById.get(shape.sourceFrameId);
            return (
              <path
                d={shape.path}
                data-paper-bubble-compound-id={shape.id}
                data-paper-bubble-compound-members={shape.memberFrameIds.join(' ')}
                fill={sourceFrame?.fillColor ?? '#ffffff'}
                fillOpacity={sourceFrame?.fillOpacity ?? 1}
                key={shape.id}
                stroke={sourceFrame?.strokeColor ?? '#111827'}
                strokeDasharray={paperBubbleCompoundStrokeDasharray(sourceFrame?.strokeStyle)}
                strokeLinejoin="round"
                strokeOpacity={sourceFrame?.strokeOpacity ?? 1}
                strokeWidth={Math.max(0.25, sourceFrame?.strokeWidthMm ?? 0.35)}
              />
            );
          })}
          {segments.map((segment) => {
            const fromFrame = framesById.get(segment.fromFrameId);
            const stroke = fromFrame?.strokeColor ?? '#111827';
            const strokeWidth = Math.max(0.25, fromFrame?.strokeWidthMm ?? 0.35);

            if (segment.style === 'bridge') {
              return (
                <polygon
                  data-paper-bubble-compound-fallback={compoundFallbackIds.has(segment.id) ? 'true' : undefined}
                  data-paper-bubble-connector-id={segment.id}
                  data-paper-bubble-connector-style={segment.style}
                  fill={fromFrame?.fillColor ?? '#ffffff'}
                  fillOpacity={fromFrame?.fillOpacity ?? 1}
                  key={segment.id}
                  points={segment.bridgePolygon.map((point) => `${point.xMm},${point.yMm}`).join(' ')}
                  stroke={stroke}
                  strokeDasharray={paperBubbleCompoundStrokeDasharray(fromFrame?.strokeStyle)}
                  strokeLinejoin="round"
                  strokeWidth={strokeWidth}
                />
              );
            }

            if (segment.style === 'thought-dots') {
              return (
                <g
                  data-paper-bubble-connector-id={segment.id}
                  data-paper-bubble-connector-style={segment.style}
                  key={segment.id}
                >
                  {segment.dots.map((dot, index) => (
                    <circle
                      cx={dot.xMm}
                      cy={dot.yMm}
                      fill={stroke}
                      key={`${segment.id}-${index}`}
                      opacity={0.88}
                      r={Math.max(0.8, strokeWidth * (2.6 - index * 0.18))}
                    />
                  ))}
                </g>
              );
            }

            if (segment.style === 'tail') {
              return (
                <path
                  d={`M ${segment.from.xMm} ${segment.from.yMm} Q ${segment.control.xMm} ${segment.control.yMm} ${segment.to.xMm} ${segment.to.yMm}`}
                  data-paper-bubble-connector-id={segment.id}
                  data-paper-bubble-connector-style={segment.style}
                  fill="none"
                  key={segment.id}
                  stroke={stroke}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={strokeWidth}
                />
              );
            }

            return (
              <line
                data-paper-bubble-connector-id={segment.id}
                data-paper-bubble-connector-style={segment.style}
                key={segment.id}
                stroke={stroke}
                strokeLinecap="round"
                strokeWidth={strokeWidth}
                x1={segment.from.xMm}
                x2={segment.to.xMm}
                y1={segment.from.yMm}
                y2={segment.to.yMm}
              />
            );
          })}
        </svg>
      ))}
      {editableSegments.length ? (
        <div
          className="pointer-events-none absolute"
          data-paper-bubble-connector-handles="true"
          style={{
            left: pageOriginXPx,
            top: pageOriginYPx,
            width: pageWidthMm * pageScale,
            height: pageHeightMm * pageScale,
            zIndex: 10_050,
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            preserveAspectRatio="none"
            viewBox={`0 0 ${pageWidthMm} ${pageHeightMm}`}
          >
            {editableSegments.map((segment) => (
              <g data-paper-bubble-connector-edit-id={segment.id} key={segment.id}>
                <path
                  d={`M ${segment.from.xMm} ${segment.from.yMm} C ${segment.control1.xMm} ${segment.control1.yMm} ${segment.control2.xMm} ${segment.control2.yMm} ${segment.to.xMm} ${segment.to.yMm}`}
                  fill="none"
                  stroke="rgba(8,145,178,0.9)"
                  strokeDasharray="1.2 1.2"
                  strokeWidth={0.35}
                />
                <line x1={segment.from.xMm} y1={segment.from.yMm} x2={segment.control1.xMm} y2={segment.control1.yMm} stroke="rgba(217,70,239,0.8)" strokeWidth={0.25} />
                <line x1={segment.to.xMm} y1={segment.to.yMm} x2={segment.control2.xMm} y2={segment.control2.yMm} stroke="rgba(217,70,239,0.8)" strokeWidth={0.25} />
              </g>
            ))}
          </svg>
          {editableSegments.flatMap((segment) => ([
            { handle: 'from-anchor' as const, point: segment.from, title: 'Move first balloon attachment', color: 'border-cyan-800 bg-cyan-200', shape: 'rounded-full' },
            { handle: 'to-anchor' as const, point: segment.to, title: 'Move second balloon attachment', color: 'border-cyan-800 bg-cyan-200', shape: 'rounded-full' },
            { handle: 'control-1' as const, point: segment.control1, title: 'Move first Bézier control', color: 'border-fuchsia-800 bg-fuchsia-200', shape: 'rounded-sm' },
            { handle: 'control-2' as const, point: segment.control2, title: 'Move second Bézier control', color: 'border-fuchsia-800 bg-fuchsia-200', shape: 'rounded-sm' },
            { handle: 'width' as const, point: segment.widthHandle, title: 'Change connector width', color: 'border-amber-800 bg-amber-200', shape: 'rotate-45 rounded-sm' },
          ].map((entry) => (
            <button
              aria-label={entry.title}
              className={`pointer-events-auto absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 border shadow ${entry.color} ${entry.shape}`}
              data-paper-bubble-connector-handle={entry.handle}
              key={`${segment.id}:${entry.handle}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                onBeginConnectorHandle?.(segment, entry.handle);
              }}
              style={{ left: entry.point.xMm * pageScale, top: entry.point.yMm * pageScale }}
              title={entry.title}
              type="button"
            />
          ))))}
          {editableSegments.some((segment) => compoundFallbackIds.has(segment.id)) ? (
            <div className="pointer-events-none absolute right-2 top-2 rounded border border-amber-300/50 bg-amber-950/90 px-2 py-1 text-[10px] font-semibold text-amber-100 shadow">
              Compound outline needs adjustment; move an attachment or reduce the curve.
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
