/**
 * Browser client for the repository-contained self-hosted project authority.
 *
 * This client never falls back to a hosted service or to an unannounced local overwrite. Remote
 * work is unavailable until an operator configures an endpoint and signs in. Pending retry data
 * deliberately excludes session tokens; sessions are held only in browser session storage.
 */

const CONFIG_STORAGE_KEY = 'sloom.self-hosted-project-sync.config.v1';
const SESSION_STORAGE_KEY = 'sloom.self-hosted-project-sync.session.v1';
const PENDING_STORAGE_KEY = 'sloom.self-hosted-project-sync.pending.v1';

export interface SelfHostedProjectSyncConfig {
  endpoint: string;
}

export interface SelfHostedProjectSession {
  token: string;
  expiresAt: number;
  account: {
    id: string;
    email: string;
  };
}

export interface SelfHostedProjectRecord<TBlob = unknown> {
  id: string;
  name: string;
  revision: number;
  updatedAt: number;
  revisionCount: number;
  storageBytes: number;
  blob: TBlob;
}

export interface SelfHostedProjectEvent {
  revision: number;
  kind: 'created' | 'updated';
  mutationId: string | null;
  createdAt: number;
  digest: string;
}

export interface PendingSelfHostedProjectMutation<TBlob = unknown> {
  projectId: string;
  name?: string;
  baseRevision: number;
  mutationId: string;
  blob: TBlob;
  queuedAt: number;
}

export class SelfHostedProjectSyncError extends Error {
  readonly code: string;
  readonly status: number;
  readonly currentRevision: number | undefined;

  constructor(
    code: string,
    message: string,
    status = 503,
    currentRevision?: number,
  ) {
    super(message);
    this.name = 'SelfHostedProjectSyncError';
    this.code = code;
    this.status = status;
    this.currentRevision = currentRevision;
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

interface ClientDependencies {
  fetch?: FetchLike;
  localStorage?: StorageLike | null;
  sessionStorage?: StorageLike | null;
  now?: () => number;
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window[kind];
  } catch {
    return null;
  }
}

function parseStored<T>(storage: StorageLike | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeStored(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  storage.setItem(key, JSON.stringify(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSession(value: unknown): value is SelfHostedProjectSession {
  return isRecord(value)
    && typeof value.token === 'string'
    && typeof value.expiresAt === 'number'
    && isRecord(value.account)
    && typeof value.account.id === 'string'
    && typeof value.account.email === 'string';
}

function normalizeEndpoint(rawEndpoint: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawEndpoint.trim());
  } catch {
    throw new SelfHostedProjectSyncError('invalid-endpoint', 'Enter an http:// or https:// self-hosted authority URL.', 400);
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new SelfHostedProjectSyncError('invalid-endpoint', 'Enter an http:// or https:// authority URL without credentials or query text.', 400);
  }
  return parsed.toString().replace(/\/$/, '');
}

function createMutationId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `sync-${random}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
}

export class SelfHostedProjectSyncClient {
  private readonly fetcher: FetchLike | undefined;
  private readonly local: StorageLike | null;
  private readonly session: StorageLike | null;
  private readonly now: () => number;

  constructor(dependencies: ClientDependencies = {}) {
    this.fetcher = dependencies.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) as FetchLike : undefined);
    this.local = dependencies.localStorage === undefined ? browserStorage('localStorage') : dependencies.localStorage;
    this.session = dependencies.sessionStorage === undefined ? browserStorage('sessionStorage') : dependencies.sessionStorage;
    this.now = dependencies.now ?? Date.now;
  }

  getConfiguration(): SelfHostedProjectSyncConfig | null {
    const config = parseStored<SelfHostedProjectSyncConfig>(this.local, CONFIG_STORAGE_KEY);
    if (!config || typeof config.endpoint !== 'string') return null;
    try {
      return { endpoint: normalizeEndpoint(config.endpoint) };
    } catch {
      return null;
    }
  }

  setConfiguration(config: SelfHostedProjectSyncConfig): SelfHostedProjectSyncConfig {
    const normalized = { endpoint: normalizeEndpoint(config.endpoint) };
    writeStored(this.local, CONFIG_STORAGE_KEY, normalized);
    return normalized;
  }

  clearConfiguration(): void {
    this.local?.removeItem(CONFIG_STORAGE_KEY);
    this.clearSession();
  }

  getSession(): SelfHostedProjectSession | null {
    const session = parseStored<unknown>(this.session, SESSION_STORAGE_KEY);
    if (!isSession(session) || session.expiresAt <= this.now()) {
      this.clearSession();
      return null;
    }
    return session;
  }

  clearSession(): void {
    this.session?.removeItem(SESSION_STORAGE_KEY);
  }

  isReady(): boolean {
    return this.getConfiguration() !== null && this.getSession() !== null;
  }

  async health(signal?: AbortSignal): Promise<{ recoveredFromBackup: boolean }> {
    const result = await this.request('/v1/health', { signal });
    if (!isRecord(result) || result.ok !== true || typeof result.recoveredFromBackup !== 'boolean') {
      throw new SelfHostedProjectSyncError('invalid-authority-response', 'The self-hosted authority returned an invalid health response.');
    }
    return { recoveredFromBackup: result.recoveredFromBackup };
  }

  async register(email: string, password: string, signal?: AbortSignal): Promise<void> {
    const result = await this.request('/v1/accounts', { method: 'POST', body: { email, password }, signal });
    if (!isRecord(result) || result.ok !== true) {
      throw new SelfHostedProjectSyncError('invalid-authority-response', 'The self-hosted authority returned an invalid account response.');
    }
  }

  async signIn(email: string, password: string, signal?: AbortSignal): Promise<SelfHostedProjectSession> {
    const result = await this.request('/v1/sessions', { method: 'POST', body: { email, password }, signal });
    if (!isRecord(result) || result.ok !== true || !isSession(result)) {
      throw new SelfHostedProjectSyncError('invalid-authority-response', 'The self-hosted authority returned an invalid session response.');
    }
    writeStored(this.session, SESSION_STORAGE_KEY, result);
    return result;
  }

  async signOut(signal?: AbortSignal): Promise<void> {
    if (this.getSession()) {
      await this.request('/v1/sessions/current', { method: 'DELETE', authenticated: true, signal });
    }
    this.clearSession();
  }

  async listProjects(signal?: AbortSignal): Promise<Array<Omit<SelfHostedProjectRecord, 'blob'>>> {
    const result = await this.request('/v1/projects', { authenticated: true, signal });
    if (!isRecord(result) || result.ok !== true || !Array.isArray(result.projects)) {
      throw new SelfHostedProjectSyncError('invalid-authority-response', 'The self-hosted authority returned an invalid project list.');
    }
    return result.projects as Array<Omit<SelfHostedProjectRecord, 'blob'>>;
  }

  async fetchProject<TBlob = unknown>(projectId: string, signal?: AbortSignal): Promise<SelfHostedProjectRecord<TBlob>> {
    const result = await this.request(`/v1/projects/${encodeURIComponent(projectId)}`, { authenticated: true, signal });
    if (!isRecord(result) || result.ok !== true || !isRecord(result.project)) {
      throw new SelfHostedProjectSyncError('invalid-authority-response', 'The self-hosted authority returned an invalid project record.');
    }
    return result.project as unknown as SelfHostedProjectRecord<TBlob>;
  }

  async createProject<TBlob>(input: { id: string; name: string; blob: TBlob; signal?: AbortSignal }): Promise<SelfHostedProjectRecord<TBlob>> {
    const result = await this.request('/v1/projects', {
      method: 'POST', authenticated: true, body: { id: input.id, name: input.name, blob: input.blob }, signal: input.signal,
    });
    if (!isRecord(result) || result.ok !== true || !isRecord(result.project)) {
      throw new SelfHostedProjectSyncError('invalid-authority-response', 'The self-hosted authority returned an invalid project create response.');
    }
    return result.project as unknown as SelfHostedProjectRecord<TBlob>;
  }

  async updateProject<TBlob>(input: {
    projectId: string;
    baseRevision: number;
    blob: TBlob;
    name?: string;
    mutationId?: string;
    signal?: AbortSignal;
  }): Promise<{ revision: number; replayed: boolean; mutationId: string }> {
    const mutationId = input.mutationId ?? createMutationId();
    const pending: PendingSelfHostedProjectMutation<TBlob> = {
      projectId: input.projectId,
      name: input.name,
      baseRevision: input.baseRevision,
      mutationId,
      blob: input.blob,
      queuedAt: this.now(),
    };
    try {
      const result = await this.request(`/v1/projects/${encodeURIComponent(input.projectId)}`, {
        method: 'PUT',
        authenticated: true,
        body: { baseRevision: input.baseRevision, mutationId, blob: input.blob, ...(input.name === undefined ? {} : { name: input.name }) },
        signal: input.signal,
      });
      if (!isRecord(result) || result.ok !== true || typeof result.revision !== 'number' || typeof result.replayed !== 'boolean') {
        throw new SelfHostedProjectSyncError('invalid-authority-response', 'The self-hosted authority returned an invalid project update response.');
      }
      this.removePending(mutationId);
      return { revision: result.revision, replayed: result.replayed, mutationId };
    } catch (error) {
      if (this.shouldResume(error)) this.queuePending(pending);
      throw error;
    }
  }

  /**
   * Resume durable-but-token-free pending writes in FIFO order after a reconnect. A conflict is
   * intentionally retained and reported: the caller must fetch/reconcile before it can overwrite.
   */
  async resumePending(signal?: AbortSignal): Promise<Array<{ mutationId: string; status: 'applied' | 'conflict' | 'unavailable'; revision?: number }>> {
    const outcomes: Array<{ mutationId: string; status: 'applied' | 'conflict' | 'unavailable'; revision?: number }> = [];
    for (const pending of this.pendingMutations()) {
      try {
        const result = await this.updateProject({ ...pending, signal });
        outcomes.push({ mutationId: pending.mutationId, status: 'applied', revision: result.revision });
      } catch (error) {
        if (error instanceof SelfHostedProjectSyncError && error.code === 'revision-conflict') {
          outcomes.push({ mutationId: pending.mutationId, status: 'conflict', revision: error.currentRevision });
          break;
        }
        outcomes.push({ mutationId: pending.mutationId, status: 'unavailable' });
        break;
      }
    }
    return outcomes;
  }

  async eventsSince(projectId: string, afterRevision: number, signal?: AbortSignal): Promise<{ latestRevision: number; gap: boolean; events: SelfHostedProjectEvent[] }> {
    const result = await this.request(`/v1/projects/${encodeURIComponent(projectId)}/events?after=${encodeURIComponent(String(afterRevision))}`, {
      authenticated: true,
      signal,
    });
    if (!isRecord(result) || result.ok !== true || typeof result.latestRevision !== 'number' || typeof result.gap !== 'boolean' || !Array.isArray(result.events)) {
      throw new SelfHostedProjectSyncError('invalid-authority-response', 'The self-hosted authority returned an invalid revision log.');
    }
    return { latestRevision: result.latestRevision, gap: result.gap, events: result.events as SelfHostedProjectEvent[] };
  }

  pendingMutations(): PendingSelfHostedProjectMutation[] {
    const pending = parseStored<unknown>(this.local, PENDING_STORAGE_KEY);
    if (!Array.isArray(pending)) return [];
    return pending.filter((item): item is PendingSelfHostedProjectMutation => (
      isRecord(item)
      && typeof item.projectId === 'string'
      && typeof item.baseRevision === 'number'
      && typeof item.mutationId === 'string'
      && typeof item.queuedAt === 'number'
      && 'blob' in item
    )).sort((left, right) => left.queuedAt - right.queuedAt);
  }

  private queuePending(pending: PendingSelfHostedProjectMutation): void {
    const existing = this.pendingMutations().filter((item) => item.mutationId !== pending.mutationId);
    // Retain a bounded resume journal. It deliberately stores no bearer or password.
    writeStored(this.local, PENDING_STORAGE_KEY, [...existing, pending].slice(-32));
  }

  private removePending(mutationId: string): void {
    const remaining = this.pendingMutations().filter((item) => item.mutationId !== mutationId);
    if (remaining.length === 0) this.local?.removeItem(PENDING_STORAGE_KEY);
    else writeStored(this.local, PENDING_STORAGE_KEY, remaining);
  }

  private shouldResume(error: unknown): boolean {
    if (!(error instanceof SelfHostedProjectSyncError)) return true;
    return error.status >= 500 && error.code !== 'request-cancelled';
  }

  private async request(pathname: string, options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    authenticated?: boolean;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const config = this.getConfiguration();
    if (!config) throw new SelfHostedProjectSyncError('self-hosted-sync-unavailable', 'Configure a self-hosted authority before using remote project sync.');
    if (!this.fetcher) throw new SelfHostedProjectSyncError('self-hosted-sync-unavailable', 'This runtime cannot contact a self-hosted authority.');
    const session = options.authenticated ? this.getSession() : null;
    if (options.authenticated && !session) {
      throw new SelfHostedProjectSyncError('authentication-required', 'Sign in to the configured self-hosted authority first.', 401);
    }
    let response: FetchResponseLike;
    try {
      response = await this.fetcher(`${config.endpoint}${pathname}`, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
        throw new SelfHostedProjectSyncError('request-cancelled', 'The remote write was cancelled before confirmation.', 499);
      }
      throw new SelfHostedProjectSyncError('authority-unavailable', 'The self-hosted authority is unavailable. The local project remains unchanged.');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SelfHostedProjectSyncError('invalid-authority-response', 'The self-hosted authority returned an unreadable response.', response.status);
    }
    if (!response.ok) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      const code = typeof error?.code === 'string' ? error.code : 'authority-request-failed';
      const message = typeof error?.message === 'string' ? error.message : 'The self-hosted authority refused the request.';
      const currentRevision = typeof error?.currentRevision === 'number' ? error.currentRevision : undefined;
      if (response.status === 401) this.clearSession();
      throw new SelfHostedProjectSyncError(code, message, response.status, currentRevision);
    }
    return payload;
  }
}

let defaultClient: SelfHostedProjectSyncClient | undefined;

export function selfHostedProjectSyncClient(): SelfHostedProjectSyncClient {
  defaultClient ??= new SelfHostedProjectSyncClient();
  return defaultClient;
}
