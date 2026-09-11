import type { FlowProjectDocument } from './projectLibrary';

/**
 * Bounded project version history (MH-005).
 *
 * A project document may carry one `projectHistory` section holding a capped list of revisions.
 * Every revision stores a serialized content-only snapshot of the project (the document minus the
 * history section itself, minus volatile save metadata) plus a deterministic change summary
 * against the previous revision. Successful saves capture revisions automatically; users can add
 * manual named snapshots, rename, inspect, restore, delete, and branch them.
 */

export const PROJECT_HISTORY_SECTION_VERSION = 1;

/** Total revision records retained per project (automatic evictions remove the oldest first). */
export const PROJECT_HISTORY_MAX_REVISIONS = 20;

/** A single revision payload larger than this budget is never stored (typed failure / skip). */
export const PROJECT_HISTORY_MAX_PAYLOAD_CHARS = 8 * 1024 * 1024;

/** Aggregate serialized payload budget for the whole section. */
export const PROJECT_HISTORY_MAX_TOTAL_PAYLOAD_CHARS = 24 * 1024 * 1024;

/** Revision names are compacted and hard-capped to keep lists readable and bounded. */
export const PROJECT_HISTORY_MAX_NAME_CHARS = 80;

/** Session-scoped restore undo/redo hops retained per project. */
export const PROJECT_HISTORY_RESTORE_STACK_LIMIT = 10;

export type ProjectRevisionKind = 'save' | 'manual';

export interface ProjectRevisionChangeSummaryEntry {
  /** Fixed section identifier; the set is closed and ordered deterministically. */
  section: string;
  before: number;
  after: number;
  /** Identity-set differences where stable ids exist; 0 otherwise. */
  added: number;
  removed: number;
}

export interface ProjectRevisionChangeSummary {
  version: 1;
  /** True when the revision is the first captured state (no previous revision to diff). */
  initial: boolean;
  name?: { from: string; to: string };
  sections: ProjectRevisionChangeSummaryEntry[];
}

export interface ProjectRevisionRecord {
  id: string;
  kind: ProjectRevisionKind;
  name: string;
  createdAt: number;
  summary: ProjectRevisionChangeSummary;
  /** Serialized content-only project document. Parsed and sanitized lazily at restore/branch. */
  payload: string;
  payloadChars: number;
  renamedAt?: number;
}

export interface ProjectHistoryBranchProvenance {
  projectId: string;
  projectName: string;
  revisionId: string;
  revisionName: string;
  branchedAt: number;
}

export interface ProjectHistorySection {
  version: 1;
  revisions: ProjectRevisionRecord[];
  branchedFrom?: ProjectHistoryBranchProvenance;
}

export type ProjectRevisionSkipReason = 'unchanged' | 'payload-too-large';

export interface StagedProjectRevision {
  document: FlowProjectDocument;
  /** The newly captured record, or null when capture was skipped. */
  revision: ProjectRevisionRecord | null;
  skippedReason?: ProjectRevisionSkipReason;
}

export class ProjectHistoryLimitError extends Error {
  readonly limit: 'payload' | 'name';

  constructor(limit: 'payload' | 'name', message: string) {
    super(message);
    this.name = 'ProjectHistoryLimitError';
    this.limit = limit;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function compactProjectRevisionName(name: string, fallback = 'Snapshot'): string {
  const compacted = name.trim().replace(/\s+/g, ' ').slice(0, PROJECT_HISTORY_MAX_NAME_CHARS).trim();
  return compacted || fallback;
}

/**
 * Content-only view of a project document for revision payloads: history itself is stripped (it
 * must never nest) and volatile save metadata (`savedAt`, `fileSystem`) is excluded so that
 * byte-identical project content produces identical payloads for change detection.
 */
export type ProjectRevisionContentDocument = Omit<FlowProjectDocument, 'projectHistory' | 'savedAt' | 'fileSystem'>;

export function buildProjectRevisionContent(document: FlowProjectDocument): ProjectRevisionContentDocument {
  const { projectHistory: _projectHistory, savedAt: _savedAt, fileSystem: _fileSystem, ...content } = document;
  return content;
}

export function serializeProjectRevisionPayload(content: ProjectRevisionContentDocument): string {
  return JSON.stringify(content);
}

export function projectHistoryTotalPayloadChars(records: readonly ProjectRevisionRecord[]): number {
  return records.reduce((total, record) => total + record.payloadChars, 0);
}

interface SectionMagnitude {
  count: number;
  ids: string[];
}

function collectSectionIds(values: unknown, idOf: (value: unknown) => string | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const id = idOf(value);
    return typeof id === 'string' && id.length > 0 ? [id] : [];
  });
}

function flowNodesMagnitude(document: ProjectRevisionContentDocument): SectionMagnitude {
  const nodes = document.flow?.nodes;
  return {
    count: Array.isArray(nodes) ? nodes.length : 0,
    ids: collectSectionIds(nodes, (node) => (isRecord(node) ? optionalString(node.id) : undefined)),
  };
}

function flowEdgesMagnitude(document: ProjectRevisionContentDocument): SectionMagnitude {
  const edges = document.flow?.edges;
  return { count: Array.isArray(edges) ? edges.length : 0, ids: [] };
}

function flowWorkspacesMagnitude(document: ProjectRevisionContentDocument): SectionMagnitude {
  const workspaces = document.flowWorkspaces;
  return {
    count: Array.isArray(workspaces) ? workspaces.length : 0,
    ids: collectSectionIds(workspaces, (workspace) => (isRecord(workspace) ? optionalString(workspace.id) : undefined)),
  };
}

function imageDocumentsMagnitude(document: ProjectRevisionContentDocument): SectionMagnitude {
  const documents = document.imageEditor?.documents;
  return {
    count: Array.isArray(documents) ? documents.length : 0,
    ids: collectSectionIds(documents, (entry) => (isRecord(entry) ? optionalString(entry.id) : undefined)),
  };
}

function imageLayersMagnitude(document: ProjectRevisionContentDocument): SectionMagnitude {
  const documents = document.imageEditor?.documents;
  if (!Array.isArray(documents)) return { count: 0, ids: [] };
  let layers = 0;
  for (const entry of documents) {
    if (isRecord(entry) && Array.isArray(entry.layers)) layers += entry.layers.length;
  }
  return { count: layers, ids: [] };
}

function paperDocumentsMagnitude(document: ProjectRevisionContentDocument): SectionMagnitude {
  const paper = document.paper;
  const active = isRecord(paper) && isRecord(paper.document) ? paper.document : undefined;
  const workspaceDocuments = isRecord(paper) && Array.isArray(paper.documents) ? paper.documents : [];
  const ids = [
    ...collectSectionIds(active ? [active] : [], (entry) => (isRecord(entry) ? optionalString(entry.id) : undefined)),
    ...collectSectionIds(workspaceDocuments, (entry) => (
      isRecord(entry) && isRecord(entry.document) ? optionalString(entry.document.id) : undefined
    )),
  ];
  return { count: ids.length, ids };
}

function sourceBinItemsMagnitude(document: ProjectRevisionContentDocument): SectionMagnitude {
  const bins = document.sourceBin?.bins;
  const items = Array.isArray(bins)
    ? bins.flatMap((bin) => (isRecord(bin) && Array.isArray(bin.items) ? bin.items : []))
    : [];
  return {
    count: items.length,
    ids: collectSectionIds(items, (item) => (isRecord(item) ? optionalString(item.id) : undefined)),
  };
}

function providerPacksMagnitude(document: ProjectRevisionContentDocument): SectionMagnitude {
  const packs = document.providerPacks;
  return {
    count: Array.isArray(packs) ? packs.length : 0,
    ids: collectSectionIds(packs, (pack) => (isRecord(pack) ? optionalString(pack.id) : undefined)),
  };
}

function usageEntriesMagnitude(document: ProjectRevisionContentDocument): SectionMagnitude {
  const entries = document.usageLedger?.entries;
  return { count: Array.isArray(entries) ? entries.length : 0, ids: [] };
}

const SECTION_MAGNITUDES: ReadonlyArray<{
  section: string;
  measure: (document: ProjectRevisionContentDocument) => SectionMagnitude;
}> = [
  { section: 'flow.nodes', measure: flowNodesMagnitude },
  { section: 'flow.edges', measure: flowEdgesMagnitude },
  { section: 'flow.workspaces', measure: flowWorkspacesMagnitude },
  { section: 'image.documents', measure: imageDocumentsMagnitude },
  { section: 'image.layers', measure: imageLayersMagnitude },
  { section: 'paper.documents', measure: paperDocumentsMagnitude },
  { section: 'sourceBin.items', measure: sourceBinItemsMagnitude },
  { section: 'providerPacks', measure: providerPacksMagnitude },
  { section: 'usageLedger.entries', measure: usageEntriesMagnitude },
];

/**
 * Deterministic change summary between two content-only documents. The same inputs always produce
 * a structurally identical summary: sections are measured in a fixed order, magnitudes are counts,
 * and identity diffs are set differences (order-independent).
 */
export function buildProjectRevisionChangeSummary(
  before: ProjectRevisionContentDocument | undefined,
  after: ProjectRevisionContentDocument,
): ProjectRevisionChangeSummary {
  const nameChanged = before !== undefined && before.name !== after.name;
  const afterMagnitudes = new Map(SECTION_MAGNITUDES.map((entry) => [entry.section, entry.measure(after)]));
  const beforeMagnitudes = new Map(
    SECTION_MAGNITUDES.map((entry) => [entry.section, before ? entry.measure(before) : { count: 0, ids: [] as string[] }]),
  );

  const sections = SECTION_MAGNITUDES.map(({ section }) => {
    const beforeMagnitude = beforeMagnitudes.get(section) ?? { count: 0, ids: [] as string[] };
    const afterMagnitude = afterMagnitudes.get(section) ?? { count: 0, ids: [] as string[] };
    const beforeIds = new Set(beforeMagnitude.ids);
    const afterIds = new Set(afterMagnitude.ids);
    let added = 0;
    for (const id of afterMagnitude.ids) {
      if (!beforeIds.has(id)) added += 1;
    }
    let removed = 0;
    for (const id of beforeMagnitude.ids) {
      if (!afterIds.has(id)) removed += 1;
    }
    return {
      section,
      before: beforeMagnitude.count,
      after: afterMagnitude.count,
      added,
      removed,
    };
  });

  return {
    version: 1,
    initial: before === undefined,
    ...(nameChanged ? { name: { from: before?.name ?? '', to: after.name } } : {}),
    sections,
  };
}

/** Human-readable deterministic lines describing a revision summary. */
export function describeProjectRevisionChangeSummary(summary: ProjectRevisionChangeSummary): string[] {
  const lines: string[] = [];
  if (summary.initial) {
    lines.push('Initial captured state.');
  }
  if (summary.name) {
    lines.push(`Project name: "${summary.name.from}" → "${summary.name.to}".`);
  }
  for (const entry of summary.sections) {
    const unchanged = entry.before === entry.after && entry.added === 0 && entry.removed === 0;
    if (unchanged) continue;
    const deltas: string[] = [];
    if (entry.after !== entry.before) deltas.push(`${entry.before} → ${entry.after}`);
    if (entry.added > 0) deltas.push(`+${entry.added}`);
    if (entry.removed > 0) deltas.push(`−${entry.removed}`);
    lines.push(`${entry.section}: ${deltas.join(' ')}`);
  }
  if (lines.length === 0) {
    lines.push('No structural changes detected.');
  }
  return lines;
}

function nextRevisionName(records: readonly ProjectRevisionRecord[], kind: ProjectRevisionKind): string {
  const prefix = kind === 'save' ? 'Auto save' : 'Snapshot';
  return `${prefix} ${records.length + 1}`;
}

function tryParseRevisionPayload(payload: string): ProjectRevisionContentDocument | undefined {
  try {
    return JSON.parse(payload) as ProjectRevisionContentDocument;
  } catch {
    return undefined;
  }
}

function buildRevisionRecord(options: {
  kind: ProjectRevisionKind;
  name: string;
  payload: string;
  previousRecords: readonly ProjectRevisionRecord[];
  now: number;
}): ProjectRevisionRecord {
  const { kind, name, payload, previousRecords, now } = options;
  const last = previousRecords[previousRecords.length - 1];
  // A previous record whose payload no longer parses (only possible for foreign/corrupt files —
  // sanitize does not deep-parse payloads) degrades to a baseline summary instead of failing the
  // save; restoring that specific record still fails closed with a typed error later.
  const previousContent = last ? tryParseRevisionPayload(last.payload) : undefined;
  const content = JSON.parse(payload) as ProjectRevisionContentDocument;
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
  return {
    id: `project-rev-${now}-${random}`,
    kind,
    name,
    createdAt: now,
    summary: buildProjectRevisionChangeSummary(previousContent, content),
    payload,
    payloadChars: payload.length,
  };
}

/**
 * Append a revision under the deterministic caps: while the list is over the record cap or the
 * aggregate payload budget, evict the oldest automatic revision first, then the oldest manual
 * revision. The most recently appended record is never evicted by its own append.
 */
export function appendProjectRevisionRecord(
  records: readonly ProjectRevisionRecord[],
  record: ProjectRevisionRecord,
): ProjectRevisionRecord[] {
  const appended = [...records, record];
  const totalWithinBudget = (list: readonly ProjectRevisionRecord[]): boolean =>
    list.length <= PROJECT_HISTORY_MAX_REVISIONS
    && projectHistoryTotalPayloadChars(list) <= PROJECT_HISTORY_MAX_TOTAL_PAYLOAD_CHARS;

  let next = appended;
  while (next.length > 1 && !totalWithinBudget(next)) {
    const oldestAutoIndex = next.findIndex((entry) => entry.kind === 'save');
    const evictIndex = oldestAutoIndex >= 0
      ? oldestAutoIndex
      : next.findIndex((entry) => entry.id !== record.id);
    if (evictIndex < 0) break;
    next = next.filter((_, index) => index !== evictIndex);
  }
  return next;
}

function buildSection(
  records: readonly ProjectRevisionRecord[],
  branchedFrom: ProjectHistoryBranchProvenance | undefined,
): ProjectHistorySection {
  return {
    version: PROJECT_HISTORY_SECTION_VERSION,
    revisions: [...records],
    ...(branchedFrom ? { branchedFrom } : {}),
  };
}

/**
 * Stage the automatic revision capture for a save: pure with respect to the passed document. When
 * the content is byte-identical to the last revision the capture is skipped (`unchanged`); when
 * the serialized content exceeds the per-revision payload budget the capture is skipped
 * (`payload-too-large`). The returned document always carries the section the save should persist.
 */
export function stageProjectSaveRevision(
  document: FlowProjectDocument,
  options: { now?: number } = {},
): StagedProjectRevision {
  const now = options.now ?? Date.now();
  const records = document.projectHistory?.revisions ?? [];
  const content = buildProjectRevisionContent(document);
  const payload = serializeProjectRevisionPayload(content);

  if (payload.length > PROJECT_HISTORY_MAX_PAYLOAD_CHARS) {
    return { document, revision: null, skippedReason: 'payload-too-large' };
  }
  const last = records[records.length - 1];
  if (last && last.payload === payload) {
    return { document, revision: null, skippedReason: 'unchanged' };
  }

  const record = buildRevisionRecord({
    kind: 'save',
    name: nextRevisionName(records, 'save'),
    payload,
    previousRecords: records,
    now,
  });
  const revisions = appendProjectRevisionRecord(records, record);
  return {
    document: {
      ...document,
      projectHistory: buildSection(revisions, document.projectHistory?.branchedFrom),
    },
    revision: record,
  };
}

/**
 * Stage a manual named snapshot. Unlike automatic capture, exceeding the per-revision payload
 * budget is a typed failure (the user asked for durability explicitly), not a silent skip.
 */
export function stageProjectManualSnapshot(
  document: FlowProjectDocument,
  name: string,
  options: { now?: number } = {},
): StagedProjectRevision {
  const now = options.now ?? Date.now();
  const records = document.projectHistory?.revisions ?? [];
  const content = buildProjectRevisionContent(document);
  const payload = serializeProjectRevisionPayload(content);

  if (payload.length > PROJECT_HISTORY_MAX_PAYLOAD_CHARS) {
    throw new ProjectHistoryLimitError(
      'payload',
      `This project is too large for a version-history snapshot (over ${Math.floor(PROJECT_HISTORY_MAX_PAYLOAD_CHARS / (1024 * 1024))} MiB after serialization).`,
    );
  }

  const record = buildRevisionRecord({
    kind: 'manual',
    name: compactProjectRevisionName(name, nextRevisionName(records, 'manual')),
    payload,
    previousRecords: records,
    now,
  });
  const revisions = appendProjectRevisionRecord(records, record);
  return {
    document: {
      ...document,
      projectHistory: buildSection(revisions, document.projectHistory?.branchedFrom),
    },
    revision: record,
  };
}

/** Rename a revision in place; `renamedAt` records the explicit user action. */
export function renameProjectRevisionRecord(
  records: readonly ProjectRevisionRecord[],
  revisionId: string,
  name: string,
  now: number = Date.now(),
): ProjectRevisionRecord[] | null {
  const compacted = compactProjectRevisionName(name, 'Snapshot');
  let renamed = false;
  const next = records.map((record) => {
    if (record.id !== revisionId) return record;
    renamed = true;
    return { ...record, name: compacted, renamedAt: now };
  });
  return renamed ? next : null;
}

/** Delete one revision by id. Returns null when the id is unknown. */
export function deleteProjectRevisionRecord(
  records: readonly ProjectRevisionRecord[],
  revisionId: string,
): ProjectRevisionRecord[] | null {
  if (!records.some((record) => record.id === revisionId)) return null;
  return records.filter((record) => record.id !== revisionId);
}

export interface SanitizedProjectHistorySection {
  section: ProjectHistorySection | undefined;
  /** Records dropped because they were corrupt, over budget, or beyond the retention caps. */
  droppedCount: number;
}

function sanitizeChangeSummary(value: unknown): ProjectRevisionChangeSummary | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.initial !== 'boolean') return null;
  const sections = Array.isArray(value.sections)
    ? value.sections.flatMap((entry): ProjectRevisionChangeSummaryEntry[] => {
      if (!isRecord(entry)) return [];
      if (typeof entry.section !== 'string') return [];
      if (typeof entry.before !== 'number' || !Number.isFinite(entry.before)) return [];
      if (typeof entry.after !== 'number' || !Number.isFinite(entry.after)) return [];
      const added = typeof entry.added === 'number' && Number.isFinite(entry.added) ? entry.added : 0;
      const removed = typeof entry.removed === 'number' && Number.isFinite(entry.removed) ? entry.removed : 0;
      return [{
        section: entry.section,
        before: entry.before,
        after: entry.after,
        added,
        removed,
      }];
    })
    : [];
  const name = isRecord(value.name)
    && typeof value.name.from === 'string'
    && typeof value.name.to === 'string'
    ? { from: value.name.from, to: value.name.to }
    : undefined;
  return { version: 1, initial: value.initial, ...(name ? { name } : {}), sections };
}

function sanitizeRevisionRecord(value: unknown): ProjectRevisionRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (value.kind !== 'save' && value.kind !== 'manual') return null;
  if (typeof value.payload !== 'string' || value.payload.length === 0) return null;
  if (value.payload.length > PROJECT_HISTORY_MAX_PAYLOAD_CHARS) return null;
  const summary = sanitizeChangeSummary(value.summary);
  if (!summary) return null;
  const renamedAt = typeof value.renamedAt === 'number' && Number.isFinite(value.renamedAt)
    ? value.renamedAt
    : undefined;
  return {
    id: value.id,
    kind: value.kind,
    name: compactProjectRevisionName(typeof value.name === 'string' ? value.name : '', value.kind === 'save' ? 'Auto save' : 'Snapshot'),
    createdAt: finiteNumberOr(value.createdAt, Date.now()),
    summary,
    payload: value.payload,
    payloadChars: value.payload.length,
    ...(renamedAt !== undefined ? { renamedAt } : {}),
  };
}

/**
 * Bound and validate a loaded history section. Payloads are deliberately NOT parsed here (full
 * documents are sanitized at restore time); only shape, per-record, count, and aggregate byte
 * budgets are enforced, so a hostile or corrupt section can never make project open expensive.
 */
export function sanitizeProjectHistorySection(input: unknown): SanitizedProjectHistorySection {
  if (!isRecord(input)) return { section: undefined, droppedCount: 0 };
  if (input.version !== PROJECT_HISTORY_SECTION_VERSION) return { section: undefined, droppedCount: 0 };

  const rawRevisions = Array.isArray(input.revisions) ? input.revisions : [];
  const sanitized: ProjectRevisionRecord[] = [];
  let droppedCount = 0;
  for (const value of rawRevisions) {
    const record = sanitizeRevisionRecord(value);
    if (record) {
      sanitized.push(record);
    } else {
      droppedCount += 1;
    }
  }

  // Retention: keep the newest records within the count and aggregate byte budgets.
  const retained: ProjectRevisionRecord[] = [];
  let totalChars = 0;
  for (const record of [...sanitized].reverse()) {
    const nextTotal = totalChars + record.payloadChars;
    if (retained.length >= PROJECT_HISTORY_MAX_REVISIONS || nextTotal > PROJECT_HISTORY_MAX_TOTAL_PAYLOAD_CHARS) {
      droppedCount += 1;
      continue;
    }
    totalChars = nextTotal;
    retained.unshift(record);
  }

  if (retained.length === 0) return { section: undefined, droppedCount };
  return { section: buildSection(retained, sanitizeBranchProvenance(input.branchedFrom)), droppedCount };
}

function sanitizeBranchProvenance(value: unknown): ProjectHistoryBranchProvenance | undefined {
  if (!isRecord(value)) return undefined;
  const projectId = optionalString(value.projectId);
  const revisionId = optionalString(value.revisionId);
  if (!projectId || !revisionId) return undefined;
  return {
    projectId,
    projectName: optionalString(value.projectName) ?? '',
    revisionId,
    revisionName: optionalString(value.revisionName) ?? '',
    branchedAt: finiteNumberOr(value.branchedAt, Date.now()),
  };
}
