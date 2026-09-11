// Validation and queueing for desktop external-open requests (AUD-040).
//
// Every way a file or URL can reach the desktop app from the outside — initial argv on
// Linux/Windows, a `second-instance` relaunch, macOS `open-file`/`open-url` events — funnels
// through this module: raw values are classified against a strict allowlist (local `.sloom`
// projects, local `.slppr` Paper layouts, and the already-defined `signal-loom://workspace/<view>`
// deep links), then held in a transactional queue until the designated renderer commits them.
// Filesystem identity resolution is injectable so the contract stays testable outside Electron.
'use strict';

const { closeSync, fstatSync, openSync, readFileSync, realpathSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { posix, win32 } = require('node:path');

const EXTERNAL_OPEN_DEEP_LINK_SCHEME = 'signal-loom';
const EXTERNAL_OPEN_DEEP_LINK_WORKSPACE_HOST = 'workspace';
const EXTERNAL_OPEN_DOCUMENT_EXTENSIONS = Object.freeze({
  '.sloom': 'project',
  '.slppr': 'paper',
});
const DEFAULT_EXTERNAL_OPEN_WORKSPACE_VIEWS = Object.freeze(['flow', 'editor', 'image', 'paper']);
const SECOND_INSTANCE_PAYLOAD_KIND = 'signal-loom-external-open';
const MAX_EXTERNAL_OPEN_TARGET_LENGTH = 4096;
const MAX_SECOND_INSTANCE_ARGV_ENTRIES = 64;
const DEFAULT_MAX_PENDING_REQUESTS = 16;
const MAX_EXTERNAL_OPEN_DELIVERY_ID_LENGTH = 256;

function hasControlCharacters(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

function isWindowsDriveAbsolutePath(value) {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function looksLikeUrl(value) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value);
}

function classifyDocumentPath(filePath, value) {
  const lastDotIndex = filePath.lastIndexOf('.');
  const extension = lastDotIndex === -1 ? '' : filePath.slice(lastDotIndex).toLowerCase();
  const kind = EXTERNAL_OPEN_DOCUMENT_EXTENSIONS[extension];

  if (!kind) {
    return { status: 'rejected', reason: 'unsupported-extension', value };
  }

  return { status: 'accepted', kind, filePath };
}

function classifyDeepLink(url, value, workspaceViews) {
  if (url.hostname !== EXTERNAL_OPEN_DEEP_LINK_WORKSPACE_HOST || url.search || url.hash || url.username || url.password) {
    return { status: 'rejected', reason: 'unsupported-deep-link', value };
  }

  const segments = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (segments.length !== 1 || !workspaceViews.includes(segments[0])) {
    return { status: 'rejected', reason: 'unsupported-deep-link', value };
  }

  return { status: 'accepted', kind: 'workspace', workspace: segments[0] };
}

function classifyFileUrl(url, value, platform) {
  if (url.hostname && url.hostname !== 'localhost') {
    return { status: 'rejected', reason: 'remote-target', value };
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return { status: 'rejected', reason: 'malformed', value };
  }

  if (hasControlCharacters(decodedPath)) {
    return { status: 'rejected', reason: 'control-characters', value };
  }

  if (platform === 'win32' && /^\/[a-zA-Z]:[\\/]/.test(decodedPath)) {
    decodedPath = decodedPath.slice(1);
  }

  return classifyDocumentPath(decodedPath, value);
}

/**
 * Classify one raw external-open value (an argv token, an `open-file` path, or an `open-url`
 * URL) against the supported-target allowlist. Returns exactly one of:
 * `{ status: 'accepted', kind: 'project' | 'paper', filePath }`,
 * `{ status: 'accepted', kind: 'workspace', workspace }`,
 * `{ status: 'ignored', reason }` for launcher noise that carries no user intent, or
 * `{ status: 'rejected', reason, value }` for malformed/remote/unsupported/injection-shaped input.
 */
function classifyExternalOpenTarget(rawValue, context = {}) {
  const { cwd, platform = process.platform, workspaceViews = DEFAULT_EXTERNAL_OPEN_WORKSPACE_VIEWS } = context;

  if (typeof rawValue !== 'string') {
    return { status: 'rejected', reason: 'malformed', value: String(rawValue) };
  }

  const value = rawValue.trim();
  if (!value) {
    return { status: 'ignored', reason: 'empty' };
  }
  if (value === '.') {
    return { status: 'ignored', reason: 'current-directory' };
  }
  if (value.length > MAX_EXTERNAL_OPEN_TARGET_LENGTH) {
    return { status: 'rejected', reason: 'malformed', value: `${value.slice(0, 64)}…` };
  }
  if (hasControlCharacters(value)) {
    return { status: 'rejected', reason: 'control-characters', value };
  }
  if (value.startsWith('-')) {
    return { status: 'ignored', reason: 'command-like-argument' };
  }

  if (platform === 'win32' && isWindowsDriveAbsolutePath(value)) {
    return classifyDocumentPath(value, value);
  }

  if (looksLikeUrl(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return { status: 'rejected', reason: 'malformed', value };
    }

    if (url.protocol === `${EXTERNAL_OPEN_DEEP_LINK_SCHEME}:`) {
      return classifyDeepLink(url, value, workspaceViews);
    }
    if (url.protocol === 'file:') {
      return classifyFileUrl(url, value, platform);
    }
    return { status: 'rejected', reason: 'remote-target', value };
  }

  if (platform === 'win32' && value.startsWith('\\\\')) {
    return { status: 'rejected', reason: 'remote-target', value };
  }

  const pathModule = platform === 'win32' ? win32 : posix;
  if (!pathModule.isAbsolute(value)) {
    if (typeof cwd !== 'string' || !cwd) {
      return { status: 'rejected', reason: 'relative-without-base', value };
    }
    return classifyDocumentPath(pathModule.resolve(cwd, value), value);
  }

  return classifyDocumentPath(value, value);
}

function normalizeIdentityPath(filePath, platform) {
  const normalized = platform === 'win32'
    ? win32.normalize(filePath)
    : posix.normalize(filePath);
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

/**
 * Resolve an accepted document path and snapshot its bytes through one owned descriptor.
 * `realpath` collapses relative/symlink aliases and the observable device/inode pair also
 * collapses hard links. Before/after descriptor metadata rejects a file mutating during the
 * read; later path replacement cannot change the queued bytes. Windows' case-insensitive path
 * spelling is only a fallback when the filesystem exposes no usable inode.
 */
function canonicalizeExternalOpenFilePath(filePath, context = {}) {
  const {
    platform = process.platform,
    resolveRealPath = (value) => realpathSync.native(value),
  } = context;
  const usesInjectedStatOnly = typeof context.readStat === 'function' && typeof context.openFile !== 'function';
  const openFile = context.openFile ?? (usesInjectedStatOnly ? (value) => value : (value) => openSync(value, 'r'));
  const readStat = context.readStat ?? ((descriptor) => fstatSync(descriptor));
  const readBytes = context.readBytes ?? (usesInjectedStatOnly ? (() => Buffer.alloc(0)) : ((descriptor) => readFileSync(descriptor)));
  const closeFile = context.closeFile ?? (usesInjectedStatOnly ? (() => undefined) : ((descriptor) => closeSync(descriptor)));

  let canonicalPath;
  try {
    canonicalPath = resolveRealPath(filePath);
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    return {
      status: 'rejected',
      reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing-file' : 'unresolvable-file',
    };
  }

  let descriptor;
  try {
    descriptor = openFile(canonicalPath);
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    return {
      status: 'rejected',
      reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing-file' : 'unresolvable-file',
    };
  }

  try {
    const before = readStat(descriptor);
    if (!before?.isFile?.()) {
      return { status: 'rejected', reason: 'not-a-file' };
    }

    const bytes = Buffer.from(readBytes(descriptor));
    const after = readStat(descriptor);
    const device = typeof before.dev === 'bigint' || Number.isFinite(before.dev) ? String(before.dev) : '';
    const inode = typeof before.ino === 'bigint' || Number.isFinite(before.ino) ? String(before.ino) : '';
    const afterDevice = typeof after.dev === 'bigint' || Number.isFinite(after.dev) ? String(after.dev) : '';
    const afterInode = typeof after.ino === 'bigint' || Number.isFinite(after.ino) ? String(after.ino) : '';
    const beforeSize = typeof before.size === 'bigint' || Number.isFinite(before.size) ? String(before.size) : String(bytes.byteLength);
    const afterSize = typeof after.size === 'bigint' || Number.isFinite(after.size) ? String(after.size) : String(bytes.byteLength);
    const beforeMtime = typeof before.mtimeNs === 'bigint'
      ? String(before.mtimeNs)
      : Number.isFinite(before.mtimeMs) ? String(before.mtimeMs) : '';
    const afterMtime = typeof after.mtimeNs === 'bigint'
      ? String(after.mtimeNs)
      : Number.isFinite(after.mtimeMs) ? String(after.mtimeMs) : '';
    const beforeCtime = typeof before.ctimeNs === 'bigint'
      ? String(before.ctimeNs)
      : Number.isFinite(before.ctimeMs) ? String(before.ctimeMs) : '';
    const afterCtime = typeof after.ctimeNs === 'bigint'
      ? String(after.ctimeNs)
      : Number.isFinite(after.ctimeMs) ? String(after.ctimeMs) : '';
    if (
      device !== afterDevice
      || inode !== afterInode
      || beforeSize !== afterSize
      || (beforeMtime && afterMtime && beforeMtime !== afterMtime)
      || (beforeCtime && afterCtime && beforeCtime !== afterCtime)
      || afterSize !== String(bytes.byteLength)
    ) {
      return { status: 'rejected', reason: 'file-changed-during-read' };
    }

    const fileIdentity = device && inode && inode !== '0'
      ? `inode:${device}:${inode}`
      : `path:${normalizeIdentityPath(canonicalPath, platform)}`;
    return {
      status: 'accepted',
      filePath: canonicalPath,
      fileIdentity,
      bytes,
      byteDigest: digestReceipt(bytes),
    };
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : undefined;
    return {
      status: 'rejected',
      reason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing-file' : 'unresolvable-file',
    };
  } finally {
    try {
      closeFile(descriptor);
    } catch {
      /* best effort; the enqueue is rejected above when the owned read itself fails */
    }
  }
}

function createExternalOpenDeliveryId() {
  return `external-open-delivery-${randomUUID()}`;
}

/**
 * Pull candidate open targets out of a raw process argv. Launcher-owned tokens (the executable,
 * the default-app path argument, `.`, `--dev`, and Chromium switches) carry no user intent and
 * are dropped silently; everything else goes to `classifyExternalOpenTarget` for a verdict.
 */
function extractExternalOpenCandidatesFromArgv(argv, context = {}) {
  const { appPath, execPath } = context;
  const candidates = [];

  for (const token of argv ?? []) {
    if (typeof token !== 'string' || token === '') {
      continue;
    }
    if (token === execPath || token === appPath || token === '.') {
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    candidates.push(token);
  }

  return candidates;
}

/**
 * Build a validated legacy additionalData payload. Production uses Electron's bare-lock native
 * argv/workingDirectory relay, which is covered by the real lifecycle probe; these helpers remain
 * defensive compatibility parsers only.
 */
function buildSecondInstanceOpenPayload(argv, workingDirectory, deliveryId) {
  const entries = (Array.isArray(argv) ? argv : [])
    .filter((value) => typeof value === 'string')
    .slice(0, MAX_SECOND_INSTANCE_ARGV_ENTRIES)
    .map((value) => value.slice(0, MAX_EXTERNAL_OPEN_TARGET_LENGTH));

  return {
    kind: SECOND_INSTANCE_PAYLOAD_KIND,
    version: 1,
    argv: entries,
    workingDirectory: typeof workingDirectory === 'string' ? workingDirectory : '',
    ...(typeof deliveryId === 'string' && deliveryId.length > 0 && deliveryId.length <= MAX_EXTERNAL_OPEN_DELIVERY_ID_LENGTH
      ? { deliveryId }
      : {}),
  };
}

/** Validate an untrusted `second-instance` additionalData value; undefined when it is not ours. */
function parseSecondInstanceOpenPayload(value) {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  if (value.kind !== SECOND_INSTANCE_PAYLOAD_KIND || value.version !== 1) {
    return undefined;
  }
  if (!Array.isArray(value.argv) || value.argv.length > MAX_SECOND_INSTANCE_ARGV_ENTRIES) {
    return undefined;
  }
  if (!value.argv.every((entry) => typeof entry === 'string' && entry.length <= MAX_EXTERNAL_OPEN_TARGET_LENGTH)) {
    return undefined;
  }
  if (typeof value.workingDirectory !== 'string') {
    return undefined;
  }
  if (value.deliveryId !== undefined && (
    typeof value.deliveryId !== 'string'
    || value.deliveryId.length === 0
    || value.deliveryId.length > MAX_EXTERNAL_OPEN_DELIVERY_ID_LENGTH
  )) {
    return undefined;
  }

  return {
    argv: [...value.argv],
    workingDirectory: value.workingDirectory,
    ...(value.deliveryId ? { deliveryId: value.deliveryId } : {}),
  };
}

function digestReceipt(value) {
  return createHash('sha256').update(value).digest('base64url');
}

/**
 * Main-owned transactional queue for validated external-open intents. Documents remain owned by
 * main until the designated renderer accepts and commits them. A rejection removes the intent
 * without creating an idempotency receipt. A commit records the bounded delivery identity as a
 * fixed-size, non-expiring event receipt digest: capacity pressure, wall-clock delay, and a path
 * resolving to a new inode cannot make an already committed OS event authoritative again, while
 * a later user open carries a new delivery identity and remains eligible.
 */
function createExternalOpenQueue(options) {
  const {
    canonicalizeFile = canonicalizeExternalOpenFilePath,
    workspaceViews = DEFAULT_EXTERNAL_OPEN_WORKSPACE_VIEWS,
    maxPending = DEFAULT_MAX_PENDING_REQUESTS,
  } = options ?? {};

  if (typeof canonicalizeFile !== 'function') {
    throw new Error('createExternalOpenQueue requires a canonicalizeFile(filePath) resolver.');
  }

  const pending = [];
  const committedReceipts = new Set();
  // Retain intent ids as well as delivery receipts so a renderer retry after a committed IPC
  // response was lost receives the same committed answer instead of an ambiguous not-found.
  const committedIntentIds = new Set();
  let nextIntentSequence = 1;
  let nextEpochSequence = 1;
  let authorization;

  function targetKey(target) {
    return target.kind === 'workspace' ? `workspace\n${target.workspace}` : `${target.kind}\n${target.fileIdentity}`;
  }

  function receiptKey(deliveryId, candidateIndex, key) {
    return digestReceipt(deliveryId
      ? `${deliveryId}\n${candidateIndex ?? 0}`
      : `legacy-delivery\n${key}`);
  }

  function publicIntent(entry) {
    return entry.kind === 'workspace'
      ? { id: entry.id, kind: 'workspace', workspace: entry.workspace }
      : { id: entry.id, kind: entry.kind, filePath: entry.filePath, bytes: entry.bytes };
  }

  function isAuthorized(request) {
    return Boolean(
      authorization
      && request
      && request.rendererId === authorization.rendererId
      && request.epoch === authorization.epoch,
    );
  }

  function requeueOwnedIntents(rendererId, epoch) {
    const releasedIntentIds = [];
    for (const entry of pending) {
      if (entry.ownerRendererId !== rendererId || entry.ownerEpoch !== epoch) continue;
      entry.state = 'pending';
      delete entry.ownerRendererId;
      delete entry.ownerEpoch;
      releasedIntentIds.push(entry.id);
    }
    return releasedIntentIds;
  }

  function enqueueValue(rawValue, context = {}) {
    const classified = classifyExternalOpenTarget(rawValue, {
      cwd: context.cwd,
      platform: context.platform,
      workspaceViews,
    });

    if (classified.status !== 'accepted') {
      return classified;
    }

    const deliveryId = typeof context.deliveryId === 'string'
      && context.deliveryId.length > 0
      && context.deliveryId.length <= MAX_EXTERNAL_OPEN_DELIVERY_ID_LENGTH
      ? context.deliveryId
      : undefined;
    const deliveryReceiptKey = deliveryId
      ? receiptKey(deliveryId, context.candidateIndex, '')
      : undefined;
    if (
      deliveryReceiptKey
      && (pending.some((entry) => entry.committedReceiptKey === deliveryReceiptKey)
        || committedReceipts.has(deliveryReceiptKey))
    ) {
      return { status: 'duplicate', kind: classified.kind };
    }

    let canonical = classified;
    if (classified.kind !== 'workspace') {
      const resolution = canonicalizeFile(classified.filePath, { platform: context.platform });
      if (!resolution || resolution.status !== 'accepted') {
        return {
          status: 'rejected',
          reason: resolution?.reason ?? 'unresolvable-file',
          value: String(rawValue),
        };
      }
      canonical = {
        ...classified,
        filePath: resolution.filePath,
        fileIdentity: resolution.fileIdentity,
        bytes: resolution.bytes,
        byteDigest: resolution.byteDigest,
      };
    }

    const key = targetKey(canonical);
    const committedReceiptKey = deliveryReceiptKey ?? receiptKey(undefined, context.candidateIndex, key);
    if (pending.some((entry) => entry.committedReceiptKey === committedReceiptKey || entry.key === key)) {
      return { status: 'duplicate', kind: canonical.kind };
    }
    if (committedReceipts.has(committedReceiptKey)) {
      return { status: 'duplicate', kind: canonical.kind };
    }
    if (pending.length >= maxPending) {
      return { status: 'rejected', reason: 'queue-overflow', value: String(rawValue) };
    }

    pending.push({
      ...canonical,
      id: `external-open-${nextIntentSequence++}`,
      key,
      committedReceiptKey,
      state: 'pending',
    });
    return { status: 'enqueued', kind: canonical.kind };
  }

  function enqueueArgv(argv, context = {}) {
    const enqueued = [];
    const rejected = [];

    for (const [candidateIndex, candidate] of extractExternalOpenCandidatesFromArgv(argv, context).entries()) {
      const outcome = enqueueValue(candidate, { ...context, candidateIndex });
      if (outcome.status === 'enqueued') {
        const entry = pending[pending.length - 1];
        enqueued.push(entry.kind === 'workspace'
          ? { kind: 'workspace', workspace: entry.workspace }
          : { kind: entry.kind, filePath: entry.filePath });
      } else if (outcome.status === 'rejected') {
        rejected.push({ value: outcome.value, reason: outcome.reason });
      }
    }

    return { enqueued, rejected };
  }

  function takeWorkspaceRequests() {
    const taken = [];
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (pending[index].kind !== 'workspace') continue;
      const [entry] = pending.splice(index, 1);
      committedReceipts.add(entry.committedReceiptKey);
      taken.unshift({ kind: 'workspace', workspace: entry.workspace });
    }
    return taken;
  }

  function authorizeRenderer(rendererId) {
    if (typeof rendererId !== 'string' || !rendererId) {
      return { authorized: false, reason: 'invalid-renderer' };
    }
    const releasedIntentIds = authorization
      ? requeueOwnedIntents(authorization.rendererId, authorization.epoch)
      : [];
    authorization = {
      rendererId,
      epoch: `external-open-epoch-${nextEpochSequence++}`,
    };
    return { authorized: true, epoch: authorization.epoch, releasedIntentIds };
  }

  function revokeRenderer(request) {
    if (!isAuthorized(request)) {
      return { status: 'unauthorized', releasedIntentIds: [] };
    }
    const releasedIntentIds = requeueOwnedIntents(authorization.rendererId, authorization.epoch);
    authorization = undefined;
    return { status: 'revoked', releasedIntentIds };
  }

  function offerNextDocumentIntent(request) {
    if (!isAuthorized(request)) return { status: 'unauthorized' };
    const owned = pending.find((entry) =>
      entry.kind !== 'workspace'
      && entry.ownerRendererId === request.rendererId
      && entry.ownerEpoch === request.epoch,
    );
    if (owned) return { status: 'offered', intent: publicIntent(owned), state: owned.state };

    const entry = pending.find((candidate) => candidate.kind !== 'workspace' && candidate.state === 'pending');
    if (!entry) return { status: 'empty' };
    entry.state = 'offered';
    entry.ownerRendererId = request.rendererId;
    entry.ownerEpoch = request.epoch;
    return { status: 'offered', intent: publicIntent(entry), state: entry.state };
  }

  function transitionOwnedIntent(request, expectedState, nextState, status) {
    if (!isAuthorized(request)) return { status: 'unauthorized' };
    const entry = pending.find((candidate) => candidate.id === request.intentId);
    if (!entry || entry.ownerRendererId !== request.rendererId || entry.ownerEpoch !== request.epoch) {
      return { status: 'not-found' };
    }
    if (entry.state !== expectedState) return { status: 'invalid-state', state: entry.state };
    entry.state = nextState;
    return { status };
  }

  function acceptDocumentIntent(request) {
    return transitionOwnedIntent(request, 'offered', 'accepted', 'accepted');
  }

  function rejectDocumentIntent(request) {
    if (!isAuthorized(request)) return { status: 'unauthorized' };
    const index = pending.findIndex((entry) =>
      entry.id === request.intentId
      && entry.ownerRendererId === request.rendererId
      && entry.ownerEpoch === request.epoch,
    );
    if (index === -1) return { status: 'not-found' };
    pending.splice(index, 1);
    return { status: 'rejected' };
  }

  function commitDocumentIntent(request) {
    if (!isAuthorized(request)) return { status: 'unauthorized' };
    if (committedIntentIds.has(request.intentId)) return { status: 'committed' };
    const index = pending.findIndex((entry) =>
      entry.id === request.intentId
      && entry.ownerRendererId === request.rendererId
      && entry.ownerEpoch === request.epoch,
    );
    if (index === -1) return { status: 'not-found' };
    const entry = pending[index];
    if (entry.state !== 'accepted') return { status: 'invalid-state', state: entry.state };
    pending.splice(index, 1);
    committedReceipts.add(entry.committedReceiptKey);
    committedIntentIds.add(entry.id);
    return { status: 'committed' };
  }

  return {
    enqueueValue,
    enqueueArgv,
    hasPending: (kind) => (kind ? pending.some((entry) => entry.kind === kind) : pending.length > 0),
    pendingCount: () => pending.length,
    authorizeRenderer,
    revokeRenderer,
    offerNextDocumentIntent,
    acceptDocumentIntent,
    rejectDocumentIntent,
    commitDocumentIntent,
    takeWorkspaceRequests,
  };
}

function mergeExternalOpenSourceRollback(previousSnapshot, stagedSnapshot, currentSnapshot) {
  const previous = previousSnapshot && typeof previousSnapshot === 'object' ? previousSnapshot : { bins: [], dismissedSourceKeys: [] };
  const staged = stagedSnapshot && typeof stagedSnapshot === 'object' ? stagedSnapshot : { bins: [], dismissedSourceKeys: [] };
  const current = currentSnapshot && typeof currentSnapshot === 'object' ? currentSnapshot : { bins: [], dismissedSourceKeys: [] };
  const previousBins = new Map((previous.bins ?? []).map((bin) => [bin.id, structuredClone(bin)]));
  const stagedBins = new Map((staged.bins ?? []).map((bin) => [bin.id, bin]));
  const currentBins = new Map((current.bins ?? []).map((bin) => [bin.id, bin]));

  for (const [binId, stagedBin] of stagedBins) {
    const currentBin = currentBins.get(binId);
    if (!currentBin) {
      previousBins.delete(binId);
      continue;
    }
    const previousBin = previousBins.get(binId) ?? { ...structuredClone(currentBin), items: [] };
    const previousItems = new Map((previousBin.items ?? []).map((item) => [item.id, item]));
    const stagedItems = new Map((stagedBin.items ?? []).map((item) => [item.id, item]));
    const currentItems = new Map((currentBin.items ?? []).map((item) => [item.id, item]));

    for (const [itemId, stagedItem] of stagedItems) {
      const currentItem = currentItems.get(itemId);
      if (!currentItem) {
        previousItems.delete(itemId);
      } else if (JSON.stringify(currentItem) !== JSON.stringify(stagedItem)) {
        previousItems.set(itemId, structuredClone(currentItem));
      }
    }
    for (const [itemId, currentItem] of currentItems) {
      if (!stagedItems.has(itemId)) previousItems.set(itemId, structuredClone(currentItem));
    }

    const stagedMetadata = { ...stagedBin, items: undefined };
    const currentMetadata = { ...currentBin, items: undefined };
    previousBins.set(binId, {
      ...(JSON.stringify(stagedMetadata) === JSON.stringify(currentMetadata)
        ? previousBin
        : { ...previousBin, ...structuredClone(currentMetadata) }),
      items: [...previousItems.values()],
    });
  }
  for (const [binId, currentBin] of currentBins) {
    if (!stagedBins.has(binId)) previousBins.set(binId, structuredClone(currentBin));
  }

  const stagedDismissed = new Set(staged.dismissedSourceKeys ?? []);
  const currentDismissed = new Set(current.dismissedSourceKeys ?? []);
  const dismissed = new Set(previous.dismissedSourceKeys ?? []);
  for (const key of stagedDismissed) if (!currentDismissed.has(key)) dismissed.delete(key);
  for (const key of currentDismissed) if (!stagedDismissed.has(key)) dismissed.add(key);

  return { bins: [...previousBins.values()], dismissedSourceKeys: [...dismissed] };
}

module.exports = {
  DEFAULT_EXTERNAL_OPEN_WORKSPACE_VIEWS,
  EXTERNAL_OPEN_DEEP_LINK_SCHEME,
  EXTERNAL_OPEN_DOCUMENT_EXTENSIONS,
  buildSecondInstanceOpenPayload,
  canonicalizeExternalOpenFilePath,
  classifyExternalOpenTarget,
  createExternalOpenDeliveryId,
  createExternalOpenQueue,
  extractExternalOpenCandidatesFromArgv,
  mergeExternalOpenSourceRollback,
  parseSecondInstanceOpenPayload,
};
