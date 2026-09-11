import type { EditorSourceKind } from '../types/flow';
import type { SourceBinProjectSnapshot } from '../store/sourceBinStore';

/**
 * Cross-project Source Library catalogue (MH-085).
 *
 * The catalogue is a bounded, metadata-only index of what each project's
 * Source Library contained when that project was saved or opened on this
 * device. It never stores asset bytes. Its purpose is discoverability:
 * "which project had that generated image, and where else is this source
 * used?" — with an explicit, honest boundary that an item's bytes live in
 * its own project; the catalogue only points at them.
 */

export interface SourceCatalogEntry {
  itemId: string;
  label: string;
  kind: EditorSourceKind;
  mimeType?: string;
  createdAt: number;
  sourceKey?: string;
  originNodeId?: string;
  originWorkspaceId?: string;
  isGenerated?: boolean;
  pixelWidth?: number;
  pixelHeight?: number;
  starred?: boolean;
}

export interface SourceCatalogProjectRecord {
  projectId: string;
  projectName: string;
  firstRecordedAt: number;
  lastSavedAt: number;
  entries: SourceCatalogEntry[];
  /** True when the project had more items than the per-project retention cap. */
  truncated: boolean;
}

export interface SourceCatalogLineage {
  /** The shared durable source key that ties the same asset together. */
  sourceKey: string;
  projectIds: string[];
}

/** Retention bounds keep the persisted catalogue small and predictable. */
export const SOURCE_CATALOG_MAX_PROJECTS = 50;
export const SOURCE_CATALOG_MAX_ENTRIES_PER_PROJECT = 2000;
/** Upper bound on flattened search results handed to the UI at once. */
export const SOURCE_CATALOG_MAX_SEARCH_RESULTS = 400;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function deriveEntry(raw: unknown): SourceCatalogEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const itemId = typeof record.id === 'string' && record.id.length > 0 ? record.id : undefined;
  if (!itemId) return undefined;
  const kind = record.kind;
  if (typeof kind !== 'string' || kind.length === 0) return undefined;
  const createdAt = finiteNumber(record.createdAt) ?? 0;
  return {
    itemId,
    label: typeof record.label === 'string' && record.label.length > 0 ? record.label : 'Untitled item',
    kind: kind as EditorSourceKind,
    mimeType: optionalString(record.mimeType),
    createdAt,
    sourceKey: optionalString(record.sourceKey),
    originNodeId: optionalString(record.originNodeId),
    originWorkspaceId: optionalString(record.originWorkspaceId),
    isGenerated: record.isGenerated === true ? true : undefined,
    pixelWidth: finiteNumber(record.pixelWidth),
    pixelHeight: finiteNumber(record.pixelHeight),
    starred: record.starred === true ? true : undefined,
  };
}

/** Derive catalogue entries (metadata only) from a Source Library snapshot. */
export function deriveSourceCatalogEntries(snapshot: SourceBinProjectSnapshot | undefined): SourceCatalogEntry[] {
  const items: unknown[] = [];
  for (const bin of snapshot?.bins ?? []) {
    if (Array.isArray((bin as { items?: unknown })?.items)) {
      items.push(...((bin as { items: unknown[] }).items));
    }
  }
  const entries: SourceCatalogEntry[] = [];
  const seenItemIds = new Set<string>();
  for (const item of items) {
    const entry = deriveEntry(item);
    if (!entry || seenItemIds.has(entry.itemId)) continue;
    seenItemIds.add(entry.itemId);
    entries.push(entry);
  }
  return entries;
}

export interface SourceCatalogRecordInput {
  projectId: string;
  projectName: string;
  savedAt: number;
  snapshot?: SourceBinProjectSnapshot;
}

/** Build a complete project record from a save/open observation. */
export function buildSourceCatalogProjectRecord(input: SourceCatalogRecordInput): SourceCatalogProjectRecord {
  const allEntries = deriveSourceCatalogEntries(input.snapshot);
  const kept = allEntries.length > SOURCE_CATALOG_MAX_ENTRIES_PER_PROJECT
    ? allEntries.slice(0, SOURCE_CATALOG_MAX_ENTRIES_PER_PROJECT)
    : allEntries;
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    firstRecordedAt: input.savedAt,
    lastSavedAt: input.savedAt,
    entries: kept,
    truncated: allEntries.length > kept.length,
  };
}

/**
 * Upsert one project record into the catalogue. The most recently saved
 * project stays first; the oldest project record beyond the retention cap is
 * dropped. Re-recording a project refreshes its entries while keeping the
 * earliest firstRecordedAt seen for it.
 */
export function upsertSourceCatalogProjectRecord(
  records: readonly SourceCatalogProjectRecord[],
  next: SourceCatalogProjectRecord,
): SourceCatalogProjectRecord[] {
  const existing = records.find((record) => record.projectId === next.projectId);
  const merged: SourceCatalogProjectRecord = existing
    ? { ...next, firstRecordedAt: Math.min(existing.firstRecordedAt, next.firstRecordedAt) }
    : next;
  const withoutCurrent = records.filter((record) => record.projectId !== next.projectId);
  const updated = [merged, ...withoutCurrent]
    .sort((a, b) => b.lastSavedAt - a.lastSavedAt)
    .slice(0, SOURCE_CATALOG_MAX_PROJECTS);
  return updated;
}

/** Group identical durable source keys across different projects (lineage). */
export function deriveSourceCatalogLineage(
  records: readonly SourceCatalogProjectRecord[],
): SourceCatalogLineage[] {
  const bySourceKey = new Map<string, Set<string>>();
  for (const record of records) {
    for (const entry of record.entries) {
      if (!entry.sourceKey) continue;
      let projects = bySourceKey.get(entry.sourceKey);
      if (!projects) {
        projects = new Set<string>();
        bySourceKey.set(entry.sourceKey, projects);
      }
      projects.add(record.projectId);
    }
  }
  const lineage: SourceCatalogLineage[] = [];
  for (const [sourceKey, projectIds] of bySourceKey) {
    if (projectIds.size >= 2) {
      lineage.push({ sourceKey, projectIds: [...projectIds] });
    }
  }
  return lineage.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

export interface SourceCatalogSearchFilters {
  text?: string;
  /** `undefined` means every project. */
  projectId?: string;
  /** `undefined` means every kind. */
  kind?: EditorSourceKind;
  /** `undefined` means both generated and imported items. */
  generated?: boolean;
}

export interface SourceCatalogSearchResult {
  record: SourceCatalogProjectRecord;
  entry: SourceCatalogEntry;
  /** Other recorded projects whose Source Library shares this entry's source key. */
  alsoInProjectIds: string[];
}

export interface SourceCatalogSearchOutcome {
  results: SourceCatalogSearchResult[];
  totalMatches: number;
  truncated: boolean;
}

/**
 * Flatten and filter the catalogue. Results are capped for the UI; the
 * outcome reports the full match count so the dialog can say how much was
 * hidden rather than silently truncating.
 */
export function searchSourceCatalog(
  records: readonly SourceCatalogProjectRecord[],
  filters: SourceCatalogSearchFilters = {},
): SourceCatalogSearchOutcome {
  const normalizedText = filters.text?.trim().toLowerCase() ?? '';
  const lineageBySourceKey = new Map<string, string[]>();
  for (const lineage of deriveSourceCatalogLineage(records)) {
    lineageBySourceKey.set(lineage.sourceKey, lineage.projectIds);
  }

  const matches: SourceCatalogSearchResult[] = [];
  for (const record of records) {
    if (filters.projectId && record.projectId !== filters.projectId) continue;
    for (const entry of record.entries) {
      if (filters.kind && entry.kind !== filters.kind) continue;
      if (filters.generated !== undefined && Boolean(entry.isGenerated) !== filters.generated) continue;
      if (normalizedText) {
        const haystack = [entry.label, entry.kind, entry.mimeType ?? '', record.projectName]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(normalizedText)) continue;
      }
      matches.push({
        record,
        entry,
        alsoInProjectIds: (entry.sourceKey ? lineageBySourceKey.get(entry.sourceKey) : undefined)
          ?.filter((projectId) => projectId !== record.projectId) ?? [],
      });
    }
  }
  matches.sort((a, b) => (b.record.lastSavedAt - a.record.lastSavedAt)
    || (b.entry.createdAt - a.entry.createdAt)
    || a.entry.itemId.localeCompare(b.entry.itemId));

  return {
    results: matches.slice(0, SOURCE_CATALOG_MAX_SEARCH_RESULTS),
    totalMatches: matches.length,
    truncated: matches.length > SOURCE_CATALOG_MAX_SEARCH_RESULTS,
  };
}

function parsePersistedEntry(value: unknown): SourceCatalogEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const itemId = optionalString(record.itemId);
  const kind = optionalString(record.kind);
  if (!itemId || !kind) return undefined;
  const createdAt = finiteNumber(record.createdAt);
  if (createdAt === undefined) return undefined;
  return {
    itemId,
    label: optionalString(record.label) ?? 'Untitled item',
    kind: kind as EditorSourceKind,
    mimeType: optionalString(record.mimeType),
    createdAt,
    sourceKey: optionalString(record.sourceKey),
    originNodeId: optionalString(record.originNodeId),
    originWorkspaceId: optionalString(record.originWorkspaceId),
    isGenerated: record.isGenerated === true ? true : undefined,
    pixelWidth: finiteNumber(record.pixelWidth),
    pixelHeight: finiteNumber(record.pixelHeight),
    starred: record.starred === true ? true : undefined,
  };
}

function parsePersistedRecord(value: unknown): SourceCatalogProjectRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const projectId = optionalString(record.projectId);
  const projectName = optionalString(record.projectName);
  if (!projectId || !projectName) return undefined;
  const firstRecordedAt = finiteNumber(record.firstRecordedAt);
  const lastSavedAt = finiteNumber(record.lastSavedAt);
  if (firstRecordedAt === undefined || lastSavedAt === undefined) return undefined;
  const entries: SourceCatalogEntry[] = [];
  for (const raw of Array.isArray(record.entries) ? record.entries : []) {
    const entry = parsePersistedEntry(raw);
    if (entry) entries.push(entry);
  }
  return {
    projectId,
    projectName,
    firstRecordedAt,
    lastSavedAt,
    entries,
    truncated: record.truncated === true,
  };
}

/**
 * Fail-closed persisted-state parsing: structurally invalid records and
 * entries are dropped (with one warning) rather than corrupting the live
 * catalogue, and a non-array payload yields an empty catalogue.
 */
export function parsePersistedSourceCatalog(value: unknown): SourceCatalogProjectRecord[] {
  if (!Array.isArray(value)) {
    if (value !== undefined && value !== null) {
      console.warn('[sourceCatalog] persisted catalogue state was invalid; starting empty.');
    }
    return [];
  }
  const records: SourceCatalogProjectRecord[] = [];
  let dropped = 0;
  for (const raw of value) {
    const record = parsePersistedRecord(raw);
    if (record) {
      records.push(record);
    } else {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`[sourceCatalog] dropped ${dropped} invalid persisted project record(s).`);
  }
  return upsertAllPersisted(records);
}

function upsertAllPersisted(records: readonly SourceCatalogProjectRecord[]): SourceCatalogProjectRecord[] {
  const deduped = new Map<string, SourceCatalogProjectRecord>();
  for (const record of records) {
    const existing = deduped.get(record.projectId);
    deduped.set(record.projectId, existing
      ? (record.lastSavedAt >= existing.lastSavedAt ? record : existing)
      : record);
  }
  return [...deduped.values()]
    .sort((a, b) => b.lastSavedAt - a.lastSavedAt)
    .slice(0, SOURCE_CATALOG_MAX_PROJECTS);
}
