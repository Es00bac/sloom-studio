import { Capacitor, registerPlugin } from '@capacitor/core';

import type { SourceLibraryNativeChange } from './sourceLibraryNativeSync';
import {
  getHostSourceLibraryVersion,
  recordHostSourceLibraryChange,
  waitForHostSourceLibraryEvents,
} from './lanHostService';
import {
  getHostProjectSyncAsset,
  getProjectSyncChannel,
  getProjectSyncVersion,
  MAX_PROJECT_SYNC_ASSET_DATA_URL_CHARS,
  MAX_PROJECT_SYNC_ASSET_INVENTORY,
  recordProjectSyncAsset,
  recordProjectSyncChange,
  stageProjectSyncAssets,
  waitForProjectSyncEvents,
  type ProjectSyncChannelId,
} from './projectSyncService';
import { getEditLockState, type EditLockDevice } from './projectEditLock';
import { hostClaim, hostForceClaim, hostHeartbeat, hostRelease, hostYield } from './editLockHost';
import { BINARY_RESUME_SAMPLE_BYTES, MAX_BINARY_RESUME_BYTES } from './binaryResumeSniffer';
import { analyzeBase64DataUrl } from './boundedDataUrl';

/**
 * Bridge to the native SignalLoomLanServer plugin, which serves the bundled web app over the local
 * network so a desktop browser on the same Wi-Fi can open the full Sloom Studio interface from the
 * phone. The served app runs in plain web mode (no Capacitor bridge), like the Chrome build.
 *
 * Served over plain HTTP; the data API is secured by a pairing PIN → bearer token (see
 * `LanAppServer.java` and `remoteHostClient.ts`), not HTTPS.
 */
export interface SignalLoomLanServerStatus {
  running: boolean;
  port: number;
  ip: string;
  /** Pairing code shown on the phone; a served desktop browser enters it once to get a session token. */
  pin: string;
  url: string | null;
}

export interface SignalLoomLanServerPlugin {
  start(options: { port?: number; pin?: string }): Promise<SignalLoomLanServerStatus>;
  stop(): Promise<SignalLoomLanServerStatus>;
  status(): Promise<SignalLoomLanServerStatus>;
  respond(options: { id: string; data: string }): Promise<void>;
}

/** Default port the phone serves the desktop app on. */
export const SIGNAL_LOOM_LAN_SERVER_DEFAULT_PORT = 8723;
/** UI request emitted by the Android mobile drawer to reveal serving details on demand. */
export const OPEN_ANDROID_LAN_SERVER_EVENT = 'sloom-open-android-lan-server';

/** How long the phone holds a long-poll open before a heartbeat — kept under the native relay latch. */
const SOURCE_LIBRARY_LONG_POLL_MS = 25_000;

/** Same heartbeat budget for the generic per-channel `/project/*` long-poll (Flow/Paper/Image/…). */
const PROJECT_LONG_POLL_MS = 25_000;
const MAX_DIRECT_SOURCE_ASSET_UPLOAD_DATA_URL_CHARS = 512 * 1024;
const MAX_DIRECT_PROJECT_ASSET_UPLOAD_DATA_URL_CHARS = 512 * 1024;
const MAX_SOURCE_ASSET_UPLOAD_DATA_URL_CHARS = 128 * 1024 * 1024;
const MAX_SOURCE_ASSET_UPLOAD_CHUNK_CHARS = 512 * 1024;
const MAX_SOURCE_ASSET_UPLOADS = 4;
const SOURCE_ASSET_UPLOAD_TTL_MS = 5 * 60 * 1000;
const MAX_RECENT_PROJECT_MUTATIONS = 2048;
const PROJECT_MUTATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

const SIGNAL_LOOM_LAN_SERVER_PLUGIN_KEY = '__signalLoomLanServerPlugin';

function getSignalLoomLanServerPlugin(): SignalLoomLanServerPlugin {
  const globalState = globalThis as typeof globalThis & {
    [SIGNAL_LOOM_LAN_SERVER_PLUGIN_KEY]?: SignalLoomLanServerPlugin;
  };
  const cachedPlugin = globalState[SIGNAL_LOOM_LAN_SERVER_PLUGIN_KEY];
  if (cachedPlugin) {
    return cachedPlugin;
  }
  const plugin = registerPlugin<SignalLoomLanServerPlugin>('SignalLoomLanServer');
  globalState[SIGNAL_LOOM_LAN_SERVER_PLUGIN_KEY] = plugin;
  return plugin;
}

/** True only in the native Android app, where the embedded LAN server exists. */
export function isAndroidLanServerAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/** Start serving the app on the LAN; resolves with the URL + pairing PIN a desktop browser needs. */
export async function startAndroidLanServer(
  port = SIGNAL_LOOM_LAN_SERVER_DEFAULT_PORT,
  pin = '',
): Promise<SignalLoomLanServerStatus | null> {
  if (!isAndroidLanServerAvailable()) return null;
  try {
    return await getSignalLoomLanServerPlugin().start({ port, pin });
  } catch {
    return null;
  }
}

/** Stop serving the app on the LAN. */
export async function stopAndroidLanServer(): Promise<SignalLoomLanServerStatus | null> {
  if (!isAndroidLanServerAvailable()) return null;
  try {
    return await getSignalLoomLanServerPlugin().stop();
  } catch {
    return null;
  }
}

/** Current LAN-server state (running / url / ip / port / pin), or null when unavailable. */
export async function getAndroidLanServerStatus(): Promise<SignalLoomLanServerStatus | null> {
  if (!isAndroidLanServerAvailable()) return null;
  try {
    return await getSignalLoomLanServerPlugin().status();
  } catch {
    return null;
  }
}

let isLanProxyInitialized = false;

interface LanProxyHandlers {
  getProjects?: () => Promise<unknown>;
  getProject?: (id: string) => Promise<unknown>;
  getSourceLibrary?: () => Promise<unknown>;
  getAsset?: (id: string, request?: LanBoundedAssetRequest) => Promise<unknown>;
  getAssetSample?: (id: string, request?: LanBoundedAssetRequest) => Promise<unknown>;
  getAssetMetadata?: (id: string) => Promise<unknown>;
  /**
   * Resolve a source-library item's bytes by its *source-item* id (not assetId), via the universal
   * `loadItemAsDataUrl` resolver. Unlike `getAsset` (IndexedDB only), this serves native-file- and
   * scratch-backed items too — the bytes a served browser can't reach through the item's phone-local
   * `assetUrl`. The metadata/sample/full handlers below bind all three phases to one exact digest.
   */
  getSourceAsset?: (itemId: string, request?: LanBoundedAssetRequest) => Promise<unknown>;
  getSourceAssetSample?: (itemId: string, request?: LanBoundedAssetRequest) => Promise<unknown>;
  getSourceAssetMetadata?: (itemId: string) => Promise<unknown>;
  /** Phase B: apply a source-library mutation pushed by a served client to the phone's live store. */
  applySourceLibraryMutation?: (change: SourceLibraryNativeChange) => Promise<void>;
  /** Phase B: store an asset blob (data-URL record) uploaded by a served client. Additive only. */
  putAsset?: (id: string, record: unknown) => Promise<void>;
}
const proxyHandlers: LanProxyHandlers = {};

interface StagedSourceAssetUpload {
  assetId: string;
  uploadId: string;
  name: string;
  mimeType: string;
  totalLength: number;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
  chunks: Map<number, string>;
  receivedLength: number;
}

interface StagedProjectAssetUpload {
  channel: ProjectSyncChannelId;
  assetId: string;
  uploadId: string;
  totalLength: number;
  chunkCount: number;
  updatedAt: number;
  chunks: Map<number, string>;
  receivedLength: number;
}

const stagedSourceAssetUploads = new Map<string, StagedSourceAssetUpload>();
const completedSourceAssetUploads = new Map<string, { completedAt: number; byteLength: number }>();
const stagedProjectAssetUploads = new Map<string, StagedProjectAssetUpload>();
const completedProjectAssetUploads = new Map<string, { completedAt: number; byteLength: number }>();
/** Successful client mutation ids retained long enough to make timeout retries exactly-once. */
const recentProjectMutations = new Map<string, number>();
/** Store application and authority-log append are one ordered transaction, even when a channel awaits. */
let projectMutationTail: Promise<void> = Promise.resolve();

function serializeProjectMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = projectMutationTail.then(work, work);
  projectMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function rememberProjectMutation(key: string, version: number): void {
  recentProjectMutations.delete(key);
  recentProjectMutations.set(key, version);
  while (recentProjectMutations.size > MAX_RECENT_PROJECT_MUTATIONS) {
    const oldest = recentProjectMutations.keys().next().value as string | undefined;
    if (!oldest) break;
    recentProjectMutations.delete(oldest);
  }
}

interface LanBoundedAssetRequest {
  maxBytes: number;
  sampleBytes: number;
  transportIdentity: string;
}

/**
 * The namespaced data API the phone host answers for served desktop browsers (task #20; see
 * `docs/notes/724-shared-state-design.md`, `remoteHostClient.ts`). The mirror now includes live,
 * simultaneous project channels; every accepted peer mutation is serialized through the phone's
 * authority log, while large immutable payloads travel through the bounded asset routes below.
 */
const REMOTE_HOST_API_BASE = '/__loom/api';

/**
 * Register the phone-side handlers that service the mirror/sync API. Called once each from
 * `projectLibrary` (projects), `assetStore` (assets), and `sourceBinStore` (source-library + mutate);
 * the handler maps are merged so every store contributes only what it owns.
 */
export function initializeLanServerProxy(handlers: LanProxyHandlers) {
  if (!isAndroidLanServerAvailable()) return;
  Object.assign(proxyHandlers, handlers);

  if (isLanProxyInitialized) return;
  isLanProxyInitialized = true;

  const handleLanRequest = async (req: LanRelayRequest) => {
    try {
      const result = await resolveLanRequest(req);
      await getSignalLoomLanServerPlugin().respond({
        id: req.id,
        data: JSON.stringify(result ?? null),
      });
    } catch (err) {
      console.error('LAN Server Proxy Error:', err);
      await getSignalLoomLanServerPlugin().respond({
        id: req.id,
        data: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      });
    }
  };

  // Android queues native-pushed Capacitor messages while the WebView is invisible. Native therefore
  // sends a Base64-encoded, inert JSON value through the wake-capable evaluation path; large Source
  // assets use the bounded chunk protocol, keeping any individual event modest.
  if (typeof window === 'undefined') return;
  window.addEventListener('sloom-native-lan-request', (event) => {
    const request = (event as CustomEvent<unknown>).detail;
    if (!isLanRelayRequest(request)) {
      console.error('LAN Server Proxy rejected an invalid native relay request.');
      return;
    }
    void handleLanRequest(request);
  });
}

interface LanRelayRequest {
  id: string;
  method: string;
  path: string;
  body?: string;
  /** Native bearer-token binding; never read from the browser-controlled URL. */
  authenticatedDeviceId?: string;
}

function isLanRelayRequest(value: unknown): value is LanRelayRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Record<string, unknown>;
  return typeof request.id === 'string'
    && request.id.length > 0
    && request.id.length <= 128
    && typeof request.method === 'string'
    && request.method.length > 0
    && request.method.length <= 16
    && typeof request.path === 'string'
    && request.path.startsWith(REMOTE_HOST_API_BASE)
    && request.path.length <= 4_096
    && (request.body === undefined || typeof request.body === 'string')
    && (request.authenticatedDeviceId === undefined || isSessionBoundDeviceId(request.authenticatedDeviceId));
}

/**
 * Map an incoming relayed request (already authenticated by the native layer) to a host handler.
 * Exported for tests (e.g. the baton write-gate); production callers go through the relay listener.
 */
export async function resolveLanRequest(req: Pick<LanRelayRequest, 'method' | 'path' | 'body' | 'authenticatedDeviceId'>): Promise<unknown> {
  const [rawPath, queryString = ''] = req.path.split('?');
  const path = rawPath;

  if (req.method === 'GET') {
    if (path === `${REMOTE_HOST_API_BASE}/projects`) {
      return proxyHandlers.getProjects ? await proxyHandlers.getProjects() : [];
    }
    if (path.startsWith(`${REMOTE_HOST_API_BASE}/projects/`)) {
      const id = decodeURIComponent(path.slice(`${REMOTE_HOST_API_BASE}/projects/`.length));
      return proxyHandlers.getProject ? await proxyHandlers.getProject(id) : null;
    }
    if (path === `${REMOTE_HOST_API_BASE}/source-library`) {
      return proxyHandlers.getSourceLibrary ? await proxyHandlers.getSourceLibrary() : null;
    }
    if (path === `${REMOTE_HOST_API_BASE}/source-library/events`) {
      const since = Number(new URLSearchParams(queryString).get('since') ?? 0);
      return waitForHostSourceLibraryEvents(since, SOURCE_LIBRARY_LONG_POLL_MS);
    }
    if (path.startsWith(`${REMOTE_HOST_API_BASE}/source-asset/`)) {
      const itemId = decodeURIComponent(path.slice(`${REMOTE_HOST_API_BASE}/source-asset/`.length));
      const request = parseLanBoundedAssetRequest(queryString);
      return request && proxyHandlers.getSourceAsset
        ? await proxyHandlers.getSourceAsset(itemId, request)
        : null;
    }
    if (path.startsWith(`${REMOTE_HOST_API_BASE}/source-asset-metadata/`)) {
      const itemId = decodeURIComponent(path.slice(`${REMOTE_HOST_API_BASE}/source-asset-metadata/`.length));
      return proxyHandlers.getSourceAssetMetadata ? await proxyHandlers.getSourceAssetMetadata(itemId) : null;
    }
    if (path.startsWith(`${REMOTE_HOST_API_BASE}/source-asset-sample/`)) {
      const itemId = decodeURIComponent(path.slice(`${REMOTE_HOST_API_BASE}/source-asset-sample/`.length));
      const request = parseLanBoundedAssetRequest(queryString);
      return request && proxyHandlers.getSourceAssetSample
        ? await proxyHandlers.getSourceAssetSample(itemId, request)
        : null;
    }
    if (path.startsWith(`${REMOTE_HOST_API_BASE}/asset-metadata/`)) {
      const id = decodeURIComponent(path.slice(`${REMOTE_HOST_API_BASE}/asset-metadata/`.length));
      return proxyHandlers.getAssetMetadata ? await proxyHandlers.getAssetMetadata(id) : null;
    }
    if (path.startsWith(`${REMOTE_HOST_API_BASE}/asset-sample/`)) {
      const id = decodeURIComponent(path.slice(`${REMOTE_HOST_API_BASE}/asset-sample/`.length));
      const request = parseLanBoundedAssetRequest(queryString);
      return request && proxyHandlers.getAssetSample
        ? await proxyHandlers.getAssetSample(id, request)
        : null;
    }
    if (path.startsWith(`${REMOTE_HOST_API_BASE}/asset/`)) {
      const id = decodeURIComponent(path.slice(`${REMOTE_HOST_API_BASE}/asset/`.length));
      const request = parseLanBoundedAssetRequest(queryString);
      return request && proxyHandlers.getAsset ? await proxyHandlers.getAsset(id, request) : null;
    }
    if (path === `${REMOTE_HOST_API_BASE}/lock`) {
      // Current cross-device edit-baton state (memory: cross-device-sync-baton-model). The live stream
      // is the `edit-lock` slice of the project-sync log below; this is a one-shot read.
      return { state: getEditLockState() };
    }
    if (path === `${REMOTE_HOST_API_BASE}/project/events`) {
      // One global cursor carries all workspace channels. Keeping this multiplexed avoids occupying a
      // browser connection for every workspace and starving lock/mutation POSTs behind long polls.
      const since = Number(new URLSearchParams(queryString).get('since') ?? 0);
      return waitForProjectSyncEvents(since, PROJECT_LONG_POLL_MS);
    }

    // Out-of-band channel asset fetch (task #53): `GET /project/:channel/asset/:assetId`. Pixels that
    // are too large for the JSON op stream (a layer's OffscreenCanvas) ride here, content-addressed by
    // `layerId@bitmapVersion`, so a receiver fetches a version only once. Checked before the 2-segment
    // channel route below, which it can't match (this path has 3 segments).
    const assetRoute = parseProjectAssetRoute(path);
    if (assetRoute) {
      return { asset: getHostProjectSyncAsset(assetRoute.channel, assetRoute.assetId) };
    }

    // Generic op-sync channels (task #51+): `/project/:channel/{snapshot,events}`. The phone is the
    // authority; a registered channel (e.g. Flow) supplies the snapshot, and the shared monotonic log
    // (filtered to this channel) supplies the long-poll stream every workspace rides identically.
    const route = parseProjectChannelRoute(path);
    if (route?.action === 'snapshot') {
      const channel = getProjectSyncChannel(route.channel);
      // Cursor the snapshot at request admission, not completion. Some snapshots materialize managed
      // assets asynchronously; changes committed while they are being built must remain newer than the
      // returned cursor so the global subscriber replays them instead of skipping them.
      const version = getProjectSyncVersion();
      const snapshot = channel ? await channel.snapshot() : null;
      return { snapshot, version };
    }
    if (route?.action === 'events') {
      const since = Number(new URLSearchParams(queryString).get('since') ?? 0);
      return waitForProjectSyncEvents(since, PROJECT_LONG_POLL_MS, route.channel);
    }
    return null;
  }

  if (req.method === 'POST' && path === `${REMOTE_HOST_API_BASE}/source-library/mutate`) {
    const change = parseJsonBody<SourceLibraryNativeChange>(req.body);
    if (!change) return { ok: false, error: 'invalid-source-library-change' };
    if (!proxyHandlers.applySourceLibraryMutation) {
      return { ok: false, error: 'source-library-unavailable' };
    }
    await proxyHandlers.applySourceLibraryMutation(change);
    return { ok: true, version: getHostSourceLibraryVersion() };
  }

  // Generic op-sync mutate: a served client pushes a channel op. The phone applies it to its own live
  // store (via the registered channel's non-broadcasting `applyRemote`) AND records it on the shared
  // log so every *other* served client tails it. The pusher's own op echoes back idempotently. Current
  // peers are simultaneous collaborators: the authority serializes accepted ops into this one ordered
  // log instead of rejecting a peer merely because the legacy presence baton names another device.
  {
    const route = req.method === 'POST' ? parseProjectChannelRoute(path) : null;
    if (route?.action === 'mutate') {
      const change = parseJsonBody<unknown>(req.body);
      const channel = getProjectSyncChannel(route.channel);
      if (change == null) return { ok: false, error: 'invalid-change', version: getProjectSyncVersion() };
      if (!channel) return { ok: false, error: 'unknown-channel', version: getProjectSyncVersion() };
      // Team-review permissions are actor-bound. The Android server resolves this device from the
      // authenticated bearer-token binding and relays it separately from the client-controlled URL.
      // Refuse before the reducer so a paired peer cannot claim the host or another member.
      if (route.channel === 'team-review') {
        const device = req.authenticatedDeviceId;
        const actorId = typeof change === 'object' && change !== null && 'actorId' in change
          ? (change as { actorId?: unknown }).actorId
          : undefined;
        if (!isSessionBoundDeviceId(device) || actorId !== device) {
          return { ok: false, error: 'identity-mismatch', version: getProjectSyncVersion() };
        }
      }
      const mutationId = new URLSearchParams(queryString).get('mutation') ?? '';
      const mutationKey = PROJECT_MUTATION_ID_PATTERN.test(mutationId)
        ? `${route.channel}\u0000${mutationId}`
        : '';
      return serializeProjectMutation(async () => {
        const committedVersion = mutationKey ? recentProjectMutations.get(mutationKey) : undefined;
        if (committedVersion !== undefined) {
          return { ok: true, duplicate: true, version: committedVersion };
        }
        const changed = await channel.applyRemote(change);
        if (!changed) {
          return { ok: false, error: 'change-not-applied', version: getProjectSyncVersion() };
        }
        const event = recordProjectSyncChange(route.channel, change);
        if (mutationKey) rememberProjectMutation(mutationKey, event.version);
        return { ok: true, version: event.version };
      });
    }
  }

  if (req.method === 'PUT' && path.startsWith(`${REMOTE_HOST_API_BASE}/asset/`)) {
    const id = decodeURIComponent(path.slice(`${REMOTE_HOST_API_BASE}/asset/`.length));
    const record = parseJsonBody<{
      id?: unknown;
      name?: unknown;
      mimeType?: unknown;
      dataUrl?: unknown;
      createdAt?: unknown;
    }>(req.body);
    if (!id || id.length > 512 || !proxyHandlers.putAsset
      || record?.id !== id
      || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 512
      || typeof record.mimeType !== 'string'
      || typeof record.dataUrl !== 'string'
      || record.dataUrl.length > MAX_DIRECT_SOURCE_ASSET_UPLOAD_DATA_URL_CHARS
      || !analyzeBase64DataUrl(record.dataUrl, MAX_BINARY_RESUME_BYTES)
      || typeof record.createdAt !== 'number' || !Number.isFinite(record.createdAt)) {
      return { ok: false, error: 'invalid-source-asset' };
    }
    await proxyHandlers.putAsset(id, record);
    return { ok: true };
  }

  // Large Source Library assets (notably layered .slimg handoffs) use a bounded, idempotent chunk
  // transaction. A phone never publishes the Source Library item until commit has reconstructed and
  // validated the complete data URL, so interrupted Wi-Fi cannot create a hollow handoff card.
  if (req.method === 'PUT' && path.startsWith(`${REMOTE_HOST_API_BASE}/asset-upload/`)) {
    return handleSourceAssetUpload(path, req.body);
  }

  // Image/Paper workspace pixel payloads use the same bounded transaction shape as Source Library
  // handoffs. Without this route a multi-megabyte layer PUT would have to be embedded in one Android
  // evaluateJavascript wake event while the phone is backgrounded.
  if (req.method === 'PUT' && path.startsWith(`${REMOTE_HOST_API_BASE}/project/`)
    && path.includes('/asset-upload/')) {
    return handleProjectAssetUpload(path, req.body);
  }

  // Out-of-band channel asset upload (task #53): a served client PUTs a layer's encoded pixels here
  // (content-addressed by `layerId@bitmapVersion`) just before publishing the pixel-pointer op, so the
  // phone can serve them to every other client. Body: `{ asset: <base64 data URL> }`.
  if (req.method === 'PUT') {
    const inventoryRoute = parseProjectChannelRoute(path.split('?')[0]);
    if (inventoryRoute?.action === 'assets') {
      const body = parseJsonBody<{ assetIds?: unknown }>(req.body);
      if (!Array.isArray(body?.assetIds)
        || body.assetIds.length > MAX_PROJECT_SYNC_ASSET_INVENTORY
        || body.assetIds.some((assetId) => typeof assetId !== 'string'
          || !assetId
          || assetId.length > 512)) {
        return { ok: false, error: 'A project sync asset inventory must contain only non-empty ids.' };
      }
      return stageProjectSyncAssets(inventoryRoute.channel, [...new Set(body.assetIds)])
        ? { ok: true }
        : { ok: false, error: 'project-sync-asset-inventory-too-large' };
    }
    const assetRoute = parseProjectAssetRoute(path.split('?')[0]);
    if (assetRoute) {
      const body = parseJsonBody<{ asset?: string }>(req.body);
      if (typeof body?.asset !== 'string'
        || body.asset.length > MAX_DIRECT_PROJECT_ASSET_UPLOAD_DATA_URL_CHARS
        || !analyzeBase64DataUrl(body.asset, MAX_BINARY_RESUME_BYTES)) {
        return { ok: false, error: 'invalid-project-sync-asset' };
      }
      return recordProjectSyncAsset(assetRoute.channel, assetRoute.assetId, body.asset)
        ? { ok: true }
        : { ok: false, error: 'project-sync-asset-capacity-exceeded' };
    }
  }

  // Edit-baton control plane (memory: cross-device-sync-baton-model). A served client POSTs its action
  // here with `{ device }` in the body — the relay does NOT forward headers, so the actor's identity
  // must ride in the body. Each handler mutates the host-authoritative baton (which broadcasts the new
  // state over the `edit-lock` project-sync channel) and echoes the resulting state to the caller.
  if (req.method === 'POST' && path.startsWith(`${REMOTE_HOST_API_BASE}/lock/`)) {
    const action = path.slice(`${REMOTE_HOST_API_BASE}/lock/`.length);
    const parsed = parseJsonBody<{ device?: EditLockDevice }>(req.body);
    const device = parsed?.device;
    if (!device || typeof device.id !== 'string' || typeof device.label !== 'string') {
      return { ok: false, error: 'invalid-device' };
    }
    switch (action) {
      case 'claim': {
        const result = hostClaim(device);
        return { ok: true, granted: result.granted, state: result.state };
      }
      case 'force': {
        const result = hostForceClaim(device);
        return { ok: true, granted: result.granted, state: result.state };
      }
      case 'yield':
        return { ok: true, state: hostYield(device) };
      case 'release':
        return { ok: true, state: hostRelease(device) };
      case 'heartbeat':
        return { ok: true, state: hostHeartbeat(device) };
      default:
        return { ok: false, error: 'unknown-lock-action' };
    }
  }

  return null;
}

function isSessionBoundDeviceId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,300}$/.test(value);
}

async function handleSourceAssetUpload(path: string, body: string | undefined): Promise<unknown> {
  pruneExpiredSourceAssetUploads();
  const route = parseSourceAssetUploadRoute(path);
  if (!route) return { ok: false, error: 'invalid-asset-upload-route' };
  const parsed = parseJsonBody<Record<string, unknown>>(body);
  const uploadId = typeof parsed?.uploadId === 'string' ? parsed.uploadId : '';
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(uploadId)) {
    return { ok: false, error: 'invalid-asset-upload-id' };
  }
  const key = `${route.assetId}\u0000${uploadId}`;
  const completed = completedSourceAssetUploads.get(key);
  if (route.action === 'commit' && completed) {
    return { ok: true, duplicate: true, byteLength: completed.byteLength };
  }

  if (route.action === 'begin') {
    const name = typeof parsed?.name === 'string' ? parsed.name.trim() : '';
    const mimeType = typeof parsed?.mimeType === 'string' ? parsed.mimeType.trim().toLowerCase() : '';
    const totalLength = Number(parsed?.totalLength);
    const chunkCount = Number(parsed?.chunkCount);
    const createdAt = Number(parsed?.createdAt);
    if (!route.assetId || route.assetId.length > 512 || !name || name.length > 512
      || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimeType)
      || !Number.isSafeInteger(totalLength) || totalLength <= 0
      || totalLength > MAX_SOURCE_ASSET_UPLOAD_DATA_URL_CHARS
      || !Number.isSafeInteger(chunkCount) || chunkCount <= 0
      || chunkCount > Math.ceil(MAX_SOURCE_ASSET_UPLOAD_DATA_URL_CHARS / MAX_SOURCE_ASSET_UPLOAD_CHUNK_CHARS)
      || !Number.isFinite(createdAt) || createdAt <= 0) {
      return { ok: false, error: 'invalid-asset-upload-metadata' };
    }
    if (!stagedSourceAssetUploads.has(key) && stagedSourceAssetUploads.size >= MAX_SOURCE_ASSET_UPLOADS) {
      return { ok: false, error: 'too-many-asset-uploads' };
    }
    stagedSourceAssetUploads.set(key, {
      assetId: route.assetId,
      uploadId,
      name,
      mimeType,
      totalLength,
      chunkCount,
      createdAt,
      updatedAt: Date.now(),
      chunks: new Map(),
      receivedLength: 0,
    });
    return { ok: true };
  }

  const staged = stagedSourceAssetUploads.get(key);
  if (!staged) return { ok: false, error: 'asset-upload-not-started' };
  staged.updatedAt = Date.now();

  if (route.action === 'chunk') {
    const index = route.chunkIndex;
    const chunk = typeof parsed?.chunk === 'string' ? parsed.chunk : '';
    if (index === undefined || index < 0 || index >= staged.chunkCount
      || !chunk || chunk.length > MAX_SOURCE_ASSET_UPLOAD_CHUNK_CHARS) {
      return { ok: false, error: 'invalid-asset-upload-chunk' };
    }
    const existing = staged.chunks.get(index);
    if (existing !== undefined && existing !== chunk) {
      return { ok: false, error: 'asset-upload-chunk-conflict' };
    }
    if (existing === undefined) {
      if (staged.receivedLength + chunk.length > staged.totalLength) {
        return { ok: false, error: 'asset-upload-length-exceeded' };
      }
      staged.chunks.set(index, chunk);
      staged.receivedLength += chunk.length;
    }
    return { ok: true, received: staged.chunks.size };
  }

  if (route.action === 'abort') {
    stagedSourceAssetUploads.delete(key);
    return { ok: true };
  }

  if (route.action !== 'commit') return { ok: false, error: 'invalid-asset-upload-action' };
  if (staged.chunks.size !== staged.chunkCount || staged.receivedLength !== staged.totalLength) {
    return { ok: false, error: 'asset-upload-incomplete' };
  }
  const dataUrl = Array.from({ length: staged.chunkCount }, (_, index) => staged.chunks.get(index) ?? '').join('');
  const analysis = analyzeBase64DataUrl(dataUrl, MAX_BINARY_RESUME_BYTES);
  if (!analysis || analysis.mimeType !== staged.mimeType || dataUrl.length !== staged.totalLength) {
    stagedSourceAssetUploads.delete(key);
    return { ok: false, error: 'invalid-asset-upload-payload' };
  }
  if (!proxyHandlers.putAsset) return { ok: false, error: 'asset-storage-unavailable' };
  await proxyHandlers.putAsset(staged.assetId, {
    id: staged.assetId,
    name: staged.name,
    mimeType: staged.mimeType,
    dataUrl,
    createdAt: staged.createdAt,
  });
  stagedSourceAssetUploads.delete(key);
  completedSourceAssetUploads.set(key, { completedAt: Date.now(), byteLength: analysis.size });
  return { ok: true, byteLength: analysis.size };
}

async function handleProjectAssetUpload(path: string, body: string | undefined): Promise<unknown> {
  pruneExpiredSourceAssetUploads();
  const route = parseProjectAssetUploadRoute(path);
  if (!route) return { ok: false, error: 'invalid-project-asset-upload-route' };
  const parsed = parseJsonBody<Record<string, unknown>>(body);
  const uploadId = typeof parsed?.uploadId === 'string' ? parsed.uploadId : '';
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(uploadId)) {
    return { ok: false, error: 'invalid-project-asset-upload-id' };
  }
  const key = `${route.channel}\u0000${route.assetId}\u0000${uploadId}`;
  const completed = completedProjectAssetUploads.get(key);
  if (route.action === 'commit' && completed) {
    return { ok: true, duplicate: true, byteLength: completed.byteLength };
  }

  if (route.action === 'begin') {
    const totalLength = Number(parsed?.totalLength);
    const chunkCount = Number(parsed?.chunkCount);
    if (!route.assetId || route.assetId.length > 512
      || !Number.isSafeInteger(totalLength) || totalLength <= 0
      || totalLength > MAX_PROJECT_SYNC_ASSET_DATA_URL_CHARS
      || !Number.isSafeInteger(chunkCount) || chunkCount <= 0
      || chunkCount > Math.ceil(MAX_PROJECT_SYNC_ASSET_DATA_URL_CHARS / MAX_SOURCE_ASSET_UPLOAD_CHUNK_CHARS)) {
      return { ok: false, error: 'invalid-project-asset-upload-metadata' };
    }
    if (!stagedProjectAssetUploads.has(key)
      && stagedProjectAssetUploads.size + stagedSourceAssetUploads.size >= MAX_SOURCE_ASSET_UPLOADS) {
      return { ok: false, error: 'too-many-asset-uploads' };
    }
    stagedProjectAssetUploads.set(key, {
      channel: route.channel,
      assetId: route.assetId,
      uploadId,
      totalLength,
      chunkCount,
      updatedAt: Date.now(),
      chunks: new Map(),
      receivedLength: 0,
    });
    return { ok: true };
  }

  const staged = stagedProjectAssetUploads.get(key);
  if (!staged) return { ok: false, error: 'project-asset-upload-not-started' };
  staged.updatedAt = Date.now();

  if (route.action === 'chunk') {
    const index = route.chunkIndex;
    const chunk = typeof parsed?.chunk === 'string' ? parsed.chunk : '';
    if (index === undefined || index < 0 || index >= staged.chunkCount
      || !chunk || chunk.length > MAX_SOURCE_ASSET_UPLOAD_CHUNK_CHARS) {
      return { ok: false, error: 'invalid-project-asset-upload-chunk' };
    }
    const existing = staged.chunks.get(index);
    if (existing !== undefined && existing !== chunk) {
      return { ok: false, error: 'project-asset-upload-chunk-conflict' };
    }
    if (existing === undefined) {
      if (staged.receivedLength + chunk.length > staged.totalLength) {
        return { ok: false, error: 'project-asset-upload-length-exceeded' };
      }
      staged.chunks.set(index, chunk);
      staged.receivedLength += chunk.length;
    }
    return { ok: true, received: staged.chunks.size };
  }

  if (route.action === 'abort') {
    stagedProjectAssetUploads.delete(key);
    return { ok: true };
  }

  if (route.action !== 'commit') return { ok: false, error: 'invalid-project-asset-upload-action' };
  if (staged.chunks.size !== staged.chunkCount || staged.receivedLength !== staged.totalLength) {
    return { ok: false, error: 'project-asset-upload-incomplete' };
  }
  const dataUrl = Array.from({ length: staged.chunkCount }, (_, index) => staged.chunks.get(index) ?? '').join('');
  const analysis = analyzeBase64DataUrl(dataUrl, MAX_BINARY_RESUME_BYTES);
  if (!analysis || dataUrl.length !== staged.totalLength) {
    stagedProjectAssetUploads.delete(key);
    return { ok: false, error: 'invalid-project-asset-upload-payload' };
  }
  if (!recordProjectSyncAsset(staged.channel, staged.assetId, dataUrl)) {
    return { ok: false, error: 'project-sync-asset-capacity-exceeded' };
  }
  stagedProjectAssetUploads.delete(key);
  completedProjectAssetUploads.set(key, { completedAt: Date.now(), byteLength: analysis.size });
  return { ok: true, byteLength: analysis.size };
}

function pruneExpiredSourceAssetUploads(now = Date.now()): void {
  for (const [key, upload] of stagedSourceAssetUploads) {
    if (now - upload.updatedAt > SOURCE_ASSET_UPLOAD_TTL_MS) stagedSourceAssetUploads.delete(key);
  }
  for (const [key, upload] of completedSourceAssetUploads) {
    if (now - upload.completedAt > SOURCE_ASSET_UPLOAD_TTL_MS) completedSourceAssetUploads.delete(key);
  }
  for (const [key, upload] of stagedProjectAssetUploads) {
    if (now - upload.updatedAt > SOURCE_ASSET_UPLOAD_TTL_MS) stagedProjectAssetUploads.delete(key);
  }
  for (const [key, upload] of completedProjectAssetUploads) {
    if (now - upload.completedAt > SOURCE_ASSET_UPLOAD_TTL_MS) completedProjectAssetUploads.delete(key);
  }
}

function parseSourceAssetUploadRoute(path: string): {
  assetId: string;
  action: 'begin' | 'chunk' | 'commit' | 'abort';
  chunkIndex?: number;
} | null {
  const prefix = `${REMOTE_HOST_API_BASE}/asset-upload/`;
  if (!path.startsWith(prefix)) return null;
  const segments = path.slice(prefix.length).split('/');
  if (segments.length < 2 || segments.length > 3) return null;
  let assetId: string;
  try {
    assetId = decodeURIComponent(segments[0]);
  } catch {
    return null;
  }
  const action = segments[1];
  if (action === 'begin' || action === 'commit' || action === 'abort') {
    return segments.length === 2 ? { assetId, action } : null;
  }
  if (action !== 'chunk' || segments.length !== 3 || !/^\d+$/.test(segments[2])) return null;
  const chunkIndex = Number(segments[2]);
  return Number.isSafeInteger(chunkIndex) ? { assetId, action, chunkIndex } : null;
}

function parseProjectAssetUploadRoute(path: string): {
  channel: ProjectSyncChannelId;
  assetId: string;
  action: 'begin' | 'chunk' | 'commit' | 'abort';
  chunkIndex?: number;
} | null {
  const prefix = `${REMOTE_HOST_API_BASE}/project/`;
  if (!path.startsWith(prefix)) return null;
  const segments = path.slice(prefix.length).split('/');
  if (segments.length < 4 || segments.length > 5 || segments[1] !== 'asset-upload') return null;
  let channel: string;
  let assetId: string;
  try {
    channel = decodeURIComponent(segments[0]);
    assetId = decodeURIComponent(segments[2]);
  } catch {
    return null;
  }
  if (!channel || channel.length > 128 || !assetId || assetId.length > 512) return null;
  const action = segments[3];
  if (action === 'begin' || action === 'commit' || action === 'abort') {
    return segments.length === 4 ? { channel, assetId, action } : null;
  }
  if (action !== 'chunk' || segments.length !== 5 || !/^\d+$/.test(segments[4])) return null;
  const chunkIndex = Number(segments[4]);
  return Number.isSafeInteger(chunkIndex) ? { channel, assetId, action, chunkIndex } : null;
}

function parseLanBoundedAssetRequest(queryString: string): LanBoundedAssetRequest | undefined {
  const query = new URLSearchParams(queryString);
  const maxBytes = Number(query.get('maxBytes'));
  const sampleBytes = Number(query.get('sampleBytes'));
  const transportIdentity = query.get('transportIdentity') ?? '';
  return Number.isSafeInteger(maxBytes)
    && maxBytes > 0
    && maxBytes <= MAX_BINARY_RESUME_BYTES
    && Number.isSafeInteger(sampleBytes)
    && sampleBytes > 0
    && sampleBytes <= BINARY_RESUME_SAMPLE_BYTES
    && sampleBytes <= maxBytes
    && transportIdentity.length > 0
    && transportIdentity.length <= 256
    ? { maxBytes, sampleBytes, transportIdentity }
    : undefined;
}

function parseJsonBody<T>(body: string | undefined): T | null {
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

/**
 * Parse a generic op-sync path `/__loom/api/project/:channel/:action` into its channel id + action
 * (`snapshot` | `events` | `mutate`). Returns null for any non-`/project/` path or a malformed one, so
 * the existing source-library/asset routes are never shadowed.
 */
function parseProjectChannelRoute(
  path: string,
): { channel: ProjectSyncChannelId; action: string } | null {
  const prefix = `${REMOTE_HOST_API_BASE}/project/`;
  if (!path.startsWith(prefix)) return null;
  const segments = path.slice(prefix.length).split('/');
  if (segments.length !== 2) return null;
  const channel = decodeURIComponent(segments[0]);
  const action = segments[1];
  if (!channel || !action) return null;
  return { channel, action };
}

/**
 * Parse an out-of-band asset path `/__loom/api/project/:channel/asset/:assetId` into its channel id +
 * content-addressed asset id (task #53). Three segments where the middle is the literal `asset`, so it
 * never collides with the 2-segment `{snapshot,events,mutate}` channel routes above.
 */
function parseProjectAssetRoute(
  path: string,
): { channel: ProjectSyncChannelId; assetId: string } | null {
  const prefix = `${REMOTE_HOST_API_BASE}/project/`;
  if (!path.startsWith(prefix)) return null;
  const segments = path.slice(prefix.length).split('/');
  if (segments.length !== 3 || segments[1] !== 'asset') return null;
  const channel = decodeURIComponent(segments[0]);
  const assetId = decodeURIComponent(segments[2]);
  if (!channel || !assetId) return null;
  return { channel, assetId };
}

/**
 * Publisher a served client registers so a source-library change it makes is pushed to the phone.
 * Kept as a registration seam (not a direct import) so `androidLanServer` never depends on
 * `remoteHostClient`, avoiding an import cycle.
 */
type ServedMutationPublisher = (change: SourceLibraryNativeChange) => void;
let servedMutationPublisher: ServedMutationPublisher | null = null;

export function setServedMutationPublisher(publisher: ServedMutationPublisher | null): void {
  servedMutationPublisher = publisher;
}

/**
 * Route a local source-library change into the LAN channel. On the phone (authority) it is recorded
 * as the next version so served clients tail it; on a served client it is pushed to the phone via the
 * registered publisher. A no-op on a normal web/desktop session. Called from the source-bin broadcast
 * hooks in `sourceBinStore`.
 */
export function notifyLanSourceLibraryChange(change: SourceLibraryNativeChange): void {
  if (isAndroidLanServerAvailable()) {
    recordHostSourceLibraryChange(change);
    return;
  }
  servedMutationPublisher?.(change);
}

/**
 * Generic version of {@link setServedMutationPublisher} for the workspace-agnostic op-sync channels
 * (task #51+). A served client registers one publisher that routes `(channel, change)` to the right
 * `POST /project/:channel/mutate`. Registration seam (not a direct import) so `androidLanServer` stays
 * free of a `projectSyncClient` dependency, mirroring the source-library publisher.
 */
type ServedProjectMutationPublisher = (
  channel: ProjectSyncChannelId,
  change: unknown,
) => Promise<boolean> | boolean;
let servedProjectMutationPublisher: ServedProjectMutationPublisher | null = null;

export function setServedProjectMutationPublisher(publisher: ServedProjectMutationPublisher | null): void {
  servedProjectMutationPublisher = publisher;
}

/**
 * Route a local op on any project-sync channel into the LAN. On the phone (authority) it is recorded as
 * the next version on the shared monotonic log so every served client tails it; on a served client it is
 * pushed to the phone via the registered publisher. A no-op on a normal web/desktop session. Called from
 * each workspace's emit seam (e.g. `flowSyncChannel`).
 */
export async function notifyLanProjectChange(
  channel: ProjectSyncChannelId,
  change: unknown,
): Promise<boolean> {
  if (isAndroidLanServerAvailable()) {
    recordProjectSyncChange(channel, change);
    return true;
  }
  return await servedProjectMutationPublisher?.(channel, change) ?? false;
}
