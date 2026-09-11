import type {
  PaperDocument,
  PaperDocumentSnapshot,
  PaperFrame,
  PaperFramePatch,
  PaperWorkspaceDocumentSnapshot,
} from '../types/paper';
import { updatePaperFrame } from './paperDocument';
import type { BinaryAssetId, BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import {
  collectReachablePaperAssetIds,
  collectReachablePaperAssetRefs,
} from '../features/paper/assets/PaperDocumentAssets';

/**
 * Paper workspace channel for the unified cross-device op-sync (task #52; core in
 * [[projectSyncService]], generic transport/client proven by Flow in `docs/notes/766`). This is the
 * **pure, runtime-free op model + reducer** for the Paper document — the Paper analog of
 * [[flowGraphNativeSync]]. It carries only serializable document data (no canvas, no React, no store
 * import beyond the pure `updatePaperFrame` helper), so it runs identically on the phone authority and
 * a served client and is trivially unit-testable.
 *
 * Unlike Flow nodes, Paper frames carry **no runtime callbacks** — they are plain data — so there is no
 * strip/re-attach dance; a frame travels over the wire verbatim.
 *
 * Granularity decision (honest scope for the first cut): **frames are the only granular path.** A
 * Paper document is far richer than a Flow graph (per-page guides, parent pages, paragraph/character/
 * object styles, swatches, layout/grid/baseline setup, view toggles, page membership + numbering), and
 * frame editing is the high-frequency live action. So the diff emits granular frame ops
 * (added/moved/updated/removed) **only** while everything outside frame contents is stable; any change
 * to document setup or page membership/order/guides collapses to a single full `paper-document-snapshot`
 * (also the seed + version-gap repair op). Page-level granularity is a documented future refinement —
 * the reducer + diff form a closed set where every op is both produced by the diff and consumed by the
 * reducer (no dead arms).
 *
 * Versioning, the long-poll stream, and echo-loop prevention are the shared core's job; this module
 * only describes *what changed* and how to apply it. Every op is **id-addressed and idempotent**, so a
 * redelivered or self-echoed op is a no-op: the reducer returns the **same document reference** when
 * nothing changes, which the channel uses to decide whether to re-render / re-broadcast.
 */

export const PAPER_WORKSPACE_SYNC_SCHEMA_VERSION = 1 as const;

/** Local filesystem save provenance is intentionally never shared between devices. */
export type PaperWorkspaceSyncDocument = Omit<PaperWorkspaceDocumentSnapshot, 'persistence'>;

/**
 * Versioned, self-contained Paper workspace metadata. Managed bytes are kept out of JSON, but their
 * complete immutable references ride here so the policy layer can authenticate every fetched record
 * before publishing any of these documents to the live store.
 */
export interface PaperWorkspaceSyncEnvelopeV1 {
  activeDocumentId: string;
  documents: PaperWorkspaceSyncDocument[];
  assetRefs: BinaryAssetRef[];
}

/**
 * The current envelope deliberately retains the historical snapshot discriminator and active
 * `document` field. Older peers therefore apply the active document instead of falling through an
 * unknown-op switch, while current peers authenticate and atomically apply `workspace`.
 */
export interface PaperWorkspaceSnapshotChange {
  type: 'paper-document-snapshot';
  document: PaperDocument;
  assetIds?: BinaryAssetId[];
  schemaVersion: typeof PAPER_WORKSPACE_SYNC_SCHEMA_VERSION;
  workspace: PaperWorkspaceSyncEnvelopeV1;
  /** Authority workspace the sender last acknowledged; enables stale-peer three-way merge. */
  baseWorkspace?: PaperWorkspaceSyncEnvelopeV1;
}

export type PaperDocumentNativeChange =
  /** Full document snapshot — seed, version-gap repair, and the fallback for any non-frame change. */
  | { type: 'paper-document-snapshot'; document: PaperDocument; assetIds?: BinaryAssetId[]; schemaVersion?: number; workspace?: PaperWorkspaceSyncEnvelopeV1 }
  /** A frame was created on a page. Idempotent: ignored if that frame id already exists on the page. */
  | { type: 'paper-frame-added'; pageId: string; frame: PaperFrame }
  /** A frame was moved (typically the coalesced final position of a drag, not every pointer frame). */
  | { type: 'paper-frame-moved'; pageId: string; frameId: string; xMm: number; yMm: number }
  /** A frame changed — a patch merged onto the existing frame (full-frame patch is safe + idempotent). */
  | { type: 'paper-frame-updated'; pageId: string; frameId: string; patch: PaperFramePatch }
  /** A frame was removed from its page. */
  | { type: 'paper-frame-removed'; pageId: string; frameId: string };

/**
 * Apply one remote Paper op to the document, purely. Returns the **same document reference** when the op
 * is a no-op (idempotent redelivery, or an add/move/update/remove that targets a missing or unchanged
 * frame/page) so callers can cheaply detect whether anything actually changed.
 */
export function applyPaperDocumentNativeChange(
  document: PaperDocument,
  change: PaperDocumentNativeChange,
): PaperDocument {
  switch (change.type) {
    case 'paper-document-snapshot':
      return change.document;

    case 'paper-frame-added': {
      const page = document.pages.find((candidate) => candidate.id === change.pageId);
      if (!page) return document;
      if (page.frames.some((frame) => frame.id === change.frame.id)) return document;
      const pages = document.pages.map((candidate) =>
        candidate.id === change.pageId
          ? { ...candidate, frames: [...candidate.frames, { ...change.frame }] }
          : candidate,
      );
      return { ...document, pages, updatedAt: Date.now() };
    }

    case 'paper-frame-moved':
      return updatePaperFrame(document, change.pageId, change.frameId, {
        xMm: change.xMm,
        yMm: change.yMm,
      });

    case 'paper-frame-updated':
      return updatePaperFrame(document, change.pageId, change.frameId, change.patch);

    case 'paper-frame-removed': {
      const page = document.pages.find((candidate) => candidate.id === change.pageId);
      if (!page || !page.frames.some((frame) => frame.id === change.frameId)) return document;
      const pages = document.pages.map((candidate) =>
        candidate.id === change.pageId
          ? { ...candidate, frames: candidate.frames.filter((frame) => frame.id !== change.frameId) }
          : candidate,
      );
      return { ...document, pages, updatedAt: Date.now() };
    }
  }
}

/** Stable, key-order-independent JSON for comparing frames/document setup (all built via spreads). */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (val as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return val;
  });
}

/**
 * Fingerprint of everything **except frame contents** — document setup (title/page/layout/background/
 * print/view/parent pages/styles/swatches) plus each page's identity, order, parent, and guides, with
 * the volatile `updatedAt` zeroed. If two documents share this fingerprint, they differ (if at all)
 * *only* in their frames, so the diff can safely emit granular frame ops; otherwise it falls back to a
 * full snapshot.
 */
function structuralFingerprint(document: PaperDocument): string {
  return stableStringify({
    ...document,
    updatedAt: 0,
    pages: document.pages.map((page) => ({
      id: page.id,
      pageNumber: page.pageNumber,
      parentPageId: page.parentPageId,
      guides: page.guides,
    })),
  });
}

/** True when two frames are identical apart from their position (so the change is a pure move). */
function framesEqualIgnoringPosition(a: PaperFrame, b: PaperFrame): boolean {
  return stableStringify({ ...a, xMm: 0, yMm: 0 }) === stableStringify({ ...b, xMm: 0, yMm: 0 });
}

/**
 * Derive the minimal set of ops that turn `prev` into `next`. Frames are diffed granularly per page;
 * any change to document setup or page membership/order/guides collapses to a single snapshot (see the
 * module header). Granular frame ops keep the door open for the per-object soft-locks / merge logic in
 * the concurrency design (note 764).
 */
export function diffPaperDocumentNativeChanges(
  prev: PaperDocument,
  next: PaperDocument,
): PaperDocumentNativeChange[] {
  if (prev === next) return [];
  if (structuralFingerprint(prev) !== structuralFingerprint(next)) {
    return [createPaperDocumentSnapshotChange(next)];
  }

  const ops: PaperDocumentNativeChange[] = [];
  const nextPagesById = new Map(next.pages.map((page) => [page.id, page]));

  for (const prevPage of prev.pages) {
    const nextPage = nextPagesById.get(prevPage.id);
    if (!nextPage) continue; // page membership change would have tripped the fingerprint above

    const prevFrames = new Map(prevPage.frames.map((frame) => [frame.id, frame]));
    const nextFrames = new Map(nextPage.frames.map((frame) => [frame.id, frame]));

    for (const id of prevFrames.keys()) {
      if (!nextFrames.has(id)) ops.push({ type: 'paper-frame-removed', pageId: prevPage.id, frameId: id });
    }
    for (const [id, frame] of nextFrames) {
      const before = prevFrames.get(id);
      if (!before) {
        ops.push({ type: 'paper-frame-added', pageId: nextPage.id, frame });
        continue;
      }
      if (before === frame) continue;
      if ((before.xMm !== frame.xMm || before.yMm !== frame.yMm) && framesEqualIgnoringPosition(before, frame)) {
        ops.push({ type: 'paper-frame-moved', pageId: nextPage.id, frameId: id, xMm: frame.xMm, yMm: frame.yMm });
      } else if (stableStringify(before) !== stableStringify(frame)) {
        ops.push({ type: 'paper-frame-updated', pageId: nextPage.id, frameId: id, patch: frame });
      }
    }
  }

  return ops;
}

/** Asset bytes travel on the project asset channel; Paper sync carries only their reachable ids. */
export function createPaperDocumentSnapshotChange(document: PaperDocument): PaperDocumentNativeChange {
  const assetIds = collectReachablePaperAssetIds(document);
  return {
    type: 'paper-document-snapshot',
    document,
    ...(assetIds.length ? { assetIds } : {}),
  };
}

/**
 * Build the current schema-v1 workspace payload from the store's persistence-safe export. The
 * ordered document array is the tab order. Reachability is recomputed from document content rather
 * than trusting advisory `assetIds`, and conflicting references fail before any network publication.
 */
export function createPaperWorkspaceSnapshotChange(
  snapshot: PaperDocumentSnapshot,
): PaperWorkspaceSnapshotChange {
  const sourceDocuments = snapshot.documents?.length
    ? snapshot.documents
    : [{
      id: snapshot.activeDocumentId || snapshot.document.id || 'paper-document',
      document: snapshot.document,
      assetIds: snapshot.assetIds,
      selectedPageId: snapshot.selectedPageId,
      selectedFrameId: snapshot.selectedFrameId,
      selectedFrameIds: snapshot.selectedFrameIds,
      tool: snapshot.tool,
      zoom: snapshot.zoom,
    } satisfies PaperWorkspaceDocumentSnapshot];
  const documents: PaperWorkspaceSyncDocument[] = sourceDocuments.map(
    ({ persistence: _localPersistence, ...candidate }) => ({
      ...candidate,
      assetIds: collectReachablePaperAssetIds(candidate.document),
    }),
  );
  const activeDocumentId = documents.some((candidate) => candidate.id === snapshot.activeDocumentId)
    ? snapshot.activeDocumentId!
    : documents[0]?.id ?? '';
  const assetRefsById = new Map<BinaryAssetId, BinaryAssetRef>();
  for (const candidate of documents) {
    for (const ref of collectReachablePaperAssetRefs(candidate.document)) {
      const existing = assetRefsById.get(ref.id);
      if (existing && (
        existing.sha256 !== ref.sha256
        || existing.mimeType !== ref.mimeType
        || existing.byteLength !== ref.byteLength
      )) {
        throw new Error(`Paper workspace asset ${ref.id} has conflicting managed metadata.`);
      }
      if (!existing) assetRefsById.set(ref.id, { ...ref });
    }
  }
  return {
    type: 'paper-document-snapshot',
    document: documents.find((candidate) => candidate.id === activeDocumentId)?.document
      ?? snapshot.document,
    assetIds: [...assetRefsById.keys()].sort(),
    schemaVersion: PAPER_WORKSPACE_SYNC_SCHEMA_VERSION,
    workspace: {
      activeDocumentId,
      documents,
      assetRefs: [...assetRefsById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    },
  };
}

export function isPaperWorkspaceSnapshotChange(
  change: PaperDocumentNativeChange,
): change is PaperWorkspaceSnapshotChange {
  return change.type === 'paper-document-snapshot'
    && change.schemaVersion === PAPER_WORKSPACE_SYNC_SCHEMA_VERSION
    && change.workspace !== undefined;
}
