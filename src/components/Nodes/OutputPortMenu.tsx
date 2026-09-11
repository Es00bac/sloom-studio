import { useEffect, useRef, useState } from 'react';
import { Position } from '@xyflow/react';
import { MoreHorizontal } from 'lucide-react';
import { TypedHandle as Handle } from './TypedHandle';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { useFlowStore } from '../../store/flowStore';
import type { NodeActionTemplate } from '../../lib/nodeActionMenu';

interface OutputPortMenuProps {
  nodeId: string;
  actions: NodeActionTemplate[];
  accentColor: string;
  hoverAccentColor: string;
  isLogicNode?: boolean;
  isGenericOutput?: boolean;
}

export function OutputPortMenu({ nodeId, actions, accentColor, hoverAccentColor, isLogicNode, isGenericOutput }: OutputPortMenuProps) {
  const addConnectedNode = useFlowStore((state) => state.addConnectedNode);
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen]);

  if (actions.length === 0) {
    return (
      <Handle
        type="source"
        position={Position.Right}
        className={`!w-6 !h-6 !border-[3px] !border-[#1e2027] !-mr-3 ${isGenericOutput ? 'sl-handle-triangle' : (isLogicNode ? '!rounded-none' : '!rounded-full')}`}
        style={{ backgroundColor: accentColor }}
      />
    );
  }

  return (
    <div className="pointer-events-none absolute right-0 top-1/2 z-30 -translate-y-1/2 translate-x-1/2">
      <Handle
        type="source"
        position={Position.Right}
        className={`nodrag nopan !pointer-events-auto !w-8 !h-8 !border-[3px] !border-[#1e2027] !shadow-lg ${isGenericOutput ? 'sl-handle-triangle' : (isLogicNode ? '!rounded-none' : '!rounded-full')}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen((value) => !value);
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.backgroundColor = hoverAccentColor;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.backgroundColor = accentColor;
        }}
        style={{ backgroundColor: accentColor }}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <MoreHorizontal size={13} className="text-white opacity-90" />
      </div>

      {isOpen ? (
        <div
          ref={menuRef}
          className="pointer-events-auto absolute left-6 top-1/2 min-w-[220px] -translate-y-1/2 rounded-3xl border border-gray-700/80 bg-[#2a2a31]/95 p-4 shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-3 text-sm font-semibold text-gray-400">Add new node</div>
          <div className="space-y-1">
            {actions.map((action) => (
              <button
                key={action.id}
                className={withFlowNodeInteractionClasses(`w-full rounded-2xl px-3 py-3 text-left text-sm transition-colors ${
                  action.disabled
                    ? 'cursor-not-allowed text-gray-600'
                    : 'text-white hover:bg-white/5'
                }`)}
                disabled={action.disabled}
                onClick={() => {
                  if (action.disabled || !action.targetType) {
                    return;
                  }

                  addConnectedNode(nodeId, action.targetType, action.targetHandle);
                  setIsOpen(false);
                }}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
