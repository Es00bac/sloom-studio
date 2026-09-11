import { Capacitor } from '@capacitor/core';
import { isAndroidLanServerAvailable, setServedMutationPublisher } from './androidLanServer';
import { getLocalDevicePairingBinding, rotateLocalDevicePairingBinding } from './deviceIdentity';
import {
  applySourceLibraryNativeChange,
  shouldAcceptSourceLibraryNativeVersion,
  type SourceLibraryNativeChange,
  type SourceLibraryNativeEvent,
} from './sourceLibraryNativeSync';
import { useEditLockStore } from '../store/editLockStore';
import {
  isHaneProviderBinId,
  parseHaneLinkProviderCapabilities,
  type HaneLinkProviderCapabilities,
} from './haneLinkProviderContract';
import type { HaneQrPairingPoll } from './haneQrPairing';

/**
 * Client (served-browser) side of "phone as data authority" (task #20; design
 * `docs/notes/724-shared-state-design.md`). When a desktop browser opens the app served from a phone's
 * LAN host, this module makes the browser read/sync the *phone's* projects and source library over the
 * network instead of its own (empty) origin storage.
 *
 * **Security without HTTPS.** The host serves over plain HTTP and gates `/__loom/api/*` behind a
 * pairing PIN → per-session bearer token (the phone shows the PIN; the desktop enters it once). The
 * token is carried on every API call; CORS on the host is same-origin-only. We dropped self-signed
 * TLS because it only produced browser warnings and never provided access control. See `LanAppServer`.
 *
 * The phone owns file persistence while every connected screen remains a live editor. This module
 * tails the phone's source-library and project mutation logs, applies their shared reducers, and
 * publishes local Flow/Paper/Image/Video/Source changes back to the same authority-ordered stream.
 */

/** Namespaced so it cannot collide with any app/provider route called `/api`. */
export const REMOTE_HOST_API_BASE = '/__loom/api';
export const REMOTE_HOST_SYNC_ERROR_EVENT = 'sloom-remote-host-sync-error';

const TOKEN_STORAGE_KEY = 'signal-loom-remote-host-token';
const NATIVE_PHONE_ADDRESS_STORAGE_KEY = 'signal-loom-native-phone-host-address';
/** Small payloads retain the one-request route; larger layered handoffs use bounded chunks. */
const DIRECT_UPLOAD_DATA_URL_LENGTH = 512 * 1024;
const UPLOAD_CHUNK_CHARACTERS = 512 * 1024;
const MAX_UPLOAD_DATA_URL_LENGTH = 128 * 1024 * 1024;
const SOURCE_WRITE_ATTEMPTS = 3;
const SOURCE_WRITE_TIMEOUT_MS = 15_000;
const SOURCE_COMMIT_TIMEOUT_MS = 40_000;

export type RemoteHostPairingState = 'unknown' | 'unpaired' | 'paired';
export type RemoteHostCollaborationMode = 'baton' | 'simultaneous';

let servedSession = false;
let nativePhoneHostSession = false;
let directAndroidPhoneHostSession = false;
let remoteHostApiBase = REMOTE_HOST_API_BASE;
let remoteHostTokenScope = REMOTE_HOST_API_BASE;
let authRequired = false;
let probeCompleted = false;
let sessionToken: string | null = null;
let pairingState: RemoteHostPairingState = 'unknown';
let subscriberEpoch: number | null = null;
let sessionEpoch = 0;
let nativePhoneHostConfigurationGeneration: number | null = null;
// Older phone builds omit the capability and retain their single-writer baton contract. Current
// builds explicitly advertise simultaneous collaboration from /health before either peer may edit.
let collaborationMode: RemoteHostCollaborationMode = 'baton';
let haneLinkProviderSession = false;
let haneLinkProviderCapabilities: HaneLinkProviderCapabilities | null = null;
let mountedHaneProviderBinIds = new Set<string>();
let sessionAbortController = new AbortController();
let sourceMutationTail: Promise<void> = Promise.resolve();
let nextPendingSourceMutationId = 1;

interface PendingSourceMutation {
  id: number;
  epoch: number;
  change: SourceLibraryNativeChange;
}

// A Source Library mutation is already visible in the originating renderer before it reaches this
// publisher. Keep that intent until the authority explicitly acknowledges it so a version-gap seed
// cannot replace the local store with an older phone snapshot and silently erase the handoff.
const pendingSourceMutations: PendingSourceMutation[] = [];

const pairingListeners = new Set<(state: RemoteHostPairingState) => void>();

/**
 * True once a boot probe has confirmed this page is being served by a Sloom Studio phone host.
 * Synchronous so the storage layers (`projectLibrary`, `assetStore`) can branch without awaiting;
 * `initializeRemoteHostSession()` resolves the probe before the app renders.
 */
export function isServedLanSession(): boolean {
  return servedSession;
}

export function isNativePhoneHostSession(): boolean {
  return nativePhoneHostSession || directAndroidPhoneHostSession;
}

export function getRemoteHostCollaborationMode(): RemoteHostCollaborationMode {
  return collaborationMode;
}

/** True when this runtime participates in the ordered multi-writer project log. */
export function isSimultaneousProjectSyncSession(): boolean {
  return isAndroidLanServerAvailable()
    || (servedSession && !haneLinkProviderSession && collaborationMode === 'simultaneous');
}

export function isHaneLinkProviderSession(): boolean {
  return haneLinkProviderSession;
}

export function getHaneLinkProviderCapabilities(): HaneLinkProviderCapabilities | null {
  return haneLinkProviderCapabilities;
}

function setHaneLinkProvider(
  capabilities: HaneLinkProviderCapabilities | null,
): void {
  haneLinkProviderCapabilities = capabilities;
  haneLinkProviderSession = capabilities !== null;
}

export function isNativePhoneHostConnectionAvailable(): boolean {
  return typeof window !== 'undefined'
    && (
      typeof window.signalLoomNative?.configureRemotePhoneHost === 'function'
      || (
        Capacitor.isNativePlatform()
        && Capacitor.getPlatform() === 'android'
      )
    );
}

export function getRemoteHostSessionEpoch(): number {
  return sessionEpoch;
}

export function getRememberedNativePhoneHostAddress(): string {
  try {
    return window.localStorage.getItem(NATIVE_PHONE_ADDRESS_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function isRemoteHostAuthRequired(): boolean {
  return authRequired;
}

export function getRemoteHostPairingState(): RemoteHostPairingState {
  return pairingState;
}

export function subscribeRemoteHostPairing(listener: (state: RemoteHostPairingState) => void): () => void {
  pairingListeners.add(listener);
  return () => pairingListeners.delete(listener);
}

function setPairingState(next: RemoteHostPairingState): void {
  if (pairingState === next) return;
  pairingState = next;
  for (const listener of pairingListeners) listener(next);
}

function loadStoredToken(): string | null {
  try {
    const scoped = window.localStorage.getItem(`${TOKEN_STORAGE_KEY}:${encodeURIComponent(remoteHostTokenScope)}`);
    // Preserve pairing from builds predating host-scoped native connections. Browser storage is
    // already isolated by the serving phone's origin, so the legacy key is safe there.
    return scoped ?? (nativePhoneHostSession ? null : window.localStorage.getItem(TOKEN_STORAGE_KEY));
  } catch {
    return null;
  }
}

function persistToken(token: string | null): void {
  try {
    const key = `${TOKEN_STORAGE_KEY}:${encodeURIComponent(remoteHostTokenScope)}`;
    if (token) window.localStorage.setItem(key, token);
    else window.localStorage.removeItem(key);
    if (!nativePhoneHostSession) {
      if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
      else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // storage may be unavailable; the in-memory token still works for this session
  }
}

function setToken(token: string | null): void {
  sessionToken = token;
  // In the installed app the actual bearer credential is captured and held by Electron main. The
  // renderer keeps only this in-memory paired marker and cannot read or persist the credential.
  if (!nativePhoneHostSession) persistToken(token);
}

function advanceRemoteHostSession(): number {
  sessionEpoch += 1;
  sessionAbortController.abort();
  sessionAbortController = new AbortController();
  return sessionEpoch;
}

/** URL a served client should use to fetch a host-side asset blob by id. */
export function remoteHostAssetUrl(id: string): string {
  return `${remoteHostApiBase}/asset/${encodeURIComponent(id)}`;
}

/**
 * Ask the host to resolve a source-library item's bytes by its source-item id and return them as a
 * bounded metadata/sample/full lifecycle. Covers every backing the host knows (native file / scratch / IndexedDB) — the
 * universal path for opening a served library item, since the item's own `assetUrl` may be a phone-local
 * or blob: URL the served browser can't fetch. Returns null when not a served session, unpaired, the
 * host lacks the endpoint (older APK), or the item has no resolvable bytes.
 */
export async function fetchRemoteHostSourceAssetDataUrl(itemId: string): Promise<string | null> {
  try {
    const { loadRemoteSourceAssetForBoundedRead } = await import('./assetStore');
    const asset = await loadRemoteSourceAssetForBoundedRead(itemId, 512 * 1024 * 1024, 256 * 1024);
    const materialized = await asset?.materialize?.();
    return materialized?.dataUrl ?? null;
  } catch {
    return null;
  }
}

interface RemoteHostFetchInit extends RequestInit {
  timeoutMs?: number;
}

/**
 * Authenticated fetch against the host API. Adds the bearer token, defaults the JSON content type for
 * bodies, and on a 401 clears the (now invalid) token and flips the session to `unpaired` so the
 * pairing prompt reappears. Returns `null` only when this isn't a served session / no token is held.
 */
export async function remoteHostFetch(path: string, init: RemoteHostFetchInit = {}): Promise<Response | null> {
  if (!servedSession) return null;
  if (authRequired && !sessionToken) return null;

  const expectedEpoch = sessionEpoch;
  const expectedGeneration = nativePhoneHostConfigurationGeneration;
  const headers = new Headers(init.headers);
  if (sessionToken && !nativePhoneHostSession) headers.set('Authorization', `Bearer ${sessionToken}`);
  if (nativePhoneHostSession && expectedGeneration !== null) {
    headers.set('X-Signal-Loom-Phone-Generation', String(expectedGeneration));
  }
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const sessionSignal = sessionAbortController.signal;
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', onAbort, { once: true });
  if (sessionSignal.aborted) controller.abort();
  else sessionSignal.addEventListener('abort', onAbort, { once: true });
  const timer = init.timeoutMs ? setTimeout(() => controller.abort(), init.timeoutMs) : null;
  try {
    const res = await fetch(`${remoteHostApiBase}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.status === 401
      && authRequired
      && expectedEpoch === sessionEpoch
      && expectedGeneration === nativePhoneHostConfigurationGeneration) {
      setToken(null);
      setPairingState('unpaired');
      // A 401 terminates this authentication epoch, not merely this one request. Without advancing
      // the epoch, the old Source Library loop can still own `subscriberEpoch`, while the generic
      // project client retains its started-channel markers; a quick re-pair would then report success
      // but silently fail to restart either stream.
      subscriberEpoch = null;
      advanceRemoteHostSession();
      void import('./projectSyncClient')
        .then((module) => module.stopAllProjectSyncChannels())
        .catch(() => undefined);
    }
    return res;
  } finally {
    if (timer) clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
    sessionSignal.removeEventListener('abort', onAbort);
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number, generation?: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: generation === undefined
        ? undefined
        : { 'X-Signal-Loom-Phone-Generation': String(generation) },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function probePhoneHost(
  apiBase: string,
  generation?: number,
): Promise<{
  authRequired: boolean;
  collaborationMode: RemoteHostCollaborationMode;
  haneProvider: HaneLinkProviderCapabilities | null;
} | null> {
  try {
    const res = await fetchWithTimeout(`${apiBase}/health`, 2500, generation);
    if (!res.ok) return null;
    // A regular web host answers the SPA fallback with HTML. Never treat that as a phone authority.
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return null;
    const data = (await res.json()) as {
      name?: string;
      authRequired?: boolean;
      collaborationMode?: string;
      sloomLinkProvider?: unknown;
    } | null;
    return data?.name === 'Sloom Studio'
      ? {
          authRequired: Boolean(data.authRequired),
          collaborationMode: data.collaborationMode === 'simultaneous' ? 'simultaneous' : 'baton',
          haneProvider: parseHaneLinkProviderCapabilities(data.sloomLinkProvider),
        }
      : null;
  } catch {
    return null;
  }
}

async function establishPairedState(expectedEpoch: number): Promise<void> {
  if (expectedEpoch !== sessionEpoch || !servedSession) return;
  if (!authRequired) {
    const seeded = await seedAndSubscribe(expectedEpoch).catch(() => false);
    if (seeded && expectedEpoch === sessionEpoch) setPairingState('paired');
    return;
  }

  sessionToken = loadStoredToken();
  if (sessionToken) {
    const seeded = await seedAndSubscribe(expectedEpoch).catch(() => false);
    if (seeded && expectedEpoch === sessionEpoch && sessionToken) setPairingState('paired');
    else if (expectedEpoch === sessionEpoch) {
      setToken(null);
      setPairingState('unpaired');
    }
  } else {
    setPairingState('unpaired');
  }
}

function isPrivateLanHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  const ipv4 = normalized.split('.');
  if (ipv4.length === 4 && ipv4.every((part) => /^\d{1,3}$/.test(part))) {
    const octets = ipv4.map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return false;
    return octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
  const firstIpv6 = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return normalized.includes(':')
    && Number.isFinite(firstIpv6)
    && ((firstIpv6 & 0xfe00) === 0xfc00 || (firstIpv6 & 0xffc0) === 0xfe80);
}

function isHaneLinkPort(value: string): boolean {
  const port = Number(value);
  return value === '8723'
    || (Number.isInteger(port) && port >= 8740 && port <= 8749);
}

function normalizeDirectAndroidPhoneHost(value: string): string {
  const input = value.trim();
  if (!input || input.length > 512) throw new Error('Enter the LAN address shown by Hane.');
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  const url = new URL(candidate);
  if (
    url.protocol !== 'http:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
    || !isPrivateLanHostname(url.hostname)
  ) {
    throw new Error('Enter Hane’s private http:// LAN address without a path or credentials.');
  }
  const requestedPort = url.port || '8723';
  if (!isHaneLinkPort(requestedPort)) {
    throw new Error('Use the local address assigned by Hane Link.');
  }
  url.port = requestedPort;
  return url.origin;
}

/**
 * Detect a served session and, if present, either seed from the phone (when already paired) or leave
 * the session `unpaired` for the pairing prompt. Safe in every runtime: no-ops instantly for native
 * Android (the phone is the authority) and Electron, and for a normal web app the probe simply fails.
 */
export async function initializeRemoteHostSession(): Promise<void> {
  if (probeCompleted) return;
  probeCompleted = true;

  if (typeof window === 'undefined') return;
  if (isAndroidLanServerAvailable()) return;
  // The installed desktop connects only after an explicit owner-entered LAN address. It must never
  // infer phone authority merely because some local URL happens to answer the health route.
  if (window.signalLoomNative) return;

  const health = await probePhoneHost(REMOTE_HOST_API_BASE);
  if (!health) return;
  servedSession = true;
  authRequired = health.authRequired;
  collaborationMode = health.collaborationMode;
  setHaneLinkProvider(health.haneProvider);
  const epoch = advanceRemoteHostSession();
  await establishPairedState(epoch);
}

/**
 * Explicitly attach the installed desktop to an Android LAN authority through Electron's restricted,
 * streaming custom-protocol proxy. The main process permits only private addresses on the fixed port;
 * renderer code never gains a general-purpose network proxy.
 */
export async function connectNativePhoneHost(baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  const bridge = typeof window !== 'undefined' ? window.signalLoomNative : undefined;
  const electronBridgeAvailable = Boolean(
    bridge?.configureRemotePhoneHost && bridge.activateRemotePhoneHost,
  );
  const directAndroidAvailable = Capacitor.isNativePlatform()
    && Capacitor.getPlatform() === 'android';
  if (!electronBridgeAvailable && !directAndroidAvailable) {
    return { ok: false, error: 'Phone linking is unavailable in this build.' };
  }

  await import('./haneLinkedEdit')
    .then((module) => module.stopHaneLinkedEdit())
    .catch(() => undefined);
  unmountHaneProviderSourceBins();
  pendingSourceMutations.length = 0;
  const epoch = advanceRemoteHostSession();
  servedSession = false;
  nativePhoneHostSession = false;
  directAndroidPhoneHostSession = false;
  authRequired = false;
  sessionToken = null;
  subscriberEpoch = null;
  collaborationMode = 'baton';
  setHaneLinkProvider(null);
  setPairingState('unknown');
  void import('./projectSyncClient').then((module) => module.stopAllProjectSyncChannels()).catch(() => undefined);

  if (!electronBridgeAvailable && directAndroidAvailable) {
    let hostBaseUrl = '';
    try {
      hostBaseUrl = normalizeDirectAndroidPhoneHost(baseUrl);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'The Hane address is invalid.',
      };
    }
    remoteHostApiBase = `${hostBaseUrl}${REMOTE_HOST_API_BASE}`;
    remoteHostTokenScope = hostBaseUrl;
    directAndroidPhoneHostSession = true;
    const health = await probePhoneHost(remoteHostApiBase);
    if (!health || epoch !== sessionEpoch) {
      if (epoch === sessionEpoch) resetRemoteHostSessionState();
      return { ok: false, error: 'No Hane Link server answered at that address.' };
    }
    if (!health.haneProvider) {
      resetRemoteHostSessionState();
      return {
        ok: false,
        error: 'Android cross-device linking currently accepts Hane’s additive provider, not another project authority.',
      };
    }
    servedSession = true;
    authRequired = health.authRequired;
    collaborationMode = health.collaborationMode;
    setHaneLinkProvider(health.haneProvider);
    try {
      window.localStorage.setItem(NATIVE_PHONE_ADDRESS_STORAGE_KEY, hostBaseUrl);
    } catch {
      // Remembering the address is optional.
    }
    await establishPairedState(epoch);
    return { ok: true };
  }

  if (!bridge?.configureRemotePhoneHost || !bridge.activateRemotePhoneHost) {
    return { ok: false, error: 'Desktop phone linking is unavailable in this build.' };
  }
  const configured = await bridge.configureRemotePhoneHost({ baseUrl }).catch(() => null);
  if (!configured?.ok
    || !configured.hostBaseUrl
    || !configured.proxyApiBase
    || !Number.isSafeInteger(configured.generation)) {
    return { ok: false, error: configured?.error ?? 'The phone address could not be configured.' };
  }
  if (epoch !== sessionEpoch) {
    await bridge.disconnectRemotePhoneHost?.({ generation: configured.generation! }).catch(() => undefined);
    return { ok: false, error: 'The phone connection changed while configuring.' };
  }

  remoteHostApiBase = configured.proxyApiBase;
  remoteHostTokenScope = configured.hostBaseUrl;
  nativePhoneHostConfigurationGeneration = configured.generation!;
  nativePhoneHostSession = true;
  const health = await probePhoneHost(remoteHostApiBase, configured.generation);
  if (!health || epoch !== sessionEpoch) {
    await bridge.disconnectRemotePhoneHost?.({ generation: configured.generation! }).catch(() => undefined);
    if (epoch === sessionEpoch) resetRemoteHostSessionState();
    return { ok: false, error: 'No Sloom Studio phone server answered at that address.' };
  }

  if (!health.haneProvider) {
    // A complete Sloom Android workspace can become project/file authority. Hane is deliberately
    // different: it is an additive art provider and must never suspend the desktop Paper project.
    const activated = await bridge.activateRemotePhoneHost({ generation: configured.generation! }).catch(() => null);
    if (!activated?.ok || activated.generation !== configured.generation || epoch !== sessionEpoch) {
      await bridge.disconnectRemotePhoneHost?.({ generation: configured.generation! }).catch(() => undefined);
      if (epoch === sessionEpoch) resetRemoteHostSessionState();
      return { ok: false, error: activated?.error ?? 'The phone project authority could not be activated.' };
    }
  }

  servedSession = true;
  authRequired = health.authRequired;
  collaborationMode = health.collaborationMode;
  setHaneLinkProvider(health.haneProvider);
  try {
    window.localStorage.setItem(NATIVE_PHONE_ADDRESS_STORAGE_KEY, configured.hostBaseUrl);
  } catch {
    // Remembering the address is optional; the live session remains valid.
  }
  await establishPairedState(epoch);
  return { ok: true };
}

/**
 * Finish a camera-first Hane link after the native invitation receiver accepts Hane's callback.
 * Electron supplies only a paired marker/configuration because main owns the bearer; Android keeps
 * the capability in this app runtime and therefore supplies it directly.
 */
export async function connectNativePhoneHostFromQr(
  completion: Extract<HaneQrPairingPoll, { status: 'completed' }>,
): Promise<{ ok: boolean; error?: string }> {
  const bridge = typeof window !== 'undefined' ? window.signalLoomNative : undefined;
  if (completion.runtime === 'electron' && !bridge?.disconnectRemotePhoneHost) {
    return { ok: false, error: 'Desktop Hane linking is unavailable in this build.' };
  }
  if (
    completion.runtime === 'android'
    && !(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')
  ) {
    return { ok: false, error: 'Android Hane linking is unavailable in this build.' };
  }

  await import('./haneLinkedEdit')
    .then((module) => module.stopHaneLinkedEdit())
    .catch(() => undefined);
  unmountHaneProviderSourceBins();
  pendingSourceMutations.length = 0;
  const epoch = advanceRemoteHostSession();
  servedSession = false;
  nativePhoneHostSession = false;
  directAndroidPhoneHostSession = false;
  authRequired = false;
  sessionToken = null;
  subscriberEpoch = null;
  collaborationMode = 'baton';
  setHaneLinkProvider(null);
  setPairingState('unknown');
  void import('./projectSyncClient').then((module) => module.stopAllProjectSyncChannels()).catch(() => undefined);

  let hostBaseUrl: string;
  let generation: number | undefined;
  if (completion.runtime === 'electron') {
    if (
      !Number.isSafeInteger(completion.generation)
      || !completion.hostBaseUrl
      || !completion.proxyApiBase
    ) {
      return { ok: false, error: 'The desktop received an invalid Hane pairing completion.' };
    }
    hostBaseUrl = completion.hostBaseUrl;
    generation = completion.generation;
    remoteHostApiBase = completion.proxyApiBase;
    remoteHostTokenScope = hostBaseUrl;
    nativePhoneHostConfigurationGeneration = generation;
    nativePhoneHostSession = true;
  } else {
    try {
      hostBaseUrl = normalizeDirectAndroidPhoneHost(completion.haneUrl);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'The Hane address is invalid.',
      };
    }
    remoteHostApiBase = `${hostBaseUrl}${REMOTE_HOST_API_BASE}`;
    remoteHostTokenScope = hostBaseUrl;
    directAndroidPhoneHostSession = true;
  }

  const health = await probePhoneHost(remoteHostApiBase, generation);
  if (!health || epoch !== sessionEpoch) {
    if (completion.runtime === 'electron') {
      await bridge?.disconnectRemotePhoneHost?.({ generation: completion.generation }).catch(() => undefined);
    }
    if (epoch === sessionEpoch) resetRemoteHostSessionState();
    return { ok: false, error: 'Hane completed the scan, but its Link server could not be verified.' };
  }
  if (!health.haneProvider) {
    if (completion.runtime === 'electron') {
      await bridge?.disconnectRemotePhoneHost?.({ generation: completion.generation }).catch(() => undefined);
    }
    resetRemoteHostSessionState();
    return { ok: false, error: 'The scanned device did not identify itself as Hane.' };
  }

  servedSession = true;
  authRequired = health.authRequired;
  collaborationMode = health.collaborationMode;
  setHaneLinkProvider(health.haneProvider);
  setToken(completion.runtime === 'electron' ? 'electron-main-custodied' : completion.token);
  try {
    window.localStorage.setItem(NATIVE_PHONE_ADDRESS_STORAGE_KEY, hostBaseUrl);
  } catch {
    // Remembering the address is optional; QR pairing is already complete.
  }

  const seeded = await seedAndSubscribe(epoch).catch(() => false);
  if (!seeded || epoch !== sessionEpoch) {
    if (completion.runtime === 'electron') {
      await bridge?.disconnectRemotePhoneHost?.({ generation: completion.generation }).catch(() => undefined);
    }
    if (epoch === sessionEpoch) {
      setToken(null);
      resetRemoteHostSessionState();
    }
    return { ok: false, error: 'Hane paired, but its live source library could not be loaded.' };
  }
  setPairingState('paired');
  return { ok: true };
}

function resetRemoteHostSessionState(): void {
  unmountHaneProviderSourceBins();
  servedSession = false;
  nativePhoneHostSession = false;
  directAndroidPhoneHostSession = false;
  authRequired = false;
  sessionToken = null;
  remoteHostApiBase = REMOTE_HOST_API_BASE;
  remoteHostTokenScope = REMOTE_HOST_API_BASE;
  nativePhoneHostConfigurationGeneration = null;
  collaborationMode = 'baton';
  setHaneLinkProvider(null);
  subscriberEpoch = null;
  // A disconnected desktop is no longer governed by the phone's legacy presence baton. Leaving the
  // mirrored holder behind renders a read-only overlay whose takeover button cannot work off-session.
  useEditLockStore.getState().setLock(null);
  setPairingState('unknown');
}

export async function disconnectNativePhoneHost(): Promise<{
  ok: boolean;
  error?: string;
  localSaveSuspended?: boolean;
}> {
  const bridge = typeof window !== 'undefined' ? window.signalLoomNative : undefined;
  const generation = nativePhoneHostConfigurationGeneration;
  await import('./haneLinkedEdit')
    .then((module) => module.stopHaneLinkedEdit())
    .catch(() => undefined);
  unmountHaneProviderSourceBins();
  pendingSourceMutations.length = 0;
  advanceRemoteHostSession();
  const wasDirectAndroid = directAndroidPhoneHostSession;
  resetRemoteHostSessionState();
  void import('./projectSyncClient').then((module) => module.stopAllProjectSyncChannels()).catch(() => undefined);
  if (wasDirectAndroid) {
    return { ok: true, localSaveSuspended: false };
  }
  if (!bridge?.disconnectRemotePhoneHost || generation === null) {
    return { ok: false, error: 'Phone linking is unavailable in this build.' };
  }
  try {
    return await bridge.disconnectRemotePhoneHost({ generation });
  } catch {
    return { ok: false, error: 'The desktop could not disconnect from the phone host.' };
  }
}

/**
 * Exchange the phone-displayed PIN for a session token, then seed + start the live subscriber. Called
 * by the pairing UI (`RemoteHostBanner`).
 */
export async function pairServedSession(pin: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = pin.trim();
  if (!trimmed) return { ok: false, error: 'Enter the code shown on your phone.' };

  const epoch = sessionEpoch;
  let binding = getLocalDevicePairingBinding();
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (nativePhoneHostSession && nativePhoneHostConfigurationGeneration !== null) {
        headers['X-Signal-Loom-Phone-Generation'] = String(nativePhoneHostConfigurationGeneration);
      }
      res = await fetch(`${remoteHostApiBase}/pair`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pin: trimmed, ...binding }),
        cache: 'no-store',
      });
    } catch {
      return { ok: false, error: 'Could not reach the phone host.' };
    }

    if (epoch !== sessionEpoch || !servedSession) {
      return { ok: false, error: 'The phone connection changed while pairing.' };
    }
    if (res.status !== 403) break;
    const rejection = (await res.json().catch(() => null)) as { error?: string } | null;
    if (rejection?.error === 'device-binding-refused' && attempt === 0) {
      // A cleared or copied browser store cannot reclaim an existing peer id. Start a new principal
      // instead; existing bearer sessions remain server-bound to their original device identity.
      binding = rotateLocalDevicePairingBinding();
      continue;
    }
    return { ok: false, error: 'This browser identity was refused by the phone. Reconnect and pair again.' };
  }
  if (!res) return { ok: false, error: 'Could not reach the phone host.' };
  if (res.status === 401) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'locked') {
      return { ok: false, error: 'Too many attempts — wait a moment, then try again.' };
    }
    return { ok: false, error: 'That code didn’t match. Check the phone and retry.' };
  }
  if (!res.ok) return { ok: false, error: 'Could not reach the phone host.' };

  const body = (await res.json().catch(() => null)) as { token?: string; ok?: boolean } | null;
  if (epoch !== sessionEpoch || !servedSession) {
    return { ok: false, error: 'The phone connection changed while pairing.' };
  }
  if (nativePhoneHostSession) {
    if (body?.ok !== true) return { ok: false, error: 'Pairing failed — please try again.' };
    setToken('electron-main-custodied');
  } else {
    if (!body?.token) return { ok: false, error: 'Pairing failed — please try again.' };
    setToken(body.token);
  }

  const seeded = await seedAndSubscribe(epoch).catch(() => false);
  if (!seeded || epoch !== sessionEpoch) {
    if (epoch === sessionEpoch) {
      setToken(null);
      setPairingState('unpaired');
    }
    return { ok: false, error: 'Paired, but the phone project could not be loaded. Please retry.' };
  }
  setPairingState('paired');
  return { ok: true };
}

/**
 * Pull the phone's source-library snapshot, hydrate the local store from it (read-only seed), and
 * start tailing the live change log. Dynamic import of the (large) source-bin store keeps this module
 * free of a static dependency on it and avoids an import cycle.
 */
async function seedAndSubscribe(expectedEpoch = sessionEpoch): Promise<boolean> {
  const version = await seedSourceLibraryState(expectedEpoch);
  if (version === null) return false;

  if (expectedEpoch !== sessionEpoch) return false;
  if (
    nativePhoneHostSession
    && !haneLinkProviderSession
    && nativePhoneHostConfigurationGeneration !== null
  ) {
    const marked = await window.signalLoomNative?.markRemotePhoneHostSeeded?.({
      generation: nativePhoneHostConfigurationGeneration,
    }).catch(() => null);
    if (!marked?.ok || expectedEpoch !== sessionEpoch) return false;
  }
  startSourceLibrarySubscriber(version, expectedEpoch);

  if (haneLinkProviderSession) {
    // Hane publishes only its live Image channel. Flow/Paper/Video remain desktop-owned and must not
    // seed from or emit into Hane's intentionally read-only provider surface.
    void import('./imageSyncChannel')
      .then((module) => {
        module.initializeImageSyncChannel();
        return import('./projectSyncClient');
      })
      .then((module) => module.ensureProjectSyncChannelStarted('image'))
      .catch(() => undefined);
  } else {
    // Complete Sloom phone workspaces participate in every registered project channel.
    void import('./projectSyncClient')
      .then((module) => module.startAllRegisteredProjectChannels())
      .catch(() => undefined);
  }
  return true;
}

async function mountHaneProviderSourceSnapshot(snapshot: unknown): Promise<boolean> {
  const { sanitizePersistedSourceBinState, useSourceBinStore } = await import('../store/sourceBinStore');
  const safe = sanitizePersistedSourceBinState(snapshot);
  const providerBins = (safe.bins ?? []).filter((bin) => isHaneProviderBinId(bin.id));
  if (providerBins.length === 0) return false;
  const nextProviderIds = new Set(providerBins.map((bin) => bin.id));
  useSourceBinStore.setState((state) => ({
    bins: [
      ...state.bins.filter((bin) => (
        !mountedHaneProviderBinIds.has(bin.id)
        && !isHaneProviderBinId(bin.id)
      )),
      ...providerBins,
    ],
  }));
  mountedHaneProviderBinIds = nextProviderIds;
  await useSourceBinStore.getState().hydrateAssets().catch(() => undefined);
  return true;
}

function unmountHaneProviderSourceBins(): void {
  if (mountedHaneProviderBinIds.size === 0 && !haneLinkProviderSession) return;
  void import('../store/sourceBinStore').then(({ useSourceBinStore }) => {
    useSourceBinStore.setState((state) => ({
      bins: state.bins.filter((bin) => (
        !mountedHaneProviderBinIds.has(bin.id)
        && !isHaneProviderBinId(bin.id)
      )),
    }));
  }).catch(() => undefined);
  mountedHaneProviderBinIds = new Set();
}

/** Replace only the source-library mirror from the authority. Used both at pair time and when the
 * bounded shared event log reports that this client fell behind its retained tail. */
async function seedSourceLibraryState(expectedEpoch: number): Promise<number | null> {
  const res = await remoteHostFetch('/source-library', { timeoutMs: 5000 });
  if (!res || !res.ok || expectedEpoch !== sessionEpoch) return null;

  const payload = (await res.json().catch(() => null)) as
    | { snapshot?: unknown; version?: number }
    | null;
  const snapshot = payload?.snapshot;
  const version = typeof payload?.version === 'number' ? payload.version : 0;

  if (snapshot && expectedEpoch === sessionEpoch) {
    if (haneLinkProviderSession) {
      const mounted = await mountHaneProviderSourceSnapshot(snapshot);
      return mounted && expectedEpoch === sessionEpoch ? version : null;
    }
    const { useSourceBinStore } = await import('../store/sourceBinStore');
    await useSourceBinStore.getState().restoreProjectSnapshot(snapshot as never, { publishNative: false });
    const pending = pendingSourceMutations.filter((entry) => entry.epoch === expectedEpoch);
    if (pending.length > 0) {
      useSourceBinStore.setState((state) => {
        let next = { bins: state.bins, dismissedSourceKeys: state.dismissedSourceKeys };
        for (const entry of pending) next = applySourceLibraryNativeChange(next, entry.change);
        return next;
      });
    }
    // `restoreProjectSnapshot` keeps a native-file item's *phone-local* `assetUrl` (an unreachable
    // `https://localhost/_capacitor_file_/…` URL on a served desktop client) and does NOT call
    // `hydrateAssets`. `hydrateAssets` carries the served-client branch that re-resolves every item's
    // bytes through the host's `/source-asset/:itemId` endpoint, so the library *thumbnails* render the
    // phone's files instead of failing with ERR_CONNECTION_REFUSED. The live subscriber only runs
    // `hydrateAssets` on a later change event, so without this the seeded thumbnails never resolve.
    if (expectedEpoch !== sessionEpoch) return null;
    await useSourceBinStore.getState().hydrateAssets().catch(() => undefined);
  }
  return expectedEpoch === sessionEpoch ? version : null;
}

/**
 * Long-poll the phone's source-library change log and apply each event through the shared reducer.
 * Applying via `setState` (not the public store actions) means a received event is never re-broadcast,
 * so there's no echo loop. Self-echoes of our own pushed mutations are version-deduped and idempotent.
 */
function startSourceLibrarySubscriber(initialVersion: number, expectedEpoch = sessionEpoch): void {
  if (subscriberEpoch === expectedEpoch) return;
  subscriberEpoch = expectedEpoch;
  let since = initialVersion;

  const loop = async () => {
    while (servedSession && expectedEpoch === sessionEpoch && (!authRequired || sessionToken !== null)) {
      let res: Response | null;
      try {
        res = await remoteHostFetch(`/source-library/events?since=${since}`, { timeoutMs: 35_000 });
      } catch {
        await delay(3000);
        continue;
      }
      if (expectedEpoch !== sessionEpoch) break;
      if (!res) break; // token cleared (unpaired)
      if (!res.ok) {
        await delay(3000);
        continue;
      }

      const payload = (await res.json().catch(() => null)) as
        | { version?: number; events?: SourceLibraryNativeEvent[]; gap?: boolean }
        | null;
      if (payload?.gap) {
        const repairedVersion = await seedSourceLibraryState(expectedEpoch).catch(() => null);
        if (repairedVersion === null) await delay(3000);
        else since = repairedVersion;
        continue;
      }
      const events = payload?.events ?? [];
      for (const event of events) {
        if (expectedEpoch !== sessionEpoch) break;
        if (shouldAcceptSourceLibraryNativeVersion(since, event.version)) {
          await applyHostSourceLibraryEvent(event.change);
          since = event.version;
        }
      }
      if (typeof payload?.version === 'number' && payload.version > since) since = payload.version;
      if (events.length === 0) await delay(500); // guard against a non-holding host hot-looping
    }
    if (subscriberEpoch === expectedEpoch) subscriberEpoch = null;
  };

  void loop().catch(() => {
    if (subscriberEpoch === expectedEpoch) subscriberEpoch = null;
  });
}

async function applyHostSourceLibraryEvent(change: SourceLibraryNativeChange): Promise<void> {
  if (haneLinkProviderSession) {
    if (change.type === 'source-library-snapshot') {
      await mountHaneProviderSourceSnapshot(change.snapshot);
    }
    return;
  }
  const { useSourceBinStore } = await import('../store/sourceBinStore');
  let changed = false;
  useSourceBinStore.setState((state) => {
    const next = applySourceLibraryNativeChange(
      { bins: state.bins, dismissedSourceKeys: state.dismissedSourceKeys },
      change,
    );
    changed = next.bins !== state.bins || next.dismissedSourceKeys !== state.dismissedSourceKeys;
    return changed ? next : {};
  });
  if (changed) void useSourceBinStore.getState().hydrateAssets();
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Push a local (desktop) source-library change to the phone. For newly added items we first upload the
 * referenced asset bytes (best-effort, size-capped) so the phone can render them; then we POST the
 * change so the phone applies it and re-broadcasts it on the version log. Registered as the served
 * mutation publisher so `sourceBinStore`'s broadcast hooks reach the phone without an import cycle.
 */
function publishServedSourceLibraryMutation(change: SourceLibraryNativeChange): void {
  if (haneLinkProviderSession || !servedSession || (authRequired && !sessionToken)) return;
  const expectedEpoch = sessionEpoch;
  const pendingEntry: PendingSourceMutation = {
    id: nextPendingSourceMutationId++,
    epoch: expectedEpoch,
    change,
  };
  pendingSourceMutations.push(pendingEntry);
  const work = sourceMutationTail.then(async () => {
    const deliveryAttempts = 4;
    for (let attempt = 1; attempt <= deliveryAttempts; attempt += 1) {
      let uploaded = true;
      if (change.type === 'source-bin-items-added') {
        for (const item of change.items) {
          if (expectedEpoch !== sessionEpoch) return;
          if (item.assetId) {
            uploaded = await uploadServedSessionAsset(item.assetId, expectedEpoch).catch(() => false);
            if (!uploaded) break;
          }
        }
      }
      if (uploaded && expectedEpoch === sessionEpoch
        && await writeRemoteHostJson('/source-library/mutate', change, expectedEpoch, 'POST')) {
        const pendingIndex = pendingSourceMutations.findIndex((entry) => entry.id === pendingEntry.id);
        if (pendingIndex >= 0) pendingSourceMutations.splice(pendingIndex, 1);
        return;
      }
      if (attempt < deliveryAttempts) await delay(Math.min(4000, 1000 * (2 ** (attempt - 1))));
    }
    if (expectedEpoch === sessionEpoch) {
      const message = 'A Source Library handoff could not be synchronized to the phone after repeated attempts. '
        + 'The desktop copy is still intact; check the Wi-Fi connection and try the handoff again.';
      console.warn(`[phone-sync] ${message}`);
      window.dispatchEvent(new CustomEvent(REMOTE_HOST_SYNC_ERROR_EVENT, { detail: { message } }));
    }
  });
  sourceMutationTail = work.catch(() => undefined);
}

async function uploadServedSessionAsset(assetId: string, expectedEpoch = sessionEpoch): Promise<boolean> {
  const { loadImportedAssetAsDataUrl } = await import('./assetStore');
  // Read this browser's own copy directly (not the host) — these are desktop-origin bytes.
  const payload = await loadImportedAssetAsDataUrl(assetId).catch(() => undefined);
  if (!payload?.dataUrl || payload.dataUrl.length > MAX_UPLOAD_DATA_URL_LENGTH || expectedEpoch !== sessionEpoch) {
    return false;
  }

  const record = {
    id: payload.id,
    name: payload.name,
    mimeType: payload.mimeType,
    dataUrl: payload.dataUrl,
    createdAt: Date.now(),
  };
  if (expectedEpoch !== sessionEpoch) return false;
  if (payload.dataUrl.length <= DIRECT_UPLOAD_DATA_URL_LENGTH) {
    return putRemoteHostJson(`/asset/${encodeURIComponent(assetId)}`, record, expectedEpoch);
  }

  const uploadId = globalThis.crypto?.randomUUID?.()
    ?? `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const chunkCount = Math.ceil(payload.dataUrl.length / UPLOAD_CHUNK_CHARACTERS);
  const basePath = `/asset-upload/${encodeURIComponent(assetId)}`;
  const began = await putRemoteHostJson(`${basePath}/begin`, {
    uploadId,
    name: payload.name,
    mimeType: payload.mimeType,
    totalLength: payload.dataUrl.length,
    chunkCount,
    createdAt: record.createdAt,
  }, expectedEpoch);
  if (!began) return false;

  for (let index = 0; index < chunkCount; index += 1) {
    if (expectedEpoch !== sessionEpoch) return false;
    const chunk = payload.dataUrl.slice(
      index * UPLOAD_CHUNK_CHARACTERS,
      (index + 1) * UPLOAD_CHUNK_CHARACTERS,
    );
    const accepted = await putRemoteHostJson(`${basePath}/chunk/${index}`, {
      uploadId,
      chunk,
    }, expectedEpoch);
    if (!accepted) {
      await putRemoteHostJson(`${basePath}/abort`, { uploadId }, expectedEpoch).catch(() => false);
      return false;
    }
  }
  return putRemoteHostJson(`${basePath}/commit`, { uploadId }, expectedEpoch, SOURCE_COMMIT_TIMEOUT_MS);
}

async function putRemoteHostJson(
  path: string,
  value: unknown,
  expectedEpoch: number,
  timeoutMs = SOURCE_WRITE_TIMEOUT_MS,
): Promise<boolean> {
  return writeRemoteHostJson(path, value, expectedEpoch, 'PUT', timeoutMs);
}

async function writeRemoteHostJson(
  path: string,
  value: unknown,
  expectedEpoch: number,
  method: 'POST' | 'PUT',
  timeoutMs = SOURCE_WRITE_TIMEOUT_MS,
): Promise<boolean> {
  if (expectedEpoch !== sessionEpoch) return false;
  for (let attempt = 1; attempt <= SOURCE_WRITE_ATTEMPTS; attempt += 1) {
    try {
      const response = await remoteHostFetch(path, {
        method,
        body: JSON.stringify(value),
        timeoutMs,
      });
      if (expectedEpoch !== sessionEpoch) return false;
      if (response?.ok) {
        const result = await response.json().catch(() => null) as { ok?: boolean } | null;
        if (result?.ok === true) return true;
      } else if (response && response.status >= 400 && response.status < 500) {
        return false;
      }
    } catch {
      // Retry the same idempotent chunk/commit/mutation below.
    }
    if (attempt < SOURCE_WRITE_ATTEMPTS) await delay(250 * attempt);
  }
  return false;
}

// Register the publisher seam at module load; it no-ops until a served+paired session exists.
setServedMutationPublisher(publishServedSourceLibraryMutation);
