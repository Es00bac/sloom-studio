export interface VideoRenderSignatureClipInput {
  id?: string;
  label?: string;
  sourceNodeId?: string;
  sourceKind?: string;
  trackIndex?: number;
  startMs?: number;
  durationMs?: number;
  sourceInMs?: number;
  sourceOutMs?: number;
  sourceSignature?: string;
  fitMode?: string;
  opacityPercent?: number;
  blendMode?: string;
  scalePercent?: number;
  rotationDeg?: number;
  positionX?: number;
  positionY?: number;
  cropLeftPercent?: number;
  cropRightPercent?: number;
  cropTopPercent?: number;
  cropBottomPercent?: number;
  cropPanXPercent?: number;
  cropPanYPercent?: number;
  cropRotationDeg?: number;
  chromaKey?: unknown;
  stroke?: unknown;
  filterStack?: unknown;
  textContent?: string;
  textFontFamily?: string;
  textSizePx?: number;
  textColor?: string;
  textEffect?: string;
  textBackgroundOpacityPercent?: number;
  textTypography?: unknown;
  shapeFillColor?: string;
  shapeBorderColor?: string;
  shapeBorderWidth?: number;
  shapeCornerRadius?: number;
  /** Versioned professional color/VFX/retime state must invalidate only affected spans. */
  professional?: unknown;
}

export interface VideoRenderPlanClip {
  id: string;
  trackIndex: number;
  startMs: number;
  durationMs: number;
  signature: string;
}

export interface VideoRenderSegment {
  key: string;
  startMs: number;
  endMs: number;
  activeClipIds: string[];
  signature: string;
  dirty: boolean;
}

export interface VideoRenderDirtyPlan {
  segments: VideoRenderSegment[];
  dirtySegments: VideoRenderSegment[];
  segmentSignatures: Record<string, string>;
}

export function buildVideoRenderClipSignature(input: VideoRenderSignatureClipInput): string {
  return stableStringify({
    sourceNodeId: input.sourceNodeId,
    sourceKind: input.sourceKind,
    trackIndex: finiteNumber(input.trackIndex, 0),
    startMs: finiteNumber(input.startMs, 0),
    durationMs: finiteNumber(input.durationMs, 0),
    sourceInMs: finiteNumber(input.sourceInMs, 0),
    sourceOutMs: optionalFiniteNumber(input.sourceOutMs),
    sourceSignature: input.sourceSignature,
    fitMode: input.fitMode,
    opacityPercent: finiteNumber(input.opacityPercent, 100),
    blendMode: input.blendMode ?? 'normal',
    scalePercent: finiteNumber(input.scalePercent, 100),
    rotationDeg: finiteNumber(input.rotationDeg, 0),
    positionX: finiteNumber(input.positionX, 0),
    positionY: finiteNumber(input.positionY, 0),
    cropLeftPercent: finiteNumber(input.cropLeftPercent, 0),
    cropRightPercent: finiteNumber(input.cropRightPercent, 0),
    cropTopPercent: finiteNumber(input.cropTopPercent, 0),
    cropBottomPercent: finiteNumber(input.cropBottomPercent, 0),
    cropPanXPercent: finiteNumber(input.cropPanXPercent, 0),
    cropPanYPercent: finiteNumber(input.cropPanYPercent, 0),
    cropRotationDeg: finiteNumber(input.cropRotationDeg, 0),
    chromaKey: input.chromaKey,
    stroke: input.stroke,
    filterStack: input.filterStack,
    textContent: input.textContent,
    textFontFamily: input.textFontFamily,
    textSizePx: optionalFiniteNumber(input.textSizePx),
    textColor: input.textColor,
    textEffect: input.textEffect,
    textBackgroundOpacityPercent: optionalFiniteNumber(input.textBackgroundOpacityPercent),
    textTypography: input.textTypography,
    shapeFillColor: input.shapeFillColor,
    shapeBorderColor: input.shapeBorderColor,
    shapeBorderWidth: optionalFiniteNumber(input.shapeBorderWidth),
    shapeCornerRadius: optionalFiniteNumber(input.shapeCornerRadius),
    professional: input.professional,
  });
}

export function buildVideoRenderDirtyPlan({
  clips,
  previousSegmentSignatures,
}: {
  clips: VideoRenderPlanClip[];
  previousSegmentSignatures: Record<string, string>;
}): VideoRenderDirtyPlan {
  const activeClips = clips
    .filter((clip) => clip.durationMs > 0)
    .map((clip) => ({
      ...clip,
      startMs: Math.max(0, Math.round(clip.startMs)),
      endMs: Math.max(0, Math.round(clip.startMs + clip.durationMs)),
    }))
    .filter((clip) => clip.endMs > clip.startMs);
  const boundaries = [...new Set(activeClips.flatMap((clip) => [clip.startMs, clip.endMs]))]
    .sort((left, right) => left - right);
  const segments: VideoRenderSegment[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startMs = boundaries[index];
    const endMs = boundaries[index + 1];
    if (endMs <= startMs) continue;

    const segmentClips = activeClips
      .filter((clip) => clip.startMs < endMs && clip.endMs > startMs)
      .sort((left, right) => left.trackIndex - right.trackIndex || left.startMs - right.startMs || left.id.localeCompare(right.id));

    if (segmentClips.length === 0) continue;

    const key = `${startMs}-${endMs}`;
    const signature = stableStringify({
      startMs,
      endMs,
      clips: segmentClips.map((clip) => ({
        id: clip.id,
        trackIndex: clip.trackIndex,
        signature: clip.signature,
      })),
    });

    segments.push({
      key,
      startMs,
      endMs,
      activeClipIds: segmentClips.map((clip) => clip.id),
      signature,
      dirty: previousSegmentSignatures[key] !== signature,
    });
  }

  return {
    segments,
    dirtySegments: segments.filter((segment) => segment.dirty),
    segmentSignatures: Object.fromEntries(segments.map((segment) => [segment.key, segment.signature])),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}
