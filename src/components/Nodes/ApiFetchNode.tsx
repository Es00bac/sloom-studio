import { memo } from 'react';
import { Globe } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';
import { DeclaredOutputTypeSelect } from './DeclaredOutputTypeSelect';

function ApiFetchNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);

  const url = (data.url as string) ?? '';
  const method = (data.method as string) ?? 'GET';
  const headers = (data.headers as string) ?? '';
  const body = (data.body as string) ?? '';

  const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    patchNodeData(id, { url: event.target.value });
  };

  const handleMethodChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    patchNodeData(id, { method: event.target.value });
  };

  const handleHeadersChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    patchNodeData(id, { headers: event.target.value });
  };

  const handleBodyChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    patchNodeData(id, { body: event.target.value });
  };

  // Format response preview if present
  let responsePreview = '';
  if (data.result !== undefined) {
    if (typeof data.result === 'object' && data.result !== null) {
      try {
        responsePreview = JSON.stringify(data.result, null, 2);
      } catch {
        responsePreview = String(data.result);
      }
    } else {
      responsePreview = String(data.result);
    }
  }

  return (
    <BaseNode
      nodeId={id}
      nodeType="apiFetchNode"
      icon={Globe}
      title="API Requester"
      hasInput={true}
      hasOutput={true}
      onRun={data.onRun}
      isRunning={data.isRunning}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-teal-500/20 bg-teal-500/5 p-3 text-xs w-[280px]">
        <div className="flex gap-2">
          <div className="flex flex-col gap-1 w-1/3">
            <label className="font-semibold text-gray-200">Method:</label>
            <select
              value={method}
              onChange={handleMethodChange}
              className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 focus:border-teal-400 focus:outline-none"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 w-2/3">
            <label className="font-semibold text-gray-200">Endpoint URL:</label>
            <input
              type="text"
              value={url}
              onChange={handleUrlChange}
              placeholder="https://api.example.com/v1/..."
              className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 focus:border-teal-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="font-semibold text-gray-200">Headers (Name: Value):</label>
          <textarea
            value={headers}
            onChange={handleHeadersChange}
            rows={2}
            placeholder="Authorization: Bearer my_token&#10;Accept: application/json"
            className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 focus:border-teal-400 focus:outline-none resize-y"
          />
        </div>

        {method !== 'GET' && (
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-200">Body:</label>
            <textarea
              value={body}
              onChange={handleBodyChange}
              rows={4}
              placeholder='{\n  "prompt": "hello"\n}'
              className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 focus:border-teal-400 focus:outline-none resize-y"
            />
          </div>
        )}

        <DeclaredOutputTypeSelect
          allowedTypes={['text', 'json']}
          onChange={(value) => patchNodeData(id, { declaredOutputType: value })}
          value={data.declaredOutputType}
        />

        <div className="mt-1 leading-5 text-gray-400">
          Sends an HTTP request. Any upstream text input connected to the target handle on the left will override the URL field dynamically.
        </div>

        {responsePreview && (
          <div className="flex flex-col gap-1 mt-2 border-t border-teal-500/10 pt-2">
            <label className="font-semibold text-teal-400">Response Outcome:</label>
            <pre className="rounded-md border border-gray-800 bg-gray-950/80 p-2 font-mono text-[10px] text-teal-200/90 overflow-auto max-h-[150px] whitespace-pre-wrap break-all select-all">
              {responsePreview}
            </pre>
          </div>
        )}
      </div>
    </BaseNode>
  );
}

export const ApiFetchNode = memo(ApiFetchNodeComponent);
