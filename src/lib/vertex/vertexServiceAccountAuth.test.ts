import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseServiceAccountJson,
  mintAccessToken,
  getServiceAccountAccessToken,
  clearVertexTokenCache,
  getVertexCredentialAccessToken,
  parseVertexCredentialJson,
} from './vertexServiceAccountAuth';

const VALID = JSON.stringify({
  type: 'service_account',
  project_id: 'proj-1',
  client_email: 'svc@proj-1.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n',
  token_uri: 'https://oauth2.googleapis.com/token',
});

describe('parseServiceAccountJson', () => {
  it('parses a valid service-account key', () => {
    const result = parseServiceAccountJson(VALID);
    expect(result.ok).toBe(true);
    expect(result.credential).toMatchObject({
      clientEmail: 'svc@proj-1.iam.gserviceaccount.com',
      projectId: 'proj-1',
      tokenUri: 'https://oauth2.googleapis.com/token',
    });
  });

  it('defaults token_uri when absent', () => {
    const raw = JSON.parse(VALID);
    delete raw.token_uri;
    const result = parseServiceAccountJson(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    expect(result.credential?.tokenUri).toBe('https://oauth2.googleapis.com/token');
  });

  it('rejects invalid JSON', () => {
    const result = parseServiceAccountJson('{ not json');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/parse|json/i);
  });

  it('rejects a non-service-account type', () => {
    const raw = JSON.parse(VALID);
    raw.type = 'authorized_user';
    const result = parseServiceAccountJson(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/service_account/);
  });

  it('rejects when client_email is missing', () => {
    const raw = JSON.parse(VALID);
    delete raw.client_email;
    const result = parseServiceAccountJson(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/client_email/);
  });

  it('rejects when private_key is not a PEM key', () => {
    const raw = JSON.parse(VALID);
    raw.private_key = 'nope';
    const result = parseServiceAccountJson(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private_key/);
  });

  it('rejects when project_id is missing', () => {
    const raw = JSON.parse(VALID);
    delete raw.project_id;
    const result = parseServiceAccountJson(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/project_id/);
  });
});

const CRED = {
  clientEmail: 'svc@proj-1.iam.gserviceaccount.com',
  privateKey: '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASCAUAwggE8AgEAAkEA\n-----END PRIVATE KEY-----\n',
  projectId: 'proj-1',
  tokenUri: 'https://oauth2.googleapis.com/token',
};

function fakeDeps(overrides: Record<string, unknown> = {}) {
  const subtle = {
    importKey: vi.fn().mockResolvedValue({} as CryptoKey),
    sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
  } as unknown as SubtleCrypto;
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: 'ya29.token', expires_in: 3600 }),
    text: async () => '',
  });
  return { subtle, fetch: fetchMock as unknown as typeof fetch, now: () => 1_000_000, ...overrides };
}

describe('mintAccessToken', () => {
  beforeEach(() => clearVertexTokenCache());

  it('signs a JWT and exchanges it for an access token', async () => {
    const deps = fakeDeps();
    const result = await mintAccessToken(CRED, deps);
    expect(result.accessToken).toBe('ya29.token');
    expect(result.expiresAt).toBe(1_000_000 + 3600 * 1000);

    const [url, init] = (deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(CRED.tokenUri);
    const body = String((init as RequestInit).body);
    expect(body).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
    expect(body).toContain('assertion=');
    const assertion = new URLSearchParams(body).get('assertion') ?? '';
    expect(assertion.split('.')).toHaveLength(3);
  });

  it('surfaces a token-exchange error', async () => {
    const deps = fakeDeps({
      fetch: vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }), text: async () => 'invalid_grant' }),
    });
    await expect(mintAccessToken(CRED, deps)).rejects.toThrow(/invalid_grant|token/i);
  });
});

describe('getServiceAccountAccessToken cache', () => {
  beforeEach(() => clearVertexTokenCache());

  it('caches a token and re-mints when near expiry', async () => {
    let clock = 1_000_000;
    const deps = fakeDeps({ now: () => clock });
    const raw = JSON.stringify({
      type: 'service_account', project_id: CRED.projectId,
      client_email: CRED.clientEmail, private_key: CRED.privateKey, token_uri: CRED.tokenUri,
    });

    await getServiceAccountAccessToken(raw, deps);
    await getServiceAccountAccessToken(raw, deps);
    expect((deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);

    clock += 3600 * 1000;
    await getServiceAccountAccessToken(raw, deps);
    expect((deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

describe('authorized-user ADC credentials', () => {
  beforeEach(() => clearVertexTokenCache());

  it('parses and refreshes an authorized_user ADC file without a service-account key', async () => {
    const raw = JSON.stringify({
      type: 'authorized_user',
      client_id: 'client.apps.googleusercontent.com',
      client_secret: 'secret',
      refresh_token: 'refresh',
      quota_project_id: 'billing-project',
    });
    expect(parseVertexCredentialJson(raw)).toMatchObject({
      ok: true,
      type: 'authorized_user',
      quotaProjectId: 'billing-project',
    });
    const deps = fakeDeps();
    const result = await getVertexCredentialAccessToken(raw, deps);
    expect(result.accessToken).toBe('ya29.token');
    const [url, init] = (deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(String((init as RequestInit).body)).toContain('grant_type=refresh_token');
  });
});
