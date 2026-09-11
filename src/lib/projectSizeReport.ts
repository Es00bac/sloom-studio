/**
 * Bounded, credential-free accounting for the payload that makes project files grow.
 * This deliberately measures the serialized document and media values, not process memory or
 * filesystem scratch usage. It is safe to run on saved project summaries and remains useful when
 * a project contains legacy embedded values that the save normalizer can externalize next.
 */
export interface ProjectSizeReport {
  documentBytes: number;
  embeddedMediaCount: number;
  embeddedMediaBytes: number;
  embeddedMediaJsonBytes: number;
  externalReferenceCount: number;
  externalReferenceJsonBytes: number;
  truncated: boolean;
}

const MAX_SCANNED_VALUES = 250_000;
const MAX_SCANNED_STRING_BYTES = 128 * 1024 * 1024;

export function measureProjectSize(document: unknown): ProjectSizeReport {
  let documentBytes = 0;
  try {
    documentBytes = new TextEncoder().encode(JSON.stringify(document)).byteLength;
  } catch {
    return emptyProjectSizeReport(true);
  }

  const report = emptyProjectSizeReport(false);
  const pending: unknown[] = [document];
  const seen = new WeakSet<object>();
  let scannedValues = 0;
  let scannedStringBytes = 0;

  while (pending.length > 0) {
    const value = pending.pop();
    scannedValues += 1;
    if (scannedValues > MAX_SCANNED_VALUES || scannedStringBytes > MAX_SCANNED_STRING_BYTES) {
      report.truncated = true;
      break;
    }

    if (typeof value === 'string') {
      const stringBytes = new TextEncoder().encode(value).byteLength;
      scannedStringBytes += stringBytes;
      if (isEmbeddedMediaValue(value)) {
        report.embeddedMediaCount += 1;
        report.embeddedMediaBytes += estimateEmbeddedMediaBytes(value);
        report.embeddedMediaJsonBytes += stringBytes;
      } else if (isExternalMediaReference(value)) {
        report.externalReferenceCount += 1;
        report.externalReferenceJsonBytes += stringBytes;
      }
      continue;
    }

    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        // Do not spread a saved project's children into push: a large, otherwise valid
        // node/edge array can exceed the engine's argument limit before our scan cap applies.
        // Reverse indexed insertion preserves the previous depth-first order without creating
        // another values array or invoking a user-defined iterator.
        for (let index = value.length - 1; index >= 0; index -= 1) {
          pending.push(value[index]);
        }
      } else {
        const keys = Object.keys(value);
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          pending.push((value as Record<string, unknown>)[keys[index]!]);
        }
      }
    } catch {
      // A malformed getter/proxy must not make a library listing fail. Keep any accounting
      // already completed and make the partial result explicit to callers.
      report.truncated = true;
      continue;
    }
  }

  return { ...report, documentBytes };
}

export function compareProjectSizeReports(
  before: ProjectSizeReport,
  after: ProjectSizeReport,
): { documentBytesSaved: number; embeddedJsonBytesSaved: number; reductionPercent: number | null } {
  const documentBytesSaved = Math.max(0, before.documentBytes - after.documentBytes);
  const embeddedJsonBytesSaved = Math.max(0, before.embeddedMediaJsonBytes - after.embeddedMediaJsonBytes);
  return {
    documentBytesSaved,
    embeddedJsonBytesSaved,
    reductionPercent: before.documentBytes > 0
      ? Math.max(0, Math.min(100, (documentBytesSaved / before.documentBytes) * 100))
      : null,
  };
}

export function formatProjectBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function emptyProjectSizeReport(truncated: boolean): ProjectSizeReport {
  return {
    documentBytes: 0,
    embeddedMediaCount: 0,
    embeddedMediaBytes: 0,
    embeddedMediaJsonBytes: 0,
    externalReferenceCount: 0,
    externalReferenceJsonBytes: 0,
    truncated,
  };
}

function isEmbeddedMediaValue(value: string): boolean {
  return /^data:[^;,]+(?:;[^,]*)?,/i.test(value);
}

function isExternalMediaReference(value: string): boolean {
  return value.startsWith('signal-loom-asset://');
}

function estimateEmbeddedMediaBytes(value: string): number {
  const comma = value.indexOf(',');
  if (comma < 0) return 0;
  const payload = value.slice(comma + 1).replace(/\s+/g, '');
  if (/;base64/i.test(value.slice(0, comma))) {
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  } catch {
    return new TextEncoder().encode(payload).byteLength;
  }
}
