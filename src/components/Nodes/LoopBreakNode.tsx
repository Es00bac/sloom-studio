import { memo } from 'react';
import { Position } from '@xyflow/react';
import { OctagonX } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function LoopBreakNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const reason = typeof data.loopBreakReason === 'string' ? data.loopBreakReason : '';

  const customHandles = (
    <>
      <div className="pointer-events-none absolute bottom-3 left-2 text-[9px] font-bold uppercase tracking-[0.12em] text-rose-100/60">
        IF
      </div>
      <Handle
        className="!h-4 !w-4 !rounded-sm !border-2 !border-[#111827] !bg-amber-300"
        id="condition"
        position={Position.Left}
        style={{ top: '72%' }}
        type="target"
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="loopBreakNode"
      icon={OctagonX}
      title="Stop When"
      hasInput={false}
      hasOutput
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="space-y-3 rounded-lg border border-rose-400/25 bg-rose-500/10 p-3 text-xs">
        <div className="rounded-md border border-rose-300/20 bg-black/20 px-2.5 py-2 leading-5 text-rose-50/85">
          Stops a connected batch before the current iteration runs when the IF input is true.
        </div>
        <label className="block">
          <span className="mb-1.5 block font-semibold text-gray-200">Reason shown when stopped</span>
          <input
            className={withFlowNodeInteractionClasses('w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100 outline-none focus:border-rose-300')}
            onChange={(event) => patchNodeData(id, { loopBreakReason: event.target.value })}
            placeholder="accepted result"
            value={reason}
          />
        </label>
        <div className="text-[11px] leading-4 text-gray-400">
          Connect this node to a generator's small stop handle. Truthy values are true, 1, yes, or on.
        </div>
      </div>
    </BaseNode>
  );
}

export const LoopBreakNode = memo(LoopBreakNodeComponent);
