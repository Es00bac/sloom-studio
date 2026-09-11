'use strict';

const CRASH_REPORT_QUEUE_LIMIT = 50;
const CRASH_REPORT_MESSAGE_MAX_LENGTH = 512;
const CRASH_REPORT_STACK_MAX_LENGTH = 8192;
const CRASH_REPORT_COMPONENT_STACK_MAX_LENGTH = 4096;
const CRASH_REPORT_SURFACE_MAX_LENGTH = 96;
const CRASH_REPORT_DETAIL_MAX_LENGTH = 256;
const CRASH_REPORT_ID_MAX_LENGTH = 96;
const REDACTION = '[redacted]';

const VALID_KINDS = new Set([
  'renderer-render',
  'renderer-unhandled-error',
  'renderer-unhandled-rejection',
  'renderer-process-gone',
  'child-process-gone',
  'main-uncaught-exception',
  'main-unhandled-rejection',
]);

const RENDERER_MIRRORED_KINDS = new Set([
  'renderer-render',
  'renderer-unhandled-error',
  'renderer-unhandled-rejection',
]);

function isCrashReportKind(value) {
  return typeof value === 'string' && VALID_KINDS.has(value);
}

function redactText(raw) {
  let text = String(raw);

  text = text
    .replace(/signal-loom-asset:[^\s<>"']+/gi, '[local asset reference]')
    .replace(/data:[^\s<>"']+/gi, '[data URL]')
    .replace(/blob:[^\s<>"']+/gi, '[local blob URL]');

  text = text.replace(/(https?:\/\/)([^\s@/"']+)@([^\s/<>"']*)/gi, `$1${REDACTION}@`);

  text = text.replace(/(https?:\/\/[^\s<>"'?]+)/g, (url) => redactUrlSecretQueryValues(url));

  text = redactAuthorizationCredentials(text);

  text = redactSecretAssignments(text);

  text = text.replace(/\b(?:sk|pk|rk|eyJ)[A-Za-z0-9._-]{16,}\b/g, REDACTION);

  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTION);

  text = text.replace(/\b[A-Za-z0-9_-]{40,}\b/g, REDACTION);

  text = text
    .replace(/(\/home\/)[^\s/"']+/g, '$1[redacted]')
    .replace(/(\/Users\/)[^\s/"']+/g, '$1[redacted]')
    .replace(/([CcDd]:\\Users\\)[^\s\\"']+/g, '$1[redacted]');

  return text;
}

function redactUrlSecretQueryValues(url) {
  return url.replace(/([?&])([^\s<>"'&=]*)(=)([^\s<>"'&]*)/g, (pair, prefix, key, equals) => {
    if (isSecretNamed(key)) return `${prefix}${key}${equals}${REDACTION}`;
    return pair;
  });
}

function isSecretNamed(key) {
  return /key|token|secret|password|signature|credential|auth/i.test(key);
}

const SECRET_ASSIGNMENT_NAME_PATTERN = /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|credential|password|pass[_-]?phrase|secret|signature|client[_-]?secret|token)\b/gi;

function redactSecretAssignments(value) {
  const replacements = [];
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
          ? { start: valueFrame.end, end: closingValueFrame.start, value: REDACTION }
          : { start: valueFrame.start, end: closingValueFrame.end, value: REDACTION });
        protectedUntil = closingValueFrame.end;
        continue;
      }

      const unterminatedEnd = findUnquotedValueEnd(value, valueFrame.end);
      replacements.push({
        start: keyIsQuoted ? valueFrame.end : valueFrame.start,
        end: unterminatedEnd,
        value: REDACTION,
      });
      protectedUntil = unterminatedEnd;
      continue;
    }

    const valueEnd = findUnquotedValueEnd(value, cursor, match[0]);
    if (valueEnd === cursor) continue;
    const quotedRedaction = keyIsQuoted && openingKeyFrame
      ? `${'\\'.repeat(openingKeyFrame.slashCount)}${openingKeyFrame.quote}${REDACTION}${'\\'.repeat(openingKeyFrame.slashCount)}${openingKeyFrame.quote}`
      : REDACTION;
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

function readQuoteFrameBefore(value, index) {
  const quote = value[index - 1];
  if (quote !== '"' && quote !== "'") return undefined;
  let start = index - 1;
  while (start > 0 && value[start - 1] === '\\') start -= 1;
  return { start, end: index, quote, slashCount: index - 1 - start };
}

function readQuoteFrameAt(value, index, expectedQuote, expectedSlashCount) {
  let cursor = index;
  while (value[cursor] === '\\') cursor += 1;
  const quote = value[cursor];
  if (quote !== '"' && quote !== "'") return undefined;
  const slashCount = cursor - index;
  if (expectedQuote && quote !== expectedQuote) return undefined;
  if (expectedSlashCount !== undefined && slashCount !== expectedSlashCount) return undefined;
  return { start: index, end: cursor + 1, quote, slashCount };
}

function findClosingQuoteFrame(value, opening) {
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

function skipHorizontalWhitespace(value, index) {
  let cursor = index;
  while (value[cursor] === ' ' || value[cursor] === '\t') cursor += 1;
  return cursor;
}

function findUnquotedValueEnd(value, start, keyName = '') {
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

function looksLikeDetachedCredential(scheme, payload) {
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

function redactAuthorizationCredentials(value) {
  const labeled = value.replace(
    /(\bauthorization\b[ \t]*[:=][ \t]*)(?:basic|bearer)\b[ \t]+[^\s,;]+/gi,
    `$1${REDACTION}`,
  );
  const boundaryRedacted = labeled.replace(
    /(^|[\r\n,;:.!?([={])([ \t]*)(basic|bearer)\b[ \t]+([^\s,;]+)/gim,
    (match, boundary, spacing, scheme, payload) =>
      looksLikeDetachedCredential(scheme, payload)
        ? `${boundary}${spacing}${REDACTION}`
        : match,
  );
  return boundaryRedacted.replace(
    /(^|\s)(basic|bearer)\b[ \t]+([^\s,;]+)/gim,
    (match, boundary, scheme, payload) =>
      looksLikeDetachedCredential(scheme, payload)
        ? `${boundary}${REDACTION}`
        : match,
  );
}

function boundText(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function boundMultilineText(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isFiniteTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function createRecordId(now) {
  return `crash-${now}-${Math.random().toString(36).slice(2)}`;
}

function createCrashReportRecord(input, now) {
  const kind = isCrashReportKind(input.kind) ? input.kind : 'renderer-unhandled-error';
  const message = boundText(redactText(messageText(input.message)), CRASH_REPORT_MESSAGE_MAX_LENGTH)
    || 'No crash message available';
  const surface = boundText(redactText(String(input.surface ?? '')), CRASH_REPORT_SURFACE_MAX_LENGTH);
  const stack = boundMultilineText(redactText(String(input.stack ?? '')), CRASH_REPORT_STACK_MAX_LENGTH);
  const componentStack = boundMultilineText(
    redactText(String(input.componentStack ?? '')),
    CRASH_REPORT_COMPONENT_STACK_MAX_LENGTH,
  );
  const detail = boundText(redactText(String(input.detail ?? '')), CRASH_REPORT_DETAIL_MAX_LENGTH);

  return {
    id: boundText(String(input.id ?? ''), CRASH_REPORT_ID_MAX_LENGTH) || createRecordId(now),
    timestamp: isFiniteTimestamp(input.timestamp) ? input.timestamp : now,
    kind,
    message,
    ...(surface ? { surface } : {}),
    ...(stack ? { stack } : {}),
    ...(componentStack ? { componentStack } : {}),
    ...(detail ? { detail } : {}),
    ...(input.appVersion ? { appVersion: boundText(String(input.appVersion), 64) } : {}),
    ...(input.platform ? { platform: boundText(String(input.platform), 64) } : {}),
    ...(Number.isFinite(input.occurrenceCount) && input.occurrenceCount > 1
      ? { occurrenceCount: Math.floor(input.occurrenceCount) }
      : {}),
    ...(isFiniteTimestamp(input.firstSeenAt) ? { firstSeenAt: input.firstSeenAt } : {}),
  };
}

function messageText(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || value.name;
  if (isRecord(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable crash detail]';
    }
  }
  if (value === undefined || value === null) return '';
  return String(value);
}

function crashReportFingerprint(report) {
  return `${report.kind}\n${report.message}`;
}

function appendReport(reports, report, limit = CRASH_REPORT_QUEUE_LIMIT) {
  const fingerprint = crashReportFingerprint(report);
  const existingIndex = reports.findIndex((candidate) => crashReportFingerprint(candidate) === fingerprint);

  if (existingIndex >= 0) {
    const existing = reports[existingIndex];
    const merged = {
      ...report,
      timestamp: Math.max(existing.timestamp, report.timestamp),
      occurrenceCount: Math.min(1000, (existing.occurrenceCount || 1) + (report.occurrenceCount || 1)),
      firstSeenAt: existing.firstSeenAt || existing.timestamp,
      ...(existing.stack && !report.stack ? { stack: existing.stack } : {}),
      ...(existing.componentStack && !report.componentStack
        ? { componentStack: existing.componentStack }
        : {}),
    };
    return [merged, ...reports.slice(0, existingIndex), ...reports.slice(existingIndex + 1)]
      .slice(0, Math.max(1, limit));
  }

  return [report, ...reports].slice(0, Math.max(1, limit));
}

function sanitizeRecord(value, now) {
  if (!isRecord(value)) return undefined;
  if (!isCrashReportKind(value.kind)) return undefined;
  if (!isFiniteTimestamp(value.timestamp)) return undefined;
  return createCrashReportRecord(value, now);
}

function sanitizeQueue(value, now) {
  if (!Array.isArray(value)) return [];
  const sanitized = [];
  const seenIds = new Set();
  for (const candidate of value) {
    const record = sanitizeRecord(candidate, now);
    if (!record || seenIds.has(record.id)) continue;
    seenIds.add(record.id);
    sanitized.push(record);
  }
  return sanitized.slice(0, CRASH_REPORT_QUEUE_LIMIT);
}

function createCrashReportFileStore(options) {
  const fs = options.fs;
  const directoryPath = options.directoryPath;
  const now = options.now || Date.now;
  const queueFilePath = `${directoryPath}/crash-report-queue.json`;
  const settingsFilePath = `${directoryPath}/crash-report-settings.json`;

  function ensureDirectory() {
    try {
      fs.mkdirSync(directoryPath, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  function readJson(filePath) {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      return { ok: false, missing: true };
    }
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false, corrupt: true, raw };
    }
  }

  function writeJsonAtomic(filePath, value) {
    if (!ensureDirectory()) return { ok: false, error: 'crash report directory unavailable' };
    const temporaryPath = `${filePath}.tmp-${now()}`;
    try {
      fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryPath, filePath);
      return { ok: true };
    } catch (error) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // The temporary file may never have been created.
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function quarantineCorruptFile(filePath, raw) {
    try {
      fs.writeFileSync(`${filePath}.corrupt-${now()}.json`, raw, 'utf8');
    } catch {
      // Quarantine is best-effort; a fresh queue must still start.
    }
  }

  function loadReports() {
    const result = readJson(queueFilePath);
    if (result.missing) return [];
    if (!result.ok) {
      if (result.corrupt) quarantineCorruptFile(queueFilePath, result.raw);
      return [];
    }
    const queue = sanitizeQueue(result.value, now());
    if (!Array.isArray(result.value) || queue.length !== result.value.length) {
      writeJsonAtomic(queueFilePath, queue);
    }
    return queue;
  }

  function persistReports(reports) {
    return writeJsonAtomic(queueFilePath, reports);
  }

  function loadEnabled() {
    const result = readJson(settingsFilePath);
    if (!result.ok || !isRecord(result.value)) return false;
    return result.value.captureEnabled === true;
  }

  function persistEnabled(enabled) {
    return writeJsonAtomic(settingsFilePath, { captureEnabled: enabled === true, updatedAt: now() });
  }

  return {
    queueFilePath,
    settingsFilePath,
    loadReports,
    persistReports,
    loadEnabled,
    persistEnabled,
  };
}

function countPendingMinidumps(crashDumpsPath, fs) {
  const candidates = [crashDumpsPath, `${crashDumpsPath}/reports`, `${crashDumpsPath}/completed`];
  let count = 0;
  for (const directory of candidates) {
    try {
      const entries = fs.readdirSync(directory);
      count += entries.filter((entry) => String(entry).endsWith('.dmp')).length;
    } catch {
      // A missing or unreadable directory contributes zero pending dumps.
    }
  }
  return count;
}

function removePendingMinidumps(crashDumpsPath, fs) {
  const candidates = [crashDumpsPath, `${crashDumpsPath}/reports`, `${crashDumpsPath}/completed`];
  let removed = 0;
  let firstError;
  for (const directory of candidates) {
    try {
      const entries = fs.readdirSync(directory);
      for (const entry of entries) {
        if (!String(entry).endsWith('.dmp')) continue;
        try {
          fs.unlinkSync(`${directory}/${entry}`);
          removed += 1;
        } catch (error) {
          firstError = firstError || (error instanceof Error ? error.message : String(error));
        }
      }
    } catch {
      // Missing directories simply have nothing to remove.
    }
  }
  return { removed, error: firstError };
}

function createCrashReportController(options) {
  const store = options.store;
  const fs = options.fs;
  const targetProcess = options.targetProcess || process;
  const crashReporter = options.crashReporter || null;
  const app = options.app || null;
  const now = options.now || Date.now;
  const appVersion = options.appVersion || '';

  let reports = store.loadReports();
  let enabled = store.loadEnabled();
  let nativeReporterStarted = false;
  let processCaptureInstalled = false;
  let handlingUncaught = false;

  function persist() {
    return store.persistReports(reports);
  }

  function append(kind, message, extra) {
    if (!enabled) return null;
    const record = createCrashReportRecord(
      { kind, message, ...(extra || {}), ...(appVersion ? { appVersion } : {}) },
      now(),
    );
    reports = appendReport(reports, record);
    persist();
    return record;
  }

  function startNativeCrashReporter() {
    if (nativeReporterStarted || !crashReporter) return { started: false, reason: 'unavailable' };
    try {
      crashReporter.start({ uploadToServer: false, submitURL: '' });
      nativeReporterStarted = true;
      return { started: true };
    } catch (error) {
      return { started: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled === true;
    const persistResult = store.persistEnabled(enabled);
    if (enabled) startNativeCrashReporter();
    return { enabled, persistResult };
  }

  function errorHandler(error) {
    if (handlingUncaught) throw error;
    handlingUncaught = true;
    try {
      append('main-uncaught-exception', error, {
        stack: error instanceof Error ? error.stack : undefined,
      });
    } catch {
      // Recording must never mask the original crash.
    } finally {
      handlingUncaught = false;
    }
    throw error;
  }

  function rejectionHandler(reason) {
    try {
      append('main-unhandled-rejection', reason, {
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    } catch {
      // Recording must never turn a rejection into a crash.
    }
  }

  function installProcessCapture() {
    if (processCaptureInstalled) return () => undefined;
    processCaptureInstalled = true;

    targetProcess.on('uncaughtException', errorHandler);
    targetProcess.on('unhandledRejection', rejectionHandler);

    return () => {
      targetProcess.removeListener('uncaughtException', errorHandler);
      targetProcess.removeListener('unhandledRejection', rejectionHandler);
      processCaptureInstalled = false;
    };
  }

  function attachWebContentsCapture(webContents, surfaceName) {
    if (!webContents || typeof webContents.on !== 'function') return () => undefined;
    const handler = (_event, details) => {
      try {
        append('renderer-process-gone', `Renderer process gone: ${details && details.reason ? details.reason : 'unknown'}`, {
          surface: surfaceName,
          detail: details
            ? `reason=${details.reason || 'unknown'} exitCode=${details.exitCode ?? 'unknown'}`
            : undefined,
        });
      } catch {
        // Never let crash recording crash the window teardown path.
      }
    };
    webContents.on('render-process-gone', handler);
    return () => {
      try {
        webContents.removeListener('render-process-gone', handler);
      } catch {
        // The webContents may already be destroyed.
      }
    };
  }

  function attachChildProcessCapture(appInterfaces) {
    const appInterface = appInterfaces || app;
    if (!appInterface || typeof appInterface.on !== 'function') return () => undefined;
    const handler = (_event, details) => {
      try {
        append(
          'child-process-gone',
          `Child process gone: ${details && details.type ? details.type : 'unknown'}`,
          {
            detail: details
              ? `type=${details.type || 'unknown'} reason=${details.reason || 'unknown'} exitCode=${details.exitCode ?? 'unknown'} name=${details.name || ''}`.trim()
              : undefined,
          },
        );
      } catch {
        // Recording is best-effort.
      }
    };
    appInterface.on('child-process-gone', handler);
    return () => {
      try {
        appInterface.removeListener('child-process-gone', handler);
      } catch {
        // Ignore teardown races.
      }
    };
  }

  function recordRendererReport(payload) {
    if (!enabled) return { recorded: false, reason: 'capture-disabled' };
    if (!isRecord(payload) || !RENDERER_MIRRORED_KINDS.has(payload.kind)) {
      return { recorded: false, reason: 'invalid-report' };
    }
    const record = createCrashReportRecord(payload, now());
    reports = appendReport(reports, record);
    persist();
    return { recorded: true, report: record };
  }

  function clearReports() {
    reports = [];
    const persistResult = persist();
    let minidumps = { removed: 0, error: undefined };
    const crashDumpsPath = resolveCrashDumpsPath();
    if (crashDumpsPath && fs && typeof fs.readdirSync === 'function') {
      minidumps = removePendingMinidumps(crashDumpsPath, fs);
    }
    return { ok: persistResult.ok, persistError: persistResult.error, minidumpsRemoved: minidumps.removed, minidumpError: minidumps.error };
  }

  function resolveCrashDumpsPath() {
    try {
      return app && typeof app.getPath === 'function' ? app.getPath('crashDumps') : undefined;
    } catch {
      return undefined;
    }
  }

  function getState() {
    const crashDumpsPath = resolveCrashDumpsPath();
    return {
      enabled,
      reports,
      nativeReporterStarted,
      ...(crashDumpsPath ? { crashDumpsPath } : {}),
      pendingMinidumpCount: crashDumpsPath && fs && typeof fs.readdirSync === 'function'
        ? countPendingMinidumps(crashDumpsPath, fs)
        : 0,
    };
  }

  if (enabled) startNativeCrashReporter();

  return {
    append,
    setEnabled,
    getEnabled: () => enabled,
    installProcessCapture,
    attachWebContentsCapture,
    attachChildProcessCapture,
    recordRendererReport,
    clearReports,
    getState,
  };
}

module.exports = {
  CRASH_REPORT_QUEUE_LIMIT,
  isCrashReportKind,
  redactText,
  createCrashReportRecord,
  appendReport,
  sanitizeQueue,
  createCrashReportFileStore,
  createCrashReportController,
  countPendingMinidumps,
  removePendingMinidumps,
};
