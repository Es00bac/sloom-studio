export interface VertexServiceAccountCredential {
  clientEmail: string;
  privateKey: string;
  projectId: string;
  tokenUri: string;
}

export interface ParseServiceAccountResult {
  ok: boolean;
  credential?: VertexServiceAccountCredential;
  error?: string;
}

export type VertexCredentialType = 'service_account' | 'authorized_user' | 'external_account' | 'impersonated_service_account';

export interface ParseVertexCredentialResult {
  ok: boolean;
  type?: VertexCredentialType;
  projectId?: string;
  quotaProjectId?: string;
  account?: string;
  data?: Record<string, unknown>;
  error?: string;
}

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';

export function parseVertexCredentialJson(raw: string): ParseVertexCredentialResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'Could not parse ADC credential JSON. Choose or paste the full JSON file.' };
  }

  const type = typeof data.type === 'string' ? data.type : '';
  if (!['service_account', 'authorized_user', 'external_account', 'impersonated_service_account'].includes(type)) {
    return { ok: false, error: `Unsupported ADC credential type: ${type || 'missing type'}.` };
  }

  if (type === 'service_account') {
    const parsed = parseServiceAccountJson(raw);
    if (!parsed.ok || !parsed.credential) return { ok: false, error: parsed.error };
  }
  if (type === 'authorized_user') {
    for (const field of ['client_id', 'client_secret', 'refresh_token']) {
      if (typeof data[field] !== 'string' || !String(data[field]).trim()) {
        return { ok: false, error: `Authorized-user ADC credentials are missing ${field}.` };
      }
    }
  }

  const projectId = typeof data.project_id === 'string' && data.project_id.trim()
    ? data.project_id.trim()
    : undefined;
  const quotaProjectId = typeof data.quota_project_id === 'string' && data.quota_project_id.trim()
    ? data.quota_project_id.trim()
    : undefined;
  const account = typeof data.account === 'string' && data.account.trim()
    ? data.account.trim()
    : typeof data.client_email === 'string' && data.client_email.trim() ? data.client_email.trim() : undefined;
  return {
    ok: true,
    type: type as VertexCredentialType,
    projectId,
    quotaProjectId,
    account,
    data,
  };
}

export function parseServiceAccountJson(raw: string): ParseServiceAccountResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'Could not parse service-account JSON. Paste the full key file contents.' };
  }

  if (data.type !== 'service_account') {
    return { ok: false, error: 'Expected a service_account key (the "type" field must be "service_account").' };
  }

  const clientEmail = typeof data.client_email === 'string' ? data.client_email.trim() : '';
  if (!clientEmail) {
    return { ok: false, error: 'Service-account key is missing client_email.' };
  }

  const privateKey = typeof data.private_key === 'string' ? data.private_key : '';
  if (!privateKey.includes('PRIVATE KEY')) {
    return { ok: false, error: 'Service-account key is missing a valid private_key (PEM).' };
  }

  const projectId = typeof data.project_id === 'string' ? data.project_id.trim() : '';
  if (!projectId) {
    return { ok: false, error: 'Service-account key is missing project_id.' };
  }

  const tokenUri = typeof data.token_uri === 'string' && data.token_uri.trim()
    ? data.token_uri.trim()
    : DEFAULT_TOKEN_URI;

  return { ok: true, credential: { clientEmail, privateKey, projectId, tokenUri } };
}

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_LIFETIME_SECONDS = 3600;
const REFRESH_SKEW_MS = 60_000;

export interface MintedAccessToken {
  accessToken: string;
  expiresAt: number;
}

export interface MintAccessTokenDeps {
  subtle?: SubtleCrypto;
  fetch?: typeof fetch;
  now?: () => number;
}

function base64UrlFromString(value: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(value));
}

function base64UrlFromBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function mintAccessToken(
  credential: VertexServiceAccountCredential,
  deps: MintAccessTokenDeps = {},
): Promise<MintedAccessToken> {
  const subtle = deps.subtle ?? globalThis.crypto?.subtle;
  const doFetch = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  if (!subtle) {
    throw new Error('WebCrypto SubtleCrypto is unavailable in this runtime.');
  }

  const issuedAt = Math.floor(now() / 1000);
  const header = base64UrlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlFromString(JSON.stringify({
    iss: credential.clientEmail,
    sub: credential.clientEmail,
    scope: SCOPE,
    aud: credential.tokenUri,
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  }));
  const signingInput = `${header}.${claims}`;

  const key = await subtle.importKey(
    'pkcs8',
    pemToPkcs8(credential.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const assertion = `${signingInput}.${base64UrlFromBytes(signature)}`;

  const response = await doFetch(credential.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Vertex token exchange failed (${response.status}). ${detail}`.trim());
  }

  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error('Vertex token exchange returned no access_token.');
  }

  const lifetimeSeconds = typeof payload.expires_in === 'number' ? payload.expires_in : TOKEN_LIFETIME_SECONDS;
  return { accessToken: payload.access_token, expiresAt: now() + lifetimeSeconds * 1000 };
}

const tokenCache = new Map<string, MintedAccessToken>();

export function clearVertexTokenCache(): void {
  tokenCache.clear();
}

export async function getServiceAccountAccessToken(
  raw: string,
  deps: MintAccessTokenDeps = {},
): Promise<MintedAccessToken> {
  const parsed = parseServiceAccountJson(raw);
  if (!parsed.ok || !parsed.credential) {
    throw new Error(parsed.error ?? 'Invalid service-account JSON.');
  }

  const now = deps.now ?? Date.now;
  const cacheKey = parsed.credential.clientEmail;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > now()) {
    return cached;
  }

  const minted = await mintAccessToken(parsed.credential, deps);
  tokenCache.set(cacheKey, minted);
  return minted;
}

export async function getVertexCredentialAccessToken(
  raw: string,
  deps: MintAccessTokenDeps = {},
): Promise<MintedAccessToken> {
  const parsed = parseVertexCredentialJson(raw);
  if (!parsed.ok || !parsed.type || !parsed.data) {
    throw new Error(parsed.error ?? 'Invalid ADC credential JSON.');
  }
  if (parsed.type === 'service_account') {
    return getServiceAccountAccessToken(raw, deps);
  }
  if (parsed.type !== 'authorized_user') {
    throw new Error(`${parsed.type} credentials require the Sloom Studio desktop ADC broker.`);
  }

  const clientId = String(parsed.data.client_id);
  const clientSecret = String(parsed.data.client_secret);
  const refreshToken = String(parsed.data.refresh_token);
  const tokenUri = typeof parsed.data.token_uri === 'string' && parsed.data.token_uri.trim()
    ? parsed.data.token_uri.trim()
    : DEFAULT_TOKEN_URI;
  const now = deps.now ?? Date.now;
  const cacheKey = `authorized_user:${clientId}:${refreshToken}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - REFRESH_SKEW_MS > now()) return cached;

  const doFetch = deps.fetch ?? globalThis.fetch;
  const response = await doFetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Vertex authorized-user token refresh failed (${response.status}). ${detail}`.trim());
  }
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error('Vertex authorized-user token refresh returned no access_token.');
  const minted = {
    accessToken: payload.access_token,
    expiresAt: now() + (typeof payload.expires_in === 'number' ? payload.expires_in : TOKEN_LIFETIME_SECONDS) * 1000,
  };
  tokenCache.set(cacheKey, minted);
  return minted;
}
