/**
 * Maps the editor's clip model to the FCP7-XML interchange shape (task #33). Uses the SAME
 * source-range resolver as the render pipeline (editorTimelineSourceRange), so what Premiere
 * receives matches what Sloom Studio renders. Media resolution (labels, on-disk paths, durations)
 * is injected by the caller — this module stays pure and unit-testable.
 */
import { resolveVisualClipSourceRangeMs } from './editorTimelineSourceRange';
import { resolveEditorAudioSourceRangeMs } from './editorAudioSourceRange';
import type { FcpXmlClip, FcpXmlSequence } from './fcpXmlInterchange';
import type { EditorAudioClip, EditorVisualClip } from '../types/flow';

export interface FcpXmlMediaResolution {
  label?: string;
  /** Absolute on-disk path when the source is file-backed; omitted media relinks in Premiere. */
  nativeFilePath?: string;
  /** The source file's own duration (media length), seconds. */
  sourceDurationSeconds?: number;
  /** The clip's resolved length on the timeline, seconds (stills/text/comics have no media length). */
  timelineDurationSeconds?: number;
}

/**
 * Derive an on-disk media path from a timeline item's assetUrl. Only genuinely file-backed
 * sources yield a path (file:// URLs, signal-loom-asset file references, absolute paths);
 * generated/blob/data sources return undefined and relink by name in Premiere.
 */
export function resolveFcpMediaPathFromAssetUrl(assetUrl: string | undefined): string | undefined {
  if (!assetUrl) {
    return undefined;
  }
  if (assetUrl.startsWith('/')) {
    return assetUrl;
  }
  try {
    if (assetUrl.startsWith('file://')) {
      return decodeURIComponent(new URL(assetUrl).pathname);
    }
    if (assetUrl.startsWith('signal-loom-asset://file/')) {
      return decodeURIComponent(assetUrl.slice('signal-loom-asset://file/'.length));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function buildFcpXmlSequenceFromEditor({
  name,
  frameRate,
  widthPx,
  heightPx,
  visualClips,
  audioClips,
  resolveVisualMedia,
  resolveAudioMedia,
}: {
  name: string;
  frameRate: number;
  widthPx: number;
  heightPx: number;
  visualClips: EditorVisualClip[];
  audioClips: EditorAudioClip[];
  resolveVisualMedia: (clip: EditorVisualClip) => FcpXmlMediaResolution;
  resolveAudioMedia: (clip: EditorAudioClip) => FcpXmlMediaResolution;
}): FcpXmlSequence {
  const videoClips: FcpXmlClip[] = visualClips.map((clip) => {
    const media = resolveVisualMedia(clip);
    const range = resolveVisualClipSourceRangeMs(clip, media.sourceDurationSeconds ?? 0);
    const timelineDurationMs = Math.max(0, Math.round((media.timelineDurationSeconds ?? 0) * 1000));
    // Stills/text/comics have no media length: their source window is simply the timeline length.
    const sourceOutMs = range.durationMs > 0
      ? range.sourceOutMs
      : range.sourceInMs + Math.max(timelineDurationMs, 1);

    return {
      name: media.label ?? clip.sourceNodeId,
      trackIndex: Math.max(0, clip.trackIndex),
      startMs: Math.max(0, clip.startMs),
      sourceInMs: range.sourceInMs,
      sourceOutMs,
      pathUrl: media.nativeFilePath,
      enabled: true,
    };
  });

  const mappedAudioClips: FcpXmlClip[] = audioClips.map((clip) => {
    const media = resolveAudioMedia(clip);
    const range = resolveEditorAudioSourceRangeMs(clip, media.sourceDurationSeconds ?? media.timelineDurationSeconds ?? 0);

    return {
      name: media.label ?? clip.sourceNodeId,
      trackIndex: Math.max(0, clip.trackIndex),
      startMs: Math.max(0, clip.offsetMs),
      sourceInMs: range.sourceInMs,
      sourceOutMs: Math.max(range.sourceInMs + 1, range.sourceOutMs),
      pathUrl: media.nativeFilePath,
      enabled: clip.enabled !== false,
    };
  });

  return {
    name,
    timebase: Math.max(1, Math.round(frameRate)),
    widthPx,
    heightPx,
    videoClips,
    audioClips: mappedAudioClips,
  };
}
