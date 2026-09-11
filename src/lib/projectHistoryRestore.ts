import type { FlowProjectDocument } from './projectLibrary';
import { sanitizeProjectDocument } from './projectValidation';
import {
  compactProjectRevisionName,
  type ProjectHistoryBranchProvenance,
  type ProjectRevisionRecord,
} from './projectHistory';

/**
 * Corrupt or interrupted revision payloads fail closed: the typed error is raised before any
 * workspace state is touched, so a failed restore or branch never leaves a half-replaced project.
 */
export class ProjectRevisionPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectRevisionPayloadError';
  }
}

export function parseProjectRevisionPayload(record: ProjectRevisionRecord): FlowProjectDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.payload);
  } catch {
    throw new ProjectRevisionPayloadError(
      `Revision "${record.name}" cannot be restored: its stored project snapshot is corrupt.`,
    );
  }
  try {
    return sanitizeProjectDocument(parsed, record.name);
  } catch (error) {
    throw new ProjectRevisionPayloadError(
      `Revision "${record.name}" cannot be restored: ${error instanceof Error ? error.message : 'its stored project snapshot is invalid.'}`,
    );
  }
}

/**
 * Build the document that restores a revision in place. The restoring project keeps its identity
 * (`id`) and its version-history section; every content section reverts to the revision payload.
 */
export function buildProjectRevisionRestoreDocument(
  currentDocument: FlowProjectDocument,
  record: ProjectRevisionRecord,
): FlowProjectDocument {
  const restored = parseProjectRevisionPayload(record);
  return {
    ...restored,
    id: currentDocument.id,
    projectHistory: currentDocument.projectHistory,
  };
}

/**
 * Build a NEW project document branched from a revision. The source project is never referenced
 * as the same identity: the branch receives a fresh id, a derived name, and an empty history
 * section carrying explicit provenance about the revision it came from.
 */
export function buildProjectRevisionBranchDocument(
  currentDocument: FlowProjectDocument,
  record: ProjectRevisionRecord,
  options: { now?: number } = {},
): FlowProjectDocument {
  const now = options.now ?? Date.now();
  const branched = parseProjectRevisionPayload(record);
  const branchedFrom: ProjectHistoryBranchProvenance = {
    projectId: currentDocument.id,
    projectName: currentDocument.name,
    revisionId: record.id,
    revisionName: record.name,
    branchedAt: now,
  };
  return {
    ...branched,
    id: globalThis.crypto?.randomUUID?.() ?? `project-${now}`,
    name: compactProjectRevisionName(
      `${currentDocument.name} — ${record.name}`,
      `${currentDocument.name} branch`,
    ),
    savedAt: now,
    projectHistory: {
      version: 1,
      revisions: [],
      branchedFrom,
    },
  };
}
