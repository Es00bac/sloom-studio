import type { PaperQuarantinedDocumentRecovery, PaperSnapshotRecovery } from '../types/paper';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Validates persisted recovery diagnostics; returns undefined when nothing usable remains. */
export function sanitizePaperSnapshotRecovery(value: unknown): PaperSnapshotRecovery | undefined {
  if (!isRecord(value)) return undefined;

  const quarantinedDocuments: PaperQuarantinedDocumentRecovery[] = Array.isArray(value.quarantinedDocuments)
    ? value.quarantinedDocuments.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const reason = optionalNonEmptyString(entry.reason);
      if (!reason) return [];
      const id = optionalNonEmptyString(entry.id);
      const title = optionalNonEmptyString(entry.title);
      const detail = optionalNonEmptyString(entry.detail);
      const payloadJson = optionalNonEmptyString(entry.payloadJson);
      return [{
        index: typeof entry.index === 'number' && Number.isInteger(entry.index) && entry.index >= 0 ? entry.index : 0,
        ...(id ? { id } : {}),
        ...(title ? { title } : {}),
        reason,
        ...(detail ? { detail } : {}),
        ...(payloadJson ? { payloadJson } : {}),
      }];
    })
    : [];
  const repairs = Array.isArray(value.repairs)
    ? value.repairs.filter((repair): repair is string => typeof repair === 'string' && repair.trim().length > 0)
    : [];

  if (quarantinedDocuments.length === 0 && repairs.length === 0) return undefined;
  return { quarantinedDocuments, repairs };
}

/**
 * Combines recovery carried from an earlier save with the current pass's findings so quarantined
 * payloads survive resaves. Deduplicated so revalidating the same snapshot cannot grow the record.
 */
export function mergePaperSnapshotRecovery(
  prior: PaperSnapshotRecovery | undefined,
  next: PaperSnapshotRecovery | undefined,
): PaperSnapshotRecovery | undefined {
  if (!prior) return next;
  if (!next) return prior;

  const quarantinedDocuments: PaperQuarantinedDocumentRecovery[] = [];
  const seenQuarantined = new Set<string>();
  for (const entry of [...prior.quarantinedDocuments, ...next.quarantinedDocuments]) {
    const key = JSON.stringify([entry.id ?? '', entry.index, entry.reason, entry.payloadJson ?? '']);
    if (seenQuarantined.has(key)) continue;
    seenQuarantined.add(key);
    quarantinedDocuments.push(entry);
  }
  const repairs = [...new Set([...prior.repairs, ...next.repairs])];

  if (quarantinedDocuments.length === 0 && repairs.length === 0) return undefined;
  return { quarantinedDocuments, repairs };
}
