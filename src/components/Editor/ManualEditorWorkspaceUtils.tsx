import { Captions, Film, Image as ImageIcon, Music2, Square, Type } from 'lucide-react';
import type { SourceBinItem } from '../../lib/sourceBin';
import { buildMediaAssetSignaturePart } from '../../lib/mediaAssetSignature';
import { resolveVisualClipSourceRangeMs, type VisualClipSourceRangeInput } from '../../lib/editorTimelineSourceRange';
import { resolveEditorAudioSourceRangeMs } from '../../lib/editorAudioSourceRange';
import { extractVideoFramesAtTimes } from '../../lib/videoFrameExtraction';
import { buildAudioTimelineBlocks, buildVisualTimelineBlocks, resolveVisualClipDuration } from '../../lib/manualEditorTimeline';
import { buildVisualClipLayoutDescriptor, resolveTextSourceDimensions } from '../../lib/editorVisualLayout';
import { isAspectRatio } from '../../lib/providerCatalog';
import type { AspectRatio, EditorAsset, EditorAudioClip, EditorVisualClip, VideoResolution } from '../../types/flow';

const DEFAULT_AUDIO_TRACK_COUNT = 4;
const TIMELINE_PREVIEW_FRAME_OPTIONS = {
  maxWidth: 144,
  maxHeight: 81,
  mimeType: 'image/webp',
  quality: 0.58,
} as const;

export interface SourceMediaInfo {
  durationSeconds?: number;
  width?: number;
  height?: number;
}

export interface ProgramStageClip {
  clip: EditorVisualClip;
  item?: SourceBinItem;
  asset?: EditorAsset;
  durationSeconds: number;
  localTimeSeconds: number;
  sourceTimeSeconds?: number;
  sourceWidth: number;
  sourceHeight: number;
}

export type TimelineBlockKind = SourceBinItem['kind'] | 'shape' | 'comic';

export interface TimelineClipEdgePreview {
  start?: string;
  end?: string;
}

export function canUseSourceItemAsVisual(item: SourceBinItem): boolean {
  return item.kind === 'image' || item.kind === 'video' || item.kind === 'composition' || item.kind === 'text';
}

export function canUseSourceItemAsAudio(item: SourceBinItem): boolean {
  return item.kind === 'audio' || item.kind === 'video' || item.kind === 'composition';
}

export function getDraggedSourceItemId(dataTransfer: DataTransfer): string | undefined {
  const rawPayload = dataTransfer.getData('application/x-flow-source-bin-item');

  if (!rawPayload) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawPayload) as { itemId?: string };
    return parsed.itemId;
  } catch {
    return undefined;
  }
}

export function createDerivedVisualClipId(): string {
  return `visual-${globalThis.crypto?.randomUUID?.() ?? `derived-${Date.now()}`}`;
}

export function getSourceItemIcon(kind: TimelineBlockKind) {
  switch (kind) {
    case 'image':
      return <ImageIcon size={14} />;
    case 'video':
    case 'composition':
      return <Film size={14} />;
    case 'audio':
      return <Music2 size={14} />;
    case 'text':
      return <Type size={14} />;
    case 'subtitle':
      return <Captions size={14} />;
    case 'shape':
      return <Square size={14} />;
  }
}

export function getVisualTrackEndMs(blocks: ReturnType<typeof buildVisualTimelineBlocks>, trackIndex: number): number {
  return Math.max(
    0,
    ...blocks
      .filter((block) => block.clip.trackIndex === trackIndex)
      .map((block) => Math.round(block.endSeconds * 1000)),
  );
}

export function getAudioTrackEndMs(blocks: ReturnType<typeof buildAudioTimelineBlocks>, trackIndex: number): number {
  return Math.max(
    0,
    ...blocks
      .filter((block) => block.clip.trackIndex === trackIndex)
      .map((block) => Math.round(block.endSeconds * 1000)),
  );
}

export function getDefaultAudioTrackVolumes(): number[] {
  return Array.from({ length: DEFAULT_AUDIO_TRACK_COUNT }, () => 100);
}

export function getSourceItemDurationSeconds(
  item: SourceBinItem | undefined,
  durationMap: Record<string, number>,
): number | undefined {
  if (!item) {
    return undefined;
  }

  if (item.kind === 'image' || item.kind === 'text') {
    return undefined;
  }

  return durationMap[item.id];
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to convert the captured frame into a data URL.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The captured frame could not be converted into a data URL.'));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length);
  const workerCount = Math.max(1, Math.min(items.length, Math.floor(concurrency)));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

export function buildTimelineFallbackWaveformPeaks(sampleCount: number): number[] {
  const safeSampleCount = Math.max(16, Math.round(sampleCount));

  return Array.from({ length: safeSampleCount }, (_, index) => {
    const phase = (index / Math.max(1, safeSampleCount - 1)) * Math.PI * 4;
    return 0.16 + Math.abs(Math.sin(phase)) * 0.42;
  });
}

export function buildClipPreviewSignature(
  clip: EditorVisualClip,
  sourceItem: SourceBinItem | undefined,
  durationMap: Record<string, number>,
): string | undefined {
  if (!sourceItem?.assetUrl) {
    return undefined;
  }

  if (sourceItem.kind === 'image') {
    return `image:${sourceItem.id}:${buildMediaAssetSignaturePart(sourceItem.assetUrl)}`;
  }

  if (sourceItem.kind !== 'video' && sourceItem.kind !== 'composition') {
    return undefined;
  }

  const sourceDurationSeconds = durationMap[sourceItem.id] ?? 0;
  const sourceRange = resolveVisualClipSourceRangeMs(clip, sourceDurationSeconds);

  return [
    sourceItem.kind,
    sourceItem.id,
    buildMediaAssetSignaturePart(sourceItem.assetUrl),
    sourceDurationSeconds,
    sourceRange.sourceInMs,
    sourceRange.sourceOutMs,
    clip.playbackRate,
    clip.reversePlayback ? 'reverse' : 'forward',
  ].join(':');
}

export function buildAudioWaveformSignature(
  sourceItem: SourceBinItem | undefined,
  clip?: EditorAudioClip,
  sourceDurationSeconds = 0,
): string | undefined {
  if (!sourceItem?.assetUrl) {
    return undefined;
  }

  if (sourceItem.kind !== 'audio' && sourceItem.kind !== 'video' && sourceItem.kind !== 'composition') {
    return undefined;
  }

  const range = clip ? resolveEditorAudioSourceRangeMs(clip, sourceDurationSeconds) : undefined;
  return [
    sourceItem.kind,
    sourceItem.id,
    buildMediaAssetSignaturePart(sourceItem.assetUrl),
    sourceItem.mimeType ?? '',
    range?.sourceInMs ?? 0,
    range?.sourceOutMs ?? Math.round(sourceDurationSeconds * 1_000),
  ].join(':');
}

export async function buildTimelineClipEdgePreview(
  clip: EditorVisualClip,
  sourceItem: SourceBinItem,
  durationMap: Record<string, number>,
): Promise<TimelineClipEdgePreview | undefined> {
  if (!sourceItem.assetUrl) {
    return undefined;
  }

  if (sourceItem.kind === 'image') {
    return {
      start: sourceItem.assetUrl,
      end: sourceItem.assetUrl,
    };
  }

  if (sourceItem.kind !== 'video' && sourceItem.kind !== 'composition') {
    return undefined;
  }

  const sourceDurationSeconds = durationMap[sourceItem.id] ?? 0;
  const clipDurationSeconds = getPreviewableClipDurationSeconds(clip, sourceDurationSeconds);

  if (clipDurationSeconds <= 0) {
    return undefined;
  }

  const endLocalTimeSeconds = Math.max(0, clipDurationSeconds - Math.min(0.05, clipDurationSeconds / 10));
  const startTimeSeconds = resolveStageSourceTimeSeconds(clip, sourceDurationSeconds, 0);
  const endTimeSeconds = resolveStageSourceTimeSeconds(clip, sourceDurationSeconds, endLocalTimeSeconds);
  const frames = await extractVideoFramesAtTimes(
    sourceItem.assetUrl,
    [startTimeSeconds, endTimeSeconds],
    TIMELINE_PREVIEW_FRAME_OPTIONS,
  );
  const startFrame = frames[0];
  const endFrame = frames[1];

  if (!startFrame || !endFrame) {
    return undefined;
  }

  return {
    start: await blobToDataUrl(startFrame),
    end: await blobToDataUrl(endFrame),
  };
}

export function getPreviewableClipDurationSeconds(
  clip: EditorVisualClip,
  sourceDurationSeconds: number,
): number {
  if (clip.sourceKind === 'image' || clip.sourceKind === 'text' || clip.sourceKind === 'shape' || clip.sourceKind === 'comic') {
    return clip.durationSeconds ?? 4;
  }

  const availableMs = resolveVisualClipSourceRangeMs(clip, sourceDurationSeconds).durationMs;

  if (availableMs === 0) {
    return 0;
  }

  return availableMs / 1000 / Math.max(0.25, clip.playbackRate || 1);
}

export function normalizeAspectRatio(value: unknown): AspectRatio {
  return isAspectRatio(value) ? value : '16:9';
}

export function normalizeVideoResolution(value: unknown): VideoResolution {
  return value === '720p' || value === '4k' ? value : '1080p';
}

export function normalizeVideoFrameRate(value: unknown): number {
  return typeof value === 'number' && [24, 25, 30, 60].includes(value) ? value : 30;
}

export function areMediaInfosEqual(left?: SourceMediaInfo, right?: SourceMediaInfo): boolean {
  return left?.durationSeconds === right?.durationSeconds
    && left?.width === right?.width
    && left?.height === right?.height;
}

export function resolveSourceAspectRatio(item: SourceBinItem, mediaInfo?: SourceMediaInfo): number {
  if (mediaInfo?.width && mediaInfo?.height) {
    return mediaInfo.width / mediaInfo.height;
  }

  switch (item.kind) {
    case 'image':
    case 'video':
    case 'composition':
      return 16 / 9;
    case 'audio':
      return 16 / 9;
    case 'text':
    case 'document':
    case 'subtitle':
    case 'package':
      return 16 / 9;
  }
}

export async function getSourceMediaInfo(item: SourceBinItem): Promise<SourceMediaInfo> {
  if (item.kind === 'text' || item.kind === 'document' || item.kind === 'subtitle' || item.kind === 'package') {
    return {};
  }

  if (item.kind === 'image') {
    const assetUrl = item.assetUrl;

    if (!assetUrl) {
      return {};
    }

    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const info = { width: image.naturalWidth, height: image.naturalHeight };
        image.removeAttribute('src');
        resolve(info);
      };
      image.onerror = () => {
        image.removeAttribute('src');
        resolve({});
      };
      image.src = assetUrl;
    });
  }

  const assetUrl = item.assetUrl;

  if (!assetUrl) {
    return {};
  }

  return new Promise((resolve) => {
    const media = document.createElement(item.kind === 'audio' ? 'audio' : 'video');
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve({});
    }, 15_000);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
    };
    media.preload = 'metadata';
    media.src = assetUrl;

    media.onloadedmetadata = () => {
      const info = {
        durationSeconds: Number.isFinite(media.duration) ? media.duration : 0,
        width: media instanceof HTMLVideoElement ? media.videoWidth : undefined,
        height: media instanceof HTMLVideoElement ? media.videoHeight : undefined,
      };
      cleanup();
      resolve(info);
    };

    media.onerror = () => {
      cleanup();
      resolve({});
    };
  });
}

export function getProgramStageClips(
  visualClips: EditorVisualClip[],
  sourceItemByNodeId: Map<string, SourceBinItem>,
  editorAssetById: Map<string, EditorAsset>,
  durationMap: Record<string, number>,
  mediaInfoMap: Record<string, SourceMediaInfo>,
  playheadSeconds: number,
): ProgramStageClip[] {
  return visualClips
    .flatMap((clip) => {
      const isAdjustmentLayer = clip.professional?.adjustmentLayer === true
        || (clip as EditorVisualClip & { runtimeRole?: 'media' | 'adjustment' }).runtimeRole === 'adjustment';
      const item = sourceItemByNodeId.get(clip.sourceNodeId);
      const asset = editorAssetById.get(clip.sourceNodeId);
      const durationSeconds = resolveVisualClipDuration(clip, sourceItemByNodeId, durationMap);
      const startSeconds = clip.startMs / 1000;
      const dissolveOffsetSeconds = getPreviewEditPointDissolveOffsetSeconds(clip, visualClips, sourceItemByNodeId, durationMap);
      const effectiveStartSeconds = Math.max(0, startSeconds - dissolveOffsetSeconds);
      const endSeconds = startSeconds + durationSeconds;

      if (playheadSeconds < effectiveStartSeconds || playheadSeconds > endSeconds) {
        return [];
      }

      if (isAdjustmentLayer) {
        return [{
          clip,
          durationSeconds,
          localTimeSeconds: Math.max(0, playheadSeconds - effectiveStartSeconds),
          sourceWidth: 1,
          sourceHeight: 1,
        } satisfies ProgramStageClip];
      }

      const localSeconds = Math.max(0, playheadSeconds - effectiveStartSeconds);
      const itemInfo = item ? mediaInfoMap[item.id] : undefined;
      const sourceDurationSeconds = itemInfo?.durationSeconds ?? 0;
      const sourceTimeSeconds =
        clip.sourceKind === 'video' || clip.sourceKind === 'composition'
          ? resolveStageSourceTimeSeconds(clip, sourceDurationSeconds, localSeconds)
          : undefined;
      const sourceDimensions = getStageClipSourceDimensions(clip, item, asset, itemInfo);

      return [{
        clip,
        item,
        asset,
        durationSeconds,
        localTimeSeconds: localSeconds,
        sourceTimeSeconds,
        sourceWidth: sourceDimensions.width,
        sourceHeight: sourceDimensions.height,
      } satisfies ProgramStageClip];
    })
    .sort((left, right) => left.clip.trackIndex - right.clip.trackIndex || left.clip.startMs - right.clip.startMs);
}

export function getPreviewEditPointDissolveOffsetSeconds(
  clip: EditorVisualClip,
  visualClips: EditorVisualClip[],
  sourceItemByNodeId: Map<string, SourceBinItem>,
  durationMap: Record<string, number>,
): number {
  if (clip.transitionIn !== 'fade' || clip.transitionDurationMs <= 0) {
    return 0;
  }

  const durationSeconds = resolveVisualClipDuration(clip, sourceItemByNodeId, durationMap);
  const transitionSeconds = Math.min(durationSeconds / 2, clip.transitionDurationMs / 1000);
  const hasAdjacentOutgoingFade = visualClips.some((candidate) => {
    if (candidate.id === clip.id || candidate.trackIndex !== clip.trackIndex || candidate.transitionOut !== 'fade') {
      return false;
    }

    const candidateDurationSeconds = resolveVisualClipDuration(candidate, sourceItemByNodeId, durationMap);
    const candidateEndMs = candidate.startMs + candidateDurationSeconds * 1000;
    return Math.abs(candidateEndMs - clip.startMs) <= 1;
  });

  return hasAdjacentOutgoingFade ? transitionSeconds : 0;
}

export function resolveStageSourceTimeSeconds(
  // Widened from the concrete `EditorVisualClip` (same reasoning as `ClipEffectSourceClip` in
  // editorClipEffects.ts) so the frame-server export driver can call this with
  // `mediaComposition.ts`'s flattened `ComposeSequenceVisualClip` too.
  clip: Pick<EditorVisualClip, 'playbackRate' | 'reversePlayback'> & VisualClipSourceRangeInput,
  sourceDurationSeconds: number,
  localSeconds: number,
): number {
  const playbackRate = Math.max(0.25, clip.playbackRate || 1);
  const sourceRange = resolveVisualClipSourceRangeMs(clip, sourceDurationSeconds);
  const sourceStartSeconds = sourceRange.sourceInMs / 1000;
  const sourceEndSeconds = sourceRange.sourceOutMs / 1000;
  const clipSourceOffsetSeconds = localSeconds * playbackRate;

  if (clip.reversePlayback) {
    return Math.max(sourceStartSeconds, sourceEndSeconds - clipSourceOffsetSeconds);
  }

  return Math.min(sourceEndSeconds, sourceStartSeconds + clipSourceOffsetSeconds);
}

export function getStageClipLayout(
  stageClip: ProgramStageClip,
  canvas: { width: number; height: number },
): ReturnType<typeof buildVisualClipLayoutDescriptor> {
  const progress = getStageClipProgress(stageClip);

  return buildVisualClipLayoutDescriptor({
    clip: stageClip.clip,
    canvas,
    source: {
      width: stageClip.sourceWidth,
      height: stageClip.sourceHeight,
    },
    progressPercent: progress * 100,
    localTimeSeconds: stageClip.localTimeSeconds,
    durationSeconds: stageClip.durationSeconds,
    text: stageClip.clip.textContent ?? stageClip.item?.text ?? stageClip.asset?.textDefaults?.text ?? 'Text',
  });
}

export function getStageClipSourceDimensions(
  clip: EditorVisualClip,
  item: SourceBinItem | undefined,
  asset: EditorAsset | undefined,
  itemInfo: SourceMediaInfo | undefined,
): { width: number; height: number } {
  if (clip.sourceKind === 'text') {
    return resolveTextSourceDimensions({
      text: clip.textContent ?? item?.text ?? asset?.textDefaults?.text ?? 'Text',
      fontSizePx: clip.textSizePx || asset?.textDefaults?.fontSizePx || 64,
      effect: clip.textEffect || asset?.textDefaults?.textEffect || 'none',
      fontFamily: clip.textFontFamily || asset?.textDefaults?.fontFamily || 'Inter, system-ui, sans-serif',
      typography: clip.textTypography,
    });
  }

  return {
    width: itemInfo?.width ?? (clip.sourceKind === 'shape' ? 1280 : 1920),
    height: itemInfo?.height ?? (clip.sourceKind === 'shape' ? 720 : 1080),
  };
}

export function getStageClipProgress(stageClip: ProgramStageClip): number {
  return stageClip.durationSeconds > 0
    ? Math.max(0, Math.min(1, stageClip.localTimeSeconds / Math.max(stageClip.durationSeconds, 0.001)))
    : 0;
}

export function getVisualClipProgressPercent(
  clip: EditorVisualClip,
  durationSeconds: number,
  playheadSeconds: number,
): number {
  const startSeconds = clip.startMs / 1000;
  return getClipProgressPercent(startSeconds, durationSeconds, playheadSeconds);
}

export function getAudioClipProgressPercent(
  clip: EditorAudioClip,
  durationSeconds: number,
  playheadSeconds: number,
): number {
  const startSeconds = clip.offsetMs / 1000;
  return getClipProgressPercent(startSeconds, durationSeconds, playheadSeconds);
}

export function getClipProgressPercent(
  startSeconds: number,
  durationSeconds: number,
  playheadSeconds: number,
): number {
  const safeDurationSeconds = Math.max(0.001, durationSeconds);
  return Math.max(0, Math.min(100, ((playheadSeconds - startSeconds) / safeDurationSeconds) * 100));
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return false;
  }

  const tagName = element.tagName;
  return element.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export function roundNudgeCoordinate(value: number): number {
  return Number(value.toFixed(3));
}
