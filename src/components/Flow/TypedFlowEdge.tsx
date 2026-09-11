import {
  BaseEdge,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import {
  getFlowEdgePresentation,
  readFlowEdgeContract,
} from './flowEdgePresentation';
import { useFlowCardOcclusionEnabled } from './FlowCardOcclusion';
import {
  FLOW_CARD_CORNER_RADIUS,
  FLOW_CARD_OCCLUDER_CLIP_ID,
  flowCardRect,
  flowEdgeAttachedClipId,
  type FlowCardRect,
} from './flowCardOcclusion';

export function TypedFlowEdge({
  data,
  id,
  label,
  labelBgBorderRadius,
  labelBgPadding,
  labelBgStyle,
  labelShowBg,
  labelStyle,
  markerStart,
  selected,
  source,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  target,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps) {
  const contract = readFlowEdgeContract(data);
  const presentation = getFlowEdgePresentation(contract);
  const [path, labelX, labelY] = getBezierPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });
  const markerId = `typed-flow-arrow-${sanitizeSvgId(id)}`;
  const accessibleLabel = presentation.invalid
    ? `Invalid connection: ${contract?.reason ?? 'incompatible value types'}`
    : `${presentation.typeLabel} flows from ${source} to ${target}`;
  const strokeStyle = {
    ...style,
    stroke: presentation.color,
    strokeDasharray: presentation.dashArray,
    strokeWidth: presentation.strokeWidth,
  };

  // The wire paints above the node layer, so it is clipped out of every card
  // except the two it is attached to (see flowCardOcclusion).
  const occlusionEnabled = useFlowCardOcclusionEnabled();
  const sourceRect = flowCardRect(useInternalNode(source));
  const targetRect = flowCardRect(useInternalNode(target));
  const attachedRects = [sourceRect, targetRect].filter(
    (rect): rect is FlowCardRect => rect !== null,
  );
  const attachedClipId = flowEdgeAttachedClipId(id);

  const arrowMarker = (
    <marker
      id={markerId}
      markerHeight="8"
      markerUnits="strokeWidth"
      markerWidth="8"
      orient="auto"
      refX="7"
      refY="4"
      viewBox="0 0 8 8"
    >
      <path d="M 0 0 L 8 4 L 0 8 z" fill={presentation.color} />
    </marker>
  );

  const edgeBody = (
    <BaseEdge
      aria-label={accessibleLabel}
      className="typed-flow-edge-path"
      id={id}
      label={label ?? (selected ? presentation.typeLabel : undefined)}
      labelBgBorderRadius={labelBgBorderRadius}
      labelBgPadding={labelBgPadding}
      labelBgStyle={{ fill: '#111827', fillOpacity: 0.92, ...labelBgStyle }}
      labelShowBg={labelShowBg ?? true}
      labelStyle={{ fill: presentation.color, fontSize: 10, fontWeight: 700, ...labelStyle }}
      labelX={labelX}
      labelY={labelY}
      markerEnd={`url(#${markerId})`}
      markerStart={markerStart}
      path={path}
      style={strokeStyle}
    />
  );

  if (!occlusionEnabled) {
    return (
      <>
        <defs>{arrowMarker}</defs>
        {edgeBody}
      </>
    );
  }

  return (
    <>
      <defs>
        {arrowMarker}
        {attachedRects.length > 0 ? (
          <clipPath clipPathUnits="userSpaceOnUse" id={attachedClipId}>
            {attachedRects.map((rect, index) => (
              <rect
                height={rect.height}
                key={index}
                rx={FLOW_CARD_CORNER_RADIUS}
                width={rect.width}
                x={rect.x}
                y={rect.y}
              />
            ))}
          </clipPath>
        ) : null}
      </defs>
      <g clipPath={`url(#${FLOW_CARD_OCCLUDER_CLIP_ID})`}>{edgeBody}</g>
      {attachedRects.length > 0 ? (
        <g clipPath={`url(#${attachedClipId})`} style={{ pointerEvents: 'none' }}>
          <path
            className="typed-flow-edge-path"
            d={path}
            data-testid="typed-flow-edge-attached-path"
            fill="none"
            markerEnd={`url(#${markerId})`}
            markerStart={markerStart}
            style={strokeStyle}
          />
        </g>
      ) : null}
    </>
  );
}

function sanitizeSvgId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}
