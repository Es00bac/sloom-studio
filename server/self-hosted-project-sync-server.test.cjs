'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createSelfHostedProjectAuthority } = require('./self-hosted-project-sync-server.cjs');

const PASSWORD = 'correct horse battery staple';

async function makeDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'sloom-self-hosted-sync-'));
}

async function startAuthority(dataDirectory, options = {}) {
  const authority = createSelfHostedProjectAuthority({ dataDirectory, ...options });
  const address = await authority.listen(0, '127.0.0.1');
  return { authority, baseUrl: address.url };
}

async function call(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: await response.json() };
}

async function registerAndLogin(baseUrl, email) {
  const registered = await call(baseUrl, '/v1/accounts', { method: 'POST', body: { email, password: PASSWORD } });
  assert.equal(registered.status, 201);
  const session = await call(baseUrl, '/v1/sessions', { method: 'POST', body: { email, password: PASSWORD } });
  assert.equal(session.status, 201);
  assert.equal(typeof session.body.token, 'string');
  return session.body.token;
}

test('two authenticated clients resolve optimistic conflicts, resume from the log, and survive a cold restart', async (t) => {
  const dataDirectory = await makeDirectory();
  t.after(async () => fs.rm(dataDirectory, { recursive: true, force: true }));

  let running = await startAuthority(dataDirectory);
  t.after(async () => running.authority.close());

  const health = await call(running.baseUrl, '/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.service, 'sloom-self-hosted-project-authority');
  assert.equal(health.body.recoveredFromBackup, false);

  const clientA = await registerAndLogin(running.baseUrl, 'artist@example.test');
  const secondSession = await call(running.baseUrl, '/v1/sessions', {
    method: 'POST', body: { email: 'artist@example.test', password: PASSWORD },
  });
  assert.equal(secondSession.status, 201);
  const clientB = secondSession.body.token;

  const created = await call(running.baseUrl, '/v1/projects', {
    method: 'POST',
    token: clientA,
    body: { id: 'project-sync-demo', name: 'Sync demo', blob: { title: 'seed', frames: [1] } },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.project.revision, 1);

  const foreignClient = await registerAndLogin(running.baseUrl, 'other-artist@example.test');
  const foreignRead = await call(running.baseUrl, '/v1/projects/project-sync-demo', { token: foreignClient });
  assert.equal(foreignRead.status, 404);

  const clientBSeed = await call(running.baseUrl, '/v1/projects/project-sync-demo', { token: clientB });
  assert.equal(clientBSeed.status, 200);
  assert.equal(clientBSeed.body.project.revision, 1);

  const clientBWrite = await call(running.baseUrl, '/v1/projects/project-sync-demo', {
    method: 'PUT', token: clientB,
    body: { baseRevision: 1, mutationId: 'client-b-update-1', blob: { title: 'from B', frames: [1, 2] } },
  });
  assert.deepEqual(clientBWrite, { status: 200, body: { ok: true, projectId: 'project-sync-demo', revision: 2, replayed: false } });

  const staleClientAWrite = await call(running.baseUrl, '/v1/projects/project-sync-demo', {
    method: 'PUT', token: clientA,
    body: { baseRevision: 1, mutationId: 'client-a-stale', blob: { title: 'stale overwrite' } },
  });
  assert.equal(staleClientAWrite.status, 409);
  assert.equal(staleClientAWrite.body.error.code, 'revision-conflict');
  assert.equal(staleClientAWrite.body.error.currentRevision, 2);

  const recovered = await call(running.baseUrl, '/v1/projects/project-sync-demo', { token: clientA });
  assert.equal(recovered.body.project.revision, 2);
  assert.deepEqual(recovered.body.project.blob, { title: 'from B', frames: [1, 2] });

  const resumedClientAWrite = await call(running.baseUrl, '/v1/projects/project-sync-demo', {
    method: 'PUT', token: clientA,
    body: { baseRevision: recovered.body.project.revision, mutationId: 'client-a-resumed-2', blob: { title: 'recovered then A', frames: [1, 2, 3] } },
  });
  assert.equal(resumedClientAWrite.status, 200);
  assert.equal(resumedClientAWrite.body.revision, 3);

  const idempotentRetry = await call(running.baseUrl, '/v1/projects/project-sync-demo', {
    method: 'PUT', token: clientA,
    body: { baseRevision: 2, mutationId: 'client-a-resumed-2', blob: { title: 'retry must not overwrite' } },
  });
  assert.deepEqual(idempotentRetry, { status: 200, body: { ok: true, projectId: 'project-sync-demo', revision: 3, replayed: true } });

  const events = await call(running.baseUrl, '/v1/projects/project-sync-demo/events?after=0', { token: clientB });
  assert.equal(events.status, 200);
  assert.deepEqual(events.body.events.map((event) => event.revision), [1, 2, 3]);
  assert.equal(events.body.gap, false);

  await running.authority.close();
  running = await startAuthority(dataDirectory);

  const restartHealth = await call(running.baseUrl, '/v1/health');
  assert.equal(restartHealth.body.recoveredFromBackup, false);
  const afterRestart = await call(running.baseUrl, '/v1/projects/project-sync-demo', { token: clientB });
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.body.project.revision, 3);
  assert.deepEqual(afterRestart.body.project.blob, { title: 'recovered then A', frames: [1, 2, 3] });

  const retainedRevision = await call(running.baseUrl, '/v1/projects/project-sync-demo/revisions/2', { token: clientB });
  assert.equal(retainedRevision.status, 200);
  assert.deepEqual(retainedRevision.body.blob, { title: 'from B', frames: [1, 2] });

  const loggedOut = await call(running.baseUrl, '/v1/sessions/current', { method: 'DELETE', token: clientA });
  assert.equal(loggedOut.status, 200);
  const refusedAfterLogout = await call(running.baseUrl, '/v1/projects', { token: clientA });
  assert.equal(refusedAfterLogout.status, 401);
});

test('the authority refuses oversized and cancelled writes without a partial project mutation', async (t) => {
  const dataDirectory = await makeDirectory();
  t.after(async () => fs.rm(dataDirectory, { recursive: true, force: true }));
  const running = await startAuthority(dataDirectory, {
    limits: { maxRequestBytes: 4096, maxProjectBytes: 96, maxAccountBytes: 160, maxRevisionsPerProject: 2 },
  });
  t.after(async () => running.authority.close());
  const token = await registerAndLogin(running.baseUrl, 'bounded@example.test');

  const rejectedOrigin = await call(running.baseUrl, '/v1/health', { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(rejectedOrigin.status, 403);
  assert.equal(rejectedOrigin.body.error.code, 'origin-not-allowed');

  const tooLarge = await call(running.baseUrl, '/v1/projects', {
    method: 'POST', token,
    body: { id: 'too-large', name: 'Too large', blob: { text: 'x'.repeat(200) } },
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.error.code, 'project-too-large');

  const created = await call(running.baseUrl, '/v1/projects', {
    method: 'POST', token,
    body: { id: 'cancel-demo', name: 'Cancel demo', blob: { text: 'seed' } },
  });
  assert.equal(created.status, 201);

  const partialBody = JSON.stringify({
    baseRevision: 1,
    mutationId: 'cancelled-write',
    blob: { text: 'this must never be committed' },
  });
  const target = new URL('/v1/projects/cancel-demo', running.baseUrl);
  const request = http.request({
    host: target.hostname,
    port: target.port,
    path: target.pathname,
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(partialBody),
    },
  });
  request.on('error', () => undefined);
  request.write(partialBody.slice(0, 20));
  request.destroy();
  await new Promise((resolve) => request.once('close', resolve));

  const afterCancel = await call(running.baseUrl, '/v1/projects/cancel-demo', { token });
  assert.equal(afterCancel.status, 200);
  assert.equal(afterCancel.body.project.revision, 1);
  assert.deepEqual(afterCancel.body.project.blob, { text: 'seed' });
  const files = await fs.readdir(dataDirectory);
  assert.equal(files.some((name) => name.endsWith('.tmp')), false);
});

test('a corrupt primary state recovers from the last atomically retained backup instead of creating a new authority', async (t) => {
  const dataDirectory = await makeDirectory();
  t.after(async () => fs.rm(dataDirectory, { recursive: true, force: true }));
  let running = await startAuthority(dataDirectory);
  const token = await registerAndLogin(running.baseUrl, 'recovery@example.test');
  const created = await call(running.baseUrl, '/v1/projects', {
    method: 'POST', token,
    body: { id: 'recovery-demo', name: 'Recovery demo', blob: { version: 1 } },
  });
  assert.equal(created.status, 201);
  // Advance the authority once so the atomically retained backup contains the accepted project,
  // rather than the immediately preceding pre-create state.
  const secondSession = await call(running.baseUrl, '/v1/sessions', {
    method: 'POST', body: { email: 'recovery@example.test', password: PASSWORD },
  });
  assert.equal(secondSession.status, 201);
  await running.authority.close();

  await fs.writeFile(path.join(dataDirectory, 'authority-state.json'), '{ this is not valid JSON', 'utf8');
  running = await startAuthority(dataDirectory);
  t.after(async () => running.authority.close());
  const health = await call(running.baseUrl, '/v1/health');
  assert.equal(health.body.recoveredFromBackup, true);
  const restored = await call(running.baseUrl, '/v1/projects/recovery-demo', { token });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body.project.blob, { version: 1 });
});
