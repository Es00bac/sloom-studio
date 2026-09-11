export interface TimelinePreviewRequestCandidate<TPayload> {
  clipId: string;
  signature?: string;
  payload: TPayload;
}

export interface PendingTimelinePreviewRequest<TPayload> {
  clipId: string;
  signature: string;
  payload: TPayload;
}

export interface TimelinePreviewResult<TPreview> {
  clipId: string;
  preview?: TPreview;
}

export function takePendingTimelinePreviewRequests<TPayload>(
  candidates: TimelinePreviewRequestCandidate<TPayload>[],
  signatureByClipId: Record<string, string>,
): PendingTimelinePreviewRequest<TPayload>[] {
  return candidates.flatMap((candidate) => {
    if (!candidate.signature || signatureByClipId[candidate.clipId] === candidate.signature) {
      return [];
    }

    signatureByClipId[candidate.clipId] = candidate.signature;
    return [{
      clipId: candidate.clipId,
      signature: candidate.signature,
      payload: candidate.payload,
    }];
  });
}

export function pruneTimelinePreviewMap<TPreview>(
  current: Record<string, TPreview>,
  activeClipIds: string[],
  maxEntries: number,
): Record<string, TPreview> {
  const activeIdSet = new Set(activeClipIds);
  const keptIds = activeClipIds
    .filter((clipId) => activeIdSet.has(clipId) && current[clipId] !== undefined)
    .slice(-Math.max(0, maxEntries));
  const next = Object.fromEntries(keptIds.map((clipId) => [clipId, current[clipId]])) as Record<string, TPreview>;
  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(next);

  if (
    currentKeys.length === nextKeys.length &&
    currentKeys.every((key) => current[key] === next[key])
  ) {
    return current;
  }

  return next;
}

export function mergeTimelinePreviewResults<TPreview>(
  current: Record<string, TPreview>,
  results: TimelinePreviewResult<TPreview>[],
  activeClipIds: string[],
  maxEntries: number,
): Record<string, TPreview> {
  const activeIdSet = new Set(activeClipIds);
  const merged = { ...current };

  for (const result of results) {
    if (!result.preview || !activeIdSet.has(result.clipId)) {
      continue;
    }

    merged[result.clipId] = result.preview;
  }

  return pruneTimelinePreviewMap(merged, activeClipIds, maxEntries);
}
