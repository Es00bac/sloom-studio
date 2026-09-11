export interface TimelineWaveformRequestCandidate {
  clipId: string;
  signature?: string;
  sourceUrl?: string;
  sourceInMs?: number;
  sourceOutMs?: number;
}

export interface PendingTimelineWaveformRequest {
  clipIds: string[];
  signature: string;
  sourceUrl: string;
  sourceInMs?: number;
  sourceOutMs?: number;
}

export function takePendingTimelineWaveformRequests(
  candidates: TimelineWaveformRequestCandidate[],
  signatureByClipId: Record<string, string>,
): PendingTimelineWaveformRequest[] {
  const groupedRequests = new Map<string, PendingTimelineWaveformRequest>();

  for (const candidate of candidates) {
    if (
      !candidate.signature ||
      !candidate.sourceUrl ||
      signatureByClipId[candidate.clipId] === candidate.signature
    ) {
      continue;
    }

    signatureByClipId[candidate.clipId] = candidate.signature;
    const existing = groupedRequests.get(candidate.signature);

    if (existing) {
      existing.clipIds.push(candidate.clipId);
      continue;
    }

    groupedRequests.set(candidate.signature, {
      clipIds: [candidate.clipId],
      signature: candidate.signature,
      sourceUrl: candidate.sourceUrl,
      ...(candidate.sourceInMs === undefined ? {} : { sourceInMs: candidate.sourceInMs }),
      ...(candidate.sourceOutMs === undefined ? {} : { sourceOutMs: candidate.sourceOutMs }),
    });
  }

  return [...groupedRequests.values()];
}

export function pruneTimelineWaveformMap(
  current: Record<string, number[]>,
  activeClipIds: string[],
): Record<string, number[]> {
  const activeIdSet = new Set(activeClipIds);
  const next = Object.fromEntries(
    Object.entries(current).filter(([clipId]) => activeIdSet.has(clipId)),
  ) as Record<string, number[]>;
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
