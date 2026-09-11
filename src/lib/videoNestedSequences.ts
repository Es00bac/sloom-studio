/** Pure sequence-graph primitives for nested timelines, compound clips, and adjustment layers. */

export const VIDEO_SEQUENCE_GRAPH_VERSION = 1 as const;
export const MAX_VIDEO_SEQUENCE_NESTING_DEPTH = 8;

export type VideoSequenceClipKind = 'media' | 'sequence' | 'compound' | 'adjustment';

export interface VideoSequenceClip {
  id: string;
  kind: VideoSequenceClipKind;
  sourceId: string;
  trackId: string;
  trackOrder: number;
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  effectSignature?: string;
  linkGroupId?: string;
}

export interface VideoSequenceNode {
  id: string;
  name: string;
  durationMs: number;
  revision: number;
  clips: VideoSequenceClip[];
}

export interface VideoSequenceGraph {
  version: typeof VIDEO_SEQUENCE_GRAPH_VERSION;
  rootSequenceId: string;
  sequences: Record<string, VideoSequenceNode>;
}

export interface VideoSequenceGraphValidation {
  valid: boolean;
  cycles: string[][];
  missingSequenceIds: string[];
  maximumDepth: number;
  depthExceeded: boolean;
}

export interface NestSequenceResult {
  graph: VideoSequenceGraph;
  nestedSequenceId: string;
  referenceClipId: string;
  originalSpan: { startMs: number; endMs: number };
}

export interface FlattenSequenceResult {
  graph: VideoSequenceGraph;
  insertedClipIds: string[];
  removedReferenceClipId: string;
}

export interface AdjustmentLayerRenderSpan {
  adjustmentClipId: string;
  targetClipId: string;
  startMs: number;
  endMs: number;
  effectSignature: string;
}

export interface SequenceInvalidationInputs {
  rootSequenceId: string;
  rootHash: string;
  hashesBySequenceId: Record<string, string>;
  sourceAssetIds: string[];
}

function cloneClip(clip: VideoSequenceClip): VideoSequenceClip {
  return { ...clip };
}

function cloneSequence(sequence: VideoSequenceNode): VideoSequenceNode {
  return { ...sequence, clips: sequence.clips.map(cloneClip) };
}

export function cloneVideoSequenceGraph(graph: VideoSequenceGraph): VideoSequenceGraph {
  return {
    ...graph,
    sequences: Object.fromEntries(Object.entries(graph.sequences).map(([id, sequence]) => [id, cloneSequence(sequence)])),
  };
}

export function createVideoSequenceGraph(root: VideoSequenceNode): VideoSequenceGraph {
  return {
    version: VIDEO_SEQUENCE_GRAPH_VERSION,
    rootSequenceId: root.id,
    sequences: { [root.id]: cloneSequence(root) },
  };
}

function referencedSequenceIds(sequence: VideoSequenceNode): string[] {
  return sequence.clips
    .filter((clip) => clip.kind === 'sequence' || clip.kind === 'compound')
    .map((clip) => clip.sourceId);
}

export function validateVideoSequenceGraph(
  graph: VideoSequenceGraph,
  depthCap = MAX_VIDEO_SEQUENCE_NESTING_DEPTH,
): VideoSequenceGraphValidation {
  const cycles: string[][] = [];
  const missing = new Set<string>();
  let maximumDepth = 0;
  const cycleKeys = new Set<string>();

  const visit = (sequenceId: string, path: string[]): void => {
    maximumDepth = Math.max(maximumDepth, path.length + 1);
    const sequence = graph.sequences[sequenceId];
    if (!sequence) {
      missing.add(sequenceId);
      return;
    }
    for (const childId of referencedSequenceIds(sequence)) {
      const cycleIndex = path.indexOf(childId);
      if (childId === sequenceId || cycleIndex >= 0) {
        const cycle = childId === sequenceId
          ? [...path, sequenceId, childId]
          : [...path.slice(cycleIndex), sequenceId, childId];
        const key = cycle.join('>');
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
          cycles.push(cycle);
        }
        continue;
      }
      visit(childId, [...path, sequenceId]);
    }
  };

  for (const sequenceId of Object.keys(graph.sequences).sort()) visit(sequenceId, []);
  const depthExceeded = maximumDepth > depthCap;
  return {
    valid: cycles.length === 0 && missing.size === 0 && !depthExceeded,
    cycles,
    missingSequenceIds: [...missing].sort(),
    maximumDepth,
    depthExceeded,
  };
}

export function canAddVideoSequenceReference(
  graph: VideoSequenceGraph,
  parentSequenceId: string,
  childSequenceId: string,
  depthCap = MAX_VIDEO_SEQUENCE_NESTING_DEPTH,
): boolean {
  const parent = graph.sequences[parentSequenceId];
  if (!parent || !graph.sequences[childSequenceId]) return false;
  const candidate = cloneVideoSequenceGraph(graph);
  candidate.sequences[parentSequenceId] = {
    ...candidate.sequences[parentSequenceId],
    clips: [...candidate.sequences[parentSequenceId].clips, {
      id: '__validation-reference__',
      kind: 'sequence',
      sourceId: childSequenceId,
      trackId: '__validation-track__',
      trackOrder: 0,
      startMs: 0,
      durationMs: 1,
      sourceInMs: 0,
    }],
  };
  return validateVideoSequenceGraph(candidate, depthCap).valid;
}

function ensureUniqueSequenceAndClipIds(graph: VideoSequenceGraph, sequenceId: string, clipId: string): void {
  if (graph.sequences[sequenceId]) throw new Error(`Sequence ID already exists: ${sequenceId}`);
  if (Object.values(graph.sequences).some((sequence) => sequence.clips.some((clip) => clip.id === clipId))) {
    throw new Error(`Clip ID already exists: ${clipId}`);
  }
}

export function nestVideoSequenceClips(
  graph: VideoSequenceGraph,
  parentSequenceId: string,
  selectedClipIds: readonly string[],
  input: { sequenceId: string; name: string; referenceClipId: string; asCompound?: boolean },
): NestSequenceResult {
  const parent = graph.sequences[parentSequenceId];
  if (!parent) throw new Error(`Unknown parent sequence: ${parentSequenceId}`);
  ensureUniqueSequenceAndClipIds(graph, input.sequenceId, input.referenceClipId);
  const selected = new Set(selectedClipIds);
  const selectedClips = parent.clips.filter((clip) => selected.has(clip.id));
  if (selectedClips.length === 0) throw new Error('At least one clip must be selected for nesting.');
  const startMs = Math.min(...selectedClips.map((clip) => clip.startMs));
  const endMs = Math.max(...selectedClips.map((clip) => clip.startMs + clip.durationMs));
  const anchor = [...selectedClips].sort((left, right) => left.trackOrder - right.trackOrder || left.startMs - right.startMs || left.id.localeCompare(right.id))[0];
  const nestedSequence: VideoSequenceNode = {
    id: input.sequenceId,
    name: input.name.trim() || 'Nested sequence',
    durationMs: endMs - startMs,
    revision: 1,
    clips: selectedClips.map((clip) => ({ ...clip, startMs: clip.startMs - startMs })),
  };
  const reference: VideoSequenceClip = {
    id: input.referenceClipId,
    kind: input.asCompound ? 'compound' : 'sequence',
    sourceId: nestedSequence.id,
    trackId: anchor.trackId,
    trackOrder: anchor.trackOrder,
    startMs,
    durationMs: endMs - startMs,
    sourceInMs: 0,
  };
  const candidate = cloneVideoSequenceGraph(graph);
  candidate.sequences[nestedSequence.id] = nestedSequence;
  candidate.sequences[parentSequenceId] = {
    ...candidate.sequences[parentSequenceId],
    revision: candidate.sequences[parentSequenceId].revision + 1,
    clips: [...candidate.sequences[parentSequenceId].clips.filter((clip) => !selected.has(clip.id)), reference]
      .sort((left, right) => left.startMs - right.startMs || left.trackOrder - right.trackOrder || left.id.localeCompare(right.id)),
  };
  const validation = validateVideoSequenceGraph(candidate);
  if (!validation.valid) throw new Error('Nesting would create a cycle or exceed the maximum sequence depth.');
  return {
    graph: candidate,
    nestedSequenceId: nestedSequence.id,
    referenceClipId: reference.id,
    originalSpan: { startMs, endMs },
  };
}

export function flattenVideoSequenceReference(
  graph: VideoSequenceGraph,
  parentSequenceId: string,
  referenceClipId: string,
): FlattenSequenceResult {
  const parent = graph.sequences[parentSequenceId];
  if (!parent) throw new Error(`Unknown parent sequence: ${parentSequenceId}`);
  const reference = parent.clips.find((clip) => clip.id === referenceClipId);
  if (!reference || (reference.kind !== 'sequence' && reference.kind !== 'compound')) {
    throw new Error(`Clip is not a sequence reference: ${referenceClipId}`);
  }
  const child = graph.sequences[reference.sourceId];
  if (!child) throw new Error(`Referenced sequence is missing: ${reference.sourceId}`);
  const sourceStart = reference.sourceInMs;
  const sourceEnd = sourceStart + reference.durationMs;
  const inserted = child.clips.flatMap((clip): VideoSequenceClip[] => {
    const clipStart = Math.max(clip.startMs, sourceStart);
    const clipEnd = Math.min(clip.startMs + clip.durationMs, sourceEnd);
    if (clipEnd <= clipStart) return [];
    return [{
      ...clip,
      id: `${reference.id}::${clip.id}`,
      startMs: reference.startMs + clipStart - sourceStart,
      durationMs: clipEnd - clipStart,
      sourceInMs: clip.sourceInMs + clipStart - clip.startMs,
    }];
  });
  const candidate = cloneVideoSequenceGraph(graph);
  candidate.sequences[parentSequenceId] = {
    ...candidate.sequences[parentSequenceId],
    revision: candidate.sequences[parentSequenceId].revision + 1,
    clips: [...candidate.sequences[parentSequenceId].clips.filter((clip) => clip.id !== referenceClipId), ...inserted]
      .sort((left, right) => left.startMs - right.startMs || left.trackOrder - right.trackOrder || left.id.localeCompare(right.id)),
  };
  return {
    graph: candidate,
    insertedClipIds: inserted.map((clip) => clip.id),
    removedReferenceClipId: referenceClipId,
  };
}

export function planAdjustmentLayerRenderSpans(sequence: VideoSequenceNode): AdjustmentLayerRenderSpan[] {
  const adjustments = sequence.clips.filter((clip) => clip.kind === 'adjustment');
  const targets = sequence.clips.filter((clip) => clip.kind !== 'adjustment');
  return adjustments.flatMap((adjustment) => targets.flatMap((target): AdjustmentLayerRenderSpan[] => {
    if (target.trackOrder >= adjustment.trackOrder) return [];
    const startMs = Math.max(adjustment.startMs, target.startMs);
    const endMs = Math.min(adjustment.startMs + adjustment.durationMs, target.startMs + target.durationMs);
    if (endMs <= startMs) return [];
    return [{
      adjustmentClipId: adjustment.id,
      targetClipId: target.id,
      startMs,
      endMs,
      effectSignature: adjustment.effectSignature ?? '',
    }];
  })).sort((left, right) => left.startMs - right.startMs || left.adjustmentClipId.localeCompare(right.adjustmentClipId) || left.targetClipId.localeCompare(right.targetClipId));
}

function stableClipSignature(clip: VideoSequenceClip): string {
  return [
    clip.id,
    clip.kind,
    clip.sourceId,
    clip.trackId,
    clip.trackOrder,
    clip.startMs,
    clip.durationMs,
    clip.sourceInMs,
    clip.effectSignature ?? '',
    clip.linkGroupId ?? '',
  ].join('|');
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildVideoSequenceStructuralHash(
  graph: VideoSequenceGraph,
  sequenceId: string,
  visiting: ReadonlySet<string> = new Set(),
): string {
  if (visiting.has(sequenceId)) return fnv1a(`cycle:${sequenceId}`);
  const sequence = graph.sequences[sequenceId];
  if (!sequence) return fnv1a(`missing:${sequenceId}`);
  const nextVisiting = new Set(visiting);
  nextVisiting.add(sequenceId);
  const clipSignatures = [...sequence.clips]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((clip) => {
      const childHash = clip.kind === 'sequence' || clip.kind === 'compound'
        ? buildVideoSequenceStructuralHash(graph, clip.sourceId, nextVisiting)
        : '';
      return `${stableClipSignature(clip)}|${childHash}`;
    });
  return fnv1a([sequence.id, sequence.name, sequence.durationMs, sequence.revision, ...clipSignatures].join('\n'));
}

export function buildVideoSequenceInvalidationInputs(graph: VideoSequenceGraph): SequenceInvalidationInputs {
  const hashesBySequenceId = Object.fromEntries(Object.keys(graph.sequences).sort().map((sequenceId) => [
    sequenceId,
    buildVideoSequenceStructuralHash(graph, sequenceId),
  ]));
  const sourceAssetIds = [...new Set(Object.values(graph.sequences).flatMap((sequence) => sequence.clips
    .filter((clip) => clip.kind === 'media')
    .map((clip) => clip.sourceId)))].sort();
  return {
    rootSequenceId: graph.rootSequenceId,
    rootHash: hashesBySequenceId[graph.rootSequenceId] ?? fnv1a(`missing:${graph.rootSequenceId}`),
    hashesBySequenceId,
    sourceAssetIds,
  };
}

/** Descriptor used by tests/UI diagnostics to prove that a nest then flatten preserved clip spans. */
export function buildVideoSequenceEquivalenceDescriptor(clips: readonly VideoSequenceClip[]): string[] {
  return clips
    .filter((clip) => clip.kind !== 'adjustment')
    .map((clip) => [clip.kind, clip.sourceId, clip.trackId, clip.trackOrder, clip.startMs, clip.durationMs, clip.sourceInMs].join('|'))
    .sort();
}
