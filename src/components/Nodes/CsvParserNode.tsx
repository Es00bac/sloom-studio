import { memo } from 'react';
import { Position } from '@xyflow/react';
import { FileSpreadsheet } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function CsvParserNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const mode = (data.mode as string) ?? 'parse';
  const delimiter = (data.delimiter as string) ?? ',';

  const handleModeChange = (newMode: string) => {
    patchNodeData(id, { mode: newMode });
  };

  const handleDelimiterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    patchNodeData(id, { delimiter: event.target.value });
  };

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-emerald-400 ml-2">CSV</span>
        <span className="text-[10px] font-bold text-gray-400 ml-2">MD</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">DL</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="csv"
        className="!rounded-none"
        style={{ top: '25%', background: '#10b981', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="mode"
        className="!rounded-none"
        style={{ top: '50%', background: '#4b5563', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="delimiter"
        className="!rounded-none"
        style={{ top: '75%', background: '#6b7280', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="csvParserNode"
      icon={FileSpreadsheet}
      title="CSV Interop"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs w-[280px]">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Mode:</label>
          <div className="grid grid-cols-2 gap-1 rounded bg-black/40 p-0.5">
            <button
              type="button"
              onClick={() => handleModeChange('parse')}
              className={`rounded py-1 text-center font-medium transition ${
                mode === 'parse'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`}
            >
              Parse CSV
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('format')}
              className={`rounded py-1 text-center font-medium transition ${
                mode === 'format'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
              }`}
            >
              Format JSON
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-200">Delimiter:</label>
          <input
            type="text"
            value={delimiter}
            onChange={handleDelimiterChange}
            maxLength={3}
            placeholder=","
            className="w-12 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 font-mono text-[11px] text-gray-100 focus:border-emerald-400 focus:outline-none"
          />
        </div>

        <div className="leading-5 text-gray-400">
          {mode === 'parse' ? (
            <span>
              Parses incoming CSV string into a list of structured JSON records using the delimiter.
            </span>
          ) : (
            <span>
              Formats an incoming list of JSON objects into a flat delimited CSV text.
            </span>
          )}
        </div>
      </div>
    </BaseNode>
  );
}

export const CsvParserNode = memo(CsvParserNodeComponent);
