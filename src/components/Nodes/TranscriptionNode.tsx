import { memo } from 'react';
import { Position } from '@xyflow/react';
import { Download, Subtitles } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { downloadAsset } from '../../lib/downloadAsset';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { TRANSCRIPTION_OUTPUT_HANDLES } from '../../lib/timedTranscript';
import { useSettingsStore } from '../../store/settingsStore';
import type { AppNodeProps, NodeOutputArtifact } from '../../types/flow';

const inputClassName = withFlowNodeInteractionClasses(
  'w-full rounded-lg border border-gray-700/60 bg-[#111217]/50 p-2 text-xs font-medium text-gray-200 outline-none focus:border-cyan-400',
);

const checkboxClassName = withFlowNodeInteractionClasses(
  'flex items-center gap-2 rounded-lg border border-gray-700/60 bg-[#111217]/25 px-2.5 py-2 text-[11px] text-gray-300',
);

function TranscriptionNodeComponent({ id, data }: AppNodeProps) {
  const apiKey = useSettingsStore((state) => state.apiKeys.elevenlabs);
  const providerConfigured = Boolean(apiKey.trim());
  const outputs = data.namedOutputs ?? {};
  const isCollapsed = Boolean(data.collapsed);
  const transcript = typeof data.result === 'string' ? data.result : '';
  const operation = data.transcriptionOperation ?? 'transcribe';

  const downloadOutput = async (output: NodeOutputArtifact | undefined) => {
    if (!output || typeof output.result !== 'string') return;
    await downloadAsset(output.result, output.fileName ?? `sloom-${output.extension ?? 'txt'}`);
  };

  const customHandles = (
    <>
      <div className="pointer-events-none absolute inset-y-0 right-2 flex flex-col justify-around text-right text-[9px] font-semibold text-gray-500">
        <span>Text</span>
        <span>Timed JSON</span>
        <span>VTT</span>
        <span>SRT</span>
      </div>
      <Handle id="media" position={Position.Left} style={{ left: -8, top: operation === 'align' ? '35%' : '50%' }} type="target" />
      {operation === 'align' ? (
        <Handle id="transcript" position={Position.Left} style={{ left: -8, top: '70%' }} type="target" />
      ) : null}
      <Handle id={TRANSCRIPTION_OUTPUT_HANDLES.text} position={Position.Right} style={{ right: -8, top: '20%' }} type="source" />
      <Handle id={TRANSCRIPTION_OUTPUT_HANDLES.timed} position={Position.Right} style={{ right: -8, top: '40%' }} type="source" />
      <Handle id={TRANSCRIPTION_OUTPUT_HANDLES.vtt} position={Position.Right} style={{ right: -8, top: '62%' }} type="source" />
      <Handle id={TRANSCRIPTION_OUTPUT_HANDLES.srt} position={Position.Right} style={{ right: -8, top: '82%' }} type="source" />
    </>
  );

  const preview = transcript ? (
    <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-cyan-400/20 bg-black/25 p-2 text-[11px] leading-5 text-gray-200">
      {transcript}
    </div>
  ) : (
    <div className="rounded-lg border border-dashed border-gray-700/60 p-3 text-center text-[11px] text-gray-500">
      {operation === 'align'
        ? 'Connect audio or video, provide the exact transcript, then align it.'
        : 'Connect audio or video, then run Scribe v2.'}
    </div>
  );

  return (
    <BaseNode
      collapsedContent={preview}
      customHandles={customHandles}
      error={data.error}
      hasInput={false}
      hasOutput={false}
      icon={Subtitles}
      isCollapsed={isCollapsed}
      isRunning={data.isRunning}
      nodeId={id}
      nodeType="transcriptionNode"
      onRun={data.onRun}
      onToggleCollapsed={() => data.onChange?.('collapsed', !isCollapsed)}
      retryState={data.retryState}
      runDisabledReason={providerConfigured ? undefined : 'Configure ElevenLabs in Settings before running this node.'}
      statusMessage={data.statusMessage}
      title={operation === 'align' ? 'Forced Alignment' : 'Transcription'}
    >
      <div className="space-y-2 pr-12">
        <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-2.5 py-2 text-[11px] text-cyan-50">
          {operation === 'align'
            ? 'ElevenLabs Forced Alignment · exact text + media'
            : 'ElevenLabs Scribe v2 · audio or video input'}
        </div>

        <label className="block space-y-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
          Operation
          <select
            className={inputClassName}
            onChange={(event) => data.onChange?.('transcriptionOperation', event.target.value)}
            value={operation}
          >
            <option value="transcribe">Transcribe with Scribe v2</option>
            <option value="align">Align known transcript</option>
          </select>
        </label>

        {operation === 'align' ? (
          <textarea
            aria-label="Known transcript"
            className={`${inputClassName} min-h-28 resize-y`}
            maxLength={675_000}
            onChange={(event) => data.onChange?.('transcriptionAlignmentText', event.target.value)}
            placeholder="Paste the exact spoken text, or connect a Text node to the Transcript handle."
            value={data.transcriptionAlignmentText ?? ''}
          />
        ) : (
          <label className="block space-y-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
            Language
            <input
              className={inputClassName}
              onChange={(event) => data.onChange?.('transcriptionLanguageCode', event.target.value)}
              placeholder="auto, en, ja…"
              value={data.transcriptionLanguageCode ?? 'auto'}
            />
          </label>
        )}

        {operation === 'transcribe' ? <><div className="grid grid-cols-2 gap-2">
          <label className={checkboxClassName}>
            <input
              checked={data.transcriptionDiarize ?? true}
              onChange={(event) => data.onChange?.('transcriptionDiarize', event.target.checked)}
              type="checkbox"
            />
            Speakers
          </label>
          <label className={checkboxClassName}>
            <input
              checked={data.transcriptionTagAudioEvents ?? true}
              onChange={(event) => data.onChange?.('transcriptionTagAudioEvents', event.target.checked)}
              type="checkbox"
            />
            Audio events
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            aria-label="Expected speakers"
            className={inputClassName}
            max={32}
            min={1}
            onChange={(event) => data.onChange?.('transcriptionNumSpeakers', event.target.value ? Number(event.target.value) : undefined)}
            placeholder="Speaker count"
            type="number"
            value={data.transcriptionNumSpeakers ?? ''}
          />
          <label className={checkboxClassName}>
            <input
              checked={data.transcriptionNoVerbatim ?? false}
              onChange={(event) => data.onChange?.('transcriptionNoVerbatim', event.target.checked)}
              type="checkbox"
            />
            Clean speech
          </label>
        </div>

        <textarea
          aria-label="Key terms"
          className={`${inputClassName} min-h-16 resize-y`}
          onChange={(event) => data.onChange?.('transcriptionKeyterms', event.target.value)}
          placeholder="Names or specialized terms, comma separated"
          value={data.transcriptionKeyterms ?? ''}
        /></> : null}

        {preview}

        {outputs[TRANSCRIPTION_OUTPUT_HANDLES.vtt] || outputs[TRANSCRIPTION_OUTPUT_HANDLES.srt] ? (
          <div className="flex gap-2">
            <button className={checkboxClassName} onClick={() => void downloadOutput(outputs[TRANSCRIPTION_OUTPUT_HANDLES.vtt])} type="button">
              <Download size={12} /> VTT
            </button>
            <button className={checkboxClassName} onClick={() => void downloadOutput(outputs[TRANSCRIPTION_OUTPUT_HANDLES.srt])} type="button">
              <Download size={12} /> SRT
            </button>
          </div>
        ) : null}
      </div>
    </BaseNode>
  );
}

export const TranscriptionNode = memo(TranscriptionNodeComponent);
