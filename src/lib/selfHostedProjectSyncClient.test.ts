import { describe, expect, it } from 'vitest';
import {
  SelfHostedProjectSyncClient,
  SelfHostedProjectSyncError,
} from './selfHostedProjectSyncClient';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  serialized(): string {
    return [...this.values.values()].join('\n');
  }
}

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('SelfHostedProjectSyncClient', () => {
  it('fails closed without a configured authority', async () => {
    const client = new SelfHostedProjectSyncClient({ localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });

    await expect(client.health()).rejects.toMatchObject({
      code: 'self-hosted-sync-unavailable',
      status: 503,
    } satisfies Partial<SelfHostedProjectSyncError>);
  });

  it('keeps bearer sessions out of durable retry storage and resumes a queued mutation with its stable id', async () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    let online = true;
    let receivedMutationId = '';
    const client = new SelfHostedProjectSyncClient({
      localStorage: local,
      sessionStorage: session,
      now: () => 100,
      fetch: async (input, init) => {
        if (input.endsWith('/v1/sessions')) {
          return json({ ok: true, token: 'secret-session-token', expiresAt: 1_000, account: { id: 'acct_1', email: 'artist@example.test' } }, 201);
        }
        if (input.endsWith('/v1/projects/project_1') && init?.method === 'PUT') {
          if (!online) throw new TypeError('network unavailable');
          const payload = JSON.parse(String(init.body)) as { mutationId: string };
          receivedMutationId = payload.mutationId;
          return json({ ok: true, projectId: 'project_1', revision: 2, replayed: false });
        }
        throw new Error(`Unexpected request ${input}`);
      },
    });
    client.setConfiguration({ endpoint: 'http://127.0.0.1:8787/' });
    await client.signIn('artist@example.test', 'correct horse battery staple');

    online = false;
    await expect(client.updateProject({ projectId: 'project_1', baseRevision: 1, blob: { title: 'queued' }, mutationId: 'stable-retry-1' }))
      .rejects.toMatchObject({ code: 'authority-unavailable' } satisfies Partial<SelfHostedProjectSyncError>);
    expect(client.pendingMutations()).toHaveLength(1);
    expect(local.serialized()).not.toContain('secret-session-token');
    expect(session.serialized()).toContain('secret-session-token');

    online = true;
    await expect(client.resumePending()).resolves.toEqual([
      { mutationId: 'stable-retry-1', status: 'applied', revision: 2 },
    ]);
    expect(receivedMutationId).toBe('stable-retry-1');
    expect(client.pendingMutations()).toEqual([]);
  });
});
