/** Pure project-navigation metadata. Sequence media and clip arrays live outside this model. */

export const VIDEO_SEQUENCE_NAVIGATOR_VERSION = 1 as const;
export const MAX_VIDEO_NAVIGATOR_SEQUENCES = 128;
export const MAX_VIDEO_NAVIGATOR_BINS = 128;
export const MAX_VIDEO_NAVIGATOR_TABS = 32;
export const MAX_VIDEO_NAVIGATOR_SELECTED_CLIPS = 2_000;
export const MAX_VIDEO_NAVIGATOR_DEPENDENCIES = MAX_VIDEO_NAVIGATOR_SEQUENCES * MAX_VIDEO_NAVIGATOR_SEQUENCES;
export const VIDEO_SEQUENCE_DEPENDENCY_TRUTH_BOUNDARY =
  'Safe deletion requires nestedSequenceIds or equivalent dependencies from the project composition root.' as const;

export interface VideoSequenceNavigatorSequence {
  id: string;
  name: string;
  binId?: string;
  durationMs: number;
  frameRate: number;
  createdAt: number;
  updatedAt: number;
  /** Nested composition references used by safe-delete planning. Media stays outside this model. */
  nestedSequenceIds?: string[];
}

export interface VideoSequenceNavigatorBin {
  id: string;
  name: string;
  order: number;
  collapsed: boolean;
}

export interface VideoSequenceNavigatorTab {
  sequenceId: string;
  pinned: boolean;
}

export interface VideoSequenceViewState {
  playheadMs: number;
  scrollLeftMs: number;
  verticalScrollPx: number;
  zoomPxPerSecond: number;
  selectedClipIds: string[];
}

export type VideoSequenceDependencyKind = 'nested-sequence' | 'delivery-job' | 'review-package' | 'external-reference';

export interface VideoSequenceDependency {
  id: string;
  consumerSequenceId?: string;
  requiredSequenceId: string;
  kind: VideoSequenceDependencyKind;
  label: string;
}

export interface VideoSequenceNavigatorModel {
  version: typeof VIDEO_SEQUENCE_NAVIGATOR_VERSION;
  bins: VideoSequenceNavigatorBin[];
  sequences: VideoSequenceNavigatorSequence[];
  tabs: VideoSequenceNavigatorTab[];
  activeSequenceId?: string;
  viewStateBySequenceId: Record<string, VideoSequenceViewState>;
  dependencies: VideoSequenceDependency[];
}

export interface VideoSequenceDuplicateDescriptor {
  sourceSequenceId: string;
  destinationSequenceId: string;
  includeMarkers: true;
  includeCaptions: true;
  includeReviewAnnotations: false;
  /** Media remains referenced, never copied into this descriptor. */
  mediaPolicy: 'reuse-project-source-references';
}

export interface VideoSequenceDeleteValidation {
  sequenceId: string;
  canDelete: boolean;
  blockers: VideoSequenceDependency[];
  closesTab: boolean;
  nextActiveSequenceId?: string;
}

export type VideoSequenceDeleteResult =
  | { ok: true; model: VideoSequenceNavigatorModel; validation: VideoSequenceDeleteValidation }
  | { ok: false; model: VideoSequenceNavigatorModel; validation: VideoSequenceDeleteValidation; reason: 'sequence-not-found' | 'dependency-blocked' };

export function createVideoSequenceNavigatorModel(): VideoSequenceNavigatorModel {
  return {
    version: VIDEO_SEQUENCE_NAVIGATOR_VERSION,
    bins: [],
    sequences: [],
    tabs: [],
    viewStateBySequenceId: {},
    dependencies: [],
  };
}

export function normalizeVideoSequenceNavigatorModel(value: unknown): VideoSequenceNavigatorModel {
  const input = isRecord(value) ? value : {};
  const bins = dedupeById((Array.isArray(input.bins) ? input.bins : [])
    .slice(0, MAX_VIDEO_NAVIGATOR_BINS)
    .flatMap(normalizeBin));
  const binIds = new Set(bins.map((bin) => bin.id));
  const unlinkedSequences = dedupeById((Array.isArray(input.sequences) ? input.sequences : [])
    .slice(0, MAX_VIDEO_NAVIGATOR_SEQUENCES)
    .flatMap((sequence) => normalizeSequence(sequence, binIds)));
  const sequenceIds = new Set(unlinkedSequences.map((sequence) => sequence.id));
  const sequences = unlinkedSequences.map((sequence) => ({
    ...sequence,
    ...(sequence.nestedSequenceIds ? {
      nestedSequenceIds: sequence.nestedSequenceIds
        .filter((nestedSequenceId) => nestedSequenceId !== sequence.id && sequenceIds.has(nestedSequenceId))
        .slice(0, MAX_VIDEO_NAVIGATOR_SEQUENCES),
    } : {}),
  }));
  const tabs = dedupeTabs((Array.isArray(input.tabs) ? input.tabs : [])
    .flatMap((tab) => normalizeTab(tab, sequenceIds)))
    .slice(0, MAX_VIDEO_NAVIGATOR_TABS);
  const viewStateBySequenceId: Record<string, VideoSequenceViewState> = {};
  if (isRecord(input.viewStateBySequenceId)) {
    for (const sequenceId of sequenceIds) {
      const state = normalizeViewState(input.viewStateBySequenceId[sequenceId]);
      if (state) viewStateBySequenceId[sequenceId] = state;
    }
  }
  const explicitDependencies = (Array.isArray(input.dependencies) ? input.dependencies : [])
    .flatMap((dependency) => normalizeDependency(dependency, sequenceIds));
  const nestedDependencies = sequences.flatMap((sequence) => (sequence.nestedSequenceIds ?? []).map((requiredSequenceId) => ({
    id: nestedDependencyId(sequence.id, requiredSequenceId),
    consumerSequenceId: sequence.id,
    requiredSequenceId,
    kind: 'nested-sequence' as const,
    label: `${sequence.name} nests ${sequences.find((candidate) => candidate.id === requiredSequenceId)?.name ?? requiredSequenceId}`,
  })));
  const dependencies = dedupeById([...explicitDependencies, ...nestedDependencies])
    .slice(0, MAX_VIDEO_NAVIGATOR_DEPENDENCIES);
  const activeSequenceId = typeof input.activeSequenceId === 'string' && sequenceIds.has(input.activeSequenceId)
    ? input.activeSequenceId
    : tabs[0]?.sequenceId;
  return {
    version: VIDEO_SEQUENCE_NAVIGATOR_VERSION,
    bins: normalizeBinOrders(bins),
    sequences,
    tabs,
    ...(activeSequenceId ? { activeSequenceId } : {}),
    viewStateBySequenceId,
    dependencies,
  };
}

export function addVideoSequenceNavigatorBin(
  model: VideoSequenceNavigatorModel,
  bin: Omit<VideoSequenceNavigatorBin, 'order' | 'collapsed'> & Partial<Pick<VideoSequenceNavigatorBin, 'collapsed'>>,
): VideoSequenceNavigatorModel {
  if (model.bins.length >= MAX_VIDEO_NAVIGATOR_BINS) throw new Error(`A project supports at most ${MAX_VIDEO_NAVIGATOR_BINS} sequence bins.`);
  const id = requiredText(bin.id, 'bin id');
  if (model.bins.some((candidate) => candidate.id === id)) throw new Error(`Sequence bin ID already exists: ${id}`);
  return cloneModel({
    ...model,
    bins: [...model.bins, { id, name: boundedText(bin.name, 160) || 'Sequence bin', order: model.bins.length, collapsed: bin.collapsed ?? false }],
  });
}

export function setVideoSequenceBinCollapsed(
  model: VideoSequenceNavigatorModel,
  binId: string,
  collapsed: boolean,
): VideoSequenceNavigatorModel {
  if (!model.bins.some((bin) => bin.id === binId)) return model;
  return cloneModel({ ...model, bins: model.bins.map((bin) => bin.id === binId ? { ...bin, collapsed } : bin) });
}

export function moveVideoSequenceToBin(
  model: VideoSequenceNavigatorModel,
  sequenceId: string,
  binId?: string,
): VideoSequenceNavigatorModel {
  if (binId && !model.bins.some((bin) => bin.id === binId)) throw new Error(`Sequence bin does not exist: ${binId}`);
  if (!model.sequences.some((sequence) => sequence.id === sequenceId)) return model;
  return cloneModel({
    ...model,
    sequences: model.sequences.map((sequence) => sequence.id === sequenceId
      ? { ...sequence, ...(binId ? { binId } : { binId: undefined }) }
      : sequence),
  });
}

export function openVideoSequenceTab(
  model: VideoSequenceNavigatorModel,
  sequenceId: string,
  options: { pinned?: boolean; activate?: boolean } = {},
): VideoSequenceNavigatorModel {
  if (!model.sequences.some((sequence) => sequence.id === sequenceId)) return model;
  const existing = model.tabs.find((tab) => tab.sequenceId === sequenceId);
  let tabs = existing
    ? model.tabs.map((tab) => tab.sequenceId === sequenceId ? { ...tab, pinned: options.pinned ?? tab.pinned } : { ...tab })
    : [...model.tabs, { sequenceId, pinned: options.pinned ?? false }];
  if (tabs.length > MAX_VIDEO_NAVIGATOR_TABS) {
    const removableIndex = tabs.findIndex((tab) => !tab.pinned && tab.sequenceId !== model.activeSequenceId);
    if (removableIndex < 0) throw new Error(`Only ${MAX_VIDEO_NAVIGATOR_TABS} sequence tabs can be open.`);
    tabs = tabs.filter((_, index) => index !== removableIndex);
  }
  return cloneModel({
    ...model,
    tabs,
    activeSequenceId: options.activate === false ? model.activeSequenceId : sequenceId,
  });
}

export function closeVideoSequenceTab(
  model: VideoSequenceNavigatorModel,
  sequenceId: string,
  forcePinned = false,
): VideoSequenceNavigatorModel {
  const tab = model.tabs.find((candidate) => candidate.sequenceId === sequenceId);
  if (!tab || (tab.pinned && !forcePinned)) return model;
  const closingIndex = model.tabs.findIndex((candidate) => candidate.sequenceId === sequenceId);
  const tabs = model.tabs.filter((candidate) => candidate.sequenceId !== sequenceId).map((candidate) => ({ ...candidate }));
  const activeSequenceId = model.activeSequenceId === sequenceId
    ? (tabs[Math.min(closingIndex, tabs.length - 1)]?.sequenceId ?? tabs.at(-1)?.sequenceId)
    : model.activeSequenceId;
  return cloneModel({ ...model, tabs, activeSequenceId });
}

export function reorderVideoSequenceTabs(
  model: VideoSequenceNavigatorModel,
  sequenceId: string,
  targetIndex: number,
): VideoSequenceNavigatorModel {
  const index = model.tabs.findIndex((tab) => tab.sequenceId === sequenceId);
  if (index < 0) return model;
  const tabs = model.tabs.map((tab) => ({ ...tab }));
  const [tab] = tabs.splice(index, 1);
  tabs.splice(Math.max(0, Math.min(tabs.length, Math.floor(targetIndex))), 0, tab);
  return cloneModel({ ...model, tabs });
}

export function renameVideoSequence(
  model: VideoSequenceNavigatorModel,
  sequenceId: string,
  name: string,
  updatedAt: number,
): VideoSequenceNavigatorModel {
  const cleanName = boundedText(name, 200);
  if (!cleanName || !model.sequences.some((sequence) => sequence.id === sequenceId)) return model;
  return cloneModel({
    ...model,
    sequences: model.sequences.map((sequence) => sequence.id === sequenceId
      ? { ...sequence, name: cleanName, updatedAt: finiteNonNegative(updatedAt) ?? sequence.updatedAt }
      : sequence),
  });
}

export function duplicateVideoSequence(input: {
  model: VideoSequenceNavigatorModel;
  sourceSequenceId: string;
  destinationSequenceId: string;
  name?: string;
  createdAt: number;
}): { model: VideoSequenceNavigatorModel; descriptor: VideoSequenceDuplicateDescriptor } {
  if (input.model.sequences.length >= MAX_VIDEO_NAVIGATOR_SEQUENCES) {
    throw new Error(`A project supports at most ${MAX_VIDEO_NAVIGATOR_SEQUENCES} sequences.`);
  }
  const source = input.model.sequences.find((sequence) => sequence.id === input.sourceSequenceId);
  if (!source) throw new Error(`Sequence does not exist: ${input.sourceSequenceId}`);
  const destinationSequenceId = requiredText(input.destinationSequenceId, 'destinationSequenceId');
  if (input.model.sequences.some((sequence) => sequence.id === destinationSequenceId)) {
    throw new Error(`Sequence ID already exists: ${destinationSequenceId}`);
  }
  const createdAt = finiteNonNegative(input.createdAt) ?? source.updatedAt;
  const duplicate: VideoSequenceNavigatorSequence = {
    ...source,
    id: destinationSequenceId,
    name: boundedText(input.name, 200) || `${source.name} Copy`,
    createdAt,
    updatedAt: createdAt,
  };
  return {
    model: openVideoSequenceTab(cloneModel({
      ...input.model,
      sequences: [...input.model.sequences, duplicate],
      viewStateBySequenceId: {
        ...input.model.viewStateBySequenceId,
        [destinationSequenceId]: createDefaultViewState(),
      },
    }), destinationSequenceId),
    descriptor: {
      sourceSequenceId: source.id,
      destinationSequenceId,
      includeMarkers: true,
      includeCaptions: true,
      includeReviewAnnotations: false,
      mediaPolicy: 'reuse-project-source-references',
    },
  };
}

export function setVideoSequenceViewState(
  model: VideoSequenceNavigatorModel,
  sequenceId: string,
  state: Partial<VideoSequenceViewState>,
): VideoSequenceNavigatorModel {
  if (!model.sequences.some((sequence) => sequence.id === sequenceId)) return model;
  const current = model.viewStateBySequenceId[sequenceId] ?? createDefaultViewState();
  const normalized = normalizeViewState({ ...current, ...state }) ?? current;
  return cloneModel({
    ...model,
    viewStateBySequenceId: { ...model.viewStateBySequenceId, [sequenceId]: normalized },
  });
}

export function validateVideoSequenceDelete(
  model: VideoSequenceNavigatorModel,
  sequenceId: string,
): VideoSequenceDeleteValidation {
  const blockers = collectVideoSequenceDependencies(model)
    .filter((dependency) => dependency.requiredSequenceId === sequenceId)
    .map((dependency) => ({ ...dependency }))
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const openIndex = model.tabs.findIndex((tab) => tab.sequenceId === sequenceId);
  const nextActiveSequenceId = model.activeSequenceId === sequenceId
    ? chooseDeterministicReplacementSequenceId(model, sequenceId, openIndex)
    : model.activeSequenceId;
  return {
    sequenceId,
    canDelete: blockers.length === 0 && model.sequences.some((sequence) => sequence.id === sequenceId),
    blockers,
    closesTab: openIndex >= 0,
    ...(nextActiveSequenceId ? { nextActiveSequenceId } : {}),
  };
}

export function planVideoSequenceDeletion(
  model: VideoSequenceNavigatorModel,
  sequenceId: string,
): VideoSequenceDeleteValidation {
  return validateVideoSequenceDelete(model, sequenceId);
}

export function deleteVideoSequenceSafely(
  model: VideoSequenceNavigatorModel,
  sequenceId: string,
): VideoSequenceDeleteResult {
  const exists = model.sequences.some((sequence) => sequence.id === sequenceId);
  const validation = validateVideoSequenceDelete(model, sequenceId);
  if (!exists) return { ok: false, model: cloneModel(model), validation, reason: 'sequence-not-found' };
  if (!validation.canDelete) return { ok: false, model: cloneModel(model), validation, reason: 'dependency-blocked' };
  const { [sequenceId]: _removed, ...viewStateBySequenceId } = model.viewStateBySequenceId;
  return {
    ok: true,
    validation,
    model: cloneModel({
      ...model,
      sequences: model.sequences.filter((sequence) => sequence.id !== sequenceId),
      tabs: model.tabs.filter((tab) => tab.sequenceId !== sequenceId),
      activeSequenceId: validation.nextActiveSequenceId,
      viewStateBySequenceId,
      dependencies: model.dependencies.filter((dependency) => dependency.consumerSequenceId !== sequenceId),
    }),
  };
}

function createDefaultViewState(): VideoSequenceViewState {
  return { playheadMs: 0, scrollLeftMs: 0, verticalScrollPx: 0, zoomPxPerSecond: 80, selectedClipIds: [] };
}

function normalizeBin(value: unknown): VideoSequenceNavigatorBin[] {
  if (!isRecord(value)) return [];
  const id = boundedText(value.id, 180);
  if (!id) return [];
  return [{
    id,
    name: boundedText(value.name, 160) || 'Sequence bin',
    order: finiteNonNegative(value.order) ?? 0,
    collapsed: value.collapsed === true,
  }];
}

function normalizeSequence(value: unknown, binIds: ReadonlySet<string>): VideoSequenceNavigatorSequence[] {
  if (!isRecord(value)) return [];
  const id = boundedText(value.id, 180);
  const frameRate = finitePositive(value.frameRate);
  if (!id || frameRate === undefined) return [];
  const binId = typeof value.binId === 'string' && binIds.has(value.binId) ? value.binId : undefined;
  const createdAt = finiteNonNegative(value.createdAt) ?? 0;
  return [{
    id,
    name: boundedText(value.name, 200) || 'Untitled sequence',
    ...(binId ? { binId } : {}),
    durationMs: finiteNonNegative(value.durationMs) ?? 0,
    frameRate,
    createdAt,
    updatedAt: finiteNonNegative(value.updatedAt) ?? createdAt,
    ...(Array.isArray(value.nestedSequenceIds) ? {
      nestedSequenceIds: dedupeStrings(value.nestedSequenceIds).slice(0, MAX_VIDEO_NAVIGATOR_SEQUENCES),
    } : {}),
  }];
}

function normalizeTab(value: unknown, sequenceIds: ReadonlySet<string>): VideoSequenceNavigatorTab[] {
  if (!isRecord(value) || typeof value.sequenceId !== 'string' || !sequenceIds.has(value.sequenceId)) return [];
  return [{ sequenceId: value.sequenceId, pinned: value.pinned === true }];
}

function normalizeViewState(value: unknown): VideoSequenceViewState | undefined {
  if (!isRecord(value)) return undefined;
  return {
    playheadMs: finiteNonNegative(value.playheadMs) ?? 0,
    scrollLeftMs: finiteNonNegative(value.scrollLeftMs) ?? 0,
    verticalScrollPx: finiteNonNegative(value.verticalScrollPx) ?? 0,
    zoomPxPerSecond: Math.max(1, Math.min(4_000, finitePositive(value.zoomPxPerSecond) ?? 80)),
    selectedClipIds: dedupeStrings(Array.isArray(value.selectedClipIds) ? value.selectedClipIds : [])
      .slice(0, MAX_VIDEO_NAVIGATOR_SELECTED_CLIPS),
  };
}

function normalizeDependency(value: unknown, sequenceIds: ReadonlySet<string>): VideoSequenceDependency[] {
  if (!isRecord(value)) return [];
  const id = boundedText(value.id, 180);
  const requiredSequenceId = boundedText(value.requiredSequenceId, 180);
  const kind = normalizeDependencyKind(value.kind);
  if (!id || !requiredSequenceId || !kind || !sequenceIds.has(requiredSequenceId)) return [];
  const consumerSequenceId = typeof value.consumerSequenceId === 'string' && sequenceIds.has(value.consumerSequenceId)
    ? value.consumerSequenceId
    : undefined;
  return [{
    id,
    ...(consumerSequenceId ? { consumerSequenceId } : {}),
    requiredSequenceId,
    kind,
    label: boundedText(value.label, 240) || kind,
  }];
}

function normalizeDependencyKind(value: unknown): VideoSequenceDependencyKind | undefined {
  return value === 'nested-sequence' || value === 'delivery-job' || value === 'review-package' || value === 'external-reference'
    ? value
    : undefined;
}

function cloneModel(model: VideoSequenceNavigatorModel): VideoSequenceNavigatorModel {
  return {
    version: VIDEO_SEQUENCE_NAVIGATOR_VERSION,
    bins: model.bins.map((bin) => ({ ...bin })),
    sequences: model.sequences.map((sequence) => ({
      ...sequence,
      ...(sequence.nestedSequenceIds ? { nestedSequenceIds: [...sequence.nestedSequenceIds] } : {}),
    })),
    tabs: model.tabs.map((tab) => ({ ...tab })),
    ...(model.activeSequenceId ? { activeSequenceId: model.activeSequenceId } : {}),
    viewStateBySequenceId: Object.fromEntries(Object.entries(model.viewStateBySequenceId)
      .map(([sequenceId, state]) => [sequenceId, { ...state, selectedClipIds: [...state.selectedClipIds] }])),
    dependencies: model.dependencies.map((dependency) => ({ ...dependency })),
  };
}

function collectVideoSequenceDependencies(model: VideoSequenceNavigatorModel): VideoSequenceDependency[] {
  const derived = model.sequences.flatMap((sequence) => (sequence.nestedSequenceIds ?? []).flatMap((requiredSequenceId) => {
    if (requiredSequenceId === sequence.id || !model.sequences.some((candidate) => candidate.id === requiredSequenceId)) return [];
    return [{
      id: nestedDependencyId(sequence.id, requiredSequenceId),
      consumerSequenceId: sequence.id,
      requiredSequenceId,
      kind: 'nested-sequence' as const,
      label: `${sequence.name} nests ${model.sequences.find((candidate) => candidate.id === requiredSequenceId)?.name ?? requiredSequenceId}`,
    }];
  }));
  return dedupeById([...model.dependencies.map((dependency) => ({ ...dependency })), ...derived])
    .slice(0, MAX_VIDEO_NAVIGATOR_DEPENDENCIES);
}

function chooseDeterministicReplacementSequenceId(
  model: VideoSequenceNavigatorModel,
  deletedSequenceId: string,
  deletedTabIndex: number,
): string | undefined {
  const remainingTabs = model.tabs.filter((tab) => tab.sequenceId !== deletedSequenceId);
  if (remainingTabs.length > 0) {
    if (deletedTabIndex >= 0) {
      return remainingTabs[Math.min(deletedTabIndex, remainingTabs.length - 1)]?.sequenceId;
    }
    return remainingTabs[0]?.sequenceId;
  }
  return model.sequences
    .filter((sequence) => sequence.id !== deletedSequenceId)
    .sort((left, right) => left.id.localeCompare(right.id))[0]?.id;
}

function nestedDependencyId(consumerSequenceId: string, requiredSequenceId: string): string {
  return `nested:${consumerSequenceId}:${requiredSequenceId}`;
}

function normalizeBinOrders(bins: readonly VideoSequenceNavigatorBin[]): VideoSequenceNavigatorBin[] {
  return [...bins].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((bin, order) => ({ ...bin, order }));
}

function dedupeById<T extends { id: string }>(values: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values) if (!byId.has(value.id)) byId.set(value.id, value);
  return [...byId.values()];
}

function dedupeTabs(tabs: readonly VideoSequenceNavigatorTab[]): VideoSequenceNavigatorTab[] {
  const bySequence = new Map<string, VideoSequenceNavigatorTab>();
  for (const tab of tabs) if (!bySequence.has(tab.sequenceId)) bySequence.set(tab.sequenceId, tab);
  return [...bySequence.values()];
}

function dedupeStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim()] : []))];
}

function boundedText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function requiredText(value: string, field: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${field} is required.`);
  return clean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
