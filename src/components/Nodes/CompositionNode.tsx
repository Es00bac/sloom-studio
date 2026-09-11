import { memo, useEffect, useMemo, useState } from 'react';
import { Position } from '@xyflow/react';
import { Download, ExternalLink, Film, Music2, Plus, Volume2, VolumeX } from 'lucide-react';
import { AttemptHistory } from './AttemptHistory';
import { BaseNode } from './BaseNode';
import { TypedHandle as Handle } from './TypedHandle';
import { ExecutionTelemetryPanel } from './ExecutionTelemetryPanel';
import { MediaLoadingOverlay } from './MediaLoadingOverlay';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import { getEditorAudioClips, getEditorVisualClips } from '../../lib/manualEditorState';
import {
  buildCompositionMediaSignature,
  mergeDurationMap,
  parseCompositionMediaSignature,
} from '../../lib/compositionMediaState';
import { buildDownloadFilename, downloadAsset } from '../../lib/downloadAsset';
import { EXPORT_BASENAME } from '../../lib/brand';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { assignVariableToResultAttempt } from '../../lib/flowVariables';
import { resultValueAsMediaUrl } from '../../lib/flowResultValues';
import {
  COMPOSITION_AUDIO_HANDLES,
  COMPOSITION_VIDEO_HANDLE,
  formatCompositionAudioMigrationWarningMessage,
  functionNodeMatchesCompositionMediaFamily,
  getCompositionTrackKeys,
  getCompositionTrackSettings,
  getConnectedCompositionAudioHandles,
  resolveCompositionAudioTrackModel,
} from '../../lib/compositionTracks';
import type { CompositionMediaFamily } from '../../lib/compositionTracks';
import { isCompositionVideoConnection } from '../../lib/compositionEdgeMigration';
import { resolveEffectiveSourceNode } from '../../lib/virtualNodes';
import { useEditorStore } from '../../store/editorStore';
import { resolveNodeOutputAsset, useFlowStore } from '../../store/flowStore';
import type {
  AppNode,
  AppNodeProps,
  CompositionTargetHandle,
  SerializableNodeValue,
} from '../../types/flow';

const TIMELINE_OPTIONS = [10, 20, 30, 45, 60];

const actionButtonClassName = withFlowNodeInteractionClasses(
  'inline-flex items-center gap-1 rounded-lg border border-gray-700/60 bg-[#111217]/40 px-2.5 py-1.5 text-[11px] font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white',
);

interface ConnectedMedia {
  handle: CompositionTargetHandle;
  nodeId: string;
  label: string;
  resultType: 'video' | 'audio';
  url: string;
}

function CompositionNodeComponent({ id, data }: AppNodeProps) {
  const connectionSignature = useFlowStore((state) => {
    const video = findConnectedMedia(state.nodes, state.edges, id, COMPOSITION_VIDEO_HANDLE, ['videoGen', 'composition', 'functionNode'], 'video');
    const audio = COMPOSITION_AUDIO_HANDLES.map((handle) =>
      findConnectedMedia(state.nodes, state.edges, id, handle, ['audioGen', 'audioProcessNode', 'functionNode'], 'audio'),
    );
    const primary = [video, ...audio].filter(Boolean) as ConnectedMedia[];
    const connectedAudioHandles = getConnectedCompositionAudioHandles(id, state.edges);
    return [
      buildCompositionMediaSignature(primary),
      primary.map((entry) => entry.label).join(''),
      connectedAudioHandles.join(''),
    ].join('');
  });
  const { connectedVideo, connectedAudioTracks, connectedAudioHandleIds } = useMemo(() => {
    void connectionSignature;
    const state = useFlowStore.getState();
    const video = findConnectedMedia(
      state.nodes,
      state.edges,
      id,
      COMPOSITION_VIDEO_HANDLE,
      ['videoGen', 'composition', 'functionNode'],
      'video',
    );
    const audio = COMPOSITION_AUDIO_HANDLES.map((handle) =>
      findConnectedMedia(state.nodes, state.edges, id, handle, ['audioGen', 'audioProcessNode', 'functionNode'], 'audio'),
    );
    // Handle visibility must track the raw connection model (contracts and execution use it
    // the same way), not whether the connected source has produced media yet (FBL-019): an
    // explicitly connected higher track with no result yet must still show its slot and Handle.
    const connectedAudioHandleIds = getConnectedCompositionAudioHandles(id, state.edges);
    return { connectedVideo: video, connectedAudioTracks: audio, connectedAudioHandleIds };
  }, [connectionSignature, id]);
  const openEditorForComposition = useEditorStore((state) => state.openEditorForComposition);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const isCollapsed = Boolean(data.collapsed);
  const manualVisualClipCount = getEditorVisualClips(data).length;
  const manualAudioClipCount = getEditorAudioClips(data).length;
  const mediaSources = [connectedVideo, ...connectedAudioTracks].filter(Boolean) as ConnectedMedia[];
  const mediaSignature = buildCompositionMediaSignature(mediaSources);
  const stableMediaSources = useMemo(() => parseCompositionMediaSignature(mediaSignature), [mediaSignature]);
  const visibleAudioHandles = resolveCompositionAudioTrackModel(data.compositionAudioTrackCount, connectedAudioHandleIds).handles;
  const visibleAudioTrackCount = visibleAudioHandles.length;

  const hasPackageResult = data.resultType === 'package';
  const previewUrl = hasPackageResult
    ? connectedVideo?.url
    : resultValueAsMediaUrl(data.result) ?? connectedVideo?.url;
  const connectedVideoDuration = connectedVideo ? durations[connectedVideo.nodeId] ?? 0 : 0;
  const videoAudioSettings = getCompositionTrackSettings(data, COMPOSITION_VIDEO_HANDLE);

  useEffect(() => {
    let cancelled = false;

    const loadDurations = async () => {
      const entries = await Promise.all(
        stableMediaSources.map(async (media) => [media.nodeId, await getMediaDuration(media.url, media.resultType)] as const),
      );

      if (cancelled) {
        return;
      }

      setDurations((current) => mergeDurationMap(current, entries));
    };

    if (stableMediaSources.length > 0) {
      void loadDurations();
    }

    return () => {
      cancelled = true;
    };
  }, [stableMediaSources]);

  const computedTimelineSeconds = Math.max(
    Number(data.compositionTimelineSeconds ?? 30),
    Math.ceil(connectedVideoDuration),
    ...visibleAudioHandles.map((handle) => {
      const media = connectedAudioTracks[COMPOSITION_AUDIO_HANDLES.indexOf(handle)];
      const trackSettings = getCompositionTrackSettings(data, handle);
      const duration = media ? durations[media.nodeId] ?? 0 : 0;
      return Math.ceil(duration + trackSettings.offsetMs / 1000);
    }),
  );

  const handleDownload = async () => {
    const result = resultValueAsMediaUrl(data.result);
    if (!result) {
      return;
    }

    await downloadAsset(result, buildDownloadFilename(`${EXPORT_BASENAME}-composition`, 'video/mp4', 'mp4'));
  };

  const updateTrackField = (handle: CompositionTargetHandle, key: 'offsetKey' | 'volumeKey' | 'enabledKey', value: SerializableNodeValue) => {
    const trackKeys = getCompositionTrackKeys(handle);
    const targetKey = trackKeys[key] as string | undefined;

    if (targetKey) {
      data.onChange?.(targetKey, value);
    }
  };

  const shiftTrackFromPointer = (
    event: React.PointerEvent<HTMLDivElement>,
    handle: CompositionTargetHandle,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const lane = event.currentTarget;
    const rect = lane.getBoundingClientRect();

    const updateFromClientX = (clientX: number) => {
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const nextOffsetMs = Math.round(ratio * computedTimelineSeconds * 1000);
      updateTrackField(handle, 'offsetKey', nextOffsetMs);
    };

    updateFromClientX(event.clientX);

    const onMove = (moveEvent: PointerEvent) => {
      updateFromClientX(moveEvent.clientX);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const previewPanel = (
    <div className="rounded-xl border border-gray-700/60 bg-[#101116] p-2 shadow-inner">
      <div className="relative">
        {previewUrl ? (
          <div className="aspect-video overflow-hidden rounded-lg bg-black">
            <video
              className={`h-full w-full object-contain ${data.isRunning ? 'pointer-events-none opacity-50 blur-[2px]' : ''}`}
              controls={!data.isRunning}
              src={previewUrl}
            />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-gray-700/60 bg-[#111217]/40 text-sm text-gray-500">
            Your generation will appear here
          </div>
        )}

        {data.isRunning ? (
          <MediaLoadingOverlay
            detail="The browser is mixing tracks locally. Playback is locked until the composition is finished."
            title="Building composition"
          />
        ) : null}
      </div>
    </div>
  );

  return (
    <BaseNode
      collapsedContent={
        <div className="space-y-2">
          {previewPanel}
          <div className="rounded-lg border border-gray-700/60 bg-[#111217]/30 px-2.5 py-2 text-[11px] text-gray-300">
            {manualVisualClipCount} visual clips · {manualAudioClipCount} audio clips
          </div>
        </div>
      }
      nodeId={id}
      icon={Film}
      nodeType="composition"
      isCollapsed={isCollapsed}
      title="Composition"
      hasInput={false}
      containerClassName={isCollapsed ? 'w-[360px] max-w-[60vw]' : 'w-[760px] max-w-[86vw]'}
      outputActions={getCompatibleNodeActions('composition')}
      onRun={data.onRun}
      isRunning={data.isRunning}
      error={data.error ?? formatCompositionAudioMigrationWarningMessage(data.compositionAudioMigrationWarnings)}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
      onToggleCollapsed={() => data.onChange?.('collapsed', !isCollapsed)}
      footerActions={
        <>
          <button className={actionButtonClassName} onClick={() => openEditorForComposition(id)} type="button">
            <ExternalLink size={12} />
            Open in Video
          </button>
          {data.result ? (
            <button className={actionButtonClassName} onClick={() => void handleDownload()} type="button">
              <Download size={12} />
              Save
            </button>
          ) : null}
        </>
      }
    >
      <AttemptHistory
        attempts={data.resultHistory}
        onAssignVariable={(attemptId, variableName) => data.onChange?.('resultHistory', assignVariableToResultAttempt(data.resultHistory, attemptId, variableName))}
        onSelectAttempt={data.onSelectAttempt}
        selectedAttemptId={data.selectedResultId}
      />

      <ExecutionTelemetryPanel nodeId={id} usage={data.usage} />

      {manualVisualClipCount > 0 || manualAudioClipCount > 0 ? (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-2.5 py-2 text-[11px] text-blue-100">
          Manual editor sequence attached: {manualVisualClipCount} visual clip{manualVisualClipCount === 1 ? '' : 's'} and {manualAudioClipCount} audio clip{manualAudioClipCount === 1 ? '' : 's'}.
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr]">
        {previewPanel}

        <div className="space-y-3 rounded-xl border border-gray-700/60 bg-[#111217]/35 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
              Timeline
              <select
                className="nodrag nopan rounded-lg border border-gray-700/60 bg-[#111217]/60 px-2 py-2 text-xs font-medium text-gray-200 outline-none"
                onChange={(event) => data.onChange?.('compositionTimelineSeconds', Number(event.target.value))}
                value={String(data.compositionTimelineSeconds ?? 30)}
              >
                {TIMELINE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}s
                  </option>
                ))}
              </select>
            </label>

            <label className="nodrag nopan flex items-end gap-2 rounded-lg border border-gray-700/60 bg-[#111217]/40 px-3 py-2 text-xs text-gray-300">
              <input
                checked={Boolean(data.compositionUseVideoAudio)}
                onChange={(event) => data.onChange?.('compositionUseVideoAudio', event.target.checked)}
                type="checkbox"
              />
              Use video audio
            </label>
          </div>

          <button
            className="nodrag nopan inline-flex items-center gap-1 rounded-lg border border-gray-700/60 bg-[#111217]/40 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
            disabled={visibleAudioTrackCount >= 4}
            onClick={() => data.onChange?.('compositionAudioTrackCount', Math.min(4, visibleAudioTrackCount + 1))}
            type="button"
          >
            <Plus size={12} />
            Add audio track
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-700/60 bg-[#111217]/30 p-3">
        <TimelineRuler timelineSeconds={computedTimelineSeconds} />

        <TrackLane
          durationSeconds={connectedVideoDuration}
          handleId={COMPOSITION_VIDEO_HANDLE}
          icon={<Film size={12} />}
          label="Video"
          media={connectedVideo}
          timelineSeconds={computedTimelineSeconds}
        />

        {Boolean(data.compositionUseVideoAudio) && connectedVideo ? (
          <TrackLane
            accentClassName="bg-cyan-500/60"
            durationSeconds={connectedVideoDuration}
            icon={<Volume2 size={12} />}
            label="Video Audio"
            media={{
              ...connectedVideo,
              handle: COMPOSITION_VIDEO_HANDLE,
              resultType: 'audio',
            }}
            timelineSeconds={computedTimelineSeconds}
          />
        ) : null}

        {Boolean(data.compositionUseVideoAudio) && connectedVideo ? (
          <div className="mt-2 grid grid-cols-[120px_1fr] items-center gap-3 pl-0">
            <div />
            <label className="nodrag nopan flex items-center gap-2 text-[11px] text-gray-400">
              Video audio volume
              <input
                className="nodrag nopan w-full"
                max="150"
                min="0"
                onChange={(event) => data.onChange?.('compositionVideoAudioVolume', Number(event.target.value))}
                type="range"
                value={String(videoAudioSettings.volumePercent)}
              />
              <span className="w-8 text-right text-gray-300">{videoAudioSettings.volumePercent}%</span>
            </label>
          </div>
        ) : null}

        <div className="mt-3 space-y-3">
          {visibleAudioHandles.map((handle) => {
            const media = connectedAudioTracks[COMPOSITION_AUDIO_HANDLES.indexOf(handle)];
            const trackSettings = getCompositionTrackSettings(data, handle);

            return (
              <AudioTrackControls
                key={handle}
                durationSeconds={media ? durations[media.nodeId] ?? 0 : 0}
                enabled={trackSettings.enabled}
                handle={handle}
                label={handle.replace('composition-', '').replace('-', ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
                media={media}
                offsetMs={trackSettings.offsetMs}
                onEnabledChange={(value) => updateTrackField(handle, 'enabledKey', value)}
                onOffsetChange={(value) => updateTrackField(handle, 'offsetKey', value)}
                onTimelinePointerDown={shiftTrackFromPointer}
                onVolumeChange={(value) => updateTrackField(handle, 'volumeKey', value)}
                timelineSeconds={computedTimelineSeconds}
                volumePercent={trackSettings.volumePercent}
              />
            );
          })}
        </div>
      </div>
    </BaseNode>
  );
}

export const CompositionNode = memo(CompositionNodeComponent);

function TimelineRuler({ timelineSeconds }: { timelineSeconds: number }) {
  const markers = Array.from({ length: Math.max(2, timelineSeconds + 1) }, (_, index) => index);

  return (
    <div className="mb-2 flex items-center text-[10px] text-gray-500">
      {markers.map((marker) => (
        <div key={marker} className="flex-1 border-l border-gray-800/60 pl-1">
          {marker === 0 ? '0' : `${marker}s`}
        </div>
      ))}
    </div>
  );
}

function TrackLane({
  label,
  media,
  durationSeconds,
  timelineSeconds,
  icon,
  handleId,
  offsetMs = 0,
  onPointerDown,
  accentClassName = 'bg-violet-500/60',
}: {
  label: string;
  media?: ConnectedMedia;
  durationSeconds: number;
  timelineSeconds: number;
  icon: React.ReactNode;
  handleId?: CompositionTargetHandle;
  offsetMs?: number;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  accentClassName?: string;
}) {
  const leftPercent = Math.min(100, (offsetMs / 1000 / timelineSeconds) * 100);
  const widthPercent = Math.min(100, ((durationSeconds || 0.01) / timelineSeconds) * 100);

  return (
    <div className="relative grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
      {handleId ? <CompositionTrackHandle id={handleId} label={label} /> : null}
      <div className="flex items-center gap-2 rounded-lg border border-gray-700/60 bg-[#0f1016] px-3 py-2 text-sm text-gray-200">
        {icon}
        <div className="min-w-0">
          <div className="font-medium">{label}</div>
          <div className="truncate text-[11px] text-gray-500">{media?.label ?? 'Connect media'}</div>
        </div>
      </div>

      <div
        className="nodrag nopan relative h-12 rounded-xl border border-gray-700/60 bg-[#0f1016]"
        onPointerDown={onPointerDown}
      >
        {media ? (
          <div
            className={`absolute top-1/2 flex h-8 -translate-y-1/2 items-center rounded-lg px-3 text-xs font-semibold text-white shadow-lg ${accentClassName}`}
            style={{
              left: `${leftPercent}%`,
              width: `${Math.max(widthPercent, 8)}%`,
            }}
          >
            <span className="truncate">{media.label}</span>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-gray-500">Connect media here</div>
        )}
      </div>
    </div>
  );
}

function AudioTrackControls({
  handle,
  label,
  media,
  durationSeconds,
  timelineSeconds,
  offsetMs,
  volumePercent,
  enabled,
  onOffsetChange,
  onVolumeChange,
  onEnabledChange,
  onTimelinePointerDown,
}: {
  handle: CompositionTargetHandle;
  label: string;
  media?: ConnectedMedia;
  durationSeconds: number;
  timelineSeconds: number;
  offsetMs: number;
  volumePercent: number;
  enabled: boolean;
  onOffsetChange: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onEnabledChange: (value: boolean) => void;
  onTimelinePointerDown: (event: React.PointerEvent<HTMLDivElement>, handle: CompositionTargetHandle) => void;
}) {
  return (
    <div className="space-y-2">
      <TrackLane
        accentClassName="bg-fuchsia-500/60"
        durationSeconds={durationSeconds}
        handleId={handle}
        icon={<Music2 size={12} />}
        label={label}
        media={media}
        offsetMs={offsetMs}
        onPointerDown={(event) => onTimelinePointerDown(event, handle)}
        timelineSeconds={timelineSeconds}
      />

      <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3">
        <div />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="nodrag nopan flex items-center gap-2 text-[11px] text-gray-400">
          {enabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
          <input checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} type="checkbox" />
          Enabled
        </label>

        <label className="nodrag nopan flex min-w-[180px] flex-1 items-center gap-2 text-[11px] text-gray-400">
          Volume
          <input
            className="nodrag nopan w-full"
            max="150"
            min="0"
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            type="range"
            value={String(volumePercent)}
          />
          <span className="w-8 text-right text-gray-300">{volumePercent}%</span>
        </label>

        <label className="nodrag nopan flex items-center gap-2 text-[11px] text-gray-400">
          Offset
          <input
            className="nodrag nopan w-28"
            max={String(timelineSeconds * 1000)}
            min="0"
            onChange={(event) => onOffsetChange(Number(event.target.value))}
            step="250"
            type="range"
            value={String(offsetMs)}
          />
          <span className="w-12 text-right text-gray-300">{(offsetMs / 1000).toFixed(1)}s</span>
        </label>
        </div>
      </div>
    </div>
  );
}

function CompositionTrackHandle({ id, label }: { id: CompositionTargetHandle; label: string }) {
  return (
    <Handle
      aria-label={`${label} track input`}
      id={id}
      type="target"
      position={Position.Left}
      className="nodrag nopan !left-0 !top-1/2 !h-5 !w-5 !-translate-x-1/2 !-translate-y-1/2 !border-[3px] !border-[#1e2027] !bg-blue-500"
    />
  );
}

function findConnectedMedia(
  nodes: AppNode[],
  edges: ReturnType<typeof useFlowStore.getState>['edges'],
  targetNodeId: string,
  targetHandle: CompositionTargetHandle,
  acceptedTypes: Array<AppNode['type']>,
  mediaFamily: CompositionMediaFamily,
): ConnectedMedia | undefined {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edge = edges.find((candidate) => {
    if (candidate.target !== targetNodeId) {
      return false;
    }

    if (candidate.targetHandle === targetHandle) {
      return true;
    }

    if (targetHandle !== COMPOSITION_VIDEO_HANDLE) {
      return false;
    }

    const rawSourceNode = nodesById.get(candidate.source);
    const sourceNode = rawSourceNode
      ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, candidate.sourceHandle)
      : undefined;
    return isCompositionVideoConnection(candidate) && (
      sourceNode?.type === 'videoGen' || sourceNode?.type === 'composition'
    );
  });

  if (!edge) {
    return undefined;
  }

  const rawSourceNode = nodesById.get(edge.source);
  const sourceNode = rawSourceNode
    ? resolveEffectiveSourceNode(rawSourceNode, nodesById, edges, edge.sourceHandle)
    : undefined;

  if (!sourceNode || !acceptedTypes.includes(sourceNode.type)) {
    return undefined;
  }

  if (sourceNode.type === 'composition' && sourceNode.data.resultType === 'package') {
    return undefined;
  }

  if (sourceNode.type === 'functionNode' && !functionNodeMatchesCompositionMediaFamily(sourceNode, mediaFamily)) {
    return undefined;
  }

  const result = resolveNodeOutputAsset(sourceNode);

  if (!result) {
    return undefined;
  }

  return {
    handle: targetHandle,
    nodeId: sourceNode.id,
    label: getMediaLabel(sourceNode),
    resultType: mediaFamily,
    url: result,
  };
}

function getMediaLabel(node: AppNode): string {
  if (node.type === 'audioGen') {
    return node.data.sourceAssetName ?? node.data.voiceId ?? node.data.modelId ?? 'Audio track';
  }

  if (node.type === 'composition') {
    return 'Composition output';
  }

  if (node.type === 'functionNode') {
    return node.data.functionNode?.title ?? 'Function output';
  }

  return node.data.modelId ?? 'Video track';
}

async function getMediaDuration(url: string, resultType: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve) => {
    const media = document.createElement(resultType);
    const cleanup = () => {
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
    };
    media.preload = 'metadata';
    media.src = url;

    media.onloadedmetadata = () => {
      const durationSeconds = Number.isFinite(media.duration) ? media.duration : 0;
      cleanup();
      resolve(durationSeconds);
    };

    media.onerror = () => {
      cleanup();
      resolve(0);
    };
  });
}
