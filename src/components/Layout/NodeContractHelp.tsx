import type { FlowNodeType, NodeData } from '../../types/flow';
import {
  getFlowNodeContract,
  resolveFlowNodePorts,
} from '../../lib/flowNodeContracts';
import { describeFlowDataType } from '../../lib/flowPortTypes';

export interface NodeContractHelpProps {
  nodeType: FlowNodeType;
  initialData?: Partial<NodeData>;
}

export function NodeContractHelp({ nodeType, initialData = {} }: NodeContractHelpProps) {
  const contract = getFlowNodeContract(nodeType);
  const node = {
    id: `help-${nodeType}`,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: initialData,
  } as const;
  const ports = resolveFlowNodePorts({ node, nodes: [node], edges: [] });
  const inputs = ports.filter((port) => port.direction === 'input');
  const outputs = ports.filter((port) => port.direction === 'output');
  const example = contract.examples[0];

  return (
    <details className="mt-1.5 rounded border border-gray-700/60 bg-[#090e16]/55 px-2 py-1.5 text-[9px] text-gray-400">
      <summary className="cursor-pointer select-none font-semibold uppercase tracking-[0.12em] text-cyan-100/70">
        Connections &amp; example
      </summary>
      <div className="mt-2 space-y-2 leading-4">
        <p className="text-gray-300">{contract.purpose}</p>
        <PortList label="Input" ports={inputs} />
        <PortList label="Output" ports={outputs} />
        <div>
          <div className="font-semibold text-gray-300">Failure</div>
          <ul className="list-disc pl-4">
            {contract.failureModes.map((failure) => <li key={failure}>{failure}</li>)}
          </ul>
        </div>
        {example ? (
          <div>
            <div className="font-semibold text-gray-300">{example.title}</div>
            <p>{example.description}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function PortList({
  label,
  ports,
}: {
  label: string;
  ports: ReturnType<typeof resolveFlowNodePorts>;
}) {
  return (
    <div>
      <div className="font-semibold text-gray-300">{label}</div>
      {ports.length > 0 ? (
        <ul className="space-y-0.5">
          {ports.map((port) => (
            <li key={`${port.direction}-${port.id ?? 'default'}`}>
              {port.label} · {port.types.map(describeFlowDataType).join('/')}
              {port.required ? ' · required' : ''}
              {port.disabledReason ? ` · unavailable — ${port.disabledReason}` : ''}
            </li>
          ))}
        </ul>
      ) : <div>None</div>}
    </div>
  );
}
