export const CRASH_REPORT_QUEUE_LIMIT = 50;
export const CRASH_REPORT_MESSAGE_MAX_LENGTH = 512;
export const CRASH_REPORT_STACK_MAX_LENGTH = 8192;
export const CRASH_REPORT_COMPONENT_STACK_MAX_LENGTH = 4096;
export const CRASH_REPORT_SURFACE_MAX_LENGTH = 96;
export const CRASH_REPORT_DETAIL_MAX_LENGTH = 256;
export const CRASH_REPORT_ID_MAX_LENGTH = 96;
export const CRASH_REPORT_REDACTION = '[redacted]';

export type CrashReportKind =
  | 'renderer-render'
  | 'renderer-unhandled-error'
  | 'renderer-unhandled-rejection'
  | 'renderer-process-gone'
  | 'child-process-gone'
  | 'main-uncaught-exception'
  | 'main-unhandled-rejection';

const VALID_KINDS = new Set<CrashReportKind>([
  'renderer-render',
  'renderer-unhandled-error',
  'renderer-unhandled-rejection',
  'renderer-process-gone',
  'child-process-gone',
  'main-uncaught-exception',
  'main-unhandled-rejection',
]);

export interface CrashReportRecord {
  id: string;
  timestamp: number;
  kind: CrashReportKind;
  message: string;
  surface?: string;
  stack?: string;
  componentStack?: string;
  detail?: string;
  appVersion?: string;
  platform?: string;
  occurrenceCount?: number;
  firstSeenAt?: number;
}

export type CrashReportInput = Omit<CrashReportRecord, 'id' | 'timestamp' | 'message'> & {
  id?: string;
  timestamp?: number;
  message: unknown;
};

export interface CrashReportExportMetadata {
  exportedAt: number;
  reportCount: number;
  captureEnabled?: boolean;
  appVersion?: string;
}

export function isCrashReportKind(value: unknown): value is CrashReportKind {
  return typeof value === 'string' && VALID_KINDS.has(value as CrashReportKind);
}

export function createCrashReport(input: CrashReportInput): CrashReportRecord {
  const kind = isCrashReportKind(input.kind) ? input.kind : 'renderer-unhandled-error';
  const message = redactCrashReportText(crashReportText(input.message, CRASH_REPORT_MESSAGE_MAX_LENGTH))
    || 'No crash message available';
  const surface = boundText(input.surface ? redactCrashReportText(input.surface) : undefined, CRASH_REPORT_SURFACE_MAX_LENGTH);
  const stack = boundMultilineText(
    typeof input.stack === 'string' ? redactCrashReportText(input.stack) : undefined,
    CRASH_REPORT_STACK_MAX_LENGTH,
  );
  const componentStack = boundMultilineText(
    typeof input.componentStack === 'string' ? redactCrashReportText(input.componentStack) : undefined,
    CRASH_REPORT_COMPONENT_STACK_MAX_LENGTH,
  );
  const detail = boundText(input.detail ? redactCrashReportText(input.detail) : undefined, CRASH_REPORT_DETAIL_MAX_LENGTH);

  return {
    id: boundText(input.id, CRASH_REPORT_ID_MAX_LENGTH) ?? createCrashReportId(),
    timestamp: isFiniteTimestamp(input.timestamp) ? input.timestamp : Date.now(),
    kind,
    message,
    ...(surface ? { surface } : {}),
    ...(stack ? { stack } : {}),
    ...(componentStack ? { componentStack } : {}),
    ...(detail ? { detail } : {}),
    ...(input.occurrenceCount && Number.isFinite(input.occurrenceCount) && input.occurrenceCount > 1
      ? { occurrenceCount: Math.floor(input.occurrenceCount) }
      : {}),
    ...(isFiniteTimestamp(input.firstSeenAt) ? { firstSeenAt: input.firstSeenAt } : {}),
    ...(boundText(input.appVersion, 64) ? { appVersion: boundText(input.appVersion, 64)! } : {}),
    ...(boundText(input.platform, 64) ? { platform: boundText(input.platform, 64)! } : {}),
  };
}

export function crashReportFingerprint(report: Pick<CrashReportRecord, 'kind' | 'message'>): string {
  return `${report.kind}\n${report.message}`;
}

export function appendCrashReport(
  reports: readonly CrashReportRecord[],
  report: CrashReportRecord,
  limit: number = CRASH_REPORT_QUEUE_LIMIT,
): CrashReportRecord[] {
  const fingerprint = crashReportFingerprint(report);
  const existingIndex = reports.findIndex(
    (candidate) => crashReportFingerprint(candidate) === fingerprint,
  );

  if (existingIndex >= 0) {
    const existing = reports[existingIndex];
    const merged: CrashReportRecord = {
      ...report,
      timestamp: Math.max(existing.timestamp, report.timestamp),
      occurrenceCount: Math.min(
        1000,
        (existing.occurrenceCount ?? 1) + (report.occurrenceCount ?? 1),
      ),
      firstSeenAt: existing.firstSeenAt ?? existing.timestamp,
      ...(existing.stack && !report.stack ? { stack: existing.stack } : {}),
      ...(existing.componentStack && !report.componentStack
        ? { componentStack: existing.componentStack }
        : {}),
    };
    return [
      merged,
      ...reports.slice(0, existingIndex),
      ...reports.slice(existingIndex + 1),
    ].slice(0, Math.max(1, limit));
  }

  return [report, ...reports].slice(0, Math.max(1, limit));
}

export function mergeCrashReports(
  current: readonly CrashReportRecord[],
  incoming: readonly CrashReportRecord[],
  limit: number = CRASH_REPORT_QUEUE_LIMIT,
): CrashReportRecord[] {
  const seenIds = new Set<string>();
  const seenFingerprints = new Set<string>();
  const merged: CrashReportRecord[] = [];
  const candidates = [...incoming, ...current];

  for (const candidate of candidates) {
    if (seenIds.has(candidate.id)) continue;
    const fingerprint = crashReportFingerprint(candidate);
    if (seenFingerprints.has(fingerprint)) {
      const target = merged.find((item) => crashReportFingerprint(item) === fingerprint);
      if (target) {
        target.timestamp = Math.max(target.timestamp, candidate.timestamp);
        target.occurrenceCount = Math.min(
          1000,
          (target.occurrenceCount ?? 1) + (candidate.occurrenceCount ?? 1) - 1,
        );
        target.firstSeenAt = target.firstSeenAt
          ? Math.min(target.firstSeenAt, candidate.firstSeenAt ?? candidate.timestamp)
          : (candidate.firstSeenAt ?? candidate.timestamp);
      }
      seenIds.add(candidate.id);
      continue;
    }
    seenIds.add(candidate.id);
    seenFingerprints.add(fingerprint);
    merged.push({ ...candidate });
    if (merged.length >= Math.max(1, limit)) break;
  }

  return merged;
}

export function sanitizeCrashReportQueue(value: unknown, limit: number = CRASH_REPORT_QUEUE_LIMIT): CrashReportRecord[] {
  if (!Array.isArray(value)) return [];
  const sanitized = value.flatMap((candidate) => {
    const record = sanitizeCrashReportRecord(candidate);
    return record ? [record] : [];
  });
  return mergeCrashReports([], sanitized, limit);
}

export function sanitizeCrashReportRecord(value: unknown): CrashReportRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (!isCrashReportKind(value.kind)) return undefined;
  if (!isFiniteTimestamp(value.timestamp)) return undefined;

  const id = boundText(value.id, CRASH_REPORT_ID_MAX_LENGTH);
  const message = redactCrashReportText(
    crashReportText(value.message, CRASH_REPORT_MESSAGE_MAX_LENGTH),
  );
  if (!id || !message) return undefined;

  return createCrashReport({
    id,
    timestamp: value.timestamp,
    kind: value.kind,
    message,
    surface: typeof value.surface === 'string' ? value.surface : undefined,
    stack: typeof value.stack === 'string' ? value.stack : undefined,
    componentStack: typeof value.componentStack === 'string' ? value.componentStack : undefined,
    detail: typeof value.detail === 'string' ? value.detail : undefined,
    appVersion: typeof value.appVersion === 'string' ? value.appVersion : undefined,
    platform: typeof value.platform === 'string' ? value.platform : undefined,
    occurrenceCount: typeof value.occurrenceCount === 'number' ? value.occurrenceCount : undefined,
    firstSeenAt: isFiniteTimestamp(value.firstSeenAt) ? value.firstSeenAt : undefined,
  });
}

export function redactCrashReportText(raw: string): string {
  let text = raw;

  text = text
    .replace(/signal-loom-asset:[^\s<>"']+/gi, '[local asset reference]')
    .replace(/data:[^\s<>"']+/gi, '[data URL]')
    .replace(/blob:[^\s<>"']+/gi, '[local blob URL]');

  text = text.replace(/(https?:\/\/)([^\s@/"']+)@([^\s/<>"']*)/gi, `$1${CRASH_REPORT_REDACTION}@`);

  text = text.replace(/(https?:\/\/[^\s<>"'?]+)/g, (url) => redactUrlSecretQueryValues(url));

  text = redactAuthorizationCredentials(text);

  text = redactSecretAssignments(text);

  text = text.replace(/\b(?:sk|pk|rk|eyJ)[A-Za-z0-9._-]{16,}\b/g, CRASH_REPORT_REDACTION);

  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, CRASH_REPORT_REDACTION);

  text = text.replace(/\b[A-Za-z0-9_-]{40,}\b/g, CRASH_REPORT_REDACTION);

  text = text
    .replace(/(\/home\/)[^\s/"']+/g, '$1[redacted]')
    .replace(/(\/Users\/)[^\s/"']+/g, '$1[redacted]')
    .replace(/([CcDd]:\\Users\\)[^\s\\"']+/g, '$1[redacted]');

  return text;
}

export function formatCrashReportsExportText(
  reports: readonly CrashReportRecord[],
  metadata: CrashReportExportMetadata,
): string {
  const payload = {
    type: 'sloom-studio-crash-reports',
    schemaVersion: 1,
    exportedAt: metadata.exportedAt,
    reportCount: metadata.reportCount,
    ...(metadata.captureEnabled === undefined ? {} : { captureEnabled: metadata.captureEnabled }),
    ...(metadata.appVersion ? { appVersion: metadata.appVersion } : {}),
    notice:
      'Local crash reports exported from Sloom Studio. Secrets and credentials are structurally redacted. No data was transmitted.',
    reports: reports.map(formatCrashReportForExport),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function formatCrashReportForExport(report: CrashReportRecord): CrashReportRecord {
  return sanitizeCrashReportRecord(report) ?? {
    id: 'invalid',
    timestamp: Date.now(),
    kind: 'renderer-unhandled-error',
    message: '[unavailable report removed by validation]',
  };
}

function redactUrlSecretQueryValues(url: string): string {
  return url.replace(/([?&])([^\s<>"'&=]*)(=)([^\s<>"'&]*)/g, (pair, prefix: string, key: string, equals: string) => {
    if (isSecretNamed(key)) return `${prefix}${key}${equals}${CRASH_REPORT_REDACTION}`;
    return pair;
  });
}

function isSecretNamed(key: string): boolean {
  return /key|token|secret|password|signature|credential|auth/i.test(key);
}

interface QuoteFrame {
  start: number;
  end: number;
  quote: '"' | "'";
  slashCount: number;
}

interface TextReplacement {
  start: number;
  end: number;
  value: string;
}

const SECRET_ASSIGNMENT_NAME_PATTERN = /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|credential|password|pass[_-]?phrase|secret|signature|client[_-]?secret|token)\b/gi;

function redactSecretAssignments(value: string): string {
  const replacements: TextReplacement[] = [];
  let protectedUntil = 0;
  SECRET_ASSIGNMENT_NAME_PATTERN.lastIndex = 0;

  for (const match of value.matchAll(SECRET_ASSIGNMENT_NAME_PATTERN)) {
    const keyStart = match.index;
    const keyEnd = keyStart + match[0].length;
    if (keyStart < protectedUntil) continue;

    const openingKeyFrame = readQuoteFrameBefore(value, keyStart);
    const closingKeyFrame = openingKeyFrame
      ? readQuoteFrameAt(value, keyEnd, openingKeyFrame.quote, openingKeyFrame.slashCount)
      : undefined;
    const keyIsQuoted = Boolean(openingKeyFrame && closingKeyFrame);
    let cursor = closingKeyFrame?.end ?? keyEnd;
    cursor = skipHorizontalWhitespace(value, cursor);
    if (value[cursor] !== ':' && value[cursor] !== '=') continue;
    cursor = skipHorizontalWhitespace(value, cursor + 1);
    if (cursor >= value.length) continue;

    const valueFrame = readQuoteFrameAt(value, cursor);
    if (valueFrame) {
      const closingValueFrame = findClosingQuoteFrame(value, valueFrame);
      if (closingValueFrame) {
        replacements.push(keyIsQuoted
          ? { start: valueFrame.end, end: closingValueFrame.start, value: CRASH_REPORT_REDACTION }
          : { start: valueFrame.start, end: closingValueFrame.end, value: CRASH_REPORT_REDACTION });
        protectedUntil = closingValueFrame.end;
        continue;
      }

      const unterminatedEnd = findUnquotedValueEnd(value, valueFrame.end);
      replacements.push({
        start: keyIsQuoted ? valueFrame.end : valueFrame.start,
        end: unterminatedEnd,
        value: CRASH_REPORT_REDACTION,
      });
      protectedUntil = unterminatedEnd;
      continue;
    }

    const valueEnd = findUnquotedValueEnd(value, cursor, match[0]);
    if (valueEnd === cursor) continue;
    const quotedRedaction = keyIsQuoted && openingKeyFrame
      ? `${'\\'.repeat(openingKeyFrame.slashCount)}${openingKeyFrame.quote}${CRASH_REPORT_REDACTION}${'\\'.repeat(openingKeyFrame.slashCount)}${openingKeyFrame.quote}`
      : CRASH_REPORT_REDACTION;
    replacements.push({ start: cursor, end: valueEnd, value: quotedRedaction });
    protectedUntil = valueEnd;
  }

  if (replacements.length === 0) return value;
  let redacted = '';
  let cursor = 0;
  for (const replacement of replacements) {
    redacted += value.slice(cursor, replacement.start);
    redacted += replacement.value;
    cursor = replacement.end;
  }
  return redacted + value.slice(cursor);
}

function readQuoteFrameBefore(value: string, index: number): QuoteFrame | undefined {
  const quote = value[index - 1];
  if (quote !== '"' && quote !== "'") return undefined;
  let start = index - 1;
  while (start > 0 && value[start - 1] === '\\') start -= 1;
  return { start, end: index, quote, slashCount: index - 1 - start };
}

function readQuoteFrameAt(
  value: string,
  index: number,
  expectedQuote?: '"' | "'",
  expectedSlashCount?: number,
): QuoteFrame | undefined {
  let cursor = index;
  while (value[cursor] === '\\') cursor += 1;
  const quote = value[cursor];
  if (quote !== '"' && quote !== "'") return undefined;
  const slashCount = cursor - index;
  if (expectedQuote && quote !== expectedQuote) return undefined;
  if (expectedSlashCount !== undefined && slashCount !== expectedSlashCount) return undefined;
  return { start: index, end: cursor + 1, quote, slashCount };
}

function findClosingQuoteFrame(value: string, opening: QuoteFrame): QuoteFrame | undefined {
  for (let cursor = opening.end; cursor < value.length; cursor += 1) {
    if (value[cursor] !== opening.quote) continue;
    let slashStart = cursor;
    while (slashStart > opening.end && value[slashStart - 1] === '\\') slashStart -= 1;
    if (cursor - slashStart === opening.slashCount) {
      return { start: slashStart, end: cursor + 1, quote: opening.quote, slashCount: opening.slashCount };
    }
  }
  return undefined;
}

function skipHorizontalWhitespace(value: string, index: number): number {
  let cursor = index;
  while (value[cursor] === ' ' || value[cursor] === '\t') cursor += 1;
  return cursor;
}

function findUnquotedValueEnd(value: string, start: number, keyName = ''): number {
  let cursor = start;
  while (cursor < value.length && !/[\s,;&}]/.test(value[cursor] ?? '')) cursor += 1;

  if (/^auth(?:orization)?$/i.test(keyName)) {
    const scheme = value.slice(start, cursor);
    if (/^(?:basic|bearer)$/i.test(scheme)) {
      const payloadStart = skipHorizontalWhitespace(value, cursor);
      if (payloadStart > cursor) {
        cursor = payloadStart;
        while (cursor < value.length && !/[\s,;&}]/.test(value[cursor] ?? '')) cursor += 1;
      }
    }
  }

  return cursor;
}

function looksLikeDetachedCredential(scheme: string, payload: string): boolean {
  const candidate = payload.replace(/[)\].!?]+$/, '');
  if (scheme.toLowerCase() === 'basic') {
    return candidate.length >= 12
      && candidate.length % 4 === 0
      && /^[A-Za-z0-9+/]+={0,2}$/.test(candidate);
  }
  return candidate.length >= 8 && (
    /[0-9._~+/-]/.test(candidate)
    || (candidate.length >= 12 && /^[A-Za-z]+$/.test(candidate))
  );
}

function redactAuthorizationCredentials(value: string): string {
  const labeled = value.replace(
    /(\bauthorization\b[ \t]*[:=][ \t]*)(?:basic|bearer)\b[ \t]+[^\s,;]+/gi,
    `$1${CRASH_REPORT_REDACTION}`,
  );
  const boundaryRedacted = labeled.replace(
    /(^|[\r\n,;:.!?([={])([ \t]*)(basic|bearer)\b[ \t]+([^\s,;]+)/gim,
    (match, boundary: string, spacing: string, scheme: string, payload: string) =>
      looksLikeDetachedCredential(scheme, payload)
        ? `${boundary}${spacing}${CRASH_REPORT_REDACTION}`
        : match,
  );
  return boundaryRedacted.replace(
    /(^|\s)(basic|bearer)\b[ \t]+([^\s,;]+)/gim,
    (match, boundary: string, scheme: string, payload: string) =>
      looksLikeDetachedCredential(scheme, payload)
        ? `${boundary}${CRASH_REPORT_REDACTION}`
        : match,
  );
}

function crashReportText(value: unknown, maxLength: number): string {
  if (typeof value === 'string') return boundText(value, maxLength) ?? '';
  if (value instanceof Error) {
    return boundText(value.message || value.name, maxLength) ?? '';
  }
  if (isRecord(value)) {
    try {
      return boundText(safeJsonStringify(value), maxLength) ?? '';
    } catch {
      return '';
    }
  }
  if (typeof value !== 'undefined' && value !== null) {
    return boundText(String(value), maxLength) ?? '';
  }
  return '';
}

function safeJsonStringify(value: Record<string, unknown>): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) return '[circular]';
      seen.add(item);
    }
    return item;
  });
}

function boundText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function boundMultilineText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function createCrashReportId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `crash-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
