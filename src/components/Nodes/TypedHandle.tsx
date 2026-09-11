import {
  Handle as ReactFlowHandle,
  useNodeId,
} from '@xyflow/react';
import { useContext } from 'react';
import type { ComponentProps, CSSProperties } from 'react';
import {
  resolveFlowOutputType,
} from '../../lib/flowConnectionContracts';
import {
  resolveFlowNodePorts,
  type FlowPortContract,
} from '../../lib/flowNodeContracts';
import { useFlowStore } from '../../store/flowStore';
import { FlowNodeHandleContext } from './flowNodeHandleContext';
import { getTypedHandlePresentation } from './typedHandlePresentation';

export type TypedHandleProps = ComponentProps<typeof ReactFlowHandle> & {
  contract?: FlowPortContract;
};

export function TypedHandle({
  className,
  contract: explicitContract,
  id,
  isConnectable,
  position,
  style,
  title,
  type,
  ...props
}: TypedHandleProps) {
  const explicitNodeId = useContext(FlowNodeHandleContext);
  const reactFlowNodeId = useNodeId();
  const contextNodeId = explicitNodeId ?? reactFlowNodeId;
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const node = contextNodeId
    ? nodes.find((candidate) => candidate.id === contextNodeId)
    : undefined;
  const handleId = id || null;
  const direction = type === 'source' ? 'output' : 'input';
  const contract = explicitContract ?? (node
    ? resolveFlowNodePorts({ node, nodes, edges }).find((candidate) =>
      candidate.direction === direction && candidate.id === handleId
    )
    : undefined);
  const connectedEdge = node
    ? edges.find((edge) => type === 'source'
      ? edge.source === node.id && (edge.sourceHandle || null) === handleId
      : edge.target === node.id && (edge.targetHandle || null) === handleId)
    : undefined;
  const carriedType = node && type === 'source'
    ? resolveFlowOutputType(node.id, handleId, { nodes, edges })
    : connectedEdge
      ? resolveFlowOutputType(connectedEdge.source, connectedEdge.sourceHandle, { nodes, edges })
      : undefined;
  const fallbackContract = contract ?? fallbackPortContract(handleId, direction);
  const presentation = getTypedHandlePresentation(fallbackContract, carriedType);
  const disabled = presentation.disabled || isConnectable === false;

  return (
    <ReactFlowHandle
      {...props}
      aria-disabled={presentation.disabled || undefined}
      aria-label={title ?? presentation.title}
      className={`typed-flow-handle typed-flow-handle--${type} nodrag nopan ${presentation.disabled ? 'typed-flow-handle--disabled' : ''} ${className ?? ''}`}
      data-flow-port-direction={presentation.direction}
      data-flow-port-disabled={presentation.disabled ? 'true' : 'false'}
      data-flow-port-type={presentation.typeLabel}
      data-flow-port-resolved={contract ? 'true' : 'false'}
      data-flow-node-id={contextNodeId ?? undefined}
      data-flow-node-resolved={node ? 'true' : 'false'}
      id={id}
      isConnectable={!disabled}
      position={position}
      style={{
        ...style,
        '--flow-port-color': presentation.color,
        backgroundColor: presentation.color,
      } as CSSProperties}
      title={title ?? presentation.title}
      type={type}
    />
  );
}

function fallbackPortContract(
  id: string | null,
  direction: FlowPortContract['direction'],
): FlowPortContract {
  return {
    id,
    direction,
    label: id ?? (direction === 'input' ? 'Input' : 'Output'),
    help: 'This legacy handle does not yet have a resolved node contract.',
    types: [{ kind: 'unknown' }],
    required: false,
    minConnections: 0,
    maxConnections: direction === 'input' ? 1 : null,
    ordered: false,
    side: direction === 'input' ? 'left' : 'right',
  };
}
