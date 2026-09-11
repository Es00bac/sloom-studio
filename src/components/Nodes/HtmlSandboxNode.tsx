import { memo, useMemo } from 'react';
import { Position } from '@xyflow/react';
import { MonitorPlay } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps } from '../../types/flow';

function HtmlSandboxNodeComponent({ id, data }: AppNodeProps) {
  const patchNodeData = useFlowStore((state) => state.patchNodeData);

  const html = (data.html as string) ?? '<div class="card">\n  <h3>Hello, World!</h3>\n  <p>Dynamic preview canvas</p>\n</div>';
  const css = (data.css as string) ?? '.card {\n  font-family: system-ui;\n  padding: 1rem;\n  background: linear-gradient(135deg, #4f46e5, #9333ea);\n  color: white;\n  border-radius: 8px;\n  text-align: center;\n}';
  const js = (data.js as string) ?? 'console.log("Sandbox script is running!");';

  const handleHtmlChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    patchNodeData(id, { html: event.target.value });
  };

  const handleCssChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    patchNodeData(id, { css: event.target.value });
  };

  const handleJsChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    patchNodeData(id, { js: event.target.value });
  };

  const iframeSrcDoc = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; padding: 8px; background: #030712; color: #f3f4f6; overflow: hidden; }
    ${css}
  </style>
</head>
<body>
  ${html}
  <script>${js}</script>
</body>
</html>`;
  }, [html, css, js]);

  const customHandles = (
    <>
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-around pointer-events-none pl-1">
        <span className="text-[10px] font-bold text-gray-500 ml-2">HTML</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">CSS</span>
        <span className="text-[10px] font-bold text-gray-500 ml-2">JS</span>
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="html"
        className="!rounded-none"
        style={{ top: '25%', background: '#4b5563', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="css"
        className="!rounded-none"
        style={{ top: '50%', background: '#4b5563', width: '10px', height: '10px' }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="js"
        className="!rounded-none"
        style={{ top: '75%', background: '#4b5563', width: '10px', height: '10px' }}
      />
    </>
  );

  return (
    <BaseNode
      nodeId={id}
      nodeType="htmlSandboxNode"
      icon={MonitorPlay}
      title="HTML Sandbox"
      hasInput={false}
      hasOutput={true}
      customHandles={customHandles}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs w-[320px]">
        {/* Editor tabs or stacked view */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-300 text-[11px]">HTML Markup:</label>
            <textarea
              value={html}
              onChange={handleHtmlChange}
              rows={3}
              className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 font-mono text-[10px] text-gray-200 focus:border-indigo-400 focus:outline-none resize-y"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-300 text-[11px]">CSS Styles:</label>
            <textarea
              value={css}
              onChange={handleCssChange}
              rows={2}
              className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 font-mono text-[10px] text-gray-200 focus:border-indigo-400 focus:outline-none resize-y"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-semibold text-gray-300 text-[11px]">JavaScript Action:</label>
            <textarea
              value={js}
              onChange={handleJsChange}
              rows={2}
              className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1 font-mono text-[10px] text-gray-200 focus:border-indigo-400 focus:outline-none resize-y"
            />
          </div>
        </div>

        {/* Live sandboxed iframe preview */}
        <div className="flex flex-col gap-1 mt-1">
          <span className="font-semibold text-gray-300 text-[11px]">Live Preview:</span>
          <div className="rounded-lg border border-gray-800 bg-gray-950 overflow-hidden h-[120px]">
            <iframe
              srcDoc={iframeSrcDoc}
              title="HTML Sandbox Output Preview"
              sandbox="allow-scripts"
              className="w-full h-full border-none bg-transparent"
            />
          </div>
        </div>
      </div>
    </BaseNode>
  );
}

export const HtmlSandboxNode = memo(HtmlSandboxNodeComponent);
