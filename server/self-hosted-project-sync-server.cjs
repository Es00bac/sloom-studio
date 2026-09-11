#!/usr/bin/env node
'use strict';

/**
 * Bounded self-hosted project authority for MH-081.
 *
 * This is deliberately a small single-process service. It binds loopback by default, stores no
 * third-party credentials, and persists its complete authority state by atomic file replacement.
 * It is not a hosted service, a multi-region deployment, an external IdP, or an E2EE protocol.
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const STATE_VERSION = 1;
const DEFAULT_LIMITS = Object.freeze({
  maxRequestBytes: 2 * 1024 * 1024,
  maxProjectBytes: 1024 * 1024,
  maxAccountBytes: 16 * 1024 * 1024,
  maxProjectsPerAccount: 64,
  maxRevisionsPerProject: 32,
  maxEventsPerProject: 256,
  maxSessionsPerAccount: 32,
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
});

class HttpFailure extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new HttpFailure(status, code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isRecord(value) {
  return isPlainObject(value);
}

function createEmptyState() {
  return {
    version: STATE_VERSION,
    accounts: {},
    projects: {},
    sessions: {},
  };
}

function isValidState(value) {
  return isRecord(value)
    && value.version === STATE_VERSION
    && isRecord(value.accounts)
    && isRecord(value.projects)
    && isRecord(value.sessions);
}

function normalizeEmail(value) {
  if (typeof value !== 'string') fail(400, 'invalid-email', 'An email address is required.');
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(400, 'invalid-email', 'Provide a valid email address.');
  }
  return email;
}

function requirePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) {
    fail(400, 'invalid-password', 'Passwords must be between 12 and 256 characters.');
  }
  return value;
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    fail(400, `invalid-${field}`, `${field} must use 1–64 letters, numbers, dots, dashes, or underscores.`);
  }
  return value;
}

function requireName(value) {
  if (typeof value !== 'string') fail(400, 'invalid-name', 'A project name is required.');
  const name = value.trim();
  if (!name || name.length > 160) fail(400, 'invalid-name', 'Project names must contain 1–160 characters.');
  return name;
}

function requireMutationId(value) {
  return requireIdentifier(value, 'mutation-id');
}

function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(400, 'invalid-base-revision', 'baseRevision must be a positive integer.');
  }
  return value;
}

function bodyBlob(value, maxBytes) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    fail(400, 'invalid-project-blob', 'A JSON project blob is required.');
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail(400, 'invalid-project-blob', 'The project blob must be serializable JSON.');
  }
  if (serialized === undefined) fail(400, 'invalid-project-blob', 'The project blob must be serializable JSON.');
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes > maxBytes) fail(413, 'project-too-large', 'The project blob exceeds this authority’s configured limit.');
  return { serialized, bytes };
}

function projectStorageBytes(project) {
  if (!isRecord(project) || !Array.isArray(project.revisions)) return 0;
  return project.revisions.reduce((total, revision) => (
    isRecord(revision) && Number.isSafeInteger(revision.bytes) ? total + revision.bytes : total
  ), 0);
}

function accountStorageBytes(state, accountId) {
  return Object.values(state.projects).reduce((total, project) => (
    isRecord(project) && project.accountId === accountId ? total + projectStorageBytes(project) : total
  ), 0);
}

function projectCount(state, accountId) {
  return Object.values(state.projects).filter((project) => isRecord(project) && project.accountId === accountId).length;
}

function findAccountByEmail(state, email) {
  return Object.values(state.accounts).find((account) => isRecord(account) && account.email === email) ?? null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve({ salt, hash: derivedKey.toString('base64url') });
    });
  });
}

async function passwordMatches(password, account) {
  if (!isRecord(account) || typeof account.passwordHash !== 'string' || typeof account.passwordSalt !== 'string') return false;
  const candidate = await hashPassword(password, account.passwordSalt);
  const expected = Buffer.from(account.passwordHash, 'base64url');
  const actual = Buffer.from(candidate.hash, 'base64url');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(18).toString('base64url')}`;
}

async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const value = JSON.parse(text);
  if (!isValidState(value)) throw new Error('state shape is not valid');
  return value;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fsyncDirectory(directory) {
  try {
    const handle = await fs.open(directory, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Windows does not allow opening a directory for sync. The rename remains atomic there.
  }
}

async function atomicWrite(filePath, contents) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    if (handle) await handle.close();
  }
  await fs.rename(temporaryPath, filePath);
  await fsyncDirectory(directory);
}

async function createStateStore(dataDirectory) {
  const statePath = path.join(dataDirectory, 'authority-state.json');
  const backupPath = path.join(dataDirectory, 'authority-state.backup.json');
  await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });

  let state = createEmptyState();
  let recoveredFromBackup = false;
  const stateExists = await exists(statePath);
  if (stateExists) {
    try {
      state = await readJsonFile(statePath);
    } catch (primaryError) {
      try {
        state = await readJsonFile(backupPath);
        recoveredFromBackup = true;
      } catch {
        throw new Error(`Self-hosted project authority refused to start: ${primaryError instanceof Error ? primaryError.message : 'state is unreadable'}.`);
      }
    }
  } else if (await exists(backupPath)) {
    // A backup without its primary can only arise from interrupted operator intervention. Recover it,
    // rather than silently treating an existing authority as a new empty one.
    state = await readJsonFile(backupPath);
    recoveredFromBackup = true;
  }

  let writeTail = Promise.resolve();

  async function persist(nextState) {
    const serialized = `${JSON.stringify(nextState)}\n`;
    if (await exists(statePath)) {
      const previous = await fs.readFile(statePath, 'utf8');
      await atomicWrite(backupPath, previous);
    }
    await atomicWrite(statePath, serialized);
    state = nextState;
    recoveredFromBackup = false;
  }

  function change(mutator) {
    const operation = writeTail.then(async () => {
      const result = await mutator(state);
      if (result && result.commit) await persist(result.state);
      return result?.value;
    });
    writeTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    getState: () => state,
    wasRecoveredFromBackup: () => recoveredFromBackup,
    change,
  };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function latestRevision(project) {
  return project.revisions[project.revisions.length - 1];
}

function projectMetadata(project) {
  return {
    id: project.id,
    name: project.name,
    revision: project.revision,
    updatedAt: project.updatedAt,
    revisionCount: project.revisions.length,
    storageBytes: projectStorageBytes(project),
  };
}

function publicProject(project) {
  const latest = latestRevision(project);
  let blob;
  try {
    blob = JSON.parse(latest.blob);
  } catch {
    throw new HttpFailure(503, 'corrupt-project-state', 'The stored project blob is unreadable.');
  }
  return { ...projectMetadata(project), blob };
}

function eventFor(project, mutationId) {
  return project.events.find((event) => event.mutationId === mutationId) ?? null;
}

function readBearer(request) {
  const raw = request.headers.authorization;
  if (typeof raw !== 'string') return null;
  const matched = /^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(raw);
  return matched?.[1] ?? null;
}

function authenticate(state, request, now) {
  const token = readBearer(request);
  if (!token) fail(401, 'authentication-required', 'Sign in to the self-hosted authority first.');
  const session = state.sessions[sha256(token)];
  if (!isRecord(session) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= now) {
    fail(401, 'session-expired', 'This session is unavailable or has expired.');
  }
  const account = state.accounts[session.accountId];
  if (!isRecord(account)) fail(401, 'session-expired', 'This session is unavailable or has expired.');
  return { token, tokenHash: sha256(token), session, account };
}

function requireOwnedProject(state, accountId, projectId) {
  const project = state.projects[projectId];
  if (!isRecord(project) || project.accountId !== accountId) fail(404, 'project-not-found', 'The project was not found for this account.');
  return project;
}

function safePathname(request) {
  try {
    return new URL(request.url ?? '/', 'http://localhost');
  } catch {
    fail(400, 'invalid-request', 'The request URL is invalid.');
  }
}

function sendJson(response, status, value, extraHeaders = {}) {
  if (response.writableEnded || response.destroyed) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-site',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(body);
}

function applyCors(request, response, allowedOrigins) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '') return true;
  if (!allowedOrigins.includes(origin)) {
    sendJson(response, 403, { ok: false, error: { code: 'origin-not-allowed', message: 'This browser origin is not allowed by this self-hosted authority.' } });
    return false;
  }
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Vary', 'Origin');
  return true;
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const contentLength = request.headers['content-length'];
    if (typeof contentLength === 'string' && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)) {
      reject(new HttpFailure(413, 'request-too-large', 'The request exceeds this authority’s configured limit.'));
      request.resume();
      return;
    }
    let bytes = 0;
    const chunks = [];
    request.on('aborted', () => reject(new HttpFailure(499, 'request-cancelled', 'The client cancelled the request before it was committed.')));
    request.on('error', () => reject(new HttpFailure(400, 'invalid-request', 'The request could not be read.')));
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new HttpFailure(413, 'request-too-large', 'The request exceeds this authority’s configured limit.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(raw);
        if (!isRecord(parsed)) fail(400, 'invalid-json', 'The request body must be a JSON object.');
        resolve(parsed);
      } catch (error) {
        reject(error instanceof HttpFailure ? error : new HttpFailure(400, 'invalid-json', 'The request body must be valid JSON.'));
      }
    });
  });
}

function createSelfHostedProjectAuthority(options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(isRecord(options.limits) ? options.limits : {}) };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid self-hosted sync limit: ${key}.`);
  }
  const dataDirectory = path.resolve(options.dataDirectory ?? path.join(process.cwd(), '.sloom-self-hosted-sync'));
  const allowedOrigins = Array.isArray(options.allowedOrigins)
    ? options.allowedOrigins.filter((value) => typeof value === 'string' && value.length > 0)
    : [];
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  let storePromise = createStateStore(dataDirectory);

  async function handle(request, response) {
    try {
      if (!applyCors(request, response, allowedOrigins)) return;
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }

      const url = safePathname(request);
      const method = request.method ?? 'GET';
      const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
      const store = await storePromise;
      const state = store.getState();

      if (method === 'GET' && url.pathname === '/v1/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'sloom-self-hosted-project-authority',
          stateVersion: STATE_VERSION,
          recoveredFromBackup: store.wasRecoveredFromBackup(),
          limits: {
            maxProjectBytes: limits.maxProjectBytes,
            maxAccountBytes: limits.maxAccountBytes,
            maxProjectsPerAccount: limits.maxProjectsPerAccount,
            maxRevisionsPerProject: limits.maxRevisionsPerProject,
          },
        });
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/accounts') {
        const body = await readJsonBody(request, limits.maxRequestBytes);
        const email = normalizeEmail(body.email);
        const password = requirePassword(body.password);
        const passwordRecord = await hashPassword(password);
        const account = await store.change(async (current) => {
          if (findAccountByEmail(current, email)) fail(409, 'account-exists', 'An account with this email already exists.');
          const next = cloneState(current);
          const record = { id: randomId('acct'), email, passwordSalt: passwordRecord.salt, passwordHash: passwordRecord.hash, createdAt: now() };
          next.accounts[record.id] = record;
          return { commit: true, state: next, value: record };
        });
        sendJson(response, 201, { ok: true, account: { id: account.id, email: account.email } });
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/sessions') {
        const body = await readJsonBody(request, limits.maxRequestBytes);
        const email = normalizeEmail(body.email);
        const password = requirePassword(body.password);
        const account = findAccountByEmail(state, email);
        if (!account || !(await passwordMatches(password, account))) {
          fail(401, 'invalid-credentials', 'The email or password is not valid.');
        }
        const token = crypto.randomBytes(32).toString('base64url');
        const session = await store.change(async (current) => {
          const next = cloneState(current);
          const entries = Object.entries(next.sessions)
            .filter(([, item]) => isRecord(item) && item.accountId === account.id)
            .sort(([, left], [, right]) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
          while (entries.length >= limits.maxSessionsPerAccount) {
            const [hash] = entries.shift();
            delete next.sessions[hash];
          }
          const record = { accountId: account.id, createdAt: now(), expiresAt: now() + limits.sessionTtlMs };
          next.sessions[sha256(token)] = record;
          return { commit: true, state: next, value: record };
        });
        sendJson(response, 201, { ok: true, token, expiresAt: session.expiresAt, account: { id: account.id, email: account.email } });
        return;
      }

      if (method === 'DELETE' && url.pathname === '/v1/sessions/current') {
        const auth = authenticate(state, request, now());
        await store.change(async (current) => {
          const next = cloneState(current);
          delete next.sessions[auth.tokenHash];
          return { commit: true, state: next, value: undefined };
        });
        sendJson(response, 200, { ok: true });
        return;
      }

      if (method === 'GET' && url.pathname === '/v1/projects') {
        const auth = authenticate(state, request, now());
        const projects = Object.values(state.projects)
          .filter((project) => isRecord(project) && project.accountId === auth.account.id)
          .map(projectMetadata)
          .sort((left, right) => right.updatedAt - left.updatedAt);
        sendJson(response, 200, { ok: true, projects });
        return;
      }

      if (method === 'POST' && url.pathname === '/v1/projects') {
        const auth = authenticate(state, request, now());
        const body = await readJsonBody(request, limits.maxRequestBytes);
        const id = requireIdentifier(body.id, 'project-id');
        const name = requireName(body.name);
        const blob = bodyBlob(body.blob, limits.maxProjectBytes);
        const project = await store.change(async (current) => {
          if (own(current.projects, id)) fail(409, 'project-exists', 'A project with this id already exists.');
          if (projectCount(current, auth.account.id) >= limits.maxProjectsPerAccount) {
            fail(413, 'project-quota-exceeded', 'This account has reached its project limit.');
          }
          if (accountStorageBytes(current, auth.account.id) + blob.bytes > limits.maxAccountBytes) {
            fail(413, 'storage-quota-exceeded', 'This account has reached its retained project storage limit.');
          }
          const next = cloneState(current);
          const timestamp = now();
          const revision = { revision: 1, blob: blob.serialized, bytes: blob.bytes, createdAt: timestamp, mutationId: null };
          const record = {
            id,
            accountId: auth.account.id,
            name,
            revision: 1,
            createdAt: timestamp,
            updatedAt: timestamp,
            revisions: [revision],
            events: [{ revision: 1, kind: 'created', mutationId: null, createdAt: timestamp, digest: sha256(blob.serialized) }],
          };
          next.projects[id] = record;
          return { commit: true, state: next, value: record };
        });
        sendJson(response, 201, { ok: true, project: publicProject(project) });
        return;
      }

      if (segments.length >= 3 && segments[0] === 'v1' && segments[1] === 'projects') {
        const projectId = requireIdentifier(segments[2], 'project-id');
        const auth = authenticate(state, request, now());

        if (method === 'GET' && segments.length === 3) {
          sendJson(response, 200, { ok: true, project: publicProject(requireOwnedProject(state, auth.account.id, projectId)) });
          return;
        }

        if (method === 'GET' && segments.length === 4 && segments[3] === 'events') {
          const project = requireOwnedProject(state, auth.account.id, projectId);
          const afterRaw = url.searchParams.get('after') ?? '0';
          const after = Number(afterRaw);
          if (!Number.isSafeInteger(after) || after < 0) fail(400, 'invalid-after-revision', 'after must be a non-negative integer.');
          const oldest = project.events[0]?.revision ?? project.revision;
          sendJson(response, 200, {
            ok: true,
            latestRevision: project.revision,
            gap: after > 0 && after < oldest - 1,
            events: project.events.filter((event) => event.revision > after),
          });
          return;
        }

        if (method === 'GET' && segments.length === 5 && segments[3] === 'revisions') {
          const requestedRevision = requireRevision(Number(segments[4]));
          const project = requireOwnedProject(state, auth.account.id, projectId);
          const revision = project.revisions.find((entry) => entry.revision === requestedRevision);
          if (!revision) fail(404, 'revision-not-retained', 'That project revision is not retained by this authority.');
          sendJson(response, 200, { ok: true, projectId, revision: revision.revision, blob: JSON.parse(revision.blob), createdAt: revision.createdAt });
          return;
        }

        if (method === 'PUT' && segments.length === 3) {
          const body = await readJsonBody(request, limits.maxRequestBytes);
          const baseRevision = requireRevision(body.baseRevision);
          const mutationId = requireMutationId(body.mutationId);
          const blob = bodyBlob(body.blob, limits.maxProjectBytes);
          const name = body.name === undefined ? undefined : requireName(body.name);
          const result = await store.change(async (current) => {
            const project = requireOwnedProject(current, auth.account.id, projectId);
            const priorEvent = eventFor(project, mutationId);
            if (priorEvent) {
              return { commit: false, value: { replayed: true, revision: priorEvent.revision } };
            }
            if (baseRevision !== project.revision) {
              return { commit: false, value: { conflict: true, revision: project.revision } };
            }
            const next = cloneState(current);
            const writable = next.projects[projectId];
            const timestamp = now();
            const nextRevision = writable.revision + 1;
            const revisions = [...writable.revisions, {
              revision: nextRevision,
              blob: blob.serialized,
              bytes: blob.bytes,
              createdAt: timestamp,
              mutationId,
            }];
            while (revisions.length > limits.maxRevisionsPerProject) revisions.shift();
            const prospective = { ...writable, revisions };
            const retainedDelta = projectStorageBytes(prospective) - projectStorageBytes(writable);
            if (accountStorageBytes(current, auth.account.id) + retainedDelta > limits.maxAccountBytes) {
              fail(413, 'storage-quota-exceeded', 'This account has reached its retained project storage limit.');
            }
            writable.name = name ?? writable.name;
            writable.revision = nextRevision;
            writable.updatedAt = timestamp;
            writable.revisions = revisions;
            writable.events = [...writable.events, {
              revision: nextRevision,
              kind: 'updated',
              mutationId,
              createdAt: timestamp,
              digest: sha256(blob.serialized),
            }];
            while (writable.events.length > limits.maxEventsPerProject) writable.events.shift();
            return { commit: true, state: next, value: { replayed: false, revision: nextRevision } };
          });
          if (result.conflict) {
            sendJson(response, 409, { ok: false, error: { code: 'revision-conflict', message: 'The remote project changed. Recover the current revision before retrying.', currentRevision: result.revision } });
            return;
          }
          sendJson(response, 200, { ok: true, projectId, revision: result.revision, replayed: result.replayed });
          return;
        }
      }

      fail(404, 'not-found', 'This self-hosted authority route does not exist.');
    } catch (error) {
      if (error instanceof HttpFailure) {
        sendJson(response, error.status, { ok: false, error: { code: error.code, message: error.message } });
        return;
      }
      sendJson(response, 500, { ok: false, error: { code: 'authority-unavailable', message: 'The self-hosted authority could not complete this request.' } });
    }
  }

  const server = http.createServer((request, response) => { void handle(request, response); });

  return {
    server,
    dataDirectory,
    async listen(port = 8787, host = '127.0.0.1') {
      await storePromise;
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Self-hosted authority did not bind a TCP address.');
      return { host: address.address, port: address.port, url: `http://${address.address}:${address.port}` };
    },
    async close() {
      if (!server.listening) return;
      // A deliberately cancelled HTTP request can leave a keep-alive socket in Node's idle pool.
      // Closing an operator-owned authority must not wait for that client-side timeout.
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function runCli() {
  const authority = createSelfHostedProjectAuthority({
    dataDirectory: process.env.SLOOM_SELF_HOSTED_SYNC_DIR,
    allowedOrigins: (process.env.SLOOM_SELF_HOSTED_SYNC_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
  });
  const port = Number(process.env.SLOOM_SELF_HOSTED_SYNC_PORT ?? 8787);
  const host = process.env.SLOOM_SELF_HOSTED_SYNC_HOST ?? '127.0.0.1';
  const address = await authority.listen(port, host);
  process.stdout.write(`Sloom self-hosted project authority listening on ${address.url}\n`);
  const stop = async () => {
    await authority.close();
    process.exit(0);
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}

module.exports = { DEFAULT_LIMITS, createSelfHostedProjectAuthority };

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
