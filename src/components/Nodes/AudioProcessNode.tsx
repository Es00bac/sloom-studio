import { memo } from 'react';
import { Position } from '@xyflow/react';
import { AudioLines, Download, WandSparkles } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { downloadAsset } from '../../lib/downloadAsset';
import { AUDIO_PROCESS_OUTPUT_HANDLES } from '../../lib/audioProcess';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { useSettingsStore } from '../../store/settingsStore';
import type { AppNodeProps } from '../../types/flow';

const buttonClassName = withFlowNodeInteractionClasses(
  'inline-flex items-center justify-center gap-2 rounded-lg border border-teal-300/20 bg-teal-300/5 px-2.5 py-2 text-[11px] font-semibold text-teal-50 transition hover:border-teal-200/50',
);

function AudioProcessNodeComponent({ id, data }: AppNodeProps) {
  const apiKey = useSettingsStore((state) => state.apiKeys.elevenlabs);
  const providerConfigured = Boolean(apiKey.trim());
  const isCollapsed = Boolean(data.collapsed);
  const output = data.namedOutputs?.[AUDIO_PROCESS_OUTPUT_HANDLES.isolatedAudio];

  const customHandles = (
    <>
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-right text-[9px] font-semibold text-gray-500">
        Dialogue
      </div>
      <Handle id="media" position={Position.Left} style={{ left: -8, top: '50%' }} type="target" />
      <Handle id={AUDIO_PROCESS_OUTPUT_HANDLES.isolatedAudio} position={Position.Right} style={{ right: -8, top: '50%' }} type="source" />
    </>
  );

  const preview = output && typeof output.result === 'string' ? (
    <audio className="w-full" controls preload="metadata" src={output.result} />
  ) : (
    <div className="rounded-lg border border-dashed border-gray-700/60 p-3 text-center text-[11px] text-gray-500">
      Connect audio or video, then isolate its dialogue.
    </div>
  );

  return (
    <BaseNode
      collapsedContent={preview}
      customHandles={customHandles}
      error={data.error}
      hasInput={false}
      hasOutput={false}
      icon={AudioLines}
      isCollapsed={isCollapsed}
      isRunning={data.isRunning}
      nodeId={id}
      nodeType="audioProcessNode"
      onRun={data.onRun}
      onToggleCollapsed={() => data.onChange?.('collapsed', !isCollapsed)}
      retryState={data.retryState}
      runDisabledReason={providerConfigured ? undefined : 'Configure ElevenLabs in Settings before running this node.'}
      statusMessage={data.statusMessage}
      title="Audio Process"
    >
      <div className="space-y-3 pr-12">
        <div className="rounded-lg border border-teal-300/20 bg-teal-300/5 px-2.5 py-2 text-[11px] text-teal-50">
          <span className="flex items-center gap-2 font-semibold"><WandSparkles size={13} /> Isolate Voice</span>
          <span className="mt-1 block text-teal-100/65">Removes music, room noise, and ambience while preserving spoken dialogue. ElevenLabs requires at least 4.6 seconds of source audio.</span>
        </div>
        {preview}
        {output && typeof output.result === 'string' ? (
          <button
            className={buttonClassName}
            onClick={() => void downloadAsset(output.result as string, output.fileName ?? `isolated-dialogue.${output.extension ?? 'mp3'}`)}
            type="button"
          >
            <Download size={12} /> Download isolated audio
          </button>
        ) : null}
        <p className="text-[10px] leading-4 text-gray-500">The original source is never changed. Video can place this result on a separate audio lane for A/B mixing.</p>
      </div>
    </BaseNode>
  );
}

export const AudioProcessNode = memo(AudioProcessNodeComponent);
