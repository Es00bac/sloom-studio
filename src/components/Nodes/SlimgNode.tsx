import { memo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Position } from '@xyflow/react';
import { FileImage, FolderOpen, ImageOff, Loader2, RefreshCw, Save } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { collectUpstreamImageInputForHandles, useFlowStore } from '../../store/flowStore';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { importSlimgFromDisk, readSlimgFromDisk, saveImageAsSlimg } from '../../lib/slimgNodeActions';
import { showUserNotice } from '../../shared/ui/userNotice';
import type { AppNodeProps } from '../../types/flow';

function PreviewBox({ label, url }: { label: string; url: string | undefined }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">{label}</div>
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-gray-700/70 bg-[#0b1018]">
        {url ? (
          <img src={url} alt={`${label} image`} className="h-full w-full object-contain" />
        ) : (
          <ImageOff size={18} className="text-gray-600" />
        )}
      </div>
    </div>
  );
}

const actionButtonClass = withFlowNodeInteractionClasses(
  'flex w-full items-center justify-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-2 font-semibold text-sky-100 transition-colors hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-50',
);

// The .slimg node is a FILE-CENTRIC bridge between Flow and Image (no auto-sync). It can capture a
// connected image into a new .slimg, import an existing .slimg to edit, and explicitly (re)read a saved
// .slimg from disk to produce its flattened output. Edit in Image, save the file, then click "Read from
// disk" to refresh what flows downstream.
function SlimgNodeComponent({ id, data }: AppNodeProps) {
  const inputUrl = useFlowStore(
    useShallow((state) =>
      collectUpstreamImageInputForHandles(
        id,
        ['image'],
        new Map(state.nodes.map((node) => [node.id, node])),
        state.edges,
      ),
    ),
  );
  const outputUrl = typeof data.result === 'string' && data.result ? data.result : undefined;
  const filePath = typeof data.slimgFilePath === 'string' && data.slimgFilePath ? data.slimgFilePath : undefined;
  const fileName = filePath ? filePath.split(/[\\/]/).pop() : undefined;
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<{ flattened: string; filePath?: string } | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      if (!result) return; // canceled
      data.onChange?.('result', result.flattened);
      if (result.filePath) data.onChange?.('slimgFilePath', result.filePath);
    } catch (error) {
      showUserNotice(error instanceof Error ? error.message : 'The .slimg operation failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const title =
    typeof data.customTitle === 'string' && data.customTitle.trim() ? data.customTitle.trim() : undefined;

  return (
    <BaseNode
      nodeId={id}
      nodeType="slimgNode"
      icon={FileImage}
      title=".slimg"
      hasInput={false}
      hasOutput
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
      customHandles={(
        <Handle
          id="image"
          type="target"
          position={Position.Left}
          className="!h-6 !w-6 !border-[3px] !border-[#1e2027] !-ml-3 !bg-sky-400"
          style={{ top: 96 }}
          title="Image input (optional)"
        />
      )}
    >
      <div className="w-[230px] space-y-3 rounded-lg border border-sky-400/20 bg-sky-400/5 p-3 text-xs">
        {inputUrl ? (
          <button
            type="button"
            onClick={() => run(() => saveImageAsSlimg(inputUrl, title))}
            disabled={busy}
            className={actionButtonClass}
            title="Save the connected image as a new .slimg and open it in Image"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save .slimg & Open
          </button>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => run(importSlimgFromDisk)}
            disabled={busy}
            className={actionButtonClass}
            title="Open an existing .slimg from disk to edit in Image"
          >
            <FolderOpen size={12} />
            Import
          </button>
          <button
            type="button"
            onClick={() => run(() => readSlimgFromDisk(filePath ?? ''))}
            disabled={busy || !filePath}
            className={actionButtonClass}
            title={
              filePath
                ? 'Re-read this node’s saved .slimg from disk into the output (run after editing + saving)'
                : 'Save or import a .slimg first'
            }
          >
            <RefreshCw size={12} />
            Read disk
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PreviewBox label="Input" url={inputUrl} />
          <PreviewBox label="Output" url={outputUrl} />
        </div>

        {fileName ? (
          <p className="truncate text-[10px] text-gray-400" title={filePath}>
            📄 {fileName}
          </p>
        ) : null}
        <p className="text-[10px] leading-4 text-gray-500">
          Edits in Image return here automatically when you close the tab (or “Save &amp; Return”).
          “Read disk” re-reads the file manually.
        </p>
      </div>
    </BaseNode>
  );
}

export const SlimgNode = memo(SlimgNodeComponent);
