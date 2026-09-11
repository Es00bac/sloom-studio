import type {
  PaperWorkspaceSyncDocument,
  PaperWorkspaceSyncEnvelopeV1,
} from './paperDocumentNativeSync';
import {
  collectReachablePaperAssetIds,
  collectReachablePaperAssetRefs,
} from '../features/paper/assets/PaperDocumentAssets';
import type { BinaryAssetId, BinaryAssetRef } from '../shared/assets/contentAddressedAsset';

const MISSING = Symbol('paper-workspace-missing');
type MergeResult = unknown | typeof MISSING;

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIdRecordArray(value: unknown): value is Array<Record<string, unknown> & { id: string }> {
  return Array.isArray(value)
    && value.every((candidate) => isRecord(candidate) && typeof candidate.id === 'string' && candidate.id.length > 0);
}

function idOrderChanged(
  baseline: ReadonlyArray<{ id: string }>,
  candidate: ReadonlyArray<{ id: string }>,
): boolean {
  const candidateIds = new Set(candidate.map(({ id }) => id));
  const baselineIds = new Set(baseline.map(({ id }) => id));
  const baselineCommon = baseline.map(({ id }) => id).filter((id) => candidateIds.has(id));
  const candidateCommon = candidate.map(({ id }) => id).filter((id) => baselineIds.has(id));
  return !sameValue(baselineCommon, candidateCommon);
}

/**
 * Three-way merge for Paper's plain serializable document graph.
 *
 * The authority's newer value is retained whenever this device did not change the corresponding
 * baseline value. Concurrent local edits are then replayed over it. Arrays of id-addressed Paper
 * entities (documents, pages, frames, layers, styles, swatches, and so on) merge per id, so editing
 * different frames or pages on two screens does not collapse into a whole-workspace last-writer win.
 * A genuine same-field conflict deliberately resolves to the still-unpublished local edit; it is
 * published after the remote envelope and therefore follows the authority's ordering.
 */
function mergeValue(base: unknown, local: unknown, remote: unknown): MergeResult {
  if (sameValue(local, base)) return remote;
  if (sameValue(remote, base) || sameValue(local, remote)) return local;

  if (isIdRecordArray(base) && isIdRecordArray(local) && isIdRecordArray(remote)) {
    const baseById = new Map(base.map((item) => [item.id, item]));
    const localById = new Map(local.map((item) => [item.id, item]));
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const mergedById = new Map<string, Record<string, unknown> & { id: string }>();
    const ids = new Set([...baseById.keys(), ...remoteById.keys(), ...localById.keys()]);

    for (const id of ids) {
      const hadBase = baseById.has(id);
      const hasLocal = localById.has(id);
      const hasRemote = remoteById.has(id);
      if (hadBase && !hasLocal) continue; // pending local deletion wins a same-entity conflict
      if (hadBase && !hasRemote) {
        const localItem = localById.get(id);
        if (localItem && !sameValue(localItem, baseById.get(id))) mergedById.set(id, localItem);
        continue;
      }
      if (!hasLocal && hasRemote) {
        mergedById.set(id, remoteById.get(id)!);
        continue;
      }
      if (hasLocal && !hasRemote) {
        mergedById.set(id, localById.get(id)!);
        continue;
      }
      const merged = mergeValue(baseById.get(id), localById.get(id), remoteById.get(id));
      if (merged !== MISSING && isRecord(merged)) {
        mergedById.set(id, merged as Record<string, unknown> & { id: string });
      }
    }

    const preferredOrder = idOrderChanged(base, local) ? local : remote;
    const orderedIds = [
      ...preferredOrder.map(({ id }) => id),
      ...remote.map(({ id }) => id),
      ...local.map(({ id }) => id),
    ];
    const emitted = new Set<string>();
    return orderedIds.flatMap((id) => {
      if (emitted.has(id)) return [];
      emitted.add(id);
      const item = mergedById.get(id);
      return item ? [item] : [];
    });
  }

  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(remote), ...Object.keys(local)]);
    for (const key of keys) {
      const baseHas = Object.hasOwn(base, key);
      const localHas = Object.hasOwn(local, key);
      const remoteHas = Object.hasOwn(remote, key);
      if (baseHas && !localHas) continue;
      if (baseHas && !remoteHas) {
        if (localHas && !sameValue(local[key], base[key])) result[key] = local[key];
        continue;
      }
      if (!localHas && remoteHas) {
        result[key] = remote[key];
        continue;
      }
      if (localHas && !remoteHas) {
        result[key] = local[key];
        continue;
      }
      const merged = mergeValue(base[key], local[key], remote[key]);
      if (merged !== MISSING) result[key] = merged;
    }
    return result;
  }

  // Primitive, non-id array, and shape conflicts are indivisible. The pending local value is the
  // later operation from this device, so retain it and let the next publish order it after remote.
  return local;
}

function mergeDocuments(
  base: PaperWorkspaceSyncDocument[],
  local: PaperWorkspaceSyncDocument[],
  remote: PaperWorkspaceSyncDocument[],
): PaperWorkspaceSyncDocument[] {
  const merged = mergeValue(base, local, remote);
  return Array.isArray(merged) ? merged as PaperWorkspaceSyncDocument[] : remote;
}

function collectAssetRefs(documents: PaperWorkspaceSyncDocument[]): BinaryAssetRef[] {
  const byId = new Map<BinaryAssetId, BinaryAssetRef>();
  for (const candidate of documents) {
    for (const ref of collectReachablePaperAssetRefs(candidate.document)) {
      const existing = byId.get(ref.id);
      if (existing && !sameValue(existing, ref)) {
        throw new Error(`Conflicting managed Paper asset reference ${ref.id}.`);
      }
      byId.set(ref.id, ref);
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Rebase this device's unpublished authored edits over an incoming authority envelope. Paper's
 * selection, active tab, tool, and zoom are interaction state, so matching tabs retain the receiving
 * device's values rather than making a phone tap move the desktop user's viewport.
 */
export function rebasePaperWorkspace(
  baseline: PaperWorkspaceSyncEnvelopeV1 | null,
  local: PaperWorkspaceSyncEnvelopeV1,
  remote: PaperWorkspaceSyncEnvelopeV1,
  viewSource: PaperWorkspaceSyncEnvelopeV1 = local,
): PaperWorkspaceSyncEnvelopeV1 {
  const documents = (baseline
    ? mergeDocuments(baseline.documents, local.documents, remote.documents)
    : remote.documents
  ).map((candidate) => {
    const localView = viewSource.documents.find(({ id }) => id === candidate.id);
    return {
      ...candidate,
      assetIds: collectReachablePaperAssetIds(candidate.document),
      ...(localView ? {
        selectedPageId: localView.selectedPageId,
        selectedFrameId: localView.selectedFrameId,
        selectedFrameIds: localView.selectedFrameIds,
        tool: localView.tool,
        zoom: localView.zoom,
      } : {}),
    };
  });
  const ids = new Set(documents.map(({ id }) => id));
  const activeDocumentId = ids.has(viewSource.activeDocumentId)
    ? viewSource.activeDocumentId
    : ids.has(remote.activeDocumentId)
      ? remote.activeDocumentId
      : documents[0]?.id ?? '';
  return { activeDocumentId, documents, assetRefs: collectAssetRefs(documents) };
}

/** Fingerprint authored project content only; view/selection state remains per device. */
export function paperWorkspaceAuthoredFingerprint(workspace: PaperWorkspaceSyncEnvelopeV1): string {
  return JSON.stringify({
    documents: workspace.documents.map(({ id, document }) => ({ id, document })),
    assetRefs: workspace.assetRefs,
  });
}
